/**
 * The Worker entry point and composition root.
 *
 * This is an ADAPTER. With `storage/adapters/d1/d1-store.ts` it is one of only two files in
 * `platform/core/**` or `apps/**` that may name a Cloudflare type, and the two names it
 * uses are `Env` and the D1 binding it holds (CLOUDFLARE_STANDARD.md §2). Everything it
 * builds is expressed in Core types.
 *
 * =====================================================================================
 * THIS WORKER SERVES NOTHING, AND THAT IS THE CORRECT STATE. IT IS NOT A DEFECT.
 * =====================================================================================
 *
 * Two dependencies of the Customer Directory contract do not exist, both named by the
 * contract itself as things it "cannot satisfy itself":
 *
 *   AZ2 — NO AUTHENTICATION MECHANISM IS RECORDED. The contract assumes an authenticated
 *         principal, a server-derived tenant and a server-derived authorized business set,
 *         and states plainly that it cannot produce any of the three. So
 *         `createDenyAllPrincipalResolver` is wired and every request is `unauthenticated`.
 *         Supplying a permissive resolver to make the App demonstrable would be an
 *         authentication bypass wearing the word default, and choosing a scheme would be
 *         selecting an unrecorded security mechanism to unblock an App.
 *
 *   THE TENANT DIRECTORY — `TenantDirectoryEntry` is `status: proposed` in
 *         `core-object-registry.yaml` and Core's control-plane database does not exist, so
 *         the resolver is constructed with an empty mapping and fails closed for every
 *         Organization. `docs/decisions/0006` §0.2 requires exactly that: "Unknown
 *         Organization mappings fail closed. No fallback binding, no default database, no
 *         'probably the shared one'."
 *
 * A THIRD GAP HAS NARROWED BUT HAS NOT CLOSED. `BusinessDirectory` now has a `business`
 * table to read (`platform/core/migrations/0002_business.sql`), so `CreateCustomer`,
 * `MoveCustomerToBusiness` and a business-filtered listing can produce the contract's step-5c
 * answers instead of failing on a missing table. But nothing in this repository WRITES a
 * Business — Business CRUD belongs to the organization-structure slice — so in a deployed
 * runtime the table is empty and every one of those lookups answers `not_found`. Fail-closed,
 * and consistent with the two gaps above: this Worker still serves nothing.
 *
 * FAIL-CLOSED IS THE POINT. A platform with no identity layer that answered requests would
 * be worse than one that answers none. When the identity slice lands, it supplies a
 * `PrincipalResolver` and a directory-backed `TenantStoreResolver`, and nothing else here
 * changes.
 *
 * WHAT IS NOT AUTHORED HERE, DELIBERATELY: the Worker configuration file.
 * CLOUDFLARE_STANDARD.md §9 — "Worker configuration is shared configuration and belongs to
 * the Team Lead. Agents propose changes; they do not edit it." So there is no
 * `wrangler.jsonc` in this change. The bindings this module reads are named for the ports
 * they serve rather than for the vendor product, per the same section:
 *
 *   DB_TENANT              the shared tenant-data database (docs/decisions/0006 §0.3, #2)
 *   CURSOR_SIGNING_KEY     a Worker SECRET, not a variable. Nothing in the repository holds
 *                          its value, and nothing may.
 *
 * `"remote": true` MUST NOT BE SET IN LOCAL OR CI CONFIGURATION (CLOUDFLARE_STANDARD.md
 * §4.1). A remote binding is a deliberate, reviewed act in a deployed environment, and a CI
 * job that touches a remote database burns one of the ten free-tier slots, writes to shared
 * data, and can create a charge.
 *
 * NOTHING HERE DEPLOYS ANYTHING. No cloud resource is created by this file, and deploying
 * requires explicit user approval in the current conversation, every time.
 */

import type { D1Database } from '../../storage/adapters/d1/d1-store.ts';
import { createD1TenantStore } from '../../storage/adapters/d1/d1-store.ts';
import type { TenantStoreMapping } from '../../tenancy/tenant-store-resolver.ts';
import { createStaticTenantStoreResolver } from '../../tenancy/tenant-store-resolver.ts';
import { createStoreBusinessDirectory } from '../../tenancy/business-directory.ts';
import { createAuthorizer } from '../../authorization/authorizer.ts';
import { createSystemClock } from '../../kernel/clock.ts';
import { createRandomIdGenerator } from '../../kernel/ids.ts';
import { createCursorCodec } from '../../pagination/cursor.ts';
import { createDenyAllPrincipalResolver } from '../../identity/principal-resolver.ts';
import type { PrincipalResolver } from '../../identity/principal-resolver.ts';
import type { ApiDependencies } from '../api.ts';
import { handleRequest } from '../api.ts';
import type { Router } from '../router.ts';
import { renderError } from '../response.ts';
import { internal } from '../../kernel/errors.ts';
import type { AppPermissionEnvelope } from '../../authorization/authorizer.ts';
import type { BusinessDirectory } from '../../tenancy/business-directory.ts';

