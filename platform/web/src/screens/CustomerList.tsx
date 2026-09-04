/**
 * The customer directory — the main screen.
 *
 * ListCustomers and SearchCustomers return the same row shape, so this screen
 * renders one table and swaps which Action fills it. That is deliberate: the
 * two Actions differ in how the candidate set is chosen, never in what a row
 * looks like.
 *
 * WHAT IS SEARCHED, AND WHAT IS NOT. display_name, email and phone. Notes and
 * address are not searchable, by contract (README §7.1) — making free-text
 * notes searchable would turn an arbitrary phrase into a probe over the most
 * sensitive field in the record, and hand back through the search box what the
 * list projection withholds. The empty state says so, so nobody concludes the
 * search is broken.
 *
 * NO TOTAL COUNT is shown anywhere. The contract returns none and the reason is
 * tenant isolation rather than performance. "Showing 25 customers" is true;
 * "25 of 247" is not available and is not invented here.
 *
 * One thing React genuinely improves over the zero-dependency build: the search
 * box keeps focus and caret position for free, because filtering is a state
 * change rather than a re-render of the whole screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildHash, navigate, useLocation } from '@/lib/router';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge, TypeTag } from '@/components/ui/badge';
import { ErrorBlock, LoadingRows, Panel, StateBlock } from '@/components/StateBlock';
import { LIMITS } from '@/contracts/field-rules';
import { PAGE_SIZE_DEFAULT, type CustomerSummary, type StatusFilter } from '@/contracts/customer-directory';
import { toApiError, type ApiError } from '@/api/errors';
import type { CustomerDirectoryClient } from '@/api/client';
import { cn } from '@/lib/cn';

const SEARCH_DEBOUNCE_MS = 260;

const STATUS_TABS: { value: Extract<StatusFilter, 'active' | 'archived' | 'all'>; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

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

export function CustomerList({ client }: { client: CustomerDirectoryClient }) {
  const { query } = useLocation();

  const searchTerm = query.q ?? '';
  const status = (STATUS_TABS.find((t) => t.value === query.status)?.value ?? 'active') as StatusFilter;
  const businessId = query.business ?? '';
  const cursor = query.cursor ?? '';

  const businesses = useMemo(() => client.listBusinesses(), [client]);
  const searching = searchTerm.trim().length >= LIMITS.search_query.min;

  const pageIndex = trailIndexFor(`${searchTerm}|${status}|${businessId}`, cursor || null);

  const [rows, setRows] = useState<CustomerSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  // The box is local state so typing is never gated on a round trip; the
  // address catches up on a debounce.
  const [draft, setDraft] = useState(searchTerm);
  useEffect(() => setDraft(searchTerm), [searchTerm]);

  const debounceRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  function go(changes: Partial<Record<'q' | 'status' | 'business' | 'cursor', string>>, replace = false) {
    navigate(
      '/customers',
      {
        q: changes.q ?? searchTerm,
        status: changes.status ?? status,
        business: changes.business ?? businessId,
        cursor: changes.cursor ?? cursor,
      },
      { replace },
    );
  }

  function onSearchChange(value: string) {
    setDraft(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      go({ q: value.trim(), cursor: '' }, true);
    }, SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const request = {
      status,
      business_id: businessId || undefined,
      page_size: PAGE_SIZE_DEFAULT,
      cursor: cursor || undefined,
    };

    const promise = searching
      ? client.searchCustomers({ ...request, query: searchTerm.trim() })
      : client.listCustomers(request);

    promise
      .then((response) => {
        if (cancelled) return;
        setRows(response.data);
        setNextCursor(response.next_cursor);
      })
      .catch((thrown) => {
        if (cancelled) return;
        setRows(null);
        setError(toApiError(thrown));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, searchTerm, searching, status, businessId, cursor, reloadNonce]);

  function businessName(id: string): string {
    // Falls back to the identifier rather than to a blank: the Business name
    // has no contract behind it, so the true value is the one on the wire.
    return businesses.find((b) => b.business_id === id)?.display_name ?? id;
  }

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
        <ButtonLink variant="primary" href="#/customers/new">
          New customer
        </ButtonLink>
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
          <div role="group" aria-label="Filter by status" className="inline-flex rounded-[7px] border border-line bg-sunk p-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={tab.value === status}
                onClick={() => go({ status: tab.value, cursor: '' })}
                className={cn(
                  'min-h-7.5 cursor-pointer rounded-sm border-0 px-3 py-1 text-[0.8125rem] font-semibold',
                  tab.value === status
                    ? 'bg-surface text-navy-800 shadow-[var(--shadow-card)]'
                    : 'bg-transparent text-ink-muted hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

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
                  {business.display_name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <Panel className="rounded-t-none">
        {loading ? (
          <LoadingRows />
        ) : error ? (
          <ErrorBlock
            error={error}
            onRetry={() => setReloadNonce((n) => n + 1)}
            extraActions={
              cursor ? (
                <Button onClick={() => go({ cursor: '' })}>Back to the first page</Button>
              ) : null
            }
          />
        ) : rows && rows.length > 0 ? (
          <DirectoryTable rows={rows} businessName={businessName} />
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
        <Pager
          shown={rows.length}
          pageIndex={pageIndex}
          nextCursor={nextCursor}
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
  if (status === 'all') return 'Every customer, whatever its status.';
  return 'The people and companies you do business with.';
}

/**
 * A real `<table>` at desktop widths for row/column semantics, becoming a stack
 * of record cards below 55rem. The column labels are real DOM rather than CSS
 * pseudo-content, so nothing is lost from the accessibility tree when the
 * header row disappears.
 */
