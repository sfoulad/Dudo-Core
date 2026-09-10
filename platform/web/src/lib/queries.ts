/**
 * The server-state layer — every read and every write, in one place.
 *
 * ===========================================================================
 * WHAT THIS REPLACED, AND THE DUPLICATION IT ACTUALLY REMOVES
 * ===========================================================================
 *
 * Every screen used to own a `useEffect` with `let cancelled = false`, four
 * pieces of `useState`, and a `reloadNonce` for the retry button. That is not
 * merely repetitive — it made one Action genuinely expensive:
 *
 *   `core.ListAuthorizedBusinesses` is called by `probeSession` on first paint
 *   (`api/auth.ts` uses it AS the session probe, because a dedicated "am I
 *   logged in" route would be a sixth pre-authentication entry point and
 *   `0014` §B permits exactly five). `useAuthorizedBusinesses` then called it
 *   again on the directory, and AGAIN on the create form, and again on every
 *   return to either. Four mounts, four identical requests, none of which knew
 *   about the others.
 *
 * One cache entry with a five-minute staleness now serves all of them. That is
 * the concrete thing ADR 0036 bought, and it is measured in requests against
 * `0014` §A's ceilings rather than in tidiness.
 *
 * ===========================================================================
 * EVERY ERROR REACHING A SCREEN IS AN `ApiError`
 * ===========================================================================
 *
 * Each `queryFn` and `mutationFn` funnels through `toApiError`, so a screen
 * still receives exactly what it received before — an envelope with a `code`,
 * a `message`, `details` and a `request_id` — and `ErrorBlock` and the form's
 * error summary are unchanged. A raw `TypeError` from `fetch` never reaches a
 * component.
 *
 * NOTHING HERE RETRIES. See `lib/query-client.ts`: retrying is a button a person
 * presses, because `isRetryable` excludes `unauthenticated` and because a
 * refusal answered by three more requests is how a rate limit becomes an outage.
 *
 * ===========================================================================
 * THE TYPES HERE ARE HAND-WRITTEN AND ARE OWED TO ADR 0037's GENERATOR
 * ===========================================================================
 *
 * `CustomerListInput` below is the client's own request shape and is fine. But
 * everything it is made of — `StatusFilter`, `CustomerSummary`, `Customer`,
 * `PAGE_SIZE_DEFAULT` — comes from `src/contracts/**`, which is a HAND
 * TRANSCRIPTION of contract YAML that nothing checks. `0037` replaces that
 * directory with generated output, and `0034` is the worked example of what
 * hand transcription costs: the deployed console sends `identifier` where the
 * contract publishes `target_identifier`, and it works because the client read
 * the code rather than the contract.
 *
 * This file adds NO new transcription. It imports what was already there.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { customerClient } from '@/lib/clients';
import { toApiError, type ApiError } from '@/api/errors';
import { AUTHORIZED_BUSINESSES_STALE_TIME_MS } from '@/lib/query-client';
import type { BusinessReference, BusinessSummary } from '@/contracts/business-read';
import {
  PAGE_SIZE_DEFAULT,
  type CollectionEnvelope,
  type CreateCustomerInput,
  type Customer,
  type CustomerSummary,
  type StatusFilter,
  type UpdateCustomerChanges,
} from '@/contracts/customer-directory';

/**
 * Anything thrown out of a client method becomes an `ApiError` before it can
 * reach a screen. One wrapper, used by every entry below, so no call site has to
 * remember.
 */
async function asApiError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (thrown) {
    throw toApiError(thrown);
  }
}

/* -------------------------------------------------------------------------
   Keys

   Hierarchical on purpose: invalidating `['customers']` reaches every list,
   every search and every record, which is what a write needs to do and what a
   flat key space cannot express.
   ------------------------------------------------------------------------- */

export interface CustomerListInput {
  status: StatusFilter;
  businessId: string | undefined;
  cursor: string | undefined;
  /** Present means SearchCustomers, absent means ListCustomers. */
  query: string | undefined;
}

export const queryKeys = {
  customers: ['customers'] as const,
  customerList: (input: CustomerListInput) => ['customers', 'list', input] as const,
  customer: (customerId: string) => ['customers', 'detail', customerId] as const,
  authorizedBusinesses: ['businesses', 'authorized'] as const,
  businessReference: (businessId: string) => ['businesses', 'reference', businessId] as const,
};

/* -------------------------------------------------------------------------
   Reads
   ------------------------------------------------------------------------- */

/**
 * The signed-in principal's authorized Business set.
 *
 * AN EMPTY SET IS A VALID, SETTLED ANSWER — not a loading state and not a
 * failure. The contract is explicit that it is currently UNIVERSAL, because Core
 * ships a deny-all authorization source, and that both clients must render it as
 * a first-class state. `isEmpty` below is that distinction made explicit so no
 * screen has to derive it from three booleans.
 */
export function useAuthorizedBusinesses(): {
  businesses: BusinessSummary[];
  loading: boolean;
  error: ApiError | null;
  isEmpty: boolean;
} {
  const result = useQuery<BusinessSummary[], ApiError>({
    queryKey: queryKeys.authorizedBusinesses,
    queryFn: () => asApiError(() => customerClient.listAuthorizedBusinesses()),
    staleTime: AUTHORIZED_BUSINESSES_STALE_TIME_MS,
  });

  const businesses = result.data ?? [];
  return {
    businesses,
    loading: result.isPending,
    error: result.error ?? null,
    isEmpty: !result.isPending && result.error === null && businesses.length === 0,
  };
}

