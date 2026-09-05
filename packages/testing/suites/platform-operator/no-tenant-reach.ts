/**
 * ===========================================================================================
 * BINDING PROPERTY P1 — NOTHING IN THE PLATFORM ROUTE CLASS CAN REACH A TENANT.
 * `docs/decisions/0025` decision 3 · contract `platform-operator-v1`, `P1_noTenantStoreIsReachable`.
 * ===========================================================================================
 *
 * The contract asks for one thing by name and `qa-agent` owes it:
 *
 *   "NEGATIVE CONTROL, and it is the important one: no module in the platform route class imports
 *   TenantStoreResolver, TenantScopedStore, createD1TenantStore or TENANT_COLUMN. One grep,
 *   asserted."
 *
 * `d1-platform-store.ts` owes a second: `platform/core/action/**` and `apps/**` do not import
 * `platform/core/platform/**`. Both are below.
 *
 * ===========================================================================================
 * *** THE HONEST LIMIT OF WHAT THIS SUITE PROVES. READ IT BEFORE QUOTING THE GREEN RESULT. ***
 * ===========================================================================================
 *
 * `0025` says the guarantee "should be STRUCTURAL — nothing in the class *can* reach a tenant,
 * rather than nothing *does*." THREE DIFFERENT PROPERTIES ARE INVOLVED AND THEY ARE NOT EQUALLY
 * STRONG:
 *
 *   1. NO SOURCE FILE IN THE CLASS NAMES A TENANT PRIMITIVE. Asserted below, over the real files,
 *      with comments stripped first — the class's own headers discuss `TenantStoreResolver` at
 *      length in order to say it is absent, so an unstripped grep would fail on the documentation
 *      that exists to record the property. THIS IS A STATEMENT ABOUT TODAY'S FILES. It is a
 *      tripwire: it goes red the moment someone adds the import. It is not a proof that no such
 *      import is possible.
 *
 *   2. THE VALUES A HANDLER ACTUALLY RECEIVES CONTAIN NO STORE. Asserted below, at runtime, over
 *      the real dispatcher: the `PlatformRouteContext` handed to a handler is walked and every
 *      value in it is checked for a store-shaped object. STRONGER THAN (1), because it observes
 *      what is there rather than what is written.
 *
 *   3. THE TYPES MAKE IT UNREPRESENTABLE. `PlatformRouteDependencies` has no field for a resolver
 *      and `createPlatformComposition` has no parameter for one. *** THIS SUITE DOES NOT PROVE
 *      IT, AND CANNOT. *** Node 22 strips types without checking them, so nothing in this run
 *      evaluates a type. The check that decides property 3 is `npm run typecheck` (`tsc --noEmit`
 *      over `platform/core`, `apps` and `packages/contracts`), it is a separate command, and its
 *      result is reported separately rather than implied by a green line here.
 *
 * So: (1) and (2) hold and are asserted here; (3) is the strongest form of the property and it
 * belongs to a compiler this suite does not run. Reported to the Team Lead rather than rounded up.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import { createPlatformWorld, REQUEST_ID, CORRELATION_ID, SESSION_ADMIN } from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import {
  dispatchPlatformRoute,
  platformRoutes,
} from '../../../../platform/core/platform/platform-routes.ts';
import type {
  PlatformRouteContext,
  PlatformRouteDependencies,
} from '../../../../platform/core/platform/platform-routes.ts';
import { NO_TARGET } from '../../../../platform/core/platform/platform-audit.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const PLATFORM_CLASS_DIRECTORY = `${REPOSITORY_ROOT}platform/core/platform`;
const ACTION_DIRECTORY = `${REPOSITORY_ROOT}platform/core/action`;
const APPS_DIRECTORY = `${REPOSITORY_ROOT}apps`;

/**
 * The names a platform module may not use.
 *
 * `tenant_id` IS INCLUDED AND IS THE ONE MOST LIKELY TO BE ADDED BY ACCIDENT: every control-plane
 * table this class touches is tenant-free, so a statement naming the column would mean the class
 * had started reading a tenant table. `whereWithTenant` and `sql-compiler` are the two ways such a
 * statement would be produced rather than written.
 */
const FORBIDDEN_NAMES: readonly string[] = Object.freeze([
  'TenantStoreResolver',
  'TenantScopedStore',
  'createD1TenantStore',
  'TENANT_COLUMN',
  'whereWithTenant',
  'sql-compiler',
  'tenant_id',
  'ActionContext',
  'invokeAction',
]);

function listTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...listTypeScriptFiles(path));
      continue;
    }
    if (entry.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Removes `/* ... *\/` and `// ...` before the grep runs.
 *
 * WITHOUT THIS THE CHECK IS UNRUNNABLE, and the reason is worth stating rather than working
 * around silently: the class's own files explain at length that they hold no `TenantStoreResolver`
 * — that documentation is where the property is recorded — so a grep over raw text would fail on
 * the sentence asserting the thing it is testing.
 *
 * IT IS A LEXER'S APPROXIMATION AND NOT A PARSER. A `//` inside a string literal would be treated
 * as a comment. That is stated rather than hidden; the failure direction is toward removing MORE
 * text, which can only make this check weaker, never falsely red — so a green result here is a
 * slightly weaker claim than "the code does not contain these names", and a red one is exact.
 */
function stripComments(source: string): string {
  let output = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
      continue;
    }
    output += source[index];
    index += 1;
  }
  return output;
}

/** Every value reachable from `value`, one level of objects and arrays deep, plus `value` itself. */
function reachableValues(value: unknown, depth = 3): unknown[] {
  if (depth < 0 || value === null || typeof value !== 'object') {
    return [value];
  }
  const found: unknown[] = [value];
  for (const nested of Object.values(value as Record<string, unknown>)) {
    found.push(...reachableValues(nested, depth - 1));
  }
  return found;
}

/** The shape of `TenantScopedStore`: a `select` and a `write`. Nothing in this class may hold one. */
function looksLikeATenantStore(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.select === 'function' && typeof candidate.write === 'function';
}

export function buildNoTenantReachSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — P1: no tenant store is reachable (0025 decision 3)');

  suite.test('no module under platform/core/platform/** names a tenant primitive', () => {
    const files = listTypeScriptFiles(PLATFORM_CLASS_DIRECTORY);
    assertTrue(
      'the class has modules to check',
      files.length >= 8,
      `only ${String(files.length)} files were found under ${PLATFORM_CLASS_DIRECTORY}`,
    );

    const offences: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const name of FORBIDDEN_NAMES) {
        if (code.includes(name)) {
          offences.push(`${file.slice(REPOSITORY_ROOT.length)} names ${name}`);
        }
      }
    }
    assertEqual(
      `${ISOLATION} the platform route class holds no tenant primitive`,
      offences.join(' · '),
      '',
    );
  });

  suite.test('platform/core/action/** and apps/** do not import the platform route class', () => {
    const files = [...listTypeScriptFiles(ACTION_DIRECTORY), ...listTypeScriptFiles(APPS_DIRECTORY)];
    assertTrue('there are consumers to check', files.length > 0, 'no files were found');

    const offences: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (code.includes('core/platform/') || code.includes('/platform/platform-')) {
        offences.push(file.slice(REPOSITORY_ROOT.length));
      }
    }
    assertEqual(
      `${ISOLATION} nothing on the Action side can construct a platform store`,
      offences.join(' · '),
      '',
    );
  });

  suite.test('the composed dependencies carry no store-shaped value', async () => {
    const world = await make();
    try {
      const offenders = reachableValues(world.dependencies).filter(looksLikeATenantStore);
      assertEqual(
        `${ISOLATION} nothing reachable from PlatformRouteDependencies is a TenantScopedStore`,
        offenders.length,
        0,
      );
      // The keys, pinned. A new field is a deliberate act and this is what makes it visible.
      assertEqual(
        'the dependency set is exactly the seven the class declares',
        Object.keys(world.dependencies).sort().join(','),
        'adminHosts,audit,authenticatePrincipal,authority,authorizer,handlers,readSessionId',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a handler receives a context with no organization and no store', async () => {
    const world = await make();
    try {
      let captured: PlatformRouteContext | null = null;
      const dependencies: PlatformRouteDependencies = {
        ...world.dependencies,
        handlers: {
          'platform.session.whoami': async (context) => {
            captured = context;
            return ok({ body: { observed: true }, target: NO_TARGET });
          },
        },
      };
      const route = platformRoutes().find((entry) => entry.id === 'platform.session.whoami');
      assertTrue('the route exists', route !== undefined, 'platform.session.whoami is not registered');

      expectOk(
        'the observing handler ran',
        await dispatchPlatformRoute(dependencies, route!, {
          bodyText: '',
          headers: new Map([
            ['authorization', `Bearer ${await world.signer.mint(SESSION_ADMIN)}`],
          ]),
          queryString: '',
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        }),
      );

      assertTrue('a context was captured', captured !== null, 'the handler was never called');
      const context = captured as unknown as PlatformRouteContext;
      assertEqual(
        `${ISOLATION} the context is exactly five fields and none of them is a tenant`,
        Object.keys(context).sort().join(','),
        'authority,correlationId,query,requestId,routeId',
      );
      assertEqual(
        `${ISOLATION} the authority carries no organizationId`,
        Object.keys(context.authority).sort().join(','),
        'grants,platformRole,principalId',
      );
      assertEqual(
        `${ISOLATION} nothing reachable from the context is a store`,
        reachableValues(context).filter(looksLikeATenantStore).length,
        0,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
