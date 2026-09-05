/**
 * The Worker entry point and composition root.
 *
 * This is an ADAPTER. With `storage/adapters/d1/d1-store.ts` and the two identity adapters it is
 * one of the few files in `platform/core/**` that may name a Cloudflare type, and the names it
 * uses are `Env` and the bindings it holds (CLOUDFLARE_STANDARD.md §2). Everything it builds is
 * expressed in Core types.
 *
 * =====================================================================================
 * WHAT CHANGED, AND WHAT DID NOT
 * =====================================================================================
 *
 * `docs/decisions/0015` settled the credential format, so AZ2 is no longer open and
 * `createDenyAllPrincipalResolver` is gone: this file now composes a real
 * `PrincipalResolver` from the session credential and the control plane. `docs/decisions/0014`
 * §C's tenant directory is built, so the empty static tenant mapping is gone too — an
 * Organization with a `tenant_directory` row now resolves, and one without it still fails closed.
 *
 * `docs/decisions/0017` then decided the last question, so THE PRE-AUTHENTICATION ENTRY POINTS
 * ARE NOW COMPOSED AND LOGIN IS REACHABLE. What that accepts — per-isolate rate limiting, and the
 * fact that password entropy rather than throttling is what protects these accounts — is argued
 * at `preAuthDependencies` below and must be read before that composition is changed.
 *
 * TWO THINGS ARE STILL NOT COMPOSED, AND NEITHER IS AN OVERSIGHT: there is no
 * `PreAuthEvidenceRecorder` (announced once per isolate, never silent) and no App is mounted
 * (Core cannot import one). Both are below.
 *
 * =====================================================================================
 * ROUTING: `/auth/*` AND `/health` MUST REACH THE WORKER, AND UNDER THE CURRENT
 * `wrangler.jsonc` THEY DO NOT. THIS IS A DEPLOYMENT BLOCKER AND IT IS NOT FIXABLE HERE.
 * =====================================================================================
 *
 * `wrangler.jsonc` declares `assets.run_worker_first: ["/api/*"]` with
 * `not_found_handling: "single-page-application"`. Every path OUTSIDE that pattern is served by
 * the static-asset handler, and an unmatched one is rewritten to `/index.html`. The pre-auth
 * paths are absolute and live under `/auth/` and `/health` (`identity/pre-auth-registry.ts`), so
 * a deployed `POST /auth/login/complete` WOULD BE ANSWERED WITH THE SPA SHELL, 200, and the
 * Worker would never run. Login would appear broken in a way that looks like a client bug.
 *
 * THE FIX IS ONE LINE IN `wrangler.jsonc`, WHICH IS THE TEAM LEAD'S FILE:
 *
 *   "run_worker_first": ["/api/*", "/auth/*", "/health"]
 *
 * IT IS NOT FIXED BY MOVING THE ROUTES INSTEAD. The reserved prefixes are what
 * `assertNoReservedPathCollision` tests against, and moving login under `/api/` would put it in
 * the namespace App routes are mounted in — which is the collision `0014` §B's reservation
 * exists to make impossible.
 *
 * =====================================================================================
 * BINDINGS. Five, and a sixth this file needs and `wrangler.jsonc` does not yet declare.
 * =====================================================================================
 *
 *   DB_TENANT             the shared tenant-data database (docs/decisions/0006 §0.3, #2)
 *   DB_CONTROL            the control-plane / tenant-directory database (§0.3, #1)
 *   COORDINATION          the SQLite-backed Durable Object namespace that counts rate limits and
 *                         denials (0013) and holds the daily D1 write budget (0014 §A).
 *                         KV-BACKED IS PROHIBITED: it requires a paid plan (0008).
 *   CURSOR_SIGNING_KEY    a Worker SECRET. Nothing in the repository holds its value.
 *   SESSION_HMAC_KEY      a Worker SECRET. Keys the session credential's MAC (0015 §A).
 *   IDENTITY_LOOKUP_KEY   a Worker SECRET — NOT YET IN `wrangler.jsonc`, REQUESTED FROM THE TEAM
 *                         LEAD. Keys the HMAC that turns an email address into the primary key of
 *                         `principal_credential`, which is how the control plane finds a
 *                         credential WITHOUT STORING ANY EMAIL ADDRESS
 *                         (`migrations/control-plane/0006_principal_credential.sql`).
 *
 * IT CANNOT BE DERIVED FROM `SESSION_HMAC_KEY` AND MUST NOT SHARE ITS VALUE. The two have
 * opposite rotation properties: rotating the session key signs everyone out, which is recoverable
 * in one login and is the emergency control you want cheap; rotating the lookup key is
 * IRREVERSIBLE, because the stored hashes cannot be recomputed without plaintext addresses the
 * control plane deliberately does not hold. One value for both would mean the emergency control
 * also permanently locks every user out, discovered during the incident. The argument is repeated
 * at `identity/composition.ts`, where the code that would do it lives.
 *
 * `"remote": true` MUST NOT BE SET IN LOCAL OR CI CONFIGURATION (CLOUDFLARE_STANDARD.md §4.1). A
 * remote binding is a deliberate, reviewed act in a deployed environment, and a CI job that
 * touches a remote database burns one of the ten free-tier slots, writes to shared data, and can
 * create a charge.
 *
 * NOTHING HERE DEPLOYS ANYTHING. No cloud resource is created by this file, and deploying
 * requires explicit user approval in the current conversation, every time.
 */

