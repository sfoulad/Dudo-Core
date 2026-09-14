/**
 * ===========================================================================================
 * THE TENANT-ADMIN CLASS CEILING. `docs/decisions/0044` · `docs/decisions/0043`.
 * ===========================================================================================
 *
 * The fifth request class evaluates a permission on every call, at `organization` scope, against
 * THIS envelope as the ceiling and the caller's membership role as the floor. Neither substitutes
 * for the other — `authorizer.ts`, unchanged, taking the envelope as a parameter exactly as the
 * platform class does.
 *
 * ===========================================================================================
 * IT IS EMPTY TODAY, AND THAT IS THE FAIL-CLOSED STATE RATHER THAN AN OMISSION
 * ===========================================================================================
 *
 * `authorize()` refuses any permission the envelope does not declare, whatever role the caller
 * holds. An empty envelope therefore refuses EVERY permission to EVERY caller — which is the
 * correct state for a class with no routes, and the reason this file can ship ahead of the first
 * Milestone 2 contract without opening anything.
 *
 * **NO MILESTONE 2 PERMISSION IS TRANSCRIBED HERE, AND THE REASON IS NOT CAUTION.**
 * `permission-catalog.yaml` is the register (`0007` rule 4) and every permission this milestone
 * needs is `status: proposed` in it. `0043` §6b records that the four ownership and invitation
 * entries stay proposed until `security-agent` reviews them, and `security.md` §8 is explicit that
 * no agent may approve a permission. **Core's copy of the register may lag the register; it may
 * never lead it.**
 *
 * SO THE CEILING RISES ONE CONTRACT AT A TIME, which is the shape `platform-permissions.ts`
 * established across four widenings and the opposite of declaring a ceiling in advance for routes
 * nobody has written. A ceiling that has to be widened to add a route is a ceiling somebody reads;
 * one that already admits everything is one nobody does.
 *
 * ===========================================================================================
 * WHAT THIS FILE DELIBERATELY DOES NOT HOLD
 * ===========================================================================================
 *
 * **NO ROLE-TO-PERMISSION MAPPING.** That is `authorization/roles.ts`, which is the ONLY place a
 * tenant role name is turned into permissions and which `AUTHORIZATION_STANDARD.md` §9 requires to
 * stay the only place. A second mapping here — "what a tenant admin may do" — would be a role name
 * in a conditional wearing a constant's clothes.
 *
 * **NO CUSTOM-ROLE GRANTS.** `0007` D16's custom roles are a SUBSET of their creator's grants
 * (constraint 1), so they are bounded by the seed roles in `roles.ts` and need no separate ceiling.
 * See `assertNoRouteConjunctionIsUnsatisfiable` in `tenant-admin-routes.ts` for why that
 * subset property is what keeps a static reachability check sound under D16.
 *
 * ===========================================================================================
 * *** ⚠ AND CONSTRAINT 1 IS ENFORCED NOWHERE IN THIS REPOSITORY TODAY. THE SENTENCE ABOVE IS
 * TRUE ABOUT THE WORLD AND NOT ABOUT THE CODE, AND IT EXPIRES ON AN EVENT. ***
 * ===========================================================================================
 *
 * Raised by `security-agent`, which read the paragraph above as structural, looked for the check,
 * and correctly reported that it could not establish one. **There is none** — searched: the word
 * `subset` appears in this tree only in comments, including this one.
 *
 * **WHAT MAKES IT TRUE TODAY IS THAT NO CUSTOM ROLE CAN EXIST.** `core.role.create` has no route,
 * `0022_tenant_role.sql` is written and unapplied, and `grantsForRole` maps one seed role and knows
 * nothing about the tables. So the claim holds **vacuously**, which is a fact about the world.
 *
 * ```
 * TODAY                                      no custom role can exist  ->  claim holds, vacuously
 * THE CREATION ROUTE LANDS **WITHOUT** THE
 *   SUBSET CHECK                             claim is FALSE, and the static reachability check
 *                                            in tenant-admin-routes.ts becomes UNSOUND
 * THE CREATION ROUTE LANDS **WITH** IT       claim holds, structurally
 * ```
 *
 * **SO THE OBLIGATION IS ORDERING RATHER THAN EXISTENCE: THE SUBSET CHECK LANDS IN THE SAME CHANGE
 * AS `core.role.create`, NEVER AFTER IT.** A creation route shipping first would leave a static
 * check in this class asserting a property a tenant can falsify by minting one role — and it would
 * still be green, because the check reads the SEED roles and the falsifying grant is not in them.
 *
 * **WHERE IT BELONGS, AND IT IS NOT HERE.** `architecture.md` §3a: the in-statement guard is the
 * only layer with no window, so constraint 1 goes in the `WHERE` of the statement that inserts a
 * `tenant_role_permission` row — comparing against the creator's held set in the same statement
 * that writes. `0022_tenant_role.sql` records the same thing from the schema side and says why a
 * trigger cannot express it: the creator's grants are computed in code from a role mapping, not
 * stored as rows.
 *
 * **This paragraph is the expiry notice `workflow.md` §12 asks for** — a conditional whose
 * condition someone will meet, with the obligation assigned rather than left for a reader to infer
 * from an argument that reads as settled.
 */

