/**
 * The directory the person was last looking at.
 *
 * Kept so "Back to customers" from a record returns to the filtered, searched,
 * paged list they came from, without pushing that state into every record's own
 * address.
 *
 * It is a convenience, never a source of truth: a record opened from a bookmark
 * or a pasted link falls back to the plain directory.
 */

const DEFAULT_LIST_HASH = '#/customers';

let lastListHash = DEFAULT_LIST_HASH;

export function setLastListHash(hash: string): void {
  lastListHash = hash.startsWith('#') ? hash : DEFAULT_LIST_HASH;
}

export function getLastListHash(): string {
  return lastListHash;
}
