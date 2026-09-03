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
import { implies } from '../authorization/scope.ts';
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
  /**
   * ===========================================================================================
   * THE WORST-CASE D1 COST OF ONE SUCCESSFUL INVOCATION, IN ESTIMATED ROW-WRITES, EXCLUDING THE
   * AUDIT RECORD. `docs/decisions/0014` §A.1 and §A.12.
   * ===========================================================================================
   *
   * ZERO FOR A READ, and zero is the default because it is the answer for every Action that
   * writes nothing. An Action that declares nothing therefore reserves nothing and — because the
   * pipeline refuses to commit writes it has not reserved capacity for — cannot write at all.
   * Forgetting to declare produces an Action that fails loudly on its first mutation, never one
   * that writes unaccounted rows.
   *
   * IT IS NOT THE NUMBER OF STATEMENTS. One INSERT into an indexed table is one table row plus
   * one row per index (`storage/write-cost.ts`, and Cloudflare's own definition). The Customer
   * Directory's `customer` table has two indexes counting its composite primary key, so a
   * single-row insert or update against it costs **three**, not one.
   *
   * WORST CASE, NOT TYPICAL. §A.12: "Erring toward over-reserving is the safe direction: the
   * failure mode of over-reserving is a delayed write, and of under-reserving is a platform
   * outage." An Action whose statement count varies with its input declares the largest value it
   * can produce, and an Action whose UPDATE or DELETE predicate is not a primary-key equality
   * must declare the largest number of ROWS that predicate can match — a broad `DELETE` is one
   * statement and can be thousands of row-writes. Every mutating Action in this repository
   * matches exactly one row by primary key, which is why the declared numbers are small.
   *
   * THE AUDIT ROW IS NOT DECLARED HERE. The pipeline adds it, from `audit`, because the audit
   * record is Core's and an App must not be able to price it — or to price it at zero. See
   * `estimatedRowWriteCost`.
   *
   * WHAT IS CHECKED AND WHAT IS NOT. The storage boundary rejects a batch with more STATEMENTS
   * than row-writes reserved, which catches an Action that emits more operations than it
   * declared; that is a lower bound and it is exact. What no check can catch is a declaration
   * that counts the statements correctly and the index rows wrongly, because D1 exposes no
   * portable way to count a table's indexes through the binding. That half is a review
   * obligation against the migration, and it is stated as one rather than implied to be
   * enforced.
   */
  readonly maxRowWrites?: number;
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

// =============================================================================================
// The declared permission — 0007 D1, and its ONE exception (docs/decisions/0014 §B)
// =============================================================================================

/** The two fields the declaration check needs, so the helper works on anything Action-shaped. */
export type PermissionDeclarationSource = {
  readonly id: string;
  readonly permission: string;
  readonly scope: Scope;
};

/**
 * ===========================================================================================
 * "AN ACTION WITHOUT ONE FAILS ITS OWN REGISTRATION." `docs/decisions/0007` D1, now enforced.
 * ===========================================================================================
 *
 * D1 says two things and only the first was structural before this. *"An entry point with no
 * declared permission is unreachable, not open"* held, because `createAuthorizer` denies unless
 * a declaration is FOUND and `''` matches nothing an App declares. *"Every Action declares
 * exactly one permission and one scope level. An Action without one fails its own
 * registration"* did not: an Action with `permission: ''` constructed happily, routed happily,
 * and was simply always `forbidden` — a route that looks wired to a reviewer and answers
 * nothing to a caller. Failing quietly in the safe direction is still failing quietly, and it is
 * the shape a real permission typo takes.
 *
 * WHY IT IS ADDED IN THE CHANGE THAT BUILDS `0014` §B RATHER THAN ON ITS OWN. §B creates, for
 * the first time, a legitimate way for a route to have no permission — the pre-auth registry. The
 * moment that exists, "no permission" stops being unambiguously a mistake, and the ILLEGITIMATE
 * form of it has to become a loud failure so that the two cannot be confused. A pre-auth entry
 * point is not an `ActionDefinition` and cannot be one (`identity/pre-auth-registry.ts` — it has
 * no `permission`, no `scope`, no `handle` of this shape); an Action with a blank permission is
 * not an admission rule, it is a defect; and this function is the line between them.
 *
 * THERE IS DELIBERATELY NO BYPASS FLAG. Nothing was added to `ActionDefinition` for §B — no
 * `preAuth: true`, no `access` field, no optional permission. §B is explicit that a pre-auth
 * route is *"an admission rule, not a fake permission granted to an anonymous user"*, and a flag
 * here would be exactly the fake: an Action carrying it would still flow through `invokeAction`,
 * still hold a principal-shaped context, and still be one edit away from accumulating a grant.
 */
