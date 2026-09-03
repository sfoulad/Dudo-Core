/**
 * ===========================================================================================
 * THE PRE-AUTHENTICATION COUNTING ALGORITHMS, as pure functions of state and time.
 * ===========================================================================================
 *
 * Same split, and the same reason, as `protection/coordination-engine.ts`: the algorithm is
 * domain and the durability is an adapter, so a Cloudflare service stays replaceable
 * (`CLOUDFLARE_STANDARD.md` §2) and — the practical half — **this repository cannot run a
 * Durable Object**, so an algorithm living inside one would be an algorithm nobody could execute
 * before deployment. Here it is ordinary code a verification harness runs directly.
 *
 * ===========================================================================================
 * THERE IS NO DURABLE ADAPTER IN THIS CHANGE, AND THAT IS REPORTED RATHER THAN PAPERED OVER
 * ===========================================================================================
 *
 * A pre-auth counter cannot live in the existing coordinator: `coordinatorInstanceName` derives
 * the instance from the AUTHENTICATED Organization, and a pre-auth request has none. It needs
 * its own instances — one shard set keyed by source-address hash, one by identifier bucket —
 * which means a new instance-naming scheme inside
 * `protection/adapters/durable-objects/coordinator-object.ts`, a file another agent's task owns
 * in this same change. Editing it concurrently is the one thing `.claude/rules/workflow.md` §2
 * forbids outright.
 *
 * So this file ships the algorithm and the port, and the durable adapter is REQUESTED through
 * the Team Lead. The consequence today is stated exactly: with no limiter composed,
 * `ApiDependencies.preAuth` is absent and all five entry points answer `not_found` — registered,
 * and unreachable. That is `0014` §B's "fail closed", not a gap being tolerated.
 *
 * ===========================================================================================
 * WHAT `createInProcessPreAuthLimiter` IS FOR, AND WHAT IT MUST NEVER BE USED FOR
 * ===========================================================================================
 *
 * VERIFICATION ONLY. It counts in one isolate's memory. In a deployed Worker there are many
 * isolates and they are created and destroyed at the edge's discretion, so a per-isolate counter
 * is a limit divided by a number nobody controls — which is not a limit. `worker-entry.ts`
 * already refuses to start rather than fall back to the equivalent in-process coordinator for
 * the authenticated path, and the same refusal applies here: **the production composition root
 * must not wire this**, and it is not wired.
 */

import type { Result } from '../kernel/result.ts';
import { ok } from '../kernel/result.ts';
import { EMISSION_LADDER, RATE_WINDOW_MS, windowStart } from '../protection/coordination.ts';
import type {
  PreAuthEvidenceKey,
  PreAuthLimiter,
  PreAuthRateDecision,
  PreAuthRateSubject,
} from './pre-auth-admission.ts';
import {
  MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW,
  PRE_AUTH_EVIDENCE_WINDOW_MS,
  preAuthEvidenceKeyText,
  retryAfterSecondsUntilWindowEnd,
} from './pre-auth-admission.ts';

// =============================================================================================
// Rate counting
// =============================================================================================

/**
 * The subject's storage key.
 *
 * FIELDS NAMED EXPLICITLY RATHER THAN SPREAD, so a field added to `PreAuthRateSubject` later has
 * to be added here on purpose to participate. A spread would let a new field silently multiply
 * the counter count, which is the failure the bucketing exists to prevent.
 *
 * THE SEPARATOR IS A SPACE because it cannot occur in any component: an entry-point id is an
 * unspaced ASCII name from a five-value union, the level is one of two literals, and the key is
 * either a hex hash or `bucket:<integer>`. A separator that COULD occur would let two subjects
 * collapse into one counter, which undercounts in the direction that hides an attack.
 */
export function preAuthRateSubjectText(subject: PreAuthRateSubject): string {
  return `${subject.entryPointId} ${subject.level} ${subject.key}`;
}

export type PreAuthRateState = {
  windowStartMs: number;
  count: number;
};

export type PreAuthRateCounters = Map<string, PreAuthRateState>;

/**
 * Fixed windows, not a sliding log — a log is per-attempt state, and per-attempt state is what
 * an unauthenticated flood is made of.
 *
 * THE DECISION IS COMPUTED BEFORE THE INCREMENT AND THE INCREMENT HAPPENS EITHER WAY. Counting a
 * refused attempt is what stops an attacker at the limit from getting a fresh allowance by
 * continuing to knock; not counting it would make the limit "the first N per window plus
 * everything after the counter stopped moving".
 */
export function countPreAuthAttempt(
  counters: PreAuthRateCounters,
  subjectText: string,
  limitPerWindow: number,
  nowMs: number,
): PreAuthRateDecision {
  const currentWindow = windowStart(nowMs, RATE_WINDOW_MS);
  const existing = counters.get(subjectText);
  const state: PreAuthRateState =
    existing === undefined || existing.windowStartMs !== currentWindow
      ? { windowStartMs: currentWindow, count: 0 }
      : existing;
  state.count += 1;
  counters.set(subjectText, state);
  return {
    allowed: state.count <= limitPerWindow,
    // FROM THE WINDOW BOUNDARY, NEVER FROM THE COUNT. A retry time derived from how far over the
    // limit a caller is would differ between callers at the same instant, and a value that
    // differs per caller is a value that carries information about other callers.
    retryAfterSeconds: retryAfterSecondsUntilWindowEnd(nowMs),
  };
}

