/**
 * Verifies the client-side KDF against ADR 0015 §D, and prints test vectors.
 *
 * WHY A SCRIPT AND NOT A TEST FILE. No testing framework is approved for
 * `Dudo-Core` (`.claude/rules/architecture.md` §6: "Web framework, testing
 * framework, npm packages — Not selected"), and an agent may not install one.
 * This runs on Node's own WebCrypto with no dependency at all, so the normative
 * behaviour is checkable today rather than after a framework decision.
 *
 * IT IMPORTS THE REAL MODULE. `node --experimental-strip-types` runs
 * `src/api/kdf.ts` directly, so this checks the code the browser ships and not a
 * copy of it — a copy would pass while the shipped file was wrong, which is the
 * failure mode that makes a verification script worse than none.
 *
 *   npm run verify:kdf
 *
 * ===========================================================================
 * THE VECTORS ARE FOR `qa-agent` AND FOR THE APPLE CLIENT
 * ===========================================================================
 *
 * ADR 0015 §D: "QA must bind both clients with shared test vectors, because web
 * (`crypto.subtle`) and Apple (`CCKeyDerivationPBKDF`) must produce
 * byte-identical output." The vectors printed at the end are that binding. An
 * Apple implementation that does not reproduce them, character for character,
 * is a cross-client contract defect and nobody will be able to log in.
 *
 * EVERY PASSWORD BELOW IS SYNTHETIC AND PUBLIC. `security.md` §6 — never real
 * credentials, never real customer data, anywhere, including in fixtures.
 */

import {
  CREDENTIAL_LENGTH,
  KDF_OUTPUT_BYTES,
  PBKDF2_ITERATIONS,
  deriveCredential,
  deriveLoginCredential,
  isSubmittableIdentifier,
  normalizeIdentifier,
  normalizePassword,
} from '../src/api/kdf.ts';

/*
 * Composed and decomposed spellings of the SAME visible text.
 *
 * "pässwörd" with precomposed ä/ö (one code point each) against the same string
 * with combining diaereses (two code points each). They render identically, they
 * are different bytes, and before the NFC amendment they derived different keys —
 * which is the cross-client defect this pins.
 */
const COMPOSED = 'pässwörd';
const DECOMPOSED = 'pässwörd';

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok
        ? ''
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

function checkTrue(name, actual) {
  check(name, actual, true);
}

console.log('\n=== Normative constants (ADR 0015 §D, platform/core/identity/login.ts) ===\n');
check('iterations is 600000', PBKDF2_ITERATIONS, 600_000);
check('output is 32 bytes', KDF_OUTPUT_BYTES, 32);
check('credential length is 43', CREDENTIAL_LENGTH, 43);

console.log('\n=== isSubmittableIdentifier — reject, never trim ===\n');
checkTrue('plain ASCII address accepted', isSubmittableIdentifier('sam@example.com'));
checkTrue('mixed case accepted', isSubmittableIdentifier('Sam.Tester@Example.COM'));
check('leading space REFUSED (not trimmed)', isSubmittableIdentifier(' sam@example.com'), false);
check('trailing space REFUSED (not trimmed)', isSubmittableIdentifier('sam@example.com '), false);
check('inner space refused', isSubmittableIdentifier('sam @example.com'), false);
check('tab refused', isSubmittableIdentifier('sam@example.com\t'), false);
check('newline refused', isSubmittableIdentifier('sam@example.com\n'), false);
check('non-ASCII local part refused (RFC 6531)', isSubmittableIdentifier('sám@example.com'), false);
check('non-ASCII domain refused', isSubmittableIdentifier('sam@exämple.com'), false);
checkTrue('punycode domain accepted', isSubmittableIdentifier('sam@xn--exmple-cua.com'));
check('no @ refused', isSubmittableIdentifier('sam.example.com'), false);
check('too short refused', isSubmittableIdentifier('a@'), false);
check('254 characters accepted', isSubmittableIdentifier(`${'a'.repeat(242)}@example.com`), true);
check('255 characters refused', isSubmittableIdentifier(`${'a'.repeat(243)}@example.com`), false);
check('DEL (0x7F) refused', isSubmittableIdentifier('sam@example.com'), false);
checkTrue('tilde (0x7E) accepted', isSubmittableIdentifier('sam~test@example.com'));

