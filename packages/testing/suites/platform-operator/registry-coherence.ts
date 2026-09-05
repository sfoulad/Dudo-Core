/**
 * ===========================================================================================
 * THE HALF CORE CANNOT CHECK: `permission-catalog.yaml` AGAINST CORE'S FROZEN TRANSCRIPTIONS.
 * `docs/decisions/0027` · `docs/decisions/0007` · `docs/decisions/0025` · `confirmation-v1`.
 * ===========================================================================================
 *
 * Two files in `platform/core/**` transcribe a contract registry into a frozen literal, each
 * because Core cannot read the registry at runtime:
 *
 *   `confirmation/critical-permissions.ts`  — every permission the catalog marks
 *                                             `sensitivity: critical`.
 *   `platform/platform-permissions.ts`      — what `defaultRoles: platform-admin` grants.
 *
 * BOTH FILES SAY IN THEIR OWN HEADERS THAT THE COMPARISON IS `qa-agent`'s AND THAT IT IS THE
 * IMPORTANT HALF. `critical-permissions.ts`:
 *
 *   *"THAT MAKES THIS FILE A TRANSCRIPTION, AND A TRANSCRIPTION CAN DRIFT.
 *   `assertCriticalSetIsCoherent` is what turns drift into a load-time failure rather than a
 *   silent bypass, and `qa-agent` owes the other half: every permission the catalog marks
 *   `sensitivity: critical` appears in the set below, and nothing else does. That is one
 *   comparison over one file and it is the only thing standing between the catalog and this
 *   list."*
 *
 * IT HAD NEVER BEEN WRITTEN, AND IT WAS ALREADY RED WHEN IT WAS. See the first case.
 *
 * ===========================================================================================
 * WHY THE DIRECTION OF EACH DRIFT DECIDES HOW ALARMING IT IS
 * ===========================================================================================
 *
 * A permission missing from the CRITICAL set **fails open**: `requiresConfirmation` answers
 * `false`, both gates derive the requirement from that one function, and an irreversible
 * operation is performed without asking. Nothing anywhere reports it, because from every call
 * site the code looks correct.
 *
 * A permission missing from the ROLE mapping **fails closed**: the operator is denied something
 * the catalog says they hold. That is a broken feature and not a broken boundary.
 *
 * Both are asserted, and each case says which direction it is, because a reader who finds this
 * file red needs to know within one line whether to stop shipping.
 *
 * ===========================================================================================
 * THE PARSER IS A HEURISTIC AND IS NOT PRETENDING OTHERWISE
 * ===========================================================================================
 *
 * There is no YAML parser in this repository and `docs/decisions/0003` approves no npm package,
 * so the reader below is line- and indentation-oriented: top-level sections at column 0, list
 * entries at two spaces, fields at four, role permission items at six. **It would misread a
 * block-scalar description that happened to contain a line matching those shapes**, and the
 * catalog's descriptions are long and contain the word CRITICAL in prose.
 *
 * THAT IS WHY EVERY CASE ASSERTS A FLOOR ON WHAT THE PARSER FOUND before comparing anything. A
 * parser that silently found nothing would make every comparison trivially green — the exact
 * failure mode a hand-rolled reader has — so "it parsed something plausible" is asserted first
 * and separately. If the catalog's layout changes, these cases go red on the floor rather than
 * quietly stopping checking.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

import {
  confirmableOperations,
  criticalPermissions,
  requiresConfirmation,
} from '../../../../platform/core/confirmation/critical-permissions.ts';
import {
  hasStatement,
  statementCatalogEntries,
} from '../../../../platform/core/confirmation/statements.ts';
import {
  grantsForPlatformRole,
} from '../../../../platform/core/platform/platform-permissions.ts';
import {
  isConfirmationGated,
  platformRoutes,
} from '../../../../platform/core/platform/platform-routes.ts';
import { createCustomerRoutes } from '../../../../apps/customers/api/routes.ts';
import { createStoreBusinessDirectory } from '../../../../platform/core/tenancy/business-directory.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CATALOG_PATH = `${REPOSITORY_ROOT}packages/contracts/registries/permission-catalog.yaml`;

/**
 * The lines of one top-level section, `name:` at column 0 up to the next line starting at
 * column 0.
 *
 * SECTIONING FIRST IS WHAT MAKES THE REST SAFE. `sensitivityClasses:` also contains `- id:`
 * entries and `openQuestions:` contains prose about critical permissions; without this, a
 * comparison over the whole file would collect both.
 */
