/**
 * ===========================================================================================
 * INVITATIONS. `tenant-invitations-v1` · `docs/decisions/0044` §3c · Team Lead ruling 2026-09-13.
 * ===========================================================================================
 *
 * The domain layer for the invitation surface: the read shapes, the create path, and the lapse
 * sweep that keeps the read shapes affordable.
 *
 * **NO ROUTE IS REGISTERED AND NO PERMISSION IS TRANSCRIBED.** `core.user.invite` and
 * `core.invitation.list` are two of the eighteen with the user, and `security.md` §8-0 is explicit
 * that declared is not granted. Everything here is reachable only from a route that does not exist.
 *
 * ===========================================================================================
 * *** WHY `expired` IS MATERIALISED AT ALL, AND IT IS NOT TIDINESS — IT IS THE INDEX BUCKET. ***
 * ===========================================================================================
 *
 * `0021_invitation.sql` indexes `(organization_id, status)`, and the pending list filters to
 * `pending`. **A lapsed invitation never leaves `status = 'pending'` on its own.**
 *
 * > **So the bucket the hot read uses is exactly the one that grows without bound** — and it grows
 * > with every invitation that is simply ignored, which is the common case rather than the
 * > exception.
 *
 * **AND `0044` §3c's PAGE CAP DOES NOT BOUND IT.** The cap bounds the RESPONSE. The query still
 * walks lapsed rows to find live ones, and **in the worst case — every pending invitation lapsed —
 * it scans the whole bucket to return zero rows.** A read whose cost is unbounded while its
 * response is capped is the shape §3c was written about, **wearing the mitigation.**
 *
 * *** THE FIRST DIAGNOSIS WAS "the table grows and nothing clears it", WHICH IS TRUE AND IS NOT THE
 * PROBLEM. *** Recorded because the two lead to different remedies: table growth argues for
 * deletion, and the bucket argues for a status change. **Only the second is what the read needs.**
 *
 * ===========================================================================================
 * WHAT IS AN OPTIMISATION AND WHAT IS A SEMANTIC — the line everything below depends on
 * ===========================================================================================
 *
 * **`expired` IS COMPUTED AT READ TIME AND CORRECTNESS NEVER DEPENDS ON THE SWEEP HAVING RUN.**
 * `effectiveInvitationStatus` below is the authority; the sweep only makes the stored value agree
 * with it sooner. `tenant-invitations-v1`: *"a sweep that materialises the value is an
 * implementation choice; a route that lets an administrator cause it is a duplicate operation and
 * is refused."*
 *
 * **THAT LINE IS WHAT MAKES THE SWEEP SAFE TO SKIP, TO CAP, AND TO RUN PARTIALLY.** If any read
 * depended on it, a capped sweep would be a correctness bug rather than a slower index.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument, notFound } from '../kernel/errors.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import type { ControlPlaneWriteReservation } from '../identity/control-plane-admission.ts';
import type { GrantCeilingCleared, OfferedGrant } from './grant-ceiling.ts';
import { consumeGrantCeilingClearance } from './grant-ceiling.ts';
import type { TenantAdminAuthority } from './tenant-admin-authority.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';

/** The most invitations one page may carry. `tenant.invitations.list`'s declared `pageCap`. */
export const TENANT_INVITATIONS_PAGE_CAP = 100;

