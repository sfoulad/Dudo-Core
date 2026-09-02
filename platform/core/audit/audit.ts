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

export const AUDIT_TABLE = 'audit_event';

/** Matches a wire field name (snake_case). Deliberately too narrow to admit a value. */
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export type AuditDecision = 'allowed' | 'denied';

/**
 * Why a denied attempt was denied. A code from the closed taxonomy, never a sentence.
 *
 * `not_found` appears here because CD-5 requires a failed cross-tenant lookup to be
 * audited IN THE CALLER'S TENANT: an enumeration run that produced only silence is
 * indistinguishable from noise, which defeats the reason for auditing it.
 */
export type AuditDenialReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_argument'
  | 'failed_precondition'
  | 'conflict'
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
