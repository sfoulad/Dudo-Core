/**
 * The closed error taxonomy, and the constructors that make indistinguishability
 * structural rather than a review item.
 *
 * Governed by API_STANDARD.md §8 and packages/contracts/common/error-envelope.schema.json.
 *
 * THE LOAD-BEARING DESIGN CHOICE IN THIS FILE:
 *
 *   `notFound()` and `forbidden()` take NO ARGUMENTS.
 *
 * MULTITENANCY_STANDARD.md §5 and the Customer Directory contract
 * (authorizationModel.notFoundVersusForbidden.indistinguishability) require that the
 * `not_found` returned for another tenant's identifier be byte-identical — status code,
 * error code, message string, details array, response-size class and headers — to the
 * `not_found` returned for an identifier that exists nowhere, with `request_id` the only
 * permitted difference.
 *
 * A constructor that accepted a message or a detail could be called with a value derived
 * from the record that was found, and the leak would be one convenient argument away in
 * every call site forever. Taking no arguments means there is nothing to vary. The fixed
 * strings live here, once.
 *
 * `request_id` is added at the transport boundary (http/response.ts), not here, so that no
 * domain code holds it and no error constructed in the domain can carry a second
 * identifier by accident.
 */

export type ErrorCode =
  | 'invalid_argument'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'failed_precondition'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'internal'
  | 'not_implemented'
  | 'unavailable'
  | 'timeout';

/**
 * A machine-readable detail. Names the offending request field and a stable token.
 * NEVER the offending value — error-envelope.schema.json is explicit about this, and a
 * rejected value echoed back into a log is a copy of business data in a store with
 * different access rules.
 */
export type ErrorDetail = {
  readonly field: string;
  readonly issue: string;
};

export type CoreError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
};

/**
 * HTTP status per API_STANDARD.md §8. `rate_limited` and `quota_exceeded` share 429 and
 * are deliberately different codes: one means slow down, the other means upgrade or stop.
 */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  invalid_argument: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  failed_precondition: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  internal: 500,
  not_implemented: 501,
  unavailable: 503,
  timeout: 504,
};

/**
 * The fixed message strings. One per condition, invariant with respect to the data
 * involved. API_STANDARD.md §8: "message is for a developer. It never contains business
 * data, another tenant's identifiers, a stack trace, a query, or internal structure."
 */
const MESSAGE_NOT_FOUND = 'The requested resource does not exist.';
const MESSAGE_FORBIDDEN = 'The principal is not permitted to perform this operation.';
const MESSAGE_UNAUTHENTICATED = 'Authentication is required.';
const MESSAGE_INVALID_ARGUMENT = 'The request is not valid.';
const MESSAGE_FAILED_PRECONDITION = 'The resource is not in a state that permits this operation.';
const MESSAGE_CONFLICT = 'The request conflicts with the current state.';
const MESSAGE_INTERNAL = 'The request could not be completed.';
const MESSAGE_NOT_IMPLEMENTED = 'This operation is not available.';
const MESSAGE_QUOTA_EXCEEDED = 'A quota for this organization has been reached.';
const MESSAGE_RATE_LIMITED = 'Too many requests.';
const MESSAGE_UNAVAILABLE = 'A dependency is unavailable.';
const MESSAGE_TIMEOUT = 'The operation did not complete in time.';

/**
 * NO ARGUMENTS, DELIBERATELY. Every `not_found` in Dudo is this exact value.
 *
 * This is the single answer for: a resource in another tenant, a resource that never
 * existed, a malformed-but-schema-valid identifier that resolves to nothing, and a
 * Business identifier belonging to another Organization. A caller cannot tell them apart
 * because there is nothing here to tell apart.
 */
export function notFound(): CoreError {
  return { code: 'not_found', message: MESSAGE_NOT_FOUND };
}

/**
 * NO ARGUMENTS, DELIBERATELY. `forbidden` never names what was refused.
 *
 * Where an Action returns `forbidden` for a record inside the caller's own tenant but
 * outside its authorized business set, the response must disclose nothing about the
 * record — not its Business, not a field, not a name. Taking no arguments is how that is
 * guaranteed rather than remembered.
 */
export function forbidden(): CoreError {
  return { code: 'forbidden', message: MESSAGE_FORBIDDEN };
}

export function unauthenticated(): CoreError {
  return { code: 'unauthenticated', message: MESSAGE_UNAUTHENTICATED };
}

/**
 * The one error constructor that carries structure, because a client cannot correct a
 * request it is not told the shape of. Details name the FIELD and a stable ISSUE TOKEN.
 * The rejected value is never included; `detail()` has no parameter for one.
 */
export function invalidArgument(details: readonly ErrorDetail[]): CoreError {
  return { code: 'invalid_argument', message: MESSAGE_INVALID_ARGUMENT, details };
}

export function detail(field: string, issue: string): ErrorDetail {
  return { field, issue };
}

export function failedPrecondition(): CoreError {
  return { code: 'failed_precondition', message: MESSAGE_FAILED_PRECONDITION };
}

export function conflict(): CoreError {
  return { code: 'conflict', message: MESSAGE_CONFLICT };
}

export function internal(): CoreError {
  return { code: 'internal', message: MESSAGE_INTERNAL };
}

export function notImplemented(): CoreError {
  return { code: 'not_implemented', message: MESSAGE_NOT_IMPLEMENTED };
}

export function quotaExceeded(): CoreError {
  return { code: 'quota_exceeded', message: MESSAGE_QUOTA_EXCEEDED };
}

export function rateLimited(): CoreError {
  return { code: 'rate_limited', message: MESSAGE_RATE_LIMITED };
}

export function unavailable(): CoreError {
  return { code: 'unavailable', message: MESSAGE_UNAVAILABLE };
}

export function timeout(): CoreError {
  return { code: 'timeout', message: MESSAGE_TIMEOUT };
}
