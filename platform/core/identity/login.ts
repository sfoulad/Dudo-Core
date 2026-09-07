/**
 * ===========================================================================================
 * THE LOGIN HANDLERS. `docs/decisions/0015` §§A, B and D, on the `0014` §B pre-auth path.
 * ===========================================================================================
 *
 * Two of the five registered pre-authentication entry points get a handler here, and the other
 * three deliberately do not. What each one does, and why:
 *
 *   identity.login.start      REGISTERED, AND DOES NOTHING. Under `0015` §D the client's PBKDF2
 *                             salt is the normalised email, so the client needs NOTHING from the
 *                             server before it derives — the round trip this endpoint exists for
 *                             has no payload to carry. See `startHandler`.
 *   identity.login.complete   THE WHOLE OF LOGIN. Verifies, then issues a session.
 *   identity.session.refresh  NO HANDLER. `0015` §B.3: under absolute expiry it either does
 *                             nothing or is a second login. It stays registered and fails closed.
 *   identity.session.revoke   LOGOUT. Deletes the session row and clears the cookie, and accepts
 *                             either carrier. See `revokeHandler` and `docs/decisions/0018`.
 *   platform.health           `kind: 'static'`. It cannot have a handler; the type refuses one.
 *
 * ===========================================================================================
 * WHAT A CLIENT MUST SEND. BOTH CLIENTS. THIS IS THE PART THAT MUST NOT DIVERGE.
 * ===========================================================================================
 *
 *   POST /auth/login/complete
 *   Content-Type: application/json
 *   { "email": "<address>", "derived_key": "<43 base64url characters>" }
 *
 * `derived_key` is `0015` §D's `kdf_output`, renamed only to match the snake_case convention
 * every other field on this platform follows. It is:
 *
 *   base64url( PBKDF2-SHA256( password    = utf8( NFC(password) ),
 *                             salt        = utf8( normalizeIdentifier(email) ),
 *                             iterations  = 600000,
 *                             length      = 32 bytes ) )
 *
 * ALL FOUR PARAMETERS ARE NORMATIVE AND NONE OF THEM IS NEGOTIABLE PER CLIENT. Web uses
 * `crypto.subtle.deriveBits`; Apple uses `CCKeyDerivationPBKDF`. The two must produce
 * byte-identical output, which is testable because the function is deterministic, and a mismatch
 * fails closed and loud: nobody can log in, so it cannot ship unnoticed.
 *
 * ===========================================================================================
 * TWO NORMALISATIONS APPEAR IN THAT ONE EXPRESSION AND THEY ARE DIFFERENT. THIS IS THE MOST
 * LIKELY THING FOR A CLIENT AUTHOR TO GET WRONG.
 * ===========================================================================================
 *
 *   THE IDENTIFIER  `normalizeIdentifier` — NFKC, then ASCII-ONLY case folding. NOT
 *                   `toLowerCase()`, which is full Unicode case mapping and differs between
 *                   JavaScript and Swift.
 *   THE PASSWORD    `normalizePassword` — **NFC ONLY**. No case folding. No trimming. No
 *                   character restriction. Added to `0015` §D on 2026-09-04 after `web-agent`
 *                   found that §D said only "the UTF-8 password", which leaves `é` composed on
 *                   one platform and decomposed on another deriving different keys for a password
 *                   that looks identical on both screens.
 *
 * **NFKC ON A PASSWORD WOULD BE A DEFECT, NOT A HARMLESS EXTRA.** It folds typographic characters
 * onto ASCII — `ﬁ` to `fi`, `²` to `2`, non-breaking space to space — which is exactly right for
 * an address and destroys entropy the user believes they have. RFC 8265 PRECIS `OpaqueString` is
 * the reference. Both functions are in `credential-store.ts` with the full contrast; read it
 * before writing either client.
 *
 * CORE CANNOT ENFORCE EITHER RULE, because it never sees a password and never sees an email it
 * did not hash. What holds them is that `tools/seed-principal.ts` applies both when it derives
 * the enrolment value, so a client that skips one derives a different key and is refused.
 *
 * ON SUCCESS THE RESPONSE IS `200 {"status":"ok"}` WITH A `Set-Cookie`, AND THE BODY CARRIES NO
 * TOKEN — WHICH IS A CONSTRAINT ON THE APPLE CLIENT AND IS STATED HERE BECAUSE IT WILL OTHERWISE
 * BE DISCOVERED DURING INTEGRATION. `http/pre-auth-http.ts` renders one fixed body for every
 * outcome and the ONLY per-request channel is `Set-Cookie`; putting a token in the body would
 * make `issued` and `acknowledged` differ in length, which is disclosure channel 2 in
 * `pre-auth-admission.ts`. So an Apple client obtains the credential by reading the `Set-Cookie`
 * header (or by letting `URLSession`'s cookie store hold it) and may then present it as
 * `Authorization: Bearer` on subsequent requests — `0015` §A's "one value, two carriers" works in
 * exactly that direction and not the other.
 *
 * ON FAILURE THE RESPONSE IS `401` WITH THE FIXED `unauthenticated` envelope. There is no
 * "account not found", no "wrong password", no lockout notice and no field any of them could be
 * written into.
 *
 * ===========================================================================================
 * WHAT THIS PATH DOES NOT WRITE, AND WHY EACH ABSENCE IS DELIBERATE
 * ===========================================================================================
 *
 * NO AUDIT ROW. `.claude/rules/security.md` §6 requires money, permission changes, membership
 * changes, export and destructive actions to be audited; a login attempt is none of them, and
 * `audit_event` is TENANT-SCOPED while a login has no tenant — a login is what discovers the
 * tenant. `control-plane-admission.ts` states the second reason and it is the stronger one: *"a
 * D1 write per authentication attempt is `0013`'s hole reopened on a path with no authorization
 * above it."* Denied logins leave evidence through the pre-auth grouping instead —
 * `(entryPointId, category)`, whose cardinality is fixed at build time — and never by the
 * submitted identifier or the source address. `0015` records the test that settles this: it is
 * not "can the caller forge it", it is "what does a new value cost the attacker".
 *
 * NO ATTEMPT COUNTER AND NO LOCKOUT. Per-account throttling is the standard answer and, built the
 * obvious way, it is exactly the account-existence oracle `0014` §B forbids — a real account locks
 * after five attempts and a nonexistent one never locks — as well as a per-account denial of
 * service anyone can trigger. What runs instead is the bucketed identifier limiter in
 * `pre-auth-admission.ts`, whose hole is documented there and is not re-argued here.
 *
 * NO WRITE AT ALL ON A FAILED LOGIN. The only durable write on this path is the session row, and
 * it happens after verification, under a reservation drawn from the control-plane admission port
 * for the VERIFIED principal — 3 row-writes, 1,000 logins/day platform-wide, 200 per principal
 * (`control-plane-admission.ts`). An unauthenticated caller cannot cause a write here at all.
 *
 * ===========================================================================================
 * LOGOUT: WHAT IT DOES, AND THE TWO DEFECTS `docs/decisions/0018` FIXED
 * ===========================================================================================
 *
 * It DELETES THE SESSION ROW and CLEARS THE COOKIE. Both halves matter and only the first one
 * existed when this slice was first written.
 *
 * DEFECT 1 — THE CLEARING COOKIE WAS UNREACHABLE. `http/pre-auth-http.ts::renderCredential` has a
 * branch that renders an empty value with `Max-Age=0`, and its comment claimed to be "how
 * `identity.session.revoke` removes a credential". It was not: a clearing cookie could only
 * travel on an `issued` outcome, and the registry declared revocation's only outcome as
 * `acknowledged`. The comment described code that could not execute, which is exactly what
 * stopped anyone noticing. `0018` §B added the `cleared` outcome — a CONSTANT, ARGUMENT-FREE
 * clearing cookie emitted on every revocation, byte-identical in all six cases below. It
 * discloses nothing because it never varies, which is what separates it from `issued` and why it
 * does not reintroduce the `collapseTo: 'issued'` hazard `outcomeOfKind` rightly refuses. It
 * REPLACES `acknowledged` here rather than joining it, so `assertRegistryIsCoherent`'s
 * one-outcome rule for a collapsed entry point still holds.
 *
 * DEFECT 2 — AN APPLE CLIENT USING `Bearer` COULD NOT LOG OUT. See `revokeHandler`. `0018` §A
 * lets the revocation entry point — and only that one — read `Authorization`.
 *
 * WHAT A CLIENT SHOULD STILL DO. The cookie is cleared at the browser now, but a session can also
 * end without a logout: absolute 12-hour expiry, a membership revoked, a principal suspended, or
 * `SESSION_HMAC_KEY` rotated. **A CLIENT MUST THEREFORE STILL TREAT `401` AS "LOGGED OUT" AND NOT
 * AS "RETRY"** — the clearing cookie removes one cause of a stale credential, not the class.
 */

