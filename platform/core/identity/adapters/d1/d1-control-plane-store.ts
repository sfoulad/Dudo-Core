/**
 * The control-plane D1 adapter. THE ONLY FILE IN `platform/core/identity/**` THAT NAMES D1.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place a Cloudflare type may be named, and
 * the check is a grep over the domain modules that must come back empty. Nothing D1-shaped
 * leaves this file: it returns `ControlPlaneStores`, which are Core types describing records.
 *
 * ===========================================================================================
 * IT TAKES A DIFFERENT BINDING FROM THE TENANT ADAPTER, AND THAT IS THE WHOLE OF `0014` §C.3
 * ===========================================================================================
 *
 * `docs/decisions/0006` §0.3 allocated database 1 of 10 to "Production control-plane / tenant
 * directory" and database 2 to the shared tenant data. That allocation has been on the books
 * since 2026-09-01 and this is the first code to use it. THE CONTROL PLANE IS NOT A NEW DATABASE
 * SLOT; it is the slot that was already reserved for it.
 *
 * §C.7, restated because it is the thing most likely to be got wrong later: THE SEPARATE
 * DATABASE IS AN ISOLATION BOUNDARY, NOT ADDITIONAL QUOTA. D1's daily row-read and row-write
 * limits are ACCOUNT-WIDE. Splitting the data changes what can reach what; it raises no ceiling
 * whatsoever, and every write below is charged against the same budget as a Customer create
 * (`../../control-plane-admission.ts`).
 *
 * ===========================================================================================
 * THIS FILE MUST NEVER IMPORT `storage/adapters/sql/sql-compiler.ts`, AND THE REVERSE IS ALSO
 * TRUE.
 * ===========================================================================================
 *
 * That compiler emits `tenant_id = ?` on every statement it produces, which is exactly right for
 * the tenant database and meaningless here: NO CONTROL-PLANE TABLE HAS A `tenant_id` COLUMN, and
 * none may gain one. A control-plane row is not owned by an Organization — that is the point of
 * §C.1 and §C.2. Conversely, compiling a tenant table's statement with the hand-written SQL
 * below would drop the tenant predicate, which is the single defect the whole tenancy model is
 * built to make impossible.
 *
 * The two adapters therefore share no SQL and no compiler, deliberately, and the separation is
 * one grep: `platform/core/identity/**` must not mention `sql-compiler`, `TENANT_COLUMN`, or
 * `tenant_id`.
 *
 * ===========================================================================================
 * EVERY STATEMENT IS A POINT LOOKUP OR A BOUNDED PREFIX SCAN
 * ===========================================================================================
 *
 * `CLOUDFLARE_STANDARD.md` §4 rule 4: every query is indexed for its access path, because on a
 * single-threaded database one unindexed scan is every Organization's latency — and the control
 * plane is on the path of EVERY authenticated request, so a slow query here is slow for
 * everything. Each statement below names its index in a comment, and the migrations are written
 * to serve exactly these eight statements and nothing else.
 */

