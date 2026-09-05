/**
 * ===========================================================================================
 * CREDENTIAL RESET. `credential-reset-v1` · `docs/decisions/0026` · `0027` (it is gated).
 * ===========================================================================================
 *
 * **THE MOST DANGEROUS OPERATION IN THE PLATFORM.** It takes over an account somebody is using.
 * `0026` kept it `critical` while reclassifying onboarding to `sensitive`, and the split is the
 * point: onboarding ESTABLISHES a credential where there was none; this REPLACES one a principal
 * is already using, which is account takeover with a legitimate front door.
 *
 * ===========================================================================================
 * *** THIS IS THE THIRD COMPONENT THAT REACHES A TENANT STORE, AND THE COUNT IS WORTH STATING
 * RATHER THAN LETTING IT DRIFT. ***
 * ===========================================================================================
 *
 * `0025`'s amendment says the platform class holds no resolver and that **exactly one handler's
 * closure** may hold a service that can resolve one. That was true when written. It is now three:
 *
 *   `onboarding/`  — writes a Workspace into a tenant it is creating.
 *   `directory/`   — appends one audit row to a tenant it is being asked about.
 *   `credential/`  — this: appends one audit row to **every** tenant the target belongs to.
 *
 * **EACH IS ONE OPERATION WITH A BOUNDED PURPOSE AND NONE READS BUSINESS DATA**, so P1's substance
 * holds — no platform route can read a customer's records. **But "exactly one" is no longer the
 * true sentence**, and a reader who checks the amendment against the code should find that said
 * here rather than discover it. **A fourth is the point to ask whether P1 still means anything.**
 *
 * ===========================================================================================
 * THE TENANT-SIDE RECORD IS PER MEMBERSHIP, AND THAT IS THE CUSTOMER'S ENTITLEMENT
 * ===========================================================================================
 *
 * A principal in three Organizations produces **three** records, one in each. *"Every one of those
 * Organizations just had one of its members' accounts taken over, and each is entitled to see it
 * in its own log."* Writing to one — or to none — would mean a customer could not discover that an
 * operator had accessed an account inside their tenant.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import { forbidden, internal, notFound, quotaExceeded, unavailable } from '../kernel/errors.ts';
import type { IdentityControlPlaneStore } from '../identity/control-plane-store.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import {
  PRINCIPAL_CREDENTIAL_ROW_WRITES,
  SESSION_ROW_WRITES,
} from '../identity/control-plane-admission.ts';
import type {
  CheckedIdentifier,
  CredentialStore,
  IdentifierHasher,
} from '../identity/credential-store.ts';
import { fromBase64Url, normalizeIdentifier, toBase64Url } from '../identity/credential-store.ts';
import {
  deriveVerifier,
  SALT_BYTES,
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  VERIFIER_BYTES,
} from '../identity/credential-verifier.ts';
import type { PlatformOperatorStore } from '../platform/platform-operator-store.ts';
import type { OperatorWriteCharged } from '../platform/platform-audit.ts';
import { consumeOperatorCharge } from '../platform/platform-audit.ts';
import type { TenantStoreResolver } from '../tenancy/tenant-store-resolver.ts';
import type { TenantScopedStore, WriteOperation } from '../storage/store.ts';
import type { RequestCoordinator } from '../protection/coordination.ts';
import type { AuditSink } from '../audit/audit.ts';
import { derivePlatformOperatorActorContext } from '../audit/audit.ts';

/**
 * `CR-2`. **A target with more live sessions than this keeps some of them after a reset.**
 *
 * A REAL HOLE IN A SECURITY OPERATION, BOUNDED AND REPORTED RATHER THAN SILENT. The right fix is a
 * per-principal session cap, which does not exist and is a decision of its own. Raising this number
 * raises the worst-case row-write cost linearly and does not close the hole.
 */
export const MAX_REVOKED_SESSIONS = 50;

/** A tenant `audit_event`: 1 row + primary key + 3 explicit indexes. */
export const RESET_TENANT_ROW_WRITES = 5;

export type CredentialResetResult = {
  readonly principalId: string;
  readonly revokedSessionCount: number;
  /** How many Organizations received a tenant-side record. */
  readonly notifiedOrganizationCount: number;
};

export type CredentialResetService = {
  reset(input: {
    readonly principalId: string;
    /** The TARGET's login identifier. Branded, so it cannot arrive unchecked. */
    readonly targetIdentifier: CheckedIdentifier;
    /** 32 bytes base64url, salted with the TARGET's identifier by the console. */
    readonly derivedValue: string;
    readonly actorPrincipalId: string;
    readonly charge: OperatorWriteCharged;
    readonly requestId: string;
    readonly correlationId: string;
  }): Promise<Result<CredentialResetResult>>;
};

export type CredentialResetDependencies = {
  readonly controlPlane: IdentityControlPlaneStore;
  readonly credentials: CredentialStore;
  readonly identifiers: IdentifierHasher;
  /** For the platform-operator exclusion. See `reset`. */
  readonly operators: PlatformOperatorStore;
  readonly admission: ControlPlaneWriteAdmission;
  readonly resolver: TenantStoreResolver;
  readonly coordinator: RequestCoordinator;
  readonly auditSinkFor: (store: TenantScopedStore) => AuditSink;
  readonly ids: IdGenerator;
  readonly clock: Clock;
};

