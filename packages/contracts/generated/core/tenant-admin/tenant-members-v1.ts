/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-members-v1.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  *** status `proposed` — NOT ACCEPTED. ***
 *
 *            THE SOURCE CONTRACT IS NOT ACCEPTED, SO NOTHING BELOW IS AGREED. Types may
 *            change shape without a version bump, and ANY `*Permission` CONSTANT BELOW
 *            NAMES A PERMISSION THAT MAY NOT EXIST: docs/decisions/0007 rule 4 — a
 *            permission does not exist until it is in packages/contracts/registries/
 *            permission-catalog.yaml. Importing the name neither creates nor grants it,
 *            and a route gated on it will refuse every caller under deny-by-default.
 *            Build against this only if you are prepared to rewrite when it is accepted.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

import type { ErrorEnvelope } from '../../common/error-envelope.ts';
import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';

export type ErrorResponse = ErrorEnvelope;

export type PrincipalId = string;

export type MemberDisplayName = string | null;

export type MembershipRole = 'owner' | 'admin' | 'business-admin' | 'member';

export type MembershipRoleOrNull = MembershipRole | null;

export type RoleId = string;

export type MembershipStatus = 'active' | 'suspended';

export type MemberSeat = {
  readonly principal_id: PrincipalId;
  readonly display_name: MemberDisplayName;
  readonly membership_role: MembershipRoleOrNull;
  readonly custom_role_ids: ReadonlyArray<RoleId>;
  readonly status: MembershipStatus;
  readonly joined_at: string;
};

export type ListMembersInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListMembersOutput = {
  readonly data: ReadonlyArray<MemberSeat>;
  readonly next_cursor: NextCursor;
};

export type GetMemberInput = {
  readonly principal_id: PrincipalId;
};

export type GetMemberOutput = MemberSeat;

export type ChangeMemberStatusInput = {
  readonly principal_id: PrincipalId;
};

export type ChangeMemberStatusOutput = MemberSeat;

export type RemoveMemberInput = {
  readonly principal_id: PrincipalId;
};

export type RemoveMemberOutput = {
  readonly principal_id: PrincipalId;
  readonly removed_at: string;
};


export type TenantMembersListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersListPermission = 'core.user.list' as const;

export type TenantMembersGetError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersGetPermission = 'core.user.read' as const;

export type TenantMembersSuspendError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersSuspendPermission = 'core.user.deactivate' as const;

export type TenantMembersReactivateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersReactivatePermission = 'core.user.reactivate' as const;

export type TenantMembersRemoveError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersRemovePermission = 'core.user.remove' as const;
