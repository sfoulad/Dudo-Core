/**
 * The audit record.
 *
 * AUTHORIZATION_STANDARD.md §11 fixes the fields; SECURITY_STANDARD.md §6 makes the log
 * append-only; the Customer Directory contract (audit.record.rules) adds the constraint
 * that decides this file's shape:
 *
 *   "IDENTIFIERS AND DECISIONS, NEVER BUSINESS DATA. An UpdateCustomer audit record names
 *    WHICH FIELDS CHANGED — the field names — and never the old or new values. A
 *    CreateCustomer audit record carries the customer_id and never the display_name. An
 *    audit log that accumulates customer names and addresses is a second copy of the
 *    business data with different access rules."
 *
 * HOW THAT IS MADE STRUCTURAL. `AuditEntry` has no field that can hold a value. There is
 * no `payload`, no `before`/`after`, no `diff`, no free-text `message`, and no
 * `Record<string, unknown>`. `changedFieldNames` is the only place a caller supplies
 * something list-shaped, and every element is checked against an identifier pattern — a
 * display name or an address does not match it, so passing a value where a field name
 * belongs fails loudly rather than being written.
 *
 * The type is doing most of the work. That is intentional: the contract calls this a
 * STANDING OBLIGATION, not a one-off check — "any future change that puts a field VALUE
 * into an audit record ... silently creates a copy of the personal data that the purge
 * cannot reach, and turns a compliant purge into a partial one". A type with nowhere to
 * put a value is harder to regress than a rule in a document.
 *
 * TWO CONSEQUENCES WORTH STATING.
 *
 * 1. THE AUDIT TRAIL SURVIVES A PURGE WITH NO SCRUBBING. Because no value was ever
 *    written, a purged customer's audit history already contains no personal data, and
 *    nothing has to reach into an append-only log to erase anything — which is fortunate,
 *    because an append-only log that application code edits is neither append-only nor a
 *    log. The purge itself is out of scope for this slice (contract §11.1); this property
 *    is what makes it satisfiable when it is built.
 * 2. FAILURES ARE AUDITED, NOT ONLY SUCCESSES. "An attack looks like a long run of
 *    failures, and a log containing only successes cannot show one." `decision` is
 *    required and has a `denied` value; there is no write path that omits it.
 *
 * WHAT THIS FILE DOES NOT DO. It does not read. `AuditSink` has no query method, here or
 * anywhere: reading the audit trail is its own Core surface with its own permission, and
 * an App having a handle that could read it would be an undeclared disclosure of every
 * other App's activity in the tenant.
 */

import type { Scope } from '../authorization/scope.ts';
import type { Result } from '../kernel/result.ts';
import type { WriteOperation } from '../storage/store.ts';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';

export const AUDIT_TABLE = 'audit_event';

