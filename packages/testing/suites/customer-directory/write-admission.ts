/**
 * ===========================================================================================
 * docs/decisions/0014 §A — DAILY D1 WRITE ADMISSION
 * ===========================================================================================
 *
 * `0014-authentication-az2.md`, Accepted, user decision of 2026-09-02. `0013` bounded what a
 * DENIED request writes and left the success path bounded by nothing: every rate limit in this
 * system uses a 60-second window and every D1 allowance that causes an outage is DAILY, so at
 * 60 requests a minute one credential may make 86,400 requests a day against an enforced,
 * account-wide 100,000 rows written. The realistic trigger is not an attacker — it is a tenant
 * migrating fifty thousand records through the API, fully authorized and inside every limit.
 *
 * ===========================================================================================
 * THE UNIT CHANGED, AND THAT IS WHY 0013's CEILING CASES WERE REWRITTEN RATHER THAN RE-POINTED
 * ===========================================================================================
 *
 * `0013` counted SUMMARIES. `0014` counts ROW-WRITES AS D1 BILLS THEM, and Cloudflare bills an
 * extra written row per index the write touches ("there are two rows written: one to the table
 * itself, and one to the index"). A composite `PRIMARY KEY` on a rowid table is an index too. So
 * a Customer create is EIGHT row-writes, not two — three for the customer row and its two
 * indexes, five for the audit row and its four.
 *
 * THE ADR ITSELF IS WRONG ABOUT THIS, and the discrepancy is asserted rather than smoothed over:
 * §A.7 says a create costs "two units" and §A.8 concludes "at most 5,000 customers/day". Those
 * count ROWS INSERTED. In the unit §A.3's ceiling is denominated in, the figures are 8 and
 * 1,250. The IMPLEMENTED behaviour is 8, this suite asserts 8, and the ADR's two numbers are
 * REPORTED to the Team Lead as needing correction. The ceilings themselves — 80,000, 20,000,
 * 60,000/10,000/10,000, 10,000 per Organization — are implemented exactly as decided and are
 * asserted at those values.
 *
 * ===========================================================================================
 * THE INDEX-COUNT CHECK, WHICH IS THE ONE THING A REVIEW OBLIGATION CANNOT DO
 * ===========================================================================================
 *
 * `storage/write-cost.ts` says, correctly and honestly, that nothing can catch a declaration
 * that counts statements right and index rows wrong, because D1 exposes no portable schema
 * introspection through the binding — so it is "a review obligation, stated as one".
 *
 * A REVIEW OBLIGATION IS EXACTLY WHAT A TEST CAN REPLACE HERE, because this harness is not D1:
 * the migrations are EXECUTED into a real SQLite database, so `PRAGMA index_list` answers what
 * D1 will not. `assertDeclaredCostMatchesSchema` below computes every table's true cost from the
 * live schema — table row plus one per index, `sqlite_autoindex_*` included — and compares it
 * with the declared constants and with what each Action actually reserves. Add an index to a
 * migration without moving the number and this suite goes red. The review obligation stands for
 * a DEPLOYED database whose schema this harness does not see; for the migrations in this
 * repository it is now enforced.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  CUST_B_ANNA,
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  EXPECTED_QUOTA_EXCEEDED,
  EXPECTED_UNAVAILABLE,
  FIXED_START_MS,
  ORG_A,
  ORG_B,
} from '../../harness/world.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import {
  asAnyAction,
  assertWriteCostPolicy,
  estimatedRowWriteCost,
  WriteCostPolicyError,
} from '../../../../platform/core/action/action.ts';
import type { ActionDefinition } from '../../../../platform/core/action/action.ts';
import {
  AUDIT_EVENT_ROW_WRITES,
  BUSINESS_ROW_WRITES,
  CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE,
  DEFAULT_ROW_WRITES_PER_STATEMENT,
  DENIAL_SUMMARY_ROW_WRITES,
} from '../../../../platform/core/storage/write-cost.ts';
import {
  D1_FREE_DAILY_ROW_WRITES,
  DAILY_ALLOCATION,
  PER_ORGANIZATION_DAILY_ROW_WRITES,
  PLATFORM_DAILY_ROW_WRITE_CEILING,
  PLATFORM_DAILY_SAFETY_MARGIN,
  WriteBudgetIncoherentError,
  WriteNotAdmittedError,
  assertAllocationsAreCoherent,
  consumeWriteReservation,
  mintWriteReservation,
  nextUtcResetMs,
  retryAfterSecondsUntilReset,
  utcDayStart,
} from '../../../../platform/core/protection/write-admission.ts';
import { createInProcessDayWriteBudget } from '../../../../platform/core/protection/in-process-coordinator.ts';
import { WRITE_PERMIT_BLOCK } from '../../../../platform/core/protection/coordination-engine.ts';
import { withWriteRequestRecorder } from '../../harness/broken-coordination.ts';
import type { ApiDependencies } from '../../../../platform/core/http/api.ts';
import { handleRequest } from '../../../../platform/core/http/api.ts';
import { createRouter } from '../../../../platform/core/http/router.ts';
import type { PrincipalResolver } from '../../../../platform/core/identity/principal-resolver.ts';
import { createCustomerRoutes, CUSTOMERS_BASE_PATH } from '../../../../apps/customers/api/routes.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import type { Result } from '../../../../platform/core/kernel/result.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

/**
 * A table's TRUE estimated row-write cost, read from the live schema.
 *
 * One row for the table, plus one for every index SQLite actually created — which includes the
 * `sqlite_autoindex_*` that a composite `PRIMARY KEY` materialises on a rowid table, and which
 * is the index `write-cost.ts` charges for and could not otherwise verify.
 *
 * THIS IS THE WHOLE OF THE REVIEW OBLIGATION, MECHANISED. `PRAGMA index_list` is not available
 * through a D1 binding, which is why Core cannot do this at runtime; it is available here,
 * because the migrations are executed into a real SQLite database by the harness.
 */
function schemaRowWriteCost(world: World, table: string): number {
  const indexes = world.harness.raw.prepare(`PRAGMA index_list(${table})`).all() as unknown[];
  return 1 + indexes.length;
}

/** The table a write statement targets, or null for a read. */
function writtenTable(sql: string): string | null {
  const match = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
  return match === null ? null : match[1];
}

/** The true cost of every write statement the run has emitted so far. */
function observedRowWriteCost(world: World, from: number): number {
  let total = 0;
  for (const entry of world.harness.statements.slice(from)) {
    const table = writtenTable(entry.sql);
    if (table !== null) {
      total += schemaRowWriteCost(world, table);
    }
  }
  return total;
}

function url(path: string): string {
  return `https://dudo.test${CUSTOMERS_BASE_PATH}${path}`;
}

function apiFor(world: World): ApiDependencies {
  const principals: PrincipalResolver = { async resolve() { return ok(world.ownerA); } };
  return { ...world.dependencies, principals };
}

