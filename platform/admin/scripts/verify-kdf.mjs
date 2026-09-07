/**
 * Verifies this console's key derivation, and — the part that matters most —
 * proves MECHANICALLY that it has not drifted from `platform/web`'s.
 *
 *   npm run verify:kdf
 *
 * ===========================================================================
 * WHY A SCRIPT AND NOT A TEST FILE
 * ===========================================================================
 *
 * No testing framework is approved for `Dudo-Core` — `.claude/rules/architecture.md`
 * §6 lists "Web framework, testing framework, npm packages" as Not selected, ADR
 * 0010's own testing plan says "Test framework remains TS1, undecided", and an
 * agent may not install one. This runs on Node's own WebCrypto with no
 * dependency at all, so the normative behaviour is checkable today rather than
 * after a framework decision. When `TS1` is settled, this becomes a test file
 * with the same assertions.
 *
 * IT IMPORTS THE REAL MODULE. `node --experimental-strip-types` runs
 * `src/api/kdf.ts` directly, so this checks the code the browser ships rather
 * than a copy of it — a copy would pass while the shipped file was wrong, which
 * is the failure mode that makes a verification script worse than none.
 *
 * ===========================================================================
 * THE DRIFT CHECK IS THE POINT OF THIS FILE
 * ===========================================================================
 *
 * `src/api/kdf.ts` is a deliberate copy of `platform/web/src/api/kdf.ts`,
 * because the two clients are separately owned (`.claude/rules/architecture.md`
 * §2) and a relative import across that boundary would be a source dependency
 * between two independently deployed applications.
 *
 * A COPY KEPT IN STEP BY A COMMENT IS A COPY THAT DRIFTS. So this script reads
 * the web client's files and compares them character for character. If either
 * side is edited without the other, THIS FAILS — at the build that made the
 * change, not six months later when an operator enrolled on one client cannot
 * sign in on the other.
 *
 * `kdf.ts` is compared FROM THE `Normative constants` BANNER ONWARDS, because
 * only the header differs and only the header is allowed to: it is the part that
 * says which copy you are reading. `kdf-client.ts` and `kdf-worker.ts` are
 * compared in full — they are identical files.
 *
 * THE CHECK IS SKIPPED, WITH A LOUD NOTICE, IF THE WEB CLIENT IS ABSENT. A
 * missing sibling is a checkout problem, not a defect in this console, and
 * failing the build for it would make this project unbuildable on its own. A
 * PRESENT-AND-DIFFERENT file is always a failure.
 *
 * EVERY PASSWORD BELOW IS SYNTHETIC AND PUBLIC. `.claude/rules/security.md` §6 —
 * never real credentials, never real customer data, anywhere, including in
 * fixtures.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_API = join(HERE, '..', 'src', 'api');
const WEB_API = join(HERE, '..', '..', 'web', 'src', 'api');

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

/* =========================================================================
   1. THE DRIFT CHECK
   ========================================================================= */

console.log('\n=== Cross-client drift — platform/admin vs platform/web ===\n');

/** Everything from this marker to EOF must be byte-identical across the copies. */
const NORMATIVE_MARKER =
  '/* -------------------------------------------------------------------------\n   Normative constants';

function normativeRegion(source, path) {
  const index = source.indexOf(NORMATIVE_MARKER);
  if (index === -1) {
    failures += 1;
    console.log(
      `FAIL  ${path} no longer contains the "Normative constants" banner.\n` +
        '        The drift check anchors on it. Restore the banner rather than removing the check.',
    );
    return null;
  }
  return source.slice(index);
}

function reportFirstDifference(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) {
      const from = Math.max(0, index - 60);
      console.log(`        first difference at character ${String(index)}`);
      console.log(`        web   …${JSON.stringify(a.slice(from, index + 60))}`);
      console.log(`        admin …${JSON.stringify(b.slice(from, index + 60))}`);
      return;
    }
  }
}

