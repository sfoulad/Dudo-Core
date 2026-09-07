/**
 * ===========================================================================================
 * CONTROL BYTES IN SOURCE FILES. THE CHECK THAT WOULD HAVE CAUGHT THREE NULs IN THE LARGEST
 * HANDLER FILE IN THE PLATFORM.
 * ===========================================================================================
 *
 * *** THE HARM IS NOT COSMETIC, AND IT IS NOT TO THE FILE — IT IS TO EVERY TOOL THAT READS IT. ***
 *
 * A single NUL makes `file(1)` classify a source file as `data`, and **plain `grep` then finds
 * nothing in it and does not say so.** No error, no "binary file matches", no zero count — empty
 * output, which is indistinguishable from "no match". On 2026-09-07 that made the Team Lead
 * conclude a handler did not exist when it was sitting at line 1202, and they were one message from
 * commissioning a rewrite of working code. It was caught only by asking whether the grep could find
 * ANYTHING at all in a 1,651-line file.
 *
 * SO THE DEGRADATION IS SILENT AND IT IS PLATFORM-WIDE: every future `grep` by every agent over
 * that file, including security sweeps and QA's censuses, quietly examines nothing.
 *
 * **This is the family `.claude/rules/workflow.md` §11a is about — a check that returns nothing is
 * indistinguishable from a check that found nothing wrong — arriving through the FILE rather than
 * through the checker.**
 *
 * ===========================================================================================
 * WHAT IT REFUSES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================================
 *
 * REFUSED: every C0 control byte except tab (0x09) and newline (0x0A), plus DEL (0x7F). NUL is the
 * one that has actually bitten, five times; the others are refused because they are invisible in an
 * editor and in a diff for exactly the same reason and nobody has a use for them in source.
 *
 * CARRIAGE RETURN (0x0D) IS REFUSED TOO. It is legitimate in a CRLF checkout, and this repository
 * has none — a CR here means a byte someone did not mean to type, which is the whole subject.
 *
 * NOT REFUSED: anything above 0x7F. Arabic, accents and emoji in comments are ordinary content, and
 * a check that flagged them would be reporting on language rather than on invisibility.
 *
 * ===========================================================================================
 * *** REBUILT 2026-09-07 AFTER `qa-agent` MUTATION-TESTED IT AND IT CAUGHT ONE OF SIX. ***
 * ===========================================================================================
 *
 * QA copied this file, applied one mutation at a time, ran each mutant against the real tree, and
 * looked for `SELF-TEST FAILED`. The result was the reason this rewrite exists:
 *
 *   M1  NUL no longer detected at all              CAUGHT
 *   M2  CR allowed                                 not caught
 *   M3  off-by-one: `byte < 0x1f` not `< 0x20`     not caught
 *   M4  DEL stops being forbidden                  not caught
 *   M5  SEVERE = 0x01 — severity inverted          not caught
 *   M6  `.ts` dropped from EXTENSIONS              not caught
 *
 * **THE SELF-TEST VERIFIED ONE PREDICATE ON ONE BYTE.** Every other property this file argues
 * for — the CR ruling, the 0x20 boundary, DEL, the severity ranking, the walk — was stated in prose
 * and executed nowhere. *"Expressed" and "enforced" differ on two axes and this got both wrong.*
 *
 * *** M6 IS WHY THIS MATTERED, AND IT IS THE POPULATION HALF OF §11a OCCURRING INSIDE THE CHECKER
 * WRITTEN TO TEACH IT. *** Dropping `.ts` made BOTH known NUL files vanish from the report and the
 * whole SEVERE section disappear — **and the scanner still exited 1**, on the DEL byte in a `.mjs`
 * file that survived the mutation. A triager reading a red build would see a hygiene finding and
 * reasonably conclude the severe problem was gone. The self-test passed. The floor passed, because
 * 181 files is comfortably over 50.
 *
 * This file's own header quoted *"a floor proves the check found SOMETHING; it does not prove it
 * found EVERYTHING"* — and implemented only the floor.
 *
 * WHAT CHANGED, ALL FOUR OF QA'S PROPOSALS:
 *
 *   1. A BYTE TABLE in the self-test rather than one byte. Closes M1-M4.
 *   2. THE SEVERITY SPLIT IS SELF-TESTED, which required extracting it into a function. Closes M5.
 *   3. PER-EXTENSION COUNTS asserted against pinned minimums. Closes M6 — a dropped extension shows
 *      as `.ts: 0` against a floor of 150, by name, instead of as a smaller total nobody compares.
 *   4. THE WALK REACHES `docs/`, `.claude/`, `.github/`, `agents/`, `tools/` and the root files.
 *      `.claude/rules/**` and `docs/decisions/**` are exactly the files whose greppability the team
 *      depends on, and a NUL in a rules file was invisible to this check. Latent, not current:
 *      QA's independent census of 492 non-binary files found the 98 outside reach all clean.
 */

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOTS = [
  'platform', 'apps', 'packages', 'connectors', 'scripts', 'tools', 'agents',
  // ADDED 2026-09-07. A NUL in a rules file or a decision record would have been invisible to this
  // check, and those are the documents every agent greps to do its job.
  'docs', '.claude', '.github',
  // Root files, named individually because the walk starts at directories.
  'worker.ts', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'package.json', 'tsconfig.json', 'wrangler.jsonc', 'wrangler.admin.jsonc', '.coderabbit.yaml',
];

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json', '.jsonc', '.sql', '.yaml', '.yml', '.md', '.css', '.html'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.wrangler']);

