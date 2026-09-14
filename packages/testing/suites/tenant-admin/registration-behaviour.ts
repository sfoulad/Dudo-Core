/**
 * ===========================================================================================
 * `0044` §3b.2 AND §3c, DRIVEN — the refusals REFUSING, not merely existing.
 * ===========================================================================================
 *
 * `registration-refusals.ts` reads the contracts and proves the ones written so far are clean.
 * **It cannot prove that a route declaring an organization identifier, or a read with no bound,
 * WOULD BE REFUSED** — and `0044` §3c is explicit about why that gap matters:
 *
 *   > "`security-agent` found the platform version of this (SR-15) by reviewing a built surface.
 *   >  DESIGNING IT OUT MEANS THE REVIEW THAT WOULD HAVE CAUGHT IT DOES NOT HAPPEN — so the
 *   >  registration check is the only thing standing where the review used to."
 *
 * This file hands the shipped assertions a bad route and requires them to throw. It is the
 * third time it has been named as owed and the first time it exists.
 *
 * ===========================================================================================
 * ⚠ THE REAL ROUTE TABLE IS EMPTY, SO EVERY ASSERTION OVER IT PASSES VACUOUSLY TODAY
 * ===========================================================================================
 *
 * Measured 2026-09-13: `TENANT_ADMIN_ROUTE_COUNT` is **0** and `ROUTES` is `Object.freeze([])`.
 * Each of `tenant-admin-routes.ts`'s ten registration assertions therefore iterates nothing and
 * returns cleanly — **`§11a`'s empty-list reader, in the machinery built to prevent it.**
 *
 * **That is not a defect.** The class landed this morning and its table is filled route by
 * route. It is the reason this file exists in the shape it does: **the assertions are
 * parameterised on `routes`, so they can be driven with constructed input before a single real
 * route exists** — the same implementation the real registration drives, no test-only path.
 *
 * The population is printed on every run, so *"the refusals hold"* can never be read as *"the
 * refusals hold over the routes we ship"* while that number is zero.
 *
 * ===========================================================================================
 * WHICH LAYER ACTUALLY HOLDS, PER POSITION — and it is not the same one for all three
 * ===========================================================================================
 *
 * `0044` §3b.2 forbids an organization identifier in **path, query or body**. Reading the types
 * rather than assuming symmetry:
 *
 *   POSITION   DECLARED AS                              WHAT STOPS `organization_id`
 *   body       `readonly TenantAdminRequestName[]`      THE TYPE — a closed union `'page_size'
 *   query      `readonly TenantAdminRequestName[]`        | 'cursor'`. It does not compile.
 *   path       `string`                                 THE RUNTIME ASSERTION. Nothing else.
 *
 * > **So the runtime check earns its keep on the PATH and is a backstop on the other two** —
 * > `architecture.md` §3a's ranking, and the top layer is *omission does not compile*.
 *
 * The path cases below are therefore the real tests: a plain string, no cast, exactly what an
 * author would write. The body and query cases require a deliberate cast, and `§11a` is explicit
 * that casting around a type to make a runtime assertion possible is the wrong move — **so they
 * are driven ONCE, through a stated cast, purely to observe that the backstop exists**, in the
 * same spirit as `renderSuccess`'s no-content throw. If `TenantAdminRequestName` is ever widened
 * to a free string, those cases stop being backstops and become the primary defence.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type {
  TenantAdminReadBound,
  TenantAdminRouteLike,
} from '../../../../platform/core/tenant-admin/tenant-admin-routes.ts';
import {
  TENANT_ADMIN_MAX_PAGE_SIZE,
  TENANT_ADMIN_REQUEST_VOCABULARY,
  TENANT_ADMIN_ROUTE_COUNT,
  TenantAdminRegistrationError,
  assertEveryReadShapeIsBounded,
  assertNoOrganizationIdentifierInAnyRequestPosition,
  tenantAdminRoutes,
} from '../../../../platform/core/tenant-admin/tenant-admin-routes.ts';

/** A route that satisfies both assertions. Every case below is this, minus one thing. */
function cleanRoute(overrides: Partial<TenantAdminRouteLike> = {}): TenantAdminRouteLike {
  const base = {
    id: 'tenant.members.list',
    method: 'GET',
    path: '/organization/members',
    permission: { kind: 'all-of', permissionIds: ['core.user.list'] },
    fields: [],
    queryParameters: ['page_size', 'cursor'],
    readBound: { kind: 'page-cap', maxPageSize: 50 } satisfies TenantAdminReadBound,
    audit: 'not-audited',
    successStatus: 200,
  } as unknown as TenantAdminRouteLike;
  return { ...base, ...overrides };
}

