/**
 * The platform console's server-state layer.
 *
 * ===========================================================================
 * ON THIS HOST A REFETCH IS NOT ONLY A REQUEST — IT IS OFTEN AN AUDIT ROW
 * ===========================================================================
 *
 * `platform/web`'s equivalent exists to stop four identical reads on a cold
 * start. **Here the same de-duplication has a second consequence that decides
 * the design:** platform routes are audited, and `0013` bounds denial auditing
 * precisely because a flood of them could exhaust the daily write allowance.
 *
 * So every hook below is written to answer one question: **how many audited
 * calls does this cost, and did an operator ask for each of them?** A cache that
 * quietly refetched would be writing rows describing nothing anyone did.
 *
 * The four request-adding defaults are off in `lib/query-client.ts`, with the
 * reasoning. **Nothing here re-enables them locally.**
 *
 * ===========================================================================
 * ERRORS ARRIVE AS `ApiError`, AND THE PARSERS ARE UNTOUCHED
 * ===========================================================================
 *
 * Each `queryFn` funnels through `toApiError`, so a screen receives exactly what
 * it received before and `ErrorBlock` is unchanged.
 *
 * **AND THE RESPONSE PARSERS IN `api/platform.ts` ARE NOT TOUCHED BY THIS FILE.**
 * `parseTemplate`, `parseListTemplates` and the rest still run inside the client
 * methods. ADR 0037 names the trap plainly: a generated type says what the
 * contract PROMISES, a parser checks what ARRIVED, and removing the second
 * because the first exists **keeps the compile-time claim and drops the runtime
 * check** — in a diff that only deletes.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { platformClient } from '@/lib/clients';
import { toApiError, type ApiError } from '@/api/errors';
import {
  PLATFORM_DEFAULT_PAGE_SIZE,
  PLATFORM_MAX_PAGE_SIZE,
  type ConfirmedSubmission,
  type CreateTemplateInput,
  type ListOperatorsOutput,
  type ListOrganizationsOutput,
  type ListTemplatesOutput,
  type OnboardOrganizationInput,
  type OnboardOrganizationOutput,
  type OrganizationDetail,
  type OrganizationFeedFilters,
  type OrganizationFeedOutput,
  type PlatformFeedFilters,
  type PlatformFeedOutput,
  type RevokeOperatorOutput,
  type Template,
} from '@/api/platform';

/** Anything thrown by a client method becomes an `ApiError` before a screen sees it. */
async function asApiError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (thrown) {
    throw toApiError(thrown);
  }
}

/**
 * Keys are hierarchical so a write can invalidate a whole surface without
 * naming every page of it — and narrow enough that invalidating one surface
 * never refetches another.
 */
export const queryKeys = {
  templates: ['templates'] as const,
  templateList: (cursor: string | null) => ['templates', 'list', cursor] as const,
  templatePicker: ['templates', 'picker'] as const,
  operators: ['operators'] as const,
  operatorList: (cursor: string | null) => ['operators', 'list', cursor] as const,
  organizations: ['organizations'] as const,
  organizationList: (cursor: string | null) => ['organizations', 'list', cursor] as const,
  organizationDetail: (organizationId: string) =>
    ['organizations', 'detail', organizationId] as const,
  platformAudit: (cursor: string | null, filters: PlatformFeedFilters) =>
    ['platform-audit', cursor, filters] as const,
};

/**
 * ===========================================================================
 * `isFetching` IS THE LOADING STATE ON THIS CONSOLE, AND THAT IS A PROPERTY OF
 * THE DEFAULTS RATHER THAN A HABIT
 * ===========================================================================
 *
 * The screens converted here render a loading block whenever `isFetching` is
 * true, which reproduces the `useEffect` version exactly — it set
 * `{ kind: 'loading' }` at the top of every effect run.
 *
 * **That equivalence holds only because this client makes no refetch an
 * operator did not cause.** `lib/query-client.ts` disables retry, window-focus
 * and reconnect refetching, and configures no `refetchInterval` anywhere, so
 * the complete set of fetches is: a mount, a cursor change, an explicit
 * `refetch()` from a retry button, and an invalidation from a completed write.
 *
 * **If any of those defaults is ever re-enabled, `isFetching` stops meaning
 * "an operator is waiting" and these screens will blank themselves for reasons
 * nobody asked for.** Stated here because nothing would go red when it changed.
 */

