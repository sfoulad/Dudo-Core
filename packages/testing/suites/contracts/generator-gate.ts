/**
 * ===========================================================================================
 * WHAT THE GATE NEEDS FROM THE `0037` GENERATOR, ASSERTED AS CASES RATHER THAN READ FROM AN
 * EXIT CODE.
 * ===========================================================================================
 *
 * This file exists because of a disagreement about where two different jobs belong, and the
 * resolution is the thing worth keeping:
 *
 *   > **Exit codes are for humans running a tool; suite assertions are for gates.**
 *
 * The Team Lead proposed making the generator's phase triggers exit 0 so `--check` could join
 * `npm test`. `architecture-agent` refused: a trigger that prints and exits 0 inside a passing run
 * is one line nobody reads, **and a phase becoming due is a STANDING INSTRUCTION TO CHANGE CODE** —
 * the class this repository keeps finding rotted in prose. Its counter-proposal, a special exit code
 * treated as pass-with-notice, had the same gap and added exit-code arithmetic to a shell chain.
 *
 * **So `generate-types.mjs --check` stays OUT of `npm test` as a deliberate command with meaningful
 * exit codes, and the two things a gate actually needs are these cases.**
 *
 * ===========================================================================================
 * AND THE REASON A SUITE CASE IS STRUCTURALLY BETTER HERE, WHICH IS NOT A MATTER OF TASTE
 * ===========================================================================================
 *
 * The `0039` phase-3 trigger this replaces was **unreachable**: it decided "the check is wired into
 * `npm test`" by searching that script for `check-request-class` — the FILENAME — when the script
 * can only ever contain `check:request-class`, the npm script NAME. One character. Its true arm had
 * **never executed in any run by anyone**, and nothing said so, because an unreachable branch and a
 * branch whose condition is simply not met yet render identically: silence.
 *
 * **A red suite case cannot be unreachable in that way. It runs every time, and a case that has
 * never gone red is visible as a case that has never gone red.**
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { exitCodeFor, run } from '../../../contracts/generator/generate-types.mjs';

const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));
const GENERATED = join(CONTRACTS, 'generated');

/**
 * Directories the generator's own `walk()` never descends into. Duplicated here because this file
 * derives its OWN population — the whole point of an independent expectation is that it does not
 * share a code path with the thing it is checking (`workflow.md` §11a).
 */
const NOT_CORPUS = new Set(['generated', 'generator', 'node_modules']);

function filesUnder(directory: string, base = directory, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (NOT_CORPUS.has(entry.name)) continue;
      filesUnder(full, base, out);
    } else out.push(relative(base, full));
  }
  return out;
}

/** Committed generated modules, counted from disk rather than from the report that produced them. */
function committedModules(): string[] {
  return filesUnder(GENERATED)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

type EnumNode = { readonly where: string; readonly constraint: boolean; readonly declared: boolean };

/**
 * *** EVERY `enum` NODE IN THE CORPUS, CLASSIFIED BY WHETHER IT IS A SHAPE OR A CONSTRAINT. ***
 *
 * The distinction decides whether `0041` can ever be satisfied, so it is derived rather than
 * assumed. An `enum` reached through `not`, `if`, `then`, `else`, `propertyNames` or `contains` is a
 * **negated or conditional constraint**, not a type anything is rendered from — and the generator's
 * `enumsExamined` counter lives inside `renderType`, so it never counts one.
 *
 * **THAT KEYWORD LIST IS MINE AND IT IS A JUDGEMENT, NOT A READING OF `0041`.** It is stated here
 * rather than buried, because if `0041` rules that a constraint enum owes a policy too, this list is
 * what has to change and the case below is what will say so.
 */
function corpusEnums(root: string = CONTRACTS): EnumNode[] {
  const CONSTRAINT_KEYWORDS = new Set(['not', 'if', 'then', 'else', 'propertyNames', 'contains']);
  const rows: EnumNode[] = [];
  for (const file of filesUnder(root).filter((name) => name.endsWith('.schema.json'))) {
    const visit = (node: unknown, segments: string[]): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, [...segments, String(index)]));
        return;
      }
      const record = node as Record<string, unknown>;
      if (Array.isArray(record['enum'])) {
        rows.push({
          where: `${file}#/${segments.join('/')}`,
          constraint: segments.some((segment) => CONSTRAINT_KEYWORDS.has(segment)),
          declared: typeof record['enumPolicy'] === 'string',
        });
      }
      for (const [key, value] of Object.entries(record)) visit(value, [...segments, key]);
    };
    visit(JSON.parse(readFileSync(join(root, file), 'utf8')), []);
  }
  return rows;
}

