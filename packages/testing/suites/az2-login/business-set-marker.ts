/**
 * ===========================================================================================
 * THE OPERATIONAL MARKER FOR A FAILED BUSINESS-SET READ. `docs/decisions/0020` property 3.
 * ===========================================================================================
 *
 * ADOPTED from `core-agent`'s `verify-business-set-marker.ts`, which existed only in a
 * session-scoped scratchpad.
 *
 * `business-set.ts` already asserts that a failed read REFUSES the request rather than
 * continuing with an empty set. This is the other half: that the refusal is VISIBLE to an
 * operator, and that making it visible does not leak anything.
 *
 * Both halves are needed. `0020` property 3 exists because an empty set is indistinguishable
 * from "authorized over nothing", so a storage failure would present as a silent total
 * `forbidden` that looks like a permissions bug. Refusing fixes the response; the marker is what
 * stops the refusal being invisible in the logs as well.
 *
 * ===========================================================================================
 * A LOG LINE IS AN OUTPUT CHANNEL, AND `security.md` §6 GOVERNS IT
 * ===========================================================================================
 *
 * *"Error messages and logs must not leak business data, tenant identifiers belonging to others,
 * or internal structure to a caller."* The marker names the authenticated Organization — its own
 * tenant, which is the point of the line — and must name nothing else: no principal, no request
 * id, no action id, no path, no query, no body.
 *
 * ===========================================================================================
 * ONE ASSERTION IS REPAIRED RATHER THAN ADOPTED VERBATIM
 * ===========================================================================================
 *
 * The original read:
 *
 *     check('the line contains nothing caller-supplied',
 *       !whole.includes('customers.ListCustomers') === false || true);
 *
 * The trailing `|| true` makes it PASS UNCONDITIONALLY. It is an empty assertion wearing the
 * name of the most security-relevant check in the file — the ninth instance of that class in
 * this slice, and the only one found in a harness rather than in a test or a stub.
 *
 * It is rewritten below to assert what its name claims, against every caller-influenced value
 * the pipeline holds at that moment. `console.error` is captured and RESTORED in `finally`; the
 * original patched it at module scope and never put it back.
 */

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import { BUSINESS_SET_FAILURE_MARKER } from '../../../../platform/core/tenancy/business-set-failure.ts';
import { err, ok } from '../../../../platform/core/kernel/result.ts';
import { internal, unavailable } from '../../../../platform/core/kernel/errors.ts';

const ORG = 'org-1234567890123456ab';
const PRINCIPAL = 'p'.repeat(22);
const REQUEST_ID = 'r'.repeat(22);
const CORRELATION_ID = 'c'.repeat(22);
const ACTION_ID = 'customers.ListCustomers';

const ACTION = {
  appId: 'customers',
  id: ACTION_ID,
  permission: 'customers.customer.list',
  scope: 'organization' as const,
  audit: false,
  auditOnDenial: false,
  maxRowWrites: 0,
  errors: ['unavailable', 'forbidden', 'not_found'],
  parseInput: () => ok({}),
  targetIdentifier: () => null,
  handle: async () => ok({ output: {}, writes: [], audit: null }),
};

const TENANT_STORE = {
  async select() {
    return ok([]);
  },
  async write() {
    return ok(undefined);
  },
};

function dependencies(listOutcome: 'ok' | 'unavailable' | 'internal', reporter?: unknown) {
  return {
    resolver: {
      async resolve() {
        return ok(TENANT_STORE as never);
      },
    },
    authorizer: {
      authorize: () => ({
        allowed: true,
        permissionId: 'customers.customer.list',
        scope: 'organization' as const,
      }),
    },
    clock: { now: () => '2026-09-05T00:00:00.000Z', nowMs: () => 0 },
    ids: { generate: () => 'id0000000000000000000' },
    cursors: { issue: async () => ok(''), verify: async () => ok({}) },
    businesses: {
      async existsInTenant() {
        return ok(true);
      },
      async listInTenant() {
        if (listOutcome === 'ok') return ok(['biz-1']);
        return err(listOutcome === 'internal' ? internal() : unavailable());
      },
    },
    businessSetFailureReporter: reporter,
  };
}

function envelope() {
  return {
    principal: sealAuthenticatedPrincipal({
      principalId: PRINCIPAL,
      principalType: 'user',
      organizationId: ORG,
      authorizedBusinessIds: [],
      businessScope: 'organization',
      grants: { grants: [{ permissionId: 'customers.customer.list', scope: 'organization' }] },
      onBehalfOfPrincipalId: null,
    }),
    app: {
      appId: 'customers',
      declared: [{ permissionId: 'customers.customer.list', scope: 'organization' as const }],
    },
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    sourceAddressHash: null,
  };
}

/** Captures `console.error` and ALWAYS restores it. */
async function capturing<T>(
  body: () => Promise<T>,
): Promise<{ readonly value: T; readonly lines: readonly string[] }> {
  const lines: string[] = [];
  const original = console.error.bind(console);
  console.error = ((...values: unknown[]) => {
    lines.push(values.map(String).join(' '));
  }) as never;
  try {
    return { value: await body(), lines };
  } finally {
    console.error = original;
  }
}

