/**
 * Rendering. One error shape, everywhere, and `request_id` on every response.
 *
 * The envelope is `packages/contracts/common/error-envelope.schema.json` exactly:
 * `{ "error": { "code", "message", "details?", "request_id" } }`, with the status taken
 * from the code (API_STANDARD.md §8).
 *
 * `request_id` IS ATTACHED HERE AND NOWHERE ELSE. It is the only identifier an error
 * carries — never a tenant id, never a resource id (MULTITENANCY_STANDARD.md §4 carrier
 * 11) — and it is the ONLY permitted difference between the `not_found` for another
 * tenant's identifier and the `not_found` for one that exists nowhere. Attaching it at the
 * boundary means no domain code holds it and no error constructed in the domain can carry
 * a second identifier by accident: `notFound()` and `forbidden()` take no arguments, and
 * this function adds exactly one field.
 *
 * SUCCESS RESPONSES CARRY IT IN A HEADER, AND THAT IS AN ASSUMPTION. API_STANDARD.md §11
 * requires `request_id` "returned to the caller in every response, success or error", but
 * no contract shape has a place for it: the Customer Directory's success bodies are the
 * customer object and the collection envelope, both `additionalProperties: false`, so
 * adding a field to a body would be a contract violation rather than a helpful extra.
 * `X-Request-Id` on every response satisfies the requirement without touching a shape.
 * Flagged for the Team Lead: the header name is not fixed by any standard in the
 * repository, and both clients need the same one.
 */

import type { CoreError } from '../kernel/errors.ts';
import { HTTP_STATUS_BY_CODE } from '../kernel/errors.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

function headers(requestId: string, correlationId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    [REQUEST_ID_HEADER]: requestId,
    [CORRELATION_ID_HEADER]: correlationId,
    // A response carrying tenant data must not be stored by an intermediary.
    'cache-control': 'no-store',
  };
}

export function renderError(
  error: CoreError,
  requestId: string,
  correlationId: string,
): Response {
  const body: Record<string, unknown> = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      request_id: requestId,
    },
  };
  const init: ResponseInit = {
    status: HTTP_STATUS_BY_CODE[error.code],
    headers: headers(requestId, correlationId),
  };
  if (error.code === 'rate_limited') {
    // API_STANDARD.md §8 requires Retry-After on 429 rate limiting. No rate limiter exists
    // in this slice, so nothing produces this code yet; the header is here so that when one
    // does, the requirement is already met rather than rediscovered.
    (init.headers as Record<string, string>)['Retry-After'] = '1';
  }
  return new Response(JSON.stringify(body), init);
}

export function renderSuccess(
  payload: unknown,
  status: number,
  requestId: string,
  correlationId: string,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: headers(requestId, correlationId),
  });
}
