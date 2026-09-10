/**
 * The TanStack Query client for the platform console.
 *
 * ===========================================================================
 * EVERY DEFAULT DISABLED BELOW WOULD HAVE ISSUED REQUESTS THIS CONSOLE
 * DELIBERATELY DOES NOT MAKE — AND HERE SOME OF THEM WRITE AUDIT ROWS
 * ===========================================================================
 *
 * `platform/web` sets the same four, and the reasoning carries. **On this host
 * it is stronger, because a request from the platform console is not only a
 * request.** Several of these routes write to the platform-operator audit trail
 * on every call — `whoami` does, and `0013`'s denial auditing does — so a
 * refetch nobody asked for writes a row describing nothing an operator did.
 * `0014` §A's daily write admission is finite, and the security split within it
 * is 10,000/day.
 *
 * `retry: false`
 *   The library default is THREE extra attempts with backoff. Wrong here in
 *   several independent ways:
 *     · `api/errors.ts` already decides what is retryable, and a `403` from a
 *       platform route is a settled answer rather than a transient one — `0024`
 *       makes `platform_operator` and `organization_membership` mutually
 *       exclusive, so a refusal will be refused identically three more times.
 *     · **A retried denial is a retried AUDIT ROW.** `0013` bounds denial
 *       auditing precisely because 100k probes could exhaust the daily write
 *       limit; a client that answers every refusal with three more requests is
 *       working against that bound from the inside.
 *     · `0017`'s pre-authentication rate limits are real, and a console that
 *       responds to a limit by asking again is how a limit becomes an outage.
 *   **Retrying here is a button an operator presses**, and `ErrorBlock` renders
 *   one only for errors `isRetryable` allows.
 *
 * `refetchOnWindowFocus: false`
 *   The default refetches every active query each time the tab regains focus. An
 *   operator console left open on a second monitor would poll the platform API —
 *   and audit it — by being looked at.
 *
 * `refetchOnReconnect: false`
 *   Same shape, triggered by the network rather than by attention.
 *
 * `staleTime`
 *   The one default made LESS eager. At the library default of 0 every mount
 *   refetches; a short window means moving between sections does not re-ask for
 *   what was just answered.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY NOT CONFIGURED
 * ===========================================================================
 *
 * **No `refetchInterval`, anywhere.** A polling admin screen turns one open tab
 * into a fixed daily cost in requests AND in audit rows, and adding one needs a
 * free-tier impact check (`architecture.md` §6a).
 *
 * **And nothing here caches `whoami`.** The session probe stays in
 * `useOperatorSession`, called once at module scope through `lib/clients.ts`,
 * for the reason `App.tsx` recorded before it was deleted: a second caller is a
 * second audit record.
 */

import { QueryClient } from '@tanstack/react-query';

/** Long enough that moving between sections is free; short enough to stay honest. */
const DEFAULT_STALE_TIME_MS = 30_000;

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
        /*
         * A WRITE IS NEVER REPEATED ON THE CLIENT'S INITIATIVE. On this console
         * the writes are onboarding an Organization, revoking an operator and
         * resetting a credential — every one of them consequential, audited, and
         * several of them confirmed. A silently re-posted mutation is a second
         * destructive action nobody asked for.
         */
        retry: false,
      },
    },
  });
}
