/**
 * ===========================================================================================
 * THE HOST BINDING. `docs/decisions/0022` as amended 2026-09-05 · contract
 * `platform-operator-v1`, `authentication.hostBinding` · `http/api.ts`'s platform block.
 * ===========================================================================================
 *
 * Admin is a SECOND WORKER with THE SAME `main`, so the platform route table is present in both
 * deployments. Without the host test, `/api/v1/platform/**` would be mounted on the application
 * host as well — where every tenant user already has a session.
 *
 *   A REQUEST ON THE WRONG HOST ANSWERS 404, NOT 403, and the difference is the whole point:
 *   answering 403 confirms the route exists on a host where it should not appear to.
 *
 * *** THE AUTHORIZATION CHECK IS THE CONTROL; THIS IS A SECOND LAYER. *** That is why
 * `run-platform-operator.ts` re-runs the AUTHORIZATION suite under the widened-host control and
 * requires it to stay GREEN. A build that bound the host and skipped the `platform_operator` check
 * would be relying on routing for authorization, and the evidence that it does not is an
 * authorization suite that is indifferent to the hostname.
 *
 * ===========================================================================================
 * WHAT THIS SUITE DRIVES, AND THE ONE THING IT FAKES
 * ===========================================================================================
 *
 * It calls the REAL `handleRequest`, so the real matching order, the real 404 rendering and the
 * real platform block are exercised. The Action-pipeline half of `ApiDependencies` — the tenant
 * store resolver, the cursor codec and the request coordinator — is supplied as `undefined`,
 * DELIBERATELY AND VISIBLY: the platform block returns before any of them is consulted, and if
 * that ever stopped being true these cases would throw rather than quietly pass. That is the
 * fail-visible direction, and it is the property being relied on stated as a test rather than as
 * an assumption.
 */

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import {
  ADMIN_HOST,
  APP_HOST,
  SESSION_ADMIN,
  SESSION_TENANT_OWNER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import { handleRequest } from '../../../../platform/core/http/api.ts';
import type { ApiDependencies } from '../../../../platform/core/http/api.ts';
import { createRouter } from '../../../../platform/core/http/router.ts';
import { createAuthorizer } from '../../../../platform/core/authorization/authorizer.ts';
import {
  PLATFORM_BASE_PATH,
  isPlatformHost,
  matchPlatformRoute,
} from '../../../../platform/core/platform/platform-routes.ts';

const EMPTY_ROUTER = createRouter([]);
const APP_ENVELOPE = { appId: 'harness', declared: [] as const };
const APP_BASE_PATH = '/api/v1/apps/harness';

function apiDependenciesFor(world: PlatformWorld, withPlatform = true): ApiDependencies {
  return {
    // The Action pipeline's half. Never reached by a platform request; see the header.
    resolver: undefined as never,
    cursors: undefined as never,
    coordinator: undefined as never,
    principals: undefined as never,
    authorizer: createAuthorizer(),
    clock: world.clock,
    ids: world.ids,
    platformRoutes: withPlatform ? world.dependencies : undefined,
  } as unknown as ApiDependencies;
}

async function request(
  world: PlatformWorld,
  options: {
    readonly host: string;
    readonly path: string;
    readonly method?: string;
    readonly sessionId?: string;
    readonly withPlatform?: boolean;
  },
): Promise<Response> {
  const headers = new Headers();
  if (options.sessionId !== undefined) {
    headers.set('authorization', `Bearer ${await world.signer.mint(options.sessionId)}`);
  }
  return handleRequest(
    apiDependenciesFor(world, options.withPlatform !== false),
    EMPTY_ROUTER,
    APP_ENVELOPE,
    APP_BASE_PATH,
    new Request(`https://${options.host}${options.path}`, {
      method: options.method ?? 'GET',
      headers,
    }),
  );
}

/**
 * Everything about a response except its `request_id`, which is the ONE permitted difference.
 *
 * The rest is compared whole — status, code, message and every remaining field — because
 * `MULTITENANCY_STANDARD.md` §5's indistinguishability requirement is about the response and not
 * only about the status line.
 */
async function fingerprint(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: Record<string, unknown> };
  const error = { ...(body.error ?? {}) };
  delete error.request_id;
  return JSON.stringify({ status: response.status, error });
}

