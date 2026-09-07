/**
 * ===========================================================================================
 * THE CREDENTIAL LOOKUP PORT. `docs/decisions/0015` §D, Accepted 2026-09-04.
 * ===========================================================================================
 *
 * `0014` §C deliberately did not settle "the identity provider itself", and every file in this
 * directory was written so it did not settle one as a side effect. `0015` settles it, and this is
 * the first of the three files that implements it:
 *
 *   credential-store.ts     what a stored credential IS, and how a submitted identifier becomes
 *                           the key it is found by. THIS FILE.
 *   credential-verifier.ts  how a submitted value is checked against a stored one, with EQUAL
 *                           WORK on the found and not-found branches.
 *   login.ts                the two pre-authentication handlers that use both.
 *
 * ===========================================================================================
 * WHY THE LOOKUP KEY IS A KEYED HASH AND NOT THE EMAIL ADDRESS
 * ===========================================================================================
 *
 * `migrations/control-plane/0001_principal.sql` records two omissions and requires that whatever
 * a credential design adds be reviewed against them. The second is the binding one:
 *
 *   *"NO EMAIL ADDRESS, NAME, PHONE NUMBER OR LOCALE. This is the one table in the platform that
 *   spans every Organization. A directory of every user's personal details, readable without any
 *   tenant scope, would be the highest-value target in the system and it would exist for the
 *   convenience of a login form."*
 *
 * A login form nevertheless has to find a row from an email address. THE RESOLUTION IS THAT THE
 * CONTROL PLANE STORES NO EMAIL ADDRESS — it stores `HMAC-SHA-256(secret, normalized_email)`,
 * base64url, as the primary key of `principal_credential`. Lookup is a point read on that hash,
 * computed from what the caller typed.
 *
 * WHAT THAT BUYS: a stolen control-plane database is not a mailing list. The `identifier_hash`
 * column is not invertible without the Worker secret, and the secret is not in the database,
 * not in the repository and not in the same failure domain as a D1 dump. `0001`'s omission
 * therefore survives the arrival of a login form, which is exactly what it asked to be checked.
 *
 * WHAT IT COSTS, AND ALL THREE COSTS ARE REAL:
 *
 *   1. ROTATING `IDENTITY_LOOKUP_KEY` LOCKS EVERY USER OUT, PERMANENTLY AND SILENTLY. The stored
 *      hashes were computed under the old key and cannot be recomputed without the plaintext
 *      addresses, which are not stored. There is no migration path that does not involve every
 *      user re-enrolling. This is the single most dangerous operational property in this file and
 *      it is stated first for that reason.
 *   2. AN OPERATOR CANNOT ANSWER "WHICH ACCOUNT IS sam@example.com?" from the database. They can
 *      only compute the hash with the key and look it up — which is a deliberate friction, not an
 *      accident, and it is the same friction that stops a database reader enumerating users.
 *   3. NO CASE-INSENSITIVE OR FUZZY MATCHING IS POSSIBLE. The hash is exact. Normalisation is
 *      therefore load-bearing and is specified below rather than left to each caller.
 *
 * ===========================================================================================
 * NORMALISATION IS NORMATIVE AND IS SHARED WITH BOTH CLIENTS. GET IT WRONG AND NOBODY LOGS IN.
 * ===========================================================================================
 *
 * `0015` §D makes the CLIENT's PBKDF2 salt the normalised email. So the same normalisation runs
 * in three implementations — this file, the web client's TypeScript, and the Apple client's Swift
 * — and all three must produce BYTE-IDENTICAL output or the derived value differs and the user is
 * refused. A mismatch fails closed and loud (nobody can log in), which is the safe direction, but
 * it is still an outage.
 *
 * THE DEFINITION IS DELIBERATELY NARROWER THAN "lowercase it", and each narrowing removes a
 * cross-language divergence rather than expressing a preference:
 *
 *   1. REJECT BEFORE NORMALISING. An identifier containing whitespace, a control character, or a
 *      character above U+007E is refused outright by `isSubmittableIdentifier`. This is what makes
 *      the remaining steps portable: JavaScript's `String.prototype.trim` trims the Unicode
 *      White_Space set and Swift's `trimmingCharacters(in: .whitespacesAndNewlines)` trims a
 *      different set, so a value that needs trimming is a value the three implementations can
 *      disagree about. Refusing it removes the disagreement instead of arbitrating it.
 *   2. NFKC. Applied for the ASCII subset it is the identity function, so it costs nothing today
 *      and keeps the definition correct if the ASCII restriction is ever relaxed by a recorded
 *      decision.
 *   3. ASCII-ONLY CASE FOLDING — `A`–`Z` to `a`–`z`, and nothing else. NOT `toLowerCase()`.
 *      Full Unicode case mapping differs between JavaScript and Swift for real characters
 *      (U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE is the usual example), and a login that
 *      works on the web and fails on iPhone for one user is a defect nobody would find.
 *
 * THE COST OF THE ASCII RESTRICTION IS STATED RATHER THAN HIDDEN: an internationalised email
 * address (RFC 6531, a non-ASCII local part or a non-punycode domain) CANNOT BE USED TO LOG IN.
 * Punycode domains work because they are ASCII. Relaxing this needs a decision record and shared
 * test vectors for all three implementations, in that order.
 *
 * ===========================================================================================
 * THIS PORT IS NOT A STORE, AND IT IS SEPARATE FROM `IdentityControlPlaneStore`
 * ===========================================================================================
 *
 * `control-plane-store.ts` property 3 splits the control plane in two so each consumer holds only
 * its half. This is a third half, and the split is the same argument one step further: the login
 * handler needs to turn an identifier into a principal, and NOTHING ELSE IN THE PLATFORM SHOULD
 * BE ABLE TO. It has one method, that method is keyed by a hash the caller cannot compute, and it
 * returns no email address, no display name and no membership.
 *
 * NOTE WHAT IS ABSENT AND MAY NOT BE ADDED: no `listCredentials`, no `findByPrincipal`, no
 * `createCredential` and no `updateCredential`. Enrollment is an OPERATOR ACTION performed out of
 * band (`tools/seed-principal.ts`), so the running Worker has no code path that writes a
 * credential at all — which means no request, authenticated or not, can create or change one.
 * That is the strongest form of "registration is not built in this slice" available.
 */

