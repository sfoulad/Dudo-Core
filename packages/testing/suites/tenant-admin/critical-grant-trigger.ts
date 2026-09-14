/**
 * ===========================================================================================
 * `0038`'s DEFERRAL TRIGGER, DRIVEN — `assertNoRoleHoldsAnUnclearedCriticalPermission`.
 * ===========================================================================================
 *
 * **`0038` defers the Action-class challenge route on a population measured at zero**, and it
 * first named a safety net that **could not see an Action**. `core-agent` measured that and
 * replaced it with this assertion, which keys on the event itself.
 *
 * > **AN UNTESTED REPLACEMENT IS THE SAME DEFERRAL STANDING ON A DIFFERENT LEG.** That is why
 * > this file exists, and the amendment it belongs to is the argument for it.
 *
 * ===========================================================================================
 * ⚠ TWO OF THE THREE THINGS THIS CASE WAS COMMISSIONED TO DO HAVE NO SUBJECT, AND THAT IS
 * THE FINDING RATHER THAN A GAP
 * ===========================================================================================
 *
 * The brief asked for a case that (2) accepts *"a `critical` permission that is NOT Action-class,
 * or the check is refusing more than it claims"*, and (3) catches the assertion **transcribing an
 * Action route registry** — `0039` names two such tables and one is under `apps/**`.
 *
 * **THE IMPLEMENTATION DELIBERATELY REFUSES TO CLASSIFY, AND SAYS SO IN TERMS:**
 *
 *   > *"CLASSIFYING A PERMISSION AS ACTION-CLASS IS THE PART THAT WOULD GO WRONG. A namespace
 *   >  heuristic — `core.*` is a route, anything else is an App — is a guess that is correct today
 *   >  and silently wrong the first time a Core Action carries a `critical` permission or an App
 *   >  declares a route. So this asks a question it can actually answer: is this critical
 *   >  permission one somebody deliberately decided a tenant role may hold?"*
 *
 * **SO THERE IS NO REGISTRY LIST TO DERIVE AND NO ACTION-CLASS PREDICATE TO GET WRONG.** It reads
 * `criticalPermissions()` and an allow-list that is empty, `architecture.md` §3a-i — **the
 * exception is the allow-list and everything else is refused by DEFAULT**, whatever it gates.
 *
 * > **IT REFUSES MORE THAN `0038`'s TRIGGER ASKS FOR, ON PURPOSE.** A critical permission that
 * > gates a platform route, or something nobody has invented, fires it too. **That is an
 * > over-approximation in the safe direction and the case below PINS IT AS SUCH** — because the
 * > brief's own instinct, *"or the check is refusing more than it claims"*, is exactly the
 * > argument somebody will use to narrow it to Action-class, which would reinstate the guess the
 * > author refused to make.
 *
 * ===========================================================================================
 * AND THE ASSERTION'S POPULATION REPORT HAS NO CONSUMER. THIS FILE IS ITS FIRST.
 * ===========================================================================================
 *
 * It returns `{ grantsExamined, criticalHeld }` precisely because *"a count of zero critical
 * grants and a check that stopped working render identically"*. **`roles.ts` calls it at load and
 * DISCARDS the value.** So the instrument that distinguishes those two states exists and nothing
 * reads it — `workflow.md` §11a's population rule, satisfied at the producer and dropped at the
 * consumer. **The POPULATION case below is the only thing in this repository that reads it.**
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type { PermissionGrant, PrincipalGrants } from '../../../../platform/core/authorization/authorizer.ts';
import type { MembershipRole } from '../../../../platform/core/authorization/roles.ts';
import {
  MEMBERSHIP_ROLES,
  RoleMappingIncoherentError,
  assertNoRoleHoldsAnUnclearedCriticalPermission,
  grantsForRole,
} from '../../../../platform/core/authorization/roles.ts';
import { criticalPermissions } from '../../../../platform/core/confirmation/critical-permissions.ts';

/**
 * The Action-class `critical` permission `0038` names by id.
 *
 * **NOT INVENTED AND NOT A PLACEHOLDER.** `0038`'s measurement is *"tenant-scope `critical`
 * permissions in the catalogue 14; of those, gating an ACTION-class operation 1 —
 * `customers.customer.delete`"*, and `critical-permissions.ts` carries it in the same list.
 * **Granting it to a tenant role IS the event the deferral is waiting for**, so the trigger case
 * drives the real thing rather than a stand-in that would fire for a different reason.
 */
