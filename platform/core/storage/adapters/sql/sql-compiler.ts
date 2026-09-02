/**
 * Spec -> parameterised SQL. THE TENANT PREDICATE IS EMITTED HERE AND NOWHERE ELSE.
 *
 * This file is the single point the whole tenancy model rests on. Under
 * docs/decisions/0006 Option A there is no infrastructure boundary beneath it: every
 * Organization's rows are in one database, and `tenant_id = ?` is what keeps them apart.
 *
 * Read the four functions below as one claim: EVERY statement this compiler can produce
 * begins its WHERE clause with `tenant_id = ?`, and there is no code path through any of
 * them that does not. `compileSelect`, `compileUpdate` and `compileDelete` each call
 * `whereWithTenant`, which is not optional and takes no flag. `compileInsert` sets the
 * column rather than filtering on it, which is the same guarantee in the only form an
 * INSERT has.
 *
 * The negative control the Customer Directory contract requires (README.md §12) is run
 * against this file: remove the tenant clause from `whereWithTenant`, and every isolation
 * test in the suite must go red. If removing it turns only some of them red, coverage is
 * incomplete and the contract says the suite is what is wrong, not the finding.
 *
 * WHY THE COMPILER IS AN ADAPTER-SIDE FILE. It emits SQL, which is a property of the
 * storage engine, not of the domain. It is shared by every SQL-speaking adapter so that
 * two adapters cannot drift into two different meanings for `contains`, which would make
 * a search return different rows depending on where it ran.
 */

import type {
  DeleteSpec,
  InsertSpec,
  SelectSpec,
  UpdateSpec,
} from '../../store.ts';
import { TENANT_COLUMN, assertSpecIsTenantSafe } from '../../store.ts';
import type { Predicate, SqlValue } from '../../predicate.ts';

export type CompiledStatement = {
  readonly sql: string;
  readonly parameters: readonly SqlValue[];
};

/**
 * The LIKE escape character. Chosen as backslash and declared explicitly with ESCAPE on
 * every LIKE, because SQLite has no default escape character: without the clause, a `%` or
 * `_` inside a caller's value is a wildcard and a search term becomes a pattern.
 *
 * The Customer Directory contract requires that `%` and `_` be literal
 * (customer-directory-v1.schema.json searchQuery, README.md §7.4). That is a
 * one-character difference between "the caller may not inject a pattern" and "the caller
 * may match most of a directory with two keystrokes", so it is enforced here rather than
 * left to each query to remember.
 */
const LIKE_ESCAPE = '\\';

function escapeForLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function compilePredicate(predicate: Predicate, parameters: SqlValue[]): string {
  switch (predicate.kind) {
    case 'eq':
      if (predicate.value === null) {
        return `${predicate.column} IS NULL`;
      }
      parameters.push(predicate.value);
      return `${predicate.column} = ?`;
    case 'ne':
      if (predicate.value === null) {
        return `${predicate.column} IS NOT NULL`;
      }
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
      // An empty IN list matches nothing. Emitting `IN ()` is a syntax error in SQLite, and
      // emitting nothing at all would silently WIDEN the query to every row the rest of the
      // predicate allows -- which, for a business-set narrowing, is the whole Organization.
      // A principal authorized over no Business must see no rows, so this is `0 = 1`.
      if (predicate.values.length === 0) {
        return '0 = 1';
      }
      for (const value of predicate.values) {
        parameters.push(value);
      }
      const placeholders = predicate.values.map(() => '?').join(', ');
      return `${predicate.column} IN (${placeholders})`;
    }
    case 'startsWith':
      parameters.push(`${escapeForLike(predicate.value)}%`);
      return `${predicate.column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`;
    case 'endsWith':
      parameters.push(`%${escapeForLike(predicate.value)}`);
      return `${predicate.column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`;
    case 'contains':
      parameters.push(`%${escapeForLike(predicate.value)}%`);
      return `${predicate.column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`;
    case 'and':
    case 'or': {
      // An empty AND is vacuously true and an empty OR is vacuously false. Stating both
      // explicitly avoids an empty group compiling to `()`, and avoids an empty OR quietly
      // disappearing from a conjunction it was meant to narrow.
      if (predicate.operands.length === 0) {
        return predicate.kind === 'and' ? '1 = 1' : '0 = 1';
      }
      const parts = predicate.operands.map((operand) => compilePredicate(operand, parameters));
      return `(${parts.join(predicate.kind === 'and' ? ' AND ' : ' OR ')})`;
    }
    default: {
      // Exhaustiveness. A new predicate kind that is not handled must stop the request
      // rather than compile to a clause that narrows nothing.
      const unreachable: never = predicate;
      throw new Error(`Unsupported predicate: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * THE TENANT CLAUSE. Every read and every write goes through here.
 *
 * The tenant parameter is pushed FIRST, and the caller's predicate is AND-ed after it, so
 * a caller-supplied `or` group can never reach outside the tenant: `tenant_id = ? AND (
 * ...anything the caller wrote... )`. An OR at the top level of a caller's predicate is
 * still inside the parenthesised group.
 */
function whereWithTenant(
  tenantId: string,
  predicate: Predicate | undefined,
  parameters: SqlValue[],
): string {
  parameters.push(tenantId);
  if (predicate === undefined) {
    return `WHERE ${TENANT_COLUMN} = ?`;
  }
  const rest = compilePredicate(predicate, parameters);
  return `WHERE ${TENANT_COLUMN} = ? AND ${rest}`;
}

export function compileSelect(tenantId: string, spec: SelectSpec): CompiledStatement {
  assertSpecIsTenantSafe(spec);
  if (spec.columns.length === 0) {
    throw new Error('A select spec must name at least one column.');
  }
  if (!Number.isInteger(spec.limit) || spec.limit < 1) {
    throw new Error('A select spec must carry a positive integer limit.');
  }

  const parameters: SqlValue[] = [];
  const where = whereWithTenant(tenantId, spec.where, parameters);
  const sortClause =
    spec.sort === undefined || spec.sort.length === 0
      ? ''
      : ` ORDER BY ${spec.sort
          .map((sort) => `${sort.column} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`)
          .join(', ')}`;

  // The limit is inlined as a validated integer rather than parameterised. It is checked
  // to be a positive integer immediately above, so it cannot carry caller-controlled text.
  const sql = `SELECT ${spec.columns.join(', ')} FROM ${spec.table} ${where}${sortClause} LIMIT ${spec.limit}`;
  return { sql, parameters };
}

/**
 * The tenant column is SET by the boundary, from the handle. The guard in store.ts has
 * already refused any spec whose values name it, so there is no conflict to resolve and no
 * precedence rule to get wrong: the caller could not have supplied one.
 */
export function compileInsert(tenantId: string, spec: InsertSpec): CompiledStatement {
  assertSpecIsTenantSafe(spec);
  const callerColumns = Object.keys(spec.values);
  if (callerColumns.length === 0) {
    throw new Error('An insert spec must set at least one column.');
  }

  const columns = [TENANT_COLUMN, ...callerColumns];
  const parameters: SqlValue[] = [tenantId, ...callerColumns.map((column) => spec.values[column])];
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders})`;
  return { sql, parameters };
}

export function compileUpdate(tenantId: string, spec: UpdateSpec): CompiledStatement {
  assertSpecIsTenantSafe(spec);
  const columns = Object.keys(spec.set);
  if (columns.length === 0) {
    throw new Error('An update spec must set at least one column.');
  }

  const parameters: SqlValue[] = columns.map((column) => spec.set[column]);
  const assignments = columns.map((column) => `${column} = ?`).join(', ');
  const where = whereWithTenant(tenantId, spec.where, parameters);
  const sql = `UPDATE ${spec.table} SET ${assignments} ${where}`;
  return { sql, parameters };
}

export function compileDelete(tenantId: string, spec: DeleteSpec): CompiledStatement {
  assertSpecIsTenantSafe(spec);
  const parameters: SqlValue[] = [];
  const where = whereWithTenant(tenantId, spec.where, parameters);
  const sql = `DELETE FROM ${spec.table} ${where}`;
  return { sql, parameters };
}
