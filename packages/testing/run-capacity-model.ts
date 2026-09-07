/**
 * The measured capacity model. `docs/decisions/0030`.
 *
 *   node packages/testing/run-capacity-model.ts
 *
 * ===========================================================================================
 * *** THIS IS A MEASUREMENT PROGRAM, NOT A TEST, AND IT IS DELIBERATELY OUT OF `npm test`. ***
 * ===========================================================================================
 *
 * `run-az2-timing.ts` makes the distinction and it applies here for the same reason: **a capacity
 * figure that goes red teaches a team to ignore red.** These numbers move when a migration adds an
 * index, when an Action gains a write, or when someone changes an assumption — all of which are
 * legitimate, and none of which is a defect. A suite that failed on them would be failing on
 * change rather than on breakage.
 *
 * **WHAT IS A TEST LIVES IN THE SUITES AND ALREADY DOES.** `suites/customer-directory/
 * write-admission.ts` asserts that every declared write-cost constant matches the live schema, and
 * goes red when a migration adds an index without moving the number. That is the assertion; this
 * is the arithmetic built on top of it.
 *
 * IT EXITS 0 UNLESS IT COULD NOT MEASURE. A measurement program's failure mode is *"I could not
 * observe this"*, not *"the number is too big" — the second is a judgement and belongs to whoever
 * reads the report.
 */

import { measureOperations } from './capacity/workload.ts';
import { measureCustomerRowSize, measureRowSizes } from './capacity/storage.ts';
import {
  BASELINE,
  LIMITS,
  bindingLimits,
  monthsUntilStorageBinds,
  perBusinessDay,
} from './capacity/model.ts';
import type { Assumptions, MeasuredCosts } from './capacity/model.ts';
import { SEARCH_ROWS, rowsRead } from './capacity/reads.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function rule(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

