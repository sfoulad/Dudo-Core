/**
 * The error envelope, client side.
 *
 * SOURCE: `packages/contracts/common/error-envelope.schema.json`, and the
 * shapes below are now CONSUMED from its generated module rather than restated
 * here (ADR 0037 requirement 2).
 *
 * Every failure a screen handles arrives as an `ApiError`, so there is one
 * place that decides whether a retry is worth offering.
 *
 * ===========================================================================
 * ⚠ THIS FILE HELD TWO DUPLICATES AND BOTH OF THEM DIVERGED. THE DUPLICATION
 * WAS THE LESSER PROBLEM.
 * ===========================================================================
 *
 * ```
 * generated ErrorCode   TWELVE values, including `not_implemented`
 * this file's           ELEVEN — `not_implemented` absent
 *
 * generated envelope    a DISCRIMINATED UNION on whether retry_after_seconds
 *                       is possible at all
 * this file's           a flat interface with retry_after_seconds OPTIONAL
 * ```
 *
 * **The second is a type that is WRONG rather than merely missing.** A flat
 * optional permits `retry_after_seconds` on `not_found` — which the contract
 * forbids, and which this client could therefore have written and read without
 * anything objecting.
 *
 * **The first is quieter and worse in its own way.** `not_implemented` is a
 * code this client's type said could not arrive. Nothing crashed — the title
 * lookup falls through to a generic sentence — so **nothing would ever have
 * reported it.** A wrong type that degrades gracefully is a wrong type nobody
 * finds.
 *
 * Neither was found by review. Both were found by counting declarations
 * against the generated set while doing an unrelated swap.
 */

import type {
  ErrorCode,
  ErrorDetails,
  ErrorEnvelope,
} from '@dudo/contracts/common/error-envelope';

export type { ErrorCode, ErrorEnvelope } from '@dudo/contracts/common/error-envelope';

/**
 * ⚠ `ErrorDetail` IS SINGULAR HERE AND THE CONTRACT EMITS THE ARRAY.
 *
 * The generated module has `ErrorDetails = ReadonlyArray<{field, issue}>` and
 * no name for one element. This client passes single details around, so the
 * element type is derived from the array rather than restated — **the same
 * shape by construction, and it moves if the contract's does.**
 */
export type ErrorDetail = ErrorDetails[number];

