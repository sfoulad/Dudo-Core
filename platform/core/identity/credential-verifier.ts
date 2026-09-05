/**
 * ===========================================================================================
 * CREDENTIAL VERIFICATION, AND THE EQUAL-WORK PROPERTY IT EXISTS TO HOLD. `docs/decisions/0015`.
 * ===========================================================================================
 *
 * THE FINDING THIS ENTIRE FILE IS SHAPED BY, quoted rather than paraphrased because paraphrasing
 * it is how it gets lost — `0015` finding 3, verified against Cloudflare's own documentation:
 *
 *   *"`Date.now()` returns the time of the last I/O. It does not advance during code execution."*
 *
 *   *"Measure-then-pad is structurally impossible inside a Worker for CPU-bound branches. THE
 *   ONLY AVAILABLE DEFENCE AGAINST A CPU TIMING ORACLE IS TO MAKE THE WORK EQUAL, never to
 *   measure and compensate."*
 *
 * So `pre-auth-admission.ts`'s response floor — a real control, retained — cannot help here. Its
 * deadline is computed from a frozen instant, so for CPU work it is ADDITIVE (`work + 250 ms`)
 * rather than absolute, and `timing_overrun` CANNOT FIRE for a CPU overrun. `0014` §B installed
 * that alert as Core's honest admission that it cannot enforce equal work in another module's
 * handler; `0015` establishes that the alert is blind to exactly the failure it names. The floor
 * covers I/O variance — a D1 read does advance the clock — and nothing else.
 *
 * THEREFORE THIS FILE, AND NOT CORE, IS WHERE THE ORACLE IS CLOSED. Core can announce a
 * violation; it cannot prevent one. `qa-agent` tests this directly (`0015` §C.3: *"Equal work on
 * both branches is the primary defence, not the fallback."*).
 *
 * ===========================================================================================
 * HOW EQUAL WORK IS GUARANTEED HERE — five properties, each one checkable by reading `verify`
 * ===========================================================================================
 *
 * 1. THERE IS EXACTLY ONE `return` STATEMENT IN `verify`, AND IT IS THE LAST LINE. No early
 *    return exists on any path after the stored record has been looked up, so there is no branch
 *    that can skip the expensive work. This is stated as a structural property rather than a
 *    convention because it is one a reviewer can check in five seconds and a future edit will
 *    otherwise quietly break.
 *
 * 2. THE KDF PARAMETERS ARE CHOSEN BEFORE THE KDF RUNS, AND THE MISS BRANCH SUPPLIES A FIXED
 *    DUMMY RECORD WITH IDENTICAL PARAMETERS — same algorithm, same iteration count, same salt
 *    length, same output length. `deriveVerifier` is then called ONCE, unconditionally, with
 *    whichever parameter set was selected. One call site, one cost.
 *
 * 3. THE DUMMY VERIFIER IS UNMATCHABLE BY CONSTRUCTION. It is derived at composition from 32
 *    bytes of CSPRNG output that are discarded immediately, so no caller can produce a submitted
 *    value whose derivation equals it, and no attacker can learn it from the database because it
 *    is not in the database. Even so, a match against it is not sufficient for success — see 4.
 *
 * 4. SUCCESS REQUIRES BOTH A FOUND RECORD AND A MATCH, and both operands are ALREADY-COMPUTED
 *    VALUES by the time they are combined. `&&` short-circuits, so the operands are deliberately
 *    plain booleans rather than calls: there is nothing left to short-circuit past.
 *
 * 5. EVERY UNUSABLE STORED ROW IS TREATED AS A MISS, ON THE MISS PATH, WITH THE DUMMY PARAMETERS.
 *    An unrecognised algorithm, a malformed OR EMPTY salt, a malformed OR EMPTY verifier, an
 *    EMPTY principal identifier, and AN ITERATION COUNT THAT IS NOT THE ONE THIS BUILD IMPLEMENTS
 *    all fall through to the same derivation at the same cost. A row this build cannot understand
 *    must not cost less than a row it can — otherwise "which of your users is on the old
 *    algorithm" becomes measurable, which is a per-account signal on the one path that is
 *    reachable without authentication.
 *
 * ===========================================================================================
 * TWO EXCEPTIONS TO PROPERTY 5 EXISTED UNTIL 2026-09-04, AND THEY ARE RECORDED RATHER THAN
 * QUIETLY REPAIRED. BOTH WERE FOUND BY `qa-agent`, NOT BY THIS FILE'S AUTHOR.
 * ===========================================================================================
 *
 * THE HEADER CLAIMED EQUAL WORK WITHOUT NAMING EITHER, WHICH IS THE PART THAT MATTERED MOST. A
 * header that overclaims is how a limit gets forgotten: the next reader checks the claim, finds
 * it stated confidently, and does not go looking.
 *
 *   AN EMPTY STORED SALT OR VERIFIER DID NOT REACH THE MISS PATH. `d1-credential-store.ts`
 *   mapped `''` to `null` like any absent column, treated the row as corrupt, and returned
 *   `internal()` — so the verifier answered `unavailable` HAVING DERIVED NOTHING. Far cheaper
 *   than a miss, and a different answer. FIXED IN THE ADAPTER: a credential row now never
 *   produces an error, every field is carried through raw, and `parametersFor` is the only thing
 *   that decides usability. `salt TEXT NOT NULL` never excluded `''`, so the migration gained
 *   `CHECK (length(...) > 0)` as well — write-side and read-side, because either alone leaves the
 *   other's case open.
 *
 *   AN IN-RANGE NON-STANDARD ITERATION COUNT WAS HONOURED. See `parametersFor`, where the
 *   narrowing and what it costs are argued in full.
 *
 * Neither was reachable in the shipping system: nothing but `tools/seed-principal.ts` writes this
 * table, and it writes a valid salt, a valid verifier and the constant unconditionally. Both were
 * latent — reachable by a corrupt row, a future writer, or an operator editing by hand — and
 * "unreachable today" is a fact about who has written to the table, not a property of the code.
 *
 * WHAT IS STILL *NOT* CLAIMED, because `0015` §C.1 requires the scope of every timing control to
 * be stated honestly: the D1 point lookup itself is I/O, and a read that hits an existing row is
 * not bit-for-bit the same work as one that does not. That difference is what the 250 ms response
 * floor covers, and it is the reason the floor is retained rather than removed. This file closes
 * the CPU half; the floor closes the I/O half; NEITHER IS SUFFICIENT ALONE AND BOTH ARE PRESENT.
 *
 * ===========================================================================================
 * THE ITERATION COUNT IS 10,000 AND MUST NOT BE RAISED. IT IS A SAFETY CEILING, NOT A BUDGET.
 * ===========================================================================================
 *
 * `0015` §D: 10,000 iterations is ~1.7 ms, 17% of the Workers Free 10 ms CPU allowance. The
 * offline work factor that matters is the CLIENT's 600,000 plus this — roughly 610,000, above
 * OWASP's recommendation — so raising the server side buys almost nothing and costs a great deal:
 *
 *   *"a CPU-limit kill produces a response Dudo did not author. `pre-auth-http.ts` is a fixed
 *   table precisely so every branch is byte-identical; if the invocation is terminated at 10 ms,
 *   `finish()` never runs, the timing floor never applies, and the caller receives a runtime error
 *   whose shape Core does not control. That is an intermittent disclosure channel outside the
 *   fixed table."*
 *
 * An intermittent, load-dependent escape from the fixed response table is a WORSE security defect
 * than a smaller server-side work factor, and it is one that would appear only under load — that
 * is, during an attack. `assertVerifierParametersAreCoherent` refuses at module load rather than
 * leaving the constant to review.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unavailable } from '../kernel/errors.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import type {
  CredentialAlgorithm,
  CredentialRecord,
  CredentialStore,
  IdentifierHasher,
} from './credential-store.ts';
import {
  fromBase64Url,
  isSubmittableIdentifier,
  normalizeIdentifier,
} from './credential-store.ts';

// =============================================================================================
// The parameters. Fixed, asserted at load, and shared with the enrollment tool.
// =============================================================================================

/** The one algorithm this build implements. See `CredentialAlgorithm`. */
export const SUPPORTED_ALGORITHM: CredentialAlgorithm = 'pbkdf2-sha256-v1';