export function useCustomerList(
  input: CustomerListInput,
): UseQueryResult<CollectionEnvelope<CustomerSummary>, ApiError> {
  return useQuery<CollectionEnvelope<CustomerSummary>, ApiError>({
    queryKey: queryKeys.customerList(input),
    queryFn: () =>
      asApiError(() => {
        const request = {
          status: input.status,
          business_id: input.businessId || undefined,
          page_size: PAGE_SIZE_DEFAULT,
          cursor: input.cursor || undefined,
        };
        return input.query === undefined
          ? customerClient.listCustomers(request)
          : customerClient.searchCustomers({ ...request, query: input.query });
      }),
    /*
     * A CURSOR PAGE IS NOT REUSABLE AND MUST NOT BE HELD.
     *
     * The contract rejects a cursor whose filters do not match the request, and
     * a page served from a cache is a page that may have changed underneath. So
     * a list is stale the moment it arrives: coming back to the directory
     * re-reads it rather than showing what was true a minute ago. The saving in
     * this file is on the Business set, which genuinely does not change; buying
     * the same saving on a list would be showing someone a stale directory.
     */
    staleTime: 0,
  });
}

/**
 * One customer's record.
 *
 * `customerId` IS OPTIONAL AND AN ABSENT ONE ISSUES NOTHING. The create form and
 * the edit form are one screen, and the create half has no record to load —
 * without `enabled` it would spend a `GetCustomer('')` on every visit to "New
 * customer", which is a request for a record that cannot exist. A disabled query
 * stays `isPending` forever, so a caller distinguishes "loading" from "not
 * asking" by knowing which mode it is in rather than by reading this.
 */
export function useCustomer(
  customerId: string | undefined,
): UseQueryResult<Customer, ApiError> {
  return useQuery<Customer, ApiError>({
    queryKey: queryKeys.customer(customerId ?? ''),
    enabled: Boolean(customerId),
    queryFn: () => asApiError(() => customerClient.getCustomer(customerId as string)),
    staleTime: 0,
  });
}

/**
 * One record's Business name.
 *
 * `ResolveBusinessReferences` rather than the caller's whole authorized set,
 * which is the case that Action exists for. The response carries exactly one
 * entry per requested identifier at the same index, WITH THE IDENTIFIER ECHOED —
 * this checks the echo rather than trusting position, because the contract
 * echoes it precisely so a client need not depend on alignment.
 *
 * A FAILURE IS SWALLOWED INTO `null`, deliberately: a name that will not load
 * must not take down a record the person can otherwise read in full. The
 * fallback is the identifier, which is what the contract says to render anyway.
 */
export function useBusinessReference(
  businessId: string | undefined,
): UseQueryResult<BusinessReference | null, ApiError> {
  return useQuery<BusinessReference | null, ApiError>({
    queryKey: queryKeys.businessReference(businessId ?? ''),
    enabled: Boolean(businessId),
    staleTime: AUTHORIZED_BUSINESSES_STALE_TIME_MS,
    queryFn: async () => {
      if (!businessId) return null;
      try {
        const response = await customerClient.resolveBusinessReferences([businessId]);
        const entry = response.data[0];
        return entry && entry.business_id === businessId ? entry : null;
      } catch {
        return null;
      }
    },
  });
}

/* -------------------------------------------------------------------------
   Writes

   ===========================================================================
   INVALIDATION IS DELIBERATE AND NARROW, AND NOTHING IS WRITTEN INTO THE CACHE
   ON A GUESS
   ===========================================================================

   A mutation that succeeded returns the server's record, and that record is
   seeded into the detail cache — it is the authoritative answer, not a
   prediction. What is NOT done is optimistic updating: writing an expected
   result into the cache before the server has agreed would mean a screen showing
   a state Core may be about to refuse, and `customer-directory-v1` has a real
   state machine (archive only from `active`, edit only from `active`) whose
   refusals are the interesting cases rather than the rare ones.

   Lists are invalidated rather than patched, because a row's membership of a
   filtered, cursor-paginated page is a fact only the server holds.
   ------------------------------------------------------------------------- */

export function useCreateCustomer(): UseMutationResult<Customer, ApiError, CreateCustomerInput> {
  const queryClient = useQueryClient();
  return useMutation<Customer, ApiError, CreateCustomerInput>({
    mutationFn: (input) => asApiError(() => customerClient.createCustomer(input)),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.customer(created.customer_id), created);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}

export function useUpdateCustomer(): UseMutationResult<
  Customer,
  ApiError,
  { customerId: string; changes: UpdateCustomerChanges }
> {
  const queryClient = useQueryClient();
  return useMutation<Customer, ApiError, { customerId: string; changes: UpdateCustomerChanges }>({
    mutationFn: ({ customerId, changes }) =>
      asApiError(() => customerClient.updateCustomer(customerId, changes)),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.customer(updated.customer_id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}

/**
 * Archive and restore — the two state transitions this slice implements.
 *
 * DELETE AND RESTORE-FROM-DELETION ARE ABSENT AND MUST STAY ABSENT. They are
 * contracted and deliberately out of scope (contract §11.1), the platform would
 * refuse them, and `CustomerDirectoryClient` has no method for either — so
 * adding one here would not compile, which is the right kind of obstacle.
 */
export function useCustomerTransition(
  kind: 'archive' | 'restore',
): UseMutationResult<Customer, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<Customer, ApiError, string>({
    mutationFn: (customerId) =>
      asApiError(() =>
        kind === 'archive'
          ? customerClient.archiveCustomer(customerId)
          : customerClient.restoreCustomer(customerId),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.customer(updated.customer_id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers });
    },
  });
}
