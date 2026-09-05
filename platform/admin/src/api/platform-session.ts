/**
 * ===========================================================================
 * THE SEAM. THIS CONSOLE CANNOT CONFIRM THAT A SESSION IS STILL LIVE.
 * ===========================================================================
 *
 * THIS FILE MAKES NO REQUEST. It exists so that a gap is stated in one place,
 * in types, rather than being papered over in three screens.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CUSTOMER CLIENT'S ANSWER DOES NOT WORK HERE
 * ---------------------------------------------------------------------------
 *
 * The session credential is an `HttpOnly` cookie, so no browser client can read
 * it and every client must ASK the server whether it is still good.
 * `platform/web` asks by making the cheapest authenticated read in the contract
 * set — `core.ListAuthorizedBusinesses` with `page_size=1` — and reading the
 * status code: `200` is signed in, `401` is signed out.
 *
 * THAT CALL CANNOT ANSWER THE QUESTION FOR AN OPERATOR, and the reason is
 * structural rather than incidental. `docs/decisions/0024`: a platform principal
 * holds ZERO membership rows; with no membership there is no Organization
 * selection, with no selection there is no `TenantStoreResolver` handle, and
 * every Action requires one. `docs/decisions/0025` puts it in the request-class
 * table: an Action's tenant is REQUIRED, and a platform route's is NONE.
 *
 * So an operator calling that read receives `422 failed_precondition` — Core's
 * "no Organization selected" — for the entire life of a perfectly good session.
 * The customer client resolves that state by showing an Organization picker.
 * HERE THERE IS NOTHING TO PICK AND NEVER WILL BE, so the same code would
 * produce a console that permanently reports a condition it cannot clear.
 *
 * ---------------------------------------------------------------------------
 * THE ROUTE THAT WOULD ANSWER IT EXISTS ON PAPER AND IS NOT AGREED
 * ---------------------------------------------------------------------------
 *
 *   packages/contracts/core/platform/platform-operator-v1.contract.yaml
 *   operations[].id = platform.session.whoami
 *   GET /api/v1/platform/whoami   ->  200 whoamiOutput
 *   "Return the calling operator's own principal id, platform role and effective
 *    permission list, so the console can render only the actions this operator
 *    may take."
 *
 * THAT CONTRACT IS `status: proposed`. `.claude/rules/workflow.md` §3 is the
 * sequence — architecture authors, the Team Lead agrees, and only THEN do
 * consumers implement — and §3's closing line covers exactly this temptation:
 * "Implementing ahead of an agreed contract is out of order, even when the shape
 * 'seems obvious.'" It is also not merely unratified: it carries five open
 * questions, and PO-1 states that the platform-operator action log has no
 * decision record and "blocks implementation of every route in this class."
 *
 * SO NOTHING HERE CALLS IT. Not behind a flag, not as a "harmless" read, not
 * with a fallback. `whoami` also declares `audit: required`, so a speculative
 * call would write an audit record for an operation nobody authorised.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CONSOLE DOES INSTEAD, AND WHY IT IS THE HONEST OPTION
 * ---------------------------------------------------------------------------
 *
 * Three states are possible for a reloaded tab, and only one of them is true:
 *
 *   1. CLAIM SIGNED IN. Renders the shell and says nothing. This is the one
 *      option that is a lie — the cookie may have expired, been revoked, or been
 *      issued twelve hours ago, and the console would have no way to know.
 *   2. CLAIM SIGNED OUT. Sends an operator with a perfectly good session back to
 *      a sign-in form on every reload, and teaches them to re-enter a password
 *      whenever anything looks odd. That is the habit phishing depends on.
 *   3. SAY WHICH IS KNOWN AND WHICH IS NOT. The tab hint records that someone
 *      signed in during this tab's life; whether that session is STILL live is
 *      unverified, and the console says so in the header rather than resolving
 *      it either way.
 *
 * THE CONSOLE DOES 3. The banner is not decoration and must not be quietly
 * dropped when it gets annoying: it is the visible form of a missing contract,
 * and it should disappear by being ANSWERED, not by being hidden.
 *
 * IT COSTS NOTHING IN SAFETY, because it never had any to spend. Whatever this
 * console believes about a session changes no authorization outcome: Core
 * authorizes every platform route on every call against `platform_operator`, and
 * ADR 0010 §7 is explicit — "Hiding a menu or a button in the web interface is
 * never an authorization control." An unverified banner over an empty shell
 * reaches exactly as much data as a verified one: none.
 */

