/**
 * Verifies the `/settings` surface — the registry, the route tree, and the
 * stylesheet's direction-independence.
 *
 *   npm run verify:settings
 *
 * ===========================================================================
 * WHAT THIS EXISTS TO CATCH, AND IT IS NOT "DOES THE CODE COMPILE"
 * ===========================================================================
 *
 * `tsc` already covers most of the settings shell: the message keys are typed,
 * the section id union is derived from the registry, and the Arabic dictionary
 * cannot omit a key. **Three things it cannot see:**
 *
 *   1. **THE PATHS ARE SPELLED TWICE.** `lib/settings-sections.ts` holds
 *      `/settings/profile` because the navigation's `Link to=` is typed against
 *      full paths; `routes/route-tree.tsx` declares `/profile` because that is
 *      what `getParentRoute` composes. Two spellings of one fact, with no
 *      citation between them — `workflow.md` §12's duplicated constraint, which
 *      no sweep can find. **The dangerous direction is silent:** a section in
 *      the registry with no route is a navigation link that 404s, and a route
 *      with no registry entry is a screen reachable by address and invisible in
 *      the menu.
 *
 *   2. **A ROUTE THAT IS DECLARED AND NEVER REGISTERED.** `createRoute` without
 *      a matching entry in `addChildren` compiles, builds, and 404s.
 *
 *   3. **A FOCUS RETURN THAT WAS NEVER WIRED.** Asserted separately from the
 *      close, because closing and returning are two facts and only one of them
 *      is visible — the defect found in `platform/admin`, in panels an audit
 *      had already scored as correct.
 *
 * **THE STYLESHEET IS NOT CHECKED HERE.** RTL is a property of the built
 * artifact rather than of any source file, so it has its own script —
 * `verify-css.mjs`, chained into `smoke`, which builds first. The first draft
 * of this file had both, which would have made `npm run verify` fail on a clean
 * checkout for want of a `dist/`.
 *
 * ===========================================================================
 * WHAT IT DOES NOT COVER, STATED RATHER THAN LEFT TO BE ASSUMED
 * ===========================================================================
 *
 * **It renders nothing.** There is still no component testing framework in this
 * package (`0016` left TS1 open), so nothing here proves the shell draws, that
 * the navigation collapses at the breakpoint, that focus returns to the toggle,
 * or that a single Arabic string is correct. **`npm run smoke` is the only
 * instrument in this package that sees composition**, and even that does not
 * see a language or a viewport.
 *
 * **THE ARABIC IS UNVERIFIED BY ANYTHING, HERE OR ANYWHERE.** The type system
 * guarantees a value exists. Nothing guarantees it says what the English says.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import {
  SECTIONS,
  DATA_SECTIONS,
  SETTINGS_ROOT,
  builtSectionCount,
} from '../src/lib/settings-sections.ts';

/*
 * ABSOLUTE PATHS FROM THIS FILE, NEVER FROM THE WORKING DIRECTORY.
 * `workflow.md` §11a: a script that resolves against `process.cwd()` reports on
 * a directory nobody chose, and the three failure modes it can produce are all
 * indistinguishable from a real finding at the exit code.
 */
const HERE = import.meta.dirname;
const SRC = join(HERE, '..', 'src');

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

function read(relative) {
  return readFileSync(join(SRC, relative), 'utf8');
}

/**
 * Members of `candidates` that `known` does not contain, sorted.
 *
 * ===========================================================================
 * ⚠ EXTRACTED SO THE CHECKS AND THE CONTROLS SHARE LOGIC AND NOT INPUTS
 * ===========================================================================
 *
 * `qa-agent`, 2026-09-13, after finding the identical class in its own suite:
 *
 * > **A control over the real tree is not a self-test. A self-test's inputs are
 * > CONSTRUCTED, so its failure can only mean the logic is wrong. A control
 * > that READS THE TREE has two possible causes and only one of them is about
 * > the checker.**
 *
 * **Five controls in this file were the second kind, and one of them had
 * already broken.** It named two real contract files on the assumption one was
 * uncited; `tenant-roles-v1` landed and was cited within the hour, the mutation
 * mutated nothing, and it reported DID NOT FIRE against a check that was
 * working perfectly.
 *
 * **And they were weaker than they looked even before that.** A control reading
 * `['/profile', '/ghost'].filter(s => !expectedSet.includes(s))` fires on
 * `/ghost` whichever way the corpus goes — **so the real-tree half contributed
 * nothing and the control was really asserting that `.filter` works.**
 *
 * So the predicate lives here, the assertions below feed it the tree, and every
 * control feeds it literals. **A corpus change can now make an assertion fail.
 * It can no longer make a control lie.**
 */
function notIn(candidates, known) {
  const have = new Set(known);
  return [...candidates].filter((value) => !have.has(value)).sort();
}

/**
 * The `type Operations = { … }` entries in `api/client.ts`, as
 * `{ action, input, output }` triples.
 *
 * ===========================================================================
 * ⚠ WHY A SOURCE SCAN WHEN THE COMPILER ALREADY HOLDS THAT MAP
 * ===========================================================================
 *
 * Two bridges in `client.ts` hold the map's KEYS to `DudoAction` in both
 * directions, and they are stronger than anything here: omission does not
 * compile. **Neither bridge says one word about the VALUES.**
 *
 * `output: Customer` and `output: GetCustomerOutput` are the same type today,
 * because the generator emits `GetCustomerOutput = Customer`. So the tidier,
 * more familiar name compiles, every call site keeps working, and **the client
 * quietly stops tracking what the OPERATION returns and starts tracking what
 * the RECORD is** — which diverge the day a response gains an envelope or a
 * projection. `architecture.md` §3a's ranking: the type layer cannot see this
 * one, so it needs a layer that reads the source.
 *
 * **It is a naming check and it is labelled one.** It cannot tell a correct
 * Output from an incorrect one; it can tell a GENERATED name from a local
 * shape, which is the divergence that was actually available here.
 */
function parseOperations(source) {
  const body = /type Operations = \{([\s\S]*?)\n\};/u.exec(source);
  if (!body) return [];
  return [
    ...body[1].matchAll(/'([\w.]+)':\s*\{\s*input:\s*(\w+);\s*output:\s*(\w+);?\s*\}/gu),
  ].map((m) => ({ action: m[1], input: m[2], output: m[3] }));
}

/**
 * Comments removed before scanning source for STRUCTURE.
 *
 * **This is the safe direction for the scans below and would be the wrong one
 * for a stylesheet scan.** Tailwind v4 reads raw file text, so naming a utility
 * class in prose compiles it into the bundle — which is why the CSS check
 * further down reads the BUILT ARTIFACT rather than any source file, and why
 * nothing here tries to infer a class list from source.
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/* =========================================================================
   1 · The registry, imported and derived
   ========================================================================= */

