/**
 * ===========================================================================================
 * DAILY D1 WRITE ADMISSION. `docs/decisions/0014` §A, Accepted, user decision of 2026-09-02.
 * ===========================================================================================
 *
 * WHAT WAS WRONG, because the shape of this file follows directly from it. `0013` bounded the
 * DENIAL path: a refused request no longer writes a row per attempt. It did nothing about the
 * SUCCESS path, and the success path was bounded by nothing at all.
 *
 *   actor rate limit           60/min  = 86,400 requests/day per credential
 *   a successful CreateCustomer        = 8 estimated row-writes (storage/write-cost.ts)
 *   permitted daily cost               = 691,200 against an ENFORCED 100,000/day, ACCOUNT-WIDE
 *
 * Every rate limit in this system uses a 60-second window; every D1 allowance that causes an
 * outage is DAILY. **A per-minute limit cannot bound a per-day budget.** `coordination.ts` says
 * so correctly — "they are not what bounds the daily D1 write cost" — and it was true of the
 * denial path only.
 *
 * THE REALISTIC TRIGGER IS NOT AN ATTACKER, AND THIS FILE IS BUILT FOR THE OTHER CASE. A tenant
 * migrating fifty thousand records through the API is fully authorized and inside every rate
 * limit, and halts D1 for every other Organization. Nothing about that is abuse; it is a customer
 * doing the thing the product is for. So the answer is admission and queueing, not detection.
 *
 * ===========================================================================================
 * WHAT THIS IS NOT — `0014` §A.13, and it is not a hedge
 * ===========================================================================================
 *
 * **THIS IS INTERNAL CONSERVATIVE ACCOUNTING. Dudo cannot read Cloudflare's counter.** Nothing
 * here queries an account, an analytics API or a `meta.rows_written` field. Every number below is
 * an estimate Dudo makes about itself, deliberately larger than the truth
 * (`storage/write-cost.ts`), against a limit Cloudflare enforces and does not report back. Two
 * consequences follow and neither may be papered over:
 *
 *   - Dudo can be at 40,000 by its own books while the account is elsewhere entirely, because a
 *     migration, a manual query or another Worker on the same account also spends the allowance.
 *     THAT is what the 20,000 safety margin is for.
 *   - No report, comment, standard or PR may describe this as knowing the remaining quota. It
 *     knows what Dudo asked permission for.
 *
 * ===========================================================================================
 * THE ARITHMETIC, IN FULL, BECAUSE `0008` REQUIRES A FREE-TIER IMPACT CHECK
 * ===========================================================================================
 *
 *   D1 Free, enforced since 2026-09-01, ACCOUNT-WIDE     100,000 rows written / UTC day
 *   Platform ceiling (§A.3)                             - 80,000
 *   Safety margin (§A.4), NOT spendable capacity        = 20,000
 *
 *   Within the 80,000 (§A.5):
 *     business mutations and their audit records          60,000
 *     security and audit summaries                        10,000
 *     controlled system operations                        10,000
 *                                                       = 80,000   exactly, and asserted below
 *
 *   Per Organization (§A.6)                               10,000 / UTC day
 *     a Customer create costs                                  8 estimated row-writes
 *     so an Organization creates at most                   1,250 customers / day
 *     six Organizations at their full ceiling saturate the 60,000 business allocation
 *
 * §A.7 and §A.8 say two units and 5,000 customers. Those count ROWS INSERTED, not row-writes;
 * the conversion, and why the safe direction is the larger number, is `storage/write-cost.ts`.
 * The ceilings themselves are implemented exactly as `0014` decided them.
 *
 * NOTHING CAN EXCEED THE PLATFORM CEILING BY CONSTRUCTION. `assertAllocationsAreCoherent()` runs
 * at module load: the three allocations must sum to the ceiling, and the ceiling plus the margin
 * must not exceed the enforced allowance. There is no code path that adds to an allocation, no
 * allocation that can borrow from another, and no reservation that is granted without a
 * decrement. A budget that could be topped up is not a budget.
 *
 * ===========================================================================================
 * HOW `0014` §A.11 IS MADE STRUCTURAL — "all storage writers must use this admission port"
 * ===========================================================================================
 *
 * The same four devices `storage/store.ts` uses to make the tenant predicate unavoidable, aimed
 * at a different miss:
 *
 *   1. **`TenantScopedStore.write` TAKES A RESERVATION.** It is a required parameter, not an
 *      option. There is no overload without one and no default. A writer that has not reserved
 *      cannot express the call.
 *   2. **A RESERVATION IS NOMINALLY TYPED AND RUNTIME-BRANDED.** A plain object with the right
 *      fields is not one. The brand is a non-enumerable symbol checked before any statement is
 *      compiled, because this repository has no type-check step and a type-only brand would be
 *      a comment.
 *   3. **THE ONLY CONSTRUCTOR IS `mintWriteReservation`, AND IT IS CALLED BY THE COORDINATOR
 *      AFTER THE BUDGET HAS ALREADY BEEN DECREMENTED.** Minting is the receipt for a spend that
 *      has happened, not the spend itself, so a stray call mints against nothing.
 *   4. **A RESERVATION IS SINGLE-USE AND TENANT-PINNED.** `consumeWriteReservation` refuses a
 *      second use and refuses a tenant that does not match the handle, so one reservation cannot
 *      fund a loop and one Organization's reservation cannot fund another's write.
 *
 * The result is the property §A.11 asks for: `storage/adapters/d1/d1-store.ts` is the only file
 * that names D1, and it refuses to compile a statement without a valid, unspent, matching
 * reservation. A direct D1 write outside this port is not discouraged — it cannot be written
 * without editing that one file, which is exactly the review surface the tenant predicate has.
 *
 * ===========================================================================================
 * WHAT HAPPENS AT EXHAUSTION — §A.10, AND WHY IT DIFFERS FROM `0013`'s CEILING ON PURPOSE
 * ===========================================================================================
 *
 * §A.10: mutations return `429` with a retry time after the next UTC reset, and **reads remain
 * available**. `0013`'s summary ceiling does the opposite: writes stop, and the caller's response
 * is deliberately UNCHANGED. Both are right, and anyone tempted to harmonise them should read
 * this paragraph first.
 *
 *   `0013`'s CEILING BOUNDS EVIDENCE, AND THE EVIDENCE PATH RUNS AFTER THE ANSWER IS DECIDED.
 *   The request was already refused; the summary is a record of that refusal. Refusing the
 *   request BECAUSE its evidence could not be stored would let an attacker burn the evidence
 *   budget and thereby refuse everyone — a second denial-of-service lever, which is the exact
 *   mistake `0013` was written to correct. So the ceiling is invisible to the caller.
 *
 *   THIS BUDGET BOUNDS THE MUTATION ITSELF, AND THE WRITE IS THE REQUEST'S ENTIRE PURPOSE.
 *   There is nothing to continue silently with. Accepting a create and not writing it is data
 *   loss reported as success, which is worse than any refusal. So the caller is told, plainly,
 *   with a `429` and a retry time.
 *
 *   AND IT IS NOT A NEW LEVER, because the budget that binds first is the caller's OWN
 *   Organization's 10,000. A caller can exhaust what its Organization may spend; it cannot
 *   exhaust another Organization's, and it cannot stop anyone reading. Reads are never admitted
 *   through this port — a `select` takes no reservation — so a blanket read failure is not a
 *   state this design can reach.
 *
 * THE RETRY TIME MUST NOT BECOME AN ORACLE, and `retryAfterSecondsUntilReset` is why it is not:
 * it is a pure function of the clock — seconds to the next 00:00 UTC — and is byte-identical
 * whether the Organization hit its own ceiling or the platform allocation ran out. A caller
 * therefore learns nothing about platform-wide activity, and nothing about any other tenant, from
 * either the code, the message or the header. `quotaExceeded()` takes no arguments for the same
 * reason `notFound()` does not.
 */

