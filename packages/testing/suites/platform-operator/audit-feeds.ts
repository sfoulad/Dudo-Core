/**
 * ===========================================================================================
 * THE TWO AUDIT FEEDS. `platform-audit-read-v1` · `docs/decisions/0028` Decision 3.
 * ===========================================================================================
 *
 * `platform.audit.list` — the platform-wide feed, which OMITS principal identifiers.
 * `platform.organizations.audit.list` — one Organization's feed, which discloses them.
 *
 * ===========================================================================================
 * EVERY CASE HERE CONSTRUCTS ITS OWN ROWS, AND THAT IS THE POINT RATHER THAN A CONVENIENCE.
 * ===========================================================================================
 *
 * `workflow.md` §11a: *"a check ships with a known-failing input, or it has not been verified —
 * only observed."* Three of the four properties below are ABSENCES — no principal identifier, no
 * wrong page, no silently-interpreted timestamp — and **an absence cannot be verified by
 * observing a green run over whatever rows a route happened to write.** A feed test that only ever
 * saw `target_kind = 'none'` rows would pass with the principal omission deleted.
 *
 * So each case seeds the row that WOULD betray the property if it were broken, with a value it can
 * recognise anywhere in the output.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectOk } from '../../harness/runner.ts';
import {
  ORG_ALPHA,
  ORG_BETA,
  PRN_ADMIN,
  PRN_MODERATOR,
  SESSION_ADMIN,
  createPlatformWorld,
  seedActionRow,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import { createPlatformCursorCodec } from '../../../../platform/core/platform/platform-cursor.ts';

/**
 * A principal identifier that appears in NO fixture constant and in no other row.
 *
 * IT IS DELIBERATELY UNMISTAKABLE. The platform-feed cases search the whole rendered response for
 * it, so a value that collided with a seeded principal would make a leak indistinguishable from a
 * legitimate `actor_principal_id`.
 */
const LEAKABLE_PRINCIPAL = 'prn_leak_canary_0001';

type FeedPage = {
  readonly data: readonly Record<string, unknown>[];
  readonly next_cursor: string | null;
};

/** Six rows spanning both Organizations, two actors, two action ids and three instants. */
function seedFeed(world: PlatformWorld): void {
  const rows: readonly [string, string, string, string, string | null][] = [
    ['par_0000000000001', PRN_ADMIN, 'platform.organizations.list', '2026-09-01T10:00:00.000Z', ORG_ALPHA],
    ['par_0000000000002', PRN_ADMIN, 'platform.templates.list', '2026-09-02T10:00:00.000Z', ORG_ALPHA],
    ['par_0000000000003', PRN_MODERATOR, 'platform.organizations.list', '2026-09-03T10:00:00.000Z', ORG_ALPHA],
    ['par_0000000000004', PRN_ADMIN, 'platform.organizations.list', '2026-09-04T10:00:00.000Z', ORG_BETA],
    ['par_0000000000005', PRN_MODERATOR, 'platform.templates.list', '2026-09-04T11:00:00.000Z', ORG_BETA],
    ['par_0000000000006', PRN_ADMIN, 'platform.organizations.list', '2026-09-04T12:00:00.000Z', null],
  ];
  for (const [id, actor, actionId, occurredAt, organizationId] of rows) {
    seedActionRow(world.control, {
      actionRecordId: id,
      actorPrincipalId: actor,
      actionId,
      occurredAt,
      targetOrganizationId: organizationId,
    });
  }
}

/** The row that would betray the principal omission. `target_kind` IS `principal`. */
function seedPrincipalTargetRow(world: PlatformWorld, organizationId: string | null): void {
  seedActionRow(world.control, {
    actionRecordId: 'par_principal_target1',
    actionId: 'platform.organizations.members.resolve',
    targetKind: 'principal',
    targetId: LEAKABLE_PRINCIPAL,
    targetOrganizationId: organizationId,
    occurredAt: '2026-09-04T13:00:00.000Z',
  });
}

