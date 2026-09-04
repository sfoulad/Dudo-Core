/**
 * Loading, empty and error treated as first-class screens rather than
 * afterthoughts: each says what happened, what it means, and what the person
 * can do next.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './ui/button';
import { ApiError, errorBody, errorTitle, isRetryable } from '@/api/errors';

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StateBlock({
  glyph = '·',
  title,
  body,
  actions,
  note,
  tone = 'default',
}: {
  glyph?: string;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  note?: string | null;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="grid justify-items-center gap-3 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-11 place-items-center rounded-full',
          tone === 'error' ? 'bg-scarlet-50 text-scarlet-600' : 'bg-navy-50 text-navy-600',
        )}
      >
        {glyph}
      </span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {body ? <div className="max-w-[34rem] text-ink-muted">{body}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-3">{actions}</div> : null}
      {note ? <p className="font-mono text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}

/**
 * The one place an ApiError becomes something a person reads.
 *
 * The developer-facing `message` is shown as a supporting line and the
 * `request_id` verbatim, because that identifier is what makes a support
 * conversation possible without anyone having to share the data involved.
 */
export function ErrorBlock({
  error,
  onRetry,
  retryLabel = 'Try again',
  extraActions,
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  extraActions?: ReactNode;
}) {
  const body = errorBody(error);
  return (
    <StateBlock
      glyph="!"
      tone="error"
      title={errorTitle(error)}
      body={
        <>
          <p>{body}</p>
          {error.message && error.message !== body ? (
            <p className="font-mono text-xs text-ink-faint">{error.message}</p>
          ) : null}
        </>
      }
      actions={
        <>
          {onRetry && isRetryable(error) ? (
            <Button variant="primary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {extraActions}
        </>
      }
      note={error.request_id ? `Reference ${error.request_id}` : null}
    />
  );
}

/** A skeleton that matches the directory's column rhythm. */
export function LoadingRows({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[1.6fr_0.6fr_1.4fr_1fr_0.7fr] gap-4 border-b border-line p-4 last:border-b-0 max-[55rem]:grid-cols-2"
        >
          <Skeleton className="w-[70%]" />
          <Skeleton className="w-[50%]" />
          <Skeleton className="w-[85%] max-[55rem]:hidden" />
          <Skeleton className="w-[60%] max-[55rem]:hidden" />
          <Skeleton className="w-[45%] max-[55rem]:hidden" />
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'h-3 animate-pulse rounded-full bg-sunk',
        className,
      )}
    />
  );
}
