/**
 * ===========================================================================================
 * DOES EVERY OPERATION CARRY THE SIX OBLIGATIONS ITS README CLAIMS FOR THE CLASS?
 * ===========================================================================================
 *
 * `core/tenant-admin/README.md` §2 states six obligations for **every contract in the class**.
 * The question is whether the class's thirty operations actually carry them — asked as an
 * outcome, over all eight contract sets, four of which were authored in one afternoon.
 *
 * ===========================================================================================
 * WHAT WAS ALREADY COVERED, AND WHAT WAS NOT — checked before scoping, not after
 * ===========================================================================================
 *
 * | | obligation | where |
 * |---|---|---|
 * | 2.1 | `unknownIdentifierResponse: not_found` | **NOWHERE — built here** |
 * | 2.2 | no organization identifier in any request position | `registration-refusals.ts`, path AND body |
 * | 2.3 | every read declares a bound, no default | `registration-refusals.ts` |
 * | 2.4 | sensitivity read off the catalogue, confirmation derived | **HALF — audit/confirmation presence was covered; that the value MATCHES THE CATALOGUE was not. Built here** |
 * | 2.5 | role grants are visible | **NOWHERE — and it needs a route, so it is NOT RUN. Stated below** |
 * | 2.6 | conjunctions, never disjunctions | `registration-refusals.ts` |
 *
 * **Two gaps and one half-gap.** Recorded because *"the six obligations are checked"* would have
 * been false in three of six places, and the two that were missing are the two nobody had
 * written a case for rather than the two that were hard.
 *
 * ===========================================================================================
 * THE POPULATION, DERIVED THREE WAYS — because two derivations sharing a scope are one
 * ===========================================================================================
 *
 * ```
 * the operations reader (slices the `operations:` block)   30
 * 4-space `path:` lines across the eight contracts         30
 * 4-space `permission:` lines                              30
 * ```
 *
 * **Three mechanisms, one answer.** The raw `- id:` count is 67 and is NOT the population — ids
 * appear in error lists and elsewhere, which is exactly the trap `§11a` records for a count with
 * nothing to compare against.
 *
 * ===========================================================================================
 * ⚠ AND THE NAMED SUSPICION IS REFUTED, WHICH IS THE RESULT WORTH REPORTING
 * ===========================================================================================
 *
 * The Team Lead named one and asked for it to be measured rather than inherited:
 *
 *   > *"Four sets authored in one afternoon by one author is the condition under which an
 *   >  obligation gets stated in a README and not carried into the fourth file."*
 *
 * **Measured: 16 of 30 operations take a path parameter, ALL SIXTEEN declare
 * `unknownIdentifierResponse: not_found`, and NOT ONE declares anything else.** Across all eight
 * sets, including the four written that afternoon.
 *
 * **31 comparable (operation, permission) pairs; ZERO sensitivity mismatches against the
 * catalogue.**
 *
 * > **A refuted suspicion, stated as refuted, is worth more than an unexamined one** — and this
 * > one was worth measuring precisely because it was plausible. `§11a`: *a green is a finding
 * > when somebody predicted red.*
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import { operationsIn, pathParametersOf } from './registration-refusals.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTRACT_TREE = 'packages/contracts/core/tenant-admin';
const CATALOG = 'packages/contracts/registries/permission-catalog.yaml';

type Op = ReturnType<typeof operationsIn>[number] & { readonly unknownIdentifierResponse?: string };

/** Every operation across the class, with `unknownIdentifierResponse` added to the shared reader. */
function allOperations(): Op[] {
  if (!existsSync(REPO + CONTRACT_TREE)) return [];
  return readdirSync(REPO + CONTRACT_TREE)
    .filter((name) => name.endsWith('.contract.yaml'))
    .sort()
    .flatMap((file) => {
      const source = readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8');
      // `operationsIn` is SHARED with `registration-refusals.ts` deliberately — a second reader of
      // the same block is the defect this class of check exists to find, one layer up. The one
      // field it does not carry is read here, keyed on the operation id it belongs to.
      const declared = new Map<string, string>();
      let inOperations = false;
      let current = '';
      for (const line of source.split('\n')) {
        if (/^[A-Za-z][A-Za-z0-9_]*:/.test(line)) {
          inOperations = /^operations:/.test(line);
          continue;
        }
        if (!inOperations) continue;
        const id = /^ {2}- id: (\S+)/.exec(line);
        if (id !== null) {
          current = id[1];
          continue;
        }
        const value = /^ {4}unknownIdentifierResponse:\s*(\S+)/.exec(line);
        if (value !== null && current !== '') declared.set(current, value[1]);
      }
      return operationsIn(file, source).map((operation) => ({
        ...operation,
        unknownIdentifierResponse: declared.get(operation.id),
      }));
    });
}

