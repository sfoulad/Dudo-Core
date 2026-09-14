/**
 * ===========================================================================================
 * `0043` §3d — `admin` MAY NOT ACT ON THE `owner`. ONE CASE PER ACTION, NOT ONE REPRESENTATIVE.
 * ===========================================================================================
 *
 *   > "THE THIRD IS THE ONE A PERMISSION CANNOT EXPRESS, since it is a property of the TARGET
 *   >  rather than of the ACTOR. It is stated here as a Core obligation and A TEST REQUIREMENT,
 *   >  never as a grant."
 *   >
 *   > "Without it, `admin` is `owner` with extra steps: demote the owner, then do anything."
 *
 * `0043` §8.4 assigns the behavioural case per action to `qa-agent` by name. This is that file.
 *
 * ===========================================================================================
 * ⚠ THE ACTOR THIS RULE CONSTRAINS DOES NOT EXIST YET, AND THAT GOVERNS HOW TO READ EVERY GREEN
 * ===========================================================================================
 *
 * Measured 2026-09-13: `platform/core/authorization/roles.ts:65` still reads
 *
 *     export type MembershipRole = 'owner' | 'member';
 *
 * `0043` §3a requires `admin` and `business-admin` ADDED to that union, to the `CHECK`, and to
 * the catalogue. **Until `admin` exists there is no principal who can hold administrative
 * authority without being the owner**, so the scenario §3d describes — an `admin` demoting the
 * `owner` and then doing anything — is not reachable, and a suite asserting it is refused would
 * be asserting something no caller can attempt.
 *
 * `security.md` §2a-i names this exact trap in this exact repository:
 *
 *   > "It is safe because ONE ROLE HOLDS ALL THIRTEEN PERMISSIONS. The separations are what you
 *   >  built; they are not yet what protects you." … "A permission model with one role is a
 *   >  permission model with no evidence. **Green means the separations were never tested, not
 *   >  that they hold.**"
 *
 * So the first case below asserts `admin` exists and **IS EXPECTED TO BE RED**, and it is
 * placed first deliberately: every green beneath it is a green about a MECHANISM, never about
 * the SEPARATION the mechanism serves.
 *
 * ===========================================================================================
 * WHAT IS FULLY TESTABLE TODAY, AND IT IS THE LARGER HALF
 * ===========================================================================================
 *
 * `owner-immunity.ts` and `membership-administration.ts` landed this morning and the receipt
 * mechanism is complete, so it can be driven for real: mint, forge, mis-bind, cross-tenant.
 * Those cases need no `admin` role, because the receipt constrains **the target**, and the
 * target is an owner regardless of who is asking.
 *
 * **AND THE RECEIPT IS NOT THE LOAD-BEARING LAYER.** Its own header says so, ranking four
 * layers and putting the in-statement guard above it because a receipt certifies a fact and a
 * fact can go stale between the mint and the write. This suite therefore asserts the layer
 * ranking rather than only the receipt — `architecture.md` §3a's closing warning is that a
 * function *"described as THE enforcement, when it is one of four layers"*, is how the next
 * reviewer concludes the problem is handled.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type { Result } from '../../../../platform/core/kernel/result.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { MEMBERSHIP_ROLES } from '../../../../platform/core/authorization/roles.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import type { AuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import { sealAuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import type {
  OwnerImmunityCleared,
  OwnerImmunityStore,
  OwnerImmunityTarget,
} from '../../../../platform/core/tenant-admin/owner-immunity.ts';
import {
  OwnerImmunityNotClearedError,
  clearOwnerImmunity,
  consumeOwnerImmunityClearance,
} from '../../../../platform/core/tenant-admin/owner-immunity.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE_TREE = 'platform/core/tenant-admin';

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
// DECLARED ABOVE THE SEALED IDENTIFIERS, which read them. A `const` is in its temporal dead zone
// until its own line, so the original order threw at module load — `workflow.md` §2b's *a suite
// that dies at import is NOT RUN*, self-inflicted, and the second time today the same ordering
// hazard has appeared in this tree.
const THE_OWNER = 'prin_owner';
const A_MEMBER = 'prin_member';
const NO_MEMBERSHIP = 'prin_stranger';

/**
 * ===========================================================================================
 * SEALED ORGANIZATION IDENTIFIERS — added 2026-09-13, and the reason is a FINDING not a chore.
 * ===========================================================================================
 *
 * `clearOwnerImmunity` and `consumeOwnerImmunityClearance` took a `string` when this file was
 * written. They now take an `AuthenticatedOrganizationId`, whose only producer reads the value
 * off an `AuthenticatedPrincipal` — **so a caller cannot name an Organization it is not
 * authenticated in.** Five call sites here stopped compiling with `TS2345`.
 *
 * > **`§11a`: `TS2345` on a test you are writing is a FINDING.** The property these cases probed
 * > at runtime is now enforced one layer up, and the correct response is to re-base onto the new
 * > type rather than cast around it — a cast would convert a compile-time guarantee back into a
 * > runtime assertion that can never fire.
 *
 * The cross-Organization case below (`SEALED_B` spent against a clearance minted under
 * `SEALED_A`) survives and is still meaningful: **the seal stops you NAMING another
 * Organization; it does not by itself stop two legitimately-sealed values being recombined**,
 * and that is what the clearance's own subject check closes.
 */
