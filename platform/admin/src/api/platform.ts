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
import {
  PLATFORM_CONFIRMATIONS_PATH,
  asConfirmationError,
  parseConfirmationChallenge,
  withConfirmation,
  type ConfirmationChallenge,
  type ConfirmationParameters,
} from './confirmation';
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

/*
 * ===========================================================================
 * FOUR `Known…` UNIONS, AND THE PREFIX IS LOAD-BEARING RATHER THAN TIDY
 * ===========================================================================
 *
 * These were `OrganizationStatus`, `PlatformRole`, `TemplateStatus` and
 * `MembershipRole` — **the exact names the contract now exports for the same
 * fields, meaning something different.** Renamed 2026-09-09.
 *
 * `0041` splits every `extensible` enum in two: the WIRE type, which carries
 * `(string & {})` because a value this build never learned may arrive, and the
 * KNOWN SUBSET, which is what this build understands and what a guard narrows
 * to. **Both are correct and they are not the same type.**
 *
 * **Sharing one name across that boundary is `architecture.md` §1a's defect** —
 * one name, two meanings, each locally coherent — and it was becoming live
 * rather than theoretical: this file already imports generated types, so
 * `TemplateStatus` here and `TemplateStatus` in `@dudo/contracts` were one
 * import away from being read as the same thing.
 *
 * **The failure it prevents is silent.** A guard declared `x is PlatformRole`
 * against the EXTENSIBLE union proves nothing — the arm absorbs every string —
 * so the branch after it would be believed rather than checked, and nothing
 * would go red. **`§1a`'s remedy applies: rename BOTH sides so neither meaning
 * holds the bare word**, and the prefixed name is greppable where the bare one
 * is not.
 */

/** `organizationStatus`, as far as this build understands it. See `isKnownStatus`. */
export type KnownOrganizationStatus = 'active' | 'suspended';

/** `platformRole`. The two platform-scope seed roles this build renders by name. */
export type KnownPlatformRole = 'platform-admin' | 'marketplace-moderator';

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
  /**
   * RFC 3339, UTC.
   *
   * THE PRECISION IS DELIBERATELY NOT ASSERTED HERE. This comment read "second
   * precision", transcribed from `platform-operator-v1`'s schema — but
   * `platform/core/kernel/clock.ts:26` emits MILLISECONDS, so that claim is at
   * best unverified for this field and at worst a contract/implementation
   * divergence (reported to the Team Lead; `packages/contracts` is not this
   * console's to change).
   *
   * NOTHING HERE DEPENDS ON IT — the value is rendered as a date and never
   * compared against a boundary — so the claim is dropped rather than corrected
   * on a guess. See `utcMidnight` for the one place precision IS load-bearing.
   */
  readonly created_at: string;
  /**
   * THE ORGANIZATION'S NAME, OR NULL WHEN NONE HAS EVER BEEN RECORDED.
   *
   * THIS SAID "ALWAYS NULL TODAY" AND THAT STOPPED BEING TRUE ON 2026-09-07,
   * when `organization-identity-v1` gave the field a route that sets it. Null is
   * now a real and shrinking state rather than the only state — reachable for
   * Organizations that predate the field, and while `display_name` is optional
   * on the onboarding write path, reachable for new ones too.
   *
   * ALSO: IT WAS MOVED INTO `required` IN THE SCHEMA ON THE SAME DAY. It had
   * been in `properties` and not in `required` under `additionalProperties:
   * false` — a permitted optional field, latent only while the value was always
   * null. This parser has always required it, so the fix changed nothing here.
   *
   * WHEN IT IS NULL THE IDENTIFIER IS RENDERED VERBATIM. `platform-route-handlers.ts`
   * states it as a rule binding both clients: "not a blank, not a dash, not
   * 'Unnamed Organization'." A placeholder invented here and a different one
   * invented on iPhone is exactly the divergence the one-contract rule exists to
   * prevent.
   *
   * THE REGISTRATIONS ARE DELIBERATELY NOT ON THIS ROW. "Two objects per row
   * inflate every page of a listing that needs a label, and the detail route is
   * one click away."
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

export function isKnownStatus(status: string): status is KnownOrganizationStatus {
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

/** `templateStatus`, as far as this build understands it. See `isKnownTemplateStatus`. */
export type KnownTemplateStatus = 'active' | 'retired';

/**
 * ===========================================================================
 * TEMPLATES, CONSUMED FROM THE CONTRACT (0037, 0041)
 * ===========================================================================
 *
 * `Template` is the contract's `TemplateOutput`, renamed at the boundary
 * because this console has always called it a Template and the screens read
 * better for it. **The shape is not restated** — only the name is local.
 *
 * `status` was `string` here, with a comment that has now been ANSWERED rather
 * than deleted: *"narrowing by cast would be this client asserting Core's
 * guarantee on Core's behalf."* **That was correct while the generated type was
 * a bare `'active' | 'retired'`.** `templateStatus` is declared `extensible`,
 * so the emitted type carries `(string & {})` — an explicit arm for a value
 * this client was never taught — and adopting it asserts nothing on Core's
 * behalf. `isKnownTemplateStatus` still narrows, and the neutral branch in
 * `StatusBadge` is still reachable.
 *
 * **The field is still set by no route in version 1**, so every Template is
 * `active`. That is a fact about Core, not about the type, and it is why the
 * screen says so on its face.
 *
 * `level_labels` is required and complete on the way OUT and a partial subset
 * on the way IN — the contract distinguishes them and so do the two generated
 * types. **The reason the request omits blanks rather than sending `''` is not
 * in the generated type and stays here:** Core refuses a zero-length label with
 * `out_of_range`, so sending `''` for "leave it default" turns a blank field
 * into a validation error.
 *
 * **`parseTemplate` and `parseListTemplates` are untouched.**
 */
export type {
  TemplateOutput as Template,
  ListTemplatesOutput,
  CreateTemplateInput,
} from '@dudo/contracts/core/platform/template-v1';
import type {
  TemplateOutput as Template,
  ListTemplatesOutput,
  CreateTemplateInput,
} from '@dudo/contracts/core/platform/template-v1';

