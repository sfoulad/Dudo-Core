/**
 * ===========================================================================================
 * THE PLATFORM ROUTE CLASS — THE FOURTH REQUEST CLASS. `docs/decisions/0025` decision 3,
 * implementing `packages/contracts/core/platform/platform-operator-v1.contract.yaml`.
 * ===========================================================================================
 *
 * A PLATFORM ROUTE AUTHENTICATES A PRINCIPAL, EVALUATES A PERMISSION AGAINST A CORE-OWNED
 * PLATFORM ENVELOPE, AND NEVER OBTAINS A TENANT STORE.
 *
 *   CLASS               PRINCIPAL           TENANT     PERMISSION   REGISTRY
 *   pre-auth (0014 §B)  none                none       none         closed set of 5
 *   session  (0021)     session only        none       none         closed set of 2
 *   Action              full, tenant-bound  REQUIRED   yes          App or Core router
 *   PLATFORM (0025)     principal-level     none       YES          Core-owned literal
 *
 * ===========================================================================================
 * WHY IT IS NOT AN ACTION WITH THE TENANT MADE OPTIONAL
 * ===========================================================================================
 *
 * `0021`'s sentence, and it is the whole argument:
 *
 *   **THE INVARIANT THAT AN ACTION ALWAYS HAS A TENANT IS WORTH MORE THAN THE CODE IT SAVES.**
 *
 * A tenant-optional branch inside the pipeline would force every future reviewer of every future
 * Action to work out which side of it they had landed on. The cost of a separate class is paid
 * once, by the people building it. The cost of the branch is paid forever, by everyone reading
 * past it. The other refused shortcut — a pseudo-principal with a null `organizationId` — is
 * `0014` §B's own argument one layer up: it would make every tenant predicate in the platform
 * depend on a sometimes-absent value.
 *
 * NEITHER SHORTCUT IS TAKEN HERE. `PlatformAuthority` is a distinct, smaller type than
 * `AuthenticatedPrincipal`; there is no function that converts one into the other; and
 * `invokeAction` is never called from this file.
 *
 * ===========================================================================================
 * WHY IT IS NOT A SESSION ROUTE
 * ===========================================================================================
 *
 * A session route EVALUATES NO PERMISSION, and `organization-selection-v1`'s safety argument for
 * that is that neither of its two operations "can do anything the session holder could not
 * already do". A PLATFORM OPERATION FAILS THAT TEST BY DESIGN — creating an Organization or
 * resetting a credential is precisely a thing the session holder could not otherwise do. So the
 * session class's justification for having no permission does not transfer, and this class must
 * have one.
 *
 * ===========================================================================================
 * P1 — NO TENANT STORE IS REACHABLE, STRUCTURALLY
 * ===========================================================================================
 *
 * A platform route handler receives a `PlatformRouteContext` and nothing else: no
 * `TenantStoreResolver`, no `TenantScopedStore`, no `ActionContext`, no organization identifier
 * of the caller's, and no D1 binding.
 *
 * THIS IS `tenancy/tenant-context.ts`'s OWN DEVICE APPLIED ONE CLASS OVER. That file's strongest
 * sentence is "WITHHOLDING THE VALUE IS STRONGER THAN REQUIRING ITS USE", and the reason an
 * Action handler cannot write a tenant predicate correctly, incorrectly, or at all is that it
 * holds no value to write one with. A platform handler is in the same position with respect to
 * the whole tenant database.
 *
 * THE HONEST LIMIT: this class touches the CONTROL PLANE, which is the one component whose
 * purpose is to hold tenant identity. "No tenant data" is exact; "no tenant identifier" is not.
 * A platform route may create, name and enumerate tenants and MAY NEVER READ A ROW BEHIND
 * `whereWithTenant`. The weaker property is the one that is true.
 *
 * ===========================================================================================
 * P2 — VALIDATION BELONGS TO THE CLASS, NOT TO ITS ROUTES
 * ===========================================================================================
 *
 * `0021`'s finding, and it applies here with more force than it did there. A route matched in
 * `http/api.ts`'s early absolute-path block INHERITS NO INPUT VALIDATION AT ALL: Core's JSON
 * parsing, its unknown-field rejection and its repeated-parameter refusal all live in the Action
 * path BELOW that block.
 *
 * THIS CLASS ACCEPTS IDENTIFIERS THAT NAME TENANTS AND PRINCIPALS. It must not be the class
 * without validation. So `dispatchPlatformRoute` VALIDATES BEFORE IT LOOKS UP A HANDLER, every
 * route declares its complete body-field set and its complete query-parameter set, and A ROUTE
 * THAT DECLARED NOTHING WOULD ACCEPT NOTHING. A fifth platform route cannot be added without
 * inheriting all of it, because there is no path to a handler that does not pass through here.
 *
 * A ROUTE DECLARING NO QUERY PARAMETERS REFUSES THE WHOLE QUERY STRING rather than filtering
 * unknown keys, which is the stronger form and the one `0021` chose: without it `?principal_id=…`
 * is silently accepted and ignored, and "ignored" is one careless edit from "read".
 *
 * ===========================================================================================
 * P4 — EVERY ROUTE WRITES AN AUDIT RECORD, INCLUDING THE READS
 * ===========================================================================================
 *
 * Enforced by `dispatchPlatformRoute` and not by the handlers: a handler returns a value and a
 * target, and this function writes the record. There is no code path from an authorized platform
 * request to a response that does not pass through `audit.record`, and a handler cannot opt out
 * because it is never asked. See `platform-audit.ts` for what is recorded, what is refused, and
 * which callers cause no record at all.
 *
 * *** "NO CODE PATH" INCLUDES A THROWN ONE, AND FOR TWO VISITS IT DID NOT. *** A handler that
 * threw propagated past the recorder and was caught at `fetchHandler`'s outer boundary, which
 * rendered `internal()` and disclosed nothing — so the hole was invisible from outside and the
 * operation simply left no trace. Both the handler call and the `audit.record` call are now
 * wrapped; see each for why. It is stated here rather than quietly fixed, because the sentence
 * above was the claim the omission falsified.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import {
  detail,
  forbidden,
  internal,
  invalidArgument,
  unauthenticated,
  unavailable,
} from '../kernel/errors.ts';
import type { Authorizer } from '../authorization/authorizer.ts';
import type { PreAuthBody } from '../identity/pre-auth-admission.ts';
import {
  parsePreAuthBody,
  PRE_AUTH_MAX_BODY_BYTES,
  PRE_AUTH_MAX_FIELD_LENGTH,
} from '../identity/pre-auth-admission.ts';
import type { PlatformAuthority, PlatformAuthorityResolver } from './platform-authority.ts';
import type { PlatformAuditRecorder, PlatformActionTarget } from './platform-audit.ts';
import { NO_TARGET } from './platform-audit.ts';
import {
  PLATFORM_ORGANIZATION_LIST_PERMISSION,
  PLATFORM_PERMISSION_ENVELOPE,
} from './platform-permissions.ts';
import {
  borrowsCriticalPermissionWithoutPerforming,
  confirmableOperations,
  confirmablePermissionFor,
  requiresConfirmation,
} from '../confirmation/critical-permissions.ts';
import type { ConfirmationGate } from '../confirmation/confirmation-gate.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
} from '../confirmation/confirmation-gate.ts';

/**
 * The base path. `/api/v1/platform`.
 *
 * IT IS RESERVED TO CORE. `identity/pre-auth-registry.ts` carries the prefix in
 * `RESERVED_PRE_AUTH_PATH_PREFIXES`, so `assertNoReservedPathCollision` refuses any App route
 * table that could resolve onto it at CONSTRUCTION, and `http/api.ts` matches this block BEFORE
 * the App router at RUNTIME. Both halves are needed: the first turns a colliding table into a
 * build failure instead of dead code, and the second means an App cannot present itself to a user
 * as the admin console even if it somehow shipped.
 *
 * The contract also requires `platform` to be added to `reservedApiPathSegments` in
 * `core-object-registry.yaml`. THAT REGISTRY IS `architecture-agent`'s FILE AND THIS CHANGE DOES
 * NOT MAKE IT — requested through the Team Lead.
 */
export const PLATFORM_BASE_PATH = '/api/v1/platform';

/**
 * The closed set. TWO OPERATIONS IN THIS SLICE, SIX IN THE CLASS, AND A SEVENTH IS A DECISION
 * RATHER THAN A REFACTOR.
 *
 * A CLOSED UNION OF LITERALS, exactly as `PreAuthEntryPointId` and `SessionRouteId` are, and for
 * the same reason: a third value is not expressible without editing this file, which lives in
 * `platform/core/**` and which no App may edit.
 *
 * THE FOUR ROUTES NOT BUILT HERE — `templates.list`, `templates.read`, `templates.create`,
 * `organizations.create`, `credentials.reset` — belong to three contracts still being written and
 * are deliberately absent rather than stubbed. A registered route with no handler answers
 * `unauthenticated`, which is the fail-closed shape, but a route that does not exist cannot be
 * reached at all.
 */
export type PlatformRouteId =
  | 'platform.organizations.list'
  | 'platform.organizations.create'
  | 'platform.organizations.read'
  | 'platform.organizations.members.resolve'
  | 'platform.session.whoami'
  | 'platform.confirmations.request'
  | 'platform.templates.create'
  | 'platform.templates.list'
  | 'platform.templates.read';

export type PlatformRouteMethod = 'GET' | 'POST';

/**
 * A registered platform route.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `scope`, `store`, `organizationId`, `resolver`. The
 * scope is not a per-route field because EVERY route in this class evaluates at `platform` and a
 * per-route scope is a per-route opportunity to evaluate at the wrong level — which
 * `AUTHORIZATION_STANDARD.md` §4 calls "a silent privilege escalation".
 */