/** `permissionId -> sensitivity`, from the catalogue's `permissions:` block only. */
function catalogueSensitivity(): Map<string, string> {
  const lines = readFileSync(REPO + CATALOG, 'utf8').split('\n');
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[a-zA-Z_]+:/.test(line));
  const block = rest.slice(0, end === -1 ? rest.length : end);
  const sensitivity = new Map<string, string>();
  let current = '';
  for (const line of block) {
    const id = /^ {2}- id: (\S+)/.exec(line);
    if (id !== null) {
      current = id[1];
      continue;
    }
    const value = /^ {4}sensitivity:\s*(\S+)/.exec(line);
    if (value !== null && current !== '') sensitivity.set(current, value[1]);
  }
  return sensitivity;
}

export function buildSixObligationsSuite(): Suite {
  const suite = new TestSuite('tenant-admin — the six obligations, across every operation in the class');

  suite.test('POPULATION — three derivations, and the raw id count is NOT one of them', () => {
    const operations = allOperations();
    const source = readdirSync(REPO + CONTRACT_TREE)
      .filter((name) => name.endsWith('.contract.yaml'))
      .map((name) => readFileSync(`${REPO}${CONTRACT_TREE}/${name}`, 'utf8'))
      .join('\n');
    const paths = [...source.matchAll(/^ {4}path: "/gm)].length;
    const permissions = [...source.matchAll(/^ {4}permission: /gm)].length;

    console.log(
      `      contracts 8 · schemas ${String(readdirSync(REPO + CONTRACT_TREE).filter((n) => n.endsWith('.schema.json')).length)}\n` +
        `      operations reader ${String(operations.length)} · 4-space \`path:\` ${String(paths)} · ` +
        `4-space \`permission:\` ${String(permissions)}`,
    );
    // Three mechanisms over the same files. They share a SCOPE — all eight contracts — so this is
    // not independence of scope; it is independence of METHOD over one declared scope, which is
    // what catches a reader that mis-slices the block rather than one pointed at the wrong tree.
    assertEqual('the reader agrees with the `path:` derivation', operations.length, paths);
    assertEqual('and with the `permission:` derivation', operations.length, permissions);
    assertTrue(
      'floor: the class is non-trivial',
      operations.length >= 20,
      `${String(operations.length)} operations parsed across eight contract sets — below the floor, ` +
        'so the reader has stopped slicing the `operations:` block rather than the class being small.',
    );
  });

  suite.test('2.1 — every operation taking an identifier declares `unknownIdentifierResponse: not_found`', () => {
    // `0043` §5.1: **declared as a FIELD, not as prose** — *"prose describes; a declared field can
    // be checked"* — because `forbidden` for *"that id is not yours"* and `forbidden` for *"you
    // lack the permission"* are indistinguishable in an errors list, which is why the field is
    // separate from `errors:`.
    const operations = allOperations();
    const takesIdentifier = operations.filter((operation) => pathParametersOf(operation.path).length > 0);
    const missing = takesIdentifier.filter((operation) => operation.unknownIdentifierResponse === undefined);
    const wrong = takesIdentifier.filter(
      (operation) =>
        operation.unknownIdentifierResponse !== undefined &&
        operation.unknownIdentifierResponse !== 'not_found',
    );

    console.log(
      `      ${String(takesIdentifier.length)} of ${String(operations.length)} operations take a path parameter`,
    );
    // THE FLOOR, and it is the one that matters here: if no operation took an identifier, both
    // lists below are empty and the case reports compliance over nothing.
    assertTrue(
      'floor: operations taking an identifier were found',
      takesIdentifier.length > 0,
      'ZERO operations declare a path parameter, so this obligation was checked against nothing.',
    );
    assertEqual(
      `${ISOLATION} every identifier-taking operation declares the field`,
      missing.map((operation) => `${operation.contract}#${operation.id}`).join(' · '),
      '',
    );
    assertEqual(
      `${ISOLATION} and every declaration is \`not_found\` — never \`forbidden\``,
      wrong.map((operation) => `${operation.contract}#${operation.id}=${String(operation.unknownIdentifierResponse)}`).join(' · '),
      '',
    );
  });

  suite.test('2.4 — sensitivity is READ OFF the catalogue, not chosen per route', () => {
    // The half that was uncovered. `§5.4` already asserted that a sensitive operation declares
    // audit and confirmation; **it never asked whether the sensitivity VALUE matches the
    // catalogue's**, which is what "read off" means and is the thing a per-route choice would
    // quietly diverge from.
    const operations = allOperations();
    const catalogue = catalogueSensitivity();
    const mismatches: string[] = [];
    let compared = 0;

    for (const operation of operations) {
      if (operation.sensitivity === '') continue;
      for (const permissionId of operation.permissions) {
        const declared = catalogue.get(permissionId);
        if (declared === undefined) continue; // the catalogue states none; nothing to compare
        compared += 1;
        if (declared !== operation.sensitivity) {
          mismatches.push(
            `${operation.id} declares '${operation.sensitivity}' and the catalogue says '${declared}' for ${permissionId}`,
          );
        }
      }
    }

    console.log(
      `      catalogue states a sensitivity for ${String(catalogue.size)} permission(s); ` +
        `${String(compared)} comparable (operation, permission) pair(s)`,
    );
    assertTrue(
      'floor: the catalogue reader found sensitivities',
      catalogue.size > 0,
      'the catalogue yielded ZERO sensitivities — the `permissions:` slice has stopped matching, ' +
        'and every comparison below is skipped rather than passing.',
    );
    assertTrue(
      'floor: pairs were actually compared',
      compared > 0,
      'no (operation, permission) pair was comparable, so this case examined nothing.',
    );
    assertEqual(
      `${ISOLATION} no operation chooses a sensitivity the catalogue disagrees with`,
      mismatches.join(' · '),
      '',
    );
  });

  suite.test('2.5 — role grants are VISIBLE. NOT RUN: it needs a route, and there are none', () => {
    // `0043` §5.6: a route returns, per role, the exact permission list it holds — because **a
    // role set a tenant cannot inspect is indistinguishable from an arbitrary one**, and under
    // D16 the tenant is authoring roles against those grants.
    //
    // **This is the one obligation of the six that cannot be checked from the contracts alone.**
    // A contract can declare such an operation; only a running route can return a list. Recorded
    // as NOT RUN rather than skipped, and the contract-side half IS asserted — because a class
    // that declares no such operation cannot satisfy the obligation later either.
    const operations = allOperations();
    const roleReads = operations.filter((operation) => /roles?\.(get|read|list)/.test(operation.id));
    console.log(
      `      role-reading operations declared: ${roleReads.map((operation) => operation.id).join(', ') || 'NONE'}\n` +
        '      NOT RUN: whether one RETURNS a per-role permission list needs a registered route.',
    );
    assertTrue(
      '0043 §5.6 — the class declares at least one operation that reads a role',
      roleReads.length > 0,
      'no operation in the class reads a role, so `0043` §5.6 has nothing to be satisfied by. The ' +
        'obligation is about visibility of grants, and a class with no role read cannot provide it.',
    );
  });

  return suite;
}
