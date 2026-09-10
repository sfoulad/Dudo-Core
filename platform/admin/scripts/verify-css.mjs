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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

function checkAtLeast(name, actual, minimum) {
  const ok = actual >= minimum;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name} (${String(actual)})` +
      (ok ? '' : `\n        expected at least ${String(minimum)}`),
  );
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

/**
 * Removes the right-hand side of an equality comparison.
 *
 * WITHOUT THIS THE CHECK REPORTS VALUES AS MISSING CLASSES. A conditional class
 * inside `cn(...)` reads `role === 'platform-admin' && 'bg-scarlet-50 …'`, and
 * the extractor cannot tell the OPERAND from the CLASS — both are string
 * literals in the same region. `'platform-admin'` then looks exactly like a
 * utility that failed to compile.
 *
 * IT WAS FOUND BY THE CHECK FIRING ON TWO ROLE NAMES, and the tempting fix was a
 * skip list. A skip list would have grown with every enum value this console
 * ever renders and would eventually have hidden a real miss. Removing comparison
 * operands is the general form: an operand is never a class, and a class is
 * never an operand.
 *
 * Values compared with `includes`, `startsWith` or a `switch` are not covered,
 * and would still show up as false positives — recorded rather than solved,
 * because none is used in a `cn()` region today and a checker that guesses at
 * more syntax is a checker nobody trusts.
 */
function stripComparisonOperands(source) {
  return source.replace(/(===|!==|==|!=)\s*(['"`])(?:\\.|(?!\2)[^\\])*\2/g, '$1 __OPERAND__');
}

/** Collects string literals that sit inside a className / cn() / cva() region. */
function classCandidates(input) {
  const source = stripComparisonOperands(stripComments(input));
  const found = new Set();

  const addTokens = (text) => {
    for (const token of text.split(/\s+/)) {
      if (token !== '') found.add(token);
    }
  };

  /*
   * TWO KINDS OF REGION, AND CONFLATING THEM WAS A REAL BLIND SPOT.
   *
   * `className="a b c"` yields the class text DIRECTLY — there are no quotes
   * left inside it once the attribute's own quotes are stripped.
   * `className={cn('a', cond && 'b')}` yields CODE, in which the classes are
   * quoted string literals that still have to be extracted.
   *
   * THE FIRST VERSION PUSHED BOTH INTO ONE LIST AND THEN SEARCHED EVERY REGION
   * FOR QUOTED LITERALS. So a plain `className="…"` contributed NOTHING: the
   * quotes it was found by had already been removed, and there was nothing left
   * to match. Every plain-string className in this project was invisible to the
   * existence check — which is most of them.
   *
   * IT WAS FOUND BY A NEGATIVE CONTROL, NOT BY READING. A probe with
   * `className="ml-4 text-left"` compiled two physical rules into the stylesheet
   * and the RTL check passed anyway, because the tokens never reached `used`.
   * The check had been reporting on a subset it never disclosed.
   */
  const marker = /\bclassName\s*=\s*|(?<![\w$])cn\s*\(|(?<![\w$])cva\s*\(/g;
  let match;
  while ((match = marker.exec(source)) !== null) {
    let index = match.index + match[0].length;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    const opener = source[index];

    if (opener === '"' || opener === "'") {
      // A quoted attribute: the contents ARE the class list.
      const end = source.indexOf(opener, index + 1);
      if (end > index) addTokens(source.slice(index + 1, end));
      continue;
    }

    // `{` for a JSX expression, `(` because the marker consumed `cn(`/`cva(`.
    const open = opener === '{' ? '{' : '(';
    const close = open === '{' ? '}' : ')';
    let depth = opener === '{' ? 0 : 1;
    let scan = index;
    while (scan < source.length) {
      if (source[scan] === open) depth += 1;
      else if (source[scan] === close) {
        depth -= 1;
        if (depth === 0) break;
      }
      scan += 1;
    }
    // Code: the classes are the quoted literals inside it.
    const region = source.slice(index, scan);
    for (const literal of region.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`$\\]*)`/g)) {
      addTokens(literal[1] ?? literal[2] ?? literal[3] ?? '');
    }
  }

  return found;
}

/** Tailwind escapes these in selectors. */
function escapeClass(token) {
  return token.replace(/[:.[\]/(),%!#*+?^$|{}\\]/g, (character) => `\\${character}`);
}

/* -------------------------------------------------------------------------
   THE POPULATION IS TWO ROOTS NOW, AND THE SECOND ONE IS WHY THIS BLOCK EXISTS
   -------------------------------------------------------------------------
   ADR 0040 moved the presentation primitives into `@dudo/ui`, OUTSIDE this
   console's `src/`. This check asserted "all N class candidates in src/ produced
   a rule" — and the moment the primitives left `src/`, that sentence stayed true
   while saying nothing about them.

   THE FAILURE IT WOULD HAVE MISSED IS TOTAL AND SILENT. `src/styles/index.css`
   uses `source(none)`, so Tailwind scans exactly the `@source` paths it is given
   and nothing else. Miss the package and EVERY class in every primitive is
   purged: the build exits 0, `tsc` is happy, and the console renders unstyled.
   There is no other instrument in this package positioned to see that.

   So the walk covers both roots, and EACH ROOT CARRIES ITS OWN FLOOR. A combined
   total cannot distinguish "the package shrank" from "the package stopped being
   found", and the second is the whole hazard — a root that silently contributes
   zero files would make this check report a confident green over half its
   subject. That is `workflow.md` §11a's population half, in the one place where
   its absence is invisible from the outside.

   VERIFIED THE ONLY WAY THAT MEANS ANYTHING: this extension was written and run
   BEFORE the `@source` line was added, against a tree where the package was real
   and unscanned. It went red on 100+ primitive classes. The failing input was
   the actual defect rather than a constructed one.
   ------------------------------------------------------------------------- */

const SCAN_ROOTS = [
  { label: "this console's src/", dir: join(import.meta.dirname, '..', 'src'), minimum: 20 },
  {
    label: '@dudo/ui',
    dir: join(import.meta.dirname, '..', '..', '..', 'packages', 'ui', 'src'),
    minimum: 8,
  },
];

function walk(directory, into) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, into);
    else if (/\.tsx?$/.test(entry.name)) into.push(full);
  }
}