import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { internal, unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import { toMembershipRole } from '../../../authorization/roles.ts';
import type {
  ControlPlanePrincipalType,
  ControlPlaneStores,
  IdentityControlPlaneStore,
  MembershipStatus,
  MembershipWithOrganization,
  NewOrganizationMembership,
  OrganizationMembershipRecord,
  OrganizationStatus,
  PrincipalRecord,
  PrincipalStatus,
  SessionRecord,
  TenantDirectoryRecord,
  TenantDirectoryStore,
} from '../../control-plane-store.ts';
import type { MembershipAdmission } from '../../../platform/platform-authority.ts';
// A VALUE import, and the direction is deliberate: the adapter reaches INTO the platform module
// for the verifier, while `control-plane-store.ts` takes only the erased TYPE. There is no
// runtime cycle — `platform-authority.ts`'s own value imports are the kernel and
// `platform-permissions.ts`, neither of which reaches back here.
import { consumeMembershipAdmission } from '../../../platform/platform-authority.ts';
import type { ControlPlaneWriteReservation } from '../../control-plane-admission.ts';
import { consumeControlPlaneWriteReservation } from '../../control-plane-admission.ts';

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
  } catch (cause) {
    // The engine is down or the statement failed. The caller learns neither which — the same
    // treatment `d1-store.ts` gives a failed tenant query, for the same reason.
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

/**
 * Reads a SQL `EXISTS` result as a boolean, TRUE ONLY FOR AN EXACT 1.
 *
 * `Boolean(value)` would be wrong in the dangerous direction and the difference is not theoretical:
 * every non-empty string is truthy in JavaScript, so a driver returning `'0'` as text would make
 * `Boolean('0')` be `true` — which for `holds_membership` reads a compliant operator as violating
 * (annoying) and for a future inverted use would read a violating one as compliant (a hole).
 *
 * ANYTHING THAT IS NOT 1 OR '1' IS `false`. `null`, `undefined`, an absent column and an
 * unexpected type all collapse to `false`, which for these two flags is the SAFE direction only
 * because the refusal is on their CONJUNCTION — see `PrincipalRecord`. If either flag is ever used
 * alone, this default has to be re-examined.
 */
function flag(row: SqlRow, column: string): boolean {
  const value = row[column];
  return value === 1 || value === '1' || value === true;
}

/**
 * Stored enumerations are VALIDATED ON READ, and an unrecognised value is an error rather than a
 * coerced default.
 *
 * The migrations carry `CHECK` constraints, so a bad value should be unwritable. This is the
 * second half of that guarantee, and it is here because a coercion would be worse than either
 * alternative: mapping an unknown status to `'active'` would be a privilege escalation caused by
 * schema drift, and mapping it silently to `'suspended'` would hide the drift while locking a
 * principal out for reasons nobody can see. `internal()` fails closed AND leaves evidence.
 */
function enumeration<T extends string>(
  row: SqlRow,
  column: string,
  permitted: readonly T[],
): T | null {
  const value = text(row, column);
  if (value === null) {
    return null;
  }
  return permitted.includes(value as T) ? (value as T) : null;
}

const PRINCIPAL_STATUSES: readonly PrincipalStatus[] = ['active', 'suspended'];
const PRINCIPAL_TYPES: readonly ControlPlanePrincipalType[] = [
  'user',
  'team',
  'service-account',
  'ai-agent',
  'iot-device',
];
const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ['active', 'suspended'];
const ORGANIZATION_STATUSES: readonly OrganizationStatus[] = ['active', 'suspended'];
const DIRECTORY_STATES: readonly TenantDirectoryRecord['state'][] = [
  'active',
  'suspended',
  'migrating',
];

/**
 * Builds both halves of the control plane over one binding.
 *
 * THEY ARE RETURNED AS TWO SEPARATE OBJECTS so the composition root can hand the identity
 * resolver one and the tenant-store resolver the other. Neither consumer ever holds a value that
 * reaches the other's tables. See `control-plane-store.ts` property 3.
 *
 * NOT EXPORTED FOR GENERAL USE. An App never sees this factory's argument, because an App never
 * sees a binding.
 */
export function createD1ControlPlaneStores(database: D1Database): ControlPlaneStores {
  const identity: IdentityControlPlaneStore = {
    async findSession(sessionId: string): Promise<Result<SessionRecord | null>> {
      // Point lookup on the primary key of `session`.
      const rows = await selectRows(
        database,
        'SELECT session_id, principal_id, active_organization_id, created_at, expires_at ' +
          'FROM session WHERE session_id = ? LIMIT 1',
        [sessionId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      if (rows.value.length === 0) {
        return ok(null);
      }
      const row = rows.value[0];
      const id = requiredText(row, 'session_id');
      const principalId = requiredText(row, 'principal_id');
      const createdAt = requiredText(row, 'created_at');
      const expiresAt = requiredText(row, 'expires_at');
      if (id === null || principalId === null || createdAt === null || expiresAt === null) {
        return err(internal());
      }
      return ok({
        sessionId: id,
        principalId,
        // NULL is meaningful here and is not an error: a session with no Organization selected.
        activeOrganizationId: requiredText(row, 'active_organization_id'),
        createdAt,
        expiresAt,
      });
    },

    async findPrincipal(principalId: string): Promise<Result<PrincipalRecord | null>> {
      // =====================================================================================
      // Point lookup on the primary key of `principal`, PLUS the two mutual-exclusion flags.
      // `docs/decisions/0025` decision 1, `docs/decisions/0024` as amended 2026-09-05.
      // =====================================================================================
      //
      // ONE STATEMENT, NOT THREE. Both flags are correlated `EXISTS` subqueries against primary-key
      // indexes — `platform_operator(principal_id)` and `organization_membership(principal_id, …)`,
      // whose leading column is `principal_id` for exactly this shape. This statement already ran
      // on every authenticated request, so THE ACTION-SIDE MUTUAL-EXCLUSION CHECK COSTS NO
      // ADDITIONAL ROUND TRIP AND NO ADDITIONAL STATEMENT. A separate port method would have cost
      // one of each, on the hottest path in the platform, which is why it is not one.
      //
      // `EXISTS` RATHER THAN `COUNT(*)`: the engine stops at the first matching index entry, so a
      // principal in fifty Organizations costs the same as one in a single Organization.
      //
      // IT REQUIRES CONTROL-PLANE MIGRATION 0008. A database without `platform_operator` makes
      // this statement fail, `selectRows` returns `unavailable()`, and NOTHING AUTHENTICATES. That
      // is the same coupling `0007_membership_role.sql` already created by adding `role` to the
      // membership projection, and it is the correct direction: a build whose isolation check
      // cannot run must refuse rather than proceed without it.
      const rows = await selectRows(
        database,
        'SELECT principal_id, principal_type, status, ' +
          'EXISTS (SELECT 1 FROM platform_operator WHERE principal_id = ?) AS is_platform_operator, ' +
          'EXISTS (SELECT 1 FROM organization_membership WHERE principal_id = ?) AS holds_membership ' +
          'FROM principal WHERE principal_id = ? LIMIT 1',
        [principalId, principalId, principalId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      if (rows.value.length === 0) {
        return ok(null);
      }
      const row = rows.value[0];
      const id = requiredText(row, 'principal_id');
      const principalType = enumeration(row, 'principal_type', PRINCIPAL_TYPES);
      const status = enumeration(row, 'status', PRINCIPAL_STATUSES);
      if (id === null || principalType === null || status === null) {
        return err(internal());
      }
      return ok({
        principalId: id,
        principalType,
        status,
        // `EXISTS` yields the integer 1 or 0. COMPARED AGAINST 1 RATHER THAN COERCED WITH
        // `Boolean(...)`: every non-empty string is truthy, so a driver that returned '0' as text
        // would make an operator-with-a-membership read as compliant — the fail-OPEN direction on
        // the one flag whose whole purpose is to fail closed.
        isPlatformOperator: flag(row, 'is_platform_operator'),
        holdsMembership: flag(row, 'holds_membership'),
      });
    },

    async findMembershipWithOrganization(
      principalId: string,
      organizationId: string,
    ): Promise<Result<MembershipWithOrganization | null>> {
      // =====================================================================================
      // THE ANTI-ORACLE, AND IT IS THE STATEMENT ORDER THAT IMPLEMENTS IT — `0014` §C.6.
      // =====================================================================================
      //
      // Membership first, on the full primary key of `organization_membership`. IF THERE IS NO
      // ACTIVE ROW, THIS FUNCTION RETURNS WITHOUT TOUCHING THE `organization` TABLE. So a
      // principal naming an Organization it does not belong to and a principal naming an
      // Organization that does not exist produce: the same result (`null`), from the same one
      // statement, against the same one table, reading the same zero rows.
      //
      // `AND status = 'active'` IS PART OF THAT GUARANTEE AND NOT A CONVENIENCE, and it was
      // added because a verification harness caught the gap: with the status checked ABOVE the
      // port instead of inside the statement, a SUSPENDED membership still returned a row, the
      // `organization` table was then read, and the failing path issued four statements where a
      // non-member issued three. The error value was already identical; THE WORK WAS NOT, and a
      // difference in work is a difference a caller can measure. Now all three failing cases are
      // one statement against one table returning zero rows.
      //
      // A JOIN WOULD ALSO RETURN NOTHING IN EVERY FAILING CASE AND WOULD STILL BE WRONG, because
      // it would open the `organization` table on the failing path — one edit away from a LEFT
      // JOIN that reports "the Organization exists but you are not a member", which is the
      // oracle written out in full. Two statements with an early return cannot drift that way.
      // `role` JOINS THE PROJECTION AND CHANGES NOTHING ELSE (docs/decisions/0019). It is still
      // ONE statement against ONE table filtered on `status = 'active'`, so the anti-oracle
      // argument above is untouched: a non-member, a suspended member and a caller naming a
      // non-existent Organization still produce the same result from the same work. Adding a
      // column to a projection reads no additional row.
      const membershipRows = await selectRows(
        database,
        'SELECT principal_id, organization_id, status, role FROM organization_membership ' +
          "WHERE principal_id = ? AND organization_id = ? AND status = 'active' LIMIT 1",
        [principalId, organizationId],
      );
      if (!membershipRows.ok) {
        return err(membershipRows.error);
      }
      if (membershipRows.value.length === 0) {
        return ok(null);
      }
      const membershipRow = membershipRows.value[0];
      const memberPrincipalId = requiredText(membershipRow, 'principal_id');
      const memberOrganizationId = requiredText(membershipRow, 'organization_id');
      const membershipStatus = enumeration(membershipRow, 'status', MEMBERSHIP_STATUSES);
      if (
        memberPrincipalId === null ||
        memberOrganizationId === null ||
        membershipStatus === null
      ) {
        return err(internal());
      }

      // Only now, and only for a principal that is already a member.
      const organizationRows = await selectRows(
        database,
        'SELECT organization_id, status FROM organization WHERE organization_id = ? LIMIT 1',
        [memberOrganizationId],
      );
      if (!organizationRows.ok) {
        return err(organizationRows.error);
      }
      if (organizationRows.value.length === 0) {
        // A membership pointing at an Organization that is not in the table. Referential
        // integrity is enforced by the schema, so this is corruption rather than a state a
        // caller can produce — and it is NOT reported as "not a member", because the caller IS
        // a member and telling them otherwise would hide a data defect behind a routine answer.
        return err(internal());
      }
      const organizationRow = organizationRows.value[0];
      const organizationStatus = enumeration(organizationRow, 'status', ORGANIZATION_STATUSES);
      if (organizationStatus === null) {
        return err(internal());
      }

      return ok({
        membership: {
          principalId: memberPrincipalId,
          organizationId: memberOrganizationId,
          status: membershipStatus,
          // AN UNRECOGNISED ROLE COLLAPSES TO `null`, WHICH DENIES — it is NOT validated with
          // `enumeration()` and NOT reported as `internal()` like the other stored enumerations
          // in this file. The distinction is deliberate and it is the same one
          // `d1-credential-store.ts` makes for an unrecognised credential algorithm: a value a
          // FUTURE migration introduces must fail onto the safe path, so a build older than its
          // data denies rather than erroring. Failing loudly here would turn a routine
          // mid-migration state into an outage, and would do it for one principal at a time.
          role: toMembershipRole(text(membershipRow, 'role')),
        },
        organization: {
          organizationId: memberOrganizationId,
          status: organizationStatus,
        },
      });
    },

    async listMembershipsForPrincipal(
      principalId: string,
      limit: number,
    ): Promise<Result<readonly OrganizationMembershipRecord[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        return err(internal());
      }
      // Prefix scan on the primary key of `organization_membership`, whose leading column is
      // `principal_id` for exactly this query. The limit is inlined as a validated integer, as
      // `sql-compiler.ts` does, so it cannot carry caller-controlled text.
      const rows = await selectRows(
        database,
        'SELECT principal_id, organization_id, status, role FROM organization_membership ' +
          `WHERE principal_id = ? ORDER BY organization_id ASC LIMIT ${String(limit)}`,
        [principalId],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      const memberships: OrganizationMembershipRecord[] = [];
      for (const row of rows.value) {
        const rowPrincipalId = requiredText(row, 'principal_id');
        const organizationId = requiredText(row, 'organization_id');
        const status = enumeration(row, 'status', MEMBERSHIP_STATUSES);
        if (rowPrincipalId === null || organizationId === null || status === null) {
          return err(internal());
        }
        memberships.push({
          principalId: rowPrincipalId,
          organizationId,
          status,
          role: toMembershipRole(text(row, 'role')),
        });
      }
      return ok(memberships);
    },

    async createSession(
      record: SessionRecord,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      // NO ADMISSION, NO WRITE — `0014` §A.11 at the only file that can reach the control-plane
      // database. It throws rather than returning, exactly as `d1-store.ts` does: no client can
      // cause this, because clients supply values and never reservations.
      consumeControlPlaneWriteReservation(reservation, 1);
      return execute(
        database,
        'INSERT INTO session (session_id, principal_id, active_organization_id, created_at, ' +
          'expires_at) VALUES (?, ?, ?, ?, ?)',
        [
          record.sessionId,
          record.principalId,
          record.activeOrganizationId,
          record.createdAt,
          record.expiresAt,
        ],
      );
    },

    async createMembership(
      record: NewOrganizationMembership,
      reservation: ControlPlaneWriteReservation,
      admission: MembershipAdmission,
    ): Promise<Result<void>> {
      // ---- Layer 1. THE RECEIPT. Throws rather than returning, exactly as
      // `consumeControlPlaneWriteReservation` does and for the same reason: no client can cause
      // this, because clients supply values and never receipts. It also binds the receipt to THIS
      // row's principal, so one minted for A cannot fund a write for B.
      consumeMembershipAdmission(admission, record.principalId);
      consumeControlPlaneWriteReservation(reservation, 1);

      // =====================================================================================
      // ---- Layer 2. THE GUARD IS IN THE STATEMENT, NOT IN FRONT OF IT.
      // =====================================================================================
      //
      // `INSERT ... SELECT ... WHERE NOT EXISTS` re-asks the platform-operator question IN THE
      // SAME STATEMENT THAT WRITES, which closes the one thing the receipt cannot: the fact it
      // certifies was true when it was minted, and a principal could be made an operator between
      // the mint and this line. Here there is no window — the check and the write are one
      // statement.
      //
      // IT COSTS NOTHING. A correlated subquery against `platform_operator`'s primary key, on a
      // statement that was going to run anyway. No extra round trip and no extra statement.
      //
      // AND IT HOLDS ON A DATABASE WHERE `0010` WAS NEVER APPLIED. That is the case
      // `security-agent` identified as the one the triggers structurally cannot cover — a restore
      // from two backups taken at different moments does not re-run triggers, and `0010`
      // deliberately does not validate rows that already exist. This layer does not depend on
      // that migration at all.
      //
      // ---- WHAT IT DOES NOT DO, STATED BECAUSE IT IS THE RESIDUAL.
      //
      // A refused write lands ZERO ROWS AND REPORTS `ok`. Core's `D1Database` exposes no
      // `meta.changes` — `batch` returns `unknown[]` — so this adapter cannot tell "wrote one row"
      // from "wrote none", and surfacing it would mean widening a Cloudflare-shaped type that
      // `.claude/rules/architecture.md` §6 requires to stay minimal and replaceable.
      //
      // THAT IS ACCEPTABLE ONLY BECAUSE OF LAYER 1, AND THE ORDER OF THE ARGUMENT MATTERS. The
      // receipt already refused loudly, with a real error, before any of this ran. This branch is
      // reachable only after someone has deliberately cast past the type — at which point "the
      // forbidden row was not created" is the property that matters, not the message. A guarded
      // INSERT as the ONLY layer would be a silent false success and would not be acceptable.
      return execute(
        database,
        'INSERT INTO organization_membership ' +
          '(principal_id, organization_id, status, role, created_at) ' +
          'SELECT ?, ?, ?, ?, ? ' +
          'WHERE NOT EXISTS (SELECT 1 FROM platform_operator WHERE principal_id = ?)',
        [
          record.principalId,
          record.organizationId,
          record.status,
          record.role,
          record.createdAt,
          record.principalId,
        ],
      );
    },

    async listLiveSessionIds(
      principalId: string,
      nowIso: string,
      limit: number,
    ): Promise<Result<readonly string[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        return err(internal());
      }
      // OLDEST FIRST. See the port: if the cap truncates, the sessions that survive should be the
      // most recent — an attacker's freshly minted session is the one being raced.
      //
      // `expires_at > ?` USES THE SERVER'S CLOCK PASSED IN, never SQLite's `datetime('now')`, so
      // the same instant governs the count, the reservation and the delete.
      const rows = await selectRows(
        database,
        'SELECT session_id FROM session WHERE principal_id = ? AND expires_at > ? ' +
          `ORDER BY created_at LIMIT ${String(limit)}`,
        [principalId, nowIso],
      );
      if (!rows.ok) {
        return err(rows.error);
      }
      const ids: string[] = [];
      for (const row of rows.value) {
        const id = requiredText(row, 'session_id');
        if (id === null) {
          return err(internal());
        }
        ids.push(id);
      }
      return ok(Object.freeze(ids));
    },

    async resetCredential(
      identifierHash: string,
      replacement: {
        readonly algorithm: string;
        readonly iterations: number;
        readonly salt: string;
        readonly verifier: string;
      },
      sessionIds: readonly string[],
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      consumeControlPlaneWriteReservation(reservation, 1 + sessionIds.length);

      // ONE BATCH, ONE TRANSACTION: the credential is replaced and the sessions are deleted
      // together. See the port for why the ORDER of these two is a security property and why one
      // batch removes the window rather than shrinking it.
      const statements: { readonly sql: string; readonly parameters: readonly unknown[] }[] = [
        {
          sql:
            'UPDATE principal_credential SET algorithm = ?, iterations = ?, salt = ?, ' +
            'verifier = ? WHERE identifier_hash = ?',
          parameters: [
            replacement.algorithm,
            replacement.iterations,
            replacement.salt,
            replacement.verifier,
            identifierHash,
          ],
        },
      ];
      for (const sessionId of sessionIds) {
        // ONE STATEMENT PER SESSION, matching the reservation exactly. A predicate delete would
        // remove however many exist rather than however many were paid for.
        statements.push({
          sql: 'DELETE FROM session WHERE session_id = ?',
          parameters: [sessionId],
        });
      }
      return executeBatch(database, statements);
    },

    async createOrganizationWithFirstAdmin(
      rows,
      reservation: ControlPlaneWriteReservation,
      admission: MembershipAdmission,
    ): Promise<Result<void>> {
      // ---- Layer 1. THE RECEIPTS, both bound to this operation's own values.
      consumeMembershipAdmission(admission, rows.membership.principalId);
      consumeControlPlaneWriteReservation(reservation, 5);

      // =====================================================================================
      // ONE BATCH, ONE TRANSACTION, FIVE STATEMENTS, DEPENDENCY ORDER.
      // =====================================================================================
      //
      // D1 EXECUTES A BATCH AS A SINGLE IMPLICIT TRANSACTION — the same property
      // `storage/adapters/d1/d1-store.ts` relies on to make a mutation and its audit record one
      // unit. So all five rows land or none do, and there is no window in which an Organization
      // exists without its admin, an admin without a credential, or a directory entry pointing at
      // nothing. **`organization-onboarding-v1`'s `ON-1` orphan is unreachable through this port.**
      //
      // THE ORDER IS FORCED BY THE SCHEMA AND MEASURED, NOT ASSUMED. `tenant_directory`,
      // `principal_credential` and `organization_membership` all carry `REFERENCES`, D1 enforces
      // foreign keys, and SQLite checks them per statement rather than deferring to commit. So
      // parents precede children: organization, tenant_directory, principal, principal_credential,
      // organization_membership.
      //
      // ---- THE MEMBERSHIP STATEMENT KEEPS ITS IN-STATEMENT GUARD.
      //
      // `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM platform_operator ...)` — identical
      // to `createMembership`'s, and it is not redundant here even though the principal is created
      // three statements earlier in the same transaction. **The guard is what survives a future
      // edit that reorders these statements or reuses this method for an existing principal**, and
      // it costs a correlated subquery on a primary key.
      //
      // ---- NO `ON CONFLICT` ANYWHERE, AND THAT IS THE ANTI-TAKEOVER PROPERTY.
      //
      // A duplicate `identifier_hash` violates the primary key and aborts the whole batch. An
      // upsert would silently repoint an existing person's credential at a new Organization's
      // admin, which is account takeover wearing the shape of a convenience. The service checks
      // for the collision first so the ordinary case answers `conflict`; this is what makes the
      // race fail closed rather than fail open.
      return executeBatch(database, [
        {
          // `template_id` IS ON THIS INSERT AS OF `0013`. It is the reference `0012_template.sql`
          // said onboarding would add and that onboarding shipped without — the column did not
          // exist, so the value was validated and discarded, and Templates stayed inert while
          // being reported as connected.
          //
          // THE FOREIGN KEY MEANS THIS STATEMENT CAN NOW FAIL ON A TEMPLATE THAT VANISHED between
          // the service's validating read and this write. That aborts the whole batch and answers
          // `unavailable` — nothing is half-created, and the window needs no lock because no route
          // deletes a Template (`TM-2`).
          sql:
            'INSERT INTO organization (organization_id, status, template_id, created_at) ' +
            'VALUES (?, ?, ?, ?)',
          parameters: [
            rows.organization.organizationId,
            rows.organization.status,
            rows.organization.templateId,
            rows.membership.createdAt,
          ],
        },
        {
          sql:
            'INSERT INTO tenant_directory (organization_id, binding_name, state, created_at) ' +
            'VALUES (?, ?, ?, ?)',
          parameters: [
            rows.directory.organizationId,
            rows.directory.bindingName,
            rows.directory.state,
            rows.membership.createdAt,
          ],
        },
        {
          sql:
            'INSERT INTO principal (principal_id, principal_type, status, created_at) ' +
            'VALUES (?, ?, ?, ?)',
          parameters: [
            rows.principal.principalId,
            rows.principal.principalType,
            rows.principal.status,
            rows.membership.createdAt,
          ],
        },
        {
          sql:
            'INSERT INTO principal_credential ' +
            '(identifier_hash, principal_id, algorithm, iterations, salt, verifier, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
          parameters: [
            rows.credential.identifierHash,
            rows.credential.principalId,
            rows.credential.algorithm,
            rows.credential.iterations,
            rows.credential.salt,
            rows.credential.verifier,
            rows.membership.createdAt,
          ],
        },
        {
          sql:
            'INSERT INTO organization_membership ' +
            '(principal_id, organization_id, status, role, created_at) ' +
            'SELECT ?, ?, ?, ?, ? ' +
            'WHERE NOT EXISTS (SELECT 1 FROM platform_operator WHERE principal_id = ?)',
          parameters: [
            rows.membership.principalId,
            rows.membership.organizationId,
            rows.membership.status,
            rows.membership.role,
            rows.membership.createdAt,
            rows.membership.principalId,
          ],
        },
      ]);
    },

    async setSessionActiveOrganization(
      sessionId: string,
      organizationId: string | null,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      consumeControlPlaneWriteReservation(reservation, 1);
      return execute(
        database,
        'UPDATE session SET active_organization_id = ? WHERE session_id = ?',
        [organizationId, sessionId],
      );
    },

    async deleteSession(
      sessionId: string,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      consumeControlPlaneWriteReservation(reservation, 1);
      return execute(database, 'DELETE FROM session WHERE session_id = ?', [sessionId]);
    },
  };

  const tenantDirectory: TenantDirectoryStore = {
    async findEntry(organizationId: string): Promise<Result<TenantDirectoryRecord | null>> {
      // Point lookup on the primary key of `tenant_directory`.
      const rows = await selectRows(
        database,
        'SELECT organization_id, binding_name, state FROM tenant_directory ' +
          'WHERE organization_id = ? LIMIT 1',
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
      const bindingName = requiredText(row, 'binding_name');
      const state = enumeration(row, 'state', DIRECTORY_STATES);
      if (id === null || bindingName === null || state === null) {
        return err(internal());
      }
      return ok({ organizationId: id, bindingName, state });
    },
  };

  return { identity, tenantDirectory };
}

/**
 * Several statements, ONE transaction. The multi-statement form of `execute` below.
 *
 * IT EXISTS SO THAT THE ATOMICITY IS AT THE PORT AND NOT AT THE CALL SITE. A caller that wanted
 * five rows written together could not assemble it from five `execute` calls — that is five
 * transactions — and the difference is `ON-1`'s orphan row.
 *
 * A FAILURE ANYWHERE IN THE BATCH IS `unavailable`, exactly as `execute`'s is, and for the same
 * reason: distinguishing a constraint violation from an outage would mean reading a D1 error
 * message, which is a vendor-shaped string in a control flow. Callers that need to tell a
 * collision apart must check for it with a read BEFORE the write, which is what
 * `onboarding-service.ts` does and documents.
 */
async function executeBatch(
  database: D1Database,
  statements: readonly { readonly sql: string; readonly parameters: readonly unknown[] }[],
): Promise<Result<void>> {
  try {
    await database.batch(
      statements.map((statement) =>
        database.prepare(statement.sql).bind(...statement.parameters),
      ),
    );
    return ok(undefined);
  } catch (cause) {
    return err(unavailable());
  }
}

async function execute(
  database: D1Database,
  sql: string,
  parameters: readonly unknown[],
): Promise<Result<void>> {
  try {
    // One statement per batch. `batch` is used rather than a bare `all` so that every write in
    // the platform goes through the same single-transaction call shape as the tenant adapter's.
    await database.batch([database.prepare(sql).bind(...parameters)]);
    return ok(undefined);
  } catch (cause) {
    return err(unavailable());
  }
}
