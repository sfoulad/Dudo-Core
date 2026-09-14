/**
 * ===========================================================================================
 * `admin` MAY NOT ACT ON THE `owner`, AND IT IS THE RULE A PERMISSION CANNOT EXPRESS.
 * `docs/decisions/0043` §3d · `architecture.md` §3a.
 * ===========================================================================================
 *
 * `0043` §3d enumerates what `admin` must not hold: `core.organization.delete`,
 * `core.organization.transfer-ownership`, and **any action whose target is the `owner`** — suspend,
 * remove, demote, revoke sessions. Its sentence about the third:
 *
 *   "THE THIRD IS THE ONE A PERMISSION CANNOT EXPRESS, since it is a property of the TARGET rather
 *    than of the ACTOR. It is stated here as a Core obligation and a test requirement, never as a
 *    grant."
 *
 *   "Without it, `admin` is `owner` with extra steps: demote the owner, then do anything."
 *
 * **A GRANT IS A FACT ABOUT THE CALLER. THIS IS A FACT ABOUT THE ROW BEING WRITTEN.** No permission
 * identifier can carry it, no envelope can refuse it, and `authorize()` never sees the target — so
 * there is no layer above this one that could enforce it even in principle.
 *
 * ===========================================================================================
 * SO IT IS A RECEIPT, NOT A RULE. `architecture.md` §3a, and the precedent is `M-1`.
 * ===========================================================================================
 *
 * *"A guard that must be REMEMBERED is a discipline. A guard whose output the write REQUIRES is a
 * mechanism."* Every mutating method on `MembershipAdministrationStore` requires an
 * `OwnerImmunityCleared`; `clearOwnerImmunity` below is the only producer; no constructor is
 * exported. **Omitting the check is not a runtime gap. It does not compile.**
 *
 * The precedent is `platform-authority.ts::MembershipAdmission`, whose own header records why the
 * pattern was reached for: finding `M-1` — a pair of write-side guards with NO CALL SITES, where
 * *"omitting the call would be silent: nothing fails, no test goes red"*. Membership
 * administration is exactly the surface that was missing then and is being built now.
 *
 * ===========================================================================================
 * *** THE RECEIPT IS NOT THE LOAD-BEARING LAYER, AND SAYING SO IS THE POINT. ***
 * ===========================================================================================
 *
 * `architecture.md` §3a ranks the layers and warns, in its closing paragraph, against a function
 * *"described as THE enforcement, when it is one of four layers and not the load-bearing one"* —
 * because that is how the next reviewer concludes the problem is already handled. So, ranked:
 *
 *   LAYER                                    CATCHES                          BLIND TO
 *   --------------------------------------------------------------------------------------------
 *   THE RECEIPT (this file)                  forgetting the guard — a         a deliberate cast,
 *                                            BUILD failure, no row written    AND A STALE FACT
 *   THE IN-STATEMENT GUARD (the adapter)     a bypass, a stale receipt, and   a brand-new write
 *     `AND (role IS NULL OR role <> 'owner')` a database where 0019 was          method nobody
 *                                            never applied                       declared
 *   THE PARTIAL UNIQUE INDEX (`0019`)        two owners, however produced     a demotion that
 *                                                                              leaves NONE
 *   A STRUCTURAL ASSERTION OVER THE PORT     a new write method               nothing above it
 *
 * **THE IN-STATEMENT GUARD IS THE ONE WITH NO WINDOW**, and that is not belt-and-braces. This
 * receipt certifies a fact — *the target was not the owner when we looked* — and a fact can go
 * stale between the mint and the write: a target who is an ordinary member when the check runs and
 * is made owner before the UPDATE lands **passes the brand check**, because the receipt is
 * authentic and the world moved. Only the statement that re-asks the question while writing closes
 * that. `architecture.md` §3a found this by test rather than by design and it applies here
 * unchanged.
 *
 * *** AND WRITE THE GUARD `(role IS NULL OR role <> 'owner')`, NEVER `role <> 'owner'`. *** The
 * column is nullable — `0007_membership_role.sql` adds it `CHECK (role IS NULL OR role IN (…))`
 * — and in SQL `NULL <> 'owner'` is NULL, which is not true, so the short form silently refuses
 * every member who has no role set. That is a guard that fails CLOSED on the wrong population and
 * would read as "the feature does not work" rather than as a bug in a predicate.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { forbidden } from '../kernel/errors.ts';
import { toMembershipRole } from '../authorization/roles.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';

/**
 * The target's membership as the immunity check needs to see it.
 *
 * IT IS A RAW STORED ROLE, unnarrowed, for `TenantAdminMembership`'s reason: the narrowing is
 * `toMembershipRole`'s and happens in one place. **And here the direction of the unrecognised case
 * is the opposite of everywhere else, which is why it must not be pre-narrowed by an adapter** —
 * see `clearOwnerImmunity`.
 */
