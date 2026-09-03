/**
 * THE PROBE-DETECTION CONTROL — denied `GetCustomer` reads are recorded.
 *
 * User ruling, 2026-09-02, verbatim: *"Audit every denied GetCustomer read attempt, including
 * cross-tenant probing. Keep successful customer reads unaudited."* Recorded as D2 and as the
 * CD-1 narrowing; requirements in `audit.deniedReadAudit`.
 *
 * ===========================================================================================
 * REWRITTEN FOR docs/decisions/0013 — "RECORDED" NO LONGER MEANS "ONE ROW PER ATTEMPT"
 * ===========================================================================================
 *
 * 0013 (Accepted, user decision of 2026-09-02) replaced per-attempt D1 writes with bounded
 * aggregation: one summarised `denial_summary` record per actor + Organization + Action +
 * denial category + 15-minute window, carrying first attempt time, last attempt time and total
 * attempt count. Every case in this suite that asserted a per-attempt `audit_event` row was
 * therefore WRONG BY DESIGN the moment 0013 landed.
 *
 * THEY ARE REWRITTEN, NOT WEAKENED, AND THE DISTINCTION IS THE WHOLE POINT. "Twenty-five
 * attempts produce twenty-five rows" becomes "twenty-five attempts produce a bounded number of
 * summaries whose counts add up to twenty-five, with the first and last attempt times of the
 * run". It does NOT become "at least one row was written". THE COUNT IS THE EVIDENCE: a
 * summary that lost the attempt count would be a worse audit trail than the per-attempt rows it
 * replaced, and an "at least one" assertion would go green against exactly that regression.
 *
 * WHAT WAS LOST, ASSERTED SO THAT IT IS VISIBLE RATHER THAN DISCOVERED. `denial_summary` has no
 * `target_resource_id`, no `request_id` and no `correlation_id` — an aggregate over many
 * requests has no single one of any of them, and 0013 control 5 forbids the identifier being in
 * the grouping. The Customer Directory contract's CD-5 obligation ("the identifier AS SUPPLIED
 * BY THE CALLER, marked unresolved") is therefore no longer satisfiable and is CONTRADICTED by
 * the later Accepted decision. That conflict is reported to the Team Lead; the cases below
 * assert the current behaviour explicitly so that reconciling it is a visible test change.
 *
 * ===========================================================================================
 * THE ONE THAT MATTERS MOST: THE EXISTENCE ORACLE — AND IT SURVIVED THE REWRITE INTACT
 * ===========================================================================================
 *
 * `SECURITY_STANDARD.md` §6 lets a tenant read its OWN audit log. So the evidence tables are a
 * SECOND CHANNEL to the caller, slower and durable. A denial reason that distinguished "exists
 * in another Organization" from "exists nowhere" would hand the tenant, in writing, the exact
 * fact the `not_found` was shaped to withhold.
 *
 * Under aggregation the property gets STRONGER, not weaker. The two probes used to produce two
 * rows that had to be compared field for field and shown to be equal — and two rows that happen
 * to be equal can drift apart the day someone adds a column. They now produce ONE ROW, because
 * the requested identifier is deliberately not part of the group key (control 5). There is
 * nothing left to compare, which is the strongest form the assertion can take. The cases below
 * assert single-group membership, and the negative control in `broken-coordination.ts` puts the
 * identifier back into the key and shows they go red.
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
  FIXED_START_MS,
  ORG_A,
  ORG_B,
} from '../../harness/world.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import { asAnyAction, assertAuditPolicy, AuditPolicyError } from '../../../../platform/core/action/action.ts';
import type { ActionDefinition } from '../../../../platform/core/action/action.ts';
import { createRouter } from '../../../../platform/core/http/router.ts';
import type { Route } from '../../../../platform/core/http/router.ts';
import type {
  CoordinationFailure,
  CoordinationFailureReporter,
} from '../../../../platform/core/audit/coordination-failure.ts';
import { COORDINATION_FAILURE_MARKER } from '../../../../platform/core/audit/coordination-failure.ts';
import { DENIAL_WINDOW_MS } from '../../../../platform/core/protection/coordination.ts';
import { err, ok } from '../../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../../platform/core/kernel/errors.ts';
import type { TenantStoreResolver } from '../../../../platform/core/tenancy/tenant-store-resolver.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

/** Every value the fixture put into Organization B's records. None may reach a summary row. */
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
 * The GROUP a summary row belongs to, as text.
 *
 * The four components 0013 control 3 names, minus the Organization, which is `tenant_id` and is
 * asserted separately. Two rows with the same group text are the same group; the identifier the
 * caller supplied is not in it and there is no column it could be in.
 */
function groupOf(row: Record<string, unknown>): string {
  return [row.tenant_id, row.principal_id, row.app_id, row.action_id, row.denial_reason].join('|');
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

function coordinationLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith(COORDINATION_FAILURE_MARKER));
}

