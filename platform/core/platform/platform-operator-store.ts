/**
 * ===========================================================================================
 * THE PLATFORM STORAGE PORT. `docs/decisions/0025` · contract `platform-operator-v1`.
 * ===========================================================================================
 *
 * This is `identity/control-plane-store.ts`'s discipline applied to a second consumer, and its
 * four properties are restated here because they are what keep a handle to this port from being
 * a handle to the platform:
 *
 * 1. IT IS NOT A STORE. No `select(spec)`, no table name, no predicate, no column list, no sort.
 *    It is a FIXED LIST OF FOUR NAMED QUESTIONS, each one a question the platform route class
 *    actually asks. `TenantScopedStore` is general because a hundred Actions need a hundred
 *    queries; this port serves one class of four routes, so generality here would buy nothing and
 *    would make a leaked handle unbounded instead of bounded.
 *
 * 2. IT HOLDS NO TENANT AND CAN REACH NO TENANT DATA. Every method below reads or writes a
 *    CONTROL-PLANE table. There is no `TenantStoreResolver` here, no `TenantScopedStore`, no
 *    `whereWithTenant`, no D1 binding for the tenant database, and no method that could acquire
 *    one. That is binding property P1, and it is structural rather than conventional.
 *
 * 3. IT IS SEPARATE FROM `IdentityControlPlaneStore` AND EACH CONSUMER GETS ONLY ITS OWN. The
 *    identity resolver never receives this port and so cannot enumerate Organizations; this port
 *    has no `createSession`, no `deleteSession` and no `setSessionActiveOrganization`, so the
 *    platform class cannot mint, move or destroy a credential. Least privilege between two Core
 *    components, not only between Core and Apps.
 *
 * 4. NOTHING PUTS IT ON `ActionContext`, AND AN APP CANNOT BUILD ONE. Constructing the adapter
 *    requires a D1 binding, and App code never sees `Env` or a binding. Importing this module
 *    gives an App a type and a factory that needs a binding it does not have.
 *
 * NEGATIVE CONTROLS, all three one grep each and all three owed by `qa-agent`:
 *
 *   1. NO FILE UNDER `platform/core/platform/**` IMPORTS A TENANT MODULE. This is the one that
 *      matters, it admits no exception, and it is an import-statement check rather than a
 *      free-text one: no `import` in this tree names `tenancy/`, `storage/adapters/`,
 *      `TenantStoreResolver`, `TenantScopedStore`, `createD1TenantStore` or `TENANT_COLUMN`. The
 *      one import from `storage/` anywhere in this tree is `d1-store.ts`'s `D1Database` TYPE,
 *      which is a structural interface with two methods and confers no binding.
 *   2. NO CODE UNDER `platform/core/platform/**` MENTIONS THOSE NAMES, comments excluded — the
 *      prose deliberately names them to explain the rule. THERE IS NO OTHER EXCLUSION, AND THAT
 *      IS WORTH ONE SENTENCE: an earlier draft put `seed-platform-operator.ts` in this tree and
 *      needed a `tools/**` carve-out, because that tool's output warns an operator "the target is
 *      DB_CONTROL, NOT DB_TENANT". The tool now lives in `identity/tools/` beside
 *      `seed-principal.ts`, which is where the Team Lead placed it and which happens to leave this
 *      control total. A negative control with no exceptions is worth more than one with a
 *      justified exception, because the next exception arrives arguing from the first.
 *   3. `platform/core/action/**` AND `apps/**` DO NOT IMPORT `platform/core/platform/**`.
 *
 * ===========================================================================================
 * THE HONEST LIMIT, STATED HERE RATHER THAN CLAIMED AWAY — the contract's own words
 * ===========================================================================================
 *
 * "THIS CLASS TOUCHES THE CONTROL PLANE, WHICH IS THE ONE COMPONENT WHOSE PURPOSE IS TO HOLD
 * TENANT IDENTITY. So 'no tenant data' is exact and 'no tenant identifier' is not."
 *
 * `listOrganizations` returns tenant IDENTIFIERS. That is the operation's whole purpose and it is
 * permitted. The line, which no method here crosses, is: A PLATFORM ROUTE MAY CREATE, NAME AND
 * ENUMERATE TENANTS AND MAY NEVER READ A ROW BEHIND `whereWithTenant`. The weaker property is the
 * one that is true, and claiming the stronger one would be the overclaim AZ7 records as a defect
 * class.
 *
 * WHICH IS WHY `listOrganizations` RETURNS NO COUNTS. No customers, no members, no activity, no
 * usage, no last-seen. Every one of those is a read behind `whereWithTenant`, and "how many
 * customers does this Organization have" is how a console acquires cross-tenant reach one
 * convenient number at a time. There is no method here that could answer it, which is stronger
 * than a rule that none does.
 */