import type { AppPermissionEnvelope, PermissionGrant } from '../authorization/authorizer.ts';
import type { Scope } from '../authorization/scope.ts';
import { PLATFORM_PERMISSION_ENVELOPE } from '../platform/platform-permissions.ts';

/**
 * EVERY PERMISSION IN THIS CLASS IS EVALUATED AT `organization` SCOPE, AND IT IS NOT A PER-ROUTE
 * FIELD.
 *
 * The platform class makes the same choice for the same reason, quoted from its route type: *"a
 * per-route scope is a per-route opportunity to evaluate at the wrong level — which
 * `AUTHORIZATION_STANDARD.md` §4 calls a silent privilege escalation."*
 *
 * `organization` AND NOT `business`, EVEN FOR A ROUTE THAT ADMINISTERS ONE BUSINESS. `0043` §1b:
 * a role entry's `scope:` has no consumer anywhere, `roles.ts` grants every tenant permission at
 * `organization` scope, and the narrowing that actually applies is the authorized business set
 * computed per request (`0020`). Evaluating a tenant-admin route at `business` scope would make an
 * `organization`-scope grant satisfy it — which `implies()` permits and which is correct — while
 * making a `business`-scope grant satisfy it too, which is the widening nobody would have written
 * down.
 */
export const TENANT_ADMIN_SCOPE: Scope = 'organization';

/**
 * `appId` for the envelope. It is NOT an App and this is not an App envelope.
 *
 * The same reuse `PLATFORM_PERMISSION_ENVELOPE` and `http/core-routes.ts::CORE_APP_PERMISSIONS`
 * make: `authorize()` takes the envelope as a parameter, so Core declaring its own needs no change
 * to the authorizer and introduces no second authorization function. The value is distinct from
 * `platform` and from any installed App id so that an audit record produced on this path cannot be
 * attributed to either.
 */
export const TENANT_ADMIN_ENVELOPE_APP_ID = 'tenant-admin';

/**
 * The ceiling. **Zero permissions.**
 *
 * A permission enters this list in the SAME change that registers the route requiring it, and
 * `assertEveryRoutePermissionIsReachable` in `tenant-admin-routes.ts` fails the build of everything
 * importing that module if either half arrives alone. That guard exists because the platform class
 * shipped the two halves separately twice in one day, in both directions, and both produced a route
 * that was `forbidden` to every caller alive.
 */
export const TENANT_ADMIN_PERMISSION_ENVELOPE: AppPermissionEnvelope = Object.freeze({
  appId: TENANT_ADMIN_ENVELOPE_APP_ID,
  declared: Object.freeze([] as readonly PermissionGrant[]),
});

/**
 * The declared size of the ceiling, compared against it at module load.
 *
 * ===========================================================================================
 * IT IS A NUMBER SOMEBODY HAS TO MOVE ON PURPOSE, AND THAT IS ITS ENTIRE VALUE.
 * ===========================================================================================
 *
 * `workflow.md` §11a: *"assert the count against the last known value and require a human to move
 * it. A number that can only be edited deliberately is a number someone has to look at."*
 *
 * **AND IT IS NOT A REACHABILITY CHECK. `platform-permissions.ts` records exactly what a count
 * cannot see:** its `PLATFORM_ROUTE_PERMISSION_COUNT` read seven against an envelope of seven
 * while a shipped route declared a permission that envelope did not hold, *"because a count says
 * nothing about WHICH permissions are in the set or whether they cover the routes."* This constant
 * is here so a widening is deliberate, and `assertEveryRoutePermissionIsReachable` is here so a
 * widening is CORRECT. Neither substitutes for the other.
 */
export const TENANT_ADMIN_ROUTE_PERMISSION_COUNT = 0;

export class TenantAdminPermissionModelIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantAdminPermissionModelIncoherentError';
  }
}

/**
 * Runs at module load. Five properties, and the fifth is the one that is about two artifacts
 * rather than one.
 *
 * THE PARAMETERS DEFAULT TO THE SHIPPED VALUES so that `qa-agent` can reach every throw branch
 * with a constructed input without editing `platform/core/**`. That is the change
 * `assertRoleMappingIsCoherent` and `assertAllocationsAreCoherent` both made, for the reason
 * `roles.ts` gives: a module-level `const` that ESM will not let a test rebind leaves a guard's
 * branches unreachable, and **a coherence check that is itself unchecked is a guard nobody has
 * watched fail.**
 */
