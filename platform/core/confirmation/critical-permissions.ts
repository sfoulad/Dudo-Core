/**
 * ===========================================================================================
 * WHICH PERMISSIONS ARE `critical`, AND THEREFORE REQUIRE CONFIRMATION.
 * `docs/decisions/0027` · `docs/decisions/0026` (the sensitivity ladder) ·
 * `docs/decisions/0007` D15 · contract `confirmation-v1`, §whereItLIVES.
 * ===========================================================================================
 *
 * `confirmation-v1`'s ruling: *"CONFIRMATION IS A PIPELINE CONCERN, DERIVED FROM THE PERMISSION'S
 * `sensitivity` IN permission-catalog.yaml, ENFORCED CENTRALLY, AND NOT DECLARABLE ANYWHERE
 * ELSE."*
 *
 * ===========================================================================================
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT READ FROM THE CATALOG
 * ===========================================================================================
 *
 * `permission-catalog.yaml` IS A CONTRACT REGISTRY AND NOT A RUNTIME ARTEFACT. Nothing in this
 * repository parses YAML — there is no parser, no dependency and no approval for one — so Core
 * cannot read the catalog at request time and must carry the set as a frozen literal, exactly as
 * `authorization/roles.ts` carries its grants and `platform-permissions.ts` its envelope.
 *
 * THAT MAKES THIS FILE A TRANSCRIPTION, AND A TRANSCRIPTION CAN DRIFT. `assertCriticalSetIsCoherent`
 * below is what turns drift into a load-time failure rather than a silent bypass, and
 * `qa-agent` owes the other half: **every permission the catalog marks `sensitivity: critical`
 * appears in the set below, and nothing else does.** That is one comparison over one file and it
 * is the only thing standing between the catalog and this list.
 *
 * ===========================================================================================
 * WHY IT IS NOT THE ACTION'S OWN `sensitivity` FIELD, WHICH IS THE OBVIOUS SHORTCUT
 * ===========================================================================================
 *
 * `Action` already declares `sensitivity: Sensitivity`, so the pipeline could simply read
 * `action.sensitivity === 'critical'` and require confirmation. **THAT WOULD BE AN ACTION
 * DECLARING WHETHER IT NEEDS CONFIRMING**, which `confirmation-v1` forbids by name:
 *
 *   *"AN ACTION MAY NOT DECLARE, CONFIGURE, OPT INTO OR OPT OUT OF CONFIRMATION. PER-ACTION IS HOW
 *   customers.customer.delete BECAME UNREACHABLE BY ACCIDENT RATHER THAN BY DECISION. If
 *   confirmation is something an Action remembers to require, then the Action that forgets is the
 *   dangerous one, and it will look exactly like the ones that did not."*
 *
 * An Action that declared `sensitivity: 'write'` for a permission the catalog calls `critical`
 * would silently opt itself out. So the requirement is derived from THE PERMISSION, here, and the
 * Action's own field is CHECKED AGAINST IT rather than trusted — see
 * `assertActionSensitivityMatchesCatalog`, which makes the mismatch a load-time error.
 *
 * ===========================================================================================
 * THE PROPERTY THIS BUYS, WHICH IS THE REASON `0026` REFUSED TO RECLASSIFY RESET
 * ===========================================================================================
 *
 * DECLARING A NEW PERMISSION `critical` AUTOMATICALLY REQUIRES CONFIRMATION FOR IT, WITH NO CODE
 * CHANGE AND NO CHANCE OF OMISSION — once it is added here. Before this file, the ladder's top rung
 * was decorative: a permission was marked critical and nothing happened.
 */

import type { Sensitivity } from '../action/action.ts';

/**
 * Every permission `packages/contracts/registries/permission-catalog.yaml` marks
 * `sensitivity: critical`, transcribed at 2026-09-05.
 *
 * FIFTEEN. Most of them gate operations that do not exist yet, and they are listed anyway — the
 * point of deriving the requirement from the permission is that the gate is already standing when
 * the operation arrives, rather than being something its author must remember to add.
 *
 * TWO OF THEM ARE REACHABLE TODAY: `customers.customer.delete` and `core.credential.reset`.
 *
 * NOTE WHAT IS ABSENT AND WHY IT MATTERS: `core.organization.create` is **`sensitive`, not
 * `critical`**, and `docs/decisions/0026` classified it that way DELIBERATELY so that onboarding
 * stays reachable in one request. Adding it here would re-impose by hand exactly what `0026`
 * removed by decision. It is named in this comment so that nobody "corrects" the omission.
 */
const CRITICAL_PERMISSIONS: readonly string[] = Object.freeze([
  'core.ai.configure',
  'core.api-credential.issue',
  'core.api-credential.revoke',
  'core.app.grant-permission',
  'core.app.uninstall',
  'core.capability.configure-provider',
  'core.credential.reset',
  'core.marketplace.moderate',
  'core.mcp.configure-external',
  'core.organization.delete',
  'core.principal.grant-platform-scope',
  'core.service-account.manage',
  'core.subscription.change',
  'core.tenant.export',
  'customers.customer.delete',
]);

const CRITICAL: ReadonlySet<string> = new Set(CRITICAL_PERMISSIONS);

/**
 * THE ONE QUESTION THE PIPELINE ASKS. There is no second way to reach this decision, no flag that
 * overrides it, and no parameter that narrows it.
 *
 * IT TAKES A PERMISSION AND NOT AN ACTION, deliberately: an `Action` argument would put the
 * Action's own `sensitivity` field within reach of this decision, which is the coupling the header
 * exists to prevent.
 */
export function requiresConfirmation(permissionId: string): boolean {
  return CRITICAL.has(permissionId);
}

