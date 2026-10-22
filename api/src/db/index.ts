import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.ts';

// timezone 'Z' keeps every DATETIME in UTC; the app converts to IST only for display.
export const pool = mysql.createPool({ uri: process.env.DATABASE_URL, timezone: 'Z', connectionLimit: 10 });
export const db = drizzle(pool, { schema, mode: 'default' });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