export function isKnownTemplateStatus(status: string): status is KnownTemplateStatus {
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

/* -------------------------------------------------------------------------
   The audit feeds — `platform-audit-read-v1`, accepted
   -------------------------------------------------------------------------
   THE TWO RECORD SHAPES DIFFER BY EXACTLY ONE FIELD AND THAT DIFFERENCE IS THE
   SECURITY PROPERTY OF THE CONTRACT.

   `PlatformFeedRecord` carries `target_organization_id` and HAS NO
   `target_principal_id`. `OrganizationFeedRecord` carries
   `target_principal_id` and has no `target_organization_id` — the path
   parameter already fixed the Organization, and repeating it "would invite a
   client to trust the body over the path".

   THEY ARE TWO TYPES RATHER THAN ONE WITH OPTIONAL FIELDS, DELIBERATELY. A
   single record type with both fields optional would make "render the principal
   target on the platform feed" a reachable state that only a convention
   forbids. Here it does not compile: `PlatformFeedRecord` has no such property
   to read, so the omission is held by the type rather than by an `if` a later
   author could invert.

   WHY THE FIELD IS OMITTED AT ALL: every resolve record is "principal P was
   resolved in Organization O", which is a membership fact. A bulk read collects
   every one of them in a single request the affected tenants cannot see, and
   they aggregate into exactly the CO1 mapping `organization-detail-v1` refuses.
   The Organization-level target is fine — an operator can enumerate
   Organizations from their own home screen.
   ------------------------------------------------------------------------- */

export const AUDIT_PATH = `${PLATFORM_BASE_PATH}/audit`;

/*
 * `PlatformRoleName` WAS DECLARED HERE AND WAS A DUPLICATE OF THE UNION ABOVE.
 *
 * Two names for one literal set, in one file, both `'platform-admin' |
 * 'marketplace-moderator'` — invisible while the other was called `PlatformRole`
 * and eight hundred lines away, and surfaced by renaming it to
 * `KnownPlatformRole`. **A duplicated constraint has no citations, so no sweep
 * finds it** (`workflow.md` §12); it turned up only because the rename forced
 * the compiler to name every use.
 *
 * `isKnownPlatformRole` now narrows to `KnownPlatformRole`, so there is one
 * definition and the audit feed and the operator roster cannot drift apart on
 * what a platform role is.
 */
export type AuditOutcome = 'succeeded' | 'failed';

/** The seven fields both feeds share. Neither target field is in here. */
export interface AuditRecordCommon {
  readonly record_id: string;
  readonly occurred_at: string;
  /**
   * WHICH OPERATOR ACTED. Not a leak: "operators are a known set to anyone who
   * can read this feed at all, and identifying the actor is the entire point of
   * an operator log."
   */
  readonly actor_principal_id: string;
  /** The role AT THE TIME OF THE ACTION — a later change must not rewrite history. */
  readonly actor_platform_role: string;
  readonly action_id: string;
  readonly outcome: string;
  /** The only identifier crossing the two audit homes. */
  readonly correlation_id: string;
}

export interface PlatformFeedRecord extends AuditRecordCommon {
  /** Null for an action naming no Organization — a Template create, a whoami. */
  readonly target_organization_id: string | null;
  /**
   * THERE IS NO `target_principal_id` HERE AND THERE MUST NEVER BE ONE.
   * Stated as a comment because a type cannot carry a prohibition — but the
   * absence itself is the enforcement: nothing can render what nothing holds.
   */
}

export interface OrganizationFeedRecord extends AuditRecordCommon {
  /** THE FIELD THE PLATFORM FEED OMITS. Null for an action naming no principal. */
  readonly target_principal_id: string | null;
}

export interface PlatformFeedOutput {
  readonly data: readonly PlatformFeedRecord[];
  readonly next_cursor: string | null;
}

export interface OrganizationFeedOutput {
  readonly data: readonly OrganizationFeedRecord[];
  readonly next_cursor: string | null;
}

/**
 * The filters each feed accepts. **THE TWO SETS DIFFER.**
 *
 * The platform feed takes `actor_principal_id`; the Organization feed does not.
 * And NEITHER takes `target_principal_id`: filtering by a principal and counting
 * results discloses that principal's Organizations one bit at a time, which is
 * the omitted field reconstructed through a query parameter. The contract is
 * explicit that supplying one is REFUSED rather than ignored — "an ignored
 * parameter is a parameter someone will later honour" — so this client has no
 * way to express it and never sends one.
 */
export interface PlatformFeedFilters {
  readonly actor_principal_id?: string;
  readonly action_id?: string;
  /**
   * RFC 3339 UTC with EXACTLY THREE fractional digits, `[since, until)`.
   * Built by `toUtcDayStart` / `toUtcExclusiveDayEnd` — never taken from an
   * input, and never assembled by concatenation. See their header for why the
   * width is a correctness rule.
   */
  readonly since?: string;
  readonly until?: string;
}

export interface OrganizationFeedFilters {
  readonly action_id?: string;
  readonly since?: string;
  readonly until?: string;
}

export function isKnownAuditOutcome(value: string): value is AuditOutcome {
  return value === 'succeeded' || value === 'failed';
}

export function isKnownPlatformRole(value: string): value is KnownPlatformRole {
  return value === 'platform-admin' || value === 'marketplace-moderator';
}

function parseAuditCommon(
  entry: Record<string, unknown>,
  what: string,
): AuditRecordCommon {
  return {
    record_id: requireString(entry, 'record_id', what),
    occurred_at: requireString(entry, 'occurred_at', what),
    actor_principal_id: requireString(entry, 'actor_principal_id', what),
    actor_platform_role: requireString(entry, 'actor_platform_role', what),
    action_id: requireString(entry, 'action_id', what),
    outcome: requireString(entry, 'outcome', what),
    correlation_id: requireString(entry, 'correlation_id', what),
  };
}

/**
 * The platform feed.
 *
 * IT DOES NOT READ `target_principal_id`, AND THAT IS NOT AN OVERSIGHT. If Core
 * ever emitted one, this parser would drop it on the floor rather than carry it
 * into a type that has nowhere to put it — the field never enters the client's
 * memory, let alone its render tree. That is the client half of "assert the
 * field is absent from the shape AND that no code path populates it".
 */
export function parsePlatformFeed(payload: unknown): PlatformFeedOutput {
  const what = 'The platform audit feed response';
  const body = requireObject(payload, what);
  const rows = body.data;
  if (!Array.isArray(rows)) {
    throw new ShapeError(`${what} field "data" was not an array.`);
  }
  return {
    data: Object.freeze(
      rows.map((row, index) => {
        const label = `Platform audit record ${String(index)}`;
        const entry = requireObject(row, label);
        return {
          ...parseAuditCommon(entry, label),
          target_organization_id: requireNullableString(entry, 'target_organization_id', label),
        };
      }),
    ),
    next_cursor: requireNullableString(body, 'next_cursor', what),
  };
}

export function parseOrganizationFeed(payload: unknown): OrganizationFeedOutput {
  const what = 'The Organization audit feed response';
  const body = requireObject(payload, what);
  const rows = body.data;
  if (!Array.isArray(rows)) {
    throw new ShapeError(`${what} field "data" was not an array.`);
  }
  return {
    data: Object.freeze(
      rows.map((row, index) => {
        const label = `Organization audit record ${String(index)}`;
        const entry = requireObject(row, label);
        return {
          ...parseAuditCommon(entry, label),
          target_principal_id: requireNullableString(entry, 'target_principal_id', label),
        };
      }),
    ),
    next_cursor: requireNullableString(body, 'next_cursor', what),
  };
}

/* -------------------------------------------------------------------------
   Platform operators — `platform-operators-v1`, accepted. LIST ONLY.
   ------------------------------------------------------------------------- */

export const OPERATORS_PATH = `${PLATFORM_BASE_PATH}/operators`;

/**
 * THE PATH TEMPLATE IS THE DECLARATION of this route's bound parameters.
 *
 * `{principal_id}` is the one declared name, and it is derived from THIS STRING
 * by `declaredPathParameters` — the same string used to build the URL. "One
 * source, two readers", so no list on either side can drift.
 */
export const REVOKE_OPERATOR_PATH_TEMPLATE = `${OPERATORS_PATH}/{principal_id}/revoke`;
export const REVOKE_OPERATOR_ACTION_ID = 'platform.operators.revoke';

/** No path parameters — the target is a body field. */
export const CREDENTIAL_RESET_PATH = `${PLATFORM_BASE_PATH}/credentials/reset`;
export const CREDENTIAL_RESET_ACTION_ID = 'platform.credentials.reset';

/**
 * ===========================================================================
 * THE OPERATOR ROSTER, CONSUMED FROM THE CONTRACT (0037, 0041)
 * ===========================================================================
 *
 * `platform_role` was `string` here, with the same reasoning `status` carried:
 * narrowing it by cast would be this client asserting Core's guarantee on
 * Core's behalf, and `RoleBadge` deliberately renders an unrecognised role
 * neutrally with a screen-reader note.
 *
 * **`0041` RESOLVED THAT, AND `isKnownPlatformRole` IS NOT DEAD CODE.**
 * `platformRole` is declared `extensible`, so the generated type is
 * `'platform-admin' | 'marketplace-moderator' | (string & {})` — a union with
 * **an explicit arm for the value this client was never taught.** The tolerant
 * branch is now the arm the type provides for rather than a branch the type
 * says is unreachable. **Before the arm existed, adopting the bare union would
 * have raised the compile-time claim without raising the runtime check.**
 *
 * `created_at` is when platform authority was GRANTED, not when the principal
 * was created — a fact about the field that the generated type cannot carry,
 * so it stays here.
 *
 * **`parseListOperators` is untouched.** It still validates what arrived.
 */
export type {
  OperatorSummary,
  ListOperatorsOutput,
} from '@dudo/contracts/core/platform/platform-operators-v1';
/* Only `ListOperatorsOutput` is named locally — by `parseListOperators` below. */
import type { ListOperatorsOutput } from '@dudo/contracts/core/platform/platform-operators-v1';

/**
 * NOTE WHAT IS ABSENT AND MUST STAY ABSENT: no identifier, no email, no display
 * name, no last-seen. `0001_principal.sql` refused an email column outright,
 * because "a directory of every user's personal details, readable without any
 * tenant scope, would be the highest-value target in the system" — and an
 * operator roster showing email addresses would be that directory at the most
 * privileged end of the platform.
 *
 * The cost is real and named: an operator cannot tell colleagues apart on
 * screen. That is OP-3, closed by display names, never by adding a column here.
 */
export function parseListOperators(payload: unknown): ListOperatorsOutput {
  const what = 'The operators list response';
  const body = requireObject(payload, what);
  const rows = body.data;
  if (!Array.isArray(rows)) {
    throw new ShapeError(`${what} field "data" was not an array.`);
  }
  return {
    data: Object.freeze(
      rows.map((row, index) => {
        const label = `Operator row ${String(index)}`;
        const entry = requireObject(row, label);
        return {
          principal_id: requireString(entry, 'principal_id', label),
          platform_role: requireString(entry, 'platform_role', label),
          created_at: requireString(entry, 'created_at', label),
        };
      }),
    ),
    next_cursor: requireNullableString(body, 'next_cursor', what),
  };
}

/* -------------------------------------------------------------------------
   Organization detail — `organization-detail-v1`, accepted
   ------------------------------------------------------------------------- */

/**
 * ===========================================================================
 * THE WIRE TYPE AND THE KNOWN SUBSET ARE DIFFERENT TYPES. THIS IS THE SECOND.
 * ===========================================================================
 *
 * **`0041` splits every `extensible` enum in two, and the split needs two
 * names.** The contract's `MembershipRole` is the WIRE type — what may ARRIVE,
 * including a value this build was never taught, which is why the generated
 * union carries `(string & {})`. **`KnownMembershipRole` is what this build
 * UNDERSTANDS**, and it is what a type guard must narrow to.
 *
 * **NARROWING TO THE WIRE TYPE WOULD BE NARROWING TO NOTHING.** A guard
 * declared `role is MembershipRole` against an extensible union proves nothing
 * the caller did not already have — the arm absorbs every string — so the
 * branch that follows would be believed rather than checked.
 *
 * **This union is NOT a restatement of the generated type (`0037` req 2).** It
 * is the proper subset the generated type deliberately does not express, and it
 * exists because the contract says a third value is expected: `membershipRole`'s
 * own `$comment` records that `authorization/roles.ts` is a closed union of two
 * while `0007` D10 says roles are data, and that `0023`'s reconciliation trigger
 * has already fired. **A third role is the expected outcome, not a hypothetical**
 * — so this list must be widened by hand, deliberately, when one lands.
 */
export type KnownMembershipRole = 'owner' | 'member';

export interface EmbeddedTemplate {
  readonly template_id: string;
  readonly name: string;
  readonly level_labels: Readonly<Record<TemplateLevel, string>>;
}

/* -------------------------------------------------------------------------
   Organization identity — `organization-identity-v1`
   -------------------------------------------------------------------------
   THREE FIELDS: a display name, a commercial registration and a VAT
   registration. THE TWO REGISTRATIONS SHARE ONE SHAPE, deliberately — they are
   two instances of one category (a government-issued identifier recorded about
   an Organization), and the shared shape is what makes a third instance a
   decision rather than a default.

   EVERY REGISTRATION HAS THREE STATES, NOT TWO, AND THIS CONSOLE MUST NOT
   COLLAPSE THE FIRST TWO:

     not_recorded    NOBODY HAS ASKED. The default for every Organization.
     not_registered  THE CUSTOMER STATED THEY HAVE NONE — a legitimate,
                     permanent, positive fact. Bahrain VAT registration is
                     mandatory above a threshold and voluntary below it.
     registered      A number is recorded, verified or not.

   "Merged, you cannot tell 'they told us they are not registered' from 'we
   never asked', so you cannot decide whether to prompt and cannot defend the
   record afterwards." A console that renders `not_registered` as missing data
   keeps prompting a customer who has already answered.

   IT IS MODELLED AS A DISCRIMINATED UNION RATHER THAN A NULLABLE NUMBER BESIDE
   A FLAG, so `{ state: 'not_registered', number: '123' }` cannot be
   constructed. The contract chose that shape for something read once, years
   later, by someone who cannot ask; this client keeps it rather than flattening
   it into optional fields at the parse boundary.
   ------------------------------------------------------------------------- */

/**
 * WHO CHECKED THIS NUMBER AGAINST THE ISSUING REGISTRY, AND WHEN.
 *
 * EVERY FIELD IS SERVER-STAMPED AND NONE IS CALLER-SUPPLIED — the operator from
 * the authenticated platform context, the instant from Core's clock. There is
 * no input shape for this type anywhere in this file, and there must not be: a
 * caller-supplied provenance value is not provenance.
 */
/**
 * ===========================================================================
 * THE IDENTITY SHAPES, CONSUMED FROM THE CONTRACT — THE LAST SWAP (0037, 0041)
 * ===========================================================================
 *
 * **This one waited longest and for the best reason.** `RegistrationRecord` is
 * a `oneOf` variant union, not an enum, so `0041` did not reach it: the
 * generated type had **three** arms while this client deliberately had four.
 * Adopting it then would have deleted `raw` from the type, turned the panel
 * that renders it into a compile error, and left deleting a reachable UI state
 * as the only way to make the build pass — **`0037`'s trap arriving as a
 * tidy-up, in a diff that only deletes.**
 *
 * `0041` amendment 2 extended `enumPolicy` to variant sets, and the emitted
 * type now carries the fourth arm:
 *
 *     | { readonly state: 'unrecognised'; readonly raw: string }
 *
 * **THE ARM IS THIS FILE'S SHAPE, ADOPTED RATHER THAN INVENTED**, and the
 * contract's `$comment` says so on its face. The detail that decided it:
 * `raw` carries the raw **DISCRIMINANT**, never the body — *a client meeting an
 * unknown variant cannot read that variant's sibling fields*, so a `raw`
 * holding the whole payload would be an object nothing can narrow, handed to a
 * screen that is forbidden to act on it.
 *
 * **WHAT THE ARM DOES NOT LICENSE, because its new legitimacy invites exactly
 * this:** `0028` still governs — *a value you do not understand is not a value
 * you may branch on.* The arm exists so `OrganizationIdentity.tsx` can SAY it
 * cannot read the state. **It is not a fourth state with behaviour**, and
 * nothing downstream may treat it as one.
 *
 * ---------------------------------------------------------------------------
 * TWO FACTS THE GENERATED TYPES CANNOT CARRY
 * ---------------------------------------------------------------------------
 *
 * `verification: null` MEANS RECORDED BUT UNVERIFIED, and it is a state this
 * console renders DISTINCTLY. *"A number an operator typed"* and *"a number an
 * operator checked against the registry"* are the two things the whole design
 * exists to keep apart.
 *
 * `RegistrationInput.verified` IS REQUIRED RATHER THAN DEFAULTING TO FALSE, so
 * the operator makes the claim or declines it explicitly and **no code path
 * here produces a verification by omission.** `true` means *I have just checked
 * this number against the issuing registry*; Core stamps the acting operator
 * and the instant.
 *
 * ---------------------------------------------------------------------------
 * AND `registrationInput` IS `closed` WHILE `registrationRecord` IS EXTENSIBLE
 * ---------------------------------------------------------------------------
 *
 * **Same three states, opposite policy, and it is not drift** — `0041`
 * amendment 1's first live instance. The contract's reason: *"there is no
 * direction in which a client may send Core a state neither of them has agreed
 * on; the tolerant reading would have Core accepting an unknown state from an
 * untrusted caller, which is not tolerance but a validation hole."*
 *
 * So the INPUT union is exact and narrowing on it may legitimately use the
 * generated type. The RESPONSE union is not.
 */
export type {
  RegistrationVerification,
  RegistrationRecord,
  RegistrationInput,
  OrganizationIdentity,
  UpdateOrganizationIdentityInput,
} from '@dudo/contracts/core/platform/organization-identity-v1';
/* The names this file itself uses — the parsers and the client interface. */
import type {
  RegistrationRecord,
  RegistrationVerification,
  OrganizationIdentity,
  UpdateOrganizationIdentityInput,
} from '@dudo/contracts/core/platform/organization-identity-v1';

/*
 * `RegistrationInput`, `OrganizationIdentity` and `UpdateOrganizationIdentityInput`
 * WERE DECLARED HERE. They are consumed from the contract above.
 *
 * Two properties of the update route that the generated types state
 * structurally rather than in prose, kept because the reason is not obvious
 * from the shape:
 *
 * **PARTIAL. An omitted field is UNCHANGED; a present field is REPLACED WHOLE,
 * and THERE IS NO MERGE INSIDE A REGISTRATION.** Sending
 * `{ state: 'registered', number, verified }` replaces the entire record —
 * which is what keeps a verification from surviving a number it does not
 * attest to.
 *
 * **`display_name` CANNOT BE SET TO NULL.** Renaming is permitted, un-naming is
 * not, because null is a legacy state rather than a choice. **There is no
 * `| null` on that property in the generated type either, and that absence is
 * the enforcement** — the contract and this client agree, and now they agree by
 * construction rather than by two people writing the same thing.
 */

/**
 * The two bounds, transcribed from `organization-identity-v1.schema.json`.
 *
 * ASSERTED AGAINST THE SCHEMA FILE by `verify-platform.mjs` rather than trusted
 * — the same treatment `MAX_WINDOW_DAYS` gets, and for the same reason: a
 * number copied out of a document is a claim that was true when it was copied.
 */
export const MAX_DISPLAY_NAME_LENGTH = 200;
export const MAX_REGISTRATION_NUMBER_LENGTH = 32;

/**
 * The registration-number hygiene bound.
 *
 * *** THERE IS DELIBERATELY NO DIGIT COUNT AND NO PER-JURISDICTION FORMAT, AND
 * THE ABSENCE IS A RULING RATHER THAN AN OMISSION. *** Bahrain VAT account
 * numbers are widely reported as fifteen digits; that figure comes from
 * secondary sources and is NOT in this pattern. **A pattern is a refusal** — an
 * at-count pattern that is wrong REFUSES A LEGAL REGISTRATION, and the failure
 * lands on a customer who cannot be onboarded and an operator whose only remedy
 * is to invent a value.
 *
 * SO DO NOT NARROW THIS HERE. Narrowing it is BREAKING under `API_STANDARD.md`
 * §6 and requires a decision record citing the issuing authority's published
 * specification by document and date. A console that narrowed it locally would
 * produce exactly that refusal with none of that record.
 */
const REGISTRATION_NUMBER_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$/;

/** `displayName`'s pattern: no leading or trailing whitespace. */
const DISPLAY_NAME_PATTERN = /^[^\s].*[^\s]$|^[^\s]$/s;

/**
 * Local shape refusal for a display name. Returns a sentence, or `null`.
 *
 * IT REFUSES RATHER THAN TRIMS, matching `templateNameRefusal` — the pattern is
 * `templateName`'s, transcribed by the contract so the two human-entered names
 * in the platform class agree. Trimming silently would store a value the
 * operator did not type.
 *
 * EVERY CONDITION IS ABOUT WHAT THE OPERATOR JUST TYPED and none is a fact
 * about data, so refusing locally discloses nothing — the same line the window
 * pre-check and the member-lookup identifier check sit on.
 */
export function displayNameRefusal(value: string): string | null {
  if (value === '') return 'A name cannot be empty.';
  if (!DISPLAY_NAME_PATTERN.test(value)) {
    return 'A name cannot start or end with a space. Type it without the padding rather than relying on Dudo to trim it.';
  }
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return `A name can be at most ${String(MAX_DISPLAY_NAME_LENGTH)} characters. This one is ${String(value.length)}.`;
  }
  return null;
}

