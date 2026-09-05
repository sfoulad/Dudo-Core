/**
 * ===========================================================================================
 * THE TWO PLATFORM ROUTE OPERATIONS. `docs/decisions/0025` ·
 * `packages/contracts/core/platform/platform-operator-v1`.
 * ===========================================================================================
 *
 *   GET  /api/v1/platform/organizations   enumerate the Organizations on the platform
 *   GET  /api/v1/platform/whoami          the operator's own platform context
 *
 * BOTH ARE THIN, AND THAT IS THE DESIGN. Authentication, authority resolution, the mutual
 * exclusion, authorization and the audit record all happen in `platform-routes.ts` BEFORE either
 * function below is called, and the audit record is written AFTER. Neither handler can skip any
 * of it, because neither is reached except through `dispatchPlatformRoute`.
 *
 * ===========================================================================================
 * WHAT NEITHER HANDLER DOES, AND WHY EACH ABSENCE MATTERS
 * ===========================================================================================
 *
 * NEITHER RESOLVES A TENANT, AND NEITHER CAN. They receive a `PlatformRouteContext`, which
 * carries a principal identifier, a platform role, a grant set and a validated query map. There
 * is no `TenantStoreResolver` here, no `TenantScopedStore`, no organization identifier belonging
 * to the caller, and no D1 binding. `whereWithTenant` is not reachable from this file by any
 * route.
 *
 * NEITHER RETURNS A COUNT OF ANYTHING INSIDE A TENANT. No customers, no members, no invoices, no
 * activity, no usage, no last-seen. Every one of those is a read behind `whereWithTenant`, and
 * "how many customers does this Organization have" is how a console acquires cross-tenant reach
 * one convenient number at a time. `PlatformOperatorStore` has no method that could answer one,
 * which is stronger than a rule that neither handler asks.
 *
 * NEITHER ISSUES, CLEARS OR ROTATES A CREDENTIAL. `PlatformRouteHandler` returns a JSON value and
 * a target, and has no field for a cookie or a header.
 *
 * NEITHER NAMES ANOTHER PRINCIPAL. `whoami` returns the caller's own context and has no parameter
 * through which another operator could be named; `organizations.list` returns no principal at all.
 * The safety argument is in the signatures, which is the device `organization-selection-v1` relies
 * on for its own picker.
 */

import type { Clock } from '../kernel/clock.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { ErrorDetail } from '../kernel/errors.ts';
import { conflict, detail, internal, invalidArgument, notFound, quotaExceeded } from '../kernel/errors.ts';
import { isSubmittableIdentifier } from '../identity/credential-store.ts';
import type { OnboardingInput, OnboardingService } from '../onboarding/onboarding.ts';
import type { MemberResolutionService } from '../directory/member-resolution.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import { TEMPLATE_ROW_WRITES } from '../identity/control-plane-admission.ts';
import type { TemplateStore } from './template-store.ts';
import { normalizeTemplateName, parseTemplateCreate, toTemplateOutput } from './templates.ts';
import type { PreAuthBody } from '../identity/pre-auth-admission.ts';
import type { ConfirmationParameters } from '../confirmation/binding.ts';
import type { ConfirmationService } from '../confirmation/confirmation-service.ts';
import { confirmablePermissionFor } from '../confirmation/critical-permissions.ts';
import { resolveStatementLocale, statementAuditTarget } from '../confirmation/statements.ts';
import type { PlatformActionTarget } from './platform-audit.ts';
import type { PlatformOperatorStore } from './platform-operator-store.ts';
import type { PlatformCursorCodec } from './platform-cursor.ts';
import { reachablePlatformPermissions } from './platform-permissions.ts';
import { NO_TARGET } from './platform-audit.ts';
import type {
  PlatformRouteContext,
  PlatformRouteHandlers,
  PlatformRouteOutcome,
} from './platform-routes.ts';
import {
  PLATFORM_MAX_PAGE_SIZE,
  readCursorParameter,
  readPageSize,
} from './platform-routes.ts';

