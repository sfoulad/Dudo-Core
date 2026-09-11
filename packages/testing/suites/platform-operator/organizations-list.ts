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
  PRN_ADMIN,
  SESSION_ADMIN,
  createPlatformWorld,
  expectedInvalidArgument,
  seedOrganization,
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

  suite.test('the store asks only named questions, and every one is justified here', async () => {
    // ===================================================================================
    // `PlatformOperatorStore` IS "A FIXED LIST OF NAMED QUESTIONS" — no `select(spec)`, no table
    // name, no predicate, no column list, no sort. The absence of a `listOperators` or a count
    // method is stronger than a rule that no handler calls one.
    // ===================================================================================
    //
    // THIS WAS A PINNED STRING READING "four named questions" AND IT WENT RED ON 2026-09-05 when
    // the port gained two. The count is not the property — **a question that reaches more than
    // the routes need is** — so the assertion is now a map from method to the reach it grants and
    // the route that needs it. A method added without an entry fails; a method whose entry cannot
    // be written is a method that should not exist.
    const world = await make();
    try {
      const permittedQuestions: Readonly<Record<string, string>> = {
        findOperator:
          'one principal id in, a role or null out. The authority resolver. It cannot enumerate ' +
          'operators, which is why there is no listOperators',
        principalHasAnyMembership:
          'one principal id in, a boolean out. The mutual-exclusion probe (0024). It returns no ' +
          'Organization, so it cannot be used to discover which tenant a principal belongs to',
        listOrganizations:
          'a bounded, keyset-anchored page of Organizations. The enumeration this class exists ' +
          'for. Limit is REQUIRED — there is no unlimited form',
        recordAction: 'appends one row to the operator action log. The only write on the port',
        findOrganizationDetail:
          'ADDED 2026-09-05 for organization-detail-v1. One Organization id in; its Template ' +
          'reference and a member COUNT out. It returns a count and never a member list, so it ' +
          'cannot be used to enumerate the people in a tenant',
        findOrganizationIdentity:
          'ADDED 2026-09-07 for organization-identity-v1. One Organization id in, its identity ' +
          'record out. **It reads the Organization\'s OWN attributes — display name, commercial ' +
          'registration, VAT — and no row belonging to anyone inside it.** A control-plane record ' +
          'about a tenant is not tenant data, which is the distinction platform-operator-store.ts ' +
          'has to state honestly: "no tenant data" is exact, "no tenant identifier" is not',
        updateOrganizationIdentity:
          'ADDED 2026-09-07. The write half, and it takes a reservation — so it cannot be reached ' +
          'without capacity having been charged. It replaces the identity record wholesale rather ' +
          'than patching fields, which is what makes the audit record able to name what changed',
        revokeOperator:
          'ADDED 2026-09-05 for platform-operators-v1. **THE ONLY WRITE ON THIS PORT BESIDES THE ' +
          'ACTION LOG**, and it is a CONDITIONAL DELETE rather than a read-then-write: it takes a ' +
          'reservation, and it returns null for both "no such operator" and "the precondition ' +
          'failed" — a statement reporting WHICH would be the oracle the collapse closes. ' +
          '`isSelfRevocation` is a parameter rather than something it infers, so the caller has ' +
          'to have decided. It reaches one principal and no tenant',
        listOperators:
          'ADDED 2026-09-05 for platform-operators-v1. A bounded, keyset-anchored page of the ' +
          'operator roster. **THE REACH IT GRANTS IS BOUNDED BY THE ROW TYPE, NOT BY THE CALLER: ' +
          '`PlatformOperatorSummary` has three fields — principal id, platform role, granted-at — ' +
          'and no email, no display name, no last-seen.** So a handler could not leak a personal ' +
          'detail through this question even if it tried, which is the guarantee being in the ' +
          'type rather than in a caller\'s restraint. It enumerates operators and nothing about ' +
          'any tenant',
        listPlatformAudit:
          'ADDED 2026-09-05 for platform-audit-read-v1. A bounded, keyset-anchored page of the ' +
          'action log with four optional filters. **IT SELECTS `NULL AS target_principal_id`** — ' +
          'the column is never read into the process on this path, so the reach it grants stops ' +
          'short of naming the people an action targeted. That is 0028 Decision 3, expressed in ' +
          'the projection rather than in a caller that remembers to strip a field',
        listOrganizationAudit:
          'ADDED 2026-09-05. The same page, narrowed to ONE Organization by a required ' +
          'organizationId, and this one DOES read the target principal. The wider reach is the ' +
          'point: a reader who already holds that Organization\'s trail may see who was acted ' +
          'upon, and the route calling it writes into that Organization\'s own trail on every call',
        resolveMemberByIdentifierHash:
          'ADDED 2026-09-05 for 0028 decision 2. An Organization id and an identifier HASH in, AT ' +
          'MOST ONE member out. It takes a hash rather than an identifier, so it cannot be swept; ' +
          'it answers one or none, so it is not a search; and the route that calls it is bound to ' +
          'core.credential.reset, so a caller who may not reset may not resolve',
        countOrganizationsUsingTemplate:
          'ADDED 2026-09-11 for template-lifecycle-v1. One Template id in, a NUMBER out, and the ' +
          'return type is the guarantee: `number` is a shape that cannot carry an identifier, so ' +
          'this cannot become the Organization enumeration 0028 CO1 forbids arriving through a ' +
          'different door. **AND security.md §2a IS THE ENTRY THAT MATTERS HERE, NOT THE SHAPE:** a ' +
          'count is safe exactly when its consumer already holds enumeration over the counted ' +
          'population, and a `core.template.read` holder does NOT enumerate Organizations — so this ' +
          'count reaches PAST its consumer\'s right and is a new disclosure that owes its own ' +
          '`sensitive` permission rather than borrowing the Template read. **A justification that ' +
          'stopped at "it returns a number" would have been true and would have missed that.**',
        countOrganizations:
          'ADDED 2026-09-11 for docs/decisions/0042. No arguments, a NUMBER out, and it is the ' +
          'MIRROR of countOrganizationsUsingTemplate rather than a repeat of it — security.md §2a ' +
          'gives the two opposite answers and the difference is the whole rule. This one is gated ' +
          'by core.organization.list, whose holder ALREADY enumerates every Organization, ' +
          'deliberately, at sensitive. **A count that stays inside its consumer\'s enumeration ' +
          'right discloses nothing obtainable more slowly by other means**, so it needs no new ' +
          'permission; the adoption count reaches PAST its consumer\'s right and needed one. It ' +
          'takes no filter and returns a scalar: a total that accepts a filter is a query, and a ' +
          'breakdown transposes into the mapping 0028 Decision 1 refuses',
        setOrganizationTemplate:
          'ADDED 2026-09-11 for template-lifecycle-v1 PA-17. The second real write, and it takes a ' +
          'reservation, so it cannot be reached without capacity having been charged. **IT WRITES ' +
          'ONE COLUMN ON ONE CONTROL-PLANE `organization` ROW AND REACHES NO TENANT STORE.** That ' +
          'is what keeps 0024 true across this feature: the tenant-side audit record for the same ' +
          'operation goes into the named Organization\'s OWN database through ' +
          'MemberResolutionPort.recordOrganizationAccess, which requires an OperatorWriteCharged ' +
          'receipt. **The two writes live on two ports deliberately, and this port must not learn ' +
          'how to do the other one** — a single method that did both would put tenant reach behind ' +
          'a platform permission, which is the mutual exclusion failing quietly rather than loudly. ' +
          '`null` CLEARS the Template and clearing is a real operation, not a hole',
      };
      const actualQuestions = Object.keys(world.store).sort();
      assertEqual(
        `${ISOLATION} every question the platform store answers is justified here`,
        actualQuestions.filter((method) => !(method in permittedQuestions)).join(','),
        '',
      );
      assertEqual(
        'and every question named here is still on the port',
        Object.keys(permittedQuestions).filter((m) => !actualQuestions.includes(m)).join(','),
        '',
      );
      // AND THE SHAPES THAT WOULD MAKE IT A QUERY INTERFACE ARE STILL ABSENT. This is the half a
      // per-method map cannot express: what matters is not only which methods exist but that none
      // of them is a general one.
      assertEqual(
        `${ISOLATION} no general query method exists on the platform store`,
        actualQuestions
          .filter((method) => /^(select|query|find|list|search|count)$/i.test(method))
          .join(','),
        '',
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'A NAMELESS ORGANIZATION IS STILL LISTED, AND IS STILL READABLE — the population the list exists to show',
    async () => {
      // =====================================================================================
      // *** THIS ASSERTS A DEFECT THAT WAS AVOIDED RATHER THAN ONE THAT HAPPENED, AND THAT IS
      // WHY IT IS WORTH MORE THAN THE USUAL CASE. ***
      // =====================================================================================
      //
      // `0015` added `display_name` as a NULLABLE column, so every Organization created before it
      // has none — **including the three in production.** `core-agent` read that field with a
      // permissive reader rather than a strict one, deliberately: a strict read collapses null and
      // empty into a failure, and would have made **every Organization predating `0015`
      // unlistable — the exact population the operator console exists to show.**
      //
      // Nothing stood over that judgement. The next person to "tidy" the permissive read into a
      // strict one gets a green suite and an empty console, and finds out in production against
      // the only three rows that exist. **This case turns the judgement into a mechanism**, which
      // is the same shape as the migration probe that models the pre-migration rows by inserting
      // before and reading after.
      //
      // IT ASSERTS THE ROW SURVIVES, NOT THAT THE VALUE IS NULL. A case asserting `display_name`
      // is always null would be pinning a placeholder — it stopped being true the moment the
      // update route could set one, and it would have had to be deleted rather than kept.
      const world = await make();
      try {
        const nameless = 'org_nameless_000001';
        seedOrganization(world.control, nameless);
        // EXPLICITLY NULL rather than relying on the seeder's default, so the case still holds if
        // `seedOrganization` ever starts supplying a name.
        world.control.raw
          .prepare('UPDATE organization SET display_name = NULL WHERE organization_id = ?')
          .run(nameless);

        const page = expectOk(
          'the list is served',
          await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN }),
        ) as ListAnswer;

        const listed = page.data.find((row) => row.organization_id === nameless);
        assertTrue(
          `${ISOLATION} an Organization with NO display_name still appears in the list`,
          listed !== undefined,
          'a nameless Organization is missing from the enumeration. A strict read of `display_name` ' +
            'would do exactly this, and it would hide every Organization created before 0015 — ' +
            `which today is all three in production: ${JSON.stringify(page.data)}`,
        );
        assertEqual(
          'and the field is present and null rather than absent, so a client can branch on it',
          (listed as Record<string, unknown>).display_name,
          null,
        );

        // AND THE DETAIL ROUTE TOO. The list and the read are separate handlers reading the same
        // column; one being permissive says nothing about the other.
        const detail = expectOk(
          `${ISOLATION} and the detail route serves it rather than failing`,
          await world.call('platform.organizations.read', {
            sessionId: SESSION_ADMIN,
            pathParams: { organization_id: nameless },
          }),
        ) as Record<string, unknown>;
        assertEqual('the detail carries the same null', detail.display_name, null);

        // THE CONTROL. A NAMED Organization also lists, so the case above is about tolerating
        // null rather than about the list returning everything regardless.
        world.control.raw
          .prepare('UPDATE organization SET display_name = ? WHERE organization_id = ?')
          .run('Alpha Trading Company', ORG_ALPHA);
        const withName = expectOk(
          'the list is served again',
          await world.call('platform.organizations.list', { sessionId: SESSION_ADMIN }),
        ) as ListAnswer;
        assertEqual(
          'a NAMED Organization reports its name, so the reader is reading and not ignoring',
          withName.data.find((row) => row.organization_id === ORG_ALPHA)?.display_name,
          'Alpha Trading Company',
        );
      } finally {
        world.close();
      }
    },
  );

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

      // A cursor signed with a DIFFERENT key: what a forger without the secret can produce. Every
      // other field is CORRECT — the right anchor, the right operator, the right page size — so
      // the only thing that can refuse it is the signature.
      const foreign = await createPlatformCursorCodec(new Uint8Array(32).fill(0x99));
      const forged = await foreign.encode(
        ORG_ALPHA,
        // `scope` ADDED 2026-09-05 when `PlatformCursorBinding` gained it for the audit feeds.
        // **IT MUST BE THE VALUE THIS ROUTE REALLY USES**, or the forgery would be refused for
        // the wrong reason — a scope mismatch rather than a bad signature — and the case's whole
        // claim ("the only thing that can refuse it is the signature") would be false while it
        // still printed green. `listOrganizations` uses the bare route id.
        { principalId: PRN_ADMIN, pageSize: 1, scope: 'platform.organizations.list' },
        world.clock.nowMs(),
      );
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
