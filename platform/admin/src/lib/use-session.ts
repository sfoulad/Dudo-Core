/**
 * The operator session state machine, in one hook.
 *
 * ===========================================================================
 * IT IS SIMPLER THAN THE CUSTOMER CLIENT'S, AND THAT IS NOT A SHORTCUT
 * ===========================================================================
 *
 * `platform/web`'s equivalent carries `unknown` as a real state, a probe, a
 * retry, a `showLogin` escape and an `organizationRequired` flag. NONE OF THOSE
 * APPLY HERE, and each absence has a reason recorded rather than assumed:
 *
 *   - NO `unknown`, BECAUSE NOTHING COULD RESOLVE IT. `unknown` exists in the
 *     customer client for the window between first paint and the probe's answer.
 *     This console has no probe (`api/platform-session.ts`), so an `unknown`
 *     state here would be permanent — a spinner that never stops. The honest
 *     shape is two states plus a visible "unverified" qualifier.
 *   - NO PROBE AND NO RETRY, because there is no agreed contract to probe.
 *   - NO `organizationRequired`. `docs/decisions/0024`: a platform principal
 *     holds ZERO membership rows, so its session's `active_organization_id`
 *     stays null for its whole life and there is nothing to select. The state
 *     the customer client spends real effort on cannot arise here.
 *
 * ===========================================================================
 * NOTHING SIGNS IN OR OUT ON ITS OWN
 * ===========================================================================
 *
 * `docs/decisions/0018` costs revocation at 3 control-plane row-writes, the same
 * as a sign-in, so a sign-in/sign-out CYCLE is 6. No automatic re-login, no
 * retry loop around `login`, and NO REVOCATION ON A `401` — the session is
 * already gone at that point, and revoking it would spend three row-writes
 * deleting a row that is not there. `signOut` runs when a person presses the
 * button, and at no other time.
 */

import { useCallback, useState } from 'react';
import { readSessionHint, type AuthClient } from '@/api/auth';
import type { PlatformSessionKnowledge } from '@/api/platform-session';

export interface OperatorSession {
  readonly knowledge: PlatformSessionKnowledge;
  /**
   * True when this tab watched Core answer `200` to a sign-in. False when the
   * state came from the per-tab hint after a reload.
   *
   * IT IS NOT A SECURITY DISTINCTION AND MUST NEVER BE USED AS ONE — Core
   * authorizes every request either way. It decides one thing: whether the
   * header shows the "not verified" notice.
   */
  readonly confirmedThisPageLoad: boolean;
  readonly signingOut: boolean;
  /**
   * The last sign-out did not reach Core, so the credential was NOT cleared and
   * the session is still live. Shown on the sign-in screen as a warning, because
   * telling someone they are signed out when they are not is the quiet version
   * of the failure it replaced.
   */
  readonly signOutUncleared: boolean;
  /** The sign-in screen calls this once Core has answered `200`. */
  readonly signedIn: () => void;
  /** The sign-out button, and nothing else, calls this. */
  readonly signOut: () => void;
}

export function useOperatorSession(auth: AuthClient): OperatorSession {
  /*
   * THE INITIAL STATE IS READ ONCE, LAZILY, AND NEVER RE-READ.
   *
   * A `useEffect` that re-read the hint would fight the state set by `signedIn`
   * and `signOut`, and there is nothing to synchronise with: the hint is written
   * by this same module, in this same tab, and no other writer exists.
   */
  const [knowledge, setKnowledge] = useState<PlatformSessionKnowledge>(() =>
    readSessionHint() ? 'signed-in-unverified' : 'no-session-in-this-tab',
  );
  const [confirmedThisPageLoad, setConfirmedThisPageLoad] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutUncleared, setSignOutUncleared] = useState(false);

  const signedIn = useCallback(() => {
    // Core has just issued the cookie and this tab saw the `200`, so for the
    // rest of this page load the session is confirmed rather than assumed. The
    // hint itself was already written by `auth.login`.
    setSignOutUncleared(false);
    setConfirmedThisPageLoad(true);
    setKnowledge('signed-in-unverified');
  }, []);

  const signOut = useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutUncleared(false);
    /*
     * `logout()` never rejects, so there is one exit path and it always ends
     * signed out locally. BUT `cleared: false` IS SURFACED RATHER THAN
     * SWALLOWED: `0018` §B makes a `200` always carry the clearing cookie, so a
     * non-`200` — a network failure, or a rate limit — means nothing was revoked
     * and nothing was cleared, and the session is STILL LIVE. On an
     * administrative console, on a machine someone is about to walk away from,
     * that is worth saying out loud.
     */
    void auth.logout().then(
      (outcome) => {
        setSignOutUncleared(!outcome.cleared);
        setSigningOut(false);
        setConfirmedThisPageLoad(false);
        setKnowledge('no-session-in-this-tab');
      },
      () => {
        // `logout` is specified never to reject. If a future edit breaks that,
        // fail towards signed-out-and-warned rather than towards stuck.
        setSignOutUncleared(true);
        setSigningOut(false);
        setConfirmedThisPageLoad(false);
        setKnowledge('no-session-in-this-tab');
      },
    );
  }, [auth, signingOut]);

  return {
    knowledge,
    confirmedThisPageLoad,
    signingOut,
    signOutUncleared,
    signedIn,
    signOut,
  };
}
