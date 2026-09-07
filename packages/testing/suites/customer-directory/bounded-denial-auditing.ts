/**
 * ===========================================================================================
 * docs/decisions/0013 — THE TEN CONTROLS, EXERCISED
 * ===========================================================================================
 *
 * `0013-bounded-denial-auditing-and-rate-limits.md`, Accepted, user decision of 2026-09-02.
 * The denied-read audit suite covers what a DENIAL now records; this suite covers the controls
 * that were added around it — the group key's boundedness (5), the rate limits (6), the
 * malformed-identifier path (7), fail-closed behaviour (8), and the daily ceiling (9).
 *
 * WHY THESE NEED THEIR OWN SUITE. Every one of them is a claim about what happens when
 * something is WRONG: the coordinator is down, the budget is spent, the caller is flooding, the
 * key has been "improved". None of those states occurs on a passing happy path, so none of them
 * is exercised by any other case in this run. `in-process-coordinator.ts` says as much in its
 * own header — without an executable coordinator "the coordination algorithm would ship
 * reviewed but never run".
 *
 * ===========================================================================================
 * WHAT THIS SUITE DOES NOT COVER, STATED HERE RATHER THAN INFERRED FROM ITS ABSENCE
 * ===========================================================================================
 *
 *   1. THE DURABLE OBJECT. `protection/adapters/durable-objects/coordinator-object.ts` is NOT
 *      executed by anything in this repository — there is no Worker configuration and no
 *      runtime. What is verified is the shipped ALGORITHM (`coordination-engine.ts`) through
 *      the shipped in-process port. Persistence, eviction, restart and the object's own daily
 *      allowances are UNVERIFIED and are reported as such.
 *   2. VOLUMETRIC ATTACK. 0013 control 11 is explicit that these controls are not DDoS
 *      resistance, and nothing here should be read as measuring any. What is measured is D1
 *      write capacity and the integrity of the evidence.
 *   3. THE SOURCE-ADDRESS RATE LEVEL, END TO END. See the case that tests it for the
 *      arithmetic: with a two-Organization fixture the source ceiling is unreachable through
 *      the pipeline, so it is exercised at the coordinator port instead.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  CUST_A_SOUTH,
  CUST_B_ANNA,
  CUST_NOWHERE,
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  EXPECTED_RATE_LIMITED,
  EXPECTED_UNAVAILABLE,
  FIXED_START_MS,
  ORG_A,
  ORG_B,
  PERMISSION_IDS,
  makePrincipal,
} from '../../harness/world.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import { asAnyAction } from '../../../../platform/core/action/action.ts';
import type { AuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import type {
  CoordinationFailure,
  CoordinationFailureReporter,
} from '../../../../platform/core/audit/coordination-failure.ts';
import { createStoreDenialSummarySink } from '../../../../platform/core/audit/denial-summary-sink.ts';
import type {
  CoordinatedRequest,
  DenialGroupKey,
} from '../../../../platform/core/protection/coordination.ts';
import {
  DENIAL_WINDOW_MS,
  DenialGroupKeyNotDerivedError,
  EMISSION_LADDER,
  MAX_WRITES_PER_GROUP_WINDOW,
  PER_ORGANIZATION_DAILY_SUMMARIES,
  PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES,
  PLATFORM_DAILY_SUMMARIES,
  PLATFORM_DAILY_SUMMARY_ROW_WRITES,
  RATE_LIMIT_PER_WINDOW,
  RATE_WINDOW_MS,
  SOURCE_REPORT_INTERVAL,
  assertDenialGroupKey,
  deriveDenialGroupKey,
} from '../../../../platform/core/protection/coordination.ts';
import { DENIAL_SUMMARY_ROW_WRITES } from '../../../../platform/core/storage/write-cost.ts';
import {
  D1_FREE_DAILY_ROW_WRITES,
  DAILY_ALLOCATION,
} from '../../../../platform/core/protection/write-admission.ts';
import {
  admit,
  createCoordinationState,
  creditPermits,
  recordDenial as engineRecordDenial,
} from '../../../../platform/core/protection/coordination-engine.ts';
import {
  createInProcessDayWriteBudget,
  createInProcessRequestCoordinator,
  createInProcessSourceCounterShard,
} from '../../../../platform/core/protection/in-process-coordinator.ts';
import {
  forgeUnbrandedGroupKey,
  withForeignOrganizationKey,
  withKeyRecorder,
} from '../../harness/broken-coordination.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

/**
 * Statements the run issued against the CUSTOMER table specifically.
 *
 * Controls 6 and 7 are both "before any Customer D1 query", so the assertion has to be about
 * customer statements and not about statements in general — a denial summary write is a D1
 * query too, and counting it would make every one of these cases fail for the wrong reason.
 */
function customerStatements(world: World): readonly string[] {
  return world.harness.statements
    .map((entry) => entry.sql)
    .filter((sql) => /\b(?:FROM|INTO|UPDATE)\s+customer\b/i.test(sql));
}

/**
 * The EMISSION SCHEDULE of a campaign: the 1-based attempt ordinals at which a summary row was
 * actually written.
 *
 * This is the observable that the timing-oracle case is about. A denial that triggers a write
 * does measurably more work than one that does not, so the ordinals at which writes happen are
 * what an attacker with a stopwatch can see.
 */
async function emissionSchedule(
  world: World,
  principal: AuthenticatedPrincipal,
  identifiers: readonly string[],
): Promise<number[]> {
  const ordinals: number[] = [];
  let written = world.denialSummaryRows().length;
  for (let index = 0; index < identifiers.length; index += 1) {
    // `world.invoke` feeds the identifier to the negative-control wrapper when that control is
    // on, and does nothing otherwise. Nothing here needs to know which world it is in.
    await world.invoke(world.actions.get, principal, { customer_id: identifiers[index] });
    const now = world.denialSummaryRows().length;
    if (now > written) {
      ordinals.push(index + 1);
      written = now;
    }
  }
  return ordinals;
}

function fabricated(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `cust_probe_${String(index).padStart(6, '0')}`);
}

export function buildBoundedDenialAuditingSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('docs/decisions/0013 — bounded denial auditing, rate limits, ceilings and fail-closed');

  // =========================================================================================
  // CONTROL 5 — the group key is server-derived on every component, and therefore bounded
  // =========================================================================================

  suite.test('CONTROL 5 — every component of the denial group key is server-derived, and a caller-supplied identifier cannot reach it', async () => {
    const world = await makeWorld();
    try {
      // Asserted the same way the actorBusinessIds provenance was: by recording everything that
      // ACTUALLY reached the key during a real campaign and showing the caller's strings are not
      // among it. A claim about what "cannot" reach a value is only as good as the record of
      // what did.
      const seen: DenialGroupKey[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withKeyRecorder(world.dependencies.coordinator, seen),
      };
      const probes = fabricated(12);
      for (const identifier of probes) {
        expectError(
          `${ISOLATION} probe ${identifier}`,
          await invokeAction(
            dependencies,
            asAnyAction(world.actions.get),
            { principal: world.ownerA, app: world.app, requestId: `req_${identifier}`, correlationId: `cor_${identifier}` },
            { customer_id: identifier },
          ),
          EXPECTED_NOT_FOUND,
        );
      }

      assertEqual('every attempt was counted', seen.length, probes.length);
      assertEqual(
        'THE KEY HAS EXACTLY FIVE MEMBERS — a sixth would have to be added on purpose',
        Object.keys(seen[0]).sort().join(','),
        'actionId,appId,category,organizationId,principalId',
      );
      assertEqual(
        `${ISOLATION} and all twelve probes produced ONE key — the identifier is not in it`,
        new Set(seen.map((key) => JSON.stringify(key))).size,
        1,
      );
      assertEqual(
        'built from the authenticated context and the Action definition, and from nothing else',
        JSON.stringify(seen[0]),
        JSON.stringify({
          organizationId: ORG_A,
          principalId: 'prn_owner_alpha',
          appId: 'customers',
          actionId: 'customers.GetCustomer',
          category: 'not_found',
        }),
      );
      const rendered = JSON.stringify(seen);
      for (const identifier of probes) {
        assertTrue(
          `${ISOLATION} no probed identifier reached the grouping: ${identifier}`,
          !rendered.includes(identifier),
          'a caller-supplied identifier entered the denial group key — the aggregation is unbounded',
        );
      }
      // AND THE BOUND IS OBSERVABLE IN THE TABLE, which is what the control is for.
      assertTrue(
        'twelve distinct identifiers cost at most six row-writes, not twelve',
        world.denialSummaryRows().length <= MAX_WRITES_PER_GROUP_WINDOW,
        `${world.denialSummaryRows().length} rows for 12 distinct identifiers`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 5 — a HOSTILE Action cannot widen the grouping: the category comes from the closed taxonomy, so the group count is bounded however many identifiers are probed', async () => {
    const world = await makeWorld();
    try {
      // The remaining channel an App author controls is WHICH ERROR the handler returns, and
      // that is drawn from a closed set the pipeline narrows further (`constrainToDeclaredErrors`
      // converts anything undeclared to `internal`, which is not a denial category at all). So
      // the worst a hostile Action can do is spread its denials across the categories it
      // declares — a finite number — rather than across the identifiers it was given.
      //
      // Driven through the SHIPPED GetCustomer rather than a synthetic Action, because a
      // synthetic one would prove a property of the synthetic Action.
      const seen: DenialGroupKey[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withKeyRecorder(world.dependencies.coordinator, seen),
      };
      // Four categories, forty distinct identifiers, one actor.
      const attempts: readonly [AuthenticatedPrincipal, string][] = [
        ...fabricated(10).map((id) => [world.ownerA, id] as [AuthenticatedPrincipal, string]),
        ...fabricated(10).map((id) => [world.ownerA, `${id} malformed`] as [AuthenticatedPrincipal, string]),
        ...fabricated(10).map(() => [world.unprivilegedA, CUST_A_ANNA] as [AuthenticatedPrincipal, string]),
        ...fabricated(10).map(() => [world.adminANorth, CUST_A_SOUTH] as [AuthenticatedPrincipal, string]),
      ];
      for (const [principal, identifier] of attempts) {
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal, app: world.app, requestId: 'req_bounded', correlationId: 'cor_bounded' },
          { customer_id: identifier },
        );
      }
      assertEqual('forty attempts were counted', seen.length, 40);
      const groups = new Set(seen.map((key) => JSON.stringify(key)));
      assertEqual(
        'and they fall into FOUR groups — one per (actor, category) pair, not one per identifier',
        groups.size,
        4,
      );
      assertTrue(
        'every group key names a category from the closed audit taxonomy',
        seen.every((key) => ['forbidden', 'not_found', 'invalid_argument', 'failed_precondition', 'conflict', 'rate_limited', 'quota_exceeded', 'unauthenticated'].includes(key.category)),
        JSON.stringify([...new Set(seen.map((key) => key.category))]),
      );
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 5 — an unbranded grouping is refused by the engine AND by the write, so a laundered identifier cannot be discovered in the table afterwards', async () => {
    const world = await makeWorld();
    try {
      const forged = forgeUnbrandedGroupKey({
        organizationId: ORG_A,
        principalId: 'prn_owner_alpha',
        appId: 'customers',
        // What a laundered key would look like: the caller's string, in the grouping.
        actionId: `customers.GetCustomer~${CUST_B_ANNA}`,
        category: 'not_found',
      });

      let fromAssert: unknown = null;
      try {
        assertDenialGroupKey(forged);
      } catch (cause) {
        fromAssert = cause;
      }
      assertTrue('the guard rejects it', fromAssert instanceof DenialGroupKeyNotDerivedError, `got ${String(fromAssert)}`);

      let fromEngine: unknown = null;
      try {
        engineRecordDenial(
          createCoordinationState(),
          forged,
          { actorBusinessIds: [BIZ_A_NORTH], permissionId: 'customers.customer.read', scope: 'business' },
          FIXED_START_MS,
        );
      } catch (cause) {
        fromEngine = cause;
      }
      assertTrue('the engine refuses to count it', fromEngine instanceof DenialGroupKeyNotDerivedError, `got ${String(fromEngine)}`);

      // THE SECOND GUARD, and it is not redundant: the engine's check stops a bad grouping from
      // being COUNTED, and this one stops it from being WRITTEN. Two independent doors, because
      // control 5 failing silently is what makes the aggregation stop being bounded.
      const store = await world.storeFor(ORG_A);
      let fromSink: unknown = null;
      try {
        createStoreDenialSummarySink(store, world.ids).operation({
          key: forged,
          windowStartMs: FIXED_START_MS,
          emissionSequence: 0,
          firstAttemptAtMs: FIXED_START_MS,
          lastAttemptAtMs: FIXED_START_MS,
          attemptCount: 1,
          actorBusinessIds: [BIZ_A_NORTH],
          permissionId: 'customers.customer.read',
          scope: 'business',
          windowClosed: false,
        });
      } catch (cause) {
        fromSink = cause;
      }
      assertTrue('and the sink refuses to write it', fromSink instanceof DenialGroupKeyNotDerivedError, `got ${String(fromSink)}`);

      // NON-VACUITY: a DERIVED key passes both doors, so the refusals above are about
      // provenance and not about the shape.
      const derived = deriveDenialGroupKey({
        principal: world.ownerA,
        action: { appId: 'customers', id: 'customers.GetCustomer' },
        category: 'not_found',
      });
      assertDenialGroupKey(derived);
      const operation = createStoreDenialSummarySink(store, world.ids).operation({
        key: derived,
        windowStartMs: FIXED_START_MS,
        emissionSequence: 0,
        firstAttemptAtMs: FIXED_START_MS,
        lastAttemptAtMs: FIXED_START_MS,
        attemptCount: 1,
        actorBusinessIds: [BIZ_A_NORTH],
        permissionId: 'customers.customer.read',
        scope: 'business',
        windowClosed: false,
      });
      assertEqual('a derived key writes', operation.kind, 'insert');
      assertTrue(
        `${ISOLATION} and the row it would write carries no identifier`,
        !JSON.stringify(operation).includes(CUST_B_ANNA),
        `the summary write carried ${CUST_B_ANNA}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test("CONTROL 5 — a coordination handle REFUSES a key from another Organization rather than filing one tenant's evidence under another", async () => {
    const world = await makeWorld();
    try {
      // The deployed coordinator gets this from being one Durable Object per Organization. The
      // in-process one has to reproduce it, so it is tested rather than inherited — and it is
      // the property that makes every counter it holds tenant-scoped by construction.
      const reported: CoordinationFailure[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withForeignOrganizationKey(world.dependencies.coordinator, ORG_B),
        coordinationFailureReporter: { report: (failure: CoordinationFailure) => reported.push(failure) },
      };
      expectError(
        `${ISOLATION} the probe is still refused, identically`,
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_foreign', correlationId: 'cor_foreign' },
          { customer_id: CUST_B_ANNA },
        ),
        EXPECTED_NOT_FOUND,
      );
      assertEqual(`${ISOLATION} nothing was filed under Organization B`, world.denialSummaryRows(ORG_B).length, 0);
      assertEqual(`${ISOLATION} and nothing under Organization A either — it was refused, not redirected`, world.denialSummaryRows(ORG_A).length, 0);
      assertEqual('the refusal is announced as a lost record', reported.map((entry) => entry.cause).join(','), 'record_failed');
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // THE TIMING ORACLE — the property that falls out of control 5, and would be lost silently
  // =========================================================================================

  suite.test('THE TIMING ORACLE — the emission schedule is a function of the attempt ORDINAL alone, and carries no signal about which identifier was probed', async () => {
    // `coordination.ts` states this as a consequence of control 5 and warns it "would be lost
    // silently if anyone ever improved the key". A comment cannot go red, so this is the
    // assertion — and the case below it is the falsification that makes this one evidence.
    //
    // THE OBSERVABLE: summary writes happen on 1-in-N denials, so a denial that triggers one
    // does measurably more work. If the ordinals at which that happens depended on WHICH
    // identifier was typed, the per-request cost would be a channel keyed on the caller's own
    // input, on the path the `not_found` exists to keep uninformative.
    const runs: [string, string[]][] = [
      ['alternating foreign / fabricated', Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? CUST_B_ANNA : CUST_NOWHERE))],
      ['the same foreign identifier twelve times', Array.from({ length: 12 }, () => CUST_B_ANNA)],
      ['twelve distinct fabricated identifiers', fabricated(12)],
    ];
    const schedules: string[] = [];
    for (const [, identifiers] of runs) {
      const world = await makeWorld();
      try {
        schedules.push(JSON.stringify(await emissionSchedule(world, world.ownerA, identifiers)));
      } finally {
        world.close();
      }
    }
    assertEqual(
      `${ISOLATION} three campaigns differing ONLY in the identifiers produce the SAME emission schedule`,
      new Set(schedules).size,
      1,
    );
    assertEqual(
      'and it is the ladder, read off the attempt ordinal',
      schedules[0],
      JSON.stringify([EMISSION_LADDER[0], EMISSION_LADDER[1]]),
    );
    // THE SHARPEST FORM, and the one the not_found is actually about: a foreign-Organization
    // probe followed by a fabricated one costs ONE write, because they are the same group. If
    // the second request also wrote, the caller would learn from its own latency that it had
    // named something the counter had not seen before.
    const world = await makeWorld();
    try {
      const pair = await emissionSchedule(world, world.ownerA, [CUST_B_ANNA, CUST_NOWHERE]);
      assertEqual(
        `${ISOLATION} foreign then fabricated: the second request does no extra work`,
        JSON.stringify(pair),
        JSON.stringify([1]),
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE TIMING ORACLE, FALSIFIED — with the identifier BACK in the group key the same three campaigns produce three DIFFERENT schedules, and the group count becomes unbounded', async () => {
    // ===========================================================================================
    // THIS CASE IS WHAT MAKES THE ONE ABOVE EVIDENCE RATHER THAN A COMMENT.
    // ===========================================================================================
    //
    // The world is built with `identifierInGroupKey`, which wraps the SHIPPED coordinator so
    // that every denial is re-keyed by the identifier the caller supplied — the single change
    // 0013 control 5 forbids, and the exact "improvement" a future author would reach for. If
    // this case ever goes green, the assertion above has stopped detecting the change.
    const runs: [string, string[], number[]][] = [
      // Two groups, each emitting on its own first attempt: ordinals 1 and 2.
      ['alternating foreign / fabricated', Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? CUST_B_ANNA : CUST_NOWHERE)), [1, 2]],
      // One group, so the ladder again: 1 and 10.
      ['the same foreign identifier twelve times', Array.from({ length: 12 }, () => CUST_B_ANNA), [1, 10]],
      // Twelve groups: EVERY request writes. One per attempt — per-attempt writes restored
      // under another name, which is control 5's warning, measured.
      ['twelve distinct fabricated identifiers', fabricated(12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    ];
    const schedules: string[] = [];
    for (const [name, identifiers, expected] of runs) {
      const world = await makeWorld({ identifierInGroupKey: true });
      try {
        const observed = await emissionSchedule(world, world.ownerA, identifiers);
        assertEqual(`with the identifier in the key, "${name}" emits at`, JSON.stringify(observed), JSON.stringify(expected));
        schedules.push(JSON.stringify(observed));
      } finally {
        world.close();
      }
    }
    assertEqual(
      'THE SCHEDULE NOW DEPENDS ON THE IDENTIFIERS — three campaigns, three different schedules',
      new Set(schedules).size,
      3,
    );

    // AND THE FOREIGN / FABRICATED PAIR, WHICH IS THE PAIR THE not_found IS ABOUT: the second
    // request now writes as well, so it is measurably slower than it was, for no reason other
    // than that the caller named a different string.
    const world = await makeWorld({ identifierInGroupKey: true });
    try {
      const pair = await emissionSchedule(world, world.ownerA, [CUST_B_ANNA, CUST_NOWHERE]);
      assertEqual(
        'foreign then fabricated: BOTH requests now do the extra work',
        JSON.stringify(pair),
        JSON.stringify([1, 2]),
      );
      assertEqual('and the two probes are now two rows, not one', world.denialSummaryRows().length, 2);
      assertTrue(
        'each naming the identifier it was probed with — the campaign can read back what it tried',
        world.denialSummaryRows().every((row) => String(row.action_id).includes('~')),
        JSON.stringify(world.denialSummaryRows().map((row) => row.action_id)),
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // CONTROL 6 — rate limits, before any Customer D1 query
  // =========================================================================================

  suite.test('CONTROL 6 — the PER-ACTOR limit binds the threat 0013 names: one authenticated caller, and the refusal costs no Customer query', async () => {
    const world = await makeWorld();
    try {
      const limit = RATE_LIMIT_PER_WINDOW.actor;
      for (let request = 0; request < limit; request += 1) {
        expectOk(`request ${request + 1} of ${limit} is admitted`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      }
      const before = customerStatements(world).length;
      expectError(
        `request ${limit + 1} is refused`,
        await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }),
        EXPECTED_RATE_LIMITED,
      );
      assertEqual(
        'AND IT ISSUED NO CUSTOMER QUERY — the limit is enforced before D1 is touched',
        customerStatements(world).length,
        before,
      );

      // ANOTHER ACTOR IN THE SAME ORGANIZATION IS UNAFFECTED, which is what makes this the
      // per-ACTOR level and not a coarser one.
      expectOk('a different actor is still served', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_ANNA }));

      // AND THE WINDOW RELEASES. Fixed windows, not a sliding log — a log would be per-attempt
      // state, which is the thing 0013 removed.
      world.clock.set(FIXED_START_MS + RATE_WINDOW_MS);
      expectOk('the next window admits again', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 6 — the PER-ORGANIZATION limit engages even when no single actor is over its own', async () => {
    const world = await makeWorld();
    try {
      // Six credentials, fifty requests each: 300 requests, and every actor sits at 50 against
      // its own limit of 60. Without this level, one Organization's runaway integration fleet
      // could spend the platform's capacity through many credentials while every individual
      // credential stayed politely under.
      const limit = RATE_LIMIT_PER_WINDOW.organization;
      const actors = Array.from({ length: 6 }, (_, index) =>
        makePrincipal({
          principalId: `prn_fleet_${index}`,
          organizationId: ORG_A,
          authorizedBusinessIds: [BIZ_A_NORTH, BIZ_A_SOUTH],
          grants: PERMISSION_IDS.map((permissionId) => ({ permissionId, scope: 'organization' as const })),
        }),
      );
      for (let request = 0; request < limit; request += 1) {
        expectOk(
          `request ${request + 1} of ${limit}`,
          await world.invoke(world.actions.get, actors[request % actors.length], { customer_id: CUST_A_ANNA }),
        );
      }
      const perActor = limit / actors.length;
      assertTrue(
        'control: every actor is well under its OWN limit',
        perActor < RATE_LIMIT_PER_WINDOW.actor,
        `${perActor} requests per actor against a per-actor limit of ${RATE_LIMIT_PER_WINDOW.actor}`,
      );
      expectError(
        'the next request is refused at the Organization level',
        await world.invoke(world.actions.get, actors[0], { customer_id: CUST_A_ANNA }),
        EXPECTED_RATE_LIMITED,
      );
      // AND IT IS THE ORGANIZATION, NOT THE PLATFORM: Organization B is untouched.
      expectOk(
        `${ISOLATION} another Organization is unaffected`,
        await world.invoke(world.actions.get, world.ownerB, { customer_id: CUST_B_ANNA }),
      );
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 6 — the SOURCE-ADDRESS level is implemented correctly in the ALGORITHM, and null shares one bucket rather than being exempt', () => {
    // Asserted against `admit` directly, on ONE `CoordinationState`. That is the level of the
    // system where the algorithm lives, and it is the half of the source level that is right.
    // The half that is not is the case immediately below.
    const state = createCoordinationState();
    const limit = RATE_LIMIT_PER_WINDOW.source;
    // Distinct principals AND distinct Organizations, so neither of the other two levels can be
    // what refuses — the source counter is the only one that accumulates.
    for (let request = 0; request < limit; request += 1) {
      const decision = admit(state, {
        organizationId: `org_source_${request}`,
        principalId: `prn_source_${request}`,
        sourceAddressHash: 'hash_of_one_office_nat',
        nowMs: FIXED_START_MS,
      });
      assertEqual(`request ${request + 1} of ${limit} is admitted`, decision.outcome, 'admitted');
    }
    const over = admit(state, {
      organizationId: 'org_source_over',
      principalId: 'prn_source_over',
      sourceAddressHash: 'hash_of_one_office_nat',
      nowMs: FIXED_START_MS,
    });
    assertEqual('the next request from that source is refused', over.outcome, 'rate_limited');
    assertEqual('by the SOURCE level specifically', over.refusedBy, 'source');
    assertTrue('with a Retry-After of at least one second', over.retryAfterSeconds >= 1, 'Retry-After: 0 invites an immediate retry');
    assertEqual(
      'while a different source is still served',
      admit(state, {
        organizationId: 'org_source_other',
        principalId: 'prn_source_other',
        sourceAddressHash: 'hash_of_a_different_source',
        nowMs: FIXED_START_MS,
      }).outcome,
      'admitted',
    );

    // NULL IS NOT AN EXEMPTION. An adapter that cannot establish a source shares ONE bucket
    // with every other unknown source, so forgetting to supply it throttles harder rather than
    // disabling the level — the fail-closed direction.
    const unknownState = createCoordinationState();
    for (let request = 0; request < limit; request += 1) {
      admit(unknownState, {
        organizationId: `org_unknown_${request}`,
        principalId: `prn_unknown_${request}`,
        sourceAddressHash: null,
        nowMs: FIXED_START_MS,
      });
    }
    const overUnknown = admit(unknownState, {
      organizationId: 'org_unknown_over',
      principalId: 'prn_unknown_over',
      sourceAddressHash: null,
      nowMs: FIXED_START_MS,
    });
    assertEqual('an unknown source is throttled, not exempted', overUnknown.outcome, 'rate_limited');
    assertEqual('and by the source level, sharing one bucket', overUnknown.refusedBy, 'source');
  });

  suite.test('CONTROL 6 — REGRESSION: the source-address level now refuses ACROSS Organizations, which is the only thing the other two levels cannot do', async () => {
    // ===========================================================================================
    // THIS CASE WAS RED AND IS NOW GREEN, AND IT IS KEPT BECAUSE OF THAT RATHER THAN DESPITE IT.
    // ===========================================================================================
    //
    // QA reported that the third level of 0013 control 6 could never refuse anything: coordination
    // state is partitioned per Organization — correctly, because the deployed coordinator is one
    // Durable Object per Organization — so a source counter living inside one Organization's state
    // never aggregated a source active in several. And inside a single Organization the arithmetic
    // forbade it anyway, because 300 < 600 means the Organization level always answers first.
    //
    // `core-agent` fixed it with a SHARED `SourceCounterShard` that sits outside every
    // `CoordinationState`, and did NOT fix it by lowering the number — which would have produced a
    // level that fires without producing a level that catches anything new, and would have hurt
    // the office-behind-one-NAT case the decision reasons about. This case now asserts the
    // property the fix bought, so that a future refactor which puts the counter back inside the
    // per-Organization state turns it red again.
    //
    // ONE SHARED SHARD ACROSS MANY ORGANIZATIONS is the whole shape of the assertion. Distinct
    // Organizations and distinct principals on every request, so neither of the other two levels
    // can be what refuses; only the address is common.
    const coordinator = createInProcessRequestCoordinator(createInProcessDayWriteBudget(), {
      sourceShard: createInProcessSourceCounterShard(),
    });
    const limit = RATE_LIMIT_PER_WINDOW.source;
    // The shard learns of an Organization's traffic on that Organization's FIRST request of a
    // window and every SOURCE_REPORT_INTERVAL thereafter, so the shared total lags by up to
    // `SOURCE_REPORT_INTERVAL - 1` per active Organization. Each request here comes from a NEW
    // Organization, which is the reporting-friendly extreme: every one of them reports on its
    // first request, so the shared total is exact and the level engages at the limit.
    let refusedAt = -1;
    for (let request = 0; request <= limit + SOURCE_REPORT_INTERVAL; request += 1) {
      const begun = await coordinator.begin({
        organizationId: `org_source_${request}`,
        principalId: `prn_source_${request}`,
        sourceAddressHash: 'hash_of_one_office_nat',
        nowMs: FIXED_START_MS,
      });
      if (!begun.ok) {
        continue;
      }
      if (begun.value.outcome === 'rate_limited' && refusedAt === -1) {
        refusedAt = request + 1;
      }
      begun.value.dispose();
    }
    assertTrue(
      `one address spending budget through many Organizations is refused (0013 control 6, level 3) — refused at request ${refusedAt}`,
      refusedAt > 0,
      'the source level never engaged: the cross-Organization counter is not shared',
    );
    assertTrue(
      `and it engages at about the stated limit of ${limit}, not far past it`,
      refusedAt > limit && refusedAt <= limit + SOURCE_REPORT_INTERVAL + 1,
      `refused at request ${refusedAt} against a limit of ${limit}`,
    );

    // A DIFFERENT ADDRESS IS UNAFFECTED, so the level is per source and not a global throttle.
    const other = await coordinator.begin({
      organizationId: 'org_source_other',
      principalId: 'prn_source_other',
      sourceAddressHash: 'hash_of_a_different_source',
      nowMs: FIXED_START_MS,
    });
    assertTrue('a different source is still served', other.ok && other.value.outcome === 'admitted', 'the source level is not per source');

    // AND THE SHARD HOLDS NO TENANT DATA. It is the one counter that spans Organizations, so what
    // it can hold is a disclosure question: a hashed address, a window, an integer, and nothing
    // that names an Organization, a principal or a record.
    const shard = createInProcessSourceCounterShard();
    await shard.add('hash_of_one_office_nat', FIXED_START_MS, 3);
    assertEqual('the shard counts', shard.totalFor('hash_of_one_office_nat', FIXED_START_MS), 3);
    assertEqual(
      `${ISOLATION} and a different window is a different bucket, so a total cannot leak across time either`,
      shard.totalFor('hash_of_one_office_nat', FIXED_START_MS + RATE_WINDOW_MS),
      0,
    );
  });

  suite.test('CONTROL 6 — an unreachable source shard DEGRADES rather than blocks, so the fallback level cannot become an outage lever of its own', async () => {
    // The level that spans Organizations is also the level whose failure could refuse every
    // Organization at once. `brokenSourceShard` makes the shared counter unreachable; admission
    // must continue on the two tenant-scoped levels rather than fail closed platform-wide —
    // the same argument as 0013's degraded mode, one level out.
    const coordinator = createInProcessRequestCoordinator(createInProcessDayWriteBudget(), {
      brokenSourceShard: true,
    });
    const begun = await coordinator.begin({
      organizationId: ORG_A,
      principalId: 'prn_owner_alpha',
      sourceAddressHash: 'hash_of_one_office_nat',
      nowMs: FIXED_START_MS,
    });
    assertTrue('a request is still admitted', begun.ok && begun.value.outcome === 'admitted', 'a broken source shard refused a request');
    if (begun.ok) {
      begun.value.dispose();
    }
    // And the tenant-scoped levels still bind, so degrading the fallback does not disable the
    // limiter — which would be the fail-open direction.
    const state = createCoordinationState();
    for (let request = 0; request < RATE_LIMIT_PER_WINDOW.actor; request += 1) {
      admit(state, { organizationId: ORG_A, principalId: 'prn_owner_alpha', sourceAddressHash: null, nowMs: FIXED_START_MS });
    }
    assertEqual(
      'the per-actor level is unaffected by the shared counter being down',
      admit(state, { organizationId: ORG_A, principalId: 'prn_owner_alpha', sourceAddressHash: null, nowMs: FIXED_START_MS }).outcome,
      'rate_limited',
    );
  });

  suite.test('CONTROL 6 — the pipeline forwards the transport\'s source hash and derives the other two levels from the AUTHENTICATED context, never from the request', async () => {
    const world = await makeWorld();
    try {
      // `CoordinatedRequest[]` RATHER THAN A HAND-WRITTEN SHAPE, since 2026-09-05. The literal
      // listed three of the port's four fields and omitted `nowMs`, so this array had quietly
      // stopped being the thing `withKeyRecorder` records into. **The assertions below read the
      // fields they name and would not have noticed a fourth appearing** — which is the whole
      // reason `npm run typecheck:tests` exists. Naming the port's own type means the next field
      // arrives as a compile error rather than as a silently-narrower record.
      const requests: CoordinatedRequest[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withKeyRecorder(world.dependencies.coordinator, [], requests),
      };
      expectOk(
        'a request carrying a source hash',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          {
            principal: world.ownerA,
            app: world.app,
            requestId: 'req_source',
            correlationId: 'cor_source',
            sourceAddressHash: 'hash_supplied_by_the_transport',
          },
          { customer_id: CUST_A_ANNA },
        ),
      );
      expectOk(
        'and one carrying none',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_nosource', correlationId: 'cor_nosource' },
          { customer_id: CUST_A_ANNA },
        ),
      );
      assertEqual('two admissions', requests.length, 2);
      assertEqual('the actor level is the AUTHENTICATED principal', requests[0].principalId, 'prn_owner_alpha');
      assertEqual('the Organization level is the AUTHENTICATED Organization', requests[0].organizationId, ORG_A);
      assertEqual('the source level is the hash the transport supplied', requests[0].sourceAddressHash, 'hash_supplied_by_the_transport');
      assertEqual('and an absent hash becomes null, not a fabricated value', requests[1].sourceAddressHash, null);
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 6 — a rate-limited caller still receives forbidden if it lacks the permission, so the limiter does not move a denial the contract specifies', async () => {
    const world = await makeWorld();
    try {
      // The pipeline places the limit AFTER authorize and validate. That ordering is deliberate
      // and is worth an assertion: a `rate_limited` that pre-empted an authorization failure
      // would change which error two otherwise identical callers see, which is a difference an
      // attacker can measure. Both orderings protect D1 equally, because the first step that
      // queries anything is still below the limit.
      const limit = RATE_LIMIT_PER_WINDOW.actor;
      for (let request = 0; request < limit + 5; request += 1) {
        await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA });
      }
      expectError(
        'well past its limit, and still forbidden rather than rate_limited',
        await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }),
        EXPECTED_FORBIDDEN,
      );
      assertEqual('and it never touched the Customer table', customerStatements(world).length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('NEW DENIAL REASON — rate_limited is RECORDED, tells the caller only about itself, and does not split not_found', async () => {
    const world = await makeWorld();
    try {
      // The reason `rate_limited` was added to `AuditDenialReason`: without it, a THROTTLED
      // caller — which is what a probing campaign looks like once these controls work — fell
      // through the recording path and produced no evidence, which is the same silence D2 was
      // decided to end, arriving through the fix for it.
      const limit = RATE_LIMIT_PER_WINDOW.actor;
      for (let request = 0; request < limit; request += 1) {
        await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA });
      }
      const beforeQueries = customerStatements(world).length;
      expectError('over the limit', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_RATE_LIMITED);
      expectError('over the limit again, on a fabricated identifier', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_RATE_LIMITED);

      const rows = world.denialSummaryRows().filter((row) => row.denial_reason === 'rate_limited');
      assertEqual('the throttled caller is not silent — one group, one row', rows.length, 1);
      assertEqual('the category is rate_limited', rows[0].denial_reason, 'rate_limited');
      assertEqual('a throttled campaign is ONE group, not one per attempt', new Set(rows.map((row) => row.denial_summary_id)).size, 1);

      // IT TELLS THE CALLER ABOUT ITSELF, NOT ABOUT DATA — verified rather than assumed.
      assertTrue(
        `${ISOLATION} the row names neither identifier that was refused`,
        !JSON.stringify(rows[0]).includes(CUST_B_ANNA) && !JSON.stringify(rows[0]).includes(CUST_NOWHERE),
        `a rate_limited summary carried a probed identifier: ${JSON.stringify(rows[0])}`,
      );
      assertEqual(
        `${ISOLATION} and neither refusal queried the Customer table, so it cannot be an existence oracle`,
        customerStatements(world).length,
        beforeQueries,
      );
      // NOT A SPLIT OF not_found: the two refusals above were for a FOREIGN identifier and a
      // FABRICATED one, and both produced the identical code and the identical row. A caller
      // over its limit learns nothing about either identifier.
      assertEqual('not_found is unsplit — no new category distinguishes the two probes', world.denialSummaryRows().filter((row) => row.denial_reason === 'not_found').length, 0);
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // CONTROL 7 — malformed identifiers are rejected before D1
  // =========================================================================================

  suite.test('CONTROL 7 — a malformed identifier costs ZERO Customer queries, and a campaign of them costs a bounded number of writes', async () => {
    const world = await makeWorld();
    try {
      // "That path was the cheapest denial to produce and it must cost nothing downstream." It
      // used to cost a resolver call, a store handle, an audit sink and a D1 insert PER
      // ATTEMPT; the question is what it costs now.
      const campaign = 200;
      for (let attempt = 0; attempt < campaign; attempt += 1) {
        // One minute apart so the rate limiter is not what this case measures.
        world.clock.set(FIXED_START_MS + attempt * 60_000);
        await world.invoke(world.actions.get, world.ownerA, { customer_id: `not a valid identifier ${attempt}` });
      }
      assertEqual('TWO HUNDRED malformed requests, ZERO Customer queries', customerStatements(world).length, 0);

      // The evidence is still produced — silence was the original defect — but its cost is
      // bounded by the ladder rather than by the attacker's request rate. 200 minutes spans 14
      // fifteen-minute windows, so the ceiling is 14 x MAX_WRITES_PER_GROUP_WINDOW.
      const rows = world.denialSummaryRows();
      assertTrue('the campaign is not silent', rows.length > 0, 'a 200-attempt malformed campaign produced no evidence');
      assertTrue(
        `the write cost is bounded far below one per attempt — ${rows.length} rows for ${campaign} attempts`,
        rows.length <= 14 * MAX_WRITES_PER_GROUP_WINDOW && rows.length < campaign,
        `${rows.length} summary rows for ${campaign} malformed attempts`,
      );
      const total = rows
        .filter((row) => row.window_closed === 1)
        .reduce((sum, row) => sum + Number(row.attempt_count), 0);
      assertTrue('and the closed windows account for nearly all of the run', total >= campaign - 15, `closed windows account for ${total} of ${campaign}`);

      // POSITIVE CONTROL: a WELL-FORMED identifier does reach the table, so "zero queries"
      // above is a property of the malformed path and not of a broken harness.
      expectError('a well-formed but nonexistent identifier', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      assertTrue('the well-formed path DOES query', customerStatements(world).length > 0, 'no Customer query on the well-formed path — the control proves nothing');
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 7 — a refusal at authorization also costs zero Customer queries, because storage is resolved LATE', async () => {
    const world = await makeWorld();
    try {
      expectError('no permission', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      assertEqual('a step-3 refusal issued no Customer query', customerStatements(world).length, 0);
      expectError('no permission, on a mutating Action', await world.invoke(world.actions.archive, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      assertEqual('and neither did the mutating one', customerStatements(world).length, 0);
      // The only D1 work either refusal caused is the denial summary itself, which is the
      // bounded cost 0013 chose. Named so the number is not a mystery.
      assertEqual('the only writes are the two denial summaries', world.denialSummaryRows().length, 2);
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // CONTROL 8 — fail-closed
  // =========================================================================================

  for (const mode of ['absent', 'reject', 'throw'] as const) {
    suite.test(`CONTROL 8 — with the coordinator ${mode}, access is NEVER permitted, the external not_found is unchanged, and no write commits`, async () => {
      const world = await makeWorld({ coordinatorMode: mode });
      try {
        // ---- 1. THE EXTERNAL ANSWER IS UNCHANGED. A caller must not be able to tell that the
        // coordinator is degraded, least of all on the path the indistinguishability
        // requirement protects.
        const foreign = await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA });
        const nowhere = await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE });
        expectError(`${ISOLATION} a foreign-Organization probe is still not_found`, foreign, EXPECTED_NOT_FOUND);
        expectError('and so is a fabricated identifier', nowhere, EXPECTED_NOT_FOUND);
        assertEqual(
          `${ISOLATION} and the two are still byte-identical`,
          JSON.stringify(foreign),
          JSON.stringify(nowhere),
        );

        // ---- 2. NOTHING IS WIDENED. A refusal that was a refusal stays one.
        expectError('an unauthorized read is still forbidden', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
        expectError(`${ISOLATION} an unauthorized Business is still forbidden`, await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }), EXPECTED_FORBIDDEN);

        // ---- 3. AND NOTHING WRITES. Degraded mode is READ-ONLY: with the limiter unavailable
        // there is nothing bounding what a caller may spend of an account-wide D1 write
        // allowance whose exhaustion stops D1 for EVERY Organization.
        expectError(
          'a mutation is refused rather than committed unbounded',
          await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
          EXPECTED_UNAVAILABLE,
        );
        const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
        assertEqual('THE ROW DID NOT CHANGE — the refusal is real, not cosmetic', row?.status, 'active');
        assertEqual('and no audit record claims it did', world.auditRows().length, 0);
        assertEqual('and no denial summary was written either — there was no coordinator to count it', world.denialSummaryRows().length, 0);

        // ---- 4. THE READ SURFACE STAYS UP. A successful GetCustomer is deliberately unaudited,
        // so it writes nothing and is still served. That is the whole reason degraded mode is
        // read-only rather than a blanket refusal: "coordinator down => everything refused"
        // would be the previous vulnerability with a different resource name.
        expectOk('an unaudited read still works', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      } finally {
        world.close();
      }
    });
  }

  suite.test('CONTROL 8 — an EXHAUSTED coordinator refuses rather than admits, and the refusal writes nothing to the Customer table', async () => {
    const world = await makeWorld();
    try {
      // Exhaustion is the other half of control 8's sentence — "failure OR EXHAUSTION of the
      // audit coordinator must never permit access". Exhaustion is reached by the limiter
      // rather than by breaking anything.
      for (let request = 0; request < RATE_LIMIT_PER_WINDOW.actor; request += 1) {
        await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA });
      }
      const before = customerStatements(world).length;
      expectError(
        'a mutation past the limit is refused',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        EXPECTED_RATE_LIMITED,
      );
      assertEqual('and it issued no Customer query', customerStatements(world).length, before);
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the row is untouched', row?.status, 'active');
      // AND A READ PAST THE LIMIT IS REFUSED TOO — a rate limit that only bound writes would
      // leave the read path, which is the probing path, unbounded.
      expectError(
        `${ISOLATION} and so is a cross-tenant probe`,
        await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_RATE_LIMITED,
      );
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 8 — degraded mode refuses an AUDITED read as well, because an audit row is itself a D1 write', async () => {
    const world = await makeWorld({ coordinatorMode: 'absent' });
    try {
      // The check in the pipeline is on the exact set of rows about to be committed, not on a
      // sensitivity label — so there is no proxy to be wrong about and no Action can be
      // mis-classified onto the permitted side. RestoreCustomer on an archived row is a
      // mutation; the assertion that matters is that nothing committed.
      expectError(
        'an audited operation is refused in degraded mode',
        await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ARCHIVED }),
        EXPECTED_UNAVAILABLE,
      );
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ARCHIVED);
      assertEqual('the row is still archived', row?.status, 'archived');
      assertEqual('and nothing was audited', world.auditRows().length, 0);
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // CONTROL 9 — the daily summary-write ceiling
  //
  // AMENDED BY docs/decisions/0014 §A.5. The ceiling's UNIT changed: 0013 counted SUMMARIES,
  // 0014 counts ROW-WRITES AS D1 BILLS THEM, and one summary is four of those — the
  // `denial_summary` table plus its primary-key index plus its two explicit indexes, under
  // Cloudflare's rule that an index adds a written row. The ceiling also stopped being its own
  // budget and became the `security` ALLOCATION of one platform ledger, because two independent
  // daily ceilings would sum past the platform ceiling by construction.
  //
  // These cases are rewritten in the new unit, not re-pointed at a renamed constant.
  // =========================================================================================

  suite.test('CONTROL 9 — at the daily ceiling, summary writes STOP, attempts keep being counted, the loss is announced, and the caller is NOT refused', async () => {
    const world = await makeWorld({ dailyCeilings: { security: 0 } });
    try {
      const reported: CoordinationFailure[] = [];
      const reporter: CoordinationFailureReporter = { report: (failure) => reported.push(failure) };
      const dependencies = { ...world.dependencies, coordinationFailureReporter: reporter };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expectError(
          `${ISOLATION} probe ${attempt + 1} is still refused normally`,
          await invokeAction(
            dependencies,
            asAnyAction(world.actions.get),
            { principal: world.ownerA, app: world.app, requestId: `req_ceiling_${attempt}`, correlationId: `cor_ceiling_${attempt}` },
            { customer_id: CUST_B_ANNA },
          ),
          EXPECTED_NOT_FOUND,
        );
      }
      assertEqual('NO summary was written — D1 capacity is reserved for the product', world.denialSummaryRows().length, 0);
      assertTrue('the suppression is announced', reported.length > 0, 'evidence stopped being written and nobody was told');
      assertEqual('with the ceiling cause, which is NOT a fault', reported[0].cause, 'ceiling_reached');
      assertEqual('naming how many summaries it refused', reported[0].lost, 1);
      assertTrue(
        'and the notice names the group it refused, so an operator knows which counts stopped',
        reported[0].key?.actionId === 'customers.GetCustomer' && reported[0].key?.category === 'not_found',
        JSON.stringify(reported[0].key),
      );

      // THE CALLER IS NOT REFUSED. Turning the ceiling into a request refusal would be a second
      // denial-of-service lever, which is the exact mistake 0013 exists to correct.
      expectOk('and a legitimate read is served as normal', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectOk('including a mutation', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 9 — the ceiling is a CEILING, and it is spent in ROW-WRITES: a security allocation of exactly two summaries buys two, and no more', async () => {
    // THE UNIT IS THE POINT OF THIS CASE. The allocation is set to two summaries' WORTH — two
    // times `DENIAL_SUMMARY_ROW_WRITES` — rather than to the number 2, and the assertion checks
    // both the rows written and the row-writes charged. An implementation that had kept counting
    // summaries while the ledger counted row-writes would write EIGHT summaries here, spend four
    // times the allocation it was given, and look correct on a row count alone.
    const world = await makeWorld({ dailyCeilings: { security: 2 * DENIAL_SUMMARY_ROW_WRITES } });
    try {
      const reported: CoordinationFailure[] = [];
      const dependencies = { ...world.dependencies, coordinationFailureReporter: { report: (failure: CoordinationFailure) => reported.push(failure) } };
      // Four distinct groups, so four emissions are due and only two can be paid for.
      const attempts: readonly [AuthenticatedPrincipal, string][] = [
        [world.ownerA, CUST_B_ANNA],
        [world.unprivilegedA, CUST_A_ANNA],
        [world.adminANorth, CUST_A_SOUTH],
        [world.ownerA, 'not a valid identifier'],
      ];
      for (const [principal, identifier] of attempts) {
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal, app: world.app, requestId: 'req_n', correlationId: 'cor_n' },
          { customer_id: identifier },
        );
      }
      assertEqual('exactly two summaries were written', world.denialSummaryRows().length, 2);
      assertEqual(
        'and the SECURITY allocation was charged their true row-write cost, not one each',
        world.budget.usedToday('security'),
        2 * DENIAL_SUMMARY_ROW_WRITES,
      );
      assertEqual('the two it could not pay for were announced', reported.filter((entry) => entry.cause === 'ceiling_reached').length, 2);
      // ALLOCATIONS DO NOT BORROW. A spent security allocation must not reach into `business`,
      // which is the whole reason for splitting one ledger into three counters: a probing
      // campaign must not be able to spend the product's capacity through the evidence path.
      assertEqual('the business allocation is untouched by any of it', world.budget.usedToday('business'), 0);
      assertEqual('and so is the system allocation', world.budget.usedToday('system'), 0);
    } finally {
      world.close();
    }
  });

  suite.test('CONTROL 9 — the PER-ORGANIZATION ceiling exists so one Organization cannot blind every other, and it binds at its stated value', async () => {
    // Driven against the shipped engine directly. Reaching 1,000 emissions through the pipeline
    // would need either 1,000 distinct credentials or many UTC days of clock movement, and
    // neither would test anything the engine does not decide on its own.
    const state = createCoordinationState();
    // A deliberately generous platform reserve, so the PER-ORGANIZATION ceiling is the only
    // thing that can bind. Without this the platform block size would be what ran out first and
    // the case would pass while measuring the wrong ceiling.
    creditPermits(state, PLATFORM_DAILY_SUMMARY_ROW_WRITES, FIXED_START_MS);
    const context = { actorBusinessIds: [BIZ_A_NORTH], permissionId: 'customers.customer.read', scope: 'business' };

    let emitted = 0;
    let suppressed = 0;
    const attempts = PER_ORGANIZATION_DAILY_SUMMARIES + 50;
    for (let index = 0; index < attempts; index += 1) {
      // One group per synthetic principal, so every attempt is a group's first and emits.
      const key = deriveDenialGroupKey({
        principal: makePrincipal({
          principalId: `prn_ceiling_${index}`,
          organizationId: ORG_A,
          authorizedBusinessIds: [BIZ_A_NORTH],
          grants: [],
        }),
        action: { appId: 'customers', id: 'customers.GetCustomer' },
        category: 'not_found',
      });
      const outcome = engineRecordDenial(state, key, context, FIXED_START_MS);
      emitted += outcome.summaries.length;
      suppressed += outcome.suppressed;
    }
    assertEqual('exactly the per-Organization ceiling was emitted', emitted, PER_ORGANIZATION_DAILY_SUMMARIES);
    assertEqual('and everything past it was suppressed rather than silently dropped', suppressed, attempts - PER_ORGANIZATION_DAILY_SUMMARIES);
    // THE DERIVED SUMMARY COUNT IS NOT A SECOND DECLARATION. `PER_ORGANIZATION_DAILY_SUMMARIES`
    // is the row-write ceiling divided by the summary cost, so if an index is ever added to
    // `denial_summary` and `DENIAL_SUMMARY_ROW_WRITES` moves with it, this case follows without
    // an edit — and if the constant is NOT updated, the arithmetic assertion below goes red.
    assertEqual(
      'and the summary count really is the row-write ceiling divided by one summary',
      PER_ORGANIZATION_DAILY_SUMMARIES * DENIAL_SUMMARY_ROW_WRITES,
      PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES,
    );
    assertTrue(
      'the ceiling is well under the platform one, so a single Organization cannot spend the whole allocation',
      PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES < PLATFORM_DAILY_SUMMARY_ROW_WRITES,
      `per-Organization ${PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES} against platform ${PLATFORM_DAILY_SUMMARY_ROW_WRITES}`,
    );
    assertEqual(
      "0013's 5:1 platform-to-Organization ratio survived the unit change",
      PLATFORM_DAILY_SUMMARY_ROW_WRITES / PER_ORGANIZATION_DAILY_SUMMARY_ROW_WRITES,
      5,
    );
  });

  suite.test('CONTROL 9, REWRITTEN IN ROW-WRITES — denial evidence still cannot be what exhausts D1, and the corrected arithmetic is asserted rather than commented', () => {
    // The free-tier reasoning is the justification for these numbers, and numbers in a comment
    // drift. This case pins the relationships so a future edit to any allocation has to face
    // them.
    const FREE_TIER_REGISTER_WARNING_LINE = 70_000;
    assertEqual('the security allocation IS the summary ceiling — one ledger, not two', PLATFORM_DAILY_SUMMARY_ROW_WRITES, DAILY_ALLOCATION.security);
    assertTrue(
      `the security allocation (${PLATFORM_DAILY_SUMMARY_ROW_WRITES}) is at most 10% of the enforced D1 allowance (${D1_FREE_DAILY_ROW_WRITES})`,
      PLATFORM_DAILY_SUMMARY_ROW_WRITES * 10 <= D1_FREE_DAILY_ROW_WRITES,
      'denial evidence could become a meaningful share of the account-wide D1 write allowance',
    );
    assertTrue(
      `and stays under the register's warning line (${FREE_TIER_REGISTER_WARNING_LINE})`,
      PLATFORM_DAILY_SUMMARY_ROW_WRITES < FREE_TIER_REGISTER_WARNING_LINE,
      'the security allocation alone could trip the free-tier warning',
    );
    // And the per-group cost the ceilings are computed against is the one the ladder produces.
    assertEqual('the ladder has five points', EMISSION_LADDER.length, 5);
    assertEqual('so a group-window costs at most six SUMMARIES', MAX_WRITES_PER_GROUP_WINDOW, 6);
    const summariesPerDayOneGroup = MAX_WRITES_PER_GROUP_WINDOW * (24 * 60 * 60 * 1000 / DENIAL_WINDOW_MS);
    assertEqual('a single-group campaign running all day is 576 summaries', summariesPerDayOneGroup, 576);
    // ===========================================================================================
    // THE CORRECTION, ASSERTED. `0013` claimed its 5,000-summary ceiling accommodated EIGHT
    // simultaneous all-day campaigns. The real figure was always FOUR, because the index rows
    // were never counted — 576 summaries is 2,304 row-writes, not 576. The allocation did not
    // shrink; the arithmetic was wrong and 0014 corrected it. This case asserts the corrected
    // number, and asserts that the old one is NOT reachable, so nobody restores it from memory.
    // ===========================================================================================
    const rowWritesPerDayOneGroup = summariesPerDayOneGroup * DENIAL_SUMMARY_ROW_WRITES;
    assertEqual('which is 2,304 ROW-WRITES once the indexes are counted', rowWritesPerDayOneGroup, 2_304);
    const campaigns = Math.floor(PLATFORM_DAILY_SUMMARY_ROW_WRITES / rowWritesPerDayOneGroup);
    assertEqual('so the allocation accommodates FOUR simultaneous all-day campaigns', campaigns, 4);
    assertTrue(
      "and NOT the eight 0013 claimed — that figure counted summaries as one row-write each",
      campaigns < 8,
      'the corrected arithmetic has been reverted to the uncorrected one',
    );
    assertEqual('or about 2,500 isolated one-off denials', PLATFORM_DAILY_SUMMARIES, 2_500);
    assertEqual(
      'the derived summary count is the allocation divided by one summary, never declared twice',
      PLATFORM_DAILY_SUMMARIES * DENIAL_SUMMARY_ROW_WRITES,
      PLATFORM_DAILY_SUMMARY_ROW_WRITES,
    );
  });

  return suite;
}
