/**
 * ===========================================================================================
 * `0044` §3b.2 AND §3c — THE TWO REFUSALS THAT HAPPEN AT REGISTRATION, NOT AT AUTHORIZATION.
 * ===========================================================================================
 *
 *   §3b.2  "No request shape may contain an organization identifier in any position — path,
 *           query or body — and a route declaring one is refused AT REGISTRATION rather than
 *           at authorization."
 *
 *   §3c    "Every read shape in this class declares a page cap or names the index that bounds
 *           it. An absent bound is a REGISTRATION FAILURE, never a fallback."
 *
 * Both are refusals at registration, so **both are testable before any route exists** — which
 * is why they are here now rather than after the class ships.
 *
 * ===========================================================================================
 * THIS FILE WAS RUN AGAINST THE UNBUILT STATE FIRST, AND THAT RUN IS THE EVIDENCE
 * ===========================================================================================
 *
 * `workflow.md` §11a: *when a new check has a broken state available, run it there first and
 * RECORD WHAT IT SAYS. That output is evidence no constructed fixture can replace, it exists
 * for free, once, and only until you repair it.*
 *
 * Measured 2026-09-13 ~11:0x, with `core-agent` writing in the same checkout:
 *
 *   platform/core/tenant-admin/   tenant-admin-authority.ts, tenant-admin-permissions.ts
 *   a route registry              ABSENT
 *   a registrar that can refuse   ABSENT
 *   TENANT_ADMIN_ROUTE_PERMISSION_COUNT   0
 *
 * **So on the day this was written, NEITHER REFUSAL EXISTED, and a route declaring
 * `organization_id` would have been registered by nothing and refused by nobody.** That is not
 * a defect — the class is mid-construction and `0044` was accepted hours earlier. It is the
 * state, recorded, so that the first green is legible as *the refusal arrived* rather than as
 * *the check never reached anything*.
 *
 * ===========================================================================================
 * WHY THE REGISTRAR IS SEARCHED FOR RATHER THAN IMPORTED BY PATH
 * ===========================================================================================
 *
 * A static `import` of a module that does not exist **kills the file at load**, and a suite
 * that dies at import is `NOT RUN` with everything behind it unmeasured — not failing
 * (`workflow.md` §2b). Every case in this file would vanish, and a runner that prints four
 * suites would print three.
 *
 * So the registrar is DERIVED: the tenant-admin tree is scanned for an exported symbol of a
 * registration shape. That also survives `core-agent` naming it something this file did not
 * guess, which a hardcoded path would not — `§11a`'s *a check that holds a name of its own goes
 * stale when the name moves.*
 *
 * ===========================================================================================
 * WHAT THIS FILE CANNOT DO, AND IT IS THE LARGER HALF TODAY
 * ===========================================================================================
 *
 * **A STRUCTURAL SCAN OF THE CONTRACTS IS NOT THE REFUSAL `0044` ASKED FOR.** `0044` §3c is
 * explicit about why the check has to live at registration:
 *
 *   > "`security-agent` found the platform version of this (SR-15) by reviewing a built
 *   >  surface. DESIGNING IT OUT MEANS THE REVIEW THAT WOULD HAVE CAUGHT IT DOES NOT HAPPEN —
 *   >  so the registration check is the only thing standing where the review used to."
 *
 * The scans below read the contracts that exist and prove those contracts are clean. **They
 * cannot prove that a route declaring an organization identifier would be REFUSED**, because
 * nothing yet refuses anything. When the registrar lands, the behavioural cases at the bottom
 * of this file stop being red and start being the actual guarantee. Until then the scans are a
 * floor and are labelled one.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE_TREE = 'platform/core/tenant-admin';
const CONTRACT_TREE = 'packages/contracts/core/tenant-admin';

// ===========================================================================================
// PURE HALF — driven by the known-failing inputs as well as by the real corpus.
// ===========================================================================================

/**
 * Every spelling of "the tenant, supplied by the caller" that `0044` §3b.2 forbids in a request
 * shape.
 *
 * DERIVED FROM THE CORPUS, NOT FROM MEMORY (`workflow.md` §11a). Swept 2026-09-13 across
 * `platform/core/**` and `packages/contracts/**`: the control plane spells it `organization_id`
 * and `organizationId`; `MULTITENANCY_STANDARD.md` and `carriers.ts` use `tenant_id` and
 * `tenantId` for the same value; `0025`'s platform routes use `organization_slug` as an
 * addressable alternative, which is the same disclosure in a friendlier alphabet.
 *
 * **A SLUG IS AN ORGANIZATION IDENTIFIER.** Omitting it would be the fail-open reading —
 * §3b.2 says *"an organization identifier in any position"*, and the position is not the only
 * axis on which this can be dodged.
 */
export const FORBIDDEN_TENANT_FIELDS: readonly RegExp[] = [
  /^organization_?id$/i,
  /^organisation_?id$/i,
  /^org_?id$/i,
  /^tenant_?id$/i,
  /^organization_?slug$/i,
  /^organization_?identifier$/i,
];

export function isForbiddenTenantField(name: string): boolean {
  return FORBIDDEN_TENANT_FIELDS.some((pattern) => pattern.test(name));
}

