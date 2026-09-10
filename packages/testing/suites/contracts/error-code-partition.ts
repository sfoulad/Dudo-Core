/**
 * ===========================================================================================
 * THE ERROR-CODE PARTITION — a by-eye invariant on the schema EVERY error response uses.
 * ===========================================================================================
 *
 * `common/error-envelope.schema.json` discriminates its body on `code` through a `oneOf` over two
 * branches, each `$ref`-ing a different subset of the canonical `errorCode` enum. That shape is
 * what makes `retry_after_seconds` **unsendable** on a non-retryable code rather than merely
 * forbidden: the branch that accepts those codes has no such property and is
 * `additionalProperties: false`.
 *
 * **The shape works only if the two subsets PARTITION `errorCode` — and JSON Schema cannot express
 * a set difference, so nothing derives it.** The schema says so itself, in `errorCode`'s own
 * description:
 *
 *   > *"the partition is checked by eye against this list rather than derived, because JSON Schema
 *   > cannot express a set difference. THE TWO SUBSETS MUST UNION TO EXACTLY THIS SET — a code in
 *   > neither is unreachable through the envelope, and a code in both makes `oneOf` fail for every
 *   > response carrying it."*
 *
 * Writing the obligation down was right. **`architecture.md` §3a is that a guard which must be
 * remembered is a discipline and a guard whose output the build requires is a mechanism**, and a
 * discipline on the schema every error response in the system uses is the wrong place to keep one.
 * This file is the mechanism.
 *
 * ===========================================================================================
 * THE TWO DIRECTIONS FAIL DIFFERENTLY, AND ONLY ONE OF THEM IS LOUD
 * ===========================================================================================
 *
 *   A code in NEITHER subset   **SILENT.** `oneOf` matches no branch, so that error can never be
 *                              expressed through the envelope at all. Nothing reports it; the code
 *                              simply becomes unreachable.
 *   A code in BOTH subsets     **LOUD, EVENTUALLY.** Both branches match, `oneOf` requires exactly
 *                              one, so every response carrying that code fails validation — but
 *                              only once something validates, and **nothing in this repository
 *                              executes JSON Schema.** So today it is silent too.
 *
 * **Both are therefore invisible without this check**, which is why it asserts both rather than the
 * one that sounds worse.
 *
 * ===========================================================================================
 * *** THE SUBSET NAMES ARE DERIVED FROM THE BRANCHES, NOT HARDCODED. THAT IS DELIBERATE. ***
 * ===========================================================================================
 *
 * This check reads the root `oneOf`, follows each branch to its `properties.code.$ref`, and takes
 * the partition from **whatever those point at**. Two reasons, and the second is the one that
 * matters:
 *
 *  1. The definition names moved twice while this file was being written — `nonRetryableErrorBody`
 *     became `errorBodyWithoutRetryAfter` between two reads minutes apart. A check keyed on names
 *     would have been red for a rename that changed no meaning.
 *  2. **A partition can be perfect and unused.** Hardcoding the names would assert that two enums
 *     partition a third and prove nothing about whether the envelope's branches consume them. By
 *     following the wiring, a `code.$ref` repointed at the wrong subset is caught by the same pass.
 *
 * ===========================================================================================
 * THE KNOWN-FAILING INPUTS ARE CONSTRUCTED, NOT RECOVERED
 * ===========================================================================================
 *
 * No historical instance of a broken partition exists — the schema has had this shape since
 * 2026-09-09 and the enums have been consistent throughout. **So the mutants below are my model of
 * the defect rather than the defect**, the same weakness `yaml-structure.ts` records about its own
 * fixtures, and it is stated here rather than left for a reader to assume otherwise. What they do
 * establish is that this check can go red at all, in both directions, which a green run against a
 * correct schema cannot.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const ENVELOPE = fileURLToPath(
  new URL('../../../contracts/common/error-envelope.schema.json', import.meta.url),
);

type Schema = Record<string, unknown>;

export type PartitionReading = {
  /** Every problem found, as sentences. Empty means the partition holds. */
  readonly problems: readonly string[];
  readonly canonical: readonly string[];
  /** One entry per `oneOf` branch, in document order. */
  readonly subsets: ReadonlyArray<{ readonly defName: string; readonly codes: readonly string[] }>;
  readonly inNeither: readonly string[];
  readonly inBoth: readonly string[];
  /** The `$defs` names the root `$ref` chain passed through, in order. Empty means an inline root. */
  readonly rootHops: readonly string[];
  /** The node the root resolved to, or null when the chain broke. */
  readonly rootNode: Schema | null;
  /** Every discriminated shape found by walking the document, as JSON pointers. */
  readonly foundAt: readonly string[];
};

