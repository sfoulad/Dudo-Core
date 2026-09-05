/**
 * The platform-operator (super-admin) surface verification run.
 *
 *   node packages/testing/run-platform-operator.ts
 *
 * Node 22 executes TypeScript directly by stripping types, so there is no build step and nothing
 * installed — the same constraint `run-customer-directory.ts` and `run-az2-login.ts` record.
 * `docs/decisions/0003` approves TypeScript on Cloudflare and no npm package; TS1, the testing
 * framework, is still unresolved, so `harness/runner.ts` remains ~150 disposable lines.
 *
 * WHAT IT COVERS
 *
 *   mutual-exclusion        `0024` · `0025` decision 1 — the trap, both directions, all four
 *                           triggers, and the Action-side half the contract also requires
 *   operator-isolation      an operator's session can never resolve a tenant store
 *   no-tenant-reach         binding property P1, as a source-level negative control
 *   authorization           the four denial causes, collapsed to one answer
 *   class-validation        binding property P2, asserted PER ROUTE
 *   audit                   binding property P4, and `0025` decision 5's content constraint
 *   organizations-list      the enumeration route, its bounds and its cursor
 *   host-binding            `0022` as amended — 404 on the wrong host, never 403
 *   bootstrap-bounds        `0025` decision 4's four bounds on `0007` D11
 *   confirmation            `0027` — reported, not run. See the suite for why.
 *
 * THEN THREE NEGATIVE-CONTROL RUNS. A suite that cannot be made to go red by removing the control
 * it claims to test is not testing it, and that has to be machine-detected rather than argued
 * about. Each control is applied as a WRAPPER around a real port; no file under
 * `platform/core/**` is edited by anything here, and production has no switch that turns any of it
 * off.
 *
 * The exit code is non-zero if anything failed, so this can gate integration without a human
 * reading the output. Skipped and not-run cases are printed and counted separately and are never
 * folded into the passed total.
 */

import { printResults, tally } from './harness/runner.ts';
import type { CaseResult, Suite } from './harness/runner.ts';

import { buildMutualExclusionSuite } from './suites/platform-operator/mutual-exclusion.ts';
import { buildMembershipWriteGuardSuite } from './suites/platform-operator/membership-write-guard.ts';
import { buildOperatorSessionIsolationSuite } from './suites/platform-operator/operator-session-isolation.ts';
import { buildNoTenantReachSuite } from './suites/platform-operator/no-tenant-reach.ts';
import { buildPlatformAuthorizationSuite } from './suites/platform-operator/authorization.ts';
import { buildClassValidationSuite } from './suites/platform-operator/class-validation.ts';
import { buildPlatformAuditSuite } from './suites/platform-operator/audit.ts';
import { buildOrganizationsListSuite } from './suites/platform-operator/organizations-list.ts';
import { buildHostBindingSuite } from './suites/platform-operator/host-binding.ts';
import { buildBootstrapBoundsSuite } from './suites/platform-operator/bootstrap-bounds.ts';
import { buildConfirmationSuite } from './suites/platform-operator/confirmation.ts';

import {
  withActionSideMutualExclusionRemoved,
  withAuditRecorderRemoved,
  withMutualExclusionProbeRemoved,
} from './harness/broken-platform-controls.ts';
import { createPlatformWorld } from './harness/platform-fixture.ts';
import type { PlatformWorldOptions } from './harness/platform-fixture.ts';

type MakeWorld = (options?: PlatformWorldOptions) => Promise<Awaited<ReturnType<typeof createPlatformWorld>>>;

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
    `  red on an isolation assertion: ${String(isolationRed.length)}` +
      ` · red on another assertion: ${String(otherRed.length)}` +
      ` · STILL GREEN: ${String(green.length)}` +
      ` · skipped: ${String(skipped.length)}`,
  );
  if (green.length > 0) {
    console.log('\n  STILL GREEN under a deliberately broken control — these cases do NOT test it:');
    for (const entry of green) {
      console.log(`    - ${entry.name}`);
    }
  }
  if (isolationRed.length > 0) {
    console.log('\n  Cases that went red on an isolation assertion:');
    for (const entry of isolationRed) {
      console.log(`    - ${entry.name}`);
    }
  }
  if (otherRed.length > 0) {
    console.log('\n  Cases that went red on another assertion:');
    for (const entry of otherRed) {
      console.log(`    - ${entry.name}`);
    }
  }
}

