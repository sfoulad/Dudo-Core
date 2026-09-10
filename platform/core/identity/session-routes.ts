/**
 * ===========================================================================================
 * THE SESSION ROUTE CLASS. `docs/decisions/0021`, Accepted, implementing
 * `packages/contracts/core/identity/organization-selection-v1.contract.yaml`.
 * ===========================================================================================
 *
 * A THIRD REQUEST CLASS, AND THE PLATFORM HAD ONLY TWO. A pre-authentication entry point resolves
 * no principal; an Action route requires a fully resolved one. The Organization picker needs
 * something between: it is AUTHENTICATED — the caller holds a session credential — but it runs
 * before any tenant exists, because choosing the tenant is what it is for.
 *
 * WHY A THIRD CLASS RATHER THAN EITHER SHORTCUT. Both alternatives were named and refused in
 * `0021`, and both are the kind that look cheaper at the call site and cost everywhere else:
 *
 *   A PSEUDO-PRINCIPAL WITH A NULL `organizationId` — `0014` §B's own argument one layer up. It
 *   would make every tenant predicate in the platform depend on a sometimes-absent value. The
 *   cost is not here; it is at every other call site forever.
 *
 *   A TENANT-OPTIONAL BRANCH INSIDE THE ACTION PIPELINE — *"it would work, and every future
 *   reviewer of every future Action would then have to check which side of that branch it lands
 *   on."*
 *
 * **THE INVARIANT THAT AN ACTION ALWAYS HAS A TENANT IS WORTH MORE THAN THE CODE IT SAVES.**
 * So a session route NEVER builds an `AuthenticatedPrincipal`, NEVER obtains a tenant store,
 * NEVER evaluates a permission and NEVER calls `invokeAction`. There is nothing in this file that
 * could: no `TenantStoreResolver`, no `Authorizer`, no `ActionContext`, no store of any kind.
 *
 * ===========================================================================================
 * THE VALIDATION GAP THIS CLASS EXISTS TO CLOSE — `0021`, and it is the quiet half
 * ===========================================================================================
 *
 * A route matched in `http/api.ts`'s early absolute-path block INHERITS NO INPUT VALIDATION AT
 * ALL. Core's JSON body parsing, its unknown-field rejection and its repeated-query-parameter
 * refusal all live in the ACTION path BELOW that block, and `parsePreAuthBody` is reachable only
 * through `dispatchPreAuthRequest`.
 *
 * Without explicit validation, **the one route in Dudo that accepts a tenant identifier would be
 * the one route with none** — silently accepting `?principal_id=…`, ignored today and one
 * careless edit from being read.
 *
 * SO VALIDATION BELONGS TO THE CLASS AND NOT TO THE TWO OPERATIONS, and it is structural rather
 * than remembered: `dispatchSessionRoute` validates BEFORE it looks up a handler, every route
 * declares its complete field set, and **a route that declared nothing would accept nothing**.
 * A third session route cannot be added without inheriting all of it, because there is no path
 * to a handler that does not pass through here.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument, unauthenticated } from '../kernel/errors.ts';
import type { CoreError } from '../kernel/errors.ts';
import { parsePreAuthBody } from './pre-auth-admission.ts';
import type { PreAuthBody } from './pre-auth-admission.ts';

/**
 * The closed set. TWO OPERATIONS, AND A THIRD IS A DECISION RATHER THAN A REFACTOR (`0021`).
 *
 * A CLOSED UNION OF LITERALS, exactly as `PreAuthEntryPointId` is, and for the same reason: a
 * third value is not expressible without editing this file, which lives in `platform/core/**` and
 * which no App may edit.
 *
 * ===========================================================================================
 * *** NORMATIVE, AND READ IT BEFORE YOU ADD THE THIRD ID: `.session` NAMES THE SESSION
 * *** RESOURCE. IT NEVER NAMES THE REQUEST CLASS.
 * `docs/decisions/0039`, resolved 2026-09-09.
 * ===========================================================================================
 *
 * THE ANALOGY TRAP IS THE WHOLE REASON THIS PARAGRAPH EXISTS. Whoever adds the next session-class
 * route will look for a sibling to copy, find `identity.session.refresh`, and reach for
 * `identity.session.<thing>`. **That would be wrong, and it would look like consistency**, which
 * is why the rule is stated here rather than left to be inferred from the two ids below.
 *
 * `identity.session.refresh` and `identity.session.revoke` are **pre-auth entry points**
 * (`0014` §B), not members of this class. Their `.session` is **the thing being refreshed and the
 * thing being revoked** — a resource in the path of a name, exactly as `.organization` is in
 * `identity.organization.select`. It says nothing whatever about which class they belong to, and a
 * route changing class would never have made those two stale.
 *
 * SO THE SEGMENT CARRIED TWO MEANINGS IN ONE NAMESPACE WITH NOTHING TO DISTINGUISH THEM — the
 * resource in half its occurrences, the class in the other half. **That is `architecture.md` §1a's
 * shape (one name, two meanings) arriving in an IDENTIFIER instead of in a request field**, and
 * §1a's hazard is not specific to request fields: it is what happens wherever a namespace is
 * shared and no document owns it.
 *
 * DROPPING IT FROM THESE TWO REMOVES THE AMBIGUITY RATHER THAN REMOVING A CLASS TOKEN. Every
 * surviving `.session` in the corpus now means exactly one thing:
 *
 *     identity.login.start        identity.login.complete       pre-auth
 *     identity.session.refresh    identity.session.revoke       pre-auth — .session is the RESOURCE
 *     identity.organizations.list identity.organization.select  session class — THIS FILE
 *
 * AND THE CLASS IS NOT ENCODED IN THE ID AT ALL, DELIBERATELY. `0039` is the decision that a
 * contract DECLARES its request class in a `requestClass:` field and that nobody infers it from a
 * key name or an id segment. An id that spelled its class would be the same implicit encoding one
 * level down, and would go stale the first time a route changed class.
 *
 * `identity.` IS LOAD-BEARING AND IS NOT INERTIA. `platform.organizations.list` and
 * `identity.organizations.list` differ only by that segment and are genuinely different operations
 * — every Organization on the platform, versus the caller's own. **The namespace does real work at
 * exactly the point the class token did not.**
 *
 * NOTHING PERSISTED EITHER FORM, WHICH IS WHY THIS RENAME WAS AVAILABLE AT ALL. `0025`'s rule that
 * a persisted value is not renamed to match a document never fired here, and the evidence is
 * structural rather than a negative search: `SessionRouteDependencies` below has two fields —
 * `handlers` and `readSessionId` — with **no audit sink, no store and no admission port**, so a
 * session-route handler has nothing it *could* write a record with. Three tables carry an
 * `action_id` column and none is reachable from this class.
 */
