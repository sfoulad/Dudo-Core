/**
 * ===========================================================================================
 * *** THE GRANTOR MAY NOT GRANT WHAT THE GRANTOR DOES NOT HOLD. `0007` D16 CONSTRAINT 1,
 * APPLIED TO ASSIGNMENT RATHER THAN CREATION. ***
 * `tenant-invitations-v1` `theGRANTCEILING` · `architecture.md` §3a.
 * ===========================================================================================
 *
 * The contract calls it **the most dangerous line in the file**, and the attack is one sentence:
 *
 *   *"invitation is a privilege-escalation route that looks like onboarding: invite an account
 *    with a role you may not hold, then sign in as it."*
 *
 * **IT NEEDS NO ROLE-ADMINISTRATION RIGHTS.** `core.user.invite` is enough. `0021_invitation.sql`
 * refuses `owner` in a `CHECK` and **does not refuse `admin`** — deliberately, because a legitimate
 * `owner` or `admin` must be able to invite an administrator. So the offered role is bounded by the
 * schema only at the very top, and everything below it is this file's problem.
 *
 * ===========================================================================================
 * WHY A RECEIPT AND NOT A CHECK — and this is the Team Lead's question answered in code
 * ===========================================================================================
 *
 * **A DECLARED SCOPE WOULD BE BETTER AND THERE IS NO DECLARATION THAT DOES THIS WORK.**
 * `architecture-agent`'s general form is right: *"a check can be absent, unimplemented, or relaxed
 * under pressure; a declared scope is enforced by the intersection rule every time authorization
 * runs, and there is nowhere for it to not-happen."*
 *
 * **But this rule is a comparison between two RUNTIME VALUES** — the set the offer confers against
 * the set the caller holds — and neither is known when a permission is declared. No `scopes:`
 * entry, no envelope entry and no route-table field can express it. `authorize()` never sees the
 * offer at all: it decides whether the caller may invite, not what the caller may offer.
 *
 * **SO THE STRONGEST AVAILABLE FORM IS `architecture.md` §3a's RECEIPT, WHICH IS STRICTLY BETTER
 * THAN A CHECK EVEN IF IT IS WEAKER THAN A DECLARATION.** *"A guard that must be REMEMBERED is a
 * discipline. A guard whose output the write REQUIRES is a mechanism."* `InvitationWriteStore`
 * requires a `GrantCeilingCleared`; `clearGrantCeiling` below is the only producer; no constructor
 * is exported. **Omitting the check does not compile.**
 *
 * ===========================================================================================
 * IT COMPARES PERMISSIONS, NEVER ROLE NAMES — and that is not a refinement
 * ===========================================================================================
 *
 * *"May a `business-admin` offer `admin`?"* is not answerable by comparing two strings, and a
 * ranking of role names would be **wrong by construction under D16**: a tenant may mint a custom
 * role whose name says nothing and whose grants exceed the inviter's. **The only sound comparison
 * is between the PERMISSION SETS**, which is what `0007` D16 constraint 1 says — a subset of the
 * creator's grants — and what `0043` §2a restates: *"a subset of an enumerable set is enumerable."*
 *
 * ===========================================================================================
 * *** WHAT THIS DOES NOT DO, STATED BECAUSE FOUR CONTRACTS CITE CONSTRAINT 1 AS "THE CONTROL". ***
 * ===========================================================================================
 *
 * `architecture.md` §3a's closing warning, and it applies with force here: **this is one layer and
 * it is not the load-bearing one.**
 *
 *   THE RECEIPT (here)          catches forgetting the guard — a BUILD failure, no row written.
 *                               **Blind to a deliberate cast, and BLIND TO A STALE FACT.**
 *   THE IN-STATEMENT GUARD      catches a bypass and a stale receipt, and holds on a database
 *     (owed, not written)       where a migration was never applied.
 *   ACCEPTANCE-TIME RE-CHECK    catches the window this cannot: **an invitation is accepted DAYS
 *     (owed, not written)       after it is created**, and the inviter's own authority may have
 *                               been reduced in between. A ceiling checked only at creation grants
 *                               on the strength of authority the grantor no longer has.
 *
 * **THE THIRD IS THE ONE WITH NO ANALOGUE IN THE OWNER-IMMUNITY CASE**, where mint and write are
 * milliseconds apart. Here the gap is the invitation's whole lifetime, and it is the reason this
 * file is necessary and not sufficient.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { forbidden } from '../kernel/errors.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import { grantsForRole } from '../authorization/roles.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';
import type { TenantAdminAuthority } from './tenant-admin-authority.ts';

/**
 * What is being offered: a seed role, and any custom roles alongside it.
 *
 * BOTH HALVES ARE CHECKED. A caller barred from offering `admin` and permitted to attach a custom
 * role carrying `admin`'s permissions would have the same escalation with an extra step.
 */
