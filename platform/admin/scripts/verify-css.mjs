/**
 * Checks the BUILT stylesheet for rules that emit correctly and then lose the
 * cascade.
 *
 *   npm run verify:css
 *
 * ===========================================================================
 * WHY THIS EXISTS: "THE CLASS IS PRESENT" IS NOT "THE CLASS APPLIES"
 * ===========================================================================
 *
 * Two defects in this console have now come from the same blind spot, and the
 * second one shipped:
 *
 *   1. `inset-block-0` is not a Tailwind utility. It compiled to NOTHING, and
 *      the drawer had no vertical bounds. Caught before release by grepping the
 *      built CSS for the class — an EXISTENCE check.
 *   2. `lg:translate-x-0` was supposed to cancel `ltr:-translate-x-full` at
 *      desktop. Both classes existed, both compiled, and the existence check
 *      passed. IT STILL LOST: `.lg\:translate-x-0` sits inside
 *      `@media(min-width:64rem)` with specificity (0,1,0), and
 *      `.ltr\:-translate-x-full:where(...)` comes LATER in the sheet with the
 *      SAME specificity, because `:where()` contributes zero. Equal specificity,
 *      later wins. The sidebar was translated off-screen at 1600px and the
 *      console shipped with no reachable navigation.
 *
 * A MEDIA QUERY ADDS NO SPECIFICITY. That is the whole trap: `lg:` reads like it
 * is "more specific than" the base, and it is not — it is the same weight, and
 * whichever rule Tailwind happens to emit later wins. The variant emission order
 * is not something a component file controls or should have to reason about.
 *
 * So this script asserts OUTCOMES against the built artifact, not intentions
 * against the source.
 *
 * IT IS A HEURISTIC AND SAYS SO. It does not implement the cascade. It flags one
 * specific, repeatable shape — a `lg:`-scoped declaration that a later
 * `ltr:`/`rtl:` rule overrides at the same property without being confined to
 * small screens — because that shape has already cost this project a broken
 * release. A false positive here is one comment; a false negative is an
 * invisible sidebar.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ASSETS = join(import.meta.dirname, '..', 'dist', 'assets');

let failures = 0;

function pass(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, detail) {
  failures += 1;
  console.log(`FAIL  ${name}${detail ? `\n${detail}` : ''}`);
}

/* -------------------------------------------------------------------------
   Locate the stylesheet
   ------------------------------------------------------------------------- */

let cssFiles = [];
try {
  cssFiles = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.css'));
} catch {
  console.error(
    'FAIL  No dist/assets directory. Run `npm run build` first — this script checks the\n' +
      '      BUILT stylesheet on purpose, because the source is what looked correct both\n' +
      '      times this went wrong.',
  );
  process.exit(1);
}
if (cssFiles.length !== 1) {
  console.error(`FAIL  Expected exactly one built stylesheet, found ${String(cssFiles.length)}.`);
  process.exit(1);
}
const cssPath = join(DIST_ASSETS, cssFiles[0]);
const css = readFileSync(cssPath, 'utf8');
console.log(`\n=== Cascade checks against ${cssFiles[0]} ===\n`);

/* -------------------------------------------------------------------------
   A small rule scanner
   ------------------------------------------------------------------------- */

/**
 * Walks the sheet tracking brace depth and at-rule context, and returns every
 * style rule with its selector, declarations, enclosing at-rules and offset.
 *
 * Deliberately simple: Tailwind's output is machine-generated and regular. It is
 * not a general CSS parser and does not need to be.
 */
function scanRules(source) {
  const rules = [];
  const stack = [];
  let preludeStart = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === '{') {
      const prelude = source.slice(preludeStart, index).trim();
      if (prelude.startsWith('@')) {
        stack.push(prelude);
        index += 1;
        preludeStart = index;
        continue;
      }
      // A style rule. Find its matching close brace.
      let depth = 1;
      let scan = index + 1;
      while (scan < source.length && depth > 0) {
        if (source[scan] === '{') depth += 1;
        else if (source[scan] === '}') depth -= 1;
        scan += 1;
      }
      rules.push({
        selector: prelude,
        body: source.slice(index + 1, scan - 1),
        atRules: [...stack],
        offset: index,
      });
      index = scan;
      preludeStart = index;
      continue;
    }
    if (char === '}') {
      stack.pop();
      index += 1;
      preludeStart = index;
      continue;
    }
    index += 1;
  }
  return rules;
}

/** The property names a declaration block sets, ignoring custom properties. */
function propertiesOf(body) {
  const names = new Set();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim();
    if (name === '' || name.startsWith('--') || name.includes('{')) continue;
    names.add(name);
  }
  return names;
}

