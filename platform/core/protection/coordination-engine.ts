/**
 * THE COORDINATION ALGORITHM, as a pure function of state and time.
 *
 * Everything 0013 decides about counting lives here: the fixed rate windows, the 15-minute
 * denial windows, the emission ladder, the daily ceilings, and what happens when a ceiling is
 * reached. There is no I/O in this file, no storage, no clock and no vendor type — the
 * Durable Object adapter owns durability and calls in, and the in-process coordinator holds
 * the same state in a `Map`.
 *
 * WHY THE ALGORITHM IS SEPARATED FROM THE DURABLE OBJECT. Two reasons, and the second is the
 * one that matters. First, replaceability: `CLOUDFLARE_STANDARD.md` §2 requires that a
 * Cloudflare service be swappable without rewriting the domain, and a rule that a coordinator
 * counts in fixed windows and writes on a ladder is domain, not vendor. Second, and more
 * practically: **this repository cannot run a Durable Object.** There is no Worker
 * configuration, no runtime and no approved test framework, so an algorithm that lived inside
 * the DO class would be an algorithm nobody could execute before deployment. Here it is
 * ordinary code that a verification harness runs directly, which is the difference between
 * "reviewed" and "verified".
 *
 * A PURE ALGORITHM IS NOT A CORRECT CONTROL ON ITS OWN, and this file learned that the hard
 * way. Every function below passed its own tests while the SOURCE rate limit was unreachable
 * in the deployed shape, because the composition — one coordinator per Organization — put the
 * source counter somewhere it could never see a source spanning Organizations. The algorithm
 * was right and the control did not exist. Hence `SourceReport` and `applySourceTotal`: the
 * source level's authoritative count deliberately lives OUTSIDE this state, and this file only
 * says when to ask and what to do with the answer.
 *
 * WHAT IS PERSISTED, AND WHY SO LITTLE. Durable Object SQLite rows written are metered —
 * 100,000 per day on Free, the SAME allowance as D1 — so a coordinator that wrote a row per
 * request would have moved the exhaustible resource rather than removed it. Therefore:
 *
 *   - RATE COUNTERS ARE PERSISTED ONLY ONCE A SUBJECT HAS EXCEEDED ITS LIMIT in the current
 *     window. Ordinary traffic writes NOTHING. What survives an eviction is the security-
 *     relevant fact — "this subject is blocked for the rest of this window" — and not the
 *     bookkeeping. The cost of that choice is stated rather than hidden: if the object is
 *     evicted mid-window, a subject that was below its limit regains at most one window's
 *     allowance. That is bounded, it is not caller-triggerable on demand, and an object under
 *     sustained attack stays warm precisely when it matters.
 *   - DENIAL GROUP STATE IS PERSISTED AT ITS EMISSION POINTS and nowhere else, so it is
 *     already bounded by `MAX_WRITES_PER_GROUP_WINDOW`.
 *   - THE DAILY WRITE BUDGET IS PERSISTED ON EVERY ADMITTED WRITE, and that exception is
 *     deliberate. `docs/decisions/0014` §A: an evicted instance that forgot how much its
 *     Organization had spent today would hand back the whole 10,000 daily ceiling on restart, and
 *     an eviction cycle would then be an unbounded write path — the exact bypass the budget
 *     exists to close. The reserve of unspent permits may safely be lost (losing them spends
 *     nothing); the USED counter may not. The cost is bounded by the budget itself: at most
 *     `DAILY_ALLOCATION.business / cheapest declared cost` Durable Object row-writes per day
 *     account-wide, which for the Customer Directory's eight-row-write mutations is 7,500 against
 *     a 100,000/day allowance.
 */

import type {
  AdmissionOutcome,
  CoordinatedRequest,
  DenialContext,
  DenialGroupKey,
  DenialSummary,
  RateLimitLevel,
} from './coordination.ts';
import {
  DENIAL_WINDOW_MS,
  EMISSION_LADDER,
  PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES,
  RATE_LIMIT_PER_WINDOW,
  RATE_WINDOW_MS,
  SOURCE_REPORT_INTERVAL,
  UNKNOWN_SOURCE,
  DAY_MS,
  assertDenialGroupKey,
  denialGroupKeyText,
  windowStart,
} from './coordination.ts';
import {
  PER_ORGANIZATION_DAILY_ROW_WRITES,
  PLATFORM_ORIGINATED_DAILY_ROW_WRITES,
} from './write-admission.ts';

/**
 * ===========================================================================================
 * WHO IS SPENDING THIS ORGANIZATION'S WRITE ALLOCATION. **REQUIRED EVERYWHERE, NEVER DEFAULTED.**
 * ===========================================================================================
 *
 *   `'tenant'`   — the Organization's own principals, through the Action pipeline. Checked
 *                  against `PER_ORGANIZATION_DAILY_ROW_WRITES` alone.
 *   `'platform'` — a platform operator acting AT this Organization. Checked against that ceiling
 *                  **and** `PLATFORM_ORIGINATED_DAILY_ROW_WRITES`.
 *
 * *** IT HAS NO DEFAULT, AND THAT IS THE MECHANISM RATHER THAN A STYLE CHOICE. *** A defaulted
 * origin means the cheap side is inherited by omission, and the next writer to reach this budget
 * gets the unbounded one without deciding to. `architecture.md` §3a: a guard that must be
 * remembered is a discipline; a parameter the call cannot omit is a mechanism. **Every existing
 * caller had to state which it was, and the two platform services could not silently be `tenant`.**
 */
