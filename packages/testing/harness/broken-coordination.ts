/**
 * DELIBERATELY BROKEN COORDINATION, for the negative controls `docs/decisions/0013` needs.
 *
 * The sibling of `broken-controls.ts`, and built on the same principle: a control's degraded
 * behaviour is a CLAIM until something exercises it, and the way to exercise it is to break
 * the collaborator rather than to add a switch to the collaborator. Nothing in this file edits
 * `platform/core/**`, and production has no flag that turns any of it on.
 *
 * Each wrapper delegates to the REAL `createInProcessRequestCoordinator` over the REAL
 * `coordination-engine.ts`, so what is under test stays the shipped algorithm; only the one
 * property being broken is different.
 *
 * ===========================================================================================
 * `withIdentifierInGroupKey` IS THE IMPORTANT ONE, AND IT IS THE ONE FORBIDDEN CHANGE
 * ===========================================================================================
 *
 * 0013 control 5 says the requested customer identifier must NOT be part of the denial group
 * key, because an attacker controls that value and would mint unlimited groups — restoring
 * per-attempt writes under another name while appearing implemented. `coordination.ts` argues
 * a second property follows from the same exclusion: because both probe kinds share one group,
 * the emission ladder fires at the same attempt ordinals for both, so the per-request work
 * carries no signal about WHICH identifier was typed.
 *
 * That second property is an assertion in the suite, and an assertion is only evidence if it
 * can fail. This wrapper is what makes it fail: it re-keys every denial by the identifier the
 * caller supplied, which is exactly the "improvement" the comment warns a future author will
 * reach for. If the suite's timing-oracle case stays green against this wrapper, the case is
 * not testing what it says it tests.
 *
 * HOW IT GETS THE IDENTIFIER, and why that is not cheating. The pipeline has no channel for it
 * — `denialGroupKey` has no parameter it could arrive through and `targetResourceId` is not in
 * scope in `fail` — which is precisely the structural defence being verified. So the harness
 * cannot obtain it from the pipeline and must be TOLD it, out of band, by the test before each
 * invocation. That models "someone changed the key", which is the change under test; it does
 * not model "the pipeline leaks the identifier", which would be a different and much worse
 * defect and is not what is being simulated. The distinction is stated because a reader could
 * otherwise mistake this file for evidence of a leak.
 *
 * `rehydratePersistedDenialGroupKey` is used to brand the re-keyed value. That function's own
 * documentation says in capitals that calling it from a request path defeats control 5. This
 * file calls it from a request path ON PURPOSE, to show what that costs.
 */

import type {
  CoordinatedRequest,
  DenialContext,
  DenialGroupKey,
  DenialRecordOutcome,
  RequestCoordination,
  RequestCoordinator,
} from '../../../platform/core/protection/coordination.ts';
import { rehydratePersistedDenialGroupKey } from '../../../platform/core/protection/coordination.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err } from '../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../platform/core/kernel/errors.ts';

/**
 * Admission SUCCEEDS; counting the denial FAILS.
 *
 * This is the only mode that reaches D2 requirement 6's path. `begin` failing is control 8
 * territory — the request has not been shown to be within its limits, so nothing may write.
 * `recordDenial` failing is the opposite side of the decision: the request was ALREADY
 * refused, access is not reconsidered, and the only thing at stake is whether the evidence
 * survives and whether the caller can tell. Both must hold at once, which is why they need
 * separate controls.
 */
export function withBrokenDenialRecording(
  inner: RequestCoordinator,
  failure: 'reject' | 'throw',
): RequestCoordinator {
  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      const begun = await inner.begin(request);
      if (!begun.ok) {
        return begun;
      }
      const coordination = begun.value;
      return {
        ok: true,
        value: {
          outcome: coordination.outcome,
          retryAfterSeconds: coordination.retryAfterSeconds,
          async recordDenial(): Promise<Result<DenialRecordOutcome>> {
            if (failure === 'throw') {
              throw new Error('synthetic denial-recording failure');
            }
            return err(unavailable());
          },
          dispose(): void {
            coordination.dispose();
          },
        },
      };
    },
  };
}

/** A coordinator whose `begin` refuses, without throwing. */
export function createRejectingCoordinator(): RequestCoordinator {
  return {
    async begin(): Promise<Result<RequestCoordination>> {
      return err(unavailable());
    },
  };
}

/** A coordinator whose `begin` throws. */
export function createThrowingCoordinator(): RequestCoordinator {
  return {
    async begin(): Promise<Result<RequestCoordination>> {
      throw new Error('synthetic coordinator failure');
    },
  };
}

