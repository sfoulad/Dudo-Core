/**
 * ===========================================================================================
 * WHAT THE CONTRACT SET PROMISES AND THE ROUTE CLASS DOES NOT ACCEPT.
 * ===========================================================================================
 *
 * *** THE DEFECT THIS EXISTS FOR: `platform.organizations.create` DECLARED FOUR FIELDS WHILE
 * `organization-onboarding-v1` PUBLISHED FIVE. *** `display_name` was in the schema's
 * `properties` and not in the route's `fields`, and **the platform class refuses an undeclared
 * field BEFORE authentication** — so a client that trusted the contract failed EVERY onboarding,
 * pre-auth, on the one operation that creates customers.
 *
 * It was found by `web-agent` reading a committed schema against its own client. Nothing here
 * compared them, and **the comparison is entirely mechanical**, which is what makes its absence
 * worth a script rather than a note.
 *
 * ===========================================================================================
 * THE TWO DIRECTIONS, AND BOTH ARE FAILURES
 * ===========================================================================================
 *
 *   PROMISED, NOT DECLARED  A client sends what the contract publishes and is refused before
 *                           authentication. **This is the outage direction.**
 *   DECLARED, NOT PROMISED  The route accepts a field no contract publishes. Smaller, and still a
 *                           divergence: the contract is normative, and an accepted-but-undocumented
 *                           field is one a client can only discover by reading the code — which is
 *                           the moment the contract stops being the source of truth for everyone.
 *
 * ===========================================================================================
 * WHAT IT DELIBERATELY ALLOWS
 * ===========================================================================================
 *
 * THE THREE CONFIRMATION FIELDS, taken from `confirmation-gate.ts` RATHER THAN HARDCODED. They are
 * injected into a gated route's request shape by a cross-cutting mechanism and belong to no single
 * route's contract, so a gated route legitimately declares three names its own contract does not
 * publish. Importing them is what stops this check going stale when the mechanism is renamed —
 * `architecture.md` §1a's reserved namespace, read from its owner.
 *
 * ===========================================================================================
 * THE KNOWN-FAILING INPUT, AND THE FLOOR
 * ===========================================================================================
 *
 * `workflow.md` §11a: a check that has only ever been handed passing input has been OBSERVED, not
 * verified. So this runs two synthetic comparisons before it looks at anything real — one contract
 * promising a field the route lacks, one route declaring a field the contract lacks — and **exits
 * non-zero without scanning if either fails to be detected.**
 *
 * AND IT REPORTS THE POPULATION: how many routes, how many resolved to a contract, how many
 * carried an input shape. A count that goes DOWN without the route table shrinking means the
 * resolver stopped finding things, which is the failure mode that renders as success.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACTS_DIR = 'packages/contracts';

const { platformRoutes } = await import('../platform/core/platform/platform-routes.ts');
const gate = await import('../platform/core/confirmation/confirmation-gate.ts');

/**
 * The names the confirmation mechanism injects. Read from the module that owns them; if it stops
 * exporting them this check fails loudly rather than silently allowing nothing.
 */
const INJECTED = [
  gate.CONFIRMATION_ID_FIELD,
  gate.REAUTH_DERIVED_VALUE_FIELD,
  gate.REAUTH_IDENTIFIER_FIELD,
].filter((name) => typeof name === 'string' && name.length > 0);

if (INJECTED.length !== 3) {
  console.error('FAIL: could not read the three confirmation field names from confirmation-gate.ts.');
  console.error('      Without them every gated route reports three false divergences, so this');
  console.error('      refuses to run rather than produce noise that would be ignored.');
  process.exit(1);
}

// =============================================================================================
// Reading the contract set
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
 * `operationId -> schemaRef`, read from the contract YAML.
 *
 * **THERE IS NO YAML PARSER IN THIS REPOSITORY** — no npm package is approved — so this is a
 * line-oriented reader, and its narrowness is stated rather than hidden: it recognises `- id: x`
 * and a `schemaRef:` appearing before the next `- id:`. Both inline (`request: { schemaRef: "..." }`)
 * and block forms are matched, because *"a check that matched only block-form YAML"* is a defect
 * this repository has already had once.
 */
function operationRequestShapes() {
  const shapes = new Map();
  for (const file of filesUnder(CONTRACTS_DIR, '.contract.yaml')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let current = null;
    let seenRequest = false;
    for (const line of lines) {
      const id = /^\s*-\s+id:\s*([A-Za-z0-9._-]+)\s*$/u.exec(line);
      if (id !== null) {
        current = id[1];
        seenRequest = false;
        continue;
      }
      if (current === null || seenRequest) continue;
      // `request:` may be inline or the line before. Only the FIRST schemaRef after an id is the
      // request's — `response:` follows it — so this stops at the first match per operation.
      if (/^\s*request:/u.test(line) || /^\s*schemaRef:/u.test(line)) {
        const ref = /schemaRef:\s*"([^"]+)"/u.exec(line);
        if (ref !== null) {
          shapes.set(current, { ref: ref[1], file });
          seenRequest = true;
        }
      }
    }
  }
  return shapes;
}