/** `0015` §D, normative. ~1.7 ms. Read the header before changing this. */
export const SERVER_KDF_ITERATIONS = 10_000;

/**
 * The absolute ceiling, and it is well below what the CPU allowance would technically permit.
 *
 * `0015` derives a clean fit of 0.120 ms per 1,000 iterations and a hard ceiling near 75,000, and
 * argues against running anywhere near it. 20,000 is double the chosen value, which leaves room
 * for a recorded decision to raise it once without editing this line, and stops a well-meaning
 * "let us make it stronger" edit from reaching the region where a runtime kill becomes likely.
 */
export const MAX_SERVER_KDF_ITERATIONS = 20_000;

/** 16 bytes. Per user, from the CSPRNG, generated by the enrollment tool. */
export const SALT_BYTES = 16;

/** 32 bytes in, 32 bytes out. The client sends 32; the stored verifier is 32. */
export const VERIFIER_BYTES = 32;

/**
 * The exact width of the submitted value, in base64url characters.
 *
 * ===========================================================================================
 * THIS IS THE ONLY MITIGATION FOR A CLIENT THAT POSTS A RAW PASSWORD, AND IT DOES NOT CLOSE IT.
 * ===========================================================================================
 *
 * `0015` §D records the residual risk in those terms and this file does not soften it: *"a client
 * that posted the raw password instead of the KDF output would be indistinguishable to the
 * server. Requiring exactly 43 base64url characters mitigates but does not close it."* A
 * 43-character password drawn from `[A-Za-z0-9_-]` passes this check and the server cannot tell.
 *
 * WHAT ACTUALLY NARROWS IT TODAY, stated because it is a real property and not a hope: enrollment
 * is an OPERATOR ACTION that runs Dudo's own tool (`tools/seed-principal.ts`), and the tool
 * performs the client-side KDF itself. So the stored verifier is a hash of a value derived with
 * 600,000 iterations, and a client that sent anything else — a raw password, the right function
 * with the wrong iteration count, a different hash entirely — produces a different 32 bytes and
 * is REFUSED. The mismatch fails closed and loud rather than silently weakening anything.
 *
 * WHERE THE HOLE REOPENS, AND IT IS A FUTURE SLICE'S TO CLOSE: self-service registration. An
 * enrollment endpoint that stored a hash of whatever the client posted would enroll a raw
 * password without either side noticing, and this length check would not detect it. That slice
 * must bind its client with shared test vectors before it accepts a single enrollment.
 */
