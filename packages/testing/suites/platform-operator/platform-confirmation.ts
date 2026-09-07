/**
 * ===========================================================================================
 * THE CONFIRMATION GATE ON THE **PLATFORM ROUTE CLASS**. `docs/decisions/0027` · `0007` D15 ·
 * `confirmation-v1` §whereItLIVES.
 * ===========================================================================================
 *
 * `confirmation-v1` is explicit that the requirement is on **every entry point**:
 *
 *   *"EVERY entry point that resolves a permission of sensitivity `critical` requires a valid,
 *   unspent, correctly bound confirmation. No exceptions, no flag, no override."*
 *
 * The Action pipeline is ONE of four request classes. `suites/platform-operator/confirmation.ts`
 * covers it. **THIS FILE COVERS THE OTHER GATED CLASS**, and it exists because of what that split
 * does to `0027`'s central negative control.
 *
 * ===========================================================================================
 * *** WHY THIS FILE IS THE DIFFERENCE BETWEEN A CONTROL AND A GREEN LINE. ***
 * ===========================================================================================
 *
 * `0027` requires: *"remove the confirmation check from the pipeline and every critical-operation
 * test must go red."* Until now `withConfirmationCheckRemoved` reached only
 * `confirmation-fixture.ts`'s gate — the Action pipeline's — while `dispatchPlatformRoute` step 5b
 * consulted a gate composed separately in `platform-fixture.ts`.
 *
 * **SO THE CONTROL REMOVED ONE OF TWO ENFORCEMENT POINTS AND PRINTED `STILL GREEN: 0`.** That
 * number was true of the suites the control was applied to and said nothing about the class it
 * never touched. `README.md`'s standing requirement names this exactly:
 *
 *   *"wherever an invariant is enforced at N points, the suite needs a control that removes all N
 *   — not N controls that each remove one. Every layer added makes the suite less able to detect
 *   that any single layer has died."*
 *
 * The run now applies the control to BOTH fixtures in one pass, and every case below must go red
 * under it. A case here that stays green is not testing the gate, whatever its name says — and per
 * the record, that makes THIS SUITE the thing to fix, not the control to narrow.
 *
 * ===========================================================================================
 * THE ROUTE IS SYNTHETIC, AND THAT IS A FINDING RATHER THAN A SHORTCUT
 * ===========================================================================================
 *
 * **NO ROUTE IN THE SHIPPED PLATFORM TABLE IS CONFIRMATION-GATED TODAY.** `isConfirmationGated`
 * is false for all seven: `0026` reclassified `core.organization.create` to `sensitive` on
 * purpose, and the credential-reset route is contracted and not built. So the platform-class gate
 * ships guarding nothing — which is `M-1`'s shape exactly, and is why
 * `platform-fixture.ts::createSyntheticCriticalRoute` exists.
 *
 * Everything else is the shipped code: the real `dispatchPlatformRoute`, the real
 * `ConfirmationGate` over the real service and the real `CredentialVerifier`, the real challenge,
 * the real `confirmation` table. What is the harness's is one route-table entry and one handler,
 * and both are declared.
 *
 * ALL DATA IS SYNTHETIC. No password is printed or asserted on; only derived values are submitted.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_FORBIDDEN,
  EXPECTED_UNAVAILABLE,
  MODERATOR_IDENTIFIER,
  MODERATOR_PASSWORD,
  PRN_ADMIN,
  PRN_MODERATOR,
  PRN_RESET_TARGET,
  PRN_SUSPENDED_ADMIN,
  SESSION_ADMIN,
  SESSION_MODERATOR,
  SYNTHETIC_CRITICAL_ROUTE_ID,
  createPlatformWorld,
  createSyntheticCriticalRoute,
  expectedInvalidArgument,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import {
  PlatformConfirmationCoverageError,
  assertConfirmationCoverageIsCoherent,
  isConfirmationGated,
  platformRoutes,
} from '../../../../platform/core/platform/platform-routes.ts';
import type {
  PlatformRoute,
  PlatformRouteId,
} from '../../../../platform/core/platform/platform-routes.ts';
import {
  borrowsCriticalPermissionWithoutPerforming,
  confirmableOperations,
  requiresConfirmation,
} from '../../../../platform/core/confirmation/critical-permissions.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
} from '../../../../platform/core/confirmation/confirmation-gate.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { deriveLoginCredential as adminDerive } from '../../../../platform/admin/src/api/kdf.ts';

/**
 * ===========================================================================================
 * THE REAL `platform.credentials.reset`. **THE SYNTHETIC ROUTE IS RETIRED — 2026-09-05, 17:06.**
 * ===========================================================================================
 *
 * This suite ran against `createSyntheticCriticalRoute()` for as long as the shipped table had no
 * gated route. **It now has two**, and one of them is `platform.credentials.reset` — the id the
 * synthetic route borrowed. Keeping it would mean a harness route shadowing a real one of the same
 * name, which is worse than no coverage: `callRoute` keys its injected handler by route id, so
 * every case here would have been exercising a fixture that had quietly replaced the shipped
 * route.
 *
 * **AND THE ARGUMENT FOR KEEPING IT IS GONE.** This morning the synthetic route earned its place
 * by covering the BODY-substitution axis, which `platform.operators.revoke` structurally cannot —
 * revoke's body is only the three confirmation fields. The real reset route declares
 * `principal_id`, `target_identifier` and `derived_value`, so **it covers that axis itself**. Both
 * axes are now on real routes: body substitution here, path substitution on revoke.
 *
 * The tripwire that demanded this said the repair would be *"to point the suite at it and delete
 * the synthetic route, not to update the string."* That is what this is.
 */
