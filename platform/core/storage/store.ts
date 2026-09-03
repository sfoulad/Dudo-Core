/**
 * The Core-owned storage port, and the one place the tenant predicate is applied.
 *
 * docs/decisions/0006 §0.2 and MULTITENANCY_STANDARD.md §7.2/§7.6, both binding by user
 * decision:
 *
 *   - business services never touch D1 directly;
 *   - every handle comes from `TenantStoreResolver`;
 *   - the tenant predicate is applied CENTRALLY by this boundary and is never hand-written
 *     per query;
 *   - a query path that bypasses the boundary is a critical defect.
 *
 * HOW THIS FILE MAKES THAT STRUCTURAL RATHER THAN ASPIRATIONAL. Four properties, and each
 * one closes a way the predicate could have gone missing:
 *
 * 1. A `TenantScopedStore` is bound to exactly one tenant when it is created, by the
 *    resolver. No method takes a tenant argument, so no call site can pass the wrong one
 *    and none can omit it.
 * 2. No method takes SQL. The adapter compiles a spec, and it emits `tenant_id = ?` on
 *    every statement it emits — select, insert, update and delete alike.
 * 3. `tenant_id` is REJECTED as a column anywhere in a caller's spec: in a predicate, in an
 *    insert's values, in an update's SET, in a select's column list, in an ORDER BY. A
 *    caller therefore cannot shadow the boundary's own predicate with a second one, cannot
 *    write a row into another tenant, and cannot `OR` its way past the narrowing. The
 *    rejection is a thrown defect, not a returned error, because a call site that
 *    references the tenant column is not a request that failed — it is code that must not
 *    ship.
 * 4. `tenant_id` is never SELECTED, so it is not in any row a caller receives. Combined
 *    with `ActionContext` not carrying the organization identifier
 *    (tenancy/tenant-context.ts), an Action in this repository has no access to a tenant
 *    identifier by any route: not from its context, not from a row, not from a cursor.
 *
 * Property 3 is also what makes the negative control the contract requires (README.md §12,
 * "predicate-order tests, run against the storage boundary and not the handler") a
 * one-line change in a single file: delete the tenant predicate in the compiler and the
 * whole suite must go red. If the predicate were spread across call sites, deleting one
 * would turn one test red and prove nothing.
 *
 * ===========================================================================================
 * A FIFTH PROPERTY, ADDED BY docs/decisions/0014 §A.11: NO WRITE WITHOUT AN ADMISSION.
 * ===========================================================================================
 *
 * "All storage writers must use this admission port. Direct D1 writes outside it are
 * prohibited." That is made structural here by the same device as the four above rather than
 * by a rule somebody has to remember:
 *
 * 5. `write` TAKES A `WriteReservation`, AND IT IS A REQUIRED PARAMETER. There is no overload
 *    without one and no default. A writer that has not reserved daily capacity cannot express
 *    the call, and the adapter checks the reservation's brand, its single use, its
 *    Organization and its size before it compiles a statement
 *    (`protection/write-admission.ts`). A reservation is minted only by the coordinator, only
 *    after the day's counters have already been decremented.
 *
 * `select` TAKES NOTHING, AND THAT ASYMMETRY IS §A.10. Reads are never admitted through this
 * port, so "reads remain available" is not a behaviour that has to hold at exhaustion — there
 * is no state of the budget in which a read consults it at all.
 */

import type { Predicate, SqlValue } from './predicate.ts';
import { columnsReferenced } from './predicate.ts';
import type { Result } from '../kernel/result.ts';
import type { WriteReservation } from '../protection/write-admission.ts';

/**
 * The physical tenant column. `docs/decisions/0006` §0.1: "`tenant_id` is mandatory on
 * every tenant-owned row, query, command, event, cache key, job, export, and object path."
 *
 * It holds the Organization identifier. The Customer Directory contract says
 * "organization_id" when it means this column; MULTITENANCY_STANDARD.md §2 records that
 * Organization and tenant are "the same thing in two vocabularies". The physical name
 * follows the decision record because the decision record is what every other table will
 * be built against.
 */
export const TENANT_COLUMN = 'tenant_id';

const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export type Row = Readonly<Record<string, SqlValue>>;

export type SortDirection = 'asc' | 'desc';

/**
 * Named `Sort` rather than `OrderBy` on purpose. `CORE_BOUNDARIES.md` §6 rule 1 is checked
 * by grepping Core for industry nouns, and `order` is one — a purchase order is an App's
 * object, not Core's. A sort specification called `OrderBy` produces a false positive on
 * that grep every time anyone runs it, and a boundary check that cries wolf is a boundary
 * check people stop reading.
 */
export type Sort = {
  readonly column: string;
  readonly direction: SortDirection;
};

