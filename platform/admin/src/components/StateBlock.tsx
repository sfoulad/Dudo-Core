/**
 * Loading, error and empty states, drawn once so they read the same everywhere.
 *
 * THE THREE ARE VISUALLY DISTINCT ON PURPOSE. "Still loading", "this failed" and
 * "Core answered and there is nothing here" are three different facts, and a
 * console that renders them alike teaches an operator to read a blank region as
 * "probably fine". `NotBuiltYet` is a FOURTH and deliberately does not reuse
 * this component: "not built" is a statement about the software, not about the
 * data.
 */

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { errorBody, errorTitle, isRetryable, type ApiError } from '@/api/errors';

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
  retryLabel = 'Try again',
  children,
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-[12px] border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6"
    >
      <h2 className="text-base font-bold text-scarlet-700">{errorTitle(error)}</h2>
      <p className="mt-2 leading-relaxed text-ink-soft">{errorBody(error)}</p>
      {children}
      {error.request_id ? (
        <p className="mt-3 font-mono text-xs break-all text-ink-muted">
          Reference {error.request_id}
        </p>
      ) : null}
      {onRetry && isRetryable(error) ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel}
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
