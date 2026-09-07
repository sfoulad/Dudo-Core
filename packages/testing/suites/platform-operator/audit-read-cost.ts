/**
 * ===========================================================================================
 * THE AUDIT FEEDS' ACCESS PATH. `platform-audit-read-v1` `theMandatoryWindow` items 5 and 6.
 * ===========================================================================================
 *
 * *** EVERY OTHER TEST IN THIS SUITE PASSES IDENTICALLY AGAINST A FULL TABLE SCAN THAT RETURNS
 * THE RIGHT 25 ROWS. *** That is not a criticism of them — they assert the ANSWER, and the answer
 * is the same either way. It is the reason this file exists: **the defect `0016` was written for
 * produced correct responses.** A 50,000-row log served a perfect page of 25 and read all 50,000
 * rows to do it, and at D1's account-wide 5,000,000 rows/day that is roughly a hundred feed
 * requests before **every tenant's logins stop, in every database.**
 *
 * So the suite that was written after that finding **could not detect its regression**, and the
 * contract says so in as many words: *"THE ACCESS PATH IS ASSERTED, NOT THE ANSWER … ASSERT ROWS
 * READ, because every other test here passes identically against a full table scan."*
 *
 * ===========================================================================================
 * WHAT A PLAN CAN ESTABLISH, AND THE PART OF THE CONTRACT'S ITEM 5 IT CANNOT
 * ===========================================================================================
 *
 * `EXPLAIN QUERY PLAN` over the real schema with the real parameters answers ONE question
 * exactly: **does this query stop early, or must it visit every row before `LIMIT` applies.**
 *
 *   `SCAN t | USE TEMP B-TREE FOR ORDER BY`   materialises the whole table, then sorts, then
 *                                             limits. **The page size buys nothing.**
 *   `SCAN t USING INDEX i`                    walks the index in the feed's own order and stops
 *                                             when the page fills. **Bounded.**
 *
 * *** WHAT IT CANNOT ANSWER, STATED PLAINLY RATHER THAN GLOSSED. *** The contract's item 5 also
 * asks that *"a filtered windowed request reads at most the window's records."* **A plan cannot
 * show that**, and it is important not to imply otherwise: with the time index supplying only the
 * ORDER BY, a filtered walk tests each candidate row by row and continues until the page fills, so
 * its cost depends on how selective the filter is — which is data, not plan. `0016`'s own header
 * says this is the case it does NOT fix and that the WINDOW is the answer. **The window's bound is
 * arithmetic** — at most `operators × 300 × days` records, from the write ceiling — **and no
 * `EXPLAIN` can see it.**
 *
 * So this file asserts the half that is mechanically checkable and names the half that is not,
 * rather than reporting item 5 as closed.
 *
 * ===========================================================================================
 * ITEM 6 IS THE POINT: THE NEGATIVE CONTROL FOR `0016` ITSELF
 * ===========================================================================================
 *
 * *"THE CONSTRUCTED FAILING INPUT: remove the ordering index and the unfiltered feed's rows-read
 * assertion must go RED. It is the shape the window does not guard, it is exempt by design, and
 * nothing else in this suite would notice it regressing."*
 *
 * Both indexes are dropped from the fixture's in-memory database and the same requests are made
 * again. **If the assertions above do not turn red, they were never about the index** — they were
 * a property of a small fixture table, which reads exactly the same while it is small and stops
 * being true at the size where it matters.
 *
 * `0016` carries its own rollback path — `DROP INDEX platform_operator_action_by_time` and
 * `... _by_organization` — and says *"dropping them restores the read exposure this migration
 * exists to close."* This file executes that sentence.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import {
  ORG_ALPHA,
  ORG_BETA,
  PRN_ADMIN,
  PRN_MODERATOR,
  SESSION_ADMIN,
  createPlatformWorld,
  seedActionRow,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import { classifyStatements } from '../../capacity/reads.ts';
import type { OperationReads } from '../../capacity/reads.ts';

const TIME_INDEX = 'platform_operator_action_by_time';
const ORGANIZATION_INDEX = 'platform_operator_action_by_organization';
const ACTION_LOG = 'platform_operator_action';

/**
 * Enough rows that the planner is choosing between real alternatives.
 *
 * A HANDFUL OF ROWS IS NOT A WEAKER VERSION OF A LOG — IT IS A DIFFERENT INPUT TO THE PLANNER.
 * SQLite may pick a scan over an index on a tiny table because a scan genuinely is cheaper there,
 * and a fixture that measured that would report the production plan wrongly in both directions.
 * 400 rows across two Organizations and two operators is small enough to seed instantly and large
 * enough that walking the log is visibly not the cheap option.
 */
