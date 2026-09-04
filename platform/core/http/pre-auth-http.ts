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
 *   cleared         200     `{"status":"ok"}`                        ONE FIXED CLEARING COOKIE
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
import type { PreAuthEntryPointId } from '../identity/pre-auth-registry.ts';
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
/**
 * ===========================================================================================
 * WHICH ENTRY POINTS MAY SEE `Authorization`. `docs/decisions/0018` §A, and it is a CLOSED LIST.
 * ===========================================================================================
 *
 * `0018` §A widened exactly one route, because exactly one had the defect: an Apple client
 * presenting `Authorization: Bearer` could not log out, and the handler correctly answered
 * "acknowledged" while revoking nothing — a security action reporting success without performing
 * it, which no client could detect and none could compensate for.
 *
 * IT IS AN ALLOW-LIST RATHER THAN "PARSE IT ALWAYS", and the reason is least privilege between
 * Core's own components, the same argument `control-plane-store.ts` property 3 makes. Nothing
 * else needs the header: `identity.login.complete` authenticates from the body and
 * `identity.login.start` reads nothing at all, so handing either of them a caller-supplied header
 * would be widening a surface for no purpose. Adding a second entry here is a deliberate edit
 * with a reviewer, which is what "closed" means.
 */
const ENTRY_POINTS_READING_AUTHORIZATION: ReadonlySet<PreAuthEntryPointId> = new Set<
  PreAuthEntryPointId
>(['identity.session.revoke']);

const BEARER_PREFIX = 'bearer ';

/**
 * Reads the `Authorization: Bearer` credential, for the entry points permitted to see one.
 *
 * THE SCHEME IS CASE-INSENSITIVE AND THE CREDENTIAL IS NOT — RFC 7235. This mirrors
 * `identity/session-credential.ts::readBearer` deliberately rather than sharing code with it: that
 * one serves the AUTHENTICATED path and this one the pre-auth path, and the two modules may not
 * import each other's transport. The rule is identical on purpose and must stay identical; the
 * duplication is the price of the boundary.
 */
function readBearer(request: Request, entryPointId: PreAuthEntryPointId): string | undefined {
  if (!ENTRY_POINTS_READING_AUTHORIZATION.has(entryPointId)) {
    return undefined;
  }
  const header = request.headers.get('authorization');
  if (header === null || header.length <= BEARER_PREFIX.length) {
    return undefined;
  }
  if (header.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) {
    return undefined;
  }
  const value = header.slice(BEARER_PREFIX.length).trim();
  return value.length === 0 ? undefined : value;
}

export function readPresentedCredentials(
  request: Request,
  entryPointId: PreAuthEntryPointId,
): PreAuthPresentedCredentials {
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
  const bearer = readBearer(request, entryPointId);
  return {
    get(name: PreAuthCredentialName): string | undefined {
      return found.get(name);
    },
    bearer(): string | undefined {
      return bearer;
    },
  };
}

export function buildPreAuthRequest(
  bodyText: string,
  request: Request,
  entryPointId: PreAuthEntryPointId,
  sourceAddressHash: string | null,
  requestId: string,
  correlationId: string,
): PreAuthRequest {
  return {
    bodyText,
    credentials: readPresentedCredentials(request, entryPointId),
    sourceAddressHash,
    requestId,
    correlationId,
  };
}

/**
 * The `Set-Cookie` value. Attributes forced; see the file header.
 *
 * `maxAgeSeconds: 0` PRODUCES A CLEARING COOKIE — an empty value with `Max-Age=0`. It is written
 * as one branch rather than left to the handler to express, so "log out" cannot be implemented as
 * "set a session cookie to the empty string with a year's lifetime".
 *
 * A CORRECTION TO THIS COMMENT, MADE 2026-09-04, AND THE ERROR IS WORTH KEEPING VISIBLE. It
 * previously said this branch was "how `identity.session.revoke` removes a credential". IT WAS
 * NOT, AND IT COULD NOT BE: a clearing cookie can only travel on an `issued` outcome, and the
 * registry declared revocation's only outcome as `acknowledged`. The branch was unreachable, and
 * the comment asserting otherwise is precisely what stopped anyone noticing — a comment
 * describing code that cannot execute is worse than no comment, because it answers the question a
 * reader came to ask. `docs/decisions/0018` §B fixed it by adding the `cleared` outcome, which is
 * what actually reaches this function now, through `CLEARED_SESSION_COOKIE` below.
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
 * The exact bytes every revocation sets, computed once at module load. `docs/decisions/0018` §B.
 *
 * IT CLEARS `dudo_session` AND NOTHING ELSE, deliberately. `dudo_refresh` and `dudo_login_state`
 * are in the closed credential-name set but the platform never issues either — `0015` §B.3 leaves
 * refresh unbuilt and §D removed the need for login state — so clearing them would emit two
 * `Set-Cookie` headers for credentials that do not exist. When either is built, it is added here
 * in the same change that starts issuing it, and the response stays constant because this
 * constant stays constant.
 *
 * IT IS BUILT THROUGH `renderCredential` RATHER THAN WRITTEN OUT AS A LITERAL, so `HttpOnly`,
 * `Secure`, `SameSite` and `Path` come from the one place that forces them. A hand-written string
 * here would be a second definition of the cookie attributes, and a clearing cookie whose `Path`
 * did not match the one that set it does not clear anything — a failure that looks like the
 * server ignoring logout.
 */
export const CLEARED_SESSION_COOKIE = renderCredential({
  name: 'dudo_session',
  value: '',
  maxAgeSeconds: 0,
});

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
  if (resolution.kind === 'cleared') {
    // ===========================================================================================
    // ONE CONSTANT, RENDERED FROM A MODULE-LEVEL STRING, ON EVERY REVOCATION. `0018` §B.
    // ===========================================================================================
    //
    // `resolution` HAS NO FIELD THIS BRANCH READS, and that is the property rather than an
    // accident of the shape: there is nothing a handler could put in it, so the bytes cannot vary
    // with the session that was revoked, with whether one was revoked, or with anything the
    // caller presented. A valid session, a forged credential, an unknown session, a replay and an
    // absent cookie all produce this identical response.
    //
    // THE BODY IS `PRE_AUTH_ACK_BODY_TEXT`, THE SAME CONSTANT `acknowledged` AND `issued` USE, so
    // the response is also indistinguishable in length from every other success on this path.
    const headers = baseHeaders(requestId, correlationId);
    headers.append('set-cookie', CLEARED_SESSION_COOKIE);
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
