/**
 * THE DURABLE OBJECT ADAPTER. The only file in `platform/core/**` that names a Durable Object.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place `DurableObjectNamespace` and
 * friends may be named, and the check is a grep over the domain modules that must come back
 * empty. That grep passes only if this file is the whole exception, so nothing DO-shaped
 * leaves it: the factory below returns a `RequestCoordinator`, which is a Core type describing
 * admission and denial counting in domain terms.
 *
 * THE BINDING TYPES ARE DECLARED HERE RATHER THAN IMPORTED, exactly as `d1-store.ts` does and
 * for the same reason: `@cloudflare/workers-types` is an npm package and ADR 0003 approves no
 * npm package. The structural interfaces below describe precisely the calls this adapter makes.
 *
 * ===========================================================================================
 * §7 JUSTIFICATION, WHICH THE STANDARD REQUIRES IN WRITING BEFORE A DURABLE OBJECT EXISTS
 * ===========================================================================================
 *
 * 1. WHAT IS SERIALIZED, AND WHY CORRECTNESS FAILS WITHOUT IT. A rate limit and a denial
 *    counter are cross-request state. A Worker isolate is per-request and there are many of
 *    them, so a counter held anywhere else is a counter divided by a number nobody controls —
 *    which is not a limit. `docs/decisions/0013` names a SQLite-backed Durable Object for this.
 * 2. WHY NOT A DATABASE CONSTRAINT, AN IDEMPOTENCY KEY, OR A QUEUE. A constraint cannot count.
 *    An idempotency key answers "have I seen this request", not "how many has this actor made".
 *    A queue is asynchronous, and a limiter that answers after the work has happened has not
 *    limited anything. And the whole point of 0013 is to stop counting in D1: a D1-backed
 *    counter would put a write on every request against the exact allowance being protected.
 * 3. TENANT SCOPE. One instance per Organization, named from the AUTHENTICATED context. An
 *    instance holds one Organization's counters and has no second tenant's data to confuse
 *    them with. The one exception is the platform ledger — see `LEDGER_INSTANCE` below, which
 *    holds a UTC day and an integer and no tenant identifier of any kind.
 * 4. FAILURE BEHAVIOUR AND COST. Failure is handled by the caller, not here: `pipeline.ts`
 *    degrades to read-only and announces, and never widens access. Cost is measured in the
 *    accounting block below rather than asserted.
 *
 * ===========================================================================================
 * FREE-TIER ACCOUNTING. Verified against `durable-objects/platform/pricing/` on 2026-09-02.
 * ===========================================================================================
 *
 * Workers Free, SQLite-backed only (KV-backed requires a paid plan and is prohibited by 0008):
 * **100,000 requests/day · 13,000 GB-s/day · 5,000,000 rows read/day · 100,000 rows
 * written/day · 5 GB stored.** Daily limits reset at 00:00 UTC, and Cloudflare's words on
 * exhaustion are: *"If you exceed any one of the free tier limits, further operations of that
 * type will fail with an error."*
 *
 * REQUESTS — the tightest of the three that scale with traffic.
 *   allowed request : 1 (admission)
 *   denied request  : 2 (admission, then the denial count)
 *   plus, amortised : ~0.04 per request for the cross-Organization source report (one on the
 *                     first request of each 60-second window per address, then one per
 *                     SOURCE_REPORT_INTERVAL), and a few hundred a day account-wide for the
 *                     summary-write ledger.
 * Cloudflare's own framing of the free tier is "every Worker request able to call a Durable
 * Object", i.e. one DO request per Worker request. So ordinary traffic exhausts DO requests and
 * Worker requests together at 100,000/day, and **a campaign in which every request is denied
 * exhausts DO requests at 50,000 Worker requests — half the Workers allowance.** That is stated
 * plainly because it is the honest answer: the DO allowance becomes the binding constraint
 * under attack. It can be halved again by moving to an RPC session (`RpcTarget` on a class
 * extending `DurableObject`, where "subsequent calls on the returned stub are part of the same
 * RPC session and are not billed as separate requests") — the `RequestCoordination` handle is
 * shaped for exactly that. It is not done here because it requires importing
 * `cloudflare:workers`, which this repository cannot load, type-check or execute, and an
 * unverifiable optimisation is not worth a verified accounting.
 *
 * ROWS WRITTEN — deliberately decoupled from request volume, because this allowance is 100,000
 * per day, the SAME number as D1's, and a coordinator that wrote per request would have moved
 * the exhaustible resource rather than removed it.
 *   ordinary traffic       : ZERO. Counters live in instance memory; nothing is persisted
 *                            until a subject is actually over its limit.
 *   throttled actor        : <= 3 rows per 60-second window (one per level, once each)
 *                            = <= 4,320/day for one attacking actor.
 *   denial aggregation     : <= 6 rows per group per 15-minute window, which is the same
 *                            emission ladder the D1 summaries follow.
 *
 * ROWS READ — on cold start only, to rehydrate. Negligible against 5,000,000/day.
 *
 * DURATION — 13,000 GB-s/day, and THIS IS THE ONE TO WATCH. A DO is billed for wall-clock time
 * while it is actively running. At 128 MB an object that is kept continuously active consumes
 * 86,400 s x 0.125 GB = 10,800 GB-s/day, about 83% of the daily allowance, so **a single
 * Organization under sustained attack can approach the whole platform's DO duration budget, and
 * two such Organizations exceed it.** This is a PROJECTION from the published billing model,
 * not a measurement: it depends on hibernation-eligibility semantics that cannot be observed
 * from this repository, which has no Cloudflare runtime. It must be measured before this is
 * relied upon.
 *
 * ===========================================================================================
 * NOTHING IN THIS FILE HAS BEEN EXECUTED.
 * ===========================================================================================
 *
 * There is no Worker configuration in this repository (`CLOUDFLARE_STANDARD.md` §9 — Worker
 * configuration is the Team Lead's), no `new_sqlite_classes` migration, no runtime, and no
 * approved test framework. The ALGORITHM this file wraps is in `../../coordination-engine.ts`
 * and is exercised directly by the verification harness; what is unverified is this shell —
 * the SQL, the hydration, and the namespace plumbing. Reported as unverified rather than
 * described as done.
 */

