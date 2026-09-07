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

/**
 * What the operator-action log should name for a challenge on this operation.
 *
 * ===========================================================================================
 * IT IS DECLARED, NOT DERIVED, AND THE AUDIT RECORD NAMES WHAT THE HUMAN WAS SHOWN.
 * ===========================================================================================
 *
 * P4 requires every platform route to write a record, and a challenge record that named nothing
 * would be weak evidence — "an operator requested a confirmation" without saying for what.
 *
 * THE TEMPTING SHORTCUT IS TO GUESS FROM PARAMETER NAMES — treat a `principal_id` key as a
 * principal target, an `organization_id` key as an Organization. That is a convention masquerading
 * as a rule: it works until an operation names its parameter something else, and then the audit
 * row silently records nothing while looking correct.
 *
 * DECLARING IT HERE TIES THE RECORD TO THE STATEMENT. The audit row names the same identifier the
 * statement showed the human, from the same declaration, already grammar-checked by the
 * interpolation control. **What was recorded and what was read are the same value by
 * construction.**
 *
 * ===========================================================================================
 * *** THE CORRESPONDENCE PROPERTY, STATED BECAUSE A REFACTOR WOULD SEPARATE IT WITHOUT NOTICING.
 * ===========================================================================================
 *
 * **THE IDENTIFIER IN THE AUDIT RECORD IS THE IDENTIFIER IN THE TEXT THE HUMAN READ.** Not an
 * equivalent one, not one derived the same way — the same value, from one declaration, substituted
 * into the statement and copied into the record.
 *
 * WHY IT MATTERS: an operator log exists so that someone can later ask *"what did this person
 * agree to?"* If the record's target and the statement's target were computed independently — two
 * lookups, two conventions, two sets of parameter names — they would agree until the day one of
 * them changed, and **the log would then say a human confirmed something about P while the human
 * had been shown Q.** That is worse than no record, because it is a record that will be believed.
 *
 * THE OBVIOUS REFACTOR THAT BREAKS IT is moving audit-target selection out to the caller, where it
 * looks like routing concern rather than statement concern. It is neither: it is the correspondence
 * itself, and it only holds while both halves read this one declaration.
 *
 * IT IS MECHANICALLY ASSERTABLE, AND `statementCatalogEntries` EXISTS SO THAT IT IS. For every
 * entry: render the statement, take the declared audit target, and assert the target's identifier
 * appears verbatim in the rendered text. `assertStatementCatalogIsCoherent` already refuses a
 * target key the statement does not interpolate; the end-to-end form is `qa-agent`'s and the
 * enumerator is what makes it cover the whole catalog rather than the entries somebody remembered.
 */
type StatementAuditTarget = {
  readonly kind: 'organization' | 'principal';
  /** Must be one of `interpolates`; the coherence guard enforces it. */
  readonly key: string;
};

/**
 * ===========================================================================================
 * WHAT A CHALLENGE'S AUDIT RECORD DOES **NOT** SAY, AND THE TRIGGER FOR CHANGING THAT.
 * ===========================================================================================
 *
 * The record carries WHO acted, WHICH object they named, and WHEN. Its `action_id` is the
 * CHALLENGE ROUTE'S OWN frozen identifier — `platform.confirmations.request` — and **not the
 * operation being confirmed.**
 *
 * SO THE LOG DOES NOT SAY *WHICH* CRITICAL OPERATION A CHALLENGE WAS SOUGHT FOR. That is a real
 * gap and it is deliberate. Team Lead ruling, 2026-09-05:
 *
 *   `PlatformOperatorActionRecord.actionId` is documented as *"a Core-owned literal from a frozen
 *   table; there is no path by which a caller supplies this string"*, and **that guarantee is what
 *   makes the column trustworthy and enumerable** — a reviewer can group by it, alert on it, and
 *   know the set is closed. Admitting a bounded caller-supplied value changes the property from
 *   *"a closed set"* to *"a closed set, unless someone passed something"*, and **the second is not
 *   a weaker version of the first, it is a different claim** that every future consumer has to
 *   check for.
 *
 * IT IS NOT AMBIGUOUS TODAY: `core.credential.reset` is the only critical platform operation, so
 * "a challenge concerning principal P" can only have meant one thing.
 *
 * *** THE TRIGGER: WHEN A SECOND CRITICAL PLATFORM OPERATION EXISTS AND DISTINGUISHING THEM IN
 * THE LOG MATTERS, ADD A DISTINCTLY-NAMED COLUMN THEN — never by overloading `action_id`, whose
 * value is its guarantee. *** Written here so the next person meets a decision rather than finds
 * a gap, and so that the cheap-to-do-later, expensive-to-undo direction is the recorded one.
 */

