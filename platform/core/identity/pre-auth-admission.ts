/**
 * ===========================================================================================
 * THE ADMISSION RULE. `docs/decisions/0014` §B, and the half of it that is not a table.
 * ===========================================================================================
 *
 * `pre-auth-registry.ts` says WHICH routes are admitted. This file says what admission MEANS,
 * and every obligation §B lists is enforced here against a flag the registry declares:
 *
 *   strict input validation           `parsePreAuthBody`, a Core floor that runs before any
 *                                     handler and rejects anything it has not been told to
 *                                     expect.
 *   rate limiting                     `PreAuthLimiter`, at the levels that EXIST without a
 *                                     principal. Which those are, and what is left open, is
 *                                     the long comment on `derivePreAuthRateSubject`.
 *   reveal no account-existence       Five channels, each closed separately and each named:
 *   difference                        body, code, SIZE, TIMING, and the limiter itself. See
 *                                     `THE FIVE CHANNELS` below.
 *   access no tenant business data    Structural: there is no `TenantStoreResolver`, no
 *                                     `TenantScopedStore` and no `ActionContext` in this file
 *                                     or in `PreAuthContext`. A handler has nothing to query.
 *   issue no business permission      Structural: `PreAuthOutcome` has no grant, no scope, no
 *                                     permission and no principal. Its only success payload is
 *                                     an opaque credential the transport sets as a cookie, and
 *                                     a credential is not a permission — it is a thing a LATER,
 *                                     authenticated request presents so that Core can derive a
 *                                     principal through the ordinary path.
 *   fail closed                       Every unknown, missing, malformed, thrown and unreachable
 *                                     case below lands on the entry point's `collapseTo`, and
 *                                     `collapseTo` is never `issued` for any entry point.
 *
 * ===========================================================================================
 * THE FIVE CHANNELS AN ACCOUNT-EXISTENCE ORACLE ARRIVES THROUGH
 * ===========================================================================================
 *
 * 1. THE BODY AND THE ERROR CODE. The handler does not choose them. It returns a member of a
 *    four-value closed union with no message, no detail and no field it could put a value in;
 *    Core maps that to a response from a fixed table (`http/pre-auth-http.ts`). For a
 *    `collapsed` entry point the mapping is constant, so login start answers the same thing for
 *    an address that has an account, an address that does not, and an outage.
 *
 * 2. THE SIZE. It follows from 1: a fixed body is a fixed length. The only per-request variation
 *    in a refusal is `request_id`, which is 22 characters from `kernel/ids.ts` on every response
 *    Dudo has ever sent, and which `MULTITENANCY_STANDARD.md` §4 already names as the one
 *    permitted difference.
 *
 * 3. THE TIMING. The hard one, and the one a fixed body does nothing about: a real credential
 *    check is slower than an early return, and that difference is the oracle. Two mechanisms,
 *    and NEITHER of them is sufficient alone — see `equalizeResponseTiming`, which is written to
 *    be honest about what a response floor can and cannot buy.
 *
 * 4. THE RATE LIMITER. If a nonexistent account is limited differently from a real one, the
 *    limiter is the oracle. Closed by construction: `derivePreAuthRateSubject` has NO PARAMETER
 *    an account identifier could arrive through, and the optional identifier level counts a
 *    BUCKET of a keyed hash — computed identically, before anything is looked up, for a string
 *    that names an account and for a string that names nothing.
 *
 * 5. THE EVIDENCE TRAIL. `0013` groups denials by principal, and a pre-auth request HAS no
 *    principal. What it groups by instead — and why the two obvious answers are both wrong — is
 *    `derivePreAuthEvidenceKey`.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { Clock } from '../kernel/clock.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import { detail, invalidArgument, unavailable } from '../kernel/errors.ts';
import { EMISSION_LADDER, RATE_WINDOW_MS, windowStart } from '../protection/coordination.ts';
import type {
  DelegatedPreAuthEntryPointId,
  PreAuthEntryPoint,
  PreAuthEntryPointId,
  PreAuthOutcomeKind,
} from './pre-auth-registry.ts';
import { assertRegisteredPreAuthEntryPoint, HEALTH_BODY_TEXT } from './pre-auth-registry.ts';

// =============================================================================================
// What a pre-auth handler may receive and may return
// =============================================================================================

/**
 * A validated pre-auth request body. Flat, small, and made only of primitives.
 *
 * IT IS NOT `unknown` AND NOT `Record<string, unknown>`, and that is `parsePreAuthBody`'s
 * doing rather than a convention: a handler on this path runs before authentication, so the
 * value it receives is the least trustworthy input in the platform, and a nested object is a
 * parser differential waiting to happen.
 */
export type PreAuthBody = Readonly<Record<string, string | number | boolean>>;

/**
 * The only names a pre-auth entry point may set a credential under.
 *
 * A CLOSED SET, so a handler cannot name a cookie after something the browser or another part
 * of the platform treats specially, and so that revocation knows exactly what it has to clear.
 */
export type PreAuthCredentialName = 'dudo_session' | 'dudo_refresh' | 'dudo_login_state';

/**
 * An opaque credential for the transport to set.
 *
 * CORE NEVER INTERPRETS `value` AND CANNOT: it is a string that is written to a header and read
 * back on a later request by whatever issued it. It is not a permission, it does not appear in
 * any authorization decision, and nothing in `authorization/**` can see it.
 *
 * THE COOKIE ATTRIBUTES ARE NOT HERE, DELIBERATELY. `HttpOnly`, `Secure`, `SameSite` and `Path`
 * are forced by `http/pre-auth-http.ts` and are not the handler's to choose. A handler that
 * could choose them could ship a session cookie readable from JavaScript, and that is not a
 * decision that should be available at a call site.
 */
export type PreAuthCredential = {
  readonly name: PreAuthCredentialName;
  readonly value: string;
  /** Clamped by the transport. Zero clears the credential, which is how revocation works. */
  readonly maxAgeSeconds: number;
};

/**
 * The closed outcome vocabulary. FOUR VALUES, NO PAYLOAD EXCEPT AN OPAQUE CREDENTIAL.
 *
 * There is no `message`, no `details`, no `code`, no `reason`, no `Record<string, unknown>` and
 * no field a handler could put a value in — the same structural argument as `notFound()` taking
 * no arguments (`kernel/errors.ts`). A handler that has just discovered that an account does not
 * exist has nowhere to say so.
 */