import type {
  CoordinatedRequest,
  DenialContext,
  DenialGroupKey,
  DenialRecordOutcome,
  RequestCoordination,
  RequestCoordinator,
  SummaryWriteBudget,
} from '../../coordination.ts';
import {
  DAY_MS,
  PLATFORM_DAILY_SUMMARY_WRITES,
  denialGroupKeyFromText,
  windowStart,
} from '../../coordination.ts';
import type { CoordinationState, DenialGroupState } from '../../coordination-engine.ts';
import {
  admit,
  applySourceTotal,
  createCoordinationState,
  creditPermits,
  permitsToBuy,
  recordDenial,
  sourceBlocked,
  sourceRetryAfterSeconds,
  sweepClosedWindows,
} from '../../coordination-engine.ts';
import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { unavailable } from '../../../kernel/errors.ts';

// =============================================================================================
// The binding surface, declared structurally. See the file header for why it is not imported.
// =============================================================================================

export type SqlRow = Record<string, string | number | null>;

export type SqlStorage = {
  exec(query: string, ...bindings: readonly (string | number | null)[]): {
    toArray(): SqlRow[];
  };
};

export type DurableObjectStorage = { readonly sql: SqlStorage };
export type DurableObjectContext = { readonly storage: DurableObjectStorage };

export type DurableObjectStub = {
  fetch(input: string, init?: { method?: string; body?: string }): Promise<{
    ok: boolean;
    json(): Promise<unknown>;
  }>;
};

export type DurableObjectNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
};