/**
 * The Organization list — the console's home screen.
 *
 * ===========================================================================================
 * IT RETURNS IDENTIFIERS AND STATUS AND NO NAMES, AND THAT IS A PRODUCT DEPENDENCY RATHER THAN A
 * STUB.
 * ===========================================================================================
 *
 * `control-plane/0002_organization.sql` declined a name column deliberately, because the
 * organization-structure slice owns the Organization data model and adding a display name there
 * would decide Core's shape as a side effect of unblocking something else. THE CONSOLE'S HOME
 * SCREEN IS THEREFORE A LIST OF 22-CHARACTER OPAQUE IDENTIFIERS, which is not a usable
 * administrative interface.
 *
 * That is the contract's PO-3, it is the same gap that makes the Organization picker unshippable
 * (`0021`), and ONE FIX CLOSES BOTH. It is stated here rather than left to be discovered during
 * UI work, and it is not worth solving locally.
 *
 * `display_name` IS EMITTED ANYWAY, ALWAYS PRESENT AND ALWAYS NULL — the same choice
 * `session-route-handlers.ts` makes for the picker, for the same reason: absent-versus-null is a
 * distinction two clients resolve differently, and "the web app shows a blank and the iPhone app
 * shows nothing" is exactly the divergence the one-contract rule exists to prevent. BOTH CLIENTS
 * MUST RENDER THE IDENTIFIER VERBATIM when it is null — not a blank, not a dash, not "Unnamed
 * Organization".
 *
 * ===========================================================================================
 * KEYSET PAGINATION, AND ONE EXTRA ROW TO DECIDE THE CURSOR
 * ===========================================================================================
 *
 * The store is asked for `pageSize + 1` rows and at most `pageSize` are returned. The extra row
 * is how "is there another page" is answered WITHOUT a second query and without a COUNT — a COUNT
 * over the whole table is an unbounded read on a single-threaded database, and it would also
 * publish the platform's total Organization count as a side effect of paging.
 *
 * `next_cursor` IS NULL ON THE LAST PAGE and is never an empty string. `pagination.schema.json`'s
 * rule, and it means a client's loop terminates on a null rather than on a length comparison it
 * has to get right.
 */
function listOrganizations(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly cursors: PlatformCursorCodec;
  readonly clock: Clock;
}) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    const pageSize = readPageSize(context.query);
    if (!pageSize.ok) {
      return err(pageSize.error);
    }
    const offered = readCursorParameter(context.query);
    if (!offered.ok) {
      return err(offered.error);
    }

    const nowMs = dependencies.clock.nowMs();
    // THE CURSOR IS BOUND TO THE CALLING OPERATOR AND TO THE PAGE SIZE. The principal comes from
    // `context.authority`, which `dispatchPlatformRoute` resolved from a verified session — never
    // from the request, and never from the cursor itself.
    const binding = {
      principalId: context.authority.principalId,
      pageSize: pageSize.value,
    };
    let anchor: string | null = null;
    if (offered.value !== null) {
      // THE SIGNATURE IS VERIFIED BEFORE THE ANCHOR IS USED, and every failure — malformed,
      // forged, expired, bound to a different page size, or ISSUED TO A DIFFERENT OPERATOR —
      // returns the one `rejectedCursor()` value. A caller cannot tell which, and there is no
      // branch here that could tell it.
      const decoded = await dependencies.cursors.decode(offered.value, binding, nowMs);
      if (!decoded.ok) {
        return err(decoded.error);
      }
      anchor = decoded.value;
    }

    // `pageSize + 1`, and the bound below is what keeps that from exceeding the store's own
    // sanity check on a hand-edited constant. `PLATFORM_MAX_PAGE_SIZE + 1` is 101.
    const limit = Math.min(pageSize.value + 1, PLATFORM_MAX_PAGE_SIZE + 1);
    const rows = await dependencies.store.listOrganizations(limit, anchor);
    if (!rows.ok) {
      return err(rows.error);
    }

    const page = rows.value.slice(0, pageSize.value);
    const hasMore = rows.value.length > pageSize.value;
    const last = page.length === 0 ? undefined : page[page.length - 1];
    if (hasMore && last === undefined) {
      // Unreachable: `hasMore` requires more rows than `pageSize`, and `pageSize` is at least 1,
      // so `page` cannot be empty. Refused rather than asserted away, because the alternative is a
      // `next_cursor` built from `undefined` and an enumeration that silently restarts.
      return err(internal());
    }

    return ok({
      body: {
        data: page.map((organization) => ({
          organization_id: organization.organizationId,
          status: organization.status,
          created_at: organization.createdAt,
          // PRESENT AND NULL. See the header — never omitted.
          display_name: null,
        })),
        next_cursor:
          hasMore && last !== undefined
            ? await dependencies.cursors.encode(last.organizationId, binding, nowMs)
            : null,
      },
      // AN ENUMERATION HAS NO SINGLE AFFECTED TARGET, and `'none'` records that as a positive
      // fact rather than leaving the audit row's target columns to be interpreted. The RECORD IS
      // STILL WRITTEN: P4 requires it precisely because enumerating every Organization is the
      // reconnaissance step that precedes a targeted action.
      target: NO_TARGET,
    });
  };
}

