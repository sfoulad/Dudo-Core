/**
 * Loading, error, empty and permission-denied states, drawn once so they read
 * the same everywhere.
 *
 * THEY ARE VISUALLY DISTINCT ON PURPOSE. "Still loading", "this failed", "Core
 * answered and there is nothing here" and "you may not see this" are four
 * different facts, and a console that renders them alike teaches an operator to
 * read a blank region as "probably fine". `NotBuiltYet` is a FIFTH and
 * deliberately does not reuse this component: "not built" is a statement about
 * the software, not about the data.
 *
 * ===========================================================================
 * THE SIX STATE FAMILIES AND WHERE EACH ONE LIVES
 * ===========================================================================
 *
 * Four are here, and the two that are not are absent for reasons rather than
 * by omission:
 *
 *   loading            `LoadingBlock`
 *   empty              `EmptyBlock`
 *   error              `ErrorBlock`
 *   permission-denied  `PermissionDeniedBlock`   ← below
 *   confirmation       `components/ConfirmationGate.tsx` — it is a FLOW, not a
 *                      block: it requests a server-authored statement, renders
 *                      it verbatim and collects re-authentication. Nothing
 *                      about it can be a shared panel.
 *   not-found          OWNED BY EACH SCREEN, and deliberately not shared.
 *                      `OrganizationDetail` carries the worked example and the
 *                      contract's warning: saying plainly that a thing does not
 *                      exist is licensed for THIS route class only, because its
 *                      callers can already enumerate. **A shared not-found
 *                      component is how that permission would travel to a
 *                      tenant surface where it is an oracle**, and
 *                      `verify-platform.mjs` reserves against it.
 */

import type { ReactNode } from 'react';
import { Button } from '@dudo/ui';
import { errorBodyKey, errorTitleKey, isRetryable, type ApiError } from '@/api/errors';
import {
  fill,
  formatSeconds,
  useLocale,
  useT,
  type Locale,
  type MessageKey,
} from '@/lib/i18n';

/**
 * The body sentence for a failure, in the reader's language.
 *
 * ===========================================================================
 * A PLAIN FUNCTION RATHER THAN A HOOK, AND THAT IS NOT A STYLE CHOICE
 * ===========================================================================
 *
 * `SignIn` renders its failure inside `{failure ? … : null}` — **a hook cannot
 * be called there**, and the alternative was for that screen to re-implement
 * the `null`-means-Core's-message rule. **A second copy of a rule about which
 * errors get a console sentence and which get Core's** is exactly the
 * duplication `§12` records as unsweepable: nothing cites it, nothing goes red,
 * and the two copies drift the first time a code moves between the two lists.
 *
 * So it takes the locale and the lookup as arguments. Both callers pass what
 * they already hold.
 *
 * ===========================================================================
 * `null` FROM `errorBodyKey` MEANS "SHOW CORE'S OWN MESSAGE", AND IT IS A REAL
 * ANSWER RATHER THAN A GAP
 * ===========================================================================
 *
 * `invalid_argument` and `conflict` have no console-written body, deliberately:
 * **Core knows which field and this console does not**, so its message is more
 * useful than any generic sentence written here. It is rendered untranslated,
 * because it arrived from Core in whatever language Core speaks and inventing a
 * translation for it would be inventing content.
 */
export function errorSentence(
  error: ApiError,
  locale: Locale,
  t: (key: MessageKey) => string,
): string {
  const bodyKey = errorBodyKey(error);
  if (bodyKey === null) return error.message;
  /*
   * `formatSeconds` RATHER THAN A NUMERAL. "Wait about 25 seconds" needs
   * Arabic's singular, dual and two plural forms, and `Intl` has them for
   * `second` — the one unit this console gets free.
   */
  return fill(t(bodyKey), locale, {
    seconds:
      error.retry_after_seconds === null ? '' : formatSeconds(locale, error.retry_after_seconds),
  });
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-6 text-ink-muted"
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent"
      />
      {label}
    </div>
  );
}

