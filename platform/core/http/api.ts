/**
 * The public HTTP entry point. Transport only.
 *
 * API_STANDARD.md §3: "Every public request requires, in the order of ARCHITECTURE.md §3:
 * authentication, server-derived tenant, authorization, schema validation, rate limiting,
 * idempotency where applicable, and audit logging." Everything from server-derived tenant
 * onwards is `action/pipeline.ts`. This file does the two things that are genuinely about
 * HTTP — turning a request into an Action input, and turning a result into a response —
 * and nothing else. There is no business rule here and no place to put one.
 *
 * RATE LIMITING NOW EXISTS, and it is not here. `docs/decisions/0013` puts it in
 * `action/pipeline.ts` at `ARCHITECTURE.md` §3's stage 5, counted by a SQLite-backed Durable
 * Object, per authenticated actor, per Organization and per source address. This file's only
 * part in it is the one thing HTTP knows and the pipeline cannot: the caller's source address,
 * which arrives already HASHED from the transport adapter and is passed through untouched.
 * Core never sees the address itself — a raw address is personal data about a tenant's staff,
 * and the counter needs only equality.
 *
 * WHAT IS NOT BUILT, NAMED SO IT IS NOT MISTAKEN FOR AN OVERSIGHT:
 *
 *   - `Retry-After` ON A `rate_limited` RESPONSE. API_STANDARD.md §10 requires it, the
 *     coordinator computes the value, and it is NOT returned: `CoreError` has no channel for a
 *     header, and giving it one changes the shape of the error envelope, which is contract
 *     surface and not this agent's to author. Reported to the Team Lead as owed.
 *   - PRE-AUTHENTICATION RATE LIMITING. The limiter needs a coordinator instance, and the
 *     instance is named from the AUTHENTICATED Organization, so an unauthenticated flood is
 *     not counted. It costs nothing today — production ships a deny-all principal resolver and
 *     an unauthenticated request reaches no storage — but the day AZ2 lands, authentication
 *     itself will do a lookup and that lookup will be unprotected. It belongs with AZ2, and
 *     the port is already shaped to serve it.
 *   - IDEMPOTENCY. §9 says every unsafe operation ACCEPTS an `Idempotency-Key` and that
 *     Actions marked `idempotent: true` REQUIRE one. Every Customer Directory Action is
 *     `idempotent: false`, so none requires one; the key store that would honour an offered
 *     one does not exist. The cost is the contract's own CD-4: a retried create after a
 *     network failure produces a second customer. That is recorded as accepted, so it is
 *     not repaired here by inventing a store.
 *   - QUOTAS. `quota_exceeded` is declared on CreateCustomer so the error path exists, but
 *     CD-10 records that the per-Organization customer limit is a product decision that has
 *     not been made. A number invented here would set that decision by side effect.
 */

import type { PipelineDependencies } from '../action/pipeline.ts';
import { invokeAction } from '../action/pipeline.ts';
import type { AppPermissionEnvelope } from '../authorization/authorizer.ts';
import type { PrincipalResolver } from '../identity/principal-resolver.ts';
import type { Router } from './router.ts';
import { mergeInputSources } from './router.ts';
import { renderError, renderSuccess } from './response.ts';
import { detail, internal, invalidArgument, notFound, notImplemented } from '../kernel/errors.ts';
import type { IdGenerator } from '../kernel/ids.ts';

export type ApiDependencies = PipelineDependencies & {
  readonly principals: PrincipalResolver;
  readonly ids: IdGenerator;
};

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const METHODS_WITH_BODY: ReadonlySet<string> = new Set(['POST', 'PATCH', 'PUT']);

function readCorrelationId(request: Request, ids: IdGenerator): string {
  // A correlation id is an observability value, not a security one, so accepting a
  // caller-supplied one is safe -- but only after checking its shape. An unvalidated header
  // written into a log is a log-injection vector, and it would also be the one
  // caller-controlled string that reaches storage.
  const offered = request.headers.get('x-correlation-id');
  if (offered !== null && CORRELATION_ID_PATTERN.test(offered)) {
    return offered;
  }
  return ids.generate();
}

