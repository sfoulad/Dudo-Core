/**
 * The three time-window refusals, kept distinct from each other and from
 * everything else.
 *
 * ===========================================================================
 * WHY THEY DO NOT COLLAPSE
 * ===========================================================================
 *
 * `time_window_required`, `time_window_too_wide` and `time_window_inverted` all
 * arrive as `invalid_argument`, and rendering them as one "invalid request"
 * would be the same defect this console already refused once on the member
 * lookup: **a collapsed message where the causes are genuinely different helps
 * nobody.**
 *
 * The three need three different actions — add dates, narrow them, swap them —
 * and one sentence cannot tell an operator which. THIS IS THE OPPOSITE CASE FROM
 * THE MEMBER RESOLVE, and the contrast is the point: there, five causes collapse
 * because distinguishing them would disclose who belongs to which Organization.
 * Here, nothing is disclosed by saying which end of a date range is wrong.
 *
 * THE 31-DAY LIMIT IS NAMED, and the contract says why that is safe where the
 * cursor rejections are collapsed: **a span limit is a constant, not a fact
 * about data.** It teaches a caller nothing about any record, operator or
 * Organization.
 *
 * AND NONE OF THEM OFFERS A RETRY. Every one is a malformed question — retrying
 * it unchanged spends another 2 control-plane row-writes to be refused the same
 * way. The operator has to change the dates, and the message says which.
 */

import { ErrorBlock } from '@/components/StateBlock';
import { MAX_WINDOW_DAYS, describeWindowRefusal, windowRefusalToken } from '@/api/audit-window';
import { fill, useLocale } from '@/lib/i18n';
import type { ApiError } from '@/api/errors';

export function WindowOrOtherError({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  const { locale, t } = useLocale();
  const token = windowRefusalToken(error);

  if (token === null) {
    // Not a window problem. Ordinary handling, retry where it could help.
    return <ErrorBlock error={error} onRetry={onRetry} />;
  }

  /*
   * THE SENTENCES COME FROM THE DICTIONARY AND THE LIMIT COMES FROM THE MODULE.
   * `describeWindowRefusal` returns keys plus `days`, so the number in *"at most
   * 31 days apart"* is `MAX_WINDOW_DAYS` rather than a numeral somebody typed
   * into two translations. See `fill`'s header for why the prefix/suffix pattern
   * used elsewhere could not carry this one.
   */
  const { titleKey, bodyKey } = describeWindowRefusal(token);
  /*
   * THE LIMIT IS SUPPLIED UNCONDITIONALLY, and `fill` ignores what a sentence
   * does not name. `time_window_inverted` says nothing about days; carrying an
   * optional `days` through the return type to express that produced a union
   * the index signature rejects, and — more to the point — it would have made
   * WHICH SENTENCES MENTION THE LIMIT a fact stated in two places. The
   * dictionary is the only place that should know.
   */
  const values = { days: MAX_WINDOW_DAYS };

  return (
    <div
      role="alert"
      className="rounded-[12px] border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-scarlet-700">
        {fill(t(titleKey), locale, values)}
      </h2>
      <p className="mt-2 leading-relaxed text-ink-soft">{fill(t(bodyKey), locale, values)}</p>
      {error.request_id ? (
        <p className="mt-3 text-xs text-ink-muted">
          {t('denied.reference')} <bdi className="font-mono break-all">{error.request_id}</bdi>
        </p>
      ) : null}
    </div>
  );
}
