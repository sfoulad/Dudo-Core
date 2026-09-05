/**
 * ===========================================================================================
 * THE PLATFORM-OPERATOR WORLD. Built from the real migrations and composed by Core's own
 * `platform/composition.ts`.
 * ===========================================================================================
 *
 * `docs/decisions/0024` · `docs/decisions/0025` · contract `platform-operator-v1`.
 *
 * WHY THIS IS A SECOND FIXTURE RATHER THAN AN OPTION ON `control-plane-fixture.ts`. That file
 * applies five migrations and deliberately omits `0003_organization_membership.sql`, with the
 * stated reason that "applying a migration a suite does not need would hide a missing dependency
 * rather than reveal one". The platform suites need the opposite set — membership IS the point,
 * because the mutual exclusion is a question about two tables — so widening the shared constant
 * would change what the AZ2 suites run against. This applies all ten and says so.
 *
 * ===========================================================================================
 * WHAT IS REAL HERE AND WHAT IS THE HARNESS'S, STATED RATHER THAN GLOSSED
 * ===========================================================================================
 *
 * REAL, AND THEREFORE ACTUALLY UNDER TEST:
 *   - the ten control-plane migrations, read off disk and executed into `node:sqlite`. Nothing
 *     is transcribed, so a schema edit reaches these suites instead of quietly diverging.
 *   - `createD1PlatformStore` — the shipped adapter, over the shipped SQL.
 *   - `createPlatformComposition` — the shipped composition root, which is the seam its own
 *     header says exists so that "a verification harness composes exactly what production
 *     composes by passing a fake `PlatformOperatorStore`". The store here is not even fake.
 *   - `createPlatformAuthorityResolver`, `createPlatformAuditRecorder`,
 *     `createPlatformCursorCodec`, `createPlatformRouteHandlers` — all reached through the
 *     composition, none constructed directly.
 *   - `dispatchPlatformRoute` and the frozen route table.
 *   - `createSessionCredentialSigner` / `createSessionCredentialReader` — the SAME credential
 *     reader the authenticated path and the session route class use, so a platform route
 *     accepting a credential the ordinary path would reject would be visible here.
 *   - `createSessionResolver` over `createD1ControlPlaneStores`, for `resolvePrincipalId`.
 *   - `createInProcessControlPlaneWriteAdmission` over the shipped `DayWriteBudget`.
 *
 * THE HARNESS'S, AND DECLARED:
 *   - a fixed 32-byte session signing key and a fixed 32-byte cursor signing key. Both are test
 *     constants of no value outside this process. Neither is printed and neither is a credential.
 *   - `session` rows are seeded directly rather than minted through `issueSession`, because the
 *     suites need an expired session and a session for a suspended principal, and driving those
 *     through the write path would spend budget the audit assertions are counting.
 *   - a mutable clock.
 *
 * NOT COVERED BY ANYTHING HERE, and reported as such rather than implied by a green run:
 *   D1's own SQLite build (`node:sqlite` is a different engine), the Durable Object behind the
 *   day ledger, the deployed per-isolate rate limiter, and HTTP transport above `handleRequest`.
 *
 * ALL DATA IS SYNTHETIC. Invented identifiers only; no real principal, no real Organization, no
 * credential material of any kind.
 */

import { readFileSync } from 'node:fs';

import { createSqliteDatabase } from './sqlite-d1.ts';
import type { SqliteHarness } from './sqlite-d1.ts';

import type { Clock } from '../../../platform/core/kernel/clock.ts';
import { toRfc3339Utc } from '../../../platform/core/kernel/clock.ts';
import type { IdGenerator } from '../../../platform/core/kernel/ids.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { createAuthorizer } from '../../../platform/core/authorization/authorizer.ts';

import { createD1PlatformStore } from '../../../platform/core/platform/adapters/d1/d1-platform-store.ts';
import { createPlatformComposition } from '../../../platform/core/platform/composition.ts';
import type { PlatformOperatorStore } from '../../../platform/core/platform/platform-operator-store.ts';
import type {
  PlatformRoute,
  PlatformRouteDependencies,
  PlatformRouteId,
} from '../../../platform/core/platform/platform-routes.ts';
import { dispatchPlatformRoute, platformRoutes } from '../../../platform/core/platform/platform-routes.ts';
import type { PlatformAuditRecorder } from '../../../platform/core/platform/platform-audit.ts';

