/**
 * Every storage access this App makes. There is no other.
 *
 * The App reaches storage through the Core-owned `TenantScopedStore` it was handed on its
 * `ActionContext`, and through nothing else — no binding, no SQL, no connection, no cache.
 * `.claude/rules/security.md` §4 states the rule for plugins and it applies identically to
 * an App: "must NEVER open a database connection, issue SQL, use a Core ORM model, read
 * Core caches, or reach Core files or object storage."
 *
 * WHAT THE PER-QUERY-PATH ISOLATION OBLIGATION APPLIES TO. The contract requires coverage
 * enumerated from the storage-boundary call sites rather than estimated
 * (README.md §12). Every call site in this App is in this file, and they are:
 *
 *   findById               detail read; also the read half of update, archive, restore, move
 *   findDisplayNameKey     cursor continuation read
 *   page                   list read and search read (one function, two callers)
 *   insertOperation        create write
 *   updateOperation        update write, archive write, restore write, move write
 *
 * Five functions, and the audit write, which is Core's. Nothing else in `apps/customers/**`
 * calls `store`.
 *
 * NONE OF THEM WRITES A TENANT PREDICATE, and none can: `tenant_id` is not among the
 * columns this file knows (data/schema.ts), the store rejects a spec that names it, and the
 * boundary applies the predicate itself. The business predicate below is an ADDITIONAL
 * narrowing, applied to rows the boundary has already restricted to one Organization — it
 * is never a substitute, and a query carrying only `business_id` would return another
 * Organization's customer because Business identifiers are unique platform-wide.
 */

import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type {
  Row,
  TenantScopedStore,
  WriteOperation,
} from '../../../platform/core/storage/store.ts';
import type { Predicate, SqlValue } from '../../../platform/core/storage/predicate.ts';
import {
  and,
  contains,
  eq,
  gt,
  inList,
  or,
  startsWith,
} from '../../../platform/core/storage/predicate.ts';
import type { Customer, CustomerStatus, CustomerSummary, CustomerType } from '../domain/customer.ts';
import type { SearchCriteria } from '../domain/search.ts';
import {
  COLUMN,
  CUSTOMER_COLUMNS,
  CUSTOMER_SUMMARY_COLUMNS,
  CUSTOMER_TABLE,
} from './schema.ts';

