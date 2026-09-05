/**
 * ===========================================================================================
 * THE GATE. ONE NON-OPTIONAL POINT THAT EVERY `critical` OPERATION PASSES THROUGH.
 * `docs/decisions/0027` · contract `confirmation-v1`, §whereItLIVES · `0007` D15.
 * ===========================================================================================
 *
 * `confirmation-v1` names the analogy exactly, and it is the right one:
 *
 *   *"IT IS THE SAME DEVICE AS `whereWithTenant`. `sql-compiler.ts` emits the tenant predicate at
 *   ONE point that is 'not optional and takes no flag', and the file argues that 'a rule is a
 *   thing people follow until the day they do not.' A confirmation requirement checked at one
 *   non-optional point in the pipeline has the same property; A CONFIRMATION REQUIREMENT EACH
 *   ACTION DECLARES IS THE RULE PEOPLE FOLLOW UNTIL THE DAY THEY DO NOT."*
 *
 * So this file is called from the Action pipeline and from the platform route class, and from
 * nowhere else. Neither caller can skip it: the requirement is derived from the PERMISSION, by
 * `critical-permissions.ts`, and there is no flag, no override and no per-operation opt-out.
 *
 * ===========================================================================================
 * BOTH HALVES, OR NEITHER. THIS IS THE ERROR THE CONTRACT SAYS EVERY WEAK IMPLEMENTATION MAKES.
 * ===========================================================================================
 *
 *   (a) INTENT   — the human meant to do THIS thing, to THIS target, having been shown what would
 *                  happen. Proved by the binding: the confirmation was issued against exactly this
 *                  principal, session, action and parameter set, and spending it recomputes all
 *                  four.
 *   (b) PRESENCE — the party acting is still the credential holder, not someone holding a stolen
 *                  session or an unattended laptop. Proved by re-authentication.
 *
 * *"A 'type DELETE to continue' box proves (a) AND NOT (b)... A re-authentication prompt proves
 * (b) AND NOT (a)... MOST PRODUCTS SHIP ONE AND DESCRIBE IT AS BOTH."*
 *
 * BOTH ARE CHECKED HERE AND NEITHER CAN BE REACHED WITHOUT THE OTHER, because there is one
 * function and it does both.
 *
 * ===========================================================================================
 * *** THE CALLER-IDENTITY ASSERTION. IT IS PART OF THE MECHANISM, NOT A HARDENING. ***
 * ===========================================================================================
 *
 * `CredentialVerifier.verify(identifier, value)` authenticates WHOEVER THE IDENTIFIER NAMES. So a
 * caller could present **another user's identifier and password** and satisfy re-authentication
 * for its own session — the entire presence half defeated by a substitution, and it would pass
 * every test that only checks "a wrong password is refused".
 *
 * SO THE VERIFIED PRINCIPAL IS COMPARED AGAINST THE CALLING PRINCIPAL, and a mismatch refuses
 * **identically to a wrong password**: the same `forbidden()`, from the same code path, after the
 * same work. A DIFFERENT ERROR HERE WOULD BE AN ORACLE for which identifiers belong to which
 * principal, which is the disclosure `0006` refused a whole column to prevent.
 *
 * ===========================================================================================
 * THE EQUAL-WORK PROPERTY MUST SURVIVE THIS FILE
 * ===========================================================================================
 *
 * `credential-verifier.ts` derives against a dummy record on a miss so that a wrong identifier
 * costs the same as a right one. THAT PROPERTY IS ONLY PRESERVED IF THIS FILE DOES NOT SHORT-
 * CIRCUIT AROUND IT — so re-authentication runs on every path that reaches it, including the one
 * where the confirmation has already been found unusable.
 *
 * SPENDING RUNS FIRST AND ITS RESULT IS HELD, NOT RETURNED. If a bad confirmation returned before
 * the credential check, an attacker holding a session could measure which of the two failed, and
 * the confirmation half would become a probe for valid confirmation identifiers. Both run, then
 * one answer.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, forbidden, invalidArgument } from '../kernel/errors.ts';
import type { CredentialVerifier } from '../identity/credential-verifier.ts';
import type { ConfirmationParameters } from './binding.ts';
import type { ConfirmationService } from './confirmation-service.ts';
import { requiresConfirmation } from './critical-permissions.ts';

/**
 * The three fields every `critical` operation's request body carries.
 *
 * REQUIRED, NOT OPTIONAL. *"An optional confirmation field is a confirmation that can be omitted,
 * and the pipeline would then be refusing a request the schema said was valid — two places
 * deciding one thing."*
 *
 * THEY ARE ON THE BODY AND NOT IN A HEADER, because the parameters are part of the binding, so the
 * confirmation and the parameters it authorises must arrive together, validated by the same schema
 * — and every input-validation rule Core has lives on the body.
 */
