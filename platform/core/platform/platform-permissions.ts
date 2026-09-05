/**
 * ===========================================================================================
 * PLATFORM AUTHORITY: THE ROLE MAPPING AND CORE'S OWN PLATFORM PERMISSION ENVELOPE.
 * `docs/decisions/0025` decisions 1 and 3 · `docs/decisions/0024` invariant 2 ·
 * `docs/decisions/0023`'s envelope precedent · contract `platform-operator-v1`, P3.
 * ===========================================================================================
 *
 * This file is `authorization/roles.ts` one tier up, and EVERY RULE IN THAT FILE APPLIES HERE
 * UNCHANGED: frozen arrays of literal permission identifiers, no pattern, no prefix, no
 * `startsWith`, no glob, and no code path that derives a permission id from anything other than
 * these literals. A role is exactly the construct that tempts `0007` rule 3 to be relaxed, and it
 * is more tempting here than there — `platform-admin: ['core.*']` would be shorter, would read as
 * obviously correct, and would grant every Core permission any future contract registers.
 *
 * ===========================================================================================
 * IT IS A **SEPARATE** MAPPING FROM `authorization/roles.ts`, AND THE SEPARATION IS THE POINT
 * ===========================================================================================
 *
 * NOT AN EXTENSION OF IT. `MembershipRole` must never gain a platform-tier value (`0024`
 * invariant 2), so the two mappings cannot share a union, a table or a function. A single mapping
 * with a platform branch is ONE EDIT AWAY from being reachable from a membership row — and a
 * membership row carrying platform authority is the trap `0024` exists to record:
 *
 *   `scope.ts` ranks `platform` at 0, so `implies('platform', X)` is true for EVERY X. Such a
 *   principal passes authorization for every Action at every scope, and the storage boundary then
 *   POLITELY SCOPES IT INTO THAT ORGANIZATION AND SERVES THE ROWS. Repeat per Organization and
 *   you have cross-tenant access assembled entirely out of legitimate parts. No review catches
 *   it, because there is nothing wrong to see.
 *
 * `assertPlatformPermissionModelIsCoherent` therefore asserts, at module load, that the two role
 * unions are DISJOINT. `0024` names `assertRoleMappingIsCoherent` as the natural home for that
 * check; it is here instead, deliberately, because putting it in `authorization/roles.ts` would
 * make that module import this one and produce a runtime import cycle between the two mappings
 * the whole design is trying to keep apart. The direction of the dependency is one-way on
 * purpose: this file knows about `MembershipRole`, and `MembershipRole` knows nothing about
 * platform authority.
 *
 * ===========================================================================================
 * THE ENVELOPE IS A CEILING AND NOT A GRANT — restated because `0023`'s reviewers needed it
 * ===========================================================================================
 *
 * `authorize()` resolves against the envelope as the CEILING and the principal's grant as the
 * FLOOR. Declaring the six permissions below grants them to NOBODY. The floor is the
 * `platform_operator` row.
 *
 * NO APP MAY DECLARE A PLATFORM PERMISSION. `app-manifest.schema.json` already enforces this
 * structurally through `$defs/appRequestableScope`, and that enforcement must not be relaxed to
 * accommodate anything in this class. `0023` rejected letting the Customer Directory declare
 * `core.business.read` on the ground that "an App's manifest would gate a Core capability"; the
 * same argument at platform scope is not merely untidy, it is an ESCALATION — an App that could
 * declare a platform permission could request it at install, and a tenant administrator clicking
 * through a consent screen would be granting authority over every OTHER tenant on the platform.
 */

import type { AppPermissionEnvelope, PermissionGrant, PrincipalGrants } from '../authorization/authorizer.ts';
import type { Scope } from '../authorization/scope.ts';
import { MEMBERSHIP_ROLES } from '../authorization/roles.ts';

/**
 * Every permission in this file is held, declared and evaluated at exactly this scope.
 *
 * `platform` is the only scope that spans Organizations, and `permission-catalog.yaml`'s note on
 * it is the line that makes this whole surface buildable before AZ3: a platform-scope role
 * NEVER reaches tenant business data. `scope.ts` does not give it a path to one — the tenant
 * predicate is applied by the storage boundary from the AUTHENTICATED Organization, and a
 * platform operator has none, because it has no membership.
 */
const PLATFORM_SCOPE: Scope = 'platform';

