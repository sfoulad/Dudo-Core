/**
 * ===========================================================================================
 * THE TENANT-ADMIN ROUTE CLASS — THE FIFTH REQUEST CLASS. `docs/decisions/0044`, accepted
 * 2026-09-13. Companion: `docs/decisions/0043`, which decides WHO may call these routes.
 * ===========================================================================================
 *
 * A TENANT-ADMIN ROUTE AUTHENTICATES A PRINCIPAL, RESOLVES A TENANT FROM THE AUTHENTICATED
 * CONTEXT, EVALUATES A PERMISSION — OR A CONJUNCTION OF THEM — AND REACHES CONTROL-PLANE PORTS.
 *
 *   CLASS                 PRINCIPAL   TENANT           PERMISSION   CONTROL PLANE   App-reachable
 *   pre-auth (0014 §B)    none        none             none         —               no
 *   session  (0021)       session     none             none         —               no
 *   TENANT-ADMIN (0044)   yes         YES, from ctx    YES          YES             **NO**
 *   platform (0025 D3)    yes         none             yes          yes             no
 *   Action                yes         yes              yes          **no**          YES
 *
 * **THE LAST COLUMN IS THE WHOLE SAFETY ARGUMENT FOR CREATING A CLASS RATHER THAN WIDENING ONE.**
 * `security.md` §4 is preserved by the tenant-admin class and the Action class being DIFFERENT
 * CLASSES, not by a check inside one. `0044` §2a refused a control-plane port on `ActionContext`
 * outright rather than weighing it: Actions are the App execution path, `apps/customers/actions/**`
 * ships eight, and §4 has no exception for any plugin for any reason.
 *
 * ===========================================================================================
 * WHY IT EXISTS AT ALL — `0044` §1, measured rather than argued
 * ===========================================================================================
 *
 * Milestone 2 administers the Organization and almost nothing it administers is in the tenant
 * database. `organization`, `organization_membership`, `session`, `membership_role`, `principal`
 * and `organization_identity` are all control plane; `ActionContext` exposes a tenant store, an
 * audit sink, cursors, a clock, ids and correlation, **and no control-plane port.** So members,
 * roles, sessions, profile and registrations — the milestone — are unreachable from the only
 * tenant-facing class that existed.
 *
 * `0044` §2c records that this is **a derivation rather than a decision**: a control-plane port on
 * `ActionContext` violates `security.md` §4, moving the data into the tenant database violates
 * `0030`, and no fourth option was found although one was looked for.
 *
 * ===========================================================================================
 * *** THE TABLE IS EMPTY. THE CLASS IS BUILT AHEAD OF ITS FIRST CONTRACT, ON PURPOSE. ***
 * ===========================================================================================
 *
 * `0044` §4 assigns the route table, the registry file and the dispatcher branch to Core and
 * sequences them after the decision. They are here so that **the first Milestone 2 contract lands
 * into machinery that already refuses the four things `0044` says this class must never acquire**,
 * rather than into an empty tree where each of them would be a thing somebody remembers.
 *
 * **EVERY ASSERTION BELOW THEREFORE EXAMINES NOTHING TODAY, AND THAT IS STATED RATHER THAN LEFT TO
 * BE DISCOVERED.** `workflow.md` §11a: a check handed nothing reports success, and *"no findings"
 * must not render as "no input"*. `TENANT_ADMIN_ROUTE_COUNT` is the population pin — a number
 * somebody has to move on purpose — and every assertion takes its input as a parameter so
 * `qa-agent` can drive it with constructed routes without editing `platform/core/**`.
 *
 * **A GREEN HERE IS EVIDENCE ABOUT AN EMPTY LIST AND NOTHING ELSE, UNTIL THAT PIN MOVES.**
 *
 * ===========================================================================================
 * THE FOUR THINGS `0044` §3b SAYS THIS CLASS MUST NEVER ACQUIRE, AND WHERE EACH IS STOPPED
 * ===========================================================================================
 *
 *   1. NO CROSS-TENANT READ OF ANY KIND — not a count, not an existence check, not an error that
 *      distinguishes another tenant's identifier from a nonexistent one.
 *      **Nothing in this file can enforce this and it must not look as though it does.** It is a
 *      property of the PORTS a handler is given and of the responses a contract publishes. What is
 *      enforced here is (2), which removes the only way a caller could NAME another tenant.
 *   2. THE TENANT COMES FROM THE AUTHENTICATED CONTEXT AND FROM NOWHERE ELSE.
 *      -> `assertNoOrganizationIdentifierInAnyRequestPosition`, at REGISTRATION.
 *   3. NEVER MANIFEST-DECLARABLE. -> the route id union is a closed set of literals in a file no
 *      App may edit, there is no registration function, and `RESERVED_PRE_AUTH_PATH_PREFIXES`
 *      refuses an App route table that could resolve onto this base path.
 *   4. NO WILDCARD PERMISSION, AND AN UNRECOGNISED ROUTE ID FAILS CLOSED. -> the envelope guard in
 *      `tenant-admin-permissions.ts`, and `matchTenantAdminRoute` returning `undefined` for
 *      anything not in the table, which renders 404.
 *   5. EVERY ROUTE EVALUATES A PERMISSION. -> `permission` is a required field with no `none`
 *      variant. There is no unauthenticated member of this class; that is the distinction from
 *      `0021` and the reason this is a fifth class rather than a widening of the third.
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
import { parsePreAuthBody } from '../identity/pre-auth-admission.ts';
import { requiresConfirmation } from '../confirmation/critical-permissions.ts';
import type { ConfirmationGate } from '../confirmation/confirmation-gate.ts';
import type { TenantAdminAuthority, TenantAdminAuthorityResolver } from './tenant-admin-authority.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';
// THE SERVICE, NEVER THE STORE. `InvitationStore` is deliberately not imported into this file —
// there is no field it could legitimately occupy, and an unused import is the first half of one
// appearing. See `TenantAdminRouteDependencies.invitations`.
import type { InvitationService } from './invitation-administration.ts';
import type {
  TenantAdminActionTarget,
  TenantAdminAuditRecorder,
  TenantAdminWriteCharged,
} from './tenant-admin-audit.ts';
import { NO_TENANT_ADMIN_TARGET } from './tenant-admin-audit.ts';
import {
  TENANT_ADMIN_PERMISSION_ENVELOPE,
  TENANT_ADMIN_SCOPE,
} from './tenant-admin-permissions.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import { MEMBERSHIP_ROLES, grantsForRole } from '../authorization/roles.ts';

/**
 * The base path. `/api/v1/organization`.
 *
 * ===========================================================================================
 * `organization` AND NOT `admin`, AND THE REASON IS `architecture.md` §1a RATHER THAN TASTE.
 * ===========================================================================================
 *
 * *"A name that does not say WHOSE is a name two contracts can both use correctly and mean
 * different things by."* Dudo has two administrations and `CLAUDE.md` calls the split structural:
 * `admin.dudo.work` is the platform-operator control centre, and Organization administration lives
 * under `app.dudo.work/settings`. **`/api/v1/admin` would be a segment both could claim**, and the
 * first time somebody mounted the wrong one on the wrong host the mistake would read as a typo.
 * `organization` says whose.
 *
 * IT MUST BE RESERVED IN TWO PLACES AND ONLY ONE OF THEM IS MINE. `RESERVED_PRE_AUTH_PATH_PREFIXES`
 * in `identity/pre-auth-registry.ts` carries it, so `assertNoReservedPathCollision` turns a
 * colliding App route table into a BUILD failure rather than dead code. The other is
 * `reservedApiPathSegments` in `core-object-registry.yaml`, which is `architecture-agent`'s file:
 * **THIS CHANGE DOES NOT MAKE IT — requested through the Team Lead**, exactly as
 * `platform-routes.ts` did for the `platform` segment.
 */
export const TENANT_ADMIN_BASE_PATH = '/api/v1/organization';

/**
 * ===========================================================================================
 * THE CLOSED SET. **IT HAS NO MEMBERS.**
 * ===========================================================================================
 *
 * A closed union of literals, exactly as `PreAuthEntryPointId`, `SessionRouteId` and
 * `PlatformRouteId` are, and for the same reason: a value is not expressible without editing this
 * file, which lives in `platform/core/**` and which no App may edit.
 *
 * **`never` IS THE HONEST SPELLING OF "NO ROUTE IS REGISTERED YET" AND IT IS FAIL-CLOSED IN A WAY
 * A PLACEHOLDER WOULD NOT BE.** `TenantAdminRoute` is uninhabitable while this is `never`, so
 * `ROUTES` can only be empty, no handler can be composed, and no URL can match. A seeded
 * placeholder id would be a route that exists, answers `unavailable`, and appears in every
 * assertion's population as though the class had been exercised.
 *
 * **THE FIRST MEMBER ARRIVES WITH THE FIRST CONTRACT, AND SO DOES ITS PERMISSION, ITS ENVELOPE
 * ENTRY AND ITS ROLE GRANT — IN ONE CHANGE.** That order is forced rather than chosen:
 * `assertEveryRoutePermissionIsReachable` runs at MODULE LOAD and checks the whole chain, so any
 * half arriving alone fails the build of everything importing this file. The platform class
 * shipped halves separately twice in one day, in both directions, and both produced a route that
 * was `forbidden` to every caller alive.
 */
export type TenantAdminRouteId = never;

/**
 * `GET`, `POST`, `PATCH` — and deliberately NOT `DELETE`.
 *
 * `http/api.ts`'s `METHODS_WITH_BODY` carries `POST` and `PATCH`, which is checked rather than
 * assumed — `platform-routes.ts` records the same check for `PATCH` and why it mattered: *"a route
 * class that matched a method the transport would not carry a body for would fail as 'the field is
 * missing' rather than as 'the method is unsupported'."*
 *
 * **`DELETE` IS ABSENT BECAUSE NOTHING NEEDS IT AND ITS ARRIVAL SHOULD BE A DECISION.** Removing a
 * member and revoking an invitation are both `POST` in this platform's existing vocabulary
 * (`platform.operators.revoke`), and a destructive verb that carries no body is a destructive verb
 * that cannot carry a confirmation. Adding it means checking `METHODS_WITH_BODY` first.
 */
export type TenantAdminRouteMethod = 'GET' | 'POST' | 'PATCH';

/**
 * ===========================================================================================
 * *** THE REQUEST VOCABULARY. EVERY NAME A ROUTE MAY DECLARE, IN ANY POSITION, AS A CLOSED UNION.
 * `docs/decisions/0044` §3b.2 · `architecture.md` §3a-i. ***
 * ===========================================================================================
 *
 * `0044` §3b.2: *"No request shape may contain an organization identifier in any position — path,
 * query or body — and a route declaring one is refused AT REGISTRATION rather than at
 * authorization."*
 *
 * **THE OBVIOUS IMPLEMENTATION IS A DENY-LIST AND IT IS THE FAIL-OPEN ONE.** A check refusing any
 * field named `organization_id` is defeated by `tenant_id`, `org`, `company_id` or `workspace_id`
 * — and `architecture.md` §3a-i is exactly about this shape: *"key the predicate on the EXCEPTION,
 * not on the members, so an unknown value is caught by the DEFAULT."* A deny-list keys on the
 * members. **Every name nobody thought of is permitted.**
 *
 * SO THE POLARITY IS INVERTED: **a name not in this union cannot be declared, and it cannot be
 * declared because it does not type-check.** Adding one is an edit to `platform/core/**` with a
 * reviewer, and the reviewer's question is the single question `0044` §3b.2 asks. A future
 * `workspace_id` meaning an Organization is caught by a human at that edit; it is not caught by a
 * pattern, and no pattern could catch it, because the hazard is what a name MEANS.
 *
 * **WHAT THIS IS AND IS NOT: it is a CHOKE POINT, not a semantic check.** It converts "N route
 * authors each remembering the rule" into "one list a reviewer reads". Said plainly because
 * `architecture.md` §3a's closing warning is against describing one layer as the enforcement —
 * `assertRequestVocabularyNamesNoOrganization` below is the second layer and covers the specific
 * spelling, and neither of them can read intent.
 *
 * ===========================================================================================
 * IT STARTS WITH EXACTLY THE TWO NAMES THE CLASS ITSELF OWNS
 * ===========================================================================================
 *
 * `page_size` and `cursor` are not a contract's invention: they are the machinery `0044` §3c
 * requires of every bounded read in this class, so they are the class's to define. **Every other
 * name arrives with the contract that needs it**, which is the point — an empty-but-for-pagination
 * vocabulary means the first route cannot accept a single field nobody has reviewed.
 *
 * ===========================================================================================
 * *** `action_id` AND `locale` ARE THE CHALLENGE ROUTE'S, AND THEY ARE THE SAME KIND OF NAME. ***
 * ===========================================================================================
 *
 * They are `confirmation-v1`'s machinery rather than any tenant contract's invention, so they
 * belong to the class for the reason `page_size` does. **`parameters` is deliberately NOT here** —
 * the tenant-admin challenge carries its parameters FLAT (`tenant-admin/README.md` §2.4a, ruled
 * 2026-09-13), so there is no field by that name and this class still declares no `objectFields`.
 *
 * *** AND THE FLAT PARAMETER NAMES THEMSELVES MUST EACH JOIN THIS UNION AS THEIR TARGET LANDS. ***
 * That is not overhead — **it is what makes the flat form safe.** A nested `parameters` object
 * would carry arbitrary keys past this vocabulary and therefore past
 * `assertRequestVocabularyNamesNoOrganization`; flattening puts every parameter name under the
 * §3b.2 check that refuses an organization identifier **at registration**. The ruling took the
 * shape that is easier to police, which is a stronger reason than the one-definition argument that
 * decided it.
 */
export type TenantAdminRequestName = 'page_size' | 'cursor' | 'action_id' | 'locale';

