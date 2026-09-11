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
import type { OrganizationIdentity } from './organization-identity.ts';

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
  /**
   * *** NULL MEANS NO NAME HAS EVER BEEN RECORDED, AND THE CLIENT RENDERS `organizationId`
   * VERBATIM — not a blank, not a dash, not "Unnamed Organization". ***
   *
   * Reachable only for Organizations that predate `0015_organization_identity.sql`. Onboarding
   * takes a name, so **the nameless set is closed and shrinks**; it is a legacy state rather than
   * a mode, which is why nothing may set it back to null.
   *
   * THE REGISTRATIONS ARE DELIBERATELY NOT HERE. Two registration objects per row would inflate
   * every page of a listing that needs a label, and the detail route is one click away —
   * `organization-identity-v1`'s ruling, not an omission.
   */
  readonly displayName: string | null;
};

/**
 * One Organization's detail row. `organization-detail-v1`.
 *
 * `templateId` IS NULLABLE AND THE NULL IS HISTORY RATHER THAN A GAP. Organizations created before
 * `0013_organization_template.sql` have no Template and never can — nobody can say retroactively
 * which business type they are, and a backfill would be inventing an answer.
 *
 * *** IT CARRIES AN `identity` AS OF 2026-09-07, AND THE COMMENT IT REPLACES IS WORTH KEEPING IN
 * VIEW: *"NO `displayName` FIELD, because there is no column ... the ABSENCE of a field here is
 * what stops this record from implying one exists."* *** That was correct and it was the
 * discipline working — the record refused to imply a column the schema did not have.
 * `0015_organization_identity.sql` supplies the columns and `organization-identity-v1` supplies
 * the contract, so the absence has stopped being informative and would now be a gap.
 *
 * `memberCount` IS A NUMBER AND THERE IS NO SIBLING HOLDING IDENTITIES. See
 * `findOrganizationDetail`.
 *
 * `identity` IS CONTROL-PLANE THROUGHOUT and adds no tenant reach: a name, a commercial
 * registration and a VAT registration are facts ABOUT an Organization held in the control plane,
 * not records INSIDE it. `organization-detail-v1`'s test is mechanical and this passes it — *"a
 * field is available to an operator if and only if reading it requires no tenant store."*
 */