/** Local shape refusal for a registration number. Returns a sentence, or `null`. */
export function registrationNumberRefusal(value: string): string | null {
  if (value === '') return 'Type the number, or choose one of the other two states.';
  if (value.length > MAX_REGISTRATION_NUMBER_LENGTH) {
    return `A registration number can be at most ${String(MAX_REGISTRATION_NUMBER_LENGTH)} characters. This one is ${String(value.length)}.`;
  }
  if (!REGISTRATION_NUMBER_PATTERN.test(value)) {
    return 'Use letters, digits, spaces and hyphens only, and do not start or end with a space or a hyphen. Dudo records the number as the registry issues it and checks nothing else about its shape.';
  }
  return null;
}

export const REGISTRATION_STATES = ['not_recorded', 'not_registered', 'registered'] as const;
export type RegistrationState = (typeof REGISTRATION_STATES)[number];

export function isKnownRegistrationState(value: string): value is RegistrationState {
  return (REGISTRATION_STATES as readonly string[]).includes(value);
}

export function parseRegistrationRecord(payload: unknown, what: string): RegistrationRecord {
  const body = requireObject(payload, what);
  const state = requireString(body, 'state', what);

  if (state === 'not_recorded') return { state: 'not_recorded' };

  if (state === 'not_registered') {
    /*
     * `declared_at` IS REQUIRED HERE AND IS WHAT SEPARATES THIS FROM
     * `not_recorded` IN SUBSTANCE. "An assertion with a date is a fact somebody
     * can be held to, and one without is indistinguishable from a default." So
     * a missing one is refused rather than rendered as an undated declaration.
     */
    return { state: 'not_registered', declared_at: requireString(body, 'declared_at', what) };
  }

  if (state === 'registered') {
    if (!('verification' in body)) {
      throw new ShapeError(`${what} is missing the required field "verification".`);
    }
    const rawVerification = body.verification;
    let verification: RegistrationVerification | null = null;
    if (rawVerification !== null) {
      const nested = requireObject(rawVerification, `${what} field "verification"`);
      verification = {
        verified_by_principal_id: requireString(
          nested,
          'verified_by_principal_id',
          `${what} field "verification"`,
        ),
        verified_at: requireString(nested, 'verified_at', `${what} field "verification"`),
      };
    }
    return {
      state: 'registered',
      number: requireString(body, 'number', what),
      recorded_at: requireString(body, 'recorded_at', what),
      verification,
    };
  }

  /*
   * A STATE THIS BUILD HAS NEVER HEARD OF. Carried through rather than thrown,
   * so one unknown registration does not take down a detail page whose other
   * six fields are fine — and rendered as unrecognised rather than silently
   * mapped onto `not_recorded`, which would tell an operator nobody had asked
   * when the truth is that this console cannot read the answer.
   */
  return { state: 'unrecognised', raw: state };
}

