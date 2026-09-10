/**
 * ===========================================================================================
 * DOES A CONTRACT'S DECLARED `requestClass:` AGREE WITH THE REGISTRY CORE ACTUALLY PUTS IT IN?
 * ===========================================================================================
 *
 * *** THIS EXISTS BECAUSE `0039` CLAIMED AN ENFORCEMENT THAT DID NOT EXIST. *** The ADR said the
 * declaration would be checked against the route tables. Nothing checked it. The generator cannot:
 * `architecture.md` §3 forbids `packages/contracts/**` from depending on Core's layout, and
 * `0039`'s own amendment settled that it must not — so the generator announces the declaration as
 * unverified and names the class it is confusable with. **That announcement is honest and it is
 * not a check.** The check is root tooling, and root tooling is the Team Lead's.
 *
 * THE DEFECT IT CATCHES, and it is not hypothetical — it is the measurement `0039` was built on:
 *
 *     FOUR REQUEST CLASSES, THREE BLOCK KEYS, AND `operations:` COVERS TWO OF THEM.
 *
 * `organization-selection-v1` uses `operations:` for SESSION-class routes; ten platform contracts
 * use the same key for PLATFORM-class routes. **So `requestClass: session` and
 * `requestClass: platform` are both accepted by every tool that reads only the contract**, and one
 * of them is wrong on any given file. The class decides whether a permission is evaluated at all
 * (`session` and `pre-auth` evaluate none), so a contract declaring the wrong one publishes a
 * false statement about who may call the route.
 *
 * ===========================================================================================
 * WHY IT IMPORTS THE REGISTRIES RATHER THAN READING THE SOURCE
 * ===========================================================================================
 *
 * The four registries are executed, not parsed: `preAuthEntryPoints()`, `sessionRoutes()`,
 * `platformRoutes()` and `createCoreRouter().routes`. A regex over route tables would be a second
 * implementation of Core's registration, and it would disagree with the first one silently. The
 * Action routes make the point: their ids are literals **inside factory functions**, not in a
 * top-level array, so a check looking for exported tables finds three of four and reports a clean
 * sweep of a corpus it never enumerated.
 *
 * ===========================================================================================
 * THE POPULATION PROBLEM, AND THE SECOND DERIVATION THAT ANSWERS IT
 * ===========================================================================================
 *
 * `workflow.md` §11a: *report the population examined AND an independently-derived expectation.*
 * Importing four named registries examines exactly the routes those four registries hold. **A
 * fifth route table, of a type this file has never heard of, is invisible to it** — and would
 * render as a clean run, which is the failure mode that looks like success.
 *
 * So the ids are derived TWICE, by mechanisms that share nothing:
 *
 *   A  EXECUTED   the four registries, imported and enumerated. Knows the types; knows nothing
 *                 about the files.
 *   B  TEXTUAL    every `id: '<dotted.id>'` and `actionId: '<dotted.id>'` string literal under
 *                 `platform/core/**`. Knows the files; knows nothing about the types.
 *
 * **They must produce the same set, and a disagreement in either direction FAILS.** B-not-A is a
 * route registered somewhere this check does not look. A-not-B is a registry entry whose id is
 * computed rather than written, which this check cannot verify and must not pretend to.
 *
 * A textual sweep can false-positive — an id literal in a comment, a constant, a fixture. If it
 * does, the run goes red and someone has to look. That is deliberate and it is the cheap version
 * of §11a's remedy: **a number that can only be moved deliberately is a number someone reads.**
 *
 * ===========================================================================================
 * WHAT FAILS, AND WHAT IS ONLY REPORTED
 * ===========================================================================================
 *
 *   FAIL   CONTRADICTION      a contract declares class X for an id Core registers in class Y.
 *   FAIL   POPULATION         derivations A and B disagree.
 *   report UNREGISTERED       a contract publishes an id Core does not register. Contracts
 *                             legitimately lead implementation — `platform-operator-v1` says
 *                             "NEW WORK. No implementation exists." on its face.
 *   report UNDECLARED         Core registers an id whose contract declares no `requestClass:`.
 *                             **This is `0039` phase 1 and the count is its phase-3 trigger.**
 *                             It does not fail: requiring the field before the sweep would be the
 *                             refusal-on-arrival mistake `0041` phase 1 exists to avoid.
 *   report UNCONTRACTED       Core registers an id no contract publishes (`platform.health`).
 *
 * ===========================================================================================
 * THE KNOWN-FAILING INPUTS, AND THE MIRROR CONTROL
 * ===========================================================================================
 *
 * Three synthetic comparisons run BEFORE anything real is read, and the run exits non-zero
 * without scanning if any fails to behave:
 *
 *   1. a declared class contradicting the registry            MUST be detected
 *   2. a declared class AGREEING with the registry            MUST NOT be flagged
 *   3. an id present textually and absent from the registries MUST be detected
 *
 * (2) is the mirror control. Without it a check that flagged everything would pass (1) and (3)
 * and be worthless — `workflow.md` §11a, the catalog reader that matched only block-form YAML.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE COMPARISON ITSELF LIVES IN `scripts/lib/request-class.mjs` AND IS IMPORTED, NOT DUPLICATED.
 *
 * **Extracted at `qa-agent`'s request so it can commit the six mutants that verified this check as
 * suite cases**, without the script growing a fixture path or a test-only branch — *"a test-only
 * input path is a second code path the real run never exercises."* **There is one implementation
 * and one path through it; the suite and this file call the same functions.**
 *
 * **And it stops the mutants evaporating.** They live in a session scratchpad, and `workflow.md`
 * §11a records — after a previous scratchpad took a reproduction fixture with it — that **a
 * preserved artifact goes in the repository or it is not preserved.**
 */
