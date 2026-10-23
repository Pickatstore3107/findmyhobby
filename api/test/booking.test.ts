import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { client, db } from '../src/db/index.ts';
import { activities, bookings, categories, payments, slots, users, zones } from '../src/db/schema.ts';
import { bookSlot, cancelBooking, createSlot, expireHolds, submitUtr, verifyPayment, windowEnd } from '../src/booking.ts';

const HOUR = 3_600_000;
const now = new Date('2026-10-22T06:30:00Z'); // Thu 22 Oct, 12:00 PM IST
const at = (h: number) => new Date(now.getTime() + h * HOUR);
let admin = 0, zone = 0, activity = 0, key = 0;
const k = () => `key-${++key}`;

const newUsers = async (n: number) => {
  const start = (await db.select({ id: users.id }).from(users)).length;
  await db.insert(users).values(Array.from({ length: n }, (_, i) =>
    ({ googleSub: `g${start + i}`, email: `u${start + i}@test.in`, name: `User ${start + i}` })));
  return (await db.select({ id: users.id }).from(users)).slice(-n).map((u) => u.id);
};
const slot = (startH: number, capacity = 30, z = zone) =>
  createSlot(admin, { activityId: activity, zoneId: z, startsAt: at(startH), endsAt: at(startH + 1), price: 9900, capacity });
const seatsOf = async (id: number) => (await db.select().from(slots).where(eq(slots.id, id)))[0].bookedSeats;

beforeAll(async () => {
  [admin] = await newUsers(1);
  const [c] = await db.insert(categories).values({ name: 'Play', emoji: '🏆' }).returning();
  const [z] = await db.insert(zones).values({ name: 'Zone A' }).returning();
  const [a] = await db.insert(activities).values({ name: 'Chess', categoryId: c.id, defaultPrice: 9900, defaultCapacity: 30 }).returning();
  zone = z.id; activity = a.id;
});
afterAll(() => client.end());

describe('scheduling', () => {
  it('blocks overlapping slots in the same zone, allows back-to-back and other zones', async () => {
    await slot(24);
    await expect(slot(24.5)).rejects.toThrow('ZONE_CLASH');
    await expect(slot(25)).resolves.toBeTypeOf('number');
    const [z2] = await db.insert(zones).values({ name: 'Zone B' }).returning();
    await expect(slot(24, 30, z2.id)).resolves.toBeTypeOf('number');
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