/**
 * The operator's own platform context.
 *
 * ===========================================================================================
 * IT REPORTS THE PERMISSIONS A PLATFORM ROUTE CAN ACTUALLY EVALUATE, NOT EVERYTHING THE ROLE
 * HOLDS.
 * ===========================================================================================
 *
 * `reachablePlatformPermissions` intersects the role's grants with Core's platform envelope, so
 * `platform-admin` reports six rather than eight. The two it holds and does not report —
 * `core.principal.grant-platform-scope` and `core.marketplace.moderate` — are reachable by NO
 * ROUTE and none may acquire them, so reporting them would tell a console it may take an action
 * that does not exist. The full argument, and the fact that the contract leaves this open, is on
 * `reachablePlatformPermissions` itself.
 *
 * UI HIDING IS PRESENTATION, NEVER SECURITY (`0007` D8). This route exists so the console can
 * avoid drawing buttons that would fail; every permission it reports is enforced again by Core on
 * the call itself, and a console that hid nothing would be ugly and equally safe.
 *
 * IT READS NOTHING. The authority was already resolved by `dispatchPlatformRoute` — including the
 * `platform_operator` lookup and the mutual-exclusion probe — so this handler issues no statement
 * of its own. Its whole cost is the audit record P4 requires.
 */
function whoami() {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    return ok({
      body: {
        principal_id: context.authority.principalId,
        platform_role: context.authority.platformRole,
        permissions: reachablePlatformPermissions(context.authority.platformRole),
      },
      // The caller is not a "target": the record's actor columns already name them, and setting
      // `principal` here would produce a row that reads as one operator acting ON another.
      target: NO_TARGET,
    });
  };
}

/**
 * The confirmation challenge — platform class.
 *
 * ===========================================================================================
 * IT IS THIN BECAUSE EVERY RULE IS ENFORCED ABOVE OR BELOW IT, WHICH IS THE DESIGN.
 * ===========================================================================================
 *
 * ABOVE: `dispatchPlatformRoute` has already resolved the permission FROM THE NAMED OPERATION and
 * authorized against it, so a caller who could not perform the operation never reaches this
 * function and receives the identical refusal it would have received from the operation itself.
 * *"WITHOUT THIS PROPERTY THE CHALLENGE ENDPOINT WOULD BE A UNIVERSAL EXISTENCE ORACLE OVER EVERY
 * CRITICAL TARGET IN THE PLATFORM."*
 *
 * BELOW: `ConfirmationService.issueChallenge` refuses a non-critical operation, canonicalises the
 * parameters, composes the statement in Core's own words, reserves the write and stores the
 * binding. None of that is repeated here, and re-implementing any of it would be a second place
 * for it to drift.
 *
 * SO THIS FUNCTION TRANSLATES THE WIRE SHAPE AND CHOOSES THE AUDIT TARGET. That is all.
 */
