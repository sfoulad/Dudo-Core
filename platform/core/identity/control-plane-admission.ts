/**
 * ===========================================================================================
 * DAILY D1 WRITE ADMISSION FOR THE CONTROL PLANE. `docs/decisions/0014` §A applied to §C.
 * ===========================================================================================
 *
 * §A.11: "All storage writers must use this admission port. Direct D1 writes outside it are
 * prohibited." §C.7: "The separate database is an isolation boundary, not additional quota.
 * Cloudflare's daily D1 limit is ACCOUNT-WIDE, so splitting the data changes what can reach
 * what — it does not raise the ceiling."
 *
 * Both sentences point at this file. A control-plane write lands in a different database and
 * consumes THE SAME account-wide allowance as a Customer create, so it must be accounted in the
 * same ledger, in the same unit, on the same UTC day — or `0014` §A is a budget with a hole in
 * it the size of every login.
 *
 * ===========================================================================================
 * THE EXPOSURE, COUNTED, BECAUSE IT IS THE SAME HOLE §A CLOSED AND IT IS STILL OPEN HERE
 * ===========================================================================================
 *
 *   a session insert                     = 3 estimated row-writes (see SESSION_ROW_WRITES)
 *   the actor rate limit is 60/min       = 86,400 requests/day per credential
 *   one valid credential, logging in     = 259,200 row-writes/day
 *   against the ENFORCED, ACCOUNT-WIDE   = 100,000/day
 *
 * So ONE holder of ONE valid credential can take D1 down for every Organization by doing nothing
 * but logging in — no privilege, no tenant data touched, entirely inside every rate limit. It is
 * §A's arithmetic with `CreateCustomer` replaced by `POST /session`, and it is worse in one
 * respect: the login path is reachable before authorization, so nothing above it can refuse.
 *
 * ===========================================================================================
 * WHICH ALLOCATION. THE ANSWER IS `system`, AND IT IS THE LEAST BAD OF THREE IMPERFECT FITS.
 * ===========================================================================================
 *
 * `0014` §A.5 names three allocations inside the 80,000 ceiling. None was written with an
 * identity control plane in mind, so this is reasoned rather than looked up, and the reasoning
 * is recorded here because the conclusion is a judgement and should be reviewable as one.
 *
 * `business` — 60,000, with a 10,000/day per-Organization ceiling. REJECTED, twice over. At
 *   login there is no Organization, so there is no per-Organization counter to charge and the
 *   write would draw on the platform-level business allocation with no tenant-level bound at
 *   all — anonymous-ish traffic spending the product's capacity. And if it were charged to an
 *   Organization after selection, a principal could exhaust its own Organization's ability to
 *   create Customers by logging in 3,333 times. A capacity control that an attacker can aim at
 *   a tenant's product is the failure mode `0013` and `0014` both exist to stop.
 *
 * `security` — 10,000, holding denial summaries. REJECTED ON ARITHMETIC. `protection/
 *   coordination.ts` shows the allocation accommodating "roughly four simultaneous all-day
 *   campaigns" at 2,304 row-writes each — 9,216 of 10,000 already spoken for. Sessions drawn
 *   from the same pot would crowd out attack evidence, and lost evidence is the one failure in
 *   this system that cannot be recovered afterwards.
 *
 * `system` — 10,000, described as "controlled system operations — migrations, retention,
 *   scheduled maintenance", with the note "NOTHING SPENDS THIS TODAY". CHOSEN, AND THE STRETCH
 *   IS STATED PLAINLY: A LOGIN IS NOT A "CONTROLLED SYSTEM OPERATION". It is triggered from
 *   outside, by a party the platform has not yet authorized. That is a genuine mismatch with
 *   §A.5's description and it is reported, not smoothed over.
 *
 *   It is chosen anyway, for two reasons that hold regardless of the label. First, the failure
 *   modes are asymmetric: exhausting `system` delays migrations and retention, which the
 *   platform controls and can reschedule; exhausting `security` destroys evidence and
 *   exhausting `business` stops every tenant's work. Between three bad outcomes, the recoverable
 *   one is the right one to expose. Second, `system` is the only allocation with real headroom,
 *   and the sub-ceiling below leaves most of it intact for the operations it was reserved for.
 *
 * THIS BELONGS IN A DECISION RECORD. `0014` §A.5's three-way split does not have a slot for an
 * externally-triggered platform write, and choosing one in a source file is choosing it in the
 * wrong place. The Team Lead is asked to record it; until then this constant is the
 * implementation's stated assumption and is written where a reviewer will see it.
 *
 * ===========================================================================================
 * WHY THE RECEIPT IS A DIFFERENT TYPE FROM `WriteReservation`
 * ===========================================================================================
 *
 * `protection/write-admission.ts`'s `WriteReservation` carries an `organizationId`, and
 * `consumeWriteReservation` checks it against the tenant the store handle serves — which is what
 * stops a handle mix-up becoming a cross-tenant charge. A control-plane store serves NO tenant,
 * so that check has nothing to compare against and the field would have to be filled with a
 * placeholder. A placeholder in a security check is a security check that has been switched off
 * quietly.
 *
 * So the control plane has its own branded receipt with its own invariant: it is bound to a
 * PRINCIPAL, not to an Organization, and the adapter refuses a forged, spent or undersized one
 * exactly as the D1 tenant adapter does. Both draw from the SAME `DayWriteBudget`, which is the
 * property that matters — one ledger, one day, one account-wide allowance.
 *
 * `protection/write-admission.ts` is not edited by this work. Folding the two receipts into one
 * shape is a reasonable later refactor and is noted for whoever owns that file.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { internal } from '../kernel/errors.ts';
import type { DayWriteBudget, WriteAllocation } from '../protection/write-admission.ts';
import {
  DAILY_ALLOCATION,
  nextUtcResetMs,
  retryAfterSecondsUntilReset,
  utcDayStart,
} from '../protection/write-admission.ts';

// =============================================================================================
// What a control-plane write costs. Counted against the migrations, exactly as
// `storage/write-cost.ts` counts the tenant tables, and by the same conservative rules.
// =============================================================================================

/**
 * `session` (`migrations/control-plane/0004_session.sql`):
 *   1 table row
 * + PRIMARY KEY (session_id)                                   implicit index
 * + session_by_principal
 * = 3.
 *
 * THIS IS THE PER-LOGIN COST, and it is the number every ceiling below is computed from.
 *
 * IT IS THREE AND NOT FOUR BECAUSE THERE IS DELIBERATELY NO INDEX ON `expires_at`. Retention
 * scans the table instead, once a day, as a system operation: the table holds live sessions plus
 * at most one day of expired ones, which is a few hundred rows in the ten-Organization closed
 * beta (`MULTITENANCY_STANDARD.md` §7.5). A fourth index would cost 33% more on every login to
 * save a scan of a table that small. `migrations/control-plane/0004_session.sql` states the
 * threshold at which that trade stops being right.
 *
 * WHEN A MIGRATION ADDS AN INDEX, THIS NUMBER MUST MOVE WITH IT — the same review obligation
 * `storage/write-cost.ts` records, for the same reason: D1 exposes no portable schema
 * introspection through a binding, so nothing can notice on our behalf.
 */
