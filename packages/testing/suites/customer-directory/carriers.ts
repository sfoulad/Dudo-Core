/**
 * AN ATTEMPT TO BREAK THE CENTRAL CLAIM, carrier by carrier.
 *
 * The claim under attack, from `platform/core/tenancy/tenant-context.ts`:
 *
 *   "AN ACTION HANDLER IS NEVER GIVEN THE ORGANIZATION IDENTIFIER … An Action in this
 *    repository cannot write a tenant predicate — correctly, incorrectly, or at all —
 *    because it has no value to write one with."
 *
 * Reading the file and grepping for `organizationId` shows the claim is TEXTUALLY true. That
 * is not the same as it being true, so this suite runs a HOSTILE APP HANDLER through the real
 * pipeline and has it try every route an App author could actually take. The handler is a
 * genuine `ActionDefinition` invoked by `invokeAction`, so it receives the same
 * `ActionContext` a real Action receives — not a reconstruction of one.
 *
 * MULTITENANCY_STANDARD.md §4 lists ELEVEN carriers. `tenant-context.ts` claims five are
 * closed structurally by withholding the value (response, log line, error message, cache key,
 * event envelope). This suite checks the OTHER SIX, and states plainly which of them exist in
 * this slice at all:
 *
 *   1  database query   — EXISTS. Attacked below, six ways.
 *   2  API request      — EXISTS. Attacked below. NOTE: rejecting a client-supplied
 *                         `tenant_id` proves INPUT VALIDATION, not isolation, and is reported
 *                         separately (`az7-r3`, and the contract's tenancy.rules).
 *   4  queue message    — DOES NOT EXIST in this slice.
 *   5  workflow         — DOES NOT EXIST in this slice.
 *   6  scheduled job    — DOES NOT EXIST in this slice (the purge is out of scope).
 *   8  file / object    — DOES NOT EXIST in this slice.
 *   9  export / report  — DOES NOT EXIST in this slice; `customers.customer.export` is
 *                         deliberately undeclared.
 *
 * "Does not exist" is asserted rather than assumed: a source scan below fails if a queue,
 * workflow, cron, object-store or export surface is introduced without an isolation
 * obligation being added with it. That is the only form in which a not-applicable carrier can
 * be honestly reported — an absence that nothing re-checks silently becomes a gap.
 *
 * WHAT THIS SUITE CANNOT DO, STATED. JavaScript gives no way to read a closure variable from
 * outside the closure, so `tenantId` inside `createD1TenantStore` and `bindCursorCodec` is
 * unreachable by construction rather than by convention. The deep scan below therefore
 * searches the reachable object graph and the source text of every function on it, and a pass
 * means "no reachable path", not "proved impossible in all future JavaScript".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import { BIZ_A_NORTH, CUST_A_ANNA, ORG_A, ORG_B } from '../../harness/world.ts';
import type { ActionDefinition } from '../../../../platform/core/action/action.ts';
import { asAnyAction } from '../../../../platform/core/action/action.ts';
import type { ActionContext } from '../../../../platform/core/tenancy/tenant-context.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { eq } from '../../../../platform/core/storage/predicate.ts';
import { CUSTOMER_TABLE, COLUMN } from '../../../../apps/customers/data/schema.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = `${HERE}../../../../`;

// ---------------------------------------------------------------------------
// A deep search of the reachable object graph for a tenant identifier.
// ---------------------------------------------------------------------------

export type Finding = { readonly path: string; readonly value: string };

export function findTenantIdentifier(
  root: unknown,
  needles: readonly string[],
  maxDepth = 6,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<unknown>();

  function walk(value: unknown, path: string, depth: number): void {
    if (depth > maxDepth || value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      for (const needle of needles) {
        if (value.includes(needle)) {
          findings.push({ path, value });
        }
      }
      return;
    }
    if (typeof value === 'function') {
      // A function's source text would expose a tenant identifier only if one had been
      // baked into it. Closure VARIABLES are not reachable from here, and that unreachability
      // is precisely the structural property being relied on.
      const source = Function.prototype.toString.call(value);
      for (const needle of needles) {
        if (source.includes(needle)) {
          findings.push({ path: `${path}(source)`, value: source.slice(0, 120) });
        }
      }
      return;
    }
    if (typeof value !== 'object') {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value as object)) {
      let child: unknown;
      try {
        child = (value as Record<PropertyKey, unknown>)[key];
      } catch {
        continue;
      }
      walk(child, `${path}.${String(key)}`, depth + 1);
    }
    const prototype = Object.getPrototypeOf(value as object);
    if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
      walk(prototype, `${path}.[[prototype]]`, depth + 1);
    }
  }

  walk(root, 'context', 0);
  return findings;
}

// ---------------------------------------------------------------------------
// Source scanning, for the carriers that must not exist in this slice.
// ---------------------------------------------------------------------------

function sourceFiles(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = `${directory}/${entry}`;
    if (statSync(full).isDirectory()) {
      collected.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      collected.push(full);
    }
  }
  return collected;
}

function scanForIdentifiers(directories: readonly string[], patterns: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const directory of directories) {
    for (const file of sourceFiles(directory)) {
      const text = readFileSync(file, 'utf8');
      // Comments are stripped before scanning: every one of these words appears in the
      // prose of this repository, and a scan that fired on a comment would be noise that
      // teaches the next reader to ignore it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const pattern of patterns) {
        const match = code.match(pattern);
        if (match !== null) {
          hits.push(`${file.replace(REPOSITORY, '')}: ${match[0]}`);
        }
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------

export function buildCarrierSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('the eleven carriers — attempts to reach a tenant identifier from App code');
  const needles = [ORG_A, ORG_B];

  suite.test('carrier 1 — a hostile handler cannot find a tenant identifier anywhere in its ActionContext', async () => {
    const world = await makeWorld();
    try {
      let findings: Finding[] = [];
      let contextKeys: string[] = [];
      const probe: ActionDefinition<unknown, unknown> = {
        id: 'qa.TenantProbe',
        appId: 'customers',
        title: 'Tenant probe',
        description: 'A hostile App handler used only by the verification suite.',
        errors: ['internal', 'forbidden', 'invalid_argument', 'not_found'],
        permission: 'customers.customer.read',
        scope: 'business',
        sensitivity: 'read',
        idempotent: false,
        audit: false,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle(context: ActionContext) {
          contextKeys = Object.keys(context);
          findings = findTenantIdentifier(context, needles);
          return ok({ output: null, writes: [], audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] } });
        },
      };

      expectOk('control: the probe Action ran', await world.invoke(asAnyAction(probe), world.ownerA, {}));
      assertTrue('control: the handler actually received a context', contextKeys.length > 0, 'the handler did not run');
      assertTrue(
        `${ISOLATION} no organization identifier is reachable from ActionContext`,
        findings.length === 0,
        `reachable at: ${findings.map((f) => f.path).join(', ')}`,
      );
      assertTrue(
        `${ISOLATION} ActionContext declares no organization field`,
        !contextKeys.some((key) => /organi[sz]ation|tenant/i.test(key)),
        `ActionContext keys: ${contextKeys.join(', ')}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('carrier 1 — the store rejects a spec naming the tenant column in all five positions', async () => {
    const world = await makeWorld();
    try {
      const store = await world.storeFor(ORG_A);
      const attempts: readonly { readonly where: string; readonly run: () => Promise<unknown> }[] = [
        {
          where: 'a select column list',
          run: () => store.select({ table: CUSTOMER_TABLE, columns: ['tenant_id'], limit: 1 }),
        },
        {
          where: 'a predicate',
          run: () => store.select({ table: CUSTOMER_TABLE, columns: [COLUMN.customerId], where: eq('tenant_id', ORG_B), limit: 1 }),
        },
        {
          where: 'a sort clause',
          run: () =>
            store.select({
              table: CUSTOMER_TABLE,
              columns: [COLUMN.customerId],
              sort: [{ column: 'tenant_id', direction: 'asc' }],
              limit: 1,
            }),
        },
        {
          where: 'an insert value list',
          run: () =>
            store.write([
              { kind: 'insert', spec: { table: CUSTOMER_TABLE, values: { tenant_id: ORG_B, customer_id: 'x' } } },
            ]),
        },
        {
          where: 'an update set clause',
          run: () =>
            store.write([
              { kind: 'update', spec: { table: CUSTOMER_TABLE, set: { tenant_id: ORG_B }, where: eq(COLUMN.customerId, CUST_A_ANNA) } },
            ]),
        },
      ];

      for (const attempt of attempts) {
        const outcome = (await attempt.run()) as { ok: boolean; error?: { code: string } };
        assertEqual(
          `${ISOLATION} naming the tenant column in ${attempt.where} is refused`,
          outcome.ok === false && outcome.error?.code === 'internal',
          true,
        );
      }

      // And nothing was written by the two write attempts.
      assertEqual(
        `${ISOLATION} no row was written into Organization B by a tenant-column write attempt`,
        world.customerRows(ORG_B).length,
        2,
      );
    } finally {
      world.close();
    }
  });

  suite.test('carrier 1 — no row handed to App code carries a tenant column', async () => {
    const world = await makeWorld();
    try {
      const store = await world.storeFor(ORG_A);
      const rows = expectOk(
        'control: the select returns rows',
        await store.select({ table: CUSTOMER_TABLE, columns: [COLUMN.customerId, COLUMN.businessId], limit: 10 }),
      ) as readonly Record<string, unknown>[];
      assertTrue('control: at least one row came back', rows.length > 0, 'no rows');
      for (const row of rows) {
        assertTrue(
          `${ISOLATION} a returned row has no tenant_id key`,
          !Object.prototype.hasOwnProperty.call(row, 'tenant_id'),
          `keys: ${Object.keys(row).join(', ')}`,
        );
      }
      const full = expectOk('control: a full record reads', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertTrue(
        `${ISOLATION} the wire record carries no tenant identifier`,
        findTenantIdentifier(full, needles).length === 0,
        'a tenant identifier appeared in a response body',
      );
    } finally {
      world.close();
    }
  });

  suite.test('carrier 1 — a cursor handed to a client carries no tenant identifier in any decodable form', async () => {
    const world = await makeWorld();
    try {
      const first = expectOk(
        'control: a cursor is issued',
        await world.invoke(world.actions.list, world.ownerA, { page_size: 1 }),
      ) as { next_cursor: string | null };
      assertTrue('control: a cursor was issued', first.next_cursor !== null, 'no cursor issued');
      const cursor = first.next_cursor as string;
      const body = cursor.slice(43);
      const decoded = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      assertTrue(
        `${ISOLATION} the decoded cursor payload contains no organization identifier`,
        !needles.some((needle) => decoded.includes(needle)),
        `decoded payload: ${decoded}`,
      );
      assertTrue(
        `${ISOLATION} the raw cursor string contains no organization identifier`,
        !needles.some((needle) => cursor.includes(needle)),
        'the cursor string carried a tenant identifier',
      );
    } finally {
      world.close();
    }
  });

  suite.test('carrier 11 — no error a caller can provoke carries a tenant identifier', async () => {
    const world = await makeWorld();
    try {
      const provoked = [
        await world.invoke(world.actions.get, world.ownerA, { customer_id: 'cust_beta_anna01' }),
        await world.invoke(world.actions.get, world.ownerA, { customer_id: 'not a valid id' }),
        await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }),
        await world.invoke(world.actions.create, world.ownerA, { business_id: 'biz_beta_east01', display_name: 'x', customer_type: 'company' }),
        await world.invoke(world.actions.list, world.ownerA, { cursor: 'AAAA' }),
        await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, tenant_id: ORG_B }),
      ];
      for (const outcome of provoked) {
        assertTrue(
          `${ISOLATION} an error envelope carries no organization identifier`,
          findTenantIdentifier(outcome, needles).length === 0,
          `error carried a tenant identifier: ${JSON.stringify(outcome)}`,
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('carrier 11 — a thrown storage defect does not surface a tenant identifier to the caller', async () => {
    const world = await makeWorld();
    try {
      // A handler that references the tenant column throws `TenantColumnReferencedError`
      // inside the store. The pipeline turns a thrown value into `internal`. Assert both that
      // the caller learns nothing and that the thrown message itself names no tenant VALUE.
      const probe: ActionDefinition<unknown, unknown> = {
        id: 'qa.TenantThrowProbe',
        appId: 'customers',
        title: 'Tenant throw probe',
        description: 'A hostile App handler used only by the verification suite.',
        errors: ['internal'],
        permission: 'customers.customer.read',
        scope: 'business',
        sensitivity: 'read',
        idempotent: false,
        audit: false,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle(context: ActionContext) {
          // Bypasses the port's Result contract by going through the guard directly, which is
          // what a careless App author would do.
          const { assertSpecIsTenantSafe } = await import('../../../../platform/core/storage/store.ts');
          assertSpecIsTenantSafe({ table: CUSTOMER_TABLE, values: { tenant_id: ORG_B } });
          void context;
          return ok({ output: null, writes: [], audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] } });
        },
      };
      const outcome = await world.invoke(asAnyAction(probe), world.ownerA, {});
      expectError('a thrown defect becomes internal', outcome, {
        code: 'internal',
        message: 'The request could not be completed.',
      });
      assertTrue(
        `${ISOLATION} the internal error carries no tenant identifier`,
        findTenantIdentifier(outcome, needles).length === 0,
        'a tenant identifier reached the caller',
      );
    } finally {
      world.close();
    }
  });

  suite.test('carriers 4, 5, 6, 7, 8 and 9 do not exist in this slice — asserted, not assumed', async () => {
    const directories = [`${REPOSITORY}apps/customers`, `${REPOSITORY}platform/core`];
    const hits = scanForIdentifiers(directories, [
      /\bQueue\b/,
      /\bqueue\.send\b/,
      /WorkflowEntrypoint/,
      /\bscheduled\s*\(/,
      /\bcron\b/i,
      /R2Bucket/,
      /\bcaches\b/,
      /\bcache\.(get|put)\b/,
      /\bexport(To|Csv|Report)\b/,
      /console\.(log|warn|error|info|debug)/,
    ]);
    assertTrue(
      'no queue, workflow, scheduled job, cache, object store, export surface or log statement exists in the slice',
      hits.length === 0,
      `found: ${hits.join(' | ')} — each is a carrier under MULTITENANCY_STANDARD.md §4 and ` +
        'needs its own isolation obligation before it ships',
    );
  });

  suite.test('carrier 2 — a client-supplied tenant is refused (INPUT VALIDATION, reported separately from isolation)', async () => {
    const world = await makeWorld();
    try {
      const vectors: readonly [string, Record<string, unknown>][] = [
        ['tenant_id on update', { customer_id: CUST_A_ANNA, display_name: 'x', tenant_id: ORG_B }],
        ['organization_id on update', { customer_id: CUST_A_ANNA, display_name: 'x', organization_id: ORG_B }],
        ['tenant_id on create', { business_id: BIZ_A_NORTH, display_name: 'x', customer_type: 'company', tenant_id: ORG_B }],
        ['organization_id on list', { organization_id: ORG_B }],
      ];
      for (const [name, input] of vectors) {
        const action = name.includes('create')
          ? world.actions.create
          : name.includes('list')
            ? world.actions.list
            : world.actions.update;
        const outcome = (await world.invoke(action, world.ownerA, input)) as {
          ok: boolean;
          error?: { code: string; details?: readonly { field: string; issue: string }[] };
        };
        assertEqual(`${name} is rejected as invalid_argument`, outcome.error?.code, 'invalid_argument');
        assertTrue(
          `${name} is rejected specifically as an unknown field`,
          (outcome.error?.details ?? []).some((entry) => entry.issue === 'unknown_field'),
          `details: ${JSON.stringify(outcome.error?.details)}`,
        );
      }
    } finally {
      world.close();
    }
  });

  return suite;
}
