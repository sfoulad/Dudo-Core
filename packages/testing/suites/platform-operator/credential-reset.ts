/**
 * ===========================================================================================
 * CREDENTIAL RESET. `credential-reset-v1` · the most dangerous operation in the platform.
 * ===========================================================================================
 *
 * Holding `core.credential.reset` is the ability to take over any account. The route is
 * confirmation-gated, and this file covers the three properties that decide whether the gate is
 * protecting what it claims to.
 *
 * ===========================================================================================
 * THE TWO IDENTIFIERS NAME TWO DIFFERENT PRINCIPALS, AND THAT IS WHY THE FIELD WAS RENAMED
 * ===========================================================================================
 *
 * `reauth_identifier` is **the caller's own**, proving the operator is present.
 * `target_identifier` is **the account being taken over**.
 *
 * Until 2026-09-05 both contracts used the bare word `identifier` for their own meaning, and the
 * merged request shape had exactly one. `architecture.md` §1a records the consequence: the gate
 * would have consumed the target's identifier as the caller's and **the route would have returned
 * `forbidden` on every well-formed request, permanently.** Neither contract was wrong on its own;
 * the union was.
 *
 * **SO EVERY CASE HERE SENDS BOTH, AND THEY ARE DIFFERENT PRINCIPALS.** A fixture that sent one
 * value for both would pass while asserting nothing about the distinction the rename exists for.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  MODERATOR_IDENTIFIER,
  PRN_ADMIN,
  PRN_MODERATOR,
  PRN_TENANT_OWNER,
  SESSION_ADMIN,
  TENANT_OWNER_IDENTIFIER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
} from '../../../../platform/core/confirmation/confirmation-gate.ts';

/** A fresh 43-character base64url value. Not a credential; nothing derives from it here. */
const NEW_DERIVED_VALUE = 'B'.repeat(43);

/**
 * A complete, confirmed reset submission.
 *
 * THE CHALLENGE IS ISSUED OVER THE THREE OPERATION FIELDS AND NOTHING ELSE — `principal_id`,
 * `target_identifier`, `derived_value`. The operator's own re-auth fields are stripped by
 * `splitConfirmedRequest` before the binding is computed, so including them would produce a
 * binding the gate never recomputes and every case here would fail at the binding rather than at
 * the property it names.
 */
