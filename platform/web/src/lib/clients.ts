/**
 * The API clients, and the one ternary that decides what this build talks to.
 *
 * ===========================================================================
 * THE TRANSPORT SEAM, MOVED HERE FROM `App.tsx` RATHER THAN CHANGED
 * ===========================================================================
 *
 * `App.tsx` used to build these with `useMemo(..., [])` and thread the client
 * down to every screen as a prop. Under TanStack Router the screens are rendered
 * by the route tree rather than by a parent that could pass anything, so the
 * clients moved to module scope — which is where the old file's own comment said
 * they belonged anyway:
 *
 *   "It is built OUTSIDE the component and memoised on nothing, because a new
 *    transport identity would re-trigger every `useEffect` keyed on the client
 *    and re-issue every in-flight read."
 *
 * Module scope makes that structural instead of conventional: there is now no
 * render that can produce a second transport.
 *
 * WHICH TRANSPORT A BUILD TALKS TO IS THE SINGLE MOST CONSEQUENTIAL FACT ABOUT
 * IT, so the choice stays a visible ternary rather than hiding inside a factory.
 * `api/config.ts` refuses to start on an unrecognised value, so this never
 * silently falls back to fixtures.
 *
 * ===========================================================================
 * THE `client` IDENTITY IS NO LONGER THE ORGANIZATION RETRY
 * ===========================================================================
 *
 * `App.tsx` rebuilt the Customer Directory client whenever
 * `useOrganization().nonce` changed, so that every screen's `useEffect` keyed on
 * `client` re-issued its read — serving the contract's "retry the original
 * request ONCE" without any screen knowing Organization selection existed.
 *
 * That trick is gone, and what replaced it is narrower rather than looser:
 * `RootLayout` calls `queryClient.invalidateQueries()` when the nonce moves.
 * The properties the old comment insisted on both survive, and the second one
 * survives BY CONSTRUCTION now instead of by care —
 *
 *   ONCE, AND ONLY ONCE: nothing bumps the nonce again until the next successful
 *   selection, which is unchanged.
 *
 *   IT DOES NOT REPLAY WRITES: invalidation refetches QUERIES. A mutation is not
 *   a query and cannot be invalidated, so a create or an update refused with
 *   `failed_precondition` is not re-submitted — the person presses the button
 *   again. Under the old scheme that was a rule an author had to keep; here
 *   there is no mechanism that could break it.
 */

import { createCustomerDirectoryClient, type CustomerDirectoryClient } from '@/api/client';
import { createFixtureTransport, type Transport } from '@/api/fixture-transport';
import { createHttpTransport } from '@/api/http-transport';
import { signalPreconditionFailed, signalUnauthenticated } from '@/api/session-signal';
import { createAuthClient, type AuthClient } from '@/api/auth';
import { createOrganizationClient, type OrganizationClient } from '@/api/organization';
import { CONFIG } from '@/api/config';

export const transport: Transport =
  CONFIG.transport === 'http'
    ? createHttpTransport({
        onUnauthenticated: signalUnauthenticated,
        onPreconditionFailed: signalPreconditionFailed,
      })
    : createFixtureTransport();

export const authClient: AuthClient = createAuthClient();
export const organizationClient: OrganizationClient = createOrganizationClient();
export const customerClient: CustomerDirectoryClient = createCustomerDirectoryClient(transport);
