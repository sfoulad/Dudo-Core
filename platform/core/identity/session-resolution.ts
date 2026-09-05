/**
 * ===========================================================================================
 * THE RESOLUTION ORDER. `docs/decisions/0014` §C.5, normative, implemented in one place.
 * ===========================================================================================
 *
 *   session -> principal -> memberships -> authorized Organization/business context ->
 *   TenantStoreResolver -> business data
 *
 * The first four steps are this file. `TenantStoreResolver` is the step after it and is reached
 * by the pipeline, unchanged, through the seam that already existed: this service produces a
 * sealed `AuthenticatedPrincipal`, and everything downstream — the pipeline, the storage
 * boundary, the audit sink, the cursor codec — carries on exactly as it did. Part C adds a
 * beginning to the request; it changes nothing after it.
 *
 * ===========================================================================================
 * THE THREE RULINGS IN THIS FILE, EACH OF WHICH IS A SECURITY PROPERTY RATHER THAN A BEHAVIOUR
 * ===========================================================================================
 *
 * 1. AN ORGANIZATION NAMED BY A CALLER IS A HINT, AND A NON-MEMBER LEARNS NOTHING (§C.6).
 *
 *    `selectOrganization` is the only place in the platform where a caller names a tenant. The
 *    requirement is that a caller naming an Organization it does not belong to be
 *    INDISTINGUISHABLE from one naming an Organization that does not exist — otherwise
 *    membership lookup is an Organization-existence oracle across the whole platform.
 *
 *    It is not enough to return the same error code. The same WORK has to happen, or the
 *    difference reappears as a timing signal and as a query count. So the port exposes exactly
 *    one method for this — `findMembershipWithOrganization` — whose implementation contract is
 *    that it DOES NOT QUERY THE ORGANIZATION TABLE WHEN THERE IS NO MEMBERSHIP ROW
 *    (`control-plane-store.ts`, and the adapter is written to it). Both cases are then one
 *    statement against one table returning zero rows, and both return `notFound()`, which takes
 *    no arguments and so has nothing to vary (`kernel/errors.ts`).
 *
 *    A SUSPENDED MEMBERSHIP RETURNS THE SAME `notFound()`, and that is a deliberate choice with
 *    a cost. A member whose membership is suspended already knows the Organization exists, so a
 *    distinct answer would disclose nothing to them — the branch is unreachable for a
 *    non-member. It is still collapsed, because one answer is one branch, and a second branch
 *    here is a second thing a later edit can get subtly wrong for a small usability gain. The
 *    cost is that a suspended user is told "not found" rather than why. Recorded, not hidden.
 *
 * 2. MEMBERSHIP IS RE-VALIDATED ON EVERY REQUEST, NOT ONLY WHEN IT IS SELECTED.
 *
 *    The session row remembers which Organization was chosen. If that were trusted for the
 *    session's lifetime, REVOKING SOMEONE'S MEMBERSHIP WOULD NOT TAKE EFFECT UNTIL THEIR SESSION
 *    EXPIRED — a removed employee keeping access to a tenant's books for hours. So `resolve`
 *    reads the membership every time. It costs one indexed point read per request against a
 *    daily row-read allowance fifty times larger than the write allowance
 *    (`docs/operations/free-tier-register.md`), which is the right side of that trade.
 *
 *    A membership that has gone away, or gone suspended, does not fail the request as an error:
 *    it collapses the session to `organization-not-selected`, the same state a fresh multi-
 *    Organization session is in. Access ends immediately and the client is told to choose again.
 *
 * 3. NOTHING ON THE AUTHENTICATION PATH WRITES TO D1.
 *
 *    `resolve` performs reads only. No last-seen column, no sliding expiry, no login audit row,
 *    no lazy delete of an expired session. Each of those is a write that an UNAUTHENTICATED or
 *    barely-authenticated caller can trigger at its own rate, which is precisely the shape
 *    `docs/decisions/0013` closed for denied reads and `0014` §A closed for creates. A session
 *    is written when one is created, and at no other time.
 *
 *    A CONSEQUENCE THAT CONSTRAINS THE UNDECIDED IDENTITY-PROVIDER DECISION, and it is better
 *    said here than discovered later: A SLIDING-EXPIRY "SESSION REFRESH" IS UNAFFORDABLE. `0014`
 *    §B lists session refresh among the permitted pre-authentication entry points; if refresh
 *    extends the session it is a D1 write per refresh, on a path with no authorization above it,
 *    and the daily budget cannot carry it. `expiresAt` is absolute here and nothing extends it.
 *
 * ===========================================================================================
 * WHAT THIS FILE DOES NOT DECIDE, AND MUST NOT
 * ===========================================================================================
 *
 * ===========================================================================================
 * ONE TIME SOURCE, AND IT IS THE SERVER'S CLOCK — NOT A PARAMETER
 * ===========================================================================================
 *
 * No method here takes a `nowMs`. Every instant this module needs — the expiry comparison, the
 * admission day, the timestamps on a new session — comes from the injected `Clock` and from
 * nothing else.
 *
 * THAT IS A SECURITY PROPERTY, NOT TIDINESS. A caller-supplied instant reaching the expiry
 * comparison is an expired session made live by an argument, which is the same class of defect
 * as a caller-supplied tenant identifier: a security decision derived from something the caller
 * can vary. Withholding the parameter is the same device `ActionContext` uses for the
 * organization identifier — there is no value to pass, so no call site can pass the wrong one.
 *
 * It also removes a divergence that a verification harness caught in an earlier draft of this
 * file: an admission reserved against one instant and a row written with another are two
 * different days at a UTC boundary.
 *
 * THE CREDENTIAL FORMAT AND THE IDENTITY PROVIDER. `0014` §C does not settle them, and this
 * module is written so it does not force the choice. It takes a `sessionId` that some verifier
 * produced and returns a principal; how a bearer credential becomes that identifier, what signs
 * it, and what stores it are not here, are not implied here, and are not implemented anywhere in
 * this repository. `issueSession` is the same: it takes a principal identifier that the CALLER
 * has already verified, and there is no verifier in this repository to do that verifying.
 *
 * The practical effect is unchanged from before Part C: with no credential verifier configured,
 * nothing can obtain a session identifier, so nothing authenticates and the platform serves
 * nothing. That is fail-closed and it is the correct state.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CoreError } from '../kernel/errors.ts';
import { internal, notFound, quotaExceeded, unauthenticated, unavailable } from '../kernel/errors.ts';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import { sealAuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type {
  ControlPlanePrincipalType,
  IdentityControlPlaneStore,
  SessionRecord,
} from './control-plane-store.ts';
import type { PrincipalAuthorizationSource } from './principal-authorization-source.ts';
import type { ControlPlaneWriteAdmission } from './control-plane-admission.ts';
import { SESSION_ROW_WRITES } from './control-plane-admission.ts';

/**
 * The most Organizations `listEnterableOrganizations` will return.
 *
 * Required rather than unlimited, for the reason `SelectSpec.limit` is: on a single-threaded
 * database an unbounded read is every Organization's latency. A principal belonging to more than
 * this many Organizations sees a truncated list, which is a product problem to solve with
 * pagination and not a reason to remove the bound.
 */
