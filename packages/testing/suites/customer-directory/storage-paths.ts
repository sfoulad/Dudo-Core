/**
 * PER-QUERY-PATH ISOLATION, ENUMERATED RATHER THAN ESTIMATED.
 *
 * `TESTING_STANDARD.md` §5.3: "coverage is per query path, not per endpoint … the set of
 * query paths is enumerated, not estimated … from the storage-boundary call sites, not from
 * the endpoint list." The Customer Directory contract's README §12 names the minimum set.
 *
 * THE ENUMERATION, DERIVED BY READING EVERY `store.` CALL SITE IN THE REPOSITORY rather than
 * from the endpoint list. There are SEVEN, in three files:
 *
 *   apps/customers/data/customer-repository.ts
 *     1. findById            detail read; also the read half of update, archive, restore, move
 *     2. findDisplayNameKey  cursor continuation read
 *     3. page                list read AND search read (one function, two callers)
 *     4. insertOperation     create write
 *     5. updateOperation     update write, archive write, restore write, move write
 *   platform/core/tenancy/business-directory.ts
 *     6. existsInTenant      Business existence read, for create / move / filtered collections
 *   platform/core/audit/store-audit-sink.ts
 *     7. toOperation         audit write (both the batched form and the standalone denial form)
 *
 * The contract's list names twelve paths; they map onto these seven functions, because
 * "update read", "archive write", "move read" and so on are the same two functions reached
 * from different Actions. Both views are exercised: the function-level view here, and the
 * Action-level view in `isolation.ts`.
 *
 * VERIFIED BY: `grep -rn "store\.\(select\|write\)" apps platform` returning exactly these
 * call sites plus the two adapter implementations. That command is the derivation, and it is
 * stated so a reviewer can re-run it rather than take the list on trust.
 *
 * THESE TESTS CALL THE REPOSITORY FUNCTIONS DIRECTLY, with a handle obtained from the real
 * `TenantStoreResolver`. §5.4 requires the resolver to be exercised and not stubbed: "an
 * isolation suite that replaces the resolver with a test double proves the feature, not the
 * model."
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_B_EAST,
  CUST_A_ANNA,
  CUST_B_ANNA,
  ORG_A,
  ORG_B,
} from '../../harness/world.ts';
import {
  findById,
  findDisplayNameKey,
  insertOperation,
  page,
  updateOperation,
} from '../../../../apps/customers/data/customer-repository.ts';
import { COLUMN } from '../../../../apps/customers/data/schema.ts';
import { createStoreBusinessDirectory } from '../../../../platform/core/tenancy/business-directory.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

export function buildStoragePathSuite(makeWorld: MakeWorld, readsOnly = false): Suite {
  const suite = new TestSuite(
    readsOnly
      ? 'storage query paths — READ paths only'
      : 'storage query paths — all seven storage-boundary call sites',
  );

  suite.test('path 1 — findById: an Organization B customer_id resolves to nothing', async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const own = expectOk('control: findById resolves an own row', await findById(storeA, CUST_A_ANNA));
      assertTrue('control: the own row is present', own !== null, 'the control row did not resolve');
      const foreign = expectOk('findById returns cleanly for a foreign id', await findById(storeA, CUST_B_ANNA));
      assertEqual(`${ISOLATION} findById on Organization B's customer_id`, foreign, null);
    } finally {
      world.close();
    }
  });

  suite.test('path 2 — findDisplayNameKey: a cursor anchor in Organization B resolves to nothing', async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const own = expectOk('control: the own anchor resolves', await findDisplayNameKey(storeA, CUST_A_ANNA));
      assertTrue('control: the own anchor key is a string', typeof own === 'string', 'the control anchor did not resolve');
      const foreign = expectOk('findDisplayNameKey returns cleanly', await findDisplayNameKey(storeA, CUST_B_ANNA));
      assertEqual(`${ISOLATION} a cursor anchor naming Organization B's row`, foreign, null);
    } finally {
      world.close();
    }
  });

  suite.test("path 3 — page: a business predicate naming Organization B's Business returns nothing", async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const own = expectOk(
        'control: page over an own Business returns rows',
        await page(storeA, {
          businessIds: [BIZ_A_NORTH],
          statuses: ['active'],
          search: null,
          anchor: null,
          pageSize: 50,
        }),
      ) as { rows: readonly Record<string, unknown>[] };
      assertTrue('control: the own page is not empty', own.rows.length > 0, 'the control page was empty');

      // THE ASSERTION THE BUSINESS PREDICATE CANNOT MASK. The business predicate here names
      // Organization B's Business, so it is not narrowing towards Organization A at all.
      // Only the tenant predicate can produce an empty result.
      const foreign = expectOk(
        'page over a foreign Business returns cleanly',
        await page(storeA, {
          businessIds: [BIZ_B_EAST],
          statuses: ['active'],
          search: null,
          anchor: null,
          pageSize: 50,
        }),
      ) as { rows: readonly Record<string, unknown>[] };
      assertEqual(
        `${ISOLATION} page with Organization B's business_id, from Organization A's handle`,
        foreign.rows.length,
        0,
      );
    } finally {
      world.close();
    }
  });

  suite.test('path 6 — existsInTenant: an Organization B Business is indistinguishable from one that does not exist', async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const directory = createStoreBusinessDirectory();
      const own = expectOk('control: an own Business exists', await directory.existsInTenant(storeA, BIZ_A_NORTH));
      assertEqual('control: the own Business is found', own, true);
      const foreign = expectOk('the lookup returns cleanly', await directory.existsInTenant(storeA, BIZ_B_EAST));
      assertEqual(`${ISOLATION} Organization B's Business is invisible to Organization A`, foreign, false);
    } finally {
      world.close();
    }
  });

  suite.test('THE STORAGE-BOUNDARY BYPASS TEST — every statement the run emits is tenant-scoped, with the exception list stated here', async () => {
    const world = await makeWorld();
    try {
      // Exercise a broad spread of Actions, then assert a property of EVERY statement that
      // reached the engine rather than of the paths someone remembered to check. This is
      // `TESTING_STANDARD.md` §5.5: "the port cannot emit a tenant-scoped read or write
      // without a tenant predicate … this test is structural: it asserts a property of ALL
      // query paths."
      await world.invoke(world.actions.list, world.ownerA, { page_size: 2 });
      await world.invoke(world.actions.search, world.ownerA, { query: 'anna' });
      await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA });
      await world.invoke(world.actions.create, world.ownerA, {
        business_id: BIZ_A_NORTH,
        display_name: 'Boundary Probe',
        customer_type: 'company',
      });
      await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, country: 'BH' });
      await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA });
      await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ANNA });
      await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ANNA, business_id: 'biz_alpha_south' });
      const cursored = (await world.invoke(world.actions.list, world.ownerA, { page_size: 1 })) as {
        ok: boolean;
        value?: { next_cursor: string | null };
      };
      if (cursored.ok && cursored.value?.next_cursor) {
        await world.invoke(world.actions.list, world.ownerA, { page_size: 1, cursor: cursored.value.next_cursor });
      }

      const statements = world.harness.statements;
      assertTrue('control: statements were emitted', statements.length > 5, `only ${statements.length} statements ran`);

      // THE ENUMERATED EXCEPTION LIST. Genuinely tenant-independent storage would go here, by
      // name, so that an addition is visible in a diff. THERE ARE NONE: every table this slice
      // touches — `customer`, `audit_event` and Core's `business` — is tenant-owned.
      const TENANT_INDEPENDENT_TABLES: readonly string[] = [];

      const offenders = statements.filter((statement) => {
        const sql = statement.sql;
        if (TENANT_INDEPENDENT_TABLES.some((table) => sql.includes(` ${table} `))) {
          return false;
        }
        if (sql.startsWith('INSERT INTO')) {
          // The insert form of the same guarantee: the boundary SETS the column.
          return !/\(tenant_id,/.test(sql);
        }
        return !sql.includes('WHERE tenant_id = ?');
      });

      assertEqual(
        `${ISOLATION} every emitted statement carries the tenant predicate or sets the tenant column`,
        offenders.map((statement) => statement.sql).join(' | '),
        '',
      );
    } finally {
      world.close();
    }
  });

  if (readsOnly) {
    suite.skip(
      'paths 4, 5 and 7 — the three write paths',
      'NOT RUN under this control. A boundary-bypass store that reached the engine directly ' +
        'would have to supply its own tenant column on INSERT, which the harness does not ' +
        'model; running the write paths under it would measure the harness, not the boundary.',
    );
    return suite;
  }

  suite.test('path 4 — insertOperation: a write from Organization A lands in Organization A and is invisible to Organization B', async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const storeB = await world.storeFor(ORG_B);
      const write = insertOperation({
        customerId: 'cust_alpha_path4x',
        businessId: BIZ_A_NORTH,
        displayName: 'Path Four Synthetic',
        displayNameKey: ' path four synthetic',
        customerType: 'company',
        email: null,
        emailKey: null,
        phone: null,
        phoneKey: null,
        country: null,
        address: null,
        notes: null,
        createdAt: world.clock.now(),
        principalId: 'prn_owner_alpha',
      });
      expectOk('control: the insert commits', await storeA.write([write]));
      const landed = world.customerRows().find((row) => row.customer_id === 'cust_alpha_path4x');
      assertEqual('control: the row exists', landed?.customer_id, 'cust_alpha_path4x');
      assertEqual(`${ISOLATION} the inserted row carries Organization A's tenant`, landed?.tenant_id, ORG_A);
      const seenFromB = expectOk('the read from B returns cleanly', await findById(storeB, 'cust_alpha_path4x'));
      assertEqual(`${ISOLATION} Organization B cannot see Organization A's new row`, seenFromB, null);
    } finally {
      world.close();
    }
  });

  suite.test("path 5 — updateOperation: an update aimed at Organization B's customer_id changes nothing", async () => {
    const world = await makeWorld();
    try {
      const storeA = await world.storeFor(ORG_A);
      const before = JSON.stringify(world.customerRows(ORG_B));

      expectOk(
        'control: an update to an own row commits and changes it',
        await storeA.write([updateOperation(CUST_A_ANNA, { [COLUMN.displayName]: 'Control Renamed' })]),
      );
      const control = world.customerRows(ORG_A).find((row) => row.customer_id === CUST_A_ANNA);
      assertEqual('control: the own row changed', control?.display_name, 'Control Renamed');

      // The write is accepted by the port and simply matches no row. There is no error here
      // and there should not be: the tenant predicate makes the foreign row invisible rather
      // than protected by a check that could be forgotten.
      expectOk(
        'the cross-tenant update returns cleanly',
        await storeA.write([updateOperation(CUST_B_ANNA, { [COLUMN.displayName]: 'Written across the boundary' })]),
      );
      assertEqual(
        `${ISOLATION} every Organization B row is byte-unchanged after a cross-tenant write`,
        JSON.stringify(world.customerRows(ORG_B)),
        before,
      );
    } finally {
      world.close();
    }
  });

  suite.test('path 7 — audit write: the record carries the acting tenant and appears in no other', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: an audited Action succeeds',
        await world.invoke(world.actions.create, world.ownerA, {
          business_id: BIZ_A_NORTH,
          display_name: 'Audit Path Synthetic',
          customer_type: 'company',
        }),
      );
      const rows = world.auditRows();
      assertEqual('control: exactly one audit record was written', rows.length, 1);
      assertEqual(`${ISOLATION} the audit record carries the acting Organization`, rows[0].tenant_id, ORG_A);
      assertEqual(`${ISOLATION} Organization B has no audit record`, world.auditRows(ORG_B).length, 0);
    } finally {
      world.close();
    }
  });

  return suite;
}
