/**
 * Verifies that a build which talks to Core carries no fixture.
 *
 *   npm run verify:no-fixtures        (builds dist-http, then runs this)
 *
 * ===========================================================================
 * THE INSTRUCTION IS THE USER'S AND IT WAS BEING BROKEN
 * ===========================================================================
 *
 * > **NO FIXTURE FALLBACK IN THE DEPLOYED BUILD.**
 *
 * **Measured on a `VITE_DUDO_TRANSPORT=http` production bundle, before any of
 * this existed:**
 *
 * ```
 * biz_marina_ops · biz_atlas_logi · biz_northgate1     3 fixture Businesses
 * cus_*                                               35 fixture customer records
 * ```
 *
 * Nothing was misconfigured. `lib/clients.ts` chooses the transport with a
 * ternary — **and a ternary chooses at RUN time while the bundler links at
 * BUILD time**, so the fixture module was in the artifact whichever way it
 * went. *"It only activates when a flag is set"* is exactly the shape that
 * ships.
 *
 * `vite.config.ts` now excludes the fixture modules at RESOLUTION when the
 * transport is `http`. **This is the check that says so**, and it is written to
 * be run against a deployed asset as easily as a local one.
 *
 * ===========================================================================
 * WHAT IT ASSERTS, AND WHY EACH HALF IS NEEDED
 * ===========================================================================
 *
 *   SOURCE    the stub's exports cover exactly what `src/` imports from the
 *             real fixture modules. Too few is a broken http build; too many is
 *             a name nobody imports. **Derived from the import statements, not
 *             transcribed** — a transcribed list is a second copy of a fact in
 *             a file that cannot see the first (`workflow.md` §11a).
 *
 *   ARTIFACT  no fixture identifier survives into the http bundle, **with the
 *             identifiers read out of `fixtures.ts`** rather than written here.
 *             A hardcoded marker list goes stale the day somebody renames a
 *             fixture, and it goes stale in the reassuring direction.
 *
 * **Both are needed and neither subsumes the other.** The source half would
 * pass on a build whose exclusion plugin was disabled; the artifact half would
 * pass on a build whose stub was missing an export, because that build would
 * not exist. They fail on different inputs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const HERE = import.meta.dirname;
const PACKAGE = join(HERE, '..');
const SRC = join(PACKAGE, 'src');
const DIST_HTTP = join(PACKAGE, 'dist-http', 'assets');

/** The modules a production build must not contain. */
const FIXTURE_MODULES = ['fixture-transport', 'fixture-session-state'];
/** The module they are replaced by, which is not itself a fixture. */
const STUB = join(SRC, 'api', 'fixture-absent.ts');

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

/** Every `.ts`/`.tsx` file under `src/`. */
function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/u.test(entry.name)) found.push(full);
  }
  return found;
}

const files = sourceFiles(SRC);

/* =========================================================================
   1 · The stub covers exactly what the source imports
   ========================================================================= */

console.log('\n=== The absent-fixture stub matches its callers ===\n');

console.log(`      population: ${files.length} source files walked\n`);
/*
 * A FLOOR ON THE READER. Every assertion below iterates what this walk found;
 * a walk that returns nothing satisfies all of them and prints a clean run —
 * `§11a`'s empty-list reader, with the whole check as its subject.
 */
check('the source walk found a plausible number of files', files.length >= 40, true);

/**
 * Value imports of the fixture modules, by name.
 *
 * **`import type` is skipped, and so is a `type` specifier inside the braces.**
 * A type import is erased by the compiler and costs no runtime edge, so it is
 * not something the stub has to satisfy — and counting one would demand an
 * export nobody can call.
 */
function fixtureValueImports(source) {
  const names = new Set();
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']*)'/gu;
  for (const match of source.matchAll(pattern)) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly !== undefined) continue;
    if (!FIXTURE_MODULES.some((name) => specifier.endsWith(name))) continue;
    for (const raw of clause.split(',')) {
      const entry = raw.trim();
      if (entry === '' || entry.startsWith('type ')) continue;
      names.add(entry.split(/\s+as\s+/u)[0].trim());
    }
  }
  return names;
}

const required = new Set();
const importers = [];
for (const file of files) {
  if (file === STUB) continue;
  // The fixture modules' own imports of each other are internal and go with them.
  if (FIXTURE_MODULES.some((name) => file.endsWith(`${name}.ts`))) continue;
  const names = fixtureValueImports(readFileSync(file, 'utf8'));
  if (names.size > 0) {
    importers.push(relative(PACKAGE, file));
    for (const name of names) required.add(name);
  }
}

