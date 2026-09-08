/**
 * ===========================================================================================
 * A KEY THAT LANDED INSIDE A BLOCK SCALAR. The one contract defect nothing here can otherwise see.
 * ===========================================================================================
 *
 * `architecture-agent` authors every contract in `packages/contracts/**` and **cannot run a
 * parser** — Bash is not in its toolset. Nothing in this repository parses YAML, and nothing
 * executes JSON Schema. So the entire contract set is verified by eye, **by its author**, which is
 * the arrangement `0004`'s separation exists to prevent, arriving through tooling rather than
 * through ownership.
 *
 * The failure this catches is silent in the worst way: **a key that lands inside a block scalar is
 * swallowed into prose.** The author believes a field is declared; it is not; nothing else in the
 * repository would notice, because no validator runs.
 *
 * ===========================================================================================
 * *** READ THIS BEFORE TRUSTING A GREEN RUN: IT HAS NEVER FOUND A REAL DEFECT. ***
 * ===========================================================================================
 *
 * `architecture-agent` reported three slips this week, all self-caught on re-read, and the brief
 * for this file said to recover them from git history as real known-failing inputs. **They are not
 * there.** Swept 2026-09-08:
 *
 *   182 commits · 2,326 contract-file revisions · ZERO instances of this defect, ever.
 *   The mirror rule — a real key at an indentation matching no open level — also found ZERO.
 *
 * **All three were caught and fixed before they were committed.** So this check ships green, its
 * value is prospective rather than demonstrated, and **its known-failing inputs are CONSTRUCTED
 * rather than historical** — which is weaker evidence, and is stated here rather than left for a
 * reader to assume otherwise.
 *
 * ===========================================================================================
 * WHY ONLY THE UNAMBIGUOUS SHAPE FAILS THE BUILD
 * ===========================================================================================
 *
 * **HALF THIS CORPUS IS PROSE.** 16,212 lines, of which 8,179 sit inside 1,331 block scalars. So a
 * line-level rule over it is dominated by English, and the discriminator is everything:
 *
 *   `key: >-` or `key: |` INSIDE a scalar   **PROSE CANNOT PRODUCE THIS.** A sentence does not end
 *                                           in a block-scalar marker. Zero hits in 2,326
 *                                           revisions. **This fails the build.**
 *
 *   a bare `word:` INSIDE a scalar          A wrapped sentence ending in a colon looks exactly
 *                                           like this. Measured over 2,326 revisions: **one hit,
 *                                           and it is prose.** Reported and allow-listed, never
 *                                           failed on, because a check that is red on day one for
 *                                           a non-defect earns a permanent suppression.
 *
 * That split is the same one `check-source-bytes.mjs` makes between a NUL and a DEL, for the same
 * reason: **a checker that reports everything at one severity gets turned off by whoever is
 * triaging under time pressure.**
 *
 * ===========================================================================================
 * WHAT THIS CANNOT SEE. IT IS A LINE SCANNER, NOT A PARSER.
 * ===========================================================================================
 *
 * **A green run here does not mean the contracts are valid.** Not in scope, and no amount of
 * passing changes it:
 *
 *   - a key duplicated at the same level — YAML keeps the last, silently
 *   - a wrong type, a missing required field, a `$ref` to nothing
 *   - anything inside a flow collection: `[a, b]` and `{a: 1}` are opaque to this
 *   - whether the JSON Schema beside the contract agrees with it
 *
 * **The forms it cannot model at all are detected and FAIL rather than pass** — see
 * `unmodelledForms`. A scanner that meets a construction it does not implement must say so; the
 * alternative is the defect this repository already had once, where a check matched only block-form
 * YAML and was correct because of a property of the file rather than of the check.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));

export type ScalarFinding = {
  readonly line: number;
  readonly text: string;
  /**
   * `opener` — unambiguous; prose does not end a line in `>-`.
   * `consecutivePair` — two or more key-shaped lines in a row at one indent. **This is the class a
   *   parser cannot catch**, and the measurement below is what makes it usable.
   * `keyShaped` — a single bare `word:`, which a wrapped sentence also produces.
   */
  readonly kind: 'opener' | 'consecutivePair' | 'keyShaped';
};

