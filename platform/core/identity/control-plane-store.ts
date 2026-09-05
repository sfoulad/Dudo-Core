/**
 * ===========================================================================================
 * THE IDENTITY CONTROL PLANE — the storage port. `docs/decisions/0014` §C, Accepted.
 * ===========================================================================================
 *
 * WHY IT EXISTS, because the shape of every type below follows from it.
 *
 * `core-object-registry.yaml` records `Session` as `tenancy: tenant-scoped`, and that entry is
 * CIRCULAR. Under `docs/decisions/0006` Option A a tenant-scoped read requires a tenant-scoped
 * store handle; a tenant-scoped store handle comes only from `TenantStoreResolver`; the resolver
 * takes an Organization identifier — and the Organization is precisely what the session is being
 * read to DISCOVER. A tenant-scoped session cannot be read before the tenant is known.
 * `OrganizationMembership` is worse: the question "which Organizations may this principal enter"
 * spans tenants by construction, so no single tenant scope can answer it at all.
 *
 * `0014` §C resolves it: sessions are PRINCIPAL-SCOPED control-plane records, membership is a
 * CONTROL-PLANE relationship, and both live behind this port, in a dedicated D1 database, with
 * Customer and every other business object left exactly where they were — behind
 * `TenantStoreResolver`, unchanged (§C.4).
 *
 * ===========================================================================================
 * THE DANGER THIS FILE IS DESIGNED AGAINST, STATED FIRST BECAUSE EVERY DECISION BELOW SERVES IT
 * ===========================================================================================
 *
 * The strongest property in this codebase is that AN ACTION HANDLER IS NEVER GIVEN THE
 * ORGANIZATION IDENTIFIER (`tenancy/tenant-context.ts`). App code cannot write a tenant
 * predicate correctly, incorrectly, or at all, because it has no value to write one with.
 *
 * THE CONTROL PLANE IS THE ONE COMPONENT IN THE PLATFORM WHOSE ENTIRE PURPOSE IS TO HOLD AND
 * RESOLVE TENANT IDENTITY. A handle to it, reachable from an Action, would hand App code the
 * organization identifier by another route, and would additionally expose one principal's list
 * of Organizations to every Organization it belongs to — the exact disclosure
 * `core-object-registry.yaml` open question CO1 names ("a user's list of Organizations must
 * never be visible to any of them").
 *
 * FOUR PROPERTIES KEEP THAT STRUCTURAL RATHER THAN ASPIRATIONAL:
 *
 * 1. THIS PORT IS NOT A STORE. It has no `select(spec)`, no table name, no predicate, no column
 *    list and no sort. It is a fixed list of named questions, each one a question the identity
 *    layer actually asks. `TenantScopedStore` is general because a hundred Actions need a
 *    hundred queries; this port serves one resolution algorithm, so generality here would buy
 *    nothing and would make a leaked handle unbounded instead of bounded.
 *
 * 2. NO METHOD ANSWERS A QUESTION ABOUT AN ORGANIZATION ALONE. Every membership question is
 *    keyed by the principal — `(principalId, organizationId)` or `principalId` — so the port
 *    physically cannot be asked "does this Organization exist" or "who belongs to this
 *    Organization". `TenantDirectoryStore` is the single organization-keyed lookup, and it is a
 *    SEPARATE INTERFACE for that reason; see below.
 *
 * 3. IT IS SPLIT IN TWO, AND EACH CONSUMER RECEIVES ONLY ITS HALF. The identity resolution
 *    service gets `IdentityControlPlaneStore` and cannot reach the tenant directory. The
 *    directory-backed `TenantStoreResolver` gets `TenantDirectoryStore` and cannot read a
 *    session, a principal or a membership. Least privilege between two Core components, not
 *    only between Core and Apps.
 *
 * 4. NOTHING PUTS EITHER HALF ON `ActionContext`, AND AN APP CANNOT BUILD ONE. Constructing the
 *    adapter requires a D1 binding, and App code never sees `Env` or a binding
 *    (`CLOUDFLARE_STANDARD.md` §2, and the composition root passes an Action nothing but an
 *    `ActionContext`). Importing this module gives an App a type and a factory that needs a
 *    binding it does not have — exactly the position it is already in with respect to
 *    `createD1TenantStore` and `TENANT_COLUMN`.
 *
 * A NEGATIVE CONTROL FOLLOWS FROM 4 AND IS CHEAP TO RUN: `ActionContext`
 * (`tenancy/tenant-context.ts`) must not mention this module, and `platform/core/action/**` and
 * `apps/**` must not import it. Both are one grep.
 *
 * ===========================================================================================
 * WHAT IS NOT DECIDED HERE, AND IS NOT DECIDED ANYWHERE ELSE EITHER
 * ===========================================================================================
 *
 * `0014` §C does not choose an identity provider or a credential format, and this file must not
 * choose one as a side effect of needing a key. So:
 *
 *   - `findSession` takes a `sessionId`. HOW A CREDENTIAL BECOMES A SESSION IDENTIFIER IS NOT
 *     DECIDED AND IS NOT IMPLEMENTED. There is no credential column on the session record, no
 *     verifier, no hash and no token format anywhere in this module.
 *   - IF THE CHOSEN CREDENTIAL FORMAT EVER MAKES THE BEARER TOKEN AND THE SESSION IDENTIFIER
 *     THE SAME VALUE, this schema stores a credential in plaintext and MUST gain a verifier
 *     column first. That is an additive migration and a real constraint on the undecided
 *     decision, recorded here so it is not discovered afterwards.
 */

