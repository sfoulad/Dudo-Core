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
  type OrganizationCountOutput,
  type TemplateCountOutput,
  type ListTemplatesOutput,
  type OnboardOrganizationInput,
  type OnboardOrganizationOutput,
  type OrganizationDetail,
  type OrganizationFeedFilters,
  type OrganizationFeedOutput,
  type OrganizationTemplateOutput,
  type SetOrganizationTemplateInput,
  type TemplateUsageOutput,
  type UpdateTemplateInput,
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
  /*
   * THE COUNTS SIT UNDER THEIR OWN PREFIXES, so `invalidateQueries` on
   * `['templates']` after a create or a retire re-reads the total as well as
   * the list. **A dashboard that kept reporting the old number after the
   * operator changed it would be worse than the "at least N" it replaced** —
   * a stale total reads as authoritative in a way a lower bound does not.
   */
  templateCount: ['templates', 'count'] as const,
  templatePicker: ['templates', 'picker'] as const,
  templateUsage: (templateId: string) => ['templates', 'usage', templateId] as const,
  operators: ['operators'] as const,
  operatorList: (cursor: string | null) => ['operators', 'list', cursor] as const,
  organizations: ['organizations'] as const,
  organizationList: (cursor: string | null) => ['organizations', 'list', cursor] as const,
  organizationCount: ['organizations', 'count'] as const,
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

/* -------------------------------------------------------------------------
   Template lifecycle — `template-lifecycle-v1`
   ------------------------------------------------------------------------- */

/**
 * How many Organizations adopt one Template.
 *
 * ===========================================================================
 * `enabled` IS THE WHOLE POINT: THIS MUST NOT FIRE WHEN THE CARD IS DRAWN
 * ===========================================================================
 *
 * A Template list page can hold twenty rows. **A usage query mounted per row
 * would be twenty audited calls to render a list nobody asked a question
 * about** — and the read exists for one specific moment: the operator is
 * deciding whether to retire, and needs to know what that affects.
 *
 * So it is `enabled` only while a retire decision is open on THAT Template.
 * One card at a time, one call, when a person has asked.
 *
 * `staleTime: 0` — the figure is the basis for a destructive-shaped act, and a
 * cached count is a count that may have moved since. **Being wrong here means
 * retiring something on a stale belief about who is using it.**
 */
export function useTemplateUsage(
  templateId: string | null,
): UseQueryResult<TemplateUsageOutput, ApiError> {
  return useQuery<TemplateUsageOutput, ApiError>({
    queryKey: queryKeys.templateUsage(templateId ?? ''),
    queryFn: () => asApiError(() => platformClient.templateUsage(templateId ?? '')),
    enabled: templateId !== null,
    staleTime: 0,
  });
}

/**
 * Edit a Template's name or labels.
 *
 * Invalidates the whole `templates` surface: the list shows the name, the
 * picker shows the name, and a usage panel embeds the Template. **One
 * invalidation covers all three because they share the prefix** — and it is
 * still one audited call, because only the mounted list refetches.
 */
export function useUpdateTemplate(): UseMutationResult<
  Template,
  ApiError,
  { templateId: string; input: UpdateTemplateInput }