export type WriteOrigin = 'tenant' | 'platform';
import { DENIAL_SUMMARY_ROW_WRITES } from '../storage/write-cost.ts';

// =============================================================================================
// State
// =============================================================================================

export type RateSubjectState = {
  windowStartMs: number;
  count: number;
  /** True once the subject has been over its limit in this window and that fact is durable. */
  exceededPersisted: boolean;
};

/**
 * The source level's state, separate from the other two because it is the only one whose
 * authoritative count lives OUTSIDE this Organization.
 *
 * `localCount` is what this Organization has seen. `reportedCount` is how much of that the
 * shared shard already knows. `sharedTotal` is the cross-Organization figure the shard last
 * returned. The gap between `localCount` and `reportedCount` is the imprecision named in
 * `SourceCounterShard`.
 */
export type SourceSubjectState = {
  windowStartMs: number;
  localCount: number;
  reportedCount: number;
  sharedTotal: number;
  /** Set once the shared total has been over the limit in this window. */
  blocked: boolean;
};

/** A delta the caller owes the shared shard. */
export type SourceReport = {
  readonly sourceAddressHash: string;
  readonly windowStartMs: number;
  readonly delta: number;
};

export type DenialGroupState = {
  windowStartMs: number;
  firstAttemptAtMs: number;
  lastAttemptAtMs: number;
  attemptCount: number;
  /** The attempt count reflected in the last summary written for this window. */
  emittedAtCount: number;
  /** How many summaries this window has already produced. Makes each appended row unique. */
  emissionCount: number;
  /** How far up `EMISSION_LADDER` this window has climbed. */
  ladderIndex: number;
  /**
   * Carried so a summary can name the actor's own context. Captured from the FIRST attempt of
   * the window and not refreshed: a window is one actor's run, and re-reading it per attempt
   * would let a late attempt's context describe attempts it was not present for.
   *
   * There is no member here for the TARGET's Business, and there must never be one — that is
   * the disclosure `relatedBusinessIds` is forced empty on every denial to prevent.
   */
  context: DenialContext;
};

/**
 * All the state one coordinator instance holds. One instance serves exactly one Organization,
 * so every counter in here is tenant-scoped by construction — there is no tenant column to get
 * wrong because there is no second tenant in the object.
 */
export type CoordinationState = {
  /** The actor and Organization levels. Both are tenant-scoped facts. */
  readonly rate: Map<string, RateSubjectState>;
  /** The source level. Counted here, ADJUDICATED by a shared shard. */
  readonly source: Map<string, SourceSubjectState>;
  readonly groups: Map<string, DenialGroupState>;
  /**
   * The per-Organization daily SECURITY-EVIDENCE ceiling, in estimated row-writes.
   *
   * DENOMINATED IN ROW-WRITES SINCE `docs/decisions/0014` §A.5, not in summaries. One summary
   * costs `DENIAL_SUMMARY_ROW_WRITES`; see `coordination.ts` for why the unit had to change
   * before this ceiling could be added to the platform ceiling at all.
   */
  perOrganizationDay: { dayStartMs: number; used: number };
  /**
   * Platform-wide SECURITY-allocation permits held locally, in row-writes, bought in blocks from
   * the `DayWriteBudget`. Held as a reserve so the shared ledger is consulted once per block
   * instead of once per emission.
   */
  platformPermits: number;
  /** The UTC day the reserve was bought for. A reserve does not survive the day boundary. */
  platformPermitsDayStartMs: number;
  /**
   * The UTC day on which the platform budget ANSWERED with nothing left.
   *
   * Without this, every later emission point would ask again and be refused again, and emission
   * points are bounded only per group-window — so a broad campaign would turn a spent budget
   * into tens of thousands of extra coordinator round trips against an allowance that is itself
   * exhaustible. Once the budget has said "nothing left today", it is not asked again until the
   * day rolls: one refusal per Organization per day.
   *
   * SET ONLY ON A SUCCESSFUL ANSWER OF ZERO, never on a failure to reach the budget. A
   * transient error is not evidence that the day's budget is gone, and treating it as such
   * would suppress a day of evidence for a blip.
   */
  platformExhaustedDayStartMs: number;

  // ===========================================================================================
  // DAILY D1 WRITE ADMISSION — docs/decisions/0014 §A. The BUSINESS allocation's half.
  // ===========================================================================================
  //
  // Deliberately a SECOND, PARALLEL set of counters rather than a generalisation of the three
  // above. The two budgets share an algorithm and nothing else: they draw on different
  // allocations, they behave differently at exhaustion (see `coordination.ts`), and one of them
  // is visible to the caller while the other must never be. Folding them into one set of fields
  // would make the next person maintaining this file believe those differences are accidental.

  /** This Organization's `business` row-writes used today. Ceiling: PER_ORGANIZATION_DAILY_ROW_WRITES. */
  writeDay: { dayStartMs: number; used: number };
  /**
   * ===========================================================================================
   * *** THE PLATFORM'S SHARE OF THIS ORGANIZATION'S DAY. A THIRD PARALLEL COUNTER. ***
   * Ceiling: `PLATFORM_ORIGINATED_DAILY_ROW_WRITES`.
   * ===========================================================================================
   *
   * **A SECOND, PARALLEL COUNTER RATHER THAN A GENERALISATION — the argument this file already
   * makes for the pair above, applied a third time.** Folding it into `writeDay` would make the
   * next person believe the difference is accidental, and the difference is the entire point:
   * `writeDay` is what the TENANT may spend, this is what the PLATFORM may spend AT the tenant,
   * and they behave differently at exhaustion. Exhausting `writeDay` stops the customer working.
   * Exhausting this one stops an operator looking, and **leaves the customer working**, which is
   * the property the whole mechanism exists for.
   *
   * *** IT IS A SUB-COUNTER, NOT A SECOND ALLOWANCE. *** Every platform-originated write
   * increments **both** this and `writeDay`, and **both ceilings must admit it.** A platform write
   * cannot push an Organization past its real allocation — see `PLATFORM_ORIGINATED_DAILY_ROW_
   * WRITES` for why that direction was chosen and what it costs a busy customer.
   *
   * WHY IT EXISTS: measured on 2026-09-05, 2,000 platform calls exhausted one named Organization's
   * whole 10,000 and its own mutations then began failing. Two earlier fixes bounded the OPERATOR;
   * **this is the only one keyed to the victim**, so N operators summing onto one customer hit the
   * same number as one.
   */
  platformWriteDay: { dayStartMs: number; used: number };
  /** Platform `business` permits held locally, in row-writes, bought in blocks from the ledger. */
  writePermits: number;
  /** The UTC day the write reserve was bought for. A reserve does not survive the day boundary. */
  writePermitsDayStartMs: number;
  /**
   * The UTC day on which the ledger ANSWERED that the business allocation was spent.
   *
   * Same reasoning as `platformExhaustedDayStartMs`, and it matters more here: mutations are far
   * more frequent than summary emissions, so without this every mutation for the rest of the day
   * would spend a ledger round trip to be told the same thing — the control funding its own
   * denial of service against an allowance that is itself exhaustible.
   *
   * SET ONLY ON A SUCCESSFUL ANSWER OF ZERO, never on a failure to reach the ledger. An
   * unreachable ledger is not evidence that the day is spent, and treating it as such would stop
   * an Organization writing for a day because of a blip.
   */
  writeExhaustedDayStartMs: number;
};

