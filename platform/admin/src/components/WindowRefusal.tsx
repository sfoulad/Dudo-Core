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
import { describeWindowRefusal, windowRefusalToken } from '@/api/audit-window';
import type { ApiError } from '@/api/errors';

export function WindowOrOtherError({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  const token = windowRefusalToken(error);

  if (token === null) {
    // Not a window problem. Ordinary handling, retry where it could help.
    return <ErrorBlock error={error} onRetry={onRetry} />;
  }

  const { title, body } = describeWindowRefusal(token);

  return (
    <div
      role="alert"
      className="rounded-[12px] border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-scarlet-700">{title}</h2>
      <p className="mt-2 leading-relaxed text-ink-soft">{body}</p>
      {error.request_id ? (
        <p className="mt-3 font-mono text-xs break-all text-ink-muted">
          Reference {error.request_id}
        </p>
      ) : null}
    </div>
  );
}
