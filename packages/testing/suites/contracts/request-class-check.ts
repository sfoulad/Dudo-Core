/**
 * ===========================================================================================
 * `0039`'s ROUTE-CLASS CHECK — the reader, and the scope it sweeps.
 * ===========================================================================================
 *
 * `scripts/check-request-class.mjs` compares each contract's declared `requestClass` against the
 * registry Core actually puts that route in. Its pure half is `scripts/lib/request-class.mjs`,
 * exported as a module so this suite drives **the same implementation the real run drives** — no
 * test-only input path, no root flag, no second code path. Same precedent as `emitModule`.
 *
 * ===========================================================================================
 * *** WHY `parseContract` IS FIRST, AND IT IS NOT WHERE ANYONE LOOKED. ***
 * ===========================================================================================
 *
 * The real defect in this checker was **one character**: storing the regex match rather than its
 * capture group, which made every extracted id malformed. **All three of its known-failing inputs
 * passed anyway**, because they drove `compare` with ids handed to it directly — the broken reader
 * was upstream of every control.
 *
 * The run then exited **0**, announcing *"10 declared route ids agree"* and *"0 still undeclared"*.
 *
 * > **A MALFORMED ID COMPARES CLEAN AGAINST EVERYTHING. So a broken reader does not report
 * > nothing — IT REPORTS AGREEMENT.** That is the most confident wrong answer available, and it is
 * > `§11a`'s empty-list reader with the sign flipped: not *no findings*, but *no disagreements*,
 * > which reads as a pass rather than as an absence.
 *
 * So the first case below asserts a property of the ids themselves rather than of the comparison:
 * **every id the reader extracts must be a well-formed route id.** That is checkable without
 * knowing which class anything belongs to, and it fails loudly on exactly the bug that shipped.
 *
 * ===========================================================================================
 * WHAT THIS SUITE DOES NOT COVER, NAMED RATHER THAN LEFT ABSENT
 * ===========================================================================================
 *
 * **Nothing here guards REGISTRATION-versus-REFERENCE.** The checker sweeps `platform/core` and
 * `apps` for route-id literals; a route registered in a tree it does not sweep would be invisible
 * to it, and that is the failure that actually happened once — four registries enumerated,
 * `platform/core/**` alone swept, the customers App's ten ids missed, **and both derivations
 * agreed while both were short.**
 *
 * **A cross-tree id sweep cannot close it, and that was measured rather than assumed:** a pattern
 * broad enough to catch a registration finds **42 hits in `platform/web/src` and 3 in
 * `platform/admin/src`** — clients legitimately *referencing* ids they call. A pattern narrow
 * enough to avoid them is too narrow to work: a plain `id:` pattern finds **32 of the checker's
 * 34**, missing two registered as `actionId:` and as a frozen map key.
 *
 * > **The distinction needed is REGISTRATION versus REFERENCE, and a pattern cannot make it.** The
 * > viable version searches for **registrar call sites**, not id literals. **That is a named gap,
 * > owed and not built** — the shape `0037`'s Swift emitter takes.
 *
 * **What IS covered is the cause rather than the symptom**, and the distinction is the Team Lead's
 * correction of its own framing: the two derivations agreed because **they swept the same files**,
 * so an independent *id* count could not have disagreed either. **The swept SCOPE carries the
 * whole guard**, and the case below asserts it against a count derived from the ownership table —
 * routes are registered in Core and in installable Apps — rather than from the checker's own
 * choice of directories.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { CLASSES, ROUTE_ID, compare, idLiteralsIn, parseContract } from '../../../../scripts/lib/request-class.mjs';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every `.ts` file under the two trees that can register a route. */
function sourceFilesUnder(trees: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(`${path}/`);
      } else if (entry.name.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  for (const tree of trees) walk(`${REPO}${tree}/`);
  return found;
}

