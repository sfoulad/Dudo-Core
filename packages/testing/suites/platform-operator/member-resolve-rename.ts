/**
 * ===========================================================================================
 * `platform.organizations.members.resolve` — PHASE 1 OF A TWO-PHASE FIELD RENAME.
 * ===========================================================================================
 *
 * The route declared `identifier`; the contract published `target_identifier`; **the deployed
 * console sent `identifier` and the route worked.** It worked because the client had been written
 * against the CODE rather than against the contract — which is `workflow.md` §12's stated
 * consequence arriving in practice: *"once one client has done that successfully, the contract has
 * stopped being the source of truth for everyone."*
 *
 * The sequence is **Core accepts both -> the console switches -> Core drops `identifier`** (`OD-5`).
 * This file is the suite for the middle state, and the middle state is the one nobody writes cases
 * for because it is temporary.
 *
 * ===========================================================================================
 * WHY THE INTERESTING CASE IS THE ONE THAT REFUSES
 * ===========================================================================================
 *
 * Accepting two spellings is easy and almost writes itself. **The hazard is what happens when both
 * arrive**, and Core's answer is to refuse rather than to prefer:
 *
 * > *"if the two values differ, choosing silently is choosing which principal to resolve"* — on the
 * > route that leads to a credential reset.
 *
 * A route that quietly prefers one also lets a client send the wrong name forever and never learn,
 * so the deprecation never completes. **Refusing has a known-failing input; preferring is a
 * behaviour nobody would ever write a case for.**
 *
 * ===========================================================================================
 * *** WHAT THIS SUITE CANNOT ASSERT, AND IT IS THE THING PHASE 3 NEEDS. ***
 * ===========================================================================================
 *
 * `resolveMember` collapses the two names into one local value before it does anything else, and
 * **nothing downstream records which spelling arrived** — not the action log, not the response,
 * not a counter. So the question *"is any client still sending the old name"* has no answer in
 * this system.
 *
 * That matters because `OD-5` — dropping `identifier` — is the change that breaks whichever client
 * is still sending it, and **without that evidence the cutover is an assumption rather than a
 * measurement.** The console is not the only possible caller: the Apple client and any script are
 * the ones nobody would remember to check.
 *
 * Reported to the Team Lead rather than built here: recording it is Core's, and a test cannot
 * assert a fact the system does not keep.
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

async function resolve(world: PlatformWorld, body: Record<string, unknown>) {
  return world.call(ROUTE, {
    sessionId: SESSION_ADMIN,
    bodyText: JSON.stringify(body),
    pathParams: { organization_id: ORG_ALPHA },
  });
}

export function buildMemberResolveRenameSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('members.resolve — the two-phase rename, and the state nobody tests');

  suite.test('BOTH SPELLINGS RESOLVE THE SAME MEMBER — the phase-1 guarantee', async () => {
    const world = await make();
    try {
      // THE NEW NAME, which the contract publishes and the console does not yet send.
      const modern = expectOk(
        'target_identifier resolves',
        await resolve(world, { target_identifier: TENANT_OWNER_IDENTIFIER }),
      ) as { principal_id: string; role: string };

      // THE DEPRECATED NAME, which the deployed console DOES send. If this ever goes red, the
      // console is broken in production and `OD-5` was discharged out of order.
      const legacy = expectOk(
        'identifier — the deprecated spelling the deployed console sends — still resolves',
        await resolve(world, { identifier: TENANT_OWNER_IDENTIFIER }),
      ) as { principal_id: string; role: string };

      // AND THEY AGREE. Two spellings accepted is not the guarantee; two spellings meaning the
      // SAME THING is. A route that accepted both and resolved them differently would pass a
      // pair of "it returns 200" assertions and be the exact defect the refusal below prevents.
      assertEqual(
        `${ISOLATION} the two spellings resolve to the same principal`,
        modern.principal_id,
        legacy.principal_id,
      );
      assertEqual('and to the same role', modern.role, legacy.role);
      assertTrue(
        'the resolution actually found somebody — so the agreement above is not two nulls',
        typeof modern.principal_id === 'string' && modern.principal_id.length > 0,
        `no principal was resolved: ${JSON.stringify(modern)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('*** BOTH NAMES AT ONCE IS REFUSED, NOT SILENTLY PREFERRED ***', async () => {
    const world = await make();
    try {
      // THE VALUES ARE DELIBERATELY DIFFERENT. If they were identical, a route that silently
      // preferred one would return the same answer as a route that refused, and this case would
      // pass against the behaviour it exists to forbid.
      expectError(
        `${ISOLATION} both spellings present is an argument error`,
        await resolve(world, {
          target_identifier: TENANT_OWNER_IDENTIFIER,
          identifier: 'someone.else@example.invalid',
        }),
        expectedInvalidArgument('target_identifier', 'must_not_send_both_names'),
      );

      // AND NEITHER IS ACCEPTED EITHER. "Exactly one" has two failure modes and a suite that
      // asserts only the first would pass on a route that accepted an empty body.
      expectError(
        'neither spelling present is refused too',
        await resolve(world, {}),
        expectedInvalidArgument('identifier', 'must_be_a_submittable_identifier'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE `??` TRAP: an explicit null does NOT fall through to the legacy value', async () => {
    // ===================================================================================
    // THE CONSTRUCTED FAILING INPUT FOR A ONE-CHARACTER DEFECT THAT WOULD NEVER LOOK WRONG.
    // ===================================================================================
    //
    // Core's handler comments name this precisely: `??` treats an explicit `null` as absent, so
    // `{"target_identifier": null, "identifier": "x"}` would slip past the both-present refusal
    // and then resolve the LEGACY value — a request that names the new field and is answered from
    // the old one. `!== undefined` is the distinction, and **nothing about reading the code makes
    // the difference visible; only this input does.**
    //
    // *** IT IS REFUSED A LAYER EARLIER THAN THE HANDLER, AND THAT IS WORTH RECORDING RATHER
    // THAN SMOOTHING OVER. *** I expected `must_be_a_submittable_identifier` from the handler's
    // own shape check, which is what Core's comment describes — *"a present-but-null field falls
    // through to the shape check below and is refused there."* The measured answer is
    // `must_be_a_primitive` on `target_identifier`, from the CLASS's body validation, which runs
    // before the handler does.
    //
    // So the handler's `!== undefined` is **defence in depth rather than the operative guard for
    // this input**, and the class check is what actually refuses it. Both are correct and the
    // outcome is safe either way. It is recorded because `workflow.md` §11a's point about layered
    // enforcement applies directly: **if the class check were relaxed, this case would still pass
    // via the handler and nothing would report that a layer had gone.** The case below asserts the
    // outer layer's exact answer, which is the one a client actually receives.
    const world = await make();
    try {
      expectError(
        `${ISOLATION} a null target_identifier beside a legacy identifier is refused`,
        await resolve(world, { target_identifier: null, identifier: TENANT_OWNER_IDENTIFIER }),
        expectedInvalidArgument('target_identifier', 'must_be_a_primitive'),
      );
      // THE MIRROR, so the refusal above is about the null rather than about the pair. With the
      // null replaced by a real value, the SAME two fields are refused as both-present — a
      // different error, which is what shows the null was handled on its own terms.
      expectError(
        'and with a real value in its place the pair is refused as both-present instead',
        await resolve(world, {
          target_identifier: TENANT_OWNER_IDENTIFIER,
          identifier: TENANT_OWNER_IDENTIFIER,
        }),
        expectedInvalidArgument('target_identifier', 'must_not_send_both_names'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE PHASE-3 TRIPWIRE: the deprecated name is still declared, and its removal is a two-file change', () => {
    // ===================================================================================
    // *** THIS CASE IS SUPPOSED TO GO RED WHEN `OD-5` IS DISCHARGED. THAT IS ITS PURPOSE. ***
    // ===================================================================================
    //
    // A deprecation with no expiry is a permanent second name. This asserts the CURRENT state so
    // that removing `identifier` is a deliberate act that lands on a case saying what else must
    // move with it — rather than a quiet edit to a frozen array that nothing notices.
    //
    // WHEN IT GOES RED: check that the contract's `oneOf` came out in the same change, that the
    // console no longer sends the old name, and that `harness/platform-fixture.ts`'s
    // `successfulCallFor` — which sends `identifier` today — was moved too. Then delete this case
    // and the two above it that exercise the legacy spelling.
    const routes = platformRoutes();
    const route = routes.find((entry) => entry.id === ROUTE);
    assertTrue(
      'the route is registered at all — the floor for everything below',
      route !== undefined,
      `${ROUTE} is not in platformRoutes, so this case is asserting nothing`,
    );
    assertEqual(
      'the route declares exactly the two spellings, in this order',
      [...route!.fields].join(','),
      'identifier,target_identifier',
    );
    // AND THE CLASS-LEVEL FACT THAT FORCED BOTH TO BE DECLARED: the platform route class refuses
    // an undeclared field BEFORE authentication, so publishing only the new name would have
    // refused the field the deployed console sends. That is the outage direction, and it is why
    // the rename is two-phase rather than one edit.
    assertTrue(
      'and no other route in the class declares the deprecated spelling',
      routes.filter((entry) => entry.fields.includes('identifier')).length === 1,
      'a second route now declares `identifier`, so OD-5 is no longer a one-route change and ' +
        'this tripwire is understating the work',
    );
  });

  return suite;
}
