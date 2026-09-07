/**
 * ===========================================================================================
 * CORE'S OWN ROUTE TABLE AND ITS OWN PERMISSION ENVELOPE. `docs/decisions/0023`.
 * ===========================================================================================
 *
 * `handleRequest` serves ONE router at ONE base path under ONE `AppPermissionEnvelope`.
 * `/api/v1/businesses` does not start with the Customer Directory's `/api/v1/apps/customers`, so
 * it failed the base-path test and answered 404 — which is exactly what `qa-agent` measured on
 * the live deployment.
 *
 * `0023` decided the smaller of the two fixes: **a Core route block ahead of the App router**,
 * the shape the pre-authentication registry and `0021`'s session routes already use, rather than
 * generalising `handleRequest` into a multi-mount dispatcher on speculation.
 *
 * ===========================================================================================
 * CORE DECLARES ITS OWN ENVELOPE, AND `authorize()` NEEDS NO CHANGE TO ACCEPT IT
 * ===========================================================================================
 *
 * `authorizer.ts` looks a permission up in `app.declared` — the App's declaration is the CEILING
 * and the principal's grant is the FLOOR. A Core Action has no App to declare it.
 *
 * THE ALTERNATIVE WAS REJECTED IN `0023` AND IS WORTH KEEPING VISIBLE: making the Customer
 * Directory declare `core.business.read` would mean **an App's manifest gates a Core capability**,
 * and a second App would have to declare it too — so a platform capability would be reachable
 * only through whichever App happened to remember it.
 *
 * SO CORE HAS AN ENVELOPE OF ITS OWN, STRUCTURALLY IDENTICAL TO AN APP'S, PASSED BY THIS BLOCK.
 * The authorizer is untouched, because the envelope was already a parameter — the same property
 * that let `0021`'s session routes exist without changing the pipeline, and that let `worker.ts`
 * mount an App without Core importing one.
 *
 * IT IS NOT A BYPASS AND THE CEILING STILL BINDS. A principal must still hold
 * `core.business.read` at a scope reaching the Action's, evaluated at pipeline step 3 exactly as
 * for an App. What this envelope changes is WHO DECLARES the ceiling, not whether there is one —
 * and it declares exactly one permission, so it cannot serve as a ceiling for anything else.
 *
 * ===========================================================================================
 * TWO OPERATIONS, AND A THIRD GETS ITS OWN ARGUMENT
 * ===========================================================================================
 *
 * `0023` required this the way `0021` required it of the session route class: the table below is
 * a frozen literal of two, and widening it is a decision rather than a refactor. In particular
 * this is NOT a general "Core API" surface — it exists because two contract routes had nowhere to
 * live, and a third Core Action must argue its own case.
 */

import type { AppPermissionEnvelope } from '../authorization/authorizer.ts';
import { asAnyAction } from '../action/action.ts';
import type { Route, Router } from './router.ts';
import { createRouter } from './router.ts';
import {
  BUSINESS_READ_PERMISSION,
  CORE_APP_ID,
  createListAuthorizedBusinessesAction,
  createResolveBusinessReferencesAction,
} from '../organization/business-read.ts';

/**
 * The base path Core's own Actions are mounted under.
 *
 * IT IS A PREFIX OF THE APP'S (`/api/v1/apps/customers`), WHICH IS WHY THE CORE BLOCK MUST FALL
 * THROOUGH RATHER THAN 404 ON A MISS. `handleRequest` tries this router first and, when it does
 * not match, continues to the App router — so an App path is not swallowed by Core's block
 * merely because it shares the prefix. That fall-through is the one subtle part of this change
 * and it is asserted in the verification suite.
 */
export const CORE_BASE_PATH = '/api/v1';

/**
 * Core's permission envelope. ONE PERMISSION, DECLARED ONCE.
 *
 * `core.business.read` is already registered in `packages/contracts/registries/
 * permission-catalog.yaml`, so this contract requested no catalog change and neither does this
 * file. The catalog deliberately has no `core.business.list` — the contract's ruling is that
 * enumeration here is bounded by the authorized set and by a page maximum of 100, which is what
 * keeps a read permission from being an undeclared bulk export.
 */
export const CORE_APP_PERMISSIONS: AppPermissionEnvelope = Object.freeze({
  appId: CORE_APP_ID,
  declared: Object.freeze([
    Object.freeze({ permissionId: BUSINESS_READ_PERMISSION, scope: 'business' as const }),
  ]),
});

/**
 * The two routes, relative to `CORE_BASE_PATH`.
 *
 * `POST /businesses/names` RATHER THAN REPEATED QUERY PARAMETERS — the 2026-09-04 contract
 * revision. It carries an array of up to 25 identifiers, which `mergeInputSources` cannot express
 * as query parameters, and `http/api.ts` refuses a repeated query parameter outright. It remains a
 * READ: `maxRowWrites: 0`, no reservation, no `quota_exceeded`.
 */
function coreRoutes(): readonly Route[] {
  return [
    {
      kind: 'action',
      method: 'GET',
      path: '/businesses',
      action: asAnyAction(createListAuthorizedBusinessesAction()),
      // The contract's `httpStatusOnSuccess`. 200 on both — neither Action creates a resource.
      successStatus: 200,
      // Everything in a query string is a string. Coerced before validation so `?page_size=25`
      // is the integer 25 and `?page_size=abc` fails as `must_be_integer`.
      integerQueryParams: ['page_size'],
    },
    {
      kind: 'action',
      method: 'POST',
      path: '/businesses/names',
      action: asAnyAction(createResolveBusinessReferencesAction()),
      // 200, NOT 201, AND IT IS A POST. Nothing is created; the method carries an array the
      // query string cannot express. See the header of `organization/business-read.ts`.
      successStatus: 200,
    },
  ];
}

/**
 * Built once at module load, like an App's router.
 *
 * `createRouter` runs `assertAuditPolicy`, `assertDeclaredPermission` and
 * `assertNoReservedPathCollision` over the table, so a Core Action with a blank permission, a
 * broken audit policy, or a path colliding with a reserved pre-authentication route stops the
 * module rather than shipping. Core gets the identical construction-time treatment an App gets,
 * which is the point of routing it through the same function.
 */
export function createCoreRouter(): Router {
  return createRouter(coreRoutes());
}