console.log('\n=== normalizeIdentifier — NFKC then ASCII-ONLY case folding ===\n');
check('ASCII upper folds to lower', normalizeIdentifier('SAM@EXAMPLE.COM'), 'sam@example.com');
check('mixed case folds', normalizeIdentifier('Sam.Tester@Example.COM'), 'sam.tester@example.com');
check('digits and punctuation untouched', normalizeIdentifier('a_1-2+3@e.co'), 'a_1-2+3@e.co');
check('NFKC is identity over ASCII', normalizeIdentifier('sam@example.com'), 'sam@example.com');

/*
 * THE ONE THAT MATTERS MOST, and the reason the folding is ASCII-only.
 *
 * U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE. `toLowerCase()` in JavaScript
 * turns it into TWO code points (i + U+0307); Swift's `lowercased()` differs
 * again. ASCII-only folding leaves it ALONE, which is the only behaviour three
 * implementations can agree on. Such an address is refused before normalisation
 * anyway — this asserts the function itself, so a future relaxation of the ASCII
 * restriction cannot silently reintroduce the divergence.
 */
check('U+0130 is NOT lowercased', normalizeIdentifier('İ'), 'İ');
check(
  'U+0130 differs from toLowerCase()',
  normalizeIdentifier('İ') === 'İ'.toLowerCase(),
  false,
);

console.log('\n=== normalizePassword — NFC, and specifically NOT NFKC ===\n');

/*
 * THE GUARD FOR THIS WHOLE SECTION. The two literals are visually identical in
 * every editor, so if a well-meaning commit ever "fixes the encoding" and
 * collapses them into one spelling, every check below would pass vacuously
 * against itself. This fails first and says so.
 */
check(
  'the two spellings ARE different byte sequences (guard)',
  COMPOSED === DECOMPOSED,
  false,
);
check('composed is 8 code units', COMPOSED.length, 8);
check('decomposed is 10 code units', DECOMPOSED.length, 10);

check('NFC composes the decomposed form', normalizePassword(DECOMPOSED), COMPOSED);
check('NFC leaves the composed form alone', normalizePassword(COMPOSED), COMPOSED);

/*
 * WHY NFC AND NOT NFKC, asserted rather than described.
 *
 * NFKC is a COMPATIBILITY mapping: it folds distinct characters onto one. On an
 * identifier that is wanted — two spellings of one address should find one
 * account. On a password it DESTROYS ENTROPY THE USER BELIEVES THEY HAVE.
 * Someone who chose `²` would get the strength of `2`.
 */
check('NFKC would fold the ligature fi -> fi', 'ﬁ'.normalize('NFKC'), 'fi');
check('NFC does NOT fold the ligature', normalizePassword('ﬁ'), 'ﬁ');
check('NFKC would fold superscript two -> 2', '²'.normalize('NFKC'), '2');
check('NFC does NOT fold superscript two', normalizePassword('²'), '²');
check('NFC does NOT fold full-width A', normalizePassword('Ａ'), 'Ａ');

// A password is not an identifier: no case folding, no trimming, no ASCII limit.
check('a password is NOT case folded', normalizePassword('PassWord'), 'PassWord');
check('leading and trailing spaces are KEPT', normalizePassword('  pw  '), '  pw  ');
check('a tab inside a password is kept', normalizePassword('a\tb'), 'a\tb');
check('an empty password normalises to empty', normalizePassword(''), '');

console.log('\n=== Derivation — the 43-character assertion, on real runs ===\n');