/**
 * The runtime value set, for the assertions below. **DERIVED-ADJACENT AND NOT DERIVED**, because
 * TypeScript erases the union and there is nothing to read it from at run time.
 *
 * ===========================================================================================
 * *** IT IS DERIVED FROM A `Record` KEYED BY THE UNION, SO THE COMPILER ENFORCES BOTH
 * DIRECTIONS AND THERE IS ONE COPY RATHER THAN THREE. ***
 * ===========================================================================================
 *
 * **MEASURED, NOT ASSERTED** — both diagnostics were observed against this union before this
 * comment was written:
 *
 *   a union member missing from the object  ->  TS2741, and the diagnostic NAMES the member
 *   a key that is not in the union          ->  TS2353, excess property
 *
 * *** AND THE FIRST VERSION OF THIS CONSTRUCTION GOT THE SECOND ONE WRONG, WHICH IS THE REASON
 * THE SENTENCE ABOVE SAYS "MEASURED". *** It was written as:
 *
 *   const REQUEST_VOCABULARY: Readonly<Record<TenantAdminRequestName, true>> =
 *     Object.freeze({ page_size: true, cursor: true });
 *
 * **`Object.freeze` DEFEATS THE EXCESS-PROPERTY CHECK.** The literal is an ARGUMENT to a generic
 * function, so it is no longer *fresh* by the time the annotation is applied, and a wider object
 * type is assignable to a narrower one. TS2741 still fired on a missing member; **TS2353 did not
 * fire on `organization_id: true`, and the extra key would have flowed straight into
 * `TENANT_ADMIN_REQUEST_VOCABULARY` through `Object.keys` — permitting exactly the name this
 * vocabulary exists to refuse.** Fail-open, in the one direction that matters, from a wrapper
 * added for immutability.
 *
 * `satisfies` checks the literal where it is written, so the freeze can stay outside it. **The
 * comment claiming TS2353 was written before the diagnostic was run; running it is what turned a
 * plausible claim into a defect with a name** (`architecture.md` §3b — an assertion that a hazard
 * is handled needs the same scrutiny as a claim that it is not).
 *
 * *** THE FIRST DRAFT ALSO HAD THREE COPIES: THE UNION, A FROZEN ARRAY, AND A DEFAULT PARAMETER
 * ON A LOAD-TIME CHECK COMPARING THEM. *** Adding a name to the first two and not the third would
 * have fired that check **naming the wrong artifact** — a red that sends the next reader to fix
 * the thing that is right. `workflow.md` §11a: when a stronger layer already holds the guarantee,
 * **delete the check and name the layer.**
 */
const REQUEST_VOCABULARY = Object.freeze({
  page_size: true,
  cursor: true,
  action_id: true,
  locale: true,
} as const satisfies Record<TenantAdminRequestName, true>);

/**
 * The runtime list, DERIVED from the object above rather than transcribed beside it.
 *
 * `workflow.md` §11a: *"the subject is DERIVED FROM THE ARTIFACT, never transcribed alongside
 * it"* — a transcribed name is a second copy of a fact, in a place that cannot see the first.
 *
 * THE CAST IS SOUND BY CONSTRUCTION AND IS THE ONLY ONE IN THIS FILE. `Object.keys` is typed
 * `string[]` because a JavaScript object may carry keys its type does not describe; this one
 * cannot, because it is a frozen object literal whose excess keys the compiler already refused.
 */
export const TENANT_ADMIN_REQUEST_VOCABULARY: readonly TenantAdminRequestName[] = Object.freeze(
  Object.keys(REQUEST_VOCABULARY) as TenantAdminRequestName[],
);

/**
 * ===========================================================================================
 * *** A ROUTE MAY REQUIRE A CONJUNCTION. A DISJUNCTION IS UNREPRESENTABLE. `0044` §3d. ***
 * ===========================================================================================
 *
 * The Team Lead's ruling, in its own words:
 *
 *   "`A ∧ B` is strictly MORE restrictive than either conjunct — enumerable, statically checkable,
 *    and it cannot widen reach. `A ∨ B` IS A WIDENING WEARING THE SAME SYNTAX."
 *
 *   "Refuse the disjunction AT THE TYPE LEVEL so it cannot be expressed, never in a comment. It
 *    arrives as convenience the first time a route is awkward to grant, and a prohibition a type
 *    enforces cannot be argued with at 3am."
 *
 * **SO THIS IS A DISCRIMINATED UNION WITH ONE MEMBER.** There is no `{kind: 'any-of'}` to
 * construct, and `kind` is here rather than being a bare array so that **every declaration states
 * the semantics at the site** and so that adding a second variant is a visible edit to a union
 * rather than a new field somebody slips into a route.
 *
 * ===========================================================================================
 * WHY THE CONJUNCTION EXISTS AT ALL — `0043` §2b, and it is not ergonomics
 * ===========================================================================================
 *
 * `security.md` §2a's enumeration test asks whether an aggregate's consumer already holds
 * enumeration over the counted population. **Under a closed role set that is a property of tables
 * anyone can read. Under `0007` D16's custom roles it is a property of nothing**, because
 * constraint 1 permits any subset — a tenant admin holding both permissions may mint a role
 * holding one. `0043` §2b: *"Custom roles DECOMPOSE CO-HOLDING, continuously and under tenant
 * control."*
 *
 * The repair is not refusing custom roles. It is that the route requires `A ∧ B` **decided in Core
 * on every call**, which no custom role can decompose. `0043` §4's pending-invitation count is the
 * first aggregate that needed it: `core.user.invite` grants creation and not enumeration, so
 * `core.invitation.list` is the conjunct or the count is withheld.
 *
 * ===========================================================================================
 * WHICH INSTRUMENT TO USE, so a conjunction is not reached for by habit — `0044` §3d
 * ===========================================================================================
 *
 *   *Would a grantor ever want to grant the capability WITHOUT one of the conjuncts?*
 *     **YES** -> its own permission. A conjunction here would be a name nobody can grant.
 *     **NO**  -> the conjunction says the true thing, and a third name is a synonym.
 */
export type TenantAdminConjunction = {
  readonly kind: 'all-of';
  /**
   * NON-EMPTY BY CONSTRUCTION. A tuple type, so `permissionIds: []` does not compile.
   *
   * An empty list would be a route that evaluates no permission, which is `0044` §3b.5's
   * prohibition arriving as an empty array rather than as a missing field — and it would read as
   * `authorize()` being called zero times and every call passing.
   */
  readonly permissionIds: readonly [string, ...string[]];
};

/**
 * ===========================================================================================
 * *** THE SECOND VARIANT: A CHALLENGE ROUTE BORROWS THE PERMISSION OF WHAT IT CONFIRMS. ***
 * ===========================================================================================
 *
 * `confirmation-v1`: the challenge route declares *"THE SAME PERMISSION AS THE OPERATION NAMED IN
 * THE REQUEST, resolved from `action_id`. Not a permission of its own."* **That is what keeps it
 * from being an oracle** — a caller who could not perform the operation cannot obtain a challenge
 * for it, and receives the identical refusal.
 *
 * **IT BORROWS THE TARGET'S WHOLE CONJUNCTION, NOT ONE PERMISSION.** The platform version resolves
 * to a single id because its class has no conjunctions. This class does (`0044` §3d), so a target
 * requiring `A ∧ B` must yield `A ∧ B` here — **resolving to one conjunct would issue a challenge
 * to a caller who cannot perform the operation**, which is the exact property the borrowing exists
 * to preserve, defeated by an arity mismatch nobody would see.
 *
 * *** A UNION RATHER THAN AN OPTIONAL `resolve` BESIDE A REQUIRED `permissionIds`. *** The
 * optional-sibling shape lets a route declare both — a reviewer cannot then tell which governs —
 * or declare a fixed permission it never evaluates, which is a lie in the route table. **The union
 * makes both unrepresentable**, and it makes the dynamic case loud at the one place anybody reads
 * to find out what a route requires.
 *
 * *** AND IT IS STILL NOT A DISJUNCTION. *** `resolvable()` looks like a set of alternatives and is
 * not one: **exactly one entry is selected by the caller's own `action_id`, before authorization**,
 * and that one is then required in full. A disjunction would let a caller satisfy the route by
 * holding any member. Here a caller holding every permission in `resolvable()` except the one it
 * named is refused. **The set is a domain, not an `∨`** — written down because it is the reading
 * somebody will reach for when arguing that `0044` §3d has already been bent.
 */
export type TenantAdminFromBodyPermission = {
  readonly kind: 'from-body';
  /**
   * The conjunction the named operation requires, or `undefined` for one this class cannot confirm.
   *
   * **`undefined` IS REFUSED WITH `invalid_argument` AND NEVER FALLS BACK.** A resolver returning
   * some other permission would authorize a caller for an operation it did not name — and the human
   * would then confirm one thing while a different thing was authorized.
   */
  readonly resolve: (body: Readonly<Record<string, unknown>>) => TenantAdminConjunction | undefined;
  /**
   * *** EVERY CONJUNCTION THIS ROUTE CAN RESOLVE TO. THE REGISTRATION CHECKS READ THIS. ***
   *
   * **A FUNCTION, NOT AN ARRAY, FOR THE REASON `roleHolders` IS ONE**: it reads the live confirmable
   * map rather than a snapshot taken at module-init order, and a snapshot is exactly what goes stale.
   *
   * **AN EMPTY RESULT IS A REGISTRATION FAILURE AND NOT A PASS.** Team Lead ruling, and it closes a
   * hole I would otherwise have shipped: `assertEveryRoutePermissionIsReachable` iterates the
   * resolvable set, so an empty one makes it **pass vacuously — green, examining nothing, on the
   * route that gates the most dangerous operations in the class** (`workflow.md` §11a's empty-list
   * reader, at the worst possible site).
   */
  readonly resolvable: () => readonly TenantAdminConjunction[];
};

export type TenantAdminRoutePermission = TenantAdminConjunction | TenantAdminFromBodyPermission;

/**
 * Every conjunction a route can evaluate — one for a fixed route, the whole resolvable domain for a
 * challenge route.
 *
 * **THIS IS THE ONE PLACE THE TWO VARIANTS ARE FLATTENED**, so each assertion below states its
 * property once instead of branching on `kind` and drifting. It THROWS on an empty resolvable set
 * rather than returning `[]`, because every caller is a check whose loop would otherwise run zero
 * times and report success.
 */
export function conjunctionsOf(route: TenantAdminRouteLike): readonly TenantAdminConjunction[] {
  if (route.permission.kind === 'all-of') {
    return [route.permission];
  }
  const resolvable = route.permission.resolvable();
  if (resolvable.length === 0) {
    throw new TenantAdminRegistrationError(
      `'${route.id}' resolves its permission from the request body and can currently resolve to ` +
        'NOTHING. That is refused at registration rather than passed, because every reachability ' +
        'check below iterates this set: an empty one makes all of them green while examining ' +
        'nothing, on the route that gates the most dangerous operations in this class. Populate ' +
        'TENANT_ADMIN_CONFIRMABLE_OPERATIONS, or do not register the route.',
    );
  }
  return resolvable;
}

/**
 * One permission. The ordinary case, and it is still a conjunction of one.
 *
 * RETURNS THE NARROW `TenantAdminConjunction` RATHER THAN THE UNION, so a challenge route's
 * `resolve` can be typed to produce one of these and cannot accidentally yield another `from-body`.
 */
export function requires(permissionId: string): TenantAdminConjunction {
  return Object.freeze({
    kind: 'all-of' as const,
    permissionIds: Object.freeze([permissionId]) as readonly [string, ...string[]],
  });
}

/**
 * Two or more, ALL of which the caller must hold.
 *
 * IT TAKES A REST PARAMETER WITH TWO REQUIRED HEADS so that `requiresAll(x)` does not compile —
 * a conjunction of one is `requires`, and having one spelling for it means a reader scanning the
 * table sees `requiresAll` only where there is genuinely more than one.
 */
export function requiresAll(
  first: string,
  second: string,
  ...rest: readonly string[]
): TenantAdminConjunction {
  return Object.freeze({
    kind: 'all-of' as const,
    permissionIds: Object.freeze([first, second, ...rest]) as readonly [string, ...string[]],
  });
}

/**
 * ===========================================================================================
 * *** HOW MANY ROWS THIS ROUTE MAY READ. REQUIRED ON EVERY ROUTE. `0044` §3c. ***
 * ===========================================================================================
 *
 * `0044` §3c, ruled:
 *
 *   "Every read shape in this class declares a page cap or names the index that bounds it. **An
 *    absent bound is a REGISTRATION FAILURE, never a fallback.**"
 *
 *   "A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF THIS, and it will be proposed as a
 *    convenience. A route that forgot its bound and a route that accepted the default are
 *    indistinguishable afterwards."
 *
 * **THERE IS NO `TENANT_ADMIN_DEFAULT_PAGE_SIZE` IN THIS FILE, AND ITS ABSENCE IS THE RULING
 * IMPLEMENTED.** `readPageSize` below refuses a request that omits `page_size` on a paginated
 * route rather than choosing a number for it. That cost is real and is named at the function.
 *
 * **AND THE FIELD IS REQUIRED ON EVERY ROUTE RATHER THAN ON EVERY GET**, which is
 * `architecture.md` §3a-i's shape: the exception is `no-collection`, it is stated per route with
 * its own reason, and **a route that says nothing is refused by the default rather than absorbed
 * by it.** Keying on "is this a GET" would leave a POST that returns a list — a search, a bulk
 * resolve — matching neither branch and bounded by nothing, which is the live defect §3a-i was
 * written from.
 */
export type TenantAdminReadBound =
  | {
      readonly kind: 'page-cap';
      /**
       * The most rows one page may contain. `1 <= maxPageSize <= TENANT_ADMIN_MAX_PAGE_SIZE`.
       *
       * PER ROUTE RATHER THAN ONE CONSTANT FOR THE CLASS, because the right cap depends on the row:
       * a hundred membership rows and a hundred audit rows are not the same read. The class-wide
       * maximum is a ceiling on the per-route number, not a substitute for it.
       */
      readonly maxPageSize: number;
    }
  | {
      readonly kind: 'bounding-index';
      /**
       * The index that bounds the read, by its name in a migration. Checkable against the SQL.
       *
       * A NAME AND NOT A BOOLEAN. *"This read is indexed"* is a claim nobody can verify; an index
       * name is one somebody can grep for and find missing.
       */
      readonly index: string;
      /** The most rows the bounded read can return. Stated, so the bound is a number. */
      readonly maxRows: number;
    }
  | {
      readonly kind: 'no-collection';
      /**
       * THE DECLARED EXCEPTION, AND IT CARRIES ITS OWN JUSTIFICATION.
       *
       * A route returning a fixed-shape object or a scalar. The string is required because the
       * variant is the one a route can claim to escape the other two — **a reviewer reading the
       * table needs the reason at the site**, and an empty one is refused at registration.
       */
      readonly why: string;
    };

/**
 * The class-wide ceiling on any route's `maxPageSize`.
 *
 * IT IS A CEILING ON A DECLARATION AND NOT A DEFAULT FOR ONE. Nothing reads it at request time;
 * `assertEveryReadShapeIsBounded` compares each route's own number against it at module load.
 */
export const TENANT_ADMIN_MAX_PAGE_SIZE = 100;

/** The smallest page a route may declare or a caller may ask for. */
export const TENANT_ADMIN_MIN_PAGE_SIZE = 1;

/** The longest query string this class will look at, before anything is parsed. */
export const TENANT_ADMIN_MAX_QUERY_STRING_LENGTH = 1024;

