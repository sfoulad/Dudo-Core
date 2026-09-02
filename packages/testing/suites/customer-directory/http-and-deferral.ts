/**
 * THE HTTP SURFACE: the two deferred Actions, and the shape of a `not_found` on the wire.
 *
 * PART ONE — "PROVABLY NOT BUILT". The contract does not merely permit `DeleteCustomer` and
 * `RestoreDeletedCustomer` to be absent; it requires the absence to be demonstrable: "the
 * routes are absent or return not_implemented, and NO PATH REACHES A HANDLER. An Action that
 * is contracted but not built must be provably not built, or its absence is indistinguishable
 * from a handler nobody noticed shipping — and this is the one Action in the App that
 * destroys tenant data."
 *
 * "No path reaches a handler" is asserted the only way it can be asserted from outside:
 * counting. The principal resolver and the tenant store resolver are WRAPPED IN COUNTERS, and
 * a `501` is only accepted as evidence if BOTH counters are still zero. That is what makes
 * the claim "answered before authentication" a measurement rather than a reading of the
 * source. A 501 produced after authentication would pass a naive status-code assertion and
 * would mean something materially different.
 *
 * PART TWO — INDISTINGUISHABILITY ON THE WIRE. The contract requires the `not_found` for a
 * foreign-Organization identifier and the `not_found` for an identifier that exists nowhere to
 * be "identical in status code, error code, message string, details array, RESPONSE-SIZE CLASS
 * and headers", with `request_id` the only permitted difference. Asserted at the transport
 * boundary, on rendered `Response` objects, because that is where a difference would actually
 * be observable to a caller — an equality check on two `CoreError` values would not see a
 * header, a status or a byte count.
 *
 * PART THREE — ROUTE DRIFT. `manifest.apis`, the contract's `httpBinding.routes` and the
 * code's route table state the same ten facts in three places. The contract names the risk
 * and assigns it here: "a route added, removed, renamed or re-methoded in one and not the
 * other is a contract defect of the same class as cross-repository contract drift, and
 * catching it is a qa-agent check rather than a reviewer's good intentions."
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import { CUST_A_ANNA, CUST_B_ANNA, CUST_NOWHERE } from '../../harness/world.ts';
import type { ApiDependencies } from '../../../../platform/core/http/api.ts';
import { handleRequest } from '../../../../platform/core/http/api.ts';
import { createRouter, DeferredActionWiredError } from '../../../../platform/core/http/router.ts';
import type { Route, Router } from '../../../../platform/core/http/router.ts';
import type { TenantStoreResolver } from '../../../../platform/core/tenancy/tenant-store-resolver.ts';
import type { PrincipalResolver } from '../../../../platform/core/identity/principal-resolver.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { asAnyAction } from '../../../../platform/core/action/action.ts';
import type { ActionDefinition } from '../../../../platform/core/action/action.ts';
import { createCustomerRoutes, CUSTOMERS_BASE_PATH } from '../../../../apps/customers/api/routes.ts';
import { DEFERRED_ACTION_IDS } from '../../../../apps/customers/actions/common.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = `${HERE}../../../../`;

function sourceFilesIn(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = `${directory}/${entry}`;
    if (statSync(full).isDirectory()) {
      collected.push(...sourceFilesIn(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      collected.push(full);
    }
  }
  return collected;
}

type Counters = { principalResolutions: number; storeResolutions: number };

function buildApi(world: World): { dependencies: ApiDependencies; router: Router; counters: Counters } {
  const counters: Counters = { principalResolutions: 0, storeResolutions: 0 };

  const principals: PrincipalResolver = {
    async resolve() {
      counters.principalResolutions += 1;
      return ok(world.ownerA);
    },
  };

  const countingResolver: TenantStoreResolver = {
    async resolve(organizationId: string) {
      counters.storeResolutions += 1;
      return world.resolver.resolve(organizationId);
    },
  };

  const dependencies: ApiDependencies = {
    ...world.dependencies,
    resolver: countingResolver,
    principals,
  };

  const router = createRouter(createCustomerRoutes({ businesses: world.businesses }));
  return { dependencies, router, counters };
}

function url(path: string): string {
  return `https://dudo.test${CUSTOMERS_BASE_PATH}${path}`;
}

export function buildHttpAndDeferralSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('HTTP surface — deferred Actions, route drift, and wire-level indistinguishability');

  suite.test('DELETE /customers/{customer_id} answers not_implemented BEFORE authentication and before any storage handle', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router, counters } = buildApi(world);
      const response = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url(`/customers/${CUST_A_ANNA}`), { method: 'DELETE' }),
      );
      assertEqual('the status is 501', response.status, 501);
      const body = (await response.json()) as { error: { code: string; message: string } };
      assertEqual('the error code is not_implemented', body.error.code, 'not_implemented');
      assertEqual('the message is the fixed string', body.error.message, 'This operation is not available.');
      assertEqual('AUTHENTICATION WAS NOT REACHED', counters.principalResolutions, 0);
      assertEqual('NO TENANT STORE HANDLE WAS OBTAINED', counters.storeResolutions, 0);
      assertEqual('nothing was written', world.auditRows().length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('POST /customers/{customer_id}/cancel-deletion answers not_implemented, on the same terms', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router, counters } = buildApi(world);
      const response = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url(`/customers/${CUST_A_ANNA}/cancel-deletion`), { method: 'POST', body: '{}' }),
      );
      assertEqual('the status is 501', response.status, 501);
      assertEqual('AUTHENTICATION WAS NOT REACHED', counters.principalResolutions, 0);
      assertEqual('NO TENANT STORE HANDLE WAS OBTAINED', counters.storeResolutions, 0);
    } finally {
      world.close();
    }
  });

  suite.test('a DELETE naming another Organization\'s customer is still only not_implemented — the deferral is not a disclosure', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router } = buildApi(world);
      const foreign = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url(`/customers/${CUST_B_ANNA}`), { method: 'DELETE' }));
      const nowhere = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url(`/customers/${CUST_NOWHERE}`), { method: 'DELETE' }));
      const left = await foreign.text();
      const right = await nowhere.text();
      assertEqual('both are 501', `${foreign.status}|${nowhere.status}`, '501|501');
      assertEqual(
        'the two responses differ only in request_id and correlation id',
        left.replace(/gen_\d{12}/g, 'ID'),
        right.replace(/gen_\d{12}/g, 'ID'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('the route table wires exactly eight executable Actions and two deferred markers', async () => {
    const world = await makeWorld();
    try {
      const routes = createCustomerRoutes({ businesses: world.businesses });
      const executable = routes.filter((route) => route.kind === 'action');
      const deferred = routes.filter((route) => route.kind === 'deferred');
      assertEqual('eight executable routes', executable.length, 8);
      assertEqual('two deferred routes', deferred.length, 2);
      assertEqual(
        'the deferred ids are exactly the two the contract defers',
        deferred.map((route) => (route as { actionId: string }).actionId).sort().join(','),
        'customers.DeleteCustomer,customers.RestoreDeletedCustomer',
      );
      const executableIds = executable.map((route) => (route as { action: { id: string } }).action.id);
      for (const deferredId of DEFERRED_ACTION_IDS) {
        assertTrue(
          'no executable route carries a deferred action id',
          !executableIds.includes(deferredId),
          `${deferredId} is wired to a handler`,
        );
      }
      assertEqual('the eight executable ids are the contract\'s in-scope eight', executableIds.slice().sort().join(','),
        [
          'customers.ArchiveCustomer',
          'customers.CreateCustomer',
          'customers.GetCustomer',
          'customers.ListCustomers',
          'customers.MoveCustomerToBusiness',
          'customers.RestoreCustomer',
          'customers.SearchCustomers',
          'customers.UpdateCustomer',
        ].join(','));
    } finally {
      world.close();
    }
  });

  suite.test('no Action DEFINITION for either deferred id exists anywhere in the App — asserted over the source, not inferred from the route table', async () => {
    const files = ['actions', 'api', 'data', 'domain']
      .flatMap((folder) => sourceFilesIn(`${REPOSITORY}apps/customers/${folder}`))
      .concat([`${REPOSITORY}apps/customers/app.ts`]);
    const offenders: string[] = [];
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      // `id: 'customers.DeleteCustomer'` is the Action-definition form. `actionId:` is the
      // deferred ROUTE MARKER and is expected — the two are deliberately different fields, and
      // that difference is what makes this check precise rather than a keyword grep.
      for (const match of code.matchAll(/\bid:\s*'(customers\.(?:DeleteCustomer|RestoreDeletedCustomer))'/g)) {
        offenders.push(`${file.replace(REPOSITORY, '')}: ${match[0]}`);
      }
      for (const match of code.matchAll(/\bhandle\s*\(/g)) {
        void match;
      }
    }
    assertEqual(
      'no Action object is defined for customers.DeleteCustomer or customers.RestoreDeletedCustomer',
      offenders.join(' | '),
      '',
    );
  });

  suite.test('the router REFUSES CONSTRUCTION if a deferred Action is ever wired to a handler', async () => {
    const world = await makeWorld();
    try {
      const smuggled: ActionDefinition<unknown, unknown> = {
        id: 'customers.DeleteCustomer',
        appId: 'customers',
        title: 'Smuggled',
        description: 'A handler for a deferred Action, wired by the verification suite on purpose.',
        errors: ['internal'],
        permission: 'customers.customer.delete',
        scope: 'organization',
        sensitivity: 'critical',
        idempotent: false,
        audit: true,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle() {
          return ok({ output: null, writes: [], audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] } });
        },
      };
      const routes: Route[] = [
        ...createCustomerRoutes({ businesses: world.businesses }),
        { kind: 'action', method: 'DELETE', path: '/customers/{customer_id}/really', action: asAnyAction(smuggled), successStatus: 200 },
      ];
      let threw: unknown = null;
      try {
        createRouter(routes);
      } catch (cause) {
        threw = cause;
      }
      assertTrue(
        'wiring a deferred Action stops construction',
        threw instanceof DeferredActionWiredError,
        `expected DeferredActionWiredError, got ${String(threw)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('manifest.apis, the contract httpBinding and the code route table state the same ten routes', async () => {
    const world = await makeWorld();
    try {
      const manifest = JSON.parse(
        readFileSync(`${REPOSITORY}packages/contracts/apps/customers/manifest.json`, 'utf8'),
      ) as { apis: readonly { action: string; method: string; path: string; surface: string }[] };

      const contractText = readFileSync(
        `${REPOSITORY}packages/contracts/apps/customers/customer-directory-v1.contract.yaml`,
        'utf8',
      );
      // The routes are YAML flow mappings on one line each; extracting them with a pattern
      // avoids adding a YAML parser, which would be an unapproved dependency.
      const contractRoutes = [...contractText.matchAll(
        /-\s*\{\s*action:\s*(\S+?),\s*method:\s*(\w+),\s*path:\s*"([^"]+)",\s*surface:\s*(\w+)\s*\}/g,
      )].map((match) => `${match[2]} ${match[3]} ${match[1]}`);

      const manifestRoutes = manifest.apis.map((entry) => `${entry.method} ${entry.path} ${entry.action}`);
      const codeRoutes = createCustomerRoutes({ businesses: world.businesses }).map((route) =>
        route.kind === 'action'
          ? `${route.method} ${route.path} ${route.action.id}`
          : `${route.method} ${route.path} ${route.actionId}`,
      );

      assertEqual('the contract declares ten routes', contractRoutes.length, 10);
      assertEqual('the manifest declares ten routes', manifestRoutes.length, 10);
      assertEqual('the code declares ten routes', codeRoutes.length, 10);
      assertEqual('contract and manifest agree', contractRoutes.slice().sort().join(' | '), manifestRoutes.slice().sort().join(' | '));
      assertEqual('contract and code agree', contractRoutes.slice().sort().join(' | '), codeRoutes.slice().sort().join(' | '));
    } finally {
      world.close();
    }
  });

  suite.test('on the wire, a foreign-Organization not_found and a nowhere not_found are identical apart from request_id', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router } = buildApi(world);
      const foreign = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url(`/customers/${CUST_B_ANNA}`)));
      const nowhere = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url(`/customers/${CUST_NOWHERE}`)));

      assertEqual('same status', `${foreign.status}|${nowhere.status}`, '404|404');

      const headerNames = (response: Response): string =>
        [...response.headers.keys()].sort().join(',');
      assertEqual('same header set', headerNames(foreign), headerNames(nowhere));
      assertEqual(
        'same header values apart from the per-request identifiers',
        [...foreign.headers.entries()].filter(([name]) => !name.startsWith('x-')).sort().join(';'),
        [...nowhere.headers.entries()].filter(([name]) => !name.startsWith('x-')).sort().join(';'),
      );

      const leftText = await foreign.text();
      const rightText = await nowhere.text();
      assertEqual(
        'the bodies are equal in serialised BYTE LENGTH',
        new TextEncoder().encode(leftText).length,
        new TextEncoder().encode(rightText).length,
      );

      const left = JSON.parse(leftText) as { error: Record<string, unknown> };
      const right = JSON.parse(rightText) as { error: Record<string, unknown> };
      assertEqual(
        'the only differing field is request_id',
        JSON.stringify({ ...left.error, request_id: null }),
        JSON.stringify({ ...right.error, request_id: null }),
      );
      assertTrue(
        'and the two request_ids really did differ, so the comparison was not vacuous',
        left.error.request_id !== right.error.request_id,
        'both responses carried the same request_id',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a foreign-Organization business_id on create is not_found on the wire, identical to a Business that exists nowhere', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router } = buildApi(world);
      const make = (businessId: string): Request =>
        new Request(url('/customers'), {
          method: 'POST',
          body: JSON.stringify({ business_id: businessId, display_name: 'Probe', customer_type: 'company' }),
        });
      const foreign = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, make('biz_beta_east01'));
      const nowhere = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, make('biz_nowhere_0001'));
      assertEqual('both are 404', `${foreign.status}|${nowhere.status}`, '404|404');
      const left = await foreign.text();
      const right = await nowhere.text();
      assertEqual(
        'the bodies differ only in request_id',
        left.replace(/gen_\d{12}/g, 'ID'),
        right.replace(/gen_\d{12}/g, 'ID'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an unmatched path and an unmatched method both answer not_found, never 405', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router } = buildApi(world);
      const unknownPath = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url('/nothing-here')));
      const wrongMethod = await handleRequest(dependencies, router, world.app, CUSTOMERS_BASE_PATH, new Request(url('/customers/search'), { method: 'PUT' }));
      assertEqual('unknown path is 404', unknownPath.status, 404);
      assertEqual('unsupported method is 404 and not 405', wrongMethod.status, 404);
    } finally {
      world.close();
    }
  });

  suite.test('a header cannot reach an Action input — headers are never merged', async () => {
    const world = await makeWorld();
    try {
      const { dependencies, router } = buildApi(world);
      const response = await handleRequest(
        dependencies,
        router,
        world.app,
        CUSTOMERS_BASE_PATH,
        new Request(url(`/customers/${CUST_A_ANNA}`), {
          headers: { 'x-tenant-id': 'org_beta_0002', 'x-organization-id': 'org_beta_0002' },
        }),
      );
      // The request succeeds — the headers were IGNORED rather than rejected, because they
      // never reach the input at all — and it returns Organization A's own record.
      assertEqual('the request succeeds', response.status, 200);
      const body = (await response.json()) as { customer_id: string; display_name: string };
      assertEqual('it returns the caller\'s own record', body.customer_id, CUST_A_ANNA);
    } finally {
      world.close();
    }
  });

  return suite;
}
