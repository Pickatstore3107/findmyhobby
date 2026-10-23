import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

// Supabase connections are encrypted. With DB_CA (Supabase's CA certificate, PEM) the server's identity is also verified.
const ssl = process.env.DB_CA ? { ca: process.env.DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }
  : process.env.DB_SSL === 'require' ? 'require' as const : false;

// prepare: false keeps it compatible with Supabase's connection pooler.
export const client = postgres(process.env.DATABASE_URL!, { max: 10, prepare: false, ssl });
export const db = drizzle(client, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