export type Shape = { readonly def: string; readonly properties: readonly string[] };

/**
 * Every request shape in a tenant-admin schema, with its declared property names.
 *
 * A REQUEST SHAPE IS DERIVED FROM THE ARTIFACT'S OWN CONVENTION — a `$def` whose name ends in
 * `Input` — rather than from a list this file maintains. `tenant-members-v1.schema.json`
 * declares `listMembersInput`, `getMemberInput`, `changeMemberStatusInput`,
 * `removeMemberInput`, and a transcribed list would be one contract behind from the first day.
 */
export function requestShapesIn(schema: unknown): Shape[] {
  const defs = (schema as { $defs?: Record<string, unknown> }).$defs ?? {};
  const shapes: Shape[] = [];
  for (const [def, body] of Object.entries(defs)) {
    if (!/Input$/.test(def)) continue;
    shapes.push({ def, properties: propertyNamesOf(body) });
  }
  return shapes;
}

/** Every property name reachable in a shape, including through `allOf`/`oneOf`/nesting. */
export function propertyNamesOf(node: unknown): string[] {
  const names: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const record = value as Record<string, unknown>;
    const properties = record.properties;
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const key of Object.keys(properties as Record<string, unknown>)) names.push(key);
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(node);
  return names;
}

/** A read shape is one whose name says it reads. Also the artifact's own convention. */
export function isReadShape(def: string): boolean {
  return /^(list|get|search|read|count)/.test(def);
}

// -------------------------------------------------------------------------------------------
// THE CONTRACT READER.
//
// `§3b.2` FORBIDS AN ORGANIZATION IDENTIFIER IN **PATH, QUERY OR BODY**, AND THE SCHEMA WALK
// ABOVE REACHES ONLY THE THIRD. The path is declared in the CONTRACT — `path:
// "/organization/members/{principal_id}"` — and nothing in `packages/contracts/**/*.schema.json`
// mentions it. So a route declaring `/organization/{organization_id}/members` was invisible to
// the first version of this file, which scanned schemas alone and reported §3b.2 satisfied.
//
// **That is a check reporting a three-position rule closed while examining one position.**
// Found because the Team Lead sent the corpus after nearly writing the mirror-image bug into a
// review — theirs was a `grep -c` for `organization_id` that would have flagged four compliant
// contracts, because the string legitimately appears in `boundingIndex` column lists, in prose
// quoting the prohibition, and in migration filenames.
//
// > **BOTH ERRORS COME FROM THE SAME PLACE: THE RULE IS POSITIONAL AND A STRING IS NOT.** One
// > over-matched on text that is not a request position; the other under-matched by reading a
// > file that does not contain one of the positions. The reader below keys on POSITION.
//
// It is not a second reader of `requestClass` — `scripts/lib/request-class.mjs` owns that fact
// and this reads different fields — but it IS a second parse of the same file, so it carries
// its own floor and reports its population.
// -------------------------------------------------------------------------------------------

export type Operation = {
  readonly contract: string;
  readonly id: string;
  readonly path: string;
  readonly schemaRef: string;
  readonly sensitivity: string;
  readonly audit: string;
  readonly confirmation: string;
  /** One id, or the members of a `[a, b]` list. `0044` §3d permits a conjunction of these. */
  readonly permissions: readonly string[];
  /** `conjunction` where declared. A DISJUNCTION IS REFUSED — `0044` §3d, at the type level. */
  readonly permissionMode: string;
};

export function operationsIn(contract: string, source: string): Operation[] {
  const found: Operation[] = [];
  let inOperations = false;
  let current: Record<string, string> | null = null;
  const flush = (): void => {
    if (current !== null && current.id !== undefined) {
      const raw = current.permission ?? '';
      found.push({
        contract,
        id: current.id,
        path: current.path ?? '',
        schemaRef: current.schemaRef ?? '',
        sensitivity: current.sensitivity ?? '',
        audit: current.audit ?? '',
        confirmation: current.confirmation ?? '',
        // `permission: core.user.list` or `permission: [core.user.invite, core.invitation.list]`.
        permissions: raw
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        permissionMode: current.permissionMode ?? '',
      });
    }
    current = null;
  };

  for (const line of source.split('\n')) {
    if (/^[A-Za-z][A-Za-z0-9_]*:/.test(line)) {
      flush();
      inOperations = /^operations:/.test(line);
      continue;
    }
    if (!inOperations) continue;

    const id = /^\s{2}-\s+id:\s*(\S+)/.exec(line);
    if (id !== null) {
      flush();
      current = { id: id[1] };
      continue;
    }
    if (current === null) continue;

    const path = /^\s{4}path:\s*"([^"]*)"/.exec(line);
    if (path !== null) current.path = path[1];
    const ref = /schemaRef:\s*"([^"]*)"/.exec(line);
    if (ref !== null && current.schemaRef === undefined) current.schemaRef = ref[1];
    const scalar = /^\s{4}(sensitivity|audit|confirmation|permissionMode):\s*(\S+)/.exec(line);
    if (scalar !== null) current[scalar[1]] = scalar[2];
    // `permission:` is captured to end-of-line rather than as `\S+`, because a conjunction is a
    // bracketed list with a space in it and `\S+` would silently truncate `[core.user.invite,`
    // to one conjunct. That truncation reads as a route holding FEWER permissions than it does,
    // which is the fail-open direction for every assertion below.
    const permission = /^\s{4}permission:\s*(.+?)\s*$/.exec(line);
    if (permission !== null) current.permission = permission[1];
  }
  flush();
  return found;
}