export type ScanResult = {
  readonly lines: number;
  readonly scalarsEntered: number;
  readonly scalarLines: number;
  readonly findings: readonly ScalarFinding[];
  /** Constructions this scanner does not implement. Non-empty means the result is not trustworthy. */
  readonly unmodelled: readonly string[];
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** A key line whose value is a block scalar: `name: >-`, `name: |`, and the list-item form. */
const OPENER = /^\s*(?:- )?[A-Za-z_][A-Za-z0-9_.-]*:[ \t]*[|>][-+]?[ \t]*$/;

/**
 * A line that looks like a key.
 *
 * ANCHORED END TO END ON PURPOSE. `foo:` matches; `and it was incomplete:` does not, because prose
 * has words before the colon. That anchoring is the only thing keeping this usable over a corpus
 * that is half English.
 */
const KEY_SHAPED = /^\s*[A-Za-z][A-Za-z0-9_]*:[ \t]*(?:[|>][-+]?)?[ \t]*$/;

/**
 * A key WITH an inline value — `status: APPLIED` — which is the shape of the dangerous class.
 *
 * ===========================================================================================
 * *** ON ITS OWN THIS IS UNUSABLE, AND THE NUMBER IS WHY. ***
 * ===========================================================================================
 *
 * Measured 2026-09-08 over the whole corpus: **74 lines inside block scalars match it, and every
 * one is prose** — `RECOMMENDED: B. It changes nothing…`, `WHY: after a purge there is nothing
 * left…`, `policy: archived customers retained indefinitely…`. This contract set writes English
 * that is character-for-character the shape of a YAML mapping, so a rule built on this alone is 74
 * false positives and, on the recorded history, zero true ones.
 *
 * **THE DISCRIMINATOR IS ADJACENCY.** A swallowed mapping is two or more of these in a row at one
 * indent; a wrapped sentence is one. That takes 74 to **2**, and the two are a single argued block.
 */
const KEY_WITH_VALUE = /^\s*[A-Za-z][A-Za-z0-9_]*:([ \t]+\S|[ \t]*$)/;

/**
 * Every construction this scanner cannot reason about.
 *
 * NOT "every construction it does not handle perfectly" — every one where its answer would be
 * MEANINGLESS rather than approximate. A tab makes `indentOf` incomparable between lines; an
 * explicit indentation indicator moves the scalar's content boundary somewhere this does not look;
 * a second document restarts the indentation context entirely.
 */
export function unmodelledForms(text: string): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  if (lines.some((line) => line.includes('\t'))) {
    found.push('a TAB character — indentation is not comparable between lines');
  }
  if (lines.some((line) => /:[ \t]*[|>][-+]?\d/.test(line))) {
    found.push('an explicit block-scalar indentation indicator (`|2`) — the content boundary moves');
  }
  if (lines.filter((line) => /^---\s*$/.test(line)).length > 1) {
    found.push('more than one document (`---`) — the indentation context restarts');
  }
  return found;
}

