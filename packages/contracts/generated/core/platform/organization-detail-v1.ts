/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/organization-detail-v1.schema.json
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

import type { RegistrationRecord } from './organization-identity-v1.ts';

export type OrganizationId = string;

export type PrincipalId = string;

export type MembershipRole = 'owner' | 'member' | (string & {});

export type OrganizationDetailOutput = {
  readonly organization_id: OrganizationId;
  readonly status: 'active' | 'suspended' | (string & {});
  readonly created_at: string;
  readonly display_name: string | null;
  readonly commercial_registration: RegistrationRecord;
  readonly vat_registration: RegistrationRecord;
  readonly template: null | {
  readonly template_id: string;
  readonly name: string;
  readonly level_labels: {
  readonly organization: string;
  readonly workspace: string;
  readonly branch: string;
};
};
  readonly member_count: number;
};

export type ResolveMemberInput = {
  readonly target_identifier: string;
};

export type ResolveMemberOutput = {
  readonly principal_id: PrincipalId;
  readonly role: MembershipRole;
};


export type PlatformOrganizationsReadError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsReadPermission = 'core.organization.list' as const;

export type PlatformOrganizationsMembersResolveError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsMembersResolvePermission = 'core.credential.reset' as const;
