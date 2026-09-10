/**
 * ===========================================================================================
 * EVERY JSON FILE UNDER `packages/contracts/**` PARSES. NOT ONLY THE ONES SOMETHING IMPORTS.
 * ===========================================================================================
 *
 * *** THE DEFECT THIS EXISTS FOR HAPPENED TODAY, AND IT WAS CAUGHT BY LUCK OF REFERENCE. ***
 *
 * Two `$comment` blocks were appended to `template-v1.schema.json` without the comma that must
 * follow a property value. The file stopped being JSON. It surfaced as **six** refusals from the
 * type generator — one `GEN_SCHEMA_UNREADABLE` and five `GEN_UNRESOLVABLE_REF`, because
 * `template-lifecycle-v1` resolves five URNs into the file that would not parse.
 *
 * **It surfaced ONLY because something referenced it.** `buildSchemaIndex` reports an unparseable
 * schema when the emitter opens it, and the emitter opens what an admitted contract imports.
 *
 * > **A malformed schema that nothing references yet is invisible to the entire toolchain.** The
 * > registries are exactly that shape: `app-manifest.schema.json` and
 * > `capability-manifest.schema.json` are referenced by no contract, the generator never opens
 * > them, and **both were edited today.** A comma dropped there would have sat undetected until
 * > the App runtime landed and something finally imported them.
 *
 * ===========================================================================================
 * WHY THIS IS ROOT TOOLING AND NOT A DISCIPLINE
 * ===========================================================================================
 *
 * `architecture-agent` owns `packages/contracts/**` and **has no Bash tool** — Read, Write, Edit,
 * Glob, Grep. **It cannot parse a file, ever.** The Team Lead told it to "parse the file after
 * editing" and it correctly refused the advice: `workflow.md` §11a, *a refusal that names a remedy
 * the tool does not accept is a refusal with no exit.*
 *
 * What that agent CAN do is a shape-driven `Grep` — a line ending in a bare `"` followed by a line
 * beginning with `"`, which cannot occur in a well-formed JSON object — and it has adopted that
 * unconditionally after any schema edit. **It named its own limit: that sweep catches this defect
 * class and would miss an unbalanced brace.** So the discipline is real, weaker than a parser, and
 * honestly scoped.
 *
 * **This check is the parser it cannot run.** It is sited here because the party that can execute a
 * remedy owns it.
 *
 * ===========================================================================================
 * THE POPULATION, AND WHY IT IS DERIVED TWICE
 * ===========================================================================================
 *
 * `workflow.md` §11a: report the population examined against an independently derived expectation.
 * **A glob that stops matching reports zero unparseable files, which is indistinguishable from
 * success.** So the count of files walked is printed and asserted against a floor, and a run that
 * examines nothing FAILS rather than passing perfectly.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACTS_DIR = 'packages/contracts';

/** Every JSON file, not only `*.schema.json` — a malformed `manifest.json` is the same defect. */
function jsonFilesUnder(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) jsonFilesUnder(full, found);
    else if (entry.name.endsWith('.json')) found.push(full);
  }
  return found;
}

/**
 * The pure half: does this text parse, and if not, where?
 *
 * Exported shape kept simple deliberately — the known-failing input below drives THIS function, so
 * a check that stopped detecting malformed input would fail before it examined anything real.
 */
function parseResult(source) {
  try {
    JSON.parse(source);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

// ---- THE KNOWN-FAILING INPUT AND ITS MIRROR, before anything real is read. ----
{
  const broken = parseResult('{ "a": "x" "b": "y" }'); // the exact defect: no comma after a value
  if (broken.ok) {
    console.error('SELF-TEST FAILED: a missing comma was not detected.');
    console.error('      Refusing to scan. A parser that accepts everything reports every file clean.');
    process.exit(1);
  }
  const fine = parseResult('{ "a": "x", "b": "y" }');
  if (!fine.ok) {
    console.error('SELF-TEST FAILED: well-formed JSON was rejected.');
    console.error('      This is the mirror control. A check that fails everything is not a check.');
    process.exit(1);
  }
}

const files = jsonFilesUnder(CONTRACTS_DIR);

/**
 * THE FLOOR. A glob that stops matching, a renamed directory, or a wrong working directory all
 * produce "zero unparseable files", which reads exactly like success.
 *
 * 20 rather than a round number: the corpus held 20 `*.schema.json` plus app manifests when this
 * was written. It is a floor, not a target — it fails downward only.
 */
if (files.length < 20) {
  console.error(`FAIL: found only ${files.length} JSON files under ${CONTRACTS_DIR}/.`);
  console.error('      That is below the floor and almost certainly means this ran from the wrong');
  console.error('      directory or the tree moved — NOT that the corpus shrank. An empty walk');
  console.error('      reports every file parsing, which is the most confident wrong answer here.');
  process.exit(1);
}

const broken = [];
for (const file of files) {
  const result = parseResult(readFileSync(file, 'utf8'));
  if (!result.ok) broken.push({ file, message: result.message });
}

console.log(`JSON parse — every file under ${CONTRACTS_DIR}/, referenced or not`);
console.log('');
console.log(`  JSON files examined ..... ${files.length}`);
console.log(`  unparseable ............. ${broken.length}`);
console.log('');

if (broken.length > 0) {
  for (const bad of broken) {
    console.error(`FAIL: ${bad.file}`);
    console.error(`      ${bad.message}`);
  }
  console.error('');
  console.error('      A malformed schema breaks far more than itself: one unreadable file took out');
  console.error('      five URN references from a second contract on 2026-09-10, reported as six');
  console.error('      contract deficiencies where there was one cause.');
  console.error('');
  console.error('      AND THIS CHECK EXISTS BECAUSE THE GENERATOR CANNOT COVER IT: it opens only');
  console.error('      what an admitted contract imports, so a malformed registry schema — which no');
  console.error('      contract references — is invisible to it. Fix the file; do not widen this.');
  process.exit(1);
}

/**
 * Files with no `*.contract.yaml` sibling of the same stem — the ones no contract can reference by
 * URN, and therefore the ones the generator never opens. **Derived, not asserted**: an earlier
 * version of this line printed the total twice and read as though every file were unreferenced.
 */
const unreferenced = files.filter((file) => {
  const stem = file.replace(/\.schema\.json$|\.json$/u, '');
  return !existsSync(`${stem}.contract.yaml`);
}).length;

console.log(`OK — all ${files.length} parse, including ${unreferenced} with no contract beside them.`);
console.log(`     Those ${unreferenced} are the ones the generator never opens, which is the gap`);
console.log('     this check exists to close.');
console.log('     This says the files are well-formed JSON. It says NOTHING about whether they are');
console.log('     valid JSON Schema, or whether anything executes them — nothing in this repository');
console.log('     does (packages/contracts/README.md).');
