/**
 * Organization selection — the third route class.
 *
 * SOURCE: packages/contracts/core/identity/organization-selection-v1.contract.yaml
 *         docs/decisions/0021-session-routes.md
 *         platform/core/identity/session-routes.ts (the deployed implementation)
 *
 * ===========================================================================
 * WHY THIS IS NOT A `Transport` METHOD
 * ===========================================================================
 *
 * `Transport.invoke` takes a `DudoAction`, and NEITHER OF THESE IS AN ACTION.
 * `0021` accepts them as a third request class, authenticated at the SESSION
 * level: no `AuthenticatedPrincipal`, no tenant store, no permission
 * evaluation, no `invokeAction`. They are not under `/api/v1` either — a
 * session route whose address depended on which App was mounted would be the
 * wrong shape entirely.
 *
 * So they are spoken directly, the way `auth.ts` speaks login and revocation,
 * and adding them to `BINDINGS` would be a category error rather than a
 * shortcut.
 *
 * ===========================================================================
 * THE TWO PATHS DIFFER BY ONE CHARACTER, AND THE CONTRACT NAMES THAT RISK
 * ===========================================================================
 *
 *   GET  /auth/session/organizations   the picker      (plural)
 *   POST /auth/session/organization    the selection   (singular)
 *
 * Core matches method AND path exactly, and a mismatch is `404` rather than
 * `405` on purpose — a `405` would confirm the path exists, which on the one
 * route in Dudo that names a tenant is free reconnaissance. A typo here
 * therefore produces a `not_found` that looks like a missing record, so both
 * paths are constants declared once and used once.
 *
 * ===========================================================================
 * NO QUERY STRING, EVER, ON EITHER ROUTE
 * ===========================================================================
 *
 * `session-routes.ts` refuses ANY query string wholesale with
 * `invalid_argument / unexpected_query_parameter` — not unknown keys, the whole
 * string. That is a requirement of the route class rather than an inherited
 * behaviour, because a session route matched in Core's early absolute-path
 * block never reaches the Action path's validation at all. Nothing here appends
 * one, and nothing may.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES NOT DECIDE
 * ===========================================================================
 *
 * It sends the identifier the person chose and reports what Core answered.
 * Membership is validated server-side BEFORE any capacity is reserved — a
 * normative ordering, and a security property rather than an efficiency one
 * (reversed, it becomes an Organization-existence oracle). This client cannot
 * observe that ordering and must not try to compensate for it.
 *
 * IT ALSO HOLDS NO MEMORY OF THE CHOICE. The contract forbids a client-side
 * "the Organization I picked last time" applied without calling the route: the
 * server holds the selection, and a local copy would be an ambient tenant in
 * the one place the platform has none.
 */

import { ApiError, toApiError } from './errors';
import { CONFIG } from './config';
import { decodeErrorResponse } from './http-transport';
import { signalUnauthenticated } from './session-signal';
import { setFixtureOrganizationSelected } from './fixture-session-state';

export const ORGANIZATION_PICKER_PATH = '/auth/session/organizations';
export const ORGANIZATION_SELECT_PATH = '/auth/session/organization';

/** The one field `selectOrganizationInput` declares. `additionalProperties: false`. */
export const ORGANIZATION_ID_FIELD = 'organization_id';

/**
 * One entry from the picker.
 *
 * `display_name` IS ALWAYS `null` TODAY AND THAT IS NOT A BUG. `0002_organization.sql`
 * declined a name column deliberately, so the control plane has no name to
 * return. The contract is explicit that a client renders the identifier
 * verbatim and INVENTS NO PLACEHOLDER — "Organization 1" would be a name Dudo
 * does not have, shown as though it did.
 */
export interface EnterableOrganization {
  readonly organization_id: string;
  readonly display_name: string | null;
}

export interface OrganizationClient {
  /**
   * `GET /auth/session/organizations`.
   *
   * AN EMPTY ARRAY IS A VALID ANSWER, NOT A FAILURE. A principal with no active
   * membership receives `200` with `data: []` — an empty collection is not a
   * missing one, and the route never answers `not_found`, because a `404` here
   * would be a statement about the principal.
   *
   * THE LIST IS FILTERED TO ACTIVE MEMBERSHIPS SERVER-SIDE. A suspended
   * membership is omitted entirely, so an Organization DISAPPEARS from the
   * picker rather than appearing and then refusing selection.
   */
  listEnterable(): Promise<EnterableOrganization[]>;
  /**
   * `POST /auth/session/organization`.
   *
   * Resolves on `200`. Rejects with an `ApiError` otherwise — `not_found` for
   * an identifier this principal may not enter (three cases, deliberately
   * indistinguishable), `quota_exceeded` carrying a `Retry-After`,
   * `invalid_argument` for a malformed identifier.
   *
   * THERE IS NO `Set-Cookie` ON THIS ROUTE AND NONE IS EXPECTED. The session is
   * updated server-side against the credential the browser already holds; a
   * rotated credential here would be a contract violation, not an upgrade.
   */
  select(organizationId: string): Promise<void>;
  readonly name: string;
}

/* -------------------------------------------------------------------------
   The HTTP client
   ------------------------------------------------------------------------- */

interface HttpOrganizationOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Reads `{"data":[...]}` defensively.
 *
 * A malformed body is reported as `internal` rather than rendered as an empty
 * picker: "you belong to no Organizations" and "the response did not parse" are
 * different facts, and showing the first when the second happened would send
 * someone to an administrator over a client bug.
 */
