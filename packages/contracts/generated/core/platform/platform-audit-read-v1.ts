/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/platform-audit-read-v1.schema.json
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

export type OrganizationId = string;

export type PlatformRole = 'platform-admin' | 'marketplace-moderator' | (string & {});

export type ActionId = string;

export type Outcome = 'succeeded' | 'failed';

export type RecordCommon = {
  readonly record_id: string;
  readonly occurred_at: string;
  readonly actor_principal_id: PrincipalId;
  readonly actor_platform_role: PlatformRole;
  readonly action_id: ActionId;
  readonly outcome: Outcome;
  readonly correlation_id: string;
  readonly [key: string]: unknown;
};

export type PlatformFeedRecord = RecordCommon;

export type OrganizationFeedRecord = {
  readonly record_id: string;
  readonly occurred_at: string;
  readonly actor_principal_id: PrincipalId;
  readonly actor_platform_role: PlatformRole;
  readonly action_id: ActionId;
  readonly outcome: Outcome;
  readonly correlation_id: string;
  readonly target_principal_id: PrincipalId | null;
};

export type Cursor = string | null;

export type PlatformFeedOutput = {
  readonly data: ReadonlyArray<PlatformFeedRecord>;
  readonly next_cursor: Cursor;
};

export type OrganizationFeedOutput = {
  readonly data: ReadonlyArray<OrganizationFeedRecord>;
  readonly next_cursor: Cursor;
};


export type PlatformAuditListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformAuditListPermission = 'core.platform-audit.read' as const;

export type PlatformOrganizationsAuditListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOrganizationsAuditListPermission = 'core.platform-audit.read' as const;