/**
 * How a route's permission is determined.
 *
 * ===========================================================================================
 * A UNION RATHER THAN A REQUIRED `permission` WITH AN OPTIONAL `resolvePermission` BESIDE IT.
 * ===========================================================================================
 *
 * The optional-sibling shape lets a route declare both — in which case a reviewer cannot tell
 * which governs — or declare a fixed permission it never uses, which is a lie in the route table.
 * **The union makes both unrepresentable**, and it makes the dynamic case loud at the one place
 * anybody reads to find out what a route requires.
 *
 * `from-body` EXISTS FOR ONE ROUTE AND HAS A REAL TARGET. `confirmation-v1`: the challenge route
 * declares *"THE SAME PERMISSION AS THE OPERATION NAMED IN THE REQUEST, resolved from action_id.
 * Not a permission of its own."* That is what keeps it from being an oracle — a caller who could
 * not perform the operation cannot obtain a challenge for it, and receives the identical refusal.
 *
 * *** THE EQUIVALENT EXTENSION TO THE **ACTION** CLASS IS DELIBERATELY NOT MADE. *** Team Lead
 * ruling, 2026-09-05: `Action.permission` is read by `authorize()` and by every audit record, and
 * making it dynamic is an extension to the most load-bearing shape in the product — **to serve a
 * route that currently has nothing to point at.** `customers.customer.delete` is a deferred route
 * and there is no second critical Action, so `core.confirmations.request` is DEFERRED UNTIL A
 * CRITICAL ACTION EXISTS, because the change it requires is to the Action permission model and
 * there is currently nothing to validate it against. That is the reason, and it is written here so
 * the route is not built as a tidy-up.
 */
export type PlatformRoutePermission =
  | { readonly kind: 'fixed'; readonly permissionId: string }
  | {
      readonly kind: 'from-body';
      /**
       * Returns a permission the CALLER'S OWN registry knows, or `undefined`.
       *
       * `undefined` is refused with `invalid_argument` — never with a permissive default and never
       * by falling back to some other permission. A resolver that returned a permission the caller
       * did not name would authorize one operation while the human confirmed another.
       */
      readonly resolve: (body: PreAuthBody) => string | undefined;
    };

/** For the two ordinary routes. A fixed, Core-owned literal. */
function fixedPermission(permissionId: string): PlatformRoutePermission {
  return { kind: 'fixed', permissionId };
}

export type PlatformRoute = {
  readonly id: PlatformRouteId;
  readonly method: PlatformRouteMethod;
  /** ABSOLUTE. Under `PLATFORM_BASE_PATH`, which is reserved. */
  readonly path: string;
  /**
   * The permission `authorize()` evaluates, at `platform` scope, against
   * `PLATFORM_PERMISSION_ENVELOPE`. Required, and there is no route without one — `0007` rule 4,
   * and it is what distinguishes this class from the session class.
   */
  readonly permission: PlatformRoutePermission;
  /**
   * The COMPLETE set of body field names whose value is a NESTED OBJECT.
   *
   * ===========================================================================================
   * WHY THIS EXISTS, AND WHY `parsePreAuthBody` WAS NOT WIDENED INSTEAD.
   * ===========================================================================================
   *
   * `confirmation-v1`'s challenge request carries `parameters`, which is an object. The class's
   * validation floor is `parsePreAuthBody` — shared with the pre-authentication registry and the
   * session route class **deliberately, so the three cannot drift** — and it refuses nesting
   * outright.
   *
   * WIDENING IT WOULD SPEND THAT PROPERTY FOR ONE ROUTE IN ONE CLASS. So the extension lives here,
   * inside the class that needs it, and **a route declaring no object fields takes the original
   * path byte for byte** — the two routes that existed before this change are validated by exactly
   * the code that validated them before.
   *
   * AN OBJECT FIELD IS STILL VALIDATED, and that is what keeps P2 true: a flat map of primitives,
   * bounded in count and in length, with no nesting of its own. It is not waved through because it
   * happens to be an object.
   */
  readonly objectFields: readonly string[];
  /**
   * The COMPLETE set of body field names this route accepts. Required, and may be empty.
   *
   * "This route accepts no body fields" has to be an explicit statement rather than an omission,
   * because an omission is how a route ends up accepting anything.
   */
  readonly fields: readonly string[];
  /**
   * The COMPLETE set of query parameter names this route accepts. Required, and may be empty.
   *
   * EMPTY MEANS THE WHOLE QUERY STRING IS REFUSED, not that unknown keys are filtered. See P2.
   */
  readonly queryParameters: readonly string[];
  /**
   * The status a SUCCESSFUL response carries. `200` unless the route creates something.
   *
   * IT IS A PER-ROUTE FIELD AND NOT A METHOD RULE, AND THE FIELD IS COPIED FROM THE CONTRACT
   * RATHER THAN REASONED ABOUT. Every route here declares what its contract's `successStatus`
   * declares: `201` for the three that create — `platform-operator-v1:500,531` for the reads,
   * `template-v1:230,279,304`, `confirmation-v1:301`, `organization-onboarding-v1:343`.
   *
   * *** THE CITATIONS ARE THERE BECAUSE THE FIRST VERSION OF THIS FIELD GOT TWO OF THEM WRONG. ***
   * `templates.create` and `confirmations.request` were written as `200` with comments asserting
   * the contracts said so; both contracts say `201`. **A plausible argument about a status is not
   * evidence of one**, and a comment claiming a contract as its authority is exactly what stops
   * the next reader from opening it. Line numbers make the claim checkable.
   *
   * THE HANDLER STILL CHOOSES NO STATUS. It is declared in the route table, beside the fields and
   * the permission, where a reviewer reads what a route does.
   */
  readonly successStatus: 200 | 201;
};

/**
 * The table.
 *
 * BOTH ROUTES DECLARE `core.organization.list`, AND FOR `whoami` THAT IS THE CONTRACT'S RULING
 * RATHER THAN AN OVERSIGHT. No `core.platform.whoami` is added to the catalog, because a
 * permission every platform operator necessarily holds, checked on every call and deniable to
 * nobody, is not an authorization decision — it is ceremony that makes the catalog less
 * meaningful. `organization-selection-v1` made exactly this argument against inventing
 * `core.session.select`.
 *
 * THE COST IS REAL AND IS NAMED IN THE CONTRACT AS PO-5: a future `marketplace-moderator` holding
 * `core.marketplace.moderate` but NOT `core.organization.list` cannot call `whoami` and so cannot
 * render its own console. That is the point at which the ruling should be REVISITED rather than
 * patched by granting the moderator an Organization-enumeration permission it has no business
 * holding.
 */
