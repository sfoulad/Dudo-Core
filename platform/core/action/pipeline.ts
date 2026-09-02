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
 * SUCCESS AND DENIAL ARE GATED SEPARATELY. `auditsSuccesses` gates step 7; `auditsOnDenial`
 * gates `fail`. They are the same value for every Action except `customers.GetCustomer`,
 * whose successes stay unaudited and whose denials must be recorded so that a cross-tenant
 * probing campaign is not the one attack shape that leaves no trace (action.ts,
 * `auditOnDenial`). The split can only ever add auditing: `assertAuditPolicy` refuses an
 * Action that audits successes and suppresses denials.
 *
 * WHY AN UNAUTHENTICATED REQUEST WRITES NO AUDIT RECORD. There is no tenant yet, so there is
 * no tenant-scoped store, so there is nowhere it could be written that would not be a
 * cross-tenant or untenanted write. This is a real gap and it is named rather than hidden:
 * failed authentication is an identity-layer concern and belongs with AZ2, in the log of the
 * component that rejected the credential.
 *
 * ===========================================================================================
 * AMENDED BY docs/decisions/0013 — RATE LIMITS, AND DENIALS ARE NO LONGER ONE ROW EACH
 * ===========================================================================================
 *
 * D2 made every denied read a D1 write, and nothing rate-limited the caller, so the attacker
 * chose the write rate against an allowance — 100,000 D1 rows written per day, ACCOUNT-WIDE,
 * enforced since 2026-09-01 — whose exhaustion stops D1 answering for EVERY Organization. The
 * probe-detection control was a platform-wide denial-of-service lever. Three things change
 * here, and none of them weakens what is recorded about an attack:
 *
 *   STAGE 5 IS NOW IMPLEMENTED. `ARCHITECTURE.md` §3 puts rate limiting at stage 5, after
 *   authorize and validate and before execution, and that is exactly where it sits below.
 *   0013 control 6 requires it "before any Customer D1 query"; step 5 is the first step that
 *   issues one, so the standard's order and the decision's requirement agree and neither is
 *   bent to fit the other.
 *
 *   STORAGE IS RESOLVED LATE. It used to be resolved at the top. Now nothing touches the
 *   storage layer until an invocation has passed authorization, validation and the limiter —
 *   so a refused permission, A MALFORMED IDENTIFIER (0013 control 7) and a throttled caller
 *   each cost zero storage work. That path was the cheapest denial to produce and it now costs
 *   nothing downstream.
 *
 *   A DENIAL IS COUNTED, NOT WRITTEN. `fail` no longer appends an `AuditEntry`; it counts the
 *   attempt against a bounded grouping in the coordinator, which returns a summary to write
 *   only at its emission points. The grouping deliberately EXCLUDES the requested identifier
 *   (0013 control 5) — see `protection/coordination.ts` for why that single exclusion is what
 *   makes the aggregation bounded, and for the timing-oracle property that falls out of it.
 *
 * WHAT DEGRADED MODE IS, AND WHY IT IS NOT A BLANKET REFUSAL. If the coordinator cannot
 * answer, refusing every request would satisfy "fail closed" and would ALSO hand an attacker a
 * new platform-wide outage lever: the coordinator's own daily allowances are account-wide and
 * exhaustible, so "coordinator down ⇒ everything refused" is the previous vulnerability with a
 * different resource name. Instead the pipeline degrades to READ-ONLY: the handler still runs,
 * and nothing that would WRITE to D1 is permitted to commit. Access is never widened — a read
 * that was authorized stays authorized and nothing new becomes reachable — while the resource
 * 0013 set out to protect, D1 write capacity, is protected absolutely, because in that mode
 * there are no writes at all.
 */

