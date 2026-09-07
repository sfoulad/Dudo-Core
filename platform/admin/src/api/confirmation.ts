/**
 * Confirmations — `confirmation-v1`, accepted.
 *
 * ===========================================================================
 * WHAT MAKES THIS A CONFIRMATION RATHER THAN A DIALOG BOX
 * ===========================================================================
 *
 * Three properties, and losing any one of them turns the mechanism into
 * theatre:
 *
 *   1. THE STATEMENT IS SERVER-AUTHORED AND RENDERS VERBATIM. Core composes the
 *      sentence the human approves. "The party being constrained does not author
 *      the statement of the constraint, and a client composing its own 'are you
 *      sure?' text could display one operation while submitting another." Core
 *      CANNOT verify the client displayed it — that is CF-2, an unclosable gap —
 *      so honouring it is a client obligation, not an enforced rule.
 *   2. THE TOKEN IS ECHOED, NOT REMEMBERED. `confirmation_id` goes back exactly
 *      as issued. It is not the binding and carries no authority alone: the
 *      stored row is keyed by an HMAC over principal, session, action and
 *      parameters, so a leaked id "is useless to anyone but the session that
 *      obtained it".
 *   3. RE-AUTHENTICATION IS THE PRESENCE HALF. The operator's OWN password,
 *      through the same KDF as sign-in, salted with the OPERATOR'S OWN
 *      normalised identifier. "AN AI PRINCIPAL CANNOT PRODUCE THIS FIELD, which
 *      is what makes D15's 'confirmation is collected by the platform from the
 *      human' a property of the mechanism rather than a rule someone must
 *      implement."
 *
 * ===========================================================================
 * THE PARAMETERS ARE THE BINDING, AND THEY ARE DERIVED ONCE
 * ===========================================================================
 *
 * On submission the parameters are defined as **the request body minus the three
 * confirmation fields, UNION the route's declared path parameters.** Nothing
 * else removed, nothing else added.
 *
 * THE UNION CLAUSE IS WHY REVOKE IS SAFE AT ALL. `revokeOperatorInput` carries
 * only the three confirmation fields, so body-minus-three is the EMPTY OBJECT —
 * and under the earlier wording the target lived in the path and was in no
 * binding, meaning a confirmation minted to revoke operator A could be spent on
 * operator B. That was caught by a load-time guard, not by review.
 *
 * HOW A CLIENT KNOWS THE DECLARED PATH PARAMETERS: **the path template is the
 * declaration.** The brace-delimited segments of the route's path are exactly
 * the declared names. "A client cannot issue the request without the template
 * and the values it substituted, so it derives the names from the same string it
 * used to build the URL, and the server derives them from that same template in
 * its route table. One source, two readers."
 *
 * THREE MECHANICAL RULES, without which two implementations satisfy the prose
 * and still produce different bytes: the bound value is the **DECODED** segment,
 * never percent-encoded; it is always a **JSON STRING**, never coerced, so a
 * numeric-looking segment binds as `"42"`; and **ORDER IS IRRELEVANT** because
 * the canonical serialisation sorts keys.
 *
 * THIS CLIENT DOES NOT CANONICALLY SERIALISE ANYTHING, and that is deliberate
 * rather than an omission. Sorted keys / no insignificant whitespace / UTF-8 /
 * NFC is **Core's hashing rule**, applied on both sides — which is exactly why
 * the contract says order is irrelevant. The client's obligation is that the
 * parameters **object** at challenge time equals the one implied at submission.
 * `buildConfirmedRequest` below guarantees that **by construction**: both come
 * from one call, so there is no second site to drift.
 */

import { ApiError, toApiError } from './errors';

/** The three names reserved platform-wide. Nothing else may use them. */
export const RESERVED_CONFIRMATION_FIELDS = [
  'confirmation_id',
  'reauth_identifier',
  'reauth_derived_value',
] as const;

export const PLATFORM_CONFIRMATIONS_PATH = '/api/v1/platform/confirmations';

