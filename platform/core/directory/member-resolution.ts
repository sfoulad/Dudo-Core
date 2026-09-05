/**
 * ===========================================================================================
 * RESOLVING ONE MEMBER, AND TELLING THE TENANT IT HAPPENED.
 * `docs/decisions/0028` Decision 2 · contract `organization-detail-v1`.
 * ===========================================================================================
 *
 * *"AN OPERATOR RESOLVING AN IDENTIFIER THEY WERE GIVEN IS SUPPORT. AN OPERATOR RECEIVING A LIST
 * THEY DID NOT ASK FOR BY NAME IS SURVEILLANCE."*
 *
 * This module exists because the second half of that sentence needs a mechanism, not a rule. The
 * resolve is the narrow thing published in place of a member list, and **what makes it acceptable
 * is not that it returns one row — it is that the customer can see it happen.**
 *
 * ===========================================================================================
 * WHY THIS IS NOT IN `platform/core/platform/**`, WHICH IS THE SAME REASON `onboarding/` IS NOT
 * ===========================================================================================
 *
 * **The tenant-side audit record needs a tenant store handle.** `platform-operator-v1` P1 says the
 * platform route class can reach none, and `organization-detail-v1` names the tension itself:
 * *"PUTTING A RESOLVER ON THE PLATFORM ROUTE CONTEXT TO SERVE IT WOULD DEFEAT P1 FOR THE WHOLE
 * CLASS."*
 *
 * So the resolver is held here. The platform class receives `MemberResolutionService` — a port
 * with one method that returns a principal id and a role. **`qa-agent`'s control — "no module
 * under `platform/core/platform/**` names a tenant primitive" — stays exact rather than gaining a
 * second exception.**
 *
 * IT IS A SEPARATE DIRECTORY FROM `onboarding/` AND NOT A SHARED `tenant-writers/`. That directory
 * is one operation's. A second unrelated operation moving in is how a well-named boundary becomes
 * a junk drawer, and the next reader would have to work out which of two services the resolver
 * belonged to.
 *
 * ===========================================================================================
 * *** THE AUDIT RECORD IS WRITTEN ON EVERY CALL, INCLUDING EVERY REFUSAL. ***
 * ===========================================================================================
 *
 * *"BECAUSE THE PROBE IS THE THING BEING RECORDED, NOT THE ANSWER. A record written only on
 * success would leave every unsuccessful probe invisible, which is exactly the half an attacker
 * generates most of."*
 *
 * `0028` accepts a residual it does not close: an operator holding one known identifier can probe
 * it against every Organization and learn which ones that person belongs to. **That is `CO1`, for
 * one principal, at a cost of N requests.** What bounds it is that every probe is loud in two
 * places — the platform operator log AND the victim's own audit trail — where a member list would
 * have been one silent request per Organization returning everything.
 *
 * **THE HONEST LIMIT, AND IT IS WORSE TODAY THAN THE CONTRACT IMPLIES.** `0028` says the attack is
 * bounded by *"N requests, audited in both homes, visible to each victim, rate limited."* **The
 * last term is false.** `PO-4` is owed and unimplemented: there is no rate limiter on this class,
 * and what actually bounds an operator is the per-principal daily write ceiling — roughly 150
 * resolves per operator per UTC day, because each costs 4 control-plane row-writes. That is a
 * bound, and it is not rate limiting, and it must not be reported as though it were.
 *
 * AND: auditing is DETECTION, NOT PREVENTION. Nobody reads the operator log today because the read
 * route does not exist. `platform-audit-read-v1` is next; until it lands, "it is audited" must not
 * be cited as though someone were watching.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unavailable } from '../kernel/errors.ts';
import type { IdentifierHasher } from '../identity/credential-store.ts';
import { normalizeIdentifier } from '../identity/credential-store.ts';
import type {
  PlatformMemberResolution,
  PlatformOperatorStore,
} from '../platform/platform-operator-store.ts';
import type { TenantStoreResolver } from '../tenancy/tenant-store-resolver.ts';
import type { TenantScopedStore, WriteOperation } from '../storage/store.ts';
import type { RequestCoordinator } from '../protection/coordination.ts';
import type { AuditSink } from '../audit/audit.ts';
import { derivePlatformOperatorActorContext } from '../audit/audit.ts';
import type { OperatorWriteCharged } from '../platform/platform-audit.ts';
import { consumeOperatorCharge } from '../platform/platform-audit.ts';

/**
 * A tenant `audit_event` write: 1 row + its primary key + 3 explicit indexes.
 *
 * THE SAME FIGURE `control-plane-admission.ts` USES, and it is drawn from the Organization's
 * `business` allocation rather than the operator's `system` one. **Two ledgers, both reserved** —
 * the same split `organization-onboarding-v1` makes.
 */
