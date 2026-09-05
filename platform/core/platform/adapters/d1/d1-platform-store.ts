/**
 * The platform D1 adapter. THE ONLY FILE IN `platform/core/platform/**` THAT NAMES D1.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place a Cloudflare type may be named, and
 * the check is a grep over the domain modules that must come back empty. Nothing D1-shaped leaves
 * this file: it returns `PlatformOperatorStore`, which is a Core type describing records.
 *
 * ===========================================================================================
 * IT TAKES THE **CONTROL-PLANE** BINDING AND THERE IS NO PARAMETER FOR THE TENANT ONE
 * ===========================================================================================
 *
 * Every table this file names — `platform_operator`, `organization_membership`, `organization`,
 * `platform_operator_action` — is a control-plane table, and none of them has a `tenant_id`
 * column. The factory takes ONE database and it is `DB_CONTROL`. There is no overload, no second
 * argument and no code path here that could acquire `DB_TENANT`, so binding property P1 holds
 * structurally rather than by review: THE CLASS CANNOT READ A TENANT ROW BECAUSE IT HAS NOTHING
 * TO READ ONE WITH.
 *
 * THIS FILE MUST NEVER IMPORT `storage/adapters/sql/sql-compiler.ts`, and the reverse is also
 * true — the same prohibition `identity/adapters/d1/d1-control-plane-store.ts` carries. That
 * compiler emits `tenant_id = ?` on every statement it produces, which is exactly right for the
 * tenant database and meaningless here; and compiling a tenant table's statement with the
 * hand-written SQL below would drop the tenant predicate, which is the single defect the whole
 * tenancy model is built to make impossible.
 *
 * ONE GREP, AND `qa-agent` OWES IT: `platform/core/platform/**` must not mention
 * `TenantStoreResolver`, `TenantScopedStore`, `createD1TenantStore`, `TENANT_COLUMN`,
 * `sql-compiler` or `tenant_id`.
 *
 * ===========================================================================================
 * EVERY STATEMENT IS A POINT LOOKUP OR A BOUNDED KEYSET SCAN
 * ===========================================================================================
 *
 * `CLOUDFLARE_STANDARD.md` §4 rule 4: every query is indexed for its access path, because on a
 * single-threaded database one unindexed scan is every Organization's latency. Each statement
 * below names its index in a comment, and every one of them is served by a PRIMARY KEY that the
 * migrations already create — this adapter adds no index and needs none.
 */