/**
 * =============================================================================================
 * THE ACTOR'S BUSINESS CONTEXT — and why it is a nominal type rather than a `string[]`.
 * =============================================================================================
 *
 * D2 requirement 2 asks the denied-read record to carry the ACTOR'S Organization AND BUSINESS
 * CONTEXT. The Organization is the row's `tenant_id`, set by the storage boundary from the
 * authenticated handle. The business context is this: THE BUSINESSES THE CALLER WAS AUTHORIZED
 * OVER WHEN IT MADE THE ATTEMPT.
 *
 * IT IS NOT `relatedBusinessIds`, AND CONFLATING THE TWO WOULD REBUILD A DISCLOSURE THIS
 * CONTRACT SPENT EFFORT CLOSING. The two fields answer opposite questions:
 *
 *   relatedBusinessIds   the RECORD's Businesses. Forced empty on every denial, because
 *                        "telling the log which Business the caller was refused turns the
 *                        audit trail into the disclosure the refusal withheld."
 *   actorBusinessIds     the CALLER's own authorized set. Data the tenant already holds about
 *                        itself, which is why it carries no cross-tenant risk at all.
 *
 * A field that could be populated from the resolved target would undo the first rule while
 * looking like it was implementing the second. So it is made hard to do by accident:
 *
 *   1. `ActorBusinessContext` IS A NOMINAL TYPE. A plain `string[]` — say, one built from a
 *      row's `business_id` — is not assignable to it. The only value that satisfies it comes
 *      from `deriveActorBusinessContext`, whose ONLY PARAMETER IS AN `AuthenticatedPrincipal`.
 *      A resolved row is not an authenticated principal and cannot be passed as one.
 *   2. THE BRAND IS ENFORCED AT RUNTIME, not only in the type system. `store-audit-sink.ts`
 *      asserts it before writing. This repository has no type-check step in its build, so a
 *      type-only brand would be documentation; this one throws.
 *   3. `AuditFacts` HAS NO MEMBER FOR IT (action.ts). A handler — the only code that ever sees
 *      a resolved row — has no channel through which to supply, override or influence it.
 *   4. THE PIPELINE DERIVES IT BEFORE ANY RECORD EXISTS. It is computed at the top of
 *      `invokeAction`, before the store is resolved and long before the handler runs, so at
 *      the moment of derivation there is no target in scope to copy from.
 *
 * WHAT THAT DOES NOT CLAIM. Rules 1 and 2 stop an ARRAY of foreign values; they cannot stop
 * code that deliberately fabricates an object shaped like a principal in order to launder one
 * through. Nothing short of not having the field prevents that, and it would be a deliberate
 * act visible in review, not the accident these guards are aimed at.
 */
const ACTOR_BUSINESS_CONTEXT_BRAND: unique symbol = Symbol('dudo.audit.actorBusinessContext');

export type ActorBusinessContext = readonly string[] & {
  readonly [ACTOR_BUSINESS_CONTEXT_BRAND]: true;
};

/**
 * The ONLY constructor. Takes the authenticated principal and reads one field off it.
 *
 * The array is COPIED and FROZEN so that the entry cannot be mutated after the fact by
 * whatever still holds a reference to the principal's own array.
 */