import type { D1Database } from '../../storage/adapters/d1/d1-store.ts';
import { createD1TenantStore } from '../../storage/adapters/d1/d1-store.ts';
import type { DurableObjectNamespace } from '../../protection/adapters/durable-objects/coordinator-object.ts';
import {
  createDurableObjectDayWriteBudget,
  createDurableObjectRequestCoordinator,
} from '../../protection/adapters/durable-objects/coordinator-object.ts';
import { createDirectoryTenantStoreResolver } from '../../tenancy/directory-tenant-store-resolver.ts';
import { createStoreBusinessDirectory } from '../../tenancy/business-directory.ts';
import { createAuthorizer } from '../../authorization/authorizer.ts';
import { createSystemClock } from '../../kernel/clock.ts';
import { createRandomIdGenerator } from '../../kernel/ids.ts';
import { createCursorCodec } from '../../pagination/cursor.ts';
import { createD1ControlPlaneStores } from '../../identity/adapters/d1/d1-control-plane-store.ts';
import { createD1CredentialStore } from '../../identity/adapters/d1/d1-credential-store.ts';
import { createInProcessControlPlaneWriteAdmission } from '../../identity/control-plane-admission.ts';
import { createMembershipPrincipalAuthorizationSource } from '../../identity/principal-authorization-source.ts';
import { createIdentityComposition } from '../../identity/composition.ts';
import { createD1PlatformStore } from '../../platform/adapters/d1/d1-platform-store.ts';
import { createD1TemplateStore } from '../../platform/adapters/d1/d1-template-store.ts';
import { createOnboardingService } from '../../onboarding/onboarding-service.ts';
import { createMemberResolutionService } from '../../directory/member-resolution.ts';
import { createCredentialResetService } from '../../credential/reset-service.ts';
import { createHmacIdentifierHasher } from '../../identity/credential-store.ts';
import { createStoreAuditSink } from '../../audit/store-audit-sink.ts';
import type { TenantScopedStore } from '../../storage/store.ts';
import { createD1ConfirmationStore } from '../../confirmation/adapters/d1/d1-confirmation-store.ts';
import { createConfirmationBinder } from '../../confirmation/binding.ts';
import { createConfirmationService } from '../../confirmation/confirmation-service.ts';
import { createConfirmationGate } from '../../confirmation/confirmation-gate.ts';
import { createPlatformComposition } from '../../platform/composition.ts';
import { createTimerSleeper } from '../../identity/pre-auth-admission.ts';
import type { PreAuthLimiter } from '../../identity/pre-auth-admission.ts';
import { createInProcessPreAuthLimiter } from '../../identity/pre-auth-limiter.ts';
import { err } from '../../kernel/result.ts';
import type { CryptoBytes } from '../../kernel/bytes.ts';
import type { ApiDependencies } from '../api.ts';
import { handleRequest } from '../api.ts';
import type { Router } from '../router.ts';
import { createRouter } from '../router.ts';
import { renderError } from '../response.ts';
import { internal } from '../../kernel/errors.ts';
import type { AppPermissionEnvelope } from '../../authorization/authorizer.ts';
import type { BusinessDirectory } from '../../tenancy/business-directory.ts';

/**
 * The Durable Object class, RE-EXPORTED FROM THE ENTRY MODULE.
 *
 * A Durable Object class must be exported from the module named in `wrangler.jsonc`'s `main`, or
 * the `COORDINATION` binding fails at deploy time with an error that does not obviously point
 * here. It is a re-export rather than a definition because the class belongs to
 * `platform/core/protection/**`, which is a different task's territory: this line makes it
 * reachable and changes nothing about it.
 */
export { DudoCoordinatorObject } from '../../protection/adapters/durable-objects/coordinator-object.ts';

/** The Worker environment. The one place bindings are read. */
export type Env = {
  readonly DB_TENANT: D1Database;
  /**
   * The control-plane database (docs/decisions/0006 §0.3 slot 1, docs/decisions/0014 §C.3).
   *
   * OPTIONAL IN THE TYPE, MANDATORY IN BEHAVIOUR, exactly as `COORDINATION` is: absent, the
   * Worker refuses to start with an explanation rather than failing on a property access.
   */
  readonly DB_CONTROL?: D1Database;
  /** A Worker secret binding. Never a configuration variable, never in a file. */
  readonly CURSOR_SIGNING_KEY?: string;
  /** A Worker secret binding. Keys the session credential MAC (docs/decisions/0015 §A). */
  readonly SESSION_HMAC_KEY?: string;
  /** A Worker secret binding. Keys the credential lookup hash. See the file header. */
  readonly IDENTITY_LOOKUP_KEY?: string;
  readonly COORDINATION?: DurableObjectNamespace;
};

const TENANT_BINDING = 'DB_TENANT';

/** At least 32 bytes, matching every other key floor in the platform. */
const MIN_SECRET_BYTES = 32;

