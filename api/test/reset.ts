// Each test file starts from an empty database, so no file depends on what another left behind.
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';

export const resetDb = () => db.execute(sql`TRUNCATE users, sessions, categories, hosts, activities, slots, bookings, payments,
  tournaments, tournament_players, matches, points, audit_log RESTART IDENTITY CASCADE`);
