/**
 * The two-Organization world these suites run against.
 *
 * `TESTING_STANDARD.md` §5.2's canonical test needs two tenants with equivalent data and a
 * FULLY PRIVILEGED principal in one of them — "an under-permissioned principal fails for the
 * wrong reason and proves nothing about isolation". This file builds exactly that, and both
 * Organizations' rows sit in ONE physical table, per `docs/decisions/0006` Option A. If they
 * were in two databases the suite would be testing a boundary the product does not have.
 *
 * ALL DATA IS SYNTHETIC. Invented names, `.test` and `.invalid` domains, and numbers in the
 * reserved UK `+44 20 7946 0xxx` drama range. No real person, no real customer, no credential
 * anywhere. The cursor signing key is a fixed test constant of no value outside this process
 * and is never printed.
 *
 * THREE THINGS THE HARNESS SUPPLIES THAT PRODUCTION DOES NOT, EACH DECLARED:
 *
 *   1. A `PrincipalResolver`. `platform/core/identity/principal-resolver.ts` deliberately
 *      ships only a deny-all implementation because AZ2 — the authentication mechanism — is
 *      undecided. Every principal below is therefore MANUFACTURED by the harness through
 *      `sealAuthenticatedPrincipal`, which is Core's own and only constructor. What is being
 *      verified is everything downstream of authentication; authentication itself is NOT
 *      verified by these suites and is reported as not covered.
 *   2. A `business` TABLE. `platform/core/tenancy/business-directory.ts` reads a Core
 *      organization-structure table that DOES NOT EXIST — Core's identity slice has not been
 *      built, and `worker-entry.ts` says so. Its schema is invented here, minimally, as
 *      `(tenant_id, business_id)`, because `BusinessDirectory` selects exactly those two
 *      columns. THIS IS AN ASSUMPTION: if Core later gives `business` a different shape,
 *      these suites must be revisited. Without it, `CreateCustomer`,
 *      `MoveCustomerToBusiness` and any Business-filtered listing cannot be exercised at all.
 *   3. A tenant-directory MAPPING. `worker-entry.ts` supplies an empty one on purpose, so
 *      production fails closed for every Organization. The harness supplies two active
 *      entries so there is something to isolate.
 *
 * The customer and audit tables are NOT transcribed — the migration files are read and
 * executed, so a schema change in `apps/customers/data/migrations/` or
 * `platform/core/migrations/` reaches these tests instead of quietly diverging from them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TenantScopedStore } from '../../../platform/core/storage/store.ts';
import { createD1TenantStore } from '../../../platform/core/storage/adapters/d1/d1-store.ts';
import type {
  TenantStoreMapping,
  TenantStoreResolver,
} from '../../../platform/core/tenancy/tenant-store-resolver.ts';
import { createStaticTenantStoreResolver } from '../../../platform/core/tenancy/tenant-store-resolver.ts';
import { createStoreBusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { createAuthorizer } from '../../../platform/core/authorization/authorizer.ts';
import type {
  AppPermissionEnvelope,
  PermissionGrant,
} from '../../../platform/core/authorization/authorizer.ts';
import type { Clock } from '../../../platform/core/kernel/clock.ts';
import { toRfc3339Utc } from '../../../platform/core/kernel/clock.ts';
import type { IdGenerator } from '../../../platform/core/kernel/ids.ts';
import { createCursorCodec } from '../../../platform/core/pagination/cursor.ts';
import type { CursorCodec } from '../../../platform/core/pagination/cursor.ts';
import type { AuthenticatedPrincipal } from '../../../platform/core/tenancy/tenant-context.ts';
import { sealAuthenticatedPrincipal } from '../../../platform/core/tenancy/tenant-context.ts';
import type { PipelineDependencies } from '../../../platform/core/action/pipeline.ts';
import { invokeAction } from '../../../platform/core/action/pipeline.ts';
import type { AnyActionDefinition } from '../../../platform/core/action/action.ts';
import { asAnyAction } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';

import { createCustomerActions } from '../../../apps/customers/api/routes.ts';
import { CUSTOMERS_APP_PERMISSIONS } from '../../../apps/customers/app.ts';
import { displayNameKey, emailKey, phoneKey } from '../../../apps/customers/domain/search.ts';

import type { SqliteHarness } from './sqlite-d1.ts';
import { createSqliteDatabase } from './sqlite-d1.ts';
import { createBoundaryBypassStore, createPredicateBrokenStore } from './broken-controls.ts';

// ---------------------------------------------------------------------------
// Identifiers. Every one matches the contract's `^[A-Za-z0-9_-]{8,64}$`.
// ---------------------------------------------------------------------------

export const ORG_A = 'org_alpha_0001';
export const ORG_B = 'org_beta_0002';
export const ORG_UNMAPPED = 'org_ghost_0003';

export const BIZ_A_NORTH = 'biz_alpha_north';
export const BIZ_A_SOUTH = 'biz_alpha_south';
export const BIZ_B_EAST = 'biz_beta_east01';
/** Well-formed, belongs to no Organization at all. */
export const BIZ_NOWHERE = 'biz_nowhere_0001';

