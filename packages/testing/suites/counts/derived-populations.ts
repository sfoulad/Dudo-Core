/**
 * ===========================================================================================
 * THE COUNTS EQUALITY GATE — the user's standing ruling, 2026-09-13, made mechanical.
 * ===========================================================================================
 *
 *   > "never maintain duplicated counts in prose; derive them from the catalogue and enforce
 *   >  equality through QA."
 *
 * `workflow.md` §11a records the ruling and the three instances that produced it: a comment
 * above the critical-permission list that said SIXTEEN against a catalogue holding eighteen,
 * having said fifteen before that. Wrong three times, directly above the list it counts.
 *
 * ===========================================================================================
 * THE TWO AXES, AND ONLY ONE OF THEM IS FINDABLE BY A PATTERN
 * ===========================================================================================
 *
 * `docs/decisions/README.md` states the mechanism this file is built around:
 *
 *   > "a row naming a deleted record is findable by a grep, and A MISSING ROW MATCHES NO
 *   >  PATTERN."
 *
 * So the strong half of this gate does not scan prose at all. It DERIVES the catalogue from
 * the tree and compares SETS. Set equality catches both directions at once — the entry that
 * should not be there and the entry that is not there — and needs no number to do it.
 *
 * The weak half handles the case where a figure genuinely appears in prose. That half is
 * bounded, and its bound is stated at the block level rather than left for a reader to infer
 * (`architecture.md` §3b-ii): **it reads only the regions named in `TOTAL_SITES` below, and it
 * cannot see a figure written anywhere else.** Everything it cannot see is enumerated in
 * `WHAT_THIS_CANNOT_SEE` and PRINTED ON EVERY RUN, because a skip-set that is defaulted rather
 * than enumerated is the axis an author cannot review (`workflow.md` §11a).
 *
 * ===========================================================================================
 * WHY A PROSE SWEEP IS NOT A GATE, MEASURED RATHER THAN ASSUMED
 * ===========================================================================================
 *
 * The obvious design is to sweep every markdown file for number-shaped claims. It was tried
 * against this corpus first and it does not work, for a reason that is a property of THIS
 * repository rather than of the technique:
 *
 *   `CLAUDE.md`'s Decisions cell, corrected on 2026-09-13, now reads
 *      "**`0001`-`0044` recorded - 44 ADRs + README**  *(This cell said `0001`-`0041` and
 *       "41 ADRs, measured" while there were 44 ...)*"
 *
 * **The live claim and its own correction note sit in one sentence, and 44 and 41 are both
 * adjacent to the word `ADRs`.** No pattern over that text can say which one is being
 * asserted — it is exactly the shape `workflow.md` records for *"it cannot be edited"* against
 * *"it cannot be recovered"*: identical grammar, opposite meaning.
 *
 * A sweep also drowns. Sweeping this corpus for a number beside a catalogue noun returns 45
 * hits, and the overwhelming majority are NARRATIVE — *"two agents"*, *"three suites"*,
 * *"five routes"* — recording incidents rather than claiming a population. **A check that goes
 * red under load teaches a team to ignore red** (`§11a`).
 *
 * SO THE EXEMPTIONS ARE ENUMERATED AND THE REGIONS ARE NAMED. That is `architecture.md`
 * §3a-i's shape — key the predicate on the exception, so a value nobody anticipated is caught
 * by the default rather than absorbed by it. A NEW figure appearing in a registered region is
 * caught, because it is not on the exemption list. A figure appearing OUTSIDE one is not, and
 * that is the stated bound.
 *
 * **An exemption is pinned in both directions.** Its `pinnedText` must still be present in the
 * file, so an exemption that has outlived the sentence it excuses FAILS rather than sitting
 * there permitting a number nobody is reading any more. Same discipline as
 * `check:source-bytes`'s NUL pin, and for the same reason: a pin claiming a defect that no
 * longer exists is a pessimistic stale number, the kind `§11a` records that nobody questions.
 *
 * ===========================================================================================
 * FOUR FLOORS, BECAUSE THIS CHECK'S FAILURE MODES ARE ALL SILENT-GREEN
 * ===========================================================================================
 *
 * Every way this check can stop working produces a PASS rather than an error, so each one is
 * asserted rather than trusted:
 *
 *   1. THE DERIVATION READS NOTHING. A moved directory, a renamed file, a changed layout — the
 *      derived set is empty, every claim of zero agrees with it, and the run is green.
 *      -> every derivation declares a `floor` and a `memberShape`, and BOTH are asserted.
 *         The shape floor is on the READER, not on the result: `check:request-class` shipped a
 *         one-character extractor bug whose malformed ids "compared clean against everything"
 *         and announced agreement.
 *   2. THE REGION STOPS MATCHING. An anchor that no longer selects anything examines no text,
 *      finds no wrong numbers, and passes.
 *      -> every site asserts its region is non-empty and contains its anchor.
 *   3. THE REGION MATCHES AND STATES NOTHING. A site whose figure was deleted has no wrong
 *      number in it either.
 *      -> every site asserts that at least one NON-EXEMPT number equal to the derived count is
 *         present. A region carrying only exemptions fails.
 *      -> AND THIS IS DELIBERATELY NOT THE DESIRED END STATE. The user's ruling says prose
 *         should NAME THE AUTHORITY rather than restate the figure. When a site is repaired
 *         that way, the correct change is to DELETE ITS ENTRY HERE, not to relax this
 *         assertion. The entry exists because a figure exists.
 *   4. A CATALOGUE WITH NO CLAIM SITE. The derivation runs, compares against nothing, and
 *      contributes a confident zero findings.
 *      -> uncovered catalogues are counted and PRINTED. A population of zero prints loudly.
 *
 * ===========================================================================================
 * WHAT IT DOES NOT COVER, NAMED HERE RATHER THAN DISCOVERED LATER
 * ===========================================================================================
 *
 * See `WHAT_THIS_CANNOT_SEE`. The entry that matters most: **a figure in a file this gate does
 * not name is invisible to it, and adding a new prose count is exactly the act nothing here
 * can detect.** That is the residual, it is not closable by a pattern for the reasons above,
 * and the control for it is the ruling itself — do not write the figure.
 *
 * ===========================================================================================
 * A NOTE ON READING `.claude/**`
 * ===========================================================================================
 *
 * `.gitignore` excludes `.claude/` and `CLAUDE.md`, and this shell's `grep` is a `ugrep`
 * wrapper passing `--ignore-files`, so **a recursive grep cannot see the binding rules or the
 * eight agent definitions** (`workflow.md` §11a, measured). This file reads them with
 * `node:fs` by explicit path, which is not subject to that blindness. Any future derivation
 * over `.claude/**` must do the same.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue } from '../../harness/runner.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

// ===========================================================================================
// PURE HALF — exported so the known-failing inputs drive THE SAME code the real run drives.
// No test-only path, no flag. Same precedent as `request-class-check.ts` and `emitModule`.
// ===========================================================================================

/**
 * Number words this repository actually uses in prose, derived from the corpus rather than
 * from memory (`workflow.md` §11a: *a pattern written from the shape you had in mind cannot
 * see the shape the code takes*). Swept for on 2026-09-13 across `CLAUDE.md`, `.claude/rules/`
 * and `docs/decisions/README.md`; the largest in use beside a catalogue noun was `nineteen`.
 * The range is carried to thirty so that a figure crossing twenty is not silently unreadable —
 * an unreadable number is not a wrong number, and this check would pass on it.
 */
