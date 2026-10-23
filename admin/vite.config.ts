import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin lives at /console/ and talks to the API at /api (in development, proxied to the local API server).
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  server: { port: 5180, proxy: { '/api': { target: 'http://127.0.0.1:4000', rewrite: (p) => p.replace(/^\/api/, '') } } },
});