export const CUST_A_ANNA = 'cust_alpha_anna1';
export const CUST_A_BRUNO = 'cust_alpha_brun1';
export const CUST_A_SOUTH = 'cust_alpha_soth1';
export const CUST_A_ZEBRA = 'cust_alpha_zebr1';
export const CUST_A_PERCENT = 'cust_alpha_pcnt1';
export const CUST_A_PLAIN = 'cust_alpha_plan1';
export const CUST_A_UNDERSCORE = 'cust_alpha_undr1';
export const CUST_A_UNDERX = 'cust_alpha_undx1';
export const CUST_A_ARCHIVED = 'cust_alpha_arch1';
export const CUST_B_ANNA = 'cust_beta_anna01';
export const CUST_B_SECOND = 'cust_beta_secnd1';
/** Well-formed, resolves to no row in any Organization. */
export const CUST_NOWHERE = 'cust_nowhere_001';

export const PERMISSION_IDS: readonly string[] = [
  'customers.customer.create',
  'customers.customer.read',
  'customers.customer.list',
  'customers.customer.update',
  'customers.customer.archive',
  'customers.customer.restore',
  'customers.customer.move',
  'customers.customer.delete',
  'customers.customer.restore-deleted',
];

/** The six the contract declares at `[organization, business]`. */
export const BUSINESS_SCOPED_PERMISSION_IDS: readonly string[] = [
  'customers.customer.create',
  'customers.customer.read',
  'customers.customer.list',
  'customers.customer.update',
  'customers.customer.archive',
  'customers.customer.restore',
];

// ---------------------------------------------------------------------------
// Ports the harness supplies
// ---------------------------------------------------------------------------

export type MutableClock = Clock & { set(epochMilliseconds: number): void };

export const FIXED_START_MS = Date.UTC(2026, 8, 2, 9, 0, 0);

export function createMutableClock(startMs: number = FIXED_START_MS): MutableClock {
  let current = startMs;
  return {
    now: () => toRfc3339Utc(current),
    nowMs: () => current,
    set(epochMilliseconds: number) {
      current = epochMilliseconds;
    },
  };
}

/**
 * Deterministic identifiers of a FIXED WIDTH.
 *
 * Fixed width is load-bearing for one assertion in particular: the contract requires the
 * `not_found` for a foreign-Organization identifier and the `not_found` for an identifier
 * that exists nowhere to be identical "in response-size class", with `request_id` the only
 * permitted difference. Two request ids of different lengths would make the two responses
 * different lengths for a reason that has nothing to do with the property under test.
 */
