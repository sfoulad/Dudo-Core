/**
 * The root route's component: shell, gates, and the outlet every screen renders
 * into.
 *
 * REPLACES `App.tsx`. The route table that used to live beside it is now
 * `routes/route-tree.tsx`, and the `matchPath` ladder that chose a screen is
 * gone — a nested layout is what a router is for, and this file is the layout.
 *
 * ===========================================================================
 * BOTH GATES ARE PRESENTATION. NEITHER IS A SECURITY CONTROL.
 * ===========================================================================
 *
 * `security.md` §2: UI-level hiding is presentation, never security. Every
 * screen below is reachable by typing its address, and Core authorizes every
 * single call whether or not these components exist. What the gates buy is that
 * a signed-out person sees a form they can act on instead of a screen full of
 * `unauthenticated` errors, and that someone with no Organization selected sees
 * a choice instead of "that is not possible in this state".
 *
 * The Organization gate is INSIDE the auth gate, not beside it. Choosing an
 * Organization is a thing only an authenticated person can do, and the picker's
 * own route answers 401 without a session — so a signed-out visitor must reach
 * the login form, never this.
 */

import { useEffect } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { OrganizationGate } from '@/components/OrganizationGate';
import { useSession } from '@/lib/use-session';
import { useOrganization } from '@/lib/use-organization';
import { authClient, organizationClient, transport } from '@/lib/clients';

export function RootLayout() {
  const queryClient = useQueryClient();
  const session = useSession(transport, authClient);
  const organization = useOrganization(transport, organizationClient, {
    settled: session.settled,
    organizationRequired: session.organizationRequired,
    authenticated: session.state === 'authenticated',
  });

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routerPending = useRouterState({ select: (state) => state.status === 'pending' });
  const authenticated = session.state === 'authenticated';
  const selectionNonce = organization.nonce;

  /*
   * THE CONTRACT'S "RETRY THE ORIGINAL REQUEST ONCE", SERVED BY INVALIDATION.
   *
   * `App.tsx` did this by rebuilding the API client so that every screen's
   * `useEffect` keyed on `client` re-fired. Same outcome, and the two properties
   * that mattered are both stronger here:
   *
   *   ONCE, AND ONLY ONCE — nothing bumps `nonce` again until the next
   *   successful selection, so there is no path that can loop. Unchanged.
   *
   *   IT DOES NOT REPLAY WRITES — invalidation acts on QUERIES. A mutation is
   *   not a query and there is no mechanism here that could re-submit one, so a
   *   create refused with `failed_precondition` is not silently re-posted when
   *   selection completes. Under the old scheme that was a rule to keep; here it
   *   is a property of the tool.
   *
   * The guard on `> 0` is what stops the very first render invalidating a cache
   * that has nothing in it and no selection behind it.
   */
  useEffect(() => {
    if (selectionNonce > 0) void queryClient.invalidateQueries();
  }, [selectionNonce, queryClient]);

  /*
   * SIGNING OUT DROPS EVERY CACHED RESPONSE, AND THIS IS NOT HOUSEKEEPING.
   *
   * The hand-rolled screens held their rows in `useState` and lost them the
   * moment the gate swapped them out. A cache does not: without this, a person
   * who signs out and back in — AS A DIFFERENT PRINCIPAL, which is the case that
   * matters — would be shown the previous principal's directory while their own
   * session resolved.
   *
   * It is never a cross-tenant READ: Core derives the tenant from the session
   * and would refuse the request that produced those rows. It is the previous
   * person's data on this person's screen, which is not a thing to leave lying
   * around — `use-organization.ts` makes exactly the same argument about its
   * option list, and a cache makes the window longer rather than shorter.
   */
  useEffect(() => {
    if (!authenticated) queryClient.clear();
  }, [authenticated, queryClient]);

  /*
   * Focus the main region on a route change so keyboard and screen-reader users
   * land on the new screen rather than staying where the previous one was.
   *
   * ONLY WHEN NOTHING ELSE HAS CLAIMED FOCUS. Child effects run before parent
   * effects, so a screen that deliberately focuses a control — the form focuses
   * its first field — would otherwise be overruled here a moment later. That is
   * not cosmetic: the resulting blur fired the form's own blur validation and
   * showed "This is required" on an untouched field the instant the page opened.
   */
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <AppShell
      busy={routerPending}
      signedIn={authenticated}
      signingOut={session.signingOut}
      onSignOut={session.signOut}
    >
      <AuthGate session={session} auth={authClient}>
        <OrganizationGate organization={organization}>
          <Outlet />
        </OrganizationGate>
      </AuthGate>
    </AppShell>
  );
}