import type { Result } from '../kernel/result.ts';
import type { PlatformRole } from './platform-permissions.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import type { ControlPlaneWriteReservation } from '../identity/control-plane-admission.ts';

/**
 * A platform operator, as the control plane holds it.
 *
 * `platformRole` IS `PlatformRole | null` AND `null` DENIES EVERYTHING. The adapter collapses an
 * unrecognised stored value to `null` on read rather than reporting it as an error — the same
 * device `d1-control-plane-store.ts` uses for an unrecognised `MembershipRole` and
 * `d1-credential-store.ts` for an unrecognised algorithm. A build older than its data must deny
 * rather than break, and the two cases must be indistinguishable from outside.
 *
 * NO STATUS AND NO EXPIRY, because `0008_platform_operator.sql` has no column for either.
 * Revocation is deletion of the row, effective on the operator's next request.
 */
export type PlatformOperatorRecord = {
  readonly principalId: string;
  readonly platformRole: PlatformRole | null;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

export type PlatformOrganizationStatus = 'active' | 'suspended';

/**
 * One row of the platform's Organization list: an identifier, a status and a creation time.
 *
 * NO NAME, because `0002_organization.sql` declined a name column deliberately and the
 * organization-structure slice owns the Organization data model. THE CONSOLE'S HOME SCREEN IS
 * THEREFORE A LIST OF 22-CHARACTER OPAQUE IDENTIFIERS, which is not a usable administrative
 * interface. That is a product dependency (contract PO-3), it is the same gap that makes the
 * Organization picker unshippable (`0021`), and one fix closes both. It is NOT worth solving
 * locally by inventing a name column here.
 */
export type PlatformOrganizationRecord = {
  readonly organizationId: string;
  readonly status: PlatformOrganizationStatus;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

/**
 * One Organization's detail row. `organization-detail-v1`.
 *
 * `templateId` IS NULLABLE AND THE NULL IS HISTORY RATHER THAN A GAP. Organizations created before
 * `0013_organization_template.sql` have no Template and never can — nobody can say retroactively
 * which business type they are, and a backfill would be inventing an answer.
 *
 * NO `displayName` FIELD, because there is no column. `organization-detail-v1` contracts the wire
 * field as nullable so a name is additive later; the ABSENCE of a field here is what stops this
 * record from implying one exists.
 *
 * `memberCount` IS A NUMBER AND THERE IS NO SIBLING HOLDING IDENTITIES. See
 * `findOrganizationDetail`.
 */
export type PlatformOrganizationDetailRecord = {
  readonly organizationId: string;
  readonly status: PlatformOrganizationStatus;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
  readonly templateId: string | null;
  readonly memberCount: number;
};

/**
 * What a successful resolve returns. **A principal identifier and a role, and nothing else.**
 *
 * NO IDENTIFIER, NO EMAIL, NO CREATION TIME, NO STATUS. The caller sent the identifier and already
 * knows it; echoing it would put an email address in a response body for no purpose and in a log
 * line for anyone who logs responses.
 *
 * THE ROLE IS RETURNED BECAUSE IT IS A FACT ABOUT THE RELATIONSHIP RATHER THAN ABOUT THE PERSON,
 * and an operator about to reset a credential should know whether they are taking over an `owner`
 * or a `member`.
 */
export type PlatformMemberResolution = {
  readonly principalId: string;
  readonly role: MembershipRole;
};

/**
 * What an operator action record names.
 *
 * `'none'` IS A FIRST-CLASS VALUE rather than an absent kind: an enumeration has no single
 * affected target, and that is a positive fact about the operation worth recording as one.
 */
export type PlatformActionTargetKind = 'none' | 'organization' | 'principal';

/**
 * How a platform operation ended.
 *
 * THERE IS NO `unauthenticated` AND NO `not-an-operator`, AND THE ABSENCE IS THE FREE-TIER
 * ARGUMENT. A caller that is not a platform operator writes no record at all, so the population
 * that can force a write is bounded by the number of real operators rather than by traffic. See
 * `platform-audit.ts`, which is where the rule is applied, and `0009_platform_operator_action.sql`,
 * which is where its cost is counted.
 */
export type PlatformActionOutcome = 'ok' | 'denied' | 'failed';

/**
 * One row of the platform-operator action log. `0025` decision 5.
 *
 * IT RECORDS THE OPERATION AND ITS TARGET IDENTIFIERS AND NEVER THE CONTENTS OF WHAT WAS TOUCHED.
 * No field here can hold a customer, a field value, a name, an amount or a count, and none may be
 * added — an operator log that accumulates customer data is a second copy of the tenant database
 * with weaker access rules.
 */
export type PlatformOperatorActionRecord = {
  readonly actionRecordId: string;
  readonly actorPrincipalId: string;
  readonly actorPlatformRole: PlatformRole;
  readonly actionId: string;
  readonly targetKind: PlatformActionTargetKind;
  /** An identifier, or `null` when `targetKind` is `'none'`. NEVER a name or a description. */
  readonly targetId: string | null;
  readonly outcome: PlatformActionOutcome;
  /** RFC 3339, UTC. The server's clock. */
  readonly occurredAt: string;
  readonly correlationId: string;
};

export type PlatformOperatorStore = {
  /**
   * The operator row for this principal, or `null`.
   *
   * KEYED BY PRINCIPAL AND ONLY BY PRINCIPAL. There is deliberately no `listOperators`, no
   * `findOperatorsByRole` and no count: an operator enumerating the platform's other operators is
   * the reconnaissance step before a targeted action, and `platform.session.whoami` is
   * specifically designed so that "there is no parameter through which another operator could be
   * named". A port method that took no principal would defeat that from below.
   */
  findOperator(principalId: string): Promise<Result<PlatformOperatorRecord | null>>;

  /**
   * ===========================================================================================
   * THE MUTUAL-EXCLUSION PROBE. `0025` decision 1, `0024` invariant 1.
   * ===========================================================================================
   *
   * Does this principal hold ANY `organization_membership` row — active, suspended, or otherwise?
   *
   * ANY ROW COUNTS, AND THE BREADTH IS DELIBERATE. `0024`'s invariant is that a platform principal
   * holds ZERO memberships: "not a scoped one, not a read-only one, not one just for the tenant
   * being supported". A probe that ignored suspended rows would let a suspended membership be
   * reactivated later and turn a compliant operator into a violating one with no code change.
   *
   * IT RETURNS A BOOLEAN AND NOT THE ROWS. The platform class must never hold a principal's list
   * of Organizations — that is `core-object-registry.yaml` CO1, and this is the one place a
   * platform route comes near it. A boolean answers the only question this class may ask.
   */
  principalHasAnyMembership(principalId: string): Promise<Result<boolean>>;

  /**
   * One bounded page of the control plane's `organization` table, ordered by identifier.
   *
   * `limit` IS REQUIRED AND THERE IS NO UNLIMITED FORM, for the reason `SelectSpec.limit` is
   * required: an unbounded read on a single-threaded database is every Organization's latency.
   *
   * `afterOrganizationId` IS A KEYSET ANCHOR, NOT AN OFFSET. It is the last identifier of the
   * previous page and the scan resumes strictly after it on the primary-key index, so no page
   * costs more than the one before it. OFFSET pagination reads and discards every earlier row,
   * which on a growing table is a read cost that rises with the page number.
   *
   * THIS IS THE ONLY METHOD IN CORE THAT ENUMERATES ORGANIZATIONS WITHOUT NAMING A PRINCIPAL, and
   * that is exactly why `IdentityControlPlaneStore` does not have it: that port's property 2 is
   * that no method answers a question about an Organization alone, so the identity layer
   * physically cannot be asked "what Organizations exist". This port can, it is reachable only
   * behind `core.organization.list` held by a `platform_operator`, and every call writes an audit
   * record.
   */
  listOrganizations(
    limit: number,
    afterOrganizationId: string | null,
  ): Promise<Result<readonly PlatformOrganizationRecord[]>>;

  /**
   * Appends one row to the platform-operator action log.
   *
   * The reservation is `0014` §A.11 at this boundary, in the form the control plane requires: a
   * receipt for daily D1 write capacity that has ALREADY been charged. There is no overload
   * without one, exactly as there is none on `createSession`.
   */
  recordAction(
    record: PlatformOperatorActionRecord,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * One Organization, with its Template reference and how many principals belong to it.
   * `organization-detail-v1`.
   *
   * ===========================================================================================
   * *** IT RETURNS A COUNT AND THERE IS NO METHOD ON THIS PORT THAT RETURNS MEMBER IDENTITIES. ***
   * ===========================================================================================
   *
   * `docs/decisions/0028` Decision 1 refuses a member list, and the reason is not that the read is
   * unavailable — `organization_membership` is a control-plane table and P1 does not stop it. **It
   * is refused because the transpose of the permitted read is the forbidden one:** an operator can
   * enumerate every Organization from its own home screen, so per-Organization member lists invert
   * into every principal's Organization list, which `CO1` forbids by name.
   *
   * SO THE PORT HAS NO `listMembers`, AND THAT IS THE ENFORCEMENT. A count method cannot be made
   * to return identities; a list method with a `.length` at the call site is one edit from
   * disclosing them, and the edit would look like a simplification.
   *
   * **A COUNT DOES NOT INVERT.** Knowing an Organization has five members reconstructs nothing
   * about any principal. Its one small leak is recorded rather than dismissed: repeated counts
   * reveal that membership CHANGED, never who or in which direction — a fact about the
   * Organization rather than about a person.
   *
   * `null` FOR AN UNKNOWN ORGANIZATION. The route renders it as the argument-free 404.
   */
  findOrganizationDetail(
    organizationId: string,
  ): Promise<Result<PlatformOrganizationDetailRecord | null>>;

  /**
   * ===========================================================================================
   * RESOLVE ONE MEMBER BY IDENTIFIER HASH. AT MOST ONE, NEVER A SET.
   * `docs/decisions/0028` Decision 2 · `organization-detail-v1`.
   * ===========================================================================================
   *
   * *"AN OPERATOR RESOLVING AN IDENTIFIER THEY WERE GIVEN IS SUPPORT. AN OPERATOR RECEIVING A LIST
   * THEY DID NOT ASK FOR BY NAME IS SURVEILLANCE."* The structural difference is that this
   * **requires the caller to already know something only the customer could have told them**;
   * enumeration requires knowing only that the Organization exists.
   *
   * IT TAKES AN IDENTIFIER **HASH**, NOT AN IDENTIFIER. The keyed HMAC is computed above this port
   * by `IdentifierHasher`, so this method never sees an email address and no adapter can log one.
   * `0001_principal.sql` paid for that property deliberately and it is not spent here.
   *
   * ===========================================================================================
   * *** IT MUST DO THE SAME WORK ON EVERY REFUSING PATH, NOT MERELY RETURN THE SAME ANSWER. ***
   * ===========================================================================================
   *
   * `null` covers five cases — unknown Organization, an identifier belonging to nobody, a
   * principal who is not a member of THIS Organization, a suspended membership, and **a principal
   * who is a platform operator.** The naive implementation returns early on an unknown Organization
   * and never touches `organization_membership`, which is measurably cheaper and is an
   * Organization-existence signal.
   *
   * SO THE ADAPTER ANSWERS ALL FIVE IN **ONE STATEMENT** whose work does not vary with which one
   * holds — the same device `findMembershipWithOrganization` uses, and for the same reason.
   *
   * **THE FIFTH CASE IS THE ONE THAT LOOKS REDUNDANT AND IS NOT.** Without it this route is an
   * oracle for which principals hold platform authority — the single most useful fact an attacker
   * could extract from this surface. It is enforced in the statement rather than above it, so it
   * cannot be lost by a caller that forgets, and `0010`'s triggers are not relied on.
   */
  resolveMemberByIdentifierHash(
    organizationId: string,
    identifierHash: string,
  ): Promise<Result<PlatformMemberResolution | null>>;
};
