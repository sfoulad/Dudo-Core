/**
 * ===========================================================================================
 * WHAT IS ACTUALLY STORED. `docs/decisions/0015` §D and migration `0006`.
 * ===========================================================================================
 *
 * The sentence under test, quoted from `0006` rather than paraphrased:
 *
 *   *"base64url of 32 bytes: PBKDF2-SHA256(kdf_output, salt, iterations). A HASH OF THE
 *   CLIENT'S OUTPUT, NEVER THE OUTPUT ITSELF."*
 *
 * `0006` also states the consequence of getting it wrong: storing `kdf_output` directly *"would
 * make a database dump DIRECTLY USABLE AS A LOGIN CREDENTIAL with no cracking at all."* That is
 * the failure this suite exists to detect, and it is a failure that is INVISIBLE FROM THE
 * OUTSIDE — a build that stored the client value would log every user in correctly, pass every
 * functional test, and be catastrophically broken.
 *
 * ===========================================================================================
 * WHY THE EXPECTED VALUE IS RECOMPUTED WITH `node:crypto` AND NOT WITH THE CODE UNDER TEST
 * ===========================================================================================
 *
 * `credential-verifier.ts` and `tools/seed-principal.ts` both derive through `crypto.subtle`. A
 * test that checked one against the other would agree with itself no matter what either did.
 * `node:crypto`'s `pbkdf2Sync` is a different implementation, in a different language, reached
 * through a different API — so agreement between it and the shipping code is evidence about the
 * ALGORITHM and not merely about internal consistency.
 *
 * This is also the suite that answers "is the enrolment path storing the right thing", which is
 * separate from "is the verifier checking the right thing". A correct verifier over a wrongly
 * enrolled row is still a system that stores a directly-usable credential.
 */

import { pbkdf2Sync } from 'node:crypto';
import { Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import {
  createControlPlaneDatabase,
  createStubIdentifierHasher,
  readCredentialRow,
  seedCredential,
  seedPrincipal,
} from '../../harness/control-plane-fixture.ts';
import { createD1CredentialStore } from '../../../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import {
  CLIENT_KDF_ITERATIONS,
  normalizeIdentifier,
  toBase64Url,
} from '../../../../platform/core/identity/credential-store.ts';
import {
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  VERIFIER_BYTES,
  createCredentialVerifier,
} from '../../../../platform/core/identity/credential-verifier.ts';
import {
  buildSeedRows,
  renderSeedSql,
} from '../../../../platform/core/identity/tools/seed-principal.ts';

/** Synthetic throughout. No real address, no real password, nothing reused from anywhere. */
const FIXTURE_EMAIL = 'Test.Operator@Example.Invalid';
const FIXTURE_PASSWORD = 'correct-horse-battery-staple-0001';
const FIXTURE_PRINCIPAL = 'prn_az2_fixture_0001';
/** 32 bytes of fixed, obviously-synthetic key material. Never a real secret. */
const FIXTURE_LOOKUP_KEY = new TextEncoder().encode('dudo-test-lookup-key-32-bytes!!!');
/** Pinned so the whole derivation is reproducible from the file. */
const FIXTURE_SALT = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

function base64UrlOf(buffer: Buffer): string {
  return toBase64Url(new Uint8Array(buffer));
}

/** The client half, recomputed independently: PBKDF2-SHA256(password, normalised email, 600k). */
function independentClientValue(password: string, normalizedEmail: string): Buffer {
  return pbkdf2Sync(
    Buffer.from(password, 'utf8'),
    Buffer.from(normalizedEmail, 'utf8'),
    CLIENT_KDF_ITERATIONS,
    VERIFIER_BYTES,
    'sha256',
  );
}

/** The server half, recomputed independently: PBKDF2-SHA256(kdf_output, per-user salt, 10k). */
function independentStoredVerifier(clientValue: Buffer, salt: Uint8Array): Buffer {
  return pbkdf2Sync(
    clientValue,
    Buffer.from(salt),
    SERVER_KDF_ITERATIONS,
    VERIFIER_BYTES,
    'sha256',
  );
}

