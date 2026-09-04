/**
 * ===========================================================================================
 * THE EQUAL-WORK PROPERTY, MEASURED STRUCTURALLY RATHER THAN ONLY BY STOPWATCH.
 * `docs/decisions/0015` §C.3, `platform/core/identity/credential-verifier.ts`.
 * ===========================================================================================
 *
 * THE CLAIM UNDER TEST: verifying a NONEXISTENT account costs the same as verifying an existing
 * one with a wrong password, so response timing cannot reveal which addresses are registered.
 *
 * ===========================================================================================
 * WHY THIS SUITE INSTRUMENTS `crypto.subtle.deriveBits` INSTEAD OF TIMING THE CALL
 * ===========================================================================================
 *
 * A timing measurement is a statistical argument about a machine. It is worth having — the
 * companion program `packages/testing/run-az2-timing.ts` makes it with a full distribution — but
 * on its own it is weak evidence in both directions: a loaded laptop produces a false red, and a
 * genuinely unequal branch can hide inside variance if the difference is a few hundred
 * microseconds.
 *
 * The property `0015` actually needs is not "the two branches took similar wall-clock time on
 * this machine". It is "the two branches perform THE SAME WORK". That is a structural fact and
 * it can be observed exactly: intercept the one expensive primitive and record, for every call,
 * how many iterations it ran, over what salt length, for what output length. Two branches that
 * issue an identical sequence of identical derivations cannot differ in CPU cost for any reason
 * this code controls, on any machine, under any load.
 *
 * THE INTERCEPT IS INSTALLED ON THE TEST PROCESS'S GLOBAL AND REMOVED IN `finally`. It observes;
 * it does not substitute. The real WebCrypto still performs every derivation, so a case that
 * asserts a successful login still asserts a real PBKDF2 result. No production file is modified,
 * and nothing here changes what the Worker runs.
 *
 * ===========================================================================================
 * THE SIX INPUTS THAT MUST ALL COST THE SAME
 * ===========================================================================================
 *
 * `credential-verifier.ts` property 5 claims that an absent row, an unrecognised algorithm, a
 * malformed salt, a malformed verifier and an out-of-range iteration count are ALL treated as
 * misses, on the miss path, with the dummy parameters. Each is a separate case below, and each
 * is compared against the wrong-password-on-a-real-account branch, which is the branch an
 * attacker has for free.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED, restating the file's own honesty: the D1 point lookup is
 * I/O, and a read that hits a row is not identical work to one that misses. This suite measures
 * the CPU half. The 250 ms response floor in `pre-auth-admission.ts` covers the I/O half and is
 * a separate control with separate evidence.
 */

import { Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import {
  createControlPlaneDatabase,
  createStubIdentifierHasher,
  seedCredential,
  seedPrincipal,
} from '../../harness/control-plane-fixture.ts';
import { createD1CredentialStore } from '../../../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import { normalizeIdentifier } from '../../../../platform/core/identity/credential-store.ts';
import {
  MAX_SERVER_KDF_ITERATIONS,
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  createCredentialVerifier,
} from '../../../../platform/core/identity/credential-verifier.ts';
import type { CredentialStore } from '../../../../platform/core/identity/credential-store.ts';
import { err } from '../../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../../platform/core/kernel/errors.ts';
import { createSqliteDatabase } from '../../harness/sqlite-d1.ts';

const ENROLLED_EMAIL = 'enrolled@example.invalid';
const ABSENT_EMAIL = 'absent@example.invalid';
const PRINCIPAL = 'prn_equal_work_0001';
/** 43 base64url characters — a well-formed submission that is not the right one. */
const WRONG_VALUE = 'A'.repeat(43);
const SALT_22 = 'AAAAAAAAAAAAAAAAAAAAAA';
const VERIFIER_43 = 'B'.repeat(43);

/** One observed call to the expensive primitive. */
type Derivation = {
  readonly algorithm: string;
  readonly hash: string;
  readonly iterations: number;
  readonly saltBytes: number;
  readonly outputBits: number;
};

/**
 * Runs `body` with `crypto.subtle.deriveBits` observed. The original is always restored, even if
 * `body` throws, because a leaked intercept would silently corrupt every later suite.
 */
async function observeDerivations<T>(
  body: () => Promise<T>,
): Promise<{ readonly value: T; readonly derivations: readonly Derivation[] }> {
  const derivations: Derivation[] = [];
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  crypto.subtle.deriveBits = async function observed(
    algorithm: Parameters<SubtleCrypto['deriveBits']>[0],
    key: Parameters<SubtleCrypto['deriveBits']>[1],
    length: Parameters<SubtleCrypto['deriveBits']>[2],
  ): Promise<ArrayBuffer> {
    const parameters = algorithm as unknown as {
      name: string;
      hash?: string;
      iterations?: number;
      salt?: ArrayBufferView;
    };
    derivations.push({
      algorithm: parameters.name,
      hash: typeof parameters.hash === 'string' ? parameters.hash : String(parameters.hash),
      iterations: parameters.iterations ?? -1,
      saltBytes: parameters.salt?.byteLength ?? -1,
      outputBits: typeof length === 'number' ? length : -1,
    });
    return original(algorithm, key, length) as Promise<ArrayBuffer>;
  } as SubtleCrypto['deriveBits'];
  try {
    const value = await body();
    return { value, derivations };
  } finally {
    crypto.subtle.deriveBits = original as SubtleCrypto['deriveBits'];
  }
}

type Harness = {
  readonly verify: (identifier: string, value: string) => Promise<unknown>;
  close(): void;
};

/** Builds a verifier over a control-plane database seeded with one row of the given shape. */
async function withRow(row: {
  readonly algorithm?: string;
  readonly iterations?: number;
  readonly salt?: string;
  readonly verifier?: string;
}): Promise<Harness> {
  const harness = createControlPlaneDatabase();
  const identifiers = createStubIdentifierHasher();
  seedPrincipal(harness, PRINCIPAL);
  seedCredential(harness, {
    identifierHash: await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL)),
    principalId: PRINCIPAL,
    algorithm: row.algorithm ?? SUPPORTED_ALGORITHM,
    iterations: row.iterations ?? SERVER_KDF_ITERATIONS,
    salt: row.salt ?? SALT_22,
    verifier: row.verifier ?? VERIFIER_43,
  });
  const verifier = await createCredentialVerifier({
    credentials: createD1CredentialStore(harness.database),
    identifiers,
  });
  return {
    verify: (identifier, value) => verifier.verify(identifier, value),
    close: () => {
      harness.close();
    },
  };
}

/**
 * The shape a single verification must produce: exactly one PBKDF2-SHA-256 derivation, 10,000
 * iterations, 16-byte salt, 256 bits out. It is the miss shape AND the hit shape; that identity
 * is the whole property.
 */
const EXPECTED_DERIVATION: Derivation = {
  algorithm: 'PBKDF2',
  hash: 'SHA-256',
  iterations: SERVER_KDF_ITERATIONS,
  saltBytes: 16,
  outputBits: 256,
};

function describe(derivations: readonly Derivation[]): string {
  return JSON.stringify(derivations);
}