/**
 * *** THE ANSWER TO M6, AND THE REASON IT IS A MAP RATHER THAN A TOTAL. ***
 *
 * The floor below counts FILES. A total cannot distinguish "the tree shrank" from "an extension
 * stopped matching", and M6 proved the difference is the whole finding: dropping `.ts` took the
 * total from 394 to 181 and hid both severe files while still exiting 1.
 *
 * ITERATION IS OVER THIS MAP, NOT OVER WHAT WAS FOUND. An extension removed from `EXTENSIONS`
 * therefore reports `0` against its minimum BY NAME, rather than silently ceasing to have a row.
 *
 * The numbers are pinned well below today's counts so ordinary deletion does not cry wolf, and far
 * enough above zero that losing an extension is unmissable. **A number that can only be edited
 * deliberately is a number someone has to look at** (§11a). Today: .ts 213, .tsx 35, .json 54,
 * .sql 20, .yaml 18, .md 80+, .mjs 14, .js 16, .css 5, .html 3.
 *
 * `.yml` and `.jsonc` are DELIBERATELY ABSENT from this map rather than pinned at zero, because a
 * minimum on config files asserts which config files happen to exist, and both sets are ones
 * someone may legitimately prune. **They are still scanned** — absence from this map means "not
 * pinned", never "not examined", which is why the tally below prints the unpinned remainder.
 *
 * *** THE SENTENCE THAT WAS HERE SAID "there is exactly one `.jsonc` and no `.yml` today". IT WAS
 * WRONG IN BOTH HALVES — there are TWO `.jsonc` (`wrangler.jsonc`, `wrangler.admin.jsonc`) and
 * THREE `.yml` (`.github/ISSUE_TEMPLATE/`). ***
 *
 * `qa-agent` found it by arithmetic: **the printed per-extension line summed to 482 against a
 * printed total of 487, and the gap was exactly the two extensions the rationale described.** That
 * is `architecture.md` §3c — a sentence precise enough to read as measured, which stops the next
 * reader counting.
 *
 * **The conclusion survives and the correction cuts AGAINST it**, which is worth recording rather
 * than quietly repairing: three issue templates is a marginally better argument FOR a minimum than
 * "none exist". The decision holds on the reason above, which is about what a minimum *asserts* —
 * not on a count that was never checked.
 *
 * **AND THE ARITHMETIC GAP IS NOW CLOSED AT THE OUTPUT, NOT ONLY IN THIS COMMENT.** A reader should
 * not have to sum ten numbers to discover the line does not reconcile. It prints the remainder and
 * fails if the parts do not add up to the whole.
 */
