/**
 * ===========================================================================================
 * BINDING PROPERTY P2 — VALIDATION BELONGS TO THE CLASS, NOT TO ITS ROUTES.
 * contract `platform-operator-v1`, `P2_validationBelongsToTheClass` and
 * `testRequirements.classProperties` · `docs/decisions/0025` decision 3.
 * ===========================================================================================
 *
 * The contract requires these to be asserted PER ROUTE rather than in aggregate, and the reason is
 * exact: *"P2 is a class property that a route could accidentally bypass."* A suite that checked
 * the Organization list and stopped would pass on a build where `whoami` had grown its own path.
 * So every case below iterates the whole frozen route table, and a fifth route added tomorrow is
 * covered the moment it is registered.
 *
 * TWO REFUSALS THAT LOOK LIKE THE SAME REFUSAL AND ARE NOT:
 *
 *   A ROUTE THAT DECLARES NO QUERY PARAMETERS REFUSES THE WHOLE QUERY STRING — not "filters
 *   unknown keys". `?principal_id=…` on `whoami` must be an error, not something accepted and
 *   ignored, because "ignored" is one careless edit from "read". That is asserted as its own case.
 *
 *   AN UNDECLARED PARAMETER on a route that declares some is `invalid_argument` naming the
 *   parameter. The NAME is echoed and the VALUE never is — `detail()` has no parameter for one,
 *   and every expectation below is written out in full so a build that started echoing values
 *   would go red rather than pass with a longer message.
 *
 * ===========================================================================================
 * VALIDATION RUNS BEFORE AUTHENTICATION, AND THAT ORDERING IS ASSERTED
 * ===========================================================================================
 *
 * `dispatchPlatformRoute` validates the query string and the body BEFORE it reads a credential,
 * *"because the answer to a malformed request must not depend on whether the caller is
 * authenticated."* The case at the bottom drives the same malformed request twice — once with no
 * credential and once as a real operator — and requires the identical answer. It also requires
 * that the anonymous one write no audit record, which is what keeps a validation error from being
 * a way for any caller to force a D1 write.
 */