/**
 * The instance that holds the PLATFORM-WIDE daily summary-write ceiling.
 *
 * One instance, account-wide, and it is the single piece of coordination state that is not
 * per-Organization. `CLOUDFLARE_STANDARD.md` §7 rule 3 says a DO instance belongs to exactly
 * one tenant, and that rule exists so two tenants' DATA does not share an instance. This one
 * holds a UTC day and an integer; no tenant identifier reaches it, and there is no column it
 * could reach. The tension is narrow but real, and it is REPORTED to the Team Lead rather than
 * resolved unilaterally — a per-Organization ceiling cannot reserve an ACCOUNT-WIDE D1
 * allowance, because the account total would be the per-tenant number times a tenant count
 * nobody bounds.
 *
 * IT IS NOT A BOTTLENECK. It is consulted only when a block of permits is bought, which is at
 * most `PLATFORM_DAILY_SUMMARY_WRITES / PERMIT_BLOCK` times a day across the whole account —
 * about 156 — plus ONE refusal per Organization per day, because an Organization that is told
 * the budget is spent records that and stops asking (`CoordinationState.
 * platformExhaustedDayStartMs`). Without that last part a broad campaign would turn a spent
 * budget into tens of thousands of extra coordinator requests against an allowance that is
 * itself exhaustible, which would be the control funding its own denial of service.
 */
export const LEDGER_INSTANCE = 'platform-summary-write-ledger';

/** Instance naming. Derived from the AUTHENTICATED Organization and from nothing else. */
export function coordinatorInstanceName(organizationId: string): string {
  return `organization:${organizationId}`;
}

/**
 * The instances that hold the CROSS-ORGANIZATION source counters.
 *
 * SHARDED RATHER THAN ONE PER ADDRESS, and rather than one globally. One instance per address
 * would be an unbounded instance count and a second cold start on every new caller; one
 * instance globally would serialise every request in the platform through a single object.
 * 256 shards, keyed by the first byte of the address hash, gives a fixed instance count and
 * spreads the load without any of them ever holding a tenant identifier.
 *
 * THE SECOND §7 RULE-3 EXCEPTION, alongside the ledger, and the same reasoning: the rule exists
 * so two tenants' DATA does not share an instance, and what lives here is a hashed address, a
 * window and an integer. It cannot say which Organizations an address touched, because it is
 * never told. The consequence it DOES create — an availability coupling between Organizations
 * behind one NAT — is stated in `coordination.ts` and is inherent to address-based limiting.
 */
export function sourceShardInstanceName(sourceAddressHash: string): string {
  const shard = sourceAddressHash.length >= 2 ? sourceAddressHash.slice(0, 2) : '00';
  return `source-shard:${shard}`;
}

// =============================================================================================
// The Durable Object class
// =============================================================================================

const SCHEMA: readonly string[] = [
  // A subject that is over its limit for a window. Ordinary counting is never written here.
  'CREATE TABLE IF NOT EXISTS rate_block (subject TEXT PRIMARY KEY, window_start INTEGER NOT NULL)',
  // One row per denial group per window, rewritten at each emission point.
  `CREATE TABLE IF NOT EXISTS denial_group (
     group_key TEXT PRIMARY KEY,
     window_start INTEGER NOT NULL,
     first_at INTEGER NOT NULL,
     last_at INTEGER NOT NULL,
     attempt_count INTEGER NOT NULL,
     emitted_at_count INTEGER NOT NULL,
     emission_count INTEGER NOT NULL,
     ladder_index INTEGER NOT NULL,
     actor_business_ids TEXT NOT NULL,
     permission_id TEXT NOT NULL,
     scope TEXT NOT NULL
   )`,
  // The per-Organization daily summary ceiling, and the platform permits held locally.
  'CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY, day_start INTEGER NOT NULL, used INTEGER NOT NULL, permits INTEGER NOT NULL)',
  // The SOURCE-SHARD role: cross-Organization counts, keyed by hashed address and window.
  // No tenant identifier, no principal, no address in the clear.
  'CREATE TABLE IF NOT EXISTS source_count (source_hash TEXT NOT NULL, window_start INTEGER NOT NULL, total INTEGER NOT NULL, PRIMARY KEY (source_hash, window_start))',
];