const ROUTES: readonly PlatformRoute[] = Object.freeze([
  Object.freeze({
    id: 'platform.organizations.list' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/organizations`,
    permission: fixedPermission(PLATFORM_ORGANIZATION_LIST_PERMISSION),
    // No body. A GET with a body is refused like any other undeclared input.
    fields: Object.freeze([]),
    objectFields: Object.freeze([]),
    // EXACTLY TWO. There is no `organization_id` filter, no `status` filter, no `q`, no `sort` and
    // no `include`. Each of those is a way to ask the control plane a question this route is not
    // supposed to answer, and `include=customers` is how a console acquires cross-tenant reach in
    // one query parameter.
    queryParameters: Object.freeze(['page_size', 'cursor']),
    successStatus: 200 as const,
  }),
  Object.freeze({
    id: 'platform.session.whoami' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/whoami`,
    permission: fixedPermission(PLATFORM_ORGANIZATION_LIST_PERMISSION),
    fields: Object.freeze([]),
    objectFields: Object.freeze([]),
    // NONE, SO ANY QUERY STRING AT ALL IS REFUSED. In particular there is no `principal_id`: the
    // safety argument for this route is in its signature — "it returns the caller's own context
    // and has no field naming another principal" — and an accepted-but-ignored parameter would be
    // the first half of undoing it.
    queryParameters: Object.freeze([]),
    successStatus: 200 as const,
  }),
  Object.freeze({
    id: 'platform.confirmations.request' as const,
    method: 'POST' as const,
    path: `${PLATFORM_BASE_PATH}/confirmations`,
    // ===========================================================================================
    // THE PERMISSION IS THE CONFIRMED OPERATION'S, AND THAT IS WHAT KEEPS THIS FROM BEING AN
    // ORACLE. `confirmation-v1` §whereItLIVES.
    // ===========================================================================================
    //
    // *"IT RUNS THE FULL AUTHORIZATION OF THE TARGET OPERATION... A caller who could not perform
    // the operation cannot obtain a challenge for it, and receives the identical refusal."*
    //
    // WITHOUT THIS THE CHALLENGE ENDPOINT WOULD BE A UNIVERSAL EXISTENCE ORACLE OVER EVERY CRITICAL
    // TARGET IN THE PLATFORM, reachable by anyone with any session — a strictly worse hole than the
    // one confirmation closes.
    //
    // NO NEW PERMISSION IS DECLARED. `permission-catalog.yaml` gains nothing from this route: a
    // `core.confirmation.request` held by everyone, checked on every call and deniable to nobody,
    // is the ceremony `organization-selection-v1` refused to invent and `platform-operator-v1`
    // refused again for `whoami`. THE CHALLENGE BORROWS THE PERMISSION OF THE THING IT CONFIRMS.
    permission: {
      kind: 'from-body' as const,
      resolve: (body: PreAuthBody) => {
        const actionId = body.action_id;
        // A NON-STRING OR UNKNOWN OPERATION RESOLVES TO NOTHING, and the dispatcher refuses with
        // `invalid_argument`. It does NOT fall back to a permission of its own — a fallback here
        // would authorize a caller for an operation it did not name.
        return typeof actionId === 'string' && confirmableOperations().includes(actionId)
          ? confirmablePermissionFor(actionId)
          : undefined;
      },
    },
    // `action_id` and `locale` are flat; `parameters` is the object field this whole extension
    // exists for. There is deliberately NO `principal_id` and NO `session_id`: both come from the
    // authenticated context, and `requestConfirmationInput` states why — *"an input that decides
    // its own binding is not an input, it is a grant."*
    fields: Object.freeze(['action_id', 'locale']),
    objectFields: Object.freeze(['parameters']),
    queryParameters: Object.freeze([]),
    // 201. `confirmation-v1:301`, READ RATHER THAN REASONED FROM. The first version of this line
    // said 200 and justified it — "a confirmation is created and the caller never names it as a
    // resource" — which is a plausible argument about a field the contract had already decided.
    // A challenge IS a created resource with an identifier the client echoes back.
    successStatus: 201 as const,
  }),
  // ===========================================================================================
  // ONBOARDING. `organization-onboarding-v1`, `docs/decisions/0026` decisions 1 and 2.
  //
  // THE ONLY OPERATION IN DUDO THAT BRINGS A TENANT INTO EXISTENCE, and the only route in this
  // class whose handler reaches a tenant store. See `onboarding/onboarding.ts` for P1 as amended.
  //
  // *** IT IS NOT CONFIRMATION-GATED, AND THAT IS A DECISION RATHER THAN AN OMISSION. ***
  // `0026` decision 1 reclassified `core.organization.create` from `critical` to `sensitive`
  // precisely so this route stays reachable in one request. `isConfirmationGated` derives the
  // requirement from the PERMISSION, so this needs no exception and gets none — and if the
  // permission is ever reclassified back, `assertConfirmationCoverageIsCoherent` stops the build
  // rather than letting the route become silently unreachable.
  //
  // THE CONTRACT'S OPERATION BLOCK STILL SAYS `sensitivity: critical` AND IS STALE. `ON-6` is
  // CLOSED in the same file and `permission-catalog.yaml` says `sensitive`. Reported to the Team
  // Lead; it cannot cause a defect here because nothing reads a declared sensitivity.
  // ===========================================================================================
  Object.freeze({
    id: 'platform.organizations.create' as const,
    method: 'POST' as const,
    // THE SAME PATH AS THE LIST, DIFFERENT METHOD. `matchPlatformRoute` matches on both.
    path: `${PLATFORM_BASE_PATH}/organizations`,
    permission: fixedPermission('core.organization.create'),
    // FOUR FIELDS, AND WHAT IS ABSENT IS THE POINT. NO `organization_id`, `principal_id` or
    // `workspace_id` — all server-generated, and a caller-chosen tenant identifier is the one
    // input that could collide a new Organization with an existing one's identifier space. NO
    // `role`, NO `permissions`, NO `memberships` — `0025` decision 4 bound 2, which `0025` names
    // as the bound most likely to erode. NO `password` — `0017`'s basis is that entropy protects
    // these accounts.
    //
    // A BODY SUPPLYING ANY OF THEM IS REFUSED WITH `invalid_argument` BY THE CLASS, before
    // authentication, because this list is the complete accepted set. That is bound 3's
    // structural assertion: there is no field through which an existing Organization could be
    // named, so the membership-write step cannot be reached with an identifier from anywhere but
    // this operation's own generator.
    fields: Object.freeze([
      'admin_identifier',
      'template_id',
      'first_workspace_name',
      'derived_value',
    ]),
    objectFields: Object.freeze([]),
    queryParameters: Object.freeze([]),
    // 201. `organization-onboarding-v1`'s `successStatus`, and it is 201 EVEN WITH A NON-EMPTY
    // `warnings` ARRAY — a step-7 failure is not a failed creation, and reporting it as one would
    // leave a customer that exists, cannot be entered, and needs a credential reset to rescue.
    successStatus: 201 as const,
  }),
  // ===========================================================================================
  // ORGANIZATION DETAIL AND THE MEMBER RESOLVE. `organization-detail-v1`, `docs/decisions/0028`.
  //
  // *** THERE IS NO `GET /organizations/{id}/members` AND ONE MUST NOT BE ADDED. ***
  //
  // `0028` Decision 1, and the reason is not that the read is unavailable — `organization_membership`
  // is a control-plane table and P1 does not stop it. **The transpose of the permitted read is the
  // forbidden one:** an operator can enumerate every Organization one screen away, so
  // per-Organization member lists invert into every principal's Organization list, which `CO1`
  // forbids by name. **Neither permission discloses it alone; the pair does, held by one principal,
  // with no rule broken at either step.**
  //
  // THE ABSENCE IS THE CONTROL, so it is asserted by enumerating this table rather than by trying
  // a URL — a route added later would pass a URL test that never ran.
  // ===========================================================================================
  Object.freeze({
    id: 'platform.organizations.read' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/organizations/{organization_id}`,
    // `core.organization.list`, NOT A NEW `core.organization.read-platform`. The catalog's
    // `core.organization.read` is declared `[organization]` and must stay there — it is a TENANT
    // principal reading its own record, and widening it to platform is the escalation AZ8 removed
    // from `marketplace-moderator`. A third permission would be deniable to nobody, because an
    // operator who cannot enumerate cannot reach a detail page at all.
    permission: fixedPermission(PLATFORM_ORGANIZATION_LIST_PERMISSION),
    fields: Object.freeze([]),
    objectFields: Object.freeze([]),
    // NONE. The identifier is in the path, and there is no `include=` — which is how a console
    // would acquire cross-tenant reach in one query parameter.
    queryParameters: Object.freeze([]),
    successStatus: 200 as const,
  }),
  Object.freeze({
    id: 'platform.organizations.members.resolve' as const,
    method: 'POST' as const,
    path: `${PLATFORM_BASE_PATH}/organizations/{organization_id}/members/resolve`,
    // ===========================================================================================
    // *** IT DECLARES `core.credential.reset`, NOT `core.organization.list`, AND THAT IS THE POINT.
    // ===========================================================================================
    //
    // `0028` Decision 2: *"a principal who may not reset a credential may not resolve a principal."*
    // The only legitimate use of this route is to obtain a `principal_id` for a reset, so binding
    // it to that permission means **revoking `core.credential.reset` revokes the ability to resolve
    // people** — one grant, one capability, withdrawn together — and **a Templates-only role cannot
    // accumulate the `CO1` aggregation this class refuses.**
    //
    // It is the same device the confirmation challenge uses: a caller cannot obtain a step toward
    // something it may not do.
    permission: fixedPermission('core.credential.reset'),
    // ONE FIELD. The identifier the operator was given. THERE IS NO `principal_id` — that is what
    // this route produces, not what it takes — and no `role`, no `status`, no `q`.
    fields: Object.freeze(['identifier']),
    objectFields: Object.freeze([]),
    queryParameters: Object.freeze([]),
    successStatus: 200 as const,
  }),
  // ===========================================================================================
  // TEMPLATES. `template-v1`, `docs/decisions/0025` decision 2.
  //
  // THREE PERMISSIONS, NOT ONE, AND THE SEPARATION IS TESTED: a platform operator holding
  // `core.template.list` but not `core.template.create` gets 200 on list and `forbidden` on
  // create. `list` is separate from `read` because enumeration is its own disclosure.
  // ===========================================================================================
  Object.freeze({
    id: 'platform.templates.create' as const,
    method: 'POST' as const,
    path: `${PLATFORM_BASE_PATH}/templates`,
    permission: fixedPermission('core.template.create'),
    // `name` is flat; `level_labels` is the declared object field. THERE IS NO `template_id`:
    // the operator does not choose it. A client-chosen identifier would make Templates guessable
    // and would put a naming decision in an operator's hands on a permanent, referenced key.
    // AND THERE IS NO `status`: no route sets it in version 1 (TM-2).
    fields: Object.freeze(['name']),
    objectFields: Object.freeze(['level_labels']),
    queryParameters: Object.freeze([]),
    // 201. `template-v1:230`. This line said 200 and claimed the contract as its authority
    // without the contract having been opened — the divergence `admin-shell` found from the
    // client side, which is where a status mismatch surfaces.
    successStatus: 201 as const,
  }),
  Object.freeze({
    id: 'platform.templates.list' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/templates`,
    permission: fixedPermission('core.template.list'),
    fields: Object.freeze([]),
    objectFields: Object.freeze([]),
    queryParameters: Object.freeze(['page_size', 'cursor']),
    successStatus: 200 as const,
  }),
  Object.freeze({
    id: 'platform.templates.read' as const,
    method: 'GET' as const,
    // THE FIRST ROUTE IN THIS CLASS WITH A PATH PARAMETER. See `matchPlatformRoute`: single
    // segment, validated against the platform identifier grammar before any lookup.
    path: `${PLATFORM_BASE_PATH}/templates/{template_id}`,
    permission: fixedPermission('core.template.read'),
    fields: Object.freeze([]),
    objectFields: Object.freeze([]),
    // NONE, so any query string at all is refused. The identifier is in the path.
    queryParameters: Object.freeze([]),
    successStatus: 200 as const,
  }),
]);

export class PlatformConfirmationCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformConfirmationCoverageError';
  }
}

