/**
 * WHAT HAPPENS WHEN THE AUDIT RECORD CANNOT BE WRITTEN.
 *
 * The probe-detection control (user decision, 2026-09-02: "Audit every denied GetCustomer
 * read attempt, including cross-tenant probing") is only a control if the record actually
 * lands. An unwritten audit record is not a degraded record — it is the absence of the
 * evidence the control exists to produce, and the attacker's run continues either way.
 *
 * So: THE AUDIT EVENT MUST NOT FAIL OPEN.
 *
 * ===========================================================================================
 * WHAT "MUST NOT FAIL OPEN" CANNOT MEAN HERE, AND WHY
 * ===========================================================================================
 *
 * The obvious reading — refuse the request when the evidence cannot be written — is WRONG on
 * this path, and it is wrong for a security reason rather than an availability one.
 *
 * The denial being audited is, in the cross-tenant case, a `not_found`. That `not_found` is
 * required to be byte-identical to the `not_found` for an identifier that exists nowhere
 * (MULTITENANCY_STANDARD.md §5; contract authorizationModel.notFoundVersusForbidden.
 * indistinguishability). Turning an audit-write failure into a different response would make
 * the response depend on something other than the request — and any response that varies for
 * a reason the caller can influence is a channel. A caller who could push the audit table
 * into failure would then be able to tell a `not_found` apart from an `internal`, on demand,
 * on exactly the path the indistinguishability requirement protects.
 *
 * THEREFORE the response is unchanged: the caller still receives the same `not_found`, with
 * the same body, the same length and the same headers. What changes is that the failure
 * STOPS BEING SILENT.
 *
 * ===========================================================================================
 * THE GUARANTEE THIS FILE MAKES
 * ===========================================================================================
 *
 * Every failure to write a required audit record emits an internal failure notice, and there
 * is NO CONFIGURATION THAT TURNS THAT OFF.
 *
 *   - The last-resort emitter below is UNCONDITIONAL and NOT INJECTABLE. It runs first, on
 *     every failure, before any supplied reporter is consulted.
 *   - `AuditFailureReporter` is therefore ADDITIVE ONLY. A composition root can add a
 *     destination; it cannot remove one, cannot replace the floor, and cannot suppress it by
 *     omitting the dependency. A missing reporter, an undefined reporter and a reporter that
 *     throws all produce the same outcome as a working one: the notice is still emitted.
 *   - Every call is individually guarded. A broken reporter cannot throw into the request
 *     path and so cannot change the response — which is the same indistinguishability
 *     argument as above, arriving from the other direction.
 *
 * That is the honest description of the control: Dudo cannot guarantee the record is
 * DURABLE — the database it lives in is the thing that just failed — but it can guarantee
 * that the loss is ANNOUNCED rather than absorbed. An operator alerting on a run of denials
 * (`audit_event_by_tenant_principal_decision_time`) needs to know when the count they are
 * alerting on stopped being trustworthy.
 *
 * ===========================================================================================
 * WHAT A FAILURE NOTICE CONTAINS
 * ===========================================================================================
 *
 * The `AuditEntry` that failed, verbatim, plus the acting Organization and the cause.
 *
 * Carrying `AuditEntry` rather than an ad-hoc shape is deliberate. `AuditEntry` has no field
 * that can hold a business value (audit.ts) — no payload, no diff, no free-text message —
 * so the notice inherits that property structurally instead of restating it as a rule. In
 * particular the requested customer identifier travels (it is the caller's own string, and
 * it is the whole point of a probe record), and NOTHING RESOLVED FROM A FOREIGN ROW travels,
 * because nothing was ever resolved: on the cross-tenant path the storage boundary filtered
 * the row out before any code here could see it.
 *
 * `organizationId` is added because the audit ROW would have carried the tenant implicitly —
 * the storage boundary sets `tenant_id` from the handle — and that row is precisely what did
 * not get written. Without it the notice would be evidence of an attack on nobody.
 *
 * ===========================================================================================
 * THIS CHANNEL IS INTERNAL. IT IS NOT TENANT-VISIBLE, AND MUST NOT BECOME SO.
 * ===========================================================================================
 *
 * The notice names an internal denial reason and, on a cross-tenant probe, an identifier the
 * caller supplied for another Organization's record. That is security evidence for a Dudo
 * operator. Routing it to anything a tenant can read — an API response, an in-product
 * activity feed, a tenant-scoped log surface, an error body — would hand the caller the
 * existence signal the `not_found` withheld. Any future `AuditFailureReporter` implementation
 * must be reviewed against that sentence.
 */