/**
 * What this console honestly knows about the operator session.
 *
 * There is no `verified` member, and its absence is the point. Adding one is a
 * contract change, not a client change — see `WHEN THE CONTRACT LANDS` below.
 */
export type PlatformSessionKnowledge =
  /** No sign-in has happened in this tab. The sign-in screen is correct. */
  | 'no-session-in-this-tab'
  /**
   * Someone signed in during this tab's lifetime and Core answered `200`.
   * WHETHER THAT SESSION IS STILL LIVE IS UNKNOWN AND UNKNOWABLE TODAY.
   */
  | 'signed-in-unverified';

/**
 * Why verification is unavailable, in one sentence, for the header banner.
 *
 * A CONSTANT RATHER THAN A COMPUTED VALUE, because there is exactly one reason
 * and inventing a second would imply a code path that could produce it.
 */
export const VERIFICATION_UNAVAILABLE_REASON =
  'This console cannot confirm with Core that your session is still live. The route that would ' +
  'answer it — platform.session.whoami — is specified in platform-operator-v1 but that contract ' +
  'is still proposed, and no agreed contract lets a principal with no Organization verify itself. ' +
  'You are signed in as far as this browser tab knows. Core still authorizes every request.';

/**
 * ===========================================================================
 * WHEN THE CONTRACT LANDS, THIS IS THE WHOLE OF THE CHANGE
 * ===========================================================================
 *
 * Once `platform-operator-v1` is accepted and `platform.session.whoami` is
 * implemented, replace this file's contents with a real probe:
 *
 *   1. `GET ${CONFIG.apiBaseUrl}/api/v1/platform/whoami`, `credentials:
 *      'same-origin'`, no body, no query parameters — the contract says "No
 *      body, no query parameters, no path parameters."
 *   2. `200`  -> signed in, verified. The body carries the operator's own
 *      principal id, platform role and effective permission list.
 *   3. `401`  -> signed out. `docs/decisions/0018` requires a `401` to be read as
 *      SIGNED OUT and never as a transient failure to retry.
 *   4. `403`  -> AUTHENTICATED BUT NOT AN OPERATOR, and this is the case worth
 *      getting right. `platform-operator-v1` collapses FOUR conditions into one
 *      argument-free `forbidden` — no `platform_operator` row, an unrecognised
 *      role, a role lacking the permission, or a principal present in BOTH
 *      tables — and they are indistinguishable on purpose, "because a caller
 *      able to detect the mutual-exclusion refusal could use these routes to
 *      probe organization_membership." The console must not guess which; it says
 *      the call was refused and stops.
 *   5. ANYTHING ELSE -> unknown. An unreachable server does not mean an absent
 *      session, and rendering it as one would sign an operator out during a
 *      brief outage.
 *
 * TWO THINGS TO CARRY ACROSS RATHER THAN REDISCOVER:
 *
 *   - `whoami` DECLARES `audit: required`, so every probe writes an audit
 *     record. A probe on every reload, or worse on an interval, is an audit log
 *     of nothing that buries the operator actions the log exists for. Probe once
 *     per page load and on an explicit retry — never on a timer.
 *   - THE PERMISSION LIST IT RETURNS IS FOR RENDERING ONLY. The contract says so
 *     in the same breath as returning it: "UI HIDING IS PRESENTATION, NEVER
 *     SECURITY (0007 D8)... every permission it reports is enforced again by Core
 *     on the call itself, and a console that hid nothing would be ugly and
 *     equally safe." Never branch an authorization decision on it.
 */
export function describeVerificationGap(): string {
  return VERIFICATION_UNAVAILABLE_REASON;
}