if (!existsSync(join(WEB_API, 'kdf.ts'))) {
  console.log(
    'SKIP  platform/web is not present in this checkout, so drift cannot be checked.\n' +
      '      THIS IS NOT A PASS. The derivation is a four-implementation contract\n' +
      '      (this console, platform/web, Dudo-Apple in Swift, and Core) and this run\n' +
      '      verified only one of them. Run it in a full checkout before a release.',
  );
} else {
  // `kdf.ts` — the normative region only. The header is allowed to differ.
  const webKdf = normativeRegion(
    readFileSync(join(WEB_API, 'kdf.ts'), 'utf8'),
    'platform/web kdf.ts',
  );
  const adminKdf = normativeRegion(
    readFileSync(join(ADMIN_API, 'kdf.ts'), 'utf8'),
    'platform/admin kdf.ts',
  );
  if (webKdf !== null && adminKdf !== null) {
    const identical = webKdf === adminKdf;
    if (!identical) failures += 1;
    console.log(
      `${identical ? 'PASS' : 'FAIL'}  kdf.ts normative region is byte-identical to platform/web ` +
        `(${String(Buffer.byteLength(adminKdf))} bytes)`,
    );
    if (!identical) {
      console.log(
        '        THE TWO CLIENTS WILL NOW DERIVE DIFFERENT KEYS, OR SOON WILL.\n' +
          '        Do not "fix" this by copying one over the other. The derivation is a\n' +
          '        contract change: it goes to the Team Lead, lands in all four\n' +
          '        implementations, and updates the shared test vectors.',
      );
      reportFirstDifference(webKdf, adminKdf);
    }
  }

  // `kdf-client.ts` and `kdf-worker.ts` — compared in full.
  for (const file of ['kdf-client.ts', 'kdf-worker.ts']) {
    const web = readFileSync(join(WEB_API, file), 'utf8');
    const admin = readFileSync(join(ADMIN_API, file), 'utf8');
    const identical = web === admin;
    if (!identical) failures += 1;
    console.log(`${identical ? 'PASS' : 'FAIL'}  ${file} is byte-identical to platform/web`);
    if (!identical) reportFirstDifference(web, admin);
  }
}

/* =========================================================================
   2. THE NORMATIVE CONSTANTS AND RULES
   ========================================================================= */

console.log('\n=== Normative constants (ADR 0015 §D, platform/core/identity/login.ts) ===\n');
check('iterations is 600000', PBKDF2_ITERATIONS, 600_000);
check('output is 32 bytes', KDF_OUTPUT_BYTES, 32);
check('credential length is 43', CREDENTIAL_LENGTH, 43);

console.log('\n=== isSubmittableIdentifier — reject, never trim ===\n');
checkTrue('plain ASCII address accepted', isSubmittableIdentifier('operator@example.com'));
check('leading space REFUSED (not trimmed)', isSubmittableIdentifier(' a@example.com'), false);
check('trailing space REFUSED (not trimmed)', isSubmittableIdentifier('a@example.com '), false);
check('tab refused', isSubmittableIdentifier('a@example.com\t'), false);
check(
  'non-ASCII local part refused (RFC 6531)',
  isSubmittableIdentifier(`s${String.fromCharCode(0x00e1)}m@example.com`),
  false,
);
checkTrue('punycode domain accepted', isSubmittableIdentifier('a@xn--exmple-cua.com'));
check('no @ refused', isSubmittableIdentifier('example.com'), false);
check('254 characters accepted', isSubmittableIdentifier(`${'a'.repeat(242)}@example.com`), true);
check('255 characters refused', isSubmittableIdentifier(`${'a'.repeat(243)}@example.com`), false);

console.log('\n=== normalizeIdentifier — NFKC then ASCII-ONLY case folding ===\n');
check('ASCII upper folds to lower', normalizeIdentifier('OP@EXAMPLE.COM'), 'op@example.com');

/*
 * U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE, THE ONE THAT MATTERS MOST.
 *
 * `toLowerCase()` in JavaScript turns it into TWO code points (i + U+0307);
 * Swift's `lowercased()` differs again. ASCII-only folding leaves it ALONE,
 * which is the only behaviour four implementations can agree on. Written as a
 * code point rather than a literal for the reason given in the next section.
 */
const DOTTED_CAPITAL_I = String.fromCharCode(0x0130);
check('U+0130 is NOT lowercased', normalizeIdentifier(DOTTED_CAPITAL_I), DOTTED_CAPITAL_I);
check(
  'U+0130 differs from toLowerCase()',
  normalizeIdentifier(DOTTED_CAPITAL_I) === DOTTED_CAPITAL_I.toLowerCase(),
  false,
);

console.log('\n=== normalizePassword — NFC, and specifically NOT NFKC ===\n');

