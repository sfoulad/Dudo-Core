/**
 * ===========================================================================================
 * REQUEST COORDINATION — the ports for rate limiting and bounded denial auditing.
 * ===========================================================================================
 *
 * `docs/decisions/0013-bounded-denial-auditing-and-rate-limits.md`, Accepted, user decision of
 * 2026-09-02, ten binding controls. This file is the Core-owned boundary they are expressed
 * through: no Cloudflare type, client or binding appears anywhere in it, and nothing below it
 * knows that a Durable Object exists (`CLOUDFLARE_STANDARD.md` §2).
 *
 * WHAT WENT WRONG, SO THE SHAPE OF THIS FILE IS NOT MYSTERIOUS. D2 (2026-09-02) made every
 * DENIED read an audit write. `core-agent` then observed that nothing rate-limits an
 * authenticated caller, so the attacker chose the write rate; and the Team Lead verified
 * against `d1/platform/pricing/` that D1 Free enforces **100,000 rows written per day,
 * ACCOUNT-WIDE**, and that exceeding it means "you will not be able to run queries against
 * D1". One authenticated caller, 100,000 malformed requests, and D1 stops answering for every
 * Organization. The probe-detection control was a platform-wide denial-of-service lever.
 *
 * Cloudflare began ENFORCING that limit on 2026-09-01 (changelog, "D1 enforces free tier daily
 * query limits"), so this is a live property of the platform and not a future one.
 *
 * ===========================================================================================
 * WHAT THESE CONTROLS DO NOT CLAIM — 0013 control 11, and it is not a hedge
 * ===========================================================================================
 *
 * THIS IS NOT DDoS RESISTANCE AND MUST NEVER BE DESCRIBED AS SUCH. An attacker can still
 * exhaust the overall Workers Free request allowance — 100,000 requests/day — before ever
 * reaching D1, and nothing here changes that. What these controls protect is **D1 capacity and
 * the integrity of the audit trail**. Any comment, report, standard or PR that lets a reader
 * infer volumetric protection from this code is wrong, and the user was explicit about it.
 *
 * ===========================================================================================
 * THE TWO PATHS, AND WHY "FAIL CLOSED" MEANS SOMETHING DIFFERENT ON EACH
 * ===========================================================================================
 *
 * 0013 control 8 says failure or exhaustion of the coordinator MUST NEVER PERMIT ACCESS and
 * MUST NOT change the external `not_found`. D2 requirement 6 says an audit-write failure must
 * NOT change the answer either. Read carelessly those look like they conflict. They do not,
 * because the coordinator sits on two paths that are on opposite sides of the decision:
 *
 *   PATH 1 — ADMISSION, BEFORE THE DECISION.  `begin()` runs before the store is resolved and
 *   before any Customer query. If it cannot answer, the request has NOT been shown to be
 *   within its limits, so nothing that would WRITE is permitted to proceed. Failure here
 *   narrows what is reachable. That is control 8.
 *
 *   PATH 2 — EVIDENCE, AFTER THE DECISION.  `recordDenial()` runs only once the request has
 *   ALREADY been refused. Access was decided before the coordinator was consulted and is not
 *   reconsidered afterwards, so there is no "open" for it to fail into. Its failure mode is on
 *   the evidence side: the record may be lost, and the loss is ANNOUNCED rather than absorbed
 *   (`audit/coordination-failure.ts`). The response is unchanged — same `not_found`, same
 *   body, same length — because a response that varied when the coordinator was unhappy would
 *   be a channel a caller could open on demand, which is the exact indistinguishability
 *   requirement this whole slice is built around.
 *
 * ONE SENTENCE SATISFIES BOTH: a degraded coordinator can only ever refuse more and disclose
 * less, and can never alter a refusal that has already been decided.
 */

import type { AuditDenialReason } from '../audit/audit.ts';
import type { Result } from '../kernel/result.ts';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type { WriteAdmissionOutcome, WriteReservation } from './write-admission.ts';
import { DAILY_ALLOCATION, UTC_DAY_MS } from './write-admission.ts';
import { DENIAL_SUMMARY_ROW_WRITES } from '../storage/write-cost.ts';

// =============================================================================================
// Windows
// =============================================================================================

/**
 * The denial aggregation window. 0013 control 4: one summarised D1 record per 15-minute
 * window.
 *
 * IT IS A DETECTION-LATENCY TRADE AND 0013 SAYS SO: a campaign is visible within fifteen
 * minutes rather than instantly. That is the accepted cost of bounding the writes. See
 * `EMISSION_LADDER` below for the part that makes the first attempt visible immediately
 * anyway, so "fifteen minutes" bounds the COUNT converging, not the campaign appearing.
 */
export const DENIAL_WINDOW_MS = 15 * 60 * 1000;

/** The rate-limit window. Fixed windows, not a sliding log: a log is per-attempt state. */
export const RATE_WINDOW_MS = 60 * 1000;

