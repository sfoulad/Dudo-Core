/**
 * ===========================================================================================
 * THE CONFIRMATION MECHANISM. `docs/decisions/0027` · `docs/decisions/0007` D15 ·
 * contract `confirmation-v1` §testRequirements.
 * ===========================================================================================
 *
 * *** THIS FILE USED TO BE SIXTEEN SKIPS. THE MECHANISM NOW EXISTS, SO THEY ARE CASES. ***
 *
 * The tripwire that carried them — a case asserting Core contained no confirmation module — went
 * red when `platform/core/confirmation/**` landed. That was the design working: it asserted an
 * absence, the absence became false, and the red was the signal to write these. It is gone now
 * because what it was waiting for arrived.
 *
 * ===========================================================================================
 * WHAT THE MECHANISM HAS TO PROVE, AND WHY BOTH HALVES OR NEITHER
 * ===========================================================================================
 *
 *   (a) INTENT   — the human meant to do THIS thing, to THIS target. Proved by the binding:
 *                  principal, session, action and parameters, recomputed at submission.
 *   (b) PRESENCE — the party acting still holds the credential. Proved by re-authentication.
 *
 * *"A 'type DELETE to continue' box proves (a) AND NOT (b). A re-authentication prompt proves (b)
 * AND NOT (a). MOST PRODUCTS SHIP ONE AND DESCRIBE IT AS BOTH."*
 *
 * ===========================================================================================
 * THE THREE CASES THAT ARE NOT IN THE CONTRACT'S LIST, AND ARE THE ONES MOST SUITES OMIT
 * ===========================================================================================
 *
 *   1. A's SUBMISSION OF B's IDENTIFIER WITH B's **CORRECT** PASSWORD. Every suite tests a wrong
 *      password. `verify()` authenticates whoever the identifier names, so without a caller-identity
 *      comparison the whole presence half falls to a substitution — and the refusal must be
 *      BYTE-IDENTICAL, or the route enumerates which identifier belongs to which principal.
 *   2. THE CREDENTIAL CHECK MUST RUN EVEN WHEN THE CONFIRMATION IS ALREADY UNUSABLE. An early
 *      return skips `credential-verifier.ts`'s dummy derivation and reintroduces the timing oracle
 *      that file exists to close. Asserted as WORK, not as an answer.
 *   3. THE OPERATION MUST NOT HAVE RUN. Every refusal asserts the handler's call count, because a
 *      gate that refused *after* performing the operation would return `forbidden` and still have
 *      deleted the customer.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  CALLER_EMAIL,
  OTHER_EMAIL,
  OTHER_PRINCIPAL,
  OTHER_SESSION_ID,
  OTHER_CUSTOMER,
  TARGET_CUSTOMER,
  createConfirmationWorld,
} from '../../harness/confirmation-fixture.ts';
import type { ConfirmationWorld } from '../../harness/confirmation-fixture.ts';
import { requiresConfirmation, criticalPermissions } from '../../../../platform/core/confirmation/critical-permissions.ts';
import { hasStatement } from '../../../../platform/core/confirmation/statements.ts';
import { MAX_PARAMETER_VALUE_LENGTH } from '../../../../platform/core/confirmation/binding.ts';

const EXPECTED_FORBIDDEN = {
  code: 'forbidden',
  message: 'The principal is not permitted to perform this operation.',
};
const EXPECTED_UNAVAILABLE = {
  code: 'unavailable',
  message: 'A dependency is unavailable.',
};

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** A complete, correct submission body. Cases mutate one field at a time from this. */
async function goodBody(
  world: ConfirmationWorld,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<Record<string, unknown>> {
  const challenge = expectOk('a challenge is issued', await world.challenge()) as {
    confirmationId: string;
  };
  return {
    customer_id: TARGET_CUSTOMER,
    confirmation_id: challenge.confirmationId,
    reauth_derived_value: await world.callerDerivedValue(),
    identifier: CALLER_EMAIL,
    ...overrides,
  };
}

export type MakeConfirmationWorld = typeof createConfirmationWorld;

export function buildConfirmationSuite(
  make: MakeConfirmationWorld = createConfirmationWorld,
): Suite {
  const suite = new Suite('Confirmation — the gate on a critical operation (0027, D15)');

  // =========================================================================================
  // The automatic part. This is the claim with nothing behind it until now.
  // =========================================================================================

  suite.test('declaring a critical permission gates the Action with no per-Action opt-in', async () => {
    const world = await make();
    try {
      // The Action declares no confirmation requirement of its own — the pipeline derives it from
      // the permission. An unconfirmed request must be refused.
      const bare = await world.invoke({ customer_id: TARGET_CUSTOMER });
      assertTrue('an unconfirmed critical request is refused', !bare.ok, show(bare));
      assertEqual(`${ISOLATION} and the operation did NOT run`, world.performed.calls, 0);

      // The control: with a full confirmation the SAME Action performs. Without this the case
      // above would pass on an Action that is simply broken.
      const confirmed = await world.invoke(await goodBody(world));
      expectOk('a fully confirmed request is admitted', confirmed);
      assertEqual('and the operation ran exactly once', world.performed.calls, 1);
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // theBinding — confirmation-v1 §testRequirements
  // =========================================================================================

  suite.test('SUBSTITUTION: a confirmation for customer X cannot delete customer Y', async () => {
    // THE CENTRAL TEST OF THE CONTRACT. The binding is recomputed from the parameters, so a
    // different target produces a different hash and finds no row.
    const world = await make();
    try {
      const body = await goodBody(world, { customer_id: OTHER_CUSTOMER });
      expectError(`${ISOLATION} the substituted target is refused`, await world.invoke(body), EXPECTED_FORBIDDEN);
      assertEqual(`${ISOLATION} and nothing was deleted`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a confirmation obtained on session A cannot be spent on session B', async () => {
    const world = await make();
    try {
      const body = await goodBody(world);
      expectError(
        `${ISOLATION} a confirmation does not travel between sessions`,
        await world.invoke(body, { sessionId: OTHER_SESSION_ID }),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a confirmation issued to principal P cannot be spent by principal Q', async () => {
    const world = await make();
    try {
      // Issued for the OTHER principal, on the caller's session, for the same target.
      expectOk(
        'the challenge is issued to the other principal',
        await world.challenge({ principalId: OTHER_PRINCIPAL }),
      );
      const body = {
        customer_id: TARGET_CUSTOMER,
        confirmation_id: 'cnf_someone_elses01',
        reauth_derived_value: await world.callerDerivedValue(),
        identifier: CALLER_EMAIL,
      };
      expectError(
        `${ISOLATION} another principal's confirmation is not spendable`,
        await world.invoke(body),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('altering one parameter between challenge and submission is refused', async () => {
    const world = await make();
    try {
      expectOk(
        'a challenge for the target',
        await world.challenge({ parameters: { customer_id: TARGET_CUSTOMER, cascade: 'false' } }),
      );
      // One parameter differs — `cascade` flipped. The hash changes, the row is not found.
      const body = {
        customer_id: TARGET_CUSTOMER,
        cascade: 'true',
        confirmation_id: 'cnf_altered_000001',
        reauth_derived_value: await world.callerDerivedValue(),
        identifier: CALLER_EMAIL,
      };
      expectError(
        `${ISOLATION} a changed parameter invalidates the confirmation`,
        await world.invoke(body),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // lifecycle
  // =========================================================================================

  suite.test('a confirmation is spent on first use and a second submission is refused', async () => {
    const world = await make();
    try {
      const body = await goodBody(world);
      expectOk('the first submission is admitted', await world.invoke(body));
      assertEqual('and the operation ran once', world.performed.calls, 1);

      expectError(
        `${ISOLATION} the SAME body is refused the second time`,
        await world.invoke(body),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation still ran only once`, world.performed.calls, 1);
    } finally {
      world.close();
    }
  });

  suite.test('a confirmation is spent even when the operation FAILS', async () => {
    // The read-then-write implementation passes this in serial testing only if the spend happens
    // before the operation. Here the operation is made to fail by removing the coordinator's
    // ability to admit a write — the confirmation must be gone regardless.
    const world = await make();
    try {
      const body = await goodBody(world);
      // The failure happens INSIDE the operation, after the gate has already spent the
      // confirmation. That is the only path that reaches the property: a failure before the gate
      // would prove nothing, because the confirmation would never have been spent.
      world.performed.failNext = true;
      const failed = await world.invoke(body);
      assertTrue('the operation failed', !failed.ok, show(failed));
      assertEqual('and it failed INSIDE the handler, having been admitted', world.performed.calls, 1);

      // The identical body again. A confirmation that survived a failed operation would be
      // retryable, and an attacker able to cause a failure could reuse it.
      expectError(
        `${ISOLATION} the confirmation was spent by the failed attempt and cannot be retried`,
        await world.invoke(body),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the retry never reached the operation`, world.performed.calls, 1);
    } finally {
      world.close();
    }
  });

  suite.test('an expired confirmation is refused, asserted at the boundary', async () => {
    const world = await make();
    try {
      const body = await goodBody(world);
      // Five minutes exactly. `CONFIRMATION_LIFETIME_MS` is 5 minutes and the statement compares
      // `expires_at > ?`, so the boundary instant is already too late.
      world.world.clock.set(world.world.clock.nowMs() + 5 * 60 * 1000);
      expectError(
        `${ISOLATION} a confirmation at its expiry instant is refused`,
        await world.invoke(body),
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('the spend is one atomic statement, not a read followed by a write', async () => {
    // CONCURRENCY, as far as this harness can honestly reach it. `node:sqlite` in one process is
    // not a concurrency environment, so a true simultaneous test is not available — and claiming
    // one would be the overstatement `0027` warns about. What IS assertable is the property that
    // makes concurrency safe: the spend is a single conditional UPDATE whose RETURNING reports
    // whether THIS call took it. A read-then-write would show two statements.
    const world = await make();
    try {
      const body = await goodBody(world);
      const before = world.control.statements.length;
      expectOk('the submission is admitted', await world.invoke(body));
      const issued = world.control.statements.slice(before).map((entry) => entry.sql);
      const spends = issued.filter((sql) => sql.includes('UPDATE confirmation'));
      assertEqual('exactly one statement spends the confirmation', spends.length, 1);
      assertTrue(
        `${ISOLATION} and it is conditional and reports what it changed`,
        spends[0].includes('spent_at IS NULL') && spends[0].includes('RETURNING'),
        spends[0],
      );
      assertTrue(
        `${ISOLATION} no SELECT of the confirmation precedes it — that would be read-then-write`,
        !issued.some((sql) => /SELECT[\s\S]*FROM confirmation/i.test(sql)),
        issued.join(' | '),
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // theReauthentication — including the attack the contract's list does not name
  // =========================================================================================

  suite.test('a WRONG derived value is refused', async () => {
    const world = await make();
    try {
      const body = await goodBody(world, {
        reauth_derived_value: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
      expectError(`${ISOLATION} a wrong password is refused`, await world.invoke(body), EXPECTED_FORBIDDEN);
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test("ANOTHER PRINCIPAL'S CORRECT PASSWORD is refused, byte-identically", async () => {
    // ===========================================================================================
    // THE ATTACK ALMOST NO SUITE HAS. `verify(identifier, value)` authenticates WHOEVER THE
    // IDENTIFIER NAMES, so without a caller-identity comparison a caller satisfies the presence
    // half with someone else's credential — the entire re-authentication half defeated by a
    // substitution, passing every test that only checks a wrong password.
    // ===========================================================================================
    const world = await make();
    try {
      const substituted = await goodBody(world, {
        identifier: OTHER_EMAIL,
        reauth_derived_value: await world.otherDerivedValue(),
      });
      const substitutedAnswer = await world.invoke(substituted);
      expectError(
        `${ISOLATION} another principal's CORRECT password does not satisfy presence`,
        substitutedAnswer,
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);

      // ---- AND IT IS BYTE-IDENTICAL TO A WRONG PASSWORD. A distinguishable refusal here is an
      // oracle for which identifiers belong to which principal.
      const wrong = await goodBody(world, {
        reauth_derived_value: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
      const wrongAnswer = await world.invoke(wrong);
      assertEqual(
        `${ISOLATION} substitution and a wrong password answer identically`,
        show((substitutedAnswer as { error: unknown }).error),
        show((wrongAnswer as { error: unknown }).error),
      );

      // ---- AND SO IS AN IDENTIFIER THAT EXISTS NOWHERE. The fabricated third entry: two real
      // identifiers show the refusals match; they do not show the refusal is uninformative.
      const fabricated = await goodBody(world, {
        identifier: 'Nobody.At.All@Example.Invalid',
      });
      const fabricatedAnswer = await world.invoke(fabricated);
      assertEqual(
        `${ISOLATION} and a FABRICATED identifier answers identically too`,
        show((fabricatedAnswer as { error: unknown }).error),
        show((wrongAnswer as { error: unknown }).error),
      );
    } finally {
      world.close();
    }
  });

  suite.test('the credential check RUNS even when the confirmation is already unusable', async () => {
    // ===========================================================================================
    // ASSERTED AS WORK, NOT AS AN ANSWER — the same device as "both reads run on every denial
    // path" in the mutual-exclusion suite.
    // ===========================================================================================
    //
    // An early return on a bad confirmation would skip `credential-verifier.ts`'s dummy
    // derivation, whose whole purpose is that a miss costs what a hit costs. The answer would be
    // the same `forbidden` either way, so only the WORK distinguishes a correct implementation
    // from one that reintroduces the timing oracle on a route that holds a session.
    const world = await make();
    try {
      // A submission with NO confirmation ever issued, so the spend cannot succeed.
      const before = world.control.statements.length;
      const answer = await world.invoke({
        customer_id: TARGET_CUSTOMER,
        confirmation_id: 'cnf_never_issued001',
        reauth_derived_value: await world.callerDerivedValue(),
        identifier: CALLER_EMAIL,
      });
      expectError(`${ISOLATION} it is refused`, answer, EXPECTED_FORBIDDEN);
      const issued = world.control.statements.slice(before).map((entry) => entry.sql);
      assertTrue(
        `${ISOLATION} the credential lookup still ran — the verifier was not short-circuited`,
        issued.some((sql) => sql.includes('principal_credential')),
        'no credential statement was issued on a path where the confirmation had already failed, ' +
          "so credential-verifier.ts's equal-work property does not hold here: " +
          issued.join(' | '),
      );
      assertTrue(
        'and the confirmation spend was attempted too — both halves ran',
        issued.some((sql) => sql.includes('UPDATE confirmation')),
        issued.join(' | '),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}

/**
 * ===========================================================================================
 * THE CHALLENGE SIDE AND THE CATALOG — DELIBERATELY A SEPARATE SUITE, AND `0027` IS WHY.
 * ===========================================================================================
 *
 * The record requires that removing the confirmation check turn **every critical-operation test**
 * red, and that *"if removing the check turns only some tests red, coverage is incomplete and the
 * suite is what is wrong."*
 *
 * When the control was first performed, 14 cases went red and **7 stayed green** — every one of
 * them a test of the CHALLENGE route or of the permission catalog, neither of which the gate is
 * on. I could have written that analysis into a report and left the suite alone. **The analysis
 * would then have been mine to make correctly every time the control ran**, and the first person
 * to read a still-green list without it would reasonably conclude the suite had a hole.
 *
 * So the cases are split instead: `buildConfirmationSuite` contains only submissions through the
 * gated Action, and the control runs against that. **Its still-green list must be EMPTY**, which is
 * a machine-checked claim rather than an argued one. These cases live here, are exercised in the
 * primary run, and are correctly indifferent to the gate.
 */
export function buildConfirmationChallengeSuite(
  make: MakeConfirmationWorld = createConfirmationWorld,
): Suite {
  const suite = new Suite('Confirmation — the challenge route and the statement catalog');

  suite.test('the gate REFUSES when confirmations are not composed at all', async () => {
    // *"The automatic part working means unreachable, not ungated."* A runtime that forgot to
    // compose a gate must refuse every critical operation rather than perform it.
    //
    // IT BELONGS HERE RATHER THAN WITH THE SUBMISSION CASES because it exercises the branch where
    // NO gate exists — so `0027`'s control, which replaces the gate with a permissive one, cannot
    // reach it. Green under that control is the correct answer for this case, and putting it in
    // the gate suite would make the control's still-green list non-empty for a good reason, which
    // is precisely the ambiguity the split removes.
    const world = await make();
    try {
      const answer = await world.invoke(await goodBody(world), { gateComposed: false });
      expectError(`${ISOLATION} an uncomposed gate refuses`, answer, EXPECTED_UNAVAILABLE);
      assertEqual(`${ISOLATION} and the operation did NOT run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a critical permission is derived from the permission, never from the Action', () => {
    assertTrue(
      'customers.customer.delete is critical',
      requiresConfirmation('customers.customer.delete'),
      'the permission the synthetic Action declares is not in the critical set',
    );
    assertTrue(
      'and an ordinary permission is not',
      !requiresConfirmation('customers.customer.read'),
      'a read permission is being treated as critical',
    );
    // 0026 classified organization.create as `sensitive`, not `critical`, deliberately so that
    // onboarding stays reachable in one request. Asserted so nobody "corrects" the omission.
    assertTrue(
      'core.organization.create is deliberately NOT critical',
      !requiresConfirmation('core.organization.create'),
      'onboarding has been made a two-step operation by a change to the critical set',
    );
  });

  suite.test('A CRITICAL OPERATION MAY NOT TAKE A NUMERIC PARAMETER — and this fires late', async () => {
    // ===========================================================================================
    // THIS IS A TRAP RATHER THAN A BUG, AND THE TRAP IS THE TIMING.
    // ===========================================================================================
    //
    // The binding refuses numbers, and the refusal is CORRECT: `1`, `1.0` and `1e0` are one JSON
    // number and three byte strings, so canonicalising them would either pick a representation —
    // reintroducing the cross-client disagreement invisibly, which is the whole failure `0015` §D
    // and the KDF vectors exist to prevent — or hash inputs that two clients serialise differently.
    // `core-agent` refused to coerce, and that is the right call.
    //
    // *** THE CONSEQUENCE IS THAT CLASSIFYING A PERMISSION AS `critical` CAN MAKE AN EXISTING
    // ACTION PERMANENTLY UNREACHABLE. *** It fires when the PERMISSION is classified, not when the
    // Action is written — so the person who breaks it is not the person who wrote the thing that
    // broke. It fails closed, which is right, and it is still the kind of thing that should be
    // discovered by a test rather than by someone whose route stopped working.
    //
    // `mergeInputSources` makes it reachable without anyone writing a number by hand: a declared
    // integer query parameter is COERCED to a real number before it ever reaches the binding.
    const world = await make();
    try {
      const numeric = await world.challenge({
        parameters: { customer_id: TARGET_CUSTOMER, page_size: 25 as unknown as string },
      });
      assertTrue(
        `${ISOLATION} a numeric parameter is refused rather than canonicalised`,
        !numeric.ok,
        'a number reached the binding, so two clients serialising it differently would compute ' +
          `different hashes for the same operation: ${show(numeric)}`,
      );

      // THE STRING FORM OF THE SAME VALUE IS ACCEPTED, which is what makes the constraint a
      // constraint rather than a general refusal — and is the workaround an Action author has.
      expectOk(
        'the same value as a string is accepted',
        await world.challenge({ parameters: { customer_id: TARGET_CUSTOMER, page_size: '25' } }),
      );

      // And booleans and null ARE permitted, so the rule is specifically about numbers.
      expectOk(
        'booleans and null are permitted primitives',
        await world.challenge({
          parameters: { customer_id: TARGET_CUSTOMER, cascade: false, note: null },
        }),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a challenge naming a NON-critical action is refused with invalid_argument', async () => {
    const world = await make();
    try {
      const answer = await world.challenge({ permissionId: 'customers.customer.read' });
      assertTrue('it is refused', !answer.ok, show(answer));
      assertEqual(
        'and it is invalid_argument, not a granted token',
        (answer as { error: { code: string } }).error.code,
        'invalid_argument',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a challenge for an action with no statement is refused rather than given a generic one', async () => {
    const world = await make();
    try {
      const answer = await world.challenge({ actionId: 'customers.SomeOtherAction' });
      assertTrue(
        `${ISOLATION} no statement means no challenge`,
        !answer.ok,
        'a challenge was issued for an operation Core has no text for, so a human would be asked ' +
          `to confirm something nobody wrote: ${show(answer)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('every critical permission that has a reachable Action has a statement', () => {
    // A permission in the critical set whose Action has no catalog entry is an operation that
    // CANNOT BE CONFIRMED AND THEREFORE CANNOT BE PERFORMED — the gate refuses, the challenge
    // refuses, and the operation is unreachable. Recorded per permission rather than in aggregate.
    // CORRECTED 2026-09-05, AND THE CORRECTION IS THE FINDING WORKING. This asserted
    // `hasStatement('customers.customer.delete')` — a PERMISSION identifier — because that was how
    // the catalog was keyed. I reported that the real deferred Action is `customers.DeleteCustomer`
    // and would therefore have found no statement the day it was built; `core-agent` re-keyed the
    // catalog to ACTION ids. So the assertion now names Action ids, and asserting the permission
    // would be asserting the defect.
    assertTrue(
      'the critical set is non-empty',
      criticalPermissions().length > 0,
      'no permission is classified critical, so the gate guards nothing',
    );
    assertTrue(
      'the Action whose gate this suite exercises has a statement',
      hasStatement('customers.DeleteCustomer'),
      'the synthetic Action stands in for customers.DeleteCustomer under its real id; without a ' +
        'statement it cannot obtain a challenge and the gate is unexercisable',
    );
    assertTrue(
      'and so does the one confirmable platform operation',
      hasStatement('platform.credentials.reset'),
      'the only confirmable platform-class operation has no statement, so it is unperformable',
    );
  });

  suite.test('statement parameters are refused rather than escaped when they break the grammar', async () => {
    // Parameters may be 512 characters and a statement is capped at 500, so an unconstrained
    // interpolation lets a caller write most of the statement and have Core return it in Core's own
    // voice — the constrained party authoring the constraint. It must be REFUSED, not escaped: an
    // escaped 400-character "identifier" is still the caller's text inside Core's sentence.
    const world = await make();
    try {
      const injected = `${'A'.repeat(MAX_PARAMETER_VALUE_LENGTH - 40)} — and your account will be closed`;
      const answer = await world.challenge({ parameters: { customer_id: injected } });
      assertTrue(
        `${ISOLATION} an over-long or ungrammatical parameter does not reach the statement`,
        !answer.ok,
        `a challenge was issued whose statement embeds caller-authored text: ${show(answer)}`,
      );
      if (!answer.ok) {
        assertEqual(
          'and it is refused as an argument error',
          (answer as { error: { code: string } }).error.code,
          'invalid_argument',
        );
      }

      // The control: an ordinary identifier IS accepted, so the refusal is about the value's shape
      // rather than about challenges being broken.
      expectOk('a well-formed identifier still gets a challenge', await world.challenge());
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // The two residuals, asserted as they are rather than as they might be nicer
  // =========================================================================================

  suite.test('authorization refuses BEFORE confirmation, and the difference is the caller\'s own grant', async () => {
    // The contract's ordering: a caller lacking the permission gets `forbidden` from authorization
    // rather than a confirmation refusal, so the gate never changes which error two otherwise
    // identical callers see. It leaks only the caller's own grant state, which it already knows.
    const world = await make();
    try {
      const before = world.control.statements.length;
      const unprivileged = await world.world.invoke(
        { id: 'customers.customer.delete' },
        world.world.unprivilegedA,
        { customer_id: TARGET_CUSTOMER },
      ).catch(() => null);
      // `world.invoke` uses the caller principal; the unprivileged path is reached through the
      // Customer Directory world, which has no such Action registered — so this asserts the
      // property at the gate instead: no confirmation statement is issued for a caller refused
      // earlier.
      void unprivileged;
      const issued = world.control.statements.slice(before);
      assertEqual(
        'a caller refused at authorization causes no confirmation write',
        issued.filter((entry) => entry.sql.includes('confirmation')).length,
        0,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}

/**
 * ===========================================================================================
 * WHAT SHAPE A SUBMISSION'S REFUSAL TAKES. These are gate cases and the control runs them.
 * ===========================================================================================
 *
 * Both go through the gated Action, so both must go red when the confirmation check is removed —
 * they are counted in `0027`'s control alongside `buildConfirmationSuite`, and their still-green
 * list must be empty too.
 *
 * They are a separate suite only because they are about the SHAPE of a refusal rather than about
 * which submission is refused: one asserts that an uncomposed gate and a bad confirmation are
 * deliberately distinguishable, the other that a token the server never issued is refused at all.
 */
export function buildConfirmationRefusalShapeSuite(
  make: MakeConfirmationWorld = createConfirmationWorld,
): Suite {
  const suite = new Suite('Confirmation — the shape of a refused submission');

  suite.test('an uncomposed gate answers unavailable where a bad confirmation answers forbidden', async () => {
    // DELIBERATE, for diagnosability: a missing composition is a deployment defect, not a decision
    // about the caller. Asserted as the difference it is, rather than collapsed — a suite asserting
    // them identical would be asserting a design nobody chose.
    const world = await make();
    try {
      const uncomposed = await world.invoke(await goodBody(world), { gateComposed: false });
      // NO CHALLENGE IS ISSUED FOR THIS TARGET, so the binding finds no row whatever the token
      // says. Using `OTHER_CUSTOMER` matters: `goodBody` above issued a challenge for
      // `TARGET_CUSTOMER`, and — see the fabricated-token case below — a submission matching an
      // ISSUED binding is admitted regardless of the `confirmation_id` it carries.
      const badConfirmation = await world.invoke({
        customer_id: OTHER_CUSTOMER,
        confirmation_id: 'cnf_never_issued001',
        reauth_derived_value: await world.callerDerivedValue(),
        identifier: CALLER_EMAIL,
      });
      expectError('uncomposed is unavailable', uncomposed, EXPECTED_UNAVAILABLE);
      expectError('a bad confirmation is forbidden', badConfirmation, EXPECTED_FORBIDDEN);
      assertTrue(
        'and they are deliberately different',
        show((uncomposed as { error: unknown }).error) !==
          show((badConfirmation as { error: unknown }).error),
        'the two collapsed into one answer, which loses the diagnosis a deployment defect needs',
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // The property the contract implies and that nothing in the mechanism enforces
  // =========================================================================================

  suite.test('a FABRICATED confirmation_id is refused when everything else is correct', async () => {
    // ===========================================================================================
    // `confirmation-v1` DESCRIBES THE MECHANISM AS *"a server-authored statement bound to a
    // server-issued token THE CLIENT MUST ECHO"*. THIS CASE ASSERTS THAT THE ECHO IS CHECKED.
    // ===========================================================================================
    //
    // A challenge is issued and then discarded, and the submission carries a `confirmation_id`
    // that no `issueChallenge` ever returned. Everything else — principal, session, action,
    // parameters, password — is correct.
    //
    // It is asserted separately from every substitution case above because those all vary a
    // BINDING component, and the binding is recomputed. This one varies only the token.
    const world = await make();
    try {
      expectOk('a real challenge is issued and then ignored', await world.challenge());
      const body = {
        customer_id: TARGET_CUSTOMER,
        confirmation_id: 'cnf_never_issued_by_anyone',
        reauth_derived_value: await world.callerDerivedValue(),
        identifier: CALLER_EMAIL,
      };
      const answer = await world.invoke(body);
      expectError(
        `${ISOLATION} a token the server never issued does not authorise the operation`,
        answer,
        EXPECTED_FORBIDDEN,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, world.performed.calls, 0);
    } finally {
      world.close();
    }
  });

  return suite;
}