export const MAX_ENTERABLE_ORGANIZATIONS = 100;

/**
 * The longest a session may live. Twenty-four hours.
 *
 * ===========================================================================================
 * THIS IS AN UPPER BOUND ON A CHOICE, NOT THE CHOICE. `0014` §C DOES NOT SET A SESSION LIFETIME.
 * ===========================================================================================
 *
 * `createSessionResolver` therefore REQUIRES `sessionLifetimeMs` — there is no default, so a
 * composition root has to state a value and a reviewer can see which one it stated. The bound
 * here exists so that "no default" cannot become "whatever was passed": a lifetime longer than a
 * day, combined with ruling 3 above (nothing extends a session), is a credential that outlives
 * the day's evidence and cannot be shortened without a deploy.
 */
export const MAX_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export class SessionLifetimeOutOfRangeError extends Error {
  constructor(value: number) {
    super(
      `A session lifetime of ${String(value)} ms is not permitted: it must be a positive ` +
        `integer no greater than ${String(MAX_SESSION_LIFETIME_MS)} ms. docs/decisions/0014 §C ` +
        'does not set a session lifetime, so the composition root must choose one explicitly; ' +
        'this bound only stops the choice being unbounded.',
    );
    this.name = 'SessionLifetimeOutOfRangeError';
  }
}

/**
 * What resolution produced.
 *
 * `organization-not-selected` IS NOT AN ERROR AND MUST NOT BE RENDERED AS ONE TO THE POINT OF
 * hiding it. It is the ordinary state of a valid session belonging to a principal who has not
 * chosen — or may no longer enter — an Organization. A client's correct response is to call the
 * Organization picker and then `selectOrganization`.
 *
 * It carries the `principalId` and NOTHING ELSE — no Organization identifier, no membership
 * list, no count. A caller that wants the list asks for it explicitly, through a session it
 * holds.
 */
export type SessionResolution =
  | { readonly kind: 'authenticated'; readonly principal: AuthenticatedPrincipal }
  | { readonly kind: 'organization-not-selected'; readonly principalId: string };