console.log(`      ${importers.length} module(s) value-import a fixture module:`);
for (const importer of importers) console.log(`        ${importer}`);
console.log(`      requiring: ${[...required].sort().join(', ') || '(none)'}\n`);

const stubExports = new Set(
  [...readFileSync(STUB, 'utf8').matchAll(/^export function (\w+)/gmu)].map((m) => m[1]),
);

check('the stub reader found its exports', stubExports.size >= 3, true);
check(
  'every symbol the source imports from a fixture module is stubbed',
  [...required].filter((name) => !stubExports.has(name)).sort(),
  [],
);
/*
 * SURPLUS IS A FINDING TOO, AND IT IS THE HALF THAT WOULD OTHERWISE ROT. A stub
 * export nobody imports is dead weight that reads as coverage — and the day the
 * last caller of a fixture symbol is deleted, this is what says so.
 */
check(
  'and the stub exports nothing nobody imports',
  [...stubExports].filter((name) => !required.has(name)).sort(),
  [],
);

/*
 * THE DELETED-PATH SWEEP, whose correct answer is zero (`workflow.md` §2b).
 * `Transport` and `DudoAction` moved to `api/transport.ts` precisely because
 * importing the INTERFACE from the FAKE is what made the fixture look like an
 * ordinary dependency. This goes red if anyone points at the old home again.
 */
const oldTypeHome = files.filter((file) => {
  if (file.endsWith('fixture-transport.ts')) return false;
  const source = readFileSync(file, 'utf8');
  return /import\s+type\s*\{[^}]*(Transport|DudoAction)[^}]*\}\s*from\s*'[^']*fixture-transport'/u.test(
    source,
  );
});
check('nothing imports the transport interface from the fixture', oldTypeHome.map((f) => relative(PACKAGE, f)), []);

/* =========================================================================
   2 · The artifact
   ========================================================================= */

console.log('\n=== The http production bundle carries no fixture ===\n');

/** Fixture identifiers, READ OUT OF THE FIXTURE rather than written here. */
function fixtureIdentifiers() {
  const source = readFileSync(join(SRC, 'api', 'fixtures.ts'), 'utf8');
  const ids = new Set();
  for (const match of source.matchAll(/'(biz_[A-Za-z0-9_]+|cus_[A-Za-z0-9]+)'/gu)) ids.add(match[1]);
  return [...ids];
}

const markers = fixtureIdentifiers();
console.log(`      population: ${markers.length} fixture identifiers read out of api/fixtures.ts\n`);
/*
 * A FLOOR ON *THIS* READER TOO. If the pattern stops matching, the artifact
 * assertion below searches for nothing, finds nothing, and reports the bundle
 * clean — which is the most confident wrong answer this check could give.
 */
check('the fixture reader found identifiers to search for', markers.length >= 10, true);

let sheets = [];
try {
  sheets = readdirSync(DIST_HTTP)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, js: readFileSync(join(DIST_HTTP, name), 'utf8'), time: statSync(join(DIST_HTTP, name)).mtimeMs }));
} catch {
  sheets = [];
}

function newestSourceTime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const time = entry.isDirectory() ? newestSourceTime(full) : statSync(full).mtimeMs;
    if (time > newest) newest = time;
  }
  return newest;
}

if (sheets.length === 0) {
  console.log('NOT RUN  no dist-http/ bundle — run `npm run verify:no-fixtures`, which builds it');
  console.log('\nNot run is not a pass.');
  process.exit(2);
}
if (newestSourceTime(SRC) > Math.min(...sheets.map((s) => s.time))) {
  console.log('NOT RUN  dist-http/ is older than src/ — it would report on the PREVIOUS build');
  console.log('\nNot run is not a pass.');
  process.exit(2);
}

const bundle = sheets.map((s) => s.js).join('\n');
console.log(`      population: ${sheets.length} script(s), ${bundle.length} bytes\n`);

const leaked = markers.filter((id) => bundle.includes(id));
check('no fixture identifier survives into the http bundle', leaked, []);

/*
 * ⚠ THE FLOOR THAT MAKES THE ZERO ABOVE MEAN SOMETHING. An empty bundle, a
 * failed build, or a search over the wrong directory all produce zero leaks.
 * These three strings are ordinary application vocabulary that must be present
 * in any build that is actually this product.
 */
const presence = ['Organization', 'settings', 'customers'].filter((word) => bundle.includes(word));
check('and the bundle is still a real application', presence.length, 3);

