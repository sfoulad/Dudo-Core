/**
 * ===========================================================================================
 * THE PURE HALF OF `scripts/check-request-class.mjs` — `0039`'s comparison, with no I/O.
 * ===========================================================================================
 *
 * **Extracted 2026-09-09 at `qa-agent`'s request, and the reason is worth stating because the
 * obvious alternative was worse.** It asked to drive the checker's comparison from a committed
 * suite case, and explicitly did **not** want a root flag or a fixture path:
 *
 * > *"A test-only input path is a second code path the real run never exercises."*
 *
 * **A `--fixtures <dir>` option would have been exactly that.** So would an `import.meta.main`
 * guard, which is smaller but still a branch that behaves differently under test. **This module
 * has neither: the checker imports it and so does the suite, and there is one implementation with
 * one path through it.** `emitModule` in the contract generator is the precedent.
 *
 * **AND IT PRESERVES SOMETHING THAT WAS ABOUT TO EVAPORATE.** Six mutants verified this check —
 * a class contradicting the registry two ways, a per-operation declaration overriding the
 * contract level, a stray id in Core, a stray id in an App, an unknown class name — **and they
 * live in a session scratchpad.** `workflow.md` §11a records that a previous session's scratchpad
 * took a reproduction fixture with it and that **a preserved artifact goes in the repository or it
 * is not preserved.** The contradiction is covered today and would have been uncovered by the end
 * of the session.
 *
 * **`parseContract` is exported deliberately, and it is the more valuable half.** The checker's
 * three known-failing inputs all drove the comparison functions below — and **a one-character bug
 * in this parser** (it stored a regex match object rather than its capture group) produced a run
 * that exited 0 announcing *"10 declared route ids agree"* and *"0 still undeclared"*, with every
 * self-test passing. **The defect was in what the check could SEE, and a malformed id compares
 * clean against everything.** A suite case over this function is the one that would have caught it.
 */

/**
 * THE FOUR REQUEST CLASSES. `docs/decisions/0039`.
 *
 * `evaluatesPermission` is carried because it is WHY the declaration matters: two of the four
 * classes consult no permission at all, so a wrong declaration is a false statement about who may
 * call the route rather than a labelling slip.
 *
 * **These are NOT derived from what contracts happen to declare, and that is deliberate.**
 * `workflow.md` §11a: *derive a name that DESCRIBES the artifact, never one that CONSTRAINS it.*
 * The four classes come from decision records — `0014` §B, `0021`, `0025` D3, and the Action
 * pipeline — and a vocabulary derived from its own subject can never refuse anything the subject
 * does.
 */
export const CLASSES = Object.freeze({
  'pre-auth': Object.freeze({ blockKey: 'entryPoints', record: '0014 §B', evaluatesPermission: false }),
  session: Object.freeze({ blockKey: 'operations', record: '0021', evaluatesPermission: false }),
  platform: Object.freeze({ blockKey: 'operations', record: '0025 decision 3', evaluatesPermission: true }),
  action: Object.freeze({ blockKey: 'actions', record: 'ARCHITECTURE.md §3', evaluatesPermission: true }),
});

/** The three top-level YAML keys that hold published route ids. `0039`: three keys, four classes. */
export const PUBLISHING_BLOCKS = Object.freeze(['operations', 'entryPoints', 'actions']);

/** The grammar every route id in this repository obeys. Used as a floor on the parser's output. */
export const ROUTE_ID = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/u;

/**
 * A LOOSE id line, used ONLY to count what the strict pattern should have matched.
 *
 * *** THIS EXISTS BECAUSE THE STRICT PATTERN SILENTLY SKIPPED A REAL OPERATION. *** `ROUTE_ID`
 * originally excluded hyphens, and `platform.organizations.set-template` therefore matched nothing,
 * was never extracted, and was **absent from every count this file produces** — including the
 * "published operations classified N of M" line, whose M shrank to hide it. **Four of five new
 * operations were reported and the fifth was invisible.**
 *
 * **A floor over EXTRACTED ids cannot catch this**, and that is the whole point: `compare` already
 * shape-checks what the extractor returned, and an id the extractor never returned is not in that
 * set. `workflow.md` §11a — *the axis an author cannot see is what the check is permitted to skip* —
 * arriving in the checker written to police exactly that.
 *
 * **So the population is derived twice from the same file, by a strict reader and a permissive
 * counter, and a disagreement is a READER defect rather than a contract one.** Widening `ROUTE_ID`
 * fixes hyphens; this catches the next character nobody predicted.
 */
