/**
 * ===========================================================================================
 * A PLATFORM ROUTE'S DECLARED `maxRowWrites` MUST BE AT LEAST WHAT THE DISPATCHER CHARGES.
 * ===========================================================================================
 *
 * THE DEFECT THIS EXISTS FOR, AND IT IS NOT HYPOTHETICAL.
 *
 * `PLATFORM_OPERATOR_ACTION_ROW_WRITES` was **2** when the platform contracts were written.
 * `0016_platform_operator_action_indexes.sql` moved it to **4** — its own comment saying the
 * constant *"is moved in `identity/control-plane-admission.ts` in the same change."* The constant
 * moved. **Nine contract figures did not, and nothing compared them, so nothing went red.**
 *
 * It was found on 2026-09-11 by `security-agent`, which derived a free-tier exhaustion threshold
 * from a contract's declared `2` instead of from the constant and **sent the Team Lead figures that
 * were wrong by a factor of two** — in the PESSIMISTIC direction, which `workflow.md` §11a records
 * is the one nobody catches, because acting on it always looks like the safe choice.
 *
 * **THE TWO-OFF IS WHAT DISGUISED IT.** A route declaring 3 against a reservation of 4 reads as a
 * rounding difference rather than as a stale constant, so the write routes looked consistent and
 * `usage`'s 2 looked like the outlier. Every one of them was understated by the same 2.
 *
 * This is `workflow.md` §12's value-change limit exactly: *a symbol that MOVES is caught by the
 * compiler; a symbol whose VALUE moves is caught by nobody.* The migration did its half and there
 * was nothing to collect the other.
 *
 * ===========================================================================================
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY CANNOT
 * ===========================================================================================
 *
 * **A LOWER BOUND, AND ONLY A LOWER BOUND.** Every platform-class route writes at least the P4
 * audit record, so `maxRowWrites >= PLATFORM_OPERATOR_ACTION_ROW_WRITES` must hold. That is
 * mechanically checkable from two sources this script reads.
 *
 * **IT CANNOT CHECK THE UPPER HALF, AND SAYING SO IS THE POINT.** `maxRowWrites` is the route's own
 * writes PLUS the audit record, and **nothing in this repository knows a route's own write count** —
 * that is a fact about a handler's SQL, not about a declaration. So a route whose true cost is 6 and
 * which declares 4 passes here. **This check catches a figure that is impossibly low. It does not
 * verify a figure that is merely wrong.**
 *
 * Recorded because `workflow.md` §11a is explicit that a check must state what it never reaches:
 * the skip-set is invisible by construction, and an author cannot re-read something they did not
 * write. **The unchecked half is the difference between the bound and the truth.**
 *
 * ===========================================================================================
 * THE POPULATION, AND THE THREE CONTRACTS THAT MUST NOT BE SWEPT
 * ===========================================================================================
 *
 * P4 applies to the **platform** request class and to nothing else. `architecture-agent` named the
 * three that legitimately declare figures outside it, and getting this wrong in the other direction
 * would be worse than the defect:
 *
 *   `audit-read-v1`, `business-read-v1`        declare 0 — TENANT ACTIONS, P4 does not apply
 *   `organization-selection-v1`                declares 3 — SESSION class, also outside P4
 *
 * **So the discriminator is the declared request class (`0039`), never the file path.** A check
 * keyed on *"contracts under `core/platform/`"* would sweep the session contract and miss any future
 * platform route published elsewhere. The class is what P4 is about.
 *
 * **AND A ROUTE WITH NO DECLARED CLASS IS REPORTED, NOT ASSUMED.** Ten contracts still carry no
 * `requestClass:` (`0039` phase 1). Treating an undeclared route as out of scope would make this
 * check quietly narrower every time someone forgets the field — the fail-open shape. They are
 * printed as UNCLASSIFIED and counted, so the population is visible rather than implied.
 *
 * ===========================================================================================
 * ONE PARSE, TWO CONSUMERS
 * ===========================================================================================
 *
 * It reuses `parseContract` from `scripts/lib/request-class.mjs` rather than reading the YAML again.
 * **A second contract parser would be the defect this check exists for, one layer up** — two readers
 * of one file, agreeing until they do not (`§11a`, *two derivations that share a scope are one
 * derivation*).
 *
 * And it reads the constant **from `control-plane-admission.ts`**, never a copy. The day someone
 * moves it again, these contracts go red instead of diverging silently for a second time.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { parseContract } from './lib/request-class.mjs';

const CONTRACTS_DIR = 'packages/contracts';
const CONSTANT_FILE = 'platform/core/identity/control-plane-admission.ts';
const CONSTANT_NAME = 'PLATFORM_OPERATOR_ACTION_ROW_WRITES';

function contractsUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...contractsUnder(path));
      continue;
    }
    if (entry.name.endsWith('.contract.yaml')) found.push(path);
  }
  return found;
}

/**
 * The charge, read from Core rather than held here.
 *
 * IT REFUSES RATHER THAN DEFAULTING. A missing constant means the file moved or was renamed, and a
 * check that fell back to a literal would be asserting against its own copy — which is the defect.
 */
