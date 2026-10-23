import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError } from './booking.ts';
import { verifyGoogle, type GoogleProfile } from './auth.ts';
import { memberRoutes } from './routes/member.ts';
import { adminRoutes } from './routes/admin.ts';
import { payRoutes } from './routes/pay.ts';

export type Deps = { verifyGoogle: (idToken: string) => Promise<GoogleProfile> };

export function buildApp(deps: Deps = { verifyGoogle }) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    bodyLimit: 64 * 1024,
    trustProxy: process.env.TRUST_PROXY === '1', // only behind our own load balancer, so client IPs can't be spoofed
  });
  app.register(helmet);
  app.register(cors, { origin: (process.env.ADMIN_ORIGIN ?? '').split(',').filter(Boolean), methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, detail: err.detail });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'BAD_REQUEST' });
    req.log.error(err); // full details stay in our logs, never sent to the client
    return reply.status(500).send({ error: 'INTERNAL' });
  });

  app.get('/health', async () => ({ ok: true }));
  app.register(memberRoutes(deps));
  app.register(adminRoutes, { prefix: '/admin' });
  app.register(payRoutes);
  return app;
}
