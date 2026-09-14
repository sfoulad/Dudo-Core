/**
 * ===========================================================================================
 * ROLES, AND THE EXPLICIT PERMISSION SETS THEY MAP TO. `docs/decisions/0019`, closing AZ5.
 * ===========================================================================================
 *
 * `0007` settled what a permission is and how it is enforced. It never said WHERE a principal's
 * grants are stored, so `principal-authorization-source.ts` granted nothing and every
 * authenticated request was refused at pipeline step 3 — login worked and the product did nothing.
 * `0019` decides: the grant is a `role` on the membership row, and THIS FILE IS THE MAPPING.
 *
 * ===========================================================================================
 * WHY A ROLE COLUMN AND NOT A GRANT TABLE — the reason is row-writes, not taste
 * ===========================================================================================
 *
 * A `principal_permission` table costs one row per permission per principal per Organization:
 * fifteen rows to grant and fifteen to revoke, against a control-plane sub-ceiling of 3,000
 * row-writes a day that `0018` has just shown is tighter than it looks once logout is counted. A
 * role is a column on a row that already exists and is already read during Organization
 * selection, so it costs ZERO additional rows. `0019` records that a grant table is the better
 * answer for a product with per-principal permission editing, and that Dudo has no such surface.
 *
 * ===========================================================================================
 * THIS FILE IS WHERE A WILDCARD WOULD BE SMUGGLED BACK IN, WHICH IS WHY IT HAS NONE
 * ===========================================================================================
 *
 * `0007` rule 3 forbids wildcards and rule 4 requires explicit registration. A role is exactly
 * the construct that tempts both rules to be relaxed — `owner: ['customers.*']` is shorter, reads
 * as obviously correct, and silently grants every permission any future App ever registers under
 * that prefix, including ones nobody has written yet.
 *
 * SO THE SETS BELOW ARE FROZEN ARRAYS OF LITERAL PERMISSION IDENTIFIERS. There is no pattern, no
 * prefix, no `startsWith`, no glob, and no code path that derives a permission id from anything
 * other than these literals. Adding a permission to a role is an edit to this file, in
 * `platform/core/**`, with a reviewer — which is what "explicit registration" means.
 *
 * ROLES ARE CORE'S AND ARE NOT EXTENDABLE BY AN APP. An App declares in its manifest what it
 * NEEDS; it never declares what a role GRANTS. `authorizer.ts` enforces both halves — the App's
 * declaration is a ceiling and the principal's grant is the floor, and neither substitutes for
 * the other.
 *
 * ===========================================================================================
 * THE UNION IS CLOSED AND AN UNRECOGNISED VALUE DENIES EVERYTHING
 * ===========================================================================================
 *
 * `grantsForRole` takes `MembershipRole | null` and `null` means "absent, or a stored value this
 * build does not recognise" — the adapter collapses both to `null` on read. That is the same
 * device `credential-verifier.ts` uses for an unrecognised credential algorithm, and for the same
 * reason: a stored value a future migration introduced must fail onto the SAFE path rather than
 * onto an error path, so a partially-migrated deployment denies rather than breaking, and so the
 * distinction is not measurable from outside.
 *
 * IT IS NOT AN ERROR AND IT IS NOT A PARTIAL GRANT. `0019`: deny all, on the same path as an
 * absent membership. Deny by default survives — no membership, no role, no permissions.
 */

import type { PermissionGrant, PrincipalGrants } from './authorizer.ts';
// THE CRITICAL SET IS READ, NEVER RESTATED. `critical-permissions.ts` owns it and imports only
// `action/action.ts` and `statements.ts`, so there is no cycle — checked before adding this line.
import { criticalPermissions } from '../confirmation/critical-permissions.ts';

