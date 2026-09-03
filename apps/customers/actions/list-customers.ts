/**
 * customers.ListCustomers
 *
 * A page of customers in a stable order, active by default, from every Business the caller
 * is authorized over — or from one named Business.
 *
 * A COLLECTION ENDPOINT NEVER 404s FOR ITS CONTENTS. No customers, and a filter that
 * matches none, both return an empty `data` array with `next_cursor` null. `not_found` and
 * `forbidden` appear here only for an EXPLICIT `business_id` parameter.
 *
 * `status: 'pending_deletion'` is filterable under `customers.customer.list` rather than
 * under the delete permission. "A record scheduled for destruction that nobody can find is
 * a record nobody will recover in time, and the 30-day window is only real if the queue is
 * visible." Nothing in this slice can put a record into that state, so the filter returns
 * nothing today — it exists because a new `statusFilter` member after a client ships is
 * breaking.
 *
 * THERE IS NO TOTAL COUNT, and the product consequence is concrete: neither client can show
 * "247 customers". That is a real loss and it is the correct trade — a pagination total is
 * an aggregate, TESTING_STANDARD.md §5.2 puts aggregates in scope of "infer", and a total
 * computed without a tenant predicate is the cheapest cross-tenant leak to write by
 * accident under docs/decisions/0006 Option A, because it returns no records at all.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { StatusFilter } from '../domain/customer.ts';
import { LIST_CUSTOMERS_RULE } from '../domain/validation.ts';
import type { CollectionInput, CollectionOutput } from './collection.ts';
import { readPage } from './collection.ts';
import { APP_ID, PERMISSION } from './common.ts';

export function createListCustomersAction(dependencies: {
  readonly businesses: BusinessDirectory;
}): ActionDefinition<CollectionInput, CollectionOutput> {
  return {
    id: 'customers.ListCustomers',
    appId: APP_ID,
    title: 'List customers',
    description:
      'Return a page of customers in a stable order, active ones by default, from every ' +
      'Business the caller is authorized over — or from one named Business. Use for the ' +
      'directory view and for paging through it. Does not accept a search term — use ' +
      'SearchCustomers for that.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: PERMISSION.list,
    scope: 'business',
    sensitivity: 'read',
    idempotent: false,
    audit: false,
    // Stated rather than defaulted, because the default is the thing under review. The user's
    // 2026-09-02 ruling named GetCustomer; extending it to the collections is open (CD-15),
    // and a defaulted `false` would read as nobody having considered it.
    auditOnDenial: false,
    exposure: ['internal', 'public'],
    /** Zero. A collection read writes nothing and never reaches the daily write budget. */
    maxRowWrites: 0,
    parseInput(raw: unknown): Result<CollectionInput> {
      const validated = validateObject(raw, LIST_CUSTOMERS_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      const value = validated.value;
      const input: CollectionInput = {
        ...(typeof value.business_id === 'string' ? { business_id: value.business_id } : {}),
        ...(typeof value.status === 'string' ? { status: value.status as StatusFilter } : {}),
        ...(typeof value.page_size === 'number' ? { page_size: value.page_size } : {}),
        ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
      };
      return ok(input);
    },
    targetIdentifier(): string | null {
      return null;
    },
    async handle(context: ActionContext, input: CollectionInput) {
      const outcome = await readPage(
        context,
        dependencies.businesses,
        'list',
        input,
        // No matching. A listing is not a search with an empty term: an empty term would
        // make every row a candidate through the match predicate as well as through the
        // bounding, which is a different query plan for the same answer.
        null,
        null,
      );
      if (!outcome.ok) {
        return err(outcome.error);
      }
      return ok({
        output: outcome.value,
        writes: [],
        audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] },
      });
    },
  };
}
