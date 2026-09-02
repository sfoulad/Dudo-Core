/**
 * The authorization decision. Core decides, on every call, denying by default.
 *
 * AUTHORIZATION_STANDARD.md §5: "Never trust that a caller already checked — not the web
 * client, not the Apple client, not an App, not another internal service, not the SDK."
 * §1: "Default = Deny. Not 'deny after the checks fail' — deny unless a check explicitly
 * passed."
 *
 * THIS DECISION IS RECORD-INDEPENDENT, AND THAT IS THE POINT OF ITS POSITION IN THE
 * PIPELINE. It runs at step 3 of the Customer Directory contract's normative evaluation
 * order — before input validation and before any row is read — so a `forbidden` returned
 * from here cannot be correlated with whether a record exists. The contract states one
 * exception, at step 5b, which is a separate function in a separate file
 * (business-scope.ts), so the two cannot be confused for one another.
 *
 * THREE THINGS MUST HOLD, AND THE EFFECTIVE ANSWER IS THEIR INTERSECTION.
 *
 * docs/decisions/0007 rule 5: "Requested scope cannot exceed the user, role, tenant or App
 * scope. The effective scope is the INTERSECTION, NEVER THE UNION." 0007 identifies rule 5
 * as the rule whose absence allowed CRIT-1, so reading it as a union is not a small error.
 *
 *   1. THE APP DECLARED THE PERMISSION. Undeclared is denied, at the boundary, at call
 *      time (§8). A first-party App gets no special path: "If an official App works
 *      without a declared permission, the enforcement is broken."
 *   2. THE APP'S REQUESTED SCOPE REACHES THE ACTION'S SCOPE. The manifest scope is a
 *      CEILING.
 *   3. THE PRINCIPAL HOLDS THE PERMISSION AT A SCOPE THAT REACHES THE ACTION'S SCOPE.
 *
 * The Team Lead's ruling recorded in customer-directory-v1.contract.yaml
 * (manifest.manifestScopeVersusActionScope) is implemented by 2 and 3 being separate
 * conditions that must BOTH hold. The error it prevents is reading the App's scope as a
 * floor: an App installed organization-wide does not give a business-admin
 * organization-wide reach. Under a union reading, installing an App would silently promote
 * every business-scope principal in the tenant to organization scope — a privilege
 * escalation with no grant, no audit entry and no visible cause. Here, condition 3 is
 * evaluated against the principal's own grant and the App's installation is never
 * substituted for it.
 *
 * NOT DECIDED HERE, AND NOT INVENTED HERE: how a principal comes to hold a grant (AZ5),
 * what a wildcard in a role definition expands to (AZ6), and the authentication scheme
 * that produces a principal at all (AZ2). This module consumes a grant set and produces a
 * decision; it issues nothing.
 */

import type { Scope } from './scope.ts';
import { implies } from './scope.ts';

/** One grant: a permission id held at a scope. Additive; there are no negative permissions. */
export type PermissionGrant = {
  readonly permissionId: string;
  readonly scope: Scope;
};

/**
 * What the authenticated principal holds, derived from the authenticated context. This
 * type is deliberately a plain set rather than a role: AUTHORIZATION_STANDARD.md §9 says
 * "A role name appearing in a conditional in source is a defect. Code checks permissions."
 * There is nowhere in this module for a role name to appear.
 */
export type PrincipalGrants = {
  readonly grants: readonly PermissionGrant[];
};

/**
 * What an App declared in its manifest and was granted at install: the ceiling. For the
 * Customer Directory this is the nine permissions of `packages/contracts/apps/customers/
 * manifest.json`, each requested at `organization` scope.
 */
export type AppPermissionEnvelope = {
  readonly appId: string;
  readonly declared: readonly PermissionGrant[];
};

export type AuthorizationDecision = {
  readonly allowed: boolean;
  /**
   * The permission and scope ACTUALLY EVALUATED, for the audit record. The contract
   * requires the audit line to name them (audit.record.fields), and recording what was
   * evaluated rather than what was requested is what makes an audit trail able to show a
   * scope was checked at the wrong level.
   */
  readonly permissionId: string;
  readonly scope: Scope;
};

export type Authorizer = {
  authorize(
    grants: PrincipalGrants,
    app: AppPermissionEnvelope,
    permissionId: string,
    actionScope: Scope,
  ): AuthorizationDecision;
};

function holdsAtOrAbove(
  grants: readonly PermissionGrant[],
  permissionId: string,
  actionScope: Scope,
): boolean {
  for (const grant of grants) {
    if (grant.permissionId === permissionId && implies(grant.scope, actionScope)) {
      return true;
    }
  }
  return false;
}

export function createAuthorizer(): Authorizer {
  return {
    authorize(
      grants: PrincipalGrants,
      app: AppPermissionEnvelope,
      permissionId: string,
      actionScope: Scope,
    ): AuthorizationDecision {
      const denied: AuthorizationDecision = { allowed: false, permissionId, scope: actionScope };

      // 1 and 2. The App declared it, and its requested scope reaches the Action's scope.
      // Both are read from the same entry so a declaration at too narrow a scope cannot
      // satisfy a wider Action by being present.
      const declaration = app.declared.find((entry) => entry.permissionId === permissionId);
      if (declaration === undefined) {
        return denied;
      }
      if (!implies(declaration.scope, actionScope)) {
        return denied;
      }

      // 3. The principal holds it. Evaluated against the principal's own grant; the App's
      // installation is not substituted for it, which is the whole of the ceiling-not-floor
      // ruling.
      if (!holdsAtOrAbove(grants.grants, permissionId, actionScope)) {
        return denied;
      }

      return { allowed: true, permissionId, scope: actionScope };
    },
  };
}
