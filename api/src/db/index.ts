import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import awsCaBundle from 'aws-ssl-profiles';
import * as schema from './schema.ts';

// timezone 'Z' keeps every DATETIME in UTC; the app converts to IST only for display.
// On AWS (DB_SSL=rds) the connection is encrypted and the server certificate is checked against Amazon's RDS authorities.
export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL, timezone: 'Z', connectionLimit: 10,
  ...(process.env.DB_SSL === 'rds' && { ssl: { ...awsCaBundle, rejectUnauthorized: true } }),
});
export const db = drizzle(pool, { schema, mode: 'default' });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
