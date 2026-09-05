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
import { createConfirmationService } from '../../../platform/core/confirmation/confirmation-service.ts';
import { createConfirmationGate } from '../../../platform/core/confirmation/confirmation-gate.ts';
import type { ConfirmationGate } from '../../../platform/core/confirmation/confirmation-gate.ts';
import { createConfirmationBinder } from '../../../platform/core/confirmation/binding.ts';
import { createD1ConfirmationStore } from '../../../platform/core/confirmation/adapters/d1/d1-confirmation-store.ts';

// ---- The Template catalogue, the onboarding service, and the tenant side they need. --------
//
// ADDED 2026-09-05. `createPlatformComposition` REQUIRES `templates` and `onboarding`, and this
// fixture passed NEITHER. Node strips types, so the world built anyway and the two Template read
// routes answered `internal` — a method call on `undefined` — while `platform.organizations.create`
// could not have succeeded at all. `npm run typecheck:tests` reported it at the call site; the
// suites did not, because a suite cannot see a dependency that was never composed.
import { createD1TemplateStore } from '../../../platform/core/platform/adapters/d1/d1-template-store.ts';
import type { TemplateStore } from '../../../platform/core/platform/template-store.ts';
import { createOnboardingService } from '../../../platform/core/onboarding/onboarding-service.ts';
import type { OnboardingService } from '../../../platform/core/onboarding/onboarding.ts';
import { createDirectoryTenantStoreResolver } from '../../../platform/core/tenancy/directory-tenant-store-resolver.ts';
import type { TenantStoreResolver } from '../../../platform/core/tenancy/tenant-store-resolver.ts';
import { createD1TenantStore } from '../../../platform/core/storage/adapters/d1/d1-store.ts';
import type { TenantScopedStore } from '../../../platform/core/storage/store.ts';
import { createStoreAuditSink } from '../../../platform/core/audit/store-audit-sink.ts';
import { createD1CredentialStore } from '../../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import { createCredentialVerifier } from '../../../platform/core/identity/credential-verifier.ts';
import { createHmacIdentifierHasher } from '../../../platform/core/identity/credential-store.ts';
import { buildSeedRows } from '../../../platform/core/identity/tools/seed-principal.ts';
import {
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
} from '../../../platform/core/identity/credential-verifier.ts';
import type { ConfirmationService } from '../../../platform/core/confirmation/confirmation-service.ts';
import { createInProcessRequestCoordinator } from '../../../platform/core/protection/in-process-coordinator.ts';
import { deriveLoginCredential as adminDerive } from '../../../platform/admin/src/api/kdf.ts';
import { normalizeTemplateName } from '../../../platform/core/platform/templates.ts';

/**
 * A synthetic high-entropy password, generated per call.
 *
 * ===========================================================================================
 * IT IS **NOT** `platform/admin/src/api/generate-password.ts::generateAdminPassword`, AND THE
 * REASON IS A LIMITATION WORTH RECORDING RATHER THAN A PREFERENCE.
 * ===========================================================================================
 *
 * That module imports `./kdf` WITHOUT A FILE EXTENSION — a bundler-resolved specifier, which is
 * correct for Vite and unresolvable by Node. `node packages/testing/run-platform-operator.ts`
 * fails with `ERR_MODULE_NOT_FOUND` on the import, not on anything the test does. `kdf.ts` itself
 * has no relative imports, which is why `deriveLoginCredential` CAN be imported and is.
 *
 * SO THE DERIVATION IS THE CONSOLE'S AND THE GENERATOR IS NOT, and only the derivation is what
 * these cases claim. **The generator is untested by this suite** and that is reported as a gap
 * rather than implied to be covered: the property `0026` cares about is that a value derived by
 * the console is accepted by the login path, and the entropy of the password feeding it is a
 * separate claim needing a test that can load that module.
 *
 * Reported to the Team Lead as an observation for `admin-shell`: a module in `platform/admin`
 * that only a bundler can resolve cannot be reached by any Node-run suite, so anything it holds
 * is structurally untestable here.
 */
function syntheticAdminPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url by hand: 24 bytes is a whole number of 3-byte groups, so no padding arises.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    out += alphabet[(chunk >>> 18) & 63]! + alphabet[(chunk >>> 12) & 63]!;
    out += alphabet[(chunk >>> 6) & 63]! + alphabet[chunk & 63]!;
  }
  return out;
}

/**
 * The identifier lookup key. A fixed 32-byte test constant of no value outside this process; it is
 * not a credential, is never printed, and is the same shape `confirmation-fixture.ts` declares.
 */