function readCharge() {
  const source = readFileSync(CONSTANT_FILE, 'utf8');
  const match = new RegExp(`export const ${CONSTANT_NAME}\\s*=\\s*(\\d+)`, 'u').exec(source);
  if (match === null) {
    console.error(`FAIL: could not read ${CONSTANT_NAME} from ${CONSTANT_FILE}.`);
    console.error('  The constant is the authority for every figure below. Without it this check');
    console.error('  would be comparing contracts against a number of its own, which is the exact');
    console.error('  duplication that produced the defect it exists to catch. Refusing to run.');
    process.exit(2);
  }
  return Number(match[1]);
}

/**
 * ===========================================================================================
 * THE SELF-TEST. It runs BEFORE anything real is read, and the script refuses to report if it
 * does not fire.
 * ===========================================================================================
 *
 * `workflow.md` §11a: *a check ships with a known-failing input, or it has not been verified —
 * only observed.* This one was **run against the real broken state first** (two routes declaring
 * `0`, exit 1) and that is a stronger instrument than any fixture — **but the real broken state is
 * gone the moment it is repaired, and only the fixture survives to catch a regression.** They are
 * different instruments: the broken state found the unknown, the fixture guards the known.
 *
 * **AND THE FLOOR IS ON THE READER, NOT ONLY ON THE RESULT.** `check-request-class.mjs` exited 0
 * announcing *"10 declared route ids agree"* while a one-character extractor bug meant every id
 * arrived malformed — all three of its self-tests passed, because they drove the pure comparison
 * and the defect was in what the check could SEE. Here the equivalent failure is silent and worse:
 * if the `maxRowWrites` pattern stops matching, every route lands in `missing`, **which this script
 * reports and does not fail on** — so a broken reader would print `OK` over a corpus it never read.
 * Case (5) is the one that catches that.
 */
function selfTest(chargeForTest) {
  const fixture = [
    'requestClass: platform',
    'operations:',
    '  - id: fixture.below',
    '    maxRowWrites: 2',
    '  - id: fixture.exact',
    '    maxRowWrites: 4',
    '  - id: fixture.above',
    '    maxRowWrites: 9',
    '  - id: fixture.undeclared',
    '    successStatus: 200',
    '  - id: fixture.session',
    '    requestClass: session',
    '    maxRowWrites: 0',
  ].join('\n');

  const parsed = parseContract(fixture);
  const byId = new Map(parsed.operations.map((entry) => [entry.id, entry]));
  const failures = [];

  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`${label}: expected ${String(wanted)}, got ${String(actual)}`);
  };

  // (1)-(3) THE READER. A pattern that stops matching makes every one of these `undefined`.
  expect('reads a low figure', byId.get('fixture.below')?.maxRowWrites, 2);
  expect('reads an exact figure', byId.get('fixture.exact')?.maxRowWrites, 4);
  expect('reads a high figure', byId.get('fixture.above')?.maxRowWrites, 9);

  // (4) THE COMPARISON, on the value the reader produced rather than on a literal.
  expect('flags below the charge', byId.get('fixture.below').maxRowWrites < chargeForTest, true);
  expect('does not flag the exact charge', byId.get('fixture.exact').maxRowWrites < chargeForTest, false);

  // (5) ABSENCE IS `undefined`, NEVER 0. A reader returning 0 for a missing field would flag every
  //     route that simply does not declare one — and a reader returning `undefined` for a present
  //     field makes the whole corpus vanish into `missing` while the script prints OK.
  expect('an absent figure is undefined', byId.get('fixture.undeclared')?.maxRowWrites, undefined);

  // (6) SCOPE. The per-operation class must override the contract's, or a session route inside a
  //     platform contract would be swept — the direction that is WORSE than missing one.
  expect('per-operation class wins', byId.get('fixture.session')?.ownClass, 'session');
  expect('contract class is read', parsed.contractClass, 'platform');

  if (failures.length > 0) {
    console.error('FAIL: the self-test did not hold. Refusing to report on the real corpus.\n');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(2);
  }
  return failures.length === 0;
}