import type { Result } from '../kernel/result.ts';

// =============================================================================================
// The day
// =============================================================================================

/** Cloudflare resets its Free daily limits at 00:00 UTC. Every window in this file is that one. */
export const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(nowMs: number): number {
  return Math.floor(nowMs / UTC_DAY_MS) * UTC_DAY_MS;
}

export function nextUtcResetMs(nowMs: number): number {
  return utcDayStart(nowMs) + UTC_DAY_MS;
}

/**
 * Seconds until the next 00:00 UTC. `0014` §A.10's "a retry time after the next UTC reset".
 *
 * A PURE FUNCTION OF THE CLOCK AND OF NOTHING ELSE. It does not consult a budget, a tenant or a
 * counter, so it cannot vary with anything a caller could correlate — see the header on why that
 * matters. At least one second, because `Retry-After: 0` invites the retry the header exists to
 * delay.
 */
export function retryAfterSecondsUntilReset(nowMs: number): number {
  return Math.max(1, Math.ceil((nextUtcResetMs(nowMs) - nowMs) / 1000));
}

// =============================================================================================
// The ceilings — `0014` §A.3, §A.4, §A.5, §A.6
// =============================================================================================

/**
 * What Cloudflare enforces, account-wide, and what exceeding it means.
 *
 * "Beginning September 1, 2026, D1 queries on the Workers Free plan will fail when an account
 * exceeds the daily row read or row write limits" — Cloudflare changelog, 2026-09-01. It is an
 * OUTAGE for every Organization, not a bill. Recorded here as the number every ceiling below is
 * reasoned against, and it is NOT a value Dudo can observe; see the header.
 */