export type SessionResolver = {
  /**
   * §C.5 steps 1 to 4. Reads only; see ruling 3.
   *
   * Returns `unauthenticated()` — the single, argument-free value — for a session identifier
   * that does not exist, one that has expired, one whose principal has been deleted, and one
   * whose principal is suspended. Four conditions, one answer, nothing to tell apart.
   */
  resolve(sessionId: string): Promise<Result<SessionResolution>>;

  /**
   * §C.5 steps 1 and 2 ONLY: the principal behind a live session, and nothing else.
   *
   * ===========================================================================================
   * ADDED FOR THE PLATFORM ROUTE CLASS (`docs/decisions/0025`), AND ITS RETURN TYPE IS THE POINT.
   * ===========================================================================================
   *
   * A platform route is authenticated AT PRINCIPAL LEVEL and has NO TENANT. `resolve` above is
   * the wrong tool for it three times over:
   *
   *   - it CONSTRUCTS AN `AuthenticatedPrincipal`, which carries an `organizationId` and is the
   *     value `TenantStoreResolver` consumes. Handing one to the platform class would put a tenant
   *     identifier inside a class whose binding property P1 is that it can reach none;
   *   - it reads membership and calls the authorization source, which is work a platform route
   *     needs none of; and
   *   - for a principal that HAS selected an Organization it can answer `unavailable()` when that
   *     Organization is suspended, which would make a platform request's outcome depend on the
   *     state of a tenant it has nothing to do with — and would give a principal wrongly present
   *     in both tables a THIRD observable answer, breaking the mutual exclusion's collapse.
   *
   * SO THIS RETURNS A STRING. There is no organization, no membership list, no grant set and no
   * principal object in the return value, and therefore nothing for a caller to extract a tenant
   * from. `liveSession` is reused rather than reimplemented, so the expiry rule, the suspended-
   * principal rule and the single argument-free `unauthenticated()` collapse are identical to
   * every other authenticated path — two authentication floors that were meant to be identical
   * are two floors that will differ.
   *
   * IT PERFORMS NO WRITE, like everything else on this path (ruling 3).
   */
  resolvePrincipalId(sessionId: string): Promise<Result<string>>;

  /**
   * The Organizations this principal may enter, for an Organization picker.
   *
   * Returns identifiers only, because the control plane holds no Organization name — see
   * `OrganizationRecord`. Reaching this requires a valid session for the principal, which is
   * what keeps `core-object-registry.yaml` open question CO1 answerable: the list goes to the
   * principal, never to an Organization.
   */
  listEnterableOrganizations(sessionId: string): Promise<Result<readonly string[]>>;

  /**
   * §C.6. Validates a caller-supplied Organization against membership and records the selection
   * on the session. See ruling 1 for what a caller observes in each case.
   *
   * THIS WRITES, so it reserves daily capacity first and can be deferred with `quota_exceeded`.
   */
  selectOrganization(input: {
    readonly sessionId: string;
    /** A HINT. Never trusted as an assertion. */
    readonly requestedOrganizationId: string;
  }): Promise<Result<void>>;

  /**
   * Creates a session for a principal whose credential the CALLER HAS ALREADY VERIFIED.
   *
   * ===========================================================================================
   * THERE IS NO CREDENTIAL VERIFIER IN THIS REPOSITORY, AND NOTHING CALLS THIS.
   * ===========================================================================================
   *
   * It is the half of login that `0014` §C does decide — a session is a principal-scoped
   * control-plane record, written under an admission reservation. The half it does not decide —
   * what proves the principal is who it claims — is absent, so this function is unreachable in
   * practice and is stated as such rather than left to look usable.
   *
   * `requestedOrganizationId` is a HINT here exactly as it is in `selectOrganization`, and is
   * validated identically: a login naming an Organization the principal does not belong to
   * creates NO session and returns `notFound()`, indistinguishable from one naming an
   * Organization that does not exist.
   */
  issueSession(input: {
    /** Server-derived from a verified credential. Never taken from a request field. */
    readonly verifiedPrincipalId: string;
    /** A HINT, or `null` for a session with no Organization selected yet. */
    readonly requestedOrganizationId: string | null;
  }): Promise<Result<SessionRecord>>;

  /**
   * Ends a session. Logout.
   *
   * ===========================================================================================
   * IT ANSWERS THE SAME THING WHETHER IT REVOKED SOMETHING OR NOTHING, AND THAT IS THE POINT.
   * ===========================================================================================
   *
   * `pre-auth-registry.ts` makes `identity.session.revoke` `disclosure: 'collapsed'` for a reason
   * that is easy to miss and is restated here because this is the function that could break it:
   *
   *   *"A logout that answered 'no such session' for an unknown token and 'done' for a real one
   *   is a TOKEN-VALIDITY ORACLE: an attacker holding a stolen or guessed token learns whether it
   *   is live without using it."*
   *
   * So a session identifier that does not exist, one that has expired, and one that was deleted a
   * moment ago all return `ok`. The only errors this can produce are Dudo-side — a store failure
   * or an exhausted daily budget — and the handler collapses those too.
   *
   * IT PERFORMS NO WRITE WHEN THERE IS NOTHING TO DELETE, which is what keeps an unauthenticated
   * caller from spending D1 capacity. A forged credential never reaches this function at all: the
   * MAC is checked first (`session-credential.ts`), so it costs one HMAC and no database read.
   *
   * THE PRINCIPAL FOR THE RESERVATION COMES FROM THE SESSION ROW, never from the caller. That is
   * what `ControlPlaneWriteAdmission.reserve` requires — a principal identifier that is
   * server-derived from a verified credential — and reading the row first is the only way to
   * obtain one here.
   */
  revokeSession(sessionId: string): Promise<Result<void>>;
};

