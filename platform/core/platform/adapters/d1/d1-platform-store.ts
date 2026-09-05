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
import type { MembershipRole } from '../../../authorization/roles.ts';
import type {
  PlatformMemberResolution,
  PlatformOperatorActionRecord,
  PlatformOperatorRecord,
  PlatformOperatorStore,
  PlatformOrganizationDetailRecord,
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

const MEMBERSHIP_ROLES: readonly MembershipRole[] = ['owner', 'member'];

/**
 * The membership role, validated on read. `null` for absent or unrecognised, and the CALLER
 * decides what that means — here it is the same 404 every other refusing case produces.
 *
 * NOT COERCED TO `'member'`. A role this build does not recognise is not a lesser role, it is an
 * unknown one, and `authorization/roles.ts` maps only recognised values to permissions.
 */
function membershipRole(row: SqlRow): MembershipRole | null {
  const value = text(row, 'role');
  if (value === null) {
    return null;
  }
  return MEMBERSHIP_ROLES.includes(value as MembershipRole) ? (value as MembershipRole) : null;
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

    async findOrganizationDetail(
      organizationId: string,
    ): Promise<Result<PlatformOrganizationDetailRecord | null>> {
      // =====================================================================================
      // ONE STATEMENT, NOT TWO. The row and the member count together.
      // =====================================================================================
      //
      // `theOnePageOneRequestRule` shapes the response; this shapes the reads behind it. A
      // correlated scalar subquery costs one round trip against a single-threaded database, and
      // D1 is roughly 1,000 queries/second platform-wide — two statements here would be two.
      //
      // *** THE SUBQUERY IS `COUNT(*)` AND THERE IS NO VARIANT OF THIS STATEMENT THAT SELECTS A
      // principal_id. *** `0028` Decision 1. The count is what the port exposes because the count
      // is what cannot be inverted, and the SQL is written so that widening it to identities would
      // be a visible rewrite rather than an added column.
      //
      // IT COUNTS EVERY MEMBERSHIP ROW REGARDLESS OF STATUS, deliberately, and it is the one place
      // in this file where status is NOT filtered. "How many principals belong to this
      // Organization" is the operator's question — did onboarding work, is this in use, is it
      // abandoned — and a suspended member is still a member for that purpose. Filtering to
      // `active` would make the count disagree with what an owner sees in their own directory.
      const rows = await selectRows(
        database,
        'SELECT o.organization_id, o.status, o.created_at, o.template_id, ' +
          '(SELECT COUNT(*) FROM organization_membership m ' +
          'WHERE m.organization_id = o.organization_id) AS member_count ' +
          'FROM organization o WHERE o.organization_id = ? LIMIT 1',
        [organizationId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      if (rows.value.length === 0) {
        return ok(null);
      }
      const row = rows.value[0];
      const id = requiredText(row, 'organization_id');
      const createdAt = requiredText(row, 'created_at');
      const status = organizationStatus(row);
      const memberCount = row.member_count;
      if (id === null || createdAt === null || status === null) {
        return err(internal());
      }
      if (typeof memberCount !== 'number' || !Number.isInteger(memberCount) || memberCount < 0) {
        // A `COUNT(*)` that is not a non-negative integer means the driver returned something this
        // adapter does not understand. `internal()` rather than a coerced `0`, which would render
        // as "this Organization has no members" — a false statement about a real tenant, on the
        // screen an operator uses to decide whether onboarding worked.
        return err(internal());
      }
      return ok({
        organizationId: id,
        status,
        createdAt,
        // NULL IS A REAL STATE. Organizations predating `0013` have no Template.
        templateId: requiredText(row, 'template_id'),
        memberCount,
      });
    },

    async resolveMemberByIdentifierHash(
      organizationId: string,
      identifierHash: string,
    ): Promise<Result<PlatformMemberResolution | null>> {
      // =====================================================================================
      // *** FIVE REFUSING CASES, ONE STATEMENT, AND THE WORK DOES NOT VARY BETWEEN THEM. ***
      // =====================================================================================
      //
      // `0028` Decision 2 and `organization-detail-v1`'s `notFoundCOLLAPSE`. The five:
      //
      //   1. the Organization does not exist
      //   2. the identifier belongs to nobody
      //   3. the principal exists and is not a member of THIS Organization
      //   4. the membership is suspended
      //   5. *** the principal is a PLATFORM OPERATOR ***
      //
      // SAME ANSWER IS THE EASY HALF. THE SAME WORK IS THE HALF THAT TAKES DESIGN — and it is why
      // this is one join rather than a sequence of lookups with early returns. A version that
      // checked the Organization first and returned would cost one statement for case 1 and three
      // for case 4, which is an Organization-existence oracle measurable with a stopwatch. The
      // device is `findMembershipWithOrganization`'s, which records the same finding: *"the ERROR
      // was already identical; THE WORK WAS NOT, and work is measurable."*
      //
      // ---- CASE 5 IS IN THE STATEMENT AND LOOKS REDUNDANT. IT IS NOT.
      //
      // `NOT EXISTS (SELECT 1 FROM platform_operator ...)`. A platform operator cannot hold a
      // membership — `0024` invariant 1, enforced by triggers and by
      // `createOrganizationWithFirstAdmin`'s in-statement guard — so this subquery can only match
      // a principal that is in BOTH tables, which is a state the platform refuses everywhere.
      //
      // **THAT IS EXACTLY WHY IT IS HERE.** Without it, a principal in both tables resolves, and
      // this route becomes an oracle for who holds platform authority. `platform-authority.ts`
      // already refuses such a principal at authentication; this is the same refusal from the
      // other side, for a principal who is the TARGET rather than the caller. The two are
      // different questions and only one of them is asked above.
      //
      // IT COSTS A CORRELATED SUBQUERY ON A PRIMARY KEY, on a statement that runs anyway.
      //
      // ---- IT JOINS ON `identifier_hash`, WHICH IS A PRIMARY KEY.
      //
      // No scan, no `LIKE`, and no email address anywhere in this adapter. The hash is computed
      // above this port; `0001_principal.sql` refused an email column and that purchase is intact.
      const rows = await selectRows(
        database,
        'SELECT m.principal_id, m.role FROM principal_credential c ' +
          'JOIN organization_membership m ON m.principal_id = c.principal_id ' +
          'JOIN organization o ON o.organization_id = m.organization_id ' +
          'JOIN principal p ON p.principal_id = m.principal_id ' +
          'WHERE c.identifier_hash = ? AND m.organization_id = ? ' +
          "AND m.status = 'active' AND p.status = 'active' " +
          'AND NOT EXISTS (SELECT 1 FROM platform_operator po WHERE po.principal_id = m.principal_id) ' +
          'LIMIT 1',
        [identifierHash, organizationId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      if (rows.value.length === 0) {
        return ok(null);
      }
      const row = rows.value[0];
      const principalId = requiredText(row, 'principal_id');
      const role = membershipRole(row);
      if (principalId === null || role === null) {
        // A NULL OR UNRECOGNISED ROLE IS `null`, WHICH RENDERS AS THE SAME 404 — not `internal()`.
        //
        // `0019`: an unrecognised role "is not an error and not a partial grant — it is deny all,
        // on the same path as an absent membership." A member whose role this build cannot read
        // holds no permissions, so reporting them as resolvable would tell an operator they can
        // reset a credential for a principal the platform cannot authorize. It also keeps the
        // refusal indistinguishable from the other five, which an `internal()` would not.
        return ok(null);
      }
      return ok({ principalId, role });
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
