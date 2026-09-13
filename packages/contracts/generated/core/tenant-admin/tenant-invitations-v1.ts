/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-invitations-v1.schema.json
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
import type { MembershipRole, PrincipalId, RoleId } from './tenant-members-v1.ts';
import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';

export type ErrorResponse = ErrorEnvelope;

export type InvitationId = string;

export type InvitationIdentifier = string;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type InvitationRecord = {
  readonly invitation_id: InvitationId;
  readonly identifier: InvitationIdentifier;
  readonly membership_role: MembershipRole;
  readonly custom_role_ids?: ReadonlyArray<RoleId>;
  readonly status: InvitationStatus;
  readonly created_at: string;
  readonly resent_at?: string | null;
  readonly expires_at: string;
  readonly invited_by: PrincipalId;
};

export type ListInvitationsInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListInvitationsOutput = {
  readonly data: ReadonlyArray<InvitationRecord>;
  readonly next_cursor: NextCursor;
};

export type CreateInvitationInput = {
  readonly identifier: InvitationIdentifier;
  readonly membership_role: MembershipRole;
  readonly custom_role_ids?: ReadonlyArray<RoleId>;
};

export type CreateInvitationOutput = InvitationRecord;

export type InvitationActionInput = {
  readonly invitation_id: InvitationId;
};

export type InvitationActionOutput = InvitationRecord;

export type PendingInvitationCountOutput = {
  readonly pending: number;
};


export type TenantInvitationsListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsListPermission = 'core.invitation.list' as const;

export type TenantInvitationsGetError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsGetPermission = 'core.invitation.list' as const;

export type TenantInvitationsCreateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsCreatePermission = 'core.user.invite' as const;

export type TenantInvitationsResendError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsResendPermission = 'core.user.invite' as const;

export type TenantInvitationsRevokeError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsRevokePermission = 'core.user.invite' as const;

export type TenantInvitationsPendingCountError = 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantInvitationsPendingCountPermission = '[core.user.invite, core.invitation.list]' as const;