import type {
  PreAuthBody,
  PreAuthHandlerRegistration,
  PreAuthHandlers,
  PreAuthOutcome,
  PreAuthPresentedCredentials,
} from './pre-auth-admission.ts';
import type { SessionResolver } from './session-resolution.ts';
import type { CredentialVerifier } from './credential-verifier.ts';
import type { SessionCredentialSigner } from './session-credential.ts';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from './session-credential.ts';

/** The field carrying the account identifier. Also the identifier-limiter's declared field. */
export const IDENTIFIER_FIELD = 'email';

/** The field carrying `0015` §D's `kdf_output`. See the header for its exact derivation. */
export const DERIVED_KEY_FIELD = 'derived_key';

/**
 * `identity.login.start` — REGISTERED, ACCEPTS AN EMAIL, AND DOES NOTHING WITH IT.
 *
 * ===========================================================================================
 * AN ENDPOINT THAT DOES NOTHING IS THE CORRECT IMPLEMENTATION HERE, NOT A PLACEHOLDER.
 * ===========================================================================================
 *
 * `0014` §B registered five entry points against an identity provider that had not been chosen.
 * `0015` §D chose one in which login start has no work to do: *"The salt has a forced answer. A
 * per-user random salt would need fetching before login, but `identity.login.start` is
 * `disclosure: 'collapsed'` and renders one constant body — there is no way to deliver a
 * server-chosen salt under the registry as built. Normalised email as the client salt removes the
 * round trip."* The client derives locally and posts to `identity.login.complete`. There is
 * nothing for a start handler to compute, to look up, or to return.
 *
 * WHY REGISTER ONE AT ALL RATHER THAN LEAVING IT ABSENT. An absent handler is not free: `dispatch`
 * announces `handler_absent` for it, once per isolate, through a channel operators are expected
 * to alert on. A deployed platform emitting "a pre-authentication entry point has no handler" for
 * an endpoint that is *deliberately* empty trains whoever reads that channel to ignore it, and
 * that channel is also where `evidence_unrecorded` and `identifier_level_absent` arrive. A control
 * an operator learns to ignore is a control that is off.
 *
 * IT PERFORMS NO LOOKUP, HOLDS NO STATE AND WRITES NOTHING, so the registry's `writes: true` on
 * this entry point is now an over-declaration rather than a requirement — harmless, and left
 * alone because changing it is an edit to `0014`'s registry for no gain.
 *
 * THE `email` FIELD IS ACCEPTED AND DISCARDED, AND IT EARNS ITS PLACE: declaring it as
 * `identifierField` is what applies the bucketed identifier rate limit to enumeration traffic
 * aimed at this endpoint. The value is read, keyed, bucketed and forgotten inside `bucketOf`; this
 * handler never sees a reason to touch it.
 */
