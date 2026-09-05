/**
 * ===========================================================================================
 * THE DELIBERATELY BROKEN PLATFORM CONTROLS.
 * ===========================================================================================
 *
 * `TESTING_STANDARD.md` §5.6, and the same discipline `broken-controls.ts` applies to the storage
 * boundary: a suite that cannot be made to go red by removing the control it claims to test is
 * not testing it, and that has to be demonstrated rather than argued.
 *
 * *** NOTHING HERE EDITS A FILE UNDER `platform/core/**`. *** Every control is a WRAPPER placed
 * between the shipped composition and a shipped port, which is exactly where a real defect would
 * sit — a store method that answers wrongly, an audit recorder that quietly succeeds. Production
 * has no switch that turns any of this on, because production never constructs these functions.
 *
 * WHAT IS DELIBERATELY **NOT** HERE, AND WHY.
 *
 *   (Nothing, since 2026-09-05. This header previously recorded that the confirmation control
 *   could not be built because no confirmation check existed to remove. `platform/core/
 *   confirmation/**` now exists and `withConfirmationCheckRemoved` below is that control.)
 */

import type { ConfirmationGate } from '../../../platform/core/confirmation/confirmation-gate.ts';
import type { IdentityControlPlaneStore } from '../../../platform/core/identity/control-plane-store.ts';
import type { PlatformAuditRecorder } from '../../../platform/core/platform/platform-audit.ts';
import type { PlatformOperatorStore } from '../../../platform/core/platform/platform-operator-store.ts';
import { ok } from '../../../platform/core/kernel/result.ts';

/**
 * CONTROL 1 — THE MUTUAL-EXCLUSION PROBE.
 *
 * `principalHasAnyMembership` answers `false` for every principal. The probe still runs and still
 * costs its statement, so the equal-work property is untouched; only the ANSWER is wrong.
 *
 * That is deliberately the exact shape of the plausible defect. The tempting "optimisation"
 * `platform-authority.ts` warns about is not deleting the call — it is returning early when the
 * operator row already decided the answer, which produces precisely this: a principal in both
 * tables resolving as a platform operator. Under this control every mutual-exclusion case must go
 * red; a case that stays green does not test the invariant, whatever its name says.
 */
export function withMutualExclusionProbeRemoved(store: PlatformOperatorStore): PlatformOperatorStore {
  return {
    findOperator: (principalId) => store.findOperator(principalId),
    async principalHasAnyMembership() {
      return ok(false);
    },
    listOrganizations: (limit, after) => store.listOrganizations(limit, after),
    recordAction: (record, reservation) => store.recordAction(record, reservation),
  };
}

/**
 * CONTROL 1b — THE MUTUAL EXCLUSION ON THE **ACTION** SIDE.
 *
 * ===========================================================================================
 * WHY A SECOND CONTROL FOR ONE INVARIANT, AND IT IS NOT REDUNDANCY.
 * ===========================================================================================
 *
 * The invariant is now enforced in TWO PLACES that read TWO DIFFERENT statements:
 *
 *   - `platform-authority.ts` calls `PlatformOperatorStore.principalHasAnyMembership`. Control 1
 *     above removes that one.
 *   - `session-resolution.ts::liveSession` reads `isPlatformOperator && holdsMembership` off the
 *     `findPrincipal` row, which `d1-control-plane-store.ts` now computes as two correlated
 *     `EXISTS` subqueries in the statement that was already running.
 *
 * *** CONTROL 1 DOES NOT REACH THE SECOND ONE. *** When the Action-side check landed, the number
 * of cases control 1 could turn red DROPPED — because `liveSession` refuses a both-tables
 * principal before the platform store's probe is ever consulted. That is defence in depth working,
 * and it is also exactly how a negative control quietly stops controlling: the wrapper still runs,
 * still looks like it is breaking something, and the suite stays green for a reason that has
 * nothing to do with the case's claim.
 *
 * So this wrapper removes the OTHER half, and the run applies both separately.
 */
export function withActionSideMutualExclusionRemoved(
  store: IdentityControlPlaneStore,
): IdentityControlPlaneStore {
  return {
    ...store,
    async findPrincipal(principalId) {
      const found = await store.findPrincipal(principalId);
      if (!found.ok || found.value === null) {
        return found;
      }
      // The flag is reported as `false`, which is the shape the defect would take: the subquery
      // still runs and its answer is dropped. Everything else about the row is untouched.
      return ok({ ...found.value, holdsMembership: false });
    },
  };
}

/**
 * CONTROL 2 — THE AUDIT RECORD.
 *
 * `record` succeeds and writes nothing. This is the "best effort" mode `platform-audit.ts` states
 * in capitals that it does not have — *"no fire-and-forget, and no `catch {}`"* — and it is the
 * form the omission would actually take, because the tempting change is to stop failing the
 * operation when the record cannot be written.
 *
 * Under this control every P4 case must go red. A P4 case that stays green is asserting that a
 * request succeeded, not that it was recorded.
 */
export function withAuditRecorderRemoved(_recorder: PlatformAuditRecorder): PlatformAuditRecorder {
  return {
    async record() {
      return ok(undefined);
    },
  };
}

/**
 * ===========================================================================================
 * `0027`'s CENTRAL NEGATIVE CONTROL — THE ONE THAT RECORD MOST WANTED PERFORMED.
 * ===========================================================================================
 *
 *   *"REMOVE THE CONFIRMATION CHECK FROM THE PIPELINE AND EVERY CRITICAL-OPERATION TEST MUST GO
 *   RED. If removing the check turns only some tests red, coverage is incomplete and the suite is
 *   what is wrong, not the finding."*
 *
 * `enforce` returns `ok` for everything. The gate is still composed, still called, still consulted
 * on every critical operation — and always agrees. **That is the shape the defect would actually
 * take**: not a deleted call site, which a reviewer would notice, but a check that runs and never
 * refuses. `requiresConfirmation` still returns true, the pipeline still branches, and the
 * operation proceeds.
 *
 * IT IS A WRAPPER, SO NO FILE UNDER `platform/core/**` IS EDITED. A control that required a
 * production edit could not be run on demand, which is how a control stops being run.
 *
 * EVERY case in `suites/platform-operator/confirmation.ts` that claims a critical operation is
 * gated must go red under this. A case that stays green is not testing the gate, whatever its
 * name says — and per the record, that makes the SUITE the thing that is wrong.
 */
export function withConfirmationCheckRemoved(_gate: ConfirmationGate): ConfirmationGate {
  return {
    async enforce() {
      return ok(undefined);
    },
  };
}

/**
 * CONTROL 3 — THE STORE IS UNREACHABLE.
 *
 * Not used by the standard run. It exists for the audit suite's own case that a failed record
 * write fails the operation, which needs a store whose `recordAction` refuses while every read
 * still works — otherwise the request would fail before it ever reached the recorder and the case
 * would pass for the wrong reason.
 */
export function withFailingActionLog(store: PlatformOperatorStore): PlatformOperatorStore {
  return {
    findOperator: (principalId) => store.findOperator(principalId),
    principalHasAnyMembership: (principalId) => store.principalHasAnyMembership(principalId),
    listOrganizations: (limit, after) => store.listOrganizations(limit, after),
    async recordAction() {
      return { ok: false as const, error: { code: 'unavailable' as const, message: 'A dependency is unavailable.' } };
    },
  };
}
