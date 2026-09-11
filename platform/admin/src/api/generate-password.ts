/**
 * The generated password, in its own module so it can actually be verified.
 *
 * ===========================================================================
 * WHY IT IS SPLIT OUT OF `onboarding-credential.ts`
 * ===========================================================================
 *
 * That module imports `kdf-client`, which imports `kdf-worker`, which calls
 * `self.addEventListener` at module scope — so importing it under Node throws
 * before a single check can run. The generator would then have been testable
 * only by COPYING it into the verification script, which is precisely the shape
 * that lets a script pass while the shipped file is wrong.
 *
 * THIS FILE IMPORTS ONLY `./kdf`, which is browser-and-Node safe, so
 * `scripts/verify-platform.mjs` exercises THE REAL FUNCTION. For a value whose
 * only job is to be unguessable, "we tested a copy of it" is not verification.
 *
 * ===========================================================================
 * THE `.ts` EXTENSION BELOW IS LOAD-BEARING. DO NOT REMOVE IT.
 * ===========================================================================
 *
 * IT IS THE ONLY EXPLICIT EXTENSION IN `src/`, AND THAT ASYMMETRY IS DELIBERATE.
 *
 * Splitting this module out was not enough on its own. `qa-agent` found that a
 * BARE NODE LOADER — one without this project's `scripts/node-resolve-*.mjs`
 * hooks — cannot resolve an extensionless relative import: `ERR_MODULE_NOT_FOUND`.
 * So `packages/testing`, which has no such hook, could not import this file and
 * was generating its own password in a fixture instead. Every other leg of the
 * credential path was asserted there; the generator was asserted only by this
 * project's own script.
 *
 * THAT GAP MATTERED MORE THAN ORDINARY COVERAGE. `0017` records that the
 * pre-authentication rate limiter "does not bind across isolates, so the entropy
 * of this string is what is actually protecting the account." The generator IS
 * the control.
 *
 * ⚠ THE PARAGRAPH THAT WAS HERE DESCRIBED A CONSTRAINT THAT NO LONGER EXISTS,
 * AND ADR 0040 IS WHAT REMOVED IT.
 *
 * It explained why the rest of the tree kept extensionless `./kdf` imports: this
 * console's `kdf-client.ts` and `kdf-worker.ts` "MUST REMAIN BYTE-IDENTICAL to
 * `platform/web`'s copies — `verify-kdf.mjs` compares them character for
 * character and fails on a one-character difference", so adding an extension
 * "would break the cross-client drift check to fix a test harness". The mixed
 * style was described as forced rather than careless, and it was.
 *
 * **THERE ARE NO LONGER TWO COPIES TO KEEP IDENTICAL.** The three modules moved
 * to `@dudo/client-kdf`, the drift check retired with its subject, and the
 * import below is now a package specifier rather than a sibling file. The
 * constraint dissolved with the duplication that created it.
 *
 * Recorded rather than deleted because it is `workflow.md` §12's shape exactly:
 * **a decision being made strands the artifacts that reasoned about the world it
 * changed**, and nothing goes red when it happens. This paragraph would have
 * gone on explaining a forced trade-off to the next reader, who would have
 * believed it.
 *
 * `allowImportingTsExtensions` remains enabled in `tsconfig.json`. It is now
 * unused by this file and is left alone deliberately — removing a compiler
 * option is a separate change with its own blast radius, and this one is
 * permissive rather than mandatory.
 */

import { toBase64Url } from '@dudo/client-kdf';

/**
 * 24 bytes. 32 base64url characters, about 192 bits.
 *
 * MATCHES `platform/core/identity/tools/seed-principal.ts` EXACTLY — "24 CSPRNG
 * bytes, base64url, 32 characters, about 192 bits" — and
 * `organization-onboarding-v1`'s schema names that tool as the reference. Two
 * generators disagreeing on entropy would be a difference nobody could see by
 * looking at the output, because both produce a plausible-looking string.
 */
const PASSWORD_BYTES = 24;

/** The exact length. 24 bytes encode to 32 unpadded base64url characters. */
export const GENERATED_PASSWORD_LENGTH = 32;

/**
 * Generates the first administrator's password.
 *
 * `crypto.getRandomValues` IS THE CSPRNG AND NOTHING ELSE IS ACCEPTABLE.
 * `Math.random` is not cryptographically secure, and this is the credential for
 * the account with the most authority inside a customer's tenant.
 *
 * ===========================================================================
 * THE ENTROPY IS DOING WORK A RATE LIMITER WOULD OTHERWISE DO
 * ===========================================================================
 *
 * `organization-onboarding-v1` accepts no password field, and the reason is
 * recorded: "`0017`'s basis is that entropy protects these accounts, so an
 * operator-chosen password expires that decision." Dudo's pre-auth rate limiting
 * is in-process and per-isolate (PO-4) and bounds nothing in a deployed Worker.
 * So weakening this generator does not merely produce a weaker password — it
 * removes a control nothing else currently provides.
 *
 * base64url rather than a word list or a shaped pattern: it is what
 * `seed-principal.ts` produces, every character carries full entropy, and it is
 * unambiguous to transcribe. A "friendlier" format would trade the property this
 * design rests on for readability.
 */
export function generateAdminPassword(): string {
  const bytes = new Uint8Array(PASSWORD_BYTES);
  crypto.getRandomValues(bytes);
  const password = toBase64Url(bytes);
  if (password.length !== GENERATED_PASSWORD_LENGTH) {
    /*
     * Unreachable: 24 bytes always encode to 32 unpadded base64url characters.
     *
     * REFUSED RATHER THAN ASSERTED AWAY, because the failure it guards against
     * is silent. A short password would be accepted by Core, stored as a
     * legitimate verifier, and weaken that account permanently — and nobody
     * would be able to tell by looking at it. Failing here is recoverable;
     * succeeding quietly is not.
     */
    throw new Error(
      `The generated password is ${String(password.length)} characters, not ` +
        `${String(GENERATED_PASSWORD_LENGTH)}. It was not used.`,
    );
  }
  return password;
}