/** For the coherence guard and for `qa-agent`'s comparison against the catalog. */
export function criticalPermissions(): readonly string[] {
  return CRITICAL_PERMISSIONS;
}

export class CriticalSetIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CriticalSetIncoherentError';
  }
}

/**
 * Runs at module load, like `assertRoleMappingIsCoherent` and
 * `assertPlatformPermissionModelIsCoherent`, and for the same reason: a set that had drifted would
 * do it silently, and the drift would present as an irreversible operation that stopped asking.
 *
 * WHAT IT CAN CHECK: that the list is sorted and unique, that no entry is blank or a wildcard, and
 * that `core.organization.create` — the one permission somebody is most likely to add by mistake —
 * is absent.
 *
 * WHAT IT CANNOT CHECK: that the list MATCHES THE CATALOG. Core cannot read YAML. That comparison
 * is `qa-agent`'s and it is the important half.
 *
 * THE PARAMETER EXISTS SO THE THROW BRANCHES CAN BE REACHED FROM A TEST and defaults to the
 * shipped value, the same change `assertRoleMappingIsCoherent` carries and for the same reason:
 * a module-level `const` is not rebindable by a test, and `qa-agent` correctly will not edit
 * `platform/core/**` to reach a branch.
 */
export function assertCriticalSetIsCoherent(
  permissions: readonly string[] = CRITICAL_PERMISSIONS,
): void {
  const seen = new Set<string>();
  let previous = '';
  for (const permissionId of permissions) {
    if (permissionId.trim() === '' || permissionId.includes('*')) {
      throw new CriticalSetIncoherentError(
        `'${permissionId}' is blank or a wildcard. docs/decisions/0007 rule 3 forbids wildcards, ` +
          'and a wildcard HERE would silently require confirmation for permissions nobody ' +
          'classified — or, read the other way, would be one prefix edit from requiring it for ' +
          'none of them.',
      );
    }
    if (seen.has(permissionId)) {
      throw new CriticalSetIncoherentError(`'${permissionId}' appears twice in the critical set.`);
    }
    if (permissionId < previous) {
      throw new CriticalSetIncoherentError(
        `The critical set is not sorted ('${permissionId}' follows '${previous}'). It is kept ` +
          'sorted so that a diff against permission-catalog.yaml is readable, which is the only ' +
          'way anyone will notice a permission that was classified critical and never added here.',
      );
    }
    seen.add(permissionId);
    previous = permissionId;
  }
  if (permissions.includes('core.organization.create')) {
    throw new CriticalSetIncoherentError(
      "'core.organization.create' is SENSITIVE, not critical. docs/decisions/0026 classified it " +
        'that way deliberately so that onboarding stays reachable in one request, and adding it ' +
        'here re-imposes by hand exactly what that decision removed. If organization creation ' +
        'should require confirmation, that is an amendment to 0026 and not an edit to this list.',
    );
  }
}

assertCriticalSetIsCoherent();

export class ActionSensitivityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionSensitivityMismatchError';
  }
}

/**
 * Asserts that an Action's own `sensitivity` agrees with the catalog's classification of its
 * permission.
 *
 * ===========================================================================================
 * THIS IS WHAT KEEPS THE ACTION'S FIELD HONEST WITHOUT LETTING IT DECIDE ANYTHING.
 * ===========================================================================================
 *
 * The pipeline derives the confirmation requirement from the PERMISSION. The Action's field is
 * then redundant — and redundancy that is never compared is redundancy that drifts. An Action
 * declaring `sensitivity: 'write'` for `customers.customer.delete` would be describing itself
 * falsely in its own documentation, in the audit record's shape, and to any future reader
 * deciding how carefully to review it.
 *
 * SO THE MISMATCH IS A LOAD-TIME ERROR IN BOTH DIRECTIONS: an Action that under-declares, and one
 * that over-declares a permission the catalog does not call critical. Called by `createRouter`,
 * so an incoherent Action stops the module rather than shipping.
 *
 * IT IS THE SAME DEVICE `control-plane-store.ts` DESCRIBES FOR THE MEMBERSHIP STATUS CHECK — "the
 * service ALSO checks `membership.status`, and that redundancy is deliberate: it is the defence
 * that survives an adapter written later that forgets the filter". Here the redundancy is checked
 * rather than merely duplicated.
 */
export function assertActionSensitivityMatchesCatalog(
  actionId: string,
  permissionId: string,
  sensitivity: Sensitivity,
): void {
  const catalogSaysCritical = requiresConfirmation(permissionId);
  if (catalogSaysCritical && sensitivity !== 'critical') {
    throw new ActionSensitivityMismatchError(
      `The Action '${actionId}' declares sensitivity '${sensitivity}' but its permission ` +
        `'${permissionId}' is critical in permission-catalog.yaml. The pipeline WILL require a ` +
        'confirmation for it regardless — the requirement is derived from the permission, not ' +
        'from this field — so the declaration is simply false. Correct the Action, or correct ' +
        'the catalog and this build\'s transcription of it.',
    );
  }
  if (!catalogSaysCritical && sensitivity === 'critical') {
    throw new ActionSensitivityMismatchError(
      `The Action '${actionId}' declares sensitivity 'critical' but its permission ` +
        `'${permissionId}' is not in Core's critical set. THE ACTION WILL NOT BE CONFIRMED, ` +
        'because confirmation is derived from the permission and never from this field. An ' +
        'Action that believes it is gated and is not is the exact failure docs/decisions/0027 ' +
        'exists to prevent — customers.customer.delete was protected by being unbuilt rather ' +
        'than by being gated, and its own file said otherwise in prose.',
    );
  }
}