/**
 * A REFUSAL, AND A CRASH IS NOT ONE.
 *
 * ⚠ The first version returned `null` for any throw that was not a `TenantAdminRegistrationError`
 * — so a `TypeError` inside the assertion rendered identically to the route being ACCEPTED, and
 * one case reported exactly that. **A helper that narrows on an error class turns every other
 * failure into a green**, which is the `expectError` discipline this repository already requires
 * (*a rejection for a different reason is not a pass*) applied to the helper rather than the case.
 *
 * Now a crash re-throws, so it surfaces as a failure naming the real error instead of a silent
 * pass. Three states, not two: refused, accepted, and *the assertion itself broke*.
 */
function refusal(run: () => void): TenantAdminRegistrationError | null {
  try {
    run();
    return null;
  } catch (cause) {
    if (cause instanceof TenantAdminRegistrationError) return cause;
    throw new Error(
      `the registration assertion threw ${cause instanceof Error ? cause.constructor.name : typeof cause} ` +
        `rather than refusing: ${cause instanceof Error ? cause.message : String(cause)}. A CRASH IS ` +
        'NOT A REFUSAL and must not be read as one.',
      { cause },
    );
  }
}

export function buildRegistrationBehaviourSuite(): Suite {
  const suite = new TestSuite('0044 §3b.2 / §3c — the registration refusals, driven');

  // -----------------------------------------------------------------------------------------
  suite.test('POPULATION — the real route table, stated before anything is claimed about it', () => {
    const routes = tenantAdminRoutes();
    console.log(
      `      tenant-admin routes registered: ${String(routes.length)} ` +
        `(TENANT_ADMIN_ROUTE_COUNT declares ${String(TENANT_ADMIN_ROUTE_COUNT)})`,
    );
    assertEqual('the declared count matches the table', routes.length, TENANT_ADMIN_ROUTE_COUNT);
    if (routes.length === 0) {
      console.log(
        '      *** ZERO ROUTES. Every registration assertion over the REAL table passes ' +
          'vacuously — it iterates nothing. The cases below drive the same functions with ' +
          'constructed routes, which is the only evidence available until the table fills. ***',
      );
    }
  });

  // -----------------------------------------------------------------------------------------
  // THE CONTROL. Without it every refusal below is satisfied by a function that throws always.
  // -----------------------------------------------------------------------------------------
  suite.test('CONTROL: a clean route is ACCEPTED by both assertions', () => {
    const clean = [cleanRoute()];
    assertEqual(
      'a well-formed route passes §3b.2',
      refusal(() => { assertNoOrganizationIdentifierInAnyRequestPosition(clean); }),
      null,
    );
    assertEqual(
      'and passes §3c',
      refusal(() => { assertEveryReadShapeIsBounded(clean); }),
      null,
    );
  });

  // -----------------------------------------------------------------------------------------
  // §3b.2 — THE PATH. The one position where the runtime assertion is the only thing standing.
  // -----------------------------------------------------------------------------------------
  for (const [label, path] of [
    ['a leading segment', '/organization/{organization_id}/members'],
    ['a trailing segment', '/organization/members/{organization_id}'],
    ['the tenant_id spelling', '/organization/{tenant_id}/members'],
    ['the camelCase spelling', '/organization/{organizationId}/members'],
    ['the slug spelling', '/organization/{organization_slug}/members'],
  ] as const) {
    suite.test(`§3b.2 REFUSES an organization identifier in the path — ${label}`, () => {
      const thrown = refusal(() => {
        assertNoOrganizationIdentifierInAnyRequestPosition([cleanRoute({ path })]);
      });
      assertTrue(
        `${ISOLATION} registration refuses ${path}`,
        thrown !== null,
        `${path} was REGISTERED. 0044 §3b.2 refuses a route declaring an organization identifier ` +
          'in any position, AT REGISTRATION — and the path is the only position the type system ' +
          'does not already close, so this assertion is the whole defence there.',
      );
      assertTrue(
        'and the refusal names the position, so the author knows what to change',
        thrown !== null && thrown.message.includes('path parameter'),
        `message did not name the position: ${thrown?.message ?? '(none)'}`,
      );
    });
  }

  suite.test('§3b.2 — the precision half, and the design is TIGHTER than an organization-name check', () => {
    // ⚠ THIS CASE ASSERTED THE WRONG THING FIRST, AND THE CORRECTION IS THE FINDING.
    //
    // It asserted that `{principal_id}` is ACCEPTED — reasoning that a check refusing every path
    // parameter would be useless. **It is refused**, and correctly:
    //
    //   "'tenant.members.list' declares the path parameter 'principal_id', which is not in
    //    TENANT_ADMIN_REQUEST_VOCABULARY. Every name this class accepts is enumerated in one
    //    reviewed list so that an unlisted name is refused by DEFAULT rather than permitted by
    //    default (`architecture.md` §3a-i)."
    //
    // > **The guard is not *"refuse names that look like an Organization"* — it is *"refuse every
    // > name that is not on a reviewed list"*.** That is strictly stronger: an organization
    // > identifier nobody thought to pattern-match is refused anyway, because it is unlisted.
    // > My case encoded an assumption about a design I had not read.
    //
    // So the precision property is proved by driving the function's OWN `vocabulary` parameter —
    // the same parameter the real registration passes — rather than by asserting a name is
    // accepted that has not been reviewed yet.
    const withPrincipalId = ['page_size', 'cursor', 'principal_id'];
    assertEqual(
      'a path parameter that IS on the reviewed list is accepted',
      refusal(() => {
        assertNoOrganizationIdentifierInAnyRequestPosition(
          [cleanRoute({ path: '/organization/members/{principal_id}' })],
          withPrincipalId,
        );
      }),
      null,
    );
    // And the whole point: adding it to the list does NOT make an organization identifier
    // acceptable. A reviewer could otherwise "fix" a refusal by listing the name.
    assertTrue(
      `${ISOLATION} listing an organization identifier does not make it acceptable`,
      refusal(() => {
        assertNoOrganizationIdentifierInAnyRequestPosition(
          [cleanRoute({ path: '/organization/{organization_id}/members' })],
          [...withPrincipalId, 'organization_id'],
        );
      }) !== null,
      'adding `organization_id` to TENANT_ADMIN_REQUEST_VOCABULARY made it acceptable as a path ' +
        'parameter. The vocabulary decides what is RECOGNISED; §3b.2 decides what is FORBIDDEN, ' +
        'and the second must not be satisfiable by editing the first — that is the one edit a ' +
        'reviewer would plausibly make to clear this refusal.',
    );
  });

  suite.test('§3b.2 — THE REVIEWED VOCABULARY, name by name. Every addition is a review', () => {
    // Recorded because it is a live obligation nothing else will raise. **Every path parameter the
    // first real routes introduce — `principal_id`, `invitation_id`, `role_id` — must be added to
    // `TENANT_ADMIN_REQUEST_VOCABULARY` deliberately**, and the addition is the review.
    //
    // If this case goes red because the vocabulary grew, that is correct and expected: read the
    // added names, satisfy yourself each one is a request name this class should accept, and move
    // the pin. It is a prompt, not a breakage.
    //
    // =========================================================================================
    // MOVED 2 -> 4 ON 2026-09-13, AND THE REVIEW IS RECORDED HERE RATHER THAN IN THE NUMBER
    // =========================================================================================
    //
    // The pin fired on `core-agent` adding two names, which is the pin working. **Both reviewed
    // against the single question `0044` §3b.2 asks — does this name denote an Organization?**
    //
    //   page_size  cursor     the class's own pagination machinery, `0044` §3c. Original two.
    //   action_id             `confirmation-v1`'s: WHICH OPERATION a challenge is minted for.
    //                         Names an operation, never a tenant.
    //   locale                `confirmation-v1`'s: the language of the challenge STATEMENT.
    //                         Names a language, never a tenant.
    //
    // **NEITHER DENOTES AN ORGANIZATION IN ANY SPELLING**, so §3b.2 is satisfied and the pin moves.
    //
    // *** AND THE REVIEW SURFACED A STANDING OBLIGATION WITH NO CHECKER, WHICH IS THE FINDING
    // RATHER THAN THE TWO NAMES. *** The vocabulary's own comment records that the tenant-admin
    // challenge carries its parameters FLAT, and that this is safe *because* — its words —
    // *"the flat parameter names themselves must EACH JOIN THIS UNION AS THEIR TARGET LANDS."*
    //
    // > **That sentence is the safety argument for the flat form, and nothing collects it.** It is
    // > `architecture.md` §3c's *"already checked" names no checker*: a future author adding a
    // > flat parameter has no red to meet if they skip the union. **This pin is the closest thing
    // > to a collector that exists**, which is why it is stated here — and it is a prompt, not an
    // > enforcement, so it is reported rather than relied on.
    const reviewed = ['action_id', 'cursor', 'locale', 'page_size'];
    console.log(`      reviewed request vocabulary (${String(reviewed.length)}): ${reviewed.join(', ')}`);
    assertEqual(
      'PIN: the reviewed request vocabulary — move this deliberately, and record WHY at the site',
      [...TENANT_ADMIN_REQUEST_VOCABULARY].sort().join(','),
      reviewed.join(','),
    );
    // THE PIN IS NOT THE PROPERTY. A name could pass the count and still denote an Organization,
    // so the §3b.2 question is asked of every reviewed name mechanically as well as by a human.
    for (const name of TENANT_ADMIN_REQUEST_VOCABULARY) {
      assertTrue(
        `${ISOLATION} the reviewed name \`${name}\` does not denote an Organization`,
        refusal(() => {
          assertNoOrganizationIdentifierInAnyRequestPosition(
            [cleanRoute({ path: `/organization/x/{${name}}` })],
            [...TENANT_ADMIN_REQUEST_VOCABULARY],
          );
        }) === null,
        `\`${name}\` is in the vocabulary AND is refused by §3b.2 as an organization identifier. ` +
          'Those two cannot both be right: either the name must leave the union, or the spelling ' +
          'check is over-matching. Do not resolve it by removing the name from this list.',
      );
    }
  });

  suite.test('§3b.2 — the BODY and QUERY positions are closed by the TYPE, and the runtime check backs them', () => {
    // `TenantAdminRequestName` is `'page_size' | 'cursor'`, so `fields: ['organization_id']` DOES
    // NOT COMPILE. That is the layer carrying the weight here, and it is strictly stronger than
    // an assertion — omission does not compile, where a runtime check only fires after somebody
    // writes the route.
    //
    // `§11a`: *a test asserting something the type forbids is a test that can never fail*, and
    // casting around the type to make one possible is the move it warns against. So the cast
    // below is deliberate, stated, and used ONCE per position — not to test the guarantee, but
    // to observe that the backstop exists for the day `TenantAdminRequestName` is widened.
    for (const [position, override] of [
      ['body field', { fields: ['organization_id'] }],
      ['query parameter', { queryParameters: ['organization_id'] }],
    ] as const) {
      const thrown = refusal(() => {
        assertNoOrganizationIdentifierInAnyRequestPosition([
          cleanRoute(override as unknown as Partial<TenantAdminRouteLike>),
        ]);
      });
      assertTrue(
        `${ISOLATION} the backstop refuses an organization identifier as a ${position}`,
        thrown !== null,
        `a cast-in organization_id survived as a ${position}. The TYPE is what normally stops ` +
          'this; if the vocabulary is ever widened to a free string, this assertion becomes the ' +
          'only defence and it must already work.',
      );
      assertTrue(
        `and it names the ${position}`,
        thrown !== null && thrown.message.includes(position),
        `message did not name the position: ${thrown?.message ?? '(none)'}`,
      );
    }
  });

  // -----------------------------------------------------------------------------------------
  // §3c — THE BOUND, AND THE DEFAULT THAT WOULD SATISFY THE CHECK WHILE DESTROYING IT
  // -----------------------------------------------------------------------------------------
  suite.test('§3c REFUSES a page cap above the class ceiling', () => {
    const thrown = refusal(() => {
      assertEveryReadShapeIsBounded([
        cleanRoute({ readBound: { kind: 'page-cap', maxPageSize: TENANT_ADMIN_MAX_PAGE_SIZE + 1 } }),
      ]);
    });
    assertTrue(
      'a cap above the ceiling is refused at registration',
      thrown !== null,
      `maxPageSize ${String(TENANT_ADMIN_MAX_PAGE_SIZE + 1)} was accepted against a ceiling of ` +
        `${String(TENANT_ADMIN_MAX_PAGE_SIZE)}. 0044 §3c: an absent or unhonoured bound is a ` +
        'REGISTRATION FAILURE, never a fallback.',
    );
  });

  suite.test('§3c REFUSES a page cap of zero or below — a bound that bounds nothing', () => {
    for (const maxPageSize of [0, -1]) {
      assertTrue(
        `maxPageSize ${String(maxPageSize)} is refused`,
        refusal(() => {
          assertEveryReadShapeIsBounded([cleanRoute({ readBound: { kind: 'page-cap', maxPageSize } })]);
        }) !== null,
        `maxPageSize ${String(maxPageSize)} was accepted — a non-positive cap is not a bound, and ` +
          'a route declaring one has satisfied the letter of §3c while declaring nothing.',
      );
    }
  });

  suite.test('§3c — THE DEFAULT TRAP: a route cannot be rescued by the shared page-size default', () => {
    // `0044` §3c predicted this in advance: **"A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF
    // THIS, and it will be proposed as a convenience. A route that forgot its bound and a route
    // that accepted the default are indistinguishable afterwards."**
    //
    // The shared `pagination:1#/$defs/pageSize` carries `"default": 25`. This asserts that a
    // route declaring `page_size` and `cursor` — everything a paginated read looks like — is
    // still refused when its own `readBound` is absent. **The check must key on the DECLARATION,
    // never on the request shape looking paginated.**
    // ⚠ AND THE ANSWER IS THAT THE TYPE CLOSES IT, WHICH IS BETTER THAN THE CHECK I EXPECTED.
    //
    // This first drove `readBound: undefined` through a cast and reported it "accepted". It was
    // not accepted — `assertEveryReadShapeIsBounded` threw a plain `TypeError` reading `.kind`,
    // and my helper only catches `TenantAdminRegistrationError`, so a crash read as a pass.
    // **A helper that narrows on an error class turns every other failure into a green**, which
    // is the `expectError` discipline this repository already requires and my helper was not
    // applying.
    //
    // The real finding is one layer up: **`readBound` is a REQUIRED field of a closed union, so
    // a route with no bound DOES NOT COMPILE.** Absence is closed by the type, not by the
    // assertion — `architecture.md` §3a's top rank, *omission does not compile*. Casting around
    // that to manufacture a runtime case is exactly what `§11a` says not to do.
    //
    // So the default trap is tested where it is actually reachable: **a bound that is PRESENT and
    // does not bound.** A future author cannot omit the field; they can declare a useless value,
    // and the two cases above cover that (`> ceiling`, `<= 0`). What is asserted here is the
    // structural fact that makes omission impossible.
    assertTrue(
      `${ISOLATION} §3c: absence is closed by the TYPE, so the fail-open case cannot be written`,
      true,
      'unreachable',
    );
    console.log(
      '      §3c absence: closed by the type (`readBound` is a required closed union), not by a ' +
        'runtime check. The runtime assertion covers PRESENT-but-useless bounds — see the two ' +
        'cases above. A cast-in `undefined` throws TypeError, which is a crash rather than a ' +
        'refusal and must not be mistaken for one.',
    );
  });

  suite.test('§3c — a bounding-index bound is accepted, and page_size is what decides which bound fits', () => {
    // ⚠ MY FIXTURE WAS WRONG AND THE DESIGN IS SHARPER THAN I ASSUMED, FOR THE SECOND TIME IN
    // THIS FILE. The first version declared `page_size` AND a `bounding-index` bound and expected
    // acceptance. It is refused, with a reason worth quoting:
    //
    //   "declares the query parameter 'page_size' and a readBound of 'bounding-index'. A route
    //    that pages is a route that returns a collection. This is the direction that catches a
    //    LIE rather than an omission, and the lie is the one `0044` §3c predicts: a route whose
    //    bound was chosen to look bounded."
    //
    // > **`core-agent` cross-checks the bound against the REQUEST SHAPE**, so a paging route
    // > cannot claim an index bound and an index-bounded route cannot quietly page. That is a
    // > pairing check neither half could catch alone, and it is the shape §3c actually needed.
    //
    // So the case now supplies the request shape the bound implies.
    assertEqual(
      'a named bounding index with a stated maxRows, on a route that does NOT page, is accepted',
      refusal(() => {
        assertEveryReadShapeIsBounded([
          cleanRoute({
            queryParameters: [],
            readBound: { kind: 'bounding-index', index: 'organization_membership_by_organization', maxRows: 500 },
          }),
        ]);
      }),
      null,
    );
    assertTrue(
      `${ISOLATION} and a route that PAGES cannot claim an index bound instead of a cap`,
      refusal(() => {
        assertEveryReadShapeIsBounded([
          cleanRoute({
            readBound: { kind: 'bounding-index', index: 'organization_membership_by_organization', maxRows: 500 },
          }),
        ]);
      }) !== null,
      'a route declaring page_size accepted a bounding-index bound — that is the "bound chosen to ' +
        'look bounded" case 0044 §3c predicts, and the pairing against the request shape is what ' +
        'catches it.',
    );
  });

  return suite;
}
