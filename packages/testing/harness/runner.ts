/**
 * A minimal test runner, written for this repository rather than chosen from a catalogue.
 *
 * WHY THIS EXISTS AT ALL. TS1 is unresolved: no testing framework is approved for
 * `Dudo-Core` (`.claude/rules/architecture.md` §6), and nothing may be installed. Node's own
 * `node:test` is a built-in and would work, but adopting it is still a choice about how this
 * repository writes tests, and that choice is not qa-agent's to make. So the runner is ~150
 * lines of ordinary code with no dependency and no configuration, and it is disposable: when
 * TS1 is decided, the suites move and this file is deleted.
 *
 * WHAT IT IS BUILT TO DO THAT A GENERIC RUNNER WOULD NOT.
 *
 * 1. IT DISTINGUISHES "REJECTED FOR THE INTENDED REASON" FROM "REJECTED FOR ANY REASON".
 *    Every negative assertion in these suites goes through `expectError`, which compares the
 *    WHOLE error value — code, message and details — against the expected one. A case that
 *    expected `not_found` and received `invalid_argument`, `forbidden` or `internal` FAILS.
 *    That is the specific trap the Team Lead named: a case passing because the request was
 *    malformed, or because the harness was broken, proves nothing about isolation.
 *
 * 2. IT LABELS ISOLATION ASSERTIONS. Assertions carry a label, and an isolation assertion's
 *    label starts with `ISOLATION:`. Under the negative control (the tenant predicate
 *    deliberately removed) the runner can then report three different outcomes rather than
 *    one: the case went red ON AN ISOLATION ASSERTION (the suite is sensitive), the case went
 *    red on something else (sensitive, but not for the reason claimed), or the case STAYED
 *    GREEN (the case does not test tenant isolation, whatever its name says). The third is
 *    the coverage gap this work was sent to close, and it has to be machine-detected rather
 *    than argued about.
 *
 * 3. IT COUNTS `not run` AS ITS OWN STATE. A case that was never reached because an earlier
 *    fixture failure aborted the file is not "skipped" and is certainly not "passed".
 */

export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'not_run';

export type CaseResult = {
  readonly suite: string;
  readonly name: string;
  readonly status: CaseStatus;
  /** The failure message, or the skip reason. */
  readonly detail: string | null;
  /** True when the failing assertion carried an `ISOLATION:` label. */
  readonly failedOnIsolationAssertion: boolean;
};

export class AssertionFailure extends Error {
  readonly label: string;
  constructor(label: string, message: string) {
    super(`${label} — ${message}`);
    this.name = 'AssertionFailure';
    this.label = label;
  }
}

export const ISOLATION = 'ISOLATION:';

type Registered =
  | { readonly kind: 'test'; readonly name: string; readonly run: () => Promise<void> | void }
  | { readonly kind: 'skip'; readonly name: string; readonly reason: string };

export class Suite {
  readonly name: string;
  private readonly cases: Registered[] = [];

  constructor(name: string) {
    this.name = name;
  }

  test(name: string, run: () => Promise<void> | void): void {
    this.cases.push({ kind: 'test', name, run });
  }

  /** A case deliberately not run, with the reason recorded. Never used to hide a failure. */
  skip(name: string, reason: string): void {
    this.cases.push({ kind: 'skip', name, reason });
  }

  get caseNames(): readonly string[] {
    return this.cases.map((entry) => entry.name);
  }

  async run(): Promise<CaseResult[]> {
    const results: CaseResult[] = [];
    for (const entry of this.cases) {
      if (entry.kind === 'skip') {
        results.push({
          suite: this.name,
          name: entry.name,
          status: 'skipped',
          detail: entry.reason,
          failedOnIsolationAssertion: false,
        });
        continue;
      }
      try {
        await entry.run();
        results.push({
          suite: this.name,
          name: entry.name,
          status: 'passed',
          detail: null,
          failedOnIsolationAssertion: false,
        });
      } catch (cause) {
        const isAssertion = cause instanceof AssertionFailure;
        results.push({
          suite: this.name,
          name: entry.name,
          status: 'failed',
          detail: cause instanceof Error ? cause.message : String(cause),
          failedOnIsolationAssertion: isAssertion && cause.label.startsWith(ISOLATION),
        });
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Assertions. Every one takes a label; the label is what the negative control reads.
// ---------------------------------------------------------------------------

function show(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function assertTrue(label: string, condition: boolean, message: string): void {
  if (!condition) {
    throw new AssertionFailure(label, message);
  }
}

export function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new AssertionFailure(label, `expected ${show(expected)}, actual ${show(actual)}`);
  }
}

export function assertDeepEqual(label: string, actual: unknown, expected: unknown): void {
  const left = show(actual);
  const right = show(expected);
  if (left !== right) {
    throw new AssertionFailure(label, `expected ${right}, actual ${left}`);
  }
}

type AnyResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/**
 * THE CENTRAL DISCIPLINE OF THESE SUITES.
 *
 * A negative case must fail for the reason it names. `expectError` compares the WHOLE error
 * value — code, message and details — so a case that expected `not_found` and received
 * `invalid_argument` (the request was malformed), `forbidden` (the principal was
 * under-privileged), `internal` (something threw) or `unavailable` (the harness was broken)
 * is a FAILURE, not a pass. Without this, a cross-tenant case would go green the moment the
 * fixture stopped working.
 */
export function expectError(label: string, result: AnyResult, expected: unknown): void {
  if (result.ok) {
    throw new AssertionFailure(
      label,
      `expected the error ${show(expected)}, but the call SUCCEEDED with ${show(result.value)}`,
    );
  }
  const actual = show(result.error);
  if (actual !== show(expected)) {
    throw new AssertionFailure(
      label,
      `expected the error ${show(expected)}, actual error ${actual} — a rejection for a ` +
        'different reason is not a pass',
    );
  }
}

/** The positive control that accompanies a negative case. */
export function expectOk(label: string, result: AnyResult): unknown {
  if (!result.ok) {
    throw new AssertionFailure(
      label,
      `expected success, actual error ${show(result.error)} — the control failed, so the ` +
        'negative case beside it proves nothing',
    );
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type Tally = {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly notRun: number;
};

export function tally(results: readonly CaseResult[]): Tally {
  return {
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notRun: results.filter((r) => r.status === 'not_run').length,
  };
}

export function printResults(title: string, results: readonly CaseResult[]): void {
  console.log(`\n=== ${title} ===`);
  let currentSuite = '';
  for (const result of results) {
    if (result.suite !== currentSuite) {
      currentSuite = result.suite;
      console.log(`\n  ${currentSuite}`);
    }
    const mark =
      result.status === 'passed'
        ? 'PASS'
        : result.status === 'failed'
          ? 'FAIL'
          : result.status === 'skipped'
            ? 'SKIP'
            : 'NOT RUN';
    console.log(`    [${mark}] ${result.name}`);
    if (result.status === 'failed' || result.status === 'skipped') {
      console.log(`           ${result.detail}`);
    }
  }
  const counts = tally(results);
  console.log(
    `\n  ${title}: ${counts.passed} passed, ${counts.failed} failed, ` +
      `${counts.skipped} skipped, ${counts.notRun} not run (${results.length} cases)`,
  );
}