/**
 * ===========================================================================================
 * THE HOSTS ON WHICH THE PLATFORM ROUTE CLASS IS SERVED. `docs/decisions/0022` as amended
 * 2026-09-05, `docs/decisions/0025` decision 3.
 * ===========================================================================================
 *
 * `wrangler.admin.jsonc` routes `admin.dudo.work` to the `dudo-admin` Worker, which shares
 * `worker.ts` as its `main` with `dudo-core`. SAME `main` MEANS THE SAME ROUTE TABLE IS PRESENT IN
 * BOTH, so without this list `/api/v1/platform/**` would also be mounted on `app.dudo.work` and
 * `api.dudo.work`, where every tenant user already holds a session. It would still be refused
 * there — authorization runs on the `platform_operator` row, never on the hostname — but it is an
 * unnecessary surface, and `http/api.ts` answers 404 for it rather than 403.
 *
 * IT IS WRITTEN HERE, IN THE ADAPTER, RATHER THAN IN `platform/core/platform/**`. A hostname is
 * deployment configuration; a domain module that knew one would be a domain module that had to
 * change when the domain did. This file already holds `TENANT_BINDING` for the same reason.
 *
 * LOCAL DEVELOPMENT AND VERIFICATION SUPPLY THEIR OWN. `wrangler dev` serves `localhost`, which is
 * NOT in this list, so every platform route answers 404 under `npm run dev` unless
 * `CoreRuntimeOptions.adminHosts` is passed. THAT IS THE FAIL-CLOSED DIRECTION AND IT IS CHOSEN
 * DELIBERATELY: adding `localhost` here would put a permanently-true host in the production
 * deployment's list, and the value of this control is that the list is short and reviewed.
 */
const DEFAULT_ADMIN_HOSTS: readonly string[] = Object.freeze(['admin.dudo.work']);

export type CoreRuntime = {
  readonly dependencies: ApiDependencies;
  readonly businesses: BusinessDirectory;
};

export type CoreRuntimeOptions = {
  /**
   * Supplying this is what makes the five pre-authentication entry points — including login —
   * REACHABLE. Omitting it leaves them registered and answering `not_found`.
   *
   * THERE IS NO DEFAULT AND THERE MUST NOT BE ONE. See `preAuthDependencies` below.
   */
  readonly preAuthLimiter?: PreAuthLimiter;
  /**
   * The hostnames on which the platform route class is served. Defaults to `DEFAULT_ADMIN_HOSTS`.
   *
   * SUPPLIED BY LOCAL DEVELOPMENT AND BY VERIFICATION, NOT BY PRODUCTION. `wrangler dev` serves
   * `localhost`, which the default deliberately does not include, so the console's API is
   * unreachable under `npm run dev` until this is passed. An empty array makes every platform
   * route answer 404 — which is a legitimate thing to want, and is why an empty array is
   * distinguishable from omitting the option.
   */
  readonly adminHosts?: readonly string[];
};

/**
 * Builds the runtime from an environment.
 *
 * THE PRINCIPAL RESOLVER IS NO LONGER A PARAMETER. It was one so that "the identity slice can
 * supply a real one without editing this file"; the identity slice has landed, and the resolver is
 * now built here from the same bindings everything else is built from. A verification harness
 * composes `identity/composition.ts` directly with fake stores, which is a better seam than an
 * injectable resolver because it exercises the real credential path rather than bypassing it.
 */
