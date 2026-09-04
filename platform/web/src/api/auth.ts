/**
 * Login, and what this client is allowed to believe about a session.
 *
 * ===========================================================================
 * THE WIRE SHAPE, RATIFIED. `platform/core/identity/login.ts`.
 * ===========================================================================
 *
 *   POST /auth/login/complete
 *   Content-Type: application/json
 *   { "email": "<normalised address>", "derived_key": "<43 base64url chars>" }
 *
 * Success is `200 {"status":"ok"}` with a `Set-Cookie`, and THE BODY CARRIES NO
 * TOKEN. Failure is `401` with the fixed `unauthenticated` envelope: no "account
 * not found", no "wrong password", no lockout notice, and no field any of them
 * could be written into. `http/pre-auth-http.ts` renders one fixed body for every
 * outcome because a body that varied in length would itself be a disclosure
 * channel.
 *
 * `identity.login.start` IS NOT CALLED AND NO CODE HERE CALLS IT. Login is
 * single-step (Team Lead ruling, 2026-09-04).
 *
 * THE REASON IS THAT IT HAS NOTHING TO GIVE, NOT THAT IT IS INERT. An earlier
 * note in this file said the entry point was merely a reserved path with no
 * handler; that was wrong, and the correction is recorded rather than quietly
 * edited. It IS registered, IS reachable, DOES have a handler, and answers
 * `200 {"status":"ok"}` to every input including malformed ones — because it is
 * `disclosure: 'collapsed'` and renders one constant body for every caller.
 *
 * That is precisely why calling it would be pointless. ADR 0015 §D salts the
 * client KDF with the normalised email, so there is no challenge, no nonce and
 * no per-user salt to fetch; and a collapsed entry point could not deliver one
 * if there were, because any variation in its answer would be the
 * account-existence oracle `0014` §B exists to close. A call to it would cost a
 * round trip and a durable write, and return a constant this client already
 * knows.
 *
 * ===========================================================================
 * THIS CLIENT CANNOT SEE, STORE OR CLEAR THE SESSION CREDENTIAL
 * ===========================================================================
 *
 * `http/pre-auth-http.ts` forces `HttpOnly; Secure; SameSite=Lax; Path=/` on
 * every issued credential. `HttpOnly` means page JavaScript cannot read
 * `dudo_session`, cannot write it, and cannot delete it. So:
 *
 *   - THERE IS NO TOKEN TO STORE and no storage decision to make. The browser
 *     holds it and attaches it; `credentials: 'same-origin'` on each request is
 *     the whole of session handling on the web.
 *   - AUTHENTICATION STATE IS PROBED, NOT READ. This client cannot inspect the
 *     cookie, so it asks the server — see `probeSession`. Anything else would be
 *     a guess rendered as a fact.
 *   - LOGOUT REVOKES SERVER-SIDE AND CANNOT CLEAR THE COOKIE. See below.
 *
 * ===========================================================================
 * LOGOUT, AND WHY `401` MUST MEAN "LOGGED OUT" RATHER THAN "RETRY"
 * ===========================================================================
 *
 * `identity.session.revoke` now has a handler and DELETES THE SESSION ROW, so
 * the credential stops resolving immediately — which is the security property
 * that matters. What it cannot do is clear the cookie.
 *
 * `docs/decisions/0018` finding 1: `pre-auth-http.ts` has a clearing-cookie
 * branch whose own comment claims it is how revocation removes a credential, and
 * THE BRANCH IS UNREACHABLE. A clearing cookie can only ride an `issued`
 * outcome, and the registry declares revocation's outcomes as `['acknowledged']`
 * alone. The registry is correct and must not be relaxed — forcing
 * `collapseTo: 'issued'` is refused by `outcomeOfKind` as "an authentication
 * bypass wearing the word default". 0018 §B adds a `cleared` outcome that fixes
 * this properly; it has not landed.
 *
 * SO, UNTIL IT DOES: after a successful logout the browser still holds
 * `dudo_session` for up to 12 hours and IT IS DEAD. This client will present it
 * and be refused. **A `401` therefore means signed out, never a transient
 * failure to retry**, and that rule is enforced in three places rather than
 * remembered: `isRetryable` in `errors.ts` excludes `unauthenticated`;
 * `probeSession` below maps it to `anonymous` and never to `unknown`; and the
 * transport fires `onUnauthenticated` so the gate returns to the login screen.
 *
 * NOTHING SIGNS OUT OR SIGNS IN ON ITS OWN, AND THAT IS A BUDGET RULE AS WELL AS
 * A UX ONE. 0018 costs revocation at 3 row-writes — identical to a login — so a
 * login/logout CYCLE IS 6, giving 500 cycles/day platform-wide and 100 per
 * principal. That is half what `0014` §C's "1,000 logins/day" suggests to anyone
 * who reads it without logout in mind. An automatic re-login, a retry loop
 * around `login`, or a logout fired on `401` would burn the budget at twice the
 * rate the login figure implies. `logout` is called from exactly one place: the
 * button a person pressed.
 *
 * IN PARTICULAR, `401` MUST NOT TRIGGER A REVOCATION. The session is already
 * gone; revoking it would spend 3 row-writes to delete a row that is not there.
 *
 * ON XSS, STATED PRECISELY AND NOT ROUNDED UP: an injected script CANNOT
 * exfiltrate the session credential, because `HttpOnly` puts it out of reach of
 * every JavaScript API. It CAN still act as the user for as long as the page is
 * open, by making same-origin requests that the browser attaches the cookie to.
 * `HttpOnly` removes credential theft, not session abuse. There is no refresh
 * token and no second factor, so the 12-hour absolute expiry is the only bound.
 */

