/**
 * WHERE A PRINCIPAL'S GRANTS AND BUSINESS SET COME FROM — declared as a port, and answered by
 * nothing.
 *
 * ===========================================================================================
 * THIS FILE EXISTS BECAUSE `0014` §C LEFT A GAP THAT ONLY BECOMES VISIBLE DURING IMPLEMENTATION
 * ===========================================================================================
 *
 * §C.5 fixes the resolution order:
 *
 *   session -> principal -> memberships -> authorized Organization/business context ->
 *   TenantStoreResolver -> business data
 *
 * `AuthenticatedPrincipal` (`tenancy/tenant-context.ts`) cannot be sealed without two more
 * values: `grants` and `authorizedBusinessIds`. Both are facts about a principal WITHIN an
 * Organization, and both are needed BEFORE the tenant store is resolved, because the pipeline
 * authorizes at step 3 and only reaches storage at step 5. So they sit exactly on the
 * "authorized Organization/business context" step above — named in the order, defined nowhere.
 *
 * NEITHER CAN BE ANSWERED YET, AND NEITHER IS ANSWERED HERE:
 *
 *   - GRANTS. `docs/decisions/0007` records the logical permission model but does not say where
 *     a principal's grants are STORED. Putting role or permission columns on
 *     `organization_membership` would settle that question in a migration, as a side effect of
 *     unblocking a login. That is the same class of shortcut
 *     `platform/core/migrations/0002_business.sql` refused when it declined to invent a Business
 *     lifecycle.
 *
 *   - THE BUSINESS SET. `tenancy/tenant-context.ts` records the rule: "an organization-scope
 *     principal's set is every Business in its Organization". That set can only be computed by
 *     reading the tenant's `business` table — which is behind `TenantStoreResolver`, which is
 *     AFTER this step in §C.5's order. For a business-scope principal the set is an assignment
 *     that the organization-structure slice owns and that does not exist either.
 *
 * ===========================================================================================
 * SO THE ANSWER IS A PORT WITH A DENY-ALL DEFAULT, AND THE CONSEQUENCE IS STATED, NOT SOFTENED
 * ===========================================================================================
 *
 * `createDenyAllPrincipalAuthorizationSource` returns no grants and no Businesses. A principal
 * resolved through it authenticates successfully and is then refused by the authorizer at
 * pipeline step 3, and by an empty business set at every step that narrows. Every business
 * request still fails closed.
 *
 * That is the correct state, and it is the same posture `createDenyAllPrincipalResolver` takes
 * in `principal-resolver.ts`: the port is present, the pipeline is wired, and the answer is no.
 * It must not be "fixed" by a permissive default, which would be an authorization bypass wearing
 * the word default.
 *
 * WHAT PART C DOES DELIVER, so the gap is not read as bigger than it is: everything to the LEFT
 * of this step in §C.5 is built and runs — session, principal, membership, the Organization hint
 * ruling, and the tenant directory. This is the one step that is a stub, and it is a stub
 * because two other decisions are open, not because it was skipped.
 */

import type { PrincipalGrants } from '../authorization/authorizer.ts';
import { grantsForRole } from '../authorization/roles.ts';
import type { Result } from '../kernel/result.ts';
import { ok } from '../kernel/result.ts';
import type {
  ControlPlanePrincipalType,
  OrganizationMembershipRecord,
} from './control-plane-store.ts';

/**
 * The two values the identity layer cannot derive from the control plane alone.
 *
 * `authorizedBusinessIds` is `readonly string[]` and an EMPTY ARRAY IS MEANINGFUL: it means the
 * principal is authorized over no Business, which the storage boundary renders as `0 = 1` rather
 * than as "no narrowing" (`adapters/sql/sql-compiler.ts`). Empty is the safe value; there is no
 * sentinel meaning "all".
 */
export type PrincipalAuthorization = {
  readonly grants: PrincipalGrants;
  readonly authorizedBusinessIds: readonly string[];
};

/**
 * What the resolver knows at the moment it asks. Note that it hands over the MEMBERSHIP, not a
 * caller-supplied Organization identifier: by this point membership has been validated, so an
 * implementation of this port cannot be tricked into answering for an Organization the principal
 * does not belong to.
 */
export type PrincipalAuthorizationRequest = {
  readonly principalId: string;
  readonly principalType: ControlPlanePrincipalType;
  readonly membership: OrganizationMembershipRecord;
};

export type PrincipalAuthorizationSource = {
  resolve(request: PrincipalAuthorizationRequest): Promise<Result<PrincipalAuthorization>>;
};

/**
 * Grants nothing to anyone.
 *
 * IT IS NO LONGER THE PRODUCTION IMPLEMENTATION AND IT IS DELIBERATELY NOT DELETED.
 * `docs/decisions/0019` replaced it at the composition site with the membership-backed source
 * below, and required this one to stay in the tree — it remains the correct answer for a
 * principal with no recognised role, it is what a verification harness composes when it wants a
 * principal that authenticates and can do nothing, and a fail-closed default that has been
 * deleted is a fail-closed default nobody can fall back to.
 */
