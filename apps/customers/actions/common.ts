/**
 * What every Action in this App shares: the permission ids, and steps 5 and 5b.
 *
 * `resolveAuthorizedCustomer` is the one place the two-level check happens for a record
 * named by identifier, and every Action that names one calls it. Writing it once is what
 * makes the asymmetry the contract requires true everywhere rather than in most places:
 *
 *   another Organization's customer   -> not_found  (the boundary filtered it out)
 *   an identifier that exists nowhere -> not_found  (byte-identical to the above)
 *   this Organization, wrong Business -> forbidden
 *
 * The order is not interchangeable. Resolution comes first and is terminal for
 * cross-tenant; the Business check runs only on a row already proved to be inside the
 * caller's Organization. Reversing them — filtering by Business in the query — would
 * collapse `forbidden` into `not_found` and produce the failure the contract argues
 * against at length: a business-admin told a customer does not exist has staff re-enter it,
 * creating a duplicate inside the same Organization that nothing detects, because this
 * contract has no duplicate detection.
 */

import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { notFound } from '../../../platform/core/kernel/errors.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { Row } from '../../../platform/core/storage/store.ts';
import { authorizeResolvedBusiness } from '../../../platform/core/authorization/business-scope.ts';
import { findById } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';

export const APP_ID = 'customers';

export const PERMISSION = {
  create: 'customers.customer.create',
  read: 'customers.customer.read',
  list: 'customers.customer.list',
  update: 'customers.customer.update',
  archive: 'customers.customer.archive',
  restore: 'customers.customer.restore',
  move: 'customers.customer.move',
} as const;

/**
 * The two Actions this slice does not build, held as data.
 *
 * The router refuses to be constructed if an executable Action with one of these ids is
 * ever wired (platform/core/http/router.ts). Keeping the ids in the App rather than in
 * Core means the deferral is declared where the deferral was decided.
 */
export const DEFERRED_ACTION_IDS: readonly string[] = [
  'customers.DeleteCustomer',
  'customers.RestoreDeletedCustomer',
];

/** Reads the caller-supplied `customer_id` from a raw request, for the denial audit record. */
export function rawCustomerId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = (raw as Record<string, unknown>).customer_id;
  return typeof value === 'string' ? value : null;
}

/** Steps 5 and 5b, together, in the only order they may run in. */
export async function resolveAuthorizedCustomer(
  context: ActionContext,
  customerId: string,
): Promise<Result<Row>> {
  // Step 5. Resolved WITHIN THE TENANT by the storage boundary. Terminal for cross-tenant.
  const found = await findById(context.store, customerId);
  if (!found.ok) {
    return err(found.error);
  }
  if (found.value === null) {
    return err(notFound());
  }

  // Step 5b. The row is this Organization's own data; only now is its Business authorized.
  const businessId = found.value[COLUMN.businessId];
  const authorized = authorizeResolvedBusiness(
    context.authorizedBusinessIds,
    typeof businessId === 'string' ? businessId : '',
  );
  if (!authorized.ok) {
    return err(authorized.error);
  }

  return ok(found.value);
}