export type PreAuthOutcome =
  | { readonly kind: 'acknowledged' }
  | { readonly kind: 'issued'; readonly credentials: readonly PreAuthCredential[] }
  /**
   * REVOCATION. `docs/decisions/0018` §B. NOTE THAT IT HAS NO `credentials` FIELD, and that is
   * the difference from `issued` rather than a simplification of it: the clearing cookie is a
   * constant the transport emits, so there is no value here for a handler to choose, to vary per
   * request, or to be steered into setting. See `PreAuthOutcomeKind` in `pre-auth-registry.ts`.
   */
  | { readonly kind: 'cleared' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' };

/**
 * What a handler is given.
 *
 * NOTE WHAT IS NOT HERE. No `store`, no `resolver`, no `audit`, no `principal`, no
 * `organizationId`, no `cursors`. A pre-auth handler cannot reach tenant business data because
 * it is handed nothing that reaches any data at all — §B's "access no tenant business data",
 * held by construction rather than by a rule the handler has to follow.
 *
 * The identity slice's own control-plane port is NOT injected here either. It is closed over by
 * the handler the identity slice registers, so this file never names it and never has to know
 * that it exists.
 */
export type PreAuthContext = {
  readonly entryPointId: DelegatedPreAuthEntryPointId;
  readonly clock: Clock;
  /** For correlating this attempt in the identity slice's own logs. Not a principal. */
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * ===========================================================================================
 * `0014` §A AND THE PRE-AUTH PATH: WHICH OF THE FIVE WRITE, AND FROM WHICH ALLOCATION.
 * ===========================================================================================
 *
 * §A.11: *"All storage writers must use this admission port. Direct D1 writes outside it are
 * prohibited."* That applies here as much as anywhere, and the answer per entry point is:
 *
 *   platform.health            WRITES NOTHING, structurally. It is `kind: 'static'`, so there is
 *                              no handler, no code and nothing that could write.
 *   identity.login.start       WRITES, under any scheme that issues a challenge or a one-time
 *                              code. (An OIDC redirect scheme carrying state in a signed value
 *                              would not — that choice is `0014`'s "identity provider itself",
 *                              which is not settled.)
 *   identity.login.complete    WRITES: a session record.
 *   identity.session.refresh   WRITES: a rotated session record.
 *   identity.session.revoke    WRITES: a revocation.
 *
 * THE FOUR WRITES ARE CONTROL-PLANE WRITES (`0014` §C.3), so they do not go through
 * `TenantScopedStore` and cannot: a session belongs to a principal and not to an Organization,
 * which is §C.1's whole point. **This file gives a handler no store of any kind**, so whatever
 * it writes, it writes through the identity slice's own control-plane port — and that port is
 * where the reservation must be taken.
 *
 * ===========================================================================================
 * AND THERE IS NO ALLOCATION FOR THEM. THIS IS A GAP IN §A.5, REPORTED RATHER THAN CHOSEN.
 * ===========================================================================================
 *
 * §A.5 names three allocations: `business` ("normal business mutations and their audit
 * records"), `security` ("security and audit summaries"), and `system` ("controlled system
 * operations"). A session write is none of the three:
 *
 *   NOT `business`  — that allocation is drawn through `RequestCoordination.reserveWrites`,
 *                     which has no allocation parameter and is bound to an AUTHENTICATED
 *                     Organization. A login has no Organization; that is what it is trying to
 *                     find out. There is no way to charge it, and charging it to an Organization
 *                     the caller named would be the caller-supplied tenant identifier
 *                     `MULTITENANCY_STANDARD.md` §3 prohibits, arriving through the budget.
 *   NOT `security`  — that is denial summaries and security evidence. A successful login is
 *                     neither, and charging ordinary product traffic to the evidence allocation
 *                     would let logins starve the denial trail, which is the exact starvation
 *                     `0013` control 9 exists to prevent.
 *   NOT `system`    — on the description. "Migrations, retention, scheduled maintenance" is
 *                     operator-initiated work; a login is triggered from outside by a party the
 *                     platform has not authorized yet, and charging it there spends a reserve
 *                     held for emergency operator work on caller-driven traffic.
 *
 * A SECOND, INDEPENDENT MISMATCH: `WriteReservation` carries a REQUIRED `organizationId` and
 * `consumeWriteReservation` refuses a reservation whose Organization does not match the store
 * handle's. A tenantless write cannot obtain one, so `mintWriteReservation` cannot be called for
 * a session even if an allocation existed.
 *
 * `identity/control-plane-admission.ts` (`0014` §C, built alongside this) REACHED BOTH FINDINGS
 * INDEPENDENTLY and resolved them for the writes it owns: a separate principal-bound receipt
 * rather than a placeholder Organization, and `system` chosen as the least-bad of three
 * imperfect fits on the ground that its failure mode — delayed migrations — is the only
 * recoverable one. That reasoning is sound and this file does not contradict it. What both
 * findings share is the part neither agent can settle: **§A.5's three-way split has no slot for
 * an externally-triggered platform write, and choosing one in a source file is choosing it in
 * the wrong place.** Reported to the Team Lead for a decision record.
 *
 * THE PRE-AUTH EVIDENCE WRITES ARE A SEPARATE CHARGE AND BELONG TO `security`, with `0013`'s
 * denial summaries, because they are security evidence and nothing else. **That allocation is
 * now over-subscribed on paper**: `protection/coordination.ts` already accounts roughly four
 * simultaneous all-day campaigns at 9,216 of its 10,000, and this path's worst case adds 2,160.
 * In practice the groups do not all saturate and the emission ladder makes a quiet group cost
 * one or two rows — but 11,376 against 10,000 is an arithmetic fact and it is stated rather than
 * left for someone to rediscover as dropped evidence.
 *
 * NOTHING WRITES UNACCOUNTED ROWS IN THE MEANTIME, by construction: no handler is registered, no
 * evidence recorder is composed, and `ApiDependencies.preAuth` is absent, so none of the five
 * entry points is reachable at all.
 */
export type PreAuthHandler = (
  context: PreAuthContext,
  body: PreAuthBody,
  credentials: PreAuthPresentedCredentials,
) => Promise<PreAuthOutcome>;

/**
 * The credentials the caller presented, read from the request by the transport.
 *
 * SEPARATE FROM `body` BECAUSE THEY HAVE DIFFERENT PROVENANCE AND DIFFERENT RULES: a body field
 * is validated against a declared shape, a presented credential is an opaque string that is
 * only ever verified. Merging them would let a caller supply a "session" as a body field, which
 * is the pre-auth version of the header/query/body tenant-override vector `http/router.ts`
 * refuses.
 */
export type PreAuthPresentedCredentials = {
  get(name: PreAuthCredentialName): string | undefined;
  /**
   * The `Authorization: Bearer` credential, or `undefined`.
   *
   * ===========================================================================================
   * `docs/decisions/0018` §A. THIS IS NOT A HEADER MAP AND MUST NEVER BECOME ONE.
   * ===========================================================================================
   *
   * `PreAuthRequest` still carries no headers, for the reason stated there and unchanged: *"a
   * handler with the header map is a handler that can read a caller-supplied
   * `X-Organization-Id`."* This method returns ONE value — the credential after the `Bearer`
   * scheme — and there is no parameter through which a handler could ask for any other header.
   * The transport parses it; a handler cannot reach past it.
   *
   * IT IS `undefined` FOR EVERY ENTRY POINT EXCEPT REVOCATION, and that is enforced in the
   * transport rather than trusted here: `readPresentedCredentials` takes the entry-point id and
   * consults a closed allow-list. `0018` §A widened exactly one route, and widening a second is a
   * deliberate edit to that list.
   *
   * WHY IT OPENS NO CHANNEL. The value is only ever VERIFIED, never trusted — identical to a
   * cookie — and revocation's response is a fixed constant regardless of what was presented or
   * whether anything resolved. Which header the server reads cannot vary the bytes it returns.
   */
  bearer(): string | undefined;
};

/**
 * A handler as it is registered, with the two things Core needs to enforce §B on its behalf.
 *
 * `fields` IS REQUIRED AND MAY BE EMPTY, exactly as the App manifest's security-relevant
 * collections are: "this entry point accepts no body fields" has to be an explicit statement
 * rather than an omission, because an omission is how an endpoint ends up accepting anything.
 */
export type PreAuthHandlerRegistration = {
  readonly handle: PreAuthHandler;
  /** The complete set of body field names this entry point accepts. Anything else is rejected. */
  readonly fields: readonly string[];
  /**
   * Which body field, if any, carries an ACCOUNT IDENTIFIER.
   *
   * Declared so the identifier rate-limit level can be applied WITHOUT Core guessing, and
   * without the identifier ever being used for anything else: it is read, keyed, bucketed and
   * discarded inside `bucketOf`. It is never logged, never grouped by, never stored, and never
   * compared against anything, because comparing it against anything is what an existence oracle
   * is made of.
   */
  readonly identifierField?: string;
};

export type PreAuthHandlers = Partial<
  Readonly<Record<DelegatedPreAuthEntryPointId, PreAuthHandlerRegistration>>
>;

// =============================================================================================
// Channel 1 and 2 — input validation, before any handler
// =============================================================================================

/**
 * The body floor. Small, flat, primitive, and bounded on every axis a parser can be attacked on.
 *
 * WHY CORE VALIDATES AT ALL WHEN THE HANDLER WILL VALIDATE TOO. The handler belongs to the
 * identity slice; this floor belongs to Core, and §B's "strict input validation" is Core's
 * obligation on every registered entry point rather than each handler's promise. It is also the
 * only validation that exists TODAY, because no handler is registered.
 *
 * THE LIMITS AND WHAT EACH ONE STOPS:
 *   4 KiB total      an unauthenticated caller cannot make Dudo parse a megabyte.
 *   12 fields        a bounded object, so field-count is not a work multiplier.
 *   512 characters   the longest plausible email address or opaque code, and short enough that
 *                    a hash over it is constant-ish work.
 *   no nesting       arrays and objects are rejected outright. Type confusion between `"a"` and
 *                    `{"toString": ...}` is a class of bug this path cannot afford.
 *   declared names   a field the entry point did not declare is `unknown_field`, matching the
 *                    `additionalProperties: false` rule every Action input already follows.
 */
export const PRE_AUTH_MAX_BODY_BYTES = 4096;
export const PRE_AUTH_MAX_FIELDS = 12;
export const PRE_AUTH_MAX_FIELD_LENGTH = 512;

export function parsePreAuthBody(
  text: string,
  declaredFields: readonly string[],
): Result<PreAuthBody> {
  if (text.length === 0) {
    return ok(Object.freeze(Object.create(null) as Record<string, never>));
  }
  // Measured in BYTES rather than characters: a multi-byte string is longer than its length.
  if (new TextEncoder().encode(text).length > PRE_AUTH_MAX_BODY_BYTES) {
    return err(invalidArgument([detail('', 'body_too_large')]));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err(invalidArgument([detail('', 'must_be_valid_json')]));
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(invalidArgument([detail('', 'must_be_an_object')]));
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > PRE_AUTH_MAX_FIELDS) {
    return err(invalidArgument([detail('', 'too_many_fields')]));
  }

  const declared = new Set(declaredFields);
  const result: Record<string, string | number | boolean> = Object.create(null);
  for (const [key, value] of entries) {
    if (!declared.has(key)) {
      // The FIELD NAME is echoed and the VALUE never is — `detail()` has no parameter for one.
      // A rejected value written into a log is a copy of a credential in a store with different
      // access rules.
      return err(invalidArgument([detail(key, 'unknown_field')]));
    }
    if (typeof value === 'string') {
      if (value.length > PRE_AUTH_MAX_FIELD_LENGTH) {
        return err(invalidArgument([detail(key, 'too_long')]));
      }
      result[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return err(invalidArgument([detail(key, 'must_be_finite')]));
      }
      result[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      result[key] = value;
      continue;
    }
    return err(invalidArgument([detail(key, 'must_be_a_primitive')]));
  }
  return ok(Object.freeze(result));
}

// =============================================================================================
// Channel 4 — rate limiting without an actor
// =============================================================================================

const PRE_AUTH_RATE_SUBJECT_BRAND: unique symbol = Symbol('dudo.identity.preAuthRateSubject');

/**
 * ===========================================================================================
 * THE LEVELS THAT EXIST WITHOUT A PRINCIPAL, AND THE ONE THAT DOES NOT.
 * ===========================================================================================
 *
 * `0013` control 6 enforces three levels: ACTOR, ORGANIZATION and SOURCE.
 *
 *   ACTOR         **CANNOT APPLY.** It is keyed by `principalId` from the authenticated
 *                 context, and a pre-auth request has no principal. This is not a level that is
 *                 switched off here — it is a level with no input, and `CoordinatedRequest`
 *                 cannot even be constructed without an `organizationId` and a `principalId`.
 *   ORGANIZATION  **CANNOT APPLY**, and for a reason that is easy to state wrongly. It is not
 *                 merely that the Organization is unknown: `0014` §C.5 fixes the resolution
 *                 order as `session → principal → memberships → Organization`, so at a pre-auth
 *                 entry point the Organization is *downstream of the thing being requested*. Any
 *                 attempt to key a pre-auth limiter by Organization would have to take it from
 *                 the request — which is the caller-supplied tenant identifier
 *                 `MULTITENANCY_STANDARD.md` §3 prohibits, arriving through the limiter instead
 *                 of through the query.
 *   SOURCE        **APPLIES**, and is the only one of the three that does. It is keyed by the
 *                 hashed address the edge supplies (`http/adapters/worker-entry.ts`), which no
 *                 caller controls.
 *
 * ===========================================================================================
 * IS THE SOURCE LEVEL ALONE SUFFICIENT? NO. IT LEAVES TWO HOLES, AND THEY ARE DIFFERENT SIZES.
 * ===========================================================================================
 *
 * HOLE 1 — DISTRIBUTED VOLUME. A source limit bounds one address. An attacker with a thousand
 * addresses has a thousand times the budget, and IPv6 makes addresses close to free. `0013`
 * already refuses to claim volumetric protection — "this is not DDoS resistance and must never
 * be described as such" — and nothing here changes that. What the source level buys is that a
 * SINGLE machine cannot spend the platform's capacity on login attempts.
 *
 * HOLE 2 — ONLINE CREDENTIAL GUESSING, AND IT IS THE ONE THAT MATTERS. At 20 attempts per
 * minute per address, an attacker with a hundred addresses makes 2,880,000 attempts a day
 * against a password. A source limit does not bound attempts PER ACCOUNT, and per-account is
 * the only dimension a guessing attack is expensive in.
 *
 * THE CONTROL THAT WOULD CLOSE HOLE 2 IS ALSO THE ORACLE. Per-account throttling is the
 * standard answer, and implemented in the obvious way it is exactly what §B forbids: a real
 * account gets locked after five attempts, a nonexistent one is never locked because there is
 * nothing to lock, and the difference is readable from one request. It is ALSO a per-account
 * denial of service — anyone can lock any user out by failing five times.
 *
 * SO THE IDENTIFIER LEVEL BELOW COUNTS A BUCKET, NOT AN ACCOUNT. `PRE_AUTH_IDENTIFIER_BUCKETS`
 * keyed buckets, assigned by an HMAC of the normalised submitted string. Three properties fall
 * out, and all three are needed:
 *
 *   - IT IS COMPUTED BEFORE ANYTHING IS LOOKED UP, from the string the caller typed. A string
 *     naming a real account and a string naming nothing take the identical path and land in
 *     indistinguishable buckets. **There is no existence input to the limiter, so there is no
 *     existence output.**
 *   - ITS CARDINALITY IS FIXED AT BUILD TIME. This is `0013` control 5 one layer down: an
 *     attacker who supplied a fresh identifier per attempt would mint unlimited counters if the
 *     key were the identifier, and mints none here, because the bucket count does not depend on
 *     what was typed.
 *   - THE KEY IS SECRET, so the bucket a given account falls in is not computable by an attacker
 *     and cannot be targeted.
 *
 * WHAT IT COSTS, STATED RATHER THAN DISCOVERED: accounts sharing a bucket share a limit. With
 * 4,096 buckets and a small tenant base, collisions are rare and the coupling is the same shape
 * as the NAT coupling `protection/coordination.ts` already accepts for the source level. As the
 * user base grows the bucket count must grow with it, and that is a number to watch rather than
 * a property that holds forever.
 *
 * IT IS OPTIONAL IN COMPOSITION AND ITS ABSENCE IS LOUD. The bucketer needs a secret, and a
 * Worker secret is shared configuration the Team Lead provisions. Without one, `dispatch` runs
 * the source level only and `announcePreAuthFailure` reports `identifier_level_absent` on every
 * request that would have used it — so "we shipped without the level that bounds guessing" is
 * visible rather than quiet.
 */
export type PreAuthRateSubject = {
  readonly [PRE_AUTH_RATE_SUBJECT_BRAND]: true;
  readonly entryPointId: PreAuthEntryPointId;
  readonly level: 'source' | 'identifier';
  /** A hashed address, or a bucket number. NEVER an account identifier; see the constructor. */
  readonly key: string;
};

/** Every unknown source shares this bucket. Not an exemption — the same rule as `0013`'s. */
export const UNKNOWN_PRE_AUTH_SOURCE = 'unknown-source';

/**
 * The SOURCE subject.
 *
 * ITS PARAMETERS ARE AN ENTRY-POINT ID FROM A FIVE-VALUE CLOSED UNION AND A HASH THE EDGE
 * PRODUCED. There is no parameter an account identifier, an email address, a username or any
 * other caller-supplied string could arrive through — the same device `deriveDenialGroupKey`
 * uses, for the same reason, one layer earlier in the request.
 */
export function derivePreAuthSourceSubject(
  entryPointId: PreAuthEntryPointId,
  sourceAddressHash: string | null,
): PreAuthRateSubject {
  return brandSubject({
    entryPointId,
    level: 'source',
    key: sourceAddressHash === null || sourceAddressHash.length === 0
      ? UNKNOWN_PRE_AUTH_SOURCE
      : sourceAddressHash,
  });
}

/**
 * The IDENTIFIER subject.
 *
 * ITS PARAMETER IS A BUCKET NUMBER, NOT A STRING. That is the whole safety argument in the
 * signature: this function cannot be called with an email address, because a `number` in
 * `[0, PRE_AUTH_IDENTIFIER_BUCKETS)` is the only thing it accepts, and the only way to obtain
 * one is `PreAuthIdentifierBucketer.bucket`, which discards its input.
 */
export function derivePreAuthIdentifierSubject(
  entryPointId: PreAuthEntryPointId,
  bucket: number,
): PreAuthRateSubject {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= PRE_AUTH_IDENTIFIER_BUCKETS) {
    throw new PreAuthRateSubjectError(
      `A pre-authentication identifier bucket must be an integer in [0, ` +
        `${String(PRE_AUTH_IDENTIFIER_BUCKETS)}). A value outside that range means the bucketer ` +
        'returned something derived from the identifier itself, which would make the counter ' +
        'cardinality caller-controlled — the unbounded grouping docs/decisions/0013 control 5 ' +
        'exists to prevent.',
    );
  }
  return brandSubject({ entryPointId, level: 'identifier', key: `bucket:${String(bucket)}` });
}

export class PreAuthRateSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreAuthRateSubjectError';
  }
}

function brandSubject(fields: {
  entryPointId: PreAuthEntryPointId;
  level: 'source' | 'identifier';
  key: string;
}): PreAuthRateSubject {
  const subject = { ...fields };
  Object.defineProperty(subject, PRE_AUTH_RATE_SUBJECT_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(subject) as PreAuthRateSubject;
}

export function assertPreAuthRateSubject(value: PreAuthRateSubject): void {
  const branded = value as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[PRE_AUTH_RATE_SUBJECT_BRAND] !== true) {
    throw new PreAuthRateSubjectError(
      'A pre-authentication rate-limit subject was supplied that did not come from ' +
        'derivePreAuthSourceSubject or derivePreAuthIdentifierSubject. Those two constructors ' +
        'are the only channels, and neither has a parameter an account identifier can arrive ' +
        'through: a limiter keyed by the account is an account-existence oracle and a ' +
        'per-account denial of service at once (docs/decisions/0014 §B).',
    );
  }
}

/** Fixed at build time. See the argument on `PreAuthRateSubject`. */
export const PRE_AUTH_IDENTIFIER_BUCKETS = 4096;

/** Attempts per bucket per 60-second window, across all sources. */
export const PRE_AUTH_IDENTIFIER_LIMIT_PER_WINDOW = 12;

export type PreAuthRateDecision = {
  readonly allowed: boolean;
  /**
   * Seconds to the END OF THE FIXED WINDOW, so it is the same value for every caller at that
   * instant — `0014`'s rule for `retry_after_seconds` exactly. It is never derived from observed
   * usage or remaining budget, because either would vary per caller and therefore carry signal.
   */
  readonly retryAfterSeconds: number;
};

/**
 * The limiter port.
 *
 * IT IS NOT `RequestCoordinator`. That one's `begin` requires an `organizationId` and a
 * `principalId` and instantiates a per-Organization coordinator, none of which exists here. The
 * shapes are deliberately not unified: a single port that served both would need those fields to
 * be optional, and an optional tenant on a security control is how a null Organization ends up
 * sharing a counter with a real one.
 */
export type PreAuthLimiter = {
  check(
    subject: PreAuthRateSubject,
    limitPerWindow: number,
    nowMs: number,
  ): Promise<Result<PreAuthRateDecision>>;
};

/** Seconds to the end of the current fixed 60-second window. A pure function of the clock. */
export function retryAfterSecondsUntilWindowEnd(nowMs: number): number {
  const end = windowStart(nowMs, RATE_WINDOW_MS) + RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((end - nowMs) / 1000));
}

