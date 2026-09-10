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
import {
  conflict,
  detail,
  failedPrecondition,
  internal,
  invalidArgument,
  notFound,
  quotaExceeded,
  unavailable,
} from '../kernel/errors.ts';
import { rejectedCursor } from '../pagination/cursor.ts';
import { checkIdentifier } from '../identity/credential-store.ts';
import type { OnboardingInput, OnboardingService } from '../onboarding/onboarding.ts';
import type { MemberResolutionService } from '../directory/member-resolution.ts';
import type { CredentialResetService } from '../credential/reset-service.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import {
  ORGANIZATION_UPDATE_ROW_WRITES,
  PLATFORM_OPERATOR_ROW_WRITES,
  TEMPLATE_ROW_WRITES,
} from '../identity/control-plane-admission.ts';
import type { TemplateStore } from './template-store.ts';
import { normalizeTemplateName, parseTemplateCreate, toTemplateOutput } from './templates.ts';
import {
  applyIdentityUpdate,
  changedIdentityFieldNames,
  checkDisplayName,
  parseOrganizationIdentityUpdate,
  toIdentityOutput,
} from './organization-identity.ts';
import type { PreAuthBody } from '../identity/pre-auth-admission.ts';
import type { ConfirmationParameters } from '../confirmation/binding.ts';
import type { ConfirmationService } from '../confirmation/confirmation-service.ts';
import { confirmablePermissionFor } from '../confirmation/critical-permissions.ts';
import { resolveStatementLocale, statementAuditTarget } from '../confirmation/statements.ts';
import type { PlatformActionTarget } from './platform-audit.ts';
import type {
  PlatformAuditAnchor,
  PlatformAuditRecord,
  PlatformOperatorStore,
} from './platform-operator-store.ts';
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
  readIdentifierParameter,
  readInstantParameter,
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
      // THE ROUTE ID ALONE, because this query has no filters. If one is ever added it must join
      // this string — see `PlatformCursorBinding.scope`, where the failure a missing filter causes
      // is a wrong page rather than an error.
      scope: 'platform.organizations.list',
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
          // PRESENT ALWAYS, NULL ONLY FOR ORGANIZATIONS THAT PREDATE `0015`. Never omitted, and
          // the client renders `organization_id` verbatim when it is null — not a blank, not a
          // dash, not "Unnamed Organization".
          //
          // IT STOPPED BEING A HARDCODED `null` ON 2026-09-07. The field was contracted from the
          // start so that a name would be additive; this is that day, and no shape changed.
          display_name: organization.displayName,
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
  if (target.kind === 'organization') {
    return { kind: 'organization', organizationId: target.id };
  }
  // ===========================================================================================
  // A PRINCIPAL-TARGETED CHALLENGE RECORDS `NO_TARGET` RATHER THAN NAMING THE PRINCIPAL WITHOUT
  // ITS ORGANIZATION. `0014` made the pairing required, and this is the one call site that cannot
  // satisfy it.
  // ===========================================================================================
  //
  // THE CHALLENGE ROUTE HAS NO ORGANIZATION. It takes `action_id`, `locale` and `parameters`, no
  // path parameter, and the operation it confirms has not happened yet — so "which Organization
  // did this happen in" has no answer at challenge time.
  //
  // *** THE ALTERNATIVE WOULD HAVE BEEN TO INVENT ONE, AND THAT IS THE FAILURE THE REQUIRED FIELD
  // EXISTS TO PREVENT. *** Reading an `organization_id` out of `parameters` would let a CALLER
  // choose which Organization's audit feed its challenge appears in — a caller-supplied audit
  // value, which `0025` Decision 5 and `audit.ts`'s actor-context brand both refuse by name.
  //
  // WHAT IS LOST, STATED RATHER THAN GLOSSED: a challenge for a principal-targeted operation
  // records that a challenge was issued, by whom, for which operation, and NOT for whom. **The
  // operation it precedes records the principal in full**, and that record is the one the
  // Organization feed carries — so the trail is complete at the operation and thinner at the
  // request for permission to perform it. That is the correct direction; a challenge is not the
  // act.
  return NO_TARGET;
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
      // ONBOARDING TAKES NO CHARGE RECEIPT, AND THAT IS CORRECT RATHER THAN AN OMISSION. It
      // reserves TEN control-plane row-writes itself, at its own step 2, BEFORE its tenant write —
      // so an exhausted operator is refused with `quota_exceeded` and no tenant row is written.
      // **It was already the shape the resolve should have had**, which is where the fix came from.
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
        // THE IDENTITY BLOCK, SPREAD RATHER THAN NESTED, because `organization-detail-v1` carries
        // `display_name`, `commercial_registration` and `vat_registration` as siblings of
        // `status` and `member_count` rather than under a wrapper.
        //
        // *** THIS REPLACED `display_name: null` AND A PARAGRAPH SAYING IT WOULD ALWAYS BE NULL.
        // *** That paragraph named its own end — *"the field is contracted nullable so a name is
        // additive later"* — and `PO-3`/`OD-4` were the open questions it pointed at. Both close
        // here; nothing about the shape changed, which is what "additive" meant.
        ...toIdentityOutput(found.value.identity),
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
    // =========================================================================================
    // *** PHASE 3 HAS LANDED. `identifier` IS NO LONGER DECLARED ON THE ROUTE, SO IT CANNOT
    // *** REACH THIS FUNCTION — AND THE REFUSAL BELOW IS KEPT ANYWAY, DELIBERATELY.
    // `docs/decisions/0034`, discharging `OD-5`. Corrected 2026-09-09; the paragraph this replaces
    // said *"both are declared on the route"*, which stopped being true in the same change.
    // =========================================================================================
    //
    // WHAT IS TRUE NOW: `platform-routes.ts` declares `fields: ['target_identifier']` and the
    // platform class refuses an undeclared field BEFORE authentication. So `body.identifier` is
    // `undefined` on every request that reaches here, `legacy` is always `undefined`, and the
    // both-present branch cannot fire. **A straggler sending the old name is refused by the class
    // with `invalid_argument` — loud, recoverable and immediately diagnosable**, which is the
    // residual risk `0034` priced rather than assumed away.
    //
    // *** SO WHY IS THE DEAD BRANCH STILL HERE. IT IS NOT AN OVERSIGHT AND IT IS NOT TIDINESS
    // *** DEFERRED. *** Deleting it and reading `body.target_identifier` directly would be fewer
    // lines and would change what happens if `identifier` ever returned to the route table: the
    // field would be **silently ignored** instead of refused. On the route that leads to a
    // credential reset, *"if the two values differ, choosing silently is choosing which principal
    // to resolve"* — and ignoring is choosing. **This branch costs one comparison and converts a
    // future silent-wrong into a loud refusal, so it is a second layer rather than dead weight.**
    //
    // **BOTH PRESENT IS REFUSED. NEITHER PRESENT IS REFUSED. NEITHER IS SILENTLY PREFERRED.**
    // The first of those three is now unreachable; the second and third are live and are what the
    // shape check below enforces.
    //
    // WHAT THE CONTRACT SAYS AFTER PHASE 3: `resolveMemberInput` publishes one property and
    // `required: ["target_identifier"]`. The `oneOf` that expressed exactly-one over two names came
    // out in the same change, per `OD-5`. It never executed here in any case — nothing in this
    // repository runs JSON Schema (`packages/contracts/README.md`) — so the refusal was always a
    // rule this function had to write, and still is.
    const target = body.target_identifier;
    const legacy = body.identifier;
    if (target !== undefined && legacy !== undefined) {
      return err(invalidArgument([detail('target_identifier', 'must_not_send_both_names')]));
    }
    // `??` WOULD BE WRONG HERE AND THE DIFFERENCE IS NOT COSMETIC: it treats an explicit `null` as
    // absent, which would let `{"target_identifier": null, "identifier": "x"}` past the both-present
    // refusal and then resolve the legacy value. `undefined` is the only absence this route accepts,
    // and a present-but-null field falls through to the shape check below and is refused there.
    const submitted = target !== undefined ? target : legacy;

    // `checkIdentifier` RATHER THAN `isSubmittableIdentifier`, because the service now REQUIRES the
    // brand and a boolean cannot produce one. The check and the value it licenses are one
    // expression, so this handler cannot check and then pass something else.
    const identifier = typeof submitted === 'string' ? checkIdentifier(submitted) : null;
    if (identifier === null) {
      // A SHAPE ERROR, REFUSED BEFORE THE LOOKUP AND BEFORE THE AUDIT WRITE. It is not one of the
      // five collapsed cases: a malformed identifier is not a probe, it is a malformed request,
      // and it discloses nothing because the constraint is published in the schema.
      //
      // IT ALSO MEANS A MALFORMED IDENTIFIER COSTS NO TENANT WRITE, which is the difference
      // between a validation floor and a rate limit and is worth being clear about — it bounds
      // garbage, not probing.
      //
      // *** THE FIELD NAME IS `target_identifier`, AND IT SAID `identifier` UNTIL 2026-09-09. ***
      // That was a live client-facing defect rather than documentation rot: after phase 3 the only
      // field this route accepts is `target_identifier`, so a caller sending a malformed one — or
      // an empty body — was told that a field it cannot send and has never heard of was bad. An
      // error naming a field outside the request shape is unactionable, and it is exactly the kind
      // of residue `workflow.md` §12 is about: nothing turned red, because the assertion covering
      // it was green ON THE OLD NAME.
      //
      // IT COVERS BOTH REMAINING FAILURE MODES AND THE NAME IS RIGHT FOR EACH: a present-but-
      // malformed `target_identifier`, and NEITHER FIELD PRESENT — where `target_identifier` is
      // the only field there is to name.
      return err(invalidArgument([detail('target_identifier', 'must_be_a_submittable_identifier')]));
    }

    const resolved = await dependencies.members.resolve({
      organizationId,
      identifier,
      actorPrincipalId: context.authority.principalId,
      // THE PERMISSION THIS ROUTE DECLARES. It is `core.credential.reset` because the resolve
      // BORROWS it without performing a reset — `BORROWS_WITHOUT_PERFORMING` in
      // `critical-permissions.ts` is the same fact seen from the confirmation gate. Supplied
      // rather than derived: see `recordProbe`.
      permissionId: 'core.credential.reset',
      // THE OPERATOR'S CHARGE, WITHOUT WHICH THIS CALL DOES NOT COMPILE. Step 4b took it before
      // this handler ran, which is what stops an exhausted operator from continuing to spend a
      // customer's write allocation.
      charge: context.charge,
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
      // THE PRINCIPAL, AND THE ORGANIZATION IT HAPPENED IN. `0025` Decision 5 permits both kinds;
      // this operation's target is the person asked about — which is what makes the operator log
      // usable for "who has been asking about our staff" — and `0014` requires the Organization
      // alongside it, because `0028`'s Organization feed selects on that and **a principal-targeted
      // record without it is invisible to the feed built to disclose it.**
      //
      // THE ORGANIZATION IS THE PATH PARAMETER, VALIDATED BY THE MATCHER, and it is the one the
      // request addressed rather than one this handler chose. There is no body field that could
      // influence it.
      target: {
        kind: 'principal',
        principalId: resolved.value.principalId,
        organizationId,
      },
    });
  };
}

