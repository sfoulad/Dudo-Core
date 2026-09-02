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
 *   2. A tenant-directory MAPPING. `worker-entry.ts` supplies an empty one on purpose, so
 *      production fails closed for every Organization. The harness supplies two active
 *      entries so there is something to isolate.
 *   3. A `RequestCoordinator`. `docs/decisions/0013` requires a SQLite-backed Durable Object,
 *      and this repository cannot execute one — no Worker configuration, no runtime. Core
 *      therefore ships `platform/core/protection/in-process-coordinator.ts` for exactly this
 *      purpose, marked NEVER-FOR-DEPLOYMENT, and the harness uses THAT rather than writing a
 *      second implementation: a harness-local coordinator would verify the harness's
 *      algorithm and not the shipped one. The Durable Object adapter itself
 *      (`protection/adapters/durable-objects/coordinator-object.ts`) is therefore NOT
 *      EXERCISED by these suites and is reported as not covered.
 *
 * NO TABLE IS TRANSCRIBED. `customer`, `audit_event`, `business` and `denial_summary` are all
 * read from their migration files and executed, so a schema change in
 * `apps/customers/data/migrations/` or `platform/core/migrations/` reaches these tests instead
 * of quietly diverging from them. `business` used to be invented here because Core had not
 * authored it; `platform/core/migrations/0002_business.sql` now exists and that assumption is
 * retired.
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
import type { RequestCoordinator, SummaryWriteBudget } from '../../../platform/core/protection/coordination.ts';
import { PLATFORM_DAILY_SUMMARY_WRITES } from '../../../platform/core/protection/coordination.ts';
import {
  createInProcessRequestCoordinator,
  createInProcessSummaryWriteBudget,
} from '../../../platform/core/protection/in-process-coordinator.ts';

import { createCustomerActions } from '../../../apps/customers/api/routes.ts';
import { CUSTOMERS_APP_PERMISSIONS } from '../../../apps/customers/app.ts';
import { displayNameKey, emailKey, phoneKey } from '../../../apps/customers/domain/search.ts';

import type { SqliteHarness } from './sqlite-d1.ts';
import { createSqliteDatabase } from './sqlite-d1.ts';
import { createBoundaryBypassStore, createPredicateBrokenStore } from './broken-controls.ts';
import {
  createRejectingCoordinator,
  createThrowingCoordinator,
  withBrokenDenialRecording,
  withIdentifierInGroupKey,
} from './broken-coordination.ts';

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
 * Core's `business` table, AS CORE AUTHORED IT.
 *
 * This was an invented DDL in the harness while Core had no such table. It is now read from
 * the migration, so the harness can no longer disagree with the shape Core ships — including
 * the deliberate ABSENCE of a global unique constraint on `business_id`, which the migration
 * explains is what keeps the shared-business-id negative control constructible.
 */
const BUSINESS_MIGRATION = `${HERE}../../../platform/core/migrations/0002_business.sql`;
/** The bounded denial summary table (docs/decisions/0013 control 4). */
const DENIAL_SUMMARY_MIGRATION = `${HERE}../../../platform/core/migrations/0003_denial_summary.sql`;

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

/**
 * How the request coordinator behaves (`docs/decisions/0013`).
 *
 *   real     the shipped in-process coordinator over the shipped coordination engine.
 *   absent   NO coordinator at all — `PipelineDependencies.coordinator` is undefined. This is
 *            the composition-root defect `worker-entry.ts` refuses to start with, and it is
 *            reproduced here because control 8 is a claim about what happens when the
 *            coordinator cannot answer, and a claim never exercised is a comment.
 *   reject   `begin()` returns `unavailable`.
 *   throw    `begin()` throws.
 *   record-rejects / record-throws
 *            admission SUCCEEDS and the DENIAL COUNT fails. This is the other side of the
 *            tension 0013 has to reconcile: control 8 governs admission (fail closed), D2
 *            requirement 6 governs evidence (the answer must not change). Only this mode
 *            reaches requirement 6's path.
 */
export type CoordinatorMode =
  | 'real'
  | 'absent'
  | 'reject'
  | 'throw'
  | 'record-rejects'
  | 'record-throws';

