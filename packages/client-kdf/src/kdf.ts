/**
 * ===========================================================================
 * THE CLIENT-SIDE KEY DERIVATION. ADR 0015 §D, option (f). NORMATIVE.
 * ===========================================================================
 *
 * THIS FILE IS A CROSS-CLIENT CONTRACT WRITTEN IN CODE. Every constant and
 * every step below is also implemented in Swift in `Dudo-Apple` and in
 * TypeScript in `platform/core/identity/credential-store.ts`. If the three
 * implementations do not produce BYTE-IDENTICAL output, a person who enrols on
 * one client cannot log in on the other. That failure is closed and loud —
 * nobody can log in, rather than someone logging in wrongly — but it is still
 * an outage, and it is invisible until a real user hits it.
 *
 * NOTHING HERE MAY BE "IMPROVED", TIDIED, ROUNDED OR MADE FASTER WITHOUT THE
 * SAME CHANGE LANDING IN THE OTHER TWO. It is not local code.
 *
 * The authored source is `platform/core/identity/login.ts`, which states the
 * derivation the two clients must match:
 *
 *   base64url( PBKDF2-SHA256( password,
 *                             salt       = normalizeIdentifier(email),
 *                             iterations = 600000,
 *                             length     = 32 bytes ) )
 *
 * ===========================================================================
 * THE PROCEDURE, IN ORDER, AND THE ORDER MATTERS
 * ===========================================================================
 *
 *   1. VALIDATE. Do not normalise into validity. Every character in 0x21–0x7E,
 *      length 3–254, must contain `@`. Anything <= 0x20 or > 0x7E is REFUSED,
 *      never trimmed.
 *   2. NFKC. `value.normalize('NFKC')`.
 *   3. ASCII-ONLY case folding, A–Z to a–z, nothing else. NOT `toLowerCase()`.
 *   4. UTF-8 encode the result of 2–3. THAT IS THE SALT — the normalised value,
 *      never the raw input.
 *   5. NFC-normalise the password — `password.normalize('NFC')` — then UTF-8
 *      encode it. NFC, NOT NFKC. See below.
 *   6. PBKDF2-HMAC-SHA-256 over those password bytes, 600,000 iterations,
 *      32 bytes out.
 *   7. base64url, no padding. Exactly 43 characters. That string is
 *      `derived_key` on the wire. THE RAW PASSWORD NEVER LEAVES THE BROWSER.
 *
 * ===========================================================================
 * WHY THE SALT IS THE EMAIL AND NOT A SERVER VALUE
 * ===========================================================================
 *
 * A per-user random salt would have to be fetched before login, and
 * `identity.login.start` is `disclosure: 'collapsed'`
 * (`platform/core/identity/pre-auth-registry.ts`): it renders one constant body
 * for every caller. There is no way to deliver a per-user value through it
 * without answering differently for an account that exists — which is the
 * account-existence oracle the whole pre-auth design is built to close. ADR 0015
 * §D calls this "a forced answer"; it is also the construction Bitwarden ships.
 *
 * The cost is covered on the server side, not here: `credential-store.ts` is
 * explicit that the server stores `PBKDF2(derived_key, per_user_random_salt,
 * 10_000)` and NEVER `derived_key` itself, so a database dump is not directly
 * usable as a login credential.
 *
 * ===========================================================================
 * WHY VALIDATION REJECTS RATHER THAN TRIMS, AND FOLDS ONLY ASCII
 * ===========================================================================
 *
 * Both rules come from `platform/core/identity/credential-store.ts`, which is
 * the authored definition. JavaScript's `String.prototype.trim` trims the
 * Unicode White_Space set and Swift's
 * `trimmingCharacters(in: .whitespacesAndNewlines)` trims a different set, so a
 * value that NEEDS trimming is a value the three implementations can disagree
 * about; refusing it removes the disagreement instead of arbitrating it. The
 * same argument rules out `toLowerCase()`: full Unicode case mapping differs
 * between JavaScript and Swift for real characters (U+0130 LATIN CAPITAL LETTER
 * I WITH DOT ABOVE is the usual example), and a login that works on the web and
 * fails on iPhone for one user is a defect nobody would find.
 *
 * NFKC is kept even though it is the identity function over the ASCII subset:
 * it costs nothing today and keeps the definition correct if the ASCII
 * restriction is ever relaxed by a recorded decision.
 *
 * THE ACCEPTED, RECORDED COST: an RFC 6531 internationalised address — a
 * non-ASCII local part, or a non-punycode domain — CANNOT BE USED TO LOG IN.
 * Punycode domains work, because they are ASCII. An address pasted with a
 * trailing space is refused rather than quietly accepted.
 *
 * ===========================================================================
 * THE PASSWORD IS NFC-NORMALISED. NFC, AND SPECIFICALLY NOT NFKC.
 * ===========================================================================
 *
 * NORMATIVE, recorded as an amendment to ADR 0015 §D on 2026-09-04.
 *
 * WHY IT IS NORMALISED AT ALL. The same password can be produced in more than
 * one byte sequence: `é` is one code point on a Mac keyboard (U+00E9, composed)
 * and two on some input methods (U+0065 U+0301, decomposed). They look identical
 * on screen, they are different bytes, and PBKDF2 derives different keys from
 * them. Without normalisation a person could enrol on one client and be unable
 * to log in on the other, having typed the same password — and it would be
 * invisible until a real user with a non-ASCII password hit it.
 *
 * WHY NFC AND NOT NFKC — this is the part that is easy to get backwards, because
 * the email a few lines above uses NFKC. **NFKC IS A COMPATIBILITY MAPPING: it
 * folds distinct characters onto one.** It maps `ﬁ` to `fi`, `²` to `2`, and a
 * full-width `Ａ` to `A`. Applied to an identifier that is what you want, because
 * two spellings of one address should find one account. Applied to a PASSWORD it
 * DESTROYS ENTROPY THE USER BELIEVES THEY HAVE: someone who chose `²` gets the
 * strength of `2`. NFC is a canonical mapping only — it changes the byte
 * sequence, never which characters were typed.
 *
 * This follows RFC 8265's PRECIS `OpaqueString` profile, which is what SCRAM and
 * SASL use for exactly this problem.
 *
 * THE TWO NORMALISATIONS NOW LIVE IN ONE CODE PATH FOR DIFFERENT INPUTS, which
 * is how they get confused. The rule, stated once:
 *
 *   email (the salt)  validate ASCII 0x21-0x7E, then NFKC, then ASCII case fold
 *   password          NFC only. No case folding, no trimming, no ASCII limit.
 *
 * A PASSWORD IS NEVER CASE-FOLDED, NEVER TRIMMED AND NEVER LENGTH-RESTRICTED
 * HERE. Leading and trailing spaces are part of a password; a person who chose
 * them chose them.
 *
 * CORE NEVER SEES A PASSWORD, SO THIS IS A RULE ONLY THE CLIENTS CAN KEEP. There
 * is no server-side check that could catch a client skipping it — the server
 * receives 43 characters either way. Today it costs one line per client; after
 * the first credential is enrolled it costs every account.
 */

