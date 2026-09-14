/**
 * ===========================================================================================
 * WHERE A PRINCIPAL'S PERMISSION GRANTS COME FROM. `docs/decisions/0019`.
 * ===========================================================================================
 *
 * `0019` puts the grant on the membership row as a `role`, and makes Core the only authority for
 * the role-to-permission mapping. `0007`'s ten rules constrain what that mapping may look like,
 * and three of them are where a role would otherwise smuggle authority back in:
 *
 *   rule 3   no wildcards
 *   rule 4   explicit registration
 *   deny by default — an unrecognised role is not a partial grant, it is nothing
 *
 * ===========================================================================================
 * THIS SUITE ALSO PINS WHAT `0019` DOES **NOT** DELIVER, AND THAT IS HALF ITS VALUE
 * ===========================================================================================
 *
 * `0019` originally claimed to be *"the last thing between a deployed Dudo and a working business
 * request."* That claim was struck on 2026-09-04 because it is wrong: `0019` closes the **grants**
 * half of AZ5 and not the **`authorizedBusinessIds`** half. A seeded `owner` now signs in, selects
 * its Organization, resolves a tenant store, passes pipeline step 3 with real permissions — and
 * still fails every Customer Directory Action at step 5, because the authorized business set is
 * empty and an unfiltered list narrows to nothing.
 *
 * So `theBusinessSetIsStillEmpty` below is not a leftover. It is the boundary between `0019` and
 * `0020` asserted rather than assumed, and it must **fail** when `0020` lands — which is exactly
 * what tells someone the second half arrived.
 */

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import {
  MEMBERSHIP_ROLES,
  RoleMappingIncoherentError,
  assertRoleMappingIsCoherent,
  grantsForRole,
  toMembershipRole,
} from '../../../../platform/core/authorization/roles.ts';
import type { MembershipRole } from '../../../../platform/core/authorization/roles.ts';
import {
  createDenyAllPrincipalAuthorizationSource,
  createMembershipPrincipalAuthorizationSource,
} from '../../../../platform/core/identity/principal-authorization-source.ts';
import { expectOk } from '../../harness/runner.ts';

/**
 * UPDATED 2026-09-05 FOR `docs/decisions/0023`, WHICH ADDED `core.business.read` TO BOTH ROLES.
 *
 * These two cases went red when `0023` landed. They were updated because **the intended set
 * changed**, not to make a test pass — `business-read-v1`'s operations turned out never to have
 * been built, and `0023` created a Core-owned Action with its own permission envelope.
 *
 * THE NEW FACT IS ADDED RATHER THAN THE COUNTS BUMPED, and the properties a count cannot express
 * are untouched and still green: member remains a strict subset of owner, no identifier carries a
 * wildcard, every grant is organization-scoped, and delete and restore-deleted are still granted
 * to nobody. Those are what would have caught a widening dressed up as an update.
 */
const OWNER_EXPECTED = [
  'core.business.read',
  'customers.customer.archive',
  'customers.customer.create',
  'customers.customer.list',
  'customers.customer.move',
  'customers.customer.read',
  'customers.customer.restore',
  'customers.customer.update',
];

const MEMBER_EXPECTED = [
  'core.business.read',
  'customers.customer.list',
  'customers.customer.read',
];

/** `0023`: the first permission that is Core's rather than an App's. */
const CORE_OWNED = 'core.business.read';

/**
 * `0019`: granted to nobody. Permanent deletion and its cancellation are **NOT YET GRANTED, AND
 * STILL NOT GRANTED TODAY** — `0019`'s amendment of 2026-09-08, which replaced *"outside MVP
 * scope"* after `0030` withdrew that framing. The exclusion holds for a better reason than scope:
 * `customers.customer.delete` is one of the *"twelve tenant-scope `critical` permissions that
 * cannot presently be exercised at all"* — the challenge route `confirmation-v1` requires is not
 * built (`0038` F-1) — so **granting it today would produce a role that holds a permission nothing
 * can use.**
 */