export type OwnerImmunityTarget = {
  readonly organizationId: string;
  readonly principalId: string;
  /** The stored `organization_membership.role`. May be `null`, may be unrecognised. */
  readonly storedRole: string | null;
};

/**
 * The narrow port. ONE METHOD, keyed by an Organization and a principal.
 *
 * It cannot enumerate members, cannot read another Organization, and cannot write. The
 * composition root adapts a wider control-plane store down to it — `architecture.md` §3a-0: a
 * dependency a component does not use is reach it has not exercised.
 */
export type OwnerImmunityStore = {
  /** The target's membership row in this Organization, or `null` if there is none. */
  findMembershipForImmunityCheck(
    organizationId: AuthenticatedOrganizationId,
    principalId: string,
  ): Promise<Result<OwnerImmunityTarget | null>>;
};

const OWNER_IMMUNITY_BRAND: unique symbol = Symbol('dudo.tenantAdmin.ownerImmunity');

/**
 * PROOF THAT A NAMED TARGET, IN A NAMED ORGANIZATION, DID NOT HOLD `owner` WHEN IT WAS READ.
 *
 * It names BOTH so that `consumeOwnerImmunityClearance` can compare them against the row being
 * written. A receipt minted for one target and spent on another is the obvious hole in any scheme
 * of this shape — `MembershipAdmission` closes it the same way, and closes it because the hole was
 * named at the time rather than found later.
 *
 * IT IS NOT SINGLE-USE, AND THE DIFFERENCE FROM `ControlPlaneWriteReservation` IS PRINCIPLED.
 * That one is single-use because it represents CONSUMED CAPACITY — spending it twice spends one
 * reservation's budget on two writes. This represents A FACT that was true when it was read.
 * Re-using it acts twice on one target in one operation, which the operation's own semantics
 * bound and which consumes no budget. **Single-use copied without its rationale is the
 * exported-mint mistake in a smaller form** (`architecture.md` §3a).
 */
export type OwnerImmunityCleared = {
  readonly [OWNER_IMMUNITY_BRAND]: true;
  readonly organizationId: string;
  readonly targetPrincipalId: string;
};

/**
 * THE ONLY CONSTRUCTOR, AND IT IS MODULE-PRIVATE.
 *
 * `mintControlPlaneWriteReservation` is exported because two admission implementations need it and
 * its header says so; `platform-authority.ts` keeps its own mint private because there is only one
 * producer and *"an exported mint is a way to fabricate a receipt without doing the work it
 * certifies."* There is one producer here and none is anticipated.
 */
