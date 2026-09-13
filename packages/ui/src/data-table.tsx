/**
 * The TanStack Table binding — column definitions in, our markup out.
 *
 * ===========================================================================
 * HEADLESS IS THE POINT. THE MARKUP STAYS OURS.
 * ===========================================================================
 *
 * ADR 0036 approved TanStack Table specifically because it is headless: it owns
 * the column model, the header groups and the row model, and it renders nothing.
 * Every element below comes from `table.tsx`, so the responsive card layout, the
 * real `<th scope="col">`, and the labels that survive the breakpoint are
 * unchanged and are not the library's to alter.
 *
 * **It is also the ONLY one of `0036`'s six libraries this package may depend
 * on**, and headlessness is exactly why: it carries no route, no request and no
 * opinion about who may look. Router and Query are refused by
 * `check:ui-purity`.
 *
 * ===========================================================================
 * ⚠ SORTING IS OFF BY DEFAULT, AND ON A CURSOR LIST IT MUST STAY OFF
 * ===========================================================================
 *
 * Client-side sorting reorders THE ROWS IN HAND. Dudo's list Actions are cursor
 * paginated and return one page with no total, so on such a list the control
 * would appear to sort the directory and would in fact sort twenty-five rows out
 * of an unknown number — putting the alphabetically-first name of page two
 * nowhere near the top, with nothing on screen to say so. That is not a rough
 * edge; it is a header that states something false.
 *
 * So `sortable` is opt-in per column and is correct only where the caller holds
 * the WHOLE collection — a short list a screen fetched in one call. When the
 * server owns the ordering, the sort belongs in the request, and that is a
 * contract question rather than a component option.
 *
 * ===========================================================================
 * IT DECIDES NOTHING
 * ===========================================================================
 *
 * No column here is hidden by a permission and no row is filtered by one. The
 * caller passes rows the server already agreed to give it. A column a viewer
 * should not see is a column the response should not carry — `security.md` §2,
 * and hiding it here would be presentation dressed as a control.
 */

import { useMemo, useState } from 'react';
import {
  createCoreRowModel,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type CellPlacement,
} from './table';

/**
 * Per-column presentation, carried on the column definition's `meta`.
 *
 * It is all layout. There is deliberately no `permission`, no `visibleWhen` and
 * no `role` here, and none may be added: see the header of this file.
 */
export interface DataTableColumnMeta {
  /** Shown in the card layout, where there is no header row to carry it. */
  label?: string;
  placement?: CellPlacement;
  truncate?: boolean;
  nowrap?: boolean;
}

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * `RowData` is TanStack's own constraint on a row — an object type. It is
 * repeated on every generic here rather than widened to `unknown`, because the
 * library's option types demand it and a widened alias would only move the
 * error to the call site.
 */
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, unknown>;

export interface DataTableProps<TData extends RowData> {
  columns: readonly DataTableColumn<TData>[];
  /**
   * ⚠ `readonly`, AND THE REASON IS A CONTRACT PROPERTY RATHER THAN A STYLE PREFERENCE.
   *
   * `0037`'s generated response types are `readonly` throughout, because a wire response is
   * something a client RECEIVES and not something it owns. This prop took `TData[]`, so every
   * consumer of a generated type had exactly two options and both were wrong:
   *
   *   copy the array   an allocation per render, to satisfy a signature rather than a need
   *   cast it          AN ASSERTION THAT THE ARRAY IS MUTABLE — which is precisely the claim
   *                    the contract has just withdrawn
   *
   * `web-agent` hit this consuming `customer-directory-v1` and TOOK THE COPY, which was the
   * honest choice: *"a cast would assert the array is mutable, and that is exactly the claim the
   * contract has withdrawn."* It then reported the cost rather than absorbing it. **This widening
   * removes the copy for every consumer, not only that one.**
   *
   * WIDENING A PARAMETER BREAKS NO CALLER. A mutable array is assignable to a readonly one, so
   * every existing call site compiles unchanged; only the component's own ability to mutate is
   * removed, and it never did. TanStack Table accepts a readonly `data`.
   *
   * `columns` is widened in the same change for the same reason and to avoid the asymmetry
   * looking deliberate — one readonly prop beside one mutable one reads as a decision.
   *
   * THE FALSIFIER, because `readonly` is weaker than it looks: TypeScript IGNORES `readonly` in
   * assignability between OBJECT types, so this guards the ARRAY and not the records in it.
   * `web-agent` measured that in the same pass — a function claiming to accept a readonly record
   * and storing it in a mutable array compiled silently. The element type must carry its own
   * `readonly` fields, which the generated types do.
   */
  rows: readonly TData[];
  /**
   * A stable identity per row. Required rather than defaulted to the array
   * index, because an index-keyed row re-uses the previous record's DOM when a
   * page changes and carries its focus and selection onto a different record.
   */
  getRowId: (row: TData) => string;
  /** Fixed column widths in visual order, as CSS values. */
  columnWidths?: string[];
  /**
   * Whole-row click as a convenience. The caller must still put a real link in
   * one of the cells — see `TableRow`.
   */
  onRowActivate?: (row: TData) => void;
  className?: string;
}

export function DataTable<TData extends RowData>({
  columns,
  rows,
  getRowId,
  columnWidths,
  onRowActivate,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useTable<DataTableFeatures, TData, { sorting: SortingState }>(
    {
      features: dataTableFeatures,
      columns,
      data: rows,
      getRowId,
      state: { sorting },
      onSortingChange: setSorting,
    },
    (state) => ({ sorting: state.sorting }),
  );

  const headerGroups = table.getHeaderGroups();
  const modelRows = table.getRowModel().rows;

  return (
    <Table className={className} {...(columnWidths ? { columnWidths } : {})}>
      <TableHead>
        {headerGroups.map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const canSort = header.column.getCanSort();
              return (
                <TableHeaderCell
                  key={header.id}
                  aria-sort={canSort ? ariaSortFor(header.column.getIsSorted()) : undefined}
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-inherit"
                    >
                      <table.FlexRender header={header} />
                      <SortGlyph direction={header.column.getIsSorted()} />
                    </button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHeaderCell>
              );
            })}
          </tr>
        ))}
      </TableHead>

      <TableBody>
        {modelRows.map((row) => (
          <TableRow
            key={row.id}
            {...(onRowActivate ? { onActivate: () => onRowActivate(row.original) } : {})}
          >
            {row.getAllCells().map((cell) => {
              const meta = (cell.column.columnDef.meta ?? {}) as DataTableColumnMeta;
              return (
                <TableCell
                  key={cell.id}
                  {...(meta.label === undefined ? {} : { label: meta.label })}
                  {...(meta.placement === undefined ? {} : { placement: meta.placement })}
                  {...(meta.truncate === undefined ? {} : { truncate: meta.truncate })}
                  {...(meta.nowrap === undefined ? {} : { nowrap: meta.nowrap })}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ariaSortFor(direction: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

/**
 * Decoration only — `aria-sort` on the `<th>` is what a screen reader reads, so
 * this is hidden and the direction is never carried by the glyph alone.
 */
function SortGlyph({ direction }: { direction: false | 'asc' | 'desc' }) {
  return (
    <span aria-hidden="true" className="text-ink-faint">
      {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
    </span>
  );
}

/**
 * `useMemo` re-export guidance, kept as a named helper so call sites do not each
 * invent one: column definitions must be stable across renders or the table
 * rebuilds its model on every keystroke in a search box above it.
 */
export function useDataTableColumns<TData extends RowData>(
  factory: () => DataTableColumn<TData>[],
  deps: unknown[],
): DataTableColumn<TData>[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, deps);
}
