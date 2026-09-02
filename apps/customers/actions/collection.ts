/**
 * What `ListCustomers` and `SearchCustomers` share.
 *
 * The two Actions "differ in how the candidate set is chosen, never in what a row looks
 * like" (contract, searchCustomersOutput). They share `customers.customer.list` for the
 * same reason: search IS enumeration, and a separate `customers.customer.search` would let
 * a role reach the same information through a second door.
 *
 * So they share this function. Business bounding, status bounding, ordering, page size,
 * cursor issue and cursor verification are identical by construction rather than by two
 * implementations agreeing.
 *
 * OMITTING `business_id` DOES NOT MEAN "THE WHOLE ORGANIZATION". It means every Business
 * the caller is authorized over — which for a business-scope principal is exactly one. The
 * listing is never wider than the caller's authorization, so the default is safe for the
 * narrowest principal and useful for the broadest: a business-owner gets one merged
 * directory, a business-admin gets their own Business, and neither had to know which case
 * they were in.
 *
 * A COLLECTION NEVER RETURNS `forbidden` FOR A ROW. Customers in Businesses outside the
 * authorized set are simply absent — no count, no placeholder, no gap in the cursor —
 * because they are never in the candidate set to begin with. `forbidden` appears only when
 * the caller EXPLICITLY names a `business_id` it is not authorized over: there the caller
 * asserted a scope and deserves a straight answer, whereas an unfiltered listing asserted
 * nothing. Returning an empty page for an explicitly named Business would read as "this
 * Business has no customers", which is a false statement about the caller's own
 * Organization.
 */

import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { authorizeSuppliedBusiness } from '../../../platform/core/authorization/business-scope.ts';
import { rejectedCursor } from '../../../platform/core/pagination/cursor.ts';
import type { CustomerSummary, StatusFilter } from '../domain/customer.ts';
import { DEFAULT_STATUS_FILTER, statusesForFilter } from '../domain/customer.ts';
import type { SearchCriteria } from '../domain/search.ts';
import { findDisplayNameKey, page, toCustomerSummary } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';

export const DEFAULT_PAGE_SIZE = 25;

export type CollectionInput = {
  readonly business_id?: string;
  readonly status?: StatusFilter;
  readonly page_size?: number;
  readonly cursor?: string;
};

export type CollectionOutput = {
  readonly data: readonly CustomerSummary[];
  readonly next_cursor: string | null;
};

export async function readPage(
  context: ActionContext,
  businesses: BusinessDirectory,
  collectionName: string,
  input: CollectionInput,
  search: SearchCriteria | null,
  searchQuery: string | null,
): Promise<Result<CollectionOutput>> {
  const statusFilter = input.status ?? DEFAULT_STATUS_FILTER;
  const pageSize = input.page_size ?? DEFAULT_PAGE_SIZE;

  // Step 5c, for the one input that names a Business.
  let businessIds: readonly string[];
  if (input.business_id === undefined) {
    businessIds = context.authorizedBusinessIds;
  } else {
    const authorized = await authorizeSuppliedBusiness(
      context.store,
      businesses,
      context.authorizedBusinessIds,
      input.business_id,
    );
    if (!authorized.ok) {
      return err(authorized.error);
    }
    businessIds = [input.business_id];
  }

  // The cursor is bound to the tenant, the collection, the Business filter, the status
  // filter and the page size. "A page 2 under different filters is not page 2."
  const binding = {
    collection: collectionName,
    businessId: input.business_id ?? null,
    status: statusFilter,
    pageSize,
    query: searchQuery,
  };

  let anchor: { displayNameKey: string; customerId: string } | null = null;
  if (input.cursor !== undefined) {
    const decoded = await context.cursors.decode(input.cursor, binding, context.clock.nowMs());
    if (!decoded.ok) {
      // Malformed, expired, forged, wrong tenant and wrong filter all arrive here as the
      // same value. Do not specialise one of them.
      return err(decoded.error);
    }
    const anchorKey = await findDisplayNameKey(context.store, decoded.value);
    if (!anchorKey.ok) {
      return err(anchorKey.error);
    }
    if (anchorKey.value === null) {
      // A validly-signed cursor for this tenant whose anchor row no longer resolves. The
      // answer is the SAME cursor rejection, not a distinct one: telling a caller that its
      // cursor was genuine but its anchor is gone is a statement about a record.
      return err(rejectedCursor());
    }
    anchor = { displayNameKey: anchorKey.value, customerId: decoded.value };
  }

  const result = await page(context.store, {
    businessIds,
    statuses: statusesForFilter(statusFilter),
    search,
    anchor,
    pageSize,
  });
  if (!result.ok) {
    return err(result.error);
  }

  let nextCursor: string | null = null;
  if (result.value.hasMore && result.value.rows.length > 0) {
    const last = result.value.rows[result.value.rows.length - 1];
    const lastId = last[COLUMN.customerId];
    nextCursor = await context.cursors.encode(
      { anchorId: typeof lastId === 'string' ? lastId : '', binding },
      context.clock.nowMs(),
    );
  }

  return ok({
    data: result.value.rows.map(toCustomerSummary),
    // Always present, null at the end. Absent-versus-null is not a distinction any client
    // should have to make, and it is exactly where two clients diverge.
    next_cursor: nextCursor,
  });
}