function sectionLines(source: string, name: string): readonly string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `${name}:`);
  if (start === -1) {
    return [];
  }
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^[A-Za-z]/.test(line)) {
      break;
    }
    collected.push(line);
  }
  return collected;
}

/** Every `  - id: X` in a section, in order. Two spaces exactly; a description line has six. */
function entryIds(lines: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const match = /^ {2}- id: (\S+)\s*$/.exec(line);
    if (match !== null) {
      ids.push(match[1]!);
    }
  }
  return ids;
}

/**
 * Every permission entry with the sensitivity the reader could parse for it, or `null`.
 *
 * ===========================================================================================
 * *** IT RETURNS THE SENSITIVITY OF **EVERY** ENTRY, INCLUDING THE ONES IT COULD NOT READ, AND
 * THAT IS THE WHOLE DEFENCE. ***
 * ===========================================================================================
 *
 * `core-agent` retracted a one-line `awk` it had recommended for this comparison, on exactly the
 * right grounds: it matched `sensitivity:` only in indented block form, so *"a permission written
 * inline or at a different indent is silently skipped — producing a shorter list that compares
 * green against a shorter Core set. Two lists agreeing because neither contains the missing
 * entry."* It added: *"it gave the right answer today only because every `sensitivity:` in that
 * file happens to be block-form at four spaces. That is a property of the file, not of the check."*
 *
 * **THE READER BELOW HAS THE SAME SHAPE AND WOULD HAVE THE SAME BUG.** The bidirectional
 * comparison catches most of it — an entry this reader misses that Core DOES hold shows up in
 * `missingFromCatalog` and turns the case red — but it does NOT catch the case that matters most:
 * a permission the catalog marks critical, in a form this reader cannot see, **and** absent from
 * Core. Both sides would then be missing it and would agree.
 *
 * SO THE FLOOR IS NOT "did we find some criticals". It is **"does every permission entry have a
 * sensitivity this reader could parse"** — a question answerable without knowing what any entry's
 * value should be. An entry whose sensitivity is written in an unreadable form has NO sensitivity
 * here, and that is detectable. It closes the hole rather than narrowing it.
 */
function sensitivityByPermission(source: string): ReadonlyMap<string, string | null> {
  const found = new Map<string, string | null>();
  let current: string | null = null;
  for (const line of sectionLines(source, 'permissions')) {
    const entry = /^ {2}- id: (\S+)\s*$/.exec(line);
    if (entry !== null) {
      current = entry[1]!;
      found.set(current, null);
      continue;
    }
    if (current === null) {
      continue;
    }
    const sensitivity = /^ {4}sensitivity: (\S+)\s*$/.exec(line);
    if (sensitivity !== null) {
      found.set(current, sensitivity[1]!);
    }
  }
  return found;
}

/** The catalog's critical permissions, read through the map above. */
function criticalPermissionsInCatalog(source: string): readonly string[] {
  return [...sensitivityByPermission(source)]
    .filter(([, sensitivity]) => sensitivity === 'critical')
    .map(([permissionId]) => permissionId);
}

/**
 * `operationId -> successStatus` across every platform contract that declares operations.
 *
 * SAME READER SHAPE, SAME FLOOR OBLIGATION. The caller asserts that every operation entry yielded
 * a status before comparing anything, for the reason above: an operation whose `successStatus` is
 * written in a form this cannot see would silently drop out of the comparison, and a route whose
 * status had drifted would then be compared against nothing.
 */
