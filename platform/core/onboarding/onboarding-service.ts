/**
 * ===========================================================================================
 * THE ONBOARDING SERVICE. `organization-onboarding-v1` `theOrdering`, implemented.
 * ===========================================================================================
 *
 * SIX OBJECTS, TWO DATABASES, ONE OPERATION, AND ONE PLACE WHERE IT CANNOT BE ATOMIC.
 *
 * ===========================================================================================
 * THE ORDER, AND WHAT EACH POSITION BUYS
 * ===========================================================================================
 *
 *   1. VALIDATE EVERYTHING, INCLUDING THE TEMPLATE REFERENCE AND THE IDENTIFIER COLLISION,
 *      **BEFORE ANY CAPACITY IS RESERVED.** This is a tested property and not a preference: with
 *      the per-principal daily budget exhausted, a request naming an unknown `template_id` must
 *      answer `404` and not `429`. Reversed ordering is a defect even though both are refusals —
 *      it spends budget on a request that was never going to succeed, and it tells the operator
 *      the wrong thing about why.
 *
 *   2. RESERVE 10 control-plane row-writes. **NOT 12.** The other two are the platform audit
 *      record, which `dispatchPlatformRoute` reserves through its own recorder after this returns.
 *      Reserving 12 here would double-charge the operator for the same two rows.
 *
 *   3-4. THE FIVE CONTROL-PLANE ROWS, IN ONE BATCH. See `createOrganizationWithFirstAdmin`: they
 *      are one database and D1 executes a batch as one transaction, so **`ON-1`'s orphan
 *      `tenant_directory` row is not reachable**. The contract accepts that litter as the price of
 *      breaking a circularity; the price does not have to be paid.
 *
 *      THE ORDER INSIDE THE BATCH IS DEPENDENCY ORDER, NOT THE CONTRACT'S. `tenant_directory`
 *      REFERENCES `organization`, and **D1 enforces foreign keys — measured 2026-09-05 with a
 *      positive control.** The contract's "write `tenant_directory` FIRST" is unexecutable.
 *
 *   5. THE PLATFORM AUDIT RECORD IS **NOT WRITTEN HERE.** It is `dispatchPlatformRoute`'s, at its
 *      step 7, for every route in the class — which is binding property P4 and is why no handler
 *      is asked whether to audit. The contract's *"the operation is not successful until this
 *      lands"* holds: the dispatcher writes the record and replaces the answer with `unavailable`
 *      if it cannot.
 *
 *   6-7. RESOLVE THE TENANT STORE, THEN WRITE THE WORKSPACE AND THE TENANT-SIDE AUDIT ROW —
 *      as ONE `write`, so they commit together or not at all.
 *
 * ===========================================================================================
 * THE TWO-DATABASE PROBLEM, STATED RATHER THAN SOLVED
 * ===========================================================================================
 *
 * Control-plane writes and tenant writes are two databases and there is no batch that commits
 * both. **STEPS 1-4 ARE THE OPERATION.** Once they land the Organization exists, and a failure at
 * step 7 returns `201` with a populated `warnings` array rather than an error.
 *
 * `ON-2`, NAMED BECAUSE IT IS THE WEAKEST POINT IN THE AUDIT MODEL: a step-7 failure loses **the
 * customer's copy** of the record of who created their Organization, while the platform keeps its
 * own. That is the copy they most need. It is not engineered away because the alternative —
 * failing the operation — leaves a tenant that exists and cannot be entered, and between two bad
 * outcomes the recoverable one is right.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import { conflict, internal, notFound, quotaExceeded } from '../kernel/errors.ts';
import type { IdentityControlPlaneStore } from '../identity/control-plane-store.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import {
  ORGANIZATION_ROW_WRITES,
  ORGANIZATION_MEMBERSHIP_ROW_WRITES,
  PRINCIPAL_ROW_WRITES,
  PRINCIPAL_CREDENTIAL_ROW_WRITES,
  TENANT_DIRECTORY_ROW_WRITES,
} from '../identity/control-plane-admission.ts';
import type { CredentialStore, IdentifierHasher } from '../identity/credential-store.ts';
import { fromBase64Url, normalizeIdentifier, toBase64Url } from '../identity/credential-store.ts';
import {
  deriveVerifier,
  SALT_BYTES,
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  VERIFIER_BYTES,
} from '../identity/credential-verifier.ts';
import { admitMembershipWrite } from '../platform/platform-authority.ts';
import type { PlatformOperatorStore } from '../platform/platform-operator-store.ts';
import type { TemplateStore } from '../platform/template-store.ts';
import type { TenantStoreResolver } from '../tenancy/tenant-store-resolver.ts';
import type { RequestCoordinator } from '../protection/coordination.ts';
import type { AuditSink } from '../audit/audit.ts';
import { derivePlatformOperatorActorContext } from '../audit/audit.ts';
import type { WriteOperation } from '../storage/store.ts';
import type {
  OnboardingResult,
  OnboardingService,
  OnboardingWarning,
} from './onboarding.ts';

/**
 * TEN, COMPOSED FROM THE FIVE CONSTANTS AND NEVER WRITTEN AS A LITERAL.
 *
 * `organization-onboarding-v1` requires the cost to be correct in code, and records why the
 * original `6` was wrong: it counted `organization` + `tenant_directory` + `organization_membership`
 * and **assumed the admin principal and their credential already existed**, which is exactly what
 * is false when a new customer arrives.
 *
 * A LITERAL `10` HERE WOULD BE THE SAME MISCOUNT WAITING TO HAPPEN AGAIN. Summing the constants
 * means a schema change that alters any one row's cost changes this number without anyone
 * remembering to. `0014` §A.12: under-reserving is the dangerous direction — *"the failure mode of
 * over-reserving is a delayed write, and of under-reserving is a platform outage."*
 */
