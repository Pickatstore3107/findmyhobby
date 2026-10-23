// All times are stored in UTC; all money is stored in paise (₹1 = 100) to avoid decimal errors.
import { sql } from 'drizzle-orm';
import {
  mysqlTable, int, tinyint, varchar, datetime, mysqlEnum, json, boolean,
  index, uniqueIndex, check,
} from 'drizzle-orm/mysql-core';

const id = () => int('id').autoincrement().primaryKey();
const createdAt = () => datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = mysqlTable('users', {
  id: id(),
  googleSub: varchar('google_sub', { length: 64 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 15 }),
  avatarKey: varchar('avatar_key', { length: 255 }), // S3 key, not a full URL
  role: mysqlEnum('role', ['member', 'desk', 'manager', 'owner']).notNull().default('member'),
  blocked: boolean('blocked').notNull().default(false),
  createdAt: createdAt(),
});

// Login sessions. Only a SHA-256 hash of the token is stored, so a database leak can't be used to log in.
export const sessions = mysqlTable('sessions', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: int('user_id').notNull().references(() => users.id),
  expiresAt: datetime('expires_at').notNull(),
}, (t) => [index('sessions_user').on(t.userId)]);

// Physical areas of the venue (Zone A Play, Zone B Move…). Only one slot per zone at a time.
export const zones = mysqlTable('zones', {
  id: id(),
  name: varchar('name', { length: 50 }).notNull().unique(),
});

// What members see on Home: Play, Move, Create, Express, Learn.
export const categories = mysqlTable('categories', {
  id: id(),
  name: varchar('name', { length: 30 }).notNull().unique(),
  emoji: varchar('emoji', { length: 8 }).notNull(),
  sort: tinyint('sort').notNull().default(0),
});

export const activities = mysqlTable('activities', {
  id: id(),
  name: varchar('name', { length: 60 }).notNull().unique(),
  categoryId: int('category_id').notNull().references(() => categories.id),
  imageKey: varchar('image_key', { length: 255 }),
  defaultPrice: int('default_price').notNull(),
  defaultCapacity: tinyint('default_capacity').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [check('activity_capacity', sql`${t.defaultCapacity} BETWEEN 1 AND 30`)]);

export const slots = mysqlTable('slots', {
  id: id(),
  activityId: int('activity_id').notNull().references(() => activities.id),
  zoneId: int('zone_id').notNull().references(() => zones.id),
  startsAt: datetime('starts_at').notNull(),
  endsAt: datetime('ends_at').notNull(),
  price: int('price').notNull(),
  capacity: tinyint('capacity').notNull(),
  bookedSeats: tinyint('booked_seats').notNull().default(0),
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

export const bookings = mysqlTable('bookings', {
  id: id(),
  ref: varchar('ref', { length: 12 }).notNull().unique(), // shown to users, e.g. FMH-4K9P2X
  slotId: int('slot_id').notNull().references(() => slots.id),
  userId: int('user_id').notNull().references(() => users.id),
  seats: tinyint('seats').notNull(),
  amount: int('amount').notNull(),
  status: mysqlEnum('status', ['pending', 'confirmed', 'checked_in', 'cancelled', 'no_show', 'expired']).notNull(),
  method: mysqlEnum('method', ['upi', 'venue', 'gateway']).notNull().default('upi'), // how the member chose to pay
  holdUntil: datetime('hold_until'), // unpaid UPI bookings release their seats after this
  idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().unique(), // network retries can't double-book
  // Non-null only while the booking is active, so a user holds at most one active booking per slot.
  activeUserId: int('active_user_id').generatedAlwaysAs(
    sql`IF(status IN ('pending','confirmed','checked_in'), user_id, NULL)`, { mode: 'stored' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('one_active_booking_per_slot').on(t.slotId, t.activeUserId),
  index('bookings_user').on(t.userId, t.createdAt),
  index('bookings_hold').on(t.status, t.holdUntil),
  check('booking_seats', sql`${t.seats} BETWEEN 1 AND 3`),
]);

// Append-only money ledger: refunds are new negative rows, never edits.
export const payments = mysqlTable('payments', {
  id: id(),
  bookingId: int('booking_id').references(() => bookings.id),
  tournamentPlayerId: int('tournament_player_id'),
  method: mysqlEnum('method', ['upi', 'venue', 'gateway']).notNull(),
  amount: int('amount').notNull(), // negative = refund
  utr: varchar('utr', { length: 22 }).unique(), // a UPI reference can be claimed only once
  gatewayOrderId: varchar('gateway_order_id', { length: 40 }).unique(),     // Razorpay order_…
  gatewayPaymentId: varchar('gateway_payment_id', { length: 40 }).unique(), // Razorpay pay_… (one payment confirms once)
  status: mysqlEnum('status', ['pending', 'verified', 'rejected']).notNull(),
  verifiedBy: int('verified_by').references(() => users.id),
  verifiedAt: datetime('verified_at'),
  createdAt: createdAt(),
}, (t) => [index('payments_status').on(t.status, t.createdAt)]);

export const tournaments = mysqlTable('tournaments', {
  id: id(),
  title: varchar('title', { length: 80 }).notNull(),
  activityId: int('activity_id').notNull().references(() => activities.id),
  startsAt: datetime('starts_at').notNull(),
  entryFee: int('entry_fee').notNull().default(0),
  maxPlayers: tinyint('max_players').notNull(),
  bannerKey: varchar('banner_key', { length: 255 }),
  status: mysqlEnum('status', ['draft', 'open', 'closed', 'live', 'finished']).notNull().default('draft'),
}, (t) => [check('tournament_players', sql`${t.maxPlayers} BETWEEN 2 AND 30`)]);

export const tournamentPlayers = mysqlTable('tournament_players', {
  id: id(),
  tournamentId: int('tournament_id').notNull().references(() => tournaments.id),
  userId: int('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('one_entry_per_user').on(t.tournamentId, t.userId)]);

// Knockout bracket. A winner of (round, position) advances to (round + 1, position / 2),
// so no "next match" pointers are needed. A null opponent in round 1 is a bye.
export const matches = mysqlTable('matches', {
  id: id(),
  tournamentId: int('tournament_id').notNull().references(() => tournaments.id),
  round: tinyint('round').notNull(),
  position: tinyint('position').notNull(),
  player1Id: int('player1_id').references(() => tournamentPlayers.id),
  player2Id: int('player2_id').references(() => tournamentPlayers.id),
  winnerId: int('winner_id').references(() => tournamentPlayers.id),
}, (t) => [uniqueIndex('match_slot').on(t.tournamentId, t.round, t.position)]);

// Every admin action is recorded: who did what, to what, and when.
export const auditLog = mysqlTable('audit_log', {
  id: id(),
  actorId: int('actor_id').notNull().references(() => users.id),
  action: varchar('action', { length: 40 }).notNull(),
  entity: varchar('entity', { length: 30 }).notNull(),
  entityId: int('entity_id').notNull(),
  data: json('data'),
  createdAt: createdAt(),
}, (t) => [index('audit_entity').on(t.entity, t.entityId)]);