const IDENTIFIER_LOOKUP_KEY = new TextEncoder().encode('dudo-platform-lookup-key-32byte!');

/**
 * A body that gets each route as far as AUTHORIZATION, and past it.
 *
 * `platform.confirmations.request` resolves its permission FROM THE BODY and the class validates
 * before it authorizes, so a bodyless request is refused at step 1 and never reaches the check a
 * class-wide case is about. Exported because three suites loop over the route table and all three
 * need it — a copy in each is three places for it to drift.
 *
 * ===========================================================================================
 * IT IS DELIBERATELY **NOT** A BODY THAT SUCCEEDS, AND THE DISTINCTION IS LOAD-BEARING.
 * ===========================================================================================
 *
 * A DENIAL CASE MUST BE REFUSED FOR ITS OWN REASON. `platform.organizations.create` declares four
 * fields and `platform.templates.create` declares `name`, but **neither is validated by the class**
 * — `parseOnboardingInput` and `parseTemplateCreate` run inside the HANDLER, at step 6, after
 * authority resolution at step 4. So an empty body reaches the authority check exactly as a full
 * one would, and every denial case in `mutual-exclusion.ts` is refused by the invariant it names
 * rather than by validation.
 *
 * **THAT IS WHY THIS FUNCTION MUST NOT BE "IMPROVED" INTO `successfulCallFor` BELOW.** Making
 * every body valid would have every denial case send a request that could have succeeded, which
 * sounds stricter and is not: it moves the refusal no earlier, costs a real derivation per call,
 * and — for onboarding — would perform six control-plane writes per route iteration in a suite
 * that counts audit rows.
 *
 * A CASE THAT EXPECTS **SUCCESS** USES `successfulCallFor`. The two are separate because they are
 * asking different questions, and one function serving both would answer neither exactly.
 */
export function bodyForPlatformRoute(routeId: string): string {
  return routeId === 'platform.confirmations.request'
    ? JSON.stringify({
        action_id: 'platform.credentials.reset',
        parameters: { principal_id: 'prn_target_00000001' },
      })
    : '';
}

/**
 * A body and path parameters that make each route SUCCEED for `SESSION_ADMIN` in a seeded world.
 *
 * THE COUNTERPART TO `bodyForPlatformRoute`, and the reason both exist is in that function's
 * header. Every case that loops over the route table asserting a positive outcome — the audit
 * suite's P4 cases, and authorization's control that a role holding the permission is served —
 * needs the route to actually work, and the seven routes need seven different things:
 *
 *   list / whoami / templates.list   nothing
 *   confirmations.request            a body naming a confirmable operation
 *   organizations.create             four validated fields, one naming a SEEDED Template
 *   templates.create                 a name and the declared object field
 *   templates.read                   a PATH PARAMETER, which no other route in the class takes
 *
 * IT IS ASYNC BECAUSE `derived_value` IS DERIVED. See `onboardingRequest` for why a typed-out
 * 43-character constant would satisfy the validator and prove nothing.
 *
 * **IT IS NOT IDEMPOTENT FOR TWO ROUTES.** `organizations.create` creates a real Organization and
 * `templates.create` a real Template, each once per call, and `templates.create` will answer
 * `conflict` on a second call in the same world because the normalised name collides. A case that
 * calls it twice must vary the name; that is a property of the route, not a defect in this helper.
 */
export async function successfulCallFor(
  routeId: string,
): Promise<{ readonly bodyText: string; readonly pathParams: Readonly<Record<string, string>> }> {
  if (routeId === 'platform.organizations.create') {
    return { bodyText: (await onboardingRequest()).bodyText, pathParams: {} };
  }
  if (routeId === 'platform.templates.create') {
    return { bodyText: templateCreateRequest(), pathParams: {} };
  }
  if (routeId === 'platform.templates.read') {
    // THE ONLY ROUTE IN THE CLASS WITH A PATH PARAMETER. Omitting it does not answer
    // `invalid_argument` — the class validated nothing, because `world.call` supplies the params
    // directly rather than through `matchPlatformRoute` — it answers `internal` from the handler.
    // A case that read `internal` as "the route is broken" would have been reading the fixture.
    return { bodyText: '', pathParams: { template_id: TEMPLATE_SEEDED } };
  }
  return { bodyText: bodyForPlatformRoute(routeId), pathParams: {} };
}
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
  '0012_template.sql',
  // ADDED 2026-09-05, and it was found by the harness's OWN fidelity control rather than by
  // reading a changelog: `suites/harness/harness-fidelity.ts` compares this list against the
  // directory on disk and went red the moment the migration landed. That control is the reason a
  // suite cannot quietly run against a schema older than the one shipping.
  '0013_organization_template.sql',
]);

