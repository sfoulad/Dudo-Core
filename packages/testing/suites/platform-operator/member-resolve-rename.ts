/**
 * ===========================================================================================
 * `platform.organizations.members.resolve` — THE RENAME IS COMPLETE. `0034` PHASE 3 LANDED
 * 2026-09-09, AND THIS FILE IS WHAT REPLACED THE PHASE-1 SUITE RATHER THAN DELETING IT.
 * ===========================================================================================
 *
 * **WHAT THIS FILE USED TO ASSERT, kept because a withdrawn guarantee should leave a record and
 * not a gap.** The route declared `identifier`, the contract published `target_identifier`, and
 * the deployed console sent the old name — a client written against the CODE rather than the
 * contract, which is `workflow.md` §12's stated consequence arriving in practice. The sequence was
 * ~~Core accepts both~~ → ~~the console switches~~ → **Core drops `identifier`**, and all three
 * steps are now done. Three cases exercised the middle state and are struck: both spellings
 * resolving the same member, both-names-at-once being refused rather than silently preferred, and
 * the `??` trap where an explicit `null` fell through to the legacy value. **None of them can be
 * expressed any more — there is no second spelling to send.**
 *
 * ===========================================================================================
 * *** WHY THIS IS NOT SIMPLY A DELETION, WHICH IS THE HALF THAT IS EASY TO GET WRONG ***
 * ===========================================================================================
 *
 * The old phase-3 tripwire said, in its own text, *"delete this case and the two above it."*
 * **Following that literally would have left nothing watching this field name at all**, and
 * `§12`'s point is that sweeping a withdrawn guarantee's assertions is the easy instruction while
 * leaving something still watching is the one nobody is prompted to do.
 *
 * **So the question was: what is the next irreversible step here? There isn't one — phase 3 WAS
 * the last step.** That is a real answer rather than an excuse, and it changes what the guard
 * should be. What remains at risk is not another step in a sequence; it is **the reserved name
 * itself**. `architecture.md` §1a reserves `identifier` platform-wide with exactly one meaning,
 * precisely because it is *"the most natural name for the most common kind of field"* and will be
 * reached for again. **The guard below is that reservation, enforced across every route in the
 * class rather than on this one route** — so a fourth spelling, or the old name returning on any
 * route, lands on a red case instead of on nobody.
 *
 * ===========================================================================================
 * MEASURED END STATE, 2026-09-09 — every value below was observed, not expected
 * ===========================================================================================
 *
 *   { target_identifier: <member> }   ->  ok, principal resolved
 *   { identifier: <member> }          ->  invalid_argument  identifier / unknown_field
 *   { target_identifier: null }       ->  invalid_argument  target_identifier / must_be_a_primitive
 *   { }                               ->  invalid_argument  target_identifier / must_be_a_submittable_identifier
 *
 * **THE LAST LINE READ `identifier` FOR ABOUT AN HOUR — a residue in `platform-route-handlers.ts`,
 * found by this suite and repaired by `core-agent` the same day.** The rename reached the route
 * table and the contract and missed the handler's error detail. **Three places, two swept.**
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  ORG_ALPHA,
  SESSION_ADMIN,
  TENANT_OWNER_IDENTIFIER,
  createPlatformWorld,
  expectedInvalidArgument,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';

const ROUTE = 'platform.organizations.members.resolve';

/** The reserved name `architecture.md` §1a forbids as a field name platform-wide. */
const RESERVED = 'identifier';

async function resolve(world: PlatformWorld, body: Record<string, unknown>) {
  return world.call(ROUTE, {
    sessionId: SESSION_ADMIN,
    bodyText: JSON.stringify(body),
    pathParams: { organization_id: ORG_ALPHA },
  });
}