const asObject = (value: unknown): Schema | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Schema) : null;

/** `#/$defs/x` -> `x`. Anything else returns null, which the caller turns into a problem. */
function localDefName(ref: unknown): string | null {
  return typeof ref === 'string' && ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : null;
}

/**
 * ===========================================================================================
 * *** DERIVATION REMOVED STALENESS ON NAMES. IT DID NOT REMOVE IT ON PATHS. ***
 * ===========================================================================================
 *
 * This check survived FOUR renames of this schema's internals without being touched, because it
 * never held a definition name of its own. **It then failed on ONE structural move**, because it
 * held a PATH: it looked for `properties.error.oneOf` at the document root.
 *
 * `architecture-agent` moved the envelope into `$defs/errorEnvelope` and made the root a `$ref` to
 * it, **and the move was forced rather than cosmetic.** A URN reference resolves two ways in the
 * `0037` generator and only one satisfies its requirement 2: `urn:…#/$defs/<name>` produces an
 * **imported named type**, while `urn:…#/properties/error` is **rendered inline with no import**.
 * With the shape at the root there was no `$defs` name to reference, so every consumer would have
 * **re-declared the envelope** — the exact defect `0037` exists to remove.
 *
 * **So the shape is permanent, and the lesson is that I derived WHICH ENUMS THE BRANCHES REFERENCE
 * and transcribed WHERE THE BRANCHES LIVE.** The second was still a hardcoded fact about the
 * artifact. The repair is more derivation, not less.
 *
 * **AND THE HONEST QUALIFIER, so this is not read as "derive everything", which is not achievable
 * and would produce worse checks:** you cannot derive everything — **some anchor is always
 * transcribed. The only question is which anchor is most stable, and that is a judgement about the
 * artifact rather than about the check.** This file now transcribes two, deliberately: the document
 * (for the shape-search) and the root (for the consumption assertion). Both are more stable than a
 * path through the middle of a schema, and they are cross-checked against each other.
 *
 * **AND "THE ROOT IS A `$ref`" IS ITSELF A PATH ASSUMPTION**, so this resolves through however many
 * local hops it takes rather than exactly one, and a root that stops resolving is its own reported
 * failure rather than a silent zero. A cycle is refused rather than followed.
 *
 * **What this still assumes**, stated so the next person does not have to rediscover it: that the
 * discriminated shape sits under `properties.error` of whatever the root resolves to. If that moves
 * too, the remaining option is to stop asking where the shape is — search the whole document for a
 * `oneOf` whose branches each carry a `properties.code.$ref` and assert exactly one exists, anchored
 * on the document rather than on any path inside it. **That is a heuristic where this is not, which
 * is why it is the next step and not this one.**
 */
/**
 * ===========================================================================================
 * THE SHAPE-SEARCH. Anchored on the DOCUMENT, which is the one thing that cannot move.
 * ===========================================================================================
 *
 * Every node anywhere in the document carrying a `oneOf` whose branches each resolve to an object
 * with a `properties.code.$ref`. **It asks what the shape IS rather than where it lives**, so a
 * structural move — the thing that broke the first version of this file — cannot defeat it.
 *
 * *** IT IS A HEURISTIC WHERE THE ROOT TRAVERSAL IS NOT, AND `EXACTLY ONE` IS THE PRICE. ***
 *
 * Matching by shape can match something that merely looks the same. Asserting **exactly one**
 * converts that from a silent wrong subject into a loud ambiguity — the same trade
 * `yaml-structure.ts` makes with adjacency, and the same reason it prints its population.
 *
 * *** IF A SECOND DISCRIMINATED `code`-KEYED SHAPE IS EVER ADDED LEGITIMATELY, THIS GOES RED ON A
 * CORRECT CHANGE. THAT IS THE POINT AND IT IS NOT A BUG TO BE RELAXED AWAY. ***
 *
 * **Do not "fix" it by loosening the assertion to *at least one*.** The red is what forces someone
 * to say WHICH shape the partition rule governs, rather than letting this check silently pick the
 * first one it walked into and report on the wrong subject for ever after. The repair is to name
 * the governed shape, not to widen the match.
 */
