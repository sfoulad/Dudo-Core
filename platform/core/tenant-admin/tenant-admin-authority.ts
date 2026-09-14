/**
 * ===========================================================================================
 * WHERE THE TENANT IS RESOLVED FOR THE FIFTH REQUEST CLASS, AND WHERE `0024`'s OTHER HALF IS
 * FINALLY ENFORCED. `docs/decisions/0044` §3a · `docs/decisions/0043` §5.3 · `docs/decisions/0024`.
 * ===========================================================================================
 *
 * `0044` §3a's safety argument for creating a fifth class rather than widening one:
 *
 *   "The class resolves a tenant from the authenticated context, and a platform operator holds no
 *    membership — so NO PLATFORM OPERATOR CAN REACH IT BY CONSTRUCTION, NOT BY A CHECK."
 *
 * **THAT SENTENCE IS TRUE AND THIS FILE DOES NOT RELY ON IT.** `0024` invariant 1 says a platform
 * principal holds zero membership rows; `platform-authority.ts` says in terms that the state is
 * created by *"a hand-run SQL statement, a partially applied migration, or a restore from two
 * backups taken at different moments"*, and that **the authorization-time check is the control
 * while the write-side guard is hygiene**. A construction argument is a claim about rows that
 * exist. This is the check that holds when the rows are wrong.
 *
 * *** IT IS ALSO THE GAP `platform-authority.ts` NAMED AND COULD NOT CLOSE. *** Its header:
 * *"the tenant half of 'refused everywhere' is NOT in this file and cannot be — an Action resolves
 * through `identity/session-resolution.ts`, which knows nothing about `platform_operator`… the
 * Action-side half of 'refused everywhere' is a gap this slice does not close."* **This class does
 * close it for its own routes.** It does not close it for the Action pipeline, which still resolves
 * without probing `platform_operator`, and that remains open and is reported rather than implied.
 *
 * ===========================================================================================
 * FIVE DENIAL CAUSES, ONE ANSWER — the platform class's collapse, mirrored deliberately
 * ===========================================================================================
 *
 *   1. NO MEMBERSHIP ROW for this principal in this Organization.
 *   2. THE MEMBERSHIP IS SUSPENDED.                     treated identically to absent (`0003`)
 *   3. THE ORGANIZATION IS SUSPENDED.
 *   4. AN UNRECOGNISED STORED `role`.                   a row a future migration wrote
 *   5. THE PRINCIPAL HOLDS A `platform_operator` ROW.   `0024`, the state this file exists for
 *
 * All five answer the identical, argument-free `forbidden()`. `kernel/errors.ts` gives that
 * constructor no parameters, so there is nothing to vary. **The sixth cause — a role that does not
 * carry the permission — is `authorize()`, one layer up, and answers the same value**, which is
 * what keeps a caller unable to tell "you are not a member here" from "you are, and may not do
 * this".
 *
 * ===========================================================================================
 * BOTH READS ALWAYS RUN, AND THE COST IS PAID ON PURPOSE
 * ===========================================================================================
 *
 * `resolve` reads the membership AND probes `platform_operator` on every call, even when the first
 * read already decided the answer. `session-resolution.ts`, quoted by `platform-authority.ts` for
 * the identical construction:
 *
 *   "The ERROR was already identical; THE WORK WAS NOT, and work is measurable."
 *
 * An early return would make an ordinary member cost one statement and a principal-in-both cost
 * two, and the second is the population whose existence must not be measurable.
 *
 * ===========================================================================================
 * WHAT THIS FILE MAY NEVER ACQUIRE
 * ===========================================================================================
 *
 * `TenantAdminAuthority` CARRIES AN ORGANIZATION IDENTIFIER AND THAT IS THE POINT OF THE CLASS —
 * it is the one thing the platform class's `PlatformAuthority` refuses to hold. So the property
 * that has to be protected here is the OPPOSITE one, and it is stated as a rule this type obeys:
 *
 *   **THE ORGANIZATION IDENTIFIER IS PRODUCED HERE AND CONSUMED BY CORE. IT IS NEVER READ FROM A
 *   REQUEST, AND IT IS NEVER ONE THE CALLER NAMED.**
 *
 * `resolve` takes it as a parameter, and the only caller passes the value on the caller's own
 * SESSION ROW — server-side state written by `selectOrganization`, which validated membership
 * before writing it (`0014` §C.6). There is no overload taking it from a body, a header, a path or
 * a query, and `tenant-admin-routes.ts::assertNoOrganizationIdentifierInAnyRequestPosition` fails
 * the build if a route ever declares one.
 *
 * IT IS NOT AN `AuthenticatedPrincipal` AND THERE IS NO FUNCTION THAT TURNS ONE INTO THE OTHER.
 * That type carries `authorizedBusinessIds` and `businessScope` and is the value
 * `TenantStoreResolver` consumes. A tenant-admin route reaches CONTROL-PLANE ports; giving its
 * authority the shape a tenant-store resolver accepts would put the whole tenant database one
 * function call from a class that has no business reading a customer row.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { forbidden } from '../kernel/errors.ts';
import type { PrincipalGrants } from '../authorization/authorizer.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import { grantsForRole, toMembershipRole } from '../authorization/roles.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';
import { consumeAuthenticatedOrganizationId } from './authenticated-organization.ts';

/**
 * A principal established as an administrator-capable member of ONE Organization.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `authorizedBusinessIds`, `businessScope`, any store,
 * any resolver, any binding, and any second organization identifier. A tenant-admin route
 * administers the Organization the caller is in; a field able to hold a second one is the field a
 * cross-tenant read is eventually written against.
 */