/**
 * A registered tenant-admin route.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `scope`, `store`, `resolver`, `organizationId`, and any
 * field naming a tenant. The scope is not per-route because every route in this class evaluates at
 * `organization` — see `TENANT_ADMIN_SCOPE`, and `AUTHORIZATION_STANDARD.md` §4 on why a per-route
 * scope is a per-route opportunity to evaluate at the wrong level.
 *
 * **AND THERE IS NO `objectFields`.** The platform class has one because `confirmation-v1`'s
 * challenge carries a `parameters` object; the shared body floor (`parsePreAuthBody`) refuses
 * nesting outright, and this class takes that floor unwidened. A contract needing a nested field
 * is a deliberate extension, and **it must SHARE the platform class's implementation rather than
 * copy it** — `workflow.md` §12's duplicated-constraint case, where one rule restated six times
 * agreed with the running code once.
 */
export type TenantAdminRoute = {
  readonly id: TenantAdminRouteId;
  readonly method: TenantAdminRouteMethod;
  /** ABSOLUTE. Under `TENANT_ADMIN_BASE_PATH`, which is reserved. */
  readonly path: string;
  /** The conjunction `authorize()` evaluates, at `organization` scope, against the class envelope. */
  readonly permission: TenantAdminRoutePermission;
  /**
   * The COMPLETE set of body field names this route accepts. Required, and may be empty.
   *
   * "This route accepts no body fields" has to be an explicit statement rather than an omission,
   * because an omission is how a route ends up accepting anything.
   */
  readonly fields: readonly TenantAdminRequestName[];
  /**
   * The COMPLETE set of query parameter names. Required, and may be empty.
   *
   * EMPTY MEANS THE WHOLE QUERY STRING IS REFUSED, not that unknown keys are filtered. `0021`'s
   * ruling, restated by the platform class: without it `?organization_id=…` is silently accepted
   * and ignored, and *"ignored is one careless edit from read"*.
   */
  readonly queryParameters: readonly TenantAdminRequestName[];
  /** How many rows this route may read. See `TenantAdminReadBound`. */
  readonly readBound: TenantAdminReadBound;
  /**
   * WHETHER THIS ROUTE WRITES AN AUDIT RECORD. Required, with no default.
   *
   * `'required'` for every mutation, enforced by `assertEveryMutationIsAudited`. `'not-audited'` is
   * available only to a `GET`, must be stated, and is the class's declared departure from the
   * platform class's P4 — see `tenant-admin-audit.ts` for why reads are not universally audited
   * here and what that costs.
   */
  readonly audit: 'required' | 'not-audited';
  /**
   * The status a SUCCESSFUL response carries. COPIED FROM THE CONTRACT, NOT REASONED ABOUT.
   *
   * `platform-routes.ts` records why the citations matter: two of its first values were written as
   * `200` with comments asserting the contracts said so, and both contracts said `201`. **A
   * plausible argument about a status is not evidence of one.**
   */
  readonly successStatus: 200 | 201;
};

/**
 * The table. **EMPTY.**
 *
 * `TenantAdminRouteId` is `never`, so this array cannot hold anything and the emptiness is a
 * property of the type rather than of this line.
 */
const ROUTES: readonly TenantAdminRoute[] = Object.freeze([]);

/**
 * THE POPULATION PIN. `workflow.md` §11a.
 *
 * *"Assert the count against the last known value and require a human to move it. A number that
 * can only be edited deliberately is a number someone has to look at."*
 *
 * **IT GOES RED IN BOTH DIRECTIONS**, which is the half that is easy to omit: more routes than
 * declared means one was added without anyone revisiting the class's assertions; fewer means one
 * was removed and every assertion below is now examining a smaller set than the last person who
 * read a green run believed.
 */
export const TENANT_ADMIN_ROUTE_COUNT = 0;

/**
 * A route as the ASSERTIONS see it — the same shape with a plain `string` id.
 *
 * ===========================================================================================
 * IT EXISTS SO `qa-agent` CAN CONSTRUCT A FAILING INPUT, WHICH IS THE ONLY THING THAT
 * DISTINGUISHES SOUND-BY-DESIGN FROM SOUND-BY-ACCIDENT. `workflow.md` §11a.
 * ===========================================================================================
 *
 * *"A check ships with a known-failing input, or it has not been verified — only observed."* While
 * `TenantAdminRouteId` is `never`, `TenantAdminRoute` is uninhabitable and **no fixture route can
 * be built at all** — so without this alias every assertion below would be unreachable from a
 * test, and `roles.ts` records exactly what that produces: *"a coherence check that is itself
 * unchecked is a guard nobody has watched fail."*
 *
 * IT WIDENS THE ID AND NOTHING ELSE. A fixture still has to declare a real permission conjunction,
 * a real read bound and a real audit disposition, so a test cannot accidentally exercise a shape
 * the shipped table could not hold.
 */
export type TenantAdminRouteLike = Omit<TenantAdminRoute, 'id'> & { readonly id: string };

// =============================================================================================
// Registration-time assertions. Each takes its input, and each states what it examined.
// =============================================================================================

export class TenantAdminRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantAdminRegistrationError';
  }
}

/** The population pin, compared. See `TENANT_ADMIN_ROUTE_COUNT`. */
export function assertRouteCountIsDeclared(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  declared: number = TENANT_ADMIN_ROUTE_COUNT,
): void {
  if (routes.length !== declared) {
    throw new TenantAdminRegistrationError(
      `The tenant-admin table holds ${String(routes.length)} route(s) and ` +
        `TENANT_ADMIN_ROUTE_COUNT says ${String(declared)}. Every assertion in this file loops ` +
        'over that table, so a table that has changed size without this number moving means the ' +
        'last green run was measured against a different population than the one shipping. Move ' +
        'it deliberately.',
    );
  }
}

/*
 * ===========================================================================================
 * THERE IS NO `assertRequestVocabularyIsComplete`, AND ITS ABSENCE IS A LAYER RATHER THAN A GAP.
 * ===========================================================================================
 *
 * An earlier draft carried one, comparing the runtime array against a transcribed copy of the
 * union. **`REQUEST_VOCABULARY` above makes both directions compile errors**, and `workflow.md`
 * §11a is explicit about what to do on meeting that: *"a runtime assertion beneath a type-level
 * guarantee adds nothing and hides the fact that the guarantee is what is holding… record which
 * layer, delete the assertion, and do not cast."*
 *
 * SO THE LAYER IS `tsc`. It fires on a union member with no key (TS2741) and on a key with no
 * union member (TS2353), it names the member, and it fires **before anything runs** rather than
 * at module load. The deleted check could do neither.
 */

/**
 * ===========================================================================================
 * *** NO PERMITTED REQUEST NAME MAY BE ORGANIZATION-SHAPED. THE SECOND LAYER OVER `0044` §3b.2.
 * ===========================================================================================
 *
 * The vocabulary union is the first layer: a name not in it cannot be declared. **This is what
 * catches somebody ADDING an organization identifier to the vocabulary**, which is the one edit
 * that defeats the first layer and which will look reasonable to whoever makes it — a route
 * genuinely needs to name an Organization only in the moment somebody has decided to let a caller
 * name one.
 *
 * *** IT IS A PATTERN CHECK AND THEREFORE A HEURISTIC, AND IT IS LABELLED ONE. *** It runs over a
 * short, hand-maintained, reviewed list rather than over an open world, which is the only place a
 * pattern check is defensible. `workflow.md` §11a: *"I would rather you knew the check is weak
 * than have it trusted."*
 *
 * **WHAT IT CANNOT SEE:** a name meaning an Organization without saying so — `tenant_id`,
 * `workspace_id`, `company_id`, `account_id`. Those are caught by the human at the vocabulary edit
 * and by nothing else, because the hazard is semantic. Widening this pattern to cover them would
 * refuse legitimate names for legitimate objects and would be switched off within a week
 * (`workflow.md` §11a's *a suite that goes red under load teaches a team to ignore red*).
 */
export function assertRequestVocabularyNamesNoOrganization(
  vocabulary: readonly string[] = TENANT_ADMIN_REQUEST_VOCABULARY,
): void {
  for (const name of vocabulary) {
    if (isOrganizationShapedName(name)) {
      throw new TenantAdminRegistrationError(
        `'${name}' was added to TENANT_ADMIN_REQUEST_VOCABULARY and names an Organization. ` +
          '`0044` §3b.2: the tenant comes from the authenticated context and from nowhere else, ' +
          'and no request shape in this class may contain an organization identifier in any ' +
          'position. If a route genuinely needs to act on a DIFFERENT Organization than the ' +
          "caller's, it does not belong in this class — that is a platform operation, `0025` D3, " +
          'behind a permission a tenant principal cannot hold.',
      );
    }
  }
}

/**
 * The spellings this heuristic recognises. See the caller for what it cannot see.
 *
 * `org` IS MATCHED AS A WHOLE TOKEN rather than as a substring, so `organization` and `org_id`
 * are caught while a hypothetical `orgy_of_fields` — or, more realistically, any name that merely
 * contains those three letters — is not. A substring match on three common letters is a check that
 * fires on unrelated names and is then relaxed by whoever meets it.
 */
function isOrganizationShapedName(name: string): boolean {
  const lowered = name.toLowerCase();
  if (lowered.includes('organization') || lowered.includes('organisation')) {
    return true;
  }
  return lowered.split(/[^a-z0-9]+/u).includes('org');
}

/**
 * ===========================================================================================
 * *** NO ROUTE DECLARES AN ORGANIZATION IDENTIFIER IN ANY REQUEST POSITION. `0044` §3b.2,
 * REFUSED AT REGISTRATION. ***
 * ===========================================================================================
 *
 * Four positions, and the fourth is the one the type system cannot reach:
 *
 *   BODY FIELDS       typed `TenantAdminRequestName` — the union already refuses an unlisted name
 *   QUERY PARAMETERS  same
 *   PATH PARAMETERS   **A STRING. Nothing types `/organizations/{organization_id}/members`.**
 *   THE PATH ITSELF   a literal segment is not an identifier and is not checked here
 *
 * **SO THIS FUNCTION'S REAL SUBJECT IS THE PATH**, and the two declared sets are re-checked anyway
 * because a `readonly TenantAdminRequestName[]` can be produced by a cast and because a check that
 * examines three of four positions is one somebody will later describe as covering all four.
 *
 * IT REFUSES **EVERY** PATH PARAMETER WHOSE NAME IS ORGANIZATION-SHAPED, and it also refuses any
 * path parameter whose name is not in the request vocabulary — so a `{organization_id}` is caught
 * twice and a `{workspace_id}` is caught once, by the vocabulary, which is where a human looks.
 */
export function assertNoOrganizationIdentifierInAnyRequestPosition(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  vocabulary: readonly string[] = TENANT_ADMIN_REQUEST_VOCABULARY,
): void {
  const permitted = new Set(vocabulary);
  for (const route of routes) {
    const positions: readonly (readonly [string, readonly string[]])[] = [
      ['body field', route.fields],
      ['query parameter', route.queryParameters],
      ['path parameter', pathParameterNames(route.path)],
    ];
    for (const [position, names] of positions) {
      for (const name of names) {
        if (isOrganizationShapedName(name)) {
          throw new TenantAdminRegistrationError(
            `'${route.id}' declares the ${position} '${name}', which names an Organization. ` +
              '`0044` §3b.2 refuses this AT REGISTRATION rather than at authorization, because a ' +
              'route that can accept a tenant identifier is one authorization has to be right ' +
              'about on every call, forever. The tenant is on the caller\'s session row and ' +
              '`TenantAdminAuthority` already carries it.',
          );
        }
        if (!permitted.has(name)) {
          throw new TenantAdminRegistrationError(
            `'${route.id}' declares the ${position} '${name}', which is not in ` +
              'TENANT_ADMIN_REQUEST_VOCABULARY. Every name this class accepts is enumerated in ' +
              'one reviewed list so that an unlisted name is refused by DEFAULT rather than ' +
              'permitted by default (`architecture.md` §3a-i). Add it to the union AND the array ' +
              'in tenant-admin-routes.ts, and answer one question while you are there: does this ' +
              'name identify an Organization?',
          );
        }
      }
    }
  }
}

/** Declared `{name}` segments of a path template. */
function pathParameterNames(path: string): readonly string[] {
  const names: string[] = [];
  for (const segment of path.split('/')) {
    if (segment.startsWith('{') && segment.endsWith('}') && segment.length > 2) {
      names.push(segment.slice(1, -1));
    }
  }
  return names;
}

/**
 * ===========================================================================================
 * *** EVERY ROUTE DECLARES A BOUND ON WHAT IT MAY READ. `0044` §3c, A REGISTRATION FAILURE. ***
 * ===========================================================================================
 *
 * The field is required, so "absent" is already a compile error. **What this adds is the two
 * DIRECTIONS**, and the second is the one a required field cannot give you:
 *
 *   a `page-cap` route MUST declare `page_size` AND `cursor`   — otherwise the cap is unreachable
 *                                                                and the caller cannot page
 *   a route declaring `page_size` MUST be `page-cap`           — otherwise a paginated route has
 *                                                                claimed `no-collection`
 *
 * **THE SECOND CHECK IS THE ONE THAT CATCHES A LIE RATHER THAN AN OMISSION**, and `workflow.md`
 * §11a's test for whether two checks are one check applies: each goes red on an input the other
 * passes — a `page-cap` route with no `page_size` passes the second and fails the first; a
 * `no-collection` route with `page_size` passes the first and fails the second.
 *
 * `no-collection` MUST CARRY A NON-EMPTY REASON. It is the escape hatch, so the cost of using it
 * is writing down why, at the site, where a reviewer reads the table.
 */
export function assertEveryReadShapeIsBounded(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  maxPageSize: number = TENANT_ADMIN_MAX_PAGE_SIZE,
): void {
  for (const route of routes) {
    const declaresPageSize = route.queryParameters.includes('page_size');
    const declaresCursor = route.queryParameters.includes('cursor');
    const bound = route.readBound;
    if (bound.kind === 'page-cap') {
      if (
        !Number.isInteger(bound.maxPageSize) ||
        bound.maxPageSize < TENANT_ADMIN_MIN_PAGE_SIZE ||
        bound.maxPageSize > maxPageSize
      ) {
        throw new TenantAdminRegistrationError(
          `'${route.id}' declares maxPageSize ${String(bound.maxPageSize)}, which is not an ` +
            `integer in [${String(TENANT_ADMIN_MIN_PAGE_SIZE)}, ${String(maxPageSize)}]. The ` +
            'class ceiling is a bound on a declaration, never a value a route may inherit.',
        );
      }
      if (!declaresPageSize || !declaresCursor) {
        throw new TenantAdminRegistrationError(
          `'${route.id}' declares a page cap and does not declare both 'page_size' and 'cursor' ` +
            'as query parameters. A cap the caller cannot ask under is a cap on nothing: with no ' +
            "'page_size' the route has no page size at all (this class has no default, `0044` " +
            "§3c), and with no 'cursor' the second page is unreachable so the bound silently " +
            'becomes a truncation.',
        );
      }
      continue;
    }
    if (declaresPageSize) {
      throw new TenantAdminRegistrationError(
        `'${route.id}' declares the query parameter 'page_size' and a readBound of ` +
          `'${bound.kind}'. A route that pages is a route that returns a collection. This is the ` +
          'direction that catches a LIE rather than an omission, and the lie is the one `0044` ' +
          '§3c predicts: a route whose bound was chosen to avoid declaring one.',
      );
    }
    if (bound.kind === 'bounding-index') {
      if (bound.index.trim() === '') {
        throw new TenantAdminRegistrationError(
          `'${route.id}' declares a bounding index with no name. An index NAME is checkable ` +
            'against a migration; "this read is indexed" is a claim nobody can verify.',
        );
      }
      if (!Number.isInteger(bound.maxRows) || bound.maxRows < 1) {
        throw new TenantAdminRegistrationError(
          `'${route.id}' declares a bounding index and maxRows ${String(bound.maxRows)}. The ` +
            'bound has to be a number, or it is a description of one.',
        );
      }
      continue;
    }
    if (bound.why.trim() === '') {
      throw new TenantAdminRegistrationError(
        `'${route.id}' declares readBound 'no-collection' with no reason. That variant is the ` +
          'escape hatch from `0044` §3c, so the cost of using it is stating why at the site — a ' +
          'reviewer reading the table needs the reason where the claim is, not in a commit ' +
          'message.',
      );
    }
  }
}

