/**
 * check:ui-purity — the shared primitive layer carries no authority.
 *
 * ===========================================================================
 * IT HAS A SUBJECT FOR THE FIRST TIME
 * ===========================================================================
 *
 * ADR 0036 required that the shared primitive layer "carry no authority" — no
 * permission model, no data layer, no route tree. **That constraint had never
 * been tested by anything**, and the reason was structural rather than an
 * oversight: this check guarded `platform/web/src/components/ui/**`, which was
 * ONE HOST'S PRIVATE DIRECTORY. There was no shared component for the rule to
 * apply to, so it was correct and inert.
 *
 * `0040` created `@dudo/ui`, and moved this check onto it to cover it alone.
 * **Not pointed at a second directory as well** — that would have blessed two
 * separate layers as correct when the entire point of the package is that there
 * should be one.
 *
 * ===========================================================================
 * THE RULES ARE DERIVED FROM `package.json`, NOT RESTATED
 * ===========================================================================
 *
 * The previous version listed forbidden path prefixes — `@/api/**`,
 * `@/contracts/**` and so on. Inside a package that list can be replaced by
 * something stronger and self-maintaining: **a bare import is permitted only if
 * the package DECLARES it.** `dependencies` and `peerDependencies` are the
 * allow-list, so adding an import without declaring it fails here, and declaring
 * a dependency is a visible edit to a reviewed file.
 *
 * `workflow.md` §12's duplicated-constraint problem is the reason: a list of
 * forbidden things restated in a script drifts from the list of permitted things
 * in the manifest, and nothing goes red when it does.
 *
 * **Two rules survive as explicit names even though the derived rule would
 * already catch them**, and they are not redundant: if somebody added
 * `@tanstack/react-router` to `package.json`, the derived rule would go quiet
 * and these would still fire. **That is the boundary holding rather than the
 * allow-list widening.**
 *
 * ===========================================================================
 * WHAT IT REPORTS, AND WHY IT REPORTS MORE THAN A VERDICT
 * ===========================================================================
 *
 * `workflow.md` §11a records three ways a checker here has already lied, and all
 * three are answered: the POPULATION is printed on every run so "no findings"
 * cannot render as "no input"; it is compared against a PINNED expectation so a
 * glob that stops matching is visible; and it ships with a KNOWN-FAILING INPUT
 * that every rule must fire on, because sound-by-design and sound-by-accident
 * look identical while passing.
 *
 * THE EXIT CODE IS THE RESULT. Nothing here is meant to be grepped for a success
 * string — that mistake cost this package several messages of reported green on
 * a run that had crashed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { builtinModules } from 'node:module';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const SRC = join(PACKAGE_ROOT, 'src');
const NEGATIVE_CONTROL_DIR = join(PACKAGE_ROOT, 'scripts/fixtures/ui-purity-negative');

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const DECLARED = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

/**
 * THE INDEPENDENTLY DERIVED EXPECTATION.
 *
 * A count with nothing to compare against is a number, not a check. Adding a
 * primitive means moving this line in the same commit, deliberately — which is a
 * human looking at the number.
 */
const EXPECTED_MODULES = 11;

/** A bare specifier's package name: `@scope/name/deep` -> `@scope/name`. */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const RULES = [
  {
    id: 'escapes-package',
    applies: (specifier) => specifier.startsWith('.'),
    matches: (specifier, fromFile) => {
      const target = resolve(dirname(fromFile), specifier);
      return !target.startsWith(SRC);
    },
    why: 'a relative import reaching outside the package — a primitive that imports a host has picked one of the two consoles',
  },
  {
    id: 'undeclared-dependency',
    applies: (specifier) => !specifier.startsWith('.'),
    matches: (specifier) => {
      const name = packageName(specifier);
      if (builtinModules.includes(name) || name.startsWith('node:')) return true;
      return !DECLARED.has(name);
    },
    why: "not declared in this package's dependencies or peerDependencies (a Node builtin is also refused: a presentation primitive has no business reading a filesystem)",
  },
  {
    id: 'route-tree',
    applies: () => true,
    matches: (specifier) => packageName(specifier) === '@tanstack/react-router',
    why: 'the route tree — ADR 0035 gives the two administrations different ones, so a primitive emitting a Link has chosen one',
  },
  {
    id: 'server-state',
    applies: () => true,
    matches: (specifier) => packageName(specifier) === '@tanstack/react-query',
    why: 'server state — a primitive that fetches has a data layer whether or not it admits to one',
  },
];

