/**
 * THE PROBE-DETECTION CONTROL — denied `GetCustomer` reads are audited.
 *
 * User ruling, 2026-09-02, verbatim: *"Audit every denied GetCustomer read attempt, including
 * cross-tenant probing. Keep successful customer reads unaudited."* Recorded as D2 and as the
 * CD-1 narrowing; requirements in `audit.deniedReadAudit`.
 *
 * This control was created by a QA finding, so it gets a QA suite that is harder on it than
 * the finding was. The finding was an ABSENCE — a campaign through `GetCustomer` produced zero
 * records where the same campaign through `ArchiveCustomer` produced one per attempt. The
 * failure mode of the fix is the opposite shape: a control that writes records which say too
 * much, or that changes what the caller sees, or that fails quietly. Each gets a case.
 *
 * ===========================================================================================
 * THE ONE THAT MATTERS MOST: THE EXISTENCE ORACLE
 * ===========================================================================================
 *
 * `SECURITY_STANDARD.md` §6 lets a tenant read its OWN audit log. So the audit trail is a
 * SECOND CHANNEL to the caller, slower and durable. A denial reason that distinguished "exists
 * in another Organization" from "exists nowhere" would hand the tenant, in writing, the exact
 * fact the `not_found` was shaped to withhold — the oracle closed at the API and reopened in a
 * place a probing campaign can read afterwards at leisure, without even needing to interpret
 * the responses.
 *
 * `THE ORACLE TEST` below is therefore not an incidental equality check. It asserts that the
 * record written for a FOREIGN-Organization identifier and the record written for a FABRICATED
 * identifier are indistinguishable ON EVERY FIELD except the identifier the caller itself
 * supplied. If a future change adds a field, splits `unresolved_identifier`, or enriches the
 * record from a lookup, this case is what fails.
 *
 * The corollary is checked too, and it is the trap the contract calls "the most important
 * sentence in this block": nothing in the record may be RESOLVED from the probed row, because
 * resolving it would require a second query without the tenant predicate — the control
 * becoming the vulnerability, in the one code path an attacker is guaranteed to exercise.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  BIZ_B_EAST,
  CUST_A_ANNA,
  CUST_A_SOUTH,
  CUST_B_ANNA,
  CUST_NOWHERE,
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  ORG_A,
  ORG_B,
} from '../../harness/world.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import { asAnyAction, assertAuditPolicy, AuditPolicyError } from '../../../../platform/core/action/action.ts';
import type { ActionDefinition } from '../../../../platform/core/action/action.ts';
import { createRouter } from '../../../../platform/core/http/router.ts';
import type { Route } from '../../../../platform/core/http/router.ts';
import type { AuditSink } from '../../../../platform/core/audit/audit.ts';
import type { AuditFailure, AuditFailureReporter } from '../../../../platform/core/audit/audit-failure.ts';
import { AUDIT_FAILURE_MARKER } from '../../../../platform/core/audit/audit-failure.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

/** Every value the fixture put into Organization B's records. None may reach an audit row. */
const ORGANIZATION_B_FIELD_VALUES: readonly string[] = [
  'Anna Smithson',
  'anna.smithson@beta.test',
  '+44 20 7946 0101',
  '9 Coral Way, Muharraq',
  'Zebracorp reference on file.',
  'GB',
  'Aardvark Supplies',
  'aardvark@beta.test',
  BIZ_B_EAST,
  ORG_B,
  'prn_owner_beta',
];

function rowText(row: Record<string, unknown>): string {
  return Object.values(row)
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .join('  ');
}

/**
 * Everything that is legitimately per-request. The oracle test compares every OTHER field.
 * `target_resource_id` is excluded because it is the string the caller itself typed — the one
 * thing the two records are supposed to differ in.
 */
function withoutPerRequestFields(row: Record<string, unknown>): string {
  return JSON.stringify({
    ...row,
    audit_event_id: null,
    request_id: null,
    correlation_id: null,
    target_resource_id: null,
  });
}

/** Captures the unconditional last-resort emitter so it can be asserted on and not printed. */
async function captureConsoleErrors<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const host = globalThis as { console?: { error?: (...values: readonly unknown[]) => void } };
  const original = host.console?.error;
  if (host.console !== undefined) {
    host.console.error = (...values: readonly unknown[]): void => {
      lines.push(values.map((value) => String(value)).join(' '));
    };
  }
  try {
    const value = await run();
    return { value, lines };
  } finally {
    if (host.console !== undefined && original !== undefined) {
      host.console.error = original;
    }
  }
}