export type OfferedGrant = {
  readonly membershipRole: MembershipRole;
  readonly customRoleIds: readonly string[];
};

/**
 * The narrow port. **TWO READS, BOTH SCOPED TO ONE ORGANIZATION.**
 *
 * It cannot write, cannot enumerate members and cannot reach another tenant — `architecture.md`
 * §3a-0: a dependency a component does not use is reach it has not exercised.
 */
export type GrantCeilingStore = {
  /**
   * Every permission this principal effectively holds in this Organization — seed role and custom
   * roles combined, already unioned.
   *
   * *** IT RETURNS THE EFFECTIVE SET RATHER THAN THE ROLE NAMES, and the difference is the whole
   * point of the port. *** A caller handed role names would have to resolve them, which is a
   * second place the seed-plus-custom union is computed, and two places that must agree about a
   * privilege calculation are two places that will differ.
   */
  heldPermissions(
    organizationId: AuthenticatedOrganizationId,
    principalId: string,
  ): Promise<Result<readonly string[]>>;

  /**
   * The permissions one custom role grants, or `null` if no such role exists in this Organization.
   *
   * `null` MUST NOT BE READ AS "GRANTS NOTHING". `clearGrantCeiling` refuses on it: an offer naming
   * a role that does not exist is not an offer of an empty set, it is an offer nobody can evaluate,
   * and treating an unresolvable role as harmless is how a typo becomes a silent grant of less than
   * intended — or, if the row appears later, more.
   */
  customRolePermissions(
    organizationId: AuthenticatedOrganizationId,
    roleId: string,
  ): Promise<Result<readonly string[] | null>>;
};

const GRANT_CEILING_BRAND: unique symbol = Symbol('dudo.tenantAdmin.grantCeiling');

/**
 * PROOF THAT A NAMED OFFER, IN A NAMED ORGANIZATION, CONFERS NOTHING THE NAMED GRANTOR DOES NOT
 * ALREADY HOLD.
 *
 * IT NAMES THE OFFER AND NOT JUST THE GRANTOR. A receipt minted for *"invite as `member`"* must not
 * fund a write of *"invite as `admin`"* — that is the same hole `MembershipAdmission` closes by
 * naming its principal, one value along. `consumeGrantCeilingClearance` compares all three.
 *
 * NOT SINGLE-USE, for `OwnerImmunityCleared`'s reason: it certifies a FACT rather than consumed
 * capacity, re-use writes one invitation the primary key already bounds, and single-use copied
 * without its rationale is ceremony.
 *
 * ===========================================================================================
 * *** IT DOES NOT BIND THE RECIPIENT, AND `OwnerImmunityCleared` DOES. THE ASYMMETRY IS
 * DELIBERATE AND IT IS THE FIRST THING THAT WOULD HAVE TO CHANGE. ***
 * ===========================================================================================
 *
 * `OwnerImmunityCleared` names its **target**, because *"may this person be acted on"* is a
 * question about that person. **This receipt names the grantor and the offer and NOT the
 * recipient, because `0007` D16 constraint 1 is a comparison between two sets — what the offer
 * confers against what the grantor holds — and the recipient appears in neither.** *"May you
 * confer `admin`"* has the same answer whoever receives it.
 *
 * **SO THE OMISSION IS A PROPERTY OF THE RULE RATHER THAN AN OVERSIGHT, AND IT IS STATED BECAUSE A
 * READER COMPARING THE TWO RECEIPTS IN THIS TREE WILL OTHERWISE WONDER** — and because the answer
 * changes the moment the rule does.
 *
 * *** THE TRIGGER, NAMED SO IT IS NOT DISCOVERED: ANY RECIPIENT-DEPENDENT GRANT RULE. *** The
 * obvious candidate is *"you may not grant a role to a member outside your own business scope"* —
 * a rule that is plausible, that `0020`'s authorized business set makes cheap to evaluate, and that
 * **this receipt would silently fail to enforce.** A clearance minted against recipient A would
 * fund a write to recipient B, `consumeGrantCeilingClearance` would pass, and **nothing would go
 * red**, because the field the check would need is not in the type.
 *
 * **WHOEVER ADDS SUCH A RULE ADDS `recipientPrincipalId` TO THIS TYPE, TO THE FINGERPRINT AND TO
 * THE CONSUMER IN THE SAME CHANGE.** The three move together or the receipt is weaker than it
 * reads — which is `architecture.md` §3a's whole point about a guard that must be remembered.
 */
