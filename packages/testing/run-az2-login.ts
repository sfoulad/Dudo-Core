/**
 * The AZ2 login verification run.
 *
 *   node packages/testing/run-az2-login.ts
 *
 * Node 22 executes TypeScript directly by stripping types, so there is no build step and nothing
 * installed — the same constraint `run-customer-directory.ts` records. ADR 0003 approves
 * TypeScript on Cloudflare and no npm package; TS1, the testing framework, is still unresolved.
 *
 * FOUR SUITES, ONE RUN:
 *
 *   equal-work         the account-existence oracle, observed structurally (0015 §C.3)
 *   stored-credential  what the database actually holds (0015 §D, migration 0006)
 *   tenant-resolution  isolation through the new tenant_directory resolver (0006 §0.2)
 *   kdf-vectors        cross-client agreement, web + enrolment tool + the Apple table
 *
 * THE TIMING MEASUREMENT IS A SEPARATE PROGRAM (`run-az2-timing.ts`) AND IS NOT PART OF THIS
 * RUN. A wall-clock threshold on a shared laptop is a coin flip; a suite that fails on load
 * teaches the team to ignore red. The structural equal-work cases here hold on any machine, and
 * the timing program supplies the distribution alongside them.
 *
 * The exit code is non-zero if anything failed, so this can gate integration without a human
 * reading the output. Skipped and not-run cases are printed and counted separately and are never
 * folded into the passed total.
 */

import { printResults, tally } from './harness/runner.ts';
import type { CaseResult, Suite } from './harness/runner.ts';

import { buildEqualWorkSuite } from './suites/az2-login/equal-work.ts';
import { buildStoredCredentialSuite } from './suites/az2-login/stored-credential.ts';
import { buildTenantResolutionSuite } from './suites/az2-login/tenant-resolution.ts';
import { buildKdfVectorSuite } from './suites/az2-login/kdf-vectors.ts';
import { buildSessionRevocationSuite } from './suites/az2-login/session-revocation.ts';
import { buildRoleGrantsSuite } from './suites/az2-login/role-grants.ts';
import { buildBusinessSetSuite } from './suites/az2-login/business-set.ts';
import { buildSessionRoutesSuite } from './suites/az2-login/session-routes.ts';
import { buildBusinessSetMarkerSuite } from './suites/az2-login/business-set-marker.ts';
import { buildEnrolmentRoundTripSuite } from './suites/az2-login/enrolment-round-trip.ts';
import { buildControlPlaneMigrationCoverageSuite } from './suites/harness/harness-fidelity.ts';

async function runAll(suites: readonly Suite[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const suite of suites) {
    results.push(...(await suite.run()));
  }
  return results;
}

async function main(): Promise<void> {
  const suites = [
    // The fixture's migration set is asserted before anything runs against it. Three drifts —
    // 0003, 0008, 0011 — each correct when written and silently wrong later.
    buildControlPlaneMigrationCoverageSuite(),
    buildEqualWorkSuite(),
    buildStoredCredentialSuite(),
    buildTenantResolutionSuite(),
    buildKdfVectorSuite(),
    buildSessionRevocationSuite(),
    buildRoleGrantsSuite(),
    buildBusinessSetSuite(),
    buildSessionRoutesSuite(),
    buildBusinessSetMarkerSuite(),
    buildEnrolmentRoundTripSuite(),
  ];

  const registered = suites.reduce((total, suite) => total + suite.caseNames.length, 0);
  const results = await runAll(suites);
  printResults('AZ2 login — primary run', results);

  const counts = tally(results);
  // A case that stops EXECUTING looks identical to a green one in a summary line. This compares
  // what was registered against what was reported, so a suite that silently stopped running is
  // visible rather than absent.
  console.log(
    `\n  registered cases: ${String(registered)} · reported: ${String(results.length)}` +
      (registered === results.length ? '' : '  <-- MISMATCH: cases did not run'),
  );

  const failed = counts.failed > 0 || registered !== results.length;
  console.log(`\n  AZ2 login: ${failed ? 'RED' : 'GREEN'}\n`);
  if (failed) {
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  }
}

await main();