import type { Result } from '../kernel/result.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';

/**
 * The only credential algorithm this platform recognises today.
 *
 * IT IS A COLUMN AND NOT A CONSTANT IN CODE, and `0015` §D.4 is explicit about why: *"A verifier
 * column carrying an algorithm identifier lets Dudo migrate to passkeys later, transparently, on
 * each user's next login."* The value is validated on read against this union, and an
 * unrecognised value is treated as a MISS — not as an error and not as a match — so a row written
 * by a future migration this build does not understand fails closed and, critically, fails closed
 * on the SAME work path as an absent row. See `credential-verifier.ts`.
 */
export type CredentialAlgorithm = 'pbkdf2-sha256-v1';

/**
 * A stored credential.
 *
 * `verifier` IS `PBKDF2-SHA256(kdf_output, salt, iterations)` AND NEVER `kdf_output` ITSELF. This
 * is the single normative sentence of `0015` §D and the difference between this design and a
 * catastrophe: the client's derived value is a bearer secret, so storing it would make a database
 * dump *directly usable as a login credential* with no cracking at all. The server stores a hash
 * of what the client sends, exactly as it would store a hash of a password.
 *
 * THERE IS NO EMAIL, NO DISPLAY NAME AND NO LAST-USED TIMESTAMP. The first two are `0001`'s
 * recorded omission; the third would be a D1 write on the login path, which
 * `session-resolution.ts` ruling 3 and `0014` §A both refuse.
 */
export type CredentialRecord = {
  /** base64url of `HMAC-SHA-256(IDENTITY_LOOKUP_KEY, normalized_identifier)`. 43 characters. */
  readonly identifierHash: string;
  /** The principal this credential authenticates. Server-derived; never taken from a request. */
  readonly principalId: string;
  readonly algorithm: CredentialAlgorithm;
  readonly iterations: number;
  /** base64url of the per-user random salt. 16 bytes, 22 characters. */
  readonly salt: string;
  /** base64url of the stored hash. 32 bytes, 43 characters. */
  readonly verifier: string;
};