const VECTORS = [
  { label: 'ascii', email: 'sam@example.com', password: 'correct horse battery staple' },
  { label: 'case folded', email: 'SAM@EXAMPLE.COM', password: 'correct horse battery staple' },
  { label: 'short password', email: 'a@b.co', password: 'x' },
  { label: 'empty password', email: 'sam@example.com', password: '' },
  { label: 'long password', email: 'sam@example.com', password: 'p'.repeat(200) },
  { label: 'unicode password', email: 'sam@example.com', password: 'pässwörd–日本語' },
  /*
   * THE PAIR THE NFC AMENDMENT EXISTS FOR. Both MUST print the SAME derived_key
   * below; that identity is what Apple has to reproduce.
   */
  { label: 'nfc composed', email: 'sam@example.com', password: COMPOSED },
  { label: 'nfc decomposed', email: 'sam@example.com', password: DECOMPOSED },
  /*
   * THE PAIR THAT CATCHES AN NFC/NFKC SWAP, and the reason it is published
   * rather than kept as an internal check.
   *
   * The composed/decomposed pair above CANNOT catch the swap: `ä` and `ö` have
   * no compatibility decomposition, so NFC and NFKC agree on them and an
   * implementation that used the wrong one would still reproduce those vectors
   * exactly. It is blind to the defect it looks like it is testing.
   *
   * A ligature is not. `ﬁ` (U+FB01) has a compatibility decomposition to `fi`
   * and no canonical one, so:
   *
   *   NFC  -> the two derived_keys below DIFFER   (correct)
   *   NFKC -> the two derived_keys below are EQUAL (the entropy-destroying bug)
   *
   * These two MUST print DIFFERENT derived_keys. If any client makes them
   * match, that client is folding characters together and a user who chose `ﬁ`
   * is getting the strength of `fi`.
   */
  { label: 'nfkc-swap guard: ligature', email: 'sam@example.com', password: 'ﬁnance' },
  { label: 'nfkc-swap guard: expansion', email: 'sam@example.com', password: 'finance' },
];

const derived = [];
for (const vector of VECTORS) {
  const started = performance.now();
  const result = await deriveLoginCredential(vector.email, vector.password);
  const elapsed = performance.now() - started;
  derived.push({
    label: vector.label,
    rawEmail: vector.email,
    // `deriveLoginCredential` returns the NORMALISED address, which is both the
    // salt and the value sent as the `email` field.
    normalisedEmail: result.email,
    password: vector.password,
    derivedKey: result.derived_key,
    elapsed,
  });

  check(
    `${vector.label}: derived_key is exactly 43 characters`,
    result.derived_key.length,
    CREDENTIAL_LENGTH,
  );
  checkTrue(
    `${vector.label}: derived_key is base64url with no padding`,
    /^[A-Za-z0-9_-]{43}$/.test(result.derived_key),
  );
  checkTrue(
    `${vector.label}: derived_key is not the password`,
    result.derived_key !== vector.password,
  );
  check(`${vector.label}: returned email is normalised`, result.email, normalizeIdentifier(vector.email));
}

console.log('\n=== Cross-checks ===\n');

// Case folding must reach the SALT, not just the wire value.
check(
  'SAM@EXAMPLE.COM and sam@example.com derive the SAME key',
  derived[0].derivedKey,
  derived[1].derivedKey,
);

// The salt is the email, so a different email must give a different key for the
// same password. If this ever fails, the salt is not being applied.
const other = await deriveLoginCredential('sam2@example.com', 'correct horse battery staple');
checkTrue('a different email derives a different key', other.derived_key !== derived[0].derivedKey);

/*
 * THE SALT IS THE NORMALISED EMAIL AND NOTHING ELSE.
 *
 * This recomputes the derivation independently, at the same iteration count,
 * passing the normalised string directly. If `deriveLoginCredential` prefixed,
 * labelled, hashed or padded the salt, these would differ — and Core, which
 * salts with the plain normalised bytes, would refuse every login.
 */
const independent = await deriveCredential(
  'correct horse battery staple',
  normalizeIdentifier('sam@example.com'),
  PBKDF2_ITERATIONS,
);
check('salt is the plain normalised email, unlabelled', independent, derived[0].derivedKey);

// Determinism: the same inputs must give the same output every time, which is
// what makes the cross-client vectors below meaningful at all.
const repeat = await deriveLoginCredential('sam@example.com', 'correct horse battery staple');
check('derivation is deterministic', repeat.derived_key, derived[0].derivedKey);

/*
 * THE NFC AMENDMENT, ASSERTED AT THE DERIVATION AND NOT ONLY AT THE FUNCTION.
 *
 * This is the check the whole amendment exists for. Two byte sequences that a
 * person cannot tell apart, and that a Mac keyboard and some input methods
 * genuinely produce for the same keystrokes, must derive the SAME key. Before
 * the amendment they did not, and the failure would have been invisible until a
 * real user with a non-ASCII password tried the other client.
 *
 * A DERIVATION-LEVEL CHECK RATHER THAN A FUNCTION-LEVEL ONE, because
 * `normalizePassword` being correct does not prove `deriveCredential` calls it.
 */