export function buildHostBindingSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — the host binding (0022 as amended)');

  suite.test('isPlatformHost matches exactly, case-insensitively, and never by suffix', () => {
    assertTrue('the admin host matches', isPlatformHost([ADMIN_HOST], ADMIN_HOST), ADMIN_HOST);
    assertTrue(
      'and matches in a different case',
      isPlatformHost([ADMIN_HOST], ADMIN_HOST.toUpperCase()),
      'the comparison is case-sensitive, so a hostname arriving uppercased would 404',
    );
    assertTrue(
      'the application host does not',
      !isPlatformHost([ADMIN_HOST], APP_HOST),
      `${APP_HOST} matched the admin host list`,
    );
    assertTrue(
      'a suffix does not match — evil-admin.dudo.test is not admin.dudo.test',
      !isPlatformHost([ADMIN_HOST], `evil-${ADMIN_HOST}`),
      'the host test matched a hostname that merely ends with the admin host',
    );
    assertTrue(
      'a prefix does not match',
      !isPlatformHost([ADMIN_HOST], `${ADMIN_HOST}.attacker.test`),
      'the host test matched a hostname that merely begins with the admin host',
    );
    assertTrue(
      'an EMPTY list matches nothing — the fail-closed direction',
      !isPlatformHost([], ADMIN_HOST),
      'an empty admin host list matched a hostname, so a composition root that stated no hosts ' +
        'would serve the platform class everywhere',
    );
  });

  suite.test('a platform path on the application host answers 404, not 403', async () => {
    const world = await make();
    try {
      const onAppHost = await request(world, {
        host: APP_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        sessionId: SESSION_ADMIN,
      });
      assertEqual('it is 404', onAppHost.status, 404);

      // AND IT IS INDISTINGUISHABLE FROM A PATH THAT DOES NOT EXIST ANYWHERE. A 403, or a 404 with
      // a different body, would confirm the route exists on a host where it should not appear to.
      const unregistered = await request(world, {
        host: APP_HOST,
        path: '/api/v1/platform/no-such-route-at-all',
        sessionId: SESSION_ADMIN,
      });
      assertEqual(
        `${ISOLATION} the wrong host and a non-existent path answer identically`,
        await fingerprint(onAppHost),
        await fingerprint(unregistered),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an uncomposed runtime answers the same 404 as the wrong host', async () => {
    const world = await make();
    try {
      const uncomposed = await request(world, {
        host: ADMIN_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        sessionId: SESSION_ADMIN,
        withPlatform: false,
      });
      const wrongHost = await request(world, {
        host: APP_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        sessionId: SESSION_ADMIN,
      });
      assertEqual('both are 404', uncomposed.status, 404);
      assertEqual(
        `${ISOLATION} a deployment that does not serve this class is indistinguishable from a ` +
          'host that does not',
        await fingerprint(uncomposed),
        await fingerprint(wrongHost),
      );
    } finally {
      world.close();
    }
  });

  suite.test('the same request on the admin host is served', async () => {
    // THE POSITIVE CONTROL. Without it every case above would pass on a build where the platform
    // block answered 404 for everyone.
    const world = await make();
    try {
      const served = await request(world, {
        host: ADMIN_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        sessionId: SESSION_ADMIN,
      });
      assertEqual('200 on the admin host', served.status, 200);
      // `renderSuccess` writes the payload directly, with no `data` envelope — asserted here
      // because a client written against a wrapper that does not exist would break on the first
      // real response.
      const body = (await served.json()) as { principal_id?: string };
      assertEqual('and it is the operator\'s own context', body.principal_id, 'prn_platform_admin01');
    } finally {
      world.close();
    }
  });

  suite.test('a tenant user on the admin host is refused by authorization, not by routing', async () => {
    // `0025`: the host binding must never become the first layer. On the ADMIN host — where
    // routing permits the request — a tenant owner still gets 403 from the platform_operator
    // check.
    const world = await make();
    try {
      const refused = await request(world, {
        host: ADMIN_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        sessionId: SESSION_TENANT_OWNER,
      });
      assertEqual('403, from authorization', refused.status, 403);
    } finally {
      world.close();
    }
  });

  suite.test('a mismatched method is 404 and not 405', async () => {
    const world = await make();
    try {
      assertEqual(
        'the shipped matcher returns nothing for POST on a GET route',
        matchPlatformRoute('POST', `${PLATFORM_BASE_PATH}/whoami`),
        undefined,
      );
      const answered = await request(world, {
        host: ADMIN_HOST,
        path: `${PLATFORM_BASE_PATH}/whoami`,
        method: 'POST',
        sessionId: SESSION_ADMIN,
      });
      assertEqual('and the transport answers 404, which discloses nothing', answered.status, 404);
    } finally {
      world.close();
    }
  });

  suite.test('a path cannot be reached by adding slashes', () => {
    // `normalizePath` collapses `//a//b/`, so a reservation cannot be stepped around.
    assertTrue(
      'the doubled-slash form matches the same route',
      matchPlatformRoute('GET', '//api//v1//platform//whoami') !== undefined,
      'a doubled slash produced a different path, which is how a reservation is stepped around',
    );
    assertTrue(
      'and a trailing slash does too',
      matchPlatformRoute('GET', `${PLATFORM_BASE_PATH}/whoami/`) !== undefined,
      'a trailing slash produced a different path',
    );
    assertEqual(
      'while a genuinely different path does not',
      matchPlatformRoute('GET', `${PLATFORM_BASE_PATH}/whoami/extra`),
      undefined,
    );
  });

  return suite;
}