/**
 * ===========================================================================================
 * THE TWO AUDIT FEEDS. `platform-audit-read-v1`, `docs/decisions/0028` Decision 3.
 * ===========================================================================================
 *
 * ONE FUNCTION, TWO ROUTES, AND `organizationId` IS THE ONLY DIFFERENCE THE HANDLER SEES. The
 * principal-omission is NOT here — it is in the store method and in the SQL, which is where a
 * reviewer looks and where a handler cannot undo it. This function reads
 * `record.targetPrincipalId` in both cases and the platform feed's is always `null` because the
 * statement selected `NULL`.
 *
 * *** `PA-3`, AT THE PLACE IT MATTERS RATHER THAN IN A REPORT. *** This route lets the PLATFORM see
 * what the platform did. **The customer still cannot see it.** `core.audit.read` is catalogued,
 * granted to tenant roles, and **has no route** — so the tenant-side records the resolve and the
 * Organization feed write are **written and unreadable by their owner.** That is the largest gap
 * left in this surface, and until it closes, *"the customer can see the platform asking about
 * their staff"* is a property of the DATA and not of anything a customer can do.
 *
 * *** `PO-4`, ALSO FALSE, ALSO HERE. *** `0028` bounds the aggregation residual with *"N requests,
 * audited in both homes, visible to each victim, RATE LIMITED."* There is no rate limiter on this
 * class. What bounds a feed read is the per-principal daily write ceiling — P4 charges 2
 * row-writes for the platform feed and 2 plus a tenant reservation for the Organization feed, so
 * ~300 and ~150 reads per operator per UTC day. **That is a bound. It is not rate limiting.**
 */
