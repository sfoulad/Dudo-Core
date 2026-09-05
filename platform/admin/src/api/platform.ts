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

import { ApiError, toApiError, ERROR_CODES, type ErrorCode } from './errors';
import { CONFIG } from './config';

/** `platform-routes.ts`: `PLATFORM_BASE_PATH`. */
export const PLATFORM_BASE_PATH = '/api/v1/platform';

export const WHOAMI_PATH = `${PLATFORM_BASE_PATH}/whoami`;
export const ORGANIZATIONS_PATH = `${PLATFORM_BASE_PATH}/organizations`;
export const TEMPLATES_PATH = `${PLATFORM_BASE_PATH}/templates`;

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
   Templates — `template-v1`, accepted
   ------------------------------------------------------------------------- */

/**
 * The three structural levels, in outermost-to-innermost order.
 *
 * A CLOSED SET OF EXACTLY THREE, and the schema says why an open map was
 * refused: "an open map would let an operator invent a level that does not
 * exist, and a client rendering an unknown key would be drawing a structure the
 * platform does not have."
 *
 * `team` is absent deliberately — a first-class object with no per-type
 * variation. `own` and `resource` are absent because they are authorization
 * scopes, not places.
 */
export const TEMPLATE_LEVELS = ['organization', 'workspace', 'branch'] as const;
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];

/**
 * The platform defaults, shown as placeholder text ONLY.
 *
 * ===========================================================================
 * THIS CLIENT NEVER APPLIES THESE. CORE DOES.
 * ===========================================================================
 *
 * `templateOutput` requires all three labels and Core fills any the operator
 * omitted (`templates.ts`, `DEFAULT_LABELS`). The schema states the reason
 * plainly: a response is "ALWAYS FULLY POPULATED... The client therefore never
 * implements the default table, which is what stops the web and Apple clients
 * drifting into two different ideas of what an unlabelled level is called."
 *
 * So these strings appear in exactly one place — the `placeholder` attribute on
 * an empty field, telling an operator what they will get if they type nothing.
 * NOTHING READS THEM WHEN RENDERING A TEMPLATE. If a response ever arrived
 * missing a label, that is a contract violation and `parseTemplate` refuses it
 * rather than quietly substituting the value below and hiding the defect.
 */
export const TEMPLATE_LEVEL_DEFAULTS: Readonly<Record<TemplateLevel, string>> = Object.freeze({
  organization: 'Organization',
  workspace: 'Workspace',
  branch: 'Branch',
});

/** `templates.ts:113-114`, restated so a form cannot invent a different bound. */
export const MAX_TEMPLATE_NAME_LENGTH = 80;
export const MAX_TEMPLATE_LABEL_LENGTH = 40;

export type TemplateStatus = 'active' | 'retired';

export interface Template {
  readonly template_id: string;
  readonly name: string;
  /** Always all three, filled by Core. Never defaulted on this side. */
  readonly level_labels: Readonly<Record<TemplateLevel, string>>;
  /**
   * Always `active` today. `templateStatus` declares both values and NO ROUTE
   * SETS IT in version 1 — the field exists now because adding one to an
   * already-published response later is worse. Kept as a plain string for the
   * same reason as `OrganizationSummary.status`: narrowing by cast would be this
   * client asserting Core's guarantee on Core's behalf.
   */
  readonly status: string;
  readonly created_at: string;
}

export interface ListTemplatesOutput {
  readonly data: readonly Template[];
  readonly next_cursor: string | null;
}

export interface CreateTemplateInput {
  readonly name: string;
  /**
   * Any subset of the three levels. OMITTED KEYS ARE OMITTED FROM THE REQUEST,
   * never sent as an empty string — Core refuses a zero-length label with
   * `out_of_range`, so sending `''` for "leave it default" would turn a blank
   * field into a validation error.
   */
  readonly level_labels?: Partial<Record<TemplateLevel, string>>;
}

export function isKnownTemplateStatus(status: string): status is TemplateStatus {
  return status === 'active' || status === 'retired';
}

/**
 * The local half of the name and label rules, for immediate form feedback.
 *
 * IT IS NOT VALIDATION AND IT DECIDES NOTHING. Core re-checks every one of these
 * on the call (`templates.ts::parseTemplateCreate`) and its answer is the only
 * one that counts. This exists so an operator who types a trailing space learns
 * it before spending a request and an audit record on a refusal.
 *
 * THE RULES ARE COPIED FROM CORE, NOT INVENTED: non-empty, within the length
 * bound, and NO LEADING OR TRAILING WHITESPACE — rejected rather than trimmed,
 * for the reason `isSubmittableIdentifier` rejects rather than trims. Three
 * implementations in three languages trim different Unicode sets, and refusing
 * removes the disagreement instead of arbitrating it. A name differing from
 * another only by a trailing space is also two Templates an operator cannot tell
 * apart in a list.
 */
