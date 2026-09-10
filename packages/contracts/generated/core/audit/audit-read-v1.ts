/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/audit/audit-read-v1.schema.json
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

import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';

export type AuditEventId = string;

export type PrincipalId = string;

export type BusinessId = string;

export type Timestamp = string;

export type ActionId = string;

export type PermissionId = string;

export type TenantScope = 'organization' | 'business' | 'branch' | 'team' | 'own' | 'resource';

export type Decision = 'allowed' | 'denied';

export type DenialReason = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_argument' | 'failed_precondition' | 'conflict' | 'rate_limited' | 'quota_exceeded' | null;

export type PrincipalType = 'user' | 'team' | 'service-account' | 'ai-agent' | 'iot-device' | (string & {});

export type TargetResourceId = string | null;

export type FieldName = string;

export type CorrelationId = string;

export type AuditEventRecord = {
  readonly record_id: AuditEventId;
  readonly occurred_at: Timestamp;
  readonly app_id: string;
  readonly action_id: ActionId;
  readonly principal_id: PrincipalId;
  readonly principal_type: PrincipalType;
  readonly on_behalf_of_principal_id: PrincipalId | null;
  readonly permission_id: PermissionId;
  readonly scope: TenantScope;
  readonly decision: Decision;
  readonly denial_reason: DenialReason;
  readonly target_resource_id: TargetResourceId;
  readonly target_unresolved: boolean;
  readonly related_business_ids: ReadonlyArray<BusinessId>;
  readonly actor_business_ids: ReadonlyArray<BusinessId>;
  readonly changed_field_names: ReadonlyArray<FieldName>;
  readonly correlation_id: CorrelationId;
};

export type PlatformActionRecord = {
  readonly record_id: AuditEventId;
  readonly occurred_at: Timestamp;
  readonly action_id: ActionId;
  readonly permission_id: PermissionId;
  readonly target_principal_id: PrincipalId | null;
  readonly correlation_id: CorrelationId;
};

export type ListAuditEventsInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
  readonly since?: Timestamp;
  readonly until?: Timestamp;
  readonly action_id?: ActionId;
  readonly principal_id?: PrincipalId;
  readonly decision?: Decision;
  readonly target_resource_id?: string;
};

export type ListPlatformActionsInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
  readonly since: Timestamp;
  readonly until: Timestamp;
  readonly action_id?: ActionId;
  readonly target_principal_id?: PrincipalId;
};

export type ListAuditEventsOutput = {
  readonly data: ReadonlyArray<AuditEventRecord>;
  readonly next_cursor: NextCursor;
};

export type ListPlatformActionsOutput = {
  readonly data: ReadonlyArray<PlatformActionRecord>;
  readonly next_cursor: NextCursor;
};


export type CoreListAuditEventsError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CoreListAuditEventsPermission = 'core.audit.read' as const;

export type CoreListPlatformActionsError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CoreListPlatformActionsPermission = 'core.audit.read' as const;