import type { AuditEntry } from './audit.ts';

/** Why the required record did not land. A code, never a sentence, never an engine message. */
export type AuditFailureCause =
  /** The storage boundary returned an error. The batch did not commit. */
  | 'write_rejected'
  /** The write threw. A defect, a guard trip, or an engine fault below the boundary. */
  | 'write_threw';

export type AuditFailure = {
  /** The acting principal's Organization — the tenant the missing row belonged in. */
  readonly organizationId: string;
  readonly cause: AuditFailureCause;
  /** The entry that was owed. Identifiers and decisions only, by construction. */
  readonly entry: AuditEntry;
};

/**
 * An ADDITIONAL destination for failure notices. Never the only one; see the file header.
 *
 * `report` returns void and is expected not to throw. If it throws it is caught and the
 * floor below has already emitted, so a defect here degrades observability and nothing else.
 */
export type AuditFailureReporter = {
  report(failure: AuditFailure): void;
};

/**
 * The grep target and the alert target. Stable, and deliberately not a prose sentence:
 * an operator alert is configured against this token, so changing it is a breaking change
 * to someone's monitoring.
 */
export const AUDIT_FAILURE_MARKER = 'dudo.audit.write_failed';

/**
 * The floor. Not injectable, not disableable, and reached before any supplied reporter.
 *
 * `console` is read off `globalThis` rather than imported or ambiently declared, because
 * Core may not name a runtime: the same expression works under a Worker, under Node and
 * under a harness, and evaluates to `undefined` rather than throwing where it is absent.
 * Nothing about this is Cloudflare-specific and nothing here is a dependency
 * (CLOUDFLARE_STANDARD.md §2 — no vendor type appears in domain logic).
 */
function emitLastResort(failure: AuditFailure): void {
  const sink = (globalThis as { console?: { error?: (...values: readonly unknown[]) => void } })
    .console;
  if (sink === undefined || typeof sink.error !== 'function') {
    return;
  }
  // One line, structured, machine-readable. `JSON.stringify` cannot throw on this shape —
  // every field is a string, a boolean, null or an array of strings — but the whole emission
  // is guarded by the caller anyway, because "cannot throw" is a claim with a shelf life.
  sink.error(`${AUDIT_FAILURE_MARKER} ${JSON.stringify(describe(failure))}`);
}

/**
 * The wire form of a notice. Named fields rather than a spread, so a field added to
 * `AuditEntry` in future has to be added here on purpose to be emitted.
 */
function describe(failure: AuditFailure): Record<string, unknown> {
  const { entry } = failure;
  return {
    organization_id: failure.organizationId,
    cause: failure.cause,
    app_id: entry.appId,
    action_id: entry.actionId,
    principal_id: entry.principalId,
    principal_type: entry.principalType,
    on_behalf_of_principal_id: entry.onBehalfOfPrincipalId,
    permission_id: entry.permissionId,
    scope: entry.scope,
    decision: entry.decision,
    denial_reason: entry.denialReason,
    target_resource_id: entry.targetResourceId,
    target_unresolved: entry.targetUnresolved,
    request_id: entry.requestId,
    correlation_id: entry.correlationId,
    occurred_at: entry.occurredAt,
  };
}

/**
 * Announce a failure to write a required audit record.
 *
 * NEVER THROWS. The caller is on a request path whose response is already decided and must
 * not change; see the file header for why a varying response would be a disclosure channel.
 */
export function announceAuditFailure(
  failure: AuditFailure,
  reporter: AuditFailureReporter | undefined,
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
