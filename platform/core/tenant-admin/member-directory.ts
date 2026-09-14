/**
 * ===========================================================================================
 * READING THE ORGANIZATION'S MEMBERS. `tenant-members-v1`, operations `tenant.members.list`
 * and `tenant.members.get`. `docs/decisions/0044` §3c · `docs/decisions/0043`.
 * ===========================================================================================
 *
 * The read half of the members surface. The write half is `membership-administration.ts`, and the
 * two are separate ports on purpose: a component that lists members and a component that removes
 * them need different reach, and `architecture.md` §3a-0 is explicit that **a dependency a
 * component does not use is reach it has not exercised.**
 *
 * ===========================================================================================
 * THE CONTRACT NAMES A CORE DEPENDENCY AND `0020` IS IT
 * ===========================================================================================
 *
 * `tenant.members.list`'s `freeTierImpact.boundingIndex` says, in the contract's own words:
 *
 *   "the listing is a range scan on the SECOND component, which the primary key does not serve —
 *    SO THIS OPERATION NEEDS AN INDEX ON (organization_id, ...) AND ONE DOES NOT EXIST… That is a
 *    Core dependency and a migration, and it is named here rather than assumed."
 *
 * **`0020_organization_membership_by_organization.sql` is that migration.** It is written and
 * **not applied** — applying it is the user's, every time (`security.md` §7) — so until then this
 * listing is a full scan of **every tenant's** membership rows. Stated because a reader of this
 * file would otherwise assume the index exists, and because the page cap below bounds the ROWS
 * RETURNED and not the rows SCANNED.
 *
 * ===========================================================================================
 * *** THERE IS NO MEMBER NAME AND THERE IS NO RECOVERABLE EMAIL. THIS IS DESIGNED, NOT MISSING.
 * ===========================================================================================
 *
 * `TenantMemberSeat` below carries no display name, and the contract settled why before this file
 * existed — `memberDisplayName` is `["string","null"]` and **null on every response today**:
 *
 *   - `0001_principal.sql` defines `principal` as exactly `(principal_id, principal_type, status,
 *     created_at)`. **There is no name.**
 *   - `0006_principal_credential.sql` stores `identifier_hash`, an HMAC of the normalised address,
 *     and the plaintext is never stored and never logged. So the email is **mathematically
 *     unrecoverable** rather than merely absent.
 *
 * **THE FIELD IS ABSENT FROM THIS TYPE RATHER THAN PRESENT AND ALWAYS `null`.** A `displayName`
 * that no store can ever fill is a field that reads as *"sometimes populated"* to every future
 * author, and the first one to add a column would wire it here without noticing that the contract
 * has a normative rendering rule attached to its nullness. **The handler renders `display_name:
 * null` explicitly**, which is a statement, where a port field would be an invitation.
 *
 * THE CONTRACT'S RENDERING RULE IS BINDING ON BOTH CLIENTS AND IS NOT THIS FILE'S TO RESTATE:
 * a null renders the `principal_id` **verbatim** — not a blank, not a dash, not "Unknown member".
 * *"An opaque identifier is the honest rendering of a person whose name Dudo does not hold; a
 * placeholder is indistinguishable from a real name."*
 *
 * **AND THE HONEST CONSEQUENCE, WHICH THE CONTRACT ALSO STATES: a members directory in which every
 * row reads `k7Qx2mZp…` is not a usable members directory.** That is a product gap owned by
 * whoever decides where a member's name lives. It is not a defect in this file and it is not fixed
 * by inventing one here.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, internal, invalidArgument, notFound } from '../kernel/errors.ts';
import type { MembershipRole } from '../authorization/roles.ts';
import type { MembershipStatus } from '../identity/control-plane-store.ts';
import type { AuthenticatedOrganizationId } from './authenticated-organization.ts';

/**
 * The most members one page may carry. `tenant.members.list`'s `freeTierImpact.pageCap`.
 *
 * IT IS THE CONTRACT'S NUMBER, TRANSCRIBED, and the transcription is what `0044` §3c requires a
 * route to declare. **It is a MAXIMUM and not a default** — the contract is explicit that
 * `pageSize`'s `"default": 25` is *"the client's convenience and is not a bound"*, and that a
 * default page size is the fail-open version of the rule, *"because a route that forgot its bound
 * and a route that accepted the default are indistinguishable afterwards."*
 */
