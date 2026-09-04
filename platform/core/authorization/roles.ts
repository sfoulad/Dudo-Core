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

/**
 * The two roles of the closed beta. A CLOSED UNION OF LITERALS, never free text.
 *
 * TWO RATHER THAN ONE, DELIBERATELY (`0019`). A single role lets the mapping degenerate into a
 * constant — `if (member) return EVERYTHING` — and whoever adds the second discovers the
 * indirection was never really there. Two forces the lookup to exist and to be exercised.
 */
export type MembershipRole = 'owner' | 'member';

/** The runtime value set, for validating a stored string on read. */
export const MEMBERSHIP_ROLES: readonly MembershipRole[] = Object.freeze(['owner', 'member']);

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
]);

/**
 * `member` — the read-only subset.
 *
 * READ AND LIST AND NOTHING ELSE. Not archive, which is a mutation however reversible; not move,
 * which changes which Business a record belongs to and is therefore a change of scope as well as
 * of data.
 */
const MEMBER_PERMISSIONS: readonly string[] = Object.freeze([CUSTOMER_READ, CUSTOMER_LIST]);

const GRANTS_BY_ROLE: Readonly<Record<MembershipRole, PrincipalGrants>> = Object.freeze({
  owner: Object.freeze({ grants: Object.freeze(OWNER_PERMISSIONS.map(organizationGrant)) }),
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

assertRoleMappingIsCoherent();