function listAuditFeed(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly cursors: PlatformCursorCodec;
  readonly clock: Clock;
  readonly members?: MemberResolutionService;
}) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    const scoped = context.routeId === 'platform.organizations.audit.list';
    const organizationId = scoped ? context.pathParams.organization_id : undefined;
    if (scoped && organizationId === undefined) {
      return err(internal());
    }

    const pageSize = readPageSize(context.query);
    if (!pageSize.ok) {
      return err(pageSize.error);
    }
    const offered = readCursorParameter(context.query);
    if (!offered.ok) {
      return err(offered.error);
    }
    const actorPrincipalId = readIdentifierParameter(context.query, 'actor_principal_id');
    if (!actorPrincipalId.ok) {
      return err(actorPrincipalId.error);
    }
    const actionId = readActionIdParameter(context.query);
    if (!actionId.ok) {
      return err(actionId.error);
    }
    const since = readInstantParameter(context.query, 'since');
    if (!since.ok) {
      return err(since.error);
    }
    const until = readInstantParameter(context.query, 'until');
    if (!until.ok) {
      return err(until.error);
    }
    // NO `routeId`. The rule is route-independent because no query filter on either feed is served
    // by an index prefix — see `auditWindowIsRequired`, where passing the route was the defect.
    const window = enforceAuditWindow({
      actorPrincipalId: actorPrincipalId.value,
      actionId: actionId.value,
      since: since.value,
      until: until.value,
    });
    if (!window.ok) {
      return err(window.error);
    }

    const filters = {
      actorPrincipalId: actorPrincipalId.value,
      actionId: actionId.value,
      since: since.value,
      until: until.value,
    };

    // THE CURSOR IS BOUND TO THE WHOLE QUERY, not just the operator and the page size. Every
    // filter joins the scope, and so does the Organization — a cursor from the platform feed
    // cannot resume the Organization feed, and one issued under one filter set cannot resume
    // another. See `PlatformCursorBinding.scope`: the failure it prevents is a WRONG PAGE that
    // looks like a right one, with no error anywhere.
    const binding = {
      principalId: context.authority.principalId,
      pageSize: pageSize.value,
      scope: [
        context.routeId,
        organizationId ?? '',
        filters.actorPrincipalId ?? '',
        filters.actionId ?? '',
        filters.since ?? '',
        filters.until ?? '',
      ].join(' '),
    };

    const nowMs = dependencies.clock.nowMs();
    let anchor: PlatformAuditAnchor | null = null;
    if (offered.value !== null) {
      const decoded = await dependencies.cursors.decode(offered.value, binding, nowMs);
      if (!decoded.ok) {
        return err(decoded.error);
      }
      anchor = decodeAuditAnchor(decoded.value);
      if (anchor === null) {
        // A SIGNED CURSOR WHOSE ANCHOR IS NOT AN ANCHOR. Only reachable if a cursor signed by this
        // key was minted by a different build; `rejectedCursor` is the same answer every other
        // cursor failure gives, so this cannot be distinguished from a forgery.
        return err(rejectedCursor());
      }
    }

    // ONE EXTRA ROW IS REQUESTED to decide `next_cursor` without a second query or a COUNT — the
    // same device `listOrganizations` uses.
    const found = scoped
      ? await dependencies.store.listOrganizationAudit(
          organizationId as string,
          filters,
          pageSize.value + 1,
          anchor,
        )
      : await dependencies.store.listPlatformAudit(filters, pageSize.value + 1, anchor);
    if (!found.ok) {
      return err(found.error);
    }
    const hasMore = found.value.length > pageSize.value;
    const page = hasMore ? found.value.slice(0, pageSize.value) : found.value;
    const last = page[page.length - 1];

    // ---- THE ORGANIZATION FEED WRITES A TENANT-SIDE RECORD ON EVERY CALL, INCLUDING AN EMPTY ONE.
    //
    // *"IT IS WHAT KEEPS THE BACK DOOR THE SAME SIZE AS THE FRONT ONE."* A per-Organization audit
    // read discloses the same class of fact the resolve does, so it carries the same visibility —
    // otherwise an operator would simply read the log instead of resolving, and the control would
    // have been routed around rather than enforced.
    //
    // *** THE RECURSION IS REAL, BOUNDED, AND NOT A DEFECT: reading an Organization's trail writes
    // to that Organization's trail. *** One record per read, not one per record read, so it
    // terminates — but a reader WILL see their own previous visits in the feed, and that is
    // correct. It is stated here and in `member-resolution.ts` so it is not filed as a bug.
    //
    // IT IS WRITTEN BEFORE THE ANSWER IS PRODUCED, and an unwritable record refuses the read.
    // `0013` D2: inability to record the evidence is not a reason to proceed without it.
    if (scoped) {
      if (dependencies.members === undefined) {
        // ABSENT MEANS REFUSED. A deployment that cannot write the tenant-side record must not
        // serve the scoped feed, because the record is the control rather than a by-product.
        return err(unavailable());
      }
      const recorded = await dependencies.members.recordOrganizationAccess({
        organizationId: organizationId as string,
        actionId: context.routeId,
        actorPrincipalId: context.authority.principalId,
        // BOTH AUDIT FEEDS DECLARE THIS PERMISSION, and only the scoped feed reaches this line.
        // Supplied rather than derived: see `recordProbe`.
        permissionId: 'core.platform-audit.read',
        // EMPTY, AND IT IS A STATEMENT: **reading a feed changes nothing.** The customer's trail
        // says the platform read their log, which is the disclosure, and names no field because
        // none moved.
        changedFieldNames: [],
        // REQUIRED. Step 4b charged the operator before this handler ran.
        charge: context.charge,
        requestId: context.requestId,
        correlationId: context.correlationId,
      });
      if (!recorded.ok) {
        return err(recorded.error);
      }
    }

    return ok({
      body: {
        data: page.map((record) => ({
          record_id: record.actionRecordId,
          occurred_at: record.occurredAt,
          actor_principal_id: record.actorPrincipalId,
          actor_platform_role: record.actorPlatformRole,
          action_id: record.actionId,
          outcome: record.outcome,
          correlation_id: record.correlationId,
          // THE TWO FEEDS DIFFER HERE AND NOWHERE ELSE IN THIS FUNCTION. The scoped feed carries
          // the principal because the caller named the Organization; the platform feed carries the
          // Organization because an operator can enumerate Organizations anyway. **Neither field is
          // filtered out of a row that had it — the store never read the one it must not disclose.**
          ...(scoped
            ? { target_principal_id: record.targetPrincipalId }
            : { target_organization_id: record.targetOrganizationId }),
        })),
        next_cursor:
          hasMore && last !== undefined
            ? await dependencies.cursors.encode(encodeAuditAnchor(last), binding, nowMs)
            : null,
      },
      // THE PLATFORM FEED NAMES NO TARGET — it is an enumeration across every Organization. The
      // SCOPED feed names the Organization it read, so "who has been reading this customer's
      // trail" is answerable from the operator log itself.
      target: scoped
        ? { kind: 'organization', organizationId: organizationId as string }
        : NO_TARGET,
    });
  };
}

/**
 * The compound anchor, as one string.
 *
 * `PlatformCursorCodec` carries a single opaque anchor, and this feed's order is
 * `(occurred_at, action_record_id)`. **The separator is ` `, which cannot appear in either
 * component** — `occurred_at` is RFC 3339 and `action_record_id` matches the identifier grammar —
 * so the split is unambiguous rather than merely unlikely.
 */
export function encodeAuditAnchor(record: PlatformAuditRecord): string {
  return `${record.occurredAt} ${record.actionRecordId}`;
}