import {
  CLASSES,
  ROUTE_ID,
  compare,
  contradiction,
  disagreement,
  idLiteralsIn,
  parseContract,
} from './lib/request-class.mjs';

const CORE_DIR = 'platform/core';
const APPS_DIR = 'apps';
const CONTRACTS_DIR = 'packages/contracts';

// ---- THE KNOWN-FAILING INPUTS AND THE MIRROR CONTROL, before anything real is read. ----
{
  const caught = contradiction('synthetic.a', 'session', 'platform');
  if (caught === null || caught.declared !== 'session' || caught.actual !== 'platform') {
    console.error('SELF-TEST FAILED: a contract declaring the wrong class was not detected.');
    console.error('      Refusing to scan. A check that cannot fail reports success on everything.');
    process.exit(1);
  }
  const agreeing = contradiction('synthetic.b', 'platform', 'platform');
  if (agreeing !== null) {
    console.error('SELF-TEST FAILED: a correctly declared class was flagged as a contradiction.');
    console.error('      This is the mirror control. A check that flags everything is not a check.');
    process.exit(1);
  }
  const gap = disagreement(new Set(['x.y']), new Set(['x.y', 'z.w']));
  if (gap.textualOnly.length !== 1 || gap.textualOnly[0] !== 'z.w') {
    console.error('SELF-TEST FAILED: a route id absent from every known registry was not detected.');
    console.error('      That is the fifth-route-table case, which is the only thing standing');
    console.error('      between this check and a clean report over a corpus it never saw.');
    process.exit(1);
  }
}

// =============================================================================================
// DERIVATION A — the four registries, executed
// =============================================================================================

/** `id -> class`. Built by running Core's own registration, not by reading it. */
const executedClassOf = new Map();

function record(id, className, source) {
  if (typeof id !== 'string' || id.length === 0) return;
  const existing = executedClassOf.get(id);
  if (existing !== undefined && existing.className !== className) {
    console.error(`FAIL: route id '${id}' is registered in TWO classes:`);
    console.error(`      ${existing.className} (${existing.source}) and ${className} (${source}).`);
    console.error('      An id in two classes has two authorization stories and no contract can');
    console.error('      declare both. This is a Core defect, not a contract one.');
    process.exit(1);
  }
  executedClassOf.set(id, { className, source });
}

const preAuth = await import('../platform/core/identity/pre-auth-registry.ts');
for (const entry of preAuth.preAuthEntryPoints()) {
  record(entry.id, 'pre-auth', 'pre-auth-registry.ts');
}

const session = await import('../platform/core/identity/session-routes.ts');
for (const route of session.sessionRoutes()) {
  record(route.id, 'session', 'session-routes.ts');
}

const platform = await import('../platform/core/platform/platform-routes.ts');
for (const route of platform.platformRoutes()) {
  record(route.id, 'platform', 'platform-routes.ts');
}