export function createCoordinationState(): CoordinationState {
  return {
    rate: new Map<string, RateSubjectState>(),
    source: new Map<string, SourceSubjectState>(),
    groups: new Map<string, DenialGroupState>(),
    perOrganizationDay: { dayStartMs: 0, used: 0 },
    platformPermits: 0,
    platformPermitsDayStartMs: 0,
    platformExhaustedDayStartMs: -1,
    writeDay: { dayStartMs: 0, used: 0 },
    platformWriteDay: { dayStartMs: 0, used: 0 },
    writePermits: 0,
    writePermitsDayStartMs: 0,
    writeExhaustedDayStartMs: -1,
  };
}

// =============================================================================================
// Admission — 0013 control 6
// =============================================================================================

export type AdmissionResult = {
  readonly outcome: AdmissionOutcome;
  readonly retryAfterSeconds: number;
  /** The level that refused, for the internal notice. Never returned to the caller. */
  readonly refusedBy: RateLimitLevel | null;
  /** Rate subjects whose "exceeded" state has just become worth persisting. */
  readonly persist: readonly string[];
  /**
   * A delta the caller now owes the shared `SourceCounterShard`.
   *
   * The engine cannot make that call — it is pure — so it says WHEN one is due, the coordinator
   * makes it, and the answer comes back through `applySourceTotal`. That split is what keeps
   * the whole three-level decision testable without a Cloudflare runtime, which is how the
   * unreachable-source defect was found in the first place.
   */
  readonly sourceReport: SourceReport | null;
  /** The source bucket this request counted against, for the follow-up. */
  readonly sourceKey: string;
};

function subjectKey(level: RateLimitLevel, id: string): string {
  // The separator is a printable space. It cannot occur in a level name (a closed set of three
  // ASCII words), an Organization identifier or a principal identifier (`^[A-Za-z0-9_-]{8,64}$`).
  return `${level} ${id}`;
}

function retryAfter(start: number, nowMs: number): number {
  // At least one second: a `Retry-After: 0` invites an immediate retry, which is the opposite
  // of what the header is for.
  return Math.max(1, Math.ceil((start + RATE_WINDOW_MS - nowMs) / 1000));
}

/**
 * All three levels are evaluated and all three are incremented, even when an earlier one has
 * already refused.
 *
 * COUNTING PAST THE REFUSAL IS DELIBERATE. If a refused request stopped incrementing the other
 * levels, a caller who kept its actor limit saturated would keep its Organization and source
 * counters artificially low, and the two outer limits would never engage. The limiter would
 * measure what it let through instead of what was attempted.
 *
 * THE REFUSAL ORDER IS actor, organization, source, AND IT IS FIXED. The level reported is the
 * narrowest one that refused, so an internal notice names the most specific fact available
 * rather than whichever check happened to run last. Inside a single Organization the source
 * level is therefore dominated — 300 < 600 — and that is correct: within one tenant the
 * tenant-scoped limit is the meaningful one, and the source level exists for what only it can
 * see, which is one address spending budget across MANY Organizations.
 */