/**
 * ===========================================================================================
 * THE SEED ROLE SET. **TWO UNTIL 2026-09-13, FOUR NOW — `docs/decisions/0043` §3.**
 * ===========================================================================================
 *
 * A CLOSED UNION OF LITERALS, never free text. The original two, and why there were two rather
 * than one (`0019`): *a single role lets the mapping degenerate into a constant — `if (member)
 * return EVERYTHING` — and whoever adds the second discovers the indirection was never really
 * there.*
 *
 * ```
 * owner            organization   exactly ONE per Organization.  Everything, including delete
 *                                 and transfer.
 * admin            organization   everything owner has EXCEPT delete, transfer, and acting on
 *                                 the owner.
 * business-admin   business        administers the Businesses it is assigned to.
 * member           business        ordinary user.
 * ```
 *
 * **THE GAP `0043` §1a FOUND WAS NOT "TWO ROLES AGAINST SIX". IT WAS THAT NEITHER VOCABULARY HAD
 * AN ORGANIZATION ADMINISTRATOR AT ALL** — the catalogue's `business-admin` is `scope: business`
 * and administers one Business, so the ladder went straight from *can delete the Organization* to
 * *administers one Business*, and no amount of reconciling the two vocabularies produces the tier
 * in between.
 *
 * ===========================================================================================
 * THE ADDITION IS ADDITIVE, AND THE TWO STORED SPELLINGS DO NOT CHANGE
 * ===========================================================================================
 *
 * `0043` §3a: **ALIGN THE UNBUILT VOCABULARY TO THE BUILT ONE, NEVER THE REVERSE.**
 * `organization_membership.role` holds `'owner'` and `'member'` today behind a `CHECK`; renaming
 * either costs a migration plus a data change on live rows plus an audit-history rewrite. The
 * catalogue's `business-owner` is `status: proposed` and unbuilt, so **it** is what moved.
 *
 * NO EXISTING ROW CHANGES VALUE. `0018_membership_role_admin.sql` widens the `CHECK` and touches
 * no data.
 *
 * *** AND THE ORDER OF DEPLOYMENT AND MIGRATION DOES NOT MATTER, WHICH IS A PROPERTY WORTH
 * NAMING BECAUSE IT IS EASY TO SPEND. *** `toMembershipRole` returns `null` for an unrecognised
 * stored string and `null` denies everything, so:
 *
 *   DATABASE AHEAD OF THE BUILD   a row reading `'admin'` meets a two-member union -> `null` ->
 *                                 deny all, on the same path as an absent membership.
 *   BUILD AHEAD OF THE DATABASE   nothing can write `'admin'`; the `CHECK` refuses it.
 *
 * **A PERMISSIVE DEFAULT ADDED WHILE WIDENING THIS UNION WOULD DESTROY THAT**, which is why `0043`
 * §3a states it as a requirement of the widening rather than as a happy accident.
 *
 * ===========================================================================================
 * `scope:` IN THE CATALOGUE AND `scope` ON A GRANT ARE DIFFERENT AXES — `0043` §1b
 * ===========================================================================================
 *
 * The table above says `business-admin` and `member` are `business` scope, and **every grant in
 * this file is still issued at `organization` scope, including theirs.** That is not a
 * contradiction to be resolved by picking one:
 *
 *   a permission's `scopes:`   the width a grant may be held at. `holdsAtOrAbove` reads it.
 *   a role entry's `scope:`    **has no consumer anywhere.**
 *
 * The narrowing that actually applies to a business-scoped role is the AUTHORIZED BUSINESS SET,
 * computed per request (`0020`). `0043` §1b records this precisely because *"the reconciliation
 * will otherwise 'fix' Core to match a field no code reads"* — and doing so would break
 * `assertRoleMappingIsCoherent`'s organization-scope invariant for a field nothing consults.
 */
export type MembershipRole = 'owner' | 'admin' | 'business-admin' | 'member';

/** The runtime value set, for validating a stored string on read. */
export const MEMBERSHIP_ROLES: readonly MembershipRole[] = Object.freeze([
  'owner',
  'admin',
  'business-admin',
  'member',
]);

/**
 * Collapses a stored value to a role this build understands, or to `null`.
 *
 * `null` IS RETURNED FOR BOTH "ABSENT" AND "UNRECOGNISED", and merging them is the decision
 * rather than a shortcut: both deny everything, so a caller that could tell them apart would hold
 * a distinction with no legitimate use and one illegitimate one.
 */
export function toMembershipRole(value: string | null | undefined): MembershipRole | null {
  if (value === null || value === undefined) {
    return null;
  }
  return MEMBERSHIP_ROLES.find((role) => role === value) ?? null;
}

/**
 * Every permission the Customer Directory declares, at the scope its manifest declares.
 *
 * NAMED INDIVIDUALLY SO THE ROLE TABLES BELOW READ AS SETS OF NAMES rather than as strings, which
 * is what makes a missing or misspelled entry a load-time error instead of a silent denial.
 *
 * ALL AT `organization` SCOPE, matching `packages/contracts/apps/customers/manifest.json`. The
 * scope on a grant is the WIDTH the principal holds it at, and `holdsAtOrAbove` requires it to
 * reach the Action's scope — so granting at a narrower scope than the manifest declares would
 * produce an Action that is registered, installed, and permanently refused.
 */
const CUSTOMER_CREATE = 'customers.customer.create';
const CUSTOMER_READ = 'customers.customer.read';
const CUSTOMER_LIST = 'customers.customer.list';
const CUSTOMER_UPDATE = 'customers.customer.update';
const CUSTOMER_ARCHIVE = 'customers.customer.archive';
const CUSTOMER_RESTORE = 'customers.customer.restore';
const CUSTOMER_MOVE = 'customers.customer.move';