export type PlatformOrganizationDetailRecord = {
  readonly organizationId: string;
  readonly status: PlatformOrganizationStatus;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
  readonly templateId: string | null;
  readonly memberCount: number;
  readonly identity: OrganizationIdentity;
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
 * One row of the operator roster. **THREE FIELDS, AND THE ABSENCES ARE THE DESIGN.**
 *
 * See `listOperators`. There is deliberately no `identifier`, no `displayName` and no `lastSeenAt`:
 * `0001_principal.sql` refused the first outright, and a type with nowhere to put it is a type that
 * cannot quietly acquire it.
 *
 * `platformRole` IS NARROWED ON READ. An unrecognised stored value never produces a summary — the
 * same device `findOperator` uses, so a row written by a future migration this build does not
 * understand fails onto the safe path rather than being rendered as an unknown authority.
 */
export type PlatformOperatorSummary = {
  readonly principalId: string;
  readonly platformRole: PlatformRole;
  /** RFC 3339, UTC. When platform authority was GRANTED — not when the principal was created. */
  readonly createdAt: string;
};

/**
 * What a successful revocation reports.
 *
 * `remainingOperatorCount` IS TAKEN AFTER THE DELETE, in the same statement, so it is the count a
 * caller can act on rather than one that was true a moment ago.
 *
 * *** IT MAY BE ZERO, AND ONLY ON A SELF-REVOCATION. *** The last operator revoking themselves is
 * permitted — the contract has no route that could stop them being the last, and refusing would
 * mean an operator cannot resign. **A zero here is the platform having no operators and no route
 * that can create one**, which is exactly why the non-self case is refused with
 * `failed_precondition`.
 */
export type PlatformRevocation = {
  readonly remainingOperatorCount: number;
};

/**
 * The filters both feeds accept. **THE SAME TYPE FOR BOTH, WITH NO PRINCIPAL FIELD.**
 *
 * *** THERE IS NO `targetPrincipalId` AND ADDING ONE REOPENS `0028` Decision 3. *** Filtering by a
 * principal and counting results discloses that principal's Organizations one bit at a time — the
 * omitted field reconstructed through a query parameter. *"An ignored parameter is one someone will
 * later honour"*, so the class refuses it as an undeclared query parameter rather than accepting
 * and dropping it, and this type gives it nowhere to live even if that check were bypassed.
 *
 * ONE TYPE FOR BOTH FEEDS, deliberately: two would be two places the absent filter has to stay
 * absent.
 */
export type PlatformAuditFilters = {
  /** The OPERATOR. Not a disclosure — operators are a known set to anyone who can read a feed. */
  readonly actorPrincipalId: string | null;
  readonly actionId: string | null;
  /** RFC 3339 UTC, inclusive. Validated as a strict instant before it reaches here. */
  readonly since: string | null;
  /** RFC 3339 UTC, exclusive. */
  readonly until: string | null;
};

/**
 * Where a page resumes. **A COMPOUND ANCHOR, BECAUSE `occurred_at` IS NOT UNIQUE.**
 *
 * Two records written in the same millisecond are ordinary — a route writes one record and the
 * clock has millisecond resolution — so an anchor of `occurred_at` alone would either **skip** the
 * second record of a pair or **repeat** it, depending on the comparison. An audit feed that
 * silently drops records is worse than one that is slow.
 *
 * SO THE ORDER IS `(occurred_at DESC, action_record_id DESC)` and the anchor carries both.
 */
export type PlatformAuditAnchor = {
  readonly occurredAt: string;
  readonly actionRecordId: string;
};

/**
 * One record as a feed returns it.
 *
 * `targetPrincipalId` IS PRESENT ON THIS TYPE AND THE PLATFORM FEED NEVER POPULATES IT — its
 * statement does not select the column. **The handler for that feed does not read this field**, and
 * `PlatformFeedRecord` on the wire has no place for it. Two types would be tidier and would mean
 * two statements, two mappers and two places the omission has to be re-made correctly.
 */
export type PlatformAuditRecord = {
  readonly actionRecordId: string;
  readonly occurredAt: string;
  readonly actorPrincipalId: string;
  readonly actorPlatformRole: PlatformRole;
  readonly actionId: string;
  readonly outcome: PlatformActionOutcome;
  readonly correlationId: string;
  readonly targetOrganizationId: string | null;
  /** ALWAYS `null` from `listPlatformAudit`. Populated only by the Organization feed. */
  readonly targetPrincipalId: string | null;
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
  /**
   * WHICH ORGANIZATION THE ACTION HAPPENED IN. `0014_platform_operator_action_organization.sql`.
   *
   * A DIFFERENT QUESTION FROM `targetId`, and the distinction is what `0028` Decision 3's
   * Organization feed selects on. For an Organization-targeted action the two coincide; for a
   * principal-targeted one they do not, and **storing only `targetId` made every resolve and every
   * future credential reset invisible to the feed built to disclose them.**
   *
   * NULL FOR AN ACTION THAT HAPPENS IN NO ORGANIZATION — `whoami`, the Template routes, the
   * Organization list. That is the ordinary case, not a gap.
   */
  readonly targetOrganizationId: string | null;
  readonly outcome: PlatformActionOutcome;
  /** RFC 3339, UTC. The server's clock. */
  readonly occurredAt: string;
  readonly correlationId: string;
};

/**
 * What `setOrganizationTemplate` did, or why it did not.
 *
 * `template_unusable` COVERS "no such Template" AND "retired" TOGETHER, AND THAT IS NOT A COLLAPSE
 * OF THE KIND THIS PLATFORM USUALLY REFUSES. The caller distinguishes them from its own prior read
 * of the Template — which it performs anyway, because the response embeds the Template — and this
 * value is reached only when the in-statement guard disagrees with that read, which means the world
 * moved. `template-lifecycle-v1` requires the two to be distinguishable to the operator, and they
 * are: the answer comes from the read, not from this outcome.
 */
export type OrganizationTemplateOutcome = 'updated' | 'organization_not_found' | 'template_unusable';

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
   * ONE ORGANIZATION'S IDENTITY BLOCK, WITHOUT THE MEMBER COUNT.
   * ===========================================================================================
   *
   * *** IT IS A SEPARATE METHOD FROM `findOrganizationDetail` RATHER THAN A REUSE, AND THE REASON
   * IS THE SUBQUERY. *** The detail read carries a correlated `COUNT(*)` over
   * `organization_membership`. The update route needs the identity and has no use for the count,
   * and **making it pay for a second table's scan on every write would be a read nobody asked
   * for** — `organization-detail-v1`'s point that in this class a read costs writes, applied to
   * the read itself.
   *
   * `null` FOR AN UNKNOWN ORGANIZATION, rendered by the route as the argument-free 404.
   *
   * *** A ROW WHOSE REGISTRATION COLUMNS DO NOT FORM ONE OF THE THREE STATES IS `internal()`, NOT
   * AN EMPTY REGISTRATION. *** Defaulting an unreadable row to `not-recorded` would render "we
   * never asked" over a row that says something else — a confident wrong answer about a legal
   * identifier. It is reachable only by a row `0016`'s triggers never saw: a restore, a partial
   * migration, or a write that predates `0015`. `0024`'s population.
   */
  findOrganizationIdentity(
    organizationId: string,
  ): Promise<Result<OrganizationIdentity | null>>;

  /**
   * ===========================================================================================
   * REPLACE ONE ORGANIZATION'S IDENTITY BLOCK. ALL THIRTEEN COLUMNS, IN ONE STATEMENT.
   * ===========================================================================================
   *
   * *** IT TAKES A WHOLE `OrganizationIdentity` AND NOT A PATCH, WHICH IS THE ENFORCEMENT RATHER
   * THAN A STYLE. *** The incoherent rows `0015`'s triggers refuse — a number on a
   * `not_registered` row, a verification with no number, a verification older than the number it
   * attests to — are all rows somebody assembled a column at a time. A method that cannot express
   * a partial registration cannot write one.
   *
   * THE MERGE HAPPENS ABOVE THIS PORT, in `applyRegistration`, which is a pure function of what is
   * stored and what was submitted. So the transition rule is testable without a database and this
   * method has no rule in it at all.
   *
   * **LAST WRITER WINS, AND THERE IS NO VERSION COLUMN.** Two operators editing one Organization
   * in the same second is a lost update, and the losing edit is invisible in the result while
   * being fully visible in BOTH audit trails. That is a real limit rather than a hidden one; it
   * needs an optimistic-concurrency token to close and that is a contract change, not a local fix.
   *
   * *** IT RETURNS NO `null`, AND THE CALLER MUST HAVE ESTABLISHED EXISTENCE FIRST. *** This is a
   * precondition rather than a convenience: the D1 adapter cannot tell an `UPDATE` that matched a
   * row from one that matched none, because `D1Database.batch` returns `unknown[]` and Core's port
   * deliberately withholds D1's `meta.changes` (`architecture.md` §6 — no vendor result shape in
   * domain-adjacent code). **The boundary held and this check is what it cost.** See the adapter.
   *
   * So `findOrganizationIdentity` returning `null` is the 404, and the only window left is a row
   * deleted between that read and this write — which **nothing in Dudo can do today**, there being
   * no delete path for an `organization` row anywhere in the repository.
   */
  updateOrganizationIdentity(
    organizationId: string,
    identity: OrganizationIdentity,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<OrganizationIdentity>>;

  /**
   * ===========================================================================================
   * HOW MANY ORGANIZATIONS HAVE ADOPTED ONE TEMPLATE. A NUMBER, NEVER A SET.
   * `template-lifecycle-v1` -> `platform.templates.usage`.
   * ===========================================================================================
   *
   * *** IT RETURNS A COUNT AND CANNOT BE MADE TO RETURN IDENTIFIERS, WHICH IS THE WHOLE POINT. ***
   * The route exists so an operator retiring a Template is not deciding blind. A method returning
   * the Organizations themselves would be the enumeration `0028` `CO1` forbids arriving through a
   * different door, and **a return type of `number` is a shape that cannot carry one.**
   *
   * *** IT IS ON THIS PORT AND NOT ON `TemplateStore`, DELIBERATELY. *** It aggregates over the
   * control-plane `organization` table, which is this port's table. `template-store.ts` opens by
   * claiming something stronger than the other platform ports can — *"there is no tenant identifier
   * anywhere in its inputs or its outputs"* — and it is the one port in the surface where that is
   * simply true. **Reaching into `organization` from there would spend a property that is currently
   * exact**, to save one dependency at one call site.
   *
   * IT MUST BE A `COUNT` AND NEVER A FETCH-AND-LENGTH. `template-lifecycle-v1`'s
   * `freeTierImpact.reads`: *"reading every row to count them is the same number on the wire and a
   * different number against d1-rows-read."*
   *
   * ⚠ THERE IS NO INDEX ON `organization.template_id` AND THIS IS THE ROUTE THAT WOULD WANT ONE.
   * `0013_organization_template.sql` left it out in terms — *"the only query that would want one is
   * 'list every Organization using Template X', which is a route that does not exist... Add it with
   * the route that needs it."* **The route now exists and the index is still absent**, so this is a
   * full scan of `organization`. That is correct and cheap at the current population and it is a
   * MIGRATION rather than a code change, which is the user's call every time. Reported, not taken.
   */
  countOrganizationsUsingTemplate(templateId: string): Promise<Result<number>>;

  /**
   * ===========================================================================================
   * HOW MANY ORGANIZATIONS EXIST. THE NUMBER `listOrganizations` CANNOT STATE.
   * `platform.organizations.count` · `docs/decisions/0042`.
   * ===========================================================================================
   *
   * A paginated list can only say *"at least 25"* until its last page, so an operational summary
   * opened cold has no honest total. **This is the difference between a bound and a total.**
   *
   * *** IT TAKES NO ARGUMENT, AND THAT IS THE SHAPE CONSTRAINT RATHER THAN A SIMPLIFICATION. ***
   * A single `total` and nothing else — no breakdown, no grouping, no `by_status` map, no
   * per-Organization figure, no filter. **Each of those transposes into a MAPPING, and the mapping
   * is what `0028` Decision 1 refuses.** A count is one number; the moment it is keyed by anything
   * it has stopped being a count and become a table. **A method with no parameters cannot be keyed
   * by anything**, which is this rule held in a signature rather than in a review.
   *
   * *** IT REUSES `core.organization.list` AND NEEDS NO PERMISSION OF ITS OWN. *** `security.md`
   * §2a: a count is safe exactly when its consumer already holds enumeration over the counted
   * population. A `core.organization.list` holder enumerates every Organization deliberately, at
   * `sensitive`. **A new permission here would be a split with no decision in it.**
   *
   * AND IT IS THE MERITS ANSWER TO `theLine.out`, NOT A SCOPE DISTINCTION. That block refuses
   * counts of business records — *"how many customers is how a console acquires cross-tenant reach
   * one convenient number at a time"* — and **the operative fact is that a platform operator holds
   * NO enumeration right over customers**, so each such count is genuinely new. **The rule turns on
   * the RIGHT, not on the object**, which is why it does not transfer here.
   *
   * CONTROL-PLANE ONLY. One aggregate over the `organization` table; **no tenant read of any kind
   * and no store handle resolved.**
   *
   * ZERO IS THE ORDINARY ANSWER AND NEVER A `not_found`. An empty platform is not a missing one,
   * and it is the ordinary first day.
   */
  countOrganizations(): Promise<Result<number>>;

  /**
   * ===========================================================================================
   * SET OR CLEAR ONE ORGANIZATION'S TEMPLATE. `template-lifecycle-v1` -> PA-17.
   * ===========================================================================================
   *
   * `null` CLEARS IT, AND CLEARING IS A REAL OPERATION RATHER THAN A HOLE — the schema's own words:
   * *"an Organization onboarded onto the wrong Template must be able to get back to a neutral
   * state, and today every Organization that predates Templates is already in it."*
   *
   * *** THE RETIRED-TEMPLATE PRECONDITION IS ENFORCED IN THIS STATEMENT AND NOT ONLY ABOVE IT. ***
   * The caller reads the Template first — it has to, because the response embeds it — and that read
   * is stale by the time the write lands. `architecture.md` §3a: the in-statement guard is the only
   * layer with no window. **`template-lifecycle-v1` states the rule cannot be expressed in the
   * schema at all** — *"JSON Schema cannot see the referenced Template's status — it is a value in
   * another table"* — so the schema is not a second layer here and this guard is load-bearing.
   *
   * IT CANNOT SET A TEMPLATE THAT DOES NOT EXIST EITHER. The foreign key would refuse that anyway;
   * the guard makes it an answer rather than a caught exception, which is the difference between
   * telling an operator "that Template is retired" and telling them the database was unavailable.
   *
   * *** IT DOES NOT WRITE THE TENANT-SIDE AUDIT RECORD AND MUST NOT LEARN HOW. *** That record goes
   * into the named Organization's OWN database through `MemberResolutionPort.recordOrganizationAccess`,
   * which requires an `OperatorWriteCharged` receipt. This port holds no resolver and reaches no
   * tenant store; keeping the two writes in two places is what keeps `0024`'s mutual exclusion true.
   */
  setOrganizationTemplate(
    organizationId: string,
    templateId: string | null,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<OrganizationTemplateOutcome>>;

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

  /**
   * ===========================================================================================
   * THE PLATFORM FEED. EVERY OPERATOR ACTION, ACROSS ALL ORGANIZATIONS, **WITHOUT THE PRINCIPAL.**
   * `platform-audit-read-v1` · `docs/decisions/0028` Decision 3.
   * ===========================================================================================
   *
   * *** THE OMISSION IS AT THIS PORT AND IN THE SQL, NOT IN A HANDLER. ***
   *
   * `target_principal_id` is the field that aggregates into the `CO1` mapping: every resolve
   * record is *"principal P was resolved in Organization O"*, which is a membership fact, and a
   * bulk read collects every one of them in **one request the affected tenants cannot see.**
   *
   * SO THE STATEMENT DOES NOT SELECT IT. A handler that deleted the field from a row it was handed
   * would be one edit from forgetting; **a method that never reads the column cannot leak it**, and
   * the SQL is where a reviewer looks. `PlatformFeedRecord` has no field for it either, so there is
   * nothing to omit at the wire — the value does not exist in this code path at all.
   *
   * THE ORGANIZATION-LEVEL TARGET IS RETURNED AND THAT IS FINE: an operator can enumerate
   * Organizations from their own home screen, so learning that one was acted on discloses nothing
   * they could not obtain there.
   *
   * **THERE IS DELIBERATELY NO `targetPrincipalId` FILTER PARAMETER.** Filtering by a principal and
   * counting results reconstructs the omitted field one bit at a time. `actorPrincipalId` is
   * permitted — operators are a known set to anyone who can read this feed at all.
   */
  /**
   * ===========================================================================================
   * WHO HOLDS PLATFORM AUTHORITY. `platform-operators-v1`.
   * ===========================================================================================
   *
   * *** IT RETURNS THREE COLUMNS AND THERE IS NO FOURTH TO ADD. ***
   *
   * `principal_id`, `platform_role`, `created_at`. **No identifier, no email, no display name, no
   * last-seen** — `0001_principal.sql` holds none of them, and it refused an email column outright
   * because *"a directory of every user's personal details, readable without any tenant scope,
   * would be the highest-value target in the system."*
   *
   * **AN OPERATOR ROSTER SHOWING EMAIL ADDRESSES WOULD BE THAT DIRECTORY AT THE MOST PRIVILEGED
   * END OF THE PLATFORM**, and this method must not become the reason someone adds the column.
   * The record type has no field for one, so the pressure has nowhere to land.
   *
   * THE COST IS REAL AND IS NOT THIS CONTRACT'S TO FIX: the console renders 22-character opaque
   * identifiers and **an operator cannot tell colleagues apart on screen.** They recognise
   * themselves by matching against `whoami`. That is `OP-3`, and the fix is display names wherever
   * they land — not a column here.
   *
   * KEYSET ON `principal_id`, the primary key of `platform_operator`, for the reason
   * `listOrganizations` gives: page N costs what page 1 costs, and ordering by `created_at` would
   * need an index the schema does not have.
   */
  listOperators(
    limit: number,
    afterPrincipalId: string | null,
  ): Promise<Result<readonly PlatformOperatorSummary[]>>;

  /**
   * ===========================================================================================
   * REMOVE A PRINCIPAL'S PLATFORM AUTHORITY. `platform-operators-v1`.
   * ===========================================================================================
   *
   * *** IT RETURNS THE REMAINING OPERATOR COUNT, AND THE COUNT IS TAKEN IN THE SAME STATEMENT AS
   * THE DELETE. ***
   *
   * The contract refuses a revocation that would leave **zero** platform operators unless the
   * target is the caller. Reading the count first and deleting second is a check-then-act race:
   * two concurrent revocations both see two operators, both proceed, and **the platform is left
   * with none and no route that can create one** — `0025` publishes no route that grants platform
   * authority, so recovery is out-of-band SQL.
   *
   * SO THE ADAPTER DELETES CONDITIONALLY AND COUNTS IN ONE ROUND TRIP. `architecture.md` §3a's
   * ranking applies exactly: *"a guard inside the statement… is the only layer with no window at
   * all, because it re-asks the question in the same statement that writes."*
   *
   * `null` MEANS THE TARGET WAS NOT AN OPERATOR — unknown principal, tenant member, or already
   * revoked. **The route collapses all three into the argument-free 404**, and revoking an
   * already-revoked operator is therefore a 404 rather than a 200: the row is gone, so the target
   * is not an operator, and the collapse applies.
   */
  revokeOperator(
    principalId: string,
    isSelfRevocation: boolean,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<PlatformRevocation | null>>;

  listPlatformAudit(
    filters: PlatformAuditFilters,
    limit: number,
    afterCursor: PlatformAuditAnchor | null,
  ): Promise<Result<readonly PlatformAuditRecord[]>>;

  /**
   * ===========================================================================================
   * THE ORGANIZATION FEED. ONE NAMED ORGANIZATION, **WITH** THE PRINCIPAL-LEVEL TARGET.
   * ===========================================================================================
   *
   * IT MAY CARRY `targetPrincipalId` **BECAUSE THE CALLER NAMED THE ORGANIZATION** — the identical
   * gate `0028` Decision 2 applies to the resolve. An operator must already have a reason to ask
   * about a specific customer, and the route writes a tenant-side record so that customer sees the
   * asking.
   *
   * IT SELECTS ON `target_organization_id`, WHICH IS `0014`'s COLUMN. Selecting on `target_id`
   * would return only Organization-targeted actions — every onboarding, and **not one resolve or
   * reset**, which is the defect that migration exists to fix.
   *
   * NO `targetOrganizationId` IN THE RESULT. The path parameter already fixed it, and repeating it
   * would invite a client to trust the body over the path.
   */
  listOrganizationAudit(
    organizationId: string,
    filters: PlatformAuditFilters,
    limit: number,
    afterCursor: PlatformAuditAnchor | null,
  ): Promise<Result<readonly PlatformAuditRecord[]>>;
};
