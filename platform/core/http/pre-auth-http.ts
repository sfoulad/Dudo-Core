/**
 * ===========================================================================================
 * THE HTTP BINDING FOR PRE-AUTHENTICATION ENTRY POINTS. `docs/decisions/0014` §B.
 * ===========================================================================================
 *
 * Transport only, exactly as `http/api.ts` is for Actions: it turns a `Request` into a
 * `PreAuthRequest`, and a `PreAuthResolution` into bytes. There is no decision in this file —
 * every branch below is a table lookup — and that is deliberate, because the bytes ARE the
 * security property here. §B's "reveal no account-existence difference" is, at the wire, a claim
 * about response bodies, response codes and response sizes, and a claim about bytes has to be
 * made in the one place the bytes are produced.
 *
 * ===========================================================================================
 * THE FIXED RESPONSE TABLE, AND WHAT IS CONSTANT ACROSS IT
 * ===========================================================================================
 *
 *   resolution      status  body                                     Set-Cookie
 *   static          200     the registry's frozen constant           none
 *   acknowledged    200     `{"status":"ok"}`                        none
 *   issued          200     `{"status":"ok"}`                        one per credential
 *   refused         401     the fixed `unauthenticated` envelope     none
 *   unavailable     503     the fixed `unavailable` envelope         none
 *   rate_limited    429     the fixed `rate_limited` envelope        none
 *   invalid         400     the `invalid_argument` envelope + details none
 *
 * EVERY BODY IN THAT TABLE IS A CONSTANT except `invalid`'s details and `request_id`.
 *
 *   - `request_id` is 22 characters on every response Dudo has ever sent (`kernel/ids.ts`), so
 *     it is a fixed-width difference and `MULTITENANCY_STANDARD.md` §4 already names it as the
 *     one permitted one.
 *   - `invalid`'s details name a FIELD and a stable TOKEN and never a value — `detail()` has no
 *     parameter for one — and the branch is reached only by the SHAPE of the request, which the
 *     caller wrote. It says nothing about any account.
 *   - `acknowledged` and `issued` share a body BYTE FOR BYTE. The only difference between them
 *     is the presence of `Set-Cookie`, and that difference is about whether the caller presented
 *     a valid credential, not about whether an account exists — an attacker who can produce a
 *     valid credential already holds the account.
 *
 * THE HEADERS ARE IDENTICAL ON EVERY BRANCH except `Retry-After` on 429, which
 * `retryAfterSecondsUntilWindowEnd` derives from a FIXED WINDOW BOUNDARY and is therefore the
 * same value for every caller at that instant — `0014`'s rule for a retry time, applied to the
 * pre-auth path.
 *
 * `Cache-Control: no-store` IS ON EVERY BRANCH INCLUDING HEALTH. Not because the health body is
 * sensitive — it is a constant — but because a table with one exception is a table someone
 * eventually widens, and because a cached 401 is a support ticket.
 *
 * ===========================================================================================
 * COOKIE ATTRIBUTES ARE FORCED HERE AND ARE NOT THE HANDLER'S TO CHOOSE
 * ===========================================================================================
 *
 * `PreAuthCredential` carries a name from a closed set, an opaque value and a lifetime, and
 * nothing else. `HttpOnly`, `Secure`, `SameSite` and `Path` are appended below, unconditionally.
 * A handler that could choose them could ship a session cookie readable from page JavaScript, or
 * one sent to a third-party site on a cross-origin POST, and neither is a decision that should
 * be available at a call site in another agent's module.
 *
 * `SameSite=Lax` RATHER THAN `Strict`: `Strict` withholds the session cookie on the first
 * navigation into the application from any external link, which logs the user out of every
 * inbound link they follow. `Lax` withholds it on cross-site POST, which is the CSRF case that
 * matters. This is a real choice with a real trade and it is stated rather than defaulted into.
 */

import type {
  PreAuthCredential,
  PreAuthPresentedCredentials,
  PreAuthRequest,
  PreAuthResolution,
} from '../identity/pre-auth-admission.ts';
import type { PreAuthCredentialName } from '../identity/pre-auth-admission.ts';
import { renderError } from './response.ts';
import {
  invalidArgument,
  detail,
  rateLimited,
  unauthenticated,
  unavailable,
} from '../kernel/errors.ts';
import { REQUEST_ID_HEADER, CORRELATION_ID_HEADER } from './response.ts';

/** The single success body. One constant, used by both `acknowledged` and `issued`. */
export const PRE_AUTH_ACK_BODY_TEXT = JSON.stringify({ status: 'ok' });

/** The closed credential name set, as a runtime value, for parsing the request's own cookies. */
const CREDENTIAL_NAMES: readonly PreAuthCredentialName[] = [
  'dudo_session',
  'dudo_refresh',
  'dudo_login_state',
];

