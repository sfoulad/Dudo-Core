/**
 * ===========================================================================================
 * TYPE-NEGATIVE FIXTURE — `ControlPlaneWriteReservation`. `docs/decisions/0014` §A.11.
 * ===========================================================================================
 *
 * *** NOTHING IN THIS FILE IS EXECUTED. IT EXISTS TO BE COMPILED AND TO FAIL. ***
 *
 * `core-agent`'s finding, and it is the reason this fixture outranks the one beside it: *"
 * `ControlPlaneWriteReservation`'s brand check has exactly the same blind spot and has had it
 * since it shipped. We've been relying on nobody editing a signature."* The membership receipt is
 * days old; this one has been load-bearing for the whole control plane, untested, since `0014`.
 *
 * Every control-plane write takes one: `createSession`, `deleteSession`, `createMembership`,
 * `setSessionActiveOrganization`, `recordAction`. Relax any of those signatures and writes proceed
 * against an ACCOUNT-WIDE daily allowance with nothing accounted — and D1's write limit being
 * account-wide is what makes that everyone's outage rather than one tenant's.
 *
 * ===========================================================================================
 * THE TWO RECEIPTS ARE NOT SYMMETRIC, AND THE DIFFERENCE IS ASSERTED RATHER THAN LEFT AS A GAP
 * ===========================================================================================
 *
 *                          | MembershipAdmission | ControlPlaneWriteReservation
 *   -----------------------|---------------------|------------------------------
 *   the brand symbol       | not exported        | not exported
 *   the mint               | NOT exported        | *** EXPORTED ***
 *   forge-a-literal case   | testable            | testable
 *   call-the-mint case     | testable            | NOT TESTABLE — it compiles, correctly
 *
 * `mintControlPlaneWriteReservation` is exported on purpose, and its own header says why: *"
 * because the admission implementation below and a future coordinator-backed one both need it,
 * and for no other reason."* The membership receipt has no second implementation, which is why its
 * mint stayed private — it is STRICTER than the precedent it copies.
 *
 * SO THE CONTROL AT THE BOTTOM OF THIS FILE IS A LINE THAT MUST COMPILE. A fixture asserting the
 * reservation's mint is unreachable would fail for a CORRECT reason and read as a defect, and the
 * obvious repair — export the membership mint, or hide this one — would damage something that is
 * currently right. Writing the asymmetry in as an assertion is what stops that.
 */

import type {
  IdentityControlPlaneStore,
  NewOrganizationMembership,
  SessionRecord,
} from '../../../../platform/core/identity/control-plane-store.ts';
import type { ControlPlaneWriteReservation } from '../../../../platform/core/identity/control-plane-admission.ts';
import { mintControlPlaneWriteReservation } from '../../../../platform/core/identity/control-plane-admission.ts';
import type { MembershipAdmission } from '../../../../platform/core/platform/platform-authority.ts';

// =============================================================================================
// THE CONTROL. It must compile, and the runner asserts it produced no diagnostic.
// =============================================================================================

export function theCorrectCallCompiles(
  store: IdentityControlPlaneStore,
  session: SessionRecord,
  reservation: ControlPlaneWriteReservation,
): Promise<unknown> {
  return store.createSession(session, reservation);
}

// =============================================================================================
// CASE 1 — THE OMITTED RESERVATION.
//
// The regression `core-agent` named: a signature relaxed to `reservation?:` compiles, every suite
// stays green, and `0014` §A.11 is defeated for that writer with nothing to notice it.
// =============================================================================================

export function omittingTheReservationDoesNotCompile(
  store: IdentityControlPlaneStore,
  session: SessionRecord,
): Promise<unknown> {
  // @expect-error TS2554
  return store.createSession(session);
}

// =============================================================================================
// CASE 2 — THE FORGED LITERAL.
//
// The fields are all public knowledge — a principal id, a count, a UTC day — so without the brand
// any caller could assemble one and write against an allowance nothing decremented. This is the
// case that has been untested since `0014` shipped.
// =============================================================================================

export function forgingAReservationLiteralDoesNotCompile(
  store: IdentityControlPlaneStore,
  session: SessionRecord,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createSession(session, {
    principalId: 'prn_forged_00000001',
    estimatedRowWrites: 3,
    dayStartMs: 0,
  });
}

// =============================================================================================
// CASE 3 — A BARE STRING, for the reason case 3 exists in the fixture beside this one: a brand
// implemented as an optional property would reject a string while accepting the literal above.
// =============================================================================================

export function passingABareStringDoesNotCompile(
  store: IdentityControlPlaneStore,
  session: SessionRecord,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createSession(session, 'prn_forged_00000001');
}

// =============================================================================================
// CASE 4 — THE TWO RECEIPTS ARE NOT INTERCHANGEABLE.
//
// Not in the original brief, and it is worth its own case: both are branded objects carrying a
// `principalId`, so a call site holding one and needing the other is a plausible mistake — and
// `createMembership` takes BOTH, adjacently. If either brand were ever weakened to a shared
// marker, this is the case that notices; neither of the forge-a-literal cases would.
// =============================================================================================

export function aReservationIsNotAnAdmission(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  reservation: ControlPlaneWriteReservation,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createMembership(record, reservation, reservation);
}

export function anAdmissionIsNotAReservation(
  store: IdentityControlPlaneStore,
  record: NewOrganizationMembership,
  admission: MembershipAdmission,
): Promise<unknown> {
  // @expect-error TS2345
  return store.createMembership(record, admission, admission);
}

// =============================================================================================
// THE ASYMMETRY, AS A CONTROL RATHER THAN AS A GAP.
//
// This MUST COMPILE. `mintControlPlaneWriteReservation` is exported deliberately, so there is no
// "call the mint directly" negative case on this side and there must not be one.
//
// IF THIS LINE EVER STOPS COMPILING, someone has made the reservation match the membership
// receipt — and that is a real change to a shipped decision (`0014` §A), not tidying. The runner
// will report it as an unexpected diagnostic on an unmarked line, which is exactly the right
// alarm: a control that quietly stopped being true.
// =============================================================================================

export function theReservationMintIsDeliberatelyReachable(
  principalId: string,
): ControlPlaneWriteReservation {
  return mintControlPlaneWriteReservation({
    principalId,
    estimatedRowWrites: 1,
    dayStartMs: 0,
  });
}