/**
 * ===========================================================================================
 * WHICH PLATFORM ROUTES THE CONFIRMATION GATE APPLIES TO, DECIDED HERE AND CHECKED AT LOAD.
 * `docs/decisions/0027` · `confirmation-v1` §whereItLIVES.
 * ===========================================================================================
 *
 * A ROUTE IS GATED WHEN A CONFIRMATION FOR IT CAN EXIST — when its id is a confirmable operation.
 * **The route declares nothing.** There is no field, flag or opt-out on `PlatformRoute`, and the
 * decision is made in `critical-permissions.ts`, which no App can edit.
 *
 * ===========================================================================================
 * *** THE RULE WAS "FIXED PERMISSION + CRITICAL" AND IT WAS WRONG. CORRECTED 2026-09-05. ***
 * ===========================================================================================
 *
 * It gated a route when the catalog called its permission `critical`, exempting only the
 * `from-body` kind — the challenge route — on the ground that a borrowed permission is not the
 * route's own effect. **The reasoning was right and the implementation of it was too narrow:
 * borrowing is not a property of the `from-body` kind.**
 *
 * `platform.organizations.members.resolve` is a `fixed` route declaring `core.credential.reset`,
 * and it **performs no reset.** `0028` Decision 2 binds it to that permission so that *"revoking
 * the reset grant revokes the ability to resolve people"* — the same narrowing device the challenge
 * route uses, expressed with a different kind. **The old rule gated it**, and the load-time
 * assertion caught that the moment the route was added: a confirmation it could never obtain, for
 * a lookup, whose own contract forbids the fields a confirmation needs.
 *
 * IT WOULD ALSO HAVE BEEN CIRCULAR. The only route producing a `principal_id` for a reset is that
 * resolve, so a gated resolve means confirming a lookup in order to be allowed to confirm the
 * operation the lookup exists for.
 *
 * **THE GUARD FOUND THIS, NOT A REVIEWER AND NOT A TEST.** It refused to load. That is the whole
 * argument for asserting a rule at module load rather than documenting it.
 *
 * ===========================================================================================
 * FIVE PROPERTIES, EACH CLOSING A WAY THIS COULD FAIL SILENTLY
 * ===========================================================================================
 *
 *   1. A GATED ROUTE MUST BE A CONFIRMABLE OPERATION. Otherwise it demands a confirmation that
 *      nothing can issue — unreachable rather than unprotected, but unreachable in a way that
 *      presents as a permissions bug at 2am. A build failure says which half is missing.
 *
 *   2. A GATED ROUTE MUST DECLARE THE THREE CONFIRMATION FIELDS. They arrive on the body, and
 *      this class refuses undeclared fields BEFORE the gate runs — so a route that omitted them
 *      would refuse every correctly confirmed request with `invalid_argument` at validation and
 *      never reach the gate at all. `qa-agent` found exactly this obligation on the Action side,
 *      where it is unstated and left to each author's memory; here it is a build failure.
 *
 *   3. A GATED ROUTE MAY DECLARE NO OBJECT FIELDS, and 4. NO QUERY PARAMETERS, and 5. NO PATH
 *      PARAMETERS. *** THESE THREE ARE THE ESCALATION, NOT HOUSEKEEPING. *** The binding covers
 *      the BODY parameters. Anything the route accepts from outside the body is outside the
 *      binding, so a caller could obtain a confirmation for one target and spend it on another —
 *      the human confirms `identifier=alice`, the request carries `?identifier=root`, and the
 *      confirmation verifies. `splitObjectFields` lifts declared objects out before the body the
 *      gate sees, which is the same hole wearing a different shape.
 *
 * WHY NOT SIMPLY INCLUDE THEM IN THE BINDING: because `canonicalizeParameters` defines the bound
 * value as a flat map of strings, booleans and nulls, and the client computes the same map. Two
 * definitions of "the parameters" is a binding that covers different things at the two ends,
 * which is `splitConfirmedRequest`'s whole argument. Refusing the shape is the honest fix.
 */
export function isConfirmationGated(route: PlatformRoute): boolean {
  return confirmableOperations().includes(route.id);
}

/**
 * Runs at module load, beside `assertCriticalSetIsCoherent` and for the same reason: a route table
 * that had drifted would do it silently, and this drift presents as an irreversible operation that
 * stopped asking.
 *
 * THE PARAMETER EXISTS SO THE THROW BRANCHES CAN BE REACHED FROM A TEST and defaults to the
 * shipped table — `qa-agent` correctly will not edit `platform/core/**` to reach a branch.
 */
export function assertConfirmationCoverageIsCoherent(
  routes: readonly PlatformRoute[] = ROUTES,
  confirmable: readonly string[] = confirmableOperations(),
): void {
  let fromBodyRoutes = 0;
  for (const route of routes) {
    if (route.permission.kind === 'from-body') {
      fromBodyRoutes += 1;
      // A CHALLENGE ROUTE MAY NOT ALSO BE A CONFIRMED OPERATION. It is exempt from the gate, so
      // listing it as confirmable would produce an operation that can be confirmed and is never
      // checked — the exemption turned into a bypass.
      if (confirmable.includes(route.id)) {
        throw new PlatformConfirmationCoverageError(
          `'${route.id}' resolves its permission from the body AND is a confirmable operation. ` +
            'A route exempt from the gate must not be something a confirmation can be issued ' +
            'for, or the exemption becomes a way to perform a critical operation unconfirmed.',
        );
      }
      // ONE `from-body` ROUTE, AND A SECOND IS A DECISION RATHER THAN AN EDIT. The kind is the
      // gate's only exemption, so a route table free to add more is a table where the exemption
      // spreads by convenience. The discipline `0021` imposed on its class of two.
      if (fromBodyRoutes > 1) {
        throw new PlatformConfirmationCoverageError(
          `More than one platform route resolves its permission from the body ('${route.id}' is ` +
            'the second). That kind is the confirmation gate\'s only exemption and exists for the ' +
            'challenge route, whose own effect is not critical. A second one needs its own ' +
            'argument and a decision record, not a table entry.',
        );
      }
      continue;
    }
    // =========================================================================================
    // ---- THE COMPLETENESS CHECK, AND IT IS THE HALF THAT KEEPS THIS FAIL-CLOSED.
    // =========================================================================================
    //
    // The gate now triggers on membership in `confirmableOperations()`, which is precise and has
    // no false positives — and **on its own it would fail OPEN**: a genuinely critical route whose
    // author forgot to register it would simply not be gated, silently.
    //
    // SO THE CHECK RUNS THE OTHER WAY ROUND. Every route declaring a critical permission must be
    // **either** confirmable **or** explicitly listed as borrowing it without performing it. There
    // is no third state, and forgetting stops the build.
    //
    // THE EXEMPTION LIST IS CORE-OWNED AND LIVES BESIDE THE CONFIRMABLE SET, so a reviewer reads
    // both together. It is not a per-route flag — `0027` forbids an operation declaring whether it
    // needs confirming, and a `skipsConfirmation: true` on `PlatformRoute` would be exactly that.
    if (route.permission.kind === 'fixed' && requiresConfirmation(route.permission.permissionId)) {
      if (
        !confirmable.includes(route.id) &&
        !borrowsCriticalPermissionWithoutPerforming(route.id)
      ) {
        throw new PlatformConfirmationCoverageError(
          `'${route.id}' declares the critical permission '${route.permission.permissionId}' and ` +
            'is neither a confirmable operation nor listed as borrowing that permission without ' +
            'performing it. One of the two must be true and the choice is a decision: if the ' +
            'route PERFORMS the operation, add it to CONFIRMABLE_PLATFORM_OPERATIONS with a ' +
            'statement; if it merely authorizes against the permission to narrow who may call it, ' +
            'add it to BORROWS_WITHOUT_PERFORMING with the reason. Both are in ' +
            'critical-permissions.ts.',
        );
      }
    }

    if (!isConfirmationGated(route)) {
      continue;
    }
    for (const field of [
      CONFIRMATION_ID_FIELD,
      REAUTH_DERIVED_VALUE_FIELD,
      REAUTH_IDENTIFIER_FIELD,
    ]) {
      if (!route.fields.includes(field)) {
        throw new PlatformConfirmationCoverageError(
          `'${route.id}' requires a confirmation and does not declare the body field '${field}'. ` +
            'This class refuses undeclared fields before the gate runs, so every correctly ' +
            'confirmed request would be refused at validation and the gate would never be ' +
            'reached.',
        );
      }
    }
    if (route.objectFields.length > 0) {
      throw new PlatformConfirmationCoverageError(
        `'${route.id}' requires a confirmation and declares object fields ` +
          `(${route.objectFields.join(', ')}). Object fields are lifted out before the body the ` +
          'gate binds over, so they would be outside the confirmation — a human could confirm ' +
          'one target and the request act on another.',
      );
    }
    if (route.queryParameters.length > 0) {
      throw new PlatformConfirmationCoverageError(
        `'${route.id}' requires a confirmation and declares query parameters ` +
          `(${route.queryParameters.join(', ')}). The binding covers the body only, so a query ` +
          'parameter is an input the human never confirmed.',
      );
    }
    if (route.path.includes('{')) {
      throw new PlatformConfirmationCoverageError(
        `'${route.id}' requires a confirmation and takes a path parameter ('${route.path}'). The ` +
          'binding covers the body only, so the confirmed target and the acted-on target would ' +
          'be different values.',
      );
    }
  }
}

assertConfirmationCoverageIsCoherent();

/**
 * Matches an ABSOLUTE path and method. Exact match only, no path parameters and no patterns.
 *
 * A MISMATCHED METHOD RETURNS `undefined` AND THEREFORE 404, NOT 405. A 405 confirms the path
 * exists, which on a host where these routes should not appear at all is exactly the disclosure
 * the host binding exists to prevent.
 */
