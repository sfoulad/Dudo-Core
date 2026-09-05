/**
 * ===========================================================================================
 * AN OPERATOR'S SESSION CAN NEVER RESOLVE A TENANT STORE.
 * contract `platform-operator-v1`, `testRequirements.tenantIsolation` ·
 * `authentication.theSESSIONISUNSELECTEDANDSTAYSTHATWAY`.
 * ===========================================================================================
 *
 * This is the chain `docs/decisions/0024` calls "mechanical, not disciplinary":
 *
 *   no membership → no selection → no `TenantStoreResolver` handle → no `whereWithTenant` → no rows.
 *
 * The contract states it as a structural guarantee rather than a consequence: *"an operator has no
 * membership row, so `selectOrganization` refuses every Organization it could name with the same
 * 404 a non-member receives, and its session's `active_organization_id` stays null for its whole
 * life."* Every link is asserted here, and the last one — the stored column — is asserted out of
 * band, against the database, because that is the fact the whole chain rests on.
 *
 * THE FABRICATED THIRD IDENTIFIER IS PRESENT AND IS THE POINT. An operator naming `ORG_ALPHA`
 * (real, exists, has members) and an operator naming `ORG_NOWHERE` (exists in no table at all)
 * must receive the identical `not_found`. Comparing only the two real Organizations would show
 * that the operator is not a member of either; it would not show that the refusal discloses
 * nothing about which of them exists.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_NOT_FOUND,
  ORG_ALPHA,
  ORG_BETA,
  ORG_NOWHERE,
  PRN_ADMIN,
  SESSION_ADMIN,
  SESSION_TENANT_MEMBER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';

function activeOrganizationOf(
  world: Awaited<ReturnType<typeof createPlatformWorld>>,
  sessionId: string,
): unknown {
  const rows = world.control.raw
    .prepare('SELECT active_organization_id FROM session WHERE session_id = ?')
    .all(sessionId) as { active_organization_id: unknown }[];
  return rows.length === 0 ? undefined : rows[0].active_organization_id;
}

export function buildOperatorSessionIsolationSuite(
  make: MakePlatformWorld = createPlatformWorld,
): Suite {
  const suite = new Suite('Platform — an operator session reaches no tenant (0024, contract §tenantIsolation)');

  suite.test('the Organization picker returns an EMPTY collection for an operator', async () => {
    const world = await make();
    try {
      const enterable = expectOk(
        'the picker answers rather than erroring',
        await world.sessions.listEnterableOrganizations(SESSION_ADMIN),
      ) as readonly string[];
      assertEqual(
        `${ISOLATION} an operator may enter no Organization`,
        enterable.length,
        0,
      );

      // The positive control. Three Organizations exist and a real member sees one of them, so the
      // empty answer above is a fact about the operator rather than about an empty database.
      const memberSees = expectOk(
        'a tenant member still gets its own list',
        await world.sessions.listEnterableOrganizations(SESSION_TENANT_MEMBER),
      ) as readonly string[];
      assertEqual('the control member sees exactly one Organization', memberSees.length, 1);
      assertEqual('and it is its own', memberSees[0], ORG_BETA);
    } finally {
      world.close();
    }
  });

  suite.test('an operator selecting a REAL Organization is refused, and cannot tell it from a fabricated one', async () => {
    const world = await make();
    try {
      const real = await world.sessions.selectOrganization({
        sessionId: SESSION_ADMIN,
        requestedOrganizationId: ORG_ALPHA,
      });
      const alsoReal = await world.sessions.selectOrganization({
        sessionId: SESSION_ADMIN,
        requestedOrganizationId: ORG_BETA,
      });
      const fabricated = await world.sessions.selectOrganization({
        sessionId: SESSION_ADMIN,
        // EXISTS IN NO TABLE. Without this entry the two above would only show that the operator
        // is not a member; they would not show that the refusal is uninformative.
        requestedOrganizationId: ORG_NOWHERE,
      });

      expectError(`${ISOLATION} a real Organization is refused`, real, EXPECTED_NOT_FOUND);
      expectError(`${ISOLATION} a second real Organization is refused`, alsoReal, EXPECTED_NOT_FOUND);
      expectError(
        `${ISOLATION} a FABRICATED Organization is refused identically`,
        fabricated,
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test("the operator's stored active_organization_id is still null afterwards", async () => {
    const world = await make();
    try {
      assertEqual('it starts null', activeOrganizationOf(world, SESSION_ADMIN), null);

      await world.sessions.listEnterableOrganizations(SESSION_ADMIN);
      await world.sessions.selectOrganization({
        sessionId: SESSION_ADMIN,
        requestedOrganizationId: ORG_ALPHA,
      });
      await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN });
      await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN });

      assertEqual(
        `${ISOLATION} nothing an operator can do writes an Organization onto its session`,
        activeOrganizationOf(world, SESSION_ADMIN),
        null,
      );

      // And the control: a principal that IS a member can move its own session, so the null above
      // is not the column simply never being written by anything.
      expectOk(
        'a tenant member selects its own Organization',
        await world.sessions.selectOrganization({
          sessionId: SESSION_TENANT_MEMBER,
          requestedOrganizationId: ORG_BETA,
        }),
      );
      assertEqual(
        'the column is writable — the operator case is a refusal, not an inert column',
        activeOrganizationOf(world, SESSION_TENANT_MEMBER),
        ORG_BETA,
      );
    } finally {
      world.close();
    }
  });

  suite.test('an operator session never resolves to an AuthenticatedPrincipal', async () => {
    const world = await make();
    try {
      const resolved = expectOk(
        'the session is live',
        await world.sessions.resolve(SESSION_ADMIN),
      ) as { kind: string; principalId?: string };
      assertEqual(
        `${ISOLATION} it is organization-not-selected, so no tenant store can be resolved for it`,
        resolved.kind,
        'organization-not-selected',
      );
      assertEqual('and it carries the principal and nothing else', resolved.principalId, PRN_ADMIN);
      assertTrue(
        `${ISOLATION} there is no principal object to extract an organizationId from`,
        !('principal' in resolved),
        JSON.stringify(resolved),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