/**
 * The Action class, through the router rather than through the two factories by name.
 *
 * Importing `createListAuthorizedBusinessesAction` and `createResolveBusinessReferencesAction`
 * directly would work today and would be invisible to the third Action. `createCoreRouter()` is
 * what Core actually builds, so a route added to `coreRoutes()` appears here without this file
 * being touched — which is the difference between a check and a snapshot.
 */
const core = await import('../platform/core/http/core-routes.ts');
for (const route of core.createCoreRouter().routes) {
  if (route.kind === 'action') record(route.action?.id, 'action', 'core-routes.ts');
  else if (route.kind === 'deferred') record(route.actionId, 'action', 'core-routes.ts (deferred)');
}

/**
 * THE CUSTOMERS APP — THE FIFTH REGISTRY, AND THE ONE THIS FILE ORIGINALLY MISSED.
 *
 * `0039` names two Action tables and the first version of this check enumerated one. Both of its
 * derivations were scoped to `platform/core/**`, **so they agreed while missing the same ten route
 * ids** — and agreement was the whole argument that the population was covered.
 *
 * > **TWO DERIVATIONS THAT SHARE A SCOPE ARE ONE DERIVATION.** They disagree about method and
 * > agree about blindness, and the blindness is what a population check is for.
 *
 * The dependency is stubbed. `createCustomerRoutes` only CAPTURES it — the directory is read by
 * handlers, and no handler runs here — so a stub is enough to enumerate ids and would throw rather
 * than mislead if that stopped being true.
 *
 * **A SIXTH APP IS NOT SILENTLY MISSED, and that is the part that had to change rather than the
 * count.** Derivation B sweeps `apps/**` as well, so the next App's route ids appear textually with
 * no registry holding them, and the run goes RED naming them. **The list of registries is a
 * snapshot; being told the snapshot is stale is not.**
 */
const customers = await import('../apps/customers/api/routes.ts');
const stubDependencies = {
  businesses: new Proxy({}, {
    get() {
      throw new Error(
        'check-request-class stubbed BusinessDirectory and something read it at construction time. ' +
        'Enumerating route ids must not need a live dependency; give this check a real one or ' +
        'move the read into the handler.',
      );
    },
  }),
};
for (const route of customers.createCustomerRoutes(stubDependencies)) {
  if (route.kind === 'action') record(route.action?.id, 'action', 'apps/customers/api/routes.ts');
  else if (route.kind === 'deferred') {
    record(route.actionId, 'action', 'apps/customers/api/routes.ts (deferred)');
  }
}

if (executedClassOf.size === 0) {
  console.error('FAIL: the four registries produced ZERO route ids.');
  console.error('      That is the floor. An empty comparison does not fail — it reports success,');
  console.error('      which is the most confident wrong answer a check can give.');
  process.exit(1);
}

// =============================================================================================
// DERIVATION B — every dotted route-id literal under platform/core, textually
// =============================================================================================

function filesUnder(dir, suffix, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(full);
  }
  return found;
}

/**
 * **THE SWEPT SCOPE IS THE WHOLE GUARD, AND THE ID COUNTS ARE ONLY THE SYMPTOM.** `qa-agent`
 * corrected the Team Lead on this and the correction is load-bearing: derivations A and B agreed at
 * 24 while the real number was 34, **because both were pointed at `platform/core` alone.** An
 * independent id count cannot disagree without first sweeping different files — so what has to be
 * checked against an independent expectation is `sweptFiles.length`, not the ids.
 *
 * **The scope comes from the ownership table** — routes are registered in Core and in installable
 * Apps — **not from this file's own choice of directories**, which is what makes an outside `find`
 * over the same two trees a real second opinion rather than a restatement.
 */
const textualIds = new Set();
const sweptFiles = [...filesUnder(CORE_DIR, '.ts'), ...filesUnder(APPS_DIR, '.ts')];
for (const file of sweptFiles) {
  for (const id of idLiteralsIn(readFileSync(file, 'utf8'))) textualIds.add(id);
}

const gap = disagreement(new Set(executedClassOf.keys()), textualIds);

// =============================================================================================
// The contract side — declared class, and the ids published under a publishing block
// =============================================================================================

