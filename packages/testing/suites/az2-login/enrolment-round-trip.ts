/**
 * ===========================================================================================
 * ENROL WITH ONE IMPLEMENTATION, SIGN IN WITH ANOTHER.
 * `docs/decisions/0015` §D · migration `0006` · contract `login-v1`.
 * ===========================================================================================
 *
 * *** WHAT THIS SUITE IS FOR, STATED AS A CORRECTION. ***
 *
 * I reported to the Team Lead that "nothing anywhere exercises the full round trip: enrol with
 * tool X, sign in with client Y." **THAT WAS WRONG, and reading `stored-credential.ts` before
 * writing this file is what found it.** That suite already enrols through the real
 * `buildSeedRows`, stores through the real `createD1CredentialStore`, and verifies through the
 * real `createCredentialVerifier` behind the real HMAC identifier hasher. The round trip exists
 * and passes.
 *
 * WHAT IT DOES NOT DO — and this is the narrower, real gap — is derive the submitted value with a
 * SHIPPED CLIENT. It uses an independent `node:crypto` reference, deliberately and correctly, to
 * check the algorithm. So the chain that supports "a person can sign in" is currently:
 *
 *     shipped web client  ===  node:crypto reference   (kdf-vectors.ts, on the vector table)
 *     node:crypto reference  verifies against storage  (stored-credential.ts)
 *
 * TWO SUITES AND A TRANSITIVE STEP. That is a real argument and it is not the same as one test in
 * which a shipped client's own output is checked against a stored credential — and transitivity
 * across suites is exactly the kind of reasoning that survives right up until the login screen.
 *
 * ===========================================================================================
 * THE ADMIN CONSOLE — AND WHAT THIS SECTION USED TO SAY, WHICH IS THE POINT
 * ===========================================================================================
 *
 * ~~*"there are now FOUR implementations in this repository, because
 * `platform/admin/src/api/kdf.ts` exists and is a deliberate copy of the web client's"*~~
 *
 * ~~*"**IT IS NOT UNGUARDED** — `platform/admin/scripts/verify-kdf.mjs` compares the two files'
 * normative regions character for character"*~~
 *
 * *** ALL THREE FILES THOSE SENTENCES NAMED WERE DELETED BY `0040`, AND THE PROSE SURVIVED THEM. ***
 * `platform/web/src/api/kdf.ts`, `platform/admin/src/api/kdf.ts` and
 * `platform/admin/scripts/verify-kdf.mjs` are all gone; there is **one** module,
 * `@dudo/client-kdf`, and **three** implementations rather than four — the fourth was the copy the
 * merge removed.
 *
 * **THE SECOND SENTENCE IS THE DANGEROUS ONE AND IT IS WHY THIS IS STRUCK RATHER THAN EDITED
 * AWAY.** *"It is not unguarded"* exists to **stop the next reader looking for the guard** — and
 * the guard was deleted. Somebody auditing coverage on the login path would read it, conclude the
 * byte-comparison had this covered, and move on. **`architecture.md` §3c's unfalsifiable variant:
 * a comment citing a control is a claim about that control, and this one could not be checked by
 * opening the file, because there was no file.**
 *
 * **WHAT GUARDS IT NOW, and the shape of the guarantee changed rather than weakened.** The two
 * consoles cannot derive differently because **there is nothing left to diverge** — a mechanism
 * rather than a discipline (`architecture.md` §3a). What keeps that true is asserted in this file:
 * *"AND NO HOST HAS RE-FORKED THE KDF"* walks both console trees and goes red the day a host-local
 * `kdf` module reappears, **which is the only way the drift can return.**
 *
 * *** THE ADMIN CONSOLE IS STILL THE CLIENT THE FIRST LIVE SIGN-IN WILL USE. *** The
 * platform-operator surface is served on `admin.dudo.work` and signing in there is the first thing
 * anyone does after a deploy. **That is why the round-trip cases below are named by SURFACE and no
 * longer by function**: one module serves both, so a second alias would say there are two.
 *
 * ===========================================================================================
 * WHY THE NEGATIVE CONTROLS PERTURB THE STORAGE SIDE
 * ===========================================================================================
 *
 * A wrong password being refused is already covered and is not this property. The failure the
 * Team Lead is bracing for is *"the KDF agreed and the stored verifier still did not match"* — a
 * wrong iteration count, a salt normalised on one side only, a value stored under a different
 * algorithm. Each of those is perturbed independently below, on the STORED ROW, with the
 * unperturbed row verifying beside it.
 *
 * ===========================================================================================
 * THE PARAMETERS ARE ASSERTED, NOT ONLY THE OUTCOME
 * ===========================================================================================
 *
 * `verification failed` localises nothing and sends the reader to the wrong file. Every case
 * asserts the algorithm identifier, the iteration count and the salt AS STORED against what the
 * enrolling side computed, BEFORE it asserts the outcome — so a red result names which of the
 * three diverged.
 *
 * NO CREDENTIAL MATERIAL APPEARS ANYWHERE. The passwords are invented for this file, every
 * assertion compares derived values and parameters, and no failure message can print a password
 * because no assertion is given one.
 */

