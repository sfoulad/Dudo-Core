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

/**
 * `retryAfterSeconds` is a TRANSPORT HINT, not part of the error envelope.
 *
 * It becomes a `Retry-After` HEADER and never a body field, so
 * `packages/contracts/common/error-envelope.schema.json` is untouched — which matters, because
 * the envelope is contract surface and contracts are not this agent's to author. `CoreError`
 * still has no channel for a header, deliberately; the value is passed alongside it by the one
 * layer that speaks HTTP.
 *
 * FOR `quota_exceeded` IT IS A PURE FUNCTION OF THE CLOCK — seconds to the next 00:00 UTC — and
 * that is what makes it safe to return at all. It is byte-identical whether the Organization hit
 * its own daily ceiling or the platform allocation ran out (docs/decisions/0014 §A.10), so it
 * cannot be used to infer anything about platform-wide activity or about any other tenant.
 */
export function renderError(
  error: CoreError,
  requestId: string,
  correlationId: string,
  retryAfterSeconds?: number,
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
  if (error.code === 'rate_limited' || error.code === 'quota_exceeded') {
    // API_STANDARD.md §8 requires Retry-After on 429. The two codes share the status and mean
    // different things — one says slow down, the other says the day's capacity is gone — so
    // they carry different times, and both come from the caller of this function rather than
    // being invented here.
    //
    // THE FALLBACK OF ONE SECOND IS FOR `rate_limited` ONLY, AND IT IS STILL OWED. The
    // coordinator computes the true value per 60-second window and it is not plumbed out of
    // `invokeAction`, whose return type has no channel for it; that gap predates
    // docs/decisions/0014 and is reported as owed rather than quietly widened here. It is safe
    // in the meantime because a second is always an UNDER-statement of the wait for a fixed
    // window, so a client that honours it retries and is refused again rather than being told
    // to give up early.
    (init.headers as Record<string, string>)['Retry-After'] = String(
      retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
        ? Math.max(1, Math.ceil(retryAfterSeconds))
        : 1,
    );
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
