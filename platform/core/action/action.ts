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
  readonly audit: boolean;
  readonly exposure: readonly Exposure[];
  /** Schema validation. Unknown fields rejected. */
  readonly parseInput: (raw: unknown) => Result<I>;
  /**
   * The caller-supplied resource identifier, read from the RAW request before validation.
   *
   * It is read from the raw input because a denial audit record is owed even when the
   * request failed validation, and because CD-5 requires a `not_found` on a mutating Action
   * to record "the identifier AS SUPPLIED BY THE CALLER, marked unresolved, plus nothing
   * derived from any record". Returning null is correct for an Action that names no record.
   */
  readonly targetIdentifier: (raw: unknown) => string | null;
  readonly handle: ActionHandler<I, O>;
};

/** An Action of unknown input and output type, for registries and routing tables. */
export type AnyActionDefinition = ActionDefinition<unknown, unknown>;

export function asAnyAction<I, O>(definition: ActionDefinition<I, O>): AnyActionDefinition {
  return definition as unknown as AnyActionDefinition;
}
