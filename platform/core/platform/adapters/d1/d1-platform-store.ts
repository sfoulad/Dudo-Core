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
  PlatformActionOutcome,
  PlatformAuditAnchor,
  PlatformAuditFilters,
  PlatformAuditRecord,
  PlatformMemberResolution,
  PlatformOperatorActionRecord,
  PlatformOperatorRecord,
  PlatformOperatorStore,
  PlatformOperatorSummary,
  PlatformOrganizationDetailRecord,
  PlatformOrganizationRecord,
  PlatformOrganizationStatus,
  PlatformRevocation,
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
 * ===========================================================================================
 * BOTH AUDIT FEEDS, ONE STATEMENT BUILDER. `platform-audit-read-v1`.
 * ===========================================================================================
 *
 * ONE FUNCTION FOR TWO ROUTES, AND THE DIFFERENCE IS TWO PARAMETERS. Two builders would be two
 * places the principal-omission has to stay correct, and the omission is the whole security
 * property — `0028` Decision 3. Here it is one `CASE` expression, in one place, and
 * `disclosePrincipal` is a required argument so no caller can reach the disclosing form by
 * forgetting an option.
 *
 * *** THE ORDER IS `(occurred_at DESC, action_record_id DESC)` AND THE ANCHOR CARRIES BOTH. ***
 * `occurred_at` is not unique — a route writes one record and the clock has millisecond
 * resolution — so an anchor on the timestamp alone would skip or repeat the second record of a
 * pair. **An audit feed that silently drops records is worse than one that is slow.**
 *
 * NO INDEX SUPPORTS ANY OF THIS AND THAT IS A RULING, NOT AN OVERSIGHT. See
 * `0014_platform_operator_action_organization.sql` for the argument, the row-count trigger, and
 * the fact that what degrades first is sign-in rather than this feed.
 *
 * EVERY FILTER IS A BOUND PARAMETER. The only interpolated value is `limit`, which is validated as
 * an integer first — the same rule `listOrganizations` and `sql-compiler.ts` follow.
 */
async function listAudit(
  database: D1Database,
  filters: PlatformAuditFilters,
  limit: number,
  afterCursor: PlatformAuditAnchor | null,
  organizationId: string | null,
  disclosePrincipal: boolean,
): Promise<Result<readonly PlatformAuditRecord[]>> {
  if (!Number.isInteger(limit) || limit < 1) {
    return err(internal());
  }

  const conditions: string[] = [];
  const parameters: unknown[] = [];

  if (organizationId !== null) {
    conditions.push('target_organization_id = ?');
    parameters.push(organizationId);
  }
  if (filters.actorPrincipalId !== null) {
    conditions.push('actor_principal_id = ?');
    parameters.push(filters.actorPrincipalId);
  }
  if (filters.actionId !== null) {
    conditions.push('action_id = ?');
    parameters.push(filters.actionId);
  }
  if (filters.since !== null) {
    // INCLUSIVE. `occurred_at` is RFC 3339 UTC with a fixed width, so lexicographic comparison IS
    // chronological comparison — which is why the column is TEXT and why every writer goes through
    // `toRfc3339Utc`. A writer that stored a different format would break ordering silently.
    conditions.push('occurred_at >= ?');
    parameters.push(filters.since);
  }
  if (filters.until !== null) {
    // EXCLUSIVE, so consecutive windows neither overlap nor gap.
    conditions.push('occurred_at < ?');
    parameters.push(filters.until);
  }
  if (afterCursor !== null) {
    // KEYSET, ON THE COMPOUND ORDER. "Strictly older, or same instant and a lower record id."
    conditions.push('(occurred_at < ? OR (occurred_at = ? AND action_record_id < ?))');
    parameters.push(afterCursor.occurredAt, afterCursor.occurredAt, afterCursor.actionRecordId);
  }

  const target = disclosePrincipal
    ? "CASE WHEN target_kind = 'principal' THEN target_id END AS target_principal_id"
    : // THE PRINCIPAL IDENTIFIER IS NEVER READ. `NULL` is selected under the same alias so the
      // mapper is identical for both feeds and cannot be given the disclosing shape by accident.
      'NULL AS target_principal_id';

  const rows = await selectRows(
    database,
    'SELECT action_record_id, occurred_at, actor_principal_id, actor_platform_role, action_id, ' +
      `outcome, correlation_id, target_organization_id, ${target} ` +
      'FROM platform_operator_action' +
      (conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '') +
      ` ORDER BY occurred_at DESC, action_record_id DESC LIMIT ${String(limit)}`,
    parameters,
  );
  if (!rows.ok) {
    return err(rows.error);
  }

  const records: PlatformAuditRecord[] = [];
  for (const row of rows.value) {
    const actionRecordId = requiredText(row, 'action_record_id');
    const occurredAt = requiredText(row, 'occurred_at');
    const actorPrincipalId = requiredText(row, 'actor_principal_id');
    const actionId = requiredText(row, 'action_id');
    const correlationId = requiredText(row, 'correlation_id');
    const role = toPlatformRole(text(row, 'actor_platform_role'));
    const outcome = actionOutcome(row);
    if (
      actionRecordId === null ||
      occurredAt === null ||
      actorPrincipalId === null ||
      actionId === null ||
      correlationId === null ||
      role === null ||
      outcome === null
    ) {
      // A MALFORMED AUDIT ROW FAILS THE READ RATHER THAN BEING SKIPPED. Skipping would mean a feed
      // that silently omits records — and the records most likely to be malformed are the ones
      // written by a build that disagreed with this one, which is exactly what an investigator is
      // looking for.
      return err(internal());
    }
    records.push({
      actionRecordId,
      occurredAt,
      actorPrincipalId,
      actorPlatformRole: role,
      actionId,
      outcome,
      correlationId,
      targetOrganizationId: requiredText(row, 'target_organization_id'),
      targetPrincipalId: disclosePrincipal ? requiredText(row, 'target_principal_id') : null,
    });
  }
  return ok(Object.freeze(records));
}