const EXTENSION_MINIMUMS = new Map([
  ['.ts', 150], ['.tsx', 20], ['.json', 30], ['.sql', 10],
  ['.yaml', 10], ['.md', 40], ['.mjs', 5], ['.js', 5], ['.css', 1], ['.html', 1],
  // EXPLICIT ZEROES, NOT OMISSIONS. A minimum on config files asserts which config files happen to
  // exist, and both sets are ones someone may legitimately prune — so the expectation is "nothing,
  // deliberately", which is a thing an author can write down. **Writing it down is the point:** see
  // `assertEveryScannedExtensionIsAccounted` below.
  //
  // *** A ZERO HERE MUST CARRY A REASON, AND THAT IS NOT DECORATION. *** `qa-agent` measured two
  // deliberate survivors — setting `.ts`'s minimum to `0` or `1` keeps the extension accounted,
  // keeps `unpinned` at zero, and passes the population check, **so the tripwire that catches M6 is
  // disabled by editing a number rather than by removing a key.** That is the ACCEPTED RESIDUAL and
  // not a gap: this mechanism converts STRUCTURAL drift into failures and deliberately leaves a
  // NUMERIC edit as a deliberate act — *"a number that can only be edited deliberately is a number
  // someone has to look at."*
  //
  // **The shape to notice is a zero with no reason beside it.** `.jsonc`'s zero means "deliberately
  // unpinned"; a lowered `.ts` would mean "somebody moved this", and in this map they look
  // identical. The reason is the only thing that distinguishes them, so an unexplained zero is the
  // thing to challenge in review.
  ['.jsonc', 0], ['.yml', 0],
]);

/**
 * *** EVERY SCANNED EXTENSION MUST HAVE AN ENTRY. THIS REPLACED AN ASSERTION THAT COULD NOT FAIL. ***
 *
 * The previous version computed `unpinned = files.length - pinnedTotal` and then asserted
 * `pinnedTotal + unpinned === files.length`. **That is true by construction.** `qa-agent`
 * constructed the failing inputs rather than reading the line, and measured:
 *
 *   B   the `unpinned` formula corrupted (+7)                        FIRES
 *   C   `unpinned` driven negative                                   FIRES
 *   A1  `.md` dropped from the MINIMUMS map — 97 files unaccounted   does NOT fire, `unpinned 102`
 *   A2  `.ts` dropped from the MINIMUMS map — 215 files unaccounted  does NOT fire, `unpinned 220`
 *
 * **Unaccounted files flow into the remainder and the remainder always adds up, because it is
 * DEFINED as whatever is left.** A2 is the one that matters: `.ts`'s minimum is what catches M6, so
 * after A2, dropping `.ts` from `EXTENSIONS` is M6 again with nothing to catch it — **two steps
 * instead of one, and the second step is silent.** Both mutants exit 1 today only on Core's
 * pre-existing NUL findings; **once those are fixed, A2 exits 0 with 215 files unaccounted.**
 *
 * **B and C are real edits someone will make, so the reconciliation stays.** What was wrong was the
 * sentence beside it claiming it caught "a scanned extension nobody accounted for" — the one case it
 * could not see.
 *
 * **THE REPAIR IS `architecture.md` §3a APPLIED TO A CHECK RATHER THAN A WRITE:** an extension
 * cannot be scanned without someone having written down what they expect of it. The tally then
 * reconciles **by enumeration rather than by subtraction**, `unpinned` is structurally zero, and
 * removing a key stops being a silent edit.
 *
 * **AND THE REASON THIS EXISTED AT ALL IS THE THIRD INSTANCE IN ONE DAY OF ONE HABIT:** a fix
 * verified only against the failure that prompted it. The scanner was verified against QA's six
 * mutations; the `.yml`/`.jsonc` rationale against a count nobody took; and this assertion against
 * the arithmetic gap that inspired it — **never against an input it should refuse.**
 */
function assertEveryScannedExtensionIsAccounted() {
  const missing = EXTENSIONS.filter((extension) => !EXTENSION_MINIMUMS.has(extension));
  if (missing.length === 0) return;
  console.error(`FAIL — UNACCOUNTED: ${missing.join(', ')} scanned with no entry in EXTENSION_MINIMUMS.`);
  console.error('      Files of that kind would be examined and counted, and their absence from the');
  console.error('      pinned tally would vanish into the remainder, which reconciles by definition.');
  console.error('      Add an entry. "0, deliberately" is a valid expectation and must be written');
  console.error('      down, because a key nobody wrote is a key anyone can silently remove.');
  process.exit(1);
}

/** Tab and newline are the only C0 bytes a source file may carry. */
function isForbiddenByte(byte) {
  if (byte === 0x09 || byte === 0x0a) return false;
  return byte < 0x20 || byte === 0x7f;
}

function sourceFiles(path, found) {
  if (!existsSync(path)) return found;
  if (!statSync(path).isDirectory()) {
    if (EXTENSIONS.some((extension) => path.endsWith(extension))) found.push(path);
    return found;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      sourceFiles(join(path, entry.name), found);
    } else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(join(path, entry.name));
    }
  }
  return found;
}

