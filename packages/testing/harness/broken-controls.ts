/**
 * THE NEGATIVE CONTROLS. Three of them, one per control the tenancy model rests on.
 *
 * `TESTING_STANDARD.md` §5.6 is explicit that a passing isolation suite is ceremony until it
 * is shown to go red when isolation is broken, and that the break must be applied to EACH of
 * the three controls separately "because a suite can be sensitive to one and blind to the
 * others":
 *
 *   1. THE PREDICATE — `whereWithTenant` in the SQL compiler.
 *   2. THE RESOLVER  — `TenantStoreResolver`, which decides which handle a request gets.
 *   3. THE BOUNDARY  — the storage port itself, bypassed by a path that reaches the engine
 *                      without it.
 *
 * NOTHING IN `platform/core/**` IS EDITED TO PRODUCE ANY OF THEM, and that is a hard
 * constraint rather than a convenience: qa-agent does not modify production code, and
 * `TESTING_STANDARD.md` §5.6 requires that "the break is never committed".
 *
 * HOW THE PREDICATE BREAK IS APPLIED WITHOUT TOUCHING THE COMPILER. `createPredicateBrokenStore`
 * calls the REAL `compileSelect` / `compileUpdate` / `compileDelete`, then removes the
 * `tenant_id = ?` term and its bound parameter from the statement before execution. That is
 * exactly the mutation `sql-compiler.ts` describes as the negative control — "remove the
 * tenant clause from `whereWithTenant`" — and applying it to the compiler's own output rather
 * than to a copy of the compiler means the control cannot drift away from the code it is
 * testing. `compileInsert` is left alone: it SETS the tenant column rather than filtering on
 * it, `whereWithTenant` is not involved, and a fixture whose inserts lost their tenant would
 * no longer contain two Organizations to confuse.
 */

import type {
  DeleteSpec,
  InsertSpec,
  Row,
  SelectSpec,
  TenantScopedStore,
  UpdateSpec,
  WriteOperation,
} from '../../../platform/core/storage/store.ts';
import type { Predicate, SqlValue } from '../../../platform/core/storage/predicate.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { internal, unavailable } from '../../../platform/core/kernel/errors.ts';
import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
} from '../../../platform/core/storage/adapters/sql/sql-compiler.ts';
import type { CompiledStatement } from '../../../platform/core/storage/adapters/sql/sql-compiler.ts';
import { createD1TenantStore } from '../../../platform/core/storage/adapters/d1/d1-store.ts';
import { mintWriteReservation } from '../../../platform/core/protection/write-admission.ts';
import type { SqliteHarness } from './sqlite-d1.ts';

const TENANT_TERM_WITH_REST = 'WHERE tenant_id = ? AND ';
const TENANT_TERM_ALONE = 'WHERE tenant_id = ?';

/**
 * Removes the tenant term and the parameter bound to it.
 *
 * `tenantParameterIndex` differs by statement kind because `whereWithTenant` pushes the
 * tenant parameter at the point the WHERE clause is built: first for SELECT and DELETE, and
 * after the SET values for UPDATE. Getting this wrong would shift every remaining parameter
 * by one and produce a suite that goes red for a reason that has nothing to do with tenancy —
 * so it is computed from the spec rather than assumed.
 */
function stripTenantTerm(
  statement: CompiledStatement,
  tenantParameterIndex: number,
): CompiledStatement {
  let sql = statement.sql;
  if (sql.includes(TENANT_TERM_WITH_REST)) {
    sql = sql.replace(TENANT_TERM_WITH_REST, 'WHERE ');
  } else if (sql.includes(TENANT_TERM_ALONE)) {
    sql = sql.replace(TENANT_TERM_ALONE, 'WHERE 1 = 1');
  } else {
    throw new Error(
      'The negative control could not find the tenant term in a compiled statement. ' +
        'Either the compiler changed shape or the control is applied to the wrong statement; ' +
        'either way it must not silently do nothing.',
    );
  }
  const parameters = [...statement.parameters];
  parameters.splice(tenantParameterIndex, 1);
  return { sql, parameters };
}

