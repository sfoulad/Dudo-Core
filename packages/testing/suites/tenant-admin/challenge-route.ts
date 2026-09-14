/**
 * ===========================================================================================
 * THE CHALLENGE ROUTE'S MACHINERY — two properties proved by controls that died with their
 * session, plus the self-clearing deferral, in all three of its states.
 * ===========================================================================================
 *
 * `core-agent` found both defects on 2026-09-13 with a control that PRINTED WHAT THE FACTORY
 * PRODUCED. **Neither was findable by reading**, and that is the whole reason these are cases:
 * `§11a` — *a probe proves a property once; only a suite case proves it tomorrow.*
 *
 * ===========================================================================================
 * WHAT IS NOT ASSERTED HERE, DELIBERATELY: THAT THE ROUTE REGISTERS. IT CANNOT, AND THAT IS
 * THE MECHANISM WORKING.
 * ===========================================================================================
 *
 * Both registration paths fail and **both failures are correct**:
 *
 * ```
 * confirmable map EMPTY      -> conjunctionsOf refuses the empty resolvable set
 * confirmable map POPULATED  -> assertEveryRoutePermissionIsReachable fires — the two `critical`
 *                               tenant operations' permissions are in no role and no envelope
 * ```
 *
 * `0038`'s own sentence covers it: *a route whose permission no role holds fails at build time,
 * **which is the mechanism working rather than an obstacle***. So this file asserts the
 * MACHINERY, and `THE DEFERRAL PIN` below records the two refusals so that the day the grant
 * lands, something goes red and says the route is now registerable.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type {
  TenantAdminConjunction,
  TenantAdminReadBound,
  TenantAdminRouteLike,
} from '../../../../platform/core/tenant-admin/tenant-admin-routes.ts';
import {
  TENANT_ADMIN_CHALLENGE_ROUTE_ID,
  TenantAdminRegistrationError,
  assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist,
  assertEveryRoutePermissionIsReachable,
  buildTenantAdminChallengeRoute,
  conjunctionsOf,
  requires,
  tenantAdminConfirmableOperations,
} from '../../../../platform/core/tenant-admin/tenant-admin-routes.ts';

/* =============================================================================================
 * FIXTURES
 * ============================================================================================= */

/** A POPULATED confirmable map. The vacuity answer — see `THE AGREEMENT` below. */
const CONFIRMABLE: Readonly<Record<string, TenantAdminConjunction>> = Object.freeze({
  'tenant.organization.transfer-ownership': requires('core.organization.transfer-ownership'),
  'tenant.organization.request-deletion': requires('core.organization.request-deletion'),
});

function targetRoute(id: string, overrides: Partial<TenantAdminRouteLike> = {}): TenantAdminRouteLike {
  const base = {
    id,
    method: 'POST',
    path: '/organization',
    permission: { kind: 'all-of', permissionIds: ['core.organization.update'] },
    fields: [],
    queryParameters: [],
    readBound: { kind: 'no-collection', why: 'a fixture target' } satisfies TenantAdminReadBound,
    audit: 'required',
    successStatus: 200,
  } as unknown as TenantAdminRouteLike;
  return { ...base, ...overrides };
}

/** Every target the populated map names, so the factory's own existence check is satisfied. */
function targetsFor(map: Readonly<Record<string, TenantAdminConjunction>>): readonly TenantAdminRouteLike[] {
  return Object.keys(map).map((id) => targetRoute(id));
}

/**
 * A from-body permission built from two SEPARATE maps — the shipped defect, reconstructed.
 *
 * **THIS IS THE REALISTIC MUTATION** (`§11a`: a control built from an invented mutation tests the
 * pattern against itself and always passes). The real defect was exactly this shape: `resolvable`
 * closed over the factory's parameter while `resolve` called the module-level accessor.
 */
function divergentPermission(
  resolveMap: Readonly<Record<string, TenantAdminConjunction>>,
  resolvableMap: Readonly<Record<string, TenantAdminConjunction>>,
): TenantAdminRouteLike['permission'] {
  return {
    kind: 'from-body' as const,
    resolve: (body: Readonly<Record<string, unknown>>) => {
      const actionId = body['action_id'];
      return typeof actionId === 'string' &&
        Object.prototype.hasOwnProperty.call(resolveMap, actionId)
        ? resolveMap[actionId]
        : undefined;
    },
    resolvable: () => Object.freeze(Object.values(resolvableMap)),
  } as unknown as TenantAdminRouteLike['permission'];
}