export const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
  ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12],
  ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17],
  ['eighteen', 18], ['nineteen', 19], ['twenty', 20], ['twentyone', 21], ['thirty', 30],
]);

const NUMBER_ALTERNATION = [...NUMBER_WORDS.keys()].join('|');

/**
 * A paragraph is the region unit, because prose in this repository WRAPS and a line-keyed
 * region splits *"the eight agent"* from *"definitions"* across two lines.
 *
 * A MARKDOWN TABLE ROW IS ITS OWN REGION, and that is a correction rather than a refinement.
 * The first version treated a table as one paragraph and joined it, which moved every row off
 * the start of the block and made a `^`-anchored site match NOTHING — `CLAUDE.md`'s Decisions
 * cell examined no text at all on the first real run. **It was the empty-region floor that
 * caught it, not review**, which is the floor earning its place: without it the site would
 * have reported a clean pass over a region it never read.
 *
 * Splitting per row is also semantically right. A row is a self-contained record, the rows of
 * one table make claims about unrelated subjects, and `CLAUDE.md`'s Gates cell sits four rows
 * from its Decisions cell.
 */
export function paragraphsOf(text: string): string[] {
  const blocks: string[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    const joined = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length > 0) blocks.push(joined);
    buffer = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) {
      flush();
    } else if (line.trimStart().startsWith('|')) {
      flush();
      blocks.push(line.replace(/\s+/g, ' ').trim());
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

/** Every paragraph the anchor selects, joined. Empty means the anchor has stopped matching. */
export function regionFor(text: string, anchor: RegExp): string {
  return paragraphsOf(text)
    .filter((block) => new RegExp(anchor.source, anchor.flags.replace('g', '')).test(block))
    .join('\n');
}

export type FoundNumber = { readonly value: number; readonly token: string; readonly context: string };

/**
 * Every number asserted about `subject` inside `region`.
 *
 * ADJACENCY IS BOUNDED AND THE BOUND IS STATED: a number counts as a claim about the subject
 * only when at most 24 further characters separate them, and none of those characters is a
 * sentence or cell boundary (`.` `;` `|`). Without the boundary exclusion a markdown table row
 * lets a figure in one cell claim a noun in the next.
 *
 * ===========================================================================================
 * A NUMBER-SHAPED TOKEN IS NOT A COUNT, AND THE REAL CORPUS SAID SO IMMEDIATELY
 * ===========================================================================================
 *
 * The first run against `docs/decisions/README.md` reported *"the prose claims 2026"* — the
 * year of `Population as of 2026-09-13: 44 records on disk`, sitting comfortably inside the
 * adjacency window. **The date is not a figure about the catalogue and never could be.**
 *
 * Two exclusions close the class, and both are about the TOKEN'S BOUNDARY rather than its
 * value, because a value test would have to guess:
 *
 *   - **a digit adjoining `-` on either side is part of a date or a range**, so `2026`, `09`
 *     and `13` of an ISO date are all rejected, and so is the `2` of `0001`-`0044`;
 *   - **a backticked token is an identifier, not a count.** `` `0044` `` is a record's NAME.
 *     Without this, `` `0001`–`0044` recorded — 44 ADRs `` reports 44 as correct and 0044 as a
 *     rotted count, in the same sentence.
 *
 * A value-based rule was considered and rejected: *"ignore 1900-2100"* silently stops reading
 * any catalogue that ever reaches 1,900 members, which is a check that quietly narrows as the
 * thing it watches grows.
 */
export function numbersAbout(region: string, subject: RegExp): FoundNumber[] {
  const pattern = new RegExp(
    `(?<![\\w\`\\-])(\\d{1,4}|${NUMBER_ALTERNATION})(?![\\w\`\\-])([^.;|]{0,24}?)(?:${subject.source})`,
    'gi',
  );
  const found: FoundNumber[] = [];
  for (const match of region.matchAll(pattern)) {
    const token = match[1].toLowerCase();
    const value = NUMBER_WORDS.get(token) ?? Number.parseInt(token, 10);
    if (Number.isNaN(value)) continue;
    found.push({ value, token: match[1], context: match[0].trim() });
  }
  return found;
}

export type Exemption = {
  /** The figure being excused. */
  readonly value: number;
  /** Why it is not a live claim. A historical citation, a correction note, a worked example. */
  readonly because: string;
  /**
   * Text that must STILL BE PRESENT in the file. This is what pins the exemption in both
   * directions: when the sentence goes, the exemption fails rather than silently permitting a
   * value nobody is reading any more.
   */
  readonly pinnedText: string;
};

export type SiteVerdict = {
  readonly ok: boolean;
  readonly reason: string;
  readonly examined: number;
  readonly matched: number;
  readonly unexplained: readonly FoundNumber[];
};

/**
 * The whole comparison, as one pure function so a constructed input can drive it.
 *
 * `expected` is the DERIVED count. `region` is the prose. The verdict distinguishes the four
 * failure modes rather than collapsing them, because *"the region is empty"* and *"the region
 * states the wrong number"* need different repairs and only one of them is a stale count.
 */
export function judgeSite(
  region: string,
  subject: RegExp,
  expected: number,
  exemptions: readonly Exemption[],
  fileText: string,
): SiteVerdict {
  if (region.trim().length === 0) {
    return {
      ok: false,
      reason: 'THE REGION IS EMPTY — the anchor has stopped matching, so this site examined no text at all',
      examined: 0,
      matched: 0,
      unexplained: [],
    };
  }

  for (const exemption of exemptions) {
    if (!fileText.includes(exemption.pinnedText)) {
      return {
        ok: false,
        reason:
          `A STALE EXEMPTION: ${String(exemption.value)} is excused by text that is no longer in the ` +
          `file — ${JSON.stringify(exemption.pinnedText)}. Remove the exemption; leaving it permits a ` +
          'figure nobody is reading any more.',
        examined: 0,
        matched: 0,
        unexplained: [],
      };
    }
  }

  const found = numbersAbout(region, subject);
  if (found.length === 0) {
    return {
      ok: false,
      reason:
        'THE REGION STATES NO FIGURE ABOUT THIS SUBJECT. Either the figure was removed — in which ' +
        'case DELETE THIS SITE, which is the outcome the ruling wants — or the subject pattern has ' +
        'drifted from how the prose now words it.',
      examined: 0,
      matched: 0,
      unexplained: [],
    };
  }

  const exemptValues = new Set(exemptions.map((entry) => entry.value));
  const unexplained = found.filter((entry) => entry.value !== expected && !exemptValues.has(entry.value));
  const matched = found.filter((entry) => entry.value === expected);

  if (unexplained.length > 0) {
    return {
      ok: false,
      reason:
        `A DUPLICATED COUNT HAS ROTTED. Derived ${String(expected)}; the prose claims ` +
        unexplained.map((entry) => `${String(entry.value)} (${JSON.stringify(entry.context)})`).join(', '),
      examined: found.length,
      matched: matched.length,
      unexplained,
    };
  }

  if (matched.length === 0) {
    return {
      ok: false,
      reason:
        `EVERY FIGURE HERE IS EXEMPT AND NONE IS LIVE. Derived ${String(expected)} and the region ` +
        'states it nowhere, so this site is passing on its exemptions alone — which is vacuous.',
      examined: found.length,
      matched: 0,
      unexplained: [],
    };
  }

  return {
    ok: true,
    reason: `${String(matched.length)} live figure(s) agree with the derived ${String(expected)}`,
    examined: found.length,
    matched: matched.length,
    unexplained: [],
  };
}

export type SetVerdict = {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
};

/**
 * Set equality, in BOTH directions, which is the whole reason this is preferred to a count.
 *
 * `missing` is the axis no pattern can find — an entry that should be in the listing and is
 * not. `extra` is the axis a grep finds — a listing naming something that is gone. A count
 * comparison sees neither when they cancel out, and they cancelled out in this repository the
 * day a record was renamed.
 */
export function judgeEnumeration(
  derived: readonly string[],
  listed: readonly string[],
  exemptMembers: readonly string[],
): SetVerdict {
  const exempt = new Set(exemptMembers);
  const listedSet = new Set(listed);
  const derivedSet = new Set(derived);
  return {
    ok:
      derived.every((member) => listedSet.has(member) || exempt.has(member)) &&
      listed.every((member) => derivedSet.has(member)),
    missing: derived.filter((member) => !listedSet.has(member) && !exempt.has(member)),
    extra: listed.filter((member) => !derivedSet.has(member)),
  };
}

// ===========================================================================================
// THE CATALOGUES. Each one derives its members from the TREE, never from a second copy.
// ===========================================================================================

export type Derivation = {
  readonly id: string;
  readonly describe: string;
  /** Below this, the reader is broken rather than the tree being small. */
  readonly floor: number;
  /** Every derived member must match. A floor ON THE READER, not only on the result. */
  readonly memberShape: RegExp;
  readonly derive: () => string[];
};

function read(relative: string): string {
  return readFileSync(REPO + relative, 'utf8');
}

export const DERIVATIONS: readonly Derivation[] = [
  {
    id: 'decision-records',
    describe: 'architecture decision records on disk under docs/decisions/',
    floor: 40,
    memberShape: /^\d{4}-[a-z0-9-]+\.md$/,
    derive: () =>
      readdirSync(REPO + 'docs/decisions')
        .filter((name) => /^\d{4}-.*\.md$/.test(name))
        .sort(),
  },
  {
    id: 'agent-definitions',
    describe: 'agent definitions under .claude/agents/ — read with node:fs because a recursive grep cannot see them',
    floor: 6,
    memberShape: /^[a-z-]+-agent\.md$/,
    derive: () =>
      readdirSync(REPO + '.claude/agents')
        .filter((name) => name.endsWith('.md'))
        .sort(),
  },
  {
    id: 'permission-ids',
    describe: 'permission ids under the `permissions:` section of the catalogue',
    floor: 60,
    memberShape: /^[a-z][a-z0-9.-]+$/,
    derive: () => {
      const lines = read('packages/contracts/registries/permission-catalog.yaml').split('\n');
      // The catalogue carries `- id:` entries under SIX top-level sections. Slicing to the
      // `permissions:` block is the difference between 88 and 122, and a check that took the
      // whole file would be counting principal types and open questions as permissions.
      const start = lines.findIndex((line) => /^permissions:/.test(line));
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((line) => /^[a-zA-Z_]+:/.test(line));
      return rest
        .slice(0, end === -1 ? rest.length : end)
        .map((line) => /^ {2}- id: (\S+)/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => match[1])
        .sort();
    },
  },
  {
    id: 'suite-entry-points',
    describe: 'suite entry points under packages/testing/',
    floor: 4,
    memberShape: /^run-[a-z0-9-]+\.ts$/,
    derive: () =>
      readdirSync(REPO + 'packages/testing')
        .filter((name) => /^run-.*\.ts$/.test(name))
        .sort(),
  },
];

// ===========================================================================================
// THE CLAIM SITES. A figure is PERMITTED to appear only where it is checked.
// ===========================================================================================

export type TotalSite = {
  readonly id: string;
  readonly file: string;
  readonly catalogue: string;
  /** Selects the paragraph(s). Anchored on TEXT, never on a line number — a line number is not
   *  an identifier in a file of repeated blocks (`architecture.md` §3c). */
  readonly anchor: RegExp;
  /** The noun the figure must be adjacent to. Narrow, because a markdown table is one region. */
  readonly subject: RegExp;
  readonly exemptions: readonly Exemption[];
};

export const TOTAL_SITES: readonly TotalSite[] = [
  // *** `claude-md/decisions-cell/ADRs` WAS HERE AND IS DELETED, 2026-09-13 — THE SECOND SITE TO
  // GO THE SAME WAY IN ONE SESSION, AND BOTH FOR THE RIGHT REASON. ***
  //
  // The Decisions cell now reads *"THIS CELL STATES NO COUNT, DELIBERATELY. The authority is
  // `npm test`'s `counts-equality` suite … Run it; do not believe a number written here."* There
  // is no longer any figure adjacent to `ADRs` anywhere in it — measured, not assumed.
  //
  // **IT WENT RED THROUGH THE EXEMPTION PIN RATHER THAN THE FIGURE CHECK, AND THAT ORDERING IS
  // WORTH KEEPING.** The `41` exemption was pinned to the sentence that excused it — *"This cell
  // said `0001`–`0041`"* — and the rewrite removed both. `judgeSite` checks exemption staleness
  // BEFORE it looks for figures, so the message was *"a stale exemption"* rather than *"the region
  // states no figure"*. Both point here; the first is the more precise complaint, because an
  // exemption outliving its sentence is a hole that would silently permit `41` again.
  //
  // > **THE TWO SITES FOR `decision-records` ARE NOW BOTH GONE, AND WHAT REMAINS IS STRONGER THAN
  // > EITHER.** No figure is restated in prose anywhere, so nothing can rot — and the set-equality
  // > assertion over the README's rows needs no number at all while catching both the missing row
  // > and the spurious one. **That is the ruling's end state, not a loss of coverage.**
  //
  // A THIRD FIGURE APPEARING IN EITHER FILE IS NOW UNCOVERED, and that is the stated residual —
  // it is the same residual the header names for every file this gate does not read, and the
  // control for it is the ruling rather than a pattern.
  // *** `decisions-readme/population/records-on-disk` WAS HERE AND IS DELETED, 2026-09-13 —
  // WHICH IS THIS GATE'S DESIGNED END STATE RATHER THAN A GAP. ***
  //
  // That site read `Population as of <date>: N records on disk, N rows above.` It went red with
  // *"THE REGION IS EMPTY"* when the Team Lead **removed the figure entirely** and replaced it
  // with a pointer: *"THE AUTHORITY IS `run-counts-equality.ts`, NOT A FIGURE IN THIS PARAGRAPH.
  // Run it; do not believe a number written here."*
  //
  // **That is the user's ruling satisfied at the source rather than policed at the gate**, and
  // this file's header says so in advance: a site entry exists BECAUSE a figure exists, so when
  // the figure goes the entry goes with it. Removing the site is the correct repair; relaxing the
  // assertion to tolerate a figureless region would have been the wrong one, because it would
  // also tolerate a site whose subject pattern had silently drifted.
  //
  // **The paragraph it replaced had been wrong for about four hours** — it said "44 records, 44
  // rows" and `0045` landed. `docs/decisions/README.md` records that the author had corrected the
  // identical defect in `CLAUDE.md` in the same session. **The set-equality assertion over the
  // table rows is untouched and is the stronger guarantee anyway**: it needs no figure, and it
  // catches the missing row that no count reliably does.
  {
    id: 'claude-md/team-paragraph/agent-definitions',
    file: 'CLAUDE.md',
    catalogue: 'agent-definitions',
    anchor: /agent definitions exist/,
    subject: /agent definitions\b/,
    exemptions: [],
  },
];

export type EnumerationSite = {
  readonly id: string;
  readonly file: string;
  readonly catalogue: string;
  /** Pulls the member tokens the artifact actually lists. */
  readonly listed: (text: string) => string[];
  /** Members deliberately absent from the listing, each with its reason. */
  readonly exemptMembers: readonly { readonly member: string; readonly because: string }[];
};

export const ENUMERATION_SITES: readonly EnumerationSite[] = [
  {
    id: 'decisions-readme/table-rows',
    file: 'docs/decisions/README.md',
    catalogue: 'decision-records',
    // THE STRONG ASSERTION IN THIS FILE. It needs no figure and catches the axis a grep
    // cannot: four records were missing from this table on 2026-09-13, two of them for days,
    // and "an index with 40 rows in it reads exactly like an index with 44".
    listed: (text) =>
      [...text.matchAll(/`(\d{4}-[a-z0-9-]+\.md)`/g)].map((match) => match[1]).sort(),
    exemptMembers: [],
  },
  {
    id: 'run-suites/entry-points',
    file: 'tools/run-suites.mjs',
    catalogue: 'suite-entry-points',
    listed: (text) =>
      [...text.matchAll(/'packages\/testing\/(run-[a-z0-9-]+\.ts)'/g)].map((match) => match[1]).sort(),
    exemptMembers: [
      {
        member: 'run-az2-timing.ts',
        because:
          'DELIBERATELY ABSENT and recorded as such in the runner\'s own header: it is a measurement ' +
          'rather than a test, and a wall-clock threshold on a shared laptop fails for reasons that ' +
          'have nothing to do with the code.',
      },
      {
        member: 'run-capacity-model.ts',
        because:
          'A model rather than a suite — it produces figures for a capacity argument and asserts no ' +
          'product behaviour. Not in the gate, and its absence is a decision rather than an omission.',
      },
      // *** TWO EXEMPTIONS WERE REMOVED FROM HERE ON 2026-09-13, AND THE REMOVAL IS THE POINT. ***
      //
      // `run-counts-equality.ts` and `run-tenant-admin.ts` were exempted while they were held out
      // of the runner — a red gate folded into a green one makes the green one worthless, so each
      // waited until it exited 0. Both then did, the Team Lead wired them in, and **this check
      // went red within minutes naming both files and the fix**:
      //
      //     [FAIL] set equality — run-suites/entry-points lists exactly suite-entry-points
      //            run-counts-equality.ts, run-tenant-admin.ts is exempted as deliberately absent
      //            and IS PRESENT. Remove the exemption.
      //
      // THAT IS THE SECOND DIRECTION OF THE PIN EARNING ITS KEEP. The first direction catches a
      // suite that exists and nothing runs. The second catches an EXEMPTION THAT HAS OUTLIVED ITS
      // REASON — which is `§11a`'s pessimistic stale figure, the kind nobody questions because
      // acting on it always looks like the safe choice. Left in place, these two would have gone
      // on excusing an absence that had stopped being one, and the next entry point added and
      // never wired would have been excused with them.
      //
      // A one-directional pin here would have been green through the whole episode.
    ],
  },
];

/**
 * ENUMERATED, NOT DEFAULTED — and printed on every run.
 *
 * `workflow.md` §11a: *the axis an author cannot see is what the check is PERMITTED TO SKIP.*
 * The author checks the reasoning because that is what they wrote; the set of things the check
 * never reaches is not something they wrote, so there is nothing to re-read. Writing it down is
 * the only thing that makes it reviewable by anyone else.
 */
export const WHAT_THIS_CANNOT_SEE: readonly string[] = [
  'A FIGURE IN A FILE THIS GATE DOES NOT NAME. This is the residual and it is not closable by a ' +
    'pattern — see the header. The control is the ruling: do not write the figure.',
  'A figure inside a registered file but OUTSIDE the anchored paragraph.',
  'A figure worded so the subject pattern does not reach it — "the index holds forty-four" is ' +
    'invisible to a subject of /ADRs?/.',
  'A count of something with no derivation here: contract files, route ids, migrations, generated ' +
    'modules, workspace members. Each needs its own entry; none is covered by another.',
  'WHETHER A DERIVED NUMBER IS THE RIGHT ONE TO STATE. This gate proves prose agrees with the tree. ' +
    'It cannot prove the tree is what anybody wanted.',
  'A figure in Arabic or any translated copy. The message dictionaries are not read here, and a ' +
    'translated count shares no characters with its original.',
];

// ===========================================================================================
// THE SUITE
// ===========================================================================================

export function buildDerivedPopulationsSuite(): Suite {
  const suite = new TestSuite('counts equality — derived populations against every figure restated in prose');

  const byId = new Map(DERIVATIONS.map((entry) => [entry.id, entry]));

  // ---- Floor 1: the readers ----------------------------------------------------------
  //
  // Run FIRST. Every assertion below rests on these sets, and a broken reader does not report
  // nothing — it reports agreement.
  for (const derivation of DERIVATIONS) {
    suite.test(`reader floor — ${derivation.id} derives a well-formed, non-trivial population`, () => {
      const members = derivation.derive();
      assertTrue(
        `${derivation.id}: population floor`,
        members.length >= derivation.floor,
        `derived ${String(members.length)} members (${derivation.describe}) against a floor of ` +
          `${String(derivation.floor)}. Below the floor the READER is broken, not the tree — a ` +
          'derivation that reads nothing agrees with every claim of zero.',
      );
      const malformed = members.filter((member) => !derivation.memberShape.test(member));
      assertTrue(
        `${derivation.id}: member shape`,
        malformed.length === 0,
        `${String(malformed.length)} derived member(s) do not match ${String(derivation.memberShape)}: ` +
          `${malformed.slice(0, 5).join(', ')}. A malformed member compares clean against everything.`,
      );
      const duplicates = members.filter((member, index) => members.indexOf(member) !== index);
      assertTrue(
        `${derivation.id}: no duplicates`,
        duplicates.length === 0,
        `derived the same member twice: ${duplicates.join(', ')} — the count is then wrong in the ` +
          'direction that looks like growth.',
      );
      console.log(`      ${derivation.id}: ${String(members.length)} members`);
    });
  }

  // ---- Floor 4: no catalogue is silently uncovered ------------------------------------
  suite.test('coverage floor — every derivation is compared against at least one artifact', () => {
    const covered = new Set([
      ...TOTAL_SITES.map((site) => site.catalogue),
      ...ENUMERATION_SITES.map((site) => site.catalogue),
    ]);
    const uncovered = DERIVATIONS.filter((entry) => !covered.has(entry.id)).map((entry) => entry.id);
    // Uncovered is REPORTED rather than failed: under the user's ruling the desired end state
    // for a catalogue is that NO prose figure exists, at which point it is correctly uncovered.
    // What must never happen is that this is invisible.
    console.log(
      uncovered.length === 0
        ? '      every derivation has a claim site'
        : `      ${String(uncovered.length)} derivation(s) compared against NOTHING (no prose figure ` +
            `exists for them, which is the ruling's desired state): ${uncovered.join(', ')}`,
    );
    assertTrue(
      'coverage: the site registry is not empty',
      TOTAL_SITES.length + ENUMERATION_SITES.length > 0,
      'no claim sites are registered, so this suite asserts nothing about any prose figure',
    );
  });

  // ---- Set equality — the strong half --------------------------------------------------
  for (const site of ENUMERATION_SITES) {
    suite.test(`set equality — ${site.id} lists exactly ${site.catalogue}`, () => {
      const derivation = byId.get(site.catalogue);
      assertTrue(`${site.id}: catalogue exists`, derivation !== undefined, `no derivation ${site.catalogue}`);
      if (derivation === undefined) return;

      const text = read(site.file);
      const listed = site.listed(text);
      assertTrue(
        `${site.id}: the listing reader found entries`,
        listed.length > 0,
        `read 0 entries from ${site.file} — the extractor has stopped matching, and an empty ` +
          'listing compares clean against a listing that is merely short',
      );

      const derived = derivation.derive();
      const verdict = judgeEnumeration(
        derived,
        listed,
        site.exemptMembers.map((entry) => entry.member),
      );

      // A stale exemption is a failure in the other direction: it excuses an absence that is no
      // longer an absence.
      const spurious = site.exemptMembers.filter((entry) => listed.includes(entry.member));
      assertTrue(
        `${site.id}: no stale member exemption`,
        spurious.length === 0,
        `${spurious.map((entry) => entry.member).join(', ')} is exempted as deliberately absent and ` +
          'IS PRESENT. Remove the exemption.',
      );

      assertTrue(
        `${site.id}: nothing missing from the listing`,
        verdict.missing.length === 0,
        `${String(verdict.missing.length)} member(s) exist and are NOT listed in ${site.file}: ` +
          `${verdict.missing.join(', ')}. A MISSING ROW MATCHES NO PATTERN — this is the axis a ` +
          'grep cannot find, and it is why this assertion compares sets rather than counts.',
      );
      assertTrue(
        `${site.id}: nothing listed that does not exist`,
        verdict.extra.length === 0,
        `${site.file} lists ${String(verdict.extra.length)} entr(ies) that are not in the tree: ` +
          `${verdict.extra.join(', ')}`,
      );
      console.log(
        `      ${site.id}: ${String(listed.length)} listed, ${String(derived.length)} derived, ` +
          `${String(site.exemptMembers.length)} exempt`,
      );
    });
  }

  // ---- Count equality — the bounded half -----------------------------------------------
  for (const site of TOTAL_SITES) {
    suite.test(`count equality — ${site.id}`, () => {
      const derivation = byId.get(site.catalogue);
      assertTrue(`${site.id}: catalogue exists`, derivation !== undefined, `no derivation ${site.catalogue}`);
      if (derivation === undefined) return;

      const text = read(site.file);
      const region = regionFor(text, site.anchor);
      const expected = derivation.derive().length;
      const verdict = judgeSite(region, site.subject, expected, site.exemptions, text);

      assertTrue(
        `${site.id}: prose agrees with the tree`,
        verdict.ok,
        `${verdict.reason}  [derived ${String(expected)} from ${site.catalogue}; ${site.file}]`,
      );
      console.log(
        `      ${site.id}: derived ${String(expected)}, ${String(verdict.examined)} figure(s) examined, ` +
          `${String(verdict.matched)} live and agreeing, ${String(site.exemptions.length)} exempt`,
      );
    });
  }

  // ---- Real-corpus mutants -----------------------------------------------------------------
  // They read the tree, so they belong here rather than among the constructed self-tests: a
  // failure means either the comparator is broken OR the corpus is dirty, and only the second is
  // a finding the gate should report rather than a reason to declare the run unmeasured.
  addRealCorpusMutants(suite);

  // ---- The stated bound ------------------------------------------------------------------
  suite.test('the skip-set is enumerated and printed rather than defaulted', () => {
    assertTrue(
      'skip-set is non-empty',
      WHAT_THIS_CANNOT_SEE.length > 0,
      'a check with no stated blind spot is a check whose author has not looked for one',
    );
    console.log('\n      WHAT THIS GATE CANNOT SEE:');
    for (const entry of WHAT_THIS_CANNOT_SEE) console.log(`        - ${entry}`);
  });

  return suite;
}

// ===========================================================================================
// THE KNOWN-FAILING INPUTS.
//
// `workflow.md` §11a: *constructing the input the check should fail on is the only thing that
// distinguishes sound-by-design from sound-by-accident, because both look identical while
// passing.* Each case below drives the SAME pure functions the real run drives.
//
// The vacuity question, asked of this block and answered rather than assumed: *would these
// pass against a `judgeSite` that ignored its input entirely?* No — the four cases demand four
// DIFFERENT verdicts from one function, so a constant-returning implementation fails three of
// them whichever constant it picks.
// ===========================================================================================

export function buildCountsSelfTestSuite(): Suite {
  const suite = new TestSuite('counts equality — known-failing inputs (the check checking itself)');

  const NO_EXEMPTIONS: readonly Exemption[] = [];

  suite.test('a correct figure passes — the positive control, without which the negatives prove nothing', () => {
    const verdict = judgeSite('the index holds 44 ADRs today', /ADRs?\b/, 44, NO_EXEMPTIONS, 'the index holds 44 ADRs today');
    assertTrue('control: a correct figure is accepted', verdict.ok, verdict.reason);
    assertEqual('control: one figure matched', verdict.matched, 1);
  });

  suite.test('KNOWN-FAILING: a rotted figure is caught', () => {
    const text = 'the index holds 41 ADRs today';
    const verdict = judgeSite(text, /ADRs?\b/, 44, NO_EXEMPTIONS, text);
    assertTrue('a wrong figure must be refused', !verdict.ok, 'a stale 41 against a derived 44 was ACCEPTED');
    assertEqual('the wrong value is named', verdict.unexplained[0]?.value, 41);
  });

  suite.test('KNOWN-FAILING: an empty region is caught rather than passing vacuously', () => {
    const verdict = judgeSite('', /ADRs?\b/, 44, NO_EXEMPTIONS, 'irrelevant');
    assertTrue('an empty region must be refused', !verdict.ok, 'an anchor that matched nothing was ACCEPTED');
    assertTrue('the reason names the anchor', verdict.reason.includes('REGION IS EMPTY'), verdict.reason);
  });

  suite.test('KNOWN-FAILING: a region stating no figure at all is caught', () => {
    const text = 'the index is derived by `ls`; run the check rather than believing a number here';
    const verdict = judgeSite(text, /ADRs?\b/, 44, NO_EXEMPTIONS, text);
    assertTrue('a region with no figure must be refused', !verdict.ok, 'a figureless region was ACCEPTED');
    assertTrue('the reason says to delete the site', verdict.reason.includes('DELETE THIS SITE'), verdict.reason);
  });

  suite.test('KNOWN-FAILING: a region carrying only EXEMPT figures does not pass on its exemptions', () => {
    const text = 'this cell used to say 41 ADRs';
    const verdict = judgeSite(text, /ADRs?\b/, 44, [{ value: 41, because: 'historical', pinnedText: 'used to say' }], text);
    assertTrue('exemptions alone must not carry a site', !verdict.ok, 'a site with no live figure was ACCEPTED');
    assertTrue('the reason names vacuity', verdict.reason.includes('EXEMPT AND NONE IS LIVE'), verdict.reason);
  });

  suite.test('KNOWN-FAILING: an exemption whose pinned text is gone is caught (the pin holds in both directions)', () => {
    const text = 'the index holds 44 ADRs';
    const verdict = judgeSite(text, /ADRs?\b/, 44, [{ value: 41, because: 'historical', pinnedText: 'used to say' }], text);
    assertTrue('a stale exemption must be refused', !verdict.ok, 'an exemption outliving its sentence was ACCEPTED');
    assertTrue('the reason names staleness', verdict.reason.includes('STALE EXEMPTION'), verdict.reason);
  });

  suite.test('an exemption WITH its pinned text present is honoured — the control for the case above', () => {
    const text = 'the index holds 44 ADRs. This cell used to say 41 ADRs.';
    const verdict = judgeSite(text, /ADRs?\b/, 44, [{ value: 41, because: 'historical', pinnedText: 'used to say' }], text);
    assertTrue('a live exemption is honoured', verdict.ok, verdict.reason);
    assertEqual('both figures were examined', verdict.examined, 2);
    assertEqual('one is live', verdict.matched, 1);
  });

  suite.test('KNOWN-FAILING: a MISSING entry is caught — the axis no pattern can find', () => {
    const verdict = judgeEnumeration(['0043-x.md', '0044-y.md'], ['0043-x.md'], []);
    assertTrue('a missing entry must be refused', !verdict.ok, 'a listing short by one was ACCEPTED');
    assertDeep('the missing entry is named', verdict.missing, ['0044-y.md']);
  });

  suite.test('KNOWN-FAILING: an entry naming something that does not exist is caught', () => {
    const verdict = judgeEnumeration(['0043-x.md'], ['0043-x.md', '0099-gone.md'], []);
    assertTrue('a spurious entry must be refused', !verdict.ok, 'a listing naming a deleted record was ACCEPTED');
    assertDeep('the spurious entry is named', verdict.extra, ['0099-gone.md']);
  });

  suite.test('number WORDS are read, not only digits — "Eight agent definitions" is a claim', () => {
    const text = 'Eight agent definitions exist, including security-agent';
    const verdict = judgeSite(text, /agent definitions\b/, 8, NO_EXEMPTIONS, text);
    assertTrue('a word-number is read as a figure', verdict.ok, verdict.reason);
    const wrong = judgeSite('Nine agent definitions exist', /agent definitions\b/, 8, NO_EXEMPTIONS, 'Nine agent definitions exist');
    assertTrue('and a wrong word-number is refused', !wrong.ok, 'a stale "Nine" was ACCEPTED');
  });

  suite.test('adjacency is bounded — a figure in another table cell does not claim this subject', () => {
    // Without the `|` exclusion this returns a match, and one cell's number gates another's noun.
    const found = numbersAbout('| Gates | 4 suites green | Decisions | ADRs |', /ADRs?\b/);
    assertEqual('a figure across a cell boundary is not adjacent', found.length, 0);
  });

  // -----------------------------------------------------------------------------------------
  // THE THREE CASES BELOW WERE NOT PREDICTED. They exist because the first run of this check
  // against the REAL corpus went red twice, and both reds were defects in the check rather than
  // in the tree (`workflow.md` §11a: *the real broken state contains the failures you did not
  // think of, and it exists for free, once*). The broken state is gone; these are what remain.
  // -----------------------------------------------------------------------------------------

  suite.test('KNOWN-FAILING CLASS: a DATE is not a count — "Population as of 2026-09-13: 44 records"', () => {
    // The live first-run failure, verbatim in shape: `2026` sat inside the adjacency window and
    // was reported as a rotted figure against a derived 44.
    const text = 'Population as of 2026-09-13: 44 records on disk, 44 rows above.';
    const found = numbersAbout(text, /records? on disk/);
    assertEqual('exactly one figure is read, and it is not the year', found.length, 1);
    assertEqual('and it is the count', found[0]?.value, 44);
    const verdict = judgeSite(text, /records? on disk|rows? above/, 44, NO_EXEMPTIONS, text);
    assertTrue('the site passes rather than tripping over its own date', verdict.ok, verdict.reason);
  });

  suite.test('KNOWN-FAILING CLASS: a BACKTICKED identifier is not a count — `0044` is a name', () => {
    // Without the backtick exclusion this sentence reports 44 as correct AND 0044 as rotted,
    // in one breath, which is the least useful possible output.
    const text = '**`0001`–`0044` recorded — 44 ADRs + README**';
    const found = numbersAbout(text, /ADRs?\b/);
    assertEqual('the record id is not read as a figure', found.length, 1);
    assertEqual('only the bare count is', found[0]?.value, 44);
  });

  suite.test('paragraph regions survive WRAPPED prose, which a line-keyed region does not', () => {
    // The live instance: `.claude/rules/workflow.md` splits "the eight agent" from "definitions"
    // across two lines. A line-keyed reader sees neither half as a claim.
    const wrapped = 'a recursive grep cannot see the binding rules or the eight agent\ndefinitions in .claude/';
    const region = regionFor(wrapped, /recursive grep/);
    const found = numbersAbout(region, /agent definitions\b/);
    assertEqual('the wrapped claim is read as one', found.length, 1);
    assertEqual('and its value is right', found[0]?.value, 8);
  });

  suite.test('KNOWN-FAILING CLASS: a markdown table ROW is its own region', () => {
    // The other first-run failure. Joining a table into one paragraph moved every row off the
    // start of the block, so a `^`-anchored site matched NOTHING and examined no text — and it
    // was the empty-region floor that said so, not review.
    const table = '| Branch | on `main` |\n| Decisions | 44 ADRs recorded |\n| Gates | 4 suites green |';
    const region = regionFor(table, /^\| Decisions \|/);
    assertTrue('the Decisions row is selected', region.includes('Decisions'), region);
    assertTrue('and the Gates row is NOT', !region.includes('Gates'), region);
    const verdict = judgeSite(region, /ADRs?\b/, 44, NO_EXEMPTIONS, table);
    assertTrue('the row-scoped site reads its own figure', verdict.ok, verdict.reason);
    // The floor that caught it, asserted directly: an anchor selecting nothing must not pass.
    const dead = judgeSite(regionFor(table, /^\| Nonexistent \|/), /ADRs?\b/, 44, NO_EXEMPTIONS, table);
    assertTrue('an anchor that selects nothing fails', !dead.ok, 'a dead anchor was ACCEPTED');
  });

  return suite;
}

/**
 * REAL-CORPUS MUTANTS — the constructed inputs above test the LOGIC; these test that the logic
 * fires ON THIS REPOSITORY'S ACTUAL PROSE.
 *
 * *** THEY LIVED IN THE SELF-TEST SUITE UNTIL 2026-09-13 AND THAT WAS WRONG, FOUND THE FIRST
 * TIME THE CORPUS WENT DIRTY UNDER THEM. ***
 *
 * `0045` landed, `docs/decisions/README.md` lost a row and `CLAUDE.md` went stale — so these two
 * cases failed **on their CONTROLS**, which assert the unmutated corpus is clean. The entry point
 * reads a self-test failure as *"the comparator is broken, so the real run is NOT RUN"* and
 * stopped. **Correct for a broken comparator; wrong here.** The comparator was fine; the corpus
 * was dirty, which is the finding the real run exists to report — and it was suppressed by the
 * cases that had just discovered it.
 *
 * > **A CONTROL OVER THE REAL TREE IS NOT A SELF-TEST.** A self-test's inputs are constructed, so
 * > its failure can only mean the logic is wrong. These read the tree, so their failure has two
 * > possible causes and only one of them is about the checker. Putting them in the gating block
 * > made a corpus defect look like an instrument defect.
 *
 * They now run in the main suite, where a failure is reported as what it is.
 */
function addRealCorpusMutants(suite: Suite): void {
  // -----------------------------------------------------------------------------------------
  //
  // `workflow.md` §11a: *a control built from an INVENTED mutation tests the pattern against
  // itself and always passes; a control built from a REALISTIC mutation tests it against the
  // codebase, which is the only thing it will ever run on.* Both defects below are the exact
  // shapes this repository hit on 2026-09-13 — four missing README rows, and a Decisions cell
  // claiming 41 against 44 — and **both had been repaired before this gate existed**, so the
  // free failing input was gone and these are how the claim is evidenced at all.
  //
  // THEY MUTATE NOTHING ON DISK. The real file is read, one row is removed FROM THE STRING, and
  // the same readers and the same comparators run over it. That is a full end-to-end mutant
  // with no window in which another agent could see a broken tree (`workflow.md` §2a-i).
  // -----------------------------------------------------------------------------------------

  suite.test('REAL-CORPUS MUTANT: a row deleted from the live decisions index is caught by name', () => {
    const site = ENUMERATION_SITES.find((entry) => entry.id === 'decisions-readme/table-rows');
    assertTrue('the site is still registered', site !== undefined, 'decisions-readme/table-rows is gone');
    if (site === undefined) return;
    const derivation = DERIVATIONS.find((entry) => entry.id === site.catalogue);
    if (derivation === undefined) return;

    const derived = derivation.derive();
    const real = read(site.file);
    const victim = derived[derived.length - 1];

    // Remove every mention of the newest record from the real text, exactly as a hand-maintained
    // index does when somebody adds a record and forgets the row.
    const mutated = real.split('`' + victim + '`').join('`0000-a-row-that-was-never-added.md`');
    const verdict = judgeEnumeration(derived, site.listed(mutated), []);

    assertTrue(
      'the mutant is refused',
      !verdict.ok,
      `the index lost ${victim} and the check reported it CLEAN — this is the exact defect of ` +
        '2026-09-13, when four rows were missing and nothing noticed',
    );
    assertTrue(
      'and the missing record is named, not merely counted',
      verdict.missing.includes(victim),
      `missing=[${verdict.missing.join(', ')}] does not name ${victim}`,
    );
    // The control: unmutated, the same call must be clean. Without it a comparator that refused
    // everything would satisfy the assertion above.
    const control = judgeEnumeration(derived, site.listed(real), []);
    assertTrue('control: the unmutated index is clean', control.ok, `missing=[${control.missing.join(', ')}] extra=[${control.extra.join(', ')}]`);
  });

  suite.test('REAL-CORPUS MUTANT: a live registered site, held against a stale figure', () => {
    // *** IT NAMED `claude-md/decisions-cell/ADRs` UNTIL 2026-09-13 AND THAT SITE NO LONGER
    // EXISTS — deleted because the Team Lead removed the figure, which is this gate's designed
    // outcome. A mutant holding a site's NAME goes red for a correct change; a mutant that takes
    // whichever site is registered does not. *** Same rule that carried the enum-partition check
    // through four renames in one hour: derive the subject from the artifact, never transcribe it
    // alongside (`workflow.md` §11a).
    //
    // The floor matters more than usual here, because the derivation can legitimately empty out:
    // every site removed is the ruling fully satisfied, at which point this case has nothing to
    // mutate and must SAY SO rather than pass over an empty list.
    const site = TOTAL_SITES[0];
    assertTrue(
      'at least one count site is registered for this mutant to drive',
      site !== undefined,
      'TOTAL_SITES IS EMPTY. That is not a failure of the product — it means every restated figure ' +
        'has been removed and the ruling is fully satisfied, which is the goal. But this case then ' +
        'proves nothing, and a vacuous green is what it exists to prevent: DELETE IT, and rely on ' +
        'the enumeration sites, which need no figure.',
    );
    if (site === undefined) return;
    console.log(`      mutant driven against: ${site.id}`);

    const derivation = DERIVATIONS.find((entry) => entry.id === site.catalogue);
    assertTrue(`the site's catalogue ${site.catalogue} exists`, derivation !== undefined, site.catalogue);
    if (derivation === undefined) return;

    const text = read(site.file);
    const region = regionFor(text, site.anchor);
    assertTrue(`the anchor still selects a region in ${site.file}`, region.length > 0, 'the anchor has drifted');

    // THE TRUE POPULATION IS DERIVED FROM THE SITE'S OWN CATALOGUE, not from `DERIVATIONS[0]`.
    // The earlier version hardcoded both the catalogue and the stale value (`41`), which was
    // right only while the first registered site happened to be a decision-records one. It is
    // now an agent-definitions site, and `DERIVATIONS[0]` would have compared 8 agent definitions
    // against 45 decision records — a control that fails for a reason unrelated to the property.
    const trueCount = derivation.derive().length;

    // The mutation is on the DERIVED side rather than the file: hold the real prose against a
    // population it does not have. `trueCount + 1` is wrong for any site and any catalogue, so
    // the mutant survives the registry changing under it. Nothing on disk is touched, so no other
    // agent can see a broken tree (`workflow.md` §2a-i).
    const stale = judgeSite(region, site.subject, trueCount + 1, site.exemptions, text);
    assertTrue(
      `prose stating ${String(trueCount)} is refused when the derived population is ${String(trueCount + 1)}`,
      !stale.ok,
      `the live ${site.id} agreed with a population it does not have — the comparison does not fire ` +
        'on real prose, whatever it does on constructed input',
    );
    const control = judgeSite(region, site.subject, trueCount, site.exemptions, text);
    assertTrue('control: against the true population it is clean', control.ok, control.reason);
  });

}

function assertDeep(label: string, actual: readonly string[], expected: readonly string[]): void {
  assertEqual(label, actual.join('|'), expected.join('|'));
}
