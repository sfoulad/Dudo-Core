/**
 * The Template D1 adapter.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place a Cloudflare type may be named. Nothing
 * D1-shaped leaves this file.
 *
 * IT TAKES THE CONTROL-PLANE BINDING. `template` is tenant-independent and has no `tenant_id`
 * column, so this file must never import `storage/adapters/sql/sql-compiler.ts` — that compiler
 * emits `tenant_id = ?` on every statement it produces.
 *
 * EVERY STATEMENT IS A POINT LOOKUP OR A BOUNDED KEYSET SCAN, each served by an index the
 * migration already creates.
 */

import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { internal, unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import type { ControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import { consumeControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import type {
  NewTemplate,
  TemplateStatusOutcome,
  TemplateStore,
  TemplateUpdateOutcome,
} from '../../template-store.ts';
import type { TemplateLabels, TemplateRecord, TemplateStatus } from '../../templates.ts';
import { TEMPLATE_STATUSES } from '../../templates.ts';

type SqlRow = Record<string, unknown>;

function text(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  const asText = typeof value === 'string' ? value : String(value);
  return asText === '' ? null : asText;
}

// ONE DEFINITION, IMPORTED. This file held its own copy until 2026-09-11, and a third was about to
// be written for the list filter — `workflow.md` §12's duplicated constraint, on two strings.
const STATUSES: readonly TemplateStatus[] = TEMPLATE_STATUSES;

function toRecord(row: SqlRow): TemplateRecord | null {
  const templateId = text(row, 'template_id');
  const name = text(row, 'name');
  const organization = text(row, 'label_organization');
  const workspace = text(row, 'label_workspace');
  const branch = text(row, 'label_branch');
  const createdAt = text(row, 'created_at');
  const statusText = text(row, 'status');
  const status = STATUSES.find((candidate) => candidate === statusText);
  if (
    templateId === null ||
    name === null ||
    organization === null ||
    workspace === null ||
    branch === null ||
    createdAt === null ||
    status === undefined
  ) {
    // A stored enumeration outside the union, or a NOT NULL column reading empty. `internal()`
    // fails closed AND leaves evidence — the same treatment `d1-control-plane-store.ts` gives a
    // bad `status`, and for its reason: coercing an unknown value to a default would be schema
    // drift presenting as behaviour.
    return null;
  }
  return {
    templateId,
    name,
    labels: Object.freeze({ organization, workspace, branch }),
    status,
    createdAt,
  };
}

export function createD1TemplateStore(database: D1Database): TemplateStore {
  return {
    async create(
      record: NewTemplate,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<boolean>> {
      // NO ADMISSION, NO WRITE — `0014` §A.11.
      consumeControlPlaneWriteReservation(reservation, 1);
      try {
        // =====================================================================================
        // THE COLLISION IS DECIDED BY THE UNIQUE INDEX, IN THE SAME STATEMENT THAT WRITES.
        // =====================================================================================
        //
        // `ON CONFLICT ... DO NOTHING ... RETURNING template_id` gives one row when the insert
        // happened and none when the normalised name was taken. **A prior `SELECT` would be a
        // read-then-write**: two concurrent creates would both see "no collision", and one would
        // fail on the constraint anyway — with an error the caller could not distinguish from a
        // database fault.
        //
        // `RETURNING` rather than rows-affected, for the reason `d1-confirmation-store.ts` states:
        // Core's `D1PreparedStatement` exposes only `bind` and `all`, and widening a
        // Cloudflare-shaped type to carry a row count would be a permanent cost against
        // `architecture.md` §6. Verified on D1's own engine and on `node:sqlite`.
        //
        // `DO NOTHING` RATHER THAN `DO UPDATE`. An upsert here would let a create silently
        // overwrite an existing Template's labels — which is the UPDATE that `template-v1` TM-1
        // deliberately does not have, arriving through the create route without anyone deciding
        // it. Contrast `confirmation`'s upsert, where re-issuing IS issuing.
        const outcome = await database
          .prepare(
            'INSERT INTO template (template_id, name, normalized_name, label_organization, ' +
              'label_workspace, label_branch, status, created_at) ' +
              "VALUES (?, ?, ?, ?, ?, ?, 'active', ?) " +
              'ON CONFLICT (normalized_name) DO NOTHING ' +
              'RETURNING template_id',
          )
          .bind(
            record.templateId,
            record.name,
            record.normalizedName,
            record.labels.organization,
            record.labels.workspace,
            record.labels.branch,
            record.createdAt,
          )
          .all<{ template_id: string }>();
        return ok(outcome.results.length === 1);
      } catch {
        return err(unavailable());
      }
    },

    async list(
      limit: number,
      afterTemplateId: string | null,
      status: TemplateStatus | null,
    ): Promise<Result<readonly TemplateRecord[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        return err(internal());
      }
      // Keyset scan on the primary key. The limit is inlined as a validated integer, exactly as
      // `sql-compiler.ts` and `listOrganizations` do, so it cannot carry caller-controlled text.
      //
      // *** THE STATUS IS A BOUND PARAMETER AND IS NEVER INLINED, unlike the limit. *** The limit is
      // an integer this method has just validated; the status arrives from a query string. It is
      // checked against the closed enum above this port as well, so this is the second layer rather
      // than the only one — and the two clauses are composed rather than concatenated as text so a
      // caller cannot reach the SQL from either direction.
      const clauses: string[] = [];
      const parameters: string[] = [];
      if (afterTemplateId !== null) {
        clauses.push('template_id > ?');
        parameters.push(afterTemplateId);
      }
      if (status !== null) {
        clauses.push('status = ?');
        parameters.push(status);
      }
      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')} `;
      const sql =
        'SELECT template_id, name, label_organization, label_workspace, label_branch, ' +
        `status, created_at FROM template ${where}` +
        `ORDER BY template_id ASC LIMIT ${String(limit)}`;
      try {
        const outcome = await database
          .prepare(sql)
          .bind(...parameters)
          .all<SqlRow>();
        const templates: TemplateRecord[] = [];
        for (const row of outcome.results) {
          const record = toRecord(row);
          if (record === null) {
            return err(internal());
          }
          templates.push(record);
        }
        return ok(templates);
      } catch {
        return err(unavailable());
      }
    },

    async update(
      templateId: string,
      next: {
        readonly name: string;
        readonly normalizedName: string;
        readonly labels: TemplateLabels;
      },
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<TemplateUpdateOutcome>> {
      // NO ADMISSION, NO WRITE — `0014` §A.11.
      consumeControlPlaneWriteReservation(reservation, 1);
      try {
        // =====================================================================================
        // BOTH PRECONDITIONS ARE RE-ASKED IN THE STATEMENT THAT WRITES. `architecture.md` §3a.
        // =====================================================================================
        //
        // The caller has already read this row — it needs the stored labels as the merge base —
        // and **that read is stale by the time this runs.** A concurrent retire, or a concurrent
        // create taking the name, both land in the window. The in-statement guard has no window.
        //
        // `template_id <> ?` IS THE SELF-COMPARISON EXCLUSION and the contract names the trap:
        // *"the obvious implementation — 'does any row have this normalised name' — returns the
        // row itself and refuses every edit that keeps the name."*
        //
        // `RETURNING` rather than rows-affected, for `create`'s reason: Core's
        // `D1PreparedStatement` exposes only `bind` and `all`, and widening a Cloudflare-shaped
        // type to carry a row count would be a permanent cost against `architecture.md` §6.
        const written = await database
          .prepare(
            'UPDATE template SET name = ?, normalized_name = ?, label_organization = ?, ' +
              'label_workspace = ?, label_branch = ? ' +
              "WHERE template_id = ? AND status = 'active' " +
              'AND NOT EXISTS (SELECT 1 FROM template other WHERE other.normalized_name = ? ' +
              'AND other.template_id <> ?) ' +
              'RETURNING template_id',
          )
          .bind(
            next.name,
            next.normalizedName,
            next.labels.organization,
            next.labels.workspace,
            next.labels.branch,
            templateId,
            next.normalizedName,
            templateId,
          )
          .all<{ template_id: string }>();
        if (written.results.length === 1) {
          return ok('updated');
        }

        // =====================================================================================
        // ZERO ROWS MEANS ONE OF FOUR THINGS AND THE STATEMENT CANNOT SAY WHICH.
        // =====================================================================================
        //
        // *** THIS SECOND READ RUNS ONLY ON THE REFUSAL PATH. *** The success path is one
        // statement and keeps the no-window property; classification costs a read exactly when
        // the answer is already "no write happened", which is the cheap half to spend.
        //
        // A classifying read is NOT a read-then-write — nothing is written after it. It reports
        // why a write that already did not happen did not happen.
        const why = await database
          .prepare(
            'SELECT status, (SELECT COUNT(*) FROM template other ' +
              'WHERE other.normalized_name = ? AND other.template_id <> ?) AS taken ' +
              'FROM template WHERE template_id = ? LIMIT 1',
          )
          .bind(next.normalizedName, templateId, templateId)
          .all<SqlRow>();
        if (why.results.length === 0) {
          return ok('not_found');
        }
        const row = why.results[0];
        if (text(row, 'status') === 'retired') {
          return ok('retired');
        }
        const taken = row['taken'];
        if (typeof taken === 'number' ? taken > 0 : Number(taken) > 0) {
          return ok('name_taken');
        }
        // THE GUARD REFUSED AND NOTHING IS WRONG NOW, WHICH ONLY A CONCURRENT WRITE EXPLAINS.
        // Reported as itself rather than as a collision — see the port for why a false "collision"
        // is worse than an honest "retry".
        return ok('raced');
      } catch {
        return err(unavailable());
      }
    },

    async setStatus(
      templateId: string,
      transition: { readonly from: TemplateStatus; readonly to: TemplateStatus },
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<TemplateStatusOutcome>> {
      consumeControlPlaneWriteReservation(reservation, 1);
      try {
        // `AND status = ?` IS THE `failed_precondition` GUARD AND IT IS IN THE WRITE. A retire that
        // checked the current state with a prior read would succeed twice under concurrency and
        // write two audit records for one transition.
        const written = await database
          .prepare(
            'UPDATE template SET status = ? WHERE template_id = ? AND status = ? ' +
              'RETURNING template_id',
          )
          .bind(transition.to, templateId, transition.from)
          .all<{ template_id: string }>();
        if (written.results.length === 1) {
          return ok('updated');
        }
        // Zero rows is either "no such Template" or "not in the expected state". One point lookup
        // on the primary key separates them, on the refusal path only.
        const existing = await database
          .prepare('SELECT template_id FROM template WHERE template_id = ? LIMIT 1')
          .bind(templateId)
          .all<SqlRow>();
        return ok(existing.results.length === 0 ? 'not_found' : 'already_in_state');
      } catch {
        return err(unavailable());
      }
    },

    async count(): Promise<Result<number>> {
      // `COUNT(*)`, NEVER A FETCH-AND-LENGTH — the same number on the wire and a different number
      // against `d1-rows-read`. NO `WHERE`: this counts the table, both statuses, and the port says
      // why a filter would make it a different question under the same name.
      try {
        const outcome = await database
          .prepare('SELECT COUNT(*) AS total FROM template')
          .all<SqlRow>();
        // ONE ROW ALWAYS, INCLUDING ON AN EMPTY TABLE. An empty result set means the statement did
        // not run as written, which is `internal()` rather than a silent zero: **"nothing was found"
        // and "nothing was examined" must not render the same way** (`workflow.md` §11a).
        if (outcome.results.length !== 1) {
          return err(internal());
        }
        const raw = outcome.results[0]['total'];
        const total = typeof raw === 'number' ? raw : Number(raw);
        return Number.isInteger(total) && total >= 0 ? ok(total) : err(internal());
      } catch {
        return err(unavailable());
      }
    },

    async findById(templateId: string): Promise<Result<TemplateRecord | null>> {
      // Point lookup on the primary key.
      try {
        const outcome = await database
          .prepare(
            'SELECT template_id, name, label_organization, label_workspace, label_branch, ' +
              'status, created_at FROM template WHERE template_id = ? LIMIT 1',
          )
          .bind(templateId)
          .all<SqlRow>();
        if (outcome.results.length === 0) {
          return ok(null);
        }
        const record = toRecord(outcome.results[0]);
        return record === null ? err(internal()) : ok(record);
      } catch {
        return err(unavailable());
      }
    },
  };
}