/**
 * The locale this console requests: **none.**
 *
 * `locale` is optional and absent means `en`. THE FIELD IS NEVER SENT — there is
 * no setting, no browser-language sniff and no code path that could ask for
 * another language, so Core cannot return one.
 *
 * WHY THAT IS DELIBERATE RATHER THAN UNFINISHED: the statement catalog's
 * non-English text has never been reviewed by a speaker of the language, and a
 * human is being asked to APPROVE this sentence. `confirmation-v1` records
 * English-only as "the largest unresolved question in this contract — 'states
 * exactly what will happen' is not satisfied by text the human cannot read, and
 * Dudo's market is Bahrain." Shipping an unreviewed sentence for approval is the
 * worse of the two failures; not offering a language is visible, and a wrong
 * translation of a destructive action is not.
 */
export const EXPECTED_STATEMENT_LOCALE = 'en';

export interface ConfirmationChallenge {
  readonly confirmation_id: string;
  /** SERVER-AUTHORED. Rendered verbatim, never paraphrased or reconstructed. */
  readonly statement: string;
  /** The locale actually used — not always the one requested. */
  readonly statement_locale: string;
  /** RFC 3339 UTC. Five minutes from issue. */
  readonly expires_at: string;
}

class ConfirmationShapeError extends Error {}

function requireString(
  source: Record<string, unknown>,
  field: string,
  what: string,
): string {
  const value = source[field];
  if (typeof value !== 'string' || value === '') {
    throw new ConfirmationShapeError(`${what} is missing the string field "${field}".`);
  }
  return value;
}

export function parseConfirmationChallenge(payload: unknown): ConfirmationChallenge {
  const what = 'The confirmation challenge';
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ConfirmationShapeError(`${what} was not a JSON object.`);
  }
  const body = payload as Record<string, unknown>;
  /*
   * ALL FOUR ARE REQUIRED, INCLUDING `statement_locale`. It is "the half of
   * 0027's fallback rule that does the work: an unsupported locale falls back to
   * English AND SAYS SO. A silent fallback would show a user text they cannot
   * read while the client believed it had been localised." A response missing it
   * is refused rather than assumed to be English.
   */
  return {
    confirmation_id: requireString(body, 'confirmation_id', what),
    statement: requireString(body, 'statement', what),
    statement_locale: requireString(body, 'statement_locale', what),
    expires_at: requireString(body, 'expires_at', what),
  };
}

/**
 * Whether the challenge may be presented to a human for approval.
 *
 * A STATEMENT IN AN UNEXPECTED LANGUAGE IS NOT APPROVABLE, and the flow stops
 * rather than offering the control. This console never requests a non-English
 * locale, so a non-`en` answer means Core returned something nobody asked for —
 * a defect to report, not a presentation problem for an operator to click
 * through.
 */
export function isPresentableStatement(challenge: ConfirmationChallenge): boolean {
  return challenge.statement_locale === EXPECTED_STATEMENT_LOCALE;
}

/* -------------------------------------------------------------------------
   The parameters, and the request built from them — one source
   ------------------------------------------------------------------------- */

/** A parameter value is always a JSON string. Never coerced, never a number. */
export type ConfirmationParameters = Readonly<Record<string, string>>;

/**
 * Extracts the declared path-parameter names from a route template.
 *
 * `/operators/{principal_id}/revoke` → `['principal_id']`. THE TEMPLATE IS THE
 * DECLARATION — there is no separate list on either side to drift.
 */
export function declaredPathParameters(pathTemplate: string): readonly string[] {
  return [...pathTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '');
}

export interface ConfirmedRequest {
  /** The URL path, with values substituted and percent-encoded. */
  readonly path: string;
  /** What the challenge binds: body-minus-three UNION path parameters. */
  readonly parameters: ConfirmationParameters;
  /** The body to send at submission, WITHOUT the three confirmation fields. */
  readonly bodyWithoutConfirmation: Readonly<Record<string, string>>;
}