export const MUTUAL_EXCLUSION_MIGRATION = '0010_platform_operator_mutual_exclusion.sql';

export function readControlPlaneMigration(fileName: string): string {
  return readFileSync(new URL(fileName, MIGRATION_DIRECTORY), 'utf8');
}

/**
 * The TENANT migrations onboarding needs, and only those.
 *
 * `0001_audit_event.sql` and `0002_business.sql` are what `createFirstWorkspace` writes: one
 * `business` row and one `audit_event` row, as a single `write`. `0003_denial_summary.sql` and the
 * Customer table are deliberately ABSENT — `control-plane-fixture.ts` records the reason for the
 * same choice on the other side: *"applying a migration a suite does not need would hide a missing
 * dependency rather than reveal one."*
 */
const TENANT_MIGRATION_DIRECTORY = new URL('../../../platform/core/migrations/', import.meta.url);

export const TENANT_MIGRATIONS: readonly string[] = Object.freeze([
  '0001_audit_event.sql',
  '0002_business.sql',
]);

/**
 * The logical binding name written into `tenant_directory` by onboarding.
 *
 * A harness constant, and it is REQUIRED to be one: `onboarding-service.ts` takes
 * `tenantBindingName` with no default because *"a default here would be this file choosing which
 * physical database a new customer's data lands in."* The factory in `createPlatformWorld` answers
 * to this name and to no other, so a directory row naming a different binding resolves to
 * `unavailable` — which is the shipped failure, reproduced rather than described.
 */
export const TENANT_BINDING_NAME = 'DB_TENANT';