/**
 * A handle the test writes the caller-supplied identifier into before each invocation. See the
 * file header for why the identifier has to arrive this way and what that does and does not
 * model.
 */
export type IdentifierChannel = { current: string | null };

/**
 * THE FORBIDDEN KEY. Every denial is re-keyed by the requested identifier, so one group per
 * distinct string the caller typed.
 *
 * The identifier is folded into `actionId` rather than added as a sixth field, because
 * `DenialGroupKey` has exactly five members and `denialGroupKeyText` names them explicitly.
 * Folding produces the same OBSERVABLE consequence — one group per identifier, one summary row
 * identity per identifier — through the shipped engine, unmodified, which is what the negative
 * control needs. It is not a claim about how such a change would be written.
 */
export function withIdentifierInGroupKey(
  inner: RequestCoordinator,
  channel: IdentifierChannel,
): RequestCoordinator {
  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      const begun = await inner.begin(request);
      if (!begun.ok) {
        return begun;
      }
      const coordination = begun.value;
      return {
        ok: true,
        value: {
          outcome: coordination.outcome,
          retryAfterSeconds: coordination.retryAfterSeconds,
          async recordDenial(
            key: DenialGroupKey,
            context: DenialContext,
          ): Promise<Result<DenialRecordOutcome>> {
            const supplied = channel.current;
            if (supplied === null) {
              return coordination.recordDenial(key, context);
            }
            // The laundering `rehydratePersistedDenialGroupKey` warns about, performed on a
            // request path so that its cost can be measured.
            const rekeyed = rehydratePersistedDenialGroupKey({
              organizationId: key.organizationId,
              principalId: key.principalId,
              appId: key.appId,
              actionId: `${key.actionId}~${supplied}`,
              category: key.category,
            });
            return coordination.recordDenial(rekeyed, context);
          },
          dispose(): void {
            coordination.dispose();
          },
        },
      };
    },
  };
}

/**
 * A coordinator that records every key it was asked to count, for the provenance assertions.
 *
 * It changes nothing. Control 5 is a claim about what CAN reach the key, and the cheapest way
 * to test a claim about reachability is to write down everything that actually reached it and
 * assert the caller-supplied string is not among it.
 */
export function withKeyRecorder(
  inner: RequestCoordinator,
  seen: DenialGroupKey[],
  requests: CoordinatedRequest[] = [],
): RequestCoordinator {
  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      requests.push(request);
      const begun = await inner.begin(request);
      if (!begun.ok) {
        return begun;
      }
      const coordination = begun.value;
      return {
        ok: true,
        value: {
          outcome: coordination.outcome,
          retryAfterSeconds: coordination.retryAfterSeconds,
          async recordDenial(
            key: DenialGroupKey,
            context: DenialContext,
          ): Promise<Result<DenialRecordOutcome>> {
            seen.push(key);
            return coordination.recordDenial(key, context);
          },
          dispose(): void {
            coordination.dispose();
          },
        },
      };
    },
  };
}

/**
 * A coordinator that admits, but whose handle reports a foreign Organization's key.
 *
 * Used to prove the in-process coordinator's tenant guard is real: a key naming another
 * Organization is REFUSED rather than filed under the wrong tenant. The deployed coordinator
 * gets this property from being one Durable Object instance per Organization; the in-process
 * one has to reproduce it, so it has to be tested rather than inherited.
 */
export function withForeignOrganizationKey(
  inner: RequestCoordinator,
  organizationId: string,
): RequestCoordinator {
  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      const begun = await inner.begin(request);
      if (!begun.ok) {
        return begun;
      }
      const coordination = begun.value;
      return {
        ok: true,
        value: {
          outcome: coordination.outcome,
          retryAfterSeconds: coordination.retryAfterSeconds,
          async recordDenial(
            key: DenialGroupKey,
            context: DenialContext,
          ): Promise<Result<DenialRecordOutcome>> {
            const foreign = rehydratePersistedDenialGroupKey({
              organizationId,
              principalId: key.principalId,
              appId: key.appId,
              actionId: key.actionId,
              category: key.category,
            });
            return coordination.recordDenial(foreign, context);
          },
          dispose(): void {
            coordination.dispose();
          },
        },
      };
    },
  };
}

/** An unbranded value shaped like a `DenialGroupKey`. Nothing may accept it. */
export function forgeUnbrandedGroupKey(fields: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly appId: string;
  readonly actionId: string;
  readonly category: string;
}): DenialGroupKey {
  return { ...fields } as unknown as DenialGroupKey;
}
