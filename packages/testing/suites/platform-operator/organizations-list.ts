/**
 * ===========================================================================================
 * THE ENUMERATION ROUTE. `platform.organizations.list`.
 * contract `platform-operator-v1`, `operations[platform.organizations.list]` and
 * `platform-operator-v1.schema.json` `$defs/listOrganizationsOutput`.
 * ===========================================================================================
 *
 * THE SHAPE IS THE SECURITY PROPERTY HERE, not an ergonomic preference. The contract says it
 * twice and the store repeats it:
 *
 *   "IT RETURNS NO COUNTS, NO CUSTOMER TOTALS, NO ACTIVITY AND NO USAGE. Every one of those is a
 *   tenant read behind whereWithTenant, and a 'how many customers does this Organization have'
 *   column is how a console acquires cross-tenant reach one convenient number at a time."
 *
 * So the response is asserted against an EXACT key set rather than by checking that the expected
 * fields are present. A test that only asserted presence would pass on a response that had also
 * grown `customer_count`.
 *
 * `display_name` IS ASSERTED TO BE PRESENT AND NULL. Absent-versus-null is a distinction two
 * clients resolve differently, and "the web app shows a blank and the iPhone app shows nothing" is
 * exactly the divergence the one-contract rule exists to prevent. This is a cross-client contract
 * assertion made on the producer, because neither client exists to assert it on yet.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  ORG_ALPHA,
  ORG_BETA,
  ORG_GAMMA,
  SESSION_ADMIN,
  createPlatformWorld,
  expectedInvalidArgument,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { PLATFORM_DEFAULT_PAGE_SIZE } from '../../../../platform/core/platform/platform-routes.ts';
import { createPlatformCursorCodec } from '../../../../platform/core/platform/platform-cursor.ts';

type ListAnswer = {
  readonly data: readonly Record<string, unknown>[];
  readonly next_cursor: string | null;
};

const EXPECTED_ROW_KEYS = 'created_at,display_name,organization_id,status';
const REJECTED_CURSOR = expectedInvalidArgument('cursor', 'invalid_cursor');

export function buildOrganizationsListSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — the Organization enumeration');

  suite.test('the response carries exactly data and next_cursor, and no count of anything', async () => {
    const world = await make();
    try {
      const answer = expectOk(
        'the enumeration succeeds',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN }),
      ) as ListAnswer;

      assertEqual(
        'the envelope is exactly two fields',
        Object.keys(answer).sort().join(','),
        'data,next_cursor',
      );
      assertEqual('all three Organizations are returned', answer.data.length, 3);
      for (const row of answer.data) {
        assertEqual(
          `${ISOLATION} a row is exactly four fields — no counts, no usage, no activity`,
          Object.keys(row).sort().join(','),
          EXPECTED_ROW_KEYS,
        );
        assertEqual('display_name is PRESENT and null, never omitted', row.display_name, null);
        assertEqual('the status is a closed-set value', row.status, 'active');
      }
      assertEqual(
        'ordered by identifier',
        answer.data.map((row) => String(row.organization_id)).join(','),
        [ORG_ALPHA, ORG_BETA, ORG_GAMMA].sort().join(','),
      );
      assertEqual('and the last page carries a null cursor, never an empty string', answer.next_cursor, null);
    } finally {
      world.close();
    }
  });

  suite.test('the store exposes four named questions and no way to ask a fifth', async () => {
    const world = await make();
    try {
      // `PlatformOperatorStore` is "a FIXED LIST OF FOUR NAMED QUESTIONS", and the absence of a
      // `listOperators` or a count method is stronger than a rule that no handler calls one.
      assertEqual(
        `${ISOLATION} the platform store's whole surface`,
        Object.keys(world.store).sort().join(','),
        'findOperator,listOrganizations,principalHasAnyMembership,recordAction',
      );
    } finally {
      world.close();
    }
  });

  suite.test('the default page size is 25 and pages are keyset-anchored', async () => {
    const world = await make();
    try {
      const first = expectOk(
        'page one of one',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN }),
      ) as ListAnswer;
      assertTrue(
        'three rows fit inside the default page',
        first.data.length <= PLATFORM_DEFAULT_PAGE_SIZE,
        String(first.data.length),
      );

      // page_size=1 forces three pages, which is what exercises the cursor at all.
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const query = cursor === null ? 'page_size=1' : `page_size=1&cursor=${cursor}`;
        const answer = expectOk(
          `page ${String(page + 1)}`,
          await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN, queryString: query }),
        ) as ListAnswer;
        assertTrue('a page never exceeds its page size', answer.data.length <= 1, String(answer.data.length));
        for (const row of answer.data) {
          seen.push(String(row.organization_id));
        }
        cursor = answer.next_cursor;
        if (cursor === null) {
          break;
        }
      }
      assertEqual('every Organization was seen exactly once', seen.join(','), [ORG_ALPHA, ORG_BETA, ORG_GAMMA].sort().join(','));
      assertEqual('and the enumeration terminated on a null cursor', cursor, null);
    } finally {
      world.close();
    }
  });

  suite.test('a cursor bound to one page size is refused at another', async () => {
    const world = await make();
    try {
      const first = expectOk(
        'page one',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN, queryString: 'page_size=1' }),
      ) as ListAnswer;
      assertTrue('there is a next page', first.next_cursor !== null, 'the fixture produced no cursor');

      expectError(
        'a page 2 under a different page size is not page 2',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: `page_size=2&cursor=${first.next_cursor}`,
        }),
        REJECTED_CURSOR,
      );
      // The control: at the page size it was issued under, the same cursor works.
      expectOk(
        'the same cursor at page_size=1 is accepted',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: `page_size=1&cursor=${first.next_cursor}`,
        }),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a tampered or foreign-signed cursor is refused with the one rejection value', async () => {
    const world = await make();
    try {
      const first = expectOk(
        'page one',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN, queryString: 'page_size=1' }),
      ) as ListAnswer;
      const issued = String(first.next_cursor);

      // One character changed in the body, after the fixed-width signature.
      const tampered = `${issued.slice(0, 43)}${issued[43] === 'A' ? 'B' : 'A'}${issued.slice(44)}`;
      expectError('a tampered cursor is refused', await world.call('platform.organizations.list', {
        sessionId: SESSION_ADMIN,
        queryString: `page_size=1&cursor=${tampered}`,
      }), REJECTED_CURSOR);

      // A cursor signed with a DIFFERENT key: what a forger without the secret can produce.
      const foreign = await createPlatformCursorCodec(new Uint8Array(32).fill(0x99));
      const forged = await foreign.encode(ORG_ALPHA, 1, world.clock.nowMs());
      expectError('a cursor signed with another key is refused', await world.call('platform.organizations.list', {
        sessionId: SESSION_ADMIN,
        queryString: `page_size=1&cursor=${forged}`,
      }), REJECTED_CURSOR);
    } finally {
      world.close();
    }
  });

  suite.test('an expired cursor is refused', async () => {
    const world = await make();
    try {
      const first = expectOk(
        'page one',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN, queryString: 'page_size=1' }),
      ) as ListAnswer;
      // One hour and one second later. `CURSOR_MAX_AGE_MS` is an hour.
      world.clock.set(world.clock.nowMs() + 60 * 60 * 1000 + 1000);
      expectError(
        'a stale cursor cannot resume an enumeration',
        await world.call('platform.organizations.list', {
          sessionId: SESSION_ADMIN,
          queryString: `page_size=1&cursor=${first.next_cursor}`,
        }),
        REJECTED_CURSOR,
      );
    } finally {
      world.close();
    }
  });

  suite.test('a cursor issued to one operator is refused for another', async () => {
    // `platform-operator-v1.schema.json` `$defs/cursor`, as corrected 2026-09-05: "THE CURSOR IS
    // BOUND TO THE PRINCIPAL AND THE QUERY SHAPE INSTEAD: it must not be transferable between
    // operators, or one operator could resume another's enumeration of the platform's
    // Organizations."
    //
    // This case asserts the contract. It names no expectation about the implementation.
    const world = await make();
    try {
      // A second platform-admin, so both callers pass authorization and the only difference
      // between them is which principal holds the cursor.
      const second = 'prn_platform_admin02';
      const secondSession = 'ses_admin_000000002';
      world.control.raw
        .prepare("INSERT INTO principal (principal_id, principal_type, status, created_at) VALUES (?, 'user', 'active', ?)")
        .run(second, '2026-09-04T09:00:00.000Z');
      world.control.raw
        .prepare('INSERT INTO platform_operator (principal_id, platform_role, created_at) VALUES (?, ?, ?)')
        .run(second, 'platform-admin', '2026-09-04T09:00:00.000Z');
      world.control.raw
        .prepare('INSERT INTO session (session_id, principal_id, active_organization_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)')
        .run(secondSession, second, '2026-09-04T09:00:00.000Z', '2026-09-05T10:00:00.000Z');

      const first = expectOk(
        'operator one starts an enumeration',
        await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN, queryString: 'page_size=1' }),
      ) as ListAnswer;
      assertTrue('it produced a cursor', first.next_cursor !== null, 'no cursor was issued');

      // The control first: the second operator can enumerate on its own, so a refusal below is
      // about the cursor rather than about the second operator being unable to call the route.
      expectOk(
        'operator two can enumerate with its own request',
        await world.call('platform.organizations.list', { sessionId: secondSession, queryString: 'page_size=1' }),
      );

      expectError(
        `${ISOLATION} operator two cannot resume operator one's enumeration`,
        await world.call('platform.organizations.list', {
          sessionId: secondSession,
          queryString: `page_size=1&cursor=${first.next_cursor}`,
        }),
        REJECTED_CURSOR,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