function mintOwnerImmunityClearance(
  organizationId: AuthenticatedOrganizationId,
  targetPrincipalId: string,
): OwnerImmunityCleared {
  // THE RECEIPT STORES THE UNWRAPPED VALUE, for `grant-ceiling.ts`'s reason: it is compared
  // against another sealed context's `.value` on use, and holding a second sealed object would
  // give the receipt an identity nothing checks.
  const cleared = { organizationId: organizationId.value, targetPrincipalId };
  Object.defineProperty(cleared, OWNER_IMMUNITY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(cleared) as OwnerImmunityCleared;
}

/**
 * Thrown, not returned, for `MembershipNotAdmittedError`'s reason: NO CLIENT CAN CAUSE THIS.
 * Clients supply values, never receipts. What it catches is Dudo's own code writing a membership
 * row without having asked whether the target is the owner — which must stop the request rather
 * than be handled, logged and shipped.
 */
export class OwnerImmunityNotClearedError extends Error {
  constructor(reason: string) {
    super(
      `A membership write was attempted without a valid owner-immunity clearance: ${reason}. ` +
        'docs/decisions/0043 §3d: `admin` may not act on the `owner` — suspend, remove, demote or ' +
        'revoke sessions — because without it `admin` is `owner` with extra steps: demote the ' +
        'owner, then do anything. It is a property of the TARGET, so no permission expresses it. ' +
        'Obtain a clearance from clearOwnerImmunity, which is the only producer and which reads ' +
        "the target's membership row.",
    );
    this.name = 'OwnerImmunityNotClearedError';
  }
}

/**
 * Verifies a receipt and binds it to the row being written. Called by the adapter, immediately
 * before the statement.
 *
 * TWO CHECKS, EACH CLOSING A BYPASS:
 *
 *   1. THE BRAND. A hand-built object is not a clearance. `Object.defineProperty` with
 *      `enumerable: false` means it does not survive a `JSON.parse(JSON.stringify(...))` round
 *      trip either, so one cannot be reconstituted from a log line.
 *   2. THE SUBJECT — BOTH HALVES. A clearance for target A in Organization X cannot fund a write
 *      to target B, and cannot fund a write in Organization Y. **The second half is a
 *      tenant-isolation check and is not decoration**: without it, a clearance legitimately minted
 *      inside one Organization would satisfy the type system for a write into another.
 */
export function consumeOwnerImmunityClearance(
  clearance: OwnerImmunityCleared,
  organizationId: AuthenticatedOrganizationId,
  targetPrincipalId: string,
): void {
  const branded = clearance as unknown as Record<symbol, unknown> | null | undefined;
  if (branded === null || branded === undefined || branded[OWNER_IMMUNITY_BRAND] !== true) {
    throw new OwnerImmunityNotClearedError('the value did not come from clearOwnerImmunity');
  }
  if (clearance.organizationId !== organizationId.value) {
    throw new OwnerImmunityNotClearedError(
      'the clearance was checked in a different Organization than the row being written',
    );
  }
  if (clearance.targetPrincipalId !== targetPrincipalId) {
    throw new OwnerImmunityNotClearedError(
      'the clearance was checked for a different target than the row being written',
    );
  }
}

/**
 * THE ONLY PRODUCER. Reads the target's membership row and refuses if the target is the `owner`.
 *
 * ===========================================================================================
 * IT REFUSES A TARGET THAT IS THE OWNER **WHOEVER THE ACTOR IS** — INCLUDING THE OWNER ITSELF.
 * ===========================================================================================
 *
 * The obvious design takes an actor and clears a self-targeted act. It is refused here, and the
 * reason is that it would make **ownership changeable through the member-administration path**:
 * an owner able to demote itself leaves an Organization with no owner, which `0043` §3c's singular
 * ownership forbids and which `0019`'s partial unique index cannot catch — that index refuses TWO
 * owners and is blind to ZERO.
 *
 * **SO OWNERSHIP MOVES THROUGH EXACTLY ONE OPERATION: `transferOwnership`**, which does not take
 * this receipt, is gated by `core.organization.transfer-ownership`, and is a permission `0043` §3d
 * says `admin` must never hold. One door, one permission, one atomic demote-and-promote.
 *
 * A LEGITIMATE SELF-SERVICE ACT BY THE OWNER IS NOT BLOCKED BY THIS — it simply does not go
 * through this port. An owner ending its own sessions is session management on its own principal,
 * not administration of a member.
 *
 * ===========================================================================================
 * *** AN UNRECOGNISED STORED ROLE REFUSES HERE, AND THAT IS THE OPPOSITE DIRECTION FROM
 * EVERYWHERE ELSE IN THIS PLATFORM. IT IS DELIBERATE AND IT IS THE WHOLE REASON THE PORT RETURNS
 * A RAW STRING. ***
 * ===========================================================================================
 *
 * `toMembershipRole` collapses "absent" and "unrecognised" to `null`, and every other consumer
 * reads `null` as DENY THE CALLER — which is safe there, because the value is being used to grant.
 *
 * **HERE THE VALUE IS BEING USED TO DECIDE WHETHER A TARGET IS PROTECTED, so `null` must mean
 * PROTECT rather than "not the owner".** A build that met `'owner'` in a column it did not
 * recognise — because a later migration renamed the stored value, because a restore brought back a
 * row from a different schema — would narrow it to `null`, read `null` as "ordinary member", and
 * **strip the protection from exactly the row it exists for.**
 *
 * So the check is written on the RAW string first and the narrowing second:
 *
 *   the raw value is the owner spelling      -> REFUSE
 *   the raw value narrows to null and is not null in the column  -> REFUSE (unrecognised)
 *   the column is null, or narrows to a recognised non-owner role -> CLEAR
 *
 * **A ROW THAT DOES NOT EXIST ALSO REFUSES.** A target with no membership in this Organization is
 * not a member to administer, and clearing an absent row would let the surrounding operation write
 * one. `forbidden()` rather than `notFound()`, because the caller holds a permission over this
 * Organization's members and can already enumerate them — there is no identifier being probed and
 * therefore no oracle to collapse. **That is a claim about the CALLER's existing reach, so it must
 * be re-derived if a route in this class is ever reachable by a principal who cannot list
 * members.**
 */
export async function clearOwnerImmunity(
  store: OwnerImmunityStore,
  organizationId: AuthenticatedOrganizationId,
  targetPrincipalId: string,
): Promise<Result<OwnerImmunityCleared>> {
  const target = await store.findMembershipForImmunityCheck(organizationId, targetPrincipalId);
  if (!target.ok) {
    return err(target.error);
  }
  if (target.value === null) {
    return err(forbidden());
  }
  const stored = target.value.storedRole;
  if (stored === OWNER_ROLE_STORED_VALUE) {
    return err(forbidden());
  }
  // Unrecognised — see the header. `null` in the column is an ordinary member with no role and is
  // NOT unrecognised; a non-null string this build cannot narrow is.
  if (stored !== null && toMembershipRole(stored) === null) {
    return err(forbidden());
  }
  return ok(mintOwnerImmunityClearance(organizationId, targetPrincipalId));
}

/**
 * The stored spelling of the owner role, as a literal, compared against the RAW column value.
 *
 * IT IS DELIBERATELY NOT `MEMBERSHIP_ROLES[0]` OR ANYTHING DERIVED FROM THE UNION. This comparison
 * has to keep working for a build whose union has changed, which is the entire hazard the header
 * describes — deriving it from the union would make the protection move with the union, and the
 * union moving is the event being defended against.
 *
 * `0043` §3a is why the spelling is stable: *"ALIGN THE UNBUILT VOCABULARY TO THE BUILT ONE, NEVER
 * THE REVERSE"* — `organization_membership.role` holds `'owner'` today behind a `CHECK`, renaming
 * it costs a migration plus a data change on live rows, and the catalogue's unbuilt
 * `business-owner` is what moved instead.
 */
const OWNER_ROLE_STORED_VALUE = 'owner';
