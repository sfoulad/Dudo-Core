/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/identity/login-v1.schema.json
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

export type EmailIdentifier = string;

export type DerivedKey = string;

export type LoginCompleteRequest = {
  readonly email: EmailIdentifier;
  readonly derived_key: DerivedKey;
};

export type PreAuthAcknowledgement = {
  readonly status: 'ok';
};

export type SessionCredential = string;


export type IdentityLoginCompleteError = 'invalid_argument' | 'unauthenticated' | 'rate_limited' | 'unavailable';
export const IdentityLoginCompletePermission = 'none' as const;

export type IdentityLoginStartError = 'invalid_argument' | 'rate_limited';
export const IdentityLoginStartPermission = 'none' as const;

export type IdentitySessionRefreshError = 'unauthenticated' | 'rate_limited';
export const IdentitySessionRefreshPermission = 'none' as const;

export type IdentitySessionRevokeError = 'rate_limited';
export const IdentitySessionRevokePermission = 'none' as const;