const SEALED_A = sealAuthenticatedOrganizationId(
  sealAuthenticatedPrincipal({
    principalId: A_MEMBER,
    principalType: 'user',
    organizationId: ORG_A,
    authorizedBusinessIds: [],
    grants: { grants: [] },
    onBehalfOfPrincipalId: null,
  }) as never,
);
const SEALED_B = sealAuthenticatedOrganizationId(
  sealAuthenticatedPrincipal({
    principalId: A_MEMBER,
    principalType: 'user',
    organizationId: ORG_B,
    authorizedBusinessIds: [],
    grants: { grants: [] },
    onBehalfOfPrincipalId: null,
  }) as never,
);

/**
 * THE FOUR ACTS `0043` §3d ENUMERATES, BY NAME.
 *
 * Transcribed from the decision rather than derived, and that is deliberate: this list is the
 * REQUIREMENT, and deriving it from the port would make the test agree with the code by
 * construction — `§11a`'s *a constraint that learns from its subject is not a constraint*.
 * The port method beside each is what the requirement must land on, and a §3d act with no
 * method is a gap this file must report rather than absorb.
 */
export const SECTION_3D_ACTS: readonly { readonly act: string; readonly method: string }[] = [
  { act: 'suspend', method: 'suspendMembership' },
  { act: 'remove', method: 'removeMembership' },
  { act: 'demote', method: 'assignRole' },
  { act: 'revoke sessions', method: 'revokeMemberSessions' },
];

/** A store that answers with whatever membership the case wants the target to hold. */
function storeReturning(rows: Readonly<Record<string, OwnerImmunityTarget | null>>): OwnerImmunityStore {
  return {
    // The port's first parameter is an `AuthenticatedOrganizationId` since 2026-09-13. The double
    // reads `.value` to key its rows — it is standing in for an adapter, and an adapter has to
    // reach the identifier to build a statement with it. **What the type prevents is a CALLER
    // supplying one**, which no test double can restore.
    findMembershipForImmunityCheck(
      organization: AuthenticatedOrganizationId,
      principalId: string,
    ): Promise<Result<OwnerImmunityTarget | null>> {
      const organizationId = (organization as unknown as { value: string }).value;
      return Promise.resolve(ok(rows[`${organizationId}/${principalId}`] ?? null));
    },
  } as unknown as OwnerImmunityStore;
}

function member(organizationId: string, principalId: string, storedRole: string | null): OwnerImmunityTarget {
  return { organizationId, principalId, storedRole };
}