/**
 * What the transport knows about where a request came from.
 *
 * `sourceAddressHash` is ALREADY HASHED by the adapter that read it. Passing a hash rather than
 * an address is not a nicety: the rate limiter needs only equality, and an address stored or
 * logged anywhere is personal data about a tenant's staff that nothing in this design requires.
 *
 * NULL IS NOT AN EXEMPTION — every unknown source shares one bucket, so an adapter that omits
 * it throttles harder rather than switching the level off. That is why this parameter has no
 * default: a caller has to decide, and the fail-closed direction is the one that costs nothing
 * to choose.
 */
export type RequestOrigin = {
  readonly sourceAddressHash: string | null;
};

export async function handleRequest(
  dependencies: ApiDependencies,
  router: Router,
  app: AppPermissionEnvelope,
  basePath: string,
  request: Request,
  origin: RequestOrigin = { sourceAddressHash: null },
): Promise<Response> {
  const requestId = dependencies.ids.generate();
  const correlationId = readCorrelationId(request, dependencies.ids);

  const url = new URL(request.url);
  if (!url.pathname.startsWith(basePath)) {
    return renderError(notFound(), requestId, correlationId);
  }
  const routePath = url.pathname.slice(basePath.length);

  const matched = router.match(request.method, routePath);

  if (matched.kind === 'none') {
    // An unmatched path and an unmatched method both answer not_found. There is no
    // `method_not_allowed` in the taxonomy, and answering 405 would tell a caller that the
    // path exists, which for `/customers/{customer_id}` is a statement about a record.
    return renderError(notFound(), requestId, correlationId);
  }

  if (matched.kind === 'deferred') {
    // THE DEFERRED ACTIONS TERMINATE HERE. No principal is resolved, no permission is
    // evaluated, no storage handle is obtained, and no handler exists to call — the route
    // carries an id string and nothing callable (router.ts). This is the answer the
    // Customer Directory contract asks for: "the routes are absent or return
    // not_implemented, and no path reaches a handler."
    return renderError(notImplemented(), requestId, correlationId);
  }

  // ---- Step 1. Authenticate. Headers are read HERE and nowhere else; they are never
  // merged into the Action input.
  const principal = await dependencies.principals.resolve({
    headers: new Map(
      [...request.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]),
    ),
  });
  if (!principal.ok) {
    return renderError(principal.error, requestId, correlationId);
  }

  let body: Record<string, unknown> | undefined;
  if (METHODS_WITH_BODY.has(request.method)) {
    const text = await request.text();
    if (text.length === 0) {
      body = {};
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return renderError(
          invalidArgument([detail('', 'must_be_valid_json')]),
          requestId,
          correlationId,
        );
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return renderError(
          invalidArgument([detail('', 'must_be_an_object')]),
          requestId,
          correlationId,
        );
      }
      body = parsed as Record<string, unknown>;
    }
  }

  const queryParams: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(queryParams, key)) {
      // A repeated query parameter is ambiguous. Taking the first or the last is a
      // precedence rule, and a precedence rule is a way for a caller to shadow a value a
      // reviewer assumed was authoritative.
      return renderError(
        invalidArgument([detail(key, 'repeated_parameter')]),
        requestId,
        correlationId,
      );
    }
    queryParams[key] = value;
  }

  const merged = mergeInputSources(
    matched.pathParams,
    queryParams,
    body,
    matched.route.integerQueryParams ?? [],
  );
  if (merged === undefined) {
    return renderError(
      invalidArgument([detail('', 'conflicting_input_sources')]),
      requestId,
      correlationId,
    );
  }

  const outcome = await invokeAction(
    dependencies,
    matched.route.action,
    {
      principal: principal.value,
      app,
      requestId,
      correlationId,
      sourceAddressHash: origin.sourceAddressHash,
    },
    merged,
  );

  if (!outcome.ok) {
    return renderError(outcome.error, requestId, correlationId);
  }

  try {
    return renderSuccess(outcome.value, matched.route.successStatus, requestId, correlationId);
  } catch {
    return renderError(internal(), requestId, correlationId);
  }
}