import type { AnyActionDefinition } from './action.ts';
import { assertAuditPolicy, auditsOnDenial, auditsSuccesses } from './action.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CoreError, ErrorCode } from '../kernel/errors.ts';
import { forbidden, internal, rateLimited, unavailable } from '../kernel/errors.ts';
import type { ActionContext, AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type { TenantStoreResolver } from '../tenancy/tenant-store-resolver.ts';
import type { TenantScopedStore } from '../storage/store.ts';
import type { Authorizer, AppPermissionEnvelope } from '../authorization/authorizer.ts';
import type { AuditDenialReason, AuditSink } from '../audit/audit.ts';
import { deriveActorBusinessContext } from '../audit/audit.ts';
import type { AuditFailureReporter } from '../audit/audit-failure.ts';
import type { CoordinationFailureReporter } from '../audit/coordination-failure.ts';
import { announceCoordinationFailure } from '../audit/coordination-failure.ts';
import { createStoreDenialSummarySink } from '../audit/denial-summary-sink.ts';
import type {
  DenialGroupKey,
  RequestCoordination,
  RequestCoordinator,
} from '../protection/coordination.ts';
import { deriveDenialGroupKey } from '../protection/coordination.ts';
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
  /**
   * An ADDITIONAL destination for audit-write failure notices.
   *
   * Optional, and optional does not weaken anything: `announceAuditFailure` emits to a
   * last-resort channel unconditionally before it consults this. Omitting it, supplying a
   * broken one, or supplying one that throws all produce the same guarantee — the failure is
   * announced. See audit/audit-failure.ts for why the floor is not injectable.
   *
   * **CURRENTLY UNREACHED FROM THIS FILE**, and that is a consequence of 0013 rather than a
   * regression. It was reached from exactly one place — the denial path's `auditSink.append` —
   * and a denial no longer appends an `AuditEntry`; it is counted, and ITS losses are announced
   * through `audit/coordination-failure.ts`, which reproduces the same floor for the same
   * reasons. The declaration is kept because `audit-failure.ts` remains the channel for a lost
   * PER-EVENT record, which is what the next audited write path will need, and because removing
   * it would be a wider change than 0013 asked for.
   */
  readonly auditFailureReporter?: AuditFailureReporter;
  /**
   * RATE LIMITING AND BOUNDED DENIAL AUDITING (docs/decisions/0013).
   *
   * NOT OPTIONAL. An optional coordinator is an optional rate limit, and 0013 exists because
   * the absence of one made the audit control a platform-wide denial-of-service lever. A
   * composition root that cannot supply one must refuse to start — `worker-entry.ts` does.
   */
  readonly coordinator: RequestCoordinator;
  /** ADDITIONAL destination for coordination notices. Additive only; see audit-failure.ts. */
  readonly coordinationFailureReporter?: CoordinationFailureReporter;
};

export type InvocationEnvelope = {
  readonly principal: AuthenticatedPrincipal;
  readonly app: AppPermissionEnvelope;
  readonly requestId: string;
  readonly correlationId: string;
  /**
   * A HASH of the caller's source address, supplied by the transport adapter, or null.
   *
   * The third rate-limit level (0013 control 6). Core never sees the address itself: a raw
   * address is personal data about a tenant's staff and this counter needs only equality.
   * Null is not an exemption — every unknown source shares one bucket, so an adapter that
   * omits it throttles harder rather than disabling the level.
   */
  readonly sourceAddressHash?: string | null;
};