export type GrantCeilingCleared = {
  readonly [GRANT_CEILING_BRAND]: true;
  readonly organizationId: string;
  readonly grantorPrincipalId: string;
  /** The offered seed role, and the custom role ids SORTED, joined. Compared verbatim on use. */
  readonly offerFingerprint: string;
};

/** THE ONLY CONSTRUCTOR, AND IT IS MODULE-PRIVATE. */
function mintGrantCeilingClearance(
  organizationId: AuthenticatedOrganizationId,
  grantorPrincipalId: string,
  offerFingerprint: string,
): GrantCeilingCleared {
  // THE RECEIPT STORES THE UNWRAPPED VALUE. It is compared against another sealed context's
  // `.value` on use, so carrying the brand in here would buy nothing and would let a receipt hold
  // a second, independently-sealed object whose identity nothing checks.
  const cleared = { organizationId: organizationId.value, grantorPrincipalId, offerFingerprint };
  Object.defineProperty(cleared, GRANT_CEILING_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(cleared) as GrantCeilingCleared;
}

/**
 * The fingerprint of an offer. **SORTED, so the same offer in two orders is one fingerprint** — a
 * caller must not be able to defeat the comparison by reordering an array.
 *
 * A NUL IS NOT USED AS THE SEPARATOR, deliberately: this repository quarantines a file carrying
 * three raw NUL bytes that `grep` cannot see and `Edit` can barely match, and adding another to
 * save two characters would be paying a real tooling cost for nothing. `|` cannot occur in a role
 * identifier, which matches `^[A-Za-z0-9_-]{8,64}$`.
 *
 * ===========================================================================================
 * *** AND THE FIRST VERSION OF THIS SENTENCE CONTAINED A LITERAL NUL — AT BYTE 8588, INSIDE THE
 * COMMENT EXPLAINING WHY NOT TO USE ONE. ***
 * ===========================================================================================
 *
 * It was written as a QUOTED CHARACTER rather than named in words, so this file went binary to
 * `grep` the moment it was saved and `check:source-bytes` failed `SEVERE`. **It was found by a
 * sweep for something else entirely** — a `grep` for stale absence claims reported
 * `Binary file … matches`, which is the one way an invisible file announces itself.
 *
 * **THE RULE THAT FOLLOWS IS NARROW AND MECHANICAL: name a control character in WORDS in prose,
 * and build it with `String.fromCharCode` in code. Never type one, and never QUOTE one in order to
 * talk about it** — the second is the case the existing guidance did not cover, because it is
 * about documentation rather than about a value.
 *
 * *** A DATA POINT THE RECORD DOES NOT HAVE, AND IT CONTRADICTS THE RECORD. *** `workflow.md` §11a
 * says `Edit` *"failed every time it anchored with a backslash-escape"* and that the technique that
 * worked was a typed space where the NUL sits. **Here the reverse held, measured in two calls:**
 *
 * ```
 * anchored with a TYPED SPACE      -> "String to replace not found in file"
 * anchored with a BACKSLASH-U-0000 ESCAPE, spelled out    -> matched, replaced, file clean
 * ```
 *
 * *** AND WRITING THAT LINE RE-INTRODUCED A NUL AT BYTE 10393, WHICH IS WHY THE ESCAPE IS SPELLED
 * IN CAPITALS ABOVE RATHER THAN SHOWN. *** The editing tool RESOLVED the escape and wrote the
 * character — `workflow.md` §11a's mirror hazard, met while documenting the original one, in the
 * same file, minutes later.
 *
 * **SO THE RULE IS STRICTER THAN "DO NOT TYPE A CONTROL CHARACTER": ITS ESCAPE CANNOT BE WRITTEN IN
 * PROSE EITHER, BECAUSE THE ESCAPE IS RESOLVED ON THE WAY TO DISK.** There is no way to depict one
 * in a comment. **Name it in words or do not mention it.** Two NULs in one file in one session,
 * both introduced while explaining NULs, and neither by a mechanism the existing guidance covers —
 * that guidance is about VALUES IN CODE, and both of these were DOCUMENTATION.
 * ```
 * ```
 *
 * **So "inconsistent rather than impossible" is right and the CHARACTERISATION OF WHICH FORM WORKS
 * IS NOT.** Try both; neither is the technique. Recorded here rather than in the rules because a
 * single observation is what produced the claim being corrected, and one more observation should
 * not replace it with a second over-general one.
 */
function fingerprintOffer(offer: OfferedGrant): string {
  return `${offer.membershipRole}|${[...offer.customRoleIds].sort().join('|')}`;
}

export class GrantCeilingNotClearedError extends Error {
  constructor(reason: string) {
    super(
      `An invitation or role assignment was attempted without a valid grant-ceiling clearance: ` +
        `${reason}. docs/decisions/0007 D16 constraint 1, applied to assignment: the grantor may ` +
        'not grant what the grantor does not hold. Without it, invitation is a ' +
        'privilege-escalation route that looks like onboarding — invite an account with a role ' +
        'you may not hold, then sign in as it. Obtain a clearance from clearGrantCeiling, which ' +
        "is the only producer and which reads the grantor's own effective permissions.",
    );
    this.name = 'GrantCeilingNotClearedError';
  }
}

/**
 * Verifies a receipt and binds it to the write. Called by the adapter, immediately before the
 * statement.
 *
 * THREE CHECKS: the brand, the Organization, and **the offer itself**. The third is what stops a
 * clearance obtained for a harmless offer funding a dangerous one.
 */
export function consumeGrantCeilingClearance(
  clearance: GrantCeilingCleared,
  /** The authority, matching `clearGrantCeiling` — see there for why it is not a loose pair. */
  authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>,
  offer: OfferedGrant,
): void {
  const organizationId = authority.organizationId;
  const grantorPrincipalId = authority.principalId;
  const branded = clearance as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[GRANT_CEILING_BRAND] !== true) {
    throw new GrantCeilingNotClearedError('the value did not come from clearGrantCeiling');
  }
  if (clearance.organizationId !== organizationId.value) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked in a different Organization than the row being written',
    );
  }
  if (clearance.grantorPrincipalId !== grantorPrincipalId) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked for a different grantor than the one writing',
    );
  }
  if (clearance.offerFingerprint !== fingerprintOffer(offer)) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked for a different offer than the one being written',
    );
  }
}

