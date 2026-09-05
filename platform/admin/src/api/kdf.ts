/**
 * ===========================================================================
 * THIS FILE IS A DELIBERATE COPY OF `platform/web/src/api/kdf.ts`.
 * ===========================================================================
 *
 * IT IS COPIED, NOT IMPORTED, AND THAT IS AN OWNERSHIP CONSTRAINT RATHER THAN A
 * TECHNICAL ONE. `platform/web/**` belongs to `web-agent` and `platform/admin/**`
 * belongs to this console; `.claude/rules/architecture.md` §2 says an agent edits
 * only inside its own paths and reaches across boundaries through contracts, not
 * through relative imports. A `../../web/src/api/kdf` here would be a
 * cross-boundary source dependency between two independently owned, independently
 * built and independently deployed clients, and it would break the moment either
 * one moves.
 *
 * ===========================================================================
 * THE TWO COPIES MUST NOT DRIFT, AND DRIFT IS CHECKED MECHANICALLY
 * ===========================================================================
 *
 * EVERY LINE BELOW THE `Normative constants` BANNER IS BYTE-IDENTICAL TO THE WEB
 * CLIENT'S FILE. That is not a convention anyone is asked to remember:
 * `scripts/verify-kdf.mjs` reads `platform/web/src/api/kdf.ts` at verification
 * time and compares the two normative regions character for character. It FAILS
 * if they differ. Only this header — everything above the banner — is allowed to
 * be different, because only this header is about which copy you are reading.
 *
 * SO A CHANGE TO EITHER COPY BREAKS THE OTHER'S VERIFICATION, LOUDLY, AT THE
 * BUILD THAT MADE IT. That is the whole point. The alternative — a comment asking
 * people to keep two files in step — is the arrangement that produces a
 * cross-client login outage six months later.
 *
 * IF YOU ARE HERE TO CHANGE SOMETHING: you cannot change it here. The derivation
 * is a FOUR-implementation contract — this console, `platform/web`, `Dudo-Apple`
 * in Swift, and `platform/core/identity/credential-store.ts` — and a change to it
 * is a contract change that goes to the Team Lead, lands in all four, and updates
 * the shared test vectors. `packages/contracts/core/identity/login-v1.contract.yaml`
 * lists it under the changes that break the contract.
 *
 * ===========================================================================
 * WHY AN ADMIN CONSOLE NEEDS THIS AT ALL
 * ===========================================================================
 *
 * `packages/contracts/core/platform/platform-operator-v1.contract.yaml`,
 * `authentication`: "UNCHANGED FROM EVERY OTHER PRINCIPAL. An operator logs in
 * through login-v1's existing pre-authentication entry points... THIS CONTRACT
 * INTRODUCES NO SECOND LOGIN PATH, NO SECOND CREDENTIAL FORMAT AND NO SECOND
 * SESSION SHAPE, and it must not: a parallel authentication path for the most
 * privileged principals is a second implementation of the hardest code in the
 * platform."
 *
 * A platform operator is an ordinary principal with a row in `platform_operator`
 * (`0025`) and — critically — ZERO membership rows (`0024`). Their credential is
 * derived exactly as anyone else's. An operator enrolled through one client and
 * unable to sign in through the other would be the same outage as any user's,
 * except that the people it locks out are the only ones who could fix it.
 *
 * ===========================================================================
 * THE ORIGINAL HEADER FOLLOWS IN SUMMARY. READ THE WEB COPY FOR IT IN FULL.
 * ===========================================================================
 *
 *   base64url( PBKDF2-SHA256( password,
 *                             salt       = normalizeIdentifier(email),
 *                             iterations = 600000,
 *                             length     = 32 bytes ) )
 *
 *   1. VALIDATE the identifier. Reject, never trim. ASCII 0x21-0x7E, 3-254, `@`.
 *   2. NFKC the identifier. 3. ASCII-ONLY case fold, A-Z to a-z, not
 *      `toLowerCase()`. 4. UTF-8 encode — THAT is the salt.
 *   5. NFC the password — NFC, NOT NFKC — then UTF-8 encode.
 *   6. PBKDF2-HMAC-SHA-256, 600,000 iterations, 32 bytes.
 *   7. base64url, no padding, exactly 43 characters. THE RAW PASSWORD NEVER
 *      LEAVES THE BROWSER.
 *
 * The identifier is NFKC and the password is NFC, and the asymmetry is the part
 * that is easy to get backwards: NFKC is a compatibility mapping that folds
 * distinct characters together, which is wanted for an address (two spellings,
 * one account) and DESTROYS PASSWORD ENTROPY THE USER BELIEVES THEY HAVE
 * (someone who chose `²` would get the strength of `2`). RFC 8265's PRECIS
 * `OpaqueString` profile, which SCRAM and SASL use for this exact problem.
 *
 * CORE NEVER SEES A PASSWORD, SO NFC IS A RULE ONLY THE CLIENTS CAN KEEP. There
 * is no server-side check that could catch a client skipping it — the server
 * receives 43 characters either way.
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
