/**
 * ===========================================================================================
 * `successStatus` REACHES THE RESPONSE — THE FUNCTION *AND* THE WIRING, WHICH ARE TWO CHECKS.
 * ===========================================================================================
 *
 * **What already existed was a declaration-versus-declaration check**: `registry-coherence.ts`
 * compares each route's `successStatus` against the value its contract declares. That is real and
 * it is not this. **Two declarations agreeing tells you nothing about what a third thing does with
 * either** — both could say `201` forever while every response carried `200`.
 *
 * ===========================================================================================
 * AND DRIVING `renderSuccess` ALONE IS HALF THE CHECK. THE MISSING HALF IS THE ONE THAT BREAKS.
 * ===========================================================================================
 *
 * `renderSuccess` is called from three sites in `platform/core/http/api.ts`:
 *
 *     :287   renderSuccess(outcome.value, 200, …)                          literal
 *     :373   renderSuccess(…, 201, …)                                      literal
 *     :536   renderSuccess(outcome.value, matched.route.successStatus, …)  THE PLATFORM CLASS
 *
 * **Driving the function proves it honours the status it is HANDED. It cannot prove the CALLER
 * hands it the route's declared value** — and `:536` is the entire wiring for this class. A change
 * there to a literal `200` passes every test that drives the function, and every route declaring
 * `201` would silently answer `200`.
 *
 * **The two literals are not a defect.** They belong to other request classes with fixed statuses.
 * They are what makes `:536` the interesting line: **the platform class is the only one that reads
 * the route table, so it is the only one where a declared `successStatus` can be silently ignored.**
 *
 * | | answers | blind to |
 * |---|---|---|
 * | drive `renderSuccess` | *does the value handed to it reach the response?* | **whether the ROUTE's value is what gets handed** |
 * | assert over `:536` | *does the class read `matched.route.successStatus`?* | whether the function then honours it |
 *
 * **Neither subsumes the other and each goes red on an input the other passes**, which is this
 * repository's test for whether two checks are genuinely two rather than one written twice.
 *
 * *** WHAT NEITHER COVERS, STATED SO IT IS NOT MISTAKEN FOR COVERED. *** `handleRequest` is still
 * NOT RUN by anything. Composing full `ApiDependencies` pulls the entire Action pipeline into a
 * suite whose subject is the platform class — **a large permanently-maintained surface bought to
 * observe one integer per route**, and it would make this suite fail for reasons belonging to a
 * pipeline it does not test. **A suite that goes red under load teaches a team to ignore red.**
 * These two cases plus a live probe after deploy is the honest boundary, and the gap is named
 * rather than closed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { renderSuccess } from '../../../../platform/core/http/response.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';

const API_SOURCE = fileURLToPath(new URL('../../../../platform/core/http/api.ts', import.meta.url));

export function buildSuccessStatusSuite(): Suite {
  const suite = new Suite('Platform — the declared successStatus reaches the response');

  suite.test('*** EVERY ROUTE\'S DECLARED STATUS IS WHAT THE RESPONSE CARRIES ***', async () => {
    const routes = platformRoutes();
    assertTrue(
      `${ISOLATION} THE FLOOR: the route table was read (${routes.length} routes)`,
      routes.length > 15,
      'a loop over an empty table reports a perfect record',
    );

    const wrong: string[] = [];
    for (const route of routes) {
      // The route's OWN declared value, passed exactly as `api.ts:536` passes it. Nothing here
      // transcribes a status: a hardcoded expectation would be a third declaration to keep true,
      // and the two that exist are already compared elsewhere.
      const response = renderSuccess({ ok: true }, route.successStatus, 'req_x', 'cor_x');
      if (response.status !== route.successStatus) {
        wrong.push(`${route.id}: declares ${route.successStatus}, response carried ${response.status}`);
      }
    }
    assertEqual(`${ISOLATION} no route's response status differs from its declared value`, wrong.join(' · '), '');

    // ---- THE POPULATION, because "no route differs" is satisfied by a table of one.
    const byStatus = new Map<number, number>();
    for (const route of routes) byStatus.set(route.successStatus, (byStatus.get(route.successStatus) ?? 0) + 1);
    const distribution = [...byStatus.entries()].sort((a, b) => a[0] - b[0]);
    console.log(
      `        success status: ${routes.length} routes · ` +
        distribution.map(([status, count]) => `${count}×${status}`).join(' · '),
    );
    assertTrue(
      `${ISOLATION} and the class declares MORE THAN ONE distinct status — or this proves nothing`,
      distribution.length > 1,
      'every route declaring the same status makes this case pass against a `renderSuccess` that ' +
        `ignores its argument and returns a constant: ${JSON.stringify(distribution)}`,
    );

    // ---- THE KNOWN-FAILING INPUT. A `renderSuccess` that ignored its argument would pass
    // everything above IF the class were uniform; the case above rules that out, and this rules
    // out the function being right by accident of the two values the corpus happens to use.
    for (const status of [200, 201, 202, 418] as const) {
      assertEqual(
        `${ISOLATION} it honours ${status} — including values no route declares`,
        renderSuccess({}, status, 'req_x', 'cor_x').status,
        status,
      );
    }

    // *** `204` IS DELIBERATELY ABSENT FROM THAT LIST, AND FINDING OUT WHY IS THE REASON IT IS
    // *** RECORDED RATHER THAN QUIETLY DROPPED. *** It was in the first version and the case went
    // red with `Response constructor: Invalid response status code 204`. **That is my input being
    // wrong, not a defect** — but the fact underneath is worth keeping: `renderSuccess` always
    // `JSON.stringify`s a payload, and a `204` may not carry a body, **so this function
    // STRUCTURALLY CANNOT SERVE A NO-CONTENT STATUS.**
    //
    // *** AND THE TYPECHECKER THEN CORRECTED ME, WHICH IS THE BETTER OUTCOME AND IS WHY THE WHOLE
    // *** EPISODE IS RECORDED. *** My next move was to assert *"no route declares 204"* at runtime.
    // `tsc` refused it: `TS2367 — types '200 | 201' and '204' have no overlap`.
    //
    // **`successStatus` is not `number`. It is the union `200 | 201`**, so a route CANNOT declare a
    // status `renderSuccess` could not serve. The protection I was about to assert already exists
    // one layer up and is strictly stronger: **omission does not compile, where my assertion would
    // only have failed after somebody wrote it.** `architecture.md` §3a's ranking, and the honest
    // statement of which layer carries the weight is: **the TYPE does. `renderSuccess` throwing is
    // a backstop nothing can currently reach.**
    //
    // Kept as a note rather than as a case, because a test asserting something the type forbids is
    // a test that can never fail — and this file already argues that a check which cannot fail is
    // not a check.
    let refused = 'accepted';
    try {
      // Cast deliberately: the union is what makes this unreachable in real code, and the cast is
      // how a suite observes the backstop that sits behind it.
      renderSuccess({}, 204 as unknown as 200, 'req_x', 'cor_x');
    } catch {
      refused = 'threw';
    }
    assertEqual(
      `${ISOLATION} BACKSTOP: renderSuccess cannot serve 204 — it always writes a body`,
      refused,
      'threw',
    );
  });

  suite.test('*** AND THE PLATFORM CLASS PASSES THE ROUTE\'S VALUE, NOT A LITERAL ***', async () => {
    // ===================================================================================
    // A STRUCTURAL ASSERTION OVER SOURCE, WHICH IS THE ONLY THING THAT CAN SEE THIS.
    // ===================================================================================
    //
    // The case above would stay green if `api.ts:536` were changed to `renderSuccess(value, 200,
    // …)`. Every route would still *declare* its status, `registry-coherence` would still find the
    // declaration matching its contract, and every 201 route would answer 200. **Three checks
    // green, one wrong integer on the wire.**
    //
    // **This reads the file rather than executing it, and that is a real limit stated rather than
    // hidden**: it asserts about a string, so a refactor that keeps the behaviour and changes the
    // expression goes red on a correct change. **That is the trade this repository already makes
    // for structural assertions, and it is acceptable here because the alternative is composing an
    // Action pipeline to observe one integer.** If it goes red, read the line before changing it.
    const source = readFileSync(API_SOURCE, 'utf8');

    // THE FLOOR ON THE READER, not only on the result. A file that failed to load, or a path that
    // moved, yields an empty string — and every `includes` below would report absence, which reads
    // exactly like a defect. `§11a`: a broken reader is the most confident empty-list reader.
    assertTrue(
      `${ISOLATION} THE FLOOR: api.ts was read (${source.length} bytes)`,
      source.length > 5_000 && source.includes('renderSuccess'),
      'api.ts could not be read, or no longer mentions renderSuccess. Every assertion below would ' +
        'report a defect that is actually this reader failing',
    );

    const calls = [...source.matchAll(/renderSuccess\(\s*([^;]*?)\)\s*;/gsu)].map((match) => match[1] ?? '');
    assertTrue(
      `${ISOLATION} the reader found renderSuccess call sites (${calls.length})`,
      calls.length >= 3,
      `expected the three known call sites and found ${calls.length}. A pattern that stopped ` +
        'matching would report "no literal-status platform call" for a file it never parsed',
    );

    // *** THE SUBJECT: at least one call passes the ROUTE's status, derived rather than literal. ***
    const fromRouteTable = calls.filter((args) => /successStatus/u.test(args));
    assertTrue(
      `${ISOLATION} a renderSuccess call passes \`successStatus\` read from the matched route`,
      fromRouteTable.length >= 1,
      'NO CALL SITE IN api.ts PASSES A ROUTE\'S DECLARED successStatus. The platform class is the ' +
        'only request class that reads the route table, so if this is gone, every route\'s ' +
        '`successStatus` is a declaration nothing consumes — and the case above, plus ' +
        `registry-coherence's contract comparison, both stay green. calls=${JSON.stringify(calls)}`,
    );
    assertTrue(
      'and it reads it off the MATCHED route rather than from a variable assigned elsewhere',
      fromRouteTable.some((args) => /matched\.route\.successStatus/u.test(args)),
      'the call passes something named successStatus but not `matched.route.successStatus`. That ' +
        'may be a correct refactor and it may be a value assigned from a literal upstream — this ' +
        `assertion cannot tell, which is why it names the expression: ${JSON.stringify(fromRouteTable)}`,
    );
  });

  return suite;
}
