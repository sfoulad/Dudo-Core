/**
 * ===========================================================================================
 * THE AUDIT FEEDS' INPUT VALIDATION, AND THE PERMISSION-IN-NO-ROLE STATE.
 * `platform-audit-read-v1` · `docs/decisions/0028` · `docs/decisions/0007`.
 * ===========================================================================================
 *
 * Two properties that have nothing to do with each other except that both are invisible when
 * things are working:
 *
 *   - a `since` or `until` with NO TIME ZONE, silently interpreted;
 *   - a permission that sits in the class's ceiling and in no role's floor.
 *
 * Neither produces an error. The first produces DIFFERENT RECORDS depending on where the Worker
 * ran; the second produces `forbidden` for every operator on a route that is registered, composed
 * and correct.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  ORG_ALPHA,
  SESSION_ADMIN,
  createPlatformWorld,
  expectedInvalidArgument,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import {
  PLATFORM_PERMISSION_ENVELOPE,
  PLATFORM_ROLES,
  PlatformPermissionModelIncoherentError,
  assertPlatformPermissionModelIsCoherent,
  grantsForPlatformRole,
} from '../../../../platform/core/platform/platform-permissions.ts';
import type { PlatformRole } from '../../../../platform/core/platform/platform-permissions.ts';

// =============================================================================================
// ITEM 3 — RFC 3339. The one that matters is the form with no zone.
// =============================================================================================

export function buildAuditInstantSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Audit feeds — `since` and `until` are RFC 3339 UTC, or refused');

  /**
   * ===========================================================================================
   * THE NO-ZONE FORM IS FIRST BECAUSE IT IS THE DANGEROUS ONE, AND IT IS DANGEROUS FOR A REASON
   * THAT HAS NOTHING TO DO WITH BEING MALFORMED.
   * ===========================================================================================
   *
   * `2026-09-01T00:00:00` is a perfectly well-formed timestamp. It is simply **ambiguous**: some
   * engines read a zoneless instant as local time and some as UTC. `Date.parse` in a V8 isolate
   * treats a date-time with no zone as LOCAL — so the same request selects a different set of
   * audit records depending on where the Worker happened to run, and **nothing anywhere reports
   * a difference**. An operator comparing two exports would see two answers to one question.
   *
   * The other five are ordinary malformations and are refused for ordinary reasons. This one
   * would be accepted by any implementation that reached for `Date.parse` first, which is exactly
   * what a reasonable author does.
   */
  const REFUSED: readonly { readonly value: string; readonly why: string }[] = Object.freeze([
    {
      value: '2026-09-01T00:00:00',
      why: 'NO ZONE — the one that matters. Well-formed, ambiguous, and read as LOCAL by V8',
    },
    {
      value: '2026-09-01T00:00:00+03:00',
      why: 'an OFFSET rather than Z. A legal RFC 3339 instant, and the column stores UTC — ' +
        'accepting it would compare an offset string against a Z string lexically',
    },
    { value: '2026-09-01', why: 'a date with no time' },
    { value: '2026-09-01 00:00:00Z', why: 'a space instead of T' },
    { value: 'yesterday', why: 'free text' },
    { value: '', why: 'present but empty, which is not the same as absent' },
    {
      value: '2026-02-31T00:00:00Z',
      why: 'THE REALITY CHECK. Correctly SHAPED and not a real date — the pattern alone passes ' +
        'it, and only the round-trip comparison catches it',
    },
  ]);

  for (const parameter of ['since', 'until'] as const) {
    for (const entry of REFUSED) {
      suite.test(
        `\`${parameter}=${entry.value === '' ? '(empty)' : entry.value}\` is refused — ${entry.why}`,
        async () => {
          const world = await make();
          try {
            expectError(
              `${ISOLATION} it is refused as an argument error, naming the parameter`,
              await world.call('platform.audit.list', {
                sessionId: SESSION_ADMIN,
                queryString: `${parameter}=${encodeURIComponent(entry.value)}`,
              }),
              expectedInvalidArgument(parameter, 'must_be_an_rfc3339_utc_instant'),
            );
          } finally {
            world.close();
          }
        },
      );
    }
  }

  suite.test('the no-zone form is REFUSED rather than silently interpreted — asserted directly', async () => {
    // =====================================================================================
    // THE CONSTRUCTED DEMONSTRATION, because "it is refused" does not show what was avoided.
    // =====================================================================================
    //
    // This proves the value really is ambiguous in this runtime, so the refusal above is closing
    // a live hazard rather than being pedantic about a format. If these two ever agree, the
    // hazard has gone away and the case should say so instead of implying one that does not exist.
    const zoneless = Date.parse('2026-09-01T00:00:00');
    const utc = Date.parse('2026-09-01T00:00:00Z');
    assertTrue(
      'the zoneless form and the UTC form really do parse to different instants here',
      zoneless !== utc,
      'this runtime reads a zoneless instant as UTC, so the ambiguity this refusal protects ' +
        'against does not arise in it — the refusal is still correct for OTHER runtimes, and ' +
        'this control should be rewritten to say that rather than deleted',
    );

    // AND THE POSITIVE CONTROL. The SAME instant WITH the zone is accepted, so the refusal is
    // about the zone and not about the date being unusable.
    const world = await make();
    try {
      expectOk(
        'the identical instant WITH `Z` is accepted',
        await world.call('platform.audit.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'since=2026-09-01T00:00:00Z',
        }),
      );
      expectOk(
        'and the millisecond form is accepted too',
        await world.call('platform.audit.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'since=2026-09-01T00:00:00.000Z',
        }),
      );
    } finally {
      world.close();
    }
  });

  suite.test('an empty window is refused rather than answered with nothing', async () => {
    // `since >= until` selects no records, and "no records" on an audit feed is a statement a
    // caller may act on. It must mean "nothing happened", never "you asked incoherently".
    const world = await make();
    try {
      expectError(
        `${ISOLATION} an incoherent window is an argument error, not an empty page`,
        await world.call('platform.audit.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'since=2026-09-02T00:00:00Z&until=2026-09-01T00:00:00Z',
        }),
        expectedInvalidArgument('until', 'must_be_after_since'),
      );
      // EQUAL BOUNDS TOO. `since === until` also selects nothing.
      expectError(
        'and an empty window with equal bounds is refused the same way',
        await world.call('platform.audit.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'since=2026-09-01T00:00:00Z&until=2026-09-01T00:00:00Z',
        }),
        expectedInvalidArgument('until', 'must_be_after_since'),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}

// =============================================================================================
// ITEM 4 — A PERMISSION IN THE CEILING AND IN NO FLOOR.
// =============================================================================================

/**
 * ===========================================================================================
 * THE CHECK, AS A PURE FUNCTION OVER (envelope, roles, routes), SO IT CAN BE FED A BROKEN WORLD.
 * ===========================================================================================
 *
 * `core-agent` hit this state and caught it by PRINTING the reachable set and reading it: moving a
 * permission out of `HELD_BUT_UNREACHABLE` also removed it from the role, because the role list
 * spreads that constant. The permission sat in the envelope and in no role, both feeds answered
 * `forbidden` to every operator, **nothing failed to compile and no guard fired.**
 *
 * ===========================================================================================
 * *** CAN "IN THE CEILING BECAUSE ITS ROUTE DOES NOT EXIST YET" BE SEPARATED FROM "IN THE
 * CEILING AND ACCIDENTALLY IN NO ROLE"? YES, AND WITHOUT A HAND-MAINTAINED LIST. ***
 * ===========================================================================================
 *
 * The Team Lead's framing was that the two are indistinguishable. **They are not**, and the reason
 * is a property of this model rather than of this test: **the envelope tracks ROUTES, not
 * intentions.** `PLATFORM_ROUTE_PERMISSION_COUNT` is named for exactly that, and
 * `assertPlatformPermissionModelIsCoherent` REFUSES an envelope entry that is also in
 * `HELD_BUT_UNREACHABLE`. So the four states are distinct and the distinction is computable:
 *
 * | in a role | in the envelope | means |
 * |---|---|---|
 * | yes | no  | **the route does not exist yet.** This is `HELD_BUT_UNREACHABLE`, and it is where "not built" is expressed |
 * | yes | yes | built and usable |
 * | **no** | **yes** | **THE DEFECT.** A route exists, is composed, and every operator is refused |
 * | no | no | not a platform permission at all |
 *
 * **"Its route does not exist yet" is NOT in the envelope** — that is the whole function of the
 * `HELD_BUT_UNREACHABLE` overlap check. So an envelope entry in no role is unambiguous, and needs
 * no list of exceptions: there is no legitimate reason for one to exist.
 *
 * `0027` forbids a hand-maintained opt-out for the confirmation case, and the Team Lead would
 * forbid one here for the same reason. **None is needed.** If the model ever changed so that the
 * envelope could legitimately contain a permission no route declares, `envelopeMatchesRoutes`
 * below goes red first and says so — which is the honest failure, rather than this check quietly
 * becoming approximate.
 */
export function permissionsInCeilingWithNoFloor(
  envelope: readonly { readonly permissionId: string }[],
  roles: readonly PlatformRole[],
  grantsFor: (role: PlatformRole) => readonly { readonly permissionId: string }[],
): readonly string[] {
  const granted = new Set<string>();
  for (const role of roles) {
    for (const grant of grantsFor(role)) {
      granted.add(grant.permissionId);
    }
  }
  return envelope
    .map((declaration) => declaration.permissionId)
    .filter((permissionId) => !granted.has(permissionId));
}

export function buildCeilingFloorSuite(): Suite {
  const suite = new Suite('Platform — no permission sits in the ceiling with nothing under it');

  suite.test('EVERY permission in the envelope is granted by at least one platform role', () => {
    // THE DEFECT STATE, ASSERTED DIRECTLY. A permission here means a route that is registered,
    // composed, correct, and refused to every operator alive — with no compile error and no guard.
    const orphaned = permissionsInCeilingWithNoFloor(
      PLATFORM_PERMISSION_ENVELOPE.declared,
      PLATFORM_ROLES,
      (role) => grantsForPlatformRole(role).grants,
    );
    assertEqual(
      `${ISOLATION} no permission is in the class's ceiling and in no role's floor`,
      orphaned.join(','),
      '',
    );
  });

  suite.test(
    'THE CONSTRUCTED FAILING INPUT: the check reports a permission that is in no role',
    () => {
      // =====================================================================================
      // WITHOUT THIS, THE CASE ABOVE IS SOUND-BY-ACCIDENT AND SOUND-BY-DESIGN ARE IDENTICAL.
      // =====================================================================================
      //
      // `workflow.md` §11a: *"constructing the input the check should fail on is the only thing
      // that distinguishes sound-by-design from sound-by-accident, because both look identical
      // while passing."* The check above is a set difference — a bug that computed the difference
      // the wrong way round, or against an empty set, would print green forever.
      //
      // So it is run over a DELIBERATELY BROKEN pair: the real envelope, and a role mapping with
      // one permission removed — which is exactly the shape of the defect `core-agent` hit, where
      // a permission left the role list as a side effect of leaving `HELD_BUT_UNREACHABLE`.
      const removed = 'core.platform-audit.read';
      assertTrue(
        'the permission being removed really is in the envelope, so the mutation is meaningful',
        PLATFORM_PERMISSION_ENVELOPE.declared.some((d) => d.permissionId === removed),
        `${removed} is not in the envelope; pick one that is, or this control mutates nothing`,
      );

      const brokenGrants = (role: PlatformRole) =>
        grantsForPlatformRole(role).grants.filter((grant) => grant.permissionId !== removed);
      const found = permissionsInCeilingWithNoFloor(
        PLATFORM_PERMISSION_ENVELOPE.declared,
        PLATFORM_ROLES,
        brokenGrants,
      );
      assertEqual(
        'the check names exactly the permission that was orphaned',
        found.join(','),
        removed,
      );
    },
  );

  suite.test(
    'and the separation is real: the envelope is exactly what the ROUTES declare',
    () => {
      // =====================================================================================
      // THIS IS WHAT MAKES THE CASE ABOVE UNAMBIGUOUS, AND IT IS THE HALF WORTH ARGUING ABOUT.
      // =====================================================================================
      //
      // "In the envelope and in no role" is only a defect if the envelope means "a route
      // evaluates this". If the envelope could legitimately hold a permission whose route is not
      // built, the two states WOULD be indistinguishable and the check above would need a list of
      // exceptions — which is what `0027` forbids for the confirmation case.
      //
      // It cannot. This asserts it rather than relying on the constant's name: the envelope's
      // permission set equals the set the shipped route table declares. "Not built yet" lives in
      // `HELD_BUT_UNREACHABLE`, which the load-time guard forbids from overlapping the envelope.
      const declaredByRoutes = new Set<string>();
      for (const route of platformRoutes()) {
        if (route.permission.kind === 'fixed') {
          declaredByRoutes.add(route.permission.permissionId);
        }
      }
      const inEnvelope = new Set(
        PLATFORM_PERMISSION_ENVELOPE.declared.map((d) => d.permissionId),
      );
      assertTrue(
        'there are routes and envelope entries to compare',
        declaredByRoutes.size > 0 && inEnvelope.size > 0,
        'one side is empty, so this comparison would be vacuous',
      );
      assertEqual(
        `${ISOLATION} every permission a route declares is in the envelope`,
        [...declaredByRoutes].filter((p) => !inEnvelope.has(p)).sort().join(','),
        '',
      );
      assertEqual(
        'and the envelope declares nothing no route evaluates — which is why an envelope entry ' +
          'in no role is unambiguously a defect rather than a pending route',
        [...inEnvelope].filter((p) => !declaredByRoutes.has(p)).sort().join(','),
        '',
      );
    },
  );

  suite.test('the envelope is SEVEN, and an eighth still throws at module load', () => {
    assertEqual(
      'seven, as PLATFORM_ROUTE_PERMISSION_COUNT states',
      PLATFORM_PERMISSION_ENVELOPE.declared.length,
      7,
    );
    // AND THE GUARD STILL BITES. The count is only a control if adding one is refused; asserting
    // the number alone would pass with the guard deleted.
    const eighth = {
      ...PLATFORM_PERMISSION_ENVELOPE,
      declared: Object.freeze([
        ...PLATFORM_PERMISSION_ENVELOPE.declared,
        Object.freeze({ permissionId: 'core.eighth.permission', scope: 'platform' as const }),
      ]),
    };
    let thrown: unknown = null;
    try {
      assertPlatformPermissionModelIsCoherent(undefined, eighth);
    } catch (cause) {
      thrown = cause;
    }
    assertTrue(
      `${ISOLATION} an eighth permission in the envelope stops the build`,
      thrown instanceof PlatformPermissionModelIncoherentError,
      `the class's ceiling was widened by one and nothing refused: ${String(thrown)}`,
    );
  });

  suite.test('a role that is reachable is actually usable end to end', async () => {
    // THE PROPERTY THE CHECKS ABOVE ARE PROXIES FOR, driven through the real dispatcher. A
    // permission in the ceiling and in the floor should produce a route a real operator can call
    // — and this is the case that would have gone red on the defect `core-agent` hit, where both
    // feeds answered `forbidden` to every operator.
    const world = await createPlatformWorld();
    try {
      expectOk(
        'a platform-admin can read the platform feed',
        await world.call('platform.audit.list', { sessionId: SESSION_ADMIN }),
      );
      expectOk(
        "and an Organization's feed",
        await world.call('platform.organizations.audit.list', {
          sessionId: SESSION_ADMIN,
          pathParams: { organization_id: ORG_ALPHA },
        }),
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