async function feed(
  world: PlatformWorld,
  options: { readonly scoped?: boolean; readonly query?: string } = {},
): Promise<FeedPage> {
  const scoped = options.scoped === true;
  return expectOk(
    `the ${scoped ? 'Organization' : 'platform'} feed answers`,
    await world.call(
      scoped ? 'platform.organizations.audit.list' : 'platform.audit.list',
      {
        sessionId: SESSION_ADMIN,
        queryString: options.query ?? '',
        pathParams: scoped ? { organization_id: ORG_ALPHA } : {},
      },
    ),
  ) as FeedPage;
}

// =============================================================================================
// ITEM 1 — THE CURSOR SCOPE DIGEST. This was a live defect and it is the highest-value property.
// =============================================================================================

export function buildAuditCursorScopeSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Audit feeds — the cursor belongs to a QUERY, not just to an operator');

  /**
   * THE FILTER DIMENSIONS, EACH VARIED ON ITS OWN.
   *
   * ===========================================================================================
   * *** THIS MATRIX IS THE NEGATIVE CONTROL, AND IT IS BETTER THAN A WRAPPER WOULD HAVE BEEN. ***
   * ===========================================================================================
   *
   * A wrapper that stripped `scope` from the binding would show that the digest is load-bearing
   * IN AGGREGATE — one bit of information. This shows it PER DIMENSION: if `since` were left out
   * of the scope string, only the `since` row goes green-when-it-should-be-red, and the run names
   * which one.
   *
   * That matters because of the failure this field's own documentation predicts: *"a filter added
   * later that is not in the scope is a defect of the same shape this field exists to close."* A
   * missing dimension is exactly what an aggregate control cannot see — the other four would still
   * refuse, and the aggregate would stay green while one filter silently stopped binding.
   */
  const DIMENSIONS: readonly { readonly name: string; readonly a: string; readonly b: string }[] =
    Object.freeze([
      {
        name: 'actor_principal_id',
        a: `actor_principal_id=${PRN_ADMIN}`,
        b: `actor_principal_id=${PRN_MODERATOR}`,
      },
      {
        name: 'action_id',
        a: 'action_id=platform.organizations.list',
        b: 'action_id=platform.templates.list',
      },
      { name: 'since', a: 'since=2026-09-01T00:00:00Z', b: 'since=2026-09-02T00:00:00Z' },
      { name: 'until', a: 'until=2026-09-30T00:00:00Z', b: 'until=2026-09-29T00:00:00Z' },
    ]);

  for (const dimension of DIMENSIONS) {
    suite.test(
      `a cursor minted under one \`${dimension.name}\` is REFUSED under another`,
      async () => {
        const world = await make();
        try {
          seedFeed(world);

          // Page 1 under filter set A. `page_size=1` guarantees a cursor.
          const first = await feed(world, { query: `page_size=1&${dimension.a}` });
          assertTrue(
            'page one issued a cursor, so there is something to resume',
            typeof first.next_cursor === 'string' && first.next_cursor.length > 0,
            `no cursor under ${dimension.a}: ${JSON.stringify(first)}`,
          );
          const cursor = encodeURIComponent(first.next_cursor!);

          // ---- THE POSITIVE CONTROL FIRST. The SAME filters resume normally, so the refusal
          // below is about the filters changing and not about the cursor being unusable.
          expectOk(
            `the cursor resumes the SAME query under ${dimension.name}`,
            await world.call('platform.audit.list', {
              sessionId: SESSION_ADMIN,
              queryString: `page_size=1&${dimension.a}&cursor=${cursor}`,
            }),
          );

          // ---- THE CASE. One dimension changed, everything else identical.
          const answer = await world.call('platform.audit.list', {
            sessionId: SESSION_ADMIN,
            queryString: `page_size=1&${dimension.b}&cursor=${cursor}`,
          });
          assertTrue(
            `${ISOLATION} the cursor is refused when \`${dimension.name}\` changes`,
            !answer.ok,
            `A CURSOR RESUMED A DIFFERENT QUERY. This is the defect the scope digest exists to ` +
              `close: the anchor is valid, the signature verifies, and the caller receives a page ` +
              `of a different result set with no error. If this dimension is simply missing from ` +
              `the scope string, that is the same defect one filter smaller: ${JSON.stringify(answer)}`,
          );
        } finally {
          world.close();
        }
      },
    );
  }

  // ===========================================================================================
  // THE ROUND TRIP. A REGRESSION REACHED `main` THROUGH THIS GAP AND IT IS WORTH BEING EXACT.
  // ===========================================================================================
  //
  // `7254f4b` changed `decodeAuditAnchor` to split on the LITERAL six-character string ` `
  // while `encodeAuditAnchor` kept joining with a real NUL. **Page 1 worked and page 2 was
  // unreachable on every request, on both feeds.** `typecheck` was exit 0 and the platform suite
  // was green; the only thing that caught it was a probe asking for page 2.
  //
  // WHAT THIS SUITE ALREADY HAD, STATED HONESTLY: the per-dimension cases above DO round-trip a
  // cursor through a second request, and their `expectOk` positive control WOULD have gone red on
  // that defect — but those cases did not exist when it landed, and they only ever assert that
  // page 2 SUCCEEDS. **A decode that returned a wrong-but-well-formed anchor would satisfy every
  // one of them**, and that is the residual gap: nothing here checked what page 2 CONTAINED.
  //
  // These two cases close it on both feeds, by paging the whole result set one row at a time and
  // requiring the pages to reconstruct it exactly — no gap, no repeat, no reorder.
  for (const scoped of [false, true] as const) {
    suite.test(
      `the ${scoped ? 'ORGANIZATION' : 'PLATFORM'} feed pages through the WHOLE set, in order, ` +
        'with no gap and no repeat',
      async () => {
        const world = await make();
        try {
          seedFeed(world);

          // ===============================================================================
          // BOUNDED TO BEFORE THE RUN, AND THAT IS THE RECURSION RATHER THAN A CONVENIENCE.
          // ===============================================================================
          //
          // **Every feed read WRITES an audit record**, including the reads this case makes —
          // the handler states it: *"reading an Organization's trail writes to that
          // Organization's trail."* So an unbounded reference page taken before the walk is
          // stale by the time the walk starts, and the walk sees a row the reference never had.
          // That is not a paging defect and a case that reported it as one would be wrong.
          //
          // `until` is a real filter and it excludes exactly the records this case creates: the
          // seeded rows are dated 2026-09-01..04 and the fixture clock is 2026-09-05T09:00.
          const window = 'until=2026-09-05T00:00:00Z';

          // The whole set in one page, as the reference. `page_size=25` exceeds the six seeded.
          const whole = await feed(world, { scoped, query: `page_size=25&${window}` });
          assertTrue(
            'the reference page has several rows, so paging it is a real test',
            whole.data.length >= 3,
            `only ${String(whole.data.length)} rows; this case cannot detect a paging defect`,
          );
          assertEqual('and the reference is a single page', whole.next_cursor, null);
          const reference = whole.data.map((row) => String(row.record_id));

          // Now one row at a time, following the cursor through the REAL encode/decode pair.
          const paged: string[] = [];
          let page = await feed(world, { scoped, query: `page_size=1&${window}` });
          for (let guard = 0; guard <= reference.length + 1; guard += 1) {
            assertEqual(`page ${String(guard + 1)} holds exactly one row`, page.data.length, 1);
            paged.push(String(page.data[0]!.record_id));
            if (page.next_cursor === null) {
              break;
            }
            page = await feed(world, {
              scoped,
              query: `page_size=1&${window}&cursor=${encodeURIComponent(page.next_cursor)}`,
            });
          }

          // THE THREE PROPERTIES, SEPARATELY, BECAUSE THEY FAIL DIFFERENTLY. A dead cursor stops
          // the walk short; a mis-decoded anchor repeats or skips; a wrong ORDER BY reorders.
          assertEqual(
            `${ISOLATION} paging reconstructs the whole set, in the same order`,
            paged.join(','),
            reference.join(','),
          );
          assertEqual('no row appears twice', new Set(paged).size, paged.length);
          assertEqual('and none is missing', paged.length, reference.length);
        } finally {
          world.close();
        }
      },
    );
  }

  suite.test(
    'THE CONSTRUCTED FAILING INPUT: an anchor whose separator differs is refused — 7254f4b, rebuilt',
    async () => {
      // =====================================================================================
      // THE DEFECT ITSELF, NOT A DESCRIPTION OF IT.
      // =====================================================================================
      //
      // `encodeAuditAnchor` and `decodeAuditAnchor` are module-private, so they cannot be called
      // directly and a different separator cannot be injected into Core. What CAN be built is the
      // value the broken pair produced: a cursor that is **correctly signed, correctly bound, and
      // whose anchor payload uses the wrong separator.** That is byte-for-byte what a page-2
      // request carried under `7254f4b`.
      //
      // If the feed accepted it, `decodeAuditAnchor` would not be checking the separator at all
      // and the round-trip cases above would be passing for some other reason.
      const world = await make();
      try {
        seedFeed(world);
        const codec = await createPlatformCursorCodec(new Uint8Array(32).fill(0x2a));
        const binding = {
          principalId: PRN_ADMIN,
          pageSize: 1,
          // The scope the platform feed composes with no filters set: route id then five empties.
          scope: ['platform.audit.list', '', '', '', '', ''].join(String.fromCharCode(0)),
        };
        // NOTE the scope above must match what the handler composes for a request with NO
        // filters. If the handler's scope composition changes, both calls below are refused and
        // the positive control turns this case red rather than letting it pass vacuously.
        const nowMs = Date.UTC(2026, 8, 5, 9, 0, 0);
        const occurredAt = '2026-09-04T12:00:00.000Z';
        const recordId = 'par_0000000000006';

        // ---- THE POSITIVE CONTROL. The SAME anchor with the REAL separator is accepted, so the
        // refusal below is about the separator and not about the binding or the signature.
        expectOk(
          'an anchor joined with the real separator resumes the feed',
          await world.call('platform.audit.list', {
            sessionId: SESSION_ADMIN,
            queryString:
              'page_size=1&cursor=' +
              encodeURIComponent(
                await codec.encode(
                  `${occurredAt}${String.fromCharCode(0)}${recordId}`,
                  binding,
                  nowMs,
                ),
              ),
          }),
        );

        // ---- THE CASE. The literal six-character string ` `, which is exactly what the
        // broken decode split on and what an encode written the same way would emit.
        const mismatched = await codec.encode(
          `${occurredAt}\\u0000${recordId}`,
          binding,
          nowMs,
        );
        const answer = await world.call('platform.audit.list', {
          sessionId: SESSION_ADMIN,
          queryString: `page_size=1&cursor=${encodeURIComponent(mismatched)}`,
        });
        assertTrue(
          `${ISOLATION} an anchor whose separator does not match the decoder is refused`,
          !answer.ok,
          'a correctly signed cursor whose anchor used a different separator was ACCEPTED. The ' +
            'decoder is not checking the separator, so the round-trip cases above are green for ' +
            `some other reason: ${JSON.stringify(answer)}`,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('a cursor from the PLATFORM feed cannot resume the ORGANIZATION feed', async () => {
    // THE SEPARATION THAT MATTERS MOST, because the two feeds disclose different things. A cursor
    // obtained in the omitting feed must not be usable to page the principal-disclosing one from a
    // position obtained there.
    const world = await make();
    try {
      seedFeed(world);
      const platformPage = await feed(world, { query: 'page_size=1' });
      assertTrue(
        'the platform feed issued a cursor',
        typeof platformPage.next_cursor === 'string',
        JSON.stringify(platformPage),
      );

      const answer = await world.call('platform.organizations.audit.list', {
        sessionId: SESSION_ADMIN,
        pathParams: { organization_id: ORG_ALPHA },
        queryString: `page_size=1&cursor=${encodeURIComponent(platformPage.next_cursor!)}`,
      });
      assertTrue(
        `${ISOLATION} a platform-feed cursor does not resume an Organization feed`,
        !answer.ok,
        `a cursor crossed between the two feeds: ${JSON.stringify(answer)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test('and a cursor for ONE Organization cannot resume ANOTHER', async () => {
    const world = await make();
    try {
      seedFeed(world);
      const alpha = expectOk(
        'the ORG_ALPHA feed answers',
        await world.call('platform.organizations.audit.list', {
          sessionId: SESSION_ADMIN,
          pathParams: { organization_id: ORG_ALPHA },
          queryString: 'page_size=1',
        }),
      ) as FeedPage;
      assertTrue(
        'it issued a cursor',
        typeof alpha.next_cursor === 'string',
        JSON.stringify(alpha),
      );

      const answer = await world.call('platform.organizations.audit.list', {
        sessionId: SESSION_ADMIN,
        pathParams: { organization_id: ORG_BETA },
        queryString: `page_size=1&cursor=${encodeURIComponent(alpha.next_cursor!)}`,
      });
      assertTrue(
        `${ISOLATION} the Organization is part of what the cursor is bound to`,
        !answer.ok,
        `a cursor issued against ${ORG_ALPHA} resumed ${ORG_BETA}'s feed — one tenant's audit ` +
          `position used to page another tenant's trail: ${JSON.stringify(answer)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'THE CONSTRUCTED FAILING INPUT: with the scope held constant, the same cursor IS accepted',
    async () => {
      // =====================================================================================
      // THE PRE-FIX BEHAVIOUR, BUILT RATHER THAN DESCRIBED.
      // =====================================================================================
      //
      // Every case above asserts a REFUSAL. A refusal is only evidence if the thing being removed
      // is what causes it — otherwise the cases could be passing because the codec refuses
      // everything, or because a signature check happens to fail for an unrelated reason.
      //
      // So this drives the SHIPPED codec directly with the binding the pre-fix code used: operator
      // and page size, and a `scope` that does NOT vary with the filters. **The cursor is accepted
      // across two different filter sets** — which is the exact defect, reproduced, and it is what
      // makes the four refusals above attributable to the digest rather than to anything else.
      const codec = await createPlatformCursorCodec(new Uint8Array(32).fill(0x2a));
      const nowMs = Date.UTC(2026, 8, 5, 9, 0, 0);

      const preFixBinding = (scope: string) => ({
        principalId: PRN_ADMIN,
        pageSize: 25,
        scope,
      });

      // The pre-fix world: scope carries the route and nothing about the filters.
      const constantScope = 'platform.audit.list';
      const minted = await codec.encode('anchor-value-0001', preFixBinding(constantScope), nowMs);
      const spent = await codec.decode(minted, preFixBinding(constantScope), nowMs);
      expectOk(
        'WITHOUT the filters in the scope, a cursor crosses filter sets unchallenged',
        spent,
      );
      assertEqual('and resumes from the same anchor', spent.ok ? spent.value : null, 'anchor-value-0001');

      // The fixed world: the same two requests, with the filters in the scope. Now refused.
      const withFilters = await codec.encode(
        'anchor-value-0001',
        preFixBinding(`platform.audit.list ${PRN_ADMIN}`),
        nowMs,
      );
      const refused = await codec.decode(
        withFilters,
        preFixBinding(`platform.audit.list ${PRN_MODERATOR}`),
        nowMs,
      );
      assertTrue(
        `${ISOLATION} WITH the filters in the scope, the identical cursor is refused`,
        !refused.ok,
        'the scope digest does not affect the decision, so every refusal above is caused by ' +
          'something other than the digest and this suite is not testing what it says',
      );
    },
  );

  return suite;
}

// =============================================================================================
// ITEM 2 — THE PRINCIPAL OMISSION. Asserted as a PROPERTY, driven by a row that would betray it.
// =============================================================================================

export function buildAuditPrincipalOmissionSuite(
  make: MakePlatformWorld = createPlatformWorld,
): Suite {
  const suite = new Suite('Audit feeds — the platform feed carries no principal identifier');

  suite.test(
    'NO platform-feed response carries a principal identifier — with a principal-target row present',
    async () => {
      // =====================================================================================
      // THE ROW IS THE POINT. `target_kind = 'principal'` with a recognisable `target_id`.
      // =====================================================================================
      //
      // The implementation selects `NULL AS target_principal_id` for this feed, so the column is
      // never read into the process. **A test over rows whose `target_kind` is `none` would pass
      // with that omission deleted**, because there would be nothing to leak.
      const world = await make();
      try {
        seedFeed(world);
        seedPrincipalTargetRow(world, ORG_ALPHA);

        // ---- THE CONTROL FIRST: the row really is in the feed. Otherwise the absence below is
        // the absence of the row, not the absence of the identifier.
        const page = await feed(world, { query: 'page_size=25' });
        assertTrue(
          'the principal-target row IS returned by the platform feed',
          page.data.some((row) => row.record_id === 'par_principal_target1'),
          `the seeded row is not in the feed, so this case would pass vacuously: ${JSON.stringify(page.data)}`,
        );

        assertTrue(
          `${ISOLATION} and its principal identifier appears NOWHERE in the response`,
          !JSON.stringify(page).includes(LEAKABLE_PRINCIPAL),
          'the platform-wide feed disclosed the identifier of a principal who is the TARGET of ' +
            'an action. 0028 Decision 3 omits it precisely so that a platform-wide reader cannot ' +
            "accumulate a picture of one Organization's people",
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('the omission holds under EVERY filter and on EVERY page', async () => {
    // A single unfiltered call is one shape of one query. The omission is a property of the feed,
    // so it is asserted across the filter space and across pagination — because the SQL builder
    // composes the column list and the WHERE clause in the same function, and a future filter
    // that changed the projection would be invisible to a one-query test.
    const world = await make();
    try {
      seedFeed(world);
      seedPrincipalTargetRow(world, ORG_ALPHA);

      const queries = [
        'page_size=1',
        'page_size=25',
        `actor_principal_id=${PRN_ADMIN}`,
        'action_id=platform.organizations.members.resolve',
        'since=2026-09-01T00:00:00Z',
        'until=2026-09-30T00:00:00Z',
        `actor_principal_id=${PRN_ADMIN}&action_id=platform.organizations.members.resolve`,
      ];
      let sawTheRow = false;
      for (const query of queries) {
        let page = await feed(world, { query });
        for (let guard = 0; guard < 10; guard += 1) {
          if (page.data.some((row) => row.record_id === 'par_principal_target1')) {
            sawTheRow = true;
          }
          assertTrue(
            `${ISOLATION} no principal identifier under \`${query}\``,
            !JSON.stringify(page).includes(LEAKABLE_PRINCIPAL),
            `the platform feed leaked a target principal under ${query}`,
          );
          if (page.next_cursor === null) {
            break;
          }
          page = await feed(world, {
            query: `${query}&cursor=${encodeURIComponent(page.next_cursor)}`,
          });
        }
      }
      // THE FLOOR. If no query ever returned the row, every assertion above was about a response
      // that could not have leaked anything.
      assertTrue(
        'at least one of the queries actually returned the principal-target row',
        sawTheRow,
        'the row was never in any page, so this case asserted nothing',
      );
    } finally {
      world.close();
    }
  });

  suite.test('the ORGANIZATION feed DOES disclose it — the control that makes the omission mean something', async () => {
    // WITHOUT THIS THE CASES ABOVE WOULD PASS IF THE COLUMN WERE NEVER SELECTED BY EITHER FEED.
    // `0028` Decision 3 is a DISCLOSURE RULE, not a prohibition: the scoped feed names principals
    // because a reader who already holds that Organization's trail may see who was acted upon.
    const world = await make();
    try {
      seedFeed(world);
      seedPrincipalTargetRow(world, ORG_ALPHA);

      const page = await feed(world, { scoped: true, query: 'page_size=25' });
      assertTrue(
        'the Organization feed returns the row',
        page.data.some((row) => row.record_id === 'par_principal_target1'),
        JSON.stringify(page.data),
      );
      assertTrue(
        'AND discloses the principal, so the platform feed is omitting rather than never selecting',
        JSON.stringify(page).includes(LEAKABLE_PRINCIPAL),
        'neither feed discloses a target principal, so the platform feed\'s omission is not a ' +
          'disclosure decision — it is a column nobody reads, and the cases above prove nothing ' +
          'about 0028 Decision 3',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a principal-target row in ANOTHER Organization is not in this Organization\'s feed', async () => {
    const world = await make();
    try {
      seedFeed(world);
      seedPrincipalTargetRow(world, ORG_BETA);

      const page = await feed(world, { scoped: true, query: 'page_size=25' });
      assertTrue(
        `${ISOLATION} ORG_BETA's principal-target row is absent from ORG_ALPHA's feed`,
        !JSON.stringify(page).includes(LEAKABLE_PRINCIPAL),
        `the scoped feed disclosed a principal targeted in a DIFFERENT Organization: ${JSON.stringify(page)}`,
      );
      assertTrue(
        'and the feed is not simply empty, so the absence is a filter rather than a failure',
        page.data.length > 0,
        'ORG_ALPHA has no rows at all, so this case would pass with the filter removed',
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
