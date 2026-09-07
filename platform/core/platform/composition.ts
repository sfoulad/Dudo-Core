/**
 * ===========================================================================================
 * THE PLATFORM ROUTE CLASS, ASSEMBLED. `docs/decisions/0025` · contract `platform-operator-v1`.
 * ===========================================================================================
 *
 * Every piece the class needs is a port with one implementation, and this file is the one place
 * they are put together. It exists so that `http/adapters/worker-entry.ts` — the file that names
 * Cloudflare types — does not also have to know the authority-resolution order, which secret keys
 * which primitive, or which of the two routes has a handler.
 *
 * IT TAKES PORTS AND KEYS AND RETURNS PORTS. It names no binding, no `Env`, no D1 type and no
 * Durable Object, so a verification harness composes exactly what production composes by passing
 * a fake `PlatformOperatorStore`. That is the seam `qa-agent` needs in order to seed a principal
 * into BOTH tables and drive the real dispatcher against it.
 *
 * ===========================================================================================
 * WHAT IT REFUSES TO BUILD, AND WHY THE REFUSAL IS THE POINT
 * ===========================================================================================
 *
 * `adminHosts` IS A REQUIRED ARGUMENT AND THERE IS NO DEFAULT. An empty list means every platform
 * route answers 404, which is the fail-closed direction; a default would be this file choosing a
 * deployment's hostnames, and a hostname chosen in Core is a hostname nobody reviews. See
 * `isPlatformHost` for why the host binding is a SECOND layer and must never become the first.
 *
 * IT TAKES NO `TenantStoreResolver`, NO `TenantScopedStore` AND NO TENANT DATABASE BINDING —
 * not as an optional argument, not as an unused one. `PlatformRouteDependencies` has no field
 * for one either, so there is no value anywhere in this class from which a tenant store could be
 * obtained. That is binding property P1, expressed as a type rather than as a rule.
 *
 * IT TAKES NO `SessionResolver`. Only a function from a session identifier to a principal
 * identifier. `SessionResolver` also carries `selectOrganization`, `issueSession` and
 * `revokeSession` — the ability to move, mint and destroy sessions — and none of that belongs in
 * a class whose two operations are reads. Passing the narrow function is least privilege between
 * two Core components, the same split `control-plane-store.ts` property 3 makes.
 */

import type { Clock } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import type { Authorizer } from '../authorization/authorizer.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import type { ConfirmationService } from '../confirmation/confirmation-service.ts';
import type { ConfirmationGate } from '../confirmation/confirmation-gate.ts';
import type { PlatformOperatorStore } from './platform-operator-store.ts';
import type { TemplateStore } from './template-store.ts';
import type { OnboardingService } from '../onboarding/onboarding.ts';
import type { MemberResolutionService } from '../directory/member-resolution.ts';
import type { CredentialResetService } from '../credential/reset-service.ts';
import type { PlatformRouteDependencies } from './platform-routes.ts';
import { createPlatformAuthorityResolver } from './platform-authority.ts';
import { createPlatformAuditRecorder } from './platform-audit.ts';
import { createPlatformCursorCodec } from './platform-cursor.ts';
import { createPlatformRouteHandlers } from './platform-route-handlers.ts';

