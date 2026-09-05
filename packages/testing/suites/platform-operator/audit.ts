/**
 * ===========================================================================================
 * BINDING PROPERTY P4 — EVERY OPERATION IN THIS CLASS WRITES A RECORD, INCLUDING THE READS.
 * AND `docs/decisions/0025` DECISION 5 — WHAT THAT RECORD MAY NEVER CONTAIN.
 * contract `platform-operator-v1`, `P4_everyPlatformRouteWritesAnAuditRecord`, `auditModel`,
 * `testRequirements.audit` · migration `0009_platform_operator_action.sql`.
 * ===========================================================================================
 *
 * The contract requires the per-route assertion explicitly — *"assert per route rather than in
 * aggregate"* — because an aggregate count of two says nothing about which two routes produced it.
 *
 * ===========================================================================================
 * THE CONSTRAINT THAT IS NORMATIVE RATHER THAN DESCRIPTIVE
 * ===========================================================================================
 *
 * `0025` decision 5: the log records *"the operation and its target identifiers, never the
 * contents of what was touched"*, because **"an operator log that accumulates customer data is a
 * second copy of the tenant database with weaker access rules."** Two cases below hold that line
 * from opposite directions:
 *
 *   - THE SCHEMA. `PRAGMA table_info` is compared against the nine columns `0009` declares. A
 *     tenth column is the way this constraint would be lost, and it would arrive in a migration
 *     nobody connected to this rule. This is the tripwire.
 *   - THE ROWS. An enumeration that returned three Organizations writes a record whose target is
 *     `none` and whose cells contain none of the identifiers it just returned. The log says WHAT
 *     WAS DONE, never WHAT WAS SEEN.
 *
 * ===========================================================================================
 * WHO CAUSES A ROW, AND WHY THE ANSWER IS A FREE-TIER PROPERTY RATHER THAN A GAP
 * ===========================================================================================
 *
 * A record is written only once the caller is established as a platform operator. `0013`'s finding
 * is that a caller who can force a D1 write can exhaust an account-wide allowance and stop D1
 * answering for every Organization — so if a denied non-operator wrote a record here, the
 * population able to force writes would be traffic-sized rather than operator-sized.
 *
 * THIS WAS AN OPEN INTERPRETATION AND IS NO LONGER ONE. `platform-audit.ts` correctly flagged that
 * P4 does not say which side of the authority check the write sits on, and
 * `platform-operator-v1` §`auditModel.whichSIDEOFTHEAUTHORITYCHECKTHEWRITESITSON` now rules it
 * NORMATIVELY, 2026-09-05: *"THE AUDIT WRITE IS AFTER THE AUTHORITY CHECK. A CALLER WHO IS NOT AN
 * ESTABLISHED PLATFORM OPERATOR WRITES NO RECORD."* The cases below cite that clause; they no
 * longer assert an assumption.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  CORRELATION_ID,
  EXPECTED_UNAVAILABLE,
  ORG_ALPHA,
  ORG_BETA,
  ORG_GAMMA,
  PRN_ADMIN,
  SESSION_ADMIN,
  SESSION_BOTH_TABLES,
  SESSION_MODERATOR,
  SESSION_STRANGER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { withFailingActionLog } from '../../harness/broken-platform-controls.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import { PLATFORM_OPERATOR_ACTION_ROW_WRITES } from '../../../../platform/core/identity/control-plane-admission.ts';

const ROUTES = platformRoutes();

/** The nine columns `0009_platform_operator_action.sql` declares, and nothing else. */
const DECLARED_COLUMNS = [
  'action_id',
  'action_record_id',
  'actor_platform_role',
  'actor_principal_id',
  'correlation_id',
  'occurred_at',
  'outcome',
  'target_id',
  'target_kind',
].join(',');

