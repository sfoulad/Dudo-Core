/**
 * ===========================================================================================
 * THE TYPE-NEGATIVE RUN — the only check that can see a type-level guarantee being removed.
 * ===========================================================================================
 *
 *   node packages/testing/run-type-negative.ts
 *
 * ===========================================================================================
 * WHY IT EXISTS, AND WHY IT OUTRANKS THE SUITE IT SITS BESIDE
 * ===========================================================================================
 *
 * Two of Dudo's controls are enforced by the TYPE SYSTEM AND BY NOTHING ELSE:
 *
 *   `MembershipAdmission`           `M-1`. A platform operator cannot be given a membership,
 *                                   because `createMembership` will not accept a call without a
 *                                   receipt that only `admitMembershipWrite` can produce.
 *   `ControlPlaneWriteReservation`  `0014` §A.11. No control-plane write proceeds against the
 *                                   account-wide daily allowance without one.
 *
 * NEITHER HAS A RUNTIME SURFACE. Relax `createMembership`'s third parameter to `admission?:`, or
 * export a private mint, and:
 *
 *   - `npm run typecheck` STAYS GREEN — the product still compiles, it is just permissive now;
 *   - every suite in `packages/testing/**` STAYS GREEN — Node strips types without checking them,
 *     so no test in this repository can observe a type;
 *   - the guarantee is gone, and nothing anywhere says so.
 *
 * `core-agent` found this about its own work and flagged it unprompted, adding the part that
 * makes it urgent rather than tidy: *"`ControlPlaneWriteReservation`'s brand check has exactly the
 * same blind spot and has had it since it shipped. We've been relying on nobody editing a
 * signature."* One guarantee is days old; the other has been load-bearing for the whole control
 * plane, untested, since `0014`.
 *
 * ===========================================================================================
 * THE THREE PROPERTIES, AND THE THIRD IS THE ONE THAT MAKES IT A TEST
 * ===========================================================================================
 *
 * 1. THE PROJECT MUST FAIL TO COMPILE. A zero exit means every negative case started compiling,
 *    which is the regression this exists to catch.
 *
 * 2. EVERY MARKED LINE MUST PRODUCE THE DIAGNOSTIC CODE IT NAMES. *"It didn't compile" passes on
 *    a missing semicolon.* An omitted argument is `TS2554` and a forged value is `TS2345`; a
 *    fixture that started failing for a different reason is reported as a different reason.
 *
 * 3. *** NO UNMARKED LINE MAY PRODUCE ANY DIAGNOSTIC. ***
 *
 * (3) is the property the Team Lead's first hand-run probe lacked, and it cost that probe its
 * whole run: it died on a wrong type name — `ControlPlaneStore` for `IdentityControlPlaneStore` —
 * and errored before reaching a single case. It exited non-zero, which under (1) alone reads as
 * SUCCESS. Under (3) it is a failure, because the import line carries no marker.
 *
 * (3) is also what makes the CONTROL LINES real. Each fixture contains a correct call that must
 * compile; there is no separate assertion for them, because "produced no diagnostic" is exactly
 * what (3) already requires of every unmarked line. And it is what turns the deliberate ASYMMETRY
 * between the two receipts into an assertion: `write-reservation.ts` calls
 * `mintControlPlaneWriteReservation` — exported on purpose, *"because the admission implementation
 * below and a future coordinator-backed one both need it, and for no other reason"* — and if
 * anyone ever makes it private to match the membership receipt, that line starts erroring on an
 * unmarked line and this run goes red.
 *
 * ===========================================================================================
 * WHAT IT DOES NOT PROVE
 * ===========================================================================================
 *
 * IT PROVES THE COMPILER REFUSES THESE CALLS. It does not prove the guarantee holds at runtime —
 * a deliberate `as never` cast defeats every case here, and nothing in a type system stops that.
 * That is why `M-1` has a second layer in the SQL and a third in `suites/platform-operator/
 * membership-write-guard.ts`, and why this run is one of three rather than the answer.
 *
 * It also only covers the call shapes written down in `type-negative/cases/**`. A NEW write method
 * that never took a receipt in the first place is invisible here, exactly as it is invisible to
 * the compiler — that is the gap `membership-write-guard.ts` covers by asserting over the
 * statements the run actually emitted.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = 'packages/testing/type-negative/tsconfig.json';
const CASES_DIRECTORY = `${REPOSITORY_ROOT}packages/testing/type-negative/cases`;

/** `path(line,col): error TSxxxx: message`. The continuation lines of a multi-line diagnostic
 *  do not match, which is correct — they belong to the diagnostic above them, not to a line of
 *  source. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** `// @expect-error TSxxxx`, on the line immediately before the line that must produce it. */
const MARKER = /^\s*\/\/\s*@expect-error\s+(TS\d+)\s*$/;

type Diagnostic = {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly message: string;
};

type Expectation = {
  readonly file: string;
  /** The line the diagnostic must appear on: the line AFTER the marker. */
  readonly line: number;
  readonly code: string;
};

function normalizeFile(path: string): string {
  const absolute = path.startsWith('/') ? path : `${REPOSITORY_ROOT}${path}`;
  return absolute.replace(REPOSITORY_ROOT, '');
}

