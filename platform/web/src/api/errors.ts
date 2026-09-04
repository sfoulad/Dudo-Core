/**
 * The error envelope, client side.
 *
 * SOURCE: packages/contracts/common/error-envelope.schema.json
 *   { error: { code, message, request_id, details?, retry_after_seconds? } }
 *
 * Every failure a screen handles arrives as an `ApiError`, so there is one
 * place that decides how a failure is worded and whether a retry is worth
 * offering.
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
 * `unauthenticated` IS DELIBERATELY NOT RETRYABLE, AND THAT IS NOW A RULE RATHER
 * THAN A JUDGEMENT. `docs/decisions/0018` requires a `401` to be read as SIGNED
 * OUT: logout deletes the session row but CANNOT clear the cookie, so after a
 * successful sign-out the browser keeps presenting a dead credential for up to
 * 12 hours. Retrying with it can only fail again. The recovery is to sign in —
 * which is what the gate does when the transport reports the `401`.
 */
export function isRetryable(error: Pick<ApiError, 'code'> | null | undefined): boolean {
  if (!error) return false;
  return (['internal', 'unavailable', 'timeout', 'rate_limited'] as ErrorCode[]).includes(error.code);
}

const TITLES: Record<ErrorCode, string> = {
  invalid_argument: 'Check the details you entered',
  unauthenticated: 'You need to sign in',
  forbidden: 'You do not have access to this',
  not_found: 'This customer is not here',
  conflict: 'That conflicts with an existing record',
  failed_precondition: 'That is not possible in this state',
  quota_exceeded: 'This Organization has reached a limit',
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
  unauthenticated: 'Your session is not active. Sign in and try again.',
  forbidden:
    'Your permissions do not cover this customer. Ask an owner of this Organization for access.',
  not_found: 'It may have been moved, or the link may be wrong.',
  failed_precondition:
    'The record has moved on since this page was loaded. Reload it to see where it stands now.',
  rate_limited: 'Wait a moment and try again.',
  unavailable: 'This is usually brief. Try again in a moment.',
  timeout: 'The request did not finish. Try again.',
  internal: 'The problem has been recorded. Try again in a moment.',
};

/**
 * Wording of last resort. The server's own `message` is written for a
 * developer, so it is shown as supporting detail rather than as the headline.
 */
export function errorBody(error: ApiError | null | undefined): string {
  if (!error) return '';
  if (error.code === 'rate_limited' && error.retry_after_seconds !== null) {
    return `Wait about ${error.retry_after_seconds} seconds and try again.`;
  }
  return BODIES[error.code] ?? error.message ?? '';
}
