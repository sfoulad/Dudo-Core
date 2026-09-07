/**
 * ===========================================================================================
 * WHERE PLATFORM AUTHORITY IS RESOLVED, AND WHERE THE MUTUAL EXCLUSION IS ENFORCED.
 * `docs/decisions/0025` decision 1 · `docs/decisions/0024`, both invariants ·
 * contract `platform-operator-v1`, `authorityModel`.
 * ===========================================================================================
 *
 * THIS FILE IS THE CONTROL. Everything else in the mutual-exclusion story — the two write guards
 * below, the four triggers in `0010_platform_operator_mutual_exclusion.sql` — is hygiene, and
 * `0025` says so explicitly:
 *
 *   "ON WRITE stops the state being created by Dudo's own code. AT AUTHORIZATION stops it being
 *   exploited if it is created anyway — by a hand-run SQL statement, a partially applied
 *   migration, or a restore from two backups taken at different moments. The write check is
 *   hygiene; THE AUTHORIZATION CHECK IS THE CONTROL, and an implementation that ships only the
 *   first has shipped none."
 *
 * The three states in that sentence are not hypothetical. `platform_operator`'s ONLY writer is a
 * human running SQL, because `0025` publishes no route that creates a platform operator. So the
 * table carrying platform authority is written by the one path no code check stands in front of,
 * and the check that runs on every request is the only one that covers it.
 *
 * ===========================================================================================
 * WHAT IT REFUSES, AND WHY ALL FOUR ANSWERS ARE THE SAME VALUE
 * ===========================================================================================
 *
 *   1. NO `platform_operator` ROW.                       an ordinary tenant principal
 *   2. AN UNRECOGNISED `platform_role`.                  a row a future migration wrote
 *   3. A ROLE THAT DOES NOT CARRY THE PERMISSION.        evaluated by `authorize()`, one layer up
 *   4. A PRINCIPAL PRESENT IN **BOTH** TABLES.           the state this file exists for
 *
 * All four receive the identical, argument-free `forbidden()`. `kernel/errors.ts` gives that
 * constructor no parameters, so there is nothing to vary. THE FOURTH IS WHY THE COLLAPSE MATTERS:
 * a caller able to detect the mutual-exclusion refusal could use these routes to probe
 * `organization_membership`, and the contract requires that the refusal be indistinguishable from
 * ordinary denial.
 *
 * ===========================================================================================
 * BOTH READS ALWAYS RUN, AND THE COST IS PAID ON PURPOSE
 * ===========================================================================================
 *
 * `resolve` reads `platform_operator` AND probes `organization_membership` on every call, even
 * when the first read already decided the answer. Returning early would make a non-operator cost
 * ONE statement and a principal-in-both cost TWO, and `identity/session-resolution.ts` records
 * what that difference is worth to an attacker:
 *
 *   "The ERROR was already identical; THE WORK WAS NOT, and work is measurable."
 *
 * Two indexed point lookups against a two-row and a few-hundred-row table is not a cost worth
 * optimising, and the population that can reach this code at all is bounded — the routes are
 * mounted only on the admin host, and reaching them needs a live session. So every denial path
 * here issues the same two statements against the same two tables and returns the same value.
 *
 * ===========================================================================================
 * IT DENIES, IT NEVER RESOLVES IN FAVOUR OF EITHER SIDE
 * ===========================================================================================
 *
 * A principal in both tables is not treated as a platform operator and is not treated as a tenant
 * member. `0025`: "refused everywhere, not resolved in favour of either." The tenant half of that
 * is NOT in this file and cannot be — an Action resolves through
 * `identity/session-resolution.ts`, which knows nothing about `platform_operator`. See
 * `assertNotAPlatformOperator` below and the report accompanying this work: the Action-side half
 * of "refused everywhere" is a gap this slice does not close.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { forbidden, notFound } from '../kernel/errors.ts';
import type { PrincipalGrants } from '../authorization/authorizer.ts';
import type { PlatformRole } from './platform-permissions.ts';
import { grantsForPlatformRole } from './platform-permissions.ts';
import type { PlatformOperatorStore } from './platform-operator-store.ts';

/**
 * A principal established as a platform operator.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `organizationId`, `authorizedBusinessIds`,
 * `businessScope`, and any handle to a store. This is deliberately NOT an
 * `AuthenticatedPrincipal` — that type REQUIRES an `organizationId` (`tenancy/tenant-context.ts`)
 * and is the value `TenantStoreResolver` consumes. A platform operator has no Organization, and
 * `0021`'s refused shortcut was exactly "a pseudo-principal with a null organizationId", on the
 * ground that it "would make every tenant predicate in the platform depend on a sometimes-absent
 * value".
 *
 * So this is a separate, smaller type, and there is no function anywhere that turns one into the
 * other.
 */
