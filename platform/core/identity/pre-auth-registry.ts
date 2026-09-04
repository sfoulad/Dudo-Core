/**
 * ===========================================================================================
 * THE CLOSED PRE-AUTHENTICATION ENTRY-POINT REGISTRY. `docs/decisions/0014` §B, amending
 * `docs/decisions/0007` D1.
 * ===========================================================================================
 *
 * `0007` D1 stands and is not weakened: **an entry point with no declared permission is
 * unreachable, not open.** `0014` §B adds exactly one exception, and this file is the whole of
 * it: *"A route without a permission is unreachable unless it is registered in a closed
 * `PreAuthEntryPoint` registry. The registry is Core-owned and enumerated. It is never
 * manifest-declarable — no App may add to it."*
 *
 * ===========================================================================================
 * THE SENTENCE THIS FILE IS BUILT AROUND
 * ===========================================================================================
 *
 * §B: *"This is an admission rule, not a fake permission granted to an anonymous user. The
 * distinction matters: a pseudo-principal holding a pseudo-permission would flow through the
 * authorization pipeline and could accumulate grants. An admission rule cannot."*
 *
 * So there is, in this file and in `pre-auth-admission.ts`:
 *
 *   - NO anonymous `AuthenticatedPrincipal`, and nothing that can be widened into one. A
 *     `PreAuthEntryPoint` has no `principal`, no `organizationId`, no `grants` and no
 *     `authorizedBusinessIds` — not set to null, not set to empty: **absent**. There is no
 *     field an authorization pipeline could read.
 *   - NO permission id, NO scope, NO `Scope` import. A pre-auth entry point is not an
 *     `ActionDefinition` and is not assignable to one: it has no `permission`, no `parseInput`
 *     of the Action shape, no `handle` returning `ActionOutcome`, and no `maxRowWrites`. It
 *     cannot be placed in an Action route table, and `invokeAction` cannot be called with one.
 *   - NO bypass flag anywhere on `ActionDefinition`. Nothing in `action/action.ts` gained a
 *     field for this. An Action still declares exactly one permission and one scope, and
 *     `assertDeclaredPermission` (added in the same change) now makes a *blank* permission a
 *     construction-time failure rather than a silently unreachable Action.
 *
 * The two mechanisms therefore never meet. A request is either an Action invocation, which is
 * authorized, or a pre-auth admission, which is admitted; they are matched by different code
 * against different tables and produce different types.
 *
 * ===========================================================================================
 * HOW THE REGISTRY IS STRUCTURALLY CLOSED TO APPS — five devices, not a prohibition
 * ===========================================================================================
 *
 * 1. **THE ID IS A CLOSED UNION OF FIVE STRING LITERALS.** `PreAuthEntryPointId` is not
 *    `string`. A sixth value is not expressible without editing this file, which lives in
 *    `platform/core/**` — a path no App owns and no App may edit (`.claude/rules/architecture.md`
 *    §2). Adding one is therefore a Core change with a Core reviewer, which is precisely what
 *    "enumerated" means.
 *
 * 2. **THERE IS NO REGISTRATION FUNCTION.** No `register`, no `add`, no `extend`, no mutable
 *    array export. `ENTRY_POINTS` is a module-private frozen array of frozen objects, published
 *    only through read accessors. There is no runtime call by which anything could grow it.
 *
 * 3. **THE MANIFEST HAS NO CHANNEL AND CANNOT GAIN ONE BY ACCIDENT.**
 *    `packages/contracts/registries/app-manifest.schema.json` is `additionalProperties: false`
 *    at the top level and declares no route, path, endpoint or entry-point field of any kind.
 *    A manifest that tried to declare a pre-auth route would fail schema validation before any
 *    Dudo code read it. That schema is `architecture-agent`'s and was not touched here; this is
 *    a statement about what it already says, verified against it.
 *
 * 4. **NOTHING READS A MANIFEST TO BUILD THIS TABLE.** The table is a literal. It takes no
 *    input, consults no store, reads no configuration and accepts no injection. An App cannot
 *    influence a value it is never asked for.
 *
 * 5. **CORE MATCHES FIRST, SO AN APP CANNOT SHADOW OR IMPERSONATE ONE.** `http/api.ts` matches
 *    the absolute request path against this registry BEFORE the App router is consulted, and
 *    `assertNoReservedPathCollision` refuses a route table whose paths could resolve onto a
 *    reserved one. An App route at a pre-auth path is therefore unreachable, and — the more
 *    important direction — an App cannot *serve* a pre-auth path and so cannot present itself
 *    as the login endpoint.
 *
 * ===========================================================================================
 * WHAT EACH ENTRY POINT MAY DO, DECLARED RATHER THAN REMEMBERED
 * ===========================================================================================
 *
 * §B requires every pre-auth route to: declare `access: pre-authentication`; be explicitly
 * registered; carry strict input validation and rate limiting; reveal no account-existence
 * difference; access no tenant business data; issue no business permission; and fail closed.
 *
 * `access: 'pre-authentication'` is a required literal field on every entry, so the declaration
 * §B asks for is present in the type rather than in a comment. The rest are enforced in
 * `pre-auth-admission.ts` against the flags declared here — `disclosure`, `outcomes`, and the
 * `kind: 'static' | 'delegated'` split that makes the health endpoint incapable of holding a
 * handler at all.
 */