/**
 * The closed union, mirroring `permission-catalog.yaml`'s two platform-scope seed roles.
 *
 * TWO RATHER THAN ONE, for the reason `MembershipRole` is two (`0019`): a single role lets the
 * mapping degenerate into a constant — `if (operator) return EVERYTHING` — and whoever adds the
 * second discovers the indirection was never really there.
 */
export type PlatformRole = 'platform-admin' | 'marketplace-moderator';

/** The runtime value set, for validating a stored string on read. */
export const PLATFORM_ROLES: readonly PlatformRole[] = Object.freeze([
  'platform-admin',
  'marketplace-moderator',
]);

/**
 * Collapses a stored value to a role this build understands, or to `null`.
 *
 * `null` IS RETURNED FOR BOTH "ABSENT" AND "UNRECOGNISED", and it DENIES EVERYTHING on the same
 * path as an absent row. That is the device `roles.ts::toMembershipRole` and
 * `credential-verifier.ts` both already use: a value a FUTURE migration introduces must fail onto
 * the SAFE path rather than onto an error path, so a build older than its data denies rather than
 * breaking, and so the distinction is not measurable from outside.
 *
 * The contract requires exactly this: "An unrecognised stored value collapses to null and DENIES
 * EVERYTHING, on the same path as an absent row."
 */
export function toPlatformRole(value: string | null | undefined): PlatformRole | null {
  if (value === null || value === undefined) {
    return null;
  }
  return PLATFORM_ROLES.find((role) => role === value) ?? null;
}

// =============================================================================================
// The six permissions that back a platform ROUTE. Named individually so the tables below read as
// sets of names rather than as strings — which is what makes a misspelling a load-time error
// instead of a silent denial.
// =============================================================================================

const ORGANIZATION_LIST = 'core.organization.list';
const ORGANIZATION_CREATE = 'core.organization.create';
const TEMPLATE_READ = 'core.template.read';
const TEMPLATE_LIST = 'core.template.list';
const TEMPLATE_CREATE = 'core.template.create';
const CREDENTIAL_RESET = 'core.credential.reset';

/**
 * `core.organization.list`, exported because the two routes in this slice declare it.
 *
 * IT IS NOT `core.organization.read`, WHICH IS DECLARED `[organization]` AND STAYS THERE. Two
 * permissions rather than one widened one: widening a tenant-scoped permission above the tenant
 * boundary is the escalation AZ8 exists to record, and `permission-catalog.yaml` says so at the
 * declaration itself.
 */
export const PLATFORM_ORGANIZATION_LIST_PERMISSION = ORGANIZATION_LIST;

/**
 * ===========================================================================================
 * CORE'S PLATFORM PERMISSION ENVELOPE. SIX PERMISSIONS AND NOTHING ELSE.
 * ===========================================================================================
 *
 * The membership of this class across all four platform contracts is SIX: `organizations.list`,
 * `templates.list`, `templates.read`, `templates.create`, `organizations.create`,
 * `credentials.reset`. A SEVENTH NEEDS ITS OWN ARGUMENT — the same discipline `0021` imposed on
 * its class of two and `0023` on its block of two. That discipline is what keeps "it is a
 * platform route so it needs no tenant" from becoming a way to write an Action without a tenant
 * check.
 *
 * FOUR OF THE SIX HAVE NO ROUTE YET. `template-v1`, `organization-onboarding-v1` and
 * `credential-reset-v1` are still being written and are deliberately NOT implemented in this
 * slice. They are declared here anyway, because the envelope is the CLASS's ceiling rather than
 * this slice's, and because a ceiling that has to be widened to add a route is a ceiling somebody
 * widens without reading it.
 *
 * `appId` IS `platform`, MATCHING `worker-entry.ts`'s `NO_APP` CONVENTION, so an audit record
 * produced on this path cannot be mistaken for one attributed to an installed App. It is a Core
 * envelope that happens to reuse `AppPermissionEnvelope`'s SHAPE — the same reuse
 * `http/core-routes.ts::CORE_APP_PERMISSIONS` makes, and for the same reason: the authorizer
 * takes the envelope as a parameter, so Core declaring its own needs no change to `authorize()`
 * and introduces no second authorization function.
 */
export const PLATFORM_PERMISSION_ENVELOPE: AppPermissionEnvelope = Object.freeze({
  appId: 'platform',
  declared: Object.freeze([
    Object.freeze({ permissionId: ORGANIZATION_LIST, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: ORGANIZATION_CREATE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_READ, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_LIST, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_CREATE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: CREDENTIAL_RESET, scope: PLATFORM_SCOPE }),
  ]),
});