export function admit(state: CoordinationState, request: CoordinatedRequest): AdmissionResult {
  const start = windowStart(request.nowMs, RATE_WINDOW_MS);
  const persist: string[] = [];
  let refusedBy: RateLimitLevel | null = null;

  // ---- The two tenant-scoped levels.
  const subjects: readonly (readonly [RateLimitLevel, string])[] = [
    ['actor', request.principalId],
    ['organization', request.organizationId],
  ];

  for (const [level, id] of subjects) {
    const key = subjectKey(level, id);
    const limit = RATE_LIMIT_PER_WINDOW[level];
    let subject = state.rate.get(key);
    if (subject === undefined || subject.windowStartMs !== start) {
      subject = { windowStartMs: start, count: 0, exceededPersisted: false };
      state.rate.set(key, subject);
    }
    // Capped one past the limit. The counter only has to answer "is this subject over?", and
    // an uncapped integer under a sustained campaign is unbounded memory in a long-lived
    // object for no additional information.
    if (subject.count <= limit) {
      subject.count += 1;
    }
    if (subject.count > limit) {
      if (refusedBy === null) {
        refusedBy = level;
      }
      if (!subject.exceededPersisted) {
        subject.exceededPersisted = true;
        persist.push(key);
      }
    }
  }

  // ---- The source level. Counted here, ADJUDICATED by the shared shard.
  //
  // NULL SHARES ONE BUCKET RATHER THAN SKIPPING THE LEVEL. An adapter that cannot establish a
  // source must throttle harder, not be exempt.
  const sourceKey = request.sourceAddressHash ?? UNKNOWN_SOURCE;
  let source = state.source.get(sourceKey);
  if (source === undefined || source.windowStartMs !== start) {
    source = {
      windowStartMs: start,
      localCount: 0,
      reportedCount: 0,
      sharedTotal: 0,
      blocked: false,
    };
    state.source.set(sourceKey, source);
  }
  source.localCount += 1;

  // Report on the FIRST request of the window — so an address already over its limit through
  // OTHER Organizations is caught on this Organization's very first request rather than after
  // twenty-five of them — and every SOURCE_REPORT_INTERVAL requests after that.
  const unreported = source.localCount - source.reportedCount;
  let sourceReport: SourceReport | null = null;
  if (source.localCount === 1 || unreported >= SOURCE_REPORT_INTERVAL) {
    sourceReport = { sourceAddressHash: sourceKey, windowStartMs: start, delta: unreported };
    source.reportedCount = source.localCount;
  }

  // THE LOCAL COUNT IS A LOWER BOUND ON THE SHARED TOTAL, so it may be acted on directly: every
  // request this Organization saw from this address is, by definition, also a request the whole
  // platform saw from it. Acting on a lower bound can never refuse a source that is not
  // genuinely over. It is not a second policy and it is not redundant scaffolding — it is the
  // part of the answer that needs no round trip. The shard exists for the part a lower bound
  // cannot see: the same address spending budget through OTHER Organizations.
  //
  // In practice this branch is dominated inside a single Organization, because the Organization
  // limit of 300 crosses before a source reaches 600. That is expected and is not what makes
  // the level useful; see the header.
  if (source.localCount > RATE_LIMIT_PER_WINDOW.source) {
    source.blocked = true;
  }

  if (source.blocked && refusedBy === null) {
    refusedBy = 'source';
  }

  if (refusedBy === null) {
    return {
      outcome: 'admitted',
      retryAfterSeconds: 0,
      refusedBy: null,
      persist,
      sourceReport,
      sourceKey,
    };
  }
  return {
    outcome: 'rate_limited',
    retryAfterSeconds: retryAfter(start, request.nowMs),
    refusedBy,
    persist,
    sourceReport,
    sourceKey,
  };
}

/**
 * Feeds the shared shard's answer back in.
 *
 * A SHARD THAT COULD NOT ANSWER MUST NOT BLOCK, and that is not a lapse in fail-closed
 * discipline — it is what distinguishes this level from the other two. The actor and
 * Organization levels still bound every request, so an unreachable shard degrades to exactly
 * the two-level behaviour, which is itself bounded. Blocking instead would let one unreachable
 * shard refuse every request from an address — including every legitimate user behind that NAT
 * — on the strength of no evidence at all. So the coordinator simply does not call this when
 * the shard failed; nothing was widened, because nothing was ever opened.
 */
export function applySourceTotal(
  state: CoordinationState,
  sourceKey: string,
  windowStartMs: number,
  total: number,
): void {
  const source = state.source.get(sourceKey);
  if (source === undefined || source.windowStartMs !== windowStartMs) {
    return;
  }
  source.sharedTotal = total;
  if (total > RATE_LIMIT_PER_WINDOW.source) {
    source.blocked = true;
  }
}

