/**
 * The first admin's password, generated in the operator's browser.
 *
 * ===========================================================================
 * THE SERVER NEVER SEES A PASSWORD, AND THAT IS THE WHOLE POINT
 * ===========================================================================
 *
 * `docs/decisions/0026` closed ON-5 as option B: **this console generates the
 * password and derives from it**, sending only the 43-character KDF output. So
 * ADR 0015 §D's central property survives onboarding unchanged — the raw
 * password never crosses the wire, is never logged, and is never stored. What
 * changed is only WHICH browser performs the derivation, and an operator's
 * browser has no 10 ms CPU limit the way a Worker isolate does.
 *
 * `onboardOrganizationOutput` carries NO CREDENTIAL FIELD OF ANY KIND — a
 * plaintext `initial_password` was removed from it on 2026-09-05, with no
 * tombstone property, because a placeholder under `additionalProperties: false`
 * would be a permitted optional field: "the same defect one size smaller".
 *
 * ===========================================================================
 * THEREFORE THIS BROWSER HOLDS THE ONLY COPY IN EXISTENCE
 * ===========================================================================
 *
 * Not the only copy the operator has — THE ONLY COPY ANYWHERE. Core stores
 * `PBKDF2(derived_value, per-user random salt, 10_000)` and cannot invert it.
 * If the operator closes the tab without recording the password, the account is
 * unreachable and the remedy is a credential reset by an operator.
 *
 * Consequences this module is built around:
 *
 *   - IT IS NEVER PERSISTED. Not `localStorage`, not `sessionStorage`, not a
 *     cookie, not a module-level variable that outlives the screen. It lives in
 *     React state for the life of one screen and is dropped on unmount.
 *   - IT IS NEVER LOGGED, echoed into an error, or put in a URL.
 *     `.claude/rules/security.md` §5.
 *   - IT IS NOT SHOWN UNTIL CORE ANSWERS 201. Displaying it beside a request
 *     that then failed hands an operator a credential for an account that does
 *     not exist, and they cannot tell the difference afterwards.
 *
 * ===========================================================================
 * WHY THE PASSWORD IS GENERATED RATHER THAN CHOSEN
 * ===========================================================================
 *
 * `onboardOrganizationInput` accepts NO password field, and the schema records
 * why: "`0017`'s basis is that entropy protects these accounts, so an
 * operator-chosen password expires that decision." Dudo's pre-auth rate limiting
 * is in-process and per-isolate (`0017`, PO-4) and bounds nothing in a deployed
 * Worker — so the strength of these credentials is doing the work a rate limiter
 * would otherwise do. A human-chosen password would quietly remove that.
 *
 * ===========================================================================
 * AND THE COST, WHICH IS ACCEPTED RATHER THAN OVERLOOKED
 * ===========================================================================
 *
 * THERE IS NO SELF-SERVICE PASSWORD CHANGE. So whoever onboards a business
 * knows that admin's password until an operator resets the credential. `0026`
 * records this as an accepted cost, not an oversight, and the screen says so in
 * those terms rather than leaving an operator to work it out.
 */

import { deriveLogin, type DerivationProgress } from './kdf-client';
import { generateAdminPassword } from './generate-password';

export { generateAdminPassword, GENERATED_PASSWORD_LENGTH } from './generate-password';

export interface OnboardingCredential {
  /** THE ONLY COPY. Shown once, never stored, never sent. */
  readonly password: string;
  /** The normalised identifier — what is sent, and what the admin signs in with. */
  readonly identifier: string;
  /** Exactly 43 base64url characters. This is what goes on the wire. */
  readonly derivedValue: string;
  readonly derivationMs: number;
  readonly usedWorker: boolean;
}

/**
 * Generates a password and derives the value Core will store a verifier of.
 *
 * ===========================================================================
 * IT REUSES THE LOGIN CLIENT'S DERIVATION, AND THAT IS THE REQUIREMENT
 * ===========================================================================
 *
 * `deriveLogin` is the same code path a person signing in goes through: it
 * validates the identifier, normalises it (NFKC then ASCII-only case folding),
 * uses that normalised form as the salt, NFC-normalises the password, and runs
 * PBKDF2-SHA256 at 600,000 iterations for 32 bytes — in a Web Worker, so the tab
 * does not freeze.
 *
 * IF THIS DERIVED DIFFERENTLY FROM THE LOGIN PATH, THE ACCOUNT WOULD BE CREATED
 * AND COULD NEVER BE SIGNED INTO. That failure is silent at creation and only
 * appears when a real customer first tries to log in — so the derivation is not
 * reimplemented here, it is CALLED. The schema states the obligation directly:
 * "The console's KDF must be byte-identical to the web and Apple clients'."
 * `scripts/verify-kdf.mjs` already proves that byte-identity against
 * `platform/web`.
 *
 * THE SALT IS AVAILABLE BECAUSE THE OPERATOR TYPED THE IDENTIFIER IN THIS SAME
 * REQUEST. `credential-reset-v1` has no such luck and needed a different request
 * shape for the same decision (CR-5) — worth knowing before assuming this
 * pattern generalises to reset.
 *
 * THE RETURNED `identifier` IS THE NORMALISED FORM, and that is what is sent.
 * Core normalises again internally, so either would be accepted — but sending
 * the normalised value means the string the operator is told to sign in with is
 * exactly the string that was salted and stored, with no third spelling in play.
 */
export async function createOnboardingCredential(
  adminIdentifier: string,
  onProgress: (progress: DerivationProgress) => void,
): Promise<OnboardingCredential> {
  const password = generateAdminPassword();
  const derived = await deriveLogin(adminIdentifier, password, onProgress);
  return {
    password,
    identifier: derived.email,
    derivedValue: derived.derivedKey,
    derivationMs: derived.elapsedMs,
    usedWorker: derived.usedWorker,
  };
}