export const SESSION_ROW_WRITES = 3;

/**
 * `principal` and `organization` (`0001`, `0002`): 1 table row + 1 implicit primary-key index.
 *
 * NOTHING IN THIS REPOSITORY WRITES EITHER. Registration and Organization creation are not built
 * in this slice. Declared so the first writer draws an accounted, already-counted cost rather
 * than a number it chose.
 */
export const PRINCIPAL_ROW_WRITES = 2;
export const ORGANIZATION_ROW_WRITES = 2;

/**
 * `organization_membership` (`0003`): 1 table row + 1 implicit primary-key index.
 *
 * Also unwritten here — membership administration is the organization-structure slice. Note for
 * that slice: a membership change is one of the operations `.claude/rules/security.md` §6
 * requires to be audited, and the audit record belongs in the AFFECTED ORGANIZATION'S
 * tenant-scoped `audit_event` table, not in the control plane. That keeps the trail where the
 * Organization can read its own, and keeps the control plane free of an append-only log that
 * spans every tenant.
 */
export const ORGANIZATION_MEMBERSHIP_ROW_WRITES = 2;

/** `tenant_directory` (`0005`): 1 table row + 1 implicit primary-key index. Unwritten here. */
export const TENANT_DIRECTORY_ROW_WRITES = 2;

/**
 * `platform_operator` (`0008`): 1 table row + 1 implicit primary-key index.
 *
 * NOTHING IN THE RUNNING WORKER WRITES IT, AND THAT IS STRUCTURAL RATHER THAN CIRCUMSTANTIAL —
 * the same property `PRINCIPAL_CREDENTIAL_ROW_WRITES` has, and the one place in the whole
 * super-admin surface where it SURVIVES. `docs/decisions/0025` publishes no route that creates a
 * platform operator; `core.platform-operator.create` is deliberately absent from the permission
 * catalog, and adding one is a decision rather than an extension. The rows are inserted by an
 * operator running SQL that `tools/seed-platform-operator.ts` printed, so they never pass through
 * `reserve` and cannot be caused by a request.
 *
 * Declared anyway, for the reason `PRINCIPAL_ROW_WRITES` is: the first writer must draw an
 * accounted, already-counted cost rather than a number it picked.
 */
export const PLATFORM_OPERATOR_ROW_WRITES = 2;