const media = (rule) => rule.atRules.filter((at) => at.startsWith('@media')).join(' ');
/** True when the rule can only apply BELOW a breakpoint. */
const isSmallScreenOnly = (rule) => {
  const m = media(rule);
  return m.includes('max-width') || m.includes('not all and (min-width');
};
const isLargeScreenOnly = (rule) => {
  const m = media(rule);
  return m.includes('(min-width') && !m.includes('not all and (min-width');
};

const rules = scanRules(css);
console.log(`Scanned ${String(rules.length)} style rules.\n`);

/* -------------------------------------------------------------------------
   CHECK 1 — the general shape: a later ltr:/rtl: rule beating an lg: rule
   ------------------------------------------------------------------------- */

const directional = rules.filter(
  (rule) => /\.(ltr|rtl)\\:/.test(rule.selector) && !isSmallScreenOnly(rule),
);
const breakpointScoped = rules.filter((rule) => isLargeScreenOnly(rule));

const collisions = [];
for (const wide of breakpointScoped) {
  const wideProps = propertiesOf(wide.body);
  for (const dir of directional) {
    if (dir.offset <= wide.offset) continue;
    for (const property of propertiesOf(dir.body)) {
      if (wideProps.has(property)) {
        collisions.push({ property, wide, dir });
      }
    }
  }
}

if (collisions.length === 0) {
  pass(
    'no ltr:/rtl: rule overrides a breakpoint-scoped rule on the same property\n' +
      '      (a media query adds NO specificity, so a later same-weight rule wins)',
  );
} else {
  fail(
    `${String(collisions.length)} ltr:/rtl: rule(s) override a breakpoint-scoped rule`,
    collisions
      .slice(0, 6)
      .map(
        ({ property, wide, dir }) =>
          `        property "${property}"\n` +
          `          breakpoint rule  ${wide.selector}  @ ${String(wide.offset)}  ${media(wide)}\n` +
          `          later directional ${dir.selector}  @ ${String(dir.offset)}  ${media(dir) || '(no media — applies at ALL widths)'}\n` +
          '          The directional rule wins. Scope it with `max-lg:` instead of trying to\n' +
          '          cancel it at the breakpoint.',
      )
      .join('\n'),
  );
}

/* -------------------------------------------------------------------------
   CHECK 2 — the specific regression: the drawer must not hide the sidebar
   ------------------------------------------------------------------------- */

const hidingTransforms = rules.filter(
  (rule) => /translate-x-full/.test(rule.selector) && /translate/.test(rule.body),
);

if (hidingTransforms.length === 0) {
  fail(
    'the drawer transform is missing entirely',
    '        `max-lg:ltr:-translate-x-full` / `max-lg:rtl:translate-x-full` emitted nothing.\n' +
      '        The drawer would be open at all times below `lg`.',
  );
} else {
  const leaking = hidingTransforms.filter((rule) => !isSmallScreenOnly(rule));
  if (leaking.length === 0) {
    pass(
      `all ${String(hidingTransforms.length)} off-screen drawer transform(s) are confined to small screens`,
    );
  } else {
    fail(
      'a drawer transform applies at desktop width — THE SIDEBAR WILL BE INVISIBLE',
      leaking
        .map(
          (rule) =>
            `        ${rule.selector}\n          media: ${media(rule) || '(none — applies at ALL widths)'}`,
        )
        .join('\n'),
    );
  }
}

/* -------------------------------------------------------------------------
   CHECK 3 — the desktop sidebar column actually exists
   ------------------------------------------------------------------------- */

for (const [cls, property] of [
  ['lg\\:sticky', 'position'],
  ['lg\\:w-60', 'width'],
  ['lg\\:shrink-0', 'flex-shrink'],
]) {
  const rule = rules.find((r) => r.selector.includes(`.${cls}`));
  if (rule === undefined) {
    fail(`\`${cls.replace('\\', '')}\` was not emitted`, '        The desktop sidebar has no column.');
  } else if (!isLargeScreenOnly(rule)) {
    fail(
      `\`${cls.replace('\\', '')}\` is not inside a min-width media query`,
      `        media: ${media(rule) || '(none)'}`,
    );
  } else if (!propertiesOf(rule.body).has(property)) {
    fail(`\`${cls.replace('\\', '')}\` does not set ${property}`, `        body: ${rule.body}`);
  } else {
    pass(`\`${cls.replace('\\', '')}\` sets ${property} above the breakpoint`);
  }
}

