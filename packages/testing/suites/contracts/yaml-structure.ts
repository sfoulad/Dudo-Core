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
 * **HALF THIS CORPUS IS PROSE.** 16,375 lines, of which 8,244 sit inside 1,339 block scalars. So a
 * line-level rule over it is dominated by English, and the discriminator is everything:
 *
 * **EVERY FIGURE IN THIS FILE IS A DATED MEASUREMENT OF A LIVE CORPUS, NOT A CONSTANT.**
 * `architecture-agent` edits `packages/contracts/**` continuously — the line count moved by 86
 * during a single verification run on 2026-09-08. The numbers in the assertion messages below are
 * **floor references a human must move deliberately**, which is their whole purpose; do not read
 * one as a current count, and do not tighten a floor to whatever today's run happens to print.
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
 *   - a closing line landing between two OUTER levels — column 3 where 0, 2 and 4 are open. Also
 *     a parse error; not flagged, because `dedentToNoLevel` tracks one scalar rather than the
 *     whole indentation stack, and is one-sided on purpose. See its own note.
 *
 * ===========================================================================================
 * THREE CLASSES, AND THE THIRD SHIPS GREEN BY DESIGN
 * ===========================================================================================
 *
 *   `opener`           a block-scalar marker inside a scalar        0 in the corpus   FAILS
 *   `consecutivePair`  a key pair swallowed by a scalar             2, both argued    FAILS
 *   `dedentToNoLevel`  a closing line at an impossible column       0 of 1,335        FAILS
 *   `keyShaped`        a bare `word:`, which prose also produces    1, argued         reported
 *
 * ===========================================================================================
 * *** `consecutivePair` HAS GONE RED ON A REAL FILE EXACTLY ONCE, AND THAT FILE HAS MOVED OUT
 * *** OF THE CORPUS. A DELIBERATE ACCEPTANCE, NOT AN OMISSION.
 * ===========================================================================================
 *
 * **Be precise about what was lost, because the loose version of this sentence is wrong.** The
 * rule fires on **two real corpus lines every single run** — the argued HTTP header block in
 * `organization-selection-v1`. What it has done exactly once is go **RED**, on an *unargued* hit:
 * `architecture-agent`'s drift fixture, which carried three lines of prose deliberately shaped
 * like a swallowed key pair to trap a different tool's scanner.
 *
 * **That fixture moved to `packages/testing/fixtures/contract-generator/` on 2026-09-09, which
 * this walk does not reach**, and the move was right: a checker tripping over another tool's
 * deliberate trap is a collision, and **re-reaching for it under a wider glob would reintroduce
 * the collision under a different name.** The boundary below is the same decision.
 *
 * **WHAT THE ACCEPTANCE COSTS, in the terms that matter:** a constructed fixture **guards the
 * known**; a real instance is the thing that could have surfaced the **unknown**. **We keep the
 * first and lose the second.** That is acceptable here for one reason only — **a fixture's shapes
 * were never representative of published contracts**, which is the same reason it did not belong
 * in the corpus. It is not acceptable as a general trade.
 *
 * **So from here the RED path of this rule is verified by constructed inputs alone.** Said plainly
 * because a rule that has never failed on real input reads as dead code to whoever meets it next,
 * and this header is the only place that can record that it fired once, on a file that left for a
 * good reason.
 *
 * **`dedentToNoLevel` FINDS NOTHING TODAY AND THAT IS THE EXPECTED STATE, NOT DEAD CODE.** It is
 * the one class a YAML parser would ordinarily own — but nothing in this repository runs a
 * parser, so "a parser would catch it" names a tool that does not exist here. Its known-failing
 * inputs are constructed and every mirror is checked against PyYAML 6.0.3, and it reports the
 * population it examined against an expectation derived from a different counter, so that a
 * clean corpus and a branch that stopped executing do not print the same zero.
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
   * `dedentToNoLevel` — a line closing a block scalar at a column no open level sits at. **The one
   *   class here that a parser WOULD catch** — see `DEDENT_TO_NO_LEVEL` for why it is still ours.
   */
  readonly kind: 'opener' | 'consecutivePair' | 'keyShaped' | 'dedentToNoLevel';
};