function requestConfirmation(dependencies: { readonly confirmations: ConfirmationService }) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const actionId = body.action_id;
    if (typeof actionId !== 'string') {
      return err(invalidArgument([detail('action_id', 'required')]));
    }
    const permissionId = confirmablePermissionFor(actionId);
    if (permissionId === undefined) {
      // Unreachable in practice — the dispatcher resolved the permission from the same value and
      // refused already. Kept because this handler is exported for verification and because a
      // resolver and a handler that disagreed about what is confirmable would issue a token under
      // one permission for an operation described by another.
      return err(invalidArgument([detail('action_id', 'not_a_confirmable_operation')]));
    }

    const locale = typeof body.locale === 'string' ? body.locale : undefined;
    // The declared object field, already validated as a flat primitive map by the class. An
    // ABSENT `parameters` is an EMPTY set rather than an error: an operation may legitimately take
    // none, and `issueChallenge` refuses if the statement needs one that is missing.
    const parameters = (context.objects.parameters ?? {}) as ConfirmationParameters;

    const challenge = await dependencies.confirmations.issueChallenge({
      principalId: context.authority.principalId,
      // SERVER-DERIVED, BOTH. `requestConfirmationInput` declares neither, and says why: *"an
      // input that decides its own binding is not an input, it is a grant."*
      sessionId: context.sessionId,
      actionId,
      permissionId,
      parameters,
      locale: resolveStatementLocale(locale),
    });
    if (!challenge.ok) {
      return err(challenge.error);
    }

    return ok({
      body: {
        confirmation_id: challenge.value.confirmationId,
        statement: challenge.value.statement,
        // THE LOCALE ACTUALLY USED, WHICH IS NOT ALWAYS THE ONE REQUESTED. `0027`'s fallback rule
        // does its work here: an unsupported locale falls back to English AND SAYS SO. A silent
        // fallback would show a user text they cannot read while the client believed it had been
        // localised — CF-4 restored in a smaller and harder-to-notice form.
        statement_locale: challenge.value.statementLocale,
        expires_at: challenge.value.expiresAt,
      },
      // THE AUDIT RECORD NAMES WHAT THE STATEMENT NAMED, from the template's own declaration
      // rather than from a guess at parameter names. See `statementAuditTarget` — and note that
      // an operation whose target is TENANT BUSINESS DATA declares none, because `0025` Decision 5
      // forbids the operator log from holding it.
      target: auditTargetFor(actionId, parameters),
    });
  };
}

function auditTargetFor(actionId: string, parameters: ConfirmationParameters): PlatformActionTarget {
  const target = statementAuditTarget(actionId, parameters);
  if (target === null) {
    return NO_TARGET;
  }
  return target.kind === 'principal'
    ? { kind: 'principal', principalId: target.id }
    : { kind: 'organization', organizationId: target.id };
}

/**
 * Create a Template — a business type.
 *
 * ===========================================================================================
 * NOTHING IN THIS FUNCTION READS WHAT THE NAME SAYS.
 * ===========================================================================================
 *
 * It validates lengths and the closed level set, normalises the name for collision detection, and
 * stores it. **There is no branch anywhere here that depends on the value of `name`** — no
 * `switch`, no lookup table, no special case. That is `CORE_BOUNDARIES.md` §6 rule 1's row/column
 * distinction held in code: the word "Dental Clinic" is a value an operator typed, which Core no
 * more understands than it understands a customer's name.
 *
 * A CONFLICT IS DISCLOSED, WHICH IS UNUSUAL HERE AND IS RULED SAFE FOR A REASON THAT DOES NOT
 * GENERALISE. `template-v1`: *"Templates are platform configuration visible to every operator
 * through `platform.templates.list`. A conflict discloses the existence of something the caller
 * may already enumerate."* Every `not_found` collapse elsewhere in this platform exists precisely
 * because the caller may NOT enumerate what it is probing. **Copy the reasoning, never the
 * outcome.**
 */
function createTemplate(dependencies: {
  readonly templates: TemplateStore;
  readonly admission: ControlPlaneWriteAdmission;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const parsed = parseTemplateCreate({
      name: body.name,
      labels: context.objects.level_labels ?? {},
    });
    if (!parsed.ok) {
      return err(parsed.error);
    }

    const nowMs = dependencies.clock.nowMs();
    const admitted = await dependencies.admission.reserve({
      principalId: context.authority.principalId,
      estimatedRowWrites: TEMPLATE_ROW_WRITES,
      nowMs,
    });
    if (!admitted.ok) {
      return err(admitted.error);
    }
    if (admitted.value.kind === 'deferred') {
      // `quota_exceeded` IS DECLARED ON THIS ROUTE, so it is reported honestly rather than
      // collapsed. Nothing degrades for any tenant when this refuses — no tenant depends on this
      // surface at all.
      return err(quotaExceeded());
    }

    const templateId = dependencies.ids.generate();
    const written = await dependencies.templates.create(
      {
        templateId,
        name: parsed.value.name,
        normalizedName: normalizeTemplateName(parsed.value.name),
        labels: parsed.value.labels,
        createdAt: toRfc3339Utc(nowMs),
      },
      admitted.value.reservation,
    );
    if (!written.ok) {
      return err(written.error);
    }
    if (!written.value) {
      return err(conflict());
    }

    return ok({
      body: toTemplateOutput({
        templateId,
        name: parsed.value.name,
        labels: parsed.value.labels,
        // ALWAYS `active`. No route sets `status` in version 1 (TM-2), and the field exists in the
        // shape only so that adding the retire route later changes no published response.
        status: 'active',
        createdAt: toRfc3339Utc(nowMs),
      }),
      // NO TARGET. A Template is tenant-independent platform configuration and names neither an
      // Organization nor a principal, so there is nothing for the operator log's target columns to
      // hold — and `template_id` is not one of the two kinds `0025` Decision 5 permits there.
      target: NO_TARGET,
    });
  };
}