/*
 * Composed and decomposed spellings of the SAME visible text — "passwoerd" with
 * a diaeresis on the a and the o — one using precomposed characters and one
 * using combining marks. They render identically, they are different bytes, and
 * PBKDF2 derives different keys from them unless NFC is applied.
 *
 * ===========================================================================
 * BUILT FROM CODE POINTS. THIS REGION IS PURE ASCII, AND THE GUARD BELOW IS WHY.
 * ===========================================================================
 *
 * THIS FILE'S FIRST DRAFT WROTE BOTH AS LITERAL CHARACTERS AND THE GUARD CAUGHT
 * IT ON THE FIRST RUN: the two literals reached disk as the SAME byte sequence,
 * because something between the author and the file normalised them. Every check
 * below then passed VACUOUSLY — including "composed and decomposed derive the
 * SAME key", which was comparing a string to itself and proving exactly nothing
 * about the NFC amendment it exists to defend.
 *
 * That is precisely the failure the guard was written for, and it fired on its
 * own test file within a minute. A SECOND ATTEMPT USING UNICODE ESCAPES WAS ALSO
 * REWRITTEN INTO LITERAL CHARACTERS BEFORE IT REACHED DISK — correctly that
 * time, but by luck rather than by design, and a test that is right by luck is a
 * test that will be silently wrong later.
 *
 * `String.fromCharCode` ends the argument. The two constants below are built at
 * runtime from NUMBERS, and a number has no canonical composition, so there is
 * nothing here for an editor, a clipboard, a formatter, a version-control filter
 * or an authoring tool to normalise. DO NOT "SIMPLIFY" THEM BACK INTO LITERALS.
 *
 * `platform/web/scripts/verify-kdf.mjs` uses literals for this pair. Its copies
 * are currently correct — its own guard passes — but they are one well-meaning
 * "encoding fix" away from the same vacuous pass this file just demonstrated.
 * That is `web-agent`'s file and is reported to the Team Lead rather than edited
 * here.
 */

/** U+00E4 and U+00F6, the precomposed letters. 8 code units. */
const COMPOSED = `p${String.fromCharCode(0x00e4)}ssw${String.fromCharCode(0x00f6)}rd`;

/** The same text as plain a and o each followed by U+0308. 10 code units. */
const DECOMPOSED = `pa${String.fromCharCode(0x0308)}sswo${String.fromCharCode(0x0308)}rd`;

// The guard for this whole section: if the two ever become one spelling, every
// check below would pass vacuously and prove nothing. Four checks rather than
// one, so a failure says WHICH way they collapsed.
check('the two spellings ARE different byte sequences (guard)', COMPOSED === DECOMPOSED, false);
check('composed is 8 code units', COMPOSED.length, 8);
check('decomposed is 10 code units', DECOMPOSED.length, 10);
check('they are the same text after NFC', DECOMPOSED.normalize('NFC'), COMPOSED);

check('NFC composes the decomposed form', normalizePassword(DECOMPOSED), COMPOSED);
check('NFC leaves the composed form alone', normalizePassword(COMPOSED), COMPOSED);

/*
 * WHY NFC AND NOT NFKC, ASSERTED RATHER THAN DESCRIBED.
 *
 * NFKC is a COMPATIBILITY mapping: it folds distinct characters onto one. On an
 * identifier that is wanted — two spellings of one address should find one
 * account. On a PASSWORD it destroys entropy the user believes they have.
 *
 * The ligature and the superscript are built from code points for the same
 * reason as the pair above: a literal is a thing a tool can normalise.
 */
const LIGATURE_FI = String.fromCharCode(0xfb01);
const SUPERSCRIPT_TWO = String.fromCharCode(0x00b2);

check('NFKC would fold the fi ligature into two letters', LIGATURE_FI.normalize('NFKC'), 'fi');
check('NFC does NOT fold the ligature', normalizePassword(LIGATURE_FI), LIGATURE_FI);
check('NFKC would fold superscript two into 2', SUPERSCRIPT_TWO.normalize('NFKC'), '2');
check('NFC does NOT fold superscript two', normalizePassword(SUPERSCRIPT_TWO), SUPERSCRIPT_TWO);

// A password is not an identifier: no case folding, no trimming, no ASCII limit.
check('a password is NOT case folded', normalizePassword('PassWord'), 'PassWord');
check('leading and trailing spaces are KEPT', normalizePassword('  pw  '), '  pw  ');
check('a tab inside a password is kept', normalizePassword('a\tb'), 'a\tb');

/* =========================================================================
   3. REAL DERIVATIONS
   ========================================================================= */

console.log('\n=== Derivation — the 43-character assertion, on real runs ===\n');