export const D1_FREE_DAILY_ROW_WRITES = 100_000;

/** §A.3. The most Dudo will admit in a UTC day, by its own conservative estimate. */
export const PLATFORM_DAILY_ROW_WRITE_CEILING = 80_000;

/**
 * §A.4. **Not spendable capacity.** There is deliberately no port, function or allocation that
 * can draw on this, which is the only form of margin that survives a busy week: estimation drift,
 * a migration, an operator's emergency query, and anything else on the account that Dudo does not
 * account for at all.
 */
export const PLATFORM_DAILY_SAFETY_MARGIN = 20_000;

export type WriteAllocation = 'business' | 'security' | 'system';

/**
 * §A.5. Three allocations, summing to the ceiling exactly.
 *
 * They do not borrow from one another, and that is the point of splitting them: a probing campaign
 * cannot spend the product's capacity through the evidence path, and a system job cannot spend a
 * tenant's. Each is a separate counter in the ledger.
 *
 *   business   normal mutations AND their audit records. The audit row is charged to the same
 *              allocation as the mutation it belongs to, because it is not optional and pricing
 *              it elsewhere would let the business allocation look affordable while the security
 *              one silently paid for it.
 *   security   denial summaries (`0013`) and the security evidence AZ2 adds. See
 *              `coordination.ts` for how `0013`'s own ceiling was folded INTO this number rather
 *              than left beside it.
 *   system     controlled system operations — migrations, retention, scheduled maintenance.
 *              NOTHING SPENDS THIS TODAY. It is declared so that the first system writer draws
 *              from a reserved allocation rather than from the product's.
 */
export const DAILY_ALLOCATION: Readonly<Record<WriteAllocation, number>> = {
  business: 60_000,
  security: 10_000,
  system: 10_000,
};

/**
 * §A.6. One Organization's share of the business allocation.
 *
 * SIX ORGANIZATIONS AT THIS CEILING SATURATE THE 60,000, and that is stated rather than
 * discovered: past six active Organizations the platform allocation binds before the
 * per-Organization one, so the seventh Organization is refused by a budget it did not spend. That
 * is the correct failure — a shared account-wide allowance cannot be divided into unlimited
 * private ones — and it is the number to watch as Organizations are admitted
 * (`docs/operations/free-tier-register.md`).
 */
export const PER_ORGANIZATION_DAILY_ROW_WRITES = 10_000;

