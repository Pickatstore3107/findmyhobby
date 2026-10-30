import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { client, db } from '../src/db/index.ts';
import { activities, bookings, categories, payments, points, slots, users } from '../src/db/schema.ts';
import { MAX_ACTIVE_BOOKINGS, ATTEND_POINTS, bookSlot, cancelBooking, checkIn, createSlot, expireHolds, markNoShows, submitUtr, updateSlot, verifyPayment, windowEnd } from '../src/booking.ts';
import { resetDb } from './reset.ts';

const HOUR = 3_600_000;
const now = new Date('2026-10-22T06:30:00Z'); // Thu 22 Oct, 12:00 PM IST
const at = (h: number) => new Date(now.getTime() + h * HOUR);
let admin = 0, activity = 0, key = 0;
const k = () => `key-${++key}`;

const newUsers = async (n: number) => {
  const start = (await db.select({ id: users.id }).from(users)).length;
  const rows = await db.insert(users).values(Array.from({ length: n }, (_, i) =>
    ({ googleSub: `g${start + i}`, email: `u${start + i}@test.in`, name: `User ${start + i}` }))).returning({ id: users.id });
  return rows.map((u) => u.id);
};
// Most tests place sessions close together, so they skip the changeover rule; the scheduling tests check it.
const slot = (startH: number, capacity = 30, allowShortChangeover = true) =>
  createSlot(admin, { activityId: activity, startsAt: at(startH), endsAt: at(startH + 1), price: 9900, capacity, allowShortChangeover });
const seatsOf = async (id: number) => (await db.select().from(slots).where(eq(slots.id, id)))[0].bookedSeats;

beforeAll(async () => {
  await resetDb();
  [admin] = await newUsers(1);
  const [c] = await db.insert(categories).values({ name: 'Play', emoji: '🏆' }).returning();
  const [a] = await db.insert(activities).values({ name: 'Chess', categoryId: c.id, defaultPrice: 9900, defaultCapacity: 30 }).returning();
  activity = a.id;
});
afterAll(() => client.end());

