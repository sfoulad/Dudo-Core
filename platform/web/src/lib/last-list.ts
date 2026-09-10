/**
 * The directory the person was last looking at.
 *
 * Kept so "Back to customers" from a record returns to the filtered, searched,
 * paged list they came from, without pushing that state into every record's own
 * address.
 *
 * It is a convenience, never a source of truth: a record opened from a bookmark
 * or a pasted link falls back to the plain directory.
 *
 * IT HOLDS A SEARCH OBJECT NOW, NOT A HASH STRING. Under the hand-rolled router
 * this was a pre-built `#/customers?q=…` string, because that was the only shape
 * a link could take. TanStack Router links take `{ to, search }`, and keeping
 * the parsed object means the value is checked against
 * `customerListSearchSchema` on the way back in rather than being a string
 * nobody validates.
 */

import type { CustomerListSearch } from '@/routes/customer-list-search';

let lastListSearch: CustomerListSearch = {};

export function setLastListSearch(search: CustomerListSearch): void {
  lastListSearch = search;
}

export function getLastListSearch(): CustomerListSearch {
  return lastListSearch;
}