export function buildStoredCredentialSuite(): Suite {
  const suite = new Suite('AZ2 — what is actually stored (0015 §D, migration 0006)');

  suite.test(
    'the seed tool stores PBKDF2-SHA256(kdf_output, salt, 10000), recomputed independently',
    async () => {
      const rows = await buildSeedRows({
        email: FIXTURE_EMAIL,
        password: FIXTURE_PASSWORD,
        lookupKey: FIXTURE_LOOKUP_KEY,
        nowMs: Date.UTC(2026, 8, 4),
        salt: FIXTURE_SALT,
        principalId: FIXTURE_PRINCIPAL,
      });

      const normalized = normalizeIdentifier(FIXTURE_EMAIL);
      const clientValue = independentClientValue(FIXTURE_PASSWORD, normalized);
      const expected = independentStoredVerifier(clientValue, FIXTURE_SALT);

      assertEqual('stored verifier equals the server-side hash', rows.verifier, base64UrlOf(expected));
    },
  );

  suite.test(
    'the stored verifier is NOT the client KDF output — a dump is not a credential',
    async () => {
      const rows = await buildSeedRows({
        email: FIXTURE_EMAIL,
        password: FIXTURE_PASSWORD,
        lookupKey: FIXTURE_LOOKUP_KEY,
        nowMs: Date.UTC(2026, 8, 4),
        salt: FIXTURE_SALT,
        principalId: FIXTURE_PRINCIPAL,
      });

      const normalized = normalizeIdentifier(FIXTURE_EMAIL);
      const clientValue = base64UrlOf(independentClientValue(FIXTURE_PASSWORD, normalized));

      assertTrue(
        'stored verifier differs from kdf_output',
        rows.verifier !== clientValue,
        'the stored verifier is byte-identical to the client KDF output — a database dump is ' +
          'directly usable as a login credential',
      );
    },
  );

  suite.test(
    'submitting the STORED VERIFIER as the derived value is refused (the dump attack)',
    async () => {
      // The exact attack `0006` names: an attacker holds a database dump and submits the stored
      // column value as if it were the client's derived key.
      const harness = createControlPlaneDatabase();
      try {
        const rows = await buildSeedRows({
          email: FIXTURE_EMAIL,
          password: FIXTURE_PASSWORD,
          lookupKey: FIXTURE_LOOKUP_KEY,
          nowMs: Date.UTC(2026, 8, 4),
          salt: FIXTURE_SALT,
          principalId: FIXTURE_PRINCIPAL,
        });
        seedPrincipal(harness, rows.principalId);
        const identifiers = createStubIdentifierHasher();
        const identifierHash = await identifiers.hash(normalizeIdentifier(FIXTURE_EMAIL));
        seedCredential(harness, {
          identifierHash,
          principalId: rows.principalId,
          algorithm: SUPPORTED_ALGORITHM,
          iterations: SERVER_KDF_ITERATIONS,
          salt: rows.salt,
          verifier: rows.verifier,
        });

        const verifier = await createCredentialVerifier({
          credentials: createD1CredentialStore(harness.database),
          identifiers,
        });

        const attack = await verifier.verify(FIXTURE_EMAIL, rows.verifier);
        const attackOutcome = expectOk('the dump attack call itself succeeds', attack) as {
          kind: string;
        };
        assertEqual('submitting the stored verifier is refused', attackOutcome.kind, 'refused');

        // The positive control beside it: the real client value DOES authenticate. Without this
        // the refusal above would prove nothing — every submission could be refused.
        const clientValue = base64UrlOf(
          independentClientValue(FIXTURE_PASSWORD, normalizeIdentifier(FIXTURE_EMAIL)),
        );
        const genuine = await verifier.verify(FIXTURE_EMAIL, clientValue);
        const genuineOutcome = expectOk('the genuine call succeeds', genuine) as {
          kind: string;
          principalId?: string;
        };
        assertEqual('the genuine client value verifies', genuineOutcome.kind, 'verified');
        assertEqual(
          'the verified principal is the enrolled one',
          genuineOutcome.principalId,
          FIXTURE_PRINCIPAL,
        );
      } finally {
        harness.close();
      }
    },
  );

  suite.test('the stored row is exactly the six columns the migration defines', async () => {
    const harness = createControlPlaneDatabase();
    try {
      const rows = await buildSeedRows({
        email: FIXTURE_EMAIL,
        password: FIXTURE_PASSWORD,
        lookupKey: FIXTURE_LOOKUP_KEY,
        nowMs: Date.UTC(2026, 8, 4),
        salt: FIXTURE_SALT,
        principalId: FIXTURE_PRINCIPAL,
      });
      seedPrincipal(harness, rows.principalId);
      seedCredential(harness, {
        identifierHash: rows.identifierHash,
        principalId: rows.principalId,
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: rows.salt,
        verifier: rows.verifier,
      });

      const stored = readCredentialRow(harness, rows.identifierHash);
      assertTrue('the row landed', stored !== undefined, 'no row was stored');
      const columns = Object.keys(stored ?? {}).sort().join(',');
      assertEqual(
        'the credential table carries no column beyond the seven defined',
        columns,
        'algorithm,created_at,identifier_hash,iterations,principal_id,salt,verifier',
      );
      assertEqual('salt is 22 base64url characters (16 bytes)', String(stored?.salt).length, 22);
      assertEqual(
        'verifier is 43 base64url characters (32 bytes)',
        String(stored?.verifier).length,
        43,
      );
      assertEqual(
        'identifier_hash is 43 base64url characters (32 bytes)',
        String(stored?.identifier_hash).length,
        43,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('the emitted SQL contains no email address and no password', async () => {
    const rows = await buildSeedRows({
      email: FIXTURE_EMAIL,
      password: FIXTURE_PASSWORD,
      lookupKey: FIXTURE_LOOKUP_KEY,
      nowMs: Date.UTC(2026, 8, 4),
      salt: FIXTURE_SALT,
      principalId: FIXTURE_PRINCIPAL,
    });
    const sql = renderSeedSql(rows);

    assertTrue(
      'the SQL does not contain the raw email address',
      !sql.includes(FIXTURE_EMAIL),
      'the emitted SQL contains the plaintext email address',
    );
    assertTrue(
      'the SQL does not contain the normalised email address',
      !sql.includes(normalizeIdentifier(FIXTURE_EMAIL)),
      'the emitted SQL contains the normalised email address',
    );
    assertTrue(
      'the SQL does not contain the local part of the address',
      !sql.toLowerCase().includes('test.operator'),
      'the emitted SQL contains the local part of the email address',
    );
    assertTrue(
      'the SQL does not contain the domain of the address',
      !sql.toLowerCase().includes('example.invalid'),
      'the emitted SQL contains the domain of the email address',
    );
    assertTrue(
      'the SQL does not contain the password',
      !sql.includes(FIXTURE_PASSWORD),
      'the emitted SQL contains the plaintext password',
    );
    assertTrue(
      'the SQL does not contain the client KDF output',
      !sql.includes(
        base64UrlOf(independentClientValue(FIXTURE_PASSWORD, normalizeIdentifier(FIXTURE_EMAIL))),
      ),
      'the emitted SQL contains the client KDF output, which is the login credential itself',
    );
    // The positive control: the SQL DOES contain what it is supposed to contain, so the four
    // absence assertions above are not passing because the tool emitted nothing.
    assertTrue(
      'the SQL contains the identifier hash',
      sql.includes(rows.identifierHash),
      'the emitted SQL does not contain the identifier hash — the absence checks prove nothing',
    );
    assertTrue(
      'the SQL contains the stored verifier',
      sql.includes(rows.verifier),
      'the emitted SQL does not contain the verifier — the absence checks prove nothing',
    );
  });

  suite.test('an enrolled credential round-trips through the real HMAC identifier hasher', async () => {
    // The suites above use the deterministic stub. This one uses the shipping hasher, so the
    // width and the lookup path are exercised as they run in production.
    const harness = createControlPlaneDatabase();
    try {
      const rows = await buildSeedRows({
        email: FIXTURE_EMAIL,
        password: FIXTURE_PASSWORD,
        lookupKey: FIXTURE_LOOKUP_KEY,
        nowMs: Date.UTC(2026, 8, 4),
        salt: FIXTURE_SALT,
        principalId: FIXTURE_PRINCIPAL,
      });
      seedPrincipal(harness, rows.principalId);
      seedCredential(harness, {
        identifierHash: rows.identifierHash,
        principalId: rows.principalId,
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: rows.salt,
        verifier: rows.verifier,
      });

      const { createHmacIdentifierHasher } = await import(
        '../../../../platform/core/identity/credential-store.ts'
      );
      const verifier = await createCredentialVerifier({
        credentials: createD1CredentialStore(harness.database),
        identifiers: await createHmacIdentifierHasher(FIXTURE_LOOKUP_KEY),
      });

      const clientValue = base64UrlOf(
        independentClientValue(FIXTURE_PASSWORD, normalizeIdentifier(FIXTURE_EMAIL)),
      );
      const outcome = expectOk(
        'verification through the real hasher succeeds',
        await verifier.verify(FIXTURE_EMAIL, clientValue),
      ) as { kind: string; principalId?: string };
      assertEqual('the enrolled account verifies', outcome.kind, 'verified');
      assertEqual('the principal is the enrolled one', outcome.principalId, FIXTURE_PRINCIPAL);
    } finally {
      harness.close();
    }
  });

  return suite;
}