export function buildDeniedReadAuditSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('denied-read audit (D2 / the CD-1 narrowing, as amended by 0013) — the probe-detection control');

  suite.test('REWRITTEN FOR 0013 — requirement 1: every denial path of GetCustomer is COUNTED into its own group, the count is the evidence, and a success is counted nowhere', async () => {
    const world = await makeWorld();
    try {
      // THE ORIGINAL CASE asserted "one audit_event row per denial, four denials four rows".
      // That is now wrong by design. The re-expression keeps both halves of what it proved —
      // every denial path leaves evidence, and a success leaves none — and adds the property
      // that replaced per-attempt writes: WHICH GROUP each denial lands in.
      //
      // Three groups, not four, and the arithmetic is the point:
      //   (unprivilegedA, forbidden)   step 3, no permission
      //   (adminANorth,  forbidden)    step 5b, unauthorized Business — a DIFFERENT actor, so a
      //                                different group even though the category is the same
      //   (ownerA,       not_found)    step 5, foreign Organization AND step 5, exists nowhere —
      //                                the SAME group, because the identifier is not in the key
      expectError('step 3 — no permission', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      expectError('step 5b — unauthorized Business, same Organization', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }), EXPECTED_FORBIDDEN);
      expectError(`${ISOLATION} step 5 — an identifier in another Organization`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('step 5 — an identifier that exists nowhere', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);

      assertEqual('no denial wrote an audit_event row — that table is successes now', world.auditRows().length, 0);
      const rows = world.denialSummaryRows();
      assertEqual('THE CROSS-TENANT PROBE IS RECORDED — three groups, three rows', rows.length, 3);
      assertEqual(
        'and they are the three groups the four paths fall into',
        rows.map(groupOf).join(' , '),
        [
          `${ORG_A}|prn_member_alpha|customers|customers.GetCustomer|forbidden`,
          `${ORG_A}|prn_admin_north|customers|customers.GetCustomer|forbidden`,
          `${ORG_A}|prn_owner_alpha|customers|customers.GetCustomer|not_found`,
        ].join(' , '),
      );
      assertTrue('every row is in the ACTOR\'s Organization', rows.every((row) => row.tenant_id === ORG_A), 'a summary landed in the wrong tenant');
      assertTrue('and every row is a GetCustomer denial', rows.every((row) => row.action_id === 'customers.GetCustomer'), JSON.stringify(rows.map((row) => row.action_id)));

      expectOk('a successful read', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('REQUIREMENT 7 — the success wrote nothing to either table', `${world.auditRows().length}|${world.denialSummaryRows().length}`, '0|3');

      // ---- THE COUNT IS THE EVIDENCE. Attempt 4 was counted but had not yet been emitted: the
      // ladder writes at attempt 1, 10, 100 … so the row's count lags until the window closes.
      // Closing it is what makes the total observable, and asserting the TOTAL is what stops a
      // regression that quietly stopped counting from passing.
      world.clock.set(FIXED_START_MS + DENIAL_WINDOW_MS);
      expectError('a probe in the next window closes the previous one', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);

      const closed = world.denialSummaryRows().filter((row) => row.window_closed === 1);
      assertEqual('the ownerA not_found window closed with its final count', closed.length, 1);
      assertEqual('and the final count is TWO — both probes, neither lost', closed[0].attempt_count, 2);
      assertEqual('carrying the first attempt time of the run', closed[0].first_attempt_at, '2026-09-02T09:00:00.000Z');
      assertEqual('and the last', closed[0].last_attempt_at, '2026-09-02T09:00:00.000Z');
      assertEqual('the closed row belongs to the ownerA not_found group', groupOf(closed[0]), `${ORG_A}|prn_owner_alpha|customers|customers.GetCustomer|not_found`);
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — requirement 2: what a summary carries, and what it structurally cannot', async () => {
    const world = await makeWorld();
    try {
      const outcome = await invokeAction(
        world.dependencies,
        asAnyAction(world.actions.get),
        { principal: world.ownerA, app: world.app, requestId: 'req_probe_0001', correlationId: 'cor_probe_0001' },
        { customer_id: CUST_B_ANNA },
      );
      expectError(`${ISOLATION} the probe is refused`, outcome, EXPECTED_NOT_FOUND);
      const rows = world.denialSummaryRows();
      assertEqual('exactly one summary', rows.length, 1);
      const row = rows[0];

      // ---- WHAT IT CARRIES. Control 4's list, in full.
      assertEqual('actor principal id', row.principal_id, 'prn_owner_alpha');
      assertEqual("actor's Organization — the summary's tenant", row.tenant_id, ORG_A);
      assertEqual('action id', row.action_id, 'customers.GetCustomer');
      assertEqual('app id', row.app_id, 'customers');
      assertEqual('the permission and scope the Action declares', `${row.permission_id}|${row.scope}`, 'customers.customer.read|business');
      assertEqual('the fixed safe denial category', row.denial_reason, 'not_found');
      assertEqual('the total attempt count', row.attempt_count, 1);
      assertEqual("the actor's own authorized Business set", row.actor_business_ids, `["${BIZ_A_NORTH}","${BIZ_A_SOUTH}"]`);
      assertEqual('the window this summary is for, on a 15-minute boundary', row.window_start_at, '2026-09-02T09:00:00.000Z');
      for (const column of ['first_attempt_at', 'last_attempt_at', 'window_start_at']) {
        assertTrue(
          `${column} is RFC 3339 UTC`,
          /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(row[column])),
          String(row[column]),
        );
      }

      // ---- WHAT IT CANNOT CARRY, AND THIS HALF IS THE CONTROL.
      //
      // The requested identifier is absent because 0013 control 5 keeps it out of the grouping
      // and the table has no column for it. `request_id` and `correlation_id` are absent
      // because a summary spans many requests and has no single one of either — which is a real
      // loss of investigative detail and is stated here rather than found later.
      assertTrue(
        'the caller-supplied identifier appears NOWHERE in the row',
        !rowText(row).includes(CUST_B_ANNA),
        `the summary carried ${CUST_B_ANNA}: ${JSON.stringify(row)}`,
      );
      assertTrue(
        'CD-5 GAP — and neither does the request or correlation id, so a summary cannot be tied to one request',
        !rowText(row).includes('req_probe_0001') && !rowText(row).includes('cor_probe_0001'),
        'a summary named a single request; if that is now intended, this case must be revisited',
      );
      assertEqual(
        'the columns are exactly the ones the migration defines — a new one must be added on purpose',
        Object.keys(row).sort().join(','),
        [
          'action_id',
          'actor_business_ids',
          'app_id',
          'attempt_count',
          'denial_reason',
          'denial_summary_id',
          'emission_sequence',
          'first_attempt_at',
          'last_attempt_at',
          'permission_id',
          'principal_id',
          'scope',
          'tenant_id',
          'window_closed',
          'window_start_at',
        ].join(','),
      );
    } finally {
      world.close();
    }
  });

  suite.test("requirement 3 — NO foreign customer's personal data reaches the evidence, asserted against every fixture value", async () => {
    const world = await makeWorld();
    try {
      expectError(`${ISOLATION} the cross-tenant probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the in-tenant wrong-Business denial', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }), EXPECTED_FORBIDDEN);
      const rows = world.denialSummaryRows();
      assertEqual('two groups, two rows', rows.length, 2);

      const text = rows.map(rowText).join('  ');
      for (const value of ORGANIZATION_B_FIELD_VALUES) {
        assertTrue(
          `${ISOLATION} no Organization B value reaches the evidence: ${JSON.stringify(value)}`,
          !text.includes(value),
          `the summary table contained ${JSON.stringify(value)} — the control resolved the probed row, which is itself the cross-tenant read it exists to detect`,
        );
      }
      // ASSERTED AGAINST THE WRONG-BUSINESS ROW ONLY, and that is not a narrowing — it is what
      // makes the assertion mean anything. adminANorth's own authorized set is
      // [biz_alpha_north] and does NOT contain the target's biz_alpha_south, so the two possible
      // sources of that string are distinguishable: present means the summary named the
      // Business it refused, absent means it did not. Scanning both rows together would fail on
      // ownerA's row, where biz_alpha_south is ownerA's OWN authorized Business and is required.
      const wrongBusinessRow = rows.find((row) => row.principal_id === 'prn_admin_north');
      assertTrue('control: the wrong-Business row was written', wrongBusinessRow !== undefined, 'no summary from the wrong-Business denial');
      assertTrue(
        "the wrong-Business denial does not name the record's actual business_id",
        !rowText(wrongBusinessRow as Record<string, unknown>).includes(BIZ_A_SOUTH),
        `the summary disclosed ${BIZ_A_SOUTH}, which the refusal withheld`,
      );
      assertEqual(
        "and it carries the actor's own Business instead",
        (wrongBusinessRow as Record<string, unknown>).actor_business_ids,
        `["${BIZ_A_NORTH}"]`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE ORACLE TEST, REWRITTEN AND STRONGER — the foreign-Organization probe and the fabricated-identifier probe are THE SAME ROW, not two rows that happen to match', async () => {
    const world = await makeWorld();
    try {
      // WHAT THIS PROTECTS, unchanged since D2: SECURITY_STANDARD.md §6 lets a tenant read its
      // own audit log, so a difference between these two records would hand the tenant, at
      // leisure and in writing, the existence fact the not_found response withholds.
      //
      // WHAT CHANGED: there is no longer a pair to compare. The identifier is not in the group
      // key (0013 control 5), so both probes increment ONE group and there is ONE row. That is
      // strictly stronger than "two equal rows", because two equal rows can be made unequal by
      // adding a column and one row cannot.
      expectError(`${ISOLATION} the foreign-Organization probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the fabricated identifier', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);

      const rows = world.denialSummaryRows();
      assertEqual(`${ISOLATION} ONE row — the two probes are not separable`, rows.length, 1);
      assertEqual(`${ISOLATION} one group`, new Set(rows.map(groupOf)).size, 1);
      assertEqual('one denial reason covers both — it is not split', rows[0].denial_reason, 'not_found');
      assertTrue(
        `${ISOLATION} and neither identifier is anywhere in it`,
        !rowText(rows[0]).includes(CUST_B_ANNA) && !rowText(rows[0]).includes(CUST_NOWHERE),
        `the summary distinguishes the probes: ${JSON.stringify(rows[0])}`,
      );

      // ---- NON-VACUITY, in three parts, because an equality that cannot fail is not evidence.
      //
      // 1. THE GROUPING IS SENSITIVE TO THE CATEGORY. A denial of a different category from the
      //    same actor produces a SECOND row — so "one row" above is a fact about these two
      //    probes and not about the table being unable to hold two rows.
      expectError('a different denial category from the same actor', await world.invoke(world.actions.get, world.ownerA, { customer_id: 'not a valid identifier' }), {
        code: 'invalid_argument',
        message: 'The request is not valid.',
        details: [{ field: 'customer_id', issue: 'invalid_identifier' }],
      });
      const withSecondCategory = world.denialSummaryRows();
      assertEqual('a different category is a different group', withSecondCategory.length, 2);
      assertEqual('and the categories are the two ErrorCodes', withSecondCategory.map((row) => row.denial_reason).join(','), 'not_found,invalid_argument');

      // 2. THE GROUPING IS SENSITIVE TO THE ACTOR. A different principal, same category, is a
      //    third row — so the single row is not the product of a key that collapses everything.
      expectError('a different actor, same category', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      assertEqual('a different actor is a different group', world.denialSummaryRows().length, 3);

      // 3. AND THE COUNT REALLY IS ACCUMULATING BOTH PROBE KINDS. Ten more alternating probes
      //    take the group to twelve attempts. The ladder's next point is 10, so the second
      //    emission carries exactly 10 — the count LAGS between ladder points, which is the
      //    detection-latency trade 0013 accepted and is asserted rather than glossed. Closing
      //    the window is what makes the true total observable, and 12 is only reachable if
      //    every attempt of BOTH probe kinds landed in the one group.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await world.invoke(world.actions.get, world.ownerA, {
          customer_id: attempt % 2 === 0 ? CUST_B_ANNA : CUST_NOWHERE,
        });
      }
      const ownerRows = world.denialSummaryRows().filter((row) => row.principal_id === 'prn_owner_alpha' && row.denial_reason === 'not_found');
      assertEqual('a second emission for the group at the next ladder point', ownerRows.length, 2);
      assertEqual('carrying the ladder value, not the running total — the count lags', ownerRows[1].attempt_count, 10);

      world.clock.set(FIXED_START_MS + DENIAL_WINDOW_MS);
      expectError('a probe in the next window closes this one', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      const closed = world.denialSummaryRows().filter((row) => row.window_closed === 1 && row.principal_id === 'prn_owner_alpha' && row.denial_reason === 'not_found');
      assertEqual('the window closed once', closed.length, 1);
      assertEqual(
        `${ISOLATION} and its final count is TWELVE — the accumulated total of BOTH probe kinds`,
        closed[0].attempt_count,
        12,
      );
    } finally {
      world.close();
    }
  });

  suite.test('requirement 1 — the EXTERNAL response is unchanged: still byte-identical and equal in length, WHILE the attempts are being counted', async () => {
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
      assertEqual('and both attempts were recorded, in one group', world.denialSummaryRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — requirement 6 versus control 8: a coordinator that cannot COUNT does not change the answer, and does not go silent', async () => {
    const world = await makeWorld({ coordinatorMode: 'record-throws' });
    try {
      // THE TENSION, NAMED. D2 requirement 6 says a failure to record must not fail into the
      // response. 0013 control 8 says failure of the coordinator must never permit access.
      // They apply to DIFFERENT calls, which is why both can hold:
      //
      //   begin()        — before the decision. Failure NARROWS what is reachable (control 8,
      //                    the fail-closed suite).
      //   recordDenial() — after the decision. Access is not reconsidered, so there is no "open"
      //                    to fail into; only the evidence is at stake (requirement 6, here).
      //
      // This world's `begin` succeeds and its `recordDenial` throws, which is the only
      // configuration that reaches requirement 6's path.
      const reported: CoordinationFailure[] = [];
      const reporter: CoordinationFailureReporter = { report: (failure) => reported.push(failure) };

      const captured = await captureConsoleErrors(async () => {
        const foreign = await invokeAction(
          { ...world.dependencies, coordinationFailureReporter: reporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_bbbbbbbbbb1', correlationId: 'cor_bbbbbbbbbb1' },
          { customer_id: CUST_B_ANNA },
        );
        const nowhere = await invokeAction(
          { ...world.dependencies, coordinationFailureReporter: reporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_bbbbbbbbbb2', correlationId: 'cor_bbbbbbbbbb2' },
          { customer_id: CUST_NOWHERE },
        );
        return { foreign, nowhere };
      });

      expectError(
        `${ISOLATION} a failing coordinator still returns not_found, NEVER internal`,
        captured.value.foreign,
        EXPECTED_NOT_FOUND,
      );
      expectError('and the same for an identifier that exists nowhere', captured.value.nowhere, EXPECTED_NOT_FOUND);
      assertEqual(
        `${ISOLATION} the two are still byte-identical when the coordinator is down`,
        JSON.stringify(captured.value.foreign),
        JSON.stringify(captured.value.nowhere),
      );
      assertEqual('nothing was recorded', world.denialSummaryRows().length, 0);
      assertEqual('the loss was announced to the reporter, once per uncounted attempt', reported.length, 2);
      assertEqual('with the cause named', reported.map((entry) => entry.cause).join(','), 'record_failed,record_failed');
      assertEqual('and one attempt lost each time', reported.map((entry) => entry.lost).join(','), '1,1');
      assertEqual('and the acting Organization, so the notice is evidence of an attack on somebody', reported[0].organizationId, ORG_A);
      assertEqual('the notice names the group', `${reported[0].key?.actionId}|${reported[0].key?.category}`, 'customers.GetCustomer|not_found');
      assertTrue(
        `${ISOLATION} the notice CANNOT carry a probed identifier — it is built from the group, which has none`,
        !JSON.stringify(reported).includes(CUST_B_ANNA) && !JSON.stringify(reported).includes(CUST_NOWHERE),
        `the failure notice contained a probed identifier: ${JSON.stringify(reported)}`,
      );
      assertTrue(
        'and no foreign personal data',
        !ORGANIZATION_B_FIELD_VALUES.some((value) => JSON.stringify(reported[0]).includes(value)),
        `the failure notice contained an Organization B value: ${JSON.stringify(reported[0])}`,
      );
      assertEqual('the unconditional last-resort channel emitted too', coordinationLines(captured.lines).length, 2);
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — requirement 6: the failure floor cannot be turned off by omitting the reporter, or broken by one that throws', async () => {
    const world = await makeWorld({ coordinatorMode: 'record-throws' });
    try {
      const brokenReporter: CoordinationFailureReporter = {
        report() {
          throw new Error('synthetic reporter failure');
        },
      };

      const noReporter = await captureConsoleErrors(async () =>
        invokeAction(
          world.dependencies,
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_cccccccccc1', correlationId: 'cor_cccccccccc1' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError('the response is unchanged with no reporter configured', noReporter.value, EXPECTED_NOT_FOUND);
      assertEqual('the floor still emitted', coordinationLines(noReporter.lines).length, 1);

      const withBroken = await captureConsoleErrors(async () =>
        invokeAction(
          { ...world.dependencies, coordinationFailureReporter: brokenReporter },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_cccccccccc2', correlationId: 'cor_cccccccccc2' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError('a reporter that throws cannot reach the caller', withBroken.value, EXPECTED_NOT_FOUND);
      assertEqual('and cannot suppress the floor', coordinationLines(withBroken.lines).length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — requirement 6: a REJECTING (non-throwing) coordinator is announced too, and still does not change the answer', async () => {
    const world = await makeWorld({ coordinatorMode: 'record-rejects' });
    try {
      const reported: CoordinationFailure[] = [];
      const captured = await captureConsoleErrors(async () =>
        invokeAction(
          { ...world.dependencies, coordinationFailureReporter: { report: (failure) => reported.push(failure) } },
          asAnyAction(world.actions.get),
          { principal: world.ownerA, app: world.app, requestId: 'req_dddddddddd1', correlationId: 'cor_dddddddddd1' },
          { customer_id: CUST_B_ANNA },
        ),
      );
      expectError(`${ISOLATION} the answer is the same not_found`, captured.value, EXPECTED_NOT_FOUND);
      assertEqual('the rejection was announced', reported.length, 1);
      assertEqual('with the record_failed cause', reported[0].cause, 'record_failed');
      assertEqual('and the floor emitted', coordinationLines(captured.lines).length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('NEW FOR 0013 — a summary that is DUE but cannot be WRITTEN is announced with its own cause, and still does not change the answer', async () => {
    const world = await makeWorld();
    try {
      // The fourth loss path (`summary_write_failed`): the coordinator counted the attempt and
      // handed back a summary, and the D1 write did not happen. Reached with a resolver that
      // fails closed, on a denial decided BEFORE the store is needed — a step-3 refusal — so
      // that the denial is real and only its evidence write is broken.
      const failingResolver: TenantStoreResolver = { async resolve() { return err(unavailable()); } };
      const reported: CoordinationFailure[] = [];
      const captured = await captureConsoleErrors(async () =>
        invokeAction(
          {
            ...world.dependencies,
            resolver: failingResolver,
            coordinationFailureReporter: { report: (failure) => reported.push(failure) },
          },
          asAnyAction(world.actions.get),
          { principal: world.unprivilegedA, app: world.app, requestId: 'req_eeeeeeeeee1', correlationId: 'cor_eeeeeeeeee1' },
          { customer_id: CUST_A_ANNA },
        ),
      );
      expectError('the caller still gets the denial the contract specifies', captured.value, EXPECTED_FORBIDDEN);
      assertEqual('nothing was written', world.denialSummaryRows().length, 0);
      assertEqual('and the loss has its OWN cause, distinct from a counting failure', reported.map((entry) => entry.cause).join(','), 'summary_write_failed');
      assertEqual('naming how many summaries were lost', reported[0].lost, 1);
      assertEqual('the floor emitted', coordinationLines(captured.lines).length, 1);
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

  suite.test('CD-15 GAP, ASSERTED SO IT IS VISIBLE — denied ListCustomers and SearchCustomers still record nothing, in either table', async () => {
    const world = await makeWorld();
    try {
      // NOT a pass in the sense of "this is right". It is the assumption operating while CD-15
      // is open, written down as an executable statement so that applying the recommendation
      // later is a VISIBLE test change rather than a silent one. The contract's own
      // collectionsRecommendation calls this the one door with no camera on it.
      //
      // 0013 did not change it: the collections declare `audit: false`, so `auditsOnDenial` is
      // false and their denials are not counted either. The gap moved tables without closing.
      expectError('a denied list — no permission', await world.invoke(world.actions.list, world.unprivilegedA, {}), EXPECTED_FORBIDDEN);
      expectError('a denied search — no permission', await world.invoke(world.actions.search, world.unprivilegedA, { query: 'anna' }), EXPECTED_FORBIDDEN);
      expectError(`${ISOLATION} a list naming Organization B's Business`, await world.invoke(world.actions.list, world.ownerA, { business_id: BIZ_B_EAST }), EXPECTED_NOT_FOUND);
      expectError('a list naming an unauthorized Business of the same Organization', await world.invoke(world.actions.list, world.adminANorth, { business_id: BIZ_A_SOUTH }), EXPECTED_FORBIDDEN);
      assertEqual(
        'four explicit denials, zero evidence — this is the CD-15 gap and it is live',
        `${world.auditRows().length}|${world.denialSummaryRows().length}`,
        '0|0',
      );

      // The same probe through GetCustomer WOULD be recorded. Asserted side by side so the
      // asymmetry is in one place rather than inferred across two suites.
      expectError(`${ISOLATION} the equivalent GetCustomer probe`, await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      assertEqual('GetCustomer records it; the collections do not', world.denialSummaryRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('THE 25-ATTEMPT CAMPAIGN, REWRITTEN FOR 0013 — bounded summaries, and the COUNT still adds up to twenty-five', async () => {
    const world = await makeWorld();
    try {
      // ===========================================================================================
      // THE CASE 0013 SAID WOULD GO RED. It did. This is the rewrite, and what it must NOT be.
      // ===========================================================================================
      //
      // BEFORE: "twenty-five attempts produce twenty-five rows, each carrying its own attempted
      // identifier", on the D2 requirement that "sampling, coalescing 'N similar attempts' into
      // one row, or suppressing after a threshold would each delete exactly the evidence a
      // campaign consists of".
      //
      // 0013 deliberately DOES coalesce, because the per-attempt write was a platform-wide
      // denial-of-service lever against an account-wide D1 allowance. What survives, and what
      // this case now asserts, is the part of the original requirement that was actually about
      // evidence rather than about rows:
      //
      //   1. The campaign is VISIBLE FROM ITS FIRST ATTEMPT — no threshold, no warm-up.
      //   2. NO ATTEMPT IS LOST. The counts add up to exactly twenty-five.
      //   3. The run's SHAPE is recorded: first attempt time, last attempt time, total count.
      //   4. The write cost is BOUNDED and small — which is the property that was bought.
      //
      // IT IS DELIBERATELY NOT "at least one row was written". That assertion would go green
      // against an implementation that recorded the first attempt and silently dropped the other
      // twenty-four, which is the regression this case exists to catch.
      const campaign = 25;
      const startMs = FIXED_START_MS;
      for (let attempt = 0; attempt < campaign; attempt += 1) {
        // One minute apart, so the run has a real duration to be recorded — and so the rate
        // limiter, which counts in fixed 60-second windows, is not what this case measures.
        world.clock.set(startMs + attempt * 60_000);
        expectError(
          `${ISOLATION} probe ${attempt + 1} of ${campaign}`,
          await world.invoke(world.actions.get, world.ownerA, { customer_id: `cust_probe_${String(attempt).padStart(6, '0')}` }),
          EXPECTED_NOT_FOUND,
        );
      }

      const rows = world.denialSummaryRows();

      // ---- 1. VISIBLE FROM THE FIRST ATTEMPT.
      assertTrue('the campaign is recorded from its first attempt', rows.length >= 1, 'a 25-attempt campaign produced no evidence at all');
      assertEqual('the first emission carries attempt 1', rows[0].attempt_count, 1);
      assertEqual('and its window opens at the campaign start', rows[0].window_start_at, '2026-09-02T09:00:00.000Z');

      // ---- 2. NO ATTEMPT IS LOST. The 25 minutes span two 15-minute windows, so the run is two
      // groups' worth of windows; every attempt must appear in exactly one of them.
      const byWindow = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        // The summary for a window is the row with window_closed = 1, or while it is open the
        // row with the highest attempt_count — the migration says so in those words.
        const key = String(row.window_start_at);
        const held = byWindow.get(key);
        if (held === undefined || Number(row.attempt_count) > Number(held.attempt_count)) {
          byWindow.set(key, row);
        }
      }
      const total = [...byWindow.values()].reduce((sum, row) => sum + Number(row.attempt_count), 0);
      assertEqual('THE COUNTS ADD UP TO TWENTY-FIVE — none coalesced away, none dropped', total, campaign);
      assertEqual('across the two 15-minute windows the run spans', byWindow.size, 2);

      // ---- 3. THE SHAPE OF THE RUN IS RECORDED.
      const windows = [...byWindow.entries()].sort(([left], [right]) => left.localeCompare(right));
      assertEqual('the first window opens at the campaign start', windows[0][0], '2026-09-02T09:00:00.000Z');
      assertEqual('and holds the first fifteen attempts', windows[0][1].attempt_count, 15);
      assertEqual('its first attempt time is the campaign start', windows[0][1].first_attempt_at, '2026-09-02T09:00:00.000Z');
      assertEqual('its last attempt time is fourteen minutes later', windows[0][1].last_attempt_at, '2026-09-02T09:14:00.000Z');
      assertEqual('the second window opens fifteen minutes in', windows[1][0], '2026-09-02T09:15:00.000Z');
      assertEqual('and holds the remaining ten', windows[1][1].attempt_count, 10);
      assertEqual('ending at the last probe', windows[1][1].last_attempt_at, '2026-09-02T09:24:00.000Z');

      // ---- 4. THE COST IS BOUNDED, WHICH IS WHAT WAS BOUGHT. Six row-writes per group per
      // window is the stated ceiling (`MAX_WRITES_PER_GROUP_WINDOW`); a 25-attempt run in two
      // windows can therefore cost at most twelve, and in practice costs far fewer. Asserting
      // the BOUND rather than an exact number is deliberate: the exact number is an
      // implementation detail of the ladder, the bound is the decision.
      assertTrue(
        `the write cost is bounded well below one per attempt — ${rows.length} rows for ${campaign} attempts`,
        rows.length <= 12 && rows.length < campaign,
        `${rows.length} summary rows for ${campaign} attempts — the aggregation is not bounding anything`,
      );

      // ---- AND THE GROUPING KEY AN OPERATOR ALERTS ON IS ON EVERY ROW.
      assertTrue(
        'every row carries the alerting grouping',
        rows.every((row) => row.tenant_id === ORG_A && row.principal_id === 'prn_owner_alpha' && row.denial_reason === 'not_found' && typeof row.window_start_at === 'string'),
        'a summary is missing an alerting field',
      );
      // ---- AND NOT ONE OF THE TWENTY-FIVE IDENTIFIERS THE ATTACKER TYPED IS IN THE TABLE.
      const text = rows.map(rowText).join('  ');
      for (let attempt = 0; attempt < campaign; attempt += 1) {
        assertTrue(
          `${ISOLATION} the attempted identifiers are not recorded (0013 control 5)`,
          !text.includes(`cust_probe_${String(attempt).padStart(6, '0')}`),
          'a probed identifier reached the summary table — the grouping is unbounded and the campaign can read back what it tried',
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — the alerting index exists on the SUMMARY table and answers the count without reading row bodies', async () => {
    const world = await makeWorld();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await world.invoke(world.actions.get, world.ownerA, { customer_id: `cust_probe_${String(attempt).padStart(6, '0')}` });
      }
      const plan = world.harness.raw
        .prepare(
          'EXPLAIN QUERY PLAN SELECT SUM(attempt_count) FROM denial_summary WHERE tenant_id = ? AND principal_id = ? AND window_start_at >= ?',
        )
        .all(ORG_A, 'prn_owner_alpha', '2000-01-01T00:00:00.000Z') as { detail: string }[];
      const detail = plan.map((row) => row.detail).join(' | ');
      assertTrue(
        'the alerting query is served by the covering index, not by a table scan',
        detail.includes('denial_summary_by_tenant_principal_window'),
        `query plan: ${detail}`,
      );
      // AND THE ANSWER IS THE CAMPAIGN SIZE, not the row count. Under aggregation these differ,
      // and an alert configured on the row count would under-report a campaign by orders of
      // magnitude — so the case asserts the number an operator would actually alert on.
      const rows = world.harness.raw
        .prepare("SELECT attempt_count AS n FROM denial_summary WHERE tenant_id = ? AND principal_id = ? AND denial_reason = 'not_found' ORDER BY attempt_count DESC")
        .all(ORG_A, 'prn_owner_alpha') as { n: number }[];
      assertEqual('one row for the one group', rows.length, 1);
      assertEqual('and its count is behind the campaign until the next ladder point', rows[0].n, 1);
      assertEqual('while the campaign really was three attempts', world.denialSummaryRows().length, 1);
      // Stated rather than glossed: an operator reading this table between ladder points sees a
      // count that LAGS. That is the detection-latency trade 0013 accepted, and it is asserted
      // here so nobody mistakes the lag for a bug or the row count for the campaign size.
    } finally {
      world.close();
    }
  });

  suite.test("the denial reason IS the Action's ErrorCode — no App-local synonym, and the same condition records the same token across Actions", async () => {
    const world = await makeWorld();
    try {
      // THE RULING THIS ENCODES (deniedReadAudit.denialReason, Team Lead, 2026-09-02).
      // architecture-agent proposed a three-token App-local vocabulary
      // (permission_denied / business_not_authorized / unresolved_identifier). It was REFUSED,
      // because `denial_reason` is a CORE-WIDE column, and 0013 reused the SAME closed
      // vocabulary for the summary table rather than inventing a second one — so the ruling now
      // binds two tables and this case binds both.
      //
      // RUN STRICTLY ONE AT A TIME. Starting the four invocations together would let their
      // writes complete in a different order from the one they were issued in, and the
      // comparison below is positional.
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

      const rows = world.denialSummaryRows();
      assertEqual('four denials, four distinct groups, four rows', rows.length, 4);
      assertEqual(
        'the four recorded reasons are the four ErrorCodes the four paths return',
        rows.map((row) => row.denial_reason).join(','),
        'forbidden,forbidden,invalid_argument,not_found',
      );
      // NO APP-LOCAL SYNONYM, stated as a property rather than a list: the token recorded is
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
      const rows = world.denialSummaryRows();
      assertEqual('two rows, because the ACTION is part of the grouping', rows.length, 2);
      assertEqual('written for different Actions', `${rows[0].action_id}|${rows[1].action_id}`, 'customers.GetCustomer|customers.ArchiveCustomer');
      assertEqual(
        'and carrying the SAME denial reason, so one query reads both',
        `${rows[0].denial_reason}|${rows[1].denial_reason}`,
        'not_found|not_found',
      );
      assertTrue(
        `${ISOLATION} and neither names the identifier that was probed`,
        !rows.some((row) => rowText(row).includes(CUST_B_ANNA)),
        'a summary named the probed identifier',
      );
    } finally {
      world.close();
    }
  });

  suite.test("CONFORMANCE — the summary carries the ACTOR's business context (deniedReadAudit.recordFields, requirement 2)", async () => {
    const world = await makeWorld();
    try {
      expectError(`${ISOLATION} the cross-tenant probe`, await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      const row = world.denialSummaryRows()[0];
      assertTrue('a summary was written', row !== undefined, 'no summary row');
      // The contract: "the ACTOR'S Organization and its business context — the authenticated
      // context's own Organization and authorized business set, NEVER the target's."
      assertEqual("the actor's authorized business set is a column of its own", row.actor_business_ids, `["${BIZ_A_NORTH}"]`);
      assertEqual("and the actor's Organization is the row's tenant", row.tenant_id, ORG_A);
    } finally {
      world.close();
    }
  });

  suite.test("CONFORMANCE — the actor business context is the CALLER's own set and never the target's", async () => {
    const world = await makeWorld();
    try {
      // The fixture is chosen so correct and incorrect population are distinguishable:
      // adminANorth is authorized over biz_alpha_north ONLY, and the probed record
      // CUST_A_SOUTH lives in biz_alpha_south. A row carrying north is right; a row carrying
      // south is a disclosure.
      expectError(
        'the in-tenant wrong-Business denial',
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      const row = world.denialSummaryRows()[0];
      assertEqual("the summary carries the CALLER's own authorized Business", row.actor_business_ids, `["${BIZ_A_NORTH}"]`);
      assertTrue(
        'and NEVER the Business of the record it refused',
        !rowText(row).includes(BIZ_A_SOUTH),
        `the summary disclosed the target's Business ${BIZ_A_SOUTH}: ${JSON.stringify(row)}`,
      );
      // THE STRUCTURAL HALF, which is what makes the above more than one passing example:
      // `DenialSummary` has NO member for the target's Business and `denial_summary` has no
      // column for one, so there is nowhere a future change could put it without a migration.
      assertTrue(
        'and there is no column that could hold a target Business',
        !Object.keys(row).some((column) => column.includes('related') || column.includes('target')),
        `a target-shaped column exists: ${Object.keys(row).join(',')}`,
      );

      // And on a CROSS-TENANT probe there is no target context to take, correctly: nothing was
      // resolved. The actor's own set is still recorded; nothing of Organization B's is.
      expectError(
        `${ISOLATION} the cross-tenant probe`,
        await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      const probeRow = world.denialSummaryRows().find((entry) => entry.denial_reason === 'not_found');
      assertTrue('the probe produced its own group', probeRow !== undefined, 'no not_found summary');
      assertEqual("the probe summary carries the caller's own Business", (probeRow as Record<string, unknown>).actor_business_ids, `["${BIZ_A_NORTH}"]`);
      assertTrue(
        `${ISOLATION} and nothing of Organization B's`,
        !ORGANIZATION_B_FIELD_VALUES.some((value) => rowText(probeRow as Record<string, unknown>).includes(value)),
        `the probe summary carried an Organization B value: ${JSON.stringify(probeRow)}`,
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
        // REQUIRED SINCE docs/decisions/0014 §A. This Action's handler emits no writes of its
        // own, but `audit: true` means the pipeline appends an audit row — a real D1 write that
        // must be reserved for. Declaring 1 is the smallest value that lets the audit row be
        // priced; see the write-admission suite's case on why an audited Action cannot express
        // "I write nothing myself" and why that is a reported gap rather than a workaround here.
        maxRowWrites: 1,
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

  suite.test('REWRITTEN FOR 0013 — CONFORMANCE: the actor business context does not reopen the oracle, because both probes share ONE row that carries it once', async () => {
    const world = await makeWorld();
    try {
      // A field on a denial record is an opportunity to reopen the existence oracle. Before
      // 0013 that was checked by comparing two rows. Under aggregation the two probes share a
      // row, so the field is written ONCE for both and cannot differ between them — the
      // strongest form of the property, and it is asserted as PRESENCE and single-row
      // membership together, because presence alone would go green on an empty column and
      // membership alone would go green while the field did not exist.
      expectError(`${ISOLATION} the foreign-Organization probe`, await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('the fabricated identifier', await world.invoke(world.actions.get, world.adminANorth, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      const rows = world.denialSummaryRows();
      assertEqual(`${ISOLATION} one row covers both probes`, rows.length, 1);
      assertEqual('the actor business context is present on it', rows[0].actor_business_ids, `["${BIZ_A_NORTH}"]`);
      assertEqual('and it is the same one group', new Set(rows.map(groupOf)).size, 1);
    } finally {
      world.close();
    }
  });

  return suite;
}
