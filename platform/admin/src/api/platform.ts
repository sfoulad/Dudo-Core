/**
 * The platform route class, client side. `platform-operator-v1`, **accepted**.
 *
 * ===========================================================================
 * THE TWO LIVE ROUTES, READ OFF CORE RATHER THAN OFF THE PROSE
 * ===========================================================================
 *
 *   GET /api/v1/platform/whoami
 *   -> 200 { principal_id, platform_role, permissions[] }
 *
 *   GET /api/v1/platform/organizations?page_size=&cursor=
 *   -> 200 { data: [{ organization_id, status, created_at, display_name }],
 *            next_cursor }
 *
 * THE BODY IS THE RESPONSE. THERE IS NO ENVELOPE ON SUCCESS, and that was
 * checked in the implementation rather than assumed from the schema:
 * `platform-routes.ts` ends its dispatch with `ok(outcome.value.body)`,
 * `http/api.ts:364` passes that straight to `renderSuccess`, and
 * `http/response.ts:102` is `JSON.stringify(payload)` with no wrapping. So
 * `data` and `next_cursor` are top-level keys, NOT nested under a `data`
 * envelope as they would be if this followed the Action-class shape.
 *
 * FAILURE IS THE ORDINARY ERROR ENVELOPE — `{ error: { code, message,
 * request_id, ... } }` — because `renderError` is shared with every other path.
 * So success and failure are shaped differently here, and `parseEnvelope` in
 * `errors.ts` handles only the failure half.
 *
 * ===========================================================================
 * THE CREDENTIAL IS THE SAME COOKIE, ON THIS HOST ONLY
 * ===========================================================================
 *
 * `platform-routes.ts` takes `readSessionId` as "THE SAME PORT THE
 * AUTHENTICATED PATH AND THE SESSION ROUTE CLASS USE, deliberately: one
 * credential, one verifier, one set of carrier rules." So `credentials:
 * 'same-origin'` is the whole of it — no header to add, no token to attach.
 *
 * AND THE CLASS IS BOUND TO AN ADMIN HOST LIST. `http/api.ts:322-330` answers
 * `404` when the host is not in `adminHosts` — the same `404` it gives when the
 * class is not composed at all, so a caller cannot tell a deployment that does
 * not serve this class from a host that does not. These routes therefore do not
 * exist on `app.dudo.work` by construction rather than by a guard.
 *
 * ===========================================================================
 * EVERY CALL ON THIS CLASS WRITES AN AUDIT RECORD. BOTH OF THEM. INCLUDING THE
 * READS.
 * ===========================================================================
 *
 * `platform-audit.ts`: every route writes one, "including
 * `platform.organizations.list` and `platform.session.whoami`, both of which
 * are" reads. `platform-routes.ts` writes the record BEFORE producing the
 * answer, and replaces the answer with `unavailable` if the record could not be
 * written.
 *
 * THAT IS A HARD CONSTRAINT ON HOW THIS CLIENT MAY CALL THEM:
 *
 *   - NO POLLING. NO INTERVAL. NO BACKGROUND REFRESH. A `whoami` on a timer is
 *     an audit log of nothing, and it buries the operator actions the log exists
 *     for. `platform-operator-store.ts` is explicit that enumeration "is the
 *     reconnaissance step before a targeted action" — which is precisely why it
 *     is recorded, and precisely why this console must not generate noise in the
 *     same channel.
 *   - NO SPECULATIVE PREFETCH of a section the operator has not opened.
 *   - RETRY ONLY WHEN A PERSON ASKS. Every automatic retry is a second audit
 *     row for one intention.
 */

import { ApiError, toApiError, type ErrorCode } from './errors';
import { CONFIG } from './config';

/** `platform-routes.ts`: `PLATFORM_BASE_PATH`. */
export const PLATFORM_BASE_PATH = '/api/v1/platform';

export const WHOAMI_PATH = `${PLATFORM_BASE_PATH}/whoami`;
export const ORGANIZATIONS_PATH = `${PLATFORM_BASE_PATH}/organizations`;

/** `platform-routes.ts:397-398`. Restated so a caller cannot invent a bound. */
export const PLATFORM_DEFAULT_PAGE_SIZE = 25;
export const PLATFORM_MIN_PAGE_SIZE = 1;
export const PLATFORM_MAX_PAGE_SIZE = 100;

/* -------------------------------------------------------------------------
   The wire shapes — `platform-operator-v1.schema.json`
   ------------------------------------------------------------------------- */

/** `organizationStatus`. A closed set in the schema. See `isKnownStatus`. */
export type OrganizationStatus = 'active' | 'suspended';

/** `platformRole`. Mirrors the two platform-scope seed roles. */
export type PlatformRole = 'platform-admin' | 'marketplace-moderator';

