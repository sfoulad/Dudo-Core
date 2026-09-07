/**
 * The real transport. Same `Transport` interface as the fixture, so no screen
 * changes when the flag flips.
 *
 * ===========================================================================
 * THE WIRE FORM IS REST, NOT AN ACTION ENVELOPE
 * ===========================================================================
 *
 * Every Action reaches Core at its own method and path, transcribed from the
 * contracts' `httpBinding` blocks and held in `client.ts` (`ROUTES`,
 * `BASE_PATH`) and `contracts/business-read.ts` (`CORE_ROUTES`,
 * `CORE_BASE_PATH`). There is no `POST /actions` envelope and this client must
 * not invent one — `platform/core/http/router.ts` matches method and path, and a
 * request that does not match is `not_found`.
 *
 * The mapping from an Action input to a request is ONE GENERAL RULE, not a
 * per-Action table:
 *
 *   1. Every `{name}` placeholder in the path is filled from the input, and
 *      that key is REMOVED from what remains. It must not also travel in the
 *      body or the query: `mergeInputSources` in `platform/core/http/router.ts`
 *      rejects a key that arrives from two sources, so repeating
 *      `customer_id` would fail the whole request.
 *   2. What remains goes in the query string for GET, and in a JSON body for
 *      POST and PATCH.
 *   3. A POST with nothing left sends no body at all. Core reads an empty body
 *      as `{}`.
 *
 * ===========================================================================
 * WHAT THIS TRANSPORT DECIDES: NOTHING
 * ===========================================================================
 *
 * Permission, tenant resolution, and the authorized-business set are decided in
 * `platform/core/**` on every call (security.md §2). This file moves bytes and
 * turns an error envelope into an `ApiError`. It holds no rule, and adding one
 * here would be adding a business rule to the UI.
 *
 * IT ALSO NEVER SENDS A TENANT IDENTIFIER, because no Action in either contract
 * accepts one and none may be added. The Organization is derived from the
 * authenticated context on the server.
 *
 * ===========================================================================
 * THE SESSION TRAVELS AS A COOKIE THIS CODE CANNOT SEE
 * ===========================================================================
 *
 * `platform/core/http/pre-auth-http.ts` issues `dudo_session` with `HttpOnly;
 * Secure; SameSite=Lax; Path=/`. There is therefore NO `Authorization` header to
 * attach here and no token to read: `credentials: 'same-origin'` is the whole
 * of session handling on the web, and the browser does it. (ADR 0015 §A: "One
 * value, two carriers" — the Apple client uses `Authorization: Bearer`; the web
 * client uses the cookie.)
 *
 * A consequence worth stating: this file cannot tell an expired session from an
 * absent one, because it can see neither. A `401` means "not authenticated now"
 * and nothing more, and that is what `onUnauthenticated` reports.
 */

import { ApiError, ERROR_CODES, type ErrorCode, type ErrorDetail } from './errors';
import type { DudoAction, Transport } from './fixture-transport';
import { BASE_PATH, ROUTES } from './client';
import { CORE_BASE_PATH, CORE_ROUTES } from '@/contracts/business-read';
import { CONFIG } from './config';

/* -------------------------------------------------------------------------
   The binding table — one entry per Action, assembled from the two contracts
   ------------------------------------------------------------------------- */

interface Binding {
  method: string;
  /** Absolute, including the contract's base path. May contain `{name}`. */
  path: string;
}

const BINDINGS: Record<DudoAction, Binding> = {
  ...(Object.fromEntries(
    Object.entries(ROUTES).map(([action, route]) => [
      action,
      { method: route.method, path: `${BASE_PATH}${route.path}` },
    ]),
  ) as Record<keyof typeof ROUTES, Binding>),
  ...(Object.fromEntries(
    Object.entries(CORE_ROUTES).map(([action, route]) => [
      action,
      { method: route.method, path: `${CORE_BASE_PATH}${route.path}` },
    ]),
  ) as Record<keyof typeof CORE_ROUTES, Binding>),
};

const PATH_PARAMETER = /\{([a-z0-9_]+)\}/g;

/**
 * Fills `{name}` placeholders and returns the keys it consumed.
 *
 * A missing or non-string path parameter is a defect in this client rather than
 * a server refusal, so it throws locally with a message naming the Action —
 * sending `/customers/undefined` would produce a `not_found` that looks like a
 * missing record.
 */
function fillPath(
  action: DudoAction,
  path: string,
  input: Record<string, unknown>,
): { filled: string; consumed: Set<string> } {
  const consumed = new Set<string>();
  const filled = path.replace(PATH_PARAMETER, (_match, name: string) => {
    const value = input[name];
    if (typeof value !== 'string' || value === '') {
      throw new ApiError({
        code: 'invalid_argument',
        message: `${action} requires ${name} as a path parameter and it was not supplied.`,
      });
    }
    consumed.add(name);
    return encodeURIComponent(value);
  });
  return { filled, consumed };
}