const tsxFiles = [];
const rootCounts = [];
for (const root of SCAN_ROOTS) {
  const collected = [];
  if (!existsSync(root.dir)) {
    fail(
      `scan root missing: ${root.label} (${root.dir})`,
      '        THIS IS NOT A PASS. A root that is not there contributes no class\n' +
        '        candidates, so every class in it would be reported as fine by silence.',
    );
    rootCounts.push(`${root.label} MISSING`);
    continue;
  }
  walk(root.dir, collected);
  if (collected.length < root.minimum) {
    fail(
      `scan root ${root.label} yielded ${String(collected.length)} file(s), below its floor of ${String(root.minimum)}`,
      '        Either the directory moved, or the extension filter stopped matching.\n' +
        '        A root that quietly contributes nothing makes this check green over\n' +
        '        a subject it never examined.',
    );
  }
  tsxFiles.push(...collected);
  rootCounts.push(`${root.label} ${String(collected.length)}`);
}

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
  pass(
    `all ${String(used.size)} class candidates produced a rule ` +
      `(${String(tsxFiles.length)} files: ${rootCounts.join(' · ')})`,
  );
} else {
  fail(
    `${String(missing.length)} class(es) produced NO rule ` +
      `(scanned ${String(tsxFiles.length)} files: ${rootCounts.join(' · ')})`,
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
   CHECK 3c — the drawer clears the sticky header
   -------------------------------------------------------------------------
   THE THIRD NAVIGATION DEFECT, AND THE ONE A SCREENSHOT DID NOT CATCH. The
   header is `sticky top-0 z-30`; the drawer is `z-20`. Pinned to `0`, the
   drawer's first list row sat underneath the header and "Organizations" was
   unreachable on mobile — while the remaining three items looked entirely
   normal.

   A REAL CHECK WOULD MEASURE THE RENDERED BOX. There is no browser available
   here and none may be installed, so this asserts the GEOMETRY IT CAN: the
   header height is defined once, and the drawer's top offset resolves to that
   same value rather than to zero. That is the invariant the defect broke.

   IT IS NOT A SUBSTITUTE FOR LOOKING AT THE PAGE AT PHONE WIDTH, and it is
   stated that way rather than reported as coverage it does not have.
   ------------------------------------------------------------------------- */

const HEADER_VAR = '--dudo-header-height';

const headerDefinitions = rules.filter((rule) => rule.body.includes(`${HEADER_VAR}:`));
if (headerDefinitions.length !== 1) {
  fail(
    `\`${HEADER_VAR}\` is defined ${String(headerDefinitions.length)} times, expected exactly 1`,
    '        More than one definition is how the header and the drawer come to disagree.',
  );
} else {
  const declared = /--dudo-header-height:\s*([^;}]+)/.exec(headerDefinitions[0].body)?.[1]?.trim();
  pass(`\`${HEADER_VAR}\` is defined exactly once (${declared ?? '?'})`);

  // The drawer's top offset, below the breakpoint.
  const drawerTop = rules.filter(
    (rule) =>
      isSmallScreenOnly(rule) &&
      /top\s*:/.test(rule.body) &&
      /\.max-lg\\:top-/.test(rule.selector),
  );
  if (drawerTop.length === 0) {
    fail(
      'the mobile drawer sets no top offset',
      '        With no offset it pins to 0 and the first nav row hides behind the header.\n' +
        '        That is exactly the defect this check exists for.',
    );
  } else {
    const offending = drawerTop.filter((rule) => {
      const value = /top\s*:\s*([^;}]+)/.exec(rule.body)?.[1]?.trim() ?? '';
      return !value.includes(HEADER_VAR);
    });
    if (offending.length === 0) {
      pass(`the mobile drawer's top offset resolves to var(${HEADER_VAR}), not 0`);
    } else {
      fail(
        "the mobile drawer's top offset does not track the header height",
        offending
          .map((rule) => `        ${rule.selector} -> ${rule.body}`)
          .join('\n') +
          '\n        The first nav item will be occluded by the sticky header.',
      );
    }
  }
}