/**
 * ONE class, TWO roles, chosen by instance name: an Organization coordinator, or the platform
 * ledger. They share a class because they share a storage shape and a daily-reset rule, and
 * because a second class means a second Worker-configuration migration for no behavioural
 * difference. An instance never plays both roles: the ledger instance is never asked to admit
 * a request, and an Organization instance is never asked for permits.
 */
export class DudoCoordinatorObject {
  private readonly sql: SqlStorage;
  private readonly env: unknown;
  private state: CoordinationState | null = null;
  /** The Organization this instance was first used for. Fixed on first use; see `bind`. */
  private organizationId: string | null = null;
  private ledgerDay = -1;
  private ledgerUsed = 0;
  private ledgerHydrated = false;

  constructor(ctx: DurableObjectContext, env: unknown) {
    this.sql = ctx.storage.sql;
    this.env = env;
    for (const statement of SCHEMA) {
      this.sql.exec(statement);
    }
  }

  /**
   * THE TENANT PIN. An instance is named for one Organization, and the first request it serves
   * fixes which one. A later request carrying a different Organization is a defect — an
   * instance-name derivation gone wrong, or a caller passing something other than the
   * authenticated context — and it is REFUSED rather than served, because serving it would file
   * one Organization's counters and evidence under another.
   */
  private bind(organizationId: string): boolean {
    if (this.organizationId === null) {
      this.organizationId = organizationId;
      return true;
    }
    return this.organizationId === organizationId;
  }

  private hydrate(): CoordinationState {
    if (this.state !== null) {
      return this.state;
    }
    const state = createCoordinationState();

    for (const row of this.sql.exec('SELECT subject, window_start FROM rate_block').toArray()) {
      // Rehydrated at its limit, not at its true count: what was persisted is the FACT that the
      // subject was over, and restoring it as "over" is the conservative direction.
      state.rate.set(String(row.subject), {
        windowStartMs: Number(row.window_start),
        count: Number.MAX_SAFE_INTEGER,
        exceededPersisted: true,
      });
    }

    for (const row of this.sql.exec('SELECT * FROM denial_group').toArray()) {
      const group: DenialGroupState = {
        windowStartMs: Number(row.window_start),
        firstAttemptAtMs: Number(row.first_at),
        lastAttemptAtMs: Number(row.last_at),
        attemptCount: Number(row.attempt_count),
        emittedAtCount: Number(row.emitted_at_count),
        emissionCount: Number(row.emission_count),
        ladderIndex: Number(row.ladder_index),
        context: {
          actorBusinessIds: parseStringArray(String(row.actor_business_ids)),
          permissionId: String(row.permission_id),
          scope: String(row.scope),
        },
      };
      state.groups.set(String(row.group_key), group);
    }

    const budget = this.sql.exec('SELECT day_start, used, permits FROM budget WHERE id = 1').toArray();
    if (budget.length === 1) {
      state.perOrganizationDay = {
        dayStartMs: Number(budget[0].day_start),
        used: Number(budget[0].used),
      };
      state.platformPermits = Number(budget[0].permits);
      state.platformPermitsDayStartMs = Number(budget[0].day_start);
    }

    this.state = state;
    return state;
  }

  private persistRate(state: CoordinationState, subjects: readonly string[]): void {
    for (const subject of subjects) {
      const entry = state.rate.get(subject);
      if (entry === undefined) {
        continue;
      }
      this.sql.exec(
        'INSERT INTO rate_block (subject, window_start) VALUES (?, ?) ' +
          'ON CONFLICT(subject) DO UPDATE SET window_start = excluded.window_start',
        subject,
        entry.windowStartMs,
      );
    }
  }