function seedLog(world: PlatformWorld, rows = 400): void {
  const day = 24 * 60 * 60 * 1000;
  const start = Date.UTC(2026, 7, 1);
  for (let index = 0; index < rows; index += 1) {
    seedActionRow(world.control, {
      actionRecordId: `par_${String(index).padStart(13, '0')}`,
      actorPrincipalId: index % 2 === 0 ? PRN_ADMIN : PRN_MODERATOR,
      actionId: index % 3 === 0 ? 'platform.organizations.list' : 'platform.templates.list',
      occurredAt: new Date(start + index * (day / 8)).toISOString(),
      targetOrganizationId: index % 5 === 0 ? ORG_ALPHA : ORG_BETA,
    });
  }
}

/** One request, with every SELECT it emitted classified by its plan. */
async function readsFor(
  world: PlatformWorld,
  label: string,
  routeId: 'platform.audit.list' | 'platform.organizations.audit.list',
  queryString: string,
): Promise<OperationReads> {
  const before = world.control.statements.length;
  expectOk(
    `${label}: the feed answers`,
    await world.call(routeId, {
      sessionId: SESSION_ADMIN,
      queryString,
      pathParams: routeId === 'platform.organizations.audit.list' ? { organization_id: ORG_ALPHA } : {},
    }),
  );
  return classifyStatements(label, world.control, before);
}

/** Every plan the request produced, for a failure message that can be acted on. */
function plans(reads: OperationReads): string {
  return reads.queries.map((query) => `${query.sql}  ==>  ${query.plan}`).join('\n           ');
}

/**
 * THE FLOOR, AND IT IS NOT DECORATION HERE.
 *
 * `classifyStatements` returns an empty list when a request emitted no SELECT it could plan — and
 * an empty list has NO SCANNED TABLES, so **every assertion below passes vacuously on a request
 * that queried nothing.** That is `workflow.md` §11a's empty-list reader exactly, and this check
 * is the only thing standing between it and a green run.
 */
function assertExamined(reads: OperationReads, label: string): void {
  assertTrue(
    `${label}: the request emitted SELECTs this classifier could plan`,
    reads.queries.length > 0,
    'no classifiable SELECT was recorded, so "no scanned tables" below means "nothing was ' +
      'examined" rather than "nothing scans". Check that the request reached the store at all',
  );
  assertTrue(
    `${label}: at least one of them touched the action log`,
    reads.queries.some((query) => query.plan.includes(ACTION_LOG)),
    `the recorded plans never mention ${ACTION_LOG}, so this case is measuring some other ` +
      `query's access path:\n           ${plans(reads)}`,
  );
}