export type SelectSpec = {
  readonly table: string;
  readonly columns: readonly string[];
  readonly where?: Predicate;
  readonly sort?: readonly Sort[];
  /**
   * Required, and there is no unlimited form. On a single-threaded shared database an
   * unbounded read is every Organization's latency (MULTITENANCY_STANDARD.md §7.7), and a
   * collection endpoint that can return a whole table is an undeclared bulk export.
   */
  readonly limit: number;
};

export type InsertSpec = {
  readonly table: string;
  readonly values: Readonly<Record<string, SqlValue>>;
};

export type UpdateSpec = {
  readonly table: string;
  readonly set: Readonly<Record<string, SqlValue>>;
  readonly where: Predicate;
};

export type DeleteSpec = {
  readonly table: string;
  readonly where: Predicate;
};

export type WriteOperation =
  | { readonly kind: 'insert'; readonly spec: InsertSpec }
  | { readonly kind: 'update'; readonly spec: UpdateSpec }
  | { readonly kind: 'delete'; readonly spec: DeleteSpec };

/**
 * A handle over exactly one tenant's data. Obtained only from `TenantStoreResolver`.
 * Nothing in this interface names a tenant, because nothing in it needs to.
 */
export type TenantScopedStore = {
  select(spec: SelectSpec): Promise<Result<readonly Row[]>>;
  /**
   * Commits every operation atomically, or none of them.
   *
   * This exists so that a mutation and its audit record are one unit. The Customer
   * Directory contract asks for exactly that where the boundary can provide it
   * (audit.deletionPathAudit.atomicity: "Where the storage boundary can make the audit
   * write and the row deletion atomic, IT MUST — one transaction removes the ordering
   * question entirely"). Where it cannot, an ordering has to be argued about; here it does
   * not have to be.
   *
   * `reservation` IS REQUIRED AND IS THE WHOLE OF docs/decisions/0014 §A.11 AT THIS BOUNDARY.
   * It is the receipt for daily D1 write capacity that has ALREADY been charged, obtained
   * from the coordinator before this call. It is spent by this call and cannot be spent
   * again: one reservation, one batch. Passing a hand-built object, another Organization's
   * reservation, a reservation smaller than the batch, or one that has been used before is a
   * THROWN defect, not a returned error — the same treatment, for the same reason, as a spec
   * that names the tenant column.
   */
  write(
    operations: readonly WriteOperation[],
    reservation: WriteReservation,
  ): Promise<Result<void>>;
};

/**
 * Thrown, not returned. A spec that names the tenant column is a defect in Dudo's own
 * code, not a bad request from a caller: no client can cause one, because clients supply
 * values and never column names. Returning an error would let it be handled and logged and
 * survive; throwing stops the request and surfaces as `internal`, disclosing nothing.
 */
export class TenantColumnReferencedError extends Error {
  constructor(where: string) {
    super(
      `A storage spec referenced the tenant column in ${where}. The tenant predicate is ` +
        'applied by the storage boundary and may not be named, set, selected, ordered by, ' +
        'or filtered on by a caller.',
    );
    this.name = 'TenantColumnReferencedError';
  }
}

export class InvalidIdentifierError extends Error {
  constructor(kind: string, value: string) {
    super(`Invalid ${kind} name in a storage spec: ${JSON.stringify(value)}.`);
    this.name = 'InvalidIdentifierError';
  }
}

function assertTableName(table: string): void {
  if (!TABLE_NAME_PATTERN.test(table)) {
    throw new InvalidIdentifierError('table', table);
  }
}

function assertColumnName(column: string, where: string): void {
  if (!COLUMN_NAME_PATTERN.test(column)) {
    throw new InvalidIdentifierError('column', column);
  }
  if (column === TENANT_COLUMN) {
    throw new TenantColumnReferencedError(where);
  }
}

/**
 * The guard. Every adapter runs it on every spec, before compiling anything.
 *
 * It is deliberately exhaustive over the places a column name can appear rather than
 * checking only the WHERE clause: an INSERT that set `tenant_id` directly would write a
 * row into another Organization without any predicate being wrong, and an ORDER BY on
 * `tenant_id` would order one tenant's page by a column it is not allowed to know exists.
 */
export function assertSpecIsTenantSafe(
  spec: SelectSpec | InsertSpec | UpdateSpec | DeleteSpec,
): void {
  assertTableName(spec.table);

  if ('columns' in spec) {
    for (const column of spec.columns) {
      assertColumnName(column, 'a select column list');
    }
    for (const sort of spec.sort ?? []) {
      assertColumnName(sort.column, 'a sort clause');
    }
  }

  if ('values' in spec) {
    for (const column of Object.keys(spec.values)) {
      assertColumnName(column, 'an insert value list');
    }
  }

  if ('set' in spec) {
    for (const column of Object.keys(spec.set)) {
      assertColumnName(column, 'an update set clause');
    }
  }

  const where: Predicate | undefined = 'where' in spec ? spec.where : undefined;
  if (where !== undefined) {
    for (const column of columnsReferenced(where)) {
      assertColumnName(column, 'a predicate');
    }
  }
}