describe('scheduling', () => {
  it('one session at a time: blocks overlaps, and gaps shorter than the changeover unless the admin accepts them', async () => {
    await slot(24, 30, false);
    await expect(slot(24.5, 30, false)).rejects.toThrow('SLOT_CLASH');
    await expect(slot(24.5, 30, true)).rejects.toThrow('SLOT_CLASH'); // overlap is never allowed
    await expect(slot(25, 30, false)).rejects.toThrow('SHORT_CHANGEOVER');
    await expect(slot(23, 30, false)).rejects.toThrow('SHORT_CHANGEOVER'); // also checks the session before
    await expect(slot(25.5, 30, false)).resolves.toBeTypeOf('number'); // exactly 30 minutes is fine
    await expect(slot(22.5, 30, true)).resolves.toBeTypeOf('number');  // back-to-back when the admin accepts it
  });

  it('edits: price and seats change freely, times only before anyone books, seats never below booked', async () => {
    const id = await slot(30, 10, false);
    await updateSlot(admin, id, { price: 14900, capacity: 12 });
    const [userId] = await newUsers(1);
    await bookSlot({ userId, slotId: id, seats: 3, method: 'venue', idempotencyKey: k(), now });
    await expect(updateSlot(admin, id, { capacity: 2 })).rejects.toThrow('BELOW_BOOKED_SEATS');
    await expect(updateSlot(admin, id, { startsAt: at(31), endsAt: at(32) })).rejects.toThrow('SLOT_HAS_BOOKINGS');
    const [s] = await db.select().from(slots).where(eq(slots.id, id));
    expect([s.price, s.capacity, s.bookedSeats]).toEqual([14900, 12, 3]);
  });

  it('a closed session takes no new bookings', async () => {
    const id = await slot(33, 10, false);
    await updateSlot(admin, id, { closed: true });
    const [userId] = await newUsers(1);
    await expect(bookSlot({ userId, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now })).rejects.toThrow('SLOT_CLOSED');
  });

  it('two admins creating the same time at once: exactly one wins', async () => {
    const results = await Promise.allSettled([slot(40), slot(40), slot(40.5)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects capacity above 30 at the database level', async () => {
    await expect(slot(50, 31)).rejects.toThrow();
  });
});

describe('booking', () => {
  it('100 people racing for 30 seats: exactly 30 seats sold, never more', async () => {
    const id = await slot(60);
    const people = await newUsers(100);
    const results = await Promise.allSettled(people.map((userId) =>
      bookSlot({ userId, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now })));
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const lost = results.filter((r) => r.status === 'rejected' && r.reason.code === 'NOT_ENOUGH_SEATS').length;
    expect([won, lost]).toEqual([30, 70]);
    expect(await seatsOf(id)).toBe(30);
  });

  it('mixed group sizes (1–3 seats) never exceed capacity', async () => {
    const id = await slot(70);
    const people = await newUsers(60);
    await Promise.allSettled(people.map((userId, i) =>
      bookSlot({ userId, slotId: id, seats: (i % 3) + 1, method: 'venue', idempotencyKey: k(), now })));
    const sold = (await db.select().from(bookings).where(eq(bookings.slotId, id))).reduce((s, b) => s + b.seats, 0);
    expect(await seatsOf(id)).toBe(sold);
    expect(sold).toBeLessThanOrEqual(30);
    expect(sold).toBeGreaterThanOrEqual(28); // full, except a gap smaller than the remaining group sizes
  });

  it('same request sent twice (network retry) books once', async () => {
    const id = await slot(80);
    const [userId] = await newUsers(1);
    const req = { userId, slotId: id, seats: 2, method: 'venue' as const, idempotencyKey: k(), now };
    const [a, b] = await Promise.all([bookSlot(req), bookSlot(req)]);
    expect(a.ref).toBe(b.ref);
    expect(await seatsOf(id)).toBe(2);
  });

  it('one active booking per user per slot', async () => {
    const id = await slot(81);
    const [userId] = await newUsers(1);
    await bookSlot({ userId, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now });
    await expect(bookSlot({ userId, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now })).rejects.toThrow('ALREADY_BOOKED');
    expect(await seatsOf(id)).toBe(1);
  });

  it('only the next 4 days are bookable, and never the past', async () => {
    expect(windowEnd(now).toISOString()).toBe('2026-10-25T18:30:00.000Z'); // midnight IST after Sun 25 Oct
    const [userId] = await newUsers(1);
    const far = await slot(90); // Mon 26 Oct
    await expect(bookSlot({ userId, slotId: far, seats: 1, method: 'venue', idempotencyKey: k(), now })).rejects.toThrow('SLOT_NOT_BOOKABLE');
    await expect(bookSlot({ userId, slotId: far, seats: 1, method: 'venue', idempotencyKey: k(), now: at(80) })).resolves.toBeTruthy();
    await expect(bookSlot({ userId, slotId: far, seats: 4, method: 'venue', idempotencyKey: k(), now: at(80) })).rejects.toThrow('INVALID_SEATS');
  });
});

describe('UPI payments', () => {
  it('unpaid hold expires after 10 minutes and the seats come back', async () => {
    const id = await slot(10);
    const [userId] = await newUsers(1);
    await bookSlot({ userId, slotId: id, seats: 3, method: 'upi', idempotencyKey: k(), now });
    expect(await seatsOf(id)).toBe(3);
    await expireHolds(new Date(now.getTime() + 9 * 60_000));
    expect(await seatsOf(id)).toBe(3);
    await expireHolds(new Date(now.getTime() + 11 * 60_000));
    expect(await seatsOf(id)).toBe(0);
  });

  it('UTR stops the hold; a UTR can be used only once; admin verify confirms', async () => {
    const id = await slot(11);
    const [u1, u2] = await newUsers(2);
    const b1 = await bookSlot({ userId: u1, slotId: id, seats: 1, method: 'upi', idempotencyKey: k(), now });
    const b2 = await bookSlot({ userId: u2, slotId: id, seats: 1, method: 'upi', idempotencyKey: k(), now });
    await submitUtr(u1, b1.ref, '123456789012', now);
    await expect(submitUtr(u2, b2.ref, '123456789012', now)).rejects.toThrow('UTR_ALREADY_USED');
    await expect(submitUtr(u2, b1.ref, '999999999999', now)).rejects.toThrow('BOOKING_NOT_FOUND'); // someone else's booking
    await expireHolds(at(1));
    expect(await seatsOf(id)).toBe(1); // u1 kept the seat, u2's hold expired
    const [p] = await db.select().from(payments).where(eq(payments.utr, '123456789012'));
    await verifyPayment(admin, p.id, true);
    expect((await db.select().from(bookings).where(eq(bookings.id, b1.id)))[0].status).toBe('confirmed');
  });

  it('rejected UTR cancels the booking and frees the seat', async () => {
    const id = await slot(12);
    const [userId] = await newUsers(1);
    const b = await bookSlot({ userId, slotId: id, seats: 2, method: 'upi', idempotencyKey: k(), now });
    await submitUtr(userId, b.ref, '222222222222', now);
    const [p] = await db.select().from(payments).where(eq(payments.utr, '222222222222'));
    await verifyPayment(admin, p.id, false);
    expect(await seatsOf(id)).toBe(0);
  });
});

describe('cancellation', () => {
  it('free cancel until 2 hours before; verified payment becomes a refund entry', async () => {
    const id = await slot(13);
    const [userId] = await newUsers(1);
    const b = await bookSlot({ userId, slotId: id, seats: 2, method: 'upi', idempotencyKey: k(), now });
    await submitUtr(userId, b.ref, '333333333333', now);
    const [p] = await db.select().from(payments).where(eq(payments.utr, '333333333333'));
    await verifyPayment(admin, p.id, true);
    await expect(cancelBooking(userId, b.ref, at(11.5))).rejects.toThrow('CANCEL_WINDOW_CLOSED');
    await cancelBooking(userId, b.ref, at(10));
    expect(await seatsOf(id)).toBe(0);
    const ledger = await db.select().from(payments).where(eq(payments.bookingId, b.id));
    expect(ledger.reduce((s, x) => s + x.amount, 0)).toBe(0); // +19800 paid, -19800 refund owed
  });
});

describe('attendance', () => {
  it('check-in earns points once; confirmed bookings left unchecked become no-shows after the session', async () => {
    const id = await slot(18);
    const [came, missed] = await newUsers(2);
    const a = await bookSlot({ userId: came, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now });
    await bookSlot({ userId: missed, slotId: id, seats: 1, method: 'venue', idempotencyKey: k(), now });
    await checkIn(admin, a.ref, at(18));
    await expect(checkIn(admin, a.ref, at(18))).rejects.toThrow('ALREADY_CHECKED_IN');
    expect((await db.select().from(points).where(eq(points.userId, came))).map((p) => p.points)).toEqual([ATTEND_POINTS]);

    const statuses = async () => Object.fromEntries((await db.select({ userId: bookings.userId, status: bookings.status })
      .from(bookings).where(eq(bookings.slotId, id))).map((b) => [b.userId, b.status]));
    await markNoShows(at(18.5)); // session still running
    expect(await statuses()).toEqual({ [came]: 'checked_in', [missed]: 'confirmed' });
    await markNoShows(at(19));
    expect(await statuses()).toEqual({ [came]: 'checked_in', [missed]: 'no_show' });
    // The uncollected pay-at-venue charge leaves the payments queue.
    const missedBooking = (await db.select().from(bookings).where(eq(bookings.userId, missed)))[0];
    expect((await db.select().from(payments).where(eq(payments.bookingId, missedBooking.id)))[0].status).toBe('rejected');
  });
});

describe('fair-use limits', () => {
  it('a member can hold at most 3 upcoming bookings, at most 2 of them pay-at-venue, and 1 unverified UPI', async () => {
    const [u] = await newUsers(1);
    const ids = [await slot(200 - 186), await slot(201 - 186), await slot(202 - 186), await slot(203 - 186)];
    const book = (slotId: number, method: 'venue' | 'upi') => bookSlot({ userId: u, slotId, seats: 1, method, idempotencyKey: k(), now });
    await book(ids[0], 'venue');
    await book(ids[1], 'venue');
    await expect(book(ids[2], 'venue')).rejects.toThrow('TOO_MANY_VENUE_BOOKINGS');
    await book(ids[2], 'upi');
    await expect(book(ids[3], 'upi')).rejects.toThrow('TOO_MANY_BOOKINGS');
    expect(MAX_ACTIVE_BOOKINGS).toBe(3);
  });

  it('a second unverified UPI booking waits until the first is verified', async () => {
    const [u] = await newUsers(1);
    const a = await slot(20.5 - 0), b = await slot(21.5);
    await bookSlot({ userId: u, slotId: a, seats: 1, method: 'upi', idempotencyKey: k(), now });
    await expect(bookSlot({ userId: u, slotId: b, seats: 1, method: 'upi', idempotencyKey: k(), now })).rejects.toThrow('UNPAID_BOOKING_WAITING');
  });

  it('the same request key from a different member is refused, not returned', async () => {
    const id = await slot(34.5);
    const [a, b] = await newUsers(2), key = k();
    await bookSlot({ userId: a, slotId: id, seats: 1, method: 'venue', idempotencyKey: key, now });
    await expect(bookSlot({ userId: b, slotId: id, seats: 1, method: 'venue', idempotencyKey: key, now })).rejects.toThrow('DUPLICATE_REQUEST');
  });

  it('staff cannot mark an online (gateway) payment as received by hand', async () => {
    const id = await slot(36);
    const [u] = await newUsers(1);
    const bk = await bookSlot({ userId: u, slotId: id, seats: 1, method: 'gateway', idempotencyKey: k(), now });
    const [p] = await db.insert(payments).values({ bookingId: bk.id, method: 'gateway', amount: bk.amount, status: 'pending' }).returning();
    await expect(verifyPayment(admin, p.id, true)).rejects.toThrow('GATEWAY_PAYMENT_NOT_MANUAL');
  });
});
