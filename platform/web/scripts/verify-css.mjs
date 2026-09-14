/**
 * Verifies that the BUILT stylesheet flips.
 *
 *   npm run build && npm run verify:css        (or just: npm run smoke)
 *
 * ===========================================================================
 * WHY THIS READS THE ARTIFACT AND NOT THE SOURCE
 * ===========================================================================
 *
 * **RTL is a property of the stylesheet, not of any component.** A file can be
 * written entirely in logical properties and still produce a sheet with a
 * physical rule in it — from a shared package, from a plugin, from a utility
 * quoted in a COMMENT. Tailwind v4 scans raw file text, so **naming a utility
 * class in prose compiles it into the bundle**: `platform/admin` has a comment
 * that deliberately refuses to spell four class names for exactly that reason,
 * after its first draft reintroduced two dead rules by explaining them.
 *
 * So a source scan is the wrong instrument twice over — it cannot see what a
 * dependency contributes, and it cannot distinguish a class that is used from a
 * class that is merely mentioned. **The artifact can.**
 *
 * ===========================================================================
 * WHY IT IS NOT IN `npm run verify`
 * ===========================================================================
 *
 * It needs `dist/`. A gate that fails on a clean checkout because nobody has
 * built yet is a gate people learn to pass by running something else — so this
 * is chained into `smoke`, which builds first, and `verify` keeps to checks
 * that hold on source alone.
 *
 * **IT DISTINGUISHES MISSING FROM STALE, AND REPORTS BOTH AS NOT RUN.**
 * `workflow.md` §10: passed, failed, skipped and not run are four states, and a
 * tool that cannot express the fourth is not reporting. A stale `dist/` is the
 * dangerous one — it answers confidently about the previous build, which is the
 * failure that produced four false results on the other console.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const PACKAGE = join(HERE, '..');
const SRC = join(PACKAGE, 'src');
const DIST_ASSETS = join(PACKAGE, 'dist', 'assets');

let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const okay = a === e;
  if (!okay) failures += 1;
  console.log(
    `${okay ? 'PASS' : 'FAIL'}  ${name}` +
      (okay ? '' : `\n        expected ${e}\n        actual   ${a}`),
  );
}

/**
 * A physical inline-axis declaration does not mirror under `dir="rtl"`.
 *
 * **Block-axis properties are deliberately absent from this list.** `top`,
 * `bottom`, `margin-block-*` and their kin are correct in an RTL document —
 * horizontal writing modes mirror the INLINE axis only. A check that flagged
 * them would be red on correct code within a day and switched off within a
 * week, which `workflow.md` §11a records as how a suite teaches a team to
 * ignore red.
 */
const PHYSICAL = [
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
  'border-left',
  'border-right',
  'text-align:left',
  'text-align:right',
];

/**
 * ⚠ A CORNER RADIUS CANNOT BE JUDGED ONE PROPERTY AT A TIME, AND THE FIRST
 * VERSION OF THIS FILE TRIED TO.
 *
 * It listed `border-top-left-radius` and its three siblings alongside the
 * properties above, **and immediately flagged two rules that are entirely
 * correct**: `rounded-t-*` compiles to `border-top-left-radius` +
 * `border-top-right-radius`, which is the two TOP corners — a BLOCK-axis
 * shape that mirrors perfectly under `dir="rtl"`.
 *
 * **The physical case is a pair on one INLINE side** — top-left with
 * bottom-left, or top-right with bottom-right, which is what `rounded-l-*` and
 * `rounded-r-*` produce and what should have been `rounded-s-*`/`rounded-e-*`.
 *
 * So the predicate is rule-scoped rather than string-scoped. **This matters
 * beyond correctness: a check that flags `rounded-t-lg` is red on correct code
 * within a day and switched off within a week** — `workflow.md` §11a's *a suite
 * that goes red under load teaches a team to ignore red*. The naive version was
 * caught by running the widened check against the real artifact before trusting
 * it, which is the only reason it is not in the gate today.
 */
const INLINE_CORNER_PAIRS = [
  ['border-top-left-radius', 'border-bottom-left-radius'],
  ['border-top-right-radius', 'border-bottom-right-radius'],
];

/** Every `selector { declarations }` rule, flat — nested at-rules included. */
function rulesOf(css) {
  return [...css.matchAll(/\{([^{}]*)\}/gu)].map((match) => match[1]);
}

function inlineCornerRules(css) {
  return rulesOf(css).filter((body) =>
    INLINE_CORNER_PAIRS.some(([a, b]) => body.includes(a) && body.includes(b)),
  );
}

/**
 * The logical families the sheet is expected to actually contain.
 *
 * **This is the floor, and without it the zero above means nothing.** A
 * stylesheet that used no inline-axis properties at all would report zero
 * physical ones and look perfect — while being a build that had lost its
 * layout. §11a: *the floor catches a check handed nothing; it does not catch a
 * check handed half*, so both numbers are printed rather than only the verdict.
 */
const LOGICAL = [
  'margin-inline-start',
  'margin-inline-end',
  'padding-inline-start',
  'padding-inline-end',
  'inset-inline-start',
  'border-inline',
  'text-align:start',
];

/** The newest mtime anywhere under `src/`, so a stale artifact can be detected. */
function newestSourceTime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const time = entry.isDirectory() ? newestSourceTime(full) : statSync(full).mtimeMs;
    if (time > newest) newest = time;
  }
  return newest;
}

