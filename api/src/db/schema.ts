// PostgreSQL (Supabase). Times are stored as timestamptz; money is stored in paise (₹1 = 100) to avoid decimal errors.
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, integer, smallint, varchar, timestamp, boolean, jsonb,
  index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';

const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const time = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => time('created_at').notNull().defaultNow();

export const roleEnum = pgEnum('role', ['member', 'desk', 'manager', 'owner']);
export const bookingStatus = pgEnum('booking_status', ['pending', 'confirmed', 'checked_in', 'cancelled', 'no_show', 'expired']);
export const payMethod = pgEnum('pay_method', ['upi', 'venue', 'gateway']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'verified', 'rejected']);
export const tournamentStatus = pgEnum('tournament_status', ['draft', 'open', 'closed', 'live', 'finished']);

export const users = pgTable('users', {
  id: id(),
  googleSub: varchar('google_sub', { length: 64 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 15 }),
  avatarKey: varchar('avatar_key', { length: 255 }), // storage key, not a full URL
  role: roleEnum('role').notNull().default('member'),
  blocked: boolean('blocked').notNull().default(false),
  createdAt: createdAt(),
});

// Login sessions. Only a SHA-256 hash of the token is stored, so a database leak can't be used to log in.
export const sessions = pgTable('sessions', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  expiresAt: time('expires_at').notNull(),
}, (t) => [index('sessions_user').on(t.userId)]);

// Physical areas of the venue (Zone A Play, Zone B Move…). Only one slot per zone at a time.
export const zones = pgTable('zones', {
  id: id(),
  name: varchar('name', { length: 50 }).notNull().unique(),
});

// What members see on Home: Play, Move, Create, Express, Learn.
export const categories = pgTable('categories', {
  id: id(),
  name: varchar('name', { length: 30 }).notNull().unique(),
  emoji: varchar('emoji', { length: 8 }).notNull(),
  sort: smallint('sort').notNull().default(0),
});

export const activities = pgTable('activities', {
  id: id(),
  name: varchar('name', { length: 60 }).notNull().unique(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  imageKey: varchar('image_key', { length: 255 }),
  defaultPrice: integer('default_price').notNull(),
  defaultCapacity: smallint('default_capacity').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [check('activity_capacity', sql`${t.defaultCapacity} BETWEEN 1 AND 30`)]);

export const slots = pgTable('slots', {
  id: id(),
  activityId: integer('activity_id').notNull().references(() => activities.id),
  zoneId: integer('zone_id').notNull().references(() => zones.id),
  startsAt: time('starts_at').notNull(),
  endsAt: time('ends_at').notNull(),
  price: integer('price').notNull(),
  capacity: smallint('capacity').notNull(),
  bookedSeats: smallint('booked_seats').notNull().default(0),
  hostName: varchar('host_name', { length: 60 }),
  cancelled: boolean('cancelled').notNull().default(false),
}, (t) => [
  index('slots_zone_time').on(t.zoneId, t.startsAt),
  index('slots_time').on(t.startsAt),
  // The database itself refuses overbooking, even if application code has a bug.
  check('slot_capacity', sql`${t.capacity} BETWEEN 1 AND 30 AND ${t.bookedSeats} BETWEEN 0 AND ${t.capacity}`),
  check('slot_times', sql`${t.endsAt} > ${t.startsAt}`),
  check('slot_price', sql`${t.price} >= 0`),
]);

export const bookings = pgTable('bookings', {
  id: id(),
  ref: varchar('ref', { length: 12 }).notNull().unique(), // shown to users, e.g. FMH-4K9P2X
  slotId: integer('slot_id').notNull().references(() => slots.id),
  userId: integer('user_id').notNull().references(() => users.id),
  seats: smallint('seats').notNull(),
  amount: integer('amount').notNull(),
  status: bookingStatus('status').notNull(),
  method: payMethod('method').notNull().default('upi'), // how the member chose to pay
  holdUntil: time('hold_until'), // unpaid bookings release their seats after this
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().unique(), // network retries can't double-book
  createdAt: createdAt(),
}, (t) => [
  // A member holds at most one active booking per slot (cancelled and expired ones don't count).
  uniqueIndex('one_active_booking_per_slot').on(t.slotId, t.userId).where(sql`${t.status} IN ('pending', 'confirmed', 'checked_in')`),
  index('bookings_user').on(t.userId, t.createdAt),
  index('bookings_hold').on(t.status, t.holdUntil),
  check('booking_seats', sql`${t.seats} BETWEEN 1 AND 3`),
]);

// Append-only money ledger: refunds are new negative rows, never edits.
export const payments = pgTable('payments', {
  id: id(),
  bookingId: integer('booking_id').references(() => bookings.id),
  tournamentPlayerId: integer('tournament_player_id'),
  method: payMethod('method').notNull(),
  amount: integer('amount').notNull(), // negative = refund
  utr: varchar('utr', { length: 22 }).unique(), // a UPI reference can be claimed only once
  gatewayOrderId: varchar('gateway_order_id', { length: 40 }).unique(),     // Razorpay order_…
  gatewayPaymentId: varchar('gateway_payment_id', { length: 40 }).unique(), // Razorpay pay_… (one payment confirms once)
  status: paymentStatus('status').notNull(),
  verifiedBy: integer('verified_by').references(() => users.id),
  verifiedAt: time('verified_at'),
  createdAt: createdAt(),
}, (t) => [index('payments_status').on(t.status, t.createdAt)]);

export const tournaments = pgTable('tournaments', {
  id: id(),
  title: varchar('title', { length: 80 }).notNull(),
  activityId: integer('activity_id').notNull().references(() => activities.id),
  startsAt: time('starts_at').notNull(),
  entryFee: integer('entry_fee').notNull().default(0),
  maxPlayers: smallint('max_players').notNull(),
  bannerKey: varchar('banner_key', { length: 255 }),
  status: tournamentStatus('status').notNull().default('draft'),
}, (t) => [check('tournament_players', sql`${t.maxPlayers} BETWEEN 2 AND 30`)]);

export const tournamentPlayers = pgTable('tournament_players', {
  id: id(),
  tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('one_entry_per_user').on(t.tournamentId, t.userId)]);

// Knockout bracket. A winner of (round, position) advances to (round + 1, position / 2),
// so no "next match" pointers are needed. A null opponent in round 1 is a bye.
export const matches = pgTable('matches', {
  id: id(),
  tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
  round: smallint('round').notNull(),
  position: smallint('position').notNull(),
  player1Id: integer('player1_id').references(() => tournamentPlayers.id),
  player2Id: integer('player2_id').references(() => tournamentPlayers.id),
  winnerId: integer('winner_id').references(() => tournamentPlayers.id),
}, (t) => [uniqueIndex('match_slot').on(t.tournamentId, t.round, t.position)]);

// Every admin action is recorded: who did what, to what, and when.
export const auditLog = pgTable('audit_log', {
  id: id(),
  actorId: integer('actor_id').notNull().references(() => users.id),
  action: varchar('action', { length: 40 }).notNull(),
  entity: varchar('entity', { length: 30 }).notNull(),
  entityId: integer('entity_id').notNull(),
  data: jsonb('data'),
  createdAt: createdAt(),
}, (t) => [index('audit_entity').on(t.entity, t.entityId)]);