import { pbkdf2Sync } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import {
  createControlPlaneDatabase,
  readCredentialRow,
  seedCredential,
  seedPrincipal,
} from '../../harness/control-plane-fixture.ts';
import { createD1CredentialStore } from '../../../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import {
  createHmacIdentifierHasher,
  normalizeIdentifier,
  toBase64Url,
} from '../../../../platform/core/identity/credential-store.ts';
import type {
  CredentialRecord,
  CredentialStore,
} from '../../../../platform/core/identity/credential-store.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import {
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  VERIFIER_BYTES,
  createCredentialVerifier,
} from '../../../../platform/core/identity/credential-verifier.ts';
import { buildSeedRows } from '../../../../platform/core/identity/tools/seed-principal.ts';
// ONE MODULE SINCE `0040`, AND NOW ONE NAME FOR IT.
//
// This file imported both host copies and compared them. When they merged I struck the assertions
// that they agree — those had become `a === a` — **and left two aliases naming one function**,
// arguing that a call site standing in for a console was still worth distinguishing.
//
// *** THAT WAS WRONG, AND THE TEAM LEAD WAS RIGHT TO PUSH BACK. *** Eleven call sites split
// between `webDerive` and `adminDerive`, and **six of them were in cases with no host dimension at
// all** — identifier normalisation and the stored-row negative controls, which had inherited an
// alias from history rather than from meaning. **A case invoking `adminDerive` read as exercising
// the admin surface while exercising the same function as the case above it.** Not a false
// assertion — a false impression, which is why nothing went red, and it is the coverage
// overstatement this suite exists to prevent elsewhere.
//
// **The host distinction survives where it is checkable: in the case TITLES, and structurally in
// the fork guard.** An identifier claiming a second implementation does not.
import { deriveLoginCredential as clientDerive } from '@dudo/client-kdf';

