/**
 * ===========================================================================================
 * THE MEMBERSHIP-ADMINISTRATION WRITE PORT. `docs/decisions/0043` §3c and §3d.
 * ===========================================================================================
 *
 * `0003_organization_membership.sql` has said since it was written that *"NOTHING IN THIS
 * REPOSITORY WRITES A ROW HERE"*, and `platform-authority.ts` names the consequence precisely:
 * *"MEMBERSHIP ADMINISTRATION CAN [hit `0024`'s trap], and the realistic route to it is entirely
 * reasonable"*. This is the port that surface will be built on, declared BEFORE its first route so
 * that the receipts are already required rather than added afterwards.
 *
 * **NO ADAPTER IMPLEMENTS IT YET AND THAT IS STATED RATHER THAN LEFT TO BE DISCOVERED.** What
 * exists here is the SHAPE: what a caller must hold before a membership row can be written,
 * expressed as parameters a caller cannot fabricate.
 *
 * ===========================================================================================
 * THE SCHEMA THIS PORT DEPENDS ON, WRITTEN AS CONDITIONS RATHER THAN AS FACTS. `0043` §7a.
 * ===========================================================================================
 *
 * *** THIS PARAGRAPH SAID "the `invitation` and `branch` tables do not exist, the `role` CHECK does
 * not admit `admin`" UNTIL 2026-09-13, AND BOTH HALVES WERE FALSE. *** `0021_invitation.sql`
 * creates the table and its `CHECK` admits `'admin'`; `0004_branch.sql` creates the other;
 * `0018_membership_role_admin.sql` widens the membership `CHECK` to four roles. **`security-agent`
 * found it as LOW-2, and the reason it is worth more than a LOW is WHERE it was:**
 *
 * > **A stale sentence telling the next reader that the escalation cannot happen, sitting in the
 * > module that carries the ceiling against that escalation.**
 *
 * `architecture.md` §3c: a comment that stops the next reader looking is worse than silence,
 * because silence prompts the question. **This one said the door was not built, in the file that
 * holds the lock.**
 *
 * **SO THE DEPENDENCIES ARE STATED AS CONDITIONS, WHICH STAY TRUE WHICHEVER WAY THE WORLD GOES:**
 *
 *   - this port's writes require the `organization_membership` `CHECK` to admit the role being
 *     written — `0018` widens it to `owner | admin | business-admin | member`;
 *   - `transferOwnership` requires the partial unique index — `0019`;
 *   - the invitation path requires an `invitation` table — `0021`, and its custom-role carriage
 *     is `0022`'s `invitation_custom_role`.
 *
 * **EVERY ONE OF THOSE MIGRATIONS IS WRITTEN AND UNAPPLIED, AND APPLYING ONE IS THE USER'S, EVERY
 * TIME** (`security.md` §7). **A condition survives the day they are applied; a fact does not** —
 * which is exactly how the sentence this replaces became false without anybody editing it.
 *
 * ===========================================================================================
 * EVERY MUTATING METHOD TAKES THREE THINGS, AND TWO OF THEM CANNOT BE CONSTRUCTED BY A CALLER
 * ===========================================================================================
 *
 *   `OwnerImmunityCleared`          the target is not the `owner`      `owner-immunity.ts`
 *   `ControlPlaneWriteReservation`  the daily budget was charged       `control-plane-admission.ts`
 *   the row itself
 *
 * **THE COMPILER IS THE ENUMERATION OF THE CALL SITES.** `0043` §8.4 requires a behavioural denial
 * case per action rather than one representative case, and the set of actions is not a list
 * somebody maintains — it is every method below whose signature names `OwnerImmunityCleared`.
 * Adding a sixth without one does not compile.
 *
 * ===========================================================================================
 * *** WHAT IS DELIBERATELY ABSENT: THERE IS NO `setMembershipRole` THAT CAN WRITE `owner`. ***
 * ===========================================================================================
 *
 * `assignRole` takes a `NonOwnerMembershipRole`, which is the union minus `owner`, so the ONE
 * operation that can put `'owner'` into that column is `transferOwnership` — a different method,
 * with a different permission `0043` §3d says `admin` must never hold, and an ordering it forces
 * rather than documents.
 *
 * **A ROLE PARAMETER WIDE ENOUGH TO CARRY `'owner'` WOULD MAKE THE WHOLE OF §3c A CONVENTION.**
 * Promotion to owner would then be reachable from the member-administration path, the singular
 * ownership invariant would rest on the partial unique index alone, and that index refuses TWO
 * owners while being blind to ZERO.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { forbidden } from '../kernel/errors.ts';
import type { ControlPlaneWriteReservation } from '../identity/control-plane-admission.ts';
import type { OwnerImmunityStore } from './owner-immunity.ts';
import type { TenantAdminAuthority } from './tenant-admin-authority.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import type { OwnerImmunityCleared } from './owner-immunity.ts';
import type { GrantCeilingCleared } from './grant-ceiling.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';

/**
 * Every membership role EXCEPT `owner`.
 *
 * DERIVED WITH `Exclude` RATHER THAN RE-LISTED, so a fifth role added to `MembershipRole` is
 * assignable here automatically and a rename of `owner` is a compile error rather than a silently
 * widened parameter. `workflow.md` §11a: *"the subject is DERIVED FROM THE ARTIFACT, never
 * transcribed alongside it"* — a transcribed list here would be a second copy of the union in a
 * file that cannot see the first.
 *
 * *** AND NOTE WHAT DERIVING BUYS AND WHAT IT DOES NOT. *** It keeps this type correct when the
 * union grows. It does NOT decide whether the new role should be assignable through this path,
 * and the default it produces is "yes". A role that must not be assignable — a future
 * `platform-liaison`, say — needs excluding here deliberately, and nothing will ask.
 */