/**
 * ===========================================================================================
 * ONBOARD AN ORGANIZATION. `organization-onboarding-v1`.
 * ===========================================================================================
 *
 * *** THE HANDLER IS THIN ON PURPOSE, AND THE THINNESS IS THE ISOLATION ARGUMENT. *** It
 * validates four strings and calls one method. **Everything that touches a tenant store lives in
 * `onboarding/`, outside this directory**, so that `qa-agent`'s control — *"no module under
 * `platform/core/platform/**` names a tenant primitive"* — stays exact rather than gaining an
 * exception for this one route. This function names no resolver, no store and no binding.
 *
 * IT PASSES THE OPERATOR'S PRINCIPAL ID AND NOTHING ELSE ABOUT THE OPERATOR. The service needs it
 * for the write-budget reservation and for the audit record's actor. It receives no authority, no
 * grants and no session.
 */
function onboardOrganization(dependencies: { readonly onboarding: OnboardingService }) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const parsed = parseOnboardingInput(body);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    const outcome = await dependencies.onboarding.onboard({
      request: parsed.value,
      // SERVER-DERIVED. `context.authority` came from a verified session and a `platform_operator`
      // row; there is no body field that could influence it.
      actorPrincipalId: context.authority.principalId,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
    if (!outcome.ok) {
      return err(outcome.error);
    }

    return ok({
      body: {
        organization_id: outcome.value.organizationId,
        admin_principal_id: outcome.value.adminPrincipalId,
        workspace_id: outcome.value.workspaceId,
        warnings: outcome.value.warnings,
        // NO CREDENTIAL FIELD, AND NO TOMBSTONE FOR THE ONE THAT WAS REMOVED. The server never
        // held a password — the console generated it, derived from it, and holds the only copy.
        // A placeholder property here would be a PERMITTED OPTIONAL FIELD, which is the same
        // defect one size smaller.
      },
      // THE ORGANIZATION IT CREATED. One of the two target kinds `0025` Decision 5 permits, and
      // the operator log records the identifier and nothing about what the Organization contains —
      // not the admin's identifier, not the Workspace name, not the Template.
      target: { kind: 'organization', organizationId: outcome.value.organizationId },
    });
  };
}

/**
 * Organization detail. `organization-detail-v1`.
 *
 * ONE REQUEST, ONE RESPONSE, AND THE TEMPLATE IS EMBEDDED RATHER THAN RETURNED AS AN ID TO FETCH.
 * `theOnePageOneRequestRule`, and the reason is a budget rather than an aesthetic: **P4 makes every
 * platform route write an audit record**, so a page firing three requests spends three times the
 * budget of one firing a single request, against a per-principal ceiling of roughly 300 operator
 * actions per UTC day. **The ordinary REST instinct — return an id, let the client resolve it — is
 * the expensive one here**, and it is expensive in a resource that stops the whole platform when
 * exhausted rather than merely being slow.
 *
 * EMBEDDING DISCLOSES NOTHING: a Template is tenant-INDEPENDENT platform configuration, identical
 * for every caller. Contrast anything tenant-scoped, which is not embedded because it is not
 * readable at all.
 */
