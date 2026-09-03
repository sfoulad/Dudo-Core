/**
 * The Customer Directory verification run.
 *
 *   node packages/testing/run-customer-directory.ts
 *
 * Node 22 executes TypeScript directly by stripping types, so there is no build step, no
 * configuration file, no runner package and nothing installed. That is a constraint, not a
 * preference: ADR 0003 approves TypeScript on Cloudflare and NO npm package, and TS1 — the
 * testing framework — is unresolved.
 *
 * WHAT THIS PROGRAM PRINTS, AND WHY IT IS SHAPED THIS WAY.
 *
 * A primary run, then THREE NEGATIVE-CONTROL RUNS — predicate, resolver and boundary, as
 * `TESTING_STANDARD.md` §5.6 requires each separately. For each control the report classifies
 * every case into one of three outcomes, because "the suite went red" is not specific enough
 * to be evidence:
 *
 *   RED ON AN ISOLATION ASSERTION   the case is sensitive to that control. This is the result
 *                                   that makes the case's green run in the primary meaningful.
 *   RED ON ANOTHER ASSERTION        the case broke, but on a control or setup assertion rather
 *                                   than on the isolation claim it names. Sensitivity is real
 *                                   but is not evidence for the specific claim.
 *   STILL GREEN                     the case does NOT test that control, whatever its name
 *                                   says. Under `docs/decisions/0006` Option A an unexercised
 *                                   path is not weakly protected, it is unprotected — so this
 *                                   line is a coverage gap and is printed as one.
 *
 * The third category is exactly what this task was sent to close for the collection paths, and
 * printing it every run is what stops it from being rediscovered later as a surprise.
 */

import { printResults, tally } from './harness/runner.ts';
import type { CaseResult, Suite } from './harness/runner.ts';
import { createWorld } from './harness/world.ts';
import type { WorldOptions } from './harness/world.ts';

import { buildIsolationSuite } from './suites/customer-directory/isolation.ts';
import { buildStoragePathSuite } from './suites/customer-directory/storage-paths.ts';
import { buildCarrierSuite } from './suites/customer-directory/carriers.ts';
import { buildAuthorizationSuite } from './suites/customer-directory/authorization.ts';
import { buildAuditSuite } from './suites/customer-directory/audit.ts';
import { buildDeniedReadAuditSuite } from './suites/customer-directory/denied-read-audit.ts';
import { buildBoundedDenialAuditingSuite } from './suites/customer-directory/bounded-denial-auditing.ts';
import { buildWriteAdmissionSuite } from './suites/customer-directory/write-admission.ts';
import { buildHttpAndDeferralSuite } from './suites/customer-directory/http-and-deferral.ts';
import { buildSearchAndCollectionSuite } from './suites/customer-directory/search-and-collections.ts';
import { buildStateAndValidationSuite } from './suites/customer-directory/state-and-validation.ts';
import { buildResolverSuite } from './suites/customer-directory/resolver.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;
type World = Awaited<ReturnType<typeof createWorld>>;

function realWorld(options: WorldOptions = {}): Promise<World> {
  return createWorld(options);
}

async function runAll(suites: readonly Suite[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const suite of suites) {
    results.push(...(await suite.run()));
  }
  return results;
}

function classify(control: string, results: readonly CaseResult[]): void {
  const isolationRed = results.filter((r) => r.status === 'failed' && r.failedOnIsolationAssertion);
  const otherRed = results.filter((r) => r.status === 'failed' && !r.failedOnIsolationAssertion);
  const green = results.filter((r) => r.status === 'passed');
  const skipped = results.filter((r) => r.status === 'skipped');

  console.log(`\n=== NEGATIVE CONTROL: ${control} ===`);
  console.log(
    `  red on an isolation assertion: ${isolationRed.length}` +
      ` · red on another assertion: ${otherRed.length}` +
      ` · STILL GREEN: ${green.length}` +
      ` · skipped: ${skipped.length}`,
  );
  if (green.length > 0) {
    console.log('\n  STILL GREEN under a deliberately broken control — these cases do NOT test it:');
    for (const entry of green) {
      console.log(`    - ${entry.name}`);
    }
  }
  if (skipped.length > 0) {
    console.log('\n  Not run under this control:');
    for (const entry of skipped) {
      console.log(`    - ${entry.name}: ${entry.detail}`);
    }
  }
  console.log('\n  Cases that went red on an isolation assertion:');
  for (const entry of isolationRed) {
    console.log(`    - ${entry.name}`);
  }
  if (otherRed.length > 0) {
    console.log('\n  Cases that went red on a control or setup assertion:');
    for (const entry of otherRed) {
      console.log(`    - ${entry.name}`);
    }
  }
}