function findDiscriminatedShapes(
  schema: Schema,
  defs: Schema,
): Array<{ pointer: string; node: Schema }> {
  const found: Array<{ pointer: string; node: Schema }> = [];
  const discriminates = (branch: unknown): boolean => {
    const name = localDefName(asObject(branch)?.['$ref']);
    if (name === null) {
      return false;
    }
    const target = asObject(defs[name]);
    return localDefName(asObject(asObject(target?.['properties'])?.['code'])?.['$ref']) !== null;
  };
  const visit = (node: unknown, pointer: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${pointer}/${String(index)}`));
      return;
    }
    const object = asObject(node);
    if (object === null) {
      return;
    }
    const branches = object['oneOf'];
    if (Array.isArray(branches) && branches.length > 0 && branches.every(discriminates)) {
      found.push({ pointer, node: object });
    }
    for (const [key, value] of Object.entries(object)) {
      visit(value, `${pointer}/${key}`);
    }
  };
  visit(schema, '#');
  return found;
}

function resolveRoot(schema: Schema, defs: Schema): { node: Schema | null; hops: string[]; problem: string | null } {
  let node: Schema | null = schema;
  const hops: string[] = [];
  const seen = new Set<string>();
  while (node !== null && typeof node['$ref'] === 'string') {
    const name = localDefName(node['$ref']);
    if (name === null) {
      return { node: null, hops, problem: `the root \`$ref\` \`${String(node['$ref'])}\` is not a local \`#/$defs/…\` reference, so this check cannot follow it.` };
    }
    if (seen.has(name)) {
      return { node: null, hops, problem: `the root \`$ref\` chain cycles at \`${name}\` (${hops.join(' -> ')}).` };
    }
    seen.add(name);
    hops.push(name);
    const next = asObject(defs[name]);
    if (next === null) {
      return { node: null, hops, problem: `the root resolves to \`#/$defs/${name}\`, which is not defined.` };
    }
    node = next;
  }
  return { node, hops, problem: null };
}

/**
 * Reads the envelope's partition by FOLLOWING THE WIRING: root `oneOf` -> each branch ->
 * `properties.code.$ref` -> the subset enum it names.
 *
 * Every structural surprise becomes a `problem` rather than a throw, so one malformed branch is
 * reported alongside everything else instead of hiding the rest.
 */