const VECTORS = [
  { label: 'ascii', email: 'sam@example.com', password: 'correct horse battery staple' },
  { label: 'case folded', email: 'SAM@EXAMPLE.COM', password: 'correct horse battery staple' },
  // The pair the NFC amendment exists for. These MUST derive the SAME key.
  { label: 'nfc composed', email: 'sam@example.com', password: COMPOSED },
  { label: 'nfc decomposed', email: 'sam@example.com', password: DECOMPOSED },
  /*
   * The pair that catches an NFC/NFKC swap. The composed/decomposed pair above
   * CANNOT catch it: a-with-diaeresis and o-with-diaeresis have no compatibility
   * decomposition, so NFC and NFKC agree on them and a swapped implementation
   * still reproduces those vectors exactly. A ligature is not blind in that way.
   * These MUST derive DIFFERENT keys.
   */
  { label: 'nfkc-swap guard: ligature', email: 'sam@example.com', password: `${LIGATURE_FI}nance` },
  { label: 'nfkc-swap guard: expansion', email: 'sam@example.com', password: 'finance' },
];

const derived = [];
for (const vector of VECTORS) {
  const started = performance.now();
  const result = await deriveLoginCredential(vector.email, vector.password);
  const elapsed = performance.now() - started;
  derived.push({ label: vector.label, derivedKey: result.derived_key, elapsed });

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
}

const byLabel = (label) => derived.find((entry) => entry.label === label).derivedKey;

console.log('\n=== Cross-checks ===\n');

check(
  'SAM@EXAMPLE.COM and sam@example.com derive the SAME key',
  byLabel('case folded'),
  byLabel('ascii'),
);
check(
  'composed and decomposed derive the SAME key (NFC amendment)',
  byLabel('nfc decomposed'),
  byLabel('nfc composed'),
);
check(
  'a ligature and its expansion derive DIFFERENT keys (NFC, not NFKC)',
  byLabel('nfkc-swap guard: ligature') === byLabel('nfkc-swap guard: expansion'),
  false,
);

// The salt is the email, so a different email must give a different key for the
// same password. If this fails, the salt is not being applied.
const other = await deriveLoginCredential('sam2@example.com', 'correct horse battery staple');
checkTrue('a different email derives a different key', other.derived_key !== byLabel('ascii'));

/*
 * THE SALT IS THE NORMALISED EMAIL AND NOTHING ELSE. If the derivation prefixed,
 * labelled, hashed or padded the salt, this would differ — and Core, which salts
 * with the plain normalised bytes, would refuse every sign-in.
 */
const independent = await deriveCredential(
  'correct horse battery staple',
  normalizeIdentifier('sam@example.com'),
  PBKDF2_ITERATIONS,
);
check('salt is the plain normalised email, unlabelled', independent, byLabel('ascii'));

// Determinism, which is what makes the cross-client vectors meaningful at all.
const repeat = await deriveLoginCredential('sam@example.com', 'correct horse battery staple');
check('derivation is deterministic', repeat.derived_key, byLabel('ascii'));

// A lower iteration count MUST produce a different value. This is the check that
// would catch a client shipping a "faster" sign-in that the server would happily
// accept and store, because the server sees only 43 characters either way.
const weakened = await deriveCredential(
  'correct horse battery staple',
  normalizeIdentifier('sam@example.com'),
  100_000,
);
checkTrue('100,000 iterations does NOT match 600,000', weakened !== byLabel('ascii'));

/*
 * THE VECTORS THEMSELVES ARE NOT REPRINTED HERE. `platform/web`'s
 * `scripts/verify-kdf.mjs` publishes the shared cross-client vector set that
 * `Dudo-Apple` must reproduce, and TWO PUBLISHED SETS IS TWO PLACES FOR THEM TO
 * DISAGREE — which is the exact failure this file's drift check exists to
 * prevent. The equalities above prove this console reproduces them; the web
 * client remains the one place they are published from.
 */

const timings = derived.map((entry) => entry.elapsed).sort((a, b) => a - b);
console.log(
  `\nDerivation on this machine: median ${timings[Math.floor(timings.length / 2)].toFixed(0)} ms, ` +
    `range ${timings[0].toFixed(0)}-${timings[timings.length - 1].toFixed(0)} ms.`,
);
console.log(
  'A phone is typically 3-8x slower. This is why the sign-in screen shows measured progress.\n',
);

if (failures > 0) {
  console.error(`${String(failures)} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