function successStatusByOperation(source: string): ReadonlyMap<string, number | null> {
  const found = new Map<string, number | null>();
  let current: string | null = null;
  for (const line of sectionLines(source, 'operations')) {
    const entry = /^ {2}- id: (\S+)\s*$/.exec(line);
    if (entry !== null) {
      current = entry[1]!;
      found.set(current, null);
      continue;
    }
    if (current === null) {
      continue;
    }
    const status = /^ {4}successStatus: (\d+)\s*$/.exec(line);
    if (status !== null) {
      found.set(current, Number(status[1]));
    }
  }
  return found;
}

const PLATFORM_CONTRACT_DIRECTORY = `${REPOSITORY_ROOT}packages/contracts/core/platform/`;

/**
 * The contracts that declare platform-class operations.
 *
 * A CLOSED LIST, because a directory walk would silently start covering a contract nobody meant
 * this case to bind — and because a contract file being ADDED without its operations reaching the
 * route table is itself something a reviewer should decide rather than have absorbed.
 */
const OPERATION_CONTRACTS: readonly string[] = Object.freeze([
  'platform-operator-v1.contract.yaml',
  'template-v1.contract.yaml',
  'confirmation-v1.contract.yaml',
  'organization-onboarding-v1.contract.yaml',
  // ADDED 2026-09-05 with `platform.organizations.read` and
  // `platform.organizations.members.resolve`. The closed list went red on both, which is the
  // list working: a route reached the table before this case knew which contract governed it.
  'organization-detail-v1.contract.yaml',
  // ADDED 2026-09-05 with the two audit feeds.
  'platform-audit-read-v1.contract.yaml',
]);

/**
 * The permission list of one `defaultRoles` entry.
 *
 * **BOTH YAML SEQUENCE FORMS ARE READ, AND THE SECOND ONE WAS A REAL PARSER BUG RATHER THAN
 * PEDANTRY.** `platform-admin` writes its permissions as a block sequence over ten lines;
 * `marketplace-moderator` and `developer` write theirs inline as `permissions: [a, b]`. A reader
 * that handled only the block form returned an EMPTY list for the inline roles — and an empty
 * list compared against Core would have been a comparison of nothing that printed green.
 *
 * That is why every case below asserts a floor on what was parsed before comparing. The floor is
 * what caught this.
 */
function roleGrantsInCatalog(source: string, roleId: string): readonly string[] {
  const lines = sectionLines(source, 'defaultRoles');
  let inRole = false;
  let inPermissions = false;
  const found: string[] = [];
  for (const line of lines) {
    const entry = /^ {2}- id: (\S+)\s*$/.exec(line);
    if (entry !== null) {
      inRole = entry[1] === roleId;
      inPermissions = false;
      continue;
    }
    if (!inRole) {
      continue;
    }
    // The inline flow sequence: `    permissions: [a, b, c]`.
    const inline = /^ {4}permissions: \[([^\]]*)\]\s*$/.exec(line);
    if (inline !== null) {
      for (const item of inline[1]!.split(',')) {
        const trimmed = item.trim();
        if (trimmed !== '') {
          found.push(trimmed);
        }
      }
      continue;
    }
    if (/^ {4}permissions:\s*$/.test(line)) {
      inPermissions = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      // Any other four-space field ends the permission list.
      inPermissions = false;
      continue;
    }
    const item = inPermissions ? /^ {6}- (\S+)\s*$/.exec(line) : null;
    if (item !== null) {
      found.push(item[1]!);
    }
  }
  return found;
}

function sortedJoin(values: readonly string[]): string {
  return [...values].sort().join(',');
}

