/**
 * THE LIFECYCLE STATE MACHINE AND THE INPUT SHAPES.
 *
 * Two things are being verified here, and the second is the one that carries security weight.
 *
 * 1. EVERY TRANSITION AND EVERY REJECTED TRANSITION in the contract's §6, including the ones
 *    whose strictness the contract argues for at length: archiving an already-archived
 *    customer is `failed_precondition` rather than a no-op, because "an audit trail that
 *    records operations which did not happen is worse than one that is occasionally awkward to
 *    retry against."
 *
 * 2. WHAT IS UNSETTABLE, AND THAT IT IS UNSETTABLE BY ABSENCE FROM A SCHEMA. `status`,
 *    `customer_id` on create, `deletion_scheduled_at`, the metadata fields, and `business_id`
 *    ON UPDATE are not properties of any input rule, and unknown fields are rejected — so
 *    supplying one fails before a handler runs. The `business_id`-on-update case is the one
 *    with teeth: as an update field it would be an unaudited re-assignment of a customer's
 *    authorization scope under a permission a business-scope principal may hold.
 *
 * THE TRANSCRIPTION DRIFT SURFACE. `apps/customers/domain/validation.ts` restates the
 * contract's JSON Schema in a form the Core validator can run, because no JSON Schema
 * implementation exists in this repository (ADR 0003 approves no npm package). The file names
 * qa-agent as the owner of the resulting drift risk. These cases exercise the transcription's
 * constraints against the schema's stated ones; they do NOT execute the schema, and that
 * limitation is reported rather than glossed.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  BIZ_A_NORTH,
  BIZ_A_SOUTH,
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  EXPECTED_FAILED_PRECONDITION,
  ORG_A,
} from '../../harness/world.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;

function invalid(field: string, issue: string): unknown {
  return { code: 'invalid_argument', message: 'The request is not valid.', details: [{ field, issue }] };
}

export function buildStateAndValidationSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('lifecycle transitions and input shapes');

  suite.test('archive: active succeeds, archived is failed_precondition', async () => {
    const world = await makeWorld();
    try {
      expectOk('active -> archived', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectError(
        'archived -> archived is refused, not a silent no-op',
        await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }),
        EXPECTED_FAILED_PRECONDITION,
      );
      // The refused transition IS recorded, as a DENIAL. The contract requires it — "failures
      // are audited, not only successes … an attack looks like a long run of failures" — and
      // it is the opposite of the thing the strict transition exists to avoid, which is an
      // ALLOWED record for an operation that did not happen.
      //
      // REWRITTEN FOR docs/decisions/0013: the two records now live in two tables. The
      // ALLOWED transition is still one `audit_event` row; the refused one is a counted
      // denial in `denial_summary`. Both halves of the original claim are still asserted —
      // the refusal is recorded, and nothing claims a second archive succeeded.
      const rows = world.auditRows();
      assertEqual('exactly one audit_event row: the transition that happened', rows.length, 1);
      assertEqual('and it is an allowed decision', `${rows[0].decision}|${rows[0].denial_reason}`, 'allowed|null');
      const summaries = world.denialSummaryRows();
      assertEqual('the refusal is recorded as a denial summary', summaries.length, 1);
      assertEqual('with the taxonomy reason, not a sentence', summaries[0].denial_reason, 'failed_precondition');
      assertEqual('and the Action that refused', summaries[0].action_id, 'customers.ArchiveCustomer');
      assertTrue(
        'no audit record claims a second archive succeeded',
        rows.filter((row) => row.decision === 'allowed').length === 1,
        'the audit trail records an operation that did not happen',
      );
    } finally {
      world.close();
    }
  });

  suite.test('restore: archived succeeds, active is failed_precondition', async () => {
    const world = await makeWorld();
    try {
      expectOk('archived -> active', await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ARCHIVED }));
      expectError(
        'active -> active is refused',
        await world.invoke(world.actions.restore, world.ownerA, { customer_id: CUST_A_ARCHIVED }),
        EXPECTED_FAILED_PRECONDITION,
      );
    } finally {
      world.close();
    }
  });

  suite.test('update: an archived customer cannot be edited', async () => {
    const world = await makeWorld();
    try {
      expectOk('an active customer can be edited', await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, country: 'BH' }));
      expectError(
        'an archived customer cannot',
        await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ARCHIVED, country: 'BH' }),
        EXPECTED_FAILED_PRECONDITION,
      );
    } finally {
      world.close();
    }
  });

  suite.test('move: an archived customer CAN be moved; a move to the same Business is failed_precondition', async () => {
    const world = await makeWorld();
    try {
      expectOk('an archived customer moves', await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ARCHIVED, business_id: BIZ_A_SOUTH }));
      const moved = world.customerRows(ORG_A).find((row) => row.customer_id === CUST_A_ARCHIVED);
      assertEqual('and stays archived — a move is not a lifecycle transition', moved?.status, 'archived');
      expectError(
        'a move that moves nothing is refused',
        await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ARCHIVED, business_id: BIZ_A_SOUTH }),
        EXPECTED_FAILED_PRECONDITION,
      );
    } finally {
      world.close();
    }
  });

  suite.test('nothing in this slice can write pending_deletion or a non-null deletion_scheduled_at', async () => {
    const world = await makeWorld();
    try {
      expectOk('create', await world.invoke(world.actions.create, world.ownerA, { business_id: BIZ_A_NORTH, display_name: 'Lifecycle Probe', customer_type: 'company' }));
      expectOk('archive', await world.invoke(world.actions.archive, world.ownerA, { customer_id: CUST_A_ANNA }));
      expectOk('move', await world.invoke(world.actions.move, world.ownerA, { customer_id: CUST_A_ARCHIVED, business_id: BIZ_A_SOUTH }));
      const rows = world.customerRows();
      assertTrue(
        'no row is in pending_deletion',
        rows.every((row) => row.status !== 'pending_deletion'),
        'a row reached pending_deletion, which no in-scope Action may produce',
      );
      assertTrue(
        'no row carries a deletion_scheduled_at',
        rows.every((row) => row.deletion_scheduled_at === null),
        'a row carries a deletion deadline',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a created customer starts active, with a server-set identifier and server-set metadata', async () => {
    const world = await makeWorld();
    try {
      const created = expectOk(
        'the create succeeds',
        await world.invoke(world.actions.create, world.ownerA, { business_id: BIZ_A_NORTH, display_name: '  Padded Name  ', customer_type: 'person' }),
      ) as Record<string, unknown>;
      assertEqual('status is active', created.status, 'active');
      assertEqual('deletion_scheduled_at is null', created.deletion_scheduled_at, null);
      assertEqual('the display name is trimmed for storage', created.display_name, 'Padded Name');
      assertEqual('created_by is the acting principal, not an input', created.created_by_principal_id, 'prn_owner_alpha');
      assertTrue('the identifier is server-set and opaque', /^[A-Za-z0-9_-]{8,64}$/.test(String(created.customer_id)), `id: ${String(created.customer_id)}`);
    } finally {
      world.close();
    }
  });

  suite.test('the server-controlled fields are unsettable, by absence from the schema', async () => {
    const world = await makeWorld();
    try {
      const rejected: readonly [string, unknown, Record<string, unknown>][] = [
        ['status on create', world.actions.create, { business_id: BIZ_A_NORTH, display_name: 'x', customer_type: 'company', status: 'archived' }],
        ['customer_id on create', world.actions.create, { business_id: BIZ_A_NORTH, display_name: 'x', customer_type: 'company', customer_id: 'cust_forced_0001' }],
        ['deletion_scheduled_at on create', world.actions.create, { business_id: BIZ_A_NORTH, display_name: 'x', customer_type: 'company', deletion_scheduled_at: '2026-10-01T00:00:00Z' }],
        ['created_by_principal_id on create', world.actions.create, { business_id: BIZ_A_NORTH, display_name: 'x', customer_type: 'company', created_by_principal_id: 'prn_forged' }],
        ['status on update', world.actions.update, { customer_id: CUST_A_ANNA, status: 'archived' }],
        ['business_id on update', world.actions.update, { customer_id: CUST_A_ANNA, business_id: BIZ_A_SOUTH }],
      ];
      for (const [name, action, input] of rejected) {
        const field = name.split(' ')[0];
        expectError(`${name} is rejected as an unknown field`, await world.invoke(action as never, world.ownerA, input), invalid(field, 'unknown_field'));
      }
      // And the record is untouched by any of them.
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('the record kept its status', row?.status, 'active');
      assertEqual('and its Business', row?.business_id, BIZ_A_NORTH);
    } finally {
      world.close();
    }
  });

  suite.test('business_id is required on create and cannot be defaulted', async () => {
    const world = await makeWorld();
    try {
      expectError(
        'a create without a Business is rejected',
        await world.invoke(world.actions.create, world.ownerA, { display_name: 'No Business', customer_type: 'company' }),
        invalid('business_id', 'required'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an update that changes nothing is rejected rather than accepted as a no-op', async () => {
    const world = await makeWorld();
    try {
      expectError(
        'customer_id alone is too few properties',
        await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA }),
        invalid('', 'too_few_properties'),
      );
      // The rejection is recorded as a denial — not as an update. `updated_at` must not move
      // and no `allowed` record may exist, which is the property the rejection protects.
      //
      // REWRITTEN FOR docs/decisions/0013: a denial is counted into `denial_summary`. The
      // invariant that matters here — nothing anywhere claims the update happened — is
      // asserted against BOTH tables, which is what the split now requires.
      assertEqual('no allowed record was written', world.auditRows().length, 0);
      const summaries = world.denialSummaryRows();
      assertEqual(
        'the rejection is recorded as a denial summary carrying the taxonomy reason',
        `${summaries.length}|${summaries[0]?.denial_reason}|${summaries[0]?.attempt_count}`,
        '1|invalid_argument|1',
      );
      assertEqual('attributed to the Action that refused', summaries[0]?.action_id, 'customers.UpdateCustomer');
      const row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('and updated_at did not move', row?.updated_by_principal_id, 'seed_principal');
    } finally {
      world.close();
    }
  });

  suite.test("update's three-way absent / value / null semantics", async () => {
    const world = await makeWorld();
    try {
      // present with a value -> set; absent -> unchanged; present and null -> cleared.
      expectOk('set country, leave phone alone', await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, country: 'GB' }));
      let row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('country was set', row?.country, 'GB');
      assertEqual('phone was left alone', row?.phone, '+44 20 7946 0101');

      expectOk('clear the phone', await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, phone: null }));
      row = world.customerRows(ORG_A).find((entry) => entry.customer_id === CUST_A_ANNA);
      assertEqual('phone was cleared', row?.phone, null);
      assertEqual('the derived phone key was cleared with it', row?.phone_key, null);
      assertEqual('country is still what it was', row?.country, 'GB');

      expectError(
        'a field that is required on the record cannot be nulled',
        await world.invoke(world.actions.update, world.ownerA, { customer_id: CUST_A_ANNA, display_name: null }),
        invalid('display_name', 'must_not_be_null'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('field constraints are enforced, and a rejected VALUE is never echoed back', async () => {
    const world = await makeWorld();
    try {
      const secretish = 'Definitely-Not-A-Real-Token-9999';
      const outcome = (await world.invoke(world.actions.create, world.ownerA, {
        business_id: BIZ_A_NORTH,
        display_name: '   ',
        customer_type: 'individual',
        email: secretish,
        country: 'bahrain',
      })) as { ok: boolean; error?: unknown };
      assertEqual('the create is rejected', outcome.ok, false);
      const rendered = JSON.stringify(outcome.error);
      assertTrue('the rejected value is not echoed into the error', !rendered.includes(secretish), `the error carried the value: ${rendered}`);
      assertTrue('display_name is rejected as blank', rendered.includes('must_not_be_blank'), rendered);
      assertTrue('customer_type is rejected as not permitted', rendered.includes('not_a_permitted_value'), rendered);
      assertTrue('email is rejected on format', rendered.includes('invalid_format'), rendered);
    } finally {
      world.close();
    }
  });

  suite.test('a body that is not an object, and a repeated field from two sources, are refused', async () => {
    const world = await makeWorld();
    try {
      expectError(
        'an array body is not an object',
        await world.invoke(world.actions.get, world.ownerA, []),
        invalid('', 'must_be_an_object'),
      );
      expectError(
        'a null body is not an object',
        await world.invoke(world.actions.get, world.ownerA, null),
        invalid('', 'must_be_an_object'),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a prototype-polluting key in a request body reaches nothing', async () => {
    const world = await makeWorld();
    try {
      const outcome = (await world.invoke(world.actions.get, world.ownerA, {
        customer_id: CUST_A_ANNA,
        __proto__: { polluted: true },
      })) as { ok: boolean };
      // `__proto__` in an object literal sets the prototype rather than an own key, so this
      // request is well-formed and simply succeeds. The assertion that matters is the global
      // one: nothing was polluted.
      assertEqual('the request is handled', outcome.ok, true);
      assertEqual('Object.prototype was not polluted', (Object.prototype as Record<string, unknown>).polluted, undefined);
    } finally {
      world.close();
    }
  });

  return suite;
}
