import { buildApp } from './app.ts';
import { expireHolds } from './booking.ts';

const app = buildApp();
// In production HOST=127.0.0.1: only Caddy on the same machine can reach the API.
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 4000) });

// Free unpaid UPI holds every minute.
setInterval(() => expireHolds().catch((e) => app.log.error(e)), 60_000).unref();