export type PlatformRouteMatch = {
  readonly route: PlatformRoute;
  /** Declared `{name}` segments, extracted. Empty for a route with none. */
  readonly pathParams: Readonly<Record<string, string>>;
};

/**
 * ===========================================================================================
 * SINGLE-SEGMENT PATH PARAMETERS. THE FOURTH EXTENSION TO THIS CLASS, AND DELIBERATELY THE
 * SMALLEST ONE THAT SERVES `GET /templates/{template_id}`.
 * ===========================================================================================
 *
 * THE CLASS HAD NONE, AND THE REASON IT HAD NONE DOES NOT TRANSFER. `pre-auth-registry.ts`
 * refuses path parameters because *"a pre-auth route has no authenticated context in which to
 * interpret a path segment, so a `{token}` would be an unauthenticated caller-supplied string
 * reaching a lookup through the URL — the shape that ends up in access logs, in referrers and in
 * browser history."* **A platform route is authenticated, authority-resolved, authorized and
 * audited before any handler runs**, so every clause of that argument is absent here.
 *
 * WHAT IS PERMITTED IS EXACTLY ONE THING: a whole segment written `{name}`. **No wildcards, no
 * optional segments, no regex, no multi-segment captures, and no parameter in the final position
 * that could swallow a trailing path.** A matcher that can express more is a matcher whose
 * behaviour on an unusual URL has to be reasoned about rather than read.
 *
 * *** THE EXTRACTED VALUE IS VALIDATED BEFORE ANY LOOKUP. *** It must match
 * `^[A-Za-z0-9_-]{8,64}$` — the platform identifier grammar `readIdentifierField` already uses —
 * and a value that could not possibly be an identifier is refused with `not_found` costing no
 * database read. `not_found` RATHER THAN `invalid_argument`, because on a route whose whole
 * purpose is to fetch one record by identifier, distinguishing "malformed" from "no such record"
 * tells a caller which identifiers are well-formed. Here that is harmless — Templates are
 * enumerable — but the matcher serves the whole class, and the next route with a path parameter
 * may not be.
 */
export function matchPlatformRoute(method: string, path: string): PlatformRouteMatch | undefined {
  const requested = normalizePath(path).split('/').filter((segment) => segment.length > 0);
  for (const route of ROUTES) {
    if (route.method !== method) {
      continue;
    }
    const pattern = route.path.split('/').filter((segment) => segment.length > 0);
    if (pattern.length !== requested.length) {
      continue;
    }
    const pathParams: Record<string, string> = Object.create(null);
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index];
      const actual = requested[index];
      if (expected.startsWith('{') && expected.endsWith('}')) {
        // DECODED ONCE, THEN VALIDATED. Decoding after the grammar check would let `%2E%2E` pass a
        // check it should have failed; decoding twice would let a doubly-encoded value slip
        // through one of them.
        let decoded: string;
        try {
          decoded = decodeURIComponent(actual);
        } catch {
          matched = false;
          break;
        }
        if (!IDENTIFIER_PATTERN.test(decoded)) {
          matched = false;
          break;
        }
        pathParams[expected.slice(1, -1)] = decoded;
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route, pathParams: Object.freeze(pathParams) };
    }
  }
  return undefined;
}

/**
 * The platform identifier grammar — `^[A-Za-z0-9_-]{8,64}$`, the same one `kernel/ids.ts`
 * generates at 22 characters and `session-routes.ts` validates a tenant hint against.
 *
 * IT ADMITS NO `/`, NO `.` AND NO `%`, which is what makes a path parameter incapable of carrying
 * a traversal, a second segment, or an encoded delimiter into a lookup.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Collapses `//a//b/` to `/a/b`, so a reservation cannot be stepped around with a slash. */
function normalizePath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function platformRoutes(): readonly PlatformRoute[] {
  return ROUTES;
}

// =============================================================================================
// The host binding. `docs/decisions/0022` as amended 2026-09-05.
// =============================================================================================

/**
 * ===========================================================================================
 * THE PLATFORM ROUTE BLOCK IS MOUNTED ONLY ON THE ADMIN HOST — AND IT IS DEFENCE IN DEPTH.
 * ===========================================================================================
 *
 * `0022` was amended while the contract was being written: admin is a SECOND WORKER,
 * `dudo-admin`, forced by a hard Cloudflare limit — "only one collection of static assets can be
 * configured in each Worker" — and it serves its own API on its own origin with THE SAME `main`,
 * the same D1 bindings and the same secrets as `app.dudo.work`.
 *
 * SAME `main` MEANS THE SAME ROUTE TABLE IS PRESENT IN BOTH WORKERS. Without this check,
 * `/api/v1/platform/**` would be mounted and reachable on `app.dudo.work` as well — where every
 * tenant user already has a session. It would still be REFUSED, because authorization runs on the
 * `platform_operator` row and not on the hostname, so it is not a hole. BUT IT IS AN UNNECESSARY
 * SURFACE that exists purely as a side effect of a deployment decision taken for an unrelated
 * reason.
 *
 * A REQUEST ON THE WRONG HOST ANSWERS 404, NOT 403, and the difference matters: answering 403
 * would confirm the route exists on a host where it should not appear to. This is the same choice
 * `organization-selection-v1` makes when it requires GET on the singular path to be 404 rather
 * than 405.
 *
 * *** THE AUTHORIZATION CHECK IS THE CONTROL; THE HOST BINDING IS A SECOND LAYER, AND IT MUST
 * NEVER BECOME THE FIRST. *** An implementation that bound the host and skipped the
 * `platform_operator` check would be relying on ROUTING for AUTHORIZATION, which is the "UI
 * hiding is presentation, never security" error moved down a layer. Both, or the host binding is
 * worse than useless because it invites the omission.
 *
 * AN EMPTY LIST MATCHES NOTHING AND EVERY PLATFORM ROUTE ANSWERS 404. That is the fail-closed
 * direction and it is why there is no default: a composition root has to state the hosts, and a
 * reviewer can see which ones it stated.
 */
export function isPlatformHost(adminHosts: readonly string[], hostname: string): boolean {
  // `URL.hostname` is already lowercase and carries no port. Lowercasing both sides anyway costs
  // nothing and removes a dependency on that being true of whatever produces the argument.
  const requested = hostname.toLowerCase();
  return adminHosts.some((host) => host.toLowerCase() === requested);
}

// =============================================================================================
// What a handler receives and returns
// =============================================================================================

/**
 * What a platform route handler is given.
 *
 * `authority` IS A RESOLVED `PlatformAuthority` — a principal identifier, a recognised platform
 * role, and a frozen grant set. IT IS NOT AN `AuthenticatedPrincipal` and carries no
 * `organizationId`, so there is no value here from which a tenant store could be resolved even by
 * a handler that wanted one.
 *
 * `query` IS ALREADY VALIDATED: every key in it is one the route declared, no key appears twice,
 * and the whole string was length-bounded. A handler still has to interpret the VALUES, which is
 * what `readPageSize` and `readCursorParameter` below are for.
 */