function readOrganization(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly templates: TemplateStore;
}) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    const organizationId = context.pathParams.organization_id;
    if (organizationId === undefined) {
      // UNREACHABLE VIA THE MATCHER, which extracts declared segments by pattern. `internal()`
      // rather than `not_found`, because reaching this line is a defect in the route table rather
      // than anything a caller did.
      return err(internal());
    }

    const found = await dependencies.store.findOrganizationDetail(organizationId);
    if (!found.ok) {
      return err(found.error);
    }
    if (found.value === null) {
      // THE ARGUMENT-FREE 404. No oracle concern on THIS route and it is worth saying why rather
      // than leaving it to be re-derived: every caller who reaches here can already enumerate every
      // Organization from `platform.organizations.list`, so the distinction discloses nothing to a
      // population that could not obtain it one screen away. **THAT REASONING IS SPECIFIC TO THIS
      // CLASS and must not be copied to a route a tenant principal can reach.**
      return err(notFound());
    }

    // ---- THE TEMPLATE, RESOLVED. A second point read, and it is the second of the two the
    // contract budgets for — `organization` with its member count, then `template`.
    //
    // A TEMPLATE THAT CANNOT BE READ REFUSES THE WHOLE RESPONSE rather than rendering `null`. A
    // `null` here would be indistinguishable from "this Organization has no Template", which is a
    // real and different state — and the operator would be told a school is unconfigured because
    // one read failed.
    let template: Readonly<Record<string, unknown>> | null = null;
    if (found.value.templateId !== null) {
      const record = await dependencies.templates.findById(found.value.templateId);
      if (!record.ok) {
        return err(record.error);
      }
      if (record.value === null) {
        // THE FOREIGN KEY MAKES THIS UNREACHABLE — `0013` will not admit an Organization naming an
        // absent Template, and no route deletes one. It is `internal()` rather than a silent
        // `null` because if it ever happens, the referential guarantee has failed and that is a
        // fact worth surfacing rather than smoothing into "no business type".
        return err(internal());
      }
      template = toTemplateOutput(record.value);
    }

    return ok({
      body: {
        organization_id: found.value.organizationId,
        status: found.value.status,
        created_at: found.value.createdAt,
        // ALWAYS NULL. `0002_organization.sql` declined a name column deliberately and the
        // organization-structure slice owns that model. The field is contracted nullable so a name
        // is additive later; **the console's list and detail screens are therefore opaque
        // identifiers, which is contract `PO-3` and not a defect here.**
        display_name: null,
        template,
        member_count: found.value.memberCount,
      },
      target: { kind: 'organization', organizationId: found.value.organizationId },
    });
  };
}

/**
 * Resolve one member by identifier. `organization-detail-v1`, `docs/decisions/0028` Decision 2.
 *
 * THE HANDLER IS THIN BECAUSE EVERYTHING THAT TOUCHES A TENANT STORE LIVES IN `directory/`. This
 * function names no resolver, no store handle and no binding — see that module for why.
 */
function resolveMember(dependencies: { readonly members: MemberResolutionService }) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const organizationId = context.pathParams.organization_id;
    if (organizationId === undefined) {
      return err(internal());
    }
    const identifier = body.identifier;
    if (typeof identifier !== 'string' || !isSubmittableIdentifier(identifier)) {
      // A SHAPE ERROR, REFUSED BEFORE THE LOOKUP AND BEFORE THE AUDIT WRITE. It is not one of the
      // five collapsed cases: a malformed identifier is not a probe, it is a malformed request,
      // and it discloses nothing because the constraint is published in the schema.
      //
      // IT ALSO MEANS A MALFORMED IDENTIFIER COSTS NO TENANT WRITE, which is the difference
      // between a validation floor and a rate limit and is worth being clear about — it bounds
      // garbage, not probing.
      return err(invalidArgument([detail('identifier', 'must_be_a_submittable_identifier')]));
    }

    const resolved = await dependencies.members.resolve({
      organizationId,
      identifier,
      actorPrincipalId: context.authority.principalId,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
    if (!resolved.ok) {
      return err(resolved.error);
    }
    if (resolved.value === null) {
      // ONE ANSWER FOR FIVE CASES: unknown Organization, an identifier belonging to nobody, a
      // non-member, a suspended membership, and **a platform operator.** `notFound()` takes no
      // arguments, so there is no field, message, detail token or response size to vary.
      return err(notFound());
    }

    return ok({
      body: {
        principal_id: resolved.value.principalId,
        role: resolved.value.role,
        // THE SUBMITTED IDENTIFIER IS NOT ECHOED. The caller sent it and already knows it; echoing
        // it would put an email address in a response body for no purpose, and in a log line for
        // anyone who logs responses.
      },
      // THE PRINCIPAL, NOT THE ORGANIZATION. `0025` Decision 5 permits both kinds, and this
      // operation's target is the person asked about — which is what makes the operator log usable
      // for the question "who has been asking about our staff".
      target: { kind: 'principal', principalId: resolved.value.principalId },
    });
  };
}

