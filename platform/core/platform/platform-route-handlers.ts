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
import { detail, internal, invalidArgument } from '../kernel/errors.ts';
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

export function createPlatformRouteHandlers(dependencies: {
  readonly store: PlatformOperatorStore;
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
    'platform.session.whoami': whoami(),
  };
  if (dependencies.confirmations !== undefined) {
    handlers['platform.confirmations.request'] = requestConfirmation({
      confirmations: dependencies.confirmations,
    });
  }
  return Object.freeze(handlers) as PlatformRouteHandlers;
}