export type NonOwnerMembershipRole = Exclude<MembershipRole, 'owner'>;

/** The subject of an administrative act: one member of one Organization. */
export type MembershipSubject = {
  /** FROM `TenantAdminAuthority`, which read it off the session row. Never from a request. */
  readonly organizationId: AuthenticatedOrganizationId;
  readonly targetPrincipalId: string;
};

/**
 * The two principals an ownership transfer moves between, plus the role the outgoing owner lands
 * on.
 *
 * `toRole` IS REQUIRED AND HAS NO DEFAULT. A transfer that defaulted the outgoing owner to
 * `member` would silently strip an administrator; one that defaulted to `admin` would silently
 * retain administrative authority for someone who just gave up the Organization. **Both are
 * decisions, and neither is one this type should make on a caller's behalf** — the contract that
 * publishes the route says which, and the caller states it.
 */
export type OwnershipTransfer = {
  readonly organizationId: AuthenticatedOrganizationId;
  /** The current owner. Verified to hold `owner` INSIDE the statement that demotes it. */
  readonly fromPrincipalId: string;
  /** The incoming owner. Verified to hold an ACTIVE membership inside the statement. */
  readonly toPrincipalId: string;
  /** What the outgoing owner becomes. Required; see above. */
  readonly toRole: NonOwnerMembershipRole;
};

