/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-roles-v1.schema.json
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
import type { MemberSeat, MembershipRole, PrincipalId } from './tenant-members-v1.ts';
import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';

export type ErrorResponse = ErrorEnvelope;

export type PermissionId = string;

export type RoleId = RoleId;

export type RoleName = string;

export type RoleKind = 'seed' | 'custom';

export type RoleSummary = {
  readonly role_id: RoleId;
  readonly name: RoleName;
  readonly kind: RoleKind;
  readonly permissions: ReadonlyArray<PermissionId>;
  readonly member_count: number;
};

export type RoleDetail = {
  readonly role_id: RoleId;
  readonly name: RoleName;
  readonly kind: RoleKind;
  readonly permissions: ReadonlyArray<PermissionId>;
  readonly member_count: number;
  readonly created_by: PrincipalId | null;
  readonly created_at: string | null;
};

export type SetMembershipRoleInput = {
  readonly principal_id: PrincipalId;
  readonly membership_role: MembershipRole;
};

export type SetMembershipRoleOutput = MemberSeat;

export type ListRolesInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListRolesOutput = {
  readonly data: ReadonlyArray<RoleSummary>;
  readonly next_cursor: NextCursor;
};

export type GetRoleInput = {
  readonly role_id: RoleId;
};

export type GetRoleOutput = RoleDetail;

export type CreateRoleInput = {
  readonly name: RoleName;
  readonly permissions: ReadonlyArray<PermissionId>;
};

export type CreateRoleOutput = RoleDetail;

export type UpdateRoleInput = {
  readonly role_id: RoleId;
  readonly name?: RoleName;
  readonly permissions?: ReadonlyArray<PermissionId>;
};

export type UpdateRoleOutput = RoleDetail;

export type DeleteRoleInput = {
  readonly role_id: RoleId;
};

export type DeleteRoleOutput = {
  readonly role_id: RoleId;
  readonly deleted_at: string;
};

export type RoleAssignmentInput = {
  readonly role_id: RoleId;
  readonly principal_id: PrincipalId;
};

export type RoleAssignmentOutput = MemberSeat;


export type TenantRolesListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesListPermission = 'core.role.read' as const;

export type TenantRolesGetError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesGetPermission = 'core.role.read' as const;

export type TenantRolesCreateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesCreatePermission = 'core.role.create' as const;

export type TenantRolesUpdateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesUpdatePermission = 'core.role.update' as const;

export type TenantRolesDeleteError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesDeletePermission = 'core.role.update' as const;

export type TenantRolesAssignError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesAssignPermission = 'core.role.assign' as const;

export type TenantRolesRevokeError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesRevokePermission = 'core.role.revoke' as const;

export type TenantRolesSetMembershipRoleError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantRolesSetMembershipRolePermission = 'core.role.assign' as const;
