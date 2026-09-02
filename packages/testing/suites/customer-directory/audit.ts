/**
 * THE AUDIT TRAIL: what is written, what is not written, and what must never be in it.
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
import { Suite as TestSuite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
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

  suite.test("the wrong-Business denial is audited and does NOT name the record's actual business_id", async () => {
    const world = await makeWorld();
    try {
      // adminANorth is authorized over biz_alpha_north only; CUST_A_SOUTH is in
      // biz_alpha_south, inside the SAME Organization. This is the one record-dependent
      // authorization decision in the contract.
      expectError(
        'the denial is forbidden, not not_found',
        await world.invoke(world.actions.archive, world.adminANorth, { customer_id: CUST_A_SOUTH }),
        EXPECTED_FORBIDDEN,
      );
      const rows = world.auditRows();
      assertEqual('the denial produced exactly one audit record', rows.length, 1);
      const row = rows[0];
      assertEqual('the decision is denied', row.decision, 'denied');
      assertEqual('the denial reason is the taxonomy code', row.denial_reason, 'forbidden');
      assertEqual('the caller-supplied identifier is recorded', row.target_resource_id, CUST_A_SOUTH);
      assertEqual('the target was resolved, so it is not marked unresolved', row.target_unresolved, 0);
      assertEqual('related_business_ids is EMPTY on a denial', row.related_business_ids, '[]');
      assertTrue(
        "the record's actual business_id appears nowhere in the audit row",
        !rowText(row).includes(BIZ_A_SOUTH),
        `the audit row disclosed ${BIZ_A_SOUTH}, which the refusal withheld`,
      );
      assertEqual('the permission and scope actually evaluated are recorded', `${row.permission_id}|${row.scope}`, 'customers.customer.archive|business');
    } finally {
      world.close();
    }
  });

  suite.test('a cross-tenant not_found on a mutating Action is audited in the CALLER\'s tenant, with nothing derived from the foreign record', async () => {
    const world = await makeWorld();
    try {
      expectError(
        'the cross-tenant archive is not_found',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }),
        EXPECTED_NOT_FOUND,
      );
      const inA = world.auditRows(ORG_A);
      assertEqual('the attempt is recorded in the caller\'s own Organization', inA.length, 1);
      assertEqual('Organization B holds no record of the attempt', world.auditRows().length, 1);
      const row = inA[0];
      assertEqual('the identifier is recorded AS SUPPLIED BY THE CALLER', row.target_resource_id, CUST_B_ANNA);
      assertEqual('and is marked unresolved', row.target_unresolved, 1);
      assertEqual('nothing derived from any record accompanies it', row.related_business_ids, '[]');
      assertTrue(
        'no foreign business identifier or foreign principal appears in the record',
        !rowText(row).includes('biz_beta_east01') && !rowText(row).includes('prn_owner_beta'),
        'the audit record carried something from the other Organization',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a denial on a nonexistent identifier is audited identically to a denial on a foreign one, apart from the identifier the caller supplied', async () => {
    const world = await makeWorld();
    try {
      expectError('foreign', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_B_ANNA }), EXPECTED_NOT_FOUND);
      expectError('nowhere', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_NOWHERE }), EXPECTED_NOT_FOUND);
      const rows = world.auditRows();
      assertEqual('two denial records', rows.length, 2);
      const normalise = (row: Record<string, unknown>): string =>
        JSON.stringify({ ...row, audit_event_id: null, request_id: null, correlation_id: null, target_resource_id: null });
      assertEqual(
        'the two audit records are otherwise identical',
        normalise(rows[0]),
        normalise(rows[1]),
      );
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
      expectError('a denied read of the same Action', await world.invoke(world.actions.get, world.unprivilegedA, { customer_id: CUST_A_ANNA }), EXPECTED_FORBIDDEN);
      assertEqual('the denial DID write one', world.auditRows().length, baseline + 1);
      expectOk('and a success immediately after still writes nothing', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA }));
      assertEqual('still one denial record and no success record', world.auditRows().length, baseline + 1);
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
      const outcome = await store.write([
        { kind: 'update', spec: { table: 'customer', set: { status: 'not_a_status' }, where: { kind: 'eq', column: 'customer_id', value: CUST_A_ANNA } } },
      ]);
      assertEqual('the engine refused the write', outcome.ok, false);
      const after = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the row is unchanged', after?.status, 'archived');
    } finally {
      world.close();
    }
  });

  return suite;
}
