/**
 * ===========================================================================================
 * THE PLATFORM ROUTE CLASS — THE FOURTH REQUEST CLASS. `docs/decisions/0025` decision 3,
 * implementing `packages/contracts/core/platform/platform-operator-v1.contract.yaml`.
 * ===========================================================================================
 *
 * A PLATFORM ROUTE AUTHENTICATES A PRINCIPAL, EVALUATES A PERMISSION AGAINST A CORE-OWNED
 * PLATFORM ENVELOPE, AND NEVER OBTAINS A TENANT STORE.
 *
 *   CLASS               PRINCIPAL           TENANT     PERMISSION   REGISTRY
 *   pre-auth (0014 §B)  none                none       none         closed set of 5
 *   session  (0021)     session only        none       none         closed set of 2
 *   Action              full, tenant-bound  REQUIRED   yes          App or Core router
 *   PLATFORM (0025)     principal-level     none       YES          Core-owned literal
 *
 * ===========================================================================================
 * WHY IT IS NOT AN ACTION WITH THE TENANT MADE OPTIONAL
 * ===========================================================================================
 *
 * `0021`'s sentence, and it is the whole argument:
 *
 *   **THE INVARIANT THAT AN ACTION ALWAYS HAS A TENANT IS WORTH MORE THAN THE CODE IT SAVES.**
 *
 * A tenant-optional branch inside the pipeline would force every future reviewer of every future
 * Action to work out which side of it they had landed on. The cost of a separate class is paid
 * once, by the people building it. The cost of the branch is paid forever, by everyone reading
 * past it. The other refused shortcut — a pseudo-principal with a null `organizationId` — is
 * `0014` §B's own argument one layer up: it would make every tenant predicate in the platform
 * depend on a sometimes-absent value.
 *
 * NEITHER SHORTCUT IS TAKEN HERE. `PlatformAuthority` is a distinct, smaller type than
 * `AuthenticatedPrincipal`; there is no function that converts one into the other; and
 * `invokeAction` is never called from this file.
 *
 * ===========================================================================================
 * WHY IT IS NOT A SESSION ROUTE
 * ===========================================================================================
 *
 * A session route EVALUATES NO PERMISSION, and `organization-selection-v1`'s safety argument for
 * that is that neither of its two operations "can do anything the session holder could not
 * already do". A PLATFORM OPERATION FAILS THAT TEST BY DESIGN — creating an Organization or
 * resetting a credential is precisely a thing the session holder could not otherwise do. So the
 * session class's justification for having no permission does not transfer, and this class must
 * have one.
 *
 * ===========================================================================================
 * P1 — NO TENANT STORE IS REACHABLE, STRUCTURALLY
 * ===========================================================================================
 *
 * A platform route handler receives a `PlatformRouteContext` and nothing else: no
 * `TenantStoreResolver`, no `TenantScopedStore`, no `ActionContext`, no organization identifier
 * of the caller's, and no D1 binding.
 *
 * THIS IS `tenancy/tenant-context.ts`'s OWN DEVICE APPLIED ONE CLASS OVER. That file's strongest
 * sentence is "WITHHOLDING THE VALUE IS STRONGER THAN REQUIRING ITS USE", and the reason an
 * Action handler cannot write a tenant predicate correctly, incorrectly, or at all is that it
 * holds no value to write one with. A platform handler is in the same position with respect to
 * the whole tenant database.
 *
 * THE HONEST LIMIT: this class touches the CONTROL PLANE, which is the one component whose
 * purpose is to hold tenant identity. "No tenant data" is exact; "no tenant identifier" is not.
 * A platform route may create, name and enumerate tenants and MAY NEVER READ A ROW BEHIND
 * `whereWithTenant`. The weaker property is the one that is true.
 *
 * ===========================================================================================
 * P2 — VALIDATION BELONGS TO THE CLASS, NOT TO ITS ROUTES
 * ===========================================================================================
 *
 * `0021`'s finding, and it applies here with more force than it did there. A route matched in
 * `http/api.ts`'s early absolute-path block INHERITS NO INPUT VALIDATION AT ALL: Core's JSON
 * parsing, its unknown-field rejection and its repeated-parameter refusal all live in the Action
 * path BELOW that block.
 *
 * THIS CLASS ACCEPTS IDENTIFIERS THAT NAME TENANTS AND PRINCIPALS. It must not be the class
 * without validation. So `dispatchPlatformRoute` VALIDATES BEFORE IT LOOKS UP A HANDLER, every
 * route declares its complete body-field set and its complete query-parameter set, and A ROUTE
 * THAT DECLARED NOTHING WOULD ACCEPT NOTHING. A fifth platform route cannot be added without
 * inheriting all of it, because there is no path to a handler that does not pass through here.
 *
 * A ROUTE DECLARING NO QUERY PARAMETERS REFUSES THE WHOLE QUERY STRING rather than filtering
 * unknown keys, which is the stronger form and the one `0021` chose: without it `?principal_id=…`
 * is silently accepted and ignored, and "ignored" is one careless edit from "read".
 *
 * ===========================================================================================
 * P4 — EVERY ROUTE WRITES AN AUDIT RECORD, INCLUDING THE READS
 * ===========================================================================================
 *
 * Enforced by `dispatchPlatformRoute` and not by the handlers: a handler returns a value and a
 * target, and this function writes the record. There is no code path from an authorized platform
 * request to a response that does not pass through `audit.record`, and a handler cannot opt out
 * because it is never asked. See `platform-audit.ts` for what is recorded, what is refused, and
 * which callers cause no record at all.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, forbidden, invalidArgument, unauthenticated, unavailable } from '../kernel/errors.ts';
import type { Authorizer } from '../authorization/authorizer.ts';
import type { PreAuthBody } from '../identity/pre-auth-admission.ts';
import { parsePreAuthBody } from '../identity/pre-auth-admission.ts';
import type { PlatformAuthority, PlatformAuthorityResolver } from './platform-authority.ts';
import type { PlatformAuditRecorder, PlatformActionTarget } from './platform-audit.ts';
import { NO_TARGET } from './platform-audit.ts';
import {
  PLATFORM_ORGANIZATION_LIST_PERMISSION,
  PLATFORM_PERMISSION_ENVELOPE,
} from './platform-permissions.ts';

/**
 * The base path. `/api/v1/platform`.
 *
 * IT IS RESERVED TO CORE. `identity/pre-auth-registry.ts` carries the prefix in
 * `RESERVED_PRE_AUTH_PATH_PREFIXES`, so `assertNoReservedPathCollision` refuses any App route
 * table that could resolve onto it at CONSTRUCTION, and `http/api.ts` matches this block BEFORE
 * the App router at RUNTIME. Both halves are needed: the first turns a colliding table into a
 * build failure instead of dead code, and the second means an App cannot present itself to a user
 * as the admin console even if it somehow shipped.
 *
 * The contract also requires `platform` to be added to `reservedApiPathSegments` in
 * `core-object-registry.yaml`. THAT REGISTRY IS `architecture-agent`'s FILE AND THIS CHANGE DOES
 * NOT MAKE IT — requested through the Team Lead.
 */
