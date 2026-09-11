/**
 * Verifies the directory's URL state — parsing, defaulting, tidying.
 *
 *   npm run verify:search-params
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHY IT IS THE ONLY NEW LOGIC THAT GETS A SCRIPT
 * ===========================================================================
 *
 * The ADR 0036 migration replaced a hand-rolled hash router, four `useState`
 * reads and a hand-rolled table with library code. **Almost all of it is
 * behaviour the library owns and the type checker constrains.** One piece is
 * not: `routes/customer-list-search.ts` decides what an address MEANS — what
 * `?status=banana` does, whether `?status=pending_deletion` is honoured or
 * silently rewritten, and which parameters are allowed to reach a screen.
 *
 * That is the client's own logic, it is reachable by anyone who can type a URL,
 * and `tsc` has nothing to say about any of it.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT COVER, STATED RATHER THAN LEFT TO BE ASSUMED
 * ===========================================================================
 *
 * There is **no component test coverage in this package and this script does not
 * add any.** `0016` left the testing framework (TS1) explicitly open, so nothing
 * here can render React. The screens rewritten in this migration — the
 * directory, the record, the form — are verified by `tsc` and by the production
 * build, and by nothing else. That is a real gap, it is the same gap that
 * existed before the migration, and it is larger now because more code changed.
 */

import {
  customerListSearchSchema,
  tidySearch,
  DEFAULT_STATUS,
} from '../src/routes/customer-list-search.ts';

let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const okay = a === e;
  if (!okay) failures += 1;
  console.log(
    `${okay ? 'PASS' : 'FAIL'}  ${name}` +
      (okay ? '' : `\n        expected ${e}\n        actual   ${a}`),
  );
}

const parse = (search) => customerListSearchSchema.parse(search);

console.log('\n=== An empty address is the unfiltered directory ===\n');

check('nothing parses to nothing', parse({}), {});
check(
  'and the screen reads the default from one place',
  DEFAULT_STATUS,
  'active',
);

console.log('\n=== Rubbish in the address does not throw a person out ===\n');

/*
 * `.catch(undefined)` rather than an exception. A mistyped or stale bookmark is
 * a thing that happens; answering it with a blank screen and a console error
 * would be a worse failure than showing the default directory.
 */
check('an unknown status falls back', parse({ status: 'banana' }), {});
check('so does a numeric one', parse({ status: 42 }), {});
check('so does an array', parse({ status: ['active'] }), {});

console.log('\n=== Every status the CONTRACT permits is honoured ===\n');

/*
 * THE BEHAVIOUR CHANGE THIS MIGRATION MADE, ASSERTED SO IT IS NOT LOST.
 *
 * The hand-rolled router resolved the status by looking it up in the THREE TABS
 * the screen draws, so `?status=pending_deletion` — a value the contract permits
 * — silently showed the ACTIVE directory under a URL claiming otherwise. It is
 * carried through now; the tab strip simply shows none of its three as pressed.
 */
check('active', parse({ status: 'active' }).status, 'active');
check('archived', parse({ status: 'archived' }).status, 'archived');
check(
  'pending_deletion is no longer rewritten to active',
  parse({ status: 'pending_deletion' }).status,
  'pending_deletion',
);
check('all', parse({ status: 'all' }).status, 'all');

console.log('\n=== The other three parameters ===\n');

check(
  'a search term, a Business and a cursor survive',
  parse({ q: 'ab', business: 'biz_1', cursor: 'opaque' }),
  { q: 'ab', business: 'biz_1', cursor: 'opaque' },
);
check('an empty search term is carried as empty, not dropped', parse({ q: '' }), { q: '' });

/*
 * UNDECLARED PARAMETERS ARE STRIPPED, AND THIS ONE MATTERS BEYOND TIDINESS.
 *
 * `main.tsx` reads `?fault=` and `?businesses=` from the page's query string to
 * configure the fixture transport. Under hash history those lived before the `#`
 * and could never reach this schema. **`0036`'s amendment switched to path
 * routing, so they now arrive in the very query string this schema parses** —
 * which turns a hypothetical into the actual arrangement, and makes the
 * assertion below load-bearing rather than defensive.
 *
 * They must be stripped: a demonstration switch adopted as screen state would be
 * echoed back into every link the directory builds, and would be a switch nobody
 * can turn off. `main.tsx` consumes them at module scope before the router
 * mounts, so stripping them here costs nothing.
 */
check(
  'an undeclared parameter is dropped rather than carried',
  parse({ q: 'ab', fault: 'list', businesses: 'none' }),
  { q: 'ab' },
);

console.log('\n=== tidySearch keeps the address bar honest ===\n');

check('empty values never reach the URL', tidySearch({ q: '', business: '', cursor: '' }), {});
check(
  'the default status is implied rather than written',
  tidySearch({ status: 'active' }),
  {},
);
check('a chosen status is written', tidySearch({ status: 'archived' }), { status: 'archived' });
check(
  'everything set is everything kept',
  tidySearch({ q: 'ab', status: 'all', business: 'biz_1', cursor: 'opaque' }),
  { q: 'ab', status: 'all', business: 'biz_1', cursor: 'opaque' },
);

console.log('\n=== Parsing and tidying agree with each other ===\n');

/*
 * A ROUND TRIP MUST BE STABLE. Every navigation in the directory writes
 * `tidySearch(...)` into the URL and reads `parse(...)` back out, so a pair that
 * disagreed would make the screen re-navigate on arrival — a loop that would
 * look like a flickering page rather than like a bug in these two functions.
 */
for (const start of [
  {},
  { q: 'ab' },
  { status: 'archived' },
  { status: 'pending_deletion' },
  { q: 'ab', status: 'all', business: 'biz_1', cursor: 'opaque' },
]) {
  const once = tidySearch(parse(start));
  const twice = tidySearch(parse(once));
  check(`stable for ${JSON.stringify(start)}`, twice, once);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