import { createD1ControlPlaneStores } from '../../../platform/core/identity/adapters/d1/d1-control-plane-store.ts';
import type { IdentityControlPlaneStore } from '../../../platform/core/identity/control-plane-store.ts';
import { createSessionResolver } from '../../../platform/core/identity/session-resolution.ts';
import type { SessionResolver } from '../../../platform/core/identity/session-resolution.ts';
import { createMembershipPrincipalAuthorizationSource } from '../../../platform/core/identity/principal-authorization-source.ts';
import { createInProcessControlPlaneWriteAdmission } from '../../../platform/core/identity/control-plane-admission.ts';
import type { ControlPlaneWriteAdmission } from '../../../platform/core/identity/control-plane-admission.ts';
import {
  createSessionCredentialReader,
  createSessionCredentialSigner,
} from '../../../platform/core/identity/session-credential.ts';
import type { SessionCredentialSigner } from '../../../platform/core/identity/session-credential.ts';

import { DAILY_ALLOCATION } from '../../../platform/core/protection/write-admission.ts';
import { createInProcessDayWriteBudget } from '../../../platform/core/protection/in-process-coordinator.ts';

// ---------------------------------------------------------------------------
// The migrations, read off disk. NO DDL IS TRANSCRIBED HERE.
// ---------------------------------------------------------------------------

const MIGRATION_DIRECTORY = new URL(
  '../../../platform/core/migrations/control-plane/',
  import.meta.url,
);

/**
 * All ten, in order. `0010` is separated below because a suite has to be able to build the world
 * WITHOUT it — asserting that the triggers refuse a write is only evidence if the same write
 * succeeds when they are absent.
 */
export const PLATFORM_MIGRATIONS: readonly string[] = Object.freeze([
  '0001_principal.sql',
  '0002_organization.sql',
  '0003_organization_membership.sql',
  '0004_session.sql',
  '0005_tenant_directory.sql',
  '0006_principal_credential.sql',
  '0007_membership_role.sql',
  '0008_platform_operator.sql',
  '0009_platform_operator_action.sql',
  '0011_confirmation.sql',
]);

export const MUTUAL_EXCLUSION_MIGRATION = '0010_platform_operator_mutual_exclusion.sql';

export function readControlPlaneMigration(fileName: string): string {
  return readFileSync(new URL(fileName, MIGRATION_DIRECTORY), 'utf8');
}

/**
 * A control-plane database with the platform migrations applied and nothing seeded.
 *
 * `withMutualExclusionTriggers` defaults to true. Passing `false` builds the SAME schema without
 * `0010`, which is the negative control for the trigger cases: a case that claims the trigger
 * refused a write must be able to show the write succeeding when the trigger is not there.
 */
export function createPlatformControlPlane(
  options: { readonly withMutualExclusionTriggers?: boolean } = {},
): SqliteHarness {
  const harness = createSqliteDatabase();
  for (const fileName of PLATFORM_MIGRATIONS) {
    harness.raw.exec(readControlPlaneMigration(fileName));
  }
  if (options.withMutualExclusionTriggers !== false) {
    harness.raw.exec(readControlPlaneMigration(MUTUAL_EXCLUSION_MIGRATION));
  }
  return harness;
}

// ---------------------------------------------------------------------------
// Synthetic identifiers. Every one matches `^[A-Za-z0-9_-]{8,64}$`.
//
// THE FABRICATED ENTRY IS DELIBERATE AND IS NAMED. `PRN_NOWHERE` and `ORG_NOWHERE` exist in NO
// table. Two real identifiers show that filtering does not happen; they do not show that a
// refusal is uninformative. The third entry is the control that makes the other two evidence.
// ---------------------------------------------------------------------------

