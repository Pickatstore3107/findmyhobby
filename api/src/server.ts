import { buildApp } from './app.ts';
import { expireHolds, markNoShows } from './booking.ts';
import { purgeSessions } from './auth.ts';

const app = buildApp();
// In production HOST=127.0.0.1: only Caddy on the same machine can reach the API.
await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 4000) });

// Every minute: free unpaid holds, and mark no-shows for sessions that have ended.
setInterval(() => {
  expireHolds().catch((e) => app.log.error(e));
  markNoShows().catch((e) => app.log.error(e));
}, 60_000).unref();

// Hourly: delete expired sign-in sessions.
setInterval(() => purgeSessions().catch((e) => app.log.error(e)), 3600e3).unref();