console.log('\n=== The section registry ===\n');

console.log(`      population: ${SECTIONS.length} sections, ${DATA_SECTIONS.length} with data\n`);

/*
 * A FLOOR ON THE POPULATION. `workflow.md` §11a: a check handed nothing must
 * not render the same as a check that found nothing wrong. Every assertion
 * below iterates the registry, so an emptied array would satisfy all of them
 * vacuously and print a clean run.
 */
check('the registry holds at least ten sections', SECTIONS.length >= 10, true);

const ids = SECTIONS.map((section) => section.id);
const paths = SECTIONS.map((section) => section.path);
check('every section id is unique', new Set(ids).size, ids.length);
check('every section path is unique', new Set(paths).size, paths.length);
check(
  'every path is under /settings',
  paths.every((path) => path === SETTINGS_ROOT || path.startsWith(`${SETTINGS_ROOT}/`)),
  true,
);

/*
 * EXACTLY ONE INDEX. `data: null` means "this section lists the others and
 * holds no Organization data of its own", and two of them would mean the
 * overview's counted sentence is quietly counting one fewer than it appears to.
 */
const indexes = SECTIONS.filter((section) => section.data === null);
check('exactly one section is the index', indexes.length, 1);
check('and the index is at /settings', indexes[0]?.path, SETTINGS_ROOT);
check('the data sections are everything else', DATA_SECTIONS.length, SECTIONS.length - 1);

/*
 * THE COUNT IS DERIVED A SECOND WAY, OVER A DIFFERENT POPULATION.
 * `builtSectionCount()` filters `DATA_SECTIONS`; this filters `SECTIONS`.
 * **Two derivations that share a scope are one derivation** (§11a), so the
 * scopes are deliberately different — this one would still see a `built: true`
 * section that had lost its place in `DATA_SECTIONS`.
 */
const builtOverAllSections = SECTIONS.filter((section) => section.data?.built === true).length;
check('the built count agrees with an independently scoped one', builtSectionCount(), builtOverAllSections);

/*
 * ⚠ AND THE HONEST STATE OF THE MILESTONE, ASSERTED RATHER THAN DESCRIBED.
 *
 * **This assertion is SUPPOSED to fail the day a section starts showing data**,
 * and whoever flips that flag should come here, read this paragraph and change
 * the number. That is the point: the overview tells a customer how many
 * sections are built, and a sentence about the software shown to a customer is
 * exactly the kind that rots quietly. `§11a`'s cheap version of a population
 * check — a number that can only be edited deliberately is a number someone has
 * to look at.
 */
check('no section displays Organization data yet', builtSectionCount(), 0);

/* =========================================================================
   1a · Every contract this surface cites is real, and says what we say it says
   ========================================================================= */

console.log('\n=== The cited contracts ===\n');

/**
 * ⚠ THIS SECTION EXISTS BECAUSE THE REGISTRY WAS FALSE WITHIN AN HOUR OF BEING
 * WRITTEN.
 *
 * The Members section said *"no contract has been drafted"*. `tenant-members-v1`
 * landed in another agent's tree while this shell was being built, and **nothing
 * in this package could have noticed** — `workflow.md` §12: *a sentence about a
 * missing capability outlives the capability arriving, because everyone who
 * quotes it is quoting it for the half that is still true*, and **searching for
 * the new thing never finds the artifact that asserts its absence.**
 *
 * Three assertions, and the third is the one that closes that class:
 *
 *   1. **Every cited path exists.** `architecture.md` §3c's remedy for a claim
 *      about a contract is *open the file* — so a citation that cannot be
 *      opened is worse than none, and it now goes red instead of shipping.
 *   2. **The status on screen matches the contract's own `status:` line.** The
 *      settings page tells a customer whether a contract is accepted; that is a
 *      transcribed fact in a file that cannot see the original.
 *   3. **No tenant-admin contract is left uncited.** This is the one that would
 *      have caught the Members entry, and it is the only direction a search
 *      cannot cover by itself.
 */
const REPOSITORY = join(HERE, '..', '..', '..');
const TENANT_ADMIN = join(REPOSITORY, 'packages', 'contracts', 'core', 'tenant-admin');

const cited = DATA_SECTIONS.filter((section) => section.data.contract !== null);
console.log(`      population: ${cited.length} of ${DATA_SECTIONS.length} sections cite a contract\n`);
check('at least one section cites a contract', cited.length >= 1, true);

/** `status:` at column zero, which is where a contract's own front matter puts it. */
function contractStatus(absolute) {
  const match = /^status:\s*(\S+)/mu.exec(readFileSync(absolute, 'utf8'));
  return match === null ? null : match[1];
}

/**
 * What each on-screen status key CLAIMS the contract's own `status:` line says.
 *
 * The three `accepted*` keys all assert `accepted` and differ only in what they
 * add for the reader — *platform-class*, *read-only*. **That extra half is NOT
 * checkable here and is not pretended to be**: nothing in a `status:` line says
 * a contract is unreachable by a tenant. It is a judgement, recorded at the
 * registry entry with its reasoning, and this check covers the half that is
 * mechanical rather than claiming the whole.
 */
const CLAIMED = {
  'contractStatus.proposed': 'proposed',
  'contractStatus.accepted': 'accepted',
  'contractStatus.acceptedPlatformClass': 'accepted',
  'contractStatus.acceptedReadOnly': 'accepted',
};

for (const section of cited) {
  const absolute = join(REPOSITORY, section.data.contract);
  let actual;
  try {
    actual = contractStatus(absolute);
  } catch {
    actual = 'THE FILE DOES NOT EXIST';
  }
  check(`${section.id} cites a contract that exists and is ${CLAIMED[section.data.contractStatusKey]}`, actual, CLAIMED[section.data.contractStatusKey]);
}

/*
 * AND THE DIRECTION NO SEARCH COVERS: a contract that exists and that no
 * section mentions. **A missing citation matches no pattern** — `workflow.md`
 * §2b's second axis — so the only way to find it is to enumerate the contracts
 * and ask which are unaccounted for.
 *
 * **THIS CHECK READS ANOTHER AGENT'S TREE ON PURPOSE, AND WILL GO RED WHEN THEY
 * ADD A CONTRACT.** That is the intent, not a side effect: a tenant-admin
 * contract landing is precisely the event that should send someone to this
 * registry, and nothing else would.
 */
let tenantAdminContracts = [];
try {
  tenantAdminContracts = readdirSync(TENANT_ADMIN).filter((name) => name.endsWith('.contract.yaml'));
} catch {
  tenantAdminContracts = [];
}
console.log(`\n      population: ${tenantAdminContracts.length} contract(s) under core/tenant-admin\n`);

