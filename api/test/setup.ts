// Creates a fresh test database with the current schema before the tests run.
import { execSync } from 'node:child_process';
import postgres from 'postgres';

const admin = 'postgres://postgres:localdev@127.0.0.1:5433/postgres';
export const TEST_DB = 'postgres://postgres:localdev@127.0.0.1:5433/findmyhobby_test';

export default async function () {
  const sql = postgres(admin, { onnotice: () => {} });
  await sql`DROP DATABASE IF EXISTS findmyhobby_test WITH (FORCE)`;
  await sql`CREATE DATABASE findmyhobby_test`;
  await sql.end();
  execSync('npx drizzle-kit push --force', { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'ignore' });
}
