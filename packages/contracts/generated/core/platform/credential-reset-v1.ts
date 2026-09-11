/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/credential-reset-v1.schema.json
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

export type ResetCredentialInput = {
  readonly principal_id: string;
  readonly target_identifier: string;
  readonly confirmation_id: string;
  readonly reauth_identifier: string;
  readonly reauth_derived_value: string;
  readonly derived_value: string;
};

export type ResetWarning = 'sessions_not_revoked' | 'tenant_audit_incomplete' | (string & {});

export type ResetCredentialOutput = {
  readonly principal_id: string;
  readonly sessions_revoked: number;
  readonly warnings: ReadonlyArray<ResetWarning>;
};


export type PlatformCredentialsResetError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformCredentialsResetPermission = 'core.credential.reset' as const;
