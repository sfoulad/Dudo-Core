/**
 * Normalisation, applied identically to the query and to the stored value before matching.
 *
 * Contract README.md §7.2, in order:
 *   1. Unicode NFC.
 *   2. Simple case folding (locale-independent lowercasing).
 *   3. Leading and trailing whitespace trimmed; internal whitespace runs collapsed to one
 *      space.
 *
 * "APPLIED IDENTICALLY" IS THE WHOLE CORRECTNESS OF SEARCH, and it is why the normalised
 * form is STORED rather than computed at query time. A stored `display_name_norm` column
 * means the same function produced both sides of every comparison. Normalising the query at
 * search time and the value at write time with two different code paths is how a directory
 * ends up unable to find a name it displays.
 *
 * `toLowerCase`, NOT `toLocaleLowerCase`. The contract says locale-independent. Turkish
 * dotless-i is the standard example: under a Turkish locale, `toLocaleLowerCase('I')` is
 * 'ı', so the same name would normalise differently depending on where the Worker ran or
 * what a request header said — and a search result set that varies with the caller's locale
 * is not a contract.
 *
 * NO ACCENT FOLDING AND NO TRANSLITERATION, DELIBERATELY. `Muller` does NOT match `Müller`
 * and `Mohammed` does not match `Muhammad`. This is a real limitation for Arabic-, French-
 * and German-language directories, it is stated in the contract rather than implied, and
 * fixing it needs a collation decision no ADR covers (open question CD-6). It is not
 * repaired here: adding folding would change which records a given query returns, which is
 * a behaviour change a client may depend on and is a contract-version matter, not a patch.
 */

const WHITESPACE_RUN = /\s+/g;

/** Steps 1 to 3, in order. The one function both sides of a match go through. */
export function normaliseForMatching(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(WHITESPACE_RUN, ' ');
}

/**
 * Trimming applied before STORAGE, distinct from normalisation for matching.
 *
 * `displayName` in the contract carries `pattern: "\\S"` and says "Leading and trailing
 * whitespace is trimmed by the server before storage and before matching; a value that is
 * empty after trimming is rejected as invalid_argument". So the stored `display_name` is
 * trimmed but keeps its case and its internal spacing — it is what the tenant typed, and it
 * is what both clients display.
 */
export function trimForStorage(value: string): string {
  return value.trim();
}

/**
 * Every digit, in order, with everything else removed.
 *
 * Phone matching is a suffix match on this reduction (contract §7.3), because people search
 * by the last digits they remember and the country prefix is exactly the part that varies.
 */
export function phoneDigits(value: string): string {
  let digits = '';
  for (const character of value) {
    if (character >= '0' && character <= '9') {
      digits += character;
    }
  }
  return digits;
}

/**
 * The digit sequence reversed.
 *
 * THIS COLUMN EXISTS TO TURN A SUFFIX MATCH INTO A PREFIX MATCH, and it is a free-tier
 * obligation rather than a preference. The contract states it directly: "a suffix match is
 * not servable by an ordinary prefix index, so the storage design must either keep a
 * reversed-digit column or bound the scan. An unbounded scan of every customer row per
 * keystroke is the noisy-neighbour failure MULTITENANCY_STANDARD.md §7.7 warns about."
 *
 * Reversing by code point rather than by UTF-16 unit is irrelevant here — the input is
 * ASCII digits by construction — but the loop is written to be obviously correct rather
 * than to rely on that.
 */
export function reversedPhoneDigits(value: string): string {
  const digits = phoneDigits(value);
  let reversed = '';
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    reversed += digits[i];
  }
  return reversed;
}