export type PlatformAuthority = {
  readonly principalId: string;
  /** Narrowed to a recognised value. An unrecognised stored role never produces an authority. */
  readonly platformRole: PlatformRole;
  /** The frozen literal set `platform-permissions.ts` maps the role to. */
  readonly grants: PrincipalGrants;
};

export type PlatformAuthorityResolver = {
  /**
   * Resolves a server-derived principal identifier into platform authority, or refuses.
   *
   * `principalId` COMES FROM A VERIFIED SESSION CREDENTIAL AND FROM NOWHERE ELSE. There is no
   * overload taking it from a request field, a header, or a body, and adding one would be the
   * same defect class as a caller-supplied tenant identifier.
   */
  resolve(principalId: string): Promise<Result<PlatformAuthority>>;
};

export function createPlatformAuthorityResolver(
  store: PlatformOperatorStore,
): PlatformAuthorityResolver {
  return {
    async resolve(principalId: string): Promise<Result<PlatformAuthority>> {
      // ---- Both reads, unconditionally, before any decision. See the header.
      const operatorOutcome = await store.findOperator(principalId);
      const membershipOutcome = await store.principalHasAnyMembership(principalId);

      // A store failure is a Dudo-side fault and is reported as itself (`unavailable`), not as a
      // denial. Collapsing it into `forbidden` would tell a real operator its authority had been
      // revoked when the database was merely unreachable, and would hide an outage behind a
      // routine answer.
      if (!operatorOutcome.ok) {
        return err(operatorOutcome.error);
      }
      if (!membershipOutcome.ok) {
        return err(membershipOutcome.error);
      }

      const operator = operatorOutcome.value;
      const holdsMembership = membershipOutcome.value;

      // =====================================================================================
      // THE MUTUAL EXCLUSION, FAILING CLOSED. Checked FIRST among the denial causes so that no
      // later edit can accidentally place a "resolve in favour of the operator row" branch
      // above it.
      // =====================================================================================
      if (holdsMembership) {
        return err(forbidden());
      }
      if (operator === null) {
        return err(forbidden());
      }
      // `null` here means the stored `platform_role` is absent or is a value this build does not
      // recognise. It denies on the same path as an absent row, and is NOT an error: a row
      // written by a future migration must fail onto the safe path rather than turn a routine
      // mid-migration state into an outage.
      if (operator.platformRole === null) {
        return err(forbidden());
      }

      return ok({
        principalId: operator.principalId,
        platformRole: operator.platformRole,
        grants: grantsForPlatformRole(operator.platformRole),
      });
    },
  };
}

// =============================================================================================
// The write side: a receipt that makes the check impossible to omit.
// =============================================================================================

/**
 * ===========================================================================================
 * PERMISSION TO WRITE AN `organization_membership` ROW, ALREADY CHECKED AGAINST
 * `platform_operator`. `docs/decisions/0025` decision 1 · finding `M-1`.
 * ===========================================================================================
 *
 * `M-1` was that the write-side guards had NO CALL SITES, and that when membership administration
 * eventually lands, **omitting the call would be silent**: nothing fails, no test goes red, and
 * the triggers in `0010` become the only remaining layer — on a database where that migration may
 * not have been applied.
 *
 * EVERY FIX OF THE FORM "REMEMBER TO CALL THE GUARD" HAS THAT FAILURE MODE. This one does not,
 * because it is not a rule: `IdentityControlPlaneStore.createMembership` REQUIRES a value of this
 * type, `admitMembershipWrite` below is the only thing that produces one, and there is no
 * constructor exported from this module. **Omitting the check is not a runtime gap. It does not
 * compile.**
 *
 * THE PRECEDENT IS `ControlPlaneWriteReservation`, deliberately, and its header states the
 * principle this reuses: *"A RECEIPT, NOT A REQUEST… no client can cause this, because clients
 * supply values and never reservations."* One pattern for "you may not perform this write without
 * having done the thing that admits it", rather than two that drift.
 *
 * ===========================================================================================
 * IT IS STRICTER THAN ITS PRECEDENT IN ONE RESPECT, AND THE DIFFERENCE IS DELIBERATE.
 * ===========================================================================================
 *
 * `mintControlPlaneWriteReservation` is EXPORTED, with a comment explaining that it is exported
 * "because the admission implementation below and a future coordinator-backed one both need it,
 * and for no other reason". That is a real requirement there and it is a real cost: an exported
 * mint is a way to fabricate a receipt without doing the work it certifies.
 *
 * THERE IS NO SECOND ADMISSION IMPLEMENTATION HERE AND NONE IS ANTICIPATED, so the mint stays
 * MODULE-PRIVATE and `admitMembershipWrite` is the only exported producer. A caller cannot obtain
 * one of these without the `platform_operator` read actually happening.
 *
 * IT NAMES THE PRINCIPAL IT WAS CHECKED FOR, and `consumeMembershipAdmission` compares that
 * against the row being written. A receipt minted for principal A and spent on principal B is the
 * obvious hole in any scheme of this shape, and it is closed the same way the reservation's brand
 * check closes forgery and reuse.
 */