export const RESOLVE_TENANT_ROW_WRITES = 5;

export type MemberResolutionService = {
  /**
   * Resolves an identifier within one Organization, and records the attempt in that Organization's
   * own audit trail whatever the answer.
   *
   * `null` IS THE COLLAPSED REFUSAL and covers all five cases the contract names. The caller
   * renders it as the argument-free 404 and cannot tell them apart, because this returns no
   * discriminant.
   */
  resolve(input: {
    readonly organizationId: string;
    readonly identifier: string;
    readonly actorPrincipalId: string;
    readonly requestId: string;
    readonly correlationId: string;
    /**
     * *** PROOF THE OPERATOR'S WRITE BUDGET WAS CHARGED FIRST. REQUIRED. ***
     *
     * This is the parameter that makes the fix a mechanism rather than a convention. Before it,
     * the tenant write happened and the operator was charged afterwards — so an operator whose own
     * 600 was spent kept spending a customer's 10,000, five row-writes at a time, until that
     * customer's own mutations began failing. **Measured: 2,000 calls took one Organization's
     * whole day.**
     *
     * IT IS UNFORGEABLE AND NAMES ITS SUBJECT. `dispatchPlatformRoute` is the only producer;
     * `consumeOperatorCharge` compares it against the actor being recorded.
     */
    readonly charge: OperatorWriteCharged;
  }): Promise<Result<PlatformMemberResolution | null>>;

  /**
   * ===========================================================================================
   * APPEND A TENANT-SIDE RECORD FOR A PLATFORM READ OF THIS ORGANIZATION, WITHOUT RESOLVING
   * ANYTHING. `platform-audit-read-v1`'s Organization feed.
   * ===========================================================================================
   *
   * *** IT IS ON THIS SERVICE RATHER THAN IN A THIRD MODULE, AND THAT IS A JUDGEMENT I WANT
   * VISIBLE. *** The scoped audit feed needs exactly the write half of `resolve` and none of its
   * lookup. The alternatives were a third `platform/core/**` directory holding a resolver — which
   * is one more component that can reach a tenant store, and the count is the thing `0025`'s
   * amendment asks to be measured — or duplicating the write, which is two places the *"names no
   * principal, decision always allowed"* rules have to stay correct.
   *
   * **SO THE REACH DOES NOT GROW: the same service, the same resolver, the same audit shape, one
   * more caller.** If a fourth operation ever needs this, the right move is a named
   * `TenantAuditAppender` port rather than a third method here — and that is the point at which to
   * ask whether P1 still means anything.
   *
   * IT TAKES `actionId` because the record must say WHICH read happened. A feed read and a resolve
   * are different disclosures and a customer reading their trail must be able to tell them apart.
   */
  recordOrganizationAccess(input: {
    readonly organizationId: string;
    readonly actionId: string;
    readonly actorPrincipalId: string;
    readonly requestId: string;
    readonly correlationId: string;
    /**
     * *** PROOF THE OPERATOR'S WRITE BUDGET WAS CHARGED FIRST. REQUIRED. ***
     *
     * This is the parameter that makes the fix a mechanism rather than a convention. Before it,
     * the tenant write happened and the operator was charged afterwards — so an operator whose own
     * 600 was spent kept spending a customer's 10,000, five row-writes at a time, until that
     * customer's own mutations began failing. **Measured: 2,000 calls took one Organization's
     * whole day.**
     *
     * IT IS UNFORGEABLE AND NAMES ITS SUBJECT. `dispatchPlatformRoute` is the only producer;
     * `consumeOperatorCharge` compares it against the actor being recorded.
     */
    readonly charge: OperatorWriteCharged;
  }): Promise<Result<void>>;
};

export type MemberResolutionDependencies = {
  readonly store: PlatformOperatorStore;
  readonly identifiers: IdentifierHasher;
  readonly resolver: TenantStoreResolver;
  readonly coordinator: RequestCoordinator;
  readonly auditSinkFor: (store: TenantScopedStore) => AuditSink;
  readonly ids: IdGenerator;
  readonly clock: Clock;
};