export function parseOrganizationIdentity(payload: unknown, what: string): OrganizationIdentity {
  const body = requireObject(payload, what);
  if (!('commercial_registration' in body) || !('vat_registration' in body)) {
    throw new ShapeError(
      `${what} is missing "commercial_registration" or "vat_registration". Both are required.`,
    );
  }
  return {
    display_name: requireNullableString(body, 'display_name', what),
    commercial_registration: parseRegistrationRecord(
      body.commercial_registration,
      `${what} field "commercial_registration"`,
    ),
    vat_registration: parseRegistrationRecord(
      body.vat_registration,
      `${what} field "vat_registration"`,
    ),
  };
}

/**
 * ===========================================================================
 * ORGANIZATION DETAIL, CONSUMED FROM THE CONTRACT (0037, 0041)
 * ===========================================================================
 *
 * `status` is `extensible` and the emitted type carries `(string & {})`, so
 * `isKnownStatus` still narrows and `StatusBadge`'s neutral branch is the arm
 * the type provides for rather than one the type calls unreachable.
 *
 * THREE FACTS THE GENERATED TYPE CANNOT CARRY, KEPT HERE BECAUSE THEY ARE WHY
 * THE SCREEN IS SHAPED AS IT IS:
 *
 * `display_name` NULL MEANS NO NAME HAS EVER BEEN RECORDED — reachable only for
 * Organizations created before the field existed. Render `organization_id`
 * verbatim: *"not a blank, not a dash, not 'Unnamed Organization'."*
 *
 * `template` is null when no Template was recorded, which today is every
 * Organization.
 *
 * `member_count` IS A COUNT, NEVER A LIST, AND THE DISTINCTION IS THE RULING.
 * *"A count does not invert, so it reconstructs nothing about any principal,
 * while a list over every Organization reconstructs every principal's
 * Organization list."* An operator can enumerate every Organization, so member
 * lists over all of them invert to exactly that — which
 * `core-object-registry.yaml` CO1 forbids by name. **THERE IS NO ROUTE ANYWHERE
 * THAT RETURNS MEMBER IDENTITIES.** Not one this console has not called — one
 * that does not exist. A roster is not unbuilt here; it is refused.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `ResolveMemberOutput` IS DELIBERATELY NOT SWAPPED, AND STAYS BELOW
 * ---------------------------------------------------------------------------
 *
 * It comes from this same contract and would have been the obvious thing to
 * take in the same change. **`membershipRole` carries NO `enumPolicy`** — this
 * schema declares exactly one, on `status` — so the generator emits a **bare
 * closed union `'owner' | 'member'`**, while `parseResolveMember` reads the
 * field with `requireString` and the screen renders an unrecognised role
 * neutrally.
 *
 * **Adopting it would make that tolerant branch dead code by the type system's
 * reckoning while the runtime can still produce the case** — `0041`'s exact
 * collision, on a field the sweep has not reached. Reported, not worked around.
 *
 * ---------------------------------------------------------------------------
 * ⚠ AND THE SWAP WAS ATTEMPTED AND REVERTED. THE BLOCKER IS NOT `status`.
 * ---------------------------------------------------------------------------
 *
 * `status` is fine — `extensible`, with the arm. **`RegistrationRecord` is
 * not.** This client's version has a FOURTH ARM the contract's has not:
 *
 *     | { readonly state: 'unrecognised'; readonly raw: string }
 *
 * It is not decoration. `parseRegistrationRecord` RETURNS it for any state this
 * build has never heard of, `OrganizationIdentity.tsx` narrows on it, and it
 * renders as a visible panel quoting `record.raw` — *"Core reported the state X,
 * which is newer than this build."*
 *
 * **Adopting the generated type deletes `raw` from the type, which turns that
 * renderer into a compile error, whose only "fix" is deleting a UI state the
 * runtime still reaches.** `0037`'s trap exactly, one construct along.
 *
 * **AND `0041` DOES NOT COVER IT.** That decision governs `enum` — a set of
 * scalar values. This is a `oneOf` DISCRIMINATED UNION OF OBJECT SHAPES, which
 * asks the identical open-or-closed question and has no way to answer it. The
 * client is tolerant; the contract is silent; nothing declares which is right.
 * **Raised rather than resolved here.**
 */
export interface OrganizationDetail {
  readonly organization_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly display_name: string | null;
  readonly commercial_registration: RegistrationRecord;
  readonly vat_registration: RegistrationRecord;
  readonly template: EmbeddedTemplate | null;
  readonly member_count: number;
}

/**
 * Consumed from the contract (`0037`, `0041`). `membershipRole` is declared
 * `extensible`, so `role` is `'owner' | 'member' | (string & {})` and the
 * neutral rendering in `LookupResult` is the arm the type provides for.
 *
 * **The role is a fact about the RELATIONSHIP, not about the person** — it is
 * returned because an operator about to reset a credential should know whether
 * they are taking over an `owner` or a `member`.
 *
 * **`parseResolveMember` is untouched**, and its `requireString` is now
 * CORRECT rather than merely tolerant: `0041` forbids an `extensible` enum's
 * parser from rejecting an unlisted value.
 */
export type { ResolveMemberOutput } from '@dudo/contracts/core/platform/organization-detail-v1';
import type { ResolveMemberOutput } from '@dudo/contracts/core/platform/organization-detail-v1';

export function isKnownMembershipRole(role: string): role is KnownMembershipRole {
  return role === 'owner' || role === 'member';
}