/**
 * ===========================================================================================
 * *** HOW MUCH OF ONE ORGANIZATION'S DAY THE PLATFORM MAY SPEND. 1,000 OF THE 10,000 ABOVE. ***
 * Team Lead ruling, 2026-09-05.
 * ===========================================================================================
 *
 * **IT IS A PRODUCT JUDGEMENT, NOT A DERIVED VALUE.** Nothing computes 1,000 — it is a decision
 * about how much support access is worth to a customer against how much disruption is tolerable,
 * it is reversible, and it is expected to move once there is real usage. **Do not treat it as
 * arithmetic and do not "correct" it to match another number.**
 *
 * ===========================================================================================
 * WHAT IT BOUNDS, AND WHY THE OTHER TWO FIXES DID NOT
 * ===========================================================================================
 *
 * Two platform routes write into a CUSTOMER'S tenant database — the member resolve and the scoped
 * audit feed — at 5 row-writes each. Measured on 2026-09-05: **2,000 calls exhausted one named
 * Organization's entire 10,000/day allocation**, after which **that customer's own mutations
 * started failing**, for a reason they could not see.
 *
 * TWO FIXES CAME FIRST AND NEITHER CLOSED IT:
 *
 *   - **The operator-charge receipt** (`platform-audit.ts`) bounds ONE operator at 300 calls =
 *     1,500 row-writes. **Three operators reach 4,500.**
 *   - **`PO-4`, the durable rate limiter**, would bound each operator harder. **It is keyed to the
 *     operator too.**
 *
 * **BOTH BOUND THE ATTACKER WHILE THE EXPOSURE IS A PROPERTY OF THE TARGET.** N operators — or one
 * taken session plus two colleagues — still sum onto one customer. **This constant is keyed to the
 * VICTIM**, so one operator, three operators and ten all hit the same 1,000. That is the whole
 * reason it exists and it is the test any future proposal here should be measured against.
 *
 * ===========================================================================================
 * THE NUMBER
 * ===========================================================================================
 *
 * **1,000 row-writes = 200 platform-originated operations against one customer per day, SHARED
 * ACROSS ALL OPERATORS.** A real support session is a handful of resolves and a handful of feed
 * reads — call it 20 operations, 100 row-writes, **10% of this ceiling.** 200 operations against a
 * single named customer in one day is not a support session, it is a script.
 *
 * **IT BINDS BEFORE THE OPERATOR RECEIPT DOES** — 1,000 against that fix's 1,500 — and that is
 * deliberate: the victim's exposure should be decided by the victim's ceiling, not by how many
 * attackers there are.
 *
 * ===========================================================================================
 * *** IT DRAWS **FROM** THE 10,000 ABOVE. IT DOES NOT SIT BESIDE IT. ***
 * ===========================================================================================
 *
 * A platform-originated write increments BOTH counters and BOTH ceilings must admit it.
 * Otherwise platform writes could push an Organization past its real allocation, which is the
 * outcome this whole exercise exists to prevent.
 *
 * **THE CONSEQUENCE, STATED RATHER THAN DISCOVERED:** a customer who has legitimately spent 9,600
 * of their own 10,000 refuses platform-originated writes at 400, even though this sub-ceiling has
 * 1,000 left. **A busy customer is harder to support on their busiest day.** That is the rule
 * working — an operator cannot spend capacity the customer needs — and it is the correct
 * direction, because the alternative is a customer's own product breaking so that an operator
 * could look at it.
 *
 * ---------------------------------------------------------------------------------------------
 * *** THE RESIDUAL, AND THE CORRELATION IS THE POINT OF RECORDING IT ***
 * ---------------------------------------------------------------------------------------------
 *
 * **THE CUSTOMER MOST LIKELY TO NEED SUPPORT IS THE ONE WHOSE USAGE IS SPIKING, AND THIS DESIGN
 * MAKES THEM THE HARDEST TO SUPPORT.** A customer at 9,600 gets about **80 operations** of platform
 * assistance **on precisely the day something is going wrong for them.**
 *
 * **That is not a hypothetical edge. It is the correlated case** — a support ceiling that tightens
 * exactly when support is most needed — and it is recorded here so whoever revisits it with real
 * usage finds the tradeoff stated rather than rediscovering it during an incident.
 *
 * **ACCEPTED, 2026-09-05, FOR THREE REASONS THAT ARE REASONS RATHER THAN BACKGROUND:**
 *
 *   1. **The alternative reinstates the defect.** Letting platform writes exceed the customer's
 *      allocation is exactly what was just fixed.
 *   2. **Reserving a slice for support instead** — capping the customer's own writes at 9,000 —
 *      **penalises every customer every day for a rare event.**
 *   3. **There are zero customers and zero operators today**, so the cost of choosing wrong now is
 *      nil and the cost of choosing complexity is not.
 *
 * **WHAT WOULD CHANGE THE ANSWER:** real usage showing customers routinely near their ceiling, or
 * a support incident where 80 operations was not enough. Neither is observable yet, and **nothing
 * measures the first** — the same gap the ledger finding below names.
 *
 * ===========================================================================================
 * THE REFUSAL LANDS ON THE OPERATOR AND NEVER ON THE CUSTOMER
 * ===========================================================================================
 *
 * Structurally, not by policy: this counter is incremented only by writes marked
 * `'platform'`, and the only callers that mark them so are the two platform services. **A
 * customer's own mutations go through `pipeline.ts`, which passes `'tenant'`, so they are checked
 * against the 10,000 alone and cannot be refused by a counter they cannot increment.**
 *
 * **If a customer can still experience their own product breaking because of platform activity,
 * this has not worked** — that is the property to test, and it is the reason the origin is a
 * required parameter rather than a defaulted one.
 */
