/**
 * Cursor pagination controls.
 *
 * ===========================================================================
 * NO TOTAL COUNT, AND THAT IS A CONTRACT PROPERTY RATHER THAN A GAP
 * ===========================================================================
 *
 * There is no "page 3 of 12" here and there is no prop that could carry one.
 * Dudo's list Actions return a page and a `next_cursor` and no total, for tenant
 * isolation reasons rather than performance ones — a count is a fact about rows
 * a caller cannot see. "Showing 25 customers" is true; "25 of 247" is not
 * available and must not be invented by a component.
 *
 * So this renders what is knowable: which page of the trail the caller is on,
 * how many rows are on it, and whether there is another. A caller that has no
 * previous page and no next page gets the count sentence alone, without a
 * navigation landmark that navigates nowhere.
 *
 * IT HOLDS NO CURSOR. Cursors are the caller's, because only the caller knows
 * which filter combination they belong to — the contract rejects a cursor whose
 * filters do not match the request, so a component that remembered one across a
 * filter change would be manufacturing an invalid request.
 */

import { Button } from './button';

export interface PaginationProps {
  /** Rows on the current page. */
  shown: number;
  /** Zero-based position in the caller's cursor trail. */
  pageIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Singular and plural, so the sentence reads correctly for any collection. */
  noun?: { one: string; many: string };
  /** Names the landmark for a screen reader — "Directory pages". */
  label?: string;
}

export function Pagination({
  shown,
  pageIndex,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  noun = { one: 'result', many: 'results' },
  label = 'Pages',
}: PaginationProps) {
  const word = shown === 1 ? noun.one : noun.many;

  if (!hasPrevious && !hasNext) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-muted">
          Showing {shown} {word}.
        </p>
      </div>
    );
  }

  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[0.8125rem] text-ink-muted">
        Page {pageIndex + 1} · showing {shown} {word}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!hasPrevious} onClick={onPrevious}>
          Previous
        </Button>
        <Button size="sm" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </nav>
  );
}