export const ONBOARDING_CONTROL_PLANE_ROW_WRITES =
  ORGANIZATION_ROW_WRITES +
  TENANT_DIRECTORY_ROW_WRITES +
  PRINCIPAL_ROW_WRITES +
  PRINCIPAL_CREDENTIAL_ROW_WRITES +
  ORGANIZATION_MEMBERSHIP_ROW_WRITES;

/**
 * The tenant side: the Workspace row plus its audit record.
 *
 * 2 for `business` (1 row + 1 primary key) and 5 for `audit_event` (1 row + 1 primary key +
 * 3 explicit indexes), which is the figure `control-plane-admission.ts` already uses for a
 * tenant-side audit row.
 */
export const ONBOARDING_TENANT_ROW_WRITES = 7;

/** The first admin is a person. Not a service account, not an agent. */
const ADMIN_PRINCIPAL_TYPE = 'user' as const;

export type OnboardingDependencies = {
  readonly controlPlane: IdentityControlPlaneStore;
  /**
   * READ-ONLY, AND IT IS THE COLLISION CHECK. `CredentialStore` has exactly one method,
   * `findByIdentifierHash`, so this dependency cannot write a credential — the write goes through
   * `ControlPlaneStore` above, which cannot write one without also creating an Organization.
   */
  readonly credentials: CredentialStore;
  readonly identifiers: IdentifierHasher;
  /** For validating `template_id` BEFORE any capacity is reserved. */
  readonly templates: TemplateStore;
  /**
   * FOR THE MEMBERSHIP RECEIPT ONLY. `admitMembershipWrite` reads it, and `createMembership`'s
   * successor cannot be called without the receipt it mints.
   */
  readonly operators: PlatformOperatorStore;
  readonly admission: ControlPlaneWriteAdmission;
  /**
   * *** THE ONE TENANT-STORE RESOLVER IN REACH OF THE PLATFORM SURFACE, AND IT LIVES HERE. ***
   *
   * It is a dependency of THIS service and of nothing that the platform route class holds. See
   * `onboarding.ts`'s header for P1 as amended, and for why this directory is not
   * `platform/core/platform/`.
   */
  readonly resolver: TenantStoreResolver;
  readonly coordinator: RequestCoordinator;
  /**
   * Builds the tenant-side audit WRITE rather than performing one, so the Workspace insert and its
   * audit record are a single `write` call and therefore a single transaction.
   *
   * IT IS A FACTORY BECAUSE THE SINK IS BOUND TO A STORE, and the store for this Organization does
   * not exist until step 6 resolves it.
   */
  readonly auditSinkFor: (store: import('../storage/store.ts').TenantScopedStore) => AuditSink;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /**
   * The logical binding name written into `tenant_directory`. **REQUIRED, NO DEFAULT.**
   *
   * A default here would be this file choosing which physical database a new customer's data lands
   * in, which is a deployment decision and `0006` §0.2 forbids the shape by name: *"no fallback
   * binding, no default database, no 'probably the shared one'."*
   */
  readonly tenantBindingName: string;
};