export const PLATFORM_ORIGINATED_DAILY_ROW_WRITES = 1_000;

/**
 * ===========================================================================================
 * *** TWO THINGS FOR WHOEVER PROPOSES `PO-4`, THE DURABLE RATE LIMITER, RECORDED HERE BECAUSE
 * THIS IS THE FILE THEY WILL BE READING WHEN THEY DO. ***
 * ===========================================================================================
 *
 * ---------------------------------------------------------------------------------------------
 * 1. A STANDALONE FINDING, TRUE TODAY REGARDLESS OF WHAT IS BUILT NEXT
 * ---------------------------------------------------------------------------------------------
 *
 * **`createDurableObjectDayWriteBudget` reaches a SINGLE GLOBAL Durable Object instance**
 * (`LEDGER_INSTANCE`), and it sits on the path of **every control-plane write — including session
 * creation.**
 *
 * The Durable Objects allowance is **100,000 requests/day, ACCOUNT-WIDE AND SHARED**. So exhausting
 * it does not degrade an audit feed or a background job: **nothing can log in.** The consumer that
 * degrades first is authentication, and the symptom is *"sign-in is broken"* with a cause nobody
 * would trace to a write ledger.
 *
 * **AND NOTHING MEASURES HOW CLOSE THAT IS.** Not a monitor, not a counter, not an alarm. That is
 * the finding, and it does not depend on `PO-4` ever being built.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE CAVEAT ON THE ANALYSIS THAT DEFERRED `PO-4`, WHICH IS EASY TO CITE WITHOUT
 * ---------------------------------------------------------------------------------------------
 *
 * The analysis said: `free-tier-register.md`'s boxed hazard concerns a limiter **in front of
 * authentication**, and a platform route's steps 1–4 touch **no Durable Object at all** — a caller
 * with no valid session is refused before any DO call — so **an unauthenticated flood against the
 * platform class costs zero DO requests.** That is measured and it is true.
 *
 * *** IT DOES NOT SAY A LIMITER IS AFFORDABLE, AND IT STOPS BEING TRUE THE MOMENT ANYONE PUTS
 * `PO-4` IN FRONT OF AUTHENTICATION — WHICH IS WHERE RATE LIMITERS USUALLY BELONG. ***
 *
 * It narrows one hazard for one placement. It does not answer what a limiter costs at realistic
 * load, and it is not a capacity check. **§6a still requires one**, and a check on a new Durable
 * Object may not stop at *"does it fit inside 100,000"* — it must name which other consumer it
 * shares with and what happens to that consumer at the limit. The answer to the second half is
 * above: **logins stop.**
 *
 * WHY THIS IS IN THE CODE AND NOT ONLY IN A MESSAGE: the next person to propose `PO-4` will find
 * the analysis and may not find the caveat. `workflow.md` §12 — an assertion that a known problem
 * does not apply is a claim, and it needs to name which side it is talking about.
 */

/**
 * Runs at module load. A budget whose parts do not add up is not a budget, and discovering that
 * from production traffic is discovering it too late.
 */
export class WriteBudgetIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteBudgetIncoherentError';
  }
}

/**
 * ===========================================================================================
 * THE PARAMETERS EXIST SO THE THREE THROW BRANCHES CAN BE REACHED FROM A TEST. THEY DEFAULT TO
 * THE SHIPPED CONSTANTS, SO EVERY EXISTING CALL IS UNCHANGED.
 * ===========================================================================================
 *
 * This function took no arguments and read module-level `const` bindings directly, which ESM does
 * not let a test rebind. `qa-agent` recorded the consequence honestly rather than working around
 * it — the case was reported SKIPPED with the note that reaching the branches "would mean editing
 * `platform/core/**`, which qa-agent does not do", and a recommendation addressed to `core-agent`
 * to add exactly these parameters. This is that change, made by the owner of the file, on the
 * Team Lead's instruction.
 *
 * WHAT IT BUYS AND WHY IT IS WORTH A SIGNATURE CHANGE. The suite could already assert each of the
 * three invariants separately against the shipped values, so a drift would go red — but it could
 * NOT assert that this function throws rather than, say, comparing the wrong pair of numbers. A
 * coherence check that is itself unchecked is a guard nobody has watched fail.
 *
 * THE DEFAULTS ARE THE POINT, NOT A CONVENIENCE. `assertAllocationsAreCoherent()` with no
 * arguments still validates the real constants, still runs at module load below, and still stops
 * the module rather than shipping an incoherent budget. A test supplies deliberately broken values
 * to prove the guard bites; nothing in production supplies anything.
 */
