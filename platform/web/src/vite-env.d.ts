/// <reference types="vite/client" />

/**
 * Build-time configuration, typed.
 *
 * Every variable here is BUILD-TIME and PUBLIC. Vite inlines `import.meta.env`
 * into the bundle, so a value put here is published to every visitor. Nothing
 * secret may ever be added to this interface — no API key, no signing key, no
 * token. Dudo's secrets are Worker secrets, provisioned by the Team Lead, and
 * they never reach a browser (security.md §5).
 */
interface ImportMetaEnv {
  /**
   * Which transport the application talks to. `fixture` or `http`.
   *
   * There is no default-by-omission that reaches the network: an unset value is
   * `fixture`, and an unrecognised value is a hard start-up failure rather than
   * a silent fall back to either one. See `src/api/config.ts`.
   */
  readonly VITE_DUDO_TRANSPORT?: string;

  /**
   * Origin prefix for the Core API. Empty — the default — means SAME ORIGIN.
   *
   * The contract base paths (`/api/v1`, `/api/v1/apps/customers`) are appended
   * to this, so it is an origin and not a path: `https://dudo-test.example`,
   * never `https://dudo-test.example/api`.
   *
   * SAME ORIGIN IS NOT A PREFERENCE, IT IS A REQUIREMENT of the session design.
   * `platform/core/http/pre-auth-http.ts` issues `dudo_session` with
   * `SameSite=Lax` and sets no CORS credential headers, so a cross-origin API
   * receives no cookie and every authenticated call is refused. `config.ts`
   * refuses to start on a cross-origin value rather than shipping a build that
   * fails one request at a time.
   */
  readonly VITE_DUDO_API_BASE_URL?: string;

  /**
   * Milliseconds before an in-flight API request is abandoned. Default 20000.
   * Optional, and clamped; a malformed value falls back to the default.
   */
  readonly VITE_DUDO_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
