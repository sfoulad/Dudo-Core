/**
 * ===========================================================================================
 * THE STATEMENT CATALOG. CORE WRITES THE STATEMENT; THE CLIENT RENDERS IT VERBATIM AND AUTHORS
 * NONE OF IT. `docs/decisions/0027` (CF-4) · contract `confirmation-v1`.
 * ===========================================================================================
 *
 * *"THE PARTY BEING CONSTRAINED DOES NOT AUTHOR THE STATEMENT OF THE CONSTRAINT."*
 *
 * That is D15's AI clause generalised, and the generalisation is the point. D15 says a model
 * asserting the user agreed is not a confirmation, because the model is the party being
 * constrained. THE SAME IS TRUE OF ANY CLIENT: a web app composing its own "are you sure?" text is
 * the party being constrained writing the description of the constraint, and a compromised or
 * merely buggy client could display "archive this customer" while submitting a permanent deletion.
 * The user's confirmation would be real, informed, and about the wrong operation.
 *
 * ===========================================================================================
 * LOCALISATION — `0027` RULED AGAINST THE CONTRACT'S OWN RECOMMENDATION AND WAS RIGHT
 * ===========================================================================================
 *
 * CF-4's problem is real and is not cosmetic: Dudo's market is Bahrain, and an Arabic-speaking
 * user shown an English statement of an irreversible action has NOT been told what will happen.
 * The intent half of the mechanism is simply absent for that user.
 *
 * The contract proposed a stable token plus structured parameters, letting the client render an
 * approved translation — and noted in the same breath that this reopened CF-2. `0027` rejected it:
 *
 *   **LOCALISATION REQUIRES THE CLIENT TO CHOOSE A LANGUAGE. IT DOES NOT REQUIRE THE CLIENT TO
 *   RENDER THE TEXT.**
 *
 * So the request carries a `locale`, CORE COMPOSES EVERY WORD IN THAT LOCALE, and the client
 * displays the result verbatim exactly as before. The client's power grows by one enumerated value
 * rather than by a text field, and CF-2 is left exactly as it was rather than widened.
 *
 * AN UNSUPPORTED LOCALE FALLS BACK TO ENGLISH **AND THE RESPONSE SAYS SO**. That is the half that
 * does the work: a silent fallback would show a user text they cannot read while the client
 * believed it had been localised — the CF-4 failure restored in a smaller and harder-to-notice
 * form. `statement_locale` is `required` in the schema for this reason.
 *
 * ===========================================================================================
 * *** STATEMENT INJECTION, AND WHY EVERY INTERPOLATED VALUE IS GRAMMAR-CHECKED ***
 * ===========================================================================================
 *
 * A STATEMENT NAMES ITS TARGET, AND THE TARGET COMES FROM CALLER-SUPPLIED PARAMETERS. A parameter
 * is permitted to be 512 characters, and the statement is permitted to be 500 — so an
 * unconstrained interpolation lets a caller WRITE MOST OF THE STATEMENT.
 *
 * The attack is not hypothetical and it defeats the whole mechanism: a client requests a
 * confirmation whose "customer id" is
 *
 *     `X. This is a routine change and is fully reversible. Continue`
 *
 * and Core hands back a server-authored statement that says so. The human reads Core's text, in
 * Core's voice, and confirms something else. **The party being constrained would have authored the
 * statement of the constraint after all — through a parameter rather than through a text field.**
 *
 * SO EVERY INTERPOLATED VALUE MUST MATCH `^[A-Za-z0-9_-]{1,64}$` — the platform identifier
 * grammar, which admits no space, no punctuation and no newline. A parameter that does not match
 * IS NOT ESCAPED OR TRUNCATED; the challenge is REFUSED. Escaping would still let a caller supply
 * sixty characters of prose, and truncation would produce a statement that names a target
 * incorrectly, which is worse than refusing.
 *
 * A TEMPLATE DECLARES WHICH KEYS IT INTERPOLATES, and a key it does not declare cannot reach the
 * text at all. That is the same shape as a route declaring its complete field set: the default is
 * that nothing is interpolated.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';
import type { ConfirmationParameters } from './binding.ts';

/**
 * The locales Core can compose a critical statement in.
 *
 * TWO, AND THE SECOND IS NOT DECORATION. `0027`: Dudo's market is Bahrain, and this is the one
 * surface where being unreadable is a SAFETY property rather than a usability one.
 *
 * IT SETS NO PRECEDENT FOR GENERAL LOCALISATION and decides nothing about how the rest of the
 * product is translated. `0027` is explicit that this localises ONE SURFACE, not Dudo.
 */