export const CONFIRMATION_ID_FIELD = 'confirmation_id';
export const REAUTH_DERIVED_VALUE_FIELD = 'reauth_derived_value';
/**
 * ADDED BY THE 2026-09-05 AMENDMENT, and it is not a convenience.
 *
 * The KDF salt is the caller's normalised identifier, which the CLIENT knows and **the SERVER
 * cannot discover**: `CredentialStore` reaches a credential only by identifier hash, there is no
 * index on `principal_id`, and `0006` deliberately permits a principal to hold SEVERAL credentials
 * under different identifiers — *"what makes an address change possible without a lockout
 * window"*. So "the principal's credential" is not a single row, and iterating candidates would
 * make the work vary with how many a principal holds, destroying the equal-work property on the
 * one path the contract explicitly requires it.
 *
 * `credential-reset-v1`'s `CR-5` is the same defect pointing the other way: there the CONSOLE
 * cannot know the TARGET's identifier. Both come from `0015` §D moving derivation to the client;
 * every route that touches a credential inherits a salt problem and has to solve it separately.
 */
export const REAUTH_IDENTIFIER_FIELD = 'identifier';

const CONFIRMATION_FIELDS: readonly string[] = Object.freeze([
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
]);

/**
 * Splits a submitted body into the confirmation fields and the operation's parameters.
 *
 * ===========================================================================================
 * *** THE PARAMETERS ARE THE SUBMITTED BODY MINUS THESE THREE FIELDS. ***
 * ===========================================================================================
 *
 * The schema says the challenge carries "the exact parameters the confirmed operation will carry"
 * and does not say how a client knows which fields those are on submission. THIS IS THAT RULING,
 * accepted by the Team Lead and going into the contract: **everything that is not a confirmation
 * field is a parameter.**
 *
 * IT IS THE ONLY READING THAT MAKES THE BINDING RECOMPUTABLE. Any other — an allow-list per
 * Action, a nested `parameters` object on submission — puts a second definition of "the
 * parameters" somewhere, and two definitions of the bound value is a binding that covers different
 * things at the two ends.
 *
 * A CLIENT'S OBLIGATION FALLS OUT OF IT AND IS WORTH STATING: the object sent as `parameters` at
 * challenge time must equal the submission body minus these three fields, EXACTLY. A field present
 * at one step and absent at the other changes the hash and the confirmation will not be found.
 */
export function splitConfirmedRequest(
  body: Readonly<Record<string, unknown>>,
): Result<{
  readonly confirmationId: string;
  readonly derivedValue: string;
  readonly identifier: string;
  readonly parameters: ConfirmationParameters;
}> {
  const missing = CONFIRMATION_FIELDS.filter((field) => typeof body[field] !== 'string');
  if (missing.length > 0) {
    // NAMED, because a client that omitted one needs to know which — this is a shape error, not a
    // security decision, and the fields' existence is published in the schema.
    return err(invalidArgument(missing.map((field) => detail(field, 'required'))));
  }
  const parameters: Record<string, string | boolean | null> = Object.create(null);
  for (const [key, value] of Object.entries(body)) {
    if (CONFIRMATION_FIELDS.includes(key)) {
      continue;
    }
    if (value === undefined) {
      // ABSENT, NOT A PARAMETER. `mergeInputSources` can produce an `undefined` for a declared-but-
      // unsupplied field, and an absent field is not something the human confirmed. Treating it as
      // a value would put `undefined` in the binding and make the confirmation unspendable for a
      // reason no error could explain.
      continue;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      parameters[key] = value;
      continue;
    }
    // ===================================================================================
    // A NUMBER, AN OBJECT OR AN ARRAY. REFUSED — AND FOR NUMBERS THIS IS A REAL CONSTRAINT ON
    // CRITICAL OPERATIONS THAT IS WORTH STATING RATHER THAN DISCOVERING.
    // ===================================================================================
    //
    // `canonicalizeParameters` refuses numbers because `1`, `1.0` and `1e0` are one JSON number
    // and three byte strings, so a number in a binding hash fails across clients. That is right,
    // and it has a consequence here: **A CRITICAL OPERATION MAY NOT TAKE A NUMERIC PARAMETER.**
    //
    // The pipeline passes the MERGED input, and `mergeInputSources` coerces declared
    // `integerQueryParams` to real numbers — so an Action with a numeric parameter that is
    // declared critical becomes UNCONFIRMABLE, and therefore unreachable, at request time.
    //
    // THAT IS THE FAIL-CLOSED DIRECTION AND IT IS STILL A TRAP, because it fires when the
    // permission is classified rather than when the Action is written. It is reported rather than
    // worked around: coercing numbers to a canonical string here would reintroduce exactly the
    // cross-client disagreement the refusal exists to prevent, one layer down and invisibly.
    // Numbers belong in a critical operation's parameters as strings.
    return err(invalidArgument([detail(key, 'must_be_a_string_boolean_or_null')]));
  }
  return ok({
    confirmationId: body[CONFIRMATION_ID_FIELD] as string,
    derivedValue: body[REAUTH_DERIVED_VALUE_FIELD] as string,
    identifier: body[REAUTH_IDENTIFIER_FIELD] as string,
    parameters,
  });
}

