/**
 * ===========================================================================================
 * ONBOARDING — THE WIRE-FACING SHAPES AND THE PORT. `organization-onboarding-v1`,
 * `docs/decisions/0025` (the platform route class), `docs/decisions/0026` (ON-5, ON-6).
 * ===========================================================================================
 *
 * HOW DUDO ACQUIRES A CUSTOMER. Before this, the answer was that an operator ran SQL by hand.
 *
 * ===========================================================================================
 * *** WHY THIS DIRECTORY EXISTS, AND WHY IT IS NOT `platform/core/platform/`. ***
 * ===========================================================================================
 *
 * **THIS IS THE ONLY COMPONENT IN DUDO THAT RESOLVES A TENANT STORE FOR AN ORGANIZATION THE
 * CALLER IS NOT A MEMBER OF.** `platform-operator-v1` P1 says the platform route class can reach
 * no tenant store, and `organization-onboarding-v1` names the tension itself as
 * `theSHARPESTRISKINTHISCONTRACT`:
 *
 *   *"AN IMPLEMENTATION THAT PUT A RESOLVER ON THE PLATFORM CONTEXT TO SERVE THIS ONE OPERATION
 *   WOULD DEFEAT P1 FOR THE WHOLE CLASS."*
 *
 * So the resolver is held HERE, outside `platform/core/platform/**`, and the platform class
 * receives an `OnboardingService` — a port with one method returning identifiers. No
 * `TenantStoreResolver` appears on `PlatformRouteContext` or on `PlatformRouteDependencies`, and
 * `qa-agent`'s structural control — *"no module under `platform/core/platform/**` names a tenant
 * primitive"* — stays exact rather than gaining an exception. **A control with no exceptions is
 * worth more than one with a justified exception, because the next exception argues from the
 * first.**
 *
 * P1 AS AMENDED BY `0025` ON 2026-09-05, which is the true sentence and is weaker than the
 * original:
 *
 *   *No platform route handler's CONTEXT can reach a tenant store, and `PlatformRouteDependencies`
 *   carries no resolver. Exactly one handler's closure holds a service that can resolve exactly
 *   one store, for the lifetime of one operation, for an Organization that operation just created.*
 *
 * ===========================================================================================
 * THE HANDLE'S LIFETIME IS THE OPERATION
 * ===========================================================================================
 *
 * `tenancy.theOPERATORSTILLCANNOTENTER`: the handle is obtained after the directory entry exists,
 * used for one Workspace insert and one audit row, and dropped. **It is not stashed, not cached,
 * and nothing derived from it beyond the declared identifiers is returned.** The operator gains no
 * membership, its session's `active_organization_id` stays null, and it can never resolve that
 * handle again through any route.
 *
 * THE OPERATOR CREATES A TENANT IT CANNOT ENTER. That is the property that makes the bootstrap
 * exception safe rather than convenient.
 */

import type { Result } from '../kernel/result.ts';
import type { CheckedIdentifier } from '../identity/credential-store.ts';

/**
 * The two things that can fail AFTER the Organization irrevocably exists.
 *
 * A CLOSED SET OF STABLE TOKENS, NEVER FREE TEXT — the schema's ruling, and the reason is that a
 * console must be able to render each one specifically and `qa-agent` must be able to assert them.
 * Free text would be a message nobody could branch on and everybody would log.
 */
export type OnboardingWarning = 'first_workspace_not_created' | 'tenant_audit_record_not_written';

/**
 * The validated request. Every field is server-checked before this type exists.
 *
 * NOTE WHAT IS ABSENT, BECAUSE EACH ABSENCE IS A DECISION AND THE TYPE IS WHERE THEY BECOME
 * UNREPRESENTABLE:
 *
 *   NO `organizationId`, `principalId` OR `workspaceId` — all three are server-generated. A
 *   caller-chosen tenant identifier is the one input that could collide a new Organization with an
 *   existing one's identifier space, and it is also **`0025` decision 4's bound 3**: the bound
 *   *"unavailable once the Organization has any membership"* holds structurally because there is no
 *   field through which an existing Organization could be named.
 *
 *   NO `role`, NO `permissions`, NO `memberships`. The bootstrap exception creates exactly one
 *   membership at exactly `owner`; a role field would widen an exception to `0007` D11 into a
 *   general grant mechanism. `0025` names this as **the bound most likely to erode**, and a future
 *   `role` field on this request is a contract regression to fail rather than accommodate.
 *
 *   NO `password`. `0017`'s honest basis is that entropy protects these accounts, so an
 *   operator-chosen password expires that decision. The console generates one and the server
 *   never sees it.
 */
