// Online payments (Razorpay). The server is the only judge of "paid": it accepts a payment only after checking
// Razorpay's signature, and it confirms each payment exactly once however many times the news arrives.
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { bookings, payments, slots, users } from './db/schema.ts';
import { AppError, tx } from './booking.ts';
import { createOrder, refundPayment } from './razorpay.ts';

type Booking = typeof bookings.$inferSelect;

/** Creates the Razorpay order for a fresh online booking. If Razorpay is unreachable, the seats are released at once. */
export async function startOnlinePayment(b: Pick<Booking, 'id' | 'ref' | 'amount'>) {
  // Safe to repeat: a network retry of the same booking reuses its existing order.
  const [existing] = await db.select({ orderId: payments.gatewayOrderId }).from(payments)
    .where(and(eq(payments.bookingId, b.id), eq(payments.method, 'gateway'), gt(payments.amount, 0)));
  if (existing?.orderId) return existing.orderId;
  try {
    const order = await createOrder(b.amount, b.ref, { ref: b.ref });
    await db.insert(payments).values({ bookingId: b.id, method: 'gateway', amount: b.amount, status: 'pending', gatewayOrderId: order.id });
    return order.id;
  } catch {
    await tx(async (t) => {
      const [bk] = await t.select().from(bookings).where(eq(bookings.id, b.id)).for('update');
      if (bk?.status !== 'pending') return;
      await t.update(bookings).set({ status: 'cancelled', holdUntil: null }).where(eq(bookings.id, b.id));
      await t.update(slots).set({ bookedSeats: sql`${slots.bookedSeats} - ${bk.seats}` }).where(eq(slots.id, bk.slotId));
    });
    throw new AppError('ONLINE_PAYMENT_UNAVAILABLE', 503);
  }
}

export type Outcome = 'confirmed' | 'already' | 'refunded' | 'unknown';

/**
 * Records a captured Razorpay payment. Called from the checkout callback and from the webhook; both may arrive,
 * in any order, any number of times. Money that can't buy a seat (hold expired and slot now full, booking cancelled,
 * wrong amount) is refunded automatically.
 */
export async function confirmOnlinePayment(orderId: string, paymentId: string, amount: number, currency: string, now = new Date()): Promise<Outcome> {
  const result = await tx(async (t) => {
    const [p] = await t.select().from(payments).where(eq(payments.gatewayOrderId, orderId)).for('update');
    if (!p?.bookingId) return { outcome: 'unknown' as const };
    if (p.status === 'verified') return { outcome: 'already' as const };

    // The money has arrived, so it is recorded as received whatever happens to the booking.
    await t.update(payments).set({ status: 'verified', gatewayPaymentId: paymentId, verifiedAt: now, amount }).where(eq(payments.id, p.id));
    const [b] = await t.select().from(bookings).where(eq(bookings.id, p.bookingId)).for('update');
    const refund = async () => {
      const [r] = await t.insert(payments).values({ bookingId: b.id, method: 'gateway', amount: -amount, status: 'pending' }).returning({ id: payments.id });
      return { outcome: 'refunded' as const, refundRowId: r.id };
    };

    if (currency !== 'INR' || amount !== b.amount) return refund();
    if (b.status === 'pending') {
      await t.update(bookings).set({ status: 'confirmed', holdUntil: null }).where(eq(bookings.id, b.id));
      return { outcome: 'confirmed' as const };
    }
    if (b.status === 'expired') {
      // Paid just after the hold ran out: keep the booking if the seats are still free and the member has no other booking there.
      const [other] = await t.select({ id: bookings.id }).from(bookings)
        .where(and(eq(bookings.slotId, b.slotId), eq(bookings.userId, b.userId), ne(bookings.id, b.id), inArray(bookings.status, ['pending', 'confirmed', 'checked_in'])));
      const taken = other ? [] : await t.update(slots).set({ bookedSeats: sql`${slots.bookedSeats} + ${b.seats}` })
        .where(and(eq(slots.id, b.slotId), eq(slots.cancelled, false), gt(slots.startsAt, now), sql`${slots.bookedSeats} + ${b.seats} <= ${slots.capacity}`))
        .returning({ id: slots.id });
      if (taken.length) {
        await t.update(bookings).set({ status: 'confirmed' }).where(eq(bookings.id, b.id));
        return { outcome: 'confirmed' as const };
      }
    }
    return refund(); // cancelled, expired-and-full, or anything else
  });

  if (result.outcome === 'refunded') {
    // Refund straight away; if Razorpay is unreachable the refund row stays "pending" for the admin's payments list.
    try {
      await refundPayment(paymentId, amount);
      await db.update(payments).set({ status: 'verified', verifiedAt: new Date() }).where(eq(payments.id, result.refundRowId));
    } catch { /* left for manual refund */ }
  }
  return result.outcome;
}

/** Booking status as the app sees it while waiting for payment. */
export async function onlineOrderFor(ref: string) {
  const [row] = await db.select({ booking: bookings, orderId: payments.gatewayOrderId, name: users.name, email: users.email, phone: users.phone }).from(bookings)
    .leftJoin(payments, and(eq(payments.bookingId, bookings.id), eq(payments.method, 'gateway'), gt(payments.amount, 0)))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(eq(bookings.ref, ref));
  return row;
}
