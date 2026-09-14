/**
 * ===========================================================================================
 * THE ESCALATION ROUTE THAT LOOKS LIKE ONBOARDING — `grant-ceiling.ts`, driven.
 * ===========================================================================================
 *
 * `grant-ceiling.ts`'s own header states the attack it exists for:
 *
 *   > *"invitation is a privilege-escalation route that looks like onboarding: invite an account
 *   >  with a role you may not hold, then sign in as it."*
 *
 * **IT NEEDS NO ROLE-ADMINISTRATION RIGHTS.** `core.user.invite` is enough, and
 * `0021_invitation.sql` refuses only `owner` in a `CHECK` — **deliberately, because a legitimate
 * `owner` or `admin` must be able to invite an administrator.** So everything below `owner` is
 * this file's problem, and `business-admin` inviting an `admin` is refused by nothing else.
 *
 * ===========================================================================================
 * WHY THIS FILE EXISTS: IT IS THE SKIP-SET OF MY OWN OWNER-IMMUNITY SUITE
 * ===========================================================================================
 *
 * `owner-immunity.ts`'s cases assert that every mutating method on
 * `MembershipAdministrationStore` requires an `OwnerImmunityCleared`. **That is a check about
 * ONE port**, and `§11a`'s skip-set axis is *what the check never reaches* — which the author
 * cannot see, because it is not something they wrote.
 *
 * **`grant-ceiling.ts` carries TWO receipts of its own — `GrantCeilingCleared` and
 * `RoleCeilingCleared` — and my suite tested neither.** They guard a different question from
 * owner-immunity's:
 *
 * ```
 * OwnerImmunityCleared   may this person be ACTED ON?          a fact about the TARGET
 * GrantCeilingCleared    may this caller CONFER this much?     a comparison of TWO PERMISSION SETS
 * ```
 *
 * > **Neither subsumes the other**, and an `admin` escalating through an invitation never touches
 * > the owner at all — **so every owner-immunity assertion stays green while it happens.** That is
 * > the route *"nobody thought of as acting on a target"*, and it was found by asking what the
 * > existing check does not reach rather than by reviewing what it does.
 *
 * ===========================================================================================
 * AND THE RULE IS A COMPARISON OF RUNTIME VALUES, WHICH IS WHY IT IS A RECEIPT
 * ===========================================================================================
 *
 * The file answers this itself and the answer is worth keeping, because *"use a declared scope
 * instead"* is the obvious objection:
 *
 *   > *"this rule is a comparison between two RUNTIME VALUES — the set the offer confers against
 *   >  the set the caller holds — and neither is known when a permission is declared. No `scopes:`
 *   >  entry, no envelope entry and no route-table field can express it. `authorize()` never sees
 *   >  the offer at all: it decides whether the caller may invite, not what the caller may offer."*
 *
 * **So there is no declaration that does this work**, and `architecture.md` §3a's preference for a
 * mechanism over a discipline is satisfied by the receipt rather than by a scope.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type { Result } from '../../../../platform/core/kernel/result.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { MEMBERSHIP_ROLES, grantsForRole } from '../../../../platform/core/authorization/roles.ts';
import type { MembershipRole } from '../../../../platform/core/authorization/roles.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import { sealAuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import type { GrantCeilingStore } from '../../../../platform/core/tenant-admin/grant-ceiling.ts';
import { clearGrantCeiling, clearRoleCeiling } from '../../../../platform/core/tenant-admin/grant-ceiling.ts';

const GRANTOR = 'prn_grantor';

/**
 * The Organization, SEALED — `clearGrantCeiling` and `clearRoleCeiling` take an
 * `AuthenticatedOrganizationId` since 2026-09-13, whose only producer reads the value off an
 * `AuthenticatedPrincipal`. A caller cannot name an Organization it is not authenticated in, and
 * that is a construction rather than a check (`§11a`: re-base onto the type, never cast around it).
 */
const ORG = sealAuthenticatedOrganizationId(
  sealAuthenticatedPrincipal({
    principalId: GRANTOR,
    principalType: 'user',
    organizationId: 'org_ceiling',
    authorizedBusinessIds: [],
    grants: { grants: [] },
    onBehalfOfPrincipalId: null,
  }) as never,
);

/** A store answering with exactly the permissions a given seed role confers. */
function storeHolding(role: MembershipRole | 'nothing'): GrantCeilingStore {
  const permissionIds =
    role === 'nothing' ? [] : grantsForRole(role).grants.map((grant) => grant.permissionId);
  return {
    heldPermissions(): Promise<Result<readonly string[]>> {
      return Promise.resolve(ok(permissionIds));
    },
  } as unknown as GrantCeilingStore;
}