const WORLD = storeReturning({
  [`${ORG_A}/${THE_OWNER}`]: member(ORG_A, THE_OWNER, 'owner'),
  [`${ORG_A}/${A_MEMBER}`]: member(ORG_A, A_MEMBER, 'member'),
  [`${ORG_B}/${A_MEMBER}`]: member(ORG_B, A_MEMBER, 'member'),
});

function threw(run: () => void): OwnerImmunityNotClearedError | null {
  try {
    run();
    return null;
  } catch (cause) {
    return cause instanceof OwnerImmunityNotClearedError ? cause : null;
  }
}

export function buildOwnerImmunitySuite(): Suite {
  const suite = new TestSuite('0043 §3d — admin may not act on the owner');

  // -----------------------------------------------------------------------------------------
  // THE GATING FACT. Everything below is about a mechanism; this is about the separation.
  // -----------------------------------------------------------------------------------------
  suite.test("GATING FACT — the `admin` role exists, without which §3d's actor is unreachable", () => {
    console.log(`      MembershipRole today: ${MEMBERSHIP_ROLES.join(' | ')}`);
    assertTrue(
      "0043 §3a — `admin` is added to MembershipRole",
      MEMBERSHIP_ROLES.includes('admin' as never),
      `MembershipRole is [${MEMBERSHIP_ROLES.join(', ')}]. 0043 §3a requires \`admin\` and ` +
        '`business-admin` ADDED to the union, to the CHECK and to the catalogue. UNTIL THEN ' +
        'EVERY GREEN IN THIS FILE IS ABOUT THE RECEIPT MECHANISM AND NOT ABOUT THE SEPARATION: ' +
        'security.md §2a-i — "a permission model with one role is a permission model with no ' +
        'evidence; green means the separations were never tested, not that they hold."',
    );
  });

  suite.test("GATING FACT — `business-admin` exists too, and its absence is not covered by admin's", () => {
    assertTrue(
      '0043 §3a — `business-admin` is added to MembershipRole',
      MEMBERSHIP_ROLES.includes('business-admin' as never),
      `MembershipRole is [${MEMBERSHIP_ROLES.join(', ')}]. 0043 §3a adds TWO roles, and asserting ` +
        'only the first would report the vocabulary migrated when it is half migrated.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // ONE CASE PER ACTION. `0043` §8.4 asks for exactly this rather than a representative case.
  // -----------------------------------------------------------------------------------------
  for (const { act, method } of SECTION_3D_ACTS) {
    suite.test(`§3d act "${act}" — \`${method}\` cannot be called without an owner-immunity clearance`, () => {
      // THE GUARANTEE IS A TYPE, AND A TYPE IS NOT OBSERVABLE FROM A TEST. Node strips types
      // without checking them, so no runtime case in this repository can see that the parameter
      // is required — `run-type-negative.ts` exists for precisely this reason and its header
      // says so. What IS checkable here is that the parameter is DECLARED, on this method, in
      // the shipped port. A method that quietly loses it would still compile everywhere that
      // does not pass one.
      const source = readFileSync(`${REPO}${CORE_TREE}/membership-administration.ts`, 'utf8');
      const signature = new RegExp(`${method}\\s*\\(([\\s\\S]*?)\\)\\s*:`, 'm').exec(source);
      assertTrue(
        `§3d act "${act}": the port declares \`${method}\``,
        signature !== null,
        `MembershipAdministrationStore declares no \`${method}\`. 0043 §3d enumerates "${act}" as ` +
          'an act `admin` must not perform on the `owner`, and an act with no method is an act ' +
          'this suite cannot bind. If the act moved to another port, this list must move with it.',
      );
      if (signature === null) return;
      assertTrue(
        `§3d act "${act}": \`${method}\` requires an OwnerImmunityCleared`,
        /OwnerImmunityCleared/.test(signature[1]),
        `\`${method}\` takes no clearance: (${signature[1].replace(/\s+/g, ' ').trim()}). ` +
          'Without it this is the demotion path for ownership itself, and 0043 §3d\'s whole ' +
          'sentence applies: `admin` is `owner` with extra steps.',
      );
    });
  }

  suite.test('§3d completeness — every mutating method carries the clearance, EXCEPT the one that must not', () => {
    // The four above are the REQUIREMENT. This is the inverse question and it catches a method
    // nobody thought to enumerate: `§11a`'s route-first versus envelope-first, where neither
    // direction subsumes the other. A fifth mutating method added without a clearance is
    // invisible to the loop above, which only ever asks about the four it knows.
    //
    // ⚠ THE FIRST VERSION OF THIS CASE REPORTED A DEFECT THAT WAS NOT ONE, and the correction is
    // worth more than the case. It asserted a blanket "every mutating method carries a
    // clearance" and went red on `transferOwnership` — which takes none, DELIBERATELY, for a
    // reason its own module states at lines 36-43: it is the only operation that may write
    // `'owner'` into the column, gated by a different permission that `0043` §3d says `admin`
    // must never hold. A clearance certifies *the target is not the owner*; demanding one of the
    // method whose entire purpose is to change who the owner IS would be incoherent.
    //
    // So the exception is ENUMERATED WITH ITS REASON rather than the rule being loosened —
    // `architecture.md` §3a-i: key the predicate on the exception, so a method nobody
    // anticipated is caught by the default rather than absorbed by it. A blanket rule relaxed
    // to make a red go away would have caught nothing ever again.
    const CLEARANCE_EXEMPT: readonly { readonly method: string; readonly because: string; readonly pinnedText: string }[] = [
      {
        method: 'transferOwnership',
        because:
          'It is the ONE method that may write `owner`, so an owner-immunity clearance is the ' +
          'wrong instrument for it. 0043 §3d constrains it at the PERMISSION level instead — ' +
          '`admin` must never hold `core.organization.transfer-ownership` — which is a fact about ' +
          'the actor and therefore expressible as a grant, unlike §3d\'s third clause.',
        pinnedText: 'a different permission `0043` §3d says `admin` must never hold',
      },
    ];

    const source = readFileSync(`${REPO}${CORE_TREE}/membership-administration.ts`, 'utf8');
    const port = /export type MembershipAdministrationStore = \{([\s\S]*?)\n\};/.exec(source);
    assertTrue('the port type is readable', port !== null, 'MembershipAdministrationStore did not parse');
    if (port === null) return;

    const methods = [...port[1].matchAll(/^\s{2}(\w+)\s*\(/gm)].map((match) => match[1]);
    assertTrue(
      'floor: the port reader found methods',
      methods.length > 0,
      'zero methods parsed out of the port — a reader that reads nothing reports agreement',
    );
    console.log(`      port methods: ${methods.join(', ')}`);

    // The exemption is pinned in BOTH directions, like `check:source-bytes`'s NUL pin. If the
    // rationale ever leaves the module, the exemption fails rather than quietly permitting an
    // unguarded method — a pin claiming an exception that is no longer justified is the
    // pessimistic stale figure `§11a` records that nobody questions.
    for (const exempt of CLEARANCE_EXEMPT) {
      assertTrue(
        `the \`${exempt.method}\` exemption is still justified in the module itself`,
        source.includes(exempt.pinnedText),
        `\`${exempt.method}\` is exempted from the clearance requirement on the strength of a ` +
          `sentence that is no longer in membership-administration.ts: ${JSON.stringify(exempt.pinnedText)}. ` +
          'Either the rationale moved, or the exemption has outlived it.',
      );
    }

    const exemptNames = new Set(CLEARANCE_EXEMPT.map((entry) => entry.method));
    const unguarded = methods.filter((name) => {
      if (exemptNames.has(name)) return false;
      const signature = new RegExp(`^\\s{2}${name}\\s*\\(([\\s\\S]*?)\\)\\s*:`, 'm').exec(port[1]);
      return signature !== null && !/OwnerImmunityCleared/.test(signature[1]);
    });
    assertTrue(
      '§3d — no NON-EXEMPT mutating method is reachable without a clearance',
      unguarded.length === 0,
      `${unguarded.join(', ')} take no OwnerImmunityCleared and are not on the enumerated ` +
        'exemption list. The port\'s own comment says the clearance is uniform precisely so that ' +
        '"a method without one is the method a future reader copies".',
    );
    // And the exemption must not become a way to hide a method: an exempt method that GAINS a
    // clearance means the exemption is wrong, and that is a finding too.
    const spurious = [...exemptNames].filter((name) => {
      const signature = new RegExp(`^\\s{2}${name}\\s*\\(([\\s\\S]*?)\\)\\s*:`, 'm').exec(port[1]);
      return signature !== null && /OwnerImmunityCleared/.test(signature[1]);
    });
    assertTrue(
      'no exempted method has quietly acquired a clearance',
      spurious.length === 0,
      `${spurious.join(', ')} is exempted from the clearance requirement and takes one anyway — ` +
        'remove the exemption.',
    );
    assertEqual(
      'and the four acts 0043 §3d names are all present among them',
      SECTION_3D_ACTS.filter(({ method }) => methods.includes(method)).length,
      SECTION_3D_ACTS.length,
    );
  });

  suite.test('§3d act "revoke sessions" — the act that writes NO membership row, and needs the clearance most', () => {
    // `revokeMemberSessions` gets its own case beyond the loop above, and the reason is a reader's
    // assumption rather than a gap in the code.
    //
    // > **It writes no `organization_membership` row.** Every other act on this port changes the
    // > membership — suspend, reactivate, remove, assign — so a reader scanning for "what touches
    // > membership" finds four methods and naturally concludes the owner-immunity clearance is
    // > about membership writes. **It is about ACTS ON A PRINCIPAL**, and `0043` §3d names
    // > "revoke sessions" in the same breath as the other three.
    //
    // **The harm is also the most immediate of the four.** Suspend, remove and demote change what
    // the owner MAY do; revoking sessions changes what the owner IS DOING, right now. An `admin`
    // who can end the owner's sessions can lock the owner out **while it works** — and the owner's
    // recourse is to sign in again, which the same `admin` can undo in a loop. It is the one act
    // where the window between "admin acts" and "owner notices" can be kept closed indefinitely.
    //
    // Asserted structurally for the same reason as the loop: Node strips types without checking
    // them, so no runtime case here can observe that the parameter is required (`run-type-negative.ts`
    // exists for that). What is checkable is that the shipped port still declares it.
    const source = readFileSync(`${REPO}${CORE_TREE}/membership-administration.ts`, 'utf8');
    const signature = /revokeMemberSessions\s*\(([\s\S]*?)\)\s*:/m.exec(source);
    assertTrue(
      'the port still declares revokeMemberSessions',
      signature !== null,
      '`revokeMemberSessions` is gone from MembershipAdministrationStore. 0043 §3d names "revoke ' +
        'sessions" as an act `admin` must not perform on the `owner`; if it moved to another port, ' +
        'SECTION_3D_ACTS must move with it or this obligation silently stops being checked.',
    );
    if (signature === null) return;
    assertTrue(
      'and it requires an OwnerImmunityCleared despite writing no membership row',
      /OwnerImmunityCleared/.test(signature[1]),
      'revokeMemberSessions takes no clearance. It writes no membership row, which is exactly why ' +
        'a reader would assume the immunity does not apply to it — and an `admin` able to end the ' +
        "owner's sessions can lock the owner out while it works, in a loop the owner cannot break.",
    );
  });

  // -----------------------------------------------------------------------------------------
  // THE RECEIPT, DRIVEN FOR REAL. No `admin` needed — the receipt constrains the TARGET.
  // -----------------------------------------------------------------------------------------
  suite.test('the owner cannot be cleared — the fact the whole mechanism certifies', async () => {
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, THE_OWNER);
    assertTrue('a clearance for the owner is refused', !cleared.ok, 'the OWNER was cleared for administration');
  });

  suite.test('control: an ordinary member IS cleared — without this the case above proves nothing', async () => {
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, A_MEMBER);
    assertTrue('a clearance for a member is granted', cleared.ok, 'an ordinary member could not be administered');
  });

  suite.test('a target with NO membership is refused — clearing an absent row would let a write create one', async () => {
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, NO_MEMBERSHIP);
    assertTrue('an absent membership is refused', !cleared.ok, 'a principal with no membership was cleared');
  });

  suite.test('an UNRECOGNISED stored role is refused — a database ahead of the deployment fails closed', async () => {
    // `0043` §3a: `toMembershipRole` returns null for an unrecognised string, "so a database
    // ahead of a deployment fails closed rather than open". This is that sentence, executed.
    // It is the case that matters most during the `admin`/`business-admin` migration, when rows
    // will legitimately carry values an older build cannot narrow.
    const ahead = storeReturning({ [`${ORG_A}/${A_MEMBER}`]: member(ORG_A, A_MEMBER, 'platform-liaison') });
    const cleared = await clearOwnerImmunity(ahead, SEALED_A, A_MEMBER);
    assertTrue(
      'a role this build cannot narrow is refused',
      !cleared.ok,
      'a stored role the build does not recognise was CLEARED — that is fail-open during exactly ' +
        'the migration 0043 §3a schedules',
    );
  });

  suite.test('a NULL stored role is cleared — it is an ordinary member, not an unrecognised one', async () => {
    // The distinction the file's own header draws, and it is load-bearing in the other
    // direction: treating `null` as unrecognised would refuse administration of every member
    // who predates the role column. A guard that fails closed on the wrong input is still wrong.
    const legacy = storeReturning({ [`${ORG_A}/${A_MEMBER}`]: member(ORG_A, A_MEMBER, null) });
    assertTrue('a null role clears', (await clearOwnerImmunity(legacy, SEALED_A, A_MEMBER)).ok, 'a pre-role member was refused');
  });

  suite.test('a FORGED clearance is refused — the brand cannot be hand-built', () => {
    const forged = { organizationId: ORG_A, targetPrincipalId: A_MEMBER } as unknown as OwnerImmunityCleared;
    assertTrue(
      'a hand-built object is not a clearance',
      threw(() => { consumeOwnerImmunityClearance(forged, SEALED_A, A_MEMBER); }) !== null,
      'a plain object satisfied the brand check',
    );
  });

  suite.test('a clearance does not survive a JSON round trip — it cannot be reconstituted from a log line', async () => {
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, A_MEMBER);
    assertTrue('control: the clearance was minted', cleared.ok, 'the mint failed');
    if (!cleared.ok) return;
    const revived = JSON.parse(JSON.stringify(cleared.value)) as OwnerImmunityCleared;
    assertTrue(
      'a round-tripped clearance is refused',
      threw(() => { consumeOwnerImmunityClearance(revived, SEALED_A, A_MEMBER); }) !== null,
      'a clearance survived JSON and was accepted — anything that reaches a log can fund a write',
    );
    // And the control, so this is not passing because the mint is broken.
    assertEqual('control: the genuine clearance is accepted', threw(() => { consumeOwnerImmunityClearance(cleared.value, SEALED_A, A_MEMBER); }), null);
  });

  suite.test('a clearance minted for target A cannot fund a write to target B', async () => {
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, A_MEMBER);
    if (!cleared.ok) { assertTrue('control: the mint succeeded', false, 'the mint failed'); return; }
    assertTrue(
      'a mis-bound target is refused',
      threw(() => { consumeOwnerImmunityClearance(cleared.value, SEALED_A, THE_OWNER); }) !== null,
      "a clearance for a member funded a write to the OWNER — that is 0043 §3d defeated by one " +
        'substitution, and it is the obvious hole in any scheme of this shape',
    );
  });

  suite.test('a clearance minted in Organization A cannot fund a write in Organization B', async () => {
    // The file's own header calls this half "a tenant-isolation check and not decoration", and
    // labels it correctly: without it, a clearance legitimately minted inside one Organization
    // satisfies the type system for a write into another.
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, A_MEMBER);
    if (!cleared.ok) { assertTrue('control: the mint succeeded', false, 'the mint failed'); return; }
    assertTrue(
      `${ISOLATION} a clearance does not cross an Organization boundary`,
      threw(() => { consumeOwnerImmunityClearance(cleared.value, SEALED_B, A_MEMBER); }) !== null,
      'a clearance minted in ORG_A funded a write in ORG_B',
    );
  });

  // -----------------------------------------------------------------------------------------
  // THE LAYER RANKING. The receipt is NOT the layer with no window, and its header says so.
  // -----------------------------------------------------------------------------------------
  suite.test('the STALE-FACT window is real and is closed by the statement, not by the receipt', async () => {
    // `architecture.md` §3a: "a principal who is clean when the check runs, and is made an
    // operator before the write lands, PASSES THE BRAND CHECK — the receipt is authentic, and
    // the world moved." Demonstrated rather than argued: mint against a member, then let the
    // world make that member the owner, and spend the receipt.
    const cleared = await clearOwnerImmunity(WORLD, SEALED_A, A_MEMBER);
    if (!cleared.ok) { assertTrue('control: the mint succeeded', false, 'the mint failed'); return; }
    // The world moves. The receipt cannot know.
    assertEqual(
      'the receipt still verifies AFTER the target becomes the owner — this is the window',
      threw(() => { consumeOwnerImmunityClearance(cleared.value, SEALED_A, A_MEMBER); }),
      null,
    );
    // So the guarantee has to be re-asked inside the statement. That is an assertion about the
    // ADAPTER, and the adapter is where it must be found.
    const adapters = existsSync(REPO + CORE_TREE)
      ? readdirSync(REPO + CORE_TREE).filter((name) => name.endsWith('.ts'))
      : [];
    const guarded = adapters.filter((name) =>
      /role IS NULL OR role <> 'owner'/.test(readFileSync(`${REPO}${CORE_TREE}/${name}`, 'utf8')),
    );
    console.log(`      in-statement owner guard found in: ${guarded.join(', ') || 'NO ADAPTER'}`);
    assertTrue(
      'the in-statement guard exists — the only layer with no window',
      guarded.length > 0,
      "no module under " + CORE_TREE + " carries the in-statement guard `(role IS NULL OR role " +
        "<> 'owner')`. The receipt is authentic and the world can move between the mint and the " +
        'write, so WITHOUT THIS LAYER §3d has a race, not an enforcement — owner-immunity.ts\'s ' +
        'own header ranks the statement above the receipt for exactly this reason. THE ADAPTER ' +
        'IS NOT WRITTEN YET; this is the honest state, recorded rather than rounded up.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // `0043` §7 — the audit gap this milestone is required to CLOSE rather than carry.
  // -----------------------------------------------------------------------------------------
  suite.test('0007 rule 9 / 0043 §7 — a role or permission change is audited', () => {
    // `0043` §7: "There is still no audited path for a role or permission change (0018, 0019,
    // roles.ts:135). This milestone makes role assignment a product feature, which turns that
    // gap from a recorded debt into a live one … It is CLOSED INSIDE THIS MILESTONE, not
    // carried past it."
    // ⚠ THE FIRST VERSION OF THIS CASE ASKED THE WRONG QUESTION AND WOULD HAVE MISREPORTED.
    // It searched for `AuditWriter|writeAuditRecord|auditPort|recordAuditEvent` — a pattern
    // written from the shape the author had in mind rather than the shape the code takes
    // (`workflow.md` §11a) — and reported "no module reaches an audit writer" while
    // `tenant-admin-audit.ts` was sitting in the same directory exporting
    // `TenantAdminAuditRecorder`. Deriving the symbol from the corpus is the repair.
    const files = existsSync(REPO + CORE_TREE)
      ? readdirSync(REPO + CORE_TREE).filter((name) => name.endsWith('.ts'))
      : [];
    const auditModule = files.find((name) => /TenantAdminAuditRecorder/.test(readFileSync(`${REPO}${CORE_TREE}/${name}`, 'utf8')));
    assertTrue(
      '0043 §7 — an audit recorder exists for this class',
      auditModule !== undefined,
      `no module under ${CORE_TREE} declares an audit recorder. 0007 rule 9 requires a privilege ` +
        'change audited and 0043 §7 says this milestone closes that gap rather than carrying it.',
    );
    console.log(`      audit recorder declared in: ${auditModule ?? 'NONE'}`);

    // AND THE QUESTION THAT ACTUALLY MATTERS. A recorder existing is not a record being written.
    // `owner-immunity.ts`'s own header cites the precedent: finding `M-1` was "a pair of
    // write-side guards with NO CALL SITES", where "omitting the call would be silent: nothing
    // fails, no test goes red." The audit charge is a receipt, so the question is what REQUIRES
    // one.
    //
    // ⚠ AND THIS ASSERTION HAS NOW BEEN WRONG TWICE, IN THE SAME WAY, WHICH IS THE FINDING.
    //   v1 searched for `AuditWriter|writeAuditRecord|...` — invented symbol names — and reported
    //      "no audit path" beside a file exporting `TenantAdminAuditRecorder`.
    //   v2 asserted the charge on `MembershipAdministrationStore` and reported it missing. IT IS
    //      REQUIRED AT THE DISPATCHER: `tenant-admin-routes.ts` charges at step 4b, before the
    //      gate and before the handler, hands the handler a `charge`, and writes the record at
    //      step 7 — FAILING THE REQUEST if it cannot be written (`0013` D2, audit must not fail
    //      open). That is the correct layer and strictly stronger than a per-store parameter:
    //      it covers denials too, which a store the request never reaches cannot.
    //
    // Both versions were `workflow.md` §11a's *a pattern written from the shape you had in mind
    // cannot see the shape the code takes* — and both would have reported a defect that was not
    // one. THE INSTRUMENT IS NOW DERIVED FROM THE DISPATCHER RATHER THAN IMAGINED.
    const consumers = files
      .filter((name) => !/tenant-admin-audit\.ts$/.test(name))
      .filter((name) => /TenantAdminWriteCharged/.test(readFileSync(`${REPO}${CORE_TREE}/${name}`, 'utf8')));
    console.log(`      modules REQUIRING a TenantAdminWriteCharged: ${consumers.join(', ') || 'NONE'}`);

    assertTrue(
      '0043 §7 — no tenant-admin request proceeds without the audit budget being charged',
      consumers.length > 0,
      'NOTHING REQUIRES A `TenantAdminWriteCharged`. The recorder, the receipt and its mint are ' +
        'built and nothing consumes them, so the audit is a DISCIPLINE rather than a MECHANISM ' +
        'on the one surface 0043 §7 says must close the gap — finding M-1 exactly. 0007 rule 9 ' +
        'requires a privilege change audited, and role assignment is that privilege change.',
    );

    // The charge is only half of it: charging the budget is not writing the record, and a
    // dispatcher that charged and then skipped the write would satisfy the assertion above.
    const dispatcher = files.find((name) => /matchTenantAdminRoute|tenantAdminRoutes/.test(readFileSync(`${REPO}${CORE_TREE}/${name}`, 'utf8')));
    assertTrue('a dispatcher exists to be examined', dispatcher !== undefined, 'no tenant-admin dispatcher found');
    if (dispatcher === undefined) return;
    const text = readFileSync(`${REPO}${CORE_TREE}/${dispatcher}`, 'utf8');
    assertTrue(
      "0043 §7 — the dispatcher records, and 0013 D2 — it FAILS THE REQUEST when it cannot",
      /TenantAdminAuditRecorder/.test(text) && /audit/i.test(text),
      `${dispatcher} requires a write charge but reaches no audit recorder — the budget is spent ` +
        'and no record is written, which is the worst of both.',
    );
  });

  return suite;
}