export async function createCoreRuntime(
  env: Env,
  options: CoreRuntimeOptions = {},
): Promise<CoreRuntime> {
  const cursorKey = requireSecret(env.CURSOR_SIGNING_KEY, 'CURSOR_SIGNING_KEY');
  const sessionKey = requireSecret(env.SESSION_HMAC_KEY, 'SESSION_HMAC_KEY');
  const lookupKey = requireSecret(env.IDENTITY_LOOKUP_KEY, 'IDENTITY_LOOKUP_KEY');

  // ===========================================================================================
  // NO COORDINATOR, NO WORKER. docs/decisions/0013, and the refusal is the control.
  // ===========================================================================================
  //
  // Without this binding there is no rate limit and denials are not bounded, which is the state
  // that made the probe-detection control a platform-wide denial-of-service lever: one
  // authenticated caller, 100,000 malformed requests, and D1 stops answering for EVERY
  // Organization. Starting anyway "for now" would be shipping that state on purpose.
  //
  // AND IT MUST NOT FALL BACK TO THE IN-PROCESS COORDINATOR. That one counts per isolate, and a
  // rate limit divided by a number nobody controls is not a rate limit — it is a limit that looks
  // present in review and is absent in production, which is worse than none.
  //
  // 0014 §A MAKES THE REFUSAL DO MORE WORK. Without this binding there is also no DAILY WRITE
  // BUDGET, so nothing bounds what a single authorized tenant's bulk import spends of an
  // account-wide, enforced 100,000 rows/day — and that case needs no attacker at all.
  const coordinationNamespace = env.COORDINATION;
  if (coordinationNamespace === undefined) {
    throw new Error(
      'COORDINATION is not bound. It is the SQLite-backed Durable Object namespace that ' +
        'enforces rate limits and bounds denial auditing (docs/decisions/0013), and that holds ' +
        'the daily D1 write budget every mutation must reserve from (docs/decisions/0014 §A). ' +
        'Without it a single authenticated caller — or one authorized tenant migrating records ' +
        'at a permitted rate — can exhaust the account-wide D1 daily write allowance and stop ' +
        'D1 answering for every Organization, so the Worker refuses to start rather than serve ' +
        'requests with the control absent.',
    );
  }

  // ===========================================================================================
  // NO CONTROL PLANE, NO WORKER. Same shape of refusal, and it is new with docs/decisions/0014 §C.
  // ===========================================================================================
  //
  // Every authenticated request resolves session -> principal -> membership -> Organization
  // through this database (§C.5), and every tenant store handle is obtained from the
  // `tenant_directory` table inside it. A Worker without it could authenticate nobody and could
  // resolve no tenant, so it would answer `unauthenticated` or `unavailable` to everything. That
  // is not a degraded mode worth serving; it is the same fail-closed state, reached more
  // confusingly.
  const controlDatabase = env.DB_CONTROL;
  if (controlDatabase === undefined) {
    throw new Error(
      'DB_CONTROL is not bound. It is the control-plane database (docs/decisions/0006 §0.3 ' +
        'slot 1, docs/decisions/0014 §C.3) holding Principal, Organization, membership, Session, ' +
        'the credential table and the tenant directory. Every authenticated request resolves ' +
        'through it and every tenant store handle comes from it, so without it nothing ' +
        'authenticates and no tenant resolves.',
    );
  }

  const clock = createSystemClock();
  const controlPlane = createD1ControlPlaneStores(controlDatabase);

  // ===========================================================================================
  // THE CONTROL-PLANE WRITE ADMISSION, AND A DEGRADATION THAT IS STATED RATHER THAN HIDDEN.
  // ===========================================================================================
  //
  // `createInProcessControlPlaneWriteAdmission` holds TWO ceilings and they degrade differently
  // in a deployed Worker, which its own header says plainly:
  //
  //   THE PLATFORM CEILING IS DURABLE AND HOLDS. 3,000 row-writes/day goes through
  //   `DayWriteBudget`, which is the Durable Object ledger — one account-wide counter, one point
  //   of truth. This is the ceiling that protects D1's enforced 100,000/day for every
  //   Organization, and it is intact.
  //
  //   THE PER-PRINCIPAL CEILING IS PER ISOLATE AND THEREFORE DOES NOT BOUND. 600 row-writes/day
  //   per principal becomes 600 per principal per isolate. The consequence, counted rather than
  //   hand-waved: one holder of one valid credential can spend the whole platform login budget —
  //   1,000 logins — and thereafter nobody can log in until 00:00 UTC. Existing sessions keep
  //   working, because resolution performs no writes (`session-resolution.ts`, ruling 3).
  //
  // IT IS COMPOSED ANYWAY, AND THE ASYMMETRY IS THE REASON. Refusing to start would mean nothing
  // authenticates at all; composing it means the account-wide failure mode is closed and a
  // credential-holding attacker can cause a bounded, self-healing, one-day login outage. The
  // durable version is the same port backed by a per-principal counter in the coordination
  // Durable Object, which is a change to `platform/core/protection/**`.
  //
  // ===========================================================================================
  // *** CORRECTION, 2026-09-05: THIS COMMENT USED TO SAY `protection/**` WAS "ANOTHER AGENT'S
  // FILE". IT IS NOT, AND THE CLAIM STOPPED CORRECT WORK. ***
  // ===========================================================================================
  //
  // **`platform/core/protection/**` IS CORE-OWNED.** The boundary is `.claude/rules/architecture.md`
  // §2, which assigns `platform/core/**` to `core-agent`; nothing carves `protection/**` out of it,
  // no rule in `.claude/rules/` assigns it elsewhere, and no agent definition claims it. **Verified
  // by the Team Lead against those files rather than from memory.**
  //
  // WHAT IT COST: the per-Organization write sub-ceiling — the only fix keyed to the VICTIM rather
  // than to the attacker — needed exactly these four files, and this sentence deferred it while a
  // measured denial of service stayed open. **A comment claiming a boundary is a claim about the
  // RULES**, and this one was wrong.
  //
  // THE REFERENT IS GIVEN ABOVE ON PURPOSE. `architecture.md` §2 is checkable in one glance; *"another
  // agent's file"* was not, which is why nobody checked it for two slices. `architecture.md` §3c: a
  // comment that cites a source is an assertion about that source, and the fix is to name the source
  // rather than to be more confident.
  //
  // THE RIGHT RESPONSE TO A COMMENT LIKE THIS IS STILL TO ASK, NOT TO CROSS IT. Refusing to edit
  // until someone with the rules in view confirmed was correct even though the comment was wrong.
  const admission = createInProcessControlPlaneWriteAdmission(
    createDurableObjectDayWriteBudget(coordinationNamespace),
  );

  const identity = await createIdentityComposition({
    store: controlPlane.identity,
    credentials: createD1CredentialStore(controlDatabase),
    admission,
    // THE AUTHORIZATION SOURCE IS NOW MEMBERSHIP-BACKED. docs/decisions/0019 closed AZ5: the
    // grant is a `role` on the membership row and Core owns the mapping to an explicit permission
    // set (`authorization/roles.ts`). A principal with no role, or with a role this build does
    // not recognise, still gets nothing — deny by default survives the change.
    //
    // HALF OF THE GAP REMAINS OPEN AND THE COMPOSITION ROOT SHOULD NOT IMPLY OTHERWISE.
    // `authorizedBusinessIds` is still empty, because computing it needs the tenant store and
    // that is downstream of this step in 0014 §C.5's order. So a principal now holds real
    // permissions and is still refused by every Action that narrows by Business. The argument and
    // the two ways to close it are on `createMembershipPrincipalAuthorizationSource`; neither is
    // an agent's to choose.
    authorization: createMembershipPrincipalAuthorizationSource(),
    ids: createRandomIdGenerator(),
    clock,
    limiter: options.preAuthLimiter ?? UNREACHABLE_LIMITER,
    sleeper: createTimerSleeper(),
    sessionSigningKey: sessionKey,
    identifierLookupKey: lookupKey,
    // NO `evidence` RECORDER. `PreAuthEvidenceRecorder` needs durable, bounded storage for the
    // `(entryPointId, category)` grouping and there is no adapter for it — the control plane has
    // no equivalent of `denial_summary`. Its absence is announced once per isolate as
    // `evidence_recorder_absent` and is never silent. Reported alongside the limiter.
  });

  // ===========================================================================================
  // THE PLATFORM ROUTE CLASS. `docs/decisions/0025`.
  // ===========================================================================================
  //
  // IT IS COMPOSED UNCONDITIONALLY, like the session routes and unlike `preAuth`. Its callers are
  // AUTHENTICATED and its routes evaluate a permission, so `0014` §B's "a permissionless route
  // only with a rate limiter" does not reach them and there is nothing to gate on.
  //
  // WHAT BOUNDS THEM TODAY IS THE PER-PRINCIPAL DAILY WRITE CEILING AND NOT A RATE LIMITER, and
  // the contract is explicit that this must not be reported as rate limiting being done. Binding
  // property P4 makes every platform request write an audit record, that record reserves from
  // `admission`, and `PER_PRINCIPAL_DAILY_ROW_WRITES` is 600 — so 300 platform actions per
  // operator per UTC day, after which every route answers `unavailable`. At one or two operators
  // that holds. `0017`'s in-process limiter is per-isolate and would not bound this either; the
  // durable limiter is still owed (contract PO-4).
  //
  // IT RECEIVES THE **CONTROL-PLANE** BINDING AND NOTHING ELSE. `createD1PlatformStore` takes one
  // database and there is no argument through which `DB_TENANT` could reach it.
  // ===========================================================================================
  // THE CONFIRMATION MECHANISM. `docs/decisions/0027`, `0007` D15.
  // ===========================================================================================
  //
  // IT IS COMPOSED FROM PIECES THAT ALREADY EXIST: the same control-plane binding, the same
  // admission port, the same `CredentialVerifier` login uses — *"NOTHING NEW IS NEEDED IN THE
  // CREDENTIAL LAYER AT ALL"* — and the same cursor secret, under a distinct domain label.
  //
  // COMPOSING IT IS WHAT MAKES EVERY `critical` OPERATION REACHABLE. Without it the pipeline gate
  // refuses them all with `unavailable`, which is the correct direction and is not a degraded mode
  // worth serving: a Worker that cannot verify a confirmation must not perform an irreversible
  // action, and `0013` D2's "must not fail open" applies to the elevation gate more than to
  // anything else.
  const confirmations = createConfirmationService({
    store: createD1ConfirmationStore(controlDatabase),
    binder: await createConfirmationBinder(cursorKey),
    admission,
    ids: createRandomIdGenerator(),
    clock,
  });
  const confirmationGate = createConfirmationGate({
    service: confirmations,
    // THE SAME VERIFIER LOGIN USES, and its EQUAL-WORK PROPERTY IS WHY. A second verifier here
    // would be a second implementation of the hardest code in the platform, measured once and
    // trusted twice.
    verifier: identity.verifier,
  });

  const platformStore = createD1PlatformStore(controlDatabase);
  const templateStore = createD1TemplateStore(controlDatabase);

  // ===========================================================================================
  // ONBOARDING. `organization-onboarding-v1`. ASSEMBLED HERE AND NOWHERE ELSE.
  // ===========================================================================================
  //
  // *** THIS IS THE ONLY PLACE A TENANT-STORE RESOLVER AND THE PLATFORM SURFACE MEET, AND IT IS
  // DELIBERATELY THIS FILE. *** `worker-entry.ts` already names Cloudflare types and already holds
  // the resolver; `platform/composition.ts` holds neither and must not start. What crosses into
  // the platform class is `OnboardingService` — one method, returning identifiers.
  //
  // THE RESOLVER PASSED HERE IS THE SAME ONE THE ACTION PIPELINE USES, not a second one with
  // looser rules. It answers `unavailable` for a missing entry, a non-active entry, an unreadable
  // directory and an unknown binding name — four causes, one answer, no fallback binding and no
  // default database.
  //
  // `tenantBindingName` IS `TENANT_BINDING` AND HAS NO DEFAULT ANYWHERE BELOW THIS LINE. It
  // decides which physical database a new customer's data lands in, which is a deployment
  // decision; `0006` §0.2 forbids the shape of a default by name.
  const tenantResolver = createDirectoryTenantStoreResolver(
    controlPlane.tenantDirectory,
    (bindingName, organizationId) =>
      bindingName === TENANT_BINDING
        ? createD1TenantStore(env.DB_TENANT, organizationId)
        : undefined,
  );
  const onboarding = createOnboardingService({
    controlPlane: controlPlane.identity,
    // READ-ONLY. The collision check. The credential WRITE goes through `controlPlane` above,
    // which cannot write one without also creating an Organization in the same batch.
    credentials: createD1CredentialStore(controlDatabase),
    identifiers: await createHmacIdentifierHasher(lookupKey),
    templates: templateStore,
    operators: platformStore,
    admission,
    resolver: tenantResolver,
    coordinator: createDurableObjectRequestCoordinator(coordinationNamespace),
    auditSinkFor: (store: TenantScopedStore) =>
      createStoreAuditSink(store, createRandomIdGenerator()),
    ids: createRandomIdGenerator(),
    clock,
    tenantBindingName: TENANT_BINDING,
  });

  // THE MEMBER RESOLVE. `organization-detail-v1`, `docs/decisions/0028` Decision 2.
  //
  // ASSEMBLED HERE FOR THE REASON ONBOARDING IS: it needs the tenant resolver, and the platform
  // class's composition root must not. **It receives the SAME resolver instance** — a second one
  // would be a second place "no fallback binding, no default database" is implemented.
  //
  // IT RECEIVES `platformStore`, WHICH IS THE READ, AND THE RESOLVER, WHICH IS THE AUDIT WRITE.
  // Those are the whole of its reach: it cannot enumerate members, because the port it holds has
  // no method that returns identities.
  const members = createMemberResolutionService({
    store: platformStore,
    identifiers: await createHmacIdentifierHasher(lookupKey),
    resolver: tenantResolver,
    coordinator: createDurableObjectRequestCoordinator(coordinationNamespace),
    auditSinkFor: (store: TenantScopedStore) =>
      createStoreAuditSink(store, createRandomIdGenerator()),
    ids: createRandomIdGenerator(),
    clock,
  });

  // THE CREDENTIAL RESET. `credential-reset-v1`. Assembled here for the reason the other two are:
  // it needs the tenant resolver — one audit record per Organization the target belongs to — and
  // the platform class's composition root must not hold one.
  //
  // IT RECEIVES `identity.credentials` READ-ONLY FOR VERIFICATION and writes through
  // `controlPlane.identity`, which is the same split onboarding uses: the port that can find a
  // credential cannot change one, and the port that can change one cannot find one by identifier.
  const credentialReset = createCredentialResetService({
    controlPlane: controlPlane.identity,
    credentials: createD1CredentialStore(controlDatabase),
    identifiers: await createHmacIdentifierHasher(lookupKey),
    operators: platformStore,
    admission,
    resolver: tenantResolver,
    coordinator: createDurableObjectRequestCoordinator(coordinationNamespace),
    auditSinkFor: (store: TenantScopedStore) =>
      createStoreAuditSink(store, createRandomIdGenerator()),
    ids: createRandomIdGenerator(),
    clock,
  });

  const platformRoutes = await createPlatformComposition({
    onboarding,
    members,
    reset: credentialReset,
    confirmations,
    // THE SAME GATE INSTANCE THE ACTION PIPELINE RECEIVES, and passing it here is what makes
    // `confirmation-v1`'s "EVERY entry point" true rather than true of one class. Composed
    // unconditionally, for the reason given at the pipeline's own wiring below: a deployment able
    // to omit it is a deployment where confirmation is optional.
    confirmationGate,
    store: platformStore,
    // A SEPARATE STORE OVER THE SAME BINDING. `template` is tenant-independent configuration and
    // shares nothing with the operator tables but the database it sits in.
    templates: templateStore,
    admission,
    authorizer: createAuthorizer(),
    ids: createRandomIdGenerator(),
    clock,
    // THE SAME CREDENTIAL READER AND THE SAME RESOLUTION FLOOR the other two authenticated paths
    // use. `resolvePrincipalId` is `0014` §C.5 steps 1 and 2 and stops there: it returns a
    // principal identifier and NOT an `AuthenticatedPrincipal`, so no organization identifier
    // crosses into a class whose binding property P1 is that it can reach no tenant.
    readSessionId: identity.sessionRoutes.readSessionId,
    authenticatePrincipal: (sessionId) => identity.sessions.resolvePrincipalId(sessionId),
    cursorSigningKey: cursorKey,
    adminHosts: options.adminHosts ?? DEFAULT_ADMIN_HOSTS,
  });

  return {
    dependencies: {
      // ===================================================================================
      // THE TENANT DIRECTORY, REPLACING THE EMPTY STATIC MAPPING.
      // ===================================================================================
      //
      // The static resolver was constructed with an empty list and its comment said what that
      // meant: "EMPTY MEANS EVERY ORGANIZATION FAILS CLOSED." That was correct while
      // `TenantDirectoryEntry` was `status: proposed` and the control-plane database did not
      // exist. Both are now built, so the mapping comes from the `tenant_directory` table.
      //
      // AN UNKNOWN ORGANIZATION STILL FAILS CLOSED, which is the half that must not change.
      // `createDirectoryTenantStoreResolver` answers `unavailable()` for a missing entry, a
      // non-active entry, an unreadable directory, and a binding name the factory does not know —
      // four causes, one answer, no fallback binding and no default database. docs/decisions/0006
      // §0.2 forbids exactly the alternative: "No fallback binding, no default database, no
      // 'probably the shared one'."
      //
      // THE STATIC PATH IS DELETED RATHER THAN LEFT UNUSED. An empty-list resolver sitting in the
      // file is one edit away from being handed a wildcard by someone making a demo work.
      // THE SAME INSTANCE ONBOARDING RECEIVES, constructed once above. Two resolvers would be two
      // places the "no fallback binding, no default database" rule is implemented, and therefore
      // two places it can differ.
      resolver: tenantResolver,
      authorizer: createAuthorizer(),
      clock,
      ids: createRandomIdGenerator(),
      cursors: await createCursorCodec(cursorKey),
      principals: identity.principals,
      coordinator: createDurableObjectRequestCoordinator(coordinationNamespace),
      preAuth: preAuthDependencies(identity.preAuth, options.preAuthLimiter),
      // THE SESSION ROUTES ARE COMPOSED UNCONDITIONALLY, unlike `preAuth`. They are AUTHENTICATED
      // (docs/decisions/0021), so `0014` §B's "a permissionless route only with a rate limiter"
      // does not reach them and there is nothing to gate on. The picker writes nothing; selection
      // is bounded by the control-plane daily budget and refuses with `quota_exceeded`.
      sessionRoutes: identity.sessionRoutes,
      platformRoutes,
      // THE GATE IS COMPOSED UNCONDITIONALLY. It is not gated on a flag, an environment variable
      // or a binding, because `0027` makes the requirement derive from the permission — and a
      // deployment able to turn confirmation off is a deployment where the top rung of the
      // sensitivity ladder is optional.
      confirmations: confirmationGate,
      // NO `coordinationFailureReporter` and NO `auditFailureReporter`, and their absence
      // suppresses nothing: `announceAuditFailure` emits to a last-resort channel
      // unconditionally, before any supplied reporter, and that channel is not injectable
      // (audit/audit-failure.ts). Choosing a structured destination now would mean selecting an
      // unrecorded service to carry security evidence.
    },
    businesses: createStoreBusinessDirectory(),
  };
}