export type SessionRouteId =
  | 'identity.organizations.list'
  | 'identity.organization.select';

export type SessionRouteMethod = 'GET' | 'POST';

/**
 * A registered session route.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: `permission`, `scope`, `store`, `organizationId`.
 * There is no permission on these paths to be forbidden by — `0021` — and no tenant to reach.
 */
export type SessionRoute = {
  readonly id: SessionRouteId;
  readonly method: SessionRouteMethod;
  /** ABSOLUTE. Under the reserved `/auth/` prefix, so no App route table can claim it. */
  readonly path: string;
  /**
   * The COMPLETE set of body field names this route accepts. Required, and may be empty.
   *
   * "This route accepts no body fields" has to be an explicit statement rather than an omission,
   * because an omission is how a route ends up accepting anything. An empty set rejects every
   * field with `invalid_argument`.
   */
  readonly fields: readonly string[];
};

/**
 * The table. Both paths are under `/auth/`, which `isReservedPreAuthPath` already reserves, so
 * `assertNoReservedPathCollision` refuses any App route table that could resolve onto them — an
 * App cannot serve, shadow or impersonate the Organization picker.
 *
 * THE SINGULAR/PLURAL PAIRING IS DELIBERATE AND IS THE CONTRACT'S. `/organizations` is a
 * collection and `/organization` is the singular selection. The contract requires GET on the
 * singular path and POST on the plural path to be **404 rather than 405** — answering 405 would
 * confirm the path exists — and that falls out of matching method and path together.
 *
 * *** THE PATHS KEEP `/session/` AND THE IDS DO NOT. THAT IS NOT AN OVERSIGHT — DO NOT HARMONISE
 * *** THEM. *** `0039` ruled on operation IDS, which are internal names nothing persists. **A URL
 * is a published wire surface the deployed console calls**, so moving it is the outage direction
 * `0034` and `0031` both sequenced around, and it would buy nothing: `/auth/session/` is also what
 * `isReservedPreAuthPath` reserves, which is what stops an App claiming these paths. The id and
 * the path answer to different rules and are allowed to disagree.
 */