export function assertAllocationsAreCoherent(
  allocation: Readonly<Record<WriteAllocation, number>> = DAILY_ALLOCATION,
  platformCeiling: number = PLATFORM_DAILY_ROW_WRITE_CEILING,
  safetyMargin: number = PLATFORM_DAILY_SAFETY_MARGIN,
  perOrganization: number = PER_ORGANIZATION_DAILY_ROW_WRITES,
  d1DailyLimit: number = D1_FREE_DAILY_ROW_WRITES,
): void {
  const total = allocation.business + allocation.security + allocation.system;
  if (total !== platformCeiling) {
    throw new WriteBudgetIncoherentError(
      `The daily allocations sum to ${String(total)} and the platform ceiling is ` +
        `${String(platformCeiling)} (docs/decisions/0014 §A.5). They must be ` +
        'equal: an allocation set that sums to less leaves capacity nothing can spend, and one ' +
        'that sums to more is a ceiling that does not bound.',
    );
  }
  if (platformCeiling + safetyMargin > d1DailyLimit) {
    throw new WriteBudgetIncoherentError(
      'The platform ceiling plus the safety margin exceeds the enforced account-wide D1 daily ' +
        'row-write allowance (docs/decisions/0014 §A.3 and §A.4).',
    );
  }
  if (perOrganization > allocation.business) {
    throw new WriteBudgetIncoherentError(
      'One Organization may not be permitted more than the whole business allocation ' +
        '(docs/decisions/0014 §A.5 and §A.6).',
    );
  }
}

assertAllocationsAreCoherent();

// =============================================================================================
// The reservation — §A.11 and §A.12
// =============================================================================================

const WRITE_RESERVATION_BRAND: unique symbol = Symbol('dudo.protection.writeReservation');

/**
 * Permission to write, already paid for.
 *
 * IT IS A RECEIPT, NOT A REQUEST. By the time one of these exists the day's counters have already
 * been decremented, so losing it, dropping it or failing to use it costs the budget exactly what
 * using it would have — which is §A.12's "uncertain or partially consumed reservations are not
 * refunded", made true by there being no refund path rather than by a rule nobody enforces.
 *
 * THERE IS NO FIELD HERE THAT NAMES A RECORD, A TABLE, A COLUMN OR A VALUE. A reservation says
 * how much, for whom, from which allocation, on which day. It is not a capability over data and
 * cannot be used to reach any.
 */
export type WriteReservation = {
  readonly [WRITE_RESERVATION_BRAND]: true;
  /** The Organization the reservation was granted to. Checked against the store handle's tenant. */
  readonly organizationId: string;
  readonly allocation: WriteAllocation;
  /** The worst-case cost that was charged. The write may cost less; it may never cost more. */
  readonly estimatedRowWrites: number;
  /** The UTC day the charge was made against. A reservation does not survive the reset. */
  readonly dayStartMs: number;
};

/**
 * Single-use tracking, held outside the value so the value itself stays frozen and inert.
 *
 * A `WeakSet` rather than a flag on the object: a mutable flag is a field a caller could reset,
 * and a frozen object with a mutable field is neither one thing nor the other.
 */
const CONSUMED_RESERVATIONS = new WeakSet<object>();

/**
 * ===========================================================================================
 * THE ONLY CONSTRUCTOR. CALL IT ONLY AFTER THE DAY'S COUNTERS HAVE BEEN DECREMENTED.
 * ===========================================================================================
 *
 * Minting is the receipt for a spend that has already happened. The coordinator calls this
 * immediately after `admitWrite`/`spendWritePermits` has taken the units out of the
 * per-Organization counter and the platform reserve; nothing else has any business calling it.
 *
 * IF THIS IS EVER CALLED ON A PATH THAT DID NOT DECREMENT A COUNTER, `0014` §A.1 is defeated —
 * writes proceed against an account-wide allowance with nothing accounted, which is the state
 * this whole decision exists to end. It is named for its single purpose and stated in capitals
 * rather than left to look general, exactly as `rehydratePersistedDenialGroupKey` is.
 */