/**
 * Contracts with no `requestClass:` at either level, read textually — a scope the generator's is not.
 *
 * **BOTH SPELLINGS, AND THE SECOND IS WHY THIS IS NOT A ONE-LINE REGEX.** A contract may declare the
 * class at the contract level (column 0) or on a single operation (indented), and `confirmation-v1`
 * uses the second because it spans two classes and one block key cannot match both. A sweep written
 * as `^requestClass:` alone reports such a contract as LACKING the field — a false positive in the
 * direction that makes a migration look incomplete, which is the rot direction nobody questions.
 */
function contractsWithoutAnyClass(root: string = CONTRACTS): string[] {
  return filesUnder(root)
    .filter((name) => name.endsWith('.contract.yaml'))
    .filter((name) => {
      const text = readFileSync(join(root, name), 'utf8');
      return !/^requestClass:\s*\S+/mu.test(text) && !/^\s+requestClass:\s*\S+/mu.test(text);
    })
    .sort();
}

/** The constructed corpus both classifiers are exercised against. See its files' own headers. */
const CLASSIFIER_CONTROLS = fileURLToPath(
  new URL('../../fixtures/contract-generator/classifier-controls/', import.meta.url),
);

export function buildGeneratorGateSuite(): Suite {
  const suite = new Suite('Contracts — what the gate needs from the 0037 generator');

  suite.test('*** ZERO GENERATED MODULES HAVE DRIFTED — reported with the population, not as a bare 0 ***', () => {
    // ===================================================================================
    // `0037`'s CENTRAL HAZARD, AND IT IS EMPIRICAL RATHER THAN THEORETICAL.
    // ===================================================================================
    //
    // **Generated files rot exactly as hand-written ones do, with the extra harm that they LOOK
    // AUTHORITATIVE.** The Team Lead has been catching drift by hand all day, and the one time it
    // did not look, a stale module sat there until it did.
    //
    // *** A ZERO IS NOT THE ASSERTION. *** A run that compared nothing drifts nothing, and "nothing
    // drifted" and "nothing was examined" must not render alike — `workflow.md` §11a's empty-list
    // reader, which is the failure this repository has hit more often than any other.
    //
    // Invoked with NO ARGUMENTS, deliberately: `run()` defaults to the real corpus and the real
    // output root, so this is the same invocation `--check` makes. A root passed here would be a
    // second copy of a fact that already lives in the generator.
    const report = run({ mode: 'check' });
    const population = report.population ?? {};
    const compared = Number(population['modulesEmitted']);
    const drifted = Number(population['modulesDrifted']);
    const committed = committedModules();

    console.log(
      `        generator drift: ${compared} modules compared · ${drifted} drifted · ` +
        `${committed.length} committed on disk · ${population['contractsAdmitted']} contracts admitted`,
    );

    // ---- THE FLOOR, AGAINST AN INDEPENDENTLY DERIVED EXPECTATION.
    // `committedModules()` reads the filesystem; `modulesEmitted` comes from the emission walk.
    // Two mechanisms, deliberately different scopes of knowledge. A glob that stopped matching, a
    // renamed directory or a wrong working directory each produce "0 drifted", which reads exactly
    // like success — and each is caught here rather than there.
    assertTrue(
      `${ISOLATION} THE FLOOR: the run compared modules at all (${compared})`,
      compared > 0,
      'a run that compares nothing drifts nothing. THIS IS THE ASSERTION THAT MAKES THE ZERO BELOW ' +
        `MEAN ANYTHING: population=${JSON.stringify(population)}`,
    );
    assertEqual(
      'and the count it compared equals the modules committed on disk',
      `${compared}`,
      `${committed.length}`,
    );

    // ---- THE SUBJECT.
    assertEqual(`${ISOLATION} zero generated modules have drifted from their contracts`, drifted, 0);

    // ---- THE SAME FACT FROM THE OTHER END OF THE REPORT, AND A DISAGREEMENT IS A FINDING.
    // `modulesDrifted` is a counter incremented at delivery; `drift` is the list appended beside it.
    // They cannot disagree today. The day they do, one of the two stopped being maintained — and
    // this repository has already had a split where the TOTAL stayed right while the parts lied.
    assertEqual(
      'and the drift LIST agrees with the drift COUNT — a counter and its list can diverge',
      JSON.stringify(report.drift ?? []),
      '[]',
    );

    // ---- THE ORPHAN, WHICH THE DRIFT CHECK IS STRUCTURALLY BLIND TO.
    //
    // *** DRIFT COMPARES MODULES IT REGENERATES. A MODULE WHOSE CONTRACT WAS DELETED IS NEVER
    // *** REGENERATED, SO IT IS NEVER COMPARED, SO IT NEVER DRIFTS — IT JUST SITS THERE. ***
    //
    // Two anchors answering different questions, and the disagreement is the finding
    // (`workflow.md` §11a): `mode: 'check'` asks *does every produced module match what is
    // committed?* and this asks *is every committed module still produced?* An emit into a
    // TEMPORARY root gives the produced SET, which `mode: 'check'` never reveals.
    const temporary = mkdtempSync(join(tmpdir(), 'dudo-generator-inventory-'));
    try {
      run({ mode: 'emit', root: CONTRACTS, outputRoot: `${join(temporary, 'out')}/` });
      const produced = filesUnder(join(temporary, 'out'))
        .filter((name) => name.endsWith('.ts'))
        .sort();
      const orphans = committed.filter((name) => !produced.includes(name));
      assertEqual(
        `${ISOLATION} no committed module is an ORPHAN — every one is still produced from a contract`,
        JSON.stringify(orphans),
        '[]',
      );
      assertEqual(
        'and the produced set and the committed set are the same set, in both directions',
        JSON.stringify(produced.filter((name) => !committed.includes(name))),
        '[]',
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  suite.test('THE DRIFT CHECK\'S OWN FAILING INPUTS — a 0 from a checker that cannot fail is not a result', () => {
    // ===================================================================================
    // `workflow.md` §11a: a check ships with a known-failing input, or it has not been
    // verified — only observed. The case above has passed once. That is not evidence.
    // ===================================================================================
    //
    // Both controls point `outputRoot` at a TEMPORARY directory. **Nothing writes into
    // `packages/contracts/generated/**`, which is `architecture-agent`'s tree**, and the real
    // committed output is never touched — the mutant lives in a copy.
    const committed = committedModules();

    // ---- CONTROL 1: NOTHING COMMITTED AT ALL. Every module must report drift.
    const empty = mkdtempSync(join(tmpdir(), 'dudo-drift-empty-'));
    try {
      const report = run({ mode: 'check', root: CONTRACTS, outputRoot: `${join(empty, 'out')}/` });
      assertEqual(
        `${ISOLATION} against an EMPTY output root, every module drifts`,
        Number(report.population?.['modulesDrifted']),
        committed.length,
      );
      assertTrue(
        'and each says `no committed output` rather than a content mismatch — the reasons differ',
        (report.drift ?? []).every((entry) => entry.reason === 'no committed output'),
        `a checker that reports the same reason for every cause cannot be read: ${JSON.stringify(report.drift)}`,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }

    // ---- CONTROL 2: ONE MODULE ALTERED BY ONE LINE. Exactly one must drift.
    //
    // *** THIS IS THE ONE THAT MATTERS AND CONTROL 1 CANNOT SUBSTITUTE FOR IT. *** An absent file
    // is caught by `existsSync`; a file whose CONTENT diverged is caught only by the comparison,
    // which is the thing actually being trusted. The two exercise different lines.
    //
    // *** AND `1` RATHER THAN `>= 1` IS DELIBERATE. *** A comparison that flagged everything would
    // pass a `>= 1` assertion while being useless, so this pins the precision as well as the
    // detection — the other 17 staying green is half the result.
    const copy = mkdtempSync(join(tmpdir(), 'dudo-drift-mutant-'));
    try {
      const out = join(copy, 'out');
      cpSync(GENERATED, out, { recursive: true });
      const victim = committed[0];
      assertTrue(
        `${ISOLATION} FLOOR ON THE CONTROL: there is a module to mutate`,
        victim !== undefined,
        'no committed modules were found, so the mutant below would prove nothing',
      );
      const target = join(out, String(victim));
      writeFileSync(target, `${readFileSync(target, 'utf8')}\n// drift, planted by a negative control\n`, 'utf8');

      const report = run({ mode: 'check', root: CONTRACTS, outputRoot: `${out}/` });
      assertEqual(
        `${ISOLATION} one altered module drifts, and EXACTLY one — precision, not just detection`,
        Number(report.population?.['modulesDrifted']),
        1,
      );
      assertTrue(
        `and the drift names the module that was altered (${victim})`,
        (report.drift ?? []).some((entry) => entry.path.includes(String(victim).replace(/\.ts$/u, ''))),
        `the finding does not name the mutated module: ${JSON.stringify(report.drift)}`,
      );
      assertTrue(
        'and it reports a CONTENT difference, not a missing file — the two causes stay distinguishable',
        (report.drift ?? []).every((entry) => entry.reason.includes('differs')),
        `${JSON.stringify(report.drift)}`,
      );
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  suite.test('*** EXIT `3` IS ITS OWN CLAIM, AND `--check` MAKES IT ON THE REAL CORPUS ***', () => {
    // ===================================================================================
    // `1`, `2` AND `3` ARE THREE DIFFERENT CLAIMS AND "NON-ZERO" COLLAPSES THEM BACK INTO
    // THE STATE THE SPLIT EXISTS TO SEPARATE.
    // ===================================================================================
    //
    //   1  the CORPUS is wrong        refusals, or a committed module has drifted
    //   2  the TOOL'S accounting is broken   `fatal` — admitted + refused ≠ found
    //   3  a DECISION is due          a phase boundary was reached; nothing is broken
    //
    // **The generator's exit code moved from 2 to 3 in the pass that introduced `migrationNotice`,
    // and anything asserting "non-zero" passed straight through that change without noticing.**
    //
    // ===================================================================================
    // *** THIS SAID "a subprocess BECAUSE `exitCodeFor` IS NOT EXPORTED". THE PREMISE IS NOW
    // *** FALSE AND THE CONCLUSION IS STILL RIGHT — WHICH IS THE DANGEROUS COMBINATION. ***
    // ===================================================================================
    //
    // `exitCodeFor` was exported on 2026-09-10 **because this file refused to re-implement it**;
    // the export's own docblock says so. So the obstacle is gone, **and a reader who checks the
    // premise, finds it false, and deletes the subprocess as obsolete would be removing real
    // coverage while doing what looks like tidying.** `workflow.md` §12: *check whether an argument
    // was resting on what you withdrew* — and re-derive the conclusion rather than leaving it
    // propped up by a fact that has changed.
    //
    // **The two are different instruments and BOTH are kept, which is this suite's own rule about
    // two anchors answering different questions:**
    //
    //   the subprocess        does a REAL run exit with what the rule says?  It is the only thing
    //                         covering `process.exit(exitCodeFor(report))` at the CLI's last line.
    //                         Blind to any input the corpus cannot produce.
    //   `exitCodeFor` direct  is the PRECEDENCE right — refusals AND a notice, drift AND a notice,
    //                         a reconciliation mismatch? Blind to whether anything is WIRED to it.
    //
    // **Neither subsumes the other**: change the CLI's last line to `process.exit(0)` and only the
    // subprocess notices; break the precedence on an input the corpus cannot make and only the
    // constructed reports notice. A disagreement between them is a finding.
    //
    // The sentence is now written as a REASON rather than as an obstacle, deliberately. **A reason
    // survives the world changing; an obstacle becomes an argument for deletion the moment it
    // lifts.**
    //
    // **It runs `--check`, which writes nothing.** `--emit` would write into
    // `packages/contracts/generated/**`, which is `architecture-agent`'s tree.
    const generator = fileURLToPath(new URL('../../../contracts/generator/generate-types.mjs', import.meta.url));
    const cli = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' });
    const report = run({ mode: 'check' });

    console.log(
      `        generator --check: exit ${cli.status} · ${report.refusals?.length ?? 0} refusals · ` +
        `${report.population?.['modulesDrifted']} drifted · migrationNotice ` +
        `${report.migrationNotice === undefined ? 'absent' : 'present'}`,
    );

    // ---- THE FLOOR ON THE SUBPROCESS ITSELF. A command that failed to launch reports a `status` of
    // `null` and an `error`, and `null !== 3` would read as an ordinary assertion failure rather
    // than as "the tool never ran" — `workflow.md` §11a's runner that reports success by not
    // failing, in its other direction.
    assertTrue(
      `${ISOLATION} THE FLOOR: the generator actually ran (exit ${cli.status})`,
      cli.error === undefined && typeof cli.status === 'number',
      `the subprocess did not launch, so its exit code says nothing: error=${String(cli.error)} ` +
        `stderr=${JSON.stringify((cli.stderr ?? '').slice(0, 400))}`,
    );

    // ---- THE STATE THE EXIT CODE IS REPORTING, ASSERTED SEPARATELY FROM THE CODE ITSELF.
    // Without these three, `exit 3` is a number with nothing behind it: a corpus that had drifted
    // would exit 1 and this case would go red saying "the exit code is wrong" when the exit code
    // was right and the CORPUS had changed. These make the failure message tell the truth.
    assertEqual(
      `${ISOLATION} the corpus is clean — 0 refusals and 0 drifted, which is what lets 3 be reached`,
      `${report.refusals?.length ?? 0}/${report.population?.['modulesDrifted']}`,
      '0/0',
    );
    assertTrue(
      'and a phase notice IS present — exit 3 means a decision is due, not that nothing happened',
      report.migrationNotice !== undefined,
      'no phase notice, so the expected exit is 0 rather than 3. If every phase question has been ' +
        'resolved this is correct and this case is what should be updated — see the 0041 and 0039 ' +
        'cases below, which name the constants',
    );
    assertEqual(
      'and it arrives in `migrationNotice`, not `fatal` — `fatal` is read first and returns 2',
      report.fatal === undefined ? 'fatal absent' : `fatal present: ${report.fatal}`,
      'fatal absent',
    );

    // ---- THE SUBJECT.
    assertEqual(
      `${ISOLATION} \`--check\` exits 3 — a DECISION IS DUE, distinguishable from 1 and from 2`,
      cli.status,
      3,
    );

    // ===================================================================================
    // AND THE PRECEDENCE ITSELF, ON INPUTS THE REAL CORPUS CANNOT PRODUCE ON DEMAND.
    // ===================================================================================
    //
    // *** THE SUBPROCESS ABOVE PROVES ONE PATH THROUGH THE RULE. *** Today's corpus is clean with a
    // notice, so it exercises exactly the `3` arm — and **every combination that decides whether the
    // ORDER is right is one the corpus cannot be made to hold to order.** `exitCodeFor` is exported
    // precisely so these can be asserted rather than re-implemented, and calling it is what makes
    // the constructed half a check on the SHIPPED rule rather than on a copy of it.
    //
    // **ORDER IS PRECEDENCE AND CORPUS PROBLEMS WIN**, which the generator states in terms: a run
    // with refusals AND a notice exits 1, because *the migration question is not answerable over a
    // corpus that did not read.* Reporting 3 there would announce a decision is due on evidence
    // that is missing — and **that is exactly the state `index-incomplete`'s clean run sits in**,
    // which is why that fixture asserts the precedence and cannot assert the exit code.
    const constructed = (population: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      mode: 'check' as const,
      refusals: [],
      drift: [],
      warnings: [],
      population: { contractsAdmitted: 16, contractsRefused: 0, contractFilesFound: 16, modulesDrifted: 0, ...population },
      ...extra,
    });
    const NOTICE = 'a phase boundary was reached';

    for (const [label, input, expected] of [
      ['clean, no notice', constructed({}), 0],
      ['a notice and nothing wrong', constructed({}, { migrationNotice: NOTICE }), 3],
      ['drift ALONE', constructed({ modulesDrifted: 2 }), 1],
      // *** THE TWO THAT DECIDE THE ORDER. *** Each holds a condition that alone gives 3 AND one
      // that alone gives 1 or 2. If the arms were reordered, these are the only inputs that notice.
      ['drift AND a notice — the corpus wins', constructed({ modulesDrifted: 2 }, { migrationNotice: NOTICE }), 1],
      [
        'a refusal AND a notice — the corpus wins',
        { ...constructed({}, { migrationNotice: NOTICE }), refusals: [{ code: 'GEN_UNRESOLVABLE_REF', message: 'x' }] },
        1,
      ],
      [
        '`fatal` AND a notice — the tool\'s own accounting wins over both',
        constructed({}, { migrationNotice: NOTICE, fatal: 'admitted + refused != found' }),
        2,
      ],
      // A reconciliation mismatch with nothing else wrong. The corpus cannot be made to hold this:
      // it means the generator's own accounting disagrees with itself.
      ['admitted + refused != found', constructed({ contractsAdmitted: 15 }), 2],
    ] as const) {
      assertEqual(
        `${ISOLATION} precedence: ${label} -> ${expected}`,
        exitCodeFor(input as never),
        expected,
      );
    }
  });

  suite.test('BOTH PHASE CLASSIFIERS MEET THE OUTCOME THE REAL CORPUS CANNOT PRODUCE', () => {
    // ===================================================================================
    // THE TWO CASES BELOW ASSERT AN EMPTY LIST. AN EMPTY LIST IS WHAT A CLASSIFIER THAT NEVER
    // RAN ALSO PRODUCES.
    // ===================================================================================
    //
    // *** Every shape enum in the real corpus declares a policy, and every contract that declares a
    // *** class does so in a form the sweep finds. So `shape + UNDECLARED` and "a contract declaring
    // *** ONLY per-operation" have NO INSTANCE ON DISK*** — the two outcomes that decide both phase
    // conditions are exactly the two the corpus never exhibits.
    //
    // That is `workflow.md` §11a's sound-by-accident case precisely: **the property making those
    // assertions pass belongs to the INPUT, not to the classifier**, and nothing in a passing run
    // distinguishes the two. Constructed here because there is nothing to recover.

    // ---- THE ENUM CLASSIFIER, on all three outcomes at once.
    const controls = corpusEnums(CLASSIFIER_CONTROLS);
    const describe = (row: EnumNode): string =>
      `${row.constraint ? 'constraint' : 'shape'}/${row.declared ? 'declared' : 'undeclared'}`;
    assertEqual(
      `${ISOLATION} the classifier separates shape from constraint AND declared from not`,
      JSON.stringify(controls.map(describe).sort()),
      JSON.stringify(['constraint/undeclared', 'shape/declared', 'shape/undeclared']),
    );
    // THE ONE THAT MATTERS: a forgotten `enumPolicy` on a real shape must be VISIBLE to the pin the
    // `0041` case makes. If this ever returns nothing, that pin is asserting an empty list against a
    // classifier that cannot see the thing it is pinning.
    assertEqual(
      `${ISOLATION} and a SHAPE enum with no policy is reported — the input the corpus cannot supply`,
      JSON.stringify(controls.filter((row) => !row.constraint && !row.declared).map((row) => row.where)),
      JSON.stringify(['enums.schema.json#/$defs/undeclaredShape']),
    );

    // ---- THE `requestClass` SWEEP, on all three declaration forms.
    // *** THE MIDDLE ONE IS THE CONTROL WITH TEETH. *** A sweep written as `^requestClass:` alone
    // would return `operation-level-v1` as well, and the `0039` case would read as "one more
    // contract still to migrate" — permanently, quietly, and in the direction that looks cautious.
    assertEqual(
      `${ISOLATION} the sweep returns ONLY the contract declaring no class at either level`,
      JSON.stringify(contractsWithoutAnyClass(CLASSIFIER_CONTROLS)),
      JSON.stringify(['no-class-v1.contract.yaml']),
    );
  });

  suite.test('*** `0041` PHASE 2 IS NOT DUE — and the day it is, this goes red naming the constant ***', () => {
    // ===================================================================================
    // A PHASE BECOMING DUE IS A STANDING INSTRUCTION TO CHANGE CODE, AND THAT IS WHY IT IS
    // ASSERTED HERE RATHER THAN PRINTED SOMEWHERE.
    // ===================================================================================
    //
    // The condition is **corpus-wide, not emitter-wide**, and the distinction is
    // `architecture-agent`'s own catch: `enumsExamined` counts enums the emitter REACHES, and the
    // corpus's registry schemas are referenced by no contract. A trigger counting only reached enums
    // would have announced a complete migration over a corpus it never saw.
    //
    // *** AND THE CONDITION IS NOW REACHABLE, WHICH IT WAS NOT WHEN THIS CASE WAS WRITTEN. ***
    // `enumsExamined` is incremented inside `renderType`, so it has never counted an enum in a
    // predicate position. `enumsInCorpus` counted every `enum` node anywhere — so
    // `enumsExamined === enumsInCorpus` required the corpus to hold ZERO predicate enums, it held
    // one, and the "phase 2 is due" arm could not fire however much migrating anyone did. **That
    // was the second unreachable trigger in this file in one day**, and `countCorpusShapes` now
    // splits the two, so the gap is the referencing gap alone and it can close.
    const enums = corpusEnums();
    const shape = enums.filter((entry) => !entry.constraint);
    const constraint = enums.filter((entry) => entry.constraint);
    const shapeUndeclared = shape.filter((entry) => !entry.declared);
    const population = run({ mode: 'check' }).population ?? {};

    console.log(
      `        0041 enum policy: ${enums.length} corpus enum nodes · ${shape.length} shape ` +
        `(${shape.length - shapeUndeclared.length} declared) · ${constraint.length} constraint ` +
        `(${constraint.filter((e) => e.declared).length} declared) · emitter reached ` +
        `${population['enumsExamined']} of ${population['enumsInCorpus']}`,
    );

    // ---- THE FLOOR. A walk that found no enums declares a perfect migration.
    assertTrue(
      `${ISOLATION} THE FLOOR: the corpus walk found enums at all (${enums.length})`,
      enums.length > 20,
      'a walk that finds nothing satisfies every condition below vacuously — the count is asserted ' +
        'against a floor rather than trusted',
    );
    // ---- TWO INDEPENDENT CLASSIFIERS, COMPARED LIKE WITH LIKE.
    //
    // *** THIS ASSERTION WENT RED ON A CORRECT CHANGE, WHICH IS WHAT IT IS FOR, AND THE HISTORY IS
    // *** KEPT BECAUSE IT IS THE POINT. *** It first compared this walk's TOTAL against
    // `enumsInCorpus` — 39 against 39 — and both counted every `enum` node anywhere. Within minutes
    // of the finding being reported, `countCorpusShapes` grew the same split this file already made:
    // `enumsInCorpus` became 38 SHAPE enums and `constraintEnumsInCorpus` 1. The case read
    // `expected 38, actual 39` and named a real change rather than a defect.
    //
    // **The comparison is now per-CLASS rather than on a total, which is strictly stronger**: two
    // totals can agree while the split disagrees, and the split is the thing that decides the phase.
    //
    // *** AND THE TWO KEYWORD LISTS ARE NOT THE SAME LIST, DELIBERATELY. *** The generator's
    // `NON_RENDERING_KEYWORDS` is `not`/`if`/`then`/`else`; this file's adds `propertyNames` and
    // `contains`. **Mine is a strict superset, so agreement today is a real result and a
    // disagreement tomorrow is a finding rather than a bug in either**: it would mean an `enum`
    // landed under `propertyNames` or `contains`, which the generator would count as a SHAPE enum
    // owing a policy while `renderType` never reaches it — re-blocking the phase condition
    // silently, which is the exact defect this whole pass exists to remove. **Route it, do not
    // reconcile the lists by copying one into the other.**
    assertEqual(
      `${ISOLATION} both classifiers agree on the split — ${shape.length} shape, ${constraint.length} constraint`,
      `shape=${shape.length} constraint=${constraint.length}`,
      `shape=${population['enumsInCorpus']} constraint=${population['constraintEnumsInCorpus']}`,
    );

    // ---- THE CONDITION. Not due, and the residual is named rather than counted.
    //
    // *** THE PIN IS ON THE SHAPE ENUMS, AND THAT CHOICE IS THE WHOLE CASE. *** A pin on the RAW
    // corpus count could never reach zero while one enum sits under `if`/`not` — a negated
    // constraint that is not a type and that nothing renders. Pinning the raw number would have been
    // a trigger that cannot fire, which is the defect this file replaces, rebuilt inside a test.
    // The generator has since drawn the same line; this pin was on the right side of it first and
    // is unchanged by that.
    assertEqual(
      `${ISOLATION} every SHAPE enum in the corpus declares an \`enumPolicy\` — ${shape.length} of ${shape.length}`,
      JSON.stringify(shapeUndeclared.map((entry) => entry.where)),
      '[]',
    );

    // *** THIS IS THE ASSERTION THAT GOES RED WHEN THE PHASE BECOMES DUE. ***
    // It is written as an inequality against the emitter's reach because that is the condition
    // `architecture-agent` gated the phase on, and it is the one still unmet.
    assertTrue(
      `${ISOLATION} PHASE 2 IS NOT DUE: the emitter has reached ${population['enumsExamined']} of ${population['enumsInCorpus']} corpus enums`,
      Number(population['enumsExamined']) < Number(population['enumsInCorpus']),
      'THE EMITTER HAS NOW REACHED EVERY ENUM IN THE CORPUS AND EVERY SHAPE ENUM DECLARES A ' +
        'POLICY. **PHASE 2 OF docs/decisions/0041 IS DUE.** Set `ENUM_POLICY_REQUIRED` to true in ' +
        'packages/contracts/generator/generate-types.mjs so an undeclared enum becomes a REFUSAL ' +
        'rather than a warning, then update this case to assert the new state. THIS IS A ' +
        'DELIBERATE STOP, NOT A DEFECT — do not delete the case to make it green. ' +
        `population=${JSON.stringify(population)}`,
    );

    // ---- THE EXCLUDED POPULATION, PINNED SO IT CANNOT GROW IN SILENCE.
    //
    // These are the enums BOTH classifiers now exclude from the phase condition, and an exclusion is
    // the highest-suspicion thing in any check (`workflow.md` §11a: *a proposal to make a check skip
    // something always arrives as tidying*). It is correct here — nothing renders a negated
    // conditional, so no policy on one could mean anything — **and the way a correct exclusion turns
    // into a hole is by quietly widening.** Every enum that lands in this bucket is an enum nobody
    // will ever be asked to declare a policy for.
    //
    // *** THE COUNT IS PINNED AND THE IDENTITY IS NOT, DELIBERATELY. *** A node moving inside
    // `app-manifest.schema.json` changes nothing, and pinning its JSON pointer would go red on a
    // harmless restructure of another agent's file — the kind of red that gets a case deleted.
    // **A second one appearing DOES change something, and that is what this catches.** The
    // locations are printed so composition stays visible to a reader.
    assertEqual(
      `${ISOLATION} the enums BOTH classifiers exclude are still exactly 1 — an exclusion that grows is a hole`,
      `${constraint.length}`,
      '1',
    );
    console.log(`        0041 excluded from the condition: ${constraint.map((entry) => entry.where).join(', ')}`);
  });

  suite.test('*** `0039` PHASE 3 IS NOT DUE — and the day it is, this goes red naming the constant ***', () => {
    // ===================================================================================
    // THIS REPLACES A TRIGGER THAT COULD NEVER HAVE FIRED.
    // ===================================================================================
    //
    // The generator gated phase 3 on `scripts/check-request-class.mjs` being *wired into the root
    // `test` script*, and decided that by searching the script for the FILENAME when the script can
    // only contain the npm script NAME. `-` against `:`. Its "phase 3 is due" arm had never executed
    // in any run by anyone, and an unreachable branch and an unmet condition look identical.
    const population = run({ mode: 'check' }).population ?? {};
    const declaring = Number(population['contractsDeclaringRequestClass']);
    const lacking = Number(population['contractsLackingRequestClass']);
    const publishingNothing = Number(population['contractsPublishingNoOperations']);
    const total = Number(population['contractFilesFound']);
    const noClassAnywhere = contractsWithoutAnyClass();

    console.log(
      `        0039 requestClass: ${declaring} declaring · ${lacking} lacking · ` +
        `${publishingNothing} publishing no operations · ${total} contracts`,
    );

    // ---- THE POPULATION RECONCILES, WHICH IS A STRONGER STATEMENT THAN ANY OF ITS PARTS.
    // *** A CONTRACT IN NONE OF THE THREE BUCKETS WOULD BE INVISIBLE TO THIS CASE. *** The third
    // bucket is the one that is easy to forget: a contract publishing no operations declares no
    // class and is not LACKING one, and folding it into either side would make the phase condition
    // permanently unsatisfiable or falsely satisfiable depending on which.
    assertEqual(
      `${ISOLATION} the three buckets account for every contract — ${declaring} + ${lacking} + ${publishingNothing}`,
      `${declaring + lacking + publishingNothing}`,
      `${total}`,
    );

    // ---- AN INDEPENDENT DERIVATION, BY A MECHANISM THAT KNOWS NOTHING ABOUT OPERATIONS.
    // A textual sweep cannot tell a contract that publishes nothing from one that forgot the field;
    // it finds both. So it must equal `lacking + publishingNothing`, and that identity is what makes
    // the generator's split checkable from outside it.
    assertEqual(
      'and a textual sweep finds exactly the lacking ones plus the one publishing nothing',
      `${noClassAnywhere.length}`,
      `${lacking + publishingNothing}`,
    );
    assertTrue(
      `${ISOLATION} THE FLOOR: the sweep read contracts at all (${noClassAnywhere.length} of ${total})`,
      total > 10,
      `a sweep that found no contracts would satisfy the identity above at 0 = 0: ${JSON.stringify(population)}`,
    );

    // *** THE ASSERTION THAT GOES RED WHEN THE PHASE BECOMES DUE. ***
    assertTrue(
      `${ISOLATION} PHASE 3 IS NOT DUE: ${lacking} publishing contract(s) still declare no \`requestClass:\``,
      lacking > 0,
      'EVERY PUBLISHING CONTRACT NOW DECLARES `requestClass:`. **PHASE 3 OF docs/decisions/0039 IS ' +
        'DUE.** Set `REQUEST_CLASS_REQUIRED` to true in ' +
        'packages/contracts/generator/generate-types.mjs and delete the block-key fallback in ' +
        '`admitContract`, then update this case to assert the new state. THIS IS A DELIBERATE STOP, ' +
        'NOT A DEFECT — do not delete the case to make it green. ' +
        `contracts still lacking: ${JSON.stringify(noClassAnywhere)}`,
    );
  });

  return suite;
}
