// Razorpay: create orders, refund payments, and check signatures. Keys live only in server settings.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './booking.ts';

const BASE = 'https://api.razorpay.com/v1';
const keyId = () => process.env.RAZORPAY_KEY_ID ?? '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET ?? '';

export const onlineEnabled = () => !!(keyId() && keySecret());
export const publicKeyId = keyId;

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${keyId()}:${keySecret()}`).toString('base64') },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new AppError('PAYMENT_PROVIDER_ERROR', 502, await res.text().catch(() => ''));
  return res.json() as Promise<T>;
}

/** One order per payment attempt; the amount is fixed here, so the member can't pay a different amount. */
export const createOrder = (amount: number, receipt: string, notes: Record<string, string>) =>
  call<{ id: string; amount: number; status: string }>('/orders', { amount, currency: 'INR', receipt, notes });

export const refundPayment = (paymentId: string, amount: number) =>
  call<{ id: string; status: string }>(`/payments/${paymentId}/refund`, { amount });

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Checkout's success callback: Razorpay signs "<our order id>|<payment id>" with our key secret. */
export const checkoutSignatureOk = (orderId: string, paymentId: string, signature: string) =>
  onlineEnabled() && same(hmac(keySecret(), `${orderId}|${paymentId}`), signature);

/** Server-to-server webhook: Razorpay signs the exact raw body with the webhook secret. */
export const webhookSignatureOk = (rawBody: string, signature: string) =>
  !!process.env.RAZORPAY_WEBHOOK_SECRET && same(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