/**
 * The four fields, validated individually. The CLASS has already refused anything undeclared, a
 * non-object body, an oversized body and any query string; this is the per-field semantic layer.
 *
 * EVERY REFUSAL NAMES ITS FIELD, because each one is a shape error a console must be able to show
 * against the right input. None of them discloses anything: the constraints are published in the
 * schema, and none of these checks touches storage.
 */
function parseOnboardingInput(body: PreAuthBody): Result<OnboardingInput> {
  const adminIdentifier = body.admin_identifier;
  const templateId = body.template_id;
  const firstWorkspaceName = body.first_workspace_name;
  const derivedValue = body.derived_value;

  const details: ErrorDetail[] = [];
  if (typeof adminIdentifier !== 'string' || !isSubmittableIdentifier(adminIdentifier)) {
    // THE SAME PREDICATE THE LOGIN PATH USES, imported rather than restated. Two definitions of
    // "an enrollable identifier" would agree until one was touched, and the divergence would
    // present as an account that can be created and cannot log in.
    details.push(detail('admin_identifier', 'must_be_a_submittable_identifier'));
  }
  if (typeof templateId !== 'string' || !IDENTIFIER_PATTERN.test(templateId)) {
    details.push(detail('template_id', 'must_be_an_identifier'));
  }
  if (
    typeof firstWorkspaceName !== 'string' ||
    firstWorkspaceName.trim() !== firstWorkspaceName ||
    firstWorkspaceName.length < 1 ||
    firstWorkspaceName.length > MAX_WORKSPACE_NAME_LENGTH
  ) {
    details.push(detail('first_workspace_name', 'must_be_a_trimmed_name'));
  }
  if (typeof derivedValue !== 'string' || !DERIVED_VALUE_PATTERN.test(derivedValue)) {
    // WIDTH-CHECKED HERE AND AGAIN AT `fromBase64Url` IN THE SERVICE. `credential-verifier.ts`
    // calls the width check "the only mitigation for a client that sends something other than a
    // KDF output" — a short value stored as a verifier weakens the account permanently and
    // silently, so it is checked at the boundary AND at the point of use.
    details.push(detail('derived_value', 'must_be_32_bytes_base64url'));
  }
  if (details.length > 0) {
    return err(invalidArgument(details));
  }
  return ok({
    adminIdentifier: adminIdentifier as string,
    templateId: templateId as string,
    firstWorkspaceName: firstWorkspaceName as string,
    derivedValue: derivedValue as string,
  });
}

/** The schema's `maxLength`. */
const MAX_WORKSPACE_NAME_LENGTH = 120;

/** 32 bytes of base64url. The schema's `^[A-Za-z0-9_-]{43}$`. */
const DERIVED_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * The platform identifier grammar, restated here rather than exported from `platform-routes.ts`.
 *
 * IT IS THE SAME EXPRESSION AND THE DUPLICATION IS DELIBERATE-BUT-SMALL: exporting the matcher's
 * private constant would make a path-matching detail part of the class's surface, and this is a
 * body-field check. Both are `^[A-Za-z0-9_-]{8,64}$`, which is the schema's `templateId` pattern.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;

/** List Templates. Keyset paging, identical in shape to the Organization list. */
function listTemplates(dependencies: {
  readonly templates: TemplateStore;
  readonly cursors: PlatformCursorCodec;
  readonly clock: Clock;
}) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    const pageSize = readPageSize(context.query);
    if (!pageSize.ok) {
      return err(pageSize.error);
    }
    const offered = readCursorParameter(context.query);
    if (!offered.ok) {
      return err(offered.error);
    }
    const nowMs = dependencies.clock.nowMs();
    const binding = { principalId: context.authority.principalId, pageSize: pageSize.value };
    let anchor: string | null = null;
    if (offered.value !== null) {
      const decoded = await dependencies.cursors.decode(offered.value, binding, nowMs);
      if (!decoded.ok) {
        return err(decoded.error);
      }
      anchor = decoded.value;
    }

    const limit = Math.min(pageSize.value + 1, PLATFORM_MAX_PAGE_SIZE + 1);
    const rows = await dependencies.templates.list(limit, anchor);
    if (!rows.ok) {
      return err(rows.error);
    }
    const page = rows.value.slice(0, pageSize.value);
    const hasMore = rows.value.length > pageSize.value;
    const last = page.length === 0 ? undefined : page[page.length - 1];

    return ok({
      body: {
        data: page.map(toTemplateOutput),
        // NO not_found, EVER. Zero Templates is `200` with `data: []` — an empty collection is not
        // a missing one, and both clients must render it as a first-class state.
        next_cursor:
          hasMore && last !== undefined
            ? await dependencies.cursors.encode(last.templateId, binding, nowMs)
            : null,
      },
      target: NO_TARGET,
    });
  };
}

