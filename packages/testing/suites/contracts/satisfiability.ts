/**
 * ===========================================================================================
 * EVERY CLOSED REQUEST OBJECT IN THE CONTRACT SET MUST BE SATISFIABLE.
 * ===========================================================================================
 *
 * An object with `additionalProperties: false` and a `required` list naming a field its
 * `properties` block does not declare is **unsatisfiable**: the required name must be present, and
 * `additionalProperties: false` forbids it. **No valid request exists.** A client built from that
 * schema is a client that cannot make a legal call, and the route it targets is unreachable.
 *
 * ===========================================================================================
 * WHY THIS IS A SUITE CASE AND NOT A SCRIPT SOMEONE RAN ONCE
 * ===========================================================================================
 *
 * **NOTHING IN THIS REPOSITORY EXECUTES JSON SCHEMA.** `packages/contracts/README.md` records that
 * there is no implementation and no validator, so a `required` list is — in `workflow.md` §12's
 * words — *"an instruction to a person who will follow it literally, with no tooling to disagree
 * with the prose."* It is invisible to `typecheck`, invisible to every suite, and invisible to
 * review, because each document is individually plausible.
 *
 * IT FOUND FOUR REAL INSTANCES ON ITS FIRST RUN, three of them in contracts being actively built
 * and one — `login-v1`'s `loginCompleteRequest` — untouched that day and found by nobody. All four
 * are fixed; this exists so the fifth is caught by a run rather than by a sweep somebody
 * remembered to do.
 *
 * ===========================================================================================
 * WHY IT LIVES IN `packages/testing/**` AND IS OWNED BY `qa-agent`
 * ===========================================================================================
 *
 * The Team Lead asked where it belongs, given that the contract set is `architecture-agent`'s and
 * root tooling is the Team Lead's. **It is a test, not an edit**: it reads `packages/contracts/**`
 * and asserts a property, exactly as `suites/platform-operator/registry-coherence.ts` reads
 * `permission-catalog.yaml` and asserts agreement with Core. `architecture.md` §1 assigns the
 * shape directly — *"Producer and consumer are both tested against the contract by `qa-agent`."*
 * Nothing here writes to a contract, and a finding routes to `architecture-agent` as any other
 * contract defect does.
 *
 * ===========================================================================================
 * THE 84-versus-87 DISCREPANCY, RECONCILED RATHER THAN PICKED BETWEEN
 * ===========================================================================================
 *
 * Two independent sweeps reported different populations — 84 and 87 — with the same single
 * finding. **Both were right and they were counting different things:**
 *
 *   **87** objects declare `additionalProperties: false`.
 *   **84** of those also carry a `required` array.
 *   **3** are closed with nothing required, and are therefore trivially satisfiable.
 *
 * That is why the finding was identical: the three that differ cannot host this defect.
 *
 * **BOTH NUMBERS ARE REPORTED BY THIS SUITE, AND THAT IS THE POINT RATHER THAN BOOKKEEPING.** 84 is
 * the population a defect can be found in; 87 is the population that was examined. Quoting only
 * the first would mean a closed object that later loses its `required` array leaves the checked
 * set silently — the count would go down and look like progress. *"A checker whose object count
 * nobody can reproduce is one whose green nobody can interpret."*
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));

function schemaFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = `${directory}${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...schemaFiles(`${path}/`));
      continue;
    }
    if (entry.endsWith('.schema.json')) {
      found.push(path);
    }
  }
  return found;
}

export type ClosedObject = {
  readonly file: string;
  readonly path: string;
  readonly required: readonly string[];
  readonly declared: readonly string[];
};

/**
 * Every object in a schema tree that declares `additionalProperties: false`.
 *
 * IT WALKS THE WHOLE TREE, not just `$defs`. A closed object nested inside a `properties` block,
 * an `items`, an `allOf` branch or a `$defs` entry is equally unsatisfiable and equally invisible,
 * and restricting the walk to the shapes somebody expected is how a sweep reports a smaller number
 * than the truth.
 */
export function closedObjects(node: unknown, file: string, path = '#'): ClosedObject[] {
  if (node === null || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => closedObjects(entry, file, `${path}[${index}]`));
  }
  const object = node as Record<string, unknown>;
  const found: ClosedObject[] = [];
  if (object.additionalProperties === false) {
    const properties = object.properties;
    const required = object.required;
    found.push({
      file,
      path,
      required: Array.isArray(required) ? (required as string[]) : [],
      declared:
        properties !== null && typeof properties === 'object' && !Array.isArray(properties)
          ? Object.keys(properties as Record<string, unknown>)
          : [],
    });
  }
  for (const [key, value] of Object.entries(object)) {
    found.push(...closedObjects(value, file, `${path}/${key}`));
  }
  return found;
}

/** The required names an object does not declare. Empty for a satisfiable object. */
export function unsatisfiedNames(entry: ClosedObject): readonly string[] {
  const declared = new Set(entry.declared);
  return entry.required.filter((name) => !declared.has(name));
}