export function parseOrganizationDetail(payload: unknown): OrganizationDetail {
  const what = 'The Organization detail response';
  const body = requireObject(payload, what);

  /*
   * `template` IS `oneOf: [null, object]` — REQUIRED AND NULLABLE, not optional.
   * An absent key is a contract violation and is refused rather than read as
   * null, because "the Template was not recorded" and "this response is not the
   * shape it claims" are different facts and only one of them is safe to render.
   */
  if (!('template' in body)) {
    throw new ShapeError(`${what} is missing the required field "template".`);
  }
  const rawTemplate = body.template;
  let template: EmbeddedTemplate | null = null;
  if (rawTemplate !== null) {
    const nested = requireObject(rawTemplate, `${what} field "template"`);
    const labels = requireObject(nested.level_labels, `${what} field "template.level_labels"`);
    const level_labels = {} as Record<TemplateLevel, string>;
    for (const level of TEMPLATE_LEVELS) {
      // Fully populated by Core, defaults filled in. Never defaulted here — that
      // is what stops two consoles inventing two ideas of an unlabelled level.
      level_labels[level] = requireString(labels, level, `${what} field "template.level_labels"`);
    }
    template = {
      template_id: requireString(nested, 'template_id', `${what} field "template"`),
      name: requireString(nested, 'name', `${what} field "template"`),
      level_labels: Object.freeze(level_labels),
    };
  }

  const memberCount = body.member_count;
  if (typeof memberCount !== 'number' || !Number.isInteger(memberCount) || memberCount < 0) {
    throw new ShapeError(`${what} field "member_count" was not a non-negative integer.`);
  }

  /*
   * THE IDENTITY BLOCK IS PARSED BY THE SAME FUNCTION THE UPDATE RESPONSE USES,
   * so the detail page and the post-save state cannot disagree about a shape.
   * `organization-identity-v1` is what makes these three fields carry values;
   * `organization-detail-v1` embeds the block rather than defining a second one.
   */
  const identity = parseOrganizationIdentity(body, what);

  return {
    organization_id: requireString(body, 'organization_id', what),
    status: requireString(body, 'status', what),
    created_at: requireString(body, 'created_at', what),
    display_name: identity.display_name,
    commercial_registration: identity.commercial_registration,
    vat_registration: identity.vat_registration,
    template,
    member_count: memberCount,
  };
}

export function parseResolveMember(payload: unknown): ResolveMemberOutput {
  const what = 'The member resolve response';
  const body = requireObject(payload, what);
  /*
   * THE SUBMITTED IDENTIFIER IS NOT IN THIS RESPONSE AND IS NOT LOOKED FOR. The
   * caller sent it and knows it; the contract omits it deliberately so that an
   * email address is not placed in a response body, nor in the log line of
   * anyone who logs responses.
   */
  return {
    principal_id: requireString(body, 'principal_id', what),
    role: requireString(body, 'role', what),
  };
}

/* -------------------------------------------------------------------------
   Onboarding — `organization-onboarding-v1`, accepted
   ------------------------------------------------------------------------- */

/**
 * The two things that can fail AFTER the Organization irrevocably exists.
 *
 * A CLOSED SET OF STABLE TOKENS, NEVER FREE TEXT, and the schema says why: "a
 * closed set means a console can render each one specifically and qa-agent can
 * assert them; free text would be a message nobody could branch on and everybody
 * would log."
 */
export const ONBOARDING_WARNINGS = [
  'first_workspace_not_created',
  'tenant_audit_record_not_written',
] as const;
export type OnboardingWarning = (typeof ONBOARDING_WARNINGS)[number];

export interface OnboardOrganizationOutput {
  readonly organization_id: string;
  readonly admin_principal_id: string;
  /** NULL when `warnings` contains `first_workspace_not_created`. */
  readonly workspace_id: string | null;
  /**
   * EMPTY ON A COMPLETE SUCCESS. A 201 WITH WARNINGS IS A SUCCESS, NOT A
   * FAILURE: the Organization, the admin and the credential all exist and
   * something after them did not. The response is still 201 because the
   * credential is irreplaceable and must reach the operator.
   *
   * The schema is explicit that rendering this as an ordinary success is the
   * defect the field exists to prevent — so it is surfaced prominently, and it
   * is NOT rendered as an error either.
   */
  readonly warnings: readonly string[];
}

export interface OnboardOrganizationInput {
  /** The normalised identifier. Also the salt the derived value was made with. */
  readonly admin_identifier: string;
  readonly template_id: string;
  /** Exactly 43 base64url characters. The password itself is never sent. */
  readonly derived_value: string;
  /**
   * ACCEPTED BY CORE SINCE 2026-09-07. It is sent when the operator typed one.
   * ===========================================================================
   *
   * *** IT WAS BRIEFLY UNSENDABLE, AND THE REASON IS WORTH KEEPING. *** The
   * contract published this field while `platform.organizations.create`
   * declared only four — `admin_identifier`, `template_id`,
   * `first_workspace_name`, `derived_value`. **The platform class refuses
   * undeclared fields BEFORE AUTHENTICATION**, so a client that trusted the
   * contract would have failed the first request carrying it and every one
   * after it, on the route that creates customers.
   *
   * SO READING THE CONTRACT WAS NOT EVIDENCE THAT CORE ACCEPTED THE FIELD.
   * Core landed it the same day — declared, parsed optionally with the same
   * check the update route uses, persisted as NULL when absent, nothing
   * synthesised — and the divergence is closed.
   *
   * IT IS THE MIRROR OF THE RULING BELOW, AND THE RULING ONLY COVERED ONE
   * DIRECTION. `0031` makes the field optional so that a server requiring what
   * a client does not send cannot cause an outage. The opposite — a client
   * sending what a server does not accept — was open, and it was open *because
   * the contract said the field was there*.
   *
   * ---------------------------------------------------------------------------
   *
   * OPTIONAL IN THIS VERSION, AND IT SHOULD NOT BE — Team Lead ruling,
   * 2026-09-07, on sequencing rather than design.
   *
   * "A SERVER REQUIRING A FIELD THE DEPLOYED CONSOLE DOES NOT YET SEND IS AN
   * ONBOARDING OUTAGE. A client sending a field the server ignores is harmless;
   * the reverse is not." So the console ships first and Core tightens
   * afterwards.
   *
   * OMITTED MEANS NO NAME IS RECORDED — null, not a placeholder. Core must not
   * synthesise one from the identifier, the Template or the Workspace name, and
   * neither may this console: an invented name is indistinguishable from one an
   * operator typed, forever.
   *
   * NOT TO BE CONFUSED WITH `first_workspace_name`, which this client also
   * sends as a fixed placeholder for an unrelated reason. Different field,
   * different object, and this change does not fix that one.
   */
  readonly display_name?: string;
}

export function isKnownOnboardingWarning(value: string): value is OnboardingWarning {
  return (ONBOARDING_WARNINGS as readonly string[]).includes(value);
}

/**
 * ===========================================================================
 * THE FIXED PLACEHOLDER SENT AS `first_workspace_name`
 * ===========================================================================
 *
 * `first_workspace_name` IS REQUIRED BY THE CONTRACT, VALIDATED BY CORE, AND
 * DISCARDED. `platform/core/migrations/0002_business.sql` gives the `business`
 * table exactly two columns — `tenant_id` and `business_id` — and says in terms
 * that there is "deliberately NO Business name... They belong to the
 * organization-structure slice, with its own contract."
 * `onboarding-service.ts` states the consequence plainly: **"SO
 * `first_workspace_name` IS ACCEPTED, VALIDATED AND DISCARDED."**
 *
 * SO THE CONSOLE DOES NOT ASK FOR IT. Team Lead ruling, and it is the right
 * one: an operator who types "Main Campus" and watches it vanish has been lied
 * to by the form. Nothing is preserved for later — the value never reaches
 * storage — so prompting buys nothing and costs the operator's trust in every
 * other field on the page. Accepting and discarding is worse than not accepting.
 *
 * THE VALUE MUST STILL SATISFY `workspaceName`: 1-120 characters, no leading or
 * trailing whitespace. This one is deliberately self-describing rather than
 * something like "Main" — if it ever DOES reach storage, because the
 * organization-structure slice adds the column while this constant is still
 * here, it should read as an obvious placeholder rather than as a name someone
 * chose. That is the failure mode worth designing for: the field starting to
 * matter without anyone revisiting this line.
 */
export const DISCARDED_WORKSPACE_NAME_PLACEHOLDER = 'Unnamed (naming arrives with organization structure)';

