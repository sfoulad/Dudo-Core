/**
 * The Customer Directory client.
 *
 * This is the only thing the views talk to. It is shaped by the contract, not
 * by the fixture underneath it: one method per in-scope Action, taking the
 * Action's input shape and resolving to the Action's output shape, rejecting
 * with an ApiError carrying the platform error code.
 *
 * SWAPPING IN THE REAL API IS ONE FILE. The client takes a transport with a
 * single `invoke(action, input)` method. `fixture-transport.js` implements it
 * from memory today; an `http-transport.js` will implement it against the
 * routes in ROUTES below. No view changes, because no view knows which one it
 * is talking to.
 *
 * WHAT THIS CLIENT DOES NOT DO, AND MAY NOT LATER:
 *   - It does not decide anything. Permission, tenant resolution and the
 *     authorized-business set are decided in platform/core/** on every call.
 *     Nothing here is a security control, and the UI hiding a control is
 *     presentation rather than security (security.md §2).
 *   - It never sends a tenant identifier. No Action in the contract takes one
 *     and none may be added: the Organization is derived from the
 *     authenticated server-side context (contract §3).
 *   - It has no method for DeleteCustomer or RestoreDeletedCustomer. Both are
 *     contracted and deliberately out of scope for this slice (§11.1), so
 *     there is no client method, no route call and no screen. Their absence is
 *     the decision, not an omission.
 */

/**
 * The HTTP binding, transcribed from
 * customer-directory-v1.contract.yaml -> httpBinding.
 *
 * Unused today — nothing is deployed and nothing authenticates. It is recorded
 * here so that writing the HTTP transport is transcription rather than
 * archaeology, and so that a drift between this file and the contract is
 * visible in one place.
 */
export const BASE_PATH = '/api/v1/apps/customers';

export const ROUTES = Object.freeze({
  'customers.CreateCustomer':         { method: 'POST',  path: '/customers' },
  'customers.ListCustomers':          { method: 'GET',   path: '/customers' },
  'customers.SearchCustomers':        { method: 'GET',   path: '/customers/search' },
  'customers.GetCustomer':            { method: 'GET',   path: '/customers/{customer_id}' },
  'customers.UpdateCustomer':         { method: 'PATCH', path: '/customers/{customer_id}' },
  'customers.ArchiveCustomer':        { method: 'POST',  path: '/customers/{customer_id}/archive' },
  'customers.RestoreCustomer':        { method: 'POST',  path: '/customers/{customer_id}/restore' },
  'customers.MoveCustomerToBusiness': { method: 'POST',  path: '/customers/{customer_id}/move' },
});

/** Strip keys whose value is `undefined`, so "absent" survives to the wire. */
function compact(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function createCustomerDirectoryClient(transport) {
  return {
    transport,

    /** ListCustomers — GET /customers */
    listCustomers({ business_id, status, page_size, cursor } = {}) {
      return transport.invoke('customers.ListCustomers',
        compact({ business_id, status, page_size, cursor }));
    },

    /** SearchCustomers — GET /customers/search */
    searchCustomers({ query, business_id, status, page_size, cursor }) {
      return transport.invoke('customers.SearchCustomers',
        compact({ query, business_id, status, page_size, cursor }));
    },

    /** GetCustomer — GET /customers/{customer_id} */
    getCustomer(customerId) {
      return transport.invoke('customers.GetCustomer', { customer_id: customerId });
    },

    /** CreateCustomer — POST /customers */
    createCustomer(input) {
      return transport.invoke('customers.CreateCustomer', compact(input));
    },

    /**
     * UpdateCustomer — PATCH /customers/{customer_id}
     *
     * Partial, and the three-way distinction is normative: a field absent is
     * unchanged, a field present with a value is set, and a field present and
     * null is cleared. The caller builds that distinction; this method does
     * not guess at it, which is why `compact()` removes only `undefined`.
     */
    updateCustomer(customerId, changes) {
      return transport.invoke('customers.UpdateCustomer',
        compact({ customer_id: customerId, ...changes }));
    },

    /** ArchiveCustomer — POST /customers/{customer_id}/archive */
    archiveCustomer(customerId) {
      return transport.invoke('customers.ArchiveCustomer', { customer_id: customerId });
    },

    /** RestoreCustomer — POST /customers/{customer_id}/restore */
    restoreCustomer(customerId) {
      return transport.invoke('customers.RestoreCustomer', { customer_id: customerId });
    },

    /**
     * MoveCustomerToBusiness — POST /customers/{customer_id}/move
     *
     * In scope in the contract (§11.1) and present here so the client mirrors
     * the built Action set. NO SCREEN SURFACES IT IN THIS SLICE: moving a
     * customer between Businesses takes an organization-scope permission and a
     * Business picker, and the Business list has no contract yet.
     */
    moveCustomerToBusiness(customerId, businessId) {
      return transport.invoke('customers.MoveCustomerToBusiness', {
        customer_id: customerId,
        business_id: businessId,
      });
    },

    /**
     * FIXTURE ONLY. The Businesses a principal may file a customer under is
     * not published by any contract in packages/contracts/**, and this method
     * exists so the gap is visible in code rather than papered over. It is
     * reported to the Team Lead as a missing contract.
     */
    listBusinesses() {
      return typeof transport.listBusinesses === 'function' ? transport.listBusinesses() : [];
    },
  };
}
