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
import { hasStatement } from './statements.ts';

/**
 * Every permission `packages/contracts/registries/permission-catalog.yaml` marks
 * `sensitivity: critical`, transcribed at 2026-09-05.
 *
 * SIXTEEN. Most of them gate operations that do not exist yet, and they are listed anyway — the
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
  // ===========================================================================================
  // ADDED 2026-09-05. IT WAS MISSING, AND ITS ABSENCE FAILED **OPEN**.
  // ===========================================================================================
  //
  // The catalog has marked this `critical` since it was written; this list froze fifteen of the
  // sixteen. `requiresConfirmation('core.principal.revoke-platform-scope')` therefore returned
  // `false`, and **both gates derive from that one function** — `pipeline.ts` for Actions and
  // `isConfirmationGated` for platform routes. An operation declaring this permission would have
  // been performed **with no confirmation, looking correct at every call site.**
  //
  // THE CATALOG STATES THE PROPERTY THAT WAS UNTRUE: *"CRITICAL, so confirmation applies — which
  // means SESSION THEFT ALONE CANNOT REVOKE ANYONE."* Session theft alone would have revoked
  // anyone, the moment a revoke route existed. `platform-operators-v1` is accepted and that route
  // is next, and `0028`'s argument for publishing it rests on this bound: *"the mechanism already
  // exists, so the bound is free."* **The bound was not free; it was absent.**
  //
  // THIS FILE PREDICTED THE DRIFT IN ITS OWN HEADER — *"a transcription can drift... `qa-agent`
  // owes the other half: every permission the catalog marks critical appears in the set below, and
  // nothing else does"* — and the comparison had never been written. **A named obligation with no
  // owner and no test is a comment.** `qa-agent` is making it a suite case.
  'core.principal.revoke-platform-scope',
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

/**
 * ===========================================================================================
 * THE OPERATIONS THE **PLATFORM-CLASS** CHALLENGE ROUTE MAY ISSUE A CONFIRMATION FOR, AND THE
 * PERMISSION EACH ONE BORROWS.
 * ===========================================================================================
 *
 * A CORE-OWNED FROZEN LITERAL, with no registration function and no manifest channel — the same
 * shape as the platform route table and the pre-auth registry, and for the same reason: an entry
 * here decides which permission a challenge is authorized against, so a caller that could add one
 * could obtain a challenge under a permission of its choosing.
 *
 * IT IS THE **PLATFORM CLASS'S** LIST AND NOT THE PLATFORM'S. `customers.customer.delete` is
 * critical and is deliberately absent: it is an ACTION, it needs a tenant, and its challenge
 * belongs to the Action class — which is deferred. Listing it here would let a platform route
 * issue a confirmation for an operation that platform routes cannot perform, and the confirmation
 * would be unspendable: the binding covers the action id, and no platform route will ever submit
 * a `customers.customer.delete`.
 *
 * ONE ENTRY TODAY, AND A SECOND NEEDS ITS OWN ARGUMENT — the discipline `0021` imposed on its
 * class of two and `0025` on its block of six.
 */
const CONFIRMABLE_PLATFORM_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'platform.credentials.reset': 'core.credential.reset',
  // ===========================================================================================
  // REVOKE. `platform-operators-v1`, and it is the SECOND entry, which needed its own argument.
  // ===========================================================================================
  //
  // `core.principal.revoke-platform-scope` is the sixteenth critical permission — **the one that
  // was missing from the frozen set earlier today and therefore FAILED OPEN.** The catalog's own
  // description states the property that was untrue: *"CRITICAL, so confirmation applies — which
  // means SESSION THEFT ALONE CANNOT REVOKE ANYONE."*
  //
  // IT IS TRUE NOW ONLY IF THIS LINE AND THE ROUTE'S GATING BOTH EXIST. Being in the critical set
  // makes `requiresConfirmation` answer `true`; being HERE is what makes a challenge obtainable,
  // and `assertConfirmationCoverageIsCoherent` refuses the build if a gated route is not in this
  // map. **Both halves, or the route is unreachable rather than unguarded** — which is the correct
  // direction and is still not the intended one.
  'platform.operators.revoke': 'core.principal.revoke-platform-scope',
});

export function confirmableOperations(): readonly string[] {
  return Object.freeze(Object.keys(CONFIRMABLE_PLATFORM_OPERATIONS));
}