const ID_LINE_LOOSE = /^\s{0,4}-\s+id:\s*(\S+)\s*$/u;

/**
 * `id: 'a.b'` and `actionId: 'a.b'` as they appear in source. Dotted, because every route id here
 * is dotted and an undotted `id:` is a column, a target reference or a fixture.
 *
 * **`actionId:` is included for the deferred-route form**, and it is not hypothetical: two customer
 * routes are registered that way. A pattern that knew only `id:` found 32 of 34.
 */
export const ID_LITERAL = /\b(?:action)?[iI]d:\s*'([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)'/gu;

/**
 * Read one contract's declared class and published operations from its YAML source.
 *
 * **A line-oriented reader, and its narrowness is stated rather than hidden. There is no YAML
 * parser in this repository** — no npm package is approved.
 *
 * **IT TRACKS THE TOP-LEVEL BLOCK, WHICH `check-route-fields.mjs` DOES NOT NEED TO AND THIS DOES.**
 * `openQuestions:` holds `- id: TA-1` at the same indent that `operations:` holds
 * `- id: core.ListAuditEvents`. That checker drops the strays later because they carry no
 * `schemaRef`; this one would attribute a request class to `TA-1`. **The block is the scope, not
 * the indent.**
 *
 * **It reads the PER-OPERATION declaration as well as the contract-level one, and there are zero of
 * the former in the corpus today.** `0039` allows the field per operation *"where a contract spans
 * classes"*, and `confirmation-v1` is that contract: a platform-class challenge route and an
 * Action-class one under a single `requestClass: platform`, with a comment saying the Action route
 * will carry its own value when it lands. **Reading only the contract level would work today and be
 * wrong on the day that comment is acted on** — the per-operation value would land, this parser
 * would keep applying the file-level one, and the checker would report agreement it had not tested.
 *
 * @param {string} source the contract YAML
 * @returns {{contractClass: string|undefined, blockKey: string|undefined,
 *            operations: Array<{id: string, ownClass: string|undefined}>}}
 */
