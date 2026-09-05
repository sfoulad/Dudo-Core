/**
 * ===========================================================================================
 * TYPE-NEGATIVE FIXTURE — `MembershipAdmission`, the receipt that closes `M-1`.
 * `docs/decisions/0024` invariant 1 · `docs/decisions/0025` decision 1.
 * ===========================================================================================
 *
 * *** NOTHING IN THIS FILE IS EXECUTED. IT EXISTS TO BE COMPILED AND TO FAIL. ***
 *
 * `M-1` was closed by converting a discipline into a type: `IdentityControlPlaneStore.
 * createMembership` requires a branded `MembershipAdmission`, `admitMembershipWrite` is its only
 * exported producer, and the brand is a module-private `unique symbol` so no external module can
 * name it.
 *
 * THAT GUARANTEE HAS NO RUNTIME SURFACE, WHICH IS WHY IT HAD NO REGRESSION COVER. Relax the third
 * parameter to `admission?: MembershipAdmission`, or export the private mint, and: the typecheck
 * stays green, all three test suites stay green, and the guarantee is gone with nothing saying so.
 * Node strips types without checking them, so no suite in `packages/testing/**` can see it. Only a
 * second `tsc` invocation can, and this file is what it compiles.
 *
 * ===========================================================================================
 * HOW TO READ AND EDIT THIS FILE
 * ===========================================================================================
 *
 * `// @expect-error TSxxxx` on the line IMMEDIATELY BEFORE a line that must produce exactly that
 * diagnostic. The runner asserts three things and the third is the one that matters most:
 *
 *   1. every marked line produced the diagnostic code named;
 *   2. the project as a whole failed to compile;
 *   3. NO UNMARKED LINE PRODUCED ANY DIAGNOSTIC AT ALL.
 *
 * (3) is what makes this a test rather than a gesture. The Team Lead's first hand-run probe died
 * on a wrong type name — `ControlPlaneStore` for `IdentityControlPlaneStore` — and errored before
 * reaching a single case, which looked exactly like success. Under (3) that is a red, because the
 * import line carries no marker.
 *
 * EVERY CASE TAKES ITS INPUTS AS PARAMETERS AND USES ALL OF THEM. `noUnusedLocals` and
 * `noUnusedParameters` are on at the root and inherited here, so an unused binding would emit
 * `TS6133` on an unmarked line and fail the whole run — which is the rule working, not a nuisance.
 */

import type {
  IdentityControlPlaneStore,
  NewOrganizationMembership,
} from '../../../../platform/core/identity/control-plane-store.ts';
import type { ControlPlaneWriteReservation } from '../../../../platform/core/identity/control-plane-admission.ts';
import type { MembershipAdmission } from '../../../../platform/core/platform/platform-authority.ts';

// =============================================================================================
// THE CONTROL. It must compile, and the runner asserts it produced no diagnostic.
//
// Without this, every red below would be indistinguishable from a file that cannot compile at
// all — which is precisely the failure that made the first hand-run probe read as a success.
// =============================================================================================

export function theCorrectCallCompiles(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  reservation: ControlPlaneWriteReservation,
  admission: MembershipAdmission,
): Promise<unknown> {
  return store.createMembership(record, reservation, admission);
}

// =============================================================================================
// CASE 1 — THE OMITTED ARGUMENT.
//
// This is the shape of the regression that motivated the whole harness: someone relaxes the
// parameter to `admission?: MembershipAdmission`, and the call below starts compiling. When it
// does, this file stops failing and the runner says so.
// =============================================================================================

export function omittingTheAdmissionDoesNotCompile(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  reservation: ControlPlaneWriteReservation,
): Promise<unknown> {
  // @expect-error TS2554
  return store.createMembership(record, reservation);
}

// =============================================================================================
// CASE 2 — THE FORGED LITERAL.
//
// The brand is a module-private `unique symbol`, so an object literal carrying the right-looking
// data cannot satisfy the type. This is the check that would break if the symbol were ever
// exported, or if the brand were replaced with a string or a plain property.
// =============================================================================================

export function forgingAnAdmissionLiteralDoesNotCompile(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  reservation: ControlPlaneWriteReservation,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createMembership(record, reservation, { principalId: 'prn_forged_00000001' });
}

// =============================================================================================
// CASE 3 — A BARE STRING.
//
// Named separately from case 2 rather than folded into it. A brand implemented as an optional
// property would still reject a string while ACCEPTING the literal above, so the two cases fail
// independently and a build that regressed only one of them is distinguishable.
// =============================================================================================

export function passingABareStringDoesNotCompile(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  reservation: ControlPlaneWriteReservation,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createMembership(record, reservation, 'prn_forged_00000001');
}

// =============================================================================================
// CASE 4 — THE MINT CANNOT BE NAMED FROM OUTSIDE.
//
// *** THIS CASE EXISTS ON THE MEMBERSHIP SIDE AND HAS NO COUNTERPART ON THE RESERVATION SIDE. ***
// See `write-reservation.ts`: `mintControlPlaneWriteReservation` IS exported, deliberately, and a
// fixture asserting otherwise would fail for a correct reason and read as a defect.
//
// `mintMembershipAdmission` is module-private because the membership receipt has no second
// implementation to serve. The two receipts are NOT symmetric, and that asymmetry is asserted
// here rather than smoothed over — so the next reader cannot "close the gap" by exporting this
// mint or by hiding the other one, either of which damages something currently correct.
// =============================================================================================

// `TS2724`, NOT `TS2305`, AND THE DIFFERENCE WAS OBSERVED RATHER THAN ASSUMED. I expected 2305
// ("has no exported member") and tsc emits 2724 — the same condition, reported with a
// did-you-mean, because `MembershipAdmission` is a near miss for the name. Encoding the code I
// assumed and then adjusting the fixture until it matched would have produced a test that
// describes itself; this is the code the compiler actually gives.
// @expect-error TS2724
import { mintMembershipAdmission } from '../../../../platform/core/platform/platform-authority.ts';

export function callingThePrivateMintDoesNotCompile(principalId: string): unknown {
  // The import above is the diagnostic. This line exists so the imported name is used — an unused
  // import would emit TS6133 on an unmarked line and fail the run for the wrong reason.
  return (mintMembershipAdmission as unknown as (id: string) => unknown)(principalId);
}