function criticalRoute(): PlatformRoute {
  const found = platformRoutes().find((route) => route.id === 'platform.credentials.reset');
  if (found === undefined) {
    throw new Error(
      'platform.credentials.reset is not in the shipped table. It was, at 17:06 on 2026-09-05, ' +
        'when the synthetic route was retired in its favour. If it has been withdrawn, this ' +
        'suite needs a decision rather than a fallback.',
    );
  }
  return found;
}

const ROUTE = criticalRoute();

/**
 * The handler. It records that it RAN and performs nothing.
 *
 * THE OBSERVER IS THE WHOLE POINT. Every case asserts on whether the OPERATION RAN, not only on
 * the response — a gate that refused after performing the operation would return `forbidden` and
 * have reset the credential anyway.
 */
function observingHandler(observed: { calls: number }) {
  return async () => {
    observed.calls += 1;
    return ok({ body: { performed: true }, target: { kind: 'none' as const } });
  };
}

/** Issues a REAL challenge through the shipped service, bound to the operator and its session. */
async function challenge(
  world: PlatformWorld,
  options: {
    readonly principalId?: string;
    readonly sessionId?: string;
    readonly parameters?: Readonly<Record<string, string | boolean | null>>;
  } = {},
): Promise<string> {
  const issued = await world.confirmations.issueChallenge({
    principalId: options.principalId ?? PRN_ADMIN,
    sessionId: options.sessionId ?? SESSION_ADMIN,
    actionId: 'platform.credentials.reset',
    permissionId: 'core.credential.reset',
    // THE BOUND PARAMETERS ARE THE ROUTE'S WHOLE INPUT under `aa48dd4`: body-minus-the-three,
    // UNION the path parameters. This route declares no path parameter, so it is the three
    // non-confirmation body fields — and they must match what `body()` sends below, byte for byte,
    // or every case here fails at the binding rather than at the property it names.
    parameters: options.parameters ?? {
      principal_id: PRN_RESET_TARGET,
      target_identifier: RESET_TARGET_IDENTIFIER,
      derived_value: RESET_DERIVED_VALUE,
    },
    locale: 'en',
  });
  const value = expectOk('a challenge is issued', issued) as { confirmationId: string };
  return value.confirmationId;
}

/**
 * The two operation fields beside `principal_id`.
 *
 * SYNTHETIC AND FIXED. `derived_value` is 43 base64url characters because the route validates the
 * width; it is not a credential and nothing derives from it here — the RESET itself is not what
 * these cases are about, the GATE in front of it is.
 */
const RESET_TARGET_IDENTIFIER = 'reset.target@example.invalid';
const RESET_DERIVED_VALUE = 'A'.repeat(43);

function body(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    principal_id: PRN_RESET_TARGET,
    target_identifier: RESET_TARGET_IDENTIFIER,
    derived_value: RESET_DERIVED_VALUE,
    ...fields,
  });
}

/**
 * ===========================================================================================
 * THE SUITE THE `0027` CONTROL IS APPLIED TO. EVERY CASE IN IT MUST GO RED UNDER THAT CONTROL.
 * ===========================================================================================
 *
 * IT IS SPLIT FROM `buildPlatformConfirmationScopeSuite` BELOW BY SCOPE, NOT BY CONVENIENCE, and
 * that is the whole of how `STILL GREEN: 0` is kept honest.
 *
 * Four cases about this class's gate are legitimately INDIFFERENT to whether the gate refuses: a
 * structural claim about `isConfirmationGated`, the positive control, the authorization-orders-
 * first case, and the uncomposed-gate case which has no gate to break. Left in this suite they
 * would print as four STILL GREENs on every run, and someone would have to explain, correctly,
 * every time, that those four are fine.
 *
 * **THE PREVIOUS `qa-agent` SETTLED THIS AND THE REASONING IS ADOPTED VERBATIM:** the suites are
 * split by scope rather than the still-greens explained away, because *"the explanation would then
 * have been mine to make correctly every run."* An explanation that must be re-made every run is
 * an explanation that will one day be made wrongly, and the run that gets it wrong is the run
 * where a real gap is waved through.
 *
 * So: a case belongs HERE if a gate that always agrees must make it fail. Everything else belongs
 * below and is not run under the control.
 */