  private persistGroups(state: CoordinationState, keys: readonly string[]): void {
    for (const key of keys) {
      const group = state.groups.get(key);
      if (group === undefined) {
        this.sql.exec('DELETE FROM denial_group WHERE group_key = ?', key);
        continue;
      }
      this.sql.exec(
        `INSERT INTO denial_group (
           group_key, window_start, first_at, last_at, attempt_count, emitted_at_count,
           emission_count, ladder_index, actor_business_ids, permission_id, scope
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(group_key) DO UPDATE SET
           window_start = excluded.window_start,
           first_at = excluded.first_at,
           last_at = excluded.last_at,
           attempt_count = excluded.attempt_count,
           emitted_at_count = excluded.emitted_at_count,
           emission_count = excluded.emission_count,
           ladder_index = excluded.ladder_index,
           actor_business_ids = excluded.actor_business_ids,
           permission_id = excluded.permission_id,
           scope = excluded.scope`,
        key,
        group.windowStartMs,
        group.firstAttemptAtMs,
        group.lastAttemptAtMs,
        group.attemptCount,
        group.emittedAtCount,
        group.emissionCount,
        group.ladderIndex,
        JSON.stringify(group.context.actorBusinessIds),
        group.context.permissionId,
        group.context.scope,
      );
    }
  }

  private persistBudget(state: CoordinationState): void {
    this.sql.exec(
      'INSERT INTO budget (id, day_start, used, permits) VALUES (1, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET day_start = excluded.day_start, ' +
        'used = excluded.used, permits = excluded.permits',
      state.perOrganizationDay.dayStartMs,
      state.perOrganizationDay.used,
      state.platformPermits,
    );
  }

  /**
   * The transport. `fetch` rather than RPC because RPC needs `cloudflare:workers`, which this
   * repository cannot load — see the file header, which also states what that costs.
   */
  async fetch(request: { url: string; text(): Promise<string> }): Promise<Response> {
    const url = new URL(request.url);
    const body = JSON.parse(await request.text()) as Record<string, unknown>;

    if (url.pathname === '/admit') {
      return this.handleAdmit(body);
    }
    if (url.pathname === '/denial') {
      return this.handleDenial(body);
    }
    if (url.pathname === '/permits') {
      return this.handlePermits(body);
    }
    if (url.pathname === '/source') {
      return this.handleSourceCount(body);
    }
    return jsonResponse({ error: 'unknown_operation' }, 404);
  }

  private async handleAdmit(body: Record<string, unknown>): Promise<Response> {
    const organizationId = String(body.organizationId ?? '');
    if (!this.bind(organizationId)) {
      return jsonResponse({ error: 'organization_mismatch' }, 409);
    }
    const state = this.hydrate();
    const nowMs = Number(body.nowMs);
    const decision = admit(state, {
      organizationId,
      principalId: String(body.principalId ?? ''),
      sourceAddressHash: body.sourceAddressHash === null ? null : String(body.sourceAddressHash),
      nowMs,
    });
    if (decision.persist.length > 0) {
      this.persistRate(state, decision.persist);
    }

    // ---- The source level's follow-up, to a shard this Organization does not own.
    //
    // IT IS NOT A CALL PER REQUEST. The engine reports a delta on the first request of a window
    // and every SOURCE_REPORT_INTERVAL after, so the overhead is roughly 4% of requests rather
    // than 100% — which matters, because the coordinator's own request allowance is already the
    // binding constraint under attack.
    if (decision.sourceReport !== null) {
      const total = await this.reportSource(decision.sourceReport);
      if (total !== null) {
        applySourceTotal(
          state,
          decision.sourceReport.sourceAddressHash,
          decision.sourceReport.windowStartMs,
          total,
        );
      }
      // An unreachable shard does NOT block. The actor and Organization levels still bound
      // every request; see `applySourceTotal`.
    }

    let outcome = decision.outcome;
    let retryAfterSeconds = decision.retryAfterSeconds;
    if (outcome === 'admitted' && sourceBlocked(state, decision.sourceKey, nowMs)) {
      outcome = 'rate_limited';
      retryAfterSeconds = sourceRetryAfterSeconds(nowMs);
    }

    return jsonResponse({ outcome, retryAfterSeconds });
  }