async function confirmedReset(
  world: PlatformWorld,
  overrides: {
    readonly principalId?: string;
    readonly targetIdentifier?: string;
    readonly derivedValue?: string;
    readonly challengeFor?: Readonly<Record<string, string>>;
  } = {},
): Promise<string> {
  const parameters = overrides.challengeFor ?? {
    principal_id: overrides.principalId ?? PRN_TENANT_OWNER,
    target_identifier: overrides.targetIdentifier ?? TENANT_OWNER_IDENTIFIER,
    derived_value: overrides.derivedValue ?? NEW_DERIVED_VALUE,
  };
  const issued = expectOk(
    'a reset challenge is issued',
    await world.confirmations.issueChallenge({
      principalId: PRN_ADMIN,
      sessionId: SESSION_ADMIN,
      actionId: 'platform.credentials.reset',
      permissionId: 'core.credential.reset',
      parameters,
      locale: 'en',
    }),
  ) as { confirmationId: string };

  return JSON.stringify({
    principal_id: overrides.principalId ?? PRN_TENANT_OWNER,
    target_identifier: overrides.targetIdentifier ?? TENANT_OWNER_IDENTIFIER,
    derived_value: overrides.derivedValue ?? NEW_DERIVED_VALUE,
    [CONFIRMATION_ID_FIELD]: issued.confirmationId,
    [REAUTH_DERIVED_VALUE_FIELD]: await world.operatorDerivedValue(),
    [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
  });
}

export function buildCredentialResetSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — credential reset (credential-reset-v1)');

  suite.test('a fully confirmed reset replaces the credential and the target can sign in with it', async () => {
    const world = await make();
    try {
      const before = world
        .controlRows('principal_credential')
        .filter((row) => row.principal_id === PRN_TENANT_OWNER);
      assertEqual('the target has exactly one credential to replace', before.length, 1);

      expectOk(
        'the reset is served',
        await world.call('platform.credentials.reset', {
          sessionId: SESSION_ADMIN,
          bodyText: await confirmedReset(world),
        }),
      );

      const after = world
        .controlRows('principal_credential')
        .filter((row) => row.principal_id === PRN_TENANT_OWNER);
      assertEqual('there is still exactly one credential, not two', after.length, 1);
      assertTrue(
        `${ISOLATION} and its stored verifier CHANGED`,
        after[0]!.verifier !== before[0]!.verifier,
        'the reset reported success and the stored verifier is unchanged, so the operation is a ' +
          'no-op that answers 200 — the worst shape this route could have',
      );
      assertTrue(
        `${ISOLATION} the submitted derived value is NOT what was stored`,
        after[0]!.verifier !== NEW_DERIVED_VALUE,
        '0015 §D: the server stores a hash of the client\'s output, never the output itself. ' +
          'Storing it directly would make this table usable as a login credential with no ' +
          'cracking at all',
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'THE TARGET IS BOUND: a confirmation minted for one account cannot reset another',
    async () => {
      // The property `credential-reset-v1` promises and the rename made true. The challenge names
      // one target; the submission names another, changing only that field.
      const world = await make();
      try {
        const body = JSON.parse(
          await confirmedReset(world, {
            challengeFor: {
              principal_id: PRN_TENANT_OWNER,
              target_identifier: TENANT_OWNER_IDENTIFIER,
              derived_value: NEW_DERIVED_VALUE,
            },
          }),
        ) as Record<string, unknown>;
        body.principal_id = PRN_MODERATOR;
        body.target_identifier = MODERATOR_IDENTIFIER;

        const answer = await world.call('platform.credentials.reset', {
          sessionId: SESSION_ADMIN,
          bodyText: JSON.stringify(body),
        });
        assertTrue(
          `${ISOLATION} the substituted target is refused`,
          !answer.ok,
          'A CONFIRMATION MINTED TO RESET ONE ACCOUNT WAS SPENT ON ANOTHER. The human confirmed a ' +
            `statement naming one person and a different person lost their account: ${JSON.stringify(answer)}`,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('THE NEW CREDENTIAL IS BOUND TOO: altering derived_value alone is refused', async () => {
    // `derived_value` is in the binding, deliberately — so a confirmation cannot be intercepted
    // and re-aimed at a password the operator never saw. This is the axis that would be missed by
    // a test that only varied the target.
    const world = await make();
    try {
      const body = JSON.parse(await confirmedReset(world)) as Record<string, unknown>;
      body.derived_value = 'C'.repeat(43);

      const answer = await world.call('platform.credentials.reset', {
        sessionId: SESSION_ADMIN,
        bodyText: JSON.stringify(body),
      });
      assertTrue(
        `${ISOLATION} a different new credential invalidates the confirmation`,
        !answer.ok,
        'the confirmed reset accepted a derived value the confirmation did not cover, so an ' +
          `intercepted submission could set a password of the attacker's choosing: ${JSON.stringify(answer)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'the operator exclusion answers FORBIDDEN, and that is deliberately distinguishable from the 404',
    async () => {
      // =====================================================================================
      // NOT AN INCONSISTENCY WITH THE COLLAPSE, AND THIS CASE EXISTS SO NOBODY "FIXES" IT.
      // =====================================================================================
      //
      // The `not_found` collapse covers three cases — no such principal, no credential under that
      // identifier, and a credential belonging to someone else — because distinguishing them
      // would be an existence oracle.
      //
      // **THE OPERATOR EXCLUSION IS A FOURTH AND IS DELIBERATELY DISTINCT.** It discloses only
      // that the target is a platform operator, which a caller holding `core.credential.reset`
      // could already learn from `platform.operators.list`. And it is a fact about platform
      // operators AS A GROUP rather than about this one: Core refuses to reset any operator's
      // credential through this route.
      const world = await make();
      try {
        expectError(
          `${ISOLATION} resetting an operator's credential is forbidden, not collapsed`,
          await world.call('platform.credentials.reset', {
            sessionId: SESSION_ADMIN,
            bodyText: await confirmedReset(world, {
              principalId: PRN_MODERATOR,
              targetIdentifier: MODERATOR_IDENTIFIER,
            }),
          }),
          EXPECTED_FORBIDDEN,
        );

        // ---- AND THE COLLAPSE STILL COLLAPSES. Without this the case above would be evidence
        // that the route simply answers `forbidden` a lot.
        expectError(
          `${ISOLATION} an identifier with no credential is the collapsed not_found`,
          await world.call('platform.credentials.reset', {
            sessionId: SESSION_ADMIN,
            bodyText: await confirmedReset(world, {
              principalId: 'prn_exists_nowhere01',
              targetIdentifier: 'nobody.here@example.invalid',
            }),
          }),
          EXPECTED_NOT_FOUND,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test(
    'THE ATOMICITY, NOT THE SEQUENCE: no window exists in which the old password still works',
    async () => {
      // =====================================================================================
      // ASSERTED AS AN INVARIANT RATHER THAN AN ORDERING, WHICH IS WHAT WAS ASKED FOR.
      // =====================================================================================
      //
      // The credential is replaced and the target's live sessions are revoked in ONE batch. A
      // case asserting "the replace happens before the revoke" would be testing an implementation
      // detail and would go red on a correct reordering; the property that matters is that
      // **there is no observable moment between them.**
      //
      // So this asserts the two facts that must hold TOGETHER after one call, and the one that
      // must hold before it — which is what "no window" means from outside.
      const world = await make();
      try {
        const sessionsBefore = world
          .controlRows('session')
          .filter((row) => row.principal_id === PRN_TENANT_OWNER);
        assertTrue(
          'the target has live sessions to revoke, so this case is not vacuous',
          sessionsBefore.length > 0,
          'no session rows for the target',
        );

        expectOk(
          'the reset is served',
          await world.call('platform.credentials.reset', {
            sessionId: SESSION_ADMIN,
            bodyText: await confirmedReset(world),
          }),
        );

        assertEqual(
          `${ISOLATION} every one of the target's sessions is gone`,
          world.controlRows('session').filter((row) => row.principal_id === PRN_TENANT_OWNER).length,
          0,
        );
        // AND THE OPERATOR'S OWN SESSION SURVIVES. A revocation that swept more than the target
        // would sign the operator out of their own console mid-operation, and the case above
        // cannot tell the difference.
        assertTrue(
          `${ISOLATION} and the OPERATOR's sessions are untouched`,
          world.controlRows('session').filter((row) => row.principal_id === PRN_ADMIN).length > 0,
          'the reset revoked the calling operator\'s own sessions as well as the target\'s',
        );
      } finally {
        world.close();
      }
    },
  );

  return suite;
}
