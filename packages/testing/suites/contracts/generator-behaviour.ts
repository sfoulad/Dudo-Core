/**
 * ===========================================================================================
 * THE `0037` GENERATOR'S BEHAVIOURS — the ones nothing in the corpus exercises.
 * ===========================================================================================
 *
 * `architecture-agent` names, for each of these, what verifies it — and for three of them the
 * answer was *"a mutant in `qa-agent`'s scratchpad"*. Its own words about one of them:
 *
 *   > *"If that mutant is ever deleted, this fix goes untested and looks fine."*
 *
 * **`.claude/rules/workflow.md` §11a: a preserved artifact goes in the repository or it is not
 * preserved** — a rule written after a previous session's scratchpad evaporated and took a
 * reproduction fixture with it. This file is that rule executed.
 *
 * ===========================================================================================
 * WHAT IS VERIFIED ONLY HERE, AND BY NOTHING ELSE
 * ===========================================================================================
 *
 *   the cascade                 no shipped contract imports a refused module
 *   depth-two transitivity      claimed by the cascade's own description; measured only here
 *   over-refusal precision      no shipped contract is BOTH clean and importing something
 *   the `$ref`-sibling refusal  no shipped schema carries a `$ref` beside a shape keyword
 *   the duplicate-name backstop no shipped schema collides a root type with a `$defs` key
 *   message distinguishability  see the case that asserts it; it is a property, not an accident
 *
 * **Every one of these is green on the corpus for a reason that belongs to the CORPUS rather than
 * to the generator.** That is the shape all three of this session's sound-by-accident findings
 * shared, and it is why these inputs are constructed rather than recovered: there is nothing to
 * recover.
 */