/** CONTROL 1: the tenant predicate is removed. The business predicate is left in place. */
export function createPredicateBrokenStore(
  harness: SqliteHarness,
  tenantId: string,
): TenantScopedStore {
  return {
    async select(spec: SelectSpec): Promise<Result<readonly Row[]>> {
      let statement: CompiledStatement;
      try {
        statement = stripTenantTerm(compileSelect(tenantId, spec), 0);
      } catch {
        return err(internal());
      }
      try {
        const outcome = await harness.database
          .prepare(statement.sql)
          .bind(...statement.parameters)
          .all<Record<string, unknown>>();
        return ok(outcome.results as unknown as readonly Row[]);
      } catch {
        return err(unavailable());
      }
    },

    async write(operations: readonly WriteOperation[]): Promise<Result<void>> {
      if (operations.length === 0) {
        return ok(undefined);
      }
      let statements: CompiledStatement[];
      try {
        statements = operations.map((operation) => {
          if (operation.kind === 'insert') {
            // Left intact on purpose: the insert path sets the tenant column and does not
            // go through `whereWithTenant`. Breaking it would empty the fixture instead of
            // testing it.
            return compileInsert(tenantId, operation.spec as InsertSpec);
          }
          if (operation.kind === 'update') {
            const spec = operation.spec as UpdateSpec;
            return stripTenantTerm(compileUpdate(tenantId, spec), Object.keys(spec.set).length);
          }
          return stripTenantTerm(compileDelete(tenantId, operation.spec as DeleteSpec), 0);
        });
      } catch {
        return err(internal());
      }
      try {
        await harness.database.batch(
          statements.map((statement) =>
            harness.database.prepare(statement.sql).bind(...statement.parameters),
          ),
        );
        return ok(undefined);
      } catch {
        return err(unavailable());
      }
    },
  };
}

/**
 * CONTROL 3: the storage boundary is bypassed entirely.
 *
 * This store never calls the Core compiler and never runs `assertSpecIsTenantSafe`. It builds
 * its own SQL from the caller's spec — which is what a query path that reached the engine
 * directly would look like — so no tenant predicate exists at any point and the spec guard
 * that rejects `tenant_id` as a caller column is absent too. It is deliberately a SECOND
 * implementation: a bypass that reused the boundary's code would not be a bypass.
 */