/**
 * The five, and only the five, that `0014` §B permits. Extending this union is the only way to
 * add a pre-auth entry point, and it is a Core edit.
 *
 * `platform.health` is deliberately in the `platform.` namespace rather than `identity.`: it is
 * not part of the identity flow, and giving it a different prefix stops it being swept into a
 * future "everything under identity may do X".
 */
export type PreAuthEntryPointId =
  | 'identity.login.start'
  | 'identity.login.complete'
  | 'identity.session.refresh'
  | 'identity.session.revoke'
  | 'platform.health';

export type PreAuthHttpMethod = 'GET' | 'POST';

/**
 * What outcomes an entry point's handler is permitted to produce.
 *
 * IT IS A DECLARATION, AND `pre-auth-admission.ts` ENFORCES IT. An outcome outside the declared
 * set is not passed through; it is replaced by the entry point's `collapseTo` value and the
 * substitution is announced. That is how "reveal no account-existence difference" is made
 * structural for the two entry points where any variation at all would be a signal — see
 * `disclosure` below.
 */
export type PreAuthOutcomeKind =
  | 'acknowledged'
  | 'issued'
  /**
   * `cleared` — REVOCATION. `docs/decisions/0018` §B, amending `0014` §B.
   *
   * It renders the acknowledgement body plus a CONSTANT, ARGUMENT-FREE CLEARING COOKIE, and the
   * two adjectives are the whole security argument. The handler supplies nothing: no name, no
   * value, no lifetime. `http/pre-auth-http.ts` emits one fixed `Set-Cookie` that is byte-
   * identical for a valid session, a forged credential, an unknown session, a replay, and a
   * request that presented no credential at all.
   *
   * WHY IT IS NOT `issued` WEARING A DIFFERENT NAME, which is the objection it has to survive.
   * `issued` carries `credentials` the handler chose, so it can vary per request and can convey a
   * capability — which is why `outcomeOfKind` refuses to let any entry point COLLAPSE to it: a
   * failure path that issued a credential would be an authentication bypass built out of an error
   * handler. `cleared` has no payload to vary and REMOVES a credential rather than granting one,
   * so collapsing to it is safe in the one direction that matters. A caller cannot learn anything
   * from a response that is the same bytes in every case.
   *
   * IT REPLACES `acknowledged` FOR REVOCATION RATHER THAN JOINING IT, so
   * `assertRegistryIsCoherent`'s rule that a `collapsed` entry point declares exactly one outcome
   * still holds — one answer, one branch, nothing to tell apart.
   */
  | 'cleared'
  | 'refused'
  | 'unavailable';

