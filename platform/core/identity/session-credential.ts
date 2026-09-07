/**
 * ===========================================================================================
 * THE SESSION CREDENTIAL. `docs/decisions/0015` §A and §B, Accepted.
 * ===========================================================================================
 *
 * §A, normative:
 *
 *   `<session_id>.<HMAC-SHA-256(session_id) truncated to 128 bits>`, keyed by a Worker secret,
 *   compared in constant time. Carried in the existing `dudo_session` cookie for web and accepted
 *   as `Authorization: Bearer` for Apple. **One value, two carriers, one contract.**
 *
 * ===========================================================================================
 * THIS IS WHAT LETS `0004_session.sql` STAND WITHOUT A VERIFIER COLUMN, AND THE ARGUMENT MATTERS
 * ===========================================================================================
 *
 * `migrations/control-plane/0004_session.sql` records a constraint on whatever credential format
 * was eventually chosen:
 *
 *   *"IF THE CHOSEN FORMAT EVER MAKES THE BEARER TOKEN AND `session_id` THE SAME VALUE, THIS
 *   TABLE STORES A CREDENTIAL IN PLAINTEXT AND MUST GAIN A VERIFIER COLUMN FIRST."*
 *
 * The two are NOT the same value here. The bearer token is strictly MORE than the stored one: it
 * is the identifier plus a MAC that only the holder of `SESSION_HMAC_KEY` can produce. A reader of
 * the `session` table — a D1 dump, a backup, a support query, a future analytics job — obtains
 * identifiers and cannot mint a credential from them. So the constraint is satisfied by the format
 * rather than by a migration, and `0004` needs no change. That is `0015` §A's claim, and it is
 * recorded here at the implementation so the two cannot drift apart.
 *
 * TWO FURTHER PROPERTIES FALL OUT, AND BOTH ARE WORTH HAVING:
 *
 *   A FORGERY IS REJECTED WITH NO D1 READ AT ALL. `read` verifies the MAC before returning an
 *   identifier, so a caller sending random tokens costs one HMAC each and never reaches the
 *   database. On a single-threaded database that is the difference between a nuisance and an
 *   availability incident, and it needs no rate limiter to hold.
 *
 *   ROTATING ONE SECRET INVALIDATES EVERY SESSION ON THE PLATFORM. That is the emergency control
 *   the session table does not otherwise have: `deleteSession` revokes one row at a time and
 *   nothing revokes in bulk. Stated as an operational fact — it signs every user out — and not as
 *   something to do casually.
 *
 * ===========================================================================================
 * WHAT THIS FILE DOES NOT DO, AND MUST NOT BE EXTENDED TO DO
 * ===========================================================================================
 *
 * `SessionCredentialReader.read` RETURNS A SESSION IDENTIFIER AND NOTHING ELSE, which is the
 * standing rule `session-principal-resolver.ts` states and the reason it is a rule:
 *
 *   *"It has no way to return an Organization, a tenant, a role, or a claim, so no implementation
 *   of it — however it is written, whatever it parses — can move a tenant identifier from the
 *   request into the pipeline."*
 *
 * So the credential carries NO claims: no organization, no principal, no expiry, no scope. It is
 * not a JWT and must never become one. Everything about the session is read from the session row
 * on every request, and membership is re-validated on every request
 * (`session-resolution.ts`, ruling 2) — which is what makes revoking someone's membership take
 * effect immediately rather than at expiry. A self-describing token would undo that by design.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unauthenticated } from '../kernel/errors.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import type { AuthenticationInput } from './principal-resolver.ts';
import type { SessionCredentialReader } from './session-principal-resolver.ts';
import { fromBase64Url, toBase64Url } from './credential-store.ts';
import { constantTimeEquals } from './credential-verifier.ts';

/**
 * `0015` §B.1: TWELVE HOURS, and the arithmetic is the reason.
 *
 * *"Ten Organizations × ten principals × two logins/day = 600 row-writes, a fifth of the
 * control-plane sub-ceiling."* A shorter lifetime multiplies logins, and a login is 3 row-writes
 * against a platform-wide 3,000/day (`control-plane-admission.ts`). A longer one is a credential
 * that outlives the day's evidence.
 *
 * IT IS EXPORTED SO THAT THE COOKIE'S `Max-Age` AND THE SESSION ROW'S `expires_at` COME FROM ONE
 * VALUE. Two constants would be two things to keep in step, and the failure — a cookie that
 * outlives its row — is invisible until a user is signed out mid-task.
 *
 * §B.2 and §B.3 also apply and are implemented by ABSENCE rather than by code: there is no
 * rotation on any request (6 row-writes each, unaffordable by two orders of magnitude, and
 * unnecessary because a session identifier is only ever minted server-side after verification),
 * and `identity.session.refresh` stays registered with no handler and therefore fails closed.
 */
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** The same value the transport puts in `Max-Age`. Derived, never restated. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_LIFETIME_MS / 1000;