export function createBoundaryBypassStore(harness: SqliteHarness): TenantScopedStore {
  function compile(predicate: Predicate, parameters: SqlValue[]): string {
    switch (predicate.kind) {
      case 'eq':
        parameters.push(predicate.value);
        return `${predicate.column} = ?`;
      case 'ne':
        parameters.push(predicate.value);
        return `${predicate.column} <> ?`;
      case 'gt':
        parameters.push(predicate.value);
        return `${predicate.column} > ?`;
      case 'gte':
        parameters.push(predicate.value);
        return `${predicate.column} >= ?`;
      case 'lt':
        parameters.push(predicate.value);
        return `${predicate.column} < ?`;
      case 'lte':
        parameters.push(predicate.value);
        return `${predicate.column} <= ?`;
      case 'isNull':
        return `${predicate.column} IS NULL`;
      case 'isNotNull':
        return `${predicate.column} IS NOT NULL`;
      case 'in': {
        if (predicate.values.length === 0) {
          return '0 = 1';
        }
        for (const value of predicate.values) {
          parameters.push(value);
        }
        return `${predicate.column} IN (${predicate.values.map(() => '?').join(', ')})`;
      }
      case 'startsWith':
        parameters.push(`${predicate.value}%`);
        return `${predicate.column} LIKE ?`;
      case 'endsWith':
        parameters.push(`%${predicate.value}`);
        return `${predicate.column} LIKE ?`;
      case 'contains':
        parameters.push(`%${predicate.value}%`);
        return `${predicate.column} LIKE ?`;
      case 'and':
      case 'or': {
        if (predicate.operands.length === 0) {
          return predicate.kind === 'and' ? '1 = 1' : '0 = 1';
        }
        return `(${predicate.operands
          .map((operand) => compile(operand, parameters))
          .join(predicate.kind === 'and' ? ' AND ' : ' OR ')})`;
      }
      default:
        throw new Error('unsupported predicate in the bypass control');
    }
  }

  return {
    async select(spec: SelectSpec): Promise<Result<readonly Row[]>> {
      const parameters: SqlValue[] = [];
      const where = spec.where === undefined ? '1 = 1' : compile(spec.where, parameters);
      const sort =
        spec.sort === undefined || spec.sort.length === 0
          ? ''
          : ` ORDER BY ${spec.sort
              .map((entry) => `${entry.column} ${entry.direction === 'desc' ? 'DESC' : 'ASC'}`)
              .join(', ')}`;
      const sql = `SELECT ${spec.columns.join(', ')} FROM ${spec.table} WHERE ${where}${sort} LIMIT ${spec.limit}`;
      try {
        const outcome = await harness.database
          .prepare(sql)
          .bind(...parameters)
          .all<Record<string, unknown>>();
        return ok(outcome.results as unknown as readonly Row[]);
      } catch {
        return err(unavailable());
      }
    },

    async write(): Promise<Result<void>> {
      // The bypass control is only used for reads in these suites; a write form would add a
      // second unscoped path with no additional evidence.
      return ok(undefined);
    },
  };
}

/**
 * ===========================================================================================
 * CONTROL 4 — THE WRITE ADMISSION. `docs/decisions/0014` §A.11, deliberately not enforced.
 * ===========================================================================================
 *
 * §A.11 says every storage writer must go through the admission port and that direct D1 writes
 * outside it are prohibited. `d1-store.ts` makes that structural by refusing to compile a
 * statement without a valid, unspent, correctly-sized reservation for the tenant the handle
 * serves — four checks, each closing a different bypass.
 *
 * A suite that asserts those four refusals is ceremony until it is shown to go red when the
 * guard stops guarding, and the same rule applies here as to the other three controls: the
 * break is never committed and `platform/core/**` is never edited. So this store wraps the REAL
 * `createD1TenantStore` and quietly REPLACES the caller's reservation with a freshly minted,
 * valid one before passing it down. The guard still runs; it just never sees anything wrong,
 * which is precisely what "the guard has stopped enforcing" looks like from outside.
 *
 * WHY SUBSTITUTE RATHER THAN REIMPLEMENT THE COMPILER. A hand-written store that skipped the
 * check would also skip the tenant predicate, the tenant-column guard and every other property
 * of the real adapter, and a control that breaks four things at once cannot show which one a
 * case is sensitive to. This one breaks exactly one.
 *
 * NOTE THAT `mintWriteReservation` IS BEING CALLED ON A PATH THAT DECREMENTED NO COUNTER, which
 * its own documentation says in capitals defeats §A.1. That is the point of the control, and it
 * is the reason this function exists in this file rather than anywhere a production composition
 * root could reach.
 */
export function createAdmissionBypassStore(
  harness: SqliteHarness,
  tenantId: string,
): TenantScopedStore {
  const real = createD1TenantStore(harness.database, tenantId);
  return {
    select(spec: SelectSpec): Promise<Result<readonly Row[]>> {
      return real.select(spec);
    },
    write(operations: readonly WriteOperation[]): Promise<Result<void>> {
      return real.write(
        operations,
        mintWriteReservation({
          organizationId: tenantId,
          allocation: 'business',
          // Always large enough that the size check cannot bind either.
          estimatedRowWrites: Math.max(1, operations.length),
          dayStartMs: 0,
        }),
      );
    },
  };
}
