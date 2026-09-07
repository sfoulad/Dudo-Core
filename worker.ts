/**
 * The deployment entry module. This is what `wrangler.jsonc`'s `main` names.
 *
 * OWNER: Team Lead (root-level shared configuration and integration).
 *
 * ===========================================================================================
 * WHY THIS FILE EXISTS AT THE ROOT AND NOT INSIDE `platform/core/**`
 * ===========================================================================================
 *
 * `docs/architecture/standards/CORE_BOUNDARIES.md` §6 rule 2: *"No imports from above.
 * `platform/core/**` never imports from `apps/**`, `connectors/**`, `platform/web/**`, or
 * `packages/sdk/**`. Checkable statically, and it should be checked in CI once CI exists."*
 *
 * Mounting an App requires importing `apps/customers/app.ts`. Doing that inside
 * `platform/core/http/adapters/worker-entry.ts` would violate that rule directly — and it is
 * precisely the violation a future CI check exists to catch. It is also why `fetchHandler`
 * takes the router and the permission envelope as PARAMETERS rather than importing them: the
 * seam was built for this file, and for two days nothing stood in it.
 *
 * The direction of dependency is the whole point. A module OUTSIDE Core importing INTO Core is
 * allowed; the prohibition is only upward. So the composition lives here, at the root, where
 * both halves are visible in one place and neither boundary is crossed.
 *
 * `core-agent` reported the conflict rather than mounting it where the Team Lead first asked,
 * and verified this exact composition in a scratchpad before it was written here.
 *
 * ===========================================================================================
 * THE DURABLE OBJECT RE-EXPORT MOVES WITH `main`, AND IT IS NOT OPTIONAL
 * ===========================================================================================
 *
 * A Durable Object class must be exported from whatever module `main` names, or the binding
 * fails at deploy time. It previously sat in `worker-entry.ts` because that was `main`.
 * Moving `main` here without moving this export would produce a deploy-time failure whose
 * message points at the binding rather than at the missing export.
 */
export { DudoCoordinatorObject } from './platform/core/protection/adapters/durable-objects/coordinator-object.ts';

import { createStoreBusinessDirectory } from './platform/core/tenancy/business-directory.ts';
import type { Env } from './platform/core/http/adapters/worker-entry.ts';
import { fetchHandler } from './platform/core/http/adapters/worker-entry.ts';
import { createInProcessPreAuthLimiter } from './platform/core/identity/pre-auth-limiter.ts';
import {
  createCustomersRouter,
  CUSTOMERS_APP_PERMISSIONS,
  CUSTOMERS_BASE_PATH,
} from './apps/customers/app.ts';

/**
 * The App's routes mount under `CUSTOMERS_BASE_PATH` = `/api/v1/apps/customers`, so the
 * Customer collection is at `/api/v1/apps/customers/customers` — NOT `/api/v1/customers`.
 *
 * Stated here because the Team Lead probed the shorter path against the deployed Worker,
 * got 404 for every caller, and drew a conclusion that was correct for a reason the evidence
 * did not establish. An unmounted App and a wrong URL are indistinguishable from outside.
 *
 * The path is inside `run_worker_first: ["/api/*"]`, so no configuration change is needed.
 */
const router = createCustomersRouter({ businesses: createStoreBusinessDirectory() });

/**
 * `CUSTOMERS_APP_PERMISSIONS` is the App's REAL declared envelope — nine permissions, all at
 * `organization` scope, no wildcard, `appId: 'customers'`. It is not trimmed to match what
 * roles currently grant.
 *
 * It declares `delete` and `restore-deleted`, which `0019` grants to NO role. That is
 * `authorizer.ts` working as designed: the App's declaration is the CEILING and the
 * principal's grant is the FLOOR, so both remain unreachable for every principal on the
 * platform. Narrowing the envelope to match today's roles would conflate the two and make a
 * future grant silently insufficient.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return fetchHandler(request, env, router, CUSTOMERS_APP_PERMISSIONS, CUSTOMERS_BASE_PATH, {
      preAuthLimiter: createInProcessPreAuthLimiter(),
    });
  },
};
