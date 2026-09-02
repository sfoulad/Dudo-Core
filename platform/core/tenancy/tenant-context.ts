/**
 * Tenant and principal context.
 *
 * MULTITENANCY_STANDARD.md §3: tenant identity comes from the authenticated context,
 * resolved on the server, every time — never from a body field, path segment, query
 * string, header, cookie, cursor, SDK argument, hostname, unverified claim, or ambient
 * default. "The runtime sets tenant context; application code reads it and never writes
 * it."
 *
 * THE STRUCTURAL DECISION IN THIS FILE, AND IT IS THE MOST IMPORTANT ONE IN THE SLICE:
 *
 *   AN ACTION HANDLER IS NEVER GIVEN THE ORGANIZATION IDENTIFIER.
 *
 * `RequestContext` holds it and is Core-internal. `ActionContext` — the only thing an
 * Action handler ever sees — does not carry it, and there is no accessor that produces it.
 *
 * Under docs/decisions/0006 Option A every Organization's rows sit in one shared D1
 * database, so a query that has lost its tenant predicate does not fail and does not
 * return empty: it returns another Organization's row. The usual mitigation is a rule that
 * every query must carry the predicate. A rule is a thing people follow until the day they
 * do not.
 *
 * Withholding the value is stronger than requiring its use. An Action in this repository
 * cannot write a tenant predicate — correctly, incorrectly, or at all — because it has no
 * value to write one with. It equally cannot put a tenant identifier into a response, a
 * log line, an error message, a cache key, or an event envelope, which are five of the
 * eleven carriers in MULTITENANCY_STANDARD.md §4. The predicate is applied instead by the
 * storage boundary, from the handle, where it is written once (storage/store.ts).
 *
 * `business_id` is treated in exactly the opposite way and the asymmetry is deliberate:
 * the authorized business set IS on the ActionContext, because an Action must be able to
 * narrow to it and to answer `forbidden` against it. Business is an authorization scope
 * inside the tenant, not a second isolation boundary, and a business predicate is an
 * additional narrowing and never a substitute (customer-directory-v1.contract.yaml
 * tenancy.twoLevelCheck).
 */

import type { Clock } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { TenantScopedStore } from '../storage/store.ts';
import type { AuditSink } from '../audit/audit.ts';
import type { TenantBoundCursorCodec } from '../pagination/cursor.ts';
import type { PrincipalGrants } from '../authorization/authorizer.ts';

/**
 * Brand. Type-only, erased at runtime; its purpose is to make an object literal that
 * merely has the right fields fail to type-check as an authenticated principal, so that a
 * context cannot be assembled at a call site out of request data.
 */
declare const AUTHENTICATED_PRINCIPAL_BRAND: unique symbol;

/**
 * The output of authentication. Produced ONLY by a `PrincipalResolver` (identity.ts).
 *
 * `organizationId` is here because authentication is what determines it. Nothing above
 * the pipeline reads this type.
 */
export type AuthenticatedPrincipal = {
  readonly [AUTHENTICATED_PRINCIPAL_BRAND]: true;
  readonly principalId: string;
  readonly principalType: 'user' | 'team' | 'service-account' | 'ai-agent' | 'iot-device';
  /** The tenant. The Organization. Never leaves Core. */
  readonly organizationId: string;
  /**
   * The Businesses of that Organization this principal is authorized over, derived from
   * the authenticated context and NOT from the request
   * (customer-directory-v1.contract.yaml authorizationModel.evaluationOrder step 2).
   * An organization-scope principal's set is every Business in its Organization; a
   * business-scope principal's set is the one it is assigned.
   */
  readonly authorizedBusinessIds: readonly string[];
  /** The grants this principal holds, for the record-independent check at step 3. */
  readonly grants: PrincipalGrants;
  /** Set when an AI agent or a service account acts for a human (AUTHORIZATION_STANDARD.md §11). */
  readonly onBehalfOfPrincipalId: string | null;
};

/** Core-internal. Holds the tenant. Never passed to an Action handler. */
export type RequestContext = {
  readonly principal: AuthenticatedPrincipal;
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * What an Action handler receives. Note what is absent: no organization identifier, no
 * database handle, no binding, no `Env`, no way to reach storage other than `store`, and
 * no way to write an audit record other than `audit`.
 */
export type ActionContext = {
  readonly principalId: string;
  readonly onBehalfOfPrincipalId: string | null;
  /** See the note above on why this one IS exposed. */
  readonly authorizedBusinessIds: readonly string[];
  /** Tenant-bound. The tenant predicate is inside the handle, not in the caller's hands. */
  readonly store: TenantScopedStore;
  /** Tenant-bound. Writes land in this principal's Organization and nowhere else. */
  readonly audit: AuditSink;
  /**
   * Tenant-bound. An Action issues and verifies cursors for its caller's Organization
   * without ever holding a tenant identifier to bind one with.
   */
  readonly cursors: TenantBoundCursorCodec;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** For correlation only. Carries no tenant identifier (MULTITENANCY_STANDARD.md §4 carrier 11). */
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * The only constructor for an `AuthenticatedPrincipal`, and the reason it is here rather
 * than beside its consumers: a `PrincipalResolver` implementation lives in the identity
 * service, which does not exist yet (AZ2). When it does, it calls this. Nothing else may.
 *
 * The cast is the one place the brand is applied. It is contained to four lines and is
 * why an Action cannot fabricate a principal from request data.
 */
export function sealAuthenticatedPrincipal(
  fields: Omit<AuthenticatedPrincipal, typeof AUTHENTICATED_PRINCIPAL_BRAND>,
): AuthenticatedPrincipal {
  return fields as AuthenticatedPrincipal;
}
