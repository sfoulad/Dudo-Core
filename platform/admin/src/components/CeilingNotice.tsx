/**
 * `rate_limited` and `quota_exceeded` — two refusals that mean OPPOSITE things
 * and must never be merged.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE COMPONENT FROM `ErrorBlock`
 * ===========================================================================
 *
 * Both codes arrive as ordinary failures and both would render acceptably as
 * "something went wrong, try again". THAT RENDERING IS THE DEFECT: it produces
 * exactly the behaviour the ceilings exist to stop.
 *
 *   `rate_limited`    THE PLATFORM has spent its share. A statement about
 *                     OPERATOR ACTIVITY — too much reading, by operators,
 *                     against this Organization today. Retrying is the wrong
 *                     move and another operator may be mid-investigation.
 *
 *   `quota_exceeded`  THE CUSTOMER is at their own allocation. A statement
 *                     about the CUSTOMER, and nothing an operator does will
 *                     clear it. Retrying spends the customer's remaining budget
 *                     on a refusal.
 *
 * An operator who cannot tell them apart will retry, and retrying is precisely
 * what the ceiling exists to prevent. So each says WHOSE budget was reached, in
 * a different colour, and NEITHER offers an automatic retry — the retry is a
 * button a person presses after reading which it was.
 *
 * ===========================================================================
 * THE WORDING DIFFERS BY FEED, WHICH IS WHY `scope` IS A PARAMETER
 * ===========================================================================
 *
 * `scope` selects WHOSE LEDGER the message describes, not what is disclosed.
 * The platform feed writes only control-plane rows, so a refusal there is about
 * the operator's own ceiling and no customer is involved. The Organization feed
 * writes FIVE TENANT ROWS PER PAGE into the named customer's own allocation, so
 * a refusal there can be the customer's. Saying "the customer is at their
 * allocation" on the platform feed would name a party that is not involved.
 */

import { Button } from '@dudo/ui';
import { fill, formatSeconds, useLocale } from '@/lib/i18n';
import type { ApiError, ErrorCode } from '@/api/errors';

/** The two codes this component exists for. Anything else is an ordinary error. */
export function isCeilingCode(code: ErrorCode): boolean {
  return code === 'rate_limited' || code === 'quota_exceeded';
}

export interface CeilingNoticeProps {
  readonly error: ApiError;
  /** Which ledger the message should describe. Never what it discloses. */
  readonly scope: 'platform' | 'organization';
  readonly onRetry?: () => void;
}

export function CeilingNotice({ error, scope, onRetry }: CeilingNoticeProps) {
  const { locale, t } = useLocale();
  const isRateLimit = error.code === 'rate_limited';

  return (
    <div
      role="alert"
      className={
        isRateLimit
          ? 'rounded-[12px] border border-gold-500 bg-gold-50 p-5 sm:p-6'
          : 'rounded-[12px] border border-azure-500 bg-azure-50 p-5 sm:p-6'
      }
    >
      <h2 className={isRateLimit ? 'text-base font-bold text-gold-700' : 'text-base font-bold text-azure-700'}>
        {isRateLimit
          ? scope === 'organization'
            ? t('ceiling.rate.org.title')
            : t('ceiling.rate.platform.title')
          : scope === 'organization'
            ? t('ceiling.quota.org.title')
            : t('ceiling.quota.platform.title')}
      </h2>

      {/*
        ⚠ WHOSE ALLOWANCE IT IS, IS THE WHOLE POINT OF THESE FOUR SENTENCES, and
        it is the half a translation would flatten first.

        `rate_limited` is about OPERATOR activity against a customer.
        `quota_exceeded` at organization scope is about the CUSTOMER'S OWN
        allocation, which no operator action can clear and which retrying
        actively spends. **Merging them produces a retry** — the behaviour the
        ceilings exist to stop — and telling an operator a limit is theirs when
        it is the customer's invites exactly that.
      */}
      <p className="mt-2 leading-relaxed text-ink-soft">
        {isRateLimit ? (
          scope === 'organization' ? (
            <>
              {t('ceiling.rate.org.before')}{' '}
              <span className="font-semibold">{t('ceiling.rate.org.whose')}</span>{' '}
              {t('ceiling.rate.org.after')}
            </>
          ) : (
            <>
              {t('ceiling.rate.platform.before')}{' '}
              <span className="font-semibold">{t('ceiling.rate.platform.whose')}</span>{' '}
              {t('ceiling.rate.platform.after')}
            </>
          )
        ) : scope === 'organization' ? (
          <>
            <span className="font-semibold">{t('ceiling.quota.org.whose')}</span>{' '}
            {t('ceiling.quota.org.after')}
          </>
        ) : (
          <>
            <span className="font-semibold">{t('ceiling.quota.platform.whose')}</span>{' '}
            {t('ceiling.quota.platform.after')}
          </>
        )}
      </p>

      {error.retry_after_seconds !== null ? (
        <p className="mt-2 text-[0.875rem] text-ink-muted">
          {/*
            `formatSeconds` RATHER THAN A NUMERAL — Arabic has singular, dual and
            two plural forms for "seconds" and `Intl` has them all.
          */}
          {fill(t('ceiling.waitAbout'), locale, {
            seconds: formatSeconds(locale, error.retry_after_seconds),
          })}
        </p>
      ) : null}

      {error.request_id ? (
        <p className="mt-3 text-xs text-ink-muted">
          {t('denied.reference')} <bdi className="font-mono break-all">{error.request_id}</bdi>
        </p>
      ) : null}

      {/*
        A RETRY BUTTON, NEVER AN AUTOMATIC RETRY, and only for the rate limit —
        which may clear. `quota_exceeded` is the customer's ledger and will not
        clear before 00:00 UTC, so offering a retry there would invite spending
        their budget on refusals.
      */}
      {onRetry && isRateLimit ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {t('state.retry')}
        </Button>
      ) : null}
    </div>
  );
}
