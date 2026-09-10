/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/platform-operators-v1.schema.json
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

export type PlatformRole = 'platform-admin' | 'marketplace-moderator' | (string & {});

export type OperatorSummary = {
  readonly principal_id: PrincipalId;
  readonly platform_role: PlatformRole;
  readonly created_at: string;
};

export type ListOperatorsOutput = {
  readonly data: ReadonlyArray<OperatorSummary>;
  readonly next_cursor: string | null;
};

export type RevokeOperatorInput = {
  readonly confirmation_id: string;
  readonly reauth_derived_value: string;
  readonly reauth_identifier: string;
};

export type RevokeOperatorOutput = {
  readonly principal_id: PrincipalId;
  readonly was_self: boolean;
  readonly remaining_operator_count: number;
};


export type PlatformOperatorsListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOperatorsListPermission = 'core.platform-audit.read' as const;

export type PlatformOperatorsRevokeError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformOperatorsRevokePermission = 'core.principal.revoke-platform-scope' as const;
