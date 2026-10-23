import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.ts';
import { db, pool } from '../src/db/index.ts';
import { activities, bookings, categories, payments, slots, users, zones } from '../src/db/schema.ts';
import { createSlot, expireHolds } from '../src/booking.ts';

process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
process.env.OWNER_EMAILS = 'owner@fmh.in';

// Razorpay is simulated: orders get sequential ids, refunds are recorded, and it can be switched "down".
let orderSeq = 0, razorpayDown = false;
const refunds: { paymentId: string; amount: number }[] = [];
vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
  if (razorpayDown) return new Response('{"error":"down"}', { status: 500 });
  const path = String(url).replace('https://api.razorpay.com/v1', '');
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (path === '/orders') return Response.json({ id: `order_T${++orderSeq}`, amount: body.amount, status: 'created' });
  const m = path.match(/^\/payments\/(.+)\/refund$/);
  if (m) { refunds.push({ paymentId: m[1], amount: body.amount }); return Response.json({ id: 'rfnd_1', status: 'processed' }); }
  return new Response('not found', { status: 404 });
});

const app = buildApp({ verifyGoogle: async (t) => ({ sub: `s-${t}`, email: t.slice(7), name: t.slice(7, 12) }) });
const call = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
  const res = await app.inject({ method, url, payload: opts.raw ?? (opts.body as any), headers: { ...(opts.token && { authorization: `Bearer ${opts.token}` }), ...(opts.raw && { 'content-type': 'application/json' }), ...opts.headers } });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body, headers: res.headers };
};
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
const webhook = (orderId: string, paymentId: string, amount: number, secret = 'hook_secret') => {
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } } });
  return call('POST', '/webhooks/razorpay', { raw, headers: { 'x-razorpay-signature': hmac(secret, raw) } });
};

let owner = 0, activity = 0, zone = 0, member = '', key = 0, hour = 0;
const slot = async (capacity = 10) => {
  const startsAt = new Date(Date.now() + (2 + ++hour) * 3600e3);
  return createSlot(owner, { activityId: activity, zoneId: zone, startsAt, endsAt: new Date(+startsAt + 3600e3), price: 19900, capacity });
};
const bookOnline = async (slotId: number, seats = 1, token = member) =>
  call('POST', '/bookings', { token, body: { slotId, seats, method: 'gateway', idempotencyKey: `online-${++key}-xxxx` } });
const bookingOf = async (ref: string) => (await db.select().from(bookings).where(eq(bookings.ref, ref)))[0];
const orderOf = async (ref: string) => (await db.select().from(payments).where(eq(payments.bookingId, (await bookingOf(ref)).id)))[0].gatewayOrderId!;
const seatsLeft = async (id: number) => { const [s] = await db.select().from(slots).where(eq(slots.id, id)); return s.capacity - s.bookedSeats; };
const login = async (email: string) => (await call('POST', '/auth/google', { body: { idToken: `google:${email}` } })).body.token as string;

beforeAll(async () => {
  await login('owner@fmh.in');
  owner = (await db.select().from(users).where(eq(users.email, 'owner@fmh.in')))[0].id;
  const [c] = await db.insert(categories).values({ name: 'Online', emoji: '💳' });
  const [z] = await db.insert(zones).values({ name: 'Zone Pay' });
  const [a] = await db.insert(activities).values({ name: 'Pay Yoga', categoryId: c.insertId, defaultPrice: 19900, defaultCapacity: 10 });
  activity = a.insertId; zone = z.insertId;
  member = await login('payer@test.in');
});
beforeEach(() => { razorpayDown = false; refunds.length = 0; });
afterAll(async () => { await app.close(); await pool.end(); });

describe('starting an online payment', () => {
  it('creates a Razorpay order for the exact amount and holds seats for 15 minutes', async () => {
    const id = await slot();
    const res = await bookOnline(id, 2);
    expect(res.body).toMatchObject({ status: 'pending', method: 'gateway', amount: 39800 });
    expect(+new Date(res.body.holdUntil) - Date.now()).toBeGreaterThan(14 * 60e3);
    expect(await orderOf(res.body.ref)).toMatch(/^order_T/);
    expect(await seatsLeft(id)).toBe(8);
  });

  it('if Razorpay is down, the booking is cancelled and the seats come straight back', async () => {
    const id = await slot();
    razorpayDown = true;
    expect((await bookOnline(id)).body.error).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    expect(await seatsLeft(id)).toBe(10);
  });

  it('the payment page loads Razorpay checkout with our order, under a strict content policy', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    const page = await call('GET', `/pay/${ref}?return=https://evil.example/steal`);
    expect(page.body).toContain(await orderOf(ref));
    expect(page.body).toContain('https://checkout.razorpay.com/v1/checkout.js');
    expect(page.body).not.toContain('evil.example'); // unknown return addresses are replaced by the app link
    expect(String(page.headers['content-security-policy'])).toContain("script-src 'nonce-");
  });
});