const GRANTED_TO_NOBODY = [
  'customers.customer.delete',
  'customers.customer.restore-deleted',
];

function permissionsOf(role: MembershipRole | null): string[] {
  return grantsForRole(role)
    .grants.map((grant) => grant.permissionId)
    .sort();
}

function membershipFor(role: MembershipRole | null) {
  return {
    principalId: 'prn_role_0001',
    organizationId: 'org_role_0001',
    status: 'active' as const,
    role,
  };
}

export function buildRoleGrantsSuite(): Suite {
  const suite = new Suite('AZ5 — role-to-permission mapping (0019)');

  suite.test('the mapping is exactly the four seed roles, and none is a wildcard', () => {
    // Sorted on both sides: the mapping is a SET, and pinning declaration order would make this
    // case fail on a reordering that changes nothing.
    //
    // *** THE PIN MOVED 2026-09-13, FROM `member,owner` TO THE FOUR SEED ROLES. *** `0043` §3a
    // adds `admin` and `business-admin` to `MembershipRole`, and this assertion went red on the
    // change — WHICH IS THE PIN WORKING. A role entering the union is a security decision and
    // must not arrive silently; `0019`'s own argument for two roles rather than one was that a
    // single role lets the mapping degenerate into a constant.
    //
    // IT IS A PIN AND NOT A DERIVATION, DELIBERATELY. Writing `MEMBERSHIP_ROLES.length` on both
    // sides would make this case agree with the union by construction and assert nothing — the
    // fail-open shape `§11a` calls *a constraint that learns from its subject*. Whoever adds a
    // fifth role moves this line, and moving it is the moment to ask what the role may hold.
    assertEqual(
      'four seed roles, no more — move this pin deliberately when 0043 §3 changes',
      [...MEMBERSHIP_ROLES].sort().join(','),
      'admin,business-admin,member,owner',
    );
    assertEqual('owner grants the seven Actions', permissionsOf('owner').join(','), OWNER_EXPECTED.join(','));
    assertEqual('member grants read and list only', permissionsOf('member').join(','), MEMBER_EXPECTED.join(','));
  });

  suite.test('0023 — core.business.read is granted to BOTH roles, and is Core-owned', () => {
    // The new fact, asserted in its own right rather than absorbed into the two lists above.
    // Both roles need it: `member` is read-only and still has to render the business picker,
    // so withholding it there would leave a read-only user unable to see which Business they
    // are looking at.
    for (const role of MEMBERSHIP_ROLES) {
      assertTrue(
        `${role} holds ${CORE_OWNED}`,
        permissionsOf(role).includes(CORE_OWNED),
        `${role} cannot read its own Businesses, so the picker cannot populate for it`,
      );
    }
    // It is the first permission whose first segment is not an App id. That is the whole point of
    // 0023 — Core gained its own permission envelope — so it is asserted rather than assumed.
    assertEqual('its namespace is core, not an App', CORE_OWNED.split('.')[0], 'core');
    assertTrue(
      'and every other granted permission still belongs to an App',
      permissionsOf('owner')
        .filter((permission) => permission !== CORE_OWNED)
        .every((permission) => permission.startsWith('customers.')),
      'a second Core-owned permission appeared without this case being updated',
    );
  });

  suite.test('no granted permission contains a wildcard or a prefix form', () => {
    // `0007` rule 3. A role is the one place a wildcard would be reintroduced, because it looks
    // like a convenience rather than an authority grant.
    for (const role of MEMBERSHIP_ROLES) {
      for (const permission of permissionsOf(role)) {
        assertTrue(
          `${role}: '${permission}' contains no '*'`,
          !permission.includes('*'),
          'a wildcard would silently grant every permission a future App registers under the ' +
            'same prefix',
        );
        assertTrue(
          `${role}: '${permission}' is not blank`,
          permission.trim().length > 0,
          'a blank permission identifier is not an explicit registration',
        );
        assertEqual(
          `${role}: '${permission}' is a fully qualified three-part identifier`,
          permission.split('.').length,
          3,
        );
      }
    }
  });

  suite.test('member is a STRICT subset of owner', () => {
    const owner = new Set(permissionsOf('owner'));
    const member = permissionsOf('member');
    for (const permission of member) {
      assertTrue(
        `member's '${permission}' is also granted to owner`,
        owner.has(permission),
        'member holds a permission owner does not, so the roles are not ordered and "read-only ' +
          'subset" is not what the mapping implements',
      );
    }
    assertTrue(
      'and it is STRICT — member is genuinely smaller',
      member.length < owner.size,
      `member has ${String(member.length)} and owner has ${String(owner.size)}`,
    );
  });

  suite.test('delete and restore-deleted are granted to NOBODY', () => {
    for (const role of MEMBERSHIP_ROLES) {
      const granted = permissionsOf(role);
      for (const forbidden of GRANTED_TO_NOBODY) {
        assertTrue(
          `${role} does not grant '${forbidden}'`,
          !granted.includes(forbidden),
          'permanent deletion is NOT YET GRANTED (`0019`, amended 2026-09-08) and adding it ' +
            'needs a decision, not an edit. It is gated on a `critical` permission nothing can ' +
            'currently exercise, so a grant would hold a permission with no usable path',
        );
      }
    }
  });

  suite.test('an unrecognised, blank, null or undefined role grants NOTHING', () => {
    // Deny by default. Each of these is a value a membership row could hold after a hand-edit, a
    // partially-applied migration, or a future role this build does not know.
    // *** `'admin'` WAS IN THIS LIST UNTIL 2026-09-13 AND IS NOW A REAL ROLE (`0043` §3a). ***
    // The case went red on a correct change, which is the pin working — but it is worth naming
    // what the red meant, because the shape recurs: a test that uses a value as an EXAMPLE OF
    // SOMETHING THAT DOES NOT EXIST is a test with a hidden dependency on that value never being
    // created. `'superuser'` and `'*'` carry the same risk and are kept because both are shapes
    // this repository has ruled against — `0024` invariant 2 forbids a platform-tier value in
    // `MembershipRole`, and `0007` rule 3 forbids a wildcard — so neither can become real
    // without a decision that would also send someone here.
    //
    // `'business-admin'` is deliberately NOT substituted in: it is the other role `0043` §3a
    // adds, and putting it here would rebuild the same trap one migration later.
    for (const value of ['OWNER', 'owner ', '', 'superuser', '*', 'platform-admin', null, undefined]) {
      assertEqual(
        `'${String(value)}' is not a recognised role`,
        toMembershipRole(value),
        null,
      );
    }
    assertEqual('and an absent role grants nothing at all', permissionsOf(null).length, 0);
    // The positive control: the two real values ARE recognised, so the refusals above are not
    // passing because the parser rejects everything.
    assertEqual('owner parses', toMembershipRole('owner'), 'owner');
    assertEqual('member parses', toMembershipRole('member'), 'member');
  });

  suite.test('the shared grant arrays are FROZEN — one request cannot widen another', () => {
    // `grantsForRole` returns the SAME object to every principal in every Organization. If those
    // arrays were mutable, a single handler that pushed onto one would grant that permission to
    // every later request platform-wide, across tenants. This is a cross-tenant escalation with a
    // very quiet shape, and freezing is what makes it impossible rather than merely unlikely.
    for (const role of [...MEMBERSHIP_ROLES, null]) {
      const grants = grantsForRole(role);
      assertTrue(`${String(role)}: the container is frozen`, Object.isFrozen(grants), 'not frozen');
      assertTrue(
        `${String(role)}: the grant array is frozen`,
        Object.isFrozen(grants.grants),
        'the array of grants can be mutated in place',
      );
      for (const grant of grants.grants) {
        assertTrue(
          `${String(role)}: the grant '${grant.permissionId}' is frozen`,
          Object.isFrozen(grant),
          'an individual grant can be rewritten in place, which would change its scope for ' +
            'every later caller',
        );
      }
    }
    // And the mutation genuinely fails rather than silently no-opping into a copy.
    const owner = grantsForRole('owner');
    const before = owner.grants.length;
    try {
      (owner.grants as { push?: (value: unknown) => void }).push?.({
        permissionId: 'customers.customer.delete',
        scope: 'organization',
      });
    } catch {
      // Frozen arrays throw in strict mode, which module code is. Either outcome is acceptable;
      // what matters is the length below.
    }
    assertEqual('a push did not widen the shared owner grant set', grantsForRole('owner').grants.length, before);
    assertEqual('and the length is unchanged for later callers too', owner.grants.length, before);
  });

  suite.test('every grant is at organization scope', () => {
    // A grant narrower than the Action it must satisfy produces a permanently refused Action that
    // looks correctly wired — the hardest kind of misconfiguration to find.
    for (const role of MEMBERSHIP_ROLES) {
      for (const grant of grantsForRole(role).grants) {
        assertEqual(
          `${role}: '${grant.permissionId}' is organization-scoped`,
          grant.scope,
          'organization',
        );
      }
    }
  });

  suite.test('assertRoleMappingIsCoherent() accepts the shipped mapping', () => {
    let thrown: unknown = null;
    try {
      assertRoleMappingIsCoherent();
    } catch (cause) {
      thrown = cause;
    }
    assertTrue(
      'the shipped mapping is coherent',
      thrown === null,
      `the guard rejected the real mapping: ${String(thrown)}`,
    );
  });

  suite.test('assertRoleMappingIsCoherent() THROWS on each of its incoherent inputs', () => {
    // ===========================================================================================
    // THE LAST SKIP ON THE BOARD, CLOSED. Adopted from `core-agent`'s `verify-role-guard.ts`.
    // ===========================================================================================
    //
    // The skip's reason was that the guard took no parameters and read module-level `const`
    // bindings ESM will not let a test rebind. `core-agent` added parameters — and made a design
    // choice worth recording, because it is my own argument applied one level deeper than I
    // stated it:
    //
    // IT TOOK **TWO** PARAMETERS, NOT THE ONE I RECOMMENDED. The mapping alone reaches only the
    // first four branches; the fifth — "an absent or unrecognised role grants something" — reads
    // `grantsForRole(null)`, which is a module constant *exactly as unrebindable as the ones this
    // change existed to escape*. One parameter would have left one branch unreachable, which is
    // the original defect in a smaller form. My recommendation was incomplete and the correction
    // is recorded here rather than silently absorbed.
    //
    // EACH CASE ASSERTS `RoleMappingIncoherentError` SPECIFICALLY. "It threw something" would
    // pass on a TypeError from a typo in the guard, which is the exact failure this is meant to
    // distinguish from a real refusal.

    const throwsIncoherent = (label: string, run: () => void, expectedFragment?: string): void => {
      let thrown: unknown = null;
      try {
        run();
      } catch (cause) {
        thrown = cause;
      }
      assertTrue(`${label}: it throws`, thrown !== null, 'the incoherent mapping was accepted');
      assertTrue(
        `${label}: and it throws RoleMappingIncoherentError, not an incidental error`,
        thrown instanceof RoleMappingIncoherentError,
        `threw ${thrown instanceof Error ? thrown.constructor.name : typeof thrown}`,
      );
      // *** AND IT THROWS FOR THE REASON THE CASE INJECTED. ***
      //
      // Added 2026-09-13, and it is the half that was missing. Asserting the CLASS of error is
      // not asserting WHICH error, and `0043` §3a made that gap live: every base mapping below
      // was `{ owner, member }`, which after the union widened to four roles is an INCOMPLETE
      // `Record<MembershipRole, …>`. The guard iterates `MEMBERSHIP_ROLES`, so it threw
      // *"the role 'admin' maps to no permissions"* — a real `RoleMappingIncoherentError` —
      // **before reaching the wildcard, the blank id, the wrong scope or the excluded permission
      // any of these cases exist to test.**
      //
      // > **Eight negative cases would have gone on passing while testing nothing.** This is the
      // > repository's own `expectError` discipline — *a rejection for a different reason is not
      // > a pass* — which `throwsIncoherent` was not applying. It was found by `core-agent`
      // > noticing the ten `as never` casts, on the one axis `0043` §3a had just widened.
      //
      // The casts themselves are legitimate: these inputs are DELIBERATELY type-invalid, which is
      // the point of a negative case. What was wrong was the base they were built on.
      if (expectedFragment !== undefined && thrown instanceof Error) {
        assertTrue(
          `${label}: and the message names the injected defect, not an incidental one`,
          thrown.message.includes(expectedFragment),
          `expected the message to mention ${JSON.stringify(expectedFragment)}, actual: ${thrown.message}`,
        );
      }
    };

    const org = (permissionId: string) => ({ permissionId, scope: 'organization' as const });
    const readOnly = { grants: [org('customers.customer.read')] };
    /**
     * A COMPLETE base mapping over EVERY role, so the only defect present is the injected one.
     *
     * It was `{ owner, member }` and that is now two roles short. Deriving the base from
     * `MEMBERSHIP_ROLES` means the next role added to the union does not silently re-open the
     * same hole — which is the difference between a fixture that survives `0043` §3a and one
     * that had to be repaired by it.
     */
    const complete = (
      overrides: Readonly<Record<string, { grants: readonly { permissionId: string; scope: string }[] }>> = {},
    ): Record<string, unknown> => ({
      ...Object.fromEntries(MEMBERSHIP_ROLES.map((role) => [role, readOnly])),
      ...overrides,
    });
    const owner = readOnly;
    const member = readOnly;

    // EVERY BASE IS `complete(...)` — all four roles present, one defect injected — and every
    // case names the fragment its defect must produce. Before 2026-09-13 these read
    // `{ owner, member }` and all eight threw on the missing `admin` instead.
    throwsIncoherent(
      'an UNMAPPED role',
      () => {
        assertRoleMappingIsCoherent(complete({ member: undefined as never }) as never);
      },
      'member',
    );
    throwsIncoherent(
      'a role mapped to an EMPTY set',
      () => {
        assertRoleMappingIsCoherent(complete({ member: { grants: [] } }) as never);
      },
      'member',
    );
    throwsIncoherent(
      'a WILDCARD permission id',
      () => {
        assertRoleMappingIsCoherent(complete({ owner: { grants: [org('customers.*')] } }) as never);
      },
      'customers.*',
    );
    throwsIncoherent(
      'a BLANK permission id',
      () => {
        assertRoleMappingIsCoherent(complete({ owner: { grants: [org('   ')] } }) as never);
      },
      'blank',
    );
    throwsIncoherent(
      'a grant at the WRONG SCOPE',
      () => {
        assertRoleMappingIsCoherent(
          complete({ owner: { grants: [{ permissionId: 'customers.customer.read', scope: 'business' }] } }) as never,
        );
      },
      'scope',
    );
    throwsIncoherent(
      'granting an EXCLUDED permission (delete)',
      () => {
        assertRoleMappingIsCoherent(complete({ owner: { grants: [org('customers.customer.delete')] } }) as never);
      },
      'customers.customer.delete',
    );
    throwsIncoherent(
      'granting an EXCLUDED permission (restore-deleted)',
      () => {
        assertRoleMappingIsCoherent(
          complete({ owner: { grants: [org('customers.customer.restore-deleted')] } }) as never,
        );
      },
      'customers.customer.restore-deleted',
    );
    // The fifth branch, reachable only because of the SECOND parameter.
    throwsIncoherent('an absent or unrecognised role GRANTING SOMETHING', () => {
      assertRoleMappingIsCoherent(undefined, {
        grants: [org('customers.customer.read')],
      } as never);
    });

    // THE CONTROLS. Without them a guard that threw unconditionally would pass all eight above.
    let threwOnDefaults: unknown = null;
    try {
      assertRoleMappingIsCoherent();
    } catch (cause) {
      threwOnDefaults = cause;
    }
    assertTrue(
      'it does NOT throw against the shipped mapping',
      threwOnDefaults === null,
      `the real mapping was rejected: ${String(threwOnDefaults)}`,
    );

    let threwOnExplicit: unknown = null;
    try {
      // DERIVED FROM `MEMBERSHIP_ROLES` RATHER THAN TRANSCRIBED, and the two roles this used to
      // name are why: `0043` §3a widened the union and this call stopped compiling
      // (`TS2345 … missing admin, "business-admin"`). The point of the case is that passing the
      // shipped values EXPLICITLY behaves like passing nothing — the ROLE LIST is incidental to
      // it, so holding a copy of the list here bought nothing and cost a red on a correct change.
      //
      // This is the opposite call from the pin above, and the difference is what each case is
      // FOR: that one asserts WHICH roles exist and must go red when the answer changes; this one
      // asserts the defaults and the parameters agree, and must not.
      assertRoleMappingIsCoherent(
        Object.fromEntries(MEMBERSHIP_ROLES.map((role) => [role, grantsForRole(role)])) as Readonly<
          Record<MembershipRole, ReturnType<typeof grantsForRole>>
        >,
        grantsForRole(null),
      );
    } catch (cause) {
      threwOnExplicit = cause;
    }
    assertTrue(
      'and passing the shipped values EXPLICITLY behaves identically to passing nothing — ' +
        'otherwise the defaults and the parameters have drifted and every branch above tests a ' +
        'phantom',
      threwOnExplicit === null,
      `the defaults and the parameters disagree: ${String(threwOnExplicit)}`,
    );

    // A valid mapping that is NOT the shipped one must also pass, so the guard is checking
    // properties rather than recognising one specific object.
    //
    // *** IT MUST COVER EVERY ROLE IN THE UNION, AND IT DID NOT. *** This built `{ owner, member }`
    // and went red when `0043` §3a widened `MembershipRole` — with the guard reporting *"the role
    // 'admin' maps to no permissions"*, which reads as a Core defect and is not one. **The guard
    // was right: a mapping omitting `admin` IS incoherent**, and the alternative this case
    // constructs has to be a coherent mapping over the CURRENT union, not over the union of the
    // day it was written.
    //
    // So the alternative is DERIVED from `MEMBERSHIP_ROLES` and made different from the shipped
    // one by its CONTENT — every role gets a single, identical grant — rather than by its shape.
    // A mapping that differs by omitting a role is not "a different valid mapping"; it is an
    // invalid one, and using it as the positive control would have inverted the case's meaning.
    // *** AND IT MUST COVER THE GRANTED UNIVERSE, NOT JUST EVERY ROLE. *** A first attempt gave
    // each role a single `customers.customer.read` grant and was correctly rejected with
    // *"'customers.customer.create' is in TENANT_GRANTED_PERMISSIONS and is granted to no role"* —
    // the guard checks the universe in BOTH directions, which is the property that stops the
    // declared set drifting away from what is actually held.
    //
    // So the alternative gives EVERY role the WHOLE granted universe: coherent by both of the
    // guard's rules, and different from the shipped mapping in the one way that matters — under
    // it, `member` holds everything `owner` does.
    const wholeUniverse = [...new Set([...owner.grants, ...member.grants].map((grant) => grant.permissionId))]
      .sort()
      .map((permissionId) => ({ permissionId, scope: 'organization' as const }));
    const oneGrantEach = Object.fromEntries(
      MEMBERSHIP_ROLES.map((role) => [role, { grants: wholeUniverse }]),
    );
    let threwOnValidAlternative: unknown = null;
    try {
      assertRoleMappingIsCoherent(oneGrantEach as never);
    } catch (cause) {
      threwOnValidAlternative = cause;
    }
    assertTrue(
      'a different but coherent mapping over EVERY role also passes',
      threwOnValidAlternative === null,
      `a valid alternative mapping was rejected: ${String(threwOnValidAlternative)}`,
    );
    // The control for the control: `owner` and `member` are still read above, and if the
    // alternative stopped differing from the shipped mapping this case would be asserting that
    // the shipped mapping passes — which the case eighteen lines up already does.
    // *** THIS CONTROL FIRED ON ITS FIRST RUN AND THE FIX IS IN THE COMPARISON, NOT THE CONTROL.
    // *** It originally compared `oneGrantEach.owner` against `owner` and reported the two
    // identical — correctly: `owner` already holds the whole granted universe, so "every role
    // gets the universe" leaves the OWNER row untouched. The mapping still differs, on `member`.
    //
    // Comparing the WHOLE mapping is what the case is actually about, and comparing one role was
    // a narrower question that happened to have a stable answer for the wrong reason.
    assertTrue(
      'and the alternative genuinely differs from the shipped mapping',
      MEMBERSHIP_ROLES.some(
        (role) => JSON.stringify(oneGrantEach[role]) !== JSON.stringify(grantsForRole(role)),
      ),
      'the "alternative" mapping is the shipped one for EVERY role, so this case duplicates the ' +
        'explicit-values case above and proves nothing about the guard checking properties rather ' +
        'than identity',
    );
  });

  suite.test(
    'the guard iterates MEMBERSHIP_ROLES, so a MISSING role is reachable rather than skipped',
    () => {
      // `core-agent`'s second design choice, and it is the empty-assertion class appearing in a
      // GUARD rather than in a test. Iterating the supplied mapping's keys would mean a mapping
      // that simply OMITS a role is never visited — the `undefined` branch would become dead code
      // that still looks live, and the guard would approve a role that grants nothing by never
      // looking at it.
      //
      // Asserted by omission: `{ owner }` with no `member` key at all must still throw.
      let thrown: unknown = null;
      try {
        assertRoleMappingIsCoherent({
          owner: { grants: [{ permissionId: 'customers.customer.read', scope: 'organization' }] },
        } as never);
      } catch (cause) {
        thrown = cause;
      }
      assertTrue(
        'a mapping missing a role entirely is refused, not silently skipped',
        thrown instanceof RoleMappingIncoherentError,
        `threw ${thrown instanceof Error ? thrown.constructor.name : String(thrown)} — if this ` +
          'stops throwing, the guard has started iterating the mapping rather than the role list',
      );
    },
  );

  // -----------------------------------------------------------------------------------------
  // The authorization source, and the boundary between 0019 and 0020.
  // -----------------------------------------------------------------------------------------

  suite.test('the membership source returns the role\'s grants', async () => {
    const source = createMembershipPrincipalAuthorizationSource();
    const owner = expectOk(
      'owner resolves',
      await source.resolve({
        principalId: 'prn_role_0001',
        principalType: 'user',
        membership: membershipFor('owner'),
      }),
    ) as { grants: { grants: readonly { permissionId: string }[] } };
    assertEqual(
      'an owner membership yields the owner grant set',
      owner.grants.grants.map((g) => g.permissionId).sort().join(','),
      OWNER_EXPECTED.join(','),
    );

    const member = expectOk(
      'member resolves',
      await source.resolve({
        principalId: 'prn_role_0001',
        principalType: 'user',
        membership: membershipFor('member'),
      }),
    ) as { grants: { grants: readonly { permissionId: string }[] } };
    assertEqual(
      'a member membership yields the read-only set',
      member.grants.grants.map((g) => g.permissionId).sort().join(','),
      MEMBER_EXPECTED.join(','),
    );

    const none = expectOk(
      'a roleless membership resolves',
      await source.resolve({
        principalId: 'prn_role_0001',
        principalType: 'user',
        membership: membershipFor(null),
      }),
    ) as { grants: { grants: readonly unknown[] } };
    assertEqual('a membership with no role grants nothing', none.grants.grants.length, 0);
  });

  suite.test(
    'THE BOUNDARY: the authorization SOURCE still returns an empty set — 0020 fills it downstream',
    async () => {
      // ===========================================================================================
      // I PREDICTED THIS CASE WOULD FAIL WHEN `0020` LANDED. IT DID NOT, AND THE PREDICTION WAS
      // WRONG IN AN INSTRUCTIVE WAY.
      // ===========================================================================================
      //
      // Its previous name was *"this must fail when 0020 lands"*. `0020` has landed, and this case
      // still passes — correctly. I assumed `0020` would fill the set HERE, in
      // `createMembershipPrincipalAuthorizationSource`. It does not. `0020` is a SPLIT: the
      // authorization source still returns `[]` because at that point in the order there is no
      // tenant store to read `business` from, and the set is filled later, in `pipeline.ts`, after
      // `TenantStoreResolver` runs.
      //
      // So the boundary this case pins is real but sits one step earlier than I described it. The
      // name is corrected rather than the assertion weakened — a case whose name predicts the
      // wrong future is the same defect as `write-admission.ts`'s stale ADR quote, and renaming it
      // is what stops the next reader trusting the prediction over the code.
      //
      // WHERE THE FILL IS ACTUALLY VERIFIED: `suites/az2-login/business-set.ts`, through
      // `invokeAction` rather than through this source.
      const source = createMembershipPrincipalAuthorizationSource();
      for (const role of [...MEMBERSHIP_ROLES, null]) {
        const resolved = expectOk(
          `${String(role)} resolves`,
          await source.resolve({
            principalId: 'prn_role_0001',
            principalType: 'user',
            membership: membershipFor(role),
          }),
        ) as { authorizedBusinessIds: readonly string[] };
        assertEqual(
          `${String(role)}: the authorized business set is still EMPTY (0020 is the other half)`,
          resolved.authorizedBusinessIds.length,
          0,
        );
      }
      // Stated as an assertion so the reason is in the failure output rather than only in a
      // comment. If this ever DOES go red, the source has started filling the set itself — which
      // would mean it is reading the tenant database from a point in the order where no tenant
      // store exists, and that is a design change needing a decision, not a test update.
      assertTrue(
        'if this case fails, the authorization source has begun filling the business set itself. ' +
          'That is not 0020 landing — 0020 fills it in pipeline.ts after TenantStoreResolver. ' +
          'Check business-set.ts before changing anything here',
        true,
        'unreachable',
      );
    },
  );

  suite.test('the deny-all source still exists and still denies', async () => {
    // `0019` replaced it in composition but kept it in the tree. It is the correct behaviour for
    // an unknown Organization and is used by tests; if it became unreachable, the next thing that
    // needed a deny-all would reimplement it slightly differently.
    const source = createDenyAllPrincipalAuthorizationSource();
    const resolved = expectOk(
      'the deny-all source resolves',
      await source.resolve({
        principalId: 'prn_role_0001',
        principalType: 'user',
        membership: membershipFor('owner'),
      }),
    ) as { grants: { grants: readonly unknown[] }; authorizedBusinessIds: readonly string[] };
    assertEqual('it grants nothing even for an owner', resolved.grants.grants.length, 0);
    assertEqual('and authorizes no Business', resolved.authorizedBusinessIds.length, 0);
  });

  return suite;
}