/**
 * ===========================================================================================
 * *** DO NOT CALL THIS ON A STRING THAT CAME FROM A REQUEST. It parses an anchor that has
 * ALREADY been verified. ***
 * ===========================================================================================
 *
 * IF YOU ARE ADDING A SECOND AUDIT FEED AND REACHING FOR THIS DIRECTLY, you are not reusing the
 * anchor format — **you are skipping the signature and binding checks**, and the skip looks like
 * reuse from where you are standing. Call `dependencies.cursors.decode(cursor, binding, nowMs)`
 * and pass ITS output here, which is what the one existing caller does.
 *
 * What the codec establishes and this function cannot: that the cursor was signed by this build's
 * key, has not expired, was issued to THIS operator, was issued for THIS page size, and was issued
 * for THIS query — `PlatformCursorBinding.scope`, whose absence would let page 2 of one filter
 * resume from a position in another, **with no error and a plausible-looking page**. A raw request
 * string has none of that, and nothing below this comment can tell the difference.
 *
 * IT WAS MODULE-PRIVATE UNTIL 29b2f3e, AND THE PRIVACY WAS DOING THIS JOB — the language made the
 * wrong call impossible, so no test ever had to assert it. It was exported so `packages/testing`
 * can assert `decodeAuditAnchor(encodeAuditAnchor(record))` round-trips, which is the class of
 * defect that shipped once here: encode and decode disagreed about the separator, typecheck was
 * clean, the suite was green, and only a request for page 2 found it. **The export bought a
 * detector and spent a guarantee. This comment is all that replaces the guarantee.**
 */
export function decodeAuditAnchor(anchor: string): PlatformAuditAnchor | null {
  const parts = anchor.split(String.fromCharCode(0));
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { occurredAt: parts[0], actionRecordId: parts[1] };
}

/**
 * `action_id` is a route identifier — dotted, not the `{8,64}` platform identifier grammar — so it
 * needs its own check rather than `readIdentifierParameter`.
 *
 * IT IS NOT VALIDATED AGAINST THE ROUTE TABLE, deliberately. A filter naming an operation that does
 * not exist returns an empty feed, which is TRUE; refusing it would make this parameter an oracle
 * for which operations the build knows about, and the log legitimately contains identifiers from
 * older builds whose routes have since been removed.
 */
const ACTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u;

// =============================================================================================
// THE BOUNDED TIME WINDOW. `platform-audit-read-v1`, and it is a COST control before it is a
// conformance one.
// =============================================================================================

/**
 * *** DERIVED HERE, NOT COPIED FROM THE CONSOLE. ***
 *
 * The console enforces the same span and holds its own constant. **The number exists in two
 * places by necessity — a client cannot refuse what it cannot measure — and the two are bound by
 * `qa-agent` rather than by one importing the other**, because Core must not depend on a client
 * and a client must not be the authority on a server-side limit.
 *
 * ===========================================================================================
 * THE DERIVATION, SO THE NEXT PERSON CAN RE-DERIVE RATHER THAN RE-MEASURE
 * ===========================================================================================
 *
 * **A WINDOW'S ROW COUNT IS BOUNDED BY THE WRITE CEILING THAT PRODUCED IT.**
 * `PER_PRINCIPAL_DAILY_ROW_WRITES` is 600 and a record costs `PLATFORM_OPERATOR_ACTION_ROW_WRITES`,
 * so one operator cannot produce more than `600 / cost` records in a UTC day. A D-day window
 * therefore contains at most `operators × that × D` records, **whatever the table's total size.**
 *
 * At two operators and 31 days that is ~18,600 rows per request against 5,000,000 rows-read/day —
 * about 268 such requests a day in the worst case, where the UNBOUNDED form measured 49 and caused
 * an account-wide outage.
 *
 * *** THE SPAN SCALES WITH THE OPERATOR POPULATION AND THIS NUMBER MUST MOVE WITH IT. *** At ten
 * operators, 31 days is ~93,000 rows and ~53 requests a day — **worse than the figure that produced
 * the original finding.** Thirty-one days is correct for one or two operators and WRONG FOR TEN.
 * Contract `PA-4`.
 *
 * **NOTE THAT `0016` HALVED THE DERIVED CAP WITHOUT ANYONE EDITING THIS NUMBER**: a record cost 2
 * row-writes when the arithmetic above was written and costs 4 now, so one operator's ceiling fell
 * from 300 records a day to 150 and the 31-day worst case with it. The constant is unchanged and
 * the bound it buys got safer — which is why the derivation is written down instead of the answer.
 */
const AUDIT_WINDOW_MAX_DAYS = 31;
const AUDIT_WINDOW_MAX_MS = AUDIT_WINDOW_MAX_DAYS * 24 * 60 * 60 * 1000;

/**
 * ===========================================================================================
 * IS A WINDOW REQUIRED FOR THIS REQUEST? THE RULE IS PER-FILTER, NOT PER-ROUTE.
 * ===========================================================================================
 *
 * *** "FILTERED VERSUS UNFILTERED" IS THE WRONG AXIS AND IT IS THE OBVIOUS ONE. *** The question
 * is whether a filter is **served by an index prefix** or **tested row by row**:
 *
 *   A FILTER SERVED BY AN INDEX PREFIX IS A SEEK.
 *   A FILTER NOT SERVED BY ONE IS A TEST APPLIED TO EVERY ROW THE WALK PASSES.
 *
 * Only the second needs a bound on how many rows are walked. `0016` gave the log two indexes —
 * `(occurred_at, action_record_id)` and `(target_organization_id, occurred_at, action_record_id)` —
 * so `organization_id` is a seek and everything else is a test.
 *
 * `0016` gave the log two indexes, and **`organization_id` is a PATH parameter served by the second
 * one's prefix — a seek.** Every QUERY filter on either feed is a test: neither
 * `actor_principal_id` nor `action_id` appears in either index's prefix.
 *
 * *** SO THE RULE IS ROUTE-INDEPENDENT: A WINDOW IS REQUIRED WHENEVER `actor_principal_id` OR
 * `action_id` IS PRESENT, ON EITHER FEED. *** Not otherwise — an unfiltered walk in index order
 * stops after one page whatever the log's size, so a window there removes no reads and removes an
 * operator's ability to ask *"what happened, ever"*.
 *
 * ===========================================================================================
 * THIS FUNCTION TOOK A `routeId` UNTIL 2026-09-07, AND REMOVING IT CHANGED NO BEHAVIOUR
 * ===========================================================================================
 *
 * *** SAID PLAINLY BECAUSE THE FIRST VERSION OF THIS COMMENT CLAIMED OTHERWISE. *** It said the
 * per-route branch had exempted the Organization feed filtered by an operator, and that the shape
 * was live. **It is not: `actor_principal_id` is not among that route's declared query parameters**
 * — checked against `platformRoutes()` rather than by reading the file, after a chain of three
 * agents disagreed about it and the two who read source were both wrong.
 *
 * So on that feed `actorPrincipalId` is always `null`, the term below is unreachable there, and the
 * simplification is a simplification rather than a fix.
 *
 * **THE REASON TO STATE THE RULE AS A PROPERTY SURVIVES ANYWAY, AND IS THE POINT.** A route name in
 * this conditional is a claim about which filters an index prefix serves, written in the one place
 * that cannot see either. Quantifying over FILTERS puts the rule where the facts are: if a future
 * migration adds an index whose prefix serves one of these columns, or a route gains a parameter,
 * the answer follows without editing this function — and **a route acquiring `actor_principal_id`
 * tomorrow is already covered instead of silently exempt.**
 *
 * WHAT THE EPISODE ACTUALLY DEMONSTRATED, since the original claim did not hold: **an enumeration
 * has to be re-derived every time the route table moves, and nobody is assigned to do that.** The
 * property does not.
 *
 * **THE SPAN LIMIT APPLIES ONLY WHERE THE WINDOW IS REQUIRED**, confirmed as a ruling by the Team
 * Lead: refusing a 90-day UNFILTERED window would refuse something cheaper than the no-window
 * request the contract explicitly permits.
 */
