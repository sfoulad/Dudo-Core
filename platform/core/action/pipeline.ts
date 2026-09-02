/**
 * THE PIPELINE. The normative evaluation order, in one place, for every Action.
 *
 * `customer-directory-v1.contract.yaml` -> `authorizationModel.evaluationOrder` states the
 * order and calls it normative. It is implemented here rather than in each Action because
 * the order is what produces the security properties, and an order re-implemented per
 * Action is an order that will eventually be re-implemented wrongly:
 *
 *   1.  Authenticate. Failure -> unauthenticated.
 *   2.  Derive the tenant AND the authorized business set from the authenticated context.
 *       Neither comes from the request.
 *   3.  Authorize the declared permission at its declared scope, WITHOUT REFERENCE TO ANY
 *       RECORD. Failure -> forbidden. Record-independence is what makes this `forbidden`
 *       impossible to correlate with a record's existence.
 *   4.  Validate the input schema. Unknown fields rejected. Failure -> invalid_argument.
 *   5.  Resolve the record WITHIN THE TENANT, predicate already applied. Not in this tenant
 *       -> not_found, identically whether it exists elsewhere or nowhere. TERMINAL FOR
 *       CROSS-TENANT: nothing below runs on a foreign row.
 *   5b. Authorize the resolved row's business_id against the authorized set -> forbidden.
 *   5c. Validate a Business named by the caller the same way and in the same order.
 *   6.  Evaluate the state precondition -> failed_precondition.
 *   7.  Perform the operation, commit, then write the audit record.
 *
 * Steps 5 to 6 are the handler's, because they are the only steps whose content differs per
 * Action. Steps 1 to 4 and step 7 are here, and a handler cannot skip, reorder or weaken
 * them: it is not called until 1 to 4 have passed, and it cannot commit anything itself.
 *
 * STEP 7 IS STRENGTHENED, NOT REORDERED. The contract says operate, commit, then audit. The
 * storage boundary can commit both in one transaction, so it does: `store.write` receives
 * the handler's writes followed by the audit insert. That removes the ordering question
 * instead of answering it, which is what `audit.deletionPathAudit.atomicity` asks for where
 * it is available. The one place the contract INVERTS the order is the purge, which is out
 * of scope for this slice (contract §11.1) and has no code here.
 *
 * WHY AN UNAUTHENTICATED REQUEST WRITES NO AUDIT RECORD. There is no tenant yet, so there is
 * no tenant-scoped store, so there is nowhere it could be written that would not be a
 * cross-tenant or untenanted write. This is a real gap and it is named rather than hidden:
 * failed authentication is an identity-layer concern and belongs with AZ2, in the log of the
 * component that rejected the credential.
 */