  /** The SOURCE-SHARD role. Accumulates a cross-Organization count and returns the total. */
  private handleSourceCount(body: Record<string, unknown>): Response {
    const sourceHash = String(body.sourceAddressHash ?? '');
    const windowStartMs = Number(body.windowStartMs);
    const delta = Math.max(0, Number(body.delta));
    const rows = this.sql
      .exec(
        'SELECT total FROM source_count WHERE source_hash = ? AND window_start = ?',
        sourceHash,
        windowStartMs,
      )
      .toArray();
    const total = (rows.length === 1 ? Number(rows[0].total) : 0) + delta;
    this.sql.exec(
      'INSERT INTO source_count (source_hash, window_start, total) VALUES (?, ?, ?) ' +
        'ON CONFLICT(source_hash, window_start) DO UPDATE SET total = excluded.total',
      sourceHash,
      windowStartMs,
      total,
    );
    // Old windows are dropped so the shard does not grow without bound. A delete is billed as a
    // row written, so it is bounded to the same call that already wrote one.
    this.sql.exec(
      'DELETE FROM source_count WHERE window_start < ?',
      windowStartMs - 5 * 60 * 1000,
    );
    return jsonResponse({ total });
  }

  private async reportSource(report: {
    sourceAddressHash: string;
    windowStartMs: number;
    delta: number;
  }): Promise<number | null> {
    const namespace = (this.env as { COORDINATION?: DurableObjectNamespace }).COORDINATION;
    if (namespace === undefined) {
      return null;
    }
    try {
      const instance = sourceShardInstanceName(report.sourceAddressHash);
      const stub = namespace.get(namespace.idFromName(instance));
      const response = await stub.fetch('https://coordination.invalid/source', {
        method: 'POST',
        body: JSON.stringify(report),
      });
      if (!response.ok) {
        return null;
      }
      const parsed = (await response.json()) as { total?: unknown };
      return typeof parsed.total === 'number' ? parsed.total : null;
    } catch {
      return null;
    }
  }

  private async handleDenial(body: Record<string, unknown>): Promise<Response> {
    const organizationId = String(body.organizationId ?? '');
    if (!this.bind(organizationId)) {
      return jsonResponse({ error: 'organization_mismatch' }, 409);
    }
    const state = this.hydrate();
    const nowMs = Number(body.nowMs);
    const keyText = String(body.groupKey ?? '');
    const key = denialGroupKeyFromText(keyText);
    if (key === undefined || key.organizationId !== organizationId) {
      return jsonResponse({ error: 'organization_mismatch' }, 409);
    }

    const wanted = permitsToBuy(state, nowMs);
    if (wanted > 0) {
      const granted = await this.buyPermits(windowStart(nowMs, DAY_MS), wanted);
      creditPermits(state, granted.permits, nowMs, granted.answered);
    }

    const context: DenialContext = {
      actorBusinessIds: parseStringArray(String(body.actorBusinessIds ?? '[]')),
      permissionId: String(body.permissionId ?? ''),
      scope: String(body.scope ?? ''),
    };
    const recorded = recordDenial(state, key, context, nowMs);
    const swept = sweepClosedWindows(state, denialGroupKeyFromText, nowMs);
    this.persistGroups(state, [...recorded.persist, ...swept.persist]);
    this.persistBudget(state);

    return jsonResponse({
      summaries: [...recorded.summaries, ...swept.summaries].map((summary) => ({
        groupKey: keyTextOf(summary.key),
        windowStartMs: summary.windowStartMs,
        emissionSequence: summary.emissionSequence,
        firstAttemptAtMs: summary.firstAttemptAtMs,
        lastAttemptAtMs: summary.lastAttemptAtMs,
        attemptCount: summary.attemptCount,
        actorBusinessIds: summary.actorBusinessIds,
        permissionId: summary.permissionId,
        scope: summary.scope,
        windowClosed: summary.windowClosed,
      })),
      suppressedByCeiling: recorded.suppressed + swept.suppressed,
    });
  }