export const PRN_ADMIN = 'prn_platform_admin01';
export const PRN_MODERATOR = 'prn_marketplace_mod1';
export const PRN_TENANT_OWNER = 'prn_tenant_owner0001';
export const PRN_TENANT_MEMBER = 'prn_tenant_member001';
/**
 * Seeded into BOTH `platform_operator` and `organization_membership`.
 *
 * ===========================================================================================
 * IT MODELS A **RESTORE**, WHICH IS THE ONE PATH THE TRIGGERS STRUCTURALLY CANNOT COVER.
 * ===========================================================================================
 *
 * `0010`'s four triggers refuse this state on INSERT and UPDATE in both directions — verified by
 * the Team Lead against a real local D1, and by the trigger cases in `mutual-exclusion.ts` against
 * `node:sqlite`. So Dudo's own code cannot create it and neither can a hand-run statement.
 *
 * *** A RESTORE DOES NOT RE-RUN TRIGGERS. *** `0025` names three ways the state can exist anyway —
 * "a hand-run SQL statement, a partially applied migration, or a restore from two backups taken at
 * different moments" — and the triggers stop only the first. `security-agent` independently
 * identified restore as the case where the AUTHORIZATION-SIDE check is THE control rather than a
 * second one, and `0024` now records it.
 *
 * That is why this principal is seeded with the two INSERT triggers briefly dropped and then
 * restored: it is not a way around an inconvenient constraint, it is the scenario that makes the
 * runtime check matter, reproduced exactly. Every case that uses this principal is a case about a
 * database that already holds the forbidden row.
 */
export const PRN_BOTH_TABLES = 'prn_in_both_tables01';
/** Suspended at `principal.status`. */
export const PRN_SUSPENDED_ADMIN = 'prn_suspended_admin1';
/**
 * A real principal with a real session that is in NEITHER table.
 *
 * This is what "an unknown principal" means to the platform class: authentication succeeds and
 * authority resolution finds nothing. It is the comparison target the contract names — "with the
 * same codes an unknown principal receives" — and it has to be session-bearing, or the comparison
 * would be between a `forbidden` and an `unauthenticated` and would prove nothing.
 */
export const PRN_STRANGER = 'prn_stranger_000001';
/** EXISTS NOWHERE: not a principal, not an operator, not a member, no session. */
export const PRN_NOWHERE = 'prn_exists_nowhere01';

export const ORG_ALPHA = 'org_alpha_000000001';
export const ORG_BETA = 'org_beta_0000000001';
export const ORG_GAMMA = 'org_gamma_000000001';
/** EXISTS NOWHERE. */
export const ORG_NOWHERE = 'org_exists_nowhere01';

export const SESSION_ADMIN = 'ses_admin_000000001';
export const SESSION_MODERATOR = 'ses_moderator_00001';
export const SESSION_TENANT_OWNER = 'ses_tenantowner0001';
export const SESSION_TENANT_MEMBER = 'ses_tenantmember001';
/**
 * An ordinary tenant `owner` with `ORG_ALPHA` selected. THE POSITIVE CONTROL FOR THE ACTION-SIDE
 * CASES: it must resolve to a full `AuthenticatedPrincipal`, or a case showing that
 * `PRN_BOTH_TABLES` does NOT resolve would prove nothing about the mutual exclusion.
 */
export const SESSION_TENANT_OWNER_SELECTED = 'ses_owner_selected01';
export const SESSION_BOTH_TABLES = 'ses_both_tables0001';
/**
 * The same principal, with `ORG_ALPHA` already selected.
 *
 * THIS IS THE SESSION THE ACTION-SIDE HALF OF THE MUTUAL EXCLUSION IS TESTED THROUGH, and the
 * selected Organization is what makes it a real test rather than a vacuous one: a session with
 * nothing selected resolves to `organization-not-selected` for every principal, member or not, so
 * it cannot distinguish a working check from an absent one.
 */
export const SESSION_BOTH_TABLES_SELECTED = 'ses_both_selected001';
export const SESSION_SUSPENDED = 'ses_suspended_00001';
export const SESSION_STRANGER = 'ses_stranger_000001';
/** A well-formed identifier with no `session` row. */
export const SESSION_NOWHERE = 'ses_exists_nowhere1';
export const SESSION_EXPIRED = 'ses_expired_0000001';

