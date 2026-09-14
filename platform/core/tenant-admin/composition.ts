/**
 * ===========================================================================================
 * THE TENANT-ADMIN ROUTE CLASS, ASSEMBLED. `docs/decisions/0044`.
 * ===========================================================================================
 *
 * Every piece the class needs is a port with one implementation, and this file is the one place
 * they are put together. It exists so that `http/adapters/worker-entry.ts` — the file that names
 * Cloudflare types — does not also have to know the authority-resolution order or which routes
 * have handlers.
 *
 * IT TAKES PORTS AND RETURNS PORTS. It names no binding, no `Env`, no D1 type and no Durable
 * Object, so a verification harness composes exactly what production composes by passing a fake
 * `TenantAdminAuthorityStore`. That is the seam `qa-agent` needs in order to seed a principal into
 * BOTH `organization_membership` and `platform_operator` and drive the real dispatcher against it
 * — which is the `0024` case this class is the first to refuse from the tenant side.
 *
 * ===========================================================================================
 * *** NOTHING CALLS THIS YET, AND `worker-entry.ts` IS DELIBERATELY NOT EDITED. ***
 * ===========================================================================================
 *
 * The route table is empty, so mounting the class would add a transport branch that **no input can
 * reach** — `workflow.md` §11a's unreachable branch, which nothing tests and in which a
 * one-character defect survives every reader. `platform-routes.ts` carries two such branches in
 * its own history and both were found by writing an assertion rather than by review.
 *
 * **SO THE WIRING LANDS WITH THE FIRST ROUTE, IN THE SAME CHANGE, WHEN IT CAN BE EXERCISED.** What
 * that change owes, written here because it is the file that will be open at the time:
 *
 *   1. `http/api.ts` matches `matchTenantAdminRoute` **before the App router**, in the absolute
 *      block beside the platform one, and 404s when `isTenantAdminHost` is false.
 *   2. `worker-entry.ts` builds the `TenantAdminAuditRecorder` over the tenant store resolver —
 *      it is the composition root that already holds one, for the reason `platform/composition.ts`
 *      gives about `onboarding`, `members` and `reset`.
 *   3. `authenticateTenantPrincipal` is implemented over `SessionResolver.resolve`, mapping
 *      `organization-not-selected` to `failed_precondition` and nothing else.
 */

import type { Result } from '../kernel/result.ts';
import type { Authorizer } from '../authorization/authorizer.ts';
import type { ConfirmationGate } from '../confirmation/confirmation-gate.ts';
import type { TenantAdminAuthorityStore } from './tenant-admin-authority.ts';
import { createTenantAdminAuthorityResolver } from './tenant-admin-authority.ts';
import type { TenantAdminAuditRecorder } from './tenant-admin-audit.ts';
import type { InvitationStore } from './invitation-administration.ts';
import { createInvitationService } from './invitation-administration.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';
import type { TenantAdminRouteDependencies, TenantAdminRouteHandlers } from './tenant-admin-routes.ts';

