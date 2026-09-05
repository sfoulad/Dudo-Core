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
import { internal } from '../kernel/errors.ts';
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
    let anchor: string | null = null;
    if (offered.value !== null) {
      // THE SIGNATURE IS VERIFIED BEFORE THE ANCHOR IS USED, and every failure — malformed,
      // forged, expired, bound to a different page size — returns the one `rejectedCursor()`
      // value. A caller cannot tell which, and there is no branch here that could tell it.
      const decoded = await dependencies.cursors.decode(offered.value, pageSize.value, nowMs);
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
            ? await dependencies.cursors.encode(last.organizationId, pageSize.value, nowMs)
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

export function createPlatformRouteHandlers(dependencies: {
  readonly store: PlatformOperatorStore;
  readonly cursors: PlatformCursorCodec;
  readonly clock: Clock;
}): PlatformRouteHandlers {
  return Object.freeze({
    'platform.organizations.list': listOrganizations(dependencies),
    'platform.session.whoami': whoami(),
  });
}
