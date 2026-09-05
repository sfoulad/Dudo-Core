/**
 * Operator sign-in and sign-out.
 *
 * ===========================================================================
 * THIS IS `login-v1`, UNCHANGED. THERE IS NO OPERATOR LOGIN PATH.
 * ===========================================================================
 *
 * `packages/contracts/core/platform/platform-operator-v1.contract.yaml`,
 * `authentication.mechanism`:
 *
 *   "UNCHANGED FROM EVERY OTHER PRINCIPAL. An operator logs in through login-v1's
 *    existing pre-authentication entry points, with a credential in
 *    principal_credential, and receives an ordinary session. THIS CONTRACT
 *    INTRODUCES NO SECOND LOGIN PATH, NO SECOND CREDENTIAL FORMAT AND NO SECOND
 *    SESSION SHAPE, and it must not: a parallel authentication path for the most
 *    privileged principals is a second implementation of the hardest code in the
 *    platform."
 *
 * So the wire shape here is byte-for-byte the shape `platform/web` posts:
 *
 *   POST /auth/login/complete
 *   Content-Type: application/json
 *   { "email": "<normalised address>", "derived_key": "<43 base64url chars>" }
 *
 * Success is `200 {"status":"ok"}` with a `Set-Cookie`, and THE BODY CARRIES NO
 * TOKEN. Failure is `401` with the fixed `unauthenticated` envelope: no "account
 * not found", no "wrong password", no lockout notice, and no field any of them
 * could be written into. Core renders one fixed body for every outcome because a
 * body that varied in length would itself be a disclosure channel.
 *
 * `identity.login.start` IS NOT CALLED. Login is single-step. The entry point is
 * registered and reachable but `disclosure: 'collapsed'` — it answers the same
 * constant to every input — and ADR 0015 §D salts the client KDF with the
 * normalised email, so there is no challenge, nonce or per-user salt to fetch.
 *
 * ===========================================================================
 * THE COOKIE IS HOST-ONLY, AND ON THIS HOST THAT IS THE SECURITY BOUNDARY
 * ===========================================================================
 *
 * `docs/decisions/0022`: Core sets `HttpOnly; Secure; SameSite=Lax; Path=/` with
 * NO `Domain`, so the credential issued here is scoped to `admin.dudo.work`
 * alone. AN OPERATOR SIGNING IN HERE IS NOT SIGNED IN AT `app.dudo.work`, AND A
 * TENANT USER'S SESSION IS NOT REPLAYABLE HERE. 0022 states it as a feature:
 * "administrative access should be authenticated separately, not inherited from
 * an ordinary session that happens to be open in another tab."
 *
 * `platform-operator-v1` leans on it as a second independent barrier: "even a
 * principal wrongly present in both tables would need two separate credentials
 * in two separate cookie jars."
 *
 * `HttpOnly` also means this console cannot read, write or delete the cookie. So
 * there is no token to store, no storage decision to make, and
 * `credentials: 'same-origin'` on each request is the whole of session handling.
 *
 * ===========================================================================
 * AN OPERATOR'S SESSION HAS NO ORGANIZATION AND NEVER WILL
 * ===========================================================================
 *
 * `docs/decisions/0024`: a platform principal holds ZERO membership rows, and
 * that absence IS the isolation. `platform-operator-v1`,
 * `theSESSIONISUNSELECTEDANDSTAYSTHATWAY`: "selectOrganization refuses every
 * Organization it could name with the same 404 a non-member receives, and its
 * session's active_organization_id stays null for its whole life. NO TENANT
 * STORE CAN EVER BE RESOLVED FOR IT."
 *
 * NOTHING IN THIS FILE CALLS AN ORGANIZATION-SELECTION ROUTE, and nothing in
 * this console does. There is no Organization to select, no picker to draw, and
 * no `failed_precondition` to interpret as "choose one" — the state the customer
 * client spends real effort handling simply does not exist here.
 *
 * ===========================================================================
 * WHAT IS NOT HERE: A SESSION PROBE
 * ===========================================================================
 *
 * The customer client asks the server whether a session exists by making a
 * cheap authenticated read. THIS CONSOLE CANNOT DO THAT, and the reason is the
 * paragraph above: every Action requires a tenant, and an operator can never
 * have one. See `platform-session.ts`, which holds that gap and its seam rather
 * than letting it be filled in by guesswork.
 */