export function createCredentialResetService(
  dependencies: CredentialResetDependencies,
): CredentialResetService {
  return {
    async reset(input): Promise<Result<CredentialResetResult>> {
      consumeOperatorCharge(input.charge, input.actorPrincipalId);
      const nowMs = dependencies.clock.nowMs();
      const nowIso = toRfc3339Utc(nowMs);

      // =====================================================================================
      // ---- 1. VALIDATE, INCLUDING THE PLATFORM-OPERATOR EXCLUSION. BEFORE ANY RESERVATION.
      // =====================================================================================
      //
      // *** THE EXCLUSION IS THE REASON PLATFORM AUTHORITY IS NOT SELF-AMPLIFYING. ***
      //
      // *"An operator holding `core.credential.reset` could reset a colleague holding
      // `core.principal.grant-platform-scope` and inherit the broadest grant in the system."* That
      // is the classic escalation `0007` D11 exists to prevent, **arriving through a credential
      // rather than through a grant — and D11's conditions do not catch it, because a reset is not
      // a grant.**
      //
      // IT IS CHECKED FIRST, BEFORE THE IDENTIFIER IS EVEN HASHED, so an operator cannot use this
      // route to probe anything about a colleague. And it is `forbidden` rather than the collapsed
      // 404 **by the contract's ruling**: the caller is authorized and the TARGET's class is what
      // refuses, which is a fact about platform operators as a group rather than about this one.
      const operator = await dependencies.operators.findOperator(input.principalId);
      if (!operator.ok) {
        return err(operator.error);
      }
      if (operator.value !== null) {
        return err(forbidden());
      }

      // ---- THE IDENTIFIER IS VERIFIED AGAINST THE NAMED PRINCIPAL AND IS NEVER A LOOKUP KEY.
      //
      // `principal_id` FINDS THE TARGET; this only confirms it. `CredentialStore` has one method,
      // keyed by the hash, so a lookup BY identifier is impossible and `0001_principal.sql`'s
      // keyed-hash purchase is intact.
      //
      // *** A MISMATCH RETURNS THE SAME ARGUMENT-FREE 404 AS AN UNKNOWN PRINCIPAL. *** Three cases
      // collapse: no such principal, no credential under that identifier, and a credential
      // belonging to somebody else. **A distinguishable refusal would be an oracle for which
      // identifiers belong to which principals** — the disclosure `0006` refused a whole column to
      // prevent.
      const identifierHash = await dependencies.identifiers.hash(
        normalizeIdentifier(input.targetIdentifier),
      );
      const existing = await dependencies.credentials.findByIdentifierHash(identifierHash);
      if (!existing.ok) {
        return err(existing.error);
      }
      if (existing.value === null || existing.value.principalId !== input.principalId) {
        return err(notFound());
      }

      // ---- THE DERIVED VALUE. Width-checked; a short value stored as a verifier weakens the
      // account permanently and silently.
      const submitted = fromBase64Url(input.derivedValue, VERIFIER_BYTES);
      if (submitted === null) {
        return err(internal());
      }

      // =====================================================================================
      // ---- 2. COUNT THE TARGET'S LIVE SESSIONS. ---- 3. RESERVE FROM THE MEASURED COUNT.
      // =====================================================================================
      //
      // **NOT FROM THE 154 CEILING.** `0014` §A.12 makes over-reserving the safe direction *only
      // where the over-charge is stated* — charging 154 for a typical reset with one live session
      // would spend a quarter of an operator's daily budget on a 7-row operation.
      const sessionIds = await dependencies.controlPlane.listLiveSessionIds(
        input.principalId,
        nowIso,
        MAX_REVOKED_SESSIONS,
      );
      if (!sessionIds.ok) {
        return err(sessionIds.error);
      }

      const admitted = await dependencies.admission.reserve({
        principalId: input.actorPrincipalId,
        estimatedRowWrites:
          PRINCIPAL_CREDENTIAL_ROW_WRITES + sessionIds.value.length * SESSION_ROW_WRITES,
        nowMs,
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        return err(quotaExceeded());
      }

      // =====================================================================================
      // ---- 4 AND 5. REPLACE THE CREDENTIAL, THEN REVOKE — IN ONE TRANSACTION.
      // =====================================================================================
      //
      // THE SALT IS NEW. A reset that reused the stored salt would let anyone holding the old
      // verifier confirm whether the new password matched a guess without touching the platform.
      const salt = randomBytes(SALT_BYTES);
      const verifier = await deriveVerifier(submitted, salt, SERVER_KDF_ITERATIONS);

      const written = await dependencies.controlPlane.resetCredential(
        identifierHash,
        {
          algorithm: SUPPORTED_ALGORITHM,
          iterations: SERVER_KDF_ITERATIONS,
          salt: toBase64Url(salt),
          verifier: toBase64Url(verifier),
        },
        sessionIds.value,
        admitted.value.reservation,
      );
      if (!written.ok) {
        return err(written.error);
      }

      // =====================================================================================
      // ---- 7. ONE TENANT-SIDE RECORD PER ORGANIZATION THE TARGET BELONGS TO.
      // =====================================================================================
      //
      // STEP 6 — THE PLATFORM AUDIT RECORD — IS THE DISPATCHER'S, at `recordThen`, and the
      // operation is not reported successful until it lands.
      //
      // *** FROM HERE ON NOTHING FAILS THE OPERATION. *** The credential is already replaced and
      // the sessions are already gone; the account has been taken over whatever happens next.
      // **Reporting a failure now would tell an operator the reset did not happen when it did**,
      // and the target cannot log in either way. The count of notified Organizations is returned
      // so the caller can see when it is short.
      // CAPPED AT THE SAME NUMBER AS SESSIONS, AND FOR A DIFFERENT REASON WORTH STATING. Sessions
      // are capped because revoking them costs writes the operator reserved for; memberships are
      // capped because **each record is 5 row-writes against a DIFFERENT customer's allocation**,
      // and an unbounded loop here would let one reset spend from arbitrarily many tenants'
      // budgets. A principal in more than 50 Organizations is not a case anyone has designed for.
      const memberships = await dependencies.controlPlane.listMembershipsForPrincipal(
        input.principalId,
        MAX_REVOKED_SESSIONS,
      );
      let notified = 0;
      if (memberships.ok) {
        for (const membership of memberships.value) {
          const recorded = await recordInOrganization(dependencies, {
            organizationId: membership.organizationId,
            targetPrincipalId: input.principalId,
            actorPrincipalId: input.actorPrincipalId,
            requestId: input.requestId,
            correlationId: input.correlationId,
            occurredAt: nowIso,
            nowMs,
          });
          if (recorded.ok) {
            notified += 1;
          }
        }
      }

      return ok({
        principalId: input.principalId,
        revokedSessionCount: sessionIds.value.length,
        notifiedOrganizationCount: notified,
      });
    },
  };
}

/**
 * One `audit_event` row in one Organization.
 *
 * *** IT NAMES THE TARGET PRINCIPAL, WHICH THE RESOLVE'S RECORD DELIBERATELY DOES NOT. ***
 * `directory/member-resolution.ts` records that a probe happened and not whom it was for, because a
 * miss has no principal to name and naming one on success would make the log a hit/miss oracle.
 * **Here there is no miss** — the operation only reaches this point having succeeded — and the
 * customer's entitlement is precisely to know **which of their members** was taken over. Recording
 * "an account here was reset" without saying which would be useless to the party it is for.
 *
 * `decision: 'allowed'` — the operator was permitted, and the record is of the act.
 */
async function recordInOrganization(
  dependencies: CredentialResetDependencies,
  context: {
    readonly organizationId: string;
    readonly targetPrincipalId: string;
    readonly actorPrincipalId: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly occurredAt: string;
    readonly nowMs: number;
  },
): Promise<Result<void>> {
  const store = await dependencies.resolver.resolve(context.organizationId);
  if (!store.ok) {
    return err(store.error);
  }
  let coordination;
  try {
    coordination = await dependencies.coordinator.begin({
      organizationId: context.organizationId,
      principalId: context.actorPrincipalId,
      sourceAddressHash: null,
      nowMs: context.nowMs,
    });
  } catch {
    return err(unavailable());
  }
  if (!coordination.ok) {
    return err(unavailable());
  }
  let admitted;
  try {
    // `'platform'` — AN OPERATOR SPENDING A CUSTOMER'S ALLOCATION, bounded by the per-Organization
    // platform sub-ceiling exactly as the resolve and the scoped feed are.
    admitted = await coordination.value.reserveWrites(RESET_TENANT_ROW_WRITES, 'platform');
  } catch {
    return err(unavailable());
  }
  if (!admitted.ok || admitted.value.kind === 'deferred') {
    return err(unavailable());
  }

  const audit = dependencies.auditSinkFor(store.value);
  const operations: readonly WriteOperation[] = [
    audit.operation({
      appId: 'core',
      actionId: 'platform.credentials.reset',
      principalId: context.actorPrincipalId,
      principalType: 'user',
      onBehalfOfPrincipalId: null,
      permissionId: 'core.credential.reset',
      scope: 'platform',
      decision: 'allowed',
      denialReason: null,
      // THE TARGET. See the header for why this differs from the resolve's record.
      targetResourceId: context.targetPrincipalId,
      targetUnresolved: false,
      relatedBusinessIds: [],
      actorBusinessIds: derivePlatformOperatorActorContext(),
      changedFieldNames: [],
      requestId: context.requestId,
      correlationId: context.correlationId,
      occurredAt: context.occurredAt,
    }),
  ];

  let committed;
  try {
    committed = await store.value.write(operations, admitted.value.reservation);
  } catch {
    return err(unavailable());
  }
  if (!committed.ok) {
    return err(committed.error);
  }
  return ok(undefined);
}

function randomBytes(count: number): CryptoBytes {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}
