/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/platform-operator-v1.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  status `accepted`.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

export type OrganizationId = string;

export type PrincipalId = string;

export type OrganizationStatus = 'active' | 'suspended' | (string & {});

export type PlatformRole = 'platform-admin' | 'marketplace-moderator' | (string & {});

export type PermissionId = string;

export type Cursor = string | null;

export type OrganizationSummary = {
  readonly organization_id: OrganizationId;
  readonly status: OrganizationStatus;
  readonly created_at: string;
  readonly display_name: string | null;
};

export type ListOrganizationsOutput = {
  readonly data: ReadonlyArray<OrganizationSummary>;
  readonly next_cursor: Cursor;
};

export type WhoamiOutput = {
  readonly principal_id: PrincipalId;
  readonly platform_role: PlatformRole;
  readonly permissions: ReadonlyArray<PermissionId>;
};


export type PlatformOrganizationsListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'unavailable';
export const PlatformOrganizationsListPermission = 'core.organization.list' as const;

export type PlatformSessionWhoamiError = 'unauthenticated' | 'forbidden' | 'rate_limited' | 'unavailable';
export const PlatformSessionWhoamiPermission = 'core.organization.list' as const;