/**
 * EVERY MUTATION IS AUDITED, AND ONLY A `GET` MAY DECLINE.
 *
 * `0044` §3c: every mutating route writes an audit record into the tenant's own `audit_event`.
 * `security.md` §6 requires it independently for membership changes, and
 * `0003_organization_membership.sql` named the destination before this class existed.
 *
 * **THE CHECK IS KEYED ON THE EXCEPTION.** It does not ask "is this a mutation and is it audited";
 * it asks "is this NOT a GET", so a fourth method added to `TenantAdminRouteMethod` is audited by
 * default rather than falling through unexamined (`architecture.md` §3a-i).
 */
export function assertEveryMutationIsAudited(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
): void {
  for (const route of routes) {
    if (route.method !== 'GET' && route.audit !== 'required') {
      throw new TenantAdminRegistrationError(
        `'${route.id}' is a ${route.method} and declares audit '${route.audit}'. Every mutating ` +
          "route in this class writes an audit record into the tenant's own audit_event " +
          '(`0044` §3c, `security.md` §6). `not-audited` exists for reads only, and reads are the ' +
          'exception in this class rather than the rule — see tenant-admin-audit.ts for why that ' +
          'differs from the platform class and what it costs.',
      );
    }
  }
}

/**
 * ===========================================================================================
 * *** EVERY CONJUNCT MUST BE IN THE CEILING AND IN SOME ROLE'S FLOOR. `0044` §3d: THE
 * REACHABILITY ASSERTION GOES ONE ARITY UP — PER CONJUNCT, NOT PER ROUTE. ***
 * ===========================================================================================
 *
 * This is `platform-routes.ts::assertEveryRoutePermissionIsReachable` with the loop one level
 * deeper, and that file's history is why it exists at all:
 *
 *   - a route shipped declaring a permission the ENVELOPE did not hold — `forbidden` to every
 *     caller alive, with `typecheck` clean, the confirmation guard green, and the permission-count
 *     guard green, *"because a count says nothing about WHICH permissions are in the set"*;
 *   - fixing the ceiling BROKE THE FLOOR in the same edit, because the role list spread the
 *     unreachable-permission constant. **The same `forbidden`, the opposite cause.**
 *
 * So the check is the whole chain — route -> envelope -> some role — per conjunct.
 *
 * **IT IS NOT THE WHOLE PROPERTY, AND `assertNoRouteConjunctionIsUnsatisfiable` BELOW IS THE REST.**
 * `workflow.md` §11a's test for whether two checks are one: name an input each goes red on that the
 * other passes. `A` in no role at all -> this one fires, that one fires. **`A` in role X only and
 * `B` in role Y only -> THIS ONE IS GREEN and that one fires.** Two checks, one subject, and
 * deleting either removes real coverage.
 */
export function assertEveryRoutePermissionIsReachable(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  declared: readonly string[] = TENANT_ADMIN_PERMISSION_ENVELOPE.declared.map(
    (entry) => entry.permissionId,
  ),
  /**
   * Does SOME tenant role grant this permission?
   *
   * A FUNCTION RATHER THAN A LIST so the check reads the live role mapping rather than a snapshot
   * of it — the snapshot is exactly what went stale in the defect the platform version exists to
   * catch.
   */
  roleHolders: (permissionId: string) => boolean = defaultRoleHolders,
): void {
  for (const route of routes) {
    // ONE LEVEL DEEPER AGAIN FOR A CHALLENGE ROUTE. `conjunctionsOf` yields the single conjunction
    // of a fixed route and the WHOLE RESOLVABLE DOMAIN of a from-body one — and throws rather than
    // yielding nothing, so this loop can never run zero times and report success.
    for (const conjunction of conjunctionsOf(route)) {
      for (const permissionId of conjunction.permissionIds) {
      if (!declared.includes(permissionId)) {
        throw new TenantAdminRegistrationError(
          `'${route.id}' requires the permission '${permissionId}', which is not in ` +
            'TENANT_ADMIN_PERMISSION_ENVELOPE. The envelope is the class ceiling, so authorize() ' +
            'refuses this route for EVERY caller regardless of role — the route serves nobody. ' +
            'Add it to the envelope and move TENANT_ADMIN_ROUTE_PERMISSION_COUNT, which will then ' +
            'demand the argument for widening the class. And check the register first: ' +
            'permission-catalog.yaml is what decides (`0007` rule 4), and a permission still ' +
            "marked `status: proposed` has not been granted — Core's copy may lag it, never lead " +
            'it.',
        );
      }
      if (!roleHolders(permissionId)) {
        throw new TenantAdminRegistrationError(
          `'${route.id}' requires the permission '${permissionId}', which is in the envelope and ` +
            'granted to NO tenant role. The ceiling admits it and the floor does not supply it, ' +
            'so authorize() refuses the route for every caller — the same symptom as an omitted ' +
            'envelope entry, from the opposite cause. Add it to a role in ' +
            'authorization/roles.ts, which is a privilege change and needs the user (`0007` rule ' +
            '9, `security.md` §8).',
        );
      }
      }
    }
  }
}

/**
 * ===========================================================================================
 * *** AND SOME SINGLE ROLE MUST SATISFY THE WHOLE CONJUNCTION. `0044` §3d. ***
 * ===========================================================================================
 *
 * *"A route whose conjunction no role can satisfy is refused to every caller alive, and a
 * conjunction makes that defect easier to create by accident."*
 *
 * Easier, and quieter: each conjunct is individually reachable, every guard above is green, and
 * the route answers `forbidden` to everybody for a reason no single-permission check can see.
 *
 * ===========================================================================================
 * *** WHY CHECKING THE **SEED** ROLES IS SOUND UNDER `0007` D16's CUSTOM ROLES ***
 * ===========================================================================================
 *
 * This is the non-obvious half and it is worth stating, because the natural objection is that a
 * tenant can mint roles this check has never seen.
 *
 * **D16 CONSTRAINT 1: a custom role may contain only permissions the creating principal itself
 * holds — *creating a role is a grant*.** So every custom role's grant set is a SUBSET of its
 * creator's, its creator holds a seed role or a role derived from one, and by induction **no
 * principal can ever hold a permission that no seed role grants.** `0043` §2a puts it in one line:
 * *"a subset of an enumerable set is enumerable."*
 *
 * It follows that if no seed role holds both `A` and `B`, **no custom role can hold both either**,
 * and this check is not merely a useful approximation — it is exact.
 *
 * *** ⚠ EXACT **CONDITIONALLY ON CONSTRAINT 1 BEING ENFORCED, AND IT IS ENFORCED NOWHERE TODAY.**
 * Raised by `security-agent`, 2026-09-13. *** There is no subset check in `platform/core/**`; the
 * word appears only in comments. What makes this check exact right now is that **no custom role
 * can exist** — `core.role.create` has no route and `0022_tenant_role.sql` is unapplied — which is
 * a fact about the world rather than about the code.
 *
 * **THE DAY `core.role.create` LANDS WITHOUT A SUBSET CHECK, THIS ASSERTION SILENTLY STOPS BEING
 * EXACT AND STAYS GREEN**, because it reads the SEED roles and the falsifying grant would be in a
 * custom one. **So the subset check lands in the same change as the creation route, never after
 * it**, in the `WHERE` of the statement that writes a `tenant_role_permission` row
 * (`architecture.md` §3a — the only layer with no window). Full expiry notice at
 * `tenant-admin-permissions.ts`.
 *
 * *** WHAT DOES NOT FOLLOW, AND `0043` §2b IS EMPHATIC ABOUT IT: THE CONVERSE. *** A seed role
 * holding both does NOT mean every holder of `A` holds `B`, because a tenant admin may mint a role
 * holding one. **That is why the route requires the conjunction at authorization time rather than
 * relying on this check** — this assertion answers *"can anybody call this route"*, and
 * `authorize()` answers *"may this caller"*. Reading this green as evidence about a caller is
 * `security.md` §2a-i's exact mistake: an observation about today's roles that a tenant can
 * falsify without touching any code.
 */
export function assertNoRouteConjunctionIsUnsatisfiable(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  roles: readonly MembershipRole[] = MEMBERSHIP_ROLES,
  grantsOf: (role: MembershipRole) => readonly string[] = defaultGrantsOf,
): void {
  for (const route of routes) {
    for (const conjunction of conjunctionsOf(route)) {
    const needed = conjunction.permissionIds;
    if (needed.length < 2) {
      continue;
    }
    const satisfied = roles.some((role) => {
      const held = new Set(grantsOf(role));
      return needed.every((permissionId) => held.has(permissionId));
    });
    if (!satisfied) {
      throw new TenantAdminRegistrationError(
        `'${route.id}' requires ALL of [${needed.join(', ')}] and NO seed role holds every one ` +
          'of them. Each conjunct is individually reachable, so the per-conjunct check above is ' +
          'green, and the route is still `forbidden` to every caller alive. Under `0007` D16 a ' +
          'custom role is a SUBSET of its creator\'s grants, so no custom role can satisfy it ' +
          'either — this is exact rather than approximate. Either one role must hold both, or the ' +
          'capability needs its own permission (`0044` §3d: would a grantor ever want to grant it ' +
          'WITHOUT one of the conjuncts?).',
      );
    }
    }
  }
}

/** The live role mapping, read through the one function that owns it. */
function defaultGrantsOf(role: MembershipRole): readonly string[] {
  return grantsForRole(role).grants.map((grant) => grant.permissionId);
}

function defaultRoleHolders(permissionId: string): boolean {
  return MEMBERSHIP_ROLES.some((role) => defaultGrantsOf(role).includes(permissionId));
}

/**
 * ===========================================================================================
 * A GATED ROUTE MUST HAVE A WAY FOR ITS CALLER TO OBTAIN A CONFIRMATION.
 * `confirmation-v1` · `docs/decisions/0027` · `0007` D15.
 * ===========================================================================================
 *
 * `confirmation-v1`: *"EVERY entry point that resolves a permission of sensitivity `critical`
 * requires a valid, unspent, correctly bound confirmation. No exceptions, no flag, no override."*
 * This class will hold `core.organization.transfer-ownership` and
 * `core.organization.request-deletion`, both `critical` in the catalogue.
 *
 * *** AND THERE IS NO TENANT-FACING CHALLENGE ROUTE. *** `critical-permissions.ts`'s confirmable
 * map is *"the PLATFORM CLASS'S LIST AND NOT THE PLATFORM'S"* by its own header, and
 * `platform-routes.ts` records that `core.confirmations.request` is **deferred until a critical
 * Action exists** because making `Action.permission` dynamic was *"an extension to the most
 * load-bearing shape in the product, to serve a route that currently has nothing to point at."*
 *
 * **THE THING IT HAD NOTHING TO POINT AT NOW EXISTS.** So this check refuses at REGISTRATION
 * rather than letting a critical tenant-admin route ship whose confirmation can never be obtained
 * — which would present as *"transfer ownership always fails"* with every guard green.
 *
 * THE MAP IS EMPTY, so registering a critical route in this class fails the build today, by
 * design, naming the missing work.
 *
 * ===========================================================================================
 * ⚠ THE BOUNDARY OF THIS CHECK, STATED BECAUSE A DEFERRAL WAS ASSIGNED TO IT THAT IT CANNOT
 * CARRY. `architecture.md` §3b-ii — every claim above is true and a reader forms one impression
 * of the block, and that impression is wider than the block.
 * ===========================================================================================
 *
 * **THIS FUNCTION ITERATES `ROUTES`. `ROUTES` IS THE TENANT-ADMIN ROUTE TABLE. IT CANNOT SEE AN
 * ACTION, AND NOTHING ELSE CHECKS ONE.** Measured 2026-09-13:
 *
 *   `assertConfirmationCoverageIsCoherent`     iterates the PLATFORM route table
 *   this function                              iterates the TENANT-ADMIN route table
 *   the Action registries                      **NO registration-time coverage check at all**
 *
 * The only Action-side confirmation code is `action/pipeline.ts`'s `requiresConfirmation(
 * action.permission)` — **a RUNTIME gate in the request path.** So a `critical` Action-class
 * operation with no challenge route does not fail a build. **It authorizes, gates, demands a
 * confirmation the caller cannot obtain, and fails every call** — which is fail-closed and is
 * exactly the *"protected-looking and unreachable"* state a registration check exists to prevent.
 *
 * **WHY THIS SENTENCE IS HERE RATHER THAN IN A REPORT:** `0038`'s deferral of the Action-class
 * challenge route names *this function* as what makes its trigger unmissable. **It is not, and
 * a deferral resting on a check that cannot see its subject is a deferral nobody will collect**
 * (`workflow.md` §12). Raised with the Team Lead the day the ruling was made; recorded here because
 * the next person to read this header is the person most likely to inherit the belief.
 */
export function assertGatedRoutesCanObtainAConfirmation(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  confirmable: readonly string[] = tenantAdminConfirmableOperations(),
): void {
  for (const route of routes) {
    if (!isConfirmationGated(route)) {
      continue;
    }
    if (!confirmable.includes(route.id)) {
      throw new TenantAdminRegistrationError(
        `'${route.id}' requires a permission of sensitivity 'critical', so the confirmation gate ` +
          'refuses it without a valid, bound confirmation — and this class publishes no route ' +
          'that can issue one, so the operation would be unreachable rather than protected. ' +
          'A tenant-facing challenge route is owed by `architecture-agent` (contract) and by Core ' +
          '(the route); `platform-routes.ts` records why `core.confirmations.request` was ' +
          'deferred and that the reason — no critical operation to point at — has expired.',
      );
    }
  }
}