export const SUBMITTED_VALUE_CHARACTERS = 43;

export class VerifierParametersIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifierParametersIncoherentError';
  }
}

/**
 * Runs at module load, like `assertControlPlaneBudgetIsCoherent` and for the same reason: a
 * parameter set that has drifted out of the range `0015` decided would do it silently, and the
 * failure it produces is intermittent and only visible under load.
 */
export function assertVerifierParametersAreCoherent(): void {
  if (
    !Number.isInteger(SERVER_KDF_ITERATIONS) ||
    SERVER_KDF_ITERATIONS < 1 ||
    SERVER_KDF_ITERATIONS > MAX_SERVER_KDF_ITERATIONS
  ) {
    throw new VerifierParametersIncoherentError(
      `The server-side KDF iteration count (${String(SERVER_KDF_ITERATIONS)}) is outside the ` +
        `permitted range [1, ${String(MAX_SERVER_KDF_ITERATIONS)}]. docs/decisions/0015 §D fixes ` +
        'it at 10,000 — about 1.7 ms, 17% of the Workers Free CPU allowance — and argues against ' +
        'running near the ceiling: a CPU-limit kill terminates the invocation before ' +
        "pre-auth-admission.ts's finish() runs, so the caller receives a response outside " +
        "pre-auth-http.ts's fixed table. That is an intermittent disclosure channel, and it " +
        'appears under load, which is when an attack happens.',
    );
  }
  if (SUBMITTED_VALUE_CHARACTERS !== Math.ceil((VERIFIER_BYTES * 4) / 3)) {
    throw new VerifierParametersIncoherentError(
      'The declared submitted-value width does not match the base64url encoding of ' +
        `${String(VERIFIER_BYTES)} bytes. The width check is the only mitigation for a client ` +
        'that posts a raw password instead of the derived value; a width that does not match the ' +
        'encoding is not a mitigation at all.',
    );
  }
}