export type PlatformRouteContext = {
  readonly routeId: PlatformRouteId;
  readonly authority: PlatformAuthority;
  readonly query: ReadonlyMap<string, string>;
  /**
   * The route's declared object fields, already validated as flat primitive maps. Empty for every
   * route that declares none.
   *
   * A HANDLER CANNOT REACH AN UNDECLARED OBJECT, because only declared keys are lifted here.
   */
  readonly objects: Readonly<Record<string, PlatformObjectField>>;
  /**
   * Declared `{name}` path segments, already validated against the platform identifier grammar.
   *
   * A HANDLER RECEIVES ONLY DECLARED SEGMENTS. There is no way for an undeclared one to appear,
   * because the matcher extracts by pattern rather than by parsing whatever the URL contained.
   */
  readonly pathParams: Readonly<Record<string, string>>;
  /**
   * The session this request arrived on. Server-derived from a verified credential.
   *
   * IT IS HERE FOR THE CONFIRMATION BINDING AND FOR NOTHING ELSE — a confirmation is bound to the
   * session so that one obtained on one device is not spendable on another, and dies with the
   * session at revocation. No handler may use it as an identifier for anything else, and none does.
   */
  readonly sessionId: string;
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * What a handler answers with.
 *
 * `target` IS REQUIRED, AND REQUIRING IT IS HOW P4 STAYS TRUE. The audit record has to name what
 * the operation touched, and a handler that could omit it would produce an unattributable log
 * line. `NO_TARGET` is the explicit value for an operation that names nothing — both routes in
 * this slice use it, because an enumeration has no single affected target and `whoami` describes
 * only the caller.
 *
 * THE VALUE IS RENDERED BY THE TRANSPORT AND THE HANDLER CHOOSES NO STATUS CODE, no headers and
 * no cookie. A platform route cannot issue, clear or rotate a session credential — the shape of
 * this type is what makes that structural rather than documented.
 */
export type PlatformRouteOutcome = {
  readonly body: unknown;
  readonly target: PlatformActionTarget;
};

export type PlatformRouteHandler = (
  context: PlatformRouteContext,
  body: PreAuthBody,
) => Promise<Result<PlatformRouteOutcome>>;

export type PlatformRouteHandlers = Partial<
  Readonly<Record<PlatformRouteId, PlatformRouteHandler>>
>;

export type PlatformRouteDependencies = {
  readonly handlers: PlatformRouteHandlers;
  /**
   * Reads the session credential. THE SAME PORT THE AUTHENTICATED PATH AND THE SESSION ROUTE
   * CLASS USE, deliberately: one credential, one verifier, one set of carrier rules. A platform
   * route accepting a credential the ordinary path would reject — or the reverse — would be two
   * authentication schemes wearing one name, and this class is the one where that would matter
   * most.
   */
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
  /**
   * Turns a verified session identifier into a principal identifier AND NOTHING ELSE.
   *
   * It returns a string rather than a principal object on purpose: there is no organization, no
   * membership list and no grant set in the return value, so this seam cannot carry a tenant
   * identifier into the class. `identity/composition.ts` implements it over
   * `SessionResolver.resolvePrincipalId`, which is steps 1 and 2 of `0014` §C.5's resolution
   * order and stops there.
   */
  readonly authenticatePrincipal: (sessionId: string) => Promise<Result<string>>;
  readonly authority: PlatformAuthorityResolver;
  readonly authorizer: Authorizer;
  readonly audit: PlatformAuditRecorder;
  /**
   * The confirmation gate. THE SAME ONE THE ACTION PIPELINE USES, not a second implementation.
   *
   * ===========================================================================================
   * OPTIONAL IN THE TYPE, AND **ABSENT MEANS REFUSED** RATHER THAN ABSENT MEANS OPEN.
   * ===========================================================================================
   *
   * It is optional for the reason `pipeline.ts` gives — a required field would force every
   * verification harness to compose a real gate to exercise a non-critical route — and it is
   * checked at the one place it matters: a gated route with no composed gate answers
   * `unavailable`. There is no `gate ?? allowEverything()` here, and a default would mean the top
   * rung of the sensitivity ladder is optional per deployment.
   *
   * NON-CRITICAL ROUTES ARE UNAFFECTED whether this is composed or not. See `isConfirmationGated`.
   */
  readonly confirmations?: ConfirmationGate;
  /**
   * The hostnames on which this class is served. See `isPlatformHost`. Required, no default, and
   * an empty list means unreachable.
   */
  readonly adminHosts: readonly string[];
};

export type PlatformRouteRequest = {
  /** Declared `{name}` segments, validated by `matchPlatformRoute`. Empty for most routes. */
  readonly pathParams: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly headers: ReadonlyMap<string, string>;
  /** The raw query string, without the leading `?`. */
  readonly queryString: string;
  readonly requestId: string;
  readonly correlationId: string;
};

// =============================================================================================
// The class's validation floor
// =============================================================================================

/**
 * The longest query string this class will look at.
 *
 * A BOUND ON THE INPUT BEFORE IT IS PARSED, which is what `parsePreAuthBody`'s 4 KiB does for the
 * body. Two declared parameters at their own maxima — a three-digit `page_size` and a 512-
 * character cursor — is well under 600 characters, so 1 KiB is generous and still refuses a
 * megabyte of query string before `URLSearchParams` allocates anything.
 */
export const PLATFORM_MAX_QUERY_STRING_LENGTH = 1024;

/** 1 to 100, default 25. The contract's numbers for `platform.organizations.list`. */
export const PLATFORM_MIN_PAGE_SIZE = 1;
export const PLATFORM_MAX_PAGE_SIZE = 100;
export const PLATFORM_DEFAULT_PAGE_SIZE = 25;

/**
 * Parses and validates the query string against the route's declared set.
 *
 * THREE REFUSALS, AND EACH ONE CLOSES SOMETHING:
 *
 *   1. A ROUTE THAT DECLARES NO PARAMETERS REFUSES ANY QUERY STRING AT ALL. Not "filters unknown
 *      keys" — refuses. `0021`: refusing the whole query string rather than unknown keys means a
 *      future route cannot acquire one by accident.
 *   2. AN UNDECLARED PARAMETER IS `invalid_argument`, never ignored. An ignored parameter is one
 *      edit from being read.
 *   3. A REPEATED PARAMETER IS `invalid_argument`, never first-wins or last-wins. `http/api.ts`
 *      already refuses these on the Action path for the reason restated here: a precedence rule
 *      is a way for a caller to shadow a value a reviewer assumed was authoritative.
 */
function parseQuery(
  route: PlatformRoute,
  queryString: string,
): Result<ReadonlyMap<string, string>> {
  if (queryString.length === 0) {
    return ok(new Map());
  }
  if (route.queryParameters.length === 0) {
    return err(invalidArgument([detail('', 'unexpected_query_parameter')]));
  }
  if (queryString.length > PLATFORM_MAX_QUERY_STRING_LENGTH) {
    return err(invalidArgument([detail('', 'query_string_too_large')]));
  }
  const declared = new Set(route.queryParameters);
  const parsed = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(queryString).entries()) {
    if (!declared.has(key)) {
      // The PARAMETER NAME and a stable token. Never the value — `detail()` has no parameter for
      // one, and echoing a rejected identifier would put it in logs and error bodies.
      return err(invalidArgument([detail(key, 'unknown_parameter')]));
    }
    if (parsed.has(key)) {
      return err(invalidArgument([detail(key, 'repeated_parameter')]));
    }
    parsed.set(key, value);
  }
  return ok(parsed);
}

/** A validated object field: flat, primitive, bounded. Never nested. */
export type PlatformObjectField = Readonly<Record<string, string | boolean | null>>;

/** The most keys one declared object field may carry. `PRE_AUTH_MAX_FIELDS`'s twelve, matched. */
export const PLATFORM_MAX_OBJECT_FIELD_KEYS = 12;

/**
 * Lifts the route's declared object fields out of the body and returns the flat remainder.
 *
 * ===========================================================================================
 * THE EXTENSION IS CONFINED TO ROUTES THAT ASK FOR IT.
 * ===========================================================================================
 *
 * A route declaring no object fields RETURNS THE ORIGINAL BODY TEXT UNTOUCHED, so
 * `parsePreAuthBody` sees exactly the bytes it saw before this function existed. That is what lets
 * the shared floor stay shared: the pre-authentication registry, the session route class and every
 * platform route without an object field are all still validated by one implementation.
 *
 * AN OBJECT FIELD IS VALIDATED, NOT WAVED THROUGH — a flat map of primitives, bounded in count and
 * in length, with no nesting of its own. P2 is that no platform route is the one route without
 * validation, and a declared object that nobody checked would be exactly that route.
 *
 * NUMBERS ARE REFUSED HERE TOO, matching `canonicalizeParameters`. The reason there is that `1`,
 * `1.0` and `1e0` are one JSON number and three byte strings, so a number in a binding hash fails
 * across clients; refusing at both layers means a caller is told at the boundary rather than
 * deeper in, and the two layers cannot disagree about what is acceptable.
 */
function splitObjectFields(
  route: PlatformRoute,
  bodyText: string,
): Result<{ readonly flatBodyText: string; readonly objects: Readonly<Record<string, PlatformObjectField>> }> {
  if (route.objectFields.length === 0) {
    return ok({ flatBodyText: bodyText, objects: Object.freeze({}) });
  }
  if (bodyText.length === 0) {
    return ok({ flatBodyText: bodyText, objects: Object.freeze({}) });
  }
  // The 4 KiB ceiling is applied to the WHOLE body before anything is parsed, so a route with an
  // object field is not a way to send a larger request than any other route in the class.
  if (new TextEncoder().encode(bodyText).length > PRE_AUTH_MAX_BODY_BYTES) {
    return err(invalidArgument([detail('', 'body_too_large')]));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return err(invalidArgument([detail('', 'must_be_valid_json')]));
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(invalidArgument([detail('', 'must_be_an_object')]));
  }

  const declared = new Set(route.objectFields);
  const objects: Record<string, PlatformObjectField> = Object.create(null);
  const flat: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!declared.has(key)) {
      // Left for `parsePreAuthBody`, which refuses an undeclared name with `unknown_field` and is
      // the single place that decision is made.
      flat[key] = value;
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return err(invalidArgument([detail(key, 'must_be_an_object')]));
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > PLATFORM_MAX_OBJECT_FIELD_KEYS) {
      return err(invalidArgument([detail(key, 'too_many_fields')]));
    }
    const contents: Record<string, string | boolean | null> = Object.create(null);
    for (const [innerKey, innerValue] of entries) {
      if (innerKey.length === 0 || innerKey.length > PRE_AUTH_MAX_FIELD_LENGTH) {
        return err(invalidArgument([detail(`${key}.${innerKey}`, 'invalid_parameter_name')]));
      }
      if (innerValue === null || typeof innerValue === 'boolean') {
        contents[innerKey] = innerValue;
        continue;
      }
      if (typeof innerValue === 'string') {
        if (innerValue.length > PRE_AUTH_MAX_FIELD_LENGTH) {
          return err(invalidArgument([detail(`${key}.${innerKey}`, 'too_long')]));
        }
        contents[innerKey] = innerValue;
        continue;
      }
      // A NUMBER, a nested object or an array. NO SECOND LEVEL OF NESTING — the whole reason this
      // extension is narrow is that arbitrary nesting is what `parsePreAuthBody` refuses, and
      // admitting it one level down would reintroduce it with an extra step.
      return err(
        invalidArgument([detail(`${key}.${innerKey}`, 'must_be_a_string_boolean_or_null')]),
      );
    }
    objects[key] = Object.freeze(contents);
  }
  return ok({ flatBodyText: JSON.stringify(flat), objects: Object.freeze(objects) });
}

/**
 * Reads `page_size`: an integer between 1 and 100, defaulting to 25.
 *
 * STRICTLY PARSED, NOT COERCED. `Number('25abc')` is `NaN` and `parseInt('25abc')` is 25 — the
 * second is how a malformed value becomes a plausible one. The pattern below admits digits and
 * nothing else, so `+25`, ` 25`, `25.0`, `2e1` and `0x19` are all refused rather than
 * reinterpreted.
 *
 * THE UPPER BOUND IS ENFORCED RATHER THAN CLAMPED. Clamping 1000 to 100 silently answers a
 * different question from the one asked, and a client paging on the assumption it got 1000 rows
 * would skip records without any error to notice.
 */