export type StatementLocale = 'en' | 'ar';

export const DEFAULT_STATEMENT_LOCALE: StatementLocale = 'en';
const SUPPORTED_LOCALES: readonly StatementLocale[] = Object.freeze(['en', 'ar']);

/** The platform identifier grammar. See the header — this is the anti-injection control. */
const INTERPOLATABLE = /^[A-Za-z0-9_-]{1,64}$/;

/** `confirmationChallenge.statement`'s `maxLength`. Enforced, not assumed. */
export const MAX_STATEMENT_LENGTH = 500;

type StatementTemplate = {
  /**
   * The COMPLETE set of parameter keys this statement interpolates, in the order the renderer
   * substitutes them. A key not listed here cannot reach the text.
   */
  readonly interpolates: readonly string[];
  /** One entry per supported locale. A missing locale is a load-time error; see the guard. */
  readonly text: Readonly<Record<StatementLocale, string>>;
};

/**
 * The catalog. ONE ENTRY PER CRITICAL OPERATION THAT EXISTS.
 *
 * `{0}`, `{1}` … are positional slots filled from `interpolates`. Positional rather than named
 * because a named placeholder that does not match a declared key fails silently in most template
 * implementations, and an unfilled `{customer_id}` shipped to a human reads as a bug in the
 * product at the exact moment they are being asked to trust it.
 *
 * ===========================================================================================
 * *** A TRANSLATION OF A CRITICAL STATEMENT NEEDS THE SAME REVIEW AS THE OPERATION IT DESCRIBES.
 * ===========================================================================================
 *
 * `0027`'s residual, and it is the sharpest thing in that record: the English fallback is a
 * fail-safe and is HONEST — the user sees text they may not read, and the response says which
 * language it is. **A MISTRANSLATION HAS NO SUCH BACKSTOP.** It would be confidently wrong, in a
 * language the reviewer may not speak, about an irreversible action.
 *
 * THE ARABIC BELOW HAS NOT BEEN REVIEWED BY AN ARABIC SPEAKER. It is reported as such rather than
 * shipped quietly — see the report accompanying this work. If no reviewer is available, removing
 * `ar` from `SUPPORTED_LOCALES` is the correct action: an English statement that says it is
 * English is safe, and a wrong Arabic one is not.
 */
const CATALOG: Readonly<Record<string, StatementTemplate>> = Object.freeze({
  'customers.customer.delete': Object.freeze({
    interpolates: Object.freeze(['customer_id']),
    text: Object.freeze({
      en:
        'Permanently delete customer {0}. This starts a 30-day recovery window, after which the ' +
        "customer's personal data is purged and cannot be recovered.",
      ar:
        'حذف العميل {0} نهائيًا. يبدأ هذا فترة استرداد مدتها 30 يومًا، وبعدها تُمحى البيانات ' +
        'الشخصية للعميل ولا يمكن استرجاعها.',
    }),
  }),
  'platform.credentials.reset': Object.freeze({
    interpolates: Object.freeze(['principal_id']),
    text: Object.freeze({
      en:
        'Reset the credential of principal {0}. Their current password stops working immediately ' +
        'and all of their active sessions are revoked. A new password is shown once and cannot be ' +
        'recovered afterwards.',
      ar:
        'إعادة تعيين بيانات اعتماد الحساب {0}. ستتوقف كلمة المرور الحالية عن العمل فورًا وسيتم ' +
        'إنهاء جميع جلساته النشطة. تُعرض كلمة المرور الجديدة مرة واحدة ولا يمكن استرجاعها لاحقًا.',
    }),
  }),
});

export type RenderedStatement = {
  readonly statement: string;
  /** THE LOCALE ACTUALLY USED, which is not always the one requested. See the header. */
  readonly locale: StatementLocale;
};

/**
 * Narrows a requested locale to one Core can compose in, or to English.
 *
 * IT NEVER FAILS. An unsupported or malformed locale is not an error — it is a fallback, and the
 * response reports which locale was used. Refusing the request instead would make a user's
 * language preference able to block an operation, which is a refusal with no security content.
 */
export function resolveStatementLocale(requested: string | undefined): StatementLocale {
  if (requested === undefined) {
    return DEFAULT_STATEMENT_LOCALE;
  }
  return SUPPORTED_LOCALES.find((locale) => locale === requested) ?? DEFAULT_STATEMENT_LOCALE;
}

