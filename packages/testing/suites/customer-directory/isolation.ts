/**
 * THE CANONICAL TWO-ORGANIZATION ISOLATION SUITE, at the Action level.
 *
 * `TESTING_STANDARD.md` §5.2, and `packages/contracts/apps/customers/README.md` §12: acting
 * as a FULLY PRIVILEGED principal in Organization A — an owner holding all nine permissions
 * at organization scope — attempt to read, list, search, update, archive, restore, move,
 * enumerate and infer Organization B's records through every surface of the eight in-scope
 * Actions. Every attempt returns `not_found` or an empty result.
 *
 * EVERY CASE IS A PAIR. A negative assertion is preceded by a POSITIVE CONTROL that must
 * succeed on the equivalent of Organization A's own data. Without the control, a cross-tenant
 * case would go green the moment the fixture, the store or the permission set broke — which
 * is the "passes for the wrong reason" trap. `expectError` then compares the whole error
 * value, so a `not_found` case that received `forbidden`, `invalid_argument` or `internal`
 * fails.
 *
 * ASSERTIONS THAT ARE ABOUT TENANT ISOLATION CARRY THE `ISOLATION:` LABEL, and nothing else
 * does. That labelling is what lets the negative-control run report which cases are sensitive
 * to the tenant predicate and which merely look as though they are.
 *
 * THE THREE GAP-CLOSING CASES ARE MARKED `[gap-closer]`. `core-agent` reported that its own
 * negative control left three collection assertions green, because narrowing by
 * `business_id` masks a missing `tenant_id`: Organization A's businesses do not match
 * Organization B's rows, so the collection looks isolated whether or not the tenant predicate
 * is there. The three cases below are constructed so that the business predicate CANNOT mask
 * the tenant predicate:
 *
 *   1. SHARED BUSINESS ID VALUE. Organization B holds a customer filed under a `business_id`
 *      whose VALUE equals one of Organization A's. A listing carrying `business_id` and no
 *      `tenant_id` then returns both Organizations' rows. Nothing in `Dudo-Core` enforces
 *      platform-wide uniqueness of Business identifiers today — there is no cross-tenant
 *      Business registry, and `business-directory.ts` reads a tenant-scoped table — so this
 *      state is representable in the product as built, not only in the harness.
 *   2. AUTHORIZED SET NAMING A FOREIGN BUSINESS. An Organization A principal whose authorized
 *      business set contains Organization B's Business. The business predicate then points
 *      AT Organization B, so it cannot possibly stand in for the tenant predicate. This
 *      construction does not depend on identifier collision at all, and it is the direct test
 *      of the contract's own words: a business predicate "is an ADDITIONAL narrowing and never
 *      a SUBSTITUTE".
 *   3. THE SAME, THROUGH SEARCH, because search chooses its candidate set differently and
 *      shares only `page`.
 *
 * On construction 2 and `TESTING_STANDARD.md` §5.2's "fixtures and seeds contain no
 * cross-tenant reference": the principal is a deliberate, named fault injection into the
 * AUTHORIZATION context — the thing the test is proving the storage boundary does not trust —
 * and no seeded ROW in either Organization references the other. It is the analogue of the
 * negative control: a fixture that could never be wrong cannot show the boundary holding.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  BIZ_B_EAST,
  BIZ_NOWHERE,
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  CUST_A_SOUTH,
  CUST_B_ANNA,
  CUST_B_SECOND,
  CUST_NOWHERE,
  EXPECTED_NOT_FOUND,
  ORG_A,
  ORG_B,
  PERMISSION_IDS,
  makePrincipal,
} from '../../harness/world.ts';
import type { WorldOptions } from '../../harness/world.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

type Collection = { readonly data: readonly { readonly customer_id: string }[] };

function ids(value: unknown): string[] {
  return (value as Collection).data.map((row) => row.customer_id);
}

const ORG_B_CUSTOMER_IDS = [CUST_B_ANNA, CUST_B_SECOND, 'cust_beta_collid1'];

function assertNoOrganizationBRows(label: string, value: unknown): void {
  const returned = ids(value);
  for (const foreign of ORG_B_CUSTOMER_IDS) {
    assertTrue(
      label,
      !returned.includes(foreign),
      `Organization B's customer ${foreign} appeared in an Organization A collection: ${returned.join(', ')}`,
    );
  }
}

export function buildIsolationSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('tenant isolation — eight in-scope Actions, Organization A against Organization B');

  suite.test('GetCustomer: own record reads; Organization B record is not_found', async () => {
    const world = await makeWorld();
    try {
      expectOk('control: GetCustomer on own record', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectError(
        `${ISOLATION} GetCustomer on Organization B's customer_id`,
        await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test("UpdateCustomer: Organization B's record is not_found and is not modified", async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: UpdateCustomer on own record',
        await world.invoke(world.actions.update, world.ownerA, {
          customer_id: CUST_A_ANNA,
          display_name: 'Anna Smith-Revised',
        }),
      );
      const before = world.customerRows(ORG_B).find((row) => row.customer_id === CUST_B_ANNA);
      expectError(
        `${ISOLATION} UpdateCustomer on Organization B's customer_id`,
        await world.invoke(world.actions.update, world.ownerA, {
          customer_id: CUST_B_ANNA,
          display_name: 'Written across the tenant boundary',
        }),
        EXPECTED_NOT_FOUND,
      );
      const after = world.customerRows(ORG_B).find((row) => row.customer_id === CUST_B_ANNA);
      assertEqual(
        `${ISOLATION} Organization B's row is byte-unchanged after a cross-tenant update`,
        JSON.stringify(after),
        JSON.stringify(before),
      );
    } finally {
      world.close();
    }
  });

  suite.test("ArchiveCustomer: Organization B's record is not_found and stays active", async () => {
    const world = await makeWorld();
    try {
      expectOk('control: ArchiveCustomer on own record', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectError(
        `${ISOLATION} ArchiveCustomer on Organization B's customer_id`,
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      const row = world.customerRows(ORG_B).find((entry) => entry.customer_id === CUST_B_ANNA);
      assertEqual(`${ISOLATION} Organization B's row status after a cross-tenant archive`, row?.status, 'active');
    } finally {
      world.close();
    }
  });

  suite.test('RestoreCustomer: own archived record restores; Organization B record is not_found', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: RestoreCustomer on own archived record',
        await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ARCHIVED }),
      );
      expectError(
        `${ISOLATION} RestoreCustomer on Organization B's customer_id`,
        await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test('MoveCustomerToBusiness: a source customer in Organization B is not_found', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: move own customer between own Businesses',
        await world.invoke(world.actions.move, world.ownerA, {
          customer_id: CUST_A_ANNA,
          business_id: BIZ_A_SOUTH,
        }),
      );
      expectError(
        `${ISOLATION} MoveCustomerToBusiness with Organization B's customer as the source`,
        await world.invoke(world.actions.move, world.ownerA, {
          customer_id: CUST_B_ANNA,
          business_id: BIZ_A_SOUTH,
        }),
        EXPECTED_NOT_FOUND,
      );
      const row = world.customerRows(ORG_B).find((entry) => entry.customer_id === CUST_B_ANNA);
      assertEqual(`${ISOLATION} Organization B's row keeps its own business_id`, row?.business_id, BIZ_B_EAST);
    } finally {
      world.close();
    }
  });

  suite.test("MoveCustomerToBusiness: a destination Business in Organization B is not_found, identical to one that exists nowhere", async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: move own customer to another own Business',
        await world.invoke(world.actions.move, world.ownerA, {
          customer_id: CUST_A_SOUTH,
          business_id: BIZ_A_NORTH,
        }),
      );
      expectError(
        `${ISOLATION} MoveCustomerToBusiness to Organization B's Business`,
        await world.invoke(world.actions.move, world.ownerA, {
          customer_id: CUST_A_ANNA,
          business_id: BIZ_B_EAST,
        }),
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'MoveCustomerToBusiness to a Business that exists nowhere',
        await world.invoke(world.actions.move, world.ownerA, {
          customer_id: CUST_A_ANNA,
          business_id: BIZ_NOWHERE,
        }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test("CreateCustomer: Organization B's business_id is not_found; the created row lands in Organization A", async () => {
    const world = await makeWorld();
    try {
      const created = expectOk(
        'control: CreateCustomer in an own Business',
        await world.invoke(world.actions.create, world.ownerA, {
          business_id: BIZ_A_NORTH,
          display_name: 'New Synthetic Customer',
          customer_type: 'company',
        }),
      ) as { customer_id: string };
      const landed = world.customerRows().find((row) => row.customer_id === created.customer_id);
      assertEqual(`${ISOLATION} a created row carries the acting principal's tenant`, landed?.tenant_id, ORG_A);

      expectError(
        `${ISOLATION} CreateCustomer naming Organization B's business_id`,
        await world.invoke(world.actions.create, world.ownerA, {
          business_id: BIZ_B_EAST,
          display_name: 'Should Never Exist',
          customer_type: 'company',
        }),
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'CreateCustomer naming a business_id that exists nowhere',
        await world.invoke(world.actions.create, world.ownerA, {
          business_id: BIZ_NOWHERE,
          display_name: 'Should Never Exist',
          customer_type: 'company',
        }),
        EXPECTED_NOT_FOUND,
      );
      assertEqual(
        `${ISOLATION} Organization B gained no rows`,
        world.customerRows(ORG_B).length,
        2,
      );
    } finally {
      world.close();
    }
  });

  suite.test('ListCustomers, unfiltered: no Organization B row is enumerated', async () => {
    const world = await makeWorld();
    try {
      const page = expectOk('control: ListCustomers returns own rows', await world.invoke(world.actions.list, world.ownerA, { page_size: 100 }));
      assertTrue('control: the listing is not empty', ids(page).length > 0, 'the listing returned nothing, so absence proves nothing');
      assertNoOrganizationBRows(`${ISOLATION} ListCustomers enumerates only Organization A`, page);
    } finally {
      world.close();
    }
  });

  suite.test("ListCustomers with Organization B's business_id: not_found, identical to a Business that exists nowhere", async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: ListCustomers filtered to an own Business',
        await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_A_NORTH }),
      );
      expectError(
        `${ISOLATION} ListCustomers filtered to Organization B's Business`,
        await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_B_EAST }),
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'ListCustomers filtered to a Business that exists nowhere',
        await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_NOWHERE }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test('SearchCustomers: a term matching an Organization B customer returns only Organization A rows', async () => {
    const world = await makeWorld();
    try {
      // 'anna' is a prefix of a token in BOTH 'Anna Smith' (Organization A) and
      // 'Anna Smithson' (Organization B). The term is chosen so that a missing tenant
      // predicate would produce a visible extra row rather than an empty difference.
      const page = expectOk('control: the search matches at least one own row', await world.invoke(world.actions.search, world.ownerA, { query: 'anna' }));
      assertTrue('control: the search is not empty', ids(page).length > 0, 'the search returned nothing, so absence proves nothing');
      assertNoOrganizationBRows(`${ISOLATION} SearchCustomers matches only Organization A`, page);
    } finally {
      world.close();
    }
  });

  suite.test("SearchCustomers with Organization B's business_id: not_found", async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: SearchCustomers filtered to an own Business',
        await world.invoke(world.actions.search, world.ownerA, { query: 'anna', business_id: BIZ_A_NORTH }),
      );
      expectError(
        `${ISOLATION} SearchCustomers filtered to Organization B's Business`,
        await world.invoke(world.actions.search, world.ownerA, { query: 'anna', business_id: BIZ_B_EAST }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  // -------------------------------------------------------------------------
  // The three gap-closers.
  // -------------------------------------------------------------------------

  suite.test('[gap-closer] ListCustomers when Organization B uses the SAME business_id value', async () => {
    const world = await makeWorld({ withSharedBusinessIdCollision: true });
    try {
      const page = expectOk(
        'control: the listing returns own rows',
        await world.invoke(world.actions.list, world.ownerA, { page_size: 100 }),
      );
      assertTrue('control: the listing is not empty', ids(page).length > 0, 'the listing returned nothing');
      // 'Aaa Collision Ltd' sorts FIRST under the fixed order, so a leaked row lands on page
      // one rather than beyond the page boundary where a small page size could hide it.
      assertNoOrganizationBRows(
        `${ISOLATION} a business_id shared by two Organizations does not merge their directories`,
        page,
      );
    } finally {
      world.close();
    }
  });

  suite.test("[gap-closer] ListCustomers when the authorized business set names Organization B's Business", async () => {
    const world = await makeWorld();
    try {
      // A deliberate fault injected into the AUTHORIZATION context, which is exactly what the
      // storage boundary is not allowed to trust. The business predicate now points at
      // Organization B, so it cannot stand in for the tenant predicate.
      const misScoped = makePrincipal({
        principalId: 'prn_owner_alpha_misscoped',
        organizationId: ORG_A,
        authorizedBusinessIds: [BIZ_A_NORTH, BIZ_B_EAST],
        grants: PERMISSION_IDS.map((permissionId) => ({ permissionId, scope: 'organization' as const })),
      });
      const page = expectOk('control: the listing still succeeds', await world.invoke(world.actions.list, misScoped, { page_size: 100 }));
      assertTrue('control: the listing is not empty', ids(page).length > 0, 'the listing returned nothing');
      assertNoOrganizationBRows(
        `${ISOLATION} a business predicate naming Organization B returns no Organization B rows`,
        page,
      );
    } finally {
      world.close();
    }
  });

  suite.test("[gap-closer] SearchCustomers when the authorized business set names Organization B's Business", async () => {
    const world = await makeWorld();
    try {
      const misScoped = makePrincipal({
        principalId: 'prn_owner_alpha_misscoped',
        organizationId: ORG_A,
        authorizedBusinessIds: [BIZ_A_NORTH, BIZ_B_EAST],
        grants: PERMISSION_IDS.map((permissionId) => ({ permissionId, scope: 'organization' as const })),
      });
      const page = expectOk('control: the search still succeeds', await world.invoke(world.actions.search, misScoped, { query: 'anna' }));
      assertTrue('control: the search is not empty', ids(page).length > 0, 'the search returned nothing');
      assertNoOrganizationBRows(
        `${ISOLATION} a searched business predicate naming Organization B returns no Organization B rows`,
        page,
      );
    } finally {
      world.close();
    }
  });

  suite.test('[gap-closer] ListCustomers explicitly filtered to a business_id shared with Organization B', async () => {
    const world = await makeWorld({ withSharedBusinessIdCollision: true });
    try {
      const page = expectOk(
        'control: the filtered listing succeeds',
        await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_A_NORTH, page_size: 100 }),
      );
      assertTrue('control: the filtered listing is not empty', ids(page).length > 0, 'the listing returned nothing');
      assertNoOrganizationBRows(
        `${ISOLATION} an explicit business_id filter does not reach the same id in another Organization`,
        page,
      );
    } finally {
      world.close();
    }
  });

  // -------------------------------------------------------------------------
  // Cursor, audit and the resolver
  // -------------------------------------------------------------------------

  suite.test('a cursor issued in Organization A is rejected in Organization B, with the single cursor error', async () => {
    const world = await makeWorld();
    try {
      const first = expectOk(
        'control: a first page is issued with a cursor',
        await world.invoke(world.actions.list, world.ownerA, { page_size: 1 }),
      ) as { next_cursor: string | null };
      assertTrue('control: the first page issued a cursor', first.next_cursor !== null, 'no cursor was issued');
      const replayed = await world.invoke(world.actions.list, world.ownerB, {
        page_size: 1,
        cursor: first.next_cursor as string,
      });
      expectError(
        `${ISOLATION} an Organization A cursor presented by Organization B`,
        replayed,
        { code: 'invalid_argument', message: 'The request is not valid.', details: [{ field: 'cursor', issue: 'invalid_cursor' }] },
      );
    } finally {
      world.close();
    }
  });

  suite.test("the cursor's TENANT BINDING is what rejects it — the same cursor is accepted by the Organization it was issued for", async () => {
    const world = await makeWorld();
    try {
      // The cursor's tenant control is a salted DIGEST comparison inside the codec, not a SQL
      // predicate, so the storage negative controls cannot exercise it. This case is its own
      // sensitivity check: the identical cursor, the identical binding and the identical clock
      // are accepted for the Organization that issued it and rejected for the other. Only the
      // tenant differs, so only the tenant comparison can be causing the rejection.
      const binding = { collection: 'list', businessId: null, status: 'active', pageSize: 1, query: null };
      const nowMs = world.clock.nowMs();
      const cursor = await world.cursors.encode(ORG_A, { anchorId: CUST_A_ANNA, binding }, nowMs);

      const accepted = await world.cursors.decode(ORG_A, cursor, binding, nowMs);
      expectOk('control: the issuing Organization can use its own cursor', accepted);
      assertEqual('control: and it decodes to the anchor it was issued for', (accepted as { value: string }).value, CUST_A_ANNA);

      expectError(
        `${ISOLATION} the identical cursor presented for the other Organization`,
        await world.cursors.decode(ORG_B, cursor, binding, nowMs),
        { code: 'invalid_argument', message: 'The request is not valid.', details: [{ field: 'cursor', issue: 'invalid_cursor' }] },
      );
    } finally {
      world.close();
    }
  });

  suite.test("an audited Action's audit record lands in the acting Organization and nowhere else", async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'control: an audited Action succeeds',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
      );
      const inA = world.auditRows(ORG_A);
      const inB = world.auditRows(ORG_B);
      assertEqual('control: Organization A has an audit record', inA.length, 1);
      assertEqual(`${ISOLATION} Organization B has no audit record from Organization A's action`, inB.length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('an identifier that exists nowhere is not_found, identical to a foreign-Organization identifier', async () => {
    const world = await makeWorld();
    try {
      const foreign = await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA });
      const nowhere = await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE });
      expectError(`${ISOLATION} foreign-Organization identifier`, foreign, EXPECTED_NOT_FOUND);
      expectError('identifier that exists nowhere', nowhere, EXPECTED_NOT_FOUND);
      assertEqual(
        `${ISOLATION} the two not_found values are identical`,
        JSON.stringify(foreign),
        JSON.stringify(nowhere),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