/* -------------------------------------------------------------------------
   Normative constants
   ------------------------------------------------------------------------- */

/** OWASP's recommendation for PBKDF2-HMAC-SHA-256. ADR 0015 §D; `login.ts`. */
export const PBKDF2_ITERATIONS = 600_000;

/** 32 bytes. Encodes to exactly 43 base64url characters with no padding. */
export const KDF_OUTPUT_BYTES = 32;

/**
 * The exact wire length of `derived_key`.
 *
 * IT IS A SECURITY CHECK, NOT A FORMATTING ONE. ADR 0015 §D records the residual
 * risk plainly: "a client that posted the raw password instead of the KDF output
 * would be indistinguishable to the server. Requiring exactly 43 base64url
 * characters mitigates but does not close it." This client asserts the length on
 * its own output before sending, so a defect in this file becomes a local throw
 * rather than a password on the wire.
 */
export const CREDENTIAL_LENGTH = 43;

/** RFC 5321 caps a path at 256 octets; anything longer is not an address. */
export const MAX_IDENTIFIER_LENGTH = 254;

/** The shortest thing that can be an address at all: `a@b`. */
export const MIN_IDENTIFIER_LENGTH = 3;

/* -------------------------------------------------------------------------
   Identifier handling — mirrors platform/core/identity/credential-store.ts
   ------------------------------------------------------------------------- */

/**
 * Whether the submitted identifier can be normalised at all.
 *
 * DELIBERATELY NOT AN EMAIL VALIDATOR. It does not decide whether an address is
 * deliverable — nothing here sends mail, and a stricter grammar would refuse
 * valid addresses for no security gain. It decides exactly one thing: whether
 * three implementations in three languages will agree on the normalised form.
 */
export function isSubmittableIdentifier(value: string): boolean {
  if (value.length < MIN_IDENTIFIER_LENGTH || value.length > MAX_IDENTIFIER_LENGTH) {
    return false;
  }
  let hasAt = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Printable ASCII only, and space (0x20) is excluded along with the
    // control range.
    if (code <= 0x20 || code > 0x7e) {
      return false;
    }
    if (code === 0x40) {
      hasAt = true;
    }
  }
  return hasAt;
}

/**
 * NFKC, then ASCII-only case folding.
 *
 * CALL `isSubmittableIdentifier` FIRST. This function does not re-check, because
 * a second place that decides what is acceptable is a second place the three
 * implementations can diverge.
 *
 * The Apple equivalent is `precomposedStringWithCompatibilityMapping` followed
 * by the same ASCII-only map — NOT `lowercased()`.
 */
/**
 * NFC, and nothing else. See the header for why not NFKC.
 *
 * It is a named function rather than an inline `.normalize('NFC')` at the one
 * call site so that the rule has somewhere to be stated, somewhere to be tested,
 * and one name the Apple implementation can be checked against. The Swift
 * equivalent is `precomposedStringWithCanonicalMapping` — NOT
 * `precomposedStringWithCompatibilityMapping`, which is NFKC and is what the
 * identifier uses.
 */