export function buildMemberResolveRenameSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('members.resolve — the rename is complete, and what still guards the name');

  suite.test('THE SURVIVING SPELLING RESOLVES — the floor for everything below', async () => {
    // WITHOUT THIS, the refusals below prove nothing: a route that refused EVERY request would
    // satisfy all three of them. The positive case is what makes the negatives mean something.
    const world = await make();
    try {
      const resolved = expectOk(
        'target_identifier resolves',
        await resolve(world, { target_identifier: TENANT_OWNER_IDENTIFIER }),
      ) as { principal_id: string; role: string };
      assertTrue(
        'and it actually found somebody, so this is not a green assertion over an empty answer',
        typeof resolved.principal_id === 'string' && resolved.principal_id.length > 0,
        `no principal was resolved: ${JSON.stringify(resolved)}`,
      );
      assertEqual('the resolved role is the seeded one', resolved.role, 'owner');
    } finally {
      world.close();
    }
  });

  suite.test('*** THE DEPRECATED SPELLING IS NOW REFUSED — this is what phase 3 MEANS ***', async () => {
    // ===================================================================================
    // THE ASSERTION THAT REPLACED "BOTH SPELLINGS RESOLVE THE SAME MEMBER".
    // ===================================================================================
    //
    // The old case proved the deprecated name still worked. This one proves it no longer does,
    // which is the same fact from the other side and is the evidence that phase 3 actually landed
    // rather than being reported as landed.
    //
    // THE CLASS REFUSES AN UNDECLARED FIELD BEFORE AUTHENTICATION, which is why the answer is
    // `unknown_field` rather than anything from the handler — and why the rename had to be
    // two-phase in the first place: publishing only the new name while the console sent the old
    // one would have refused every request the console made.
    const world = await make();
    try {
      expectError(
        `${ISOLATION} the removed spelling is rejected as an unknown field`,
        await resolve(world, { [RESERVED]: TENANT_OWNER_IDENTIFIER }),
        expectedInvalidArgument(RESERVED, 'unknown_field'),
      );
      // AND SENDING BOTH IS REFUSED FOR THE SAME REASON NOW, not for the old both-present reason.
      // Recorded because the ERROR CHANGED: a client that used to see `must_not_send_both_names`
      // now sees `unknown_field`, and a case asserting the old issue would be red for a correct
      // route. That is the shape of stale assertion this file exists to have swept.
      expectError(
        'both names at once is refused as an unknown field, not as both-present',
        await resolve(world, {
          target_identifier: TENANT_OWNER_IDENTIFIER,
          [RESERVED]: TENANT_OWNER_IDENTIFIER,
        }),
        expectedInvalidArgument(RESERVED, 'unknown_field'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an explicit null is still refused on its own terms', async () => {
    // THE SURVIVING HALF OF THE `??` TRAP. The trap itself is gone — there is no legacy value for
    // a null to fall through TO — but the layered refusal it exposed is still worth asserting.
    // `workflow.md` §11a: this is answered by the CLASS's body validation, one layer above the
    // handler's own `!== undefined` check, so the handler's guard is defence in depth here and
    // not the operative one. If the class check were relaxed this case would still pass via the
    // handler, and nothing would report that a layer had gone.
    const world = await make();
    try {
      expectError(
        `${ISOLATION} a null target_identifier is refused as a non-primitive`,
        await resolve(world, { target_identifier: null }),
        expectedInvalidArgument('target_identifier', 'must_be_a_primitive'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('EVERY REFUSAL NAMES THE FIELD THE CONTRACT PUBLISHES — the third place the rename had to reach', async () => {
    // ===================================================================================
    // *** WRITTEN AGAINST THE CORRECTED BEHAVIOUR, AND THE REASON IS THE POINT. ***
    // ===================================================================================
    //
    // A RESIDUE LIVED HERE FOR ABOUT AN HOUR. The rename completed in the route table and in the
    // contract, and `platform-route-handlers.ts` went on emitting `detail('identifier', …)` — so
    // a refusal named a field the route no longer declares and the contract no longer publishes,
    // sending a client to look for something that does not exist. **Two files were swept and the
    // third was not, which is `workflow.md` §12 in one line.** `core-agent` has repaired it.
    //
    // MY FIRST VERSION OF THIS CASE ASSERTED THE RESIDUE — `identifier` — so that it would go red
    // when Core fixed it. **That was the wrong way round and the Team Lead corrected it.** It is
    // the same defect this suite's sibling met this morning: `audit-anchor.ts`'s reader called a
    // CORRECT repair a defect, because it had been built around the broken state. **A check
    // written against what the code does today turns somebody else's correct fix into a red
    // build**, and the person who then has to prove they did nothing wrong is the one who fixed
    // it. Assert the destination, not the current position.
    //
    // MEASURED 2026-09-09, AFTER THE REPAIR — every one of these answers `target_identifier`:
    //   {}                        empty body
    //   { target_identifier: '' } too short
    //   'no-at-sign'              malformed
    //   42                        wrong type
    // The `null` case answers `must_be_a_primitive` from the class one layer above, and is
    // asserted separately in the case before this one.
    const world = await make();
    try {
      // A TABLE RATHER THAN ONE INPUT, because the residue was reachable by several routes into
      // the same detail and a single case would have proved only that one of them was swept.
      for (const [label, value] of [
        ['an empty body', undefined],
        ['an empty string', ''],
        ['a value that is too short', 'ab'],
        ['a value with no "@"', 'no-at-sign'],
        ['a value of the wrong type', 42],
      ] as ReadonlyArray<readonly [string, unknown]>) {
        expectError(
          `${ISOLATION} ${label} is refused, naming target_identifier`,
          await resolve(world, value === undefined ? {} : { target_identifier: value }),
          expectedInvalidArgument('target_identifier', 'must_be_a_submittable_identifier'),
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('*** THE RESERVATION: no route in the platform class declares `identifier` ***', () => {
    // ===================================================================================
    // THIS IS WHAT REPLACED THE PHASE-3 TRIPWIRE, AND IT IS DELIBERATELY WIDER THAN IT WAS.
    // ===================================================================================
    //
    // The old tripwire asserted the CURRENT state of ONE route so that removing the name would be
    // deliberate. That job is done and cannot be done twice. **What outlives it is
    // `architecture.md` §1a's platform-wide reservation**, whose whole argument is that
    // `identifier` is the most natural name for the most common kind of field and will be reached
    // for again — by an author who was not here for the rename and has no reason to know.
    //
    // SCOPE IS THE POINT: every route in the class, not this one. §1a is explicit that a
    // reservation scoped to "the contracts that compose with it today" is *"correct the day it was
    // written and silently wrong the first time a route changed sensitivity."*
    const routes = platformRoutes();

    // THE FLOOR, FIRST. An empty or collapsed route table would satisfy every assertion below by
    // examining nothing — the failure `§11a` records as the most confident wrong answer available.
    assertTrue(
      `${ISOLATION} the route table was read and is populated`,
      routes.length >= 10,
      `only ${String(routes.length)} platform routes were found; there were 15 on 2026-09-09. A ` +
        'smaller table means this check is drawing from an empty population and reporting success',
    );
    const route = routes.find((entry) => entry.id === ROUTE);
    assertTrue(
      'and the route under test is registered',
      route !== undefined,
      `${ROUTE} is not in platformRoutes, so the assertions below assert nothing`,
    );

    assertEqual(
      `${ISOLATION} ${ROUTE} declares the new name and only the new name`,
      [...route!.fields].join(','),
      'target_identifier',
    );

    // THE RESERVATION ITSELF. Reported by name rather than as a count, so a failure says WHICH
    // route reintroduced it rather than that some route did.
    const offenders = routes
      .filter((entry) => entry.fields.includes(RESERVED))
      .map((entry) => entry.id);
    assertEqual(
      `${ISOLATION} no platform route declares the reserved name '${RESERVED}'`,
      offenders.join(' · '),
      '',
    );

    // AND THE POPULATION THE RESERVATION WAS CHECKED OVER, against a count derived elsewhere.
    // "No route declares it" and "no route was examined" render identically without this.
    const fieldCount = routes.reduce((sum, entry) => sum + entry.fields.length, 0);
    console.log(
      `        reservation: '${RESERVED}' absent from ${String(fieldCount)} declared fields ` +
        `across ${String(routes.length)} platform routes`,
    );
    assertTrue(
      'and those routes declare a substantial number of fields between them',
      fieldCount >= 10,
      `only ${String(fieldCount)} fields are declared across the whole class; the reservation was ` +
        'checked against almost nothing, which is not the same as finding nothing',
    );
  });

  return suite;
}
