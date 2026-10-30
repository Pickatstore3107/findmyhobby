import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { activities, auditLog, bookings, categories, hosts, points, slots, tournamentPlayers, tournaments, users } from '../db/schema.ts';
import { AppError, bookSlot, cancelBooking, submitUtr, windowEnd } from '../booking.ts';
import { bearer, login, logout, requireUser, revokeSessions } from '../auth.ts';
import { parse } from '../validate.ts';
import { getBracket, register, unregister } from '../tournament.ts';
import { startOnlinePayment } from '../online.ts';
import { onlineEnabled } from '../razorpay.ts';
import type { Deps } from '../app.ts';

const tourId = z.object({ id: z.coerce.number().int().positive() });
const ref = z.object({ ref: z.string().regex(/^FMH-[A-Z0-9]{6}$/) });

export const memberRoutes = (deps: Deps) => async (app: FastifyInstance) => {
  // ── Public ──
  app.post('/auth/google', { config: { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT ?? 10), timeWindow: '1 minute' } } }, async (req) => {
    const { idToken } = parse(z.object({ idToken: z.string().max(4096) }), req.body);
    const { token, user } = await login(await deps.verifyGoogle(idToken), req.ip);
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  });

  // Local development only: sign in with just an email. Never available in production.
  if (process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production') {
    app.post('/auth/dev', async (req) => {
      const { email } = parse(z.object({ email: z.email() }), req.body);
      const { token, user } = await login({ sub: `dev-${email}`, email, name: email.split('@')[0] }, req.ip);
      return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    });
  }

  /** Everything Home needs in one request: categories, activities and the tournament banner. */
  app.get('/catalog', async () => ({
    categories: await db.select().from(categories).orderBy(asc(categories.sort)),
    activities: await db.select().from(activities).where(eq(activities.active, true)),
    tournaments: await db.select({ ...getTableColumns(tournaments), players: sql<number>`(SELECT count(*)::int FROM tournament_players tp WHERE tp.tournament_id = tournaments.id)` })
      .from(tournaments).where(inArray(tournaments.status, ['open', 'closed', 'live'])).orderBy(asc(tournaments.startsAt)),
    // Where members pay by UPI. Set UPI_ID / UPI_NAME on the server; the app opens any UPI app with these filled in.
    payment: { online: onlineEnabled(), upiId: process.env.UPI_ID ?? '', payeeName: process.env.UPI_NAME ?? 'FindMyHobby Club' },
    imageBase: process.env.IMAGE_BASE_URL ?? '',
  }));

  /** Slots from now until the end of the 4-day window, optionally for one activity. */
  app.get('/slots', async (req) => {
    const { activityId } = parse(z.object({ activityId: z.coerce.number().int().positive().optional() }), req.query);
    const now = new Date();
    return db.select({
      id: slots.id, activityId: slots.activityId, activity: activities.name, categoryId: activities.categoryId, category: categories.name,
      startsAt: slots.startsAt, endsAt: slots.endsAt, price: slots.price, hostName: hosts.name,
      // A session closed by the admin shows as full.
      seatsLeft: sql<number>`CASE WHEN ${slots.closed} THEN 0 ELSE ${slots.capacity} - ${slots.bookedSeats} END`, capacity: slots.capacity,
    }).from(slots)
      .innerJoin(activities, eq(activities.id, slots.activityId))
      .innerJoin(categories, eq(categories.id, activities.categoryId))
      .leftJoin(hosts, eq(hosts.id, slots.hostId))
      .where(and(eq(slots.cancelled, false), gt(slots.startsAt, now), lt(slots.startsAt, windowEnd(now)),
        activityId ? eq(slots.activityId, activityId) : undefined))
      .orderBy(asc(slots.startsAt));
  });

  // ── Signed-in members ──
  app.get('/me', async (req) => {
    const { id, name, email, phone, role } = await requireUser(req);
    return { id, name, email, phone, role };
  });

  /** Profile progress: points, sessions attended, hobbies and categories tried, and the achievements they unlock. */
  app.get('/me/progress', async (req) => {
    const user = await requireUser(req);
    const [[{ total }], tried] = await Promise.all([
      db.select({ total: sql<number>`COALESCE(SUM(${points.points}), 0)::int` }).from(points).where(eq(points.userId, user.id)),
      db.select({ activityId: activities.id, activity: activities.name, categoryId: activities.categoryId, times: sql<number>`count(*)::int` })
        .from(bookings).innerJoin(slots, eq(slots.id, bookings.slotId)).innerJoin(activities, eq(activities.id, slots.activityId))
        .where(and(eq(bookings.userId, user.id), eq(bookings.status, 'checked_in')))
        .groupBy(activities.id).orderBy(desc(sql`count(*)`)),
    ]);
    const attended = tried.reduce((n, t) => n + t.times, 0), categoriesTried = new Set(tried.map((t) => t.categoryId)).size;
    const achievements = [
      { id: 'first', title: 'First session', done: attended >= 1 },
      { id: 'five', title: '5 sessions', done: attended >= 5 },
      { id: 'twenty', title: '20 sessions', done: attended >= 20 },
      { id: 'explorer', title: 'Tried 3 hobbies', done: tried.length >= 3 },
      { id: 'all_round', title: 'Tried every category', done: categoriesTried >= 4 },
    ];
    return { points: total, attended, hobbiesTried: tried, categoriesTried, achievements };
  });

  /** Top 50 by points this month (or all time). Shows first names only. */
  app.get('/leaderboard', async (req) => {
    const { period } = parse(z.object({ period: z.enum(['month', 'all']).default('month') }), req.query);
    const IST = 5.5 * 3600e3, now = new Date(Date.now() + IST);
    const since = period === 'month' ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST) : null;
    const rows = await db.select({ userId: points.userId, name: users.name, points: sql<number>`SUM(${points.points})::int` })
      .from(points).innerJoin(users, eq(users.id, points.userId))
      .where(and(eq(users.blocked, false), since ? gte(points.createdAt, since) : undefined))
      .groupBy(points.userId, users.name).having(sql`SUM(${points.points}) > 0`)
      .orderBy(desc(sql`SUM(${points.points})`), asc(points.userId)).limit(50);
    return rows.map((r, i) => ({ rank: i + 1, userId: r.userId, name: r.name.split(' ')[0], points: r.points }));
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
    // Leave any tournaments still open for registration (closed or live ones keep the bracket intact).
    const entries = await db.select({ id: tournamentPlayers.tournamentId }).from(tournamentPlayers).where(eq(tournamentPlayers.userId, user.id));
    for (const { id } of entries) await unregister(user.id, id).catch(() => {});
    await db.update(users).set({ googleSub: `deleted-${user.id}`, email: `deleted-${user.id}`, name: 'Deleted user', phone: null, avatarKey: null, blocked: true })
      .where(eq(users.id, user.id));
    await revokeSessions(user.id);
    await db.insert(auditLog).values({ actorId: user.id, action: 'account.delete', entity: 'user', entityId: user.id });
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
      ref: bookings.ref, status: bookings.status, method: bookings.method, seats: bookings.seats, amount: bookings.amount, holdUntil: bookings.holdUntil,
      activityId: activities.id, activity: activities.name, categoryId: activities.categoryId, category: categories.name, startsAt: slots.startsAt, endsAt: slots.endsAt, hostName: hosts.name,
    }).from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(activities, eq(activities.id, slots.activityId))
      .innerJoin(categories, eq(categories.id, activities.categoryId))
      .leftJoin(hosts, eq(hosts.id, slots.hostId))
      .where(eq(bookings.userId, user.id))
      .orderBy(desc(slots.startsAt)).limit(100);
  });

  // Per signed-in member (not per IP), so one account can't hammer the booking engine from many addresses.
  app.post('/bookings', { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => bearer(req) ?? req.ip } } }, async (req) => {
    const user = await requireUser(req);
    const body = parse(z.object({
      slotId: z.number().int().positive(),
      seats: z.number().int().min(1).max(3),
      method: z.enum(['upi', 'venue', 'gateway']),
      idempotencyKey: z.string().min(8).max(64), // the app generates one per tap of "Book"
    }), req.body);
    if (body.method === 'gateway' && !onlineEnabled()) throw new AppError('ONLINE_PAYMENT_UNAVAILABLE', 503);
    const { id, idempotencyKey, ...booking } = await bookSlot({ ...body, userId: user.id });
    if (body.method === 'gateway' && booking.status === 'pending') await startOnlinePayment({ id, ref: booking.ref, amount: booking.amount });
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

  /** Public bracket: anyone can watch the draw and live results. */
  app.get('/tournaments/:id', async (req) => {
    const { id } = parse(tourId, req.params);
    const bracket = await getBracket(id);
    // Signed-in viewers also learn whether they are registered; everyone else just sees the bracket.
    const user = bearer(req) ? await requireUser(req).catch(() => null) : null;
    const joined = !!user && (await db.select({ id: tournamentPlayers.id }).from(tournamentPlayers)
      .where(and(eq(tournamentPlayers.tournamentId, id), eq(tournamentPlayers.userId, user.id)))).length > 0;
    return { ...bracket, joined };
  });

  app.post('/tournaments/:id/register', async (req) => {
    const user = await requireUser(req);
    if (!user.phone) throw new AppError('PHONE_REQUIRED', 409); // staff need a way to reach players on the day
    await register(user.id, parse(tourId, req.params).id);
    return { ok: true };
  });

  app.delete('/tournaments/:id/register', async (req) => {
    const user = await requireUser(req);
    await unregister(user.id, parse(tourId, req.params).id);
    return { ok: true };
  });
};