function startHandler(): PreAuthHandlerRegistration {
  return {
    fields: [IDENTIFIER_FIELD],
    identifierField: IDENTIFIER_FIELD,
    async handle(): Promise<PreAuthOutcome> {
      // Constant work, constant answer, on every input. `identity.login.start` is
      // `disclosure: 'collapsed'` and declares `acknowledged` as its only outcome, so this is
      // also the only value the dispatcher would accept.
      return { kind: 'acknowledged' };
    },
  };
}

/**
 * `identity.login.complete` — verify, then issue.
 *
 * ===========================================================================================
 * THE ORDER IS THE SECURITY PROPERTY, AND IT IS SHORT ENOUGH TO CHECK BY EYE
 * ===========================================================================================
 *
 *   1. Read two fields. Anything absent or non-string is refused — the dispatcher has already
 *      rejected unknown fields, oversized values and non-primitives before this runs.
 *   2. VERIFY, WITH EQUAL WORK ON BOTH BRANCHES. `credential-verifier.ts` is where that property
 *      lives and where it is argued; this file must not add a branch above it.
 *   3. ONLY ON SUCCESS: issue a session, which reserves capacity and writes one row.
 *   4. Mint the credential and return it for the transport to set as a cookie.
 *
 * NO ORGANIZATION HINT IS ACCEPTED AT LOGIN, ALTHOUGH `issueSession` SUPPORTS ONE. Two reasons and
 * both are structural. It would add a membership lookup to some logins and not others, which is a
 * per-request work difference on the entry point whose timing is most closely watched. And it
 * would make the answer depend on the caller's membership in a named Organization — a valid
 * credential naming an Organization it does not belong to would be REFUSED where the same
 * credential naming nothing would be ISSUED, which is an Organization-membership oracle available
 * to anyone who steals one credential. A session is therefore always created with no Organization
 * selected, and the client's next call is the picker followed by `selectOrganization`, which is
 * the path `0014` §C.6 designed and hardened for exactly this question.
 *
 * THE CONSEQUENCE, STATED PLAINLY: a freshly issued session resolves to
 * `organization-not-selected`, so every business Action answers `failed_precondition` until an
 * Organization is chosen — and nothing in this repository creates an
 * `organization_membership` row, so today there is nothing to choose. Login works; the tenant
 * context behind it is the organization-structure slice's and is not built. Reported rather than
 * worked around.
 */