/**
 * ===========================================================================================
 * THE FIRST NON-APP PERMISSION IN THIS TABLE. `docs/decisions/0023` decision 3.
 * ===========================================================================================
 *
 * `core.business.read` is Core's, not the Customer Directory's, and it is already registered in
 * `packages/contracts/registries/permission-catalog.yaml` — this contract was the first to use a
 * permission the catalog already declared, which is what the catalog is for.
 *
 * BOTH ROLES HOLD IT, AND IT IS JUSTIFIED ON ITS MERITS RATHER THAN AS A WORKAROUND: it is a
 * read, `maxRowWrites: 0`, and **a principal who cannot list its own Businesses cannot use the
 * product** — every create form, every row label and every Business filter needs it. Withholding
 * it from `member` would leave a read-only user unable to see the name of the Business whose
 * customers they are reading.
 *
 * GRANTED AT `organization` SCOPE, WHICH REACHES THE `business`-SCOPED ACTIONS. `implies()` ranks
 * organization wider than business, so an organization-scope grant satisfies a business-scope
 * Action; the narrowing that actually applies is the authorized business set, computed per
 * request by `0020`. This also keeps `assertRoleMappingIsCoherent`'s organization-scope invariant
 * intact rather than carving an exception into it.
 *
 * ===========================================================================================
 * AND IT IS THE THIRD DEADLOCK OF ONE SHAPE, WHICH `0023` RECORDS AS DEBT WITH A TRIGGER.
 * ===========================================================================================
 *
 * `0019`, `0021` and `0023` each ran into the same wall: build a capability, and every caller is
 * refused because no role grants its permission. **Two role vocabularies exist** — the permission
 * catalog's six seed roles (`business-owner`, `business-admin`, `member`, `developer`,
 * `platform-admin`, `marketplace-moderator`) against `0019`'s two — and they are not the same
 * `member`. `0023` requires them reconciled **before a second App exists**, because that is the
 * point at which "add it to both roles" stops being a small change and becomes a fork.
 *
 * THIS EDIT IS A PRIVILEGE CHANGE AND `0007` RULE 9 WANTS IT AUDITED. There is still no audited
 * path for a role or permission change — the same gap `0018` and `0019` recorded for operator SQL
 * and for role edits. Recorded again here rather than solved.
 */
const BUSINESS_READ = 'core.business.read';

/**
 * DELIBERATELY GRANTED TO NOBODY, and their absence is the point rather than an oversight.
 *
 * `customers.customer.delete` starts a permanent, 30-day-recoverable erasure and
 * `customers.customer.restore-deleted` cancels one. Both are outside the MVP scope `0019` names,
 * both are in the App's manifest so the App may still request them, and neither is in any role —
 * so the authorizer's step 3 refuses them for every principal on the platform. That is the App
 * ceiling and the principal floor doing exactly what `authorizer.ts` says they do: a declared
 * permission nobody holds is a permission nobody can exercise.
 *
 * They are named here rather than omitted silently so that "why can nobody delete a customer" has
 * an answer in the file where the decision lives.
 */
const NOT_GRANTED_TO_ANY_ROLE: readonly string[] = Object.freeze([
  'customers.customer.delete',
  'customers.customer.restore-deleted',
]);

function organizationGrant(permissionId: string): PermissionGrant {
  return Object.freeze({ permissionId, scope: 'organization' as const });
}

/**
 * `owner` — the full Customer Directory Action set in MVP scope.
 *
 * Seven permissions. It is NOT "everything the manifest declares": see `NOT_GRANTED_TO_ANY_ROLE`.
 */
const OWNER_PERMISSIONS: readonly string[] = Object.freeze([
  CUSTOMER_CREATE,
  CUSTOMER_READ,
  CUSTOMER_LIST,
  CUSTOMER_UPDATE,
  CUSTOMER_ARCHIVE,
  CUSTOMER_RESTORE,
  CUSTOMER_MOVE,
  BUSINESS_READ,
]);

/**
 * `member` — the read-only subset.
 *
 * READ AND LIST AND NOTHING ELSE. Not archive, which is a mutation however reversible; not move,
 * which changes which Business a record belongs to and is therefore a change of scope as well as
 * of data.
 */
const MEMBER_PERMISSIONS: readonly string[] = Object.freeze([
  CUSTOMER_READ,
  CUSTOMER_LIST,
  // A read-only user still has to see the name of the Business whose customers it is reading.
  BUSINESS_READ,
]);

