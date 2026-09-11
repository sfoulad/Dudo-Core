/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/common/error-envelope.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  NONE — this is a shared schema with no `*.contract.yaml` beside it, so it
 *            declares no status. That is expected for `common/` and `registries/`.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

export type ErrorEnvelope = {
  readonly error: ErrorBodyWithRetryAfter | ErrorBodyWithoutRetryAfter;
};

export type ErrorCode = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'not_implemented' | 'unavailable' | 'timeout';

export type CodeCarryingRetryAfter = 'rate_limited' | 'quota_exceeded';

export type CodeWithoutRetryAfter = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'failed_precondition' | 'internal' | 'not_implemented' | 'unavailable' | 'timeout';

export type ErrorMessage = string;

export type ErrorDetails = ReadonlyArray<{
  readonly field: string;
  readonly issue: string;
}>;

export type ErrorRequestId = string;

export type RetryAfterSeconds = number;

export type ErrorBodyWithRetryAfter = {
  readonly code: CodeCarryingRetryAfter;
  readonly message: ErrorMessage;
  readonly details?: ErrorDetails;
  readonly request_id: ErrorRequestId;
  readonly retry_after_seconds?: RetryAfterSeconds;
};

export type ErrorBodyWithoutRetryAfter = {
  readonly code: CodeWithoutRetryAfter;
  readonly message: ErrorMessage;
  readonly details?: ErrorDetails;
  readonly request_id: ErrorRequestId;
};
