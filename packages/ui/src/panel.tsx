/**
 * Surfaces and non-content states — panel, state block, skeleton.
 *
 * MOVED HERE FROM `components/StateBlock.tsx` (ADR 0036, Milestone 0 item 5).
 * The three exports below are pure presentation and belong to the shared
 * primitive layer; `ErrorBlock` and `LoadingRows` stayed behind in
 * `components/ErrorBlock.tsx` because they know what an `ApiError` is, and a
 * primitive that knows the data layer is not shared — see `README.md`.
 *
 * Loading, empty and error are treated as first-class screens rather than
 * afterthoughts: each says what happened, what it means, and what the person can
 * do next.
 */

import type { ReactNode } from 'react';
import { cn } from './cn';

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

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('h-3 animate-pulse rounded-full bg-sunk', className)} />;
}

/**
 * A skeleton block shaped like a list of rows.
 *
 * `columns` is how many bars a row shows at desktop width; everything after the
 * second is hidden on narrow screens, matching what `table.tsx` does to the
 * real rows. It is `aria-hidden` because a skeleton is a picture of waiting, and
 * the screen announces the wait in its own live region.
 */
export function SkeletonRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ['w-[70%]', 'w-[50%]', 'w-[85%]', 'w-[60%]', 'w-[45%]', 'w-[55%]'];
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-line p-4 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <span
              key={columnIndex}
              className={cn(
                'flex-1',
                // Only the first two survive the card breakpoint, because that
                // is how many the card layout shows on its first line.
                columnIndex >= 2 && 'max-[55rem]:hidden',
              )}
            >
              <Skeleton className={widths[columnIndex % widths.length]} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