const ACTION_OUTCOMES: readonly PlatformActionOutcome[] = ['ok', 'denied', 'failed'];

function actionOutcome(row: SqlRow): PlatformActionOutcome | null {
  const value = text(row, 'outcome');
  if (value === null) {
    return null;
  }
  return ACTION_OUTCOMES.includes(value as PlatformActionOutcome)
    ? (value as PlatformActionOutcome)
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

    async listOperators(
      limit: number,
      afterPrincipalId: string | null,
    ): Promise<Result<readonly PlatformOperatorSummary[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        return err(internal());
      }
      // KEYSET ON THE PRIMARY KEY. `WHERE principal_id > ?` resumes the index scan strictly after
      // the previous page, so page N costs page 1. The limit is inlined as a VALIDATED integer,
      // the anchor is BOUND — the same split `listOrganizations` makes.
      //
      // *** THREE COLUMNS. THERE IS NO JOIN TO `principal` AND NO JOIN TO `principal_credential`. ***
      // Either would put an identifier or a status within reach of this statement, and the whole
      // point of the roster is that it cannot become a directory. `0001_principal.sql`.
      const sql =
        afterPrincipalId === null
          ? 'SELECT principal_id, platform_role, created_at FROM platform_operator ' +
            `ORDER BY principal_id LIMIT ${String(limit)}`
          : 'SELECT principal_id, platform_role, created_at FROM platform_operator ' +
            `WHERE principal_id > ? ORDER BY principal_id LIMIT ${String(limit)}`;
      const rows = await selectRows(
        database,
        sql,
        afterPrincipalId === null ? [] : [afterPrincipalId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      const operators: PlatformOperatorSummary[] = [];
      for (const row of rows.value) {
        const principalId = requiredText(row, 'principal_id');
        const createdAt = requiredText(row, 'created_at');
        const platformRole = toPlatformRole(text(row, 'platform_role'));
        if (principalId === null || createdAt === null || platformRole === null) {
          // AN UNRECOGNISED ROLE OMITS THE ROW RATHER THAN FAILING THE PAGE, and that is the one
          // place this differs from the audit feed's mapper.
          //
          // THE REASON IS WHAT THE ROW MEANS. `findOperator` already denies everything to a
          // principal whose stored role this build cannot read — so such a principal HOLDS NO
          // AUTHORITY, and listing it would tell an operator that someone is an operator when the
          // platform refuses them everything. **The roster answers "who can act", and the honest
          // answer for an unreadable role is "not this one".**
          //
          // IT IS NOT SILENT: the same row is invisible at `findOperator` too, so a principal who
          // believes they are an operator and is refused everywhere is consistent with a roster
          // that omits them. A page that failed instead would make one bad row hide every good one.
          continue;
        }
        operators.push({ principalId, platformRole, createdAt });
      }
      return ok(Object.freeze(operators));
    },

    async revokeOperator(
      principalId: string,
      isSelfRevocation: boolean,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<PlatformRevocation | null>> {
      consumeControlPlaneWriteReservation(reservation, 1);

      // =====================================================================================
      // *** THE DELETE AND ITS PRECONDITION ARE ONE STATEMENT. `RETURNING` GIVES THE COUNT. ***
      // =====================================================================================
      //
      // `DELETE ... WHERE principal_id = ? AND (<self> OR (SELECT COUNT(*) FROM platform_operator)
      // > 1) RETURNING principal_id`.
      //
      // CHECK-THEN-ACT WOULD BE A RACE WITH NO RECOVERY. Two concurrent revocations both read two
      // operators, both proceed, and the platform is left with **zero operators and no route that
      // can create one** — `0025` publishes none, deliberately, so the only way back is
      // out-of-band SQL against production. `architecture.md` §3a: the in-statement guard *"is the
      // only layer with no window at all, because it re-asks the question in the same statement
      // that writes."*
      //
      // THE SELF CASE BYPASSES THE COUNT DELIBERATELY. The last operator may resign; the contract
      // permits it because refusing would mean an operator cannot leave, and no route could ever
      // make them not-the-last.
      const deleted = await selectRows(
        database,
        'DELETE FROM platform_operator WHERE principal_id = ? AND (? = 1 OR ' +
          '(SELECT COUNT(*) FROM platform_operator) > 1) RETURNING principal_id',
        [principalId, isSelfRevocation ? 1 : 0],
      );
      if (!deleted.ok) {
        return err(deleted.error);
      }
      if (deleted.value.length === 0) {
        // NOT AN OPERATOR, **OR** THE LAST ONE AND NOT THE CALLER. The route separates these two
        // by asking `findOperator` first — it cannot be done here, because a statement that
        // reported which condition failed would tell a caller whether an arbitrary principal holds
        // platform authority, which is the oracle the 404 collapse exists to close.
        return ok(null);
      }

      // THE COUNT AFTER THE DELETE. A second round trip, and it has to be: SQLite cannot return an
      // aggregate over the post-delete table from within the DELETE itself. **A race here changes
      // only the number reported to an operator, never whether the delete was safe** — the
      // precondition was enforced in the statement above and cannot be undone by a later read.
      const remaining = await selectRows(
        database,
        'SELECT COUNT(*) AS remaining FROM platform_operator',
        [],
      );
      if (!remaining.ok) {
        return err(remaining.error);
      }
      const value = remaining.value[0]?.remaining;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        // THE REVOCATION ALREADY HAPPENED. Reporting `internal` here is honest — the operation
        // succeeded and its report did not — and it is the direction the dispatcher already takes
        // when an audit record cannot be written after a committed change.
        return err(internal());
      }
      return ok({ remainingOperatorCount: value });
    },

    async listPlatformAudit(
      filters: PlatformAuditFilters,
      limit: number,
      afterCursor: PlatformAuditAnchor | null,
    ): Promise<Result<readonly PlatformAuditRecord[]>> {
      // *** `target_id` IS NOT SELECTED WHEN THE TARGET IS A PRINCIPAL. ***
      //
      // The column holds a principal identifier for a resolve and a reset. Selecting it and
      // filtering in the mapper would put the value in this process, one edit from a response.
      // **`CASE WHEN target_kind = 'organization' THEN target_id END` means the principal
      // identifier is never read at all** — the omission is in the statement, which is where a
      // reviewer looks, and `target_organization_id` is selected separately because `0014` records
      // WHERE an action happened rather than what it named.
      return listAudit(database, filters, limit, afterCursor, null, false);
    },

    async listOrganizationAudit(
      organizationId: string,
      filters: PlatformAuditFilters,
      limit: number,
      afterCursor: PlatformAuditAnchor | null,
    ): Promise<Result<readonly PlatformAuditRecord[]>> {
      // SELECTS ON `target_organization_id` — `0014`'s column. Selecting on `target_id` would
      // return every onboarding and not one resolve, which is the defect that migration fixes.
      return listAudit(database, filters, limit, afterCursor, organizationId, true);
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
                'actor_platform_role, action_id, target_kind, target_id, ' +
                'target_organization_id, outcome, occurred_at, ' +
                'correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(
              record.actionRecordId,
              record.actorPrincipalId,
              record.actorPlatformRole,
              record.actionId,
              record.targetKind,
              record.targetId,
              // `0014`. WHERE the action happened, as distinct from what it acted on.
              record.targetOrganizationId,
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
