/**
 * ===========================================================================================
 * WHEN THE AUTHORIZED BUSINESS SET CANNOT BE READ. `docs/decisions/0020`, diagnosability.
 * ===========================================================================================
 *
 * THE FOURTH ANNOUNCER, AND IT EXISTS BECAUSE THE THIRD ONE'S ABSENCE COST AN HOUR. On
 * 2026-09-05, against the first real deployment, every read after Organization selection returned
 * `503 unavailable`. Login worked, the picker worked, selection worked, and the tenant resolver
 * worked. The cause was that the App's own migration had never been applied, so the `customer`
 * table did not exist — but `pipeline.ts` returned `unavailable()` with **no internal signal at
 * all**, so the 503 was indistinguishable from a resolver failure, a directory failure, an
 * inactive mapping and an unknown binding, **in the logs as well as at the wire.**
 *
 * ===========================================================================================
 * COLLAPSING AT THE WIRE IS A SECURITY PROPERTY. COLLAPSING IN THE LOGS IS THE ABSENCE OF ONE.
 * ===========================================================================================
 *
 * `tenancy/directory-tenant-store-resolver.ts` deliberately answers `unavailable()` for five
 * distinct causes so that a caller cannot tell "the control plane is down" from "you have no
 * mapping". That is correct and this file does not touch it: **the response stays byte-identical
 * and is asserted to.**
 *
 * What the platform already does everywhere else is keep the caller's answer uninformative while
 * letting an operator see the cause — `announceAuditFailure`, `announcePreAuthFailure` and
 * `announceCoordinationFailure` all exist for exactly that. The authorized-business-set read was
 * the one degradable control with no such channel. This is that channel, built to the same shape
 * so a reader who knows one knows all four.
 *
 * ===========================================================================================
 * WHAT IT MAY CARRY, AND WHAT IT MAY NOT
 * ===========================================================================================
 *
 * `organizationId` — the AUTHENTICATED Organization, server-derived, already carried by
 * `COORDINATION_FAILURE_MARKER` for the same reason: without it an operator cannot tell whether
 * one tenant is broken or the platform is.
 *
 * `errorCode` — a value from Core's own closed error taxonomy (`kernel/errors.ts`). Internal, not
 * caller-supplied.
 *
 * **NOTHING THE CALLER SUPPLIED, EVER.** No requested identifier, no path, no query string, no
 * body field, no header. `0013` control 5's argument applies here as much as to a denial group
 * key: a caller-controlled value in a log line is an unbounded, attacker-chosen write into a
 * store with different access rules. The type below has no field one could arrive through, which
 * is the same device every other announcer in this codebase uses.
 *
 * PER-OCCURRENCE, NOT DAMPENED. Under a D1 outage this is one line per failed request, which is
 * the correct volume — it is a real outage and its shape is what an operator needs to see. It
 * matches `announceCoordinationFailure`, which is also per-occurrence for the same reason.
 * (`announcePreAuthFailure` dampens only its CONFIGURATION causes, which are facts about a
 * deployment rather than about a request; this has none of those.)
 */

import type { ErrorCode } from '../kernel/errors.ts';

/**
 * Why the set could not be read.
 *
 * ONE VALUE TODAY, AND THE UNION EXISTS SO A SECOND IS A DELIBERATE ADDITION. `0020` gives
 * `pipeline.ts` exactly one branch that can fail this way; the Team Lead's instruction for this
 * change was one branch, one marker, and extending it to the resolver's five conditions is a
 * separate decision with its own argument.
 */
export type BusinessSetFailureCause = 'business_set_read_failed';

export type BusinessSetFailure = {
  /** The authenticated Organization. Server-derived; never a value from the request. */
  readonly organizationId: string;
  readonly cause: BusinessSetFailureCause;
  /** Core's own taxonomy code for the underlying failure. Internal, never caller-supplied. */
  readonly errorCode: ErrorCode;
};

export type BusinessSetFailureReporter = {
  report(failure: BusinessSetFailure): void;
};

/**
 * The grep and alert target. Stable, and deliberately a token rather than a prose sentence: an
 * operator alert is configured against this string, so changing it breaks somebody's monitoring.
 *
 * IT IS IMMEDIATELY USEFUL EVEN THOUGH `observability` IS DISABLED IN `wrangler.jsonc`. Workers
 * Logs is off pending the free-tier impact check `.claude/rules/architecture.md` §6a requires
 * before enabling a service, so there is no log SINK — but `wrangler tail` streams console output
 * live regardless, which is how the 2026-09-05 outage was diagnosed in the first place.
 */
export const BUSINESS_SET_FAILURE_MARKER = 'dudo.tenancy.business_set_unreadable';

/**
 * The floor. Not injectable, not disableable, reached before any supplied reporter.
 *
 * `console` is read off `globalThis` rather than imported, because Core may not name a runtime:
 * the same expression works under a Worker, under Node and under a harness, and evaluates to
 * `undefined` rather than throwing where it is absent (`CLOUDFLARE_STANDARD.md` §2).
 */
function emitLastResort(failure: BusinessSetFailure): void {
  const sink = (globalThis as { console?: { error?: (...values: readonly unknown[]) => void } })
    .console;
  if (sink === undefined || typeof sink.error !== 'function') {
    return;
  }
  sink.error(
    `${BUSINESS_SET_FAILURE_MARKER} ${JSON.stringify({
      organization_id: failure.organizationId,
      cause: failure.cause,
      error_code: failure.errorCode,
    })}`,
  );
}

/**
 * Announce that the authorized business set could not be read.
 *
 * NEVER THROWS, AND NEVER CHANGES THE ANSWER. Its caller has already decided to refuse the
 * request; a response that varied depending on whether the announcement succeeded would be a
 * channel, and a throwing reporter must not turn a 503 into a 500.
 */
export function announceBusinessSetFailure(
  failure: BusinessSetFailure,
  reporter: BusinessSetFailureReporter | undefined,
): void {
  emitLastResort(failure);
  if (reporter === undefined) {
    return;
  }
  try {
    reporter.report(failure);
  } catch {
    // The floor already emitted. A defective reporter cannot suppress the notice.
  }
}