const composedKey = await deriveLoginCredential('sam@example.com', COMPOSED);
const decomposedKey = await deriveLoginCredential('sam@example.com', DECOMPOSED);
check(
  'composed and decomposed passwords derive the SAME key (NFC amendment)',
  decomposedKey.derived_key,
  composedKey.derived_key,
);

/*
 * And the other half: NFC must not fold characters together. If the password
 * were NFKC-normalised, these two would collide — which is exactly the entropy
 * loss the amendment refuses.
 */
const ligature = await deriveLoginCredential('sam@example.com', 'ﬁnance');
const spelledOut = await deriveLoginCredential('sam@example.com', 'finance');
check(
  'a ligature and its expansion derive DIFFERENT keys (NFC, not NFKC)',
  ligature.derived_key === spelledOut.derived_key,
  false,
);

// A lower iteration count MUST produce a different value. This is the check that
// would catch a client shipping a "faster" login that the server would happily
// accept and store, because the server sees only 43 characters either way.
const weakened = await deriveCredential(
  'correct horse battery staple',
  normalizeIdentifier('sam@example.com'),
  100_000,
);
checkTrue('100,000 iterations does NOT match 600,000', weakened !== derived[0].derivedKey);

/*
 * THE PUBLISHED VECTORS CARRY THE PROPERTIES, asserted on the printed values
 * themselves rather than on a separate derivation.
 *
 * The checks above prove the behaviour; these prove that the vectors HANDED TO
 * THE OTHER CLIENTS actually exhibit it. A vector set that looks like it tests
 * something and does not is worse than none — which is exactly what the
 * composed/decomposed pair turned out to be for the NFC/NFKC swap.
 */
const byLabel = (label) => derived.find((entry) => entry.label === label).derivedKey;

check(
  'published vectors: composed and decomposed MUST be equal',
  byLabel('nfc decomposed'),
  byLabel('nfc composed'),
);
check(
  'published vectors: ligature and expansion MUST differ',
  byLabel('nfkc-swap guard: ligature') === byLabel('nfkc-swap guard: expansion'),
  false,
);
check(
  'and the composed pair is BLIND to an NFC/NFKC swap, which is why both are published',
  COMPOSED.normalize('NFC') === COMPOSED.normalize('NFKC'),
  true,
);

console.log('\n=== SHARED TEST VECTORS — Apple must reproduce these exactly ===');
console.log(
  'PBKDF2-HMAC-SHA256 | 600,000 iterations | 32 bytes | salt = UTF-8 of normalizeIdentifier(email)',
);
console.log('password = UTF-8 of NFC(password). NFC, NOT NFKC — see src/api/kdf.ts.');
console.log('Swift: precomposedStringWithCanonicalMapping for the password;');
console.log('       precomposedStringWithCompatibilityMapping for the email. They differ.');
console.log('base64url, no padding, 43 characters. Every password here is synthetic and public.\n');
console.log('TWO PAIRS CARRY THE CROSS-CLIENT PROPERTIES. Check both, in this direction:');
console.log('  nfc composed / nfc decomposed        MUST be EQUAL   (NFC is applied at all)');
console.log('  nfkc-swap guard ligature / expansion MUST DIFFER     (NFC, and not NFKC)');
console.log('The first pair alone is NOT sufficient: a/o with diaeresis have no compatibility');
console.log('decomposition, so NFC and NFKC agree on them and a swapped client still passes.\n');
for (const entry of derived) {
  console.log(`  [${entry.label}]`);
  console.log(`  raw email    ${JSON.stringify(entry.rawEmail)}`);
  console.log(`  normalised   ${JSON.stringify(entry.normalisedEmail)}   <- salt, and the "email" field`);
  console.log(`  password     ${JSON.stringify(entry.password)}`);
  console.log(
    `  code points  [${[...entry.password].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}]`,
  );
  console.log(`  derived_key  ${entry.derivedKey}`);
  console.log(`  timing       ${entry.elapsed.toFixed(0)} ms on this machine\n`);
}

const timings = derived.map((entry) => entry.elapsed).sort((a, b) => a - b);
const median = timings[Math.floor(timings.length / 2)];
console.log(
  `Derivation on this machine: median ${median.toFixed(0)} ms, ` +
    `range ${timings[0].toFixed(0)}-${timings[timings.length - 1].toFixed(0)} ms.`,
);
console.log('A phone is typically 3-8x slower. This is why the login screen shows measured progress.\n');

if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