/**
 * Builds the query string.
 *
 * AN ARRAY IN A QUERY STRING THROWS, DELIBERATELY, AND THE THROW IS THE POINT.
 * `platform/core/http/api.ts:253-266` rejects EVERY repeated query parameter, for
 * every route, with `invalid_argument / repeated_parameter` and no exemption
 * mechanism. So a repeated parameter is not merely unfashionable here — it is
 * unserviceable, and producing one silently would send a request that cannot
 * succeed.
 *
 * This is not hypothetical: `core.ResolveBusinessReferences` was originally bound
 * to `GET ...?business_ids=a&business_ids=b`, which could never work for more
 * than one identifier. The contract was revised on 2026-09-04 to carry the batch
 * as a JSON body on a POST. No GET Action in either contract now takes an array,
 * so this branch is unreachable — and it throws rather than being deleted so
 * that the next author who binds an array to a GET finds out at the call site
 * instead of from a server refusal.
 */
function buildQuery(input: Record<string, unknown>, consumed: Set<string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (consumed.has(key) || value === undefined) continue;
    if (Array.isArray(value)) {
      throw new ApiError({
        code: 'invalid_argument',
        message:
          `${key} is an array and cannot travel in a query string: Core rejects every ` +
          'repeated query parameter. An Action taking an array must be bound to POST with a ' +
          'JSON body, as core.ResolveBusinessReferences now is.',
      });
    }
    if (value === null) {
      // A null in a query string has no encoding that survives the round trip:
      // Core reads every query value as a string, so `?email=` would arrive as
      // the empty string, not as null. No GET Action in either contract takes a
      // nullable input, so this is unreachable — and it throws rather than
      // guessing, so it stays unreachable.
      throw new ApiError({
        code: 'invalid_argument',
        message: `${key} cannot be sent as null in a query string.`,
      });
    }
    params.append(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/* -------------------------------------------------------------------------
   Error decoding
   ------------------------------------------------------------------------- */

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function readDetails(value: unknown): ErrorDetail[] {
  if (!Array.isArray(value)) return [];
  const details: ErrorDetail[] = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      if (typeof record.field === 'string' && typeof record.issue === 'string') {
        details.push({ field: record.field, issue: record.issue });
      }
    }
  }
  return details;
}

/**
 * Status codes to error codes, for a response whose body is not Dudo's envelope
 * — an edge 502, a proxy 504, an HTML error page from something in front of the
 * Worker. The status is all there is to go on, and mapping it is more honest
 * than reporting every such failure as `internal`.
 */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'invalid_argument',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  408: 'timeout',
  409: 'conflict',
  // Core never emits 412. Kept because something in FRONT of the Worker might,
  // and 412 has exactly one conventional meaning.
  412: 'failed_precondition',
  // 422 IS `failed_precondition`, NOT `invalid_argument`, and this was wrong
  // until 2026-09-05. `platform/core/kernel/errors.ts` maps invalid_argument to
  // 400 and failed_precondition to 422 — so this entry claimed the one status
  // Core uses for the unselected-Organization state meant a malformed request.
  // It only bites when the body is not Dudo's envelope, because the envelope's
  // own code wins; that is precisely the edge-proxy case where the status is
  // all there is to go on.
  422: 'failed_precondition',
  429: 'rate_limited',
  500: 'internal',
  502: 'unavailable',
  503: 'unavailable',
  504: 'timeout',
};

/**
 * `retry_after_seconds` — the field the rate-limit and quota screens depend on.
 *
 * IT ARRIVES AS A HEADER, NOT A BODY FIELD, and both are read here. Core's
 * `renderError` puts the value in `Retry-After`
 * (`platform/core/http/response.ts`) and deliberately keeps the error envelope
 * untouched, while `error-envelope.schema.json` does define an optional
 * `retry_after_seconds`. Reading both means this client shows a real wait
 * whichever side of that gap Core is on, and the body wins when both are
 * present because a body field is the contract's own.
 *
 * WHY IT MATTERS ENOUGH TO BE READ TWICE: ADR 0008 caps this platform at a free
 * tier with hard daily write ceilings, so `rate_limited` and `quota_exceeded`
 * are ordinary states a real user reaches, not exotic ones. "Try again later"
 * with no number is the failure mode that makes people hammer the button.
 */
function readRetryAfter(response: Response, envelope: Record<string, unknown>): number | null {
  const fromBody = envelope.retry_after_seconds;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return Math.ceil(fromBody);
  }
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number.parseInt(header.trim(), 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  return null;
}

/**
 * Exported so `organization.ts` decodes envelopes identically.
 *
 * The session routes are not Actions and do not go through this transport, but
 * they answer with the SAME error envelope, and two decoders for one envelope
 * is the drift `0012` is named after.
 */
export function decodeErrorResponse(response: Response, payload: unknown): ApiError {
  return decodeError(response, payload);
}