/** Every key-shaped line sitting inside a block scalar, with the population it was drawn from. */
export function scanBlockScalars(text: string): ScanResult {
  const lines = text.split('\n');
  const findings: ScalarFinding[] = [];
  /** Which lines sit inside a block scalar — needed for the adjacency pass below. */
  const inside: boolean[] = new Array(lines.length).fill(false);
  let scalarsEntered = 0;
  let scalarLines = 0;
  let inScalar = false;
  let openerIndent = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (inScalar) {
      // A BLANK LINE DOES NOT CLOSE A BLOCK SCALAR. Treating it as a terminator would end every
      // scalar at its first paragraph break and silently halve the population examined — the
      // "found half" failure, which reads exactly like success.
      if (line.trim() === '') {
        scalarLines += 1;
        continue;
      }
      if (indentOf(line) > openerIndent) {
        scalarLines += 1;
        inside[index] = true;
        if (KEY_SHAPED.test(line)) {
          findings.push({
            line: index + 1,
            text: line,
            kind: OPENER.test(line) ? 'opener' : 'keyShaped',
          });
        }
        continue;
      }
      inScalar = false;
    }
    if (OPENER.test(line)) {
      inScalar = true;
      openerIndent = indentOf(line);
      scalarsEntered += 1;
    }
  }

  // =========================================================================================
  // THE ADJACENCY PASS — THE DANGEROUS CLASS, AND THE ONE NO PARSER CATCHES.
  // =========================================================================================
  //
  // A key pair indented into a block scalar's content is **valid YAML with the wrong meaning**:
  // the document loads, every validator passes, and the fields simply cease to exist. `0034`'s
  // sibling failure. A grammar cannot object, because by the grammar nothing is wrong — so this
  // asks the question the grammar does not: *is this mapping-shaped text inside something that
  // swallows it?*
  //
  // ADJACENCY IS WHAT MAKES IT USABLE. One `word: value` line is a wrapped sentence, 74 times over
  // in this corpus. Two in a row at the same indent is a mapping.
  for (let index = 0; index < lines.length; index += 1) {
    if (!inside[index] || !KEY_WITH_VALUE.test(lines[index]!)) {
      continue;
    }
    const indent = indentOf(lines[index]!);
    const neighbour = (offset: number): boolean => {
      const other = lines[index + offset];
      return (
        other !== undefined &&
        inside[index + offset] === true &&
        KEY_WITH_VALUE.test(other) &&
        indentOf(other) === indent
      );
    };
    if (neighbour(-1) || neighbour(1)) {
      findings.push({ line: index + 1, text: lines[index]!, kind: 'consecutivePair' });
    }
  }

  return {
    lines: lines.length,
    scalarsEntered,
    scalarLines,
    findings: findings.sort((a, b) => a.line - b.line),
    unmodelled: unmodelledForms(text),
  };
}

function contractFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${path}/`);
      } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        found.push(path);
      }
    }
  };
  walk(CONTRACTS);
  return found.sort();
}

/**
 * The one `keyShaped` hit in the corpus, argued rather than suppressed.
 *
 * Present in 168 of the 2,326 revisions swept and in the tree today. It is a sentence — *"the
 * earlier revision of this block enumerated three and was incomplete:"* — whose last word wrapped
 * onto its own line. **The colon introduces the list that follows.**
 *
 * A NEW ENTRY HERE IS A DECISION, NOT A FIX. The right response to a new soft hit is to read it and
 * either rewrite the prose or record why it is prose, which is what this map is.
 */
const ARGUED_PROSE: ReadonlyMap<string, string> = new Map([
  [
    'apps/customers/customer-directory-v1.contract.yaml:incomplete:',
    'the last word of a wrapped sentence; the colon introduces the list of four denial paths below it',
  ],
]);

export function buildContractYamlStructureSuite(): Suite {
  const suite = new Suite('Contracts — no key is swallowed by a block scalar');

  suite.test('THE POPULATION, against an independently derived expectation', () => {
    // A COUNT WITH NOTHING TO COMPARE AGAINST IS A NUMBER, NOT A CHECK. The file count is derived
    // from the directory walk; the scalar count is asserted against a floor that a human has to
    // move deliberately, so a walk that quietly stopped descending reads as a failure rather than
    // as a smaller corpus.
    const files = contractFiles();
    assertTrue(
      'the contract directory was walked and yielded files',
      files.length >= 15,
      `only ${String(files.length)} contract YAML files were found. This set had 18 on 2026-09-08; ` +
        'a smaller number means the walk stopped descending, not that contracts were deleted',
    );

    let lines = 0;
    let scalars = 0;
    let scalarLines = 0;
    for (const file of files) {
      const result = scanBlockScalars(readFileSync(file, 'utf8'));
      lines += result.lines;
      scalars += result.scalarsEntered;
      scalarLines += result.scalarLines;
    }
    console.log(
      `        contracts: ${String(files.length)} files · ${String(lines)} lines · ` +
        `${String(scalars)} block scalars · ${String(scalarLines)} lines inside them`,
    );

    // THE FLOOR THAT MATTERS. If `scalarsEntered` collapsed, every finding below would be drawn
    // from an empty population and would report success.
    assertTrue(
      `${ISOLATION} block scalars were actually entered`,
      scalars >= 800,
      `only ${String(scalars)} block scalars were entered; there were 1,331 on 2026-09-08. The ` +
        'opener pattern has probably stopped matching, which would make every assertion below ' +
        'vacuous while looking clean',
    );
    assertTrue(
      'and a substantial share of the corpus is inside them',
      scalarLines > lines / 4,
      `${String(scalarLines)} of ${String(lines)} lines are inside block scalars. Roughly half is ` +
        'expected; far less means scalar tracking is ending early, which would hide findings',
    );
  });

  suite.test('*** NO BLOCK-SCALAR OPENER APPEARS INSIDE A BLOCK SCALAR ***', () => {
    // THE UNAMBIGUOUS SHAPE. Prose does not end a line in `>-` or `|`, so this has no innocent
    // explanation: it is a key the author believed was a key, sitting where YAML will read it as
    // English. Zero instances across 2,326 historical revisions.
    const reported: string[] = [];
    for (const file of contractFiles()) {
      for (const finding of scanBlockScalars(readFileSync(file, 'utf8')).findings) {
        if (finding.kind === 'opener') {
          reported.push(`${file.slice(CONTRACTS.length)}:${String(finding.line)} ${finding.text.trim()}`);
        }
      }
    }
    assertEqual(
      `${ISOLATION} no contract declares a key inside a block scalar`,
      reported.join(' · '),
      '',
    );
  });

  suite.test('the soft shape is REPORTED and ARGUED, never silently tolerated', () => {
    // Bare `word:` lines. A wrapped sentence produces this, so it cannot fail the build — but an
    // unexamined one cannot be waved through either, or the map becomes a suppression list.
    const unargued: string[] = [];
    let total = 0;
    for (const file of contractFiles()) {
      const relative = file.slice(CONTRACTS.length);
      for (const finding of scanBlockScalars(readFileSync(file, 'utf8')).findings) {
        if (finding.kind !== 'keyShaped') {
          continue;
        }
        total += 1;
        const key = `${relative}:${finding.text.trim()}`;
        if (!ARGUED_PROSE.has(key)) {
          unargued.push(`${relative}:${String(finding.line)}  ${finding.text.trim()}`);
        }
      }
    }
    console.log(`        soft hits: ${String(total)}, of which argued: ${String(total - unargued.length)}`);
    assertEqual(
      'every key-shaped line inside a block scalar is either a defect or an argued piece of prose',
      unargued.join(' · '),
      '',
    );
    // AND THE MIRROR: the argued entry is still there. An allow-list whose entries have gone stale
    // is a list nobody is reading, and it would silently start tolerating a different line.
    assertEqual(
      'the argued entry is still present, so the map is not describing a corpus that moved',
      String(total),
      String(ARGUED_PROSE.size),
    );
  });

  suite.test('FORMS THIS SCANNER DOES NOT MODEL FAIL LOUDLY RATHER THAN PASS SILENTLY', () => {
    // ===================================================================================
    // THE "MATCHED ONLY BLOCK-FORM" DEFECT, PRE-EMPTED. This repository has already had a check
    // that was correct because of a property of the file rather than of the check — it matched
    // block-form YAML at four spaces, and every entry happened to be written that way.
    // ===================================================================================
    const met: string[] = [];
    for (const file of contractFiles()) {
      for (const form of unmodelledForms(readFileSync(file, 'utf8'))) {
        met.push(`${file.slice(CONTRACTS.length)}: ${form}`);
      }
    }
    assertEqual(
      `${ISOLATION} the corpus contains no construction this scanner cannot reason about`,
      met.join(' · '),
      '',
    );

    // AND THE DETECTOR IS SHOWN TO WORK, or the emptiness above means it stopped looking.
    assertEqual(
      'a tab is detected',
      unmodelledForms('a:\n\tb: 1\n').length,
      1,
    );
    assertEqual(
      'an explicit indentation indicator is detected',
      unmodelledForms('a: |2\n   x\n').length,
      1,
    );
    assertEqual(
      'a second document is detected',
      unmodelledForms('---\na: 1\n---\nb: 2\n').length,
      1,
    );
    assertEqual(
      'and an ordinary single-document file is NOT flagged',
      unmodelledForms('---\na: >-\n  text\n').length,
      0,
    );
  });

  suite.test('THE SCANNER\'S OWN FAILING INPUTS — constructed, because history has none', () => {
    // ===================================================================================
    // *** THESE ARE INVENTED AND THAT IS A WEAKNESS WORTH NAMING. ***
    // ===================================================================================
    //
    // The brief for this file expected the three reported slips to be recoverable from git as real
    // defects. A sweep of 2,326 contract-file revisions found none: all three were caught before
    // they were committed. **So these inputs are my model of the defect rather than the defect**,
    // and if the real shape differs from my model, this suite would be green about the wrong thing.
    const NUL_HAZARD = 'the defect, verbatim: a key indented one level too deep';
    const swallowed =
      'request:\n' +
      '  description: >-\n' +
      '    Some prose that runs on for a while and then, one level too deep, this:\n' +
      '    swallowed: >-\n' +
      '      and everything under here is English as far as YAML is concerned\n';
    const scan = scanBlockScalars(swallowed);
    assertTrue(
      `${ISOLATION} ${NUL_HAZARD} is reported as an OPENER`,
      scan.findings.some((finding) => finding.kind === 'opener' && finding.text.includes('swallowed')),
      `the scanner did not flag a block-scalar opener inside a block scalar: ${JSON.stringify(scan.findings)}`,
    );

    // A BARE KEY INSIDE A SCALAR — the soft shape, which must be found but classified differently.
    const bare = 'a: >-\n  prose\n  swallowed:\n    more prose\n';
    const bareScan = scanBlockScalars(bare);
    assertEqual(
      'a bare key inside a scalar is found and classified as soft',
      bareScan.findings.map((finding) => finding.kind).join(','),
      'keyShaped',
    );

    // ---- AND THE MIRRORS, so it is not simply flagging everything. ----
    assertEqual(
      'a sentence ending in a colon is NOT flagged',
      scanBlockScalars('a: >-\n  and the earlier revision was incomplete, as follows:\n  more\n').findings.length,
      0,
    );
    assertEqual(
      'a key that correctly DEDENTS out of the scalar is NOT flagged',
      scanBlockScalars('a: >-\n  prose\nb: 1\n').findings.length,
      0,
    );
    assertEqual(
      'a key at the scalar opener\'s own indentation is NOT flagged — it has closed the scalar',
      scanBlockScalars('root:\n  a: >-\n    prose\n  b: 1\n').findings.length,
      0,
    );
    // A BLANK LINE MUST NOT CLOSE THE SCALAR. If it did, the defect below would sit "outside" the
    // scalar and go unreported — and the population count would silently halve.
    assertTrue(
      'a blank line does not end the scalar, so a defect after one is still found',
      scanBlockScalars('a: >-\n  prose\n\n  swallowed: >-\n    more\n').findings.length === 1,
      'a blank line terminated the scalar, which would hide every finding after the first ' +
        'paragraph break in a corpus written in paragraphs',
    );
  });

  return suite;
}