/**
 * Held by `platform-admin` in `permission-catalog.yaml` and REACHABLE BY NO ROUTE IN THIS CLASS.
 *
 * They are in the role because the catalog puts them there, and they are deliberately NOT in the
 * envelope, so the ceiling refuses them for every caller — the same thing
 * `roles.ts::NOT_GRANTED_TO_ANY_ROLE` does from the other side. A grant nobody can exercise and a
 * declaration nobody holds are the two halves of `authorizer.ts`, and this is the first.
 *
 * `core.principal.grant-platform-scope` is the broadest grant in the system and there is no
 * operation that performs it: `0025` publishes no route that creates a platform operator, so this
 * permission gates nothing and MUST NOT ACQUIRE A ROUTE by someone noticing it is unused.
 * `core.marketplace.moderate` has no marketplace to moderate; AZ8 records that the platform-scope
 * view of published Apps that moderation needs does not exist as a permission at all.
 */
const HELD_BUT_UNREACHABLE: readonly string[] = Object.freeze([
  'core.principal.grant-platform-scope',
  'core.marketplace.moderate',
]);

function platformGrant(permissionId: string): PermissionGrant {
  return Object.freeze({ permissionId, scope: PLATFORM_SCOPE });
}

/**
 * `platform-admin` — the eight permissions `permission-catalog.yaml` gives the role, verbatim.
 *
 * IT IS NOT TRIMMED TO THE SIX THE ENVELOPE DECLARES, and that is the same judgement `worker.ts`
 * records for `CUSTOMERS_APP_PERMISSIONS`: the ceiling and the floor are different objects, and
 * narrowing one to match the other conflates them and makes a future widening silently
 * insufficient. The two extra permissions are unreachable through the ceiling, which is
 * `authorizer.ts` working as designed rather than a gap.
 */
const PLATFORM_ADMIN_PERMISSIONS: readonly string[] = Object.freeze([
  ...HELD_BUT_UNREACHABLE,
  ORGANIZATION_CREATE,
  ORGANIZATION_LIST,
  TEMPLATE_READ,
  TEMPLATE_LIST,
  TEMPLATE_CREATE,
  CREDENTIAL_RESET,
]);

/**
 * `marketplace-moderator` — one permission, and it currently reaches nothing.
 *
 * THIS ROLE CANNOT USE THE ADMIN CONSOLE AT ALL, AND THAT IS THE CONTRACT'S STATED CHOICE RATHER
 * THAN A DEFECT HERE. `platform.session.whoami` declares `core.organization.list` rather than
 * inventing a `core.platform.whoami`, so a moderator cannot even ask what it may do. The contract
 * records the cost as PO-5 and rules that the fix is NOT to grant the moderator Organization
 * enumeration — a permission it has no business holding — but to revisit the whoami ruling when a
 * second platform role is actually held. Nobody holds this role today.
 */
const MARKETPLACE_MODERATOR_PERMISSIONS: readonly string[] = Object.freeze([
  'core.marketplace.moderate',
]);

const GRANTS_BY_PLATFORM_ROLE: Readonly<Record<PlatformRole, PrincipalGrants>> = Object.freeze({
  'platform-admin': Object.freeze({
    grants: Object.freeze(PLATFORM_ADMIN_PERMISSIONS.map(platformGrant)),
  }),
  'marketplace-moderator': Object.freeze({
    grants: Object.freeze(MARKETPLACE_MODERATOR_PERMISSIONS.map(platformGrant)),
  }),
});

/** What a principal holding no recognised platform role gets. Empty, and there is no "all". */
const NO_PLATFORM_GRANTS: PrincipalGrants = Object.freeze({ grants: Object.freeze([]) });

/**
 * The mapping. THE ONLY PLACE A PLATFORM ROLE NAME IS TURNED INTO PERMISSIONS.
 *
 * `AUTHORIZATION_STANDARD.md` §9 — *"A role name appearing in a conditional in source is a defect.
 * Code checks permissions."* — is preserved rather than broken by this file: the role name appears
 * HERE, once, in a lookup, and nowhere downstream. `PrincipalGrants` reaches the authorizer as a
 * set of permissions with no memory of which role produced it.
 *
 * THE ONE EXCEPTION IS THE AUDIT RECORD, WHICH STORES THE ROLE. That is not a conditional and
 * makes no decision — it records what authority an action was taken under, which is the question
 * an investigation asks. See `0009_platform_operator_action.sql`.
 */
