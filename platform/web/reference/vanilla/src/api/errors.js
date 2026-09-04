/**
 * The error envelope, client side.
 *
 * SOURCE: packages/contracts/common/error-envelope.schema.json
 *   { error: { code, message, request_id, details?, retry_after_seconds? } }
 *
 * Every failure the views handle arrives as an `ApiError`. There is one shape,
 * so there is one place that decides how a failure is worded and whether it is
 * worth offering a retry.
 */

/** The platform's closed error taxonomy, as the contract's Actions declare it. */
export const ERROR_CODES = Object.freeze([
  'invalid_argument', 'unauthenticated', 'forbidden', 'not_found', 'conflict',
  'failed_precondition', 'quota_exceeded', 'rate_limited', 'internal',
  'unavailable', 'timeout',
]);

export class ApiError extends Error {
  constructor({ code, message, request_id, details, retry_after_seconds }) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.code = code || 'internal';
    this.request_id = request_id || null;
    this.details = Array.isArray(details) ? details : [];
    this.retry_after_seconds =
      typeof retry_after_seconds === 'number' ? retry_after_seconds : null;
  }

  /** Build from a wire envelope. */
  static fromEnvelope(envelope) {
    const error = envelope && envelope.error ? envelope.error : {};
    return new ApiError(error);
  }

  toEnvelope() {
    const error = { code: this.code, message: this.message, request_id: this.request_id };
    if (this.details.length) error.details = this.details;
    if (this.retry_after_seconds !== null) error.retry_after_seconds = this.retry_after_seconds;
    return { error };
  }
}

export function isApiError(value) {
  return value instanceof ApiError;
}

/**
 * A retry is offered only where retrying could plausibly succeed without the
 * user changing anything. Offering "Try again" beside `forbidden` invites a
 * person to hammer a door that is closed on purpose.
 */
export function isRetryable(error) {
  return ['internal', 'unavailable', 'timeout', 'rate_limited'].includes(error?.code);
}

/**
 * The heading a person reads. Deliberately about *their* situation and not
 * about the transport.
 */
const TITLES = Object.freeze({
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
});

export function errorTitle(error) {
  return TITLES[error?.code] || 'Something went wrong';
}

/**
 * Wording of last resort. The server's own `message` is written for a
 * developer, so it is shown as supporting detail rather than as the headline.
 */
const BODIES = Object.freeze({
  unauthenticated: 'Your session is not active. Sign in and try again.',
  forbidden: 'Your permissions do not cover this customer. Ask an owner of this Organization for access.',
  not_found: 'It may have been moved, or the link may be wrong.',
  failed_precondition: 'The record has moved on since this page was loaded. Reload it to see where it stands now.',
  rate_limited: 'Wait a moment and try again.',
  unavailable: 'This is usually brief. Try again in a moment.',
  timeout: 'The request did not finish. Try again.',
  internal: 'The problem has been recorded. Try again in a moment.',
});

export function errorBody(error) {
  if (!error) return '';
  if (error.code === 'rate_limited' && error.retry_after_seconds !== null) {
    return `Wait about ${error.retry_after_seconds} seconds and try again.`;
  }
  return BODIES[error.code] || error.message || '';
}
