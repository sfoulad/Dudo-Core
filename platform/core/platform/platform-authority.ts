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
// The write side. Hygiene, not the control — see the header.
// =============================================================================================

/**
 * Refuses to create a `platform_operator` row for a principal that already holds a membership.
 *
 * ===========================================================================================
 * NOTHING IN THIS REPOSITORY CALLS IT TODAY, AND THAT IS THE HONEST STATE RATHER THAN AN
 * OVERSIGHT.
 * ===========================================================================================
 *
 * `0025` publishes no route that creates a platform operator, so there is no code path to put
 * this in front of. It is written, exported and tested so that:
 *
 *   - `platform/core/identity/tools/seed-platform-operator.ts` can name the check its guarded
 *     `INSERT ... WHERE NOT EXISTS` performs in SQL, and point at the trigger behind it; and
 *   - the day a create route is proposed, the guard exists and its absence at the call site is a
 *     visible omission rather than a check nobody wrote.
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
 * mechanical rather than remembered. WHOEVER BUILDS THAT SLICE MUST CALL THIS BEFORE THE INSERT,
 * and `0010_platform_operator_mutual_exclusion.sql` is the backstop if they do not.
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