export function buildPlatformAuditSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — P4: the operator action log (0025 decision 5)');

  for (const route of ROUTES) {
    suite.test(`${route.id} writes exactly one action record, and it is a READ`, async () => {
      const world = await make();
      try {
        expectOk(`${route.id} succeeds for a platform-admin`, await world.call(route.id, { sessionId: SESSION_ADMIN }));
        const rows = world.actionRows();
        assertEqual(`${route.id} produced exactly one record`, rows.length, 1);
        assertEqual('the action id is the route id, a Core-owned literal', rows[0].action_id, route.id);
        assertEqual('the actor is the calling operator', rows[0].actor_principal_id, PRN_ADMIN);
        assertEqual('the role is recorded', rows[0].actor_platform_role, 'platform-admin');
        assertEqual('the outcome is ok', rows[0].outcome, 'ok');
        assertEqual('the correlation id is carried', rows[0].correlation_id, CORRELATION_ID);
        assertEqual('neither route in this slice names a target', rows[0].target_kind, 'none');
        assertEqual('so the target identifier is null', rows[0].target_id, null);
      } finally {
        world.close();
      }
    });
  }

  suite.test('a denial for a role lacking the permission IS recorded, with outcome denied', async () => {
    const world = await make();
    try {
      for (const route of ROUTES) {
        await world.call(route.id, { sessionId: SESSION_MODERATOR });
      }
      const rows = world.actionRows();
      assertEqual('one record per refused route', rows.length, ROUTES.length);
      assertTrue(
        'every one is a denial',
        rows.every((row) => row.outcome === 'denied'),
        JSON.stringify(rows),
      );
      assertTrue(
        'and each names the role the attempt was made under',
        rows.every((row) => row.actor_platform_role === 'marketplace-moderator'),
        JSON.stringify(rows),
      );
      assertEqual(
        'the recorded action ids are the routes that were attempted',
        rows.map((row) => String(row.action_id)).sort().join(','),
        ROUTES.map((route) => route.id).sort().join(','),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a caller who is not an established operator writes NO record', async () => {
    // `platform-operator-v1` §`auditModel.whichSIDEOFTHEAUTHORITYCHECKTHEWRITESITSON`, normative.
    //
    // IT ASSERTS THE ROW COUNT AND NOT THE RESPONSE CODE, deliberately. The refusal a non-operator
    // receives is already covered by the authorization suite; what this case is about is whether
    // the attempt COST A CONTROL-PLANE WRITE. A caller who can make Dudo write is `0013`'s "the
    // control becoming the lever", and D1's write limit is ACCOUNT-WIDE — exhausting it stops D1
    // answering for every Organization on the platform. The response code cannot see that; the
    // table can.
    const world = await make();
    try {
      for (const route of ROUTES) {
        await world.call(route.id, { sessionId: SESSION_STRANGER });
        await world.call(route.id, { sessionId: SESSION_BOTH_TABLES });
        await world.call(route.id, {});
      }
      assertEqual('nothing was recorded', world.actionRows().length, 0);

      expectOk('a real operator is still recorded', await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }));
      assertEqual('the control produced its record', world.actionRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('a failed action-log write fails the operation with unavailable', async () => {
    const world = await make({ wrapStore: withFailingActionLog });
    try {
      for (const route of ROUTES) {
        expectError(
          `${route.id} refuses rather than proceeding without evidence`,
          await world.call(route.id, { sessionId: SESSION_ADMIN }),
          EXPECTED_UNAVAILABLE,
        );
      }
      assertEqual('and nothing landed', world.actionRows().length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('an exhausted control-plane budget locks the operator out rather than serving unaudited', async () => {
    // The alternative is serving the request without recording it, which is the audit event
    // failing open — `0013` D2 forbids exactly that. Two row-writes per record, so a ceiling of
    // two admits one request and defers the next.
    const world = await make({ dailyCeilings: { system: PLATFORM_OPERATOR_ACTION_ROW_WRITES } });
    try {
      expectOk('the first request is served', await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }));
      expectError(
        'the second cannot be recorded, so it is refused',
        await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }),
        EXPECTED_UNAVAILABLE,
      );
      assertEqual('exactly one record exists', world.actionRows().length, 1);
    } finally {
      world.close();
    }
  });

  suite.test('the action log holds only the nine columns 0009 declares', async () => {
    // THE TRIPWIRE FOR `0025` DECISION 5. A tenth column is how "never the contents of what was
    // touched" would be lost, and it would arrive in a migration written by somebody who had not
    // read the rule. It reads the SHIPPED schema rather than this suite's expectation of it.
    const built = await createPlatformWorld({ seed: false });
    try {
      const columns = built.control.raw
        .prepare("SELECT name FROM pragma_table_info('platform_operator_action') ORDER BY name")
        .all() as { name: string }[];
      assertEqual(
        `${ISOLATION} no column can carry tenant business data, because there is none to carry it`,
        columns.map((column) => column.name).join(','),
        DECLARED_COLUMNS,
      );
    } finally {
      built.close();
    }
  });

  suite.test('an enumeration records that it happened and none of what it returned', async () => {
    const world = await make();
    try {
      const answer = expectOk(
        'the enumeration succeeds',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN }),
      ) as { data: { organization_id: string }[] };
      assertEqual('it really returned three Organizations', answer.data.length, 3);

      const rows = world.actionRows();
      assertEqual('one record', rows.length, 1);
      const cells = Object.values(rows[0]).map((value) => String(value)).join(' ');
      for (const organizationId of [ORG_ALPHA, ORG_BETA, ORG_GAMMA]) {
        assertTrue(
          `${ISOLATION} the record does not contain ${organizationId}`,
          !cells.includes(organizationId),
          `the action record contained an enumerated identifier: ${cells}`,
        );
      }
      assertEqual(
        `${ISOLATION} an enumeration has no single affected target, and says so`,
        rows[0].target_kind,
        'none',
      );
    } finally {
      world.close();
    }
  });

  suite.test('occurred_at comes from the server clock, never from the request', async () => {
    const world = await make();
    try {
      expectOk('the first call', await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }));
      world.clock.set(world.clock.nowMs() + 3_600_000);
      expectOk('the second call', await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }));

      const rows = world.actionRows();
      assertEqual('two records', rows.length, 2);
      assertTrue(
        'the timestamps differ by the clock movement, not by anything the caller sent',
        String(rows[0].occurred_at) < String(rows[1].occurred_at),
        `${String(rows[0].occurred_at)} then ${String(rows[1].occurred_at)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('the role is recorded AS IT WAS, and survives the operator row being deleted', async () => {
    const world = await make();
    try {
      expectOk('the call', await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN }));
      world.control.raw.prepare('DELETE FROM platform_operator WHERE principal_id = ?').run(PRN_ADMIN);

      const rows = world.actionRows();
      assertEqual('the record is still there', rows.length, 1);
      assertEqual(
        'and still says what authority the action was taken under',
        rows[0].actor_platform_role,
        'platform-admin',
      );

      // And revocation is immediate, because authority is re-read on every request.
      const after = await world.call('platform.session.whoami', { sessionId: SESSION_ADMIN });
      assertTrue(
        'deleting the row revokes on the very next request',
        !after.ok,
        JSON.stringify(after),
      );
      assertEqual('and the refusal wrote no further record', world.actionRows().length, 1);
    } finally {
      world.close();
    }
  });

  return suite;
}