export class MissingPermissionError extends Error {
  constructor(actionId: string) {
    super(
      `${actionId} declares no permission. docs/decisions/0007 D1: every Action declares ` +
        'exactly one permission and one scope level, and an Action without one fails its own ' +
        'registration. An entry point with no declared permission is UNREACHABLE, not open — ' +
        'and a blank permission is not a way to make one open, it is a route that is always ' +
        'forbidden while looking wired. The ONLY route without a permission is a registered ' +
        'pre-authentication entry point (docs/decisions/0014 §B), which is not an Action and ' +
        'cannot be expressed as one.',
    );
    this.name = 'MissingPermissionError';
  }
}

export function assertDeclaredPermission(action: PermissionDeclarationSource): void {
  if (typeof action.permission !== 'string' || action.permission.trim().length === 0) {
    throw new MissingPermissionError(action.id);
  }
  // `implies(s, s)` is `SCOPE_RANK[s] <= SCOPE_RANK[s]`, which is TRUE for one of the seven
  // scopes and FALSE for anything else, because an unknown key yields `NaN <= NaN`. Checking
  // membership this way rather than against a second list of the scope names means the ladder
  // stays defined in exactly one place (`authorization/scope.ts`).
  if (typeof action.scope !== 'string' || !implies(action.scope, action.scope)) {
    throw new MissingPermissionError(action.id);
  }
}

export function asAnyAction<I, O>(definition: ActionDefinition<I, O>): AnyActionDefinition {
  return definition as unknown as AnyActionDefinition;
}

// =============================================================================================
// Daily D1 write cost — docs/decisions/0014 §A
// =============================================================================================

/** The two fields the cost is derived from, so the helper works on anything Action-shaped. */
export type WriteCostSource = {
  readonly id: string;
  readonly audit: boolean;
  readonly maxRowWrites?: number;
};

/**
 * What one successful invocation reserves from the daily budget.
 *
 * THE APP DECLARES ITS OWN WRITES AND CORE PRICES THE AUDIT ROW. That split is not tidiness. An
 * App that could price its audit record could price it at zero, and the audit row is the most
 * expensive row in the platform — `audit_event` and its four indexes cost five row-writes, more
 * than the customer row it accompanies. It is also not optional: `pipeline.ts` appends it to the
 * same transaction, so an audited Action that reserved only for its own write would commit a
 * row it never accounted for.
 *
 * `auditsSuccesses` RATHER THAN `auditsOnDenial` IS THE RIGHT GATE, and the distinction is
 * `customers.GetCustomer`: its successes write nothing and its DENIALS write summaries. A denial
 * never reaches this function — it is charged to the `security` allocation by the coordinator,
 * on the other side of the decision, at the `denial_summary` table's own cost.
 */
export function estimatedRowWriteCost(
  action: WriteCostSource,
  auditEventRowWrites: number,
): number {
  const declared = action.maxRowWrites ?? 0;
  if (declared === 0) {
    // A read. It reserves nothing, consults no budget, and is unaffected by exhaustion — which
    // is `0014` §A.10's "reads remain available", holding by construction rather than by a
    // branch that has to be got right.
    return 0;
  }
  return declared + (auditsSuccesses(action) ? auditEventRowWrites : 0);
}

/**
 * Thrown at invocation, like `AuditPolicyError`, and for the same reason: a malformed cost
 * declaration is a defect in Dudo's code that no caller can cause and no caller can influence,
 * and it corrupts an account-wide budget in a way that stays invisible until D1 stops answering
 * for every Organization.
 */
export class WriteCostPolicyError extends Error {
  constructor(actionId: string, declared: unknown) {
    super(
      `${actionId} declares maxRowWrites: ${JSON.stringify(declared)}. It must be a ` +
        'non-negative integer — zero for an Action that writes nothing, and otherwise the ' +
        'WORST-CASE number of D1 row-writes one successful invocation performs, counting one ' +
        'row for the table and one for each index the write touches ' +
        '(docs/decisions/0014 §A.12, platform/core/storage/write-cost.ts).',
    );
    this.name = 'WriteCostPolicyError';
  }
}

export function assertWriteCostPolicy(action: WriteCostSource): void {
  const declared = action.maxRowWrites;
  if (declared === undefined) {
    return;
  }
  if (!Number.isInteger(declared) || declared < 0) {
    throw new WriteCostPolicyError(action.id, declared);
  }
}
