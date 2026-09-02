/**
 * WHAT HAPPENS WHEN THE COORDINATOR CANNOT DO ITS JOB.
 *
 * `audit-failure.ts` is the same file for per-event audit records, and its argument carries
 * over unchanged: an unwritten record is not a degraded record, it is the ABSENCE of the
 * evidence the control exists to produce, and the attacker's run continues either way. So the
 * loss must be announced, and there must be no configuration that turns the announcement off.
 *
 * THIS IS A SEPARATE CHANNEL FROM `AUDIT_FAILURE_MARKER` BECAUSE THE TWO LOSSES ARE DIFFERENT
 * FACTS. A lost `audit_event` row is one event that will never be recoverable. A lost denial
 * summary may be a count that is merely late — the coordinator keeps counting, and the next
 * emission for the same window carries the accumulated total. An operator who cannot tell
 * those apart will either over-react to the second or under-react to the first. Separate
 * markers, separate alerts.
 *
 * ===========================================================================================
 * FOUR CAUSES, AND ONLY ONE OF THEM IS AN OUTAGE
 * ===========================================================================================
 *
 *   coordinator_unreachable  `begin()` failed or threw. The request proceeded in DEGRADED mode
 *                            (`action/pipeline.ts`): nothing that would WRITE was permitted,
 *                            because with the limiter unavailable there is nothing bounding
 *                            what a caller could spend. This is the one that means something
 *                            is broken.
 *   record_failed            The denial was decided but could not be counted. Evidence lost.
 *   summary_write_failed     Summaries were due but the D1 write did not commit. Evidence lost;
 *                            the counts stay in the coordinator and the next emission carries
 *                            them.
 *   ceiling_reached          A daily ceiling refused the write (0013 control 9). NOT a fault —
 *                            it is the control working, and it means security evidence has
 *                            started being dropped so that Customer and Business traffic keeps
 *                            its D1 capacity. It is announced because an operator alerting on
 *                            denial counts needs to know the counts have stopped being
 *                            complete.
 *
 * ===========================================================================================
 * WHAT A NOTICE CONTAINS, AND WHAT IT CANNOT
 * ===========================================================================================
 *
 * The acting Organization, the cause, and the grouping — actor, App, Action, denial category.
 * There is no field for the requested identifier, because the grouping has none (0013 control
 * 5) and this notice is built from the grouping. So a notice cannot leak a probed identifier
 * even by accident, which is a stronger property than `AuditFailure` has: that one deliberately
 * carries the caller's own supplied string because a per-event probe record is the whole point.
 *
 * THIS CHANNEL IS INTERNAL AND MUST NOT BECOME TENANT-VISIBLE. It names denial activity and
 * the internal state of a security control. Routing it anywhere a tenant can read — a response
 * body, an in-product activity feed, a tenant-scoped log surface — would tell a caller when
 * the evidence stopped being written, which is precisely when probing is cheapest.
 */

import type { DenialGroupKey } from '../protection/coordination.ts';

export type CoordinationFailureCause =
  | 'coordinator_unreachable'
  | 'record_failed'
  | 'summary_write_failed'
  | 'ceiling_reached';

export type CoordinationFailure = {
  /** The acting principal's Organization. */
  readonly organizationId: string;
  readonly cause: CoordinationFailureCause;
  /**
   * The grouping the loss relates to. Absent when the coordinator could not be reached at all,
   * because at that point no group has been decided.
   */
  readonly key: DenialGroupKey | null;
  /** How many summaries were lost or refused. Zero for `coordinator_unreachable`. */
  readonly lost: number;
};

export type CoordinationFailureReporter = {
  report(failure: CoordinationFailure): void;
};

/**
 * The grep target and the alert target. Stable, and deliberately not a prose sentence: an
 * operator alert is configured against this token, so changing it breaks somebody's monitoring.
 */
export const COORDINATION_FAILURE_MARKER = 'dudo.protection.coordination_failed';

/**
 * The floor. Not injectable, not disableable, reached before any supplied reporter.
 *
 * `console` is read off `globalThis` rather than imported, because Core may not name a runtime:
 * the same expression works under a Worker, under Node and under a harness, and evaluates to
 * `undefined` rather than throwing where it is absent (CLOUDFLARE_STANDARD.md §2).
 */
function emitLastResort(failure: CoordinationFailure): void {
  const sink = (globalThis as { console?: { error?: (...values: readonly unknown[]) => void } })
    .console;
  if (sink === undefined || typeof sink.error !== 'function') {
    return;
  }
  sink.error(`${COORDINATION_FAILURE_MARKER} ${JSON.stringify(describe(failure))}`);
}

/**
 * The wire form. Named fields rather than a spread, so a field added to `DenialGroupKey` later
 * has to be added here on purpose to be emitted.
 */
function describe(failure: CoordinationFailure): Record<string, unknown> {
  const { key } = failure;
  return {
    organization_id: failure.organizationId,
    cause: failure.cause,
    lost: failure.lost,
    app_id: key === null ? null : key.appId,
    action_id: key === null ? null : key.actionId,
    principal_id: key === null ? null : key.principalId,
    denial_reason: key === null ? null : key.category,
  };
}

/**
 * Announce a coordination failure.
 *
 * NEVER THROWS. Its caller is on a request path whose answer is already decided and must not
 * change — a response that varied when the coordinator was unhappy would be a channel a caller
 * could learn to open, on exactly the path the indistinguishability requirement protects.
 */
export function announceCoordinationFailure(
  failure: CoordinationFailure,
  reporter: CoordinationFailureReporter | undefined,
): void {
  try {
    emitLastResort(failure);
  } catch {
    // Nothing further is available. Swallowing here is the end of the line, not a policy
    // choice: the alternative is throwing into a request whose answer is already fixed.
  }
  if (reporter === undefined) {
    return;
  }
  try {
    reporter.report(failure);
  } catch {
    // The floor already emitted. A defective reporter cannot suppress the notice and cannot
    // reach the caller.
  }
}