export function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

export function normalizeIdentifier(value: string): string {
  const composed = value.normalize('NFKC');
  let normalized = '';
  for (let index = 0; index < composed.length; index += 1) {
    const code = composed.charCodeAt(index);
    normalized +=
      code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 32) : composed.charAt(index);
  }
  return normalized;
}

/**
 * Why an identifier was refused, in terms a person can act on. `null` when it is
 * acceptable.
 *
 * EVERY REASON IS ABOUT THE SHAPE THE CALLER TYPED, which they already know, so
 * naming them discloses nothing about any account. This is local form validation
 * and it runs before anything is sent; the server's own refusal is the fixed
 * 401 and says nothing at all.
 */
export function identifierRefusal(value: string): string | null {
  if (value.length === 0) return 'Enter your email address.';
  if (/\s/.test(value)) {
    return 'Remove the spaces from your email address, including any at the start or end.';
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      return 'Dudo can only sign you in with a plain ASCII email address at the moment.';
    }
  }
  if (!value.includes('@')) return 'An email address needs an @.';
  if (value.length < MIN_IDENTIFIER_LENGTH) return 'That is too short to be an email address.';
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    return `An email address cannot be longer than ${String(MAX_IDENTIFIER_LENGTH)} characters.`;
  }
  return isSubmittableIdentifier(value) ? null : 'That is not an email address Dudo can use.';
}

/* -------------------------------------------------------------------------
   base64url
   ------------------------------------------------------------------------- */

/** base64url, no padding. The same encoding Core uses in `credential-store.ts`. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* -------------------------------------------------------------------------
   The derivation
   ------------------------------------------------------------------------- */

export class CredentialDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialDerivationError';
  }
}

/**
 * Derives `derived_key` from a password and an ALREADY-NORMALISED identifier.
 *
 * IT TAKES THE NORMALISED FORM RATHER THAN NORMALISING INTERNALLY, so the caller
 * holds the one normalised string that is both sent as `email` and used as the
 * salt. Deriving it twice in two places is how the two come to differ.
 *
 * `crypto.subtle.deriveBits` rather than `deriveKey`: the output is not a key to
 * this client, it is 32 bytes to encode, and `deriveKey` would make it
 * non-extractable for no benefit.
 *
 * THIS CALL BLOCKS ITS THREAD FOR ROUGHLY ONE TO FOUR SECONDS at 600,000
 * iterations. It must not run on the main thread — see `kdf-client.ts`, which
 * runs it in a Web Worker.
 *
 * `iterations` is a parameter ONLY so the calibration probe in the worker can
 * time a short run and so the verification script can check known vectors.
 * NOTHING MAY PASS A VALUE OTHER THAN `PBKDF2_ITERATIONS` ON A LOGIN PATH: a
 * lower count is a weaker credential that the server would accept and store
 * without noticing, because the server sees only 43 characters either way.
 */
export async function deriveCredential(
  password: string,
  normalizedIdentifier: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder();

  const material = await crypto.subtle.importKey(
    'raw',
    // NFC, never NFKC — folding a password's characters together would destroy
    // entropy the person believes they have. See the header.
    encoder.encode(normalizePassword(password)),
    'PBKDF2',
    // Not extractable. Nothing needs to read the password back out of it.
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      // THE SALT IS THE NORMALISED IDENTIFIER, UTF-8 ENCODED. Not a hash of it,
      // not a prefixed or labelled form of it: the bytes of the string.
      salt: encoder.encode(normalizedIdentifier),
      iterations,
      hash: 'SHA-256',
    },
    material,
    KDF_OUTPUT_BYTES * 8,
  );

  const derivedKey = toBase64Url(new Uint8Array(bits));

  // The length assertion from ADR 0015 §D, applied to this client's own output.
  // If it ever fires, the derivation is wrong and sending the result would be
  // worse than failing.
  if (derivedKey.length !== CREDENTIAL_LENGTH) {
    throw new CredentialDerivationError(
      `The derived key is ${String(derivedKey.length)} characters, not ` +
        `${String(CREDENTIAL_LENGTH)}. ADR 0015 §D requires exactly ` +
        `${String(CREDENTIAL_LENGTH)} base64url characters, and that length is the only check ` +
        'the server has that a client sent a derived value rather than a raw password.',
    );
  }

  return derivedKey;
}

/**
 * Validate, normalise and derive in one step.
 *
 * Returns BOTH values the wire needs, together, from one normalisation.
 */
export async function deriveLoginCredential(
  rawIdentifier: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<{ email: string; derived_key: string }> {
  if (!isSubmittableIdentifier(rawIdentifier)) {
    throw new CredentialDerivationError(
      identifierRefusal(rawIdentifier) ?? 'That is not an email address Dudo can use.',
    );
  }
  const email = normalizeIdentifier(rawIdentifier);
  const derivedKey = await deriveCredential(password, email, iterations);
  return { email, derived_key: derivedKey };
}