/**
 * ===========================================================================================
 * `admin` — AND IT GRANTS EXACTLY WHAT `owner` GRANTS TODAY, WHICH IS A DERIVATION RATHER THAN
 * A CHOICE. `docs/decisions/0043` §3.
 * ===========================================================================================
 *
 * `0043` §3: *"admin — everything owner has EXCEPT delete, transfer, and acting on the owner."*
 *
 * **NONE OF THOSE THREE IS IN `OWNER_PERMISSIONS`.** `core.organization.delete` and
 * `core.organization.transfer-ownership` are catalogue entries no role in this file holds, and
 * owner-immunity is a property of a TARGET that no permission expresses (§3d). So the two sets are
 * identical **today**, and the difference appears as the Milestone 2 permissions are granted —
 * which is when this constant stops being `OWNER_PERMISSIONS` and starts being a list.
 *
 * *** IT IS SPELLED AS ITS OWN CONSTANT RATHER THAN AS `owner: ADMIN_PERMISSIONS`, EVEN THOUGH
 * THE VALUE IS THE SAME. *** Sharing the array would make the two roles diverge by SOMEBODY
 * SPLITTING A CONSTANT, at the moment they are already busy adding a permission — and the split
 * is the security-relevant act. Two names now means the day `owner` gains
 * `core.organization.delete`, the edit is one line in one list and `admin` is untouched by
 * construction.
 *
 * **NOTHING HOLDS THIS ROLE AND NOTHING CAN**, until `0018_membership_role_admin.sql` is applied —
 * which is the user's action, every time (`security.md` §7).
 */
const ADMIN_PERMISSIONS: readonly string[] = Object.freeze([
  CUSTOMER_CREATE,
  CUSTOMER_READ,
  CUSTOMER_LIST,
  CUSTOMER_UPDATE,
  CUSTOMER_ARCHIVE,
  CUSTOMER_RESTORE,
  CUSTOMER_MOVE,
  BUSINESS_READ,
]);

/**
 * `business-admin` — the full record set for the Businesses it is assigned to, **without `move`.**
 *
 * `customers.customer.move` CHANGES WHICH BUSINESS A RECORD BELONGS TO, and the Customer Directory
 * contract evaluates it at `organization` scope for exactly that reason: *"a move spans two
 * Businesses and a business-scope grant is authority over one"* (`scope.ts`). `0019` excluded it
 * from `member` on the narrower version of the same argument.
 *
 * **THE NARROWING TO ITS ASSIGNED BUSINESSES IS NOT DONE BY THIS LIST AND CANNOT BE.** The grant
 * is issued at `organization` scope like every other grant here; what confines it is the
 * authorized business set computed per request (`0020`). See `MembershipRole`'s header on why the
 * catalogue's `scope: business` is a different axis from a grant's scope.
 *
 * *** SO A `business-admin` WITH AN AUTHORIZED BUSINESS SET OF EVERY BUSINESS IS AN
 * ORGANIZATION-WIDE ADMINISTRATOR OF RECORDS. *** That is a property of `0020`'s computation and
 * not of this file, it is true today for any principal whose `businessScope` resolves to
 * `'organization'`, and it is named here because a reader of this list would otherwise conclude
 * the confinement lives in the permission set.
 */
const BUSINESS_ADMIN_PERMISSIONS: readonly string[] = Object.freeze([
  CUSTOMER_CREATE,
  CUSTOMER_READ,
  CUSTOMER_LIST,
  CUSTOMER_UPDATE,
  CUSTOMER_ARCHIVE,
  CUSTOMER_RESTORE,
  BUSINESS_READ,
]);

/**
 * ===========================================================================================
 * *** EVERY PERMISSION ANY TENANT ROLE GRANTS. THE WIDENING ABOVE INTRODUCED NONE. ***
 * ===========================================================================================
 *
 * Two roles became four on 2026-09-13 and **the set of permission identifiers granted to at least
 * one role did not change.** That is the property that makes the widening safe to ship without the
 * user having granted anything — `security.md` §8: no agent may approve a permission — and it is
 * asserted below in BOTH directions rather than claimed here.
 *
 * **A PROSE CLAIM WOULD HAVE BEEN THE WRONG INSTRUMENT.** `workflow.md`'s standing user ruling is
 * to derive counts and enforce equality rather than restate a figure, and the same reasoning
 * applies to a set: *"the sets are unchanged"* is a sentence that was true when it was typed and
 * that nothing re-checks. This constant is the thing that goes red.
 *
 * **ADDING A MILESTONE 2 PERMISSION TO A ROLE THEREFORE TAKES TWO EDITS**, and the second is here,
 * where the register is named: `permission-catalog.yaml` is what decides (`0007` rule 4), and
 * `0007` rule 9 requires the change audited — a gap `0043` §7 records as now LIVE rather than as
 * debt, because this milestone makes role assignment a product feature.
 *
 * *** WHAT DOES **NOT** DECIDE IT: THE CATALOGUE'S `status:` FIELD. CORRECTED 2026-09-13. ***
 * An earlier version of this comment said *"every Milestone 2 entry is still `status: proposed`"*
 * as though that were the gate. **Measured: `core.business.read` and `customers.customer.read` are
 * BOTH `status: proposed` and BOTH granted by this file today.** So `proposed` is a lifecycle
 * marker on a catalogue entry and **not a statement about whether a permission may be granted** —
 * reading it as one would have blocked work that is already shipped, and citing it as the reason
 * would have been a real observation generalised one step too far.
 *
 * **THE ACTUAL GATE IS `security.md` §8: the USER grants and the Team Lead relays.** The worked
 * precedent is `platform-permissions.ts`, whose four Template permissions were transcribed only
 * after *"GRANTED BY THE USER on 2026-09-11 and relayed by the Team Lead, who does not approve."*
 * A grant recorded in this file needs that sentence and a date, or it is an agent approving a
 * permission.
 */
