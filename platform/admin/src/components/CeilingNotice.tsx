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

import { Button } from '@/components/ui/button';
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
            ? 'Operators have read this business enough for today'
            : 'This log has been read enough for today'
          : scope === 'organization'
            ? 'This business has reached its own daily limit'
            : 'The platform has reached its own daily limit'}
      </h2>

      <p className="mt-2 leading-relaxed text-ink-soft">
        {isRateLimit ? (
          scope === 'organization' ? (
            <>
              Reading this trail writes to it, and the platform&rsquo;s share of this
              business&rsquo;s day is spent.{' '}
              <span className="font-semibold">This is about operator activity, not about the
              customer</span> — someone, possibly you, has read enough for one day. Another
              operator may be part-way through an investigation.
            </>
          ) : (
            <>
              Reading the log writes to the log, and the allowance for that is spent for now.{' '}
              <span className="font-semibold">This is about operator activity</span>, not about any
              customer.
            </>
          )
        ) : scope === 'organization' ? (
          <>
            <span className="font-semibold">This is about the customer, not about you.</span> The
            business has reached its own daily write allocation, and reading this trail needs a
            write into it. Nothing an operator does will clear it — it resets at 00:00 UTC, and
            retrying now spends what little the customer has left on a refusal.
          </>
        ) : (
          <>
            <span className="font-semibold">This is the platform&rsquo;s own allocation</span>, not
            a customer&rsquo;s. It resets at 00:00 UTC. Retrying now will not help.
          </>
        )}
      </p>

      {error.retry_after_seconds !== null ? (
        <p className="mt-2 text-[0.875rem] text-ink-muted">
          Core suggests waiting about {error.retry_after_seconds} seconds.
        </p>
      ) : null}

      {error.request_id ? (
        <p className="mt-3 font-mono text-xs break-all text-ink-muted">
          Reference {error.request_id}
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
          Try again
        </Button>
      ) : null}
    </div>
  );
}
