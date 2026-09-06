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
  rule('4. WHAT THIS DOES NOT MEASURE');

  console.log(
    [
      '  · D1 ITSELF. Every figure comes from `node:sqlite` executing the real migrations. D1 is',
      '    SQLite, so the shapes hold; the billing is Cloudflare\'s and is not visible from here.',
      '  · THE DURABLE OBJECT ADAPTER. Nothing executes it. Ledger CALLS are counted exactly; the',
      '    step from a call to a Durable Object REQUEST is an inference from the adapter\'s shape.',
      '  · MULTI-ROW STATEMENTS. Costs count statements, not affected rows, so any figure covering',
      '    a bulk delete is a LOWER bound — which makes the capacity number an OVER-estimate.',
      '  · READ ALLOWANCES. D1 bills rows read; nothing here counts them, and a feed read over a',
      '    large table is the obvious candidate for binding before writes do.',
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