export const PLATFORM_BASE_PATH = '/api/v1/platform';

/**
 * The closed set. TWO OPERATIONS IN THIS SLICE, SIX IN THE CLASS, AND A SEVENTH IS A DECISION
 * RATHER THAN A REFACTOR.
 *
 * A CLOSED UNION OF LITERALS, exactly as `PreAuthEntryPointId` and `SessionRouteId` are, and for
 * the same reason: a third value is not expressible without editing this file, which lives in
 * `platform/core/**` and which no App may edit.
 *
 * THE FOUR ROUTES NOT BUILT HERE — `templates.list`, `templates.read`, `templates.create`,
 * `organizations.create`, `credentials.reset` — belong to three contracts still being written and
 * are deliberately absent rather than stubbed. A registered route with no handler answers
 * `unauthenticated`, which is the fail-closed shape, but a route that does not exist cannot be
 * reached at all.
 */
export type PlatformRouteId = 'platform.organizations.list' | 'platform.session.whoami';

export type PlatformRouteMethod = 'GET' | 'POST';

/**
 * A registered platform route.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `scope`, `store`, `organizationId`, `resolver`. The
 * scope is not a per-route field because EVERY route in this class evaluates at `platform` and a
 * per-route scope is a per-route opportunity to evaluate at the wrong level — which
 * `AUTHORIZATION_STANDARD.md` §4 calls "a silent privilege escalation".
 */