const TENANT_GRANTED_PERMISSIONS: readonly string[] = Object.freeze([
  CUSTOMER_CREATE,
  CUSTOMER_READ,
  CUSTOMER_LIST,
  CUSTOMER_UPDATE,
  CUSTOMER_ARCHIVE,
  CUSTOMER_RESTORE,
  CUSTOMER_MOVE,
  BUSINESS_READ,
]);

const GRANTS_BY_ROLE: Readonly<Record<MembershipRole, PrincipalGrants>> = Object.freeze({
  owner: Object.freeze({ grants: Object.freeze(OWNER_PERMISSIONS.map(organizationGrant)) }),
  admin: Object.freeze({ grants: Object.freeze(ADMIN_PERMISSIONS.map(organizationGrant)) }),
  'business-admin': Object.freeze({
    grants: Object.freeze(BUSINESS_ADMIN_PERMISSIONS.map(organizationGrant)),
  }),
  member: Object.freeze({ grants: Object.freeze(MEMBER_PERMISSIONS.map(organizationGrant)) }),
});

/** What a principal holding no recognised role gets. Empty, and there is no sentinel for "all". */
const NO_GRANTS: PrincipalGrants = Object.freeze({ grants: Object.freeze([]) });

/**
 * The mapping. THE ONLY PLACE A ROLE NAME IS TURNED INTO PERMISSIONS.
 *
 * `AUTHORIZATION_STANDARD.md` §9: *"A role name appearing in a conditional in source is a defect.
 * Code checks permissions."* That rule is preserved rather than broken by this file — the role
 * name appears HERE, once, in a lookup, and nowhere downstream. `PrincipalGrants` reaches the
 * authorizer as a set of permissions with no memory of which role produced it, and there is no
 * function anywhere in `platform/core/authorization/**` that can be asked what role a principal
 * holds.
 */
export function grantsForRole(role: MembershipRole | null): PrincipalGrants {
  return role === null ? NO_GRANTS : GRANTS_BY_ROLE[role];
}

export class RoleMappingIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleMappingIncoherentError';
  }
}

/**
 * Runs at module load, like `assertRegistryIsCoherent` and for the same reason: a permission set
 * that had drifted — a wildcard added, a role left empty, a permission granted that `0019`
 * excludes — would do it silently and would be discovered as a privilege nobody meant to give.
 *
 * WHAT IT CAN CHECK AND WHAT IT CANNOT. It checks that every role is mapped, that no set is
 * empty, that no identifier contains a wildcard character, that every grant is at `organization`
 * scope, and that neither excluded permission appears. It cannot check that the SET IS THE RIGHT
 * ONE — that is `0019`'s judgement, not a computable property — so it makes changing one a
 * deliberate act that also has to edit this assertion.
 *
 * ===========================================================================================
 * THE PARAMETERS EXIST SO THE FIVE THROW BRANCHES CAN BE REACHED FROM A TEST, AND THEY DEFAULT
 * TO THE SHIPPED VALUES SO EVERY EXISTING CALL IS UNCHANGED.
 * ===========================================================================================
 *
 * Same change, same reason, as `protection/write-admission.ts::assertAllocationsAreCoherent`:
 * this read module-level `const` bindings that ESM will not let a test rebind, so its branches
 * were unreachable without editing `platform/core/**`, which `qa-agent` correctly will not do.
 *
 * WHAT WAS ALREADY COVERED AND WHAT WAS NOT, because the distinction is narrow and is the whole
 * value of the change. A suite can already assert each property separately against the shipped
 * mapping, so a drift goes red. What it could NOT assert is **that this guard would throw rather
 * than silently compare the wrong values** — a coherence check that is itself unchecked is a
 * guard nobody has watched fail.
 *
 * TWO PARAMETERS RATHER THAN ONE, AND THE SECOND IS NOT PADDING. The mapping alone reaches four
 * branches — unmapped role, empty set, wildcard, wrong scope, excluded permission. The fifth,
 * "an absent or unrecognised role grants something", reads `grantsForRole(null)`, which is a
 * module constant and is exactly as unrebindable as the ones this change exists to escape. A
 * parameter that left one branch unreachable would have reproduced the original defect in a
 * smaller form.
 *
 * IT STILL ITERATES `MEMBERSHIP_ROLES` RATHER THAN THE SUPPLIED MAPPING'S OWN KEYS. That is
 * deliberate: the question this guard answers is "is every role in the closed union mapped", and
 * iterating the mapping would make a MISSING role unreachable — the loop would simply not visit
 * it, and the `undefined` branch would become dead code that looks live.
 *
 * WORTH ASSERTING THE ERROR TYPE, not merely that something threw. `qa-agent` made this point
 * against the allocation guard and it applies identically here: "it threw something" passes on a
 * `TypeError` from a typo in the assertion itself, which is the failure mode being tested for.
 */