/** Every forbidden byte in one file, as `{ line, column, byte }`. */
function forbiddenBytes(path) {
  const bytes = readFileSync(path);
  const hits = [];
  let line = 1;
  let column = 1;
  for (const byte of bytes) {
    if (byte === 0x0a) {
      line += 1;
      column = 1;
      continue;
    }
    if (isForbiddenByte(byte)) hits.push({ line, column, byte });
    column += 1;
  }
  return hits;
}

/**
 * ===========================================================================================
 * NOT ALL CONTROL BYTES ARE THE SAME DEFECT, AND THE DIFFERENCE WAS MEASURED RATHER THAN ASSUMED.
 * ===========================================================================================
 *
 *   byte              plain `grep`              `git diff`              severity
 *   ------------------------------------------------------------------------------------
 *   NUL (0x00)        SILENTLY FINDS NOTHING    binary — NO HUNKS       **severe**
 *   DEL, 0x01, ...    works normally            works normally          cosmetic
 *
 * **`file(1)` REPORTS BOTH AS `data`, WHICH IS EXACTLY WHY THEY LOOK EQUIVALENT** and why the
 * ranking matters more than the detection. Measured on the real files: `git grep` returns matches
 * inside the DEL-bearing file and `grep -c ''` counts its lines; neither works on a NUL-bearing one.
 *
 * *** A CHECKER THAT REPORTS BOTH AT ONE SEVERITY GETS TURNED OFF BY WHOEVER IS TRIAGING UNDER TIME
 * PRESSURE. *** Both still fail the build — a cosmetic defect nobody is told about is never fixed —
 * but they are reported in separate sections with different instructions, so the severe one cannot
 * be lost among the others.
 *
 * *** THE PARTITION IS A FUNCTION SO THE SELF-TEST CAN PUSH A FIXTURE THROUGH IT (QA's M5). ***
 * Inverting `SEVERE` to `0x01` put both NUL files under a heading reading *"these files grep and
 * diff NORMALLY — measured, not assumed"*. **That sentence would have been false and would have been
 * read as measured**, which is worse than an unlabelled finding.
 */
const SEVERE = 0x00;

function partitionBySeverity(hits) {
  return {
    nuls: hits.filter((hit) => hit.byte === SEVERE),
    others: hits.filter((hit) => hit.byte !== SEVERE),
  };
}

function describe(byte) {
  if (byte === SEVERE) return 'NUL (0x00)';
  if (byte === 0x0d) return 'CR (0x0D)';
  if (byte === 0x7f) return 'DEL (0x7F)';
  return `control byte 0x${byte.toString(16).padStart(2, '0')}`;
}

// =============================================================================================
// THE SELF-TEST. IT RUNS FIRST, IT RUNS EVERY TIME, AND IT IS NOW A TABLE.
//
// `workflow.md` §11a: *"a check ships with a known-failing input, or it has not been verified —
// only observed."* The fixture is CONSTRUCTED at run time and the reason is itself the finding:
// `Write` cannot emit a NUL — tested directly, and measured again as `61 00 62` -> `61 20 62` on a
// read-write round trip — so a committed fixture could not be authored through sanctioned tools,
// and creating one through the shell is what §9 forbids. A byte array needs neither.
// =============================================================================================

const scratch = mkdtempSync(join(tmpdir(), 'source-bytes-control-'));
let selfTestFailures = 0;
const fail = (message) => {
  console.error(`SELF-TEST FAILED: ${message}`);
  selfTestFailures += 1;
};