/**
 * Row-writes for the invitation ROW alone: the row, its primary key,
 * `invitation_by_organization`, and `invitation_by_organization_recency`.
 *
 * **DECLARED HERE BECAUSE `0021`'s HEADER SAID IT WOULD BE — *"an `INVITATION_ROW_WRITES` constant
 * is declared with the first writer, at 3, and moves the day another index lands"*.** The D1
 * adapter is the first writer, and the constant lives in the domain rather than in the adapter so
 * a route sizing a reservation and an adapter consuming one read the same number.
 *
 * *** IT MOVED FROM 3 TO 4 ON 2026-09-13, WHICH IS THAT INSTRUCTION FIRING AS WRITTEN. *** The
 * recency index landed because `tenant-invitations-v1` specifies `created_at DESC, invitation_id
 * ASC` and the table could not serve it. **The instruction named the event — *the day another index
 * lands* — rather than a date, and the event happened.**
 *
 * *** IT IS NOT THE COST OF CREATING AN INVITATION. *** Add `INVITATION_CUSTOM_ROLE_ROW_WRITES` per
 * custom role carried, so the operation is `4 + 2N` — **44 at the contract's cap of 20.** A reader
 * sizing from this constant alone under-reserves, which is the dangerous direction (`0014` §A.12),
 * and `createInvitation` computes the full figure rather than leaving it to a caller.
 *
 * *** THE SWEEP DOES NOT MOVE WITH IT, AND THAT IS THE EASY MISTAKE. *** `sweepLapsed` writes
 * `status` and `identifier`; **neither is in the recency index**, so that statement still costs 2
 * per row and `TENANT_INVITATION_LAPSE_SWEEP_LIMIT`'s `2 x LIMIT` is unchanged. *"A third index
 * landed"* reads as *"everything got more expensive"*, and for the sweep it did not.
 */
export const INVITATION_ROW_WRITES = 4;

/** The row and its primary key. `invitation_custom_role` carries no secondary index (`0022`). */
export const INVITATION_CUSTOM_ROLE_ROW_WRITES = 2;

/**
 * ===========================================================================================
 * *** HOW MANY LAPSED INVITATIONS ONE CREATE SWEEPS. THE ARITHMETIC IS HERE; THE RESULT IS NOT
 * RESTATED ANYWHERE ELSE. ***
 * ===========================================================================================
 *
 * **A LIMIT OF 1 IS BREAK-EVEN AND IS WHAT SOMEBODY WILL WRITE.** Every create eventually produces
 * at most one lapse, so a sweep of one keeps pace with new arrivals **and never touches the
 * backlog.** The bucket drains at `LIMIT - 1` rows per create, so the constant must exceed 1 or the
 * mechanism is ceremony.
 *
 * ```
 * drain per create        = LIMIT - 1        = 7
 * sweep row-writes        = 2 x LIMIT        = 16   the row and its (organization_id, status) entry
 * a backlog of 100 clears in 100 / 7          ~ 15 creates
 * ```
 *
 * **THE UPPER BOUND IS THE RESERVATION, NOT THE DRAIN RATE.** A create already reserves `3 + 2N`
 * for the invitation and its custom roles (`0021`, `0022`); the sweep adds `2 x LIMIT` on top, and
 * the whole figure is reserved **worst case** — `0014` §A.12: over-reserving delays a write,
 * under-reserving takes the platform out. At `N = 20` and this constant that is **59 row-writes**
 * against `PER_PRINCIPAL_DAILY_ROW_WRITES` of 600.
 *
 * **`freeTierImpact` AND EVERY OTHER READER CITE THIS CONSTANT RATHER THAN THE NUMBER 8**
 * (`workflow.md` §11a — a derived value protects the assertion and orphans the prose beside it, so
 * the prose must name the constant).
 *
 * *** `0030` IS SATISFIED AND THIS IS WHY. *** It is a **ceiling constant** — configuration, which
 * `0030` permits by name. **No column is added, no value is denormalised, nothing about the shape
 * of the data changes.** The rejected alternative — a written `expired` status maintained as the
 * truth — is the schema cost, **and it fails on its own terms anyway: a stored status is stale the
 * instant the clock passes `expires_at` unless something writes it, which is this problem one layer
 * in.**
 */
export const TENANT_INVITATION_LAPSE_SWEEP_LIMIT = 8;