/**
 * The daily budget window. Cloudflare resets its Free daily limits at 00:00 UTC.
 *
 * ONE DEFINITION, IN `write-admission.ts`, re-exported here rather than restated. Two constants
 * for the same day would be two constants until one of them changed.
 */
export const DAY_MS = UTC_DAY_MS;

export function windowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

// =============================================================================================
// Rate limits — 0013 control 6
// =============================================================================================

/**
 * Three levels, enforced together, BEFORE any Customer D1 query.
 *
 * THE NUMBERS AND WHY THEY ARE IN THIS ORDER — tightest on the individual credential, loosest
 * on the address:
 *
 *   actor         60/min  = 1 request per second sustained. Far above interactive human use
 *                           (a page load is a handful of requests) and comfortably above a
 *                           well-behaved integration. This is the limit that binds the threat
 *                           0013 actually names: ONE AUTHENTICATED CALLER.
 *   organization 300/min  = 5/s. Supports roughly fifty concurrently active users in an
 *                           Organization at ordinary interaction rates. It exists because a
 *                           per-actor-only limit lets one Organization's runaway integration
 *                           fleet spend the platform's capacity through many credentials.
 *   source       600/min  = 10/s, counted ACROSS ORGANIZATIONS. DELIBERATELY THE LOOSEST,
 *                           because a source address is the least meaningful of the three: an
 *                           office behind one NAT is many unrelated users sharing one address,
 *                           and a limit tight enough to stop an attacker there would stop a
 *                           customer's staff first.
 *
 * ===========================================================================================
 * WHY THE SOURCE LEVEL IS COUNTED ACROSS ORGANIZATIONS, AND WHAT THAT COSTS
 * ===========================================================================================
 *
 * IT WAS UNREACHABLE BEFORE, and the algorithm was not the reason — the composition was. A
 * source counter held inside a per-Organization coordinator can only ever see one
 * Organization's traffic, and inside one Organization the Organization limit of 300 always
 * crosses before the source limit of 600. So the level existed, passed its own unit tests, and
 * could not refuse a single request in the deployed shape. Found by `qa-agent`, which
 * reproduced it with 602 admissions from one address across distinct Organizations, and which
 * left the case red rather than moving the assertion. That was the right call.
 *
 * THE FIX IS NOT TO LOWER THE NUMBER. Making the source limit smaller than the Organization
 * limit would make it fire — inside one Organization, where the Organization limit already
 * binds and where the user's own reasoning (the office behind one NAT) says a tight address
 * limit hurts customers first. It would produce a level that refuses, without producing a level
 * that catches anything the other two miss.
 *
 * THE ONLY THING THIS LEVEL CAN DO THAT THE OTHER TWO CANNOT is see one address spending
 * budget through MANY credentials in MANY Organizations. That is what a fallback is for, and it
 * requires a counter that is not tenant-scoped. So `SourceCounterShard` below is shared.
 *
 * WITHIN ONE ORGANIZATION THE SOURCE LEVEL IS STILL DOMINATED, AND THAT IS NOW BY DESIGN
 * rather than by accident: 300 < 600, so the Organization level answers first, which is
 * correct — inside a single tenant the tenant-scoped limit is the meaningful one.
 *
 * WHAT THE SHARED COUNTER HOLDS, AND THEREFORE WHAT IT CANNOT LEAK. A hash of a source
 * address, a window, and an integer. NO Organization identifier, NO principal identifier, NO
 * record, NO business data, and no column any of those could occupy. It cannot say which
 * Organizations an address touched, because it does not store it; it cannot say who called,
 * because it never receives it; and an operator reading it sees hashes, never addresses.
 *
 * WHAT IT DOES CREATE, NAMED RATHER THAN DISMISSED: an AVAILABILITY COUPLING between
 * Organizations that share a source address. Traffic from one Organization behind a NAT
 * consumes budget another Organization behind the same NAT also draws on. That is inherent to
 * any address-based limit — an address is not a tenant-scoped fact — and it is precisely why
 * this level has the loosest threshold of the three and sits last in the refusal order. The
 * weak inference it offers a caller is "roughly 600 requests came from my address this minute,
 * some possibly not mine": a statement about an ADDRESS, not about a tenant. It names no other
 * Organization, confirms none exists, and is indistinguishable to the caller from its own
 * traffic being counted.
 *
 * These are a capacity guard, not an anti-fraud control. They are deliberately generous, and
 * THEY ARE NOT WHAT BOUNDS THE DAILY D1 WRITE COST.
 *
 * `0013` finished that sentence with "the summary ceilings below are", which was true of the
 * DENIAL path and only of it. `docs/decisions/0014` found what the sentence left out: at 60/min
 * the actor limit permits 86,400 requests/day, and on the SUCCESS path nothing bounded what each
 * one wrote. **A per-minute window cannot bound a per-day allowance**, whichever path it sits on.
 * The daily budget that bounds the success path is `write-admission.ts`; the ceilings below,
 * reconciled into its `security` allocation, bound the denial path. Both are daily, both draw on
 * one ledger, and neither of them is a rate limit.
 */