export function templateNameRefusal(value: string): string | null {
  if (value.length === 0) return 'Give the business type a name.';
  if (value.trim() !== value) {
    return 'Remove the spaces from the start or end of the name — Dudo refuses them rather than trimming them.';
  }
  if (value.length > MAX_TEMPLATE_NAME_LENGTH) {
    return `A name cannot be longer than ${String(MAX_TEMPLATE_NAME_LENGTH)} characters.`;
  }
  return null;
}

/** An empty label is valid input here: it means "leave the default". */
export function templateLabelRefusal(value: string): string | null {
  if (value.length === 0) return null;
  if (value.trim() !== value) {
    return 'Remove the spaces from the start or end of the label.';
  }
  if (value.length > MAX_TEMPLATE_LABEL_LENGTH) {
    return `A label cannot be longer than ${String(MAX_TEMPLATE_LABEL_LENGTH)} characters.`;
  }
  return null;
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

export function parseTemplate(payload: unknown, what = 'The Template response'): Template {
  const body = requireObject(payload, what);
  const labels = requireObject(body.level_labels, `${what} field "level_labels"`);
  /*
   * ALL THREE LABELS ARE REQUIRED AND NONE IS DEFAULTED HERE. `templateOutput`
   * lists them in `required`, and Core fills any the operator omitted before
   * responding. A missing one is a contract violation, so it is REFUSED — if
   * this client quietly substituted its own default, the two clients could
   * drift into different ideas of what an unlabelled level is called, which is
   * exactly what always-populating the response exists to prevent.
   */
  const level_labels = {} as Record<TemplateLevel, string>;
  for (const level of TEMPLATE_LEVELS) {
    level_labels[level] = requireString(labels, level, `${what} field "level_labels"`);
  }
  return {
    template_id: requireString(body, 'template_id', what),
    name: requireString(body, 'name', what),
    level_labels: Object.freeze(level_labels),
    status: requireString(body, 'status', what),
    created_at: requireString(body, 'created_at', what),
  };
}

export function parseListTemplates(payload: unknown): ListTemplatesOutput {
  const body = requireObject(payload, 'The Template list response');
  const rows = body.data;
  if (!Array.isArray(rows)) {
    throw new ShapeError('The Template list response field "data" was not an array.');
  }
  return {
    data: Object.freeze(rows.map((row, index) => parseTemplate(row, `Template row ${String(index)}`))),
    next_cursor: requireNullableString(body, 'next_cursor', 'The Template list response'),
  };
}

/* -------------------------------------------------------------------------
   The transport
   ------------------------------------------------------------------------- */

/**
 * ===========================================================================
 * THE ENVELOPE'S `code` IS THE ANSWER. THE STATUS IS ONLY THE FALLBACK.
 * ===========================================================================
 *
 * `kernel/errors.ts` maps `rate_limited` AND `quota_exceeded` TO THE SAME 429.
 * So the status genuinely cannot distinguish them, and a client that mapped 429
 * to `rate_limited` — as this one did until the Template work — silently
 * relabels every quota refusal as a rate limit.
 *
 * THAT IS NOT COSMETIC HERE. `platform.templates.create` declares
 * `quota_exceeded` as a distinct outcome: Core DEFERRED the control-plane write
 * and nothing was created. "Wait a moment and try again" is the wrong advice for
 * it, and "you are going too fast" is simply untrue — the operator did nothing
 * wrong and no retry in the next few seconds will help.
 *
 * `renderError` always writes the real code into the body, so it is read first
 * and only validated against the known set. The status is consulted when the
 * body is absent or unparseable — a proxy error page, a truncated response.
 */
const KNOWN_CODES = new Set<string>(ERROR_CODES);

function codeFromEnvelope(envelope: Record<string, unknown>, status: number): ErrorCode {
  const declared = envelope.code;
  if (typeof declared === 'string' && KNOWN_CODES.has(declared)) {
    return declared as ErrorCode;
  }
  return codeForStatus(status);
}

function codeForStatus(status: number): ErrorCode {
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
      // missing Template: `templates.read` collapses a missing row into the same
      // answer.
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'failed_precondition';
    case 429:
      // The ambiguous one. `quota_exceeded` shares this status and is only
      // distinguishable from the body, so this is the conservative fallback for
      // a 429 that arrived without a readable envelope.
      return 'rate_limited';
    case 500:
      return 'internal';
    case 501:
      return 'internal';
    case 503:
      return 'unavailable';
    case 504:
      return 'timeout';
    default:
      return 'internal';
  }
}