/**
 * A line-oriented reader, and its narrowness is stated rather than hidden. **There is no YAML
 * parser in this repository** — no npm package is approved.
 *
 * IT TRACKS THE TOP-LEVEL BLOCK, WHICH `check-route-fields.mjs` DOES NOT NEED TO AND THIS DOES.
 * `openQuestions:` holds `- id: TA-1` at the same indent as `operations:` holds `- id: core.X`.
 * That checker drops the strays later because they carry no `schemaRef`; this one would attribute
 * a request class to `TA-1`. So the block is the scope, not the indent.
 *
 * *** IT READS THE PER-OPERATION DECLARATION AS WELL AS THE CONTRACT-LEVEL ONE, AND THERE ARE
 * *** ZERO OF THE FORMER TODAY. *** `0039` allows the field per operation *"where a contract spans
 * classes"*, and `confirmation-v1` is that contract: it publishes a platform-class challenge route
 * and an Action-class one, under a single `requestClass: platform`, with a COMMENT saying the
 * Action route will carry its own value when it lands.
 *
 * **Reading only the contract level would work today and be wrong on the day that comment is
 * acted on** — the per-operation value would land, this check would keep applying the file-level
 * one, and it would report agreement it had not tested. `workflow.md` §12: prose describes,
 * machine-readable fields instruct, and a checker that reads the wrong field is worse than one
 * that reads nothing, because it answers.
 */
const contracts = filesUnder(CONTRACTS_DIR, '.contract.yaml').map((file) => ({
  file,
  ...parseContract(readFileSync(file, 'utf8')),
}));

/**
 * A FLOOR ON THE READER, ADDED AFTER IT WAS EARNED. `workflow.md` §11a.
 *
 * The three self-tests above drive `contradiction()` and `disagreement()` — pure functions over
 * ids someone else supplied. **The first version of this file had a one-character bug in the
 * extractor** (it stored the regex match instead of its capture group) and every self-test passed,
 * every count printed, and the run exited **0** announcing *"10 declared route ids agree"* and
 * *"0 still undeclared"*. Both numbers were meaningless.
 *
 * **The known-failing inputs could not catch it, because the defect was in what the check could
 * SEE rather than in what it did with what it saw** — §11a's own distinction, and the reason a
 * floor and a negative control are two remedies rather than one.
 *
 * So the extractor's output is shape-checked against the grammar every route id in this repository
 * obeys. A malformed id is a reader defect, not a contract defect, and it fails here rather than
 * being quietly compared against a registry that will never contain it.
 */
const { contradictions, unregistered, unknownClasses, malformed, skipped, spans, undeclared, uncontracted, declaredIds } =
  compare(contracts, executedClassOf);

for (const miss of skipped) {
  console.error(`FAIL: this checker's reader SKIPPED an operation id it could not parse.`);
  console.error(`      ${miss.file}`);
  console.error(`      ${JSON.stringify(miss.id)}`);
  console.error('');
  console.error('      A `- id:` line inside a publishing block that the strict pattern does not');
  console.error('      match is an operation this tool CANNOT SEE — and it shrinks every count');
  console.error('      here rather than appearing anywhere, so the run reads as complete.');
  console.error('      THIS HAPPENED: `platform.organizations.set-template` carries a hyphen, the');
  console.error('      id pattern did not allow one, and four of five new operations were reported');
  console.error('      while the fifth was invisible. Widen the pattern in scripts/lib/');
  console.error('      request-class.mjs — this is a READER defect, never a contract one.');
  process.exit(1);
}

for (const bad of malformed) {
  console.error(`FAIL: read a malformed operation id from ${bad.file}:`);
  console.error(`      ${JSON.stringify(bad.id)}`);
  console.error('      That is the READER failing, not the contract. An id that matches no registry');
  console.error('      entry compares clean against everything, so a broken reader exits 0 and');
  console.error('      reports agreement it never tested. That happened once, on this file.');
  process.exit(1);
}

for (const bad of unknownClasses) {
  console.error(`FAIL: ${bad.file} declares \`requestClass: ${bad.className}\`,`);
  console.error(`      which is not one of ${Object.keys(CLASSES).join(', ')}.`);
  console.error('      An unknown class is refused rather than ignored — an ignored declaration');
  console.error('      is worse than an absent one, because it looks like it was honoured.');
  process.exit(1);
}

if (contracts.length > 0 && contracts.every((c) => c.operations.length === 0)) {
  console.error(`FAIL: read ${contracts.length} contracts and extracted ZERO published operations.`);
  console.error('      The block keys or the entry form have changed. An empty contract side');
  console.error('      contradicts nothing and would report every declaration as agreeing.');
  process.exit(1);
}