export function readPartition(schema: Schema): PartitionReading {
  const problems: string[] = [];
  const defs = asObject(schema['$defs']) ?? {};

  const enumOf = (defName: string): string[] | null => {
    const def = asObject(defs[defName]);
    const values = def?.['enum'];
    return Array.isArray(values) ? values.map((v) => String(v)) : null;
  };

  const canonical = enumOf('errorCode') ?? [];
  if (canonical.length === 0) {
    problems.push('`#/$defs/errorCode` has no enum, so there is no canonical set to partition.');
  }

  // ===========================================================================================
  // TWO ANCHORS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS AND FAIL DIFFERENTLY.
  // ===========================================================================================
  //
  //   FIND BY SHAPE   "does a well-formed partition exist in this document?"
  //                   Anchored on the document, which cannot move. Survives a structural move.
  //   REACH BY ROOT   "is this the shape a CONSUMER actually gets?"
  //                   Anchored on the root, which is what a consumer sees. Catches a shape that
  //                   a structural move has ORPHANED.
  //
  // **A shape-search alone would go green on a perfectly-formed partition sitting in `$defs` that
  // the root does not reach and no contract references** — and *correct and consumed by nothing*
  // is a live failure mode in this repository, not a hypothetical one. `CollectionEnvelope<T>` is
  // emitted today and referenced by nothing, and this very envelope spent an afternoon generating
  // cleanly while reached by no contract.
  //
  // **Today the two return the same object. The day they do not is the day this earns its keep**,
  // and the disagreement is REPORTED rather than resolved in code — a well-formed partition the
  // root cannot reach is exactly the finding, not an error to paper over.
  const found = findDiscriminatedShapes(schema, defs);
  if (found.length !== 1) {
    problems.push(
      found.length === 0
        ? 'no discriminated `oneOf` whose branches each carry a `properties.code.$ref` exists ' +
          'anywhere in this document, so there is no partition to check.'
        : `${String(found.length)} discriminated shapes were found, at ${found.map((f) => f.pointer).join(' and ')}. ` +
          'This check governs exactly one and will not guess which.',
    );
  }

  const root = resolveRoot(schema, defs);
  if (root.problem !== null) {
    problems.push(root.problem);
  }
  const reachedNode = asObject(asObject(root.node?.['properties'])?.['error']);

  // THE SHAPE THIS CHECK READS IS THE ONE THE ROOT REACHES when there is one, so a green result is
  // always about the consumer's shape rather than about whichever candidate the walk found first.
  const subject = reachedNode ?? (found.length === 1 ? found[0]!.node : null);
  const branches = subject?.['oneOf'];
  const subsets: Array<{ defName: string; codes: string[] }> = [];

  if (found.length === 1 && reachedNode !== null && found[0]!.node !== reachedNode) {
    problems.push(
      `the discriminated shape at ${found[0]!.pointer} is NOT the one the root reaches ` +
        `(root resolved through ${root.hops.join(' -> ') || 'no hops'}). A well-formed partition ` +
        'that a consumer never sees is orphaned, not correct.',
    );
  }
  if (found.length === 1 && reachedNode === null) {
    problems.push(
      `a discriminated shape exists at ${found[0]!.pointer} but the root does not reach a ` +
        '`properties.error` at all — the partition may be correct and consumed by nothing. The ' +
        `root resolved through ${root.hops.length === 0 ? 'no hops' : root.hops.join(' -> ')}.`,
    );
  }

  if (!Array.isArray(branches)) {
    problems.push(
      "the envelope's `properties.error` has no `oneOf`, so the discriminated shape this check " +
        'exists for is not present — the partition may be correct and consumed by nothing. The ' +
        `root resolved through ${root.hops.length === 0 ? 'no hops' : root.hops.join(' -> ')}.`,
    );
  } else {
    for (const [index, entry] of branches.entries()) {
      const branchRef = localDefName(asObject(entry)?.['$ref']);
      if (branchRef === null) {
        problems.push(`oneOf branch ${String(index)} is not a local \`#/$defs/…\` reference.`);
        continue;
      }
      const branch = asObject(defs[branchRef]);
      if (branch === null) {
        problems.push(`oneOf branch ${String(index)} names \`${branchRef}\`, which is not defined.`);
        continue;
      }
      const subsetName = localDefName(asObject(asObject(branch['properties'])?.['code'])?.['$ref']);
      if (subsetName === null) {
        problems.push(`\`${branchRef}\`'s \`code\` is not a local \`$ref\` to a subset enum.`);
        continue;
      }
      const codes = enumOf(subsetName);
      if (codes === null) {
        problems.push(`\`${branchRef}\` discriminates on \`${subsetName}\`, which has no enum.`);
        continue;
      }
      subsets.push({ defName: subsetName, codes });
    }
  }

  const union = new Set<string>();
  const seenTwice = new Set<string>();
  for (const subset of subsets) {
    for (const code of subset.codes) {
      if (union.has(code)) seenTwice.add(code);
      union.add(code);
    }
  }

  const inNeither = canonical.filter((code) => !union.has(code));
  const extra = [...union].filter((code) => !canonical.includes(code));
  const inBoth = [...seenTwice];

  if (inNeither.length > 0) {
    problems.push(
      `UNREACHABLE — in the canonical list and in no branch: ${inNeither.join(', ')}. No response ` +
        'carrying one of these can satisfy the envelope, and nothing reports it.',
    );
  }
  if (inBoth.length > 0) {
    problems.push(
      `AMBIGUOUS — in more than one branch: ${inBoth.join(', ')}. Both branches match, so \`oneOf\` ` +
        'fails for every response carrying one of these.',
    );
  }
  if (extra.length > 0) {
    problems.push(
      `NOT CANONICAL — named by a branch and absent from \`errorCode\`: ${extra.join(', ')}.`,
    );
  }

  // COUNTS, COMPARED SEPARATELY FROM THE SET LOGIC. A duplicate WITHIN one subset leaves the union
  // and the intersection both correct while the arithmetic disagrees, so this catches an input the
  // two checks above pass.
  const declared = subsets.reduce((sum, subset) => sum + subset.codes.length, 0);
  if (problems.length === 0 && declared !== canonical.length) {
    problems.push(
      `the branches declare ${String(declared)} codes between them for ${String(canonical.length)} ` +
        'canonical codes, with no code missing, extra or shared — which means one subset lists the ' +
        'same code twice.',
    );
  }

  return {
    problems,
    canonical,
    subsets,
    inNeither,
    inBoth,
    rootHops: root.hops,
    rootNode: root.node,
    foundAt: found.map((entry) => entry.pointer),
  };
}