/**
 * Turns a submitted identifier into a bucket and forgets it.
 *
 * `bucket` RETURNS A NUMBER AND NOTHING ELSE. It cannot return the hash, the normalised string
 * or anything else derived from the input, so no call site can accidentally propagate the
 * identifier into a counter, a log or a group key.
 */
export type PreAuthIdentifierBucketer = {
  bucket(entryPointId: PreAuthEntryPointId, identifier: string): Promise<number>;
};

/**
 * The WebCrypto implementation. HMAC-SHA-256, keyed by a Worker secret.
 *
 * NOT HAND-ROLLED AND NOT A PLAIN HASH. A plain SHA-256 would let an attacker compute which
 * bucket any address falls in and target a bucket deliberately; the key is what makes the
 * assignment unpredictable. `crypto.subtle` is a platform global in Workers and in Node, so this
 * names no vendor type and adds no dependency (`kernel/ids.ts` sets the same precedent with
 * `crypto.getRandomValues`).
 *
 * THE ENTRY-POINT ID IS IN THE MESSAGE, so the same address occupies unrelated buckets on login
 * start and on login completion. Without it, saturating one entry point's bucket would throttle
 * the other for the same users.
 *
 * NORMALISATION IS PART OF THE CONTROL, NOT TIDINESS. Without NFKC and case folding, `A@b.com`
 * and `a@b.com` land in different buckets, and an attacker walks the case variants of one
 * address to multiply its per-bucket allowance. Normalising first collapses them onto one
 * counter.
 */
