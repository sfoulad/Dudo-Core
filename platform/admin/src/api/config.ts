/**
 * Build-time configuration, resolved once and validated loudly.
 *
 * ===========================================================================
 * THERE IS NO FIXTURE TRANSPORT IN THIS CONSOLE, AND THAT IS THE DECISION
 * ===========================================================================
 *
 * `platform/web` has two transports — `fixture` and `http` — selected by
 * `VITE_DUDO_TRANSPORT`. THIS CONSOLE HAS ONE. It talks to Core or it shows a
 * failure; there is no build of it that answers its own questions.
 *
 * ADR 0010's adoption audit removed "`@faker-js/faker`, demo users, fake APIs,
 * placeholder data" from the template with the reason stated in full:
 *
 *   "Dudo shows Core-backed truth only. FABRICATED DATA IN AN ADMIN CONSOLE IS
 *    WORSE THAN NO DATA — an operator cannot tell it from real."
 *
 * A fixture transport is a fake API by another name. The customer application
 * can carry one because its fixture screens show a fictional customer directory
 * that nobody would act on; a console whose purpose is to enumerate real
 * Organizations and reset real credentials cannot, because the whole risk is an
 * operator taking an irreversible action against something that was not there.
 *
 * THE COST IS REAL AND IS ACCEPTED: this console cannot be demonstrated without
 * Core running on the same origin. `npm run dev` renders the sign-in screen and
 * then fails honestly against a `/auth/login/complete` that is not being served.
 * That is the correct failure. See README.md.
 *
 * ===========================================================================
 * WHY A CROSS-ORIGIN API BASE IS REFUSED RATHER THAN WARNED ABOUT
 * ===========================================================================
 *
 * `docs/decisions/0022`: the session credential is a cookie Core sets with
 * `HttpOnly; Secure; SameSite=Lax; Path=/` and NO `Domain` attribute, and Core
 * sets no `Access-Control-Allow-Credentials`. A cookie with no `Domain` is sent
 * only to the exact host that set it. So `admin.dudo.work` serves its own API on
 * its own origin, and a build pointed at another origin would appear to log in
 * and then be refused on every call after it, with nothing in the UI to say why.
 *
 * 0022 also considered and REJECTED both ways of making a split work — adding
 * `Domain=dudo.work` (which broadens a session credential to every subdomain
 * that exists or ever will) and CORS with credentials. Neither is a client flag
 * to override, so this file refuses at module load rather than warning.
 *
 * THE SEPARATE SESSION IS A FEATURE, NOT AN INCONVENIENCE. 0022: "a user signed
 * into app.dudo.work is NOT signed into admin.dudo.work. That is the correct
 * outcome: administrative access should be authenticated separately, not
 * inherited from an ordinary session that happens to be open in another tab."
 */

export class AdminConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminConfigurationError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Normalises the API origin and refuses a cross-origin one.
 *
 * Returns `''` for same origin, which is what every path in this console is then
 * prefixed with — so same origin costs no string work and no branch.
 */
function readApiBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';

  // `window` is absent under Node, where the verification script runs. There is
  // no origin to compare against there, so the value is taken as given.
  if (typeof window === 'undefined') return value;

  let parsed: URL;
  try {
    parsed = new URL(value, window.location.origin);
  } catch {
    throw new AdminConfigurationError(
      `VITE_DUDO_ADMIN_API_BASE_URL is "${value}", which is not a URL. It must be an origin such ` +
        'as https://admin-test.example, or empty for same origin.',
    );
  }
  if (parsed.origin !== window.location.origin) {
    throw new AdminConfigurationError(
      `VITE_DUDO_ADMIN_API_BASE_URL points at ${parsed.origin}, which is not this page's origin ` +
        `(${window.location.origin}). ADR 0022 gives admin.dudo.work a host-only cookie session ` +
        'and Core sets no CORS credential headers, so a cross-origin API receives no cookie: ' +
        'sign-in would appear to succeed and every call after it would be refused. Serve the ' +
        'console and its API from one origin. This is not a client flag to override.',
    );
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new AdminConfigurationError(
      `VITE_DUDO_ADMIN_API_BASE_URL is "${value}", which carries a path. The contracts supply ` +
        'their own base paths (/auth and /api/v1/platform) and they are appended to this value, ' +
        'so a path here produces /api/api/v1/... Give an origin only.',
    );
  }
  return parsed.origin === window.location.origin ? '' : parsed.origin;
}

function readTimeoutMs(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

/**
 * A label for the running build, shown in the header.
 *
 * IT IS NOT A VERSION NUMBER AND MUST NOT BE READ AS ONE. It exists so a person
 * looking at a screenshot of a test deployment can say which build it was. The
 * Team Lead sets it at release time; unset, it says so rather than inventing a
 * value.
 */
function readBuildLabel(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value === '' ? 'unlabelled build' : value;
}

export interface AdminConfig {
  /** `''` means same origin. Never carries a trailing slash and never a path. */
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly buildLabel: string;
}

/**
 * Reads a build-time variable, tolerating the absence of `import.meta.env`.
 *
 * Vite defines `import.meta.env` in every build it produces, so in the browser
 * this is always present. It is absent under bare Node, which is where the
 * verification script runs — and a `TypeError` on import there would make this
 * module, and everything that imports it, untestable without a framework nobody
 * has approved yet.
 */
function env(name: keyof ImportMetaEnv): string | undefined {
  const source = import.meta.env as ImportMetaEnv | undefined;
  return source?.[name];
}

export const CONFIG: AdminConfig = Object.freeze({
  apiBaseUrl: readApiBaseUrl(env('VITE_DUDO_ADMIN_API_BASE_URL')),
  requestTimeoutMs: readTimeoutMs(env('VITE_DUDO_ADMIN_API_TIMEOUT_MS')),
  buildLabel: readBuildLabel(env('VITE_DUDO_ADMIN_BUILD_LABEL')),
});