/** Is this address blocked for the current window? Read after a report has been applied. */
export function sourceBlocked(state: CoordinationState, sourceKey: string, nowMs: number): boolean {
  const source = state.source.get(sourceKey);
  return (
    source !== undefined &&
    source.windowStartMs === windowStart(nowMs, RATE_WINDOW_MS) &&
    source.blocked
  );
}

export function sourceRetryAfterSeconds(nowMs: number): number {
  return retryAfter(windowStart(nowMs, RATE_WINDOW_MS), nowMs);
}

// =============================================================================================
// Denial aggregation — 0013 controls 1, 3, 4, 5 and 9
// =============================================================================================

/**
 * WHEN AN ORGANIZATION DROPS TO ESSENTIAL EMISSIONS ONLY.
 *
 * Doing the write arithmetic properly exposed a real weakness. The aggregation alone permits up
 * to `6 Actions x 7 categories x 96 windows x 6 writes` = 24,192 row-writes per credential per
 * day; it is the CEILINGS, not the grouping, that bound the platform. So an attacker who
 * deliberately SPREADS a campaign across Actions and denial categories — rather than hammering
 * one — can exhaust its own Organization's 1,000-write evidence budget in roughly an hour of
 * maximally-spread probing, and every denial after that is counted but not durably recorded.
 * Burn the evidence budget early, then probe under cover.
 *
 * The mitigation is to spend the remaining budget on the emissions that carry the most, and to
 * do it before the budget is gone rather than after. Past the halfway line only the two
 * emissions that matter are made:
 *
 *   THE FIRST ATTEMPT of a window — without it, a campaign that runs briefly and stops leaves
 *                                   no record at all, which is the silence this whole control
 *                                   exists to end.
 *   THE WINDOW CLOSE              — it carries the true total, which is the number an operator
 *                                   is actually alerting on.
 *
 * What is given up is the intermediate ladder (10, 100, 1,000, 10,000 attempts), whose value is
 * making a growing count durable against a mid-window eviction. That is real but second-order,
 * and trading it triples the number of group-windows the same budget can cover.
 *
 * IN ROW-WRITES SINCE `0014` §A.5, like the ceiling it is half of. The threshold is a halfway
 * line, so the unit it is expressed in has to be the unit `perOrganizationDay.used` counts.
 */
export const CONSERVATION_THRESHOLD = Math.floor(PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES / 2);

export type DenialRecordResult = {
  /** Summaries now due to be written to D1 by the caller. */
  readonly summaries: readonly DenialSummary[];
  /**
   * Summaries that a daily ceiling refused. The attempt is still COUNTED — only its durable
   * evidence was dropped — and the caller announces the loss.
   */
  readonly suppressed: number;
  /** Group keys whose state should be persisted. Exactly the ones that emitted. */
  readonly persist: readonly string[];
};

function toSummary(
  key: DenialGroupKey,
  group: DenialGroupState,
  windowClosed: boolean,
): DenialSummary {
  return {
    key,
    windowStartMs: group.windowStartMs,
    emissionSequence: group.emissionCount,
    firstAttemptAtMs: group.firstAttemptAtMs,
    lastAttemptAtMs: group.lastAttemptAtMs,
    attemptCount: group.attemptCount,
    actorBusinessIds: group.context.actorBusinessIds,
    permissionId: group.context.permissionId,
    scope: group.context.scope,
    windowClosed,
  };
}

/**
 * Spends one summary's worth of security-allocation permits if both ceilings allow it.
 *
 * BOTH ARE CHECKED, and the per-Organization one is not decoration: without it a single
 * Organization could spend the whole platform budget and blind every other Organization's
 * evidence, which is the same starvation argument the platform ceiling exists to prevent, one
 * level down.
 *
 * ONE SUMMARY COSTS `DENIAL_SUMMARY_ROW_WRITES`, NOT ONE (`0014` §A.5, `storage/write-cost.ts`).
 * The whole cost is taken or none of it is: a half-charged summary is a row written against an
 * allocation that had no room for it, which is the under-reserving §A.12 calls an outage.
 */
function spendPermit(state: CoordinationState, dayStartMs: number): boolean {
  if (state.perOrganizationDay.dayStartMs !== dayStartMs) {
    state.perOrganizationDay = { dayStartMs, used: 0 };
  }
  if (state.platformPermitsDayStartMs !== dayStartMs) {
    // A reserve bought yesterday is not spendable today. Cloudflare resets its Free daily
    // limits at 00:00 UTC, so the budget this reserve was drawn from has already reset.
    state.platformPermits = 0;
    state.platformPermitsDayStartMs = dayStartMs;
  }
  if (
    state.perOrganizationDay.used + DENIAL_SUMMARY_ROW_WRITES >
    PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES
  ) {
    return false;
  }
  if (state.platformPermits < DENIAL_SUMMARY_ROW_WRITES) {
    return false;
  }
  state.perOrganizationDay.used += DENIAL_SUMMARY_ROW_WRITES;
  state.platformPermits -= DENIAL_SUMMARY_ROW_WRITES;
  return true;
}

