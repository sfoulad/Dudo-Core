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

export type PlatformRoleName = 'platform-admin' | 'marketplace-moderator';
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
  /** Strict RFC 3339 UTC with `Z`. See `toUtcDayStart`/`toUtcDayEnd`. */
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

export function isKnownPlatformRole(value: string): value is PlatformRoleName {
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

export interface OperatorSummary {
  readonly principal_id: string;
  readonly platform_role: string;
  /** When platform authority was GRANTED — not when the principal was created. */
  readonly created_at: string;
}

export interface ListOperatorsOutput {
  readonly data: readonly OperatorSummary[];
  readonly next_cursor: string | null;
}

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

/** `membershipRole`. A closed union; Core never emits an unrecognised value. */
export type MembershipRole = 'owner' | 'member';

export interface EmbeddedTemplate {
  readonly template_id: string;
  readonly name: string;
  readonly level_labels: Readonly<Record<TemplateLevel, string>>;
}

export interface OrganizationDetail {
  readonly organization_id: string;
  readonly status: string;
  readonly created_at: string;
  /** ALWAYS null today. Render `organization_id` verbatim — never a placeholder. */
  readonly display_name: string | null;
  /** Null when no Template was recorded, which today is every Organization. */
  readonly template: EmbeddedTemplate | null;
  /**
   * A COUNT, NEVER A LIST, AND THE DISTINCTION IS THE RULING.
   *
   * "a count does not invert, so it reconstructs nothing about any principal,
   * while a list over every Organization reconstructs every principal's
   * Organization list." An operator can enumerate every Organization, so member
   * lists over all of them invert to exactly that — which
   * `core-object-registry.yaml` CO1 forbids by name.
   *
   * THERE IS NO ROUTE ANYWHERE THAT RETURNS MEMBER IDENTITIES. Not one this
   * console has not called — one that does not exist. A roster is not unbuilt
   * here; it is refused.
   */
  readonly member_count: number;
}

export interface ResolveMemberOutput {
  readonly principal_id: string;
  /** `owner` or `member` — a fact about the relationship, not about the person. */
  readonly role: string;
}

export function isKnownMembershipRole(role: string): role is MembershipRole {
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

  return {
    organization_id: requireString(body, 'organization_id', what),
    status: requireString(body, 'status', what),
    created_at: requireString(body, 'created_at', what),
    display_name: requireNullableString(body, 'display_name', what),
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

/* -------------------------------------------------------------------------
   Time range — strict RFC 3339 UTC, built here rather than taken from an input
   -------------------------------------------------------------------------
   A `<input type="date">` yields `YYYY-MM-DD`: no time, no zone. Sending that
   verbatim would be a ZONELESS timestamp, which is refused deliberately —
   some engines read one as local and some as UTC, so a filter that silently
   meant different ranges on different machines is worse than one that fails.

   ASSUMPTION, STATED BECAUSE THE CONTRACT DOES NOT SPECIFY IT: `since` and
   `until` are named as query parameters and NO FORMAT IS GIVEN for them
   anywhere — not in the prose, not in the schema, which covers response shapes
   only. These take the same form the schema gives `occurred_at`: RFC 3339, UTC.

   AND THE TYPED DATE IS TREATED AS A UTC CALENDAR DAY. "Since 5 September" is
   ambiguous between local and UTC midnight; resolving it to UTC means a record
   at 23:30Z falls in the fifth for every operator wherever they are, and the
   screens label the fields UTC so nobody is silently offset. The alternative —
   the operator's local day — is defensible and would need to be a decision
   rather than an inference.
   ------------------------------------------------------------------------- */

/** `YYYY-MM-DD` from a date input, or `''`. */
function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function toUtcDayStart(calendarDate: string): string | null {
  return isCalendarDate(calendarDate) ? `${calendarDate}T00:00:00Z` : null;
}

/**
 * The end of the UTC day.
 *
 * ===========================================================================
 * `.999Z` — CHOSEN BECAUSE IT IS CORRECT WHETHER `until` IS INCLUSIVE OR
 * EXCLUSIVE, AND THE CONTRACT DOES NOT SAY WHICH.
 * ===========================================================================
 *
 * THIS WAS `T23:59:59Z` AND THAT WAS WRONG IN ONE READING. `platform-audit-read-v1`
 * names `since` and `until` and states NEITHER their format NOR their
 * inclusivity — a second underspecification beyond the format one, reported
 * rather than resolved quietly.
 *
 * The log's timestamps are SECOND PRECISION, which the contract says three
 * separate times: the schema's `record_id` ("paging over a second-precision
 * timestamp alone either skips records or repeats them"), `pagination.ordering`
 * ("timestamps collide at second precision under a burst"), and
 * `testRequirements` ("Seed a burst at one-second precision"). So a day's
 * records run up to `T23:59:59Z` and no further.
 *
 * Against that, with `until` unspecified:
 *
 *   `T23:59:59Z`        correct if INCLUSIVE. If EXCLUSIVE it SILENTLY DROPS
 *                       every record in the final second — the newest ones,
 *                       which is where an investigation looks first.
 *   next day `T00:00:00Z`  correct if EXCLUSIVE. If INCLUSIVE it pulls in a
 *                       second of the FOLLOWING day.
 *   `T23:59:59.999Z`    CORRECT EITHER WAY. Inclusive: captures `…:59Z`,
 *                       excludes the next day. Exclusive: `…:59Z` is strictly
 *                       less than `.999`, so it is still captured, and the next
 *                       day still is not.
 *
 * THE RISK THIS TAKES, NAMED: the format is unspecified, so Core might refuse a
 * fractional second with `invalid_argument`. That is a LOUD failure on first use
 * and a one-character fix. The alternative risks a SILENT one-second gap that
 * nobody would find while hunting for an event. Loud-and-wrong beats
 * silent-and-wrong, which is the same trade every parser in this file makes.
 */
export function toUtcDayEnd(calendarDate: string): string | null {
  return isCalendarDate(calendarDate) ? `${calendarDate}T23:59:59.999Z` : null;
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

    async resolveMember(organizationId, identifier) {
      /*
       * =====================================================================
       * EXACTLY ONE FIELD. NO CONFIRMATION TOKEN, AND THAT IS DELIBERATE.
       * =====================================================================
       *
       * `resolveMemberInput` is `required: ['identifier']` with
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
      try {
        return parseResolveMember(
          await platformRequest(
            `${ORGANIZATIONS_PATH}/${encodeURIComponent(organizationId)}/members/resolve`,
            { method: 'POST', body: { identifier } },
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
      const body = {
        admin_identifier: input.admin_identifier,
        template_id: input.template_id,
        // Required, validated, discarded. See the constant.
        first_workspace_name: DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
        derived_value: input.derived_value,
      };
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