/**
 * A limiter that refuses everything, used only to construct the composition when no real one was
 * supplied. IT IS NEVER REACHED, because `preAuthDependencies` returns `undefined` in exactly the
 * same case and `http/api.ts` then answers `not_found` before any dispatch happens.
 *
 * IT EXISTS SO THAT THE "NO LIMITER" STATE HAS A FAIL-CLOSED VALUE RATHER THAN AN OPTIONAL FIELD.
 * `IdentityCompositionInput.limiter` is required deliberately — an optional one is how a
 * composition root ends up with no rate limiting and no one noticing — and this is what satisfies
 * the requirement without inventing a permissive default. If a future edit ever does reach it,
 * every pre-authentication request is refused, which is the correct direction to be wrong in.
 */
const UNREACHABLE_LIMITER: PreAuthLimiter = {
  async check() {
    return err(internal());
  },
};

/**
 * ===========================================================================================
 * WHETHER THE FIVE PRE-AUTHENTICATION ENTRY POINTS ARE REACHABLE. DECIDED BY
 * `docs/decisions/0017-pre-auth-rate-limiting-for-closed-beta.md`, Accepted 2026-09-04.
 * ===========================================================================================
 *
 * THE QUESTION. `0014` §B admits a route without a permission only if it carries rate limiting.
 * The only `PreAuthLimiter` in this repository counts in one isolate's memory, and its own file
 * says "the production composition root must not wire this" — a rule this file already applies to
 * the COORDINATOR, where it refuses to start rather than fall back. `0017` overrides it for the
 * pre-authentication path only, for the closed beta only, and states why the two cases differ.
 *
 * WHAT `0017` ACCEPTS, restated here because a decision nobody can find at the call site is a
 * decision that gets reversed by accident:
 *
 *   THE LIMITS BECOME PER-ISOLATE. Both the per-source and the per-identifier-bucket counters
 *   count within one isolate, and a deployed Worker runs in many, created and destroyed at the
 *   edge's discretion. The effective limit is the declared one multiplied by a number nobody
 *   controls.
 *
 *   IT IS NOT THE COORDINATOR CASE, WHICH IS WHY THE SAME RULE GIVES A DIFFERENT ANSWER. The
 *   in-process COORDINATOR was refused because its absence left D1 writes unbounded, and one
 *   caller could exhaust an account-wide 100,000 rows/day and stop D1 answering for every
 *   Organization. Here, A FAILED LOGIN WRITES NOTHING TO D1 AT ALL, and a successful one is still
 *   bounded by the durable daily control-plane ceiling through `DayWriteBudget`. The blast radius
 *   is bounded by mechanisms that do not depend on this limiter.
 *
 *   THE 600,000-ITERATION CLIENT KDF IS NOT AN ATTACKER COST AND MUST NEVER BE CITED AS ONE.
 *   `0017` is explicit, and an earlier draft of this comment got it wrong. An attacker does not
 *   run the client: it computes the derived value directly, once, at roughly 72 ms, and then
 *   posts it as many times as it likes. The client KDF raises the OFFLINE work factor against a
 *   stolen database — that part is real — and buys nothing whatsoever online.
 *
 *   SO WHAT ACTUALLY PROTECTS THESE ACCOUNTS IS PASSWORD ENTROPY, NOT THROTTLING. That is why
 *   `0017` is scoped to staging and to operator-seeded accounts, why `tools/seed-principal.ts`
 *   GENERATES a 192-bit password and refuses to accept one, and why the decision EXPIRES the
 *   moment any password is human-selected. Whoever builds self-service registration inherits that
 *   sentence along with the endpoint.
 *
 * THE DURABLE LIMITER IS STILL OWED, and the reason the obvious version is wrong is recorded in
 * `0017` so nobody rediscovers it: the coordination Durable Object's `/source` counter is generic
 * enough to serve this, but the Durable Object free tier is 100,000 REQUESTS PER DAY, ACCOUNT-WIDE
 * AND SHARED WITH THE AUTHENTICATED COORDINATOR. A naive one-call-per-request adapter would let an
 * unauthenticated flood exhaust that allowance and take the AUTHENTICATED path down with it — the
 * control funding its own denial of service. The workable design is the delta-batching one
 * `protection/coordination-engine.ts` already uses for the source level, and it needs a free-tier
 * impact check under `.claude/rules/architecture.md` §6a BEFORE it is built.
 */
