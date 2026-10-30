import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { activities, auditLog, bookings, categories, hosts, payments, points, slots, tournamentPlayers, tournaments, users } from '../db/schema.ts';
import { AppError, audit, cancelSlot, checkIn, createSlot, tx, updateSlot, verifyPayment } from '../booking.ts';
import { report } from '../reports.ts';
import { requireUser, revokeSessions } from '../auth.ts';
import { parse } from '../validate.ts';
import { generateDraw, setWinner } from '../tournament.ts';
import { imageBase, signUpload } from '../uploads.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const range = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((r) => r.to > r.from && +r.to - +r.from <= 93 * 864e5);
const DAY = 864e5;
const price = z.number().int().min(0).max(10_000_00); // paise
const capacity = z.number().int().min(1).max(30);
const hostId = z.number().int().positive().nullable();

const activityBody = z.object({
  name: z.string().trim().min(1).max(60),
  categoryId: z.number().int().positive(),
  imageKey: z.string().max(255).regex(/^activities\/[\w./-]+$/).nullable().optional(),
  about: z.string().trim().max(2000).nullable().optional(),
  bring: z.string().trim().max(200).nullable().optional(),
  level: z.string().trim().min(1).max(20).optional(),
  durationMin: z.number().int().min(15).max(720).optional(),
  defaultHostId: hostId.optional(),
  defaultPrice: price,
  defaultCapacity: capacity.optional(),
  active: z.boolean().optional(),
});
const categoryBody = z.object({
  name: z.string().trim().min(1).max(30), emoji: z.string().min(1).max(8),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), sort: z.number().int().min(0).max(100),
});
const hostBody = z.object({ name: z.string().trim().min(1).max(60), bio: z.string().trim().max(300).nullable().optional(), active: z.boolean().optional() });

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
      name: users.name, phone: users.phone, activity: activities.name, category: categories.name, startsAt: slots.startsAt,
    }).from(bookings)
      .innerJoin(slots, eq(slots.id, bookings.slotId)).innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(activities, eq(activities.id, slots.activityId)).innerJoin(categories, eq(categories.id, activities.categoryId))
      .where(and(gte(slots.startsAt, from), lt(slots.startsAt, to)))
      .orderBy(asc(slots.startsAt), asc(bookings.createdAt));
  });

  /** Full schedule (any dates, including beyond the members' 4-day window). */
  app.get('/slots', async (req) => {
    await requireUser(req, 'desk');
    const { from, to } = parse(range, req.query);
    return db.select({ slot: slots, activity: activities.name, color: categories.color, hostName: hosts.name }).from(slots)
      .innerJoin(activities, eq(activities.id, slots.activityId)).innerJoin(categories, eq(categories.id, activities.categoryId))
      .leftJoin(hosts, eq(hosts.id, slots.hostId))
      .where(and(gte(slots.startsAt, from), lt(slots.startsAt, to))).orderBy(asc(slots.startsAt));
  });

  // ── Manager: schedule, catalog, payments ──
  /**
   * Creates a session, optionally repeating daily or weekly. Price, seats, length and host default to the activity's.
   * Clashing dates are skipped and reported, not silently dropped.
   */
  app.post('/slots', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { repeatEvery, repeatCount, durationMin, ...input } = parse(z.object({
      activityId: z.number().int().positive(), startsAt: z.coerce.date(),
      durationMin: z.number().int().min(15).max(720).optional(),
      price: price.optional(), capacity: capacity.optional(), hostId: hostId.optional(),
      allowShortChangeover: z.boolean().optional(),
      repeatEvery: z.enum(['day', 'week']).default('week'), repeatCount: z.number().int().min(0).max(30).default(0),
    }), req.body);
    if (input.startsAt <= new Date()) throw new AppError('SLOT_IN_PAST');
    const [a] = await db.select().from(activities).where(eq(activities.id, input.activityId));
    if (!a) throw new AppError('ACTIVITY_NOT_FOUND', 404);
    const step = repeatEvery === 'day' ? DAY : 7 * DAY, length = (durationMin ?? a.durationMin) * 60e3;
    const base = { ...input, price: input.price ?? a.defaultPrice, capacity: input.capacity ?? a.defaultCapacity, hostId: input.hostId === undefined ? a.defaultHostId : input.hostId };
    const created: number[] = [], clashes: { startsAt: Date; code: string; with: unknown }[] = [];
    for (let i = 0; i <= repeatCount; i++) {
      const startsAt = new Date(+input.startsAt + i * step);
      try { created.push(await createSlot(admin.id, { ...base, startsAt, endsAt: new Date(+startsAt + length) })); }
      catch (e) {
        const err = e as AppError;
        if (err.code === 'SLOT_CLASH' || err.code === 'SHORT_CHANGEOVER') clashes.push({ startsAt, code: err.code, with: err.detail }); else throw e;
      }
    }
    return { created, clashes };
  });

  /** Open/close for booking, change price, seats, host, or move the time (only before anyone has booked). */
  app.patch('/slots/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(z.object({
      startsAt: z.coerce.date(), endsAt: z.coerce.date(), price, capacity, hostId, closed: z.boolean(), allowShortChangeover: z.boolean(),
    }).partial(), req.body);
    await updateSlot(admin.id, parse(idParam, req.params).id, body);
    return { ok: true };
  });

  app.post('/slots/:id/cancel', async (req) => {
    const admin = await requireUser(req, 'manager');
    return { bookingsCancelled: await cancelSlot(admin.id, parse(idParam, req.params).id) };
  });

  app.post('/activities', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(activityBody, req.body);
    const [res] = await db.insert(activities).values(body).returning({ id: activities.id });
    await db.insert(auditLog).values({ actorId: admin.id, action: 'activity.create', entity: 'activity', entityId: res.id, data: body });
    return { id: res.id };
  });

  app.patch('/activities/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const body = parse(activityBody.partial(), req.body);
    await db.update(activities).set(body).where(eq(activities.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'activity.update', entity: 'activity', entityId: id, data: body });
    return { ok: true };
  });

  /** Only an activity that was never scheduled can be deleted; otherwise hide it with active: false. */
  app.delete('/activities/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const [used] = await db.select({ id: slots.id }).from(slots).where(eq(slots.activityId, id)).limit(1);
    if (used) throw new AppError('ACTIVITY_HAS_SESSIONS', 409);
    await db.delete(activities).where(eq(activities.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'activity.delete', entity: 'activity', entityId: id });
    return { ok: true };
  });

  app.get('/catalog', async (req) => {
    await requireUser(req, 'desk');
    return {
      categories: await db.select().from(categories).orderBy(asc(categories.sort)), hosts: await db.select().from(hosts).orderBy(asc(hosts.name)),
      activities: await db.select().from(activities).orderBy(asc(activities.name)), imageBase: imageBase(),
    };
  });

  /** Signed, 5-minute upload form for one image (max 5 MB, JPEG/PNG/WebP). */
  app.post('/uploads', async (req) => {
    await requireUser(req, 'manager');
    const { folder, contentType } = parse(z.object({ folder: z.enum(['activities', 'tournaments']), contentType: z.string() }), req.body);
    return signUpload(folder, contentType);
  });

  app.post('/categories', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(categoryBody, req.body);
    const [res] = await db.insert(categories).values(body).returning({ id: categories.id });
    await db.insert(auditLog).values({ actorId: admin.id, action: 'category.create', entity: 'category', entityId: res.id, data: body });
    return { id: res.id };
  });

  app.patch('/categories/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params), body = parse(categoryBody.partial(), req.body);
    await db.update(categories).set(body).where(eq(categories.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'category.update', entity: 'category', entityId: id, data: body });
    return { ok: true };
  });

  app.post('/hosts', async (req) => {
    const admin = await requireUser(req, 'manager');
    const body = parse(hostBody, req.body);
    const [res] = await db.insert(hosts).values(body).returning({ id: hosts.id });
    await db.insert(auditLog).values({ actorId: admin.id, action: 'host.create', entity: 'host', entityId: res.id, data: body });
    return { id: res.id };
  });

  app.patch('/hosts/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params), body = parse(hostBody.partial(), req.body);
    await db.update(hosts).set(body).where(eq(hosts.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'host.update', entity: 'host', entityId: id, data: body });
    return { ok: true };
  });

  /** Payment queue: UPI to verify, pay-at-venue to collect, refunds owed (negative amounts) to pay out. */
  app.get('/payments', async (req) => {
    await requireUser(req, 'manager');
    const { status } = parse(z.object({ status: z.enum(['pending', 'verified', 'rejected']).default('pending') }), req.query);
    return db.select({ payment: payments, ref: bookings.ref, name: users.name, phone: users.phone }).from(payments)
      .leftJoin(bookings, eq(bookings.id, payments.bookingId))
      .leftJoin(tournamentPlayers, eq(tournamentPlayers.id, payments.tournamentPlayerId)) // tournament entry fees
      .leftJoin(users, eq(users.id, sql`COALESCE(${bookings.userId}, ${tournamentPlayers.userId})`))
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
    const [res] = await db.insert(tournaments).values(body).returning({ id: tournaments.id });
    await db.insert(auditLog).values({ actorId: admin.id, action: 'tournament.create', entity: 'tournament', entityId: res.id, data: body });
    return { id: res.id };
  });

  app.patch('/tournaments/:id', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const body = parse(tournamentBody.partial(), req.body);
    const [tour] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    if (!tour) throw new AppError('TOURNAMENT_NOT_FOUND', 404);
    if (tour.status === 'live' || tour.status === 'finished') throw new AppError('TOURNAMENT_ALREADY_STARTED', 409);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(tournamentPlayers).where(eq(tournamentPlayers.tournamentId, id));
    if (body.maxPlayers !== undefined && body.maxPlayers < n) throw new AppError('BELOW_REGISTERED_COUNT', 409);
    await db.update(tournaments).set(body).where(eq(tournaments.id, id));
    await db.insert(auditLog).values({ actorId: admin.id, action: 'tournament.update', entity: 'tournament', entityId: id, data: body });
    return { ok: true };
  });

  app.get('/tournaments', async (req) => {
    await requireUser(req, 'desk');
    return db.select({ tournament: tournaments, players: sql<number>`(SELECT count(*)::int FROM tournament_players tp WHERE tp.tournament_id = tournaments.id)` })
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
    const day = sql<string>`to_char(${payments.verifiedAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
    return db.select({
      day, collected: sql<number>`SUM(GREATEST(${payments.amount}, 0))::int`,
      refunded: sql<number>`(-SUM(LEAST(${payments.amount}, 0)))::int`, net: sql<number>`SUM(${payments.amount})::int`,
    }).from(payments).where(and(eq(payments.status, 'verified'), gte(payments.verifiedAt, from), lt(payments.verifiedAt, to)))
      .groupBy(day).orderBy(day);
  });

  app.get('/users', async (req) => {
    await requireUser(req, 'manager');
    const { q } = parse(z.object({ q: z.string().trim().max(100).default('') }), req.query);
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'; // a typed % or _ matches itself, not "anything"
    return db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, blocked: users.blocked })
      .from(users).where(q ? sql`${users.name} ILIKE ${like} OR ${users.email} ILIKE ${like} OR ${users.phone} ILIKE ${like}` : undefined)
      .orderBy(desc(users.id)).limit(100);
  });

  /** One member's record: profile, booking history with attendance, and points. */
  app.get('/users/:id', async (req) => {
    await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, blocked: users.blocked, joined: users.createdAt })
      .from(users).where(eq(users.id, id));
    if (!user) throw new AppError('USER_NOT_FOUND', 404);
    const history = await db.select({ ref: bookings.ref, status: bookings.status, seats: bookings.seats, amount: bookings.amount, activity: activities.name, startsAt: slots.startsAt })
      .from(bookings).innerJoin(slots, eq(slots.id, bookings.slotId)).innerJoin(activities, eq(activities.id, slots.activityId))
      .where(eq(bookings.userId, id)).orderBy(desc(slots.startsAt)).limit(200);
    const ledger = await db.select().from(points).where(eq(points.userId, id)).orderBy(desc(points.createdAt)).limit(100);
    const [{ total }] = await db.select({ total: sql<number>`COALESCE(SUM(${points.points}), 0)::int` }).from(points).where(eq(points.userId, id));
    return { user, bookings: history, points: { total, ledger } };
  });

  /** Award or deduct points by hand (e.g. a challenge winner). */
  app.post('/users/:id/points', async (req) => {
    const admin = await requireUser(req, 'manager');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ points: z.number().int().min(-1000).max(1000).refine((n) => n !== 0), note: z.string().trim().min(1).max(120) }), req.body);
    await db.insert(points).values({ userId: id, points: body.points, reason: 'adjustment', note: body.note, awardedBy: admin.id });
    await db.insert(auditLog).values({ actorId: admin.id, action: 'points.adjust', entity: 'user', entityId: id, data: body });
    return { ok: true };
  });

  /** Bookings, occupancy, revenue, attendance and repeat customers for a date range. */
  app.get('/reports', async (req) => {
    const user = await requireUser(req, 'manager');
    const { from, to } = parse(range, req.query);
    const r = await report(from, to);
    if (user.role === 'owner') return r;
    // Money figures are for owners; managers see occupancy and attendance only.
    const strip = <T extends object>(rows: T[]) => rows.map(({ revenue: _, ...rest }: any) => rest);
    const { revenue: _, ...totals } = r.totals;
    return { ...r, totals, byActivity: strip(r.byActivity), bySession: strip(r.bySession) };
  });

  /** Who did what: every admin action, sign-in and payment decision. Owners only. */
  app.get('/audit', async (req) => {
    await requireUser(req, 'owner');
    const { entity, actorId, before } = parse(z.object({
      entity: z.string().max(30).optional(), actorId: z.coerce.number().int().positive().optional(), before: z.coerce.number().int().positive().optional(),
    }), req.query);
    return db.select({ id: auditLog.id, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, data: auditLog.data,
      at: auditLog.createdAt, actor: users.name, actorRole: users.role })
      .from(auditLog).innerJoin(users, eq(users.id, auditLog.actorId))
      .where(and(entity ? eq(auditLog.entity, entity) : undefined, actorId ? eq(auditLog.actorId, actorId) : undefined, before ? lt(auditLog.id, before) : undefined))
      .orderBy(desc(auditLog.id)).limit(100);
  });

  app.patch('/users/:id', async (req) => {
    const owner = await requireUser(req, 'owner');
    const { id } = parse(idParam, req.params);
    if (id === owner.id) throw new AppError('CANNOT_CHANGE_SELF'); // stops an owner locking themselves out
    const body = parse(z.object({ role: z.enum(['member', 'desk', 'manager', 'owner']).optional(), blocked: z.boolean().optional() }), req.body);
    await tx(async (t) => {
      // Owners are locked while we change one, so two owners can't remove each other and leave the centre with none.
      const ownersNow = await t.select({ id: users.id, blocked: users.blocked }).from(users).where(eq(users.role, 'owner')).for('update');
      const [target] = await t.select().from(users).where(eq(users.id, id)).for('update');
      if (!target) throw new AppError('USER_NOT_FOUND', 404);
      const losesOwner = target.role === 'owner' && ((body.role && body.role !== 'owner') || body.blocked === true);
      if (losesOwner && ownersNow.filter((o) => !o.blocked && o.id !== id).length === 0) throw new AppError('LAST_OWNER', 409);
      await t.update(users).set(body).where(eq(users.id, id));
      await audit(t, owner.id, 'user.update', 'user', id, { ...body, before: { role: target.role, blocked: target.blocked } });
    });
    // A new role or a block takes effect at once: the person signs in again with their new access (or can't).
    await revokeSessions(id);
    return { ok: true };
  });
}
