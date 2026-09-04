import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration — ADR 0016.
 *
 * The output is plain static files served by Cloudflare Workers Static Assets.
 * Requests for those assets are free and unlimited: they do not invoke the
 * Worker, consume no CPU, and do not count against the 100,000 requests/day
 * allowance. The Worker handles the API and nothing else.
 *
 * `run_worker_first` MUST NOT be enabled for asset routes. It converts free,
 * unlimited asset requests into billed Worker invocations under a daily cap,
 * and past that cap they return 429 rather than falling back to serving the
 * asset — a self-inflicted outage with no upside. That setting lives in
 * wrangler configuration, which is the Team Lead's file, and this note is here
 * so the constraint travels with the build that depends on it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Static assets are free; a stable, hashed filename set is what makes them
    // cacheable indefinitely.
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