export const RATE_LIMIT_PER_WINDOW: Readonly<Record<RateLimitLevel, number>> = {
  actor: 60,
  organization: 300,
  source: 600,
};

export type RateLimitLevel = 'actor' | 'organization' | 'source';

/**
 * The cross-Organization source counter. NOT tenant-scoped, by necessity — see above.
 *
 * IT IS NOT CONSULTED PER REQUEST. A per-request call to a second, differently-keyed coordinator
 * would double the coordinator's own metered request count, and that allowance is already the
 * binding constraint under attack. Instead each Organization's coordinator counts locally and
 * REPORTS A DELTA: on the first request it sees from an address in a window, and every
 * `SOURCE_REPORT_INTERVAL` requests thereafter. The shard returns the running cross-Organization
 * total, and a total over the limit blocks that address for the rest of the window.
 *
 * THE IMPRECISION THIS BUYS, STATED AS A NUMBER: between reports, up to
 * `SOURCE_REPORT_INTERVAL - 1` requests per Organization are not yet in the shared total, so
 * with N Organizations active from one address the effective limit is up to
 * `600 + 24N` in a window rather than exactly 600. For a fallback capacity guard that is the
 * right trade; for anything that had to be exact it would not be, and this level is not that.
 *
 * REPORTING ON THE FIRST REQUEST OF EACH WINDOW is what makes the level useful rather than
 * merely present: an address already over its limit through other Organizations is caught on
 * this Organization's very first request, not after twenty-five of them.
 */
export type SourceCounterShard = {
  /** Adds `delta` to the cross-Organization count for this window. Returns the running total. */
  add(sourceAddressHash: string, windowStartMs: number, delta: number): Promise<Result<number>>;
};

export const SOURCE_REPORT_INTERVAL = 25;

/** Every unknown source shares this bucket. Not an exemption; see `CoordinatedRequest`. */
export const UNKNOWN_SOURCE = 'unknown-source';

// =============================================================================================
// The daily summary-write ceilings — 0013 control 9, RECONCILED BY docs/decisions/0014 §A.5
// =============================================================================================

/**
 * THE CEILING THAT RESERVES D1 CAPACITY FOR THE PRODUCT. "Security evidence must not be able
 * to starve the product."
 *
 * ===========================================================================================
 * TWO THINGS CHANGED HERE UNDER `0014` §A.5, AND NEITHER IS COSMETIC
 * ===========================================================================================
 *
 * 1. THE UNIT. `0013` counted SUMMARIES, one permit per summary. `0014` §A.3 denominates the
 *    platform ceiling in ESTIMATED ROW-WRITES, and a summary is not one row-write: the
 *    `denial_summary` table and its three indexes make it FOUR
 *    (`storage/write-cost.ts`, and Cloudflare's rule that an index adds a written row). A
 *    ceiling counting summaries cannot be added to a ceiling counting row-writes, and §A.5
 *    requires precisely that addition. So both ceilings below are now row-writes.
 *
 * 2. WHERE THE BUDGET COMES FROM. `0013`'s 5,000 was a ceiling of its OWN, sitting beside the
 *    product's consumption and bounded only against the 100,000 allowance directly. §A.5 makes
 *    security evidence an ALLOCATION INSIDE the 80,000 platform ceiling, so it is now defined
 *    AS that allocation — `DAILY_ALLOCATION.security` — and drawn from the same ledger, through
 *    the same `DayWriteBudget`, as every business mutation. Two independent daily ceilings that
 *    each believed themselves safe would have summed past the platform ceiling by construction.
 *
 * PLATFORM: 10,000 estimated row-writes per UTC day = **2,500 summaries**, account-wide.
 *
 *   - It is 10% of the enforced 100,000, and 12.5% of the 80,000 admitted ceiling.
 *   - Is it still enough to be useful? A single-group campaign running all day costs at most
 *     `MAX_WRITES_PER_GROUP_WINDOW` summaries per 15-minute window — 6 x 96 = 576 summaries =
 *     2,304 row-writes/day. So the allocation accommodates roughly four simultaneous all-day
 *     campaigns, or about 2,500 isolated one-off denials, before evidence starts being dropped.
 *     `0013` claimed eight campaigns at 5,000 summaries; the real figure was always four, because
 *     the index rows were never counted. The allocation did not shrink — the arithmetic was
 *     corrected.
 *
 * PER ORGANIZATION: 2,000 estimated row-writes = **500 summaries** per UTC day. `0013`'s
 * platform-to-Organization ratio was 5:1 and is preserved exactly: one Organization cannot
 * consume the whole platform allocation and blind every other Organization's evidence, which is
 * the same starvation argument one level down. It is also the half that survives without any
 * shared state.
 *
 * BOTH NUMBERS ARE PROVISIONAL AND SHOULD BE TRACKED IN THE FREE-TIER REGISTER. Dudo has zero
 * Organizations, no authentication and no traffic, so these are reasoned bounds and not
 * measurements. They are deliberately conservative: the failure mode of a ceiling that is too
 * low is lost evidence, which is announced; the failure mode of one that is too high is a
 * platform outage, which is not.
 *
 * ===========================================================================================
 * WHAT HAPPENS AT THIS CEILING IS NOT WHAT HAPPENS AT THE MUTATION CEILING. BOTH ARE RIGHT.
 * ===========================================================================================
 *
 * HERE: summary writes stop, the coordinator KEEPS COUNTING, every suppressed summary is
 * announced, and **the caller's response is unchanged**. Refusing requests when evidence cannot
 * be stored would turn the ceiling into a second denial-of-service lever — burn the evidence
 * budget, refuse everyone — which is the exact mistake `0013` exists to correct.
 *
 * AT THE BUSINESS CEILING (`0014` §A.10): the mutation returns `429` with a retry time. There is
 * no silent continuation available, because the write IS the request's purpose and accepting it
 * without performing it is data loss reported as success.
 *
 * THE DIFFERENCE IS WHICH SIDE OF THE DECISION THE WRITE SITS ON. A summary records an answer
 * that was already given and cannot change it. A mutation IS the answer. Anyone tempted to make
 * these two behave alike should read `write-admission.ts`'s header, which states the same
 * distinction from the other end — and note that harmonising them in either direction
 * reintroduces a vulnerability a user decision was written to close.
 */