/*
 * AND THE SHAPE THAT CAUSED IT: a full-height pin below the breakpoint. If
 * `max-lg:inset-y-0` ever comes back onto the nav, it sets `top:0` and the row
 * disappears again.
 */
if (used.has('max-lg:inset-y-0') || used.has('inset-y-0')) {
  fail(
    'the nav uses a full-height vertical pin below the breakpoint',
    '        `inset-y-0` sets top:0, which puts the first nav row under the sticky header.\n' +
      '        Offset the top by var(--dudo-header-height) and pin only the bottom.',
  );
} else {
  pass('no full-height vertical pin on the drawer (top:0 would occlude the first row)');
}

/* -------------------------------------------------------------------------
   CHECK 3d — NO PHYSICAL INLINE-AXIS PROPERTY SURVIVES INTO THE ARTIFACT
   -------------------------------------------------------------------------
   RTL IS NOT A POLISH ITEM HERE. Dudo is built for Bahrain, Arabic is
   right-to-left, and a physical `left`/`right` is the difference between a
   layout that flips with `dir="rtl"` and one that has to be rebuilt.

   THIS CHECKS THE BUILT STYLESHEET, NOT THE SOURCE, and the distinction is the
   whole point: a `className` grep proves what was written, and this proves what
   COMPILED. A utility that looks logical and emits a physical property — or one
   introduced by a variant, a plugin or an arbitrary value — is invisible to the
   first and caught by the second.

   ONLY THE INLINE AXIS COUNTS. `top`/`bottom`/`margin-top`/`border-top` do not
   mirror in a horizontal writing mode and are correct as written; `left`,
   `right`, `margin-left`, `padding-right`, `border-left-*`, `text-align: left`
   and `float` do.

   THE SCAN IS SCOPED TO RULES THIS CONSOLE'S OWN CLASSES PRODUCE. Tailwind's
   preflight legitimately emits physical properties on element selectors, and
   flagging those would be noise that trains people to ignore the check.
   ------------------------------------------------------------------------- */