/**
 * ===========================================================================================
 * THE OPERATIONS THIS CLASS'S CHALLENGE ROUTE MAY ISSUE A CONFIRMATION FOR, AND THE CONJUNCTION
 * EACH ONE BORROWS.
 * ===========================================================================================
 *
 * EMPTY, and the emptiness is what makes the checks above bite. A Core-owned frozen literal with no
 * registration function — `critical-permissions.ts`'s shape, and for its reason: *"an entry here
 * decides which permission a challenge is authorized against, so a caller that could add one could
 * obtain a challenge under a permission of its choosing."*
 *
 * **A MAP TO A CONJUNCTION RATHER THAN TO ONE PERMISSION ID**, which is the one place this class
 * departs from the platform version's shape. A tenant-admin target may require `A ∧ B` (`0044`
 * §3d), and a challenge that borrowed only `A` would be obtainable by a caller who cannot perform
 * the operation — the exact property the borrowing exists to preserve, lost to an arity mismatch.
 *
 * *** WHAT GOES IN IT, AND WHY NEITHER ENTRY IS HERE YET. *** The two `critical` tenant operations
 * are `tenant.organization.transfer-ownership` and `tenant.organization.request-deletion`. Their
 * permissions are in `CRITICAL_PERMISSIONS` and in **neither the tenant-admin envelope nor any
 * role** — measured 2026-09-13, both empty. Adding them here would make
 * `assertEveryRoutePermissionIsReachable` fail twice, correctly: **a challenge nobody can obtain
 * for an operation nobody can perform.** `0038` names that failure as *"the mechanism working
 * rather than an obstacle"*. The entries land with the grant, not before.
 */
export const TENANT_ADMIN_CONFIRMABLE_OPERATIONS: Readonly<
  Record<string, TenantAdminConjunction>
> = Object.freeze({});

/** The operation ids a challenge may name. The domain of the resolver. */
export function tenantAdminConfirmableOperations(): readonly string[] {
  return Object.freeze(Object.keys(TENANT_ADMIN_CONFIRMABLE_OPERATIONS));
}

/**
 * The conjunction a tenant-admin challenge borrows, or `undefined` for an operation this class
 * cannot confirm.
 *
 * `hasOwnProperty` RATHER THAN A TRUTHY LOOKUP, so a key like `constructor` or `__proto__` cannot
 * resolve to something off the prototype chain and be treated as a permission.
 */
export function tenantAdminConfirmablePermissionFor(
  actionId: string,
): TenantAdminConjunction | undefined {
  return lookupConjunction(TENANT_ADMIN_CONFIRMABLE_OPERATIONS, actionId);
}

/**
 * The single lookup. **BOTH `resolve` AND `resolvable` MUST READ THE SAME MAP OBJECT, AND THIS
 * FUNCTION EXISTS BECAUSE THE FIRST VERSION DID NOT.**
 *
 * *** THE DEFECT, FOUND BY A CONTROL RATHER THAN BY READING: *** the factory's `resolvable()` read
 * its `confirmable` PARAMETER while its `resolve()` called
 * `tenantAdminConfirmablePermissionFor`, which reads the **module-level constant**. Built with a
 * populated map, the route therefore advertised a resolvable domain and **resolved every request to
 * `undefined`** — `invalid_argument` on every well-formed call, permanently.
 *
 * **AND EVERY REGISTRATION CHECK WOULD HAVE BEEN GREEN**, because they all read `resolvable()`,
 * which was the half that was right. `workflow.md` §11a's *two derivations that share a subject and
 * not a source*: the disagreement is invisible precisely where the checks look.
 *
 * `hasOwnProperty` RATHER THAN A TRUTHY LOOKUP, so `constructor` or `__proto__` cannot resolve to
 * something off the prototype chain and be treated as a permission.
 */
function lookupConjunction(
  confirmable: Readonly<Record<string, TenantAdminConjunction>>,
  actionId: string,
): TenantAdminConjunction | undefined {
  return Object.prototype.hasOwnProperty.call(confirmable, actionId)
    ? confirmable[actionId]
    : undefined;
}

/** The class's challenge route. One id, so no route can be registered under a second spelling. */
export const TENANT_ADMIN_CHALLENGE_ROUTE_ID = 'tenant.confirmations.request';

/**
 * ===========================================================================================
 * *** NO `critical` ROUTE IN THIS CLASS MAY DECLARE A QUERY PARAMETER. ***
 * ===========================================================================================
 *
 * `qa-agent`'s finding on the platform side, and it is about the BINDING rather than about tidiness.
 * The bound parameter set is:
 *
 *   keys(parameters) = ( keys(body) \ {the three confirmation fields} ) ∪ names(pathTemplate(R))
 *                                                                        ^^ THERE IS NO
 *                                                                           queryParameters TERM
 *
 * **So a gated route carrying a query parameter would ACT ON A VALUE THE CONFIRMATION NEVER
 * COVERED** — and the challenge and the submission would agree with each other, because neither saw
 * it. The human confirms a transfer; a query parameter changes what is transferred; the hash matches
 * and the gate reports success.
 *
 * **IT HOLDS ON THE PLATFORM SIDE BY ACCIDENT RATHER THAN BY CONSTRUCTION** — critical operations
 * there are writes, and writes do not paginate, so the overlap is empty for a reason nothing
 * enforces. `workflow.md` §11a: *sound by accident is indistinguishable from sound by design while
 * both are passing.* This makes it a registration failure here instead.
 *
 * **AND THE REAL PRESSURE IS SPECIFIC AND FORESEEABLE**: this class's own `page_size` and `cursor`.
 * The day somebody adds a paginated preview to a `critical` route — *"show me what this deletion
 * will remove"* — that is the shape this refuses, and it will look entirely reasonable.
 *
 * *** VACUOUS TODAY, AND IT SAYS SO RATHER THAN PASSING QUIETLY. *** No route is registered, so
 * `examined` is 0. A count of zero gated routes and a count of zero violations render identically,
 * which is the empty-list reader — hence the population is returned rather than swallowed.
 */
export function assertNoCriticalRouteHasQueryParameters(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
): { readonly examined: number } {
  let examined = 0;
  for (const route of routes) {
    if (!isConfirmationGated(route)) {
      continue;
    }
    examined += 1;
    if (route.queryParameters.length > 0) {
      throw new TenantAdminRegistrationError(
        `'${route.id}' resolves a 'critical' permission and declares the query parameter(s) ` +
          `[${route.queryParameters.join(', ')}]. The confirmation binding is computed from the ` +
          'body minus the three confirmation fields, UNIONED WITH THE PATH PARAMETERS — there is ' +
          'no query-parameter term. So this route would act on a value the confirmation never ' +
          'covered, and the challenge and the submission would agree because neither saw it. Move ' +
          'the value into the body or the path, where the binding reaches it.',
      );
    }
  }
  return { examined };
}

/**
 * ===========================================================================================
 * *** THE CHALLENGE ROUTE, BUILT FROM THE CONFIRMABLE MAP RATHER THAN WRITTEN OUT. ***
 * ===========================================================================================
 *
 * **ITS FIELDS ARE DERIVED FROM ITS TARGETS AND MUST NOT BE TRANSCRIBED.** `workflow.md` §11a: a
 * check — or a route — that holds a name of its own goes stale when the name moves. The parameters
 * this route accepts ARE the parameters of the operations it can confirm, so they are read from
 * those routes. **A target gaining a field would otherwise leave the challenge unable to carry it,
 * and the failure would present as a confirmation that is never found** — a hash mismatch with
 * nothing naming the missing field.
 *
 * *** FLAT, PER `tenant-admin/README.md` §2.4a. *** `confirmation-v1`'s challenge nests them under
 * `parameters`; `confirmation-gate.ts` already rules that on SUBMISSION *"the parameters are the
 * submitted body minus these three fields"*, and refuses the nested form because *"two definitions
 * of the bound value is a binding that covers different things at the two ends."* **Submission was
 * already flat and only the challenge was nested, so flattening here gives this class one
 * definition at both ends.** `confirmation-v1` is not amended — narrowing an accepted contract with
 * a live console is breaking and is the Team Lead's.
 *
 * *** `0044` §3b.2 IS INHERITED, AND IT IS CHECKED ANYWAY — SAY WHICH LAYER CARRIES THE WEIGHT. ***
 * The argument is sound: the challenge route is itself a tenant-admin route, the flat parameters
 * mirror the targets' own fields, and no target may carry an organization identifier, so flattening
 * cannot introduce one. **The load-bearing layer is the targets' own registration check**, not
 * anything here. What this function adds is that the derived set passes through
 * `TenantAdminRequestName`, so a parameter name outside the vocabulary **does not compile** — which
 * catches a target whose field was added without the vocabulary being widened, a case the
 * inheritance argument assumes cannot happen.
 */
export function buildTenantAdminChallengeRoute(
  confirmable: Readonly<Record<string, TenantAdminConjunction>> = TENANT_ADMIN_CONFIRMABLE_OPERATIONS,
  routes: readonly TenantAdminRouteLike[] = ROUTES,
): TenantAdminRouteLike {
  // SEEDED WITH THE ROUTE'S OWN TWO FIELDS, so a target that legitimately declares `action_id` or
  // `locale` cannot produce a DUPLICATE in `fields`. The first version spread the set after two
  // literals and emitted `['action_id','locale','action_id','cursor']` — which `parsePreAuthBody`
  // receives as its allow-list. Found by a control printing the derived list, not by reading it.
  const parameterNames = new Set<TenantAdminRequestName>(['action_id', 'locale']);
  for (const operationId of Object.keys(confirmable)) {
    const target = routes.find((route) => route.id === operationId);
    if (target === undefined) {
      throw new TenantAdminRegistrationError(
        `TENANT_ADMIN_CONFIRMABLE_OPERATIONS names '${operationId}', which is not a registered ` +
          'route in this class. A challenge would then be issuable for an operation no route can ' +
          'perform, and the confirmation would be unspendable: the binding covers the action id ' +
          'and nothing will ever submit it. Register the route, or remove the entry.',
      );
    }
    for (const field of target.fields) {
      parameterNames.add(field);
    }
    // THE PATH PARAMETERS ARE PART OF THE BINDING AND THEREFORE PART OF THE CHALLENGE. Omitting
    // them is the narrower binding `confirmation-v1` refuses by name — *"a recomputation whose key
    // set omits any declared path parameter is a defect and must fail closed"*. On a FLAT challenge
    // they arrive as ordinary body fields, so they must be in the vocabulary like any other.
    //
    // =======================================================================================
    // *** THIS IS THE COLLECTOR FOR THE VOCABULARY OBLIGATION, AND UNTIL 2026-09-13 IT WAS A
    // CAST — WHICH COLLECTED NOTHING. ***
    // =======================================================================================
    //
    // `TENANT_ADMIN_REQUEST_VOCABULARY`'s comment states the safety argument for the flat form:
    // *"the flat parameter names themselves must EACH JOIN THIS UNION AS THEIR TARGET LANDS."*
    // **That sentence is the argument for flat parameters, and nothing enforced half of it.**
    //
    // A target's `fields` are typed `TenantAdminRequestName[]`, so the compiler collects those.
    // **`pathParameterNames` returns `string[]`, and the line below read
    // `parameterNames.add(name as TenantAdminRequestName)`** — so a path parameter outside the
    // vocabulary was admitted silently, becoming a body field on the challenge that
    // `assertRequestVocabularyNamesNoOrganization` never examines. **That is the one position
    // §3b.2 covers by inheritance rather than by mechanism, and the cast is what made the
    // inheritance argument the only thing holding.**
    //
    // *** AND THE COMMENT ABOVE IT CLAIMED THE OPPOSITE. *** This function's header said *"the
    // derived set passes through `TenantAdminRequestName`, so a parameter name outside the
    // vocabulary does not compile"* — true of body fields, false of path parameters, written by
    // the author of the cast. `architecture.md` §3c's *"already checked" names no checker*, in my
    // own file, one line from the thing it was wrong about.
    for (const name of pathParameterNames(target.path)) {
      if (!(TENANT_ADMIN_REQUEST_VOCABULARY as readonly string[]).includes(name)) {
        throw new TenantAdminRegistrationError(
          `'${target.id}' declares the path parameter '{${name}}', which is not in ` +
            'TENANT_ADMIN_REQUEST_VOCABULARY. On a FLAT challenge a path parameter arrives as an ' +
            'ordinary body field, so it must be a declared request name like any other — ' +
            'otherwise it reaches the challenge without passing ' +
            'assertRequestVocabularyNamesNoOrganization, which is the check that refuses an ' +
            'organization identifier at registration. Add it to TenantAdminRequestName and to ' +
            'REQUEST_VOCABULARY, which is one edit the compiler will then check both ways.',
        );
      }
      parameterNames.add(name as TenantAdminRequestName);
    }
  }
  return Object.freeze({
    id: TENANT_ADMIN_CHALLENGE_ROUTE_ID,
    method: 'POST' as const,
    path: `${TENANT_ADMIN_BASE_PATH}/confirmations`,
    permission: Object.freeze({
      kind: 'from-body' as const,
      // BOTH CLOSE OVER THE SAME `confirmable` OBJECT. See `lookupConjunction` for the defect this
      // shape exists to prevent — a resolver reading the module constant while `resolvable` read
      // the parameter, which every registration check was structurally unable to see.
      resolve: (body: Readonly<Record<string, unknown>>) => {
        const actionId = body['action_id'];
        return typeof actionId === 'string' ? lookupConjunction(confirmable, actionId) : undefined;
      },
      resolvable: () => Object.freeze(Object.values(confirmable)),
    }),
    fields: Object.freeze([...parameterNames]),
    // EMPTY, AND `assertNoCriticalRouteHasQueryParameters` DOES NOT COVER THIS ROUTE — it is not
    // gated (see `isConfirmationGated`). Stated here because "the assertion protects it" is exactly
    // the wrong thing for the next reader to believe: the binding has no query term either way.
    queryParameters: Object.freeze([]),
    readBound: Object.freeze({
      kind: 'no-collection' as const,
      why:
        'Issues exactly one challenge and returns it. It reads the confirmable map, which is a ' +
        'frozen Core-owned literal rather than a query, and touches no collection.',
    }),
    // A CHALLENGE IS NOT AUDITED AS A MUTATION HERE. It writes a confirmation record, and the
    // operation it confirms carries the audit. Auditing both would put a row on the audit trail for
    // every abandoned confirmation — including ones a caller was refused — which is a write
    // amplification a caller controls.
    audit: 'not-audited' as const,
    // 201. `confirmation-v1:301`, READ RATHER THAN REASONED FROM. The platform route's first value
    // was 200 with a plausible justification beside it, and the contract said 201.
    successStatus: 201 as const,
  });
}

