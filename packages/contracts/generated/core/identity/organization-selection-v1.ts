/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/identity/organization-selection-v1.schema.json
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

export type OrganizationDisplayName = string;

export type OrganizationDisplayNameOrNull = OrganizationDisplayName | null;

export type EnterableOrganization = {
  readonly organization_id: OrganizationId;
  readonly display_name: OrganizationDisplayNameOrNull;
};

export type ListEnterableOrganizationsOutput = {
  readonly data: ReadonlyArray<EnterableOrganization>;
};

export type SelectOrganizationInput = {
  readonly organization_id: OrganizationId;
};

export type SelectOrganizationOutput = {
  readonly status: 'ok';
};


export type IdentityOrganizationsListError = 'unauthenticated' | 'unavailable';
export const IdentityOrganizationsListPermission = 'none' as const;

export type IdentityOrganizationSelectError = 'invalid_argument' | 'unauthenticated' | 'not_found' | 'quota_exceeded' | 'unavailable';
export const IdentityOrganizationSelectPermission = 'none' as const;
