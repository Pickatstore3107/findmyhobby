// Booking engine. Seat counts change only through single atomic UPDATEs inside transactions,
// so simultaneous requests can never oversell a slot.
import { randomInt } from 'node:crypto';
import { and, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { db, type Tx } from './db/index.ts';
import { auditLog, bookings, payments, slots, zones } from './db/schema.ts';

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, IST = 5.5 * HOUR;
export const HOLD_MS = 10 * MIN;        // time to pay by UPI before the seat is released
export const CANCEL_CUTOFF_MS = 2 * HOUR;
export const BOOKABLE_DAYS = 4;

/** End of the bookable window: midnight IST after today + 3 more days. */
export const windowEnd = (now: Date) =>
  new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST + BOOKABLE_DAYS * DAY);

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to read aloud at the desk
const newRef = () => 'FMH-' + Array.from({ length: 6 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join('');

const mysqlError = (e: unknown) => ((e as any)?.cause ?? e) as { code?: string; errno?: number; message?: string };
const isDup = (e: unknown, key: string) => mysqlError(e).code === 'ER_DUP_ENTRY' && !!mysqlError(e).message?.includes(key);

/** Runs a transaction, retrying the rare InnoDB deadlock instead of failing the user. */
async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await db.transaction(fn); }
    catch (e) { if (mysqlError(e).errno !== 1213 || attempt === 3) throw e; }
  }
}

const audit = (t: Tx, actorId: number, action: string, entity: string, entityId: number, data?: unknown) =>
  t.insert(auditLog).values({ actorId, action, entity, entityId, data });

/** Gives seats back to a slot. */
const releaseSeats = (t: Tx, slotId: number, seats: number) =>
  t.update(slots).set({ bookedSeats: sql`${slots.bookedSeats} - ${seats}` }).where(eq(slots.id, slotId));

// ── Admin: scheduling ────────────────────────────────────────────────────────

type SlotInput = { activityId: number; zoneId: number; startsAt: Date; endsAt: Date; price: number; capacity: number; hostName?: string };

export function createSlot(adminId: number, input: SlotInput) {
  if (input.endsAt <= input.startsAt) throw new AppError('INVALID_TIMES');
  return tx(async (t) => {
    // Locking the zone row makes scheduling in the same zone one-at-a-time, so two admins can't create clashing slots.
    const [zone] = await t.select({ id: zones.id }).from(zones).where(eq(zones.id, input.zoneId)).for('update');
    if (!zone) throw new AppError('ZONE_NOT_FOUND', 404);
    const [clash] = await t.select({ id: slots.id }).from(slots).where(and(
      eq(slots.zoneId, input.zoneId), eq(slots.cancelled, false),
      lt(slots.startsAt, input.endsAt), gt(slots.endsAt, input.startsAt)));
    if (clash) throw new AppError('ZONE_CLASH', 409);
    const [res] = await t.insert(slots).values(input);
    await audit(t, adminId, 'slot.create', 'slot', res.insertId, input);
    return res.insertId;
  });
}

// ── Member: booking ─────────────────────────────────────────────────────────

type BookInput = { userId: number; slotId: number; seats: number; method: 'upi' | 'venue'; idempotencyKey: string; now?: Date };

export async function bookSlot({ userId, slotId, seats, method, idempotencyKey, now = new Date() }: BookInput) {
  if (!Number.isInteger(seats) || seats < 1 || seats > 3) throw new AppError('INVALID_SEATS');
  try {
    return await tx(async (t) => {
      // The seat check and the seat grab are one statement: it succeeds only if the seats are still free.
      const [res] = await t.update(slots)
        .set({ bookedSeats: sql`${slots.bookedSeats} + ${seats}` })
        .where(and(eq(slots.id, slotId), eq(slots.cancelled, false),
          gt(slots.startsAt, now), lte(slots.startsAt, windowEnd(now)),
          sql`${slots.bookedSeats} + ${seats} <= ${slots.capacity}`));
      const [slot] = await t.select().from(slots).where(eq(slots.id, slotId));
      if (res.affectedRows === 0) {
        if (!slot || slot.cancelled) throw new AppError('SLOT_NOT_FOUND', 404);
        if (slot.startsAt <= now || slot.startsAt > windowEnd(now)) throw new AppError('SLOT_NOT_BOOKABLE', 409);
        throw new AppError('NOT_ENOUGH_SEATS', 409);
      }
      const booking = {
        ref: newRef(), slotId, userId, seats, amount: slot.price * seats, idempotencyKey,
        // UPI bookings hold the seat while the user pays; pay-at-venue bookings are confirmed and settled at the desk.
        status: method === 'upi' ? 'pending' as const : 'confirmed' as const,
        holdUntil: method === 'upi' ? new Date(now.getTime() + HOLD_MS) : null,
      };
      const [ins] = await t.insert(bookings).values(booking);
      if (method === 'venue') await t.insert(payments).values({ bookingId: ins.insertId, method, amount: booking.amount, status: 'pending' });
      return { id: ins.insertId, ...booking };
    });
  } catch (e) {
    if (isDup(e, 'one_active_booking_per_slot')) throw new AppError('ALREADY_BOOKED', 409);
    if (isDup(e, 'idempotency_key')) { // the same request arrived twice: return the first result
      const [prev] = await db.select().from(bookings).where(eq(bookings.idempotencyKey, idempotencyKey));
      if (prev?.userId === userId) return prev;
    }
    throw e;
  }
}