import { ApiError } from './errors';
import { CONFIG } from './config';
import { deriveLogin, type DerivationProgress } from './kdf-client';

/** The two fields `login-v1` declares. Undeclared fields are refused by Core. */
export const IDENTIFIER_FIELD = 'email';
export const DERIVED_KEY_FIELD = 'derived_key';

export const LOGIN_COMPLETE_PATH = '/auth/login/complete';
export const SESSION_REVOKE_PATH = '/auth/session/revoke';

export interface LoginResult {
  /** The normalised address that was sent. Safe to display; not a secret. */
  readonly email: string;
  readonly derivationMs: number;
  readonly usedWorker: boolean;
  /** The derived key's length, for the acceptance checklist. Never the value. */
  readonly derivedKeyLength: number;
}

export interface LogoutOutcome {
  /**
   * True when Core answered `200`, which under `0018` §B means the browser was
   * handed the constant clearing cookie and has dropped the credential.
   *
   * IT DOES NOT MEAN THE SESSION ROW WAS DELETED. `cleared` is returned on all
   * six handler paths including the one where the delete failed — that is the
   * point of §B: the browser drops the credential regardless of an outcome the
   * collapsed response deliberately refuses to reveal. What this flag says is
   * narrower and true: THE CREDENTIAL IS GONE FROM THIS BROWSER.
   */
  readonly cleared: boolean;
}

export interface AuthClient {
  /**
   * Derives locally and posts the sign-in.
   *
   * Resolves on `200`. Rejects with an `ApiError` on anything else — `401` for
   * a refusal, `429` carrying `retry_after_seconds`, `unavailable` when the
   * request did not arrive.
   */
  login(
    identifier: string,
    password: string,
    onProgress: (progress: DerivationProgress) => void,
  ): Promise<LoginResult>;
  /**
   * Revokes the session server-side. `POST /auth/session/revoke`, no body.
   *
   * IT NEVER REJECTS. There is one exit path and it always ends signed out
   * locally: leaving someone apparently signed in after they asked to leave is
   * the worse of the two possible wrong answers — and on an administrative
   * console, on a shared machine, it is the worse one by a wide margin.
   *
   * IT REPORTS `cleared`, AND THAT IS THE ONE DISTINCTION WORTH DRAWING.
   * Revocation is `disclosure: 'collapsed'`: Core returns `cleared` on all six
   * paths (no cookie, forged MAC, session not found, session deleted, store
   * refused, budget refused) so an attacker holding a stolen credential cannot
   * learn from a sign-out whether it was live. WHICH OF THE SIX HAPPENED IS
   * GENUINELY UNKNOWABLE AND THIS CONSOLE MUST NOT GUESS AT IT. But whether the
   * request reached Core at all is a different question and is answerable: a
   * `200` always carries the clearing cookie, and anything that is not a `200`
   * carries no cookie and revoked nothing — in which case the session is still
   * live and the person deserves to be told.
   */
  logout(): Promise<LogoutOutcome>;
}

function readRetryAfter(response: Response, envelope: Record<string, unknown>): number | null {
  const fromBody = envelope.retry_after_seconds;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return Math.ceil(fromBody);
  }
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number.parseInt(header.trim(), 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  return null;
}

/**
 * The one auth client. There is no fixture sibling — see `config.ts`.
 *
 * `fetch`, NOT `axios`. ADR 0010's audit: "The platform runs on `fetch`. A
 * second HTTP client is a second place for auth headers and error handling to
 * diverge. Prefer `fetch`." Nothing in this console needs interceptors,
 * cancellation beyond `AbortController`, or automatic JSON — and a second HTTP
 * client on the one path that carries a credential is the worst place to have
 * two behaviours.
 */