function preAuthDependencies(
  composed: ApiDependencies['preAuth'],
  limiter: PreAuthLimiter | undefined,
): ApiDependencies['preAuth'] {
  return limiter === undefined ? undefined : composed;
}

function requireSecret(value: string | undefined, name: string): CryptoBytes {
  // A per-isolate generated key would make every value it signs invalid as soon as a request
  // landed on a different isolate, and a constant in source is a signing key in a public
  // repository. Refusing to start is the only remaining option.
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is not configured. It is a Worker secret of at least ${String(MIN_SECRET_BYTES)} ` +
        'bytes, provisioned by the Team Lead with `wrangler secret put`; it is never held in the ' +
        'repository and never appears in wrangler.jsonc.',
    );
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new Error(
      `${name} is ${String(bytes.length)} bytes; at least ${String(MIN_SECRET_BYTES)} are ` +
        'required.',
    );
  }
  return bytes;
}

/**
 * The third rate-limit level's input, and the one thing only the transport knows.
 *
 * `CF-Connecting-IP` IS THE EDGE'S HEADER, NOT THE CALLER'S. Cloudflare sets it on every request
 * that reaches a Worker and overwrites anything a client sent under that name, which is what makes
 * it usable at all — a header the caller controls would let an attacker mint a fresh bucket per
 * request and the level would count nothing. THAT TRUST IS A CLOUDFLARE PROPERTY, which is exactly
 * why reading it lives in this adapter and nowhere else: if Dudo ever runs behind something else,
 * this line is the whole of what has to change.
 *
 * IT IS HASHED BEFORE IT CROSSES INTO CORE. The limiter needs equality and nothing more, and an
 * address stored or logged is personal data about a tenant's staff. Truncated to 128 bits, far
 * past the point where collisions matter for a counter.
 *
 * ABSENT MEANS NULL MEANS THE SHARED BUCKET, never "skip this level" — the fail-closed direction,
 * so a missing header throttles harder rather than exempting.
 */
async function readSourceAddressHash(request: Request): Promise<string | null> {
  const address = request.headers.get('cf-connecting-ip');
  if (address === null || address.length === 0) {
    return null;
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
    const bytes = new Uint8Array(digest).subarray(0, 16);
    let hex = '';
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    // A hash that cannot be computed must not silently disable the level.
    return null;
  }
}

/**
 * The fetch handler. Transport in, transport out.
 *
 * `router` and `app` are parameters rather than imports, because Core must not depend on an App:
 * `platform/core/**` never imports from `apps/**` (CORE_BOUNDARIES.md §6 rule 2).
 */
export async function fetchHandler(
  request: Request,
  env: Env,
  router: Router,
  app: AppPermissionEnvelope,
  basePath: string,
  options: CoreRuntimeOptions = {},
): Promise<Response> {
  try {
    const runtime = await createCoreRuntime(env, options);
    return await handleRequest(runtime.dependencies, router, app, basePath, request, {
      sourceAddressHash: await readSourceAddressHash(request),
    });
  } catch (cause) {
    // Nothing about the failure reaches the caller. A misconfigured secret, a missing binding and
    // an unexpected defect are one answer, because the difference between them is internal
    // structure.
    return renderError(internal(), 'unavailable_request_id', 'unavailable_correlation_id');
  }
}

// =============================================================================================
// The deployable entry point
// =============================================================================================

/**
 * The base path App routes are mounted under. It matches `wrangler.jsonc`'s
 * `assets.run_worker_first: ["/api/*"]`, which is the only pattern that currently reaches the
 * Worker at all — see the routing blocker in the file header, which affects `/auth/*` and
 * `/health` and not this.
 */
export const API_BASE_PATH = '/api';

/**
 * ===========================================================================================
 * NO APP IS MOUNTED, AND CORE CANNOT MOUNT ONE.
 * ===========================================================================================
 *
 * `platform/core/**` never imports from `apps/**`, so this module cannot name an App's router or
 * its manifest, and the entry point below therefore serves an EMPTY route table with an envelope
 * that declares no permissions. Every path under `/api` answers `not_found`, and every Action that
 * does not exist is refused by an authorizer with nothing to grant.
 *
 * THAT IS NOT A PLACEHOLDER TO BE FILLED IN HERE. The composition that names both Core and an App
 * is a deployment concern and is the Team Lead's, exactly as `wrangler.jsonc` is; when it exists,
 * it calls `fetchHandler` with a real router and envelope and this default export is replaced by
 * it. Until then the deployable Worker is honest about what it serves: the pre-authentication
 * entry points, and nothing else.
 *
 * THE ENVELOPE'S `appId` IS `platform` RATHER THAN A REAL APP'S, so an audit record produced on
 * this path cannot be mistaken for one attributed to an installed App.
 */
const NO_APP: AppPermissionEnvelope = Object.freeze({
  appId: 'platform',
  declared: Object.freeze([]),
});

const EMPTY_ROUTER: Router = createRouter([]);

/**
 * The shape Cloudflare runs. `wrangler.jsonc`'s `main` points at this module.
 *
 * ===========================================================================================
 * THIS LINE IS WHERE `docs/decisions/0017` TAKES EFFECT, AND IT IS THE WHOLE OF IT.
 * ===========================================================================================
 *
 * `createInProcessPreAuthLimiter()` is what makes the five pre-authentication entry points
 * reachable at all — without it `preAuth` is `undefined` and every one of them answers
 * `not_found`. It is written here, in the open, rather than behind a flag or an environment
 * variable, so that the one call that turns login on is the one call a reviewer reads.
 *
 * READ `preAuthDependencies` ABOVE BEFORE CHANGING IT. In particular: the counters are
 * per-isolate, that is accepted knowingly for the closed beta, and what actually protects these
 * accounts is the entropy of a machine-generated password rather than the rate limit. `0017`
 * expires the moment any password is human-selected.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return fetchHandler(request, env, EMPTY_ROUTER, NO_APP, API_BASE_PATH, {
      preAuthLimiter: createInProcessPreAuthLimiter(),
    });
  },
};