export function mintWriteReservation(fields: {
  readonly organizationId: string;
  readonly allocation: WriteAllocation;
  readonly estimatedRowWrites: number;
  readonly dayStartMs: number;
}): WriteReservation {
  const reservation = {
    organizationId: fields.organizationId,
    allocation: fields.allocation,
    estimatedRowWrites: fields.estimatedRowWrites,
    dayStartMs: fields.dayStartMs,
  };
  Object.defineProperty(reservation, WRITE_RESERVATION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(reservation) as WriteReservation;
}

/**
 * Thrown, not returned, and for the same reason `TenantColumnReferencedError` is.
 *
 * A write arriving without a valid reservation is not a request that failed — no client can cause
 * one, because clients supply values and never reservations. It is Dudo's own code writing to an
 * account-wide allowance without accounting for it. Returning an error would let it be handled,
 * logged, and shipped; throwing stops the request and surfaces as `internal`, disclosing nothing.
 */
export class WriteNotAdmittedError extends Error {
  constructor(reason: string) {
    super(
      `A D1 write was attempted without a valid write reservation: ${reason}. Every production ` +
        'mutation must reserve a conservative cost from the daily budget BEFORE it executes ' +
        '(docs/decisions/0014 §A.1 and §A.11). Direct writes outside the admission port are ' +
        'prohibited: they are unaccounted capacity against an ACCOUNT-WIDE allowance whose ' +
        'exhaustion stops D1 answering for every Organization.',
    );
    this.name = 'WriteNotAdmittedError';
  }
}

/** The brand check. Runs before anything is compiled or sent. */
export function assertWriteReservation(value: WriteReservation): void {
  const branded = value as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[WRITE_RESERVATION_BRAND] !== true) {
    throw new WriteNotAdmittedError('the value did not come from mintWriteReservation');
  }
}

/**
 * Spends a reservation on one batch, or throws.
 *
 * FOUR CHECKS, AND EACH ONE CLOSES A WAY THE BUDGET COULD HAVE BEEN BYPASSED:
 *
 *   1. THE BRAND. A hand-built object is not a reservation.
 *   2. SINGLE USE. Without this, one reservation for eight row-writes could fund a loop of
 *      arbitrary batches — a reservation is per-batch, not per-request and not per-session.
 *   3. THE TENANT. A reservation granted to one Organization cannot fund another's write, so a
 *      handle mix-up cannot become a cross-tenant charge or a cross-tenant row.
 *   4. THE SIZE. Every statement writes AT LEAST one row, so a batch of more statements than
 *      row-writes reserved is provably under-reserved. This is the backstop that catches ANY
 *      writer, not only an Action that mis-declared: it is checked at the adapter, below every
 *      caller.
 *
 * Check 4 is a lower bound, not the true cost — the true cost includes index rows the adapter
 * cannot count. The Action's declaration (`action.ts`, `maxRowWrites`) carries that part, and
 * `storage/write-cost.ts` explains why both are needed.
 */
export function consumeWriteReservation(
  reservation: WriteReservation,
  organizationId: string,
  statementCount: number,
): void {
  assertWriteReservation(reservation);
  if (CONSUMED_RESERVATIONS.has(reservation)) {
    throw new WriteNotAdmittedError('the reservation had already been spent');
  }
  if (reservation.organizationId !== organizationId) {
    throw new WriteNotAdmittedError(
      'the reservation was granted to a different Organization than the store handle serves',
    );
  }
  if (statementCount > reservation.estimatedRowWrites) {
    throw new WriteNotAdmittedError(
      `the batch has ${String(statementCount)} statements and only ` +
        `${String(reservation.estimatedRowWrites)} row-writes were reserved; every statement ` +
        'writes at least one row',
    );
  }
  CONSUMED_RESERVATIONS.add(reservation);
}

// =============================================================================================
// The port
// =============================================================================================

/**
 * WHICH CEILING REFUSED A WRITE. Two values, and they mean opposite things.
 *
 *   `'platform-share'` — the OPERATOR spent this Organization's platform share. About the caller.
 *   `'organization'`   — the CUSTOMER is at their own daily allocation. About the customer.
 *
 * **DECLARED HERE RATHER THAN IN `coordination-engine.ts` TO KEEP THE IMPORT DIRECTION ONE-WAY.**
 * The engine already imports this module; the reverse would be a cycle, and a type-only cycle is
 * the kind that compiles and then surprises whoever adds the first value import.
 *
 * The full argument — why the distinction is a security property, what it discloses, and why it
 * must never become a remaining COUNT — is at `admitWrite` in the engine.
 */
export type WriteAdmissionRefusal = 'platform-share' | 'organization';

