/**
 * THE AUDIT TRAIL: what is written, what is not written, and what must never be in it.
 *
 * ===========================================================================================
 * AMENDED BY docs/decisions/0013 — A DENIAL IS NO LONGER A ROW IN `audit_event`
 * ===========================================================================================
 *
 * `audit_event` still holds one row per ALLOWED operation, unchanged. DENIALS moved: they are
 * counted in the coordinator and land in `denial_summary` as one bounded summary per
 * (actor, Organization, Action, denial category, 15-minute window). Every case below that
 * asserted a per-denial `audit_event` row was therefore WRONG BY DESIGN from the moment 0013
 * was implemented, and is rewritten against the summary rather than softened.
 *
 * WHAT THE REWRITE COSTS, STATED RATHER THAN GLOSSED. `denial_summary` has no
 * `target_resource_id`, so the assertions that a denial records "the identifier AS SUPPLIED BY
 * THE CALLER, marked unresolved" can no longer be made about a denial at all — the column does
 * not exist. That is 0013 control 5's deliberate consequence and it CONTRADICTS the Customer
 * Directory contract's CD-5 obligation, which is still written the old way. The conflict is
 * reported to the Team Lead; the suite tests the Accepted decision, and says so here so that
 * the missing assertion is a recorded gap rather than an omission.
 *
 * Three obligations from the Customer Directory contract, each asserted positively:
 *
 *   1. "Audit records exist for the five in-scope mutating Actions — create, update, archive,
 *      restore, move — AND FOR THEIR DENIALS."
 *   2. "IDENTIFIERS AND DECISIONS, NEVER BUSINESS DATA … an UpdateCustomer audit record names
 *      WHICH FIELDS CHANGED — the field names — and never the old or new values."
 *   3. "THE WRONG-BUSINESS DENIAL … does NOT name the record's actual business_id: telling the
 *      log which Business the caller was refused turns the audit trail into the disclosure the
 *      refusal withheld."
 *
 * And the one that has to be asserted positively or it is not tested at all:
 *
 *   4. "READS WRITE NO AUDIT RECORD — GetCustomer, ListCustomers, SearchCustomers. Asserted
 *      POSITIVELY, so that the CD-1 exception is a tested decision rather than an absence
 *      nobody checked, and so that adding per-read auditing later is a visible change."
 *
 * Obligation 4 is the interesting one to get right. "No audit record was written" is only
 * evidence if the surrounding machinery would have written one — so each read case runs an
 * AUDITED Action first, proves the count moved, and only then proves the read leaves it
 * unmoved. A count that never moves proves the sink is broken, not that reads are unaudited.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  CUST_A_ANNA,
  CUST_A_SOUTH,
  CUST_B_ANNA,
  CUST_NOWHERE,
  EXPECTED_FORBIDDEN,
  EXPECTED_NOT_FOUND,
  ORG_A,
  ORG_B,
} from '../../harness/world.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

/** Every value the fixture put into a customer record. None may appear in an audit row. */
const FIXTURE_FIELD_VALUES: readonly string[] = [
  'Anna Smith',
  'anna.smith@alpha.test',
  '+44 20 7946 0101',
  '1 Pearl Road, Manama',
  'Prefers morning appointments.',
  'Carla Osman',
  'carla.osman@alpha.test',
  'Delta Holdings',
  'Bruno Alvarez',
];

function rowText(row: Record<string, unknown>): string {
  return Object.values(row)
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .join('  ');
}