export function createDenyAllPrincipalAuthorizationSource(): PrincipalAuthorizationSource {
  const nothing: PrincipalAuthorization = {
    grants: { grants: [] },
    authorizedBusinessIds: [],
  };
  return {
    async resolve(): Promise<Result<PrincipalAuthorization>> {
      return ok(nothing);
    },
  };
}

/**
 * ===========================================================================================
 * THE MEMBERSHIP-BACKED SOURCE. `docs/decisions/0019`, closing the GRANTS half of AZ5.
 * ===========================================================================================
 *
 * It reads the role off the membership row the resolver has ALREADY VALIDATED and maps it through
 * `authorization/roles.ts`. That is the whole implementation, and its smallness is the design:
 * the mapping is a frozen table of literal permission identifiers, so there is no query, no cache,
 * no second source of truth, and no row-write.
 *
 * IT CANNOT BE ASKED ABOUT AN ORGANIZATION THE PRINCIPAL DOES NOT BELONG TO.
 * `PrincipalAuthorizationRequest` carries the MEMBERSHIP, not a caller-supplied Organization
 * identifier — the port was built that way before there was anything to grant, and it is what
 * stops this function being tricked into answering for the wrong tenant. There is no parameter
 * here through which a request value could arrive.
 *
 * THE ROLE NAME STOPS HERE. `AUTHORIZATION_STANDARD.md` §9 — "a role name appearing in a
 * conditional in source is a defect" — holds: the name is used once, as a lookup key, and what
 * leaves this function is a set of permissions with no memory of which role produced it.
 *
 * ===========================================================================================
 * `authorizedBusinessIds` IS EMPTY HERE, AND SINCE `docs/decisions/0020` THAT IS THE DESIGN
 * RATHER THAN A GAP. THE ORIGINAL ARGUMENT IS KEPT BECAUSE IT RECORDS WHY THE GAP EXISTED.
 * ===========================================================================================
 *
 * AS WRITTEN, WHEN THIS WAS STILL OPEN: *"`tenancy/tenant-context.ts`: 'An organization-scope
 * principal's set is every Business in its Organization.' Computing that set is a read of the
 * TENANT database's `business` table, which requires a tenant store handle, which comes from
 * `TenantStoreResolver` — and `0014` §C.5 fixes the order as `session -> principal -> memberships
 * -> authorized context -> TenantStoreResolver -> business data`. THIS STEP IS BEFORE THE STORE
 * EXISTS."*
 *
 * **THE DEPENDENCY WAS NEVER CIRCULAR, AND THAT IS WHAT THE ARGUMENT ABOVE MISSED.** The resolver
 * needs the ORGANIZATION, which is known here; only the business set needs the STORE. §C.5
 * bundled two things with different dependencies into one step. `0020` SPLITS THEM:
 *
 *   session -> principal -> memberships -> authorized ORGANIZATION context ->
 *   TenantStoreResolver -> authorized BUSINESS set -> business data
 *
 * **It is a split, not a reordering.** Nothing about when authorization happens has moved, and
 * describing it as "we reordered authorization" invites a security reading it does not deserve.
 *
 * SO THIS FUNCTION ANSWERS THE ORGANIZATION HALF — the grants — and `action/pipeline.ts` completes
 * the principal with the business set immediately after the tenant store resolves, reading it
 * through the tenant-scoped handle so it is tenant-scoped by construction. The set is computed
 * per request and never cached beyond it: a Business removed mid-session must not stay authorized
 * for twelve hours.
 *
 * WHAT WAS RIGHT IN THE ORIGINAL ARGUMENT AND STAYS RIGHT: there is no sentinel meaning "all" and
 * one must not be invented. A magic value would be an ambient tenant-wide grant wearing an array.
 * `AuthenticatedPrincipal.businessScope` is an EXPLICIT field for exactly that reason — it says
 * which rule fills the set, rather than overloading the empty array that means "authorized over
 * nothing" everywhere else in this codebase.
 */
export function createMembershipPrincipalAuthorizationSource(): PrincipalAuthorizationSource {
  return {
    async resolve(
      request: PrincipalAuthorizationRequest,
    ): Promise<Result<PrincipalAuthorization>> {
      return ok({
        grants: grantsForRole(request.membership.role),
        // Empty HERE, and completed by the pipeline after the tenant store resolves. `0020`.
        // This is not a placeholder and must not be filled in from the control plane: the set
        // lives in the tenant's own `business` table and reading it through the tenant handle is
        // what makes it tenant-scoped by construction rather than by care.
        authorizedBusinessIds: [],
      });
    },
  };
}