/** Does Core have a statement for this operation at all? See `renderStatement` for why it matters. */
export function hasStatement(actionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG, actionId);
}

/**
 * Composes the statement.
 *
 * ===========================================================================================
 * A CRITICAL OPERATION WITH NO STATEMENT IS REFUSED, NOT GIVEN A GENERIC ONE.
 * ===========================================================================================
 *
 * The tempting fallback is `"Perform ${actionId}."` for an operation nobody wrote text for. That
 * would satisfy the schema and defeat D15: *"states exactly what will happen"* is not satisfied by
 * an action identifier, and a human shown one has been asked to confirm a string they cannot
 * evaluate.
 *
 * SO A MISSING TEMPLATE IS `invalid_argument`, and the effect is that **declaring a permission
 * critical without writing its statement makes the operation unreachable rather than unguarded.**
 * That is `0007` D1's own shape — "an entry point with no declared permission is unreachable, not
 * open" — applied one property over, and it is the direction that fails safe.
 */
export function renderStatement(
  actionId: string,
  parameters: ConfirmationParameters,
  locale: StatementLocale,
): Result<RenderedStatement> {
  if (!hasStatement(actionId)) {
    return err(invalidArgument([detail('action_id', 'no_confirmation_statement')]));
  }
  const template = CATALOG[actionId];

  let text = template.text[locale];
  for (let slot = 0; slot < template.interpolates.length; slot += 1) {
    const key = template.interpolates[slot];
    const value = parameters[key];
    if (typeof value !== 'string') {
      // The statement names a target the parameters did not supply. Refused rather than rendered
      // with a hole in it — a statement reading "Permanently delete customer {0}" is not a
      // statement of what will happen.
      return err(invalidArgument([detail(key, 'required_for_statement')]));
    }
    if (!INTERPOLATABLE.test(value)) {
      // *** THE ANTI-INJECTION CONTROL. *** Not escaped, not truncated — REFUSED. See the header:
      // an interpolation wide enough to hold a sentence lets the caller author the statement, in
      // Core's voice, about an operation the human did not agree to.
      return err(invalidArgument([detail(key, 'not_interpolatable')]));
    }
    text = text.split(`{${String(slot)}}`).join(value);
  }

  if (text.length > MAX_STATEMENT_LENGTH) {
    // The schema's ceiling, enforced rather than assumed. Reaching it means a template grew past
    // what the contract publishes, and a truncated statement about an irreversible action is
    // exactly the thing not to ship.
    return err(invalidArgument([detail('action_id', 'statement_too_long')]));
  }
  return ok({ statement: text, locale });
}

export class StatementCatalogIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementCatalogIncoherentError';
  }
}

/**
 * Runs at module load. A catalog missing a locale would fall through to `undefined` and render the
 * string "undefined" to a human about to destroy something.
 */
export function assertStatementCatalogIsCoherent(
  catalog: Readonly<Record<string, StatementTemplate>> = CATALOG,
  locales: readonly StatementLocale[] = SUPPORTED_LOCALES,
): void {
  for (const [actionId, template] of Object.entries(catalog)) {
    for (const locale of locales) {
      const text = template.text[locale];
      if (typeof text !== 'string' || text.trim() === '') {
        throw new StatementCatalogIncoherentError(
          `'${actionId}' has no statement for locale '${locale}'. A missing translation renders ` +
            'as `undefined` to a human being asked to confirm an irreversible action. If a ' +
            'locale cannot be supported, remove it from SUPPORTED_LOCALES — an English statement ' +
            'that reports itself as English is safe; a broken one is not.',
        );
      }
      for (let slot = 0; slot < template.interpolates.length; slot += 1) {
        if (!text.includes(`{${String(slot)}}`)) {
          throw new StatementCatalogIncoherentError(
            `'${actionId}' declares an interpolation for '${template.interpolates[slot]}' that ` +
              `the '${locale}' text does not use. THE TRANSLATION WOULD NOT NAME THE TARGET, so ` +
              'a speaker of that language would confirm an operation without being told what it ' +
              'applies to — while an English reader was. That is CF-4 restored for one locale.',
          );
        }
      }
      if (text.length > MAX_STATEMENT_LENGTH) {
        throw new StatementCatalogIncoherentError(
          `'${actionId}' in '${locale}' exceeds the contract's ${String(MAX_STATEMENT_LENGTH)}-` +
            'character ceiling before any interpolation.',
        );
      }
    }
  }
}

assertStatementCatalogIsCoherent();