export function readPageSize(query: ReadonlyMap<string, string>): Result<number> {
  const raw = query.get('page_size');
  if (raw === undefined) {
    return ok(PLATFORM_DEFAULT_PAGE_SIZE);
  }
  if (!/^[0-9]{1,3}$/.test(raw)) {
    return err(invalidArgument([detail('page_size', 'must_be_an_integer')]));
  }
  const value = Number(raw);
  if (value < PLATFORM_MIN_PAGE_SIZE || value > PLATFORM_MAX_PAGE_SIZE) {
    return err(invalidArgument([detail('page_size', 'out_of_range')]));
  }
  return ok(value);
}

/**
 * Reads `cursor`, or `null`.
 *
 * IT IS ONLY A LENGTH AND ALPHABET CHECK. Passing it proves nothing: the cursor's signature is
 * verified by `platform-cursor.ts`, which is where the single rejection value lives. This refuses
 * a value that could not possibly be a cursor BEFORE any HMAC is computed, so junk costs a 400
 * and no crypto.
 *
 * AN EMPTY `?cursor=` IS REFUSED RATHER THAN TREATED AS ABSENT. "Present but empty" and "absent"
 * are different requests, and collapsing them is how a client that failed to store a cursor
 * silently restarts an enumeration from the beginning.
 */
export function readCursorParameter(query: ReadonlyMap<string, string>): Result<string | null> {
  const raw = query.get('cursor');
  if (raw === undefined) {
    return ok(null);
  }
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) {
    return err(invalidArgument([detail('cursor', 'invalid_cursor')]));
  }
  return ok(raw);
}

// =============================================================================================
// Dispatch — the order IS the security property
// =============================================================================================

/**
 * ===========================================================================================
 * THE ORDER, AND WHY EACH STEP IS WHERE IT IS.
 * ===========================================================================================
 *
 *   1. VALIDATE THE QUERY STRING, then 2. VALIDATE THE BODY. Before authentication, because a
 *      malformed request must not reach credential verification and because the answer to a
 *      malformed request must not depend on whether the caller is authenticated. This is P2, and
 *      it is here rather than in the handlers so a fifth route cannot forget it.
 *   3. AUTHENTICATE THE SESSION, then resolve it to a principal identifier. One argument-free
 *      `unauthenticated()` for no credential, an unreadable one, an expired session, a deleted
 *      principal and a suspended principal.
 *   4. RESOLVE PLATFORM AUTHORITY. Three of the contract's four denial causes are decided here —
 *      no operator row, an unrecognised `platform_role`, and a principal present in BOTH tables —
 *      and all three answer the identical argument-free `forbidden()`. NONE of them writes an
 *      audit record. See `platform-audit.ts` for why that bound is load-bearing rather than
 *      convenient. The fourth cause, a role that does not carry the permission, is step 5.
 *   5. AUTHORIZE. `authorize()` unchanged, with Core's platform envelope as the ceiling and the
 *      operator's role grants as the floor. A denial here IS audited, with `outcome: 'denied'` —
 *      the caller is a real operator and an operator probing routes it cannot use is exactly what
 *      the trail exists to show.
 *   5b. THE CONFIRMATION GATE, for a route whose permission is `critical`. The same gate the
 *      Action pipeline uses, because `confirmation-v1` says EVERY entry point and the pipeline is
 *      one class of four. Absent means refused. See the step for why it is after authorization
 *      and before the handler, and for what this class lacks that the pipeline has.
 *   6. RUN THE HANDLER.
 *   7. WRITE THE AUDIT RECORD, AND FAIL THE REQUEST IF IT CANNOT BE WRITTEN. P4 and `0013` D2:
 *      the audit event must not fail open, and inability to record the evidence is not a reason
 *      to proceed without it.
 *
 * ===========================================================================================
 * ONE RESIDUAL DISTINCTION, NAMED RATHER THAN LEFT TO BE FOUND
 * ===========================================================================================
 *
 * A caller refused at step 4 always receives `forbidden`. A caller refused at step 5 receives
 * `forbidden` normally and `unavailable` when the denial record cannot be written. So during a
 * control-plane write failure — or after an operator has spent its own daily write budget — the
 * two steps become distinguishable, which tells the caller whether it holds a `platform_operator`
 * row.
 *
 * IT IS ACCEPTED, AND THE REASON IT IS SAFE IS THAT THE STATE IS UNREACHABLE FOR THE CALLER WHO
 * WOULD LEARN SOMETHING. The budget counter is keyed by a VERIFIED principal and is only ever
 * charged for a caller that already passed step 4, so a non-operator can never reach the deferred
 * branch; and a database write failure refuses every operator operation anyway. The alternative —
 * answering `forbidden` and dropping the record — is the audit event failing open, which is the
 * worse of the two. Reported rather than smoothed over.
 */
