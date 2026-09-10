/**
 * The table shell — a real `<table>` at desktop widths, a stack of record cards
 * below 55rem.
 *
 * ===========================================================================
 * GENERALISED FROM THE CUSTOMER DIRECTORY, WHICH IS WHY IT LOOKS LIKE THIS
 * ===========================================================================
 *
 * The behaviour is carried over unchanged from `CustomerList`'s hand-rolled
 * table and the `.directory` rules that supported it. One thing DID change, and
 * it is the reason this is a primitive rather than a rename: the old stylesheet
 * placed cards by COLUMN NAME — `.cell-name` to grid row 1, `.cell-status` to
 * row 1 column 2, `.cell-email` and three others spanning full width. Every
 * admin list that wanted the same card layout would have had to add its own
 * column names to a shared stylesheet, which is a shared file growing one entry
 * per screen forever.
 *
 * So placement is declared by ROLE instead — `primary`, `trailing`, `stacked` —
 * and the CSS never learns a column name again. `.data-table` in each host's
 * stylesheet is the whole of it and takes no per-screen additions.
 *
 * THE COLUMN LABELS ARE REAL DOM, not CSS `::before` content, so nothing is lost
 * from the accessibility tree when the header row disappears at the card
 * breakpoint. That was true of the original and is the property most easily lost
 * in a rewrite.
 *
 * IT DECIDES NOTHING. There is no column here that a permission could hide, no
 * row a viewer might not be allowed to see, and no filter. A caller passes rows
 * it has already been given; the server decided what those are.
 */

import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './cn';

export interface TableProps {
  children: ReactNode;
  className?: string;
  /**
   * Fixed column widths, as CSS values in visual order. Rendered as a
   * `<colgroup>`, which the card breakpoint hides.
   */
  columnWidths?: string[];
}

export function Table({ children, className, columnWidths }: TableProps) {
  return (
    <table className={cn('data-table', className)}>
      {columnWidths ? (
        <colgroup>
          {columnWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
      ) : null}
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TableHeaderCell({
  children,
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={className} {...props}>
      {children}
    </th>
  );
}

export interface TableRowProps {
  children: ReactNode;
  className?: string;
  /**
   * Whole-row click, as a CONVENIENCE ONLY.
   *
   * A row handler is never the sole route to a record — the caller is required
   * to put a real link in one of the cells, because a `<tr onClick>` is not
   * reachable by keyboard and is invisible to a screen reader. This helper
   * ignores clicks that landed on a link or a button, and ignores a click that
   * ended a text selection, so neither is swallowed by the row.
   */
  onActivate?: () => void;
}

export function TableRow({ children, className, onActivate }: TableRowProps) {
  return (
    <tr
      className={cn(onActivate && 'cursor-pointer', className)}
      onClick={
        onActivate
          ? (event) => {
              if ((event.target as HTMLElement).closest('a, button')) return;
              if (window.getSelection()?.toString()) return;
              onActivate();
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}

/**
 * Where a cell goes once the table becomes a card.
 *
 * `primary` — line 1, start edge. The record's name.
 * `trailing` — line 1, end edge. One short status.
 * `stacked` — its own full-width line below, with its label. The default.
 */
export type CellPlacement = 'primary' | 'trailing' | 'stacked';

export interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'children'> {
  children: ReactNode;
  /**
   * Shown only in the card layout, where there is no header row to carry it.
   * `aria-hidden`, because the `<th>` is already the cell's accessible name at
   * table widths and repeating it would announce every value twice.
   */
  label?: string;
  placement?: CellPlacement;
  /** Shorten with an ellipsis at table widths. The card layout always wraps. */
  truncate?: boolean;
  nowrap?: boolean;
}

export function TableCell({
  children,
  label,
  placement = 'stacked',
  truncate,
  nowrap,
  className,
  ...props
}: TableCellProps) {
  return (
    <td
      data-placement={placement}
      data-truncate={truncate ? '' : undefined}
      data-nowrap={nowrap ? '' : undefined}
      className={className}
      {...props}
    >
      {label ? (
        <span aria-hidden="true" className="cell-label">
          {label}
        </span>
      ) : null}
      <span className="cell-value">{children}</span>
    </td>
  );
}

/**
 * An optional value the tenant has not filled in.
 *
 * Shown as an explicit dash with an accessible name rather than as a blank,
 * because a blank cell is indistinguishable from a rendering bug.
 */
export function NotRecorded({ label = 'Not recorded' }: { label?: string }) {
  return (
    <span aria-label={label} className="text-ink-faint">
      —
    </span>
  );
}