export const PLATFORM_DAILY_SUMMARY_ROW_WRITES = DAILY_ALLOCATION.security;
export const PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES = 2_000;

/**
 * The summaries those row-write ceilings buy, for reading and for reporting. Derived, never
 * declared: a summary count written down beside a row-write ceiling is a number that goes stale
 * the day an index is added to `denial_summary`.
 */
export const PLATFORM_DAILY_SUMMARIES = Math.floor(
  PLATFORM_DAILY_SUMMARY_ROW_WRITES / DENIAL_SUMMARY_ROW_WRITES,
);
export const PER_ORGANIZATION_DAILY_SUMMARIES = Math.floor(
  PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES / DENIAL_SUMMARY_ROW_WRITES,
);

/**
 * When, inside an open window, a summary row is (re)written.
 *
 * WHY THERE IS A LADDER AT ALL, rather than one write when the window closes. A close-only
 * design has a hole big enough to drive the whole control through: a campaign that runs for
 * ten minutes and then STOPS leaves a window that never closes against any later attempt, and
 * so produces NO record at all. An attacker who probes for under fifteen minutes would be
 * invisible — the same absence the D2 finding was about, reintroduced by the fix for it.
 *
 * So the row is written when the group's window OPENS (count 1) and UPSERTED at each ladder
 * point, then completed when the window closes. The record exists from the first attempt; the
 * count converges logarithmically; and the cost is bounded at SIX row-writes per group per
 * window instead of one.
 *
 * THIS IS STILL "ONE SUMMARISED RECORD PER 15-MINUTE WINDOW" (control 4). There is exactly one
 * ROW per `(tenant, group, window)` — one primary key, one record. It is written more than
 * once. The accounting above uses 6, not 1, and does not pretend otherwise.
 */
export const EMISSION_LADDER: readonly number[] = [1, 10, 100, 1_000, 10_000];

/** The most row-writes one group's window can ever cost: every ladder point, plus the close. */
export const MAX_WRITES_PER_GROUP_WINDOW = EMISSION_LADDER.length + 1;

// =============================================================================================
// The denial group key — 0013 controls 3 and 5, and control 5 is the load-bearing one
// =============================================================================================