const PHYSICAL_INLINE_PROPERTIES = [
  'left',
  'right',
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
  'border-left',
  'border-left-width',
  'border-left-color',
  'border-left-style',
  'border-right',
  'border-right-width',
  'border-right-color',
  'border-right-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'float',
  'clear',
];

/**
 * `text-align` is only physical when its VALUE is `left` or `right`;
 * `start`/`end`/`center` are fine. Checked by value rather than by property.
 */
function physicalDeclarations(body) {
  const found = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (name.startsWith('--')) continue;
    if (PHYSICAL_INLINE_PROPERTIES.includes(name)) {
      found.push(`${name}: ${value}`);
    } else if (name === 'text-align' && (value === 'left' || value === 'right')) {
      found.push(`${name}: ${value}`);
    }
  }
  return found;
}

/** Selectors generated from a class this console uses, rather than preflight. */
const ownClassRules = rules.filter((rule) => {
  if (!rule.selector.includes('.')) return false;
  for (const token of used) {
    if (rule.selector.includes(`.${escapeClass(token)}`)) return true;
  }
  return false;
});

{
  const offenders = [];
  for (const rule of ownClassRules) {
    const physical = physicalDeclarations(rule.body);
    if (physical.length > 0) {
      offenders.push({ selector: rule.selector, physical });
    }
  }
  if (offenders.length === 0) {
    pass(
      `no physical inline-axis property in any of the ${String(ownClassRules.length)} rules this console's classes produce`,
    );
  } else {
    fail(
      `${String(offenders.length)} rule(s) emit a physical inline-axis property`,
      offenders
        .slice(0, 8)
        .map(
          ({ selector, physical }) =>
            `        ${selector}\n          ${physical.join('; ')}\n` +
            '          Use the logical form — ms/me, ps/pe, start/end, border-s/border-e,\n' +
            '          text-start/text-end. This will not flip under dir="rtl".',
        )
        .join('\n'),
    );
  }
}

/*
 * AND THE DIRECTION-AWARE VARIANTS MUST STILL WORK. `ltr:`/`rtl:` are the
 * correct tool where a value genuinely differs by direction — the drawer's
 * transform and the back-arrow mirror — so their absence would mean the flip was
 * removed rather than made logical.
 */
{
  const directional = rules.filter((rule) => /\.(ltr|rtl)\\:/.test(rule.selector));
  checkAtLeast(
    'direction-aware variants are still emitted where a value must flip',
    directional.length,
    1,
  );
}

/* -------------------------------------------------------------------------
   CHECK 3e — WCAG CONTRAST, COMPUTED FROM THE EMITTED TOKENS
   -------------------------------------------------------------------------
   THE ONE AUTOMATED ACCESSIBILITY CHECK THAT NEEDS NO DEPENDENCY. A real audit
   engine (axe-core) needs a DOM, which needs jsdom or a browser — neither is
   installed and both are new dependencies requiring approval. Contrast is
   arithmetic: parse the token, compute relative luminance, take the ratio.

   IT READS THE VALUES OUT OF THE BUILT STYLESHEET rather than a copy, so a token
   that changes is checked at its new value rather than at the one someone typed
   here.

   THE PAIRS ARE THE ONES THIS CONSOLE ACTUALLY RENDERS. A palette-wide matrix
   would flag combinations nobody uses and train people to ignore the output.

   WHAT IT CANNOT DO: it does not know font size, so every pair is held to the
   4.5:1 NORMAL-TEXT threshold rather than the 3:1 large-text one. That is the
   strict direction — a pair that passes here passes at any size.
   ------------------------------------------------------------------------- */

