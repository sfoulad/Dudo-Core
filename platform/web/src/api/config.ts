/**
 * Build-time configuration, resolved once and validated loudly.
 *
 * ===========================================================================
 * THE CHOICE BETWEEN FIXTURE AND NETWORK IS EXPLICIT, NEVER ACCIDENTAL
 * ===========================================================================
 *
 * There are exactly two transports and one variable that selects between them.
 * The rules this file exists to enforce:
 *
 *   - AN UNSET VALUE IS `fixture`. A build that was never configured must not
 *     reach the network; it must demonstrate the UI with no backend, which is
 *     what the fixture transport is for.
 *   - AN UNRECOGNISED VALUE IS A HARD FAILURE. `VITE_DUDO_TRANSPORT=htpp` must
 *     not quietly become `fixture` — that is the shape of a release that
 *     everyone believes is live and is not, and it is exactly the class of
 *     overstatement `.claude/rules/workflow.md` §11 forbids.
 *   - THE ANSWER IS VISIBLE IN THE RUNNING APPLICATION. `AppShell` renders the
 *     transport name in the header. A person looking at a screenshot can tell
 *     whether they are looking at real data.
 *
 * ===========================================================================
 * WHY A CROSS-ORIGIN API BASE IS REFUSED RATHER THAN WARNED ABOUT
 * ===========================================================================
 *
 * The session credential is a cookie Core sets with `HttpOnly; Secure;
 * SameSite=Lax; Path=/` (`platform/core/http/pre-auth-http.ts`), and Core sets no
 * `Access-Control-Allow-Credentials`. A browser therefore will not attach that
 * cookie to a cross-origin request, and will not expose the `Set-Cookie` from
 * one either. A build pointed at another origin would log in "successfully" and
 * then be refused on every subsequent call, with nothing in the UI to say why.
 *
 * That is a configuration mistake that costs a day to diagnose and one line to
 * prevent, so it is prevented: a cross-origin value throws at module load, with
 * the reason in the message. If a deployment genuinely needs a separate API
 * origin, that is a CORS and cookie-attribute decision in Core and a Team Lead
 * question — not something a client flag may paper over.
 */

export type TransportName = 'fixture' | 'http';

export class WebConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebConfigurationError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

function readTransport(raw: string | undefined): TransportName {
  const value = (raw ?? '').trim();
  if (value === '') return 'fixture';
  if (value === 'fixture' || value === 'http') return value;
  throw new WebConfigurationError(
    `VITE_DUDO_TRANSPORT is "${value}", which is not one of "fixture" or "http". This build ` +
      'refuses to start rather than fall back, because a typo that silently selects the fixture ' +
      'transport produces a release everyone believes is live and is not.',
  );
}

/**
 * Normalises the API origin and refuses a cross-origin one.
 *
 * Returns `''` for same origin, which is what every path in this client is then
 * prefixed with — so same origin costs no string work and no branch.
 */
function readApiBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (value === '') return '';

  // `window` is absent under Node (the KDF verification script imports nothing
  // from here, but a future test runner might), in which case there is no
  // origin to compare against and the value is taken as given.
  if (typeof window === 'undefined') return value;

  let parsed: URL;
  try {
    parsed = new URL(value, window.location.origin);
  } catch {
    throw new WebConfigurationError(
      `VITE_DUDO_API_BASE_URL is "${value}", which is not a URL. It must be an origin such as ` +
        'https://dudo-test.example, or empty for same origin.',
    );
  }
  if (parsed.origin !== window.location.origin) {
    throw new WebConfigurationError(
      `VITE_DUDO_API_BASE_URL points at ${parsed.origin}, which is not this page's origin ` +
        `(${window.location.origin}). Core issues the session as a SameSite=Lax cookie and sets ` +
        'no CORS credential headers, so a cross-origin API receives no cookie: login would ' +
        'appear to succeed and every call after it would be refused. Serve the application and ' +
        'the API from one origin, or raise the CORS and cookie-attribute question with the Team ' +
        'Lead. This is not a client flag to override.',
    );
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new WebConfigurationError(
      `VITE_DUDO_API_BASE_URL is "${value}", which carries a path. The contracts supply their ` +
        'own base paths (/api/v1 and /api/v1/apps/customers) and they are appended to this ' +
        'value, so a path here produces /api/api/v1/... Give an origin only.',
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
 * How many Organizations the FIXTURE build offers. Ignored entirely when the
 * transport is `http`.
 *
 * It exists because the Organization picker was shipped unbuilt once already,
 * and the reason it was missed is that nothing local could reach it: every
 * check of that flow was performed by hand against a deployment. `1` exercises
 * the auto-select path where no picker is drawn, `2` or more exercises the
 * picker itself, and both are one build flag apart.
 */
const DEFAULT_FIXTURE_ORGANIZATIONS = 1;
const MAX_FIXTURE_ORGANIZATIONS = 20;

function readFixtureOrganizations(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_FIXTURE_ORGANIZATIONS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_FIXTURE_ORGANIZATIONS;
  return Math.min(MAX_FIXTURE_ORGANIZATIONS, parsed);
}

export interface WebConfig {
  readonly transport: TransportName;
  /** `''` means same origin. Never carries a trailing slash and never a path. */
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  /** Fixture builds only. `0` renders the "no memberships" state. */
  readonly fixtureOrganizations: number;
}

/**
 * Reads a build-time variable, tolerating the absence of `import.meta.env`.
 *
 * Vite defines `import.meta.env` in every build it produces, so in the browser
 * this is always present. It is absent under bare Node, which is where the
 * verification scripts run — and a `TypeError` on import there would make this
 * module, and everything that imports it, untestable without a framework nobody
 * has approved yet. The fallback is `undefined`, which every reader above
 * already treats as "not configured".
 */
function env(name: keyof ImportMetaEnv): string | undefined {
  const source = import.meta.env as ImportMetaEnv | undefined;
  return source?.[name];
}

export const CONFIG: WebConfig = Object.freeze({
  transport: readTransport(env('VITE_DUDO_TRANSPORT')),
  apiBaseUrl: readApiBaseUrl(env('VITE_DUDO_API_BASE_URL')),
  requestTimeoutMs: readTimeoutMs(env('VITE_DUDO_API_TIMEOUT_MS')),
  fixtureOrganizations: readFixtureOrganizations(env('VITE_DUDO_FIXTURE_ORGANIZATIONS')),
});

/**
 * What the header badge says. Deliberately blunt in both directions: a fixture
 * build must never be mistaken for a live one, and a live build must never be
 * mistaken for a demonstration.
 */
export function transportBadge(): { label: string; live: boolean } {
  return CONFIG.transport === 'http'
    ? { label: 'Live API', live: true }
    : { label: 'Fixture data', live: false };
}