> {
  const queryClient = useQueryClient();
  return useMutation<Template, ApiError, { templateId: string; input: UpdateTemplateInput }>({
    mutationFn: ({ templateId, input }) =>
      asApiError(() => platformClient.updateTemplate(templateId, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

/**
 * Retire, and restore, as TWO HOOKS FOR TWO ROUTES.
 *
 * ===========================================================================
 * NOT ONE HOOK TAKING A DIRECTION, AND THE REASON IS THE AUDIT TRAIL
 * ===========================================================================
 *
 * `useSetTemplateStatus(id, 'retired' | 'active')` would type-check, read as
 * tidier, and be wrong. The contract splits these into two routes because
 * **"a toggle's audit record cannot say which direction it went without
 * reading the previous state"** — and a single client hook is how that split
 * gets quietly re-merged one layer above the transport.
 *
 * **They share a permission (`core.template.retire`) BY DECISION** — restore
 * exists because *"a mistaken retirement spends the Template's unique name
 * permanently"*, so whoever may retire must be able to undo it. Sharing a
 * permission is not sharing an act.
 *
 * ⚠ **THEY RETURN THE TEMPLATE, NOT THE USAGE — SR-14, 2026-09-11.** They used
 * to return the census *"so the outcome states what it affected"*, which made
 * an adoption count reachable through `core.template.retire` — **not the
 * permission that gates one.** The figure an operator needs is read BEFORE the
 * act, from `platform.templates.usage`, which is where the decision is made.
 *
 * Both invalidate the Template surface, so a cached "how many adopt this" is
 * refetched: the status changed, and that count is now a statement about a
 * different world.
 */
export function useRetireTemplate(): UseMutationResult<Template, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<Template, ApiError, string>({
    mutationFn: (templateId) => asApiError(() => platformClient.retireTemplate(templateId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

export function useRestoreTemplate(): UseMutationResult<Template, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation<Template, ApiError, string>({
    mutationFn: (templateId) => asApiError(() => platformClient.restoreTemplate(templateId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates });
    },
  });
}

/**
 * Set or clear one Organization's Template.
 *
 * **IT INVALIDATES TWO SURFACES AND THAT IS TWO SEPARATE FACTS.** The
 * Organization's detail now embeds a different Template, and **every
 * Template's usage count may have moved** — the one adopted and the one
 * dropped. Invalidating `templates` rather than one usage entry is deliberate:
 * this client does not know which Template was displaced without reading the
 * previous state, **which is the same reason the retire/restore split exists.**
 *
 * `invalidateQueries` refetches ACTIVE queries only, so in practice this costs
 * the detail read and nothing else — a usage query is enabled only while a
 * retire decision is open, and one is not open on this screen.
 */
export function useSetOrganizationTemplate(): UseMutationResult<
  OrganizationTemplateOutput,
  ApiError,
  { organizationId: string; input: SetOrganizationTemplateInput }
> {
  const queryClient = useQueryClient();
  return useMutation<
    OrganizationTemplateOutput,
    ApiError,
    { organizationId: string; input: SetOrganizationTemplateInput }
  >({
    mutationFn: ({ organizationId, input }) =>
      asApiError(() => platformClient.setOrganizationTemplate(organizationId, input)),
    onSuccess: (_result, { organizationId }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organizationDetail(organizationId),
      });
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
/**
 * ===========================================================================
 * THE TWO TOTALS — `0042`, and the routes' first consumer
 * ===========================================================================
 *
 * **A paginated list can only say *"at least 25"* until its last page.** These
 * are the routes that exist so a summary opened cold can state a number, and
 * until now they were built, registered, audited and **consumed by nothing.**
 *
 * **ONE AUDITED CALL EACH, ON MOUNT, AND NO POLLING.** Every platform read on
 * this console costs control-plane row-writes against a per-operator daily
 * ceiling, and a dashboard is the surface most likely to be left open — so
 * `refetchInterval`, `refetchOnWindowFocus` and `refetchOnReconnect` are all
 * off globally (`lib/query-client.ts`) and nothing here re-enables them.
 *
 * **`staleTime: 0` is deliberate and is NOT a refetch.** It means a total is
 * re-read when something invalidates it — creating a Template, onboarding an
 * Organization — rather than served from cache. **A dashboard reporting a
 * number the operator has just changed is worse than the lower bound it
 * replaced**, because a stale total reads as authoritative where "at least N"
 * announces its own uncertainty.
 *
 * **THEY ARE SEPARATE HOOKS, NOT ONE `useQueries`.** The two counts fail
 * independently — an operator may hold `core.organization.list` and not
 * `core.template.read` — and a combined hook would make one refusal hide the
 * other's answer.
 */
export function useOrganizationCount(): UseQueryResult<OrganizationCountOutput, ApiError> {
  return useQuery<OrganizationCountOutput, ApiError>({
    queryKey: queryKeys.organizationCount,
    queryFn: () => asApiError(() => platformClient.countOrganizations()),
    staleTime: 0,
  });
}

export function useTemplateCount(): UseQueryResult<TemplateCountOutput, ApiError> {
  return useQuery<TemplateCountOutput, ApiError>({
    queryKey: queryKeys.templateCount,
    queryFn: () => asApiError(() => platformClient.countTemplates()),
    staleTime: 0,
  });
}

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