import type { Result } from '../kernel/result.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import type { ControlPlaneWriteReservation } from './control-plane-admission.ts';
/**
 * ===========================================================================================
 * `import type` IS LOAD-BEARING HERE. DO NOT "TIDY" IT INTO A VALUE IMPORT.
 * ===========================================================================================
 *
 * `verbatimModuleSyntax` erases this line, so there is NO RUNTIME EDGE from `identity/**` to
 * `platform/**` — only the compile-time obligation that `createMembership`'s third argument
 * cannot be fabricated. The value side of the relationship runs the other way, as it should:
 * `platform/platform-authority.ts` performs the read, and the D1 adapter imports its verifier.
 *
 * DROPPING THE `type` KEYWORD CREATES AN IMPORT CYCLE — `identity` → `platform` → ... → back —
 * AND IT WILL NOT LOOK LIKE ONE. It compiles, review reads it as a formatting change, and the
 * failure arrives at MODULE LOAD in a deployed Worker, where a partially-initialised module
 * yields `undefined` for an export that every authenticated request depends on. That is a
 * cold-start failure on the control plane, which is the worst place in the platform to discover
 * an import-order problem.
 *
 * THE CHECK, AND IT IS WORTH RUNNING WITH THE OTHER NEGATIVE CONTROLS. Within
 * `platform/core/identity/**` there are exactly TWO value imports from
 * `platform/core/platform/**`, and both are intended:
 *
 *   1. `adapters/d1/d1-control-plane-store.ts` imports `consumeMembershipAdmission`. This is the
 *      direction that is supposed to exist — the adapter reaches into the platform module for the
 *      verifier, and `platform-authority.ts`'s own value imports are the kernel and
 *      `platform-permissions.ts`, neither of which reaches back.
 *   2. `tools/seed-platform-operator.ts` imports `PLATFORM_ROLES`, `toPlatformRole` and
 *      `reachablePlatformPermissions`. That file is a COMMAND-LINE TOOL, is imported by nothing
 *      under `platform/core/http/**`, and is not in the Worker's module graph at all — so it
 *      cannot participate in a load-time cycle regardless of what it imports.
 *
 * A THIRD ONE NEEDS AN ARGUMENT. `control-plane-store.ts` — this file — must never become one.
 *
 * *** WRITE THAT CHECK TO HANDLE MULTI-LINE IMPORTS AND TO STRIP COMMENTS FIRST. *** A naive
 * line-oriented grep misses `import {\n  a,\n  b,\n} from '...'` entirely, because the path is on
 * a different line from the keyword — and it matches the word "import" inside prose like this
 * paragraph. Both mistakes were made while writing this comment, and the first one produced a
 * confident count that was wrong by one.
 */
import type { MembershipAdmission } from '../platform/platform-authority.ts';

// =============================================================================================
// Records. Each one is the minimum the resolution algorithm reads, and no more.
// =============================================================================================

/**
 * The principal types the platform recognises. Identical to `AuthenticatedPrincipal`'s union
 * (`tenancy/tenant-context.ts`) and deliberately not re-derived from it: a stored value is data
 * that a migration wrote, and it is validated on read rather than trusted to match a type.
 */
export type ControlPlanePrincipalType =
  | 'user'
  | 'team'
  | 'service-account'
  | 'ai-agent'
  | 'iot-device';

export type PrincipalStatus = 'active' | 'suspended';