/** Past the halfway line, only the first emission of a window and its close are made. */
function conserving(state: CoordinationState, dayStartMs: number): boolean {
  return (
    state.perOrganizationDay.dayStartMs === dayStartMs &&
    state.perOrganizationDay.used >= CONSERVATION_THRESHOLD
  );
}

/**
 * Count one denied attempt, and report what is now due to be written.
 *
 * `assertDenialGroupKey` runs FIRST and throws. An unbranded key is the one route by which the
 * caller-controlled resource identifier could enter the grouping, and control 5 is the
 * constraint that makes the whole aggregation bounded — so it stops the record rather than
 * being discovered in a write.
 */
export function recordDenial(
  state: CoordinationState,
  key: DenialGroupKey,
  context: DenialContext,
  nowMs: number,
): DenialRecordResult {
  assertDenialGroupKey(key);

  const dayStartMs = windowStart(nowMs, DAY_MS);
  const currentWindow = windowStart(nowMs, DENIAL_WINDOW_MS);
  const text = denialGroupKeyText(key);
  const summaries: DenialSummary[] = [];
  const persist: string[] = [];
  let suppressed = 0;

  function emit(summaryKey: DenialGroupKey, group: DenialGroupState, closed: boolean): void {
    if (group.attemptCount <= group.emittedAtCount) {
      return;
    }
    if (!spendPermit(state, dayStartMs)) {
      suppressed += 1;
      return;
    }
    summaries.push(toSummary(summaryKey, group, closed));
    group.emittedAtCount = group.attemptCount;
    group.emissionCount += 1;
  }

  let group = state.groups.get(text);

  // ---- The group's own window has rolled over: close the old one first, with its final count.
  if (group !== undefined && group.windowStartMs !== currentWindow) {
    emit(key, group, true);
    persist.push(text);
    state.groups.delete(text);
    group = undefined;
  }

  if (group === undefined) {
    group = {
      windowStartMs: currentWindow,
      firstAttemptAtMs: nowMs,
      lastAttemptAtMs: nowMs,
      attemptCount: 1,
      emittedAtCount: 0,
      emissionCount: 0,
      ladderIndex: 0,
      context: {
        actorBusinessIds: [...context.actorBusinessIds],
        permissionId: context.permissionId,
        scope: context.scope,
      },
    };
    state.groups.set(text, group);
  } else {
    group.attemptCount += 1;
    group.lastAttemptAtMs = nowMs;
  }

  // ---- The ladder. The first attempt of a window always emits, so a campaign that runs for
  // ten minutes and then STOPS still leaves a record — the hole a close-only design would
  // have. See EMISSION_LADDER in coordination.ts.
  let crossed = false;
  while (
    group.ladderIndex < EMISSION_LADDER.length &&
    group.attemptCount >= EMISSION_LADDER[group.ladderIndex]
  ) {
    group.ladderIndex += 1;
    crossed = true;
  }
  // Under budget pressure the INTERMEDIATE ladder points are given up and the first emission is
  // kept, because a record that exists at all is worth more than a record whose count is
  // precise. See CONSERVATION_THRESHOLD.
  const essential = group.emissionCount === 0;
  if (crossed && (essential || !conserving(state, dayStartMs))) {
    emit(key, group, false);
    persist.push(text);
  }

  return { summaries, suppressed, persist };
}

/**
 * Close every OTHER group whose window has expired, bounded per call.
 *
 * WHY THIS EXISTS. A group's own window is closed by its next attempt, so a campaign that
 * stops leaves its last window's FINAL count unwritten. The ladder means a record already
 * exists — the evidence is never absent — but its count would be the ladder value rather than
 * the total. This sweep completes those windows the next time ANY denial arrives in the same
 * Organization, which is the cheapest correct trigger available: it costs no extra round trip,
 * no alarm, and no second path that writes audit evidence.
 *
 * IT IS BOUNDED because an unbounded sweep would turn one denial into an arbitrary number of
 * D1 writes — a burst the ceilings would absorb but the request latency would not.
 *
 * A CLOSE IS NEVER SUBJECT TO CONSERVATION. It is the emission that carries the true total, and
 * it is one write per group-window at most.
 *
 * WHAT REMAINS UNCLOSED, STATED RATHER THAN DISCOVERED: an Organization whose denials stop
 * entirely leaves its final windows at their last ladder value until the next denial in that
 * Organization. That is a completeness gap in the COUNT, never in the existence of the record.
 */
const SWEEP_LIMIT = 8;

export function sweepClosedWindows(
  state: CoordinationState,
  keyFor: (text: string) => DenialGroupKey | undefined,
  nowMs: number,
): DenialRecordResult {
  const dayStartMs = windowStart(nowMs, DAY_MS);
  const currentWindow = windowStart(nowMs, DENIAL_WINDOW_MS);
  const summaries: DenialSummary[] = [];
  const persist: string[] = [];
  let suppressed = 0;

  for (const [text, group] of state.groups) {
    if (summaries.length + suppressed >= SWEEP_LIMIT) {
      break;
    }
    if (group.windowStartMs === currentWindow) {
      continue;
    }
    const key = keyFor(text);
    if (key === undefined) {
      // The key could not be reconstructed. Dropping the group would delete evidence, so it is
      // left in place for a later sweep that can name it.
      continue;
    }
    if (group.attemptCount > group.emittedAtCount) {
      if (spendPermit(state, dayStartMs)) {
        summaries.push(toSummary(key, group, true));
        group.emissionCount += 1;
        group.emittedAtCount = group.attemptCount;
      } else {
        suppressed += 1;
      }
    }
    persist.push(text);
    state.groups.delete(text);
  }

  return { summaries, suppressed, persist };
}