export const TENANT_MEMBERS_PAGE_CAP = 100;

/**
 * The most custom roles one member may carry in a response. `memberSeat.custom_role_ids`,
 * `maxItems: 20`.
 *
 * ===========================================================================================
 * *** EXCEEDING IT REFUSES THE REQUEST. IT DOES NOT TRUNCATE, AND THAT IS THE WHOLE POINT. ***
 * ===========================================================================================
 *
 * The contract: *"If a tenant assigns more than 20 roles to one person the request fails rather
 * than truncating — **a truncated authority list is a FALSE statement about a member's access, and
 * it is false in the reassuring direction.**"*
 *
 * A screen showing twenty of a member's twenty-three roles is a screen an administrator uses to
 * decide someone's access, showing less authority than that person holds. **Failing is visible;
 * truncating is not.**
 *
 * **IT IS ALSO WHAT MAKES REMOVAL'S COST A NUMBER RATHER THAN A FUNCTION OF N**, and the contract
 * says the two uses must not drift: removal deletes every role assignment with the membership row,
 * so `tenant.members.remove`'s `maxRowWrites` is bounded by this constant. **Raising it is a cost
 * decision as well as a product one and must be argued in both places** — its first draft said 50
 * and would have made one removal cost more than a sixth of a principal's daily write allowance.
 */
export const TENANT_MEMBER_MAX_CUSTOM_ROLES = 20;

/**
 * One member of one Organization, as Core can actually produce it.
 *
 * NO `displayName` — see the header. NO email, no identifier, no last-seen, no session count. Each
 * of those is a disclosure with its own argument, and a seat type that carried one "for later" is
 * a field a handler will eventually render.
 */
export type TenantMemberSeat = {
  readonly principalId: string;
  /**
   * The seed role on the membership row, or `null`.
   *
   * `null` MEANS "no role set, or a value this build does not recognise" — `toMembershipRole`
   * collapses both, and `0019` decided that both deny everything. **The contract's
   * `membershipRoleOrNull` carries the same nullability**, so a member with no role renders as one
   * rather than being hidden from the list: an administrator needs to see a member who can do
   * nothing, and omitting them would make the directory disagree with the membership table.
   */
  readonly membershipRole: MembershipRole | null;
  /** The custom roles assigned to this member, possibly empty. Bounded — see the constant. */
  readonly customRoleIds: readonly string[];
  readonly status: MembershipStatus;
  /** RFC 3339, UTC. `organization_membership.created_at`. */
  readonly joinedAt: string;
};

/** One page of members, and the cursor for the next. */
export type TenantMemberPage = {
  readonly seats: readonly TenantMemberSeat[];
  /** `null` when this is the last page. Never an empty string — see `readCursorParameter`. */
  readonly nextCursor: string | null;
};

/**
 * The read port. **TWO METHODS, BOTH SCOPED TO ONE ORGANIZATION IN THEIR FIRST PARAMETER.**
 *
 * *** THERE IS NO METHOD THAT TAKES A PRINCIPAL WITHOUT AN ORGANIZATION, AND THAT IS THE TENANCY
 * PROPERTY RATHER THAN A CONVENIENCE. *** The contract states it for `tenant.members.get`:
 *
 *   "The composite-key lookup is what makes that structural rather than a branch: a statement
 *    naming only principal_id would find the person's membership of SOME OTHER Organization and
 *    would be a cross-tenant read, not a slower query."
 *
 * So the port cannot express the unsafe question. An adapter is free to write a bad statement —
 * that is what `qa-agent`'s isolation cases are for — but no CALLER can ask for one, because there
 * is no method that omits the tenant.
 */
