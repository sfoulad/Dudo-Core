/**
 * The denial-summary sink, backed by the tenant-scoped storage boundary.
 *
 * Mirrors `store-audit-sink.ts` deliberately: the summary is written through the SAME
 * `TenantScopedStore` the request resolved, so `tenant_id` is set by the boundary from the
 * authenticated handle and this file has no value to set it with even if it wanted one.
 *
 * ===========================================================================================
 * WHY `denial_summary` IS A SECOND TABLE AND NOT MORE COLUMNS ON `audit_event`
 * ===========================================================================================
 *
 * `audit_event` means ONE ROW PER EVENT. Every query, index and assertion built on it depends
 * on that: `audit_event_by_tenant_target` answers "what happened to this record", the oracle
 * comparison compares two records field for field, and `target_resource_id` is the identifier
 * of the one record the one event touched.
 *
 * A summary is a different thing: one row per (actor, Action, category, 15-minute window),
 * carrying a COUNT and NO target identifier at all. Folding it into `audit_event` would mean
 * either adding nullable count columns — after which "one row is one event" is false and every
 * existing reader has to learn which kind of row it is holding — or dropping the count, which
 * is the whole content of a summary. Two tables keep both readable, and keep `audit_event`
 * exactly as it was for the successes and the mutating Actions that still write per-event rows.
 *
 * ===========================================================================================
 * WHAT A SUMMARY ROW DISCLOSES, WHICH IS LESS THAN THE PER-ATTEMPT ROWS IT REPLACES
 * ===========================================================================================
 *
 * `SECURITY_STANDARD.md` §6 lets a tenant read its own audit trail, so this table is a channel
 * back to the caller and has to be reasoned about as one. It is strictly narrower than what it
 * replaces:
 *
 *   - THERE IS NO `target_resource_id`. The identifier the caller typed is not recorded at all,
 *     which is control 5's consequence rather than an omission. A probing campaign can no
 *     longer read back the list of identifiers it tried.
 *   - THE CATEGORY IS THE CORE-WIDE `denial_reason` TOKEN, unchanged. `not_found` covers both
 *     "in another Organization" and "nowhere", so the existence oracle the per-event records
 *     were carefully shaped to close cannot reopen here: there is no field that distinguishes
 *     them, and the two attempts land in the SAME group and increment the SAME count.
 *   - `actor_business_ids` is the CALLER's own authorized set, never the target's, and there is
 *     no column that could hold the target's — the same pairing as `audit_event`.
 *
 * WHAT IS LOST, STATED PLAINLY BECAUSE IT IS A REAL COST. A denial no longer names the
 * identifier that was attempted, so `audit_event_by_tenant_target` — "what happened to this
 * record" — now answers only for SUCCESSFUL operations and for the mutating Actions' allowed
 * events. That conflicts with the Customer Directory contract's CD-5 obligation to record "the
 * identifier AS SUPPLIED BY THE CALLER, marked unresolved" on a `not_found`. `docs/decisions/
 * 0013` is the later, Accepted, user decision and supersedes it; the conflict is REPORTED to
 * the Team Lead rather than resolved here, because contracts are not this agent's to author.
 */

import type { DenialSummary } from '../protection/coordination.ts';
import { assertDenialGroupKey } from '../protection/coordination.ts';
import type { TenantScopedStore, WriteOperation } from '../storage/store.ts';
import type { Result } from '../kernel/result.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { WriteReservation } from '../protection/write-admission.ts';

export const DENIAL_SUMMARY_TABLE = 'denial_summary';

export type DenialSummarySink = {
  operation(summary: DenialSummary): WriteOperation;
  /**
   * `reservation` covers these summaries and comes from the coordinator that produced them
   * (`DenialRecordOutcome.reservation`), drawn from the `security` allocation of the one daily
   * ledger (docs/decisions/0014 §A.5). Evidence is accounted in the same unit, against the same
   * 80,000, as every business mutation — which is the difference between an allocation and a
   * second budget that happens to sit next to the first.
   */
  write(
    summaries: readonly DenialSummary[],
    reservation: WriteReservation,
  ): Promise<Result<void>>;
};

export function createStoreDenialSummarySink(
  store: TenantScopedStore,
  ids: IdGenerator,
): DenialSummarySink {
  function toOperation(summary: DenialSummary): WriteOperation {
    // The runtime half of the control-5 guard. A grouping that did not come from
    // `deriveDenialGroupKey` is the one route by which the caller-controlled identifier could
    // have entered the key, so it stops the write rather than being found in the table.
    assertDenialGroupKey(summary.key);

    return {
      kind: 'insert',
      spec: {
        table: DENIAL_SUMMARY_TABLE,
        values: {
          // DERIVED, NOT RANDOM, and the difference matters. The identity of a summary row is
          // its grouping plus its window plus which emission it is, so re-emitting the same
          // progress row twice — a retry, a replayed message — collides on the primary key and
          // is rejected rather than silently doubling a campaign's apparent size. A random id
          // would make the table quietly non-idempotent.
          //
          // The generator is still taken as a dependency so this sink's shape matches
          // `createStoreAuditSink`, whose rows genuinely need one.
          denial_summary_id: [
            summary.key.principalId,
            summary.key.appId,
            summary.key.actionId,
            summary.key.category,
            String(summary.windowStartMs),
            String(summary.emissionSequence),
          ].join('.'),
          emission_sequence: summary.emissionSequence,
          window_start_at: toRfc3339Utc(summary.windowStartMs),
          first_attempt_at: toRfc3339Utc(summary.firstAttemptAtMs),
          last_attempt_at: toRfc3339Utc(summary.lastAttemptAtMs),
          attempt_count: summary.attemptCount,
          window_closed: summary.windowClosed ? 1 : 0,
          app_id: summary.key.appId,
          action_id: summary.key.actionId,
          principal_id: summary.key.principalId,
          denial_reason: summary.key.category,
          permission_id: summary.permissionId,
          scope: summary.scope,
          actor_business_ids: JSON.stringify(summary.actorBusinessIds),
        },
      },
    };
  }

  return {
    operation(summary: DenialSummary): WriteOperation {
      return toOperation(summary);
    },
    async write(
      summaries: readonly DenialSummary[],
      reservation: WriteReservation,
    ): Promise<Result<void>> {
      return store.write(summaries.map(toOperation), reservation);
    },
  };
}