const schemasById = new Map();
for (const file of filesUnder(CONTRACTS_DIR, '.schema.json')) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed.$id === 'string') schemasById.set(parsed.$id, parsed);
  } catch {
    // A malformed schema is `check-contract-shapes.mjs`'s finding, not this one's.
  }
}

/** `urn:...:1#/$defs/name` -> the declared property names, or null if it cannot be resolved. */
function propertiesOf(ref) {
  const [id, pointer] = ref.split('#');
  const schema = schemasById.get(id);
  if (schema === undefined || pointer === undefined) return null;
  let node = schema;
  for (const rawSegment of pointer.split('/').slice(1)) {
    const segment = rawSegment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (node === null || typeof node !== 'object' || !(segment in node)) return null;
    node = node[segment];
  }
  if (node === null || typeof node !== 'object') return null;
  if (node.properties !== undefined) return Object.keys(node.properties);
  // A `oneOf` request shape has no single property set. Not a failure; not comparable either.
  return undefined;
}

// =============================================================================================
// The comparison, as a pure function so the self-test can drive it
// =============================================================================================

function compare(routeId, declared, promised) {
  const allowed = new Set([...declared, ...INJECTED]);
  return {
    routeId,
    promisedNotDeclared: promised.filter((name) => !allowed.has(name)),
    declaredNotPromised: declared.filter(
      (name) => !promised.includes(name) && !INJECTED.includes(name),
    ),
  };
}

// ---- THE KNOWN-FAILING INPUTS. Both directions, before anything real is read. ----
const missing = compare('synthetic.a', ['x'], ['x', 'y']);
const extra = compare('synthetic.b', ['x', 'z'], ['x']);
if (missing.promisedNotDeclared.length !== 1 || missing.promisedNotDeclared[0] !== 'y') {
  console.error('SELF-TEST FAILED: a contract field the route does not declare was not detected.');
  process.exit(1);
}
if (extra.declaredNotPromised.length !== 1 || extra.declaredNotPromised[0] !== 'z') {
  console.error('SELF-TEST FAILED: a route field no contract publishes was not detected.');
  process.exit(1);
}
const injectedOk = compare('synthetic.c', [...INJECTED], []);
if (injectedOk.declaredNotPromised.length !== 0) {
  console.error('SELF-TEST FAILED: the confirmation fields were reported as a divergence.');
  process.exit(1);
}

// =============================================================================================
// The scan
// =============================================================================================

const shapes = operationRequestShapes();
const routes = platformRoutes();

let resolved = 0;
let comparable = 0;
const failures = [];

for (const route of routes) {
  const shape = shapes.get(route.id);
  if (shape === undefined) continue;
  resolved += 1;
  const promised = propertiesOf(shape.ref);
  if (promised === null) {
    failures.push(`${route.id}: schemaRef "${shape.ref}" does not resolve to anything.`);
    continue;
  }
  if (promised === undefined) continue; // a `oneOf` shape; nothing single to compare
  comparable += 1;

  const declared = [...route.fields, ...route.objectFields];
  const result = compare(route.id, declared, promised);
  if (result.promisedNotDeclared.length > 0) {
    failures.push(
      `${route.id}\n      PROMISED BY THE CONTRACT, NOT DECLARED BY THE ROUTE: ` +
        `${result.promisedNotDeclared.join(', ')}\n` +
        '      The class refuses an undeclared field BEFORE authentication, so a client that\n' +
        '      trusts the contract fails every call to this route.',
    );
  }
  if (result.declaredNotPromised.length > 0) {
    failures.push(
      `${route.id}\n      DECLARED BY THE ROUTE, NOT PUBLISHED BY ANY CONTRACT: ` +
        `${result.declaredNotPromised.join(', ')}\n` +
        '      A field a client can only discover by reading the code.',
    );
  }
}

// ---- THE FLOOR. What was examined, before what was found. ----
console.log(
  `route fields: ${String(routes.length)} routes, ${String(shapes.size)} contract operations, ` +
    `${String(resolved)} matched, ${String(comparable)} with a comparable request shape ` +
    '(self-test passed)',
);

if (routes.length === 0 || shapes.size === 0) {
  console.error('FAIL: no routes or no contract operations were read. This examined nothing.');
  process.exit(1);
}
if (comparable < 3) {
  console.error(`FAIL: only ${String(comparable)} route(s) had a comparable request shape.`);
  console.error('      The resolver has stopped finding things — a renamed key, a moved file or a');
  console.error('      changed YAML form. "Nothing was wrong" and "nothing was examined" must not');
  console.error('      render the same way.');
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\nFAIL: ${String(failures.length)} route/contract divergence(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log('route fields: OK — every promised field is declared, and no extras.');