/**
 * ===========================================================================================
 * ROUTES THAT AUTHORIZE AGAINST A `critical` PERMISSION WITHOUT PERFORMING THE OPERATION.
 * ===========================================================================================
 *
 * **A BORROWED PERMISSION IS NOT THE ROUTE'S OWN EFFECT**, and this is the list of routes for
 * which that is true. Each one narrows WHO may call it by pointing at a dangerous operation's
 * permission, while doing something that is not that operation.
 *
 * *** WHY THIS EXISTS RATHER THAN A PER-ROUTE FLAG. *** `0027` forbids an operation declaring
 * whether it needs confirming, by name: *"if confirmation is something an Action remembers to
 * require, then the Action that forgets is the dangerous one, and it will look exactly like the
 * ones that did not."* A `skipsConfirmation: true` on `PlatformRoute` would be exactly that. **This
 * set is Core-owned, frozen, in the same file as the confirmable operations, and a reviewer reads
 * both together** — an entry here is a claim a person made, in a file no App can edit, next to the
 * list it is an exception to.
 *
 * *** AND IT CANNOT HIDE A DANGEROUS ROUTE, BECAUSE THE COMPLETENESS CHECK IS THE OTHER WAY
 * ROUND. *** `assertConfirmationCoverageIsCoherent` requires every route with a critical permission
 * to be **either** confirmable **or** listed here. Forgetting to register a genuinely critical
 * route still stops the build. Listing one here wrongly is a deliberate, visible, reviewable act —
 * which is the most any mechanism can offer against someone who means it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO ENTRIES, AND EACH NEEDED ITS OWN ARGUMENT
 * ---------------------------------------------------------------------------------------------
 *
 * `platform.confirmations.request` — the challenge route. **Gating it is a DEADLOCK**, not merely
 * unnecessary: the binding covers the action id, the challenge route is not a confirmable
 * operation, so no challenge for it can ever be issued and every critical operation would become
 * permanently unreachable while looking gated.
 *
 * `platform.organizations.members.resolve` — **a READ.** `0028` Decision 2 binds it to
 * `core.credential.reset` so that *"revoking the reset grant revokes the ability to resolve
 * people"* and a Templates-only role cannot accumulate the `CO1` aggregation. It performs no
 * reset. **`organization-detail-v1`'s request schema settles it independently**: `required:
 * ["identifier"]` with `additionalProperties: false`, so a confirmation field is not merely
 * unnecessary there, it is FORBIDDEN by the contract.
 *
 * AND GATING IT WOULD HAVE BEEN CIRCULAR IN PRACTICE: to reset a credential an operator needs a
 * `principal_id`; the only route that produces one is this resolve; so a confirmed resolve would
 * mean confirming a lookup in order to be allowed to confirm the operation the lookup is for.
 */
const BORROWS_WITHOUT_PERFORMING: readonly string[] = Object.freeze([
  'platform.confirmations.request',
  'platform.organizations.members.resolve',
]);

export function borrowsCriticalPermissionWithoutPerforming(routeId: string): boolean {
  return BORROWS_WITHOUT_PERFORMING.includes(routeId);
}

/**
 * The permission a platform-class challenge borrows, or `undefined` for an operation this class
 * cannot confirm.
 *
 * `undefined` IS REFUSED BY THE DISPATCHER WITH `invalid_argument` and never falls back. A
 * fallback would authorize a caller against a permission it did not name, which is the whole of
 * what this indirection must not do.
 */