export async function createHmacIdentifierBucketer(
  secret: CryptoBytes,
): Promise<PreAuthIdentifierBucketer> {
  if (secret.length < 32) {
    throw new PreAuthRateSubjectError(
      'The pre-authentication identifier bucketing key must be at least 32 bytes. It is a ' +
        'Worker secret provisioned by the Team Lead and is never held in the repository.',
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return {
    async bucket(entryPointId: PreAuthEntryPointId, identifier: string): Promise<number> {
      const normalized = identifier.normalize('NFKC').trim().toLowerCase();
      const message = new TextEncoder().encode(`${entryPointId} ${normalized}`);
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
      // Four bytes is far more entropy than 4,096 buckets needs, and taking a prefix of an HMAC
      // is a standard truncation rather than an invention.
      const value =
        ((signature[0] << 24) | (signature[1] << 16) | (signature[2] << 8) | signature[3]) >>> 0;
      return value % PRE_AUTH_IDENTIFIER_BUCKETS;
    },
  };
}

// =============================================================================================
// Channel 3 — timing
// =============================================================================================

/**
 * ===========================================================================================
 * THE RESPONSE FLOOR, AND AN HONEST ACCOUNT OF WHAT IT BUYS.
 * ===========================================================================================
 *
 * THE ORACLE, STATED PRECISELY. Verifying a password against a stored hash is deliberately slow
 * — that is what a password hash is for. Discovering that no such account exists is a lookup
 * that misses, and it is fast. A caller with a stopwatch reads the difference on the first
 * request, and no amount of care with the response BODY changes it. This is the channel most
 * login implementations get wrong, and it is the one a fixed error message looks like it has
 * fixed.
 *
 * MECHANISM 1 — A QUANTISED RESPONSE DEADLINE. Every request that reaches a handler on an
 * existence-sensitive entry point is held until `startedAtMs + n * PRE_AUTH_RESPONSE_FLOOR_MS`,
 * where `n` is the smallest positive integer that puts the deadline past the work. Two requests
 * whose real work differs by anything less than the floor are indistinguishable, because they
 * are answered at the same instant.
 *
 * WHAT MECHANISM 1 DOES NOT DO, AND THIS IS THE PART THAT MUST NOT BE OVERSTATED. If the real
 * work for a REAL account exceeds the floor and the work for a NONEXISTENT one does not, the two
 * land in different quanta — 500 ms against 250 ms — and the oracle is back, coarser but intact.
 * A response floor converts a continuous timing signal into a discrete one; it does not remove
 * it. Anyone who reads this file and concludes "the floor handles timing" has read it wrongly.
 *
 * MECHANISM 2 — EQUAL WORK ON BOTH BRANCHES, WHICH IS THE ONE THAT ACTUALLY CLOSES IT. The
 * handler must perform the SAME expensive verification whether or not the account exists: when
 * the lookup misses, it verifies the presented credential against a FIXED DUMMY RECORD of the
 * same cost and discards the result. That is the standard construction and it is the only one
 * that makes the two branches genuinely equal rather than merely bucketed.
 *
 * MECHANISM 2 LIVES IN THE HANDLER, WHICH IS THE IDENTITY SLICE'S CODE AND NOT CORE'S, SO CORE
 * CANNOT ENFORCE IT — AND SAYS SO RATHER THAN IMPLYING OTHERWISE. What Core does instead is make
 * every failure of it LOUD: `dispatchPreAuthRequest` measures each handler and announces
 * `timing_overrun` whenever its work exceeds the floor. An overrun is exactly the condition
 * under which mechanism 1 stops covering for mechanism 2, so the alert fires precisely when the
 * oracle could be open. That is a detection, not a prevention, and it is recorded as one.
 *
 * WHY 250 ms. Long enough to cover an argon2/scrypt verification and a control-plane round trip
 * on a warm path; short enough that a person logging in does not notice. It is a guess informed
 * by the shape of the work and NOT a measurement — there is no deployed runtime to measure — so
 * it is a number to revisit with real timings, and the overrun alert is what will say when.
 *
 * COST. A held response consumes wall-clock time and approximately no CPU, and Workers bills CPU
 * time rather than wall time, so this does not consume the Free plan's per-invocation CPU
 * allowance. It does hold the invocation open, which affects concurrency under load. That is a
 * projection from the published billing model, not a measurement, and it is stated as one.
 */
export const PRE_AUTH_RESPONSE_FLOOR_MS = 250;

export function quantizedDeadlineMs(startedAtMs: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - startedAtMs);
  const quanta = Math.max(1, Math.ceil((elapsed + 1) / PRE_AUTH_RESPONSE_FLOOR_MS));
  return startedAtMs + quanta * PRE_AUTH_RESPONSE_FLOOR_MS;
}

/**
 * Waiting, as a port.
 *
 * A PORT RATHER THAN A DIRECT `setTimeout` for the same reason `Clock` is one: a verification
 * harness must be able to observe that the wait was requested, and for how long, without waiting.
 */
export type PreAuthSleeper = {
  sleepUntil(deadlineMs: number, nowMs: number): Promise<void>;
};

/**
 * `setTimeout` is a Web platform global present in Workers and in Node, so this names no vendor
 * type. A sleeper that cannot find one does not wait — and that is a real degradation of the
 * timing control, so it is announced by the caller rather than silently accepted.
 */
export function createTimerSleeper(): PreAuthSleeper {
  return {
    async sleepUntil(deadlineMs: number, nowMs: number): Promise<void> {
      const wait = deadlineMs - nowMs;
      if (wait <= 0) {
        return;
      }
      const timer = (globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown })
        .setTimeout;
      if (typeof timer !== 'function') {
        return;
      }
      await new Promise<void>((resolve) => {
        timer(() => {
          resolve();
        }, wait);
      });
    },
  };
}

