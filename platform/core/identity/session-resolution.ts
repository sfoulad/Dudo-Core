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
  async function liveSession(
    sessionId: string,
  ): Promise<
    Result<{
      session: SessionRecord;
      principalId: string;
      principalType: ControlPlanePrincipalType;
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
    });
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
          authorizedBusinessIds: authorized.value.authorizedBusinessIds,
          grants: authorized.value.grants,
          // Delegation is `AUTHORIZATION_STANDARD.md` §11 and is not part of `0014` §C. A
          // session cannot express "acting for", and inventing a column for it here would be
          // deciding the delegation model in a login.
          onBehalfOfPrincipalId: null,
        }),
      });
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
  };
}