/**
 * ===========================================================================================
 * *** THE SUBSET A STORAGE ADAPTER CAN CHECK. IT CHECKS STRICTLY LESS — USE
 * `consumeGrantCeilingClearance` WHEREVER THE AUTHORITY AND THE OFFER ARE IN HAND. ***
 * ===========================================================================================
 *
 * **WHY A SECOND, WEAKER CONSUMER EXISTS AT ALL.** `InvitationStore.createInvitation` takes
 * `(organizationId, record, customRoleIds, ceiling, reservation)` — **no authority and no offer** —
 * so the full consumer cannot be called there. Writing the adapter is what surfaced that: the
 * compiler reported `ceiling` as a required parameter that is never read, which is `architecture.md`
 * §3a's *"receipt minted for A and spent on B"* hole showing up as a diagnostic.
 *
 * **WHAT THIS CHECKS:** the brand, so the value came from `clearGrantCeiling`; and the
 * **Organization**, so a clearance minted in one tenant cannot fund a write in another. That second
 * clause is the tenant-isolation half and it is the one `security.md` §1 cares about.
 *
 * *** WHAT IT DOES NOT CHECK, NAMED RATHER THAN LEFT TO A READER TO NOTICE: *** the **grantor** and
 * the **offer fingerprint**. So within one Organization, a clearance minted for a different
 * administrator, or for a different offered role, is spent here without complaint. **That is a real
 * residual and it is not closed by this function** — it closes when the port carries the authority
 * and the offer, or when the service consumes the clearance before calling the store.
 *
 * **DO NOT REACH FOR THIS ONE BECAUSE IT TAKES FEWER ARGUMENTS.** It is named for the boundary it
 * serves rather than for what it does, precisely so that using it in a handler reads as wrong.
 *
 * ===========================================================================================
 * *** ONE CLEARANCE IS CONSUMED TWICE, DELIBERATELY. THAT IS NOT A BUG AND IT IS NOT A LEAK. ***
 * ===========================================================================================
 *
 * Ruled 2026-09-13, after the adapter surfaced that the port could verify only half of it.
 * `InvitationService.create` consumes the **grantor identity and the offer fingerprint**; this
 * consumes the **brand and the Organization**. **Neither subsumes the other** — a clearance minted
 * for a different administrator in the same Organization is caught only above, and a service that
 * forgot to consume at all is caught only here.
 *
 * **WHY TWICE IS SOUND, AND `architecture.md` §3a DRAWS THE LINE EXACTLY HERE:** a **capacity**
 * receipt must be single-use, because spending it twice spends one budget on two writes — that is
 * `ControlPlaneWriteReservation`, and it is consumed **once**, in the adapter. **This is a FACT
 * receipt.** Re-asking a fact consumes nothing, so two vantage points on one unchanged assertion
 * cost nothing and cover more. *"Single-use copied without its rationale is the exported-mint
 * mistake again."*
 *
 * **WRITTEN AT BOTH SITES ON PURPOSE.** A reader who meets only one of them sees a receipt spent
 * twice and reasonably concludes one call is redundant — and the one they would delete is whichever
 * they happened to meet second.
 */