function auditWindowIsRequired(input: {
  readonly actorPrincipalId: string | null;
  readonly actionId: string | null;
}): boolean {
  return input.actionId !== null || input.actorPrincipalId !== null;
}

/**
 * *** REFUSE. NEVER DEFAULT, NEVER TRUNCATE, NEVER NARROW SILENTLY. ***
 *
 * On an evidence surface a quietly narrowed window is a feed that HIDES RECORDS: an investigator
 * asking *"has this operator touched anything"* over what they believe is all time would receive an
 * empty page and conclude nothing happened. **A refusal is visible and an omission is not**, and
 * that asymmetry decides it — the cost of refusing is an operator typing two dates, and the cost of
 * defaulting is a false negative in an investigation.
 *
 * THE THREE TOKENS ARE THE CONTRACT'S, and the console already switches on all three
 * (`platform/admin/src/api/audit-window.ts`). `time_window_inverted` REPLACED Core's own
 * `must_be_after_since`, which no contract published — the divergence direction where a client can
 * only learn the token by reading the code.
 */
function enforceAuditWindow(input: {
  readonly actorPrincipalId: string | null;
  readonly actionId: string | null;
  readonly since: string | null;
  readonly until: string | null;
}): Result<void> {
  const { since, until } = input;

  // ---- INVERTED, CHECKED WHENEVER BOTH BOUNDS ARE PRESENT, required or not.
  //
  // An incoherent question is refused rather than answered with an empty page. "No records" on an
  // audit feed is a statement a caller may act on: it must mean "nothing happened", never "you
  // asked incoherently".
  if (since !== null && until !== null && since >= until) {
    return err(invalidArgument([detail('until', 'time_window_inverted')]));
  }

  if (!auditWindowIsRequired(input)) {
    return ok(undefined);
  }

  // ---- BOTH BOUNDS OR NEITHER. **HALF A WINDOW IS AN UNBOUNDED WALK IN ONE DIRECTION**, which is
  // the thing being bounded, so `since` alone is refused exactly as no window at all is.
  const missing: ErrorDetail[] = [];
  if (since === null) missing.push(detail('since', 'time_window_required'));
  if (until === null) missing.push(detail('until', 'time_window_required'));
  if (missing.length > 0) {
    return err(invalidArgument(missing));
  }

  // ---- THE SPAN. `since` and `until` are already validated as fixed-width RFC 3339 UTC by
  // `readInstantParameter`, so `Date.parse` cannot return NaN here — and the guard below is
  // written anyway rather than asserted, because a future change to that reader would otherwise
  // turn a malformed bound into an accepted unbounded window.
  const sinceMs = Date.parse(since as string);
  const untilMs = Date.parse(until as string);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    return err(invalidArgument([detail('since', 'time_window_required')]));
  }

  // AT MOST, NOT LESS THAN. **31 days exactly is accepted and 32 is refused** — the boundary is
  // the assertion the contract's QA list asks for, so it is the comparison written here rather
  // than a strict inequality that would refuse the documented maximum.
  if (untilMs - sinceMs > AUDIT_WINDOW_MAX_MS) {
    return err(invalidArgument([detail('until', 'time_window_too_wide')]));
  }

  return ok(undefined);
}