function readPicker(payload: unknown): EnterableOrganization[] {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) {
    throw new ApiError({
      code: 'internal',
      message: 'The Organization picker did not answer with a data array.',
    });
  }
  return data.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    if (typeof record.organization_id !== 'string' || record.organization_id === '') {
      throw new ApiError({
        code: 'internal',
        message: 'An Organization in the picker carried no identifier.',
      });
    }
    return {
      organization_id: record.organization_id,
      // Anything other than a non-empty string is `null`. The contract permits
      // only `null` today; a future name must not arrive as `""` and render as
      // a blank button.
      display_name: typeof record.display_name === 'string' && record.display_name !== ''
        ? record.display_name
        : null,
    };
  });
}

export function createHttpOrganizationClient(
  options: HttpOrganizationOptions = {},
): OrganizationClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? CONFIG.apiBaseUrl;
  const timeoutMs = options.timeoutMs ?? CONFIG.requestTimeoutMs;

  async function send(path: string, method: 'GET' | 'POST', body?: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body,
        // The session cookie, exactly as on every other authenticated request.
        // ADR 0015 §A: one value, two carriers — the cookie for web, a Bearer
        // header for Apple. Neither route introduces a new credential.
        credentials: 'same-origin',
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
      throw new ApiError({ code: 'unavailable', message: 'The request did not reach Dudo.' });
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
      // Same notification the transport fires, for the same reason: the gate
      // above needs to stop pretending someone is signed in. It is presentation
      // — Core already refused the request, which is where it counts.
      if (response.status === 401) signalUnauthenticated();
      throw decodeErrorResponse(response, payload);
    }
    return payload;
  }

  return {
    name: 'http',

    async listEnterable() {
      return readPicker(await send(ORGANIZATION_PICKER_PATH, 'GET'));
    },

    async select(organizationId) {
      // EXACTLY ONE FIELD. `selectOrganizationInput` is `additionalProperties:
      // false`, so a "remember this choice" or "client_version" alongside it
      // would fail the whole request.
      await send(
        ORGANIZATION_SELECT_PATH,
        'POST',
        JSON.stringify({ [ORGANIZATION_ID_FIELD]: organizationId }),
      );
    },
  };
}

/* -------------------------------------------------------------------------
   The fixture client
   ------------------------------------------------------------------------- */

/**
 * The fixture Organization client.
 *
 * IT EXISTS SO THE PICKER CAN BE REVIEWED WITHOUT A DEPLOYMENT, which is the
 * gap that produced this defect in the first place: every verification of this
 * flow was performed by hand against staging, the deployed client never
 * performed it, and nothing local exercised it at all.
 *
 * How many Organizations it offers is `VITE_DUDO_FIXTURE_ORGANIZATIONS`, and
 * both branches matter — one Organization takes the auto-select path with no
 * picker drawn, two or more takes the picker. The identifiers are synthetic and
 * shaped like real ones (22 base64url characters, `0021` OS-7) so the picker is
 * reviewed against the string lengths it will really receive.
 */
export function createFixtureOrganizationClient(
  count: number = CONFIG.fixtureOrganizations,
): OrganizationClient {
  const organizations: EnterableOrganization[] = Array.from({ length: count }, (_, index) => ({
    // 22 characters, deterministic, and obviously synthetic on inspection.
    organization_id: `fixtureOrg${String(index + 1).padStart(2, '0')}AAAAAAAAAA`.slice(0, 22),
    // `null`, like the real control plane. A fixture that invented names would
    // hide the actual product problem behind convincing test data.
    display_name: null,
  }));

  return {
    name: 'fixture',
    async listEnterable() {
      await new Promise((resolve) => setTimeout(resolve, 140));
      return organizations;
    },
    async select(organizationId) {
      await new Promise((resolve) => setTimeout(resolve, 160));
      if (!organizations.some((entry) => entry.organization_id === organizationId)) {
        // The race the contract names: an identifier the picker no longer
        // offers is `not_found`, never a bug report.
        throw new ApiError({
          code: 'not_found',
          message: 'Fixture selection: that Organization is not one this principal may enter.',
        });
      }
      // WHICH one was chosen is deliberately not recorded — see
      // `fixture-session-state.ts`. Only that one was.
      setFixtureOrganizationSelected(true);
    },
  };
}

export function createOrganizationClient(): OrganizationClient {
  return CONFIG.transport === 'http'
    ? createHttpOrganizationClient()
    : createFixtureOrganizationClient();
}

/**
 * Whether an `ApiError` is Core saying "no Organization is selected".
 *
 * IT CANNOT BE ANSWERED FROM THE ERROR ALONE, AND THAT IS THE POINT OF THIS
 * COMMENT. `kernel/errors.ts` builds `failedPrecondition()` with NO arguments
 * and a CONSTANT message, so the 422 for an unselected Organization is
 * byte-identical to the 422 for archiving an already-archived customer. Same
 * code, same status, same message, no details.
 *
 * So this predicate says only "this 422 MIGHT be the Organization state", and
 * the caller resolves it by probing — see `probeSession`, which uses an Action
 * that declares no `failed_precondition` of its own.
 */
export function mayBeOrganizationRequired(error: unknown): boolean {
  return toApiError(error).code === 'failed_precondition';
}