export function buildAuditReadCostSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Audit feeds — the ACCESS PATH, which every other case is blind to');

  // =========================================================================================
  // THE ASSERTIONS `0016` EXISTS TO MAKE TRUE.
  // =========================================================================================

  suite.test('THE UNFILTERED PLATFORM FEED STOPS AFTER ONE PAGE — it does not sort the log', async () => {
    const world = await make();
    try {
      seedLog(world);
      const reads = await readsFor(world, 'unfiltered platform feed', 'platform.audit.list', 'page_size=25');
      assertExamined(reads, 'unfiltered platform feed');

      assertEqual(
        `${ISOLATION} no table is scanned end to end`,
        reads.scannedTables.join(' · '),
        '',
      );
      // AND THE MECHANISM BY NAME. "No scan" would also be satisfied by some future plan that is
      // bounded for an unrelated reason; the contract's argument rests on THIS index serving the
      // feed's compound ORDER BY, so the plan is asserted to name it.
      assertTrue(
        `the plan walks ${TIME_INDEX}`,
        reads.queries.some((query) => query.plan.includes(TIME_INDEX)),
        `the feed is bounded but not by the index 0016 added, so 0016's argument no longer ` +
          `describes this query:\n           ${plans(reads)}`,
      );
      assertTrue(
        'and nothing sorts into a temporary B-tree',
        !reads.queries.some((query) => query.temporarySort),
        'a plan that sorts must materialise every row before LIMIT applies, so the page size ' +
          `buys nothing. THIS IS THE DEFECT 0016 CLOSED:\n           ${plans(reads)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE ORGANIZATION FEED SEEKS INSIDE ONE ORGANIZATION — the new-customer case', async () => {
    // *** THE QUIET ORGANIZATION IS A NEW CUSTOMER, AND WITH THE TIME INDEX ALONE THEIR OWN FEED
    // WAS THE MOST EXPENSIVE QUERY ON THE PLATFORM *** — 49,993 rows against 9. It is the feed
    // `0028` built FOR the customer, so shipping one index would have fixed the operator's
    // convenience and left the customer's own view as the thing that takes the platform down.
    const world = await make();
    try {
      seedLog(world);
      const reads = await readsFor(
        world,
        'Organization feed',
        'platform.organizations.audit.list',
        'page_size=25',
      );
      assertExamined(reads, 'Organization feed');

      assertEqual(
        `${ISOLATION} no table is scanned end to end`,
        reads.scannedTables.join(' · '),
        '',
      );
      assertTrue(
        `the plan uses ${ORGANIZATION_INDEX}`,
        reads.queries.some((query) => query.plan.includes(ORGANIZATION_INDEX)),
        'the scoped feed is not using the Organization index, so the walk is not staying inside ' +
          `one Organization's entries:\n           ${plans(reads)}`,
      );
      assertTrue(
        'and nothing sorts into a temporary B-tree',
        !reads.queries.some((query) => query.temporarySort),
        `the scoped feed sorts, which is the 49,993-row shape:\n           ${plans(reads)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('a FILTERED WINDOWED request is index-ordered too — and here is what that does NOT prove', async () => {
    // ===================================================================================
    // *** THIS CASE IS DELIBERATELY WEAKER THAN THE CONTRACT'S ITEM 5, AND SAYS SO. ***
    // ===================================================================================
    //
    // The contract asks that a filtered windowed request "reads at most the window's records".
    // **A query plan cannot establish that.** The time index supplies the ORDER BY and not the
    // predicate, so the engine tests candidates row by row until the page fills — a cost that
    // depends on the filter's selectivity, which is data rather than plan. `0016`'s header names
    // this as the case it does not fix.
    //
    // WHAT IS ASSERTED: the request still stops early rather than materialising the log. WHAT IS
    // NOT: how many rows it walks before it does. That number is bounded by the WINDOW, whose
    // bound is arithmetic — at most `operators × 300 × days` from the per-principal write ceiling
    // — and asserting it here would be dressing an estimate as a measurement.
    const world = await make();
    try {
      seedLog(world);
      const reads = await readsFor(
        world,
        'filtered windowed feed',
        'platform.audit.list',
        `actor_principal_id=${PRN_ADMIN}&since=2026-08-01T00:00:00.000Z&until=2026-08-20T00:00:00.000Z`,
      );
      assertExamined(reads, 'filtered windowed feed');
      assertTrue(
        `${ISOLATION} it does not sort the log into a temporary B-tree`,
        !reads.queries.some((query) => query.temporarySort),
        `the filtered feed materialises and sorts, so neither the window nor the page size ` +
          `bounds it:\n           ${plans(reads)}`,
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // ITEM 6 — THE CONSTRUCTED FAILING INPUT. THE NEGATIVE CONTROL FOR `0016`.
  // =========================================================================================

  suite.test('*** DROP THE ORDERING INDEX AND BOTH ASSERTIONS GO RED — 0016 rolled back ***', async () => {
    // ===================================================================================
    // WITHOUT THIS, THE THREE CASES ABOVE ARE A PROPERTY OF A 400-ROW FIXTURE.
    // ===================================================================================
    //
    // A small table reads the same whether it is scanned or seeked, so the assertions above would
    // pass on a fixture whose index had silently stopped existing — and would keep passing right
    // up to the size at which the difference is the whole problem. **A negative control is the
    // only thing that distinguishes "the index is working" from "the table is small."**
    //
    // This executes `0016`'s own stated rollback and asserts the exposure comes back.
    const world = await make();
    try {
      seedLog(world);

      // ---- THE POSITIVE CONTROL FIRST, in this same world, so the difference below is the index
      // and not anything about how this case builds its fixture.
      const before = await readsFor(world, 'before the rollback', 'platform.audit.list', 'page_size=25');
      assertExamined(before, 'before the rollback');
      assertEqual('with the indexes present, nothing is scanned', before.scannedTables.join(' · '), '');

      world.control.raw.exec(`DROP INDEX ${TIME_INDEX};`);
      world.control.raw.exec(`DROP INDEX ${ORGANIZATION_INDEX};`);

      const platform = await readsFor(world, 'platform feed, no index', 'platform.audit.list', 'page_size=25');
      assertExamined(platform, 'platform feed, no index');
      assertTrue(
        `${ISOLATION} the unfiltered platform feed now SCANS ${ACTION_LOG}`,
        platform.scannedTables.includes(ACTION_LOG),
        'THE ASSERTION ABOVE IS NOT ABOUT THE INDEX. With both indexes dropped the feed still ' +
          'reports as bounded, so what it was measuring was the fixture being small — and it ' +
          `would go on passing at the size where this matters:\n           ${plans(platform)}`,
      );
      assertTrue(
        'and it sorts into a temporary B-tree — the 50,000-row shape, verbatim',
        platform.queries.some((query) => query.temporarySort),
        `expected 'SCAN ${ACTION_LOG} | USE TEMP B-TREE FOR ORDER BY', which is the plan qa-agent ` +
          `measured before 0016:\n           ${plans(platform)}`,
      );

      const scoped = await readsFor(
        world,
        'Organization feed, no index',
        'platform.organizations.audit.list',
        'page_size=25',
      );
      assertExamined(scoped, 'Organization feed, no index');
      assertTrue(
        `${ISOLATION} and the Organization feed scans too`,
        scoped.scannedTables.includes(ACTION_LOG),
        'the scoped feed stayed bounded without its index, so its assertion above is also a ' +
          `property of the fixture rather than of 0016:\n           ${plans(scoped)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE CLASSIFIER ITSELF: an index walk is bounded, a sorted scan is not', async () => {
    // ===================================================================================
    // THE DISCRIMINATOR IS `USE TEMP B-TREE FOR ORDER BY`, NOT THE WORD `SCAN`.
    // ===================================================================================
    //
    // SQLite says `SCAN` whenever there is no search key — **including when it walks an index in
    // order and stops at the LIMIT.** An earlier version of this classifier keyed on the word
    // `SCAN` alone and **would have reported `0016` as ineffective**: a correct migration
    // described as a failure, with the authority of a measurement.
    //
    // That is the harder direction of this family. A check that finds nothing is at least
    // suspicious; a check that finds something feels like it is working, and nobody re-derives a
    // red. So the two plan shapes are put through the classifier directly.
    const world = await make();
    try {
      seedLog(world);

      const indexed = await readsFor(world, 'indexed', 'platform.audit.list', 'page_size=25');
      const indexedScanLines = indexed.queries.filter((query) => /SCAN/.test(query.plan));
      assertTrue(
        'the bounded plan really does contain the word SCAN — otherwise this case proves nothing',
        indexedScanLines.length > 0,
        `no plan mentioned SCAN, so the discriminator this case is about was never exercised:\n` +
          `           ${plans(indexed)}`,
      );
      assertEqual(
        `${ISOLATION} and it is classified as bounded ANYWAY`,
        indexed.scannedTables.join(' · '),
        '',
      );

      world.control.raw.exec(`DROP INDEX ${TIME_INDEX};`);
      const unindexed = await readsFor(world, 'unindexed', 'platform.audit.list', 'page_size=25');
      assertTrue(
        'and the same word, with a temporary sort, is classified as unbounded',
        unindexed.scannedTables.includes(ACTION_LOG),
        `the classifier cannot tell the two apart:\n           ${plans(unindexed)}`,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