export type TenantAdminAuthority = {
  readonly principalId: string;
  /**
   * THE TENANT. Read from the caller's session row, never from the request.
   *
   * It is here because this class's whole purpose is to administer it — see the header for the
   * rule that replaces the platform class's "there is no tenant identifier in this type".
   *
   * *** IT IS BRANDED, SO A HANDLER CANNOT SUBSTITUTE ONE. *** `0044` §3a-i: the registration
   * refusal examines route DECLARATIONS, so it cannot see a handler that obtains the value
   * correctly and passes something else to a store two frames later. **Every store port in this
   * class takes the branded type**, so the substitution does not compile rather than being
   * refused at a boundary the substitution never crosses.
   */
  readonly organizationId: AuthenticatedOrganizationId;
  /** Narrowed to a recognised value. An unrecognised stored role never produces an authority. */
  readonly role: MembershipRole;
  /** The frozen literal set `authorization/roles.ts` maps the role to. The ONLY mapping. */
  readonly grants: PrincipalGrants;
};

/**
 * What the resolver needs, and nothing else.
 *
 * ===========================================================================================
 * TWO METHODS, BOTH KEYED BY A PRINCIPAL. THIS PORT CANNOT ENUMERATE ANYTHING.
 * ===========================================================================================
 *
 * `IdentityControlPlaneStore` already answers the first question and `PlatformOperatorStore`
 * already answers the second, and neither is passed here. Those ports also carry
 * `createSession`, `resetCredential`, `deleteSession`, `listMembershipsForPrincipal` and the
 * Organization enumeration a platform console needs — reach this resolver has no use for.
 *
 * `core-agent` recorded the general form in `architecture.md` §3a-0 after finding a handler that
 * still held the port whose only use had been removed: **a dependency a component does not use is
 * REACH IT HAS NOT EXERCISED**, and an absent parameter is a mechanism where a comment saying "we
 * do not call this" is a discipline.
 *
 * *** NO ADAPTER IMPLEMENTS THIS YET, AND IT IS NOT SATISFIABLE BY DELEGATING TO
 * `IdentityControlPlaneStore`. *** That port's `findMembershipWithOrganization` returns an
 * `OrganizationMembershipRecord`, whose `role` the D1 adapter has ALREADY narrowed to
 * `MembershipRole | null` — and `storedRole` below is deliberately raw. **The two reads over one
 * column want opposite defaults for an unrecognised value**: a grant read must collapse it to
 * "deny the caller", and `owner-immunity.ts`'s protection read must collapse it to "protect the
 * target". Delegating would silently take the first everywhere. See `clearOwnerImmunity` for the
 * full argument; it is the reason both of these ports carry a `string` and not a `MembershipRole`.
 */
