/**
 * ===========================================================================================
 * THE CONFIRMATION MECHANISM — NOT RUN, AND WHY.
 * `docs/decisions/0027` · contract `confirmation-v1`, `testRequirements`.
 * ===========================================================================================
 *
 * `0027` asks for one check by name and calls it *"the single check this record most wants
 * performed"*:
 *
 *   "REMOVE THE CONFIRMATION CHECK FROM THE PIPELINE AND EVERY CRITICAL-OPERATION TEST MUST GO
 *   RED. If removing the check turns only some tests red, coverage is incomplete and the suite is
 *   what is wrong, not the finding."
 *
 * *** IT HAS NOT BEEN PERFORMED, BECAUSE THERE IS NOTHING TO REMOVE. ***
 *
 * At the time this suite was written `platform/core/**` contains no confirmation module, no
 * confirmation table and no migration creating one, and no operation anywhere is gated on a
 * confirmation. The first case below OBSERVES that state rather than asserting it from memory, so
 * the claim in this header is checked on every run instead of ageing quietly.
 *
 * A negative control that removed nothing would print a green control line, and a green control
 * line reads as evidence. That is worse than an absent one, so `broken-platform-controls.ts`
 * deliberately contains no confirmation wrapper and says so.
 *
 * ===========================================================================================
 * WHAT IS OWED THE MOMENT THE MECHANISM LANDS
 * ===========================================================================================
 *
 * Every case below is registered as SKIPPED with its contract reference, so the list is carried in
 * the run output rather than in a document nobody opens. `confirmation-v1` §`testRequirements` is
 * the source; the wording is kept close to the contract's on purpose.
 *
 * TWO OF THEM ARE HARDER THAN THEY LOOK AND ARE FLAGGED HERE RATHER THAN DISCOVERED LATER:
 *
 *   - "A confirmation is spent even when the operation FAILS." A read-then-write implementation
 *     passes this in serial testing.
 *   - "Two simultaneous submissions yield exactly one success." This is the case a read-then-write
 *     implementation passes in serial testing AND FAILS IN PRODUCTION, and `node:sqlite` in one
 *     process is not a concurrency environment. Testing it honestly needs either a real conditional
 *     UPDATE asserted at the SQL level (`UPDATE ... WHERE spent_at IS NULL` and a changed-row
 *     count) or a runtime that can run two isolates. THE FIRST IS ACHIEVABLE HERE AND THE SECOND
 *     IS NOT, and a suite claiming the second on the strength of the first would be overstating.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE_DIRECTORY = `${REPOSITORY_ROOT}platform/core`;
const CONTROL_PLANE_MIGRATIONS = `${REPOSITORY_ROOT}platform/core/migrations/control-plane`;

function listFiles(directory: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...listFiles(path, extension));
      continue;
    }
    if (entry.endsWith(extension)) {
      found.push(path);
    }
  }
  return found;
}

export function buildConfirmationSuite(): Suite {
  const suite = new Suite('Platform — the confirmation mechanism (0027): NOT RUN');

  suite.test('there is no confirmation mechanism in platform/core/** to test', () => {
    // THIS CASE EXISTS SO THE SKIPS BELOW ARE EVIDENCE-BACKED RATHER THAN ASSERTED FROM MEMORY.
    // When `core-agent` builds the mechanism this case goes RED, and that red is the signal to
    // replace every skip below with a real test. It is named for what it observes today.
    const modules = listFiles(CORE_DIRECTORY, '.ts').filter((path) =>
      path.slice(REPOSITORY_ROOT.length).toLowerCase().includes('confirmation'),
    );
    assertEqual(
      'no module under platform/core/** is named for confirmation',
      modules.map((path) => path.slice(REPOSITORY_ROOT.length)).join(', '),
      '',
    );

    const migrations = readdirSync(CONTROL_PLANE_MIGRATIONS).filter((name) =>
      name.toLowerCase().includes('confirmation'),
    );
    assertEqual('and no control-plane migration creates a confirmation table', migrations.join(', '), '');

    const mentioning = listFiles(CORE_DIRECTORY, '.ts').filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('confirmation_id') || source.includes('binding_hash');
    });
    assertEqual(
      'and nothing in Core reads a confirmation identifier or a binding hash',
      mentioning.map((path) => path.slice(REPOSITORY_ROOT.length)).join(', '),
      '',
    );

    assertTrue(
      'the scan really looked at Core',
      listFiles(CORE_DIRECTORY, '.ts').length > 20,
      'the file scan found almost nothing, so the emptiness above proves nothing',
    );
  });

  const NOT_BUILT =
    'NOT RUN. The confirmation mechanism does not exist in platform/core/**: no module, no ' +
    'table, no migration, and no operation gated on one. 0027 is Accepted and core-agent has ' +
    'not implemented it. This case is written down so it is carried in the run output rather ' +
    'than in a document nobody opens.';

  // --- confirmation-v1 §testRequirements.theBinding -----------------------------------------
  suite.skip(
    'SUBSTITUTION: a confirmation for a delete of X cannot be submitted with a delete of Y',
    `${NOT_BUILT} confirmation-v1 calls this THE CENTRAL TEST OF THAT CONTRACT.`,
  );
  suite.skip('a confirmation issued on session A cannot be submitted on session B', NOT_BUILT);
  suite.skip('a confirmation issued to principal P cannot be submitted by principal Q', NOT_BUILT);
  suite.skip('a confirmation for action A cannot be submitted for action B', NOT_BUILT);
  suite.skip('altering one parameter between challenge and submission is refused', NOT_BUILT);

  // --- confirmation-v1 §testRequirements.lifecycle ------------------------------------------
  suite.skip('a confirmation is spent on first use and a second submission is refused', NOT_BUILT);
  suite.skip(
    'a confirmation is spent even when the operation FAILS',
    `${NOT_BUILT} A read-then-write implementation passes this one in serial testing.`,
  );
  suite.skip(
    'CONCURRENCY: two simultaneous submissions with one confirmation_id yield exactly one success',
    `${NOT_BUILT} And see this file's header: node:sqlite in one process is not a concurrency ` +
      'environment, so even once the mechanism exists this can be asserted at the SQL level ' +
      '(a conditional UPDATE and its changed-row count) and NOT as true concurrency. Reported ' +
      'rather than claimed.',
  );
  suite.skip('an expired confirmation is refused, asserted at the boundary', NOT_BUILT);

  // --- confirmation-v1 §testRequirements.theReauthentication --------------------------------
  suite.skip(
    'a wrong derived value is refused and costs the same work as a right one',
    `${NOT_BUILT} The equal-work property must hold on this path too.`,
  );
  suite.skip(
    'an AI-agent principal cannot complete a critical operation',
    `${NOT_BUILT} 0007 D15's clause, owed as a POSITIVE test rather than as an assumption.`,
  );

  // --- confirmation-v1 §testRequirements.theOracleProperties --------------------------------
  suite.skip(
    'the challenge route refuses a caller lacking the permission IDENTICALLY to the operation',
    NOT_BUILT,
  );
  suite.skip(
    'a challenge for a target in ANOTHER tenant returns not_found, indistinguishable from absent',
    NOT_BUILT,
  );
  suite.skip('a challenge naming a NON-critical action is refused with invalid_argument', NOT_BUILT);

  // --- 0027's own central negative control ---------------------------------------------------
  suite.skip(
    'THE CENTRAL NEGATIVE CONTROL: remove the confirmation check and every critical-operation test goes red',
    'NOT PERFORMED, and it cannot be performed. There is no confirmation check in the pipeline ' +
      'to remove and no critical operation wired to one — customers.customer.delete is granted ' +
      'to no role and credential-reset-v1 has no implementation. A wrapper that removed nothing ' +
      'would produce a green control line, which reads as evidence and is worse than an absent ' +
      'one. This is reported to the Team Lead as OWED, not as done.',
  );

  // --- CF-2, which is a client obligation and belongs to both clients -----------------------
  suite.skip(
    'both clients render the server\'s statement verbatim',
    'NOT RUN, on two counts. The mechanism does not exist, and CF-2 is uncloseable from the ' +
      'server by construction — enforcement is a published client obligation that qa-agent must ' +
      'assert against the web client and the Apple client. Dudo-Apple has no test target and the ' +
      'web client has no confirmation surface, so there is nothing on either side to assert yet.',
  );

  return suite;
}