/**
 * One question, keyed by a value the caller cannot compute.
 *
 * `null` MEANS "NO ROW" AND CARRIES NOTHING ELSE. There is no "wrong password" and no "account
 * suspended" here, because this port does not verify — verification is
 * `credential-verifier.ts`'s, and it is written so that the found and not-found branches cost the
 * same. A port that returned a richer answer would tempt a caller into an early return, and an
 * early return on the miss branch IS the account-existence oracle.
 */
export type CredentialStore = {
  findByIdentifierHash(identifierHash: string): Promise<Result<CredentialRecord | null>>;
};

// =============================================================================================
// Normalisation and the submitted-identifier floor
// =============================================================================================

/**
 * The longest identifier accepted. Shorter than `PRE_AUTH_MAX_FIELD_LENGTH` (512) deliberately:
 * RFC 5321 caps a path at 256 octets, so anything longer is not an email address, and every byte
 * past the cap is work an unauthenticated caller can compel on the hashing path.
 */
export const MAX_IDENTIFIER_LENGTH = 254;

/** The shortest thing that can be an address at all: `a@b`. */
export const MIN_IDENTIFIER_LENGTH = 3;

/**
 * ===========================================================================================
 * THE CLIENT'S ITERATION COUNT. NORMATIVE, AND THE SERVER NEVER USES IT.
 * ===========================================================================================
 *
 * `0015` §D: `kdf_output = PBKDF2-SHA256(password, salt = normalize(email), 600,000, 32 bytes)`.
 * 600,000 is OWASP's current recommendation for PBKDF2-SHA256 and it is what makes the combined
 * offline work factor — roughly 610,000 once the server's 10,000 is added — adequate at all.
 *
 * IT IS DECLARED IN CORE EVEN THOUGH NO SERVER CODE PATH READS IT, and that is the point: it is
 * the single source of truth for the two clients and for the enrollment tool, which are the three
 * implementations that must agree byte-for-byte. `platform/web/**` may import this constant;
 * the Apple client cannot import TypeScript and must mirror it, which is what makes shared test
 * vectors a QA obligation rather than a nicety.
 *
 * THE SERVER CANNOT VERIFY THAT A CLIENT USED IT. It receives 32 bytes and cannot tell how they
 * were produced — see `credential-verifier.ts`, `SUBMITTED_VALUE_CHARACTERS`, for exactly how far
 * that goes and where it stops. What saves it today is that enrollment runs the same constant, so
 * a client using a different one derives a different value and is refused: the mismatch fails
 * closed and loud rather than silently weakening the factor.
 */
export const CLIENT_KDF_ITERATIONS = 600_000;