export type MemberDirectoryStore = {
  /**
   * One page of the Organization's members, ordered stably.
   *
   * `limit` IS REQUIRED AND THERE IS NO UNLIMITED FORM, for the reason `SelectSpec.limit` is
   * required and `listMembershipsForPrincipal` restates: **an unbounded read on a
   * single-threaded database is every Organization's latency**, not just this one's.
   */
  listMembers(
    organizationId: AuthenticatedOrganizationId,
    limit: number,
    cursor: string | null,
  ): Promise<Result<TenantMemberPage>>;

  /**
   * One member, by the FULL composite key, or `null`.
   *
   * `null` MUST MEAN "no membership row in THIS Organization" — never "no such principal". The
   * service maps it to `notFound()`, and the contract requires all three cases to be
   * indistinguishable: not a member here, a member elsewhere, and no such principal at all.
   */
  findMember(
    organizationId: AuthenticatedOrganizationId,
    principalId: string,
  ): Promise<Result<TenantMemberSeat | null>>;
};

export type MemberDirectoryService = {
  list(input: {
    /** FROM `TenantAdminAuthority`, which read it off the session row. Never from a request. */
    readonly organizationId: AuthenticatedOrganizationId;
    readonly pageSize: number;
    readonly cursor: string | null;
  }): Promise<Result<TenantMemberPage>>;

  get(input: {
    readonly organizationId: AuthenticatedOrganizationId;
    readonly principalId: string;
  }): Promise<Result<TenantMemberSeat>>;
};

export function createMemberDirectoryService(
  store: MemberDirectoryStore,
  pageCap: number = TENANT_MEMBERS_PAGE_CAP,
  maxCustomRoles: number = TENANT_MEMBER_MAX_CUSTOM_ROLES,
): MemberDirectoryService {
  return {
    async list(input): Promise<Result<TenantMemberPage>> {
      // ---- THE CAP IS ENFORCED, NOT CLAMPED.
      //
      // Clamping 1000 to 100 silently answers a different question from the one asked, and a
      // client paging on the assumption it received 1000 rows skips records with no error to
      // notice. `readPageSize` refuses out of range at the transport; this refuses again, because
      // this service is reachable from a test harness and from any future caller, and a bound
      // enforced only at the boundary is a bound the next entry point does not have.
      if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > pageCap) {
        return err(invalidArgument([detail('page_size', 'out_of_range')]));
      }

      const page = await store.listMembers(input.organizationId, input.pageSize, input.cursor);
      if (!page.ok) {
        return err(page.error);
      }

      // =====================================================================================
      // ---- *** A SEAT CARRYING MORE THAN THE BOUND REFUSES THE WHOLE PAGE. ***
      // =====================================================================================
      //
      // See `TENANT_MEMBER_MAX_CUSTOM_ROLES`: a truncated authority list is a false statement
      // about a member's access, false in the reassuring direction, on the screen an administrator
      // uses to decide that access.
      //
      // **THE WHOLE PAGE, NOT THE SEAT.** Dropping the offending member would hide exactly the
      // person with the most roles, which is worse than either alternative — the directory would
      // be quietly incomplete rather than loudly broken, and the missing row is the one most worth
      // seeing.
      //
      // `internal` RATHER THAN `invalid_argument`, because **the caller did nothing wrong.** The
      // request was well-formed; the DATA violates a bound the write path was supposed to enforce.
      // Reporting it as the caller's error would send an administrator to fix their request.
      for (const seat of page.value.seats) {
        if (seat.customRoleIds.length > maxCustomRoles) {
          return err(internal());
        }
      }
      return ok(page.value);
    },

    async get(input): Promise<Result<TenantMemberSeat>> {
      const seat = await store.findMember(input.organizationId, input.principalId);
      if (!seat.ok) {
        return err(seat.error);
      }
      if (seat.value === null) {
        // THE THREE-WAY COLLAPSE. `notFound()` takes no arguments, so there is nothing to vary
        // between "not a member here", "a member of another Organization" and "no such principal".
        // The port cannot distinguish them either — `findMember` is keyed on the composite key —
        // so the collapse is structural rather than a branch that could be split later.
        return err(notFound());
      }
      if (seat.value.customRoleIds.length > maxCustomRoles) {
        // Same condition, same answer as the list path above. `internal()` takes no arguments, so
        // NOTHING about the offending member reaches the caller — and it must not: `security.md`
        // §6 forbids an error carrying business data, and *"member `prn_x` holds 23 roles"* is a
        // fact about a person disclosed to whoever provoked the error.
        return err(internal());
      }
      return ok(seat.value);
    },
  };
}