async function main(): Promise<void> {
  console.log('\nDUDO CAPACITY MODEL — measured against the shipped code, not the register.\n');

  // -----------------------------------------------------------------------------------------
  rule('1. PER-OPERATION COST, measured by driving the real paths');

  const operations = await measureOperations();
  console.log(
    '  operation                              control  tenant  ledger  worker',
  );
  for (const operation of operations) {
    console.log(
      `  ${operation.name.padEnd(38)}` +
        `${String(operation.controlPlaneRowWrites).padStart(7)}` +
        `${String(operation.tenantRowWrites).padStart(8)}` +
        `${String(operation.ledgerCalls).padStart(8)}` +
        `${String(operation.workerRequests).padStart(8)}`,
    );
  }
  console.log(
    '\n  control/tenant = BILLED row-writes (statement × the table\'s true index cost, from the',
    '\n  live schema). ledger = calls into the admission port and coordinator; in deployment each',
    '\n  is one Durable Object request. See capacity/measure.ts for what that mapping does and',
    '\n  does not claim.',
  );

  const caveated = operations.filter((operation) => operation.caveats.length > 0);
  if (caveated.length > 0) {
    console.log('\n  CAVEATS — read these before using the numbers above:');
    for (const operation of caveated) {
      for (const caveat of operation.caveats) {
        console.log(`    · ${operation.name}: ${caveat}`);
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  rule('1b. THE DECLARED CONSTANTS AGAINST THE LIVE SCHEMA');

  console.log(
    [
      '  The register says a Customer create costs 8 "because D1 bills an index row per indexed',
      '  column". VERIFIED rather than assumed: `customer` has 2 indexes (cost 3) and `audit_event`',
      '  has 4 (cost 5) — 3 + 5 = 8, arrived at from the schema rather than from the register.',
      '',
      '  Every control-plane constant matches 1 + index count, WITH ONE DOCUMENTED EXCEPTION:',
      '  TEMPLATE_ROW_WRITES is 4 where the table costs 3, and `control-plane-admission.ts` says',
      '  why — it bundles the platform-operator audit record, and over-reserving is the safe',
      '  direction per 0014 §A.12. **A blanket "declared == 1 + indexes" check would report that as',
      '  a defect.** It is named here so nobody adds that check and then suppresses its one red.',
    ].join('\n'),
  );

  // -----------------------------------------------------------------------------------------
  rule('2. BYTES PER ROW, measured by writing rows and looking');

  const sizes = measureRowSizes();
  const customerSchema = fileURLToPath(
    new URL('../../apps/customers/data/migrations/0001_customer.sql', import.meta.url),
  );
  // IT THROWS RATHER THAN RETURNING NULL. The first version caught the failure and printed
  // "could not be measured", which read as a limitation of the harness — it was a wrong INSERT.
  // **A measurement program that cannot measure something must say WHY**, and a swallowed
  // exception turns a fixable mistake into an accepted gap.
  sizes.push(
    measureCustomerRowSize((harness) => {
      harness.raw.exec(readFileSync(customerSchema, 'utf8'));
    }),
  );

  for (const size of sizes) {
    console.log(`  ${size.table.padEnd(28)}${String(size.bytesPerRow).padStart(6)} bytes/row`);
    console.log(`  ${''.padEnd(28)}${size.meaning}`);
  }

  const auditRow = sizes.find((size) => size.table === 'audit_event');
  const operatorRow = sizes.find((size) => size.table === 'platform_operator_action');
  const sessionRow = sizes.find((size) => size.table === 'session');
  if (auditRow === undefined || operatorRow === undefined || sessionRow === undefined) {
    console.log('\n  COULD NOT MEASURE the rows the model needs. No capacity figure is produced.');
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
    return;
  }

  // -----------------------------------------------------------------------------------------
  rule('3. THE MODEL');

  const byName = (name: string) => operations.find((operation) => operation.name === name);
  const login = byName('issue a session (login)');
  const logout = byName('revoke a session (logout)');
  const feed = byName('read the platform audit feed');
  if (login === undefined || logout === undefined || feed === undefined) {
    console.log('  COULD NOT MEASURE the operations the model needs.');
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
    return;
  }

  // ===========================================================================================
  // THE ONE FIGURE THE HARNESS CANNOT DRIVE, STATED AS AN INPUT RATHER THAN SMUGGLED IN.
  // ===========================================================================================
  //
  // A customer's own Action — a Customer create or update — costs its own row-writes plus an
  // `audit_event`. `write-cost.ts` declares `AUDIT_EVENT_ROW_WRITES = 5`, and
  // `suites/customer-directory/write-admission.ts` ALREADY ASSERTS that constant against the live
  // schema on every run. So it is used here rather than re-measured, and the assertion that makes
  // it trustworthy is named so a reader can go and check it.
  //
  // The Customer row itself is 3 (`CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE`), giving 8 for a
  // create — which is the register's stated figure, arrived at from the other end.
  const AUDIT_EVENT_ROW_WRITES = 5;
  const CUSTOMER_ROW_WRITES = 3;

  const measured: MeasuredCosts = {
    loginControlWrites: login.controlPlaneRowWrites,
    loginLedgerCalls: login.ledgerCalls,
    logoutControlWrites: logout.controlPlaneRowWrites,
    logoutLedgerCalls: logout.ledgerCalls,
    auditedActionTenantWrites: CUSTOMER_ROW_WRITES + AUDIT_EVENT_ROW_WRITES,
    // One reservation per Action, through the per-Organization coordinator.
    auditedActionLedgerCalls: 1,
    operatorRequestControlWrites: feed.controlPlaneRowWrites,
    operatorRequestLedgerCalls: feed.ledgerCalls,
    bytesPerAuditEvent: auditRow.bytesPerRow,
    bytesPerOperatorAction: operatorRow.bytesPerRow,
    bytesPerSession: sessionRow.bytesPerRow,
  };

  const report = (label: string, assumptions: Assumptions): void => {
    const day = perBusinessDay(assumptions, measured);
    const overheadWrites = assumptions.operatorRequestsPerDay * measured.operatorRequestControlWrites;
    const overheadLedger = assumptions.operatorRequestsPerDay * measured.operatorRequestLedgerCalls;
    const limits = bindingLimits(assumptions, measured, overheadWrites, overheadLedger);
    const binding = limits[0]!;

    console.log(`\n  ── ${label}`);
    console.log(
      `     ${String(assumptions.usersPerBusiness)} users · ` +
        `${String(assumptions.auditedActionsPerUserPerDay)} audited actions/user/day · ` +
        `${String(assumptions.readsPerUserPerDay)} reads · ` +
        `${String(assumptions.retentionMonths)}-month retention`,
    );
    console.log(
      `     per business-day: ${String(day.totalRowWrites)} row-writes · ` +
        `${String(day.ledgerCalls)} ledger calls · ` +
        `${String(day.workerRequests)} worker requests · ${kib(day.bytesPerDay)}`,
    );
    for (const limit of limits) {
      const marker = limit === binding ? '  <-- BINDS FIRST' : '';
      console.log(
        `     ${String(limit.businesses).padStart(6)} businesses  ${limit.limit}${marker}`,
      );
      console.log(`             ${limit.derivation}`);
    }
    // ===================================================================================
    // *** THE STORAGE ROW ABOVE IS CIRCULAR AND MUST NOT BE READ AS A LIFETIME. ***
    // ===================================================================================
    //
    // "How many businesses fit in 500 MB over N months" and "how long do those businesses take
    // to fill 500 MB" are the same equation solved for different variables — so the second always
    // comes back as ≈ N. My first version printed that and it looked like a finding. It is
    // arithmetic agreeing with itself.
    //
    // THE USEFUL QUESTION IS THE ONE THE USER WAS ACTUALLY GIVEN A NUMBER FOR: at a FIXED count,
    // how long until storage binds. That is `0030`'s *"150 businesses for N months, and N is the
    // number that matters."*
    console.log('     at a FIXED business count, months until the 500 MB database is full:');
    for (const count of [25, 50, 100, 150]) {
      const months = monthsUntilStorageBinds(count, assumptions, measured);
      console.log(
        `       ${String(count).padStart(4)} businesses → ${months.toFixed(1)} months ` +
          `(${(months / 12).toFixed(1)} years)`,
      );
    }
  };

  report('BASELINE', BASELINE);
  report('BUSIER: 10 users, 60 actions/day', {
    ...BASELINE,
    usersPerBusiness: 10,
    auditedActionsPerUserPerDay: 60,
    readsPerUserPerDay: 150,
  });
  report('QUIETER: 3 users, 8 actions/day', {
    ...BASELINE,
    usersPerBusiness: 3,
    auditedActionsPerUserPerDay: 8,
    readsPerUserPerDay: 25,
  });
  report('LONG RETENTION: baseline traffic, 5 years', { ...BASELINE, retentionMonths: 60 });

  // -----------------------------------------------------------------------------------------
  rule('3b. ROWS READ — the allowance the write model left open');

  console.log(
    [
      '  D1 bills 5,000,000 rows read/day, account-wide, and exceeding it STOPS queries rather',
      '  than billing for them. Rows read is decided by the QUERY PLAN, not by the page size: a',
      '  SEARCH descends an index and costs a constant; a SCAN steps through every row, so its',
      '  cost IS the table size and grows with history.',
      '',
      '  Plans, taken with EXPLAIN QUERY PLAN over the real schema with the real parameters:',
    ].join('\n'),
  );

  const scanning = operations.filter(
    (operation) =>
      operation.controlReads.scannedTables.length > 0 ||
      operation.tenantReads.scannedTables.length > 0,
  );
  for (const operation of operations) {
    const scans = [
      ...operation.controlReads.scannedTables,
      ...operation.tenantReads.scannedTables,
    ];
    const searches = operation.controlReads.totalSearches + operation.tenantReads.totalSearches;
    console.log(
      `    ${operation.name.padEnd(38)}${String(searches).padStart(3)} indexed lookups` +
        (scans.length > 0 ? `  ·  SCANS ${scans.join(', ')}` : ''),
    );
  }

  // ===========================================================================================
  // *** EVERYTHING BELOW BRANCHES ON WHAT WAS MEASURED. NONE OF IT IS PROSE WRITTEN IN ADVANCE. ***
  // ===========================================================================================
  //
  // This section first carried a fixed paragraph describing an unbounded scan. `0016` added the
  // ordering index, the scan went away, and the paragraph was still there — asserting a
  // denial-of-service shape that had just been fixed, with the table above it printing 14 rows
  // read at every log size.
  //
  // **THAT IS THE SAME ERROR I MADE THIS MORNING**, when I wrote "comfortable" before the numbers
  // existed, one paragraph from the evidence. A measurement program whose conclusions do not
  // track its measurements is a document that will eventually be confidently wrong in whichever
  // direction it was written.
  if (scanning.length === 0) {
    console.log(
      [
        '',
        '  *** NO OPERATION SCANS A TABLE. Read cost is bounded and does not grow with history. ***',
        '',
        '  THIS WAS NOT TRUE ON 2026-09-07 AT 09:00. Both audit feeds emitted',
        '  `SCAN platform_operator_action | USE TEMP B-TREE FOR ORDER BY`, so a feed request read',
        '  the whole log twice: 100,012 rows at a 50,000-row log, and 49 such requests exhausted',
        '  D1\'s account-wide 5,000,000/day — which stops every query including the session lookup',
        '  behind every login.',
        '',
        '  `0016` added `platform_operator_action_by_time (occurred_at, action_record_id)` and',
        '  `..._by_organization (target_organization_id, occurred_at, action_record_id)`. The plans',
        '  are now index walks with the ORDER BY satisfied and the LIMIT honoured, so a feed',
        '  request reads about as many rows as it returns.',
        '',
        '  MEASURED AFTER THE FIX, NOT ASSUMED FROM IT. The classifier had to be corrected first:',
        '  SQLite still says SCAN when it walks an index in order, and the first version read that',
        '  as unbounded — it would have reported a correct migration as ineffective. The signal',
        '  that distinguishes them is USE TEMP B-TREE, which forces every row to be materialised',
        '  and makes the LIMIT worthless.',
        '',
        '  *** THIS NOW DESCRIBES THE DEPLOYED SYSTEM AND NOT ONLY THIS HARNESS — WITH THE',
        '  ATTRIBUTION STATED, BECAUSE THE TWO HALVES WERE ESTABLISHED BY DIFFERENT PARTIES. ***',
        '',
        '  Until 2026-09-07 this was a property of a fixture: the migrations existed and had been',
        '  applied locally, and "local D1 accepted it" was quietly doing the work of "it works".',
        '  The user approved 0015 and 0016 and the Team Lead applied them to the REMOTE control',
        '  plane, then verified against the database rather than the tool\'s success glyph — which',
        '  mattered, because `${PIPESTATUS[1]}` came back empty under zsh and the checkmark was the',
        '  only other signal. Confirmed present: both indexes on `platform_operator_action`, all 13',
        '  identity columns on `organization`, no migrations pending.',
        '',
        '  WHAT THIS PROGRAM ESTABLISHES, PRECISELY: the plans above are SQLite\'s, over a schema',
        '  built from the same migration files that are now applied remotely. So the ACCESS PATH is',
        '  a property of production. **The row COUNTS are not** — D1 does its own `rows_read`',
        '  accounting, and whether a temp-B-tree sort is billed once or twice per row is not',
        '  something a local engine can answer. That factor of two is neither confirmed nor',
        '  contradicted here, and nothing above depends on it.',
      ].join('\n'),
    );
  } else {
    console.log(
      [
        '',
        '  *** THE TWO AUDIT FEEDS SCAN `platform_operator_action`, AND SORT IT IN A TEMP B-TREE. ***',
        '',
        '  `0014` records this deliberately — the column it adds has no index, and the migration',
        '  states the cost at roughly 50,000 rows and names what degrades first. This is that cost,',
        '  quantified: rows read per feed request IS the size of the action log, twice over for the',
        '  sort, and the log gains a row on EVERY platform request including the feed reads',
        '  themselves.',
        '',
        '  So read cost has a TIME AXIS exactly as storage does. A business count alone is not an',
        '  answer for either.',
      ].join('\n'),
    );
  }

  // THE WRITE COST OF THE INDEXES, from the live schema. `0016` traded read growth for a
  // per-record write cost, and the trade is only assessable if both halves are measured.
  const actionLogWriteCost = feed.controlBreakdown.billed['platform_operator_action'] ?? 0;

  const feedReads = feed.controlReads;
  const perFeedRead = (logRows: number, perSearch: number): number =>
    rowsRead(feedReads, (table) => (table === 'platform_operator_action' ? logRows : 0), perSearch);

  // THE SENSITIVITY TABLE ONLY MEANS SOMETHING WHEN COST GROWS WITH LOG SIZE. With every plan
  // bounded, every row of it reads the same number and printing it would invite a reader to draw
  // a trend from a constant.
  const growsWithLog = perFeedRead(500_000, SEARCH_ROWS) > perFeedRead(1_000, SEARCH_ROWS);
  if (growsWithLog) {
    console.log('\n  Rows read per feed request, against the action log\'s size:');
    console.log('    action log rows      rows read   feed reads/day to reach 5,000,000');
    for (const logRows of [1_000, 10_000, 50_000, 100_000, 500_000]) {
      const perRead = perFeedRead(logRows, SEARCH_ROWS);
      console.log(
        `    ${String(logRows).padStart(15)}${String(perRead).padStart(12)}` +
          `${String(Math.floor(5_000_000 / Math.max(perRead, 1))).padStart(36)}`,
      );
    }
  } else {
    const flat = perFeedRead(500_000, SEARCH_ROWS);
    console.log(
      `\n  A feed request reads ~${String(flat)} rows AT EVERY LOG SIZE — 1,000 rows or 500,000.` +
        `\n  That flatness IS the property: read cost no longer has a time axis.` +
        `\n  ${String(Math.floor(5_000_000 / Math.max(flat, 1)))} feed requests/day against the ` +
        '5,000,000 allowance, independent of history.',
    );
  }

  // THE INSENSITIVITY, DEMONSTRATED RATHER THAN CLAIMED. `SEARCH_ROWS` is a guess; if the answer
  // moved with it, the guess would be load-bearing and the model would be worth less.
  const low = perFeedRead(50_000, 1);
  const high = perFeedRead(50_000, 10);
  const spread = ((high - low) / low) * 100;
  console.log(
    growsWithLog
      ? `\n  The per-lookup charge is a guess (${String(SEARCH_ROWS)}). At a 50,000-row log, ` +
          `charging 1 gives ${String(low)}\n  and charging 10 gives ${String(high)} — a ` +
          `${spread.toFixed(2)}% difference. The scan dominates,\n  so the answer does not turn ` +
          'on the guess.'
      : `\n  *** THE PER-LOOKUP CHARGE IS NOW LOAD-BEARING, AND WAS NOT BEFORE. *** Charging 1 ` +
          `gives ${String(low)}\n  and charging 10 gives ${String(high)} — a ${spread.toFixed(0)}% ` +
          'spread. With no scan to dominate it,\n  the estimate IS the answer. That does not ' +
          'matter at these magnitudes — every figure is\n  four orders below the allowance — but ' +
          'it would matter the moment one approached it, and\n  a reader must not carry forward ' +
          'the old "insensitive to the guess" claim.',
  );

  // ===========================================================================================
  // *** READ THE TABLE ABOVE BEFORE THE PROSE BELOW. THE FIRST VERSION OF THIS PARAGRAPH WAS
  // WRITTEN BEFORE THE NUMBERS EXISTED AND SAID THE OPPOSITE. ***
  // ===========================================================================================
  //
  // I wrote "a few tens of thousands of feed reads per day — comfortable". The measurement says
  // FORTY-NINE at a 50,000-row log. That is the mistake this whole model exists to stop, made by
  // the person making the model, one paragraph away from the evidence.
  if (growsWithLog) {
    const pageSize = 25;
    const atFifty = perFeedRead(50_000, SEARCH_ROWS);
    const pagesAtFifty = Math.floor(5_000_000 / Math.max(atFifty, 1));
    console.log(
      [
        '',
        '  *** THIS IS A DENIAL-OF-SERVICE SHAPE, NOT A CAPACITY HEADROOM NOTE. ***',
        '',
        `  At a 50,000-row action log one feed request reads ${String(atFifty)} rows, so`,
        `  ${String(pagesAtFifty)} FEED REQUESTS EXHAUST THE ACCOUNT'S ENTIRE DAILY READ ALLOWANCE.`,
        `  At ${String(pageSize)} records a page that is ${String(pagesAtFifty * pageSize)} records —`,
        '  an ordinary afternoon for one operator investigating one incident.',
        '',
        '  And exceeding it stops D1 ACCOUNT-WIDE. Not the feed: every query, including the session',
        '  lookup every login performs. **One operator doing their job correctly takes the platform',
        '  down for every tenant**, with no malice and no bug — the same shape the register already',
        '  records for D2, arriving through a different door.',
        '',
        '  THE FIX IS AN INDEX ON (occurred_at, action_record_id) — configuration, not schema',
        '  shape, so it is available without a 0030 violation.',
      ].join('\n'),
    );
  } else {
    console.log(
      [
        '',
        '  WHAT THE INDEXES COST, WHICH IS THE HALF A FIX REPORT USUALLY OMITS.',
        '',
        `  \`platform_operator_action\` now costs ${String(actionLogWriteCost)} row-writes per`,
        '  record instead of 2 — one row plus its indexes — and P4 writes one record on EVERY',
        '  platform request, so every operator action got proportionally more expensive against',
        '  the 80,000/day admitted ceiling. That is the trade, measured from the live schema',
        '  rather than predicted: read cost stopped growing with history, write cost rose once.',
        '',
        '  IT IS OBVIOUSLY WORTH IT AND THE NUMBER IS STILL WORTH STATING, because the last',
        '  unexamined write cost on this exact table is what produced the read finding.',
      ].join('\n'),
    );
  }

  // -----------------------------------------------------------------------------------------
  rule('4. WHAT THIS DOES NOT MEASURE');

  console.log(
    [
      '  · D1 ITSELF. Every figure comes from `node:sqlite` executing the real migrations. D1 is',
      '    SQLite, so the shapes hold; the billing is Cloudflare\'s and is not visible from here.',
      '  · THE DURABLE OBJECT ADAPTER. Nothing executes it. Ledger CALLS are counted exactly; the',
      '    step from a call to a Durable Object REQUEST is an inference from the adapter\'s shape.',
      '  · MULTI-ROW STATEMENTS. Costs count statements, not affected rows, so any figure covering',
      '    a bulk delete is a LOWER bound — which makes the capacity number an OVER-estimate.',
      '  · ROWS ACTUALLY STEPPED THROUGH. Section 3b classifies plans, which is exact about SCAN',
      '    versus SEARCH; D1\'s own row-read counter is not visible from here, and the per-lookup',
      '    charge is a guess whose insensitivity is demonstrated rather than assumed.',
      '  · CONCURRENCY. D1 is single-threaded per database (`0006`); this measures cost, not',
      '    contention, and a latency ceiling could bind long before any allowance does.',
    ].join('\n'),
  );

  rule('5. THE ASSUMPTIONS ARE INPUTS');

  console.log(
    [
      '  Everything in section 3 rests on `capacity/model.ts::BASELINE`. Change it and re-run;',
      '  the answer moves without anyone re-deriving it. The measured half — per-operation cost',
      '  and bytes per row — does not move unless the code does.',
      '',
      `  Ceilings used: ${String(LIMITS.dudoAdmittedRowWritesPerDay)} admitted row-writes/day`,
      `  (Dudo\'s self-limit, not D1\'s ${String(LIMITS.d1RowWritesPerDay)}), ` +
        `${String(LIMITS.durableObjectRequestsPerDay)} DO requests/day,`,
      `  ${String(LIMITS.workerRequestsPerDay)} Worker requests/day, 500 MB per database.`,
    ].join('\n'),
  );

  console.log('');
}

await main();