// =============================================================================================
// The report — population against an independently derived expectation, never a bare count
// =============================================================================================

const perClass = Object.keys(CLASSES).map((name) => {
  const count = [...executedClassOf.values()].filter((v) => v.className === name).length;
  return `${name}=${count}`;
});

console.log('0039 — declared request class vs the registry Core puts the route in');
console.log('');
console.log(`  source files swept ............. ${sweptFiles.length}   (platform/core + apps)`);
console.log(`  route ids, EXECUTED (A) ........ ${executedClassOf.size}   ${perClass.join(' · ')}`);
console.log(`  route ids, TEXTUAL  (B) ........ ${textualIds.size}`);
console.log(`  contracts read ................. ${contracts.length}`);
console.log(`  contracts declaring a class .... ${contracts.filter((c) => c.contractClass !== undefined).length}`);
console.log(`  per-operation declarations ..... ${contracts.flatMap((c) => c.operations).filter((o) => o.ownClass !== undefined).length}`);

/**
 * **THE PHASE-3 POPULATION IS PER OPERATION, NOT PER CONTRACT, and the two counts diverge on a
 * contract that spans classes.** `confirmation-v1` declares both its operations on their own lines
 * and carries no contract-level value — so a per-CONTRACT counter calls it undeclared while every
 * operation in it is classified. Counted the other way round, a contract-level class covering an
 * operation it does not fit counts as declared, which is the defect that produced the per-operation
 * form in the first place.
 *
 * **Printed here because this check told `architecture-agent` to fix exactly this in its own
 * counter, and a report that made the same mistake would be worth nothing as an instruction.**
 */
const allOperations = contracts.flatMap((c) =>
  c.operations.map((o) => o.ownClass ?? c.contractClass),
);
const classified = allOperations.filter((c) => c !== undefined).length;
console.log(`  published operations classified  ${classified} of ${allOperations.length}   <- the phase-3 population`);
console.log(`  declared ids compared .......... ${declaredIds.size}`);
console.log('');

let failed = false;

if (gap.textualOnly.length > 0 || gap.executedOnly.length > 0) {
  failed = true;
  console.error('FAIL: derivations A and B disagree about which route ids exist.');
  for (const id of gap.textualOnly) {
    console.error(`  TEXTUAL ONLY   ${id}`);
  }
  if (gap.textualOnly.length > 0) {
    console.error('      Written in platform/core and held by none of the four registries this');
    console.error('      check enumerates. Either a fifth route table exists — in which case this');
    console.error('      file must learn it, and every clean run before now covered less than it');
    console.error('      claimed — or the literal is not a route id and the sweep needs narrowing.');
  }
  for (const id of gap.executedOnly) {
    console.error(`  EXECUTED ONLY  ${id}`);
  }
  if (gap.executedOnly.length > 0) {
    console.error('      Registered with an id this check cannot find written down, so it is');
    console.error('      computed rather than declared. Derivation B cannot see it and must not');
    console.error('      pretend to; the id belongs in a literal or this check needs a third anchor.');
  }
  console.error('');
}

if (contradictions.length > 0) {
  failed = true;
  console.error('FAIL: a contract declares a request class Core does not put the route in.');
  for (const c of contradictions) {
    const declared = CLASSES[c.declared];
    const actual = CLASSES[c.actual];
    console.error(`  ${c.id}`);
    console.error(`      contract says   requestClass: ${c.declared}   (${declared.record}, evaluates permission: ${declared.evaluatesPermission})`);
    console.error(`      Core registers  ${c.actual}   (${actual.record}, evaluates permission: ${actual.evaluatesPermission}) in ${c.source}`);
    console.error(`      ${c.file}`);
    if (declared.evaluatesPermission !== actual.evaluatesPermission) {
      console.error('      *** THE TWO DISAGREE ABOUT WHETHER A PERMISSION IS EVALUATED AT ALL. ***');
      console.error('      This is not a labelling slip. One of the two states who may call this');
      console.error('      route, and the contract is the half a client reads.');
    }
  }
  console.error('');
  console.error('      ONE OF THE TWO IS WRONG AND THIS CHECK DOES NOT GUESS WHICH. The contract');
  console.error('      is normative; Core is what runs. Decide deliberately and record it.');
  console.error('');
}