/** The `{...}` segments of a path — the PATH POSITION, which is where §3b.2's first word lives. */
export function pathParametersOf(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

// ===========================================================================================
// THE SUITE
// ===========================================================================================

function schemaFiles(): string[] {
  if (!existsSync(REPO + CONTRACT_TREE)) return [];
  return readdirSync(REPO + CONTRACT_TREE)
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
}

function coreFiles(): string[] {
  if (!existsSync(REPO + CORE_TREE)) return [];
  return readdirSync(REPO + CORE_TREE).filter((name) => name.endsWith('.ts')).sort();
}

function contractFiles(): string[] {
  if (!existsSync(REPO + CONTRACT_TREE)) return [];
  return readdirSync(REPO + CONTRACT_TREE).filter((name) => name.endsWith('.contract.yaml')).sort();
}

function allOperations(): Operation[] {
  return contractFiles().flatMap((file) =>
    operationsIn(file, readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8')),
  );
}

export function buildTenantAdminRegistrationSuite(): Suite {
  const suite = new TestSuite('0044 §3b.2 and §3c — the two refusals that happen at registration');

  // -----------------------------------------------------------------------------------------
  // THE POPULATION, FIRST AND LOUDLY.
  //
  // Every scan below is over a tree that is being written as this runs. A run that examined
  // nothing must not read like a run that found nothing wrong (`§11a`, the empty-list reader),
  // and the population here starts near zero legitimately — so it is PRINTED and floored
  // rather than assumed.
  // -----------------------------------------------------------------------------------------
  suite.test('population — what exists to examine, stated before anything is asserted about it', () => {
    const schemas = schemaFiles();
    const core = coreFiles();
    console.log(`      ${CONTRACT_TREE}: ${String(schemas.length)} schema(s) — ${schemas.join(', ') || 'NONE'}`);
    console.log(`      ${CORE_TREE}: ${String(core.length)} module(s) — ${core.join(', ') || 'NONE'}`);
    const shapes = schemas.flatMap((file) =>
      requestShapesIn(JSON.parse(readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8'))),
    );
    console.log(
      `      request shapes: ${String(shapes.length)} (${String(shapes.filter((s) => isReadShape(s.def)).length)} read)`,
    );
    assertTrue(
      'the tenant-admin trees exist at all',
      schemas.length > 0 || core.length > 0,
      'NEITHER tree exists. Every case below is examining nothing, and would pass. Milestone 2 has ' +
        'not started, or these paths have moved.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // §3b.2 — THE STRUCTURAL FLOOR (runs today) ------------------------------------------------
  // -----------------------------------------------------------------------------------------
  suite.test('§3b.2 — no tenant-admin request shape declares an organization identifier', () => {
    const schemas = schemaFiles();
    const offenders: string[] = [];
    let shapesExamined = 0;
    let propertiesExamined = 0;

    for (const file of schemas) {
      const schema: unknown = JSON.parse(readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8'));
      for (const shape of requestShapesIn(schema)) {
        shapesExamined += 1;
        propertiesExamined += shape.properties.length;
        for (const property of shape.properties) {
          if (isForbiddenTenantField(property)) offenders.push(`${file}#${shape.def}.${property}`);
        }
      }
    }

    console.log(
      `      examined ${String(shapesExamined)} request shape(s), ${String(propertiesExamined)} propert(ies)`,
    );
    // The floor: a scan that examined no properties found no offenders, and would be green
    // forever. It is asserted separately from the finding so the two are never confused.
    assertTrue(
      '§3b.2 floor: the scan examined something',
      propertiesExamined > 0,
      'zero properties were examined, so this case proves nothing about §3b.2 — a reader that ' +
        'reads nothing reports agreement, which is the most confident wrong answer available',
    );
    assertTrue(
      `${ISOLATION} §3b.2 — the tenant comes from the authenticated context and from nowhere else`,
      offenders.length === 0,
      `${String(offenders.length)} request shape(s) declare an organization identifier: ` +
        `${offenders.join(', ')}. 0044 §3b.2 refuses these AT REGISTRATION; a client-supplied ` +
        'tenant is the carrier the whole class is built to withhold.',
    );
  });

  suite.test('§3b.2 PATH POSITION — no operation declares an organization identifier in its path', () => {
    // The position the schema walk above CANNOT see. A path template lives in the contract and
    // appears in no schema, so a route at `/organization/{organization_id}/members` would have
    // passed every assertion in the first version of this file.
    const operations = allOperations();
    const withPath = operations.filter((operation) => operation.path.length > 0);
    const parameters = withPath.flatMap((operation) =>
      pathParametersOf(operation.path).map((name) => ({ operation, name })),
    );

    console.log(
      `      ${String(contractFiles().length)} contract(s), ${String(operations.length)} operation(s), ` +
        `${String(withPath.length)} with a path, ${String(parameters.length)} path parameter(s)`,
    );

    // FLOOR ON THE READER, not only on the result. If the operations parser stops matching, every
    // contract yields zero operations, zero parameters and zero violations — and that renders
    // exactly like compliance. A route table with no paths at all is not a thing this class can be.
    assertTrue(
      '§3b.2 floor: the contract reader found operations WITH paths',
      withPath.length > 0,
      `${String(operations.length)} operations parsed and ${String(withPath.length)} carry a path. ` +
        'Zero means the reader is broken, not that the class is empty — a REST class whose routes ' +
        'have no paths does not exist, and a reader that finds none reports agreement.',
    );

    const offenders = parameters.filter(({ name }) => isForbiddenTenantField(name));
    assertTrue(
      `${ISOLATION} §3b.2 — the tenant is never a path parameter`,
      offenders.length === 0,
      `${offenders.map((entry) => `${entry.operation.id} declares {${entry.name}} in ${entry.operation.path}`).join('; ')}. ` +
        '0044 §3b.2 refuses such a route AT REGISTRATION: the tenant comes from the authenticated ' +
        'context and from nowhere else, and a path segment is a caller-supplied value.',
    );
  });

  suite.test('§3b.2 KNOWN-FAILING INPUT — a REALISTIC path mutation is caught, and the string alone is not', () => {
    // Mutating a REAL path the way an author plausibly would: nesting members under an
    // Organization segment, which is how most REST APIs are laid out and is exactly the shape
    // somebody arriving from another codebase would write.
    const operations = allOperations().filter((operation) => operation.path.length > 0);
    assertTrue('a real path is available to mutate', operations.length > 0, 'no operation carries a path');
    if (operations.length === 0) return;

    const control = operations.flatMap((operation) => pathParametersOf(operation.path)).filter(isForbiddenTenantField);
    assertEqual('control: the unmutated paths are clean', control.length, 0);

    const mutated = operations[0].path.replace('/organization/', '/organization/{organization_id}/');
    const caught = pathParametersOf(mutated).filter(isForbiddenTenantField);
    assertEqual(`the mutant ${mutated} is caught`, caught.length, 1);

    // *** AND THE OTHER HALF, WHICH IS WHY THIS CHECK IS POSITIONAL RATHER THAN TEXTUAL. ***
    // The Team Lead measured that `organization_id` appears one to five times in EVERY one of
    // these contracts and that all of those occurrences are compliant: `boundingIndex` column
    // lists, prose quoting the prohibition, a migration filename. A `grep -c` reads that as four
    // violations. It is zero — and the boundingIndex case is the rule WORKING, because the tenant
    // scoping lives in that index and the value reaching it comes from the authenticated context.
    //
    // A check flagging it would go red on correct contracts on every run and be switched off
    // inside a week, which is `§11a`'s *a suite that goes red under load teaches a team to
    // ignore red*. These assertions prove the reader is immune to all three legitimate forms.
    const legitimate = [
      'invitation, keyed (organization_id, created_at DESC, invitation_id)',
      "NO organization_id in any shape, in any position. 0044 §3b.2 refuses such a route",
      '0015_organization_identity.sql adds `display_name`',
      "`organization_membership`'s primary key is (principal_id, organization_id)",
    ];
    for (const text of legitimate) {
      assertEqual(
        `a compliant mention is not a path parameter: ${text.slice(0, 40)}…`,
        pathParametersOf(text).filter(isForbiddenTenantField).length,
        0,
      );
    }
  });

  suite.test('§3b.2 KNOWN-FAILING INPUT — an injected organization_id is caught in a REAL schema', () => {
    // `§11a`: a control built from an INVENTED mutation tests the pattern against itself and
    // always passes. This mutates the real schema the way a real author would — adding the
    // field to an existing input — and it mutates the PARSED OBJECT, so nothing on disk changes
    // and no other agent can see a broken tree (`§2a-i`).
    const schemas = schemaFiles();
    assertTrue('a real schema is available to mutate', schemas.length > 0, 'no tenant-admin schema exists yet');
    if (schemas.length === 0) return;

    // ⚠ THIS TOOK `schemas[0]` UNTIL 2026-09-13 AND BROKE ON A CORRECT CHANGE. A new schema
    // landed that sorts first alphabetically and declares no `*Input` def, so the case failed
    // with *"no *Input def to mutate"* — **a property of the CORPUS, not of the checker**, which
    // is `§11a`'s recurring shape. Positional selection over a growing directory is a dependency
    // nobody declares.
    //
    // Now it picks the first schema that HAS a request shape, and floors on finding one: a tree
    // of tenant-admin schemas where none declares an input is not a tree this mutation can be
    // built against, and saying so beats passing over nothing.
    const withInput = schemas
      .map((file) => ({
        file,
        parsed: JSON.parse(readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8')) as {
          $defs: Record<string, { properties?: Record<string, unknown> }>;
        },
      }))
      .find((candidate) => Object.keys(candidate.parsed.$defs ?? {}).some((def) => /Input$/.test(def)));
    assertTrue(
      'at least one tenant-admin schema declares a request shape to mutate',
      withInput !== undefined,
      `${String(schemas.length)} schema(s) and NONE declares an \`*Input\` def. The mutation cannot ` +
        'be built, so this control proves nothing — which is a finding about the corpus rather ' +
        'than a passing case.',
    );
    if (withInput === undefined) return;
    const schema = withInput.parsed;
    const target = Object.keys(schema.$defs).find((def) => /Input$/.test(def));
    if (target === undefined) return;
    console.log(`      mutating ${withInput.file}#${target}`);

    const control = requestShapesIn(schema).flatMap((s) => s.properties).filter(isForbiddenTenantField);
    assertEqual('control: the unmutated schema is clean', control.length, 0);

    (schema.$defs[target].properties ??= {}).organization_id = { type: 'string' };
    const after = requestShapesIn(schema).flatMap((s) => s.properties).filter(isForbiddenTenantField);
    assertTrue(
      'the mutant is caught',
      after.length === 1,
      `injecting organization_id into ${target} produced ${String(after.length)} findings — the ` +
        'scanner cannot see the field it exists for',
    );

    // And every spelling, not only the one anybody would think to test. A scan that catches
    // `organization_id` and misses `tenant_id` reports the class closed.
    for (const spelling of ['tenant_id', 'organizationId', 'org_id', 'organization_slug']) {
      assertTrue(`${spelling} is recognised as an organization identifier`, isForbiddenTenantField(spelling), spelling);
    }
    assertTrue('and an ordinary field is NOT', !isForbiddenTenantField('principal_id'), 'principal_id was flagged');
    assertTrue('nor is a member field', !isForbiddenTenantField('display_name'), 'display_name was flagged');
  });

  // -----------------------------------------------------------------------------------------
  // §3c — THE BOUND, AND THE DEFAULT THAT WOULD SILENTLY SATISFY IT --------------------------
  // -----------------------------------------------------------------------------------------
  suite.test('§3c — the shared pageSize default exists and is NOT a bound, asserted rather than assumed', () => {
    // `0044` §3c predicted this in advance: "A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF
    // THIS, and it will be proposed as a convenience."
    //
    // IT IS ALREADY THERE, and that is not a defect — `urn:dudo:schema:pagination:1` has
    // carried `"default": 25` since before this class existed, and the tenant-admin README
    // draws the distinction correctly: the default is the CLIENT'S convenience, the bound is
    // the MAXIMUM. This case pins the distinction so that neither half can move quietly.
    const pagination = JSON.parse(
      readFileSync(`${REPO}packages/contracts/common/pagination.schema.json`, 'utf8'),
    ) as { $defs: Record<string, { default?: number; maximum?: number }> };
    const pageSize = pagination.$defs.pageSize;
    assertTrue('the shared pageSize def still exists', pageSize !== undefined, 'pagination:1#/$defs/pageSize is gone');
    if (pageSize === undefined) return;

    assertEqual('the shared default is 25 — the client convenience', pageSize.default, 25);
    assertTrue(
      '§3c: the shared def carries a MAXIMUM, which is the only thing that bounds cost',
      typeof pageSize.maximum === 'number' && pageSize.maximum > 0,
      'the shared pageSize declares a default and NO maximum. A default bounds a well-behaved ' +
        'client and nothing else; 0044 §3c requires the bound. This is the fail-open case ' +
        'wearing the shared schema\'s clothes.',
    );
    console.log(`      shared pageSize: default ${String(pageSize.default)}, maximum ${String(pageSize.maximum)}`);
  });

  suite.test('§3c — no tenant-admin schema declares a page-size default of its own', () => {
    // The change that would destroy the check while satisfying it: a route declaring its own
    // `default` instead of a cap. A LOCAL default is strictly worse than the shared one,
    // because it reads as a deliberate bound and is not one.
    const schemas = schemaFiles();
    const offenders: string[] = [];
    let examined = 0;

    for (const file of schemas) {
      const text = readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8');
      const schema: unknown = JSON.parse(text);
      const visit = (node: unknown, path: string): void => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((entry, index) => visit(entry, `${path}/${String(index)}`));
          return;
        }
        const record = node as Record<string, unknown>;
        if (/page_?size|per_?page|limit/i.test(path) && 'default' in record) {
          offenders.push(`${file}${path} declares default=${String(record.default)}`);
        }
        examined += 1;
        for (const [key, value] of Object.entries(record)) visit(value, `${path}/${key}`);
      };
      visit(schema, '');
    }

    console.log(`      examined ${String(examined)} schema node(s) across ${String(schemas.length)} file(s)`);
    assertTrue(
      '§3c floor: the walk examined something',
      examined > 0 || schemas.length === 0,
      'the schema walk examined nothing',
    );
    assertTrue(
      '§3c — a page-size default is a fail-open bound and none is declared here',
      offenders.length === 0,
      `${offenders.join('; ')} — 0044 §3c: an absent bound is a REGISTRATION FAILURE, never a ` +
        'fallback, and a route that forgot its bound is indistinguishable afterwards from one ' +
        'that accepted a default.',
    );
  });

  suite.test('§3c KNOWN-FAILING INPUT — a locally declared page-size default is caught', () => {
    // Driven through the same predicate the real scan uses, on the shape a real author would
    // write: a convenience default added beside a legitimate `$ref`.
    const mutated = { properties: { page_size: { $ref: 'urn:dudo:schema:pagination:1#/$defs/pageSize', default: 50 } } };
    const offenders: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (/page_?size|per_?page|limit/i.test(path) && 'default' in record) offenders.push(path);
      for (const [key, value] of Object.entries(record)) visit(value, `${path}/${key}`);
    };
    visit(mutated, '');
    assertEqual('the injected default is caught', offenders.length, 1);

    const clean = { properties: { page_size: { $ref: 'urn:dudo:schema:pagination:1#/$defs/pageSize' } } };
    const cleanOffenders: string[] = [];
    const visitClean = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (/page_?size|per_?page|limit/i.test(path) && 'default' in record) cleanOffenders.push(path);
      for (const [key, value] of Object.entries(record)) visitClean(value, `${path}/${key}`);
    };
    visitClean(clean, '');
    assertEqual('control: a bare $ref is not flagged', cleanOffenders.length, 0);
  });

  // -----------------------------------------------------------------------------------------
  // `0043` §5.4 — EVERY SENSITIVE OPERATION DECLARES `confirmation`, `audit: required` AND
  // `sensitivity`. Two operations do not, and they are enumerated rather than absorbed.
  // -----------------------------------------------------------------------------------------
  suite.test('0043 §5.4 — every `sensitive` operation declares audit: required, except two named ones', () => {
    // THIS CASE EXISTS BECAUSE A COUNT COMPARISON WAS OFFERED AND DECLINED. The observation
    // handed to me was that `audit:` occurrences outnumber `sensitivity:` occurrences in three
    // of four contracts — 6/5, 9/8, 7/6 — with the honest caveat that the two range over
    // different populations and comparing them is `§11a`'s *two counts from different
    // derivations*. Measured properly, per operation: **21 operations, 21 sensitivities, 21
    // audits — the marginal totals agree exactly, so the raw counts said nothing at all.**
    //
    // Pairing them per operation is what found something. `0043` §5.4's wording is unconditional
    // about "destructive OR SENSITIVE", and two operations are `sensitive` with `audit: false`.
    const operations = allOperations().filter((operation) => operation.sensitivity.length > 0);
    console.log(
      `      ${String(operations.length)} operation(s) declare a sensitivity; ` +
        `${String(operations.filter((o) => o.sensitivity === 'sensitive').length)} are sensitive, ` +
        `${String(operations.filter((o) => o.audit === 'required').length)} declare audit: required`,
    );
    assertTrue(
      '§5.4 floor: operations with a declared sensitivity were found',
      operations.length > 0,
      'no operation declares a sensitivity — the reader is broken, and zero sensitive operations ' +
        'trivially satisfies every clause below',
    );

    // ENUMERATED WITH REASONS AND PINNED IN BOTH DIRECTIONS. `architecture.md` §3a-i: key the
    // predicate on the exception, so a THIRD unaudited sensitive route is caught by the default
    // rather than absorbed by a loosened rule.
    // =====================================================================================
    // ⚠ THE EXEMPTION LIST IS NOW EMPTY, AND EMPTYING IT IS THE DESIGNED OUTCOME.
    // =====================================================================================
    //
    // It held two entries — `tenant.invitations.get` and `tenant.invitations.pending-count`,
    // both `sensitivity: sensitive` with `audit: false`, both argued at length and the second
    // ruled correct by the Team Lead as `0043` §5.4a.
    //
    // **`m2-contracts` then set BOTH to `audit: required`.** The bidirectional pin fired:
    //
    // ```
    // [FAIL] the tenant.invitations.get exemption is still needed —
    //        it is exempted from §5.4 and NOW DECLARES audit: required
    // ```
    //
    // > **That is the second direction of the pin doing the only job it has.** The first
    // > direction catches an unaudited sensitive route nobody excused. **The second catches an
    // > excuse that has outlived what it excused** — and left in place it would silently permit
    // > those two to become unaudited again, with an argument attached that no longer applies.
    //
    // **So §5.4 is now UNCONDITIONAL, which is what `0043` §5.4 said before any exemption
    // existed.** The exemptions were a record of where the corpus disagreed with the rule; the
    // corpus was repaired, so they go.
    //
    // *** `0043` §5.4a IS NOT WITHDRAWN BY THIS AND MUST NOT BE READ AS WITHDRAWN. *** Its
    // ruling — that a count inside its consumer's enumeration right may skip the audit — is
    // still correct and still the reasoning that would apply if `pending-count` ever went back
    // to `audit: false`. **What changed is the contract, not the ruling.** The conditional
    // machinery below (`CONDITIONAL_ON_CONJUNCT`) is kept for the same reason: it costs nothing
    // while the list is empty and it is the mechanism §5.4a depends on.
    const UNAUDITED_SENSITIVE: readonly { readonly id: string; readonly because: string }[] = [
      // EMPTY SINCE 2026-09-13. The two entries that stood here are in `git log`, with their full
      // arguments — `tenant.invitations.get` on `0044` §3c's per-route judgement, and
      // `tenant.invitations.pending-count` on `0043` §5.4a's ruling that a count inside its
      // consumer's enumeration right discloses nothing. **Both arguments were sound and both
      // operations now declare `audit: required`, so neither excuses anything.**
    ];

    // *** THE RULING IS DERIVED, NOT TRANSCRIBED. ***
    //
    // `0043` §5.4a permits `pending-count` to skip the audit BECAUSE `core.invitation.list` is a
    // conjunct — that is what puts the count inside its consumer's enumeration right. The Team
    // Lead named the dependency and assigned it: *"if `core.invitation.list` is ever dropped from
    // that route, the count reaches past its consumer's enumeration right again and THE AUDIT
    // BECOMES REQUIRED."*
    //
    // A sentence saying so cannot go red. So the exemption is COMPUTED from the conjunction on
    // every run: drop the conjunct and this operation silently leaves the exempt set, at which
    // point the assertion below demands `audit: required` of it. **Nobody has to remember.**
    // `architecture.md` §3a — a guard that must be remembered is a discipline; a guard whose
    // input the write requires is a mechanism.
    const CONDITIONAL_ON_CONJUNCT: Readonly<Record<string, string>> = {
      'tenant.invitations.pending-count': 'core.invitation.list',
    };

    const exempt = new Set(
      UNAUDITED_SENSITIVE.map((entry) => entry.id).filter((id) => {
        const required = CONDITIONAL_ON_CONJUNCT[id];
        if (required === undefined) return true;
        const operation = operations.find((candidate) => candidate.id === id);
        return (
          operation !== undefined &&
          operation.permissionMode === 'conjunction' &&
          operation.permissions.includes(required)
        );
      }),
    );
    for (const [id, required] of Object.entries(CONDITIONAL_ON_CONJUNCT)) {
      const operation = operations.find((candidate) => candidate.id === id);
      console.log(
        `      ${id}: permissions [${operation?.permissions.join(', ') ?? 'NONE'}] mode=` +
          `${operation?.permissionMode || 'none'} — audit exemption ${exempt.has(id) ? 'HOLDS' : 'WITHDRAWN'} ` +
          `(conditional on ${required})`,
      );
    }
    const sensitive = operations.filter((operation) => operation.sensitivity === 'sensitive');

    // The pin's other direction: an exemption for an operation that no longer exists, or that has
    // since gained its audit, is a stale exemption and must fail rather than sit there.
    for (const entry of UNAUDITED_SENSITIVE) {
      const operation = operations.find((candidate) => candidate.id === entry.id);
      assertTrue(
        `the ${entry.id} exemption still names a real operation`,
        operation !== undefined,
        `${entry.id} is exempted from §5.4 and no longer exists — remove the exemption.`,
      );
      if (operation === undefined) continue;
      assertTrue(
        `the ${entry.id} exemption is still needed`,
        operation.audit !== 'required',
        `${entry.id} is exempted from §5.4 and NOW DECLARES audit: required — remove the ` +
          'exemption, or it will silently excuse a regression.',
      );
    }

    const unaudited = sensitive.filter((operation) => operation.audit !== 'required' && !exempt.has(operation.id));
    assertTrue(
      '0043 §5.4 — a sensitive operation is audited unless it is one of the two named reads',
      unaudited.length === 0,
      `${unaudited.map((o) => `${o.id} (audit: ${o.audit || 'ABSENT'})`).join(', ')} declare ` +
        '`sensitivity: sensitive` and not `audit: required`, and are not on the enumerated ' +
        'exemption list. 0043 §5.4 requires it; 0044 §3c permits a per-route exception for a ' +
        'sensitive READ, and an exception is a decision that gets written down here.',
    );

    // And the other two thirds of §5.4, which nothing above asserts.
    const missingConfirmation = sensitive.filter((operation) => operation.confirmation.length === 0);
    assertTrue(
      '0043 §5.4 — every sensitive operation declares a confirmation',
      missingConfirmation.length === 0,
      `${missingConfirmation.map((o) => o.id).join(', ')} declare no confirmation.`,
    );
  });

  suite.test('0043 §5.4a KNOWN-FAILING INPUT — dropping the conjunct withdraws the audit exemption', () => {
    // The ruling rests entirely on `core.invitation.list` being a conjunct. This drives the real
    // operation through the real predicate with that conjunct removed, and requires the exemption
    // to withdraw — so the mechanism is observed rather than argued.
    const operations = allOperations();
    const live = operations.find((operation) => operation.id === 'tenant.invitations.pending-count');
    assertTrue(
      'the operation the ruling is about still exists',
      live !== undefined,
      'tenant.invitations.pending-count is gone — 0043 §5.4a and this case are both about a route ' +
        'that no longer exists, and the exemption should go with it',
    );
    if (live === undefined) return;

    const holds = (operation: Operation): boolean =>
      operation.permissionMode === 'conjunction' && operation.permissions.includes('core.invitation.list');

    assertTrue(
      'control: the live operation declares the conjunction, so the exemption holds',
      holds(live),
      `permissions [${live.permissions.join(', ')}] mode=${live.permissionMode || 'none'} — 0043 §4 ` +
        'requires core.user.invite AND core.invitation.list on this route, and the audit exemption ' +
        'in 0043 §5.4a is derived from it. Without the conjunct the count reaches PAST its ' +
        "consumer's enumeration right and audit: required becomes mandatory.",
    );

    // The mutation: the conjunct is dropped, the way a later author would drop it — leaving the
    // creation permission, which is the one whose name makes the route sound adequately gated.
    const dropped: Operation = { ...live, permissions: ['core.user.invite'], permissionMode: '' };
    assertTrue(
      'the exemption WITHDRAWS when the conjunct is dropped',
      !holds(dropped),
      'the audit exemption survived the removal of core.invitation.list — the ruling would then ' +
        'be excusing an unaudited count that reaches past its enumeration right, which is the ' +
        'exact condition 0043 §5.4a says re-imposes the audit',
    );

    // And a disjunction must not satisfy it either. `A OR B` is a widening wearing the same
    // syntax, so a route "holding" the conjunct by disjunction holds nothing.
    const disjoined: Operation = { ...live, permissionMode: 'disjunction' };
    assertTrue(
      'a DISJUNCTION does not satisfy the conjunct requirement',
      !holds(disjoined),
      'permissionMode: disjunction satisfied a requirement that exists to guarantee the caller ' +
        'holds BOTH — 0044 §3d: `A OR B` IS A WIDENING WEARING THE SAME SYNTAX',
    );
  });

  suite.test('0044 §3d — no operation declares a DISJUNCTION of permissions', () => {
    // `0044` §3d: a conjunction is permitted, "REFUSE THE DISJUNCTION AT THE TYPE LEVEL so it
    // cannot be expressed, never in a comment. It arrives as convenience the first time a route
    // is awkward to grant." The type-level refusal is Core's; this is the contract-side half,
    // which is where the convenience is written down first.
    const operations = allOperations();
    const multi = operations.filter((operation) => operation.permissions.length > 1);
    console.log(
      `      ${String(operations.length)} operation(s); ${String(multi.length)} declare more than one ` +
        `permission — ${multi.map((o) => `${o.id} (${o.permissionMode || 'MODE ABSENT'})`).join(', ') || 'none'}`,
    );

    assertTrue(
      '§3d floor: the permission reader produced values',
      operations.filter((operation) => operation.permissions.length > 0).length > 0,
      'no operation declares a permission — the reader is broken, and zero permissions satisfies ' +
        'every clause below. 0044 §3b.5: EVERY route in this class evaluates a permission.',
    );
    assertTrue(
      '0044 §3b.5 — every operation declares at least one permission',
      operations.every((operation) => operation.permissions.length > 0),
      `${operations.filter((o) => o.permissions.length === 0).map((o) => o.id).join(', ')} declare ` +
        'no permission. There is no unauthenticated member of this class — that is the distinction ' +
        'from 0021 and why it is a fifth class rather than a widening of the third.',
    );
    assertTrue(
      '0044 §3d — a multi-permission route declares `conjunction`, never a disjunction',
      multi.every((operation) => operation.permissionMode === 'conjunction'),
      `${multi.filter((o) => o.permissionMode !== 'conjunction').map((o) => `${o.id} (${o.permissionMode || 'MODE ABSENT'})`).join(', ')}. ` +
        'A permission list with no declared mode is the dangerous case rather than a tidy one: it ' +
        'reads as a conjunction and enforces whatever the dispatcher happens to do.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // THE REFUSAL ITSELF — currently ABSENT, and that is the finding ---------------------------
  // -----------------------------------------------------------------------------------------
  suite.test('§3b.2 / §3c — A REGISTRAR EXISTS THAT CAN REFUSE. This is the guarantee; the scans above are a floor', () => {
    // Derived rather than imported by path: an absent module would kill this file at load, and
    // a suite that dies at import is NOT RUN with everything behind it unmeasured.
    const found: string[] = [];
    for (const file of coreFiles()) {
      const text = readFileSync(`${REPO}${CORE_TREE}/${file}`, 'utf8');
      for (const match of text.matchAll(/export (?:function|const) (\w*(?:[Rr]outes?|[Rr]egist\w*|[Rr]outer)\w*)/g)) {
        found.push(`${file}:${match[1]}`);
      }
    }
    console.log(`      registration-shaped exports in ${CORE_TREE}: ${found.join(', ') || 'NONE'}`);
    assertTrue(
      '0044 §3b.2 and §3c are enforced at registration by something that exists',
      found.length > 0,
      'NO ROUTE REGISTRY OR REGISTRAR EXISTS in ' +
        CORE_TREE +
        '. The two scans above prove the contracts written SO FAR are clean; they cannot prove ' +
        'that a route declaring an organization identifier, or a read with no bound, WOULD BE ' +
        'REFUSED — because nothing refuses anything yet. 0044 §3c is explicit that the ' +
        'registration check "is the only thing standing where the review used to" be, since ' +
        'designing the hazard out means the review that caught SR-15 does not happen. THIS CASE ' +
        'IS THE FREE FAILING INPUT, recorded at the only moment it is available.',
    );
  });

  return suite;
}
