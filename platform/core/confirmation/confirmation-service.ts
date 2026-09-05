/**
 * ===========================================================================================
 * THE CONFIRMATION SERVICE. ONE MECHANISM, TWO CALLERS. `docs/decisions/0027` ·
 * contract `confirmation-v1`.
 * ===========================================================================================
 *
 * `confirmation-v1` §whereItLIVES: *"THE MECHANISM IS ONE. THE CHALLENGE ROUTE IS ONE PER EXISTING
 * CLASS THAT CONTAINS A CRITICAL OPERATION, BECAUSE THE CONTEXT DIFFERS EVEN THOUGH THE LOGIC DOES
 * NOT. Both call the same Core confirmation service, WHICH IS WHERE EVERY RULE IN THIS CONTRACT IS
 * ENFORCED."*
 *
 * This file is that service. The Action-class challenge route and the platform-class challenge
 * route differ in how they authenticate and authorize; from here down they are identical, and
 * neither can reach the binding, the expiry or the spend except through these two functions.
 *
 * ===========================================================================================
 * NO NEW REQUEST CLASS, AND NO PER-ACTION OPT-IN
 * ===========================================================================================
 *
 * A route class is defined by what context its handlers receive. CONFIRMATION CHANGES NONE OF
 * THAT: confirming a `DeleteCustomer` needs exactly the context an Action needs, including a
 * tenant; confirming a `credential.reset` needs exactly the context a platform route needs,
 * including the ABSENCE of one. A class containing both would be a class with no consistent
 * context, which is the one thing a class is.
 *
 * And the requirement is derived from the PERMISSION (`critical-permissions.ts`), never declared
 * by an Action — because *"if confirmation is something an Action remembers to require, then the
 * Action that forgets is the dangerous one, and it will look exactly like the ones that did not."*
 *
 * ===========================================================================================
 * WHAT THIS FILE CANNOT DO, WHICH IS WHY THE CHALLENGE ROUTES EXIST AND ARE THIN
 * ===========================================================================================
 *
 * IT DOES NOT AUTHORIZE. `issueChallenge` takes an ALREADY-AUTHORIZED principal and an
 * ALREADY-RESOLVED target. That is not a gap — it is the property that keeps the challenge route
 * from being an oracle:
 *
 *   *"IT RUNS THE FULL AUTHORIZATION OF THE TARGET OPERATION, including its not_found/forbidden
 *   collapse. A caller who could not perform the operation cannot obtain a challenge for it, and
 *   receives the identical refusal."*
 *
 * WITHOUT THAT, THE CHALLENGE ENDPOINT WOULD BE A UNIVERSAL EXISTENCE ORACLE OVER EVERY CRITICAL
 * TARGET IN THE PLATFORM, reachable by anyone with any session — a strictly worse hole than the
 * one confirmation closes. The authorization happens in the caller, because only the caller knows
 * which class it is in; this service is reached after it.
 */

import type { Clock } from '../kernel/clock.ts';
import { toRfc3339Utc } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, forbidden, invalidArgument, quotaExceeded, unavailable } from '../kernel/errors.ts';
import type { ControlPlaneWriteAdmission } from '../identity/control-plane-admission.ts';
import { CONFIRMATION_ROW_WRITES } from '../identity/control-plane-admission.ts';
import type { ConfirmationBinder, ConfirmationParameters } from './binding.ts';
import { canonicalizeParameters } from './binding.ts';
import type { ConfirmationStore } from './confirmation-store.ts';
import { requiresConfirmation } from './critical-permissions.ts';
import type { StatementLocale } from './statements.ts';
import { renderStatement } from './statements.ts';

/**
 * FIVE MINUTES. `confirmation-v1` §lifecycle, per D15's "short-lived".
 *
 * LONG ENOUGH TO READ A STATEMENT AND TYPE A PASSWORD, SHORT ENOUGH THAT AN ABANDONED CONFIRMATION
 * ON AN UNLOCKED SCREEN IS NOT A STANDING AUTHORITY. It is a UI-scale duration because the
 * mechanism is a UI-scale interaction; **anything measured in hours is a session upgrade wearing a
 * nonce**, which D15 forbids by name.
 */
export const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1000;