  /** The LEDGER role. Grants permits against the platform-wide daily ceiling. */
  private handlePermits(body: Record<string, unknown>): Response {
    if (!this.ledgerHydrated) {
      const rows = this.sql.exec('SELECT day_start, used FROM budget WHERE id = 1').toArray();
      if (rows.length === 1) {
        this.ledgerDay = Number(rows[0].day_start);
        this.ledgerUsed = Number(rows[0].used);
      }
      this.ledgerHydrated = true;
    }
    const dayStartMs = Number(body.dayStartMs);
    const wanted = Math.max(0, Number(body.wanted));
    if (dayStartMs !== this.ledgerDay) {
      this.ledgerDay = dayStartMs;
      this.ledgerUsed = 0;
    }
    const granted = Math.max(0, Math.min(wanted, PLATFORM_DAILY_SUMMARY_WRITES - this.ledgerUsed));
    this.ledgerUsed += granted;
    this.sql.exec(
      'INSERT INTO budget (id, day_start, used, permits) VALUES (1, ?, ?, 0) ' +
        'ON CONFLICT(id) DO UPDATE SET day_start = excluded.day_start, used = excluded.used',
      this.ledgerDay,
      this.ledgerUsed,
    );
    return jsonResponse({ granted });
  }

  /**
   * `answered` separates "the ledger replied, and the reply was zero" from "the ledger could
   * not be reached". Only the first stops this instance asking again today; an unreachable
   * ledger must not suppress a day of evidence because of a blip.
   */
  private async buyPermits(
    dayStartMs: number,
    wanted: number,
  ): Promise<{ permits: number; answered: boolean }> {
    const namespace = (this.env as { COORDINATION?: DurableObjectNamespace }).COORDINATION;
    if (namespace === undefined) {
      // No ledger reachable: grant nothing. Summaries are then suppressed and announced —
      // evidence degrades, and nothing about access changes.
      return { permits: 0, answered: false };
    }
    try {
      const stub = namespace.get(namespace.idFromName(LEDGER_INSTANCE));
      const response = await stub.fetch('https://coordination.invalid/permits', {
        method: 'POST',
        body: JSON.stringify({ dayStartMs, wanted }),
      });
      if (!response.ok) {
        return { permits: 0, answered: false };
      }
      const parsed = (await response.json()) as { granted?: unknown };
      return {
        permits: typeof parsed.granted === 'number' ? parsed.granted : 0,
        answered: typeof parsed.granted === 'number',
      };
    } catch {
      return { permits: 0, answered: false };
    }
  }
}

function keyTextOf(key: DenialGroupKey): string {
  return [key.organizationId, key.principalId, key.appId, key.actionId, key.category].join(' ');
}

function parseStringArray(text: string): readonly string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// =============================================================================================
// The Core-facing factory
// =============================================================================================

/**
 * Builds a `RequestCoordinator` over a Durable Object namespace.
 *
 * The namespace is the ONLY Cloudflare value that crosses into this function, and nothing
 * DO-shaped comes back out: `pipeline.ts` sees a `RequestCoordinator` and a
 * `RequestCoordination` and could not name a Durable Object if it wanted to.
 */
