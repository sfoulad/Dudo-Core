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
 * WHAT DOES NOT EXIST YET, STATED RATHER THAN ASSUMED. `Business` is a Core object
 * (core-object-registry.yaml, phase 1, status `proposed` — not built). Core's
 * organization-structure schema is a separate Core slice and is NOT authored here: its
 * shape is not settled by any contract, and inventing it to unblock this one would be
 * deciding Core's identity data model as a side effect of an App. The port and its
 * store-backed implementation are here; the table is not. Composition therefore fails
 * closed — a runtime without that table cannot serve `CreateCustomer` or
 * `MoveCustomerToBusiness`, which is the correct behaviour and is reported as a blocker
 * rather than papered over with a permissive default.
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