export type SessionResolverDependencies = {
  readonly store: IdentityControlPlaneStore;
  readonly authorization: PrincipalAuthorizationSource;
  readonly admission: ControlPlaneWriteAdmission;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** No default. See MAX_SESSION_LIFETIME_MS. */
  readonly sessionLifetimeMs: number;
};

/** RFC 3339 strings from `toRfc3339Utc` are lexicographically ordered, so this is a comparison. */
function isExpired(session: SessionRecord, nowMs: number): boolean {
  return session.expiresAt <= toRfc3339Utc(nowMs);
}

/**
 * The refusal for a principal present in BOTH `platform_operator` and `organization_membership`.
 *
 * ===========================================================================================
 * A NAMED INTERNAL MARKER. "An internal error type is not a wire code" — Team Lead ruling,
 * 2026-09-05. THE WIRE CODE IT RENDERS TO IS A PROPERTY OF THE REQUEST CLASS, NOT OF THE RULE.
 * ===========================================================================================
 *
 * `platform-operator-v1` states BOTH halves, in two different sections, and they name two
 * different codes:
 *
 *   §`errors.forbidden`      — on a PLATFORM ROUTE, four causes including this one receive "the
 *                              identical argument-free forbidden. The four are indistinguishable."
 *   §`testRequirements`      — "denied on every platform route AND on every Action, WITH CODES
 *                              IDENTICAL TO AN UNKNOWN PRINCIPAL."
 *
 * On the Action path an unknown principal receives `unauthenticated` — that is `liveSession`'s
 * existing four-way collapse, which §`errors.unauthenticated` describes as "unchanged". So the
 * contract asks for `forbidden` on one class and `unauthenticated` on the other, and BOTH are
 * satisfied only by rendering per class:
 *
 *   PLATFORM ROUTES  `forbidden`      — applied by `platform/platform-authority.ts`, which
 *                                       `resolvePrincipalId` defers to. It also equalises the
 *                                       WORK across all four causes, which refusing here could
 *                                       not: this function has issued two statements, and the
 *                                       other three causes issue two more.
 *   ACTION PATH      `unauthenticated` — applied below, joining the four conditions this function
 *                                       already collapses.
 *
 * NEITHER CHOICE IS A GLOBALLY TIGHTER COLLAPSE, WHICH IS WHY THE CLASS DECIDES. Whichever code
 * is used, it hides among that path's refusals and stands out from the other path's. What matters
 * is that within each class the causes are indistinguishable from one another, and per-class
 * rendering is the only arrangement that achieves that on both.
 *
 * SO WHAT DOES THE NAME BUY, given each value is an ordinary shared constant? One grep. This is
 * the state that "means something is already wrong" — unreachable through Dudo's own code, so a
 * principal that lands here arrived through direct database access, a partially applied migration,
 * or a restore from two backups taken at different moments. When an alerting channel exists, THIS
 * is the call site it hooks, and it is already named and already in one place.
 *
 * IT IS DELIBERATELY NOT A NEW `ErrorCode`. `kernel/errors.ts`'s taxonomy is closed and is
 * contract surface (`packages/contracts/common/error-envelope.schema.json`) that this agent does
 * not author; and a distinct code would be exactly the distinguishing signal both collapses exist
 * to remove. The marker is internal in the only sense that matters — it names the branch, not the
 * response.
 *
 * THE PLATFORM CLASS'S RENDERING IS NOT IN THIS FILE, AND IS DELIBERATELY NOT AN EXPORT HERE.
 * `platform/platform-authority.ts` refuses the state itself, with `forbidden()`, from its OWN two
 * reads — which is what equalises the work across all four platform causes as well as the value.
 * An exported-but-uncalled sibling here would be a second definition nothing invokes, which is the
 * shape `M-1` already flags elsewhere in this slice; a pointer costs nothing and cannot rot into
 * dead code.
 */
function authorityConflictRefusal(): CoreError {
  return unauthenticated();
}