export function buildAuditSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('audit — the five mutating Actions, their denials, and the read exception');

  suite.test('each of the five in-scope mutating Actions writes exactly one audit record', async () => {
    const world = await makeWorld();
    try {
      expectOk('create', await world.invoke(world.actions.create, world.ownerA, { business_id: BIZ_A_NORTH, display_name: 'Audited Synthetic', customer_type: 'company' }));
      assertEqual('create wrote one record', world.auditRows().length, 1);

      expectOk('update', await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, country: 'BH' }));
      assertEqual('update wrote one record', world.auditRows().length, 2);

      expectOk('archive', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('archive wrote one record', world.auditRows().length, 3);

      expectOk('restore', await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('restore wrote one record', world.auditRows().length, 4);

      expectOk('move', await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH }));
      assertEqual('move wrote one record', world.auditRows().length, 5);

      const actions = world.auditRows().map((row) => row.action_id);
      assertEqual(
        'the five action ids are the five in-scope mutating Actions',
        actions.join(','),
        'customers.CreateCustomer,customers.UpdateCustomer,customers.ArchiveCustomer,customers.RestoreCustomer,customers.MoveCustomerToBusiness',
      );
      assertEqual(
        'every record is an allowed decision',
        world.auditRows().every((row) => row.decision === 'allowed'),
        true,
      );
    } finally {
      world.close();
    }
  });

  suite.test('an update audit record names the changed FIELD NAMES and carries no field value', async () => {
    const world = await makeWorld();
    try {
      expectOk(
        'the update succeeds',
        await world.invoke(world.actions.update, world.ownerA, {
          customer_id: CUST_A_ANNA,
          display_name: 'Renamed Synthetic',
          notes: 'A different private note.',
        }),
      );
      const row = world.auditRows()[0];
      assertEqual('the changed field names are recorded, in order', row.changed_field_names, '["display_name","notes"]');
      assertEqual('the related Business is the record\'s own, inside the caller\'s tenant', row.related_business_ids, `["${BIZ_A_NORTH}"]`);
      const text = rowText(row);
      for (const value of ['Renamed Synthetic', 'A different private note.', ...FIXTURE_FIELD_VALUES]) {
        assertTrue(
          'no field VALUE appears anywhere in the audit record',
          !text.includes(value),
          `the audit record contained the value ${JSON.stringify(value)}`,
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('a move audit record names BOTH Businesses and nothing else', async () => {
    const world = await makeWorld();
    try {
      expectOk('the move succeeds', await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH }));
      const row = world.auditRows()[0];
      assertEqual('source first, destination second', row.related_business_ids, `["${BIZ_A_NORTH}","${BIZ_A_SOUTH}"]`);
      assertEqual('the changed field name is business_id', row.changed_field_names, '["business_id"]');
      assertEqual('the target is the customer', row.target_resource_id, CUST_A_ANNA);
    } finally {
      world.close();
    }
  });

  suite.test("REWRITTEN FOR 0013 — the wrong-Business denial is SUMMARISED, and the summary does not name the record's actual business_id", async () => {
    const world = await makeWorld();
    try {
      // adminANorth is authorized over biz_alpha_north only; CUST_A_SOUTH is in
      // biz_alpha_south, inside the SAME Organization. This is the one record-dependent
      // authorization decision in the contract.
      //
      // WHAT CHANGED AND WHAT DID NOT. The denial used to write one `audit_event` row naming
      // the caller-supplied identifier. It now increments a bounded group and emits a
      // `denial_summary` row that has NO identifier column at all. The disclosure rule is
      // unchanged and is the reason this case exists: the refusal must not name the Business it
      // refused, and the summary must carry the CALLER's own Business instead.
      expectError(
        'the denial is forbidden, not not_found',
        await world.invoke(world.actions.archive, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      assertEqual('no audit_event row — a denial is not an event any more', world.auditRows().length, 0);

      const summaries = world.denialSummaryRows();
      assertEqual('exactly one summary row, at the first ladder point', summaries.length, 1);
      const row = summaries[0];
      assertEqual('in the ACTOR\'s Organization', row.tenant_id, ORG_A);
      assertEqual('naming the actor', row.principal_id, 'prn_admin_north');
      assertEqual('and the Action', row.action_id, 'customers.ArchiveCustomer');
      assertEqual('the denial reason is the Core-wide taxonomy code', row.denial_reason, 'forbidden');
      assertEqual('one attempt so far', row.attempt_count, 1);
      assertEqual('the window is still open', row.window_closed, 0);
      assertEqual('the permission and scope the Action declares', `${row.permission_id}|${row.scope}`, 'customers.customer.archive|business');
      assertEqual("and the actor's OWN authorized Business set", row.actor_business_ids, `["${BIZ_A_NORTH}"]`);
      assertTrue(
        "the record's actual business_id appears nowhere in the summary",
        !rowText(row).includes(BIZ_A_SOUTH),
        `the summary disclosed ${BIZ_A_SOUTH}, which the refusal withheld`,
      );
      assertTrue(
        'and neither does the identifier the caller supplied — there is no column for one',
        !rowText(row).includes(CUST_A_SOUTH),
        `the summary carried the caller-supplied identifier: ${JSON.stringify(row)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test("REWRITTEN FOR 0013 — a cross-tenant not_found on a mutating Action is summarised in the CALLER's tenant, with nothing derived from the foreign record", async () => {
    const world = await makeWorld();
    try {
      expectError(
        'the cross-tenant archive is not_found',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      const inA = world.denialSummaryRows(ORG_A);
      assertEqual("the attempt is recorded in the caller's own Organization", inA.length, 1);
      assertEqual(`${ISOLATION} Organization B holds no record of the attempt`, world.denialSummaryRows(ORG_B).length, 0);
      assertEqual('and it is a summary, not an audit event', world.auditRows().length, 0);
      const row = inA[0];
      assertEqual('the denial reason is not_found', row.denial_reason, 'not_found');
      assertEqual('the attempt is counted', row.attempt_count, 1);
      assertEqual("the actor's own Business set is present", row.actor_business_ids, `["${BIZ_A_NORTH}","${BIZ_A_SOUTH}"]`);
      // THE GAP, ASSERTED SO IT IS VISIBLE. CD-5 requires "the identifier AS SUPPLIED BY THE
      // CALLER, marked unresolved". 0013 control 5 removed the column it lived in. This
      // assertion states the CURRENT, Accepted behaviour so that restoring the identifier is a
      // visible test change and not a silent one — it is the same device the CD-15 gap uses.
      assertTrue(
        'CD-5 GAP — the caller-supplied identifier is NOT recorded anywhere, by design (0013 control 5)',
        !rowText(row).includes(CUST_B_ANNA),
        `the summary carried ${CUST_B_ANNA}; if this is now intended, CD-5 and 0013 have been reconciled and this case must be revisited`,
      );
      assertTrue(
        `${ISOLATION} no foreign business identifier or foreign principal appears in the record`,
        !rowText(row).includes('biz_beta_east01') && !rowText(row).includes('prn_owner_beta'),
        'the summary carried something from the other Organization',
      );
    } finally {
      world.close();
    }
  });

  suite.test('REWRITTEN FOR 0013 — a denial on a nonexistent identifier and a denial on a foreign one are now the SAME ROW, which is stronger than being two identical rows', async () => {
    const world = await makeWorld();
    try {
      // BEFORE 0013 this case compared two audit rows field for field and required them to
      // differ only in the identifier. Under aggregation there is nothing to compare: the
      // identifier is not in the group key, so both attempts increment ONE group and produce
      // ONE row identity. Two rows that happen to be equal can drift apart when a column is
      // added; one row cannot. The property got stronger, so the assertion is re-expressed
      // rather than relaxed.
      expectError('foreign', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('nowhere', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);

      const rows = world.denialSummaryRows();
      // The ladder emits at attempt 1 only; attempt 2 crosses no ladder point, so there is one
      // row, and its count has not yet caught up. Both facts are asserted because both are the
      // aggregation working: the record EXISTS from the first attempt, and the count converges.
      assertEqual('one summary row, not two', rows.length, 1);
      assertEqual('one group — the two attempts share it', new Set(rows.map((row) => row.denial_summary_id)).size, 1);
      assertEqual('and one denial reason covers both, unsplit', rows[0].denial_reason, 'not_found');
      assertTrue(
        `${ISOLATION} neither identifier appears anywhere in the summary`,
        !rowText(rows[0]).includes(CUST_B_ANNA) && !rowText(rows[0]).includes(CUST_NOWHERE),
        `the summary distinguishes the two probes: ${JSON.stringify(rows[0])}`,
      );

      // Non-vacuity: the group really did receive both attempts. A tenth attempt crosses the
      // next ladder point and the emitted count must be 10 — which is only true if attempts 2
      // to 9 were counted into the same group rather than dropped.
      for (let attempt = 3; attempt <= 10; attempt += 1) {
        await world.invoke(world.actions.archive, world.ownerA, {
          customer_id: attempt % 2 === 0 ? CUST_B_ANNA : CUST_NOWHERE,
        });
      }
      const after = world.denialSummaryRows();
      assertEqual('a second emission at the next ladder point', after.length, 2);
      assertEqual('carrying the accumulated count of BOTH probe kinds', after[1].attempt_count, 10);
      assertEqual('still one group', new Set(after.map((row) => `${row.principal_id}|${row.action_id}|${row.denial_reason}|${row.window_start_at}`)).size, 1);
    } finally {
      world.close();
    }
  });

  suite.test('SUCCESSFUL READS WRITE NO AUDIT RECORD — asserted positively, against a sink proven to be working', async () => {
    const world = await makeWorld();
    try {
      // NARROWED, NOT DELETED, on the user's 2026-09-02 ruling: "Keep successful customer
      // reads unaudited." The tripwire is unchanged in value — it is what stops success-path
      // read auditing being added later without anyone noticing, on the busiest read path in
      // the product, on a single-threaded shared D1. Only its scope moved: DENIED GetCustomer
      // reads are now audited and are verified in the denied-read-audit suite.
      //
      // First prove the sink writes at all in this world. Without this, "zero records" would
      // be evidence of a broken harness rather than of the exception being honoured.
      expectOk('a mutating Action writes a record', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      const baseline = world.auditRows().length;
      assertEqual('the sink is working', baseline, 1);

      expectOk('a successful GetCustomer', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectOk('a successful ListCustomers', await world.invoke(world.actions.list, world.ownerA, {}));
      expectOk('a successful SearchCustomers', await world.invoke(world.actions.search, world.ownerA, { query: 'anna' }));
      assertEqual('the three successful reads wrote nothing', world.auditRows().length, baseline);

      // The success path stays silent even when the same Action's denial path is loud. This is
      // the assertion that would catch "audit both for symmetry", which the contract calls out
      // by name as implementing a different decision from the one the user made.
      //
      // REWRITTEN FOR 0013: the denial's evidence moved to `denial_summary`. The property under
      // test is unchanged — a denied read is recorded and a successful one is not — so the
      // assertion follows the evidence rather than being dropped.
      expectError('a denied read of the same Action', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      assertEqual('the denial wrote NO audit_event row', world.auditRows().length, baseline);
      assertEqual('it wrote a denial SUMMARY instead', world.denialSummaryRows().length, 1);
      expectOk('and a success immediately after still writes nothing', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('the audit trail is unmoved by the success', world.auditRows().length, baseline);
      assertEqual('and so is the summary table', world.denialSummaryRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('a mutation and its audit record commit as one transaction', async () => {
    const world = await makeWorld();
    try {
      expectOk('the archive succeeds', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the row changed', row?.status, 'archived');
      assertEqual('and the audit record is present', world.auditRows().length, 1);

      // The inverse: a mutation the storage layer refuses leaves NEITHER the row change nor
      // an audit record. A CHECK-constraint violation is forced by writing a status the table
      // does not permit, through the same batch path the pipeline uses.
      const store = await world.storeFor(ORG_A);
      const outcome = await store.write(
        [{ kind: 'update', spec: { table: 'customer', set: { status: 'not_a_status' }, where: { kind: 'eq', column: 'customer_id', value: CUST_A_ANNA } } }],
        // A valid reservation, so the engine's CHECK constraint is what refuses this write and
        // not the admission guard. See `world.unbudgetedReservationFor`.
        world.unbudgetedReservationFor(ORG_A, 1),
      );
      assertEqual('the engine refused the write', outcome.ok, false);
      const after = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the row is unchanged', after?.status, 'archived');
    } finally {
      world.close();
    }
  });

  return suite;
}