function text(value: SqlValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: SqlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function toCustomer(row: Row): Customer {
  return {
    customer_id: text(row[COLUMN.customerId]),
    business_id: text(row[COLUMN.businessId]),
    display_name: text(row[COLUMN.displayName]),
    customer_type: text(row[COLUMN.customerType]) as CustomerType,
    email: nullableText(row[COLUMN.email]),
    phone: nullableText(row[COLUMN.phone]),
    country: nullableText(row[COLUMN.country]),
    address: nullableText(row[COLUMN.address]),
    notes: nullableText(row[COLUMN.notes]),
    status: text(row[COLUMN.status]) as CustomerStatus,
    deletion_scheduled_at: nullableText(row[COLUMN.deletionScheduledAt]),
    created_at: text(row[COLUMN.createdAt]),
    created_by_principal_id: text(row[COLUMN.createdByPrincipalId]),
    updated_at: text(row[COLUMN.updatedAt]),
    updated_by_principal_id: text(row[COLUMN.updatedByPrincipalId]),
  };
}

export function toCustomerSummary(row: Row): CustomerSummary {
  return {
    customer_id: text(row[COLUMN.customerId]),
    business_id: text(row[COLUMN.businessId]),
    display_name: text(row[COLUMN.displayName]),
    customer_type: text(row[COLUMN.customerType]) as CustomerType,
    email: nullableText(row[COLUMN.email]),
    phone: nullableText(row[COLUMN.phone]),
    country: nullableText(row[COLUMN.country]),
    status: text(row[COLUMN.status]) as CustomerStatus,
    deletion_scheduled_at: nullableText(row[COLUMN.deletionScheduledAt]),
    updated_at: text(row[COLUMN.updatedAt]),
  };
}

/**
 * STEP 5 OF THE EVALUATION ORDER: resolve the record WITHIN THE TENANT.
 *
 * `null` means "not in this tenant", and the caller turns that into `not_found` — the same
 * `not_found`, byte for byte, whether the identifier belongs to another Organization or to
 * no record at all. There is no branch here that could tell them apart, because the
 * boundary filtered the foreign row out before this function saw a result set.
 *
 * THIS STEP IS TERMINAL FOR CROSS-TENANT. Nothing below it in any Action runs on a foreign
 * row, so no later check can turn a cross-tenant miss into a distinguishable answer.
 *
 * NOTE THE ABSENCE OF A BUSINESS PREDICATE. Resolution by identifier is tenant-scoped only;
 * the row's Business is authorized afterwards, at step 5b, by the caller. That ordering is
 * what produces `forbidden` rather than `not_found` for a wrong-Business record inside the
 * right Organization — and filtering by Business here instead would collapse the two
 * answers into `not_found`, which is the outcome the contract argues at length against
 * (README.md §3.2: the failure mode of `not_found` there is a duplicated customer record).
 */
export async function findById(
  store: TenantScopedStore,
  customerId: string,
): Promise<Result<Row | null>> {
  const outcome = await store.select({
    table: CUSTOMER_TABLE,
    columns: CUSTOMER_COLUMNS,
    where: eq(COLUMN.customerId, customerId),
    limit: 1,
  });
  if (!outcome.ok) {
    return err(outcome.error);
  }
  return ok(outcome.value.length === 0 ? null : outcome.value[0]);
}

/**
 * The cursor's anchor row's sort key.
 *
 * The cursor carries only the anchor's `customer_id` (platform/core/pagination/cursor.ts
 * explains why: a 200-character name key would push a signed token past the contract's
 * 512-character limit). One indexed point read recovers the key. That is +1 query on a
 * continuation page, against a 50-per-invocation budget.
 *
 * NO STATUS OR BUSINESS FILTER. The anchor is a row this principal was already shown on the
 * previous page, and its key is needed even if it has since been archived or moved out of
 * the filter — otherwise a customer being edited mid-listing would break paging. It is
 * still tenant-scoped, so a cursor cannot anchor on another Organization's row: the
 * boundary would return nothing, and the caller answers with the same single cursor
 * rejection as every other cursor failure.
 */
export async function findDisplayNameKey(
  store: TenantScopedStore,
  customerId: string,
): Promise<Result<string | null>> {
  const outcome = await store.select({
    table: CUSTOMER_TABLE,
    columns: [COLUMN.displayNameKey],
    where: eq(COLUMN.customerId, customerId),
    limit: 1,
  });
  if (!outcome.ok) {
    return err(outcome.error);
  }
  if (outcome.value.length === 0) {
    return ok(null);
  }
  return ok(text(outcome.value[0][COLUMN.displayNameKey]));
}

export type PageQuery = {
  /**
   * The Businesses to read from: the principal's authorized set, or the single Business it
   * explicitly named after that name was authorized. NEVER widened here — an empty array
   * compiles to `0 = 1` and returns nothing, which is the right answer for a principal
   * authorized over no Business and is emphatically not "no narrowing".
   */
  readonly businessIds: readonly string[];
  readonly statuses: readonly CustomerStatus[];
  readonly search: SearchCriteria | null;
  readonly anchor: { readonly displayNameKey: string; readonly customerId: string } | null;
  readonly pageSize: number;
};

export type PageResult = {
  readonly rows: readonly Row[];
  readonly hasMore: boolean;
};

/**
 * Builds the matching predicate. Three field rules, OR-ed, exactly as the contract states.
 *
 * THE BOUNDING IS APPLIED TO THE CANDIDATE SET, NOT TO THE RESULTS. This predicate is
 * AND-ed with the Business and status narrowing in `page` below, so matching happens over
 * rows the caller is already authorized to list. The contract requires precisely that: "a
 * search that matched across Businesses the caller cannot list and then filtered the output
 * would still leak through page counts and cursor behaviour — the same failure the
 * exclusion of `notes` exists to prevent, one scope level up."
 *
 * `address` and `notes` appear nowhere below, and no caller can name a field to match on.
 */
function matchPredicate(criteria: SearchCriteria): Predicate {
  const alternatives: Predicate[] = [
    // AND across terms: every term must be a prefix of some token.
    and(criteria.nameTokenFragments.map((fragment) => contains(COLUMN.displayNameKey, fragment))),
    startsWith(COLUMN.emailKey, criteria.emailPrefix),
  ];
  if (criteria.reversedPhonePrefix !== null) {
    // Below the 4-digit floor the phone rule does not participate AT ALL. Adding a
    // permissive alternative here instead would make a two-digit query match most of a
    // directory, which is the cost the floor exists to avoid.
    alternatives.push(startsWith(COLUMN.phoneKey, criteria.reversedPhonePrefix));
  }
  return or(alternatives);
}

/**
 * One page of a listing or a search. The two Actions differ in how the candidate set is
 * chosen and in nothing else, so they share this function and cannot drift into two
 * orderings or two page-boundary behaviours.
 *
 * ORDER IS FIXED AND TOTAL: `display_name_key` ascending, then `customer_id` ascending. A
 * total order is what makes a cursor correct; ordering on a non-unique field alone silently
 * duplicates and skips rows across pages. There is no sort parameter in v1 and none may be
 * added without a contract version.
 *
 * `limit` is pageSize + 1: the extra row answers "is there another page" without a second
 * query and without a count. THERE IS NO TOTAL, deliberately — a total is an aggregate,
 * TESTING_STANDARD.md §5.2 puts aggregates in scope of "infer", and a total computed
 * without a tenant predicate is a cross-tenant leak that returns no records at all.
 */
export async function page(
  store: TenantScopedStore,
  query: PageQuery,
): Promise<Result<PageResult>> {
  const clauses: Predicate[] = [
    inList(COLUMN.businessId, query.businessIds as readonly SqlValue[]),
    inList(COLUMN.status, query.statuses as readonly SqlValue[]),
  ];

  if (query.search !== null) {
    clauses.push(matchPredicate(query.search));
  }

  if (query.anchor !== null) {
    // Keyset continuation over the total order. Strictly after the anchor, so a row cannot
    // appear on two pages and a row equal on the first key cannot be skipped.
    clauses.push(
      or([
        gt(COLUMN.displayNameKey, query.anchor.displayNameKey),
        and([
          eq(COLUMN.displayNameKey, query.anchor.displayNameKey),
          gt(COLUMN.customerId, query.anchor.customerId),
        ]),
      ]),
    );
  }

  const outcome = await store.select({
    table: CUSTOMER_TABLE,
    columns: CUSTOMER_SUMMARY_COLUMNS,
    where: and(clauses),
    sort: [
      { column: COLUMN.displayNameKey, direction: 'asc' },
      { column: COLUMN.customerId, direction: 'asc' },
    ],
    limit: query.pageSize + 1,
  });
  if (!outcome.ok) {
    return err(outcome.error);
  }

  const hasMore = outcome.value.length > query.pageSize;
  return ok({
    rows: hasMore ? outcome.value.slice(0, query.pageSize) : outcome.value,
    hasMore,
  });
}

export type NewCustomerRow = {
  readonly customerId: string;
  readonly businessId: string;
  readonly displayName: string;
  readonly displayNameKey: string;
  readonly customerType: CustomerType;
  readonly email: string | null;
  readonly emailKey: string | null;
  readonly phone: string | null;
  readonly phoneKey: string | null;
  readonly country: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly principalId: string;
};

/**
 * Returns a write rather than performing one, so the pipeline can commit it in the same
 * transaction as the audit record. An Action in this App has no way to commit by itself.
 *
 * `status` is set to `active` here and is never taken from input: `createCustomerInput` has
 * no `status` property and `additionalProperties` is false, so a client cannot supply one —
 * and if it could, it would have an unaudited, unpermissioned archive. `deletion_scheduled_at`
 * is null, which the table's CHECK constraint also requires for a non-`pending_deletion` row.
 */
export function insertOperation(values: NewCustomerRow): WriteOperation {
  return {
    kind: 'insert',
    spec: {
      table: CUSTOMER_TABLE,
      values: {
        [COLUMN.customerId]: values.customerId,
        [COLUMN.businessId]: values.businessId,
        [COLUMN.displayName]: values.displayName,
        [COLUMN.displayNameKey]: values.displayNameKey,
        [COLUMN.customerType]: values.customerType,
        [COLUMN.email]: values.email,
        [COLUMN.emailKey]: values.emailKey,
        [COLUMN.phone]: values.phone,
        [COLUMN.phoneKey]: values.phoneKey,
        [COLUMN.country]: values.country,
        [COLUMN.address]: values.address,
        [COLUMN.notes]: values.notes,
        [COLUMN.status]: 'active',
        [COLUMN.deletionScheduledAt]: null,
        [COLUMN.createdAt]: values.createdAt,
        [COLUMN.createdByPrincipalId]: values.principalId,
        [COLUMN.updatedAt]: values.createdAt,
        [COLUMN.updatedByPrincipalId]: values.principalId,
      },
    },
  };
}

/**
 * The single update path, used by edit, archive, restore and move.
 *
 * The predicate is `customer_id = ?` AND — added by the boundary — the tenant. The caller
 * has already resolved the row inside the tenant and authorized its Business, so this is
 * the same row it read.
 *
 * LAST WRITE WINS, and the cost is stated rather than hidden: there is no optimistic
 * concurrency token in this contract, so two staff editing one customer at once silently
 * lose one set of changes. That is open question CD-3, recorded rather than closed by
 * inventing a field the agreed field set excludes. Adding an optional `version` later is
 * additive; making it required is breaking.
 */
export function updateOperation(
  customerId: string,
  set: Readonly<Record<string, SqlValue>>,
): WriteOperation {
  return {
    kind: 'update',
    spec: {
      table: CUSTOMER_TABLE,
      set,
      where: eq(COLUMN.customerId, customerId),
    },
  };
}
