import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { parse } from '../validate.ts';
import { AppError } from '../booking.ts';
import { confirmOnlinePayment, onlineOrderFor } from '../online.ts';
import { checkoutSignatureOk, publicKeyId, webhookSignatureOk } from '../razorpay.ts';

const refParam = z.object({ ref: z.string().regex(/^FMH-[A-Z0-9]{6}$/) });

/** Where the payment page may send the member afterwards: our app, or (in development) an allowed web origin. */
function safeReturn(url: unknown) {
  if (typeof url !== 'string') return 'findmyhobby://payment';
  const allowed = ['findmyhobby://', ...(process.env.NODE_ENV === 'production' ? [] : ['exp://']),
    ...(process.env.ADMIN_ORIGIN ?? '').split(',').filter(Boolean).map((o) => o + '/')];
  return allowed.some((a) => url.startsWith(a)) ? url : 'findmyhobby://payment';
}

const page = (reply: FastifyReply, nonce: string, body: string) => reply
  .header('content-type', 'text/html; charset=utf-8')
  .header('cache-control', 'no-store')
  .header('content-security-policy', [
    "default-src 'self'", `script-src 'nonce-${nonce}' https://checkout.razorpay.com`, 'frame-src https://*.razorpay.com',
    "connect-src 'self' https://*.razorpay.com", "img-src * data:", "style-src 'unsafe-inline' https://*.razorpay.com", "form-action 'self' https://*.razorpay.com",
  ].join('; '))
  .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay · FindMyHobby</title><style>body{margin:0;font:16px system-ui,sans-serif;background:#F3F2F2;color:#201E1D;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:360px}h1{font-size:28px;margin:0 0 8px}a,button{display:block;margin-top:16px;padding:14px;background:#EC3013;color:#fff;border:0;font:700 16px system-ui;text-align:left;text-decoration:none}</style>
</head><body><main>${body}</main></body></html>`);

export async function payRoutes(app: FastifyInstance) {
  /** The payment page the app opens in an in-app browser. Razorpay's own checkout runs inside it. */
  app.get('/pay/:ref', async (req, reply) => {
    const { ref } = parse(refParam, req.params);
    const back = safeReturn((req.query as Record<string, unknown>).return);
    const row = await onlineOrderFor(ref);
    const nonce = randomBytes(16).toString('base64');
    const done = (title: string, text: string) => page(reply, nonce,
      `<h1>${title}</h1><p>${text}</p><a href="${back}?ref=${ref}">Back to the app</a>`);
    if (!row?.orderId) return done('Payment not found', 'Please go back and book again.');
    const b = row.booking;
    if (b.status === 'confirmed' || b.status === 'checked_in') return done('Already paid ✓', 'Your slot is confirmed.');
    if (b.status !== 'pending' || !b.holdUntil || b.holdUntil <= new Date()) return done('Time ran out', 'The seat was released. Please book again.');

    // JSON is embedded with "<" escaped so nothing in it can break out of the script tag.
    const cfg = JSON.stringify({ key: publicKeyId(), order_id: row.orderId, amount: b.amount, currency: 'INR', name: 'FindMyHobby Club',
      description: `Booking ${ref}`, theme: { color: '#EC3013' }, ref, back,
      // The member's own details, so checkout doesn't ask for them again.
      prefill: { name: row.name, email: row.email.startsWith('deleted-') ? undefined : row.email, ...(row.phone && { contact: `+91${row.phone}` }) },
    }).replace(/</g, '\\u003c');
    return page(reply, nonce, `<h1>Opening secure payment…</h1><p>Pay with any UPI app, card or net banking.</p><button id="retry" hidden>Try again</button>
<script src="https://checkout.razorpay.com/v1/checkout.js" nonce="${nonce}"></script>
<script nonce="${nonce}">
const c = ${cfg};
const go = (status) => location.replace(c.back + '?ref=' + c.ref + '&status=' + status);
const open = () => new Razorpay({ ...c, modal: { ondismiss: () => go('cancelled') }, handler: async (r) => {
  document.querySelector('h1').textContent = 'Confirming…';
  await fetch('/pay/' + c.ref + '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }).catch(() => {});
  go('done');
} }).open();
document.getElementById('retry').onclick = open;
try { open(); } catch { document.getElementById('retry').hidden = false; }
</script>`);
  });

  /** Fast path: checkout reports success. We trust it only if Razorpay's signature matches OUR order id. */
  app.post('/pay/:ref/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { ref } = parse(refParam, req.params);
    const body = parse(z.object({ razorpay_payment_id: z.string().max(40), razorpay_signature: z.string().max(128) }), req.body);
    const row = await onlineOrderFor(ref);
    if (!row?.orderId || !checkoutSignatureOk(row.orderId, body.razorpay_payment_id, body.razorpay_signature)) throw new AppError('INVALID_PAYMENT_SIGNATURE', 400);
    return { outcome: await confirmOnlinePayment(row.orderId, body.razorpay_payment_id, row.booking.amount, 'INR') };
  });

  /** Guaranteed path: Razorpay's server tells ours, even if the member closed the app. Body is read raw for the signature. */
  app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error, undefined); }
    });
    hook.post('/webhooks/razorpay', { config: { rateLimit: false } }, async (req, reply) => {
      const raw = (req as unknown as { rawBody: string }).rawBody;
      if (!webhookSignatureOk(raw, String(req.headers['x-razorpay-signature'] ?? ''))) return reply.status(401).send({ error: 'BAD_SIGNATURE' });
      const event = req.body as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; currency: string; status: string } } } };
      const p = event.payload?.payment?.entity;
      // Only captured money counts. payment.failed is ignored on purpose: a UPI retry can still succeed afterwards.
      if ((event.event === 'payment.captured' || event.event === 'order.paid') && p?.order_id && p.status === 'captured') {
        await confirmOnlinePayment(p.order_id, p.id, p.amount, p.currency);
      }
      return { ok: true };
    });
  });
}