/**
 * The codes, as a runtime list, BOUND TO THE CONTRACT IN BOTH DIRECTIONS.
 *
 * The type is the contract's now, so this constant is the only thing that could
 * drift — and it did: it was eleven values against the contract's twelve.
 *
 *   `satisfies`   every listed code is a real contract code
 *   `Exclude<>`   every contract code is listed — **the direction that was
 *                 already violated**, and the one that stays violated silently
 *                 because an unlisted code simply never appears in a loop.
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
  'not_implemented',
  'unavailable',
  'timeout',
] as const;
ERROR_CODES satisfies readonly ErrorCode[];
type MissingErrorCode = Exclude<ErrorCode, (typeof ERROR_CODES)[number]>;
const ERROR_CODES_ARE_EXHAUSTIVE: MissingErrorCode extends never ? true : never = true;
void ERROR_CODES_ARE_EXHAUSTIVE;

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

  /**
   * ⚠ IT WAS `new ApiError(envelope.error)` — A SPREAD OF THE WHOLE WIRE
   * OBJECT INTO THE CONSTRUCTOR, AND IT STOPPED COMPILING FOR THE RIGHT REASON.
   *
   * The generated envelope is a DISCRIMINATED UNION: `retry_after_seconds`
   * exists on the `rate_limited`/`quota_exceeded` arm and **does not exist on
   * the other**. The flat interface this file used to declare made it optional
   * everywhere, which permitted it on `not_found` — a shape the contract
   * forbids and this client could have read without anything objecting.
   *
   * So the fields are now taken **one at a time, by name**, with the property
   * narrowed rather than assumed. That also removes the second-order problem
   * the spread had: **whatever the server sent, the constructor received** —
   * `platform/admin` was hardened the same way for the same reason.
   *
   * `details` is copied because the contract emits `ReadonlyArray` and this
   * class exposes a mutable array to callers.
   */
  static fromEnvelope(envelope: ErrorEnvelope): ApiError {
    const body = envelope.error;
    return new ApiError({
      code: body.code,
      message: body.message,
      request_id: body.request_id,
      details: body.details === undefined ? undefined : [...body.details],
      retry_after_seconds:
        'retry_after_seconds' in body ? (body.retry_after_seconds ?? null) : null,
    });
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

/**
 * ⚠ THIS WORDING IS THE CUSTOMER DIRECTORY'S, AND SAYING SO IS THE POINT.
 *
 * `not_found` reads *"This customer is not here"* and `failed_precondition`
 * talks about archived customers. **Both are false on any other surface**, and
 * for a while this was the application's ONLY error vocabulary — which is how a
 * settings screen reaching for `ErrorBlock` would have told a reader about a
 * customer they were not looking at.
 *
 * `components/settings/SettingsState.tsx` holds the settings equivalent, and
 * the split is deliberate: **one map serving both surfaces would have to be
 * vague enough to be true of neither**, and a vague error message is the one
 * nobody can act on. The CLASSIFICATION — `ErrorCode`, `ApiError`,
 * `isRetryable` — is shared and lives here; only the wording forks.
 *
 * **A third surface needs a third map, not an edit to this one.**
 */
const CUSTOMER_DIRECTORY_TITLES: Record<ErrorCode, string> = {
  invalid_argument: 'Check the details you entered',
  unauthenticated: 'You need to sign in',
  forbidden: 'You do not have access to this',
  /*
   * `not_implemented` ARRIVED FROM THE CONTRACT, NOT FROM A PRODUCT DECISION.
   * This map was `Record<ErrorCode, string>` over an ELEVEN-value local union;
   * adopting the generated twelve-value one made the compiler name the missing
   * arm. It had been a code this client's type said could not arrive.
   */
  not_implemented: 'That is not available',
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
  return CUSTOMER_DIRECTORY_TITLES[error.code] ?? 'Something went wrong';
}

const BODIES: Partial<Record<ErrorCode, string>> = {
  unauthenticated: 'Your session is not active. Sign in and try again.',
  forbidden:
    'Your permissions do not cover this customer. Ask an owner of this Organization for access.',
  not_found: 'It may have been moved, or the link may be wrong.',
  /*
   * THIS WORDING DESCRIBED A MECHANISM DUDO DOES NOT HAVE, AND IT WAS THE FIRST
   * THING A REAL USER SAW. Recorded rather than quietly replaced, because the
   * way it was wrong is the useful part.
   *
   * It read: "The record has moved on since this page was loaded. Reload it to
   * see where it stands now." That is a stale-record conflict — and
   * `customer-directory-v1` carries NO optimistic-concurrency token at all
   * ("LAST WRITE WINS", open question CD-3), so it is a condition this platform
   * cannot detect and therefore cannot be reporting.
   *
   * What it was actually shown for was a session with no Organization selected,
   * on every request, for every principal — where "reload" cannot help and
   * sends the reader in a circle. That state is now intercepted before it
   * reaches any wording: see `lib/use-organization.ts`.
   *
   * WHAT IS LEFT IS THE CUSTOMER STATE MACHINE, and that is what this now
   * describes. Core renders both with the same constant message and no details
   * (`kernel/errors.ts`), so this text can never be more specific than the
   * error is — but it can at least be about the right thing, and a message
   * confidently describing the wrong cause is worse than a general one.
   */
  failed_precondition:
    'This record is not in a state that allows it — an archived customer cannot be edited, and ' +
    'one awaiting deletion cannot be archived. Open it again to see where it stands.',
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