import { ApiError, toApiError } from './errors';
import { CONFIG } from './config';
import { deriveLogin, type DerivationProgress } from './kdf-client';
import type { Transport } from './fixture-transport';

/** The two fields `login.ts` declares. Undeclared fields are refused by Core. */
export const IDENTIFIER_FIELD = 'email';
export const DERIVED_KEY_FIELD = 'derived_key';

export const LOGIN_COMPLETE_PATH = '/auth/login/complete';

/**
 * What this client knows about whether anyone is signed in.
 *
 * `unknown` IS A REAL STATE AND IS NOT A SYNONYM FOR `anonymous`. On first paint
 * the answer has not come back yet, and showing the login screen in the meantime
 * would sign people out visually on every reload. It is also what a probe that
 * failed for a reason other than 401 leaves behind: an unreachable server does
 * not mean an absent session, and rendering it as one would send a signed-in
 * person to a login form during a brief outage.
 */
export type SessionState = 'unknown' | 'authenticated' | 'anonymous';

/**
 * A non-secret, per-tab hint that someone signed in during this tab's lifetime.
 *
 * WHAT IT IS: the string `active` in `sessionStorage`. WHAT IT IS NOT: a
 * credential, a token, or anything an attacker gains by reading it. It is never
 * trusted for access — every request is authorized server-side on every call.
 * `sessionStorage` rather than `localStorage` so it dies with the tab.
 *
 * It exists so a reload does not flash the login screen for the duration of one
 * probe. The probe overrules it either way.
 *
 * ---------------------------------------------------------------------------
 * A THIRD STATE, `ended`, EXISTED HERE AND HAS BEEN RETIRED. Recorded because
 * the reasoning is worth more than the code was.
 *
 * While `identity.session.revoke` answered `acknowledged`, logout could not
 * clear the cookie, and this client could not tell a real revocation from a
 * failed one. If it silently failed — most likely at row-write exhaustion, which
 * made it a predictable end-of-day failure rather than an exotic one — the
 * browser still held a LIVE cookie, and the next probe would return `200` and
 * sign the person back in without a password moments after they pressed Sign
 * out. `ended` made the tab skip the probe.
 *
 * `0018` §B removed the cause. `revokeHandler` now returns `cleared` on all six
 * paths and `collapseTo` is `cleared`, so a `200` ALWAYS carries a constant
 * clearing cookie — including when the delete itself failed, which is exactly
 * the case `ended` was covering.
 *
 * IT IS RETIRED RATHER THAN KEPT AS BELT-AND-BRACES, and that is a deliberate
 * choice against the safer-sounding option. The one case it would still catch is
 * a logout whose response was NOT a `200` — a network failure, or a rate limit —
 * where nothing is revoked and nothing is cleared. But in that case the session
 * is genuinely still live, and `ended` would have shown a login screen that says
 * the person is signed out when they are not. THAT IS NOT A SMALLER FAILURE
 * THAN THE ONE IT REPLACED; it is a quieter one. `logout` now reports whether
 * the credential was cleared and the screen says so plainly instead.
 * ---------------------------------------------------------------------------
 */
