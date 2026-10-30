// Booking engine. Seat counts change only through single atomic UPDATEs inside transactions,
// so simultaneous requests can never oversell a slot.
import { randomInt } from 'node:crypto';
import { and, eq, gt, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { db, type Tx } from './db/index.ts';
import { activities, auditLog, bookings, payments, points, slots, users } from './db/schema.ts';

export class AppError extends Error {
  constructor(public code: string, public status = 400, public detail?: unknown) { super(code); }
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, IST = 5.5 * HOUR;
export const HOLD_MS = 10 * MIN;        // time to pay by UPI before the seat is released
export const ONLINE_HOLD_MS = 15 * MIN; // online payment (Razorpay) gets a little longer
export const CANCEL_CUTOFF_MS = 2 * HOUR;
export const BOOKABLE_DAYS = 4;
export const CHANGEOVER_MS = 30 * MIN;  // time to reset the space between two sessions
export const ATTEND_POINTS = 10;        // points a member earns for each session attended
// Fair-use limits on upcoming bookings per member, so nobody can hold seats they haven't paid for.
export const MAX_ACTIVE_BOOKINGS = 3;
export const MAX_VENUE_BOOKINGS = 2;   // pay at the desk: confirmed without money, so capped lower
export const MAX_UNPAID_UPI = 1;       // UPI bookings still waiting for staff to verify the payment

/** End of the bookable window: midnight IST after today + 3 more days. */
export const windowEnd = (now: Date) =>
  new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST + BOOKABLE_DAYS * DAY);

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, easy to read aloud at the desk
const newRef = () => 'FMH-' + Array.from({ length: 6 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join('');

// PostgreSQL error details sit on the driver error, which Drizzle wraps as `cause`.
export const pgError = (e: unknown) => ((e as any)?.cause ?? e) as { code?: string; constraint_name?: string };
/** True when a unique rule (named after `key`) rejected the write. */
export const isDup = (e: unknown, key: string) => pgError(e).code === '23505' && !!pgError(e).constraint_name?.includes(key);

/** Runs a transaction, retrying the rare deadlock or serialization conflict instead of failing the user. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await db.transaction(fn); }
    catch (e) { if (!['40P01', '40001'].includes(pgError(e).code ?? '') || attempt === 3) throw e; }
  }
}

export const audit = (t: Tx, actorId: number, action: string, entity: string, entityId: number, data?: unknown) =>
  t.insert(auditLog).values({ actorId, action, entity, entityId, data });

/** Gives seats back to a slot. */
const releaseSeats = (t: Tx, slotId: number, seats: number) =>
  t.update(slots).set({ bookedSeats: sql`${slots.bookedSeats} - ${seats}` }).where(eq(slots.id, slotId));

/** On cancellation, unpaid payments are voided and a verified one becomes a pending refund (negative amount). */
async function settleCancelled(t: Tx, bookingId: number) {
  for (const p of await t.select().from(payments).where(eq(payments.bookingId, bookingId))) {
    if (p.status === 'pending') await t.update(payments).set({ status: 'rejected' }).where(eq(payments.id, p.id));
    if (p.status === 'verified' && p.amount > 0) await t.insert(payments).values({ bookingId, method: p.method, amount: -p.amount, status: 'pending' });
  }
}

// ── Admin: scheduling ────────────────────────────────────────────────────────

type SlotInput = { activityId: number; startsAt: Date; endsAt: Date; price: number; capacity: number; hostId?: number | null };
type Timing = { startsAt: Date; endsAt: Date; allowShortChangeover?: boolean };

const toMinute = (d: Date) => new Date(Math.floor(+d / 60_000) * 60_000);

/**
 * The centre runs one session at a time. Refuses any overlap, and (unless the admin accepts it)
 * a gap shorter than the changeover time. Call inside a transaction that holds the schedule lock.
 */
async function checkFree(t: Tx, { startsAt, endsAt, allowShortChangeover }: Timing, exceptId?: number) {
  const gap = allowShortChangeover ? 0 : CHANGEOVER_MS;
  const [clash] = await t.select({ id: slots.id, activity: activities.name, startsAt: slots.startsAt, endsAt: slots.endsAt })
    .from(slots).innerJoin(activities, eq(activities.id, slots.activityId)).where(and(
      eq(slots.cancelled, false), exceptId ? ne(slots.id, exceptId) : undefined,
      lt(slots.startsAt, new Date(+endsAt + gap)), gt(slots.endsAt, new Date(+startsAt - gap))));
  if (!clash) return;
  const overlaps = clash.startsAt < endsAt && clash.endsAt > startsAt;
  // Tells the admin what is already there.
  throw new AppError(overlaps ? 'SLOT_CLASH' : 'SHORT_CHANGEOVER', 409, clash);
}

/** Only one scheduling change at a time, so two admins can't create clashing sessions. Released at commit. */
const lockSchedule = (t: Tx) => t.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fmh.schedule'))`);

export function createSlot(adminId: number, raw: SlotInput & { allowShortChangeover?: boolean }) {
  // Sessions start and end on whole minutes, so back-to-back sessions line up exactly.
  const { allowShortChangeover, ...input } = { ...raw, startsAt: toMinute(raw.startsAt), endsAt: toMinute(raw.endsAt) };
  if (input.endsAt <= input.startsAt) throw new AppError('INVALID_TIMES');
  return tx(async (t) => {
    await lockSchedule(t);
    await checkFree(t, { ...input, allowShortChangeover });
    const [res] = await t.insert(slots).values(input).returning({ id: slots.id });
    await audit(t, adminId, 'slot.create', 'slot', res.id, input);
    return res.id;
  });
}

type SlotEdit = Partial<Timing & { price: number; capacity: number; hostId: number | null; closed: boolean }>;

/** Edits a session. Price changes apply to new bookings only; times can move only while nobody has booked. */
export function updateSlot(adminId: number, slotId: number, edit: SlotEdit) {
  return tx(async (t) => {
    await lockSchedule(t);
    const [slot] = await t.select().from(slots).where(eq(slots.id, slotId)).for('update');
    if (!slot || slot.cancelled) throw new AppError('SLOT_NOT_FOUND', 404);
    const { allowShortChangeover, ...set } = edit;
    if (set.startsAt) set.startsAt = toMinute(set.startsAt);
    if (set.endsAt) set.endsAt = toMinute(set.endsAt);
    const timing = { startsAt: set.startsAt ?? slot.startsAt, endsAt: set.endsAt ?? slot.endsAt, allowShortChangeover };
    if (set.startsAt || set.endsAt) {
      if (slot.bookedSeats > 0) throw new AppError('SLOT_HAS_BOOKINGS', 409);
      if (timing.endsAt <= timing.startsAt) throw new AppError('INVALID_TIMES');
      await checkFree(t, timing, slotId);
    }
    if (set.capacity !== undefined && set.capacity < slot.bookedSeats) throw new AppError('BELOW_BOOKED_SEATS', 409, { booked: slot.bookedSeats });
    await t.update(slots).set(set).where(eq(slots.id, slotId));
    await audit(t, adminId, 'slot.update', 'slot', slotId, set);
  });
}

// ── Member: booking ─────────────────────────────────────────────────────────

type BookInput = { userId: number; slotId: number; seats: number; method: 'upi' | 'venue' | 'gateway'; idempotencyKey: string; now?: Date };

export async function bookSlot({ userId, slotId, seats, method, idempotencyKey, now = new Date() }: BookInput) {
  if (!Number.isInteger(seats) || seats < 1 || seats > 3) throw new AppError('INVALID_SEATS');
  try {
    return await tx(async (t) => {
      // Locking the member's row makes their bookings one-at-a-time, so the limits below can't be raced.
      await t.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const mine = await t.select({ method: bookings.method, status: bookings.status }).from(bookings)
        .innerJoin(slots, eq(slots.id, bookings.slotId))
        .where(and(eq(bookings.userId, userId), inArray(bookings.status, ['pending', 'confirmed']), gt(slots.endsAt, now)));
      if (mine.length >= MAX_ACTIVE_BOOKINGS) throw new AppError('TOO_MANY_BOOKINGS', 409, { max: MAX_ACTIVE_BOOKINGS });
      if (method === 'venue' && mine.filter((b) => b.method === 'venue').length >= MAX_VENUE_BOOKINGS) throw new AppError('TOO_MANY_VENUE_BOOKINGS', 409, { max: MAX_VENUE_BOOKINGS });
      if (method === 'upi' && mine.filter((b) => b.method === 'upi' && b.status === 'pending').length >= MAX_UNPAID_UPI) throw new AppError('UNPAID_BOOKING_WAITING', 409);
      // The seat check and the seat grab are one statement: it succeeds only if the seats are still free.
      const taken = await t.update(slots)
        .set({ bookedSeats: sql`${slots.bookedSeats} + ${seats}` })
        .where(and(eq(slots.id, slotId), eq(slots.cancelled, false), eq(slots.closed, false),
          gt(slots.startsAt, now), lte(slots.startsAt, windowEnd(now)),
          sql`${slots.bookedSeats} + ${seats} <= ${slots.capacity}`))
        .returning({ id: slots.id });
      const [slot] = await t.select().from(slots).where(eq(slots.id, slotId));
      if (!taken.length) {
        if (!slot || slot.cancelled) throw new AppError('SLOT_NOT_FOUND', 404);
        if (slot.closed) throw new AppError('SLOT_CLOSED', 409);
        if (slot.startsAt <= now || slot.startsAt > windowEnd(now)) throw new AppError('SLOT_NOT_BOOKABLE', 409);
        throw new AppError('NOT_ENOUGH_SEATS', 409);
      }
      const booking = {
        ref: newRef(), slotId, userId, seats, amount: slot.price * seats, idempotencyKey,
        // UPI and online bookings hold the seat while the member pays; pay-at-venue bookings are confirmed and settled at the desk.
        method, status: method === 'venue' ? 'confirmed' as const : 'pending' as const,
        holdUntil: method === 'venue' ? null : new Date(now.getTime() + (method === 'gateway' ? ONLINE_HOLD_MS : HOLD_MS)),
      };
      const [ins] = await t.insert(bookings).values(booking).returning({ id: bookings.id });
      if (method === 'venue') await t.insert(payments).values({ bookingId: ins.id, method, amount: booking.amount, status: 'pending' });
      return { id: ins.id, ...booking };
    });
  } catch (e) {
    if (isDup(e, 'one_active_booking_per_slot')) throw new AppError('ALREADY_BOOKED', 409);
    if (isDup(e, 'idempotency_key')) { // the same request arrived twice: return the first result
      const [prev] = await db.select().from(bookings).where(eq(bookings.idempotencyKey, idempotencyKey));
      if (prev?.userId === userId) return prev;
      throw new AppError('DUPLICATE_REQUEST', 409);
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
      if (b.method !== 'upi') throw new AppError('NOT_A_UPI_BOOKING', 409);
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
    // Online payments are settled only by the gateway's signed confirmation, never by hand. Refunds (negative) can be marked sent.
    if (p.method === 'gateway' && p.amount > 0) throw new AppError('GATEWAY_PAYMENT_NOT_MANUAL', 409);
    await t.update(payments).set({ status: approve ? 'verified' : 'rejected', verifiedBy: adminId, verifiedAt: now }).where(eq(payments.id, p.id));
    const [b] = p.bookingId ? await t.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update') : [];
    if (b?.status === 'pending') {
      await t.update(bookings).set({ status: approve ? 'confirmed' : 'cancelled' }).where(eq(bookings.id, b.id));
      if (!approve) await releaseSeats(t, b.slotId, b.seats);
    }
    await audit(t, adminId, approve ? 'payment.verify' : 'payment.reject', 'payment', p.id, { amount: p.amount, method: p.method, utr: p.utr, bookingId: p.bookingId });
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
    await settleCancelled(t, b.id);
  });
}

/** Desk scans the booking QR. Opens 15 minutes before the slot, works once. Pay-at-venue is marked paid here, and attendance earns points. */
export function checkIn(staffId: number, ref: string, now = new Date()) {
  return tx(async (t) => {
    const [b] = await t.select().from(bookings).where(eq(bookings.ref, ref)).for('update');
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 404);
    if (b.status === 'checked_in') throw new AppError('ALREADY_CHECKED_IN', 409);
    if (b.status !== 'confirmed') throw new AppError('BOOKING_NOT_CONFIRMED', 409);
    const [slot] = await t.select().from(slots).where(eq(slots.id, b.slotId));
    if (now.getTime() < slot.startsAt.getTime() - 15 * MIN || now >= slot.endsAt) throw new AppError('OUTSIDE_CHECKIN_WINDOW', 409);
    await t.update(bookings).set({ status: 'checked_in' }).where(eq(bookings.id, b.id));
    await t.update(payments).set({ status: 'verified', verifiedBy: staffId, verifiedAt: now })
      .where(and(eq(payments.bookingId, b.id), eq(payments.method, 'venue'), eq(payments.status, 'pending')));
    await t.insert(points).values({ userId: b.userId, points: ATTEND_POINTS, reason: 'attended', bookingId: b.id }).onConflictDoNothing();
    await audit(t, staffId, 'booking.checkin', 'booking', b.id);
    return { ...b, status: 'checked_in' as const, slot };
  });
}

/** Admin cancels a whole slot (e.g. instructor sick): every booking is cancelled and paid ones get refund entries. */
export function cancelSlot(adminId: number, slotId: number) {
  return tx(async (t) => {
    const [slot] = await t.select().from(slots).where(eq(slots.id, slotId)).for('update');
    if (!slot || slot.cancelled) throw new AppError('SLOT_NOT_FOUND', 404);
    const active = await t.select().from(bookings).where(and(eq(bookings.slotId, slotId),
      sql`${bookings.status} IN ('pending','confirmed')`)).for('update');
    for (const b of active) {
      await t.update(bookings).set({ status: 'cancelled', holdUntil: null }).where(eq(bookings.id, b.id));
      await settleCancelled(t, b.id);
    }
    await t.update(slots).set({ cancelled: true, bookedSeats: 0 }).where(eq(slots.id, slotId));
    await audit(t, adminId, 'slot.cancel', 'slot', slotId, { bookingsCancelled: active.length });
    return active.length;
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

/** Confirmed bookings nobody checked in for become no-shows once the session has ended. Runs every minute. */
export function markNoShows(now = new Date()) {
  return tx(async (t) => {
    const missed = await t.update(bookings).set({ status: 'no_show' })
      .where(and(eq(bookings.status, 'confirmed'),
        inArray(bookings.slotId, t.select({ id: slots.id }).from(slots).where(lte(slots.endsAt, now)))))
      .returning({ id: bookings.id });
    // Pay-at-venue money was never collected, so it no longer waits in the payments queue.
    if (missed.length) await t.update(payments).set({ status: 'rejected' }).where(and(
      inArray(payments.bookingId, missed.map((b) => b.id)), eq(payments.method, 'venue'), eq(payments.status, 'pending')));
    return missed.length;
  });
}