export type TenantAdminCompositionInput = {
  /**
   * The two-method authority port. See `TenantAdminAuthorityStore` for why it is not
   * `IdentityControlPlaneStore` and why it cannot be satisfied by delegating to one.
   */
  readonly authorityStore: TenantAdminAuthorityStore;
  /**
   * The audit recorder, ALREADY ASSEMBLED.
   *
   * PASSED IN RATHER THAN BUILT HERE, for the reason `platform/composition.ts` gives about
   * `onboarding`: building it needs a `TenantStoreResolver`, and a composition root that holds one
   * holds a handle to every tenant database. `tenant-admin-audit.ts` records why that is a
   * narrower obligation here than the platform class's P1 — this class HAS a tenant — and what
   * must stay true regardless: **the resolver is never on the context.**
   */
  readonly audit: TenantAdminAuditRecorder;
  /**
   * The SAME authorizer every Action uses. Not a class-specific one.
   *
   * `authorize()` already takes the envelope as a parameter, which is the property that let `0023`
   * give Core its own envelope and `0021` add a request class without touching the pipeline. A
   * second authorization function here would be a second place the ceiling-and-floor rule is
   * implemented and therefore a second place it can differ.
   */
  readonly authorizer: Authorizer;
  /** The credential reader the ordinary authenticated path and the other classes use. */
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
  /**
   * A session identifier to the principal and the Organization that session has selected.
   *
   * Implemented over `SessionResolver.resolve`. **It must map `organization-not-selected` to
   * `failed_precondition` rather than to `unauthenticated`**: the session is valid, the caller's
   * correct next act is to select an Organization, and answering `unauthenticated` would send a
   * client to the login screen to fix a state logging in again would not change.
   *
   * *** AND IT SEALS THE ORGANIZATION WITH `sealAuthenticatedOrganizationId`, WHICH TAKES THE
   * `AuthenticatedPrincipal` `resolve` RETURNS. *** That is the only producer, and it cannot be
   * called with a string — so this function is the single place in the platform where an
   * Organization identifier enters the tenant-admin class, and it enters carrying proof of where
   * it came from. **This composition root holds the `SessionResolver`, which is why the seal is
   * exported rather than module-private** (`authenticated-organization.ts` states the trade).
   */
  readonly authenticateTenantPrincipal: (
    sessionId: string,
  ) => Promise<
    Result<{
      readonly principalId: string;
      readonly organizationId: AuthenticatedOrganizationId;
    }>
  >;
  /**
   * The confirmation gate. OPTIONAL, AND ABSENT MEANS A CRITICAL ROUTE ANSWERS `unavailable`.
   *
   * It is passed through rather than built here. Building it needs a `CredentialVerifier`, and
   * this class would then hold the ability to verify a password — reach it has no other use for.
   * The Action pipeline and the platform class receive the same instance.
   */
  readonly confirmationGate?: ConfirmationGate;
  /**
   * The hostnames the PLATFORM console is served on. This class is refused on them.
   *
   * REQUIRED, NO DEFAULT — and note the polarity is the opposite of the platform class's, where an
   * empty list means "unreachable". Here an empty list means "served everywhere", so a default
   * would be this file choosing to serve tenant administration on the admin console. See
   * `isTenantAdminHost`.
   */
  readonly adminHosts: readonly string[];
  /**
   * =========================================================================================
   * *** THE INVITATION STORE GOES IN AND DOES NOT COME OUT. THAT IS THE POINT OF IT BEING HERE. ***
   * =========================================================================================
   *
   * This root takes the STORE and publishes only the SERVICE. **A handler therefore cannot obtain
   * an `InvitationStore` from anything this class hands it**, and `createInvitation` is unreachable
   * except through `InvitationService.create`.
   *
   * *** WHY THAT MATTERS, AND IT IS NOT STYLE. *** The two consumptions of `GrantCeilingCleared`
   * check different facts: the service checks the **grantor and the offer fingerprint**, the store
   * checks the **brand and the Organization**. **A handler reaching the store directly gets the
   * tenant-isolation half and neither of the other two** — so it could spend a clearance minted for
   * a different administrator, or for a different offered role, and every check in the write path
   * would be green. `architecture.md` §3a-0: *a dependency a handler does not use is reach it has
   * not exercised* — and this is worse, because the store is precisely the layer that cannot see
   * what the other half checks.
   *
   * **BUILT AT ZERO HANDLERS, DELIBERATELY.** The same trade as extending the Organization brand to
   * every store port before any route existed: the compiler names nothing today, and after 21
   * routes land it is a retrofit across all of them. **Unlike the brand, this one closes a hole
   * that is reachable rather than pre-empting one that is not.**
   */
  readonly invitationStore: InvitationStore;
  /**
   * The handlers. **THERE ARE NONE AND THERE CAN BE NONE.**
   *
   * `TenantAdminRouteId` is `never`, so this type is `{}` and the only value it accepts is the
   * empty object. Optional so that a caller need not write `handlers: {}`; it is not a default
   * standing in for something absent.
   */
  readonly handlers?: TenantAdminRouteHandlers;
};

export function createTenantAdminComposition(
  input: TenantAdminCompositionInput,
): TenantAdminRouteDependencies {
  return {
    handlers: input.handlers ?? {},
    readSessionId: input.readSessionId,
    authenticateTenantPrincipal: input.authenticateTenantPrincipal,
    // `0024`'s TENANT-SIDE HALF LIVES INSIDE THIS. `createTenantAdminAuthorityResolver` reads the
    // membership AND probes `platform_operator` on every call, and refuses a principal present in
    // both with the same argument-free `forbidden()` a non-member receives. There is no way to
    // compose the class without it, because there is no other producer of the
    // `TenantAdminAuthority` the dispatcher requires.
    authority: createTenantAdminAuthorityResolver(input.authorityStore),
    authorizer: input.authorizer,
    audit: input.audit,
    confirmations: input.confirmationGate,
    adminHosts: Object.freeze([...input.adminHosts]),
    // =======================================================================================
    // *** THE STORE IS CONSUMED HERE AND NEVER REPUBLISHED. ***
    // =======================================================================================
    //
    // `input.invitationStore` goes into `createInvitationService` and appears nowhere in the
    // returned object. **So the only invitation capability anything downstream can hold is the
    // service**, which consumes the grantor and the offer fingerprint before it calls the store —
    // the two checks the store itself structurally cannot make.
    //
    // **PUTTING THE STORE ON THE RETURNED DEPENDENCIES WOULD UNDO THE WHOLE THING**, and it would
    // look like a convenience. That is the edit to refuse.
    invitations: createInvitationService(input.invitationStore),
  };
}