export function buildErrorCodePartitionSuite(): Suite {
  const suite = new Suite('Contracts — the error-code partition, checked rather than eyeballed');

  suite.test('*** THE TWO BRANCH SUBSETS PARTITION `errorCode` EXACTLY ***', () => {
    const schema = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Schema;
    const reading = readPartition(schema);

    // THE POPULATION, BEFORE THE VERDICT. "No discrepancy" over an empty set and "no discrepancy"
    // over twelve codes print identically without this, and two empty subsets partition an empty
    // set perfectly (§11a).
    console.log(
      `        partition: ${String(reading.canonical.length)} canonical codes · ` +
        reading.subsets.map((s) => `${s.defName} ${String(s.codes.length)}`).join(' + '),
    );

    // ---- THE FLOOR. Each clause names a different way of examining nothing.
    assertTrue(
      `${ISOLATION} the canonical list was read and is populated`,
      reading.canonical.length >= 8,
      `only ${String(reading.canonical.length)} codes in \`errorCode\`; there were 12 on ` +
        '2026-09-09. A collapse here makes every assertion below vacuous while looking clean',
    );
    assertEqual(
      `${ISOLATION} the envelope discriminates over exactly two branches`,
      String(reading.subsets.length),
      '2',
    );
    assertTrue(
      'and neither subset is empty — two empty subsets partition an empty set perfectly',
      reading.subsets.every((subset) => subset.codes.length > 0),
      `subset sizes: ${reading.subsets.map((s) => `${s.defName}=${String(s.codes.length)}`).join(', ')}`,
    );

    // ---- THE VERDICT. Problems are reported as sentences naming the codes, not as a count.
    assertEqual(
      `${ISOLATION} every canonical code is in exactly one branch`,
      reading.problems.join(' · '),
      '',
    );
  });

  suite.test('THE ROOT RESOLVES — the assumption that replaced the one that broke', () => {
    // ===================================================================================
    // *** THIS CASE EXISTS BECAUSE THE PREVIOUS VERSION OF THIS FILE DID NOT HAVE IT. ***
    // ===================================================================================
    //
    // The check held `properties.error.oneOf` at the DOCUMENT ROOT. When the envelope moved into
    // `$defs/errorEnvelope` behind a root `$ref`, it went red across every code at once — correct,
    // and diagnosable only because the floor made it say which shape it could not find. **A check
    // that had assumed the path and found nothing would have reported a perfect partition over
    // zero codes.**
    //
    // Following the `$ref` fixes that and introduces a NEW path assumption — that the root IS a
    // resolvable `$ref`. This case is that assumption, asserted rather than assumed, so the next
    // structural move lands on one line naming the chain instead of on twelve codes.
    const schema = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Schema;
    const reading = readPartition(schema);
    console.log(
      `        root: ${reading.rootHops.length === 0 ? 'inline (no $ref)' : `$ref -> ${reading.rootHops.join(' -> ')}`}` +
        ` · discriminated shapes found: ${String(reading.foundAt.length)} at ${reading.foundAt.join(', ') || '(none)'}`,
    );

    // ---- THE SECOND ANCHOR. Exactly one shape, and it is the one the root reaches.
    assertEqual(
      `${ISOLATION} the document contains exactly one discriminated shape`,
      String(reading.foundAt.length),
      '1',
    );
    assertTrue(
      `${ISOLATION} the root resolved to an object carrying the envelope`,
      reading.rootNode !== null && asObject(reading.rootNode['properties']) !== null,
      `the root did not resolve to a shape: hops=${JSON.stringify(reading.rootHops)}, ` +
        `problems=${JSON.stringify(reading.problems)}`,
    );

    // ---- CONSTRUCTED: the three ways a root chain breaks. Each must be REPORTED, not survived.
    const withRoot = (ref: unknown, extraDefs: Schema = {}): PartitionReading => {
      const copy = JSON.parse(JSON.stringify(schema)) as Schema;
      copy['$ref'] = ref;
      Object.assign(copy['$defs'] as Schema, extraDefs);
      return readPartition(copy);
    };
    assertTrue(
      `${ISOLATION} a root $ref naming a definition that does not exist is reported`,
      withRoot('#/$defs/notDefinedAnywhere').problems.some((p) => p.includes('not defined')),
      'a dangling root reference was not reported',
    );
    assertTrue(
      `${ISOLATION} a root $ref this check cannot follow is reported rather than ignored`,
      withRoot('https://example.invalid/other.json#/$defs/x').problems.some((p) =>
        p.includes('not a local'),
      ),
      'a non-local root reference was not reported',
    );
    assertTrue(
      `${ISOLATION} a CYCLE in the root chain is refused rather than followed`,
      withRoot('#/$defs/loopA', {
        loopA: { $ref: '#/$defs/loopB' },
        loopB: { $ref: '#/$defs/loopA' },
      }).problems.some((p) => p.includes('cycles')),
      'a cyclic root chain did not terminate with a reported cycle',
    );
  });

  suite.test('THE TWO ANCHORS DISAGREEING IS A FINDING — constructed, both ways', () => {
    // ===================================================================================
    // *** THE CASE THAT JUSTIFIES HAVING TWO ANCHORS AT ALL. ***
    // ===================================================================================
    //
    // Today the shape-search and the root traversal return the same object, so neither would be
    // missed if the other were deleted. **These mutants are the inputs on which they diverge**,
    // and they are the whole argument for keeping both: a shape-search alone goes green on an
    // orphaned partition, and a root traversal alone cannot tell you a second one exists.
    const schema = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Schema;

    // ---- ORPHANED: the shape still exists and is still well-formed; the root no longer reaches
    // it. A pure shape-search reports a perfect partition. This must not.
    const orphan = JSON.parse(JSON.stringify(schema)) as Schema;
    (orphan['$defs'] as Schema)['unreachableWrapper'] = { type: 'object', properties: {} };
    orphan['$ref'] = '#/$defs/unreachableWrapper';
    const orphaned = readPartition(orphan);
    assertTrue(
      `${ISOLATION} a well-formed partition the root cannot reach is reported as ORPHANED`,
      orphaned.foundAt.length === 1 && orphaned.problems.some((p) => p.includes('consumed by nothing')),
      `found=${JSON.stringify(orphaned.foundAt)} problems=${JSON.stringify(orphaned.problems)}`,
    );

    // ---- AMBIGUOUS: a second discriminated shape. The root still reaches the right one, so the
    // root traversal alone is happy. The shape-search is what refuses to guess.
    const twinned = JSON.parse(JSON.stringify(schema)) as Schema;
    (twinned['$defs'] as Schema)['aSecondEnvelope'] = JSON.parse(
      JSON.stringify((twinned['$defs'] as Schema)['errorEnvelope']),
    ) as Schema;
    const ambiguous = readPartition(twinned);
    assertTrue(
      `${ISOLATION} a SECOND discriminated shape is reported rather than silently chosen between`,
      ambiguous.foundAt.length === 2 && ambiguous.problems.some((p) => p.includes('will not guess')),
      `found=${JSON.stringify(ambiguous.foundAt)} problems=${JSON.stringify(ambiguous.problems)}`,
    );
  });

  suite.test('THE CONSTRUCTED FAILING INPUTS: both directions, and one the set logic alone misses', () => {
    // ===================================================================================
    // *** INVENTED, BECAUSE THE SCHEMA HAS NEVER BEEN WRONG. Stated rather than implied. ***
    // ===================================================================================
    //
    // A check that has only ever passed cannot distinguish sound-by-design from sound-by-accident.
    // These are the inputs it must go red on, and each is a different failure of the same rule.
    const original = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Schema;
    const live = readPartition(original);
    assertTrue(
      'the real schema is clean, so a red below is the mutation and not the corpus',
      live.problems.length === 0,
      `the live schema already reports: ${live.problems.join(' · ')}`,
    );

    const firstSubset = live.subsets[0]!.defName;
    const secondSubset = live.subsets[1]!.defName;
    const mutate = (change: (defs: Record<string, { enum: string[] }>) => void): PartitionReading => {
      const copy = JSON.parse(JSON.stringify(original)) as Schema;
      change((copy['$defs'] as Record<string, { enum: string[] }>));
      return readPartition(copy);
    };

    // ---- DIRECTION 1: a code in NEITHER subset. The silent one.
    const removed = live.subsets[1]!.codes[0]!;
    const orphaned = mutate((defs) => {
      defs[secondSubset]!.enum = defs[secondSubset]!.enum.filter((code) => code !== removed);
    });
    assertTrue(
      `${ISOLATION} a code removed from both branches is reported as UNREACHABLE`,
      orphaned.inNeither.includes(removed) && orphaned.problems.length > 0,
      `removing '${removed}' produced: ${JSON.stringify(orphaned.problems)}`,
    );

    // ---- DIRECTION 2: a code in BOTH subsets. The one that breaks `oneOf`.
    const shared = live.subsets[1]!.codes[0]!;
    const overlapping = mutate((defs) => {
      defs[firstSubset]!.enum = [...defs[firstSubset]!.enum, shared];
    });
    assertTrue(
      `${ISOLATION} a code added to both branches is reported as AMBIGUOUS`,
      overlapping.inBoth.includes(shared) && overlapping.problems.length > 0,
      `adding '${shared}' to both produced: ${JSON.stringify(overlapping.problems)}`,
    );

    // ---- DIRECTION 3: a DUPLICATE INSIDE one subset. THE INPUT THE SET LOGIC ALONE PASSES.
    // Union unchanged, intersection empty, every canonical code in exactly one branch — and the
    // schema is still wrong. Only the count comparison sees it, which is why that comparison is
    // computed from a different quantity rather than restated from the sets.
    const duplicated = mutate((defs) => {
      defs[firstSubset]!.enum = [...defs[firstSubset]!.enum, defs[firstSubset]!.enum[0]!];
    });
    assertTrue(
      `${ISOLATION} a code listed twice within ONE branch is still reported`,
      duplicated.problems.length > 0,
      'a duplicate inside a single subset left the union and the intersection both correct and ' +
        'was not reported — the arithmetic check is not doing its job',
    );

    // ---- AND THE MIRROR, so the mutants above are not simply a checker that flags everything.
    const untouched = mutate(() => {});
    assertEqual(
      'an unmutated copy is still clean — the checker is not reporting on everything it is handed',
      untouched.problems.join(' · '),
      '',
    );
  });

  suite.test('THE PARTITION IS CONSUMED, not merely correct beside the branches', () => {
    // A partition can be perfect and wired to nothing. This asserts the property that makes it
    // load-bearing: the two branches discriminate on DIFFERENT subsets, and the branch carrying
    // `retry_after_seconds` is the one whose subset is the retryable side.
    const schema = JSON.parse(readFileSync(ENVELOPE, 'utf8')) as Schema;
    const reading = readPartition(schema);
    assertEqual(
      `${ISOLATION} the two branches discriminate on different subsets`,
      String(new Set(reading.subsets.map((subset) => subset.defName)).size),
      '2',
    );

    const defs = asObject(schema['$defs']) ?? {};
    // THROUGH THE RESOLVED ROOT, not the document root — the same move `readPartition` makes, and
    // the one this case originally got wrong.
    const branches = (asObject(asObject(reading.rootNode?.['properties'])?.['error'])?.['oneOf'] ?? []) as unknown[];
    const carrying: string[] = [];
    for (const entry of branches) {
      const name = localDefName(asObject(entry)?.['$ref']);
      const branch = name === null ? null : asObject(defs[name]);
      const properties = asObject(branch?.['properties']) ?? {};
      if ('retry_after_seconds' in properties) carrying.push(name ?? '(unnamed)');
    }
    assertEqual(
      `${ISOLATION} exactly one branch carries \`retry_after_seconds\``,
      String(carrying.length),
      '1',
    );
    // AND THE OTHER BRANCH FORBIDS IT STRUCTURALLY RATHER THAN BY OMISSION ALONE. Without
    // `additionalProperties: false` the field would simply be undeclared and still sendable, which
    // is the difference between "unsendable" and "not mentioned".
    for (const entry of branches) {
      const name = localDefName(asObject(entry)?.['$ref']);
      const branch = name === null ? null : asObject(defs[name]);
      assertEqual(
        `\`${name ?? '(unnamed)'}\` is closed, so an undeclared field is refused rather than ignored`,
        JSON.stringify(branch?.['additionalProperties']),
        'false',
      );
    }
  });

  return suite;
}