export function createTenantDatabase(): SqliteHarness {
  const harness = createSqliteDatabase();
  for (const fileName of TENANT_MIGRATIONS) {
    harness.raw.exec(readFileSync(new URL(fileName, TENANT_MIGRATION_DIRECTORY), 'utf8'));
  }
  return harness;
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

/**
 * A Template seeded into the catalogue, so `platform.organizations.create` has a resolvable
 * `template_id` and `platform.templates.read` has something to read.
 *
 * ITS NAME IS DELIBERATELY NOT A BUSINESS TYPE. `0025` decision 2's rule is that no identifier in
 * `platform/core/**` may name one — and a fixture that seeded 'Dental Clinic' would put the exact
 * string the rule forbids into a file that runs on every check, which is one copy-paste from being
 * the thing that breaks it. `suites/platform-operator/business-type-boundary.ts` asserts the rule;
 * this constant declines to undermine it.
 */
/**
 * The operator's own login identifier and password.
 *
 * ===========================================================================================
 * ENROLLED BECAUSE A CONFIRMATION RE-AUTHENTICATES, AND RE-AUTHENTICATION NEEDS A CREDENTIAL.
 * ===========================================================================================
 *
 * `0027`'s gate does two things on every critical operation: it spends a bound confirmation AND it
 * verifies the caller's own credential. Before this, `PRN_ADMIN` had a session and no credential
 * row — enough for every route in the shipped table, because none of them is critical. **A
 * confirmation case against an operator with no credential would fail at the verifier and pass for
 * the wrong reason**, looking exactly like a working gate.
 *
 * THE PASSWORD IS SYNTHETIC AND FIXED so the derivation is stable across a run. It is never
 * printed, never asserted on, and of no value outside this process. Only the DERIVED value is
 * submitted, ever — `0015` §D, unchanged.
 */
export const OPERATOR_IDENTIFIER = 'platform.admin@example.invalid';
export const OPERATOR_PASSWORD = 'platform-fixture-operator-0001';
/** A second enrolled principal, so the cross-principal attack on a confirmation is reachable. */
export const MODERATOR_IDENTIFIER = 'marketplace.mod@example.invalid';
export const MODERATOR_PASSWORD = 'platform-fixture-moderator-002';

export const TEMPLATE_SEEDED = 'tpl_seeded_00000001';
export const TEMPLATE_SEEDED_NAME = 'Fixture Template One';
/** A well-formed Template identifier with no row. */
export const TEMPLATE_NOWHERE = 'tpl_exists_nowhere1';

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

export function seedTemplate(
  harness: SqliteHarness,
  templateId: string,
  name: string,
): void {
  harness.raw
    .prepare(
      'INSERT INTO template (template_id, name, normalized_name, label_organization, ' +
        'label_workspace, label_branch, status, created_at) ' +
        "VALUES (?, ?, ?, 'Organization', 'Workspace', 'Branch', 'active', ?)",
    )
    .run(templateId, name, normalizeTemplateName(name), FIXTURE_CREATED_AT);
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
  /**
   * Wraps the REAL `ConfirmationGate` this class composes.
   *
   * ===========================================================================================
   * THIS IS THE SEAM `0027`'s CENTRAL CONTROL WAS MISSING, AND ITS ABSENCE WAS A PARTIAL CONTROL.
   * ===========================================================================================
   *
   * The gate is now enforced at TWO independent entry points reading two different code paths:
   * `action/pipeline.ts` at its step 6, and `dispatchPlatformRoute` at its step 5b. Until this
   * option existed, `withConfirmationCheckRemoved` reached only the first — `confirmation-fixture.
   * ts::wrapGate` — while this class composed its own. Removing one and not the other is exactly
   * the shape `README.md` names as the standing requirement:
   *
   *   *"wherever an invariant is enforced at N points, the suite needs a control that removes all
   *   N — not N controls that each remove one."*
   *
   * With one half removed the platform class still refuses, the run still prints a control line,
   * and the line means nothing.
   */
  readonly wrapGate?: (gate: ConfirmationGate) => ConfirmationGate;
  /**
   * `false` composes NO gate at all — `PlatformRouteDependencies.confirmations` is `undefined`.
   *
   * A DIFFERENT THING FROM A BROKEN GATE AND BOTH ARE TESTED. `composition.ts` states that a
   * deployment with the service and no gate is coherent and fails closed: `dispatchPlatformRoute`
   * answers `unavailable` for a gated route rather than performing it. That is the uncomposed
   * case; `wrapGate` is the gate that runs and never refuses.
   */
  readonly composeGate?: boolean;
  /**
   * Wraps the REAL tenant-store resolver `OnboardingService` holds.
   *
   * IT IS THE ONLY WAY TO REACH THE `warnings` PATH. `organization-onboarding-v1` rules that a
   * failure after the control-plane batch commits returns **201 with warnings**, never an error,
   * and the only failures that can produce it are on the tenant side. Refusing to resolve is the
   * shape of a tenant database that is unreachable at the moment a customer is created.
   */
  readonly wrapResolver?: (resolver: TenantStoreResolver) => TenantStoreResolver;
  /** Wraps the REAL Template store, for the routes that read it. */
  readonly wrapTemplates?: (templates: TemplateStore) => TemplateStore;
};

export type PlatformCallOptions = {
  readonly sessionId?: string | null;
  /** A raw credential string, used instead of minting one. For malformed-credential cases. */
  readonly rawCredential?: string;
  readonly bodyText?: string;
  readonly queryString?: string;
  readonly correlationId?: string;
  readonly extraHeaders?: ReadonlyMap<string, string>;
  /** Required by any route declaring a path parameter. Defaults to `{}`; see `call`. */
  readonly pathParams?: Readonly<Record<string, string>>;
};

export type PlatformWorld = {
  readonly control: SqliteHarness;
  /**
   * The TENANT database. A second `node:sqlite` instance, holding `audit_event` and `business`.
   *
   * SEPARATE FROM `control` BECAUSE THEY ARE SEPARATE DATABASES IN PRODUCTION, and onboarding is
   * the one operation that writes to both. A single harness database would make the two-database
   * problem `onboarding-service.ts` describes — *"there is no batch that commits both"* —
   * invisible, and the `warnings` path exists precisely because that problem is real.
   */
  readonly tenant: SqliteHarness;
  readonly store: PlatformOperatorStore;
  readonly templates: TemplateStore;
  readonly onboarding: OnboardingService;
  readonly dependencies: PlatformRouteDependencies;
  readonly sessions: SessionResolver;
  readonly admission: ControlPlaneWriteAdmission;
  readonly clock: MutableClock;
  readonly ids: IdGenerator;
  readonly signer: SessionCredentialSigner;
  route(routeId: PlatformRouteId): PlatformRoute;
  /** Drives the SHIPPED dispatcher for one route. */
  call(routeId: PlatformRouteId, options?: PlatformCallOptions): Promise<Result<unknown>>;
  /**
   * The confirmation SERVICE. Exposed so a suite can issue a real challenge through the shipped
   * code, rather than fabricating a token the gate would then be asked to trust.
   */
  readonly confirmations: ConfirmationService;
  /**
   * The operator's own login identifier and the value its console would derive, for the
   * re-authentication half of a confirmation. Enrolled by `seedWorld` for `PRN_ADMIN`.
   */
  readonly operatorIdentifier: string;
  operatorDerivedValue(): Promise<string>;
  /**
   * Drives the SHIPPED dispatcher for a route that is NOT in the shipped table, with a handler
   * supplied by the caller.
   *
   * IT EXISTS FOR ONE REASON: no route in the shipped table is confirmation-gated today, so the
   * platform class's half of the gate is unreachable without one. See
   * `createSyntheticCriticalRoute` for why that is a hole in the negative control rather than a
   * gap in coverage. Everything about the call is real except the route table entry.
   */
  callRoute(
    route: PlatformRoute,
    handler: (context: unknown, body: Readonly<Record<string, unknown>>) => Promise<unknown>,
    options?: PlatformCallOptions,
  ): Promise<Result<unknown>>;
  /** Every row of `platform_operator_action`, in insertion order. */
  actionRows(): Record<string, unknown>[];
  /** Rows of any control-plane table, in insertion order. Synthetic data only. */
  controlRows(table: string): Record<string, unknown>[];
  /** Rows of any tenant table, in insertion order. */
  tenantRows(table: string): Record<string, unknown>[];
  /**
   * Verifies a submitted identifier and derived value against the SHIPPED `CredentialVerifier`,
   * over the SHIPPED credential store.
   *
   * WHAT IT PROVES AND WHAT IT DOES NOT. It proves the credential row onboarding wrote is one the
   * login path accepts — which is the whole of *"the created admin authenticates with the
   * console-derived value on the first attempt"* at the credential layer. It does NOT issue a
   * session: that is `session-routes.ts`, a different request class, and claiming it here would
   * be claiming a round trip this call does not make.
   */
  authenticate(
    identifier: string,
    derivedValue: string,
  ): Promise<Result<{ readonly kind: string; readonly principalId?: string }>>;
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

  // ONE Template. Onboarding validates `template_id` before it reserves any capacity, so without
  // a row every onboarding case would answer `not_found` and every one of them would pass for the
  // wrong reason. `TEMPLATE_NOWHERE` is the fabricated control and is deliberately not seeded.
  seedTemplate(harness, TEMPLATE_SEEDED, TEMPLATE_SEEDED_NAME);

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
  const tenant = createTenantDatabase();
  if (options.seed !== false) {
    seedWorld(control, withTriggers);
    // THE TWO OPERATOR CREDENTIALS, enrolled through the REAL `buildSeedRows`. Async, so it
    // cannot live in `seedWorld`. See `OPERATOR_IDENTIFIER` for why a confirmation case against
    // an operator with no credential would pass for the wrong reason.
    for (const [principalId, identifier, password] of [
      [PRN_ADMIN, OPERATOR_IDENTIFIER, OPERATOR_PASSWORD],
      [PRN_MODERATOR, MODERATOR_IDENTIFIER, MODERATOR_PASSWORD],
    ] as const) {
      const rows = await buildSeedRows({
        email: identifier,
        password,
        lookupKey: IDENTIFIER_LOOKUP_KEY,
        nowMs: FIXTURE_NOW_MS,
        principalId,
      });
      control.raw
        .prepare(
          'INSERT INTO principal_credential (identifier_hash, principal_id, algorithm, ' +
            'iterations, salt, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          rows.identifierHash,
          principalId,
          SUPPORTED_ALGORITHM,
          SERVER_KDF_ITERATIONS,
          rows.salt,
          rows.verifier,
          FIXTURE_CREATED_AT,
        );
    }
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

  // The confirmation service, composed so `platform.confirmations.request` is reachable.
  //
  // ADDED 2026-09-05 when that route joined the class. Without it the route answers `unavailable`
  // — the fail-closed shape for an uncomposed dependency — and every class-wide case that loops
  // over the route table would have been asserting against a route that could not succeed. That is
  // a fixture that models a deployment nobody ships.
  const confirmations = createConfirmationService({
    store: createD1ConfirmationStore(control.database),
    binder: await createConfirmationBinder(new Uint8Array(32).fill(0x4d)),
    admission,
    ids,
    clock,
  });

  // ---- THE CONFIRMATION GATE. A DIFFERENT OBJECT FROM THE SERVICE ABOVE, AND BOTH ARE NEEDED.
  //
  // `composition.ts`: *"`confirmations` ISSUES a challenge — the challenge route's dependency.
  // `confirmationGate` SPENDS one and re-authenticates — the dispatcher's dependency."* They are
  // deliberately not merged, because a component able to issue the token it also verifies is one
  // refactor from issuing its own.
  //
  // COMPOSED UNCONDITIONALLY, as `worker-entry.ts` composes it, because a deployment able to omit
  // it is a deployment where confirmation is optional. `composeGate: false` builds the world
  // WITHOUT it, which is the uncomposed-runtime case and not the default.
  const identifierHasher = await createHmacIdentifierHasher(IDENTIFIER_LOOKUP_KEY);
  const credentialVerifier = await createCredentialVerifier({
    credentials: createD1CredentialStore(control.database),
    identifiers: identifierHasher,
  });
  const realGate = createConfirmationGate({ service: confirmations, verifier: credentialVerifier });
  const gate = options.wrapGate === undefined ? realGate : options.wrapGate(realGate);

  // ---- THE TEMPLATE CATALOGUE. A separate port from `store`, as `composition.ts` requires.
  const realTemplates = createD1TemplateStore(control.database);
  const templates =
    options.wrapTemplates === undefined ? realTemplates : options.wrapTemplates(realTemplates);

  // ===========================================================================================
  // ---- THE ONBOARDING SERVICE, ASSEMBLED EXACTLY AS `worker-entry.ts` ASSEMBLES IT.
  // ===========================================================================================
  //
  // *** IT IS BUILT HERE AND NOT INSIDE `createPlatformComposition`, AND THAT IS THE POINT. ***
  // `onboarding.ts`: putting a resolver on the platform composition root *"would defeat P1 for the
  // whole class"*. `worker-entry.ts` is the composition root that holds the resolver in
  // production; this fixture is that root here. Building it any other way would test a wiring
  // nobody ships.
  //
  // THE RESOLVER IS THE SHIPPED `createDirectoryTenantStoreResolver` OVER THE REAL
  // `tenant_directory`, not a static map. That matters for onboarding specifically: the directory
  // row is written by the operation itself, milliseconds before it is read, so a static resolver
  // constructed in advance would resolve an Organization whose directory row it never saw — and
  // step 6's *"possible only because the directory entry committed in step 3-4"* would be
  // untested by construction.
  const controlPlaneStoresForOnboarding = createD1ControlPlaneStores(control.database);
  const realResolver = createDirectoryTenantStoreResolver(
    controlPlaneStoresForOnboarding.tenantDirectory,
    (bindingName, organizationId) =>
      bindingName === TENANT_BINDING_NAME
        ? createD1TenantStore(tenant.database, organizationId)
        : undefined,
  );
  const resolver =
    options.wrapResolver === undefined ? realResolver : options.wrapResolver(realResolver);

  const onboarding = createOnboardingService({
    controlPlane: controlPlaneStoresForOnboarding.identity,
    credentials: createD1CredentialStore(control.database),
    identifiers: identifierHasher,
    templates,
    operators: store,
    admission,
    resolver,
    // Core's own in-process coordinator, which exists for exactly this and is marked
    // never-for-deployment. A harness-local one would verify the harness's algorithm.
    coordinator: createInProcessRequestCoordinator(budget),
    auditSinkFor: (tenantStore: TenantScopedStore) => createStoreAuditSink(tenantStore, ids),
    ids,
    clock,
    // REQUIRED, NO DEFAULT — `0006` §0.2 forbids the shape of a default by name. The harness
    // chooses one and says so; it is the only binding the factory above answers to, so a
    // directory row naming any other binding resolves to `unavailable`, as production would.
    tenantBindingName: TENANT_BINDING_NAME,
  });

  const composed = await createPlatformComposition({
    store,
    templates,
    onboarding,
    admission,
    confirmations,
    confirmationGate: options.composeGate === false ? undefined : gate,
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
    tenant,
    store,
    templates,
    onboarding,
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
        // ADDED 2026-09-05, when `PlatformRouteRequest` gained it for the routes that take a path
        // parameter. `{}` IS CORRECT FOR EVERY ROUTE THAT DECLARES NONE and is wrong for one that
        // does — so a case exercising such a route must pass them explicitly rather than rely on
        // this default. Omitting the field entirely was a TYPE ERROR that the runtime happily
        // ignored: the suites stayed green while the fixture no longer matched the port's shape,
        // which is exactly the class of thing `packages/testing` being unchecked hides.
        pathParams: callOptions.pathParams ?? {},
        requestId: REQUEST_ID,
        correlationId: callOptions.correlationId ?? CORRELATION_ID,
      });
    },

    confirmations,
    operatorIdentifier: OPERATOR_IDENTIFIER,
    operatorDerivedValue: async () =>
      (await adminDerive(OPERATOR_IDENTIFIER, OPERATOR_PASSWORD)).derived_key,

    async callRoute(route, handler, callOptions = {}): Promise<Result<unknown>> {
      const headers = new Map<string, string>(callOptions.extraHeaders ?? []);
      if (callOptions.rawCredential !== undefined) {
        headers.set('authorization', `Bearer ${callOptions.rawCredential}`);
      } else if (callOptions.sessionId !== undefined && callOptions.sessionId !== null) {
        headers.set('authorization', `Bearer ${await signer.mint(callOptions.sessionId)}`);
      }
      // THE HANDLER IS INJECTED, THE REST OF `dependencies` IS THE COMPOSED ONE. The gate, the
      // authority resolver, the authorizer and the audit recorder are all the shipped instances —
      // a suite that replaced any of them would be testing itself.
      const withHandler: PlatformRouteDependencies = {
        ...dependencies,
        handlers: {
          ...dependencies.handlers,
          [route.id]: handler as PlatformRouteDependencies['handlers'][PlatformRouteId],
        },
      };
      return dispatchPlatformRoute(withHandler, route, {
        bodyText: callOptions.bodyText ?? '',
        headers,
        queryString: callOptions.queryString ?? '',
        pathParams: callOptions.pathParams ?? {},
        requestId: REQUEST_ID,
        correlationId: callOptions.correlationId ?? CORRELATION_ID,
      });
    },

    actionRows(): Record<string, unknown>[] {
      return control.raw
        .prepare('SELECT * FROM platform_operator_action ORDER BY rowid')
        .all() as Record<string, unknown>[];
    },

    controlRows(table: string): Record<string, unknown>[] {
      // The table name is interpolated because SQLite cannot parameterise an identifier. Every
      // caller is a suite in this repository passing a literal; no caller input reaches it.
      return control.raw
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all() as Record<string, unknown>[];
    },

    tenantRows(table: string): Record<string, unknown>[] {
      return tenant.raw
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all() as Record<string, unknown>[];
    },

    authenticate(identifier, derivedValue) {
      return credentialVerifier.verify(identifier, derivedValue) as Promise<
        Result<{ readonly kind: string; readonly principalId?: string }>
      >;
    },

    close(): void {
      control.close();
      tenant.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Building a valid onboarding request. The values are DERIVED, not typed out.
// ---------------------------------------------------------------------------

/**
 * A complete, valid `platform.organizations.create` body.
 *
 * ===========================================================================================
 * `derived_value` IS PRODUCED BY THE SHIPPED ADMIN CONSOLE'S KDF, NOT BY 43 TYPED CHARACTERS.
 * ===========================================================================================
 *
 * A hand-written base64url string would satisfy `DERIVED_VALUE_PATTERN` and `fromBase64Url`, and
 * every onboarding case would pass — while proving nothing about the property that actually
 * matters, which is that **the value the console sends is a value the login path later accepts**.
 * `0026` closed `ON-5` as option B: the console generates the password and derives from it, and
 * the server never sees a password. If Core's second derivation, its storage, or the login path's
 * first derivation disagreed with the console by one byte, the account would be created and
 * unreachable — and a fixture with a typed-out constant could not tell.
 *
 * So this calls `platform/admin/src/api/kdf.ts::deriveLoginCredential`, which is the same function
 * the console calls. The same argument `confirmation-fixture.ts` makes for deriving through
 * `platform/web`.
 *
 * WHAT IS NOT THE CONSOLE'S, both stated at `syntheticAdminPassword` above: the Web Worker
 * plumbing in `kdf-client.ts`, and the password GENERATOR, which Node cannot import. The
 * derivation is the console's; the two things around it are not, and neither is claimed.
 *
 * **THE PASSWORD IS SYNTHETIC, GENERATED PER CALL, AND IS NEVER PRINTED OR ASSERTED ON.** It is
 * returned so a case can prove the round trip and for nothing else.
 */
export async function onboardingRequest(
  overrides: {
    readonly adminIdentifier?: string;
    readonly templateId?: string;
    readonly firstWorkspaceName?: string;
    readonly derivedValue?: string;
  } = {},
): Promise<{
  readonly bodyText: string;
  readonly identifier: string;
  readonly password: string;
  readonly derivedValue: string;
}> {
  const rawIdentifier = overrides.adminIdentifier ?? 'first.admin@example.invalid';
  const password = syntheticAdminPassword();
  const derived = await adminDerive(rawIdentifier, password);
  const derivedValue = overrides.derivedValue ?? derived.derived_key;
  return {
    bodyText: JSON.stringify({
      admin_identifier: rawIdentifier,
      template_id: overrides.templateId ?? TEMPLATE_SEEDED,
      first_workspace_name: overrides.firstWorkspaceName ?? 'North Workspace',
      derived_value: derivedValue,
    }),
    // THE NORMALISED FORM, which is what the admin signs in with and what Core hashed. Asserting
    // the round trip against the raw form would test the normalisation by accident.
    identifier: derived.email,
    password,
    derivedValue,
  };
}

// ===========================================================================================
// THE SYNTHETIC CRITICAL PLATFORM ROUTE — the platform class's half of `0027`'s central control.
// ===========================================================================================
//
// *** WHY A SYNTHETIC ROUTE IS THE POINT AND NOT A CONVENIENCE, exactly as
// `confirmation-fixture.ts` argues for its synthetic Action. ***
//
// The confirmation gate is enforced at TWO independent entry points: `action/pipeline.ts` step 6
// and `dispatchPlatformRoute` step 5b. **NO ROUTE IN THE SHIPPED PLATFORM TABLE IS CRITICAL
// TODAY** — `isConfirmationGated` returns false for all seven, because `0026` deliberately
// reclassified `core.organization.create` to `sensitive` and the credential-reset route is not
// built. So the platform-class gate ships guarding nothing, which is `M-1`'s shape precisely:
// code that is correct, unexercised, and found broken by whoever first needs it.
//
// AND IT HAS A CONSEQUENCE FOR THE NEGATIVE CONTROL, WHICH IS WHY THIS EXISTS. Without a gated
// route here, `withConfirmationCheckRemoved` can only reach the pipeline — one of two enforcement
// points — and `README.md`'s standing requirement says exactly what that is worth:
//
//   *"wherever an invariant is enforced at N points, the suite needs a control that removes all N
//   — not N controls that each remove one."*
//
// THE ROUTE IS BUILT FROM THE SHIPPED PIECES AND NOTHING IS SIMULATED. `platform.credentials.reset`
// is a real entry in `CONFIRMABLE_PLATFORM_OPERATIONS`, it borrows the real critical permission
// `core.credential.reset`, it has a real statement, and it satisfies every clause of
// `assertConfirmationCoverageIsCoherent` — three confirmation fields, no object fields, no query
// parameters, no path parameter. It is dispatched by the SHIPPED `dispatchPlatformRoute`.
//
// **IT IS NOT ADDED TO THE SHIPPED TABLE AND CANNOT BE.** `platformRoutes()` is a frozen Core
// literal; this value is passed to the dispatcher directly, which is the seam the dispatcher
// already has because it takes the route as an argument.
export const SYNTHETIC_CRITICAL_ROUTE_ID = 'platform.credentials.reset';

/** The principal a reset confirmation names. Synthetic; it need not exist for the gate to run. */
export const PRN_RESET_TARGET = 'prn_reset_target0001';

export function createSyntheticCriticalRoute(): PlatformRoute {
  return Object.freeze({
    id: SYNTHETIC_CRITICAL_ROUTE_ID as PlatformRouteId,
    method: 'POST' as const,
    path: '/api/v1/platform/credentials/reset',
    permission: Object.freeze({
      kind: 'fixed' as const,
      permissionId: 'core.credential.reset',
    }),
    // THE THREE CONFIRMATION FIELDS PLUS THE OPERATION'S OWN. `assertConfirmationCoverageIsCoherent`
    // requires the three, because this class refuses undeclared fields BEFORE the gate runs — so a
    // route omitting them would refuse every correctly confirmed request at validation and the
    // gate would never be reached.
    fields: Object.freeze([
      'principal_id',
      'confirmation_id',
      'reauth_derived_value',
      'identifier',
    ]),
    // NONE OF THE THREE, AND EACH ABSENCE IS REQUIRED RATHER THAN TIDY. The binding covers the
    // BODY, so an object field, a query parameter or a path parameter is an input the human never
    // confirmed — a caller could confirm one target and act on another.
    objectFields: Object.freeze([]),
    queryParameters: Object.freeze([]),
    successStatus: 200 as const,
  }) as PlatformRoute;
}

/** A valid `platform.templates.create` body: the flat `name` plus the declared object field. */
export function templateCreateRequest(
  overrides: {
    readonly name?: string;
    readonly levelLabels?: Readonly<Record<string, unknown>>;
  } = {},
): string {
  return JSON.stringify({
    name: overrides.name ?? 'Fixture Template Two',
    level_labels: overrides.levelLabels ?? { workspace: 'Site' },
  });
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