export function assertRoleMappingIsCoherent(
  mapping: Readonly<Record<MembershipRole, PrincipalGrants>> = GRANTS_BY_ROLE,
  noRoleGrants: PrincipalGrants = grantsForRole(null),
): void {
  for (const role of MEMBERSHIP_ROLES) {
    const mapped = mapping[role];
    if (mapped === undefined || mapped.grants.length === 0) {
      throw new RoleMappingIncoherentError(
        `The role '${role}' maps to no permissions. A role that grants nothing is ` +
          'indistinguishable from an absent one and should be removed rather than left as a ' +
          'value a membership row can hold.',
      );
    }
    for (const grant of mapped.grants) {
      if (grant.permissionId.includes('*') || grant.permissionId.trim() === '') {
        throw new RoleMappingIncoherentError(
          `The role '${role}' grants '${grant.permissionId}', which is a wildcard or blank. ` +
            'docs/decisions/0007 rule 3 forbids wildcards and rule 4 requires explicit ' +
            'registration; a role is exactly where a wildcard would otherwise be reintroduced, ' +
            'and it would silently grant every permission any future App registers under the ' +
            'same prefix.',
        );
      }
      if (grant.scope !== 'organization') {
        throw new RoleMappingIncoherentError(
          `The role '${role}' grants '${grant.permissionId}' at scope '${grant.scope}'. The ` +
            'Customer Directory manifest declares every permission at organization scope, and a ' +
            'grant narrower than the Action it must satisfy produces a permanently refused ' +
            'Action that looks correctly wired.',
        );
      }
      if (NOT_GRANTED_TO_ANY_ROLE.includes(grant.permissionId)) {
        throw new RoleMappingIncoherentError(
          `The role '${role}' grants '${grant.permissionId}', which docs/decisions/0019 places ` +
            'outside MVP scope and grants to nobody. Permanent deletion and its cancellation are ' +
            'not part of this slice; adding them needs a decision, not an edit.',
        );
      }
    }
  }
  if (noRoleGrants.grants.length !== 0) {
    throw new RoleMappingIncoherentError(
      'An absent or unrecognised role grants something. docs/decisions/0019 requires it to deny ' +
        'everything, on the same path as an absent membership.',
    );
  }
}

/**
 * ===========================================================================================
 * *** NO PERMISSION IS GRANTED TO A TENANT ROLE THAT `TENANT_GRANTED_PERMISSIONS` DOES NOT
 * DECLARE, AND NONE IS DECLARED THAT NOTHING HOLDS. ***
 * ===========================================================================================
 *
 * BOTH DIRECTIONS ARE LOAD-BEARING AND THEY CATCH DIFFERENT THINGS. A permission **granted and
 * not declared** is a privilege that entered the platform without the edit that names the
 * register. One **declared and granted to nobody** is a stale line that makes the first check
 * weaker every time it is added to, because the declared set stops describing what is actually
 * held.
 *
 * `workflow.md` §11a's test for whether two checks are one: name an input each goes red on that
 * the other passes. Adding `core.user.list` to `ADMIN_PERMISSIONS` alone fires the first and not
 * the second; deleting a role's list fires the second and not the first.
 *
 * ===========================================================================================
 * *** IT IS A SEPARATE FUNCTION FROM `assertRoleMappingIsCoherent`, AND IT WAS INSIDE IT UNTIL
 * A QA CASE PROVED THAT WAS WRONG. ***
 * ===========================================================================================
 *
 * That guard's parameters exist so a test can drive its branches with **a different but coherent
 * mapping**. This property is not a property of *a* mapping — it is a property of **the shipped
 * one**, checked against a constant that names the register. Leaving it inside meant a legitimate
 * alternative mapping was **rejected for granting a smaller set**, and the message named
 * `TENANT_GRANTED_PERMISSIONS` — **a red pointing at an artifact that was not wrong.**
 *
 * `workflow.md` §11a: *a suite that goes red under load teaches a team to ignore red*, and a
 * check that fires on a correct input is the fastest route there. **The shape properties (every
 * role mapped, no wildcard, right scope, nothing excluded) hold of ANY mapping. This policy
 * property holds of THIS one.** Two questions, two functions, and the parameter list of each now
 * says which it is.
 */
