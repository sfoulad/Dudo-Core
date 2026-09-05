/**
 * ===========================================================================================
 * THE BUSINESS-TYPE BOUNDARY. `docs/decisions/0025` decision 2 · `CORE_BOUNDARIES.md` §1.
 * ===========================================================================================
 *
 * `platform/core/platform/templates.ts:23` and `migrations/control-plane/0012_template.sql:29`
 * both state the same obligation in the same words, and both call it a REVIEW obligation:
 *
 *   *"THE CHECKABLE FORM, AND IT IS A REVIEW OBLIGATION ON EVERY CHANGE HERE: **NO IDENTIFIER IN
 *   `platform/core/**` MAY NAME A BUSINESS TYPE.** No `SCHOOL_LABELS`, no `isClinic()`, no
 *   `switch (template.name)`, no seeded row that code branches on. **The moment Core reads a
 *   Template's NAME to decide behaviour, the row has become a column.**"*
 *
 * `core-agent` wrote the grep, ran it in its own harness, and asked for it to be owned by tests
 * instead — which is right. A control that lives in the author's scratch harness is a control that
 * runs when the author remembers, and the thing it guards is permanent: `CORE_BOUNDARIES.md` §1,
 * *"the cost of wrongly including something is a constraint on every future business type, and it
 * is effectively permanent."*
 *
 * ===========================================================================================
 * WHAT THIS CAN AND CANNOT SEE. READ IT BEFORE QUOTING THE GREEN RESULT.
 * ===========================================================================================
 *
 * IT IS A WORD SEARCH OVER SOURCE TEXT WITH COMMENTS REMOVED. It catches the shapes the rule
 * names — a `SCHOOL_LABELS` constant, an `isClinic()`, a `'Dental Clinic'` literal, a seeded row.
 * **It cannot catch Core branching on a Template name it never spells out**, e.g.
 * `if (template.name === configuredSpecialCase)`. That remains a review obligation and is not
 * claimed to be closed here.
 *
 * THE COMMENT FILTER IS THE LOAD-BEARING PART AND IT IS A HEURISTIC. Both files that state this
 * rule state it using the words `School`, `Dental Clinic`, `Salon` and `Retail` as examples — so
 * an unstripped search fails on the documentation that exists to record the property, exactly as
 * `no-tenant-reach.ts` found for `TenantStoreResolver`. `core-agent`'s version was line-oriented
 * and said so; this one is a character lexer, which is strictly stronger, and it still shares the
 * same honest limit: a `//` or `--` inside a string literal is treated as a comment.
 *
 * **THE FAILURE DIRECTION IS TOWARD REMOVING MORE TEXT.** Over-stripping can only make this check
 * weaker, never falsely red. So a green result is a slightly weaker claim than "Core contains none
 * of these words" and a red result is exact.
 *
 * ===========================================================================================
 * WHY THE WORD LIST IS SHORT, AND WHY `accounting` IS DELIBERATELY NOT IN IT
 * ===========================================================================================
 *
 * `accounting` is a business type AND an ordinary English word, and Core uses it in the ordinary
 * sense throughout `protection/**` — *"accounted in the same ledger"*. Including it would produce a
 * red on every run that somebody would then learn to ignore, and **a control whose reds are
 * routinely dismissed is worse than one that does not exist**, because it launders the habit of
 * dismissing this file. The same reasoning excludes `consultancy` and `agency`.
 *
 * The list is therefore the unambiguous ones: words that have no meaning in a control plane.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { stripComments } from '../../harness/source-text.ts';

import {
  MAX_TEMPLATE_LABEL_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  TEMPLATE_LEVELS,
} from '../../../../platform/core/platform/templates.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE_DIRECTORY = `${REPOSITORY_ROOT}platform/core`;

/**
 * Business types with no second meaning in a control plane.
 *
 * Matched case-insensitively and on a word boundary, so `SCHOOL_LABELS`, `isClinic`, `School` and
 * `"Dental Clinic"` are all caught while `preschooler` — were it ever to appear — is not.
 */
const BUSINESS_TYPE_WORDS: readonly string[] = Object.freeze([
  'school',
  'clinic',
  'dental',
  'salon',
  'restaurant',
  'pharmacy',
  'bakery',
  'barber',
  'boutique',
  'grocery',
  'veterinary',
  'dentist',
  'optician',
  'physiotherapy',
]);

/**
 * `retail` is matched too, but only as an IDENTIFIER PART rather than as free-standing prose,
 * because a comment saying "retail" survives the stripper when it sits inside a string. Kept
 * separate so the reason is visible rather than buried in one list.
 */
const RETAIL = 'retail';

function listSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...listSourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.sql')) {
      found.push(path);
    }
  }
  return found;
}