import type { AnyActionDefinition } from './action.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CoreError, ErrorCode } from '../kernel/errors.ts';
import { forbidden, internal, unavailable } from '../kernel/errors.ts';
import type { ActionContext, AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type { TenantStoreResolver } from '../tenancy/tenant-store-resolver.ts';
import type { Authorizer, AppPermissionEnvelope } from '../authorization/authorizer.ts';
import type { AuditDenialReason, AuditEntry, AuditSink } from '../audit/audit.ts';
import type { Clock } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import { createStoreAuditSink } from '../audit/store-audit-sink.ts';
import type { CursorCodec } from '../pagination/cursor.ts';
import { bindCursorCodec } from '../pagination/cursor.ts';

export type PipelineDependencies = {
  readonly resolver: TenantStoreResolver;
  readonly authorizer: Authorizer;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly cursors: CursorCodec;
  /** Builds the tenant-bound sink. Injected so a test can observe writes without patching. */
  readonly auditSinkFactory?: (
    store: Parameters<typeof createStoreAuditSink>[0],
    ids: IdGenerator,
  ) => AuditSink;
};

export type InvocationEnvelope = {
  readonly principal: AuthenticatedPrincipal;
  readonly app: AppPermissionEnvelope;
  readonly requestId: string;
  readonly correlationId: string;
};

const DENIAL_REASONS: ReadonlySet<string> = new Set<AuditDenialReason>([
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid_argument',
  'failed_precondition',
  'conflict',
  'quota_exceeded',
]);

function toDenialReason(code: ErrorCode): AuditDenialReason | null {
  return DENIAL_REASONS.has(code) ? (code as AuditDenialReason) : null;
}

/**
 * A returned error outside the Action's declared set is a defect in the Action, not a new
 * code (customer-directory-v1.contract.yaml, and error-envelope.schema.json's errorCode
 * description). It is converted to `internal` so a caller never receives an undeclared
 * code — a client written against the contract has no branch for one — and so the defect
 * shows up as a failure rather than as a quietly-widened error set.
 */
function constrainToDeclaredErrors(action: AnyActionDefinition, error: CoreError): CoreError {
  if (action.errors.includes(error.code)) {
    return error;
  }
  return internal();
}

export async function invokeAction(
  dependencies: PipelineDependencies,
  action: AnyActionDefinition,
  envelope: InvocationEnvelope,
  rawInput: unknown,
): Promise<Result<unknown>> {
  const { principal } = envelope;
  const occurredAt = dependencies.clock.now();

  // ---- Step 2. Derive the tenant. It comes from the authenticated principal and from
  // nowhere else; `rawInput` is not consulted, and no Action in this contract has a tenant
  // parameter. The handle is obtained through TenantStoreResolver, which is the mandatory
  // indirection docs/decisions/0006 §0.2 makes binding.
  const resolved = await dependencies.resolver.resolve(principal.organizationId);
  if (!resolved.ok) {
    return err(constrainToDeclaredErrors(action, unavailable()));
  }
  const store = resolved.value;

  const auditSink = (dependencies.auditSinkFactory ?? createStoreAuditSink)(
    store,
    dependencies.ids,
  );

  const targetResourceId = action.targetIdentifier(rawInput);

  function denialEntry(error: CoreError, permissionId: string, scope: string): AuditEntry {
    return {
      appId: action.appId,
      actionId: action.id,
      principalId: principal.principalId,
      principalType: principal.principalType,
      onBehalfOfPrincipalId: principal.onBehalfOfPrincipalId,
      permissionId,
      scope: scope as AuditEntry['scope'],
      decision: 'denied',
      denialReason: toDenialReason(error.code),
      targetResourceId,
      // CD-5: on a not_found the identifier is recorded as supplied, marked unresolved,
      // and nothing derived from any record accompanies it.
      targetUnresolved: error.code === 'not_found',
      // EMPTY, ALWAYS, ON A DENIAL. The contract is explicit that a wrong-Business denial
      // must not name the record's actual business_id, because that hands to a log reader
      // the disclosure the refusal withheld. Making this unconditional means no denial path
      // can populate it by accident.
      relatedBusinessIds: [],
      changedFieldNames: [],
      requestId: envelope.requestId,
      correlationId: envelope.correlationId,
      occurredAt,
    };
  }

  async function fail(error: CoreError, permissionId: string, scope: string): Promise<Result<unknown>> {
    const constrained = constrainToDeclaredErrors(action, error);
    if (action.audit) {
      // Failures are audited, not only successes: "An attack looks like a long run of
      // failures, and a log containing only successes cannot show one."
      //
      // A failure to WRITE the audit record does not change the answer to the caller. The
      // request already failed; converting a denial into an `internal` because the log was
      // unavailable would tell a caller something about Dudo's internals and would turn a
      // correct refusal into a retryable-looking error.
      await auditSink.append(denialEntry(constrained, permissionId, scope));
    }
    return err(constrained);
  }

  // ---- Step 3. Authorize, WITHOUT REFERENCE TO ANY RECORD.
  const decision = dependencies.authorizer.authorize(
    principal.grants,
    envelope.app,
    action.permission,
    action.scope,
  );
  if (!decision.allowed) {
    return fail(forbidden(), decision.permissionId, decision.scope);
  }

  // ---- Step 4. Validate the input. Unknown fields rejected.
  const parsed = action.parseInput(rawInput);
  if (!parsed.ok) {
    return fail(parsed.error, decision.permissionId, decision.scope);
  }

  const context: ActionContext = {
    principalId: principal.principalId,
    onBehalfOfPrincipalId: principal.onBehalfOfPrincipalId,
    authorizedBusinessIds: principal.authorizedBusinessIds,
    store,
    audit: auditSink,
    // Bound to the authenticated Organization here, so the Action never holds the value.
    cursors: bindCursorCodec(dependencies.cursors, principal.organizationId),
    clock: dependencies.clock,
    ids: dependencies.ids,
    requestId: envelope.requestId,
    correlationId: envelope.correlationId,
  };

  // ---- Steps 5, 5b, 5c and 6 are the handler's. It resolves within the tenant through the
  // storage boundary, authorizes the row's Business, and evaluates the state precondition.
  let outcome;
  try {
    outcome = await action.handle(context, parsed.value);
  } catch (cause) {
    // A thrown value is a programming defect — a tenant-column reference, an audit value
    // leak, an unhandled predicate kind. It becomes `internal`, which discloses nothing.
    return fail(internal(), decision.permissionId, decision.scope);
  }
  if (!outcome.ok) {
    return fail(outcome.error, decision.permissionId, decision.scope);
  }

  // ---- Step 7. Operate, commit, audit — as ONE transaction where the boundary allows it,
  // which it does. The audit insert is appended to the handler's writes, so a mutation that
  // commits without its audit record is not a state this code can reach.
  const writes = [...outcome.value.writes];
  if (action.audit) {
    writes.push(
      auditSink.operation({
        appId: action.appId,
        actionId: action.id,
        principalId: principal.principalId,
        principalType: principal.principalType,
        onBehalfOfPrincipalId: principal.onBehalfOfPrincipalId,
        permissionId: decision.permissionId,
        scope: decision.scope,
        decision: 'allowed',
        denialReason: null,
        targetResourceId: outcome.value.audit.targetResourceId,
        targetUnresolved: false,
        relatedBusinessIds: outcome.value.audit.relatedBusinessIds,
        changedFieldNames: outcome.value.audit.changedFieldNames,
        requestId: envelope.requestId,
        correlationId: envelope.correlationId,
        occurredAt,
      }),
    );
  }

  if (writes.length > 0) {
    let committed;
    try {
      committed = await store.write(writes);
    } catch (cause) {
      return err(constrainToDeclaredErrors(action, internal()));
    }
    if (!committed.ok) {
      // Nothing was written — neither the mutation nor its audit record — because the
      // batch is one transaction. There is no half state to reconcile and nothing to
      // compensate.
      return err(constrainToDeclaredErrors(action, committed.error));
    }
  }

  return ok(outcome.value.output);
}