/**
 * Where an invitation is in its life. `tenant-invitations-v1`'s `invitationStatus`, `closed`.
 *
 * `expired` IS COMPUTED AND IS NOT A ROW ANYBODY WRITES THROUGH A ROUTE. The sweep materialises it;
 * no operation lets an administrator cause it, because *forcing an invitation to expire early is
 * REVOKING it under a second name.*
 */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/**
 * One invitation, as Core can produce it today.
 *
 * *** THE RECIPIENT FIELD NOW EXISTS. ~~THERE IS NO RECIPIENT FIELD, AND ITS ABSENCE IS
 * LOAD-BEARING RATHER THAN PENDING.~~ CORRECTED 2026-09-13. *** `theRetentionQuestion` was closed
 * by `security-agent` and `0021_invitation.sql` was amended in place to add the column — amended
 * rather than superseded because it has never been applied to any database, a licence that expires
 * when the user approves the run.
 *
 * ~~SO THE LIST AND GET OPERATIONS CANNOT RETURN THEIR REQUIRED `identifier` FIELD YET.~~ **They
 * can. The storage half is clear; those routes are blocked only on the grant** — `core.user.invite`
 * and `core.invitation.list` are among the 28 permissions no role holds.
 */
export type InvitationRecord = {
  readonly organizationId: string;
  readonly invitationId: string;
  /**
   * *** THE INVITEE'S PLAINTEXT EMAIL ADDRESS, OR `null` ONCE THE INVITATION IS TERMINAL. ***
   *
   * **`null` IS NOT "UNKNOWN" AND MUST NOT BE RENDERED AS AN ABSENCE.** It is the retention rule
   * having run: `0021`'s `CHECK (status = 'pending' OR identifier IS NULL)` clears the address in
   * the same statement as every terminal transition. A terminal invitation records **what
   * happened** and no longer **who** — the contract gives that up deliberately, and
   * `tenant-invitations-v1`'s listing paragraph re-derives its conclusion on the weaker premise
   * rather than leaving it propped up (`workflow.md` §12).
   *
   * **IT IS `sensitive-personal` AND IT BELONGS TO A NON-MEMBER WHO HAS AGREED TO NOTHING.** That
   * is why `core.invitation.list` is a separate permission from `core.user.list` rather than a
   * fourth member of the same family: the populations differ. **Never log it, never put it in an
   * error message, never let it reach an audit row** — `TenantAdminActionTarget` is a closed union
   * of identifiers only (`principalId`, `invitationId`, `roleId`), which is what makes clearing
   * remove the address from the system rather than relocate it. That property is load-bearing for
   * the whole retention argument and it is a property of a TYPE, so widening that union to carry a
   * free-text field would silently defeat this.
   *
   * **A `pending` invitation with a `null` identifier is representable and is a Core-side defect.**
   * `0021` deliberately does not assert the converse — see the column's comment for why forbidding
   * it would decide the product.
   */
  readonly identifier: string | null;
  /** The seed role offered. `owner` is refused by `0021`'s CHECK — ownership is transferred. */
  readonly role: Exclude<MembershipRole, 'owner'>;
  /** The STORED value. Use `effectiveInvitationStatus` before showing it to anyone. */
  readonly storedStatus: InvitationStatus;
  /** RFC 3339 UTC, fixed width. See `effectiveInvitationStatus` for why the width matters. */
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly createdByPrincipalId: string;
};

/**
 * ===========================================================================================
 * *** THE AUTHORITY ON WHETHER AN INVITATION IS EXPIRED. NOT THE STORED COLUMN. ***
 * ===========================================================================================
 *
 * An invitation that has passed its expiry is expired **whether or not the sweep has run**, so
 * every read goes through this and the stored value is a cache of it.
 *
 * *** THE COMPARISON IS LEXICOGRAPHIC AND THAT IS ONLY CORRECT AT A FIXED WIDTH. *** This
 * repository has already shipped the bug this note prevents: a bound written `…T00:00:00Z` against
 * stored values of the form `…T00:00:00.000Z` compares **`Z` (0x5A) against `.` (0x2E) at index
 * 19**, `.` sorts first, and every record inside that second falls on the wrong side. It was live,
 * it dropped rows silently, and nothing errored.
 *
 * **So both operands must be `YYYY-MM-DDTHH:MM:SS.mmmZ` — the grammar `readInstantParameter`
 * enforces at the boundary — and this function REFUSES rather than comparing anything else.** A
 * malformed instant is a programming defect on a server-generated value, not a caller's input, so
 * it fails loudly here instead of quietly returning the wrong bucket.
 */