export function deriveActorBusinessContext(
  principal: AuthenticatedPrincipal,
): ActorBusinessContext {
  const derived: string[] = [...principal.authorizedBusinessIds];
  Object.defineProperty(derived, ACTOR_BUSINESS_CONTEXT_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(derived) as unknown as ActorBusinessContext;
}

/**
 * Thrown, not returned, for the same reason as `AuditValueLeakError`: an unbranded value here
 * means some code path assembled an actor context out of something that was not the
 * authenticated principal, and the whole point is that it must not be written and noticed
 * afterwards.
 */
export class ActorContextNotDerivedError extends Error {
  constructor() {
    super(
      'An audit entry carried an actorBusinessIds value that did not come from ' +
        'deriveActorBusinessContext. The actor business context is read from the ' +
        "AUTHENTICATED PRINCIPAL and from nothing else — never from a resolved record, whose " +
        'Business a denial record may not name.',
    );
    this.name = 'ActorContextNotDerivedError';
  }
}

export function assertActorBusinessContext(value: readonly string[]): void {
  const branded = value as unknown as Record<symbol, unknown>;
  if (branded[ACTOR_BUSINESS_CONTEXT_BRAND] !== true) {
    throw new ActorContextNotDerivedError();
  }
}

/** Matches a wire field name (snake_case). Deliberately too narrow to admit a value. */
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export type AuditDecision = 'allowed' | 'denied';

/**
 * Why a denied attempt was denied. A code from the closed taxonomy, never a sentence.
 *
 * `not_found` appears here because CD-5 requires a failed cross-tenant lookup to be
 * audited IN THE CALLER'S TENANT: an enumeration run that produced only silence is
 * indistinguishable from noise, which defeats the reason for auditing it.
 *
 * `rate_limited` WAS MISSING AND ITS ABSENCE WAS A HOLE, found by running the controls rather
 * than by reading them. Nothing produced a `rate_limited` denial until `docs/decisions/0013`
 * built a limiter, so the omission cost nothing and was invisible. The moment the limiter
 * existed it meant that a THROTTLED caller — which is what a probing campaign looks like once
 * these controls are working — fell through the recording path and produced no evidence at
 * all. That is the same silence D2 was decided to end, arriving through the fix for it. It sits
 * beside `quota_exceeded` because the two are siblings: one means slow down, the other means
 * upgrade or stop, and both are refusals a caller earned.
 */
export type AuditDenialReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_argument'
  | 'failed_precondition'
  | 'conflict'
  | 'rate_limited'
  | 'quota_exceeded';

export type AuditEntry = {
  readonly appId: string;
  readonly actionId: string;
  readonly principalId: string;
  readonly principalType: string;
  /** Set when an AI agent or service account acts for a human. Null otherwise. */
  readonly onBehalfOfPrincipalId: string | null;
  /** The permission and scope ACTUALLY EVALUATED, not the ones requested. */
  readonly permissionId: string;
  readonly scope: Scope;
  readonly decision: AuditDecision;
  readonly denialReason: AuditDenialReason | null;
  /**
   * The record acted on, as an opaque identifier. Null for an Action that names no record.
   *
   * For a `not_found` on a mutating Action this is the identifier AS SUPPLIED BY THE
   * CALLER, with `targetUnresolved` set — CD-5's interpretation of az7-r3. Echoing back a
   * value the caller authored teaches it nothing; recording nothing at all makes an
   * enumeration run invisible.
   */
  readonly targetResourceId: string | null;
  readonly targetUnresolved: boolean;
  /**
   * Business identifiers inside the caller's own tenant. Never business data.
   *
   * For MoveCustomerToBusiness this carries BOTH ends, because "the move record is
   * meaningless without both".
   *
   * FOR A WRONG-BUSINESS DENIAL IT MUST BE EMPTY. The contract is explicit: the record
   * "does NOT name the record's actual business_id: telling the log which Business the
   * caller was refused turns the audit trail into the disclosure the refusal withheld, for
   * anyone who can read the log at a narrower scope than the record."
   */
  readonly relatedBusinessIds: readonly string[];
  /**
   * THE ACTOR'S OWN authorized Business set, from the authenticated context. D2 requirement 2.
   *
   * Deliberately NOT `readonly string[]`: see `ActorBusinessContext` above for why the nominal
   * type, the runtime brand and the absence of any handler-facing channel are what keep this
   * field from ever carrying the TARGET's Business — which is the disclosure
   * `relatedBusinessIds` is forced empty to prevent.
   *
   * It is populated identically on a denial and on a success, and identically whether the
   * requested identifier belongs to another Organization or to nobody, because it is derived
   * from the caller and never from what the caller was reaching for.
   */
  readonly actorBusinessIds: ActorBusinessContext;
  /** FIELD NAMES ONLY. Never values, never a diff. */
  readonly changedFieldNames: readonly string[];
  readonly requestId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
};

/**
 * Thrown, not returned. A value reaching `changedFieldNames` is a defect in Dudo's code,
 * and the whole point is that it must not be written and then noticed later.
 */
export class AuditValueLeakError extends Error {
  constructor(offending: string) {
    super(
      'An audit entry carried something that is not a wire field name in changedFieldNames. ' +
        'Audit records carry identifiers and decisions, never business data. ' +
        `Rejected length: ${offending.length}.`,
    );
    this.name = 'AuditValueLeakError';
  }
}

export function assertChangedFieldNames(names: readonly string[]): void {
  for (const name of names) {
    if (!FIELD_NAME_PATTERN.test(name)) {
      // The offending string is NOT included in the message: if it is a value, putting it
      // in an error message moves the leak from the audit table to the log.
      throw new AuditValueLeakError(name);
    }
  }
}

/**
 * Append-only. There is no update, no delete, and no read.
 *
 * `operation()` returns a write rather than performing one so that a mutation and its
 * audit record can be committed in a single transaction by the caller
 * (`TenantScopedStore.write`). `append()` exists for the case that has no mutation to
 * accompany — a denial.
 */
export type AuditSink = {
  operation(entry: AuditEntry): WriteOperation;
  append(entry: AuditEntry): Promise<Result<void>>;
};