export type PlatformRoute = {
  readonly id: PlatformRouteId;
  readonly method: PlatformRouteMethod;
  /** ABSOLUTE. Under `PLATFORM_BASE_PATH`, which is reserved. */
  readonly path: string;
  /**
   * The permission `authorize()` evaluates, at `platform` scope, against
   * `PLATFORM_PERMISSION_ENVELOPE`. Required, and there is no route without one — `0007` rule 4,
   * and it is what distinguishes this class from the session class.
   */
  readonly permission: string;
  /**
   * The COMPLETE set of body field names this route accepts. Required, and may be empty.
   *
   * "This route accepts no body fields" has to be an explicit statement rather than an omission,
   * because an omission is how a route ends up accepting anything.
   */
  readonly fields: readonly string[];
  /**
   * The COMPLETE set of query parameter names this route accepts. Required, and may be empty.
   *
   * EMPTY MEANS THE WHOLE QUERY STRING IS REFUSED, not that unknown keys are filtered. See P2.
   */
  readonly queryParameters: readonly string[];
};

/**
 * The table.
 *
 * BOTH ROUTES DECLARE `core.organization.list`, AND FOR `whoami` THAT IS THE CONTRACT'S RULING
 * RATHER THAN AN OVERSIGHT. No `core.platform.whoami` is added to the catalog, because a
 * permission every platform operator necessarily holds, checked on every call and deniable to
 * nobody, is not an authorization decision — it is ceremony that makes the catalog less
 * meaningful. `organization-selection-v1` made exactly this argument against inventing
 * `core.session.select`.
 *
 * THE COST IS REAL AND IS NAMED IN THE CONTRACT AS PO-5: a future `marketplace-moderator` holding
 * `core.marketplace.moderate` but NOT `core.organization.list` cannot call `whoami` and so cannot
 * render its own console. That is the point at which the ruling should be REVISITED rather than
 * patched by granting the moderator an Organization-enumeration permission it has no business
 * holding.
 */
