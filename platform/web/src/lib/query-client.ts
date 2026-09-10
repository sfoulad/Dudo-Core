/**
 * The TanStack Query client, configured against its own defaults.
 *
 * ===========================================================================
 * EVERY DEFAULT DISABLED BELOW WOULD HAVE ISSUED REQUESTS THIS CLIENT
 * DELIBERATELY DOES NOT MAKE
 * ===========================================================================
 *
 * ADR 0036 approved TanStack Query as "the thing that stops an admin screen
 * firing four identical calls". Adopted with its defaults it would have done the
 * opposite, because this application is unusually deliberate about when it
 * spends a request — `0014` §A's ceilings are 1,000 logins/day and a 10 ms CPU
 * budget, and `api/auth.ts` records at length why nothing here retries, probes
 * or refreshes on its own initiative.
 *
 * So the defaults are set explicitly rather than accepted, and each one is a
 * behaviour the hand-rolled `useEffect` code never had:
 *
 * `retry: false`
 *   The library default is THREE extra attempts with backoff, on every failure,
 *   for every query. That is wrong here in three separate ways and any one of
 *   them would be enough:
 *     · `api/errors.ts` already decides what is retryable, and `isRetryable`
 *       EXCLUDES `unauthenticated` — because after a logout the browser presents
 *       a dead cookie for up to 12 hours and `0018` requires a 401 to be read as
 *       signed out, never as a transient failure. Retrying it is retrying a
 *       question already answered.
 *     · A 422 meaning "no Organization selected" would be retried three times
 *       before `use-organization.ts` was allowed to open the picker.
 *     · `0017`'s pre-authentication rate limits are real, and a client that
 *       answers a refusal by asking three more times is how a limit becomes an
 *       outage.
 *   Retrying in this application is a BUTTON A PERSON PRESSES. `ErrorBlock`
 *   renders it, and only for errors `isRetryable` allows.
 *
 * `refetchOnWindowFocus: false`
 *   The default refetches every active query each time the tab regains focus.
 *   An admin console left open on a second monitor would poll the API by being
 *   looked at. Nothing in the previous code did this and nothing asked for it.
 *
 * `refetchOnReconnect: false`
 *   Same shape, triggered by the network rather than by attention. A flapping
 *   connection would multiply every screen's reads.
 *
 * `staleTime: 30s`
 *   The one default made LESS eager rather than more. At the library default of
 *   0 every mount refetches, which is what the `useEffect` code did; 30 seconds
 *   means list → record → back is served from cache, which is the de-duplication
 *   0036 wanted and is strictly fewer requests than today.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY *NOT* CONFIGURED HERE
 * ===========================================================================
 *
 * There is no `refetchInterval` anywhere in this application and none may be
 * added without a free-tier impact check (`architecture.md` §6a): a polling
 * screen turns one person's open tab into a fixed daily request cost, and the
 * Workers allowance is 100,000/day for everything.
 */

import { QueryClient } from '@tanstack/react-query';

/** Long enough that list → record → back is free; short enough to stay honest. */
const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * The authorized Business set changes when someone's authorization changes,
 * which is rare and is not something a person does mid-task. It labels every row
 * on the directory and fills the filter on two screens, so caching it is the
 * single largest saving available — and it is the SAME Action `probeSession`
 * spends on first paint (`core.ListAuthorizedBusinesses`), which is why sharing
 * one cache entry for it matters more than the number suggests.
 */
export const AUTHORIZED_BUSINESSES_STALE_TIME_MS = 5 * 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: DEFAULT_STALE_TIME_MS,
      },
      mutations: {
        // A write is never repeated on the client's initiative. `0018` costs a
        // login/logout cycle at 6 row-writes and the Customer create ceiling is
        // 1,250/day per Organization; more to the point, a silently re-posted
        // create is a duplicate record nobody asked for.
        retry: false,
      },
    },
  });
}