const markersIn = (lines: readonly string[]): string[] =>
  lines.filter((line) => line.startsWith(BUSINESS_SET_FAILURE_MARKER));

export function buildBusinessSetMarkerSuite(): Suite {
  const suite = new Suite('AZ5 — the business-set failure marker (0020 property 3)');

  suite.test('a successful read emits NO marker, and the request succeeds', async () => {
    // Scoped to THIS marker rather than to all output: the composition has no coordinator, so
    // `coordination_failed` fires on every request. Asserting "no output at all" would be
    // asserting the harness's shape rather than the behaviour under test.
    const observed = await capturing(() =>
      invokeAction(dependencies('ok') as never, ACTION as never, envelope() as never, {}),
    );
    assertEqual('no business-set marker', markersIn(observed.lines).length, 0);
    assertEqual('and the request succeeded', (observed.value as { ok: boolean }).ok, true);
  });

  suite.test('a failed read emits exactly one marker and still refuses with unavailable', async () => {
    const observed = await capturing(() =>
      invokeAction(dependencies('unavailable') as never, ACTION as never, envelope() as never, {}),
    );
    const markers = markersIn(observed.lines);
    assertEqual('exactly one marker line', markers.length, 1);
    assertEqual(
      'and the request still fails',
      (observed.value as { ok: boolean }).ok,
      false,
    );
    assertEqual(
      'with unavailable, unchanged by the reporting',
      (observed.value as { ok: false; error: { code: string } }).error.code,
      'unavailable',
    );
    assertEqual(
      'and the envelope carries no details a caller could read the cause from',
      ((observed.value as { ok: false; error: { details?: unknown[] } }).error.details ?? []).length,
      0,
    );
  });

  suite.test(
    'THE MARKER LEAKS NOTHING CALLER-INFLUENCED — repaired from an assertion that always passed',
    async () => {
      // The original was `!whole.includes('customers.ListCustomers') === false || true`, which
      // passes regardless of the line's contents. This asserts what that name claimed.
      const observed = await capturing(() =>
        invokeAction(dependencies('unavailable') as never, ACTION as never, envelope() as never, {}),
      );
      const line = markersIn(observed.lines)[0] ?? '';
      assertTrue('a marker line was emitted to inspect', line !== '', 'no marker to examine');

      const payload = JSON.parse(line.slice(BUSINESS_SET_FAILURE_MARKER.length).trim()) as Record<
        string,
        unknown
      >;

      // What it MUST name: its own tenant, the internal cause, and Core's error code.
      assertEqual('it names the authenticated Organization', payload.organization_id, ORG);
      assertEqual('it names the internal cause', payload.cause, 'business_set_read_failed');
      assertEqual("it names Core's own error code", payload.error_code, 'unavailable');
      assertEqual(
        'exactly three fields — nothing else can ride along',
        Object.keys(payload).sort().join(','),
        'cause,error_code,organization_id',
      );

      // What it must NOT contain, asserted against the WHOLE line rather than the parsed object,
      // so a value smuggled into a prefix or a suffix is caught too.
      for (const [what, value] of [
        ['the principal id', PRINCIPAL],
        ['the request id', REQUEST_ID],
        ['the correlation id', CORRELATION_ID],
        ['the action id', ACTION_ID],
        ['the app id path', '/api/v1/apps/customers'],
      ] as const) {
        assertTrue(
          `the marker line does not contain ${what}`,
          !line.includes(value),
          `the line was: ${line}`,
        );
      }
    },
  );

  suite.test('the error code in the marker varies with the real cause', async () => {
    // Otherwise the line would be a constant and an operator could not tell an `internal` from an
    // `unavailable` without reading the code.
    const asInternal = await capturing(() =>
      invokeAction(dependencies('internal') as never, ACTION as never, envelope() as never, {}),
    );
    const line = markersIn(asInternal.lines)[0] ?? '';
    const payload = JSON.parse(line.slice(BUSINESS_SET_FAILURE_MARKER.length).trim()) as {
      error_code?: string;
    };
    assertEqual('an internal read failure is reported as internal', payload.error_code, 'internal');
  });

  suite.test('three failures emit three lines — the marker is not dampened', async () => {
    // A dampened marker would hide a sustained outage behind a single early line, which is the
    // opposite of what an operator needs from it.
    const observed = await capturing(async () => {
      for (let index = 0; index < 3; index += 1) {
        await invokeAction(
          dependencies('unavailable') as never,
          ACTION as never,
          envelope() as never,
          {},
        );
      }
      return null;
    });
    assertEqual('three failures, three lines', markersIn(observed.lines).length, 3);
  });

  suite.test('a THROWING reporter does not change the answer or suppress the floor', async () => {
    // An injected reporter is a place a failure could escape into the request. It must not, and
    // the last-resort channel must still emit.
    const throwing = {
      report() {
        throw new Error('the reporter is broken');
      },
    };
    const observed = await capturing(() =>
      invokeAction(
        dependencies('unavailable', throwing) as never,
        ACTION as never,
        envelope() as never,
        {},
      ),
    );
    assertEqual(
      'the caller still gets unavailable, not internal',
      (observed.value as { ok: false; error: { code: string } }).error.code,
      'unavailable',
    );
    assertEqual('and the marker still emitted', markersIn(observed.lines).length, 1);
  });

  return suite;
}