export type ConfirmationChallenge = {
  readonly confirmationId: string;
  readonly statement: string;
  readonly statementLocale: StatementLocale;
  readonly expiresAt: string;
};

export type IssueChallengeInput = {
  /** Server-derived from a verified session credential. Never a request field. */
  readonly principalId: string;
  /** The session the confirmation is bound to, so it dies with the session. */
  readonly sessionId: string;
  /** The operation being confirmed, as the caller's own registry resolved it. */
  readonly actionId: string;
  /**
   * The permission the target operation declares. THE CONFIRMATION REQUIREMENT IS DERIVED FROM
   * THIS and never from the Action's own `sensitivity` field.
   */
  readonly permissionId: string;
  readonly parameters: ConfirmationParameters;
  readonly locale: StatementLocale;
};

export type VerifyConfirmationInput = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly actionId: string;
  readonly parameters: ConfirmationParameters;
  /** The value the caller presented. Compared by RECOMPUTING the binding, never by lookup. */
  readonly confirmationId: string;
};

export type ConfirmationService = {
  issueChallenge(input: IssueChallengeInput): Promise<Result<ConfirmationChallenge>>;
  /**
   * Recomputes the binding, spends it atomically, and reports success.
   *
   * IT DOES NOT VERIFY THE RE-AUTHENTICATION. That is the caller's step, performed with
   * `credential-verifier.ts` and ITS EQUAL-WORK PROPERTY — see the pipeline. Splitting them keeps
   * the credential path in the one module that has been measured for equal work, rather than
   * reproducing it here where nobody would think to measure it.
   */
  verifyAndSpend(input: VerifyConfirmationInput): Promise<Result<void>>;
};

export type ConfirmationServiceDependencies = {
  readonly store: ConfirmationStore;
  readonly binder: ConfirmationBinder;
  readonly admission: ControlPlaneWriteAdmission;
  readonly ids: IdGenerator;
  readonly clock: Clock;
};