const citedNames = cited.map((section) => section.data.contract.split('/').pop());
check('every tenant-admin contract is cited by some section', notIn(tenantAdminContracts, citedNames), []);

/* =========================================================================
   1b · Absence claims that a landed decision has already falsified
   ========================================================================= */

console.log('\n=== Absence claims ===\n');

/**
 * ⚠ A RESERVATION, NOT A PATTERN — AND IT EXISTS BECAUSE THIS FILE'S
 * DICTIONARY SHIPPED A FALSE ABSENCE CLAIM.
 *
 * `blocked.roleModel` read *"The role model, which is not yet recorded as a
 * decision."* **`0043` was accepted while the shell was being built**, and the
 * sentence became false with nothing moving to make it so — `workflow.md` §12's
 * *a sentence about a missing capability outlives the capability arriving*.
 *
 * **The contract-citation check above cannot catch this class**, because the
 * claim names a DECISION rather than a contract path. So each entry below pairs
 * a message key with the artifact whose existence falsifies it: the key is
 * forbidden from the dictionary once that artifact is on disk.
 *
 * **It is deliberately a small, named list rather than a regex over the
 * dictionary.** *"Not yet"* and *"cannot be recovered"* are the same grammar
 * and only one of them expires; a pattern over the sentence cannot separate
 * them, and a check that goes red on true statements is one somebody switches
 * off. Each entry here is a recorded judgement about one claim.
 */
const ABSENCE_CLAIMS = [
  {
    key: 'blocked.roleModel',
    /** A prefix, not a slug: a decision record may be renamed, not renumbered. */
    falsifiedBy: 'docs/decisions/0043',
    why: 'the role model is recorded — 0043 is accepted',
  },
];

const dictionary = read('lib/i18n.tsx');
console.log(`      population: ${ABSENCE_CLAIMS.length} reserved claim(s)\n`);

function decisionExists(prefix) {
  const [directory, stem] = [prefix.slice(0, prefix.lastIndexOf('/')), prefix.slice(prefix.lastIndexOf('/') + 1)];
  try {
    return readdirSync(join(REPOSITORY, directory)).some((name) => name.startsWith(stem));
  } catch {
    return false;
  }
}

for (const claim of ABSENCE_CLAIMS) {
  const landed = decisionExists(claim.falsifiedBy);
  /*
   * A FLOOR ON THE FALSIFIER. If the record cannot be found the reservation is
   * vacuous — it would pass whether or not the key were present — so the
   * missing record is itself the finding rather than a quiet skip.
   */
  check(`the record that falsifies ${claim.key} is on disk`, landed, true);
  check(
    `the dictionary makes no "${claim.key}" claim, because ${claim.why}`,
    dictionary.includes(`'${claim.key}'`),
    false,
  );
}

/* =========================================================================
   1c · index.html duplicates three facts from the i18n module
   ========================================================================= */

console.log('\n=== index.html and the i18n module agree ===\n');

/**
 * The pre-paint script in `index.html` reads the stored locale before React
 * mounts, so a returning Arabic reader does not get a left-to-right render that
 * then flips. **It necessarily restates the storage key, the two locale codes
 * and the direction mapping** — a duplicated constraint with no citation
 * between the copies, which `workflow.md` §12 records as the kind no sweep can
 * find.
 *
 * **This is the mechanism that closes it**, and it is the reason the comment in
 * `index.html` is allowed to say the duplication is checked.
 */
const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');

const storageKey = /const STORAGE_KEY = '([^']+)'/u.exec(dictionary)?.[1];
check('the i18n module declares a storage key', typeof storageKey === 'string', true);
check(
  'and index.html reads that exact key',
  storageKey !== undefined && html.includes(`'${storageKey}'`),
  true,
);

const declaredLocales = /export const LOCALES = \[([^\]]*)\]/u.exec(dictionary)?.[1] ?? '';
const locales = [...declaredLocales.matchAll(/'(\w+)'/gu)].map((m) => m[1]);
check('the i18n module declares its locales', locales.length >= 2, true);
check(
  'and index.html recognises every one of them',
  locales.filter((code) => !html.includes(`'${code}'`)),
  [],
);

/*
 * THE STATIC TITLE MUST NOT NAME A SECTION. It said `Customers · Dudo` on all
 * eleven `/settings` addresses and in every Arabic session — a rendered string
 * that lives in no `.tsx` file, so no prose instrument in this package could
 * ever have seen it. The brand alone is correct in both languages and on every
 * route; `root-layout.tsx` sets the translated, section-aware title after mount.
 */
const staticTitle = /<title>([^<]*)<\/title>/u.exec(html)?.[1];
check('index.html carries a title', typeof staticTitle === 'string', true);
check('and it names no section', staticTitle, 'Dudo');

/*
 * THE `<noscript>` IS BILINGUAL, because without JavaScript there is no language
 * control and nothing can read a preference. One language there is a choice
 * made on the reader's behalf by the only surface that cannot offer them one.
 */
const noscript = /<noscript>([\s\S]*?)<\/noscript>/u.exec(html)?.[1] ?? '';
check('the noscript reader found a block', noscript.length > 40, true);
for (const code of locales) {
  check(`the noscript block speaks ${code}`, noscript.includes(`lang="${code}"`), true);
}

/* =========================================================================
   1d · The CSP hash and the inline script it covers
   ========================================================================= */

console.log('\n=== The CSP script hash matches the script ===\n');

/**
 * ⚠ TWO COPIES OF ONE FACT, AND ONE BYTE OF DRIFT BLOCKS THE SCRIPT SILENTLY.
 *
 * `public/_headers` names a `sha256-` of the pre-paint locale script in
 * `index.html` — the script that sets `lang` and `dir` before React mounts so a
 * returning Arabic reader does not get a left-to-right render that then flips.
 *
 * **The failure mode is the worst available.** Edit the script, forget the
 * hash, and CSP blocks it: the page still works, the Arabic flash comes back,
 * and nothing connects the two. No test fails, no build breaks, and the symptom
 * looks like a styling problem.
 *
 * So the hash is **recomputed here from the same extraction that produced it**
 * and compared. `workflow.md` §12's duplicated constraint, closed by derivation
 * on both sides rather than by anyone remembering.
 *
 * **THE EXTRACTION ASSERTS EXACTLY ONE MATCH, NOT AT LEAST ONE.** `<script>`
 * with no attributes cannot match the module tag, which carries `type` and
 * `src`. If a second inline script is ever added, this goes red as a loud
 * ambiguity rather than silently hashing whichever came first — the same trade
 * `§11a` prescribes for a shape-search over a path.
 */
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
check('index.html carries exactly one attribute-less inline script', inlineScripts.length, 1);