import {
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { emitModule, refusalAuthorFor, run } from '../../../contracts/generator/generate-types.mjs';

/**
 * *** `cascade/`, NOT `contract-generator/`. THE EXTRA LEVEL IS LOAD-BEARING. ***
 *
 * `architecture-agent`'s drift fixture lives beside this one under `contract-generator/drift/`.
 * The generator's `walk()` skips `generated` and `fixtures` by name and **does not skip `drift`**,
 * so a run rooted one level up would discover FIVE contracts where the cascade cases assert four —
 * and they count. Two fixture sets under one name that must never be walked together is a trap
 * someone re-creates; **a directory boundary is the only thing that stops them.**
 */
const FIXTURES = fileURLToPath(new URL('../../fixtures/contract-generator/cascade/', import.meta.url));
const ENVELOPE = fileURLToPath(
  new URL('../../../contracts/common/error-envelope.schema.json', import.meta.url),
);

/**
 * *** A THIRD FIXTURE TREE, AND THE DIRECTORY LEVEL IS LOAD-BEARING FOR THE SAME REASON. ***
 *
 * `cascade/`, `drift/`, `class-ambiguity/` and now `index-incomplete/` all sit under
 * `contract-generator/`, and every tool here walks its root RECURSIVELY. Rooted one level up, the
 * cascade cases would discover this tree's two contracts and count them. `walk()` skips `generated`
 * and `fixtures` BY NAME and would skip none of these.
 *
 * **This tree is the only one that contains DELIBERATELY UNPARSEABLE JSON**, which is why it can
 * live nowhere near `packages/contracts/**`: `check:schema-parse` parses every JSON file under that
 * path, referenced or not, and runs FIRST in the gate. A broken schema placed there would fail the
 * gate before any suite ran. The two are complementary and their scopes must not overlap — that
 * check asserts the real corpus is well-formed; this fixture needs a corpus that is not.
 */
const INDEX_INCOMPLETE = fileURLToPath(
  new URL('../../fixtures/contract-generator/index-incomplete/', import.meta.url),
);

type Refusal = { readonly code: string; readonly message: string; readonly contract?: string };

/** Emits one module in memory and returns what it refused and what it named. */
function emit(schema: unknown, contractName: string): {
  refusals: Refusal[];
  typeNames: string[];
} {
  const result = emitModule({
    schema,
    contractName,
    sourceName: `common/${contractName}.schema.json`,
    schemaIndex: new Map(),
    operations: [],
  }) as { errors?: Refusal[]; text?: string; source?: string };
  const typeNames = String(result.text ?? result.source ?? '')
    .split('\n')
    .filter((line) => line.startsWith('export type'))
    .map((line) => line.replace('export type ', '').replace(/[ <=].*/, ''));
  return { refusals: result.errors ?? [], typeNames };
}

const envelope = (): Record<string, unknown> =>
  JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Record<string, unknown>;

/** `$defs` of a fresh copy of the real envelope, for mutation. */
const defsOf = (schema: Record<string, unknown>): Record<string, unknown> =>
  schema['$defs'] as Record<string, unknown>;

type GeneratorReport = {
  readonly refusals?: readonly Refusal[];
  readonly warnings?: readonly { readonly contract?: string; readonly message: string }[];
  readonly population?: Readonly<Record<string, unknown>>;
  readonly migrationNotice?: string;
  readonly fatal?: string;
};

/** Every file under a directory, relative to it. */
function filesUnder(directory: string, base = directory, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/**
 * Copies the `index-incomplete/` fixture to a temporary directory, applies one mutation, and runs
 * the generator over the copy. **Nothing is written into the repository** — the fixture on disk
 * stays broken, which is what makes it a fixture.
 */
function overIndexIncomplete(mutate: (work: string) => void): {
  report: GeneratorReport;
  written: string[];
  unreadable: { count: number; stems: string[] };
} {
  const temporary = mkdtempSync(join(tmpdir(), 'dudo-index-incomplete-'));
  try {
    const work = join(temporary, 'c');
    cpSync(INDEX_INCOMPLETE, work, { recursive: true });
    mutate(work);
    // Derived on the MUTATED copy, before the run, so the expectation belongs to the input the
    // generator actually saw rather than to the fixture as committed.
    const independent = unreadable(work);
    const output = join(temporary, 'out');
    const report = run({ mode: 'emit', root: `${work}/`, outputRoot: `${output}/` }) as GeneratorReport;
    return { report, written: filesUnder(output), unreadable: independent };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * *** THE INDEPENDENT DERIVATION OF "HOW MANY FILES ARE UNREADABLE". ***
 *
 * `workflow.md` §11a: report the population against an expectation derived by something that shares
 * no code path with the thing being checked. Asserting the message's count against
 * `report.population.unparseableSchemas` would be asking the generator to confirm its own arithmetic
 * — one derivation wearing two hats. This walks the fixture and calls `JSON.parse` itself.
 *
 * It returns the STEMS as well as the count, because the second assertion needs them: a refusal may
 * name the URN it could not resolve and must NOT name the file it could not read.
 */
function unreadable(root: string): { count: number; stems: string[] } {
  const stems = filesUnder(root)
    .filter((relative) => relative.endsWith('.schema.json'))
    .filter((relative) => {
      try {
        JSON.parse(readFileSync(join(root, relative), 'utf8'));
        return false;
      } catch {
        return true;
      }
    })
    .map((relative) => (relative.split('/').pop() ?? '').replace(/\.schema\.json$/u, ''));
  return { count: stems.length, stems };
}

/**
 * *** THIS WAS A REGEX OVER THE GENERATOR'S SOURCE UNTIL `refusalAuthorFor` WAS EXPORTED, AND THE
 * *** REASON IT IS GONE IS WORTH MORE THAN THE FUNCTION THAT REPLACED IT. ***
 *
 * `REFUSAL_AUTHOR` was module-private, and `formatReport` — the only thing rendering the
 * `contract / generator / derived` tally — is not exported either, so `run()`'s report carried the
 * CODE and never the AUTHORSHIP. Authorship is the first property this fixture was commissioned to
 * prove, so it was read out of the source text: fail-closed, and controlled by pinning a second
 * value through the same reader.
 *
 * **`architecture-agent` named a hazard in it that the control did not cover**, and it is the one
 * worth keeping:
 *
 *   > *Reformat the object — one entry per line becoming two, a trailing comma moving — and the
 *   > reader SILENTLY STOPS SEEING ENTRIES while every assertion it still makes passes on the ones
 *   > it found.*
 *
 * **`§11a`'s check-handed-half, arriving through a parser nobody meant to write.** A check that
 * reads a source file as text is asserting about a STRING, not about the running map. The export
 * removes it entirely, and the assertions below now bind the map the generator actually uses.
 *
 * `refusalAuthorFor` THROWS on an undeclared code rather than returning `undefined`, so a suite
 * cannot ask about a code that does not exist and be quietly told something.
 */

export function buildGeneratorBehaviourSuite(): Suite {
  const suite = new Suite('Contracts — generator behaviours the corpus does not exercise');

  suite.test('*** THE CASCADE: refused, orphaned and delivered, with the floor first ***', () => {
    // ===================================================================================
    // bad     refuses                              shared, no contract beside it
    // dep  -> bad          depth 1                 must be REFUSED
    // top  -> dep -> bad   depth 2, transitivity   must be REFUSED
    // fine    clean                                shared, no contract beside it
    // neighbour -> fine    the precision control   must be DELIVERED
    // good    imports nothing, THE FLOOR           must be DELIVERED
    // ===================================================================================
    const output = mkdtempSync(join(tmpdir(), 'dudo-generator-behaviour-'));
    try {
      const report = run({ mode: 'emit', root: FIXTURES, outputRoot: `${output}/` }) as {
        refusals?: Refusal[];
      };
      assertTrue(
        `${ISOLATION} the run produced a \`refusals\` array`,
        Array.isArray(report.refusals),
        `the report has no \`refusals\`; keys are ${Object.keys(report).join(', ')}. An earlier ` +
          'version of this probe read `report.errors`, which does not exist, and printed "zero ' +
          'refusals" for a run that had two — its own empty-list reader',
      );

      const written: string[] = [];
      const walk = (directory: string): void => {
        if (!existsSync(directory)) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = `${directory}${entry.name}`;
          if (entry.isDirectory()) walk(`${path}/`);
          else written.push(path.slice(output.length + 1));
        }
      };
      walk(`${output}/`);
      const wrote = (fragment: string): boolean => written.some((file) => file.includes(fragment));

      // THE FLOOR, ASSERTED BEFORE ANY NEGATIVE. Without a delivered module in the same run,
      // "dep-v1.ts was not written" cannot be told apart from "nothing was written at all".
      assertTrue(
        `${ISOLATION} THE FLOOR: good-v1 was delivered, so the refusals below mean something`,
        wrote('good-v1'),
        `nothing was delivered; written=${JSON.stringify(written)}`,
      );
      assertTrue(
        `${ISOLATION} PRECISION: neighbour-v1 was delivered — it imports a CLEAN shared schema`,
        wrote('neighbour-v1') && wrote('fine'),
        `an over-approximating cascade would refuse this; written=${JSON.stringify(written)}`,
      );

      const unemittable = (report.refusals ?? []).filter(
        (entry) => entry.code === 'GEN_UNEMITTABLE_DEPENDENCY',
      );
      assertTrue(
        `${ISOLATION} DEPTH 1: dep-v1 was refused and not written`,
        !wrote('dep-v1') && unemittable.some((entry) => JSON.stringify(entry).includes('dep-v1')),
        `written=${JSON.stringify(written)} refusals=${JSON.stringify(report.refusals)}`,
      );
      assertTrue(
        `${ISOLATION} DEPTH 2: top-v1 was refused and not written, and it never names \`bad\``,
        !wrote('top-v1') && unemittable.some((entry) => JSON.stringify(entry).includes('top-v1')),
        'transitivity is claimed by the cascade and this is the only thing that measures it: ' +
          `written=${JSON.stringify(written)} refusals=${JSON.stringify(report.refusals)}`,
      );
      assertTrue(
        'and the refused shared module itself was not written',
        !wrote('bad'),
        `written=${JSON.stringify(written)}`,
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  suite.test('*** A `$ref` WITH A SHAPE-BEARING SIBLING IS REFUSED — at any depth ***', () => {
    // ===================================================================================
    // THE DISEASE, NOT THE SYMPTOM. Since draft 2019-09 `$ref` is NOT exclusive:
    // `{"$ref": X, "type": "object"}` means "matches X AND is an object" — an INTERSECTION.
    // `renderType` returns the reference and drops every sibling, so the correct rendering is
    // `X & {…}` and the actual rendering is `X`. SILENTLY.
    //
    // A fix aimed only at the ROOT would have closed the duplicate-name symptom and left this
    // open, and this is the one that is silent rather than merely late.
    // ===================================================================================
    const nested = envelope();
    defsOf(nested)['nestedIntersection'] = { $ref: '#/$defs/errorCode', enum: ['invalid_argument'] };
    const nestedResult = emit(nested, 'error-envelope');
    assertTrue(
      `${ISOLATION} a \`$ref\` beside an \`enum\` inside \`$defs\` is refused, naming the sibling`,
      nestedResult.refusals.some((entry) => entry.message.includes('shape-bearing sibling')),
      `refusals=${JSON.stringify(nestedResult.refusals)}`,
    );

    const deep = envelope();
    defsOf(deep)['deepIntersection'] = {
      type: 'object',
      additionalProperties: false,
      properties: { field: { $ref: '#/$defs/errorMessage', type: 'string' } },
    };
    assertTrue(
      `${ISOLATION} and one nested inside a PROPERTY is refused too — depth is not the criterion`,
      emit(deep, 'error-envelope').refusals.some((entry) =>
        entry.message.includes('shape-bearing sibling'),
      ),
      'a fix scoped to the root would pass this',
    );

    // *** THE MIRROR, AND IT MATTERS AS MUCH AS THE REFUSAL. ***
    // Annotations are not siblings in this sense. If this ever refuses, the rule is too wide and
    // every documented `$ref` in the corpus breaks — a refusal on valid input is a broken tool
    // rather than a strict one.
    const annotated = envelope();
    defsOf(annotated)['annotatedRef'] = {
      $ref: '#/$defs/errorCode',
      description: 'an annotation, not a shape-bearing sibling',
      $comment: 'likewise',
    };
    assertEqual(
      `${ISOLATION} MIRROR: a \`$ref\` with only ANNOTATION siblings is accepted`,
      JSON.stringify(emit(annotated, 'error-envelope').refusals.map((entry) => entry.code)),
      '[]',
    );
  });

  suite.test('THE BACKSTOP IS EXERCISED WITHOUT A `$ref`, or nobody knows which mechanism fired', () => {
    // A duplicate export name arising from a cause NOBODY HAS CONSIDERED is what the backstop is
    // for, so it must be reachable without the one cause we know about. Here: a module whose root
    // emits `ProbeV1` and whose `$defs` carries a key that pascal-cases to the same name.
    const result = emit(
      {
        $id: 'urn:dudo:schema:probe:1',
        type: 'object',
        additionalProperties: false,
        required: ['a'],
        properties: { a: { type: 'string' } },
        $defs: { probeV1: { type: 'number' } },
      },
      'probe-v1',
    );
    assertTrue(
      `${ISOLATION} a duplicate export name with no \`$ref\` involved is refused`,
      result.refusals.some((entry) => entry.message.includes('already exports')),
      `refusals=${JSON.stringify(result.refusals)}`,
    );
    assertTrue(
      'and no module is emitted carrying the same name twice',
      new Set(result.typeNames).size === result.typeNames.length,
      `duplicate names survived: ${JSON.stringify(result.typeNames)}`,
    );
  });

  suite.test('*** ONE DEFECT REPORTS AS ONE REFUSAL, AND THE TWO MESSAGES STAY DISTINGUISHABLE ***', () => {
    // ===================================================================================
    // TWO PROPERTIES THAT ARE EASY TO LOSE TO A TIDY-UP, AND ONE OF THEM ALREADY PAID OUT.
    // ===================================================================================
    //
    // 1. A node that is BOTH an intersection and a collision is ONE defect. Reporting it twice
    //    would make one defect read as two — the mirror of reporting the symptom alone.
    //
    // 2. THE TWO MESSAGES MUST REMAIN TELLABLE APART. `architecture-agent` considered merging
    //    them into one clearer message and did not, because a finding depended on distinguishing
    //    them: the root-`$ref`-plus-`type` mutant is caught by the BACKSTOP, not by the cause,
    //    and that was visible only because the two read differently. **A future merge would cost
    //    the next diagnosis silently, so it goes red here instead.**
    const both = envelope();
    both['type'] = 'object';
    const bothResult = emit(both, 'error-envelope');
    assertEqual(
      `${ISOLATION} a node that is both an intersection and a collision refuses exactly ONCE`,
      String(bothResult.refusals.length),
      '1',
    );

    // THE CAUSE, reached with no collision available to mask it — module `alpha-v1`, def `beta`.
    const causeOnly = emit(
      {
        $id: 'urn:dudo:schema:alpha:1',
        $ref: '#/$defs/beta',
        type: 'object',
        $defs: {
          beta: {
            type: 'object',
            additionalProperties: false,
            required: ['x'],
            properties: { x: { type: 'string' } },
          },
        },
      },
      'alpha-v1',
    );
    const causeText = causeOnly.refusals.map((entry) => entry.message).join(' ');
    assertTrue(
      `${ISOLATION} the CAUSE fires on a root \`$ref\` + sibling when no collision masks it`,
      causeText.includes('shape-bearing sibling'),
      `refusals=${JSON.stringify(causeOnly.refusals)}`,
    );

    // *** AND THE ORDERING: WHEN BOTH APPLY, IT IS THE CAUSE THAT SPEAKS. ***
    // Before the ordering fix this input reported the BACKSTOP — "the root shape would emit
    // `ErrorEnvelope`, which a `$defs` entry already exports" — so the one input that found the
    // whole defect was diagnosed by its symptom. It now names the intersection.
    assertTrue(
      `${ISOLATION} when a node is both, the refusal names the INTERSECTION and not the collision`,
      bothResult.refusals.every((entry) => entry.message.includes('shape-bearing sibling')),
      `the symptom is being reported over the cause again: ${JSON.stringify(bothResult.refusals)}`,
    );

    // *** DISTINGUISHABILITY, COMPARED AGAINST AN ACTUAL BACKSTOP REFUSAL. ***
    //
    // AN EARLIER VERSION OF THIS CASE COMPARED THE CAUSE AGAINST THE `both` INPUT — and went red
    // the moment the ordering fix landed, because `both` correctly reports the cause now. **That
    // was this file testing its own stale model of the generator rather than the property it
    // meant to assert**, which is the same defect it exists to catch one layer up.
    //
    // The two MECHANISMS are the `$ref` refusal and the duplicate-name backstop, so the backstop
    // must be reached the only way that isolates it: a collision with no `$ref` in sight.
    const backstopText = emit(
      {
        $id: 'urn:dudo:schema:probe:1',
        type: 'object',
        additionalProperties: false,
        required: ['a'],
        properties: { a: { type: 'string' } },
        $defs: { probeV1: { type: 'number' } },
      },
      'probe-v1',
    )
      .refusals.map((entry) => entry.message)
      .join(' ');
    assertTrue(
      `${ISOLATION} THE TWO MESSAGES ARE DISTINGUISHABLE — merging them would go red here`,
      causeText.includes('shape-bearing sibling') && backstopText.includes('already exports') &&
        causeText !== backstopText,
      'the cause and the backstop now read the same. That is not cosmetic: the finding that the ' +
        'backstop reached the root case first — before the ordering fix — was visible ONLY ' +
        `because they differed. cause=${JSON.stringify(causeText)} backstop=${JSON.stringify(backstopText)}`,
    );

    // AND THE CONTROL: the same root `$ref` with NO sibling is accepted, so the cases above are
    // about the sibling rather than about `$ref` roots in general.
    assertEqual(
      'CONTROL: a root `$ref` with no sibling at all is accepted',
      JSON.stringify(
        emit(
          {
            $id: 'urn:dudo:schema:alpha:1',
            $ref: '#/$defs/beta',
            $defs: { beta: { type: 'object', additionalProperties: false, properties: {} } },
          },
          'alpha-v1',
        ).refusals.map((entry) => entry.code),
      ),
      '[]',
    );
  });

  suite.test('*** `0039`: AN UNVERIFIABLE CLASS DECLARATION IS ANNOUNCED, NOT SILENTLY ACCEPTED ***', () => {
    // ===================================================================================
    // THIS CASE WAS WRITTEN EXPECTING TO BE RED, AND THE CONDITION FOR ITS REDNESS WAS MET
    // BEFORE IT FIRST RAN. THE HISTORY IS KEPT BECAUSE IT IS THE POINT.
    // ===================================================================================
    //
    // `0039` claimed three times that the generator **checks the declaration against the route
    // tables**. It does not — it imports no route table. What it checked was the declaration
    // against the BLOCK KEY, and `REQUEST_CLASSES` maps **both** `session` and `platform` to
    // `operations:`. So for exactly the two classes `0039` exists to separate, the check
    // **validated the declaration using the signal `0039` established is unreliable.**
    //
    // Proved by construction — one body, three declarations — and the middle line is the finding:
    //
    //     requestClass: session   ->  ACCEPTED
    //     requestClass: platform  ->  ACCEPTED     <- the same file, the other class
    //     requestClass: action    ->  REFUSED      GEN_REQUEST_CLASS_CONTRADICTS_BLOCK
    //
    // **`architecture-agent` then took the honest fallback rather than widening the check**, and
    // its reason is architectural: a tool inside `packages/contracts/**` that parses
    // `platform/core/**` would make the contract set depend on Core's file layout, and
    // `architecture.md` §3 points dependencies inward toward contracts. **The route-table
    // comparison is owed to `scripts/`**, beside `check-route-fields.mjs`, which already reads
    // both sides from outside them. That is the Team Lead's tree, not this suite's subject.
    //
    // *** SO WHAT IS ASSERTED HERE IS THE GUARANTEE THAT ACTUALLY EXISTS: the generator ANNOUNCES
    // *** what it cannot verify, every run, naming the classes that share the block key. ***
    //
    // *** THIS ASSERTS A WARNING STANDING IN FOR AN ABSENT CHECK. DO NOT "UPGRADE" IT TO ASSERT A
    // *** REJECTION. *** A rejection was deliberately not built: the generator refuses to read
    // `platform/core/**` because that would make the contract set depend on Core's file layout —
    // on `id: '…'` appearing as a literal in a particular shape — so **Core could no longer
    // refactor its own route tables without breaking a contracts-side tool.** The comparison is
    // owed to `scripts/`, beside `check-route-fields.mjs`, which already performs exactly this
    // class of comparison from outside both trees. **A cross-boundary comparison belongs at the
    // boundary, not inside one of the sides.**
    //
    // *** AND THE DEPENDENCY THIS NOTICE RESTS ON, GUARDED RATHER THAN NOTED. *** The warning
    // fires only because `session` and `platform` SHARE `operations:`. **If a future class split
    // removes that overlap, the notice goes silent — and nothing would mark that the route-table
    // check is still missing.** The assertion below requires the notice to fire, so that day this
    // case goes RED rather than quietly stopping testing. That is the failure this suite has met
    // three times; this is the rare one that could be guarded before it happened.
    //
    // **The check did not get broader. It stopped overstating** — which is
    // `AUTHORIZATION_STANDARD` §4.1's lesson applied to the generator, and it is why this case is
    // green rather than suppressed.
    //
    // *** WHAT NOTHING IN THIS SUITE COVERS, STATED SO IT IS NOT MISTAKEN FOR COVERED: *** no test
    // anywhere compares a declared class against the route table it claims. `0039`'s required
    // known-failing input — *"a fixture contract declaring the wrong class for a real route"* —
    // **cannot exist until that checker does**, because there is nothing for it to go red against.
    // A green run here means the announcement works, and says nothing about the declarations being
    // true.
    const declare = (requestClass: string): { accepted: boolean; codes: string[]; warnings: string[] } => {
      const output = mkdtempSync(join(tmpdir(), 'dudo-class-ambiguity-'));
      try {
        const source = fileURLToPath(
          new URL('../../fixtures/contract-generator/class-ambiguity/', import.meta.url),
        );
        const work = join(output, 'c');
        cpSync(source, work, { recursive: true });
        const contract = join(work, 'probe-v1.contract.yaml');
        writeFileSync(contract, `${readFileSync(contract, 'utf8')}\nrequestClass: ${requestClass}\n`, 'utf8');
        const report = run({ mode: 'check', root: `${output}/`, outputRoot: `${output}/out/` }) as {
          refusals?: Refusal[];
          warnings?: readonly { readonly message: string }[];
        };
        const codes = (report.refusals ?? []).map((entry) => entry.code);
        const warnings = (report.warnings ?? []).map((entry) => String(entry.message));
        return { accepted: codes.length === 0, codes, warnings };
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    };

    const session = declare('session');
    const platform = declare('platform');
    const action = declare('action');
    console.log(
      `        0039 class check: session=${session.accepted ? 'accepted' : session.codes.join(',')} · ` +
        `platform=${platform.accepted ? 'accepted' : platform.codes.join(',')} · ` +
        `action=${action.accepted ? 'accepted' : action.codes.join(',')}`,
    );

    // ---- THE HALF THAT WORKS, KEPT ADJACENT AND GREEN. `action` declares a different block key,
    // so the block-key test catches it. **The check does something; it does not do the thing the
    // record claims** — and asserting that here is what stops the red below reading as "the check
    // is broken" rather than "the check is narrower than its documentation."
    assertEqual(
      `${ISOLATION} a class whose block key DIFFERS is caught — the check is not doing nothing`,
      action.codes.join(','),
      'GEN_REQUEST_CLASS_CONTRADICTS_BLOCK',
    );

    // ---- THE AMBIGUITY IS REAL AND IS RECORDED AS DELIBERATE, NOT AS A DEFECT.
    // If a future change makes the generator distinguish these two, this goes red — and that is
    // correct: it would mean the generator started reading route tables, which `0039` resolved it
    // must NOT do. Whoever makes it red owes this case's header a re-read, not a deletion.
    assertTrue(
      `${ISOLATION} the two classes sharing a block key are BOTH accepted — the generator does not guess`,
      session.accepted && platform.accepted,
      'one of `session`/`platform` was refused on a body the other was accepted on. The generator ' +
        'reads no route table by design (0039, resolved), so it has no basis to prefer either — ' +
        'if it now does, it has grown a dependency on Core\'s file layout that architecture.md §3 ' +
        `forbids. session=${JSON.stringify(session.codes)} platform=${JSON.stringify(platform.codes)}`,
    );

    // ---- AND THE GUARANTEE THAT REPLACED THE OVERSTATED ONE: IT SAYS SO, EVERY RUN.
    // A silent acceptance and an announced one are the same exit code. This is the only thing
    // standing between "declared and unverified" and "declared and assumed verified".
    for (const [name, result] of [['session', session], ['platform', platform]] as const) {
      const announcement = result.warnings.find((message) => message.includes('NOT VERIFIED'));
      assertTrue(
        `${ISOLATION} declaring \`${name}\` is announced as NOT VERIFIED rather than silently accepted`,
        announcement !== undefined,
        'no warning named the declaration unverifiable. TWO CAUSES, AND THE SECOND IS THE ONE THIS ' +
          'ASSERTION EXISTS FOR: either the notice was removed, or `session` and `platform` NO ' +
          'LONGER SHARE the `operations:` block key — a class split would make the overlap vanish, ' +
          '**the notice go silent, and nothing mark that the route-table check is STILL MISSING.** ' +
          'Do not resolve this by deleting the case: the absent check is what it stands for, and ' +
          `it is owed to scripts/. warnings=${JSON.stringify(result.warnings)}`,
      );
      assertTrue(
        `and the announcement names the class it is confusable with, not just that it is unsure`,
        announcement !== undefined && announcement.includes(name === 'session' ? 'platform' : 'session'),
        'the warning does not name the other class sharing the block key, so a reader cannot tell ' +
          `what the declaration is ambiguous WITH: ${JSON.stringify(announcement)}`,
      );
    }
  });

  suite.test('*** `GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE` — THE PATH NOBODY HAD EVER OBSERVED ***', () => {
    // ===================================================================================
    // ITS AUTHOR'S OWN DISPOSITION, WHICH IS WHY THIS FIXTURE EXISTS:
    //   *"until it runs once, it is a code path I reasoned about and nobody has observed."*
    // ===================================================================================
    //
    // A URN that does not resolve means TWO different things and only one of them is the referring
    // contract's fault:
    //
    //   the `$id` is declared NOWHERE          -> GEN_UNRESOLVABLE_REF, authored `contract`
    //   the index could not READ every file    -> this code, authored `derived`
    //
    // The second is the one that had never executed. It was written because ONE missing comma in
    // `template-v1.schema.json` on 2026-09-10 produced SIX refusals — one `GEN_SCHEMA_UNREADABLE`
    // and five `GEN_UNRESOLVABLE_REF` from a contract resolving five URNs into it — so a report of
    // six CONTRACT deficiencies described ONE cause, and the derived-counting logic that exists to
    // separate causes from effects did not fire.
    //
    // ===================================================================================
    // THE FIXTURE, AND WHY THE FILENAME AND THE `$id` SHARE NO TOKEN
    // ===================================================================================
    //
    //   carrier.schema.json    unparseable (missing comma). DECLARES `urn:...:zephyr:1`, textually.
    //   hollow.schema.json     unparseable (trailing comma). Referenced by NOTHING.
    //   referrer-v1  -> zephyr           a URN that IS declared, by the file nothing can read
    //   phantom-v1   -> nowheredeclared  a URN declared by no file, in any state of this corpus
    //
    // **`carrier` vs `zephyr` is deliberate.** A refusal is entitled to name the URN it could not
    // resolve and must NOT name the file it could not read. If the two shared a word, no assertion
    // could tell those apart — the case would pass on a message that named the file.
    //
    // TWO MALFORMATIONS RATHER THAN TWO COPIES OF ONE: a missing comma and a trailing comma. Two
    // copies of one defect would only show the count tracking the number of FILES; two different
    // defects show it tracking the number of UNREADABLE ones, which is what the message claims.
    const both = overIndexIncomplete(() => {});
    const one = overIndexIncomplete((work) => unlinkSync(join(work, 'hollow.schema.json')));

    const codesOf = (result: { report: GeneratorReport }): string[] =>
      (result.report.refusals ?? []).map((entry) => entry.code);

    console.log(
      `        index-incomplete: 2 unread -> ${codesOf(both).join(',')} · ` +
        `1 unread -> ${codesOf(one).join(',')}`,
    );

    // ---- THE FLOOR, FIRST. Two contracts were found and both were refused. Without this, every
    // negative below is satisfied by a walk that discovered nothing at all.
    assertEqual(
      `${ISOLATION} THE FLOOR: the fixture corpus was found — 2 contracts, both refused`,
      `${both.report.population?.['contractFilesFound']}/${both.report.population?.['contractsRefused']}`,
      '2/2',
    );
    assertEqual(
      'and the independent derivation agrees the fixture holds two unreadable schemas',
      `${both.unreadable.count} ${both.unreadable.stems.slice().sort().join(',')}`,
      '2 carrier,hollow',
    );

    // ---- 1. AUTHORED `derived`, NOT `contract`. The defect it was written to fix.
    assertEqual(
      `${ISOLATION} every refusal is the INDEX-INCOMPLETE code, and none is the contract-fault one`,
      JSON.stringify([...new Set(codesOf(both))].sort()),
      JSON.stringify(['GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE']),
    );
    assertEqual(
      'and that code is authored `derived` — the run reports the CODE, so the map is asked directly',
      refusalAuthorFor('GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE'),
      'derived',
    );
    // THE CONTROL IS KEPT AFTER THE READER IT WAS WRITTEN FOR WAS RETIRED, AND DELIBERATELY.
    // It existed to stop a source-text regex reporting the same value for everything. That reader
    // is gone and this now guards something different and still real: **the two codes must not
    // collapse.** The whole point of the split is that one occurrence of "a URN did not resolve" is
    // a contract defect and the other is a derived effect — if both ever answer `derived`, the
    // report has stopped distinguishing causes from effects and every count downstream is wrong.
    assertEqual(
      'CONTROL: the code this one exists to displace is still authored `contract` — they must not collapse',
      refusalAuthorFor('GEN_UNRESOLVABLE_REF'),
      'contract',
    );

    // ---- 2. THE MESSAGE CARRIES THE COUNT, NOT A BOOLEAN.
    // *** ONE RUN CANNOT PROVE THIS. *** A boolean rendered as "1 schema file(s)" would satisfy any
    // single-state assertion. Two states with different populations is the only thing that
    // distinguishes a count from a flag, and the expectation is derived by `JSON.parse` rather than
    // read back out of the generator's own population report.
    for (const [label, result] of [['2 unread', both], ['1 unread', one]] as const) {
      const expected = `${result.unreadable.count} schema file(s) could not be read`;
      assertTrue(
        `${ISOLATION} with ${label}: every refusal says "${expected}"`,
        (result.report.refusals ?? []).every((entry) => entry.message.includes(expected)),
        'the message does not carry the independently-derived count. A BOOLEAN WOULD PASS A ' +
          'SINGLE-STATE VERSION OF THIS ASSERTION, which is why there are two states: ' +
          `${JSON.stringify((result.report.refusals ?? []).map((entry) => entry.message))}`,
      );
    }
    assertTrue(
      'and the two states really do render differently — otherwise the pair proves nothing',
      JSON.stringify((both.report.refusals ?? []).map((entry) => entry.message)) !==
        JSON.stringify((one.report.refusals ?? []).map((entry) => entry.message)),
      'both populations produced identical messages, so the count is not moving with the input',
    );

    // ---- 3. IT DOES NOT CLAIM THE URN IS DECLARED BY THE UNPARSEABLE FILE.
    // *** THIS IS THE ASSERTION MOST LIKELY TO BE "IMPROVED" AWAY. *** Naming the file reads as a
    // helpful message and is `architecture.md` §3c's worst variant: every fact true, the
    // attribution invented. The tool CANNOT know — an unreadable file has no readable `$id` and
    // there is nothing to match against. The subjects are derived from the fixture, so adding a
    // third broken file extends this without anyone remembering to.
    for (const entry of both.report.refusals ?? []) {
      for (const stem of both.unreadable.stems) {
        assertTrue(
          `${ISOLATION} the refusal for \`${entry.contract}\` does not name the unreadable \`${stem}\``,
          !entry.message.includes(stem),
          'THE MESSAGE ATTRIBUTES THE URN TO A FILE IT NEVER READ. An unparseable file has no ' +
            'readable `$id`, so there is nothing to match against and the attribution is invented ' +
            `— architecture.md §3c's worst variant. message=${JSON.stringify(entry.message)}`,
        );
      }
    }
    // THE MIRROR, AND WITHOUT IT THE LOOP ABOVE IS PASSED BY A MESSAGE THAT NAMES NOTHING AT ALL.
    // What the refusal IS entitled to state is the reference that failed. A message reduced to
    // "something did not resolve" would satisfy every negative above and be useless.
    assertTrue(
      'MIRROR: it does name the URN it failed to resolve — the negative above is not satisfied by silence',
      (both.report.refusals ?? []).every((entry) => entry.message.includes('urn:dudo:schema:')),
      `no refusal quotes its ref: ${JSON.stringify((both.report.refusals ?? []).map((e) => e.message))}`,
    );

    // ---- 4. THE REMEDY IT NAMES MUST EXIST. `workflow.md` §11a: a refusal naming a remedy the tool
    // does not provide is a dead end wearing an instruction's clothes. This one says *"fix the
    // unreadable schema(s) first — buildSchemaIndex names them"*, which is a claim about the report
    // the reader is holding, so it is checkable in the same run.
    const named = (both.report.warnings ?? []).map((entry) => entry.message).join('\n');
    for (const stem of both.unreadable.stems) {
      assertTrue(
        `${ISOLATION} the advice is actionable: a warning names the unreadable \`${stem}\``,
        named.includes(stem),
        'the refusal tells the reader that `buildSchemaIndex names them` and no warning names this ' +
          `file, so the sentence sends them nowhere: warnings=${JSON.stringify(named)}`,
      );
    }

    // ---- 5. THE COST, ASSERTED RATHER THAN LEFT AS PROSE.
    // `phantom-v1`'s URN is declared by no file in any state of this corpus. It is a real contract
    // defect and it is reported as `derived` while an UNRELATED file is unparseable. **That is
    // deliberate and it is the safe direction** — it defers a contract finding until the corpus is
    // readable rather than asserting one on an index that could not see half the answer. The case
    // below (`the finding RETURNS`) is what stops this reading as a suppressed defect.
    assertTrue(
      `${ISOLATION} THE STATED COST: a URN that genuinely names nothing is ALSO reported \`derived\``,
      (both.report.refusals ?? []).some(
        (entry) =>
          entry.contract === 'phantom-v1' && entry.code === 'GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE',
      ),
      'phantom-v1 names a URN nothing declares. If it is now reported as a CONTRACT defect while ' +
        'files are unreadable, the fallback has been narrowed to "the ref might be in the broken ' +
        'file" — an attribution the tool cannot make. See assertion 3. ' +
        `refusals=${JSON.stringify(both.report.refusals)}`,
    );
  });

  suite.test('*** THIS FIXTURE IS THE ONLY EXECUTOR OF THE `0039` PHASE-3 BRANCH, SO IT ASSERTS ON IT ***', () => {
    // ===================================================================================
    // FOUND BY MEASUREMENT AGAINST THIS FILE, NOT BY REVIEW:
    //     grep "fatal|migrationNotice|PHASE 3|IS DUE"  ->  no hits
    // The fixture EXECUTED the branch and the case LOOKED AT NOTHING IT PRODUCED.
    // ===================================================================================
    //
    // **Nothing else in this repository reaches that branch.** It sits inside
    // `declarationsComplete`, which needs EVERY publishing contract to declare `requestClass:` — the
    // real corpus has ten of sixteen still lacking it, so the block never runs there. This fixture
    // has two contracts and both declare, so it meets the condition; and `repoRoot` is derived from
    // the GENERATOR'S OWN LOCATION rather than from the `root` argument, so a fixture run reads the
    // REAL `package.json` and both wiring facts are true.
    //
    // *** THE BRANCH WAS UNREACHABLE FOR A ONE-CHARACTER REASON AND THE FIX IS EXECUTED HERE AND
    // *** NOWHERE ELSE. *** It decided "the check is wired into `npm test`" by searching that script
    // for the FILENAME `check-request-class` when the script can only contain the npm script NAME
    // `check:request-class`. Its true arm had never executed in any run by anyone.
    //
    // **So "the suite is green" was consistent with the flip having happened, with it not having
    // happened, and with nobody looking** — `workflow.md` §10's third state, NOT OBSERVED, which is
    // neither passing nor failing. This case is what converts it into one of the other two.
    //
    // ===================================================================================
    // THE FIELD, NEVER THE OUTPUT
    // ===================================================================================
    //
    // `formatReport` still prints this text — it moved from under `FATAL:` to under
    // `MIGRATION (exit 3 …)` in the same pass that changed the message. **A stdout grep passes
    // whether or not the field it came from still exists**, so a stdout assertion would have
    // survived the relocation without noticing, which is exactly how the relocation looked safe.
    const clean = overIndexIncomplete((work) => {
      unlinkSync(join(work, 'hollow.schema.json'));
      copyFileSync(join(work, 'carrier.schema.json.repaired'), join(work, 'carrier.schema.json'));
    });
    const notice = clean.report.migrationNotice;
    console.log(`        0039 phase-3 branch: migrationNotice ${notice === undefined ? 'ABSENT' : 'present'}`);

    assertTrue(
      `${ISOLATION} the fixture run populates \`migrationNotice\` — the branch executed at all`,
      notice !== undefined,
      'THE PHASE-3 BLOCK DID NOT RUN, and this fixture is the only thing that reaches it. Either ' +
        'both fixture contracts stopped declaring `requestClass:` — check them first — or the ' +
        'trigger moved. **A silent absence here means the branch is unexecuted everywhere again**, ' +
        `which is the state it spent its whole life in. population=${JSON.stringify(clean.report.population)}`,
    );

    // ---- THE FLIP ITSELF. Before the fix this said BLOCKED, naming a remedy already performed.
    assertTrue(
      `${ISOLATION} it reports phase 3 as DUE — not BLOCKED on a wiring condition that is satisfied`,
      notice !== undefined && notice.includes('IS DUE') && !notice.includes('BLOCKED'),
      'THE `checkWired` FIX HAS NOT TAKEN, AND EVERY GREEN RUN SO FAR TOLD US NOTHING. The branch ' +
        'still believes `scripts/check-request-class.mjs` is not referenced by the root `test` ' +
        'script. It is — `npm run check:request-class` invokes it. A refusal naming a remedy that ' +
        `has already been performed is workflow.md §11a's dead end. notice=${JSON.stringify(notice)}`,
    );
    assertTrue(
      'and it names the constant to flip, so the reader is not left deriving the remedy',
      notice !== undefined && notice.includes('REQUEST_CLASS_REQUIRED'),
      `a phase notice that does not name what to change is a stop with no exit: ${JSON.stringify(notice)}`,
    );

    // ---- WHICH FIELD CARRIES IT, AND IT DECIDES THE EXIT CODE.
    // `exitCodeFor` reads `fatal` FIRST and returns 2. A phase notice that arrived in `fatal`
    // instead would be reported as "the tool's own accounting is broken" rather than "a decision is
    // due" — the two states the split exists to separate, collapsed by the choice of field.
    assertEqual(
      `${ISOLATION} it arrives in \`migrationNotice\` and NOT in \`fatal\` — the field decides the exit code`,
      `migrationNotice=${notice === undefined ? 'absent' : 'present'} fatal=${clean.report.fatal === undefined ? 'absent' : 'present'}`,
      'migrationNotice=present fatal=absent',
    );

    // ---- AND THE CORRECTION THIS CASE OWES ITS BRIEF, STATED RATHER THAN QUIETLY DROPPED.
    //
    // *** THIS FIXTURE CANNOT DEMONSTRATE EXIT 3, AND ASSERTING IT HERE WOULD BE WRONG. ***
    // `exitCodeFor` is ordered so CORPUS PROBLEMS WIN: refusals return 1 before the migration notice
    // is ever reached. This run carries one refusal by construction — `phantom-v1`'s URN names
    // nothing — so it exits 1, and it SHOULD, because a migration question is not answerable over a
    // corpus that did not read clean. **The exit-3 assertion belongs on the real corpus, where
    // refusals and drift are zero, and it lives in `suites/contracts/generator-gate.ts`.**
    //
    // Asserted rather than written in a comment, because a precedence rule stated in prose is the
    // thing this repository keeps finding rotted: a notice must never mask a corpus problem.
    assertTrue(
      `${ISOLATION} PRECEDENCE: this run carries a refusal AND a notice, so it is a corpus problem first`,
      (clean.report.refusals ?? []).length > 0 && notice !== undefined,
      'both conditions must hold for this case to be saying anything about precedence at all: ' +
        `refusals=${(clean.report.refusals ?? []).length} notice=${notice === undefined ? 'absent' : 'present'}`,
    );
  });

  suite.test('*** AND THE DEFERRED FINDING RETURNS ON THE NEXT CLEAN RUN ***', () => {
    // ===================================================================================
    // WITHOUT THIS CASE, THE ONE ABOVE DESCRIBES A DEFECT RATHER THAN A DESIGN.
    // ===================================================================================
    //
    // Deferring a contract finding while the corpus is unreadable is only the safe direction if the
    // finding COMES BACK. If it did not, an unrelated parse error would permanently downgrade a
    // real contract defect to a derived effect, and the "safe direction" argument would be exactly
    // backwards. Nothing had ever observed it returning.
    //
    // The clean state is produced inside a TEMPORARY COPY: `hollow.schema.json` removed, and
    // `carrier.schema.json.repaired` copied over `carrier.schema.json`. The repaired form is a
    // committed, reviewable file rather than JSON built at run time, and it is not named
    // `*.schema.json` so neither `buildSchemaIndex` nor `discoverContracts` sees it — both filter on
    // that exact suffix.
    const clean = overIndexIncomplete((work) => {
      unlinkSync(join(work, 'hollow.schema.json'));
      copyFileSync(join(work, 'carrier.schema.json.repaired'), join(work, 'carrier.schema.json'));
    });
    const refusals = clean.report.refusals ?? [];
    console.log(
      `        index-incomplete clean run: wrote ${JSON.stringify(clean.written)} · ` +
        `refusals ${JSON.stringify(refusals.map((entry) => `${entry.contract}:${entry.code}`))}`,
    );

    // ---- THE FLOOR, AND IT DOUBLES AS THE CHECK ON THE REPAIRED FIXTURE.
    // `referrer-v1` resolves its URN into `carrier`, so it can only be delivered if the repaired
    // form still carries the same `$id` AND the same `$defs.thing`. **That coupling is self-checking
    // rather than trusted**: if the two forms ever drift, this goes red here rather than silently
    // turning the case below into "nothing was emitted, so nothing was refused".
    assertEqual(
      `${ISOLATION} THE FLOOR: the corpus is clean and both modules were delivered`,
      `${clean.unreadable.count} ${clean.written.slice().sort().join(',')}`,
      '0 carrier.ts,referrer/referrer-v1.ts',
    );

    // ---- THE RETURN. Same contract, same URN, same defect — a different and now-entitled claim.
    assertEqual(
      `${ISOLATION} the finding RETURNS as a CONTRACT defect once the index is complete`,
      JSON.stringify(refusals.map((entry) => `${entry.contract}:${entry.code}`)),
      JSON.stringify(['phantom-v1:GEN_UNRESOLVABLE_REF']),
    );
    assertEqual(
      'and that code is the one addressed to a contract author, not a derived effect',
      refusalAuthorFor('GEN_UNRESOLVABLE_REF'),
      'contract',
    );
    assertTrue(
      'and it now makes the claim it was NOT entitled to make while a file was unreadable',
      refusals.some((entry) => entry.message.includes('no file in the corpus declares')),
      'the clean-run refusal does not assert that nothing declares the `$id`. That assertion is ' +
        'exactly what the index-incomplete fallback withholds, so if it never appears the fallback ' +
        `withholds it forever: ${JSON.stringify(refusals.map((entry) => entry.message))}`,
    );
  });

  return suite;
}
