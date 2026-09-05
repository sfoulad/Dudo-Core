/**
 * ===========================================================================================
 * THE MUTUAL-EXCLUSION TRAP. `docs/decisions/0024` · `docs/decisions/0025` decision 1 ·
 * contract `platform-operator-v1`, `authorityModel.theMutualExclusionInvariant`.
 * ===========================================================================================
 *
 * THIS IS THE HIGHEST-VALUE SUITE IN THE PLATFORM WORK, and the contract names its central case
 * word for word:
 *
 *   "Seed one principal into BOTH tables, then assert that every platform route AND every Action
 *   denies it, with the same codes an unknown principal receives."
 *
 * BOTH HALVES OF THAT SENTENCE ARE TESTED SEPARATELY BELOW, because they are enforced in two
 * different files and only one of them exists. The platform half is
 * `platform/core/platform/platform-authority.ts`, which reads both tables on every request. The
 * ACTION half would have to be `platform/core/identity/session-resolution.ts`, which knows nothing
 * about `platform_operator` — and `platform-authority.ts`'s own header says so. The case at the
 * bottom of this file asserts the contract's requirement rather than the implementation's current
 * behaviour, and it is expected to be RED. A test that described the gap as acceptable would be
 * the suite agreeing to the defect.
 *
 * ===========================================================================================
 * WHY "DENIED" IS NOT ENOUGH, AND WHAT THE THIRD IDENTIFIER IS FOR
 * ===========================================================================================
 *
 * A refusal that is merely a refusal is still an oracle if it differs from the refusal an unknown
 * principal receives: a caller able to detect the mutual-exclusion state could use these routes to
 * probe `organization_membership`. So every anti-oracle case here compares THREE values:
 *
 *   PRN_BOTH_TABLES   the forbidden state
 *   PRN_STRANGER      a real principal, real session, in NEITHER table
 *   PRN_NOWHERE       *** FABRICATED. It exists in no table at all. ***
 *
 * The third is the control that makes the other two evidence. Two real identifiers show that
 * filtering does not happen; they do not show that the refusal is uninformative. This project's
 * own earlier isolation work missed exactly this.
 *
 * ===========================================================================================
 * WORK, NOT ONLY ANSWERS
 * ===========================================================================================
 *
 * `session-resolution.ts` records the reason equal answers are not enough: *"The ERROR was already
 * identical; THE WORK WAS NOT, and work is measurable."* `platform-authority.ts` claims to issue
 * both reads unconditionally on every path. That claim is asserted here over the recorded SQL
 * rather than read out of the comment.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  ORG_ALPHA,
  PRN_ADMIN,
  SESSION_ADMIN,
  PRN_BOTH_TABLES,
  PRN_NOWHERE,
  PRN_STRANGER,
  PRN_TENANT_OWNER,
  SESSION_BOTH_TABLES,
  SESSION_BOTH_TABLES_SELECTED,
  SESSION_STRANGER,
  SESSION_TENANT_OWNER,
  SESSION_TENANT_OWNER_SELECTED,
  createPlatformControlPlane,
  createPlatformWorld,
  seedMembership,
  seedOrganization,
  seedPlatformOperator,
  seedPrincipal,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import type { PlatformRouteId } from '../../../../platform/core/platform/platform-routes.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import {
  assertNotAPlatformOperator,
  assertNotAnOrganizationMember,
} from '../../../../platform/core/platform/platform-authority.ts';
import type { PlatformOperatorStore } from '../../../../platform/core/platform/platform-operator-store.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';

const ROUTE_IDS: readonly PlatformRouteId[] = platformRoutes().map((route) => route.id);

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** Raises whatever `node:sqlite` raised, or `null` when the statement succeeded. */
function attempt(run: () => void): Error | null {
  try {
    run();
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

export function buildMutualExclusionSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — the mutual exclusion (0024, 0025 decision 1)');

  // =========================================================================================
  // The platform half: every route in the class.
  // =========================================================================================

  suite.test('EVERY platform route refuses a principal present in both tables', async () => {
    const world = await make();
    try {
      // The fixture control first: the state under test actually exists in the database. Without
      // this, every assertion below would pass against a principal that is simply not an operator.
      const operatorRows = world.control.raw
        .prepare('SELECT COUNT(*) AS n FROM platform_operator WHERE principal_id = ?')
        .all(PRN_BOTH_TABLES) as { n: number }[];
      const membershipRows = world.control.raw
        .prepare('SELECT COUNT(*) AS n FROM organization_membership WHERE principal_id = ?')
        .all(PRN_BOTH_TABLES) as { n: number }[];
      assertEqual('the fixture really holds a platform_operator row', operatorRows[0].n, 1);
      assertEqual('the fixture really holds an organization_membership row', membershipRows[0].n, 1);

      assertTrue('the class has routes to test', ROUTE_IDS.length > 0, 'the route table is empty');
      const answers: string[] = [];
      for (const routeId of ROUTE_IDS) {
        const answer = await world.call(routeId, { sessionId: SESSION_BOTH_TABLES });
        assertTrue(
          `${ISOLATION} ${routeId} refuses a principal in both tables`,
          !answer.ok,
          `the route SUCCEEDED for a principal present in both tables: ${show(answer)}`,
        );
        answers.push(show((answer as { error: unknown }).error));
      }
      // WHICH code it is belongs to its own case below, because the contract and the
      // implementation currently disagree about it and that disagreement must not be able to hide
      // inside this case — which is about whether the principal is refused at all.
      assertEqual(
        `${ISOLATION} and every route in the class refuses it the same way`,
        new Set(answers).size,
        1,
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'the refusal is identical to a stranger\'s and to a fabricated principal\'s',
    async () => {
      const world = await make();
      try {
        // --- At the route layer: a real principal in neither table, and a tenant owner.
        for (const routeId of ROUTE_IDS) {
          const stranger = await world.call(routeId, { sessionId: SESSION_STRANGER });
          const tenantOwner = await world.call(routeId, { sessionId: SESSION_TENANT_OWNER });
          assertTrue(
            `${ISOLATION} ${routeId} refused both`,
            !stranger.ok && !tenantOwner.ok,
            `stranger=${show(stranger)} owner=${show(tenantOwner)}`,
          );
          assertEqual(
            `${ISOLATION} ${routeId}: a tenant owner answers exactly what a stranger answers`,
            show((tenantOwner as { error: unknown }).error),
            show((stranger as { error: unknown }).error),
          );
        }

        // --- At the authority layer, where a FABRICATED identifier can be named directly.
        //
        // THIS IS THE LAYER THE CONTRACT'S `errors.forbidden` CLAUSE DESCRIBES — the four denial
        // causes it collapses are all decided in `platform-authority.ts`. The route layer cannot
        // reach `PRN_NOWHERE` at all: it has no session, so it would be refused one step earlier
        // and the comparison would be between two different questions. The resolver takes a
        // principal identifier, so the fabricated control belongs here.
        const both = await world.dependencies.authority.resolve(PRN_BOTH_TABLES);
        const stranger = await world.dependencies.authority.resolve(PRN_STRANGER);
        const nowhere = await world.dependencies.authority.resolve(PRN_NOWHERE);
        expectError(`${ISOLATION} both tables is forbidden`, both, EXPECTED_FORBIDDEN);
        expectError(`${ISOLATION} a stranger is forbidden`, stranger, EXPECTED_FORBIDDEN);
        expectError(
          `${ISOLATION} a FABRICATED principal that exists in no table is forbidden`,
          nowhere,
          EXPECTED_FORBIDDEN,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test(
    'a platform route refuses a both-tables principal with the code the contract names',
    async () => {
      // `platform-operator-v1`, `errors.forbidden`, lists FOUR causes that receive the identical
      // argument-free `forbidden`, and the fourth is "A PRINCIPAL PRESENT IN BOTH TABLES". This
      // case asserts that sentence.
      //
      // IT IS ISOLATED FROM THE CASE ABOVE ON PURPOSE, AND THE REASON IS A REGRESSION IT CAUGHT.
      //
      // When the Action-side mutual exclusion first landed it refused inside
      // `session-resolution.ts::liveSession` — which the platform class also passes through for
      // authentication — so a both-tables principal received `unauthenticated` on a platform
      // route. THE PRINCIPAL WAS STILL REFUSED, so a suite asserting only "it is refused" would
      // have stayed green; but the fourth cause had become distinguishable from the other three
      // BY STATUS CODE ALONE, which re-opens the probe of `organization_membership` that the
      // four-way collapse exists to close.
      //
      // `session-resolution.ts` now splits the fact from the refusal: `liveSession` refuses with
      // the Action class's `unauthenticated`, and `resolvePrincipalId` passes the principal
      // through to `platform-authority.ts`, which refuses with this class's `forbidden`. THE SAME
      // RULE ANSWERS WITH TWO CODES BECAUSE THE CODE BELONGS TO THE REQUEST CLASS RATHER THAN TO
      // THE RULE. Both halves are asserted — this case, and `the Action path refuses…` below.
      //
      // KEEP THE TWO CASES SEPARATE. Merging them back would restore exactly the blind spot that
      // let the regression through.
      const world = await make();
      try {
        for (const routeId of ROUTE_IDS) {
          expectError(
            `${routeId}: the contract's fourth forbidden cause`,
            await world.call(routeId, { sessionId: SESSION_BOTH_TABLES }),
            EXPECTED_FORBIDDEN,
          );
        }
      } finally {
        world.close();
      }
    },
  );

  suite.test('a mutual-exclusion refusal writes NO platform-operator action record', async () => {
    const world = await make();
    try {
      for (const routeId of ROUTE_IDS) {
        await world.call(routeId, { sessionId: SESSION_BOTH_TABLES });
        await world.call(routeId, { sessionId: SESSION_STRANGER });
      }
      assertEqual(
        'no record is written for a caller whose authority did not resolve',
        world.actionRows().length,
        0,
      );

      // The positive control. Without it this case would pass on a world where auditing is broken
      // for everyone, which is the opposite of the property being claimed.
      expectOk(
        'a real operator is served',
        await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }),
      );
      assertEqual(
        'and a real operator DOES produce a record — so the zero above is the rule, not a fault',
        world.actionRows().length,
        1,
      );
    } finally {
      world.close();
    }
  });

  suite.test('both reads run on every denial path — the work is equal, not just the answer', async () => {
    const world = await make();
    try {
      function statementsFor(principalId: string): Promise<readonly string[]> {
        const before = world.control.statements.length;
        return world.dependencies.authority.resolve(principalId).then(() =>
          world.control.statements.slice(before).map((entry) => entry.sql),
        );
      }

      const both = await statementsFor(PRN_BOTH_TABLES);
      const stranger = await statementsFor(PRN_STRANGER);
      const nowhere = await statementsFor(PRN_NOWHERE);
      const admin = await statementsFor(PRN_ADMIN);

      assertEqual(
        `${ISOLATION} a principal in both tables costs the same statements as a stranger`,
        both.join(' | '),
        stranger.join(' | '),
      );
      assertEqual(
        `${ISOLATION} and the same as a fabricated principal that exists nowhere`,
        both.join(' | '),
        nowhere.join(' | '),
      );
      assertEqual(
        `${ISOLATION} and the same as a real operator's successful resolution`,
        both.join(' | '),
        admin.join(' | '),
      );
      assertEqual('exactly two statements, every time', both.length, 2);
      assertTrue(
        'one of them reads platform_operator',
        both.some((sql) => sql.includes('platform_operator')),
        both.join(' | '),
      );
      assertTrue(
        'the other probes organization_membership',
        both.some((sql) => sql.includes('organization_membership')),
        both.join(' | '),
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // The write side. Core's TypeScript guards, and then the triggers underneath them.
  // =========================================================================================

  suite.test("Core's own write guards refuse before any INSERT is attempted", async () => {
    const world = await make();
    try {
      const before = world.control.statements.length;

      // BOTH DIRECTIONS ANSWER THE ARGUMENT-FREE `not_found`. `platform-operator-v1`
      // §`theWRITESIDEGUARDANSWERS_not_found_AND_NOT_conflict`, normative since 2026-09-05.
      //
      // *** `not_found` ON A WRITE GUARD LOOKS LIKE A BUG, AND THE REASON IS THE PART THAT HAS TO
      // SURVIVE. *** The row is not missing — it is present — and every instinct says `conflict`.
      // But `conflict` on "grant this principal platform authority" tells the caller the principal
      // IS ALREADY AN OPERATOR, and the mirror guard tells a tenant administrator the same about
      // any principal they can name. That is an ENUMERATION OF THE PLATFORM'S OPERATORS, available
      // to whoever can attempt a membership write, and it is the single most useful fact this
      // surface could leak.
      //
      // SO THE ASSERTION IS THE PROPERTY AND NOT ONLY THE TOKEN: the two directions answer
      // identically. A future reviewer who "corrects" `not_found` back to `conflict` breaks the
      // second assertion as well as the first, and the message points at the clause.
      const towardOperator = await assertNotAnOrganizationMember(world.store, PRN_TENANT_OWNER);
      const towardMembership = await assertNotAPlatformOperator(world.store, PRN_ADMIN);
      expectError(
        'a principal holding a membership may not become a platform operator',
        towardOperator,
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'a platform operator may not be given a membership',
        towardMembership,
        EXPECTED_NOT_FOUND,
      );
      assertEqual(
        `${ISOLATION} the two directions of one invariant answer identically`,
        show((towardOperator as { error: unknown }).error),
        show((towardMembership as { error: unknown }).error),
      );

      // THE POINT OF THIS CASE. A trigger firing means the application-layer check had a gap, so
      // the guards must refuse without a write ever reaching the engine.
      const issued = world.control.statements.slice(before).map((entry) => entry.sql);
      assertTrue(
        'the guards issued no INSERT into either table',
        issued.every((sql) => !sql.toUpperCase().includes('INSERT')),
        issued.join(' | '),
      );

      // The positive controls: an eligible principal is not refused, or the two cases above would
      // pass against a guard that refuses everything.
      expectOk(
        'a principal with no membership may become an operator',
        await assertNotAnOrganizationMember(world.store, PRN_STRANGER),
      );
      expectOk(
        'a principal with no operator row may be given a membership',
        await assertNotAPlatformOperator(world.store, PRN_STRANGER),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an UNRECOGNISED platform_role still blocks a membership being granted', async () => {
    // The database `CHECK` forbids storing a role outside the union, so this state cannot be built
    // through the fixture — it is what a FUTURE migration would write. A store double is the only
    // way to reach it, and the property is worth reaching: the invariant is about the row's
    // existence, not about what it currently grants.
    const doubled: PlatformOperatorStore = {
      async findOperator() {
        return ok({ principalId: PRN_STRANGER, platformRole: null, createdAt: '2026-09-05T09:00:00.000Z' });
      },
      async principalHasAnyMembership() {
        return ok(false);
      },
      async listOrganizations() {
        return ok([]);
      },
      async recordAction() {
        return ok(undefined);
      },
    };
    expectError(
      'a row this build does not understand is still a platform_operator row',
      await assertNotAPlatformOperator(doubled, PRN_STRANGER),
      EXPECTED_NOT_FOUND,
    );
  });

  suite.test('the database CHECK refuses a platform_role outside the union', () => {
    const control = createPlatformControlPlane();
    try {
      seedPrincipal(control, PRN_STRANGER);
      const raised = attempt(() => {
        seedPlatformOperator(control, PRN_STRANGER, 'super-admin');
      });
      assertTrue(
        'an unrecognised role cannot be written by this build',
        raised !== null,
        'the CHECK constraint accepted a value outside the union',
      );
    } finally {
      control.close();
    }
  });

  // =========================================================================================
  // The four triggers of `0010`. Each is asserted to FIRE, and each is asserted to be the thing
  // that fired — the same statement succeeds in a world built without the migration.
  //
  // *** THESE ARE NOT THE D1 VERIFICATION AND MUST NOT BE QUOTED AS IT. *** The Team Lead ran all
  // four directions against a REAL local D1 with `0008`–`0010` applied, with both negative controls
  // passing, and that is the measurement of record for the database half. These run against
  // `node:sqlite`, which is a different SQLite build.
  //
  // WHAT THEY ADD THAT THE D1 RUN COULD NOT: the layering. The D1 run shows the write is refused;
  // it cannot show WHICH layer refused it, and `0025` requires the TypeScript check to be the
  // control with the triggers as a second layer. A trigger firing in production means the
  // application-layer check had a gap — so "refused" alone cannot tell a working system from a
  // broken one leaning on its backstop. `Core's own write guards refuse before any INSERT is
  // attempted` is the case that separates them, and it asserts over the recorded SQL rather than
  // over the outcome.
  // =========================================================================================

  type TriggerCase = {
    readonly name: string;
    readonly run: (control: ReturnType<typeof createPlatformControlPlane>) => void;
  };

  const TRIGGER_CASES: readonly TriggerCase[] = [
    {
      name: 'INSERT INTO platform_operator for a principal that already holds a membership',
      run: (control) => {
        seedPlatformOperator(control, PRN_TENANT_OWNER, 'platform-admin');
      },
    },
    {
      name: 'INSERT INTO organization_membership for a principal that is a platform operator',
      run: (control) => {
        seedMembership(control, PRN_ADMIN, ORG_ALPHA, 'owner');
      },
    },
    {
      name: 'UPDATE platform_operator.principal_id onto a principal that holds a membership',
      run: (control) => {
        control.raw
          .prepare('UPDATE platform_operator SET principal_id = ? WHERE principal_id = ?')
          .run(PRN_TENANT_OWNER, PRN_ADMIN);
      },
    },
    {
      name: 'UPDATE organization_membership.principal_id onto a platform operator',
      run: (control) => {
        control.raw
          .prepare('UPDATE organization_membership SET principal_id = ? WHERE principal_id = ?')
          .run(PRN_ADMIN, PRN_TENANT_OWNER);
      },
    },
  ];

  /** The minimum world each trigger case needs, built without the seeded both-tables principal. */
  function createTriggerWorld(withTriggers: boolean): ReturnType<typeof createPlatformControlPlane> {
    const control = createPlatformControlPlane({ withMutualExclusionTriggers: withTriggers });
    seedOrganization(control, ORG_ALPHA);
    seedPrincipal(control, PRN_ADMIN);
    seedPrincipal(control, PRN_TENANT_OWNER);
    seedPlatformOperator(control, PRN_ADMIN, 'platform-admin');
    seedMembership(control, PRN_TENANT_OWNER, ORG_ALPHA, 'owner');
    return control;
  }

  for (const triggerCase of TRIGGER_CASES) {
    suite.test(`0010 aborts: ${triggerCase.name}`, () => {
      const withTriggers = createTriggerWorld(true);
      try {
        const raised = attempt(() => {
          triggerCase.run(withTriggers);
        });
        assertTrue(
          `${ISOLATION} the write is refused`,
          raised !== null,
          'the statement succeeded, so the forbidden state is creatable by hand-run SQL',
        );
        assertTrue(
          'and it is refused by a mutual-exclusion trigger, naming 0024',
          raised !== null && raised.message.includes('0024'),
          `the raised message was: ${raised === null ? '(none)' : raised.message}`,
        );
      } finally {
        withTriggers.close();
      }

      // THE NEGATIVE CONTROL FOR THE TRIGGER ITSELF. The same statement, the same seed, without
      // `0010` applied. If it also failed here, the case above would be evidence of a foreign key
      // or a CHECK rather than of the trigger.
      const withoutTriggers = createTriggerWorld(false);
      try {
        const raised = attempt(() => {
          triggerCase.run(withoutTriggers);
        });
        assertTrue(
          'without 0010 the same statement succeeds — so 0010 is what refused it',
          raised === null,
          `without the triggers the statement still failed: ${raised === null ? '' : raised.message}`,
        );
      } finally {
        withoutTriggers.close();
      }
    });
  }

  suite.test('0010 does not validate rows that already exist', () => {
    // The migration says so in capitals, and an unasserted capital letter is a comment. This is
    // what makes the authorization-side check the control rather than a second opinion.
    const control = createPlatformControlPlane({ withMutualExclusionTriggers: false });
    try {
      seedOrganization(control, ORG_ALPHA);
      seedPrincipal(control, PRN_BOTH_TABLES);
      seedPlatformOperator(control, PRN_BOTH_TABLES, 'platform-admin');
      seedMembership(control, PRN_BOTH_TABLES, ORG_ALPHA, 'owner');

      const raised = attempt(() => {
        control.raw.exec(
          `CREATE TRIGGER IF NOT EXISTS membership_excludes_platform_operator_on_insert
           BEFORE INSERT ON organization_membership FOR EACH ROW
           WHEN EXISTS (SELECT 1 FROM platform_operator WHERE principal_id = NEW.principal_id)
           BEGIN SELECT RAISE(ABORT, 'docs/decisions/0024'); END;`,
        );
      });
      assertTrue('the trigger applies to an already-violating database', raised === null, String(raised));

      const rows = control.raw
        .prepare('SELECT COUNT(*) AS n FROM platform_operator WHERE principal_id = ?')
        .all(PRN_BOTH_TABLES) as { n: number }[];
      assertEqual(
        'the pre-existing violating row is untouched — triggers are not a repair',
        rows[0].n,
        1,
      );
    } finally {
      control.close();
    }
  });

  // =========================================================================================
  // THE ACTION HALF. `0025`: "refused everywhere, not resolved in favour of either."
  // =========================================================================================

  suite.test(
    'the Action path refuses a principal present in both tables (0025: refused everywhere)',
    async () => {
      const world = await make();
      try {
        // THE POSITIVE CONTROL FIRST. An ordinary owner with the same Organization selected must
        // resolve to a full principal, or the assertion below would pass because resolution is
        // broken for everyone rather than because the mutual exclusion is enforced.
        const owner = expectOk(
          'an ordinary tenant owner resolves to an authenticated principal',
          await world.sessions.resolve(SESSION_TENANT_OWNER_SELECTED),
        ) as { kind: string; principal?: { organizationId: string } };
        assertEqual('the control really is authenticated', owner.kind, 'authenticated');
        assertEqual(
          'and it is scoped to the Organization it selected',
          owner.principal?.organizationId,
          ORG_ALPHA,
        );

        // THE CASE. The same session shape, for the principal that is in BOTH tables.
        const both = await world.sessions.resolve(SESSION_BOTH_TABLES_SELECTED);
        assertTrue(
          `${ISOLATION} the Action path does not hand a tenant principal to a principal that ` +
            'holds platform authority',
          !both.ok || (both.value as { kind: string }).kind !== 'authenticated',
          'session-resolution.ts resolved a principal present in BOTH platform_operator and ' +
            'organization_membership into a full AuthenticatedPrincipal, scoped to the tenant, ' +
            'carrying that membership role\'s grants. platform-operator-v1 requires that "every ' +
            'platform route AND every Action" deny this principal. Actual: ' +
            show(both),
        );

        // AND THE ANSWER IS THE ACTION CLASS'S OWN COLLAPSE, not a fifth distinguishable one.
        // `liveSession` already answers `unauthenticated` for a session that does not exist, one
        // that expired, a deleted principal and a suspended principal; this joins those four
        // rather than standing beside them. A caller cannot discover it is in both tables, so it
        // cannot use an Action to probe `platform_operator`.
        const unknownSession = await world.sessions.resolve('ses_exists_nowhere1');
        assertTrue('both were refused', !both.ok && !unknownSession.ok, show(both));
        assertEqual(
          `${ISOLATION} it is byte-identical to an unknown session's refusal`,
          show((both as { error: unknown }).error),
          show((unknownSession as { error: unknown }).error),
        );
      } finally {
        world.close();
      }
    },
  );

  return suite;
}