/** Drops windows that have closed, so an in-memory map does not grow without bound. */
export function sweepPreAuthCounters(counters: PreAuthRateCounters, nowMs: number): void {
  const currentWindow = windowStart(nowMs, RATE_WINDOW_MS);
  for (const [key, state] of counters) {
    if (state.windowStartMs < currentWindow) {
      counters.delete(key);
    }
  }
}

/** VERIFICATION ONLY. See the file header. Never wire this into a deployed composition root. */
export function createInProcessPreAuthLimiter(): PreAuthLimiter {
  const counters: PreAuthRateCounters = new Map();
  return {
    async check(
      subject: PreAuthRateSubject,
      limitPerWindow: number,
      nowMs: number,
    ): Promise<Result<PreAuthRateDecision>> {
      sweepPreAuthCounters(counters, nowMs);
      return ok(countPreAuthAttempt(counters, preAuthRateSubjectText(subject), limitPerWindow, nowMs));
    },
  };
}

// =============================================================================================
// Evidence counting — the bounded grouping from `pre-auth-admission.ts`
// =============================================================================================

/**
 * One group's state for one hourly window.
 *
 * THE EMISSION LADDER IS `0013`'s, IMPORTED RATHER THAN RESTATED, and it is here for the same
 * reason it is there: a close-only design produces NO record at all for a campaign that runs and
 * stops inside one window, which is the same invisibility the whole control exists to end. The
 * row exists from the first attempt; the count converges logarithmically; the cost is bounded at
 * `MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW` per group per window.
 */
export type PreAuthEvidenceGroupState = {
  windowStartMs: number;
  firstAttemptAtMs: number;
  lastAttemptAtMs: number;
  attemptCount: number;
  emittedAtCount: number;
  emissionCount: number;
  ladderIndex: number;
};

/**
 * What a recorder writes. IDENTIFIERS AND COUNTS ONLY.
 *
 * THERE IS NO FIELD FOR the submitted identifier, the source address, a credential, a header, or
 * anything read from any record — the same structural argument as `DenialSummary`, and a
 * stronger requirement here, because these attempts come from people who are not Dudo users and
 * about whom Dudo is entitled to store nothing.
 */
export type PreAuthEvidenceSummary = {
  readonly key: PreAuthEvidenceKey;
  readonly windowStartMs: number;
  readonly emissionSequence: number;
  readonly firstAttemptAtMs: number;
  readonly lastAttemptAtMs: number;
  readonly attemptCount: number;
  readonly windowClosed: boolean;
};

export type PreAuthEvidenceState = Map<string, PreAuthEvidenceGroupState>;

/**
 * Counts one attempt and returns the summaries now due.
 *
 * A CLOSED WINDOW EMITS ITS FINAL ROW BEFORE THE NEW ONE OPENS, so a window's total is durable
 * even if the group never sees another attempt after the boundary.
 */
export function recordPreAuthEvidence(
  state: PreAuthEvidenceState,
  key: PreAuthEvidenceKey,
  nowMs: number,
): readonly PreAuthEvidenceSummary[] {
  const text = preAuthEvidenceKeyText(key);
  const currentWindow = windowStart(nowMs, PRE_AUTH_EVIDENCE_WINDOW_MS);
  const due: PreAuthEvidenceSummary[] = [];
  const existing = state.get(text);

  if (existing !== undefined && existing.windowStartMs !== currentWindow) {
    if (existing.attemptCount > existing.emittedAtCount) {
      due.push({
        key,
        windowStartMs: existing.windowStartMs,
        emissionSequence: existing.emissionCount,
        firstAttemptAtMs: existing.firstAttemptAtMs,
        lastAttemptAtMs: existing.lastAttemptAtMs,
        attemptCount: existing.attemptCount,
        windowClosed: true,
      });
    }
    state.delete(text);
  }

  const group = state.get(text) ?? {
    windowStartMs: currentWindow,
    firstAttemptAtMs: nowMs,
    lastAttemptAtMs: nowMs,
    attemptCount: 0,
    emittedAtCount: 0,
    emissionCount: 0,
    ladderIndex: 0,
  };
  group.attemptCount += 1;
  group.lastAttemptAtMs = nowMs;

  while (
    group.ladderIndex < EMISSION_LADDER.length &&
    group.attemptCount >= EMISSION_LADDER[group.ladderIndex]
  ) {
    group.ladderIndex += 1;
    due.push({
      key,
      windowStartMs: group.windowStartMs,
      emissionSequence: group.emissionCount,
      firstAttemptAtMs: group.firstAttemptAtMs,
      lastAttemptAtMs: group.lastAttemptAtMs,
      attemptCount: group.attemptCount,
      windowClosed: false,
    });
    group.emissionCount += 1;
    group.emittedAtCount = group.attemptCount;
  }

  state.set(text, group);

  if (group.emissionCount > MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW) {
    // Unreachable while the ladder has `EMISSION_LADDER.length` points and one close. Kept as an
    // assertion rather than a comment because the bound is what the row-write arithmetic in
    // `pre-auth-admission.ts` is computed from, and an arithmetic claim nobody checks is a
    // number that drifts.
    throw new Error(
      `A pre-authentication evidence group emitted ${String(group.emissionCount)} summaries in ` +
        `one window; the bound is ${String(MAX_PRE_AUTH_WRITES_PER_GROUP_WINDOW)}.`,
    );
  }
  return due;
}
