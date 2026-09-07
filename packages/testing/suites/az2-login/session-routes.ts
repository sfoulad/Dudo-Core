/**
 * ===========================================================================================
 * THE TWO SESSION ROUTES. `docs/decisions/0021`, `organization-selection-v1`.
 * ===========================================================================================
 *
 * ADOPTED from `core-agent`'s `verify-session-routes.ts`, which lived only in a session-scoped
 * scratchpad. Import paths made relative; the cases are its.
 *
 * TWO OF THESE ARE COVERED NOWHERE ELSE IN `packages/testing/**`, AND THEY ARE THE TWO THAT
 * MATTER MOST. Everything else here is worth having; these two would have been lost outright.
 *
 * ===========================================================================================
 * 1. THE 429/404 ANTI-ORACLE — validate-then-reserve, surviving a new layer
 * ===========================================================================================
 *
 * At an exhausted write budget a MEMBER gets `429` and a NON-MEMBER gets `404`. Reverse that
 * ordering — reserve capacity before validating the membership hint — and the two answers swap
 * places for the non-member, who would get `429` instead of `404`.
 *
 * THAT DIFFERENCE IS A MEMBERSHIP ORACLE THE CALLER CAN CREATE ON DEMAND: exhaust your own
 * budget, then submit Organization identifiers and read membership out of which status code
 * comes back. `0014` §A.12 fixes the ordering for exactly this reason, and this is the only
 * executable check that it still holds now that selection has its own HTTP route.
 *
 * ===========================================================================================
 * 2. THE `?principal_id=someone-else` HOLE, WHICH WAS PREDICTED BEFORE IT EXISTED
 * ===========================================================================================
 *
 * `architecture-agent` called this one in the contract: a session route is matched in the block
 * that handles absolute reserved paths, which sits ABOVE the Action path — and Core's JSON
 * parsing, unknown-field rejection and repeated-parameter refusal all live BELOW it. A session
 * route therefore inherits NO input validation at all.
 *
 * So **the one route in Dudo that accepts a tenant identifier would have been the one route with
 * no validation on it.** Accepted-and-ignored today; one careless edit from being read.
 *
 * `core-agent` closed it structurally rather than by remembering to: it refuses the WHOLE query
 * string rather than enumerating unknown keys, and it runs validation BEFORE handler lookup — so
 * a third session route cannot be added without inheriting the refusal. These cases pin that
 * shape, not merely the outcome.
 */

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { handleRequest } from '../../../../platform/core/http/api.ts';
import { createRouter } from '../../../../platform/core/http/router.ts';
import { createSessionRouteHandlers } from '../../../../platform/core/identity/session-route-handlers.ts';
import {
  matchSessionRoute,
  sessionRoutes,
} from '../../../../platform/core/identity/session-routes.ts';
import { createAuthorizer } from '../../../../platform/core/authorization/authorizer.ts';
import { createSystemClock } from '../../../../platform/core/kernel/clock.ts';
import { createRandomIdGenerator } from '../../../../platform/core/kernel/ids.ts';
import { createCursorCodec } from '../../../../platform/core/pagination/cursor.ts';
import { err, ok } from '../../../../platform/core/kernel/result.ts';
import {
  notFound,
  quotaExceeded,
  unauthenticated,
} from '../../../../platform/core/kernel/errors.ts';

const SESSION = 'sessionidsessionid0000';
const ORG = 'MUJ4rWBpm0a9NlDtzcJAAA';

/** Mutable so a case can steer the resolver without rebuilding the composition. */
type World = {
  selected: string | null;
  selectError: unknown;
  listResult: readonly string[];
  listError: unknown;
  presentedCredential: string | null;
};