export function buildPlatformConfirmationSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Confirmation — the gate on the PLATFORM route class (0027)');

  suite.test('a request with NO confirmation is refused and the operation does not run', async () => {
    const world = await make();
    try {
      const observed = { calls: 0 };
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: body({}),
      });
      assertTrue(
        `${ISOLATION} an unconfirmed critical platform operation is refused`,
        !answer.ok,
        `the route performed a critical operation with no confirmation: ${JSON.stringify(answer)}`,
      );
      assertEqual(
        `${ISOLATION} and the handler never ran — refused BEFORE the operation, not after`,
        observed.calls,
        0,
      );
    } finally {
      world.close();
    }
  });

  suite.test('SUBSTITUTION: a confirmation for principal X cannot reset principal Y', async () => {
    // THE ATTACK THE BINDING EXISTS FOR. The human confirms a statement naming one principal; the
    // request that arrives names another. If the binding covered only the action id, this would
    // verify.
    const world = await make();
    try {
      const observed = { calls: 0 };
      const confirmationId = await challenge(world, {
        parameters: { principal_id: PRN_RESET_TARGET },
      });
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: JSON.stringify({
          principal_id: 'prn_a_different_one1',
          confirmation_id: confirmationId,
          reauth_derived_value: await world.operatorDerivedValue(),
          [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
        }),
      });
      assertTrue(
        `${ISOLATION} a confirmation for one principal cannot be spent on another`,
        !answer.ok,
        `the confirmed target and the acted-on target differed and it verified: ${JSON.stringify(answer)}`,
      );
      assertEqual(`${ISOLATION} and nothing was reset`, observed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a confirmation obtained on one SESSION cannot be spent on another', async () => {
    const world = await make();
    try {
      const observed = { calls: 0 };
      // Issued against a different session of the SAME principal. Session theft is the threat the
      // binding's session component answers, and the principal being identical is what makes this
      // a test of the session binding rather than of the principal binding.
      const confirmationId = await challenge(world, { sessionId: 'ses_expired_0000001' });
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: body({
          confirmation_id: confirmationId,
          reauth_derived_value: await world.operatorDerivedValue(),
          [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
        }),
      });
      assertTrue(
        `${ISOLATION} the binding covers the session`,
        !answer.ok,
        `a confirmation crossed sessions: ${JSON.stringify(answer)}`,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, observed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test("ANOTHER OPERATOR'S CORRECT PASSWORD is refused", async () => {
    // Every suite tests a WRONG value. This tests a RIGHT value belonging to someone else, which
    // is the case a naive verifier passes: it checks that the submitted value verifies, without
    // checking that it verifies AS THE CALLER.
    const world = await make();
    try {
      const observed = { calls: 0 };
      const confirmationId = await challenge(world);
      const othersValue = (await adminDerive(MODERATOR_IDENTIFIER, MODERATOR_PASSWORD)).derived_key;
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: body({
          confirmation_id: confirmationId,
          reauth_derived_value: othersValue,
          [REAUTH_IDENTIFIER_FIELD]: MODERATOR_IDENTIFIER,
        }),
      });
      assertTrue(
        `${ISOLATION} a correct credential belonging to another principal does not confirm`,
        !answer.ok,
        `the gate accepted another operator's credential: ${JSON.stringify(answer)}`,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, observed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a confirmation is spent on first use — a replay is refused', async () => {
    const world = await make();
    try {
      const observed = { calls: 0 };
      const confirmationId = await challenge(world);
      const bodyText = body({
        confirmation_id: confirmationId,
        reauth_derived_value: await world.operatorDerivedValue(),
        [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
      });
      expectOk(
        'the first submission is served',
        await world.callRoute(ROUTE, observingHandler(observed), {
          sessionId: SESSION_ADMIN,
          bodyText,
        }),
      );
      assertEqual('the operation ran once', observed.calls, 1);

      const replay = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText,
      });
      assertTrue(
        `${ISOLATION} the identical request a second time is refused`,
        !replay.ok,
        `a confirmation was spent twice: ${JSON.stringify(replay)}`,
      );
      assertEqual(`${ISOLATION} and the operation ran only once in total`, observed.calls, 1);
    } finally {
      world.close();
    }
  });

  suite.test('a FABRICATED confirmation_id is refused when everything else is correct', async () => {
    const world = await make();
    try {
      const observed = { calls: 0 };
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: body({
          confirmation_id: 'cnf_fabricated_00001',
          reauth_derived_value: await world.operatorDerivedValue(),
          [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
        }),
      });
      assertTrue(
        `${ISOLATION} an invented confirmation identifier does not confirm`,
        !answer.ok,
        `a fabricated confirmation was accepted: ${JSON.stringify(answer)}`,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, observed.calls, 0);
    } finally {
      world.close();
    }
  });

  // ===========================================================================================
  // THE PATH-SUBSTITUTION CONTROL. `confirmation-v1` as amended at `aa48dd4`.
  // ===========================================================================================
  //
  // *** IT IS A SEPARATE CASE FROM THE BODY SUBSTITUTION ABOVE, AND NEITHER SUBSUMES THE OTHER. ***
  //
  // `confirmation-v1`'s test list has a case labelled THE CENTRAL TEST OF THIS CONTRACT — confirm
  // a delete of customer X, submit a delete of customer Y. **It varies a BODY field, and on
  // `platform.operators.revoke` it is NOT CONSTRUCTIBLE**: that route declares exactly the three
  // confirmation fields, so body-minus-three is the EMPTY OBJECT and there is no body value to
  // vary. A suite running only the body form would report the contract's central property as
  // covered while the only axis this route has went untested.
  //
  // WHAT WAS WRONG UNDER THE STRUCK WORDING, in the contract's words: *"`revokeOperatorInput`
  // requires exactly the three confirmation fields and nothing else, so body-minus-three is the
  // EMPTY OBJECT; the target lives in the path and the path was not in the binding. A
  // CONFIRMATION MINTED TO REVOKE ONE OPERATOR WOULD HAVE BEEN SPENDABLE ON ANOTHER."*
  //
  // `platform-operators-v1`'s schema PROMISED the property — *"the binding covers principal_id"* —
  // and the implementation would not have held it. That is the gap this case closes.
  suite.test(
    'SUBSTITUTION ON THE PATH: a confirmation to revoke operator A cannot revoke operator B',
    async () => {
      const world = await make();
      try {
        const revoke = platformRoutes().find((r) => r.id === 'platform.operators.revoke');
        assertTrue(
          'the revoke route is registered',
          revoke !== undefined,
          'platform.operators.revoke is not in the shipped table',
        );
        assertTrue(
          'and it is confirmation-gated, or this case tests nothing',
          isConfirmationGated(revoke!),
          'the revoke route is not gated, so a confirmation is not required and substitution is ' +
            'not the question — the question would be why the most dangerous route in the class ' +
            'asks for nothing',
        );
        assertEqual(
          'its body carries ONLY the three confirmation fields — which is why the body-substitution ' +
            'case above cannot be written for it',
          [...revoke!.fields].sort().join(','),
          // THE PORT'S OWN CONSTANTS. This assertion held a transcribed literal and went red when
          // `identifier` became `reauth_identifier`, which is the drift the whole migration to
          // constants was for — a case whose name is about substitution failing on a field NAME.
          [CONFIRMATION_ID_FIELD, REAUTH_DERIVED_VALUE_FIELD, REAUTH_IDENTIFIER_FIELD]
            .sort()
            .join(','),
        );

        const submission = async (confirmationId: string) => ({
          confirmation_id: confirmationId,
          reauth_derived_value: await world.operatorDerivedValue(),
          [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
        });

        // A confirmation minted to revoke PRN_MODERATOR.
        const issued = expectOk(
          'a challenge for revoking operator A',
          await world.confirmations.issueChallenge({
            principalId: PRN_ADMIN,
            sessionId: SESSION_ADMIN,
            actionId: 'platform.operators.revoke',
            permissionId: 'core.principal.revoke-platform-scope',
            parameters: { principal_id: PRN_MODERATOR },
            locale: 'en',
          }),
        ) as { confirmationId: string };

        // ---- THE CASE. The SAME confirmation, one path segment changed.
        const observed = { calls: 0 };
        const onB = await world.callRoute(revoke!, observingHandler(observed), {
          sessionId: SESSION_ADMIN,
          bodyText: JSON.stringify(await submission(issued.confirmationId)),
          pathParams: { principal_id: PRN_SUSPENDED_ADMIN },
        });
        assertTrue(
          `${ISOLATION} a confirmation for operator A does not revoke operator B`,
          !onB.ok,
          'A CONFIRMATION MINTED FOR ONE OPERATOR WAS SPENT ON ANOTHER. The human confirmed a ' +
            'statement naming A and B lost their platform authority. This is the defect the ' +
            `aa48dd4 amendment exists to close: ${JSON.stringify(onB)}`,
        );
        assertEqual(`${ISOLATION} and the operation did not run`, observed.calls, 0);

        // ---- THE POSITIVE CONTROL. The same confirmation on the RIGHT path is served, so the
        // refusal is about the substitution and not about the confirmation being unusable.
        expectOk(
          'the same confirmation on operator A IS served',
          await world.callRoute(revoke!, observingHandler(observed), {
            sessionId: SESSION_ADMIN,
            bodyText: JSON.stringify(await submission(issued.confirmationId)),
            pathParams: { principal_id: PRN_MODERATOR },
          }),
        );
        assertEqual('and the operation ran exactly once, on A', observed.calls, 1);
      } finally {
        world.close();
      }
    },
  );

  // NOTE: `THE STRUCK DEFINITION IS DEAD` LIVES IN THE SCOPE SUITE BELOW, not here. It printed
  // STILL GREEN under `0027`'s control on its first run — correctly, because it only ISSUES a
  // challenge and never spends one, so a gate that always agrees cannot affect it. Moved rather
  // than explained, for this suite's standing reason: an explanation that must be re-made
  // correctly every run is one that will eventually be made wrongly.

  suite.test('a confirmation refusal IS audited, as denied, with no target', async () => {
    // `dispatchPlatformRoute` step 5b: the caller is a real operator holding a real permission who
    // failed to prove intent or presence on a critical operation — precisely what the trail exists
    // to show. `NO_TARGET`, because the parameters naming the target are the ones that failed to
    // verify, and recording an unverified target would make the log assert more than the code knows.
    const world = await make();
    try {
      const observed = { calls: 0 };
      const answer = await world.callRoute(ROUTE, observingHandler(observed), {
        sessionId: SESSION_ADMIN,
        bodyText: body({
          confirmation_id: 'cnf_fabricated_00001',
          reauth_derived_value: await world.operatorDerivedValue(),
          [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
        }),
      });
      assertTrue('the request was refused', !answer.ok, JSON.stringify(answer));

      const rows = world.actionRows();
      assertEqual('exactly one record', rows.length, 1);
      assertEqual('for the route that refused', rows[0]!.action_id, SYNTHETIC_CRITICAL_ROUTE_ID);
      assertEqual('with outcome denied', rows[0]!.outcome, 'denied');
      assertEqual('naming the calling operator', rows[0]!.actor_principal_id, PRN_ADMIN);
      assertEqual(
        `${ISOLATION} and NO target, because the target is what failed to verify`,
        rows[0]!.target_kind,
        'none',
      );
      assertTrue(
        `${ISOLATION} the unverified target identifier is not recorded`,
        !JSON.stringify(rows[0]).includes(PRN_RESET_TARGET),
        'the operator log recorded a target the gate refused to verify',
      );
    } finally {
      world.close();
    }
  });

  return suite;
}

/**
 * ===========================================================================================
 * THE CASES THAT ARE LEGITIMATELY INDIFFERENT TO WHETHER THE GATE REFUSES.
 * *** NOT RUN UNDER `0027`'s CONTROL, AND THE SEPARATION IS THE REASON IT READS `0`. ***
 * ===========================================================================================
 *
 * Each of these four would print STILL GREEN under a gate that always agrees, and each would be
 * CORRECT to. They are about the gate's SCOPE and COMPOSITION rather than its verdict:
 *
 *   - whether a route is gated at all is decided by `isConfirmationGated` from the permission,
 *     with no gate instance involved;
 *   - the positive control asserts a SUCCESS, and a gate that always agrees still succeeds;
 *   - authorization runs at step 5, before the gate at step 5b, so its refusal is the same
 *     either way — which is the ordering property itself;
 *   - the uncomposed case builds a world with NO gate, so there is nothing for the wrapper to
 *     wrap.
 *
 * Keeping them here means the control's STILL-GREEN line stays a real signal instead of a list
 * with a standing footnote. See `buildPlatformConfirmationSuite`'s header for why an explanation
 * that must be re-made every run is not a substitute for a split.
 */
export function buildPlatformConfirmationScopeSuite(
  make: MakePlatformWorld = createPlatformWorld,
): Suite {
  const suite = new Suite("Confirmation — the platform gate's scope and composition (0027)");

  suite.test('a route declaring a critical permission is gated, or is listed as borrowing it', () => {
    // =====================================================================================
    // *** THIS CASE WAS RENAMED AND REWRITTEN ON 2026-09-05, AND THE REASON IS THE FINDING. ***
    // =====================================================================================
    //
    // It read "gated by its PERMISSION, with no per-route opt-in", and it asserted
    // `isConfirmationGated(ROUTE)` — which was `permission.kind === 'fixed' &&
    // requiresConfirmation(permissionId)`.
    //
    // `isConfirmationGated` IS NOW `confirmableOperations().includes(route.id)` — keyed by ROUTE
    // ID, not derived from the permission. **THE CASE KEPT PASSING**, because the synthetic route
    // is in that list either way. A case can survive the mechanism it names being replaced, and
    // this one did.
    //
    // WHY THE CHANGE IS SOUND, having read it rather than assumed either way. The naive derivation
    // has no false positives but **fails OPEN in one direction and closed in another**:
    // `platform.organizations.members.resolve` declares `core.credential.reset` in order to narrow
    // who may call it (`0028` D2 — *"a principal who may not reset a credential may not resolve a
    // principal"*) and performs no reset. Gating it would demand a confirmation for a READ, and
    // worse would deadlock: you would need the principal id to request the confirmation that the
    // route producing the principal id demands.
    //
    // SO THE SAFETY MOVED, AND THIS IS WHERE IT NOW LIVES: every route declaring a critical
    // permission must be in EXACTLY ONE of two Core-owned lists, and
    // `assertConfirmationCoverageIsCoherent` stops the build otherwise. That is the property to
    // test, and it is what the rest of this case does.
    const critical = platformRoutes().filter(
      (route) => route.permission.kind === 'fixed' && requiresConfirmation(route.permission.permissionId),
    );
    assertTrue(
      'there are routes declaring a critical permission, so this case is not vacuous',
      critical.length > 0,
      'no shipped route declares a critical permission',
    );

    const unaccounted = critical.filter(
      (route) =>
        !confirmableOperations().includes(route.id) &&
        !borrowsCriticalPermissionWithoutPerforming(route.id),
    );
    assertEqual(
      `${ISOLATION} every route declaring a critical permission is gated or listed as borrowing`,
      unaccounted.map((route) => route.id).join(','),
      '',
    );

    // NEITHER LIST MAY CLAIM THE SAME ROUTE. A route in both would be gated and exempt at once,
    // and the contradiction would resolve as "exempt" — the direction that performs the operation.
    const inBoth = critical.filter(
      (route) =>
        confirmableOperations().includes(route.id) &&
        borrowsCriticalPermissionWithoutPerforming(route.id),
    );
    assertEqual(
      `${ISOLATION} no route is both a confirmable operation and an exempt borrower`,
      inBoth.map((route) => route.id).join(','),
      '',
    );

    // AND THE EXEMPTION IS NOT EMPTY-BY-ACCIDENT. If nothing borrowed, the two-list model would be
    // untested by the shipped table and a broken exemption would show up nowhere.
    assertTrue(
      'at least one shipped route borrows a critical permission without performing it',
      critical.some((route) => borrowsCriticalPermissionWithoutPerforming(route.id)),
      'no route exercises the exemption, so its correctness is asserted by nothing',
    );

    // =====================================================================================
    // *** THIS TRIPWIRE FIRED ON 2026-09-05, WHICH IS WHAT IT WAS FOR. ***
    // =====================================================================================
    //
    // It read "no shipped route is confirmation-gated today, which is why the suite above is
    // synthetic", and said the repair would be to point the suite at the real route rather than
    // update the string. `platform.operators.revoke` shipped and it went red. So:
    //
    //   THE REAL ROUTE IS NOW TESTED — see `SUBSTITUTION ON THE PATH` below, which drives the
    //   shipped `platform.operators.revoke` through the shipped dispatcher and gate.
    //
    //   AND THE SYNTHETIC ROUTE STAYS, WHICH IS THE PART THAT NEEDED ARGUING. It covers an axis
    //   the shipped route structurally cannot: `revoke`'s body is exactly the three confirmation
    //   fields, so body-minus-three is the EMPTY OBJECT and there is no body value to substitute.
    //   `confirmation-v1`'s amendment says it in terms — the body case and the path case are
    //   separate tests because **neither subsumes the other**. Deleting the synthetic route would
    //   silently drop body substitution from the platform class's coverage.
    //
    // The list is asserted by NAME rather than by count, so a SECOND gated route also has to be
    // argued rather than absorbed.
    assertEqual(
      'exactly the gated routes this suite knows about are gated',
      platformRoutes()
        .filter((route) => isConfirmationGated(route))
        .map((route) => route.id)
        .sort()
        .join(','),
      'platform.credentials.reset,platform.operators.revoke',
    );
  });

  suite.test(
    'THE STRUCK DEFINITION IS DEAD: a revoke challenge over the EMPTY object cannot be issued',
    async () => {
      // =====================================================================================
      // `architecture-agent`'s clause, quoted because it is the whole point of this case:
      // *"it must be shown to go red against the struck definition, or it has verified nothing."*
      // =====================================================================================
      //
      // Under the struck wording the binding for `platform.operators.revoke` was
      // **body-minus-the-three**, which for that route is `{}` — the same value for every
      // operator. A confirmation bound over `{}` would have been spendable against any principal
      // in the path, which is precisely what `platform-operators-v1`'s schema promised could not
      // happen.
      //
      // *** IT CANNOT BE ISSUED AT ALL, AND THAT IS A STRONGER RESULT THAN THE ONE I EXPECTED. ***
      // I wrote this to mint an empty-bound confirmation and show it refused at SPEND time. The
      // challenge is refused at ISSUE time, with `principal_id: required_for_statement` — because
      // the confirmation STATEMENT for this operation interpolates the target, so a challenge that
      // does not name it cannot be rendered for a human to read.
      //
      // **THAT CLOSES THE STRUCK DEFINITION FROM THE OTHER END.** The bound parameters ALWAYS name
      // the target, because the statement will not render without it. So under the struck wording
      // the challenge would have carried `{principal_id: A}` while the spend recomputed `{}`, and
      // the two could never be equal — the route would have been permanently unusable rather than
      // exploitable. Either way the struck definition is dead.
      //
      // Recorded as what was measured rather than what was predicted.
      //
      // IT LIVES IN THIS SUITE AND NOT THE GATED ONE because it only ISSUES a challenge and never
      // spends one, so a gate that always agrees cannot affect it. It printed STILL GREEN under
      // `0027`'s control on its first run, correctly, and was moved rather than explained.
      const world = await make();
      try {
        const answer = await world.confirmations.issueChallenge({
          principalId: PRN_ADMIN,
          sessionId: SESSION_ADMIN,
          actionId: 'platform.operators.revoke',
          permissionId: 'core.principal.revoke-platform-scope',
          parameters: {},
          locale: 'en',
        });
        assertTrue(
          `${ISOLATION} a revoke challenge that names no target cannot be issued`,
          !answer.ok,
          'a confirmation was issued over the empty object. Its statement cannot name whose ' +
            'authority is being removed, so a human would be asked to confirm a sentence with a ' +
            `hole in it — and under the struck binding it would have been spendable on anyone: ${JSON.stringify(answer)}`,
        );
        assertEqual(
          'and it is refused for the missing target specifically, not for some other reason',
          JSON.stringify((answer as { error: unknown }).error),
          JSON.stringify(expectedInvalidArgument('principal_id', 'required_for_statement')),
        );

        // THE POSITIVE CONTROL. The same challenge WITH the target is issued, so the refusal is
        // about the missing parameter and not about revoke being unconfirmable.
        expectOk(
          'the same challenge naming the target IS issued',
          await world.confirmations.issueChallenge({
            principalId: PRN_ADMIN,
            sessionId: SESSION_ADMIN,
            actionId: 'platform.operators.revoke',
            permissionId: 'core.principal.revoke-platform-scope',
            parameters: { principal_id: PRN_MODERATOR },
            locale: 'en',
          }),
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test(
    'THE INTERLEAVED REVOCATION: two operators revoking the same target — the OUTCOME is right ' +
      'even when the code is not',
    async () => {
      // =====================================================================================
      // A KNOWN RESIDUAL, COVERED RATHER THAN REPORTED. `core-agent` named it deliberately.
      // =====================================================================================
      //
      // `revokeOperator` reads the operator row, then conditionally deletes it. Between those two
      // steps another operator may revoke the same target, so the second caller can receive
      // `failed_precondition` where `not_found` was the true state. **The wrong error, never a
      // wrong outcome.**
      //
      // THE ALTERNATIVE WAS WORSE AND THAT IS WHY THIS IS ACCEPTED: making the store report WHICH
      // condition failed would turn a genuine last-operator refusal into a missing row, and would
      // be the existence oracle the collapse closes.
      //
      // *** SO THIS ASSERTS THE OUTCOME AND NOT THE CODE, WHICH IS WHAT WAS ASKED FOR. *** It
      // accepts either error, and requires the things that must be true whichever arrives: the
      // target is revoked exactly once, the second call revokes nobody, and no second audit
      // record claims a success.
      //
      // IT LIVES IN THIS SUITE AND NOT THE GATED ONE. It printed STILL GREEN under `0027`'s
      // control on its first run — correctly, because it is about the store's conditional delete
      // and both revocations carry valid confirmations whether the gate refuses or not. Moved
      // rather than explained.
      const world = await make();
      try {
        // *** `world.call` AND NOT `world.callRoute`, AND THE DIFFERENCE IS THE WHOLE CASE. ***
        // `callRoute` injects a handler, which the gated suite's cases want because they are about
        // the GATE and need to observe whether the operation ran. This case is about what the REAL
        // handler does when the row is already gone, so an injected stub reports success for both
        // calls — which is exactly what it did on this case's first run.
        const before = world.controlRows('platform_operator').length;
        assertTrue('the fixture holds operators to revoke', before >= 2, String(before));

        const submission = async () => {
          const issued = expectOk(
            'a challenge to revoke the moderator',
            await world.confirmations.issueChallenge({
              principalId: PRN_ADMIN,
              sessionId: SESSION_ADMIN,
              actionId: 'platform.operators.revoke',
              permissionId: 'core.principal.revoke-platform-scope',
              parameters: { principal_id: PRN_MODERATOR },
              locale: 'en',
            }),
          ) as { confirmationId: string };
          return JSON.stringify({
            confirmation_id: issued.confirmationId,
            reauth_derived_value: await world.operatorDerivedValue(),
            [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
          });
        };

        // TWO SUBMISSIONS, EACH WITH ITS OWN CONFIRMATION. A single confirmation would be refused
        // the second time as a replay — a different property, already covered, and it would make
        // this case pass without ever reaching the interleaving.
        expectOk(
          'the first revocation succeeds',
          await world.call('platform.operators.revoke', {
            sessionId: SESSION_ADMIN,
            bodyText: await submission(),
            pathParams: { principal_id: PRN_MODERATOR },
          }),
        );

        const second = await world.call('platform.operators.revoke', {
          sessionId: SESSION_ADMIN,
          bodyText: await submission(),
          pathParams: { principal_id: PRN_MODERATOR },
        });

        // ---- THE OUTCOME, WHICH IS WHAT MATTERS.
        assertTrue(
          `${ISOLATION} the second revocation does NOT succeed`,
          !second.ok,
          `revoking an already-revoked operator reported success: ${JSON.stringify(second)}`,
        );
        // EITHER CODE IS ACCEPTED, BY NAME, so this case documents the residual instead of pinning
        // a value that is knowingly imprecise. A THIRD code fails — the residual is between these
        // two, and anything else is a different defect to route.
        const code = (second as { error: { code: string } }).error.code;
        assertTrue(
          'and it is one of the two the residual permits',
          code === 'not_found' || code === 'failed_precondition',
          `the second revocation answered '${code}'. The known residual is that an interleaved ` +
            'revocation can report failed_precondition where not_found was true; any other code ' +
            'is not that residual',
        );

        assertEqual(
          `${ISOLATION} exactly one operator row was removed, not two and not none`,
          world.controlRows('platform_operator').length,
          before - 1,
        );
        assertEqual(
          `${ISOLATION} and the target is the one that went`,
          world
            .controlRows('platform_operator')
            .filter((row) => row.principal_id === PRN_MODERATOR).length,
          0,
        );

        // NO AUDIT RECORD CLAIMS THE SECOND CALL SUCCEEDED. The outcome column is what an
        // oversight reader counts revocations from, and a second `ok` would say the operator was
        // revoked twice.
        assertEqual(
          `${ISOLATION} exactly one revocation record has outcome ok`,
          world
            .actionRows()
            .filter((row) => row.action_id === 'platform.operators.revoke' && row.outcome === 'ok')
            .length,
          1,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('a route declaring a critical permission and in NEITHER list stops the build', () => {
    // THE NEGATIVE CONTROL FOR THE CASE ABOVE. Without it, "every route is in one of the two
    // lists" is a statement about today's table and not about the guard — and the guard is the
    // whole of the safety now that gating is keyed by route id rather than derived.
    //
    // `assertConfirmationCoverageIsCoherent` takes its inputs as parameters precisely so this can
    // be reached from a test without editing `platform/core/**`.
    const rogue = {
      ...createSyntheticCriticalRoute(),
      id: 'platform.rogue.reset' as PlatformRouteId,
    } as PlatformRoute;

    let thrown: unknown = null;
    try {
      // An empty confirmable list, so the rogue route is in neither.
      assertConfirmationCoverageIsCoherent([rogue], []);
    } catch (cause) {
      thrown = cause;
    }
    assertTrue(
      `${ISOLATION} the guard refuses a critical route that is in neither list`,
      thrown instanceof PlatformConfirmationCoverageError,
      `the build did NOT stop for a route declaring core.credential.reset and registered ` +
        `nowhere: ${String(thrown)}`,
    );

    // AND THE POSITIVE CONTROL: the same route IS accepted when it is declared confirmable, so the
    // throw above is about registration and not about the route being malformed.
    assertConfirmationCoverageIsCoherent([rogue], [rogue.id]);
  });

  suite.test('a correctly confirmed request is SERVED — the control for every refusal', async () => {
    // WITHOUT THIS EVERY REFUSAL IN THE SUITE ABOVE PROVES NOTHING. A gate that refused
    // unconditionally would make all seven of them pass.
    const world = await make();
    try {
      const observed = { calls: 0 };
      expectOk(
        'the operation runs when the confirmation is valid, unspent and correctly bound',
        await world.callRoute(ROUTE, observingHandler(observed), {
          sessionId: SESSION_ADMIN,
          bodyText: body({
            confirmation_id: await challenge(world),
            reauth_derived_value: await world.operatorDerivedValue(),
            [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
          }),
        }),
      );
      assertEqual('and the handler actually ran', observed.calls, 1);
    } finally {
      world.close();
    }
  });

  suite.test('AUTHORIZATION REFUSES BEFORE THE GATE, so the gate leaks no grant state', async () => {
    // The dispatcher's step 5 precedes step 5b, and the ordering is the reason: a caller lacking
    // the permission must receive the class's uniform `forbidden` from AUTHORIZATION rather than a
    // confirmation refusal — otherwise the gate would tell an unauthorized caller that the
    // permission was held.
    //
    // `marketplace-moderator` does not hold `core.credential.reset`.
    const world = await make();
    try {
      const observed = { calls: 0 };
      expectError(
        `${ISOLATION} a role without the permission gets the class's uniform forbidden`,
        await world.callRoute(ROUTE, observingHandler(observed), {
          sessionId: SESSION_MODERATOR,
          bodyText: body({}),
        }),
        EXPECTED_FORBIDDEN,
      );
      assertEqual('and the operation did not run', observed.calls, 0);
    } finally {
      world.close();
    }
  });

  suite.test('an UNCOMPOSED gate answers unavailable, never open', async () => {
    // `composition.ts`: *"A DEPLOYMENT COMPOSING ONE AND NOT THE OTHER IS COHERENT IN BOTH
    // DIRECTIONS, and both directions fail closed."* This is the direction where the service
    // exists and the gate does not: the route answers `unavailable` rather than performing the
    // operation unconfirmed.
    //
    // IT IS A DIFFERENT THING FROM A BROKEN GATE. A wrapped gate that always agrees is the defect
    // shape; an absent gate is a composition mistake. Both must refuse, and they refuse
    // differently — `unavailable` here, `forbidden` for a bad confirmation — so neither can be
    // mistaken for the other in a report.
    const world = await make({ composeGate: false });
    try {
      const observed = { calls: 0 };
      expectError(
        `${ISOLATION} absent means refused`,
        await world.callRoute(ROUTE, observingHandler(observed), {
          sessionId: SESSION_ADMIN,
          bodyText: body({
            confirmation_id: await challenge(world),
            reauth_derived_value: await world.operatorDerivedValue(),
            [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
          }),
        }),
        EXPECTED_UNAVAILABLE,
      );
      assertEqual(`${ISOLATION} and the operation did not run`, observed.calls, 0);
    } finally {
      world.close();
    }
  });

  return suite;
}