function completeHandler(dependencies: {
  readonly verifier: CredentialVerifier;
  readonly sessions: SessionResolver;
  readonly signer: SessionCredentialSigner;
}): PreAuthHandlerRegistration {
  const { verifier, sessions, signer } = dependencies;
  return {
    fields: [IDENTIFIER_FIELD, DERIVED_KEY_FIELD],
    identifierField: IDENTIFIER_FIELD,
    async handle(_context, body: PreAuthBody): Promise<PreAuthOutcome> {
      const identifier = stringField(body, IDENTIFIER_FIELD);
      const derivedKey = stringField(body, DERIVED_KEY_FIELD);
      if (identifier === null || derivedKey === null) {
        // A missing field is a fact about the request the caller wrote. It is refused with the
        // same fixed 401 everything else is refused with, because a distinct answer here would be
        // the first crack in a table whose whole value is that it has no exceptions.
        return { kind: 'refused' };
      }

      const verified = await verifier.verify(identifier, derivedKey);
      if (!verified.ok) {
        // The credential store could not answer. NOT `refused`: see `credential-verifier.ts`.
        return { kind: 'unavailable' };
      }
      if (verified.value.kind === 'refused') {
        return { kind: 'refused' };
      }

      const issued = await sessions.issueSession({
        verifiedPrincipalId: verified.value.principalId,
        requestedOrganizationId: null,
      });
      if (!issued.ok) {
        // ===================================================================================
        // THIS BRANCH IS ONLY REACHABLE BY A CALLER WHOSE CREDENTIAL WAS JUST VERIFIED, which
        // is what makes it safe to answer two different ways.
        //
        // `unauthenticated` — the control plane holds no active principal for the identifier the
        // credential matched: a suspended account, or a credential row whose principal was
        // deleted. It answers `refused`, IDENTICALLY to a wrong password, so suspension is not
        // distinguishable from a bad credential by anyone.
        //
        // ANYTHING ELSE — `quota_exceeded` from the daily control-plane ceiling, or a store
        // failure — is a Dudo-side inability to complete, and it answers `unavailable`. The
        // distinction is visible only to the holder of a correct credential and only about
        // Dudo's own availability, which is the test every error-code choice in this codebase is
        // held to (`kernel/errors.ts`). It matters operationally: a user told "wrong password"
        // when the platform is at its daily write ceiling will change their password, and then
        // they will still not be able to log in.
        // ===================================================================================
        return issued.error.code === 'unauthenticated'
          ? { kind: 'refused' }
          : { kind: 'unavailable' };
      }

      return {
        kind: 'issued',
        credentials: [
          {
            name: 'dudo_session',
            value: await signer.mint(issued.value.sessionId),
            // `HttpOnly`, `Secure`, `SameSite` and `Path` are forced by
            // `http/pre-auth-http.ts` and are deliberately not available here.
            maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
          },
        ],
      };
    },
  };
}

