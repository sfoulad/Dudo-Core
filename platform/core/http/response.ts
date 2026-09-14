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

/**
 * ===========================================================================================
 * SECURITY HEADERS CORE SETS ON ITS OWN RESPONSES. `security-agent` finding 6, 2026-09-13.
 * ===========================================================================================
 *
 * **API AND AUTH RESPONSES ARE STRUCTURALLY OUTSIDE `_headers`' REACH**, and that is the whole
 * reason this constant exists. `attachCustomHeaders` lives in the asset worker; `run_worker_first`
 * sends `/api/*`, `/auth/*` and `/health` to the Worker, **which never touches it.** So the
 * `_headers` files are correct and cannot cover these responses however correct they are.
 *
 * *** IT IS EXPORTED AND SPREAD BY TWO CALLERS RATHER THAN WRITTEN TWICE. *** `response.ts` and
 * `pre-auth-http.ts::baseHeaders` build byte-identical header sets by two functions, which is
 * `workflow.md` §12's duplicated constraint — *"the rule was restated six times and agreed with
 * the running code once."* Adding `nosniff` to one of them would have covered the API and left
 * **the auth path**, which is the half the finding names first.
 *
 * *** WHAT `nosniff` DOES AND DOES NOT DO, because the severity is genuinely LOW and overstating
 * it here is how a Low becomes a claim. *** It tells a browser not to MIME-sniff a response into
 * a type its `content-type` did not declare. **Every response from both functions already carries
 * an explicit `application/json; charset=utf-8`**, so the exposure this closes is near nil —
 * `security-agent` declined to upgrade it and that assessment is not being quietly inflated by
 * being fixed. It is here because a deferral with no owner is an obligation nobody collects, not
 * because it was urgent.
 *
 * A FROZEN RECORD RATHER THAN A LOOSE STRING PAIR, so a second header is one entry rather than a
 * third place to remember. **`Strict-Transport-Security`, `X-Frame-Options` and a CSP are NOT
 * here**: the first belongs at the edge, and the last two govern documents rather than JSON. This
 * set is Core's API responses and nothing wider — do not let it become the platform's security
 * header policy, which is a different artifact with a different owner.
 */
export const CORE_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
});

function headers(requestId: string, correlationId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    [REQUEST_ID_HEADER]: requestId,
    [CORRELATION_ID_HEADER]: correlationId,
    // A response carrying tenant data must not be stored by an intermediary.
    'cache-control': 'no-store',
    ...CORE_SECURITY_HEADERS,
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
