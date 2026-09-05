/// <reference types="vite/client" />

/**
 * The build-time variables this console reads, declared so `config.ts` can be
 * type-checked against a closed set rather than an index signature.
 *
 * THEY ARE PREFIXED `VITE_DUDO_ADMIN_` RATHER THAN `VITE_DUDO_`, so that a
 * `.env` intended for `platform/web` cannot silently configure this console.
 * The two clients are deployed to different hostnames with different sessions
 * (`docs/decisions/0022`) and share no configuration.
 *
 * THERE IS NO TRANSPORT VARIABLE HERE AND THERE MUST NOT BE ONE. See
 * `api/config.ts`: this console has no fixture mode, because ADR 0010 removed
 * fake APIs and placeholder data from the adoption with the reason that an
 * operator cannot tell fabricated data from real.
 *
 * NO SECRET IS EVER READ THROUGH THIS INTERFACE. Everything Vite substitutes at
 * build time is embedded in the JavaScript bundle and is therefore public.
 */
interface ImportMetaEnv {
  /** An origin, or empty for same origin. A cross-origin value is refused. */
  readonly VITE_DUDO_ADMIN_API_BASE_URL?: string;
  /** Milliseconds. Clamped to 1,000-120,000. */
  readonly VITE_DUDO_ADMIN_API_TIMEOUT_MS?: string;
  /** A human label for the build, shown in the header. Not a version number. */
  readonly VITE_DUDO_ADMIN_BUILD_LABEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
