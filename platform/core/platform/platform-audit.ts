/**
 * ===========================================================================================
 * THE PLATFORM-OPERATOR ACTION LOG. `docs/decisions/0025` decision 5 · contract
 * `platform-operator-v1`, `auditModel` and binding property P4.
 * ===========================================================================================
 *
 * EVERY OPERATION IN THIS CLASS WRITES A RECORD. Not the sensitive ones, not the writes — EVERY
 * ONE, including `platform.organizations.list` and `platform.session.whoami`, both of which are
 * pure reads. There is no unaudited platform route and none may be added.
 *
 * WHY EVEN THE READS, because this is the part that looks excessive and is not. `permission-
 * catalog.yaml` keeps `list` separate from `read` because "enumeration is its own disclosure". AN
 * OPERATOR ENUMERATING EVERY ORGANIZATION ON THE PLATFORM IS EXACTLY THE RECONNAISSANCE STEP THAT
 * PRECEDES A TARGETED ACTION, it is the cheapest thing to do and the easiest to deny afterwards.
 * A read log for four routes at operator volume is a handful of rows a day.
 *
 * THE SAME ARGUMENT DOES **NOT** GENERALISE TO TENANT ACTIONS, where `0013` D2 deliberately
 * leaves successful reads unaudited because the volume is six orders of magnitude larger. If
 * anyone ever cites this file as precedent for auditing tenant reads, they have dropped the only
 * premise that makes it affordable.
 *
 * ===========================================================================================
 * WHO CAUSES A ROW — AND THE ANSWER IS THE FREE-TIER ARGUMENT, NOT A CONVENIENCE
 * ===========================================================================================
 *
 * A RECORD IS WRITTEN ONLY ONCE THE CALLER HAS BEEN ESTABLISHED AS A PLATFORM OPERATOR: a
 * `platform_operator` row with a recognised role, and no `organization_membership` row.
 * Everything refused before that point — no session, an expired session, a tenant principal, a
 * principal present in both tables — WRITES NOTHING.
 *
 * THAT IS LOAD-BEARING AND IT IS NOT AN OMISSION IN THE AUDIT TRAIL. `0013`'s finding was that an
 * unauthenticated or merely authenticated caller who can force a D1 write can exhaust an
 * account-wide 100,000 rows/day and stop D1 answering for EVERY Organization. If a denied
 * non-operator wrote a record here, every principal on the platform could force writes at its own
 * rate, and the contract's own safety argument — "the population that can force a write is
 * bounded by the number of real operators" — would be false.
 *
 * SO THE TRAIL COVERS WHAT OPERATORS DO, INCLUDING WHAT THEY TRY AND ARE REFUSED (`outcome:
 * 'denied'` for a role that does not carry the permission). It does NOT cover attempts by
 * non-operators, which are indistinguishable from noise and are the thing an attacker can
 * manufacture without limit.
 *
 * *** THIS IS AN INTERPRETATION OF P4, NOT A QUOTATION OF IT. *** The contract says "every
 * operation in this class writes an audit record" and does not say which side of the authority
 * check the write sits on. Both readings are defensible; this one is chosen because the other
 * contradicts the contract's own free-tier section. REPORTED TO THE TEAM LEAD as something
 * `platform-operator-v1` should state explicitly.
 *
 * ===========================================================================================
 * ORDERING AND PARTIAL FAILURE — the two-database problem, chosen rather than solved
 * ===========================================================================================
 *
 * The contract's ruling: THE OPERATION'S OWN WRITES FIRST, THEN THE PLATFORM AUDIT RECORD, THEN
 * THE TENANT RECORD. THE OPERATION IS NOT REPORTED SUCCESSFUL UNTIL THE PLATFORM AUDIT RECORD IS
 * WRITTEN.
 *
 * Control-plane writes and tenant writes are TWO DATABASES, so there is no batch that commits
 * both — the device `TenantScopedStore.write` uses to make a mutation and its audit row one unit
 * is unavailable here. Something can therefore always fail between them. The contract chooses:
 *
 *   A FAILED PLATFORM AUDIT WRITE FAILS THE OPERATION and is reported as `unavailable`. `0013` D2:
 *   "the audit event must not fail open", and inability to record the evidence is not a reason to
 *   proceed without it.
 *
 *   A FAILED TENANT-SIDE WRITE DOES NOT ROLL BACK THE OPERATION — it cannot, the control-plane
 *   rows are committed — and is a reconciliation obligation. THAT ASYMMETRY IS A REAL WEAKNESS
 *   AND THE CONTRACT NAMES IT: the customer's copy of the trail is the one that can go missing,
 *   and it is the one they most need.
 *
 * NEITHER ROUTE IN THIS SLICE HAS AN AFFECTED ORGANIZATION, so no tenant-side record is written
 * by anything here and this file has no code path that could write one. It becomes reachable with
 * `organization-onboarding-v1` and `credential-reset-v1`.
 *
 * ===========================================================================================
 * WHAT THIS FILE WILL NOT DO
 * ===========================================================================================
 *
 * IT NEVER RECORDS THE CONTENTS OF WHAT WAS TOUCHED. `PlatformOperatorActionRecord` has no field
 * for a value, a name, a count or a summary, and none may be added — `0009_platform_operator_
 * action.sql` states that as a normative constraint on the schema rather than a description of
 * it. An operator log that accumulates customer data is a second copy of the tenant database with
 * weaker access rules.
 *
 * IT NEVER SUPPRESSES A FAILURE. There is no "best effort" mode, no fire-and-forget, and no
 * `catch {}`. Every failure path returns `unavailable()` and the caller's operation fails with it.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unavailable } from '../kernel/errors.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import { PLATFORM_OPERATOR_ACTION_ROW_WRITES } from '../identity/control-plane-admission.ts';
import type { PlatformAuthority } from './platform-authority.ts';
import type {
  PlatformActionOutcome,
  PlatformActionTargetKind,
  PlatformOperatorStore,
} from './platform-operator-store.ts';

/**
 * What an operation names, if anything.
 *
 * A DISCRIMINATED UNION RATHER THAN TWO NULLABLE FIELDS, so `{kind: 'none', id: 'x'}` and
 * `{kind: 'organization', id: null}` are both unrepresentable. A target kind that disagreed with
 * its identifier would be a log line nobody could interpret afterwards, which is the failure mode
 * that matters for an audit record — it is read once, years later, by someone who cannot ask.
 */
