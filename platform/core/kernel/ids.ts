/**
 * Opaque identifier generation.
 *
 * The Customer Directory contract (README.md §5) states that the generation scheme is a
 * Core decision and deliberately does not fix it, but binds it: opaque, non-sequential,
 * unguessable, and at least 8 characters so that a short enumerable scheme cannot be
 * adopted without anyone noticing.
 *
 * WHAT IS CHOSEN HERE, AND WHY.
 *
 * 22 characters of base64url over 128 bits drawn from the platform CSPRNG. Not a counter,
 * not a timestamp prefix, not a hash of anything about the record.
 *
 * - 128 bits is the width at which guessing is not a strategy. The contract's §3.2 ruling
 *   — that a wrong-Business record inside the right Organization returns `forbidden` —
 *   rests explicitly on identifiers being unguessable: it accepts an in-tenant existence
 *   disclosure only because "an identifier can only have come from inside the tenant
 *   already". A weaker identifier turns that accepted risk into an enumeration oracle.
 * - No timestamp component. A sortable identifier leaks creation order, which is a
 *   business fact (how many customers were added, and when) recoverable from identifiers
 *   the client already holds.
 * - Identifiers are unique platform-wide rather than per tenant. Uniqueness prevents
 *   collision; it has never prevented reachability, and reachability is decided entirely
 *   by the tenant predicate at the storage boundary (README.md §5).
 *
 * The alphabet matches the contract's `^[A-Za-z0-9_-]{8,64}$`.
 *
 * WebCrypto is used, not a Cloudflare API. `crypto.getRandomValues` is a platform global
 * in Workers and in Node, so this file names no vendor type (CLOUDFLARE_STANDARD.md §2).
 */

const ID_BYTES = 16;

/**
 * The port. Domain code asks for an identifier; it never reaches for a random source
 * itself, so a test can supply a deterministic generator without a global being patched.
 */
export type IdGenerator = {
  generate(): string;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createRandomIdGenerator(): IdGenerator {
  return {
    generate(): string {
      const bytes = new Uint8Array(ID_BYTES);
      crypto.getRandomValues(bytes);
      return toBase64Url(bytes);
    },
  };
}