/**
 * ===========================================================================================
 * THE DISCLOSURE CLASS. This is the field that closes the account-existence oracle.
 * ===========================================================================================
 *
 *   `collapsed`  THE HANDLER CANNOT SIGNAL ANYTHING. Every outcome it returns — success,
 *                refusal, its own internal failure, or a thrown exception — is rendered as the
 *                SAME fixed response with the same bytes. Used for `identity.login.start` and
 *                `identity.session.revoke`, where there is no legitimate reason for the answer
 *                to vary with what the caller submitted, and therefore no reason to leave a
 *                channel through which it could.
 *
 *                The cost is stated rather than hidden: a genuine outage during login start is
 *                invisible to the caller, who is told "accepted" and never receives a code.
 *                That is the correct trade for these two — the alternative is an endpoint that
 *                answers differently for a real address than for one nobody has ever used — and
 *                the outage is NOT invisible internally: it is announced through
 *                `announcePreAuthFailure`, which cannot be configured off.
 *
 *   `credential` THE ANSWER DEPENDS ON A CREDENTIAL THE CALLER PRESENTED, and may therefore
 *                differ: a valid credential is accepted, an invalid one is refused. That is a
 *                statement about the credential, not about whether an account exists — an
 *                attacker who can produce a valid credential already holds the account. Both
 *                branches use fixed, argument-free values, so the only variation is
 *                accept/refuse and never *why*. Used for login completion and session refresh.
 *
 *   `none`       No account and no credential is involved at all. `platform.health`.
 */
export type PreAuthDisclosureClass = 'collapsed' | 'credential' | 'none';

const PRE_AUTH_ENTRY_POINT_BRAND: unique symbol = Symbol('dudo.identity.preAuthEntryPoint');

/**
 * A registered pre-authentication entry point.
 *
 * NOTE WHAT IS ABSENT AND MAY NEVER BE ADDED: `permission`, `scope`, `principal`,
 * `organizationId`, `grants`, `tenant`, `store`, `handle`. The first two would make this a fake
 * permission; the next four would make it a fake principal; the last two would give it a path to
 * tenant business data. §B forbids all of them, and absence is the only form of "forbidden" that
 * survives a future edit made in a hurry.
 */
export type PreAuthEntryPoint = {
  readonly [PRE_AUTH_ENTRY_POINT_BRAND]: true;
  readonly id: PreAuthEntryPointId;
  /** §B's required declaration, as a literal field rather than a comment. */
  readonly access: 'pre-authentication';
  readonly method: PreAuthHttpMethod;
  /**
   * The ABSOLUTE path. Not relative to an App's base path, because a pre-auth entry point does
   * not belong to an App and must not move when an App is mounted somewhere else.
   */
  readonly path: string;
  readonly disclosure: PreAuthDisclosureClass;
  /** The outcomes the handler may produce. Anything else is replaced by `collapseTo`. */
  readonly outcomes: readonly PreAuthOutcomeKind[];
  /** What an out-of-set, failed or thrown outcome becomes. Always a member of `outcomes`. */
  readonly collapseTo: PreAuthOutcomeKind;
  /**
   * `static` — Core serialises a frozen constant. THE ENTRY POINT HAS NO HANDLER AND CANNOT BE
   * GIVEN ONE, because the handler table is typed to reject it (`DelegatedPreAuthEntryPointId`).
   * This is how §B's "a health endpoint containing no tenant or user data" is asserted
   * structurally rather than reviewed: there is no code that runs, so there is nothing that
   * could read a tenant or a user, and `assertStaticBodyCarriesNoData` checks the constant's
   * own shape at module load.
   *
   * `delegated` — the identity slice supplies the handler at composition. Absent, the entry
   * point fails closed.
   */
  readonly kind: 'static' | 'delegated';
  /**
   * Requests per 60-second window from one source address, for this entry point.
   *
   * PER ENTRY POINT RATHER THAN ONE NUMBER FOR ALL FIVE, because they have genuinely different
   * shapes: a person logs in rarely and a client refreshes a session on a timer. The numbers and
   * the hole they leave open are argued in `pre-auth-admission.ts`, not here.
   */
  readonly sourceLimitPerWindow: number;
  /**
   * Whether this entry point's handler may perform a durable write.
   *
   * DECLARED SO THAT `0014` §A.11 — "all storage writers must use this admission port" — has
   * something to check against on a path that has no Organization and therefore no
   * `RequestCoordination`. `platform.health` declares `false`, which combined with `kind:
   * 'static'` means it has neither the permission nor the machinery to write.
   */
  readonly writes: boolean;
};