/** A year. A credential lifetime longer than this is a defect, not a choice. */
const MAX_CREDENTIAL_AGE_SECONDS = 365 * 24 * 60 * 60;

function baseHeaders(requestId: string, correlationId: string): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    [REQUEST_ID_HEADER]: requestId,
    [CORRELATION_ID_HEADER]: correlationId,
    'cache-control': 'no-store',
  });
}

/**
 * Reads the caller's cookies into the narrow accessor a handler receives.
 *
 * IT RETURNS AN ACCESSOR, NOT A MAP, AND THE ACCESSOR ONLY ANSWERS FOR THE THREE NAMES IN THE
 * CLOSED SET. A handler therefore cannot enumerate what the caller sent, cannot read a cookie
 * belonging to another part of the platform, and cannot read a cookie an attacker planted under
 * a name of its choosing. That last one is the reason: a `get(name: string)` would let a handler
 * be steered into reading attacker-chosen input by a future change that looked harmless.
 */
export function readPresentedCredentials(request: Request): PreAuthPresentedCredentials {
  const header = request.headers.get('cookie');
  const found = new Map<PreAuthCredentialName, string>();
  if (header !== null) {
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      const known = CREDENTIAL_NAMES.find((candidate) => candidate === name);
      if (known !== undefined && !found.has(known)) {
        // FIRST OCCURRENCE WINS AND A DUPLICATE IS IGNORED. Cookie shadowing — sending
        // `dudo_session` twice so that the server and a proxy disagree about which is real — is a
        // known attack, and taking the first deterministically is what stops the two ends
        // disagreeing.
        found.set(known, value);
      }
    }
  }
  return {
    get(name: PreAuthCredentialName): string | undefined {
      return found.get(name);
    },
  };
}

export function buildPreAuthRequest(
  bodyText: string,
  request: Request,
  sourceAddressHash: string | null,
  requestId: string,
  correlationId: string,
): PreAuthRequest {
  return {
    bodyText,
    credentials: readPresentedCredentials(request),
    sourceAddressHash,
    requestId,
    correlationId,
  };
}

/**
 * The `Set-Cookie` value. Attributes forced; see the file header.
 *
 * `maxAgeSeconds: 0` PRODUCES A CLEARING COOKIE — an empty value with `Max-Age=0` — which is how
 * `identity.session.revoke` removes a credential. It is written as one branch rather than left to
 * the handler to express, so "log out" cannot be implemented as "set a session cookie to the
 * empty string with a year's lifetime".
 */
export function renderCredential(credential: PreAuthCredential): string {
  const maxAge = Math.max(
    0,
    Math.min(MAX_CREDENTIAL_AGE_SECONDS, Math.floor(credential.maxAgeSeconds)),
  );
  const value = maxAge === 0 ? '' : credential.value;
  return (
    `${credential.name}=${value}; Max-Age=${String(maxAge)}; Path=/; ` +
    'HttpOnly; Secure; SameSite=Lax'
  );
}

/**
 * The renderer. One switch, no logic.
 *
 * IT TAKES `retryAfterSeconds` FROM THE RESOLUTION rather than computing one, because the
 * resolution's value came from the fixed window boundary and a value computed here would be a
 * second, differently-derived number for the same fact.
 */
export function renderPreAuthResolution(
  resolution: PreAuthResolution,
  requestId: string,
  correlationId: string,
): Response {
  if (resolution.kind === 'static') {
    return new Response(resolution.bodyText, {
      status: 200,
      headers: baseHeaders(requestId, correlationId),
    });
  }
  if (resolution.kind === 'acknowledged') {
    return new Response(PRE_AUTH_ACK_BODY_TEXT, {
      status: 200,
      headers: baseHeaders(requestId, correlationId),
    });
  }
  if (resolution.kind === 'issued') {
    const headers = baseHeaders(requestId, correlationId);
    for (const credential of resolution.credentials) {
      // `append`, not `set`: several credentials are several `Set-Cookie` headers, and `set`
      // would silently keep only the last — which for a refresh that rotates two credentials
      // would drop one and log the user out on the next request.
      headers.append('set-cookie', renderCredential(credential));
    }
    return new Response(PRE_AUTH_ACK_BODY_TEXT, { status: 200, headers });
  }
  if (resolution.kind === 'refused') {
    // THE FIXED 401. `unauthenticated()` takes no arguments, so there is nothing here that could
    // vary with what the caller submitted or with what was or was not found.
    return renderError(unauthenticated(), requestId, correlationId);
  }
  if (resolution.kind === 'unavailable') {
    return renderError(unavailable(), requestId, correlationId);
  }
  if (resolution.kind === 'rate_limited') {
    return renderError(
      rateLimited(),
      requestId,
      correlationId,
      resolution.retryAfterSeconds,
    );
  }
  return renderError(
    invalidArgument(resolution.details.map((entry) => detail(entry.field, entry.issue))),
    requestId,
    correlationId,
  );
}