/**
 * `platform_operator_action` (`0009`): 1 table row + 1 implicit primary-key index.
 *
 * ===========================================================================================
 * THIS IS THE ONE COST IN THIS FILE THAT REQUEST TRAFFIC ACTUALLY SPENDS ON A **READ**.
 * ===========================================================================================
 *
 * `platform-operator-v1` binding property P4 requires EVERY platform route to write an audit
 * record, including both of its reads, because "an operator enumerating every Organization is
 * exactly the reconnaissance step that precedes a targeted action". So a platform GET costs 2
 * row-writes where a tenant GET costs none.
 *
 * IT IS SAFE FOR A REASON THAT DOES NOT GENERALISE, and `0013` is the test it has to pass:
 * `0013`'s problem was that an UNAUTHENTICATED or merely authenticated caller could force
 * unbounded denial audits. A record here is written only after the caller has been established as
 * the holder of a `platform_operator` row, so the population that can force a write is bounded by
 * the number of real operators — one or two — rather than by traffic.
 *
 * IF THAT CLASS EVER BECOMES REACHABLE BY A LARGER POPULATION, THE ARGUMENT FAILS AND P4 MUST BE
 * BOUNDED THE WAY D2 BOUNDED SUCCESSFUL READS. Written here because the failure would be silent.
 *
 * WHEN A MIGRATION ADDS AN INDEX — the obvious candidate is `(actor_principal_id, occurred_at)`,
 * for "what has this operator done" — THIS NUMBER MUST MOVE WITH IT. `0009` says the same at the
 * schema.
 */
export const PLATFORM_OPERATOR_ACTION_ROW_WRITES = 2;

/**
 * `confirmation` (`0011`): 1 table row + 1 implicit primary-key index.
 *
 * CHARGED TWICE PER CRITICAL OPERATION — once to issue and once to spend — so a critical operation
 * costs ABOUT 4 MORE control-plane row-writes than it did, plus its route's audit record.
 *
 * THE SPEND IS AN UPDATE OF ONE ROW AND IS CHARGED THE SAME 2 AS THE INSERT. That is a deliberate
 * over-charge of 1, on the same reasoning `SESSION_ROW_WRITES` uses for the Organization switch:
 * the true cost is one row because the UPDATE touches no indexed column, and a separate
 * `CONFIRMATION_SPEND_ROW_WRITES = 1` would be correct today and silently wrong the first time
 * somebody indexes `expires_at` for the retention job. One constant cannot drift from the schema.
 *
 * ===========================================================================================
 * THE CEILING, AND WHY IT HOLDS FOR A REASON THAT IS STRUCTURAL RATHER THAN LUCKY
 * ===========================================================================================
 *
 * ~750 confirmations a day platform-wide against the 3,000/day control-plane sub-ceiling. A
 * CRITICAL OPERATION REQUIRES A HUMAN TO READ A STATEMENT AND TYPE A PASSWORD, so the volume is
 * bounded by human attention and not by traffic. `0013` control 5's test — is the population that
 * can force a write bounded by something other than the attacker? — passes.
 *
 * *** AND THE HAZARD IS NAMED RATHER THAN DISCOVERED. *** The challenge route is a write reachable
 * by any authenticated principal holding a critical permission, and an unbounded loop of challenge
 * requests is 2 row-writes each against a shared ceiling. That is `0013`'s shape again — the
 * control becoming the lever. RATE LIMITING IS REQUIRED ON BOTH CHALLENGE ROUTES AND DOES NOT
 * EXIST; `0017`'s limiter is per-isolate and bounds nothing deployed. The per-principal daily
 * ceiling is the real bound at closed-beta scale. DO NOT REPORT RATE LIMITING AS DONE.
 */
export const CONFIRMATION_ROW_WRITES = 2;

/**
 * `principal_credential` (`0006`): 1 table row + 1 implicit primary-key index.
 *
 * NOTHING IN THE RUNNING WORKER WRITES IT, AND THAT IS STRUCTURAL RATHER THAN CIRCUMSTANTIAL:
 * `CredentialStore` (`credential-store.ts`) has exactly one method and it is a read. Enrollment is
 * an operator action performed out of band by `tools/seed-principal.ts`, which PRINTS SQL and
 * executes nothing, so these two row-writes are spent by a human running a statement by hand and
 * never by request traffic. No unauthenticated caller can cause a write to this table at all.
 *
 * Declared anyway, for the reason `PRINCIPAL_ROW_WRITES` is: the first writer — self-service
 * registration, or credential rotation — must draw an accounted, already-counted cost rather than
 * a number it picked. THAT SLICE MUST ALSO ANSWER TWO QUESTIONS THIS ONE DOES NOT: which
 * allocation an enrollment draws from, and how an enrollment endpoint stops a client posting a
 * raw password in place of the derived value (`credential-verifier.ts`,
 * `SUBMITTED_VALUE_CHARACTERS`).
 *
 * WHEN A MIGRATION ADDS AN INDEX — the obvious candidate is `principal_id`, for revoking every
 * credential a principal holds — THIS NUMBER MUST MOVE WITH IT.
 */
export const PRINCIPAL_CREDENTIAL_ROW_WRITES = 2;