export type PlatformCompositionInput = {
  readonly store: PlatformOperatorStore;
  /**
   * The Template catalogue. A SEPARATE PORT FROM `store`, deliberately.
   *
   * `PlatformOperatorStore` answers questions about operators, memberships and Organizations —
   * every one of them a question ABOUT a tenant or a principal. `TemplateStore` answers questions
   * about tenant-independent platform configuration and holds no identifier of either kind. One
   * port with both would be a handle that reaches strictly more than any single route needs, which
   * is the split `control-plane-store.ts` property 3 makes for the same reason.
   */
  readonly templates: TemplateStore;
  /**
   * The onboarding service. REQUIRED.
   *
   * *** IT IS PASSED IN RATHER THAN BUILT HERE, AND THAT IS THE WHOLE OF P1's SURVIVAL. ***
   * Building it would mean this file taking a `TenantStoreResolver`, a `RequestCoordinator` and an
   * `AuditSink` factory — at which point the platform class's composition root holds a handle to
   * every tenant database, and `0025` decision 3's binding property is gone for the whole class
   * rather than narrowed to one operation.
   *
   * SO THE COMPOSITION ROOT THAT ASSEMBLES IT IS `worker-entry.ts`, which already names Cloudflare
   * types and already holds the resolver. What arrives here is a port with one method that returns
   * identifiers.
   */
  readonly onboarding: OnboardingService;
  /**
   * The member resolve. REQUIRED, and passed in for the same reason `onboarding` is: building it
   * here would mean this file taking a `TenantStoreResolver`, and the platform class's composition
   * root would then hold a handle to every tenant database.
   *
   * **TWO SERVICES NOW ARRIVE THIS WAY AND THAT IS WORTH NOTICING RATHER THAN NORMALISING.** Each
   * is one operation that legitimately needs a tenant handle for a bounded purpose — onboarding
   * writes a Workspace into a tenant it is creating; this appends one audit row to a tenant it is
   * being asked about. **A third would be the point to ask whether P1 still means anything**, and
   * `0025`'s amendment is the sentence to measure it against.
   */
  readonly members: MemberResolutionService;
  /**
   * The credential reset. Passed in for the reason `onboarding` and `members` are: building it
   * here would mean this file taking a `TenantStoreResolver`.
   *
   * *** THIS IS THE THIRD SERVICE ARRIVING THIS WAY AND `0025`'s AMENDMENT SAYS "EXACTLY ONE". ***
   * The substance holds — each is one operation, bounded, reading no business data — but the
   * count in the record is now wrong, and it is flagged here rather than left for a reader to
   * discover by counting. **A fourth is the point to ask whether P1 still means anything.**
   */
  readonly reset: CredentialResetService;
  /**
   * The SAME admission port the identity slice uses, drawing from the SAME `DayWriteBudget`.
   *
   * `0014` §C.7: the separate database is an isolation boundary, not additional quota. An audit
   * record here consumes the same account-wide daily allowance as a session insert, so it must be
   * accounted in the same ledger, in the same unit, on the same UTC day — or the budget has a
   * hole in it the size of every platform request.
   */
  readonly admission: ControlPlaneWriteAdmission;
  /**
   * The SAME authorizer every Action uses. Not a platform-specific one.
   *
   * `authorize()` already takes the envelope as a parameter, which is the property that let
   * `0023` give Core its own envelope and `0021` add a request class without touching the
   * pipeline. A second authorization function for platform routes would be a second place the
   * ceiling-and-floor rule is implemented and therefore a second place it can differ.
   */
  readonly authorizer: Authorizer;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** The credential reader the ordinary authenticated path and the session routes both use. */
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
  /**
   * A session identifier to a principal identifier, and nothing else. Implemented over
   * `SessionResolver.resolvePrincipalId`, which is `0014` §C.5 steps 1 and 2 and stops there.
   */
  readonly authenticatePrincipal: (sessionId: string) => Promise<Result<string>>;
  /**
   * `CURSOR_SIGNING_KEY`. At least 32 bytes.
   *
   * SHARED WITH `pagination/cursor.ts` UNDER EXPLICIT DOMAIN SEPARATION — the two sign disjoint
   * message spaces, and the argument is written out at `platform-cursor.ts`. The Team Lead may
   * override it with a separate secret; it is a judgement call and is recorded as one.
   */
  readonly cursorSigningKey: CryptoBytes;
  /** Required, no default. An empty list makes every platform route answer 404. */
  readonly adminHosts: readonly string[];
  /**
   * The confirmation service, for `platform.confirmations.request`.
   *
   * OPTIONAL, AND ABSENT MEANS THE CHALLENGE ROUTE IS UNREACHABLE — the route stays registered and
   * `dispatchPlatformRoute` answers `unavailable` for a route with no composed handler. Not open,
   * not silently permissive.
   *
   * THE CONSEQUENCE IS WORTH STATING: with no challenge route, NO CONFIRMATION CAN BE OBTAINED,
   * so every `critical` platform operation is unreachable. That is the correct direction — the
   * gate refuses without a confirmation, and a deployment that composed the gate but not the
   * challenge route refuses everything critical rather than performing it unconfirmed.
   */
  readonly confirmations?: ConfirmationService;
  /**
   * The confirmation GATE, which is a different thing from the service above and both are needed.
   *
   *   `confirmations` ISSUES a challenge — the challenge route's dependency.
   *   `confirmationGate` SPENDS one and re-authenticates — the dispatcher's dependency, on every
   *   route whose permission is `critical`.
   *
   * A DEPLOYMENT COMPOSING ONE AND NOT THE OTHER IS COHERENT IN BOTH DIRECTIONS, and both
   * directions fail closed: with the service and no gate, a critical route answers `unavailable`;
   * with the gate and no service, no challenge can be obtained so no critical route can be
   * satisfied. Neither produces an unconfirmed critical operation.
   *
   * THEY ARE NOT MERGED INTO ONE ARGUMENT even though production passes a gate built over that
   * service, because merging them would let the dispatcher reach `issueChallenge` — and a
   * component able to issue the token it also verifies is one refactor from issuing its own.
   */
  readonly confirmationGate?: ConfirmationGate;
};

export async function createPlatformComposition(
  input: PlatformCompositionInput,
): Promise<PlatformRouteDependencies> {
  const cursors = await createPlatformCursorCodec(input.cursorSigningKey);

  return {
    handlers: createPlatformRouteHandlers({
      store: input.store,
      templates: input.templates,
      onboarding: input.onboarding,
      members: input.members,
      reset: input.reset,
      admission: input.admission,
      ids: input.ids,
      cursors,
      clock: input.clock,
      confirmations: input.confirmations,
    }),
    readSessionId: input.readSessionId,
    authenticatePrincipal: input.authenticatePrincipal,
    // THE MUTUAL EXCLUSION LIVES INSIDE THIS. `createPlatformAuthorityResolver` reads
    // `platform_operator` AND probes `organization_membership` on every call, and refuses a
    // principal present in both with the same argument-free `forbidden()` an unknown principal
    // receives. There is no way to compose the class without it, because there is no other
    // producer of the `PlatformAuthority` value the dispatcher requires.
    authority: createPlatformAuthorityResolver(input.store),
    authorizer: input.authorizer,
    // THE GATE IS PASSED THROUGH RATHER THAN BUILT HERE. Building it would need a
    // `CredentialVerifier`, and this class would then hold the ability to verify a password —
    // which is reach it has no other use for. The Action pipeline receives the same instance.
    confirmations: input.confirmationGate,
    audit: createPlatformAuditRecorder({
      store: input.store,
      admission: input.admission,
      ids: input.ids,
      clock: input.clock,
    }),
    adminHosts: Object.freeze([...input.adminHosts]),
  };
}