const ordinary = unregistered.filter((u) => !u.blockKeyContradicts);
const noTool = unregistered.filter((u) => u.blockKeyContradicts);

if (ordinary.length > 0) {
  console.log('Published with a class, not registered in Core — contracts may lead implementation:');
  for (const u of ordinary) {
    console.log(`  ${u.id}  (declared ${u.declared}, from ${u.from})  ${u.file}`);
  }
  console.log('');
  console.log('  UNCHECKED, NOT AGREED. Core registers none of these, so the declaration is a');
  console.log('  statement about a route that does not exist and nothing here can falsify it.');
  console.log('  It becomes checkable the day the route lands — which is the direction that');
  console.log('  matters, because that is when a wrong class starts refusing real callers.');
  console.log('');
}

if (noTool.length > 0) {
  console.log('*** VERIFIED BY NEITHER TOOL — not a failure, and not covered by anything: ***');
  for (const u of noTool) {
    console.log(`  ${u.id}`);
    console.log(`      declared ${u.declared} (expects a \`${CLASSES[u.declared].blockKey}:\` block) in a \`${u.blockKey}:\` block`);
    console.log(`      ${u.file}`);
  }
  console.log('');
  console.log('  THE GENERATOR SKIPS THESE AND THIS CHECK CANNOT REACH THEM, AND BOTH ARE RIGHT.');
  console.log('  The generator has a block-key heuristic and correctly stops applying it to an');
  console.log('  operation carrying its own declaration: a contract that SPANS classes cannot have');
  console.log('  one block key matching all of them, which is the case 0039 allows the');
  console.log('  per-operation form for. This check compares a declared class against the registry');
  console.log('  Core puts the route in — and an unregistered route is in no registry.');
  console.log('');
  console.log('  So the one operation the skip was introduced for is verified by neither tool.');
  console.log('  It is printed rather than folded into the benign list above, because a category');
  console.log('  absorbs the one entry that does not belong to it and does so silently.');
  console.log('  It becomes checkable here the day the route is registered.');
  console.log('');
}

if (spans.length > 0) {
  console.log('One contract-level class covering several operations — a DEFAULT, not a ruling:');
  for (const s of spans) console.log(`  ${s.file}\n      requestClass: ${s.className}  →  ${s.ids.join(', ')}`);
  console.log('');
  console.log('  Not a failure and not nothing. `0039` allows the field per operation precisely');
  console.log('  because a contract can span classes, and a file-level value silently asserts one');
  console.log('  class about every operation under it.');
  console.log('');
  console.log('  THE WORKED EXAMPLE HAS ALREADY BEEN FIXED AND IS WHY THIS REPORT EXISTS.');
  console.log('  confirmation-v1 carried a contract-level `platform` over two operations, one of');
  console.log('  which its own COMMENT said would be Action-class when it landed. The comment');
  console.log('  instructed nobody; the field instructed the generator. It now declares per');
  console.log('  operation and no longer appears in this list. A contract that knows it spans');
  console.log('  should say so on the operation — this check reads that field, so it costs nothing.');
  console.log('');
}

if (undeclared.length > 0) {
  console.log(`0039 phase 1 — registered and published, no \`requestClass:\` on the contract (${undeclared.length}):`);
  for (const id of undeclared) console.log(`  ${id}  → Core registers it as ${executedClassOf.get(id).className}`);
  console.log('');
  console.log('  These are what the sweep still owes. When this list is empty, `requestClass:` can');
  console.log('  be made REQUIRED in packages/contracts/generator/generate-types.mjs — and only');
  console.log('  then, because a required field nothing validates spreads an unenforceable');
  console.log('  declaration with the appearance of enforcement. THIS FILE IS THAT VALIDATION.');
  console.log('');
}

if (uncontracted.length > 0) {
  console.log(`Registered in Core, published by no contract (${uncontracted.length}):`);
  for (const id of uncontracted) console.log(`  ${id}  (${executedClassOf.get(id).className})`);
  console.log('');
}

if (failed) process.exit(1);

console.log(`OK — ${declaredIds.size} declared route ids agree with the registry Core puts them in.`);
console.log('     A green here means every DECLARED class is true. It says nothing about the');
console.log(`     ${undeclared.length} still undeclared, which are counted above rather than assumed.`);