const charge = readCharge();

if (!selfTest(charge)) {
  console.error('FAIL: self-test did not run.');
  process.exit(2);
}

const files = contractsUnder(CONTRACTS_DIR);

if (files.length < 10) {
  console.error(`FAIL: found only ${files.length} contracts under ${CONTRACTS_DIR}/.`);
  console.error('  A walk that stops finding contracts reports every route as compliant, which is');
  console.error('  the empty-list reader (`workflow.md` §11a). Refusing to report on a short walk.');
  process.exit(2);
}

const platform = [];
const unclassified = [];
const other = [];

for (const file of files) {
  const parsed = parseContract(readFileSync(file, 'utf8'));
  for (const operation of parsed.operations) {
    const declaredClass = operation.ownClass ?? parsed.contractClass;
    const entry = { file, ...operation, declaredClass };
    if (declaredClass === 'platform') platform.push(entry);
    else if (declaredClass === undefined) unclassified.push(entry);
    else other.push(entry);
  }
}

const missing = platform.filter((entry) => entry.maxRowWrites === undefined);
const measured = platform.filter((entry) => entry.maxRowWrites !== undefined);
const below = measured.filter((entry) => entry.maxRowWrites < charge);

console.log(`row writes — declared cost vs the charge the dispatcher actually applies\n`);
console.log(`  ${CONSTANT_NAME} .......... ${String(charge)}   (read from ${CONSTANT_FILE})`);
console.log(`  contracts walked ....................... ${String(files.length)}`);
console.log(`  operations, platform class ............. ${String(platform.length)}`);
console.log(`    of those, declaring maxRowWrites ..... ${String(measured.length)}`);
console.log(`    of those, BELOW the charge ........... ${String(below.length)}`);
console.log(`  operations, other declared classes ..... ${String(other.length)}   (P4 does not apply)`);
console.log(`  operations, NO declared class .......... ${String(unclassified.length)}   (0039 phase 1)`);

if (unclassified.length > 0) {
  console.log(`\nUNCLASSIFIED — not checked, and listed rather than silently skipped:`);
  for (const entry of unclassified) console.log(`  ${entry.id}  (${entry.file})`);
  console.log(`  A route with no declared class is UNCHECKED, which is a different state from`);
  console.log(`  compliant. When 0039 phase 3 lands this list is empty and the population is whole.`);
}

if (below.length > 0) {
  console.error(`\nFAIL: ${String(below.length)} platform route(s) declare a cost below the charge.\n`);
  for (const entry of below) {
    console.error(`  ${entry.id}`);
    console.error(`      declares ${String(entry.maxRowWrites)}, dispatcher charges ${String(charge)}   ${entry.file}`);
  }
  console.error(`\n  EVERY platform route writes the P4 audit record, so a figure below ${String(charge)} is`);
  console.error(`  impossible rather than merely optimistic. A ZERO is the sharper case: it claims a`);
  console.error(`  platform route performs no writes at all.`);
  console.error(`\n  THIS IS A LOWER BOUND. A figure at or above ${String(charge)} is not thereby correct —`);
  console.error(`  maxRowWrites is the route's own writes PLUS the audit record, and nothing here`);
  console.error(`  knows a handler's own write count. Read the route before trusting a passing figure.`);
  process.exit(1);
}

if (missing.length > 0) {
  console.log(`\nPlatform routes with no maxRowWrites declared (${String(missing.length)}) — reported, not failed:`);
  for (const entry of missing) console.log(`  ${entry.id}  (${entry.file})`);
}

console.log(`\nrow writes: OK — every platform route declares at least the dispatcher's charge.`);
console.log(`     This is a LOWER BOUND and not a verification. It catches a figure that is`);
console.log(`     impossibly low; it cannot catch one that is merely wrong, because a route's own`);
console.log(`     write count is a fact about its SQL rather than about any declaration.`);
