import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Keeps the fixtures out of a build that talks to Core.
 *
 * ===========================================================================
 * "NO FIXTURE FALLBACK IN THE DEPLOYED BUILD" — USER INSTRUCTION, AND IT
 * CANNOT BE SATISFIED BY A RUNTIME CHECK
 * ===========================================================================
 *
 * `lib/clients.ts` picks the transport with a ternary. **A ternary chooses at
 * run time and the bundler links at build time**, so the fixture module was in
 * the artifact whichever way the ternary went.
 *
 * **Measured on an http production bundle before this plugin existed: three
 * fixture Business identifiers and thirty-five fixture customer records.**
 *
 * So the exclusion happens at RESOLUTION. When the transport is `http`, the two
 * fixture modules resolve to `src/api/fixture-absent.ts`, whose every export
 * throws — and `fixtures.ts`, reachable only through them, leaves with them.
 * **They are not in the module graph, so there is nothing to tree-shake and
 * nothing to get wrong.**
 *
 * ⚠ **`enforce: 'pre'` IS LOAD-BEARING.** Without it Vite's own alias plugin
 * resolves `@/api/fixture-transport` to an absolute path first and this hook
 * never sees a specifier it recognises. The pattern below matches the resolved
 * path as well as the bare specifier for the same reason — belt and braces on a
 * hook whose failure mode is silent inclusion.
 *
 * ⚠ **AND IT MATCHES `fixture-transport` AND `fixture-session-state` ONLY.** It
 * deliberately does not match `fixtures`, because a path-fragment match wide
 * enough to catch that would also catch any future module with `fixture` in its
 * name — and a resolver that silently redirects a module nobody meant is a
 * worse failure than the one this prevents. `fixtures.ts` is unreachable once
 * its only importer is gone, which is the structural answer rather than a
 * second pattern.
 *
 * `tsc` never sees any of this: type checking runs against the real modules, so
 * every call site stays fully checked.
 */
function excludeFixtures(active: boolean): Plugin {
  const ABSENT = fileURLToPath(new URL('./src/api/fixture-absent.ts', import.meta.url));
  const FIXTURE_MODULE = /(^|\/)fixture-(transport|session-state)(\.ts)?$/u;

  return {
    name: 'dudo-exclude-fixtures',
    enforce: 'pre',
    resolveId(source) {
      if (!active) return null;
      if (source.endsWith('fixture-absent.ts')) return null;
      return FIXTURE_MODULE.test(source) ? ABSENT : null;
    },
  };
}

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
export default defineConfig(({ mode }) => {
  /*
   * `loadEnv` RATHER THAN `process.env`, so a value set in a `.env` file is
   * honoured exactly as `api/config.ts` will honour it at runtime. Reading
   * `process.env` alone would exclude the fixtures for a shell-set variable and
   * include them for a file-set one — two builds that disagree about what they
   * contain, from one flag.
   *
   * The third argument is `''` so no prefix filter applies: `VITE_` is Vite's
   * client-exposure prefix, not a namespace this lookup should depend on.
   */
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const isHttpBuild = (env['VITE_DUDO_TRANSPORT'] ?? '').trim() === 'http';

  return {
  plugins: [excludeFixtures(isHttpBuild), react(), tailwindcss()],
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
  };
});