async function main(): Promise<void> {
  const primarySuites = [
    buildMutualExclusionSuite(),
    buildMembershipWriteGuardSuite(),
    buildOperatorSessionIsolationSuite(),
    buildNoTenantReachSuite(),
    buildPlatformAuthorizationSuite(),
    buildClassValidationSuite(),
    buildPlatformAuditSuite(),
    buildOrganizationsListSuite(),
    buildHostBindingSuite(),
    buildBootstrapBoundsSuite(),
    buildConfirmationSuite(),
  ];
  const registered = primarySuites.reduce((total, suite) => total + suite.caseNames.length, 0);
  const primary = await runAll(primarySuites);
  printResults('PLATFORM OPERATOR — primary run', primary);

  // A case that stops EXECUTING looks identical to a green one in a summary line.
  console.log(
    `\n  registered cases: ${String(registered)} · reported: ${String(primary.length)}` +
      (registered === primary.length ? '' : '  <-- MISMATCH: cases did not run'),
  );

  // -----------------------------------------------------------------------------------------
  // Negative control 1: THE MUTUAL-EXCLUSION PROBE.
  //
  // `principalHasAnyMembership` is wrapped to answer `false` for every principal — which is
  // exactly the shape of the defect: the probe still runs, still costs a statement, and always
  // says no. Every case in the mutual-exclusion and authorization suites that claims the
  // invariant must go red.
  // -----------------------------------------------------------------------------------------
  const probeRemoved: MakeWorld = (options) =>
    createPlatformWorld({ ...options, wrapStore: withMutualExclusionProbeRemoved });
  classify(
    'THE MUTUAL-EXCLUSION PROBE — principalHasAnyMembership always answers false',
    await runAll([
      buildMutualExclusionSuite(probeRemoved),
      buildPlatformAuthorizationSuite(probeRemoved),
    ]),
  );

  // -----------------------------------------------------------------------------------------
  // Negative control 1b: THE MUTUAL EXCLUSION ON THE ACTION SIDE.
  //
  // The invariant is enforced in two places reading two different statements, and control 1 above
  // reaches only one of them. Since `session-resolution.ts::liveSession` began refusing a
  // both-tables principal, it refuses BEFORE the platform store's probe is consulted — so control
  // 1's reach shrank without anything about it looking different. This removes the other half:
  // `findPrincipal` still runs both EXISTS subqueries and `holdsMembership` is dropped.
  // -----------------------------------------------------------------------------------------
  const actionSideRemoved: MakeWorld = (options) =>
    createPlatformWorld({ ...options, wrapIdentityStore: withActionSideMutualExclusionRemoved });
  classify(
    'THE ACTION-SIDE MUTUAL EXCLUSION — findPrincipal reports holdsMembership: false',
    await runAll([
      buildMutualExclusionSuite(actionSideRemoved),
      buildPlatformAuthorizationSuite(actionSideRemoved),
    ]),
  );

  // -----------------------------------------------------------------------------------------
  // Negative control 1c: BOTH HALVES AT ONCE — and this is the one that answers the question.
  //
  // Controls 1 and 1b each remove ONE of two independent checks, and the platform routes refuse a
  // both-tables principal under either one alone. That is defence in depth working exactly as
  // `0025` intends, and it has a consequence for how the two runs above must be read: NEITHER OF
  // THEM CAN TURN THE "every platform route refuses" CASE RED, so neither on its own demonstrates
  // that the case tests the invariant rather than testing nothing.
  //
  // This run removes both. If the case still stayed green here, it would not be testing the
  // invariant at all — and that is a claim only a run with every enforcement point removed can
  // settle. Stated rather than left to be inferred from two partial controls.
  // -----------------------------------------------------------------------------------------
  const bothHalvesRemoved: MakeWorld = (options) =>
    createPlatformWorld({
      ...options,
      wrapStore: withMutualExclusionProbeRemoved,
      wrapIdentityStore: withActionSideMutualExclusionRemoved,
    });
  classify(
    'BOTH HALVES OF THE MUTUAL EXCLUSION — the platform probe AND the Action-side flag',
    await runAll([
      buildMutualExclusionSuite(bothHalvesRemoved),
      // The membership write guard is included here on purpose. Removing BOTH runtime halves of
      // the mutual exclusion does NOT reach layer 2 — the guard lives in the SQL, not in a port
      // the harness can wrap — so these cases must stay GREEN under this control. A layer that
      // survives every wrapper the harness can apply is the layer with no window.
      buildMembershipWriteGuardSuite(bothHalvesRemoved),
    ]),
  );

  // -----------------------------------------------------------------------------------------
  // Negative control 2: THE AUDIT RECORD.
  //
  // `PlatformAuditRecorder.record` is wrapped to succeed without writing anything — the "best
  // effort" mode `platform-audit.ts` says in capitals it does not have. Every P4 case must go
  // red, and this is the control that says whether the audit suite tests P4 or merely runs
  // alongside it.
  // -----------------------------------------------------------------------------------------
  const auditRemoved: MakeWorld = (options) =>
    createPlatformWorld({ ...options, wrapAudit: withAuditRecorderRemoved });
  classify(
    'THE AUDIT RECORD — every write silently succeeds and nothing is stored',
    await runAll([buildPlatformAuditSuite(auditRemoved)]),
  );

  // -----------------------------------------------------------------------------------------
  // Negative control 3: THE HOST BINDING.
  //
  // `adminHosts` is widened to include the application host. `0025` is explicit that the host
  // binding is defence in depth and must never become the first layer — so the authorization
  // cases must STAY GREEN here, and only the host-binding cases must go red. A green
  // authorization suite under this control is the evidence that routing is not doing the
  // authorizing.
  // -----------------------------------------------------------------------------------------
  const hostBindingRemoved: MakeWorld = (options) =>
    createPlatformWorld({ ...options, adminHosts: ['admin.dudo.test', 'app.dudo.test'] });
  classify(
    'THE HOST BINDING — the application host is added to adminHosts',
    await runAll([
      buildHostBindingSuite(hostBindingRemoved),
      buildPlatformAuthorizationSuite(hostBindingRemoved),
    ]),
  );

  const counts = tally(primary);
  console.log(
    `\nPRIMARY RESULT: ${String(counts.passed)} passed, ${String(counts.failed)} failed, ` +
      `${String(counts.skipped)} skipped, ${String(counts.notRun)} not run.`,
  );
  const failed = counts.failed > 0 || registered !== primary.length;
  console.log(`\n  PLATFORM OPERATOR: ${failed ? 'RED' : 'GREEN'}\n`);
  if (failed) {
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  }
}

await main();