/**
 * =============================================================================================
 * EVERY CONTROL-PLANE OPERATION, COSTED — including the ones nothing has built yet.
 * =============================================================================================
 *
 * Counted the way `0014` §A.7 counts a Customer create: TABLE ROW + PRIMARY-KEY AUTOINDEX +
 * EVERY EXPLICIT INDEX THE WRITE TOUCHES. Where the charge is higher than the true cost, the
 * over-charge is stated with its size, because §A.12 makes over-reserving CORRECT — "the failure
 * mode of over-reserving is a delayed write, and of under-reserving is a platform outage" — but
 * only a stated over-charge is a decision. An unexamined one is a number nobody can check.
 *
 *   OPERATION                  STATEMENTS   TRUE   CHARGED   NOTE
 *   ------------------------------------------------------------------------------------------
 *   login                          1          3       3      == session creation; see below
 *   session creation               1          3       3      exact
 *   session revocation             1          3       3      exact — a DELETE leaves EVERY index
 *   Organization switch            1          1       3      OVER-CHARGED BY 2 (200%)
 *   session rotation               2          6       6      NOT BUILT
 *   membership change              1        1-2       2      NOT BUILT; + 5 in the tenant database
 *   Organization change            1        1-2       2      NOT BUILT; onboarding is 10 — see below
 *   credential enrollment          1          2       2      OPERATOR-ONLY, out of band; see below
 *   platform operator created      1          2       2      OPERATOR-ONLY, out of band; no route
 *   platform operator action       1          2       2      EVERY platform request, including reads
 *
 * CREDENTIAL ENROLLMENT IS IN THIS TABLE AND NOT IN THIS BUDGET, and the distinction is worth
 * stating rather than inferring from a blank cell. `docs/decisions/0015` §D gave the platform a
 * credential format, so `principal_credential` now exists and has a cost — but the running Worker
 * contains no code that writes it. The rows are inserted by an operator running SQL that
 * `tools/seed-principal.ts` printed, so they never pass through `reserve` and cannot be caused by
 * a request. When self-service registration is built, it will be the first thing on this path to
 * write without a verified principal, which is the case `ControlPlaneWriteAdmission.reserve` has
 * no parameter for — the same finding `pre-auth-admission.ts` records for login start.
 *
 * LOGIN AND SESSION CREATION ARE THE SAME WRITE. A login that names an Organization writes the
 * validated identifier IN THE INSERT rather than following up with an UPDATE, so there is no
 * two-step that can half-complete and no second reservation. THERE IS NO AUDIT ROW ON THIS PATH,
 * deliberately: `audit_event` is tenant-scoped and a login has no tenant yet, and a D1 write per
 * authentication attempt is `0013`'s hole reopened on a path with no authorization above it.
 * That is why a login costs 3 and a Customer create costs 8.
 *
 * THE ORGANIZATION SWITCH IS THE ONE DELIBERATE OVER-CHARGE. `UPDATE session SET
 * active_organization_id = ? WHERE session_id = ?` touches no indexed column — not the primary
 * key, not `session_by_principal`'s `(principal_id, expires_at)` — so D1 bills ONE row. It is
 * charged `SESSION_ROW_WRITES`, three. The 2-row-write excess buys a single constant that cannot
 * drift from the schema: a separate `SESSION_UPDATE_ROW_WRITES = 1` would be correct today and
 * silently wrong the first time someone indexes a column this statement sets. Switches are rare,
 * so the excess is bounded by a rare operation, and the direction of the error is the safe one.
 *
 * SESSION ROTATION IS NOT BUILT AND ITS NUMBER IS A WARNING. Rotation is one INSERT plus one
 * DELETE = 6, which is TWICE a login. At the sub-ceiling that is 500 rotations a day
 * platform-wide. A design that rotates on every request — some do, as a session-fixation
 * defence — would cost 6 row-writes per request and is unaffordable by two orders of magnitude.
 * Rotation also cannot be specified before the credential format is, so it is costed here and
 * deliberately not implemented.
 *
 * A MEMBERSHIP CHANGE COSTS 2 HERE AND 5 IN THE TENANT DATABASE, AND THE TWO CANNOT BE ATOMIC.
 * `.claude/rules/security.md` §6 requires membership changes to be audited, and the audit record
 * belongs in the affected Organization's tenant-scoped `audit_event` (5 row-writes: 1 table +
 * 1 primary key + 3 explicit indexes). Those are TWO DATABASES, so there is no batch that
 * commits both — the device `TenantScopedStore.write` uses to make a mutation and its audit row
 * one unit is unavailable across a database boundary. The slice that builds membership
 * administration must decide the ordering and the partial-failure behaviour, and it must decide
 * it explicitly; §C does not. It also spends from TWO ALLOCATIONS: 2 from `system` through this
 * port, 5 from `business` through the per-Organization coordinator.
 *
 * ORGANIZATION CREATION COSTS **10**, NOT 6, AND BOTH HALVES OF THIS PARAGRAPH HAVE BEEN
 * CORRECTED BY `docs/decisions/0024` AND `docs/decisions/0025`. THE ORIGINAL IS KEPT IN THE
 * SENTENCE BELOW BECAUSE THE WAY IT WAS WRONG IS THE USEFUL PART.
 *
 * AS WRITTEN: "Onboarding is 6 row-writes here — `organization` 2 + `tenant_directory` 2 + the
 * owner's `organization_membership` 2 — and its audit record cannot go into the new
 * Organization's tenant audit log, because reaching that log needs a tenant store handle, which
 * needs the directory entry that the same operation is still creating."
 *
 * THE ARITHMETIC ASSUMED THE ADMIN PRINCIPAL AND THEIR CREDENTIAL ALREADY EXISTED, which is
 * exactly what is false when a new customer arrives. `0024`: add `principal` 2 +
 * `principal_credential` 2 = **10**, plus the first inner unit and the audit record from a
 * different allocation. The gap was precisely the two objects nobody counted.
 *
 * THE CIRCULARITY WAS AN ARTEFACT OF ORDERING AND NOT A PROPERTY OF THE PROBLEM. `0025` decision
 * 5: WRITE `tenant_directory` FIRST and the store handle then resolves, so the tenant-side audit
 * record can be written after all. The platform-side record has a home of its own — the
 * platform-operator action log, `0009_platform_operator_action.sql` — and BOTH ARE REQUIRED. The
 * order is: the operation's own writes, then the platform audit record, then the tenant record.
 */