export function createMemberResolutionService(
  dependencies: MemberResolutionDependencies,
): MemberResolutionService {
  return {
    async resolve(input): Promise<Result<PlatformMemberResolution | null>> {
      const nowMs = dependencies.clock.nowMs();

      // ---- THE LOOKUP. One statement, five refusing cases, equal work. See the adapter.
      //
      // THE IDENTIFIER IS NORMALISED AND HASHED HERE, so nothing below this line holds an email
      // address — not the port, not the adapter, not a log line. NFKC then ASCII case folding,
      // through the SAME function login uses; a second normalisation would agree until one was
      // touched, and the divergence would be an operator unable to resolve a principal who can log
      // in perfectly well.
      const identifierHash = await dependencies.identifiers.hash(
        normalizeIdentifier(input.identifier),
      );
      const found = await dependencies.store.resolveMemberByIdentifierHash(
        input.organizationId,
        identifierHash,
      );
      if (!found.ok) {
        return err(found.error);
      }

      // =====================================================================================
      // ---- THE TENANT-SIDE RECORD, WRITTEN BEFORE THE ANSWER IS RETURNED AND ON BOTH PATHS.
      // =====================================================================================
      //
      // *** THE ORDER IS THE POINT: THE RECORD IS WRITTEN, THEN THE ANSWER IS PRODUCED. *** It is
      // `recordThen`'s shape in the platform dispatcher, for the same reason — an operation that
      // returned first and recorded second would, on a failed write, have disclosed the answer
      // with no evidence that it did.
      //
      // A FAILED WRITE REFUSES THE WHOLE OPERATION with `unavailable`. `0013` D2: the audit event
      // must not fail open, and inability to record the evidence is not a reason to proceed
      // without it. **Here that rule is doing real work rather than ceremony** — the evidence IS
      // the control, because the residual `0028` accepts rests on the customer being able to see
      // the probe.
      //
      // THE RECORD IS IDENTICAL IN SHAPE ON BOTH PATHS. `decision` is `allowed` whether or not a
      // principal was found, because **the operator was permitted to ask** — the record is of the
      // probe, not of its result. A `denied` on the miss path would turn the tenant's own audit
      // trail into a hit/miss oracle for anyone who can read it, which is the customer's owner.
      const recorded = await recordProbe(dependencies, {
        organizationId: input.organizationId,
        actionId: 'platform.organizations.members.resolve',
        actorPrincipalId: input.actorPrincipalId,
        charge: input.charge,
        requestId: input.requestId,
        correlationId: input.correlationId,
        occurredAt: toRfc3339Utc(nowMs),
        nowMs,
      });
      if (!recorded.ok) {
        return err(recorded.error);
      }
      return ok(found.value);
    },

    async recordOrganizationAccess(input): Promise<Result<void>> {
      // THE SAME WRITE, THE SAME SHAPE, A DIFFERENT `action_id`. There is deliberately no lookup
      // here and no branch inside `recordProbe` — the feed read has nothing to resolve, and a
      // shared function with a "sometimes resolve" flag would be one place two operations are
      // half-merged.
      const nowMs = dependencies.clock.nowMs();
      return recordProbe(dependencies, {
        organizationId: input.organizationId,
        actionId: input.actionId,
        actorPrincipalId: input.actorPrincipalId,
        charge: input.charge,
        requestId: input.requestId,
        correlationId: input.correlationId,
        occurredAt: toRfc3339Utc(nowMs),
        nowMs,
      });
    },
  };
}

/**
 * Appends one `audit_event` row to the named Organization.
 *
 * *** IT RECORDS THAT A PROBE HAPPENED AND NOTHING ABOUT WHOM IT WAS FOR. ***
 *
 * `targetResourceId` IS `null` AND `changedFieldNames` IS EMPTY, deliberately. Naming the resolved
 * principal would put "operator X asked about principal P" in the tenant's trail — which is the
 * membership fact `0028` Decision 3 spent a whole feed design rationing, arriving here through the
 * back door. **And on a MISS there is no principal to name**, so a record that named one on
 * success and not on failure would be a hit/miss oracle in the log itself.
 *
 * THE IDENTIFIER PROBED IS NOT RECORDED EITHER. It is an email address; `0001_principal.sql`
 * refused a column for one and this must not become storage for one at 5 row-writes a time.
 *
 * WHAT THE OWNER SEES: *"the platform asked about a member of your Organization, at this time, by
 * this operator."* That is the disclosure they would most want to know about, and it is the whole
 * of what this row asserts.
 */