/**
 * One page of Templates.
 *
 * `staleTime: 0` — a cursor page is not reusable. The cursor is bound to the
 * query that produced it, and a page served from cache is a page that may have
 * changed underneath. **Caching a list here would mean showing an operator a
 * stale platform state**, which is the opposite of what this console is for.
 */
export function useTemplateList(cursor: string | null): UseQueryResult<ListTemplatesOutput, ApiError> {
  return useQuery<ListTemplatesOutput, ApiError>({
    queryKey: queryKeys.templateList(cursor),
    queryFn: () =>
      asApiError(() =>
        platformClient.listTemplates({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor }),
      ),
    staleTime: 0,
  });
}

/**
 * Every Template, for the onboarding picker.
 *
 * **A DIFFERENT QUERY FROM `useTemplateList`, DELIBERATELY, AND THE KEY SAYS
 * SO.** It asks for `PLATFORM_MAX_PAGE_SIZE` and no cursor, because it fills a
 * picker and *"a second page of it would be a paginated dropdown nobody
 * wants"*. Sharing a key with the paginated list would serve one screen the
 * other's page.
 *
 * **It sits under the `templates` prefix on purpose**: creating a Template
 * invalidates that prefix, so a business type created on the Templates screen
 * appears in this picker without anyone wiring the two together.
 *
 * `staleTime` is the 30-second default rather than 0 — this is a picker
 * rendered inside another screen, and re-reading it every time the operator
 * returns to the home section is an audited call for a list that rarely moves.
 */
export function useTemplatePicker(): UseQueryResult<ListTemplatesOutput, ApiError> {
  return useQuery<ListTemplatesOutput, ApiError>({
    queryKey: queryKeys.templatePicker,
    queryFn: () =>
      asApiError(() => platformClient.listTemplates({ pageSize: PLATFORM_MAX_PAGE_SIZE })),
  });
}

/**
 * Create a Template.
 *
 * ===========================================================================
 * INVALIDATION IS ONE AUDITED CALL, AND THAT IS DELIBERATE RATHER THAN INCIDENTAL
 * ===========================================================================
 *
 * The screen returns to the FIRST page after a create — it does not re-fetch the
 * page the operator was on. The reason was written down before this conversion
 * and still holds:
 *
 *   "The cursor is bound to the query and a new row changes what the enumeration
 *    contains; resuming mid-list after an insert shows a page whose meaning has
 *    quietly changed. **It is also one audited call either way.**"
 *
 * `invalidateQueries` refetches ACTIVE queries only, and exactly one list query
 * is mounted at a time — so this stays one call. **If a future screen mounts two
 * list pages at once, this becomes two audit rows and the count stops being
 * incidental.** Stated because nothing would go red when it changed.
 *
 * **NOTHING IS WRITTEN INTO THE CACHE OPTIMISTICALLY.** The created Template is
 * returned to the caller for its confirmation panel, and the list is re-read
 * from the server. A predicted row on a platform screen would be this console
 * asserting a result Core has not confirmed.
 */