/** The Worker environment. The one place bindings are read. */
export type Env = {
  readonly DB_TENANT: D1Database;
  /** A Worker secret binding. Never a configuration variable, never in a file. */
  readonly CURSOR_SIGNING_KEY?: string;
};

const TENANT_BINDING = 'DB_TENANT';

/**
 * Under docs/decisions/0006 Option A every Organization resolves to the same binding, and
 * the indirection exists anyway so that moving to pooled shards later changes no
 * business-domain code and no public contract.
 *
 * IT IS EMPTY, AND EMPTY MEANS EVERY ORGANIZATION FAILS CLOSED. The mapping's real home is
 * `TenantDirectoryEntry` in Core's control-plane database, which is not built. Populating
 * this list with a wildcard, a default, or "every Organization we see" would be exactly the
 * fallback 0006 §0.2 forbids.
 */
function tenantMappings(): readonly TenantStoreMapping[] {
  return [];
}

export type CoreRuntime = {
  readonly dependencies: ApiDependencies;
  readonly businesses: BusinessDirectory;
};

/**
 * Builds the runtime from an environment and a principal resolver.
 *
 * The resolver is a PARAMETER rather than a constant so that the identity slice can supply
 * a real one without editing this file, and so that a verification harness can supply a
 * fake without a permissive default existing in production code. The production caller
 * below passes the deny-all resolver.
 */
export async function createCoreRuntime(
  env: Env,
  principals: PrincipalResolver,
): Promise<CoreRuntime> {
  const signingKeyText = env.CURSOR_SIGNING_KEY;
  if (signingKeyText === undefined || signingKeyText.length < 32) {
    // Refuse to start rather than fall back to a constant or a generated per-isolate key.
    // A per-isolate key would make every cursor invalid as soon as a request landed on a
    // different isolate, and a constant in source is a signing key in a public repository.
    throw new Error(
      'CURSOR_SIGNING_KEY is not configured. It is a Worker secret of at least 32 bytes and ' +
        'is provisioned by the Team Lead; it is never held in the repository.',
    );
  }

  return {
    dependencies: {
      resolver: createStaticTenantStoreResolver(tenantMappings(), (bindingName, organizationId) =>
        bindingName === TENANT_BINDING
          ? createD1TenantStore(env.DB_TENANT, organizationId)
          : undefined,
      ),
      authorizer: createAuthorizer(),
      clock: createSystemClock(),
      ids: createRandomIdGenerator(),
      cursors: await createCursorCodec(new TextEncoder().encode(signingKeyText)),
      principals,
      // NO `auditFailureReporter`, DELIBERATELY, AND ITS ABSENCE SUPPRESSES NOTHING.
      // `announceAuditFailure` emits to a last-resort channel unconditionally, before any
      // supplied reporter, and that channel is not injectable (audit/audit-failure.ts). So an
      // audit record that cannot be written is announced here today. Wiring a structured
      // reporter is worth doing when there is somewhere approved to send it; choosing a
      // destination now would mean selecting an unrecorded service to carry security
      // evidence, and the notice would still have to reach the floor anyway.
    },
    businesses: createStoreBusinessDirectory(),
  };
}

/**
 * The fetch handler. Transport in, transport out.
 *
 * `router` and `app` are passed in rather than imported, because Core must not depend on an
 * App: `platform/core/**` never imports from `apps/**` (CORE_BOUNDARIES.md §6 rule 2). The
 * deployment entry point that names both is the Team Lead's to compose, alongside the
 * Worker configuration this file deliberately does not author.
 */
export async function fetchHandler(
  request: Request,
  env: Env,
  router: Router,
  app: AppPermissionEnvelope,
  basePath: string,
): Promise<Response> {
  try {
    const runtime = await createCoreRuntime(env, createDenyAllPrincipalResolver());
    return await handleRequest(runtime.dependencies, router, app, basePath, request);
  } catch (cause) {
    // Nothing about the failure reaches the caller. A misconfigured secret, a missing
    // binding and an unexpected defect are one answer, because the difference between them
    // is internal structure.
    return renderError(internal(), 'unavailable_request_id', 'unavailable_correlation_id');
  }
}