describe('confirming payment', () => {
  it('a genuine webhook confirms the booking; repeats are ignored', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    expect((await webhook(await orderOf(ref), 'pay_A1', 19900)).status).toBe(200);
    expect((await bookingOf(ref)).status).toBe('confirmed');
    await webhook(await orderOf(ref), 'pay_A1', 19900);
    await webhook(await orderOf(ref), 'pay_A1', 19900);
    const rows = await db.select().from(payments).where(eq(payments.bookingId, (await bookingOf(ref)).id));
    expect(rows.map((r) => [r.status, r.amount])).toEqual([['verified', 19900]]);
  });

  it('a webhook with a forged signature changes nothing', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    expect((await webhook(await orderOf(ref), 'pay_FAKE', 19900, 'guessed_secret')).status).toBe(401);
    expect((await bookingOf(ref)).status).toBe('pending');
  });

  it('checkout success is accepted only with a valid signature for OUR order id', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    const order = await orderOf(ref);
    expect((await call('POST', `/pay/${ref}/verify`, { body: { razorpay_payment_id: 'pay_B1', razorpay_signature: hmac('test_secret', 'order_OTHER|pay_B1') } })).status).toBe(400);
    expect((await bookingOf(ref)).status).toBe('pending');
    const ok = await call('POST', `/pay/${ref}/verify`, { body: { razorpay_payment_id: 'pay_B1', razorpay_signature: hmac('test_secret', `${order}|pay_B1`) } });
    expect(ok.body.outcome).toBe('confirmed');
    // ...and the webhook arriving afterwards does not double-count
    expect((await webhook(order, 'pay_B1', 19900)).status).toBe(200);
    expect((await call('GET', '/bookings', { token: member })).body.find((b: any) => b.ref === ref).status).toBe('confirmed');
  });

  it('a wrong amount is never accepted and is refunded', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    await webhook(await orderOf(ref), 'pay_C1', 100);
    expect((await bookingOf(ref)).status).toBe('pending');
    expect(refunds).toEqual([{ paymentId: 'pay_C1', amount: 100 }]);
  });
});

describe('late payments', () => {
  it('paid just after the hold ran out: seats still free, so the booking is kept', async () => {
    const id = await slot();
    const ref = (await bookOnline(id, 2)).body.ref;
    await expireHolds(new Date(Date.now() + 16 * 60e3));
    expect((await bookingOf(ref)).status).toBe('expired');
    expect(await seatsLeft(id)).toBe(10);
    await webhook(await orderOf(ref), 'pay_D1', 39800);
    expect((await bookingOf(ref)).status).toBe('confirmed');
    expect(await seatsLeft(id)).toBe(8);
    expect(refunds).toEqual([]);
  });

  it('paid after the hold ran out and the slot filled up: automatic full refund', async () => {
    const id = await slot(1);
    const ref = (await bookOnline(id)).body.ref;
    await expireHolds(new Date(Date.now() + 16 * 60e3));
    await bookOnline(id, 1, await login('fast@test.in')); // someone else takes the last seat
    await webhook(await orderOf(ref), 'pay_E1', 19900);
    expect((await bookingOf(ref)).status).toBe('expired');
    expect(refunds).toEqual([{ paymentId: 'pay_E1', amount: 19900 }]);
    const ledger = await db.select().from(payments).where(eq(payments.bookingId, (await bookingOf(ref)).id));
    expect(ledger.reduce((n, p) => n + p.amount, 0)).toBe(0);
    expect(ledger.every((p) => p.status === 'verified')).toBe(true); // money in, money back out
  });

  it('paid for a booking the member already cancelled: refunded', async () => {
    const ref = (await bookOnline(await slot())).body.ref;
    await call('POST', `/bookings/${ref}/cancel`, { token: member });
    await webhook(await orderOf(ref), 'pay_F1', 19900);
    expect((await bookingOf(ref)).status).toBe('cancelled');
    expect(refunds).toEqual([{ paymentId: 'pay_F1', amount: 19900 }]);
  });
});
