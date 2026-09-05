/**
 * ===========================================================================================
 * THE FOUR DENIAL CAUSES, AND WHY ALL FOUR ARE ONE VALUE.
 * contract `platform-operator-v1`, `errors.forbidden` and `testRequirements.authorization` ·
 * `docs/decisions/0024` invariant 2 · `docs/decisions/0025` decisions 1 and 3.
 * ===========================================================================================
 *
 *   1. NO `platform_operator` ROW.
 *   2. AN UNRECOGNISED `platform_role`.
 *   3. A ROLE THAT DOES NOT CARRY THE PERMISSION.
 *   4. A PRINCIPAL PRESENT IN BOTH TABLES.
 *
 * *** THE FOURTH IS WHY THE COLLAPSE MATTERS. *** A caller able to distinguish it could use these
 * routes to probe `organization_membership`. So the cases below do not merely assert that each is
 * refused — they assert that the refusals are the same value, compared whole.
 *
 * CAUSE 2 CANNOT BE BUILT IN THE DATABASE and that is a property of the schema rather than a gap
 * in the fixture: `0008_platform_operator.sql` carries a `CHECK` on the union, so only a FUTURE
 * migration could write such a row. It is reached through a store double, and the schema's refusal
 * is asserted separately in the mutual-exclusion suite.
 *
 * ===========================================================================================
 * THE LOAD-TIME GUARD IS EXERCISED THROUGH ITS PARAMETERS
 * ===========================================================================================
 *
 * `assertPlatformPermissionModelIsCoherent` reads module-level `const` bindings that ESM will not
 * let a test rebind, so `core-agent` gave it parameters that default to the shipped values — the
 * same device `assertRoleMappingIsCoherent` already uses. That is what makes its throw branches
 * reachable without editing `platform/core/**`, which `qa-agent` will not do. Each branch is
 * driven below, including `0024` invariant 2: a value in both role unions.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_FORBIDDEN,
  EXPECTED_UNAUTHENTICATED,
  PRN_BOTH_TABLES,
  SESSION_ADMIN,
  SESSION_EXPIRED,
  SESSION_MODERATOR,
  SESSION_NOWHERE,
  SESSION_STRANGER,
  SESSION_SUSPENDED,
  SESSION_TENANT_MEMBER,
  SESSION_TENANT_OWNER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { createPlatformAuthorityResolver } from '../../../../platform/core/platform/platform-authority.ts';
import type { PlatformOperatorStore } from '../../../../platform/core/platform/platform-operator-store.ts';
import {
  PLATFORM_PERMISSION_ENVELOPE,
  PLATFORM_ROLES,
  PlatformPermissionModelIncoherentError,
  assertPlatformPermissionModelIsCoherent,
  grantsForPlatformRole,
  reachablePlatformPermissions,
  toPlatformRole,
} from '../../../../platform/core/platform/platform-permissions.ts';
import { MEMBERSHIP_ROLES } from '../../../../platform/core/authorization/roles.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import type { PlatformRouteId } from '../../../../platform/core/platform/platform-routes.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';

const ROUTE_IDS: readonly PlatformRouteId[] = platformRoutes().map((route) => route.id);

function show(value: unknown): string {
  return JSON.stringify(value);
}

/** A store whose operator row carries a role this build does not recognise. Cause 2. */
function storeWithUnrecognisedRole(principalId: string): PlatformOperatorStore {
  return {
    async findOperator() {
      return ok({ principalId, platformRole: null, createdAt: '2026-09-05T09:00:00.000Z' });
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
}

function expectThrows(label: string, run: () => void): void {
  let raised: unknown = null;
  try {
    run();
  } catch (cause) {
    raised = cause;
  }
  assertTrue(
    label,
    raised instanceof PlatformPermissionModelIncoherentError,
    `expected PlatformPermissionModelIncoherentError, got ${String(raised)}`,
  );
}

export function buildPlatformAuthorizationSuite(
  make: MakePlatformWorld = createPlatformWorld,
): Suite {
  const suite = new Suite('Platform — authorization: four causes, one answer');

  suite.test('a tenant principal holding `owner` is refused on every route', async () => {
    const world = await make();
    try {
      for (const routeId of ROUTE_IDS) {
        expectError(
          `${ISOLATION} ${routeId} refuses a tenant owner`,
          await world.call(routeId, { sessionId: SESSION_TENANT_OWNER }),
          EXPECTED_FORBIDDEN,
        );
        expectError(
          `${ISOLATION} ${routeId} refuses a tenant member`,
          await world.call(routeId, { sessionId: SESSION_TENANT_MEMBER }),
          EXPECTED_FORBIDDEN,
        );
        expectError(
          `${ISOLATION} ${routeId} refuses a principal in neither table`,
          await world.call(routeId, { sessionId: SESSION_STRANGER }),
          EXPECTED_FORBIDDEN,
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('a role that does not carry the permission is refused on every route', async () => {
    const world = await make();
    try {
      for (const routeId of ROUTE_IDS) {
        expectError(
          `${routeId} refuses marketplace-moderator`,
          await world.call(routeId, { sessionId: SESSION_MODERATOR }),
          EXPECTED_FORBIDDEN,
        );
      }
      // The control: the SAME routes serve platform-admin, so the refusals above are about the
      // role rather than about the routes being broken.
      for (const routeId of ROUTE_IDS) {
        expectOk(`${routeId} serves platform-admin`, await world.call(routeId, { sessionId: SESSION_ADMIN }));
      }
    } finally {
      world.close();
    }
  });

  suite.test('an UNRECOGNISED platform_role denies rather than throwing', async () => {
    const resolver = createPlatformAuthorityResolver(storeWithUnrecognisedRole('prn_future_role001'));
    expectError(
      'a row a future migration wrote fails onto the safe path',
      await resolver.resolve('prn_future_role001'),
      EXPECTED_FORBIDDEN,
    );
    assertEqual('and an unknown stored value collapses to null', toPlatformRole('super-admin'), null);
    assertEqual('as does an absent one', toPlatformRole(null), null);
    assertEqual('as does undefined', toPlatformRole(undefined), null);
    assertEqual('and null grants nothing', grantsForPlatformRole(null).grants.length, 0);
  });

  suite.test('all four denial causes produce the identical error value', async () => {
    const world = await make();
    try {
      const noOperatorRow = await world.call('platform.session.whoami', { sessionId: SESSION_STRANGER });
      const wrongRole = await world.call('platform.session.whoami', { sessionId: SESSION_MODERATOR });
      // CAUSE 4 IS EVALUATED AT THE AUTHORITY RESOLVER, WHICH IS WHERE ALL FOUR ARE DECIDED.
      // `platform-authority.ts` is the single producer of a `PlatformAuthority`, so a collapse
      // asserted there is a collapse no route can undo — and it is the only layer at which cause 2
      // can be reached at all, since the database `CHECK` forbids storing an unrecognised role.
      // The route-level form of the same collapse is asserted in the mutual-exclusion suite.
      const bothTables = await world.dependencies.authority.resolve(PRN_BOTH_TABLES);
      const unrecognisedRole = await createPlatformAuthorityResolver(
        storeWithUnrecognisedRole('prn_future_role001'),
      ).resolve('prn_future_role001');

      const values = [noOperatorRow, wrongRole, bothTables, unrecognisedRole];
      assertTrue(
        'all four were refused',
        values.every((value) => !value.ok),
        values.map(show).join(' | '),
      );
      const rendered = values.map((value) => show((value as { error: unknown }).error));
      assertEqual(
        `${ISOLATION} cause 1 and cause 4 are byte-identical`,
        rendered[0],
        rendered[2],
      );
      assertEqual('cause 1 and cause 3 are byte-identical', rendered[0], rendered[1]);
      assertEqual('cause 1 and cause 2 are byte-identical', rendered[0], rendered[3]);
      assertEqual('and the value is the argument-free forbidden', rendered[0], show(EXPECTED_FORBIDDEN));
    } finally {
      world.close();
    }
  });

  suite.test('every authentication failure produces the identical unauthenticated', async () => {
    const world = await make();
    try {
      const answers = new Map<string, unknown>();
      answers.set('no credential at all', await world.call('platform.session.whoami', {}));
      answers.set(
        'a session identifier with no row',
        await world.call('platform.session.whoami', { sessionId: SESSION_NOWHERE }),
      );
      answers.set(
        'an expired session',
        await world.call('platform.session.whoami', { sessionId: SESSION_EXPIRED }),
      );
      answers.set(
        'a suspended principal that IS a platform operator',
        await world.call('platform.session.whoami', { sessionId: SESSION_SUSPENDED }),
      );
      answers.set(
        'a credential whose MAC does not verify',
        await world.call('platform.session.whoami', { rawCredential: 'ses_admin_000000001.AAAAAAAAAAAAAAAAAAAAAA' }),
      );

      for (const [name, answer] of answers) {
        expectError(`${name} is unauthenticated`, answer as never, EXPECTED_UNAUTHENTICATED);
      }
      assertEqual(
        'and none of them wrote an action record',
        world.actionRows().length,
        0,
      );
    } finally {
      world.close();
    }
  });

  // =========================================================================================
  // The permission model itself.
  // =========================================================================================

  suite.test('the two role unions are disjoint, as they ship', () => {
    const shared = PLATFORM_ROLES.filter((role) => (MEMBERSHIP_ROLES as readonly string[]).includes(role));
    assertEqual(
      `${ISOLATION} 0024 invariant 2: MembershipRole carries no platform-tier value`,
      shared.join(','),
      '',
    );
    assertEqual('the platform roles are exactly two', [...PLATFORM_ROLES].sort().join(','), 'marketplace-moderator,platform-admin');
    assertEqual('the membership roles are exactly two', [...MEMBERSHIP_ROLES].sort().join(','), 'member,owner');
  });

  suite.test('the coherence guard throws when a role value appears in both unions', () => {
    // 0024 invariant 2, driven rather than described. This is the one-word edit in a different
    // file that the guard exists to turn into a load-time failure.
    expectThrows('a shared role value is refused at load', () => {
      assertPlatformPermissionModelIsCoherent(
        undefined,
        undefined,
        undefined,
        ['owner', 'member', 'platform-admin'],
        PLATFORM_ROLES,
      );
    });
  });

  suite.test('the coherence guard throws on a wildcard, a wrong scope and an empty role', () => {
    const platformScope = 'platform' as const;
    expectThrows('a wildcard grant is refused', () => {
      assertPlatformPermissionModelIsCoherent(
        {
          'platform-admin': { grants: [{ permissionId: 'core.*', scope: platformScope }] },
          'marketplace-moderator': { grants: [{ permissionId: 'core.marketplace.moderate', scope: platformScope }] },
        },
        undefined,
        undefined,
        undefined,
        PLATFORM_ROLES,
      );
    });
    expectThrows('a grant at a non-platform scope is refused', () => {
      assertPlatformPermissionModelIsCoherent(
        {
          'platform-admin': { grants: [{ permissionId: 'core.organization.list', scope: 'organization' }] },
          'marketplace-moderator': { grants: [{ permissionId: 'core.marketplace.moderate', scope: platformScope }] },
        },
        undefined,
        undefined,
        undefined,
        PLATFORM_ROLES,
      );
    });
    expectThrows('a role that grants nothing is refused', () => {
      assertPlatformPermissionModelIsCoherent(
        {
          'platform-admin': { grants: [] },
          'marketplace-moderator': { grants: [{ permissionId: 'core.marketplace.moderate', scope: platformScope }] },
        },
        undefined,
        undefined,
        undefined,
        PLATFORM_ROLES,
      );
    });
    expectThrows('an absent role that grants something is refused', () => {
      assertPlatformPermissionModelIsCoherent(
        undefined,
        undefined,
        { grants: [{ permissionId: 'core.organization.list', scope: platformScope }] },
        undefined,
        PLATFORM_ROLES,
      );
    });
  });

  suite.test('the envelope is exactly six platform-scope permissions, and refuses a seventh', () => {
    assertEqual('six, as the class declares', PLATFORM_PERMISSION_ENVELOPE.declared.length, 6);
    assertEqual(
      'and every one is declared at platform scope',
      PLATFORM_PERMISSION_ENVELOPE.declared.filter((entry) => entry.scope !== 'platform').length,
      0,
    );
    assertEqual(
      'they are the six the four platform contracts name',
      PLATFORM_PERMISSION_ENVELOPE.declared.map((entry) => entry.permissionId).sort().join(','),
      'core.credential.reset,core.organization.create,core.organization.list,' +
        'core.template.create,core.template.list,core.template.read',
    );
    assertEqual('the envelope is attributed to platform, not to an App', PLATFORM_PERMISSION_ENVELOPE.appId, 'platform');

    const platformScope = 'platform' as const;
    expectThrows('a seventh permission is refused at load', () => {
      assertPlatformPermissionModelIsCoherent(undefined, {
        appId: 'platform',
        declared: [
          ...PLATFORM_PERMISSION_ENVELOPE.declared,
          { permissionId: 'core.organization.suspend', scope: platformScope },
        ],
      });
    });
    expectThrows('declaring core.principal.grant-platform-scope is refused', () => {
      assertPlatformPermissionModelIsCoherent(undefined, {
        appId: 'platform',
        declared: [
          ...PLATFORM_PERMISSION_ENVELOPE.declared.slice(1),
          { permissionId: 'core.principal.grant-platform-scope', scope: platformScope },
        ],
      });
    });
  });

  suite.test('the broadest grant is reachable by no route, and whoami does not report it', async () => {
    // `platform-operator-v1` §`thePERMISSIONSFIELDREPORTS_REACHABLE_NOT_HELD`, normative,
    // 2026-09-05: `permissions` is the INTERSECTION of what the role grants and what a route in
    // this class can reach — six for `platform-admin`, not the eight its role holds. The two
    // omitted are named in the clause and are named again below, because "six" is a count and a
    // count cannot say WHICH two went missing if the mapping ever drifts.
    const world = await make();
    try {
      // `core.principal.grant-platform-scope` is HELD by platform-admin and is deliberately not in
      // the envelope, so the ceiling refuses it for every caller. That is 0025's refusal to publish
      // a route which creates platform authority, expressed as a permission nobody can exercise.
      const held = grantsForPlatformRole('platform-admin').grants.map((grant) => grant.permissionId);
      assertTrue(
        'the role does hold it',
        held.includes('core.principal.grant-platform-scope'),
        held.join(','),
      );
      const reachable = reachablePlatformPermissions('platform-admin');
      assertTrue(
        `${ISOLATION} and no platform route can evaluate it`,
        !reachable.includes('core.principal.grant-platform-scope'),
        reachable.join(','),
      );
      assertEqual(
        'the omitted two are exactly the two the contract names',
        held.filter((permissionId) => !reachable.includes(permissionId)).sort().join(','),
        'core.marketplace.moderate,core.principal.grant-platform-scope',
      );

      const answer = expectOk(
        'whoami answers',
        await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }),
      ) as { permissions: readonly string[] };
      assertEqual(
        'whoami reports the reachable six and not the held eight',
        [...answer.permissions].sort().join(','),
        'core.credential.reset,core.organization.create,core.organization.list,' +
          'core.template.create,core.template.list,core.template.read',
      );
    } finally {
      world.close();
    }
  });

  suite.test('marketplace-moderator can render no console at all — the contract\'s stated cost', () => {
    // PO-5, asserted so that the day it changes, someone reads the ruling rather than rediscovering
    // the limitation. It is NOT a defect: the contract rules that the fix is to revisit whoami's
    // permission when a second role is actually held, never to grant the moderator Organization
    // enumeration.
    assertEqual(
      'the moderator reaches no platform route',
      reachablePlatformPermissions('marketplace-moderator').join(','),
      '',
    );
  });

  return suite;
}