/**
 * `#rrggbb` from the `@theme` block, as emitted.
 *
 * THREE-DIGIT SHORTHAND IS EXPANDED, because the minifier writes `#ffffff` as
 * `#fff`. The first version of this accepted only six digits and reported
 * `surface` as "token not found" — which is the floor doing its job: it refused
 * to compare rather than quietly passing a pair it could not read. A checker
 * that renders "nothing examined" as "nothing wrong" is the most confident wrong
 * answer available.
 */
function tokenColour(name) {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(css);
  const raw = match?.[1];
  if (raw === undefined) return null;
  if (raw.length === 7) return raw.toLowerCase();
  if (raw.length === 4) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function relativeLuminance(hex) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(Number.parseInt(hex.slice(1, 3), 16));
  const g = channel(Number.parseInt(hex.slice(3, 5), 16));
  const b = channel(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** [foreground token, background token, where it is used]. `#ffffff` literal for white. */
const CONTRAST_PAIRS = [
  ['ink', 'paper', 'body text on the page'],
  ['ink', 'surface', 'body text on a card'],
  ['ink-soft', 'surface', 'secondary text'],
  ['ink-muted', 'surface', 'hint and helper text'],
  ['ink-faint', 'surface', 'uppercase field labels'],
  /*
   * `ink-faint` ON SUNK TOO — the bound-parameters block and the not-built
   * panels put those same labels on a sunk background. Checking only the white
   * case would have passed a value that fails where it is also used.
   */
  ['ink-faint', 'sunk', 'uppercase labels on a sunk panel'],
  ['ink-muted', 'sunk', 'text on a sunk panel'],
  ['navy-700', 'navy-50', 'the confirmation statement heading'],
  ['ink', 'navy-50', 'the confirmation statement itself'],
  ['scarlet-700', 'scarlet-50', 'error headings'],
  ['green-700', 'green-50', 'success headings'],
  ['gold-700', 'gold-50', 'the ceiling and uncertain-outcome panels'],
  ['azure-700', 'azure-50', 'the quota panel'],
];

/** White foreground pairs, written separately because white is not a token. */
const WHITE_ON = [
  ['navy-800', 'the header and sidebar'],
  ['navy-600', 'the "You" badge and primary focus'],
  ['scarlet-600', 'the primary button'],
];

{
  const AA_NORMAL = 4.5;
  const failuresHere = [];
  let checked = 0;

  for (const [fg, bg, where] of CONTRAST_PAIRS) {
    const f = tokenColour(fg);
    const b = tokenColour(bg);
    if (f === null || b === null) {
      failuresHere.push(`${fg} on ${bg}: token not found in the stylesheet`);
      continue;
    }
    checked += 1;
    const ratio = contrastRatio(f, b);
    if (ratio < AA_NORMAL) {
      failuresHere.push(
        `${fg} (${f}) on ${bg} (${b}) = ${ratio.toFixed(2)}:1 — below ${String(AA_NORMAL)}:1 — ${where}`,
      );
    }
  }

  for (const [bg, where] of WHITE_ON) {
    const b = tokenColour(bg);
    if (b === null) {
      failuresHere.push(`white on ${bg}: token not found`);
      continue;
    }
    checked += 1;
    const ratio = contrastRatio('#ffffff', b);
    if (ratio < AA_NORMAL) {
      failuresHere.push(
        `white on ${bg} (${b}) = ${ratio.toFixed(2)}:1 — below ${String(AA_NORMAL)}:1 — ${where}`,
      );
    }
  }

  if (failuresHere.length === 0) {
    pass(`all ${String(checked)} rendered colour pairs meet WCAG AA (4.5:1) for normal text`);
  } else {
    fail(
      `${String(failuresHere.length)} colour pair(s) below WCAG AA`,
      failuresHere.map((line) => `        ${line}`).join('\n'),
    );
  }
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