/** The ids that MAY have a handler. `platform.health` is deliberately not one of them. */
export type DelegatedPreAuthEntryPointId = Exclude<PreAuthEntryPointId, 'platform.health'>;

function entry(fields: Omit<PreAuthEntryPoint, typeof PRE_AUTH_ENTRY_POINT_BRAND>): PreAuthEntryPoint {
  const value = { ...fields };
  Object.defineProperty(value, PRE_AUTH_ENTRY_POINT_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(value) as PreAuthEntryPoint;
}

/**
 * ===========================================================================================
 * THE TABLE. Five entries. Module-private, frozen, and reachable only through the accessors.
 * ===========================================================================================
 *
 * THE PATHS ARE UNDER TWO RESERVED PREFIXES, `/auth/` and `/health`, so that "is this path
 * reserved" is a prefix test rather than a membership test. A prefix test is what lets
 * `assertNoReservedPathCollision` refuse an App route table that has not been written yet, for a
 * path that does not exist yet — which is the only version of that check that survives the next
 * App.
 */
const ENTRY_POINTS: readonly PreAuthEntryPoint[] = Object.freeze([
  entry({
    id: 'identity.login.start',
    access: 'pre-authentication',
    method: 'POST',
    path: '/auth/login/start',
    // COLLAPSED. The one endpoint that is handed an account identifier by an unauthenticated
    // caller, and therefore the one where any variation at all is an existence oracle. Its
    // answer is a constant.
    disclosure: 'collapsed',
    outcomes: ['acknowledged'],
    collapseTo: 'acknowledged',
    kind: 'delegated',
    // Low, because starting a login is a human action a person performs a handful of times a
    // day, and because this is the endpoint an enumeration campaign targets.
    sourceLimitPerWindow: 20,
    writes: true,
  }),
  entry({
    id: 'identity.login.complete',
    access: 'pre-authentication',
    method: 'POST',
    path: '/auth/login/complete',
    disclosure: 'credential',
    outcomes: ['issued', 'refused', 'unavailable'],
    collapseTo: 'refused',
    kind: 'delegated',
    sourceLimitPerWindow: 20,
    writes: true,
  }),
  entry({
    id: 'identity.session.refresh',
    access: 'pre-authentication',
    method: 'POST',
    path: '/auth/session/refresh',
    disclosure: 'credential',
    outcomes: ['issued', 'refused', 'unavailable'],
    collapseTo: 'refused',
    kind: 'delegated',
    // Higher than login: a client refreshes on a timer, and several tabs of one application
    // refresh independently.
    sourceLimitPerWindow: 60,
    writes: true,
  }),
  entry({
    id: 'identity.session.revoke',
    access: 'pre-authentication',
    method: 'POST',
    path: '/auth/session/revoke',
    // COLLAPSED, AND FOR A REASON THAT IS EASY TO MISS. A logout that answered "no such session"
    // for an unknown token and "done" for a real one is a TOKEN-VALIDITY ORACLE: an attacker
    // holding a stolen or guessed token learns whether it is live without using it. So revocation
    // always answers the same thing, whether it revoked something, revoked nothing, or failed.
    disclosure: 'collapsed',
    // `cleared` RATHER THAN `acknowledged`, per docs/decisions/0018 §B. The session cookie is
    // HttpOnly, so no client can clear it; a logout that did not clear it left a dead credential
    // in the browser for the session's full lifetime. Still exactly ONE outcome, so the collapsed
    // rule is unchanged — the answer is a constant, it is simply a constant that includes a fixed
    // `Set-Cookie`.
    outcomes: ['cleared'],
    collapseTo: 'cleared',
    kind: 'delegated',
    sourceLimitPerWindow: 60,
    writes: true,
  }),
  entry({
    id: 'platform.health',
    access: 'pre-authentication',
    method: 'GET',
    path: '/health',
    disclosure: 'none',
    outcomes: ['acknowledged'],
    collapseTo: 'acknowledged',
    // STATIC. No handler, therefore no code, therefore nothing that could read a tenant or a
    // user. See `HEALTH_BODY`.
    kind: 'static',
    sourceLimitPerWindow: 120,
    // It cannot write, and `kind: 'static'` means it has nothing to write with.
    writes: false,
  }),
]);

const BY_ID: ReadonlyMap<PreAuthEntryPointId, PreAuthEntryPoint> = new Map(
  ENTRY_POINTS.map((point) => [point.id, point]),
);

/** The reserved prefixes. A path under one of these belongs to Core and to nothing else. */
export const RESERVED_PRE_AUTH_PATH_PREFIXES: readonly string[] = Object.freeze([
  '/auth/',
  '/health',
]);

/**
 * ===========================================================================================
 * THE HEALTH BODY. `0014` §B: "a health endpoint containing NO tenant or user data."
 * ===========================================================================================
 *
 * ONE FROZEN CONSTANT WITH ONE FIELD WHOSE VALUE IS A LITERAL. There is no clock read, no build
 * identifier, no version, no commit, no binding name, no dependency status and no counter.
 *
 * WHY EVEN A HARMLESS-LOOKING EXTRA IS REFUSED. A health endpoint is the one route on the
 * platform that answers an unauthenticated caller with a body, so anything placed in it is
 * published to the internet: a version string dates the deployment for anyone matching CVEs, a
 * dependency list is a map of what to attack, an uptime or a request counter is a traffic
 * signal, and a "tenants: 4" is a business fact about Dudo's customers. None of those is tenant
 * data in the obvious sense, and every one of them is a disclosure. The rule that survives is
 * therefore the narrow one — the body is a constant — and it is checked below rather than
 * trusted.
 */
export const HEALTH_BODY: Readonly<{ status: 'ok' }> = Object.freeze({ status: 'ok' });

/** The exact bytes. Rendered from here so no serialisation choice can vary per request. */
export const HEALTH_BODY_TEXT: string = JSON.stringify(HEALTH_BODY);

export class StaticBodyDisclosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaticBodyDisclosureError';
  }
}