export const FIXTURE_NOW_MS = Date.UTC(2026, 8, 5, 9, 0, 0);
export const FIXTURE_CREATED_AT = toRfc3339Utc(FIXTURE_NOW_MS - 86_400_000);
/**
 * Twelve hours, matching `SESSION_LIFETIME_MS`.
 *
 * IT IS DELIBERATELY LONGER THAN THE CURSOR'S ONE-HOUR MAXIMUM AGE. Several cases move the clock
 * to age a cursor or to separate two audit timestamps, and a session that expired first would make
 * those cases fail with `unauthenticated` — a rejection for the wrong reason, which `expectError`
 * correctly refuses to accept as a pass.
 */
export const FIXTURE_EXPIRES_AT = toRfc3339Utc(FIXTURE_NOW_MS + 12 * 60 * 60 * 1000);
export const FIXTURE_ALREADY_EXPIRED_AT = toRfc3339Utc(FIXTURE_NOW_MS - 1_000);

export const CORRELATION_ID = 'corr_platform_00001';
export const REQUEST_ID = 'req_platform_000001';

// ---------------------------------------------------------------------------
// Seeders. Raw SQL on purpose: a fixture built out of the code under test cannot fail
// independently of it, and several of these states are ones no Dudo code path can create.
// ---------------------------------------------------------------------------

export function seedPrincipal(
  harness: SqliteHarness,
  principalId: string,
  status: 'active' | 'suspended' = 'active',
): void {
  harness.raw
    .prepare(
      'INSERT INTO principal (principal_id, principal_type, status, created_at) ' +
        "VALUES (?, 'user', ?, ?)",
    )
    .run(principalId, status, FIXTURE_CREATED_AT);
}

export function seedOrganization(harness: SqliteHarness, organizationId: string): void {
  harness.raw
    .prepare("INSERT INTO organization (organization_id, status, created_at) VALUES (?, 'active', ?)")
    .run(organizationId, FIXTURE_CREATED_AT);
}

export function seedMembership(
  harness: SqliteHarness,
  principalId: string,
  organizationId: string,
  role: 'owner' | 'member' = 'owner',
  status: 'active' | 'suspended' = 'active',
): void {
  harness.raw
    .prepare(
      'INSERT INTO organization_membership (principal_id, organization_id, status, created_at, ' +
        'role) VALUES (?, ?, ?, ?, ?)',
    )
    .run(principalId, organizationId, status, FIXTURE_CREATED_AT, role);
}

export function seedPlatformOperator(
  harness: SqliteHarness,
  principalId: string,
  platformRole: string,
): void {
  harness.raw
    .prepare(
      'INSERT INTO platform_operator (principal_id, platform_role, created_at) VALUES (?, ?, ?)',
    )
    .run(principalId, platformRole, FIXTURE_CREATED_AT);
}