/**
 * A principal, platform-wide.
 *
 * WHAT IT DELIBERATELY HAS NO FIELD FOR: an email address, a display name, a phone number, a
 * locale, or any other human profile attribute. `core-object-registry.yaml` is explicit —
 * "everything ABOUT a user within a tenant hangs off OrganizationMembership" — and the control
 * plane is the one table in the platform that spans every Organization. A directory of every
 * user's email address, readable without a tenant scope, is the single highest-value target in
 * the system and it would exist for the convenience of a login screen.
 *
 * It also has no credential material: see the header.
 *
 * ===========================================================================================
 * THE TWO MUTUAL-EXCLUSION FLAGS. `docs/decisions/0025` decision 1, `docs/decisions/0024`.
 * ===========================================================================================
 *
 * `platform-operator-v1` states the rule normatively: a principal present in BOTH
 * `platform_operator` AND `organization_membership` is *"refused everywhere — not resolved in
 * favour of either, not treated as a platform operator, not treated as a tenant member. BOTH ITS
 * PLATFORM ROUTES AND ITS ACTIONS DENY."*
 *
 * The platform half lives in `platform/platform-authority.ts`. THIS IS THE ACTION HALF, and it is
 * here — on the principal record — rather than as a fifth port method for one reason: **the
 * statement that reads this row already runs on every authenticated request**, so two correlated
 * subqueries against two primary-key indexes cost NO ADDITIONAL ROUND TRIP and no additional
 * statement. A separate method would have cost one of each, on the hottest path in the platform.
 *
 * BOTH FLAGS ARE REQUIRED, AND NEITHER ALONE IS THE CONDITION. Refusing on
 * `isPlatformOperator` alone would lock out every legitimate platform operator — they must still
 * authenticate, because `whoami` and the console depend on it. Refusing on `holdsMembership`
 * alone would refuse every ordinary user in Dudo. **The defect is the CONJUNCTION**, which is
 * exactly what makes it easy to write the check backwards, and why the two are carried as
 * separate facts rather than pre-combined into one boolean by the adapter.
 *
 * THEY ARE REQUIRED FIELDS, NOT OPTIONAL ONES. An optional flag defaulting to `undefined` reads
 * as `false`, which is the fail-OPEN direction: a store implementation that forgot them would
 * silently admit exactly the principal this exists to refuse.
 */
export type PrincipalRecord = {
  readonly principalId: string;
  readonly principalType: ControlPlanePrincipalType;
  readonly status: PrincipalStatus;
  /** True when a `platform_operator` row exists for this principal, whatever role it carries. */
  readonly isPlatformOperator: boolean;
  /**
   * True when ANY `organization_membership` row exists for this principal — active, suspended, or
   * otherwise.
   *
   * ANY ROW COUNTS, and the breadth is deliberate. `0024`'s invariant is that a platform principal
   * holds ZERO memberships: "not a scoped one, not a read-only one, not one just for the tenant
   * being supported". Ignoring suspended rows would let a suspended membership be reactivated
   * later and turn a compliant operator into a violating one with no code change anywhere.
   *
   * IT IS A COUNT COLLAPSED TO A BOOLEAN AND NEVER THE ROWS. `core-object-registry.yaml` CO1 —
   * "a user's list of Organizations must never be visible to any of them" — is why this is not a
   * list.
   */
  readonly holdsMembership: boolean;
};

export type OrganizationStatus = 'active' | 'suspended';

/**
 * An Organization, as the control plane knows it: an identifier and a status.
 *
 * NO NAME COLUMN, and the omission follows `platform/core/migrations/0002_business.sql`, which
 * declined a Business name for the same reason: the organization-structure slice owns the
 * Organization data model, it has no contract yet, and adding a display name here would be
 * deciding Core's shape as a side effect of unblocking a login. The consequence is real and is
 * reported rather than hidden — an Organization picker built on this port can list identifiers
 * and not names.
 */
export type OrganizationRecord = {
  readonly organizationId: string;
  readonly status: OrganizationStatus;
};

export type MembershipStatus = 'active' | 'suspended';