console.log('\n=== The built stylesheet is direction-independent ===\n');

let names = [];
try {
  names = readdirSync(DIST_ASSETS).filter((file) => file.endsWith('.css'));
} catch {
  names = [];
}

if (names.length === 0) {
  console.log('NOT RUN  there is no built stylesheet under dist/assets — run `npm run build` first');
  console.log('\n1 check(s) NOT RUN. Not run is not a pass.');
  process.exit(2);
}

/*
 * EVERY STYLESHEET, NOT THE FIRST ONE. `readdirSync(...).find(...)` was the
 * first shape of this and it is the population defect this repository keeps
 * finding in its own instruments: one code-split sheet examined, the rest
 * reported on by silence.
 */
const sheets = names.map((name) => ({
  name,
  css: readFileSync(join(DIST_ASSETS, name), 'utf8'),
  time: statSync(join(DIST_ASSETS, name)).mtimeMs,
}));

const sourceTime = newestSourceTime(SRC);
const oldest = Math.min(...sheets.map((sheet) => sheet.time));
if (sourceTime > oldest) {
  console.log(
    'NOT RUN  dist/ is older than src/ — this would report on the PREVIOUS build.\n' +
      `         newest source ${new Date(sourceTime).toISOString()}\n` +
      `         oldest sheet  ${new Date(oldest).toISOString()}\n` +
      '         run `npm run build` and try again',
  );
  console.log('\n1 check(s) NOT RUN. Not run is not a pass.');
  process.exit(2);
}

const totalBytes = sheets.reduce((sum, sheet) => sum + sheet.css.length, 0);
const combined = sheets.map((sheet) => sheet.css).join('\n');
const physicalFound = PHYSICAL.filter((property) => combined.includes(property));
const logicalFound = LOGICAL.filter((property) => combined.includes(property));

console.log(
  `      population: ${sheets.length} stylesheet(s), ${totalBytes} bytes, ` +
    `${logicalFound.length} of ${LOGICAL.length} logical families present\n`,
);

check('the sheet really does use logical inline-axis properties', logicalFound.length >= 5, true);
check('and no physical inline-axis property survives into it', physicalFound, []);

/*
 * A FLOOR ON THE RULE READER, because the corner assertion below searches
 * whatever `rulesOf` produced. **A regex that stops matching yields zero rules,
 * finds no offending pair, and passes** — §11a's empty-list reader, in the half
 * of this check that had to be rewritten once already.
 */
const ruleCount = rulesOf(combined).length;
console.log(`      population: ${ruleCount} CSS rules read for the corner-radius pass\n`);
check('the rule reader found a plausible number of rules', ruleCount >= 100, true);
check('no rule rounds one inline side only', inlineCornerRules(combined), []);

/* =========================================================================
   Negative controls
   ========================================================================= */

console.log('\n=== Negative controls ===\n');

/**
 * §11a: *a check that is sound by accident is indistinguishable from one that
 * is sound by design.* Both cases below run the real predicates over
 * constructed strings. **Nothing on disk is touched**, so there is no §2a-i
 * mutant window to announce.
 */
function control(name, fired) {
  const okay = fired === true;
  if (!okay) failures += 1;
  console.log(`${okay ? 'PASS' : 'FAIL'}  control: ${name}${okay ? '' : ' — DID NOT FIRE'}`);
}

control(
  'a physical margin in the artifact is caught',
  PHYSICAL.filter((p) => '.a{margin-left:1px}'.includes(p)).length > 0,
);
control(
  'a physical text-align in the artifact is caught',
  PHYSICAL.filter((p) => '.a{text-align:right}'.includes(p)).length > 0,
);
/*
 * THE TWO CORNER CONTROLS ARE A PAIR AND NEITHER IS SUFFICIENT ALONE.
 * The first proves the predicate can fire; the second proves it is PRECISE —
 * that it does not fire on the correct construct that the first version of this
 * check flagged. **A control that only ever proves a check can go red does not
 * distinguish a good check from a blunt one.**
 */
control(
  'a one-sided corner radius is caught',
  inlineCornerRules('.a{border-top-left-radius:2px;border-bottom-left-radius:2px}').length > 0,
);
control(
  'and rounding both TOP corners is NOT caught, because it mirrors correctly',
  inlineCornerRules('.a{border-top-left-radius:2px;border-top-right-radius:2px}').length === 0,
);
control(
  'the rule reader would refuse an empty stylesheet',
  rulesOf('/* nothing */').length < 100,
);
control(
  'a sheet with no inline-axis properties at all fails the floor',
  LOGICAL.filter((p) => '.a{color:red}'.includes(p)).length < 5,
);
/*
 * AND THE ONE THAT MATTERS MOST, because it is the case the first draft of this
 * file would have passed: a physical property present in the SECOND stylesheet
 * only. The `find`-the-first-sheet version reported clean on exactly this.
 */
control(
  'a physical property in a second stylesheet is caught',
  PHYSICAL.filter((p) => ['.a{color:red}', '.b{padding-right:4px}'].join('\n').includes(p)).length > 0,
);
control(
  'a block-axis property is NOT caught, because it is correct in RTL',
  PHYSICAL.filter((p) => '.a{margin-top:1px;bottom:0}'.includes(p)).length === 0,
);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