import { Suite, assertEqual, assertTrue, expectError } from '../../harness/runner.ts';
import {
  SESSION_ADMIN,
  createPlatformWorld,
  expectedInvalidArgument,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import {
  PLATFORM_MAX_QUERY_STRING_LENGTH,
  PLATFORM_MAX_PAGE_SIZE,
  PLATFORM_MIN_PAGE_SIZE,
} from '../../../../platform/core/platform/platform-routes.ts';

const ROUTES = platformRoutes();

function show(value: unknown): string {
  return JSON.stringify(value);
}

export function buildClassValidationSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — P2: the class validates, per route (0025 decision 3)');

  suite.test('every route declares its complete field and parameter sets', () => {
    assertTrue('there are routes', ROUTES.length > 0, 'the frozen table is empty');
    for (const route of ROUTES) {
      assertTrue(
        `${route.id} declares a body field set`,
        Array.isArray(route.fields),
        'fields is not an array',
      );
      assertTrue(
        `${route.id} declares a query parameter set`,
        Array.isArray(route.queryParameters),
        'queryParameters is not an array',
      );
      // UPDATED 2026-09-05, AND THE PROPERTY IS UNCHANGED. `PlatformRoute.permission` was a
      // string; it is now a union of `{kind:'fixed'}` and `{kind:'from-body'}`, because the
      // confirmation challenge route borrows the permission of the operation it confirms rather
      // than inventing a `core.confirmation.request` that everyone holds. THE CLASS PROPERTY IS
      // STILL "EVERY ROUTE EVALUATES A PERMISSION" — only its representation moved, so the
      // assertion follows the representation and keeps asserting the same thing.
      assertTrue(
        `${route.id} declares a permission`,
        route.permission.kind === 'fixed'
          ? route.permission.permissionId.length > 0
          : typeof route.permission.resolve === 'function',
        'a route in this class has no permission, which is what distinguishes it from a session route',
      );
    }
    // =======================================================================================
    // THE TABLE IS PINNED, AND EACH ENTRY CARRIES THE DECISION THAT PUT IT THERE.
    // =======================================================================================
    //
    // `0025` fixes membership in this class and says an addition needs its own argument. This
    // list going red IS that argument being demanded — so the repair is to write the argument
    // down here, not to paste in the new sorted string.
    //
    // UPDATED 2026-09-05: `platform.organizations.create` joined the class. It is not an
    // append — it is the only operation in Dudo that brings a tenant into existence, and it is
    // the only route in the class whose handler reaches a tenant store, through an
    // `OnboardingService` held outside `platform/core/platform/**`. See `no-tenant-reach.ts`
    // for P1 as that amendment leaves it.
    const declaredRoutes: Readonly<Record<string, string>> = {
      'platform.organizations.list': '0025 decision 3. The enumeration this class was built for',
      'platform.session.whoami':
        '0025. Declares core.organization.list rather than inventing a core.platform.whoami — ' +
        'PO-5 records the cost, which is that marketplace-moderator can render no console',
      'platform.confirmations.request':
        '0027. The challenge route, and the ONE route whose permission is resolved from the ' +
        'body. Exempt from the confirmation gate, because gating it would require a ' +
        'confirmation in order to request one and the lock would have no key',
      'platform.organizations.create':
        'organization-onboarding-v1, 0026 decisions 1 and 2. NOT confirmation-gated, and that ' +
        'is a decision: 0026 reclassified core.organization.create from critical to sensitive ' +
        'so onboarding stays reachable in one request',
      'platform.templates.create': 'template-v1, 0025 decision 2. Its own permission, not shared',
      'platform.templates.list': 'template-v1. Enumeration is its own disclosure, so its own permission',
      'platform.templates.read': 'template-v1. THE ONLY ROUTE IN THE CLASS WITH A PATH PARAMETER',
    };
    const actualRoutes = ROUTES.map((route) => route.id).sort();
    assertEqual(
      'every route in the shipped table is named here with the decision that added it',
      actualRoutes.filter((id) => !(id in declaredRoutes)).join(','),
      '',
    );
    assertEqual(
      'and every route named here is still shipped — a removal is also a change to argue',
      Object.keys(declaredRoutes)
        // `actualRoutes` is `PlatformRouteId[]` and these keys are plain strings — the map is
        // keyed by string on purpose, so that a route id REMOVED from the union still fails here
        // rather than becoming a type error nobody sees at runtime.
        .filter((id) => !actualRoutes.some((actual) => actual === id))
        .join(','),
      '',
    );
  });

  for (const route of ROUTES) {
    suite.test(`${route.id} refuses an undeclared body field`, async () => {
      const world = await make();
      try {
        expectError(
          'an undeclared field is invalid_argument naming the field',
          await world.call(route.id, {
            sessionId: SESSION_ADMIN,
            bodyText: '{"organization_id":"org_alpha_000000001"}',
          }),
          expectedInvalidArgument('organization_id', 'unknown_field'),
        );
      } finally {
        world.close();
      }
    });

    suite.test(`${route.id} refuses a body that is not a JSON object`, async () => {
      const world = await make();
      try {
        expectError(
          'an array body is refused',
          await world.call(route.id, { sessionId: SESSION_ADMIN, bodyText: '[]' }),
          expectedInvalidArgument('', 'must_be_an_object'),
        );
        expectError(
          'a bare string body is refused',
          await world.call(route.id, { sessionId: SESSION_ADMIN, bodyText: '"hello"' }),
          expectedInvalidArgument('', 'must_be_an_object'),
        );
        expectError(
          'a null body is refused',
          await world.call(route.id, { sessionId: SESSION_ADMIN, bodyText: 'null' }),
          expectedInvalidArgument('', 'must_be_an_object'),
        );
        expectError(
          'unparseable text is refused',
          await world.call(route.id, { sessionId: SESSION_ADMIN, bodyText: '{' }),
          expectedInvalidArgument('', 'must_be_valid_json'),
        );
      } finally {
        world.close();
      }
    });

    suite.test(`${route.id} refuses an oversized body before parsing it`, async () => {
      const world = await make();
      try {
        const oversized = `{"a":"${'x'.repeat(5000)}"}`;
        expectError(
          'a body over 4 KiB is refused on size, not on field names',
          await world.call(route.id, { sessionId: SESSION_ADMIN, bodyText: oversized }),
          expectedInvalidArgument('', 'body_too_large'),
        );
      } finally {
        world.close();
      }
    });

    suite.test(`${route.id} refuses an undeclared query parameter`, async () => {
      const world = await make();
      try {
        const answer = await world.call(route.id, {
          sessionId: SESSION_ADMIN,
          queryString: 'include=customers',
        });
        // A route declaring NO parameters refuses the whole string; one declaring some names the
        // offending key. Both are `invalid_argument` and the distinction is the issue token.
        const expected =
          route.queryParameters.length === 0
            ? expectedInvalidArgument('', 'unexpected_query_parameter')
            : expectedInvalidArgument('include', 'unknown_parameter');
        expectError('an undeclared parameter is refused, never ignored', answer, expected);
      } finally {
        world.close();
      }
    });
  }

  suite.test('a route that declares NO query parameters refuses the whole query string', async () => {
    const world = await make();
    try {
      // `whoami` has no `principal_id` and the safety argument for the route is that it has none.
      // An accepted-but-ignored parameter would be the first half of undoing that.
      for (const queryString of ['principal_id=prn_platform_admin01', 'page_size=25', 'x=1', '=']) {
        expectError(
          `whoami refuses ?${queryString}`,
          await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN, queryString }),
          expectedInvalidArgument('', 'unexpected_query_parameter'),
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('a repeated query parameter is refused rather than resolved', async () => {
    const world = await make();
    try {
      expectError(
        'no first-wins, no last-wins',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'page_size=1&page_size=100',
        }),
        expectedInvalidArgument('page_size', 'repeated_parameter'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an oversized query string is refused before URLSearchParams allocates', async () => {
    const world = await make();
    try {
      const oversized = `cursor=${'a'.repeat(PLATFORM_MAX_QUERY_STRING_LENGTH + 100)}`;
      expectError(
        'over 1 KiB is refused on size',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: oversized,
        }),
        expectedInvalidArgument('', 'query_string_too_large'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('page_size is parsed strictly and bounded, never coerced or clamped', async () => {
    const world = await make();
    try {
      for (const raw of ['25abc', '+25', ' 25', '25.0', '2e1', '0x19', '', 'twenty']) {
        expectError(
          `page_size=${show(raw)} is refused rather than reinterpreted`,
          await world.call('platform.organizations.list', {
            sessionId: SESSION_ADMIN,
            queryString: `page_size=${encodeURIComponent(raw)}`,
          }),
          expectedInvalidArgument('page_size', 'must_be_an_integer'),
        );
      }
      for (const raw of [String(PLATFORM_MIN_PAGE_SIZE - 1), String(PLATFORM_MAX_PAGE_SIZE + 1), '999']) {
        expectError(
          `page_size=${raw} is out of range, not clamped`,
          await world.call('platform.organizations.list', {
            sessionId: SESSION_ADMIN,
            queryString: `page_size=${raw}`,
          }),
          expectedInvalidArgument('page_size', 'out_of_range'),
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('a present-but-empty cursor is refused rather than treated as absent', async () => {
    const world = await make();
    try {
      expectError(
        '?cursor= restarts nothing silently',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'cursor=',
        }),
        expectedInvalidArgument('cursor', 'invalid_cursor'),
      );
      expectError(
        'a cursor outside the alphabet is refused before any HMAC is computed',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'cursor=not%20a%20cursor',
        }),
        expectedInvalidArgument('cursor', 'invalid_cursor'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a malformed request answers the same whether the caller is authenticated', async () => {
    const world = await make();
    try {
      const anonymous = await world.call('platform.session.whoami', {
        bodyText: '{"organization_id":"org_alpha_000000001"}',
      });
      const operator = await world.call('platform.session.whoami', {
        sessionId: SESSION_ADMIN,
        bodyText: '{"organization_id":"org_alpha_000000001"}',
      });
      assertTrue(
        'both were refused',
        !anonymous.ok && !operator.ok,
        `${show(anonymous)} | ${show(operator)}`,
      );
      assertEqual(
        'the answer to a malformed request does not depend on authentication',
        show((anonymous as { error: unknown }).error),
        show((operator as { error: unknown }).error),
      );
      assertEqual(
        'and no audit record is written for either — a validation error is not a lever on D1',
        world.actionRows().length,
        0,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