export function createSessionResolver(
  dependencies: SessionResolverDependencies,
): SessionResolver {
  const { store, authorization, admission, ids, clock, sessionLifetimeMs } = dependencies;

  if (
    !Number.isInteger(sessionLifetimeMs) ||
    sessionLifetimeMs < 1 ||
    sessionLifetimeMs > MAX_SESSION_LIFETIME_MS
  ) {
    throw new SessionLifetimeOutOfRangeError(sessionLifetimeMs);
  }

  /**
   * Steps 1 and 2, shared by every entry point.
   *
   * ONE ANSWER FOR EVERY FAILURE, and it is `unauthenticated()`. A caller cannot learn from it
   * whether the identifier was never issued, has expired, or belongs to a suspended principal.
   * All three are facts about the caller's own credential, so the collapse costs nothing and
   * removes three branches that could otherwise drift apart.
   */
  /**
   * Steps 1 and 2 WITHOUT the mutual-exclusion refusal, returning the two flags instead.
   *
   * ===========================================================================================
   * IT EXISTS BECAUSE THE REFUSAL'S *CODE* IS A PROPERTY OF THE REQUEST CLASS, NOT OF THE RULE.
   * ===========================================================================================
   *
   * `platform-operator-v1` requires the four platform denial causes — no operator row, an
   * unrecognised role, a role lacking the permission, and A PRINCIPAL IN BOTH TABLES — to be
   * INDISTINGUISHABLE FROM ONE ANOTHER, and the value it names is `forbidden`. The Action path's
   * "unknown principal" collapse is `unauthenticated`. **The same rule therefore has to answer
   * with two different codes depending on who is asking**, or one of the two collapses breaks.
   *
   * `qa-agent` caught exactly that: an earlier version of this file refused inside `liveSession`,
   * so a both-tables principal received `unauthenticated` on a platform route where the contract
   * requires `forbidden` — which made the fourth cause distinguishable from the other three by
   * status code alone, and re-opened the probe the collapse exists to close.
   *
   * SO THE FACT IS PRODUCED HERE AND THE REFUSAL IS APPLIED BY THE CALLER. There are exactly two
   * callers, they are both immediately below, and neither can forget: `liveSession` refuses with
   * the Action code, and `resolvePrincipalId` hands the principal to
   * `platform/platform-authority.ts`, which refuses with the platform code and with equalised work.
   */
  async function liveSessionUnrefused(
    sessionId: string,
  ): Promise<
    Result<{
      session: SessionRecord;
      principalId: string;
      principalType: ControlPlanePrincipalType;
      inBothTables: boolean;
    }>
  > {
    const found = await store.findSession(sessionId);
    if (!found.ok) {
      return err(found.error);
    }
    const session = found.value;
    if (session === null || isExpired(session, clock.nowMs())) {
      return err(unauthenticated());
    }
    const principalOutcome = await store.findPrincipal(session.principalId);
    if (!principalOutcome.ok) {
      return err(principalOutcome.error);
    }
    const principal = principalOutcome.value;
    if (principal === null || principal.status !== 'active') {
      return err(unauthenticated());
    }
    return ok({
      session,
      principalId: principal.principalId,
      principalType: principal.principalType,
      // THE CONJUNCTION, COMPUTED ONCE. Writing it as either flag alone is the mistake to avoid:
      // `isPlatformOperator` alone locks out every legitimate operator, `holdsMembership` alone
      // refuses every ordinary user. Only the pair is the defect. Both come from the
      // `findPrincipal` statement that already ran, so this costs no read.
      inBothTables: principal.isPlatformOperator && principal.holdsMembership,
    });
  }

  async function liveSession(
    sessionId: string,
  ): Promise<
    Result<{
      session: SessionRecord;
      principalId: string;
      principalType: ControlPlanePrincipalType;
    }>
  > {
    const live = await liveSessionUnrefused(sessionId);
    if (!live.ok) {
      return err(live.error);
    }
    const { session, principalId, principalType, inBothTables } = live.value;

    // =========================================================================================
    // THE MUTUAL EXCLUSION, ACTION SIDE. `docs/decisions/0025` decision 1 · `docs/decisions/0024`
    // as amended 2026-09-05 · `platform-operator-v1`, `theMutualExclusionInvariant`.
    // =========================================================================================
    //
    // "A PRINCIPAL APPEARING IN BOTH IS REFUSED EVERYWHERE — not resolved in favour of either, not
    // treated as a platform operator, not treated as a tenant member. BOTH ITS PLATFORM ROUTES AND
    // ITS ACTIONS DENY."
    //
    // The platform half is `platform/platform-authority.ts`, which refuses the same state with
    // `forbidden` because that is ITS class's collapse. THIS IS THE ACTION HALF, and it covers
    // every entry point that goes through `liveSession`: `resolve`, `listEnterableOrganizations`
    // and `selectOrganization`. `resolvePrincipalId` deliberately does NOT — see
    // `liveSessionUnrefused` above, and see below for why that is not a gap.
    //
    // THE CODE IS THIS CLASS'S, NOT THE RULE'S — see `authorityConflictRefusal`. On the Action
    // path an unknown principal receives `unauthenticated`, and `platform-operator-v1`
    // §`testRequirements` requires this refusal to carry "codes identical to an unknown
    // principal". The platform class renders the SAME marker as `forbidden`, because that is the
    // value its own four-way collapse uses.
    //
    // THE CONSOLE LOOP THE TEAM LEAD IDENTIFIED IS ON THE PLATFORM SIDE AND IS CLOSED THERE:
    // `admin-shell` maps 401 to "anonymous" and renders the sign-in form, which for a principal
    // that will be refused again "builds a loop that cannot terminate". The admin console reaches
    // Core ONLY through platform routes, and those answer `forbidden`, which `admin-shell` gives a
    // screen of its own.
    //
    // IT COSTS NOTHING EXTRA. Both flags come from the `findPrincipal` statement that already ran;
    // see `d1-control-plane-store.ts`. This is not a new read.
    //
    // *** REACHING THIS BRANCH MEANS SOMETHING IS ALREADY WRONG. *** Dudo's own code cannot create
    // the state — `0010`'s four triggers refuse it on INSERT and UPDATE in both directions,
    // verified against a real D1 — so a principal that lands here arrived by direct database
    // access, a partially applied migration, or a restore from two backups taken at different
    // moments. Those are exactly the three cases `0025` names as the reason the authorization
    // check exists at all, and they are why this is not dead code.
    if (inBothTables) {
      return err(authorityConflictRefusal());
    }

    return ok({ session, principalId, principalType });
  }

  /**
   * §C.6, factored out because `selectOrganization` and `issueSession` must apply it identically.
   * Two call sites applying the hint rule two ways is how the oracle gets built.
   *
   * `notFound()` covers: no membership row, and a membership that is not active. See ruling 1.
   * `unavailable()` covers a suspended Organization, and is reachable ONLY by an active member
   * of it — a non-member never gets past the membership check, so this branch discloses the
   * Organization's state to someone who already knows it exists.
   */
  async function validateHint(
    principalId: string,
    requestedOrganizationId: string,
  ): Promise<Result<void>> {
    const outcome = await store.findMembershipWithOrganization(
      principalId,
      requestedOrganizationId,
    );
    if (!outcome.ok) {
      return err(outcome.error);
    }
    const found = outcome.value;
    if (found === null || found.membership.status !== 'active') {
      return err(notFound());
    }
    if (found.organization.status !== 'active') {
      return err(unavailable());
    }
    return ok(undefined);
  }

  return {
    async resolve(sessionId: string): Promise<Result<SessionResolution>> {
      const live = await liveSession(sessionId);
      if (!live.ok) {
        return err(live.error);
      }
      const { session, principalId, principalType } = live.value;

      // ---- Step 3. No Organization selected. Not an error; see `SessionResolution`.
      const organizationId = session.activeOrganizationId;
      if (organizationId === null) {
        return ok({ kind: 'organization-not-selected', principalId });
      }

      // ---- Step 4. Re-validate membership. Ruling 2: revocation takes effect now, not at
      // expiry. A membership that is gone or suspended collapses the session to unselected
      // rather than erroring, so the client's next move is to choose again.
      const membershipOutcome = await store.findMembershipWithOrganization(
        principalId,
        organizationId,
      );
      if (!membershipOutcome.ok) {
        return err(membershipOutcome.error);
      }
      const found = membershipOutcome.value;
      if (found === null || found.membership.status !== 'active') {
        return ok({ kind: 'organization-not-selected', principalId });
      }
      if (found.organization.status !== 'active') {
        return err(unavailable());
      }

      // ---- The authorized Organization/business context. Answered by nothing today; see
      // `principal-authorization-source.ts` for why, and for what fails closed as a result.
      const authorized = await authorization.resolve({
        principalId,
        principalType,
        membership: found.membership,
      });
      if (!authorized.ok) {
        return err(authorized.error);
      }

      // The ONE construction of an `AuthenticatedPrincipal` in the platform's request path.
      // `organizationId` is the value that was just validated against membership — never a
      // value that arrived on this request.
      return ok({
        kind: 'authenticated',
        principal: sealAuthenticatedPrincipal({
          principalId,
          principalType,
          organizationId,
          // ===================================================================================
          // EMPTY HERE, AND COMPLETED BY THE PIPELINE. `docs/decisions/0020`.
          //
          // This is §C.5's authorized ORGANIZATION context. The authorized BUSINESS set is the
          // step after `TenantStoreResolver`, because it is a read of the tenant's own `business`
          // table and there is no tenant store at this point in the order. `0020` calls this a
          // SPLIT rather than a reordering, and the distinction matters: nothing about when
          // authorization happens has moved. Two things with different dependencies were bundled
          // into one step, and they are now two steps.
          //
          // Leaving it empty is safe in the only direction that counts — a principal that somehow
          // reached a handler without being completed is authorized over nothing.
          // ===================================================================================
          authorizedBusinessIds: [],
          businessScope: 'organization',
          grants: authorized.value.grants,
          // Delegation is `AUTHORIZATION_STANDARD.md` §11 and is not part of `0014` §C. A
          // session cannot express "acting for", and inventing a column for it here would be
          // deciding the delegation model in a login.
          onBehalfOfPrincipalId: null,
        }),
      });
    },

    async resolvePrincipalId(sessionId: string): Promise<Result<string>> {
      // Steps 1 and 2, and then it STOPS. No membership read, no authorization source, no
      // `AuthenticatedPrincipal`, no organization identifier — see the port's documentation for
      // why each of those absences matters to the class that calls this.
      //
      // =====================================================================================
      // IT USES `liveSessionUnrefused`, SO A BOTH-TABLES PRINCIPAL IS **NOT** REFUSED HERE. THAT
      // IS DELIBERATE AND IT IS THE OPPOSITE OF A GAP.
      // =====================================================================================
      //
      // The only caller is the platform route class, and `platform/platform-authority.ts` refuses
      // that principal one step later with `forbidden` — the value `platform-operator-v1` names,
      // identical to the other three platform denial causes, from the same two statements so the
      // work is equal too.
      //
      // REFUSING HERE INSTEAD WOULD ANSWER `unauthenticated`, WHICH IS A DIFFERENT STATUS CODE
      // FROM THE OTHER THREE CAUSES — and a caller that can tell "I am in both tables" from "I
      // have no operator row" can use a platform route to probe `organization_membership`, which
      // is precisely the probe the contract's four-way collapse exists to close. `qa-agent` caught
      // that regression; this line is the fix.
      //
      // THE PRINCIPAL IS NEVER *ADMITTED* BY THIS FUNCTION. It returns an identifier, and an
      // identifier grants nothing: every platform route resolves authority before it does anything
      // else, and there is no path from here to a handler that skips it.
      const live = await liveSessionUnrefused(sessionId);
      if (!live.ok) {
        return err(live.error);
      }
      return ok(live.value.principalId);
    },

    async listEnterableOrganizations(sessionId: string): Promise<Result<readonly string[]>> {
      const live = await liveSession(sessionId);
      if (!live.ok) {
        return err(live.error);
      }
      const memberships = await store.listMembershipsForPrincipal(
        live.value.principalId,
        MAX_ENTERABLE_ORGANIZATIONS,
      );
      if (!memberships.ok) {
        return err(memberships.error);
      }
      const enterable: string[] = [];
      for (const membership of memberships.value) {
        if (membership.status === 'active') {
          enterable.push(membership.organizationId);
        }
      }
      return ok(enterable);
    },

    async selectOrganization(input): Promise<Result<void>> {
      const live = await liveSession(input.sessionId);
      if (!live.ok) {
        return err(live.error);
      }
      const { principalId } = live.value;

      // §C.6. THE HINT IS VALIDATED BEFORE ANY CAPACITY IS RESERVED AND BEFORE ANY WRITE.
      //
      // The order matters for the same reason `0014` records that the budget check must never
      // move below pipeline step 5: if reservation came first, a caller could exhaust its own
      // per-principal daily budget — which it controls completely — and thereafter distinguish
      // `quota_exceeded` ("I am a member of this Organization") from `not_found` ("I am not").
      // That is an Organization-existence oracle built out of a capacity control and switched on
      // at will by the attacker. Validating first means a non-member is refused before the
      // budget is consulted at all, so the budget's state can never depend on membership.
      const valid = await validateHint(principalId, input.requestedOrganizationId);
      if (!valid.ok) {
        return err(valid.error);
      }

      const admitted = await admission.reserve({
        principalId,
        estimatedRowWrites: SESSION_ROW_WRITES,
        nowMs: clock.nowMs(),
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        return err(quotaExceeded());
      }

      return store.setSessionActiveOrganization(
        input.sessionId,
        input.requestedOrganizationId,
        admitted.value.reservation,
      );
    },

    async issueSession(input): Promise<Result<SessionRecord>> {
      const principalOutcome = await store.findPrincipal(input.verifiedPrincipalId);
      if (!principalOutcome.ok) {
        return err(principalOutcome.error);
      }
      const principal = principalOutcome.value;
      if (principal === null || principal.status !== 'active') {
        // The caller said it verified a credential for a principal the control plane does not
        // hold, or holds as suspended. Fail closed and disclose nothing.
        return err(unauthenticated());
      }
      // THE MUTUAL EXCLUSION AT LOGIN. `issueSession` reads the principal directly rather than
      // through `liveSession` — it has no session yet — so the check is repeated here rather than
      // inherited. Without it a principal in both tables would be refused on every subsequent
      // request and still receive a session cookie at login, which is the confusing half of a
      // refusal rather than a milder one. Same conjunction, same argument-free
      // `unauthenticated()`, same statement it was already read from. See `liveSession`.
      if (principal.isPlatformOperator && principal.holdsMembership) {
        return err(authorityConflictRefusal());
      }

      // The hint, validated before anything is reserved or written — same ordering argument as
      // `selectOrganization`, and the same three observable cases.
      if (input.requestedOrganizationId !== null) {
        const valid = await validateHint(principal.principalId, input.requestedOrganizationId);
        if (!valid.ok) {
          return err(valid.error);
        }
      }

      const admitted = await admission.reserve({
        principalId: principal.principalId,
        estimatedRowWrites: SESSION_ROW_WRITES,
        nowMs: clock.nowMs(),
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        return err(quotaExceeded());
      }

      // `nowMs()`, NOT `now()`. `Clock` exposes both — an RFC 3339 string and epoch
      // milliseconds — and an earlier draft of this file used the string, concatenated the
      // lifetime onto it, and produced a session whose `expiresAt` was nonsense. It failed
      // closed, as `internal`, and it was caught by the verification harness rather than by
      // review. Noted because the two accessors are one character apart and the wrong one
      // type-checks in a template.
      const createdAtMs = clock.nowMs();
      const expiresAtMs = createdAtMs + sessionLifetimeMs;
      if (!Number.isFinite(expiresAtMs)) {
        return err(internal());
      }

      // 128 opaque bits from the platform CSPRNG (`kernel/ids.ts`) — not a counter, not a
      // timestamp, not derived from the principal. A session identifier that could be guessed
      // or ordered would be a session that could be stolen without a credential.
      const record: SessionRecord = {
        sessionId: ids.generate(),
        principalId: principal.principalId,
        activeOrganizationId: input.requestedOrganizationId,
        createdAt: toRfc3339Utc(createdAtMs),
        expiresAt: toRfc3339Utc(expiresAtMs),
      };

      const written = await store.createSession(record, admitted.value.reservation);
      if (!written.ok) {
        return err(written.error);
      }
      return ok(record);
    },

    async revokeSession(sessionId: string): Promise<Result<void>> {
      // ---- The row is read first, and NOT through `liveSession`.
      //
      // `liveSession` refuses an expired session and a suspended principal, which is right for
      // authentication and wrong here. A SUSPENDED PRINCIPAL MUST STILL BE ABLE TO HAVE ITS
      // SESSION DELETED — suspension is exactly when you want the live credential gone — and an
      // expired session's row is still a row that retention would otherwise have to collect.
      // Reading directly keeps logout working in both states.
      const found = await store.findSession(sessionId);
      if (!found.ok) {
        return err(found.error);
      }
      const session = found.value;
      if (session === null) {
        // NOTHING TO DELETE, AND NO WRITE. This is the branch an attacker with a guessed
        // identifier reaches, and it must cost nothing and disclose nothing. `ok` is returned
        // rather than an error precisely so that a caller cannot tell it apart from a successful
        // revocation — the token-validity oracle above.
        return ok(undefined);
      }

      // A DELETE COSTS THE SAME 3 ROW-WRITES AS AN INSERT, and the reason is worth keeping next
      // to the number: removing a row removes its entry from EVERY index, so the table row, the
      // primary key and `session_by_principal` are all written. `control-plane-admission.ts`
      // records it as "session revocation — 1 statement, 3 true, 3 charged, exact".
      const admitted = await admission.reserve({
        principalId: session.principalId,
        estimatedRowWrites: SESSION_ROW_WRITES,
        nowMs: clock.nowMs(),
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        // THE DAILY CEILING CAN REFUSE A LOGOUT, and that is a genuine consequence rather than an
        // oversight: at the platform ceiling nothing writes, including this. The session still
        // expires on its own at 12 hours, and rotating `SESSION_HMAC_KEY` remains the bulk
        // revocation of last resort. The handler collapses this to `acknowledged`, so a caller
        // is told the same thing either way — which means A REFUSED LOGOUT IS INVISIBLE TO THE
        // USER. Reported; it is the price of the collapse, not a defect in it.
        return err(quotaExceeded());
      }

      return store.deleteSession(sessionId, admitted.value.reservation);
    },
  };
}