export function buildRegistryCoherenceSuite(): Suite {
  const suite = new Suite('Platform — the catalog against Core\'s transcriptions');
  const source = readFileSync(CATALOG_PATH, 'utf8');

  suite.test('the catalog reader found a plausible catalog — the floor for every case below', () => {
    // Asserted before any comparison, because a reader that found nothing would make every
    // comparison green. These floors are deliberately loose: they check that the shape is
    // recognisable, not that the contents are any particular value.
    const permissionSection = sectionLines(source, 'permissions');
    const roleSection = sectionLines(source, 'defaultRoles');
    assertTrue(
      'the permissions section was found and is substantial',
      permissionSection.length > 400,
      `the permissions section parsed as ${String(permissionSection.length)} lines; the reader ` +
        'in this file is indentation-oriented and the catalog layout has probably changed',
    );
    assertTrue(
      'it contains many permission entries',
      entryIds(permissionSection).length > 50,
      `only ${String(entryIds(permissionSection).length)} permission entries were parsed`,
    );
    assertTrue(
      'the defaultRoles section was found',
      roleSection.length > 10,
      `the defaultRoles section parsed as ${String(roleSection.length)} lines`,
    );
    assertTrue(
      'platform-admin is one of the roles',
      entryIds(roleSection).includes('platform-admin'),
      `the roles parsed were: ${entryIds(roleSection).join(', ')}`,
    );
    assertTrue(
      'and it has a non-empty permission list',
      roleGrantsInCatalog(source, 'platform-admin').length > 0,
      'platform-admin parsed with no permissions, so the role comparison below would be vacuous',
    );

    // =====================================================================================
    // *** THE FLOOR THAT ACTUALLY CLOSES THE HOLE. Read `sensitivityByPermission`'s header.
    // =====================================================================================
    //
    // The bidirectional comparison below catches a permission this reader missed that Core HOLDS.
    // It does NOT catch one the catalog marks critical in an unreadable form AND that Core is also
    // missing — both sides would agree, and agree wrongly. **That is the exact failure
    // `core-agent` retracted its own one-liner over**, and this reader had the same shape.
    //
    // So: every permission entry must yield a sensitivity. An entry whose sensitivity this reader
    // cannot see has NO sensitivity here, which is detectable without knowing its value.
    const unreadable = [...sensitivityByPermission(source)]
      .filter(([, sensitivity]) => sensitivity === null)
      .map(([permissionId]) => permissionId);
    assertEqual(
      `${ISOLATION} every permission entry has a sensitivity this reader could parse`,
      unreadable.join(','),
      '',
    );
  });

  suite.test(
    'EVERY permission the catalog calls critical is in Core\'s critical set, and nothing else is',
    () => {
      // ===================================================================================
      // *** FAILS OPEN. A permission missing from Core's set is an irreversible operation
      // that will not ask for confirmation, and no call site will look wrong. ***
      // ===================================================================================
      //
      // `requiresConfirmation` is the ONE question both gates ask — `pipeline.ts` for Actions and
      // `platform-routes.ts::isConfirmationGated` for platform routes — so a permission absent
      // here is a permission neither class gates.
      //
      // THE `nothing else is` HALF IS NOT SYMMETRIC AND IS INCLUDED ANYWAY. An extra entry in Core
      // fails CLOSED: it demands a confirmation for an operation the catalog did not classify,
      // which makes the operation unreachable rather than unprotected. It is still drift and it
      // still means the two files disagree about what `critical` means.
      const inCatalog = criticalPermissionsInCatalog(source);
      const inCore = criticalPermissions();
      assertTrue(
        'the catalog classifies at least one permission critical',
        inCatalog.length > 0,
        'no permission parsed as critical, so this comparison would be vacuous',
      );
      const missingFromCore = inCatalog.filter((id) => !inCore.includes(id));
      const missingFromCatalog = inCore.filter((id) => !inCatalog.includes(id));
      assertEqual(
        `${ISOLATION} every catalog-critical permission requires confirmation in Core`,
        missingFromCore.join(','),
        '',
      );
      assertEqual(
        'and Core classifies nothing critical that the catalog does not',
        missingFromCatalog.join(','),
        '',
      );
      // The sets, compared whole. The two filters above name WHICH entry drifted; this asserts
      // there is no third way for them to differ.
      assertEqual(
        'the two sets are identical',
        sortedJoin(inCore),
        sortedJoin(inCatalog),
      );
    },
  );

  suite.test('and `requiresConfirmation` answers true for each of them, one at a time', () => {
    // The case above compares two lists. This one asks the FUNCTION, per permission, because the
    // list and the predicate are two different things and only the predicate is what the gates
    // call. A `criticalPermissions()` that returned the right list while `CRITICAL` was built from
    // something else would pass the comparison above and gate nothing.
    const unanswered = criticalPermissionsInCatalog(source).filter(
      (permissionId) => !requiresConfirmation(permissionId),
    );
    assertEqual(
      `${ISOLATION} the predicate both gates call agrees with the catalog`,
      unanswered.join(','),
      '',
    );
  });

  suite.test('`platform-admin` holds exactly what the catalog grants it', () => {
    // FAILS CLOSED. Core granting less than the catalog says denies an operator something the
    // contract promises; it opens nothing. Asserted anyway, because `platform-permissions.ts`
    // describes its own list as the catalog's "verbatim" and a transcription that is no longer
    // verbatim is a file whose header can no longer be trusted about anything.
    const fromCatalog = roleGrantsInCatalog(source, 'platform-admin');
    const fromCore = grantsForPlatformRole('platform-admin').grants.map((g) => g.permissionId);
    assertEqual(
      'Core grants the platform-admin role exactly the catalog\'s permission list',
      sortedJoin(fromCore),
      sortedJoin(fromCatalog),
    );
  });

  suite.test('`marketplace-moderator` holds exactly what the catalog grants it', () => {
    const fromCatalog = roleGrantsInCatalog(source, 'marketplace-moderator');
    assertTrue(
      'the catalog defines the role',
      fromCatalog.length > 0,
      'marketplace-moderator parsed with no permissions; Core maps it, so the catalog should ' +
        'define it and this comparison should not be vacuous',
    );
    const fromCore = grantsForPlatformRole('marketplace-moderator').grants.map(
      (g) => g.permissionId,
    );
    assertEqual(
      'Core grants the marketplace-moderator role exactly the catalog\'s permission list',
      sortedJoin(fromCore),
      sortedJoin(fromCatalog),
    );
  });

  // =========================================================================================
  // STATEMENT COVERAGE, CHECKED AT ROUTER CONSTRUCTION — THE REPLACEMENT FOR THE UNPASSABLE CASE
  // =========================================================================================
  //
  // `every critical permission has a statement` CANNOT BE WRITTEN AND IS NOT BEING WRITTEN.
  // Core holds no permission -> operation mapping: Actions live in `apps/**`, `statements.ts` is
  // keyed by ACTION id, and `critical-permissions.ts` is keyed by PERMISSION id. There is no
  // function anywhere that turns one into the other, so the sentence has no computable subject.
  //
  // `core-agent`'s framing, and it is right: *"checking it at router construction, per Action,
  // where both halves are in hand, is not a workaround — it is the only end from which the check
  // is possible."* A router entry carries the Action, and the Action carries BOTH its id and its
  // permission. That is the one place the join exists.
  //
  // WHAT THE REPLACEMENT IS WEAKER AT, STATED RATHER THAN GLOSSED: it sees only Actions that a
  // router registers. A critical permission belonging to no Action at all — twelve of the sixteen
  // today — is not covered by it and cannot be, because there is nothing to check. That is not the
  // same claim as the deleted case made, and pretending otherwise is how a control becomes
  // decorative.
  suite.test(
    'every REGISTERED Action whose permission is critical has a confirmation statement',
    () => {
      const routes = createCustomerRoutes({ businesses: createStoreBusinessDirectory() });
      assertTrue(
        'the router registered Actions to check',
        routes.some((route) => route.kind === 'action'),
        'no action-kind route was constructed, so this case would be vacuous',
      );

      const offenders: string[] = [];
      for (const route of routes) {
        if (route.kind !== 'action') {
          continue;
        }
        if (!requiresConfirmation(route.action.permission)) {
          continue;
        }
        if (!hasStatement(route.action.id)) {
          offenders.push(`${route.action.id} (${route.action.permission})`);
        }
      }
      assertEqual(
        `${ISOLATION} a registered critical Action with no statement is unperformable`,
        offenders.join(' · '),
        '',
      );
    },
  );

  suite.test('every DEFERRED route that Core has a statement for keeps it, and vice versa', () => {
    // A deferred route carries an `actionId` and NO Action object, so its permission is unknown
    // here and its criticality cannot be derived. What CAN be asserted is the correspondence that
    // matters for the day it is built: `customers.DeleteCustomer` is the Action the confirmation
    // fixture stands in for, it is deferred, and a statement for it must exist BEFORE the route
    // does — otherwise the first real critical Action ships unconfirmable, which is the exact
    // history `statements.ts` was re-keyed to prevent.
    const routes = createCustomerRoutes({ businesses: createStoreBusinessDirectory() });
    const deferred = routes
      .filter((route) => route.kind === 'deferred')
      .map((route) => (route as { readonly actionId: string }).actionId);
    assertTrue(
      'there are deferred routes to check',
      deferred.length > 0,
      'no deferred route was constructed',
    );
    assertTrue(
      'the deferred delete is still registered under the id the statement catalog is keyed by',
      deferred.includes('customers.DeleteCustomer'),
      `the deferred routes were: ${deferred.join(', ')} — if the delete was renamed, its ` +
        'statement is now orphaned and the Action is unconfirmable the day it is built',
    );
    assertTrue(
      'and it has a statement waiting for it',
      hasStatement('customers.DeleteCustomer'),
      'customers.DeleteCustomer is contracted, deferred, and critical, and Core has no statement ' +
        'for it — so building it would produce an operation that cannot obtain a challenge',
    );
  });

  suite.test('every gated PLATFORM route has a statement, checked over the shipped table', () => {
    // `assertConfirmationCoverageIsCoherent` already refuses at module load for this, so the case
    // cannot fail without the import having thrown first. It is here because that guard defaults
    // to the shipped table and a suite that only ever imports the module proves nothing about
    // WHICH table was checked — and because a guard that is never independently asserted is one
    // refactor from being a guard nobody notices was removed.
    const offenders = platformRoutes()
      .filter((route) => isConfirmationGated(route))
      .filter((route) => !hasStatement(route.id))
      .map((route) => route.id);
    assertEqual(
      `${ISOLATION} a gated platform route with no statement is permanently unreachable`,
      offenders.join(','),
      '',
    );

    // And the confirmable operations, which are what a challenge may be issued FOR. These are not
    // all routes: `platform.credentials.reset` is confirmable and has no route yet.
    const unstated = confirmableOperations().filter((actionId) => !hasStatement(actionId));
    assertEqual(
      'every confirmable platform operation has a statement',
      unstated.join(','),
      '',
    );
  });

  suite.test(
    "every route's successStatus equals the one ITS CONTRACT declares — compared against the " +
      'contract, never against a claim about it',
    () => {
      // ===================================================================================
      // *** THE CASE THAT WAS MISSING, AND THE DEFECT IT WOULD HAVE CAUGHT WAS REAL. ***
      // ===================================================================================
      //
      // `platform-routes.ts` says every route "declares what its contract's `successStatus`" is.
      // TWO ROUTES SHIPPED AS `200` WITH COMMENTS CLAIMING THE CONTRACT SAID SO, and the contract
      // said 201. `core-agent`'s own words: *"a case comparing the route table to the contracts'
      // declared values would have caught it."* One was found from the client side, by
      // `admin-shell`, which is where a status mismatch surfaces — after it has already shipped.
      //
      // **THE COMPARISON IS AGAINST THE CONTRACT FILE, NOT AGAINST A LIST TYPED HERE.** A table of
      // expected statuses in this file would be a third transcription, and the third transcription
      // is the one that drifts unnoticed — it has no reader who would miss it.
      const declared = new Map<string, number | null>();
      for (const fileName of OPERATION_CONTRACTS) {
        const contract = readFileSync(`${PLATFORM_CONTRACT_DIRECTORY}${fileName}`, 'utf8');
        for (const [operationId, status] of successStatusByOperation(contract)) {
          declared.set(operationId, status);
        }
      }

      // ---- THE FLOOR FIRST, for the reason `sensitivityByOperation`'s neighbour records: an
      // operation whose `successStatus` this reader could not see would drop silently out of the
      // comparison, and the route would then be compared against nothing.
      assertTrue(
        'the contracts were read and declare operations',
        declared.size >= 7,
        `only ${String(declared.size)} operations were parsed from ${String(OPERATION_CONTRACTS.length)} ` +
          'contracts; the reader is indentation-oriented and the layout has probably changed',
      );
      const unreadable = [...declared]
        .filter(([, status]) => status === null)
        .map(([operationId]) => operationId);
      assertEqual(
        `${ISOLATION} every contracted operation declares a successStatus this reader could parse`,
        unreadable.join(','),
        '',
      );

      // ---- EVERY SHIPPED ROUTE AGAINST ITS CONTRACT.
      const mismatches: string[] = [];
      const uncontracted: string[] = [];
      for (const route of platformRoutes()) {
        const expected = declared.get(route.id);
        if (expected === undefined) {
          uncontracted.push(route.id);
          continue;
        }
        if (route.successStatus !== expected) {
          mismatches.push(
            `${route.id}: table says ${String(route.successStatus)}, contract says ${String(expected)}`,
          );
        }
      }
      assertEqual(
        `${ISOLATION} no route's success status differs from its contract's`,
        mismatches.join(' · '),
        '',
      );
      // AND EVERY ROUTE IS CONTRACTED AT ALL. A route the contracts do not mention is one whose
      // status could not have been compared, and it would have passed the loop above in silence.
      assertEqual(
        'and every shipped route appears in one of the platform contracts',
        uncontracted.join(','),
        '',
      );
    },
  );

  suite.test('no statement in the catalog names an operation nothing can perform', () => {
    // THE CONVERSE, AND IT IS THE HALF THAT ROTS QUIETLY. A statement whose operation was renamed
    // or removed sits in the catalog forever, passes every coherence guard, and is text a human
    // will never be shown. It is not dangerous; it is evidence that the catalog and the routers
    // have stopped being read together.
    //
    // `statementCatalogEntries()` exists for exactly this — see its header: the correspondence
    // must be asserted over the WHOLE catalog rather than over the entries somebody remembered.
    const known = new Set<string>([
      ...createCustomerRoutes({ businesses: createStoreBusinessDirectory() }).map((route) =>
        route.kind === 'action'
          ? route.action.id
          : (route as { readonly actionId: string }).actionId,
      ),
      ...platformRoutes().map((route) => route.id),
      ...confirmableOperations(),
    ]);
    const entries = statementCatalogEntries();
    assertTrue(
      'the statement catalog is non-empty',
      entries.length > 0,
      'no statement is defined, so this comparison would be vacuous',
    );
    const orphaned = entries
      .map((entry) => entry.actionId)
      .filter((actionId) => !known.has(actionId));
    assertEqual(
      'every statement names a registered Action, a platform route, or a confirmable operation',
      orphaned.join(','),
      '',
    );
  });

  return suite;
}
