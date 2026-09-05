/**
 * The console's root: signed out, or signed in with four sections.
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
 * So what follows decides which screen to draw and NOTHING ELSE. It grants
 * nothing, unlocks nothing, and reaches nothing. Today that is trivially true —
 * the four sections make no request at all — and the reason to say it now is
 * that it stops being trivially true the moment the first one does.
 */

import { useMemo } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { SignIn } from '@/screens/SignIn';
import { Organizations } from '@/screens/Organizations';
import { Templates } from '@/screens/Templates';
import { Operators } from '@/screens/Operators';
import { Audit } from '@/screens/Audit';
import { createAuthClient } from '@/api/auth';
import { useOperatorSession } from '@/lib/use-session';
import { ROUTES, useLocation, HOME_ROUTE, isKnownPath } from '@/lib/router';

export function App() {
  // One client for the life of the application. Recreating it per render would
  // give `useOperatorSession`'s `signOut` a new identity every time.
  const auth = useMemo(() => createAuthClient(), []);
  const session = useOperatorSession(auth);
  const location = useLocation();

  if (session.knowledge === 'no-session-in-this-tab') {
    return (
      <SignIn
        auth={auth}
        onSignedIn={session.signedIn}
        signOutUncleared={session.signOutUncleared}
      />
    );
  }

  return (
    <AdminShell
      currentPath={isKnownPath(location.path) ? location.path : HOME_ROUTE}
      sessionConfirmedThisPageLoad={session.confirmedThisPageLoad}
      signingOut={session.signingOut}
      onSignOut={session.signOut}
    >
      <Section path={location.path} />
    </AdminShell>
  );
}

/**
 * An unknown hash renders the home section rather than a "not found" screen.
 *
 * A 404 inside a console with four sections and no deep links would be a dead
 * end for a mistyped address; sending someone to the section they would have
 * reached anyway costs nothing. THIS IS WORTH REVISITING WHEN ROUTES TAKE
 * IDENTIFIERS — `/organizations/:id` for an Organization that does not exist is
 * a genuine not-found and must say so, rather than quietly showing a list.
 */
function Section({ path }: { path: string }) {
  switch (path) {
    case ROUTES.templates:
      return <Templates />;
    case ROUTES.operators:
      return <Operators />;
    case ROUTES.audit:
      return <Audit />;
    case ROUTES.organizations:
    default:
      return <Organizations />;
  }
}