export function createOnboardingService(
  dependencies: OnboardingDependencies,
): OnboardingService {
  return {
    async onboard(call): Promise<Result<OnboardingResult>> {
      const { request, actorPrincipalId } = call;
      const nowMs = dependencies.clock.nowMs();
      const createdAt = toRfc3339Utc(nowMs);

      // =====================================================================================
      // ---- 1. VALIDATE. EVERY READ HERE HAPPENS BEFORE ANY CAPACITY IS RESERVED.
      // =====================================================================================
      //
      // THE TEMPLATE FIRST. `not_found` is honest rather than an oracle for the reason
      // `template-v1` gives: Templates are platform configuration every operator may already
      // enumerate, so telling one that an identifier names no Template discloses nothing it could
      // not obtain from `platform.templates.list`.
      const template = await dependencies.templates.findById(request.templateId);
      if (!template.ok) {
        return err(template.error);
      }
      if (template.value === null) {
        return err(notFound());
      }

      // ---- THE IDENTIFIER COLLISION. One identifier, one principal, PLATFORM-WIDE.
      //
      // CHECKED WITH A READ RATHER THAN INFERRED FROM A FAILED INSERT, and the reason is that the
      // adapter cannot tell a constraint violation from an outage: `execute` catches every throw
      // and answers `unavailable`, deliberately, because reading a D1 error message would put a
      // vendor-shaped string in a control flow. A read gives `conflict` its own honest answer.
      //
      // THE RACE IS REAL AND FAILS CLOSED. Two concurrent onboardings of the same identifier both
      // pass this check and the second insert violates the primary key — which aborts the whole
      // batch and answers `unavailable`, not `conflict`. **Nothing is overwritten**, because the
      // insert carries no `ON CONFLICT`: the second operator gets a worse error, not a stolen
      // account. That is the correct direction and it is stated rather than left to be discovered.
      //
      // *** WHY `conflict` IS NOT AN ORACLE HERE, CHECKED RATHER THAN ASSUMED, BECAUSE IT LOOKS
      // LIKE ONE. *** It tells the caller that some principal somewhere uses that identifier. The
      // caller is a platform operator holding `core.organization.create` — a permission whose
      // holder can already enumerate every Organization and reset any credential — so there is no
      // disclosure to a party that could not obtain it more directly. **THE SAME RESPONSE ON A
      // SELF-SERVICE SIGNUP ROUTE WOULD BE AN ACCOUNT-EXISTENCE ORACLE OPEN TO THE INTERNET**, and
      // `0025` records that no such route exists. If one is ever built it must not copy this.
      const normalized = normalizeIdentifier(request.adminIdentifier);
      const identifierHash = await dependencies.identifiers.hash(normalized);
      const existing = await dependencies.credentials.findByIdentifierHash(identifierHash);
      if (!existing.ok) {
        return err(existing.error);
      }
      if (existing.value !== null) {
        return err(conflict());
      }

      // ---- THE DERIVED VALUE. 32 bytes, base64url, and refused at any other width.
      //
      // `fromBase64Url` VALIDATES THE WIDTH, which `credential-verifier.ts` names as "the only
      // mitigation for a client that sends something other than a KDF output". A short value here
      // would be stored as a legitimate verifier and would weaken the account permanently.
      const submitted = fromBase64Url(request.derivedValue, VERIFIER_BYTES);
      if (submitted === null) {
        return err(internal());
      }

      // =====================================================================================
      // ---- 2. RESERVE. Ten row-writes, charged to the OPERATOR.
      // =====================================================================================
      //
      // CHARGED TO THE OPERATOR AND NOT TO THE CREATED PRINCIPAL, which has no history and no
      // budget and did not ask for anything. The operator is the party whose action this is.
      const admitted = await dependencies.admission.reserve({
        principalId: actorPrincipalId,
        estimatedRowWrites: ONBOARDING_CONTROL_PLANE_ROW_WRITES,
        nowMs,
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        // THE OPERATION IS REFUSED RATHER THAN PARTIALLY PERFORMED. `quota_exceeded` is declared
        // by this operation, so it is answerable — unlike the Customer Directory Actions that
        // must fall back to `unavailable`.
        return err(quotaExceeded());
      }

      // =====================================================================================
      // ---- 3-4. THE FIVE CONTROL-PLANE ROWS, ONE BATCH, ONE TRANSACTION.
      // =====================================================================================
      const organizationId = dependencies.ids.generate();
      const adminPrincipalId = dependencies.ids.generate();

      // THE RECEIPT. `createOrganizationWithFirstAdmin` cannot be called without it, and minting it
      // costs a real read of `platform_operator` for the new principal. **The answer is knowable in
      // advance** — the principal is created in the same batch, so it cannot be an operator — and
      // the check runs anyway, because the type is what makes "every membership write is preceded
      // by the mutual-exclusion check" a property of the PORT rather than of the callers that
      // happen to remember. `M-1`: a discipline converted into a type.
      const receipt = await admitMembershipWrite(dependencies.operators, adminPrincipalId);
      if (!receipt.ok) {
        return err(receipt.error);
      }

      const salt = randomBytes(SALT_BYTES);
      // THE SECOND DERIVATION, AND IT IS THE WHOLE POINT. `0015` §D, normative: the server stores a
      // hash of the client's output, NEVER the output itself. Storing `submitted` directly would
      // make this table usable as a login credential with no cracking at all.
      const verifier = await deriveVerifier(submitted, salt, SERVER_KDF_ITERATIONS);

      const written = await dependencies.controlPlane.createOrganizationWithFirstAdmin(
        {
          // THE TEMPLATE IS PERSISTED, AS OF `0013_organization_template.sql`. Until that migration
          // there was no column, so this value was read at step 1 to produce an honest `not_found`
          // and then discarded — which left `template-v1`'s `TM-4` unmet while `0012`'s comment
          // said this operation was what would meet it. **An operator picked a business type and
          // nothing anywhere recorded it.**
          //
          // IT IS `template.value.templateId` AND NOT `request.templateId`, deliberately: the value
          // written is the one the catalogue confirmed exists, not the one the caller sent. They
          // are equal today because `findById` is a point lookup on the primary key — and writing
          // the validated value is what keeps them equal if that ever stops being true.
          organization: {
            organizationId,
            status: 'active',
            templateId: template.value.templateId,
          },
          directory: {
            organizationId,
            bindingName: dependencies.tenantBindingName,
            state: 'active',
          },
          principal: {
            principalId: adminPrincipalId,
            principalType: ADMIN_PRINCIPAL_TYPE,
            status: 'active',
          },
          credential: {
            identifierHash,
            principalId: adminPrincipalId,
            algorithm: SUPPORTED_ALGORITHM,
            iterations: SERVER_KDF_ITERATIONS,
            salt: toBase64Url(salt),
            verifier: toBase64Url(verifier),
          },
          membership: {
            principalId: adminPrincipalId,
            organizationId,
            status: 'active',
            // EXACTLY `owner`, AS A LITERAL, WITH NO INPUT THAT COULD INFLUENCE IT. `0025`
            // decision 4 bound 2, and `0025` names it as the bound most likely to erode.
            role: 'owner',
            createdAt,
          },
        },
        admitted.value.reservation,
        receipt.value,
      );
      if (!written.ok) {
        return err(written.error);
      }

      // =====================================================================================
      // ---- 6-7. THE TENANT SIDE. FROM HERE ON, NOTHING FAILS THE OPERATION.
      // =====================================================================================
      //
      // THE ORGANIZATION NOW EXISTS AND CANNOT BE UNMADE. Every remaining failure becomes a
      // warning, because the alternative is telling an operator that an operation failed when its
      // irreversible half succeeded — and they cannot tell that from an operation that never
      // happened. **The ambiguity is the harm.**
      const warnings = await createFirstWorkspace(dependencies, {
        organizationId,
        actorPrincipalId,
        workspaceId: dependencies.ids.generate(),
        requestId: call.requestId,
        correlationId: call.correlationId,
        createdAt,
        nowMs,
      });

      return ok({
        organizationId,
        adminPrincipalId,
        workspaceId: warnings.workspaceId,
        warnings: Object.freeze(warnings.warnings),
      });
    },
  };
}

/**
 * Steps 6 and 7. **RETURNS WARNINGS AND NEVER AN ERROR**, which is the shape of the contract's
 * ruling rather than a swallowed failure: every path out of here has already been decided to be a
 * `201`.
 *
 * THE WORKSPACE ROW AND THE AUDIT ROW ARE ONE `write`, so `first_workspace_not_created` and
 * `tenant_audit_record_not_written` cannot both be false while one of the two rows exists. The two
 * warning tokens are therefore reported together for a write failure — the schema permits both,
 * `maxItems: 2` — and separately only where the two steps genuinely diverge, which is when the
 * store cannot be resolved at all.
 */
async function createFirstWorkspace(
  dependencies: OnboardingDependencies,
  context: {
    readonly organizationId: string;
    readonly actorPrincipalId: string;
    readonly workspaceId: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly createdAt: string;
    readonly nowMs: number;
  },
): Promise<{ readonly workspaceId: string | null; readonly warnings: OnboardingWarning[] }> {
  const bothFailed: OnboardingWarning[] = [
    'first_workspace_not_created',
    'tenant_audit_record_not_written',
  ];

  // ---- 6. RESOLVE. Possible only because the directory entry committed in step 3-4.
  const store = await dependencies.resolver.resolve(context.organizationId);
  if (!store.ok) {
    return { workspaceId: null, warnings: bothFailed };
  }

  // ---- THE TENANT WRITE BUDGET. A SEPARATE ALLOCATION FROM THE CONTROL PLANE'S.
  //
  // `0014` §A: 2 from `system` through `ControlPlaneWriteAdmission`, 7 from `business` through the
  // per-Organization coordinator. TWO ALLOCATIONS, ONE OPERATION — the same split a membership
  // change makes.
  //
  // THE COORDINATOR IS KEYED BY THE NEW ORGANIZATION, which is its first request ever. There is no
  // prior state to exhaust and no other tenant's budget in reach.
  let coordination;
  try {
    coordination = await dependencies.coordinator.begin({
      organizationId: context.organizationId,
      principalId: context.actorPrincipalId,
      sourceAddressHash: null,
      nowMs: context.nowMs,
    });
  } catch {
    return { workspaceId: null, warnings: bothFailed };
  }
  if (!coordination.ok) {
    return { workspaceId: null, warnings: bothFailed };
  }

  let admitted;
  try {
    admitted = await coordination.value.reserveWrites(ONBOARDING_TENANT_ROW_WRITES);
  } catch {
    return { workspaceId: null, warnings: bothFailed };
  }
  if (!admitted.ok || admitted.value.kind === 'deferred') {
    return { workspaceId: null, warnings: bothFailed };
  }

  // ---- 7. THE WORKSPACE AND ITS AUDIT ROW, AS ONE TRANSACTION.
  //
  // *** THE INSERT NAMES NO TENANT COLUMN. *** `tenant_id` is written and filtered exclusively by
  // the storage boundary from the handle, exactly as it is for a Customer. `tenancy.
  // theWORKSPACEWRITEISTENANTSCOPED` requires precisely this: the operation must not become the
  // one place `tenant_id` is written by hand, and `store.ts` throws on a spec that so much as
  // names the column.
  //
  // `business_id` IS THE COLUMN AND THERE IS NO TRANSLATION LAYER. `Workspace` is the word on the
  // platform wire; `business_id` is the word in the database and in `customer-directory-v1`, which
  // two clients have shipped against. `0025`'s amendment of 2026-09-05: the hole stops getting
  // deeper and is not filled in today.
  //
  // THE WORKSPACE NAME IS NOT STORED, AND THAT IS THE TABLE'S DOING RATHER THAN A CHOICE.
  // `0002_business.sql` has exactly two columns and says so in terms: *"there is deliberately NO
  // Business name, NO lifecycle or status, NO parent... They belong to the organization-structure
  // slice, with its own contract."* **SO `first_workspace_name` IS ACCEPTED, VALIDATED AND
  // DISCARDED**, and that is reported rather than hidden — adding a `name` column here would be
  // deciding Core's organization data model as a side effect of onboarding, which is the exact
  // thing that migration refuses.
  const audit = dependencies.auditSinkFor(store.value);
  const operations: readonly WriteOperation[] = [
    {
      kind: 'insert',
      spec: { table: 'business', values: { business_id: context.workspaceId } },
    },
    audit.operation({
      appId: 'core',
      actionId: 'platform.organizations.create',
      principalId: context.actorPrincipalId,
      principalType: ADMIN_PRINCIPAL_TYPE,
      onBehalfOfPrincipalId: null,
      permissionId: 'core.organization.create',
      scope: 'platform',
      decision: 'allowed',
      denialReason: null,
      targetResourceId: context.organizationId,
      targetUnresolved: false,
      relatedBusinessIds: [context.workspaceId],
      // THE OPERATOR HAS AUTHORITY OVER NO BUSINESS IN THIS ORGANIZATION, and the empty context is
      // the true statement rather than a placeholder. See `derivePlatformOperatorActorContext`.
      actorBusinessIds: derivePlatformOperatorActorContext(),
      changedFieldNames: [],
      requestId: context.requestId,
      correlationId: context.correlationId,
      occurredAt: context.createdAt,
    }),
  ];

  let committed;
  try {
    committed = await store.value.write(operations, admitted.value.reservation);
  } catch {
    return { workspaceId: null, warnings: bothFailed };
  }
  if (!committed.ok) {
    return { workspaceId: null, warnings: bothFailed };
  }
  return { workspaceId: context.workspaceId, warnings: [] };
}

function randomBytes(count: number): CryptoBytes {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}