// =============================================================================================
// Channel 5 — the evidence trail, and the 0013 grouping question
// =============================================================================================

/**
 * ===========================================================================================
 * WHAT A PRE-AUTH DENIAL IS GROUPED BY. `0013` control 5, on a path with no principal.
 * ===========================================================================================
 *
 * `0013`'s `DenialGroupKey` is `(organizationId, principalId, appId, actionId, category)`, and
 * its boundedness argument rests on the first two coming from the authenticated context: *"its
 * cardinality is the number of CREDENTIALS the attacker holds — each one costs an
 * authentication, which is the property that makes this dimension expensive rather than free."*
 *
 * **A PRE-AUTH REQUEST HAS NEITHER FIELD, AND `deriveDenialGroupKey` CANNOT BE CALLED**: its only
 * parameter is an `AuthenticatedPrincipal`. So the pre-auth path needs its own grouping, and the
 * two candidates that come to mind first are both wrong.
 *
 * REJECTED — GROUPING BY THE SUBMITTED IDENTIFIER. It fails control 5 outright: the attacker
 * types the value, so the group count is the number of distinct strings it chooses to type,
 * which is unbounded and equals the per-attempt write count the aggregation replaced. It is ALSO
 * an existence disclosure of a kind `0013` never had to consider — the summary table would
 * become a durable, queryable list of the email addresses an attacker probed, sitting in Dudo's
 * own database, readable by anyone who can read the security evidence.
 *
 * REJECTED — GROUPING BY THE SOURCE ADDRESS HASH. This one LOOKS bounded, because an address is
 * server-derived and no caller can forge it, and that is exactly why it is the mistake worth
 * naming. **Server-derived is not the same as bounded.** The attacker chooses how many addresses
 * to attack from, and under IPv6 a single host is routinely given a /64 — eighteen quintillion
 * addresses, at no cost. Grouping by source hash therefore mints one group per address and
 * restores per-attempt writes under yet another name, against an account-wide D1 allowance whose
 * exhaustion is a platform outage. The address is fine as a RATE-LIMIT key, where a fresh
 * address buys a fresh allowance and nothing is written; it is not safe as a GROUP key, where a
 * fresh address buys a row.
 *
 * ACCEPTED — `(entryPointId, category)`. Every component is drawn from a set fixed at build
 * time:
 *
 *   entryPointId   the five-value closed union in `pre-auth-registry.ts`.
 *   category       the three values below.
 *
 * THE BOUND, AS A NUMBER: 5 × 3 = 15 groups, × 24 hourly windows = **360 group-windows per UTC
 * day, platform-wide**, at most `MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW` row-writes each = **2,160
 * row-writes/day worst case**, drawn from `DAILY_ALLOCATION.security`, whose 10,000 it shares
 * with `0013`'s denial summaries. Realistically only two or three groups are ever active and the
 * emission ladder makes a quiet group cost one or two rows.
 *
 * THE WINDOW IS AN HOUR RATHER THAN `0013`'s FIFTEEN MINUTES, and that is the arithmetic above:
 * at fifteen minutes the same key would cost up to 8,640 row-writes a day and could consume most
 * of the shared `security` allocation on its own, blinding the authenticated denial path that
 * `0013` was written to protect. The cost is detection latency on the COUNT, not on the
 * campaign: the ladder emits at the first attempt, so an attack is visible immediately and its
 * total converges over the hour.
 *
 * AND IT CANNOT BE AN EXISTENCE SIGNAL, which is the second half of the requirement. The key
 * contains nothing derived from what the caller submitted and nothing derived from what was
 * found. `refused` is emitted identically for a wrong credential on a real account and for an
 * identifier that names nothing, because `PreAuthOutcome` cannot distinguish them either —
 * channel 1 closed that before this code ever sees an outcome. **The grouping cannot leak a
 * distinction the outcome vocabulary is incapable of expressing.**
 *
 * WHAT IS LOST, STATED PLAINLY. There is no per-source attribution in the durable evidence: the
 * summary says "4,000 refusals at login completion this hour", not which addresses produced
 * them. That is a real reduction against what an authenticated denial summary offers, and it is
 * the price of the boundedness argument above. Per-source detail, if it is ever needed, belongs
 * in the limiter's own state or in the edge's request logs — both of which are bounded by
 * mechanisms that are not a row in an account-wide D1 allowance.
 */
export type PreAuthEvidenceCategory = 'refused' | 'rate_limited' | 'unavailable';

const PRE_AUTH_EVIDENCE_KEY_BRAND: unique symbol = Symbol('dudo.identity.preAuthEvidenceKey');

export type PreAuthEvidenceKey = {
  readonly [PRE_AUTH_EVIDENCE_KEY_BRAND]: true;
  readonly entryPointId: PreAuthEntryPointId;
  readonly category: PreAuthEvidenceCategory;
};

/**
 * The only constructor. TWO PARAMETERS, BOTH FROM CLOSED SETS.
 *
 * There is no parameter through which a submitted identifier, a source address, a credential, a
 * header or any other caller-influenced value could arrive — the same device
 * `deriveDenialGroupKey` uses, and the reason the cardinality above is a number rather than a
 * hope.
 */