export function grantsForPlatformRole(role: PlatformRole | null): PrincipalGrants {
  return role === null ? NO_PLATFORM_GRANTS : GRANTS_BY_PLATFORM_ROLE[role];
}

/**
 * The permissions a role holds that a platform route can actually evaluate: the intersection of
 * the role's grants with the envelope's ceiling.
 *
 * ===========================================================================================
 * THIS IS WHAT `whoami` RETURNS, AND THE CHOICE IS AN INTERPRETATION THE CONTRACT LEAVES OPEN.
 * ===========================================================================================
 *
 * `whoamiOutput.permissions` is described as "the effective permission list, for rendering only",
 * and there are two honest readings: everything the role holds (eight for `platform-admin`), or
 * everything the role can exercise here (six).
 *
 * THE INTERSECTION IS CHOSEN because the route's stated purpose is "so the console can render
 * only the actions this operator may take". Reporting `core.principal.grant-platform-scope` would
 * tell a console it may take an action NO ROUTE IMPLEMENTS AND NONE MAY ACQUIRE, and the console's
 * reasonable response would be to draw a button for it. Reporting the reachable set cannot mislead
 * in that direction.
 *
 * IT DISCLOSES NOTHING EITHER WAY. Both readings describe the CALLER'S OWN authority, to the
 * caller, and `0007` D8 applies to both: UI hiding is presentation, never security — every
 * permission in this list is enforced again by Core on the call itself, and a console that ignored
 * it entirely would be ugly and exactly as safe.
 *
 * REPORTED TO THE TEAM LEAD as something `platform-operator-v1` should pin down before a second
 * platform role exists.
 */
export function reachablePlatformPermissions(role: PlatformRole | null): readonly string[] {
  const held = grantsForPlatformRole(role);
  const reachable: string[] = [];
  for (const declaration of PLATFORM_PERMISSION_ENVELOPE.declared) {
    if (held.grants.some((grant) => grant.permissionId === declaration.permissionId)) {
      reachable.push(declaration.permissionId);
    }
  }
  return Object.freeze(reachable);
}

/** Six. Named so the guard below compares against a stated number rather than a bare literal. */
const PLATFORM_ROUTE_PERMISSION_COUNT = 6;

export class PlatformPermissionModelIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformPermissionModelIncoherentError';
  }
}

/**
 * Runs at module load, like `assertRoleMappingIsCoherent` and `assertRegistryIsCoherent`, and for
 * the same reason: a permission set that had drifted would do it silently and would be discovered
 * as a privilege nobody meant to give.
 *
 * THE PARAMETERS EXIST SO THE THROW BRANCHES CAN BE REACHED FROM A TEST, and they default to the
 * shipped values so every existing call is unchanged. Same change, same reason, as
 * `assertRoleMappingIsCoherent` and `assertAllocationsAreCoherent`: these read module-level
 * `const` bindings that ESM will not let a test rebind, so their branches would otherwise be
 * unreachable without editing `platform/core/**`, which `qa-agent` correctly will not do.
 *
 * WHAT IT CANNOT CHECK: that the sets are the RIGHT ones. That is `0025`'s judgement and the
 * catalog's, not a computable property — so changing one is a deliberate act that also has to
 * edit this assertion.
 */
