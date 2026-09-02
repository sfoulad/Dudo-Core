/**
 * Search semantics. "Search" without matching semantics is not a contract, so these are
 * the contract's, transcribed exactly (README.md §7.3).
 *
 * A customer matches if ANY of the three field rules matches (OR across fields):
 *
 *   display_name  the normalised query is split on whitespace into terms; the customer
 *                 matches if EVERY term is a PREFIX of at least one whitespace-delimited
 *                 token of the normalised display_name (AND across terms). So `an sm`
 *                 matches `Anna Smith`; `smith an` also matches it; `nna` matches nothing.
 *   email         the normalised query is a PREFIX of the normalised email.
 *   phone         both sides are reduced to their digit sequence; the customer matches if
 *                 the reduced query is a SUFFIX of the reduced stored value. This rule
 *                 participates ONLY when the reduced query has at least 4 digits.
 *
 * SEARCHABLE FIELDS ARE display_name, email AND phone. NOTHING ELSE, AND `notes` AND
 * `address` IN PARTICULAR ARE NOT. The disclosure reason is the binding one: `notes` is
 * free text a member of staff wrote for themselves, and making it searchable turns an
 * arbitrary phrase into a probe that confirms whether that phrase appears in someone's
 * record — available to a principal holding only `list`, which is the permission that
 * deliberately does not return `notes` at all. It would hand back through the search box
 * what the list projection withholds. There is no parameter below by which a caller could
 * select a field, and adding one would recreate exactly that.
 *
 * HOW THE PREFIX RULES ARE MADE INDEX-SHAPED. This module produces criteria, not SQL; the
 * repository turns them into storage predicates. Two of the three translate to prefix
 * matches directly. The token rule does not, so the stored key carries a LEADING SPACE and
 * each term is matched as `contains(' ' + term)`: "term is a prefix of some
 * whitespace-delimited token" is exactly "the space-prefixed normalised name contains a
 * space followed by term", because normalisation has already collapsed every whitespace
 * run to one space and trimmed the ends. See data/schema.ts for the column.
 *
 * THE 4-DIGIT FLOOR is not a nicety. It stops `12` from matching most of a directory and
 * charging a scan to say so, on a single-threaded database shared with every other
 * Organization.
 */

import { normaliseForMatching, phoneDigits, reversedPhoneDigits } from './normalisation.ts';

export const PHONE_MINIMUM_QUERY_DIGITS = 4;

/**
 * The space-prefix convention, in one place so the writer and the searcher cannot disagree
 * about it. Applied to the stored value at write time and to each term at query time.
 */
export const TOKEN_BOUNDARY = ' ';

export type SearchCriteria = {
  /**
   * One entry per term, each already carrying the leading token boundary. ANDed.
   * Never empty: `searchQuery` has `minLength: 2` and `pattern: "\\S"`, so a validated
   * query always yields at least one term.
   */
  readonly nameTokenFragments: readonly string[];
  /** The whole normalised query, matched as a prefix of the normalised email. */
  readonly emailPrefix: string;
  /**
   * The reversed digits of the query, matched as a PREFIX of the reversed stored digits —
   * which is a suffix match on the digits themselves. Null below the 4-digit floor, and a
   * null means the phone rule does not participate at all rather than matching everything.
   */
  readonly reversedPhonePrefix: string | null;
};

export function buildSearchCriteria(rawQuery: string): SearchCriteria {
  const normalised = normaliseForMatching(rawQuery);
  const terms = normalised.split(' ').filter((term) => term.length > 0);

  const digits = phoneDigits(rawQuery);

  return {
    nameTokenFragments: terms.map((term) => `${TOKEN_BOUNDARY}${term}`),
    emailPrefix: normalised,
    reversedPhonePrefix:
      digits.length >= PHONE_MINIMUM_QUERY_DIGITS ? reversedPhoneDigits(rawQuery) : null,
  };
}

/**
 * The stored matching key for a display name: normalised, with the leading token boundary.
 *
 * It is also the ORDERING key. That is not a coincidence being exploited — a single leading
 * space is on every value, so ordering by this column is byte-for-byte the same order as
 * ordering by the normalised name, and one column serves both without a second index.
 */
export function displayNameKey(displayName: string): string {
  return `${TOKEN_BOUNDARY}${normaliseForMatching(displayName)}`;
}

export function emailKey(email: string | null): string | null {
  return email === null ? null : normaliseForMatching(email);
}

export function phoneKey(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }
  const reversed = reversedPhoneDigits(phone);
  // A recorded phone with no digits at all cannot be matched by any query, so it is stored
  // as null rather than as an empty string -- an empty string is a prefix of nothing and a
  // suffix of everything, and which one it behaves as depends on the engine.
  return reversed.length === 0 ? null : reversed;
}
