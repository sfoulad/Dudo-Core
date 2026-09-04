/**
 * The customer directory — the main screen.
 *
 * ListCustomers and SearchCustomers return the same row shape, so this screen
 * renders one table and swaps which Action fills it. That is deliberate: the
 * two Actions differ in how the candidate set is chosen, never in what a row
 * looks like.
 *
 * WHAT IS SEARCHED, AND WHAT IS NOT. display_name, email and phone. Notes and
 * address are not searchable, by contract (README.md §7.1) — making free-text
 * notes searchable would turn an arbitrary phrase into a probe over the most
 * sensitive field in the record, and hand back through the search box what the
 * list projection withholds. The empty state says so, so nobody concludes the
 * search is broken.
 *
 * NO TOTAL COUNT is shown, anywhere. The contract returns none, and the reason
 * is tenant isolation rather than performance. "Showing 25 customers" is true;
 * "25 of 247" is not available and is not invented here.
 */

import { el, iconSearch, restoreFocusById } from '../dom.js';
import { navigate, buildHash } from '../router.js';
import { statusBadge, typeTag, loadingRows, stateBlock, errorBlock } from '../ui/components.js';
import { LIMITS, PAGE_SIZE_DEFAULT } from '../domain/field-rules.js';
import { isApiError } from '../api/errors.js';
import { setLastListHash } from './list-state.js';

const SEARCH_DEBOUNCE_MS = 260;

const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

/**
 * Cursor trail.
 *
 * Cursor pagination can only move forward, so "Previous" is served by
 * remembering the cursors already issued for this exact filter combination.
 * Changing any filter starts a new trail, because a page 2 under different
 * filters is not page 2 — which is also why the contract rejects a cursor
 * whose filters do not match the request.
 */
let trail = { key: null, cursors: [null] };

function trailFor(key, cursor) {
  if (trail.key !== key) trail = { key, cursors: [null] };
  const normalised = cursor || null;
  let index = trail.cursors.indexOf(normalised);
  if (index === -1) {
    trail.cursors.push(normalised);
    index = trail.cursors.length - 1;
  }
  return index;
}

