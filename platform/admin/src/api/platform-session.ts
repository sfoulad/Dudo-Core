/**
 * The operator session probe. **The seam that was here is now filled.**
 *
 * ===========================================================================
 * WHAT THIS FILE USED TO SAY, AND WHY THE CHANGE IS RECORDED RATHER THAN
 * QUIETLY SWEPT
 * ===========================================================================
 *
 * This file previously made NO request and existed only to state a gap: the
 * console could not confirm a session was live, because every Action requires a
 * tenant and a platform operator can never have one (`0024`), so
 * `platform/web`'s probe would have returned `422 failed_precondition` for the
 * whole life of a perfectly good session. The shell shipped an honest
 * "Session not verified" banner instead of guessing.
 *
 * `platform.session.whoami` is now **accepted and implemented**, so the banner
 * is gone and this is a real probe. THE REASONING IS KEPT because it is what
 * makes the current design legible: this is not the customer client's probe with
 * a different URL, it is a different REQUEST CLASS — `0025`'s fourth —
 * authenticated at principal level, evaluating a permission, and never obtaining
 * a tenant store.
 *
 * ===========================================================================
 * IT RUNS ONCE PER PAGE LOAD, AND ON AN EXPLICIT RETRY. NEVER ON A TIMER.
 * ===========================================================================
 *
 * `whoami` declares `audit: required` and `platform-routes.ts` writes the record
 * BEFORE producing the answer — so every probe is a durable write in the
 * platform-operator action log. A probe on an interval would fill the log that
 * exists to record what operators DID with a stream of the console asking who it
 * is, and would bury the reconnaissance-then-action pattern the log is there to
 * make visible.
 *
 * There is also nothing to poll for. `0015` §B: sessions are 12 hours with NO
 * ROTATION and no refresh token, so there is no renewal a repeat call could
 * obtain. The first thing anyone learns about expiry is a refused request, and
 * that refusal is what moves this console to signed-out.
 *
 * ===========================================================================
 * FOUR ANSWERS, AND THE THIRD IS THE ONE WORTH GETTING RIGHT
 * ===========================================================================
 *
 * `403` IS NOT `401`, AND MUST NOT BE RENDERED AS ONE. A `401` means no usable
 * credential — the recovery is to sign in. A `403` means THE CREDENTIAL IS GOOD
 * AND THE PRINCIPAL IS NOT AN OPERATOR, and sending that person to a sign-in
 * form builds a loop that cannot terminate: they would sign in successfully and
 * be refused again, forever, with the screen implying their password was wrong.
 * That is the same defect `0021` describes for the Organization picker, in a
 * different costume.
 *
 * And this console must not say WHICH `403` it was.
 * `platform-operator-v1`'s `errors.forbidden` collapses four conditions into one
 * argument-free refusal — no `platform_operator` row, an unrecognised
 * `platform_role`, a role lacking the permission, or A PRINCIPAL PRESENT IN BOTH
 * TABLES — because "a caller able to detect the mutual-exclusion refusal could
 * use these routes to probe `organization_membership`." The fourth is the reason
 * a friendly "you are not a platform operator" would be wrong as well as
 * unsupported.
 */

import type { PlatformClient, WhoamiOutput } from './platform';
import { ApiError, toApiError } from './errors';

export type OperatorProbe =
  /** `200`. The credential is good and the caller is an operator. */
  | { readonly kind: 'operator'; readonly whoami: WhoamiOutput }
  /** `401`. No usable credential. The sign-in screen is the recovery. */
  | { readonly kind: 'anonymous' }
  /**
   * `403`. Authenticated, and refused by this class. FOUR CONDITIONS COLLAPSED
   * INTO ONE and this console cannot tell which. Not a sign-in problem.
   */
  | { readonly kind: 'refused'; readonly error: ApiError }
  /**
   * Anything else — unreachable, rate limited, a 5xx, a shape Core did not
   * promise. IT IS NOT `anonymous`: an unreachable server says nothing about
   * whether a session exists, and rendering it as absence would sign an operator
   * out during a brief outage and teach them to re-enter a password whenever the
   * network hiccups.
   */
  | { readonly kind: 'unknown'; readonly error: ApiError };

export async function probeOperatorSession(client: PlatformClient): Promise<OperatorProbe> {
  try {
    return { kind: 'operator', whoami: await client.whoami() };
  } catch (thrown) {
    const error = toApiError(thrown);
    if (error.code === 'unauthenticated') return { kind: 'anonymous' };
    if (error.code === 'forbidden') return { kind: 'refused', error };
    /*
     * `not_found` LANDS HERE DELIBERATELY, AND IT IS THE ONE WORTH A COMMENT.
     *
     * `http/api.ts` answers `404` when the request's host is not in `adminHosts`
     * OR when the platform class is not composed at all — one answer for both,
     * so a caller cannot tell a deployment that does not serve this class from a
     * host that does not. From here that is a DEPLOYMENT fact, not a session
     * fact: it means this build is being served somewhere the platform routes do
     * not exist. Reporting it as `anonymous` would show a sign-in form that
     * could never succeed.
     */
    return { kind: 'unknown', error };
  }
}