export function consumeGrantCeilingClearanceAtStorage(
  clearance: GrantCeilingCleared,
  organizationId: string,
): void {
  const branded = clearance as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[GRANT_CEILING_BRAND] !== true) {
    throw new GrantCeilingNotClearedError('the value did not come from clearGrantCeiling');
  }
  if (clearance.organizationId !== organizationId) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked in a different Organization than the row being written',
    );
  }
}

/**
 * THE ONLY PRODUCER. Reads the grantor's effective permissions and refuses an offer that exceeds
 * them.
 *
 * ===========================================================================================
 * *** IT ANSWERS `forbidden`, NEVER `invalid_argument`, AND THE CONTRACT IS EXPLICIT. ***
 * ===========================================================================================
 *
 * **The request is well-formed; the caller lacks the authority.** `admin` is a valid value of the
 * role union and a valid value of `0021`'s `CHECK` — nothing about the REQUEST is malformed, and
 * answering `invalid_argument` would tell a caller to fix their input when the input is fine.
 *
 * **THE NATURAL INSTINCT ON A BAD ROLE VALUE IS `invalid_argument`, WHICH IS WHY THIS IS WRITTEN
 * DOWN.** The two cases sit one line apart in any handler: a role outside the union is
 * `invalid_argument`, and a role inside the union that this caller may not confer is `forbidden`.
 *
 * ===========================================================================================
 * AN UNRESOLVABLE CUSTOM ROLE REFUSES. AN EMPTY OFFER DOES NOT.
 * ===========================================================================================
 *
 * A named role with no row is refused — see `customRolePermissions`. **A role that resolves to an
 * empty permission set is permitted**, because the empty set is a subset of everything and a role
 * granting nothing confers nothing. Those are different facts and collapsing them would refuse a
 * legitimate placeholder role.
 *
 * ===========================================================================================
 * THE STALENESS LIMIT, WHICH IS LARGER HERE THAN ANYWHERE ELSE IN THIS TREE
 * ===========================================================================================
 *
 * This certifies a fact true at the moment it was read. `OwnerImmunityCleared` has a window of
 * milliseconds; **an invitation is accepted days later**, and the acceptance path owes its own
 * re-check. Stated in the header as owed rather than implied to be covered.
 *
 * *** AND THE WINDOW HAS TWO CAUSES, NOT ONE. THE FIRST VERSION OF THIS NOTE NAMED ONE AND WOULD
 * HAVE PRODUCED A RE-CHECK THAT CATCHES HALF. ***
 *
 * ```
 * THE GRANTOR SHRINKS   the inviter's own authority is reduced between create and acceptance
 * THE ROLE GROWS        `updateRoleInput` is "THE COMPLETE REPLACEMENT SET", so a custom role's
 *                       CONTENTS can be widened between create and acceptance
 * ```
 *
 * **SAME EFFECT — a grant conferred that the ceiling would refuse today — BY DIFFERENT MECHANISMS,
 * and only the first was written down.** An implementer building literally to the old sentence
 * checks that the grantor still holds their tier **and catches nothing in the second case**, because
 * the grantor never moved.
 *
 * **THE IMPLEMENTATION ALREADY COVERS BOTH AND THE NOTE DID NOT** — re-running `clearGrantCeiling`
 * whole re-resolves `customRolePermissions` from the store, so a role that grew is compared fresh.
 * **The remedy is therefore "re-run this function", never "re-check the grantor"**, and the
 * difference between those two sentences is the whole finding. `§11a`: *name the question, not the
 * answer set* — a cause with a consequence pre-assigned is one nobody re-examines.
 *
 * *** WHAT IS NOT DECIDED, AND MUST NOT BE PICKED SILENTLY: *** re-check-at-acceptance versus
 * revoke-on-authority-change. They are not interchangeable, and the second reason is the decisive
 * one — **revocation has nothing sensible to say about a role that GREW**, since no authority
 * changed and there is nothing to revoke. `security-agent` declined to choose and so does this
 * file. **Raise it when the acceptance path is real.**
 *
 * **AND THE RESIDUAL BITES THE OBVIOUS REMEDY:** if the grantor has left the Organization,
 * `heldPermissions` returns empty and **every pending invitation they issued dies at acceptance.**
 * That is a consequence of re-checking, not an argument against it — recorded so whoever chooses
 * meets it before shipping rather than after.
 */
