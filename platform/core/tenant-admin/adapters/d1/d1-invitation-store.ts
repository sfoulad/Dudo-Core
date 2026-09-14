/**
 * The invitation D1 adapter — the first executable implementation of `InvitationStore`.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place a Cloudflare type may be named. Nothing
 * D1-shaped leaves this file.
 *
 * IT TAKES THE CONTROL-PLANE BINDING. `invitation` is a control-plane table with no `tenant_id`
 * column (`0021`, and `0003_organization_membership.sql`'s reasoning: an invitation becomes a
 * membership, and a membership precedes tenant selection). **So this file must never import
 * `storage/adapters/sql/sql-compiler.ts`** — that compiler emits `tenant_id = ?` on every statement
 * it produces, and this schema has no such column.
 *
 * ===========================================================================================
 * *** UNTIL THIS FILE EXISTED, THE SWEEP STATEMENT WAS A FENCED ```sql BLOCK IN A COMMENT. ***
 * ===========================================================================================
 *
 * `qa-agent` measured that `InvitationStore` appeared in exactly one file across 158 TypeScript
 * files under `platform/core/` — its own declaration — and pointed sixteen cases at the fenced
 * block inside `invitation-administration.ts`, extracting and executing it. **Those cases proved
 * the statement that was WRITTEN DOWN was bounded and cleared the address. They proved nothing
 * about a store, because there was no store.**
 *
 * **THIS FILE IS NOW THE SOURCE OF TRUTH FOR THOSE STATEMENTS, AND THE COMMENT IS NOT.** Said at
 * both sites, because a test extracting SQL from a comment that has drifted from the code beside it
 * is `workflow.md` §12's duplicated constraint **with the test pointed at the wrong copy** — and it
 * would stay green while the adapter did something else entirely.
 *
 * ===========================================================================================
 * TENANCY: EVERY STATEMENT LEADS WITH `organization_id`, AND IT COMES FROM THE SEALED VALUE
 * ===========================================================================================
 *
 * `organization_id` is the first column of the primary key on both tables, so every statement here
 * is a point lookup or a keyset scan under one Organization — **there is no statement in this file
 * that could return another tenant's row**, and none that takes an Organization identifier from
 * anything but `AuthenticatedOrganizationId`.
 */