export function assertPlatformPermissionModelIsCoherent(
  mapping: Readonly<Record<PlatformRole, PrincipalGrants>> = GRANTS_BY_PLATFORM_ROLE,
  envelope: AppPermissionEnvelope = PLATFORM_PERMISSION_ENVELOPE,
  noRoleGrants: PrincipalGrants = grantsForPlatformRole(null),
  membershipRoles: readonly string[] = MEMBERSHIP_ROLES,
  platformRoles: readonly string[] = PLATFORM_ROLES,
): void {
  // =========================================================================================
  // 1. THE TWO ROLE UNIONS ARE DISJOINT. `0024` invariant 2, mechanically.
  // =========================================================================================
  //
  // "MembershipRole never gains a platform-tier value." A shared value is how a membership row
  // comes to carry platform authority — the exact trap `0024` records — and it would arrive as a
  // one-word edit to a union in a different file, reviewed by someone who had never read this one.
  for (const platformRole of platformRoles) {
    if (membershipRoles.includes(platformRole)) {
      throw new PlatformPermissionModelIncoherentError(
        `'${platformRole}' is both a MembershipRole and a PlatformRole. docs/decisions/0024 ` +
          'invariant 2: MembershipRole must never gain a platform-tier value. scope.ts ranks ' +
          "'platform' at 0, so implies('platform', X) is true for every X — a membership row " +
          'carrying platform authority passes authorization for every Action at every scope, and ' +
          'the storage boundary then scopes that principal into the Organization and serves the ' +
          'rows. Nothing is bypassed: the membership row IS the bypass.',
      );
    }
  }

  // =========================================================================================
  // 2. THE ROLE MAPPING. The same five properties `assertRoleMappingIsCoherent` checks.
  // =========================================================================================
  for (const role of platformRoles) {
    const mapped = mapping[role as PlatformRole];
    if (mapped === undefined || mapped.grants.length === 0) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform role '${role}' maps to no permissions. A role that grants nothing is ` +
          'indistinguishable from an absent one and should be removed rather than left as a ' +
          'value a platform_operator row can hold.',
      );
    }
    for (const grant of mapped.grants) {
      if (grant.permissionId.includes('*') || grant.permissionId.trim() === '') {
        throw new PlatformPermissionModelIncoherentError(
          `The platform role '${role}' grants '${grant.permissionId}', which is a wildcard or ` +
            'blank. docs/decisions/0007 rule 3 forbids wildcards and rule 4 requires explicit ' +
            'registration. At platform scope a wildcard is not untidy, it is unbounded authority ' +
            'over every Organization on the platform.',
        );
      }
      if (grant.scope !== PLATFORM_SCOPE) {
        throw new PlatformPermissionModelIncoherentError(
          `The platform role '${role}' grants '${grant.permissionId}' at scope ` +
            `'${grant.scope}'. Every permission in permission-catalog.yaml held by a ` +
            "platform-scope role is declared 'scopes: [platform]', and a grant at any other " +
            'scope here is a tenant-scoped permission held by a principal with no tenant.',
        );
      }
    }
  }
  if (noRoleGrants.grants.length !== 0) {
    throw new PlatformPermissionModelIncoherentError(
      'An absent or unrecognised platform role grants something. It must deny everything, on ' +
        'the same path as an absent platform_operator row — which is what makes a row written by ' +
        'a future migration this build does not understand fail onto the safe path.',
    );
  }

  // =========================================================================================
  // 3. THE ENVELOPE. Six, at platform scope, no duplicates, no wildcards.
  // =========================================================================================
  if (envelope.declared.length !== PLATFORM_ROUTE_PERMISSION_COUNT) {
    throw new PlatformPermissionModelIncoherentError(
      `The platform envelope declares ${String(envelope.declared.length)} permissions and the ` +
        `class has ${String(PLATFORM_ROUTE_PERMISSION_COUNT)}. Membership in this class is six ` +
        'across all four platform contracts, and a seventh needs its own argument — the ' +
        'discipline that keeps "it is a platform route so it needs no tenant" from becoming a ' +
        'way to write an Action without a tenant check.',
    );
  }
  const seen = new Set<string>();
  for (const declaration of envelope.declared) {
    if (seen.has(declaration.permissionId)) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}' twice. Two entries for one ` +
          'permission is two ceilings, and `authorize()` reads the first it finds.',
      );
    }
    seen.add(declaration.permissionId);
    if (declaration.permissionId.includes('*') || declaration.permissionId.trim() === '') {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}', which is a wildcard or ` +
          'blank. The envelope is the ceiling; a wildcard ceiling is no ceiling.',
      );
    }
    if (declaration.scope !== PLATFORM_SCOPE) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}' at scope ` +
          `'${declaration.scope}'. Every route in this class evaluates at 'platform', and a ` +
          'declaration at a narrower scope produces a route that is registered and permanently ' +
          'refused.',
      );
    }
    if (HELD_BUT_UNREACHABLE.includes(declaration.permissionId)) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}', which is held by ` +
          'platform-admin and is deliberately reachable by no route. Adding it to the envelope ' +
          'would mean a route now exists that exercises it — for grant-platform-scope that is a ' +
          'route which creates platform authority, which docs/decisions/0025 refuses to publish.',
      );
    }
  }
}

assertPlatformPermissionModelIsCoherent();