assertVerifierParametersAreCoherent();

// =============================================================================================
// The KDF and the comparison
// =============================================================================================

/**
 * PBKDF2-SHA-256 over WebCrypto. No dependency, no hand-rolled cryptography.
 *
 * `crypto.subtle` is a platform global in Workers and in Node, so this names no vendor type
 * (`CLOUDFLARE_STANDARD.md` §2), and `0003` approves no npm package — argon2 and bcrypt are both
 * packages and neither is approved. `0015` finding 2 records what that costs and does not pretend
 * otherwise: PBKDF2 has no memory hardness and is not equivalent to Argon2id at any iteration
 * count. The client-side 600,000 is what makes the total adequate.
 */
/*
 * EXPORTED 2026-09-05 FOR ONBOARDING, AND EXPORTING IT IS THE SAFER OF THE TWO OPTIONS.
 *
 * `organization-onboarding-v1` writes a credential row, which means computing the same verifier
 * this function computes for the login path. The alternative was a second derivation in
 * `onboarding/`, and `worker-entry.ts` already states why that is wrong for exactly this code:
 * *"a second verifier here would be a second implementation of the hardest code in the platform,
 * measured once and trusted twice."*
 *
 * A DIVERGENCE BETWEEN THE TWO WOULD NOT LOOK LIKE A BUG. It would look like a customer's first
 * admin being unable to log in with the password they were just handed — and it would be blamed
 * on the console's KDF, which is the third implementation and the one everyone would suspect.
 */