export function createSequentialIdGenerator(prefix = 'gen'): IdGenerator {
  let counter = 0;
  return {
    generate(): string {
      counter += 1;
      return `${prefix}_${String(counter).padStart(12, '0')}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

export type PrincipalOptions = {
  readonly principalId: string;
  readonly organizationId: string;
  readonly authorizedBusinessIds: readonly string[];
  readonly grants: readonly PermissionGrant[];
  readonly principalType?: AuthenticatedPrincipal['principalType'];
  readonly onBehalfOfPrincipalId?: string | null;
};

export function makePrincipal(options: PrincipalOptions): AuthenticatedPrincipal {
  return sealAuthenticatedPrincipal({
    principalId: options.principalId,
    principalType: options.principalType ?? 'user',
    organizationId: options.organizationId,
    authorizedBusinessIds: options.authorizedBusinessIds,
    grants: { grants: options.grants },
    onBehalfOfPrincipalId: options.onBehalfOfPrincipalId ?? null,
  });
}

function grantsAt(scope: PermissionGrant['scope'], ids: readonly string[]): PermissionGrant[] {
  return ids.map((permissionId) => ({ permissionId, scope }));
}

// ---------------------------------------------------------------------------
// Schema and seed
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CUSTOMER_MIGRATION = `${HERE}../../../apps/customers/data/migrations/0001_customer.sql`;
const AUDIT_MIGRATION = `${HERE}../../../platform/core/migrations/0001_audit_event.sql`;

/**
 * Core's organization-structure table, which Core has NOT authored.
 *
 * `business-directory.ts` selects `business_id FROM business WHERE tenant_id = ? AND
 * business_id = ?`, so those are the two columns. The primary key is `(tenant_id,
 * business_id)` — which permits the same `business_id` VALUE in two Organizations. That is a
 * harness decision and it is deliberate: nothing in `Dudo-Core` enforces platform-wide
 * uniqueness of Business identifiers today, so the harness must not enforce it either and
 * then claim to have tested the world as it is.
 */
const BUSINESS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS business (
  tenant_id   TEXT NOT NULL,
  business_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, business_id)
);
`;

export type SeedCustomer = {
  readonly tenantId: string;
  readonly customerId: string;
  readonly businessId: string;
  readonly displayName: string;
  readonly customerType?: 'person' | 'company';
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly country?: string | null;
  readonly address?: string | null;
  readonly notes?: string | null;
  readonly status?: 'active' | 'archived';
};

/**
 * Seeded through raw SQL rather than through `CreateCustomer`.
 *
 * Deliberate: the fixture must be able to place a row in Organization B without Organization
 * B's Actions being correct, and a fixture built out of the code under test cannot fail
 * independently of it. The DERIVED key columns are computed with the App's OWN
 * `displayNameKey` / `emailKey` / `phoneKey`, because those define what search matches — a
 * transcribed copy here would test the copy.
 */
export function seedCustomer(harness: SqliteHarness, seed: SeedCustomer): void {
  const now = toRfc3339Utc(FIXED_START_MS - 86_400_000);
  harness.raw
    .prepare(
      `INSERT INTO customer (
         tenant_id, customer_id, business_id, display_name, display_name_key, customer_type,
         email, email_key, phone, phone_key, country, address, notes, status,
         deletion_scheduled_at, created_at, created_by_principal_id, updated_at,
         updated_by_principal_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      seed.tenantId,
      seed.customerId,
      seed.businessId,
      seed.displayName,
      displayNameKey(seed.displayName),
      seed.customerType ?? 'person',
      seed.email ?? null,
      emailKey(seed.email ?? null),
      seed.phone ?? null,
      phoneKey(seed.phone ?? null),
      seed.country ?? null,
      seed.address ?? null,
      seed.notes ?? null,
      seed.status ?? 'active',
      null,
      now,
      'seed_principal',
      now,
      'seed_principal',
    );
}

export function seedBusiness(harness: SqliteHarness, tenantId: string, businessId: string): void {
  harness.raw
    .prepare('INSERT OR IGNORE INTO business (tenant_id, business_id) VALUES (?, ?)')
    .run(tenantId, businessId);
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type StoreMode = 'real' | 'predicate-broken' | 'boundary-bypass';
export type ResolverMode = 'real' | 'always-organization-b';

export type WorldOptions = {
  readonly storeMode?: StoreMode;
  readonly resolverMode?: ResolverMode;
  /** Adds an Organization B customer filed under one of Organization A's business ids. */
  readonly withSharedBusinessIdCollision?: boolean;
};

export type World = {
  readonly harness: SqliteHarness;
  readonly dependencies: PipelineDependencies;
  readonly resolver: TenantStoreResolver;
  readonly businesses: BusinessDirectory;
  readonly actions: ReturnType<typeof createCustomerActions>;
  readonly app: AppPermissionEnvelope;
  readonly clock: MutableClock;
  readonly ids: IdGenerator;
  readonly cursors: CursorCodec;
  readonly ownerA: AuthenticatedPrincipal;
  readonly adminANorth: AuthenticatedPrincipal;
  readonly ownerB: AuthenticatedPrincipal;
  readonly unprivilegedA: AuthenticatedPrincipal;
  storeFor(organizationId: string): Promise<TenantScopedStore>;
  invoke(
    action: AnyActionDefinition | { id: string },
    principal: AuthenticatedPrincipal,
    rawInput: unknown,
  ): Promise<Result<unknown>>;
  auditRows(tenantId?: string): Record<string, unknown>[];
  customerRows(tenantId?: string): Record<string, unknown>[];
  close(): void;
};

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const harness = createSqliteDatabase();
  harness.raw.exec(readFileSync(AUDIT_MIGRATION, 'utf8'));
  harness.raw.exec(readFileSync(CUSTOMER_MIGRATION, 'utf8'));
  harness.raw.exec(BUSINESS_TABLE_DDL);

  seedBusiness(harness, ORG_A, BIZ_A_NORTH);
  seedBusiness(harness, ORG_A, BIZ_A_SOUTH);
  seedBusiness(harness, ORG_B, BIZ_B_EAST);

  // --- Organization A -------------------------------------------------------
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_ANNA,
    businessId: BIZ_A_NORTH,
    displayName: 'Anna Smith',
    email: 'anna.smith@alpha.test',
    phone: '+44 20 7946 0101',
    country: 'BH',
    address: '1 Pearl Road, Manama',
    notes: 'Prefers morning appointments.',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_BRUNO,
    businessId: BIZ_A_NORTH,
    displayName: 'Bruno Alvarez',
    email: 'bruno.alvarez@alpha.test',
    phone: '+44 20 7946 0202',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_SOUTH,
    businessId: BIZ_A_SOUTH,
    displayName: 'Carla Osman',
    email: 'carla.osman@alpha.test',
    phone: '+44 20 7946 0303',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_ZEBRA,
    businessId: BIZ_A_NORTH,
    displayName: 'Delta Holdings',
    customerType: 'company',
    email: 'accounts@delta.test',
    address: 'Unit 4, Zebrastraat 12',
    notes: 'Introduced by zebracorp; renewal in March.',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_PERCENT,
    businessId: BIZ_A_NORTH,
    displayName: 'a%b Trading',
    customerType: 'company',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_PLAIN,
    businessId: BIZ_A_NORTH,
    displayName: 'axb Trading',
    customerType: 'company',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_UNDERSCORE,
    businessId: BIZ_A_NORTH,
    displayName: 'c_d Holdings',
    customerType: 'company',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_UNDERX,
    businessId: BIZ_A_NORTH,
    displayName: 'cxd Holdings',
    customerType: 'company',
  });
  seedCustomer(harness, {
    tenantId: ORG_A,
    customerId: CUST_A_ARCHIVED,
    businessId: BIZ_A_NORTH,
    displayName: 'Retired Account',
    customerType: 'company',
    status: 'archived',
  });

  // --- Organization B: equivalent data, deliberately similar so a leak is visible ----
  seedCustomer(harness, {
    tenantId: ORG_B,
    customerId: CUST_B_ANNA,
    businessId: BIZ_B_EAST,
    displayName: 'Anna Smithson',
    email: 'anna.smithson@beta.test',
    phone: '+44 20 7946 0101',
    country: 'GB',
    address: '9 Coral Way, Muharraq',
    notes: 'Zebracorp reference on file.',
  });
  seedCustomer(harness, {
    tenantId: ORG_B,
    customerId: CUST_B_SECOND,
    businessId: BIZ_B_EAST,
    displayName: 'Aardvark Supplies',
    customerType: 'company',
    email: 'aardvark@beta.test',
  });

  if (options.withSharedBusinessIdCollision === true) {
    // Organization B, filed under a business id VALUE that Organization A also uses. See
    // the suite that uses this for why it is not a fixture cross-tenant reference: no
    // Organization A row, principal, grant or authorized set names anything of B's.
    seedBusiness(harness, ORG_B, BIZ_A_NORTH);
    seedCustomer(harness, {
      tenantId: ORG_B,
      customerId: 'cust_beta_collid1',
      businessId: BIZ_A_NORTH,
      displayName: 'Aaa Collision Ltd',
      customerType: 'company',
    });
  }

  const clock = createMutableClock();
  const ids = createSequentialIdGenerator();
  // A fixed 32-byte test constant. Not a credential; of no value outside this process. It is
  // never printed and never leaves the harness.
  const cursors = await createCursorCodec(new Uint8Array(32).fill(0x2a));

  const mappings: readonly TenantStoreMapping[] = [
    { organizationId: ORG_A, bindingName: 'DB_TENANT', state: 'active' },
    { organizationId: ORG_B, bindingName: 'DB_TENANT', state: 'active' },
  ];

  const storeMode = options.storeMode ?? 'real';
  const resolverMode = options.resolverMode ?? 'real';

  const resolver = createStaticTenantStoreResolver(mappings, (bindingName, organizationId) => {
    if (bindingName !== 'DB_TENANT') {
      return undefined;
    }
    // CONTROL 2: the resolver hands every caller Organization B's store.
    const effective = resolverMode === 'always-organization-b' ? ORG_B : organizationId;
    if (storeMode === 'predicate-broken') {
      return createPredicateBrokenStore(harness, effective);
    }
    if (storeMode === 'boundary-bypass') {
      return createBoundaryBypassStore(harness);
    }
    return createD1TenantStore(harness.database, effective);
  });

  const businesses = createStoreBusinessDirectory();
  const actions = createCustomerActions({ businesses });

  const dependencies: PipelineDependencies = {
    resolver,
    authorizer: createAuthorizer(),
    clock,
    ids,
    cursors,
  };

  const byId = new Map<string, AnyActionDefinition>();
  for (const action of Object.values(actions)) {
    byId.set(action.id, asAnyAction(action));
  }

  return {
    harness,
    dependencies,
    resolver,
    businesses,
    actions,
    app: CUSTOMERS_APP_PERMISSIONS,
    clock,
    ids,
    cursors,
    ownerA: makePrincipal({
      principalId: 'prn_owner_alpha',
      organizationId: ORG_A,
      authorizedBusinessIds: [BIZ_A_NORTH, BIZ_A_SOUTH],
      grants: grantsAt('organization', PERMISSION_IDS),
    }),
    adminANorth: makePrincipal({
      principalId: 'prn_admin_north',
      organizationId: ORG_A,
      authorizedBusinessIds: [BIZ_A_NORTH],
      grants: grantsAt('business', BUSINESS_SCOPED_PERMISSION_IDS),
    }),
    ownerB: makePrincipal({
      principalId: 'prn_owner_beta',
      organizationId: ORG_B,
      authorizedBusinessIds: [BIZ_B_EAST],
      grants: grantsAt('organization', PERMISSION_IDS),
    }),
    unprivilegedA: makePrincipal({
      principalId: 'prn_member_alpha',
      organizationId: ORG_A,
      authorizedBusinessIds: [BIZ_A_NORTH, BIZ_A_SOUTH],
      grants: [],
    }),

    async storeFor(organizationId: string): Promise<TenantScopedStore> {
      const resolved = await resolver.resolve(organizationId);
      if (!resolved.ok) {
        throw new Error(`the harness could not resolve a store for ${organizationId}`);
      }
      return resolved.value;
    },

    async invoke(action, principal, rawInput): Promise<Result<unknown>> {
      const resolvedAction =
        'handle' in (action as AnyActionDefinition)
          ? (action as AnyActionDefinition)
          : byId.get((action as { id: string }).id);
      if (resolvedAction === undefined) {
        throw new Error(`no such action in this world: ${(action as { id: string }).id}`);
      }
      return invokeAction(
        dependencies,
        resolvedAction,
        {
          principal,
          app: CUSTOMERS_APP_PERMISSIONS,
          requestId: ids.generate(),
          correlationId: ids.generate(),
        },
        rawInput,
      );
    },

    auditRows(tenantId?: string): Record<string, unknown>[] {
      const sql =
        tenantId === undefined
          ? 'SELECT * FROM audit_event ORDER BY audit_event_id'
          : 'SELECT * FROM audit_event WHERE tenant_id = ? ORDER BY audit_event_id';
      const prepared = harness.raw.prepare(sql);
      return (
        tenantId === undefined ? prepared.all() : prepared.all(tenantId)
      ) as Record<string, unknown>[];
    },

    customerRows(tenantId?: string): Record<string, unknown>[] {
      const sql =
        tenantId === undefined
          ? 'SELECT * FROM customer ORDER BY tenant_id, customer_id'
          : 'SELECT * FROM customer WHERE tenant_id = ? ORDER BY customer_id';
      const prepared = harness.raw.prepare(sql);
      return (
        tenantId === undefined ? prepared.all() : prepared.all(tenantId)
      ) as Record<string, unknown>[];
    },

    close(): void {
      harness.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Expected error values, written out in full.
//
// Every negative assertion in these suites compares against one of these WHOLE values, not
// against a code alone. That is how "rejected for the intended reason" is separated from
// "rejected for any reason": a case that expected `not_found` and got `invalid_argument`,
// `forbidden`, `internal` or `unavailable` fails, and so does one that got a `not_found`
// carrying a different message or extra details.
// ---------------------------------------------------------------------------

export const EXPECTED_NOT_FOUND = {
  code: 'not_found',
  message: 'The requested resource does not exist.',
};

export const EXPECTED_FORBIDDEN = {
  code: 'forbidden',
  message: 'The principal is not permitted to perform this operation.',
};

export const EXPECTED_FAILED_PRECONDITION = {
  code: 'failed_precondition',
  message: 'The resource is not in a state that permits this operation.',
};

export const EXPECTED_INVALID_CURSOR = {
  code: 'invalid_argument',
  message: 'The request is not valid.',
  details: [{ field: 'cursor', issue: 'invalid_cursor' }],
};