export function assertTenantAdminPermissionModelIsCoherent(
  envelope: AppPermissionEnvelope = TENANT_ADMIN_PERMISSION_ENVELOPE,
  declaredCount: number = TENANT_ADMIN_ROUTE_PERMISSION_COUNT,
  platformEnvelope: AppPermissionEnvelope = PLATFORM_PERMISSION_ENVELOPE,
): void {
  if (envelope.declared.length !== declaredCount) {
    throw new TenantAdminPermissionModelIncoherentError(
      `The tenant-admin envelope declares ${String(envelope.declared.length)} permission(s) and ` +
        `TENANT_ADMIN_ROUTE_PERMISSION_COUNT says ${String(declaredCount)}. The count exists so ` +
        'that widening the class ceiling is a deliberate edit somebody reads rather than a line ' +
        'added to a list. Move it, and state the argument for the widening where the entry sits.',
    );
  }
  const seen = new Set<string>();
  for (const grant of envelope.declared) {
    if (grant.permissionId.includes('*') || grant.permissionId.trim() === '') {
      throw new TenantAdminPermissionModelIncoherentError(
        `The tenant-admin envelope declares '${grant.permissionId}', which is a wildcard or ` +
          'blank. `0007` rule 3 forbids wildcards and rule 4 requires explicit registration, and ' +
          '`0044` §3b.4 restates it for this class: no wildcard permission, and an unrecognised ' +
          'route id fails closed.',
      );
    }
    if (grant.scope !== TENANT_ADMIN_SCOPE) {
      throw new TenantAdminPermissionModelIncoherentError(
        `The tenant-admin envelope declares '${grant.permissionId}' at scope '${grant.scope}'. ` +
          `Every permission in this class is evaluated at '${TENANT_ADMIN_SCOPE}'; a declaration ` +
          'at a narrower scope produces a route that is registered, authorized-looking and ' +
          'permanently refused, and one at a wider scope evaluates a tenant operation above the ' +
          'tenant.',
      );
    }
    if (seen.has(grant.permissionId)) {
      throw new TenantAdminPermissionModelIncoherentError(
        `The tenant-admin envelope declares '${grant.permissionId}' twice. A duplicate makes the ` +
          'count above meaningless and hides a second entry that may differ in scope.',
      );
    }
    seen.add(grant.permissionId);
  }

  // =========================================================================================
  // ---- *** THE TWO ENVELOPES ARE DISJOINT. `docs/decisions/0024`, MECHANISED. ***
  // =========================================================================================
  //
  // `0024`'s mutual exclusion is about PRINCIPALS — a platform operator holds zero membership
  // rows, so `0044` §3a's "no platform operator can reach this class by construction" holds
  // whatever the permissions say. **This check is about NAMES**, and it exists because the
  // catalogue already went to the trouble of separating them: `core.platform-organization.update`
  // and `core.organization.update` are two entries precisely so that the two administrations do
  // not share a vocabulary.
  //
  // A SHARED NAME WOULD NOT ITSELF BREAK ANYTHING TODAY, and saying so is the point — this is the
  // third layer, not the control. What it catches is the day somebody reaches for
  // `core.organization.list` in a tenant route because the name reads right, at which point a
  // tenant admin's ceiling admits the permission that enumerates every Organization on the
  // platform. **`roles.ts` would still refuse it, and a check that only fires when one other layer
  // has already failed is exactly the layer worth having.**
  //
  // *** WHAT IT CANNOT SEE, STATED SO IT IS NOT READ AS MORE THAN IT IS: *** it compares
  // IDENTIFIERS. A differently-named permission granting identical reach — a
  // `core.organization.list-all` in this envelope — passes it cleanly. Naming is not reach, and
  // this check knows only the names.
  const platformNames = new Set(platformEnvelope.declared.map((entry) => entry.permissionId));
  for (const grant of envelope.declared) {
    if (platformNames.has(grant.permissionId)) {
      throw new TenantAdminPermissionModelIncoherentError(
        `'${grant.permissionId}' is declared in BOTH the tenant-admin envelope and the platform ` +
          'envelope. `0024` keeps the two administrations mutually exclusive and the permission ' +
          'catalogue keeps their vocabularies separate on purpose — `core.organization.update` ' +
          'and `core.platform-organization.update` are two entries rather than one. If a tenant ' +
          'operation and a platform operation genuinely need the same capability, they need two ' +
          'names, because the two are granted to different populations and audited into ' +
          'different tables.',
      );
    }
  }
}

assertTenantAdminPermissionModelIsCoherent();