export function parseOnboardOrganization(payload: unknown): OnboardOrganizationOutput {
  const what = 'The onboarding response';
  const body = requireObject(payload, what);
  const warnings = body.warnings;
  if (!Array.isArray(warnings) || warnings.some((item) => typeof item !== 'string')) {
    throw new ShapeError(`${what} field "warnings" was not an array of strings.`);
  }
  /*
   * NO CREDENTIAL FIELD IS READ, BECAUSE NONE EXISTS. `initial_password` was
   * removed from this response on 2026-09-05 and no tombstone was left. If a
   * future response ever carried one, this parser would ignore it — and that is
   * the correct behaviour: the console already holds the only copy, and reading
   * a password back off the wire would reintroduce exactly the design 0015 §D
   * and 0026 exist to prevent.
   */
  return {
    organization_id: requireString(body, 'organization_id', what),
    admin_principal_id: requireString(body, 'admin_principal_id', what),
    workspace_id: requireNullableString(body, 'workspace_id', what),
    warnings: Object.freeze([...(warnings as string[])]),
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
  init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
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

/* -------------------------------------------------------------------------
   Time range — strict RFC 3339 UTC, built here rather than taken from an input
   -------------------------------------------------------------------------
   A `<input type="date">` yields `YYYY-MM-DD`: no time, no zone. Sending that
   verbatim would be a ZONELESS timestamp, which is refused deliberately —
   some engines read one as local and some as UTC, so a filter that silently
   meant different ranges on different machines is worse than one that fails.

   THE FORMAT IS NOW SPECIFIED, AND IT IS NARROWER THAN "RFC 3339". These were
   an assumption; `platform-audit-read-v1` has since fixed both halves:

     FORMAT     RFC 3339 UTC with EXACTLY THREE fractional digits.
     INTERVAL   HALF-OPEN — `[since, until)`. `since` is inclusive, `until` is
                exclusive.

   ===========================================================================
   WHY EXACTLY THREE DIGITS IS A CORRECTNESS RULE AND NOT A STYLE ONE
   ===========================================================================

   Comparison against stored timestamps is LEXICOGRAPHIC OVER STRINGS, and that
   equals temporal comparison ONLY WHEN BOTH OPERANDS ARE THE SAME WIDTH.

   At index 19 a stored value has `.` (0x2E) and a bound written without a
   fractional part has `Z` (0x5A). `.` sorts first. So EVERY stored value inside
   a given second sorts BEFORE a bound naming that second with no milliseconds,
   and both bounds shift forward in time by up to a second. Neither errors:

     `until=…T23:59:59Z`   effective bound becomes the start of second 60 —
                           OVER-includes, returning the whole of second 59 from
                           a bound that is meant to be exclusive.
     `since=…T00:00:00Z`   effective bound becomes the start of second 01 —
                           UNDER-includes, DROPPING EVERY RECORD IN SECOND 00
                           from a bound that is meant to be inclusive.

   THE SECOND OF THOSE WAS SHIPPING. `toUtcDayStart` emitted `T00:00:00Z` and
   was silently losing the first second of every day it was asked for.

   ===========================================================================
   A UTC DAY IS NOT THE OPERATOR'S DAY, AND THAT IS KNOWN RATHER THAN OVERLOOKED
   ===========================================================================

   An operator investigating "yesterday" from a local calendar picker gets a
   window offset by their zone — up to a day's worth of records at each edge
   belonging to a different local day than the one they had in mind.

   THIS IS ACCEPTED FOR NOW, NOT UNCONSIDERED. An audit trail is read by more
   than one person, often at once, and two operators discussing "the 5th" must
   mean the same window or they are comparing different evidence; a local day
   makes one filter mean different things to different people. The screens
   label the fields UTC and render record timestamps in UTC, so the offset is
   VISIBLE rather than silent, which is the property that makes it survivable.
   Changing it to the operator's local day is a product decision, not an
   inference to make here.
   ------------------------------------------------------------------------- */

/** `YYYY-MM-DD` from a date input, or `''`. */
function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * UTC midnight on the typed date, optionally shifted by whole days.
 *
 * `toISOString()` IS THE FORMATTER ON PURPOSE: it emits exactly three
 * fractional digits, which is precisely the width the contract requires and the
 * width stored values carry. Building the string by concatenation is what
 * produced the shipping defect — a literal is one edit away from losing its
 * `.000`, and nothing would fail.
 *
 * `Date.UTC` also normalises day overflow, so the day after 2026-12-31 is
 * 2027-01-01 without month or year arithmetic here. Everything is UTC, so no
 * daylight-saving transition can move a boundary.
 *
 * A WELL-FORMED BUT NON-EXISTENT DATE IS REFUSED rather than normalised.
 * `2026-02-31` passes the shape test and `Date.UTC` would silently slide it into
 * March; the round-trip check below catches that instead of querying a range the
 * operator did not ask for.
 */
function utcMidnight(calendarDate: string, dayOffset: number): string | null {
  if (!isCalendarDate(calendarDate)) return null;
  const year = Number(calendarDate.slice(0, 4));
  const month = Number(calendarDate.slice(5, 7));
  const day = Number(calendarDate.slice(8, 10));

  const base = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(base.getTime()) || base.toISOString().slice(0, 10) !== calendarDate) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day + dayOffset)).toISOString();
}

/**
 * The INCLUSIVE start of the UTC day. `…T00:00:00.000Z`.
 *
 * The `.000` is load-bearing, not decoration — see the header. Without it the
 * bound sorts after every record in second 00 and those records are dropped.
 */
export function toUtcDayStart(calendarDate: string): string | null {
  return utcMidnight(calendarDate, 0);
}

/**
 * The EXCLUSIVE end of the UTC day: **the NEXT day at `…T00:00:00.000Z`.**
 *
 * ===========================================================================
 * IT IS THE NEXT DAY'S MIDNIGHT BECAUSE THE INTERVAL IS HALF-OPEN
 * ===========================================================================
 *
 * `platform-audit-read-v1` now specifies `[since, until)` — `since` inclusive,
 * `until` exclusive. The upper bound is therefore the first instant NOT wanted,
 * which for a whole UTC day is the following midnight. Every record in the
 * chosen day is strictly below it, including one stamped at `…T23:59:59.999Z`.
 *
 * THE NAME SAYS `EXCLUSIVE` FOR THAT REASON. It was `toUtcDayEnd`, which reads
 * as a moment inside the day and invites exactly the value that was wrong.
 *
 * ---------------------------------------------------------------------------
 * THIS VALUE HAS BEEN WRONG THREE TIMES. THE SEQUENCE IS THE USEFUL PART.
 * ---------------------------------------------------------------------------
 *
 *   1. `T23:59:59Z`      justified with "second precision is what the log
 *                        records anyway" — a claim about Core nobody had read.
 *   2. `T23:59:59.999Z`  right value, SAME false premise, cited harder: "the
 *                        contract says so three separate times". Fixing the
 *                        value while strengthening a false justification is
 *                        worse than leaving both wrong, because the citation is
 *                        what stops the next reader checking
 *                        (`architecture.md` §3c).
 *   3. and it was still wrong, for a reason neither reading had reached: the
 *                        interval is HALF-OPEN, so an inclusive-looking end
 *                        drops the final millisecond.
 *
 * WHAT THE CONTRACT'S "second precision" SENTENCES ACTUALLY SAY is that
 * timestamps COLLIDE at second precision in a burst — why the sort key needs
 * `record_id` as a tiebreaker, not what is stored.
 * `platform/core/kernel/clock.ts:26` states MILLISECOND precision and `:33` is
 * `toISOString()`. Cited so the next reader can diff it rather than trust it.
 *
 * ---------------------------------------------------------------------------
 * AND THE WIDTH RULE THIS FORM SATISFIES FOR FREE
 * ---------------------------------------------------------------------------
 *
 * `.999Z` was immune to the lexicographic width defect described in the header
 * — by accident, because it happened to be the same width as a stored value.
 * `…T00:00:00.000Z` is immune for the same reason and by construction, because
 * `toISOString()` cannot emit any other width.
 */
export function toUtcExclusiveDayEnd(calendarDate: string): string | null {
  return utcMidnight(calendarDate, 1);
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
  onboardOrganization(input: OnboardOrganizationInput): Promise<OnboardOrganizationOutput>;
  readOrganization(organizationId: string): Promise<OrganizationDetail>;
  /**
   * Set a name, a commercial registration, a VAT registration, or any subset.
   *
   * PARTIAL, AND IT RETURNS THE WHOLE IDENTITY BLOCK — "a console applying a
   * partial response to local state has to guess what the server did with the
   * fields it omitted; a whole block cannot be guessed wrong."
   *
   * NOT CONFIRMATION-GATED. The route is `sensitive`, not `critical`, and this
   * console must not invent a gate the ladder did not put there: making a VAT
   * field critical generalises to every field and the rung stops sorting
   * anything. Verification acts at the point of harm instead.
   */
  updateOrganizationIdentity(
    organizationId: string,
    input: UpdateOrganizationIdentityInput,
  ): Promise<OrganizationIdentity>;
  resolveMember(organizationId: string, identifier: string): Promise<ResolveMemberOutput>;
  /** The oversight view. No principal-level target, and no filter for one. */
  listPlatformAudit(options?: {
    pageSize?: number;
    cursor?: string | null;
    filters?: PlatformFeedFilters;
  }): Promise<PlatformFeedOutput>;
  /** The accountability view for one named Organization. WRITES TENANT-SIDE. */
  listOrganizationAudit(
    organizationId: string,
    options?: {
      pageSize?: number;
      cursor?: string | null;
      filters?: OrganizationFeedFilters;
    },
  ): Promise<OrganizationFeedOutput>;
  listOperators(options?: {
    pageSize?: number;
    cursor?: string | null;
  }): Promise<ListOperatorsOutput>;
  /**
   * Obtain a confirmation challenge. **Never speculatively** — a challenge costs
   * control-plane row-writes and runs the full authorization of the target
   * operation, so it is requested when a human has decided to act.
   */
  requestConfirmation(input: {
    actionId: string;
    parameters: ConfirmationParameters;
  }): Promise<ConfirmationChallenge>;
  revokeOperator(input: ConfirmedSubmission): Promise<RevokeOperatorOutput>;
  resetCredential(input: ConfirmedSubmission): Promise<ResetCredentialOutput>;
}