export type PlatformActionTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'organization'; readonly organizationId: string }
  | {
      readonly kind: 'principal';
      readonly principalId: string;
      /**
       * *** REQUIRED, NOT OPTIONAL, AND THAT IS THE WHOLE OF `0014`'s POINT. ***
       *
       * WHICH ORGANIZATION THE ACTION HAPPENED IN — a different question from what it acted on.
       * A resolve acts on a principal and happens in an Organization; a credential reset will do
       * the same. `0028` Decision 3's Organization feed selects on this, and **without it a
       * principal-targeted record is invisible to the feed built to disclose it.**
       *
       * IT IS REQUIRED SO THE OMISSION IS UNREPRESENTABLE. `0009` stored one target and the gap
       * was found by reading a contract against a schema, not by anything failing. An optional
       * field here would reproduce that exactly: the feed would return 200 and be empty of the
       * records it exists for, and every handler that forgot would look like every handler that
       * did not.
       *
       * A PRINCIPAL-TARGETED ACTION THAT GENUINELY HAPPENS IN NO ORGANIZATION HAS NO WAY TO SAY
       * SO, DELIBERATELY. There is no such operation today and one would be a design question —
       * a platform action naming a person outside any tenant — rather than a field to widen.
       */
      readonly organizationId: string;
    };

/** The one target value for an operation that names nothing. Frozen so it cannot be mutated. */
export const NO_TARGET: PlatformActionTarget = Object.freeze({ kind: 'none' as const });

export type PlatformAuditRecorder = {
  /**
   * Writes one record, or fails the operation.
   *
   * `actor` IS A RESOLVED `PlatformAuthority`, WHICH IS THE TYPE-LEVEL FORM OF THE RULE ABOVE:
   * there is no way to call this for a caller whose authority was not established, because there
   * is no way to construct the argument. `createPlatformAuthorityResolver` is the only producer
   * of that type and it refuses every one of the four denial causes.
   */
  record(entry: {
    readonly actor: PlatformAuthority;
    /** A Core-owned literal from the frozen route table. Never a caller-supplied string. */
    readonly actionId: string;
    readonly target: PlatformActionTarget;
    readonly outcome: PlatformActionOutcome;
    /** Already validated against `^[A-Za-z0-9_-]{8,64}$` at the transport boundary. */
    readonly correlationId: string;
  }): Promise<Result<void>>;
};

export type PlatformAuditDependencies = {
  readonly store: PlatformOperatorStore;
  readonly admission: ControlPlaneWriteAdmission;
  readonly ids: IdGenerator;
  readonly clock: Clock;
};

