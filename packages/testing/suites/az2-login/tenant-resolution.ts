/**
 * ===========================================================================================
 * TENANT ISOLATION THROUGH THE NEW DIRECTORY RESOLVER. `docs/decisions/0006` §0.2.
 * ===========================================================================================
 *
 * WHAT CHANGED, AND WHY IT NEEDS ITS OWN SUITE. `worker-entry.ts` previously composed
 * `createStaticTenantStoreResolver([])` — an EMPTY list — under a comment that said exactly what
 * that meant: *"EMPTY MEANS EVERY ORGANIZATION FAILS CLOSED."* An empty mapping is trivially
 * isolated: it resolves nothing, for anyone, ever. It is now
 * `createDirectoryTenantStoreResolver` over the `tenant_directory` table, and that is the first
 * build in which resolution can SUCCEED.
 *
 * A resolver that can succeed is a resolver that can succeed for the wrong caller. The property
 * that used to be free is now a property that has to be tested, and `0006` §0.2 names the exact
 * shape of the failure it forbids: *"No fallback binding, no default database, no 'probably the
 * shared one'."*
 *
 * ===========================================================================================
 * THE FOUR CAUSES, ONE ANSWER
 * ===========================================================================================
 *
 * `createDirectoryTenantStoreResolver` answers `unavailable()` for a missing entry, a non-active
 * entry, an unreadable directory, and a binding name the factory does not know. This suite
 * exercises all four INDIVIDUALLY and asserts they are indistinguishable, because a caller who
 * could tell "no such Organization" from "that Organization is suspended" has an existence
 * oracle over the tenant list.
 *
 * `expectError` compares the whole error value, so a case that expected `unavailable` and got
 * `not_found` or `internal` FAILS. Without that, every negative case here would go green the
 * moment the fixture broke.
 *
 * ===========================================================================================
 * THE ISOLATION HALF
 * ===========================================================================================
 *
 * Resolving correctly is necessary and not sufficient: the handle handed back must read exactly
 * one Organization's rows. The cases below take the store the DIRECTORY resolver produced — not
 * one built directly in the test — and attempt, as Organization A, to read, enumerate, count
 * and infer Organization B's data. `security.md` §1 requires all four to be impossible, and the
 * fixture is deliberately built so that B's rows EXIST and are visible to the raw engine: a test
 * that passed because there was nothing to leak would prove nothing.
 */

