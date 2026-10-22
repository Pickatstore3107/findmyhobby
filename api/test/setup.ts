// Creates a fresh test database with the current schema before the tests run.
import { execSync } from 'node:child_process';
import mysql from 'mysql2/promise';

export default async function () {
  const conn = await mysql.createConnection('mysql://root:localdev@127.0.0.1:3307');
  await conn.query('DROP DATABASE IF EXISTS findmyhobby_test');
  await conn.query('CREATE DATABASE findmyhobby_test');
  await conn.end();
  execSync('npx drizzle-kit push --force', {
    env: { ...process.env, DATABASE_URL: 'mysql://root:localdev@127.0.0.1:3307/findmyhobby_test' }, stdio: 'ignore',
  });
}