/** Synthetic throughout. Invented address, invented password, reused from nowhere. */
const EMAIL = 'Platform.Operator@Example.Invalid';
/** Deliberately a different casing of the same address, for the normalisation round trip. */
const EMAIL_OTHER_CASING = 'platform.operator@EXAMPLE.INVALID';
const PASSWORD = 'round-trip-fixture-password-0001';
const PRINCIPAL = 'prn_roundtrip_00001';
/** 32 bytes of obviously-synthetic key material. Never a real secret, never printed. */
const LOOKUP_KEY = new TextEncoder().encode('dudo-test-lookup-key-32-bytes!!!');
/** Pinned so the whole derivation is reproducible from this file alone. */
const SALT = new Uint8Array([17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
const ENROLLED_AT = Date.UTC(2026, 8, 5);

/**
 * The client half, recomputed in a different implementation, in a different language runtime.
 *
 * `TextEncoder` RATHER THAN `Buffer.from(…, 'utf8')`, which is what the neighbouring suites use.
 * The two are equivalent here — both produce UTF-8 bytes — but `Buffer` is a Node global that the
 * root `tsconfig` cannot see (`"types": []`, no `@types/node`), so every use of it in
 * `packages/testing/**` is a `TS2580` waiting for that gap to be closed. `TextEncoder` is in the
 * `WebWorker` lib the root already declares, so this file adds none.
 */
function referenceClientValue(password: string, normalizedEmail: string): string {
  const encoder = new TextEncoder();
  return toBase64Url(
    new Uint8Array(
      pbkdf2Sync(
        encoder.encode(password),
        encoder.encode(normalizedEmail),
        600_000,
        VERIFIER_BYTES,
        'sha256',
      ),
    ),
  );
}

type Enrolment = {
  readonly harness: ReturnType<typeof createControlPlaneDatabase>;
  readonly rows: Awaited<ReturnType<typeof buildSeedRows>>;
  verify(identifier: string, derivedValue: string): Promise<{ kind: string; principalId?: string }>;
  close(): void;
};

/**
 * Enrols one synthetic principal through the REAL tool and stores it in a REAL control plane.
 *
 * `overrides` perturbs the STORED ROW ONLY — never the derivation. That is what makes the
 * negative controls below controls rather than a second way of getting the password wrong.
 */
async function enrol(
  overrides: {
    readonly algorithm?: string;
    readonly iterations?: number;
    readonly salt?: string;
    readonly identifierHash?: string;
  } = {},
): Promise<Enrolment> {
  const harness = createControlPlaneDatabase();
  const rows = await buildSeedRows({
    email: EMAIL,
    password: PASSWORD,
    lookupKey: LOOKUP_KEY,
    nowMs: ENROLLED_AT,
    salt: SALT,
    principalId: PRINCIPAL,
  });
  seedPrincipal(harness, rows.principalId);
  seedCredential(harness, {
    identifierHash: overrides.identifierHash ?? rows.identifierHash,
    principalId: rows.principalId,
    algorithm: overrides.algorithm ?? SUPPORTED_ALGORITHM,
    iterations: overrides.iterations ?? SERVER_KDF_ITERATIONS,
    salt: overrides.salt ?? rows.salt,
    verifier: rows.verifier,
  });

  const verifier = await createCredentialVerifier({
    credentials: createD1CredentialStore(harness.database),
    identifiers: await createHmacIdentifierHasher(LOOKUP_KEY),
  });

  return {
    harness,
    rows,
    async verify(identifier, derivedValue) {
      return expectOk(
        'the verification call itself succeeds',
        await verifier.verify(identifier, derivedValue),
      ) as { kind: string; principalId?: string };
    },
    close(): void {
      harness.close();
    },
  };
}

/**
 * Asserts the three parameters that distinguish the three failure modes, against the row as
 * stored. Called BEFORE any outcome assertion so a red names which one diverged.
 */
function assertStoredParameters(
  enrolment: Enrolment,
  expected: { readonly algorithm: string; readonly iterations: number; readonly salt: string },
): void {
  const row = readCredentialRow(enrolment.harness, enrolment.rows.identifierHash);
  assertTrue('the credential row exists', row !== undefined, 'nothing was stored to verify against');
  assertEqual('the ALGORITHM IDENTIFIER as stored', row!.algorithm, expected.algorithm);
  assertEqual('the ITERATION COUNT as stored', row!.iterations, expected.iterations);
  assertEqual('the SALT as stored', row!.salt, expected.salt);
}

export function buildEnrolmentRoundTripSuite(): Suite {
  const suite = new Suite('AZ2 — enrol with one implementation, sign in with another');

  // =========================================================================================
  // The four implementations agree, INCLUDING the one nothing has ever checked.
  // =========================================================================================

  suite.test('the shipped browser client matches the independent reference', async () => {
    // ===================================================================================
    // *** THIS CASE USED TO COMPARE TWO HOST COPIES. `0040` MERGED THEM, AND A NAIVE REPOINT
    // *** WOULD HAVE LEFT IT COMPARING A FUNCTION WITH ITSELF — PASSING FOREVER, MEASURING
    // *** NOTHING, AND LOOKING EXACTLY LIKE THE CHECK STILL WORKING.
    // ===================================================================================
    //
    // What it asserted: `platform/web/src/api/kdf.ts` and `platform/admin/src/api/kdf.ts` derive
    // the same value. Both now resolve to `@dudo/client-kdf`, so `admin === web` is `a === a`.
    // **The guarantee was not weakened — it moved from a test into the file layout**, which is a
    // mechanism rather than a discipline (`architecture.md` §3a) and is strictly stronger: the
    // drift is now impossible to express rather than merely detectable. `web-agent`'s
    // `check:suite-parity` had found 17 real gaps between the copies before they merged.
    //
    // **The three self-comparisons are struck rather than repointed**, because a `§12` sweep of a
    // withdrawn guarantee has to remove the assertions it left behind, not keep them passing. What
    // survives is the comparison against an INDEPENDENT implementation, which is the part that was
    // never about the two copies.
    const client = await clientDerive(EMAIL, PASSWORD);
    const reference = referenceClientValue(PASSWORD, normalizeIdentifier(EMAIL));

    assertEqual('the shipped client matches the independent reference', client.derived_key, reference);
    // The normalised identifier travels with the derived value and IS the salt, so a disagreement
    // here would mean a different key AND a different account looked up.
    assertEqual('and it normalises the identifier as Core does', client.email, normalizeIdentifier(EMAIL));

    // The control: the derivation discriminates. Without it, every assertion above would be
    // satisfied by two implementations that both return a constant.
    const different = await clientDerive(EMAIL, `${PASSWORD}-different`);
    assertTrue(
      'a different password derives a different value',
      different.derived_key !== client.derived_key,
      'two distinct passwords derived the same key, so the comparisons above are vacuous',
    );
  });

  suite.test('*** AND NO HOST HAS RE-FORKED THE KDF — the guard that replaced the comparison ***', () => {
    // ===================================================================================
    // THE REPLACEMENT FOR THE STRUCK ASSERTIONS. `§12`: sweeping a withdrawn guarantee means
    // leaving something watching, or saying plainly that nothing needs watching.
    // ===================================================================================
    //
    // Something does. **The merged package makes drift impossible only for as long as there is one
    // copy**, and the single edit that undoes `0040`'s guarantee is someone adding a host-local
    // `kdf` module back — for a quick fix, a build constraint, or a divergent requirement. That is
    // exactly how the two copies arose in the first place.
    //
    // This is the reservation pattern: it asserts the ABSENCE that carries the guarantee, so the
    // day a fork reappears the suite goes red and names it, rather than a merged package quietly
    // becoming two again with a self-comparison passing beside it.
    const hosts = ['platform/web/src', 'platform/admin/src'];
    const forks: string[] = [];
    for (const host of hosts) {
      const root = fileURLToPath(new URL(`../../../../${host}/`, import.meta.url));
      const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = `${directory}${entry.name}`;
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(`${path}/`);
          } else if (/^kdf(-[a-z]+)?\.(ts|tsx|mjs|js)$/.test(entry.name)) {
            forks.push(`${host}/${path.slice(root.length)}`);
          }
        }
      };
      walk(root);
    }

    // THE FLOOR: the walk must have reached something, or "no forks" means "no files examined".
    let examined = 0;
    for (const host of hosts) {
      const root = fileURLToPath(new URL(`../../../../${host}/`, import.meta.url));
      const count = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') count(`${directory}${entry.name}/`);
          } else examined += 1;
        }
      };
      count(root);
    }
    console.log(`        kdf fork guard: ${String(examined)} files across ${String(hosts.length)} hosts`);
    assertTrue(
      `${ISOLATION} both host trees were walked`,
      examined >= 20,
      `only ${String(examined)} files were examined across ${hosts.join(' and ')}; a collapsed ` +
        'walk would report "no forks" for a tree it never opened',
    );

    assertEqual(
      `${ISOLATION} neither console carries its own kdf module — both consume @dudo/client-kdf`,
      forks.join(' · '),
      '',
    );
  });

  // =========================================================================================
  // The round trip, with a SHIPPED CLIENT on the signing-in side.
  // =========================================================================================

  suite.test('a credential enrolled by the TOOL is accepted from the WEB client', async () => {
    const enrolment = await enrol();
    try {
      assertStoredParameters(enrolment, {
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: enrolment.rows.salt,
      });
      const submitted = await clientDerive(EMAIL, PASSWORD);
      const outcome = await enrolment.verify(EMAIL, submitted.derived_key);
      assertEqual('the web client signs in', outcome.kind, 'verified');
      assertEqual('as the enrolled principal', outcome.principalId, PRINCIPAL);
    } finally {
      enrolment.close();
    }
  });

  suite.test('a credential enrolled by the TOOL is accepted from the ADMIN console', async () => {
    // THE CASE THAT MATTERS FOR THE FIRST LIVE SIGN-IN. The platform-operator surface is served on
    // the admin host, so this is the exact path the user takes after the deploy — and it is the
    // one no test in this repository exercised before.
    const enrolment = await enrol();
    try {
      assertStoredParameters(enrolment, {
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: enrolment.rows.salt,
      });
      const submitted = await clientDerive(EMAIL, PASSWORD);
      const outcome = await enrolment.verify(EMAIL, submitted.derived_key);
      assertEqual('the admin console signs in', outcome.kind, 'verified');
      assertEqual('as the enrolled principal', outcome.principalId, PRINCIPAL);

      // ---- AND THE CASE IS SENSITIVE TO THE CLIENT'S OWN PARAMETERS.
      //
      // *** ITS ORIGINAL JUSTIFICATION IS GONE AND THE ASSERTION SURVIVES ON A DIFFERENT ONE. ***
      // It used to read: *the constant sits ABOVE the region `verify-kdf.mjs` compares*, so a
      // client-side drift was the likeliest way the copied file could diverge undetected.
      // **`verify-kdf.mjs` is deleted and there is no copied file** — that argument is retired.
      //
      // **What it still does is the reason to keep it:** without this, *"the console signs in"* is
      // a green line that would stay green if the assertion were consuming a constant rather than
      // the real implementation's output. `deriveLoginCredential` takes the iteration count as its
      // third argument, so passing a different one **must** change the result. **It is a
      // discrimination control, not a drift detector**, and re-deriving it that way is `§12`'s
      // *check whether an argument was resting on what you withdrew* — the conclusion held, the
      // premise did not.
      const drifted = await clientDerive(EMAIL, PASSWORD, 599_999);
      assertTrue(
        'a one-iteration client-side drift produces a different value',
        drifted.derived_key !== submitted.derived_key,
        'the client ignored its iteration count, so this case is consuming something other than ' +
          'the real derivation and "the console signs in" above proves nothing',
      );
      assertEqual(
        'and that value is REFUSED — the round trip detects a client-side divergence',
        (await enrolment.verify(EMAIL, drifted.derived_key)).kind,
        'refused',
      );
    } finally {
      enrolment.close();
    }
  });

  suite.test('the identifier is normalised on both sides — a different casing still signs in', async () => {
    // The salt IS the normalised identifier, so "normalised on one side only" changes both the
    // account looked up and the key derived. Enrolled under one casing, signed in under another.
    const enrolment = await enrol();
    try {
      const submitted = await clientDerive(EMAIL_OTHER_CASING, PASSWORD);
      assertEqual(
        'the client normalises to the same identifier it was enrolled under',
        submitted.email,
        normalizeIdentifier(EMAIL),
      );
      const outcome = await enrolment.verify(EMAIL_OTHER_CASING, submitted.derived_key);
      assertEqual('the account is found and the credential matches', outcome.kind, 'verified');
      assertEqual('and it is the same principal', outcome.principalId, PRINCIPAL);
    } finally {
      enrolment.close();
    }
  });

  // =========================================================================================
  // The negative controls. Each perturbs ONE stored parameter; the rest of the row is untouched.
  // =========================================================================================

  suite.test('NEGATIVE CONTROL — a perturbed stored ITERATION COUNT refuses the right value', async () => {
    const perturbed = SERVER_KDF_ITERATIONS - 1;
    const enrolment = await enrol({ iterations: perturbed });
    try {
      assertStoredParameters(enrolment, {
        algorithm: SUPPORTED_ALGORITHM,
        iterations: perturbed,
        salt: enrolment.rows.salt,
      });
      const submitted = await clientDerive(EMAIL, PASSWORD);
      const outcome = await enrolment.verify(EMAIL, submitted.derived_key);
      assertEqual(
        'a correct derived value is refused when the stored iteration count is wrong',
        outcome.kind,
        'refused',
      );
    } finally {
      enrolment.close();
    }

    // The control beside it: the SAME submitted value verifies against an unperturbed row. Without
    // this the refusal above would be satisfied by a verifier that refuses everything.
    const clean = await enrol();
    try {
      const submitted = await clientDerive(EMAIL, PASSWORD);
      assertEqual(
        'the identical value verifies against an unperturbed row',
        (await clean.verify(EMAIL, submitted.derived_key)).kind,
        'verified',
      );
    } finally {
      clean.close();
    }
  });

  suite.test('an unrecognised stored ALGORITHM cannot be written by this build at all', async () => {
    // ===========================================================================================
    // THIS CASE CHANGED SHAPE ONCE I RAN IT, AND THE REASON IS RECORDED RATHER THAN SMOOTHED OVER.
    // ===========================================================================================
    //
    // I wrote it as a third storage perturbation, matching the iteration-count and salt controls.
    // It went red on `CHECK constraint failed: algorithm IN ('pbkdf2-sha256-v1')` — migration
    // `0006` will not store the value, so the state cannot be built through the database and the
    // perturbation was testing my fixture rather than the verifier.
    //
    // THE SCHEMA REFUSING IT IS THE STRONGER PROPERTY AND IS WHAT THIS CASE NOW ASSERTS. An
    // algorithm outside the union is not "refused at verification time" in this build; it is
    // UNSTORABLE, which is the same device `0008_platform_operator.sql` uses for `platform_role`.
    let raised: unknown = null;
    try {
      await enrol({ algorithm: 'pbkdf2-sha256-v2' });
    } catch (cause) {
      raised = cause;
    }
    assertTrue(
      'the database refuses an algorithm outside the closed union',
      raised !== null && String(raised).includes('CHECK constraint failed'),
      `expected a CHECK constraint failure, got ${String(raised)}`,
    );

    // AND THE VERIFIER'S OWN BRANCH IS STILL REACHED, through a store double — because the
    // property that matters for a FUTURE migration is that a row this build does not understand
    // DENIES rather than throwing. The schema closes it today; the code has to close it tomorrow.
    const harness = createControlPlaneDatabase();
    try {
      const rows = await buildSeedRows({
        email: EMAIL,
        password: PASSWORD,
        lookupKey: LOOKUP_KEY,
        nowMs: ENROLLED_AT,
        salt: SALT,
        principalId: PRINCIPAL,
      });
      const futureAlgorithm: CredentialStore = {
        async findByIdentifierHash(identifierHash: string) {
          return ok({
            identifierHash,
            principalId: rows.principalId,
            // The cast is the point: this value is unrepresentable in the union AND unstorable in
            // the schema, so a future migration is the only thing that could produce it.
            algorithm: 'pbkdf2-sha256-v2' as CredentialRecord['algorithm'],
            iterations: SERVER_KDF_ITERATIONS,
            salt: rows.salt,
            verifier: rows.verifier,
          });
        },
      };
      const verifier = await createCredentialVerifier({
        credentials: futureAlgorithm,
        identifiers: await createHmacIdentifierHasher(LOOKUP_KEY),
      });
      const submitted = await clientDerive(EMAIL, PASSWORD);
      const outcome = expectOk(
        'the verification call itself succeeds — it denies, it does not throw',
        await verifier.verify(EMAIL, submitted.derived_key),
      ) as { kind: string };
      assertEqual(
        'a row a future migration wrote fails onto the SAFE path',
        outcome.kind,
        'refused',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('NEGATIVE CONTROL — a perturbed stored SALT refuses the right value', async () => {
    // The salt is per-user and stored. A value stored under a different salt is the "enrolled by
    // one path, verified by another" failure in its purest form: both sides ran correct code.
    const otherSalt = toBase64Url(new Uint8Array(16).fill(0x5a));
    const enrolment = await enrol({ salt: otherSalt });
    try {
      assertStoredParameters(enrolment, {
        algorithm: SUPPORTED_ALGORITHM,
        iterations: SERVER_KDF_ITERATIONS,
        salt: otherSalt,
      });
      assertTrue(
        'the perturbed salt really differs from the enrolled one',
        otherSalt !== enrolment.rows.salt,
        'the control did not perturb anything',
      );
      const submitted = await clientDerive(EMAIL, PASSWORD);
      assertEqual(
        'a correct derived value is refused when the stored salt is wrong',
        (await enrolment.verify(EMAIL, submitted.derived_key)).kind,
        'refused',
      );
    } finally {
      enrolment.close();
    }
  });

  suite.test('NEGATIVE CONTROL — an identifier hashed from the RAW address is never found', async () => {
    // "Normalised on one side and not the other", at the lookup rather than at the salt. The row
    // is stored under a hash of the raw address; every client normalises before hashing, so the
    // account is unreachable — and the refusal is indistinguishable from an account that does not
    // exist, which is the equal-work property holding rather than an extra failure.
    const hasher = await createHmacIdentifierHasher(LOOKUP_KEY);
    const rawHash = await hasher.hash(EMAIL);
    const normalizedHash = await hasher.hash(normalizeIdentifier(EMAIL));
    assertTrue(
      'the raw and normalised addresses really hash differently',
      rawHash !== normalizedHash,
      'the fixture cannot distinguish normalised from raw, so this control tests nothing',
    );

    const enrolment = await enrol({ identifierHash: rawHash });
    try {
      const submitted = await clientDerive(EMAIL, PASSWORD);
      assertEqual(
        'the account cannot be found, so a correct credential is refused',
        (await enrolment.verify(EMAIL, submitted.derived_key)).kind,
        'refused',
      );
    } finally {
      enrolment.close();
    }
  });

  return suite;
}