/**
 * The grantor as an AUTHORITY rather than a loose pair — the shape both ceiling functions took
 * from 2026-09-13, on `security-agent`'s finding that *"one of them was a bare string beside a
 * typed one"*. Passing `(organizationId, principalId)` separately is exactly the shape that lets
 * a caller supply one from the context and the other from a request.
 */
const AUTHORITY = { organizationId: ORG, principalId: GRANTOR };

function permissionsOf(role: MembershipRole): readonly string[] {
  return grantsForRole(role).grants.map((grant) => grant.permissionId);
}

type Outcome = { readonly ok: boolean };

export function buildGrantCeilingSuite(): Suite {
  const suite = new TestSuite('tenant-admin — the grant ceiling: you cannot confer what you do not hold');

  suite.test('POPULATION — the seed roles, and what each actually confers', () => {
    // Printed because every assertion below is a comparison BETWEEN these sets, and a run where
    // two roles happen to confer the same thing proves far less than it appears to. `§11a`: name
    // the property of the corpus the green depends on.
    for (const role of MEMBERSHIP_ROLES) {
      console.log(`      ${role.padEnd(15)} confers ${String(permissionsOf(role).length)} permission(s)`);
    }
    const sizes = MEMBERSHIP_ROLES.map((role) => permissionsOf(role).length);
    assertTrue(
      'the roles do NOT all confer the same set — otherwise every ceiling case is vacuous',
      new Set(sizes).size > 1,
      `every seed role confers ${String(sizes[0])} permissions, so "you cannot confer more than ` +
        'you hold" is satisfied by any two roles and these cases test nothing.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // THE ATTACK, PER PAIR. Derived from the union rather than transcribed, so a fifth role is
  // covered the day it lands — and the pairs are computed from the real permission sets, so a
  // role whose grants change moves with them.
  // -----------------------------------------------------------------------------------------
  suite.test(`${ISOLATION} a caller cannot OFFER a role conferring more than it holds`, async () => {
    const offences: string[] = [];
    let pairsExamined = 0;

    for (const holder of MEMBERSHIP_ROLES) {
      for (const offered of MEMBERSHIP_ROLES) {
        const held = new Set(permissionsOf(holder));
        const confers = permissionsOf(offered);
        const exceeds = confers.some((permissionId) => !held.has(permissionId));
        if (!exceeds) continue; // not an escalation; covered by the control case below
        pairsExamined += 1;

        const outcome = (await clearGrantCeiling(storeHolding(holder), AUTHORITY,{
          membershipRole: offered,
          customRoleIds: [],
        })) as Outcome;
        if (outcome.ok) offences.push(`a '${holder}' was cleared to offer '${offered}'`);
      }
    }

    console.log(`      ${String(pairsExamined)} escalating (holder, offered) pair(s) examined`);
    // THE FLOOR. If no pair escalates — because every role confers the same set, or because the
    // reader broke — this case examines nothing and reports a clean sweep.
    assertTrue(
      'floor: at least one pair genuinely escalates',
      pairsExamined > 0,
      'no (holder, offered) pair confers more than the holder holds, so this case examined ZERO ' +
        'escalations and its green says nothing about the ceiling.',
    );
    assertEqual(
      `${ISOLATION} every escalating offer is refused`,
      offences.join(' · '),
      '',
    );
  });

  suite.test('CONTROL — a caller CAN offer a role it fully holds, or the ceiling refuses everything', async () => {
    // Without this, a `clearGrantCeiling` that returned `forbidden()` unconditionally passes the
    // case above perfectly.
    let cleared = 0;
    for (const role of MEMBERSHIP_ROLES) {
      const outcome = (await clearGrantCeiling(storeHolding(role), AUTHORITY,{
        membershipRole: role,
        customRoleIds: [],
      })) as Outcome;
      if (outcome.ok) cleared += 1;
    }
    assertEqual(
      'every role may offer ITSELF — a set is a subset of itself',
      cleared,
      MEMBERSHIP_ROLES.length,
    );
  });

  suite.test(`${ISOLATION} the named attack: a caller holding NOTHING cannot offer an administrator`, async () => {
    // `grant-ceiling.ts`'s own sentence, executed. `core.user.invite` is enough to reach the
    // invitation route, and `0021`'s CHECK stops only `owner` — so `admin` is what an attacker
    // would actually ask for, and this file is the only thing between them and it.
    const outcome = (await clearGrantCeiling(storeHolding('nothing'), AUTHORITY,{
      membershipRole: 'admin',
      customRoleIds: [],
    })) as Outcome;
    assertTrue(
      `${ISOLATION} a principal holding no permissions cannot offer 'admin'`,
      !outcome.ok,
      "a caller holding NOTHING was cleared to offer 'admin'. That is the escalation route this " +
        'module exists for: invite an account with a role you may not hold, then sign in as it.',
    );
  });

  suite.test(`${ISOLATION} the same ceiling binds ROLE CREATION — clearRoleCeiling`, async () => {
    // `0007` D16 constraint 1: *a custom role may contain only permissions the creating principal
    // itself holds. Creating a role is a grant.* This is that constraint's mechanism, and it is a
    // SECOND receipt — so a suite testing only the offer path leaves it entirely uncovered.
    const holderRole = MEMBERSHIP_ROLES.find((role) => permissionsOf(role).length > 0);
    assertTrue('a role with permissions exists to drive this', holderRole !== undefined, 'none');
    if (holderRole === undefined) return;

    const held = permissionsOf(holderRole);
    const allPermissions = new Set(MEMBERSHIP_ROLES.flatMap((role) => permissionsOf(role)));
    const notHeld = [...allPermissions].find((permissionId) => !held.includes(permissionId));

    // The subset case must clear.
    const subset = (await clearRoleCeiling(storeHolding(holderRole), AUTHORITY,held.slice(0, 1))) as Outcome;
    assertTrue('control: a role built from a SUBSET of what the creator holds is cleared', subset.ok, 'refused');

    // And one permission the creator does not hold must refuse the whole thing.
    if (notHeld === undefined) {
      console.log('      NOT RUN: every permission in the union is held by this role — no specimen');
    } else {
      const escalating = (await clearRoleCeiling(storeHolding(holderRole), AUTHORITY,[
        ...held.slice(0, 1),
        notHeld,
      ])) as Outcome;
      assertTrue(
        `${ISOLATION} a custom role naming '${notHeld}', which the creator does not hold, is refused`,
        !escalating.ok,
        `a '${holderRole}' was cleared to create a role containing '${notHeld}'. 0007 D16 ` +
          'constraint 1 is what makes every static property of the seed roles hold of everything ' +
          'derivable from them — a subset of an enumerable set is enumerable. Break it and custom ' +
          'roles stop being bounded by anything.',
      );
    }
  });

  suite.test('KNOWN-FAILING INPUT — one extra permission is enough, and it is refused whole', async () => {
    // The realistic mutation: not a wildly over-privileged role, but a legitimate one with a
    // single extra permission slipped in. A ceiling that compared SIZES, or that sampled, would
    // pass this.
    const holder = MEMBERSHIP_ROLES.find((role) => permissionsOf(role).length > 1);
    if (holder === undefined) {
      console.log('      NOT RUN: no seed role confers more than one permission');
      return;
    }
    const held = permissionsOf(holder);
    const foreign = 'core.organization.delete';
    assertTrue(
      `the specimen permission is genuinely not held by '${holder}'`,
      !held.includes(foreign),
      `'${holder}' holds ${foreign}, so it is the wrong specimen`,
    );
    const outcome = (await clearRoleCeiling(storeHolding(holder), AUTHORITY,[...held, foreign])) as Outcome;
    assertTrue(
      'a set that is the held set PLUS ONE is refused',
      !outcome.ok,
      `a '${holder}' was cleared for its own permissions plus '${foreign}'. The ceiling must be a ` +
        'subset test over every member, not a comparison of sizes or a sample.',
    );
  });

  suite.test('WHAT THIS DOES NOT REACH — stated, because the receipt is not the enforcement', () => {
    // `architecture.md` §3a ranks the layers and warns against describing one as THE enforcement.
    // Recorded here rather than left for a reader to assume:
    //
    //   THE RECEIPT (driven above)   forgetting the ceiling — a BUILD failure, if the consumer
    //                                requires the receipt. NOT TESTED HERE: no route consumes it
    //                                yet, so nothing proves the receipt is actually demanded.
    //   THE STALE FACT              `clearGrantCeiling` reads the grantor's permissions and the
    //                                world can move before the write. Same window
    //                                `OwnerImmunityCleared` has, and the file says so at line 317.
    //   THE DATABASE CHECK          `0021_invitation.sql` refuses `owner` and NOTHING BELOW IT.
    //
    // The middle row is the one with no backstop in this class today.
    console.log(
      '      NOT TESTED: that any route DEMANDS these receipts — TENANT_ADMIN_ROUTE_COUNT is 0, ' +
        'so the receipts are correct and unconsumed. A receipt nothing requires is a discipline.',
    );
    assertTrue('this case exists to state a gap rather than to pass', true, 'unreachable');
  });

  return suite;
}