export function confirmablePermissionFor(actionId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(CONFIRMABLE_PLATFORM_OPERATIONS, actionId)
    ? CONFIRMABLE_PLATFORM_OPERATIONS[actionId]
    : undefined;
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

/**
 * Runs at module load beside the critical-set guard.
 *
 * TWO PROPERTIES, AND EACH CLOSES A WAY THE CHALLENGE ROUTE COULD ISSUE A USELESS OR DANGEROUS
 * TOKEN:
 *
 *   1. EVERY CONFIRMABLE OPERATION BORROWS A **CRITICAL** PERMISSION. One that borrowed a
 *      non-critical permission would be refused by `issueChallenge` anyway — but silently, at
 *      request time, looking like a client error. This makes it a build failure.
 *   2. EVERY CONFIRMABLE OPERATION HAS A **STATEMENT**. Without one the challenge refuses at
 *      request time with `no_confirmation_statement`, which is correct and is a strange thing to
 *      discover in production. The gate is that declaring an operation confirmable and forgetting
 *      its text makes the build stop rather than the route fail.
 */
export function assertConfirmableOperationsAreCoherent(
  operations: Readonly<Record<string, string>> = CONFIRMABLE_PLATFORM_OPERATIONS,
  isCritical: (permissionId: string) => boolean = requiresConfirmation,
  hasText: (actionId: string) => boolean = hasStatement,
): void {
  for (const [actionId, permissionId] of Object.entries(operations)) {
    if (!isCritical(permissionId)) {
      throw new CriticalSetIncoherentError(
        `'${actionId}' is confirmable but borrows '${permissionId}', which is not critical. ` +
          'A confirmation for a non-critical operation is a token nothing consumes, and issuing ' +
          'one invites a client to attach one to everything.',
      );
    }
    if (!hasText(actionId)) {
      throw new CriticalSetIncoherentError(
        `'${actionId}' is confirmable and has no statement in the catalog. A human would be ` +
          'asked to confirm an operation Core cannot describe, which docs/decisions/0007 D15 ' +
          'refuses: "states exactly what will happen" is not satisfied by an action identifier.',
      );
    }
  }
}

assertCriticalSetIsCoherent();
assertConfirmableOperationsAreCoherent();

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
  declaredErrors: readonly string[] = [],
): void {
  const catalogSaysCritical = requiresConfirmation(permissionId);

  // =========================================================================================
  // A CRITICAL ACTION MUST DECLARE `forbidden` AND `invalid_argument`, OR ITS CONFIRMATION
  // REFUSALS BECOME `internal`.
  // =========================================================================================
  //
  // `constrainToDeclaredErrors` collapses anything an Action did not declare into `internal()`.
  // The gate refuses with `forbidden` (a bad, spent or expired confirmation; a wrong password; a
  // password belonging to somebody else) and with `invalid_argument` (a malformed or missing
  // confirmation field). An Action that declared neither would answer `internal` to every one of
  // them — **so a user who mistyped their password would be told the platform had a defect**, and
  // an operator debugging it would look in the wrong place entirely.
  //
  // IT IS A LOAD-TIME ERROR RATHER THAN A REQUEST-TIME SURPRISE, because the alternative is
  // discovering it the first time somebody gets a confirmation wrong — which is the moment the
  // message matters most. `qa-agent` found exactly this shape as five `internal`s where
  // `forbidden` was expected.
  // =========================================================================================
  // A CRITICAL ACTION MUST HAVE A STATEMENT, KEYED BY ITS **ACTION ID**.
  // =========================================================================================
  //
  // `qa-agent` asserted the intent — *"every critical permission that has a reachable Action has a
  // statement"* — by looking the catalog up by PERMISSION id, and it can never pass that way: the
  // catalog is keyed by OPERATION id, because that is what the pipeline looks up (`action.id`).
  //
  // **CORE CANNOT CHECK THE PROPERTY THE WAY QA STATED IT.** Core holds the critical permission
  // set but does not know which Actions exist — they live in `apps/**` and arrive at composition —
  // so there is no permission → operation mapping to walk.
  //
  // **IT CAN CHECK IT FROM THE OTHER END, WHICH IS BETTER**: at router construction, for each
  // Action, if its permission is critical then a statement must exist under its id. That is the
  // same property, asserted where both halves are in hand, and it makes a missing statement a
  // BUILD failure rather than a `no_confirmation_statement` at request time.
  //
  // IT WOULD HAVE CAUGHT THE KEY MISMATCH `qa-agent` FOUND — the catalog was keyed
  // `customers.customer.delete`, the permission, while the Action is `customers.DeleteCustomer` —
  // the moment that Action was wired, instead of the first time somebody tried to delete a
  // customer.
  if (catalogSaysCritical && !hasStatement(actionId)) {
    throw new ActionSensitivityMismatchError(
      `The Action '${actionId}' has the critical permission '${permissionId}' and there is no ` +
        'confirmation statement keyed by its id. Every critical operation must be describable to ' +
        'a human before they agree to it — docs/decisions/0007 D15 requires the statement to say ' +
        'exactly what will happen, and an action identifier is not that. NOTE THE KEY: the ' +
        'catalog is keyed by the OPERATION id, not the permission id; the two are similar enough ' +
        'to confuse and are not interchangeable.',
    );
  }

  if (catalogSaysCritical && declaredErrors.length > 0) {
    for (const required of ['forbidden', 'invalid_argument'] as const) {
      if (!declaredErrors.includes(required)) {
        throw new ActionSensitivityMismatchError(
          `The Action '${actionId}' has the critical permission '${permissionId}' and does not ` +
            `declare '${required}'. The confirmation gate refuses with it, and ` +
            '`constrainToDeclaredErrors` would collapse that into `internal` — telling a user ' +
            'who mistyped their password that the platform is broken, and sending whoever ' +
            'investigates to the wrong file.',
        );
      }
    }
  }
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