/** A refusal, and A CRASH IS NOT ONE — the same three-state helper the sibling suite uses. */
function refusal(run: () => void): TenantAdminRegistrationError | null {
  try {
    run();
    return null;
  } catch (cause) {
    if (cause instanceof TenantAdminRegistrationError) return cause;
    throw new Error(
      `the assertion threw ${cause instanceof Error ? cause.constructor.name : typeof cause} ` +
        `rather than refusing: ${cause instanceof Error ? cause.message : String(cause)}. A CRASH ` +
        'IS NOT A REFUSAL and must not be read as one.',
      { cause },
    );
  }
}

/**
 * THE PROPERTY, AS A FUNCTION, SO THE KNOWN-FAILING INPUT DRIVES THE SAME CODE THE REAL CASE DOES.
 *
 * *** `resolve` AND `resolvable` AGREE ON EVERY INPUT. *** Returns the disagreements, so a caller
 * can assert emptiness and print what disagreed rather than a bare boolean.
 */
function disagreements(
  permission: TenantAdminRouteLike['permission'],
  domain: readonly string[],
): readonly string[] {
  if (permission.kind !== 'from-body') return ['the permission is not a from-body permission'];
  const advertised = permission.resolvable();
  const out: string[] = [];
  for (const actionId of domain) {
    const resolved = permission.resolve({ action_id: actionId });
    if (resolved === undefined) {
      out.push(`${actionId}: resolvable() advertises a domain but resolve() returns undefined`);
      continue;
    }
    if (!advertised.includes(resolved)) {
      out.push(`${actionId}: resolve() produced a conjunction that resolvable() does not advertise`);
    }
  }
  // AND THE OTHER DIRECTION. Without it, a `resolvable` returning a SUPERSET passes — which is the
  // shipped defect's mirror and is just as invisible to every registration check.
  const reachable = new Set(
    domain.map((actionId) => permission.resolve({ action_id: actionId })).filter((c) => c !== undefined),
  );
  for (const conjunction of advertised) {
    if (!reachable.has(conjunction)) {
      out.push(
        `resolvable() advertises [${conjunction.permissionIds.join(' AND ')}], which resolve() ` +
          'never produces for any id in the domain',
      );
    }
  }
  return out;
}

/* =============================================================================================
 * THE SUITE
 * ============================================================================================= */