export async function clearGrantCeiling(
  store: GrantCeilingStore,
  /**
   * *** THE AUTHORITY, NOT TWO LOOSE VALUES — AND THE REASON IS THAT ONE OF THEM WAS A BARE
   * STRING BESIDE A TYPED ONE. ***
   *
   * `security-agent`, 2026-09-13: `MembershipSubject` wraps its Organization and its target and
   * says *"never from a request"*, while the grantor arrived here as a plain `string`. **Two
   * principal identifiers in one call, one wrapped and one not, and the ceiling is computed
   * against whichever is passed.**
   *
   * **IT TRIED TO CONSTRUCT A CASE WHERE THE MIX-UP ADMITS SOMETHING AND COULD NOT.** Passing the
   * TARGET as the grantor computes against lower grants and refuses MORE; on a demotion it gives
   * the same answer. **Fail-closed — and fail-closed because of a property of the current
   * four-tier lattice rather than because of anything in this function.**
   *
   * > **The eighteen permissions with the user are precisely the thing that changes that lattice.**
   *
   * So the pair now arrives as one authenticated object. **There is no parameter a target
   * principal could be passed through**, which makes the mix-up unrepresentable rather than
   * harmless — the same move as the `AuthenticatedOrganizationId` brand, one value along.
   */
  authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>,
  offer: OfferedGrant,
): Promise<Result<GrantCeilingCleared>> {
  const organizationId = authority.organizationId;
  const grantorPrincipalId = authority.principalId;
  const held = await store.heldPermissions(organizationId, grantorPrincipalId);
  if (!held.ok) {
    return err(held.error);
  }
  const heldSet: ReadonlySet<string> = new Set(held.value);

  // ---- THE SEED ROLE THE OFFER CONFERS. Read through `grantsForRole`, which is the ONLY place a
  // role name becomes permissions (`AUTHORIZATION_STANDARD.md` §9). A second mapping here would be
  // a privilege calculation with two implementations.
  for (const grant of grantsForRole(offer.membershipRole).grants) {
    if (!heldSet.has(grant.permissionId)) {
      return err(forbidden());
    }
  }

  // ---- AND EVERY CUSTOM ROLE ATTACHED TO THE OFFER.
  for (const roleId of offer.customRoleIds) {
    const rolePermissions = await store.customRolePermissions(organizationId, roleId);
    if (!rolePermissions.ok) {
      return err(rolePermissions.error);
    }
    if (rolePermissions.value === null) {
      // A role the offer names and this Organization does not have. Refused rather than skipped —
      // see the header.
      return err(forbidden());
    }
    for (const permissionId of rolePermissions.value) {
      if (!heldSet.has(permissionId)) {
        return err(forbidden());
      }
    }
  }

  return ok(
    mintGrantCeilingClearance(organizationId, grantorPrincipalId, fingerprintOffer(offer)),
  );
}