// =============================================================================================
// The ceilings
// =============================================================================================

/** §A.5's allocation this port draws from. See the header for why, and for what it stretches. */
export const CONTROL_PLANE_WRITE_ALLOCATION: WriteAllocation = 'system';

/**
 * The control plane's share of the `system` allocation: 3,000 of 10,000 estimated row-writes per
 * UTC day = **1,000 session writes**, platform-wide.
 *
 * WHY A SUB-CEILING AND NOT THE WHOLE ALLOCATION. `system` is reserved for controlled operations
 * — migrations, retention, emergency work. If externally-triggered login traffic could consume
 * all of it, the first busy day would leave the platform unable to run its own retention job,
 * and the operator's response to an incident would be refused by a budget. 7,000 stays reserved
 * for what the allocation was declared for.
 *
 * IS 1,000 SESSIONS A DAY ENOUGH? For the closed beta it is not close: ten Organizations
 * (`MULTITENANCY_STANDARD.md` §7.5) at ten principals each, logging in twice a day, is 200
 * sessions and 600 row-writes — a fifth of this ceiling. It is a real limit at real scale, and
 * it is the correct place for the limit to be felt, because the alternative is an account-wide
 * D1 outage with no limit at all.
 *
 * PROVISIONAL, like every other figure of its kind in this codebase: Dudo has no traffic, so
 * this is a reasoned bound and not a measurement. It belongs in
 * `docs/operations/free-tier-register.md`, which is the Team Lead's file.
 */
export const CONTROL_PLANE_DAILY_ROW_WRITES = 3_000;

/**
 * One principal's share: 600 estimated row-writes = **200 session writes per UTC day**.
 *
 * ===========================================================================================
 * WITHOUT THIS, THE PLATFORM CEILING IS ITSELF A DENIAL-OF-SERVICE LEVER — the shape `0014`'s
 * own "two findings" section warns about, where the control becomes the vulnerability.
 * ===========================================================================================
 *
 * At 60 logins a minute one credential reaches 3,000 row-writes in about seventeen minutes, and
 * every other principal on the platform is then unable to log in until 00:00 UTC. The daily
 * bound is still right — the alternative is an account-wide outage, which is worse — but it has
 * to be divided, and the ratio here is `0013`'s platform-to-actor ratio of 5:1, preserved
 * deliberately so that no ceiling in the system is 5:1 for one resource and something else for
 * another.
 *
 * THE COUNTER IS KEYED BY A VERIFIED PRINCIPAL, WHICH IS WHY IT IS BOUNDED. `0013` control 5
 * keeps the requested identifier out of the denial grouping because an attacker controls it and
 * would mint unlimited groups. The same test applied here passes: this counter is only ever
 * reached AFTER a credential has been verified, so an attacker can only create keys for
 * principals whose credentials it already holds. It is bounded by the number of real accounts,
 * not by traffic.
 */
export const PER_PRINCIPAL_DAILY_ROW_WRITES = 600;