export function buildBusinessTypeBoundarySuite(): Suite {
  const suite = new Suite('Platform — the business-type boundary (0025 decision 2)');

  suite.test('no identifier or literal in platform/core/** names a business type', () => {
    const files = listSourceFiles(CORE_DIRECTORY);
    assertTrue(
      'there is Core source to check',
      files.length >= 20,
      `only ${String(files.length)} files were found under ${CORE_DIRECTORY}; the walk is wrong ` +
        'and a green result here would mean nothing',
    );

    const offences: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'), file.endsWith('.sql') ? 'sql' : 'ts');
      for (const word of [...BUSINESS_TYPE_WORDS, RETAIL]) {
        const pattern = new RegExp(`\\b${word}\\b`, 'i');
        if (pattern.test(code)) {
          offences.push(`${file.slice(REPOSITORY_ROOT.length)} names '${word}'`);
        }
      }
    }
    assertEqual(
      `${ISOLATION} Core knows a Template is a named record and knows nothing about which one`,
      offences.join(' · '),
      '',
    );
  });

  suite.test('the stripper has not simply eaten the file — the control for the control', () => {
    // WITHOUT THIS THE CASE ABOVE IS UNREADABLE. A stripper that returned '' would make it green
    // forever, and over-stripping is precisely the failure direction the header admits to. So:
    // a word that IS present in Core outside a comment must still be found after stripping.
    //
    // `organization` is the right probe. It is everywhere in Core as an identifier, it is a
    // Template LEVEL rather than a business type, and it is not on the list above — so its
    // presence proves the search still sees code without weakening the assertion.
    const files = listSourceFiles(CORE_DIRECTORY);
    const survivors = files.filter((file) =>
      /\borganization\b/i.test(
        stripComments(readFileSync(file, 'utf8'), file.endsWith('.sql') ? 'sql' : 'ts'),
      ),
    );
    assertTrue(
      'the stripped source still contains ordinary Core identifiers',
      survivors.length >= 10,
      `only ${String(survivors.length)} files still mention 'organization' after stripping, so ` +
        'the stripper is removing far too much and the business-type search above is vacuous',
    );

    // And the stripper must remove the documentation the rule is written in, or the case above
    // could never be green. Asserted on the file that states the rule.
    const rule = readFileSync(`${CORE_DIRECTORY}/platform/templates.ts`, 'utf8');
    assertTrue(
      'the raw rule text does contain the example business types',
      /\bDental\b/.test(rule),
      'templates.ts no longer documents the rule with examples; if the documentation moved, this ' +
        'control is no longer demonstrating that the stripper does anything',
    );
    assertTrue(
      'and the stripped form does not',
      !/\bDental\b/i.test(stripComments(rule, 'ts')),
      'the comment stripper left the rule documentation in place, which means the case above is ' +
        'red for the documentation rather than for a defect',
    );
  });

  suite.test('no migration seeds a Template row for code to branch on', () => {
    // *"no seeded row that code branches on"* — the one clause of the rule that is about data
    // rather than source. A seeded 'School' row is a business type in Core by another route, and
    // it would not be caught by a search for identifiers.
    const migrations = listSourceFiles(`${CORE_DIRECTORY}/migrations`).filter((file) =>
      file.endsWith('.sql'),
    );
    assertTrue(
      'there are migrations to check',
      migrations.length > 0,
      'no migration was found',
    );
    const offences = migrations.filter((file) =>
      /insert\s+into\s+template\b/i.test(stripComments(readFileSync(file, 'utf8'), 'sql')),
    );
    assertEqual(
      `${ISOLATION} the Template catalogue ships empty; every row is an operator typing`,
      offences.map((file) => file.slice(REPOSITORY_ROOT.length)).join(' · '),
      '',
    );
  });

  suite.test('a Template has nowhere to put logic — the shape IS the enforcement', () => {
    // `templates.ts`: *"A Template is a name, three label strings and a status. There is no `rules`
    // field, no `config` object, no JSON value and no open map — a shape with nowhere to put logic
    // is a shape logic cannot be put into."*
    //
    // Asserted over the type's own source and over the migration, because the claim is about what
    // the shape PERMITS and a runtime value only shows what one instance happens to hold.
    const forbidden = [
      'rules',
      'config',
      'script',
      'expression',
      'condition',
      'workflow',
      'formula',
    ];
    const sources: readonly [string, string][] = [
      ['platform/core/platform/templates.ts', `${CORE_DIRECTORY}/platform/templates.ts`],
      ['platform/core/platform/template-store.ts', `${CORE_DIRECTORY}/platform/template-store.ts`],
      [
        'migrations/control-plane/0012_template.sql',
        `${CORE_DIRECTORY}/migrations/control-plane/0012_template.sql`,
      ],
    ];
    const offences: string[] = [];
    for (const [label, path] of sources) {
      const code = stripComments(readFileSync(path, 'utf8'), path.endsWith('.sql') ? 'sql' : 'ts');
      for (const word of forbidden) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(code)) {
          offences.push(`${label} names '${word}'`);
        }
      }
    }
    assertEqual(
      `${ISOLATION} no Template field could carry logic`,
      offences.join(' · '),
      '',
    );

    // The levels are a CLOSED set of three, not an open map. Asserted against the exported value
    // so a fourth level is a deliberate change rather than an append.
    assertEqual(
      'the label levels are exactly the three the closed set declares',
      [...TEMPLATE_LEVELS].sort().join(','),
      'branch,organization,workspace',
    );
    // The bounds, pinned. A name long enough to hold a sentence is a name long enough to hold a
    // rule, which is the same erosion arriving through the length limit.
    assertEqual('the name bound is the contract\'s', MAX_TEMPLATE_NAME_LENGTH, 80);
    assertEqual('the label bound is the contract\'s', MAX_TEMPLATE_LABEL_LENGTH, 40);
  });

  return suite;
}