// =============================================================================================
// *** D16 CONSTRAINT 1 AT ITS ORIGINAL SITE: ROLE CREATION. ***
// =============================================================================================

const ROLE_CEILING_BRAND: unique symbol = Symbol('dudo.tenantAdmin.roleCeiling');

/**
 * PROOF THAT A NAMED PERMISSION LIST, IN A NAMED ORGANIZATION, CONTAINS NOTHING THE NAMED CREATOR
 * DOES NOT ALREADY HOLD.
 *
 * ===========================================================================================
 * THIS IS THE CHECK `security-agent` LOOKED FOR AND DID NOT FIND, AT THE PLACE IT BELONGS.
 * ===========================================================================================
 *
 * `0007` D16 constraint 1: **a custom role may contain only permissions the creating principal
 * itself holds — creating a role IS a grant.** `clearGrantCeiling` above applies the same rule to
 * ASSIGNMENT, which is where `tenant-invitations-v1` needs it; this is the rule at CREATION, which
 * is where D16 states it.
 *
 * **THEY SHARE THE COMPARISON AND NOT THE RECEIPT, DELIBERATELY.** One brand covering both would
 * let a clearance minted for *"create a role holding X"* fund *"invite somebody as a role holding
 * X"* — two different writes, two different tables, one token. **The subset arithmetic is shared
 * because it must not differ; the receipts are separate because the writes are.**
 *
 * *** WHAT THIS BUYS THAT A CHECK DOES NOT, AND IT IS THE WHOLE REASON THE FILE IS SHAPED THIS
 * WAY: THE STATIC REACHABILITY ASSERTIONS IN THIS CLASS DEPEND ON CONSTRAINT 1 HOLDING. ***
 * `tenant-admin-permissions.ts` and `assertNoRouteConjunctionIsUnsatisfiable` both reason *"a
 * custom role is a subset of its creator's grants, therefore bounded by the seed roles"* — and
 * both carry an expiry notice saying that argument is true today only because **no custom role can
 * exist.** This is the thing that makes it true when they can.
 *
 * **SO THE ORDERING OBLIGATION THOSE NOTICES STATE IS DISCHARGED BY REQUIRING THIS TYPE**: a
 * creation route cannot be written without one, because the write takes it as a parameter and
 * there is no other producer. **The obligation stops being a note somebody has to collect.**
 */
export type RoleCeilingCleared = {
  readonly [ROLE_CEILING_BRAND]: true;
  readonly organizationId: string;
  readonly creatorPrincipalId: string;
  /** The permission ids, SORTED and joined. Compared verbatim on use. */
  readonly permissionFingerprint: string;
};

