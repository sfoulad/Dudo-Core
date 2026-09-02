/**
 * The Action definition.
 *
 * API_STANDARD.md §1: "an operation is defined once. From one definition the platform
 * derives the internal API, the public API, the OpenAPI schema, the SDK method, the MCP
 * tool, and the documentation. Writing five definitions produces four definitions and a
 * bug." Every field the standard makes required is required here.
 *
 * The Customer Directory contract's httpBinding says the same thing from the other end:
 * "There is no route handler containing logic — an operation with a handler but no Action
 * has no permission, no schema, no audit and no AI surface." That is enforced by the router
 * (http/router.ts) accepting Actions and not functions.
 *
 * WHAT A HANDLER IS NOT ALLOWED TO DO, AND HOW THE SHAPE PREVENTS IT.
 *
 * A handler returns its writes rather than performing them. It has no way to commit — the
 * pipeline does that, in one transaction, together with the audit record. Three things
 * follow that would otherwise be per-handler discipline:
 *
 *   - an audited Action cannot mutate without an audit record, because the same commit
 *     carries both;
 *   - a handler cannot invert the order of operate-and-audit, because it does not control
 *     either;
 *   - a handler cannot write an audit record of its own choosing, because `AuditEntry` is
 *     assembled by the pipeline from what was actually evaluated, not from what the handler
 *     says happened.
 *
 * `exposure` is opt-in and defaults to nothing. Nothing becomes public, and nothing becomes
 * an AI tool, by default or by accident.
 */

import type { ErrorCode } from '../kernel/errors.ts';
import type { Result } from '../kernel/result.ts';
import type { Scope } from '../authorization/scope.ts';
import type { ActionContext } from '../tenancy/tenant-context.ts';
import type { WriteOperation } from '../storage/store.ts';

export type Sensitivity = 'read' | 'write' | 'sensitive' | 'critical';
export type Exposure = 'internal' | 'public' | 'mcp';

/**
 * What an audited Action contributes to its own audit record. Identifiers only; there is
 * no field here that can hold a value, matching `AuditEntry`.
 *
 * THERE IS DELIBERATELY NO `actorBusinessIds` MEMBER, AND ITS ABSENCE IS A CONTROL. A handler
 * is the only code that ever holds a RESOLVED ROW; giving it a channel to the actor's business
 * context would be giving it a channel through which the TARGET's Business could arrive in the
 * audit record, which is exactly what `relatedBusinessIds` being forced empty on a denial
 * exists to prevent. The pipeline derives that field from the authenticated principal before
 * the handler runs. See `ActorBusinessContext` in platform/core/audit/audit.ts.
 */
export type AuditFacts = {
  readonly targetResourceId: string | null;
  readonly relatedBusinessIds: readonly string[];
  readonly changedFieldNames: readonly string[];
};

export type ActionOutcome<O> = {
  readonly output: O;
  /** Committed atomically with the audit record by the pipeline. May be empty for a read. */
  readonly writes: readonly WriteOperation[];
  readonly audit: AuditFacts;
};

export type ActionHandler<I, O> = (
  context: ActionContext,
  input: I,
) => Promise<Result<ActionOutcome<O>>>;