export function derivePreAuthEvidenceKey(
  entryPointId: PreAuthEntryPointId,
  category: PreAuthEvidenceCategory,
): PreAuthEvidenceKey {
  const key = { entryPointId, category };
  Object.defineProperty(key, PRE_AUTH_EVIDENCE_KEY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(key) as PreAuthEvidenceKey;
}

export function preAuthEvidenceKeyText(key: PreAuthEvidenceKey): string {
  return `${key.entryPointId} ${key.category}`;
}

/** One hour. The arithmetic is on `derivePreAuthEvidenceKey`. */
export const PRE_AUTH_EVIDENCE_WINDOW_MS = 60 * 60 * 1000;

/** The same ladder `0013` uses, imported rather than restated. */
export const MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW = EMISSION_LADDER.length + 1;

/**
 * The evidence port.
 *
 * IT IS NOT `TenantScopedStore` AND MUST NEVER BECOME ONE. A pre-auth denial belongs to no
 * Organization, so writing it through a tenant-scoped handle would mean either inventing a
 * tenant for it or filing it under somebody's — the first is a fiction and the second is a
 * cross-tenant write. Its home is the control-plane database (`0014` §C.3), which is Part C's to
 * build; this port is the Core-owned boundary it will be reached through.
 *
 * IT IS OPTIONAL IN COMPOSITION AND ITS ABSENCE IS NEVER SILENT. With no recorder, every
 * countable pre-auth denial is announced as `evidence_unrecorded` through a floor that cannot be
 * configured off — the same treatment `audit/coordination-failure.ts` gives a lost summary, and
 * for the same reason: an uncounted attempt is the ABSENCE of the evidence the control exists to
 * produce.
 */
export type PreAuthEvidenceRecorder = {
  record(key: PreAuthEvidenceKey, nowMs: number): Promise<Result<void>>;
};

// =============================================================================================
// The announcement floor
// =============================================================================================

/**
 * ===========================================================================================
 * SIX CAUSES, SPLIT INTO TWO KINDS, AND THE SPLIT IS OPERATIONAL RATHER THAN COSMETIC.
 * ===========================================================================================
 *
 * PER-OCCURRENCE causes are facts about ONE request and each one must be seen:
 *
 *   timing_overrun        a handler's work crossed a quantum boundary, which is exactly the
 *                         condition under which the response floor stops covering for unequal
 *                         work. Every instance matters, because the distribution is the signal.
 *   outcome_collapsed     a handler threw, or returned an outcome its entry point does not
 *                         declare. One event, one defect.
 *   evidence_unrecorded   a composed recorder was reached and FAILED. Evidence lost; the count
 *                         matters.
 *   limiter_unreachable   the limiter could not answer for this request.
 *
 * CONFIGURATION causes are facts about the DEPLOYMENT, not about a request. They are identical
 * on every request an isolate serves, and cannot change within its life:
 *
 *   handler_absent            no handler is registered for a delegated entry point.
 *   evidence_recorder_absent  no recorder is composed at all.
 *   identifier_level_absent   no bucketer is composed, so the level that bounds credential
 *                             guessing is not running.
 *
 * **THEY ARE REPORTED ONCE PER ISOLATE, AND THAT IS A CONTROL RATHER THAN A CONVENIENCE.** A
 * notice emitted on every request would emit hardest exactly when the platform is under a
 * pre-auth flood — turning a security signal into a self-inflicted log flood and a cost, on the
 * one path an unauthenticated caller can drive. A control an operator has to mute is a control
 * that is off. Once per isolate is enough to make a misconfiguration visible and is bounded by
 * the isolate count rather than by the attacker's request rate.
 *
 * WHAT IS DELIBERATELY *NOT* DAMPENED: everything in the first group. In particular
 * `evidence_unrecorded` stays per-occurrence, which is why it is split from
 * `evidence_recorder_absent` — "the recorder is not composed" is one deployment fact, and "the
 * recorder was there and dropped this record" is a lost record that has to be counted.
 */
export type PreAuthFailureCause =
  | 'timing_overrun'
  | 'outcome_collapsed'
  | 'handler_absent'
  | 'evidence_unrecorded'
  | 'evidence_recorder_absent'
  | 'limiter_unreachable'
  | 'identifier_level_absent';

const CONFIGURATION_CAUSES: ReadonlySet<PreAuthFailureCause> = new Set<PreAuthFailureCause>([
  'handler_absent',
  'evidence_recorder_absent',
  'identifier_level_absent',
]);

/** What has already been reported by this isolate. Bounded at causes x entry points = 35. */
const REPORTED_CONFIGURATION_CAUSES = new Set<string>();

export type PreAuthFailure = {
  readonly entryPointId: PreAuthEntryPointId;
  readonly cause: PreAuthFailureCause;
  /** Milliseconds the handler took, for `timing_overrun`. Zero otherwise. */
  readonly elapsedMs: number;
};

export type PreAuthFailureReporter = {
  report(failure: PreAuthFailure): void;
};

/** The grep and alert target. Stable; operator monitoring is configured against it. */
export const PRE_AUTH_FAILURE_MARKER = 'dudo.identity.pre_auth_control_degraded';

/**
 * Announce. NEVER THROWS, and never reaches the caller.
 *
 * WHAT A NOTICE CONTAINS: an entry-point id from a five-value union, a cause from a six-value
 * union, and a duration. THERE IS NO FIELD FOR the submitted identifier, the source address, a
 * credential, or a header — a stronger property than `AuditFailure` has, and a necessary one,
 * because this is the one notice that fires on requests from people who are not yet Dudo users.
 */
export function announcePreAuthFailure(
  failure: PreAuthFailure,
  reporter: PreAuthFailureReporter | undefined,
): void {
  if (CONFIGURATION_CAUSES.has(failure.cause)) {
    const token = `${failure.cause} ${failure.entryPointId}`;
    if (REPORTED_CONFIGURATION_CAUSES.has(token)) {
      return;
    }
    REPORTED_CONFIGURATION_CAUSES.add(token);
  }
  try {
    const sink = (globalThis as { console?: { error?: (...values: readonly unknown[]) => void } })
      .console;
    if (sink !== undefined && typeof sink.error === 'function') {
      sink.error(
        `${PRE_AUTH_FAILURE_MARKER} ${JSON.stringify({
          entry_point_id: failure.entryPointId,
          cause: failure.cause,
          elapsed_ms: failure.elapsedMs,
          // Stated in the notice itself so an operator counting these does not read a
          // configuration cause's ONE line as one occurrence.
          reported_once_per_isolate: CONFIGURATION_CAUSES.has(failure.cause),
        })}`,
      );
    }
  } catch {
    // End of the line. The alternative is throwing into a response whose shape is fixed.
  }
  if (reporter === undefined) {
    return;
  }
  try {
    reporter.report(failure);
  } catch {
    // The floor already emitted. A defective reporter cannot suppress the notice.
  }
}

// =============================================================================================
// Dispatch — the admission rule itself
// =============================================================================================

/**
 * A pre-auth request, as the transport hands it over.
 *
 * NOTE WHAT IT DOES NOT CARRY: no headers map. Headers are read by the transport for exactly two
 * purposes — the source address hash and the presented credentials — and are not passed through,
 * because a handler with the header map is a handler that can read a caller-supplied
 * `X-Organization-Id`. That is the same rule `http/api.ts` already applies to Action inputs
 * ("HEADERS ARE NOT MERGED, EVER"), applied one path over.
 */
export type PreAuthRequest = {
  readonly bodyText: string;
  readonly credentials: PreAuthPresentedCredentials;
  readonly sourceAddressHash: string | null;
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * The transport-neutral answer. `http/pre-auth-http.ts` turns it into bytes from a fixed table.
 *
 * IT CARRIES NO MESSAGE AND NO ERROR VALUE except `invalid`'s field-level details, which name a
 * field and a stable token and never a value.
 */
export type PreAuthResolution =
  | { readonly kind: 'static'; readonly bodyText: string }
  | { readonly kind: 'acknowledged' }
  | { readonly kind: 'issued'; readonly credentials: readonly PreAuthCredential[] }
  /** The acknowledgement body plus the transport's fixed clearing cookie. `0018` §B. */
  | { readonly kind: 'cleared' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'invalid'; readonly details: readonly { field: string; issue: string }[] };

export type PreAuthDependencies = {
  readonly clock: Clock;
  readonly limiter: PreAuthLimiter;
  readonly sleeper: PreAuthSleeper;
  readonly handlers: PreAuthHandlers;
  /** Optional; see `PreAuthEvidenceRecorder`. Absent means announced, never silent. */
  readonly evidence?: PreAuthEvidenceRecorder;
  /** Optional; see the argument on `PreAuthRateSubject`. Absent means announced, never silent. */
  readonly identifierBucketer?: PreAuthIdentifierBucketer;
  readonly failureReporter?: PreAuthFailureReporter;
};

/**
 * ===========================================================================================
 * THE ADMISSION RULE. IN ORDER, AND THE ORDER IS THE SECURITY PROPERTY.
 * ===========================================================================================
 *
 *   1. THE ENTRY POINT IS REGISTERED.  Checked by brand AND by identity against the frozen
 *      table. A route that is not one of the five never reaches this function, and a value that
 *      merely looks like one is refused here.
 *   2. STATIC ENTRY POINTS ANSWER FROM A CONSTANT AND STOP.  No handler, no body read, no
 *      limiter subject derived from anything but the address, no clock-dependent work. This is
 *      how the health endpoint is structurally incapable of carrying tenant or user data.
 *   3. RATE LIMIT, SOURCE LEVEL, BEFORE THE BODY IS PARSED.  Parsing is work, and work an
 *      unauthenticated caller can compel is work that should be bounded first. A limiter that
 *      could not answer REFUSES — see the note at the call site for why this fails closed here
 *      and degrades in `action/pipeline.ts`, which looks inconsistent and is not.
 *   4. VALIDATE THE BODY against the entry point's declared field set.
 *   5. RATE LIMIT, IDENTIFIER LEVEL, from a bucket of the submitted string. AFTER validation,
 *      because it needs a validated field, and still before anything is looked up.
 *   6. RUN THE HANDLER, measuring it.
 *   7. COLLAPSE the outcome to what the entry point declared it may return.
 *   8. EQUALISE THE RESPONSE TIME.
 *   9. COUNT the denial against the bounded grouping.
 *
 * STEP 8 IS AFTER STEP 7 AND BEFORE THE RETURN, so the collapse cannot be timed either: an
 * outcome that was replaced and one that was not are answered at the same instant.
 */
export async function dispatchPreAuthRequest(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  request: PreAuthRequest,
): Promise<PreAuthResolution> {
  // ---- 1.
  assertRegisteredPreAuthEntryPoint(entryPoint);

  const startedAtMs = dependencies.clock.nowMs();

  // ---- 2. Static. Answered from the frozen constant, with no handler and nothing to run.
  if (entryPoint.kind === 'static') {
    // The source limit still applies — a health endpoint is a free request amplifier otherwise —
    // and it is the only work this branch does.
    const allowed = await checkLimit(
      dependencies,
      entryPoint,
      derivePreAuthSourceSubject(entryPoint.id, request.sourceAddressHash),
      entryPoint.sourceLimitPerWindow,
      startedAtMs,
    );
    if (allowed !== null) {
      await countDenial(dependencies, entryPoint, 'rate_limited', startedAtMs);
      return allowed;
    }
    return { kind: 'static', bodyText: staticBodyTextFor(entryPoint.id) };
  }

  // ---- 3. Source level, before parsing.
  //
  // A LIMITER THAT CANNOT ANSWER REFUSES, AND THAT IS THE OPPOSITE OF WHAT `action/pipeline.ts`
  // DOES. There, an unreachable coordinator degrades to read-only rather than refusing, because
  // refusing everything would convert a coordinator outage into a platform outage — a lever an
  // attacker could pull. Here there is no equivalent: refusing pre-auth requests stops NEW
  // sessions being issued and does not touch a single already-authenticated caller, so the blast
  // radius is "logins are unavailable while the limiter is down" rather than "Dudo is down". And
  // the alternative is admitting unlimited unauthenticated requests to the one path that
  // verifies credentials, which is the state §B's "fail closed" is about.
  const sourceRefusal = await checkLimit(
    dependencies,
    entryPoint,
    derivePreAuthSourceSubject(entryPoint.id, request.sourceAddressHash),
    entryPoint.sourceLimitPerWindow,
    startedAtMs,
  );
  if (sourceRefusal !== null) {
    await countDenial(dependencies, entryPoint, 'rate_limited', startedAtMs);
    return sourceRefusal;
  }

  const registration = dependencies.handlers[entryPoint.id as DelegatedPreAuthEntryPointId];
  if (registration === undefined) {
    // FAIL CLOSED. No handler is registered, so nothing can be verified and nothing may be
    // issued. It collapses like every other failure — for a `collapsed` entry point that is an
    // acknowledgement, which discloses nothing, and for a `credential` one it is the fixed
    // refusal.
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'handler_absent', elapsedMs: 0 },
      dependencies.failureReporter,
    );
    return finish(dependencies, entryPoint, collapsed(entryPoint), startedAtMs);
  }

  // ---- 4. Validate.
  const parsed = parsePreAuthBody(request.bodyText, registration.fields);
  if (!parsed.ok) {
    // NOT TIME-EQUALISED, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT. This branch is
    // reached by the SHAPE of the request, which the caller wrote and already knows. It carries
    // no information about any account, so holding it to the floor would buy nothing and would
    // hand an unauthenticated caller a way to occupy an invocation for a quarter of a second per
    // malformed request.
    return {
      kind: 'invalid',
      details: (parsed.error.details ?? []).map((entry) => ({
        field: entry.field,
        issue: entry.issue,
      })),
    };
  }

  // ---- 5. Identifier level.
  const identifierRefusal = await checkIdentifierLimit(
    dependencies,
    entryPoint,
    registration,
    parsed.value,
    startedAtMs,
  );
  if (identifierRefusal !== null) {
    await countDenial(dependencies, entryPoint, 'rate_limited', startedAtMs);
    // EQUALISED, UNLIKE THE SOURCE REFUSAL ABOVE. This one is keyed by a bucket of the submitted
    // identifier, so answering it faster than a processed request would tell a caller which
    // identifiers are in a saturated bucket — a weaker signal than existence, and free to close.
    return finish(dependencies, entryPoint, { kind: 'rate_limited', retryAfterSeconds:
      identifierRefusal.retryAfterSeconds }, startedAtMs);
  }

  // ---- 6. Run the handler.
  let outcome: PreAuthOutcome;
  try {
    outcome = await registration.handle(
      {
        entryPointId: entryPoint.id as DelegatedPreAuthEntryPointId,
        clock: dependencies.clock,
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
      parsed.value,
      request.credentials,
    );
  } catch {
    // A thrown handler is a defect, and it must not become a distinguishable answer. It
    // collapses to the same value a refusal produces and is announced internally.
    announcePreAuthFailure(
      {
        entryPointId: entryPoint.id,
        cause: 'outcome_collapsed',
        elapsedMs: dependencies.clock.nowMs() - startedAtMs,
      },
      dependencies.failureReporter,
    );
    outcome = collapsed(entryPoint);
  }

  // ---- 7. Collapse.
  const finalOutcome = enforceDeclaredOutcome(dependencies, entryPoint, outcome, startedAtMs);

  // ---- 8 and 9.
  const category = evidenceCategoryOf(finalOutcome);
  if (category !== null) {
    await countDenial(dependencies, entryPoint, category, startedAtMs);
  }
  return finish(dependencies, entryPoint, toResolution(finalOutcome), startedAtMs);
}

function staticBodyTextFor(id: PreAuthEntryPointId): string {
  // One static entry point exists and the registry asserts there is exactly one shape for it.
  // Imported lazily through a switch rather than a map so that adding a second static entry
  // point without deciding its body is a compile-visible gap rather than an `undefined`.
  if (id === 'platform.health') {
    return HEALTH_BODY_TEXT;
  }
  throw new PreAuthRateSubjectError(`${id} is declared static and has no static body.`);
}

function collapsed(entryPoint: PreAuthEntryPoint): PreAuthOutcome {
  return outcomeOfKind(entryPoint.collapseTo);
}

function outcomeOfKind(kind: PreAuthOutcomeKind): PreAuthOutcome {
  if (kind === 'acknowledged') {
    return { kind: 'acknowledged' };
  }
  if (kind === 'cleared') {
    // A LEGITIMATE COLLAPSE TARGET, UNLIKE `issued`, AND THE TEST THAT SEPARATES THEM IS BELOW.
    // Collapsing to `cleared` on a thrown or out-of-set outcome REMOVES a credential; collapsing
    // to `issued` would GRANT one. A failure path that revokes is fail-closed; a failure path
    // that authenticates is the bypass. `docs/decisions/0018` §B.
    return { kind: 'cleared' };
  }
  if (kind === 'refused') {
    return { kind: 'refused' };
  }
  if (kind === 'unavailable') {
    return { kind: 'unavailable' };
  }
  // `issued` is never a collapse target — `assertRegistryIsCoherent` does not forbid it outright
  // because `collapseTo` must be a member of `outcomes`, so it is refused here instead: a
  // failure path that ISSUED A CREDENTIAL would be an authentication bypass built out of an
  // error handler.
  throw new PreAuthRateSubjectError(
    'A pre-authentication entry point may not collapse to `issued`. The collapse target is what ' +
      'a thrown, failed or out-of-set outcome becomes, and issuing a credential on a failure ' +
      'path is an authentication bypass wearing the word default.',
  );
}

/**
 * Replaces an outcome the entry point did not declare.
 *
 * THE CASE THIS EXISTS FOR IS NOT A BUG IN A HANDLER — it is the shape a future handler would
 * take if nobody stopped it. `identity.login.start` declares `acknowledged` and nothing else;
 * a handler that returned `refused` for an unknown address would be a perfectly reasonable piece
 * of code and a complete account-existence oracle. Here it is replaced by the acknowledgement and
 * announced, so the endpoint cannot leak and the mistake is visible.
 */
function enforceDeclaredOutcome(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  outcome: PreAuthOutcome,
  startedAtMs: number,
): PreAuthOutcome {
  if (entryPoint.outcomes.includes(outcome.kind)) {
    return outcome;
  }
  announcePreAuthFailure(
    {
      entryPointId: entryPoint.id,
      cause: 'outcome_collapsed',
      elapsedMs: dependencies.clock.nowMs() - startedAtMs,
    },
    dependencies.failureReporter,
  );
  return collapsed(entryPoint);
}

function toResolution(outcome: PreAuthOutcome): PreAuthResolution {
  if (outcome.kind === 'issued') {
    return { kind: 'issued', credentials: outcome.credentials };
  }
  return { kind: outcome.kind };
}

function evidenceCategoryOf(outcome: PreAuthOutcome): PreAuthEvidenceCategory | null {
  if (outcome.kind === 'refused') {
    return 'refused';
  }
  if (outcome.kind === 'unavailable') {
    return 'unavailable';
  }
  // `acknowledged`, `issued` and `cleared` are not denials. Note that a COLLAPSED entry point
  // therefore records nothing on its refusal path — because it has no refusal path, by
  // construction. What its handler learned is the identity slice's own to log, in the control
  // plane, where it is not reachable through a response.
  //
  // `cleared` IS DELIBERATELY NOT COUNTED AS EVIDENCE. A logout is not a denial, and counting one
  // would put a row-writing path behind an endpoint an unauthenticated caller can call at will —
  // which is `0013`'s hole, reopened through the evidence trail rather than through the audit log.
  return null;
}

/** Returns a refusal when the limit binds, or null when it does not. */
async function checkLimit(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  subject: PreAuthRateSubject,
  limitPerWindow: number,
  nowMs: number,
): Promise<PreAuthResolution | null> {
  assertPreAuthRateSubject(subject);
  let decision: Result<PreAuthRateDecision>;
  try {
    decision = await dependencies.limiter.check(subject, limitPerWindow, nowMs);
  } catch {
    // A throw out of the limiter is treated exactly as an error return: unanswerable, therefore
    // not shown to be within limits, therefore refused.
    decision = err(unavailable());
  }
  if (!decision.ok) {
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'limiter_unreachable', elapsedMs: 0 },
      dependencies.failureReporter,
    );
    return { kind: 'rate_limited', retryAfterSeconds: retryAfterSecondsUntilWindowEnd(nowMs) };
  }
  if (decision.value.allowed) {
    return null;
  }
  return { kind: 'rate_limited', retryAfterSeconds: decision.value.retryAfterSeconds };
}