/**
 * ===========================================================================================
 * *** A STRING THAT HAS BEEN CHECKED AGAINST THE ACCOUNT-IDENTIFIER GRAMMAR. ***
 * `account-identifier-v1` · `architecture.md` §3a.
 * ===========================================================================================
 *
 * **WHAT IT CERTIFIES:** this value passed `isSubmittableIdentifier`. Nothing else.
 *
 * ===========================================================================================
 * WHY IT EXISTS: FOUR CALL SITES, TWO OF WHICH FORGOT
 * ===========================================================================================
 *
 * `credential-verifier.ts` and `seed-principal.ts` check before normalising.
 * `onboarding-service.ts` and `member-resolution.ts` did not — **their handlers did it for them**,
 * so there was no live hole, and that is exactly the shape worth fixing: **the protection was a
 * property of two callers remembering, and the services — the reusable units — enforced nothing.**
 * A third caller of either would have inherited none of it.
 *
 * §3a: *"a guard that must be remembered is a discipline; a guard whose output the write requires
 * is a mechanism."* **Adding the two missing calls would have left the fifth author to remember.**
 *
 * ===========================================================================================
 * *** IT MINTS ON THE CHECK AND NEVER ON `normalizeIdentifier`. THIS IS THE WHOLE DESIGN. ***
 * ===========================================================================================
 *
 * `normalizeIdentifier` returns a **plain `string`** and must keep doing so, because
 * **`platform/core/platform/templates.ts::normalizeTemplateName` DELEGATES TO IT** — deliberately,
 * so Template-name collisions and identifier collisions cannot drift apart.
 *
 * **IF THE BRAND RODE ON THE NORMALISER'S RETURN TYPE, THAT LINE WOULD NEED A CAST TODAY** — and a
 * cast is what defeats a brand. The person adding it would be fixing a Template test, in a file
 * whose author never opted into the identifier rule, and **they would be right to think they were
 * unblocking themselves.** The brand would be gone and the reason would look local and reasonable.
 *
 * So: **brand the checked RAW identifier; leave the normaliser serving both domains untyped.**
 *
 * ===========================================================================================
 * IT CARRIES THE **RAW** STRING, NOT THE NORMALISED ONE
 * ===========================================================================================
 *
 * The order at both correct call sites is **check, then normalise**, and it must stay that way.
 * `account-identifier-v1` records why: `normalizeIdentifier` **case-folds ASCII only**, which is
 * complete *because* the accepted character set is ASCII. **A brand that normalised on the way in
 * would put the fold before the grammar check** and create exactly the pressure that argument
 * exists to resist.
 *
 * ===========================================================================================
 * TWO PROPERTIES IT DELIBERATELY DOES **NOT** HAVE
 * ===========================================================================================
 *
 * **NO IN-STATEMENT BACKSTOP, BECAUSE THERE IS NO STALENESS WINDOW.** §3a's worked example is a
 * fact that CAN go stale between the mint and the write — a principal made an operator in between —
 * and it concludes that the in-statement guard is the load-bearing layer. **That reasoning does not
 * transfer here and the symmetry is a trap:** this fact is a pure function of the string, the
 * string is immutable, and nothing can change between the check and the use. Adding a re-check for
 * consistency with that example would be ceremony.
 *
 * **NOT SINGLE-USE.** §3a: *"single-use copied without its rationale is the exported-mint mistake
 * again."* A **capacity** receipt must be single-use — spending it twice spends one budget twice.
 * This is a **fact** receipt: re-using it consumes nothing and is refused by nothing, because the
 * string it certifies does not change.
 */
declare const CHECKED_IDENTIFIER_BRAND: unique symbol;

export type CheckedIdentifier = string & {
  readonly [CHECKED_IDENTIFIER_BRAND]: true;
};

/**
 * The **only** producer of a `CheckedIdentifier`. Returns `null` for a value the platform will not
 * accept.
 *
 * IT WRAPS `isSubmittableIdentifier` RATHER THAN REPLACING IT, so there is exactly one grammar and
 * the boolean form stays available for the places that want a predicate. **Two implementations of
 * "is this an identifier" would agree until one was touched**, and the divergence would be an
 * account that can be created and cannot log in.
 */
export function checkIdentifier(value: string): CheckedIdentifier | null {
  return isSubmittableIdentifier(value) ? (value as CheckedIdentifier) : null;
}

/**
 * Is this value one the platform will normalise at all?
 *
 * DELIBERATELY NOT AN EMAIL VALIDATOR. It does not try to decide whether an address is
 * deliverable — nothing here sends mail, and a stricter grammar would refuse valid addresses for
 * no security gain. It decides exactly one thing: whether three implementations in three
 * languages will agree on the normalised form. See the header, point 1.
 *
 * REFUSAL IS NOT AN EXISTENCE SIGNAL. It is reached from the shape of the submitted string, which
 * the caller wrote and already knows, and it is identical for every string of that shape. It is
 * also mapped by `login.ts` onto the same fixed refusal every other failure produces.
 */
