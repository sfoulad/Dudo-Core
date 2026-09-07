/**
 * ===========================================================================================
 * THE CONFIRMATION STORAGE PORT. `docs/decisions/0027` · contract `confirmation-v1`, §storage.
 * ===========================================================================================
 *
 * TWO METHODS. `issue` and `spend`, and there is deliberately no third.
 *
 * ===========================================================================================
 * THERE IS NO `find`, AND THE ABSENCE IS THE DESIGN
 * ===========================================================================================
 *
 * A `find(bindingHash)` would be the natural companion to `spend`, and it is exactly what must not
 * exist. With one, the obvious implementation of spending is:
 *
 *     const row = await store.find(hash);      // is it unspent and unexpired?
 *     if (row === null) return refused;
 *     await store.markSpent(hash);             // then take it
 *
 * **THAT IS A READ-THEN-WRITE, AND TWO CONCURRENT REQUESTS BOTH SEE "UNSPENT" AND BOTH PROCEED.**
 * `confirmation-v1` names this as *"the one place in this contract where a plausible
 * implementation is wrong in a way testing rarely catches"* — it passes every serial test and
 * fails under the only conditions that matter.
 *
 * SO THE PORT OFFERS NO WAY TO ASK THE QUESTION SEPARATELY FROM TAKING THE ANSWER. `spend` is one
 * operation that checks and takes, and a caller cannot decompose it because there is nothing to
 * decompose it into. That is `tenancy/tenant-context.ts`'s device again — *"WITHHOLDING THE VALUE
 * IS STRONGER THAN REQUIRING ITS USE"* — applied to a query.
 *
 * IT ALSO MEANS THIS PORT CANNOT ANSWER "IS PRINCIPAL P IN THE MIDDLE OF SOMETHING CRITICAL",
 * which is a behavioural signal about a named human that nothing in Dudo needs and that a
 * `listForPrincipal` would provide for free.
 */

import type { Result } from '../kernel/result.ts';
import type { ControlPlaneWriteReservation } from '../identity/control-plane-admission.ts';

/**
 * A confirmation, as the control plane holds it.
 *
 * NOTE WHAT IS ABSENT AND MAY NEVER BE ADDED: `action_id`, any target identifier, any parameter,
 * and the statement text. `confirmation-v1` §storage: this table *"cannot be read to discover WHAT
 * anyone confirmed — only that they did."*
 *
 * A confirmation for `customers.customer.delete` names a CUSTOMER. Storing that here would put one
 * Organization's customer identifier in the database that spans every Organization, which is what
 * `0025` Decision 5 forbids of the operator log in the same words.
 */
export type ConfirmationRecord = {
  /** HMAC-SHA-256 as base64url. THE BINDING IS THE KEY — see `binding.ts`. */
  readonly bindingHash: string;
  /**
   * ===========================================================================================
   * THE OPAQUE TOKEN THE CLIENT MUST ECHO. ADDED 2026-09-05 AFTER `qa-agent` FOUND IT UNCHECKED.
   * ===========================================================================================
   *
   * **THE FIRST VERSION ISSUED THIS VALUE AND NEVER COMPARED IT.** `verifyAndSpend` recomputed the
   * binding from principal, session, action and parameters, and the presented `confirmation_id`
   * was read from the request and thrown away — so **a submission carrying a fabricated token,
   * with everything else correct, was admitted.** The field was decorative.
   *
   * WHY IT MATTERS EVEN THOUGH THE BINDING ALREADY HELD. Nothing was immediately exploitable: a
   * caller must already hold the session and have caused a challenge to be issued for the same
   * binding, and the table is keyed by binding hash so nobody can stockpile tokens.
   *
   * **BUT THE ECHO IS THE DIFFERENCE BETWEEN HAVING CAUSED A CHALLENGE TO EXIST AND HAVING
   * RECEIVED THE CHALLENGE RESPONSE**, and those are equivalent only because of properties that
   * live somewhere else entirely: no CORS, a host-only `SameSite` cookie, and a submit step that
   * needs the password. **Any of those could change without anyone thinking about confirmations.**
   * A security property that rests on three unrelated facts is one nobody is maintaining.
   *
   * And `confirmation-v1` states plainly that the client submits the operation *"carrying that
   * `confirmation_id`"* — so a normative sentence was false in the code.
   *
   * IT IS COMPARED, NEVER LOOKED UP. The row is still found by `binding_hash`; this value is
   * checked against the row that lookup returned. Making it a second key would give a caller two
   * ways to reach one row, and the weaker one would eventually be the one somebody queried.
   */
  readonly confirmationId: string;
  /** Server-derived. Carried for retention and accounting; never read during verification. */
  readonly principalId: string;
  /** RFC 3339, UTC. Five minutes from issue. */
  readonly expiresAt: string;
};

export type ConfirmationStore = {
  /**
   * Writes an unspent confirmation.
   *
   * The reservation is `0014` §A.11 at this boundary: a receipt for daily D1 write capacity that
   * has ALREADY been charged. There is no overload without one, exactly as there is none on
   * `createSession`.
   *
   * A DUPLICATE `bindingHash` IS NOT AN ERROR WORTH DISTINGUISHING. The same principal, on the
   * same session, requesting the same operation on the same parameters twice produces the same
   * hash — which is a human clicking twice, not an attack. The adapter upserts, so the second
   * request refreshes the expiry rather than failing. Two rows could not exist anyway: the hash
   * is the primary key.
   */
  issue(record: ConfirmationRecord, reservation: ControlPlaneWriteReservation): Promise<Result<void>>;

  /**
   * ===========================================================================================
   * ATOMICALLY marks a confirmation spent and reports whether THIS call is the one that spent it.
   * ===========================================================================================
   *
   * `true` MEANS THIS REQUEST TOOK IT. `false` means the token did not match, the binding did not
   * match, it was already spent, or it has expired — **four causes and one answer**, which is the
   * collapse this path wants: a caller learns its confirmation is unusable and nothing about which.
   *
   * THE IMPLEMENTATION IS ONE STATEMENT AND THAT IS NORMATIVE, NOT AN OPTIMISATION:
   *
   *     UPDATE confirmation SET spent_at = ?
   *      WHERE binding_hash = ? AND confirmation_id = ? AND spent_at IS NULL AND expires_at > ?
   *     RETURNING binding_hash
   *
   * The expiry is compared IN THE STATEMENT rather than in TypeScript above it, because a
   * comparison above it is a read-then-write with extra steps.
   *
   * **`confirmation_id` IS IN THE SAME `WHERE` FOR THE SAME REASON.** Comparing the token above
   * this call would be a read-then-write; comparing it below would be comparing a value from a row
   * that had already been spent. One statement, four conditions, one answer.
   *
   * IT IS CALLED EVEN WHEN THE OPERATION WILL FAIL, and the ordering is the contract's: SPENT ON
   * FIRST USE, ATOMICALLY, WHETHER OR NOT THE OPERATION THEN SUCCEEDS. A confirmation that
   * survived a failed operation would be retryable, and an attacker able to cause a failure could
   * reuse it. The cost is accepted: a transient store failure forces the human to confirm again.
   */
  spend(
    bindingHash: string,
    confirmationId: string,
    nowIso: string,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<boolean>>;
};