/**
 * A failure, with a retry only where retrying could plausibly help.
 *
 * `onRetry` is offered but the decision to SHOW it is `isRetryable`'s, so a
 * `forbidden` never gets a button inviting someone to hammer a door that is
 * closed on purpose.
 *
 * THE REQUEST ID IS ALWAYS SHOWN WHEN PRESENT. It is the only thing that ties
 * what an operator saw to what Core recorded, and on this class every call also
 * wrote an audit row that carries the same correlation.
 */
export function ErrorBlock({
  error,
  onRetry,
  retryLabel,
  children,
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  const { locale, t } = useLocale();
  return (
    <div
      role="alert"
      className="rounded-[12px] border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-scarlet-700">{t(errorTitleKey(error))}</h2>
      <p className="mt-2 leading-relaxed text-ink-soft">{errorSentence(error, locale, t)}</p>
      {children}
      {error.request_id ? (
        <p className="mt-3 text-xs text-ink-muted">
          {t('denied.reference')} <bdi className="font-mono break-all">{error.request_id}</bdi>
        </p>
      ) : null}
      {onRetry && isRetryable(error) ? (
        /*
          ⚠ THE DEFAULT MOVED OUT OF THE SIGNATURE. It was
          `retryLabel = 'Try again'`, a default PARAMETER — which is evaluated
          where there is no locale, so it could not be translated in place. It is
          now resolved here, where the hook is. Callers passing their own label
          are unaffected.
        */
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel ?? t('state.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Core answered, and there is nothing to show.
 *
 * IT SAYS THAT CORE ANSWERED. "No Organizations yet" and "we could not ask" look
 * identical as a blank region, and only one of them means the platform is empty.
 */
export function EmptyBlock({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-6 text-center sm:p-8">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-prose leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

/**
 * `403`. A DIFFERENT STATE FROM AN ERROR AND FROM AN EMPTY LIST.
 *
 * ===========================================================================
 * IT MUST NOT SAY WHICH OF THE FOUR REASONS APPLIES, AND THE FOURTH IS WHY
 * ===========================================================================
 *
 * `platform-operator-v1`, `errors.forbidden`: *"A principal with no
 * platform_operator row, an unrecognised platform_role, a role lacking the
 * permission, OR A PRINCIPAL PRESENT IN BOTH TABLES, all receive the identical
 * argument-free forbidden. The four are indistinguishable, and the fourth is
 * why: a caller able to detect the mutual-exclusion refusal could use these
 * routes to probe organization_membership."*
 *
 * **So the wording is true of all four rather than a guess at the likely one.**
 * *"You are not a platform operator"* would be a confident statement the
 * response does not support, and on the fourth condition it would be actively
 * wrong. This panel says the access was refused, says this console cannot tell
 * which reason applies, and says that is deliberate — **an operator told the
 * answer is uniform by design stops probing; one who thinks the console is
 * being evasive does not.**
 *
 * ===========================================================================
 * WHAT IT IS NOT
 * ===========================================================================
 *
 * **NOT AN EMPTY STATE.** A blank table for a permission failure tells an
 * operator the platform holds nothing, which is a false statement about a
 * customer's data — and it is the specific failure this component was
 * commissioned to remove.
 *
 * **NO RETRY, EVER.** `isRetryable` already refuses `forbidden`, and there is
 * no control here either: retrying spends an audited call to receive the same
 * settled answer, and `0013` bounds denial auditing precisely because a flood
 * of refusals could exhaust the daily write allowance. **A console that answers
 * every refusal with another request works against that bound from the inside.**
 *
 * **NOT A SECURITY CONTROL.** `0010` §7 and `security.md` §2: hiding a control
 * is presentation. Core refuses regardless, and every screen using this panel
 * still issues the call and still handles the refusal.
 *
 * The request id is shown when present because it is the only thing tying what
 * an operator saw to the audit row Core wrote.
 */
export function PermissionDeniedBlock({
  error,
  children,
}: {
  error: ApiError;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="rounded-[12px] border border-gold-500 bg-gold-50 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-ink">{t('denied.title')}</h2>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">{t('denied.body')}</p>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">{t('denied.whatToDo')}</p>
      {children}
      {error.request_id ? (
        <p className="mt-3 font-mono text-xs break-all text-ink-muted">
          {t('denied.reference')} {error.request_id}
        </p>
      ) : null}
    </div>
  );
}
