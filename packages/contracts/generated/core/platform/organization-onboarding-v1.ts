/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/organization-onboarding-v1.schema.json
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

export type AdminIdentifier = string;

export type DisplayName = string;

export type TemplateId = string;

export type WorkspaceName = string;

export type DerivedValue = string;

export type OnboardOrganizationInput = {
  readonly admin_identifier: AdminIdentifier;
  readonly display_name?: DisplayName;
  readonly template_id: TemplateId;
  readonly first_workspace_name: WorkspaceName;
  readonly derived_value: DerivedValue;
};

export type OnboardingWarning = 'first_workspace_not_created' | 'tenant_audit_record_not_written' | (string & {});

export type OnboardOrganizationOutput = {
  readonly organization_id: string;
  readonly admin_principal_id: string;
  readonly workspace_id: string | null;
  readonly warnings: ReadonlyArray<OnboardingWarning>;
};


export type PlatformOrganizationsCreateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsCreatePermission = 'core.organization.create' as const;
