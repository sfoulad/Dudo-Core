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
import type { WriteAdmissionOutcome } from '../../../platform/core/protection/write-admission.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err } from '../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../platform/core/kernel/errors.ts';

/**
 * Wraps a coordinator, replacing named methods of its handle and FORWARDING EVERYTHING ELSE.
 *
 * SPREAD RATHER THAN RE-LISTED, DELIBERATELY. Every wrapper in this file used to rebuild the
 * handle field by field, and when `docs/decisions/0014` added `reserveWrites` to
 * `RequestCoordination`, all five of them silently dropped it — a wrapper that forgets a method
 * is a control that quietly stops testing what it claims to. Spreading means the next method
 * added to the port is forwarded by every control here without an edit, and a control that wants
 * to break it has to say so.
 */
function decorate(
  inner: RequestCoordinator,
  overrides: (
    coordination: RequestCoordination,
    request: CoordinatedRequest,
  ) => Partial<RequestCoordination>,
  onBegin?: (request: CoordinatedRequest) => void,
): RequestCoordinator {
  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      onBegin?.(request);
      const begun = await inner.begin(request);
      if (!begun.ok) {
        return begun;
      }
      const coordination = begun.value;
      return {
        ok: true,
        value: {
          ...coordination,
          // Bound explicitly: spreading an object literal copies the function values, but these
          // close over the inner handle rather than over `this`, so no binding is lost. Stated
          // because "spread an object with methods" is a place people expect a `this` bug.
          recordDenial: (key, context) => coordination.recordDenial(key, context),
          reserveWrites: (units) => coordination.reserveWrites(units),
          dispose: () => coordination.dispose(),
          ...overrides(coordination, request),
        },
      };
    },
  };
}

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
  return decorate(inner, () => ({
    async recordDenial(): Promise<Result<DenialRecordOutcome>> {
      if (failure === 'throw') {
        throw new Error('synthetic denial-recording failure');
      }
      return err(unavailable());
    },
  }));
}

/**
 * Admission and denial counting both SUCCEED; the daily WRITE reservation fails.
 *
 * `docs/decisions/0014` §A's own degraded path, and it is distinct from every 0013 control: the
 * request is authorized, valid, inside every rate limit, and has produced writes — and the
 * budget cannot be consulted. Nothing may commit, because a write that could not be reserved is
 * the unaccounted write §A.11 prohibits.
 */
export function withBrokenWriteAdmission(
  inner: RequestCoordinator,
  failure: 'reject' | 'throw',
): RequestCoordinator {
  return decorate(inner, () => ({
    async reserveWrites(): Promise<Result<WriteAdmissionOutcome>> {
      if (failure === 'throw') {
        throw new Error('synthetic write-admission failure');
      }
      return err(unavailable());
    },
  }));
}

/**
 * The daily budget answers `deferred` for every mutation, without any budget having to be spent.
 *
 * `0014` §A.10's exhaustion state, reached directly. Driving it through the real ledger is also
 * done (the ceiling suite lowers `dailyCeilings`), and both are worth having: this one isolates
 * what the PIPELINE does with a `deferred`, and that one proves the LEDGER produces one.
 */
export function withExhaustedWriteBudget(
  inner: RequestCoordinator,
  resumeAfterMs: number,
  retryAfterSeconds: number,
): RequestCoordinator {
  return decorate(inner, () => ({
    async reserveWrites(): Promise<Result<WriteAdmissionOutcome>> {
      return { ok: true, value: { kind: 'deferred', resumeAfterMs, retryAfterSeconds } };
    },
  }));
}

/**
 * Records every write reservation the pipeline asked for, and grants it through the real ledger.
 *
 * The cost an Action reserves is the thing `0014` §A.12 is about, and the only way to assert it
 * is to write down what was actually requested.
 */
export function withWriteRequestRecorder(
  inner: RequestCoordinator,
  requested: number[],
): RequestCoordinator {
  return decorate(inner, (coordination) => ({
    async reserveWrites(units: number): Promise<Result<WriteAdmissionOutcome>> {
      requested.push(units);
      return coordination.reserveWrites(units);
    },
  }));
}

/**
 * Grants a reservation for a DIFFERENT Organization than the handle serves.
 *
 * The tenant half of `consumeWriteReservation`'s four checks, reached the only way a real system
 * could reach it: a coordinator that hands back a receipt naming somebody else. The storage
 * boundary must refuse it rather than write one Organization's row against another's budget.
 */
