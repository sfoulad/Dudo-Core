import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite configuration for the platform-administration console — ADR 0010, 0022.
 *
 * The output is plain static files. `0022` puts `admin.dudo.work` on the same
 * Worker as `app.dudo.work`, routed by hostname, so the same asset rules from
 * `0016` apply unchanged: asset requests are free and unlimited, they do not
 * invoke the Worker, and `run_worker_first` MUST NOT be enabled for them —
 * enabling it converts free asset requests into billed Worker invocations under
 * a daily cap, and past that cap they 429 rather than falling back. That
 * setting lives in wrangler configuration, which is the Team Lead's file; the
 * note is repeated here so the constraint travels with the build that depends
 * on it.
 *
 * THE DEV PORT IS 5174, NOT 5173. `platform/web` holds 5173. Two clients that
 * fight over one port is a five-minute confusion every time both are running,
 * and separating them costs one line.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
});
