/**
 * THE AUTHORIZATION MATRIX, and the `forbidden`/`not_found` pairing the contract turns on.
 *
 * `TESTING_STANDARD.md` §6 fixes the matrix. The Customer Directory README §12 adds the rule
 * that makes this suite's shape non-negotiable:
 *
 *   "Wrong Business, right Organization → forbidden … Wrong Organization → not_found,
 *    byte-identical to nonexistent … THESE TWO ASSERTIONS MUST APPEAR AS A PAIR IN EVERY
 *    CASE; a suite that checks one without the other cannot show that the ruling in §3.2 was
 *    implemented rather than approximated."
 *
 * So every case below asserts all three answers together — allowed, forbidden, not_found —
 * against one Action. A suite that asserted `forbidden` alone would pass equally well against
 * an implementation that answered `forbidden` for everything, which is the failure mode the
 * pairing exists to catch.
 *
 * BUSINESS-SCOPE AUTHORIZATION IS NOT TENANT ISOLATION AND IS NOT REPORTED WITH IT. The
 * `forbidden` cases here are decisions INSIDE one Organization, on rows the storage boundary
 * has already proved belong to the caller's own tenant. Only the `not_found` halves are
 * isolation assertions, and only those carry the `ISOLATION:` label.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  BIZ_B_EAST,
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  CUST_A_SOUTH,
  CUST_B_ANNA,
  CUST_NOWHERE,
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  ORG_A,
  makePrincipal,
} from '../../harness/world.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

export function buildAuthorizationSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('authorization — the matrix, and forbidden versus not_found as a pair');

  suite.test('GetCustomer: allowed in own Business, forbidden in a sibling Business, not_found across the tenant', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'allowed: own Business',
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_ANNA }),
      );
      expectError(
        'forbidden: a sibling Business inside the same Organization',
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      expectError(
        `${ISOLATION} not_found: another Organization`,
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'not_found: an identifier that exists nowhere',
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_NOWHERE }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test('UpdateCustomer: the same three answers', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'allowed: own Business',
        await world.invoke(world.actions.update, world.adminANorth, { customer_id: CUST_A_ANNA, country: 'BH' }),
      );
      expectError(
        'forbidden: sibling Business',
        await world.invoke(world.actions.update, world.adminANorth, { customer_id: CUST_A_SOUTH, country: 'BH' }),
        EXPECTED_FORBIDDEN,
      );
      expectError(
        `${ISOLATION} not_found: another Organization`,
        await world.invoke(world.actions.update, world.adminANorth, { customer_id: CUST_B_ANNA, country: 'BH' }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test('ArchiveCustomer and RestoreCustomer: the same three answers', async () => {
    const world = await makeWorld();
    try {
      expectOk('allowed: archive in own Business', await world.invoke(world.actions.archive, world.adminANorth, { customer_id: CUST_A_ANNA }));
      expectError(
        'forbidden: archive in a sibling Business',
        await world.invoke(world.actions.archive, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      expectError(
        `${ISOLATION} not_found: archive across the tenant`,
        await world.invoke(world.actions.archive, world.adminANorth, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );

      expectOk('allowed: restore in own Business', await world.invoke(world.actions.restore, world.adminANorth, { customer_id: CUST_A_ARCHIVED }));
      expectError(
        `${ISOLATION} not_found: restore across the tenant`,
        await world.invoke(world.actions.restore, world.adminANorth, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }
  });

  suite.test('collections: an explicitly named unauthorized Business is forbidden inside the Organization and not_found outside it', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'allowed: own Business named explicitly',
        await world.invoke(world.actions.list, world.adminANorth, { business_id: BIZ_A_NORTH }),
      );
      expectError(
        'forbidden: a sibling Business named explicitly',
        await world.invoke(world.actions.list, world.adminANorth, { business_id: BIZ_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      expectError(
        `${ISOLATION} not_found: another Organization's Business named explicitly`,
        await world.invoke(world.actions.list, world.adminANorth, { business_id: BIZ_B_EAST }),
        EXPECTED_NOT_FOUND,
      );
      expectError(
        'forbidden: a sibling Business named explicitly on search',
        await world.invoke(world.actions.search, world.adminANorth, { query: 'carla', business_id: BIZ_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
    } finally {
      world.close();
    }
  });

  suite.test('an unfiltered collection filters silently: no error, no count, no placeholder for unauthorized Businesses', async () => {
    const world = await makeWorld();
    try {
      const page = expectOk('the unfiltered listing succeeds', await world.invoke(world.actions.list, world.adminANorth, { page_size: 100 })) as {
        data: readonly { customer_id: string; business_id: string }[];
        next_cursor: string | null;
      };
      assertEqual(
        'every returned row is in the one authorized Business',
        page.data.every((row) => row.business_id === BIZ_A_NORTH),
        true,
      );
      assertEqual(
        'the sibling Business customer is absent rather than refused',
        page.data.some((row) => row.customer_id === CUST_A_SOUTH),
        false,
      );
      assertEqual(
        'the collection envelope has exactly two properties — no total, no count',
        Object.keys(page).sort().join(','),
        'data,next_cursor',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a business-scope principal cannot reach MoveCustomerToBusiness at all', async () => {
    const world = await makeWorld();
    try {
      // `implies('business', 'organization')` is false, so this is refused at step 3 —
      // record-independently. Asserted by getting the SAME forbidden for a record that
      // exists, one in another Organization, and one that exists nowhere.
      const existing = await world.invoke(world.actions.move, world.adminANorth, { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH });
      const foreign = await world.invoke(world.actions.move, world.adminANorth, { customer_id: CUST_B_ANNA, business_id: BIZ_A_SOUTH });
      const nowhere = await world.invoke(world.actions.move, world.adminANorth, { customer_id: CUST_NOWHERE, business_id: BIZ_A_SOUTH });
      expectError('forbidden: business scope cannot satisfy an organization-scope Action', existing, EXPECTED_FORBIDDEN);
      expectError('forbidden: the same answer for a foreign record', foreign, EXPECTED_FORBIDDEN);
      expectError('forbidden: the same answer for a nonexistent record', nowhere, EXPECTED_FORBIDDEN);
      assertEqual(
        'the step-3 forbidden is record-independent and cannot be correlated with existence',
        JSON.stringify(existing) === JSON.stringify(foreign) && JSON.stringify(foreign) === JSON.stringify(nowhere),
        true,
      );
    } finally {
      world.close();
    }
  });

  suite.test('a principal holding no permission is forbidden, record-independently', async () => {
    const world = await makeWorld();
    try {
      const existing = await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA });
      const nowhere = await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_NOWHERE });
      const malformed = await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: 'not valid' });
      expectError('forbidden: no grant', existing, EXPECTED_FORBIDDEN);
      expectError('forbidden: no grant, nonexistent record', nowhere, EXPECTED_FORBIDDEN);
      expectError(
        'forbidden precedes input validation, so a malformed request from an unpermitted principal is still forbidden',
        malformed,
        EXPECTED_FORBIDDEN,
      );
    } finally {
      world.close();
    }
  });

  suite.test('a revoked permission denies the very next call', async () => {
    const world = await makeWorld();
    try {
      const before = makePrincipal({
        principalId: 'prn_revocation_subject',
        organizationId: ORG_A,
        authorizedBusinessIds: [BIZ_A_NORTH],
        grants: [{ permissionId: 'customers.customer.read', scope: 'business' }],
      });
      expectOk('control: the grant works', await world.invoke(world.actions.get, before, { customer_id: CUST_A_ANNA }));
      const after = makePrincipal({
        principalId: 'prn_revocation_subject',
        organizationId: ORG_A,
        authorizedBusinessIds: [BIZ_A_NORTH],
        grants: [],
      });
      expectError('the next call after revocation is denied', await world.invoke(world.actions.get, after, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
    } finally {
      world.close();
    }
  });

  suite.test('an App that has not declared the permission is denied at the boundary, first-party or not', async () => {
    const world = await makeWorld();
    try {
      const { invokeAction } = await import('../../../../platform/core/action/pipeline.ts');
      const { asAnyAction } = await import('../../../../platform/core/action/action.ts');
      const outcome = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.get),
        {
          principal: world.ownerA,
          // The same App, with `customers.customer.read` removed from what it declared.
          app: {
            appId: 'customers',
            declared: world.app.declared.filter((entry) => entry.permissionId !== 'customers.customer.read'),
          },
          requestId: 'req_declared_test',
          correlationId: 'cor_declared_test',
        },
        { customer_id: CUST_A_ANNA },
      );
      expectError('an undeclared permission is denied even though the principal holds it', outcome, EXPECTED_FORBIDDEN);
    } finally {
      world.close();
    }
  });

  suite.test('an App declaring a permission at too narrow a scope cannot satisfy a wider Action', async () => {
    const world = await makeWorld();
    try {
      const { invokeAction } = await import('../../../../platform/core/action/pipeline.ts');
      const { asAnyAction } = await import('../../../../platform/core/action/action.ts');
      const outcome = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.move),
        {
          principal: world.ownerA,
          app: {
            appId: 'customers',
            declared: world.app.declared.map((entry) =>
              entry.permissionId === 'customers.customer.move' ? { ...entry, scope: 'business' as const } : entry,
            ),
          },
          requestId: 'req_ceiling_test',
          correlationId: 'cor_ceiling_test',
        },
        { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH },
      );
      expectError('the App ceiling is a ceiling, not a floor', outcome, EXPECTED_FORBIDDEN);
    } finally {
      world.close();
    }
  });

  return suite;
}