async function recordProbe(
  dependencies: MemberResolutionDependencies,
  context: {
    readonly organizationId: string;
    /** WHICH platform read this was. A resolve and a feed read are different disclosures. */
    readonly actionId: string;
    readonly charge: OperatorWriteCharged;
    readonly actorPrincipalId: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly occurredAt: string;
    readonly nowMs: number;
  },
): Promise<Result<void>> {
  // *** THE RECEIPT IS CONSUMED BEFORE THE RESOLVER IS EVEN TOUCHED. ***
  //
  // Not merely held — checked, and bound to the actor this record will name. Reaching this line
  // without a genuine charge means Dudo's own code cast past the type, which throws rather than
  // returns: no client can cause it, because clients supply values and never receipts.
  //
  // IT IS THE FIRST STATEMENT ON PURPOSE. A check placed after the store resolution would still
  // be correct and would have let a future edit slip a write in between.
  consumeOperatorCharge(context.charge, context.actorPrincipalId);

  const store = await dependencies.resolver.resolve(context.organizationId);
  if (!store.ok) {
    // AN UNRESOLVABLE STORE REFUSES THE OPERATION rather than answering unrecorded. Note what this
    // means for the collapsed 404: an unknown Organization has no directory entry, so this line is
    // reached for it and answers `unavailable` — which is a DIFFERENT answer from the 404 the
    // other four cases receive.
    //
    // *** THAT IS A REAL RESIDUAL AND IT IS NAMED RATHER THAN HIDDEN. *** It is an
    // Organization-existence signal available to a caller who can already enumerate every
    // Organization from `platform.organizations.list`, one screen away, so it discloses nothing to
    // this population — the same argument `organization-detail-v1` makes for its own 404 and
    // explicitly scopes to this class. IT MUST NOT BE COPIED to a route a tenant principal can
    // reach.
    //
    // THE ALTERNATIVE IS WORSE: answering 404 for an unresolvable store would make a genuine
    // outage indistinguishable from "no such member", so an operator debugging a real incident
    // would be told their customer's staff do not exist.
    return err(store.error);
  }

  let coordination;
  try {
    coordination = await dependencies.coordinator.begin({
      organizationId: context.organizationId,
      principalId: context.actorPrincipalId,
      sourceAddressHash: null,
      nowMs: context.nowMs,
    });
  } catch {
    return err(unavailable());
  }
  if (!coordination.ok) {
    return err(unavailable());
  }

  let admitted;
  try {
    admitted = await coordination.value.reserveWrites(RESOLVE_TENANT_ROW_WRITES);
  } catch {
    return err(unavailable());
  }
  if (!admitted.ok || admitted.value.kind === 'deferred') {
    // THE ORGANIZATION'S OWN BUDGET IS EXHAUSTED, so the probe cannot be recorded, so it does not
    // happen. A tenant whose write allowance is spent is a tenant the platform cannot ask about —
    // which is the fail-closed direction and, incidentally, a small brake on the N-probe attack.
    return err(unavailable());
  }

  const audit = dependencies.auditSinkFor(store.value);
  const operations: readonly WriteOperation[] = [
    audit.operation({
      appId: 'core',
      actionId: context.actionId,
      principalId: context.actorPrincipalId,
      principalType: 'user',
      onBehalfOfPrincipalId: null,
      // THE PERMISSION THE CALLER EXERCISED, derived from the operation rather than fixed, so the
      // tenant's own trail says which grant was used. A resolve is `core.credential.reset`; a feed
      // read is `core.platform-audit.read`, and a customer can tell the two apart.
      permissionId:
        context.actionId === 'platform.organizations.members.resolve'
          ? 'core.credential.reset'
          : 'core.platform-audit.read',
      scope: 'platform',
      // ALWAYS `allowed`. See the header: the record is of the probe, not of its result.
      decision: 'allowed',
      denialReason: null,
      // NULL ON BOTH PATHS. See the header.
      targetResourceId: null,
      targetUnresolved: false,
      relatedBusinessIds: [],
      actorBusinessIds: derivePlatformOperatorActorContext(),
      changedFieldNames: [],
      requestId: context.requestId,
      correlationId: context.correlationId,
      occurredAt: context.occurredAt,
    }),
  ];

  let committed;
  try {
    committed = await store.value.write(operations, admitted.value.reservation);
  } catch {
    return err(unavailable());
  }
  if (!committed.ok) {
    return err(committed.error);
  }
  return ok(undefined);
}
