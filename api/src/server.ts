import { buildApp } from './app.ts';
import { expireHolds } from './booking.ts';

const app = buildApp();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 4000) });

// Free unpaid UPI holds every minute.
setInterval(() => expireHolds().catch((e) => app.log.error(e)), 60_000).unref();