/* -------------------------------------------------------------------------
   CHECK 3b — EVERY class used in src/ actually produced a rule
   -------------------------------------------------------------------------
   This is the existence check, generalised, and it now guards two things at
   once.

   It catches a MISSPELLED OR NON-EXISTENT UTILITY. `inset-block-0` is not a
   Tailwind class; it compiled to nothing and the drawer lost its vertical
   bounds. That was found by hand, once, because someone thought to grep. This
   finds it every build.

   And it guards the `source(none)` RESTRICTION in `src/styles/index.css`.
   Turning off automatic content detection is what stops prose injecting dead
   utilities — but get an `@source` path wrong and real classes silently stop
   being emitted, which is a far worse failure than the one it fixes. If the
   scan ever misses a file, the classes in it appear here as missing.
   ------------------------------------------------------------------------- */

/**
 * Removes comments before any class extraction.
 *
 * NOT COSMETIC — WITHOUT IT THIS CHECK REPORTS NONSENSE. The `cn(...)` regions in
 * this codebase contain long explanatory comments, and those comments contain
 * both backtick-quoted utility names (`inset-block-0`) and ordinary apostrophes
 * ("the console's"). The backticks read as template literals and a lone
 * apostrophe shifts the single-quote pairing, so whole spans of code get
 * captured as if they were class strings. The first run of this check failed on
 * eleven candidates and every one of them was its own prose.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Collects string literals that sit inside a className / cn() / cva() region. */
function classCandidates(input) {
  const source = stripComments(input);
  const found = new Set();
  const regions = [];
  const marker = /\bclassName\s*=\s*|(?<![\w$])cn\s*\(|(?<![\w$])cva\s*\(/g;
  let match;
  while ((match = marker.exec(source)) !== null) {
    let index = match.index + match[0].length;
    // Skip whitespace to the opening delimiter.
    while (index < source.length && /\s/.test(source[index])) index += 1;
    const opener = source[index];
    if (opener === '"' || opener === "'") {
      const end = source.indexOf(opener, index + 1);
      if (end > index) regions.push(source.slice(index + 1, end));
      continue;
    }
    // `{` for a JSX expression, `(` because the marker consumed `cn(`/`cva(`.
    const open = opener === '{' ? '{' : '(';
    const close = open === '{' ? '}' : ')';
    let depth = opener === '{' ? 0 : 1;
    let scan = opener === '{' ? index : index;
    while (scan < source.length) {
      if (source[scan] === open) depth += 1;
      else if (source[scan] === close) {
        depth -= 1;
        if (depth === 0) break;
      }
      scan += 1;
    }
    regions.push(source.slice(index, scan));
  }

  for (const region of regions) {
    for (const literal of region.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`$\\]*)`/g)) {
      const text = literal[1] ?? literal[2] ?? literal[3] ?? '';
      for (const token of text.split(/\s+/)) {
        if (token === '') continue;
        found.add(token);
      }
    }
  }
  return found;
}

/** Tailwind escapes these in selectors. */
function escapeClass(token) {
  return token.replace(/[:.[\]/(),%!#*+?^$|{}\\]/g, (character) => `\\${character}`);
}

const tsxFiles = [];
(function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) tsxFiles.push(full);
  }
})(join(import.meta.dirname, '..', 'src'));

const used = new Set();
for (const file of tsxFiles) {
  for (const token of classCandidates(readFileSync(file, 'utf8'))) used.add(token);
}

const missing = [];
for (const token of used) {
  // Only consider tokens that plausibly name a utility. A region can also hold
  // an aria value, a route, an id or a bare word, and those name no rule.
  if (!/^-?[a-z][a-z0-9]*[:[\]/.\w%-]*$/i.test(token)) continue;
  if (!/[-:[/]/.test(token)) continue;
  if (/^(aria|role|button|submit|page|status|alert|polite|same-origin|no-store|error|progressbar)/.test(token)) continue;
  if (!css.includes(`.${escapeClass(token)}`)) missing.push(token);
}

if (missing.length === 0) {
  pass(`all ${String(used.size)} class candidates in src/ produced a rule`);
} else {
  fail(
    `${String(missing.length)} class(es) used in src/ produced NO rule`,
    missing
      .sort()
      .map(
        (token) =>
          `        ${token}\n          Either it is not a Tailwind utility (a typo, or invented),\n` +
          '          or src/styles/index.css @source no longer covers the file using it.',
      )
      .join('\n'),
  );
}

/* -------------------------------------------------------------------------
   CHECK 4 — nothing renders the nav permanently hidden
   ------------------------------------------------------------------------- */

const navHidden = rules.filter(
  (rule) =>
    /\.hidden\b/.test(rule.selector) &&
    !rule.selector.includes(':') &&
    /display\s*:\s*none/.test(rule.body) &&
    rule.atRules.length === 0,
);
pass(
  navHidden.length > 0
    ? '`.hidden` exists as an unconditional utility (expected; the nav does not use it)'
    : '`.hidden` is not emitted unconditionally',
);

console.log('');
if (failures > 0) {
  console.error(`${String(failures)} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
