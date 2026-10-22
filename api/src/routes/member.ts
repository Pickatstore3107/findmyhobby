import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { activities, bookings, categories, sessions, slots, tournaments, users, zones } from '../db/schema.ts';
import { AppError, bookSlot, cancelBooking, submitUtr, windowEnd } from '../booking.ts';
import { bearer, login, logout, requireUser } from '../auth.ts';
import { parse } from '../validate.ts';
import type { Deps } from '../app.ts';

const ref = z.object({ ref: z.string().regex(/^FMH-[A-Z0-9]{6}$/) });

export const memberRoutes = (deps: Deps) => async (app: FastifyInstance) => {
  // ── Public ──
  app.post('/auth/google', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { idToken } = parse(z.object({ idToken: z.string().max(4096) }), req.body);
    const { token, user } = await login(await deps.verifyGoogle(idToken));
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  /** Everything Home needs in one request: categories, activities and the tournament banner. */
  app.get('/catalog', async () => ({
    categories: await db.select().from(categories).orderBy(asc(categories.sort)),
    activities: await db.select().from(activities).where(eq(activities.active, true)),
    tournaments: await db.select().from(tournaments).where(inArray(tournaments.status, ['open', 'closed', 'live'])).orderBy(asc(tournaments.startsAt)),
  }));

  /** Slots from now until the end of the 4-day window, optionally for one activity. */
  app.get('/slots', async (req) => {
    const { activityId } = parse(z.object({ activityId: z.coerce.number().int().positive().optional() }), req.query);
    const now = new Date();
    return db.select({
      id: slots.id, activityId: slots.activityId, activity: activities.name, zone: zones.name,
      startsAt: slots.startsAt, endsAt: slots.endsAt, price: slots.price, hostName: slots.hostName,
      seatsLeft: sql<number>`${slots.capacity} - ${slots.bookedSeats}`, capacity: slots.capacity,
    }).from(slots)
      .innerJoin(activities, eq(activities.id, slots.activityId))
      .innerJoin(zones, eq(zones.id, slots.zoneId))
      .where(and(eq(slots.cancelled, false), gt(slots.startsAt, now), lt(slots.startsAt, windowEnd(now)),
        activityId ? eq(slots.activityId, activityId) : undefined))
      .orderBy(asc(slots.startsAt));
  });

  // ── Signed-in members ──
  app.get('/me', async (req) => {
    const { id, name, email, phone, role } = await requireUser(req);
    return { id, name, email, phone, role };
  });

  app.patch('/me', async (req) => {
    const user = await requireUser(req);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(100).optional(),
      phone: z.string().regex(/^[6-9]\d{9}$/).optional(), // Indian mobile number
    }), req.body);
    await db.update(users).set(body).where(eq(users.id, user.id));
    return { ok: true };
  });

  /** Account deletion (required by Google Play). Personal data is erased; booking and money records stay anonymous for accounts. */
  app.delete('/me', async (req) => {
    const user = await requireUser(req);
    const [upcoming] = await db.select({ id: bookings.id }).from(bookings).innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(and(eq(bookings.userId, user.id), inArray(bookings.status, ['pending', 'confirmed']), gt(slots.startsAt, new Date())));
    if (upcoming) throw new AppError('CANCEL_UPCOMING_BOOKINGS_FIRST', 409);
    await db.update(users).set({ googleSub: `deleted-${user.id}`, email: `deleted-${user.id}`, name: 'Deleted user', phone: null, avatarKey: null, blocked: true })
      .where(eq(users.id, user.id));
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    return { ok: true };
  });

  app.post('/auth/logout', async (req) => {
    const token = bearer(req);
    if (token) await logout(token);
    return { ok: true };
  });

  app.get('/bookings', async (req) => {
    const user = await requireUser(req);
    return db.select({
      ref: bookings.ref, status: bookings.status, seats: bookings.seats, amount: bookings.amount, holdUntil: bookings.holdUntil,
      activity: activities.name, zone: zones.name, startsAt: slots.startsAt, endsAt: slots.endsAt,
    }).from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(activities, eq(activities.id, slots.activityId))
      .innerJoin(zones, eq(zones.id, slots.zoneId))
      .where(eq(bookings.userId, user.id))
      .orderBy(desc(slots.startsAt)).limit(100);
  });

  app.post('/bookings', async (req) => {
    const user = await requireUser(req);
    const body = parse(z.object({
      slotId: z.number().int().positive(),
      seats: z.number().int().min(1).max(3),
      method: z.enum(['upi', 'venue']),
      idempotencyKey: z.string().min(8).max(64), // the app generates one per tap of "Book"
    }), req.body);
    const { id, idempotencyKey, ...booking } = await bookSlot({ ...body, userId: user.id });
    return booking;
  });

  app.post('/bookings/:ref/utr', async (req) => {
    const user = await requireUser(req);
    const { utr } = parse(z.object({ utr: z.string() }), req.body);
    await submitUtr(user.id, parse(ref, req.params).ref, utr);
    return { ok: true };
  });

  app.post('/bookings/:ref/cancel', async (req) => {
    const user = await requireUser(req);
    await cancelBooking(user.id, parse(ref, req.params).ref);
    return { ok: true };
  });
};