export function assertGrantedUniverseIsDeclared(
  mapping: Readonly<Record<MembershipRole, PrincipalGrants>> = GRANTS_BY_ROLE,
  grantedUniverse: readonly string[] = TENANT_GRANTED_PERMISSIONS,
): void {
  const granted = new Set<string>();
  for (const role of MEMBERSHIP_ROLES) {
    for (const grant of mapping[role].grants) {
      granted.add(grant.permissionId);
    }
  }
  for (const permissionId of granted) {
    if (!grantedUniverse.includes(permissionId)) {
      throw new RoleMappingIncoherentError(
        `'${permissionId}' is granted to a tenant role and is not in ` +
          'TENANT_GRANTED_PERMISSIONS. Granting a permission is a privilege change: ' +
          'permission-catalog.yaml is the register (docs/decisions/0007 rule 4), every Milestone ' +
          '2 entry in it is still `status: proposed`, and no agent may approve a permission ' +
          '(.claude/rules/security.md §8). If the user has granted it, add it to that list in ' +
          'the same change and record who granted it and when.',
      );
    }
  }
  for (const permissionId of grantedUniverse) {
    if (!granted.has(permissionId)) {
      throw new RoleMappingIncoherentError(
        `'${permissionId}' is in TENANT_GRANTED_PERMISSIONS and is granted to no role. A ` +
          'declared-but-unheld entry makes the check above weaker: the declared set stops ' +
          'describing what is actually held, so the next real widening has more room to hide in. ' +
          'Remove it, or grant it — and see NOT_GRANTED_TO_ANY_ROLE for the deliberate case, ' +
          'which is a different list for a different reason.',
      );
    }
  }
}

/**
 * ===========================================================================================
 * *** NO TENANT ROLE MAY HOLD A `critical` PERMISSION THAT HAS NOT BEEN DELIBERATELY CLEARED.
 * THIS IS `0038`'s DEFERRAL TRIGGER, STATED AS THE EVENT RATHER THAN AS A PROXY FOR IT. ***
 * ===========================================================================================
 *
 * `0038` defers the Action-class challenge route, on a population measured at zero: no Action-class
 * `critical` operation is reachable by any principal alive. **The trigger for reopening it is
 * exactly *"the first `critical` Action-class operation that any role can hold"*, and this is the
 * only assertion in the repository that can see that event.**
 *
 * *** IT REPLACES A SAFETY NET THAT DID NOT EXIST. *** The ruling first named
 * `assertGatedRoutesCanObtainAConfirmation`, which iterates the TENANT-ADMIN route table and cannot
 * see an Action; `assertConfirmationCoverageIsCoherent` iterates the PLATFORM one. **Nothing checked
 * the Action registries at registration time**, and the only Action-side confirmation code is
 * `action/pipeline.ts`'s runtime gate — so the trigger would have fired as *every call to that
 * operation failing in production*, with no build ever going red.
 *
 * ===========================================================================================
 * WHY IT KEYS ON THE GRANT RATHER THAN ON WHETHER A PERMISSION IS "ACTION-CLASS"
 * ===========================================================================================
 *
 * **CLASSIFYING A PERMISSION AS ACTION-CLASS IS THE PART THAT WOULD GO WRONG.** A namespace
 * heuristic — *`core.*` is a route, anything else is an App* — is a guess that is correct today and
 * silently wrong the first time a Core Action carries a `critical` permission or an App declares a
 * route. **So this asks a question it can actually answer: is this critical permission one somebody
 * deliberately decided a tenant role may hold?**
 *
 * `architecture.md` §3a-i, keyed on the exception: **the allow-list is the exception and everything
 * else is refused by default**, including a permission nobody has classified. A new `critical`
 * permission reaching a role fails the build whether it gates an Action, a route, or something
 * nobody has invented — and a human then decides which, which is the decision `0038` wants made.
 *
 * **THE LIST IS EMPTY AND THAT IS THE MEASURED STATE**, not an omission: 21 of 21 tenant-admin
 * permissions are granted by no role, and no role holds a `critical` permission of any kind. **So
 * this check examines every grant and finds nothing, which is why it returns its population** — a
 * count of zero critical grants and a check that stopped working render identically otherwise
 * (`workflow.md` §11a).
 */