const ACTION_CLASS_CRITICAL = 'customers.customer.delete';

/** The real mapping, rebuilt through the public accessor because `GRANTS_BY_ROLE` is not exported. */
function realMapping(): Readonly<Record<MembershipRole, PrincipalGrants>> {
  const out = {} as Record<MembershipRole, PrincipalGrants>;
  for (const role of MEMBERSHIP_ROLES) {
    out[role] = grantsForRole(role);
  }
  return Object.freeze(out);
}

/** The real mapping with one extra grant on one role — the mutation a grant actually is. */
function mappingGranting(role: MembershipRole, permissionId: string): Readonly<Record<MembershipRole, PrincipalGrants>> {
  const base = realMapping();
  const grant: PermissionGrant = { permissionId, scope: 'organization' } as PermissionGrant;
  return Object.freeze({
    ...base,
    [role]: { grants: Object.freeze([...base[role].grants, grant]) },
  });
}

/** A refusal, and A CRASH IS NOT ONE. Three states: refused, accepted, the assertion itself broke. */
function refusal(run: () => void): RoleMappingIncoherentError | null {
  try {
    run();
    return null;
  } catch (cause) {
    if (cause instanceof RoleMappingIncoherentError) return cause;
    throw new Error(
      `the assertion threw ${cause instanceof Error ? cause.constructor.name : typeof cause} ` +
        `rather than refusing: ${cause instanceof Error ? cause.message : String(cause)}. A CRASH ` +
        'IS NOT A REFUSAL and must not be read as one.',
      { cause },
    );
  }
}