/* =========================================================================
   3 · Negative controls
   ========================================================================= */

console.log('\n=== Negative controls ===\n');

function control(name, fired) {
  const okay = fired === true;
  if (!okay) failures += 1;
  console.log(`${okay ? 'PASS' : 'FAIL'}  control: ${name}${okay ? '' : ' — DID NOT FIRE'}`);
}

/*
 * THE STRONGEST ONE, AND IT IS NOT CONSTRUCTED: the FIXTURE build is the real
 * broken state for this check, it exists on disk, and it must fail. A check
 * that reports the http bundle clean is worth nothing until it is shown to
 * report a fixture-carrying bundle dirty.
 */
let fixtureBuild = '';
try {
  const dir = join(PACKAGE, 'dist', 'assets');
  fixtureBuild = readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .map((n) => readFileSync(join(dir, n), 'utf8'))
    .join('\n');
} catch {
  fixtureBuild = '';
}
if (fixtureBuild === '') {
  console.log('NOT RUN  control: no dist/ fixture build to contrast against — run `npm run build`');
  failures += 1;
} else {
  /*
   * ⚠ THE ONE CONTROL IN THIS REPOSITORY THAT READS THE REAL TREE ON PURPOSE,
   * AND THE EXCEPTION IS ENUMERATED RATHER THAN DEFAULTED.
   *
   * `qa-agent`'s rule says a control reading the tree has two possible causes
   * for failing and only one is about the checker. **That is a reason to make
   * such a control rare and named, not a reason to have none** — because the
   * alternative here is strictly weaker.
   *
   * The fixture build is **the genuine broken state, on disk, for free**. A
   * constructed string proves the predicate can fire; this proves it fires on
   * the actual artifact this check exists to distinguish. `§11a`: *the real
   * broken state contains the failures you did not think of.*
   *
   * **Its two failure causes are both worth knowing and neither is silent:**
   * the predicate broke, or `dist/` stopped containing fixtures — and the
   * second would mean the fixture build had itself become fixture-free, which
   * is a finding rather than noise.
   *
   * ⚠ **AND IT WAS INVISIBLE TO MY OWN AUDIT OF THIS EXACT CLASS.** The sweep
   * that decoupled the other seven controls anchored on `^control(` at column
   * zero; this one is indented inside an `else`. **Found by counting all
   * `control(` calls and comparing against what the audit had seen** — eight
   * versus nine. A population check on the instrument, catching the instrument.
   */
  control(
    'the SAME predicate flags the fixture build, which really does contain them',
    markers.filter((id) => fixtureBuild.includes(id)).length > 0,
  );
}

/*
 * ⚠ THESE TWO READ THE REAL TREE AND NO LONGER DO. `qa-agent`, 2026-09-13:
 * **a control that reads the tree has two possible causes for failing and only
 * one of them is about the checker.** A sibling control in
 * `verify-settings.mjs` had already broken exactly that way when a contract it
 * named became cited an hour after it was written.
 *
 * They now feed the same set difference the assertions use, with literals.
 */
const notIn = (candidates, known) => candidates.filter((name) => !new Set(known).has(name));

control('a missing stub export is caught', notIn(['stubbed', 'notStubbed'], ['stubbed']).length > 0);
control('a surplus stub export is caught', notIn(['imported', 'nobodyImports'], ['imported']).length > 0);
/*
 * AND THE PRECISION HALF. Without it these prove only that the predicate can
 * fire, not that it stays quiet when the two sets agree — which is the state
 * the real assertions are in on every green run.
 */
control('and a stub that matches its callers exactly is not flagged', notIn(['a', 'b'], ['a', 'b']).length === 0);
control(
  'a type-only import is NOT counted as needing a stub',
  fixtureValueImports("import type { Transport } from './fixture-transport';").size === 0,
);
control(
  'a value import IS counted',
  fixtureValueImports("import { createFixtureTransport } from './fixture-transport';").size === 1,
);
control(
  'a mixed clause counts only the value half',
  [...fixtureValueImports("import { createFixtureTransport, type Transport } from './fixture-transport';")].join(',') ===
    'createFixtureTransport',
);
control(
  'an import from a NON-fixture module is ignored',
  fixtureValueImports("import { createHttpTransport } from './http-transport';").size === 0,
);
control(
  'the fixture-identifier reader would refuse an empty fixtures file',
  [...''.matchAll(/'(biz_[A-Za-z0-9_]+|cus_[A-Za-z0-9]+)'/gu)].length < 10,
);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