export function withForeignOrganizationReservation(
  inner: RequestCoordinator,
  organizationId: string,
  mint: (organizationId: string, units: number) => unknown,
): RequestCoordinator {
  return decorate(inner, () => ({
    async reserveWrites(units: number): Promise<Result<WriteAdmissionOutcome>> {
      return {
        ok: true,
        value: {
          kind: 'granted',
          reservation: mint(organizationId, units) as never,
        },
      };
    },
  }));
}

/**
 * Grants a FORGED reservation — a plain object with the right fields and no brand.
 *
 * The provenance half. It is the same shape as the `actorBusinessIds` and `DenialGroupKey`
 * controls: a hand-built value must be refused, and a derived one must be accepted, or the
 * refusal is of the shape rather than of the provenance.
 */
export function withForgedWriteReservation(inner: RequestCoordinator): RequestCoordinator {
  // `_coordination` IS UNUSED ON PURPOSE AND THE NAME SAYS SO. The forgery is the whole point:
  // this control must build a reservation from NOTHING the real coordination produced, because a
  // value derived from it would carry the brand and would be accepted for the right reason.
  return decorate(inner, (_coordination, request) => ({
    async reserveWrites(units: number): Promise<Result<WriteAdmissionOutcome>> {
      return {
        ok: true,
        value: {
          kind: 'granted',
          reservation: {
            organizationId: request.organizationId,
            allocation: 'business',
            estimatedRowWrites: units,
            dayStartMs: 0,
          } as never,
        },
      };
    },
  }));
}

/**
 * Grants ONE reservation and hands the SAME object back on every later call.
 *
 * A reservation is per-batch. Without single-use enforcement one receipt for eight row-writes
 * could fund an unbounded loop of batches, and the budget would be a formality.
 */
export function withReusedWriteReservation(inner: RequestCoordinator): RequestCoordinator {
  // HELD OUTSIDE `decorate`, AND THE POSITION IS THE WHOLE CONTROL. `decorate` calls the
  // overrides factory once per `begin`, which is once per REQUEST — a variable declared inside
  // it is per-request and would hand each request its own fresh reservation, which is exactly
  // the correct behaviour this control is supposed to break. An earlier revision did that and
  // the case passed while testing nothing.
  let held: WriteAdmissionOutcome | null = null;
  return decorate(inner, (coordination) => ({
    async reserveWrites(units: number): Promise<Result<WriteAdmissionOutcome>> {
      if (held !== null) {
        return { ok: true, value: held };
      }
      const granted = await coordination.reserveWrites(units);
      if (granted.ok && granted.value.kind === 'granted') {
        held = granted.value;
      }
      return granted;
    },
  }));
}

/**
 * Grants a reservation SMALLER than the batch it will fund.
 *
 * The size half. Every statement writes at least one row, so a batch with more statements than
 * row-writes reserved is provably under-reserved, and under-reserving is the direction §A.12
 * calls a platform outage. Reserving one for a two-statement batch is the smallest case that
 * proves the backstop runs below every caller.
 */
export function withUndersizedWriteReservation(inner: RequestCoordinator): RequestCoordinator {
  return decorate(inner, (coordination) => ({
    async reserveWrites(): Promise<Result<WriteAdmissionOutcome>> {
      return coordination.reserveWrites(1);
    },
  }));
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
  return decorate(inner, (coordination) => ({
    async recordDenial(
      key: DenialGroupKey,
      context: DenialContext,
    ): Promise<Result<DenialRecordOutcome>> {
      const supplied = channel.current;
      if (supplied === null) {
        return coordination.recordDenial(key, context);
      }
      // The laundering `rehydratePersistedDenialGroupKey` warns about, performed on a request
      // path so that its cost can be measured.
      const rekeyed = rehydratePersistedDenialGroupKey({
        organizationId: key.organizationId,
        principalId: key.principalId,
        appId: key.appId,
        actionId: `${key.actionId}~${supplied}`,
        category: key.category,
      });
      return coordination.recordDenial(rekeyed, context);
    },
  }));
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
  return decorate(
    inner,
    (coordination) => ({
      async recordDenial(
        key: DenialGroupKey,
        context: DenialContext,
      ): Promise<Result<DenialRecordOutcome>> {
        seen.push(key);
        return coordination.recordDenial(key, context);
      },
    }),
    (request) => {
      requests.push(request);
    },
  );
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
  return decorate(inner, (coordination) => ({
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
  }));
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