export function buildCriticalGrantTriggerSuite(): Suite {
  const suite = new TestSuite("0038 — the deferral trigger: no tenant role holds an uncleared `critical` permission");

  suite.test('POPULATION — and this case is the ONLY consumer of the value roles.ts discards', () => {
    const critical = criticalPermissions();
    const measured = assertNoRoleHoldsAnUnclearedCriticalPermission();
    console.log(
      `      critical permissions declared: ${String(critical.length)} · ` +
        `grants examined: ${String(measured.grantsExamined)} · critical held: ${String(measured.criticalHeld)}`,
    );

    // THE FLOOR THAT CARRIES THE WHOLE CHECK, and nothing else in the repository asserts it.
    // `criticalPermissions()` is the ONLY thing that makes this assertion capable of refusing:
    // hand it an empty list and it walks every grant, matches nothing, and passes — which is
    // indistinguishable from the honest zero it reports today. The VACUITY case below drives that
    // exact substitution; this is the floor that says the real reader has not become it.
    assertTrue(
      'floor: `criticalPermissions()` is NOT empty — it is what gives this check any power at all',
      critical.length >= 10,
      `criticalPermissions() returned ${String(critical.length)} entries. With an empty or ` +
        'truncated list the assertion examines every grant, matches nothing and passes. That is ' +
        'the same green it reports today, and no other check would notice.',
    );
    assertTrue(
      'floor: the Action-class permission 0038 measured is still in that list',
      critical.includes(ACTION_CLASS_CRITICAL),
      `'${ACTION_CLASS_CRITICAL}' is no longer declared critical. 0038's whole measurement — one ` +
        'Action-class critical operation, held by no role — is about this permission. If it has ' +
        'stopped being critical that is a decision, and the deferral should be re-read.',
    );

    // The grant population, DERIVED INDEPENDENTLY rather than taken from the assertion's own count.
    // Two derivations that share a source are one derivation; this one walks the accessor.
    const independent = MEMBERSHIP_ROLES.reduce((total, role) => total + grantsForRole(role).grants.length, 0);
    assertEqual(
      'the assertion examined every grant — counted independently through the accessor',
      measured.grantsExamined,
      independent,
    );
    assertEqual(
      'PIN: no tenant role holds a `critical` permission of ANY kind. This is 0038\'s premise',
      measured.criticalHeld,
      0,
    );
  });

  /* ---------------------------------------------------------------------------------------
   * THE TRIGGER — driven, not described
   * --------------------------------------------------------------------------------------- */

  suite.test(`${ISOLATION} THE TRIGGER FIRES — a role granted the Action-class critical permission`, () => {
    // `0038`'s trigger, stated as the event: *"the first `critical` Action-class operation that
    // any role can hold."* Driven by adding the grant to the REAL mapping, which is the mutation
    // a grant actually is — not by handing the assertion a synthetic mapping it would never see.
    const thrown = refusal(() => {
      assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting('owner', ACTION_CLASS_CRITICAL));
    });
    assertTrue(
      `${ISOLATION} granting ${ACTION_CLASS_CRITICAL} to a tenant role FAILS the build`,
      thrown !== null,
      `a tenant role was granted '${ACTION_CLASS_CRITICAL}' — a critical permission gating an ` +
        'ACTION — and the assertion accepted it. 0038 defers the Action-class challenge route on ' +
        'the measured ground that no role could hold one; with this check silent, the trigger ' +
        'fires as every call to that operation failing in production and no build ever goes red.',
    );
    assertTrue(
      'and the refusal names the role, the permission, and the deferral',
      thrown !== null &&
        thrown.message.includes('owner') &&
        thrown.message.includes(ACTION_CLASS_CRITICAL) &&
        thrown.message.includes('0038'),
      `the message does not route the reader to the decision: ${thrown?.message ?? '(none)'}`,
    );
    // AND IT MUST NOT OFFER THE ALLOW-LIST AS THE FIRST REMEDY. A refusal whose advice is "add it
    // to the exception list" is a refusal that gets cleared by adding it to the exception list.
    assertTrue(
      'and it says REOPEN THE DECISION rather than "add it to the list"',
      thrown !== null && /reopen/iu.test(thrown.message),
      `the refusal does not tell the reader to reopen 0038, so the cheapest way to clear it is ` +
        `to widen the allow-list — which is the one action that must not be casual: ${thrown?.message ?? ''}`,
    );
  });

  suite.test('EVERY ROLE, not just one — the trigger is not a property of where it was inserted', () => {
    // The loop runs over MEMBERSHIP_ROLES; a check keyed accidentally on the first role would pass
    // the case above and miss a grant to `member`. Four roles, four refusals.
    for (const role of MEMBERSHIP_ROLES) {
      assertTrue(
        `${ISOLATION} granting it to \`${role}\` fires too`,
        refusal(() => {
          assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting(role, ACTION_CLASS_CRITICAL));
        }) !== null,
        `a grant to '${role}' was accepted while a grant to another role was refused. The check ` +
          'is not examining every role in MEMBERSHIP_ROLES.',
      );
    }
  });

  /* ---------------------------------------------------------------------------------------
   * BOTH DIRECTIONS — and the second one is not the one the brief predicted
   * --------------------------------------------------------------------------------------- */

  suite.test('THE CONTROL — the real mapping is ACCEPTED, or the check refuses everything', () => {
    // A check that refuses every input is not a check, and the trigger cases above cannot tell the
    // difference. This is the input the build actually runs on.
    assertEqual(
      'the shipped role mapping passes',
      refusal(() => {
        assertNoRoleHoldsAnUnclearedCriticalPermission();
      }),
      null,
    );
    // AND A NON-CRITICAL GRANT IS ACCEPTED, which is the direction that stops the check being a
    // blanket refusal of any added grant.
    assertEqual(
      'a NON-critical permission added to a role is accepted',
      refusal(() => {
        assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting('member', 'core.customer.read'));
      }),
      null,
    );
  });

  suite.test('THE CLEARED DIRECTION — an allow-listed critical permission is accepted', () => {
    // The allow-list is EMPTY today, so this direction is unexercised by the real corpus and the
    // `cleared` parameter could be ignored entirely without anything going red. Driven with the
    // parameter, which is the only way to reach it.
    assertEqual(
      'a critical permission ON the cleared list is accepted',
      refusal(() => {
        assertNoRoleHoldsAnUnclearedCriticalPermission(
          mappingGranting('owner', ACTION_CLASS_CRITICAL),
          criticalPermissions(),
          [ACTION_CLASS_CRITICAL],
        );
      }),
      null,
    );
    // And the pin on the real list, so the day somebody clears one there is a red that asks who
    // granted it and when — which is what the refusal message demands be recorded.
    const measured = assertNoRoleHoldsAnUnclearedCriticalPermission();
    assertEqual(
      'PIN: the cleared list is EMPTY. A non-empty one is a privilege decision needing the user',
      measured.criticalHeld,
      0,
    );
  });

  suite.test(`${ISOLATION} THE OVER-APPROXIMATION IS DELIBERATE — a NON-Action critical permission fires it too`, () => {
    // ⚠ THIS CASE EXISTS TO REFUSE A NARROWING, NOT TO CHECK A BEHAVIOUR.
    //
    // The commissioning brief expected the opposite: *"a role holding a critical permission that
    // is NOT Action-class -> accepted, or the check is refusing more than it claims."* **It IS
    // refusing more than 0038's trigger asks for, and that is the design.**
    //
    // `core-agent`'s reasoning, which this pin protects: classifying a permission as Action-class
    // is *"a guess that is correct today and silently wrong the first time a Core Action carries a
    // critical permission or an App declares a route."* So the allow-list is the exception and
    // everything else is refused by default — `architecture.md` §3a-i.
    //
    // **IF THIS CASE EVER GOES RED, SOMEBODY HAS TAUGHT THE CHECK TO CLASSIFY.** That reinstates
    // the guess, and the failure mode is a critical permission reaching a role while the check
    // decides it is "not Action-class" and stays quiet.
    const platformCritical = 'core.credential.reset';
    // THE "IS NOT THE ACTION-CLASS ONE" HALF IS NOT ASSERTED, AND THAT IS A FINDING RATHER THAN AN
    // OMISSION. Writing it produced `TS2367 — types '"core.credential.reset"' and
    // '"customers.customer.delete"' have no overlap`: both are literal constants, so the compiler
    // already knows they differ and the runtime assertion could never fail.
    //
    // `§11a`: *a test asserting something the type forbids is a test that can never fail*, and
    // casting to make it compile converts a compile-time guarantee into a runtime check that never
    // fires. **The layer carrying it is the two `const` declarations.** What remains genuinely
    // checkable is that this one is critical, which is a fact about the corpus.
    assertTrue(
      'floor: the permission used here is critical — distinctness is held by the two literals',
      criticalPermissions().includes(platformCritical),
      `'${platformCritical}' is not in criticalPermissions(), so this case is granting an ` +
        'ORDINARY permission and the refusal below would be testing nothing.',
    );
    assertTrue(
      `${ISOLATION} a critical permission gating something OTHER than an Action still fires it`,
      refusal(() => {
        assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting('admin', platformCritical));
      }) !== null,
      'the check accepted an uncleared critical permission because it is not Action-class. THAT ' +
        'IS A NARROWING AND IT REINSTATES THE GUESS THE AUTHOR REFUSED TO MAKE — the allow-list ' +
        'is the exception and everything else is refused by default (architecture.md §3a-i). A ' +
        'critical permission on a tenant role needs a confirmation route whatever it gates.',
    );
  });

  /* ---------------------------------------------------------------------------------------
   * THE VACUITY — the reader this check's whole power rests on
   * --------------------------------------------------------------------------------------- */

  suite.test('THE VACUITY IS CLOSED IN CORE — and this case was written while it was open', () => {
    // ===========================================================================================
    // ⚠ THIS CASE ASSERTED THE OPPOSITE AN HOUR AGO, AND THE CHANGE IS THE RECORD.
    // ===========================================================================================
    //
    // Written at 14:55 to demonstrate a live vacuity: hand the assertion an EMPTY `critical` list
    // and it walks every grant, matches nothing, passes, and reports `criticalHeld: 0` —
    // **identical to the honest zero it reports today**, on a mapping granting the Action-class
    // critical permission to the owner.
    //
    // **IT WENT RED ON ITS FIRST RUN BECAUSE `core-agent` HAD CLOSED IT AT 14:55:55**, minutes
    // after I read the file, with two floors: an empty critical set and an empty grant mapping,
    // both REFUSED rather than reported.
    //
    // **AND ITS COMMENT NAMES WHY MY EXISTING FLOOR WAS NOT ENOUGH**, which is the part worth
    // keeping: `suites/platform-operator/confirmation.ts` already asserts
    // `criticalPermissions().length > 0` — *"but that runs in a suite and this runs at MODULE
    // LOAD, so between a broken registry and the next suite run the build is green and this check
    // is examining nothing."* **A suite cannot floor a module-load assertion. Only the assertion
    // can.**
    //
    // So the case now pins the closure from the outside, which a suite CAN do.
    const firesNormally = refusal(() => {
      assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting('owner', ACTION_CLASS_CRITICAL));
    });
    assertTrue('control: with the real critical list, this mapping is refused', firesNormally !== null, 'not refused');

    const emptyCritical = refusal(() => {
      assertNoRoleHoldsAnUnclearedCriticalPermission(mappingGranting('owner', ACTION_CLASS_CRITICAL), []);
    });
    assertTrue(
      `${ISOLATION} an EMPTY critical set is REFUSED, not reported`,
      emptyCritical !== null,
      'the assertion accepted an empty critical set. It then compares every grant against nothing ' +
        'and passes, reporting the identical `criticalHeld: 0` a correct tree reports — and it is ' +
        "the ONLY trigger for 0038's deferral, so a silent zero is that deferral losing its " +
        'collector with nothing going red.',
    );
    assertTrue(
      'and the refusal says it examined nothing, rather than naming a role',
      emptyCritical !== null && /EMPTY/u.test(emptyCritical.message),
      `the refusal does not identify itself as the empty-set floor: ${emptyCritical?.message ?? '(none)'}`,
    );

    // THE SECOND FLOOR, same pass: a mapping in which no role grants anything.
    // BUILT KEY BY KEY RATHER THAN CAST. `Object.fromEntries` types to an index signature, and
    // casting past that is the move `§11a` warns about — it would also have hidden a role missing
    // from the mapping entirely, which is a different defect this case is not about.
    const emptyMapping = {} as Record<MembershipRole, PrincipalGrants>;
    for (const role of MEMBERSHIP_ROLES) {
      emptyMapping[role] = { grants: [] };
    }
    const noGrants = refusal(() => {
      assertNoRoleHoldsAnUnclearedCriticalPermission(emptyMapping);
    });
    assertTrue(
      `${ISOLATION} a mapping granting NOTHING is REFUSED — the other way to examine nothing`,
      noGrants !== null,
      'the assertion accepted a mapping in which no role grants any permission. Every tenant role ' +
        'is defined with a non-empty grant list, so zero means the mapping is not being read.',
    );
    console.log(
      '      both floors fire: empty critical set, and empty grant mapping. Neither is reachable ' +
        'from a correct tree, and both render as an honest zero without them.',
    );
  });

  return suite;
}