function readExpectations(): Expectation[] {
  const expectations: Expectation[] = [];
  for (const entry of readdirSync(CASES_DIRECTORY)) {
    if (!entry.endsWith('.ts')) {
      continue;
    }
    const relative = `packages/testing/type-negative/cases/${entry}`;
    const lines = readFileSync(`${CASES_DIRECTORY}/${entry}`, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const matched = MARKER.exec(lines[index]);
      if (matched === null) {
        continue;
      }
      // `index` is 0-based and `index + 1` is the marker's 1-based line, so the line the
      // diagnostic must land on is `index + 2`.
      expectations.push({ file: relative, line: index + 2, code: matched[1] });
    }
  }
  return expectations;
}

function runTsc(): { readonly status: number; readonly diagnostics: Diagnostic[]; readonly raw: string } {
  // `npx` is not used: `tsc` is already a devDependency and resolving it directly means this
  // cannot silently fetch a different compiler from the network.
  const result = spawnSync(
    `${REPOSITORY_ROOT}node_modules/.bin/tsc`,
    ['--noEmit', '-p', PROJECT],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  );
  const raw = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const diagnostics: Diagnostic[] = [];
  for (const line of raw.split('\n')) {
    const matched = DIAGNOSTIC.exec(line);
    if (matched === null) {
      continue;
    }
    diagnostics.push({
      file: normalizeFile(matched[1]),
      line: Number(matched[2]),
      code: matched[4],
      message: matched[5],
    });
  }
  return { status: result.status ?? -1, diagnostics, raw };
}

type Failure = { readonly label: string; readonly detail: string };

function main(): void {
  const failures: Failure[] = [];
  const expectations = readExpectations();
  const { status, diagnostics, raw } = runTsc();

  console.log('\n=== TYPE-NEGATIVE RUN — the compiler as the test subject ===\n');

  // ---- Property 0: the harness itself ran. A probe that compiled nothing exits 0 and looks
  // exactly like a probe whose negative cases all started passing.
  if (expectations.length === 0) {
    failures.push({
      label: 'the fixtures declare no expectations',
      detail:
        'no `// @expect-error TSxxxx` marker was found under type-negative/cases. Either the ' +
        'fixtures were emptied or the marker syntax changed — either way this run would assert ' +
        'nothing while appearing to pass.',
    });
  }
  if (status === -1) {
    failures.push({
      label: 'tsc could not be executed',
      detail: `node_modules/.bin/tsc did not run. Raw output:\n${raw}`,
    });
  }

  // ---- Property 1: the project must FAIL to compile.
  if (status === 0) {
    failures.push({
      label: 'the type-negative project COMPILED',
      detail:
        'every negative case is now accepted by the compiler. A type-level guarantee has been ' +
        'relaxed: check whether createMembership or a control-plane writer made its receipt ' +
        'optional, or whether a private mint was exported.',
    });
  }
  console.log(`  tsc exit status: ${String(status)} (must be non-zero)`);
  console.log(`  expectations declared: ${String(expectations.length)}`);
  console.log(`  diagnostics emitted:   ${String(diagnostics.length)}\n`);

  // ---- Property 2: every marked line produced the code it named.
  const matchedDiagnostics = new Set<Diagnostic>();
  for (const expectation of expectations) {
    const found = diagnostics.find(
      (diagnostic) => diagnostic.file === expectation.file && diagnostic.line === expectation.line,
    );
    if (found === undefined) {
      failures.push({
        label: `${expectation.file}:${String(expectation.line)} expected ${expectation.code} and COMPILED`,
        detail:
          'the line marked @expect-error produced no diagnostic at all, so the call it makes is ' +
          'now legal. This is the regression shape the harness exists for.',
      });
      continue;
    }
    matchedDiagnostics.add(found);
    if (found.code !== expectation.code) {
      failures.push({
        label: `${expectation.file}:${String(expectation.line)} failed for a DIFFERENT reason`,
        detail:
          `expected ${expectation.code}, got ${found.code}: ${found.message}. A red result for ` +
          'the wrong reason is not a pass — "it did not compile" is satisfied by a missing ' +
          'semicolon.',
      });
      continue;
    }
    console.log(`  [OK]   ${expectation.file}:${String(expectation.line)} ${expectation.code}`);
  }

  // ---- Property 3: NO unmarked line produced any diagnostic.
  for (const diagnostic of diagnostics) {
    if (matchedDiagnostics.has(diagnostic)) {
      continue;
    }
    failures.push({
      label: `${diagnostic.file}:${String(diagnostic.line)} UNEXPECTED ${diagnostic.code}`,
      detail:
        `${diagnostic.message}\n           ` +
        'No @expect-error marker precedes this line. Either a CONTROL line stopped compiling — ' +
        'which means something that should be legal no longer is — or the fixture is broken and ' +
        'the whole run proves nothing. This is the failure that made the first hand-run probe ' +
        'look like a success.',
    });
  }

  if (failures.length === 0) {
    console.log(
      `\n  TYPE-NEGATIVE: GREEN — ${String(expectations.length)} guarantees still refuse to compile, ` +
        'and every control line still does.\n',
    );
    return;
  }

  console.log('\n  FAILURES:\n');
  for (const failure of failures) {
    console.log(`    [FAIL] ${failure.label}`);
    console.log(`           ${failure.detail}`);
  }
  console.log('\n  TYPE-NEGATIVE: RED\n');
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
}

main();