/**
 * How many principals the in-process implementation tracks in a day before overflowing.
 *
 * ===========================================================================================
 * IT IS EQUAL TO THE SUB-CEILING, AND THAT EQUALITY IS THE PROOF RATHER THAN A COINCIDENCE.
 * ===========================================================================================
 *
 * Every reservation costs at least one row-write, and — because the platform sub-ceiling is
 * checked BEFORE the principal map is touched (`reserve`, below) — an entry is only ever created
 * for a request that the sub-ceiling admitted. So at most `CONTROL_PLANE_DAILY_ROW_WRITES`
 * distinct principals can appear in the map in one UTC day, and the map cannot grow past this
 * number. A per-request map keyed by a value an attacker can multiply is a memory-exhaustion
 * lever with a different name; this one is bounded by arithmetic, not by hope.
 *
 * THE OVERFLOW BUCKET BELOW IS THEREFORE UNREACHABLE UNDER THE CURRENT CONSTANTS, and it is kept
 * anyway as the backstop for the day someone raises the sub-ceiling and does not read this
 * comment. OVERFLOW SHARES ONE BUCKET AND IS NOT AN EXEMPTION — the same rule `coordination.ts`
 * applies to a request whose source address the transport could not establish: "forgetting to
 * supply it throttles hard rather than disabling the level."
 */
export const MAX_TRACKED_PRINCIPALS_PER_DAY = CONTROL_PLANE_DAILY_ROW_WRITES;

export class ControlPlaneBudgetIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlPlaneBudgetIncoherentError';
  }
}

/**
 * Runs at module load, for the reason `assertAllocationsAreCoherent` does: a budget whose parts
 * do not add up is not a budget, and finding that out from production traffic is finding it out
 * too late.
 */
export function assertControlPlaneBudgetIsCoherent(): void {
  const allocationCeiling = DAILY_ALLOCATION[CONTROL_PLANE_WRITE_ALLOCATION];
  if (CONTROL_PLANE_DAILY_ROW_WRITES > allocationCeiling) {
    throw new ControlPlaneBudgetIncoherentError(
      `The control plane's daily sub-ceiling (${String(CONTROL_PLANE_DAILY_ROW_WRITES)}) exceeds ` +
        `the '${CONTROL_PLANE_WRITE_ALLOCATION}' allocation it draws from ` +
        `(${String(allocationCeiling)}, docs/decisions/0014 §A.5). A sub-ceiling above its ` +
        'allocation is not a sub-ceiling.',
    );
  }
  if (PER_PRINCIPAL_DAILY_ROW_WRITES > CONTROL_PLANE_DAILY_ROW_WRITES) {
    throw new ControlPlaneBudgetIncoherentError(
      'One principal may not be permitted more than the whole control-plane sub-ceiling.',
    );
  }
  if (PER_PRINCIPAL_DAILY_ROW_WRITES < SESSION_ROW_WRITES) {
    throw new ControlPlaneBudgetIncoherentError(
      'The per-principal ceiling is smaller than one session write, so no principal could ever ' +
        'log in. A ceiling that refuses everything is a misconfiguration, not a safe default.',
    );
  }
  if (MAX_TRACKED_PRINCIPALS_PER_DAY < CONTROL_PLANE_DAILY_ROW_WRITES) {
    // Not a style rule. If the map is smaller than the number of principals the sub-ceiling can
    // admit, real principals share the overflow bucket during ordinary operation and throttle
    // each other for no reason — a self-inflicted denial of service that would look like a bug
    // in the budget rather than in the map size.
    throw new ControlPlaneBudgetIncoherentError(
      'The principal tracking limit is smaller than the number of principals the daily ' +
        'sub-ceiling can admit, so ordinary traffic would fall into the shared overflow bucket.',
    );
  }
}

assertControlPlaneBudgetIsCoherent();

// =============================================================================================
// The receipt
// =============================================================================================

const CONTROL_PLANE_RESERVATION_BRAND: unique symbol = Symbol(
  'dudo.identity.controlPlaneWriteReservation',
);

/**
 * Permission to write to the control plane, already paid for.
 *
 * A RECEIPT, NOT A REQUEST — identical in spirit to `WriteReservation`. By the time one exists
 * the day's counters have been decremented, so dropping it costs the budget exactly what using
 * it would have. §A.12: "uncertain or partially consumed reservations are not refunded", made
 * true by there being no refund path.
 *
 * IT NAMES NO TABLE, NO ROW AND NO ORGANIZATION. It says how much, for which principal, on which
 * UTC day. It is not a capability over data and cannot be used to reach any.
 */
export type ControlPlaneWriteReservation = {
  readonly [CONTROL_PLANE_RESERVATION_BRAND]: true;
  readonly principalId: string;
  readonly estimatedRowWrites: number;
  readonly dayStartMs: number;
};

const CONSUMED = new WeakSet<object>();

/**
 * THE ONLY CONSTRUCTOR, AND IT MUST BE CALLED ONLY AFTER THE COUNTERS HAVE BEEN DECREMENTED.
 *
 * Exported because the admission implementation below and a future coordinator-backed one both
 * need it, and for no other reason. If this is ever called on a path that did not decrement a
 * counter, `0014` §A.1 is defeated for the control plane: writes proceed against an account-wide
 * allowance with nothing accounted.
 */
