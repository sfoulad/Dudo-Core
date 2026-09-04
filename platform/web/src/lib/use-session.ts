/**
 * The session state machine, in one hook.
 *
 * IT IS LIFTED OUT OF `AuthGate` SO THE SHELL CAN CARRY A SIGN-OUT CONTROL.
 * The gate renders inside `AppShell`, and the sign-out button belongs in the
 * header, so the state has to live above both. Passing a callback down and back
 * up would have worked and would have put the one thing that ends a session
 * behind two layers of prop threading.
 *
 * ===========================================================================
 * `unknown` IS NOT `anonymous`, AND `401` IS NOT A RETRY
 * ===========================================================================
 *
 * The session credential is an `HttpOnly` cookie, so this client cannot read it
 * and has to ask (`probeSession`). Until the answer lands the state is `unknown`,
 * which paints a quiet loading state — not the login form. Rendering `unknown`
 * as `anonymous` would flash a login screen on every reload for a signed-in
 * user and, worse, would show one during a brief outage, teaching people to
 * re-enter their password whenever the network hiccups.
 *
 * A probe that fails for any reason OTHER than `401` therefore stays `unknown`
 * and offers a retry. A `401` is not one of those reasons: `docs/decisions/0018`
 * requires it to be read as SIGNED OUT, because after a successful logout the
 * browser keeps presenting a dead cookie for up to 12 hours and the session
 * behind it is already gone.
 *
 * ===========================================================================
 * NOTHING HERE SIGNS IN OR OUT ON ITS OWN
 * ===========================================================================
 *
 * `0018` costs revocation at 3 row-writes, the same as a login, so a
 * login/logout CYCLE is 6 — 500 cycles/day platform-wide and 100 per principal,
 * half what `0014` §C's "1,000 logins/day" suggests to a reader who has not
 * counted logout. So: no automatic re-login, no retry loop around `login`, and
 * NO REVOCATION ON `401` (the session is already gone; revoking it would spend
 * three row-writes deleting a row that is not there). `signOut` runs when a
 * person presses the button, and at no other time.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  probeSession,
  readSessionHint,
  writeSessionHint,
  type AuthClient,
  type SessionState,
} from '@/api/auth';
import { onUnauthenticated } from '@/api/session-signal';
import type { Transport } from '@/api/fixture-transport';
import type { ApiError } from '@/api/errors';
import { CONFIG } from '@/api/config';

export interface Session {
  readonly state: SessionState;
  /** Set only when the probe failed for a reason that is NOT `401`. */
  readonly probeError: ApiError | null;
  /**
   * The probe has answered — either way. `useOrganization` gates its 422
   * listener on this so a cold start with no Organization selected does not run
   * two identical probes: the session probe's own 422 fires that signal.
   */
  readonly settled: boolean;
  /**
   * The credential is good and NO ORGANIZATION IS SELECTED — reported by the
   * probe, and never inferred from a login. It is NOT an authentication
   * failure: `0021` is explicit that answering this with a login screen builds
   * a loop that cannot terminate, because a fresh login produces another
   * session with nothing selected either.
   */
  readonly organizationRequired: boolean;
  readonly signingOut: boolean;
  /**
   * The last sign-out did not reach Core, so the credential was NOT cleared and
   * the session is still live. Rendered as a warning on the login screen.
   */
  readonly signOutUncleared: boolean;
  /** Called by the login screen once Core has answered `200`. */
  readonly signedIn: () => void;
  /** The sign-out button, and nothing else, calls this. */
  readonly signOut: () => void;
  /** Re-probe after a non-`401` failure. Manual only. */
  readonly retryProbe: () => void;
  /** Give up on a failed probe and show the login form instead. */
  readonly showLogin: () => void;
}