/** 128 bits, per `0015` §A. Truncating an HMAC to 128 bits is standard, not an invention. */
export const SESSION_MAC_BYTES = 16;

/** Domain separation, versioned for the same reason the credential label is. */
const SESSION_MAC_LABEL = 'dudo.identity.session.v1';

/** A Worker secret provisioned by the Team Lead. Never in the repository. */
export const MIN_SESSION_HMAC_KEY_BYTES = 32;

/**
 * THE SEPARATOR, AND WHY IT IS SAFE TO SPLIT ON.
 *
 * A session identifier is 22 characters of base64url (`kernel/ids.ts`) and the MAC is 22
 * characters of base64url, and NEITHER ALPHABET CONTAINS `.`. So a well-formed credential has
 * exactly one separator and the split is unambiguous. `read` requires exactly one and refuses
 * anything else rather than taking the first or the last, because "take the last dot" is how a
 * parser ends up disagreeing with the thing that produced the value.
 */
const SEPARATOR = '.';

export class SessionSigningKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionSigningKeyError';
  }
}

/**
 * Mints and reads the credential. The only holder of the imported key.
 *
 * `read` RETURNS `null` FOR EVERY REJECTION — malformed, wrong width, bad MAC — and never says
 * which. There is no field it could say it in, which is the same device `unauthenticated()` uses.
 */
export type SessionCredentialSigner = {
  mint(sessionId: string): Promise<string>;
  read(credential: string): Promise<string | null>;
};