/**
 * Runs at module load, like `assertAllocationsAreCoherent` in `protection/write-admission.ts`
 * and for the same reason: a health endpoint that started disclosing something would do it
 * silently, to everyone, for as long as nobody looked.
 *
 * WHAT IT CAN CHECK AND WHAT IT CANNOT. It checks that the constant has exactly one key, that
 * the key is `status`, and that the value is the literal `ok` — so a field added to `HEALTH_BODY`
 * stops the module rather than shipping. It cannot check that a *future* field is harmless,
 * because harmlessness is not a computable property; it makes adding one a deliberate act that
 * also has to edit this assertion, which is the same review surface the tenant predicate has.
 */
export function assertStaticBodyCarriesNoData(): void {
  const keys = Object.keys(HEALTH_BODY);
  if (keys.length !== 1 || keys[0] !== 'status' || HEALTH_BODY.status !== 'ok') {
    throw new StaticBodyDisclosureError(
      'The health endpoint body is no longer the fixed constant { status: "ok" }. It is the ' +
        'one route that answers an unauthenticated caller with a body, so every field in it is ' +
        'published to the internet: a version dates the deployment, a dependency list is a map ' +
        'of what to attack, a counter is a traffic signal, and a tenant count is a business ' +
        'fact about Dudo customers. docs/decisions/0014 §B requires it to contain no tenant or ' +
        'user data; this constant is how that is asserted rather than reviewed.',
    );
  }
  if (Object.isFrozen(HEALTH_BODY) !== true) {
    throw new StaticBodyDisclosureError('The health endpoint body constant is not frozen.');
  }
}

assertStaticBodyCarriesNoData();

// =============================================================================================
// Read accessors. There is deliberately no writer.
// =============================================================================================

export function preAuthEntryPoints(): readonly PreAuthEntryPoint[] {
  return ENTRY_POINTS;
}