/** What a confirmed submission carries, built by `buildConfirmedRequest`. */
export interface ConfirmedSubmission {
  /** The path with values substituted and encoded. */
  readonly path: string;
  /** The body WITHOUT the three confirmation fields. */
  readonly bodyWithoutConfirmation: Readonly<Record<string, string>>;
  readonly confirmationId: string;
  readonly reauthIdentifier: string;
  readonly reauthDerivedValue: string;
}

/**
 * ===========================================================================
 * THE FIRST GENERATED TYPE THIS CONSOLE CONSUMES (ADR 0037, ADR 0040)
 * ===========================================================================
 *
 * It was declared here by hand until 2026-09-09, restating a shape the
 * contract already publishes. **`0037` requirement 2: generated types are
 * consumed, never re-declared** — a hand-written type restating a generated one
 * is the defect that ADR exists to remove, arriving one layer up.
 *
 * **The import path mirrors the contract path**, so a reader holding this line
 * knows which file to open without resolving anything:
 *
 *     packages/contracts/core/platform/platform-operators-v1.contract.yaml
 *     @dudo/contracts/core/platform/platform-operators-v1
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHAPE WENT FIRST — AND THE REST HAVE SINCE FOLLOWED
 * ---------------------------------------------------------------------------
 *
 * **It was the only shape on this surface with no enum in it.** `0041` requires
 * every enum to declare whether it is `closed` or `extensible`, and an
 * `extensible` one must emit an explicit unknown arm. **Before that sweep, the
 * generated `status` and `platform_role` types were bare closed unions**, and
 * adopting one would have made this console's tolerant branches dead code by
 * the type system's reckoning **while the runtime could still produce the
 * case** — raising the compile-time claim without raising the check.
 *
 * ⚠ **THIS PARAGRAPH LISTED FIVE SHAPES AS "STILL HAND-WRITTEN, ON PURPOSE AND
 * TEMPORARILY". ALL FIVE ARE NOW SWAPPED, AND SO IS `RegistrationRecord`.**
 * Corrected 2026-09-09. A comment describing a temporary state is one nothing
 * goes red about when the state ends — `workflow.md` §12, written by the author
 * of the temporary state, one swap later. **The word "temporarily" is what made
 * it an obligation nobody was assigned to collect.**
 *
 * The order it actually went in, and the reason is the same each time — the arm
 * had to exist before the type could be adopted: this shape (no enum), then
 * `Template` and the operator roster (scalar enums declared `extensible`), then
 * `ResolveMemberOutput` (`membershipRole`), then **`RegistrationRecord` last**,
 * because it is a `oneOf` variant union and needed `0041` amendment 2 before it
 * had an unknown arm at all.
 *
 * ---------------------------------------------------------------------------
 * ⚠ AND `parseRevokeOperator` BELOW IS UNTOUCHED. IT IS NOT DUPLICATION.
 * ---------------------------------------------------------------------------
 *
 * **The generated type says what the contract PROMISES. The parser checks what
 * ARRIVED.** Deleting the second because the first exists keeps the
 * compile-time claim and drops the runtime check — the wrong half to keep, in a
 * diff that only deletes (`0037`).
 *
 * **Generation makes the parser MORE necessary, not less.** Before, this
 * client's shape and the server's response were two independent statements and
 * a mismatch had two chances to look odd. Now the type is derived from the same
 * contract the server was built against, so **a wrong contract produces a
 * client and a server that agree with each other and with nothing real.**
 */
export type { RevokeOperatorOutput } from '@dudo/contracts/core/platform/platform-operators-v1';
import type { RevokeOperatorOutput } from '@dudo/contracts/core/platform/platform-operators-v1';

export interface ResetCredentialOutput {
  readonly principal_id: string;
  readonly sessions_revoked: number;
  readonly warnings: readonly string[];
}

export function parseRevokeOperator(payload: unknown): RevokeOperatorOutput {
  const what = 'The revoke response';
  const body = requireObject(payload, what);
  const wasSelf = body.was_self;
  const remaining = body.remaining_operator_count;
  if (typeof wasSelf !== 'boolean') {
    throw new ShapeError(`${what} field "was_self" was not a boolean.`);
  }
  if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 0) {
    throw new ShapeError(`${what} field "remaining_operator_count" was not a non-negative integer.`);
  }
  return {
    principal_id: requireString(body, 'principal_id', what),
    was_self: wasSelf,
    remaining_operator_count: remaining,
  };
}

