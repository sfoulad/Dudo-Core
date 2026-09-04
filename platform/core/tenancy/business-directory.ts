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

/**
 * The most Businesses one organization-scope principal may be authorized over in a request.
 * `docs/decisions/0020`.
 *
 * REQUIRED RATHER THAN UNLIMITED, for the reason `SelectSpec.limit` and
 * `MAX_ENTERABLE_ORGANIZATIONS` are: on a single-threaded database an unbounded read is every
 * Organization's latency, and this one runs on EVERY authenticated request that reaches a
 * handler.
 *
 * WHAT HAPPENS AT THE LIMIT, STATED BECAUSE IT IS NOT NOTHING. A tenant with more Businesses than
 * this gets a TRUNCATED authorized set, and the Businesses past the limit become unreachable to
 * that principal — `authorizeSuppliedBusiness` answers `forbidden` for them and an unfiltered
 * list omits them. That is the fail-closed direction: someone loses access to their own data,
 * which is visible and reported, rather than gaining access to somebody else's, which is not.
 *
 * 500 against a closed beta of ten Organizations (`MULTITENANCY_STANDARD.md` §7.5) is far more
 * headroom than the shape of the product needs, and it is a number to revisit against real
 * tenants rather than a property that holds forever. THE REAL FIX AT SCALE IS NOT A BIGGER
 * NUMBER: it is the explicit business assignment `0020` defers, which makes the set small
 * because it is chosen rather than large because it is everything.
 */
export const MAX_AUTHORIZED_BUSINESSES = 500;

export type BusinessDirectory = {
  /**
   * True when the Business exists in the store's tenant. False when it does not exist, or
   * exists in another Organization — the two are the same answer here, by construction.
   */
  existsInTenant(store: TenantScopedStore, businessId: string): Promise<Result<boolean>>;

  /**
   * Every Business in the store's tenant. `docs/decisions/0020`.
   *
   * IT IS TENANT-SCOPED BY CONSTRUCTION AND NOT BY CARE. The handle carries the tenant predicate
   * inside it, so there is no Organization identifier in this signature and no way to write this
   * query for another Organization — the same property every other read through
   * `TenantScopedStore` has. That is why `0020` says to read the set through the tenant handle
   * rather than from the control plane.
   *
   * `limit` IS REQUIRED AND THERE IS NO UNLIMITED FORM, for the reason `SelectSpec.limit` is
   * required: on a single-threaded database an unbounded read is every Organization's latency.
   * A tenant with more Businesses than the limit gets a TRUNCATED authorized set, which is the
   * fail-closed direction — some Businesses become unreachable rather than someone else's
   * becoming reachable — and it is a product problem to solve with a real assignment model, not
   * a reason to remove the bound. See `MAX_AUTHORIZED_BUSINESSES`.
   */
  listInTenant(store: TenantScopedStore, limit: number): Promise<Result<readonly string[]>>;
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

    async listInTenant(
      store: TenantScopedStore,
      limit: number,
    ): Promise<Result<readonly string[]>> {
      const outcome = await store.select({
        table: BUSINESS_TABLE,
        // ONE COLUMN. The authorized set is a set of identifiers and nothing else, so nothing
        // about a Business — a name, a status, a created date — is read into a value that then
        // travels onto `ActionContext`, where an App could see it.
        columns: [BUSINESS_ID_COLUMN],
        // NO PREDICATE, AND THAT IS SAFE ONLY BECAUSE OF THE HANDLE. The tenant predicate is
        // inside `store` and is added by the compiler to every statement it emits, so "no
        // predicate" here means "every Business in THIS Organization" and cannot mean more.
        limit,
      });
      if (!outcome.ok) {
        return err(outcome.error);
      }
      const ids: string[] = [];
      for (const row of outcome.value) {
        const value = row[BUSINESS_ID_COLUMN];
        if (typeof value === 'string' && value.length > 0) {
          ids.push(value);
        }
      }
      return ok(ids);
    },
  };
}
