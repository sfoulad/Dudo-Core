/**
 * The console's root: four session states, four screens.
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
 * That is now load-bearing rather than theoretical: `whoami` reports a permission
 * list and the Organization list makes a real authorized call. NOTHING BELOW
 * BRANCHES ON THAT LIST TO PERMIT ANYTHING. The `operator` state is reached only
 * because Core answered `200` to an audited, authorized request — and every
 * subsequent call is authorized again on its own.
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

import { useMemo, type ReactNode } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { Button } from '@/components/ui/button';
import { SignIn } from '@/screens/SignIn';
import { Organizations } from '@/screens/Organizations';
import { OrganizationDetail } from '@/screens/OrganizationDetail';
import { Templates } from '@/screens/Templates';
import { Operators } from '@/screens/Operators';
import { Audit } from '@/screens/Audit';
import { createAuthClient } from '@/api/auth';
import { createPlatformClient, type PlatformClient } from '@/api/platform';
import { useOperatorSession } from '@/lib/use-session';
import {
  ROUTES,
  useLocation,
  HOME_ROUTE,
  isKnownPath,
  matchOrganizationDetail,
} from '@/lib/router';

export function App() {
  // One of each for the life of the application. Recreating them per render
  // would give the session hook's callbacks a new identity every time and would
  // re-fire the probe — which, on this class, is a fresh audit record each time.
  const auth = useMemo(() => createAuthClient(), []);
  const platform = useMemo(() => createPlatformClient(), []);
  const session = useOperatorSession(auth, platform);
  const location = useLocation();

  if (session.state === 'anonymous') {
    return (
      <SignIn
        auth={auth}
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
    <AdminShell
      currentPath={isKnownPath(location.path) ? location.path : HOME_ROUTE}
      whoami={session.whoami}
      signingOut={session.signingOut}
      onSignOut={session.signOut}
    >
      <Section path={location.path} platform={platform} />
    </AdminShell>
  );
}

/** The frameless states — no sidebar, because none of them can be navigated. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-16 sm:py-24">{children}</main>
  );
}

/**
 * An unknown hash renders the home section rather than a "not found" screen.
 *
 * A 404 inside a console with four sections and no deep links would be a dead
 * end for a mistyped address. THIS IS WORTH REVISITING WHEN ROUTES TAKE
 * IDENTIFIERS — `/organizations/:id` for an Organization that does not exist is
 * a genuine not-found and must say so, rather than quietly showing a list.
 */
function Section({ path, platform }: { path: string; platform: PlatformClient }) {
  /*
   * THE DETAIL PAGE IS MATCHED BEFORE THE SWITCH, because it is the only route
   * with a path parameter and a `switch` on a literal cannot express it.
   * `matchOrganizationDetail` requires exactly two segments, so `/organizations`
   * still falls through to the list below.
   */
  const organizationId = matchOrganizationDetail(path);
  if (organizationId !== null) {
    return <OrganizationDetail platform={platform} organizationId={organizationId} />;
  }

  switch (path) {
    case ROUTES.templates:
      return <Templates platform={platform} />;
    case ROUTES.operators:
      return <Operators />;
    case ROUTES.audit:
      return <Audit />;
    case ROUTES.organizations:
    default:
      return <Organizations platform={platform} />;
  }
}
