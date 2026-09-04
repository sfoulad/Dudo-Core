/**
 * The Customer Directory client.
 *
 * This is the only thing the screens talk to. It is shaped by the contract, not
 * by the fixture underneath it: one method per in-scope Action, taking the
 * Action's input type and resolving to the Action's output type, rejecting with
 * an ApiError carrying the platform error code.
 *
 * SWAPPING IN THE REAL API IS ONE FILE. The client takes a `Transport` with a
 * single `invoke(action, input)` method. `fixture-transport.ts` implements it
 * from memory today; an `http-transport.ts` will implement it against the
 * routes in ROUTES below. No screen changes, because no screen knows which one
 * it is talking to.
 *
 * WHAT THIS CLIENT DOES NOT DO, AND MAY NOT LATER:
 *   - It decides nothing. Permission, tenant resolution and the
 *     authorized-business set are decided in platform/core/** on every call.
 *     Nothing here is a security control, and hiding a control in the UI is
 *     presentation rather than security (security.md §2).
 *   - It never sends a tenant identifier. No Action in the contract takes one
 *     and none may be added.
 *   - It has no method for DeleteCustomer or RestoreDeletedCustomer. Both are
 *     contracted and deliberately out of scope for this slice (§11.1), and
 *     because `CustomerAction` excludes them, adding a call is a compile error.
 */

import type { Transport } from './fixture-transport';
import type {
  BusinessRef,
  CollectionEnvelope,
  CreateCustomerInput,
  Customer,
  CustomerAction,
  CustomerSummary,
  ListCustomersInput,
  SearchCustomersInput,
  UpdateCustomerChanges,
} from '../contracts/customer-directory';

/**
 * The HTTP binding, transcribed from
 * customer-directory-v1.contract.yaml -> httpBinding.
 *
 * Unused today — nothing is deployed and nothing authenticates. It is recorded
 * here so writing the HTTP transport is transcription rather than archaeology,
 * and so drift between this file and the contract is visible in one place.
 */
export const BASE_PATH = '/api/v1/apps/customers';

export const ROUTES: Record<CustomerAction, { method: string; path: string }> = {
  'customers.CreateCustomer': { method: 'POST', path: '/customers' },
  'customers.ListCustomers': { method: 'GET', path: '/customers' },
  'customers.SearchCustomers': { method: 'GET', path: '/customers/search' },
  'customers.GetCustomer': { method: 'GET', path: '/customers/{customer_id}' },
  'customers.UpdateCustomer': { method: 'PATCH', path: '/customers/{customer_id}' },
  'customers.ArchiveCustomer': { method: 'POST', path: '/customers/{customer_id}/archive' },
  'customers.RestoreCustomer': { method: 'POST', path: '/customers/{customer_id}/restore' },
  'customers.MoveCustomerToBusiness': { method: 'POST', path: '/customers/{customer_id}/move' },
};

/** Strip keys whose value is `undefined`, so "absent" survives to the wire. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface CustomerDirectoryClient {
  listCustomers(input?: ListCustomersInput): Promise<CollectionEnvelope<CustomerSummary>>;
  searchCustomers(input: SearchCustomersInput): Promise<CollectionEnvelope<CustomerSummary>>;
  getCustomer(customerId: string): Promise<Customer>;
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  updateCustomer(customerId: string, changes: UpdateCustomerChanges): Promise<Customer>;
  archiveCustomer(customerId: string): Promise<Customer>;
  restoreCustomer(customerId: string): Promise<Customer>;
  moveCustomerToBusiness(customerId: string, businessId: string): Promise<Customer>;
  listBusinesses(): BusinessRef[];
}

export function createCustomerDirectoryClient(transport: Transport): CustomerDirectoryClient {
  return {
    listCustomers(input = {}) {
      return transport.invoke('customers.ListCustomers', compact({ ...input })) as Promise<
        CollectionEnvelope<CustomerSummary>
      >;
    },

    searchCustomers(input) {
      return transport.invoke('customers.SearchCustomers', compact({ ...input })) as Promise<
        CollectionEnvelope<CustomerSummary>
      >;
    },

    getCustomer(customerId) {
      return transport.invoke('customers.GetCustomer', {
        customer_id: customerId,
      }) as Promise<Customer>;
    },

    createCustomer(input) {
      return transport.invoke('customers.CreateCustomer', compact({ ...input })) as Promise<Customer>;
    },

    /**
     * Partial, and the three-way distinction is normative: a field absent is
     * unchanged, present with a value is set, and present-and-null is cleared.
     * The caller builds that distinction; this method does not guess at it,
     * which is why `compact()` removes only `undefined`.
     */
    updateCustomer(customerId, changes) {
      return transport.invoke(
        'customers.UpdateCustomer',
        compact({ customer_id: customerId, ...changes }),
      ) as Promise<Customer>;
    },

    archiveCustomer(customerId) {
      return transport.invoke('customers.ArchiveCustomer', {
        customer_id: customerId,
      }) as Promise<Customer>;
    },

    restoreCustomer(customerId) {
      return transport.invoke('customers.RestoreCustomer', {
        customer_id: customerId,
      }) as Promise<Customer>;
    },

    /**
     * In scope in the contract (§11.1) and present so the client mirrors the
     * built Action set. NO SCREEN SURFACES IT IN THIS SLICE: moving a customer
     * between Businesses takes an organization-scope permission and a Business
     * picker, and the Business list has no contract yet.
     */
    moveCustomerToBusiness(customerId, businessId) {
      return transport.invoke('customers.MoveCustomerToBusiness', {
        customer_id: customerId,
        business_id: businessId,
      }) as Promise<Customer>;
    },

    /**
     * FIXTURE ONLY. The Businesses a principal may file a customer under are
     * not published by any contract in packages/contracts/**. This method
     * exists so the gap is visible in code rather than papered over.
     */
    listBusinesses() {
      return transport.listBusinesses ? transport.listBusinesses() : [];
    },
  };
}