export function renderCustomerList(ctx) {
  const { client, shell } = ctx;
  const query = ctx.query || {};

  const searchTerm = query.q || '';
  const status = STATUS_TABS.some((tab) => tab.value === query.status) ? query.status : 'active';
  const businessId = query.business || '';
  const cursor = query.cursor || '';
  const filterKey = `${searchTerm}|${status}|${businessId}`;
  const pageIndex = trailFor(filterKey, cursor);

  const businesses = client.listBusinesses();

  /* ---------------------------------------------------------------- chrome */

  const results = el('div', { id: 'directory-results' });
  const announcer = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const pager = el('div', { id: 'directory-pager' });

  const searchInput = el('input', {
    class: 'input',
    id: 'directory-search',
    type: 'search',
    name: 'q',
    value: searchTerm,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Search name, email or phone',
    'aria-describedby': 'directory-search-hint',
    maxlength: String(LIMITS.search_query.max),
  });

  const searchHint = el('p', {
    class: 'field__hint',
    id: 'directory-search-hint',
    text: 'Searches name, email and phone. Notes and address are not searched.',
  });

  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    const value = searchInput.value;
    const trimmed = value.trim();

    // A one-character query is below the contract's minimum, so no search is
    // sent for it — the directory falls back to an unfiltered listing and the
    // hint says why. The typed character is kept, because deleting what
    // someone is in the middle of typing is worse than showing them the list
    // they had a moment ago.
    searchHint.textContent = trimmed.length === 1
      ? `Type at least ${LIMITS.search_query.min} characters to search.`
      : 'Searches name, email and phone. Notes and address are not searched.';

    debounceTimer = window.setTimeout(() => {
      goto({ q: trimmed, cursor: '' }, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && searchInput.value !== '') {
      event.preventDefault();
      searchInput.value = '';
      window.clearTimeout(debounceTimer);
      goto({ q: '', cursor: '' }, { replace: true });
    }
  });

  function goto(changes, options) {
    navigate('/customers', {
      q: 'q' in changes ? changes.q : searchTerm,
      status: 'status' in changes ? changes.status : status,
      business: 'business' in changes ? changes.business : businessId,
      cursor: 'cursor' in changes ? changes.cursor : cursor,
    }, options);
  }

  const statusControl = el('div', {
    class: 'segmented',
    role: 'group',
    'aria-label': 'Filter by status',
  }, STATUS_TABS.map((tab) => el('button', {
    class: 'segmented__btn',
    id: `status-tab-${tab.value}`,
    type: 'button',
    text: tab.label,
    'aria-pressed': String(tab.value === status),
    on: { click: () => goto({ status: tab.value, cursor: '' }) },
  })));

  const businessSelect = el('select', {
    class: 'select',
    id: 'directory-business',
    on: { change: () => goto({ business: businessSelect.value, cursor: '' }) },
  },
  el('option', { value: '', text: 'All my Businesses', selected: businessId === '' }),
  businesses.map((business) => el('option', {
    value: business.business_id,
    text: business.display_name,
    selected: business.business_id === businessId,
  })));

  const toolbar = el('div', { class: 'toolbar' },
    el('div', { class: 'field' },
      el('label', { class: 'sr-only', for: 'directory-search', text: 'Search customers' }),
      el('div', { class: 'toolbar__search' },
        iconSearch('toolbar__search-icon'),
        searchInput),
      searchHint),
    el('div', { class: 'toolbar__filters' },
      statusControl,
      el('div', { class: 'toolbar__business' },
        el('label', { class: 'field__label', for: 'directory-business', text: 'Business' }),
        businessSelect)));

  const page = el('div', {},
    el('div', { class: 'page-head' },
      el('div', { class: 'page-head__text' },
        el('h1', { class: 'page-title', text: 'Customers' }),
        el('p', { class: 'page-subtitle', text: subtitleFor(status, searchTerm) })),
      el('div', { class: 'record-actions' },
        el('a', { class: 'btn btn--primary', href: '#/customers/new' }, 'New customer'))),
    toolbar,
    results,
    announcer,
    pager);

  setLastListHash(buildHash('/customers', { q: searchTerm, status, business: businessId, cursor }));

  shell.render(page, { title: 'Customers', preserveFocus: Boolean(ctx.restoreFocusId) });

  // A filter change or a debounced keystroke re-renders this whole screen.
  // Focus goes back to the control the person was using, so typing a search
  // term does not eject the caret on every keystroke and changing a filter
  // does not drop a keyboard user back at the top of the page.
  restoreFocusById(ctx.restoreFocusId);

  /* ----------------------------------------------------------------- fetch */

  load();

  async function load() {
    results.replaceChildren(loadingRows());
    pager.replaceChildren();
    shell.setBusy(true);
    announcer.textContent = 'Loading customers.';

    const request = {
      status,
      business_id: businessId || undefined,
      page_size: PAGE_SIZE_DEFAULT,
      cursor: cursor || undefined,
    };

    try {
      const response = searchTerm.trim().length >= LIMITS.search_query.min
        ? await client.searchCustomers({ ...request, query: searchTerm.trim() })
        : await client.listCustomers(request);

      renderResults(response);
    } catch (thrown) {
      const error = isApiError(thrown) ? thrown : null;
      results.replaceChildren(el('div', { class: 'panel panel--attached' },
        errorBlock(error || { code: 'internal' }, {
          onRetry: load,
          extraActions: cursor
            ? [el('button', {
              class: 'btn btn--secondary',
              type: 'button',
              text: 'Back to the first page',
              on: { click: () => goto({ cursor: '' }) },
            })]
            : [],
        })));
      announcer.textContent = 'The customer list could not be loaded.';
    } finally {
      shell.setBusy(false);
    }
  }

  function renderResults(response) {
    const rows = response.data || [];
    const searching = searchTerm.trim().length >= LIMITS.search_query.min;

    if (rows.length === 0) {
      results.replaceChildren(el('div', { class: 'panel panel--attached' }, emptyState()));
      announcer.textContent = searching
        ? `No customers match ${searchTerm.trim()}.`
        : 'No customers to show.';
      return;
    }

    results.replaceChildren(el('div', { class: 'panel panel--attached' }, directoryTable(rows)));

    const noun = rows.length === 1 ? 'customer' : 'customers';
    announcer.textContent = searching
      ? `${rows.length} ${noun} match ${searchTerm.trim()}.`
      : `Showing ${rows.length} ${noun}.`;

    renderPager(rows.length, response.next_cursor);
  }

  function directoryTable(rows) {
    return el('table', { class: 'directory' },
      el('colgroup', {},
        el('col', { class: 'col-name' }),
        el('col', { class: 'col-type' }),
        el('col', { class: 'col-email' }),
        el('col', { class: 'col-phone' }),
        el('col', { class: 'col-business' }),
        el('col', { class: 'col-status' })),
      el('thead', {},
        el('tr', {},
          el('th', { scope: 'col', text: 'Name' }),
          el('th', { scope: 'col', text: 'Type' }),
          el('th', { scope: 'col', text: 'Email' }),
          el('th', { scope: 'col', text: 'Phone' }),
          el('th', { scope: 'col', text: 'Business' }),
          el('th', { scope: 'col', text: 'Status' }))),
      el('tbody', {}, rows.map((row) => customerRow(row))));
  }

  function customerRow(row) {
    const href = buildHash(`/customers/${encodeURIComponent(row.customer_id)}`);

    const tr = el('tr', {},
      el('td', { class: 'cell-name' },
        el('a', { class: 'cell-name__link', href, text: row.display_name })),
      cell('cell-type', 'Type', typeTag(row.customer_type)),
      cell('cell-email', 'Email', row.email
        ? el('span', { class: 'cell-muted', text: row.email, title: row.email })
        : notRecorded()),
      cell('cell-phone', 'Phone', row.phone
        ? el('span', { class: 'cell-muted cell-tabular', text: row.phone })
        : notRecorded()),
      cell('cell-business', 'Business',
        el('span', {
          class: 'cell-muted',
          text: businessName(row.business_id),
          title: businessName(row.business_id),
        })),
      cell('cell-status', 'Status', statusBadge(row.status)));

    // Convenience only. Every row is already reachable by its name link, so
    // nothing here is the sole route to a record.
    tr.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      if (window.getSelection()?.toString()) return;
      window.location.hash = href.replace(/^#/, '');
    });

    return tr;
  }

  function cell(className, label, content) {
    return el('td', { class: className },
      el('span', { class: 'cell__label', 'aria-hidden': 'true', text: label }),
      content);
  }

  function notRecorded() {
    return el('span', { class: 'cell-empty', text: '—', 'aria-label': 'Not recorded' });
  }

  function businessName(id) {
    const found = businesses.find((business) => business.business_id === id);
    // Falls back to the identifier rather than to a blank: the Business name
    // has no contract behind it, so the true value is the one that is on the
    // wire.
    return found ? found.display_name : id;
  }

  function renderPager(shown, nextCursor) {
    const hasPrevious = pageIndex > 0;
    const hasNext = Boolean(nextCursor);
    if (!hasPrevious && !hasNext) {
      pager.replaceChildren(el('div', { class: 'pager' },
        el('p', { class: 'pager__status', text: `Showing ${shown} ${shown === 1 ? 'customer' : 'customers'}.` })));
      return;
    }

    pager.replaceChildren(el('nav', { class: 'pager', 'aria-label': 'Directory pages' },
      el('p', {
        class: 'pager__status',
        text: `Page ${pageIndex + 1} · showing ${shown} ${shown === 1 ? 'customer' : 'customers'}`,
      }),
      el('div', { class: 'pager__buttons' },
        el('button', {
          class: 'btn btn--secondary btn--sm',
          id: 'pager-previous',
          type: 'button',
          text: 'Previous',
          disabled: !hasPrevious,
          on: { click: () => goto({ cursor: trail.cursors[pageIndex - 1] || '' }) },
        }),
        el('button', {
          class: 'btn btn--secondary btn--sm',
          id: 'pager-next',
          type: 'button',
          text: 'Next',
          disabled: !hasNext,
          on: { click: () => goto({ cursor: nextCursor }) },
        }))));

    // The pager arrives after the fetch resolves, so it misses the focus
    // restoration that ran when the screen was first drawn.
    restoreFocusById(ctx.restoreFocusId);
  }

  function emptyState() {
    if (searchTerm.trim().length >= LIMITS.search_query.min) {
      return stateBlock({
        glyph: '?',
        title: `Nothing matches “${searchTerm.trim()}”`,
        body: el('div', { class: 'state__body' },
          el('p', { text: 'Dudo searches the name, the email address and the phone number. Notes and addresses are deliberately not searched.' }),
          el('p', { class: 'state__note', text: 'Names match from the start of each word; phone numbers match on the last digits.' })),
        actions: [
          el('button', {
            class: 'btn btn--secondary',
            type: 'button',
            text: 'Clear the search',
            on: { click: () => goto({ q: '', cursor: '' }) },
          }),
          status !== 'all'
            ? el('button', {
              class: 'btn btn--ghost',
              type: 'button',
              text: 'Search every status',
              on: { click: () => goto({ status: 'all', cursor: '' }) },
            })
            : null,
        ].filter(Boolean),
      });
    }

    if (status === 'archived') {
      return stateBlock({
        glyph: '·',
        title: 'No archived customers',
        body: 'Archiving withdraws a customer from everyday use without deleting anything. Archived records are kept indefinitely.',
        actions: [el('button', {
          class: 'btn btn--secondary',
          type: 'button',
          text: 'Show active customers',
          on: { click: () => goto({ status: 'active', cursor: '' }) },
        })],
      });
    }

    if (businessId) {
      return stateBlock({
        glyph: '·',
        title: `No customers in ${businessName(businessId)}`,
        body: 'This Business has no customers in the selected status.',
        actions: [el('button', {
          class: 'btn btn--secondary',
          type: 'button',
          text: 'Show all my Businesses',
          on: { click: () => goto({ business: '', cursor: '' }) },
        })],
      });
    }

    return stateBlock({
      glyph: '+',
      title: 'No customers yet',
      body: 'This is where the people and companies you do business with will be listed. Add the first one to get started.',
      actions: [el('a', { class: 'btn btn--primary', href: '#/customers/new' }, 'New customer')],
    });
  }
}

function subtitleFor(status, searchTerm) {
  // A term below the contract's two-character minimum is not a search, and
  // the page should not claim to be showing search results for it.
  if (searchTerm.trim().length >= LIMITS.search_query.min) {
    return 'Search results across the Businesses you can see.';
  }
  if (status === 'archived') return 'Archived customers, kept indefinitely and withdrawn from everyday use.';
  if (status === 'all') return 'Every customer, whatever its status.';
  return 'The people and companies you do business with.';
}