const CRITICAL_PERMISSIONS_A_TENANT_ROLE_MAY_HOLD: readonly string[] = Object.freeze([]);

export function assertNoRoleHoldsAnUnclearedCriticalPermission(
  mapping: Readonly<Record<MembershipRole, PrincipalGrants>> = GRANTS_BY_ROLE,
  critical: readonly string[] = criticalPermissions(),
  cleared: readonly string[] = CRITICAL_PERMISSIONS_A_TENANT_ROLE_MAY_HOLD,
): { readonly grantsExamined: number; readonly criticalHeld: number } {
  let grantsExamined = 0;
  let criticalHeld = 0;
  for (const role of MEMBERSHIP_ROLES) {
    for (const grant of mapping[role].grants) {
      grantsExamined += 1;
      if (!critical.includes(grant.permissionId)) {
        continue;
      }
      criticalHeld += 1;
      if (cleared.includes(grant.permissionId)) {
        continue;
      }
      throw new RoleMappingIncoherentError(
        `The tenant role '${role}' holds '${grant.permissionId}', which is a 'critical' ` +
          'permission that has not been cleared for tenant roles. Two things follow and BOTH need ' +
          'a decision before this list grows. (1) A critical permission requires a confirmation ' +
          'on every call, so whatever it gates is now reachable and must have a challenge route ' +
          'that can issue one — if it gates an ACTION, there is no such route: ' +
          'docs/decisions/0038 defers it on the measured ground that no role could hold one, and ' +
          'this grant is that deferral\'s trigger. Reopen it rather than adding the permission ' +
          'here. (2) Granting a permission is a privilege change and needs the user ' +
          '(.claude/rules/security.md §8). Add it to ' +
          'CRITICAL_PERMISSIONS_A_TENANT_ROLE_MAY_HOLD only once a challenge route exists for it, ' +
          'and record who granted it and when.',
      );
    }
  }
  // =========================================================================================
  // *** THE FLOORS. WITHOUT THESE, A RENAMED OR BROKEN REGISTRY MAKES THIS GREEN FOREVER. ***
  // =========================================================================================
  //
  // **This check's verdict is `no grant matched the critical set`, and that sentence is true both
  // when nothing is wrong and when THE CRITICAL SET IS EMPTY.** `workflow.md` §11a's empty-list
  // reader, on the assertion that is `0038`'s only trigger — so it is refused rather than reported.
  //
  // *** THE SET'S SHAPE IS CHECKED ELSEWHERE AND ITS EMPTINESS WAS NOT — MEASURED, NOT ASSUMED. ***
  // `assertCriticalSetIsCoherent` rejects blanks, wildcards, duplicates, disorder and one specific
  // misclassification, **and every one of those is a loop body or an `includes`, so all of them
  // pass on an empty list.** `qa-agent` does floor it — `suites/platform-operator/confirmation.ts`
  // asserts `criticalPermissions().length > 0` — **but that runs in a suite and this runs at module
  // load**, so between a broken registry and the next suite run the build is green and this check
  // is examining nothing.
  //
  // **THE COUNT IS DELIBERATELY NOT PINNED HERE.** `registry-coherence.ts` compares Core's critical
  // set against `permission-catalog.yaml`, which is the register (`0007` rule 4) — **that is the
  // layer that owns the number, and a second copy in this file is the duplicated count the user
  // ruled against.** This floor asserts only that the population is not zero.
  if (critical.length === 0) {
    throw new RoleMappingIncoherentError(
      'The critical permission set is EMPTY, so this check compared every grant against nothing ' +
        'and passed. That is not a state any correct tree reaches: `critical-permissions.ts` ' +
        'declares a non-empty frozen list, and an empty one means it has been renamed, emptied or ' +
        'failed to load. Refused rather than reported, because this assertion is the only trigger ' +
        "for `0038`'s deferral of the Action-class challenge route, and a silent zero here is that " +
        'deferral quietly losing its collector.',
    );
  }
  if (grantsExamined === 0) {
    throw new RoleMappingIncoherentError(
      'No role grants any permission, so this check examined nothing. Every tenant role is ' +
        'defined in this file with a non-empty grant list, so zero means the mapping has been ' +
        'emptied or is not being read — and a check handed nothing reports success, which is the ' +
        'most confident wrong answer available.',
    );
  }
  return { grantsExamined, criticalHeld };
}

assertRoleMappingIsCoherent();
assertGrantedUniverseIsDeclared();
assertNoRoleHoldsAnUnclearedCriticalPermission();
