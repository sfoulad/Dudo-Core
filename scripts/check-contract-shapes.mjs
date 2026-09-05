/**
 * ===========================================================================================
 * UNSATISFIABLE REQUEST SHAPES IN THE CONTRACT SET.
 * ===========================================================================================
 *
 * An object with `additionalProperties: false` whose `required` list names a field its
 * `properties` block does not declare CANNOT BE SATISFIED BY ANY REQUEST. Every request must
 * carry the field; no request may carry an undeclared one. There is no valid input.
 *
 * NOTHING IN THIS REPOSITORY EXECUTES JSON SCHEMA — `packages/contracts/README.md` records that
 * there is no implementation and no validator. So this class is invisible to `typecheck`,
 * invisible to every suite, and invisible to review, because `required` and `properties` are read
 * separately and EACH LOOKS CORRECT ALONE.
 *
 * FOUR REAL INSTANCES ON THE DAY THIS WAS WRITTEN (2026-09-05):
 *
 *   platform-operators-v1  revokeOperatorInput   `required` renamed, property left behind —
 *                                                on a route committed an hour earlier
 *   credential-reset-v1    resetCredentialInput  required six, declared three — pre-existing,
 *                                                and `core-agent` was mid-build against it
 *   confirmation-v1        (same pass)
 *   login-v1               loginCompleteRequest  requires `email` and `derived_key`, declares
 *                                                NEITHER — untouched that day, found only by
 *                                                sweeping, and still the reason this file exists
 *
 * The first three were found by their author while fixing something else. The fourth was found
 * ONLY because the check was run over everything rather than over what had just changed —
 * `.claude/rules/workflow.md` §12's point that a sweep must be shape-driven when the thing being
 * swept is duplicated rather than cited.
 *
 * ===========================================================================================
 * THE FLOOR, AND WHY IT IS NOT OPTIONAL
 * ===========================================================================================
 *
 * `workflow.md` §11a: **a checker that cannot fail loudly on being handed nothing will eventually
 * be handed nothing** — by a renamed directory, a changed extension, or a glob that stops
 * matching. An empty comparison does not fail; it reports success, which is the most confident
 * wrong answer a check can give.
 *
 * So this exits non-zero if it finds NO schema files, or if it parses none, or if it examines
 * ZERO qualifying objects. "Nothing was wrong" and "nothing was examined" must not render the
 * same way, and the summary line prints the counts so a human can see which happened.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const CONTRACTS_DIR = 'packages/contracts';
const SCHEMA_SUFFIX = '.schema.json';

/** Every `*.schema.json` under the contract set, recursively. */
function schemaFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...schemaFiles(full));
    } else if (entry.name.endsWith(SCHEMA_SUFFIX)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every object that CLOSES its shape and states requirements — the only place this defect can
 * exist. An object without `additionalProperties: false` can carry an undeclared field, so a
 * `required` name missing from `properties` is merely undocumented rather than unsatisfiable.
 */
function* closedRequiredObjects(node, path) {
  if (node === null || typeof node !== 'object') return;
  if (!Array.isArray(node)) {
    if (node.additionalProperties === false && Array.isArray(node.required)) {
      yield { node, path };
    }
  }
  for (const [key, value] of Object.entries(node)) {
    yield* closedRequiredObjects(value, `${path}.${key}`);
  }
}

const failures = [];
let filesParsed = 0;
let objectsExamined = 0;

const files = schemaFiles(CONTRACTS_DIR);

for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${relative('.', file)}: not valid JSON — ${error.message}`);
    continue;
  }
  filesParsed += 1;

  for (const { node, path } of closedRequiredObjects(parsed, '')) {
    objectsExamined += 1;
    const declared = Object.keys(node.properties ?? {});
    const missing = node.required.filter((name) => !declared.includes(name));
    if (missing.length > 0) {
      failures.push(
        `${relative('.', file)}${path}\n` +
          `      required but NOT declared in properties: ${missing.join(', ')}\n` +
          `      additionalProperties is false, so no request can satisfy this shape.`,
      );
    }
  }
}

// ---- THE FLOOR. Report what was examined BEFORE reporting what was found. ----
console.log(
  `contract shapes: ${String(files.length)} schema files, ${String(filesParsed)} parsed, ` +
    `${String(objectsExamined)} closed objects with a required list`,
);

if (files.length === 0) {
  console.error(`FAIL: no ${SCHEMA_SUFFIX} files under ${CONTRACTS_DIR}. This check examined`);
  console.error('      nothing, which is not the same as finding nothing wrong.');
  process.exit(1);
}
if (objectsExamined === 0) {
  console.error('FAIL: no object closes its shape and states requirements. Either the contract');
  console.error('      set changed form, or this check no longer recognises it. Green here would');
  console.error('      mean "examined nothing", so it fails instead.');
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\nFAIL: ${String(failures.length)} unsatisfiable shape(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log('contract shapes: OK — every required field is declared.');