export function parseContract(source) {
  let contractClass;
  let blockKey;
  let inPublishingBlock = false;
  let current = null;
  const operations = [];
  /** Every `- id:` line inside a publishing block, however it is spelled. See `ID_LINE_LOOSE`. */
  const idLinesSeen = [];

  for (const line of source.split('\n')) {
    const topLevel = /^([A-Za-z][A-Za-z0-9_]*):/u.exec(line);
    if (topLevel !== null) {
      const key = topLevel[1];
      if (key === 'requestClass') {
        const value = /^requestClass:\s*([A-Za-z-]+)/u.exec(line);
        if (value !== null) contractClass = value[1];
      }
      inPublishingBlock = PUBLISHING_BLOCKS.includes(key);
      if (inPublishingBlock) blockKey = key;
      current = null;
      continue;
    }
    if (!inPublishingBlock) continue;

    const loose = ID_LINE_LOOSE.exec(line);
    if (loose !== null) idLinesSeen.push(loose[1]);

    const id = /^\s{0,4}-\s+id:\s*([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)\s*$/u.exec(line);
    if (id !== null) {
      current = { id: id[1], ownClass: undefined };
      operations.push(current);
      continue;
    }
    if (current === null) continue;

    const own = /^\s+requestClass:\s*([A-Za-z-]+)\s*$/u.exec(line);
    if (own !== null) current.ownClass = own[1];
  }

  return { contractClass, blockKey, operations, idLinesSeen };
}

/** Extract every route-id literal from one source file. Derivation B, per file. */
export function idLiteralsIn(source) {
  const found = new Set();
  for (const match of source.matchAll(ID_LITERAL)) found.add(match[1]);
  return found;
}

/**
 * A contradiction, or null. `actual` is what Core registers; `declared` is what the contract says.
 *
 * **Returns null when either side is unknown rather than guessing.** A declared class on a route
 * Core does not register is *unchecked*, which is a different state from *agreeing* and is reported
 * separately.
 */
export function contradiction(id, declared, actual) {
  if (actual === undefined || declared === undefined) return null;
  if (actual === declared) return null;
  return { id, declared, actual };
}

/** Set difference, both directions — the population check between derivations A and B. */
export function disagreement(executed, textual) {
  return {
    textualOnly: [...textual].filter((id) => !executed.has(id)).sort(),
    executedOnly: [...executed].filter((id) => !textual.has(id)).sort(),
  };
}

/**
 * The whole comparison, over parsed contracts and an executed registry.
 *
 * @param {Array<{file: string, contractClass?: string, operations: Array<{id: string, ownClass?: string}>}>} contracts
 * @param {Map<string, {className: string, source: string}>} executedClassOf
 */
export function compare(contracts, executedClassOf) {
  const contradictions = [];
  const unregistered = [];
  const unknownClasses = [];
  const malformed = [];
  /** `- id:` lines the strict reader did not match — a defect in THIS tool, not in the contract. */
  const skipped = [];
  const spans = [];
  const declaredIds = new Set();

  for (const contract of contracts) {
    for (const operation of contract.operations) {
      if (!ROUTE_ID.test(operation.id)) malformed.push({ file: contract.file, id: operation.id });
    }

    // THE READER'S OWN POPULATION CHECK. A `- id:` line the strict pattern did not match is an
    // operation this tool cannot see, and it shrinks every count silently rather than appearing
    // anywhere. Reported as `skipped`, which is a READER defect, not a contract one.
    const seen = contract.idLinesSeen ?? [];
    if (seen.length !== contract.operations.length) {
      const extracted = new Set(contract.operations.map((o) => o.id));
      for (const raw of seen) {
        if (!extracted.has(raw)) skipped.push({ file: contract.file, id: raw });
      }
    }

    for (const className of [contract.contractClass, ...contract.operations.map((o) => o.ownClass)]) {
      if (className === undefined || CLASSES[className] !== undefined) continue;
      unknownClasses.push({ file: contract.file, className });
    }

    const inherited = contract.operations.filter((o) => o.ownClass === undefined);
    if (contract.contractClass !== undefined && inherited.length > 1) {
      spans.push({
        file: contract.file,
        className: contract.contractClass,
        ids: inherited.map((o) => o.id),
      });
    }

    for (const operation of contract.operations) {
      // The operation's own declaration wins. A contract-level value is the DEFAULT, not the ruling.
      const declared = operation.ownClass ?? contract.contractClass;
      if (declared === undefined) continue;
      declaredIds.add(operation.id);

      const registered = executedClassOf.get(operation.id);
      if (registered === undefined) {
        /**
         * **THE INTERSECTION HOLE, SEPARATED FROM ORDINARY UNREGISTERED WORK.**
         *
         * The generator has a block-key heuristic: a `requestClass` whose class expects a
         * different top-level key than the contract uses is a contradiction. It **skips** that
         * check for an operation carrying its own declaration, and correctly — **a contract that
         * spans classes cannot have one block key matching all of them**, which is the case
         * `0039` allows the per-operation form for.
         *
         * `architecture-agent` named that skip as a hole and handed it to this check.
         * **This check cannot collect it.** A declared class is compared against the registry Core
         * puts the route in, and an unregistered route is in no registry — so the one operation
         * the skip was introduced for is verified by **neither** tool.
         *
         * > The generator skips it because the contract spans. This check cannot reach it because
         * > the route does not exist. **The intersection is empty in the worst possible place.**
         *
         * So it is printed on its own line rather than absorbed into *contracts may lead
         * implementation*, which is a benign category and would swallow it. `workflow.md` §12:
         * **a category is not a list** — it absorbs the one entry that does not belong to it,
         * silently.
         */
        const declaredBlockKey = CLASSES[declared]?.blockKey;
        unregistered.push({
          id: operation.id,
          declared,
          from: operation.ownClass === undefined ? 'contract level' : 'its own line',
          file: contract.file,
          blockKey: contract.blockKey,
          blockKeyContradicts:
            declaredBlockKey !== undefined &&
            contract.blockKey !== undefined &&
            declaredBlockKey !== contract.blockKey,
        });
        continue;
      }
      const clash = contradiction(operation.id, declared, registered.className);
      if (clash !== null) {
        contradictions.push({ ...clash, file: contract.file, source: registered.source });
      }
    }
  }

  const publishedIds = new Set(contracts.flatMap((c) => c.operations.map((o) => o.id)));
  const undeclared = [...executedClassOf.keys()]
    .filter((id) => publishedIds.has(id) && !declaredIds.has(id))
    .sort();
  const uncontracted = [...executedClassOf.keys()].filter((id) => !publishedIds.has(id)).sort();

  return { contradictions, unregistered, unknownClasses, malformed, skipped, spans, undeclared, uncontracted, declaredIds };
}
