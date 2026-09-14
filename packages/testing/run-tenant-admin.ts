/**
 * ===========================================================================================
 * THE MILESTONE 2 RUN — the tenant-admin request class, `0043` and `0044`.
 * ===========================================================================================
 *
 *   node packages/testing/run-tenant-admin.ts
 *
 * ===========================================================================================
 * IT IS EXPECTED TO BE RED, AND THE RED IS THE DELIVERABLE
 * ===========================================================================================
 *
 * `0044` was accepted on 2026-09-13 and `core-agent` began the class the same morning. This
 * entry point was written **while the class was being written**, deliberately, because
 * `workflow.md` §11a is explicit that the broken state is worth more than any fixture:
 *
 *   > "A CONSTRUCTED input contains only the failure you already thought of. The REAL broken
 *   >  state contains the failures you did not think of, and it exists for free, once, and
 *   >  only until you repair it."
 *
 * So this runs against the unbuilt surface and reports what it finds. **A green first run
 * would have been the finding** — it would have meant the checks do not reach.
 *
 * It was held OUT of `tools/run-suites.mjs` on this repository's own standing terms — a red gate
 * folded into a green one makes the green one worthless, and each check joins **the day it exits
 * 0, and not before** (`package.json`, applied to `typecheck:tests`, `check:source-bytes` and
 * `check:route-fields`). **IT EXITED 0 AND THE TEAM LEAD WIRED IT IN ON 2026-09-13. It is part of
 * `npm test` now**, so a red here fails the gate.
 *
 * *(That paragraph read "It is held OUT of…" for about ten minutes after it stopped being true.
 * `workflow.md` §12: a sentence about a missing capability outlives the capability arriving,
 * because everyone who reads it is reading it for the half that is still true — the standing
 * terms. The arrival is the sweep trigger, and the sweep is the thing nobody runs.)*
 */

import { printResults, tally } from './harness/runner.ts';
import type { CaseResult } from './harness/runner.ts';
import { buildAuthorityIsolationSuite } from './suites/tenant-admin/authority-isolation.ts';
import { buildChallengeRouteSuite } from './suites/tenant-admin/challenge-route.ts';
import { buildCriticalGrantTriggerSuite } from './suites/tenant-admin/critical-grant-trigger.ts';
import { buildGrantCeilingSuite } from './suites/tenant-admin/grant-ceiling.ts';
import { buildGrantReachabilitySuite } from './suites/tenant-admin/grant-reachability.ts';
import { buildInvitationRetentionSuite } from './suites/tenant-admin/invitation-retention.ts';
import { buildSixObligationsSuite } from './suites/tenant-admin/six-obligations.ts';
import { buildOwnerImmunitySuite } from './suites/tenant-admin/owner-immunity.ts';
import { buildRegistrationBehaviourSuite } from './suites/tenant-admin/registration-behaviour.ts';
import { buildTenantAdminRegistrationSuite } from './suites/tenant-admin/registration-refusals.ts';

async function main(): Promise<void> {
  const results: CaseResult[] = [];
  results.push(...(await buildTenantAdminRegistrationSuite().run()));
  results.push(...(await buildRegistrationBehaviourSuite().run()));
  results.push(...(await buildAuthorityIsolationSuite().run()));
  results.push(...(await buildGrantCeilingSuite().run()));
  results.push(...(await buildGrantReachabilitySuite().run()));
  results.push(...(await buildSixObligationsSuite().run()));
  results.push(...(await buildOwnerImmunitySuite().run()));
  results.push(...(await buildInvitationRetentionSuite().run()));
  results.push(...(await buildChallengeRouteSuite().run()));
  results.push(...(await buildCriticalGrantTriggerSuite().run()));

  printResults('MILESTONE 2 — tenant-admin class', results);

  const counts = tally(results);
  console.log(
    `\nPRIMARY RESULT: ${String(counts.passed)} passed, ${String(counts.failed)} failed, ` +
      `${String(counts.skipped)} skipped, ${String(counts.notRun)} not run.`,
  );
  process.exitCode = counts.failed > 0 ? 1 : 0;
}

await main();
