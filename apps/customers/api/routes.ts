/**
 * The HTTP route table, mirroring `customer-directory-v1.contract.yaml` -> `httpBinding`
 * one route for one route.
 *
 * Base path `/api/v1/apps/customers`. `customers` is NOT an allocated segment in
 * `core-object-registry.yaml`'s `reservedApiPathSegments`, so the App namespace is valid by
 * construction and needs no allocation. The alternative — allocating the flat segment to
 * this official App, giving `/api/v1/customers/...` — is CD-7 and is the Team Lead's. The
 * timing is the finding, not the choice: it costs nothing before either client is written
 * and is a breaking change under API_STANDARD.md §6 afterwards.
 *
 * =====================================================================================
 * THE TWO DEFERRED ACTIONS, AND HOW THEIR ABSENCE IS MADE PROVABLE
 * =====================================================================================
 *
 * `customers.DeleteCustomer` and `customers.RestoreDeletedCustomer` are CONTRACTED AND NOT
 * BUILT (contract §11.1, the Team Lead's CD-13 ruling). The contract does not merely permit
 * their absence, it requires the absence to be demonstrable: "Assert it positively: the
 * routes are absent or return not_implemented, and no path reaches a handler. An Action
 * that is contracted but not built must be PROVABLY not built, or its absence is
 * indistinguishable from a handler nobody noticed shipping — and this is the one Action in
 * the App that destroys tenant data."
 *
 * FOUR THINGS MAKE IT PROVABLE HERE, and they are checkable rather than asserted:
 *
 *   1. THE ROUTES EXIST AND ARE `kind: 'deferred'`. They carry an ACTION ID STRING. The
 *      `Route` union has no field on a deferred entry that could hold an Action or a
 *      function, so there is nothing to call. `platform/core/http/api.ts` answers
 *      `not_implemented` from the table before authentication, before authorization,
 *      before a storage handle is obtained.
 *
 *      They are present rather than omitted because the manifest declares all ten routes
 *      and the contract requires `httpBinding` and `manifest.apis` to agree. A route that
 *      answers 501 is a truthful statement that the address is contracted and the operation
 *      is not available; an absent route would answer 404, which says the address does not
 *      exist and contradicts both documents.
 *
 *   2. `CUSTOMER_ACTIONS` HAS EXACTLY EIGHT ENTRIES. There is no ninth or tenth Action
 *      object anywhere in `apps/customers/**` — no handler, no `parseInput`, no permission
 *      evaluation, no state transition to `pending_deletion`. Grep the App for
 *      `DeleteCustomer`: every hit is a string in a comment, a deferral list, or a route
 *      declaration.
 *
 *   3. `createRouter` REFUSES TO BE CONSTRUCTED if an executable Action is ever wired for
 *      an id that is still on `DEFERRED_ACTION_IDS`. Building one later therefore requires
 *      deleting it from that list IN THE SAME CHANGE, where a reviewer sees the deferral
 *      being lifted rather than quietly outgrown.
 *
 *   4. NOTHING CAN PRODUCE THE STATE THEY ACT ON. No code path writes `pending_deletion`
 *      or a non-null `deletion_scheduled_at`, and the table's CHECK constraint ties the two
 *      together. So even a mistakenly-wired `RestoreDeletedCustomer` would have nothing to
 *      act on.
 *
 * WHAT IS NOT DONE, AND MUST NOT BE. No confirmation is invented — not a `confirm` boolean,
 * not a typed-name field, not a client-minted token, not a second call that sets a flag, not
 * an SDK argument. Each would replace a platform control with a request parameter an SDK
 * caller or an AI principal can set for itself, which is precisely the control
 * AUTHORIZATION_STANDARD.md §7 exists to be. Nor is `delete` downgraded from `critical` to
 * `sensitive`: the classification follows from the Action destroying data irreversibly, so
 * changing the label would not change what the Action does — it would only remove the
 * control. `DELETE /customers/{customer_id}` carries no request body and no confirmation
 * parameter, here or in the contract.
 */

import type { Route } from '../../../platform/core/http/router.ts';
import { asAnyAction } from '../../../platform/core/action/action.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { createCreateCustomerAction } from '../actions/create-customer.ts';
import { createGetCustomerAction } from '../actions/get-customer.ts';
import { createListCustomersAction } from '../actions/list-customers.ts';
import { createSearchCustomersAction } from '../actions/search-customers.ts';
import { createUpdateCustomerAction } from '../actions/update-customer.ts';
import { createArchiveCustomerAction } from '../actions/archive-customer.ts';
import { createRestoreCustomerAction } from '../actions/restore-customer.ts';
import { createMoveCustomerToBusinessAction } from '../actions/move-customer-to-business.ts';

export const CUSTOMERS_BASE_PATH = '/api/v1/apps/customers';

/** Query parameters the collection schemas declare as integers. */
const INTEGER_QUERY_PARAMS: readonly string[] = ['page_size'];

export type AppDependencies = {
  readonly businesses: BusinessDirectory;
};

/** EXACTLY EIGHT. Count them; the contract's in-scope list has eight names. */
export function createCustomerActions(dependencies: AppDependencies) {
  return {
    create: createCreateCustomerAction(dependencies),
    get: createGetCustomerAction(),
    list: createListCustomersAction(dependencies),
    search: createSearchCustomersAction(dependencies),
    update: createUpdateCustomerAction(),
    archive: createArchiveCustomerAction(),
    restore: createRestoreCustomerAction(),
    move: createMoveCustomerToBusinessAction(dependencies),
  };
}

export function createCustomerRoutes(dependencies: AppDependencies): readonly Route[] {
  const actions = createCustomerActions(dependencies);

  return [
    {
      kind: 'action',
      method: 'POST',
      path: '/customers',
      action: asAnyAction(actions.create),
      // 201: a resource was created. The contract declares it explicitly.
      successStatus: 201,
    },
    {
      kind: 'action',
      method: 'GET',
      path: '/customers',
      action: asAnyAction(actions.list),
      successStatus: 200,
      integerQueryParams: INTEGER_QUERY_PARAMS,
    },
    {
      kind: 'action',
      method: 'GET',
      // A sub-resource read, not a verb in a path.
      path: '/customers/search',
      action: asAnyAction(actions.search),
      successStatus: 200,
      integerQueryParams: INTEGER_QUERY_PARAMS,
    },
    {
      kind: 'action',
      method: 'GET',
      path: '/customers/{customer_id}',
      action: asAnyAction(actions.get),
      successStatus: 200,
    },
    {
      kind: 'action',
      method: 'PATCH',
      path: '/customers/{customer_id}',
      action: asAnyAction(actions.update),
      successStatus: 200,
    },
    {
      kind: 'action',
      method: 'POST',
      path: '/customers/{customer_id}/archive',
      action: asAnyAction(actions.archive),
      successStatus: 200,
    },
    {
      kind: 'action',
      method: 'POST',
      path: '/customers/{customer_id}/restore',
      action: asAnyAction(actions.restore),
      successStatus: 200,
    },
    {
      kind: 'action',
      method: 'POST',
      path: '/customers/{customer_id}/move',
      action: asAnyAction(actions.move),
      successStatus: 200,
    },

    // ---- CONTRACTED, NOT BUILT. No action object, no handler, no reachable code. ----
    {
      kind: 'deferred',
      method: 'DELETE',
      path: '/customers/{customer_id}',
      actionId: 'customers.DeleteCustomer',
    },
    {
      kind: 'deferred',
      method: 'POST',
      path: '/customers/{customer_id}/cancel-deletion',
      actionId: 'customers.RestoreDeletedCustomer',
    },
  ];
}
