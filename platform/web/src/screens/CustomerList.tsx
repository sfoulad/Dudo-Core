/**
 * The customer directory — the main screen.
 *
 * ListCustomers and SearchCustomers return the same row shape, so this screen
 * renders one table and swaps which Action fills it. That is deliberate: the two
 * Actions differ in how the candidate set is chosen, never in what a row looks
 * like.
 *
 * WHAT IS SEARCHED, AND WHAT IS NOT. display_name, email and phone. Notes and
 * address are not searchable, by contract (README §7.1) — making free-text notes
 * searchable would turn an arbitrary phrase into a probe over the most sensitive
 * field in the record, and hand back through the search box what the list
 * projection withholds. The empty state says so, so nobody concludes the search
 * is broken.
 *
 * NO TOTAL COUNT is shown anywhere. The contract returns none and the reason is
 * tenant isolation rather than performance. "Showing 25 customers" is true;
 * "25 of 247" is not available and is not invented here. `ui/pagination.tsx`
 * has no prop that could carry one.
 *
 * ===========================================================================
 * WHAT THE MIGRATION CHANGED, AND ONE THING IT DELIBERATELY DID NOT
 * ===========================================================================
 *
 * The URL state is now parsed and typed once by the route
 * (`routes/customer-list-search.ts`), the read is a TanStack Query, and the
 * table, the tab strip and the pager are `ui/` primitives that the next admin
 * list uses unchanged.
 *
 * SORTING IS STILL NOT OFFERED, AND `ui/data-table.tsx` MAKES THAT A CHOICE
 * RATHER THAN AN OMISSION. TanStack Table can sort, and on this screen it would
 * sort the twenty-five rows in hand out of an unknown total — putting page two's
 * alphabetically-first name nowhere near the top under a header claiming
 * otherwise. On a cursor-paginated list the sort belongs in the request, which
 * is a contract question. Every column below therefore declares
 * `enableSorting: false`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Button,
  buttonVariants,
  DataTable,
  Input,
  NotRecorded,
  Pagination,
  Panel,
  SegmentedControl,
  Select,
  SkeletonRows,
  StateBlock,
  type DataTableColumn,
} from '@dudo/ui';
import { StatusBadge, TypeTag } from '@/components/CustomerBadges';
import { ErrorBlock } from '@/components/ErrorBlock';
import { LIMITS } from '@/contracts/field-rules';
import type { CustomerSummary, StatusFilter } from '@/contracts/customer-directory';
import { useAuthorizedBusinesses, useCustomerList } from '@/lib/queries';
import { makeBusinessLabeller } from '@/lib/business-label';
import { businessLabel } from '@/contracts/business-read';
import { setLastListSearch } from '@/lib/last-list';
import { DEFAULT_STATUS, tidySearch, type CustomerListSearch } from '@/routes/customer-list-search';

const SEARCH_DEBOUNCE_MS = 260;

/**
 * The three the tab strip offers.
 *
 * `pending_deletion` is a legal filter the schema accepts from the URL and this
 * strip does not offer, because nothing in this slice can produce that state.
 * When it arrives, no tab is pressed — which is the honest rendering of a URL
 * asking for something the strip has no button for.
 */
const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
] as const satisfies readonly { value: StatusFilter; label: string }[];

/**
 * Cursor trail.
 *
 * Cursor pagination only moves forward, so "Previous" is served by remembering
 * the cursors already issued for this exact filter combination. Changing any
 * filter starts a new trail, because a page 2 under different filters is not
 * page 2 — which is also why the contract rejects a cursor whose filters do not
 * match the request.
 */
let trail: { key: string | null; cursors: (string | null)[] } = { key: null, cursors: [null] };

function trailIndexFor(key: string, cursor: string | null): number {
  if (trail.key !== key) trail = { key, cursors: [null] };
  let index = trail.cursors.indexOf(cursor);
  if (index === -1) {
    trail.cursors.push(cursor);
    index = trail.cursors.length - 1;
  }
  return index;
}

