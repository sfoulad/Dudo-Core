/**
 * The error envelope, console side.
 *
 * SOURCE: packages/contracts/common/error-envelope.schema.json
 *   { error: { code, message, request_id, details?, retry_after_seconds? } }
 *
 * THE CODES ARE THE CONTRACT'S AND ARE NOT EXTENDED HERE. The wording is this
 * console's own, because an operator is not a customer: `forbidden` on
 * `app.dudo.work` means "ask an owner of this Organization for access", and on
 * `admin.dudo.work` it means the caller is not a platform operator at all. Same
 * code, different reader, different sentence.
 *
 * ===========================================================================
 * `forbidden` IS FOUR CONDITIONS COLLAPSED INTO ONE, DELIBERATELY
 * ===========================================================================
 *
 * `platform-operator-v1.contract.yaml`, `errors.forbidden`: "A principal with no
 * platform_operator row, an unrecognised platform_role, a role lacking the
 * permission, OR A PRINCIPAL PRESENT IN BOTH TABLES, all receive the identical
 * argument-free forbidden. The four are indistinguishable, and the fourth is
 * why: a caller able to detect the mutual-exclusion refusal could use these
 * routes to probe organization_membership."
 *
 * SO THIS CONSOLE MUST NOT TRY TO SAY WHICH ONE HAPPENED, and the wording below
 * is written to be true of all four rather than to guess at the likely one. A
 * message reading "you are not a platform operator" would be a confident
 * statement the response does not support, and on the fourth condition it would
 * be actively wrong.
 */

