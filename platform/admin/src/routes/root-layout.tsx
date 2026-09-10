/**
 * The console's root: four session states, and the shell the routed sections
 * render into.
 *
 * REPLACES `App.tsx` (ADR 0040 / `0036`'s admin extension). The `switch (path)`
 * that chose a section is now `routes/route-tree.tsx`; everything else in this
 * file is carried across unchanged, including the reasoning, because a stack
 * migration that quietly rewrote the session gate would be a rewrite.
 *
 * ===========================================================================
 * THE GATE IS PRESENTATION. IT IS NOT SECURITY, AND MUST NOT BE READ AS ANY.
 * ===========================================================================
 *
 * ADR 0010 §7, stated because "a UI project is exactly where this gets eroded":
 *
 *   "HIDING A MENU OR A BUTTON IN THE WEB INTERFACE IS NEVER AN AUTHORIZATION
 *    CONTROL... Every admin action is authorised server-side in Core, on every
 *    call, exactly as any other caller. The console is a client and is trusted
 *    with nothing. The console holds no permission logic. It may RENDER
 *    according to permissions Core reports; it may never DECIDE them."
 *
 * That is load-bearing rather than theoretical: `whoami` reports a permission
 * list and the Organization list makes a real authorized call. NOTHING BELOW
 * BRANCHES ON THAT LIST TO PERMIT ANYTHING. The `operator` state is reached only
 * because Core answered `200` to an audited, authorized request — and every
 * subsequent call is authorized again on its own.
 *
 * **AND THE ROUTER CHANGES NOTHING ABOUT THAT.** Every section below is
 * reachable by typing its address; the gate decides what is DRAWN and Core
 * decides what is answered. A route tree is not an access-control list, and the
 * fact that an unauthenticated visitor cannot see a `<Link>` is worth exactly
 * nothing (`security.md` §2).
 *
 * ===========================================================================
 * `refused` IS NOT `anonymous`, AND CONFLATING THEM BUILDS AN INFINITE LOOP
 * ===========================================================================
 *
 * A `403` from `whoami` means the credential is good and this principal is not a
 * platform operator. Rendering that as a sign-in screen would invite someone to
 * sign in — successfully — and be refused again, forever, with the form implying
 * their password was wrong. `0021` documents the same shape for the Organization
 * picker. So it gets its own screen, which offers sign-out and nothing else,
 * because sign-out is the only action that can change the outcome.
 */

import type { ReactNode } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { AdminShell } from '@/components/AdminShell';
import { ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { Button } from '@dudo/ui';
import { SignIn } from '@/screens/SignIn';
import { useOperatorSession } from '@/lib/use-session';
import { OperatorProvider } from '@/lib/operator-context';
import { authClient, platformClient } from '@/lib/clients';

export function RootLayout() {
  const session = useOperatorSession(authClient, platformClient);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (session.state === 'anonymous') {
    return (
      <SignIn
        auth={authClient}
        onSignedIn={session.signedIn}
        signOutUncleared={session.signOutUncleared}
      />
    );
  }

  if (session.state === 'unknown') {
    return (
      <Centred>
        {session.probeError === null ? (
          <LoadingBlock label="Checking your operator session with Dudo…" />
        ) : (
          <ErrorBlock error={session.probeError} onRetry={session.retry}>
            <p className="mt-2 leading-relaxed text-ink-soft">
              {/*
                Deliberately explicit that this is NOT a statement about the
                session. An unreachable server says nothing about whether a
                credential is still good, and showing a sign-in form here would
                teach an operator to re-enter a password whenever the network
                hiccups.
              */}
              This does not mean you are signed out — Dudo could not be asked. Your session may
              well still be live.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4 ms-2"
              onClick={session.signOut}
              busy={session.signingOut}
            >
              Sign out instead
            </Button>
          </ErrorBlock>
        )}
      </Centred>
    );
  }

  if (session.state === 'refused') {
    return (
      <Centred>
        <div className="rounded-[12px] border border-line bg-surface p-6 sm:p-8">
          <h1 className="text-xl font-bold text-ink">This account cannot use the console</h1>
          <p className="mt-3 leading-relaxed text-ink-soft">
            You are signed in — your password was accepted — and Dudo refused this console to your
            account.
          </p>
          <p className="mt-3 leading-relaxed text-ink-soft">
            {/*
              Four conditions collapse into one argument-free `forbidden`, and
              one of them is "present in both tables". Naming any single cause
              would be a claim the response does not support, and on that fourth
              condition it would be actively wrong. So the console says what it
              knows and stops.
            */}
            Dudo does not say why, deliberately, and this console cannot tell. Signing in again
            will not change it — ask whoever administers the platform.
          </p>
          {session.refusal?.request_id ? (
            <p className="mt-4 font-mono text-xs break-all text-ink-muted">
              Reference {session.refusal.request_id}
            </p>
          ) : null}
          <Button
            variant="primary"
            className="mt-6"
            onClick={session.signOut}
            busy={session.signingOut}
          >
            {session.signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </Centred>
    );
  }

  /*
   * `operator`. `whoami` is non-null here by construction — the state is only
   * ever set alongside it — but the state and the value are separate pieces of
   * React state, so this is checked rather than asserted with `!`. A `!` here
   * would be the same class of unchecked claim as casting an API response.
   */
  if (session.whoami === null) {
    return (
      <Centred>
        <LoadingBlock label="Loading your operator context…" />
      </Centred>
    );
  }

  return (
    <OperatorProvider whoami={session.whoami}>
      <AdminShell
        currentPath={pathname}
        whoami={session.whoami}
        signingOut={session.signingOut}
        onSignOut={session.signOut}
      >
        <Outlet />
      </AdminShell>
    </OperatorProvider>
  );
}

/** The frameless states — no sidebar, because none of them can be navigated. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-16 sm:py-24">{children}</main>
  );
}