export function buildChallengeRouteSuite(): Suite {
  const suite = new TestSuite('0044 §3e — the challenge route: the resolver, and the self-clearing deferral');

  suite.test('POPULATION — the confirmable map today, and the fixture that is not it', () => {
    const live = tenantAdminConfirmableOperations();
    console.log(`      TENANT_ADMIN_CONFIRMABLE_OPERATIONS: ${live.length === 0 ? '(empty)' : live.join(', ')}`);
    console.log(`      fixture map used below: ${Object.keys(CONFIRMABLE).join(', ')}`);
    // THE FLOOR THAT MAKES EVERY CASE BELOW NON-VACUOUS. With an empty fixture map, `resolve`
    // returns undefined for every input and `resolvable` returns [] — so the agreement case would
    // pass against two functions that ignore their arguments entirely.
    assertTrue(
      'floor: the fixture map is POPULATED, or the agreement case is vacuous',
      Object.keys(CONFIRMABLE).length >= 2,
      'the fixture confirmable map is empty or trivial. `resolve` and `resolvable` both return ' +
        'nothing for every input against an empty map, so they agree vacuously and the case ' +
        'below would pass against an implementation that read no map at all.',
    );
    assertEqual(
      'PIN: the live map is still empty — move this when a confirmable operation is added',
      live.length,
      0,
    );
  });

  /* ---------------------------------------------------------------------------------------
   * 1. THE EMPTY RESOLVABLE SET IS A REFUSAL, NOT `[]`
   * --------------------------------------------------------------------------------------- */

  suite.test(`${ISOLATION} AN EMPTY RESOLVABLE SET IS REFUSED — otherwise every reachability check passes on nothing`, () => {
    // The route that gates the most dangerous operations in the class is exactly the route whose
    // checks would iterate zero times. `§11a`'s empty-list reader, at the worst possible site.
    const empty = targetRoute(TENANT_ADMIN_CHALLENGE_ROUTE_ID, {
      permission: divergentPermission({}, {}),
    });
    const thrown = refusal(() => {
      conjunctionsOf(empty);
    });
    assertTrue(
      `${ISOLATION} conjunctionsOf REFUSES rather than returning []`,
      thrown !== null,
      'conjunctionsOf returned normally on an empty resolvable set. Every registration check ' +
        'iterates what it returns, so all of them would then be green while examining nothing.',
    );
    assertTrue(
      'and the refusal says WHY, so the next reader does not "fix" it by populating a check',
      thrown !== null && thrown.message.includes('NOTHING'),
      `message did not explain the vacuity: ${thrown?.message ?? '(none)'}`,
    );
  });

  suite.test('THE CONTROL — conjunctionsOf ACCEPTS a well-formed route, in BOTH variants', () => {
    // A check that refuses everything is not a check. Both variants, because the flattening is the
    // single place the union collapses and a control on one branch says nothing about the other.
    const fromBody = targetRoute(TENANT_ADMIN_CHALLENGE_ROUTE_ID, {
      permission: divergentPermission(CONFIRMABLE, CONFIRMABLE),
    });
    const flattened = conjunctionsOf(fromBody);
    assertEqual(
      'from-body: the whole resolvable domain is returned',
      flattened.length,
      Object.keys(CONFIRMABLE).length,
    );

    const fixed = targetRoute('tenant.members.list');
    const one = conjunctionsOf(fixed);
    assertEqual('all-of: a fixed route flattens to its single conjunction', one.length, 1);
    assertEqual(
      'and it is the route\'s own conjunction, not a fabricated one',
      one[0]?.permissionIds.join(','),
      'core.organization.update',
    );
  });

  /* ---------------------------------------------------------------------------------------
   * 2. THE AGREEMENT — the one with no natural home
   * --------------------------------------------------------------------------------------- */

  suite.test(`${ISOLATION} THE AGREEMENT — resolve and resolvable read the SAME object, on every input`, () => {
    // ===========================================================================================
    // *** THE DEFECT THIS EXISTS FOR, AND WHY NO CHECK COULD SEE IT. ***
    // ===========================================================================================
    //
    //   resolvable()  closed over the `confirmable` PARAMETER      -> advertised the domain
    //   resolve()     called the module-level accessor             -> read the frozen EMPTY constant
    //
    // Built with a populated map, the route would have **advertised a resolvable domain and
    // refused EVERY well-formed request with `invalid_argument`, permanently** — and every
    // registration check would have been GREEN, because they all read `resolvable()`, which was
    // the half that was right.
    //
    // **Two derivations of one fact, disagreeing precisely where nothing looks.**
    //
    // THE VACUITY QUESTION, ASKED BEFORE THIS WAS WRITTEN: against the LIVE map, which is empty,
    // `resolve` returns undefined for every input and `resolvable` returns [] — they agree, and
    // the case would pass against two functions that never read a map. **So it is driven with the
    // populated fixture map**, and the floor in POPULATION is what keeps that true.
    const route = buildTenantAdminChallengeRoute(CONFIRMABLE, targetsFor(CONFIRMABLE));
    const found = disagreements(route.permission, Object.keys(CONFIRMABLE));
    for (const actionId of Object.keys(CONFIRMABLE)) {
      const resolved =
        route.permission.kind === 'from-body'
          ? route.permission.resolve({ action_id: actionId })
          : undefined;
      console.log(`        ${actionId} -> ${resolved?.permissionIds.join(' AND ') ?? 'UNDEFINED'}`);
    }
    assertEqual(
      `${ISOLATION} the two accessors agree on every id in the domain, in both directions`,
      found.join(' · '),
      '',
    );
  });

  suite.test('KNOWN-FAILING INPUT — the two accessors reading DIFFERENT maps is caught', () => {
    // The shipped defect exactly: `resolve` reads the empty module constant, `resolvable` reads the
    // populated parameter. A mutation a real author makes by adding an accessor — which is how it
    // happened.
    const divergent = divergentPermission({}, CONFIRMABLE);
    const found = disagreements(divergent, Object.keys(CONFIRMABLE));
    console.log(`      the divergent pair produced ${String(found.length)} disagreement(s):`);
    for (const line of found) console.log(`        ${line}`);
    assertTrue(
      'the agreement check CATCHES the shipped defect',
      found.length > 0,
      'the agreement check reported no disagreement against a permission whose `resolve` reads an ' +
        'EMPTY map while `resolvable` advertises two conjunctions. That is the exact defect it ' +
        'exists for, so the check is not checking.',
    );
    // AND THE MIRROR, which the one-directional version would miss: `resolve` produces something
    // `resolvable` never advertises. A registration check reading only `resolvable` is blind to it.
    const mirror = divergentPermission(CONFIRMABLE, {
      'tenant.organization.transfer-ownership': requires('core.organization.transfer-ownership'),
    });
    const mirrorFound = disagreements(mirror, Object.keys(CONFIRMABLE));
    assertTrue(
      `${ISOLATION} and the MIRROR — a resolvable set that under-advertises what resolve produces`,
      mirrorFound.length > 0,
      'a permission resolving to a conjunction its own resolvable() does not advertise was not ' +
        'caught. That direction is what a registration check reading only resolvable() cannot see.',
    );
  });

  /* ---------------------------------------------------------------------------------------
   * 3. THE DERIVED FIELD LIST — the duplicate that reached parsePreAuthBody
   * --------------------------------------------------------------------------------------- */

  suite.test('THE DERIVED ALLOW-LIST carries no duplicate — it IS parsePreAuthBody\'s allow-list', () => {
    // The first defect the control found: the factory spread its parameter set after two literals
    // and emitted `['action_id','locale','action_id','cursor']`. That list is not cosmetic — it is
    // the allow-list `parsePreAuthBody` receives.
    //
    // Driven with a target that LEGITIMATELY declares `action_id`, which is the input that produced
    // the duplicate. A target declaring neither would pass against the broken version too.
    const targets = [
      targetRoute('tenant.organization.transfer-ownership', {
        fields: ['action_id', 'cursor'] as unknown as TenantAdminRouteLike['fields'],
      }),
      targetRoute('tenant.organization.request-deletion'),
    ];
    const route = buildTenantAdminChallengeRoute(CONFIRMABLE, targets);
    const fields = [...route.fields];
    console.log(`      derived fields: [${fields.join(', ')}]`);
    assertEqual(
      'no duplicate survives into the allow-list',
      fields.length,
      new Set(fields).size,
    );
    assertTrue(
      'floor: the collision input actually reached the factory',
      fields.includes('action_id') && fields.includes('cursor'),
      `the target's own fields did not reach the derived list, so the collision was never ` +
        `exercised: [${fields.join(', ')}]`,
    );
  });

  /* ---------------------------------------------------------------------------------------
   * 4. THE SELF-CLEARING DEFERRAL, IN ALL THREE STATES
   * --------------------------------------------------------------------------------------- */

  suite.test('THE SELF-CLEARING DEFERRAL — all three states, because only the middle one is the mechanism', () => {
    // `workflow.md` §12: a deferral nothing collects is one nobody performs. This assertion is what
    // makes "register the challenge route" fail the BUILD rather than sit in a comment — the day
    // somebody adds a confirmable operation, the build says the route is missing.
    //
    // Three states, and the two ends are what stop the middle being satisfiable by accident: an
    // assertion that threw always, or never, would look identical in the one state we live in.
    const challenge = targetRoute(TENANT_ADMIN_CHALLENGE_ROUTE_ID, {
      permission: divergentPermission(CONFIRMABLE, CONFIRMABLE),
    });

    // STATE 1 — today. No confirmable operations, no route. SILENT, and correctly so.
    assertEqual(
      'state 1 · map EMPTY, no route  -> silent. This is today, and it is not a failure',
      refusal(() => {
        assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist([], []);
      }),
      null,
    );

    // STATE 2 — THE MECHANISM. An operation is confirmable and nothing can issue a challenge for
    // it: an operation that authorizes, gates, and can never be satisfied.
    const thrown = refusal(() => {
      assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist([], Object.keys(CONFIRMABLE));
    });
    assertTrue(
      `${ISOLATION} state 2 · map POPULATED, no route -> REFUSED. This is the self-clearing half`,
      thrown !== null,
      'a confirmable operation with no challenge route was accepted at registration. The deferral ' +
        'is then a comment again, and the obligation is one nobody collects.',
    );
    assertTrue(
      'and it names the operations, so the reader knows what made it fire',
      thrown !== null && thrown.message.includes('tenant.organization.transfer-ownership'),
      `message did not name the confirmable operations: ${thrown?.message ?? '(none)'}`,
    );

    // STATE 3 — cleared. The route is registered, so the obligation is discharged.
    assertEqual(
      'state 3 · map POPULATED, route registered -> silent. The deferral has cleared',
      refusal(() => {
        assertChallengeRouteIsRegisteredWhenConfirmableOperationsExist(
          [challenge],
          Object.keys(CONFIRMABLE),
        );
      }),
      null,
    );
  });

  suite.test('THE DEFERRAL PIN — both registration paths refuse today, and BOTH refusals are correct', () => {
    // NOT a case asserting the route registers. It cannot, and that is the mechanism working
    // (`0038`). This records the two refusals so the day either changes, something says so.
    //
    // Path 1: the live map is empty, so `conjunctionsOf` refuses the challenge route outright.
    const live = tenantAdminConfirmableOperations();
    const liveRoute = buildTenantAdminChallengeRoute();
    const emptyPath = refusal(() => {
      conjunctionsOf(liveRoute);
    });
    assertTrue(
      'path 1 · with the LIVE (empty) map, the challenge route cannot pass registration',
      live.length === 0 && emptyPath !== null,
      live.length === 0
        ? 'the live map is empty and conjunctionsOf did NOT refuse — the empty-resolvable-set rule ' +
          'has stopped holding on the real route.'
        : `the live confirmable map is no longer empty (${live.join(', ')}). THIS IS THE EVENT ` +
          'THIS PIN EXISTS FOR: read the two paths below, and if the permissions are now granted ' +
          'the challenge route is registerable and should be registered.',
    );
    // Path 2: populate the map and the OTHER check fires. **DRIVEN, NOT DESCRIBED.** The first
    // version of this case printed path 2 as prose — which is `architecture.md` §3c's defect in my
    // own file: a sentence asserting what an assertion does, with nothing that opens it.
    const populated = targetRoute(TENANT_ADMIN_CHALLENGE_ROUTE_ID, {
      permission: divergentPermission(CONFIRMABLE, CONFIRMABLE),
    });
    const reachabilityPath = refusal(() => {
      assertEveryRoutePermissionIsReachable([populated]);
    });
    assertTrue(
      'path 2 · with the map POPULATED, assertEveryRoutePermissionIsReachable refuses instead',
      reachabilityPath !== null,
      'the challenge route built over the two critical tenant operations PASSED the reachability ' +
        'check. That means their permissions are now declared AND held by a role — THE GRANT HAS ' +
        'LANDED. Both refusals that make this route unregisterable are gone, so register it: ' +
        'buildTenantAdminChallengeRoute() in ROUTES, and its id in TenantAdminRouteId.',
    );

    console.log(
      `      path 1 · live map empty       -> ${emptyPath === null ? 'ACCEPTED (!)' : 'refused'} — ` +
        'the empty resolvable set',
    );
    console.log(
      `      path 2 · map populated        -> ${reachabilityPath === null ? 'ACCEPTED (!)' : 'refused'} — ` +
        `${reachabilityPath?.message.slice(0, 96) ?? ''}…`,
    );
    console.log(
      '      BOTH ARE CORRECT. The route is unregisterable BY MECHANISM, not by omission, and the ' +
        'blocker is the grant rather than this class.',
    );
  });

  return suite;
}