const FIXED_WIDTH_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class InvitationInstantWidthError extends Error {
  constructor(value: string) {
    super(
      `An invitation timestamp was compared at a width other than YYYY-MM-DDTHH:MM:SS.mmmZ: ` +
        `'${value}'. The comparison is lexicographic, which equals temporal comparison ONLY when ` +
        'both operands are the same width — a short bound puts Z (0x5A) where a stored value has ' +
        '. (0x2E) at index 19, and every record inside that second falls on the wrong side. That ' +
        'defect shipped once in this repository and dropped rows with no error.',
    );
    this.name = 'InvitationInstantWidthError';
  }
}

export function effectiveInvitationStatus(
  record: Pick<InvitationRecord, 'storedStatus' | 'expiresAt'>,
  nowIso: string,
): InvitationStatus {
  // A TERMINAL STATE IS FINAL AND THE CLOCK CANNOT MOVE IT. An accepted invitation whose expiry
  // has passed is still accepted — checking the clock first would rewrite history every time the
  // list is read.
  if (record.storedStatus !== 'pending') {
    return record.storedStatus;
  }
  if (!FIXED_WIDTH_UTC.test(record.expiresAt)) {
    throw new InvitationInstantWidthError(record.expiresAt);
  }
  if (!FIXED_WIDTH_UTC.test(nowIso)) {
    throw new InvitationInstantWidthError(nowIso);
  }
  return record.expiresAt <= nowIso ? 'expired' : 'pending';
}

/**
 * The port. **EVERY METHOD IS SCOPED TO ONE ORGANIZATION IN ITS FIRST PARAMETER**, and there is no
 * method that takes an invitation identifier without one — the same tenancy property
 * `MemberDirectoryStore` has, for the same reason: the port cannot express the unsafe question.
 */