async function checkIdentifierLimit(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  registration: PreAuthHandlerRegistration,
  body: PreAuthBody,
  nowMs: number,
): Promise<PreAuthRateDecision | null> {
  const field = registration.identifierField;
  if (field === undefined) {
    return null;
  }
  if (dependencies.identifierBucketer === undefined) {
    // The level that bounds guessing is not running. Announced on every request that would have
    // used it, because "we shipped without it" must not be a quiet property.
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'identifier_level_absent', elapsedMs: 0 },
      dependencies.failureReporter,
    );
    return null;
  }
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    // The field is declared but was not supplied. There is nothing to bucket, and inventing a
    // bucket would put every such request in one counter — which is a shared limit an attacker
    // could saturate to refuse everyone. The source level still applies.
    return null;
  }
  const bucket = await dependencies.identifierBucketer.bucket(entryPoint.id, value);
  const subject = derivePreAuthIdentifierSubject(entryPoint.id, bucket);
  assertPreAuthRateSubject(subject);
  let decision: Result<PreAuthRateDecision>;
  try {
    decision = await dependencies.limiter.check(
      subject,
      PRE_AUTH_IDENTIFIER_LIMIT_PER_WINDOW,
      nowMs,
    );
  } catch {
    // A throw out of the limiter is treated exactly as an error return: unanswerable, therefore
    // not shown to be within limits, therefore refused.
    decision = err(unavailable());
  }
  if (!decision.ok) {
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'limiter_unreachable', elapsedMs: 0 },
      dependencies.failureReporter,
    );
    return { allowed: false, retryAfterSeconds: retryAfterSecondsUntilWindowEnd(nowMs) };
  }
  return decision.value.allowed ? null : decision.value;
}