async function platformRequest(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CONFIG.requestTimeoutMs);

  let response: Response;
  try {
    response = await doFetch(`${CONFIG.apiBaseUrl}${path}`, {
      method: init.method,
      headers:
        init.body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
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

  /*
   * ===========================================================================
   * ANY 2xx IS SUCCESS. THIS IS NOT LAZINESS — CORE AND THE CONTRACT DISAGREE.
   * ===========================================================================
   *
   * `template-v1` declares `successStatus: 201` for `platform.templates.create`
   * (and `organization-onboarding-v1` declares 201 for `organizations.create`).
   * CORE RETURNS 200: `http/api.ts:371` hardcodes it for every platform route,
   * under a comment — "200 for both. Neither route creates a resource" — that
   * was written when the class had exactly two routes and no longer describes
   * it. `PlatformRoute` has no `successStatus` field, so Core structurally
   * cannot emit 201 on this class today.
   *
   * `response.ok` is true for both, so this client works either way and encodes
   * NEITHER SIDE'S BUG. Asserting 201 would break against Core as it stands;
   * asserting 200 would break the day Core is corrected. Reported to the Team
   * Lead as a Core/contract divergence — it is `core-agent`'s to resolve, not
   * something to paper over here.
   */
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
      code: codeFromEnvelope(envelope, response.status),
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

/** Builds `?page_size=&cursor=`, omitting a null or empty cursor. */
function pageQuery(pageSize: number | undefined, cursor: string | null | undefined): string {
  const params = new URLSearchParams();
  if (pageSize !== undefined) params.set('page_size', String(pageSize));
  /*
   * AN EMPTY `?cursor=` IS REFUSED BY CORE RATHER THAN TREATED AS ABSENT, and
   * `readCursorParameter` explains why: "'Present but empty' and 'absent' are
   * different requests, and collapsing them is how a client that failed to store
   * a cursor silently restarts an enumeration from the beginning." So an empty
   * or null cursor is OMITTED, never sent empty.
   */
  if (cursor !== undefined && cursor !== null && cursor !== '') params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export interface PlatformClient {
  whoami(): Promise<WhoamiOutput>;
  listOrganizations(options?: {
    pageSize?: number;
    cursor?: string | null;
  }): Promise<ListOrganizationsOutput>;
  listTemplates(options?: {
    pageSize?: number;
    cursor?: string | null;
  }): Promise<ListTemplatesOutput>;
  readTemplate(templateId: string): Promise<Template>;
  createTemplate(input: CreateTemplateInput): Promise<Template>;
}

export function createPlatformClient(options: { fetchImpl?: typeof fetch } = {}): PlatformClient {
  return {
    async whoami() {
      try {
        return parseWhoami(
          await platformRequest(WHOAMI_PATH, { method: 'GET' }, options.fetchImpl),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async listTemplates({ pageSize, cursor } = {}) {
      try {
        return parseListTemplates(
          await platformRequest(
            `${TEMPLATES_PATH}${pageQuery(pageSize, cursor)}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async readTemplate(templateId) {
      /*
       * THE IDENTIFIER GOES IN THE PATH AND IS ENCODED. This is the first route
       * in the class with a path parameter; Core's matcher validates the single
       * segment against the platform identifier grammar before any lookup, so a
       * value that could not be an identifier never reaches a store. Encoding
       * here means a caller-supplied string cannot inject a second path segment.
       *
       * THE ROUTE DECLARES NO QUERY PARAMETERS AT ALL, so any query string is
       * refused outright. None is appended.
       */
      try {
        return parseTemplate(
          await platformRequest(
            `${TEMPLATES_PATH}/${encodeURIComponent(templateId)}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async createTemplate(input) {
      /*
       * EXACTLY THE TWO DECLARED FIELDS, AND `level_labels` ONLY WHEN NON-EMPTY.
       *
       * The route declares `fields: ['name']` and `objectFields: ['level_labels']`
       * and Core refuses any undeclared field, so there is no `template_id` and
       * no `status` here — the operator chooses neither, and no route sets
       * `status` in version 1.
       *
       * A LABEL THE OPERATOR LEFT BLANK IS OMITTED, NOT SENT AS `''`. Core
       * refuses a zero-length label with `out_of_range`, so sending an empty
       * string for "leave it default" would turn a blank field into a
       * validation error. Omission is what selects the default.
       */
      const labels: Record<string, string> = {};
      for (const [level, value] of Object.entries(input.level_labels ?? {})) {
        if (typeof value === 'string' && value !== '') labels[level] = value;
      }
      const body: Record<string, unknown> = { name: input.name };
      if (Object.keys(labels).length > 0) body.level_labels = labels;

      try {
        return parseTemplate(
          await platformRequest(TEMPLATES_PATH, { method: 'POST', body }, options.fetchImpl),
          'The created Template',
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async listOrganizations({ pageSize, cursor } = {}) {
      try {
        return parseListOrganizations(
          await platformRequest(
            `${ORGANIZATIONS_PATH}${pageQuery(pageSize, cursor)}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },
  };
}
