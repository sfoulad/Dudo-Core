/**
 * The operator session state machine, in one hook.
 *
 * ===========================================================================
 * IT NOW PROBES, AND `unknown` IS A REAL STATE AGAIN
 * ===========================================================================
 *
 * The shell version of this file had two states and a permanent "not verified"
 * qualifier, because no accepted contract let a principal with no Organization
 * verify itself. `platform.session.whoami` is accepted and implemented, so:
 *
 *   - `unknown` IS BACK, AND IT RESOLVES. It covers the window between first
 *     paint and the probe's answer. Rendering it as `anonymous` would flash a
 *     sign-in screen on every reload for a signed-in operator and — worse —
 *     would show one during a brief outage.
 *   - `refused` IS NEW AND IS NOT AN AUTHENTICATION FAILURE. A `403` means the
 *     credential is good and this principal is not an operator. Sending them to
 *     a sign-in form would loop forever: they would sign in successfully and be
 *     refused again. See `api/platform-session.ts`.
 *
 * ===========================================================================
 * THE PROBE RUNS ONCE PER PAGE LOAD. THE AUDIT LOG IS WHY.
 * ===========================================================================
 *
 * `whoami` writes a platform-operator audit record on every call. So there is no
 * interval, no refetch on focus, no refetch on reconnect, and no retry loop —
 * `retry` is wired to a button a person presses. `probeNonce` is the only thing
 * that re-runs it, and only a person increments it.
 *
 * NOTHING SIGNS IN OR OUT ON ITS OWN EITHER. `0018` costs revocation at 3
 * control-plane row-writes, the same as a sign-in, so a cycle is 6. No automatic
 * re-login, and NO REVOCATION ON A `401` — the session is already gone, and
 * revoking it would spend three row-writes deleting a row that is not there.
 */

import { useCallback, useEffect, useState } from 'react';
import { readSessionHint, writeSessionHint, type AuthClient } from '@/api/auth';
import { probeOperatorSession } from '@/api/platform-session';
import type { PlatformClient, WhoamiOutput } from '@/api/platform';
import type { ApiError } from '@/api/errors';

export type OperatorSessionState =
  /** The probe has not answered yet. Paints a quiet loading state, not a form. */
  | 'unknown'
  /** `200` from `whoami`. Signed in, verified, and an operator. */
  | 'operator'
  /** `401`, or a completed sign-out. The sign-in screen is correct. */
  | 'anonymous'
  /** `403`. Signed in, refused by the platform class. Not a sign-in problem. */
  | 'refused';

export interface OperatorSession {
  readonly state: OperatorSessionState;
  /** Present only in `operator`. The caller's own context, for rendering. */
  readonly whoami: WhoamiOutput | null;
  /** Set when the probe failed for a reason that was neither `401` nor `403`. */
  readonly probeError: ApiError | null;
  /** Set in `refused`. Core's argument-free `forbidden`. */
  readonly refusal: ApiError | null;
  readonly signingOut: boolean;
  /**
   * The last sign-out did not reach Core, so the credential was NOT cleared and
   * that session is still live. Surfaced rather than swallowed.
   */
  readonly signOutUncleared: boolean;
  /** The sign-in screen calls this once Core has answered `200`. */
  readonly signedIn: () => void;
  /** The sign-out button, and nothing else, calls this. */
  readonly signOut: () => void;
  /** Re-probe. Wired to a button; never called automatically. */
  readonly retry: () => void;
}

export function useOperatorSession(
  auth: AuthClient,
  platform: PlatformClient,
): OperatorSession {
  const [state, setState] = useState<OperatorSessionState>(() =>
    /*
     * THE PER-TAB HINT DECIDES THE FIRST PAINT ONLY, AND THE PROBE OVERRULES IT.
     *
     * With a hint, the first paint is a quiet `unknown` loading state rather
     * than a sign-in form, so a reload does not flash a form at someone who is
     * signed in. With no hint, there is no reason to spend an audited `whoami`
     * on a browser that has never signed in during this tab's life — the
     * sign-in screen is almost certainly right, and if it is wrong the person
     * signs in and finds out immediately.
     *
     * IT IS NOT A SECURITY INPUT. It is a non-secret string in `sessionStorage`
     * that gates one request; Core authorizes every call regardless.
     */
    readSessionHint() ? 'unknown' : 'anonymous',
  );
  const [whoami, setWhoami] = useState<WhoamiOutput | null>(null);
  const [probeError, setProbeError] = useState<ApiError | null>(null);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutUncleared, setSignOutUncleared] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);

  useEffect(() => {
    // Only ever runs from `unknown`, so a person who is already signed in or
    // already refused does not spend a second audited call on a re-render.
    if (state !== 'unknown') return;

    let cancelled = false;
    setProbeError(null);
    void probeOperatorSession(platform).then((probe) => {
      if (cancelled) return;
      switch (probe.kind) {
        case 'operator':
          setWhoami(probe.whoami);
          setState('operator');
          writeSessionHint(true);
          return;
        case 'anonymous':
          setWhoami(null);
          setState('anonymous');
          writeSessionHint(false);
          return;
        case 'refused':
          setWhoami(null);
          setRefusal(probe.error);
          setState('refused');
          // The hint stays as it is: the credential is live, and clearing it
          // would send the next reload to a sign-in form that cannot help.
          return;
        default:
          // Stays `unknown`, with the error and a retry. NOT `anonymous` — an
          // unreachable server says nothing about whether a session exists.
          setProbeError(probe.error);
          return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [platform, state, probeNonce]);

  const signedIn = useCallback(() => {
    /*
     * STRAIGHT TO `unknown`, NOT TO `operator`.
     *
     * Core has just issued the cookie, so the person is authenticated — but a
     * successful sign-in says NOTHING about whether they are a platform
     * operator. `login-v1` is the ordinary path for every principal and has no
     * concept of `platform_operator`; a tenant user with a valid password can
     * sign in here and must then meet the `403`, not the console.
     *
     * So the probe runs, and it is the probe that decides between `operator` and
     * `refused`. Jumping to `operator` here would draw the whole console for
     * someone Core is about to refuse on every call.
     */
    setProbeError(null);
    setRefusal(null);
    setSignOutUncleared(false);
    setState('unknown');
  }, []);

  const signOut = useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutUncleared(false);
    /*
     * `logout()` never rejects, so there is one exit path and it always ends
     * signed out locally. BUT `cleared: false` IS SURFACED: `0018` §B makes a
     * `200` always carry the clearing cookie, so a non-`200` means nothing was
     * revoked and the session is STILL LIVE. On an administrative console, on a
     * machine someone is about to walk away from, that is worth saying out loud.
     */
    void auth.logout().then(
      (outcome) => {
        setSignOutUncleared(!outcome.cleared);
        setSigningOut(false);
        setWhoami(null);
        setRefusal(null);
        setState('anonymous');
      },
      () => {
        // `logout` is specified never to reject. If a future edit breaks that,
        // fail towards signed-out-and-warned rather than towards stuck.
        setSignOutUncleared(true);
        setSigningOut(false);
        setWhoami(null);
        setRefusal(null);
        setState('anonymous');
      },
    );
  }, [auth, signingOut]);

  const retry = useCallback(() => {
    setProbeError(null);
    setState('unknown');
    setProbeNonce((value) => value + 1);
  }, []);

  return {
    state,
    whoami,
    probeError,
    refusal,
    signingOut,
    signOutUncleared,
    signedIn,
    signOut,
    retry,
  };
}