export interface OrganizationSummary {
  readonly organization_id: string;
  /**
   * Kept as a plain string rather than narrowed to `OrganizationStatus`.
   *
   * The schema says an unrecognised stored value "is never rendered to a
   * client, because Core validates on read and treats an unknown value as
   * unavailable". THIS CLIENT STILL DOES NOT NARROW IT, because a cast would be
   * this console asserting Core's guarantee on Core's behalf — and if that
   * guarantee ever failed, the cast is what would turn a surprising string into
   * a confidently mislabelled row. `isKnownStatus` asks instead.
   */
  readonly status: string;
  /** RFC 3339, UTC, second precision. */
  readonly created_at: string;
  /**
   * ALWAYS NULL TODAY. Present in the shape so that adding names later is
   * additive rather than a new field appearing in a published response.
   *
   * WHEN IT IS NULL THE IDENTIFIER IS RENDERED VERBATIM. `platform-route-handlers.ts`
   * states it as a rule binding both clients: "not a blank, not a dash, not
   * 'Unnamed Organization'." A placeholder invented here and a different one
   * invented on iPhone is exactly the divergence the one-contract rule exists to
   * prevent.
   */
  readonly display_name: string | null;
}

export interface ListOrganizationsOutput {
  readonly data: readonly OrganizationSummary[];
  /** Opaque. Never constructed, parsed or modified here. `null` means no more. */
  readonly next_cursor: string | null;
}

export interface WhoamiOutput {
  readonly principal_id: string;
  readonly platform_role: string;
  /**
   * FOR RENDERING ONLY. The schema says it, the contract says it, the handler
   * says it, and it is repeated here because this is the field a console is
   * tempted to treat as an authorization decision:
   *
   *   "every permission here is enforced again by Core on the call itself, and a
   *    console that ignored this list entirely would be ugly and exactly as
   *    safe."
   *
   * So it may hide a button. It may never permit one.
   *
   * NOTE IT IS SIX FOR `platform-admin`, NOT EIGHT. `reachablePlatformPermissions`
   * intersects the role's grants with Core's platform envelope, so two
   * permissions the role holds are deliberately not reported: they are reachable
   * by no route, and reporting them would tell this console it may take an
   * action that does not exist.
   */
  readonly permissions: readonly string[];
}

export function isKnownStatus(status: string): status is OrganizationStatus {
  return status === 'active' || status === 'suspended';
}

/* -------------------------------------------------------------------------
   Reading the response — checked, never cast
   ------------------------------------------------------------------------- */

/**
 * ===========================================================================
 * WHY THIS PARSES INSTEAD OF CASTING, WHICH IS THE EASY THING TO GET WRONG HERE
 * ===========================================================================
 *
 * `await response.json() as WhoamiOutput` compiles, reads fine, and asserts
 * something no one checked. If Core ever answered a shape this console did not
 * expect — a rename, a proxy inserting an envelope, a partial deploy serving an
 * older build — the cast produces `undefined` fields that render as blanks and a
 * console that looks like it is working.
 *
 * THAT FAILURE IS PARTICULARLY BAD ON THIS SURFACE, because the whole point of
 * ADR 0010's no-fabricated-data rule is that an operator cannot tell invented
 * data from real. An `undefined` rendered as an empty cell is invented data with
 * extra steps.
 *
 * So every field is checked and a mismatch throws `internal` with a message
 * saying which field. It costs twenty lines and turns a silent
 * misreading into a loud one.
 */