export function buildDeniedReadAuditSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('denied-read audit (D2 / the CD-1 narrowing) — the probe-detection control');

  suite.test('requirement 1 — every denial path of GetCustomer writes EXACTLY ONE record, and a success writes none', async () => {
    const world = await makeWorld();
    try {
      // All three denial paths named by the contract, plus the malformed-identifier path a
      // fuzzing run produces.
      expectError('step 3 — no permission', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      assertEqual('one record after the step-3 denial', world.auditRows().length, 1);

      expectError('step 5b — unauthorized Business, same Organization', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }), EXPECTED_FORBIDDEN);
      assertEqual('two records', world.auditRows().length, 2);

      expectError(`${ISOLATION} step 5 — an identifier in another Organization`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      assertEqual('three records — THE CROSS-TENANT PROBE IS RECORDED', world.auditRows().length, 3);

      expectError('step 5 — an identifier that exists nowhere', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      assertEqual('four records', world.auditRows().length, 4);

      expectOk('a successful read', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('REQUIREMENT 7 — the success wrote nothing', world.auditRows().length, 4);

      const rows = world.auditRows();
      assertTrue('every record is a GetCustomer denial', rows.every((row) => row.action_id === 'customers.GetCustomer' && row.decision === 'denied'), JSON.stringify(rows.map((row) => [row.action_id, row.decision])));
      assertTrue('every record is in the ACTOR\'s Organization', rows.every((row) => row.tenant_id === ORG_A), 'a record landed in the wrong tenant');
    } finally {
      world.close();
    }
  });

  suite.test('requirement 2 — the record carries actor, action, timestamp, the REQUESTED identifier, the denial reason and the correlation id', async () => {
    const world = await makeWorld();
    try {
      const outcome = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.get),
        { principal: world.ownerA, app: world.app, requestId: 'req_probe_0001', correlationId: 'cor_probe_0001' },
        { customer_id: CUST_B_ANNA },
      );
      expectError(`${ISOLATION} the probe is refused`, outcome, EXPECTED_NOT_FOUND);
      const rows = world.auditRows();
      assertEqual('exactly one record', rows.length, 1);
      const row = rows[0];

      assertEqual('actor principal id', row.principal_id, 'prn_owner_alpha');
      assertEqual('actor principal type', row.principal_type, 'user');
      assertEqual("actor's Organization — the audit row's tenant", row.tenant_id, ORG_A);
      assertEqual('action id', row.action_id, 'customers.GetCustomer');
      assertEqual('app id', row.app_id, 'customers');
      assertEqual('the permission and scope ACTUALLY EVALUATED', `${row.permission_id}|${row.scope}`, 'customers.customer.read|business');
      assertEqual('THE REQUESTED CUSTOMER IDENTIFIER, as the caller supplied it', row.target_resource_id, CUST_B_ANNA);
      assertEqual('marked unresolved', row.target_unresolved, 1);
      assertEqual('the denial reason', row.denial_reason, 'not_found');
      assertEqual('the correlation id', row.correlation_id, 'cor_probe_0001');
      assertEqual('the request id', row.request_id, 'req_probe_0001');
      assertTrue('a timestamp, RFC 3339 UTC', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(row.occurred_at)), String(row.occurred_at));
    } finally {
      world.close();
    }
  });

  suite.test("requirement 3 — NO foreign customer's personal data reaches the record, asserted against every fixture value", async () => {
    const world = await makeWorld();
    try {
      expectError(`${ISOLATION} the cross-tenant probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the in-tenant wrong-Business denial', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }), EXPECTED_FORBIDDEN);
      const rows = world.auditRows();
      assertEqual('two records', rows.length, 2);

      const text = rows.map(rowText).join('  ');
      for (const value of ORGANIZATION_B_FIELD_VALUES) {
        assertTrue(
          `${ISOLATION} no Organization B value reaches the audit trail: ${JSON.stringify(value)}`,
          !text.includes(value),
          `the audit trail contained ${JSON.stringify(value)} — the control resolved the probed row, which is itself the cross-tenant read it exists to detect`,
        );
      }
      // The in-tenant case: the wrong-Business denial still must not name the Business it
      // refused. Same rule, unchanged by this ruling.
      //
      // ASSERTED AGAINST THE WRONG-BUSINESS ROW ONLY, AND THAT IS NOT A NARROWING — it is what
      // makes the assertion mean anything now that the actor business context exists. This row
      // is written by adminANorth, whose own authorized set is [biz_alpha_north] and does NOT
      // contain the target's biz_alpha_south, so the two possible sources of that string are
      // distinguishable: present means the record named the Business it refused, absent means
      // it did not. Scanning both rows together would fail on ownerA's row, where
      // biz_alpha_south is ownerA's OWN authorized Business and is required by requirement 2 —
      // a false positive that would read as a disclosure and is not one.
      const wrongBusinessRow = rows.find((row) => row.principal_id === 'prn_admin_north');
      assertTrue('control: the wrong-Business row was written', wrongBusinessRow !== undefined, 'no record from the wrong-Business denial');
      assertTrue(
        "the wrong-Business denial does not name the record's actual business_id",
        !rowText(wrongBusinessRow as Record<string, unknown>).includes(BIZ_A_SOUTH),
        `the audit record disclosed ${BIZ_A_SOUTH}, which the refusal withheld`,
      );
      assertEqual(
        "and it carries the actor's own Business instead",
        (wrongBusinessRow as Record<string, unknown>).actor_business_ids,
        `["${BIZ_A_NORTH}"]`,
      );
      assertTrue('related_business_ids is empty on every denial', rows.every((row) => row.related_business_ids === '[]'), JSON.stringify(rows.map((row) => row.related_business_ids)));
      assertTrue('changed_field_names is empty on every denial', rows.every((row) => row.changed_field_names === '[]'), JSON.stringify(rows.map((row) => row.changed_field_names)));
    } finally {
      world.close();
    }
  });

  suite.test('THE ORACLE TEST — the foreign-Organization record and the fabricated-identifier record are indistinguishable on every field except the identifier the caller supplied', async () => {
    const world = await makeWorld();
    try {
      // WHAT THIS PROTECTS: SECURITY_STANDARD.md §6 lets a tenant read its own audit log. If
      // these two records differed anywhere — a split denial reason, an extra flag, a resolved
      // field, a different permission or scope — the tenant would be able to read, at leisure
      // and in writing, the existence fact the not_found response withholds. A probing campaign
      // would not even need to interpret the responses; it would read its own audit log.
      expectError(`${ISOLATION} the foreign-Organization probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the fabricated identifier', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);

      const rows = world.auditRows();
      assertEqual('two records', rows.length, 2);
      assertEqual(
        `${ISOLATION} the two audit records are identical apart from the caller-supplied identifier`,
        withoutPerRequestFields(rows[0]),
        withoutPerRequestFields(rows[1]),
      );
      // Non-vacuity: the comparison is only meaningful if the two records really were written
      // for different identifiers.
      assertEqual('and the identifiers really did differ', `${rows[0].target_resource_id}|${rows[1].target_resource_id}`, `${CUST_B_ANNA}|${CUST_NOWHERE}`);
      // The specific split the contract forbids: `unresolved_identifier` must cover BOTH.
      assertEqual('one denial reason covers both — it is not split', `${rows[0].denial_reason}|${rows[1].denial_reason}`, 'not_found|not_found');
      assertEqual('and both are marked unresolved identically', `${rows[0].target_unresolved}|${rows[1].target_unresolved}`, '1|1');

      // SELF-CHECK, because an equality assertion is only evidence if it can fail. The exact
      // regression this case exists to catch — the third vocabulary value split into "exists
      // in another Organization" and "exists nowhere" — is synthesised here and the comparison
      // is shown to detect it. Without this, a comparison that had quietly stopped comparing
      // would still read as a pass.
      const splitReason = { ...rows[1], denial_reason: 'unresolved_identifier_in_another_organization' };
      assertTrue(
        'the comparison detects a split denial reason',
        withoutPerRequestFields(rows[0]) !== withoutPerRequestFields(splitReason),
        'the oracle comparison would NOT have noticed a split denial reason',
      );
      const enriched = { ...rows[1], related_business_ids: `["${BIZ_B_EAST}"]` };
      assertTrue(
        'and it detects a record enriched from the probed row',
        withoutPerRequestFields(rows[0]) !== withoutPerRequestFields(enriched),
        'the oracle comparison would NOT have noticed a record enriched from a foreign row',
      );
      // AND IT DETECTS A NEW COLUMN THAT DIFFERS. The comparison spreads the whole row, so a
      // column added later — the actor business context now being built for D4 is the
      // immediate case — is included automatically rather than needing to be listed. That is
      // the desired behaviour, but "it rides along" is a claim, so it is demonstrated: a
      // synthetic new column with different values on the two rows must be caught.
      const newColumnLeft = { ...rows[0], a_column_added_later: '["value_for_the_foreign_probe"]' };
      const newColumnRight = { ...rows[1], a_column_added_later: '["value_for_the_fabricated_probe"]' };
      assertTrue(
        'a NEW column that differs between the two probe records is detected',
        withoutPerRequestFields(newColumnLeft) !== withoutPerRequestFields(newColumnRight),
        'a column added later could differ between the two records without this comparison noticing — the oracle would reopen silently',
      );
    } finally {
      world.close();
    }
  });

  suite.test('requirement 1 — the EXTERNAL response is unchanged: still byte-identical and equal in length, WHILE the records are being written', async () => {
    const world = await makeWorld();
    try {
      const foreign = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.get),
        { principal: world.ownerA, app: world.app, requestId: 'req_aaaaaaaaaa1', correlationId: 'cor_aaaaaaaaaa1' },
        { customer_id: CUST_B_ANNA },
      );
      const nowhere = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.get),
        { principal: world.ownerA, app: world.app, requestId: 'req_aaaaaaaaaa2', correlationId: 'cor_aaaaaaaaaa2' },
        { customer_id: CUST_NOWHERE },
      );
      expectError(`${ISOLATION} foreign`, foreign, EXPECTED_NOT_FOUND);
      expectError('nowhere', nowhere, EXPECTED_NOT_FOUND);
      assertEqual(
        `${ISOLATION} the two responses are byte-identical`,
        JSON.stringify(foreign),
        JSON.stringify(nowhere),
      );
      assertEqual(
        `${ISOLATION} and equal in serialised byte length`,
        new TextEncoder().encode(JSON.stringify(foreign)).length,
        new TextEncoder().encode(JSON.stringify(nowhere)).length,
      );
      // The control was actually on during that comparison — otherwise this case would pass
      // just as well against the pre-ruling implementation and would prove nothing about D2.
      assertEqual('and both attempts were recorded', world.auditRows().length, 2);
    } finally {
      world.close();
    }
  });

  suite.test('requirement 6 — a THROWING audit sink does not change the answer, does not become internal, and does not go silent', async () => {
    const world = await makeWorld();
    try {
      const throwingSink: AuditSink = {
        operation() {
          throw new Error('synthetic audit sink failure');
        },
        async append() {
          throw new Error('synthetic audit sink failure');
        },
      };
      const reported: AuditFailure[] = [];
      const reporter: AuditFailureReporter = {
        report(failure) {
          reported.push(failure);
        },
      };

      const captured = await captureConsoleErrors(async () => {
        const foreign = await invokeAction(
          { ...world.dependencies, auditSinkFactory: () => throwingSink, auditFailureReporter: reporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_bbbbbbbbbb1', correlationId: 'cor_bbbbbbbbbb1' },
          { customer_id: CUST_B_ANNA },
        );
        const nowhere = await invokeAction(
          { ...world.dependencies, auditSinkFactory: () => throwingSink, auditFailureReporter: reporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_bbbbbbbbbb2', correlationId: 'cor_bbbbbbbbbb2' },
          { customer_id: CUST_NOWHERE },
        );
        return { foreign, nowhere };
      });

      expectError(
        `${ISOLATION} a failing audit sink still returns not_found, NEVER internal`,
        captured.value.foreign,
        EXPECTED_NOT_FOUND,
      );
      expectError('and the same for an identifier that exists nowhere', captured.value.nowhere, EXPECTED_NOT_FOUND);
      assertEqual(
        `${ISOLATION} the two are still byte-identical when the audit subsystem is down`,
        JSON.stringify(captured.value.foreign),
        JSON.stringify(captured.value.nowhere),
      );
      assertEqual('nothing was written', world.auditRows().length, 0);
      assertEqual('the loss was announced to the reporter, once per lost record', reported.length, 2);
      assertEqual('with the cause named', reported.map((entry) => entry.cause).join(','), 'write_threw,write_threw');
      assertEqual("and the acting Organization, so the notice is evidence of an attack on somebody", reported[0].organizationId, ORG_A);
      assertEqual('the notice carries the caller-supplied identifier', reported[0].entry.targetResourceId, CUST_B_ANNA);
      assertTrue(
        'the notice carries no foreign personal data',
        !ORGANIZATION_B_FIELD_VALUES.some((value) => JSON.stringify(reported[0]).includes(value)),
        `the failure notice contained an Organization B value: ${JSON.stringify(reported[0])}`,
      );
      assertEqual('the unconditional last-resort channel emitted too', captured.lines.filter((line) => line.startsWith(AUDIT_FAILURE_MARKER)).length, 2);
    } finally {
      world.close();
    }
  });

  suite.test('requirement 6 — the failure floor cannot be turned off by omitting the reporter, or broken by one that throws', async () => {
    const world = await makeWorld();
    try {
      const throwingSink: AuditSink = {
        operation() {
          throw new Error('synthetic audit sink failure');
        },
        async append() {
          throw new Error('synthetic audit sink failure');
        },
      };
      const brokenReporter: AuditFailureReporter = {
        report() {
          throw new Error('synthetic reporter failure');
        },
      };

      const noReporter = await captureConsoleErrors(async () =>
        invokeAction(
          { ...world.dependencies, auditSinkFactory: () => throwingSink },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_cccccccccc1', correlationId: 'cor_cccccccccc1' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError('the response is unchanged with no reporter configured', noReporter.value, EXPECTED_NOT_FOUND);
      assertEqual('the floor still emitted', noReporter.lines.filter((line) => line.startsWith(AUDIT_FAILURE_MARKER)).length, 1);

      const withBroken = await captureConsoleErrors(async () =>
        invokeAction(
          { ...world.dependencies, auditSinkFactory: () => throwingSink, auditFailureReporter: brokenReporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_cccccccccc2', correlationId: 'cor_cccccccccc2' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError('a reporter that throws cannot reach the caller', withBroken.value, EXPECTED_NOT_FOUND);
      assertEqual('and cannot suppress the floor', withBroken.lines.filter((line) => line.startsWith(AUDIT_FAILURE_MARKER)).length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('requirement 6 — a REJECTING (non-throwing) sink is announced too, and still does not change the answer', async () => {
    const world = await makeWorld();
    try {
      const rejectingSink: AuditSink = {
        operation() {
          throw new Error('unused on the denial path');
        },
        async append() {
          return { ok: false, error: { code: 'unavailable', message: 'A dependency is unavailable.' } };
        },
      };
      const reported: AuditFailure[] = [];
      const captured = await captureConsoleErrors(async () =>
        invokeAction(
          {
            ...world.dependencies,
            auditSinkFactory: () => rejectingSink,
            auditFailureReporter: { report: (failure) => reported.push(failure) },
          },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_dddddddddd1', correlationId: 'cor_dddddddddd1' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError(`${ISOLATION} the answer is the same not_found`, captured.value, EXPECTED_NOT_FOUND);
      assertEqual('the rejection was announced', reported.length, 1);
      assertEqual('with the distinct cause', reported[0].cause, 'write_rejected');
      assertEqual('and the floor emitted', captured.lines.filter((line) => line.startsWith(AUDIT_FAILURE_MARKER)).length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('the audit policy cannot be inverted — audit true with auditOnDenial false is refused at construction, twice', async () => {
    const world = await makeWorld();
    try {
      const inverted: ActionDefinition<unknown, unknown> = {
        id: 'qa.SuccessesOnly',
        appId: 'customers',
        title: 'Successes only',
        description: 'An Action that records its successes and hides its failures.',
        errors: ['internal', 'forbidden'],
        permission: 'customers.customer.read',
        scope: 'business',
        sensitivity: 'read',
        idempotent: false,
        audit: true,
        auditOnDenial: false,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle() {
          return ok({ output: null, writes: [], audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] } });
        },
      };

      let direct: unknown = null;
      try {
        assertAuditPolicy(inverted);
      } catch (cause) {
        direct = cause;
      }
      assertTrue('the guard rejects the shape', direct instanceof AuditPolicyError, `got ${String(direct)}`);

      let fromRouter: unknown = null;
      try {
        const routes: Route[] = [{ kind: 'action', method: 'GET', path: '/inverted', action: asAnyAction(inverted), successStatus: 200 }];
        createRouter(routes);
      } catch (cause) {
        fromRouter = cause;
      }
      assertTrue('the router refuses to be constructed', fromRouter instanceof AuditPolicyError, `got ${String(fromRouter)}`);

      let fromPipeline: unknown = null;
      try {
        await invokeAction(
          world.dependencies,
          asAnyAction(inverted),
          { principal: world.ownerA, app: world.app, requestId: 'req_inverted', correlationId: 'cor_inverted' },
          {},
        );
      } catch (cause) {
        fromPipeline = cause;
      }
      assertTrue('and so does the pipeline, which is the surface everything else arrives through', fromPipeline instanceof AuditPolicyError, `got ${String(fromPipeline)}`);

      // The shipped Actions all satisfy it.
      for (const action of Object.values(world.actions)) {
        assertAuditPolicy(action);
      }
    } finally {
      world.close();
    }
  });

  suite.test('CD-15 GAP, ASSERTED SO IT IS VISIBLE — denied ListCustomers and SearchCustomers still write nothing', async () => {
    const world = await makeWorld();
    try {
      // NOT a pass in the sense of "this is right". It is the assumption operating while CD-15
      // is open, written down as an executable statement so that applying the recommendation
      // later is a VISIBLE test change rather than a silent one. The contract's own
      // collectionsRecommendation calls this the one door with no camera on it.
      expectError('a denied list — no permission', await world.invoke(world.actions.list, world.unprivilegedA, {}), EXPECTED_FORBIDDEN);
      expectError('a denied search — no permission', await world.invoke(world.actions.search, world.unprivilegedA, { query: 'anna' }), EXPECTED_FORBIDDEN);
      expectError(`${ISOLATION} a list naming Organization B's Business`, await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_B_EAST }), EXPECTED_NOT_FOUND);
      expectError('a list naming an unauthorized Business of the same Organization', await world.invoke(world.actions.list, world.adminANorth, { business_id: BIZ_A_SOUTH }), EXPECTED_FORBIDDEN);
      assertEqual(
        'four explicit denials, zero records — this is the CD-15 gap and it is live',
        world.auditRows().length,
        0,
      );

      // The same four probes through GetCustomer WOULD be recorded. Asserted side by side so
      // the asymmetry is in one place rather than inferred across two suites.
      expectError(`${ISOLATION} the equivalent GetCustomer probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      assertEqual('GetCustomer records it; the collections do not', world.auditRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('a denied read is recorded even when the same principal has been denied before — no coalescing, no threshold, no sampling', async () => {
    const world = await makeWorld();
    try {
      // alertingAndAggregation: "Every denied attempt produces its own record. Sampling,
      // coalescing 'N similar attempts' into one row, or suppressing after a threshold would
      // each delete exactly the evidence a campaign consists of, and would do it fastest
      // precisely when an attack is loudest."
      const campaign = 25;
      for (let attempt = 0; attempt < campaign; attempt += 1) {
        expectError(
          `${ISOLATION} probe ${attempt + 1} of ${campaign}`,
          await world.invoke(world.actions.get, world.ownerA, { customer_id: `cust_probe_${String(attempt).padStart(6, '0')}` }),
          EXPECTED_NOT_FOUND,
        );
      }
      assertEqual('one record per attempt, none coalesced away', world.auditRows().length, campaign);
      const identifiers = new Set(world.auditRows().map((row) => row.target_resource_id));
      assertEqual('each record carries its own attempted identifier', identifiers.size, campaign);
      assertTrue(
        'and the aggregation key an operator alerts on is present on every row',
        world.auditRows().every((row) => row.tenant_id === ORG_A && row.principal_id === 'prn_owner_alpha' && row.decision === 'denied' && typeof row.occurred_at === 'string'),
        'a record is missing an aggregation field',
      );
    } finally {
      world.close();
    }
  });

  suite.test('the alerting index exists and answers the count without reading record contents', async () => {
    const world = await makeWorld();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await world.invoke(world.actions.get, world.ownerA, { customer_id: `cust_probe_${String(attempt).padStart(6, '0')}` });
      }
      const plan = world.harness.raw
        .prepare(
          "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM audit_event WHERE tenant_id = ? AND principal_id = ? AND decision = 'denied' AND occurred_at >= ?",
        )
        .all(ORG_A, 'prn_owner_alpha', '2000-01-01T00:00:00.000Z') as { detail: string }[];
      const detail = plan.map((row) => row.detail).join(' | ');
      assertTrue(
        'the alerting query is served by the covering index, not by a table scan',
        detail.includes('audit_event_by_tenant_principal_decision_time'),
        `query plan: ${detail}`,
      );
      const count = world.harness.raw
        .prepare("SELECT COUNT(*) AS n FROM audit_event WHERE tenant_id = ? AND principal_id = ? AND decision = 'denied'")
        .all(ORG_A, 'prn_owner_alpha') as { n: number }[];
      assertEqual('and it counts the campaign', count[0].n, 3);
    } finally {
      world.close();
    }
  });

  // -------------------------------------------------------------------------
  // Two conformance cases that FAIL against the current implementation. They are written
  // because the contract states these requirements in terms, and a failing test that
  // describes reality is the deliverable. Neither is a disclosure; both are evidence-quality
  // gaps. See the report.
  // -------------------------------------------------------------------------

  suite.test("the denial reason IS the Action's ErrorCode — no App-local synonym, and the same condition records the same token across Actions", async () => {
    const world = await makeWorld();
    try {
      // THE RULING THIS ENCODES (deniedReadAudit.denialReason, Team Lead, 2026-09-02).
      // architecture-agent proposed a three-token App-local vocabulary
      // (permission_denied / business_not_authorized / unresolved_identifier). It was REFUSED,
      // because `denial_reason` is a CORE-WIDE column: GetCustomer emitting
      // `unresolved_identifier` while ArchiveCustomer emits `not_found` FOR THE IDENTICAL
      // CONDITION would make the column polymorphic and break the contract's own requirement
      // that a denied-read record be readable by the same query as every other audit record.
      //
      // AN EARLIER REVISION OF THIS SUITE TESTED THE PROPOSAL. It is recorded here so the
      // point is not raised a third time: conflating step 3 and step 5b under one `forbidden`
      // does cost an operator the ability to tell "holds no grant" from "probing across
      // Businesses inside its own Organization". That detection value is ACCEPTED AS REAL and
      // is scheduled as a CORE-WIDE taxonomy question (docs/decisions/README.md, scheduled
      // item 9). It is not this App's to answer and it is not a defect in this slice.
      // RUN STRICTLY ONE AT A TIME. Starting the four invocations together would let their
      // audit writes complete in a different order from the one they were issued in — the
      // step-4 rejection is synchronous while step 5b needs a read — and the comparison below
      // is positional. An earlier revision of this case did exactly that and failed for that
      // reason rather than for anything about the implementation.
      const paths: readonly [string, () => Promise<unknown>][] = [
        ['step 3 — no permission', () => world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA })],
        ['step 5b — unauthorized Business, same Organization', () => world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH })],
        ['step 4 — a malformed identifier', () => world.invoke(world.actions.get, world.ownerA, { customer_id: 'not a valid identifier' })],
        ['step 5 — an identifier that does not resolve in the tenant', () => world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA })],
      ];
      const received: string[] = [];
      for (const [name, run] of paths) {
        const outcome = (await run()) as { ok: boolean; error?: { code: string } };
        assertTrue(`control: ${name} was refused`, outcome.ok === false, `${name} unexpectedly succeeded`);
        received.push(outcome.error?.code ?? '');
      }

      const rows = world.auditRows();
      assertEqual('four denials, four records', rows.length, 4);
      assertEqual(
        'the four recorded reasons are the four ErrorCodes the four paths return',
        rows.map((row) => row.denial_reason).join(','),
        'forbidden,forbidden,invalid_argument,not_found',
      );
      // NO APP-LOCAL SYNONYM, stated as a property rather than a list: the token written is
      // exactly the code the caller received, on every path.
      assertEqual(
        'the recorded reason equals the ErrorCode returned to the caller, path for path',
        rows.map((row) => row.denial_reason).join(','),
        received.join(','),
      );
      // And every token is drawn from the Action's own declared error set.
      const declared = new Set(world.actions.get.errors);
      assertTrue(
        "every recorded reason is in the Action's declared 'errors' list",
        rows.every((row) => declared.has(String(row.denial_reason) as never)),
        `declared: ${[...declared].join(',')} — recorded: ${rows.map((row) => row.denial_reason).join(',')}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('denial_reason is a CORE-WIDE column — the identical condition records the identical token from a different Action', async () => {
    const world = await makeWorld();
    try {
      // The polymorphism the ruling refused, tested directly: the same customer identifier,
      // the same tenant boundary, the same refusal, through two different Actions.
      expectError(`${ISOLATION} GetCustomer against Organization B's identifier`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError(`${ISOLATION} ArchiveCustomer against the same identifier`, await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      const rows = world.auditRows();
      assertEqual('two records, from two Actions', rows.length, 2);
      assertEqual('written by different Actions', `${rows[0].action_id}|${rows[1].action_id}`, 'customers.GetCustomer|customers.ArchiveCustomer');
      assertEqual(
        'and carrying the SAME denial reason, so one query reads both',
        `${rows[0].denial_reason}|${rows[1].denial_reason}`,
        'not_found|not_found',
      );
      assertEqual(
        'and the same unresolved marking',
        `${rows[0].target_unresolved}|${rows[1].target_unresolved}`,
        '1|1',
      );
    } finally {
      world.close();
    }
  });

  suite.test("CONFORMANCE — the record carries the ACTOR's business context (deniedReadAudit.recordFields, requirement 2)", async () => {
    const world = await makeWorld();
    try {
      expectError(`${ISOLATION} the cross-tenant probe`, await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      const row = world.auditRows()[0];
      // The contract: "the ACTOR'S Organization and its business context — the authenticated
      // context's own Organization and authorized business set, NEVER the target's."
      // The Organization is present as tenant_id. The authorized business set is not, and
      // `AuditEntry` has no field that could hold it: `relatedBusinessIds` is forced empty on
      // every denial for a different and still-correct reason.
      assertTrue(
        "the actor's authorized business set is recorded somewhere in the row",
        rowText(row).includes(BIZ_A_NORTH),
        `the record carries no actor business context: ${JSON.stringify(row)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test("CONFORMANCE — the actor business context is the CALLER's own set and never the target's, and relatedBusinessIds stays empty", async () => {
    const world = await makeWorld();
    try {
      // The two rules are asserted in ONE case deliberately, because they are different rules
      // that sit next to each other and a future reader needs to see that they are distinct:
      //
      //   actor business context   the CALLER's authorized set. New, and owed by requirement 2.
      //   relatedBusinessIds       the RECORD's Business. Forced empty on every denial, so that
      //                            a wrong-Business refusal cannot name the Business it refused.
      //
      // Populating the first from the second would be the disclosure the refusal withheld,
      // arriving through the field added to fix a completeness gap.
      //
      // The fixture is chosen so correct and incorrect population are distinguishable:
      // adminANorth is authorized over biz_alpha_north ONLY, and the probed record
      // CUST_A_SOUTH lives in biz_alpha_south. A row carrying north is right; a row carrying
      // south is a disclosure.
      expectError(
        'the in-tenant wrong-Business denial',
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      const row = world.auditRows()[0];
      const text = rowText(row);

      assertTrue(
        "the record carries the CALLER's own authorized Business",
        text.includes(BIZ_A_NORTH),
        `no actor business context in the record: ${JSON.stringify(row)}`,
      );
      assertTrue(
        "and NEVER the Business of the record it refused",
        !text.includes(BIZ_A_SOUTH),
        `the record disclosed the target's Business ${BIZ_A_SOUTH}: ${JSON.stringify(row)}`,
      );
      assertEqual('relatedBusinessIds is still empty on the denial', row.related_business_ids, '[]');

      // And on a CROSS-TENANT probe there is no target context to take, correctly: nothing was
      // resolved. The actor's own set is still recorded; nothing of Organization B's is.
      expectError(
        `${ISOLATION} the cross-tenant probe`,
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      const probeRow = world.auditRows()[1];
      assertTrue(
        "the probe record carries the caller's own Business",
        rowText(probeRow).includes(BIZ_A_NORTH),
        `no actor business context: ${JSON.stringify(probeRow)}`,
      );
      assertTrue(
        `${ISOLATION} and nothing of Organization B's`,
        !ORGANIZATION_B_FIELD_VALUES.some((value) => rowText(probeRow).includes(value)),
        `the probe record carried an Organization B value: ${JSON.stringify(probeRow)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('the actor business context can only come from the authenticated principal — App code has no channel to it', async () => {
    const world = await makeWorld();
    try {
      const { createStoreAuditSink } = await import('../../../../platform/core/audit/store-audit-sink.ts');
      const { ActorContextNotDerivedError, deriveActorBusinessContext } = await import('../../../../platform/core/audit/audit.ts');
      const store = await world.storeFor(ORG_A);
      const sink = createStoreAuditSink(store, world.ids);

      const baseEntry = {
        appId: 'customers',
        actionId: 'customers.GetCustomer',
        principalId: 'prn_owner_alpha',
        principalType: 'user',
        onBehalfOfPrincipalId: null,
        permissionId: 'customers.customer.read',
        scope: 'business' as const,
        decision: 'denied' as const,
        denialReason: 'not_found' as const,
        targetResourceId: CUST_B_ANNA,
        targetUnresolved: true,
        relatedBusinessIds: [],
        changedFieldNames: [],
        requestId: 'req_forged_0001',
        correlationId: 'cor_forged_0001',
        occurredAt: world.clock.now(),
      };

      // 1. AN UNBRANDED ARRAY IS REFUSED AT THE WRITE. A plain array of the TARGET's Business
      //    — the disclosure this field sits next to — cannot be written.
      let forged: unknown = null;
      try {
        sink.operation({ ...baseEntry, actorBusinessIds: [BIZ_A_SOUTH] as never });
      } catch (cause) {
        forged = cause;
      }
      assertTrue(
        'a value that did not come from the authenticated principal is refused',
        forged instanceof ActorContextNotDerivedError,
        `expected ActorContextNotDerivedError, got ${String(forged)}`,
      );

      // 2. A DERIVED VALUE IS ACCEPTED, so case 1 is a rejection of provenance and not of the
      //    shape — otherwise it would pass against an implementation that refused everything.
      const derived = deriveActorBusinessContext(world.adminANorth);
      const operation = sink.operation({ ...baseEntry, actorBusinessIds: derived });
      assertEqual('a derived value writes', operation.kind, 'insert');
      assertEqual('and carries the principal\'s own set', (operation.spec as { values: Record<string, unknown> }).values.actor_business_ids, `["${BIZ_A_NORTH}"]`);

      // 3. IT IS A FROZEN COPY. Mutating the principal's array afterwards cannot reach a
      //    record already assembled from it.
      assertTrue('the derived context is frozen', Object.isFrozen(derived), 'the derived actor context is mutable');
    } finally {
      world.close();
    }
  });

  suite.test('an App handler cannot supply, override or influence the actor business context', async () => {
    const world = await makeWorld();
    try {
      // `AuditFacts` has no member for it, so a handler that tries has nothing to set. The
      // handler here is written as a hostile App author would write it — with the field
      // present and cast past the type — to prove the absence is enforced at runtime by the
      // pipeline overwriting it, and not only by the type declaration.
      const probe: ActionDefinition<unknown, unknown> = {
        id: 'qa.ActorContextProbe',
        appId: 'customers',
        title: 'Actor context probe',
        description: 'A hostile App handler used only by the verification suite.',
        errors: ['internal', 'forbidden', 'not_found'],
        permission: 'customers.customer.read',
        scope: 'business',
        sensitivity: 'read',
        idempotent: false,
        audit: true,
        exposure: [],
        parseInput: (raw) => ok(raw),
        targetIdentifier: () => null,
        async handle() {
          return ok({
            output: null,
            writes: [],
            audit: {
              targetResourceId: null,
              relatedBusinessIds: [],
              changedFieldNames: [],
              // The injection attempt: the target's Business, and another Organization's.
              actorBusinessIds: [BIZ_A_SOUTH, BIZ_B_EAST],
            } as never,
          });
        },
      };

      expectOk('the probe Action runs', await world.invoke(asAnyAction(probe), world.adminANorth, {}));
      const row = world.auditRows()[0];
      assertEqual(
        "the record carries the principal's derived set, not the handler's",
        row.actor_business_ids,
        `["${BIZ_A_NORTH}"]`,
      );
      assertTrue(
        `${ISOLATION} nothing the handler supplied reached the record`,
        !rowText(row).includes(BIZ_A_SOUTH) && !rowText(row).includes(BIZ_B_EAST),
        `the handler's injected Businesses reached the audit trail: ${JSON.stringify(row)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('CONFORMANCE — the actor business context is EQUAL across the probe and the fabricated identifier, so the new field does not reopen the oracle', async () => {
    const world = await makeWorld();
    try {
      // A new column on a denial record is a new opportunity to reopen the existence oracle,
      // and this is the case that would catch it. The field is derived from the CALLER, so it
      // must be identical between a probe at another Organization's record and a probe at
      // nothing at all — a field that varied between those two rows would distinguish them in
      // a record the tenant can read (SECURITY_STANDARD.md §6).
      //
      // ASSERTED AS PRESENCE **AND** EQUALITY, not equality alone. Equality alone would be
      // vacuously true while the field does not exist, and would go green today for the wrong
      // reason — which is the failure mode this whole suite is built against.
      expectError(`${ISOLATION} the foreign-Organization probe`, await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the fabricated identifier', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      const rows = world.auditRows();
      assertEqual('two records', rows.length, 2);

      const present = rows.filter((row) => rowText(row).includes(BIZ_A_NORTH)).length;
      assertEqual('the actor business context is present on BOTH records', present, 2);
      assertEqual(
        `${ISOLATION} and the two records remain identical apart from the caller-supplied identifier`,
        withoutPerRequestFields(rows[0]),
        withoutPerRequestFields(rows[1]),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