export type WorldOptions = {
  readonly storeMode?: StoreMode;
  readonly resolverMode?: ResolverMode;
  /** Adds an Organization B customer filed under one of Organization A's business ids. */
  readonly withSharedBusinessIdCollision?: boolean;
  /**
   * NEGATIVE CONTROL 4: D2 reverted. `customers.GetCustomer` is rebuilt with
   * `auditOnDenial: false`, which is exactly what it was before the user's 2026-09-02 ruling.
   *
   * This is the sensitivity check the probe-detection suite needs, and the storage controls
   * cannot provide it — they break isolation, not auditing. It is a legal Action shape
   * (`assertAuditPolicy` refuses only `audit: true` with `auditOnDenial: false`), so no guard
   * is bypassed to construct it, and no production file is edited: the flag is overridden on a
   * copy of the real Action object.
   */
  readonly revertD2?: boolean;
  /** See `CoordinatorMode`. Defaults to `real`. */
  readonly coordinatorMode?: CoordinatorMode;
  /**
   * The PLATFORM daily summary-write ceiling (0013 control 9). Defaults to the shipped
   * `PLATFORM_DAILY_SUMMARY_WRITES`. Lowered by the ceiling suite so the control can actually
   * be reached: 5,000 emissions is not something a suite should produce, and a ceiling that is
   * never reached is a ceiling that has never been verified.
   */
  readonly summaryCeiling?: number;
  /**
   * NEGATIVE CONTROL 5: the requested identifier IS part of the denial group key — the single
   * change 0013 control 5 forbids. Supplied as a coordinator WRAPPER so that no production
   * file is edited; see `harness/broken-coordination.ts`.
   */
  readonly identifierInGroupKey?: boolean;
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
  /**
   * The coordinator these dependencies carry, or null in `absent` mode. Exposed so a suite can
   * drive admission directly — the source-address level is not reachable end to end with a
   * two-Organization fixture; see the rate-limit suite for the arithmetic.
   */
  readonly coordinator: RequestCoordinator | null;
  /** The platform daily summary-write budget, for the ceiling assertions (control 9). */
  readonly budget: SummaryWriteBudget & { readonly usedToday: () => number };
  /** Written by `withIdentifierInGroupKey`. Null unless that negative control is on. */
  readonly identifierChannel: { current: string | null } | null;
  storeFor(organizationId: string): Promise<TenantScopedStore>;
  invoke(
    action: AnyActionDefinition | { id: string },
    principal: AuthenticatedPrincipal,
    rawInput: unknown,
    /**
     * The third rate-limit level's input (0013 control 6). A HASH, never an address — Core
     * never sees one. Omitted means null, which is not an exemption: every unknown source
     * shares one bucket.
     */
    sourceAddressHash?: string | null,
  ): Promise<Result<unknown>>;
  auditRows(tenantId?: string): Record<string, unknown>[];
  /** Rows of `denial_summary` — where a DENIAL lands since 0013. Ordered as written. */
  denialSummaryRows(tenantId?: string): Record<string, unknown>[];
  customerRows(tenantId?: string): Record<string, unknown>[];
  /** Statements executed through the storage port whose SQL names the given table. */
  statementsAgainst(table: string): readonly { readonly sql: string }[];
  close(): void;
};

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const harness = createSqliteDatabase();
  harness.raw.exec(readFileSync(AUDIT_MIGRATION, 'utf8'));
  harness.raw.exec(readFileSync(CUSTOMER_MIGRATION, 'utf8'));
  harness.raw.exec(readFileSync(BUSINESS_MIGRATION, 'utf8'));
  harness.raw.exec(readFileSync(DENIAL_SUMMARY_MIGRATION, 'utf8'));

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
  const built = createCustomerActions({ businesses });
  const actions =
    options.revertD2 === true
      ? { ...built, get: { ...built.get, auditOnDenial: false } }
      : built;

  // ---- The request coordinator (docs/decisions/0013) -------------------------------------
  //
  // THE SHIPPED IMPLEMENTATION, NOT A HARNESS ONE. `in-process-coordinator.ts` exists in Core
  // for exactly this use and is marked never-for-deployment; using it means these suites drive
  // the shipped `coordination-engine.ts` — the same ladder, the same windows, the same
  // ceilings — rather than a second algorithm that could agree with the tests and disagree
  // with production.
  const budget = createInProcessSummaryWriteBudget(
    options.summaryCeiling ?? PLATFORM_DAILY_SUMMARY_WRITES,
  );
  const coordinatorMode = options.coordinatorMode ?? 'real';
  const identifierChannel = options.identifierInGroupKey === true ? { current: null } : null;

  function buildCoordinator(): RequestCoordinator | null {
    if (coordinatorMode === 'absent') {
      return null;
    }
    if (coordinatorMode === 'reject') {
      return createRejectingCoordinator();
    }
    if (coordinatorMode === 'throw') {
      return createThrowingCoordinator();
    }
    let coordinator = createInProcessRequestCoordinator(budget);
    if (coordinatorMode === 'record-rejects') {
      coordinator = withBrokenDenialRecording(coordinator, 'reject');
    }
    if (coordinatorMode === 'record-throws') {
      coordinator = withBrokenDenialRecording(coordinator, 'throw');
    }
    if (identifierChannel !== null) {
      coordinator = withIdentifierInGroupKey(coordinator, identifierChannel);
    }
    return coordinator;
  }

  const coordinator = buildCoordinator();

  const dependencies: PipelineDependencies = {
    resolver,
    authorizer: createAuthorizer(),
    clock,
    ids,
    cursors,
    // `absent` deliberately violates the type, because the composition-root defect it models
    // is exactly "a root that did not supply one". `worker-entry.ts` refuses to start in that
    // state; the pipeline must still not permit access if it ever happens, and control 8 is
    // untestable without reaching it.
    coordinator: coordinator as RequestCoordinator,
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
    coordinator,
    budget,
    identifierChannel,
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

    async invoke(action, principal, rawInput, sourceAddressHash): Promise<Result<unknown>> {
      const resolvedAction =
        'handle' in (action as AnyActionDefinition)
          ? (action as AnyActionDefinition)
          : byId.get((action as { id: string }).id);
      if (resolvedAction === undefined) {
        throw new Error(`no such action in this world: ${(action as { id: string }).id}`);
      }
      // NEGATIVE CONTROL 5 only. The pipeline has NO channel for the requested identifier — that
      // absence is the control being verified — so the harness, which built the request, feeds
      // it to the wrapper out of band. See `broken-coordination.ts` for why that models "someone
      // changed the key" and not "the pipeline leaks the identifier".
      if (identifierChannel !== null) {
        const supplied = (rawInput as { customer_id?: unknown } | null)?.customer_id;
        identifierChannel.current = typeof supplied === 'string' ? supplied : null;
      }
      return invokeAction(
        dependencies,
        resolvedAction,
        {
          principal,
          app: CUSTOMERS_APP_PERMISSIONS,
          requestId: ids.generate(),
          correlationId: ids.generate(),
          sourceAddressHash: sourceAddressHash ?? null,
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

    /**
     * ORDERED BY `rowid`, NOT by the primary key. `denial_summary_id` is derived from the
     * grouping and the emission sequence, so sorting by it would interleave two groups' rows
     * and lose the order they were APPENDED in — which is the order the ladder produced them,
     * and the thing several assertions are about.
     */
    denialSummaryRows(tenantId?: string): Record<string, unknown>[] {
      const sql =
        tenantId === undefined
          ? 'SELECT * FROM denial_summary ORDER BY rowid'
          : 'SELECT * FROM denial_summary WHERE tenant_id = ? ORDER BY rowid';
      const prepared = harness.raw.prepare(sql);
      return (
        tenantId === undefined ? prepared.all() : prepared.all(tenantId)
      ) as Record<string, unknown>[];
    },

    statementsAgainst(table: string): readonly { readonly sql: string }[] {
      return harness.statements.filter((entry) => entry.sql.includes(table));
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

/**
 * The refusal `docs/decisions/0013` control 6 introduces. It tells the caller about ITSELF —
 * "you are going too fast" — and about no record, which is why it can be a distinct code
 * without reopening anything the `not_found` withholds. That claim is asserted, not assumed.
 */
export const EXPECTED_RATE_LIMITED = {
  code: 'rate_limited',
  message: 'Too many requests.',
};

/**
 * What a degraded coordinator costs a WRITE. Control 8: failure of the coordinator must never
 * permit access, so with nothing bounding what a caller may spend of an account-wide D1 write
 * allowance, no write commits. A read the caller was already authorized for is unaffected —
 * degradation narrows, it never widens.
 */
export const EXPECTED_UNAVAILABLE = {
  code: 'unavailable',
  message: 'A dependency is unavailable.',
};

export const EXPECTED_INVALID_CURSOR = {
  code: 'invalid_argument',
  message: 'The request is not valid.',
  details: [{ field: 'cursor', issue: 'invalid_cursor' }],
};
