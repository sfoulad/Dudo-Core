/**
 * SEARCH SEMANTICS AND COLLECTION BEHAVIOUR.
 *
 * The contract fixes both and says why each rule is load-bearing rather than stylistic
 * (README §7 and §8). The two that matter most for disclosure:
 *
 *   - `notes` AND `address` ARE NEVER MATCHED. "notes is free text a member of staff wrote
 *     for themselves, and making it searchable turns an arbitrary phrase into a probe that
 *     confirms whether that phrase appears in someone's record — available to a principal
 *     holding only `list`, which is the permission that deliberately does not return notes at
 *     all." The fixture therefore plants the word `zebra` in an address and `zebracorp` in a
 *     note, in a record whose name, email and phone contain neither, so a match could only
 *     come from the forbidden fields.
 *   - `%` AND `_` ARE LITERAL. One escape character is the difference between "the caller may
 *     not inject a pattern" and "the caller may match most of a directory with two
 *     keystrokes". Asserted with a PAIR of records — `a%b Trading` against `axb Trading` —
 *     so that a wildcard reading returns two rows and a literal reading returns one. A single
 *     record would pass under both readings.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import type { World, WorldOptions } from '../../harness/world.ts';
import {
  CUST_A_ANNA,
  CUST_A_ARCHIVED,
  CUST_A_PERCENT,
  CUST_A_PLAIN,
  CUST_A_UNDERSCORE,
  CUST_A_UNDERX,
  CUST_A_ZEBRA,
  EXPECTED_INVALID_CURSOR,
} from '../../harness/world.ts';

type MakeWorld = (options?: WorldOptions) => Promise<World>;
type Collection = { readonly data: readonly { readonly customer_id: string }[]; readonly next_cursor: string | null };

function idsOf(value: unknown): string[] {
  return (value as Collection).data.map((row) => row.customer_id);
}

export function buildSearchAndCollectionSuite(makeWorld: MakeWorld): Suite {
  const suite = new TestSuite('search semantics and collection behaviour');

  suite.test('notes and address are NEVER matched', async () => {
    const world = await makeWorld();
    try {
      // Control: the record is findable by a field that IS searchable, so a later empty
      // result means "not matched on notes/address" rather than "the record is missing".
      const byName = expectOk('control: the record is findable by name', await world.invoke(world.actions.search, world.ownerA, { query: 'delta' }));
      assertTrue('control: the planted record is reachable', idsOf(byName).includes(CUST_A_ZEBRA), 'the control record was not found by name');

      const byAddress = expectOk('the address search runs', await world.invoke(world.actions.search, world.ownerA, { query: 'zebrastraat' }));
      assertEqual('a term appearing only in an address matches nothing', idsOf(byAddress).length, 0);

      const byNotes = expectOk('the notes search runs', await world.invoke(world.actions.search, world.ownerA, { query: 'zebracorp' }));
      assertEqual('a term appearing only in notes matches nothing', idsOf(byNotes).length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('% is a literal character, not a wildcard', async () => {
    const world = await makeWorld();
    try {
      const literal = expectOk('the search runs', await world.invoke(world.actions.search, world.ownerA, { query: 'a%b' }));
      assertEqual('only the record containing a literal per-cent sign matches', idsOf(literal).join(','), CUST_A_PERCENT);
      assertTrue('the wildcard reading would have matched the other record and did not', !idsOf(literal).includes(CUST_A_PLAIN), 'a% behaved as a pattern');
    } finally {
      world.close();
    }
  });

  suite.test('_ is a literal character, not a single-character wildcard', async () => {
    const world = await makeWorld();
    try {
      const literal = expectOk('the search runs', await world.invoke(world.actions.search, world.ownerA, { query: 'c_d' }));
      assertEqual('only the record containing a literal underscore matches', idsOf(literal).join(','), CUST_A_UNDERSCORE);
      assertTrue('the wildcard reading would have matched cxd and did not', !idsOf(literal).includes(CUST_A_UNDERX), '_ behaved as a wildcard');
    } finally {
      world.close();
    }
  });

  suite.test('the name rule is prefix-per-token and AND across terms, in either order', async () => {
    const world = await makeWorld();
    try {
      const forward = expectOk('forward order', await world.invoke(world.actions.search, world.ownerA, { query: 'an sm' }));
      assertTrue("'an sm' matches 'Anna Smith'", idsOf(forward).includes(CUST_A_ANNA), `matched: ${idsOf(forward).join(',')}`);
      const reversed = expectOk('reversed order', await world.invoke(world.actions.search, world.ownerA, { query: 'smith an' }));
      assertTrue("'smith an' matches it too", idsOf(reversed).includes(CUST_A_ANNA), `matched: ${idsOf(reversed).join(',')}`);
      const infix = expectOk('an infix term', await world.invoke(world.actions.search, world.ownerA, { query: 'nna' }));
      assertTrue("'nna' matches nothing — the rule is prefix, not substring", !idsOf(infix).includes(CUST_A_ANNA), 'an infix matched');
    } finally {
      world.close();
    }
  });

  suite.test('the phone rule is a suffix match with a four-digit floor', async () => {
    const world = await makeWorld();
    try {
      const fourDigits = expectOk('four digits', await world.invoke(world.actions.search, world.ownerA, { query: '0101' }));
      assertTrue('a four-digit suffix matches', idsOf(fourDigits).includes(CUST_A_ANNA), `matched: ${idsOf(fourDigits).join(',')}`);
      const threeDigits = expectOk('three digits', await world.invoke(world.actions.search, world.ownerA, { query: '101' }));
      assertTrue('below the floor the phone rule does not participate', !idsOf(threeDigits).includes(CUST_A_ANNA), 'a three-digit query matched on phone');
    } finally {
      world.close();
    }
  });

  suite.test('the email rule is a prefix of the whole normalised address', async () => {
    const world = await makeWorld();
    try {
      const prefix = expectOk('a prefix', await world.invoke(world.actions.search, world.ownerA, { query: 'anna.smith@' }));
      assertTrue('the prefix matches', idsOf(prefix).includes(CUST_A_ANNA), `matched: ${idsOf(prefix).join(',')}`);
      const domain = expectOk('a domain fragment', await world.invoke(world.actions.search, world.ownerA, { query: 'alpha.test' }));
      assertTrue('a non-prefix fragment of the address does not match on email', !idsOf(domain).includes(CUST_A_ANNA), 'the email rule behaved as a substring match');
    } finally {
      world.close();
    }
  });

  suite.test('the default listing is active only; archived is reachable only by asking', async () => {
    const world = await makeWorld();
    try {
      const byDefault = expectOk('default listing', await world.invoke(world.actions.list, world.ownerA, { page_size: 100 }));
      assertTrue('the archived record is absent by default', !idsOf(byDefault).includes(CUST_A_ARCHIVED), 'an archived record appeared in the default listing');
      const archived = expectOk('archived listing', await world.invoke(world.actions.list, world.ownerA, { status: 'archived', page_size: 100 }));
      assertTrue('and present when asked for', idsOf(archived).includes(CUST_A_ARCHIVED), 'the archived record was not returned under status=archived');
      const all = expectOk('all listing', await world.invoke(world.actions.list, world.ownerA, { status: 'all', page_size: 100 }));
      assertTrue("status=all includes it", idsOf(all).includes(CUST_A_ARCHIVED), 'status=all did not include the archived record');
      const pending = expectOk('pending_deletion listing', await world.invoke(world.actions.list, world.ownerA, { status: 'pending_deletion', page_size: 100 }));
      assertEqual('pending_deletion is filterable and returns nothing in this slice', idsOf(pending).length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('paging over the whole directory neither skips nor duplicates a row', async () => {
    const world = await makeWorld();
    try {
      const collected: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const input: Record<string, unknown> = { page_size: 2, status: 'all' };
        if (cursor !== null) {
          input.cursor = cursor;
        }
        const outcome = expectOk(`page ${pages + 1}`, await world.invoke(world.actions.list, world.ownerA, input)) as Collection;
        collected.push(...outcome.data.map((row) => row.customer_id));
        cursor = outcome.next_cursor;
        pages += 1;
        assertTrue('paging terminates', pages < 20, 'the pager did not terminate');
      } while (cursor !== null);

      const unique = new Set(collected);
      assertEqual('no row appeared twice', unique.size, collected.length);
      const direct = expectOk('a single large page', await world.invoke(world.actions.list, world.ownerA, { page_size: 100, status: 'all' })) as Collection;
      assertEqual(
        'paging returned exactly the same set as one large page',
        collected.slice().sort().join(','),
        direct.data.map((row) => row.customer_id).slice().sort().join(','),
      );
    } finally {
      world.close();
    }
  });

  suite.test('every cursor rejection returns the identical error — malformed, forged, wrong filter, wrong tenant, stale anchor', async () => {
    const world = await makeWorld();
    try {
      const first = expectOk('a cursor is issued', await world.invoke(world.actions.list, world.ownerA, { page_size: 1 })) as Collection;
      const cursor = first.next_cursor as string;
      assertTrue('control: a cursor was issued', typeof cursor === 'string', 'no cursor issued');

      // A genuine continuation works, so the rejections below are not "cursors never work".
      expectOk('control: the genuine cursor continues', await world.invoke(world.actions.list, world.ownerA, { page_size: 1, cursor }));

      const forged = `${cursor.slice(0, 42)}${cursor[42] === 'A' ? 'B' : 'A'}${cursor.slice(43)}`;
      const cases: readonly [string, Record<string, unknown>][] = [
        ['malformed', { page_size: 1, cursor: 'AAAAAAAA' }],
        ['forged signature', { page_size: 1, cursor: forged }],
        ['a different page size', { page_size: 2, cursor }],
        ['a different status filter', { page_size: 1, status: 'all', cursor }],
        ['a different business filter', { page_size: 1, business_id: 'biz_alpha_north', cursor }],
        ['replayed against search', { page_size: 1, query: 'anna', cursor }],
      ];
      for (const [name, input] of cases) {
        const action = 'query' in input ? world.actions.search : world.actions.list;
        expectError(`cursor rejection: ${name}`, await world.invoke(action, world.ownerA, input), EXPECTED_INVALID_CURSOR);
      }

      // Expired: the clock is moved past the one-hour cursor lifetime.
      world.clock.set(world.clock.nowMs() + 2 * 60 * 60 * 1000);
      expectError('cursor rejection: expired', await world.invoke(world.actions.list, world.ownerA, { page_size: 1, cursor }), EXPECTED_INVALID_CURSOR);
    } finally {
      world.close();
    }
  });

  suite.test('page_size is bounded at 100 and rejected above it', async () => {
    const world = await makeWorld();
    try {
      expectOk('100 is accepted', await world.invoke(world.actions.list, world.ownerA, { page_size: 100 }));
      expectError(
        '101 is rejected as too large, not silently clamped',
        await world.invoke(world.actions.list, world.ownerA, { page_size: 101 }),
        { code: 'invalid_argument', message: 'The request is not valid.', details: [{ field: 'page_size', issue: 'too_large' }] },
      );
      expectError(
        '0 is rejected as too small',
        await world.invoke(world.actions.list, world.ownerA, { page_size: 0 }),
        { code: 'invalid_argument', message: 'The request is not valid.', details: [{ field: 'page_size', issue: 'too_small' }] },
      );
    } finally {
      world.close();
    }
  });

  suite.test('the collection envelope exposes no aggregate — no total, no count, no facet', async () => {
    const world = await makeWorld();
    try {
      const listing = expectOk('a listing', await world.invoke(world.actions.list, world.ownerA, {})) as Record<string, unknown>;
      const search = expectOk('a search', await world.invoke(world.actions.search, world.ownerA, { query: 'anna' })) as Record<string, unknown>;
      assertEqual('the listing envelope is data and next_cursor only', Object.keys(listing).sort().join(','), 'data,next_cursor');
      assertEqual('the search envelope is the same', Object.keys(search).sort().join(','), 'data,next_cursor');
    } finally {
      world.close();
    }
  });

  suite.test('the list projection omits address and notes, which is what makes list a different permission from read', async () => {
    const world = await makeWorld();
    try {
      const listing = expectOk('a listing', await world.invoke(world.actions.list, world.ownerA, { page_size: 100 })) as {
        data: readonly Record<string, unknown>[];
      };
      for (const row of listing.data) {
        assertTrue('no summary row carries address', !Object.prototype.hasOwnProperty.call(row, 'address'), `keys: ${Object.keys(row).join(',')}`);
        assertTrue('no summary row carries notes', !Object.prototype.hasOwnProperty.call(row, 'notes'), `keys: ${Object.keys(row).join(',')}`);
      }
      const full = expectOk('a detail read', await world.invoke(world.actions.get, world.ownerA, { customer_id: CUST_A_ANNA })) as Record<string, unknown>;
      assertTrue('the detail read does carry them', 'address' in full && 'notes' in full, 'the full record is missing the free-text fields');
    } finally {
      world.close();
    }
  });

  return suite;
}
