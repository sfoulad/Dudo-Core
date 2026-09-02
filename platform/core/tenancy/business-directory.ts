/**
 * Does this Business belong to the authenticated Organization?
 *
 * This is the one lookup that distinguishes `forbidden` from `not_found` for a
 * caller-supplied Business identifier, so it is worth being explicit about why it is safe.
 *
 * THE LOOKUP IS TENANT-SCOPED, AND THAT IS WHAT MAKES IT NOT A PROBE. It goes through the
 * same `TenantScopedStore` as everything else, so the storage boundary applies the
 * `tenant_id` predicate before any row is visible. A Business of another Organization is
 * therefore indistinguishable from a Business that does not exist — the query returns
 * nothing in both cases — which is exactly what the Customer Directory contract requires:
 * "A value naming a Business of another Organization is indistinguishable from a value
 * naming no Business at all: both are not_found."
 *
 * If this lookup were written against an unscoped table, `CreateCustomer` would become a
 * probe for the existence of other Organizations' Businesses. It is not, and it cannot
 * become one by accident, because there is no handle available here that reaches outside
 * the tenant.
 *
 * WHAT EXISTS AND WHAT STILL DOES NOT, STATED RATHER THAN ASSUMED.
 *
 * The table now exists: `platform/core/migrations/0002_business.sql`, two columns, primary
 * key `(tenant_id, business_id)`. It was authored as the MINIMUM that makes this one
 * question answerable, because without it the query below failed and the contract's step 5c
 * — the whole not_found/forbidden distinction for a caller-supplied Business — collapsed
 * into a single `unavailable`.
 *
 * What still does not exist is the organization-structure slice: no Business name, no
 * lifecycle, no Branch, no membership, no Organization table, and NOTHING THAT WRITES A ROW
 * HERE. So in a deployed runtime the table is empty, every lookup that reaches storage
 * answers "no", and `authorizeSuppliedBusiness` returns `not_found` for anything outside the
 * principal's authorized set. That is fail-closed and correct; it also means the `forbidden`
 * branch of step 5c is not reachable in production until something populates the table, and
 * that is a gap in reachability, not in this file.
 *
 * WHEN BUSINESS GAINS A LIFECYCLE, THIS FUNCTION ACQUIRES A DECISION IT DOES NOT HAVE TODAY:
 * whether an archived or suspended Business still "exists in the tenant" for step 5c. Today
 * there is no such state and no column for one, so the question cannot be answered wrongly
 * by accident. It must be answered deliberately by the slice that introduces the state — a
 * lifecycle column added without revisiting this line would silently change which Actions
 * return `not_found`.
 */

import type { TenantScopedStore } from '../storage/store.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { eq } from '../storage/predicate.ts';

/** Core's organization-structure table. No industry noun; this is CORE_BOUNDARIES.md §3.2. */
export const BUSINESS_TABLE = 'business';
export const BUSINESS_ID_COLUMN = 'business_id';

export type BusinessDirectory = {
  /**
   * True when the Business exists in the store's tenant. False when it does not exist, or
   * exists in another Organization — the two are the same answer here, by construction.
   */
  existsInTenant(store: TenantScopedStore, businessId: string): Promise<Result<boolean>>;
};

export function createStoreBusinessDirectory(): BusinessDirectory {
  return {
    async existsInTenant(
      store: TenantScopedStore,
      businessId: string,
    ): Promise<Result<boolean>> {
      const outcome = await store.select({
        table: BUSINESS_TABLE,
        columns: [BUSINESS_ID_COLUMN],
        where: eq(BUSINESS_ID_COLUMN, businessId),
        limit: 1,
      });
      if (!outcome.ok) {
        return err(outcome.error);
      }
      return ok(outcome.value.length > 0);
    },
  };
}