export async function deriveVerifier(
  submitted: CryptoBytes,
  salt: CryptoBytes,
  iterations: number,
): Promise<CryptoBytes> {
  const key = await crypto.subtle.importKey('raw', submitted, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    VERIFIER_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Fixed-width XOR accumulation. A comparison, not cryptography.
 *
 * `crypto.subtle.verify` is not usable here — it verifies a full-width signature and every value
 * compared in this slice is either a truncated MAC or a derived key, neither of which it accepts
 * — so the comparison is written out. It has no early exit, examines every byte of a fixed-length
 * buffer, and its running time depends on the LENGTH alone, which is a constant of the format.
 *
 * A LENGTH MISMATCH RETURNS FALSE WITHOUT COMPARING, and that is safe here because both lengths
 * are format constants validated before this is called: `a` is always the KDF's 32-byte output,
 * and `b` is always a value `fromBase64Url` accepted at exactly 32 bytes. The branch is
 * unreachable for any caller-influenced input.
 */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

// =============================================================================================
// The verifier
// =============================================================================================

/**
 * What verification produced.
 *
 * `verified` CARRIES A PRINCIPAL IDENTIFIER AND NOTHING ELSE, and `refused` carries nothing at
 * all — no reason, no code, no field an existence fact could be written into. It is the same
 * device `PreAuthOutcome` uses one layer up, applied here so that the collapse is not the only
 * thing standing between a discovery and a disclosure.
 */
export type CredentialVerification =
  | { readonly kind: 'verified'; readonly principalId: string }
  | { readonly kind: 'refused' };

export type CredentialVerifier = {
  /**
   * Both arguments are RAW CALLER INPUT, already length-bounded by `parsePreAuthBody`. Neither is
   * logged, neither is stored, and neither appears in the result.
   */
  verify(
    submittedIdentifier: string,
    submittedValue: string,
  ): Promise<Result<CredentialVerification>>;
};

/**
 * The dummy record the miss branch derives against.
 *
 * IT IS BUILT ONCE AT COMPOSITION AND COSTS ~1.7 ms OF ISOLATE STARTUP, not per request: the
 * random bytes are the *input* to a derivation whose output is thrown away, so what is retained
 * is a salt and an unmatchable 32-byte target.
 *
 * WHY RANDOM PER ISOLATE RATHER THAN A CONSTANT OR A SECRET. A constant in source would be a
 * value an attacker could compute a preimage for at leisure; a secret would be a fourth thing to
 * provision for no gain. Random-per-isolate is unmatchable and needs no configuration, and
 * nothing depends on it being stable — it is never compared against anything but a derivation of
 * caller input, and that comparison is required to fail.
 */
type DummyCredential = {
  readonly salt: CryptoBytes;
  readonly verifier: CryptoBytes;
};

async function createDummyCredential(): Promise<DummyCredential> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const unmatchableInput = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(unmatchableInput);
  const verifier = await deriveVerifier(unmatchableInput, salt, SERVER_KDF_ITERATIONS);
  return { salt, verifier };
}

/**
 * The parameter set `deriveVerifier` is called with. One shape, filled from a real record or from
 * the dummy, so the call site has no idea which it got. That ignorance is the property.
 */
type DerivationParameters = {
  readonly salt: CryptoBytes;
  readonly iterations: number;
  /**
   * DELIBERATELY A BARE `Uint8Array` WHILE `salt` IS NOT. This one is only ever compared, never
   * handed to `crypto.subtle`, and `kernel/bytes.ts` records the rule: narrow at the crypto
   * boundary and nowhere else, so the alias keeps meaning something.
   */
  readonly expected: Uint8Array;
};

function parametersFor(record: CredentialRecord | null, dummy: DummyCredential): {
  readonly parameters: DerivationParameters;
  readonly principalId: string | null;
} {
  // EVERY REJECTION BELOW FALLS THROUGH TO THE DUMMY, and none of them returns early. See
  // property 5 in the header: a stored row this build cannot use must cost exactly what an
  // absent row costs. That now includes an EMPTY salt, an EMPTY verifier, an EMPTY principal
  // identifier and an iteration count that is anything other than the one constant.
  if (record !== null && record.algorithm === SUPPORTED_ALGORITHM) {
    const salt = fromBase64Url(record.salt, SALT_BYTES);
    const expected = fromBase64Url(record.verifier, VERIFIER_BYTES);
    // ===================================================================================
    // EXACTLY ONE ITERATION COUNT IS ACCEPTED, AND THIS IS A NARROWING MADE 2026-09-04.
    // ===================================================================================
    //
    // It previously accepted any integer in [1, MAX_SERVER_KDF_ITERATIONS] and derived at
    // whatever the row said. `qa-agent` found the consequence and it is a real one: A ROW STORED
    // AT 1,000 ITERATIONS COSTS A TENTH OF A MISS, which is a per-account timing signal on a path
    // an unauthenticated caller can drive. No such row exists — `tools/seed-principal.ts` writes
    // the constant unconditionally — but "no such row exists today" is not a property, it is a
    // coincidence of who has written to the table so far.
    //
    // SO THE COLUMN IS STILL READ AND IS NOW A GATE RATHER THAN A PARAMETER. A row whose count is
    // not the one this build implements is treated as a MISS, derived against the dummy at the
    // standard cost, and refused. The column keeps its documentary value — it records what the
    // row was made with — and stops being a per-row work factor.
    //
    // WHAT THIS COSTS, STATED BECAUSE IT IS A REAL CAPABILITY BEING GIVEN UP. Raising the server
    // count later can no longer be done by writing a new count into some rows and letting the
    // verifier honour both: that migration strategy IS the oracle. The available strategies are
    // to re-derive on each user's next successful login — possible, because the client's value is
    // in hand at exactly that moment, but it adds a D1 write to the login path and therefore
    // needs a `0014` §A budget decision — or to force re-enrolment, which is entirely feasible
    // while enrolment is operator-only. Either is a decision; neither is an edit to this line.
    const iterationsAreSupported = record.iterations === SERVER_KDF_ITERATIONS;
    // An empty principal identifier is corruption, and it must not be cheaper than a miss either.
    // It is also the one malformed field that could otherwise reach `issueSession`.
    const principalIsUsable = record.principalId.length > 0;
    if (salt !== null && expected !== null && iterationsAreSupported && principalIsUsable) {
      return {
        parameters: { salt, iterations: record.iterations, expected },
        principalId: record.principalId,
      };
    }
  }
  return {
    parameters: {
      salt: dummy.salt,
      iterations: SERVER_KDF_ITERATIONS,
      expected: dummy.verifier,
    },
    principalId: null,
  };
}

/**
 * Builds the verifier.
 *
 * `await createDummyCredential()` MAKES THE FACTORY ASYNCHRONOUS, and that is deliberate rather
 * than incidental: deriving the dummy lazily on the first miss would make the FIRST miss in an
 * isolate cost twice what a hit costs, which is a timing signal that appears exactly once per
 * isolate and would be very hard to find.
 */
export async function createCredentialVerifier(dependencies: {
  readonly credentials: CredentialStore;
  readonly identifiers: IdentifierHasher;
}): Promise<CredentialVerifier> {
  const { credentials, identifiers } = dependencies;
  const dummy = await createDummyCredential();

  return {
    async verify(
      submittedIdentifier: string,
      submittedValue: string,
    ): Promise<Result<CredentialVerification>> {
      // ---------------------------------------------------------------------------------
      // THE TWO SHAPE CHECKS, AND WHY THEY MAY RETURN EARLY WHEN NOTHING BELOW THEM MAY.
      //
      // Both are decided ENTIRELY by the bytes the caller wrote, before anything is hashed,
      // looked up or derived. They are identical for every identifier of the same shape, so the
      // branch they take is a fact the caller already holds and cannot be a fact about any
      // account. `pre-auth-admission.ts` makes the same argument for its `invalid` branch, in the
      // same words, and for the same reason.
      //
      // They are also both far inside the 250 ms response floor, so a caller cannot even see
      // them as a separate quantum: a malformed submission and a fully processed one are answered
      // at the same instant.
      // ---------------------------------------------------------------------------------
      if (!isSubmittableIdentifier(submittedIdentifier)) {
        return ok({ kind: 'refused' });
      }
      const submitted = fromBase64Url(submittedValue, VERIFIER_BYTES);
      if (submitted === null) {
        // Exactly 43 base64url characters. See `SUBMITTED_VALUE_CHARACTERS` for what this does
        // and does not mitigate — it is stated there and not claimed to be more than it is.
        return ok({ kind: 'refused' });
      }

      const identifierHash = await identifiers.hash(normalizeIdentifier(submittedIdentifier));
      const found = await credentials.findByIdentifierHash(identifierHash);
      if (!found.ok) {
        // THE STORE COULD NOT ANSWER, which is not the same as "no such account" and must not be
        // rendered as one. It becomes `unavailable` at the handler, which for
        // `identity.login.complete` is a declared outcome. A store failure that answered
        // `refused` would tell a caller that a real account's lookup had failed while an absent
        // account's had not — an existence oracle built out of an error path.
        return err(unavailable());
      }

      const { parameters, principalId } = parametersFor(found.value, dummy);

      // ---------------------------------------------------------------------------------
      // THE ONE EXPENSIVE CALL. IT RUNS ON EVERY PATH THAT REACHES THIS LINE, with parameters
      // that are identical in algorithm, iteration count, salt length and output length whether
      // the lookup hit or missed. There is no branch between here and the single `return`.
      // ---------------------------------------------------------------------------------
      const derived = await deriveVerifier(submitted, parameters.salt, parameters.iterations);

      // BOTH OPERANDS ARE ALREADY-COMPUTED VALUES. `&&` short-circuits, so the order would matter
      // if either side were a call; neither is, deliberately. Success needs a match AND a record
      // — a match against the dummy verifier is not enough on its own, even though nothing can
      // produce one. Two independent conditions, because one of them being unreachable is an
      // argument, and the other one is code.
      const matched = constantTimeEquals(derived, parameters.expected);

      return ok(
        matched && principalId !== null
          ? { kind: 'verified', principalId }
          : { kind: 'refused' },
      );
    },
  };
}
