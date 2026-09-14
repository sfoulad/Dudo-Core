/**
 * ===========================================================================================
 * THE COUNTS EQUALITY RUN — the user's ruling of 2026-09-13, enforced.
 * ===========================================================================================
 *
 *   node packages/testing/run-counts-equality.ts
 *
 *   > "never maintain duplicated counts in prose; derive them from the catalogue and enforce
 *   >  equality through QA."
 *
 * ===========================================================================================
 * WHY IT IS A SEPARATE ENTRY POINT AND NOT A CASE INSIDE `run-platform-operator.ts`
 * ===========================================================================================
 *
 * Two reasons, and the second is an ownership boundary rather than a preference.
 *
 * 1. **A RED GATE FOLDED INTO A GREEN ONE MAKES THE GREEN ONE WORTHLESS.** `package.json`
 *    records this repository applying exactly that rule twice — `typecheck:tests` landed with
 *    14 diagnostics and was held out until green; `check:source-bytes` and
 *    `check:route-fields` each joined `test` **the day they exited 0, and neither before.**
 *    This check is new and its subject is a set of files that three agents are writing right
 *    now. It joins the gate on the same terms.
 *
 * 2. **`tools/run-suites.mjs` IS THE TEAM LEAD'S FILE.** Root-level shared test configuration
 *    is theirs (`CLAUDE.md`, `architecture.md` §2), and `qa-agent` **proposes** a change to it
 *    rather than making one. Wiring this entry point in is the Team Lead's edit, and the
 *    condition for it is one line: **this run exits 0.**
 *
 * Until then it is run by name, and its findings are tracked as defects rather than tolerated
 * as noise — which is the failure mode of a permanently-red check nobody folds in.
 *
 * ===========================================================================================
 * WHAT A RED RUN MEANS HERE, BECAUSE IT IS NOT THE USUAL THING
 * ===========================================================================================
 *
 * A failure in this suite is almost never a defect in `packages/testing/**`. It is a figure in
 * somebody else's prose that has stopped agreeing with the tree — so the repair belongs to the
 * file's owner and routes through the Team Lead, per `workflow.md` §5. The failure message
 * names the file and both numbers so the routing needs no further investigation.
 *
 * **The exception, and it is the outcome the ruling actually wants:** when a site is repaired
 * by DELETING the figure and naming the authority instead, this suite goes red with *"THE
 * REGION STATES NO FIGURE ABOUT THIS SUBJECT — DELETE THIS SITE."* That red is correct and the
 * repair is to remove the entry from `TOTAL_SITES`, which is `qa-agent`'s own file.
 */

import { printResults, tally } from './harness/runner.ts';
import type { CaseResult } from './harness/runner.ts';
import { buildCountsSelfTestSuite, buildDerivedPopulationsSuite } from './suites/counts/derived-populations.ts';

async function main(): Promise<void> {
  const results: CaseResult[] = [];

  // The self-tests run FIRST and are reported separately. If the checker's own logic is broken,
  // everything below it is unmeasured rather than passing — and a broken reader does not report
  // nothing, it reports agreement (`workflow.md` §11a).
  const selfTest = await buildCountsSelfTestSuite().run();
  printResults('KNOWN-FAILING INPUTS — the check checking itself', selfTest);

  const selfCounts = tally(selfTest);
  if (selfCounts.failed > 0) {
    console.error(
      `\nSTOPPING: ${String(selfCounts.failed)} of the checker's own known-failing inputs did not ` +
        'behave as required. THE REAL RUN IS THEREFORE **NOT RUN**, not passing — a comparison ' +
        'whose comparator is broken produces agreement, which is the most confident wrong answer ' +
        'available.',
    );
    process.exitCode = 1;
    return;
  }

  const real = await buildDerivedPopulationsSuite().run();
  printResults('DERIVED POPULATIONS against the real tree', real);
  results.push(...selfTest, ...real);

  const counts = tally(results);
  console.log(
    `\nPRIMARY RESULT: ${String(counts.passed)} passed, ${String(counts.failed)} failed, ` +
      `${String(counts.skipped)} skipped, ${String(counts.notRun)} not run.`,
  );
  // WIRED INTO `tools/run-suites.mjs` BY THE TEAM LEAD, 2026-09-13, once it exited 0.
  //
  // *** THE LINE THIS REPLACES SAID "THE CONDITION FOR JOINING IS MET — that wiring is the Team
  // Lead's edit", AND IT WENT ON SAYING SO AFTER THEY MADE THE EDIT. *** A sentence describing a
  // pending state, printed on every run, surviving the state ending — inside the suite built to
  // enforce that prose agrees with the tree. Nothing in this file could have caught it, because
  // it is not a COUNT: `workflow.md` §12's *a sentence about a missing capability outlives the
  // capability arriving*, and the arrival was the sweep trigger nobody ran.
  console.log(
    counts.failed === 0
      ? 'This run exits 0.'
      : 'This run exits 1, and it is part of `npm test`, so it fails the gate. Each failure above ' +
          "names a file and two numbers; the repair belongs to that file's owner, not to qa-agent — " +
          'EXCEPT when the message says the region states no figure at all, which means somebody ' +
          'correctly deleted a restated count and the site entry here should go with it.',
  );
  process.exitCode = counts.failed > 0 ? 1 : 0;
}

await main();