/**
 * COMMENTS ARE STRIPPED BEFORE ANY IMPORT IS EXTRACTED, AND THE FIRST RUN OF
 * THIS CHECK IS WHY.
 *
 * It reported `src/index.ts imports "@dudo/ui"`. The barrel does no such thing —
 * the match came from a JSDoc line showing consumers how to import FROM this
 * package: *"a consumer writes `import { Button } from '@dudo/ui'`"*. The
 * extractor was reading prose as code and reporting a violation that did not
 * exist.
 *
 * **A false positive here is not harmless.** A check that flags documentation is
 * a check whose next finding gets dismissed, and the run after that is the one
 * that mattered. It is also the same defect `platform/admin`'s stylesheet
 * documents from the other direction: Tailwind scanning raw file text meant
 * **writing a utility name in a comment compiled that utility into the bundle.**
 * Two tools in this repository, both reading prose as instructions.
 *
 * Block comments only, plus lines that are entirely a `//` comment. A `//`
 * appearing mid-line is left alone deliberately — stripping it would corrupt any
 * string containing `https://`, and trading a false positive for a false
 * negative is the wrong direction for a check like this.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Every `from '...'` and bare `import '...'` specifier in a module. */
function importSpecifiers(source) {
  const code = stripComments(source);
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function modulesIn(directory) {
  const entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(tsx?|jsx?|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

function violationsIn(files) {
  const violations = [];
  let importsExamined = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      importsExamined += 1;
      for (const rule of RULES) {
        if (rule.applies(specifier, file) && rule.matches(specifier, file)) {
          violations.push({
            file: relative(PACKAGE_ROOT, file),
            specifier,
            rule: rule.id,
            why: rule.why,
          });
        }
      }
    }
  }
  return { violations, importsExamined };
}

/* ------------------------------------------------------------------------- */

let failed = false;
const fail = (message) => {
  failed = true;
  console.log(`FAIL  ${message}`);
};

console.log('\n=== check:ui-purity — @dudo/ui carries no authority ===\n');
console.log(`Declared dependencies (the allow-list): ${[...DECLARED].sort().join(', ')}\n`);

const files = modulesIn(SRC);
console.log(`Population: ${files.length} module(s) under src/`);
for (const file of files) console.log(`  · ${relative(PACKAGE_ROOT, file)}`);

if (files.length === 0) {
  fail(
    'the walk found NO modules. That is not a clean result — it is a checker that was ' +
      'handed nothing and would have reported success.',
  );
}

if (files.length !== EXPECTED_MODULES) {
  fail(
    `the population is ${files.length}, and EXPECTED_MODULES says ${EXPECTED_MODULES}. ` +
      'If a primitive was added or removed, move that constant in the same commit. If ' +
      'nothing was, this check has stopped seeing files it used to see.',
  );
}

const { violations, importsExamined } = violationsIn(files);
console.log(`\nImports examined: ${importsExamined}`);

if (violations.length === 0) {
  console.log('PASS  no primitive reaches a host, an undeclared package, the route tree or server state');
} else {
  for (const violation of violations) {
    fail(`${violation.file} imports "${violation.specifier}" — ${violation.why} [${violation.rule}]`);
  }
}

/* --- The known-failing input ---------------------------------------------- */

console.log('\n=== negative control ===');

const controlFiles = modulesIn(NEGATIVE_CONTROL_DIR);
console.log(`Control population: ${controlFiles.length} module(s)`);

if (controlFiles.length === 0) {
  fail(
    'the negative control fixture is missing. Every run above is therefore unverified: ' +
      'a check that has never been shown to fail has been observed, not verified.',
  );
} else {
  const control = violationsIn(controlFiles);
  const fired = new Set(control.violations.map((violation) => violation.rule));
  const silent = RULES.map((rule) => rule.id).filter((id) => !fired.has(id));

  console.log(`Rules that fired on the fixture: ${[...fired].sort().join(', ') || '(none)'}`);

  if (silent.length > 0) {
    fail(
      `${silent.length} rule(s) did not fire on the fixture that exists to trip them: ` +
        `${silent.join(', ')}. Either the fixture no longer contains that import, or the ` +
        'rule has stopped matching. A rule nothing can trip is a rule that cannot go red.',
    );
  } else {
    console.log(`PASS  all ${RULES.length} rules went red on the known-failing input`);
  }
}

console.log('');
if (failed) {
  console.log('check:ui-purity FAILED');
  process.exit(1);
}
console.log('check:ui-purity passed.');