const ROUTES: readonly SessionRoute[] = Object.freeze([
  Object.freeze({
    id: 'identity.organizations.list' as const,
    method: 'GET' as const,
    path: '/auth/session/organizations',
    // No body. A GET with a body is refused like any other undeclared input.
    fields: Object.freeze([]),
  }),
  Object.freeze({
    id: 'identity.organization.select' as const,
    method: 'POST' as const,
    path: '/auth/session/organization',
    // EXACTLY ONE FIELD, matching `selectOrganizationInput`'s `additionalProperties: false`.
    // There is no `principal_id`, no `tenant_id`, no `role`, no `on_behalf_of` and no expiry
    // override — not undocumented, REJECTED. In particular there is no field by which a caller
    // could select an Organization FOR ANOTHER PRINCIPAL: the principal comes from the session
    // credential, server-side, and this body cannot name one.
    fields: Object.freeze(['organization_id']),
  }),
]);

/**
 * Matches an ABSOLUTE path and method. Exact match only, no path parameters and no patterns.
 *
 * A MISMATCHED METHOD RETURNS `undefined` AND THEREFORE 404, NOT 405. The contract requires it:
 * a 405 confirms the path exists, which for the route that names a tenant is free reconnaissance.
 */
export function matchSessionRoute(method: string, path: string): SessionRoute | undefined {
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

export function sessionRoutes(): readonly SessionRoute[] {
  return ROUTES;
}

// =============================================================================================
// What a handler receives and returns
// =============================================================================================

/**
 * What a session route handler is given.
 *
 * `sessionId` IS SERVER-DERIVED FROM A VERIFIED CREDENTIAL and is the only identity here. There
 * is no principal identifier, no organization identifier and no store — the handler asks the
 * control plane for what it needs, keyed by this session, and can reach nothing else.
 */
export type SessionRouteContext = {
  readonly routeId: SessionRouteId;
  readonly sessionId: string;
  readonly requestId: string;
  readonly correlationId: string;
};

/**
 * A handler's answer: a JSON value, or an error.
 *
 * THE VALUE IS RENDERED BY THE TRANSPORT AND THE HANDLER CHOOSES NO STATUS CODE, no headers and
 * no cookie. A session route cannot issue, clear or rotate a credential — the contract states
 * that selection returns no `Set-Cookie` and does not change the session identifier — and the
 * shape of this type is what makes that true rather than merely documented.
 */
export type SessionRouteHandler = (
  context: SessionRouteContext,
  body: PreAuthBody,
) => Promise<Result<unknown>>;

export type SessionRouteHandlers = Partial<Readonly<Record<SessionRouteId, SessionRouteHandler>>>;

/**
 * Reads the session credential from the request.
 *
 * IT IS THE SAME PORT THE AUTHENTICATED PATH USES (`SessionCredentialReader`), deliberately: one
 * credential, one verifier, one set of carrier rules. A session route accepting a credential the
 * ordinary path would reject — or the reverse — would be two authentication schemes wearing one
 * name.
 */
export type SessionRouteDependencies = {
  readonly handlers: SessionRouteHandlers;
  readonly readSessionId: (headers: ReadonlyMap<string, string>) => Promise<Result<string | null>>;
};

export type SessionRouteRequest = {
  readonly bodyText: string;
  readonly headers: ReadonlyMap<string, string>;
  /** The raw query string, if any. Refused wholesale; see `dispatchSessionRoute`. */
  readonly queryString: string;
  readonly requestId: string;
  readonly correlationId: string;
};

// =============================================================================================
// Dispatch — the class's validation, applied before anything else
// =============================================================================================

/**
 * ===========================================================================================
 * THE ORDER IS THE SECURITY PROPERTY, AND VALIDATION COMES FIRST.
 * ===========================================================================================
 *
 *   1. REFUSE ANY QUERY STRING. Neither route declares a query parameter, so any query string at
 *      all is `invalid_argument`. This is the concrete form of `0021`'s warning: without it,
 *      `?principal_id=…` is silently accepted and ignored, and "ignored" is one careless edit
 *      from "read". Refusing the whole query string rather than unknown keys means a future
 *      route cannot acquire one by accident.
 *   2. VALIDATE THE BODY against the route's declared field set, through the same floor the
 *      pre-authentication path uses — 4 KiB, 12 fields, 512 characters, no nesting, no undeclared
 *      names. Reusing `parsePreAuthBody` is deliberate: two validation floors that were meant to
 *      be identical are two floors that will differ.
 *   3. AUTHENTICATE THE SESSION. After validation, because a malformed request should not reach
 *      credential verification, and because the answer to a malformed request must not depend on
 *      whether the caller is authenticated.
 *   4. RUN THE HANDLER.
 *
 * THERE IS NO RATE LIMIT ON THIS CLASS AND THAT IS A STATED GAP, NOT AN OVERSIGHT. `0014` §B
 * requires one on a PERMISSIONLESS route; these are authenticated, so §B does not reach them, and
 * the ordinary actor-level limiter lives in the Action pipeline which these deliberately do not
 * enter. What bounds them today: the picker WRITES NOTHING and takes no reservation, and
 * selection is bounded by the control-plane daily budget, which refuses with `quota_exceeded`
 * rather than allowing unbounded writes. A caller holding a valid session can still spend reads.
 * Reported rather than papered over.
 */
export async function dispatchSessionRoute(
  dependencies: SessionRouteDependencies,
  route: SessionRoute,
  request: SessionRouteRequest,
): Promise<Result<unknown>> {
  // ---- 1. No query parameters. Any at all.
  if (request.queryString.length > 0) {
    return err(invalidArgument([detail('', 'unexpected_query_parameter')]));
  }

  // ---- 2. The body floor, against the route's declared fields.
  const parsed = parsePreAuthBody(request.bodyText, route.fields);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  // ---- 3. The session credential.
  const sessionId = await dependencies.readSessionId(request.headers);
  if (!sessionId.ok) {
    return err(sessionId.error);
  }
  if (sessionId.value === null) {
    // No credential presented. `unauthenticated()` takes no arguments, so this is byte-identical
    // to the answer for a credential that was presented and rejected.
    return err(unauthenticated());
  }

  // ---- 4. The handler.
  const handler = dependencies.handlers[route.id];
  if (handler === undefined) {
    // FAIL CLOSED. A registered route with no composed handler is unreachable, not open. It
    // answers `unauthenticated` rather than `not_implemented` because a distinct answer here
    // would tell an unauthenticated caller that the path exists.
    return err(unauthenticated());
  }

  return handler(
    {
      routeId: route.id,
      sessionId: sessionId.value,
      requestId: request.requestId,
      correlationId: request.correlationId,
    },
    parsed.value,
  );
}

/**
 * Reads a required string field that the schema constrains to the platform identifier grammar.
 *
 * THE PATTERN IS THE CONTRACT'S, RESTATED HERE BECAUSE THIS IS THE ONE ROUTE THAT ACCEPTS A
 * TENANT IDENTIFIER. `^[A-Za-z0-9_-]{8,64}$` — the same grammar `kernel/ids.ts` generates at 22
 * characters. Validating it here means a value that could not possibly be an Organization
 * identifier is refused BEFORE it reaches the control plane, so a malformed hint costs a
 * `400` and no database read.
 *
 * IT IS STILL ONLY A SHAPE CHECK. Passing it proves nothing about membership; the hint is
 * validated against the caller's own membership by `selectOrganization`, which is where the
 * anti-oracle property lives.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function readIdentifierField(body: PreAuthBody, field: string): Result<string> {
  const value = body[field];
  if (typeof value !== 'string') {
    // NOT COERCED. `String(12345)` would produce an identifier nobody typed, and coercion on the
    // one route that names a tenant is how a type-confusion bug becomes a tenancy bug.
    return err(invalidArgument([detail(field, 'must_be_a_string')]));
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    // The FIELD NAME and a stable TOKEN. Never the value — `detail()` has no parameter for one,
    // and echoing a rejected organization identifier would put it in logs and error bodies.
    return err(invalidArgument([detail(field, 'invalid_identifier')]));
  }
  return ok(value);
}

/** Re-exported so the transport can render a handler's error without importing the kernel twice. */
export type SessionRouteError = CoreError;
