/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/template-lifecycle-v1.schema.json
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

import type { LevelLabels, TemplateId, TemplateName, TemplateOutput } from './template-v1.ts';
import type { OrganizationId } from './organization-detail-v1.ts';

export type UpdateTemplateInput = {
  readonly name?: TemplateName;
  readonly level_labels?: LevelLabels;
};

export type TemplateUsageOutput = {
  readonly template: TemplateOutput;
  readonly organizations_using: number;
};

export type SetOrganizationTemplateInput = {
  readonly template_id: TemplateId | null;
};

export type OrganizationTemplateOutput = {
  readonly organization_id: OrganizationId;
  readonly template: TemplateOutput | null;
  readonly updated_at: string;
};


export type PlatformTemplatesUsageError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable';
export const PlatformTemplatesUsagePermission = 'core.template-adoption.read' as const;

export type PlatformTemplatesUpdateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformTemplatesUpdatePermission = 'core.template.update' as const;

export type PlatformTemplatesRetireError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformTemplatesRetirePermission = 'core.template.retire' as const;

export type PlatformTemplatesRestoreError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformTemplatesRestorePermission = 'core.template.retire' as const;

export type PlatformOrganizationsSetTemplateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsSetTemplatePermission = 'core.platform-organization.set-template' as const;