export type MembershipAdministrationStore = {
  /**
   * Suspends a member. A suspended membership is treated identically to no membership at all —
   * the same argument-free `notFound()` from `session-resolution.ts` ruling 1 — and it collapses a
   * live session to "organization not selected" **on the very next request**, which is what makes
   * revocation immediate rather than effective at session expiry (`0003`).
   */
  suspendMembership(
    subject: MembershipSubject,
    clearance: OwnerImmunityCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /** Reverses a suspension. It takes a clearance for the reason every method here does: uniformity
   * removes the question "which of these five needed it", and a method without one is the method a
   * future reader copies. */
  reactivateMembership(
    subject: MembershipSubject,
    clearance: OwnerImmunityCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /** Removes the membership row entirely. */
  removeMembership(
    subject: MembershipSubject,
    clearance: OwnerImmunityCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * Sets a member's role to any role EXCEPT `owner`. See the header for why the parameter is
   * narrowed rather than validated.
   *
   * IT IS BOTH THE PROMOTION AND THE DEMOTION PATH for everything below ownership, and it takes
   * **TWO receipts because it crosses two different boundaries.**
   *
   * ===========================================================================================
   * *** THE GRANT CEILING WAS MISSING HERE UNTIL 2026-09-13, AND `Exclude<>` IS WHY NOBODY SAW
   * IT — INCLUDING ME, WHO WROTE BOTH. ***
   * ===========================================================================================
   *
   * The signature carried a narrowed role type, an owner-immunity clearance and a reservation.
   * **On the PROMOTION path, omitting the authority bound COMPILED.**
   *
   * > **`NonOwnerMembershipRole = Exclude<MembershipRole, 'owner'>` SITS IN THE PARAMETER SLOT
   * > WHERE AN AUTHORITY BOUND WOULD GO. IT READS AS THE AUTHORITY GUARD AND IT IS A RANGE
   * > CHECK.** It answers *"is this a legal role value"* and never *"may you confer it"* — and a
   * > reader scanning the signature sees a narrowed type beside a clearance and concludes the
   * > authority question is handled.
   *
   * **THAT IS THE SECOND JOB `Exclude<>` LOOKS LIKE IT IS DOING IN THIS FILE AND IS NOT.** The
   * first is disclosed at `NonOwnerMembershipRole` itself: it keeps the type correct when the union
   * grows and **decides nothing about whether a new role should be assignable**, defaulting to yes.
   * Same construct, two different guarantees a reader may credit it with, neither of which it
   * provides. **A narrowed type is a statement about a VALUE; both of the missing guarantees are
   * statements about AUTHORITY.**
   *
   * ===========================================================================================
   * THE TWO RECEIPTS ANSWER DIFFERENT QUESTIONS AND NEITHER IMPLIES THE OTHER
   * ===========================================================================================
   *
   *   `OwnerImmunityCleared`   protects the person being ACTED ON — may this target be touched?
   *   `GrantCeilingCleared`    bounds the authority being HANDED OVER — may this grantor confer
   *                            this role? (`0007` D16 constraint 1, applied to assignment)
   *
   * **A demotion needs the first and a promotion needs both**, and the port requires both on every
   * call rather than branching — a signature that varied with the direction of the change would be
   * a signature whose safety depends on classifying the change correctly, which is the thing the
   * caller is least able to do.
   *
   * *** TWO ADJACENT RECEIPT PARAMETERS ARE SAFE HERE, AND `control-plane-store.ts` EXPLAINS WHY
   * THAT NEEDED CHECKING. *** It refused a fourth positional argument on `createMembership`
   * because *"two adjacent parameters of the same shape are a call site waiting to be written
   * backwards."* **These two have different BRANDS, so transposing them does not compile** — the
   * hazard that ruling is about does not reach a pair of distinctly-branded types.
   */
  assignRole(
    subject: MembershipSubject,
    role: NonOwnerMembershipRole,
    clearance: OwnerImmunityCleared,
    ceiling: GrantCeilingCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * Ends every live session belonging to a member.
   *
   * IT IS AN ACT ON THE MEMBER AND CARRIES THE SAME CLEARANCE, which `0043` §3d requires by name —
   * *"suspend, remove, demote, revoke sessions"*. It is the one of the four that does not write to
   * `organization_membership` at all, and therefore the one where a reader might reasonably think
   * the immunity does not apply. **It applies: an `admin` who can end the owner's sessions can
   * lock the owner out while it works.**
   */
  revokeMemberSessions(
    subject: MembershipSubject,
    clearance: OwnerImmunityCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;

  /**
   * =========================================================================================
   * *** THE ONLY OPERATION THAT MAY WRITE `'owner'`. ONE ATOMIC DEMOTE-AND-PROMOTE, IN THAT
   * ORDER. `docs/decisions/0043` §3c. ***
   * =========================================================================================
   *
   * `0043` §3c: *"A transfer is one atomic demote-and-promote, never a promote followed by a
   * demote — the intermediate state of the second ordering is two owners, which the index must
   * refuse anyway, so the ordering is forced rather than chosen."*
   *
   * IT TAKES NO `OwnerImmunityCleared`, AND THE ABSENCE IS THE DESIGN. Its target IS the owner;
   * a clearance for it could not be minted, because `clearOwnerImmunity` refuses an owner target
   * whoever the actor is. What gates this instead is the permission — `core.organization.transfer
   * -ownership`, which `0043` §3d says `admin` must never hold — decided by `authorize()` before
   * the handler runs.
   *
   * =========================================================================================
   * WHAT THE ADAPTER MUST DO, WRITTEN HERE BECAUSE A PORT CANNOT ENFORCE IT
   * =========================================================================================
   *
   * **TWO STATEMENTS IN ONE ATOMIC BATCH, DEMOTE FIRST.** Not one statement: a single
   * multi-row `UPDATE … SET role = CASE principal_id …` is order-dependent inside SQLite, which
   * checks a UNIQUE index per row as it writes, so whether the promote lands before the demote is
   * a property of row order rather than of the statement. **The batch is what makes it atomic and
   * the ORDER is what keeps it from ever holding two owners.**
   *
   * BOTH STATEMENTS CARRY THEIR GUARD IN THEMSELVES — `architecture.md` §3a's only layer with no
   * window:
   *
   *   1. `UPDATE … SET role = :toRole
   *        WHERE organization_id = :org AND principal_id = :from AND role = 'owner'`
   *      Zero rows changed means the named principal was not the owner. **THE BATCH MUST THEN FAIL
   *      RATHER THAN CONTINUE** — a promote that follows a demote which changed nothing is how an
   *      Organization acquires a second owner, and the index would be the only thing left.
   *
   *   2. `UPDATE … SET role = 'owner'
   *        WHERE organization_id = :org AND principal_id = :to AND status = 'active'
   *          AND NOT EXISTS (SELECT 1 FROM organization_membership
   *                           WHERE organization_id = :org AND role = 'owner')`
   *      The `NOT EXISTS` re-asks the singular-ownership question **in the statement that writes**,
   *      so it holds on a database where `0019` was never applied, and it holds against a stale
   *      read. `status = 'active'` refuses promoting a suspended member into ownership.
   *
   * **NEITHER GUARD IS THE UNIQUE INDEX AND THE INDEX IS NOT THESE GUARDS.** The index refuses TWO
   * owners and is blind to ZERO; guard 1 is the only thing that refuses zero. Stated because
   * *"the index will catch it"* is the sentence that would remove guard 1.
   */
  transferOwnership(
    transfer: OwnershipTransfer,
    admission: OwnershipTransferAdmission,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;
};

// =============================================================================================
// *** WHO MAY MOVE OWNERSHIP. `security-agent` item 1, 2026-09-13. ***
// =============================================================================================

const OWNERSHIP_TRANSFER_BRAND: unique symbol = Symbol('dudo.tenantAdmin.ownershipTransfer');

/**
 * PROOF THAT THE CALLER **IS** THE OUTGOING OWNER.
 *
 * ===========================================================================================
 * THE FINDING, AND WHY THE PROPOSED INSTRUMENT WOULD HAVE BEEN A VACUOUS GUARD
 * ===========================================================================================
 *
 * `security-agent`: the two in-statement guards are excellent **and they answer a different
 * question.** They refuse *zero owners* and *two owners*. **Neither asks whether the CALLER was
 * entitled to move ownership at all**, and today the only thing that does is
 * `core.organization.transfer-ownership` being held by no role — **a grant-time discipline, which
 * `architecture.md` §3a exists to distrust.**
 *
 * *** A `GrantCeilingCleared` WAS PROPOSED AND IS REFUSED, ON A MEASUREMENT RATHER THAN A
 * PREFERENCE. *** The argument was that `grantsForRole('owner')` carries
 * `core.organization.delete`, which `admin` does not hold, so a ceiling would refuse an `admin`
 * and pass an `owner`. **Measured against `authorization/roles.ts`:**
 *
 * ```
 * owner holds 8 · admin holds 8 · owner MINUS admin = []
 * owner has core.organization.delete?  NO — no role in that file holds it
 * ```
 *
 * **The two sets are IDENTICAL today**, exactly as `ADMIN_PERMISSIONS` documents: none of delete,
 * transfer or owner-targeting is in the current grant set, so the tiers differ only in what they
 * will hold later. **A ceiling here would therefore refuse nothing, while reading in the signature
 * as though it were the control** — `§3a`'s overstated guard, installed deliberately.
 *
 * ===========================================================================================
 * SO THE INSTRUMENT IS STRONGER AND IS NOT VACUOUS: THE CALLER MUST BE THE OUTGOING OWNER
 * ===========================================================================================
 *
 * `0043` §3c makes ownership singular, so there is exactly one owner and **`fromPrincipalId` IS
 * that owner.** A caller entitled to move ownership is therefore the caller who holds it — which is
 * a fact about a row, checkable now, and true whatever the two role sets grow into.
 *
 * **IT REFUSES AN `admin` TODAY**, which the ceiling would not, and it keeps refusing one after
 * `owner` gains `core.organization.delete`, when the ceiling would start working. **The ceiling
 * would then be redundant rather than wrong** — an owner passes a ceiling built from owner's own
 * grants trivially — which is the second reason not to add it.
 *
 * **WHAT IT DOES NOT REPLACE:** `authorize()` still evaluates
 * `core.organization.transfer-ownership` before any of this runs, and the two in-statement guards
 * still run inside the batch. This is the layer between them, and **none of the three is *the*
 * enforcement.**
 */
export type OwnershipTransferAdmission = {
  readonly [OWNERSHIP_TRANSFER_BRAND]: true;
  readonly organizationId: string;
  /** The principal established as the current owner, and as the caller. Compared on use. */
  readonly ownerPrincipalId: string;
};

export class OwnershipTransferNotAdmittedError extends Error {
  constructor(reason: string) {
    super(
      `An ownership transfer was attempted without a valid admission: ${reason}. ` +
        'docs/decisions/0043 §3c: ownership is singular, and the caller entitled to move it is ' +
        'the caller who holds it. The in-statement guards refuse zero owners and two owners; ' +
        'neither asks whether the caller was entitled to move ownership at all. Obtain an ' +
        'admission from admitOwnershipTransfer, which is the only producer.',
    );
    this.name = 'OwnershipTransferNotAdmittedError';
  }
}

/** Verifies the receipt and binds it to the transfer being written. */
export function consumeOwnershipTransferAdmission(
  admission: OwnershipTransferAdmission,
  transfer: OwnershipTransfer,
): void {
  const branded = admission as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[OWNERSHIP_TRANSFER_BRAND] !== true) {
    throw new OwnershipTransferNotAdmittedError('the value did not come from admitOwnershipTransfer');
  }
  if (admission.organizationId !== transfer.organizationId.value) {
    throw new OwnershipTransferNotAdmittedError(
      'the admission was checked in a different Organization than the transfer being written',
    );
  }
  if (admission.ownerPrincipalId !== transfer.fromPrincipalId) {
    // A receipt minted for one owner spent on a transfer FROM someone else. With ownership
    // singular this should be unreachable, and it is checked because "should be unreachable" is
    // the state the in-statement guards exist to distrust.
    throw new OwnershipTransferNotAdmittedError(
      'the admission names a different outgoing owner than the transfer does',
    );
  }
}

/**
 * THE ONLY PRODUCER. Reads the CALLER'S OWN membership and refuses unless the caller holds `owner`.
 *
 * IT TAKES THE AUTHORITY RATHER THAN A PAIR OF STRINGS, for `clearGrantCeiling`'s reason: the
 * Organization and the principal both come from one authenticated object, so **there is no
 * parameter through which the outgoing owner's identifier could be passed as the caller's.**
 *
 * IT REUSES `OwnerImmunityStore` RATHER THAN DECLARING A PORT. That port's one method answers
 * exactly this question — *"what role does this principal hold in this Organization"* — and a
 * second port with the same shape would be a second read of one fact that can disagree.
 *
 * *** THE STALENESS LIMIT, AND IT IS SMALL HERE. *** Mint and write are milliseconds apart within
 * one request, unlike `clearGrantCeiling`'s invitation lifetime. The window that remains is closed
 * by the demote statement's own `AND role = 'owner'`, which re-asks the question while writing —
 * `architecture.md` §3a, the only layer with no window.
 */
export async function admitOwnershipTransfer(
  store: OwnerImmunityStore,
  authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>,
): Promise<Result<OwnershipTransferAdmission>> {
  const caller = await store.findMembershipForImmunityCheck(
    authority.organizationId,
    authority.principalId,
  );
  if (!caller.ok) {
    return err(caller.error);
  }
  if (caller.value === null || caller.value.storedRole !== OWNER_ROLE_STORED_VALUE) {
    // NOT A MEMBER, OR NOT THE OWNER. One answer for both — a caller who may not transfer learns
    // nothing about why, and `forbidden()` takes no arguments so there is nothing to vary.
    //
    // COMPARED AGAINST THE RAW STORED VALUE rather than a narrowed role, for `clearOwnerImmunity`'s
    // reason: narrowing collapses "unrecognised" to `null`, and here that would read as "not the
    // owner" — which is the SAFE direction for this check and the unsafe one for that check. Same
    // literal, same reasoning, opposite consequence, so it is compared the same way in both.
    return err(forbidden());
  }
  const admission = {
    organizationId: authority.organizationId.value,
    ownerPrincipalId: authority.principalId,
  };
  Object.defineProperty(admission, OWNERSHIP_TRANSFER_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return ok(Object.freeze(admission) as OwnershipTransferAdmission);
}

/** The stored spelling, compared against the raw column value. See `owner-immunity.ts`. */
const OWNER_ROLE_STORED_VALUE = 'owner';
