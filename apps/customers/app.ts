/**
 * The App's assembly point: the nine permissions it declared, and its routes.
 *
 * `CUSTOMERS_APP_PERMISSIONS` is transcribed from
 * `packages/contracts/apps/customers/manifest.json`, which requests all nine at
 * `organization` scope. It is the CEILING the authorizer intersects a principal's grant
 * against, never a floor added to it (platform/core/authorization/authorizer.ts, and the
 * Team Lead's `manifestScopeVersusActionScope` ruling).
 *
 * ALL NINE ARE LISTED, INCLUDING THE TWO WHOSE ACTIONS ARE NOT BUILT. The App declared them
 * and they are registered in `permission-catalog.yaml`; listing them here states what the
 * App is permitted to request, which is a different fact from what it can do. Holding
 * `customers.customer.delete` is not sufficient to invoke `DeleteCustomer` — the
 * confirmation gate is a separate requirement — and in this slice there is no Action to
 * invoke at all, so nothing becomes reachable by being listed.
 *
 * `customers.customer.export` IS ABSENT AND MUST STAY ABSENT. AUTHORIZATION_STANDARD.md
 * §3.2 requires export to be separate from read, and the way to keep it separate is to not
 * declare it until an export Action exists.
 *
 * TRANSCRIPTION IS A DRIFT SURFACE, DECLARED AS ONE. This list and the manifest state the
 * same nine facts in two files, so they can disagree. The manifest is the source; a
 * mismatch is a defect of the same class as a route present in `httpBinding` and absent
 * from `manifest.apis`, and catching it is a qa-agent check rather than a reviewer's good
 * intentions.
 */

import type { AppPermissionEnvelope } from '../../platform/core/authorization/authorizer.ts';
import type { Router } from '../../platform/core/http/router.ts';
import { createRouter } from '../../platform/core/http/router.ts';
import type { AppDependencies } from './api/routes.ts';
import { CUSTOMERS_BASE_PATH, createCustomerRoutes } from './api/routes.ts';

export const CUSTOMERS_APP_ID = 'customers';

export const CUSTOMERS_APP_PERMISSIONS: AppPermissionEnvelope = {
  appId: CUSTOMERS_APP_ID,
  declared: [
    { permissionId: 'customers.customer.create', scope: 'organization' },
    { permissionId: 'customers.customer.read', scope: 'organization' },
    { permissionId: 'customers.customer.list', scope: 'organization' },
    { permissionId: 'customers.customer.update', scope: 'organization' },
    { permissionId: 'customers.customer.archive', scope: 'organization' },
    { permissionId: 'customers.customer.restore', scope: 'organization' },
    { permissionId: 'customers.customer.move', scope: 'organization' },
    { permissionId: 'customers.customer.delete', scope: 'organization' },
    { permissionId: 'customers.customer.restore-deleted', scope: 'organization' },
  ],
};

export { CUSTOMERS_BASE_PATH };

/**
 * Throws if a deferred Action is ever wired to an executable route
 * (platform/core/http/router.ts). Construction is the right moment for that check: a
 * deferral lifted by accident should stop the build, not surface the first time somebody
 * calls a route that destroys tenant data.
 */
export function createCustomersRouter(dependencies: AppDependencies): Router {
  return createRouter(createCustomerRoutes(dependencies));
}