/**
 * How many security-allocation permits the reserve is short of, for the adapter to buy before
 * recording. In ROW-WRITES since `0014` §A.5.
 *
 * Bought in BLOCKS rather than one at a time so the shared ledger is consulted once per block.
 * A block left unspent by a quiet Organization is at most `BLOCK - 1` row-writes of the daily
 * security allocation — accepted, and the reason the block is small. 128 row-writes is 32
 * summaries, which is `0013`'s block size in its original unit.
 */
export const PERMIT_BLOCK = 32 * DENIAL_SUMMARY_ROW_WRITES;

export function permitsToBuy(state: CoordinationState, nowMs: number): number {
  const dayStartMs = windowStart(nowMs, DAY_MS);
  if (state.platformExhaustedDayStartMs === dayStartMs) {
    // The platform budget already said "nothing left today". Asking again would spend
    // coordinator requests to be told the same thing.
    return 0;
  }
  if (
    state.perOrganizationDay.dayStartMs === dayStartMs &&
    state.perOrganizationDay.used + DENIAL_SUMMARY_ROW_WRITES >
      PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES
  ) {
    // Already at this Organization's own ceiling. Buying platform permits it cannot spend
    // would take them from Organizations that can.
    return 0;
  }
  if (state.platformPermitsDayStartMs !== dayStartMs) {
    return PERMIT_BLOCK;
  }
  return state.platformPermits >= DENIAL_SUMMARY_ROW_WRITES ? 0 : PERMIT_BLOCK;
}

/**
 * Credits permits the budget ACTUALLY granted.
 *
 * `answered` distinguishes "the budget replied, and the reply was zero" from "the budget could
 * not be reached". Only the first is evidence that the day is spent; treating an unreachable
 * budget as exhaustion would suppress a day of security evidence because of a blip.
 */
export function creditPermits(
  state: CoordinationState,
  granted: number,
  nowMs: number,
  answered = true,
): void {
  const dayStartMs = windowStart(nowMs, DAY_MS);
  if (state.platformPermitsDayStartMs !== dayStartMs) {
    state.platformPermits = 0;
    state.platformPermitsDayStartMs = dayStartMs;
  }
  state.platformPermits += granted;
  if (answered && granted === 0) {
    state.platformExhaustedDayStartMs = dayStartMs;
  }
}

// =============================================================================================
// Daily D1 write admission — docs/decisions/0014 §A. The BUSINESS allocation.
// =============================================================================================

/**
 * How many `business` row-writes are bought at a time.
 *
 * 512 = sixty-four Customer creates at eight row-writes each. It is larger than the security
 * block because mutations are far more frequent than summary emissions, and every block is one
 * ledger round trip against a Durable Object request allowance that is itself exhaustible
 * (`adapters/durable-objects/coordinator-object.ts`, the accounting block).
 *
 * THE COST OF A BLOCK IS BOUNDED AND STATED: an Organization that buys a block and then goes
 * quiet holds at most `WRITE_PERMIT_BLOCK - 1` row-writes of the platform allocation until the
 * UTC reset. With the business allocation at 60,000 and six Organizations at their ceiling, that
 * is at most about 3,000 row-writes unspendable in the worst case — 5% of the allocation, and it
 * comes out of admitted capacity rather than out of the safety margin.
 *
 * `writePermitsToBuy` additionally caps every purchase at what the Organization could still
 * legally spend today, so an Organization can never hold permits its own ceiling forbids it from
 * using. Without that cap a nearly-exhausted Organization would take a full block out of the
 * shared allocation on its last write and strand it.
 */
export const WRITE_PERMIT_BLOCK = 512;

/**
 * Thrown, not returned. A non-integer or non-positive write cost is a defect in an Action's
 * declaration or in Core, never something a caller can cause — and admitting it would corrupt an
 * account-wide budget in a way that is invisible until D1 stops answering.
 */
export class InvalidWriteCostError extends Error {
  constructor(units: number) {
    super(
      `A write reservation was requested for ${String(units)} row-writes. A cost must be a ` +
        'positive integer: it is charged against an account-wide daily allowance, and a ' +
        'fractional, negative or NaN charge is an accounting corruption rather than a bad ' +
        'request (docs/decisions/0014 §A.1).',
    );
    this.name = 'InvalidWriteCostError';
  }
}

function assertWriteUnits(units: number): void {
  if (!Number.isInteger(units) || units <= 0) {
    throw new InvalidWriteCostError(units);
  }
}

