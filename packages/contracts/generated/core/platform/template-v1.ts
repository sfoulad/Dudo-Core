/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/template-v1.schema.json
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

export type TemplateId = string;

export type TemplateName = string;

export type LevelLabel = string;

export type LevelLabels = {
  readonly organization?: LevelLabel;
  readonly workspace?: LevelLabel;
  readonly branch?: LevelLabel;
};

export type TemplateStatus = 'active' | 'retired' | (string & {});

export type TemplateStatusFilter = 'active' | 'retired';

export type CreateTemplateInput = {
  readonly name: TemplateName;
  readonly level_labels?: LevelLabels;
};

export type TemplateOutput = {
  readonly template_id: TemplateId;
  readonly name: TemplateName;
  readonly level_labels: {
  readonly organization: LevelLabel;
  readonly workspace: LevelLabel;
  readonly branch: LevelLabel;
};
  readonly status: TemplateStatus;
  readonly created_at: string;
};

export type ListTemplatesOutput = {
  readonly data: ReadonlyArray<TemplateOutput>;
  readonly next_cursor: string | null;
};


export type PlatformTemplatesCreateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformTemplatesCreatePermission = 'core.template.create' as const;

export type PlatformTemplatesListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'unavailable';
export const PlatformTemplatesListPermission = 'core.template.list' as const;

export type PlatformTemplatesReadError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable';
export const PlatformTemplatesReadPermission = 'core.template.read' as const;