export type ConfirmationGate = {
  /**
   * Refuses unless BOTH halves hold. Returns `ok` only when the confirmation was spent by this
   * call AND the re-authentication verified the CALLING principal.
   */
  enforce(input: {
    readonly principalId: string;
    readonly sessionId: string | null;
    readonly actionId: string;
    readonly permissionId: string;
    readonly body: Readonly<Record<string, unknown>>;
  }): Promise<Result<void>>;
};

export type ConfirmationGateDependencies = {
  readonly service: ConfirmationService;
  readonly verifier: CredentialVerifier;
};

export function createConfirmationGate(
  dependencies: ConfirmationGateDependencies,
): ConfirmationGate {
  const { service, verifier } = dependencies;

  return {
    async enforce(input): Promise<Result<void>> {
      if (!requiresConfirmation(input.permissionId)) {
        // NOT AN ERROR AND NOT A SKIP — the caller asks the gate about every operation and the
        // gate answers. Putting the question here rather than at the call site is what stops a
        // future call site from asking it differently.
        return ok(undefined);
      }

      // ---- NO SESSION, NO CONFIRMATION. The binding covers the session, so a request that
      // arrived without one CANNOT form a binding at all.
      //
      // IT REFUSES RATHER THAN BINDING TO A PLACEHOLDER. A null session folded into the hash as
      // an empty string would make every sessionless request share one binding namespace, so a
      // confirmation obtained by one such caller would be spendable by another. That is the
      // "optional value in a security check" failure `control-plane-admission.ts` records for
      // `WriteReservation`'s organization, and the answer is the same: refuse.
      if (input.sessionId === null) {
        return err(forbidden());
      }

      const split = splitConfirmedRequest(input.body);
      if (!split.ok) {
        return err(split.error);
      }

      // =====================================================================================
      // BOTH CHECKS RUN. THE FIRST RESULT IS HELD, NOT RETURNED.
      // =====================================================================================
      //
      // Returning early on a bad confirmation would let a caller measure which half failed, and
      // the confirmation half would become a probe for valid confirmation identifiers. It would
      // also skip `credential-verifier.ts`'s dummy derivation, whose entire purpose is that a
      // miss costs what a hit costs — so an early return here reintroduces the timing oracle that
      // file was written to close, on a route that holds a session.
      const spent = await service.verifyAndSpend({
        principalId: input.principalId,
        sessionId: input.sessionId,
        actionId: input.actionId,
        parameters: split.value.parameters,
        confirmationId: split.value.confirmationId,
      });

      const verified = await verifier.verify(split.value.identifier, split.value.derivedValue);

      // ---- A STORE FAILURE IS REPORTED AS ITSELF. `unavailable` is a Dudo-side fault and
      // collapsing it into `forbidden` would tell an operator their confirmation was rejected
      // when the database was unreachable. The operation is refused either way.
      if (!verified.ok) {
        return err(verified.error);
      }
      if (!spent.ok && spent.error.code !== 'forbidden') {
        return err(spent.error);
      }

      // =====================================================================================
      // ONE ANSWER FOR THREE FAILURES: an unusable confirmation, a wrong password, and a password
      // that belongs to SOMEBODY ELSE.
      // =====================================================================================
      //
      // THE THIRD IS THE ONE THAT MATTERS AND IT IS WHY THE COMPARISON EXISTS. `verify`
      // authenticates whoever the identifier names, so without it a caller could present another
      // user's identifier and password and satisfy the presence half for its own session — the
      // whole re-authentication half defeated by a substitution.
      //
      // `forbidden()` TAKES NO ARGUMENTS, so there is nothing here to vary and no way for a caller
      // to learn which of the three refused it. In particular a caller cannot use this route to
      // discover which identifiers belong to which principal.
      const presenceHolds =
        verified.value.kind === 'verified' && verified.value.principalId === input.principalId;
      if (!spent.ok || !presenceHolds) {
        return err(forbidden());
      }
      return ok(undefined);
    },
  };
}