const SESSION_HINT_KEY = 'dudo.session.hint';

export function readSessionHint(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_HINT_KEY) === 'active';
  } catch {
    // Storage can throw in private modes and under some policies. A missing hint
    // costs one login-screen flash; a throw here would cost the whole app.
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

/* -------------------------------------------------------------------------
   The probe
   ------------------------------------------------------------------------- */

/**
 * Asks the server whether this browser currently has a session.
 *
 * IT USES A REAL, CHEAP, AUTHENTICATED READ rather than a dedicated endpoint,
 * because a dedicated "am I logged in" route would be a sixth pre-authentication
 * entry point and `0014` §B permits exactly five. `core.ListAuthorizedBusinesses`
 * with `page_size=1` is the smallest authenticated call in the contract set.
 *
 * AN EMPTY RESULT IS AUTHENTICATED, NOT ANONYMOUS. Core ships a deny-all
 * authorization source, so every principal's authorized-business set is empty
 * today. Reading empty as "not signed in" would make the whole application
 * unreachable for every real user. The status code is the answer; the body is
 * not consulted at all.
 */
export async function probeSession(
  transport: Transport,
): Promise<{ state: SessionState; error: ApiError | null }> {
  try {
    await transport.invoke('core.ListAuthorizedBusinesses', { page_size: 1 });
    return { state: 'authenticated', error: null };
  } catch (thrown) {
    const error = toApiError(thrown);
    if (error.code === 'unauthenticated') {
      return { state: 'anonymous', error: null };
    }
    // Unreachable, rate limited, forbidden, internal — none of these says
    // anything about whether a session exists, so none of them may be reported
    // as `anonymous`. The caller shows the error and offers a retry.
    return { state: 'unknown', error };
  }
}

/* -------------------------------------------------------------------------
   Login
   ------------------------------------------------------------------------- */

export interface LoginResult {
  /** The normalised address that was sent. Safe to display; not a secret. */
  readonly email: string;
  readonly derivationMs: number;
  readonly usedWorker: boolean;
  /** The derived key's length, for the acceptance checklist. Never the value. */
  readonly derivedKeyLength: number;
}

export interface AuthClient {
  /**
   * Derives locally and posts the login.
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
   * the worse of the two possible wrong answers.
   *
   * IT REPORTS `cleared`, AND THAT IS THE ONE DISTINCTION WORTH DRAWING.
   * Revocation is `disclosure: 'collapsed'` — `login.ts` returns `cleared` on
   * all six paths (no cookie, forged MAC, session not found, session deleted,
   * store refused, budget refused) so an attacker holding a stolen token cannot
   * learn from a logout whether it is live. **Which of those six happened is
   * genuinely unknowable and this client must not guess at it.**
   *
   * But whether the REQUEST REACHED CORE AT ALL is a different question, and it
   * is answerable: `0018` §B makes `collapseTo: 'cleared'`, so a `200` always
   * carries the constant clearing cookie, and anything that is not a `200` — a
   * network failure, or the `60/minute` source rate limit — carries no cookie
   * and revoked nothing. In that case the session is still live and the person
   * deserves to be told, rather than shown a login screen that implies otherwise.
   *
   * I ORIGINALLY SWALLOWED THIS, ON THE GROUND THAT A NETWORK FAILURE WAS
   * INDISTINGUISHABLE FROM COLLAPSED SUCCESS. That was wrong, and the error is
   * worth naming: what is indistinguishable is which of the six SERVER paths
   * ran, not whether the server answered.
   */
  logout(): Promise<LogoutOutcome>;
  /** `http` or `fixture`, so a screen can say which it is talking to. */
  readonly name: string;
}

/** `login.ts` declares `fields: []` — any field at all is rejected. */
export const SESSION_REVOKE_PATH = '/auth/session/revoke';

export interface LogoutOutcome {
  /**
   * True when Core answered `200`, which under `0018` §B means the browser was
   * handed the constant clearing cookie and has dropped the credential.
   *
   * IT DOES NOT MEAN THE SESSION ROW WAS DELETED, and it must never be read that
   * way. `cleared` is returned on all six handler paths including the one where
   * the delete failed — which is the whole point of §B: the browser drops the
   * credential regardless of an outcome the collapsed response refuses to
   * reveal. What this flag says is narrower and true: the credential is gone
   * from this browser.
   */
  readonly cleared: boolean;
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

export function createHttpAuthClient(
  options: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): AuthClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? CONFIG.apiBaseUrl;
  // The login timeout is longer than the API timeout: the request itself is
  // quick, but it is queued behind a derivation the server also has to hash.
  const timeoutMs = options.timeoutMs ?? Math.max(CONFIG.requestTimeoutMs, 30_000);

  return {
    name: 'http',

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
          // extra "remember me" or "client_version" here would break login.
          body: JSON.stringify({
            [IDENTIFIER_FIELD]: derived.email,
            [DERIVED_KEY_FIELD]: derived.derivedKey,
          }),
          // Without this the browser discards the `Set-Cookie` and the login
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
          // NO BODY AT ALL. `login.ts` declares `fields: []`, so any field is
          // rejected — and in particular there is no `session_id` field and
          // there must never be one: a logout that took an identifier from the
          // body would let any unauthenticated caller delete any session it
          // could name. The session comes from the cookie the browser attaches.
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        // A `200` is the `cleared` outcome, and `0018` §B guarantees it carries
        // the clearing cookie. Anything else — a network failure below, or the
        // 60/minute source rate limit — carries no cookie and revoked nothing.
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

/**
 * The fixture auth client: a real derivation, no network.
 *
 * WHY IT EXISTS. The fixture build is how the UI is developed, demonstrated and
 * reviewed with no backend, and the login screen is now part of that UI. Without
 * this, the screen would be unreachable in the only build that runs today, and
 * the 600,000-iteration wait — the single biggest user-experience risk in this
 * slice — could not be seen or timed by a reviewer.
 *
 * IT RUNS THE REAL KDF. The derivation, the worker, the progress and the
 * 43-character assertion are all genuine; only the request is absent. So what a
 * reviewer times here is what a real login costs on their device.
 *
 * IT AUTHENTICATES NOBODY AND DECIDES NOTHING. It accepts any submittable
 * address with a non-empty password. That is not an authorization decision being
 * made in the UI — there is no server, no session, no principal and no tenant in
 * this build, and every screen behind it reads fixture data with no principal
 * either. The moment `VITE_DUDO_TRANSPORT=http` is set, this client is not
 * constructed and Core decides everything.
 */
export function createFixtureAuthClient(): AuthClient {
  return {
    name: 'fixture',

    async login(identifier, password, onProgress) {
      const derived = await deriveLogin(identifier, password, onProgress);
      // Latency in the same range as the real endpoint, so the button's busy
      // state is exercised rather than skipped.
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (password.length === 0) {
        throw new ApiError({
          code: 'unauthenticated',
          message: 'Fixture sign-in: enter any password.',
        });
      }
      writeSessionHint(true);
      return {
        email: derived.email,
        derivationMs: derived.elapsedMs,
        usedWorker: derived.usedWorker,
        derivedKeyLength: derived.derivedKey.length,
      };
    },

    async logout(): Promise<LogoutOutcome> {
      // No server, no session row, nothing to revoke. Reported as `cleared`
      // because in this build there is genuinely no credential left behind —
      // not as a stand-in for a success it did not have.
      await new Promise((resolve) => setTimeout(resolve, 120));
      writeSessionHint(false);
      return { cleared: true };
    },
  };
}

export function createAuthClient(): AuthClient {
  return CONFIG.transport === 'http' ? createHttpAuthClient() : createFixtureAuthClient();
}
