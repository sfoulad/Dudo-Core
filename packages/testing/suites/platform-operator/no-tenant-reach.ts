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
 *
 * ===========================================================================================
 * *** 4. AND A FOURTH LIMIT ON A DIFFERENT AXIS ENTIRELY — SCOPE, NOT STRENGTH. SR-18. ***
 * ===========================================================================================
 *
 * **The three above are all about how STRONGLY the property is proven. None of them says anything
 * about WHERE.** All three range over `platform/core/platform/**`, and a security review found that
 * **not one of them would move if `platform.organizations.set-template` began writing arbitrary
 * tenant rows** — because that write happens in `platform/core/directory/member-resolution.ts`,
 * outside the scanned directory.
 *
 * *** P1 IS INTACT AND THE DELEGATION IS LEGITIMATE. *** `set-template` writes the tenant-side
 * audit record into the named Organization's OWN database through
 * `MemberResolutionPort.recordOrganizationAccess`, which requires an `OperatorWriteCharged`
 * receipt. Keeping that write on a different port from the control-plane one is what makes `0024`'s
 * mutual exclusion structural rather than observed.
 *
 * **What had drifted is the CERTIFICATE, not the code.** This suite's green reads as *"nothing in
 * the class can reach a tenant"* and proves something narrower — and **the delegation path is
 * exactly how the class legitimately does reach one.** `setOrganizationTemplate`'s own header states
 * this correctly; the suite that certifies P1 did not. **That asymmetry is the defect, because a
 * reader auditing tenant reach opens the suite and not the handler.**
 *
 * *** THE LIMIT IS BOUNDED RATHER THAN MERELY STATED, AND THAT IS THE DIFFERENCE WORTH THE CODE. ***
 * A sentence would have been the whole fix and would have gone stale the first time a third file
 * delegated. The case below asserts the delegation surface is EXACTLY what it is today: two files,
 * one symbol, both `import type`. **A third delegation point, or a value import where a type import
 * stands, goes red** — so the honest limit cannot silently widen into a hole.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import { stripComments } from '../../harness/source-text.ts';
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
 * The comment stripper MOVED to `harness/source-text.ts` on 2026-09-05, unchanged in behaviour.
 *
 * WITHOUT IT THIS CHECK IS UNRUNNABLE, and the reason is worth restating where the check lives:
 * the class's own files explain at length that they hold no `TenantStoreResolver` — that
 * documentation is where the property is recorded — so a grep over raw text would fail on the
 * sentence asserting the thing it is testing.
 *
 * IT IS A LEXER'S APPROXIMATION AND NOT A PARSER, and the limit is stated at the definition. The
 * failure direction is toward removing MORE text, which can only make this check weaker, never
 * falsely red — so a green result here is a slightly weaker claim than "the code does not contain
 * these names", and a red one is exact.
 *
 * It moved because `business-type-boundary.ts` needs the same lexer, and a heuristic with two
 * copies is two heuristics: the one that gets fixed and the one that does not.
 */

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
      // =====================================================================================
      // EACH DEPENDENCY IS NAMED WITH THE REASON IT IS NOT A TENANT HANDLE. A COUNT WOULD ERODE.
      // =====================================================================================
      //
      // This assertion used to pin a sorted key string reading "the seven the class declares".
      // When `createPlatformComposition` began returning `confirmations` it went red, and the
      // tempting repair was to add the word to the string and change seven to eight — which is a
      // control that gets bumped rather than one that has to be argued.
      //
      // THE FIELD-TO-REASON FORM IS THE ONE THE TEAM LEAD ALREADY RULED FOR THE HANDLER CONTEXT
      // twenty lines below, when `objects` and `sessionId` were added there. The same argument
      // applies with more force here, because THIS is the object `0025` decision 3's binding
      // property is a statement about: *"`PlatformRouteDependencies` has no field for a resolver."*
      // A key set that can be updated by copying the actual output is not evidence for that.
      //
      // Adding a dependency means writing down here why it cannot reach a tenant. An unexplained
      // one fails, and so does a removed one.
      const permittedDependencies: Readonly<Record<string, string>> = {
        adminHosts: 'a frozen list of hostnames. Strings, and 0025 requires them to be the SECOND layer',
        audit: 'a PlatformAuditRecorder over the platform store; it writes platform_operator_action and reads nothing tenant-scoped',
        authenticatePrincipal:
          'a function from a session id to a principal id. Deliberately NOT a SessionResolver — ' +
          'composition.ts states the least-privilege split, and the narrow function cannot select ' +
          'an Organization',
        authority:
          'a PlatformAuthorityResolver. It reads platform_operator and probes ' +
          'organization_membership for the mutual exclusion, and returns a role and a grant set — ' +
          'never a handle to either table',
        authorizer: 'the same pure Authorizer every Action uses. It holds no store at all',
        confirmations:
          'the ConfirmationGate, ADDED 2026-09-05 by 0027. It is a gate and not a service: its ' +
          'only method is `enforce`, so this class cannot ISSUE a challenge, only spend one. ' +
          'composition.ts passes it through rather than building it precisely so the class does ' +
          'not acquire a CredentialVerifier. It reads `confirmation`, a control-plane table with ' +
          'no tenant column, and it is undefined in a deployment that composes no gate',
        handlers: 'the route handlers. The context they receive is asserted field by field below',
        readSessionId: 'the shared credential reader. Headers in, a session id out',
      };
      const actualDependencies = Object.keys(world.dependencies).sort();
      assertEqual(
        `${ISOLATION} every composed dependency is named here with why it is not a tenant handle`,
        actualDependencies.filter((key) => !(key in permittedDependencies)).join(','),
        '',
      );
      assertEqual(
        'and every dependency named here is still composed — a removed one is also a change to argue',
        Object.keys(permittedDependencies)
          .filter((key) => !actualDependencies.includes(key))
          .join(','),
        '',
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
          // `platform.session.whoami` declares no path parameter, so `{}` is the correct value —
          // but OMITTING it was a type error the runtime ignored, and `npm run typecheck:tests`
          // is what found it. The case stayed green while the fixture no longer matched the port.
          pathParams: {},
          requestId: REQUEST_ID,
          correlationId: CORRELATION_ID,
        }),
      );

      assertTrue('a context was captured', captured !== null, 'the handler was never called');
      const context = captured as unknown as PlatformRouteContext;
      // =====================================================================================
      // EACH FIELD IS NAMED WITH THE REASON IT IS NOT A TENANT. A COUNT WOULD ERODE.
      // =====================================================================================
      //
      // This assertion used to pin a sorted key string. When the challenge route added `objects`
      // and `sessionId` it went red, and the tempting repair was to update the string — which
      // would have been a control that gets bumped rather than one that has to be argued. The
      // Team Lead ruled the two additions legitimate AND ruled that the assertion should survive
      // in a form where the NEXT addition has to be justified rather than appended.
      //
      // So the expected set is a MAP FROM FIELD TO REASON. Adding a field means writing down why
      // it is not a tenant, in this file, where a reviewer reads it. An unexplained field fails.
      const permitted: Readonly<Record<string, string>> = {
        routeId: 'a Core-owned literal from the frozen route table',
        authority: 'a principal id, a platform role and a frozen grant set — no organizationId',
        query: 'validated query parameters, checked against the route\'s declared set',
        objects: 'validated nested body fields; the challenge route\'s `parameters` and nothing else',
        sessionId:
          'the session the confirmation binds to. A session is not a tenant: an operator\'s ' +
          'session carries a null active_organization_id for its whole life (0024), so this ' +
          'yields no Organization even indirectly',
        pathParams:
          'path parameters the route declared, decoded and validated by the class. They name an ' +
          'Organization or a principal on the routes that take one — an identifier, never a store ' +
          'and never a handle. `0025`\'s honest limit applies: this class may NAME a tenant and may ' +
          'never read a row behind `whereWithTenant`',
        charge:
          'ADDED 2026-09-05. A BUDGET RECEIPT, NOT A HANDLE. `OperatorWriteCharged` is a branded ' +
          'value holding a principal identifier and an opaque ControlPlaneWriteReservation — no ' +
          'store, no resolver, no binding, no organizationId — and the two handlers that write ' +
          'into a customer\'s tenant database must pass it to the service that performs the ' +
          'write, which requires it as a parameter. So P1 is untouched: it grants no reach, it ' +
          'proves the operator already paid. `looksLikeATenantStore` below still walks it',
        requestId: 'an observability value',
        correlationId: 'an observability value, shape-validated at the transport boundary',
      };
      const actual = Object.keys(context).sort();
      const unexplained = actual.filter((field) => !(field in permitted));
      assertEqual(
        `${ISOLATION} every field a handler receives is named here with why it is not a tenant`,
        unexplained.join(','),
        '',
      );
      const missing = Object.keys(permitted).filter((field) => !actual.includes(field));
      assertEqual(
        'and every field named here is still present — a removed field is also a change to argue',
        missing.join(','),
        '',
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

  suite.test('*** THE DELEGATION SURFACE IS BOUNDED — SR-18, THE FOURTH LIMIT MADE MECHANICAL ***', () => {
    // ===================================================================================
    // THE OTHER CASES IN THIS FILE ASK *HOW STRONGLY*. THIS ONE ASKS *HOW FAR*.
    // ===================================================================================
    //
    // Every other assertion here ranges over `platform/core/platform/**`, and **none of them would
    // move if `set-template` began writing arbitrary tenant rows** — that write lives in
    // `platform/core/directory/member-resolution.ts`, outside the scan. See the fourth limit in
    // this file's header for why the delegation itself is legitimate and why the CERTIFICATE was
    // the thing that had drifted.
    //
    // **This bounds it.** The class may delegate to exactly the surface it delegates to today, and
    // a new delegation point is a change somebody has to make deliberately.
    const files = listTypeScriptFiles(PLATFORM_CLASS_DIRECTORY);
    assertTrue(
      `${ISOLATION} THE FLOOR: the class directory was read (${files.length} files)`,
      files.length > 3,
      'a walk that finds nothing finds no delegation either, and would certify a bounded surface ' +
        'it never looked at',
    );

    // Import lines only — not prose. This file's own headers discuss `MemberResolutionService` at
    // length in order to state the limit, and an unstripped search would match the documentation
    // that exists to record the property. The same trap the first case in this file already avoids.
    const delegations: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!/^\s*import\b/u.test(line)) continue;
        if (!/from\s+'[^']*\/directory\//u.test(line)) continue;
        delegations.push(
          `${file.slice(REPOSITORY_ROOT.length)}: ${/^\s*import\s+type\b/u.test(line) ? 'type-only' : 'VALUE'}`,
        );
      }
    }

    console.log(`        delegation surface: ${delegations.length} import(s) out of the class into directory/`);

    // *** EXACTLY THESE, AND `type-only` IS THE HALF THAT MATTERS. *** A `import type` carries no
    // runtime value across the boundary — the service arrives through `createPlatformComposition`,
    // where the runtime case above walks what a handler actually receives. **A VALUE import would
    // mean the class had acquired a live handle at module scope, which is the exact shape case (2)
    // exists to refuse and which it would not see, because it inspects the context and not the
    // module.**
    assertEqual(
      `${ISOLATION} the class delegates out of itself in exactly the two known places, both type-only`,
      delegations.sort().join(' · '),
      'platform/core/platform/composition.ts: type-only · platform/core/platform/platform-route-handlers.ts: type-only',
    );

    // AND THE MIRROR, because an empty list would satisfy the equality above only by accident of
    // the expected string — but a reader meeting a green here should know the surface is non-empty
    // and deliberate rather than absent. `0024`'s mutual exclusion is a property of there BEING a
    // separate port, not of there being no path at all.
    assertTrue(
      'and that surface is NOT empty — the separation is two ports, not the absence of a path',
      delegations.length === 2,
      `the class delegates ${delegations.length} times. Zero would mean the tenant-side audit write ` +
        'has moved onto this class\'s own port, which is 0024 failing quietly rather than the ' +
        `guarantee strengthening: ${JSON.stringify(delegations)}`,
    );
  });

  return suite;
}