/** Member submits the UPI transaction number (UTR). The hold stops; the booking waits for admin verification. */
export async function submitUtr(userId: number, ref: string, utr: string, now = new Date()) {
  if (!/^\d{12}$/.test(utr)) throw new AppError('INVALID_UTR');
  try {
    return await tx(async (t) => {
      const [b] = await t.select().from(bookings).where(and(eq(bookings.ref, ref), eq(bookings.userId, userId))).for('update');
      if (!b) throw new AppError('BOOKING_NOT_FOUND', 404);
      if (b.status !== 'pending' || !b.holdUntil || b.holdUntil <= now) throw new AppError('HOLD_EXPIRED', 409);
      await t.insert(payments).values({ bookingId: b.id, method: 'upi', amount: b.amount, utr, status: 'pending' });
      await t.update(bookings).set({ holdUntil: null }).where(eq(bookings.id, b.id));
    });
  } catch (e) {
    if (isDup(e, 'utr')) throw new AppError('UTR_ALREADY_USED', 409);
    throw e;
  }
}

/** Admin checks the UTR against the bank app, then approves or rejects. */
export function verifyPayment(adminId: number, paymentId: number, approve: boolean, now = new Date()) {
  return tx(async (t) => {
    const [p] = await t.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p || p.status !== 'pending') throw new AppError('PAYMENT_NOT_PENDING', 409);
    await t.update(payments).set({ status: approve ? 'verified' : 'rejected', verifiedBy: adminId, verifiedAt: now }).where(eq(payments.id, p.id));
    const [b] = p.bookingId ? await t.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update') : [];
    if (b?.status === 'pending') {
      await t.update(bookings).set({ status: approve ? 'confirmed' : 'cancelled' }).where(eq(bookings.id, b.id));
      if (!approve) await releaseSeats(t, b.slotId, b.seats);
    }
    await audit(t, adminId, approve ? 'payment.verify' : 'payment.reject', 'payment', p.id);
  });
}

/** Free cancellation up to 2 hours before the slot. A verified payment gets a refund entry for the admin to pay out. */
export function cancelBooking(userId: number, ref: string, now = new Date()) {
  return tx(async (t) => {
    const [b] = await t.select().from(bookings).where(and(eq(bookings.ref, ref), eq(bookings.userId, userId))).for('update');
    if (!b || (b.status !== 'pending' && b.status !== 'confirmed')) throw new AppError('BOOKING_NOT_CANCELLABLE', 409);
    const [slot] = await t.select({ startsAt: slots.startsAt }).from(slots).where(eq(slots.id, b.slotId));
    if (slot.startsAt.getTime() - now.getTime() < CANCEL_CUTOFF_MS) throw new AppError('CANCEL_WINDOW_CLOSED', 409);
    await t.update(bookings).set({ status: 'cancelled', holdUntil: null }).where(eq(bookings.id, b.id));
    await releaseSeats(t, b.slotId, b.seats);
    // Unpaid payments are voided; a verified one becomes a pending refund (negative amount) in the ledger.
    const paid = await t.select().from(payments).where(eq(payments.bookingId, b.id));
    for (const p of paid) {
      if (p.status === 'pending') await t.update(payments).set({ status: 'rejected' }).where(eq(payments.id, p.id));
      if (p.status === 'verified' && p.amount > 0) await t.insert(payments).values({ bookingId: b.id, method: p.method, amount: -p.amount, status: 'pending' });
    }
  });
}

/** Releases seats from UPI holds that were never paid. Runs every minute on the server. */
export async function expireHolds(now = new Date()) {
  const due = await db.select({ id: bookings.id }).from(bookings)
    .where(and(eq(bookings.status, 'pending'), lt(bookings.holdUntil, now)));
  for (const { id } of due) {
    await tx(async (t) => {
      // Re-checked under the lock, in case the user submitted their UTR at the last second.
      const [b] = await t.select().from(bookings).where(eq(bookings.id, id)).for('update');
      if (b?.status !== 'pending' || !b.holdUntil || b.holdUntil >= now) return;
      await t.update(bookings).set({ status: 'expired', holdUntil: null }).where(eq(bookings.id, id));
      await releaseSeats(t, b.slotId, b.seats);
    });
  }
  return due.length;
}