export type ActionDefinition<I, O> = {
  readonly id: string;
  readonly appId: string;
  readonly title: string;
  /**
   * Human- and AI-readable. API_STANDARD.md §1: it states what the operation does and when
   * to use it, not how it is implemented, because it is what a model sees when choosing a
   * tool.
   */
  readonly description: string;
  /** The closed set this Action may return. The pipeline checks what escapes against it. */
  readonly errors: readonly ErrorCode[];
  /** Exactly one permission id from permission-catalog.yaml. */
  readonly permission: string;
  /** The level the permission is EVALUATED at — not the list of levels it may be declared at. */
  readonly scope: Scope;
  readonly sensitivity: Sensitivity;
  readonly idempotent: boolean;
  /**
   * The Action's audit policy for BOTH outcomes: an allowed invocation writes a record, and
   * so does a denied one. `auditOnDenial` narrows that to denials only; nothing widens it.
   */
  readonly audit: boolean;
  /**
   * Audit DENIED invocations, independently of `audit`.
   *
   * Defaults to `audit`, so an Action that says nothing behaves exactly as it did before this
   * field existed. It is here for one shape that `audit` alone cannot express: an Action
   * whose SUCCESSES are deliberately unaudited but whose DENIALS must be recorded.
   *
   * That shape is `customers.GetCustomer`, and it exists because of what the CD-1 read
   * exception turned out to cost. A cross-tenant probing campaign run entirely through
   * GetCustomer produced ZERO audit records, while the same campaign through ArchiveCustomer
   * produced one per attempt — so the cheapest enumeration path was also the only silent one.
   * The user ruled on 2026-09-02: "Audit every denied GetCustomer read attempt, including
   * cross-tenant probing. Keep successful customer reads unaudited."
   *
   * IT MAY ONLY STRENGTHEN, NEVER WEAKEN. `audit: true` with `auditOnDenial: false` — an
   * Action that records its successes and hides its failures — is refused at construction
   * (`assertAuditPolicy`), because it is the exact shape an audit trail must never have:
   * "An attack looks like a long run of failures, and a log containing only successes cannot
   * show one."
   */
  readonly auditOnDenial?: boolean;
  readonly exposure: readonly Exposure[];
  /** Schema validation. Unknown fields rejected. */
  readonly parseInput: (raw: unknown) => Result<I>;
  /**
   * The caller-supplied resource identifier, read from the RAW request before validation.
   *
   * It is read from the raw input because a denial audit record was owed even when the request
   * failed validation, and because CD-5 requires a `not_found` on a mutating Action to record
   * "the identifier AS SUPPLIED BY THE CALLER, marked unresolved, plus nothing derived from any
   * record". Returning null is correct for an Action that names no record.
   *
   * **THE PIPELINE NO LONGER CALLS THIS ON THE DENIAL PATH** (docs/decisions/0013 control 5).
   * A denial is now counted against a bounded grouping that deliberately EXCLUDES the requested
   * identifier, because the attacker controls that value and grouping by it would mint
   * unlimited groups — restoring per-attempt writes under another name and undoing the whole
   * decision while appearing implemented. So this is currently reached only by an Action's own
   * code, and CD-5's obligation is not met for denials. It is kept rather than deleted because
   * the obligation itself is unresolved: 0013 supersedes it, and whether it returns in some
   * bounded form is a CONTRACT question, reported to the Team Lead and not decided here.
   */
  readonly targetIdentifier: (raw: unknown) => string | null;
  readonly handle: ActionHandler<I, O>;
};

/** An Action of unknown input and output type, for registries and routing tables. */
export type AnyActionDefinition = ActionDefinition<unknown, unknown>;

/** The two audit fields, so the helpers below can be used on anything Action-shaped. */
export type AuditPolicySource = {
  readonly id: string;
  readonly audit: boolean;
  readonly auditOnDenial?: boolean;
};

/**
 * Does a DENIED invocation of this Action write an audit record?
 *
 * One function, called by the pipeline, so the default is stated once rather than repeated
 * at each branch that needs it. Absent `auditOnDenial` means "whatever `audit` says", which
 * is exactly the behaviour every Action had before the field existed.
 */
export function auditsOnDenial(action: AuditPolicySource): boolean {
  return action.auditOnDenial ?? action.audit;
}

/** Does an ALLOWED invocation write one? Always `audit`; `auditOnDenial` cannot reach this. */
export function auditsSuccesses(action: AuditPolicySource): boolean {
  return action.audit;
}

/**
 * Thrown at construction. An Action that records its successes and hides its failures is a
 * defect in Dudo's code, and it must stop the build rather than produce a plausible-looking
 * audit trail that cannot show an attack.
 */
export class AuditPolicyError extends Error {
  constructor(actionId: string) {
    super(
      `${actionId} declares audit: true with auditOnDenial: false. An audited Action may not ` +
        'suppress its denial records. An attack looks like a long run of failures, and a log ' +
        'containing only successes cannot show one. auditOnDenial exists to ADD denial ' +
        'auditing to an unaudited Action, never to remove it from an audited one.',
    );
    this.name = 'AuditPolicyError';
  }
}

export function assertAuditPolicy(action: AuditPolicySource): void {
  if (action.audit && action.auditOnDenial === false) {
    throw new AuditPolicyError(action.id);
  }
}

export function asAnyAction<I, O>(definition: ActionDefinition<I, O>): AnyActionDefinition {
  return definition as unknown as AnyActionDefinition;
}
