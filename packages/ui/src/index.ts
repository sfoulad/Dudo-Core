/**
 * `@dudo/ui` — the presentation primitives, shared by `app.dudo.work` and
 * `admin.dudo.work` (ADR 0036, 0040).
 *
 * ===========================================================================
 * THE ONE RULE, AND IT IS NOT A STYLE RULE
 * ===========================================================================
 *
 * **THIS LAYER CARRIES NO AUTHORITY.** A component that RENDERS a member row is
 * shared. A component that DECIDES whether the viewer may see it is not, and
 * does not belong here. **The two administrations share a look. They do not
 * share a permission model, a data layer, or a route tree.**
 *
 * And the reason a hidden control is not a control: `security.md` §2 — *UI-level
 * hiding is presentation, never security.* Every screen in both consoles is
 * reachable by typing its URL, and the server is what refuses. A primitive named
 * as though it decided something would be the first place a future author looked
 * for a guarantee that has never been here.
 *
 * `npm run check:ui-purity` enforces it structurally rather than by convention.
 * **Until `0040` that check had no subject** — it guarded one host's private
 * directory, and there was no shared component for the rule to apply to.
 *
 * ===========================================================================
 * A FLAT BARREL, DELIBERATELY
 * ===========================================================================
 *
 * One entry point rather than deep paths, so a consumer writes
 * `import { Button } from '@dudo/ui'` and the package's internal file layout
 * stays the package's business. It also gives `check:ui-purity` a single surface
 * to reason about: every module reachable from here is in the population it
 * examines.
 */

export { cn } from './cn';

export { Button, ButtonLink, Spinner, buttonVariants } from './button';
export type { ButtonProps, ButtonLinkProps } from './button';

export { Badge, Tag, badgeVariants, tagVariants } from './badge';
export type { BadgeProps, BadgeTone, TagProps, TagTone } from './badge';

export { Input, Textarea, Select, Field, ReadOnlyValue } from './field';
export type { InputProps, FieldProps, FieldAnnounce } from './field';

export { Panel, StateBlock, Skeleton, SkeletonRows } from './panel';

export {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  NotRecorded,
} from './table';
export type { TableProps, TableRowProps, TableCellProps, CellPlacement } from './table';

export { DataTable, dataTableFeatures, useDataTableColumns } from './data-table';
export type { DataTableProps, DataTableColumn, DataTableColumnMeta, DataTableFeatures } from './data-table';

export { SegmentedControl } from './segmented-control';
export type { SegmentedControlProps, SegmentedOption } from './segmented-control';

export { Pagination } from './pagination';
export type { PaginationProps } from './pagination';

export { Toaster, toast, dismiss } from './toast';
export type { Toast } from './toast';