import { readFileSync } from 'node:fs';
import { Suite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import { createSqliteDatabase } from '../../harness/sqlite-d1.ts';
import type { SqliteHarness } from '../../harness/sqlite-d1.ts';
import {
  createControlPlaneDatabase,
  seedOrganization,
  seedTenantDirectory,
} from '../../harness/control-plane-fixture.ts';
import { createD1ControlPlaneStores } from '../../../../platform/core/identity/adapters/d1/d1-control-plane-store.ts';
import { createDirectoryTenantStoreResolver } from '../../../../platform/core/tenancy/directory-tenant-store-resolver.ts';
import { createD1TenantStore } from '../../../../platform/core/storage/adapters/d1/d1-store.ts';
import type { TenantScopedStore } from '../../../../platform/core/storage/store.ts';
import { eq } from '../../../../platform/core/storage/predicate.ts';
import { unavailable } from '../../../../platform/core/kernel/errors.ts';
import { err } from '../../../../platform/core/kernel/result.ts';
import type { TenantDirectoryStore } from '../../../../platform/core/identity/control-plane-store.ts';

const ORG_A = 'org_alpha_0001';
const ORG_B = 'org_beta_0002';
/** Exists nowhere: not in `organization`, not in `tenant_directory`. */
const ORG_UNKNOWN = 'org_ghost_0003';
const TENANT_BINDING = 'DB_TENANT';

const HERE = new URL('./', import.meta.url);
const CUSTOMER_MIGRATION = new URL('../../../../apps/customers/data/migrations/0001_customer.sql', HERE);
const BUSINESS_MIGRATION = new URL('../../../../platform/core/migrations/0002_business.sql', HERE);

const BIZ_A = 'biz_alpha_north0';
const BIZ_B = 'biz_beta_east001';
const CUST_A = 'cust_alpha_anna1';
const CUST_B = 'cust_beta_anna01';

/** A tenant database holding rows for BOTH Organizations. The leak must be possible to find. */
function createTenantDatabase(): SqliteHarness {
  const harness = createSqliteDatabase();
  harness.raw.exec(readFileSync(BUSINESS_MIGRATION, 'utf8'));
  harness.raw.exec(readFileSync(CUSTOMER_MIGRATION, 'utf8'));

  const business = harness.raw.prepare(
    'INSERT INTO business (tenant_id, business_id) VALUES (?, ?)',
  );
  const at = '2026-09-04T09:00:00.000Z';
  business.run(ORG_A, BIZ_A);
  business.run(ORG_B, BIZ_B);

  const customer = harness.raw.prepare(
    'INSERT INTO customer (tenant_id, customer_id, business_id, display_name, display_name_key, ' +
      "customer_type, status, created_at, created_by_principal_id, updated_at, " +
      "updated_by_principal_id) VALUES (?, ?, ?, ?, ?, 'person', 'active', ?, 'prn_fixture', ?, " +
      "'prn_fixture')",
  );
  customer.run(ORG_A, CUST_A, BIZ_A, 'Anna Alpha', 'anna alpha', at, at);
  customer.run(ORG_B, CUST_B, BIZ_B, 'Anna Beta', 'anna beta', at, at);
  return harness;
}

type Fixture = {
  readonly control: SqliteHarness;
  readonly tenant: SqliteHarness;
  readonly resolver: ReturnType<typeof createDirectoryTenantStoreResolver>;
  close(): void;
};

/**
 * The composition under test, wired exactly as `worker-entry.ts` wires it: the real D1 control
 * plane store over the real migration, and the same factory expression — a binding-name equality
 * check with `undefined` for anything else.
 */
function createFixture(
  entries: readonly { organizationId: string; bindingName: string; state: 'active' | 'suspended' | 'migrating' }[],
): Fixture {
  const control = createControlPlaneDatabase();
  const tenant = createTenantDatabase();
  seedOrganization(control, ORG_A);
  seedOrganization(control, ORG_B);
  for (const entry of entries) {
    seedTenantDirectory(control, entry);
  }
  const stores = createD1ControlPlaneStores(control.database);
  const resolver = createDirectoryTenantStoreResolver(
    stores.tenantDirectory,
    (bindingName, organizationId) =>
      bindingName === TENANT_BINDING
        ? createD1TenantStore(tenant.database, organizationId)
        : undefined,
  );
  return {
    control,
    tenant,
    resolver,
    close(): void {
      control.close();
      tenant.close();
    },
  };
}

const BOTH_ACTIVE = [
  { organizationId: ORG_A, bindingName: TENANT_BINDING, state: 'active' as const },
  { organizationId: ORG_B, bindingName: TENANT_BINDING, state: 'active' as const },
];

async function readCustomers(store: TenantScopedStore, limit = 50): Promise<readonly unknown[]> {
  const outcome = await store.select({
    table: 'customer',
    columns: ['customer_id', 'display_name'],
    limit,
  });
  return expectOk('the scoped read succeeds', outcome) as readonly unknown[];
}

export function buildTenantResolutionSuite(): Suite {
  const suite = new Suite('AZ2 — tenant resolution through tenant_directory (0006 §0.2)');

  suite.test('a known, active Organization resolves', async () => {
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      const resolved = await fixture.resolver.resolve(ORG_A);
      expectOk('a directory entry in state active yields a store', resolved);
    } finally {
      fixture.close();
    }
  });

  suite.test('an UNKNOWN Organization fails closed', async () => {
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      expectError(
        `${ISOLATION} an Organization with no directory entry gets no store`,
        await fixture.resolver.resolve(ORG_UNKNOWN),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  suite.test('an EMPTY directory resolves nobody — the old property still holds', async () => {
    const fixture = createFixture([]);
    try {
      expectError(
        `${ISOLATION} an empty directory yields no store for a real Organization`,
        await fixture.resolver.resolve(ORG_A),
        unavailable(),
      );
      expectError(
        `${ISOLATION} an empty directory yields no store for an unknown Organization`,
        await fixture.resolver.resolve(ORG_UNKNOWN),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  suite.test('a suspended entry fails closed and is indistinguishable from absent', async () => {
    const fixture = createFixture([
      { organizationId: ORG_A, bindingName: TENANT_BINDING, state: 'suspended' },
    ]);
    try {
      expectError(
        `${ISOLATION} a suspended Organization gets no store`,
        await fixture.resolver.resolve(ORG_A),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  suite.test('a migrating entry fails closed and is indistinguishable from absent', async () => {
    const fixture = createFixture([
      { organizationId: ORG_A, bindingName: TENANT_BINDING, state: 'migrating' },
    ]);
    try {
      expectError(
        `${ISOLATION} a migrating Organization gets no store`,
        await fixture.resolver.resolve(ORG_A),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  suite.test('an unrecognised binding name fails closed — no fallback binding', async () => {
    // `0006` §0.2 forbids "no fallback binding, no default database, no 'probably the shared
    // one'". The directory names a binding the factory does not know; the correct answer is
    // refusal, and the tempting wrong answer is DB_TENANT.
    const fixture = createFixture([
      { organizationId: ORG_A, bindingName: 'DB_SOMEWHERE_ELSE', state: 'active' },
    ]);
    try {
      expectError(
        `${ISOLATION} an unknown binding name does not fall back to the shared database`,
        await fixture.resolver.resolve(ORG_A),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  suite.test('an unreadable directory fails closed rather than defaulting', async () => {
    const tenant = createTenantDatabase();
    try {
      const broken: TenantDirectoryStore = {
        async findEntry() {
          return err(unavailable());
        },
      };
      const resolver = createDirectoryTenantStoreResolver(broken, (_binding, organizationId) =>
        createD1TenantStore(tenant.database, organizationId),
      );
      expectError(
        `${ISOLATION} a directory that cannot answer yields no store`,
        await resolver.resolve(ORG_A),
        unavailable(),
      );
    } finally {
      tenant.close();
    }
  });

  suite.test('there is no wildcard: resolving A does not make an unknown Organization resolve', async () => {
    // The failure mode this rules out is a resolver that caches, memoises or otherwise widens
    // after a successful resolution. The order matters, so the success comes first.
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      expectOk('A resolves', await fixture.resolver.resolve(ORG_A));
      expectOk('B resolves', await fixture.resolver.resolve(ORG_B));
      expectError(
        `${ISOLATION} an unknown Organization is still refused after two successes`,
        await fixture.resolver.resolve(ORG_UNKNOWN),
        unavailable(),
      );
      expectError(
        `${ISOLATION} the empty string is not a wildcard`,
        await fixture.resolver.resolve(''),
        unavailable(),
      );
      expectError(
        `${ISOLATION} '*' is not a wildcard`,
        await fixture.resolver.resolve('*'),
        unavailable(),
      );
      expectError(
        `${ISOLATION} a SQL wildcard is not interpolated into the lookup`,
        await fixture.resolver.resolve('%'),
        unavailable(),
      );
      expectError(
        `${ISOLATION} a quote-injection attempt does not widen the lookup`,
        await fixture.resolver.resolve("' OR '1'='1"),
        unavailable(),
      );
    } finally {
      fixture.close();
    }
  });

  // -----------------------------------------------------------------------------------------
  // Isolation of the handle the directory produced.
  // -----------------------------------------------------------------------------------------

  suite.test('the resolved store reads only its own Organization (A cannot read B)', async () => {
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      const storeA = expectOk('A resolves', await fixture.resolver.resolve(ORG_A)) as TenantScopedStore;

      const all = (await readCustomers(storeA)) as { customer_id: string }[];
      assertEqual(`${ISOLATION} A enumerates exactly one row`, all.length, 1);
      assertEqual(`${ISOLATION} and it is A's row`, all[0].customer_id, CUST_A);

      const targeted = expectOk(
        'a targeted read of B\'s customer id succeeds as a query',
        await storeA.select({
          table: 'customer',
          columns: ['customer_id', 'display_name'],
          where: eq('customer_id', CUST_B),
          limit: 10,
        }),
      ) as unknown[];
      assertEqual(
        `${ISOLATION} A cannot read B's row by its exact id`,
        targeted.length,
        0,
      );

      // The control: B's row really is there. Without this the assertion above would pass on an
      // empty database.
      const rawCount = fixture.tenant.raw
        .prepare('SELECT COUNT(*) AS n FROM customer WHERE tenant_id = ?')
        .all(ORG_B) as { n: number }[];
      assertEqual("the fixture really does hold B's row", rawCount[0].n, 1);
    } finally {
      fixture.close();
    }
  });

  suite.test('A cannot INFER B: a matching display name in B is invisible to A', async () => {
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      const storeA = expectOk('A resolves', await fixture.resolver.resolve(ORG_A)) as TenantScopedStore;
      // Both Organizations hold a customer whose display name starts with "Anna". A search that
      // leaked would return two.
      const rows = expectOk(
        'the search succeeds',
        await storeA.select({
          table: 'customer',
          columns: ['customer_id', 'display_name'],
          where: eq('display_name', 'Anna Beta'),
          limit: 10,
        }),
      ) as unknown[];
      assertEqual(
        `${ISOLATION} a value that exists only in B returns nothing for A`,
        rows.length,
        0,
      );
    } finally {
      fixture.close();
    }
  });

  suite.test("A's store and B's store are distinct handles over distinct data", async () => {
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      const storeA = expectOk('A resolves', await fixture.resolver.resolve(ORG_A)) as TenantScopedStore;
      const storeB = expectOk('B resolves', await fixture.resolver.resolve(ORG_B)) as TenantScopedStore;
      const rowsA = (await readCustomers(storeA)) as { customer_id: string }[];
      const rowsB = (await readCustomers(storeB)) as { customer_id: string }[];
      assertEqual(`${ISOLATION} A sees only A`, rowsA.map((r) => r.customer_id).join(','), CUST_A);
      assertEqual(`${ISOLATION} B sees only B`, rowsB.map((r) => r.customer_id).join(','), CUST_B);
    } finally {
      fixture.close();
    }
  });

  suite.test('every statement the resolved store issued carried a tenant scope', async () => {
    // A structural check over the recorded SQL rather than over the results, so a store that
    // returned the right rows for the wrong reason is still caught.
    const fixture = createFixture(BOTH_ACTIVE);
    try {
      const storeA = expectOk('A resolves', await fixture.resolver.resolve(ORG_A)) as TenantScopedStore;
      const before = fixture.tenant.statements.length;
      await readCustomers(storeA);
      const issued = fixture.tenant.statements.slice(before);
      assertTrue('at least one statement was issued', issued.length > 0, 'nothing was executed');
      for (const statement of issued) {
        assertTrue(
          `${ISOLATION} the statement names tenant_id: ${statement.sql}`,
          statement.sql.includes('tenant_id'),
          'a statement reached the tenant database without a tenant predicate',
        );
        assertTrue(
          `${ISOLATION} the bound parameters carry Organization A and not B`,
          statement.parameters.includes(ORG_A) && !statement.parameters.includes(ORG_B),
          `parameters were ${JSON.stringify(statement.parameters)}`,
        );
      }
    } finally {
      fixture.close();
    }
  });

  return suite;
}