async function createWorld(): Promise<{
  readonly world: World;
  call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response>;
  readonly dependencies: unknown;
}> {
  const world: World = {
    selected: null,
    selectError: null,
    listResult: [ORG],
    listError: null,
    presentedCredential: SESSION,
  };

  const sessions = {
    async resolve() {
      return err(unauthenticated());
    },
    async listEnterableOrganizations() {
      return world.listError !== null ? err(world.listError as never) : ok(world.listResult);
    },
    async selectOrganization(input: { requestedOrganizationId: string }) {
      if (world.selectError !== null) {
        return err(world.selectError as never);
      }
      world.selected = input.requestedOrganizationId;
      return ok(undefined);
    },
    async issueSession() {
      return err(unauthenticated());
    },
    async revokeSession() {
      return ok(undefined);
    },
  };

  const dependencies = {
    resolver: {
      async resolve() {
        return err(unauthenticated());
      },
    },
    authorizer: createAuthorizer(),
    clock: createSystemClock(),
    ids: createRandomIdGenerator(),
    // A fixed 32-byte test constant. Not a credential; of no value outside this process.
    cursors: await createCursorCodec(new TextEncoder().encode('a-thirty-two-byte-test-key-000000')),
    principals: {
      async resolve() {
        return err(unauthenticated());
      },
    },
    coordinator: {
      async begin() {
        return ok(null);
      },
    },
    sessionRoutes: {
      handlers: createSessionRouteHandlers({ sessions: sessions as never }),
      async readSessionId() {
        return ok(world.presentedCredential);
      },
    },
  };

  return {
    world,
    dependencies,
    call: (method, path, body) =>
      handleRequest(
        dependencies as never,
        createRouter([]) as never,
        { appId: 'platform', declared: [] } as never,
        '/api/v1/apps/customers',
        new Request(`https://dudo.invalid${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { sourceAddressHash: null },
      ),
  };
}

export function buildSessionRoutesSuite(): Suite {
  const suite = new Suite('AZ2 — the two session routes (0021, organization-selection-v1)');

  suite.test('the registry is closed and both paths are reserved', () => {
    assertEqual('exactly two session routes', sessionRoutes().length, 2);
    assertTrue(
      'both are under /auth/',
      sessionRoutes().every((route) => route.path.startsWith('/auth/')),
      'a session route outside /auth/ would sit under /api/v1, where an App route could shadow it',
    );
    assertEqual(
      'the picker declares NO body fields',
      matchSessionRoute('GET', '/auth/session/organizations')?.fields.length,
      0,
    );
    assertEqual(
      'selection declares EXACTLY ONE',
      matchSessionRoute('POST', '/auth/session/organization')?.fields.join(),
      'organization_id',
    );
    assertTrue(
      'a trailing slash still matches, so the reservation cannot be stepped around',
      matchSessionRoute('GET', '/auth/session/organizations/') !== undefined,
      'a path that stopped matching with a trailing slash could fall through to the Action ' +
        'router, which is the layer these routes exist above',
    );
  });

  suite.test('the picker returns the enterable Organizations and exactly two fields', async () => {
    const { call } = await createWorld();
    const list = await call('GET', '/auth/session/organizations');
    assertEqual('the picker returns 200', list.status, 200);
    const body = (await list.json()) as {
      data: { organization_id: string; display_name: unknown }[];
    };
    assertEqual('one enterable Organization', body.data.length, 1);
    assertEqual('and it is the seeded one', body.data[0].organization_id, ORG);
    assertTrue(
      'display_name is PRESENT and null, never absent',
      'display_name' in body.data[0] && body.data[0].display_name === null,
      'an ABSENT key and a null value are different to a client: absent invites a placeholder, ' +
        'null is contracted to render the organization_id verbatim',
    );
    assertEqual(
      'the row has exactly two fields — no role, no status',
      Object.keys(body.data[0]).length,
      2,
    );
  });

  suite.test('selection records the hint, answers {"status":"ok"}, and sets no cookie', async () => {
    const { call, world } = await createWorld();
    const select = await call('POST', '/auth/session/organization', { organization_id: ORG });
    assertEqual('selection returns 200', select.status, 200);
    assertEqual(
      'the body does NOT echo the selection back',
      await select.clone().text(),
      '{"status":"ok"}',
    );
    assertEqual('it reached the resolver with the hint', world.selected, ORG);
    assertEqual(
      'NO Set-Cookie — the credential does not change, only the row it points at',
      select.headers.getSetCookie().length,
      0,
    );
  });

  suite.test('method and path are paired: 404, never 405', async () => {
    // 405 would confirm the path exists, which is a disclosure on routes that name a tenant.
    const { call } = await createWorld();
    assertEqual(
      'GET on the singular path is 404',
      (await call('GET', '/auth/session/organization')).status,
      404,
    );
    assertEqual(
      'POST on the plural path is 404',
      (await call('POST', '/auth/session/organizations', {})).status,
      404,
    );
  });

  // -----------------------------------------------------------------------------------------
  // THE PREDICTED HOLE. Covered nowhere else.
  // -----------------------------------------------------------------------------------------

  suite.test('A QUERY PARAMETER IS REJECTED, not silently ignored', async () => {
    const { call } = await createWorld();
    const withQuery = await call('GET', '/auth/session/organizations?principal_id=someone-else');
    assertEqual(
      'the whole query string is refused with 400',
      withQuery.status,
      400,
    );
    assertTrue(
      'and the detail names no value from it',
      !(await withQuery.clone().text()).includes('someone-else'),
      'echoing a caller-supplied value back is how a refusal becomes a reflection',
    );
  });

  suite.test('undeclared, mistyped and malformed inputs are all refused before any lookup', async () => {
    const { call } = await createWorld();
    assertEqual(
      'an UNDECLARED body field is rejected',
      (await call('POST', '/auth/session/organization', {
        organization_id: ORG,
        principal_id: 'x'.repeat(22),
      })).status,
      400,
    );
    assertEqual(
      'a non-string organization_id is rejected, not coerced',
      (await call('POST', '/auth/session/organization', { organization_id: 12345 })).status,
      400,
    );
    const malformed = await call('POST', '/auth/session/organization', { organization_id: 'no' });
    assertEqual('an identifier failing the grammar is rejected', malformed.status, 400);
    assertTrue(
      'and the rejected identifier is NOT echoed',
      !(await malformed.clone().text()).includes('no"'),
      'the refusal must not reflect the value it refused',
    );
    assertEqual(
      'a missing organization_id is rejected',
      (await call('POST', '/auth/session/organization')).status,
      400,
    );
  });

  suite.test('malformed JSON is rejected rather than reaching a handler', async () => {
    const { dependencies } = await createWorld();
    const badJson = await handleRequest(
      dependencies as never,
      createRouter([]) as never,
      { appId: 'platform', declared: [] } as never,
      '/api/v1/apps/customers',
      new Request('https://dudo.invalid/auth/session/organization', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      { sourceAddressHash: null },
    );
    assertEqual('400, not 500', badJson.status, 400);
  });

  // -----------------------------------------------------------------------------------------
  // THE ANTI-ORACLE. Covered nowhere else, and the most valuable case in this file.
  // -----------------------------------------------------------------------------------------

  suite.test('no credential is 401 on the picker', async () => {
    const { call, world } = await createWorld();
    world.presentedCredential = null;
    assertEqual('401', (await call('GET', '/auth/session/organizations')).status, 401);
  });

  suite.test('an expired session on the picker is 401', async () => {
    const { call, world } = await createWorld();
    world.listError = unauthenticated();
    assertEqual('401', (await call('GET', '/auth/session/organizations')).status, 401);
  });

  suite.test('a non-member gets 404, and the body names no Organization', async () => {
    const { call, world } = await createWorld();
    world.selectError = notFound();
    const nonMember = await call('POST', '/auth/session/organization', { organization_id: ORG });
    assertEqual('404', nonMember.status, 404);
    assertTrue(
      'and the 404 names no Organization',
      !(await nonMember.clone().text()).includes(ORG),
      'a 404 that echoed the identifier would confirm the identifier was well-formed and reached ' +
        'a lookup, which is most of what an enumerator wants',
    );
  });

  suite.test(
    'THE ANTI-ORACLE: at an exhausted budget a MEMBER gets 429 and a NON-MEMBER still gets 404',
    async () => {
      // ===========================================================================================
      // VALIDATE-THEN-RESERVE, ASSERTED AS THE DIFFERENCE BETWEEN TWO STATUS CODES.
      // ===========================================================================================
      //
      // Reverse the ordering — reserve capacity before validating the hint — and the non-member
      // below returns 429 instead of 404, because it would run out of budget before anyone
      // checked whether it was a member. The caller can then exhaust its OWN budget deliberately
      // and read membership out of which code comes back, for any Organization identifier it
      // cares to try.
      //
      // Both halves are required. A test that only asserted the member's 429 would pass under the
      // reversed ordering, since that half does not change.
      const { call, world } = await createWorld();

      world.selectError = quotaExceeded();
      const member = await call('POST', '/auth/session/organization', { organization_id: ORG });
      assertEqual('a MEMBER at an exhausted budget gets 429', member.status, 429);

      world.selectError = notFound();
      const nonMember = await call('POST', '/auth/session/organization', { organization_id: ORG });
      assertEqual(
        'A NON-MEMBER AT AN EXHAUSTED BUDGET STILL GETS 404, NEVER 429 — if this becomes 429, ' +
          'membership is readable from the status code by any caller willing to spend its own ' +
          'daily budget first',
        nonMember.status,
        404,
      );

      assertTrue(
        'and the two answers genuinely differ, so the case is measuring something',
        member.status !== nonMember.status,
        'both branches returned the same status, so this case cannot discriminate and proves ' +
          'nothing about the ordering',
      );
    },
  );

  suite.test('an empty picker is 200 with [], not an error', async () => {
    // A principal with no memberships. An empty collection is not a missing one, and a 404 here
    // would be a statement about the principal rather than about a resource.
    const { call, world } = await createWorld();
    world.listResult = [];
    const empty = await call('GET', '/auth/session/organizations');
    assertEqual('200', empty.status, 200);
    assertEqual(
      'and data is an empty array',
      ((await empty.json()) as { data: unknown[] }).data.length,
      0,
    );
  });

  suite.test('an uncomposed session route is 404, not open', async () => {
    // If the composition omits `sessionRoutes`, the path must not fall through to something that
    // serves it. Fail closed, like the tenant resolver.
    const { dependencies } = await createWorld();
    const uncomposed = await handleRequest(
      { ...(dependencies as Record<string, unknown>), sessionRoutes: undefined } as never,
      createRouter([]) as never,
      { appId: 'platform', declared: [] } as never,
      '/api/v1/apps/customers',
      new Request('https://dudo.invalid/auth/session/organizations', { method: 'GET' }),
      { sourceAddressHash: null },
    );
    assertEqual('404', uncomposed.status, 404);
  });

  return suite;
}