import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { internal, unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import type { ControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import { consumeControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import { toPlatformRole } from '../../platform-permissions.ts';
import type {
  PlatformOperatorActionRecord,
  PlatformOperatorRecord,
  PlatformOperatorStore,
  PlatformOrganizationRecord,
  PlatformOrganizationStatus,
} from '../../platform-operator-store.ts';

type SqlRow = Record<string, unknown>;

async function selectRows(
  database: D1Database,
  sql: string,
  parameters: readonly unknown[],
): Promise<Result<readonly SqlRow[]>> {
  try {
    const outcome = await database
      .prepare(sql)
      .bind(...parameters)
      .all<SqlRow>();
    return ok(outcome.results);
  } catch {
    // The engine is down or the statement failed. The caller learns neither which — the same
    // treatment `d1-store.ts` and `d1-control-plane-store.ts` give a failed query.
    return err(unavailable());
  }
}

function text(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

function requiredText(row: SqlRow, column: string): string | null {
  const value = text(row, column);
  return value === null || value === '' ? null : value;
}

const ORGANIZATION_STATUSES: readonly PlatformOrganizationStatus[] = ['active', 'suspended'];

/**
 * Stored enumerations are VALIDATED ON READ, and an unrecognised value is `internal()` rather than
 * a coerced default — the same rule `d1-control-plane-store.ts` applies, for the same reason:
 * mapping an unknown status to `'active'` would be a privilege change caused by schema drift, and
 * mapping it silently to `'suspended'` would hide the drift.
 *
 * `platform_role` IS THE ONE EXCEPTION AND IT IS DELIBERATE. See `findOperator`.
 */
function organizationStatus(row: SqlRow): PlatformOrganizationStatus | null {
  const value = text(row, 'status');
  if (value === null) {
    return null;
  }
  return ORGANIZATION_STATUSES.includes(value as PlatformOrganizationStatus)
    ? (value as PlatformOrganizationStatus)
    : null;
}

/**
 * Builds the platform store over the CONTROL-PLANE binding.
 *
 * NOT EXPORTED FOR GENERAL USE. An App never sees this factory's argument, because an App never
 * sees a binding — the same position it is already in with respect to `createD1TenantStore` and
 * `createD1ControlPlaneStores`.
 */
export function createD1PlatformStore(database: D1Database): PlatformOperatorStore {
  return {
    async findOperator(principalId: string): Promise<Result<PlatformOperatorRecord | null>> {
      // Point lookup on the primary key of `platform_operator`.
      const rows = await selectRows(
        database,
        'SELECT principal_id, platform_role, created_at FROM platform_operator ' +
          'WHERE principal_id = ? LIMIT 1',
        [principalId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      if (rows.value.length === 0) {
        return ok(null);
      }
      const row = rows.value[0];
      const id = requiredText(row, 'principal_id');
      const createdAt = requiredText(row, 'created_at');
      if (id === null || createdAt === null) {
        return err(internal());
      }
      return ok({
        principalId: id,
        // AN UNRECOGNISED ROLE COLLAPSES TO `null`, WHICH DENIES — it is NOT reported as
        // `internal()` like the other stored enumerations in this file. The distinction is the
        // same one `d1-control-plane-store.ts` makes for `MembershipRole` and
        // `d1-credential-store.ts` for a credential algorithm: a value a FUTURE migration
        // introduces must fail onto the SAFE path, so a build older than its data denies rather
        // than erroring. Failing loudly here would turn a routine mid-migration state into an
        // outage, and would do it for the platform's own operators — the people who would then
        // have to fix it.
        platformRole: toPlatformRole(text(row, 'platform_role')),
        createdAt,
      });
    },

    async principalHasAnyMembership(principalId: string): Promise<Result<boolean>> {
      // =====================================================================================
      // THE MUTUAL-EXCLUSION PROBE. `0025` decision 1.
      // =====================================================================================
      //
      // A bounded prefix scan on the primary key of `organization_membership`, whose leading
      // column is `principal_id`. `LIMIT 1` makes it a point lookup in cost: the engine stops at
      // the first matching entry.
      //
      // NO `status` FILTER, AND THE ABSENCE IS THE POINT. `0024`'s invariant is that a platform
      // principal holds ZERO memberships — "not a scoped one, not a read-only one, not one just
      // for the tenant being supported". A SUSPENDED MEMBERSHIP STILL COUNTS: it is a row, it can
      // be reactivated by an UPDATE that no trigger and no code path in this repository guards,
      // and a probe that ignored it would let a compliant operator become a violating one with no
      // change to `platform_operator` at all.
      //
      // NOTE HOW THIS DIFFERS FROM `findMembershipWithOrganization`, WHICH DOES FILTER ON
      // `status = 'active'`. That method answers "may this principal ENTER this Organization",
      // where a suspended membership must be indistinguishable from none. This one answers "does
      // this principal appear in the table at all", where it must not be. Same table, opposite
      // treatment, and both are correct for the question being asked.
      //
      // IT SELECTS A CONSTANT AND NOT THE ROW. `SELECT 1` returns no identifier, so this method
      // physically cannot become a way to read a principal's list of Organizations — which is
      // `core-object-registry.yaml` CO1, and the one thing a platform route must never learn.
      const rows = await selectRows(
        database,
        'SELECT 1 AS present FROM organization_membership WHERE principal_id = ? LIMIT 1',
        [principalId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      return ok(rows.value.length > 0);
    },

    async listOrganizations(
      limit: number,
      afterOrganizationId: string | null,
    ): Promise<Result<readonly PlatformOrganizationRecord[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        // A defect in Dudo's code, not a bad request: the class validates `page_size` long before
        // this. `internal()` discloses nothing.
        return err(internal());
      }
      // =====================================================================================
      // KEYSET PAGINATION ON THE PRIMARY KEY OF `organization`. NOT `OFFSET`.
      // =====================================================================================
      //
      // `WHERE organization_id > ?` resumes the index scan strictly after the previous page's
      // last identifier, so page N costs the same as page 1. `OFFSET` reads and discards every
      // earlier row, which on a growing table is a read cost that rises with the page number —
      // and on a single-threaded database that cost is every Organization's latency.
      //
      // THE LIMIT IS INLINED AS A VALIDATED INTEGER, exactly as `sql-compiler.ts` and
      // `listMembershipsForPrincipal` do, so it cannot carry caller-controlled text. The anchor is
      // BOUND as a parameter.
      //
      // ORDERED BY IDENTIFIER AND NOT BY `created_at`. Identifiers are CSPRNG-generated, so the
      // order is arbitrary and stable; ordering by creation time would need an index the schema
      // does not have and would leak the platform's growth curve to anyone paging.
      const sql =
        afterOrganizationId === null
          ? 'SELECT organization_id, status, created_at FROM organization ' +
            `ORDER BY organization_id ASC LIMIT ${String(limit)}`
          : 'SELECT organization_id, status, created_at FROM organization ' +
            `WHERE organization_id > ? ORDER BY organization_id ASC LIMIT ${String(limit)}`;
      const rows = await selectRows(
        database,
        sql,
        afterOrganizationId === null ? [] : [afterOrganizationId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      const organizations: PlatformOrganizationRecord[] = [];
      for (const row of rows.value) {
        const organizationId = requiredText(row, 'organization_id');
        const createdAt = requiredText(row, 'created_at');
        const status = organizationStatus(row);
        if (organizationId === null || createdAt === null || status === null) {
          return err(internal());
        }
        organizations.push({ organizationId, status, createdAt });
      }
      return ok(organizations);
    },

    async recordAction(
      record: PlatformOperatorActionRecord,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      // NO ADMISSION, NO WRITE — `0014` §A.11. It throws rather than returning, exactly as
      // `d1-control-plane-store.ts` does: no client can cause this, because clients supply values
      // and never reservations.
      consumeControlPlaneWriteReservation(reservation, 1);
      try {
        // One statement per batch, matching every other writer in the platform.
        await database.batch([
          database
            .prepare(
              'INSERT INTO platform_operator_action (action_record_id, actor_principal_id, ' +
                'actor_platform_role, action_id, target_kind, target_id, outcome, occurred_at, ' +
                'correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(
              record.actionRecordId,
              record.actorPrincipalId,
              record.actorPlatformRole,
              record.actionId,
              record.targetKind,
              record.targetId,
              record.outcome,
              record.occurredAt,
              record.correlationId,
            ),
        ]);
        return ok(undefined);
      } catch {
        // The caller — `platform-audit.ts` — turns this into a failed operation. It does NOT
        // proceed without the record.
        return err(unavailable());
      }
    },
  };
}