export function preAuthEntryPoint(id: PreAuthEntryPointId): PreAuthEntryPoint {
  const found = BY_ID.get(id);
  if (found === undefined) {
    // Unreachable while `PreAuthEntryPointId` and `ENTRY_POINTS` agree, which
    // `assertRegistryIsCoherent` checks at load. Kept so the function has no `undefined` branch
    // for a caller to handle wrongly.
    throw new PreAuthEntryPointNotRegisteredError(String(id));
  }
  return found;
}

/**
 * Matches an ABSOLUTE request path. Exact match only.
 *
 * NO PATH PARAMETERS AND NO PATTERNS, DELIBERATELY. A pre-auth route has no authenticated
 * context in which to interpret a path segment, so a `{token}` in a pre-auth path would be an
 * unauthenticated caller-supplied string reaching a lookup through the URL — the shape that
 * ends up in access logs, in referrers and in browser history. Anything the caller must supply
 * arrives in the body, which is validated.
 *
 * THE METHOD IS PART OF THE MATCH AND A MISMATCH RETURNS `undefined`, so `GET /auth/login/start`
 * is `not_found` exactly as an unknown path is. Answering `405` would confirm that the path
 * exists, which for a login endpoint is a small but free piece of reconnaissance.
 */
export function matchPreAuthEntryPoint(
  method: string,
  path: string,
): PreAuthEntryPoint | undefined {
  const normalized = normalizePath(path);
  for (const point of ENTRY_POINTS) {
    if (point.method === method && point.path === normalized) {
      return point;
    }
  }
  return undefined;
}

/**
 * Is this absolute path Core's?
 *
 * A PREFIX TEST, NOT A MEMBERSHIP TEST. Membership would answer only for the five paths that
 * exist today and would silently permit an App to claim `/auth/login/start/v2` — a path that is
 * not registered, is served by an App, and looks to a user exactly like the login endpoint.
 */
export function isReservedPreAuthPath(path: string): boolean {
  const normalized = normalizePath(path);
  return RESERVED_PRE_AUTH_PATH_PREFIXES.some(
    (prefix) => normalized === trimTrailingSlash(prefix) || normalized.startsWith(prefix),
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Collapses `//a//b/` to `/a/b`.
 *
 * IT EXISTS FOR THE RESERVATION CHECK, NOT FOR TIDINESS. `//auth//login/start` and
 * `/auth/login/start/` are the same route to most servers and different strings to a naive
 * comparison, and a reservation that can be stepped around by adding a slash reserves nothing.
 */
function normalizePath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

// =============================================================================================
// Guards
// =============================================================================================

export class PreAuthEntryPointNotRegisteredError extends Error {
  constructor(id: string) {
    super(
      `${id} is not a registered pre-authentication entry point. A route without a permission ` +
        'is UNREACHABLE, not open (docs/decisions/0007 D1). docs/decisions/0014 §B permits ' +
        'exactly five exceptions, they are enumerated in Core, and the registry is never ' +
        'manifest-declarable: no App may add to it.',
    );
    this.name = 'PreAuthEntryPointNotRegisteredError';
  }
}

/**
 * The runtime brand check.
 *
 * NEEDED BECAUSE THIS REPOSITORY HAS NO TYPE-CHECK STEP, exactly as `assertDenialGroupKey` and
 * `assertWriteReservation` are. A type-only brand is a comment. The value that reaches
 * `dispatchPreAuthRequest` must be one of the five frozen singletons above, so a hand-built
 * object with the right fields — the shape an App or a careless composition root would produce —
 * is refused rather than served.
 */
export function assertRegisteredPreAuthEntryPoint(value: PreAuthEntryPoint): void {
  const branded = value as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[PRE_AUTH_ENTRY_POINT_BRAND] !== true) {
    throw new PreAuthEntryPointNotRegisteredError('an unbranded value');
  }
  // The brand alone would let a second frozen object minted by a copy of `entry` pass. Identity
  // against the table is what makes the registry CLOSED rather than merely typed.
  if (!ENTRY_POINTS.includes(value)) {
    throw new PreAuthEntryPointNotRegisteredError(String(value.id));
  }
}

export class ReservedPathCollisionError extends Error {
  constructor(path: string) {
    super(
      `An application route resolves to ${path}, which is reserved for a pre-authentication ` +
        'entry point (docs/decisions/0014 §B). Core matches the reserved paths first, so the ' +
        'route is unreachable; it is refused at construction rather than left as dead code, ' +
        'because a route table that believes it serves the login path is a route table someone ' +
        'will eventually make serve it.',
    );
    this.name = 'ReservedPathCollisionError';
  }
}

/**
 * Refuses a route table that could resolve onto a reserved path once its base path is applied.
 *
 * CALLED BY THE COMPOSITION ROOT AND BY `handleRequest`'s caller, not per request. It takes the
 * base path because an App's routes are relative and the reservation is absolute: `/login` under
 * base path `/api/v1` is harmless, and under base path `` it is not.
 */
export function assertNoReservedPathCollision(
  basePath: string,
  routePaths: readonly string[],
): void {
  for (const routePath of routePaths) {
    if (isReservedPreAuthPath(`${basePath}${routePath}`)) {
      throw new ReservedPathCollisionError(normalizePath(`${basePath}${routePath}`));
    }
  }
}

/**
 * Registry coherence, at module load.
 *
 * Checks the properties the rest of the code assumes and would otherwise assume silently:
 * every path is reserved (so the collision guard actually covers them), ids and paths are
 * unique, `collapseTo` is a member of `outcomes` (or the collapse would produce an outcome the
 * entry point does not permit), only `delegated` entries have outcomes other than
 * `acknowledged`, and a `static` entry never declares `writes`.
 */
export class PreAuthRegistryIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreAuthRegistryIncoherentError';
  }
}