/**
 * Binds one principal to one Organization, and carries the grant.
 *
 * `role` ARRIVED WITH `docs/decisions/0019`, WHICH CLOSED AZ5. Until then this record deliberately
 * had no role, no permission and no grant, because `0007` did not say where a principal's grants
 * were stored and a column encoding them would have settled that silently. The decision now
 * exists, and the mapping from role to permissions is `authorization/roles.ts` — never a
 * conditional on the role name anywhere else.
 *
 * `null` MEANS DENY EVERYTHING, and it covers two cases the adapter deliberately merges: no role
 * was ever set, and a value this build does not recognise. `0019`: an unrecognised role "is not
 * an error and not a partial grant — it is deny all, on the same path as an absent membership."
 *
 * THE ROLE IS PER-ORGANIZATION BECAUSE IT SITS HERE AND NOT ON `PrincipalRecord`. A principal may
 * belong to several Organizations and must not carry authority across them; on `principal` this
 * field would be a tenant-isolation defect with a convenient shape.
 *
 * STILL NO BUSINESS ASSIGNMENT. `AuthenticatedPrincipal.authorizedBusinessIds` cannot be answered
 * from this record — for an organization-scope principal the set is "every Business in its
 * Organization", which is a read of the TENANT database after `TenantStoreResolver`, and that is
 * after this step in `0014` §C.5's order. `0019` does not close that half; see
 * `principal-authorization-source.ts`.
 */
export type OrganizationMembershipRecord = {
  readonly principalId: string;
  readonly organizationId: string;
  readonly status: MembershipStatus;
  readonly role: MembershipRole | null;
};

/**
 * A membership row about to be WRITTEN, as distinct from one that has been read.
 *
 * IT IS A SEPARATE TYPE BECAUSE THE WRITE NEEDS ONE FIELD THE READ DOES NOT PROJECT.
 * `created_at` is on the table and is `NOT NULL`, and no read path selects it — the resolution
 * algorithm has never needed it, and adding it to `OrganizationMembershipRecord` would mean every
 * membership SELECT in the platform started projecting a column nothing consumes.
 *
 * THE ALTERNATIVE — a fourth positional argument on `createMembership` — was rejected for the
 * reason `PlatformCursorBinding` exists: `createMembership(record, createdAt, reservation,
 * admission)` and `createMembership(record, reservation, admission, createdAt)` would both
 * compile, and two adjacent parameters of the same shape are a call site waiting to be written
 * backwards.
 *
 * `createdAt` IS THE SERVER'S CLOCK AND NEVER A REQUEST VALUE, the same rule
 * `session-resolution.ts` applies by taking no `nowMs` parameter anywhere.
 */