/**
 * `identity.session.revoke` — LOGOUT.
 *
 * ===========================================================================================
 * IT ACCEPTS NO BODY AT ALL, AND THAT IS A CONTROL RATHER THAN A SIMPLIFICATION.
 * ===========================================================================================
 *
 * `fields: []` means `parsePreAuthBody` rejects every field a caller sends. In particular there
 * is NO `session_id` FIELD AND THERE MUST NEVER BE ONE: a logout that took an identifier from the
 * body would let any unauthenticated caller delete any session it could name, which is a
 * denial-of-service against every user of the platform and needs no credential at all. The
 * session comes from the presented cookie, whose MAC is verified before anything is read.
 *
 * NO `identifierField` EITHER, so only the source-level rate limit applies. There is nothing to
 * bucket — revocation is never handed an account identifier — and inventing one would put every
 * logout in a single shared counter that an attacker could saturate to stop everyone logging out.
 *
 * ===========================================================================================
 * BOTH CARRIERS ARE ACCEPTED. `docs/decisions/0018` §A.
 * ===========================================================================================
 *
 * `0015` §A settled "one value, two carriers, one contract", and the authenticated path honours
 * both — but revocation read the `Cookie` header only, so **an Apple client presenting
 * `Authorization: Bearer` could not log out**, and this handler correctly answered "acknowledged"
 * while revoking nothing. A security action reporting success without performing it is the worst
 * shape a defect can take on this path: no client could detect it, and the `HttpOnly` cookie meant
 * none could compensate. `0018` §A calls it an oversight rather than a control, and it was.
 *
 * IT OPENS NO DISCLOSURE CHANNEL, which is the objection the amendment had to survive. The
 * response is a fixed constant regardless of what was presented or whether anything resolved, so
 * WHICH HEADER THE SERVER READS CANNOT VARY THE BYTES IT RETURNS. And `credentials.bearer()` is
 * not a header map: it returns one value, the transport gates it behind a closed allow-list of
 * entry points, and there is no parameter through which a handler could ask for a different
 * header.
 *
 * THE MISMATCH RULE STANDS. Both carriers present and disagreeing is a confusion attack — a
 * cookie an attacker can plant cross-site alongside a header the application sets, with the
 * server free to pick a winner — so nothing is revoked. The caller is still told the same thing,
 * because the outcome is fixed.
 *
 * ===========================================================================================
 * EVERY PATH RETURNS `cleared`. SIX OF THEM, AND THE UNIFORMITY IS THE SECURITY PROPERTY.
 * ===========================================================================================
 *
 *   nothing presented              nothing to do
 *   two carriers that disagree     a confusion attack. Nothing is revoked.
 *   MAC invalid                    a forgery. One HMAC, NO DATABASE READ.
 *   session not found              already gone, expired, or never existed
 *   session found and deleted      the real case
 *   the store or the budget said no
 *
 * A caller cannot tell them apart, which is what `disclosure: 'collapsed'` demands: an attacker
 * holding a stolen or guessed token must not learn from a logout whether it is live. `cleared`
 * renders the same body as every other success plus ONE FIXED clearing cookie the transport owns
 * — the handler supplies no name, no value and no lifetime, so there is nothing here that could
 * vary per request.
 *
 * THE RESULT OF `revokeSession` IS DELIBERATELY DISCARDED. There is nowhere to put it — the
 * outcome vocabulary has one value here — and a failure is not silent: it is announced internally
 * through the identity slice's own path, never through a response.
 */
