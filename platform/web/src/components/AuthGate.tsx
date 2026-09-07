/**
 * The auth gate: unauthenticated people see the login screen, not the directory.
 *
 * ===========================================================================
 * THIS IS PRESENTATION. IT IS NOT A SECURITY CONTROL, AND MAY NEVER BE ONE.
 * ===========================================================================
 *
 * `security.md` §2: "UI-level hiding is presentation, never security. A hidden
 * button is still reachable." Everything behind this gate is authorized in
 * `platform/core/**` on every single call, and would be refused for an
 * unauthenticated caller whether or not this component existed. What the gate
 * buys is that a signed-out person sees a form they can act on instead of a
 * screen full of `unauthenticated` errors.
 *
 * The state machine itself is `lib/use-session.ts`; this file only chooses what
 * to draw for each of its three states.
 */

import type { ReactNode } from 'react';
import { Login } from '@/screens/Login';
import { Panel, StateBlock, ErrorBlock } from '@/components/StateBlock';
import { Button } from '@/components/ui/button';
import type { AuthClient } from '@/api/auth';
import type { Session } from '@/lib/use-session';

export function AuthGate({
  session,
  auth,
  children,
}: {
  session: Session;
  auth: AuthClient;
  children: ReactNode;
}) {
  if (session.state === 'authenticated') return <>{children}</>;

  if (session.state === 'anonymous') {
    return (
      <Login
        auth={auth}
        onSignedIn={session.signedIn}
        signOutUncleared={session.signOutUncleared}
      />
    );
  }

  /*
   * `unknown` WITH AN ERROR. The probe failed for a reason that is NOT `401` —
   * unreachable, rate limited, internal. None of those says anything about
   * whether a session exists, so none may be rendered as signed out. The person
   * is offered a retry, and a way past it if the retry keeps failing.
   */
  if (session.probeError) {
    return (
      <Panel>
        <ErrorBlock
          error={session.probeError}
          onRetry={session.retryProbe}
          retryLabel="Try again"
          extraActions={
            <Button variant="secondary" onClick={session.showLogin}>
              Sign in instead
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <StateBlock
        title="Checking your session"
        body="One moment — Dudo is confirming you are still signed in."
      />
    </Panel>
  );
}
