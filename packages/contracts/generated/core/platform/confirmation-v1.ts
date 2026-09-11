/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/platform/confirmation-v1.schema.json
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

export type ActionId = string;

export type ConfirmationId = string;

export type RequestConfirmationInput = {
  readonly action_id: ActionId;
  readonly locale?: string;
  readonly parameters: {
  readonly [key: string]: unknown;
};
};

export type ConfirmationChallenge = {
  readonly confirmation_id: ConfirmationId;
  readonly statement_locale: string;
  readonly statement: string;
  readonly expires_at: string;
};

export type ConfirmedRequestFields = {
  readonly confirmation_id: ConfirmationId;
  readonly reauth_identifier: string;
  readonly reauth_derived_value: string;
  readonly [key: string]: unknown;
};


export type PlatformConfirmationsRequestError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const PlatformConfirmationsRequestPermission = 'THE SAME PERMISSION AS THE OPERATION NAMED IN THE REQUEST, resolved from action_id. Not a permission of its own.' as const;

export type CoreConfirmationsRequestError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'organization_not_selected' | 'rate_limited' | 'quota_exceeded' | 'unavailable';
export const CoreConfirmationsRequestPermission = 'THE SAME PERMISSION AS THE ACTION NAMED IN THE REQUEST. It IS an Action and is invoked through the ordinary pipeline.' as const;