export function CustomerList({ search }: { search: CustomerListSearch }) {
  const navigate = useNavigate();

  const searchTerm = search.q ?? '';
  const status = search.status ?? DEFAULT_STATUS;
  const businessId = search.business ?? '';
  const cursor = search.cursor ?? '';
  const searching = searchTerm.trim().length >= LIMITS.search_query.min;

  useEffect(() => {
    document.title = 'Customers · Dudo';
  }, []);

  // Remember the directory the person was looking at, so a record's back link
  // returns to the filtered list rather than to the top of the directory.
  useEffect(() => {
    setLastListSearch(tidySearch(search));
  }, [search]);

  // The authorized set fills the Business filter and labels every row. An empty
  // set is valid and is simply a filter with no options — the directory itself
  // still renders, because a principal's Business authorization and the
  // customers it can see are answered by different Actions.
  const { businesses } = useAuthorizedBusinesses();
  const businessName = useMemo(() => makeBusinessLabeller(businesses), [businesses]);

  const pageIndex = trailIndexFor(`${searchTerm}|${status}|${businessId}`, cursor || null);

  const listQuery = useCustomerList({
    status,
    businessId: businessId || undefined,
    cursor: cursor || undefined,
    query: searching ? searchTerm.trim() : undefined,
  });

  const rows = listQuery.data?.data ?? null;
  const nextCursor = listQuery.data?.next_cursor ?? null;
  const loading = listQuery.isPending;
  const error = listQuery.error ?? null;

  // The box is local state so typing is never gated on a round trip; the address
  // catches up on a debounce.
  const [draft, setDraft] = useState(searchTerm);
  useEffect(() => setDraft(searchTerm), [searchTerm]);

  const debounceRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  /**
   * Every change to the directory's state is a navigation, which is the point of
   * putting it in the URL: filter, open a record, press Back, and the list you
   * return to is the one you left.
   *
   * `replace` is used for the debounced search term so that typing eight
   * characters leaves one history entry rather than eight.
   */
  function go(changes: Partial<CustomerListSearch>, replace = false) {
    void navigate({
      to: '/customers',
      search: tidySearch({ q: searchTerm, status, business: businessId, cursor, ...changes }),
      replace,
    });
  }

  function onSearchChange(value: string) {
    setDraft(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      go({ q: value.trim(), cursor: '' }, true);
    }, SEARCH_DEBOUNCE_MS);
  }

  const columns = useMemo<DataTableColumn<CustomerSummary>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableSorting: false,
        meta: { placement: 'primary' },
        cell: ({ row }) => (
          <Link
            to="/customers/$customerId"
            params={{ customerId: row.original.customer_id }}
            className="text-base font-semibold text-navy-800 no-underline [overflow-wrap:anywhere] hover:underline hover:underline-offset-2"
          >
            {row.original.display_name}
          </Link>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        enableSorting: false,
        meta: { label: 'Type' },
        cell: ({ row }) => <TypeTag type={row.original.customer_type} />,
      },
      {
        id: 'email',
        header: 'Email',
        enableSorting: false,
        meta: { label: 'Email', truncate: true },
        cell: ({ row }) =>
          row.original.email ? (
            <span title={row.original.email} className="text-ink-muted">
              {row.original.email}
            </span>
          ) : (
            <NotRecorded />
          ),
      },
      {
        id: 'phone',
        header: 'Phone',
        enableSorting: false,
        meta: { label: 'Phone', nowrap: true },
        cell: ({ row }) =>
          row.original.phone ? (
            /*
             * `dir="ltr"` is required, not decorative. A phone number begins
             * with a neutral "+", so in an RTL document the bidi algorithm
             * reorders the groups and "+973 3901 2244" is displayed as
             * "2244 3901 973+". Marking the value LTR pins it. Verified by
             * rendering the directory with dir="rtl".
             */
            <span dir="ltr" className="tabular-nums text-ink-muted">
              {row.original.phone}
            </span>
          ) : (
            <NotRecorded />
          ),
      },
      {
        id: 'business',
        header: 'Business',
        enableSorting: false,
        meta: { label: 'Business', truncate: true },
        cell: ({ row }) => (
          <span title={businessName(row.original.business_id)} className="text-ink-muted">
            {businessName(row.original.business_id)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        meta: { placement: 'trailing' },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [businessName],
  );

  const announcement = loading
    ? 'Loading customers.'
    : error
      ? 'The customer list could not be loaded.'
      : rows && rows.length > 0
        ? searching
          ? `${rows.length} ${rows.length === 1 ? 'customer' : 'customers'} match ${searchTerm.trim()}.`
          : `Showing ${rows.length} ${rows.length === 1 ? 'customer' : 'customers'}.`
        : searching
          ? `No customers match ${searchTerm.trim()}.`
          : 'No customers to show.';

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl leading-tight tracking-[-0.01em] text-navy-800 [overflow-wrap:anywhere]">
            Customers
          </h1>
          <p className="mt-1 text-ink-muted">{subtitleFor(status, searching)}</p>
        </div>
        <Link to="/customers/new" className={buttonVariants({ variant: 'primary' })}>
          New customer
        </Link>
      </div>

      <div className="grid gap-3 rounded-t-xl border border-b-0 border-line bg-surface p-4">
        <div className="grid gap-2">
          <label htmlFor="directory-search" className="sr-only">
            Search customers
          </label>
          <div className="relative">
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 16 16"
              fill="none"
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <Input
              id="directory-search"
              type="search"
              value={draft}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && draft !== '') {
                  event.preventDefault();
                  onSearchChange('');
                }
              }}
              placeholder="Search name, email or phone"
              autoComplete="off"
              spellCheck={false}
              maxLength={LIMITS.search_query.max}
              aria-describedby="directory-search-hint"
              className="min-h-11 ps-9"
            />
          </div>
          <p id="directory-search-hint" className="text-[0.8125rem] text-ink-muted">
            {draft.trim().length === 1
              ? `Type at least ${LIMITS.search_query.min} characters to search.`
              : 'Searches name, email and phone. Notes and address are not searched.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Filter by status"
            options={STATUS_TABS}
            value={status}
            onChange={(value) => go({ status: value, cursor: '' })}
          />

          <div className="flex items-center gap-2">
            <label htmlFor="directory-business" className="text-[0.8125rem] font-semibold text-ink-soft">
              Business
            </label>
            <Select
              id="directory-business"
              value={businessId}
              onChange={(event) => go({ business: event.target.value, cursor: '' })}
              className="min-h-8.5 w-auto min-w-48 text-[0.8125rem]"
            >
              <option value="">All my Businesses</option>
              {businesses.map((business) => (
                <option key={business.business_id} value={business.business_id}>
                  {/* Null name renders as the identifier, verbatim — the
                      contract's normative rendering rule, binding on both
                      clients. */}
                  {businessLabel(business)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <Panel className="rounded-t-none">
        {loading ? (
          <SkeletonRows />
        ) : error ? (
          <ErrorBlock
            error={error}
            onRetry={() => void listQuery.refetch()}
            extraActions={
              cursor ? (
                <Button onClick={() => go({ cursor: '' })}>Back to the first page</Button>
              ) : null
            }
          />
        ) : rows && rows.length > 0 ? (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.customer_id}
            columnWidths={['26%', '9%', '25%', '15%', '16%', '9%']}
            onRowActivate={(row) => {
              // Convenience only. Every row is already reachable by its name
              // link, so nothing here is the sole route to a record.
              void navigate({
                to: '/customers/$customerId',
                params: { customerId: row.customer_id },
              });
            }}
          />
        ) : (
          <EmptyState
            searching={searching}
            searchTerm={searchTerm.trim()}
            status={status}
            businessId={businessId}
            businessName={businessName}
            go={go}
          />
        )}
      </Panel>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {!loading && !error && rows && rows.length > 0 ? (
        <Pagination
          label="Directory pages"
          noun={{ one: 'customer', many: 'customers' }}
          shown={rows.length}
          pageIndex={pageIndex}
          hasPrevious={pageIndex > 0}
          hasNext={Boolean(nextCursor)}
          onPrevious={() => go({ cursor: trail.cursors[pageIndex - 1] ?? '' })}
          onNext={() => go({ cursor: nextCursor ?? '' })}
        />
      ) : null}
    </div>
  );
}

function subtitleFor(status: StatusFilter, searching: boolean): string {
  if (searching) return 'Search results across the Businesses you can see.';
  if (status === 'archived') return 'Archived customers, kept indefinitely and withdrawn from everyday use.';
  if (status === 'pending_deletion') return 'Customers scheduled for permanent deletion.';
  if (status === 'all') return 'Every customer, whatever its status.';
  return 'The people and companies you do business with.';
}

function EmptyState({
  searching,
  searchTerm,
  status,
  businessId,
  businessName,
  go,
}: {
  searching: boolean;
  searchTerm: string;
  status: StatusFilter;
  businessId: string;
  businessName: (id: string) => string;
  go: (changes: Partial<CustomerListSearch>) => void;
}) {
  if (searching) {
    return (
      <StateBlock
        glyph="?"
        title={`Nothing matches “${searchTerm}”`}
        body={
          <>
            <p>
              Dudo searches the name, the email address and the phone number. Notes and addresses
              are deliberately not searched.
            </p>
            <p className="text-[0.8125rem] text-ink-faint">
              Names match from the start of each word; phone numbers match on the last digits.
            </p>
          </>
        }
        actions={
          <>
            <Button onClick={() => go({ q: '', cursor: '' })}>Clear the search</Button>
            {status !== 'all' ? (
              <Button variant="ghost" onClick={() => go({ status: 'all', cursor: '' })}>
                Search every status
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  if (status === 'archived') {
    return (
      <StateBlock
        title="No archived customers"
        body="Archiving withdraws a customer from everyday use without deleting anything. Archived records are kept indefinitely."
        actions={<Button onClick={() => go({ status: 'active', cursor: '' })}>Show active customers</Button>}
      />
    );
  }

  if (businessId) {
    return (
      <StateBlock
        title={`No customers in ${businessName(businessId)}`}
        body="This Business has no customers in the selected status."
        actions={<Button onClick={() => go({ business: '', cursor: '' })}>Show all my Businesses</Button>}
      />
    );
  }

  return (
    <StateBlock
      glyph="+"
      title="No customers yet"
      body="This is where the people and companies you do business with will be listed. Add the first one to get started."
      actions={
        <Link to="/customers/new" className={buttonVariants({ variant: 'primary' })}>
          New customer
        </Link>
      }
    />
  );
}