/**
 * ===========================================================================================
 * *** THE DEFERRAL IS SELF-CLEARING: POPULATE THE MAP AND THE BUILD DEMANDS THE ROUTE. ***
 * ===========================================================================================
 *
 * The challenge route is **not registered today**, and that is forced rather than chosen: its
 * resolvable set is empty, which `conjunctionsOf` refuses at registration, and populating it with
 * the two `critical` tenant operations fails `assertEveryRoutePermissionIsReachable` instead —
 * their permissions are in neither the envelope nor any role.
 *
 * **SO THE OBLIGATION TO REGISTER IT WOULD OTHERWISE BE A COMMENT**, and `workflow.md` §12 is
 * explicit that a deferral nothing collects is one nobody performs. This is the same obligation as
 * a check: **the day somebody adds a confirmable operation, the build says the route is missing.**
 * Nobody has to remember, and it cannot be satisfied by remembering.
 *
 * **IT IS THE PAIR TO `assertGatedRoutesCanObtainAConfirmation` AND NEITHER SUBSUMES THE OTHER**
 * (`workflow.md` §11a's test — name an input each goes red on that the other passes):
 *
 *   a gated route with no entry in the map   -> that one fires, this one is green
 *   an entry in the map with no challenge route -> THIS one fires, that one is green
 */
export function assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  confirmable: readonly string[] = tenantAdminConfirmableOperations(),
): void {
  if (confirmable.length === 0) {
    return;
  }
  if (!routes.some((route) => route.id === TENANT_ADMIN_CHALLENGE_ROUTE_ID)) {
    throw new TenantAdminRegistrationError(
      `TENANT_ADMIN_CONFIRMABLE_OPERATIONS names [${confirmable.join(', ')}], and no route with ` +
        `the id '${TENANT_ADMIN_CHALLENGE_ROUTE_ID}' is registered. A confirmable operation with ` +
        'no route that can issue a challenge for it is an operation that authorizes, gates, and ' +
        'can never be satisfied — protected-looking and unreachable. Register ' +
        'buildTenantAdminChallengeRoute() in ROUTES, and add its id to TenantAdminRouteId.',
    );
  }
}

/**
 * Is any conjunct of this route's permission `critical`?
 *
 * **ANY, NOT ALL.** A conjunction containing one critical permission is a critical operation; a
 * route requiring `A ∧ B` where only `B` is critical performs something critical, and reading the
 * gate off the first conjunct would let the ordering of a list decide whether an irreversible
 * operation is confirmed.
 */
export function isConfirmationGated(route: TenantAdminRouteLike): boolean {
  // ===========================================================================================
  // *** A CHALLENGE ROUTE IS NEVER GATED, AND IT IS A DEADLOCK RATHER THAN A CONVENIENCE. ***
  // ===========================================================================================
  //
  // A from-body route resolves to `critical` conjunctions by definition — that is what it is for —
  // so reading the gate off `conjunctionsOf` would mark it gated. **It would then require a
  // confirmation for itself, the binding covers the action id, and no challenge naming the
  // challenge route can ever be issued.** Every critical operation in the class becomes permanently
  // unreachable *while looking correctly protected*, which is the worst of both.
  //
  // `platform-routes.ts` reaches the same place through `BORROWS_WITHOUT_PERFORMING`; this class
  // gets it from the variant instead, so there is **no list to forget to add a route to**. The
  // property is carried by the `kind`, and `0027`'s prohibition holds — nothing here is a per-route
  // `skipsConfirmation` flag, which is the shape that lets the Action that forgets look like the
  // ones that did not.
  if (route.permission.kind === 'from-body') {
    return false;
  }
  return route.permission.permissionIds.some((permissionId) => requiresConfirmation(permissionId));
}

/**
 * A LITERAL SEGMENT MUST NOT SIT BEHIND A PATH PARAMETER THAT COULD SWALLOW IT.
 *
 * `matchTenantAdminRoute` is first-match-wins, so for two routes of one method and one segment
 * count, **declaration order decides which one a URL reaches.** The platform class learned this
 * with `GET /templates/count` against `GET /templates/{template_id}`, where the only thing keeping
 * the literal reachable was that `count` is five characters and the identifier grammar demands
 * eight — *"a property of that constant, not of these routes."*
 *
 * THIS CLASS WILL HAVE THE SAME PAIRS — `/members/count` beside `/members/{principal_id}` — so the
 * guard is here before the first one rather than after.
 *
 * **NO FLOOR ON THE COMPARISON COUNT, AND THAT IS A DEPARTURE FROM THE PLATFORM VERSION WITH A
 * REASON.** That one throws if it compared zero pairs, because its table has several and zero
 * would mean the pairing stopped matching. **This table has no routes at all, so zero is the
 * correct and expected answer** — a floor here would fail the build today and would have to be
 * disabled, which is worse than not having one. `TENANT_ADMIN_ROUTE_COUNT` is what makes the empty
 * population visible instead, and **the floor is owed here the day that pin moves off zero.**
 */
export function assertNoLiteralShadowedByParameter(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
): void {
  for (let later = 0; later < routes.length; later += 1) {
    const candidate = routes[later].path.split('/').filter((s) => s.length > 0);
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (routes[earlier].method !== routes[later].method) {
        continue;
      }
      const pattern = routes[earlier].path.split('/').filter((s) => s.length > 0);
      if (pattern.length !== candidate.length) {
        continue;
      }
      const shadowed = pattern.every((expected, index) =>
        expected.startsWith('{') && expected.endsWith('}')
          ? !candidate[index].startsWith('{')
          : expected === candidate[index],
      );
      if (shadowed) {
        throw new TenantAdminRegistrationError(
          `'${routes[later].id}' declares '${routes[later].method} ${routes[later].path}', which ` +
            `is DECLARED AFTER '${routes[earlier].id}' ('${routes[earlier].path}') and is covered ` +
            'by its path parameter. Declare the LITERAL route FIRST. Do not "fix" this by ' +
            'tightening the identifier grammar; the grammar is not what should decide it.',
        );
      }
    }
  }
}

/** Every route path sits under the reserved base path. */
export function assertEveryRouteIsUnderTheBasePath(
  routes: readonly TenantAdminRouteLike[] = ROUTES,
  basePath: string = TENANT_ADMIN_BASE_PATH,
): void {
  for (const route of routes) {
    if (!route.path.startsWith(`${basePath}/`) && route.path !== basePath) {
      throw new TenantAdminRegistrationError(
        `'${route.id}' declares the path '${route.path}', which is not under ` +
          `'${basePath}'. Only the base path is reserved — in ` +
          'RESERVED_PRE_AUTH_PATH_PREFIXES and (pending) in core-object-registry.yaml — so a ' +
          'route outside it is a route an App route table could collide with, and ' +
          'assertNoReservedPathCollision would not refuse the collision.',
      );
    }
  }
}

assertRouteCountIsDeclared();
assertRequestVocabularyNamesNoOrganization();
assertNoOrganizationIdentifierInAnyRequestPosition();
assertEveryReadShapeIsBounded();
assertEveryMutationIsAudited();
assertEveryRoutePermissionIsReachable();
assertNoRouteConjunctionIsUnsatisfiable();
assertGatedRoutesCanObtainAConfirmation();
assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist();
// THE RETURNED POPULATION IS DELIBERATELY DISCARDED HERE AND IS NOT THEREBY UNUSED. The assertion
// throws on a violation, which is what module load needs; the count exists so a SUITE can assert
// the check examined something, and today it examines zero. See its own header.
assertNoCriticalRouteHasQueryParameters();
assertNoLiteralShadowedByParameter();
assertEveryRouteIsUnderTheBasePath();

// =============================================================================================
// Matching and host binding
// =============================================================================================

export type TenantAdminRouteMatch = {
  readonly route: TenantAdminRoute;
  /** Declared `{name}` segments, extracted and validated. Empty for a route with none. */
  readonly pathParams: Readonly<Record<string, string>>;
};

/**
 * The identifier grammar for a path parameter — `^[A-Za-z0-9_-]{8,64}$`, the same one
 * `kernel/ids.ts` generates at 22 characters and the platform class validates against.
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

/**
 * Matches an absolute path and method, extracting declared `{name}` segments.
 *
 * A MISMATCHED METHOD RETURNS `undefined` AND THEREFORE 404, NOT 405 — the platform class's
 * reasoning, which holds here for a different reason: a 405 confirms the path exists, and on this
 * class the set of paths that exist is a description of what a tenant may administer.
 *
 * **AN EXTRACTED VALUE IS VALIDATED BEFORE ANY LOOKUP** and a value that could not possibly be an
 * identifier is refused with no database read. It answers as "no route matched" rather than as
 * `invalid_argument`, so a caller cannot use the shape of the refusal to learn which identifier
 * grammars this platform uses.
 *
 * **IT RETURNS `undefined` FOR EVERY INPUT TODAY**, because the table is empty.
 */