const MEMBERSHIP_ADMISSION_BRAND: unique symbol = Symbol('dudo.platform.membershipAdmission');

export type MembershipAdmission = {
  readonly [MEMBERSHIP_ADMISSION_BRAND]: true;
  /** The principal the `platform_operator` check was performed FOR. Compared on use. */
  readonly principalId: string;
};

/**
 * THE ONLY CONSTRUCTOR, AND IT IS MODULE-PRIVATE. It must be called only after the
 * `platform_operator` read has actually returned no row. See the type's header.
 */
function mintMembershipAdmission(principalId: string): MembershipAdmission {
  const admission = { principalId };
  Object.defineProperty(admission, MEMBERSHIP_ADMISSION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(admission) as MembershipAdmission;
}

/**
 * Thrown, not returned, for the reason `ControlPlaneWriteNotAdmittedError` is: NO CLIENT CAN CAUSE
 * THIS. Clients supply values, never receipts. What it catches is Dudo's own code writing a
 * membership row without having checked `platform_operator` — which must stop the request rather
 * than be handled, logged and shipped.
 */
export class MembershipNotAdmittedError extends Error {
  constructor(reason: string) {
    super(
      `An organization_membership write was attempted without a valid admission: ${reason}. ` +
        'docs/decisions/0024 invariant 1: a platform principal holds ZERO membership rows, ' +
        'because a membership row carrying platform authority assembles cross-tenant access out ' +
        'of entirely legitimate parts. Obtain an admission from admitMembershipWrite, which is ' +
        'the only producer and which performs the platform_operator read.',
    );
    this.name = 'MembershipNotAdmittedError';
  }
}

/**
 * Verifies a receipt and binds it to the row being written. Called by the adapter, immediately
 * before the INSERT.
 *
 * TWO CHECKS, EACH CLOSING A BYPASS:
 *
 *   1. THE BRAND. A hand-built object is not an admission. `Object.defineProperty` with
 *      `enumerable: false` means it does not survive a `JSON.parse(JSON.stringify(...))` round
 *      trip either, so a receipt cannot be reconstituted from a log line.
 *   2. THE PRINCIPAL. A receipt minted for A cannot fund a write for B.
 *
 * IT IS NOT SINGLE-USE, UNLIKE `ControlPlaneWriteReservation`, AND THE DIFFERENCE IS PRINCIPLED.
 * That one is single-use because it represents CONSUMED CAPACITY — spending it twice would spend
 * one reservation's budget on two writes. This one represents A FACT that was true at the moment
 * it was read: this principal is not a platform operator. Re-using it writes two membership rows
 * for one principal in one operation, which the primary key already refuses, and it consumes no
 * budget. Adding single-use here would be ceremony copied from a precedent rather than reasoned
 * from it.
 *
 * WHAT IT CANNOT CHECK, AND THIS IS THE HONEST LIMIT: the fact can go stale. A principal that was
 * not an operator when the admission was minted could be made one before the INSERT runs. That
 * window is why layers 2 and 3 exist — the statement guard re-asks the question in the same
 * statement that writes, and `0010`'s triggers ask it again at the engine.
 */
export function consumeMembershipAdmission(
  admission: MembershipAdmission,
  principalId: string,
): void {
  const branded = admission as unknown as Record<symbol, unknown> | null | undefined;
  if (
    branded === null ||
    branded === undefined ||
    branded[MEMBERSHIP_ADMISSION_BRAND] !== true
  ) {
    throw new MembershipNotAdmittedError('the value did not come from admitMembershipWrite');
  }
  if (admission.principalId !== principalId) {
    throw new MembershipNotAdmittedError(
      'the admission was checked for a different principal than the row being written',
    );
  }
}

/**
 * THE ONLY PRODUCER OF A `MembershipAdmission`. Reads `platform_operator` and refuses if a row
 * exists.
 *
 * `notFound()` — see `assertNotAPlatformOperator` below for the full argument, which applies
 * unchanged: membership administration is performed by a TENANT principal, and a distinguishable
 * refusal would let any Organization owner enumerate the platform's operators by trying to add
 * candidate principals.
 *
 * THE COLLAPSE IS A PROPERTY OF THE PAIR AND HALF OF IT IS THE CALLER'S. This function returns a
 * receipt for a principal that does not exist, because "does this principal exist" is the
 * surrounding operation's own step. The anti-oracle holds only if that step also answers
 * `notFound()`.
 */
export async function admitMembershipWrite(
  store: PlatformOperatorStore,
  principalId: string,
): Promise<Result<MembershipAdmission>> {
  const operator = await store.findOperator(principalId);
  if (!operator.ok) {
    return err(operator.error);
  }
  // A row with an UNRECOGNISED role still blocks. It grants nothing, but it is still a
  // `platform_operator` row, and the invariant is about the row's EXISTENCE rather than about what
  // it currently grants — a role this build does not understand may be one a later build does.
  if (operator.value !== null) {
    return err(notFound());
  }
  return ok(mintMembershipAdmission(principalId));
}

// =============================================================================================
// The early-refusal helpers. USEFUL, AND NOT THE ENFORCEMENT — see below.
// =============================================================================================

/**
 * Refuses to create a `platform_operator` row for a principal that already holds a membership.
 *
 * ===========================================================================================
 * IT IS NOT THE ENFORCEMENT. IT IS A WAY TO REFUSE EARLY WITH A BETTER MESSAGE.
 * ===========================================================================================
 *
 * Said plainly because the previous version of this header did not, and finding `M-1` is exactly
 * what happens when a comment overstates what guards something: the next reviewer concludes the
 * guard is already handled.
 *
 * THE ENFORCEMENT FOR THE MEMBERSHIP DIRECTION IS `admitMembershipWrite` ABOVE, whose receipt
 * `createMembership` requires and which therefore cannot be skipped. This function performs the
 * same read and returns the same `notFound()`, and it exists only so that an operation can refuse
 * before it has reserved write capacity or begun a multi-step write — the same validate-then-
 * reserve ordering `session-resolution.ts` uses, and for the same reason.
 *
 * `0025` publishes no route that creates a platform operator, so the OPERATOR direction has no
 * code path to put anything in front of. It is written, exported and tested so that
 * `identity/tools/seed-platform-operator.ts` can name the check its guarded
 * `INSERT ... WHERE NOT EXISTS` performs in SQL, and so that the day a create route is proposed
 * the check exists rather than being one somebody has to think of.
 *
 * IT RETURNS `notFound()`, AND THE CHOICE IS EXPLAINED WITH ITS SIBLING BELOW — read that one
 * first, because that is where the oracle lives. This direction has no such exposure (its only
 * possible caller already holds platform authority), and `conflict()` would arguably read better
 * here. It is `notFound()` anyway, so that the two directions of one invariant do not answer with
 * two different codes: a caller that could tell them apart could tell which table refused it.
 */
export async function assertNotAnOrganizationMember(
  store: PlatformOperatorStore,
  principalId: string,
): Promise<Result<void>> {
  const holdsMembership = await store.principalHasAnyMembership(principalId);
  if (!holdsMembership.ok) {
    return err(holdsMembership.error);
  }
  return holdsMembership.value ? err(notFound()) : ok(undefined);
}

/**
 * Refuses to create an `organization_membership` row for a principal that is a platform operator.
 *
 * ===========================================================================================
 * THIS IS THE DIRECTION THAT WILL ACTUALLY BE NEEDED, AND ITS CALL SITE DOES NOT EXIST YET.
 * ===========================================================================================
 *
 * `organization_membership` is written by onboarding (`organization-onboarding-v1`, not built)
 * and by membership administration (the organization-structure slice, not built). Onboarding
 * creates a brand-new principal, so it cannot hit this. MEMBERSHIP ADMINISTRATION CAN, and the
 * realistic route to it is entirely reasonable: an operator uses its own principal to create a
 * tenant it then wants to look inside.
 *
 * That is precisely `0024`'s trap arrived at by a sensible path, which is why the check must be
 * mechanical rather than remembered.
 *
 * *** AND IT NOW IS, WHICH MEANS THIS FUNCTION IS NO LONGER THE THING THAT ENFORCES IT. ***
 * `IdentityControlPlaneStore.createMembership` requires a `MembershipAdmission`, and
 * `admitMembershipWrite` is the only producer, so the check cannot be omitted — it does not
 * compile. This function performs the same read and returns the same value, and its remaining use
 * is refusing EARLY, before capacity is reserved or a multi-step write begins.
 *
 * The layers behind it, in order: the receipt (does not compile), the guarded `INSERT ... SELECT
 * ... WHERE NOT EXISTS` in the adapter (the row is not created even on a database where `0010`
 * was never applied), and `0010`'s four triggers.
 *
 * ===========================================================================================
 * IT RETURNS `notFound()`, AND IT USED TO RETURN `conflict()`. THAT WAS AN ORACLE.
 * ===========================================================================================
 *
 * THINK ABOUT WHO CALLS THIS. Membership administration is performed by an ORGANIZATION'S OWN
 * OWNER — a tenant principal with no platform authority whatsoever. If adding a member answered
 * `conflict` for a principal that holds a `platform_operator` row and `not_found` for one that
 * does not exist, then **any tenant administrator could enumerate the platform's operators** by
 * trying to add candidate principals and reading which answer came back. That is a tenant
 * principal learning a fact about the platform's own privileged accounts, which is the most
 * valuable list in the system and the natural first step before targeting one of them.
 *
 * `notFound()` COLLAPSES IT, and it is the collapse the platform already uses everywhere else for
 * "you may not act on this identifier": `session-resolution.ts` ruling 1 gives a non-member, a
 * suspended member and a caller naming a non-existent Organization the same argument-free
 * `notFound()`, from the same work. A principal that cannot be added and a principal that does
 * not exist are, to a tenant administrator, the same fact — and `kernel/errors.ts` gives the
 * constructor no parameters, so there is nothing here to vary.
 *
 * IT COSTS SOMETHING AND THE COST IS ACCEPTED: an administrator who mistypes an identifier and an
 * administrator who names a real platform operator get the same message, and neither can tell
 * why. That is the same cost `session-resolution.ts` records for the suspended-membership branch,
 * paid for the same reason.
 *
 * ===========================================================================================
 * THE COLLAPSE IS A PROPERTY OF THE **PAIR**, AND HALF OF IT IS THE CALLER'S TO SUPPLY.
 * ===========================================================================================
 *
 * THIS FUNCTION ANSWERS ONE QUESTION — "is this principal a platform operator" — so for a
 * principal that DOES NOT EXIST AT ALL it returns `ok`. That is correct and it is not the gap it
 * looks like: refusing a non-existent principal is the surrounding operation's own step.
 *
 * WHICH MEANS THE ANTI-ORACLE HOLDS ONLY IF THE CALLER'S "NO SUCH PRINCIPAL" ANSWER IS ALSO
 * `notFound()`. If a future membership-administration Action answers `not_found` for a ghost and
 * this `not_found` for an operator, the two are indistinguishable and the property holds. If it
 * answers anything else for a ghost — `invalid_argument`, a validation detail naming the field, a
 * 422 — then THIS refusal becomes the odd one out and the oracle reappears, one layer up, in code
 * that never read this file.
 *
 * **THAT IS AN OBLIGATION ON WHOEVER BUILDS MEMBERSHIP ADMINISTRATION, AND IT IS WRITTEN HERE
 * BECAUSE IT CANNOT BE ENFORCED FROM HERE.** It is the same shape as `control-plane-store.ts`'s
 * "the caller must have validated membership first": a property that spans two components, stated
 * at the one that can explain why.
 *
 * A FUTURE SLICE MAY NEED A DIFFERENT CODE. It must change it deliberately, with a reviewer, and
 * it must first answer the question above: **can the caller of this operation be a tenant
 * principal?** If yes, the collapse is not negotiable.
 */
export async function assertNotAPlatformOperator(
  store: PlatformOperatorStore,
  principalId: string,
): Promise<Result<void>> {
  const operator = await store.findOperator(principalId);
  if (!operator.ok) {
    return err(operator.error);
  }
  // A row with an UNRECOGNISED role still blocks. It grants nothing, but it is still a
  // `platform_operator` row, and the invariant is about the row's existence rather than about
  // what it currently grants — a role this build does not understand may be one a later build
  // does.
  return operator.value === null ? ok(undefined) : err(notFound());
}
