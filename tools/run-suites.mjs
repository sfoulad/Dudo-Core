/**
 * ===========================================================================================
 * THE SUITE RUNNER. Root-level shared test configuration — Team Lead's, per `CLAUDE.md`.
 * ===========================================================================================
 *
 * Runs every suite entry point, reports each one's ACTUAL state, and exits non-zero if any
 * failed.
 *
 * ===========================================================================================
 * WHY THIS EXISTS RATHER THAN `a && b && c && d`
 * ===========================================================================================
 *
 * `npm test` was a chain of four `&&`s for about ten minutes on 2026-09-05. `qa-agent` named the
 * defect before anyone hit it: **if an earlier suite fails, the later ones never run, and the
 * output ends without mentioning them.** The exit code is correct and the transcript is
 * misleading — three absent suites read exactly like three passing ones to anyone scrolling.
 *
 * That is `.claude/rules/workflow.md` §6's own reporting standard broken by the tool meant to
 * serve it: **passed, failed, skipped and NOT RUN are four distinct states**, and a chain that
 * short-circuits cannot express the fourth.
 *
 * It is also the failure family this repository hit five separate times that day — a check whose
 * silence is indistinguishable from its success. A crashed verify pipeline printing nothing. A
 * `grep` over a file with NUL bytes. A citation-driven sweep over uncited duplicates. An empty
 * catalog comparison. Each time, ABSENCE RENDERED AS SUCCESS.
 *
 * ===========================================================================================
 * SO: EVERY SUITE RUNS, EVERY SUITE IS NAMED, AND THE SUMMARY IS THE LAST THING PRINTED
 * ===========================================================================================
 *
 * A suite that fails does not stop the others — a run that stops early tells you less than one
 * that finishes, and the whole point of running four is to learn about four.
 *
 * `run-az2-timing.ts` is DELIBERATELY ABSENT and is not an oversight. Its own header records
 * why: it is a measurement rather than a test, a wall-clock threshold on a shared developer
 * laptop fails for reasons that have nothing to do with the code, and **a suite that goes red
 * under load teaches a team to ignore red.** The structural proof of equal work lives in
 * `packages/testing/suites/az2-login/equal-work.ts` and holds on any machine.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SUITES = [
  'packages/testing/run-platform-operator.ts',
  'packages/testing/run-customer-directory.ts',
  'packages/testing/run-az2-login.ts',
  'packages/testing/run-type-negative.ts',
];

/** `not run` is a state, so a missing entry point is reported rather than silently skipped. */
const missing = SUITES.filter((suite) => !existsSync(suite));
if (missing.length > 0) {
  console.error('FAIL: suite entry point(s) missing — this run examined nothing for them:');
  for (const suite of missing) console.error(`  ${suite}`);
  process.exit(1);
}

const results = [];

for (const suite of SUITES) {
  console.log(`\n=== ${suite} ===`);
  const run = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  results.push({
    suite,
    // A signal or a spawn failure is neither passed nor failed — it is "did not complete", and
    // collapsing it into failed would lose the distinction this file exists to preserve.
    state: run.error ? 'DID NOT RUN' : run.signal ? `KILLED (${run.signal})` : run.status === 0 ? 'passed' : 'FAILED',
  });
}

console.log('\n=== summary ===');
for (const { suite, state } of results) {
  console.log(`  ${state === 'passed' ? 'passed     ' : state.padEnd(11)} ${suite}`);
}

const notPassed = results.filter((r) => r.state !== 'passed');
console.log(
  `\n${String(results.length - notPassed.length)}/${String(results.length)} suites passed` +
    (notPassed.length > 0 ? ` — ${String(notPassed.length)} did not` : ''),
);
process.exit(notPassed.length > 0 ? 1 : 0);