export type OnboardingInput = {
  /**
   * The first admin's login identifier.
   *
   * *** `CheckedIdentifier`, NOT `string`. THE TYPE IS THE ENFORCEMENT. ***
   *
   * This field said *"already `isSubmittableIdentifier`-checked"* and **nothing made that true** —
   * the handler happened to check, and a second caller of this service would have inherited
   * nothing. A comment asserting a precondition is the shape `architecture.md` §3c warns about;
   * a type that cannot be satisfied without the check is the shape §3a asks for.
   *
   * IT IS THE RAW IDENTIFIER. Normalisation happens inside the service, after the check, which is
   * the order `account-identifier-v1`'s case-folding argument requires.
   */
  readonly adminIdentifier: CheckedIdentifier;
  readonly templateId: string;
  /**
   * The first Workspace's name.
   *
   * `Workspace` ON THE WIRE, `business_id` IN THE COLUMN, AND NO TRANSLATION LAYER BETWEEN THEM.
   * `docs/decisions/0025`'s amendment of 2026-09-05: the rename is not being performed, because
   * `business_id` is a published wire field two clients have shipped against and a persisted audit
   * value. Do not "correct" either vocabulary toward the other.
   */
  readonly firstWorkspaceName: string;
  /**
   * 32 bytes, base64url, 43 characters. **THE CLIENT'S KDF OUTPUT, NOT A PASSWORD.**
   *
   * `docs/decisions/0026` closed `ON-5` as option B: the admin console generates a ~192-bit
   * password from a CSPRNG, computes `PBKDF2-SHA256(NFC(password), salt = normalize(identifier),
   * 600,000)` in the operator's browser, and sends only this. **The password never reaches the
   * server**, so `0015` §D's central property is preserved exactly — what changed is only WHICH
   * browser derives, and an operator's browser has no 10 ms CPU limit.
   *
   * IT WORKS HERE ONLY BECAUSE THE OPERATOR TYPED THE IDENTIFIER IN THIS SAME REQUEST, which is
   * the KDF salt. `credential-reset-v1` has no such luck and needed a different request shape for
   * the same decision — see its `CR-5`.
   */
  readonly derivedValue: string;
};

/**
 * What the operation returns. **THERE IS NO CREDENTIAL IN IT, AND THAT IS THE POINT.**
 *
 * The schema previously required an `initial_password` while the prose beside it said the server
 * never sees one. Under option B **the server has no way to produce that field** — an implementer
 * satisfying the old `required` list would have had to build option A, which is the exact design
 * `0015` §D and `0026` exist to prevent. The console already holds the only copy.
 *
 * NO TOMBSTONE FIELD FOR IT EITHER. A placeholder left in the shape would be a permitted optional
 * field, which is the same defect one size smaller.
 */
export type OnboardingResult = {
  readonly organizationId: string;
  readonly adminPrincipalId: string;
  /** NULL when `warnings` contains `first_workspace_not_created`. */
  readonly workspaceId: string | null;
  /**
   * EMPTY ON A COMPLETE SUCCESS.
   *
   * A 201 WITH WARNINGS IS NEITHER A FAILURE NOR A FULL SUCCESS: the Organization, the admin and
   * the credential exist, and something after them did not. It is still 201 because failing the
   * request would leave a customer that exists, cannot be entered, and needs a credential reset to
   * rescue — and because **the ambiguity is the harm**: after the credential row commits, an
   * operator who receives a failure cannot tell whether it was written, whether the Organization
   * exists, or whether retrying will collide.
   */
  readonly warnings: readonly OnboardingWarning[];
};

/**
 * The port the platform route class receives. ONE METHOD, RETURNING IDENTIFIERS.
 *
 * IT IS NOT A `TenantStoreResolver` AND CANNOT BE TURNED INTO ONE. The handler that holds it can
 * onboard an Organization and can do nothing else — it cannot select, cannot read, cannot resolve a
 * store for an Organization it names, and cannot reach the one this call creates.
 */
export type OnboardingService = {
  /**
   * `actorPrincipalId` IS THE OPERATOR'S, SERVER-DERIVED FROM A VERIFIED SESSION. It is used for
   * the write-budget reservation and for the tenant-side audit record's actor, and for nothing
   * else. It is never the created principal.
   */
  onboard(input: {
    readonly request: OnboardingInput;
    readonly actorPrincipalId: string;
    readonly requestId: string;
    readonly correlationId: string;
  }): Promise<Result<OnboardingResult>>;
};