export function isSubmittableIdentifier(value: string): boolean {
  if (value.length < MIN_IDENTIFIER_LENGTH || value.length > MAX_IDENTIFIER_LENGTH) {
    return false;
  }
  let hasAt = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Printable ASCII only, and space (0x20) is excluded along with the control range.
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
 * The normative normalisation. NFKC, then ASCII-only case folding.
 *
 * CALL `isSubmittableIdentifier` FIRST. This function does not re-check, because a second place
 * that decides what is acceptable is a second place the three implementations can diverge.
 *
 * THE EQUIVALENT IN THE OTHER TWO IMPLEMENTATIONS, written out so a client author does not have
 * to infer it from this code:
 *
 *   web    `value.normalize('NFKC')` then replace `/[A-Z]/g` with the same letter + 32
 *   Apple  `value.precomposedStringWithCompatibilityMapping` then the same ASCII-only map.
 *          NOT `lowercased()`, which is full Unicode case mapping.
 *
 * `qa-agent` must bind all three with shared test vectors (`0015` §D: "QA must bind both clients
 * with shared test vectors, because web (`crypto.subtle`) and Apple (`CCKeyDerivationPBKDF`) must
 * produce byte-identical output").
 */
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
 * ===========================================================================================
 * PASSWORD NORMALISATION. NFC, AND NOTHING ELSE. `docs/decisions/0015` §D, amended 2026-09-04.
 * ===========================================================================================
 *
 * THE GAP THIS CLOSES, found by `web-agent`: §D said only "the UTF-8 password", and Unicode has
 * more than one byte sequence for the same visible text. `é` is U+00E9 composed or U+0065 U+0301
 * decomposed; macOS hands back decomposed text from some input paths and Windows composed. A user
 * enrolling on one and logging in on the other derives a different 32 bytes and is refused, with
 * no way for either side to see why — the password looks identical on both screens.
 *
 * ===========================================================================================
 * NFC FOR THE PASSWORD. NFKC FOR THE IDENTIFIER. BOTH ARE IN THIS FILE AND THEY ARE NOT THE SAME.
 * ===========================================================================================
 *
 *                        identifier                        password
 *   Unicode form         NFKC                              NFC
 *   case                 folded, ASCII range only          PRESERVED
 *   whitespace           rejected before normalising       PRESERVED, including at the ends
 *   character range      printable ASCII only              ANY
 *
 * WHY NOT NFKC HERE, WHICH IS THE MISTAKE THIS COMMENT EXISTS TO PREVENT. NFKC is COMPATIBILITY
 * normalisation: it folds `ﬁ` to `fi`, `²` to `2`, full-width forms to ASCII, and non-breaking
 * space to space. That is exactly right for an identifier, where two spellings of one address
 * must reach one row. It is DESTRUCTIVE for a password, where those distinctions are entropy the
 * user believes they have: a passphrase using typographic characters would be silently folded
 * onto a smaller alphabet, and the search space an attacker faces would shrink without anyone
 * choosing that.
 *
 * NO CASE FOLDING AND NO TRIMMING, for the same reason. A password is case-sensitive and a
 * leading or trailing space is a character the user typed. RFC 8265's PRECIS `OpaqueString`
 * profile is the reference and this is its rule.
 *
 * ===========================================================================================
 * CORE CANNOT ENFORCE THIS. IT IS A CLIENT OBLIGATION, AND THAT IS STATED RATHER THAN IMPLIED.
 * ===========================================================================================
 *
 * The server never sees a password — it receives 32 derived bytes — so nothing here can check
 * that a client normalised before encoding. What makes the rule hold in practice is that
 * `tools/seed-principal.ts` applies it when it derives the enrolment value, so a client that
 * skips it derives a different key and is refused: the mismatch fails closed and loud rather than
 * weakening anything silently. That is the same self-checking property the iteration count has,
 * and it is the only enforcement available.
 *
 *   web    `password.normalize('NFC')` then `new TextEncoder().encode(...)`
 *   Apple  `password.precomposedStringWithCanonicalMapping` then `.data(using: .utf8)`
 *          NOT `precomposedStringWithCompatibilityMapping`, which is NFKC.
 */
export function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

// =============================================================================================
// The lookup-key derivation
// =============================================================================================

/**
 * Domain separation. The same secret must never produce the same output for two different
 * purposes, and a label inside the signed message is the cheapest way to guarantee it.
 *
 * THE `v1` IS PART OF THE STORED KEY. Changing this string changes every hash and locks every
 * user out, exactly as rotating the secret does. It is versioned so that a future change is a
 * deliberate, named migration rather than an edit to a string literal.
 */
const IDENTIFIER_HASH_LABEL = 'dudo.identity.credential.v1';

/** The minimum key size. A Worker secret, provisioned by the Team Lead, never in the repository. */
export const MIN_IDENTITY_LOOKUP_KEY_BYTES = 32;

export class IdentityLookupKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityLookupKeyError';
  }
}