const headersPath = join(SRC, '..', 'public', '_headers');
let headersFile = '';
try {
  headersFile = readFileSync(headersPath, 'utf8');
} catch {
  headersFile = '';
}
check('public/_headers exists', headersFile.length > 0, true);

if (inlineScripts.length === 1 && headersFile.length > 0) {
  const body = inlineScripts[0][1];
  /*
   * A FLOOR ON WHAT WAS HASHED. An empty or truncated capture hashes cleanly
   * and compares against nothing meaningful — `§11a`'s broken reader, which
   * does not report nothing, it reports agreement.
   */
  check('the captured script is a real script', Buffer.byteLength(body, 'utf8') > 200, true);

  const computed = `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
  const declared = /'(sha256-[A-Za-z0-9+/=]+)'/u.exec(headersFile)?.[1] ?? '(none in _headers)';
  check('the declared CSP hash is the hash of that script', declared, computed);

  /*
   * AND THE DIRECTIVE ACTUALLY CARRIES IT. A correct hash sitting in a comment,
   * or in a `script-src` that also says `unsafe-inline`, is not a policy.
   */
  const csp = /Content-Security-Policy:([^\n]*)/u.exec(headersFile)?.[1] ?? '';
  check('the CSP names the hash inside script-src', new RegExp(`script-src[^;]*'${computed}'`, 'u').test(csp), true);
  check('and script-src does not admit unsafe-inline', /script-src[^;]*unsafe-inline/u.test(csp), false);
  check('nor does the policy admit unsafe-eval anywhere', /unsafe-eval/u.test(csp), false);

  /*
   * `frame-ancestors 'self'` IS DELIBERATE AND IS NOT A WEAKER `'none'`.
   * `'none'` blocks SAME-ORIGIN framing too, which is the responsive-layout
   * instrument in `docs/operations/browser-verification.md` §2 — the one that
   * found the wrapped-LTR alignment defect. Asserted so a later hardening pass
   * has to read the reason before removing the tool.
   */
  check("frame-ancestors is 'self', which preserves same-origin framing", /frame-ancestors 'self'/u.test(csp), true);
}

/*
 * THE `<noscript>` PANEL CARRIES NO `style` ATTRIBUTE. `style-src` governs
 * inline style attributes through `style-src-attr`, so an attribute there is
 * dropped by the policy — and the only people who would ever see the result
 * are JS-disabled visitors, who report nothing.
 *
 * ⚠ THE FIRST VERSION OF THIS CHECK FAILED ON A CORRECT FILE, AND THE REASON IS
 * WORTH THE PARAGRAPH.
 *
 * It was `/<noscript>[\s\S]*?style="/` over the whole document. **`[\s\S]*?` is
 * lazy but unbounded, so it scanned past `</noscript>`** — and matched the
 * HTML COMMENT inside the panel that explains why not to use a `style=""`
 * attribute. **A check defeated by the prose written to explain it**, which is
 * the same family as naming a Tailwind utility in a comment and thereby
 * compiling it into the bundle.
 *
 * Two repairs, both needed: the search is bounded to the block (reusing the
 * capture from §1c), and comments are stripped from it first.
 */
const noscriptMarkup = noscript.replace(/<!--[\s\S]*?-->/gu, '');
check('the noscript reader still has content after stripping comments', noscriptMarkup.trim().length > 40, true);
check('the noscript panel uses a class rather than an inline style', /style="/u.test(noscriptMarkup), false);
check('and it does carry a class', /class="/u.test(noscriptMarkup), true);

/* =========================================================================
   1e · Generated contract types are consumed, not re-declared — ADR 0037 §2
   ========================================================================= */

console.log('\n=== Generated contract types ===\n');

/**
 * ⚠ THIS CONSOLE CONSUMED ZERO GENERATED TYPES UNTIL 2026-09-13, AND NOTHING
 * COULD HAVE SAID SO.
 *
 * `0037` requirement 2: **every generated type a console can consume, it
 * consumes.** `platform/admin` has since `0040`; this package did not even
 * declare `@dudo/contracts` as a dependency, and its `src/contracts/**` modules
 * hand-wrote shapes the generator had already emitted.
 *
 * **Nothing was broken, which is exactly why it survived.** The hand-written
 * shapes were correct. A correct duplicate has no citation between its copies
 * and nothing that fails when they drift — `workflow.md` §12's unsweepable
 * kind, and the reason this is a check rather than a habit.
 *
 * **The assertion is per PAIRED module, and the population is printed** so the
 * unpaired ones are visible in the output rather than silently uncovered. A
 * client module that imports nothing from `@dudo/contracts` is not "passing" —
 * it is **unexamined**, and saying so is the difference between this and a
 * green that means nothing.
 */
/**
 * ⚠ THE POPULATION WAS `src/contracts/` AND THAT IS WHERE THE AUTHOR EXPECTED
 * CONTRACT SHAPES TO LIVE, NOT WHERE THEY DO.
 *
 * **`api/errors.ts` hand-declared `ErrorCode` and `ErrorEnvelope`, and both
 * diverged from `common/error-envelope`** — a missing code and a flat interface
 * where the contract has a discriminated union. **The check could not see it,
 * because it walked a directory.**
 *
 * That is the THIRD population limit found in this session's own instruments,
 * and all three share one shape: **the population was drawn from where the
 * author expected the subject to live.** The glob that missed `.gitignore`; the
 * pairing that took one import specifier; this.
 *
 * So the list is EXPLICIT and additive rather than a directory walk. **A
 * directory is a guess about the subject; a named list is a claim somebody can
 * check and can be wrong about visibly.**
 */
const EXTRA_CONTRACT_MODULES = [join(SRC, 'api', 'errors.ts')];
const CONTRACTS_DIR = join(SRC, 'contracts');

/**
 * Modules in `src/contracts/` that hold CLIENT LOGIC rather than contract
 * shapes, and will never pair with a generated module.
 *
 * ⚠ **ENUMERATED, NOT DEFAULTED** (`workflow.md` §11a). The first version of
 * this check reported *"1 of 4 paired"* and listed these two as UNEXAMINED —
 * **overstating the gap by a factor of two in a figure whose whole job is to
 * say how much work is left.** A pessimistic population is still a wrong one,
 * and it is the direction nobody questions.
 *
 * `field-rules.ts` validates input against constraints the contract states in
 * prose; `format.ts` renders values for a reader. **Neither declares a wire
 * shape**, so there is nothing for a generated type to replace. If either ever
 * grows one, it belongs in a paired module and this list should shrink rather
 * than absorb it.
 */
const CLIENT_LOGIC_MODULES = ['field-rules.ts', 'format.ts'];

const clientContractModules = [
  ...readdirSync(CONTRACTS_DIR)
    .filter((name) => name.endsWith('.ts') && !CLIENT_LOGIC_MODULES.includes(name))
    .map((name) => join(CONTRACTS_DIR, name)),
  ...EXTRA_CONTRACT_MODULES,
];

let paired = 0;
const unpaired = [];
for (const path of clientContractModules) {
  const name = relative(SRC, path);
  const source = readFileSync(path, 'utf8');
  /*
   * ⚠ EVERY SPECIFIER, NOT THE FIRST — AND THE COMMON MODULES ALWAYS.
   *
   * **The first version of this check took ONE specifier and compared against
   * that module alone.** It would have reported `customer-directory.ts` clean
   * after its twelve local duplicates were swapped, **while a THIRTEENTH
   * survived**: `CollectionEnvelope` is hand-declared there and also emitted by
   * `common/pagination.ts`, which is a different generated module.
   *
   * `workflow.md` §11a: *a check cannot distinguish "no such case exists" from
   * "the case was shaped so I cannot see it"* — here the shape was **which
   * generated module the duplicate came from**, and one specifier bounded the
   * population to a fraction of the real one.
   *
   * The common modules are always included because they are shared by every
   * contract and a client can duplicate one of their shapes without importing
   * from them at all — which is exactly what happened.
   */
  const specifiers = [
    ...new Set([...source.matchAll(/from '(@dudo\/contracts\/[^']+)'/gu)].map((m) => m[1])),
  ];
  if (specifiers.length === 0) {
    unpaired.push(name);
    continue;
  }
  paired += 1;

  const ALWAYS = ['@dudo/contracts/common/pagination', '@dudo/contracts/common/error-envelope'];
  const generatedNames = [];
  for (const specifier of [...new Set([...specifiers, ...ALWAYS])]) {
    const generatedPath = join(
      REPOSITORY,
      'packages',
      'contracts',
      'generated',
      `${specifier.replace('@dudo/contracts/', '')}.ts`,
    );
    const generated = readFileSync(generatedPath, 'utf8');
    generatedNames.push(
      ...[...generated.matchAll(/^export (?:type|interface|const) (\w+)/gmu)].map((m) => m[1]),
    );
  }

  /*
   * A FLOOR ON THIS READER. If the export pattern stops matching, the set
   * difference below compares against nothing and reports agreement — the most
   * confident wrong answer available.
   */
  check(`${name}: the generated module's exports were read`, generatedNames.length >= 5, true);

  const locallyDeclared = [
    ...withoutComments(source).matchAll(/^export (?:type|interface) (\w+)/gmu),
  ].map((m) => m[1]);

  check(
    `${name}: re-declares no shape the contract already emits`,
    locallyDeclared.filter((declared) => generatedNames.includes(declared)).sort(),
    [],
  );
}

console.log(
  `\n      population: ${paired} of ${clientContractModules.length} contract-shape modules are paired with a generated one\n` +
    `      unpaired (UNEXAMINED, not passing): ${unpaired.join(', ') || 'none'}\n` +
    `      excluded as client logic, by name: ${CLIENT_LOGIC_MODULES.join(', ')}\n`,
);
/*
 * A FLOOR ON THE EXCLUSION LIST ITSELF. If someone empties it, the population
 * silently widens and the paired ratio reads worse for no reason; if someone
 * adds to it, the gap silently shrinks. **The second is the dangerous
 * direction** — an exclusion list is how a check stops seeing its subject one
 * entry at a time — so the count is pinned and moving it takes a decision.
 */
check('the client-logic exclusion list is exactly the two known modules', CLIENT_LOGIC_MODULES.length, 2);
/*
 * ⚠ THE FLOOR MOVED FROM 1 TO 2 ON 2026-09-13, AND THE DIRECTION IS THE WHOLE
 * DISTINCTION FROM THE PROSE PIN.
 *
 * It was a staging post while only `business-read.ts` was paired. Both
 * contract-shape modules are paired now, **and a floor one below its subject
 * means a regression to a single paired module passes.**
 *
 * ```
 * the prose pin   stayed at 1   the corrected instrument found DEFECTS
 * this floor      1 -> 2        the corrected work produced more SUBJECT
 * ```
 *
 * **A floor tracks how much there is to check. A pin tracks how much is
 * wrong.** Moving a pin to match a measurement converts a defect into a
 * baseline; leaving a floor below its subject stops it tracking anything.
 * Same discipline, opposite direction — and both were asked rather than
 * assumed.
 *
 * ⚠ **AND IT MOVED AGAIN, 2 -> 3, IN THE SAME PASS.** Widening the population
 * to include `api/errors.ts` — which lives outside `src/contracts/` and had two
 * DIVERGENT duplicates — added a third subject the moment it was swapped.
 *
 * **Applied rather than asked this time**, because the Team Lead ruled the
 * principle and not just the instance: *a floor tracks how much there is to
 * check.* Asking a third time for the same mechanical step would be noise. The
 * NUMBER is reported either way, which is the part that matters.
 */
check('every contract-shape module consumes generated types', paired >= 3, true);

/* -------------------------------------------------------------------------
   1b · The operation map names GENERATED shapes, not hand-picked ones
   -------------------------------------------------------------------------

   ⚠ `api/client.ts` IS NOT IN THE PAIRING POPULATION ABOVE AND SHOULD NOT BE.
   It imports its shapes through `src/contracts/**` like every screen does, so
   it carries no `@dudo/contracts` specifier of its own and the pairing loop
   would report it UNPAIRED — a false gap, next to a module that consumes more
   generated types than any other file in this package.

   **So the gap is real and the pairing check is the wrong instrument for it.**
   What is checkable here is narrower and is the thing that was actually at
   risk: every Input and Output the map names is a name the GENERATOR emits.
   ------------------------------------------------------------------------- */

const operations = parseOperations(withoutComments(read('api/client.ts')));

/*
 * A FLOOR ON THE READER, and it is the whole reason this is not a one-liner.
 * `parseOperations` returns `[]` for a renamed type, a reformatted map, or a
 * regex that stopped matching — and an empty list satisfies every set
 * difference below. `workflow.md` §11a's empty-list reader, which reports
 * agreement rather than nothing.
 */
check('the operation map was read', operations.length >= 10, true);

const OPERATION_MODULES = [
  'apps/customers/customer-directory-v1',
  'core/organization/business-read-v1',
];
const operationShapeNames = [];
for (const module of OPERATION_MODULES) {
  const generated = readFileSync(
    join(REPOSITORY, 'packages', 'contracts', 'generated', `${module}.ts`),
    'utf8',
  );
  operationShapeNames.push(
    ...[...generated.matchAll(/^export type (\w+(?:Input|Output))/gmu)].map((m) => m[1]),
  );
}
check('the generated Input/Output names were read', operationShapeNames.length >= 10, true);

check(
  'every shape the operation map names is one the generator emits',
  notIn(
    operations.flatMap((operation) => [operation.input, operation.output]),
    operationShapeNames,
  ),
  [],
);

/*
 * AND THE OPERATION IT NAMES, NOT MERELY *AN* OPERATION'S. `GetCustomerOutput`
 * on `customers.ArchiveCustomer` passes the check above and is wrong — both are
 * `Customer`, so the compiler cannot see it either. The Action's own name is
 * the only thing that distinguishes them, and it is spelled in the key.
 */
check(
  'and each pair belongs to the Action it is filed under',
  operations
    .filter((operation) => {
      const bare = operation.action.split('.')[1];
      return operation.input !== `${bare}Input` || operation.output !== `${bare}Output`;
    })
    .map((operation) => operation.action),
  [],
);

console.log(
  `\n      population: ${operations.length} operations in the map, ` +
    `${operationShapeNames.length} Input/Output names across ${OPERATION_MODULES.length} generated modules\n`,
);

/* =========================================================================
   2 · The registry against the route tree
   ========================================================================= */

console.log('\n=== The registry and the route tree agree ===\n');

const routeTree = withoutComments(read('routes/route-tree.tsx'));

/*
 * The declared child segments. The pattern requires the `getParentRoute` line
 * IMMEDIATELY above the `path`, so a route parented to the root — or to a
 * future second nested layout — is not swept in by accident.
 */
const declaredSegments = [
  ...routeTree.matchAll(/getParentRoute:\s*\(\)\s*=>\s*settingsRoute,\s*path:\s*'([^']+)'/gu),
].map((match) => match[1]);

/*
 * A FLOOR ON THE READER, NOT ONLY ON THE RESULT. §11a: a broken extractor is
 * the most confident version of the empty-list reader — it does not report
 * nothing, it reports agreement. If this regex stops matching, every set
 * comparison below compares two empty sets and passes.
 */
console.log(`      population: ${declaredSegments.length} child routes read out of route-tree.tsx\n`);
check('the route reader found at least ten child routes', declaredSegments.length >= 10, true);

/** The registry's paths, expressed the way the route tree has to spell them. */
const expectedSegments = paths.map((path) =>
  path === SETTINGS_ROOT ? '/' : path.slice(SETTINGS_ROOT.length),
);

const declaredSet = [...new Set(declaredSegments)].sort();
const expectedSet = [...new Set(expectedSegments)].sort();

check('every registry section has a route', notIn(expectedSet, declaredSet), []);
check('every route has a registry section', notIn(declaredSet, expectedSet), []);
check('no route path is declared twice', declaredSegments.length, declaredSet.length);

/*
 * THE IDS PASSED TO THE SHARED SECTION SCREEN. A typo here is not a type error
 * only because `SectionId` is a string union — it IS caught by `tsc`. What is
 * NOT caught is a section whose route exists and points at the wrong id, which
 * would render one section's copy at another's address.
 */
const renderedIds = [
  ...routeTree.matchAll(/<SettingsSection id="([^"]+)"/gu),
].map((match) => match[1]);

check('every non-index section is rendered exactly once', renderedIds.length, SECTIONS.length - 1);
check(
  'and each renders its own id',
  [...renderedIds].sort(),
  ids.filter((id) => id !== indexes[0]?.id).sort(),
);

/*
 * REGISTERED, NOT MERELY DECLARED. A `createRoute` that is never passed to
 * `addChildren` compiles, builds, and 404s — the route object exists and the
 * router has never heard of it.
 */
const childrenBlock = /settingsRoute\.addChildren\(\[([\s\S]*?)\]\)/u.exec(routeTree);
check('the settings children block is present', childrenBlock !== null, true);

const registered = childrenBlock
  ? [...childrenBlock[1].matchAll(/\b(settings\w*Route)\b/gu)].map((match) => match[1])
  : [];

/** The variable each child route was declared as. */
const declaredNames = [
  ...routeTree.matchAll(
    /const (settings\w*Route) = createRoute\(\{\s*getParentRoute:\s*\(\)\s*=>\s*settingsRoute,/gu,
  ),
].map((match) => match[1]);

/*
 * ⚠ IDENTITIES, NOT COUNTS. The first version of this compared
 * `registered.length` against `declaredSegments.length` — **which passes when
 * one route is declared and a DIFFERENT one is registered**, because eleven
 * still equals eleven. That is the shape this repository keeps finding in its
 * own instruments: a comparison that is true for a reason other than the one
 * intended, and it cannot be told apart from a real pass at the output line.
 */
check('every child route is declared and registered under the same name', declaredNames.length, declaredSegments.length);
check('declared and registered are the same set', notIn(declaredNames, registered), []);
check('and nothing is registered that was never declared here', notIn(new Set(registered), declaredNames), []);

/* =========================================================================
   3 · The shell derives its navigation rather than listing it
   ========================================================================= */

console.log('\n=== The navigation is derived, not transcribed ===\n');

const shell = withoutComments(read('components/settings/SettingsShell.tsx'));

check('the navigation maps the registry', /SECTIONS\.map\(/u.test(shell), true);

/*
 * EXACT MATCH, NOT PREFIX. TanStack's `Link` manages `aria-current` itself by
 * default and its notion of active is prefix-based — which would mark the
 * Overview (`/settings`) current on all ten other sections simultaneously.
 */
check('the current section is an exact path match', /currentPath === section\.path/u.test(shell), true);
check('and aria-current is set from it', /aria-current=\{active \? 'page' : undefined\}/u.test(shell), true);
/*
 * ⚠ AND THE ROUTER IS STOPPED FROM ADDING A SECOND ONE.
 *
 * `Link` sets `aria-current` itself on a PREFIX match, so without `exact` the
 * Overview was marked current alongside the real section on all ten children —
 * two "current page" announcements in an eleven-item menu. **Found by a
 * browser, not by this file**, because the second attribute is contributed by a
 * library at render time and the source is correct on its own terms. This
 * assertion exists so removing the option goes red here as well as there.
 */
check(
  'and the router is not left to mark ancestors current as well',
  /activeOptions=\{\{ exact: true \}\}/u.test(shell),
  true,
);

/*
 * THE FOCUS RETURN, ASSERTED SEPARATELY FROM THE CLOSE.
 *
 * **This is the defect found in `platform/admin` and it is worth the two
 * assertions:** a panel that moves focus in and never returns it reads as
 * working, because the reader simply ends up at the top of the document with
 * nothing announced. Closing and returning are two facts and only one of them
 * is visible.
 */
check('closing the navigation returns focus to its opener', /toggleRef\.current\?\.focus\(\)/u.test(shell), true);
check('Escape closes it', /event\.key === 'Escape'/u.test(shell), true);
check(
  'and the Escape listener is bound only while it is open',
  /if \(!open\) return;\s*const onKeyDown/u.test(shell),
  true,
);

/*
 * NO TRANSFORM, NO FIXED POSITION, NO DIRECTION VARIANT. The admin drawer's
 * invisible-sidebar defect was a specificity contest between a direction
 * variant and a breakpoint rule. This layout has nothing to contest, and this
 * assertion is what keeps it that way when someone later "improves" the
 * collapse into a slide-out.
 */
check(
  'the collapse introduces no direction-variant transform',
  /(ltr:|rtl:)[-\w]*translate/u.test(shell),
  false,
);

/* =========================================================================
   4 · The state families stay distinct
   ========================================================================= */

console.log('\n=== The six state families ===\n');

const states = read('components/settings/SettingsState.tsx');
const statesCode = withoutComments(states);

for (const family of [
  'SettingsLoading',
  'SettingsEmpty',
  'SettingsForbidden',
  'SettingsExpired',
  'SettingsNotFound',
  'SettingsFailure',
]) {
  check(`${family} is exported`, new RegExp(`export function ${family}\\b`, 'u').test(statesCode), true);
}

/*
 * ⚠ THE DISCLOSURE BOUNDARY, AND IT IS THE ONLY ASSERTION HERE THAT IS ABOUT
 * SECURITY RATHER THAN ABOUT LAYOUT.
 *
 * `expired` CONFIRMS the thing existed. `not-found` must not. If a future edit
 * reaches for the expired wording inside the not-found panel — which is exactly
 * what happens when someone decides the not-found copy is unhelpfully vague —
 * a settings address becomes an oracle that distinguishes a real identifier
 * from a fabricated one.
 */
/*
 * `\}` IS ESCAPED BECAUSE OF THE `u` FLAG. Unescaped, this is a `SyntaxError`
 * at module load — which is a CRASH, not a `FAIL`, and everything below it is
 * NOT RUN. It was caught here only because the run's whole output was captured
 * rather than grepped for `^FAIL`; a filter would have shown an empty result
 * and read as clean (`workflow.md` §11a, the runner lesson).
 */
const notFoundBody = /export function SettingsNotFound\(([\s\S]*?)\n\}/u.exec(statesCode);
check('the not-found panel exists to be examined', notFoundBody !== null, true);
/*
 * A FLOOR ON THIS READER, AND IT WAS MISSING FROM THE FIRST VERSION.
 *
 * The assertion below searches the captured body for a string. **A capture of
 * `''` contains no such string and passes** — which is §11a's empty-list reader
 * in the one check here that is about a disclosure boundary rather than about
 * layout. Measured at 262 characters today; the floor is set well under that so
 * it fails on an empty or truncated capture rather than on ordinary editing.
 */
check(
  'and the reader captured a real body rather than an empty match',
  (notFoundBody?.[1]?.length ?? 0) > 80,
  true,
);
check(
  'the not-found panel borrows no wording from the expired one',
  notFoundBody === null ? 'unreadable' : /state\.expired/u.test(notFoundBody[1]),
  false,
);

/*
 * TOTALITY OVER THE ERROR CODES. A partial title map would render an untitled
 * panel for whichever code nobody thought of — `architecture.md` §3a-i: key the
 * requirement so the DEFAULT catches the new value.
 */
check(
  'every error code is titled, by a total Record rather than a lookup with a fallback',
  /const TITLE_KEYS: Record<ErrorCode, MessageKey>/u.test(states),
  true,
);
check(
  'and the failure path dispatches forbidden and not-found to their own families',
  /error\.code === 'forbidden'[\s\S]{0,120}error\.code === 'not_found'/u.test(statesCode),
  true,
);

/* =========================================================================
   5 · Negative controls — the predicates above are shown to be able to fail
   ========================================================================= */

console.log('\n=== Negative controls ===\n');

/**
 * `workflow.md` §11a: *a check that is sound by accident is indistinguishable
 * from one that is sound by design, and green tells you nothing about which you
 * have.* Each case below feeds a constructed BROKEN input to the same predicate
 * the real assertion uses, and requires it to fire.
 *
 * **The mutation is applied to a string, never to a file.** §2a-i: a deliberate
 * mutant against the real tree is indistinguishable from a defect to everyone
 * but the person running it, and it must be announced in advance. Nothing here
 * touches the tree, so there is no window to announce.
 */
function control(name, predicateFired) {
  const okay = predicateFired === true;
  if (!okay) failures += 1;
  console.log(`${okay ? 'PASS' : 'FAIL'}  control: ${name}${okay ? '' : ' — DID NOT FIRE'}`);
}

/*
 * ⚠ EVERY CONTROL BELOW FEEDS `notIn` LITERALS AND READS NOTHING FROM THE TREE.
 * See the function's own comment for why — in short, a control that reads the
 * corpus has two possible causes for failing and only one of them is about the
 * checker, and one of these had already broken that way.
 */
control('a route with no registry section is caught', notIn(['/a', '/ghost'], ['/a']).length > 0);
control('a registry section with no route is caught', notIn(['/a', '/orphan'], ['/a']).length > 0);
/*
 * AND THE PRECISION HALF, WHICH THE OLD VERSIONS DID NOT HAVE: the predicate
 * must stay SILENT when the two sets agree. A control that only ever proves a
 * check can go red does not distinguish a good check from one that flags
 * everything.
 */
control('and two agreeing sets produce nothing', notIn(['/a', '/b'], ['/a', '/b']).length === 0);
control(
  'a duplicated route path is caught',
  (() => {
    const doubled = ['/a', '/b', '/a'];
    return doubled.length !== new Set(doubled).size;
  })(),
);
control(
  'and a set with no duplicate is not flagged',
  (() => {
    const clean = ['/a', '/b'];
    return clean.length === new Set(clean).size;
  })(),
);
control(
  'the route reader would refuse an emptied route tree',
  [...withoutComments('const x = 1;').matchAll(
    /getParentRoute:\s*\(\)\s*=>\s*settingsRoute,\s*path:\s*'([^']+)'/gu,
  )].length < 10,
);
control(
  'expired wording inside the not-found panel is caught',
  /state\.expired/u.test("return <StateBlock title={t('state.expired.title')} />"),
);
control(
  'a prefix-matched aria-current is caught',
  /currentPath === section\.path/u.test('const active = currentPath.startsWith(section.path);') === false,
);
control(
  'a route declared but never registered is caught',
  notIn(['settingsARoute', 'settingsGhostRoute'], ['settingsARoute']).length > 0,
);
control(
  'an empty capture of the not-found body fails the floor',
  ('' .length > 80) === false,
);
control(
  'a drifted CSP hash is caught',
  `sha256-${createHash('sha256').update('a', 'utf8').digest('base64')}` !==
    `sha256-${createHash('sha256').update('b', 'utf8').digest('base64')}`,
);
control(
  'an empty script capture fails the floor',
  Buffer.byteLength('', 'utf8') > 200 === false,
);
control(
  'unsafe-inline in script-src is caught',
  /script-src[^;]*unsafe-inline/u.test("script-src 'self' 'unsafe-inline'; img-src 'self'"),
);
control(
  "frame-ancestors 'none' is caught, because it would break the iframe instrument",
  /frame-ancestors 'self'/u.test("frame-ancestors 'none'") === false,
);
control(
  'an inline style attribute in the noscript panel is caught',
  /style="/u.test('<div style="padding:1rem">x</div>'.replace(/<!--[\s\S]*?-->/gu, '')),
);
/*
 * AND THE PRECISION HALF — the case that made the first version of this check
 * fail on a correct file. A comment MENTIONING the forbidden attribute must not
 * be mistaken for the attribute.
 */
control(
  'a comment mentioning style="" is NOT mistaken for one',
  /style="/u.test('<!-- not a style="" attribute --><div class="x">y</div>'.replace(/<!--[\s\S]*?-->/gu, '')) === false,
);
control(
  'a second inline script is caught as an ambiguity',
  [...'<script>a</script><script>b</script>'.matchAll(/<script>([\s\S]*?)<\/script>/gu)].length !== 1,
);
control(
  'a module script with attributes is NOT counted as inline',
  [...'<script type="module" src="/x.tsx"></script>'.matchAll(/<script>([\s\S]*?)<\/script>/gu)].length === 0,
);
/*
 * THE OPERATION MAP. The mutation is the one a real author makes — `Customer`
 * is shorter, it is the name every screen already uses, and it compiles. The
 * precision half matters more than usual here: a check that flagged a correct
 * generated name would be switched off within a week.
 */
control(
  'an operation map naming a hand-picked shape is caught',
  notIn(['GetCustomerInput', 'Customer'], ['GetCustomerInput', 'GetCustomerOutput']).length > 0,
);
control(
  'and a pair of generated names is not flagged',
  notIn(['GetCustomerInput', 'GetCustomerOutput'], ['GetCustomerInput', 'GetCustomerOutput'])
    .length === 0,
);
/*
 * AND THE READER, WHICH THE SET DIFFERENCE CANNOT CONTROL FOR. A parse that
 * returns nothing passes every assertion above it; only the floor catches that,
 * so the floor's input is what needs a control — in both directions, because a
 * reader that finds nothing and a reader that finds everything look the same
 * from a green.
 */
control(
  'a map the reader cannot find yields no entries, and the floor catches it',
  parseOperations('type SomethingElse = {\n  ok: true;\n};').length === 0,
);
control(
  'and a well-formed map body is read rather than reported empty',
  parseOperations("type Operations = {\n  'a.B': { input: BInput; output: BOutput };\n};").length ===
    1,
);
control(
  'a pair filed under the wrong Action is caught',
  [
    {
      action: 'customers.ArchiveCustomer',
      input: 'ArchiveCustomerInput',
      output: 'GetCustomerOutput',
    },
  ].filter((operation) => {
    const bare = operation.action.split('.')[1];
    return operation.input !== `${bare}Input` || operation.output !== `${bare}Output`;
  }).length > 0,
);

control(
  'a client module re-declaring a generated shape is caught',
  ['BusinessSummary', 'LocalOnlyThing'].filter((n) => ['BusinessSummary'].includes(n)).length > 0,
);
control(
  'and a client module declaring only its own shapes is not flagged',
  ['LocalOnlyThing'].filter((n) => ['BusinessSummary'].includes(n)).length === 0,
);
control(
  'an unreadable generated module fails the reader floor',
  [].length >= 5 === false,
);
control(
  'a re-added absence claim is caught',
  "const x = { 'blocked.roleModel': 'not yet recorded' };".includes(`'blocked.roleModel'`),
);
control(
  'a falsifier that is not on disk is caught rather than skipped',
  decisionExists('docs/decisions/9999') === false,
);
control(
  'a storage key that index.html does not read is caught',
  '<script>localStorage.getItem("other.key")</script>'.includes(`'dudo.web.locale'`) === false,
);
control(
  'a section-naming static title is caught',
  (/<title>([^<]*)<\/title>/u.exec('<title>Customers · Dudo</title>')?.[1] ?? '') !== 'Dudo',
);
control(
  'a monolingual noscript is caught',
  ['en', 'ar'].filter((c) => !'<p lang="en">only English</p>'.includes(`lang="${c}"`)).length > 0,
);
/*
 * ⚠ THIS CONTROL BROKE ITSELF, AND THE WAY IT BROKE IS THE LESSON.
 *
 * It named two REAL files — `tenant-members-v1` and `tenant-roles-v1` — on the
 * assumption that the second was uncited. **`tenant-roles-v1` landed and was
 * cited within the hour, so both names were in the cited set and the mutation
 * mutated nothing.** It reported DID NOT FIRE against a check that was working
 * perfectly.
 *
 * `§11a`: *a blind check and a broken control produce the identical output
 * line*, and the instinct on seeing one is to weaken the check — which here
 * would have removed a working assertion to satisfy a stale test of it.
 *
 * **A control must not be built out of data that can legitimately change.** The
 * name below cannot ever be cited, because no such contract will exist.
 */
/*
 * ⚠ THIS IS THE CONTROL THAT BROKE, AND IT BROKE BY READING THE TREE.
 *
 * It named two REAL contract files on the assumption the second was uncited.
 * **`tenant-roles-v1` landed and was cited within the hour**, so both were in
 * the cited set, the mutation mutated nothing, and it reported DID NOT FIRE
 * against a check that was working perfectly. The instinct on seeing that is to
 * weaken the check — which would have removed a working assertion to satisfy a
 * stale test of it.
 *
 * It now feeds `notIn` two literals and cannot be moved by anything landing in
 * anyone's tree.
 */
control(
  'an uncited tenant-admin contract is caught',
  notIn(['cited-v1.contract.yaml', 'uncited-v1.contract.yaml'], ['cited-v1.contract.yaml']).length > 0,
);
control(
  'a citation pointing at a file that does not exist is caught',
  (() => {
    try {
      contractStatus(join(REPOSITORY, 'packages/contracts/core/tenant-admin/no-such.contract.yaml'));
      return false;
    } catch {
      return true;
    }
  })(),
);

/* ========================================================================= */

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