export async function dispatchPlatformRoute(
  dependencies: PlatformRouteDependencies,
  route: PlatformRoute,
  request: PlatformRouteRequest,
): Promise<Result<unknown>> {
  // ---- 1. The query string, against the route's declared parameters.
  const query = parseQuery(route, request.queryString);
  if (!query.ok) {
    return err(query.error);
  }

  // ---- 2. The body floor, against the route's declared fields.
  //
  // REUSING `parsePreAuthBody` IS DELIBERATE, and it is the same argument `session-routes.ts`
  // makes: two validation floors that were meant to be identical are two floors that will differ.
  // 4 KiB, 12 fields, 512 characters, no nesting, no undeclared names — one implementation,
  // three request classes.
  //
  // A ROUTE THAT DECLARES OBJECT FIELDS TAKES A DIFFERENT PATH, AND THE ONE THAT DOES NOT IS
  // UNCHANGED BYTE FOR BYTE. `splitObjectFields` lifts the declared objects out and hands the flat
  // remainder to exactly the call above, so the two routes that existed before this change are
  // validated by exactly the code that validated them before.
  const split = splitObjectFields(route, request.bodyText);
  if (!split.ok) {
    return err(split.error);
  }
  const parsedBody = parsePreAuthBody(split.value.flatBodyText, route.fields);
  if (!parsedBody.ok) {
    return err(parsedBody.error);
  }
  const objects = split.value.objects;

  // ---- 2b. A BODY-RESOLVED PERMISSION IS RESOLVED **HERE**, AS VALIDATION, NOT AT STEP 5.
  //
  // ===========================================================================================
  // THE ORDER IS THE FIX FOR A DEFECT `qa-agent` FOUND, AND THE DEFECT IS WORTH KEEPING VISIBLE.
  // ===========================================================================================
  //
  // The first version resolved the permission at step 5, beside `authorize()`, and refused an
  // unresolvable `action_id` with `invalid_argument` THERE. That broke the class's four-cause
  // collapse: a caller with no permission at all received `invalid_argument` from this route and
  // `forbidden` from every other one, **so the challenge route answered differently from its
  // siblings for the same caller** — which is the property `platform-operator-v1` §errors exists
  // to hold.
  //
  // MOVING IT INTO VALIDATION FIXES IT AT BOTH ENDS. An unknown or missing `action_id` is a SHAPE
  // error, refused before authentication like every other shape error in this class, uniformly
  // for authenticated and anonymous callers alike — so it is no oracle. And by the time step 5
  // runs, THE PERMISSION ALWAYS RESOLVES, so authorization produces the identical `forbidden` the
  // other routes produce.
  //
  // THE CONTRACT'S OWN RULE IS HONOURED BY THIS ORDERING RATHER THAN DESPITE IT: *"AN action_id
  // NAMING AN OPERATION THAT IS NOT `critical` IS REFUSED WITH invalid_argument, not granted a
  // pointless challenge."* It is, and now it is refused as input rather than as authorization.
  //
  // The confirmable operation identifiers are published in the contract, so refusing before
  // authentication discloses nothing a reader of `confirmation-v1` does not already have.
  const permissionId =
    route.permission.kind === 'fixed'
      ? route.permission.permissionId
      : route.permission.resolve(parsedBody.value);
  if (permissionId === undefined) {
    return err(invalidArgument([detail('action_id', 'not_a_confirmable_operation')]));
  }

  // ---- 3. The session credential, then the principal.
  const sessionId = await dependencies.readSessionId(request.headers);
  if (!sessionId.ok) {
    return err(sessionId.error);
  }
  if (sessionId.value === null) {
    // No credential presented. `unauthenticated()` takes no arguments, so this is byte-identical
    // to the answer for a credential that was presented and rejected.
    return err(unauthenticated());
  }
  const principalId = await dependencies.authenticatePrincipal(sessionId.value);
  if (!principalId.ok) {
    return err(principalId.error);
  }

  // ---- 4. Platform authority. NO AUDIT RECORD ON ANY DENIAL PATH HERE.
  const authority = await dependencies.authority.resolve(principalId.value);
  if (!authority.ok) {
    return err(authority.error);
  }

  // ---- 5. Authorization. The envelope is the CEILING, the operator's role grants are the FLOOR,
  // and neither substitutes for the other. Evaluated at `platform` scope, which is the only scope
  // any route in this class uses — it is not a per-route field, deliberately.
  //
  // `permissionId` WAS RESOLVED AT STEP 2b, AS VALIDATION. By this line it always has a value —
  // for a fixed route it is the route's own literal, and for the challenge route it is the
  // permission of the operation the caller named. See step 2b for why the resolution moved.
  const decision = dependencies.authorizer.authorize(
    authority.value.grants,
    PLATFORM_PERMISSION_ENVELOPE,
    permissionId,
    'platform',
  );
  if (!decision.allowed) {
    return recordThen(dependencies, authority.value, route, request, 'denied', NO_TARGET, () =>
      err(forbidden()),
    );
  }

  // ===========================================================================================
  // ---- 5b. THE CONFIRMATION GATE. `docs/decisions/0027`, `0007` D15, `confirmation-v1`.
  // ===========================================================================================
  //
  // THE CONTRACT SAYS **EVERY ENTRY POINT**, AND THE ACTION PIPELINE IS ONE OF FOUR CLASSES:
  // *"EVERY entry point that resolves a permission of sensitivity `critical` requires a valid,
  // unspent, correctly bound confirmation. No exceptions, no flag, no override."* This class holds
  // `platform.credentials.reset`, which is the most dangerous operation in the platform, so a gate
  // that lived only in the pipeline would be a gate the worst target does not pass through — and
  // it would LOOK gated, because the mechanism exists and was reported built.
  //
  // THE POSITION IS THE PIPELINE'S POSITION, neighbour for neighbour:
  //
  //   AFTER AUTHORIZATION (step 5), so a caller lacking the permission receives the class's
  //   uniform `forbidden` from authorization rather than a confirmation refusal — otherwise the
  //   gate would tell an unauthorized caller that the permission was held.
  //
  //   AFTER VALIDATION (steps 1–2), because the confirmation fields arrive on the body and the
  //   bound parameters are the validated ones.
  //
  //   BEFORE THE HANDLER (step 6), so an unconfirmed critical request never reaches the operation.
  //
  // *** THE PIPELINE'S THIRD NEIGHBOUR HAS NO COUNTERPART HERE, AND THE GAP IS REPORTED RATHER
  // THAN PAPERED OVER. *** There it sits AFTER rate limiting, because spending is a write and a
  // throttled caller must not force row-writes. THIS CLASS HAS NO RATE LIMITER — contract PO-4,
  // still owed. What bounds it is `ControlPlaneWriteAdmission`: both the spend and the audit
  // record reserve from the same per-principal daily ceiling, charged to a principal that already
  // passed step 4. So an operator can burn its own budget on failed confirmations and then
  // receive `unavailable` from every platform route, which is a self-inflicted denial rather than
  // an unbounded one. It is not equivalent to a limiter and is not described as one.
  //
  // A REFUSAL IS AUDITED AS `denied`, with `NO_TARGET`. The caller is a real operator holding a
  // real permission who failed to prove intent or presence on a critical operation — precisely
  // what the trail exists to show. `NO_TARGET` because the parameters naming the target are the
  // ones that failed to verify, and recording an unverified target would assert more than the
  // code knows.
  if (isConfirmationGated(route)) {
    if (dependencies.confirmations === undefined) {
      // ABSENT MEANS REFUSED. Same direction as the missing handler below and as the pipeline's
      // uncomposed gate: a deployment that cannot verify a confirmation must not perform an
      // irreversible operation.
      return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
        err(unavailable()),
      );
    }
    const confirmed = await dependencies.confirmations.enforce({
      principalId: authority.value.principalId,
      // NEVER NULL HERE. Step 3 refuses a request with no credential, so by this line the class
      // has a verified session — unlike the Action pipeline, whose envelope may carry none.
      sessionId: sessionId.value,
      // THE ROUTE ID IS THE BOUND OPERATION. `confirmableOperations()` is keyed by it, and
      // `assertConfirmationCoverageIsCoherent` refuses at load if a gated route is not in that
      // set — so the challenge and the submission cannot name different operations.
      actionId: route.id,
      permissionId,
      // THE VALIDATED FLAT BODY. A gated route may declare no object fields, no query parameters
      // and no path parameters (same assertion), so this IS the whole of the route's input — and
      // the confirmation therefore covers everything the operation will act on.
      body: parsedBody.value,
    });
    if (!confirmed.ok) {
      return recordThen(dependencies, authority.value, route, request, 'denied', NO_TARGET, () =>
        err(confirmed.error),
      );
    }
  }

  // ---- 6. The handler.
  const handler = dependencies.handlers[route.id];
  if (handler === undefined) {
    // FAIL CLOSED. A registered route with no composed handler is unreachable, not open. It
    // answers `unavailable` rather than `not_implemented` because the caller has by this point
    // been established as an operator, so there is no disclosure argument for hiding it — and
    // because a missing handler is a composition defect, which is what `unavailable` describes.
    return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
      err(unavailable()),
    );
  }

  // ===========================================================================================
  // A THROWN VALUE IS CAUGHT **HERE**, BECAUSE OTHERWISE IT WOULD BYPASS THE AUDIT RECORD.
  // ===========================================================================================
  //
  // Without this, a handler that throws propagates past `recordThen`, past `http/api.ts`, and is
  // caught only at `fetchHandler`'s outer boundary — which renders `internal()` and discloses
  // nothing, so it LOOKS handled. **What it loses is the record**: an authorized operator reached
  // an authorized handler and the operator action log says it never happened.
  //
  // THAT IS THE ONE THING `0025` DECISION 5 EXISTS TO PREVENT, and `0028` leans on this log for
  // its whole visibility argument. P4 is stated as "every route writes an audit record" — a
  // handler able to throw its way out of one is the exception that makes the property untrue in
  // exactly the case somebody would most want the trail.
  //
  // `pipeline.ts` HAS DONE THIS SINCE IT WAS WRITTEN and this class had not: *"A thrown value is a
  // programming defect — a tenant-column reference, an audit value leak, an unhandled predicate
  // kind. It becomes `internal`, which discloses nothing."* Same treatment, same reasoning, and
  // the divergence was an omission rather than a decision.
  //
  // `internal()` AND NOT THE THROWN VALUE. A thrown object may carry a SQL fragment, a column
  // name, a stack, or a row — `cause` is deliberately not read, not logged and not rendered.
  //
  // `NO_TARGET`, for the reason the failure branch below gives: a handler that threw may not know
  // what it was about to touch, and inventing a target would make the log assert more than the
  // code knows.
  let outcome: Result<PlatformRouteOutcome>;
  try {
    outcome = await handler(
      {
        routeId: route.id,
        authority: authority.value,
        query: query.value,
        objects,
        pathParams: request.pathParams,
        sessionId: sessionId.value,
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
      parsedBody.value,
    );
  } catch {
    return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
      err(internal()),
    );
  }

  // ---- 7. The record, then the answer. Never the other way round.
  if (!outcome.ok) {
    // A FAILED OPERATION IS STILL RECORDED, with `NO_TARGET`: a handler that failed may not know
    // what it was about to touch, and inventing a target from a partial operation would produce a
    // log line that asserts more than the code knows.
    return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
      err(outcome.error),
    );
  }
  return recordThen(
    dependencies,
    authority.value,
    route,
    request,
    'ok',
    outcome.value.target,
    () => ok(outcome.value.body),
  );
}

/**
 * Writes the audit record and then produces the answer — or replaces the answer with
 * `unavailable` if the record could not be written.
 *
 * `answer` IS A THUNK RATHER THAN A VALUE so that the ordering reads as what it is: THE RECORD IS
 * WRITTEN FIRST AND THE ANSWER IS PRODUCED SECOND. `platform-operator-v1`: "the operation is not
 * reported successful until the platform audit record is written."
 *
 * WHAT THIS CANNOT FIX, AND THE CONTRACT SAYS SO: for a future route that mutates, the operation's
 * own control-plane rows are already committed by the time this runs. A failed audit write turns a
 * completed operation into a `503`, and the caller cannot tell that from an operation that never
 * happened. That is the two-database problem, which "cannot be solved, only chosen" — and the
 * choice is to refuse rather than to report a success that has no evidence.
 */
async function recordThen(
  dependencies: PlatformRouteDependencies,
  actor: PlatformAuthority,
  route: PlatformRoute,
  request: PlatformRouteRequest,
  outcome: 'ok' | 'denied' | 'failed',
  target: PlatformActionTarget,
  answer: () => Result<unknown>,
): Promise<Result<unknown>> {
  // ===========================================================================================
  // THE RECORDER'S OWN THROW IS CAUGHT TOO, AND CATCHING ONLY THE HANDLER WOULD HAVE BEEN HALF A
  // FIX POINTED AT THE WRONG HALF.
  // ===========================================================================================
  //
  // `platform-audit.ts` promises *"no `catch {}`... every failure path returns `unavailable()`"* —
  // and that is a promise about the RECORDER, not about the store beneath it. A D1 adapter, a
  // binding that is missing at runtime, or an admission port can throw, and a throw from THIS call
  // escapes to the same outer boundary the handler's did.
  //
  // IT IS THE WORSE OF THE TWO, because this is the code whose entire job is to make sure the
  // operation left evidence. A silent escape here is an unaudited operation on the audit path.
  //
  // A THROWN RECORD IS AN UNWRITTEN RECORD, so it is answered exactly as a returned failure is:
  // `unavailable`, and the caller's operation fails with it. `answer()` IS DELIBERATELY OUTSIDE
  // THE `try` — it only constructs a `Result`, and putting it inside would let this `catch` mean
  // two different things.
  let recorded: Result<void>;
  try {
    recorded = await dependencies.audit.record({
      actor,
      actionId: route.id,
      target,
      outcome,
      correlationId: request.correlationId,
    });
  } catch {
    return err(unavailable());
  }
  if (!recorded.ok) {
    return err(recorded.error);
  }
  return answer();
}
