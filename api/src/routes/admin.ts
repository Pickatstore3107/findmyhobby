import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { activities, auditLog, bookings, categories, payments, slots, tournamentPlayers, tournaments, users, zones } from '../db/schema.ts';
import { AppError, cancelSlot, checkIn, createSlot, verifyPayment } from '../booking.ts';
import { requireUser } from '../auth.ts';
import { parse } from '../validate.ts';
import { generateDraw, setWinner } from '../tournament.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const range = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((r) => r.to > r.from && +r.to - +r.from <= 93 * 864e5);
const WEEK = 7 * 864e5;

const activityBody = z.object({
  name: z.string().trim().min(1).max(60),
  categoryId: z.number().int().positive(),
  imageKey: z.string().max(255).regex(/^activities\/[\w./-]+$/).nullable().optional(),
  defaultPrice: z.number().int().min(0).max(10_000_00),
  defaultCapacity: z.number().int().min(1).max(30),
  active: z.boolean().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  // ── Front desk ──
  app.post('/checkin', async (req) => {
    const staff = await requireUser(req, 'desk');
    const { ref } = parse(z.object({ ref: z.string().regex(/^FMH-[A-Z0-9]{6}$/) }), req.body);
    const b = await checkIn(staff.id, ref);
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, b.userId));
    return { ref: b.ref, name: u.name, seats: b.seats, startsAt: b.slot.startsAt };
  });

  /** Every booking in a time range, with who, when, how many seats and how much. */
  app.get('/bookings', async (req) => {
    await requireUser(req, 'desk');
    const { from, to } = parse(range, req.query);
    return db.select({
      ref: bookings.ref, status: bookings.status, seats: bookings.seats, amount: bookings.amount, bookedAt: bookings.createdAt,
      name: users.name, phone: users.phone, activity: activities.name, zone: zones.name, startsAt: slots.startsAt,
    }).from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId)).innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(activities, eq(activities.id, slots.activityId)).innerJoin(zones, eq(zones.id, slots.zoneId))
      .where(and(gte(slots.startsAt, from), lt(slots.startsAt, to)))
      .orderBy(asc(slots.startsAt), asc(bookings.createdAt));
  });

  /** Full schedule (any dates, including beyond the members' 4-day window). */
  app.get('/slots', async (req) => {
    await requireUser(req, 'desk');
    const { from, to } = parse(range, req.query);
    return db.select({ slot: slots, activity: activities.name, zone: zones.name }).from(slots)
      .innerJoin(activities, eq(activities.id, slots.activityId)).innerJoin(zones, eq(zones.id, slots.zoneId))
      .where(and(gte(slots.startsAt, from), lt(slots.startsAt, to))).orderBy(asc(slots.startsAt));
  });

  // ── Manager: schedule, catalog, payments ──
  /** Creates a slot, optionally repeating weekly. Clashing weeks are skipped and reported, not silently dropped. */
  app.post('/slots', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { repeatWeeks, ...input } = parse(z.object({
      activityId: z.number().int().positive(), zoneId: z.number().int().positive(),
      startsAt: z.coerce.date(), endsAt: z.coerce.date(),
      price: z.number().int().min(0).max(10_000_00), capacity: z.number().int().min(1).max(30),
      hostName: z.string().trim().max(60).optional(), repeatWeeks: z.number().int().min(0).max(12).default(0),
    }), req.body);
    if (input.startsAt <= new Date()) throw new AppError('SLOT_IN_PAST');
    if (+input.endsAt - +input.startsAt > 12 * 3600e3) throw new AppError('SLOT_TOO_LONG');
    const created: number[] = [], clashes: Date[] = [];
    for (let w = 0; w <= repeatWeeks; w++) {
      const startsAt = new Date(+input.startsAt + w * WEEK), endsAt = new Date(+input.endsAt + w * WEEK);
      try { created.push(await createSlot(admin.id, { ...input, startsAt, endsAt })); }
      catch (e) { if ((e as AppError).code === 'ZONE_CLASH') clashes.push(startsAt); else throw e; }
    }
    return { created, clashes };
  });

  app.post('/slots/:id/cancel', async (req) => {
    const admin = await requireUser(req, 'manager');
    return { bookingsCancelled: await cancelSlot(admin.id, parse(idParam, req.params).id) };
  });

  app.post('/activities', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(activityBody, req.body);
    const [res] = await db.insert(activities).values(body);
    await db.insert(auditLog).values({ actorId: admin.id, action: 'activity.create', entity: 'activity', entityId: res.insertId, data: body });
    return { id: res.insertId };
  });

  app.patch('/activities/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const body = parse(activityBody.partial(), req.body);
    await db.update(activities).set(body).where(eq(activities.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'activity.update', entity: 'activity', entityId: id, data: body });
    return { ok: true };
  });

  app.get('/catalog', async (req) => {
    await requireUser(req, 'desk');
    return { categories: await db.select().from(categories), zones: await db.select().from(zones), activities: await db.select().from(activities) };
  });

  app.post('/zones', async (req) => {
    await requireUser(req, 'manager');
    const [res] = await db.insert(zones).values(parse(z.object({ name: z.string().trim().min(1).max(50) }), req.body));
    return { id: res.insertId };
  });

  app.post('/categories', async (req) => {
    await requireUser(req, 'manager');
    const body = parse(z.object({ name: z.string().trim().min(1).max(30), emoji: z.string().min(1).max(8), sort: z.number().int().min(0).max(100) }), req.body);
    const [res] = await db.insert(categories).values(body);
    return { id: res.insertId };
  });

  /** Payment queue: UPI to verify, pay-at-venue to collect, refunds owed (negative amounts) to pay out. */
  app.get('/payments', async (req) => {
    await requireUser(req, 'manager');
    const { status } = parse(z.object({ status: z.enum(['pending', 'verified', 'rejected']).default('pending') }), req.query);
    return db.select({ payment: payments, ref: bookings.ref, name: users.name, phone: users.phone }).from(payments)
      .leftJoin(bookings, eq(bookings.id, payments.bookingId)).leftJoin(users, eq(users.id, bookings.userId))
      .where(eq(payments.status, status)).orderBy(desc(payments.createdAt)).limit(200);
  });

  /** Approve = money received (or refund sent). Reject = not received; the booking is cancelled and seats freed. */
  app.post('/payments/:id/verify', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
    await verifyPayment(admin.id, parse(idParam, req.params).id, approve);
    return { ok: true };
  });

  // ── Manager: tournaments ──
  const tournamentBody = z.object({
    title: z.string().trim().min(1).max(80), activityId: z.number().int().positive(), startsAt: z.coerce.date(),
    entryFee: z.number().int().min(0).max(100_000_00), maxPlayers: z.number().int().min(2).max(30),
    bannerKey: z.string().max(255).regex(/^tournaments\/[\w./-]+$/).nullable().optional(),
    status: z.enum(['draft', 'open', 'closed']).optional(), // live/finished happen only through the draw and results
  });

  app.post('/tournaments', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(tournamentBody, req.body);
    const [res] = await db.insert(tournaments).values(body);
    await db.insert(auditLog).values({ actorId: admin.id, action: 'tournament.create', entity: 'tournament', entityId: res.insertId, data: body });
    return { id: res.insertId };
  });

  app.patch('/tournaments/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const body = parse(tournamentBody.partial(), req.body);
    const [tour] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!tour) throw new AppError('TOURNAMENT_NOT_FOUND', 404);
    if (tour.status === 'live' || tour.status === 'finished') throw new AppError('TOURNAMENT_ALREADY_STARTED', 409);
    const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(tournamentPlayers).where(eq(tournamentPlayers.tournamentId, id));
    if (body.maxPlayers !== undefined && body.maxPlayers < n) throw new AppError('BELOW_REGISTERED_COUNT', 409);
    await db.update(tournaments).set(body).where(eq(tournaments.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'tournament.update', entity: 'tournament', entityId: id, data: body });
    return { ok: true };
  });

  app.get('/tournaments', async (req) => {
    await requireUser(req, 'desk');
    return db.select({ tournament: tournaments, players: sql<number>`(SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = ${tournaments.id})` })
      .from(tournaments).orderBy(desc(tournaments.startsAt)).limit(100);
  });

  app.post('/tournaments/:id/draw', async (req) => {
    const admin = await requireUser(req, 'manager');
    await generateDraw(admin.id, parse(idParam, req.params).id);
    return { ok: true };
  });

  /** Desk staff run the matches on the day, so they can record results. winnerId null = undo. */
  app.post('/matches/:id/winner', async (req) => {
    const staff = await requireUser(req, 'desk');
    const { winnerId } = parse(z.object({ winnerId: z.number().int().positive().nullable() }), req.body);
    await setWinner(staff.id, parse(idParam, req.params).id, winnerId);
    return { ok: true };
  });

  // ── Owner: money and people ──
  /** Daily money in IST: collected, refunded and net. Only verified entries count. */
  app.get('/revenue', async (req) => {
    await requireUser(req, 'owner');
    const { from, to } = parse(range, req.query);
    const day = sql<string>`DATE(CONVERT_TZ(${payments.verifiedAt}, '+00:00', '+05:30'))`;
    return db.select({
      day, collected: sql<number>`SUM(GREATEST(${payments.amount}, 0))`,
      refunded: sql<number>`-SUM(LEAST(${payments.amount}, 0))`, net: sql<number>`SUM(${payments.amount})`,
    }).from(payments).where(and(eq(payments.status, 'verified'), gte(payments.verifiedAt, from), lt(payments.verifiedAt, to)))
      .groupBy(day).orderBy(day);
  });

  app.get('/users', async (req) => {
    await requireUser(req, 'owner');
    const { q } = parse(z.object({ q: z.string().trim().max(100).default('') }), req.query);
    return db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, blocked: users.blocked })
      .from(users).where(q ? sql`${users.name} LIKE ${'%' + q + '%'} OR ${users.email} LIKE ${'%' + q + '%'} OR ${users.phone} LIKE ${'%' + q + '%'}` : undefined)
      .orderBy(desc(users.id)).limit(100);
  });

  app.patch('/users/:id', async (req) => {
    const owner = await requireUser(req, 'owner');
    const { id } = parse(idParam, req.params);
    if (id === owner.id) throw new AppError('CANNOT_CHANGE_SELF'); // stops an owner locking themselves out
    const body = parse(z.object({ role: z.enum(['member', 'desk', 'manager', 'owner']).optional(), blocked: z.boolean().optional() }), req.body);
    await db.update(users).set(body).where(eq(users.id, id));
    await db.insert(auditLog).values({ actorId: owner.id, action: 'user.update', entity: 'user', entityId: id, data: body });
    return { ok: true };
  });
}