export function seedSession(
  harness: SqliteHarness,
  sessionId: string,
  principalId: string,
  options: {
    readonly activeOrganizationId?: string | null;
    readonly expiresAt?: string;
  } = {},
): void {
  harness.raw
    .prepare(
      'INSERT INTO session (session_id, principal_id, active_organization_id, created_at, ' +
        'expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      sessionId,
      principalId,
      options.activeOrganizationId ?? null,
      FIXTURE_CREATED_AT,
      options.expiresAt ?? FIXTURE_EXPIRES_AT,
    );
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type MutableClock = Clock & { set(epochMilliseconds: number): void };

export function createMutableClock(startMs: number = FIXTURE_NOW_MS): MutableClock {
  let current = startMs;
  return {
    now: () => toRfc3339Utc(current),
    nowMs: () => current,
    set(epochMilliseconds: number): void {
      current = epochMilliseconds;
    },
  };
}

function createSequentialIdGenerator(prefix = 'gen'): IdGenerator {
  let counter = 0;
  return {
    generate(): string {
      counter += 1;
      return `${prefix}_${String(counter).padStart(12, '0')}`;
    },
  };
}

/** The default admin host. A synthetic name; nothing resolves it. */
export const ADMIN_HOST = 'admin.dudo.test';
export const APP_HOST = 'app.dudo.test';

export type PlatformWorldOptions = {
  /**
   * Wraps the REAL store. This is how every negative control in these suites is applied: no
   * production file is edited, and the wrapper sits between the composition and the shipped
   * adapter exactly where a defect would.
   */
  readonly wrapStore?: (store: PlatformOperatorStore) => PlatformOperatorStore;
  /** Wraps the audit recorder the composition produced. See `broken-platform-controls.ts`. */
  readonly wrapAudit?: (recorder: PlatformAuditRecorder) => PlatformAuditRecorder;
  /**
   * Wraps the REAL identity control-plane store, which is where the ACTION-SIDE half of the mutual
   * exclusion is read since `findPrincipal` began carrying `isPlatformOperator` and
   * `holdsMembership`. A separate seam from `wrapStore` because it is a separate check reading a
   * separate statement — see `withActionSideMutualExclusionRemoved`.
   */
  readonly wrapIdentityStore?: (store: IdentityControlPlaneStore) => IdentityControlPlaneStore;
  readonly adminHosts?: readonly string[];
  /** Overrides the daily ceilings so a suite can exhaust a budget in a handful of requests. */
  readonly dailyCeilings?: Partial<Record<'business' | 'system' | 'protection', number>>;
  readonly withMutualExclusionTriggers?: boolean;
  /** Skips seeding, for a suite that wants an empty control plane. */
  readonly seed?: boolean;
};

export type PlatformCallOptions = {
  readonly sessionId?: string | null;
  /** A raw credential string, used instead of minting one. For malformed-credential cases. */
  readonly rawCredential?: string;
  readonly bodyText?: string;
  readonly queryString?: string;
  readonly correlationId?: string;
  readonly extraHeaders?: ReadonlyMap<string, string>;
};

export type PlatformWorld = {
  readonly control: SqliteHarness;
  readonly store: PlatformOperatorStore;
  readonly dependencies: PlatformRouteDependencies;
  readonly sessions: SessionResolver;
  readonly admission: ControlPlaneWriteAdmission;
  readonly clock: MutableClock;
  readonly ids: IdGenerator;
  readonly signer: SessionCredentialSigner;
  route(routeId: PlatformRouteId): PlatformRoute;
  /** Drives the SHIPPED dispatcher for one route. */
  call(routeId: PlatformRouteId, options?: PlatformCallOptions): Promise<Result<unknown>>;
  /** Every row of `platform_operator_action`, in insertion order. */
  actionRows(): Record<string, unknown>[];
  close(): void;
};

/**
 * The seeded state, written out so a reader of any suite can see the whole world at once.
 *
 *   ORG_ALPHA, ORG_BETA, ORG_GAMMA   three Organizations, so pagination has something to page.
 *   PRN_ADMIN                        platform_operator, role 'platform-admin'. NO membership.
 *   PRN_MODERATOR                    platform_operator, role 'marketplace-moderator'. NO membership.
 *   PRN_TENANT_OWNER                 organization_membership in ORG_ALPHA at 'owner'. NO operator row.
 *   PRN_TENANT_MEMBER                organization_membership in ORG_BETA at 'member'. NO operator row.
 *   PRN_BOTH_TABLES                  *** BOTH TABLES ***. The state `0024` exists to forbid.
 *   PRN_SUSPENDED_ADMIN              platform_operator, and `principal.status = 'suspended'`.
 *   PRN_NOWHERE                      nothing at all.
 *
 * `PRN_BOTH_TABLES` IS SEEDED WITH THE TWO INSERT TRIGGERS TEMPORARILY DROPPED, AND THAT MODELS A
 * RESTORE. See the constant's own documentation above: a restore does not re-run triggers, it is
 * the one path they structurally cannot cover, and it is therefore the case in which the
 * authorization-side check is the ONLY control rather than a second one. It does not weaken the
 * trigger cases, which build their own world and assert the ABORT directly.
 */
function seedWorld(harness: SqliteHarness, withTriggers: boolean): void {
  seedOrganization(harness, ORG_ALPHA);
  seedOrganization(harness, ORG_BETA);
  seedOrganization(harness, ORG_GAMMA);

  seedPrincipal(harness, PRN_ADMIN);
  seedPrincipal(harness, PRN_MODERATOR);
  seedPrincipal(harness, PRN_TENANT_OWNER);
  seedPrincipal(harness, PRN_TENANT_MEMBER);
  seedPrincipal(harness, PRN_BOTH_TABLES);
  seedPrincipal(harness, PRN_STRANGER);
  seedPrincipal(harness, PRN_SUSPENDED_ADMIN, 'suspended');

  seedPlatformOperator(harness, PRN_ADMIN, 'platform-admin');
  seedPlatformOperator(harness, PRN_MODERATOR, 'marketplace-moderator');
  seedPlatformOperator(harness, PRN_SUSPENDED_ADMIN, 'platform-admin');

  seedMembership(harness, PRN_TENANT_OWNER, ORG_ALPHA, 'owner');
  seedMembership(harness, PRN_TENANT_MEMBER, ORG_BETA, 'member');

  // The forbidden state. See the header above for why it is created this way and not another.
  if (withTriggers) {
    harness.raw.exec('DROP TRIGGER IF EXISTS platform_operator_excludes_membership_on_insert;');
    harness.raw.exec('DROP TRIGGER IF EXISTS membership_excludes_platform_operator_on_insert;');
  }
  seedPlatformOperator(harness, PRN_BOTH_TABLES, 'platform-admin');
  seedMembership(harness, PRN_BOTH_TABLES, ORG_ALPHA, 'owner');
  if (withTriggers) {
    harness.raw.exec(readControlPlaneMigration(MUTUAL_EXCLUSION_MIGRATION));
  }

  seedSession(harness, SESSION_ADMIN, PRN_ADMIN);
  seedSession(harness, SESSION_MODERATOR, PRN_MODERATOR);
  seedSession(harness, SESSION_TENANT_OWNER, PRN_TENANT_OWNER);
  seedSession(harness, SESSION_TENANT_MEMBER, PRN_TENANT_MEMBER);
  seedSession(harness, SESSION_BOTH_TABLES, PRN_BOTH_TABLES);
  seedSession(harness, SESSION_BOTH_TABLES_SELECTED, PRN_BOTH_TABLES, {
    activeOrganizationId: ORG_ALPHA,
  });
  seedSession(harness, SESSION_TENANT_OWNER_SELECTED, PRN_TENANT_OWNER, {
    activeOrganizationId: ORG_ALPHA,
  });
  seedSession(harness, SESSION_STRANGER, PRN_STRANGER);
  seedSession(harness, SESSION_SUSPENDED, PRN_SUSPENDED_ADMIN);
  seedSession(harness, SESSION_EXPIRED, PRN_ADMIN, { expiresAt: FIXTURE_ALREADY_EXPIRED_AT });
}

/**
 * How every suite in this directory obtains its world.
 *
 * IT IS A PARAMETER RATHER THAN AN IMPORT so that `run-platform-operator.ts` can rebuild the same
 * suite with a control deliberately broken. A suite that constructed its own world could not be
 * put under a negative control without editing the suite, which is how a control ends up being
 * argued about instead of run.
 */
export type MakePlatformWorld = (options?: PlatformWorldOptions) => Promise<PlatformWorld>;

export async function createPlatformWorld(
  options: PlatformWorldOptions = {},
): Promise<PlatformWorld> {
  const withTriggers = options.withMutualExclusionTriggers !== false;
  const control = createPlatformControlPlane({ withMutualExclusionTriggers: withTriggers });
  if (options.seed !== false) {
    seedWorld(control, withTriggers);
  }

  const clock = createMutableClock();
  const ids = createSequentialIdGenerator('gen');

  // Fixed test constants. Not credentials; of no value outside this process; never printed.
  const sessionSigningKey = new Uint8Array(32).fill(0x11);
  const cursorSigningKey = new Uint8Array(32).fill(0x2a);

  const signer = await createSessionCredentialSigner(sessionSigningKey);
  const credentials = createSessionCredentialReader(signer);

  const controlPlaneStores = createD1ControlPlaneStores(control.database);
  const budget = createInProcessDayWriteBudget({
    ...DAILY_ALLOCATION,
    ...options.dailyCeilings,
  });
  const admission = createInProcessControlPlaneWriteAdmission(budget);

  const identityStore =
    options.wrapIdentityStore === undefined
      ? controlPlaneStores.identity
      : options.wrapIdentityStore(controlPlaneStores.identity);

  const sessions = createSessionResolver({
    store: identityStore,
    authorization: createMembershipPrincipalAuthorizationSource(),
    admission,
    ids,
    clock,
    sessionLifetimeMs: 12 * 60 * 60 * 1000,
  });

  const realStore = createD1PlatformStore(control.database);
  const store = options.wrapStore === undefined ? realStore : options.wrapStore(realStore);

  const composed = await createPlatformComposition({
    store,
    admission,
    authorizer: createAuthorizer(),
    ids,
    clock,
    readSessionId: (headers) => credentials.read({ headers }),
    authenticatePrincipal: (sessionId) => sessions.resolvePrincipalId(sessionId),
    cursorSigningKey,
    adminHosts: options.adminHosts ?? [ADMIN_HOST],
  });

  const dependencies: PlatformRouteDependencies =
    options.wrapAudit === undefined
      ? composed
      : { ...composed, audit: options.wrapAudit(composed.audit) };

  function route(routeId: PlatformRouteId): PlatformRoute {
    const found = platformRoutes().find((entry) => entry.id === routeId);
    if (found === undefined) {
      throw new Error(`no such platform route in the shipped table: ${routeId}`);
    }
    return found;
  }

  return {
    control,
    store,
    dependencies,
    sessions,
    admission,
    clock,
    ids,
    signer,
    route,

    async call(routeId, callOptions = {}): Promise<Result<unknown>> {
      const headers = new Map<string, string>(callOptions.extraHeaders ?? []);
      if (callOptions.rawCredential !== undefined) {
        headers.set('authorization', `Bearer ${callOptions.rawCredential}`);
      } else if (callOptions.sessionId !== undefined && callOptions.sessionId !== null) {
        headers.set('authorization', `Bearer ${await signer.mint(callOptions.sessionId)}`);
      }
      return dispatchPlatformRoute(dependencies, route(routeId), {
        bodyText: callOptions.bodyText ?? '',
        headers,
        queryString: callOptions.queryString ?? '',
        requestId: REQUEST_ID,
        correlationId: callOptions.correlationId ?? CORRELATION_ID,
      });
    },

    actionRows(): Record<string, unknown>[] {
      return control.raw
        .prepare('SELECT * FROM platform_operator_action ORDER BY rowid')
        .all() as Record<string, unknown>[];
    },

    close(): void {
      control.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Expected error values, written out in full.
//
// Every negative assertion in these suites compares the WHOLE value through `expectError`, so a
// case that expected `forbidden` and received `unauthenticated`, `invalid_argument` or
// `unavailable` FAILS. Without that, the mutual-exclusion cases would go green the moment the
// fixture stopped working.
// ---------------------------------------------------------------------------

export const EXPECTED_FORBIDDEN = {
  code: 'forbidden',
  message: 'The principal is not permitted to perform this operation.',
};

export const EXPECTED_UNAUTHENTICATED = {
  code: 'unauthenticated',
  message: 'Authentication is required.',
};

export const EXPECTED_UNAVAILABLE = {
  code: 'unavailable',
  message: 'A dependency is unavailable.',
};

export const EXPECTED_CONFLICT = {
  code: 'conflict',
  message: 'The request conflicts with the current state.',
};

export const EXPECTED_NOT_FOUND = {
  code: 'not_found',
  message: 'The requested resource does not exist.',
};

export function expectedInvalidArgument(
  field: string,
  issue: string,
): { code: string; message: string; details: { field: string; issue: string }[] } {
  return {
    code: 'invalid_argument',
    message: 'The request is not valid.',
    details: [{ field, issue }],
  };
}