function targetColumns(target: PlatformActionTarget): {
  kind: PlatformActionTargetKind;
  id: string | null;
  organizationId: string | null;
} {
  switch (target.kind) {
    case 'organization':
      // BOTH COLUMNS CARRY THE SAME IDENTIFIER, and that is not redundancy. `target_id` says what
      // the operation acted on; `target_organization_id` says where it happened. For an
      // Organization-targeted action those coincide — and writing only the first would make the
      // Organization feed miss every onboarding, which is the same defect one row over.
      return {
        kind: 'organization',
        id: target.organizationId,
        organizationId: target.organizationId,
      };
    case 'principal':
      return {
        kind: 'principal',
        id: target.principalId,
        organizationId: target.organizationId,
      };
    case 'none':
      return { kind: 'none', id: null, organizationId: null };
    default: {
      const unreachable: never = target;
      throw new Error(`Unsupported platform action target: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function createPlatformAuditRecorder(
  dependencies: PlatformAuditDependencies,
): PlatformAuditRecorder {
  const { store, admission, ids, clock } = dependencies;

  return {
    async record(entry): Promise<Result<void>> {
      const nowMs = clock.nowMs();

      // ===================================================================================
      // THE RESERVATION IS CHARGED TO THE OPERATOR'S OWN PRINCIPAL, AND THAT IS THE REAL BOUND
      // ON THIS CLASS.
      // ===================================================================================
      //
      // `0014` §A.11: all storage writers use this admission port. `PER_PRINCIPAL_DAILY_ROW_
      // WRITES` is 600, and at 2 row-writes a record that is 300 PLATFORM ACTIONS PER OPERATOR
      // PER UTC DAY.
      //
      // THAT IS THE BOUND THE CONTRACT LEANS ON IN PLACE OF A WORKING RATE LIMITER. `0017`'s
      // limiter is in-process and per-isolate, so it bounds nothing in a deployed Worker, and
      // the durable one is still owed (contract PO-4). At one or two operators the daily write
      // ceiling holds — but it must NOT be read as "rate limiting is done", and the console's
      // home screen calling both routes on every page load spends 4 row-writes per load, which
      // is about 150 page loads a day. That is workable at closed-beta scale and it is tight
      // enough to be worth knowing.
      const admitted = await admission.reserve({
        principalId: entry.actor.principalId,
        estimatedRowWrites: PLATFORM_OPERATOR_ACTION_ROW_WRITES,
        nowMs,
      });
      if (!admitted.ok) {
        // COLLAPSED TO `unavailable`. See below — one answer for every way this can fail.
        return err(unavailable());
      }
      if (admitted.value.kind === 'deferred') {
        // ===============================================================================
        // AN EXHAUSTED BUDGET LOCKS THE OPERATOR OUT OF THE CONSOLE, AND THAT IS CORRECT.
        // ===============================================================================
        //
        // The alternative is to serve the request without recording it, which is the audit
        // event failing open. `0013` D2 forbids exactly that.
        //
        // IT IS REPORTED AS `unavailable` RATHER THAN `quota_exceeded`, and the reason is the
        // contract rather than a preference: neither route in this class declares
        // `quota_exceeded` among its errors, and `platform-operator-v1` states that a failed
        // platform audit write "fails the operation and is reported as unavailable".
        //
        // THE COST OF THAT CHOICE, STATED: the operator gets a 503 with no `Retry-After`,
        // where the true answer is "00:00 UTC" and is a pure function of the clock. A caller
        // cannot tell a budget exhaustion from a database outage. REPORTED to the Team Lead as
        // something the contract should decide — either `quota_exceeded` joins the declared
        // errors for this class, or this stays and the console has to explain a 503 it cannot
        // diagnose.
        return err(unavailable());
      }

      const columns = targetColumns(entry.target);
      const written = await store.recordAction(
        {
          // 128 opaque bits from the platform CSPRNG. Not a counter: a sequential audit
          // identifier tells any reader how many operator actions have ever occurred, and a gap
          // tells them one was deleted.
          actionRecordId: ids.generate(),
          actorPrincipalId: entry.actor.principalId,
          // The role AS IT WAS AT THE TIME. If the operator's row is later changed or deleted,
          // this record still says what authority the action was taken under.
          actorPlatformRole: entry.actor.platformRole,
          actionId: entry.actionId,
          targetKind: columns.kind,
          targetId: columns.id,
          targetOrganizationId: columns.organizationId,
          outcome: entry.outcome,
          occurredAt: toRfc3339Utc(nowMs),
          correlationId: entry.correlationId,
        },
        admitted.value.reservation,
      );
      if (!written.ok) {
        // ONE ANSWER FOR EVERY FAILURE. A reservation error, an exhausted budget and a failed
        // INSERT are three causes and one `unavailable()`, which takes no arguments and so has
        // nothing to vary. A caller learns that the operation did not happen and nothing about
        // the platform's internal state.
        return err(unavailable());
      }
      return ok(undefined);
    },
  };
}