try {
  // ---- 1. THE BYTE TABLE. Each byte must be classified exactly as stated. Boundary pairs are the
  // point: 0x1F/0x20 are adjacent, and so are 0x7F/0x80. QA's M3 was an off-by-one at the first.
  const BYTE_TABLE = [
    { byte: 0x00, forbidden: true, why: 'NUL — the byte that has actually bitten, five times' },
    { byte: 0x01, forbidden: true, why: '0x01 — found in a real test suite this week' },
    { byte: 0x0d, forbidden: true, why: 'CR — refused deliberately; this repository has no CRLF' },
    { byte: 0x1f, forbidden: true, why: '0x1F — the last forbidden C0 byte, boundary of M3' },
    { byte: 0x7f, forbidden: true, why: 'DEL — found in a real script this week' },
    { byte: 0x09, forbidden: false, why: 'tab — ordinary' },
    { byte: 0x0a, forbidden: false, why: 'newline — ordinary' },
    { byte: 0x20, forbidden: false, why: 'space — the other side of the 0x1F/0x20 boundary' },
  ];
  for (const entry of BYTE_TABLE) {
    if (isForbiddenByte(entry.byte) !== entry.forbidden) {
      fail(
        `byte 0x${entry.byte.toString(16).padStart(2, '0')} should be ` +
          `${entry.forbidden ? 'FORBIDDEN' : 'allowed'} — ${entry.why}`,
      );
    }
  }

  // ---- 2. DETECTION END TO END, not just the predicate. A NUL between two ordinary words, which
  // is exactly the shape that got into the tree.
  const dirty = join(scratch, 'dirty.ts');
  writeFileSync(dirty, Buffer.from([0x61, 0x62, 0x00, 0x63, 0x0a]));
  const dirtyHits = forbiddenBytes(dirty);
  if (dirtyHits.length !== 1 || dirtyHits[0].byte !== 0x00) {
    fail('a file containing a NUL was not flagged. The detector is broken.');
  }

  // ---- 3. AND THE NEGATIVE HALF: tabs, newlines and non-ASCII must NOT be flagged. A check that
  // flags everything passes every "does it detect" test and is useless.
  const clean = join(scratch, 'clean.ts');
  writeFileSync(clean, Buffer.from('const x = 1;\n\t// مرحبا — em dash 😀\n', 'utf8'));
  if (forbiddenBytes(clean).length !== 0) {
    fail('tabs, newlines or non-ASCII text were flagged. Too blunt.');
  }

  // ---- 4. THE SEVERITY SPLIT (QA's M5). A NUL must land in `nuls`; a DEL must land in `others`.
  // Inverting SEVERE files both under a heading asserting they "grep and diff NORMALLY".
  const mixed = partitionBySeverity([{ line: 1, column: 1, byte: 0x00 }, { line: 2, column: 1, byte: 0x7f }]);
  if (mixed.nuls.length !== 1 || mixed.nuls[0].byte !== 0x00) {
    fail('a NUL was not classified as SEVERE. The ranking is inverted or broken.');
  }
  if (mixed.others.length !== 1 || mixed.others[0].byte !== 0x7f) {
    fail('a DEL was not classified as hygiene. The ranking is inverted or broken.');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (selfTestFailures > 0) {
  console.error('      A scanner that has only ever been handed passing input has been observed,');
  console.error('      not verified (.claude/rules/workflow.md §11a). Refusing to report on the tree.');
  process.exit(1);
}

// =============================================================================================
// THE SCAN
// =============================================================================================

const files = [];
for (const root of ROOTS) sourceFiles(root, files);

const severe = [];
const cosmetic = [];
for (const file of files) {
  const hits = forbiddenBytes(file);
  if (hits.length === 0) continue;
  const render = (list) =>
    `${relative('.', file)}\n      ${list
      .slice(0, 5)
      .map((hit) => `line ${String(hit.line)}, column ${String(hit.column)}: ${describe(hit.byte)}`)
      .concat(list.length > 5 ? [`... and ${String(list.length - 5)} more`] : [])
      .join('\n      ')}`;

  const { nuls, others } = partitionBySeverity(hits);
  if (nuls.length > 0) severe.push(render(nuls));
  if (others.length > 0) cosmetic.push(render(others));
}
const failures = [...severe, ...cosmetic];

// ---- THE POPULATION. Reported BEFORE what was found, and reported PER EXTENSION so that an
// extension which stopped matching is named rather than absorbed into a smaller total. ----

const byExtension = new Map();
for (const file of files) {
  const extension = extname(file);
  byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1);
}

const pinnedTotal = [...EXTENSION_MINIMUMS.keys()].reduce(
  (sum, extension) => sum + (byExtension.get(extension) ?? 0),
  0,
);
const unpinned = files.length - pinnedTotal;
const tally = [...EXTENSION_MINIMUMS.keys()]
  .map((extension) => `${extension} ${String(byExtension.get(extension) ?? 0)}`)
  .join(' · ');
console.log(`source bytes: ${String(files.length)} files examined (self-test passed)`);
console.log(`              ${tally} · unpinned ${String(unpinned)}`);

// ---- THE TWO CHECKS THAT MAKE THE TALLY MEAN SOMETHING, AND THEY CATCH DIFFERENT THINGS. ----
//
// FIRST, and it is the load-bearing one: EVERY SCANNED EXTENSION HAS AN ENTRY. Without it, dropping
// a key from EXTENSION_MINIMUMS moves its files into the remainder and everything still reconciles
// — measured by qa-agent at 215 unaccounted `.ts` files with nothing firing. See the function.
assertEveryScannedExtensionIsAccounted();

// SECOND, the arithmetic. It is TRUE BY CONSTRUCTION for the case above — `unpinned` is defined as
// the leftover — and it is kept anyway, narrowly scoped to what it can actually see: someone editing
// the `unpinned` computation itself, which qa-agent's mutations B and C both are. `unpinned` should
// now be STRUCTURALLY ZERO, so a non-zero value means a file matched no extension at all.
if (unpinned !== 0 || pinnedTotal + unpinned !== files.length) {
  console.error(`FAIL — ARITHMETIC: ${String(unpinned)} file(s) counted under no pinned extension.`);
  console.error('      Every scanned extension has an entry, so this should be zero. A non-zero');
  console.error('      value means the tally and the walk disagree about what was examined.');
  process.exit(1);
}

let populationFailures = 0;
for (const [extension, minimum] of EXTENSION_MINIMUMS) {
  const count = byExtension.get(extension) ?? 0;
  if (count < minimum) {
    console.error(
      `FAIL — POPULATION: ${extension} matched ${String(count)} files, expected at least ` +
        `${String(minimum)}.`,
    );
    populationFailures += 1;
  }
}

if (populationFailures > 0) {
  console.error('      An extension that stops matching hides every file of that kind — and the');
  console.error('      scanner keeps exiting 1 on whatever survives, so a triager sees a smaller');
  console.error('      finding and concludes the larger one is gone. Dropping `.ts` once hid BOTH');
  console.error('      known NUL files and the entire SEVERE section while still failing the build.');
  console.error('      If the tree genuinely shrank, move the pinned minimum DELIBERATELY.');
  process.exit(1);
}

if (files.length < 50) {
  console.error(`FAIL: only ${String(files.length)} files matched. This repository has hundreds.`);
  console.error('      A glob that stopped matching examines nothing and reports success, which is');
  console.error('      the most confident wrong answer a check can give.');
  process.exit(1);
}

if (severe.length > 0) {
  console.error(
    `\nFAIL — SEVERE: ${String(severe.length)} file(s) contain a NUL and are INVISIBLE TO ` +
      'TOOLING:\n',
  );
  for (const failure of severe) console.error(`  - ${failure}\n`);
  console.error('  *** THESE FILES CANNOT BE GREPPED AND CANNOT BE REVIEWED. ***');
  console.error('  Plain `grep` returns NOTHING over the whole file, silently — no error, no');
  console.error('  "binary file matches", no zero — so every later search examines nothing and');
  console.error('  looks clean. `git diff` reports them as binary with NO HUNKS AT ALL, so a change');
  console.error('  to one lands unreviewable. A search for a security control in such a file has');
  console.error('  already been mistaken for the control being absent.');
  console.error('  FIX: `String.fromCharCode(0)`, never a typed byte. The BYTE is usually correct —');
  console.error('  a NUL separator that cannot occur in either component is the right design — and');
  console.error('  it is the SPELLING that has to change, so the value must not move.');
  console.error('  *** NEVER BY A WHOLE-FILE REWRITE. *** A read-then-write round trip converts');
  console.error('  every NUL you REPRODUCE into a space — measured, `61 00 62` -> `61 20 62` — and');
  console.error('  it typechecks, runs, and passes tests. Only bytes you DELIBERATELY replace with');
  console.error('  String.fromCharCode(0) survive. Try `Edit` first: it is inconsistent, not');
  console.error('  impossible, it costs one call and it risks nothing.\n');
}

if (cosmetic.length > 0) {
  console.error(
    `\nFAIL — hygiene: ${String(cosmetic.length)} file(s) carry a non-NUL control byte:\n`,
  );
  for (const failure of cosmetic) console.error(`  - ${failure}\n`);
  console.error('  These files grep and diff NORMALLY — measured, not assumed. They are invisible');
  console.error('  in an editor and in review, which is reason enough to spell them, but they do');
  console.error('  not disable anyone else\'s tools. Fix them after the NULs, not before.\n');
}

if (failures.length > 0) {
  process.exit(1);
}

console.log('source bytes: OK — no control bytes outside tab and newline.');