export type WriteAdmissionOutcome =
  /** Charged. The reservation is the receipt; see `WriteReservation`. */
  | { readonly kind: 'granted'; readonly reservation: WriteReservation }
  /**
   * The budget is spent for this UTC day. NOT "denied" and not "failed" — DEFERRED.
   *
   * THE WORD IS THE DESIGN, AND IT IS `0014` §A.9. A fifty-thousand-record import is a queued
   * operation that continues across daily windows, so the thing a caller needs is not a refusal
   * but a time. A request path renders this as `429` with `retryAfterSeconds`; a queued consumer
   * schedules itself for `resumeAfterMs` and continues where it stopped. Same port, same answer,
   * two readings of it — which is what makes "the import cannot bypass the budget" true by
   * construction rather than by the importer's good behaviour.
   */
  | {
      readonly kind: 'deferred';
      /**
       * WHICH CEILING REFUSED. `'organization'` unless the platform sub-ceiling bound first.
       *
       * A TENANT CALLER MUST IGNORE THIS. `pipeline.ts` renders the same answer either way, and
       * a tenant can only ever see `'organization'` because a `'tenant'` write cannot reach the
       * platform sub-ceiling. **It exists for the operator-facing routes**, where the two mean
       * opposite things — "you have done too much" against "this customer is having a bad day" —
       * and an operator who cannot tell them apart retries.
       *
       * SEE `WriteAdmissionRefusal` for the disclosure this carries and why it is one bit rather
       * than a count.
       */
      readonly refusedBy: WriteAdmissionRefusal;
      /** Epoch milliseconds of the next 00:00 UTC. For a scheduler. */
      readonly resumeAfterMs: number;
      /** The same instant in seconds from now, for `Retry-After`. Discloses nothing; see header. */
      readonly retryAfterSeconds: number;
    };

/**
 * The admission port for a writer that is NOT serving a request — a queue consumer continuing a
 * bulk import, a scheduled job, a system operation.
 *
 * A REQUEST-SCOPED WRITER DOES NOT USE THIS. It uses `RequestCoordination.reserveWrites`
 * (`coordination.ts`), which is the same accounting reached through the coordination handle the
 * request already holds — so an ordinary mutation costs no additional coordinator round trip
 * beyond the one it makes, and the Organization is bound by the authenticated context rather than
 * passed as an argument.
 *
 * THE BULK-IMPORT FEATURE ITSELF IS NOT BUILT. There is no import endpoint, no queue binding and
 * no consumer in this repository, and building one is a separate slice with its own contract.
 * What exists here is the half `0014` §A.9 makes non-negotiable: whatever imports, imports through
 * this, and cannot obtain a write any other way.
 */
export type WriteAdmission = {
  reserve(request: {
    /** Server-derived. There is no path by which a caller supplies this. */
    readonly organizationId: string;
    /** WORST CASE, per §A.12. Over-reserving delays a write; under-reserving is an outage. */
    readonly estimatedRowWrites: number;
    readonly nowMs: number;
  }): Promise<Result<WriteAdmissionOutcome>>;
};

/**
 * The account-wide day ledger. Holds a UTC day and one integer per allocation, and NO TENANT
 * IDENTIFIER OF ANY KIND.
 *
 * IT REPLACES `0013`'s `SummaryWriteBudget` RATHER THAN SITTING BESIDE IT, which is the whole of
 * the reconciliation `0014` §A.5 requires. Two independent daily ceilings — one for summaries, one
 * for mutations — would sum past the platform ceiling by construction, and each would be correct
 * about itself while the account went down. Now there is ONE ledger with three named allocations,
 * and denial summaries draw from `security` exactly as a create draws from `business`.
 *
 * WHY IT IS THE ONE PIECE OF COORDINATION STATE THAT IS NOT PER-ORGANIZATION, restated because
 * `CLOUDFLARE_STANDARD.md` §7 rule 3 says an instance belongs to one tenant: a per-Organization
 * budget cannot reserve an ACCOUNT-WIDE allowance, because the account total would be the
 * per-tenant ceiling multiplied by a tenant count nobody bounds. The rule exists so two tenants'
 * DATA does not share an instance. A day and three integers are not data about a tenant.
 */
export type DayWriteBudget = {
  /** Requests `wanted` row-writes from one allocation for a UTC day. Returns how many were granted. */
  take(dayStartMs: number, allocation: WriteAllocation, wanted: number): Promise<Result<number>>;
};
