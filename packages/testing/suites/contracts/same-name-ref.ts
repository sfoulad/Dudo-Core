/**
 * ===========================================================================================
 * A CROSS-SCHEMA `$ref` TO A `$def` OF THE SAME NAME — the TS2456 case, and its mirror.
 * ===========================================================================================
 *
 * `export type WidgetId = WidgetId;` is a type that refers to itself. TypeScript rejects it with
 * **TS2456, "Type alias circularly references itself"** — so the defect is loud once it compiles.
 * **It is quiet until then**, because the generator emits happily and nothing in this repository
 * type-checks generated output at emission time.
 *
 * The fixture and the assertion table are `architecture-agent`'s, relayed through the Team Lead.
 * `architecture-agent` owns `packages/contracts/**` and **cannot run a parser or a generator** —
 * it has no Bash tool — so it can specify this and not execute it. The fixture lives here because
 * `packages/testing/fixtures/**` is `qa-agent`'s, and running it is something this side can do.
 *
 * ===========================================================================================
 * WHY ROW 4 CARRIES THE WEIGHT, IN THE AUTHOR'S OWN WORDS
 * ===========================================================================================
 *
 *   > "Without it, a repair that suppressed EVERY cross-schema alias passes 1, 2, 3 and 5, and
 *   >  the working path is gone."
 *
 * **A fixture containing only the failing case cannot show that the repair left the working path
 * alone.** `widgetLabel` → `widgetName` is a DIFFERENT-name cross-schema `$ref` and must still
 * emit a real alias. It is the mirror control and it is the row a tidy-up would delete first.
 *
 * ===========================================================================================
 * AND ASSERTION 5 GAINED `label` FOR THE SAME REASON ONE LAYER DOWN
 * ===========================================================================================
 *
 * Testing only `holder.id` proves a local `$ref` reaches a **re-exported** name and says nothing
 * about whether it still reaches an **ordinary alias**. Both are asserted.
 *
 * ===========================================================================================
 * THE SCHEMA INDEX IS BUILT BY THE REAL `buildSchemaIndex`, NOT HAND-CONSTRUCTED
 * ===========================================================================================
 *
 * Pointed at the fixture directory. A hand-built `Map` would be a second implementation of the
 * indexer, and the two would disagree silently — the defect this whole file is about, one layer
 * up. It also means the fixture is indexed exactly as a real contract is.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
// eslint-disable-next-line
import { buildSchemaIndex, emitModule } from '../../../contracts/generator/generate-types.mjs';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/contract-generator/same-name-ref/', import.meta.url),
);

type Refusal = { readonly code: string; readonly message: string };

function emitFixture(): { readonly text: string; readonly refusals: readonly Refusal[] } {
  const built = buildSchemaIndex(FIXTURE) as {
    index: Map<string, unknown>;
    problems: readonly { readonly message: string }[];
  };
  if (built.problems.length > 0) {
    throw new Error(
      `the fixture did not index cleanly, so nothing below is measuring the emitter: ` +
        built.problems.map((problem) => problem.message).join(' ; '),
    );
  }
  const schema: unknown = JSON.parse(readFileSync(`${FIXTURE}same-name-source.schema.json`, 'utf8'));
  const result = emitModule({
    schema,
    contractName: 'same-name-source',
    sourceName: 'same-name-source.schema.json',
    schemaIndex: built.index,
    operations: [],
  }) as { errors?: Refusal[]; text?: string; source?: string };
  return { text: String(result.text ?? result.source ?? ''), refusals: result.errors ?? [] };
}

export function buildSameNameRefSuite(): Suite {
  const suite = new TestSuite('generator — a cross-schema $ref to a $def of the SAME NAME (TS2456)');

  suite.test('FLOOR — the fixture indexes cleanly and the emitter produced a module', () => {
    const { text, refusals } = emitFixture();
    console.log(
      `      emitted ${String(text.split('\n').length)} line(s), ${String(refusals.length)} refusal(s)`,
    );
    // Without this, a fixture that stopped being found would yield an empty string, and every
    // `does not contain` assertion below would pass over nothing — `§11a`'s empty-list reader,
    // and this file is FULL of negative assertions, which is exactly where it bites.
    assertTrue(
      'the emitter produced a non-trivial module',
      text.includes('export type'),
      `emitted text has no exported type at all:\n${text.slice(0, 200)}`,
    );
  });

  suite.test('1 — NO `export type WidgetId = WidgetId;` is emitted. THE DEFECT ITSELF', () => {
    const { text } = emitFixture();
    assertTrue(
      `${ISOLATION} the self-referential alias is not emitted`,
      !/export type WidgetId = WidgetId;/.test(text),
      'the emitter produced `export type WidgetId = WidgetId;` — TS2456, a type alias circularly ' +
        'referencing itself. It is emitted silently and only fails when something compiles it.',
    );
  });

  suite.test('2 — `WidgetId` is in the import line from the target module', () => {
    const { text } = emitFixture();
    const importLine = /^import type \{([^}]*)\} from '\.\/same-name-target\.ts';$/m.exec(text);
    assertTrue('an import from the target exists', importLine !== null, `no import line in:\n${text.slice(0, 400)}`);
    if (importLine === null) return;
    assertTrue(
      'and it names WidgetId — the collision filter did not eat the import',
      /\bWidgetId\b/.test(importLine[1]),
      `imported: ${importLine[1].trim()}. Skipping the local alias must not also skip the import; ` +
        'without it the re-export below names something that is not in scope.',
    );
  });

  suite.test('3 — `export type { WidgetId };` survives the skipped alias', () => {
    const { text } = emitFixture();
    assertTrue(
      'the public surface still exports WidgetId',
      /export type \{[^}]*\bWidgetId\b[^}]*\};/.test(text),
      'the local alias was correctly skipped and the name was dropped from the public surface with ' +
        'it. A consumer importing `WidgetId` from this module then fails to resolve — the quiet ' +
        'defect replacing the loud one.',
    );
  });

  suite.test('4 — MIRROR CONTROL: `export type WidgetLabel = WidgetName;` is STILL emitted', () => {
    // THE ROW THAT CARRIES THE WEIGHT. A repair suppressing every cross-schema alias passes 1, 2,
    // 3 and 5 — and silently removes the working path. This is the only assertion that fails on
    // an over-broad fix, and it is the one a tidy-up would delete first.
    const { text } = emitFixture();
    assertTrue(
      'a DIFFERENT-name cross-schema $ref still emits a real alias',
      /export type WidgetLabel = WidgetName;/.test(text),
      'the different-name alias is gone. The repair for the same-name case suppressed EVERY ' +
        'cross-schema alias, which passes every other assertion here while removing the path that ' +
        'was working.',
    );
  });

  suite.test('5 — a local `$ref` reaches BOTH a re-exported name and an ordinary alias', () => {
    const { text } = emitFixture();
    const holder = /export type Holder = \{([\s\S]*?)\};/.exec(text);
    assertTrue('the holder object was emitted', holder !== null, `no Holder in:\n${text.slice(0, 400)}`);
    if (holder === null) return;
    // Both, deliberately. `id` proves a local `$ref` resolves to a RE-EXPORTED name; `label`
    // proves it still resolves to an ORDINARY alias. Testing only the first says nothing about
    // the second, which is row 4's argument one layer down.
    assertTrue(
      'holder.id resolves to the re-exported WidgetId',
      /\bid:\s*WidgetId;/.test(holder[1]),
      `Holder body: ${holder[1].replace(/\s+/g, ' ').trim()}`,
    );
    assertTrue(
      'holder.label resolves to the ordinary alias WidgetLabel',
      /\blabel:\s*WidgetLabel;/.test(holder[1]),
      `Holder body: ${holder[1].replace(/\s+/g, ' ').trim()}`,
    );
  });

  suite.test('6 — a same-name $ref with a CONSTRAINING sibling is REFUSED, naming keyword and remedy', () => {
    // THE SILENT HALF. `architecture-agent`'s annotation-only guard correctly declined to
    // re-export a narrowed shape — and then fell through to the ordinary path and emitted
    // `export type NarrowedId = NarrowedId;`. **The guard against the quiet failure restored the
    // loud one.** There is no correct output: TypeScript cannot express `maxLength`, so every
    // spelling is either circular or a lie about the constraint. Refusal is the answer.
    const { refusals } = emitFixture();
    const narrowed = refusals.filter((refusal) => refusal.message.includes('narrowedId'));
    assertEqual('exactly one refusal names narrowedId', narrowed.length, 1);
    if (narrowed.length !== 1) return;
    assertTrue(
      'the refusal names the CONSTRAINING KEYWORD, so the author knows what to remove',
      narrowed[0].message.includes('maxLength'),
      `message: ${narrowed[0].message}`,
    );
    assertTrue(
      'and it names a REMEDY the tool accepts — rename the local def',
      /rename the local def/i.test(narrowed[0].message),
      `message: ${narrowed[0].message}. \`§11a\`: a refusal naming a remedy the tool does not ` +
        'accept is a refusal with no exit, and a bare refusal makes a reader think while a ' +
        'remedy-naming one sends them looking for something that must exist.',
    );
  });

  suite.test('AND THE REFUSED MODULE IS NEVER STAGED — measured, because the text still contains the defect', () => {
    // ⚠ THE EMITTER STILL PRODUCES `export type NarrowedId = NarrowedId;` IN THE SAME RUN THAT
    // REFUSES IT. Measured, not inferred — it is in the text this suite reads.
    //
    // That is safe TODAY and only because of the caller: `generate-types.mjs`'s run loop reads
    //
    //     if (emitted.errors.length > 0) { report.refusals.push(...emitted.errors); continue; }
    //
    // so a refused module is never staged and the line never reaches disk. **That is a discipline
    // in the CALLER rather than a property of the emitter** — `architecture.md` §3a's distinction
    // exactly. A second caller of `emitModule` that does not check `errors.length` writes a
    // TS2456 line, and nothing in `emitModule` would stop it.
    //
    // Recorded rather than filed as a defect: the single caller is correct, and asking the
    // emitter to also suppress its own output would duplicate the decision in two places. **What
    // is asserted is the property that actually protects the tree** — a module with refusals
    // carries no promise about its text, and the caller must not write it.
    const { text, refusals } = emitFixture();
    assertTrue(
      'the refused construct IS still present in the emitted text',
      /export type NarrowedId = NarrowedId;/.test(text),
      'the emitter no longer produces the circular line for a refused def. That is an IMPROVEMENT ' +
        'and this assertion should be inverted — but do it deliberately, because the caller-side ' +
        'guard is then the only thing this case was documenting and it needs its own assertion.',
    );
    assertTrue(
      `${ISOLATION} and the module is refused, which is what keeps that text off disk`,
      refusals.length > 0,
      'the text contains a TS2456 line AND the module reports no refusal, so the run loop will ' +
        'STAGE IT. That is the defect reaching the tree.',
    );
  });

  return suite;
}