export type TenantAdminAuthorityStore = {
  /**
   * The membership binding this principal to this Organization, together with that Organization's
   * status — or `null`.
   *
   * `null` MUST MEAN "NO ACTIVE MEMBERSHIP ROW" AND MUST MEAN IT WITHOUT HAVING LOOKED AT THE
   * ORGANIZATION TABLE, which is the property `MembershipWithOrganization` documents at length and
   * the adapter is written to. The word "active" is load-bearing and is where the first version of
   * that port was wrong: filtering status ABOVE the port made a suspended membership cost one more
   * statement than a non-member, and the error was already identical while the work was not.
   */
  findActiveMembership(
    principalId: string,
    organization: AuthenticatedOrganizationId,
  ): Promise<Result<TenantAdminMembership | null>>;

  /**
   * Does this principal hold a `platform_operator` row?
   *
   * A BOOLEAN AND NEVER THE ROW. Nothing in this class may learn an operator's platform role, and
   * a caller that could tell an unrecognised `platform_role` from a recognised one would be
   * measuring the platform's own accounts from inside a tenant.
   *
   * **A ROW WITH AN UNRECOGNISED ROLE STILL COUNTS AS `true`.** The invariant is about the row's
   * EXISTENCE rather than about what it currently grants — `admitMembershipWrite` makes the same
   * ruling in the other direction, and for the same reason: a role this build does not understand
   * may be one a later build does.
   */
  principalIsPlatformOperator(principalId: string): Promise<Result<boolean>>;
};

/**
 * What `findActiveMembership` returns. The stored role is a RAW STRING here, deliberately.
 *
 * Narrowing it is `toMembershipRole`'s job and happens in the resolver below, so that "this build
 * does not recognise the stored value" is decided in one place and denies on the same path as an
 * absent row. A port returning an already-narrowed `MembershipRole | null` would merge "no role
 * set" with "a role a future migration wrote" **inside the adapter**, where the decision is
 * invisible.
 */
export type TenantAdminMembership = {
  readonly principalId: string;
  readonly organizationId: string;
  /** The stored `organization_membership.role`, unnarrowed. May be `null` or unrecognised. */
  readonly storedRole: string | null;
  /** The Organization's own status. A suspended Organization is not administrable. */
  readonly organizationStatus: 'active' | 'suspended';
};

export type TenantAdminAuthorityResolver = {
  /**
   * Resolves a server-derived principal identifier and a server-derived Organization identifier
   * into tenant-admin authority, or refuses.
   *
   * **BOTH ARGUMENTS COME FROM THE SESSION AND FROM NOWHERE ELSE.** There is no overload taking
   * either from a request field, and adding one would be the same defect class as a
   * caller-supplied tenant identifier — `MULTITENANCY_STANDARD.md` §3, and `0044` §3b.2, which
   * makes it a registration failure rather than a review note.
   */
  resolve(
    principalId: string,
    organization: AuthenticatedOrganizationId,
  ): Promise<Result<TenantAdminAuthority>>;
};