async function main(): Promise<void> {
  // ---- The primary run -----------------------------------------------------
  const make: MakeWorld = (options) => realWorld(options);
  const primary = await runAll([
    buildIsolationSuite(make),
    buildStoragePathSuite(make),
    buildCarrierSuite(make),
    buildResolverSuite(make),
    buildAuthorizationSuite(make),
    buildAuditSuite(make),
    buildDeniedReadAuditSuite(make),
    buildBoundedDenialAuditingSuite(make),
    buildWriteAdmissionSuite(make),
    buildStateAndValidationSuite(make),
    buildSearchAndCollectionSuite(make),
    buildHttpAndDeferralSuite(make),
  ]);
  printResults('PRIMARY RUN — real storage boundary, real resolver, real predicate', primary);

  // ---- Negative control 1: the tenant predicate -----------------------------
  const predicateBroken: MakeWorld = (options) => realWorld({ ...options, storeMode: 'predicate-broken' });
  classify(
    'THE PREDICATE — `tenant_id = ?` removed from every SELECT, UPDATE and DELETE the compiler emits',
    await runAll([buildIsolationSuite(predicateBroken), buildStoragePathSuite(predicateBroken)]),
  );

  // ---- Negative control 2: the resolver -------------------------------------
  const resolverBroken: MakeWorld = (options) => realWorld({ ...options, resolverMode: 'always-organization-b' });
  classify(
    "THE RESOLVER — every request is handed Organization B's store",
    await runAll([buildIsolationSuite(resolverBroken), buildStoragePathSuite(resolverBroken)]),
  );

  // ---- Negative control 3: the storage boundary -----------------------------
  const boundaryBypassed: MakeWorld = (options) => realWorld({ ...options, storeMode: 'boundary-bypass' });
  classify(
    'THE BOUNDARY — the query path reaches the engine without the Core-owned port (read paths only)',
    await runAll([buildStoragePathSuite(boundaryBypassed, true)]),
  );

  // ---- Negative control 4: the probe-detection control itself -----------------
  // The three storage controls break ISOLATION; none of them breaks AUDITING, so none of them
  // can tell us whether the denied-read suite would notice if D2 were removed. This one puts
  // `customers.GetCustomer` back to `auditOnDenial: false` — its shape before the user's
  // 2026-09-02 ruling — and the suite must go red.
  const d2Reverted: MakeWorld = (options) => realWorld({ ...options, revertD2: true });
  classify(
    "D2 REVERTED — customers.GetCustomer back to auditOnDenial: false, its shape before the 2026-09-02 ruling",
    await runAll([buildDeniedReadAuditSuite(d2Reverted)]),
  );

  // ---- Negative control 5: the identifier is back in the denial group key -----
  //
  // `docs/decisions/0013` control 5 is the constraint that makes the aggregation bounded, and
  // the oracle and timing properties both fall out of it. Nothing in the previous four controls
  // touches the grouping, so none of them can tell us whether the denied-read suite would
  // notice if the identifier were added back. This one adds it — through a wrapper around the
  // SHIPPED coordinator, with no production file edited — and the suite must go red.
  const identifierKeyed: MakeWorld = (options) => realWorld({ ...options, identifierInGroupKey: true });
  classify(
    'THE GROUP KEY — the requested customer identifier is BACK in it, which 0013 control 5 forbids',
    await runAll([buildDeniedReadAuditSuite(identifierKeyed)]),
  );

  // ---- Negative control 6: the write-admission guard stops guarding ------------
  //
  // `docs/decisions/0014` §A.11 is made structural at `d1-store.ts`, which refuses to compile a
  // statement without a valid, unspent, correctly-sized reservation for the tenant the handle
  // serves. None of the five controls above touches that guard, so none of them can tell us
  // whether the write-admission suite would notice if it stopped enforcing. This one substitutes
  // a freshly minted valid reservation for whatever the caller presented — the guard still runs
  // and never sees anything wrong — and the four §A.11 refusal cases must go red.
  const admissionBypassed: MakeWorld = (options) => realWorld({ ...options, storeMode: 'admission-bypass' });
  classify(
    'THE WRITE ADMISSION — every reservation is silently replaced with a valid one, which 0014 §A.11 forbids',
    await runAll([buildWriteAdmissionSuite(admissionBypassed)]),
  );

  const counts = tally(primary);
  console.log(
    `\nPRIMARY RESULT: ${counts.passed} passed, ${counts.failed} failed, ` +
      `${counts.skipped} skipped, ${counts.notRun} not run.`,
  );
  process.exitCode = counts.failed > 0 ? 1 : 0;
}

await main();