export function matchTenantAdminRoute(
  method: string,
  path: string,
): TenantAdminRouteMatch | undefined {
  const requested = normalizePath(path)
    .split('/')
    .filter((segment) => segment.length > 0);
  for (const route of ROUTES) {
    if (route.method !== method) {
      continue;
    }
    const pattern = route.path.split('/').filter((segment) => segment.length > 0);
    if (pattern.length !== requested.length) {
      continue;
    }
    const pathParams: Record<string, string> = Object.create(null) as Record<string, string>;
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index];
      const actual = requested[index];
      if (expected.startsWith('{') && expected.endsWith('}')) {
        // DECODED ONCE, THEN VALIDATED. Decoding after the grammar check would let `%2E%2E` pass a
        // check it should have failed; decoding twice would let a doubly-encoded value slip past
        // one of them.
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

export function tenantAdminRoutes(): readonly TenantAdminRoute[] {
  return ROUTES;
}

/**
 * ===========================================================================================
 * *** THIS CLASS IS MOUNTED ON THE APPLICATION HOST AND REFUSED ON THE ADMIN HOST — WHICH IS
 * THE OPPOSITE POLARITY FROM `isPlatformHost`, AND THE ASYMMETRY IS THE POINT. ***
 * ===========================================================================================
 *
 * Both Workers ship the same `main`, so every route table is present in both. `isPlatformHost`
 * therefore requires the admin host; this requires NOT the admin host.
 *
 * *** IT IS DEFENCE IN DEPTH AND MUST NEVER BECOME THE FIRST LAYER. *** `0044` §3a's construction
 * argument — a platform operator holds no membership, so `TenantAdminAuthorityResolver` refuses
 * them — is the control, and `tenant-admin-authority.ts` additionally probes `platform_operator`
 * on every call. **Authorization runs on rows, not on hostnames.** What this removes is an
 * unnecessary surface: tenant-administration routes answering anything at all on the console where
 * every platform operator already has a session.
 *
 * AN EMPTY `adminHosts` LIST MEANS THIS CLASS IS SERVED EVERYWHERE, which is the opposite
 * direction from `isPlatformHost`'s fail-closed empty list. **That is a genuine asymmetry rather
 * than an oversight**, and it is why the composition root takes `adminHosts` as a required
 * argument with no default: a deployment that forgot to name its admin host would serve tenant
 * administration on the admin console, refused by the authority resolver on every call and
 * present as a surface. Named here so the day somebody makes the list optional they meet the
 * consequence.
 */
export function isTenantAdminHost(adminHosts: readonly string[], hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return !adminHosts.some((host) => host.toLowerCase() === lowered);
}

// =============================================================================================
// The context a handler receives
// =============================================================================================

/**
 * What a tenant-admin handler receives.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `store`, `resolver`, `Env`, any D1 binding, and any
 * organization identifier OTHER than the one on `authority`. A handler reaches control-plane ports
 * that the composition root gave it, each narrowed to what its route needs.
 *
 * **`authority.organizationId` IS THE ONLY TENANT IN SCOPE, AND THERE IS DELIBERATELY NO SECOND
 * PLACE TO PUT ONE.** `tenancy/tenant-context.ts`'s device is to withhold the value; this class
 * cannot do that, because administering the tenant is the job. So the property that replaces it is
 * **singularity**: one field, on one object, produced by one resolver, from the session row.
 */
export type TenantAdminRouteContext = {
  readonly routeId: TenantAdminRouteId;
  readonly authority: TenantAdminAuthority;
  /** Already validated: every key is one the route declared, none repeated, length-bounded. */
  readonly query: ReadonlyMap<string, string>;
  /** Declared `{name}` segments, already validated against the identifier grammar. */
  readonly pathParams: Readonly<Record<string, string>>;
  /**
   * The session this request arrived on. FOR THE CONFIRMATION BINDING AND FOR NOTHING ELSE — a
   * confirmation is bound to the session so that one obtained on one device is not spendable on
   * another, and dies with the session at revocation.
   */
  readonly sessionId: string;
  readonly requestId: string;
  readonly correlationId: string;
  /**
   * Proof that the tenant's write budget has been charged for this request's audit record — or
   * `null` on a route that declares `audit: 'not-audited'` and therefore reserved nothing.
   *
   * *** `null` IS NOT "THE RESERVATION FAILED". A failed reservation refuses the request at step
   * 4b and no handler runs. *** It means this route writes no audit record, so there was nothing to
   * reserve — see the dispatcher's step 4b for why charging unconditionally was a defect rather
   * than a safe default.
   *
   * **A MUTATING HANDLER NEVER SEES `null`**, because `assertEveryMutationIsAudited` confines
   * `not-audited` to `GET` at registration. That is the property that makes this nullable field
   * safe: the case a writer would have to handle is refused before the route exists, rather than
   * being a branch every handler has to remember.
   *
   * It is not store-shaped and cannot be made so: it holds no store, no resolver, no binding and no
   * organization identifier.
   */
  readonly charge: TenantAdminWriteCharged | null;
};

/**
 * What a handler answers with.
 *
 * `target` IS REQUIRED. The audit record has to name what the operation touched, and a handler
 * that could omit it would produce an unattributable log line. `NO_TENANT_ADMIN_TARGET` is the
 * explicit value for an operation that names nothing.
 *
 * THE HANDLER CHOOSES NO STATUS, no headers and no cookie. A tenant-admin route cannot issue,
 * clear or rotate a session credential — the shape of this type is what makes that structural
 * rather than documented.
 */
export type TenantAdminRouteOutcome = {
  readonly body: unknown;
  readonly target: TenantAdminActionTarget;
};

export type TenantAdminRouteHandler = (
  context: TenantAdminRouteContext,
  body: PreAuthBody,
) => Promise<Result<TenantAdminRouteOutcome>>;

export type TenantAdminRouteHandlers = Partial<
  Readonly<Record<TenantAdminRouteId, TenantAdminRouteHandler>>
>;

/**
 * Reads the handler map.
 *
 * IT IS A FUNCTION RATHER THAN AN INLINE INDEX FOR A REASON THAT DISAPPEARS WITH THE FIRST ROUTE:
 * while `TenantAdminRouteId` is `never`, `handlers[route.id]` has type `never`, and calling a
 * `never` is a compile error even after an `undefined` check. Annotating the return type here
 * keeps the dispatcher below written the way it will read once the union has members —
 * **without a cast**, which is what the alternative would have needed.
 */
function lookupHandler(
  handlers: TenantAdminRouteHandlers,
  routeId: TenantAdminRouteId,
): TenantAdminRouteHandler | undefined {
  return handlers[routeId];
}

export type TenantAdminRouteDependencies = {
  readonly handlers: TenantAdminRouteHandlers;
  /**
   * Reads the session credential. THE SAME PORT the authenticated path, the session route class
   * and the platform class use — one credential, one verifier, one set of carrier rules.
   */
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
  /**
   * A session identifier to the principal AND the Organization that session has selected.
   *
   * ===========================================================================================
   * IT RETURNS TWO STRINGS AND NOT AN `AuthenticatedPrincipal`, AND THAT IS THE SEAM.
   * ===========================================================================================
   *
   * `SessionResolver.resolve` produces an `AuthenticatedPrincipal`, which is the value
   * `TenantStoreResolver` consumes and which carries `authorizedBusinessIds` and `grants`. Passing
   * one into this class would put the whole tenant database one function call away from a class
   * that reaches control-plane ports, and would give the class a second, differently-derived grant
   * set beside the one `TenantAdminAuthorityResolver` produces.
   *
   * **A SESSION WITH NO ORGANIZATION SELECTED IS AN ORDINARY STATE AND MUST NOT BE AN ERROR TO THE
   * POINT OF HIDING IT** (`session-resolution.ts`). The composition root maps it to
   * `failed_precondition`: the caller's correct response is to select an Organization, it is a
   * fact about the caller's own session, and it discloses nothing.
   */
  /**
   * *** THE ORGANIZATION IS BRANDED, AND THAT IS WHAT MAKES `0044` §3a's CLAIM TRUE OF BOTH
   * POPULATIONS RATHER THAN ONE. *** See `authenticated-organization.ts`: the seal takes an
   * `AuthenticatedPrincipal`, which only a `PrincipalResolver` can produce, so **there is no step
   * in this chain that accepts a request-supplied string.**
   */
  readonly authenticateTenantPrincipal: (
    sessionId: string,
  ) => Promise<
    Result<{
      readonly principalId: string;
      readonly organizationId: AuthenticatedOrganizationId;
    }>
  >;
  readonly authority: TenantAdminAuthorityResolver;
  readonly authorizer: Authorizer;
  readonly audit: TenantAdminAuditRecorder;
  /**
   * =========================================================================================
   * *** THE INVITATION CAPABILITY, AS A SERVICE. THERE IS DELIBERATELY NO `InvitationStore`
   * FIELD ON THIS TYPE, AND ADDING ONE WOULD DEFEAT TWO CHECKS AT ONCE. ***
   * =========================================================================================
   *
   * `GrantCeilingCleared` is verified in two places, and each sees something the other cannot:
   *
   *   `InvitationService.create`         the GRANTOR and the OFFER FINGERPRINT
   *   `InvitationStore.createInvitation` the BRAND and the ORGANIZATION
   *
   * **A handler holding the store gets the tenant-isolation half and neither of the others** — so
   * it could spend a clearance minted for a different administrator, or for a different offered
   * role, with every check in the write path green. `composition.ts` therefore takes the store,
   * builds the service, and **never republishes the store**.
   *
   * *** THIS IS A COMPOSITION-TIME PROPERTY AND NOT A TYPE-LEVEL ONE. SAY SO. *** Nothing stops the
   * worker entry that CONSTRUCTS the store from also handing it to something else — the type system
   * cannot see that, because `createD1InvitationStore` has to be exported for the entry to call it.
   * **The closure holds for everything composed through `createTenantAdminComposition`, which is
   * every route in this class, and it is a convention above that line rather than a mechanism.**
   * The type-level version would require the store to be unconstructable outside the service, which
   * means the D1 binding inside a domain file — `architecture.md` §6 forbids that, and the trade is
   * not close.
   */
  readonly invitations: InvitationService;
  /**
   * The confirmation gate. THE SAME ONE the Action pipeline and the platform class use.
   *
   * OPTIONAL IN THE TYPE, AND **ABSENT MEANS REFUSED** RATHER THAN ABSENT MEANS OPEN. A gated
   * route with no composed gate answers `unavailable`. There is no `gate ?? allowEverything()`,
   * and a default would mean the top rung of the sensitivity ladder is optional per deployment.
   */
  readonly confirmations?: ConfirmationGate;
  /**
   * The hostnames on which the PLATFORM console is served. This class is refused on them.
   *
   * REQUIRED, NO DEFAULT. See `isTenantAdminHost` for why an empty list is permissive here and
   * fail-closed there.
   */
  readonly adminHosts: readonly string[];
};

export type TenantAdminRouteRequest = {
  /** Declared `{name}` segments, validated by `matchTenantAdminRoute`. */
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
 * Parses and validates the query string against the route's declared set.
 *
 * THREE REFUSALS, EACH CLOSING SOMETHING — and they are `platform-routes.ts::parseQuery`'s three,
 * because they are `0021`'s three:
 *
 *   1. A ROUTE THAT DECLARES NO PARAMETERS REFUSES ANY QUERY STRING AT ALL. Not "filters unknown
 *      keys" — refuses, so a future route cannot acquire one by accident.
 *   2. AN UNDECLARED PARAMETER IS `invalid_argument`, never ignored. An ignored parameter is one
 *      edit from being read, and in this class the parameter somebody would ignore is
 *      `?organization_id=`.
 *   3. A REPEATED PARAMETER IS `invalid_argument`, never first-wins or last-wins. A precedence
 *      rule is a way for a caller to shadow a value a reviewer assumed was authoritative.
 *
 * ===========================================================================================
 * *** IT IS A SECOND IMPLEMENTATION OF A FUNCTION THAT ALREADY EXISTS, AND THAT IS A HAZARD
 * RATHER THAN A CHOICE I AM PLEASED WITH. ***
 * ===========================================================================================
 *
 * This repository's own rule, quoted by `session-routes.ts` and again by the platform class: **two
 * validation floors that were meant to be identical are two floors that will differ.** The
 * platform class's `parseQuery` is module-private, so it cannot be imported, and exporting it
 * would mean editing a 2,600-line file another agent may hold.
 *
 * **THE BODY FLOOR IS SHARED AND THIS ONE IS NOT**, which is the honest statement of where the
 * drift can happen: `parsePreAuthBody` below is the same implementation four request classes use.
 * **`qa-agent` is owed a case driving BOTH query floors with one input table** — an undeclared
 * key, a repeated key, an over-long string, an empty string on a route declaring nothing — so that
 * a divergence is a red test rather than a difference nobody compares. Recorded here because a
 * named obligation with no owner and no test is a comment.
 */
function parseQuery(
  route: TenantAdminRoute,
  queryString: string,
): Result<ReadonlyMap<string, string>> {
  if (queryString.length === 0) {
    return ok(new Map());
  }
  if (route.queryParameters.length === 0) {
    return err(invalidArgument([detail('', 'unexpected_query_parameter')]));
  }
  if (queryString.length > TENANT_ADMIN_MAX_QUERY_STRING_LENGTH) {
    return err(invalidArgument([detail('', 'query_string_too_large')]));
  }
  const declared: ReadonlySet<string> = new Set<string>(route.queryParameters);
  const parsed = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(queryString).entries()) {
    if (!declared.has(key)) {
      // The PARAMETER NAME and a stable token. Never the value — echoing a rejected identifier
      // would put it in logs and error bodies.
      return err(invalidArgument([detail(key, 'unknown_parameter')]));
    }
    if (parsed.has(key)) {
      return err(invalidArgument([detail(key, 'repeated_parameter')]));
    }
    parsed.set(key, value);
  }
  return ok(parsed);
}

/**
 * ===========================================================================================
 * *** READS `page_size`. IT IS REQUIRED, AND THERE IS NO DEFAULT. `0044` §3c. ***
 * ===========================================================================================
 *
 * The platform class's `readPageSize` returns 25 when the parameter is absent. **This one refuses**,
 * and the difference is the ruling rather than a preference:
 *
 *   "A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF THIS… A route that forgot its bound and a
 *    route that accepted the default are indistinguishable afterwards."
 *
 * A default is also the wrong shape for a second reason this class has and that one does not:
 * **the cap is per route here.** A class-wide default would be a number that is right for one
 * route's rows and wrong for another's, chosen in a file that knows neither.
 *
 * *** THE COST IS REAL AND IS NAMED RATHER THAN DISCOVERED: every paginated request must send
 * `page_size`. *** A client that omits it gets `invalid_argument` with the field named, not a
 * silent first page. That is more ceremony than the platform class asks for, it was ruled
 * deliberately, and **the way to revisit it is a decision record — not a `?? 25`.**
 *
 * STRICTLY PARSED, NOT COERCED. `Number('25abc')` is `NaN` and `parseInt('25abc')` is 25 — the
 * second is how a malformed value becomes a plausible one. The pattern admits digits and nothing
 * else, so `+25`, ` 25`, `25.0`, `2e1` and `0x19` are refused rather than reinterpreted.
 *
 * THE UPPER BOUND IS ENFORCED RATHER THAN CLAMPED. Clamping 1000 to the cap silently answers a
 * different question from the one asked, and a client paging on the assumption it got 1000 rows
 * would skip records with no error to notice.
 */
export function readPageSize(
  query: ReadonlyMap<string, string>,
  bound: TenantAdminReadBound,
): Result<number> {
  if (bound.kind !== 'page-cap') {
    // A route that does not page has no page size to read, and a caller asking for one has
    // already been refused by `parseQuery` — `page_size` is not in its declared set.
    // `assertEveryReadShapeIsBounded` makes that pairing a registration property rather than a
    // thing this function has to trust.
    return err(invalidArgument([detail('page_size', 'route_does_not_paginate')]));
  }
  const raw = query.get('page_size');
  if (raw === undefined) {
    return err(invalidArgument([detail('page_size', 'required')]));
  }
  if (!/^[0-9]{1,3}$/.test(raw)) {
    return err(invalidArgument([detail('page_size', 'must_be_an_integer')]));
  }
  const value = Number(raw);
  if (value < TENANT_ADMIN_MIN_PAGE_SIZE || value > bound.maxPageSize) {
    return err(invalidArgument([detail('page_size', 'out_of_range')]));
  }
  return ok(value);
}

/**
 * Reads `cursor`, or `null`.
 *
 * IT IS ONLY A LENGTH AND ALPHABET CHECK. Passing it proves nothing: a cursor's signature is
 * verified by the codec. This refuses a value that could not possibly be a cursor BEFORE any HMAC
 * is computed, so junk costs a 400 and no crypto.
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
 * THE ORDER, AND WHY EACH STEP IS WHERE IT IS. It is the platform class's order with one step
 * inserted, and the inserted step is the whole difference between the two classes.
 * ===========================================================================================
 *
 *   1. VALIDATE THE QUERY STRING, then 2. VALIDATE THE BODY. Before authentication, because a
 *      malformed request must not reach credential verification and because the answer to a
 *      malformed request must not depend on whether the caller is authenticated.
 *   3. AUTHENTICATE THE SESSION, and resolve it to a principal **AND THE ORGANIZATION THAT SESSION
 *      HAS SELECTED**. This is the step the platform class does not have. The Organization comes
 *      from the session row — server-side state written by `selectOrganization` after it validated
 *      membership — and from nowhere else.
 *   4. RESOLVE TENANT-ADMIN AUTHORITY. Five denial causes, one `forbidden()`, including the
 *      `platform_operator` probe that closes `0024`'s other half for this class. NONE of them
 *      writes an audit record: a caller who is not a member of this Organization leaves no trace
 *      in that Organization's trail, which is correct — the alternative lets an outsider write
 *      rows into a tenant's audit table.
 *   4b. CHARGE THE TENANT'S WRITE BUDGET, before the gate and before the handler. See
 *      `TenantAdminWriteCharged` for why the ordering transfers from the platform class even
 *      though the attack does not.
 *   5. AUTHORIZE — **EVERY CONJUNCT, ALL OF THEM, ALL EVALUATED.** A denial IS audited.
 *   5b. THE CONFIRMATION GATE, for a route whose conjunction contains a `critical` permission.
 *   6. RUN THE HANDLER.
 *   7. WRITE THE AUDIT RECORD, AND FAIL THE REQUEST IF IT CANNOT BE WRITTEN — for a route that
 *      declares `audit: 'required'`. `0013` D2: the audit event must not fail open, and inability
 *      to record the evidence is not a reason to proceed without it.
 *
 * ===========================================================================================
 * *** STEP 5 EVALUATES EVERY CONJUNCT AND DOES NOT SHORT-CIRCUIT, AND THAT IS DELIBERATE. ***
 * ===========================================================================================
 *
 * `authorize()` is pure and reads a frozen grant list, so there is no measurable work difference
 * to protect here — the timing argument that forces both reads in the authority resolver does not
 * apply to an in-memory set membership test.
 *
 * **WHAT THE FULL EVALUATION BUYS IS THE AUDIT RECORD.** `0043` §2b's whole reason for reaching
 * for a conjunction is that co-holding stopped being readable from the role tables under D16, so
 * **the request record is the only place the pair is visible after the fact.** A short-circuit
 * would record the first conjunct that failed and say nothing about the rest, and a trail that
 * names one half of an `A ∧ B` route says a weaker thing than the system enforced.
 */
export async function dispatchTenantAdminRoute(
  dependencies: TenantAdminRouteDependencies,
  route: TenantAdminRoute,
  request: TenantAdminRouteRequest,
): Promise<Result<unknown>> {
  // ---- 1. The query string, against the route's declared parameters.
  const query = parseQuery(route, request.queryString);
  if (!query.ok) {
    return err(query.error);
  }

  // ---- 2. The body floor, against the route's declared fields.
  //
  // REUSING `parsePreAuthBody` IS DELIBERATE and is the same argument `session-routes.ts` and the
  // platform class make: 4 KiB, 12 fields, 512 characters, no nesting, no undeclared names — one
  // implementation, now four request classes. **Nesting is refused outright**, which is why this
  // class has no `objectFields`.
  const parsedBody = parsePreAuthBody(request.bodyText, route.fields);
  if (!parsedBody.ok) {
    return err(parsedBody.error);
  }

  // ---- 3. The session credential, then the principal AND the selected Organization.
  const sessionId = await dependencies.readSessionId(request.headers);
  if (!sessionId.ok) {
    return err(sessionId.error);
  }
  if (sessionId.value === null) {
    // No credential presented. `unauthenticated()` takes no arguments, so this is byte-identical
    // to the answer for a credential that was presented and rejected.
    return err(unauthenticated());
  }
  const authenticated = await dependencies.authenticateTenantPrincipal(sessionId.value);
  if (!authenticated.ok) {
    return err(authenticated.error);
  }

  // ---- 4. Tenant-admin authority. NO AUDIT RECORD ON ANY DENIAL PATH HERE.
  const authority = await dependencies.authority.resolve(
    authenticated.value.principalId,
    authenticated.value.organizationId,
  );
  if (!authority.ok) {
    return err(authority.error);
  }

  // =========================================================================================
  // ---- 4b. CHARGE THE TENANT'S WRITE BUDGET — **ONLY FOR A ROUTE THAT WILL WRITE A RECORD.**
  // =========================================================================================
  //
  // *** THIS WAS UNCONDITIONAL AND THAT WAS A DEFECT. Corrected 2026-09-13, found by reading the
  // contracts' audit dispositions rather than by a test. ***
  //
  // The platform class reserves on every request, and that is correct THERE because P4 makes every
  // platform route write an audit record — there is no route to exempt. **This class's whole
  // departure from P4 is that reads are not universally audited** (`0044` §3c), so an unconditional
  // reservation charged the tenant's own write allowance **for a read that writes nothing.**
  //
  // **AND IT DEFEATED THE EXACT THING THE EXEMPTION EXISTS FOR.** `0044` §3c's reason for not
  // auditing reads is that *"a write per settings-page view costs the tenant's own allowance for no
  // detection value"* — a reservation per settings-page view costs the same allowance for LESS than
  // no detection value, because it reserves capacity and then discards it. A member browsing the
  // directory would have burned the Organization's write budget one page at a time.
  //
  // *** WHAT IS KEPT IS THE ORDERING, WHICH IS THE HALF THAT WAS LEARNED THE HARD WAY. *** The
  // platform class moved its charge ahead of the gate and the handler to close a measured, targeted
  // denial of service. So for a route that DOES audit, the charge still happens here — before the
  // confirmation gate, before the handler, before any write exists to be performed.
  //
  // `null` IS ONLY EVER REACHED ON A NON-AUDITED ROUTE, and `assertEveryMutationIsAudited` confines
  // those to `GET`. So a mutating handler always holds a real receipt, and the one shape that could
  // go wrong — a write on a route that reserved nothing — is refused at registration rather than
  // trusted here.
  let charge: TenantAdminWriteCharged | null = null;
  if (route.audit === 'required') {
    const reserved = await dependencies.audit.reserve(authority.value);
    if (!reserved.ok) {
      // NO RECORD IS WRITTEN AND NONE CAN BE — the budget for it is exactly what was refused.
      return err(reserved.error);
    }
    charge = reserved.value;
  }

  // ---- 5. Authorization. The class envelope is the CEILING, the membership role's grants are the
  // FLOOR, and neither substitutes for the other. Evaluated at `organization` scope, which is the
  // only scope any route in this class uses.
  //
  // =========================================================================================
  // ---- 5a. RESOLVE THE CONJUNCTION. For a challenge route it comes FROM THE BODY the caller sent.
  // =========================================================================================
  //
  // `confirmation-v1`: the challenge *"RUNS THE FULL AUTHORIZATION OF THE TARGET OPERATION… a
  // caller who could not perform the operation cannot obtain a challenge for it, and receives the
  // identical refusal."* **That is what keeps the endpoint from being an existence oracle over
  // every critical target in the tenant**, reachable by anyone with any session.
  //
  // *** `undefined` IS REFUSED AND NEVER FALLS BACK. *** An unknown or non-string `action_id`
  // answers `invalid_argument`. It does not resolve to a permission of the route's own, and it does
  // not resolve to some default — either would authorize the caller for an operation it did not
  // name, and the human would then confirm one thing while a different thing was authorized.
  //
  // **THE REFUSAL IS `invalid_argument` RATHER THAN `forbidden`, AND THAT IS NOT A LEAK.** The set
  // of confirmable operations is published in the contract, so naming one that does not exist is a
  // shape error about public information. Answering `forbidden` would instead make this route
  // distinguish "no such operation" from "not yours" — which is the oracle, arriving through the
  // error code after being closed at the permission.
  const resolvedPermission =
    route.permission.kind === 'from-body'
      ? route.permission.resolve(parsedBody.value)
      : route.permission;
  if (resolvedPermission === undefined) {
    return err(invalidArgument([detail('action_id', 'unknown')]));
  }

  // EVERY CONJUNCT, AND THE LOOP DOES NOT BREAK EARLY. See the header.
  const evaluated: string[] = [];
  let allowed = true;
  for (const permissionId of resolvedPermission.permissionIds) {
    evaluated.push(permissionId);
    const decision = dependencies.authorizer.authorize(
      authority.value.grants,
      TENANT_ADMIN_PERMISSION_ENVELOPE,
      permissionId,
      TENANT_ADMIN_SCOPE,
    );
    if (!decision.allowed) {
      allowed = false;
    }
  }
  if (!allowed) {
    return recordThen(
      dependencies,
      route,
      authority.value,
      charge,
      evaluated,
      request,
      'denied',
      NO_TENANT_ADMIN_TARGET,
      () => err(forbidden()),
    );
  }

  // ---- 5b. The confirmation gate. `confirmation-v1` says EVERY entry point, and this class is
  // one of five. A route is gated when ANY conjunct is critical — see `isConfirmationGated`.
  if (isConfirmationGated(route)) {
    if (dependencies.confirmations === undefined) {
      // ABSENT MEANS REFUSED. A deployment that cannot verify a confirmation must not perform an
      // irreversible operation.
      return recordThen(
        dependencies,
        route,
        authority.value,
        charge,
        evaluated,
        request,
        'failed',
        NO_TENANT_ADMIN_TARGET,
        () => err(unavailable()),
      );
    }
    const confirmed = await dependencies.confirmations.enforce({
      principalId: authority.value.principalId,
      // NEVER NULL HERE. Step 3 refuses a request with no credential.
      sessionId: sessionId.value,
      // THE ROUTE ID IS THE BOUND OPERATION, so the challenge and the submission cannot name
      // different operations.
      actionId: route.id,
      // THE FIRST CRITICAL CONJUNCT. A confirmation is bound to one permission, and a route is
      // gated because a critical permission is among its requirements — see the note in
      // `isConfirmationGated` on why the gate is keyed on ANY rather than on the first conjunct.
      permissionId: firstCriticalConjunct(route),
      body: parsedBody.value,
      pathParams: request.pathParams,
    });
    if (!confirmed.ok) {
      return recordThen(
        dependencies,
        route,
        authority.value,
        charge,
        evaluated,
        request,
        'denied',
        NO_TENANT_ADMIN_TARGET,
        () => err(confirmed.error),
      );
    }
  }

  // ---- 6. The handler.
  const handler = lookupHandler(dependencies.handlers, route.id);
  if (handler === undefined) {
    // FAIL CLOSED. A registered route with no composed handler is unreachable, not open.
    return recordThen(
      dependencies,
      route,
      authority.value,
      charge,
      evaluated,
      request,
      'failed',
      NO_TENANT_ADMIN_TARGET,
      () => err(unavailable()),
    );
  }

  // A THROWN VALUE IS CAUGHT HERE, BECAUSE OTHERWISE IT WOULD BYPASS THE AUDIT RECORD. The
  // platform class shipped without this for two visits and the effect was invisible from outside:
  // the request rendered `internal()` and disclosed nothing, and **the operation left no trace.**
  // `internal()` and not the thrown value — a thrown object may carry a SQL fragment, a column
  // name, a stack, or a row.
  let outcome: Result<TenantAdminRouteOutcome>;
  try {
    outcome = await handler(
      {
        routeId: route.id,
        authority: authority.value,
        query: query.value,
        pathParams: request.pathParams,
        sessionId: sessionId.value,
        requestId: request.requestId,
        correlationId: request.correlationId,
        charge: charge,
      },
      parsedBody.value,
    );
  } catch {
    return recordThen(
      dependencies,
      route,
      authority.value,
      charge,
      evaluated,
      request,
      'failed',
      NO_TENANT_ADMIN_TARGET,
      () => err(internal()),
    );
  }

  // ---- 7. The record, then the answer. Never the other way round.
  if (!outcome.ok) {
    // A FAILED OPERATION IS STILL RECORDED, with no target: a handler that failed may not know
    // what it was about to touch, and inventing one would make the log assert more than the code
    // knows.
    return recordThen(
      dependencies,
      route,
      authority.value,
      charge,
      evaluated,
      request,
      'failed',
      NO_TENANT_ADMIN_TARGET,
      () => err(outcome.error),
    );
  }
  return recordThen(
    dependencies,
    route,
    authority.value,
    charge,
    evaluated,
    request,
    'ok',
    outcome.value.target,
    () => ok(outcome.value.body),
  );
}

/** The first conjunct that is `critical`. Used only for a route the gate has already claimed. */
function firstCriticalConjunct(route: TenantAdminRoute): string {
  // A `from-body` ROUTE CANNOT REACH HERE. `isConfirmationGated` returns false for the variant —
  // gating a challenge route is a deadlock, not an omission — and this function's only caller sits
  // inside that guard. The narrowing is the compiler being told what the caller already guarantees;
  // it is not a case that needs handling.
  if (route.permission.kind === 'from-body') {
    throw new TenantAdminRegistrationError(
      `'${route.id}' resolves its permission from the request body, and firstCriticalConjunct was ` +
        'reached for it. That is unreachable by construction — isConfirmationGated is false for ' +
        'every from-body route — so this means the gate and this function have drifted apart.',
    );
  }
  for (const permissionId of route.permission.permissionIds) {
    if (requiresConfirmation(permissionId)) {
      return permissionId;
    }
  }
  // UNREACHABLE BY CONSTRUCTION: the only caller is inside `if (isConfirmationGated(route))`, and
  // that function returns true exactly when this loop would find one.
  //
  // **IT THROWS RATHER THAN RETURNING A FALLBACK PERMISSION**, because every candidate fallback is
  // wrong in the dangerous direction: returning the first conjunct would bind a confirmation to a
  // permission that is not critical, and returning an empty string would bind it to nothing.
  // `workflow.md` §11a's third cause — an input that is impossible for a reason nobody stated — so
  // the reason is stated.
  throw new TenantAdminRegistrationError(
    `'${String(route.id)}' was treated as confirmation-gated and carries no critical conjunct. ` +
      'isConfirmationGated and this function read the same list through the same predicate, so ' +
      'reaching here means one of them has been changed without the other.',
  );
}

/**
 * Writes the audit record and then produces the answer — or replaces the answer with
 * `unavailable` if the record could not be written.
 *
 * `answer` IS A THUNK RATHER THAN A VALUE so that the ordering reads as what it is: THE RECORD IS
 * WRITTEN FIRST AND THE ANSWER IS PRODUCED SECOND.
 *
 * ===========================================================================================
 * *** A ROUTE DECLARING `audit: 'not-audited'` SKIPS THE RECORD ENTIRELY — INCLUDING ITS
 * DENIALS — AND THAT IS THE CLASS'S DECLARED DEPARTURE FROM P4. ***
 * ===========================================================================================
 *
 * `0044` §3c: reads are not universally audited here, because a write per settings-page view costs
 * the tenant's own allowance for no detection value. `assertEveryMutationIsAudited` confines the
 * exception to `GET`.
 *
 * *** AND `§3c` AS AMENDED 2026-09-13 BOUNDS WHAT THAT LICENSES, WHICH IS NARROWER THAN THIS
 * PARAGRAPH ORIGINALLY IMPLIED. *** The actor's position — inside the tenant rather than reaching
 * in from outside — **licenses only the ABSENCE OF A BLANKET READ AUDIT. It licenses no individual
 * exemption.** A `sensitive` read is audited unless a per-route argument says otherwise, **and
 * that argument may not be the actor's position**, because being inside the tenant is true of every
 * route in this class and therefore distinguishes none of them.
 *
 * **SO `audit: 'not-audited'` IS NOT SATISFIED BY CITING THIS SECTION.** It needs a reason true of
 * one route. This comment carried the record's original wording and was still doing the licensing
 * job — see `tenant-admin-audit.ts` for the transcription defect that made the widened reading
 * available in the first place.
 *
 * **THE COST IS THAT A DENIED READ LEAVES NO TRACE**, so a member probing which sections they
 * cannot reach is invisible on an unaudited route. That is the trade `0044` §3c made explicitly,
 * and the lever for changing it is per route: a read whose denials matter declares
 * `audit: 'required'`.
 *
 * WHAT THIS CANNOT FIX, AND IT IS THE PLATFORM CLASS'S SENTENCE UNCHANGED: for a route that
 * mutates, the operation's own control-plane rows are already committed by the time this runs. A
 * failed audit write turns a completed operation into a 503, and the caller cannot tell that from
 * an operation that never happened. That is the two-database problem, which cannot be solved, only
 * chosen — and the choice is to refuse rather than report a success that has no evidence.
 */
async function recordThen(
  dependencies: TenantAdminRouteDependencies,
  route: TenantAdminRoute,
  authority: TenantAdminAuthority,
  charge: TenantAdminWriteCharged | null,
  permissionIds: readonly string[],
  request: TenantAdminRouteRequest,
  outcome: 'ok' | 'denied' | 'failed',
  target: TenantAdminActionTarget,
  answer: () => Result<unknown>,
): Promise<Result<unknown>> {
  if (route.audit === 'not-audited') {
    return answer();
  }
  if (charge === null) {
    // ===========================================================================================
    // UNREACHABLE BY CONSTRUCTION, AND REFUSED RATHER THAN CAST AROUND.
    // ===========================================================================================
    //
    // Step 4b reserves whenever `route.audit === 'required'`, and the line above has already
    // returned for the only other value — so by this point a `null` means the two branches have
    // been edited apart. **`workflow.md` §11a's third cause: an input that is impossible for a
    // reason nobody stated**, so the reason is stated here rather than silenced with a
    // non-null assertion.
    //
    // **IT FAILS THE REQUEST RATHER THAN PROCEEDING UNRECORDED.** `0013` D2: the audit event must
    // not fail open, and a route that declares `audit: 'required'` and reaches this line would
    // otherwise answer successfully with no evidence that it ran — which is the exact state
    // `platform-routes.ts` describes as the log saying an operation never happened.
    return err(unavailable());
  }
  // THE RECORDER'S OWN THROW IS CAUGHT TOO. `platform-audit.ts` promises no `catch {}` and every
  // failure path returning `unavailable()` — and that is a promise about the RECORDER, not about
  // the store beneath it. A D1 adapter or a missing binding can throw, and a throw here escapes to
  // the outer boundary from the code whose entire job is to make sure the operation left evidence.
  //
  // `answer()` IS DELIBERATELY OUTSIDE THE `try` — it only constructs a `Result`, and putting it
  // inside would let this `catch` mean two different things.
  let recorded: Result<void>;
  try {
    recorded = await dependencies.audit.record({
      authority,
      actionId: String(route.id),
      permissionIds,
      outcome,
      target,
      requestId: request.requestId,
      correlationId: request.correlationId,
      charge,
    });
  } catch {
    return err(unavailable());
  }
  if (!recorded.ok) {
    return err(recorded.error);
  }
  return answer();
}
