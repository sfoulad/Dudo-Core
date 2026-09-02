/**
 * The HTTP surface. Routes map to Actions; there are no handlers.
 *
 * The Customer Directory contract's httpBinding note is the rule this file implements:
 * "Every route is served by the same Action definition that the internal API and the SDK
 * use. There is no route handler containing logic — an operation with a handler but no
 * Action has no permission, no schema, no audit and no AI surface."
 *
 * A `Route` therefore carries an `ActionDefinition` or a `deferred` marker. There is no
 * variant that carries a function, so a route with logic in it is not expressible.
 *
 * HOW A REQUEST BECOMES AN ACTION INPUT, AND WHY THE MERGE IS SAFE.
 *
 * Path parameters, query parameters and the JSON body are merged into ONE object and
 * handed to the Action's own validation, which rejects unknown fields
 * (`additionalProperties: false` on every input shape in the contract). Two consequences,
 * and both are load-bearing:
 *
 *   - `?tenant_id=...`, `{"organization_id": "..."}` and `?status=archived` on an Action
 *     that declares no `status` are all rejected as `unknown_field` -> `invalid_argument`,
 *     before any handler runs. That is how the header/query/body tenant-override vectors
 *     are refused. It proves INPUT VALIDATION and it is NOT tenant isolation: az7-r3 is
 *     explicit that the isolation-proving vector is a perfectly schema-valid request whose
 *     only cross-tenant element is the record identifier. The two must be reported
 *     separately.
 *   - HEADERS ARE NOT MERGED, EVER. A header the caller controls is one of the sources
 *     MULTITENANCY_STANDARD.md §3 forbids deriving tenant from, and the way to guarantee
 *     that is for headers not to reach the input at all. They are read only by
 *     authentication, which verifies a credential rather than trusting a claim.
 *
 * COLLISION BETWEEN SOURCES IS A REJECTED REQUEST, NOT A PRECEDENCE RULE. If the same field
 * arrives in two places, the request fails. A precedence rule would mean a caller could
 * shadow a path parameter with a query parameter, and whichever one loses is the one a
 * reviewer assumed was authoritative.
 */

import type { AnyActionDefinition } from '../action/action.ts';
import { assertAuditPolicy } from '../action/action.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * A route that is contracted but deliberately not built.
 *
 * The Customer Directory contract requires the two deferred Actions to be PROVABLY not
 * built: "the routes are absent or return not_implemented, and no path reaches a handler.
 * An Action that is contracted but not built must be provably not built, or its absence is
 * indistinguishable from a handler nobody noticed shipping."
 *
 * A `deferred` route carries an ACTION ID STRING and nothing else. It has no
 * `ActionDefinition`, so there is no permission to evaluate, no input to validate, no
 * storage handle to obtain and no handler to call — the type makes all four impossible
 * rather than merely absent. The router answers `not_implemented` from the route table
 * itself.
 */
export type Route =
  | {
      readonly kind: 'action';
      readonly method: HttpMethod;
      readonly path: string;
      readonly action: AnyActionDefinition;
      /** The Action's declared `httpStatusOnSuccess`. 201 on create; 200 elsewhere. */
      readonly successStatus: number;
      /**
       * Query parameters that the Action's schema declares as integers. Everything in a
       * query string is a string; these are coerced before validation so that
       * `?page_size=25` is the integer 25 and `?page_size=abc` fails as `must_be_integer`
       * rather than as `must_be_string`.
       */
      readonly integerQueryParams?: readonly string[];
    }
  | {
      readonly kind: 'deferred';
      readonly method: HttpMethod;
      readonly path: string;
      readonly actionId: string;
    };

export type RouteMatch =
  | { readonly kind: 'action'; readonly route: Extract<Route, { kind: 'action' }>; readonly pathParams: Readonly<Record<string, string>> }
  | { readonly kind: 'deferred'; readonly route: Extract<Route, { kind: 'deferred' }> }
  | { readonly kind: 'none' };

export type Router = {
  match(method: string, path: string): RouteMatch;
  readonly routes: readonly Route[];
};

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

/**
 * Thrown at construction, not at request time.
 *
 * A route table that wires up a deferred Action is a defect that must stop the build, not
 * one that shows up the first time somebody calls the route. This is the structural half
 * of "provably not built": even if a future change adds a `DeleteCustomer` Action and
 * routes it, the router refuses to be constructed while the id is still on the deferred
 * list — so the deferral has to be removed DELIBERATELY, in the same change, where a
 * reviewer sees it.
 */
export class DeferredActionWiredError extends Error {
  constructor(actionId: string) {
    super(
      `The route table wires an executable Action for ${actionId}, which is declared ` +
        'deferred. An Action that is contracted but not built must have no handler, no ' +
        'permission evaluation and no storage access. Remove it from the deferred list in ' +
        'the same change that builds it, so the decision is visible.',
    );
    this.name = 'DeferredActionWiredError';
  }
}

export function createRouter(routes: readonly Route[]): Router {
  const deferredIds = new Set<string>();
  for (const route of routes) {
    if (route.kind === 'deferred') {
      deferredIds.add(route.actionId);
    }
  }
  for (const route of routes) {
    if (route.kind === 'action' && deferredIds.has(route.action.id)) {
      throw new DeferredActionWiredError(route.action.id);
    }
    if (route.kind === 'action') {
      // Same reason as above, one gate along: an Action that audits its successes and hides
      // its denials must stop the build, not show up as an absence in an incident review.
      assertAuditPolicy(route.action);
    }
  }

  const compiled = routes.map((route) => ({ route, segments: splitPath(route.path) }));

  return {
    routes,
    match(method: string, path: string): RouteMatch {
      const requested = splitPath(path);
      for (const entry of compiled) {
        if (entry.route.method !== method) {
          continue;
        }
        if (entry.segments.length !== requested.length) {
          continue;
        }
        const pathParams: Record<string, string> = Object.create(null);
        let matched = true;
        for (let i = 0; i < entry.segments.length; i += 1) {
          const pattern = entry.segments[i];
          if (pattern.startsWith('{') && pattern.endsWith('}')) {
            pathParams[pattern.slice(1, -1)] = decodeURIComponent(requested[i]);
            continue;
          }
          if (pattern !== requested[i]) {
            matched = false;
            break;
          }
        }
        if (!matched) {
          continue;
        }
        if (entry.route.kind === 'deferred') {
          return { kind: 'deferred', route: entry.route };
        }
        return { kind: 'action', route: entry.route, pathParams };
      }
      return { kind: 'none' };
    },
  };
}

export class ConflictingInputSourceError extends Error {
  constructor(field: string) {
    super(`The field ${field} arrived from more than one request source.`);
    this.name = 'ConflictingInputSourceError';
  }
}

/**
 * Merges the three permitted sources into one input object.
 *
 * Returns `undefined` when a field arrived twice, so the caller can answer
 * `invalid_argument` rather than pick a winner.
 */
export function mergeInputSources(
  pathParams: Readonly<Record<string, string>>,
  queryParams: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>> | undefined,
  integerQueryParams: readonly string[],
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(pathParams)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(queryParams)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      return undefined;
    }
    if (integerQueryParams.includes(key)) {
      // Coerced only when the whole string is an integer. `page_size=25x` stays a string
      // and fails validation, rather than becoming 25 through a lenient parse.
      merged[key] = /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : value;
      continue;
    }
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(body ?? {})) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      return undefined;
    }
    merged[key] = value;
  }

  return merged;
}