export function buildRequestClassCheckSuite(): Suite {
  const suite = new Suite('Contracts — 0039 route-class check: the reader and its scope');

  suite.test('*** EVERY ID THE READER EXTRACTS IS WELL-FORMED — the bug that shipped ***', () => {
    // ===================================================================================
    // The one-character defect: the match rather than the capture group. Every id came out
    // malformed, every control passed because they fed `compare` directly, and the run reported
    // AGREEMENT. This asserts the ids, not the comparison.
    // ===================================================================================
    const contract = [
      'requestClass: platform',
      'operations:',
      '',
      '  - id: platform.organizations.read',
      '    title: "A real operation"',
      '  - id: platform.templates.list',
      '    title: "Another"',
    ].join('\n');

    const parsed = parseContract(contract) as {
      contractClass?: string;
      blockKey?: string;
      operations: Array<{ id: string; ownClass?: string }>;
    };

    // THE FLOOR FIRST. A reader that extracted nothing would satisfy every "all ids are
    // well-formed" assertion vacuously — all of none are.
    assertEqual(
      `${ISOLATION} the reader extracted the operations at all`,
      String(parsed.operations.length),
      '2',
    );
    for (const operation of parsed.operations) {
      assertTrue(
        `${ISOLATION} '${operation.id}' is a well-formed route id`,
        ROUTE_ID.test(operation.id),
        `the extracted id is not a route id. A MALFORMED ID COMPARES CLEAN AGAINST EVERYTHING, so ` +
          `a reader broken this way reports AGREEMENT rather than nothing: ${JSON.stringify(operation)}`,
      );
    }
    assertEqual('and the block key was recognised', String(parsed.blockKey), 'operations');
    assertEqual('and the contract-level class was read', String(parsed.contractClass), 'platform');
  });

  suite.test('A BLOCK THAT IS NOT A PUBLISHING BLOCK CONTRIBUTES NO OPERATIONS', () => {
    // `openQuestions:` and its like carry `- id:` entries at the SAME INDENT as a real operation.
    // Only `operations:`, `entryPoints:` and `actions:` publish. A reader that scoped by line shape
    // rather than by enclosing block would invent operations out of an open-questions list — and
    // they would then be compared against a registry that has never heard of them, producing
    // "published with a class, not registered in Core" for something that is not a route at all.
    //
    // THE FAKE ID IS DOTTED ON PURPOSE. `- id: TA-1` would be rejected by the id pattern anyway,
    // so it would pass this case without exercising the block scoping at all.
    const contract = [
      'requestClass: platform',
      'openQuestions:',
      '',
      '  - id: fake.NotAnOperation',
      '    question: "Looks exactly like an operation and is not one."',
      '',
      'operations:',
      '',
      '  - id: platform.templates.read',
      '    title: "The only real operation here"',
    ].join('\n');

    const parsed = parseContract(contract) as { operations: Array<{ id: string }> };
    assertEqual(
      `${ISOLATION} only the publishing block contributed operations`,
      parsed.operations.map((operation) => operation.id).join(','),
      'platform.templates.read',
    );
  });

  suite.test('A PER-OPERATION CLASS OVERRIDES THE CONTRACT-LEVEL ONE', () => {
    // `0039` allows the field per operation precisely because a contract can span classes, and a
    // file-level value silently asserts one class about every operation under it. `confirmation-v1`
    // is the live instance and now declares per operation.
    const contract = [
      'requestClass: platform',
      'operations:',
      '',
      '  - id: platform.confirmations.request',
      '    title: "Takes the contract-level class"',
      '  - id: core.confirmations.request',
      '    requestClass: action',
      '    title: "Declares its own"',
    ].join('\n');

    const parsed = parseContract(contract) as {
      contractClass?: string;
      operations: Array<{ id: string; ownClass?: string }>;
    };
    assertEqual('the contract level is still read', String(parsed.contractClass), 'platform');
    assertEqual(
      `${ISOLATION} the operation carrying its own class keeps it`,
      parsed.operations.map((o) => `${o.id}=${String(o.ownClass)}`).join(' · '),
      'platform.confirmations.request=undefined · core.confirmations.request=action',
    );
  });

  suite.test('THE ID EXTRACTOR READS BOTH REGISTRATION SPELLINGS, not just `id:`', () => {
    // TWO SPELLINGS COST A NARROWER PATTERN TWO IDS on this very corpus: `actionId:` and a quoted
    // map key. A reader that knew only `id:` found 32 of 34 and reported no disagreement, because
    // what it missed it also never compared.
    const source = [
      "  { id: 'platform.templates.read', handler: readTemplate },",
      "  { actionId: 'customers.RestoreDeletedCustomer', route: '/x' },",
      "  'customers.DeleteCustomer': Object.freeze({ requiresConfirmation: true }),",
    ].join('\n');

    const found = [...(idLiteralsIn(source) as Set<string>)].sort();
    assertTrue(
      `${ISOLATION} the \`id:\` spelling is read`,
      found.includes('platform.templates.read'),
      `found=${JSON.stringify(found)}`,
    );
    assertTrue(
      `${ISOLATION} the \`actionId:\` spelling is read — one of the two a narrow pattern missed`,
      found.includes('customers.RestoreDeletedCustomer'),
      `found=${JSON.stringify(found)}`,
    );
    // AND THE MIRROR: prose mentioning an id must NOT be extracted, or every comment naming a
    // route becomes a registration.
    const prose = ' * `customers.DeleteCustomer` and `customers.RestoreDeletedCustomer` are CONTRACTED';
    assertEqual(
      'a comment naming ids extracts nothing — a mention is not a registration',
      String([...(idLiteralsIn(prose) as Set<string>)].length),
      '0',
    );
  });

  suite.test('*** THE SWEPT SCOPE, against a count derived from the OWNERSHIP TABLE ***', () => {
    // ===================================================================================
    // THE CASE THAT WOULD HAVE CAUGHT THE REAL DEFECT, and the reason it is the file count
    // rather than the id count.
    // ===================================================================================
    //
    // The checker enumerated four registries and swept `platform/core/**` alone, missing the
    // customers App's ten ids. **Its two derivations agreed at 24 because they swept the same
    // files** — so an independent ID count could not have disagreed either. **The swept SCOPE is
    // the cause; the id numbers are the symptom.**
    //
    // This count comes from the ownership table — routes are registered in Core and in installable
    // Apps — **not from the checker's own choice of directories**, which is what makes it
    // independent rather than a second copy of the same decision.
    const independent = sourceFilesUnder(['platform/core', 'apps']);

    // THE FLOOR. An empty walk would match a checker that swept nothing, and both would be "equal".
    assertTrue(
      `${ISOLATION} the independent walk found a substantial number of source files`,
      independent.length >= 50,
      `only ${String(independent.length)} .ts files under platform/core and apps; there were 102 ` +
        'on 2026-09-09. A collapsed walk would agree with a collapsed checker',
    );

    const output = execFileSync('node', ['scripts/check-request-class.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    const swept = /source files swept\s*\.*\s*(\d+)/u.exec(output);
    assertTrue(
      `${ISOLATION} the checker reported its swept population at all`,
      swept !== null,
      'the checker printed no `source files swept` line, so there is nothing to reconcile — a ' +
        `population it does not report is one nobody can check: ${output.slice(0, 300)}`,
    );

    console.log(
      `        0039 scope: checker swept ${String(swept?.[1])} · independent walk ${String(independent.length)}`,
    );
    assertEqual(
      `${ISOLATION} the checker sweeps every source file the ownership table says can register a route`,
      String(swept?.[1]),
      String(independent.length),
    );
  });

  suite.test('*** `0039`\'s REQUIRED KNOWN-FAILING INPUT: the wrong class for a real route ***', () => {
    // ===================================================================================
    // `0039` requires this in these words: *"Ship with a known-failing input: a fixture contract
    // declaring the wrong class for a real route, which MUST go red."*
    //
    // *** IT COULD NOT EXIST UNTIL TODAY, AND THAT IS THE POINT OF RECORDING IT HERE. ***
    // For most of this ADR's life nothing compared a declaration against a registry, so there was
    // nothing for a known-failing input to go red AGAINST — a fixture asserting a contradiction
    // would have passed, which is not a test. `scripts/check-request-class.mjs` landed and the
    // fixture became constructible the same day.
    // ===================================================================================
    //
    // THE PAIR IS `platform` DECLARED AGAINST `session` REGISTERED, and it is not an arbitrary
    // choice: those are the two classes that SHARE the `operations:` block key, so they are
    // indistinguishable to every tool that reads only the contract. The generator says so in a
    // warning and cannot do more. **This is the check that can.**
    const contracts = [
      {
        file: 'fixture/wrong-class-v1.contract.yaml',
        contractClass: 'platform',
        blockKey: 'operations',
        operations: [{ id: 'identity.organizations.list' }, { id: 'identity.organization.select' }],
      },
    ];
    const registry = new Map([
      ['identity.organizations.list', { className: 'session', source: 'session-routes.ts' }],
      ['identity.organization.select', { className: 'session', source: 'session-routes.ts' }],
    ]);

    const result = compare(contracts, registry);
    assertEqual(
      `${ISOLATION} both wrongly-declared routes are reported as contradictions`,
      result.contradictions.map((entry) => entry.id).sort().join(','),
      'identity.organization.select,identity.organizations.list',
    );

    // ---- IT MUST NAME BOTH CLASSES AND WHERE THE REGISTRY EVIDENCE CAME FROM.
    // A failure saying "class mismatch" leaves the reader exactly where the generator's warning
    // already left them: knowing the declaration is unverified and not knowing what it is wrong
    // ABOUT. The whole subject of `0039` is two classes that look identical from the contract.
    for (const entry of result.contradictions) {
      assertEqual(
        `${ISOLATION} ${entry.id} names the declared class, the registered class and the source`,
        `${entry.declared} vs ${entry.actual} in ${String(entry.source)}`,
        'platform vs session in session-routes.ts',
      );
    }

    // ---- AND THE DIVERGENCE THAT MAKES IT MORE THAN A LABELLING SLIP.
    // `platform` evaluates a permission; `session` evaluates none. So this contradiction is a
    // false statement about WHO MAY CALL THE ROUTE, and the check says so explicitly.
    const declared = CLASSES['platform']!;
    const actual = CLASSES['session']!;
    assertTrue(
      `${ISOLATION} the two classes DISAGREE about whether a permission is evaluated at all`,
      declared.evaluatesPermission !== actual.evaluatesPermission,
      `platform=${String(declared.evaluatesPermission)} session=${String(actual.evaluatesPermission)} — ` +
        'if these ever agree, this fixture stops exercising the divergence branch and becomes a ' +
        'plain contradiction case. Pick a pair that still straddles the boundary rather than ' +
        'deleting the assertion',
    );

    // *** THE MIRROR, AND WITHOUT IT THE ASSERTION ABOVE IS ABOUT NOTHING. ***
    // A fixture whose two classes BOTH evaluate permissions is still a contradiction — and would
    // pass every assertion above while never exercising the divergence at all. `platform` and
    // `action` are that pair. So the divergence must be a property of WHICH classes clash, not of
    // there being a clash.
    const bothEvaluate = compare(
      [
        {
          file: 'fixture/other-v1.contract.yaml',
          contractClass: 'platform',
          blockKey: 'operations',
          operations: [{ id: 'customers.ListCustomers' }],
        },
      ],
      new Map([['customers.ListCustomers', { className: 'action', source: 'routes.ts' }]]),
    );
    assertEqual(
      'a platform-vs-action clash is still a contradiction',
      bothEvaluate.contradictions.map((entry) => `${entry.declared} vs ${entry.actual}`).join(','),
      'platform vs action',
    );
    assertTrue(
      `${ISOLATION} MIRROR: and those two AGREE about evaluating a permission, so no divergence`,
      CLASSES['platform']!.evaluatesPermission === CLASSES['action']!.evaluatesPermission,
      'platform and action no longer agree on evaluatesPermission, so this mirror no longer shows ' +
        'that the divergence branch is about the CLASSES rather than about any contradiction',
    );

    // ---- AND THE CONTROL: a declaration that AGREES produces nothing. Without it, a `compare`
    // that flagged every declared route would satisfy everything above.
    const agreeing = compare(
      [
        {
          file: 'fixture/right-class-v1.contract.yaml',
          contractClass: 'session',
          blockKey: 'operations',
          operations: [{ id: 'identity.organizations.list' }],
        },
      ],
      new Map([['identity.organizations.list', { className: 'session', source: 'session-routes.ts' }]]),
    );
    assertEqual(
      `${ISOLATION} CONTROL: a correct declaration is not flagged`,
      String(agreeing.contradictions.length),
      '0',
    );
  });

  return suite;
}