function DirectoryTable({
  rows,
  businessName,
}: {
  rows: CustomerSummary[];
  businessName: (id: string) => string;
}) {
  return (
    <table className="directory">
      <colgroup>
        <col style={{ width: '26%' }} />
        <col style={{ width: '9%' }} />
        <col style={{ width: '25%' }} />
        <col style={{ width: '15%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '9%' }} />
      </colgroup>
      <thead>
        <tr>
          {['Name', 'Type', 'Email', 'Phone', 'Business', 'Status'].map((heading) => (
            <th key={heading} scope="col">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.customer_id} row={row} businessName={businessName} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row, businessName }: { row: CustomerSummary; businessName: (id: string) => string }) {
  const href = buildHash(`/customers/${encodeURIComponent(row.customer_id)}`);

  return (
    <tr
      onClick={(event) => {
        // Convenience only. Every row is already reachable by its name link, so
        // nothing here is the sole route to a record.
        if ((event.target as HTMLElement).closest('a, button')) return;
        if (window.getSelection()?.toString()) return;
        window.location.hash = href.replace(/^#/, '');
      }}
    >
      <Cell area="name">
        <a
          href={href}
          className="cell-value text-base font-semibold text-navy-800 no-underline [overflow-wrap:anywhere] hover:underline hover:underline-offset-2"
        >
          {row.display_name}
        </a>
      </Cell>
      <Cell area="type" label="Type">
        <TypeTag type={row.customer_type} className="cell-value" />
      </Cell>
      <Cell area="email" label="Email">
        {row.email ? (
          <span title={row.email} className="cell-value text-ink-muted">
            {row.email}
          </span>
        ) : (
          <NotRecorded />
        )}
      </Cell>
      <Cell area="phone" label="Phone">
        {row.phone ? (
          // `dir="ltr"` is required, not decorative. A phone number begins with
          // a neutral "+", so in an RTL document the bidi algorithm reorders the
          // groups and "+973 3901 2244" is displayed as "2244 3901 973+".
          // Marking the value LTR pins it. Verified by rendering the directory
          // with dir="rtl".
          <span dir="ltr" className="cell-value tabular-nums text-ink-muted">
            {row.phone}
          </span>
        ) : (
          <NotRecorded />
        )}
      </Cell>
      <Cell area="business" label="Business">
        <span title={businessName(row.business_id)} className="cell-value text-ink-muted">
          {businessName(row.business_id)}
        </span>
      </Cell>
      <Cell area="status">
        <StatusBadge status={row.status} className="cell-value" />
      </Cell>
    </tr>
  );
}

/**
 * The placement classes are plain CSS in styles/index.css — see the `.directory`
 * component layer. The card layout below 55rem changes `display` on five
 * elements and re-places two of them on a grid, which is clearer as CSS than as
 * a stack of arbitrary variants.
 */
function Cell({ area, label, children }: { area: string; label?: string; children: React.ReactNode }) {
  return (
    <td className={`cell-${area}`}>
      {label ? (
        <span aria-hidden="true" className="cell-label">
          {label}
        </span>
      ) : null}
      {children}
    </td>
  );
}

function NotRecorded() {
  return (
    <span aria-label="Not recorded" className="cell-value text-ink-faint">
      —
    </span>
  );
}

function Pager({
  shown,
  pageIndex,
  nextCursor,
  onPrevious,
  onNext,
}: {
  shown: number;
  pageIndex: number;
  nextCursor: string | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const hasPrevious = pageIndex > 0;
  const hasNext = Boolean(nextCursor);
  const noun = shown === 1 ? 'customer' : 'customers';

  if (!hasPrevious && !hasNext) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-muted">
          Showing {shown} {noun}.
        </p>
      </div>
    );
  }

  return (
    <nav aria-label="Directory pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[0.8125rem] text-ink-muted">
        Page {pageIndex + 1} · showing {shown} {noun}
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
  go: (changes: Partial<Record<'q' | 'status' | 'business' | 'cursor', string>>) => void;
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
        <ButtonLink variant="primary" href="#/customers/new">
          New customer
        </ButtonLink>
      }
    />
  );
}