/**
 * Builds the path, the bound parameters and the submission body TOGETHER.
 *
 * ===========================================================================
 * ONE CALL, SO THE TWO STEPS CANNOT DISAGREE
 * ===========================================================================
 *
 * The challenge's `parameters` and the submission's body are computed here, from
 * the same inputs, at the same moment. Building them at two call sites and
 * trusting them to match is the defect this shape removes — the binding fails
 * closed, so a mismatch is a `forbidden` an operator cannot diagnose.
 *
 * THE VALUE BOUND FOR A PATH PARAMETER IS THE DECODED SEGMENT. The URL carries
 * the percent-encoded form; the binding carries the raw one. Binding the encoded
 * form would make `a b` and `a%20b` different parameter sets for one request.
 */
export function buildConfirmedRequest(input: {
  readonly pathTemplate: string;
  readonly pathValues: Readonly<Record<string, string>>;
  readonly bodyFields: Readonly<Record<string, string>>;
}): ConfirmedRequest {
  const declared = declaredPathParameters(input.pathTemplate);

  for (const name of declared) {
    if (!(name in input.pathValues)) {
      throw new ConfirmationShapeError(
        `The path template declares "{${name}}" and no value was supplied for it.`,
      );
    }
  }
  for (const name of Object.keys(input.pathValues)) {
    if (!declared.includes(name)) {
      throw new ConfirmationShapeError(
        `"${name}" was supplied as a path value but the template does not declare it.`,
      );
    }
  }

  /*
   * THE THREE RESERVED NAMES MAY APPEAR IN NEITHER HALF, and path-parameter
   * names must be disjoint from body field names. "A union with a collision is a
   * precedence rule, and a precedence rule is a place for a caller to shadow a
   * value a reviewer assumed was authoritative." Checked here rather than
   * trusted, because this is the function that performs the union.
   */
  for (const name of [...declared, ...Object.keys(input.bodyFields)]) {
    if ((RESERVED_CONFIRMATION_FIELDS as readonly string[]).includes(name)) {
      throw new ConfirmationShapeError(
        `"${name}" is a reserved confirmation field and cannot be a bound parameter.`,
      );
    }
  }
  for (const name of declared) {
    if (name in input.bodyFields) {
      throw new ConfirmationShapeError(
        `"${name}" is both a path parameter and a body field, which is a precedence rule.`,
      );
    }
  }

  const parameters: Record<string, string> = { ...input.bodyFields };
  let path = input.pathTemplate;
  for (const name of declared) {
    const value = input.pathValues[name] ?? '';
    // DECODED in the binding, ENCODED in the URL. Same value, two forms.
    parameters[name] = value;
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }

  return {
    path,
    parameters: Object.freeze(parameters),
    bodyWithoutConfirmation: Object.freeze({ ...input.bodyFields }),
  };
}

/**
 * The three fields merged into the gated operation's body at submission.
 *
 * MERGED, NOT WRAPPED. "They are not a header and not a wrapper envelope: the
 * parameters are part of the binding, so the confirmation and the parameters it
 * authorises must arrive in one object validated by one schema."
 */
export function withConfirmation(
  bodyWithoutConfirmation: Readonly<Record<string, string>>,
  confirmation: {
    readonly confirmationId: string;
    readonly reauthIdentifier: string;
    readonly reauthDerivedValue: string;
  },
): Record<string, string> {
  return {
    ...bodyWithoutConfirmation,
    // ECHOED EXACTLY AS ISSUED — not normalised, trimmed, re-cased or rebuilt.
    confirmation_id: confirmation.confirmationId,
    reauth_identifier: confirmation.reauthIdentifier,
    reauth_derived_value: confirmation.reauthDerivedValue,
  };
}

export function asConfirmationError(thrown: unknown): ApiError {
  if (thrown instanceof ConfirmationShapeError) {
    return new ApiError({
      code: 'internal',
      message: `${thrown.message} The confirmation was not requested.`,
    });
  }
  return toApiError(thrown);
}