const DENIAL_REASONS: ReadonlySet<string> = new Set<AuditDenialReason>([
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid_argument',
  'failed_precondition',
  'conflict',
  // Added with the limiter (docs/decisions/0013). Without it a THROTTLED caller produced no
  // evidence — the silence D2 was decided to end, arriving through the fix for it. See
  // `AuditDenialReason`.
  'rate_limited',
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

  // Checked here as well as in `createRouter`, because the router guards the HTTP surface and
  // this function is the surface EVERYTHING else arrives through — the internal API, an SDK
  // call, an MCP tool. A statically-broken audit policy is a defect in Dudo's code that no
  // caller can cause and no caller can influence, so it throws, like the storage boundary's
  // own guards, and surfaces as `internal` at the transport edge.
  assertAuditPolicy(action);

  const occurredAt = dependencies.clock.now();

  // ---- The actor's business context, for the audit record (D2 requirement 2).
  //
  // DERIVED HERE, AND THE POSITION IS THE POINT. This runs before the tenant store is
  // resolved, before the permission is evaluated and long before the handler sees a row — so
  // at the moment this value is computed there is NO RESOLVED RECORD IN SCOPE to take a
  // Business from, only the authenticated principal. It is then the same value on every
  // branch below: the same on a success and a denial, and the same whether the identifier the
  // caller supplied belongs to another Organization or to nobody at all.
  const actorBusinessIds = deriveActorBusinessContext(principal);

  const nowMs = dependencies.clock.nowMs();

  // ===========================================================================================
  // STAGE 5 — RATE LIMITS, AHEAD OF EVERY STORAGE INTERACTION (docs/decisions/0013 control 6).
  // ===========================================================================================
  //
  // `ARCHITECTURE.md` §3 places rate limiting at stage 5, after authorize and validate. 0013
  // requires it before ANY Customer D1 query. Both are satisfied at once because step 5 —
  // resolving the record — is the first step that issues one, and nothing above this line
  // touches storage: the coordination handle is opened here, and authorization and validation
  // read it below without any query having run.
  //
  // THE HANDLE IS OPENED ONCE AND CARRIES BOTH INTERACTIONS. The admission check and, later, a
  // denial count are two conversations with the same coordinator during one request. Two
  // independent calls would double the coordinator's own metered request count, and on a
  // probing campaign EVERY request is denied — halving the traffic the platform can absorb
  // before the coordinator becomes the exhausted resource. See protection/coordination.ts.
  let coordination: RequestCoordination | null = null;
  try {
    const begun = await dependencies.coordinator.begin({
      // SERVER-DERIVED, BOTH OF THEM. Neither comes from `rawInput`, a header, or anything the
      // caller can influence — a rate limit keyed by a value the caller chooses is not a rate
      // limit, it is a namespace the caller can move within at will.
      organizationId: principal.organizationId,
      principalId: principal.principalId,
      sourceAddressHash: envelope.sourceAddressHash ?? null,
      nowMs,
    });
    coordination = begun.ok ? begun.value : null;
  } catch (cause) {
    // A throw out of the coordinator must not escape into the request and must not become a
    // different answer for the caller. Same argument as an audit-write failure: a response that
    // varies for a reason the caller can influence is a channel.
    coordination = null;
  }

  // DEGRADED, NOT REFUSED. See the file header for why "coordinator down ⇒ refuse everything"
  // would be the previous vulnerability with a different resource name. What degraded costs is
  // enforced at the commit below: nothing writes.
  const degraded = coordination === null;
  if (degraded) {
    announceCoordinationFailure(
      {
        organizationId: principal.organizationId,
        cause: 'coordinator_unreachable',
        key: null,
        lost: 0,
      },
      dependencies.coordinationFailureReporter,
    );
  }

  // ---- Step 2. Derive the tenant. It comes from the authenticated principal and from
  // nowhere else; `rawInput` is not consulted, and no Action in this contract has a tenant
  // parameter. The handle is obtained through TenantStoreResolver, which is the mandatory
  // indirection docs/decisions/0006 §0.2 makes binding.
  //
  // RESOLVED LAZILY, AND THE LAZINESS IS 0013 CONTROL 7. A malformed identifier was the
  // cheapest denial to produce and it "must cost nothing downstream". It used to cost a
  // resolver call, a store handle, an audit sink and a D1 insert; now a request refused at
  // step 3, step 4 or the limiter never reaches this function at all.
  let store: TenantScopedStore | null = null;
  let storeResolved = false;

  async function ensureStore(): Promise<TenantScopedStore | null> {
    if (storeResolved) {
      return store;
    }
    storeResolved = true;
    const resolved = await dependencies.resolver.resolve(principal.organizationId);
    store = resolved.ok ? resolved.value : null;
    return store;
  }

  function denialGroupKey(category: AuditDenialReason): DenialGroupKey {
    // THE CONSTRUCTOR HAS NO PARAMETER THE REQUESTED IDENTIFIER COULD ARRIVE THROUGH, and
    // `targetResourceId` is deliberately not in scope in this function. 0013 control 5: the
    // attacker controls that value and would mint unlimited groups, restoring per-attempt
    // writes under another name.
    return deriveDenialGroupKey({
      principal,
      action: { appId: action.appId, id: action.id },
      category,
    });
  }

  function announce(
    cause: 'record_failed' | 'summary_write_failed' | 'ceiling_reached',
    key: DenialGroupKey,
    lost: number,
  ): void {
    announceCoordinationFailure(
      { organizationId: principal.organizationId, cause, key, lost },
      dependencies.coordinationFailureReporter,
    );
  }

  /**
   * A DENIED INVOCATION IS COUNTED, NOT WRITTEN (docs/decisions/0013 controls 1–5).
   *
   * FOUR PROPERTIES HOLD ON EVERY BRANCH BELOW, AND EVERY ONE OF THEM IS LOAD-BEARING.
   *
   * 1. THE ANSWER TO THE CALLER NEVER DEPENDS ON WHAT HAPPENS IN HERE. Not as a convenience —
   *    as a requirement. On the cross-tenant path this denial is a `not_found` that must stay
   *    byte-identical to the `not_found` for an identifier that exists nowhere. A response that
   *    varied when the coordinator was unhappy would be a channel a caller could learn to open,
   *    on exactly the path the indistinguishability requirement protects. `constrained` is
   *    computed first and returned on every path, including the ones that throw.
   *
   * 2. FAILURE IS NEVER SILENT. An uncounted attempt is the absence of the evidence this
   *    control exists to produce. Every loss is announced through a floor that cannot be
   *    configured off (`audit/coordination-failure.ts`).
   *
   * 3. NOTHING HERE CAN WIDEN ACCESS. The request was already refused before this function ran
   *    and is not reconsidered by it. That is how 0013 control 8 and D2 requirement 6 hold at
   *    the same time: control 8 governs what is REACHABLE and this path cannot reach anything;
   *    requirement 6 governs what is OBSERVABLE and property 1 fixes that.
   *
   * 4. THE GROUPING CANNOT CONTAIN THE REQUESTED IDENTIFIER, because `denialGroupKey` has no
   *    parameter it could arrive through and `targetResourceId` is not in scope in this
   *    function at all.
   */
  async function fail(error: CoreError): Promise<Result<unknown>> {
    const constrained = constrainToDeclaredErrors(action, error);

    // `auditsOnDenial` rather than `action.audit` is what makes GetCustomer's probe detection
    // possible: it is the one Action whose successes are deliberately unaudited and whose
    // denials must be recorded (action.ts, and get-customer.ts for the history).
    if (!auditsOnDenial(action)) {
      return err(constrained);
    }

    // ONLY TAXONOMY DENIALS ARE COUNTED. `internal`, `unavailable` and `timeout` are faults
    // rather than refusals: they say something about Dudo, not about what a caller attempted,
    // and the summary table's `denial_reason` has no null. This is a NARROWING of what the
    // per-event records covered — those wrote a row with a null reason — and it is stated here
    // rather than discovered from an empty query.
    const category = toDenialReason(constrained.code);
    if (category === null) {
      return err(constrained);
    }
    const key = denialGroupKey(category);

    if (coordination === null) {
      announce('record_failed', key, 1);
      return err(constrained);
    }

    let recorded;
    try {
      recorded = await coordination.recordDenial(key, {
        // The CALLER's own Businesses, never the record's. There is no field on `DenialSummary`
        // for the target's, which is what keeps a wrong-Business refusal from naming the
        // Business it refused.
        actorBusinessIds,
        // From the Action definition, so these are populated even on the denial paths that
        // happen before authorization runs. See `DenialSummary.permissionId`.
        permissionId: action.permission,
        scope: action.scope,
      });
    } catch (cause) {
      announce('record_failed', key, 1);
      return err(constrained);
    }
    if (!recorded.ok) {
      announce('record_failed', key, 1);
      return err(constrained);
    }
    if (recorded.value.suppressedByCeiling > 0) {
      // NOT A FAULT. A daily ceiling refused the write so that Customer and Business traffic
      // keeps its D1 capacity (control 9). The attempts are still counted; only their durable
      // evidence was dropped, and an operator alerting on denial counts has to know the counts
      // have stopped being complete.
      announce('ceiling_reached', key, recorded.value.suppressedByCeiling);
    }
    if (recorded.value.summaries.length === 0) {
      return err(constrained);
    }

    // A summary is due. THIS is the only denial path that touches D1, and it happens at most
    // `MAX_WRITES_PER_GROUP_WINDOW` times per group per 15-minute window rather than once per
    // attempt — which is the whole of 0013 control 1.
    const target = await ensureStore();
    if (target === null) {
      announce('summary_write_failed', key, recorded.value.summaries.length);
      return err(constrained);
    }
    try {
      const written = await createStoreDenialSummarySink(target, dependencies.ids).write(
        recorded.value.summaries,
      );
      if (!written.ok) {
        announce('summary_write_failed', key, recorded.value.summaries.length);
      }
    } catch (cause) {
      // A throw out of the sink — a guard trip, a defect below the boundary — must not escape
      // into the request. Before D2's equivalent guard existed it would have turned a correct
      // `not_found` into an `internal`, which is the disclosure property 1 forbids.
      announce('summary_write_failed', key, recorded.value.summaries.length);
    }
    return err(constrained);
  }

  /**
   * Steps 3 to 7. Held in an inner function so that the coordination handle can be released in
   * ONE place, on every exit — including the ones that return an error and the ones that throw.
   * A handle left open is a coordinator session left open, and a coordinator session is
   * metered.
   */
  async function execute(): Promise<Result<unknown>> {
    // ---- Step 3. Authorize, WITHOUT REFERENCE TO ANY RECORD.
    const decision = dependencies.authorizer.authorize(
      principal.grants,
      envelope.app,
      action.permission,
      action.scope,
    );
    if (!decision.allowed) {
      return fail(forbidden());
    }

    // ---- Step 4. Validate the input. Unknown fields rejected.
    //
    // THIS RUNS BEFORE ANY D1 QUERY AND ALWAYS DID — 0013 control 7 is about what a rejection
    // then COSTS, and the answer is now nothing: no store handle, no audit sink, no insert.
    const parsed = action.parseInput(rawInput);
    if (!parsed.ok) {
      return fail(parsed.error);
    }

    // ---- Stage 5. The limit itself. Placed here, after authorize and validate, so a caller
    // that lacks the permission still receives `forbidden`. A `rate_limited` that pre-empted an
    // authorization failure would change which error each of two otherwise identical callers
    // sees, which is a difference an attacker can measure; and it would move a denial the
    // contract specifies. Both orderings protect D1 equally, because step 5 — the first step
    // that queries anything — is still below this line. This one leaves the contract's denial
    // semantics exactly as written.
    if (coordination !== null && coordination.outcome === 'rate_limited') {
      // COUNTED LIKE ANY OTHER DENIAL, and cheaply: `rate_limited` is a member of the closed
      // category set, so a throttled caller produces ONE group rather than one per attempt.
      // Recording it is what lets an operator see a caller being held at the limit, which is
      // the shape a campaign has once these controls are working.
      return fail(rateLimited());
    }

    // ---- Step 2, deferred to here. Nothing above this line has touched storage.
    const resolvedStore = await ensureStore();
    if (resolvedStore === null) {
      return err(constrainToDeclaredErrors(action, unavailable()));
    }

    const auditSink = (dependencies.auditSinkFactory ?? createStoreAuditSink)(
      resolvedStore,
      dependencies.ids,
    );

    const context: ActionContext = {
      principalId: principal.principalId,
      onBehalfOfPrincipalId: principal.onBehalfOfPrincipalId,
      authorizedBusinessIds: principal.authorizedBusinessIds,
      store: resolvedStore,
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
      return fail(internal());
    }
    if (!outcome.ok) {
      return fail(outcome.error);
    }

    // ---- Step 7. Operate, commit, audit — as ONE transaction where the boundary allows it,
    // which it does. The audit insert is appended to the handler's writes, so a mutation that
    // commits without its audit record is not a state this code can reach.
    // `auditsSuccesses` is `action.audit`, unconditionally: `auditOnDenial` narrows the denial
    // path and can never reach this one. A successful GetCustomer therefore still writes
    // NOTHING, which is the half of the user's 2026-09-02 decision that is easiest to drift
    // past — "Keep successful customer reads unaudited."
    const writes = [...outcome.value.writes];
    if (auditsSuccesses(action)) {
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
          // NOT from `outcome.value.audit`. `AuditFacts` has no member for this, so the handler
          // — the only code that has seen a resolved row — cannot supply or override it.
          actorBusinessIds,
          changedFieldNames: outcome.value.audit.changedFieldNames,
          requestId: envelope.requestId,
          correlationId: envelope.correlationId,
          occurredAt,
        }),
      );
    }

    if (writes.length > 0) {
      // =========================================================================================
      // DEGRADED MODE IS READ-ONLY. This is the whole of 0013 control 8 on the success path.
      // =========================================================================================
      //
      // The coordinator could not answer, so nothing bounds what this caller may spend of an
      // account-wide, enforced D1 write allowance whose exhaustion stops D1 for EVERY
      // Organization. The check is on `writes` rather than on `sensitivity` because `writes` is
      // EXACT: it is literally the set of rows about to be committed, so there is no proxy to
      // be wrong about and no Action can be mis-classified onto the permitted side.
      //
      // WHAT IT DOES AND DOES NOT DO. It never widens access: a read that was authorized stays
      // authorized and nothing becomes reachable that was not. It refuses every mutation, and
      // it also refuses an AUDITED read, because an audited read's audit row is itself a D1
      // write — permitting it would be permitting exactly the unbounded write this mode exists
      // to stop. A successful `GetCustomer`, whose success is deliberately unaudited, still
      // works, so the read surface a customer actually uses stays up.
      //
      // IT IS AN AVAILABILITY TRADE AND IT IS DELIBERATE. A caller who can break the
      // coordinator can put Dudo into read-only. That is better than both alternatives: failing
      // OPEN restores the platform-wide D1 outage 0013 was written to close, and refusing
      // EVERYTHING converts a coordinator outage into a total one — the same lever, renamed.
      if (degraded) {
        return err(constrainToDeclaredErrors(action, unavailable()));
      }
      let committed;
      try {
        committed = await resolvedStore.write(writes);
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

  try {
    return await execute();
  } finally {
    // Releases the coordination handle. `dispose` never throws, and the `finally` means a
    // handle is released on every path — including the ones that return an error and the ones
    // that throw — because a handle left open is a coordinator session left open, which is
    // metered.
    if (coordination !== null) {
      coordination.dispose();
    }
  }
}