function rollWriteDay(state: CoordinationState, dayStartMs: number): void {
  if (state.writeDay.dayStartMs !== dayStartMs) {
    state.writeDay = { dayStartMs, used: 0 };
  }
  // THE PLATFORM SUB-COUNTER ROLLS ON THE SAME BOUNDARY, and rolling it here rather than in its
  // own function is what stops the two drifting apart — a sub-ceiling that reset on a different
  // day from the ceiling it draws from would admit writes the parent had already refused.
  if (state.platformWriteDay.dayStartMs !== dayStartMs) {
    state.platformWriteDay = { dayStartMs, used: 0 };
  }
  if (state.writePermitsDayStartMs !== dayStartMs) {
    // A reserve bought yesterday is not spendable today: the allocation it was drawn from has
    // already reset at 00:00 UTC, and spending it would be spending capacity twice.
    state.writePermits = 0;
    state.writePermitsDayStartMs = dayStartMs;
  }
}

/**
 * How many `business` row-writes the local reserve is short of, for the adapter to buy before
 * admitting. Zero means "do not ask the ledger".
 *
 * IT RETURNS ZERO IN THE HOPELESS CASES RATHER THAN LETTING THE CALLER FIND OUT FROM THE LEDGER,
 * and each case is a round trip that would have bought nothing:
 *
 *   - the ledger already answered that the business allocation is spent for today;
 *   - this Organization is at its own ceiling, so permits bought here would be taken from
 *     Organizations that can still spend them;
 *   - the reserve already covers this request.
 */
export function writePermitsToBuy(
  state: CoordinationState,
  units: number,
  nowMs: number,
): number {
  assertWriteUnits(units);
  const dayStartMs = windowStart(nowMs, DAY_MS);
  rollWriteDay(state, dayStartMs);

  if (state.writeExhaustedDayStartMs === dayStartMs) {
    return 0;
  }
  if (state.writeDay.used + units > PER_ORGANIZATION_DAILY_ROW_WRITES) {
    return 0;
  }
  if (state.writePermits >= units) {
    return 0;
  }
  const wanted = Math.max(WRITE_PERMIT_BLOCK, units);
  // Never hold more than this Organization could still legally spend today.
  const spendableRemaining =
    PER_ORGANIZATION_DAILY_ROW_WRITES - state.writeDay.used - state.writePermits;
  return Math.max(0, Math.min(wanted, spendableRemaining));
}

/**
 * Credits `business` permits the ledger ACTUALLY granted.
 *
 * `answered` separates "the ledger replied, and the reply was zero" from "the ledger could not be
 * reached". Only the first is evidence that the allocation is spent. Treating an unreachable
 * ledger as exhaustion would stop an Organization writing for the rest of a UTC day because of a
 * transient failure — and unlike lost evidence, that is visible to every user of that
 * Organization.
 */
export function creditWritePermits(
  state: CoordinationState,
  granted: number,
  nowMs: number,
  answered = true,
): void {
  const dayStartMs = windowStart(nowMs, DAY_MS);
  rollWriteDay(state, dayStartMs);
  state.writePermits += granted;
  if (answered && granted === 0) {
    state.writeExhaustedDayStartMs = dayStartMs;
  }
}

/**
 * Charges `units` against both ceilings, or charges nothing.
 *
 * ALL OR NOTHING, AND BOTH CEILINGS. A partial charge would let a write proceed against capacity
 * that was not there, which is the under-reserving `0014` §A.12 names as the outage direction.
 * The per-Organization ceiling is checked first because it is the one that binds for a single
 * tenant's runaway import — the case §A.9 is written for — and the platform reserve second
 * because it is what protects every other Organization from that tenant.
 *
 * RETURNING FALSE IS `deferred`, NOT `denied`. Nothing about authorization has been reconsidered
 * here; the caller was already permitted to do this and the day's capacity has run out. See
 * `write-admission.ts` for why that distinction is carried all the way to the caller.
 */
export function admitWrite(
  state: CoordinationState,
  units: number,
  nowMs: number,
  origin: WriteOrigin,
): boolean {
  assertWriteUnits(units);
  const dayStartMs = windowStart(nowMs, DAY_MS);
  rollWriteDay(state, dayStartMs);

  if (state.writeDay.used + units > PER_ORGANIZATION_DAILY_ROW_WRITES) {
    return false;
  }
  // =========================================================================================
  // *** THE PLATFORM SUB-CEILING. CHECKED IN ADDITION TO THE ABOVE, NEVER INSTEAD OF IT. ***
  // =========================================================================================
  //
  // BOTH MUST ADMIT. A platform-originated write draws FROM the Organization's allocation as well
  // as from its own share, so it can be refused by either — and a customer who has legitimately
  // spent 9,600 of their own 10,000 refuses platform writes at 400 even with 1,000 left here.
  // **That is the rule, not a bug:** an operator must not be able to spend capacity the customer
  // needs, and the alternative is a customer's product breaking so that an operator could look
  // at it.
  //
  // A `'tenant'` WRITE NEVER TOUCHES THIS COUNTER, which is what makes the refusal land on the
  // operator and never on the customer. The customer cannot be refused by a counter they cannot
  // increment.
  if (
    origin === 'platform' &&
    state.platformWriteDay.used + units > PLATFORM_ORIGINATED_DAILY_ROW_WRITES
  ) {
    return false;
  }
  if (state.writePermits < units) {
    return false;
  }
  state.writeDay.used += units;
  if (origin === 'platform') {
    state.platformWriteDay.used += units;
  }
  state.writePermits -= units;
  return true;
}
