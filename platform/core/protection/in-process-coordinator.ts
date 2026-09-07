/**
 * A `RequestCoordinator` and `DayWriteBudget` that hold their state in this process.
 *
 * ===========================================================================================
 * THIS IS NOT A DEPLOYMENT IMPLEMENTATION AND MUST NEVER BE WIRED INTO A DEPLOYED WORKER.
 * ===========================================================================================
 *
 * Its state lives in one isolate's memory. A deployed Worker runs in many isolates, in many
 * locations, so a per-isolate counter is not a rate limit — it is a rate limit divided by a
 * number nobody controls. `docs/decisions/0013` requires a **SQLite-backed Durable Object**
 * precisely because coordination has to be a single point of truth across requests, and
 * `worker-entry.ts` therefore refuses to start without that binding rather than falling back
 * to this file. If a composition root ever reaches for this, the coordination guarantee is
 * silently gone and the D1 exposure 0013 closed is open again.
 *
 * WHAT IT IS FOR. Two things, both legitimate:
 *
 *   1. VERIFICATION. This repository cannot execute a Durable Object — there is no Worker
 *      configuration, no runtime and no approved test framework — so without this file the
 *      coordination algorithm would ship reviewed but never run. Here `qa-agent` can drive a
 *      whole probing campaign through the real pipeline against the real engine.
 *   2. REPLACEABILITY, demonstrated rather than asserted. `CLOUDFLARE_STANDARD.md` §2 says an
 *      abstraction that only makes sense because of how the vendor behaves has failed. A
 *      second, entirely non-Cloudflare implementation of the same port is the cheapest proof
 *      that this one has not.
 *
 * TENANT SCOPING. The deployed coordinator is one Durable Object instance per Organization, so
 * an instance physically cannot hold a second Organization's counters. This file has to
 * reproduce that property rather than inherit it, so it keeps one `CoordinationState` per
 * Organization and hands a handle access to exactly one of them. A handle additionally REFUSES
 * a denial key from any other Organization — see `recordDenial` below.
 *
 * REPRODUCING THAT PROPERTY IS ALSO WHAT MADE THE SOURCE-LEVEL DEFECT VISIBLE, and it is worth
 * saying why. Because this file mirrors the per-Organization partitioning rather than quietly
 * sharing one map, `qa-agent` could drive 602 admissions from one address across distinct
 * Organizations and watch every one of them be admitted — the third rate-limit level existing
 * in the algorithm and being unreachable in the shape. A convenience implementation that shared
 * everything would have passed and proved nothing about production. The fix is
 * `SourceCounterShard`: ONE counter for the source level, held here outside every
 * `CoordinationState`, exactly as the deployed shard sits outside every Organization's object.
 */

import type {
  AdmissionOutcome,
  CoordinatedRequest,
  DenialContext,
  DenialGroupKey,
  DenialRecordOutcome,
  RequestCoordination,
  RequestCoordinator,
  SourceCounterShard,
} from './coordination.ts';
import { DAY_MS, denialGroupKeyFromText, windowStart } from './coordination.ts';
import type {
  DayWriteBudget,
  WriteAdmissionOutcome,
  WriteAllocation,
} from './write-admission.ts';
import {
  DAILY_ALLOCATION,
  mintWriteReservation,
  nextUtcResetMs,
  retryAfterSecondsUntilReset,
} from './write-admission.ts';
import { DENIAL_SUMMARY_ROW_WRITES } from '../storage/write-cost.ts';
import type { CoordinationState, WriteOrigin } from './coordination-engine.ts';
import {
  admit,
  admitWrite,
  applySourceTotal,
  createCoordinationState,
  creditPermits,
  creditWritePermits,
  permitsToBuy,
  recordDenial,
  sourceBlocked,
  sourceRetryAfterSeconds,
  sweepClosedWindows,
  writePermitsToBuy,
} from './coordination-engine.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { internal, unavailable } from '../kernel/errors.ts';

/**
 * The platform-wide daily ledger, in memory. `docs/decisions/0014` §A.2 and §A.5.
 *
 * ONE LEDGER, THREE ALLOCATIONS — it replaces `0013`'s `createInProcessSummaryWriteBudget`, and
 * the replacement is the reconciliation rather than a rename. A separate summary budget beside a
 * separate mutation budget is two ceilings that each believe themselves safe while their sum
 * exceeds the platform ceiling; here `security` and `business` are counters in the same day.
 *
 * Deliberately NOT per-Organization: it holds a UTC day and three counts and no tenant identifier
 * of any kind, which is the same shape the deployed ledger has and the reason that one is the
 * single piece of coordination state that is not tenant-scoped.
 *
 * `ceilings` is overridable so a verification harness can drive exhaustion in a few requests
 * instead of ten thousand. The default is the decided allocation, and a harness lowering a
 * ceiling makes a test cheaper — it can never make production more permissive, because production
 * does not pass this argument.
 */
