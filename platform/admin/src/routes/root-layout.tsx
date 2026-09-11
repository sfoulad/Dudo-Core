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
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { useT } from '@/lib/i18n';
import { Button } from '@dudo/ui';
import { SignIn } from '@/screens/SignIn';
import { useOperatorSession } from '@/lib/use-session';
import { OperatorProvider } from '@/lib/operator-context';
import { authClient, platformClient } from '@/lib/clients';

export function RootLayout() {
  const t = useT();
  const session = useOperatorSession(authClient, platformClient);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (session.state === 'anonymous') {
    /*
      THE SIGN-IN SCREEN GETS THE LANGUAGE CONTROL TOO, and it is the single
      most important place for it: **it is the first page anyone sees.** It is
      placed here rather than inside `SignIn` so that all four session states
      get it from one decision — putting it in the screen would mean the next
      pre-auth screen has to remember.
    */
    return (
      <div className="min-h-dvh bg-paper">
        <div className="mx-auto flex w-full max-w-xl justify-end px-4 pt-4">
          <LocaleSwitch />
        </div>
        <SignIn
          auth={authClient}
          onSignedIn={session.signedIn}
          signOutUncleared={session.signOutUncleared}
        />
      </div>
    );
  }

  if (session.state === 'unknown') {
    return (
      <Centred>
        {session.probeError === null ? (
          <LoadingBlock label={t('loading.session')} />
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
              {t('session.probeFailed.notSignedOut')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4 ms-2"
              onClick={session.signOut}
              busy={session.signingOut}
            >
              {t('session.signOutInstead')}
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
          <h1 className="text-xl font-bold text-ink">{t('session.refused.title')}</h1>
          {/*
            SAYS THE PASSWORD WAS ACCEPTED, which is the half that stops an
            operator retyping it. **A translation that collapsed this into "you
            cannot sign in" would send them round the login loop forever** — the
            credential is fine and the console is refused.
          */}
          <p className="mt-3 leading-relaxed text-ink-soft">{t('session.refused.body')}</p>
          <p className="mt-3 leading-relaxed text-ink-soft">
            {/*
              Four conditions collapse into one argument-free `forbidden`, and
              one of them is "present in both tables". Naming any single cause
              would be a claim the response does not support, and on that fourth
              condition it would be actively wrong. So the console says what it
              knows and stops.
            */}
            {t('session.refused.noReason')}
          </p>
          {session.refusal?.request_id ? (
            <p className="mt-4 text-xs text-ink-muted">
              {t('denied.reference')}{' '}
              <bdi className="font-mono break-all">{session.refusal.request_id}</bdi>
            </p>
          ) : null}
          <Button
            variant="primary"
            className="mt-6"
            onClick={session.signOut}
            busy={session.signingOut}
          >
            {session.signingOut ? t('nav.signingOut') : t('nav.signOut')}
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
        <LoadingBlock label={t('loading.operatorContext')} />
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
/**
 * The wrapper for every session state that is NOT `operator`.
 *
 * **IT CARRIES THE LANGUAGE CONTROL, and that is not decoration.** These are
 * the states where an operator is being told something they may not expect —
 * checking a session, refused platform authority, or asked to sign in — and
 * `AdminShell` renders in none of them. Before this, the switch existed only
 * behind a successful sign-in, so **the first screen anyone sees was English
 * with no way out of it.**
 *
 * The control sits above the content rather than inside it because these
 * screens own their own copy; a wrapper that injected a header into a refusal
 * panel would be laying out someone else's message.
 */
function Centred({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-16 sm:py-24">
      <div className="mb-6 flex justify-end">
        <LocaleSwitch />
      </div>
      {children}
    </main>
  );
}