function readActionIdParameter(query: ReadonlyMap<string, string>): Result<string | null> {
  const raw = query.get('action_id');
  if (raw === undefined) {
    return ok(null);
  }
  if (raw.length > 120 || !ACTION_ID_PATTERN.test(raw)) {
    return err(invalidArgument([detail('action_id', 'must_be_an_action_identifier')]));
  }
  return ok(raw);
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
  // THE SAME CHECK THE LOGIN PATH USES, imported rather than restated. Two definitions of "an
  // enrollable identifier" would agree until one was touched, and the divergence would present as
  // an account that can be created and cannot log in.
  //
  // `checkIdentifier` RETURNS THE BRAND, so the check and the value it licenses are one expression.
  // `OnboardingInput.adminIdentifier` is a `CheckedIdentifier`, so **this function cannot return a
  // value it did not check** — the `as string` cast that used to sit at the bottom of this
  // function is gone, and with it the gap between "we validated" and "we passed on the thing we
  // validated".
  const checkedIdentifier =
    typeof adminIdentifier === 'string' ? checkIdentifier(adminIdentifier) : null;
  if (checkedIdentifier === null) {
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
  // `checkedIdentifier === null` IS REDUNDANT WITH `details.length > 0` AND IS WRITTEN ANYWAY.
  //
  // A null identifier always pushed a detail, so the two conditions are equivalent and the
  // behaviour is identical. **The compiler cannot see that**, and the alternative was a cast at
  // the return — which is precisely what a brand exists to remove. **Stating the invariant is
  // cheaper than asserting it**, and if a future edit ever stops pushing that detail, this line
  // keeps the function honest instead of shipping an unchecked identifier.
  // ---- `display_name`: OPTIONAL, AND ABSENT IS NOT THE SAME AS EMPTY.
  //
  // *** THE ROUTE DID NOT DECLARE THIS FIELD UNTIL 2026-09-07 WHILE THE CONTRACT PUBLISHED IT, SO A
  // CLIENT THAT TRUSTED THE CONTRACT FAILED EVERY ONBOARDING BEFORE AUTHENTICATION. *** See the
  // route entry. **Optional never meant unaccepted.**
  //
  // WHEN PRESENT IT IS CHECKED BY THE SAME FUNCTION THE UPDATE ROUTE USES, imported rather than
  // restated — two definitions of "an acceptable Organization name" would agree until one was
  // touched, and the divergence would be a name that can be set and cannot be re-set.
  //
  // WHEN ABSENT NOTHING IS SYNTHESISED. The row is created with NULL, which is the state the
  // Organizations predating `0015` are in, and the update route is how it stops being null. `0031`:
  // an invented name is indistinguishable from an operator's, forever.
  let displayName: string | undefined;
  if (body.display_name !== undefined) {
    const checked = checkDisplayName(body.display_name, 'display_name');
    if (!checked.ok) {
      // ITS DETAIL JOINS THE OTHERS RATHER THAN RETURNING EARLY, so a request with two bad fields
      // is told about both — the property every other field on this route already has.
      details.push(detail('display_name', 'must_be_a_display_name'));
    } else {
      displayName = checked.value;
    }
  }

  if (details.length > 0 || checkedIdentifier === null) {
    return err(invalidArgument(details));
  }
  return ok({
    // NO CAST. `checkedIdentifier` is non-null here because `details` is empty, and it carries the
    // brand because `checkIdentifier` minted it. The other three keep their casts because their
    // checks are still predicates — **and that contrast is the argument for the brand**: three
    // fields where the type says "trust me" and one where it does not have to.
    adminIdentifier: checkedIdentifier,
    // ABSENT STAYS ABSENT. `displayName` is `undefined` when the caller omitted the field, and the
    // service writes NULL rather than a value it made up.
    displayName,
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

/**
 * The operator roster. `platform-operators-v1`.
 *
 * *** THREE FIELDS PER ROW AND NOTHING ELSE, AND THE ABSENCES ARE LOAD-BEARING. *** No identifier,
 * no email, no display name, no last-seen. `0001_principal.sql` refused an email column because
 * *"a directory of every user's personal details, readable without any tenant scope, would be the
 * highest-value target in the system"* — **an operator roster showing email addresses would be
 * that directory at the most privileged end of the platform.**
 *
 * THE PORT CANNOT SUPPLY ONE EITHER. `PlatformOperatorSummary` has no field for it, so this
 * handler could not leak one if it tried; the guarantee is in the type rather than in this
 * function's restraint.
 *
 * THE CONSEQUENCE IS REAL AND IS `OP-3` RATHER THAN A DEFECT HERE: the console shows 22-character
 * opaque identifiers and **an operator cannot tell colleagues apart on screen.** They recognise
 * themselves by matching against `whoami`. The fix is display names, wherever those land.
 *
 * NO `not_found`. An empty roster is impossible in practice — a caller who reached this route is
 * in it — and returns `200` with `data: []` if it ever occurs, because an empty list is a fact
 * rather than an error.
 */
function listOperators(dependencies: {
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
    const binding = {
      principalId: context.authority.principalId,
      pageSize: pageSize.value,
      // NO FILTERS ON THIS ROUTE, so the route id alone identifies the query. If a filter is ever
      // added it must join this string — see `PlatformCursorBinding.scope`, where the failure a
      // missing filter causes is a wrong page rather than an error.
      scope: 'platform.operators.list',
    };
    const nowMs = dependencies.clock.nowMs();
    let anchor: string | null = null;
    if (offered.value !== null) {
      const decoded = await dependencies.cursors.decode(offered.value, binding, nowMs);
      if (!decoded.ok) {
        return err(decoded.error);
      }
      anchor = decoded.value;
    }

    // ONE EXTRA ROW to decide `next_cursor` without a second query or a COUNT.
    const found = await dependencies.store.listOperators(pageSize.value + 1, anchor);
    if (!found.ok) {
      return err(found.error);
    }
    const hasMore = found.value.length > pageSize.value;
    const page = hasMore ? found.value.slice(0, pageSize.value) : found.value;
    const last = page[page.length - 1];

    return ok({
      body: {
        data: page.map((operator) => ({
          principal_id: operator.principalId,
          platform_role: operator.platformRole,
          created_at: operator.createdAt,
        })),
        next_cursor:
          hasMore && last !== undefined
            ? await dependencies.cursors.encode(last.principalId, binding, nowMs)
            : null,
      },
      // NO TARGET. An enumeration names no single affected party, and `0025` Decision 5 permits
      // only an Organization or a principal — this route names neither.
      //
      // *** IT DOES NOT NAME THE OPERATORS IT RETURNED, AND THAT IS DELIBERATE. *** A record
      // listing them would put the roster INTO the operator log, where the audit feeds would then
      // disclose it — `0028` Decision 3's shape, arriving through the target field.
      target: NO_TARGET,
    });
  };
}

/**
 * ===========================================================================================
 * REVOKE PLATFORM AUTHORITY. `platform-operators-v1`. **THE FIRST GATED ROUTE IN DUDO.**
 * ===========================================================================================
 *
 * *** THIS HANDLER RUNS ONLY AFTER THE CONFIRMATION GATE HAS PASSED, AND IT DOES NOT CHECK THAT.
 * *** `dispatchPlatformRoute` step 5b enforces it for every route whose permission is critical, and
 * this one cannot opt out — the requirement derives from the permission, not from anything written
 * here. **A handler that checked would be a second place the requirement lives.**
 *
 * WHAT THE GATE PROVED BEFORE THIS FUNCTION WAS CALLED: the caller re-authenticated as themselves,
 * and the confirmation was minted for **this principal, this session, this action, and these
 * parameters — which now include the `principal_id` path segment.** So a confirmation obtained to
 * revoke operator A cannot be spent here on operator B.
 *
 * ===========================================================================================
 * THE `not_found` COLLAPSE, AND WHAT IS DELIBERATELY *NOT* COLLAPSED WITH IT
 * ===========================================================================================
 *
 * **THREE CASES, ONE 404**: an unknown principal, a principal who is a TENANT MEMBER, and a
 * principal who is not (or is no longer) an operator. Distinguishing them would make this route an
 * oracle for **which principals hold platform authority and which hold memberships**.
 *
 * **`failed_precondition` IS NOT PART OF THAT COLLAPSE AND THAT IS DELIBERATE.** It is returned
 * when the revocation would leave zero operators and the target is not the caller — *"the caller
 * IS authorized and the platform's state is what refuses"*, and it discloses only that at least one
 * operator exists, **which the caller already knows, being one.** There is no population to protect
 * here: a caller who reaches this route may already list every operator.
 *
 * REVOKING AN ALREADY-REVOKED OPERATOR IS A 404, NOT A 200. The row is gone, so the target is not
 * an operator. **A client must not treat that as an error worth retrying** — the desired state has
 * been reached, and a console should say so rather than reporting a failure.
 */
/**
 * ===========================================================================================
 * SET AN ORGANIZATION'S NAME AND ITS TWO REGISTRATIONS. `organization-identity-v1`, `0031`.
 * ===========================================================================================
 *
 * *** IT IS THE FIRST ROUTE IN THIS CLASS THAT WRITES INTO A CUSTOMER'S TENANT DATABASE FOR A
 * MUTATION RATHER THAN FOR A PROBE, AND THAT WRITE IS PART OF WHAT THE PERMISSION AUTHORISES. ***
 *
 * The user granted `core.platform-organization.update` having been told it adds *"no new tenant
 * reach, no new data access"*. **That is exactly true of reads and it is not the whole story**: on
 * every successful call this appends one `audit_event` to the named Organization, five row-writes
 * from that Organization's own daily allocation. Said here because the approval did not say it.
 *
 * IT IS *FOR* THE CUSTOMER RATHER THAN AT THEIR EXPENSE. `0028` requires a tenant to be able to
 * see what the platform did to them, and this is the clearest case the surface has: **a platform
 * operator editing a customer's legal identifiers, which the customer cannot see any other way**,
 * because `organization` is a control-plane table and no Action can reach it (`OI-1`).
 *
 * ---------------------------------------------------------------------------------------------
 * THE ORDER OF THE FIVE STEPS, AND WHY IT IS THIS ORDER
 * ---------------------------------------------------------------------------------------------
 *
 *   1. PARSE — nothing is read from storage for a request that cannot be satisfied.
 *   2. READ the stored block. `null` is the 404, and it is what establishes existence for step 4.
 *   3. RESERVE the control-plane write. An exhausted operator is refused BEFORE anything is
 *      written, in either database.
 *   4. WRITE the thirteen columns, from one union value.
 *   5. APPEND the tenant record. **LAST, and its failure fails the request.**
 *
 * *** STEP 5 IS AFTER STEP 4 AND THE OPPOSITE OF THE AUDIT-FEED ORDER, DELIBERATELY. *** The feed
 * writes its tenant record BEFORE serving, because there an unwritable record must refuse the read
 * — `0013` D2, inability to record the evidence is not a reason to proceed without it. Here the
 * evidence is of a change that has already happened, and a record written before the write would
 * claim an edit that might not land. **So the two orders are opposite and both are right, which is
 * exactly the kind of thing that gets "tidied" into consistency by someone who has not read this.**
 *
 * THE COST OF THAT CHOICE, STATED: if the tenant append fails, the columns are already changed and
 * the caller is told the operation failed. The customer's trail then lacks a record of a change
 * that happened — which is the same exposure `revokeOperator` carries and is reported the same way.
 * Closing it needs one transaction across two databases, which D1 does not offer.
 */
function updateOrganizationIdentity(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly members: MemberResolutionService | undefined;
  readonly admission: ControlPlaneWriteAdmission;
  readonly clock: Clock;
}) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const organizationId = context.pathParams.organization_id;
    if (organizationId === undefined) {
      return err(internal());
    }
    if (dependencies.members === undefined) {
      // ABSENT MEANS REFUSED, exactly as the scoped feed does. A deployment that cannot write the
      // tenant-side record must not serve this route, because that record is the control rather
      // than a by-product.
      return err(unavailable());
    }

    // ---- 1. PARSE.
    const update = parseOrganizationIdentityUpdate({
      displayName: body.display_name,
      commercialRegistration: context.objects.commercial_registration,
      vatRegistration: context.objects.vat_registration,
    });
    if (!update.ok) {
      return err(update.error);
    }

    // ---- 2. READ. `null` is the argument-free 404.
    //
    // THE 404 IS ARGUMENT-FREE AND THAT IS SCOPED TO THIS CLASS: every caller who can reach this
    // route can already enumerate every Organization, so distinguishing "no such Organization"
    // discloses nothing they could not obtain from `platform.organizations.list`. **Do not copy
    // this reasoning to a route a tenant principal can reach.**
    const stored = await dependencies.store.findOrganizationIdentity(organizationId);
    if (!stored.ok) {
      return err(stored.error);
    }
    if (stored.value === null) {
      return err(notFound());
    }

    const nowMs = dependencies.clock.nowMs();
    const next = applyIdentityUpdate(stored.value, update.value, {
      nowIso: toRfc3339Utc(nowMs),
      // SERVER-DERIVED. A verification names the AUTHENTICATED operator; there is no body field
      // that could influence it, which is what makes the provenance provenance.
      actorPrincipalId: context.authority.principalId,
    });

    // ---- 3. RESERVE, before either write.
    const admitted = await dependencies.admission.reserve({
      principalId: context.authority.principalId,
      estimatedRowWrites: ORGANIZATION_UPDATE_ROW_WRITES,
      nowMs,
    });
    if (!admitted.ok) {
      return err(admitted.error);
    }
    if (admitted.value.kind === 'deferred') {
      return err(quotaExceeded());
    }

    // ---- 4. WRITE.
    const written = await dependencies.store.updateOrganizationIdentity(
      organizationId,
      next,
      admitted.value.reservation,
    );
    if (!written.ok) {
      return err(written.error);
    }

    // ---- 5. APPEND THE TENANT RECORD. See the header for why this is last.
    const recorded = await dependencies.members.recordOrganizationAccess({
      organizationId,
      actionId: 'platform.organizations.identity.update',
      actorPrincipalId: context.authority.principalId,
      permissionId: 'core.platform-organization.update',
      // THE FIELDS, NEVER THE VALUES. `audit.ts` has nowhere to put a value and must not acquire
      // one: the record says `vat_registration` changed and never says from what. For a field
      // whose point is legal provenance that is a real limit (`OI-2`), and the answer if it is
      // ever needed is value history on the record rather than a wider audit row.
      changedFieldNames: changedIdentityFieldNames(update.value),
      // REQUIRED. Step 4b charged the operator before this handler ran, so an exhausted operator
      // cannot keep spending a customer's allocation.
      charge: context.charge,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
    if (!recorded.ok) {
      return err(recorded.error);
    }

    return ok({
      // THE WHOLE BLOCK, NOT THE FIELDS THAT WERE SENT. A console applying a partial response to
      // local state has to guess what the server did with the fields it omitted; a whole block
      // cannot be guessed wrong. **It also shows the operator the consequence they are least
      // likely to expect — that editing a number cleared its verification.**
      body: toIdentityOutput(written.value),
      target: { kind: 'organization', organizationId },
    });
  };
}

function revokeOperator(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly admission: ControlPlaneWriteAdmission;
  readonly clock: Clock;
}) {
  return async (context: PlatformRouteContext): Promise<Result<PlatformRouteOutcome>> => {
    const principalId = context.pathParams.principal_id;
    if (principalId === undefined) {
      return err(internal());
    }

    // ---- SELF-REVOCATION IS THIS ROUTE, WITH THE CALLER'S OWN IDENTIFIER. There is no separate
    // path, because *"a second route would be a second place the bounds are implemented."*
    const isSelfRevocation = principalId === context.authority.principalId;

    // ---- THE TARGET MUST BE AN OPERATOR, ASKED BEFORE THE WRITE. This is what lets the route
    // separate `not_found` from `failed_precondition` — the store's conditional delete cannot,
    // because a statement that reported WHICH condition failed would be the oracle the collapse
    // closes.
    const target = await dependencies.store.findOperator(principalId);
    if (!target.ok) {
      return err(target.error);
    }
    if (target.value === null) {
      return err(notFound());
    }

    const nowMs = dependencies.clock.nowMs();
    const admitted = await dependencies.admission.reserve({
      principalId: context.authority.principalId,
      estimatedRowWrites: PLATFORM_OPERATOR_ROW_WRITES,
      nowMs,
    });
    if (!admitted.ok) {
      return err(admitted.error);
    }
    if (admitted.value.kind === 'deferred') {
      return err(quotaExceeded());
    }

    const revoked = await dependencies.store.revokeOperator(
      principalId,
      isSelfRevocation,
      admitted.value.reservation,
    );
    if (!revoked.ok) {
      return err(revoked.error);
    }
    if (revoked.value === null) {
      // THE TARGET WAS AN OPERATOR A MOMENT AGO AND THE DELETE DID NOT HAPPEN. Two causes, and
      // they are told apart by what we already know: the precondition is the only thing that could
      // have refused, because `findOperator` just said the row existed.
      //
      // *** THE RACE IS REAL AND FALLS THE SAFE WAY. *** Another operator may have revoked this
      // target between the read and the write, in which case this is a `not_found` reported as
      // `failed_precondition`. **The wrong error, never a wrong outcome** — and the alternative,
      // reporting `not_found`, would hide a genuine last-operator refusal as a missing row.
      return err(failedPrecondition());
    }

    return ok({
      body: {
        principal_id: principalId,
        was_self: isSelfRevocation,
        remaining_operator_count: revoked.value.remainingOperatorCount,
      },
      // THE PRINCIPAL WHOSE AUTHORITY WAS REMOVED, IN NO ORGANIZATION.
      //
      // `organizationId: null` IS A POSITIVE STATEMENT, not an omission: platform authority was
      // never scoped to an Organization, so a revocation happens in none. **The record therefore
      // appears in the platform feed and in no Organization feed**, which is correct — no
      // customer's trail should carry it.
      //
      // *** IT IS NOT `NO_TARGET`, AND THAT MATTERED ENOUGH TO WIDEN A TYPE I TIGHTENED THIS
      // MORNING. *** `PlatformActionTarget`'s principal variant required a non-null Organization,
      // which left only `NO_TARGET` here — **and that would have recorded the platform's most
      // security-relevant operation with no target at all.** `0025` Decision 5: the log records
      // "which operator did what, to which Organization or principal".
      target: { kind: 'principal', principalId, organizationId: null },
    });
  };
}

/**
 * Credential reset. `credential-reset-v1`. **The second gated route.**
 *
 * THIN, LIKE THE OTHERS, AND FOR THE SAME REASON: everything that touches a tenant store lives in
 * `credential/`, outside this directory. This function names no resolver and no store handle.
 *
 * IT DOES NOT CHECK THE CONFIRMATION. Step 5b did, for this route as for revoke, and a handler
 * that checked would be a second place the requirement lives.
 *
 * **NO CREDENTIAL IN THE RESPONSE.** The server never held one — the console generated the
 * password, derived from it with the TARGET's identifier as salt, and still holds the only copy.
 */
function resetCredential(dependencies: { readonly reset: CredentialResetService }) {
  return async (
    context: PlatformRouteContext,
    body: PreAuthBody,
  ): Promise<Result<PlatformRouteOutcome>> => {
    const principalId = body.principal_id;
    const targetIdentifier = body.target_identifier;
    const derivedValue = body.derived_value;

    const details: ErrorDetail[] = [];
    if (typeof principalId !== 'string' || !IDENTIFIER_PATTERN.test(principalId)) {
      details.push(detail('principal_id', 'must_be_an_identifier'));
    }
    // `checkIdentifier` MINTS THE BRAND, so the service cannot be handed an unchecked value. The
    // check and the value it licenses are one expression.
    const checkedTarget =
      typeof targetIdentifier === 'string' ? checkIdentifier(targetIdentifier) : null;
    if (checkedTarget === null) {
      details.push(detail('target_identifier', 'must_be_a_submittable_identifier'));
    }
    if (typeof derivedValue !== 'string' || !DERIVED_VALUE_PATTERN.test(derivedValue)) {
      details.push(detail('derived_value', 'must_be_32_bytes_base64url'));
    }
    if (details.length > 0 || checkedTarget === null) {
      return err(invalidArgument(details));
    }

    const outcome = await dependencies.reset.reset({
      principalId: principalId as string,
      targetIdentifier: checkedTarget,
      derivedValue: derivedValue as string,
      actorPrincipalId: context.authority.principalId,
      charge: context.charge,
      requestId: context.requestId,
      correlationId: context.correlationId,
    });
    if (!outcome.ok) {
      return err(outcome.error);
    }

    return ok({
      body: {
        principal_id: outcome.value.principalId,
        revoked_session_count: outcome.value.revokedSessionCount,
        notified_organization_count: outcome.value.notifiedOrganizationCount,
      },
      // THE TARGET PRINCIPAL, IN NO ORGANIZATION. A credential is a control-plane object and the
      // reset is not scoped to a tenant — the per-Organization records are written separately, one
      // per membership, into each customer's own trail.
      target: {
        kind: 'principal',
        principalId: outcome.value.principalId,
        organizationId: null,
      },
    });
  };
}

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
    const binding = {
      principalId: context.authority.principalId,
      pageSize: pageSize.value,
      scope: 'platform.templates.list',
    };
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
  /**
   * The credential reset. REQUIRED — there is no degraded mode for the route that recovers a
   * locked-out account, and an optional dependency would make it answer `unavailable` in a
   * deployment that forgot it, indistinguishable from an outage.
   */
  readonly reset: CredentialResetService;
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
    'platform.credentials.reset': resetCredential({ reset: dependencies.reset }),
    'platform.organizations.identity.update': updateOrganizationIdentity({
      store: dependencies.store,
      members: dependencies.members,
      admission: dependencies.admission,
      clock: dependencies.clock,
    }),
    'platform.operators.revoke': revokeOperator({
      store: dependencies.store,
      admission: dependencies.admission,
      clock: dependencies.clock,
    }),
    'platform.operators.list': listOperators({
      store: dependencies.store,
      cursors: dependencies.cursors,
      clock: dependencies.clock,
    }),
    'platform.audit.list': listAuditFeed({
      store: dependencies.store,
      cursors: dependencies.cursors,
      clock: dependencies.clock,
    }),
    'platform.organizations.audit.list': listAuditFeed({
      store: dependencies.store,
      cursors: dependencies.cursors,
      clock: dependencies.clock,
      // ONLY THE SCOPED FEED RECEIVES IT. The platform feed writes no tenant-side record and has
      // no Organization to write one into — so it is not given the ability, rather than given it
      // and trusted not to use it.
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