export type NewOrganizationMembership = OrganizationMembershipRecord & {
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

/**
 * A session. PRINCIPAL-SCOPED, which is the whole of `0014` §C.1.
 *
 * `activeOrganizationId` IS NULLABLE AND THAT IS THE DESIGN. A principal may belong to several
 * Organizations, so a session that has not selected one is an ordinary, reachable state — not an
 * error and not a default. There is deliberately no "first membership wins" fallback: a silent
 * default would be an ambient tenant, which `MULTITENANCY_STANDARD.md` §3 forbids by name.
 *
 * THE SELECTED ORGANIZATION IS HELD SERVER-SIDE, ON THIS ROW, RATHER THAN READ FROM THE REQUEST
 * ON EVERY CALL. That is what keeps `identity/principal-resolver.ts`'s standing rule intact —
 * "nothing that would let a caller name a tenant" may be added to `AuthenticationInput`. A
 * caller-supplied Organization appears in exactly one place in this module, at
 * `selectOrganization`, where §C.6 requires it to be treated as a hint and validated against
 * membership. It never appears on the request path of an ordinary business call.
 */
export type SessionRecord = {
  readonly sessionId: string;
  readonly principalId: string;
  readonly activeOrganizationId: string | null;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
  /** RFC 3339, UTC. Absolute, and never extended — see `session-resolution.ts`. */
  readonly expiresAt: string;
};

/**
 * `TenantDirectoryEntry` (`core-object-registry.yaml`, phase 1), which
 * `tenancy/tenant-store-resolver.ts` has been describing as "not in this slice's scope" since it
 * was written. This is that scope.
 */
export type TenantDirectoryRecord = {
  readonly organizationId: string;
  readonly bindingName: string;
  readonly state: 'active' | 'suspended' | 'migrating';
};

/**
 * A membership and the Organization it names, read together.
 *
 * ===========================================================================================
 * WHY THESE TWO READS ARE ONE METHOD. IT IS THE ANTI-ORACLE, AND IT IS §C.6.
 * ===========================================================================================
 *
 * "A requested Organization is only a hint." The attack behind that sentence: if a caller naming
 * an Organization it does not belong to could be distinguished from a caller naming an
 * Organization that does not exist, membership lookup becomes an ORGANIZATION-EXISTENCE ORACLE
 * ACROSS THE WHOLE PLATFORM — the same shape as the five oracles already closed in this slice,
 * and the broadest of them, because it is not confined to one tenant's records.
 *
 * Two separate methods would leave the distinction one call site away forever: check membership,
 * then look up the Organization "for a better error message", and the oracle is built by someone
 * being helpful. One method removes the option. The implementation contract is exact and the
 * adapter is written to it:
 *
 *   IF THERE IS NO ACTIVE MEMBERSHIP ROW, THE ORGANIZATION TABLE IS NOT QUERIED AT ALL.
 *
 * "ACTIVE" IS LOAD-BEARING IN THAT SENTENCE, and it is where the first version of this was
 * wrong. Checking the status above the port left a suspended membership returning a row, which
 * made the `organization` table be read, which made the failing path cost four statements for a
 * suspended member and three for a non-member. The ERROR was already identical; THE WORK WAS
 * NOT, and work is measurable. The adapter now filters on status inside the statement.
 *
 * So a non-member, a suspended member, and a caller naming a non-existent Organization produce
 * the same result (`null`), from the same number of statements (one), touching the same tables
 * (membership only), and the service maps all three to the same `notFound()` — which takes no
 * arguments and therefore has nothing to vary (`kernel/errors.ts`).
 *
 * The service ALSO checks `membership.status`, and that redundancy is deliberate: it is the
 * defence that survives an adapter written later that forgets the filter.
 */
export type MembershipWithOrganization = {
  readonly membership: OrganizationMembershipRecord;
  readonly organization: OrganizationRecord;
};

// =============================================================================================
// The ports
// =============================================================================================

/**
 * The identity half. Sessions, principals, memberships.
 *
 * EVERY READ HERE IS KEYED BY A PRINCIPAL OR BY A SESSION. There is no method that takes an
 * Organization identifier by itself, so this interface cannot answer "does this Organization
 * exist", "who else is in it", or "what else does this platform hold" — not because a caller
 * would not, but because there is no method to call.
 */
export type IdentityControlPlaneStore = {
  /**
   * The session row, or `null`.
   *
   * EXPIRY IS NOT FILTERED HERE. It is evaluated by the service, which returns the identical
   * `unauthenticated()` for an expired session and for one that never existed, so the two are
   * indistinguishable to a caller either way. Keeping the filter out of the port keeps the port
   * free of a clock and keeps the expiry rule in one readable place.
   */
  findSession(sessionId: string): Promise<Result<SessionRecord | null>>;

  findPrincipal(principalId: string): Promise<Result<PrincipalRecord | null>>;

  /**
   * The membership binding this principal to this Organization, together with that
   * Organization — or `null`, which means "no membership row", and means it WITHOUT having
   * looked at the Organization table. See `MembershipWithOrganization`.
   */
  findMembershipWithOrganization(
    principalId: string,
    organizationId: string,
  ): Promise<Result<MembershipWithOrganization | null>>;

  /**
   * The Organizations this principal may enter.
   *
   * CO1 (`core-object-registry.yaml`): "a user's list of Organizations must never be visible to
   * any of them." This method is the reason that question is open, and the reason it stays
   * answerable: the list is returned TO THE PRINCIPAL, through a session the principal holds,
   * and there is no path from an Action, an App, or an Organization administrator to this call.
   * If this ever becomes reachable from `ActionContext`, CO1 is violated in one line.
   *
   * `limit` is required and there is no unlimited form, for the reason `SelectSpec.limit` is
   * required: an unbounded read on a single-threaded database is every Organization's latency.
   */
  listMembershipsForPrincipal(
    principalId: string,
    limit: number,
  ): Promise<Result<readonly OrganizationMembershipRecord[]>>;

  /**
   * Writes a new session row.
   *
   * The reservation is `0014` §A.11 at this boundary, in the form the control plane requires:
   * a receipt for daily D1 write capacity that has ALREADY been charged. There is no overload
   * without one. See `control-plane-admission.ts` for why it is a different type from
   * `WriteReservation` and draws from a different allocation.
   */
  createSession(
    record: SessionRecord,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * Sets — or clears, with `null` — the session's active Organization.
   *
   * THE CALLER MUST HAVE VALIDATED MEMBERSHIP FIRST. This port does not re-check, because a port
   * that re-implemented the authorization decision would be a second place the decision is made
   * and therefore a second place it can differ. The single caller is
   * `session-resolution.ts::selectOrganization`, which validates and then writes.
   */
  setSessionActiveOrganization(
    sessionId: string,
    organizationId: string | null,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * ===========================================================================================
   * WRITES ONE `organization_membership` ROW. IT CANNOT BE CALLED WITHOUT THE PLATFORM-OPERATOR
   * CHECK HAVING HAPPENED. `docs/decisions/0025` decision 1 · finding `M-1`.
   * ===========================================================================================
   *
   * `admission` IS THE WHOLE POINT OF THIS SIGNATURE. `platform/platform-authority.ts` exports
   * `admitMembershipWrite` as the ONLY producer of a `MembershipAdmission`, and its mint is
   * module-private — so there is no way to obtain this argument without the `platform_operator`
   * read actually having run and returned no row.
   *
   * `M-1` was that the write-side guard had no call sites and that omitting it, when membership
   * administration eventually landed, WOULD BE SILENT: nothing fails, no test goes red, and
   * `0010`'s triggers become the only layer — on a database where that migration may not have been
   * applied. **A parameter that cannot be fabricated turns that silent omission into a compile
   * error.** It is the device `ControlPlaneWriteReservation` already uses one field along, and
   * reusing it keeps one pattern rather than two that drift.
   *
   * ===========================================================================================
   * NOTHING IN THIS REPOSITORY CALLS THIS YET, AND THAT IS STATED RATHER THAN IMPLIED.
   * ===========================================================================================
   *
   * Membership administration belongs to the organization-structure slice and onboarding to
   * `organization-onboarding-v1`; neither is built. This method exists now for the same reason
   * `issueSession` was written before any credential verifier existed and says so in capitals:
   * **the signature IS the mechanism**, and a signature that arrives with its first caller is a
   * signature that caller gets to choose. `PRINCIPAL_ROW_WRITES` and its siblings are declared
   * ahead of their writers on the identical reasoning — "so the first writer draws an accounted,
   * already-counted cost rather than a number it picked".
   *
   * IT IS NOT A STUB. The adapter implements it fully, its guard is tested as an attack, and it
   * charges `ORGANIZATION_MEMBERSHIP_ROW_WRITES` from the same budget every other control-plane
   * write draws on.
   *
   * WHAT THE CALLER STILL OWES, because this method cannot supply it: the ORGANIZATION's own
   * existence and the caller's authority to add a member to it. This checks one thing — that the
   * principal is not a platform operator — and it is not an authorization decision.
   */
  createMembership(
    record: NewOrganizationMembership,
    reservation: ControlPlaneWriteReservation,
    admission: MembershipAdmission,
  ): Promise<Result<void>>;

  /**
   * Ends a session by DELETING the row rather than flagging it revoked.
   *
   * Deliberate, and it buys two things. A revoked session and a session that never existed
   * become the same observation — one absent row, one `unauthenticated()` — so a replayed
   * credential discloses nothing about whether it was ever valid. And retention needs no second
   * mechanism for revoked rows.
   *
   * WHAT IT COSTS, STATED RATHER THAN GLOSSED: there is then no record that a logout occurred.
   * Session-lifecycle auditing is not built in this slice and is not decided by `0014` §C; see
   * the report accompanying this work.
   */
  deleteSession(
    sessionId: string,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;
};

/**
 * The tenancy half, and it is a SEPARATE INTERFACE so that the component holding it holds
 * nothing else.
 *
 * `tenancy/directory-tenant-store-resolver.ts` receives this and only this. It therefore cannot
 * read a session, cannot enumerate a principal's Organizations, and cannot be turned into a path
 * to either by a later edit that "already has the store handle".
 *
 * THIS IS THE ONE ORGANIZATION-KEYED LOOKUP IN THE CONTROL PLANE, and it is not an oracle
 * because of who can reach it: the only caller is `TenantStoreResolver`, which is Core-internal,
 * is invoked by the pipeline with `principal.organizationId` — a value the identity layer has
 * already validated against membership — and returns `unavailable()` for every failure without
 * distinguishing them (`tenancy/tenant-store-resolver.ts`). No caller-supplied identifier
 * reaches it.
 */
export type TenantDirectoryStore = {
  findEntry(organizationId: string): Promise<Result<TenantDirectoryRecord | null>>;
};

/**
 * What an adapter returns: both halves, as two separate objects, so the composition root hands
 * each consumer one of them.
 *
 * Returning a single object with every method on it would make the split above a comment.
 */
export type ControlPlaneStores = {
  readonly identity: IdentityControlPlaneStore;
  readonly tenantDirectory: TenantDirectoryStore;
};
