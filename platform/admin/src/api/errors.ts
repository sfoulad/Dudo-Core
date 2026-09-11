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
  /**
   * ===========================================================================
   * SET ONLY WHEN THIS CLIENT CONSTRUCTED THE ERROR ITSELF
   * ===========================================================================
   *
   * `errorBodyKey` deliberately returns `null` for `invalid_argument` and
   * `conflict`, so the screen shows Core's own `message` — **because Core knows
   * which field and this console does not.**
   *
   * **THAT REASONING IS FALSE FOR AN ERROR THIS CLIENT BUILT**, and there is
   * one: the identity save refuses an empty change set locally rather than
   * spending five of a customer's daily writes on a request Core would refuse.
   * Its message never came from Core, so falling through to it fell through to
   * **an English sentence written here** — on the one code whose whole deferral
   * rule assumes the opposite.
   *
   * Found by asking which of the remaining `.ts` strings can actually reach a
   * screen, rather than assuming the deferral rule covered them.
   *
   * ⚠ **IT IS NEVER READ FROM THE WIRE — AND THE FIRST VERSION OF THIS SENTENCE
   * WAS FALSE.** It said `fromEnvelope` "passes `envelope.error` straight
   * through, so a server cannot select this console's copy… by construction".
   * **Passing it straight through is exactly how a server COULD**, because the
   * type does not police a value that arrived at runtime. See `fromEnvelope`,
   * which now names its fields one at a time, and the assertion that holds it
   * there.
   */
  readonly messageKey: ErrorMessageKey | null;

  constructor(init: {
    code?: ErrorCode;
    message?: string;
    messageKey?: ErrorMessageKey;
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
    this.messageKey = init.messageKey ?? null;
  }

  /**
   * ===========================================================================
   * ⚠ THIS SPREAD THE WHOLE WIRE OBJECT, AND `messageKey` WAS REACHABLE THROUGH
   * IT FOR ABOUT A MINUTE
   * ===========================================================================
   *
   * It read `new ApiError(envelope.error)`. **`ErrorEnvelope` declares no
   * `messageKey`, and the type is not the wire** — a real response is parsed
   * JSON, and TypeScript polices excess properties on object LITERALS, never on
   * a value that arrived at runtime. So a server sending `messageKey` would have
   * had it read straight into the field that decides which sentence this console
   * shows.
   *
   * **I wrote a comment on `messageKey` saying it was `undefined` here "by
   * construction, not by a check somebody has to remember". That sentence was
   * FALSE WHEN I TYPED IT** — `architecture.md` §3b's dismissal that stops the
   * next reader looking, in my own file, and it survived exactly as long as it
   * took to run the check I wrote to confirm it.
   *
   * **The fields are now named one at a time.** A property added to the envelope
   * later does not arrive here by default; somebody has to add it, which is the
   * review surface the spread removed. Same shape as `platformRequest` refusing
   * to forward an undeclared field.
   */
  static fromEnvelope(envelope: ErrorEnvelope): ApiError {
    return new ApiError({
      code: envelope.error.code,
      message: envelope.error.message,
      request_id: envelope.error.request_id,
      details: envelope.error.details,
      retry_after_seconds: envelope.error.retry_after_seconds,
    });
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Normalise anything thrown into an ApiError, so no view sees a raw throw.
 *
 * **THE MESSAGE HERE IS NOT TRANSLATED, AND THAT IS NOT AN OMISSION.** The code
 * is `internal`, `BODY_KEYS` has an entry for `internal`, and `errorBodyKey`
 * therefore never falls through to `message` for this error — so this string
 * **cannot reach a screen.** It exists for `Error.message`, which is what a
 * stack trace and a console log show, and those are read by whoever is
 * debugging rather than by an operator.
 *
 * Stated because the next reader translating this file will find it and wonder.
 */
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

/**
 * ===========================================================================
 * ⚠ THESE RETURNED ENGLISH PROSE UNTIL 2026-09-11, AND THIS IS THE COPY EVERY
 * FAILED REQUEST ON EVERY SCREEN RENDERS
 * ===========================================================================
 *
 * Sixteen operator-facing sentences lived here. **The console's copy-coverage
 * pin scans `.tsx` files**, so none of them was ever in the population it
 * reports — the same blindness that hid eleven more in `api/audit-window.ts`.
 * A console can be reported as 80% translated while **every error state in it
 * is still English**, which is the state that matters most to an operator who
 * has just been refused.
 *
 * **The functions now return KEYS.** They are called from components, so taking
 * a `t` would have been possible — but `api/**` must not import `lib/i18n`, and
 * the token shape is what `audit-window.ts` already uses, so the two shared
 * modules behave the same way rather than each having its own convention.
 *
 * `ErrorMessageKey` is declared here as a narrow union for the reason given in
 * `audit-window.ts`, and `lib/i18n.tsx` asserts it is a subset of `MessageKey`
 * **at compile time** — a key invented here does not build.
 */
export type ErrorMessageKey =
  | 'error.title.fallback'
  | 'error.title.invalidArgument'
  | 'error.title.unauthenticated'
  | 'error.title.forbidden'
  | 'error.title.notFound'
  | 'error.title.conflict'
  | 'error.title.failedPrecondition'
  | 'error.title.quotaExceeded'
  | 'error.title.rateLimited'
  | 'error.title.internal'
  | 'error.title.unavailable'
  | 'error.title.timeout'
  | 'error.body.unauthenticated'
  | 'error.body.forbidden'
  | 'error.body.notFound'
  | 'error.body.failedPrecondition'
  | 'error.body.rateLimited'
  | 'error.body.rateLimitedFor'
  | 'error.body.unavailable'
  | 'error.body.timeout'
  | 'error.body.internal'
  /* Client-constructed. See `ApiError.messageKey`. */
  | 'error.body.nothingChanged';

/**
 * TOTAL OVER `ErrorCode`, not partial — so **adding a code to `ERROR_CODES`
 * fails the build here** rather than falling through to a generic title. That
 * is the same mechanism `writeIsCertainlyAbsent` relies on one function up, and
 * for the same reason: a new error code arriving unnoticed is a new error code
 * rendered as "Something went wrong".
 */
const TITLE_KEYS: Record<ErrorCode, ErrorMessageKey> = {
  invalid_argument: 'error.title.invalidArgument',
  unauthenticated: 'error.title.unauthenticated',
  forbidden: 'error.title.forbidden',
  not_found: 'error.title.notFound',
  conflict: 'error.title.conflict',
  failed_precondition: 'error.title.failedPrecondition',
  quota_exceeded: 'error.title.quotaExceeded',
  rate_limited: 'error.title.rateLimited',
  internal: 'error.title.internal',
  unavailable: 'error.title.unavailable',
  timeout: 'error.title.timeout',
};

export function errorTitleKey(
  error: Pick<ApiError, 'code'> | null | undefined,
): ErrorMessageKey {
  if (!error) return 'error.title.fallback';
  return TITLE_KEYS[error.code];
}

/**
 * PARTIAL ON PURPOSE, unlike the titles. A code with no entry falls back to the
 * SERVER's `message`, which is written for a developer and is better than a
 * generic sentence when this console has nothing specific to add —
 * `invalid_argument` and `conflict` are exactly that case, where Core knows
 * which field and this console does not.
 */
const BODY_KEYS: Partial<Record<ErrorCode, ErrorMessageKey>> = {
  unauthenticated: 'error.body.unauthenticated',
  /*
   * WRITTEN TO BE TRUE OF ALL FOUR COLLAPSED CONDITIONS. See the header. It does
   * not say the caller lacks a platform_operator row, because Core deliberately
   * does not say so and one of the four conditions would make that claim false.
   */
  forbidden: 'error.body.forbidden',
  not_found: 'error.body.notFound',
  failed_precondition: 'error.body.failedPrecondition',
  rate_limited: 'error.body.rateLimited',
  unavailable: 'error.body.unavailable',
  timeout: 'error.body.timeout',
  internal: 'error.body.internal',
};

/**
 * Wording of last resort, as a key.
 *
 * **`null` MEANS "SHOW THE SERVER'S OWN `message`"** and is a real answer rather
 * than a missing one — see `BODY_KEYS`. The caller renders `error.message` in
 * that case, untranslated, because it came from Core in whatever language Core
 * speaks and inventing a translation for it would be inventing content.
 *
 * **`error.body.rateLimitedFor` carries `{seconds}`**, which the caller fills
 * with `formatSeconds` — so *"about 25 seconds"* gets Arabic's singular, dual
 * and two plural forms from `Intl` rather than from a ternary.
 */
export function errorBodyKey(error: ApiError | null | undefined): ErrorMessageKey | null {
  if (!error) return null;
  /*
   * THE CLIENT'S OWN KEY WINS, and it is checked FIRST rather than last. An
   * error this console built knows its own wording; the code-keyed table is the
   * fallback for errors that arrived from Core. Checking it last would let
   * `BODY_KEYS` shadow it on any code that happens to have an entry.
   */
  if (error.messageKey !== null) return error.messageKey;
  if (error.code === 'rate_limited' && error.retry_after_seconds !== null) {
    return 'error.body.rateLimitedFor';
  }
  return BODY_KEYS[error.code] ?? null;
}