const ROUTES: readonly PlatformRoute[] = Object.freeze([
  Object.freeze({
    id: 'platform.organizations.list' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/organizations`,
    permission: PLATFORM_ORGANIZATION_LIST_PERMISSION,
    // No body. A GET with a body is refused like any other undeclared input.
    fields: Object.freeze([]),
    // EXACTLY TWO. There is no `organization_id` filter, no `status` filter, no `q`, no `sort` and
    // no `include`. Each of those is a way to ask the control plane a question this route is not
    // supposed to answer, and `include=customers` is how a console acquires cross-tenant reach in
    // one query parameter.
    queryParameters: Object.freeze(['page_size', 'cursor']),
  }),
  Object.freeze({
    id: 'platform.session.whoami' as const,
    method: 'GET' as const,
    path: `${PLATFORM_BASE_PATH}/whoami`,
    permission: PLATFORM_ORGANIZATION_LIST_PERMISSION,
    fields: Object.freeze([]),
    // NONE, SO ANY QUERY STRING AT ALL IS REFUSED. In particular there is no `principal_id`: the
    // safety argument for this route is in its signature — "it returns the caller's own context
    // and has no field naming another principal" — and an accepted-but-ignored parameter would be
    // the first half of undoing it.
    queryParameters: Object.freeze([]),
  }),
]);

/**
 * Matches an ABSOLUTE path and method. Exact match only, no path parameters and no patterns.
 *
 * A MISMATCHED METHOD RETURNS `undefined` AND THEREFORE 404, NOT 405. A 405 confirms the path
 * exists, which on a host where these routes should not appear at all is exactly the disclosure
 * the host binding exists to prevent.
 */
export function matchPlatformRoute(method: string, path: string): PlatformRoute | undefined {
  const normalized = normalizePath(path);
  for (const route of ROUTES) {
    if (route.method === method && route.path === normalized) {
      return route;
    }
  }
  return undefined;
}

/** Collapses `//a//b/` to `/a/b`, so a reservation cannot be stepped around with a slash. */
function normalizePath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function platformRoutes(): readonly PlatformRoute[] {
  return ROUTES;
}

// =============================================================================================
// The host binding. `docs/decisions/0022` as amended 2026-09-05.
// =============================================================================================

/**
 * ===========================================================================================
 * THE PLATFORM ROUTE BLOCK IS MOUNTED ONLY ON THE ADMIN HOST — AND IT IS DEFENCE IN DEPTH.
 * ===========================================================================================
 *
 * `0022` was amended while the contract was being written: admin is a SECOND WORKER,
 * `dudo-admin`, forced by a hard Cloudflare limit — "only one collection of static assets can be
 * configured in each Worker" — and it serves its own API on its own origin with THE SAME `main`,
 * the same D1 bindings and the same secrets as `app.dudo.work`.
 *
 * SAME `main` MEANS THE SAME ROUTE TABLE IS PRESENT IN BOTH WORKERS. Without this check,
 * `/api/v1/platform/**` would be mounted and reachable on `app.dudo.work` as well — where every
 * tenant user already has a session. It would still be REFUSED, because authorization runs on the
 * `platform_operator` row and not on the hostname, so it is not a hole. BUT IT IS AN UNNECESSARY
 * SURFACE that exists purely as a side effect of a deployment decision taken for an unrelated
 * reason.
 *
 * A REQUEST ON THE WRONG HOST ANSWERS 404, NOT 403, and the difference matters: answering 403
 * would confirm the route exists on a host where it should not appear to. This is the same choice
 * `organization-selection-v1` makes when it requires GET on the singular path to be 404 rather
 * than 405.
 *
 * *** THE AUTHORIZATION CHECK IS THE CONTROL; THE HOST BINDING IS A SECOND LAYER, AND IT MUST
 * NEVER BECOME THE FIRST. *** An implementation that bound the host and skipped the
 * `platform_operator` check would be relying on ROUTING for AUTHORIZATION, which is the "UI
 * hiding is presentation, never security" error moved down a layer. Both, or the host binding is
 * worse than useless because it invites the omission.
 *
 * AN EMPTY LIST MATCHES NOTHING AND EVERY PLATFORM ROUTE ANSWERS 404. That is the fail-closed
 * direction and it is why there is no default: a composition root has to state the hosts, and a
 * reviewer can see which ones it stated.
 */
export function isPlatformHost(adminHosts: readonly string[], hostname: string): boolean {
  // `URL.hostname` is already lowercase and carries no port. Lowercasing both sides anyway costs
  // nothing and removes a dependency on that being true of whatever produces the argument.
  const requested = hostname.toLowerCase();
  return adminHosts.some((host) => host.toLowerCase() === requested);
}

// =============================================================================================
// What a handler receives and returns
// =============================================================================================

/**
 * What a platform route handler is given.
 *
 * `authority` IS A RESOLVED `PlatformAuthority` — a principal identifier, a recognised platform
 * role, and a frozen grant set. IT IS NOT AN `AuthenticatedPrincipal` and carries no
 * `organizationId`, so there is no value here from which a tenant store could be resolved even by
 * a handler that wanted one.
 *
 * `query` IS ALREADY VALIDATED: every key in it is one the route declared, no key appears twice,
 * and the whole string was length-bounded. A handler still has to interpret the VALUES, which is
 * what `readPageSize` and `readCursorParameter` below are for.
 */
export type PlatformRouteContext = {
  readonly routeId: PlatformRouteId;
  readonly authority: PlatformAuthority;
  readonly query: ReadonlyMap<string, string>;
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * What a handler answers with.
 *
 * `target` IS REQUIRED, AND REQUIRING IT IS HOW P4 STAYS TRUE. The audit record has to name what
 * the operation touched, and a handler that could omit it would produce an unattributable log
 * line. `NO_TARGET` is the explicit value for an operation that names nothing — both routes in
 * this slice use it, because an enumeration has no single affected target and `whoami` describes
 * only the caller.
 *
 * THE VALUE IS RENDERED BY THE TRANSPORT AND THE HANDLER CHOOSES NO STATUS CODE, no headers and
 * no cookie. A platform route cannot issue, clear or rotate a session credential — the shape of
 * this type is what makes that structural rather than documented.
 */
export type PlatformRouteOutcome = {
  readonly body: unknown;
  readonly target: PlatformActionTarget;
};

export type PlatformRouteHandler = (
  context: PlatformRouteContext,
  body: PreAuthBody,
) => Promise<Result<PlatformRouteOutcome>>;

export type PlatformRouteHandlers = Partial<
  Readonly<Record<PlatformRouteId, PlatformRouteHandler>>
>;

export type PlatformRouteDependencies = {
  readonly handlers: PlatformRouteHandlers;
  /**
   * Reads the session credential. THE SAME PORT THE AUTHENTICATED PATH AND THE SESSION ROUTE
   * CLASS USE, deliberately: one credential, one verifier, one set of carrier rules. A platform
   * route accepting a credential the ordinary path would reject — or the reverse — would be two
   * authentication schemes wearing one name, and this class is the one where that would matter
   * most.
   */
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
  /**
   * Turns a verified session identifier into a principal identifier AND NOTHING ELSE.
   *
   * It returns a string rather than a principal object on purpose: there is no organization, no
   * membership list and no grant set in the return value, so this seam cannot carry a tenant
   * identifier into the class. `identity/composition.ts` implements it over
   * `SessionResolver.resolvePrincipalId`, which is steps 1 and 2 of `0014` §C.5's resolution
   * order and stops there.
   */
  readonly authenticatePrincipal: (sessionId: string) => Promise<Result<string>>;
  readonly authority: PlatformAuthorityResolver;
  readonly authorizer: Authorizer;
  readonly audit: PlatformAuditRecorder;
  /**
   * The hostnames on which this class is served. See `isPlatformHost`. Required, no default, and
   * an empty list means unreachable.
   */
  readonly adminHosts: readonly string[];
};

export type PlatformRouteRequest = {
  readonly bodyText: string;
  readonly headers: ReadonlyMap<string, string>;
  /** The raw query string, without the leading `?`. */
  readonly queryString: string;
  readonly requestId: string;
  readonly correlationId: string;
};

// =============================================================================================
// The class's validation floor
// =============================================================================================

/**
 * The longest query string this class will look at.
 *
 * A BOUND ON THE INPUT BEFORE IT IS PARSED, which is what `parsePreAuthBody`'s 4 KiB does for the
 * body. Two declared parameters at their own maxima — a three-digit `page_size` and a 512-
 * character cursor — is well under 600 characters, so 1 KiB is generous and still refuses a
 * megabyte of query string before `URLSearchParams` allocates anything.
 */
export const PLATFORM_MAX_QUERY_STRING_LENGTH = 1024;

/** 1 to 100, default 25. The contract's numbers for `platform.organizations.list`. */
export const PLATFORM_MIN_PAGE_SIZE = 1;
export const PLATFORM_MAX_PAGE_SIZE = 100;
export const PLATFORM_DEFAULT_PAGE_SIZE = 25;

/**
 * Parses and validates the query string against the route's declared set.
 *
 * THREE REFUSALS, AND EACH ONE CLOSES SOMETHING:
 *
 *   1. A ROUTE THAT DECLARES NO PARAMETERS REFUSES ANY QUERY STRING AT ALL. Not "filters unknown
 *      keys" — refuses. `0021`: refusing the whole query string rather than unknown keys means a
 *      future route cannot acquire one by accident.
 *   2. AN UNDECLARED PARAMETER IS `invalid_argument`, never ignored. An ignored parameter is one
 *      edit from being read.
 *   3. A REPEATED PARAMETER IS `invalid_argument`, never first-wins or last-wins. `http/api.ts`
 *      already refuses these on the Action path for the reason restated here: a precedence rule
 *      is a way for a caller to shadow a value a reviewer assumed was authoritative.
 */
function parseQuery(
  route: PlatformRoute,
  queryString: string,
): Result<ReadonlyMap<string, string>> {
  if (queryString.length === 0) {
    return ok(new Map());
  }
  if (route.queryParameters.length === 0) {
    return err(invalidArgument([detail('', 'unexpected_query_parameter')]));
  }
  if (queryString.length > PLATFORM_MAX_QUERY_STRING_LENGTH) {
    return err(invalidArgument([detail('', 'query_string_too_large')]));
  }
  const declared = new Set(route.queryParameters);
  const parsed = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(queryString).entries()) {
    if (!declared.has(key)) {
      // The PARAMETER NAME and a stable token. Never the value — `detail()` has no parameter for
      // one, and echoing a rejected identifier would put it in logs and error bodies.
      return err(invalidArgument([detail(key, 'unknown_parameter')]));
    }
    if (parsed.has(key)) {
      return err(invalidArgument([detail(key, 'repeated_parameter')]));
    }
    parsed.set(key, value);
  }
  return ok(parsed);
}

/**
 * Reads `page_size`: an integer between 1 and 100, defaulting to 25.
 *
 * STRICTLY PARSED, NOT COERCED. `Number('25abc')` is `NaN` and `parseInt('25abc')` is 25 — the
 * second is how a malformed value becomes a plausible one. The pattern below admits digits and
 * nothing else, so `+25`, ` 25`, `25.0`, `2e1` and `0x19` are all refused rather than
 * reinterpreted.
 *
 * THE UPPER BOUND IS ENFORCED RATHER THAN CLAMPED. Clamping 1000 to 100 silently answers a
 * different question from the one asked, and a client paging on the assumption it got 1000 rows
 * would skip records without any error to notice.
 */
export function readPageSize(query: ReadonlyMap<string, string>): Result<number> {
  const raw = query.get('page_size');
  if (raw === undefined) {
    return ok(PLATFORM_DEFAULT_PAGE_SIZE);
  }
  if (!/^[0-9]{1,3}$/.test(raw)) {
    return err(invalidArgument([detail('page_size', 'must_be_an_integer')]));
  }
  const value = Number(raw);
  if (value < PLATFORM_MIN_PAGE_SIZE || value > PLATFORM_MAX_PAGE_SIZE) {
    return err(invalidArgument([detail('page_size', 'out_of_range')]));
  }
  return ok(value);
}

/**
 * Reads `cursor`, or `null`.
 *
 * IT IS ONLY A LENGTH AND ALPHABET CHECK. Passing it proves nothing: the cursor's signature is
 * verified by `platform-cursor.ts`, which is where the single rejection value lives. This refuses
 * a value that could not possibly be a cursor BEFORE any HMAC is computed, so junk costs a 400
 * and no crypto.
 *
 * AN EMPTY `?cursor=` IS REFUSED RATHER THAN TREATED AS ABSENT. "Present but empty" and "absent"
 * are different requests, and collapsing them is how a client that failed to store a cursor
 * silently restarts an enumeration from the beginning.
 */
export function readCursorParameter(query: ReadonlyMap<string, string>): Result<string | null> {
  const raw = query.get('cursor');
  if (raw === undefined) {
    return ok(null);
  }
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) {
    return err(invalidArgument([detail('cursor', 'invalid_cursor')]));
  }
  return ok(raw);
}

// =============================================================================================
// Dispatch — the order IS the security property
// =============================================================================================

/**
 * ===========================================================================================
 * THE ORDER, AND WHY EACH STEP IS WHERE IT IS.
 * ===========================================================================================
 *
 *   1. VALIDATE THE QUERY STRING, then 2. VALIDATE THE BODY. Before authentication, because a
 *      malformed request must not reach credential verification and because the answer to a
 *      malformed request must not depend on whether the caller is authenticated. This is P2, and
 *      it is here rather than in the handlers so a fifth route cannot forget it.
 *   3. AUTHENTICATE THE SESSION, then resolve it to a principal identifier. One argument-free
 *      `unauthenticated()` for no credential, an unreadable one, an expired session, a deleted
 *      principal and a suspended principal.
 *   4. RESOLVE PLATFORM AUTHORITY. Three of the contract's four denial causes are decided here —
 *      no operator row, an unrecognised `platform_role`, and a principal present in BOTH tables —
 *      and all three answer the identical argument-free `forbidden()`. NONE of them writes an
 *      audit record. See `platform-audit.ts` for why that bound is load-bearing rather than
 *      convenient. The fourth cause, a role that does not carry the permission, is step 5.
 *   5. AUTHORIZE. `authorize()` unchanged, with Core's platform envelope as the ceiling and the
 *      operator's role grants as the floor. A denial here IS audited, with `outcome: 'denied'` —
 *      the caller is a real operator and an operator probing routes it cannot use is exactly what
 *      the trail exists to show.
 *   6. RUN THE HANDLER.
 *   7. WRITE THE AUDIT RECORD, AND FAIL THE REQUEST IF IT CANNOT BE WRITTEN. P4 and `0013` D2:
 *      the audit event must not fail open, and inability to record the evidence is not a reason
 *      to proceed without it.
 *
 * ===========================================================================================
 * ONE RESIDUAL DISTINCTION, NAMED RATHER THAN LEFT TO BE FOUND
 * ===========================================================================================
 *
 * A caller refused at step 4 always receives `forbidden`. A caller refused at step 5 receives
 * `forbidden` normally and `unavailable` when the denial record cannot be written. So during a
 * control-plane write failure — or after an operator has spent its own daily write budget — the
 * two steps become distinguishable, which tells the caller whether it holds a `platform_operator`
 * row.
 *
 * IT IS ACCEPTED, AND THE REASON IT IS SAFE IS THAT THE STATE IS UNREACHABLE FOR THE CALLER WHO
 * WOULD LEARN SOMETHING. The budget counter is keyed by a VERIFIED principal and is only ever
 * charged for a caller that already passed step 4, so a non-operator can never reach the deferred
 * branch; and a database write failure refuses every operator operation anyway. The alternative —
 * answering `forbidden` and dropping the record — is the audit event failing open, which is the
 * worse of the two. Reported rather than smoothed over.
 */
export async function dispatchPlatformRoute(
  dependencies: PlatformRouteDependencies,
  route: PlatformRoute,
  request: PlatformRouteRequest,
): Promise<Result<unknown>> {
  // ---- 1. The query string, against the route's declared parameters.
  const query = parseQuery(route, request.queryString);
  if (!query.ok) {
    return err(query.error);
  }

  // ---- 2. The body floor, against the route's declared fields.
  //
  // REUSING `parsePreAuthBody` IS DELIBERATE, and it is the same argument `session-routes.ts`
  // makes: two validation floors that were meant to be identical are two floors that will differ.
  // 4 KiB, 12 fields, 512 characters, no nesting, no undeclared names — one implementation,
  // three request classes.
  const parsedBody = parsePreAuthBody(request.bodyText, route.fields);
  if (!parsedBody.ok) {
    return err(parsedBody.error);
  }

  // ---- 3. The session credential, then the principal.
  const sessionId = await dependencies.readSessionId(request.headers);
  if (!sessionId.ok) {
    return err(sessionId.error);
  }
  if (sessionId.value === null) {
    // No credential presented. `unauthenticated()` takes no arguments, so this is byte-identical
    // to the answer for a credential that was presented and rejected.
    return err(unauthenticated());
  }
  const principalId = await dependencies.authenticatePrincipal(sessionId.value);
  if (!principalId.ok) {
    return err(principalId.error);
  }

  // ---- 4. Platform authority. NO AUDIT RECORD ON ANY DENIAL PATH HERE.
  const authority = await dependencies.authority.resolve(principalId.value);
  if (!authority.ok) {
    return err(authority.error);
  }

  // ---- 5. Authorization. The envelope is the CEILING, the operator's role grants are the FLOOR,
  // and neither substitutes for the other. Evaluated at `platform` scope, which is the only scope
  // any route in this class uses — it is not a per-route field, deliberately.
  const decision = dependencies.authorizer.authorize(
    authority.value.grants,
    PLATFORM_PERMISSION_ENVELOPE,
    route.permission,
    'platform',
  );
  if (!decision.allowed) {
    return recordThen(dependencies, authority.value, route, request, 'denied', NO_TARGET, () =>
      err(forbidden()),
    );
  }

  // ---- 6. The handler.
  const handler = dependencies.handlers[route.id];
  if (handler === undefined) {
    // FAIL CLOSED. A registered route with no composed handler is unreachable, not open. It
    // answers `unavailable` rather than `not_implemented` because the caller has by this point
    // been established as an operator, so there is no disclosure argument for hiding it — and
    // because a missing handler is a composition defect, which is what `unavailable` describes.
    return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
      err(unavailable()),
    );
  }

  const outcome = await handler(
    {
      routeId: route.id,
      authority: authority.value,
      query: query.value,
      requestId: request.requestId,
      correlationId: request.correlationId,
    },
    parsedBody.value,
  );

  // ---- 7. The record, then the answer. Never the other way round.
  if (!outcome.ok) {
    // A FAILED OPERATION IS STILL RECORDED, with `NO_TARGET`: a handler that failed may not know
    // what it was about to touch, and inventing a target from a partial operation would produce a
    // log line that asserts more than the code knows.
    return recordThen(dependencies, authority.value, route, request, 'failed', NO_TARGET, () =>
      err(outcome.error),
    );
  }
  return recordThen(
    dependencies,
    authority.value,
    route,
    request,
    'ok',
    outcome.value.target,
    () => ok(outcome.value.body),
  );
}

/**
 * Writes the audit record and then produces the answer — or replaces the answer with
 * `unavailable` if the record could not be written.
 *
 * `answer` IS A THUNK RATHER THAN A VALUE so that the ordering reads as what it is: THE RECORD IS
 * WRITTEN FIRST AND THE ANSWER IS PRODUCED SECOND. `platform-operator-v1`: "the operation is not
 * reported successful until the platform audit record is written."
 *
 * WHAT THIS CANNOT FIX, AND THE CONTRACT SAYS SO: for a future route that mutates, the operation's
 * own control-plane rows are already committed by the time this runs. A failed audit write turns a
 * completed operation into a `503`, and the caller cannot tell that from an operation that never
 * happened. That is the two-database problem, which "cannot be solved, only chosen" — and the
 * choice is to refuse rather than to report a success that has no evidence.
 */
async function recordThen(
  dependencies: PlatformRouteDependencies,
  actor: PlatformAuthority,
  route: PlatformRoute,
  request: PlatformRouteRequest,
  outcome: 'ok' | 'denied' | 'failed',
  target: PlatformActionTarget,
  answer: () => Result<unknown>,
): Promise<Result<unknown>> {
  const recorded = await dependencies.audit.record({
    actor,
    actionId: route.id,
    target,
    outcome,
    correlationId: request.correlationId,
  });
  if (!recorded.ok) {
    return err(recorded.error);
  }
  return answer();
}