export function useCreateTemplate(): UseMutationResult<Template, ApiError, CreateTemplateInput> {
  const queryClient = useQueryClient();
  return useMutation<Template, ApiError, CreateTemplateInput>({
    mutationFn: (input) => asApiError(() => platformClient.createTemplate(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

/**
 * One page of the operator roster.
 *
 * `staleTime: 0` for the same reason the Template list carries it — a cursor
 * page is bound to the query that produced it. **And the roster is the one list
 * where a stale answer is a security answer**: it says who holds platform
 * authority, and showing a revoked operator as current is the wrong direction
 * to be wrong in.
 */
export function useOperatorList(
  cursor: string | null,
): UseQueryResult<ListOperatorsOutput, ApiError> {
  return useQuery<ListOperatorsOutput, ApiError>({
    queryKey: queryKeys.operatorList(cursor),
    queryFn: () =>
      asApiError(() =>
        platformClient.listOperators({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor }),
      ),
    staleTime: 0,
  });
}

/**
 * Revoke one operator's platform authority.
 *
 * ===========================================================================
 * THE GATE OWNS THE SUBMISSION STATE. THIS MUTATION'S OWN STATE IS NOT READ,
 * AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT
 * ===========================================================================
 *
 * `ConfirmationGate` is already a state machine over this exact request —
 * `requesting`, `challenged`, `deriving`, `submitting`, `failed` — and it holds
 * the phase that the password derivation runs inside. **A second copy of
 * pending-and-error read off this hook would be two renderings of one request,
 * and the two would drift.** So the gate awaits `mutateAsync`, and
 * `isPending`/`error` here are left alone.
 *
 * **Then why a mutation at all, rather than calling the client from the screen?**
 * For the invalidation. `architecture.md` §3a: a step that must be REMEMBERED is
 * a discipline, a step the write itself performs is a mechanism. The roster is
 * re-read because a revoke succeeded, not because a screen thought to ask.
 *
 * ===========================================================================
 * IT COSTS ONE AUDITED READ, AND A SELF-REVOKE SPENDS IT ON A REFUSAL
 * ===========================================================================
 *
 * `invalidateQueries` refetches ACTIVE queries only and exactly one roster page
 * is mounted, so this is one call — the same count the `nonce` bump cost before
 * the conversion.
 *
 * **When an operator revokes THEMSELVES, that one call is refused**, and `0013`
 * records a denial. That was equally true of the code this replaces, so it is
 * carried across rather than introduced; it is written down because it is
 * invisible in the diff. `retry: false` is what keeps it at one denial instead
 * of four.
 */
export function useRevokeOperator(): UseMutationResult<
  RevokeOperatorOutput,
  ApiError,
  ConfirmedSubmission
> {
  const queryClient = useQueryClient();
  return useMutation<RevokeOperatorOutput, ApiError, ConfirmedSubmission>({
    mutationFn: (input) => asApiError(() => platformClient.revokeOperator(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.operators });
    },
  });
}

/**
 * One Organization's platform-side detail.
 *
 * ===========================================================================
 * `staleTime: 0` PRESERVES THE PREVIOUS COST EXACTLY, AND THE ALTERNATIVE IS
 * A CHEAPER SCREEN THAT THIS CONVERSION IS NOT THE PLACE TO CHOOSE
 * ===========================================================================
 *
 * The screen this replaces read on every mount. Leaving the 30-second default
 * in place would make a navigate-away-and-back inside that window free —
 * genuinely attractive, because `organization-detail-v1` costs **2 row-writes
 * per call** and the screen's own header says a thirty-second refresh loop
 * exhausts an operator's daily ceiling in about two and a half hours.
 *
 * **It is not taken here, because there is no refresh control on that screen.**
 * A cached detail with no way to ask again is an operator looking at a status
 * that may have moved, with no affordance to find out. Making the read cheaper
 * is a change to what the screen shows, not to how it fetches, so it belongs to
 * whoever adds the control rather than to a stack migration. **Raised as an open
 * question rather than decided quietly.**
 *
 * **NOTHING POLLS THIS.** No `refetchInterval` here and none in the defaults.
 */
export function useOrganizationDetail(
  organizationId: string,
): UseQueryResult<OrganizationDetail, ApiError> {
  return useQuery<OrganizationDetail, ApiError>({
    queryKey: queryKeys.organizationDetail(organizationId),
    queryFn: () => asApiError(() => platformClient.readOrganization(organizationId)),
    staleTime: 0,
  });
}

/**
 * Merge a saved identity block into the cached detail. **A write, never a read.**
 *
 * The update route returns the WHOLE identity block after the change — *"a
 * console applying a partial response to local state has to guess what the
 * server did with the fields it omitted; a whole block cannot be guessed
 * wrong"* — so the answer is merged and **nothing is re-fetched.**
 *
 * **THIS IS DELIBERATELY `setQueryData` AND NOT `invalidateQueries`.** They look
 * interchangeable at this call site and are not: an invalidation would re-read
 * the Organization, **doubling the cost of every edit for information already in
 * hand**, on a route that bills 2 row-writes per call. The screen said so before
 * the cache existed and the sentence is carried across rather than re-derived.
 */
export function useMergeOrganizationIdentity(): (
  organizationId: string,
  identity: Partial<OrganizationDetail>,
) => void {
  const queryClient = useQueryClient();
  return (organizationId, identity) => {
    queryClient.setQueryData<OrganizationDetail>(
      queryKeys.organizationDetail(organizationId),
      (current) => (current === undefined ? current : { ...current, ...identity }),
    );
  };
}

/**
 * One page of the Organization list — the console's home screen.
 *
 * **EVERY PAGE IS AN AUDITED CALL**, because enumerating every Organization
 * *"is the reconnaissance step before a targeted action"*. `staleTime: 0` for
 * the reason the other list hooks carry it: a cursor page is bound to the query
 * that produced it.
 */
export function useOrganizationList(
  cursor: string | null,
): UseQueryResult<ListOrganizationsOutput, ApiError> {
  return useQuery<ListOrganizationsOutput, ApiError>({
    queryKey: queryKeys.organizationList(cursor),
    queryFn: () =>
      asApiError(() =>
        platformClient.listOrganizations({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor }),
      ),
    staleTime: 0,
  });
}

/**
 * Onboard an Organization.
 *
 * **The invalidation replaces a `nonce` bump that existed for a specific
 * reason, and the reason survives the move**: returning to the first page is a
 * no-op when the operator is already on it, *"and that is exactly the common
 * case here"*. `invalidateQueries` does not care whether the cursor changed —
 * it refetches the mounted list either way — so the case the nonce existed for
 * is covered without the nonce.
 *
 * **One audited call**, and only because exactly one Organization list is
 * mounted. A second mounted list makes it two.
 *
 * **Nothing is written into the cache optimistically.** The onboarding response
 * carries ids and warnings, not a list row, and predicting one would be this
 * console asserting a result Core has not confirmed.
 */
export function useOnboardOrganization(): UseMutationResult<
  OnboardOrganizationOutput,
  ApiError,
  OnboardOrganizationInput
> {
  const queryClient = useQueryClient();
  return useMutation<OnboardOrganizationOutput, ApiError, OnboardOrganizationInput>({
    mutationFn: (input) => asApiError(() => platformClient.onboardOrganization(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
    },
  });
}

/**
 * The platform audit feed.
 *
 * **This one IS a query, and the Organization feed below is NOT — the
 * difference is whose allowance the read spends.** This feed costs 2
 * control-plane row-writes against the platform's own 600/day ceiling and
 * loads on arrival, as it always has. The Organization feed spends a
 * CUSTOMER's allowance and must not fire without a press.
 *
 * `staleTime: 0`, and the filters are part of the key so a filter change is a
 * different question rather than a refetch of the old one.
 */
export function usePlatformAudit(
  cursor: string | null,
  filters: PlatformFeedFilters,
): UseQueryResult<PlatformFeedOutput, ApiError> {
  return useQuery<PlatformFeedOutput, ApiError>({
    queryKey: queryKeys.platformAudit(cursor, filters),
    queryFn: () =>
      asApiError(() =>
        platformClient.listPlatformAudit({
          pageSize: PLATFORM_DEFAULT_PAGE_SIZE,
          cursor,
          filters,
        }),
      ),
    staleTime: 0,
  });
}

/**
 * One Organization's own audit trail.
 *
 * ===========================================================================
 * A MUTATION, FOR A READ, AND IT IS THE ONLY HONEST MAPPING
 * ===========================================================================
 *
 * **This read WRITES — five rows into a customer's own daily allocation, every
 * time, including when it finds nothing.** Three properties follow, and
 * `useQuery` cannot hold all three:
 *
 *   1. **IT MUST NOT FIRE ON MOUNT.** Arriving at the address, or landing here
 *      from a mistyped link, must cost the customer nothing. The operator
 *      presses Read, having been told the price.
 *   2. **EVERY PRESS MUST FIRE, INCLUDING AN IDENTICAL ONE.** A repeat read is
 *      a real read the business is entitled to see in its trail. **Serving it
 *      from cache would show the operator an answer while the customer's log
 *      recorded fewer reads than happened** — the console under-reporting its
 *      own access to someone else's data.
 *   3. **THE ATTEMPT COUNTER MUST COUNT REFUSALS.** A mutation settles exactly
 *      once per call, success or failure, which is where the tally belongs.
 *
 * `useQuery` would need `enabled`, a manual `refetch`, and an effect watching
 * timestamps to count attempts — **three workarounds to make a cache behave
 * like something that must not cache.** A mutation is what this is:
 * `mutations: { retry: false }` already applies, so a refusal is one refusal.
 *
 * **It caches nothing and invalidates nothing**, which is correct in both
 * directions — no other screen shows this data, and this screen must never be
 * served stale.
 */
export function useOrganizationAuditRead(): UseMutationResult<
  OrganizationFeedOutput,
  ApiError,
  { organizationId: string; cursor: string | null; filters: OrganizationFeedFilters }
> {
  return useMutation<
    OrganizationFeedOutput,
    ApiError,
    { organizationId: string; cursor: string | null; filters: OrganizationFeedFilters }
  >({
    mutationFn: ({ organizationId, cursor, filters }) =>
      asApiError(() =>
        platformClient.listOrganizationAudit(organizationId, {
          pageSize: PLATFORM_DEFAULT_PAGE_SIZE,
          cursor,
          filters,
        }),
      ),
  });
}