/**
 * Turns a submitted identifier into the primary key of `principal_credential`.
 *
 * IT IS A PORT RATHER THAN A FUNCTION TAKING A KEY, for the reason `PreAuthIdentifierBucketer` is:
 * the imported `CryptoKey` is created once at composition and the raw secret bytes never travel
 * with the call. A caller that holds this object can compute lookup keys and can do nothing else
 * with the secret.
 */
export type IdentifierHasher = {
  hash(normalizedIdentifier: string): Promise<string>;
};

/**
 * WebCrypto HMAC-SHA-256, keyed by a Worker secret. Same precedent as
 * `createHmacIdentifierBucketer` and `kernel/ids.ts`: `crypto.subtle` is a platform global in
 * Workers and in Node, so this names no vendor type and adds no dependency.
 *
 * A PLAIN SHA-256 WOULD NOT DO. Email addresses are low-entropy and enumerable: an attacker with
 * a database dump and an unkeyed hash recovers the address list by hashing a wordlist, which is
 * precisely the disclosure `0001_principal.sql` refused. The key is the whole control.
 */
export async function createHmacIdentifierHasher(
  secret: CryptoBytes,
): Promise<IdentifierHasher> {
  if (secret.length < MIN_IDENTITY_LOOKUP_KEY_BYTES) {
    throw new IdentityLookupKeyError(
      `IDENTITY_LOOKUP_KEY must be at least ${String(MIN_IDENTITY_LOOKUP_KEY_BYTES)} bytes. It ` +
        'is a Worker secret provisioned by the Team Lead and is never held in the repository. ' +
        'Note before provisioning it: rotating this key locks every existing user out ' +
        'permanently, because the stored lookup hashes cannot be recomputed without the ' +
        'plaintext addresses, which the control plane deliberately does not store.',
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return {
    async hash(normalizedIdentifier: string): Promise<string> {
      const message = new TextEncoder().encode(
        `${IDENTIFIER_HASH_LABEL} ${normalizedIdentifier}`,
      );
      const signature = await crypto.subtle.sign('HMAC', key, message);
      return toBase64Url(new Uint8Array(signature));
    },
  };
}

// =============================================================================================
// base64url, without a dependency
// =============================================================================================

/**
 * The same encoding `kernel/ids.ts` uses, restated here rather than exported from there, because
 * that module's function is private and widening its surface to serve this one would make an
 * identifier generator into a general codec.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes base64url to exactly `expectedBytes` bytes, or returns `null`.
 *
 * IT TAKES THE EXPECTED LENGTH AND ENFORCES IT. Every base64url value in this slice has a fixed
 * width — a 16-byte salt, a 32-byte verifier, a 16-byte MAC — and accepting a shorter one would
 * let a truncated stored value, or a truncated submitted one, be compared successfully against a
 * prefix. A length check is one line; a length-extension argument is not.
 *
 * IT IS NOT CONSTANT-TIME AND DOES NOT NEED TO BE. It is applied either to a value the caller
 * wrote, or to a value read from Dudo's own database — never to a comparison between the two.
 * The comparison is `constantTimeEquals` in `credential-verifier.ts`.
 */
export function fromBase64Url(value: string, expectedBytes: number): CryptoBytes | null {
  const expectedCharacters = Math.ceil((expectedBytes * 4) / 3);
  if (value.length !== expectedCharacters || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  if (binary.length !== expectedBytes) {
    return null;
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