async function countDenial(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  category: PreAuthEvidenceCategory,
  nowMs: number,
): Promise<void> {
  const key = derivePreAuthEvidenceKey(entryPoint.id, category);
  if (dependencies.evidence === undefined) {
    // A DEPLOYMENT FACT, not a lost record: reported once per isolate. See `PreAuthFailureCause`.
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'evidence_recorder_absent', elapsedMs: 0 },
      dependencies.failureReporter,
    );
    return;
  }
  try {
    const recorded = await dependencies.evidence.record(key, nowMs);
    if (!recorded.ok) {
      announcePreAuthFailure(
        { entryPointId: entryPoint.id, cause: 'evidence_unrecorded', elapsedMs: 0 },
        dependencies.failureReporter,
      );
    }
  } catch {
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'evidence_unrecorded', elapsedMs: 0 },
      dependencies.failureReporter,
    );
  }
}

/**
 * Holds the answer until the quantised deadline, and announces an overrun.
 *
 * THE ANNOUNCEMENT IS THE POINT, not the wait. An overrun means the handler's real work crossed
 * a quantum boundary, which is exactly the condition under which the floor stops hiding the
 * difference between a real account and an absent one. Core cannot make another agent's handler
 * constant-time; it can make every instance of it loud. See `PRE_AUTH_RESPONSE_FLOOR_MS`.
 */
async function finish(
  dependencies: PreAuthDependencies,
  entryPoint: PreAuthEntryPoint,
  resolution: PreAuthResolution,
  startedAtMs: number,
): Promise<PreAuthResolution> {
  const nowMs = dependencies.clock.nowMs();
  const elapsed = nowMs - startedAtMs;
  if (elapsed >= PRE_AUTH_RESPONSE_FLOOR_MS) {
    announcePreAuthFailure(
      { entryPointId: entryPoint.id, cause: 'timing_overrun', elapsedMs: elapsed },
      dependencies.failureReporter,
    );
  }
  try {
    await dependencies.sleeper.sleepUntil(quantizedDeadlineMs(startedAtMs, nowMs), nowMs);
  } catch {
    // A sleeper that fails degrades the timing control and must not change the answer.
  }
  return resolution;
}
