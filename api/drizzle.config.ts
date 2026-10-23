import { defineConfig } from 'drizzle-kit';
import awsCaBundle from 'aws-ssl-profiles';

// Local development: `pnpm db:push` syncs the schema directly.
// Production: `pnpm db:generate` records each change as a SQL migration in ./drizzle, and `pnpm db:migrate` applies them in order.
const url = new URL(process.env.DATABASE_URL!);
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: url.hostname, port: Number(url.port || 3306), database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ...(process.env.DB_SSL === 'rds' && { ssl: { ...awsCaBundle, rejectUnauthorized: true } }),
  },
});