type StatementTemplate = {
  /**
   * The COMPLETE set of parameter keys this statement interpolates, in the order the renderer
   * substitutes them. A key not listed here cannot reach the text.
   */
  readonly interpolates: readonly string[];
  /** One entry per supported locale. A missing locale is a load-time error; see the guard. */
  readonly text: Readonly<Record<StatementLocale, string>>;
  /** What the operator-action log names. `null` for an operation with no single target. */
  readonly auditTarget: StatementAuditTarget | null;
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
  // ===========================================================================================
  // *** KEYED BY THE **OPERATION** IDENTIFIER, NOT THE PERMISSION. `qa-agent`, 2026-09-05. ***
  // ===========================================================================================
  //
  // The first version keyed this `customers.customer.delete`, which is the PERMISSION id from
  // `permission-catalog.yaml`. The pipeline looks a statement up by `action.id`, and the deferred
  // Action is `customers.DeleteCustomer` — so **the challenge would have been refused with
  // `no_confirmation_statement` the day the Action was built**, and the failure would have looked
  // like a missing translation rather than a wrong key.
  //
  // The two identifier spaces are similar enough to confuse and are not interchangeable: an
  // operation id names a thing you can invoke, a permission id names a thing you can hold.
  // `assertConfirmableOperationsAreCoherent` catches this for the PLATFORM class, because those
  // ids are declared in Core — it could not catch it here, because the Action is deferred and its
  // id lives in a contract Core does not read.
  'customers.DeleteCustomer': Object.freeze({
    interpolates: Object.freeze(['customer_id']),
    // NULL, AND THE NULL IS THE POINT. A customer identifier is TENANT BUSINESS DATA, and `0025`
    // Decision 5 forbids it in the operator log absolutely: "an operator log that accumulates
    // customer data is a second copy of the tenant database with weaker access rules." This
    // operation's trail belongs in its own Organization's `audit_event`, which is reachable
    // because a `DeleteCustomer` has a tenant — unlike a platform route.
    auditTarget: null,
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
    // A PRINCIPAL IDENTIFIER IS A CONTROL-PLANE IDENTIFIER, not tenant business data, and it is
    // exactly what `0025` Decision 5 says the operator log is FOR: "which operator did what, to
    // which Organization or principal, when."
    auditTarget: Object.freeze({ kind: 'principal' as const, key: 'principal_id' }),
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
  // ===========================================================================================
  // REVOKE PLATFORM AUTHORITY. `platform-operators-v1`.
  //
  // *** `principal_id` IS A PATH PARAMETER, NOT A BODY FIELD, AND THAT IS WHY THIS ENTRY EXISTS
  // IN ITS CURRENT FORM. *** `revokeOperatorInput` carries only the three confirmation fields, so
  // under the STRUCK binding definition — body minus the three, nothing added — the parameters
  // were the EMPTY OBJECT and this statement would have had nothing to interpolate. The human
  // would have been asked to confirm "revoke platform authority from {0}" with no {0}.
  //
  // `aa48dd4` AMENDED THE BINDING TO COVER DECLARED PATH PARAMETERS, so `principal_id` is present
  // in `parameters` and the statement names the actual target. **The statement and the binding
  // read the same object**, which is what makes "the human agreed to THIS" true rather than
  // asserted.
  //
  // ===========================================================================================
  // *** THE GENERAL POINT, WHICH IS WORTH MORE THAN THIS ENTRY: A HUMAN-VISIBLE SURFACE IS A
  // CHEAP DETECTOR FOR DEFECTS IN THE MACHINERY BEHIND IT. ***
  // ===========================================================================================
  //
  // The empty-binding defect was found three independent ways on one day, and **this was the most
  // legible of the three:**
  //
  //   - A LOAD-TIME GUARD refused to build the route. Correct, and it is a build failure someone
  //     has to interpret before they know what it means.
  //   - A CONTRACT SENTENCE promised a property the code would not have had. Correct, and it
  //     needed a careful reader comparing a schema against an implementation.
  //   - THIS TEXT would have rendered *"Revoke platform authority from principal "* **and then
  //     nothing.** Wrong in a way anyone would see instantly, without knowing what a binding is.
  //
  // **THE STATEMENT AND THE BINDING READ THE SAME OBJECT, SO A HOLE IN ONE IS VISIBLE IN THE
  // OTHER** — and the one with a human in front of it is the one where the hole is obvious. When
  // a mechanism has a rendered surface, **write the surface early and look at it**: it costs
  // nothing and it catches things that a guard reports obliquely and a contract states abstractly.
  //
  // This entry was written before the route existed, and the empty slot is what made the defect
  // concrete rather than argued.
  // ===========================================================================================
  'platform.operators.revoke': Object.freeze({
    interpolates: Object.freeze(['principal_id']),
    // A PRINCIPAL, exactly as the reset above. `0025` Decision 5 permits an Organization or a
    // principal and this operation names a principal.
    auditTarget: Object.freeze({ kind: 'principal' as const, key: 'principal_id' }),
    text: Object.freeze({
      // IT NAMES THE IRREVERSIBILITY AND THE SELF-REVOCATION CASE, because `0007` D15 requires the
      // statement to say "exactly what will happen" and the most surprising outcome of this
      // operation is the operator revoking THEMSELVES — which the route permits deliberately, with
      // no separate path.
      en:
        'Revoke platform authority from principal {0}. They lose access to every platform ' +
        'operator route from their next request onwards. If this is your own principal you will ' +
        'lose that access yourself, immediately, and no platform route can restore it.',
      ar:
        'إلغاء صلاحية المنصة عن الحساب {0}. سيفقد الوصول إلى جميع مسارات مشغّل المنصة اعتبارًا من ' +
        'طلبه التالي. وإذا كان هذا حسابك أنت، فستفقد هذا الوصول بنفسك فورًا، ولا يمكن لأي مسار في ' +
        'المنصة استعادته.',
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
 * Every catalog entry, with the keys it interpolates and the audit target it declares.
 *
 * ===========================================================================================
 * IT EXISTS SO THE CORRESPONDENCE CAN BE ASSERTED OVER THE **WHOLE CATALOG**, NOT OVER THE
 * ENTRIES SOMEBODY REMEMBERED.
 * ===========================================================================================
 *
 * `renderStatement` and `statementAuditTarget` were already exported, so the check was writable —
 * but only against action identifiers a test author typed out by hand. **A statement added later
 * would be covered by nothing, and a statement is exactly the thing that gets added later.** This
 * is the same argument `TESTING_STANDARD.md` §5.5 makes for asserting over every statement a run
 * emitted rather than over the paths someone exercised.
 *
 * IT RETURNS THE SHAPE AND NOT THE TEXT. The templates stay module-private: a caller that could
 * read them could compare against its own copy, and a caller that could reach them at all is one
 * refactor from a caller that renders its own — which is the whole thing `whyTHESTATEMENTIS
 * SERVERAUTHORED` forbids.
 */
export function statementCatalogEntries(): readonly {
  readonly actionId: string;
  readonly interpolates: readonly string[];
  readonly auditTarget: { readonly kind: 'organization' | 'principal'; readonly key: string } | null;
}[] {
  return Object.freeze(
    Object.entries(CATALOG).map(([actionId, template]) =>
      Object.freeze({
        actionId,
        interpolates: template.interpolates,
        auditTarget: template.auditTarget,
      }),
    ),
  );
}

/**
 * What the operator-action log should name for a challenge on this operation, resolved against the
 * request's own parameters — or `null`.
 *
 * IT RETURNS `null` RATHER THAN GUESSING when the template declares no target, and a `null` here is
 * a positive statement: this operation has no single control-plane target that the operator log may
 * hold. `customers.customer.delete` is exactly that case, and its `null` is a tenant-isolation
 * decision rather than an omission.
 */
export function statementAuditTarget(
  actionId: string,
  parameters: ConfirmationParameters,
): { readonly kind: 'organization' | 'principal'; readonly id: string } | null {
  if (!hasStatement(actionId)) {
    return null;
  }
  const target = CATALOG[actionId].auditTarget;
  if (target === null) {
    return null;
  }
  const value = parameters[target.key];
  // A non-string here cannot happen for a rendered statement — `renderStatement` refuses first —
  // but this function is exported and a future caller could reach it another way. `null` is the
  // safe answer: an audit row naming nothing is weaker evidence, and an audit row naming the
  // string "undefined" is worse than weak.
  return typeof value === 'string' ? { kind: target.kind, id: value } : null;
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
    const target = template.auditTarget;
    if (target !== null && !template.interpolates.includes(target.key)) {
      throw new StatementCatalogIncoherentError(
        `'${actionId}' declares an audit target on '${target.key}', which the statement does not ` +
          'interpolate. THE AUDIT RECORD WOULD THEN NAME SOMETHING THE HUMAN WAS NEVER SHOWN, ' +
          'which is the one property tying the two together — and the value would not have passed ' +
          'the interpolation grammar check either, so it could carry arbitrary text into the log.',
      );
    }
  }
}

assertStatementCatalogIsCoherent();
