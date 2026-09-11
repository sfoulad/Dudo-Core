/**
 * ===========================================================================================
 * THE LAYER THAT TURNS A URL INTO A ROUTE AND AN ID — UNEXERCISED UNTIL 2026-09-11.
 * ===========================================================================================
 *
 * **`matchPlatformRoute` was reached by four call sites in the entire test tree, all of them
 * `/whoami`, which carries no path parameter. ELEVEN of the class's routes carry one. Not one had
 * ever been resolved from a URL by anything** — not by a suite, not by the harness, not by a probe.
 *
 * **And eight of the eleven predate this week entirely.** `organizations.read`, `members.resolve`,
 * `organizations.audit.list`, `organizations.identity.update`, `operators.revoke`, `templates.read`
 * — all shipped, all deployed, all with this layer unexercised.
 *
 * ===========================================================================================
 * WHY TWO INDEPENDENT TEST APPROACHES BOTH MISSED IT, WHICH IS THE PART WORTH KEEPING
 * ===========================================================================================
 *
 *   `world.call` / `successfulCallFor`   supplies path params from ITS CALLER — a hardcoded map
 *   the handler probes                   supply them from THEMSELVES — passed straight in
 *
 * **Neither ever asks the matcher to PRODUCE them.** That is `workflow.md` §11a's *two derivations
 * that share a scope are one derivation*, arriving in test coverage rather than in a checker: two
 * instruments that disagree about method and agree about entry point **agree about what they cannot
 * see.**
 *
 * *** AND IT IS EXACTLY WHY FIVE ROUTES LOOKED BROKEN ON 2026-09-11. *** The `internal`s came from
 * a fixture supplying `pathParams: {}` — **a value the real transport can never produce**, because
 * this matcher parses and validates the parameter before any handler is reached. **The fixture could
 * manufacture an input the system cannot**, and nothing said so. An afternoon was spent attributing
 * that to Core.
 *
 * **So this file's subject is not "does the matcher work". It is: the parameters a handler receives
 * come from the URL, and every route in the class can actually be reached by one.**
 */

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { matchPlatformRoute, platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';

/** A value for each declared `{name}`, chosen to satisfy the grammar the matcher enforces. */
const SPECIMEN: Readonly<Record<string, string>> = {
  organization_id: 'org_alpha_000000001',
  template_id: 'tpl_seeded_00000001',
  principal_id: 'prn_target_00000001',
  confirmation_id: 'cnf_specimen0000001',
};

const PLACEHOLDER = /\{([a-z_]+)\}/gu;

/** The `{name}`s one declared path carries, in order. */
const placeholdersOf = (path: string): string[] =>
  [...path.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');

/**
 * A concrete URL for one declared path.
 *
 * **It THROWS on a placeholder with no specimen rather than substituting something plausible.** A
 * generated filler would satisfy the grammar today and silently stop resolving the first time the
 * grammar tightened — and the case would report the route as unreachable, which is the wrong
 * finding pointing at the wrong file.
 */
function urlFor(path: string): string {
  return path.replace(PLACEHOLDER, (_whole, name: string) => {
    const specimen = SPECIMEN[name];
    if (specimen === undefined) {
      throw new Error(
        `url-resolution has no specimen for the path parameter '{${name}}'. A route declaring it ` +
          'has joined the class. Add a value that satisfies the grammar this matcher enforces — do ' +
          'not let this case invent one, because an invented value that stops matching reports the ' +
          'route as unreachable instead of reporting this file as stale.',
      );
    }
    return specimen;
  });
}

export function buildUrlResolutionSuite(): Suite {
  const suite = new Suite('Platform — every route resolves FROM A URL, with the matcher\'s own parameters');

  suite.test('*** EVERY ROUTE IN THE CLASS IS REACHABLE FROM ITS OWN DECLARED PATH ***', () => {
    const routes = platformRoutes();

    // ---- THE FLOOR, FIRST. A walk that resolves nothing resolves it perfectly.
    assertTrue(
      `${ISOLATION} THE FLOOR: the route table was read at all (${routes.length} routes)`,
      routes.length > 15,
      'a matcher exercised over an empty table reports a perfect record. The count is asserted ' +
        'against a floor rather than trusted',
    );

    const unresolved: string[] = [];
    const misrouted: string[] = [];
    const wrongParams: string[] = [];

    for (const route of routes) {
      const match = matchPlatformRoute(route.method, urlFor(route.path));
      if (match === undefined) {
        unresolved.push(`${route.method} ${route.path}`);
        continue;
      }
      // *** RESOLVING IS NOT ENOUGH — IT MUST RESOLVE TO THE RIGHT ROUTE. *** A literal segment
      // shadowed by a parameterised sibling resolves happily to the WRONG route and answers
      // plausibly to the wrong question. See the shadowing case below.
      if (match.route.id !== route.id) {
        misrouted.push(`${route.id} resolved to ${match.route.id}`);
      }
      // AND THE EXTRACTED NAMES MUST BE THE DECLARED ONES. A matcher that resolved correctly and
      // handed the handler a differently-keyed object would produce exactly the `undefined` read
      // that cost an afternoon on 2026-09-11 — from the layer that is supposed to prevent it.
      const declared = placeholdersOf(route.path).sort().join(',');
      const extracted = Object.keys(match.pathParams).sort().join(',');
      if (declared !== extracted) {
        wrongParams.push(`${route.id}: declares [${declared}], matcher produced [${extracted}]`);
      }
    }

    const withParams = routes.filter((route) => placeholdersOf(route.path).length > 0);
    console.log(
      `        url resolution: ${routes.length} routes resolved from their own paths · ` +
        `${withParams.length} carry a path parameter · ${routes.length - withParams.length} do not`,
    );

    assertEqual(`${ISOLATION} every route resolves from its declared path`, unresolved.join(' · '), '');
    assertEqual(
      `${ISOLATION} and each resolves to ITSELF — not to a sibling that shadows it`,
      misrouted.join(' · '),
      '',
    );
    assertEqual(
      `${ISOLATION} and the matcher produces exactly the parameter names the route declares`,
      wrongParams.join(' · '),
      '',
    );

    // ---- THE POPULATION THIS FILE EXISTS FOR, ASSERTED RATHER THAN PRINTED.
    // The whole finding was that this subset had ZERO coverage. If it ever reads 0, either the
    // class lost every parameterised route or `placeholdersOf` stopped seeing them — and the three
    // assertions above would all pass vacuously on the remainder.
    assertTrue(
      `${ISOLATION} and the path-parameter routes are a real population (${withParams.length}), not an empty one`,
      withParams.length >= 11,
      'this file exists because ELEVEN routes carried a path parameter and none had ever been ' +
        'resolved from a URL. A count below that means either the class shrank or this file stopped ' +
        `seeing them, and the assertions above would pass on whatever is left: ${routes.map((r) => r.path).join(' · ')}`,
    );
  });

  suite.test('THE MATCHER\'S OWN FAILING INPUTS — resolving everything is not resolving correctly', () => {
    // ===================================================================================
    // A matcher that returned the first route for any input would pass every assertion
    // above. These are the inputs it must REFUSE.
    // ===================================================================================
    const cases: readonly (readonly [string, string, string])[] = [
      ['GET', '/api/v1/platform/organizations/org_alpha_000000001/nonsense', 'a path no route declares'],
      ['GET', '/api/v1/platform', 'the base path alone'],
      ['GET', '/api/v1/platform/organizations/org_alpha_000000001/extra/segments', 'too many segments'],
      ['DELETE', '/api/v1/platform/organizations', 'a method no route declares for that path'],
      ['GET', '/api/v1/platform/templates/no', 'a path parameter that fails the id grammar'],
    ];
    for (const [method, path, why] of cases) {
      assertEqual(
        `${ISOLATION} REFUSED — ${why}`,
        matchPlatformRoute(method, path) === undefined ? 'refused' : `matched ${matchPlatformRoute(method, path)?.route.id}`,
        'refused',
      );
    }

    // THE MIRROR, and without it every line above is satisfied by a matcher that refuses
    // everything — which would also make the first case's `unresolved` list non-empty, but only
    // if that case runs. A control in the same case is what makes this one self-contained.
    const control = matchPlatformRoute('GET', '/api/v1/platform/organizations');
    assertEqual(
      `${ISOLATION} MIRROR: a well-formed path still matches — the refusals above are not a matcher that refuses everything`,
      control?.route.id ?? 'nothing',
      'platform.organizations.list',
    );
  });

  suite.test('*** A LITERAL SEGMENT IS NOT SHADOWED BY A PARAMETERISED SIBLING ***', () => {
    // ===================================================================================
    // `GET /templates/count` IS REACHABLE TODAY ONLY BECAUSE `count` IS FIVE CHARACTERS
    // AND THE ID GRAMMAR REQUIRES EIGHT.
    // ===================================================================================
    //
    // `core-agent` found this and guards it at module load in Core by asserting ORDER — literals
    // declared before their parameterised siblings — **deliberately NOT by asserting that no
    // literal matches the id grammar**, because that would couple the guard to the very constant
    // whose future relaxation is the hazard: green on the day it landed, red on nothing.
    //
    // *** THIS IS THE SECOND LAYER, AND IT ASSERTS THE OUTCOME RATHER THAN THE ORDER. *** A
    // module-load guard in Core proves the table is arranged correctly. This proves the arrangement
    // still produces the right answer — and it would go red on a shadowing that arrived by any
    // route the order check does not model. Two anchors, different questions.
    //
    // **What the failure looks like if it ever lands is why this is worth a case: nothing errors.**
    // `/templates/count` becomes a read of a Template with the id `count`, answers `not_found`
    // forever, and the route still exists, still authorizes, and still writes an audit row. It
    // answers plausibly to the wrong question.
    for (const [path, expected] of [
      ['/api/v1/platform/templates/count', 'platform.templates.count'],
      ['/api/v1/platform/organizations/count', 'platform.organizations.count'],
    ] as const) {
      const match = matchPlatformRoute('GET', path);
      assertEqual(`${ISOLATION} ${path} resolves to the COUNT route, not to a read of an id named 'count'`, match?.route.id ?? 'nothing', expected);
      assertEqual(
        'and it carries NO path parameter — a shadowed match would have extracted one',
        JSON.stringify(match?.pathParams ?? {}),
        '{}',
      );
    }
  });

  return suite;
}