/**
 * ===========================================================================================
 * WHY THE REQUESTED CUSTOMER IDENTIFIER IS NOT IN THIS KEY, AND WHY THAT IS THE WHOLE DECISION
 * ===========================================================================================
 *
 * 0013 control 5, verbatim: *"Do not group by requested customer identifier. An attacker
 * controls that value and could mint unlimited groups, which would restore per-attempt writes
 * under another name. This is the constraint that makes the aggregation actually bounded."*
 *
 * THE BOUND, COMPONENT BY COMPONENT. Every field of this key is either server-derived or drawn
 * from a set fixed at build time:
 *
 *   organizationId  from the authenticated context. One value per session.
 *   principalId     from the authenticated context. Its cardinality is the number of
 *                   CREDENTIALS the attacker holds — each one costs an authentication, which
 *                   is the property that makes this dimension expensive rather than free.
 *   appId, actionId from the router's registered Action table. Finite, fixed at build time.
 *   category        the closed `AuditDenialReason` set. Seven values, and no more can appear
 *                   without an edit to the error taxonomy.
 *
 * So per credential per day the group-window count is at most
 * `actions × 7 categories × 96 windows`. With the eight executable Customer Directory Actions
 * that is 5,376 group-windows — a number, which is the point. WITH THE IDENTIFIER IN THE KEY
 * it would be one group per distinct string the attacker typed: unbounded, and precisely equal
 * to the per-attempt write count it was supposed to replace, wearing the word "aggregation".
 *
 * HOW THE ABSENCE IS MADE STRUCTURAL RATHER THAN REMEMBERED. The same three devices that keep
 * a target's Business out of `actorBusinessIds` (`audit/audit.ts`), for the same reason:
 *
 *   1. NOMINAL TYPE. `DenialGroupKey` is branded. A plain object with the right fields is not
 *      assignable to it, and the only value that satisfies it comes from
 *      `deriveDenialGroupKey`.
 *   2. THE CONSTRUCTOR HAS NOWHERE TO PUT ONE. Its parameters are an `AuthenticatedPrincipal`,
 *      an Action's identity, and a category from the closed set. **There is no parameter a
 *      caller-supplied string could arrive through.** A raw customer identifier is not an
 *      authenticated principal and cannot be passed as one.
 *   3. THE BRAND IS CHECKED AT RUNTIME before anything is recorded, because this repository has
 *      no type-check step in its build and a type-only brand would be documentation.
 *
 * A SECOND PROPERTY FALLS OUT OF THIS AND IT IS WORTH STATING CORRECTLY, because an earlier
 * version of this comment overstated it and `qa-agent` was right to say so.
 *
 * WHAT IT IS NOT. Keying by identifier would NOT distinguish a foreign-Organization probe from
 * a probe at nothing. Both are `not_found`, both carry the same category, and under either
 * keying each would simply open its own group and emit on its first attempt — identically. The
 * existence oracle is closed by the CATEGORY being the same, not by the grouping.
 *
 * WHAT IT ACTUALLY IS, AND IT IS THE STRONGER PROPERTY. Summary writes happen on 1-in-N
 * denials, so a denial that triggers one is measurably slower than one that does not. Because
 * the key contains nothing the caller supplies, WHICH denials are slower depends only on an
 * attempt count the caller cannot address — no sequence of identifiers it chooses moves the
 * schedule. Per-request work therefore carries NO SIGNAL KEYED ON CALLER INPUT AT ALL. Put the
 * identifier in the key and that collapses: every fresh identifier becomes the first attempt of
 * a new group and so writes, while a repeated one does not — a timing and cost difference the
 * caller controls directly, which is both a channel in the general case and an amplification
 * lever in this one, since "vary the identifier" would mean "write every time".
 */
const DENIAL_GROUP_KEY_BRAND: unique symbol = Symbol('dudo.protection.denialGroupKey');

export type DenialGroupKey = {
  readonly [DENIAL_GROUP_KEY_BRAND]: true;
  readonly organizationId: string;
  readonly principalId: string;
  readonly appId: string;
  readonly actionId: string;
  /** The FIXED SAFE denial category. Reused from the audit taxonomy; see below. */
  readonly category: AuditDenialReason;
};

/**
 * The Action's identity, as the key constructor needs it. Deliberately NOT the whole
 * `ActionDefinition`: this module must not depend on the action module, and a narrower
 * parameter is a narrower channel.
 */
export type DenialActionIdentity = {
  readonly appId: string;
  readonly id: string;
};

/**
 * The ONLY constructor.
 *
 * `category` is `AuditDenialReason` — the SAME closed vocabulary the per-event audit records
 * use — and reusing it is deliberate rather than lazy. The Team Lead's 2026-09-02 ruling
 * refused an App-local synonym set because `denial_reason` is a Core-wide column; inventing a
 * second vocabulary for summaries would reintroduce exactly that polymorphism one table over.
 * It is also already SAFE in the sense control 4 requires: `not_found` covers both "in another
 * Organization" and "nowhere", so the category cannot distinguish them.
 */
