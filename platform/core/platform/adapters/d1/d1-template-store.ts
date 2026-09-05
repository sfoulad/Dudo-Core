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
import type { NewTemplate, TemplateStore } from '../../template-store.ts';
import type { TemplateRecord, TemplateStatus } from '../../templates.ts';

type SqlRow = Record<string, unknown>;

function text(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  const asText = typeof value === 'string' ? value : String(value);
  return asText === '' ? null : asText;
}

const STATUSES: readonly TemplateStatus[] = ['active', 'retired'];

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
    ): Promise<Result<readonly TemplateRecord[]>> {
      if (!Number.isInteger(limit) || limit < 1) {
        return err(internal());
      }
      // Keyset scan on the primary key. The limit is inlined as a validated integer, exactly as
      // `sql-compiler.ts` and `listOrganizations` do, so it cannot carry caller-controlled text.
      const sql =
        afterTemplateId === null
          ? 'SELECT template_id, name, label_organization, label_workspace, label_branch, ' +
            `status, created_at FROM template ORDER BY template_id ASC LIMIT ${String(limit)}`
          : 'SELECT template_id, name, label_organization, label_workspace, label_branch, ' +
            'status, created_at FROM template WHERE template_id > ? ' +
            `ORDER BY template_id ASC LIMIT ${String(limit)}`;
      try {
        const outcome = await database
          .prepare(sql)
          .bind(...(afterTemplateId === null ? [] : [afterTemplateId]))
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