import { err, ok } from '../../../kernel/result.ts';
import { internal, unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import { consumeControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import type { AuthenticatedOrganizationId } from '../../authenticated-organization.ts';
import { consumeAuthenticatedOrganizationId } from '../../authenticated-organization.ts';
import { consumeGrantCeilingClearanceAtStorage } from '../../grant-ceiling.ts';
import type { InvitationRecord, InvitationStatus, InvitationStore } from '../../invitation-administration.ts';
import {
  INVITATION_CUSTOM_ROLE_ROW_WRITES,
  INVITATION_ROW_WRITES,
} from '../../invitation-administration.ts';
import type { MembershipRole } from '../../../authorization/roles.ts';

type SqlRow = Record<string, unknown>;

const INVITATION_STATUSES: readonly string[] = Object.freeze([
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

const NON_OWNER_ROLES: readonly string[] = Object.freeze(['admin', 'business-admin', 'member']);

/**
 * Unwraps the sealed Organization.
 *
 * *** THE PRINCIPAL COMPARISON IS VACUOUS HERE AND THAT IS SAID RATHER THAN HIDDEN. ***
 * `consumeAuthenticatedOrganizationId` checks two things — that the value came from the sealer, and
 * that it was sealed for the principal now presenting it. **An adapter has no independent principal
 * to compare against**, so passing the brand's own `principalId` re-checks nothing on that second
 * clause. **The brand check is the half that does work here**; the principal binding was
 * established by `TenantAdminAuthority.resolve`, which had both values, and this call cannot
 * re-establish it. Written out because `consumeAuthenticatedOrganizationId(x, x.principalId)` looks
 * like a full check and is one and a half.
 */
function organizationOf(organization: AuthenticatedOrganizationId): string {
  return consumeAuthenticatedOrganizationId(organization, organization.principalId);
}

function text(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  const asText = typeof value === 'string' ? value : String(value);
  return asText === '' ? null : asText;
}

function required(row: SqlRow, column: string): string | null {
  const value = text(row, column);
  return value;
}

/**
 * Maps one row, REFUSING anything it does not recognise rather than coercing it.
 *
 * **AN UNRECOGNISED `status` OR `role` REFUSES THE WHOLE PAGE**, and it is the same choice
 * `member-directory.ts` makes for a seat over its role bound: a row Core cannot interpret is a
 * migration that has run ahead of the code, and **serving the rest of the page silently omits a
 * record an administrator is looking at the screen to find.** `internal()` rather than a filter.
 */
function toRecord(row: SqlRow): InvitationRecord | null {
  const invitationId = required(row, 'invitation_id');
  const status = required(row, 'status');
  const role = required(row, 'role');
  const createdAt = required(row, 'created_at');
  const expiresAt = required(row, 'expires_at');
  const createdBy = required(row, 'created_by_principal_id');
  const organizationId = required(row, 'organization_id');
  if (
    invitationId === null ||
    status === null ||
    role === null ||
    createdAt === null ||
    expiresAt === null ||
    createdBy === null ||
    organizationId === null
  ) {
    return null;
  }
  if (!INVITATION_STATUSES.includes(status) || !NON_OWNER_ROLES.includes(role)) {
    return null;
  }
  return Object.freeze({
    organizationId,
    invitationId,
    // NULL ONCE TERMINAL, BY `0021`'s CHECK. `text()` maps the empty string to null as well, which
    // is right here: an empty address is not an address, and it cannot be produced by the create
    // path because the contract bounds `identifier` at minLength 3.
    identifier: text(row, 'identifier'),
    role: role as Exclude<MembershipRole, 'owner'>,
    storedStatus: status as InvitationStatus,
    createdAt,
    expiresAt,
    createdByPrincipalId: createdBy,
  });
}

export function createD1InvitationStore(database: D1Database): InvitationStore {
  return {
    async sweepLapsed(organization, nowIso, limit, reservation) {
      const organizationId = organizationOf(organization);
      // ===================================================================================
      // WORST CASE, CONSUMED BEFORE THE STATEMENT RUNS. Under-reserving is the dangerous
      // direction (`0014` §A.12), and the number of rows a sweep will touch is not known until
      // after it has touched them. `0021`'s free-tier block sizes the reservation the same way:
      // `2 x LIMIT`, the row and its `(organization_id, status)` entry.
      // ===================================================================================
      consumeControlPlaneWriteReservation(reservation, 2 * limit);
      try {
        // ===============================================================================
        // *** THE SUBQUERY IS NOT STYLE. `UPDATE … LIMIT` DOES NOT PARSE. ***
        // ===============================================================================
        //
        // Measured: SQLite 3.51.2, `ENABLE_UPDATE_DELETE_LIMIT` = 0, `near "LIMIT": syntax error`.
        // That clause needs an optional compile-time flag. **D1's build is unmeasured** —
        // `d1_database_query` is withheld — so this form uses core syntax only and is correct
        // whichever way that goes, which makes the question moot rather than answering it.
        //
        // **AND THE OBVIOUS REPAIR IS THE DANGEROUS ONE.** `qa-agent` performed it rather than
        // describing it: deleting the `LIMIT` parses, reports `changes 20`, and spends 40
        // row-writes against a reservation sized for 16.
        //
        // *** `identifier = NULL` IS NOT OPTIONAL. *** `0021`'s
        // `CHECK (status = 'pending' OR identifier IS NULL)` is evaluated on the row this
        // statement produces, so `SET status = 'expired'` alone is REFUSED. This sweep runs
        // before the insert on the create path, so omitting the clear does not slow an index —
        // **every subsequent invitation creation in the Organization fails.**
        //
        // *** `RETURNING` RATHER THAN `meta.changes`, AND THAT IS THE BOUNDARY DOING ITS JOB. ***
        // `D1PreparedStatement` in `storage/adapters/d1/d1-store.ts` exposes `bind` and `all` and
        // nothing else — *"the subset of the D1 binding surface this adapter uses."* Reaching for
        // `.run().meta.changes` would have meant WIDENING A CLOUDFLARE BOUNDARY TYPE to get a row
        // count that `RETURNING` already yields in portable SQL. **The narrow surface refused the
        // Cloudflare-shaped answer and the SQL-shaped one is better** — `0003`'s replaceability
        // constraint paying off at the one moment it was tested.
        const swept = await database
          .prepare(
            `UPDATE invitation SET status = 'expired', identifier = NULL
              WHERE (organization_id, invitation_id) IN (
                      SELECT organization_id, invitation_id FROM invitation
                       WHERE organization_id = ?1 AND status = 'pending' AND expires_at <= ?2
                       LIMIT ?3)
            RETURNING invitation_id`,
          )
          .bind(organizationId, nowIso, limit)
          .all();
        // **THE COUNT IS THE RETURNED ROWS, AND A DOUBLE THAT FLATTENS `RETURNING` TO AN EMPTY
        // RESULT MAKES THIS REPORT ZERO.** This repository has already shipped exactly that double,
        // harmless then only because *"no adapter happened to read a batch result"* (`workflow.md`
        // §11a). One does now: a fake returning `{results: []}` makes a working sweep look like a
        // sweep that found nothing, which is the reassuring direction. `qa-agent` is owed a case
        // that sweeps a known number and asserts the number, not merely that it did not throw.
        return ok((swept.results ?? []).length);
      } catch {
        return err(unavailable());
      }
    },

    async listInvitations(organization, limit, cursor) {
      const organizationId = organizationOf(organization);
      try {
        // ===============================================================================
        // *** THE ORDER IS THE CONTRACT'S AND IT IS NOT NEGOTIABLE HERE. ***
        // ===============================================================================
        //
        // `tenant-invitations-v1.schema.json`, `listInvitationsOutput`, verbatim: **"ORDER IS FIXED
        // AND TOTAL: created_at descending, then invitation_id ascending. Newest first is what an
        // administrator wants and invitation_id is the tiebreaker that makes the cursor correct."**
        //
        // *** THIS ADAPTER ORDERED BY `invitation_id` ALONE UNTIL 2026-09-13, AND THAT WAS A
        // NON-CONFORMANCE RATHER THAN A GAP. *** The reasoning that produced it — *"the contract
        // leaves ordering unspecified, so an adapter must not settle a presentation question"* —
        // was **a sound principle applied to a false premise.** The contract had specified the
        // order from the day it was written. **The concern was that storage would INVENT an order;
        // what happened is that storage OVERRODE one**, and nothing went red because the contract
        // is prose that nothing executes (`workflow.md` §12's *expressed versus enforced*).
        //
        // ===============================================================================
        // THE CURSOR IS STILL ONE IDENTIFIER, AND NO SEPARATOR IS INVENTED TO CARRY TWO
        // ===============================================================================
        //
        // A keyset over two columns needs both anchor values. **They are recovered by a point
        // lookup on the anchor rather than packed into the cursor string** — because packing two
        // values into one string means choosing a delimiter, and this repository has been bitten
        // by delimiter choices repeatedly (`encodeAuditAnchor`'s NUL is in the source-byte
        // quarantine to this day). **A third scheme here would be a third chance to get it wrong.**
        //
        // *** IT IS SOUND BECAUSE BOTH SORT KEYS ARE IMMUTABLE. *** `created_at` is written once
        // and `invitation_id` is the primary key, so the anchor row's position in the ordering
        // cannot move between pages — **the sweep may change its `status` under a paging caller and
        // the ORDER is unaffected**, which is exactly the property that would fail if the sort
        // included a mutable column.
        //
        // THE COMPARISON IS SPELLED OUT RATHER THAN WRITTEN AS A ROW VALUE. `(a, b) < (x, y)`
        // assumes one direction for both columns, and this ordering is DESC then ASC — a row-value
        // comparison would be quietly wrong on the tiebreaker, which is the case it exists for.
        const rows = await database
          .prepare(
            `SELECT organization_id, invitation_id, role, status, identifier,
                    created_at, created_by_principal_id, expires_at
               FROM invitation
              WHERE organization_id = ?1
                AND (?2 IS NULL OR
                     created_at < (SELECT created_at FROM invitation
                                    WHERE organization_id = ?1 AND invitation_id = ?2)
                     OR (created_at = (SELECT created_at FROM invitation
                                        WHERE organization_id = ?1 AND invitation_id = ?2)
                         AND invitation_id > ?2))
              ORDER BY created_at DESC, invitation_id ASC
              LIMIT ?3`,
          )
          // ONE MORE THAN THE PAGE, so "is there a next page" is answered by the read rather than
          // by a second COUNT over the same rows.
          .bind(organizationId, cursor, limit + 1)
          .all();
        const results = rows.results ?? [];
        const page = results.slice(0, limit);
        const mapped: InvitationRecord[] = [];
        for (const row of page) {
          const record = toRecord(row as SqlRow);
          if (record === null) {
            return err(internal());
          }
          mapped.push(record);
        }
        const nextCursor =
          results.length > limit && mapped.length > 0
            ? (mapped[mapped.length - 1]?.invitationId ?? null)
            : null;
        return ok({ rows: Object.freeze(mapped), nextCursor });
      } catch {
        return err(unavailable());
      }
    },

    async findInvitation(organization, invitationId) {
      const organizationId = organizationOf(organization);
      try {
        // THE COMPOSITE KEY, SO THERE IS NO QUESTION TO LEAK. An invitation belonging to another
        // Organization and one that does not exist produce the same empty result — the service
        // above collapses both to `notFound`, and the distinction is not available here to be
        // suppressed.
        // `all()` AND TAKE THE HEAD, because the boundary type exposes no `first()`. The composite
        // primary key means at most one row can match, so this is a point lookup wearing a list's
        // return type rather than an unbounded read.
        const found = await database
          .prepare(
            `SELECT organization_id, invitation_id, role, status, identifier,
                    created_at, created_by_principal_id, expires_at
               FROM invitation
              WHERE organization_id = ?1 AND invitation_id = ?2`,
          )
          .bind(organizationId, invitationId)
          .all();
        const row = (found.results ?? [])[0];
        if (row === null || row === undefined) {
          return ok(null);
        }
        const record = toRecord(row as SqlRow);
        return record === null ? err(internal()) : ok(record);
      } catch {
        return err(unavailable());
      }
    },

    async createInvitation(organization, record, customRoleIds, ceiling, reservation) {
      const organizationId = organizationOf(organization);
      // ===================================================================================
      // ⚠ THE CEILING RECEIPT IS REQUIRED AND IS **NOT VERIFIED HERE**. SAY WHICH HALF HOLDS.
      // ===================================================================================
      //
      // `architecture.md` §3a ranks the layers and warns against overstating a guard in its own
      // comment, so: **the load-bearing half holds.** `ceiling` is a required parameter, it can
      // only be produced by `clearGrantCeiling`, and **omitting the check does not compile.**
      //
      // **THE SUBJECT-BINDING HALF DOES NOT.** §3a also requires that *"where the receipt names a
      // subject, the consumer compares it against the record it is writing — a receipt minted for A
      // and spent on B is the obvious hole."* `consumeGrantCeilingClearance` needs the
      // `TenantAdminAuthority` and the `OfferedGrant` to make that comparison, **and this port
      // passes neither** — it takes `(organizationId, record, customRoleIds, ceiling, reservation)`.
      // So a clearance minted for a different grantor or a different offered role would be spent
      // here without complaint.
      //
      // **THAT IS A DEFECT IN THE PORT I WROTE, FOUND BY WRITING THE ADAPTER FOR IT.** The
      // compiler said it out loud — `ceiling` declared and never read — and **silencing that with
      // an underscore would have been the wrong answer to a true diagnostic** (`workflow.md` §11a:
      // when the typechecker refuses, read why before making the red go away).
      //
      // **SO THE HALF THAT IS AVAILABLE HERE IS CHECKED, AND IT IS THE TENANT-ISOLATION HALF.**
      // `consumeGrantCeilingClearanceAtStorage` verifies the brand and the Organization, so a
      // clearance minted in one tenant cannot fund a write in another. **The grantor and the offer
      // fingerprint remain unchecked** — within one Organization, a clearance minted for a
      // different administrator or a different offered role is still spent here without complaint.
      // That residual closes when the port carries the authority and the offer, or when the service
      // consumes before calling the store; both are the Team Lead's to sequence, because
      // `qa-agent` has cases against this shape.
      consumeGrantCeilingClearanceAtStorage(ceiling, organizationId);
      consumeControlPlaneWriteReservation(
        reservation,
        INVITATION_ROW_WRITES + INVITATION_CUSTOM_ROLE_ROW_WRITES * customRoleIds.length,
      );
      try {
        const statements = [
          database
            .prepare(
              `INSERT INTO invitation (organization_id, invitation_id, role, status, identifier,
                                       created_at, created_by_principal_id, expires_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            )
            .bind(
              organizationId,
              record.invitationId,
              record.role,
              record.storedStatus,
              record.identifier,
              record.createdAt,
              record.createdByPrincipalId,
              record.expiresAt,
            ),
          ...customRoleIds.map((roleId) =>
            database
              .prepare(
                `INSERT INTO invitation_custom_role (organization_id, invitation_id, role_id)
                 VALUES (?1, ?2, ?3)`,
              )
              .bind(organizationId, record.invitationId, roleId),
          ),
        ];
        // ONE BATCH, WHICH D1 EXECUTES AS A SINGLE IMPLICIT TRANSACTION. An invitation row without
        // its custom roles is an invitation that confers less than the administrator chose, and
        // the roles without the row cannot exist — the composite foreign key refuses them. **The
        // batch is what makes `3 + 2N` one operation rather than N + 1 of them.**
        await database.batch(statements);
        return ok(undefined);
      } catch {
        return err(unavailable());
      }
    },
  };
}