export function buildWriteAdmissionSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('docs/decisions/0014 §A — daily D1 write admission');

  // =========================================================================================
  // §A.3, §A.4, §A.5 — the ceilings, their coherence, and the unspendable margin
  // =========================================================================================

  suite.test('§A.3 and §A.5 — the three allocations sum to the platform ceiling EXACTLY, and nothing can exceed it by construction', () => {
    // The module ran `assertAllocationsAreCoherent()` at load. That the suite imported at all is
    // therefore already evidence that the three invariants hold today — an incoherent set would
    // have thrown before any case ran. What this case adds is that each invariant is asserted
    // SEPARATELY, so a future edit that breaks one produces a named failure rather than an
    // import error nobody can read.
    assertEqual('business allocation', DAILY_ALLOCATION.business, 60_000);
    assertEqual('security allocation', DAILY_ALLOCATION.security, 10_000);
    assertEqual('system allocation', DAILY_ALLOCATION.system, 10_000);
    assertEqual(
      'and they sum to the platform ceiling exactly — not less, which would strand capacity, and not more, which would not bound',
      DAILY_ALLOCATION.business + DAILY_ALLOCATION.security + DAILY_ALLOCATION.system,
      PLATFORM_DAILY_ROW_WRITE_CEILING,
    );
    assertEqual('the platform ceiling', PLATFORM_DAILY_ROW_WRITE_CEILING, 80_000);
    assertEqual('the safety margin', PLATFORM_DAILY_SAFETY_MARGIN, 20_000);
    assertEqual('the enforced account-wide allowance every number above is reasoned against', D1_FREE_DAILY_ROW_WRITES, 100_000);
    assertTrue(
      'ceiling plus margin does not exceed the enforced allowance',
      PLATFORM_DAILY_ROW_WRITE_CEILING + PLATFORM_DAILY_SAFETY_MARGIN <= D1_FREE_DAILY_ROW_WRITES,
      `${PLATFORM_DAILY_ROW_WRITE_CEILING} + ${PLATFORM_DAILY_SAFETY_MARGIN} > ${D1_FREE_DAILY_ROW_WRITES}`,
    );
    assertTrue(
      'and one Organization may not be permitted more than the whole business allocation',
      PER_ORGANIZATION_DAILY_ROW_WRITES <= DAILY_ALLOCATION.business,
      `${PER_ORGANIZATION_DAILY_ROW_WRITES} > ${DAILY_ALLOCATION.business}`,
    );
    assertEqual('the per-Organization ceiling', PER_ORGANIZATION_DAILY_ROW_WRITES, 10_000);
    // §A.6's stated consequence, asserted so the number to watch as Organizations are admitted
    // is in the suite rather than only in a comment: past six active Organizations the platform
    // allocation binds before the per-Organization one.
    assertEqual(
      'six Organizations at their ceiling saturate the business allocation',
      DAILY_ALLOCATION.business / PER_ORGANIZATION_DAILY_ROW_WRITES,
      6,
    );
    // THERE IS NO FOURTH ALLOCATION, and the margin is not one of them. See the next case.
    assertEqual(
      'there are exactly three allocations',
      Object.keys(DAILY_ALLOCATION).sort().join(','),
      'business,security,system',
    );
    // The guard function itself is callable and does not throw against the shipped constants.
    assertAllocationsAreCoherent();
    assertTrue('and its error type exists to be thrown', typeof WriteBudgetIncoherentError === 'function', 'no incoherence error type');
  });

  suite.test(
    '§A.5 — assertAllocationsAreCoherent() THROWS on each of its three incoherent inputs',
    () => {
      // ===========================================================================================
      // THIS WAS A SKIP. IT IS NOW THREE ORDINARY ASSERTIONS, AND THAT IS WORTH ONE PARAGRAPH.
      // ===========================================================================================
      //
      // The skip's reason was a limit of the code, not of the suite: the function took no
      // parameters and read module-level `const` bindings that ESM will not let a test rebind, so
      // its three throw branches were unreachable without editing `platform/core/**`. It named
      // exactly what was NOT covered — *"that the function would actually throw rather than, say,
      // comparing the wrong pair of numbers"* — and recommended optional parameters to the owning
      // agent rather than reaching across the boundary to add them.
      //
      // `core-agent` added them. Five optional parameters, all defaulting to the shipped
      // constants, every existing call unchanged, still asserted at module load. So the branches
      // are now reachable from outside and the skip has no reason to exist.
      //
      // EACH BRANCH IS DRIVEN SEPARATELY AND THE ERROR TYPE IS CHECKED. A single "it throws
      // something" assertion would pass if the function threw a TypeError from a typo, which is
      // the failure mode this case is supposed to distinguish from a real refusal.

      const expectThrows = (label: string, run: () => void): void => {
        let thrown: unknown = null;
        try {
          run();
        } catch (cause) {
          thrown = cause;
        }
        assertTrue(`${label}: it throws`, thrown !== null, 'the incoherent input was accepted');
        assertTrue(
          `${label}: and it throws WriteBudgetIncoherentError, not an incidental error`,
          thrown instanceof WriteBudgetIncoherentError,
          `threw ${thrown instanceof Error ? thrown.name : String(thrown)}`,
        );
      };

      // Branch 1 — the allocations must sum to the platform ceiling exactly. Under by 1.
      expectThrows('allocations summing to less than the ceiling', () => {
        assertAllocationsAreCoherent({
          business: DAILY_ALLOCATION.business - 1,
          security: DAILY_ALLOCATION.security,
          system: DAILY_ALLOCATION.system,
        });
      });
      // ...and over by 1, because "not equal" has two sides and a comparison written with the
      // wrong operator would catch only one of them.
      expectThrows('allocations summing to more than the ceiling', () => {
        assertAllocationsAreCoherent({
          business: DAILY_ALLOCATION.business + 1,
          security: DAILY_ALLOCATION.security,
          system: DAILY_ALLOCATION.system,
        });
      });

      // Branch 2 — ceiling plus margin must not exceed the enforced D1 allowance.
      expectThrows('ceiling plus margin exceeding the D1 daily allowance', () => {
        assertAllocationsAreCoherent(
          DAILY_ALLOCATION,
          PLATFORM_DAILY_ROW_WRITE_CEILING,
          D1_FREE_DAILY_ROW_WRITES - PLATFORM_DAILY_ROW_WRITE_CEILING + 1,
          PER_ORGANIZATION_DAILY_ROW_WRITES,
          D1_FREE_DAILY_ROW_WRITES,
        );
      });

      // Branch 3 — one Organization may not be permitted more than the whole business allocation.
      expectThrows('a per-Organization ceiling above the business allocation', () => {
        assertAllocationsAreCoherent(
          DAILY_ALLOCATION,
          PLATFORM_DAILY_ROW_WRITE_CEILING,
          PLATFORM_DAILY_SAFETY_MARGIN,
          DAILY_ALLOCATION.business + 1,
          D1_FREE_DAILY_ROW_WRITES,
        );
      });

      // THE POSITIVE CONTROL. Without it, a function that threw unconditionally would pass every
      // assertion above — which is precisely the "comparing the wrong pair of numbers" failure the
      // skip said was uncovered.
      let threwOnValidInput: unknown = null;
      try {
        assertAllocationsAreCoherent();
      } catch (cause) {
        threwOnValidInput = cause;
      }
      assertTrue(
        'and it does NOT throw against the shipped constants',
        threwOnValidInput === null,
        `the real parameter set was rejected: ${String(threwOnValidInput)}`,
      );
      // Explicitly passing the shipped values must behave identically to passing nothing, or the
      // defaults and the parameters have drifted apart and every case above tests a phantom.
      let threwOnExplicitValidInput: unknown = null;
      try {
        assertAllocationsAreCoherent(
          DAILY_ALLOCATION,
          PLATFORM_DAILY_ROW_WRITE_CEILING,
          PLATFORM_DAILY_SAFETY_MARGIN,
          PER_ORGANIZATION_DAILY_ROW_WRITES,
          D1_FREE_DAILY_ROW_WRITES,
        );
      } catch (cause) {
        threwOnExplicitValidInput = cause;
      }
      assertTrue(
        'and the explicit shipped values behave exactly as the defaults do',
        threwOnExplicitValidInput === null,
        `the defaults and the parameters disagree: ${String(threwOnExplicitValidInput)}`,
      );
    },
  );

  suite.test('§A.4 — the 20,000 safety margin is NOT spendable: draining every allocation yields 80,000 and never 100,000', async () => {
    // ===========================================================================================
    // ASSERTED BY DRAINING THE LEDGER, NOT BY READING THE CONSTANTS.
    // ===========================================================================================
    //
    // "It is not spendable capacity" is a claim about what CODE PATHS EXIST, and the only way to
    // test that is to take everything the ledger will give through every door it has and show the
    // total stops at the ceiling. A margin that could be reached through some allocation's
    // overflow, a borrow between allocations, or a top-up would show up here as a number larger
    // than 80,000.
    const budget = createInProcessDayWriteBudget();
    const day = utcDayStart(FIXED_START_MS);
    let granted = 0;
    for (const allocation of ['business', 'security', 'system'] as const) {
      // Ask for the whole enforced allowance from each allocation — far more than any of them
      // holds — so nothing is left unrequested.
      const first = await budget.take(day, allocation, D1_FREE_DAILY_ROW_WRITES);
      granted += first.ok ? first.value : 0;
      // And ask again, to prove a spent allocation cannot be topped up.
      const second = await budget.take(day, allocation, D1_FREE_DAILY_ROW_WRITES);
      assertEqual(`a spent ${allocation} allocation grants nothing more`, second.ok ? second.value : -1, 0);
    }
    assertEqual('the ledger will part with the platform ceiling and not one row-write more', granted, PLATFORM_DAILY_ROW_WRITE_CEILING);
    assertEqual(
      'so the margin is exactly what nothing was able to reach',
      D1_FREE_DAILY_ROW_WRITES - granted,
      PLATFORM_DAILY_SAFETY_MARGIN,
    );
    assertEqual('and each allocation reports itself fully spent', budget.usedToday('business'), DAILY_ALLOCATION.business);
    assertEqual('security likewise', budget.usedToday('security'), DAILY_ALLOCATION.security);
    assertEqual('system likewise', budget.usedToday('system'), DAILY_ALLOCATION.system);

    // AND THE DAY RESETS AT 00:00 UTC, not on a rolling window — the reset Cloudflare performs.
    const nextDay = utcDayStart(FIXED_START_MS + 24 * 60 * 60 * 1000);
    assertTrue('the next UTC day is a different ledger day', nextDay !== day, 'the day did not roll');
    const afterReset = await budget.take(nextDay, 'business', 100);
    assertEqual('and the new day starts full', afterReset.ok ? afterReset.value : -1, 100);
  });

  suite.test('§A.5 — allocations do not borrow: a spent SECURITY allocation cannot fund a business mutation, and the reverse', async () => {
    // The reason for splitting one ceiling into three counters. A probing campaign must not be
    // able to spend the product's capacity through the evidence path, and a system job must not
    // be able to spend a tenant's.
    const budget = createInProcessDayWriteBudget();
    const day = utcDayStart(FIXED_START_MS);
    expectOk('drain security', await budget.take(day, 'security', DAILY_ALLOCATION.security));
    assertEqual('security is spent', budget.usedToday('security'), DAILY_ALLOCATION.security);
    const business = await budget.take(day, 'business', 1_000);
    assertEqual('business is untouched and still grants', business.ok ? business.value : -1, 1_000);
    const moreSecurity = await budget.take(day, 'security', 1);
    assertEqual('while security grants nothing, having been spent', moreSecurity.ok ? moreSecurity.value : -1, 0);
    assertEqual('and the business spend did not come out of security', budget.usedToday('security'), DAILY_ALLOCATION.security);
  });

  // =========================================================================================
  // The index-count check — better than the review obligation `write-cost.ts` settles for
  // =========================================================================================

  suite.test('THE REVIEW OBLIGATION, MECHANISED — every declared row-write cost matches the ACTUAL index count of the table it describes', async () => {
    const world = await makeWorld();
    try {
      // `write-cost.ts` counts these by hand from the migration files and says a mechanism to
      // check them does not exist, because D1 exposes no portable schema introspection. It does
      // here: the migrations are executed into a real SQLite database, and `PRAGMA index_list`
      // reports every index including the `sqlite_autoindex_*` a composite PRIMARY KEY creates.
      //
      // ADD AN INDEX TO A MIGRATION AND FORGET THE CONSTANT, AND THIS CASE GOES RED — which is
      // the failure the comment says nothing can catch.
      assertEqual('audit_event: 1 table row + 4 indexes', schemaRowWriteCost(world, 'audit_event'), AUDIT_EVENT_ROW_WRITES);
      assertEqual('and that is five, the most expensive row in the platform', AUDIT_EVENT_ROW_WRITES, 5);
      assertEqual('denial_summary: 1 table row + 3 indexes', schemaRowWriteCost(world, 'denial_summary'), DENIAL_SUMMARY_ROW_WRITES);
      assertEqual('business: 1 table row + 1 implicit primary-key index', schemaRowWriteCost(world, 'business'), BUSINESS_ROW_WRITES);
      assertEqual(
        "customer: 1 table row + 2 indexes — the App's table, recorded in Core only for reference",
        schemaRowWriteCost(world, 'customer'),
        CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE,
      );

      // THE IMPLICIT INDEX IS REALLY THERE, asserted separately because the whole conversion
      // turns on charging for it and a reader may reasonably doubt SQLite materialises one.
      const businessIndexes = world.harness.raw.prepare('PRAGMA index_list(business)').all() as { origin: string; name: string }[];
      assertEqual('the business table has exactly one index', businessIndexes.length, 1);
      assertEqual('and it is the automatic one the composite PRIMARY KEY creates', businessIndexes[0].origin, 'pk');
      assertTrue('named sqlite_autoindex_*', businessIndexes[0].name.startsWith('sqlite_autoindex_'), businessIndexes[0].name);

      // AND THE FALLBACK IS A FLOOR ON HONESTY: it must over-charge every table in the repository
      // except the one that is recorded and therefore never falls back to it.
      assertTrue(
        'the default over-charges every table except audit_event, which is declared',
        DEFAULT_ROW_WRITES_PER_STATEMENT >= schemaRowWriteCost(world, 'customer') &&
          DEFAULT_ROW_WRITES_PER_STATEMENT >= schemaRowWriteCost(world, 'denial_summary') &&
          DEFAULT_ROW_WRITES_PER_STATEMENT >= schemaRowWriteCost(world, 'business'),
        `default ${DEFAULT_ROW_WRITES_PER_STATEMENT} under-charges a table in this repository`,
      );
    } finally {
      world.close();
    }
  });

  suite.test("THE REVIEW OBLIGATION, MECHANISED — each mutating Action's declaration covers the row-writes it ACTUALLY performs, measured from the statements it emitted", async () => {
    // The strongest form available: run each Action successfully, look at the statements that
    // actually reached the engine, price them against the LIVE schema, and compare with what the
    // Action reserved. This binds the declaration to the behaviour rather than to a comment, and
    // it catches both halves of what `write-cost.ts` says cannot be caught — a wrong statement
    // count and a wrong index count.
    const cases: readonly [string, unknown][] = [
      ['create', { business_id: BIZ_A_NORTH, display_name: 'Cost Probe', customer_type: 'company' }],
      ['update', { customer_id: CUST_A_ANNA, country: 'BH' }],
      ['archive', { customer_id: CUST_A_ANNA }],
      ['restore', { customer_id: CUST_A_ARCHIVED }],
      ['move', { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH }],
    ];
    for (const [name, input] of cases) {
      const world = await makeWorld();
      try {
        const requested: number[] = [];
        const dependencies = {
          ...world.dependencies,
          coordinator: withWriteRequestRecorder(world.dependencies.coordinator, requested),
        };
        // The world's own `invoke` uses `world.dependencies`; this case needs the recorder, so
        // it drives the pipeline directly with the same Action objects.
        const before = world.harness.statements.length;
        const action = (world.actions as unknown as Record<string, never>)[name];
        expectOk(
          `control: ${name} succeeds, so there are real statements to price`,
          await invokeAction(
            dependencies,
            asAnyAction(action),
            { principal: world.ownerA, app: world.app, requestId: `req_cost_${name}`, correlationId: `cor_cost_${name}` },
            input,
          ),
        );
        assertEqual(`${name} reserved exactly once`, requested.length, 1);
        assertEqual(
          `${name}: the declaration covers the true cost of the statements it emitted`,
          requested[0],
          observedRowWriteCost(world, before),
        );
        assertEqual(
          `${name}: and that cost is EIGHT — three for the customer row and its indexes, five for the audit row and its four`,
          requested[0],
          8,
        );
        assertEqual(
          `${name}: which is what estimatedRowWriteCost computes from the Action's declaration`,
          estimatedRowWriteCost(action, AUDIT_EVENT_ROW_WRITES),
          8,
        );
      } finally {
        world.close();
      }
    }
  });

  suite.test('§A.7 / §A.8 — the implementation and the corrected ADR agree: 8 row-writes per create, 1,250 creates/day', () => {
    // ===========================================================================================
    // THIS CASE WAS A DISCREPANCY REPORT. IT IS NOW AN AGREEMENT CHECK, AND THAT IS THE POINT.
    // ===========================================================================================
    //
    // Until 2026-09-03 the ADR said a Customer create cost TWO units and implied 5,000
    // creates/day, while the implementation charged EIGHT and permitted 1,250. This case
    // asserted the implementation and NAMED the ADR's figures, so the disagreement could not be
    // forgotten. Its own failure message carried the instruction for this moment: *"if the ADR
    // was corrected to 8 this case must be updated"*. It was corrected, so it is.
    //
    // §A.7 now reads: "A Customer create costs EIGHT estimated row-writes — corrected 2026-09-03
    // from the two this record originally stated." §A.8 now reads: "at most 1,250 customers per
    // UTC day — corrected from 5,000."
    //
    // WHY THE ARITHMETIC IS KEPT RATHER THAN THE CASE DELETED. The derivation below is what
    // caught the original four-times understatement, and deleting it would discard the only
    // executable copy of it. D1 bills an index row per indexed column touched, so `customer` is
    // 1 table + 1 PK index + 1 explicit index = 3, and `audit_event` is 1 table + 1 PK index +
    // 3 explicit indexes = 5. Charging 2 where D1 bills 8 would leave the 80,000 ceiling
    // permitting ~320,000 real row-writes against an enforced 100,000 — the outage `0014` exists
    // to prevent, with a budget in front of it reporting that everything is fine.
    //
    // IT NOW FAILS IN BOTH DIRECTIONS, which the discrepancy form could not do: if the code
    // drifts off 8, or if the ADR is edited back toward 2, this case goes red. Pinning only the
    // implementation would let the record drift away again unnoticed.
    const ADR_A7_UNITS_PER_CREATE = 8;
    const ADR_A8_CUSTOMERS_PER_DAY = 1_250;
    const implementedUnitsPerCreate = CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE + AUDIT_EVENT_ROW_WRITES;

    assertEqual('the customer row and its indexes cost 3', CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE, 3);
    assertEqual('the audit row and its indexes cost 5', AUDIT_EVENT_ROW_WRITES, 5);
    assertEqual('the implemented cost of one create', implementedUnitsPerCreate, 8);
    assertEqual(
      'which is what ADR §A.7 records after the 2026-09-03 correction',
      implementedUnitsPerCreate,
      ADR_A7_UNITS_PER_CREATE,
    );
    assertEqual(
      'the per-Organization daily ceiling therefore permits 1,250 creates',
      Math.floor(PER_ORGANIZATION_DAILY_ROW_WRITES / implementedUnitsPerCreate),
      ADR_A8_CUSTOMERS_PER_DAY,
    );
    // AND THE CONTEXT TABLE'S FIGURE MOVES WITH IT, in the direction that strengthens the case
    // for the decision rather than weakening it.
    const permittedRequestsPerDay = 60 * 60 * 24;
    assertEqual('the actor rate limit permits 86,400 requests/day', permittedRequestsPerDay, 86_400);
    assertEqual(
      'which at the implemented cost is 691,200 row-writes — 6.9x the enforced allowance, not the ADR\'s 1.73x',
      permittedRequestsPerDay * implementedUnitsPerCreate,
      691_200,
    );
  });

  // =========================================================================================
  // §A.11 — the reservation is structural. Four refusals, and a positive control.
  // =========================================================================================

  suite.test('§A.11 — a FORGED reservation is refused and nothing commits', async () => {
    const world = await makeWorld({ coordinatorMode: 'forged-reservation' });
    try {
      // Tested the way `actorBusinessIds` provenance was: a hand-built object with exactly the
      // right fields must be refused, so the refusal is of PROVENANCE and not of shape.
      expectError(
        'the mutation fails rather than committing unaccounted rows',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        { code: 'internal', message: 'The request could not be completed.' },
      );
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('THE ROW DID NOT CHANGE', row?.status, 'active');
      assertEqual('and no audit record claims it did', world.auditRows().length, 0);

      // Directly at the guard, so the refusal is attributable rather than inferred from a 500.
      let thrown: unknown = null;
      try {
        consumeWriteReservation(
          { organizationId: ORG_A, allocation: 'business', estimatedRowWrites: 8, dayStartMs: 0 } as never,
          ORG_A,
          1,
        );
      } catch (cause) {
        thrown = cause;
      }
      assertTrue('the guard names the reason', thrown instanceof WriteNotAdmittedError, `got ${String(thrown)}`);
      assertTrue(
        'and says the value did not come from the constructor',
        String((thrown as Error).message).includes('did not come from mintWriteReservation'),
        String((thrown as Error).message),
      );
    } finally {
      world.close();
    }
  });

  suite.test('§A.11 — a reservation is SINGLE-USE: the same receipt cannot fund a second batch', async () => {
    const world = await makeWorld({ coordinatorMode: 'reused-reservation' });
    try {
      expectOk('the first mutation commits', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectError(
        'and the second, handed the SAME receipt, is refused',
        await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ANNA }),
        { code: 'internal', message: 'The request could not be completed.' },
      );
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the second mutation did not happen', row?.status, 'archived');
      assertEqual('and wrote no audit record', world.auditRows().length, 1);

      // Directly at the guard. Without single use, one receipt for eight row-writes could fund an
      // unbounded loop of batches and the budget would be a formality.
      const reservation = mintWriteReservation({ organizationId: ORG_A, allocation: 'business', estimatedRowWrites: 8, dayStartMs: 0 });
      consumeWriteReservation(reservation, ORG_A, 1);
      let thrown: unknown = null;
      try {
        consumeWriteReservation(reservation, ORG_A, 1);
      } catch (cause) {
        thrown = cause;
      }
      assertTrue('the second use is refused', thrown instanceof WriteNotAdmittedError, `got ${String(thrown)}`);
      assertTrue(
        'and says so',
        String((thrown as Error).message).includes('already been spent'),
        String((thrown as Error).message),
      );
    } finally {
      world.close();
    }
  });

  suite.test("§A.11 — another Organization's reservation cannot fund this Organization's write", async () => {
    const world = await makeWorld({ coordinatorMode: 'foreign-reservation' });
    try {
      // A handle mix-up must not become a cross-tenant charge OR a cross-tenant row. This is the
      // reservation's own tenant pin, independent of the storage predicate — a second door on the
      // same property, which is why it is worth its own case.
      expectError(
        `${ISOLATION} the mutation is refused rather than charged to Organization B`,
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        { code: 'internal', message: 'The request could not be completed.' },
      );
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual(`${ISOLATION} Organization A's row is unchanged`, row?.status, 'active');
      assertEqual(`${ISOLATION} and nothing was written in Organization B either`, world.customerRows(ORG_B).length, 2);

      let thrown: unknown = null;
      try {
        consumeWriteReservation(
          mintWriteReservation({ organizationId: ORG_B, allocation: 'business', estimatedRowWrites: 8, dayStartMs: 0 }),
          ORG_A,
          1,
        );
      } catch (cause) {
        thrown = cause;
      }
      assertTrue('the guard refuses it', thrown instanceof WriteNotAdmittedError, `got ${String(thrown)}`);
      assertTrue(
        'naming the tenant mismatch',
        String((thrown as Error).message).includes('different Organization'),
        String((thrown as Error).message),
      );
    } finally {
      world.close();
    }
  });

  suite.test('§A.11 — a batch with MORE STATEMENTS than row-writes reserved is refused, which is the backstop below every caller', async () => {
    const world = await makeWorld({ coordinatorMode: 'undersized-reservation' });
    try {
      // Every statement writes at least one row, so more statements than row-writes reserved is
      // provably under-reserved. It is checked at the ADAPTER, below every caller, so it catches
      // any writer and not only an Action that mis-declared.
      expectError(
        'a two-statement batch funded by a one-row-write reservation is refused',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        { code: 'internal', message: 'The request could not be completed.' },
      );
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('nothing committed', row?.status, 'active');

      let thrown: unknown = null;
      try {
        consumeWriteReservation(
          mintWriteReservation({ organizationId: ORG_A, allocation: 'business', estimatedRowWrites: 1, dayStartMs: 0 }),
          ORG_A,
          2,
        );
      } catch (cause) {
        thrown = cause;
      }
      assertTrue('the guard refuses it', thrown instanceof WriteNotAdmittedError, `got ${String(thrown)}`);
      assertTrue(
        'naming the arithmetic',
        String((thrown as Error).message).includes('every statement'),
        String((thrown as Error).message),
      );
    } finally {
      world.close();
    }
  });

  suite.test('§A.11 — POSITIVE CONTROL: a valid, unspent, correctly-sized reservation for the right Organization is accepted, so the four refusals are of provenance and not of everything', async () => {
    const world = await makeWorld();
    try {
      // Without this the four cases above would pass against an implementation that refused every
      // write, which is the failure mode this whole suite is built against.
      const reservation = mintWriteReservation({ organizationId: ORG_A, allocation: 'business', estimatedRowWrites: 8, dayStartMs: 0 });
      consumeWriteReservation(reservation, ORG_A, 2);
      expectOk('and a real mutation through the pipeline commits', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the row really changed', row?.status, 'archived');
      assertEqual('and its audit record was written in the same transaction', world.auditRows().length, 1);

      // AND THE GUARD RUNS EVEN ON AN EMPTY BATCH, deliberately: a caller presenting a bad
      // reservation is a defect whether or not it happened to bring statements, and letting the
      // empty case through would leave one path the guard does not cover.
      const store = await world.storeFor(ORG_A);
      let thrown: unknown = null;
      try {
        await store.write([], { organizationId: ORG_A, allocation: 'business', estimatedRowWrites: 8, dayStartMs: 0 } as never);
      } catch (cause) {
        thrown = cause;
      }
      assertTrue('an empty batch with a forged reservation is still refused', thrown instanceof WriteNotAdmittedError, `got ${String(thrown)}`);
    } finally {
      world.close();
    }
  });

  suite.test('§A.11 — the admission cannot be skipped: an unreachable budget commits nothing, and neither does a throwing one', async () => {
    for (const mode of ['write-rejects', 'write-throws'] as const) {
      const world = await makeWorld({ coordinatorMode: mode });
      try {
        expectError(
          `with the budget ${mode}, the mutation is refused`,
          await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
          EXPECTED_UNAVAILABLE,
        );
        const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
        assertEqual('and nothing committed', row?.status, 'active');
        assertEqual('nor any audit record', world.auditRows().length, 0);
        // READS ARE UNAFFECTED, because `select` takes no reservation and consults no budget in
        // any state. A blanket read failure is not reachable from here.
        expectOk('a read still serves', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      } finally {
        world.close();
      }
    }
  });

  suite.test('§A.12 — the reservation is the ACTION\'S DECLARED WORST CASE, not the statement count, and a handler cannot make itself cheaper', async () => {
    const world = await makeWorld();
    try {
      const requested: number[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withWriteRequestRecorder(world.dependencies.coordinator, requested),
      };
      expectOk(
        'a create commits',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.create),
          { principal: world.ownerA, app: world.app, requestId: 'req_cost', correlationId: 'cor_cost' },
          { business_id: BIZ_A_NORTH, display_name: 'Worst Case Probe', customer_type: 'company' },
        ),
      );
      assertEqual('it reserved the declared worst case', requested[0], 8);
      // The batch is TWO statements and the charge is EIGHT. Charging `writes.length` would have
      // charged two — the ADR's number — and under-reserved by a factor of four.
      const writeStatements = world.harness.statements.filter((entry) => writtenTable(entry.sql) !== null);
      assertEqual('while the batch was two statements', writeStatements.length, 2);
      assertTrue(
        'so the charge is NOT the statement count',
        requested[0] !== writeStatements.length,
        'the reservation is being charged per statement, which under-counts index rows',
      );
    } finally {
      world.close();
    }
  });

  suite.test('§A.12 — a reservation is NOT REFUNDED when the write it paid for does not happen', async () => {
    const world = await makeWorld();
    try {
      // "Uncertain or partially consumed reservations are not refunded." Asserted the only way
      // that can be asserted from outside: spend, fail, and show the counter did not go back.
      // Forced with a CHECK-constraint violation, so the commit fails after the charge.
      const requested: number[] = [];
      const dependencies = {
        ...world.dependencies,
        coordinator: withWriteRequestRecorder(world.dependencies.coordinator, requested),
      };
      expectOk(
        'a first mutation commits and is charged',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.archive),
          { principal: world.ownerA, app: world.app, requestId: 'req_r1', correlationId: 'cor_r1' },
          { customer_id: CUST_A_ANNA },
        ),
      );
      const spentAfterFirst = world.budget.usedToday('business');
      assertTrue('the business allocation was drawn on', spentAfterFirst > 0, 'nothing was charged for a committed mutation');

      // A second mutation that the state precondition refuses NEVER reaches the budget, which is
      // the deliberate ordering: reserving at admission would let refusals spend a tenant's day.
      expectError(
        'a refused transition',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        { code: 'failed_precondition', message: 'The resource is not in a state that permits this operation.' },
      );
      assertEqual('and it cost the daily budget nothing', world.budget.usedToday('business'), spentAfterFirst);
      assertEqual('the pipeline did not even ask', requested.length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('§A.10 — a REFUSED request never spends the daily budget, so a low-privilege credential cannot burn its Organization\'s capacity on denials', async () => {
    const world = await makeWorld();
    try {
      // The reason admission sits at the commit rather than at stage 5 with the rate limiter. At
      // 10,000 row-writes a day, a caller holding one low-privilege credential that charged on
      // every attempt could spend its whole Organization's capacity on refusals in minutes —
      // a denial-of-service lever built out of the control meant to prevent one.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expectError(`forbidden ${attempt + 1}`, await world.invoke(world.actions.archive, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      }
      expectError(`${ISOLATION} a cross-tenant probe`, await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('and a malformed identifier', await world.invoke(world.actions.archive, world.ownerA, { customer_id: 'not a valid identifier' }), {
        code: 'invalid_argument',
        message: 'The request is not valid.',
        details: [{ field: 'customer_id', issue: 'invalid_identifier' }],
      });
      assertEqual('twenty-two refusals cost the BUSINESS allocation nothing', world.budget.usedToday('business'), 0);
      // They are not free, though, and the suite says where they went: the denial evidence they
      // produced is charged to `security`, which is exactly the split 0014 §A.5 exists to make.
      assertTrue('their evidence was charged to security instead', world.budget.usedToday('security') > 0, 'no denial evidence was recorded at all');
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // §A.10 — exhaustion: 429 with a retry time, and READS REMAIN AVAILABLE
  // =========================================================================================

  suite.test('§A.10 — BOTH HALVES IN ONE CASE: at exhaustion a mutation returns 429 with a Retry-After after the next UTC reset, AND reads remain available', async () => {
    // ===========================================================================================
    // ASSERTED TOGETHER ON PURPOSE. A case that proved the refusal without proving reads still
    // serve would certify the platform-wide denial-of-service lever 0013 and 0014 both exist to
    // prevent: "the budget ran out, so nothing works" is the failure mode, not the feature.
    // ===========================================================================================
    //
    // Driven over HTTP, because §A.10 is a statement about a STATUS CODE and a HEADER, and
    // neither exists below the transport. The budget is exhausted for real by lowering the
    // business allocation to less than one create — the ledger, not a stub, produces the
    // `deferred`.
    const world = await makeWorld({ dailyCeilings: { business: 4 } });
    try {
      const dependencies = apiFor(world);
      const router = createRouter(createCustomerRoutes({ businesses: world.businesses }));

      const mutation = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url(`/customers/${CUST_A_ANNA}`), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // A value the fixture does NOT already hold, so "unchanged" is a real observation.
          // The seeded country is BH; asking for GB makes the refusal falsifiable.
          body: JSON.stringify({ country: 'GB' }),
        }),
        { sourceAddressHash: null },
      );
      // WHY THE STATUS MAY BE 503 RATHER THAN 429 ON THIS ACTION, and it is a contract gap
      // core-agent reported rather than a choice: §A.10 says 429, which is `quota_exceeded`, and
      // `customer-directory-v1` declares that code on CreateCustomer ONLY. `constrainToDeclaredErrors`
      // would turn it into a 500 on the other four, so they answer `unavailable` (503) instead —
      // the same underlying fact, a code they do declare. The create path below asserts the 429
      // the ADR actually requires.
      assertTrue(
        'the mutation is refused, not silently accepted',
        mutation.status === 429 || mutation.status === 503,
        `status ${String(mutation.status)}`,
      );
      const unchanged = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('and it did not happen — the seeded country is untouched', unchanged?.country, 'BH');
      assertEqual('nor was an audit record written for a mutation that did not occur', world.auditRows().length, 0);

      const create = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url('/customers'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ business_id: BIZ_A_NORTH, display_name: 'Refused By Budget', customer_type: 'company' }),
        }),
        { sourceAddressHash: null },
      );
      assertEqual('CreateCustomer, which declares quota_exceeded, answers 429', create.status, 429);
      const body = (await create.json()) as { error: { code: string } };
      assertEqual('with the quota code', body.error.code, 'quota_exceeded');
      const retryAfter = create.headers.get('Retry-After');
      assertTrue('and a Retry-After header', retryAfter !== null, 'no Retry-After on a 429');
      assertEqual(
        'whose value is the seconds to the next 00:00 UTC — a retry time AFTER the reset, per §A.10',
        Number(retryAfter),
        retryAfterSecondsUntilReset(world.clock.nowMs()),
      );
      assertTrue(
        'which really is after the next reset and at least one second',
        Number(retryAfter) >= 1 && world.clock.nowMs() + Number(retryAfter) * 1000 >= nextUtcResetMs(world.clock.nowMs()),
        `Retry-After ${String(retryAfter)} does not reach the next UTC reset`,
      );
      assertEqual('no customer was created', world.customerRows(ORG_A).filter((row) => row.display_name === 'Refused By Budget').length, 0);

      // ---- THE OTHER HALF. READS REMAIN AVAILABLE, and this is the assertion that stops the
      // refusal above from being certified as acceptable on its own.
      const read = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url(`/customers/${CUST_A_ANNA}`), { method: 'GET' }),
        { sourceAddressHash: null },
      );
      assertEqual('a single read is served', read.status, 200);
      const list = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url('/customers'), { method: 'GET' }),
        { sourceAddressHash: null },
      );
      assertEqual('a listing is served', list.status, 200);
      const search = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url('/customers/search?query=anna'), { method: 'GET' }),
        { sourceAddressHash: null },
      );
      assertEqual('and a search is served', search.status, 200);
      assertTrue(
        'reads never consulted the budget at all — `select` takes no reservation',
        world.budget.usedToday('business') <= 4,
        `the business allocation moved to ${String(world.budget.usedToday('business'))} while only reads ran`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('§A.10 — THE 429 IS NOT AN ORACLE: the answer is identical whether this Organization hit its own ceiling or the platform allocation ran out', async () => {
    // The refusal states something about the CALLER'S OWN Organization's budget. If the two
    // exhaustion causes were distinguishable — a different code, a different message, a different
    // retry time — a caller could learn that other tenants exist and are busy, which is a
    // statement about somebody else's activity.
    //
    // BOTH CAUSES ARE PRODUCED FOR REAL. The platform cause lowers the shared business
    // allocation; the per-Organization cause leaves the allocation ample and exhausts the
    // Organization's own 10,000 by lowering nothing and spending through the coordinator.
    async function refusalUnder(options: WorldOptions): Promise<{ body: string; retryAfter: string | null; status: number }> {
      const world = await makeWorld(options);
      try {
        const dependencies = apiFor(world);
        const router = createRouter(createCustomerRoutes({ businesses: world.businesses }));
        const response = await handleRequest(
          dependencies,
          router,
          world.app,
          CUSTOMERS_BASE_PATH,
          new Request(url('/customers'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ business_id: BIZ_A_NORTH, display_name: 'Oracle Probe', customer_type: 'company' }),
          }),
          { sourceAddressHash: null },
        );
        const raw = (await response.json()) as { error: unknown; request_id?: unknown; correlation_id?: unknown };
        // `request_id` and `correlation_id` are legitimately per-request; everything else must
        // match. Same normalisation the wire-level indistinguishability cases use.
        return {
          body: JSON.stringify({ ...raw, request_id: null, correlation_id: null }),
          retryAfter: response.headers.get('Retry-After'),
          status: response.status,
        };
      } finally {
        world.close();
      }
    }

    // Cause 1: the PLATFORM business allocation is spent (something else on the platform used it).
    const platform = await refusalUnder({ dailyCeilings: { business: 4 } });
    // Cause 2: this Organization's own ceiling is what binds. Reproduced by making the
    // per-Organization ceiling the binding one — the coordinator refuses before the ledger is
    // even asked, which is the other branch of `admitWrite`.
    const organization = await refusalUnder({ coordinatorMode: 'write-exhausted' });

    assertEqual('both are refused', `${String(platform.status)}|${String(organization.status)}`, '429|429');
    assertEqual(
      `${ISOLATION} and the two responses are byte-identical`,
      platform.body,
      organization.body,
    );
    assertEqual(
      `${ISOLATION} including the Retry-After, which is a pure function of the clock`,
      platform.retryAfter,
      organization.retryAfter,
    );
    assertTrue(
      `${ISOLATION} and neither names another Organization, a count, or a budget`,
      !platform.body.includes(ORG_B) && !platform.body.includes('80000') && !platform.body.includes('10000'),
      `the refusal disclosed budget state: ${platform.body}`,
    );
    assertEqual(
      'the message says only that the quota is exhausted',
      JSON.parse(platform.body).error.code,
      'quota_exceeded',
    );
  });

  // =========================================================================================
  // THE TWO CEILING BEHAVIOURS, SIDE BY SIDE
  // =========================================================================================

  suite.test('THE TWO CEILINGS BEHAVE DIFFERENTLY ON PURPOSE, AND BOTH ARE RIGHT — asserted side by side so neither is "harmonised" into the other later', async () => {
    // ===========================================================================================
    // AT 0013's SECURITY CEILING: writes stop, counting continues, the caller's answer is
    // UNCHANGED. Refusing a request because its EVIDENCE could not be stored would let an
    // attacker burn the evidence budget and thereby refuse everyone — a second denial-of-service
    // lever, which is the exact mistake 0013 was written to correct.
    //
    // AT 0014's BUSINESS CEILING: the mutation is REFUSED, with a 429 and a retry time. There is
    // no silent continuation available, because the write IS the request's purpose and accepting
    // a create without performing it is data loss reported as success.
    //
    // THE DIFFERENCE IS WHICH SIDE OF THE DECISION THE WRITE SITS ON. Harmonising them in either
    // direction reintroduces a vulnerability a user decision was written to close, so both are
    // asserted in ONE case where a future editor cannot change one without seeing the other.
    // ===========================================================================================
    // THE COMPARISON IS AGAINST A WORLD WITH NO CEILING REACHED, which is what makes each half
    // an observation rather than a restatement. A probe's answer must be the SAME as it is with
    // the ceiling untouched; a create's answer must be DIFFERENT. Asserting only the two answers
    // in the exhausted world would prove neither, because a `not_found` and a `quota_exceeded`
    // differ for reasons that have nothing to do with either ceiling.
    const healthy = await makeWorld();
    // `Result<unknown>` RATHER THAN `unknown`, since 2026-09-05. `World.invoke` returns a result
    // and `expectOk`/`expectError` need to see that; declaring the variable as `unknown` threw
    // the shape away between the call and the assertion.
    let healthyProbe: Result<unknown>;
    let healthyCreate: Result<unknown>;
    try {
      healthyProbe = await healthy.invoke(healthy.actions.get, healthy.ownerA, { customer_id: CUST_B_ANNA });
      healthyCreate = await healthy.invoke(healthy.actions.create, healthy.ownerA, {
        business_id: BIZ_A_NORTH,
        display_name: 'Both Ceilings',
        customer_type: 'company',
      });
      expectError(`${ISOLATION} control: with no ceiling reached the probe is not_found`, healthyProbe, EXPECTED_NOT_FOUND);
      expectOk('control: with no ceiling reached the create succeeds', healthyCreate);
      assertEqual('and its evidence was written', healthy.denialSummaryRows().length, 1);
    } finally {
      healthy.close();
    }

    const world = await makeWorld({ dailyCeilings: { security: 0, business: 4 } });
    try {
      // ---- 0013's ceiling: the SECURITY allocation is spent. The caller cannot tell.
      const denial = await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA });
      expectError(
        `${ISOLATION} at the SECURITY ceiling the caller's answer is the unchanged not_found`,
        denial,
        EXPECTED_NOT_FOUND,
      );
      assertEqual('while NO evidence was written — the ceiling did engage', world.denialSummaryRows().length, 0);
      assertEqual(
        `${ISOLATION} and the answer is byte-identical to the same probe in a world with capacity to spare`,
        JSON.stringify(denial),
        JSON.stringify(healthyProbe),
      );

      // ---- 0014's ceiling: the BUSINESS allocation is spent. A mutation IS refused.
      const create = await world.invoke(world.actions.create, world.ownerA, {
        business_id: BIZ_A_NORTH,
        display_name: 'Both Ceilings',
        customer_type: 'company',
      });
      expectError(
        'at the BUSINESS ceiling the caller IS refused, because the write is the request',
        create,
        EXPECTED_QUOTA_EXCEEDED,
      );
      assertEqual('and nothing was created', world.customerRows(ORG_A).filter((row) => row.display_name === 'Both Ceilings').length, 0);
      assertTrue(
        'the answer DIFFERS from the same create in a world with capacity to spare',
        JSON.stringify(create) !== JSON.stringify(healthyCreate),
        'the business ceiling was invisible to the caller, which is 0013\'s behaviour and would be data loss reported as success here',
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // The cost declaration itself
  // =========================================================================================

  suite.test('§A.12 — a read declares zero, reserves nothing, and is therefore unaffected by any budget state', async () => {
    const world = await makeWorld({ dailyCeilings: { business: 0 } });
    try {
      assertEqual('GetCustomer declares zero', estimatedRowWriteCost(world.actions.get as never, AUDIT_EVENT_ROW_WRITES), 0);
      assertEqual('ListCustomers declares zero', estimatedRowWriteCost(world.actions.list as never, AUDIT_EVENT_ROW_WRITES), 0);
      assertEqual('SearchCustomers declares zero', estimatedRowWriteCost(world.actions.search as never, AUDIT_EVENT_ROW_WRITES), 0);
      // With the business allocation at ZERO, every read still serves — the strongest form of
      // §A.10's "reads remain available", because there is no capacity at all.
      expectOk('a read with a completely empty business allocation', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectOk('a listing', await world.invoke(world.actions.list, world.ownerA, {}));
      expectOk('and a search', await world.invoke(world.actions.search, world.ownerA, { query: 'anna' }));
      assertEqual('and none of them charged anything', world.budget.usedToday('business'), 0);
    } finally {
      world.close();
    }
  });

  suite.test('§A.12 — a malformed cost declaration is refused at invocation, like a broken audit policy', async () => {
    const world = await makeWorld();
    try {
      for (const declared of [-1, 1.5, Number.NaN]) {
        let thrown: unknown = null;
        try {
          assertWriteCostPolicy({ id: 'qa.BadCost', audit: false, maxRowWrites: declared });
        } catch (cause) {
          thrown = cause;
        }
        assertTrue(`maxRowWrites: ${String(declared)} is refused`, thrown instanceof WriteCostPolicyError, `got ${String(thrown)}`);
      }
      // A well-formed one is accepted, so the refusals above are of the VALUE and not of the field.
      assertWriteCostPolicy({ id: 'qa.GoodCost', audit: true, maxRowWrites: 3 });
      // And every shipped Action satisfies it.
      for (const action of Object.values(world.actions)) {
        assertWriteCostPolicy(action as never);
      }
    } finally {
      world.close();
    }
  });

  suite.test('GAP, ASSERTED SO IT IS VISIBLE — an AUDITED Action that declares maxRowWrites: 0 fails at the commit rather than at construction', async () => {
    // ===========================================================================================
    // FAIL-CLOSED, AND THEREFORE SAFE. But detected LATER than it could be, and that is the gap.
    // ===========================================================================================
    //
    // `estimatedRowWriteCost` short-circuits on `declared === 0` and returns 0 without adding the
    // audit row. An Action with `audit: true, maxRowWrites: 0` therefore reserves nothing while
    // the pipeline appends an audit row to its batch — and the pipeline catches that at the
    // commit, refuses, and writes nothing. Nothing unaccounted reaches D1, which is the direction
    // that matters.
    //
    // WHAT IS OWED: `assertAuditPolicy` refuses an incoherent audit policy AT CONSTRUCTION, and
    // this shape is equally statically detectable — an audited Action that declares zero writes
    // can never succeed. `assertWriteCostPolicy` could refuse it in the same place, and until it
    // does, the defect surfaces as a 500 on the first successful-path invocation instead of at
    // wiring time. Reported to the Team Lead for core-agent.
    //
    // This case asserts BOTH the safe behaviour and the missing guard, so that adding the guard
    // is a visible test change rather than a silent one.
    const world = await makeWorld();
    try {
      const auditedButFree: ActionDefinition<unknown, unknown> = {
        id: 'qa.AuditedButFree',
        appId: 'customers',
        title: 'Audited but free',
        description: 'An audited Action that declares it writes nothing. Verification only.',
        errors: ['internal', 'forbidden', 'not_found'],
        permission: 'customers.customer.read',
        scope: 'business',
        sensitivity: 'read',
        idempotent: false,
        audit: true,
        maxRowWrites: 0,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle() {
          return ok({ output: null, writes: [], audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] } });
        },
      };

      assertEqual('it prices itself at zero even though it is audited', estimatedRowWriteCost(auditedButFree, AUDIT_EVENT_ROW_WRITES), 0);
      // THE GAP: the construction-time guard does NOT refuse it.
      assertWriteCostPolicy(auditedButFree);
      // THE SAFE BEHAVIOUR: it cannot write anyway.
      expectError(
        'the invocation fails closed at the commit',
        await world.invoke(asAnyAction(auditedButFree), world.ownerA, {}),
        { code: 'internal', message: 'The request could not be completed.' },
      );
      assertEqual('and no unaccounted audit row reached D1', world.auditRows().length, 0);
      assertEqual('nor was the budget charged', world.budget.usedToday('business'), 0);
    } finally {
      world.close();
    }
  });

  suite.test('§A.5 — a MUTATION cannot spend the security allocation, and denial evidence cannot spend the business one', async () => {
    const world = await makeWorld();
    try {
      // Structural, not policy: `reserveWrites` has no allocation parameter, so an Action cannot
      // name one however it is written. The security allocation is reachable only through
      // `recordDenial`, which runs after a refusal and cannot be reached on a success.
      expectOk('a successful mutation', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      // ===========================================================================================
      // THE LEDGER RECORDS THE BLOCK PURCHASE, NOT THE SPEND, AND THE DIFFERENCE IS REAL CAPACITY.
      // ===========================================================================================
      //
      // Permits are bought from the shared ledger in blocks of `WRITE_PERMIT_BLOCK` so that the
      // ledger is consulted once per block rather than once per mutation — every consultation is
      // a Durable Object round trip against an allowance that is itself exhaustible. The
      // consequence, which core-agent states and this case pins: an Organization that buys a
      // block and then goes quiet HOLDS up to `WRITE_PERMIT_BLOCK - 1` row-writes of the shared
      // allocation until the UTC reset, unspendable by anyone.
      //
      // Asserted rather than smoothed over, because a reader seeing 512 after an 8-row-write
      // mutation would otherwise reasonably conclude the accounting is broken.
      assertEqual('the ledger was drawn on for one BLOCK', world.budget.usedToday('business'), WRITE_PERMIT_BLOCK);
      assertEqual('and a block is 512 row-writes — sixty-four creates at eight each', WRITE_PERMIT_BLOCK, 512);
      assertTrue(
        'the worst-case stranding across six Organizations stays a small share of the allocation',
        ((WRITE_PERMIT_BLOCK - 1) * (DAILY_ALLOCATION.business / PER_ORGANIZATION_DAILY_ROW_WRITES)) / DAILY_ALLOCATION.business < 0.06,
        'block purchasing can strand a meaningful share of the business allocation',
      );
      assertEqual('and the security allocation was not touched by a MUTATION', world.budget.usedToday('security'), 0);
      assertEqual('nor the system allocation', world.budget.usedToday('system'), 0);

      // A SECOND MUTATION SPENDS FROM THE BLOCK ALREADY HELD, so the ledger does not move. That
      // is what makes the block a saving rather than an overcharge.
      expectOk('a second mutation', await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('the ledger is unchanged — the block is being spent locally', world.budget.usedToday('business'), WRITE_PERMIT_BLOCK);

      expectError(`${ISOLATION} a denied probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      assertTrue('charged the security allocation', world.budget.usedToday('security') > 0, 'the denial evidence was not charged at all');
      assertEqual('and left the business allocation exactly where the mutations left it', world.budget.usedToday('business'), WRITE_PERMIT_BLOCK);
      assertEqual(
        'the security draw is a whole number of summaries at their true row-write cost',
        world.budget.usedToday('security') % DENIAL_SUMMARY_ROW_WRITES,
        0,
      );
      // NOTHING SPENDS `system` TODAY, and that is declared rather than discovered: it is
      // reserved so the first system writer draws from it rather than from the product's.
      assertEqual('nothing in this repository spends the system allocation', world.budget.usedToday('system'), 0);
    } finally {
      world.close();
    }
  });

  return suite;
}