export async function createSessionCredentialSigner(
  secret: CryptoBytes,
): Promise<SessionCredentialSigner> {
  if (secret.length < MIN_SESSION_HMAC_KEY_BYTES) {
    throw new SessionSigningKeyError(
      `SESSION_HMAC_KEY must be at least ${String(MIN_SESSION_HMAC_KEY_BYTES)} bytes. It is a ` +
        'Worker secret provisioned by the Team Lead and is never held in the repository. ' +
        'Rotating it signs every user on the platform out immediately, which is the intended ' +
        'emergency control and not a routine operation.',
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  async function macOf(sessionId: string): Promise<Uint8Array> {
    const message = new TextEncoder().encode(`${SESSION_MAC_LABEL} ${sessionId}`);
    const signature = await crypto.subtle.sign('HMAC', key, message);
    return new Uint8Array(signature).subarray(0, SESSION_MAC_BYTES);
  }

  return {
    async mint(sessionId: string): Promise<string> {
      return `${sessionId}${SEPARATOR}${toBase64Url(await macOf(sessionId))}`;
    },

    async read(credential: string): Promise<string | null> {
      const separator = credential.indexOf(SEPARATOR);
      if (separator <= 0 || credential.indexOf(SEPARATOR, separator + 1) !== -1) {
        return null;
      }
      const sessionId = credential.slice(0, separator);
      const presented = fromBase64Url(credential.slice(separator + 1), SESSION_MAC_BYTES);
      if (presented === null) {
        return null;
      }
      // THE MAC IS COMPUTED OVER THE PRESENTED IDENTIFIER, so a caller who substitutes another
      // session's identifier produces a value whose MAC it cannot compute. The comparison is
      // constant-time; a byte-at-a-time comparison here would let an attacker recover a valid MAC
      // one byte at a time for an identifier it chose.
      return constantTimeEquals(await macOf(sessionId), presented) ? sessionId : null;
    },
  };
}

// =============================================================================================
// The transport half
// =============================================================================================

/** The cookie name, from the closed set in `pre-auth-admission.ts`. */
export const SESSION_COOKIE_NAME = 'dudo_session';

const BEARER_PREFIX = 'bearer ';

/**
 * Reads the credential from a request's headers and turns it into a session identifier.
 *
 * ===========================================================================================
 * TWO CARRIERS, AND A MISMATCH BETWEEN THEM IS REFUSED RATHER THAN RESOLVED
 * ===========================================================================================
 *
 * `0015` §A gives the web client a cookie and the Apple client a bearer header. A request
 * carrying BOTH with DIFFERENT values is not a case either client produces, and picking a winner
 * is how a confusion attack works: a cookie an attacker can plant cross-site (or through a
 * subdomain) alongside a header the application sets, with the server free to choose. So both are
 * read, and a disagreement is `unauthenticated`.
 *
 * IDENTICAL VALUES IN BOTH ARE ACCEPTED, because that is what a client sending its own credential
 * twice looks like and refusing it would be a defect with no security content.
 *
 * WHY THE COMPARISON IS ORDINARY AND NOT CONSTANT-TIME: both sides came from the same request,
 * both are known to the caller, and the answer discloses nothing the caller did not already hold.
 * The credential's own verification, one line further down, is the constant-time one.
 *
 * `null` MEANS NO CREDENTIAL AND IS NOT AN ERROR — `session-principal-resolver.ts` states that
 * plainly and warns that it must not be logged as one. An unauthenticated request to a protected
 * route is the ordinary state of the internet, not an incident.
 */
export function createSessionCredentialReader(
  signer: SessionCredentialSigner,
): SessionCredentialReader {
  return {
    async read(input: AuthenticationInput): Promise<Result<string | null>> {
      const fromHeader = readBearer(input);
      const fromCookie = readCookie(input);

      if (fromHeader !== null && fromCookie !== null && fromHeader !== fromCookie) {
        return err(unauthenticated());
      }
      const presented = fromHeader ?? fromCookie;
      if (presented === null) {
        return ok(null);
      }

      const sessionId = await signer.read(presented);
      if (sessionId === null) {
        // A CREDENTIAL WAS PRESENTED AND ITS MAC DID NOT VERIFY. That is a rejection and not an
        // absence, so it is an error rather than `null` — and it costs no D1 read, which is the
        // property `0015` §A buys.
        return err(unauthenticated());
      }
      return ok(sessionId);
    },
  };
}

function readBearer(input: AuthenticationInput): string | null {
  const header = input.headers.get('authorization');
  if (header === undefined || header === null) {
    return null;
  }
  // The scheme is case-insensitive per RFC 7235; the credential is not.
  if (header.length <= BEARER_PREFIX.length) {
    return null;
  }
  if (header.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) {
    return null;
  }
  const value = header.slice(BEARER_PREFIX.length).trim();
  return value.length === 0 ? null : value;
}

/**
 * Parses the request's own `Cookie` header for `dudo_session`.
 *
 * FIRST OCCURRENCE WINS AND DUPLICATES ARE IGNORED, which is the rule
 * `http/pre-auth-http.ts::readPresentedCredentials` already applies and the reason it gives:
 * cookie shadowing — sending `dudo_session` twice so that the server and a proxy disagree about
 * which is real — is a known attack, and taking the first deterministically is what stops the two
 * ends disagreeing. The two parsers are separate because they serve different paths (pre-auth
 * versus authenticated) and neither module may import the other's transport code, but the RULE is
 * the same and is deliberately not varied.
 */
function readCookie(input: AuthenticationInput): string | null {
  const header = input.headers.get('cookie');
  if (header === undefined || header === null) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(separator + 1).trim();
      return value.length === 0 ? null : value;
    }
  }
  return null;
}
