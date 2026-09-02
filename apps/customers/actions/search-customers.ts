/**
 * customers.SearchCustomers
 *
 * Matching semantics are fixed by the contract (README.md §7) and are NOT selectable by the
 * caller. There is no field parameter, no mode parameter and no operator syntax: letting a
 * caller choose the field would let it probe `notes`, which is exactly what the contract
 * excludes, and letting it supply a pattern would hand it a scan of the shared database.
 *
 * `%` AND `_` ARE LITERAL CHARACTERS. That is enforced at the storage boundary, where
 * `startsWith` and `contains` escape their value and emit an explicit `ESCAPE` clause
 * (platform/core/storage/adapters/sql/sql-compiler.ts), not here — so it holds for every
 * caller of the predicate language rather than for this Action's habits.
 *
 * NO RELEVANCE RANKING AND NO SCORE. Results come back in §8's fixed order. No ranking
 * function is defined; an undefined order makes cursor pagination unstable and makes the
 * two clients order the same result set differently.
 *
 * BUSINESS BOUNDING IS APPLIED TO THE CANDIDATE SET, BEFORE MATCHING, NEVER TO THE RESULTS
 * AFTER IT. `readPage` ANDs the bounding with the match predicate in one query. A search
 * that matched across Businesses the caller cannot list and then filtered the output would
 * still leak through page counts and cursor behaviour — the same failure the exclusion of
 * `notes` prevents, one scope level up.
 *
 * `audit: false`, under the same CD-1 exception as the other two reads. See
 * get-customer.ts for the full statement of what that costs.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { StatusFilter } from '../domain/customer.ts';
import { SEARCH_CUSTOMERS_RULE } from '../domain/validation.ts';
import { buildSearchCriteria } from '../domain/search.ts';
import type { CollectionInput, CollectionOutput } from './collection.ts';
import { readPage } from './collection.ts';
import { APP_ID, PERMISSION } from './common.ts';

type SearchInput = CollectionInput & { readonly query: string };

export function createSearchCustomersAction(dependencies: {
  readonly businesses: BusinessDirectory;
}): ActionDefinition<SearchInput, CollectionOutput> {
  return {
    id: 'customers.SearchCustomers',
    appId: APP_ID,
    title: 'Search customers',
    description:
      'Find customers whose name, email address or telephone number matches a term. Use when a ' +
      'person is looking for a specific customer rather than browsing. Matches on display name, ' +
      'email and phone only — never on notes or address.',
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
    // Shares customers.customer.list with ListCustomers deliberately.
    permission: PERMISSION.list,
    scope: 'business',
    sensitivity: 'read',
    idempotent: false,
    audit: false,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<SearchInput> {
      const validated = validateObject(raw, SEARCH_CUSTOMERS_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      const value = validated.value;
      const input: SearchInput = {
        query: value.query as string,
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
    async handle(context: ActionContext, input: SearchInput) {
      const outcome = await readPage(
        context,
        dependencies.businesses,
        'search',
        input,
        buildSearchCriteria(input.query),
        // The term is part of the cursor binding: a cursor issued for one search may not be
        // replayed against another, for the same reason a list cursor may not be replayed
        // against a different status filter.
        input.query,
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