export type ScanResult = {
  readonly lines: number;
  readonly scalarsEntered: number;
  readonly scalarLines: number;
  /**
   * Scalar-closing lines examined — **the population the `dedentToNoLevel` rule is drawn from.**
   * It finds nothing on this corpus, so without this number a run that examined 1,335 closing
   * lines and a run whose closing branch stopped executing entirely would print the same green.
   */
  readonly closingLines: number;
  /** Scalars still open at end of file — at most one per file, and the other half of the identity. */
  readonly scalarsClosedAtEof: number;
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

/**
 * ===========================================================================================
 * `dedentToNoLevel` — THE ONE CLASS HERE A PARSER WOULD CATCH, AND WHY IT IS STILL OURS.
 * ===========================================================================================
 *
 * A line that closes a block scalar must land on a column some open level already sits at. The
 * innermost such column is the block-scalar KEY's own, so **a closing line indented deeper than
 * its own key matches no open level and the document does not parse.** That is the shape a
 * wrapped key produces:
 *
 *     theRuling: >-
 *         prose that runs on
 *       aKeyThatWrapped,          ← column 2. `theRuling` is at 0, content is at 4. No level here.
 *
 * **This is a parse error, and normally that would make it a parser's job rather than this
 * file's. Nothing in this repository runs a parser** — no YAML library, no JSON Schema validator
 * — so "a parser would catch it" describes a tool that does not exist here. It is caught by this
 * or by nobody.
 *
 * *** IT SHIPS WITH ZERO FINDINGS, AND THAT IS THE EXPECTED STATE, NOT A SIGN OF DEAD CODE. ***
 * The corpus is clean: 0 of 1,335 closing lines, measured 2026-09-08. Its known-failing inputs
 * are constructed, exactly as the rest of this file's are, and the population it examined is
 * reported against an independent expectation — because a rule that finds nothing and a rule
 * whose branch stopped executing print the same green.
 *
 * TWO DELIBERATE ONE-SIDED CHOICES, so that everything it flags is genuinely impossible:
 *
 *   - **The list-item form shifts the key's column.** `indentOf('- a: >-')` is the DASH's column,
 *     but the key sits two further in, and its siblings sit with it. Comparing against the dash
 *     would flag every one of them. PyYAML loads that document fine.
 *   - **A COMMENT MAY SIT AT ANY COLUMN.** Measured: `a: >-` / four-space content /
 *     `  # comment` / `b: 1` parses cleanly, so a comment line is skipped rather than judged.
 *     It is not treated as a terminator either — a comment below the content column followed by
 *     content at it is a parse error, so there is no valid continuation to lose, and skipping
 *     keeps a swallowed opener AFTER a comment findable.
 *
 * WHAT IT DOES NOT CATCH, and it is one-sided by construction: a closing line landing between two
 * OUTER levels — column 3 where 0, 2 and 4 are open — is also a parse error and is NOT flagged,
 * because this tracks one scalar rather than the whole indentation stack. A false negative here
 * is a parser's ordinary error message; a false positive would fail the build on a correct
 * contract, which is the trade this whole file is written around.
 *
 * ONE ACCOUNTING EFFECT, MEASURED AND BENIGN. Skipping comments moved `scalarLines` from 8,241 to
 * 8,244: three blank lines sitting between top-level comment blocks now fall inside a scalar that
 * a comment used to close. **Content lines inside scalars are unchanged at 7,986 and no finding
 * moved** — checked line by line rather than inferred from the totals, because a three-line drift
 * in a counter is exactly the size of thing that gets waved through.
 */
const COMMENT_LINE = /^[ \t]*#/;

/** Every key-shaped line sitting inside a block scalar, with the population it was drawn from. */
export function scanBlockScalars(text: string): ScanResult {
  const lines = text.split('\n');
  const findings: ScalarFinding[] = [];
  /** Which lines sit inside a block scalar — needed for the adjacency pass below. */
  const inside: boolean[] = new Array(lines.length).fill(false);
  let scalarsEntered = 0;
  let scalarLines = 0;
  let closingLines = 0;
  let inScalar = false;
  let openerIndent = 0;
  /**
   * The column the block-scalar KEY sits at, which is the innermost open level and is NOT
   * `openerIndent` for the list-item form. See `dedentToNoLevel` above.
   */
  let keyIndent = 0;
  /**
   * The column the scalar's content actually begins at, or -1 until its first non-empty line
   * establishes it.
   *
   * =========================================================================================
   * *** `indentOf(line) > openerIndent` IS NOT THE YAML RULE, AND THE LIST-ITEM FORM IS WHERE
   * *** IT PRODUCES A FALSE POSITIVE ON A VALID DOCUMENT.
   * =========================================================================================
   *
   * A block scalar's content indentation is fixed by its FIRST non-empty content line, and any
   * later line above that column has closed the scalar. `OPENER` deliberately admits the
   * list-item form `- name: >-`, whose `indentOf` is the column of the DASH — so every sibling
   * key of that mapping sits at `openerIndent + 2`, which is `> openerIndent` and was therefore
   * being read as scalar content:
   *
   *     - theRuling: >-
   *         A sentence of prose introducing two rulings.
   *       whenItApplies: on every filtered request      ← real key, reported as swallowed
   *       whatItRefuses: a request with no window       ← real key, reported as swallowed
   *
   * PyYAML 6.0.3 loads that as three keys of one mapping. The shipped rule reported the last two
   * as a `consecutivePair` and would have FAILED THE BUILD on a correct contract — the precision
   * failure this file says it cares about most, since *a scanner that flags every key near a
   * scalar is one people will switch off.* Found 2026-09-08 by the fixtures test's own control.
   *
   * MEASURED BEFORE AND AFTER, over all 18 contracts: identical. 16,289 lines, 1,339 scalars
   * entered, 8,241 lines inside them, 0 openers, 1 soft hit, 2 adjacent pairs, byte-identical
   * finding lists. **So this changes no verdict on the corpus today** — the corpus contains zero
   * list-item openers — and closes a class that arrives the day a contract writes one.
   *
   * AND WHAT IT GAVE UP, MEASURED RATHER THAN ASSUMED, because a change that only gains is a
   * change nobody looked hard at. Exactly one shape stopped being flagged: a key BELOW the content
   * column, `a: >-` / six-space content / `  swallowed: >-`. The old rule called that an opener.
   * PyYAML 6.0.3 rejects the whole document — `expected <block end>, but found '<block mapping
   * start>'` — so it is the parse-error class, loud rather than silent. **That gap is now closed
   * by `dedentToNoLevel` below, which is the same information read the other way round:** the
   * content column that tells you what is INSIDE also tells you which closing columns are
   * impossible.
   */
  let contentIndent = -1;

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
      const indent = indentOf(line);
      if (contentIndent === -1 && indent > openerIndent) {
        contentIndent = indent;
      }
      if (contentIndent !== -1 && indent >= contentIndent) {
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
      // A COMMENT SITS AT ANY COLUMN AND IS NOT A DEDENT. Skipped rather than judged, and
      // deliberately without closing the scalar — see `dedentToNoLevel`.
      if (COMMENT_LINE.test(line)) {
        continue;
      }
      inScalar = false;
      closingLines += 1;
      if (indent > keyIndent) {
        findings.push({ line: index + 1, text: line, kind: 'dedentToNoLevel' });
      }
    }
    if (OPENER.test(line)) {
      inScalar = true;
      openerIndent = indentOf(line);
      // `- name: >-` puts the key two columns right of the dash, and its siblings sit with it.
      keyIndent = /^[ \t]*- /.test(line) ? openerIndent + 2 : openerIndent;
      contentIndent = -1;
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
    closingLines,
    // Only the LAST scalar in a file can still be open, so this is 0 or 1 — which is what makes
    // `closingLines === scalarsEntered - scalarsClosedAtEof` a usable identity rather than a
    // restatement of the same counter.
    scalarsClosedAtEof: inScalar ? 1 : 0,
    findings: findings.sort((a, b) => a.line - b.line),
    unmodelled: unmodelledForms(text),
  };
}

/**
 * ===========================================================================================
 * *** A BOUNDARY, NOT AN ALLOW-LIST — AND THE DIFFERENCE IS THE WHOLE POINT. ***
 * ===========================================================================================
 *
 * Added 2026-09-09, after `architecture-agent` put a **deliberately malformed** fixture under
 * `packages/contracts/generator/fixtures/drift/` — **a location that no longer exists; it now
 * lives at `packages/testing/fixtures/contract-generator/drift/`, outside this walk.** Its own
 * comment says so: *"THE PROSE BELOW IS A TRAP FOR THE SCANNER, DELIBERATELY"* — three lines
 * shaped exactly like a swallowed key pair, built to catch **their** outline scanner if it ever
 * stopped skipping block bodies.
 *
 * **This suite flagged it, correctly, and that was still the wrong answer** — a category error
 * about what the corpus IS. The file is tool input, not a published contract.
 *
 * **THE REPAIR THAT WAS REFUSED, AND WHY IT MATTERS MORE THAN THE ONE THAT WAS TAKEN.** The
 * obvious move was three new `ARGUED_PAIRS` entries. That would have been wrong, and not
 * marginally:
 *
 *   - **An allow-list entry claims "THIS INSTANCE is argued."**
 *   - **A boundary claims "THIS FILE IS NOT IN THE POPULATION."**
 *
 * **Only the second is true of a file whose entire purpose is to contain the shape.** Allow-listing
 * it would put a permanent suppression in for content that is *supposed* to trip the rule, and the
 * list would need extending every time the fixture changed — which is precisely how a reasoned
 * allow-list decays into a suppression list, the failure `ARGUED_PAIRS`'s own header warns about
 * with *"A NEW ENTRY HERE IS A DECISION, NOT A FIX."* **When you next meet this, ask which of the
 * two sentences above is true. If it is the second, do not touch the allow-list.**
 *
 * **AND AN EXCLUSION THAT CAN GROW UNNOTICED IS THE CHECKER EXAMINING LESS THAN IT CLAIMS** — the
 * `§11a` failure wearing a boundary's clothes. So the excluded count is asserted, not just the
 * included one.
 */
const EXCLUDED_PREFIX = 'generator/';

/**
 * How many files the boundary is expected to exclude.
 *
 * *** ZERO SINCE 2026-09-09, AND AT ZERO THIS STOPPED BEING BOOKKEEPING AND BECAME THE MECHANISM
 * THAT ENFORCES THE CONVENTION. *** `architecture-agent`'s drift fixture moved to
 * `packages/testing/fixtures/contract-generator/drift/` and its originals were deleted, so
 * `packages/contracts/**` now holds published contracts and registries and nothing else.
 *
 * **From here the assertion runs the other way.** While this was 1 it recorded a known exception;
 * at 0 it says *no deliberately-malformed file lives in the published tree*, and **the day one
 * reappears the count goes to 1 and this suite goes red naming it.** That is the whole reason the
 * number is a named constant rather than a literal in the assertion: **lowering it was one
 * deliberate edit, and raising it would have to be another.**
 *
 * **Do not raise it to silence a finding.** A new excluded file means someone has put a trap back
 * in the contract tree, which is the collision this boundary exists to prevent — the fixture and
 * this scanner tripped over each other in both directions before the move.
 */
const EXPECTED_EXCLUDED = 0;

/**
 * The published contract corpus, and what the boundary kept out of it.
 *
 * Both halves are returned because both are asserted. A walk that quietly stopped descending and a
 * boundary that quietly grew produce the same shrinking population, and neither should be able to
 * render as a cleaner corpus.
 */
function contractCorpus(): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${path}/`);
      } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        // Prefix, not a filename match: the boundary is the DIRECTORY, so a second fixture added
        // beside the first is excluded for the same reason rather than needing its own entry.
        (path.slice(CONTRACTS.length).startsWith(EXCLUDED_PREFIX) ? excluded : included).push(path);
      }
    }
  };
  walk(CONTRACTS);
  return { included: included.sort(), excluded: excluded.sort() };
}

function contractFiles(): string[] {
  return contractCorpus().included;
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

/**
 * The only adjacent pair in the corpus, and it is a genuinely hard false positive.
 *
 * ```
 *     Cookie: dudo_session=<opaque>            # web
 *     Authorization: Bearer <opaque>           # Apple — one value, two carriers
 * ```
 *
 * **AN HTTP HEADER BLOCK QUOTED INSIDE PROSE IS CHARACTER-FOR-CHARACTER A YAML MAPPING.** There is
 * no line-level rule that separates them, and there should not be one — the document is showing a
 * reader what goes on the wire. It is allow-listed with its reason rather than engineered around.
 *
 * A NEW ENTRY HERE IS A DECISION. The right response to a new adjacent pair is to open the file and
 * decide whether two fields have just stopped existing.
 */
const ARGUED_PAIRS: ReadonlyMap<string, string> = new Map([
  [
    'core/identity/organization-selection-v1.contract.yaml:Cookie:',
    'an HTTP header example quoted in prose — headers and YAML mappings are the same shape',
  ],
  [
    'core/identity/organization-selection-v1.contract.yaml:Authorization:',
    'the second line of the same quoted header block',
  ],
]);

export function buildContractYamlStructureSuite(): Suite {
  const suite = new Suite('Contracts — no key is swallowed by a block scalar');

  suite.test('THE POPULATION, against an independently derived expectation', () => {
    // A COUNT WITH NOTHING TO COMPARE AGAINST IS A NUMBER, NOT A CHECK. The file count is derived
    // from the directory walk; the scalar count is asserted against a floor that a human has to
    // move deliberately, so a walk that quietly stopped descending reads as a failure rather than
    // as a smaller corpus.
    const { included: files, excluded } = contractCorpus();
    assertTrue(
      'the contract directory was walked and yielded files',
      files.length >= 15,
      `only ${String(files.length)} contract YAML files were found. This set had 18 on 2026-09-08; ` +
        'a smaller number means the walk stopped descending, not that contracts were deleted',
    );
    // BOTH SIDES OF THE BOUNDARY ARE REPORTED, so an exclusion that grew and a walk that stopped
    // descending cannot render the same way. See `EXCLUDED_PREFIX` for why this is a boundary and
    // deliberately not an allow-list entry.
    console.log(
      `        corpus boundary: ${String(files.length)} published · ` +
        `${String(excluded.length)} excluded under '${EXCLUDED_PREFIX}'` +
        (excluded.length === 0 ? '' : ` — ${excluded.map((f) => f.slice(CONTRACTS.length)).join(', ')}`),
    );
    assertEqual(
      `${ISOLATION} the boundary excludes exactly what it is expected to`,
      String(excluded.length),
      String(EXPECTED_EXCLUDED),
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
      `only ${String(scalars)} block scalars were entered; there were 1,339 on 2026-09-08. The ` +
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

  suite.test('*** NO ADJACENT KEY PAIR SITS INSIDE A BLOCK SCALAR — the class no parser catches ***', () => {
    // ===================================================================================
    // THE DEFECT: two rulings that stopped being addressable fields, in a document that still
    // loads and still validates. A YAML parser PASSES this, so "run a parser over the contracts"
    // would not have caught the more dangerous of architecture-agent's two slips.
    // ===================================================================================
    const unargued: string[] = [];
    let total = 0;
    for (const file of contractFiles()) {
      const relative = file.slice(CONTRACTS.length);
      for (const finding of scanBlockScalars(readFileSync(file, 'utf8')).findings) {
        if (finding.kind !== 'consecutivePair') {
          continue;
        }
        total += 1;
        const key = `${relative}:${finding.text.trim().split(':')[0]!}:`;
        if (!ARGUED_PAIRS.has(key)) {
          unargued.push(`${relative}:${String(finding.line)}  ${finding.text.trim().slice(0, 72)}`);
        }
      }
    }
    console.log(`        adjacent pairs: ${String(total)}, of which argued: ${String(total - unargued.length)}`);
    assertEqual(
      `${ISOLATION} every adjacent key pair inside a block scalar is argued`,
      unargued.join(' · '),
      '',
    );
    // AND THE ARGUED ONES ARE STILL THERE. An allow-list describing a corpus that moved is a list
    // that has started tolerating something else.
    assertEqual(
      'the argued pair is still present, so the map is not stale',
      String(total),
      String(ARGUED_PAIRS.size),
    );
  });

  suite.test('*** NO LINE CLOSES A BLOCK SCALAR AT A COLUMN NO OPEN LEVEL SITS AT ***', () => {
    // ===================================================================================
    // THIS FINDS NOTHING TODAY AND THAT IS THE EXPECTED STATE. The corpus is clean. So the
    // population is reported against an expectation derived from a DIFFERENT counter, because
    // "the corpus is clean" and "the closing branch stopped executing" both print zero.
    // ===================================================================================
    const files = contractFiles();
    const reported: string[] = [];
    let entered = 0;
    let closing = 0;
    let atEof = 0;
    for (const file of files) {
      const result = scanBlockScalars(readFileSync(file, 'utf8'));
      entered += result.scalarsEntered;
      closing += result.closingLines;
      atEof += result.scalarsClosedAtEof;
      for (const finding of result.findings) {
        if (finding.kind === 'dedentToNoLevel') {
          reported.push(
            `${file.slice(CONTRACTS.length)}:${String(finding.line)} ${finding.text.trim().slice(0, 72)}`,
          );
        }
      }
    }
    console.log(
      `        closing lines examined: ${String(closing)} · scalars entered: ${String(entered)} · ` +
        `ran to end of file: ${String(atEof)}`,
    );

    // THE IDENTITY, AND IT IS THE INDEPENDENT EXPECTATION. Every scalar entered is closed by a
    // line or by the end of its file, and the three counters are incremented in three different
    // branches. A closing branch that stopped running takes this red rather than printing a
    // smaller number that reads like a cleaner corpus.
    assertEqual(
      `${ISOLATION} every block scalar entered is closed by a line or by end of file`,
      `${String(closing)} + ${String(atEof)} = ${String(closing + atEof)}`,
      `${String(closing)} + ${String(atEof)} = ${String(entered)}`,
    );
    assertTrue(
      'at most one scalar per file can still be open at end of file',
      atEof <= files.length,
      `${String(atEof)} scalars ran to end of file across ${String(files.length)} files, which is ` +
        'impossible: only the last scalar in a file can be open when it ends',
    );
    assertTrue(
      'and the population is the size 18 files of contracts imply',
      closing >= entered - files.length && closing >= 1200,
      `${String(closing)} closing lines were examined against ${String(entered)} scalars entered; ` +
        'there were 1,335 on 2026-09-08. A collapse here means the rule below is drawing from an ' +
        'empty population and reporting success',
    );

    assertEqual(
      `${ISOLATION} no contract closes a block scalar at an impossible column`,
      reported.join(' · '),
      '',
    );
  });

  suite.test('THE DEDENT RULE\'S OWN FAILING INPUTS, and every mirror PyYAML says must stay green', () => {
    // ===================================================================================
    // *** CONSTRUCTED, BECAUSE THE CORPUS HAS NONE — AND CHECKED AGAINST A REAL PARSER. ***
    // ===================================================================================
    //
    // Sound-by-design and sound-by-accident are indistinguishable while passing, and this rule
    // passes on every real file. So it ships with the inputs it MUST flag and, more importantly,
    // with every input it must NOT: each verdict below is PyYAML 6.0.3's, run 2026-09-08.
    const dedents = (text: string): number =>
      scanBlockScalars(text).findings.filter((finding) => finding.kind === 'dedentToNoLevel').length;

    // ---- MUST BE FLAGGED. PyYAML: ParserError on both. ----
    assertEqual(
      `${ISOLATION} a wrapped key dedenting to a column between the key and its content`,
      dedents('theRuling: >-\n    prose that runs on\n  aKeyThatWrapped,\n    MORE TEXT: >-\n      x\n'),
      1,
    );
    assertEqual(
      `${ISOLATION} a key BELOW the content column — the shape contentIndent alone gave up`,
      dedents('a: >-\n      first line, deep\n  swallowed: >-\n    x\n'),
      1,
    );

    // ---- MUST NOT BE FLAGGED. PyYAML loads every one of these. ----
    // A FALSE POSITIVE HERE FAILS THE BUILD ON A CORRECT CONTRACT, which is strictly worse than
    // the class the rule catches, so the mirrors outnumber the defects deliberately.
    const green: ReadonlyArray<readonly [string, string]> = [
      ['list-item siblings — the dash shifts the key two columns right', '- theRuling: >-\n    prose\n  whenItApplies: x\n  whatItRefuses: y\n'],
      ['nested siblings', 'root:\n  theRuling: >-\n    prose\n  whenItApplies: x\n'],
      ['a plain dedent to column 0', 'a: >-\n  prose\nb: 1\n'],
      ['closing out two levels at once', 'root:\n  child:\n    a: >-\n      prose\n  sibling: 1\n'],
      ['the next entry of a list of mappings', 'items:\n  - a: >-\n      prose\n  - b: 1\n'],
      ['a list entry continuing with another key', 'items:\n  - a: >-\n      prose\n    b: 1\n'],
      ['A COMMENT AT A COLUMN NO MAPPING LEVEL SITS AT — legal, and the rule must skip it', 'a: >-\n    prose\n  # a comment at an odd column\nb: 1\n'],
      ['the same, nested one level deeper', 'root:\n  a: >-\n      prose\n   # odd column comment\n  b: 1\n'],
    ];
    for (const [name, text] of green) {
      assertEqual(`${ISOLATION} NOT flagged, and PyYAML agrees: ${name}`, dedents(text), 0);
    }

    // AND SKIPPING A COMMENT MUST NOT END THE SCALAR, or a defect after one becomes invisible —
    // the same "found half" failure the blank-line control exists for.
    assertTrue(
      'a swallowed opener AFTER a comment is still found',
      scanBlockScalars('a: >-\n    prose\n  # comment\n    swallowed: >-\n      x\n').findings.some(
        (finding) => finding.kind === 'opener',
      ),
      'a comment line terminated the scalar, which would hide every finding after the first ' +
        'comment in a corpus whose contracts are full of them',
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

  suite.test('THE FOUR FIXTURES: two defects, two controls, and WHICH RULE CATCHES WHICH', () => {
    // ===================================================================================
    // *** IF ONE RULE CAUGHT BOTH DEFECTS, THEY WOULD NOT BE TWO CLASSES. ***
    // ===================================================================================
    //
    // Two defect shapes, and two documents that are CORRECT and must stay green. *"A scanner that
    // flags every key near a scalar is one people will switch off."* The controls are the
    // difference between a detector and a keyword ban, and one of them earned its place the hard
    // way — see `contentIndent`.
    //
    // ***** EVERY FIXTURE BELOW WAS RUN THROUGH A REAL PARSER, 2026-09-08, PyYAML 6.0.3. *****
    // That is the only thing separating "my model of the defect" from the defect, and the header
    // says why it matters: these inputs are CONSTRUCTED, because a sweep of 2,326 contract-file
    // revisions found zero historical instances. A constructed fixture nobody parsed is a guess.
    //
    // WHAT IS DELIBERATELY NOT HERE. An earlier revision of this test called class 1 *"a key
    // containing a newline — INVALID YAML"* and built a fixture that dedented to a column no open
    // level sits at. PyYAML rejects that fixture outright (`expected <block end>, but found
    // '<scalar>'`), which is the point: **it is a parse error, so it is a parser's job, and this
    // is not a parser.** The two shapes below are the ones a parser ACCEPTS.

    // ---- CLASS 1: a block-scalar OPENER swallowed into a scalar. Loads as prose.
    // PyYAML: {'theRuling': 'prose that runs on moreText: >-\n  the value'} — one key, not two.
    const swallowedOpener =
      'theRuling: >-\n' +
      '    prose that runs on\n' +
      '    moreText: >-\n' +
      '      the value\n';
    const classOne = scanBlockScalars(swallowedOpener).findings;

    // ---- CLASS 2: a key pair indented into the scalar's content. VALID YAML, WRONG SEMANTICS.
    // PyYAML: {'theRuling': 'A sentence ... whenItApplies: ... whatItRefuses: ...'} — one key,
    // and both rulings have ceased to be addressable fields. **No parser objects.**
    const swallowedPair =
      'theRuling: >-\n' +
      '    A sentence of prose introducing two rulings.\n' +
      '    whenItApplies: on every filtered request\n' +
      '    whatItRefuses: a request with no window\n';
    const classTwo = scanBlockScalars(swallowedPair).findings;

    // ---- CONTROL A: the SAME pair, correctly indented as real sibling keys. MUST STAY GREEN.
    // PyYAML: {'root': {'theRuling': ..., 'whenItApplies': ..., 'whatItRefuses': ...}} — three keys.
    // The nesting is load-bearing and was missing before: at the top level the pair would have to
    // sit at column 0 to be siblings, and at column 2 the document does not parse at all.
    const correct =
      'root:\n' +
      '  theRuling: >-\n' +
      '    A sentence of prose introducing two rulings.\n' +
      '  whenItApplies: on every filtered request\n' +
      '  whatItRefuses: a request with no window\n';
    const control = scanBlockScalars(correct).findings;

    // ---- CONTROL B: THE KNOWN-FAILING INPUT FOR `contentIndent`, AND IT WAS RED.
    // The same three keys inside a list entry. PyYAML: [{'theRuling': ..., 'whenItApplies': ...,
    // 'whatItRefuses': ...}]. `indentOf('- theRuling: >-')` is the DASH's column, so both siblings
    // are `> openerIndent` and the shipped rule reported them as a swallowed pair — a build
    // failure on a correct contract. This is the input that distinguishes sound-by-design from
    // sound-by-accident, and control A alone could not: A passes under BOTH rules.
    const listItem =
      '- theRuling: >-\n' +
      '    A sentence of prose introducing two rulings.\n' +
      '  whenItApplies: on every filtered request\n' +
      '  whatItRefuses: a request with no window\n';
    const listControl = scanBlockScalars(listItem).findings;

    const kinds = (findings: readonly ScalarFinding[]): string =>
      [...new Set(findings.map((finding) => finding.kind))].sort().join(',');

    console.log(
      `        class 1 (swallowed opener)   -> ${kinds(classOne) || '(none)'}\n` +
        `        class 2 (swallowed pair)     -> ${kinds(classTwo) || '(none)'}\n` +
        `        control A (nested siblings)  -> ${kinds(control) || '(none)'}\n` +
        `        control B (list-item siblings) -> ${kinds(listControl) || '(none)'}`,
    );

    assertTrue(
      `${ISOLATION} class 1 is caught, as an OPENER`,
      classOne.some((finding) => finding.kind === 'opener'),
      `the swallowed block-scalar opener was not flagged: ${JSON.stringify(classOne)}`,
    );
    assertTrue(
      `${ISOLATION} class 2 is caught — the one a YAML parser passes`,
      classTwo.some((finding) => finding.kind === 'consecutivePair'),
      'the swallowed key pair was not reported as an adjacent pair. This is the defect that ' +
        `loads cleanly and drops two fields, and it is the whole justification for this tool: ${JSON.stringify(classTwo)}`,
    );
    assertEqual(
      `${ISOLATION} PRECISION CONTROL A: the same pair, correctly indented, is NOT flagged`,
      control.map((finding) => `${String(finding.line)}:${finding.kind}`).join(' · '),
      '',
    );
    assertEqual(
      `${ISOLATION} PRECISION CONTROL B: the same pair inside a LIST ENTRY is NOT flagged`,
      listControl.map((finding) => `${String(finding.line)}:${finding.kind}`).join(' · '),
      '',
    );

    // AND THEY ARE DIFFERENT CLASSES, WHICH IS THE POINT OF REPORTING BOTH. Class 1 is caught by
    // the opener rule; class 2 is caught ONLY by adjacency. If a single rule caught both, one of
    // them would be redundant and the two-severity split would be theatre.
    assertTrue(
      'class 2 is NOT caught by the opener rule — the two classes need different rules',
      !classTwo.some((finding) => finding.kind === 'opener'),
      'the swallowed pair was flagged as an opener, so these are not two classes and the ' +
        'adjacency rule is not earning its place',
    );
    // AND THE MIRROR: class 1 is not caught by adjacency either. A single swallowed opener has no
    // neighbour at its indent, so if this ever went red the adjacency rule has widened.
    assertTrue(
      'class 1 is NOT caught by the adjacency rule — the mirror of the assertion above',
      !classOne.some((finding) => finding.kind === 'consecutivePair'),
      `the swallowed opener was also reported as an adjacent pair: ${JSON.stringify(classOne)}`,
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