export function assertRegistryIsCoherent(): void {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const point of ENTRY_POINTS) {
    if (seenIds.has(point.id) || seenPaths.has(`${point.method} ${point.path}`)) {
      throw new PreAuthRegistryIncoherentError(
        `The pre-authentication registry declares ${point.id} or its route twice.`,
      );
    }
    seenIds.add(point.id);
    seenPaths.add(`${point.method} ${point.path}`);

    if (point.access !== 'pre-authentication') {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} does not declare access: pre-authentication (docs/decisions/0014 §B).`,
      );
    }
    if (!isReservedPreAuthPath(point.path)) {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} is served at ${point.path}, which is outside the reserved prefixes ` +
          `${RESERVED_PRE_AUTH_PATH_PREFIXES.join(', ')}. An entry point outside them is one an ` +
          'App route table could legitimately claim, so the collision guard would not cover it.',
      );
    }
    if (!point.outcomes.includes(point.collapseTo)) {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} collapses to ${point.collapseTo}, which is not one of its declared ` +
          'outcomes. The collapse target is what a failed, thrown or out-of-set outcome ' +
          'becomes, so it must itself be permitted.',
      );
    }
    if (point.disclosure === 'collapsed' && point.outcomes.length !== 1) {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} is disclosure: collapsed and declares ${String(point.outcomes.length)} ` +
          'outcomes. A collapsed entry point has exactly one possible answer — that is what ' +
          '"reveal no account-existence difference" means when the caller supplies an account ' +
          'identifier — and more than one is a channel.',
      );
    }
    if (point.kind === 'static' && point.writes) {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} is static and declares writes: true. A static entry point runs no code.`,
      );
    }
    if (point.kind === 'static' && point.disclosure !== 'none') {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} is static and claims a disclosure class other than none.`,
      );
    }
    if (!Number.isInteger(point.sourceLimitPerWindow) || point.sourceLimitPerWindow <= 0) {
      throw new PreAuthRegistryIncoherentError(
        `${point.id} declares a non-positive source rate limit. docs/decisions/0014 §B requires ` +
          'rate limiting on every pre-authentication route; a limit of zero or absent is not one.',
      );
    }
  }
  if (ENTRY_POINTS.length !== 5) {
    throw new PreAuthRegistryIncoherentError(
      `The pre-authentication registry holds ${String(ENTRY_POINTS.length)} entry points. ` +
        'docs/decisions/0014 §B permits exactly five — login start, login completion, session ' +
        'refresh, revocation, and a health endpoint containing no tenant or user data. A sixth ' +
        'is a change to an Accepted decision and needs a decision record, not an edit.',
    );
  }
}

assertRegistryIsCoherent();