/**
 * Read one Template.
 *
 * `not_found` IS AN HONEST `not_found` HERE, AND THAT IS UNUSUAL IN THIS CODEBASE. Everywhere else
 * Dudo collapses "does not exist" with "not yours" to close an existence oracle. Templates are
 * tenant-independent platform configuration and **every caller who can reach this route may
 * already enumerate all of them, so there is no population to protect and nothing a distinction
 * could leak.** Stated because a reviewer comparing this to `customer-directory-v1` will otherwise
 * read it as an inconsistency — and because the reasoning, not the habit, is what should be copied.
 */
function readTemplate(dependencies: { readonly templates: TemplateStore }) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    // ALREADY VALIDATED BY THE MATCHER against the platform identifier grammar — a value that
    // could not be an identifier never reached this handler and cost no database read.
    const templateId = context.pathParams.template_id;
    if (templateId === undefined) {
      return err(internal());
    }
    const found = await dependencies.templates.findById(templateId);
    if (!found.ok) {
      return err(found.error);
    }
    if (found.value === null) {
      return err(notFound());
    }
    return ok({ body: toTemplateOutput(found.value), target: NO_TARGET });
  };
}

export function createPlatformRouteHandlers(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly templates: TemplateStore;
  /**
   * The onboarding service. REQUIRED, unlike `confirmations`.
   *
   * It is not optional because there is no sensible degraded mode: a platform console that cannot
   * onboard is a console with no purpose, and an optional dependency would make
   * `platform.organizations.create` answer `unavailable` in a deployment that simply forgot it —
   * indistinguishable from an outage. Requiring it makes the omission a COMPILE error instead,
   * which is the same reason `templates` is required.
   *
   * IT IS A PORT WITH ONE METHOD AND NOT A RESOLVER. This module names no tenant primitive; see
   * `onboarding/onboarding.ts` for why the resolver lives outside this directory.
   */
  readonly onboarding: OnboardingService;
  /**
   * The member resolve. REQUIRED, and a port with one method returning a principal id and a role.
   *
   * IT IS NOT A `PlatformOperatorStore` WITH AN EXTRA METHOD, even though the lookup it performs is
   * on this class's own store. The difference is the tenant-side audit write, which needs a
   * resolver — so the service lives in `directory/`, outside this directory, and what arrives here
   * cannot reach a tenant store. See `directory/member-resolution.ts`.
   */
  readonly members: MemberResolutionService;
  readonly admission: ControlPlaneWriteAdmission;
  readonly ids: IdGenerator;
  readonly cursors: PlatformCursorCodec;
  readonly clock: Clock;
  /**
   * OPTIONAL, AND ABSENT MEANS THE CHALLENGE ROUTE IS UNREACHABLE — not open. `dispatchPlatformRoute`
   * answers `unavailable` for a registered route with no composed handler, which is the same
   * fail-closed shape `http/api.ts` gives an uncomposed `preAuth`.
   */
  readonly confirmations?: ConfirmationService;
}): PlatformRouteHandlers {
  const handlers: Record<string, unknown> = {
    'platform.organizations.list': listOrganizations(dependencies),
    'platform.organizations.create': onboardOrganization({
      onboarding: dependencies.onboarding,
    }),
    'platform.organizations.read': readOrganization({
      store: dependencies.store,
      templates: dependencies.templates,
    }),
    'platform.organizations.members.resolve': resolveMember({
      members: dependencies.members,
    }),
    'platform.session.whoami': whoami(),
    'platform.templates.create': createTemplate({
      templates: dependencies.templates,
      admission: dependencies.admission,
      ids: dependencies.ids,
      clock: dependencies.clock,
    }),
    'platform.templates.list': listTemplates({
      templates: dependencies.templates,
      cursors: dependencies.cursors,
      clock: dependencies.clock,
    }),
    'platform.templates.read': readTemplate({ templates: dependencies.templates }),
  };
  if (dependencies.confirmations !== undefined) {
    handlers['platform.confirmations.request'] = requestConfirmation({
      confirmations: dependencies.confirmations,
    });
  }
  return Object.freeze(handlers) as PlatformRouteHandlers;
}