export function createInProcessDayWriteBudget(
  ceilings: Readonly<Record<WriteAllocation, number>> = DAILY_ALLOCATION,
): DayWriteBudget & { readonly usedToday: (allocation: WriteAllocation) => number } {
  let dayStartMs = -1;
  const used: Record<WriteAllocation, number> = { business: 0, security: 0, system: 0 };
  return {
    async take(
      day: number,
      allocation: WriteAllocation,
      wanted: number,
    ): Promise<Result<number>> {
      if (day !== dayStartMs) {
        dayStartMs = day;
        used.business = 0;
        used.security = 0;
        used.system = 0;
      }
      // ALLOCATIONS DO NOT BORROW FROM ONE ANOTHER. A spent `security` allocation cannot reach
      // into `business`, which is the whole reason for splitting them: a probing campaign must
      // not be able to spend the product's capacity through the evidence path.
      const granted = Math.max(0, Math.min(wanted, ceilings[allocation] - used[allocation]));
      used[allocation] += granted;
      return ok(granted);
    },
    usedToday(allocation: WriteAllocation): number {
      return used[allocation];
    },
  };
}

/**
 * The cross-Organization source counter, in memory.
 *
 * Like the platform ledger, it holds no tenant identifier: a hashed address, a window, and an
 * integer. It sits OUTSIDE every `CoordinationState` deliberately — that separation is the
 * whole of the fix for the unreachable source level, and putting it inside one would silently
 * restore the defect.
 */
export function createInProcessSourceCounterShard(): SourceCounterShard & {
  readonly totalFor: (sourceAddressHash: string, windowStartMs: number) => number;
} {
  const counts = new Map<string, number>();
  const bucket = (hash: string, windowStartMs: number): string => `${hash} ${String(windowStartMs)}`;
  return {
    async add(sourceAddressHash: string, windowStartMs: number, delta: number): Promise<Result<number>> {
      const key = bucket(sourceAddressHash, windowStartMs);
      const total = (counts.get(key) ?? 0) + delta;
      counts.set(key, total);
      return ok(total);
    },
    totalFor(sourceAddressHash: string, windowStartMs: number): number {
      return counts.get(bucket(sourceAddressHash, windowStartMs)) ?? 0;
    },
  };
}

export type InProcessCoordinatorOptions = {
  /**
   * The shared source counter. Defaults to a fresh one per coordinator, which is the correct
   * default: one coordinator factory stands in for the whole platform, so its source counter
   * must span every Organization it serves.
   */
  readonly sourceShard?: SourceCounterShard;
  /** Makes the source shard unreachable, for verifying that the level degrades and never blocks. */
  readonly brokenSourceShard?: boolean;
  /**
   * Makes every call fail, for verifying the fail-closed and evidence-loss paths. A control
   * whose degraded behaviour is never exercised is a control whose degraded behaviour is a
   * claim.
   */
  readonly broken?: 'reject' | 'throw';
};