export function createDurableObjectRequestCoordinator(
  namespace: DurableObjectNamespace,
): RequestCoordinator {
  async function call(
    instance: string,
    path: string,
    payload: unknown,
  ): Promise<Result<Record<string, unknown>>> {
    try {
      const stub = namespace.get(namespace.idFromName(instance));
      const response = await stub.fetch(`https://coordination.invalid${path}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return err(unavailable());
      }
      return ok((await response.json()) as Record<string, unknown>);
    } catch {
      return err(unavailable());
    }
  }

  return {
    async begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>> {
      const instance = coordinatorInstanceName(request.organizationId);
      const admitted = await call(instance, '/admit', {
        organizationId: request.organizationId,
        principalId: request.principalId,
        sourceAddressHash: request.sourceAddressHash,
        nowMs: request.nowMs,
      });
      if (!admitted.ok) {
        return admitted;
      }

      const outcome = admitted.value.outcome === 'rate_limited' ? 'rate_limited' : 'admitted';
      const retryAfterSeconds =
        typeof admitted.value.retryAfterSeconds === 'number'
          ? admitted.value.retryAfterSeconds
          : 0;

      return ok({
        outcome,
        retryAfterSeconds,

        async recordDenial(
          key: DenialGroupKey,
          context: DenialContext,
        ): Promise<Result<DenialRecordOutcome>> {
          // THE TENANT GUARD, on this side of the wire as well as inside the object. A key
          // naming another Organization never leaves the Worker.
          if (key.organizationId !== request.organizationId) {
            return err(unavailable());
          }
          const answered = await call(instance, '/denial', {
            organizationId: request.organizationId,
            groupKey: keyTextOf(key),
            actorBusinessIds: JSON.stringify(context.actorBusinessIds),
            permissionId: context.permissionId,
            scope: context.scope,
            nowMs: request.nowMs,
          });
          if (!answered.ok) {
            return answered;
          }
          const raw = Array.isArray(answered.value.summaries) ? answered.value.summaries : [];
          const summaries = raw.flatMap((entry) => {
            const record = entry as Record<string, unknown>;
            const summaryKey = denialGroupKeyFromText(String(record.groupKey ?? ''));
            if (summaryKey === undefined || summaryKey.organizationId !== request.organizationId) {
              // A summary that does not belong to this Organization is dropped rather than
              // written. An instance cannot hold another Organization's counters, so this
              // cannot happen without a defect — and a defect must not become a cross-tenant
              // write.
              return [];
            }
            return [
              {
                key: summaryKey,
                windowStartMs: Number(record.windowStartMs),
                emissionSequence: Number(record.emissionSequence),
                firstAttemptAtMs: Number(record.firstAttemptAtMs),
                lastAttemptAtMs: Number(record.lastAttemptAtMs),
                attemptCount: Number(record.attemptCount),
                actorBusinessIds: Array.isArray(record.actorBusinessIds)
                  ? record.actorBusinessIds.map((value) => String(value))
                  : [],
                permissionId: String(record.permissionId ?? ''),
                scope: String(record.scope ?? ''),
                windowClosed: record.windowClosed === true,
              },
            ];
          });
          return ok({
            summaries,
            suppressedByCeiling:
              typeof answered.value.suppressedByCeiling === 'number'
                ? answered.value.suppressedByCeiling
                : 0,
          });
        },

        dispose(): void {
          // Nothing to release: each interaction is its own stub call. When this moves to an
          // RPC session (see the file header) this is where the session is closed.
        },
      });
    },
  };
}

/**
 * The platform ledger as a Core port, for a caller that wants to read or reserve budget outside
 * a request. Unused by the pipeline — the Organization coordinator buys its own permits — and
 * present so the ceiling is reachable by name rather than only as a side effect.
 */
export function createDurableObjectSummaryWriteBudget(
  namespace: DurableObjectNamespace,
): SummaryWriteBudget {
  return {
    async take(dayStartMs: number, wanted: number): Promise<Result<number>> {
      try {
        const stub = namespace.get(namespace.idFromName(LEDGER_INSTANCE));
        const response = await stub.fetch('https://coordination.invalid/permits', {
          method: 'POST',
          body: JSON.stringify({ dayStartMs, wanted }),
        });
        if (!response.ok) {
          return err(unavailable());
        }
        const parsed = (await response.json()) as { granted?: unknown };
        return ok(typeof parsed.granted === 'number' ? parsed.granted : 0);
      } catch {
        return err(unavailable());
      }
    },
  };
}