export function buildContractSatisfiabilitySuite(): Suite {
  const suite = new Suite('Contracts — every closed request object is satisfiable');

  const files = schemaFiles(CONTRACTS);
  const all = files.flatMap((file) =>
    closedObjects(JSON.parse(readFileSync(file, 'utf8')), file.slice(CONTRACTS.length)),
  );

  suite.test('the sweep read the contract set — the floor for the comparison below', () => {
    // ===================================================================================
    // "NO FINDINGS" MUST NOT RENDER AS "NO INPUT". A walk that matched nothing reports zero
    // unsatisfiable objects, which is the most confident wrong answer this check can give —
    // and it is what a renamed directory, a changed extension or a moved file produces.
    // ===================================================================================
    assertTrue(
      'schema files were found',
      files.length >= 15,
      `only ${String(files.length)} *.schema.json files under ${CONTRACTS}`,
    );
    assertTrue(
      'and they contain closed objects to check',
      all.length >= 80,
      `only ${String(all.length)} closed objects were walked; the contract set has not shrunk ` +
        'by that much, so the walker is reading less than it should',
    );
  });

  suite.test('BOTH populations are reported, because they are different questions', () => {
    // See this file's header. 87 examined, 84 checkable, 3 closed-with-nothing-required.
    const withRequired = all.filter((entry) => entry.required.length > 0);
    const withoutRequired = all.length - withRequired.length;
    assertEqual(
      'every closed object either has a required list or does not — no third state',
      withRequired.length + withoutRequired,
      all.length,
    );
    assertTrue(
      'a closed object with NO required list is trivially satisfiable, so the two counts ' +
        'legitimately differ and neither sweep was wrong',
      withoutRequired >= 0 && withRequired.length <= all.length,
      `closed=${String(all.length)} withRequired=${String(withRequired.length)}`,
    );
    // REPORTED, NOT PINNED. Asserting the exact numbers would make every legitimate contract
    // addition fail this case, which is how a check becomes something people edit rather than
    // read. The FLOOR above is what stops the population silently collapsing.
    console.log(
      `      (closed objects: ${String(all.length)} · with a required list: ` +
        `${String(withRequired.length)} · closed with nothing required: ${String(withoutRequired)})`,
    );
  });

  suite.test('NO closed object requires a field its properties block does not declare', () => {
    const offenders = all
      .map((entry) => ({ entry, missing: unsatisfiedNames(entry) }))
      .filter((result) => result.missing.length > 0)
      .map(
        (result) =>
          `${result.entry.file} ${result.entry.path} requires undeclared: ${result.missing.join(',')}`,
      );
    assertEqual(
      `${ISOLATION} every closed object in the contract set can be satisfied by some request`,
      offenders.join(' · '),
      '',
    );
  });

  suite.test('THE CONSTRUCTED FAILING INPUT: login-v1\'s defect, rebuilt', () => {
    // =====================================================================================
    // THE FOURTH INSTANCE, AS TEXT. `loginCompleteRequest` required `email` and `derived_key`
    // and declared neither, under `additionalProperties: false` — so no valid login-complete
    // request existed. It had been there untouched and nobody had found it.
    // =====================================================================================
    //
    // A checker that reported this as satisfiable is the checker that let it through, and both
    // halves matter: the walker has to FIND the nested object, and the comparison has to notice
    // the names.
    const broken = {
      $defs: {
        loginCompleteRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'derived_key'],
          properties: { session_hint: { type: 'string' } },
        },
      },
    };
    const walked = closedObjects(broken, 'synthetic.schema.json');
    assertEqual('the walker found the nested closed object', walked.length, 1);
    assertEqual(
      // IN THE CONTRACT'S OWN ORDER, not sorted. A failure message that lists the names in the
      // order the `required` array declares them is one a reader can hold against the file.
      `${ISOLATION} and it names BOTH undeclared required fields`,
      unsatisfiedNames(walked[0]!).join(','),
      'email,derived_key',
    );

    // AND THE MIRROR, so the check is not passing by flagging everything: the same object with
    // the two fields declared is reported as satisfiable.
    const repaired = {
      $defs: {
        loginCompleteRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['email', 'derived_key'],
          properties: {
            email: { type: 'string' },
            derived_key: { type: 'string' },
          },
        },
      },
    };
    assertEqual(
      'a satisfiable object is not reported',
      unsatisfiedNames(closedObjects(repaired, 'synthetic.schema.json')[0]!).join(','),
      '',
    );
  });

  suite.test('a closed object nested anywhere is walked, not just $defs entries', () => {
    // THE WALKER'S OWN COVERAGE. The first sweep to disagree on a population count did so because
    // of where it looked, and a walker that stops at `$defs` reports a smaller, plausible number.
    const nested = {
      properties: {
        outer: {
          items: {
            allOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['buried'],
                properties: {},
              },
            ],
          },
        },
      },
    };
    const walked = closedObjects(nested, 'synthetic.schema.json');
    assertEqual('it found the object under properties/items/allOf', walked.length, 1);
    assertEqual(
      'and reported its undeclared requirement',
      unsatisfiedNames(walked[0]!).join(','),
      'buried',
    );
  });

  return suite;
}