export function createInProcessRequestCoordinator(
  budget: DayWriteBudget,
  options: InProcessCoordinatorOptions = {},
): RequestCoordinator {
  const byOrganization = new Map<string, CoordinationState>();
  const sourceShard = options.sourceShard ?? createInProcessSourceCounterShard();

  function stateFor(organizationId: string): CoordinationState {
    let state = byOrganization.get(organizationId);
    if (state === undefined) {
      state = createCoordinationState();
      byOrganization.set(organizationId, state);
    }
    return state;
  }

  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      if (options.broken === 'throw') {
        throw new Error('synthetic coordinator failure');
      }
      if (options.broken === 'reject') {
        return err(unavailable());
      }

      const state = stateFor(request.organizationId);
      const decision = admit(state, request);

      // ---- The source level's follow-up. The engine says when a delta is owed; the shard is
      // the only thing that can see the same address in another Organization.
      if (decision.sourceReport !== null && options.brokenSourceShard !== true) {
        const total = await sourceShard.add(
          decision.sourceReport.sourceAddressHash,
          decision.sourceReport.windowStartMs,
          decision.sourceReport.delta,
        );
        if (total.ok) {
          applySourceTotal(
            state,
            decision.sourceReport.sourceAddressHash,
            decision.sourceReport.windowStartMs,
            total.value,
          );
        }
        // A shard that cannot answer does NOT block. See `applySourceTotal` for why that is the
        // right direction for this level and only this level.
      }

      let outcome: AdmissionOutcome = decision.outcome;
      let retryAfterSeconds = decision.retryAfterSeconds;
      if (outcome === 'admitted' && sourceBlocked(state, decision.sourceKey, request.nowMs)) {
        outcome = 'rate_limited';
        retryAfterSeconds = sourceRetryAfterSeconds(request.nowMs);
      }

      let disposed = false;

      const coordination: RequestCoordination = {
        outcome,
        retryAfterSeconds,

        async recordDenial(
          key: DenialGroupKey,
          context: DenialContext,
        ): Promise<Result<DenialRecordOutcome>> {
          if (disposed) {
            return err(internal());
          }
          // THE TENANT GUARD. A handle is bound to one Organization when it is created, from
          // the authenticated context; a key naming another Organization is a defect that
          // would file one tenant's evidence under another. It is refused rather than
          // recorded, and the caller announces the loss.
          if (key.organizationId !== request.organizationId) {
            return err(internal());
          }

          const dayStartMs = windowStart(request.nowMs, DAY_MS);

          const wanted = permitsToBuy(state, request.nowMs);
          if (wanted > 0) {
            const granted = await budget.take(dayStartMs, 'security', wanted);
            // A budget that cannot answer grants nothing, and is NOT recorded as exhausted:
            // the denial is still counted, only its durable summary is dropped, and the drop is
            // announced. See `creditPermits`.
            creditPermits(state, granted.ok ? granted.value : 0, request.nowMs, granted.ok);
          }

          const recorded = recordDenial(state, key, context, request.nowMs);
          const swept = sweepClosedWindows(state, denialGroupKeyFromText, request.nowMs);
          const summaries = [...recorded.summaries, ...swept.summaries];
          return ok({
            summaries,
            // THE RECEIPT FOR A SPEND THAT HAS ALREADY HAPPENED. `spendPermit` took
            // `DENIAL_SUMMARY_ROW_WRITES` out of both the per-Organization and the platform
            // `security` counters for each summary that reached this list; one a ceiling refused
            // is in `suppressed`, not here. Minting is therefore accounting for what was charged,
            // never a second charge — and null when nothing is due, so an empty write cannot be
            // funded by a reservation that exists for no reason.
            reservation:
              summaries.length === 0
                ? null
                : mintWriteReservation({
                    organizationId: request.organizationId,
                    allocation: 'security',
                    estimatedRowWrites: summaries.length * DENIAL_SUMMARY_ROW_WRITES,
                    dayStartMs,
                  }),
            suppressedByCeiling: recorded.suppressed + swept.suppressed,
          });
        },

        async reserveWrites(
          estimatedRowWrites: number,
          origin: WriteOrigin,
        ): Promise<Result<WriteAdmissionOutcome>> {
          if (disposed) {
            return err(internal());
          }
          const dayStartMs = windowStart(request.nowMs, DAY_MS);

          const wanted = writePermitsToBuy(state, estimatedRowWrites, request.nowMs);
          if (wanted > 0) {
            const granted = await budget.take(dayStartMs, 'business', wanted);
            // An unreachable ledger grants nothing and is NOT recorded as exhaustion. The
            // request is then deferred — which refuses a write, never permits one — and the
            // Organization asks again on its next mutation instead of being stopped for the
            // rest of the UTC day by one transient failure.
            creditWritePermits(
              state,
              granted.ok ? granted.value : 0,
              request.nowMs,
              granted.ok,
            );
          }

          const decision = admitWrite(state, estimatedRowWrites, request.nowMs, origin);
          if (!decision.admitted) {
            return ok({
              kind: 'deferred',
              refusedBy: decision.refusedBy,
              resumeAfterMs: nextUtcResetMs(request.nowMs),
              retryAfterSeconds: retryAfterSecondsUntilReset(request.nowMs),
            });
          }
          return ok({
            kind: 'granted',
            // Minted only after `admitWrite` returned true, which is the call that decremented
            // both the per-Organization counter and the platform reserve. A reservation that
            // existed before the decrement would be a promise against capacity nobody had taken.
            reservation: mintWriteReservation({
              organizationId: request.organizationId,
              allocation: 'business',
              estimatedRowWrites,
              dayStartMs,
            }),
          });
        },

        dispose(): void {
          disposed = true;
        },
      };

      return ok(coordination);
    },
  };
}