export function createAuthClient(
  options: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): AuthClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? CONFIG.apiBaseUrl;
  // The sign-in timeout is longer than the ordinary request timeout: the request
  // itself is quick, but it is queued behind a derivation the server also has to
  // hash.
  const timeoutMs = options.timeoutMs ?? Math.max(CONFIG.requestTimeoutMs, 30_000);

  return {
    async login(identifier, password, onProgress) {
      const derived = await deriveLogin(identifier, password, onProgress);

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${LOGIN_COMPLETE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          // Exactly the two declared fields, in the ratified names. Core refuses
          // any undeclared field with `invalid_argument / unknown_field`, so an
          // extra "remember me" or "client_version" here would break sign-in.
          body: JSON.stringify({
            [IDENTIFIER_FIELD]: derived.email,
            [DERIVED_KEY_FIELD]: derived.derivedKey,
          }),
          // Without this the browser discards the `Set-Cookie` and the sign-in
          // silently accomplishes nothing.
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (thrown) {
        clearTimeout(timer);
        if (thrown instanceof DOMException && thrown.name === 'AbortError') {
          throw new ApiError({
            code: 'timeout',
            message: 'Signing in took too long and was abandoned.',
          });
        }
        throw new ApiError({ code: 'unavailable', message: 'The request did not reach Dudo.' });
      }
      clearTimeout(timer);

      if (response.ok) {
        writeSessionHint(true);
        return {
          email: derived.email,
          derivationMs: derived.elapsedMs,
          usedWorker: derived.usedWorker,
          derivedKeyLength: derived.derivedKey.length,
        };
      }

      let envelope: Record<string, unknown> = {};
      try {
        const text = await response.text();
        if (text.length > 0) {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
            envelope = parsed.error as Record<string, unknown>;
          }
        }
      } catch {
        /* A non-envelope body. The status is still the answer. */
      }

      const code =
        response.status === 401
          ? 'unauthenticated'
          : response.status === 429
            ? 'rate_limited'
            : response.status === 400
              ? 'invalid_argument'
              : response.status === 503
                ? 'unavailable'
                : 'internal';

      throw new ApiError({
        code,
        message: typeof envelope.message === 'string' ? envelope.message : undefined,
        request_id:
          typeof envelope.request_id === 'string'
            ? envelope.request_id
            : response.headers.get('x-request-id'),
        retry_after_seconds: readRetryAfter(response, envelope),
      });
    },

    async logout(): Promise<LogoutOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, CONFIG.requestTimeoutMs);

      let cleared = false;
      try {
        const response = await doFetch(`${baseUrl}${SESSION_REVOKE_PATH}`, {
          method: 'POST',
          headers: { accept: 'application/json' },
          // NO BODY AT ALL. `login-v1` declares `fields: []`, so any field is
          // rejected — and in particular there is no `session_id` field and
          // there must never be one: a sign-out that took an identifier from
          // the body would let any unauthenticated caller delete any session it
          // could name. The session comes from the cookie the browser attaches.
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        cleared = response.ok;
      } catch {
        // Not rethrown: there is one exit path and it always ends signed out.
        // No retry either — a retry loop around revocation is the automatic
        // behaviour `0018`'s row-write budget rules out.
        cleared = false;
      } finally {
        clearTimeout(timer);
      }

      writeSessionHint(false);
      return { cleared };
    },
  };
}

/* -------------------------------------------------------------------------
   The per-tab hint
   ------------------------------------------------------------------------- */

/**
 * A non-secret, per-tab note that someone signed in during this tab's lifetime.
 *
 * WHAT IT IS: the string `active` in `sessionStorage`. WHAT IT IS NOT: a
 * credential, a token, an authorization, or anything an attacker gains by
 * reading it. It is never trusted for access — every platform route is
 * authorized in Core on every call, and this console holds no permission logic
 * at all (ADR 0010 §7: "It may render according to permissions Core reports; it
 * may never decide them").
 *
 * `sessionStorage` rather than `localStorage` so it dies with the tab. On an
 * administrative console that matters more than on the customer client: a note
 * that outlived the browser window would survive on a shared machine.
 *
 * IT IS A SEPARATE KEY FROM THE WEB CLIENT'S. `platform/web` writes
 * `dudo.session.hint`. This writes `dudo.admin.session.hint`, so that two tabs
 * on two hostnames cannot be confused — and, on a `localhost` development
 * machine where both clients share an origin and therefore share
 * `sessionStorage`, so that signing into one does not leave a hint in the other.
 * That collision is only possible in development, and it would be a confusing
 * hour to debug.
 *
 * WHAT IT CANNOT DO IS CONFIRM A SESSION. See `platform-session.ts`.
 */
const SESSION_HINT_KEY = 'dudo.admin.session.hint';

export function readSessionHint(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_HINT_KEY) === 'active';
  } catch {
    // Storage can throw in private modes and under some policies. A missing hint
    // costs one sign-in screen; a throw here would cost the whole console.
    return false;
  }
}

export function writeSessionHint(active: boolean): void {
  try {
    if (active) window.sessionStorage.setItem(SESSION_HINT_KEY, 'active');
    else window.sessionStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* See readSessionHint. */
  }
}
