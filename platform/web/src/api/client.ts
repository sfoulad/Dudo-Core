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
import { ApiError } from './errors';
import {
  PAGE_SIZE_MAX,
  type CollectionEnvelope,
  type CreateCustomerInput,
  type Customer,
  type CustomerAction,
  type CustomerSummary,
  type ListCustomersInput,
  type SearchCustomersInput,
  type UpdateCustomerChanges,
} from '../contracts/customer-directory';
import {
  RESOLVE_BATCH_MAX,
  type BusinessSummary,
  type ResolveBusinessReferencesOutput,
} from '../contracts/business-read';

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
  listAuthorizedBusinesses(): Promise<BusinessSummary[]>;
  resolveBusinessReferences(businessIds: string[]): Promise<ResolveBusinessReferencesOutput>;
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
     * core.ListAuthorizedBusinesses — GET /api/v1/businesses.
     *
     * Pages through the whole authorized set. That is correct here rather than
     * lazy: the caller is a Business picker and a row-label map, both of which
     * need the complete set, and the set is the principal's own authorization
     * — not the Organization's directory. A principal authorized over more than
     * one page of Businesses is rare; a picker missing options is wrong.
     *
     * An EMPTY RESULT IS A VALID ANSWER, not a failure, and every caller must
     * render it as a first-class state.
     */
    async listAuthorizedBusinesses(): Promise<BusinessSummary[]> {
      const all: BusinessSummary[] = [];
      let cursor: string | undefined;

      // Bounded: the page size is capped at 100 by the contract, and the guard
      // stops a malformed cursor chain from looping forever.
      for (let page = 0; page < 20; page += 1) {
        const response = (await transport.invoke(
          'core.ListAuthorizedBusinesses',
          compact({ page_size: PAGE_SIZE_MAX, cursor }),
        )) as CollectionEnvelope<BusinessSummary>;
        all.push(...response.data);
        if (!response.next_cursor) break;
        cursor = response.next_cursor;
      }
      return all;
    },

    /**
     * core.ResolveBusinessReferences — GET /api/v1/businesses/names.
     *
     * Use when a screen needs names for a known, bounded set of identifiers —
     * one record's Business, or the distinct Businesses on one page — rather
     * than the caller's whole authorized set.
     *
     * The response carries one entry per requested identifier AT THE SAME
     * INDEX, with the identifier echoed, whatever its resolution. A caller must
     * not treat a missing name as a missing Business: `resolution` is the only
     * field that says whether the reference resolved, and a resolved reference
     * may still have a null name.
     */
    resolveBusinessReferences(businessIds: string[]): Promise<ResolveBusinessReferencesOutput> {
      if (businessIds.length < 1 || businessIds.length > RESOLVE_BATCH_MAX) {
        // Stated rather than silently sliced: the caller chose the batch, and
        // quietly dropping identifiers would make the positional guarantee a
        // lie one level up.
        return Promise.reject(
          new ApiError({
            code: 'invalid_argument',
            message: `business_ids must name between 1 and ${RESOLVE_BATCH_MAX} Businesses.`,
          }),
        );
      }
      return transport.invoke('core.ResolveBusinessReferences', {
        business_ids: businessIds,
      }) as Promise<ResolveBusinessReferencesOutput>;
    },
  };
}
