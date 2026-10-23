import { defineConfig } from 'drizzle-kit';

// Local development: `pnpm db:push` syncs the schema directly.
// Production: `pnpm db:generate` records each change as a SQL migration in ./drizzle, and `pnpm db:migrate` applies them in order.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL!, ssl: process.env.DB_SSL === 'require' ? 'require' : undefined },
});
