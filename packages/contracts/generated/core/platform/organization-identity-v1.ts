/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/organization-identity-v1.schema.json
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

export type PrincipalId = string;

export type Timestamp = string;

export type DisplayName = string;

export type RegistrationNumber = string;

export type RegistrationVerification = {
  readonly verified_by_principal_id: PrincipalId;
  readonly verified_at: Timestamp;
};

export type RegistrationRecord = {
  readonly state: 'not_recorded';
} | {
  readonly state: 'not_registered';
  readonly declared_at: Timestamp;
} | {
  readonly state: 'registered';
  readonly number: RegistrationNumber;
  readonly recorded_at: Timestamp;
  readonly verification: RegistrationVerification | null;
} | { readonly state: 'unrecognised'; readonly raw: string };

export type RegistrationInput = {
  readonly state: 'not_recorded';
} | {
  readonly state: 'not_registered';
} | {
  readonly state: 'registered';
  readonly number: RegistrationNumber;
  readonly verified: boolean;
};

export type OrganizationIdentity = {
  readonly display_name: DisplayName | null;
  readonly commercial_registration: RegistrationRecord;
  readonly vat_registration: RegistrationRecord;
};

export type UpdateOrganizationIdentityInput = {
  readonly display_name?: DisplayName;
  readonly commercial_registration?: RegistrationInput;
  readonly vat_registration?: RegistrationInput;
};

export type UpdateOrganizationIdentityOutput = OrganizationIdentity;


export type PlatformOrganizationsIdentityUpdateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsIdentityUpdatePermission = 'core.platform-organization.update' as const;
