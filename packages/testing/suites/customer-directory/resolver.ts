/**
 * THE `TenantStoreResolver` SUITE — mandatory and independent of any feature.
 *
 * `TESTING_STANDARD.md` §5.4: the resolver "is itself an isolation boundary, and it is the one
 * every query path depends on", so it carries its own suite. Four of its clauses are asserted
 * below, and the fourth is the one worth being explicit about:
 *
 *   - UNKNOWN ORGANIZATION FAILS CLOSED, "asserted for each of those cases separately, because
 *     'fails closed' is a claim about the DEFAULT BRANCH and the default branch is where it
 *     will be got wrong". So no entry, a suspended entry, a migrating entry and an entry naming
 *     a binding the composition root never configured are four separate cases, and a fifth
 *     asserts they produce the SAME answer.
 *   - NO CALLER CAN SELECT A BINDING. Asserted as a negative through the pipeline: the value
 *     the resolver receives is recorded, and it must equal the AUTHENTICATED principal's
 *     Organization and never anything the request carried — including when the request carries
 *     a contradicting one.
 *   - ONLY CORE-CONFIGURED BINDINGS ARE RETURNED.
 *   - NO CROSS-TENANT HANDLE LEAK, and no memoization that outlives its scope: two principals
 *     in two Organizations, resolved in the same process, get handles that read different rows.
 *
 * The resolver is NOT stubbed anywhere in this run — §5.4's "an isolation suite that replaces
 * the resolver with a test double proves the feature, not the model". Where a wrapper is used
 * it is a counting pass-through around the real resolver, and that is stated at the call site.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import { CUST_A_ANNA, CUST_B_ANNA, ORG_A, ORG_B, ORG_UNMAPPED, makePrincipal, PERMISSION_IDS, BIZ_A_NORTH } from '../../harness/world.ts';
import { createStaticTenantStoreResolver } from '../../../../platform/core/tenancy/tenant-store-resolver.ts';
import type { TenantStoreMapping, TenantStoreResolver } from '../../../../platform/core/tenancy/tenant-store-resolver.ts';
import type { TenantScopedStore } from '../../../../platform/core/storage/store.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

const EXPECTED_UNAVAILABLE = { code: 'unavailable', message: 'A dependency is unavailable.' };

const A_STORE = { select: async () => ({ ok: true as const, value: [] }), write: async () => ({ ok: true as const, value: undefined }) } as unknown as TenantScopedStore;

export function buildResolverSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('TenantStoreResolver — the isolation boundary every query path depends on');

  function resolverWith(mappings: readonly TenantStoreMapping[], configured: readonly string[]): TenantStoreResolver {
    return createStaticTenantStoreResolver(mappings, (bindingName) =>
      configured.includes(bindingName) ? A_STORE : undefined,
    );
  }

  suite.test('an Organization with NO mapping fails closed', async () => {
    const resolver = resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'active' }], ['DB_TENANT']);
    expectOk('control: a mapped Organization resolves', await resolver.resolve(ORG_A));
    expectError('an unmapped Organization gets no handle', await resolver.resolve(ORG_UNMAPPED), EXPECTED_UNAVAILABLE);
  });

  suite.test('a SUSPENDED mapping fails closed', async () => {
    const resolver = resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'suspended' }], ['DB_TENANT']);
    expectError('a suspended Organization gets no handle', await resolver.resolve(ORG_A), EXPECTED_UNAVAILABLE);
  });

  suite.test('a MIGRATING mapping fails closed', async () => {
    const resolver = resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'migrating' }], ['DB_TENANT']);
    expectError('a migrating Organization gets no handle', await resolver.resolve(ORG_A), EXPECTED_UNAVAILABLE);
  });

  suite.test('a mapping naming a binding the composition root never configured fails closed — no fallback, no first binding, no last-used', async () => {
    const resolver = resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TYPO', state: 'active' }], ['DB_TENANT']);
    expectError('an unconfigured binding name gets no handle', await resolver.resolve(ORG_A), EXPECTED_UNAVAILABLE);
  });

  suite.test('all four failing cases produce the IDENTICAL answer, so none is distinguishable from another', async () => {
    const unmapped = await resolverWith([], ['DB_TENANT']).resolve(ORG_A);
    const suspended = await resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'suspended' }], ['DB_TENANT']).resolve(ORG_A);
    const migrating = await resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'migrating' }], ['DB_TENANT']).resolve(ORG_A);
    const misconfigured = await resolverWith([{ organizationId: ORG_A, bindingName: 'DB_TYPO', state: 'active' }], ['DB_TENANT']).resolve(ORG_A);
    const rendered = [unmapped, suspended, migrating, misconfigured].map((entry) => JSON.stringify(entry));
    assertEqual('four identical answers', new Set(rendered).size, 1);
  });

  suite.test('an empty mapping table — the production default — serves nothing at all', async () => {
    const resolver = resolverWith([], ['DB_TENANT']);
    expectError('the empty table fails closed', await resolver.resolve(ORG_A), EXPECTED_UNAVAILABLE);
    expectError('for every Organization', await resolver.resolve(ORG_B), EXPECTED_UNAVAILABLE);
  });

  suite.test('through the pipeline, an unmapped Organization gets unavailable and no data', async () => {
    const world = await makeWorld();
    try {
      const stranger = makePrincipal({
        principalId: 'prn_stranger',
        organizationId: ORG_UNMAPPED,
        authorizedBusinessIds: [BIZ_A_NORTH],
        grants: PERMISSION_IDS.map((permissionId) => ({ permissionId, scope: 'organization' as const })),
      });
      expectError(
        'a fully privileged principal of an unmapped Organization gets unavailable',
        await world.invoke(world.actions.get, stranger, { customer_id: CUST_A_ANNA }),
        EXPECTED_UNAVAILABLE,
      );
      assertEqual('and nothing was audited, because there was nowhere to audit it', world.auditRows().length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('the resolver receives the AUTHENTICATED Organization and nothing a caller supplied', async () => {
    const world = await makeWorld();
    try {
      const seen: string[] = [];
      // A counting pass-through around the REAL resolver, not a double.
      const spying: TenantStoreResolver = {
        async resolve(organizationId: string) {
          seen.push(organizationId);
          return world.resolver.resolve(organizationId);
        },
      };
      const { invokeAction } = await import('../../../../platform/core/action/pipeline.ts');
      const { asAnyAction } = await import('../../../../platform/core/action/action.ts');
      const dependencies = { ...world.dependencies, resolver: spying };

      // ---- PART 1: an ordinary, well-formed read. The store IS resolved, and the value it is
      // resolved for comes from the authenticated principal.
      expectOk(
        'control: the read succeeds, so a store really was needed',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_spy_ok', correlationId: 'cor_spy_ok' },
          { customer_id: CUST_A_ANNA },
        ),
      );
      assertEqual('the resolver was consulted exactly once', seen.length, 1);
      assertEqual('with the authenticated Organization', seen[0], ORG_A);

      // ---- PART 2: a request loudly asserting a different Organization in three places at
      // once. It is rejected at input validation, and — since docs/decisions/0013 made storage
      // resolution LAZY (control 7) — the rejection costs no store handle at all.
      //
      // WHY THIS HALF IS NOW SPLIT OUT. Before 0013 the store was resolved at the top of the
      // pipeline, so this request also produced exactly one resolution and the case could make
      // its point in a single invocation. It no longer does: the assertion "consulted exactly
      // once" would be measuring the denial-summary write rather than the customer lookup, and
      // a case that passes for a reason it does not state is the failure mode this suite is
      // built against.
      const before = seen.length;
      expectError(
        'the contradicting request is refused',
        await invokeAction(
          dependencies,
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_spy', correlationId: 'cor_spy' },
          { customer_id: CUST_A_ANNA, tenant_id: ORG_B, organization_id: ORG_B },
        ),
        {
          code: 'invalid_argument',
          message: 'The request is not valid.',
          details: [
            { field: 'tenant_id', issue: 'unknown_field' },
            { field: 'organization_id', issue: 'unknown_field' },
          ],
        },
      );
      assertTrue(
        'and never with the one the request named — on either invocation',
        !seen.includes(ORG_B),
        'a caller-supplied Organization reached the resolver',
      );
      assertTrue(
        'every resolution in this case was for the authenticated Organization',
        seen.every((entry) => entry === ORG_A),
        `the resolver saw ${JSON.stringify(seen)}`,
      );
      // The one resolution the refusal DID cause is the denial-summary write, which is
      // tenant-scoped to the caller's own Organization. Named explicitly so the count is not a
      // mystery to the next reader.
      assertTrue(
        'the refusal resolved a store only to write its own denial summary, if at all',
        seen.length - before <= 1,
        `a refused request resolved ${seen.length - before} stores`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('handles are per Organization and are not memoized across tenants within one process', async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const storeB = await world.storeFor(ORG_B);
      const fromA = expectOk('A reads through its own handle', await storeA.select({ table: 'customer', columns: ['customer_id'], limit: 100 })) as readonly { customer_id: string }[];
      const fromB = expectOk('B reads through its own handle', await storeB.select({ table: 'customer', columns: ['customer_id'], limit: 100 })) as readonly { customer_id: string }[];
      assertTrue('A sees its own row', fromA.some((row) => row.customer_id === CUST_A_ANNA), 'A did not see its own data');
      assertTrue('B sees its own row', fromB.some((row) => row.customer_id === CUST_B_ANNA), 'B did not see its own data');
      assertTrue('A does not see B', !fromA.some((row) => row.customer_id === CUST_B_ANNA), "A's handle returned B's row");
      assertTrue('B does not see A', !fromB.some((row) => row.customer_id === CUST_A_ANNA), "B's handle returned A's row");

      // Re-resolving A after resolving B must still be A's handle, not the last-used one.
      const storeAAgain = await world.storeFor(ORG_A);
      const again = expectOk('A resolves again', await storeAAgain.select({ table: 'customer', columns: ['customer_id'], limit: 100 })) as readonly { customer_id: string }[];
      assertTrue('the second resolution is still A', !again.some((row) => row.customer_id === CUST_B_ANNA), 'the resolver returned the last-used handle');
    } finally {
      world.close();
    }
  });

  return suite;
}