export function parseResetCredential(payload: unknown): ResetCredentialOutput {
  const what = 'The credential reset response';
  const body = requireObject(payload, what);
  const revoked = body.sessions_revoked;
  const warnings = body.warnings;
  if (typeof revoked !== 'number' || !Number.isInteger(revoked) || revoked < 0) {
    throw new ShapeError(`${what} field "sessions_revoked" was not a non-negative integer.`);
  }
  if (!Array.isArray(warnings) || warnings.some((item) => typeof item !== 'string')) {
    throw new ShapeError(`${what} field "warnings" was not an array of strings.`);
  }
  /*
   * NO CREDENTIAL IS READ BACK. `resetCredentialOutput` carries
   * `principal_id`, `sessions_revoked` and `warnings` and nothing else — the
   * console already holds the only copy of the new password, exactly as at
   * onboarding.
   */
  return {
    principal_id: requireString(body, 'principal_id', what),
    sessions_revoked: revoked,
    warnings: Object.freeze([...(warnings as string[])]),
  };
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

    async listPlatformAudit({ pageSize, cursor, filters } = {}) {
      /*
       * THE FILTER SET IS CLOSED AND `target_principal_id` IS NOT IN IT. There
       * is no parameter on `PlatformFeedFilters` through which one could be
       * expressed, so this client cannot send one even by mistake — the
       * contract requires Core to REFUSE one rather than ignore it, and a
       * client that sent one would be asking to be refused.
       */
      const params = new URLSearchParams(pageQuery(pageSize, cursor).replace(/^\?/, ''));
      if (filters?.actor_principal_id) params.set('actor_principal_id', filters.actor_principal_id);
      if (filters?.action_id) params.set('action_id', filters.action_id);
      if (filters?.since) params.set('since', filters.since);
      if (filters?.until) params.set('until', filters.until);
      const query = params.toString();
      try {
        return parsePlatformFeed(
          await platformRequest(
            query === '' ? AUDIT_PATH : `${AUDIT_PATH}?${query}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async listOrganizationAudit(organizationId, { pageSize, cursor, filters } = {}) {
      /*
       * ===================================================================
       * READING THIS TRAIL WRITES TO IT — FIVE TENANT ROW-WRITES PER PAGE,
       * AGAINST THAT CUSTOMER'S OWN DAILY ALLOCATION.
       * ===================================================================
       *
       * So there is no polling, no refetch on focus or reconnect, no prefetch
       * of the next page, and no automatic retry anywhere on this path. A page
       * is fetched because a person pressed something.
       *
       * This is not a performance preference. A platform sub-ceiling bounds
       * these writes per Organization per day, and a component that refetched
       * on window focus would spend a customer's support budget while an
       * operator sat reading.
       *
       * NOTE THERE IS NO `actor_principal_id` FILTER HERE. The two feeds accept
       * different sets and `OrganizationFeedFilters` omits it, so this cannot
       * send one.
       */
      const params = new URLSearchParams(pageQuery(pageSize, cursor).replace(/^\?/, ''));
      if (filters?.action_id) params.set('action_id', filters.action_id);
      if (filters?.since) params.set('since', filters.since);
      if (filters?.until) params.set('until', filters.until);
      const query = params.toString();
      const base = `${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}/audit`;
      try {
        return parseOrganizationFeed(
          await platformRequest(
            query === '' ? base : `${base}?${query}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async requestConfirmation({ actionId, parameters }) {
      /*
       * NO `locale` FIELD IS SENT, EVER. Absent means `en`, and this console
       * must not ask for a language whose statements nobody has reviewed — a
       * human is being asked to APPROVE this sentence. See
       * `EXPECTED_STATEMENT_LOCALE`.
       *
       * NOT SPECULATIVE. This runs the full authorization of the target
       * operation and costs control-plane row-writes, so it is called from an
       * explicit press and never on hover, focus, mount or render.
       */
      try {
        return parseConfirmationChallenge(
          await platformRequest(
            PLATFORM_CONFIRMATIONS_PATH,
            { method: 'POST', body: { action_id: actionId, parameters } },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asConfirmationError(thrown);
      }
    },

    async revokeOperator(input) {
      try {
        return parseRevokeOperator(
          await platformRequest(
            input.path,
            { method: 'POST', body: withConfirmation(input.bodyWithoutConfirmation, input) },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async resetCredential(input) {
      try {
        return parseResetCredential(
          await platformRequest(
            input.path,
            { method: 'POST', body: withConfirmation(input.bodyWithoutConfirmation, input) },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async listOperators({ pageSize, cursor } = {}) {
      // `page_size` and `cursor` only. No filters are declared and none is sent.
      try {
        return parseListOperators(
          await platformRequest(
            `${OPERATORS_PATH}${pageQuery(pageSize, cursor)}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async readOrganization(organizationId) {
      /*
       * ONE REQUEST RENDERS THE WHOLE PAGE. The Template is embedded, so there
       * is no second call to resolve it — `theOnePageOneRequestRule`: "A read
       * costs writes in this class... a page that fires three requests spends
       * three times the budget of one that fires a single request."
       *
       * AND IT IS NEVER POLLED. At 2 row-writes a call, a thirty-second refresh
       * loop exhausts one operator's daily ceiling in about two and a half hours
       * and then answers 503 — "a self-inflicted outage produced by a refresh
       * loop nobody would think of as traffic."
       */
      try {
        return parseOrganizationDetail(
          await platformRequest(
            `${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}`,
            { method: 'GET' },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async updateOrganizationIdentity(organizationId, input) {
      /*
       * =====================================================================
       * EXACTLY THE FIELDS THE OPERATOR CHANGED, AND NEVER AN EMPTY BODY
       * =====================================================================
       *
       * The input object is `minProperties: 1` and an empty body is
       * `invalid_argument` — because "a no-op here still writes a platform
       * audit record and FIVE ROW-WRITES INTO THE CUSTOMER'S OWN DAILY
       * ALLOCATION, and a request that spends a customer's budget to change
       * nothing is a request that should not have been accepted."
       *
       * So this refuses to send one rather than earning that refusal. THE
       * CONDITION IS ABOUT THE SHAPE OF THE REQUEST — how many properties the
       * caller supplied — and not about any fact stored anywhere, so deciding
       * it here discloses nothing. Same line as the window pre-check.
       *
       * AN OMITTED FIELD IS UNCHANGED AND A PRESENT ONE IS REPLACED WHOLE.
       * There is no merge inside a registration, so a caller that wants to keep
       * a verification must omit the whole registration rather than re-send it
       * — re-sending re-stamps it with today's operator and today's date.
       */
      const body: Record<string, unknown> = {};
      if (input.display_name !== undefined) body.display_name = input.display_name;
      if (input.commercial_registration !== undefined) {
        body.commercial_registration = input.commercial_registration;
      }
      if (input.vat_registration !== undefined) body.vat_registration = input.vat_registration;

      if (Object.keys(body).length === 0) {
        throw new ApiError({
          code: 'invalid_argument',
          message:
            'Nothing was changed, so nothing was sent. Editing a field and saving it unchanged ' +
            'would still spend five of this business’s daily writes.',
        });
      }

      try {
        return parseOrganizationIdentity(
          await platformRequest(
            `${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}/identity`,
            { method: 'PATCH', body },
            options.fetchImpl,
          ),
          'The identity update response',
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async resolveMember(organizationId, identifier) {
      /*
       * =====================================================================
       * EXACTLY ONE FIELD, AND IT IS `target_identifier` SINCE 2026-09-07.
       * =====================================================================
       *
       * *** THE FIELD IS `target_identifier`. IT IS NOT `identifier`, AND BOTH
       * MUST NEVER BE SENT TOGETHER. *** Core refuses both-present with
       * `must_not_send_both_names`, deliberately: if the two values differ,
       * choosing between them silently is choosing WHICH PRINCIPAL TO RESOLVE.
       *
       * WHY THE NAME MOVED, because the reason is a rule and not a rename.
       * `architecture.md` §1a: a field name defined by a cross-cutting mechanism
       * is reserved platform-wide with exactly one meaning. `confirmation-v1`
       * injects `reauth_identifier` — the CALLER'S own — into request shapes it
       * does not own, and a bare `identifier` beside it is one word two
       * contracts can each use correctly while meaning different people. Here it
       * is the TARGET'S, so it says whose.
       *
       * THIS CLIENT SENT `identifier` UNTIL TODAY AND THAT WAS CORRECT, WHICH IS
       * THE UNCOMFORTABLE PART. The contract published `target_identifier` while
       * Core's route declared `identifier`; the resolve worked because this file
       * was written against the running code rather than the document. **A
       * contract that has stopped describing the code has stopped being the
       * source of truth**, and noticing that is the last line of defence rather
       * than a control.
       *
       * THE SWITCH IS PHASE 2 OF THREE AND THE ORDER IS NOT NEGOTIABLE: Core
       * accepts both names (done), this client moves (here), then Core and the
       * contract drop the old name in one change (`0034`, `OD-5`, not ours).
       * Moving before Core accepted both would have been an outage; Core
       * dropping `identifier` before this landed would have been the other one.
       *
       * NO CONFIRMATION TOKEN, AND THAT IS DELIBERATE. `resolveMemberInput` is
       * `additionalProperties: false`, so any extra field is a validation
       * failure rather than a courtesy — including a confirmation token.
       *
       * AND GATING IT WOULD DEADLOCK THE RESET. A confirmation for a credential
       * reset must name the principal being reset, and THIS ROUTE IS WHAT
       * PRODUCES THAT principal_id. Requiring a confirmation to obtain the value
       * the confirmation needs is a cycle with no entry point.
       *
       * THE ORGANIZATION IS A PATH PARAMETER, NOT A BODY FIELD, and encoding it
       * here means a caller-supplied value cannot add a path segment.
       *
       * EVERY CALL WRITES A TENANT-SIDE AUDIT RECORD INTO THE NAMED
       * ORGANIZATION — INCLUDING EVERY REFUSAL — because "the probe is the thing
       * being recorded, not the answer".
       *
       * THE RECORD IS WRITTEN AND IS NOT YET READABLE BY THE CUSTOMER, and that
       * distinction is worth keeping straight. `0028`'s amendment of 2026-09-05
       * strikes "tenant-visible" from its own residual: `core.audit.read` is
       * catalogued at organization scope and has no route, so "this surface is
       * auditable rather than audited: the evidence is captured, and the party it
       * protects cannot read it." An unread audit record is detection nobody
       * performs.
       *
       * SO THE DISCIPLINE HERE MATTERS MORE, NOT LESS. The evidence is permanent
       * and becomes readable when the tenant-side route lands, which means every
       * speculative call this console makes today is a line in a customer's log
       * they will eventually be able to read. It is called on an explicit
       * operator submit and at no other time: no resolve-as-you-type, no
       * prefetch, no retry-on-blur, no automatic retry of any kind.
       */
      /*
       * ONE FIELD, BUILT UNCONDITIONALLY, AND THE UNCONDITIONALITY IS THE
       * GUARD.
       *
       * There is no branch here that could put `identifier` back, and no
       * spread that could add it — so "never send both" is a property of the
       * literal rather than a rule someone remembers. Core's own implementation
       * carries the matching hazard on the reading side: `target_identifier ??
       * identifier` treats an EXPLICIT NULL as absent, so a body with
       * `target_identifier: null` slips past a both-present check and quietly
       * resolves the legacy value. **A conditionally-built body is where that
       * bug would arrive on this side**, which is why this one is not built
       * conditionally.
       */
      try {
        return parseResolveMember(
          await platformRequest(
            `${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}/members/resolve`,
            { method: 'POST', body: { target_identifier: identifier } },
            options.fetchImpl,
          ),
        );
      } catch (thrown) {
        throw asApiError(thrown);
      }
    },

    async onboardOrganization(input) {
      /*
       * EXACTLY THE FOUR DECLARED FIELDS AND NOTHING ELSE.
       *
       * `platform-routes.ts` declares `fields: ['admin_identifier',
       * 'template_id', 'first_workspace_name', 'derived_value']` and the class
       * REFUSES ANY UNDECLARED FIELD BEFORE AUTHENTICATION. So there is no
       * `role`, no `permissions`, no `memberships`, no `password`, no
       * `organization_id` and no `principal_id` here — not even set to null or
       * empty, because "absent" and "present and empty" are different requests
       * and only one of them is accepted.
       *
       * THAT ABSENCE IS A SECURITY BOUND, NOT TIDINESS. `0025` decision 4 bound
       * 3: there is no field through which an existing Organization could be
       * named, so the membership-write step cannot be reached with an identifier
       * from anywhere but this operation's own generator. A `role` field would
       * widen a bounded bootstrap exception to `0007` D11 into a general grant
       * mechanism — which `0025` names as the bound most likely to erode.
       */
      const body: Record<string, unknown> = {
        admin_identifier: input.admin_identifier,
        template_id: input.template_id,
        // Required, validated, discarded. See the constant.
        first_workspace_name: DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
        derived_value: input.derived_value,
      };
      /*
       * `display_name` IS SENT ONLY WHEN THE OPERATOR TYPED ONE, and ABSENT
       * rather than empty otherwise. "Absent" and "present and empty" are
       * different requests and the class accepts only one of them — an empty
       * string would be `out_of_range` against `minLength: 1`, turning a blank
       * optional field into a validation error.
       *
       * OMITTED MEANS NULL, WHICH MEANS NO NAME WAS RECORDED. Nothing here
       * substitutes the identifier, the Template name or the Workspace
       * placeholder for a name the operator did not give.
       */
      if (input.display_name !== undefined && input.display_name !== '') {
        body.display_name = input.display_name;
      }
      try {
        return parseOnboardOrganization(
          await platformRequest(
            ORGANIZATIONS_PATH,
            { method: 'POST', body },
            options.fetchImpl,
          ),
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