/** THE ONLY CONSTRUCTOR, AND IT IS MODULE-PRIVATE. */
function mintRoleCeilingClearance(
  organizationId: AuthenticatedOrganizationId,
  creatorPrincipalId: string,
  permissionFingerprint: string,
): RoleCeilingCleared {
  // The unwrapped value, for `mintGrantCeilingClearance`'s reason.
  const cleared = { organizationId: organizationId.value, creatorPrincipalId, permissionFingerprint };
  Object.defineProperty(cleared, ROLE_CEILING_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(cleared) as RoleCeilingCleared;
}

/** Sorted, so the same list in two orders is one fingerprint. See `fingerprintOffer`. */
function fingerprintPermissions(permissionIds: readonly string[]): string {
  return [...permissionIds].sort().join('|');
}

/**
 * Verifies a role-creation receipt and binds it to the write.
 *
 * Same three-plus-one checks as `consumeGrantCeilingClearance`: the brand, the Organization, the
 * creator, and **the exact permission list**. A clearance obtained for a modest role must not fund
 * the creation of a broader one.
 */
export function consumeRoleCeilingClearance(
  clearance: RoleCeilingCleared,
  /** The authority, matching `clearRoleCeiling`. */
  authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>,
  permissionIds: readonly string[],
): void {
  const organizationId = authority.organizationId;
  const creatorPrincipalId = authority.principalId;
  const branded = clearance as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[ROLE_CEILING_BRAND] !== true) {
    throw new GrantCeilingNotClearedError('the value did not come from clearRoleCeiling');
  }
  if (clearance.organizationId !== organizationId.value) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked in a different Organization than the role being written',
    );
  }
  if (clearance.creatorPrincipalId !== creatorPrincipalId) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked for a different creator than the one writing',
    );
  }
  if (clearance.permissionFingerprint !== fingerprintPermissions(permissionIds)) {
    throw new GrantCeilingNotClearedError(
      'the clearance was checked for a different permission list than the one being written',
    );
  }
}

/**
 * THE ONLY PRODUCER. Refuses a proposed role holding anything the creator does not hold.
 *
 * `forbidden`, for `clearGrantCeiling`'s reason: the request is well-formed and the caller lacks
 * the authority. **A permission identifier that is not in the catalogue at all is a DIFFERENT
 * failure and is not this function's** — it is `invalid_argument`, decided before this runs, and
 * merging the two would answer `forbidden` for a typo.
 *
 * **AN EMPTY PERMISSION LIST IS PERMITTED.** The empty set is a subset of everything, and a role
 * granting nothing is a legitimate placeholder — the same ruling `clearGrantCeiling` makes for a
 * custom role that resolves to no permissions.
 *
 * *** THE STALENESS LIMIT IS THE SAME AND THE WINDOW IS SMALL. *** Unlike an invitation, a role is
 * created in one request, so mint and write are milliseconds apart rather than days. **The
 * in-statement guard is still owed** — `architecture.md` §3a, the only layer with no window — and
 * `0022_tenant_role.sql` already records where it goes: the `WHERE` of the `INSERT` that writes a
 * `tenant_role_permission` row, comparing against the creator's held set in the same statement.
 * **This receipt is what makes forgetting it a compile error; it is not what makes it atomic.**
 */
export async function clearRoleCeiling(
  store: GrantCeilingStore,
  /** The authority, for `clearGrantCeiling`'s reason: one authenticated object, no loose pair. */
  authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>,
  permissionIds: readonly string[],
): Promise<Result<RoleCeilingCleared>> {
  const organizationId = authority.organizationId;
  const creatorPrincipalId = authority.principalId;
  const held = await store.heldPermissions(organizationId, creatorPrincipalId);
  if (!held.ok) {
    return err(held.error);
  }
  const heldSet: ReadonlySet<string> = new Set(held.value);
  for (const permissionId of permissionIds) {
    if (!heldSet.has(permissionId)) {
      return err(forbidden());
    }
  }
  return ok(
    mintRoleCeilingClearance(
      organizationId,
      creatorPrincipalId,
      fingerprintPermissions(permissionIds),
    ),
  );
}
