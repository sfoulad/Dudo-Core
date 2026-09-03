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
 * Grants nothing to anyone. See the header for why this is the only implementation that may
 * exist until `0007`'s storage question and the organization-structure slice are settled.
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