export function mintControlPlaneWriteReservation(fields: {
  readonly principalId: string;
  readonly estimatedRowWrites: number;
  readonly dayStartMs: number;
}): ControlPlaneWriteReservation {
  const reservation = {
    principalId: fields.principalId,
    estimatedRowWrites: fields.estimatedRowWrites,
    dayStartMs: fields.dayStartMs,
  };
  Object.defineProperty(reservation, CONTROL_PLANE_RESERVATION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(reservation) as ControlPlaneWriteReservation;
}

/**
 * Thrown, not returned, for the reason `WriteNotAdmittedError` is: no client can cause this.
 * Clients supply values, never reservations. What it catches is Dudo's own code writing to an
 * account-wide allowance without accounting for it, which must stop the request rather than be
 * handled, logged and shipped.
 */
export class ControlPlaneWriteNotAdmittedError extends Error {
  constructor(reason: string) {
    super(
      `A control-plane D1 write was attempted without a valid reservation: ${reason}. Every ` +
        'production mutation must reserve a conservative cost from the daily budget BEFORE it ' +
        'executes (docs/decisions/0014 §A.1, §A.11 and §C.7). The control-plane database is a ' +
        'separate database and NOT separate quota: its writes consume the same account-wide ' +
        'daily allowance, whose exhaustion stops D1 answering for every Organization.',
    );
    this.name = 'ControlPlaneWriteNotAdmittedError';
  }
}

/**
 * Spends a reservation on one batch, or throws. Three checks, each closing a bypass:
 *
 *   1. THE BRAND. A hand-built object is not a reservation.
 *   2. SINGLE USE. One reservation, one batch — otherwise one login's reservation funds a loop.
 *   3. THE SIZE. Every statement writes at least one row, so a batch with more statements than
 *      row-writes reserved is provably under-reserved.
 *
 * There is no tenant check, because there is no tenant: the control plane serves none. The
 * principal binding is carried for accounting and for the per-principal ceiling, and is
 * deliberately NOT checked against the row being written — a session row for principal A written
 * under principal B's reservation would be a defect, but it is one the caller cannot reach:
 * `session-resolution.ts` reserves and writes in the same function, for the principal it just
 * resolved.
 */
export function consumeControlPlaneWriteReservation(
  reservation: ControlPlaneWriteReservation,
  statementCount: number,
): void {
  const branded = reservation as unknown as Record<symbol, unknown> | null | undefined;
  if (
    branded === null ||
    branded === undefined ||
    branded[CONTROL_PLANE_RESERVATION_BRAND] !== true
  ) {
    throw new ControlPlaneWriteNotAdmittedError(
      'the value did not come from mintControlPlaneWriteReservation',
    );
  }
  if (CONSUMED.has(reservation)) {
    throw new ControlPlaneWriteNotAdmittedError('the reservation had already been spent');
  }
  if (statementCount > reservation.estimatedRowWrites) {
    throw new ControlPlaneWriteNotAdmittedError(
      `the batch has ${String(statementCount)} statements and only ` +
        `${String(reservation.estimatedRowWrites)} row-writes were reserved; every statement ` +
        'writes at least one row',
    );
  }
  CONSUMED.add(reservation);
}

// =============================================================================================
// The port
// =============================================================================================

export type ControlPlaneAdmissionOutcome =
  | { readonly kind: 'granted'; readonly reservation: ControlPlaneWriteReservation }
  /**
   * The day's capacity for this principal, or for the control plane as a whole, is spent.
   *
   * `retryAfterSeconds` IS DERIVED FROM THE FIXED UTC BOUNDARY AND FROM NOTHING ELSE, which is
   * `0014`'s envelope ruling: it is "the same value for every caller at that instant and
   * therefore carries no signal about another tenant, another principal, or any record". It must
   * never be derived from observed usage or remaining budget. Note that this holds even though
   * the two ceilings differ: both answer with the next reset, so a caller cannot tell which one
   * refused it, and therefore cannot measure another principal's activity through its own
   * refusal.
   */
  | {
      readonly kind: 'deferred';
      readonly resumeAfterMs: number;
      readonly retryAfterSeconds: number;
    };

export type ControlPlaneWriteAdmission = {
  reserve(request: {
    /** Server-derived. A caller never supplies this; it comes from a verified credential. */
    readonly principalId: string;
    /** WORST CASE, per §A.12. Over-reserving delays a write; under-reserving is an outage. */
    readonly estimatedRowWrites: number;
    readonly nowMs: number;
  }): Promise<Result<ControlPlaneAdmissionOutcome>>;
};

type PrincipalDayCounter = {
  dayStartMs: number;
  used: number;
};

/**
 * The key the shared overflow bucket is stored under.
 *
 * THE LEADING SPACE IS LOAD-BEARING. Identifiers are 22 characters of base64url
 * (`kernel/ids.ts`), so no real principal identifier can equal this string — which means no
 * principal can push another into the shared bucket, or claim the shared bucket's allowance as
 * its own, by choosing a colliding identifier.
 */
const OVERFLOW_BUCKET_KEY = ' overflow';

/**
 * An in-process implementation.
 *
 * ===========================================================================================
 * NOT A DEPLOYMENT IMPLEMENTATION, FOR EXACTLY THE REASON `in-process-coordinator.ts` IS NOT.
 * ===========================================================================================
 *
 * Its per-principal counters live in one isolate's memory, and a deployed Worker runs in many
 * isolates. A per-isolate ceiling is a ceiling divided by a number nobody controls, so in a
 * deployed Worker the per-principal bound would not bound. The PLATFORM half is safe even so —
 * it goes through the shared `DayWriteBudget`, which is the coordinator's single point of truth
 * — but the per-principal half is not, and a composition root that wires this into a deployed
 * Worker has silently removed it.
 *
 * The deployed implementation is the same port backed by the coordination Durable Object, and it
 * is NOT BUILT HERE: `platform/core/protection/**` is not this work's territory, and adding a
 * per-principal daily counter to the coordinator is a change to a file another agent owns. It is
 * reported.
 */
export function createInProcessControlPlaneWriteAdmission(
  dayBudget: DayWriteBudget,
): ControlPlaneWriteAdmission {
  const perPrincipal = new Map<string, PrincipalDayCounter>();
  let platformDayStartMs = -1;
  let platformUsed = 0;

  function counterFor(principalId: string, dayStartMs: number): PrincipalDayCounter {
    let key = principalId;
    let counter = perPrincipal.get(key);
    if (counter === undefined && perPrincipal.size >= MAX_TRACKED_PRINCIPALS_PER_DAY) {
      // Overflow shares one bucket. See MAX_TRACKED_PRINCIPALS_PER_DAY for why this is
      // unreachable under the current constants and why it is kept anyway.
      key = OVERFLOW_BUCKET_KEY;
      counter = perPrincipal.get(key);
    }
    if (counter === undefined) {
      counter = { dayStartMs, used: 0 };
      perPrincipal.set(key, counter);
    }
    if (counter.dayStartMs !== dayStartMs) {
      counter.dayStartMs = dayStartMs;
      counter.used = 0;
    }
    return counter;
  }

  return {
    async reserve(request): Promise<Result<ControlPlaneAdmissionOutcome>> {
      const wanted = request.estimatedRowWrites;
      if (!Number.isInteger(wanted) || wanted < 1) {
        // A defect in Dudo's code, not a bad request. `internal` discloses nothing.
        return err(internal());
      }

      const dayStartMs = utcDayStart(request.nowMs);
      const deferred: ControlPlaneAdmissionOutcome = {
        kind: 'deferred',
        resumeAfterMs: nextUtcResetMs(request.nowMs),
        retryAfterSeconds: retryAfterSecondsUntilReset(request.nowMs),
      };

      if (platformDayStartMs !== dayStartMs) {
        platformDayStartMs = dayStartMs;
        platformUsed = 0;
        // The principal map is not cleared here; each counter resets itself on first use of a
        // new day. Clearing would also be correct, and both leave stale entries bounded by
        // MAX_TRACKED_PRINCIPALS_PER_DAY.
      }

      // ----------------------------------------------------------------------------------
      // BOTH LOCAL CEILINGS ARE CHECKED BEFORE THE SHARED LEDGER IS TOUCHED, AND BOTH ORDERINGS
      // HERE ARE DELIBERATE.
      //
      // LOCAL BEFORE SHARED: a principal over its own ceiling must not be able to spend platform
      // capacity on its way to being refused. Reservations are never refunded (§A.12), so a
      // take() followed by a local refusal would burn the account-wide allowance on requests
      // that write nothing.
      //
      // THE SUB-CEILING BEFORE THE PRINCIPAL MAP: an entry is created only for a request the
      // sub-ceiling admitted, which is what bounds the map by arithmetic rather than by hope.
      // With the checks the other way round, a stream of requests from distinct principals would
      // create a map entry each even while every one of them was being refused — an unbounded
      // map fed by refused traffic, which is a memory-exhaustion lever wearing the word counter.
      // See MAX_TRACKED_PRINCIPALS_PER_DAY.
      // ----------------------------------------------------------------------------------
      if (platformUsed + wanted > CONTROL_PLANE_DAILY_ROW_WRITES) {
        return ok(deferred);
      }
      const counter = counterFor(request.principalId, dayStartMs);
      if (counter.used + wanted > PER_PRINCIPAL_DAILY_ROW_WRITES) {
        return ok(deferred);
      }

      const taken = await dayBudget.take(dayStartMs, CONTROL_PLANE_WRITE_ALLOCATION, wanted);
      if (!taken.ok) {
        return err(taken.error);
      }
      if (taken.value < wanted) {
        // The allocation itself is spent. Whatever was granted is NOT refunded — there is no
        // refund path, deliberately (§A.12) — and the caller is deferred to the next reset.
        return ok(deferred);
      }

      counter.used += wanted;
      platformUsed += wanted;
      return ok({
        kind: 'granted',
        reservation: mintControlPlaneWriteReservation({
          principalId: request.principalId,
          estimatedRowWrites: wanted,
          dayStartMs,
        }),
      });
    },
  };
}