function decodeError(response: Response, payload: unknown): ApiError {
  const fallbackCode = CODE_BY_STATUS[response.status] ?? 'internal';
  const requestId = response.headers.get('x-request-id');

  const envelope =
    payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)
      ? ((payload as Record<string, unknown>).error as Record<string, unknown>)
      : null;

  if (envelope === null || typeof envelope !== 'object') {
    // Not Dudo's envelope. Something in front of the Worker answered, or the
    // Worker died before it could render. Say so honestly rather than inventing
    // a message that reads like the server's own.
    return new ApiError({
      code: fallbackCode,
      message: `The server answered ${String(response.status)} without a Dudo error envelope.`,
      request_id: requestId,
      retry_after_seconds: readRetryAfter(response, {}),
    });
  }

  return new ApiError({
    code: isErrorCode(envelope.code) ? envelope.code : fallbackCode,
    message: typeof envelope.message === 'string' ? envelope.message : undefined,
    // The envelope's own request_id is authoritative; the header is the fallback
    // for the branches where Core sends only the header.
    request_id: typeof envelope.request_id === 'string' ? envelope.request_id : requestId,
    details: readDetails(envelope.details),
    retry_after_seconds: readRetryAfter(response, envelope),
  });
}

/* -------------------------------------------------------------------------
   The transport
   ------------------------------------------------------------------------- */

export interface HttpTransportOptions {
  /**
   * Called once for every `401`, before the `ApiError` is thrown.
   *
   * IT IS A NOTIFICATION, NOT A SECURITY CONTROL. Clearing local state and
   * showing the login screen is presentation; the request was already refused by
   * Core, which is where the decision was made and the only place it counts.
   */
  onUnauthenticated?: () => void;
  /**
   * Called for every `failed_precondition`, before the `ApiError` is thrown.
   *
   * IT REPORTS AN AMBIGUITY, NOT A DIAGNOSIS. See the call site: Core's 422 for
   * "no Organization selected" and its 422 for "that customer is archived" are
   * the same bytes. A listener that opened an Organization picker on this alone
   * would draw one when somebody archived an archived customer.
   */
  onPreconditionFailed?: () => void;
  /** Overridable for tests. Defaults to the global. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createHttpTransport(options: HttpTransportOptions = {}): Transport {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? CONFIG.apiBaseUrl;
  const timeoutMs = options.timeoutMs ?? CONFIG.requestTimeoutMs;

  return {
    name: 'http',

    async invoke(action: DudoAction, input: Record<string, unknown> = {}): Promise<unknown> {
      const binding = BINDINGS[action];
      if (!binding) {
        throw new ApiError({
          code: 'internal',
          message: `No HTTP binding is transcribed for ${action}.`,
        });
      }

      const { filled, consumed } = fillPath(action, binding.path, input);
      const remaining: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (!consumed.has(key)) remaining[key] = value;
      }

      const carriesBody = binding.method === 'POST' || binding.method === 'PATCH';
      const query = carriesBody ? '' : buildQuery(remaining, consumed);
      const url = `${baseUrl}${filled}${query}`;

      const headers: Record<string, string> = { accept: 'application/json' };
      let body: string | undefined;
      if (carriesBody && Object.keys(remaining).length > 0) {
        headers['content-type'] = 'application/json';
        // `remaining` may legitimately contain nulls: the contract's three-way
        // update semantics make `present and null` mean "clear this field", and
        // JSON.stringify preserves that. `undefined` was already stripped by
        // `compact()` in client.ts, which is what keeps "absent" absent.
        body = JSON.stringify(remaining);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let response: Response;
      try {
        response = await doFetch(url, {
          method: binding.method,
          headers,
          body,
          // The session cookie, and nothing else. Cross-origin is refused at
          // configuration time, so `same-origin` is never a silent downgrade.
          credentials: 'same-origin',
          // A refused request must not be served from cache, and a stale 200
          // after a session ends would be worse than an error.
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (thrown) {
        clearTimeout(timer);
        if (thrown instanceof DOMException && thrown.name === 'AbortError') {
          throw new ApiError({
            code: 'timeout',
            message: `The request exceeded ${String(timeoutMs)} ms and was abandoned.`,
          });
        }
        // A network failure, a DNS failure, an offline browser, a blocked
        // redirect. None of them is a server answer, so none of them may be
        // reported as one.
        throw new ApiError({
          code: 'unavailable',
          message: 'The request did not reach Dudo.',
        });
      }
      clearTimeout(timer);

      let payload: unknown;
      const text = await response.text();
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          options.onUnauthenticated?.();
        }
        const error = decodeError(response, payload);
        if (error.code === 'failed_precondition') {
          // "SOMETHING was refused as a precondition" — NOT "no Organization is
          // selected". This transport cannot tell those apart and must not
          // pretend to: `failedPrecondition()` in Core takes no arguments and
          // carries a constant message, so the unselected-Organization refusal
          // and an attempt to archive an already-archived customer are
          // byte-identical here. The listener resolves the ambiguity with a
          // probe; all this does is say "worth checking".
          options.onPreconditionFailed?.();
        }
        throw error;
      }

      // Success bodies are the contract's own shapes — the customer object, or
      // `{ data, next_cursor }` — never wrapped. `platform/core/http/response.ts`
      // carries `request_id` in a header precisely so no success shape gains a
      // field, and this client must not add one either.
      return payload;
    },
  };
}
