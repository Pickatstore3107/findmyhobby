import { defineConfig } from 'vitest/config';

const url = 'mysql://root:localdev@127.0.0.1:3307/findmyhobby_test';
export default defineConfig({
  test: { env: { DATABASE_URL: url }, globalSetup: './test/setup.ts', fileParallelism: false, testTimeout: 30_000 },
});