class ShapeError extends Error {}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ShapeError(`${what} was not a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, field: string, what: string): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new ShapeError(`${what} is missing the string field "${field}".`);
  }
  return value;
}

function requireNullableString(
  source: Record<string, unknown>,
  field: string,
  what: string,
): string | null {
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ShapeError(`${what} field "${field}" was neither a string nor null.`);
  }
  return value;
}

export function parseWhoami(payload: unknown): WhoamiOutput {
  const body = requireObject(payload, 'The whoami response');
  const permissions = body.permissions;
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== 'string')) {
    throw new ShapeError('The whoami response field "permissions" was not an array of strings.');
  }
  return {
    principal_id: requireString(body, 'principal_id', 'The whoami response'),
    platform_role: requireString(body, 'platform_role', 'The whoami response'),
    permissions: Object.freeze([...(permissions as string[])]),
  };
}

export function parseListOrganizations(payload: unknown): ListOrganizationsOutput {
  const body = requireObject(payload, 'The Organization list response');
  const rows = body.data;
  if (!Array.isArray(rows)) {
    throw new ShapeError('The Organization list response field "data" was not an array.');
  }
  return {
    data: Object.freeze(
      rows.map((row, index) => {
        const entry = requireObject(row, `Organization row ${String(index)}`);
        const what = `Organization row ${String(index)}`;
        return {
          organization_id: requireString(entry, 'organization_id', what),
          status: requireString(entry, 'status', what),
          created_at: requireString(entry, 'created_at', what),
          display_name: requireNullableString(entry, 'display_name', what),
        };
      }),
    ),
    next_cursor: requireNullableString(body, 'next_cursor', 'The Organization list response'),
  };
}

/* -------------------------------------------------------------------------
   The transport
   ------------------------------------------------------------------------- */

function codeForStatus(status: number): ErrorCode {
  // The codes each route declares: list is [invalid_argument, unauthenticated,
  // forbidden, rate_limited, unavailable]; whoami is the same without
  // invalid_argument. `internal` is the floor for anything unlisted.
  switch (status) {
    case 400:
      return 'invalid_argument';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      // On this class a 404 means the host does not serve platform routes, or
      // the class is not composed — deliberately indistinguishable. It is NOT a
      // missing Organization: neither route takes an identifier.
      return 'not_found';
    case 422:
      return 'failed_precondition';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return 'internal';
  }
}

async function platformGet(path: string, fetchImpl?: typeof fetch): Promise<unknown> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CONFIG.requestTimeoutMs);

  let response: Response;
  try {
    response = await doFetch(`${CONFIG.apiBaseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      // The session cookie. Without this the request arrives unauthenticated
      // and Core answers 401 for a browser that is perfectly well signed in.
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (thrown) {
    clearTimeout(timer);
    if (thrown instanceof DOMException && thrown.name === 'AbortError') {
      throw new ApiError({ code: 'timeout', message: 'The request took too long.' });
    }
    throw new ApiError({ code: 'unavailable', message: 'The request did not reach Dudo.' });
  }
  clearTimeout(timer);

  const text = await response.text();

  if (!response.ok) {
    let envelope: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
        envelope = parsed.error as Record<string, unknown>;
      }
    } catch {
      /* A non-envelope body. The status is still the answer. */
    }
    const retryAfterBody = envelope.retry_after_seconds;
    const retryAfterHeader = response.headers.get('retry-after');
    throw new ApiError({
      code: codeForStatus(response.status),
      message: typeof envelope.message === 'string' ? envelope.message : undefined,
      request_id:
        typeof envelope.request_id === 'string'
          ? envelope.request_id
          : response.headers.get('x-request-id'),
      retry_after_seconds:
        typeof retryAfterBody === 'number' && Number.isFinite(retryAfterBody)
          ? Math.ceil(retryAfterBody)
          : retryAfterHeader !== null && Number.isFinite(Number.parseInt(retryAfterHeader, 10))
            ? Number.parseInt(retryAfterHeader, 10)
            : null,
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError({
      code: 'internal',
      message: 'Dudo answered with something that was not JSON.',
    });
  }
}

/** Turns a shape mismatch into an `ApiError` so no screen sees a raw throw. */
function asApiError(thrown: unknown): ApiError {
  if (thrown instanceof ShapeError) {
    return new ApiError({
      code: 'internal',
      // The message names the field, because "something went wrong" on a shape
      // mismatch is the report that costs a day.
      message: `${thrown.message} This console did not render it rather than showing a value it could not read.`,
    });
  }
  return toApiError(thrown);
}

export interface PlatformClient {
  whoami(): Promise<WhoamiOutput>;
  listOrganizations(options?: {
    pageSize?: number;
    cursor?: string | null;
  }): Promise<ListOrganizationsOutput>;
}

export function createPlatformClient(options: { fetchImpl?: typeof fetch } = {}): PlatformClient {
  return {
    async whoami() {
      try {
        return parseWhoami(await platformGet(WHOAMI_PATH, options.fetchImpl));
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async listOrganizations({ pageSize, cursor } = {}) {
      const params = new URLSearchParams();
      if (pageSize !== undefined) params.set('page_size', String(pageSize));
      /*
       * AN EMPTY `?cursor=` IS REFUSED BY CORE RATHER THAN TREATED AS ABSENT,
       * and `readCursorParameter` explains why: "'Present but empty' and
       * 'absent' are different requests, and collapsing them is how a client
       * that failed to store a cursor silently restarts an enumeration from the
       * beginning." So an empty or null cursor is OMITTED here, never sent
       * empty.
       */
      if (cursor !== undefined && cursor !== null && cursor !== '') params.set('cursor', cursor);
      const query = params.toString();
      try {
        return parseListOrganizations(
          await platformGet(
            query === '' ? ORGANIZATIONS_PATH : `${ORGANIZATIONS_PATH}?${query}`,
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },
  };
}