export function createTenantAdminAuthorityResolver(
  store: TenantAdminAuthorityStore,
): TenantAdminAuthorityResolver {
  return {
    async resolve(
      principalId: string,
      organization: AuthenticatedOrganizationId,
    ): Promise<Result<TenantAdminAuthority>> {
      // ---- THE BRAND, AND THE BINDING. `authenticated-organization.ts`.
      //
      // It throws rather than returning a refusal, because no client can cause either failure:
      // clients supply values and never sealed contexts. **A fabricated identifier does not
      // compile; one carried across a request boundary stops the request here.**
      //
      // *** THIS IS NOT WHAT MAKES THE CLASS SAFE AND MUST NOT BE DESCRIBED AS SUCH. *** The
      // membership read below is the layer with no window — see `authenticated-organization.ts`
      // for the ranking, and `0044` §3a-i for why the class's own headline claim overstated it.
      const organizationId = consumeAuthenticatedOrganizationId(organization, principalId);

      // ---- BOTH READS, UNCONDITIONALLY, BEFORE ANY DECISION. See the header.
      const membershipOutcome = await store.findActiveMembership(principalId, organization);
      const operatorOutcome = await store.principalIsPlatformOperator(principalId);

      // A store failure is a Dudo-side fault and is reported as itself (`unavailable`), never
      // collapsed into `forbidden`. Collapsing it would tell a real administrator their membership
      // had been revoked when the database was merely unreachable, and would hide an outage behind
      // a routine answer. `platform-authority.ts` makes the identical call.
      if (!membershipOutcome.ok) {
        return err(membershipOutcome.error);
      }
      if (!operatorOutcome.ok) {
        return err(operatorOutcome.error);
      }

      // =====================================================================================
      // THE MUTUAL EXCLUSION, FAILING CLOSED, AND CHECKED FIRST AMONG THE DENIAL CAUSES.
      // =====================================================================================
      //
      // First for the reason `platform-authority.ts` puts it first: **so that no later edit can
      // place a "resolve in favour of the membership row" branch above it.** A principal in both
      // tables is refused here and refused there; it is not resolved in favour of either side.
      if (operatorOutcome.value) {
        return err(forbidden());
      }

      const membership = membershipOutcome.value;
      if (membership === null) {
        return err(forbidden());
      }
      if (membership.organizationStatus !== 'active') {
        return err(forbidden());
      }

      // `toMembershipRole` returns `null` for BOTH an absent role and a stored value this build
      // does not recognise, and merging them is `0019`'s decision rather than a shortcut: both
      // deny everything, so a caller able to tell them apart would hold a distinction with no
      // legitimate use and one illegitimate one.
      //
      // *** THIS IS THE PROPERTY THAT LETS `0018_membership_role_admin.sql` BE APPLIED BEFORE THE
      // DEPLOYMENT THAT UNDERSTANDS ITS NEW VALUES. *** A database ahead of a build sees `'admin'`
      // in a column, hands it to a build whose union has two members, and gets `null` — deny all,
      // on the same path as an absent membership. It does not error and it does not partially
      // grant. `0043` §3a states it as a requirement of the widening; it is a property of this
      // line.
      const role = toMembershipRole(membership.storedRole);
      if (role === null) {
        return err(forbidden());
      }

      // THE AUTHORITY CARRIES THE SEALED VALUE THROUGH, NOT THE ONE THE ADAPTER ECHOED BACK.
      //
      // `membership.organizationId` is a plain string the store returned, and returning THAT would
      // launder an adapter's output into the type that means "this came from the session" —
      // **which is the one claim the brand exists to make.** They agree today; the point is that
      // nothing would notice if they ever did not.
      //
      // `organizationId` above is the unwrapped value, used only to compare — it is deliberately
      // NOT what goes into the authority.
      if (membership.organizationId !== organizationId) {
        // An adapter answering about a different Organization than it was asked about. There is no
        // legitimate route to this, so it refuses rather than trusting either side.
        return err(forbidden());
      }
      return ok({
        principalId: membership.principalId,
        organizationId: organization,
        role,
        grants: grantsForRole(role),
      });
    },
  };
}