function revokeHandler(dependencies: {
  readonly sessions: SessionResolver;
  readonly signer: SessionCredentialSigner;
}): PreAuthHandlerRegistration {
  const { sessions, signer } = dependencies;
  return {
    fields: [],
    async handle(
      _context,
      _body: PreAuthBody,
      credentials: PreAuthPresentedCredentials,
    ): Promise<PreAuthOutcome> {
      const cookie = emptyToUndefined(credentials.get('dudo_session'));
      const bearer = emptyToUndefined(credentials.bearer());

      if (cookie !== undefined && bearer !== undefined && cookie !== bearer) {
        // THE CONFUSION ATTACK. Revoke nothing rather than pick a winner — picking one is the
        // vulnerability, not the fix. The same rule `session-credential.ts` applies on the
        // authenticated path, applied here so the two carriers behave identically everywhere.
        return { kind: 'cleared' };
      }

      const presented = bearer ?? cookie;
      if (presented === undefined) {
        return { kind: 'cleared' };
      }

      // THE MAC FIRST. A forged or guessed credential is rejected here for the cost of one HMAC
      // and never reaches D1 — which is what stops logout being a free way to make an
      // unauthenticated caller drive database reads on a single-threaded engine.
      const sessionId = await signer.read(presented);
      if (sessionId === null) {
        return { kind: 'cleared' };
      }
      await sessions.revokeSession(sessionId);
      return { kind: 'cleared' };
    },
  };
}

/** An empty credential is an absent one. A header or cookie set to `""` is not a value. */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Reads a string field, or `null`.
 *
 * `PreAuthBody` values are `string | number | boolean` after Core's floor, so a caller can send
 * `{"email": 12345}` and reach this. It is not coerced: `String(12345)` would produce an
 * identifier nobody typed, and coercion on an authentication path is how a type-confusion bug
 * becomes a login bug.
 */
function stringField(body: PreAuthBody, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The handler table the composition root passes to `ApiDependencies.preAuth`.
 *
 * `identity.session.refresh` IS ABSENT BY OMISSION, WHICH IS THE FAIL-CLOSED DIRECTION:
 * `dispatchPreAuthRequest` collapses an unhandled delegated entry point to its declared
 * `collapseTo`, which is `refused` for refresh, and it cannot issue a credential because
 * `collapseTo` may never be `issued`. `0015` §B.3 keeps it registered on purpose — removing it
 * from the five would amend an Accepted decision.
 */
export function createLoginHandlers(dependencies: {
  readonly verifier: CredentialVerifier;
  readonly sessions: SessionResolver;
  readonly signer: SessionCredentialSigner;
}): PreAuthHandlers {
  return Object.freeze({
    'identity.login.start': startHandler(),
    'identity.login.complete': completeHandler(dependencies),
    'identity.session.revoke': revokeHandler(dependencies),
  });
}