export function createConfirmationService(
  dependencies: ConfirmationServiceDependencies,
): ConfirmationService {
  const { store, binder, admission, ids, clock } = dependencies;

  return {
    async issueChallenge(input): Promise<Result<ConfirmationChallenge>> {
      // ---- A CHALLENGE FOR A NON-CRITICAL OPERATION IS REFUSED, NOT GRANTED.
      //
      // `confirmation-v1`: "A confirmation for a non-critical action would be a token nothing
      // consumes, and issuing one invites a client to attach it to everything." A client that
      // learned to attach a confirmation to every request would make the field meaningless on the
      // requests where it matters.
      if (!requiresConfirmation(input.permissionId)) {
        return err(invalidArgument([detail('action_id', 'not_a_critical_operation')]));
      }

      // ---- Canonicalise BEFORE anything is written or rendered. An invalid parameter set is
      // refused HERE rather than at submission, so a human is never shown a statement about an
      // operation that could not have run.
      const canonical = canonicalizeParameters(input.parameters);
      if (!canonical.ok) {
        return err(canonical.error);
      }

      // ---- The statement, composed by Core in the caller's locale. A missing template refuses;
      // see `statements.ts` for why a generic fallback would defeat D15.
      const rendered = renderStatement(input.actionId, input.parameters, input.locale);
      if (!rendered.ok) {
        return err(rendered.error);
      }

      const nowMs = clock.nowMs();
      const bindingHash = await binder.bind({
        principalId: input.principalId,
        sessionId: input.sessionId,
        actionId: input.actionId,
        canonicalParameters: canonical.value,
      });

      const admitted = await admission.reserve({
        principalId: input.principalId,
        estimatedRowWrites: CONFIRMATION_ROW_WRITES,
        nowMs,
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        // The challenge route is a WRITE, and the daily ceiling can refuse it. `quota_exceeded` is
        // a declared error on both challenge routes, unlike the platform-operator audit path where
        // it is not — so it is reported honestly here rather than collapsed to `unavailable`.
        return err(quotaExceeded());
      }

      const expiresAt = toRfc3339Utc(nowMs + CONFIRMATION_LIFETIME_MS);
      // GENERATED BEFORE THE WRITE AND STORED WITH IT. The first version generated this in the
      // response object and stored nothing, which made it decorative — see `ConfirmationRecord`.
      const confirmationId = ids.generate();
      const written = await store.issue(
        { bindingHash, confirmationId, principalId: input.principalId, expiresAt },
        admitted.value.reservation,
      );
      if (!written.ok) {
        return err(written.error);
      }

      return ok({
        // OPAQUE, SERVER-GENERATED, AND **NOT** THE BINDING. The stored row is keyed by the HMAC,
        // so possession of this value authorises nothing unless principal, session, action and
        // parameters all match at submission. A leaked confirmation_id is useless to anyone but
        // the session that obtained it.
        //
        // IT IS DELIBERATELY NOT THE BINDING HASH ITSELF. Returning the hash would hand a caller
        // the output of a keyed function over values it controls, which is a chosen-message oracle
        // against the confirmation key — cheap to avoid, and expensive to discover later.
        confirmationId,
        statement: rendered.value.statement,
        statementLocale: rendered.value.locale,
        expiresAt,
      });
    },

    async verifyAndSpend(input): Promise<Result<void>> {
      const canonical = canonicalizeParameters(input.parameters);
      if (!canonical.ok) {
        return err(canonical.error);
      }

      // =====================================================================================
      // THE BINDING IS RECOMPUTED, NOT LOOKED UP. THIS IS THE CENTRAL PROPERTY OF THE CONTRACT.
      // =====================================================================================
      //
      // A caller who confirmed "delete customer X" and submits "delete customer Y" produces a
      // DIFFERENT HASH, which simply does not find a row. There is no comparison step to get
      // wrong, no field to forget, and no code path where the check is skipped because the values
      // "looked right".
      //
      // THE SAME IS TRUE OF THE PRINCIPAL, THE SESSION AND THE ACTION. Substitution of any of the
      // four fails identically and for the same reason — not because four `if`s agree, but because
      // there is one input to one function.
      const bindingHash = await binder.bind({
        principalId: input.principalId,
        sessionId: input.sessionId,
        actionId: input.actionId,
        canonicalParameters: canonical.value,
      });

      const nowMs = clock.nowMs();
      const admitted = await admission.reserve({
        principalId: input.principalId,
        estimatedRowWrites: CONFIRMATION_ROW_WRITES,
        nowMs,
      });
      if (!admitted.ok) {
        return err(admitted.error);
      }
      if (admitted.value.kind === 'deferred') {
        // THE OPERATION IS REFUSED RATHER THAN PERFORMED UNCONFIRMED. An exhausted budget must
        // never become a reason to skip the gate — that is `0013` D2's "must not fail open"
        // applied to the elevation mechanism itself.
        return err(quotaExceeded());
      }

      // THE PRESENTED TOKEN IS PASSED IN AND COMPARED INSIDE THE UPDATE. It is NOT used to find
      // the row — the binding hash is — so a caller cannot reach a confirmation by guessing a
      // token, and cannot reach one by guessing a binding without also holding the token.
      const spent = await store.spend(
        bindingHash,
        input.confirmationId,
        toRfc3339Utc(nowMs),
        admitted.value.reservation,
      );
      if (!spent.ok) {
        return err(spent.error);
      }
      if (!spent.value) {
        // NOT SPENT BY THIS CALL: the token did not match, the binding did not match, it was
        // already used, or it expired. ONE ANSWER FOR ALL FOUR, and `forbidden()` takes no
        // arguments so there is nothing here to vary.
        //
        // `forbidden` RATHER THAN `not_found`, and the choice is about which neighbour this hides
        // among: on the operation's own route a missing confirmation is an authorization failure,
        // and the caller has already passed authentication and permission checks. `not_found`
        // would suggest the TARGET does not exist, which is a statement about a record.
        return err(forbidden());
      }
      return ok(undefined);
    },
  };
}

/**
 * The refusal a critical operation receives when confirmation is not composed at all.
 *
 * IT IS `unavailable`, NOT `forbidden`, AND THE DISTINCTION IS DELIBERATE. A missing composition is
 * a deployment defect, not a decision about the caller — and reporting it as `forbidden` would
 * tell an operator their permissions were wrong while the real cause was a Worker started without
 * a confirmation store. The operation is refused either way; only the diagnosis differs.
 */
export function confirmationUnavailable(): ReturnType<typeof unavailable> {
  return unavailable();
}