export type InvitationStore = {
  /**
   * =========================================================================================
   * *** THE LAPSE SWEEP. AMORTISED ONTO THE NEXT WRITE IN THE SAME ORGANIZATION. ***
   * =========================================================================================
   *
   * ```sql
   * UPDATE invitation SET status = 'expired', identifier = NULL
   *  WHERE (organization_id, invitation_id) IN (
   *          SELECT organization_id, invitation_id FROM invitation
   *           WHERE organization_id = :org AND status = 'pending' AND expires_at <= :now
   *           LIMIT :limit)
   * ```
   *
   * =========================================================================================
   * *** THE SUBQUERY IS NOT STYLE. `UPDATE … LIMIT` IS A SYNTAX ERROR ON A STOCK SQLITE BUILD. ***
   * =========================================================================================
   *
   * ~~`UPDATE invitation SET … WHERE … LIMIT :limit`~~ — **measured 2026-09-13**: SQLite 3.51.2,
   * `sqlite_compileoption_used('ENABLE_UPDATE_DELETE_LIMIT')` = **0**, and the statement is refused
   * with `near "LIMIT": syntax error`. That clause exists only in a build compiled with an optional
   * flag. **The form above uses core syntax only and needs no build option**, so it is correct
   * whatever D1 was compiled with — which matters, because **D1 IS UNMEASURED HERE**
   * (`d1_database_query` is deliberately withheld) and the portable form makes the question moot
   * rather than answering it.
   *
   * **THE DANGEROUS REPAIR IS THE OBVIOUS ONE, WHICH IS WHY THIS IS WRITTEN DOWN RATHER THAN JUST
   * FIXED.** Meeting `near "LIMIT": syntax error`, the natural move is to delete the `LIMIT`. That
   * parses, and it converts a sweep bounded at `TENANT_INVITATION_LAPSE_SWEEP_LIMIT` into one that
   * updates **every** lapsed invitation in the Organization in a single statement — **blowing the
   * write reservation the create path sized from the bounded arithmetic**, on exactly the tenant
   * with the largest backlog. Verified bounded: 20 lapsed rows, limit 8, 12 left pending, 0
   * addresses surviving on a terminal row.
   *
   * =========================================================================================
   * *** `identifier = NULL` IS NOT OPTIONAL AND OMITTING IT BREAKS INVITATION CREATION. ***
   * =========================================================================================
   *
   * `0021`'s `CHECK (status = 'pending' OR identifier IS NULL)` is evaluated on the row this
   * statement produces. **`SET status = 'expired'` alone yields a terminal row still holding an
   * address, the CHECK refuses it, and the UPDATE errors.** This sweep runs BEFORE the insert on
   * the create path, so the failure is not a slower index — **every subsequent invitation creation
   * in that Organization fails**, and it fails for a reason nothing in the create path names.
   *
   * **THAT IS TWO RULINGS TAKEN SEPARATELY MEETING HERE, AND THEY DO NOT CONFLICT — the CHECK wants
   * the address gone on every terminal transition, and materialising `expired` IS a terminal
   * transition.** Clearing it here is what the retention ruling asks for, not a concession to the
   * constraint. Recorded because the two were decided by different parties on the same day and
   * neither was checked against this statement.
   *
   * **AND IT IS WHY THE CLEAR IS IN THE `SET` RATHER THAN IN A SECOND UPDATE.** A follow-up
   * statement is a window; the CHECK would refuse the first one anyway. `architecture.md` §3a — the
   * in-statement guard is the only layer with no window, and here it is also the only layer at all.
   *
   * *** THIS SWEEP IS THE ONLY THING THAT ENDS THE RETENTION FOR A LAPSED INVITATION, AND IT IS
   * BEST-EFFORT BY CONSTRUCTION. *** `revoke` and `accept` are routes: they write, so the CHECK
   * makes clearing unskippable. **`expired` is computed, so a lapsing invitation performs no write
   * at all** — the read reports `expired` while the row stores `pending` and keeps the address. An
   * Organization that stops inviting never triggers this sweep and retains every lapsed invitee's
   * address indefinitely. **So the contract's "cleared when the invitation leaves `pending`" holds
   * unconditionally for two of the three terminal states and is best-effort for the third.** The
   * Team Lead has reopened the retention residual on this; it is recorded, not solved here.
   *
   * **IT RUNS BEFORE THE INSERT, INSIDE AN AUTHENTICATED, TENANT-SCOPED, PERMISSION-EVALUATED
   * REQUEST.** The Organization comes from `TenantAdminAuthority`, which read it off the session
   * row — so the sweep needs no carve-out from anything.
   *
   * *** A SCHEDULER WOULD, AND THE OBJECTION IS `security.md` §1 RATHER THAN `0008`. *** A Cron
   * Trigger has **no authenticated context**, so a timed sweep would enumerate Organizations **from
   * an ambient default** — the exact phrase §1 forbids, in a non-negotiable. That is not a ruling
   * available to Core: it is a carve-out to §1 needing `security-agent` and then the user, **and it
   * buys nothing this form does not.** Propose it only for a case the amortised form cannot reach.
   *
   * **RETURNS THE COUNT SWEPT**, so the caller can charge what it actually spent and so a run that
   * swept nothing is distinguishable from one that did not run.
   */
  sweepLapsed(
    organizationId: AuthenticatedOrganizationId,
    nowIso: string,
    limit: number,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<number>>;

  listInvitations(
    organizationId: AuthenticatedOrganizationId,
    limit: number,
    cursor: string | null,
  ): Promise<Result<{ readonly rows: readonly InvitationRecord[]; readonly nextCursor: string | null }>>;

  findInvitation(
    organizationId: AuthenticatedOrganizationId,
    invitationId: string,
  ): Promise<Result<InvitationRecord | null>>;

  /**
   * Writes the invitation and its custom-role rows as one atomic batch.
   *
   * IT REQUIRES A `GrantCeilingCleared` — `0007` D16 constraint 1 applied to assignment. Without
   * it, *"invitation is a privilege-escalation route that looks like onboarding: invite an account
   * with a role you may not hold, then sign in as it."*
   *
   * **THE CEILING GOES STALE OVER THE INVITATION'S WHOLE LIFETIME, WHICH IS THE LONGEST WINDOW OF
   * ANY RECEIPT IN THIS TREE**, and `grant-ceiling.ts` records that the acceptance path owes its
   * own re-check. This parameter does not close that and must not be read as closing it.
   */
  /**
   * THE ORGANIZATION IS A SEPARATE, BRANDED PARAMETER RATHER THAN A FIELD OF THE RECORD.
   *
   * `InvitationRecord.organizationId` is a plain `string` because a record is what the store READ
   * back. **A write must not take its tenant from a record a caller assembled** — that is exactly
   * the "obtains the value correctly and passes it on incorrectly" case `0044` §3a-i names, and it
   * would be one field away from a cross-tenant insert that compiles.
   */
  createInvitation(
    organizationId: AuthenticatedOrganizationId,
    record: Omit<InvitationRecord, 'organizationId'>,
    customRoleIds: readonly string[],
    ceiling: GrantCeilingCleared,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<void>>;
};

export type InvitationService = {
  /**
   * One page, with every row's status resolved against the clock.
   *
   * **IT FILTERS ON THE EFFECTIVE STATUS, NOT THE STORED ONE**, so a lapsed row the sweep has not
   * reached yet is reported `expired` rather than `pending`. That is the whole reason the sweep is
   * an optimisation: **the answer does not depend on it.**
   */
  list(input: {
    readonly organizationId: AuthenticatedOrganizationId;
    readonly pageSize: number;
    readonly cursor: string | null;
    readonly nowIso: string;
  }): Promise<Result<{ readonly rows: readonly ResolvedInvitation[]; readonly nextCursor: string | null }>>;

  get(input: {
    readonly organizationId: AuthenticatedOrganizationId;
    readonly invitationId: string;
    readonly nowIso: string;
  }): Promise<Result<ResolvedInvitation>>;

  /**
   * =========================================================================================
   * *** THE SERVICE HALF OF THE CEILING CONSUMPTION. IT CHECKS WHAT THE STORE CANNOT SEE. ***
   * =========================================================================================
   *
   * **TWO CONSUMPTIONS OF ONE CLEARANCE, AND THEY ARE NOT REDUNDANT.** Team Lead ruling,
   * 2026-09-13, on `workflow.md` §11a's *before deleting a check as duplicate, compare what each
   * one STARTS FROM*:
   *
   *   HERE          grantor identity + offer fingerprint   this layer HAS the authority and the offer
   *   THE STORE     brand + Organization                   the tenant-isolation half
   *
   * **Name an input each goes red on that the other passes:** a clearance minted for a different
   * administrator **in the same Organization** — this one fires, the store's does not. A service
   * that forgot to consume at all — **the store's fires, this one never ran.** Neither subsumes the
   * other, and deleting either removes real coverage.
   *
   * *** A FACT RECEIPT IS NOT SINGLE-USE, WHICH IS WHY SPENDING IT TWICE IS SOUND. ***
   * `architecture.md` §3a draws the line: a **capacity** receipt must be single-use, because
   * spending it twice spends one budget on two writes — that is `ControlPlaneWriteReservation`, and
   * it is consumed **once**, in the store. **`GrantCeilingCleared` certifies a FACT**, re-asking it
   * consumes nothing, and both consumptions verify the same unchanged assertion from different
   * vantage points. **Said here and at `consumeGrantCeilingClearanceAtStorage`, or the next reader
   * takes the second consumption for a bug and deletes one.**
   *
   * *** THE AUTHORITY IS DELIBERATELY NOT PASSED INTO THE STORE. *** A store's job is storage, and
   * handing it an authority widens what the storage layer knows about authorization — the same
   * `0003` replaceability argument that kept `meta.changes` out of the adapter. **The split exists
   * so the authorization fact is checked where the authorization context lives.**
   */
  create(input: {
    readonly authority: Pick<TenantAdminAuthority, 'organizationId' | 'principalId'>;
    readonly offer: OfferedGrant;
    readonly clearance: GrantCeilingCleared;
    readonly record: Omit<InvitationRecord, 'organizationId'>;
    readonly reservation: ControlPlaneWriteReservation;
  }): Promise<Result<void>>;
};

/** An invitation whose status has been resolved against the clock. */
export type ResolvedInvitation = Omit<InvitationRecord, 'storedStatus'> & {
  readonly status: InvitationStatus;
};

export function createInvitationService(
  store: InvitationStore,
  pageCap: number = TENANT_INVITATIONS_PAGE_CAP,
): InvitationService {
  return {
    async list(input) {
      // ENFORCED, NOT CLAMPED — `member-directory.ts` carries the full argument, and the two must
      // not diverge: clamping answers a different question from the one asked.
      if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > pageCap) {
        return err(invalidArgument([detail('page_size', 'out_of_range')]));
      }
      const page = await store.listInvitations(input.organizationId, input.pageSize, input.cursor);
      if (!page.ok) {
        return err(page.error);
      }
      return ok({
        rows: page.value.rows.map((row) => resolve(row, input.nowIso)),
        nextCursor: page.value.nextCursor,
      });
    },

    async get(input) {
      const found = await store.findInvitation(input.organizationId, input.invitationId);
      if (!found.ok) {
        return err(found.error);
      }
      if (found.value === null) {
        // The three-way collapse: no such invitation, one belonging to another Organization, and a
        // malformed identifier are one answer. The port is keyed on the composite key, so the
        // distinction is not available to be leaked rather than being suppressed.
        return err(notFound());
      }
      return ok(resolve(found.value, input.nowIso));
    },

    async create(input) {
      // =====================================================================================
      // THE GRANTOR AND THE OFFER, CHECKED HERE BECAUSE THIS IS THE ONLY LAYER THAT HOLDS THEM.
      // =====================================================================================
      //
      // **IT THROWS RATHER THAN RETURNING A REFUSAL, AND THAT IS `consumeGrantCeilingClearance`'s
      // own choice rather than this call site's.** No client can cause it: clients supply values,
      // never clearances. What it catches is Dudo's own code carrying a receipt across a boundary
      // it was not minted for — **which must stop the request rather than be handled and served.**
      //
      // *** IT RUNS BEFORE THE STORE IS TOUCHED. *** The offer fingerprint covers the membership
      // role AND the custom role ids, so a handler that cleared the ceiling for one offer and
      // then built a different one is refused **before** anything is written and before the
      // reservation is spent.
      consumeGrantCeilingClearance(input.clearance, input.authority, input.offer);

      // THE CUSTOM ROLE IDS COME FROM THE OFFER, NOT FROM A SECOND PARAMETER. They are part of what
      // the ceiling was cleared for — `fingerprintOffer` covers them — so taking them from anywhere
      // else would write a grant the clearance does not certify, with both checks green.
      return store.createInvitation(
        input.authority.organizationId,
        input.record,
        input.offer.customRoleIds,
        input.clearance,
        input.reservation,
      );
    },
  };
}

function resolve(record: InvitationRecord, nowIso: string): ResolvedInvitation {
  const { storedStatus, ...rest } = record;
  return { ...rest, status: effectiveInvitationStatus({ storedStatus, expiresAt: record.expiresAt }, nowIso) };
}

/**
 * ===========================================================================================
 * ⚠ THE RESIDUAL, WRITTEN AS A KNOWN LIMIT WITH ITS BOUND — NOT AS A TODO, BECAUSE IT IS A
 * DECISION RATHER THAN AN OMISSION.
 * ===========================================================================================
 *
 * **AN ORGANIZATION THAT STOPS INVITING KEEPS ITS BACKLOG FOREVER.** Nothing writes, so nothing
 * sweeps, and its pending bucket stays exactly as large as it was on the last create.
 *
 * **Bounded by that tenant's own historical invitation count, falling on that tenant alone, and the
 * page cap still bounds the response.** ~~Accepted on those terms.~~ **THOSE TERMS CHANGED ON
 * 2026-09-13: the backlog now contains personal data.** See the conditional below, which fired.
 *
 * **IF IT EVER BITES, THE ANSWER IS A BOUND ON THE READ — NOT A SCHEDULER.** See `sweepLapsed` for
 * why a timed sweep is a `security.md` §1 carve-out rather than an implementation choice.
 *
 * ===========================================================================================
 * ⚠ THE CONDITIONAL BELOW FIRED ON 2026-09-13. ITS TRIGGER WAS NAMED AND ITS OWNER WAS NAMED, AND
 * BOTH ARE THE ONLY REASON ANYBODY NOTICED.
 * ===========================================================================================
 *
 * ~~The personal-data retention argument for sweeping DOES NOT APPLY TODAY. `0021` has no recipient
 * column, so a lapsed invitation currently retains no personal data at all — the sweep is an index
 * optimisation and nothing more.~~ **FALSE SINCE 2026-09-13.** `0021` was amended in place to add
 * `identifier`, a plaintext address.
 *
 * ~~THE TRIGGER IS THE ARRIVAL OF THE RECIPIENT COLUMN, NOT A DATE.~~ **IT ARRIVED.** So the
 * sentence below is now a description of the present rather than a forecast, and it is kept
 * unstruck because every word of it is what is true today:
 *
 *   *"retaining a lapsed invitation means retaining an invitee's address indefinitely — an address
 *   belonging to a non-member who has not agreed to anything — and the sweep stops being an
 *   optimisation and becomes a retention control."*
 *
 * **SO THIS SWEEP IS NOW A RETENTION CONTROL AND IT IS BEST-EFFORT.** `revoke` and `accept` write,
 * so `0021`'s CHECK makes clearing unskippable on those two. **`expired` is computed and performs
 * no write**, so for a lapsed invitation there is nothing the CHECK can fire on and this sweep is
 * the only thing that ever clears the address — amortised onto a next write that may never come.
 *
 * *** WHAT IS NEW AND IS NOT IN EITHER RULING: THE GUARANTEE IS UNEVEN ACROSS THE THREE TERMINAL
 * STATES, AND NOTHING SAYS SO ANYWHERE ELSE. *** `tenant-invitations-v1` states the mitigation
 * unconditionally — *"IT IS CLEARED WHEN THE INVITATION LEAVES `pending`"* — which is exact for two
 * of the three and, for the third, describes a clear that happens when some later administrator
 * happens to invite somebody else. **Two of three is not a defect in either ruling; it is the join
 * between them, and the join is where they were never checked against each other.**
 *
 * **THE TEAM LEAD HAS REOPENED THIS AND OWNS IT.** Recorded rather than reconciled here: Core does
 * not get to decide a retention policy, and the available fixes — a scheduler (a `security.md` §1
 * carve-out), a clear-on-read, or accepting the unevenness and saying so in the contract — are
 * three different owners' calls, not one implementer's.
 *
 * *** AND THE MECHANISM THAT MADE THIS CHEAP IS WORTH MORE THAN THE FINDING. *** The conditional
 * stated the REASON rather than a verdict, per `workflow.md` §12 — it never said *"this file will
 * be wrong"*, it said what would change about the sweep's PURPOSE. **So when the trigger fired,
 * there was nothing to obey and nothing to undo**: the paragraph handed over a live fact and left
 * the consequence to whoever holds the decision, which is exactly the shape §12 asks for and the
 * opposite of a clause that becomes a normative instruction the moment its condition turns true.
 */