export const ERROR_CODES = [
  'invalid_argument',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'failed_precondition',
  'quota_exceeded',
  'rate_limited',
  'internal',
  'unavailable',
  'timeout',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    details?: ErrorDetail[];
    retry_after_seconds?: number;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly request_id: string | null;
  readonly details: ErrorDetail[];
  readonly retry_after_seconds: number | null;

  constructor(init: {
    code?: ErrorCode;
    message?: string;
    request_id?: string | null;
    details?: ErrorDetail[];
    retry_after_seconds?: number | null;
  }) {
    super(init.message || init.code || 'Request failed');
    this.name = 'ApiError';
    this.code = init.code ?? 'internal';
    this.request_id = init.request_id ?? null;
    this.details = init.details ?? [];
    this.retry_after_seconds = init.retry_after_seconds ?? null;
  }

  static fromEnvelope(envelope: ErrorEnvelope): ApiError {
    return new ApiError(envelope.error);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Normalise anything thrown into an ApiError, so no view sees a raw throw. */
export function toApiError(thrown: unknown): ApiError {
  if (isApiError(thrown)) return thrown;
  return new ApiError({ code: 'internal', message: 'The request could not be completed.' });
}

/**
 * A retry is offered only where retrying could plausibly succeed without the
 * person changing anything. Offering "Try again" beside `forbidden` invites
 * someone to hammer a door that is closed on purpose.
 *
 * `unauthenticated` IS DELIBERATELY NOT RETRYABLE. `docs/decisions/0018`
 * requires a `401` to be read as SIGNED OUT rather than as a transient failure:
 * the recovery is to sign in, and retrying with a dead credential can only fail
 * again.
 */
export function isRetryable(error: Pick<ApiError, 'code'> | null | undefined): boolean {
  if (!error) return false;
  return (['internal', 'unavailable', 'timeout', 'rate_limited'] as ErrorCode[]).includes(
    error.code,
  );
}

/**
 * Whether a failed write means Core **certainly** wrote nothing.
 *
 * ===========================================================================
 * THE DANGEROUS CASE IS NOT FAILURE. IT IS NOT KNOWING.
 * ===========================================================================
 *
 * "It failed" and "it may have happened" are different facts, and a caller must
 * not have to guess which they are holding. On the credential reset — the
 * operation this was written for — getting it wrong one way hands a customer a
 * password that was never written, turning an account that was merely broken
 * into one that is confirmed broken. The other way discards the only copy of a
 * credential that is live, which cannot be undone.
 *
 * REFUSALS ARE DECISIONS CORE MADE BEFORE WRITING: a `conflict`, a
 * `quota_exceeded`, a `forbidden`, an `invalid_argument`, a `not_found`, a
 * `rate_limited`, a `failed_precondition`. Nothing was changed.
 *
 * EVERYTHING ELSE IS INDETERMINATE, INCLUDING THE ORDINARY ONES. A timeout, an
 * unreachable server, a 500 — the request may have arrived and succeeded with
 * the response lost on the way back. **This client cannot tell**, and reporting
 * "nothing was changed" there would be a confident claim with no basis.
 * `unauthenticated` is indeterminate too: a session that expired mid-flight says
 * nothing about whether the request that carried it was applied first.
 *
 * IT LIVES HERE RATHER THAN ON A SCREEN because it is a property of the error
 * code, not of any one operation — and because a screen is a `.tsx` file, which
 * Node's type stripping cannot load, so the classification would have been
 * assertable only by grepping its source. A regex over a file that merely
 * MENTIONS the codes proves nothing about how they are classified.
 */
export function writeIsCertainlyAbsent(error: Pick<ApiError, 'code'>): boolean {
  switch (error.code) {
    case 'conflict':
    case 'quota_exceeded':
    case 'rate_limited':
    case 'forbidden':
    case 'not_found':
    case 'invalid_argument':
    case 'failed_precondition':
      return true;
    case 'unavailable':
    case 'timeout':
    case 'internal':
    case 'unauthenticated':
      return false;
    /*
     * NO `default`, DELIBERATELY. `noFallthroughCasesInSwitch` plus an
     * exhaustive union means adding a code to `ERROR_CODES` fails the build here
     * rather than silently falling into one side — and the side it would fall
     * into is the dangerous one.
     */
  }
}

const TITLES: Record<ErrorCode, string> = {
  invalid_argument: 'Check what was sent',
  unauthenticated: 'You need to sign in',
  forbidden: 'This console will not perform that',
  not_found: 'That is not here',
  conflict: 'That conflicts with something that already exists',
  failed_precondition: 'That is not possible in this state',
  quota_exceeded: 'A platform limit has been reached',
  rate_limited: 'Too many requests just now',
  internal: 'Something went wrong at our end',
  unavailable: 'Dudo is temporarily unreachable',
  timeout: 'That took too long',
};

export function errorTitle(error: Pick<ApiError, 'code'> | null | undefined): string {
  if (!error) return 'Something went wrong';
  return TITLES[error.code] ?? 'Something went wrong';
}

const BODIES: Partial<Record<ErrorCode, string>> = {
  unauthenticated: 'Your operator session is not active. Sign in and try again.',
  /*
   * WRITTEN TO BE TRUE OF ALL FOUR COLLAPSED CONDITIONS. See the header. It does
   * not say the caller lacks a platform_operator row, because Core deliberately
   * does not say so and one of the four conditions would make that claim false.
   */
  forbidden:
    'Core refused this call for this principal. The refusal is deliberately unspecific and this ' +
    'console cannot tell you which condition produced it. Raise it with the Team Lead rather ' +
    'than retrying.',
  not_found: 'The identifier may be wrong, or the object may have been removed.',
  failed_precondition: 'Something this depends on is not in the required state.',
  rate_limited: 'Wait a moment and try again.',
  unavailable: 'This is usually brief. Try again in a moment.',
  timeout: 'The request did not finish. Try again.',
  internal: 'The problem has been recorded. Try again in a moment.',
};

/**
 * Wording of last resort. The server's own `message` is written for a developer,
 * so it is shown as supporting detail rather than as the headline.
 */
export function errorBody(error: ApiError | null | undefined): string {
  if (!error) return '';
  if (error.code === 'rate_limited' && error.retry_after_seconds !== null) {
    return `Wait about ${String(error.retry_after_seconds)} seconds and try again.`;
  }
  return BODIES[error.code] ?? error.message ?? '';
}
