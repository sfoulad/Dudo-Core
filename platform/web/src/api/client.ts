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

import type { DudoAction, Transport } from './transport';
import { ApiError } from './errors';
import {
  PAGE_SIZE_MAX,
  type ArchiveCustomerInput,
  type ArchiveCustomerOutput,
  type CreateCustomerInput,
  type CreateCustomerOutput,
  type CustomerAction,
  type GetCustomerInput,
  type GetCustomerOutput,
  type ListCustomersInput,
  type ListCustomersOutput,
  type MoveCustomerToBusinessInput,
  type MoveCustomerToBusinessOutput,
  type RestoreCustomerInput,
  type RestoreCustomerOutput,
  type SearchCustomersInput,
  type SearchCustomersOutput,
  type UpdateCustomerChanges,
  type UpdateCustomerInput,
  type UpdateCustomerOutput,
} from '../contracts/customer-directory';
import {
  RESOLVE_BATCH_MAX,
  type BusinessSummary,
  type ListAuthorizedBusinessesInput,
  type ListAuthorizedBusinessesOutput,
  type ResolveBusinessReferencesInput,
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
function compact(input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/* ===========================================================================
   THE OPERATION MAP — AN ACTION NAME AND ITS TWO CONTRACT SHAPES, IN ONE PLACE
   ===========================================================================

   Every method below used to end `as Promise<Customer>`, with the Output type
   chosen at the call site. **Eight independent assertions about the wire, each
   correct by the author's care rather than by anything holding them to the
   Action they were invoking.** Nothing refused
   `invoke('customers.GetCustomer', …) as Promise<CustomerSummary>`, and nothing
   refused a body with a misspelled field, because `Transport.invoke` takes
   `Record<string, unknown>` and returns `unknown` — which is the correct shape
   for a transport and the reason the checking has to live here.

   ⚠ THE CAST DOES NOT DISAPPEAR AND MUST NOT BE DESCRIBED AS IF IT HAD. There
   is exactly one, in `call` below, and it is unavoidable: a generated type says
   what the contract PROMISES and never checks what ARRIVED — the generated
   file's own words. What changes is that the promise is now **derived from the
   Action name** instead of restated beside it. `architecture.md` §3a: eight
   remembered assertions are a discipline; one derived from a required argument
   is a mechanism, and picking the wrong Output no longer compiles.

   ⚠ IT IS KEYED ON `DudoAction`, WHICH IS BOTH CONTRACTS, AND THE SCOPE IS THE
   DECISION RATHER THAN THE CONVENIENCE. `Transport.invoke` accepts a
   `DudoAction`, so **the honest key set for a map that says "these Actions have
   checked shapes" is exactly what the transport accepts.** Covering only the
   Customer Directory's eight would have left the two `core.*` calls on
   hand-picked casts — one client with two vocabularies again, along a different
   seam, and the smaller half is the one a later reader copies.

   IT DECIDES NOTHING. This is a lookup from a string literal to two types. No
   permission, no tenant, no filtering — those are Core's on every call
   (`security.md` §2). */
type Operations = {
  'customers.CreateCustomer': { input: CreateCustomerInput; output: CreateCustomerOutput };
  'customers.GetCustomer': { input: GetCustomerInput; output: GetCustomerOutput };
  'customers.ListCustomers': { input: ListCustomersInput; output: ListCustomersOutput };
  'customers.SearchCustomers': { input: SearchCustomersInput; output: SearchCustomersOutput };
  'customers.UpdateCustomer': { input: UpdateCustomerInput; output: UpdateCustomerOutput };
  'customers.ArchiveCustomer': { input: ArchiveCustomerInput; output: ArchiveCustomerOutput };
  'customers.RestoreCustomer': { input: RestoreCustomerInput; output: RestoreCustomerOutput };
  'customers.MoveCustomerToBusiness': {
    input: MoveCustomerToBusinessInput;
    output: MoveCustomerToBusinessOutput;
  };
  'core.ListAuthorizedBusinesses': {
    input: ListAuthorizedBusinessesInput;
    output: ListAuthorizedBusinessesOutput;
  };
  'core.ResolveBusinessReferences': {
    input: ResolveBusinessReferencesInput;
    output: ResolveBusinessReferencesOutput;
  };
};

/* BOUND TO `DudoAction` IN BOTH DIRECTIONS, and the two catch different defects
 * — the same pair `contracts/customer-directory.ts` uses on its runtime
 * constants, for the same reason.
 *
 *   an operation with no Action  ->  a map entry naming a route no contract
 *                                    declares, or one this client is not
 *                                    permitted to invoke (contract §11.1)
 *   an Action with no operation  ->  an Action reachable through `invoke` with
 *                                    NO contract shapes checking it, which is
 *                                    the state this whole block removes
 *
 * ⚠ THE SECOND IS THE ONE THAT MATTERS AND IT IS THE ONE NOBODY WRITES. Adding
 * an Action to either contract's union and forgetting the map here would leave
 * exactly one operation back on an unchecked body and a hand-picked Output — a
 * single exception in a file that otherwise reads as covered.
 *
 * ⚠ AND `Record<DudoAction, …>` WOULD ONLY BE THE SECOND DIRECTION. It proves
 * every Action has an entry; it cannot say the entries are the right ones,
 * because the key set is then the thing being asserted about rather than the
 * thing asserted against. **A guard keyed on the population it is checking
 * inherits that population's mistakes** — `Record<K, V>` proves you covered
 * `K`, never that `K` is the right set. */
type OperationWithoutAction = Exclude<keyof Operations, DudoAction>;
const EVERY_OPERATION_IS_AN_ACTION: OperationWithoutAction extends never ? true : never = true;
void EVERY_OPERATION_IS_AN_ACTION;

type ActionWithoutOperation = Exclude<DudoAction, keyof Operations>;
const EVERY_ACTION_HAS_AN_OPERATION: ActionWithoutOperation extends never ? true : never = true;
void EVERY_ACTION_HAS_AN_OPERATION;

/**
 * Invoke one Action with the input its contract declares, resolving to the
 * output its contract declares.
 *
 * `compact` still runs on every body: "absent" and "present and null" are
 * different instructions in a partial update, and only `undefined` may be
 * dropped.
 */
function call<A extends keyof Operations>(
  transport: Transport,
  action: A,
  input: Operations[A]['input'],
): Promise<Operations[A]['output']> {
  return transport.invoke(action, compact(input)) as Promise<Operations[A]['output']>;
}

export interface CustomerDirectoryClient {
  listCustomers(input?: ListCustomersInput): Promise<ListCustomersOutput>;
  searchCustomers(input: SearchCustomersInput): Promise<SearchCustomersOutput>;
  getCustomer(customerId: string): Promise<GetCustomerOutput>;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerOutput>;
  updateCustomer(customerId: string, changes: UpdateCustomerChanges): Promise<UpdateCustomerOutput>;
  archiveCustomer(customerId: string): Promise<ArchiveCustomerOutput>;
  restoreCustomer(customerId: string): Promise<RestoreCustomerOutput>;
  moveCustomerToBusiness(
    customerId: string,
    businessId: string,
  ): Promise<MoveCustomerToBusinessOutput>;
  listAuthorizedBusinesses(): Promise<BusinessSummary[]>;
  resolveBusinessReferences(businessIds: string[]): Promise<ResolveBusinessReferencesOutput>;
}

export function createCustomerDirectoryClient(transport: Transport): CustomerDirectoryClient {
  return {
    listCustomers(input = {}) {
      return call(transport, 'customers.ListCustomers', input);
    },

    searchCustomers(input) {
      return call(transport, 'customers.SearchCustomers', input);
    },

    getCustomer(customerId) {
      return call(transport, 'customers.GetCustomer', { customer_id: customerId });
    },

    createCustomer(input) {
      return call(transport, 'customers.CreateCustomer', input);
    },

    /**
     * Partial, and the three-way distinction is normative: a field absent is
     * unchanged, present with a value is set, and present-and-null is cleared.
     * The caller builds that distinction; this method does not guess at it,
     * which is why `compact()` removes only `undefined`.
     */
    updateCustomer(customerId, changes) {
      return call(transport, 'customers.UpdateCustomer', {
        customer_id: customerId,
        ...changes,
      });
    },

    archiveCustomer(customerId) {
      return call(transport, 'customers.ArchiveCustomer', { customer_id: customerId });
    },

    restoreCustomer(customerId) {
      return call(transport, 'customers.RestoreCustomer', { customer_id: customerId });
    },

    /**
     * In scope in the contract (§11.1) and present so the client mirrors the
     * built Action set. NO SCREEN SURFACES IT IN THIS SLICE: moving a customer
     * between Businesses takes an organization-scope permission and a Business
     * picker, and the Business list has no contract yet.
     */
    moveCustomerToBusiness(customerId, businessId) {
      return call(transport, 'customers.MoveCustomerToBusiness', {
        customer_id: customerId,
        business_id: businessId,
      });
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
        const response = await call(transport, 'core.ListAuthorizedBusinesses', {
          page_size: PAGE_SIZE_MAX,
          cursor,
        });
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
      return call(transport, 'core.ResolveBusinessReferences', {
        business_ids: businessIds,
      });
    },
  };
}