export function buildEqualWorkSuite(): Suite {
  const suite = new Suite('AZ2 — equal work on the hit and miss branches (0015 §C.3)');

  suite.test('the algorithm CHECK constraint rejects an unrecognised value at the database', async () => {
    // Recorded first because it changes how the "unrecognised algorithm" case below must be
    // read: migration 0006 declares CHECK (algorithm IN ('pbkdf2-sha256-v1')), so the row the
    // verifier's property 5 defends against cannot be inserted through this schema at all. The
    // defence is still correct — a future migration widening the CHECK is exactly the scenario
    // it exists for — but the row has to be forced past the constraint to test it.
    const harness = createControlPlaneDatabase();
    try {
      seedPrincipal(harness, PRINCIPAL);
      let rejected = false;
      try {
        seedCredential(harness, {
          identifierHash: 'x'.repeat(43),
          principalId: PRINCIPAL,
          algorithm: 'argon2id-v9',
          iterations: SERVER_KDF_ITERATIONS,
          salt: SALT_22,
          verifier: VERIFIER_43,
        });
      } catch {
        rejected = true;
      }
      assertTrue(
        'the CHECK constraint is real',
        rejected,
        'migration 0006 accepted an unrecognised algorithm value',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('a MISS performs exactly one derivation with the standard parameters', async () => {
    const harness = await withRow({});
    try {
      const observed = await observeDerivations(() => harness.verify(ABSENT_EMAIL, WRONG_VALUE));
      assertEqual(
        `a miss performs one derivation — observed ${describe(observed.derivations)}`,
        observed.derivations.length,
        1,
      );
      assertEqual(
        'the miss derivation uses the standard parameters',
        JSON.stringify(observed.derivations[0]),
        JSON.stringify(EXPECTED_DERIVATION),
      );
      assertEqual(
        'the miss is refused',
        (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
        'refused',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('a HIT with the wrong value performs the IDENTICAL derivation', async () => {
    const harness = await withRow({});
    try {
      const observed = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, WRONG_VALUE));
      assertEqual(
        `a hit performs one derivation — observed ${describe(observed.derivations)}`,
        observed.derivations.length,
        1,
      );
      assertEqual(
        'the hit derivation is byte-for-byte the same parameter set as the miss',
        JSON.stringify(observed.derivations[0]),
        JSON.stringify(EXPECTED_DERIVATION),
      );
    } finally {
      harness.close();
    }
  });

  suite.test('a MALFORMED SALT costs the same as a miss', async () => {
    // 21 characters, so `fromBase64Url(value, 16)` returns null and the record is discarded.
    const harness = await withRow({ salt: 'AAAAAAAAAAAAAAAAAAAAA' });
    try {
      const observed = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, WRONG_VALUE));
      assertEqual(
        `one derivation — observed ${describe(observed.derivations)}`,
        observed.derivations.length,
        1,
      );
      assertEqual(
        'the malformed-salt path uses the dummy parameters, not a cheaper path',
        JSON.stringify(observed.derivations[0]),
        JSON.stringify(EXPECTED_DERIVATION),
      );
      assertEqual(
        'and it is refused',
        (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
        'refused',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('a MALFORMED VERIFIER costs the same as a miss', async () => {
    const harness = await withRow({ verifier: 'not-base64url-!!!' });
    try {
      const observed = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, WRONG_VALUE));
      assertEqual(
        `one derivation — observed ${describe(observed.derivations)}`,
        observed.derivations.length,
        1,
      );
      assertEqual(
        'the malformed-verifier path uses the dummy parameters',
        JSON.stringify(observed.derivations[0]),
        JSON.stringify(EXPECTED_DERIVATION),
      );
    } finally {
      harness.close();
    }
  });

  suite.test('an OUT-OF-RANGE iteration count costs the same as a miss', async () => {
    const harness = await withRow({ iterations: MAX_SERVER_KDF_ITERATIONS + 1 });
    try {
      const observed = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, WRONG_VALUE));
      assertEqual(
        `one derivation — observed ${describe(observed.derivations)}`,
        observed.derivations.length,
        1,
      );
      assertEqual(
        'the out-of-range row derives at 10,000 and not at the stored count',
        JSON.stringify(observed.derivations[0]),
        JSON.stringify(EXPECTED_DERIVATION),
      );
    } finally {
      harness.close();
    }
  });

  suite.test('an UNRECOGNISED ALGORITHM costs the same as a miss', async () => {
    // The CHECK constraint blocks this row through the shipping schema (see the first case), so
    // the store is stubbed to return the row a future migration could write. That is the exact
    // scenario `0015` §D.4 designs the algorithm column for.
    const identifiers = createStubIdentifierHasher();
    const hash = await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL));
    const store: CredentialStore = {
      async findByIdentifierHash(identifierHash: string) {
        return identifierHash === hash
          ? {
              ok: true as const,
              value: {
                identifierHash: hash,
                principalId: PRINCIPAL,
                algorithm: 'argon2id-v9' as never,
                iterations: SERVER_KDF_ITERATIONS,
                salt: SALT_22,
                verifier: VERIFIER_43,
              },
            }
          : { ok: true as const, value: null };
      },
    };
    const verifier = await createCredentialVerifier({ credentials: store, identifiers });
    const observed = await observeDerivations(() => verifier.verify(ENROLLED_EMAIL, WRONG_VALUE));
    assertEqual(
      `one derivation — observed ${describe(observed.derivations)}`,
      observed.derivations.length,
      1,
    );
    assertEqual(
      'a future algorithm derives at the dummy parameters, disclosing nothing about the row',
      JSON.stringify(observed.derivations[0]),
      JSON.stringify(EXPECTED_DERIVATION),
    );
    assertEqual(
      'and is refused rather than erroring',
      (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
      'refused',
    );
  });

  suite.test('an EMPTY stored salt is now unrepresentable — the schema refuses the row', async () => {
    // ===========================================================================================
    // THIS CASE PREVIOUSLY RECORDED A LIMIT. THE LIMIT WAS CLOSED, AND THE CASE PINS THE CLOSURE.
    // ===========================================================================================
    //
    // What it used to record: `d1-credential-store.ts`'s `requiredText` maps BOTH null and the
    // empty string to null, and any null column makes the read `err(internal())` — so a row with
    // `salt = ''` answered differently, and far more cheaply, than an absent row. `NOT NULL` did
    // not exclude the empty string, so the schema permitted it.
    //
    // Migration `0006` now carries `CHECK (length(...) > 0)` on EVERY text column, so the row
    // cannot be written at all. The cheap divergent path is unreachable through the schema, and
    // this case asserts that rather than the behaviour it used to describe.
    const harness = createControlPlaneDatabase();
    try {
      seedPrincipal(harness, PRINCIPAL);
      for (const column of ['salt', 'verifier', 'identifier_hash', 'principal_id'] as const) {
        let rejected = false;
        try {
          seedCredential(harness, {
            identifierHash: column === 'identifier_hash' ? '' : `hash_${column}`.padEnd(43, 'x'),
            principalId: column === 'principal_id' ? '' : PRINCIPAL,
            algorithm: SUPPORTED_ALGORITHM,
            iterations: SERVER_KDF_ITERATIONS,
            salt: column === 'salt' ? '' : SALT_22,
            verifier: column === 'verifier' ? '' : VERIFIER_43,
          });
        } catch {
          rejected = true;
        }
        assertTrue(
          `an empty ${column} is refused by the migration's CHECK constraint`,
          rejected,
          `migration 0006 accepted an empty ${column}, which reopens a path cheaper than a miss`,
        );
      }
    } finally {
      harness.close();
    }
  });

  suite.test(
    'the D1 adapter now PRESERVES an empty column instead of erroring on it',
    async () => {
      // ===========================================================================================
      // ADOPTED FROM `core-agent`'s `verify-equal-work.ts`, and it closes my finding one layer
      // deeper than I tested it.
      // ===========================================================================================
      //
      // I asserted the schema now refuses the row, and that a STUBBED empty salt takes the miss
      // path. `core-agent` also changed the adapter: `text()` replaces `requiredText()`, so `''`
      // survives as `''` rather than collapsing to `null` and taking the corruption branch. That
      // matters because the schema is not the only writer a database ever has, and the verifier
      // should not depend on the schema to be safe.
      //
      // Asserted against a PERMISSIVE table with no CHECK constraints — the row a future
      // migration, a hand-edit, or a different adapter could produce.
      const harness = createSqliteDatabase();
      try {
        harness.raw.exec(
          'CREATE TABLE principal_credential (identifier_hash TEXT, principal_id TEXT, ' +
            'algorithm TEXT, iterations INTEGER, salt TEXT, verifier TEXT, created_at TEXT);',
        );
        harness.raw
          .prepare('INSERT INTO principal_credential VALUES (?,?,?,?,?,?,?)')
          .run('h', 'p', SUPPORTED_ALGORITHM, SERVER_KDF_ITERATIONS, '', VERIFIER_43, 't');

        const outcome = await createD1CredentialStore(harness.database).findByIdentifierHash('h');
        assertEqual(
          'the read succeeds rather than returning internal()',
          outcome.ok,
          true,
        );
        assertEqual(
          "and the empty string survives to the verifier as '' rather than becoming null",
          outcome.ok ? (outcome.value as { salt: string } | null)?.salt : 'READ FAILED',
          '',
        );
      } finally {
        harness.close();
      }
    },
  );

  suite.test('a stubbed empty salt still takes the MISS path, not a cheaper one', async () => {
    // The schema now blocks the row, but the verifier must not depend on the schema for this —
    // a future writer, a different adapter or a widened CHECK would reopen it. Asserted at the
    // verifier with the store stubbed, which is the layer that has to hold on its own.
    const identifiers = createStubIdentifierHasher();
    const hash = await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL));
    const store: CredentialStore = {
      async findByIdentifierHash(identifierHash: string) {
        return identifierHash === hash
          ? {
              ok: true as const,
              value: {
                identifierHash: hash,
                principalId: PRINCIPAL,
                algorithm: SUPPORTED_ALGORITHM,
                iterations: SERVER_KDF_ITERATIONS,
                salt: '',
                verifier: VERIFIER_43,
              },
            }
          : { ok: true as const, value: null };
      },
    };
    const verifier = await createCredentialVerifier({ credentials: store, identifiers });
    const observed = await observeDerivations(() => verifier.verify(ENROLLED_EMAIL, WRONG_VALUE));
    assertEqual(
      `one derivation at the dummy parameters — observed ${describe(observed.derivations)}`,
      observed.derivations.length,
      1,
    );
    assertEqual(
      'and it is the standard parameter set, so the row costs exactly what an absent row costs',
      JSON.stringify(observed.derivations[0]),
      JSON.stringify(EXPECTED_DERIVATION),
    );
    assertEqual(
      'and it is refused',
      (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
      'refused',
    );
  });

  suite.test(
    'THE FULL TRACE TABLE — thirteen unusable rows, one distinct trace',
    async () => {
      // ===========================================================================================
      // ADOPTED FROM `core-agent`'s `verify-equal-work.ts`, which took the interception technique
      // from this suite and then found six inputs I had not covered.
      // ===========================================================================================
      //
      // Its version patches `crypto.subtle.deriveBits` AT MODULE TOP LEVEL AND NEVER RESTORES IT,
      // so merely importing it would leave the global patched for every suite that ran afterwards
      // — and because the wrapper delegates to the real function, everything would still pass. A
      // global side effect that never announces itself is the worst shape this could take, so the
      // CASES are adopted here and the implementation is not: `observeDerivations` restores in
      // `finally`.
      //
      // The six this adds over what I had: an empty verifier, iterations of 0, NaN, 19,999
      // (inside the range the old predicate accepted), and 50,000 (above the old maximum).
      // `Number(null)` is 0 and `Number('x')` is NaN, so both of those are reachable from a real
      // column, not just from a stub.
      const identifiers = createStubIdentifierHasher();
      const hash = await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL));
      const base = {
        identifierHash: hash,
        principalId: PRINCIPAL,
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: SALT_22,
        verifier: VERIFIER_43,
      };

      const cases: readonly (readonly [string, Record<string, unknown> | null])[] = [
        ['absent account (the miss)', null],
        ['wrong password on a real row', { ...base }],
        ['empty salt', { ...base, salt: '' }],
        ['empty verifier', { ...base, verifier: '' }],
        ['empty principal id', { ...base, principalId: '' }],
        ['malformed salt', { ...base, salt: 'not-base64url!!' }],
        ['malformed verifier', { ...base, verifier: 'short' }],
        ['unrecognised algorithm', { ...base, algorithm: 'passkey-es256-v1' }],
        ['iterations = 1000', { ...base, iterations: 1_000 }],
        ['iterations = 19999 (inside the OLD accepted range)', { ...base, iterations: 19_999 }],
        ['iterations = 0 (what Number(null) yields)', { ...base, iterations: 0 }],
        ['iterations = NaN (what Number("x") yields)', { ...base, iterations: Number.NaN }],
        ['iterations = 50000 (above the old maximum)', { ...base, iterations: 50_000 }],
      ];

      const collected: string[] = [];
      for (const [name, record] of cases) {
        const store: CredentialStore = {
          async findByIdentifierHash() {
            return { ok: true as const, value: record as never };
          },
        };
        const verifier = await createCredentialVerifier({ credentials: store, identifiers });
        const observed = await observeDerivations(() =>
          verifier.verify(ENROLLED_EMAIL, WRONG_VALUE),
        );
        assertEqual(
          `${name}: exactly one derivation`,
          observed.derivations.length,
          1,
        );
        assertEqual(
          `${name}: answers refused, not unavailable or internal`,
          (observed.value as { ok: boolean; value?: { kind: string } }).ok
            ? (observed.value as { value: { kind: string } }).value.kind
            : 'ERROR',
          'refused',
        );
        collected.push(describe(observed.derivations));
      }

      const distinct = new Set(collected);
      assertEqual(
        `all ${String(cases.length)} cases must derive identically — got ${String(distinct.size)} ` +
          `distinct: ${[...distinct].join(' AND ')}`,
        distinct.size,
        1,
      );
      assertEqual(
        'and that one trace is the standard parameter set',
        [...distinct][0],
        JSON.stringify([EXPECTED_DERIVATION]),
      );
    },
  );

  suite.test('a NON-STANDARD iteration count now takes the miss path — the signal is closed', async () => {
    // ===========================================================================================
    // A SECOND RECORDED LIMIT, ALSO CLOSED, AND THE CLOSURE IS STRONGER THAN THE ONE ASKED FOR.
    // ===========================================================================================
    //
    // What it used to record: `parametersFor` accepted any integer in
    // [1, MAX_SERVER_KDF_ITERATIONS] and derived at THAT count, so a row stored at 1,000
    // iterations cost a tenth of a miss — a per-account signal on an unauthenticated path.
    //
    // The predicate is now `record.iterations === SERVER_KDF_ITERATIONS`, exact equality. Any
    // other count, in range or out, falls onto the dummy path at 10,000. That closes the signal
    // COMPLETELY rather than narrowing it, and it costs the migration seam its transparency: a
    // future re-parameterisation now requires re-enrolment or a decision, which the file says in
    // as many words. The trade is recorded here because a reader of this case should know the
    // seam narrowed rather than assume it still works.
    for (const stored of [1, 1_000, 9_999, 10_001, MAX_SERVER_KDF_ITERATIONS]) {
      const harness = await withRow({ iterations: stored });
      try {
        const observed = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, WRONG_VALUE));
        assertEqual(
          `stored=${String(stored)}: one derivation — observed ${describe(observed.derivations)}`,
          observed.derivations.length,
          1,
        );
        assertEqual(
          `stored=${String(stored)}: derives at 10,000, not at the stored count`,
          JSON.stringify(observed.derivations[0]),
          JSON.stringify(EXPECTED_DERIVATION),
        );
        assertEqual(
          `stored=${String(stored)}: and is refused`,
          (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
          'refused',
        );
      } finally {
        harness.close();
      }
    }
  });

  suite.test('an EMPTY principal identifier is a miss, not a usable credential', async () => {
    // `parametersFor` gained `principalIsUsable` alongside the iteration change. It is the one
    // malformed field that could otherwise reach `issueSession`, so a miss here is not merely a
    // timing property — it is what stops a corrupt row minting a session for an empty principal.
    const identifiers = createStubIdentifierHasher();
    const hash = await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL));
    const store: CredentialStore = {
      async findByIdentifierHash(identifierHash: string) {
        return identifierHash === hash
          ? {
              ok: true as const,
              value: {
                identifierHash: hash,
                principalId: '',
                algorithm: SUPPORTED_ALGORITHM,
                iterations: SERVER_KDF_ITERATIONS,
                salt: SALT_22,
                verifier: VERIFIER_43,
              },
            }
          : { ok: true as const, value: null };
      },
    };
    const verifier = await createCredentialVerifier({ credentials: store, identifiers });
    const observed = await observeDerivations(() => verifier.verify(ENROLLED_EMAIL, WRONG_VALUE));
    assertEqual(
      'it costs exactly one standard derivation',
      JSON.stringify(observed.derivations),
      JSON.stringify([EXPECTED_DERIVATION]),
    );
    assertEqual(
      'and it is refused rather than verified',
      (observed.value as { ok: boolean; value: { kind: string } }).value.kind,
      'refused',
    );
  });

  suite.test('all SEVEN inputs produce an IDENTICAL derivation trace', async () => {
    // The property stated as one assertion: an attacker choosing between these inputs learns
    // nothing, because the CPU work is the same sequence in every case.
    const traces: Record<string, string> = {};
    const standard = await withRow({});
    try {
      traces['miss'] = describe(
        (await observeDerivations(() => standard.verify(ABSENT_EMAIL, WRONG_VALUE))).derivations,
      );
      traces['hit-wrong-value'] = describe(
        (await observeDerivations(() => standard.verify(ENROLLED_EMAIL, WRONG_VALUE))).derivations,
      );
    } finally {
      standard.close();
    }
    const malformedSalt = await withRow({ salt: 'AAAAAAAAAAAAAAAAAAAAA' });
    try {
      traces['malformed-salt'] = describe(
        (await observeDerivations(() => malformedSalt.verify(ENROLLED_EMAIL, WRONG_VALUE)))
          .derivations,
      );
    } finally {
      malformedSalt.close();
    }
    const malformedVerifier = await withRow({ verifier: 'not-base64url-!!!' });
    try {
      traces['malformed-verifier'] = describe(
        (await observeDerivations(() => malformedVerifier.verify(ENROLLED_EMAIL, WRONG_VALUE)))
          .derivations,
      );
    } finally {
      malformedVerifier.close();
    }
    const badIterations = await withRow({ iterations: MAX_SERVER_KDF_ITERATIONS + 1 });
    try {
      traces['out-of-range-iterations'] = describe(
        (await observeDerivations(() => badIterations.verify(ENROLLED_EMAIL, WRONG_VALUE)))
          .derivations,
      );
    } finally {
      badIterations.close();
    }
    // Added when `iterationsAreSupported` became exact equality. An in-range but non-standard
    // count used to derive at the stored value and produce a seventh, distinct trace.
    const nonStandardIterations = await withRow({ iterations: 1_000 });
    try {
      traces['in-range-non-standard-iterations'] = describe(
        (await observeDerivations(() => nonStandardIterations.verify(ENROLLED_EMAIL, WRONG_VALUE)))
          .derivations,
      );
    } finally {
      nonStandardIterations.close();
    }

    const distinct = new Set(Object.values(traces));
    assertEqual(
      `every branch must derive identically — traces were ${JSON.stringify(traces)}`,
      distinct.size,
      1,
    );
  });

  // -----------------------------------------------------------------------------------------
  // Early returns. The header claims exactly two, both decided by caller-supplied bytes alone.
  // -----------------------------------------------------------------------------------------

  suite.test('the two shape checks return before any derivation, as documented', async () => {
    const harness = await withRow({});
    try {
      const badIdentifier = await observeDerivations(() =>
        harness.verify('no-at-sign-here', WRONG_VALUE),
      );
      assertEqual(
        'a malformed identifier derives nothing',
        badIdentifier.derivations.length,
        0,
      );
      const badValue = await observeDerivations(() => harness.verify(ENROLLED_EMAIL, 'short'));
      assertEqual('a wrong-width submitted value derives nothing', badValue.derivations.length, 0);
      // These are the ONLY inputs allowed to skip the work, and they are decided from the
      // caller's own bytes, so the branch is a fact the caller already holds. The property that
      // matters is that they are identical for an enrolled and an absent identifier.
      const absentBadValue = await observeDerivations(() => harness.verify(ABSENT_EMAIL, 'short'));
      assertEqual(
        'a wrong-width value skips the work for an ABSENT identifier too — same branch',
        absentBadValue.derivations.length,
        0,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('a store failure returns unavailable and derives nothing — a documented early return', async () => {
    // `credential-verifier.ts` returns `err(unavailable())` between the lookup and the
    // derivation when the store cannot answer. It is deliberate and it is argued for in the
    // file: rendering a store failure as `refused` would itself be an oracle. It IS, however, a
    // path where no derivation happens, so it is recorded here rather than left implicit.
    const store: CredentialStore = {
      async findByIdentifierHash() {
        return err(unavailable());
      },
    };
    const verifier = await createCredentialVerifier({
      credentials: store,
      identifiers: createStubIdentifierHasher(),
    });
    const observed = await observeDerivations(() => verifier.verify(ENROLLED_EMAIL, WRONG_VALUE));
    assertEqual('no derivation is performed', observed.derivations.length, 0);
    assertEqual(
      'and the result is an error, not a refusal',
      (observed.value as { ok: boolean }).ok,
      false,
    );
  });

  suite.test('the dummy credential is built once at composition, not per request', async () => {
    // A lazily-built dummy would make the FIRST miss in an isolate cost twice a hit. The factory
    // is async precisely so it cannot be lazy; this observes that it is not.
    const harness = createControlPlaneDatabase();
    try {
      const identifiers = createStubIdentifierHasher();
      seedPrincipal(harness, PRINCIPAL);
      seedCredential(harness, {
        identifierHash: await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL)),
        principalId: PRINCIPAL,
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: SALT_22,
        verifier: VERIFIER_43,
      });

      const construction = await observeDerivations(async () =>
        createCredentialVerifier({
          credentials: createD1CredentialStore(harness.database),
          identifiers,
        }),
      );
      assertEqual(
        'constructing the verifier performs the dummy derivation up front',
        construction.derivations.length,
        1,
      );

      const verifier = construction.value;
      const firstMiss = await observeDerivations(() => verifier.verify(ABSENT_EMAIL, WRONG_VALUE));
      assertEqual(
        'the FIRST miss in the isolate performs one derivation, not two',
        firstMiss.derivations.length,
        1,
      );
      const secondMiss = await observeDerivations(() => verifier.verify(ABSENT_EMAIL, WRONG_VALUE));
      assertEqual(
        'and the second miss performs the same one',
        secondMiss.derivations.length,
        1,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('the refused result carries no field an existence fact could be written into', async () => {
    const harness = await withRow({});
    try {
      const miss = expectOk('the miss call succeeds', await harness.verify(ABSENT_EMAIL, WRONG_VALUE));
      const hit = expectOk(
        'the wrong-password call succeeds',
        await harness.verify(ENROLLED_EMAIL, WRONG_VALUE),
      );
      assertEqual(
        'a miss and a wrong password are the SAME value, not merely the same kind',
        JSON.stringify(miss),
        JSON.stringify(hit),
      );
      assertEqual('and that value is exactly {"kind":"refused"}', JSON.stringify(miss), '{"kind":"refused"}');
    } finally {
      harness.close();
    }
  });

  return suite;
}