export function deriveDenialGroupKey(source: {
  readonly principal: AuthenticatedPrincipal;
  readonly action: DenialActionIdentity;
  readonly category: AuditDenialReason;
}): DenialGroupKey {
  const key = {
    organizationId: source.principal.organizationId,
    principalId: source.principal.principalId,
    appId: source.action.appId,
    actionId: source.action.id,
    category: source.category,
  };
  Object.defineProperty(key, DENIAL_GROUP_KEY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(key) as DenialGroupKey;
}

/**
 * Thrown, not returned. An unbranded key means some code path assembled a grouping out of
 * something other than the authenticated principal and the Action definition — which is the
 * one way the caller-controlled identifier could get in. It must stop the record, not be
 * noticed afterwards.
 */
export class DenialGroupKeyNotDerivedError extends Error {
  constructor() {
    super(
      'A denial grouping was supplied that did not come from deriveDenialGroupKey. The group ' +
        'key is built from the AUTHENTICATED PRINCIPAL and the ACTION DEFINITION and from ' +
        'nothing else. It must never contain the requested resource identifier: the attacker ' +
        'controls that value and would mint unlimited groups, restoring per-attempt writes ' +
        'under another name (docs/decisions/0013 control 5).',
    );
    this.name = 'DenialGroupKeyNotDerivedError';
  }
}

export function assertDenialGroupKey(value: DenialGroupKey): void {
  const branded = value as unknown as Record<symbol, unknown>;
  if (branded[DENIAL_GROUP_KEY_BRAND] !== true) {
    throw new DenialGroupKeyNotDerivedError();
  }
}

/**
 * ===========================================================================================
 * FOR A COORDINATOR REBUILDING ITS OWN PERSISTED STATE. NOTHING ELSE MAY CALL THIS.
 * ===========================================================================================
 *
 * A coordinator instance can be evicted and restarted between a window opening and closing, so
 * it has to be able to reconstruct the key of a group it already holds. `deriveDenialGroupKey`
 * cannot serve that: its only channel is an `AuthenticatedPrincipal`, and there is no
 * authenticated request in scope when an object restarts.
 *
 * THIS FUNCTION IS THEREFORE THE ONE PLACE THE BRAND CAN BE APPLIED TO NAMED STRINGS, AND ITS
 * SAFETY IS NOT IN THE SIGNATURE — it is in the provenance of what is passed. The only values
 * that ever reach a coordinator's storage came out of `deriveDenialGroupKey`, so the only
 * values it can rebuild are ones that were already bounded. That is an argument about call
 * sites rather than about types, which is weaker than the guard above, and it is why this is
 * named for its single purpose and stated in capitals rather than left to look general.
 *
 * IF THIS IS EVER CALLED FROM A REQUEST PATH, control 5 is defeated and the aggregation stops
 * being bounded: a caller-supplied identifier laundered through here would mint one group per
 * probe. It has no business on a request path and there is no reason it would appear on one.
 */
export function rehydratePersistedDenialGroupKey(fields: {
  readonly organizationId: string;
  readonly principalId: string;
  readonly appId: string;
  readonly actionId: string;
  readonly category: AuditDenialReason;
}): DenialGroupKey {
  const key = {
    organizationId: fields.organizationId,
    principalId: fields.principalId,
    appId: fields.appId,
    actionId: fields.actionId,
    category: fields.category,
  };
  Object.defineProperty(key, DENIAL_GROUP_KEY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(key) as DenialGroupKey;
}

/**
 * The stable string form, for use as a map key and as the summary row's grouping column.
 *
 * FIELDS ARE NAMED EXPLICITLY rather than spread, so that a field added to `DenialGroupKey` in
 * future has to be added here ON PURPOSE to participate in the grouping. A spread would let a
 * new field silently multiply the group count, which is the failure this whole design is
 * arranged to prevent.
 *
 * THE SEPARATOR IS A SPACE because it cannot occur in any component: Organization, principal,
 * App and Action identifiers are unspaced ASCII names, and the category is drawn from a closed
 * set. A separator that COULD occur would let two different groups collapse into one text —
 * which would undercount a campaign, silently, in the direction that hides it. It is a
 * printable character on purpose: an invisible control character in a grouping key is
 * unreviewable and survives a copy-paste as something else.
 */
const GROUP_KEY_SEPARATOR = ' ';

/** The inverse, for a coordinator rebuilding its own persisted state. See the warning above. */
export function denialGroupKeyFromText(text: string): DenialGroupKey | undefined {
  const parts = text.split(GROUP_KEY_SEPARATOR);
  if (parts.length !== 5) {
    return undefined;
  }
  return rehydratePersistedDenialGroupKey({
    organizationId: parts[0],
    principalId: parts[1],
    appId: parts[2],
    actionId: parts[3],
    category: parts[4] as AuditDenialReason,
  });
}

export function denialGroupKeyText(key: DenialGroupKey): string {
  return [key.organizationId, key.principalId, key.appId, key.actionId, key.category].join(
    GROUP_KEY_SEPARATOR,
  );
}

// =============================================================================================
// The summary — 0013 control 4
// =============================================================================================

/**
 * One summarised record for one group in one 15-minute window.
 *
 * WHAT IT CARRIES: first attempt time, last attempt time, total attempt count, the actor and
 * Organization context, and the fixed safe denial category — control 4's list exactly.
 *
 * WHAT IT HAS NO FIELD FOR, and the absence is the control: the requested resource identifier,
 * any value read from any record, and the target's Business. There is no `payload`, no
 * `message`, no `Record<string, unknown>` — the same structural argument as `AuditEntry`, for
 * the same reason. A summary that could hold a value would be a second copy of the business
 * data with different access rules, aggregated.
 */
export type DenialSummary = {
  readonly key: DenialGroupKey;
  /** Epoch milliseconds at the start of the 15-minute window. */
  readonly windowStartMs: number;
  /**
   * Which emission for this window this is: 0 for the first, then 1, 2 … up to the close.
   *
   * IT EXISTS BECAUSE THE TABLE IS APPEND-ONLY. `SECURITY_STANDARD.md` §6 and this codebase's
   * own rule — "an append-only log that application code edits is neither append-only nor a
   * log" (`audit/audit.ts`) — rule out updating a window's row in place as the count grows, and
   * the storage port has no upsert. So each ladder emission appends a PROGRESS ROW and the
   * close appends the FINAL one. The window's summary is the row with `window_closed = 1`, or,
   * while the window is still open, the row with the highest `attempt_count`.
   *
   * The cost is stated rather than hidden: up to `MAX_WRITES_PER_GROUP_WINDOW` rows per window
   * instead of one, which is the number every ceiling in this file is computed against.
   */
  readonly emissionSequence: number;
  readonly firstAttemptAtMs: number;
  readonly lastAttemptAtMs: number;
  readonly attemptCount: number;
  /**
   * The actor's own authorized Business set at the time of the attempts — the caller's data
   * about itself, never the target's. Same distinction as `AuditEntry.actorBusinessIds`.
   */
  readonly actorBusinessIds: readonly string[];
  /**
   * The permission and scope the Action declares.
   *
   * `AUTHORIZATION_STANDARD.md` §11 asks for the permission and scope ACTUALLY EVALUATED, and
   * these are taken from the Action definition rather than from the authorizer's decision.
   * That is equivalent TODAY — `createAuthorizer` returns the Action's own permission and
   * scope on every branch, allowed or denied — and it is what makes the field available on the
   * denial paths that happen BEFORE authorization runs at all, which a rate-limit refusal does.
   * IF THE AUTHORIZER EVER RETURNS SOMETHING IT WAS NOT ASKED FOR, this must be sourced from
   * the decision instead, and the two will have quietly disagreed until someone notices.
   */
  readonly permissionId: string;
  readonly scope: string;
  /** True once the window has closed and the count is final. */
  readonly windowClosed: boolean;
};

/** What a denial contributes to its summary beyond the grouping. Identifiers only. */
export type DenialContext = {
  /** The CALLER's own authorized Business set. Never the target's; there is no field for one. */
  readonly actorBusinessIds: readonly string[];
  readonly permissionId: string;
  readonly scope: string;
};

// =============================================================================================
// The ports
// =============================================================================================

export type AdmissionOutcome =
  /** Within every limit. Proceed. */
  | 'admitted'
  /** A limit was exceeded. The request is refused with `rate_limited`. */
  | 'rate_limited'
  /**
   * The coordinator could not answer. THE REQUEST IS NOT REFUSED OUTRIGHT — see
   * `pipeline.ts` for why a blanket refusal here would itself be a platform-wide
   * denial-of-service lever, and what is done instead.
   */
  | 'degraded';

/**
 * A handle for ONE request's coordination, obtained from `begin()` and disposed at the end.
 *
 * WHY A HANDLE RATHER THAN TWO INDEPENDENT CALLS, and it is not an aesthetic choice. The
 * admission check and the denial record are two interactions with the same coordinator during
 * one request. Issued as two independent calls they cost two coordinator round trips, and on a
 * probing campaign EVERY request is denied — which doubles the coordinator's metered request
 * count and halves the traffic the platform can absorb before the coordinator itself is the
 * exhausted resource. A handle lets an adapter hold one session open across both, and the
 * Durable Object adapter does exactly that. See that file for the measured accounting.
 *
 * Nothing about this shape is Cloudflare-specific: "a coordination handle scoped to one
 * request, released when the request ends" is an ordinary domain shape, and the in-process
 * implementation satisfies it with a plain object.
 */
export type RequestCoordination = {
  readonly outcome: AdmissionOutcome;
  /** Seconds until the caller may retry. Zero when not rate limited. `Retry-After`. */
  readonly retryAfterSeconds: number;
  /**
   * Count one denied attempt against its group.
   *
   * Returns the summaries that are now due to be written to D1 — usually none, at most a
   * handful. The caller writes them through the tenant-scoped store; the coordinator never
   * touches D1 itself.
   *
   * EVERY SUMMARY RETURNED BELONGS TO THE SAME ORGANIZATION AS THIS HANDLE. That is not a
   * convention: the coordinator instance is scoped to one Organization, so it holds no other
   * Organization's counters and has nothing else it could return.
   */
  recordDenial(key: DenialGroupKey, context: DenialContext): Promise<Result<DenialRecordOutcome>>;
  /**
   * ===========================================================================================
   * RESERVE DAILY D1 WRITE CAPACITY FOR THIS REQUEST'S MUTATION. `docs/decisions/0014` §A.1.
   * ===========================================================================================
   *
   * `estimatedRowWrites` is the Action's declared WORST CASE, including the audit row
   * (`action/action.ts`, `estimatedRowWriteCost`). §A.12: over-reserving delays a write,
   * under-reserving is a platform outage, and the reservation is not refunded if the write then
   * costs less, fails, or never happens.
   *
   * IT DRAWS FROM THE `business` ALLOCATION AND FROM NO OTHER, AND THAT IS STRUCTURAL RATHER
   * THAN POLICY: this method has no allocation parameter. An Action therefore cannot spend the
   * security allocation that holds denial evidence, nor the system allocation reserved for
   * controlled operations, however it is called and whatever it declares. The security
   * allocation is reachable only through `recordDenial`, which runs after a refusal and cannot
   * be reached on a success.
   *
   * NEITHER THE ORGANIZATION NOR THE CLOCK IS A PARAMETER. Both are fixed by the handle, from
   * the authenticated context, when `begin` was called — the same reason no method on
   * `TenantScopedStore` takes a tenant. A budget keyed by a value the caller supplies is not a
   * budget; it is a namespace the caller can move within at will.
   *
   * `deferred` is not an error and must not be logged as one. It is the day's capacity being
   * spent, which is an ordinary operating state with a known end time.
   */
  reserveWrites(estimatedRowWrites: number): Promise<Result<WriteAdmissionOutcome>>;
  /** Releases the handle. Never throws. Safe to call more than once. */
  dispose(): void;
};

export type DenialRecordOutcome = {
  readonly summaries: readonly DenialSummary[];
  /**
   * The receipt for the row-writes the summaries above will cost, or null when there are none.
   *
   * ISSUED HERE RATHER THAN ASKED FOR LATER, BECAUSE THE SPEND HAS ALREADY HAPPENED. The
   * coordinator took the permits out of the `security` allocation when it decided a summary was
   * due (`spendPermit`); a summary that was refused by a ceiling never reaches `summaries` at
   * all. Making the caller ask again would be charging twice for one decision, and making it
   * write without asking would be the unaccounted write `0014` §A.11 prohibits.
   *
   * ITS SIZE IS EXACTLY `summaries.length * DENIAL_SUMMARY_ROW_WRITES`, so the evidence path is
   * accounted in the same unit, against the same ledger, as every business mutation.
   */
  readonly reservation: WriteReservation | null;
  /**
   * How many summaries a DAILY CEILING refused (0013 control 9).
   *
   * Reported separately from `summaries` because "none were due" and "some were refused" are
   * different facts and only the second is a loss of evidence. The attempt itself is still
   * counted either way; the caller announces the refusal through the same floor that announces
   * an audit-write failure.
   */
  readonly suppressedByCeiling: number;
};

export type CoordinatedRequest = {
  /** Server-derived, from the authenticated context. Never from the request. */
  readonly organizationId: string;
  /** Server-derived, from the authenticated context. */
  readonly principalId: string;
  /**
   * A HASH of the source address, or null when the transport could not establish one.
   *
   * IT IS HASHED AT THE TRANSPORT ADAPTER AND CORE NEVER SEES THE ADDRESS. A raw address is
   * personal data about a tenant's staff, and this counter needs only equality.
   *
   * NULL IS NOT AN EXEMPTION. An adapter that cannot determine a source shares one bucket with
   * every other unknown source, so forgetting to supply it throttles hard rather than
   * disabling the level — the fail-closed direction.
   */
  readonly sourceAddressHash: string | null;
  readonly nowMs: number;
};

/**
 * The coordinator. One instance is scoped to exactly one Organization
 * (`CLOUDFLARE_STANDARD.md` §7 rule 3), which is what makes every counter and every summary it
 * holds tenant-scoped by construction rather than by predicate.
 */
export type RequestCoordinator = {
  begin(request: CoordinatedRequest): Promise<Result<RequestCoordination>>;
};

/**
 * ===========================================================================================
 * `SummaryWriteBudget` IS GONE. IT IS `DayWriteBudget` IN `write-admission.ts`, AND THE
 * REPLACEMENT IS THE POINT RATHER THAN A RENAME.
 * ===========================================================================================
 *
 * `0013` gave denial summaries their own daily ledger. `0014` §A.5 makes them an ALLOCATION
 * inside one platform ceiling, so a separate ledger is exactly the shape the decision forbids:
 * two independent daily budgets, each correct about itself, summing past 80,000 while the
 * account goes down. There is now one ledger, three allocations, and summaries take from
 * `security` through the same call a create uses for `business`.
 *
 * IT STILL HOLDS NO TENANT DATA — a UTC day and one integer per allocation, and nothing else.
 * That remains why it is the one piece of coordination state that is not per-Organization, and
 * the narrow tension with `CLOUDFLARE_STANDARD.md` §7 rule 3 ("a DO instance belongs to exactly
 * one tenant") is unchanged and still reported rather than resolved unilaterally: the rule
 * exists so that two tenants' DATA does not share an instance, and no tenant identifier reaches
 * this one.
 */
export type { DayWriteBudget, WriteAllocation } from './write-admission.ts';