export function useSession(transport: Transport, auth: AuthClient): Session {
  const [state, setState] = useState<SessionState>('unknown');
  const [probeError, setProbeError] = useState<ApiError | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutUncleared, setSignOutUncleared] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);
  const [settled, setSettled] = useState(false);
  const [organizationRequired, setOrganizationRequired] = useState(false);

  useEffect(() => {
    /*
     * THE FIXTURE BUILD IS NOT PROBED, AND THE REASON IS NOT CONVENIENCE. The
     * fixture transport answers every call successfully because it has no
     * principal and no authorization; probing it would report `authenticated`
     * unconditionally and the login screen would be unreachable in the only
     * build that runs today.
     */
    if (CONFIG.transport !== 'http') {
      setState(readSessionHint() ? 'authenticated' : 'anonymous');
      setSettled(true);
      return;
    }

    let cancelled = false;
    setProbeError(null);
    void probeSession(transport).then((result) => {
      if (cancelled) return;
      setState(result.state);
      setProbeError(result.error);
      setOrganizationRequired(result.organizationRequired);
      setSettled(true);
      if (result.state === 'anonymous') writeSessionHint(false);
      if (result.state === 'authenticated') writeSessionHint(true);
    });
    return () => {
      cancelled = true;
    };
  }, [transport, probeNonce]);

  /*
   * A `401` from any request anywhere in the application.
   *
   * ADR 0015 §B: sessions are 12 hours with NO ROTATION and no refresh token, so
   * the first thing a person learns about expiry is a refused request. Sending
   * them to the login screen at that moment is the whole recovery path — there
   * is nothing to renew, and nothing to revoke.
   */
  useEffect(
    () =>
      onUnauthenticated(() => {
        writeSessionHint(false);
        setOrganizationRequired(false);
        setState('anonymous');
      }),
    [],
  );

  const signedIn = useCallback(() => {
    // Straight to `authenticated`. Core has just issued the cookie, so a probe
    // here would spend a request confirming what the `200` already said.
    setProbeError(null);
    setSignOutUncleared(false);
    /*
     * NOT `organizationRequired: true`, and not `false` as a claim either — the
     * flag is cleared because nothing has been probed for THIS session yet.
     * `login-v1` says a `200` may or may not carry a selected Organization and
     * the response has no field that reports it, deliberately. The client's
     * next move is to attempt the work and react to the refusal, not to branch
     * here on a fact it does not have.
     */
    setOrganizationRequired(false);
    setState('authenticated');
  }, []);

  const signOut = useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutUncleared(false);
    /*
     * `logout()` never rejects, so there is one exit path and it always ends
     * signed out — leaving someone apparently signed in after they asked to
     * leave is the worse of the two possible wrong answers.
     *
     * BUT `cleared: false` IS SURFACED RATHER THAN SWALLOWED. `0018` §B makes a
     * `200` always carry the clearing cookie, so a non-`200` — a network
     * failure, or the 60/minute source rate limit — means nothing was revoked
     * and nothing was cleared: the session is STILL LIVE. Showing a login screen
     * without saying so would tell the person they are signed out when they are
     * not, which is the quiet version of the failure this replaced.
     */
    void auth.logout().then(
      (outcome) => {
        setSignOutUncleared(!outcome.cleared);
        setSigningOut(false);
        setState('anonymous');
      },
      () => {
        // `logout` is specified never to reject. If a future edit breaks that,
        // fail towards signed-out-and-warned rather than towards stuck.
        setSignOutUncleared(true);
        setSigningOut(false);
        setState('anonymous');
      },
    );
  }, [auth, signingOut]);

  const retryProbe = useCallback(() => {
    setProbeNonce((value) => value + 1);
  }, []);

  const showLogin = useCallback(() => {
    writeSessionHint(false);
    setProbeError(null);
    setState('anonymous');
  }, []);

  return {
    state,
    probeError,
    settled,
    organizationRequired,
    signingOut,
    signOutUncleared,
    signedIn,
    signOut,
    retryProbe,
    showLogin,
  };
}
