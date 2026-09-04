/**
 * The fixture transport.
 *
 * WHAT THIS IS. A stand-in for Core that answers the eight in-scope Actions
 * from memory. It exists because nothing authenticates yet and no deployment
 * exists, so the client cannot make a network call — contract §11 item 1 (AZ2).
 *
 * WHAT IT IS NOT. It is not Core and it is not a source of truth. It implements
 * the contract's OBSERVABLE BEHAVIOUR so the screens can be built and judged
 * against real ordering, real cursors, real validation and real state-machine
 * refusals rather than against a happy path.
 *
 *   NO AUTHORIZATION IS PERFORMED HERE, AND NONE MAY BE READ INTO IT.
 *   Permission, tenant resolution and the authorized-business set are decided
 *   in platform/core/** on every call (security.md §2). This is a single
 *   Organization's data with no principal behind it. When the HTTP transport
 *   replaces it those answers arrive from the server and no screen changes.
 *
 * It implements the same `Transport` interface the HTTP transport will
 * implement. Replacing this file is the whole of the swap.
 *
 * State lives in memory for the life of the page. A reload restores the
 * fixtures, deliberately, so a demonstration always starts from a known set.
 */

import { FIXTURE_BUSINESSES, FIXTURE_CUSTOMERS } from './fixtures';
import { ApiError, type ErrorCode, type ErrorDetail } from './errors';
import { fixtureOrganizationSelected } from './fixture-session-state';
import { signalPreconditionFailed } from './session-signal';
import {
  validateField,
  normalise,
  digitsOf,
  LIMITS,
  type FieldIssue,
} from '../contracts/field-rules';
import {
  EDITABLE_FIELDS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  STATUS_FILTERS,
  type CollectionEnvelope,
  type Customer,
  type CustomerAction,
  type CustomerStatus,
  type CustomerSummary,
  type EditableField,
  type StatusFilter,
} from '../contracts/customer-directory';
import {
  RESOLVE_BATCH_MAX,
  type BusinessReference,
  type BusinessSummary,
  type CoreAction,
  type ResolveBusinessReferencesOutput,
} from '../contracts/business-read';

export type DudoAction = CustomerAction | CoreAction;

export interface Transport {
  readonly name: string;
  invoke(action: DudoAction, input?: Record<string, unknown>): Promise<unknown>;
}

/* -------------------------------------------------------------------------
   Latency and fault injection
   ------------------------------------------------------------------------- */

const LATENCY_MIN_MS = 140;
const LATENCY_MAX_MS = 380;

type FaultScope = 'list' | 'detail' | 'write' | 'all';

const faults: { scope: FaultScope | null; code: ErrorCode } = { scope: null, code: 'unavailable' };

/**
 * Deliberate fault injection so the error states can be SEEN rather than
 * described. Set from the URL: `?fault=list|detail|write|all` with an optional
 * `&faultCode=`. Nothing fails on its own — a directory that failed at random
 * would train people to click through real problems.
 */
export function configureFaults(scope: string | null, code?: string | null): void {
  faults.scope = (['list', 'detail', 'write', 'all'] as string[]).includes(scope ?? '')
    ? (scope as FaultScope)
    : null;
  if (code) faults.code = code as ErrorCode;
}

/**
 * A principal authorized over NO Business.
 *
 * This is not a hypothetical: the contract states it is what every principal
 * receives today, because Core ships a deny-all authorization source whose
 * authorized business set is empty for everyone. Both clients are required to
 * render it as a first-class state rather than as a loading failure, so it has
 * to be reachable to be demonstrated. Set from the URL: `?businesses=none`.
 */
let authorizedBusinessesEmpty = false;

export function configureBusinesses(mode: string | null): void {
  authorizedBusinessesEmpty = mode === 'none';
}

function authorizedBusinesses(): BusinessSummary[] {
  if (authorizedBusinessesEmpty) return [];
  return FIXTURE_BUSINESSES.map((business) => ({ ...business }));
}

const FAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  unavailable: 'The customers service did not respond.',
  internal: 'An unexpected condition was encountered.',
  timeout: 'The request exceeded the time budget.',
  forbidden: 'The principal does not hold customers.customer.list at a satisfying scope.',
  rate_limited: 'Request rate exceeded for this principal.',
};

function maybeFail(scope: Exclude<FaultScope, 'all'>): void {
  if (!faults.scope) return;
  if (faults.scope !== 'all' && faults.scope !== scope) return;
  throw error(faults.code, FAULT_MESSAGES[faults.code] ?? 'Injected fault.');
}

function delay(): Promise<void> {
  const ms = LATENCY_MIN_MS + Math.random() * (LATENCY_MAX_MS - LATENCY_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------
   Error envelope construction
   ------------------------------------------------------------------------- */

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function token(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

/** Every response carries a request id — success or error (API_STANDARD §11). */
function requestId(): string {
  return `req_${token(16)}`;
}

function error(code: ErrorCode, message: string, details?: ErrorDetail[]): ApiError {
  return new ApiError({ code, message, request_id: requestId(), details });
}

function invalid(message: string, details?: ErrorDetail[]): ApiError {
  return error('invalid_argument', message, details);
}

/* -------------------------------------------------------------------------
   The store
   ------------------------------------------------------------------------- */

let store: Customer[] = FIXTURE_CUSTOMERS.map((record) => ({ ...record }));

export function resetStore(): void {
  store = FIXTURE_CUSTOMERS.map((record) => ({ ...record }));
}

/**
 * FIXTURE ONLY. The real value is derived from the authenticated server-side
 * context and is never chosen by a client (contract §3 rule 2). It is named
 * here so `updated_by_principal_id` is not silently left stale, and it is one
 * of exactly two things that must be deleted when the HTTP transport lands.
 */
const FIXTURE_ACTING_PRINCIPAL = 'prc_local_fixture';

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/* -------------------------------------------------------------------------
   Ordering — README §8
   ------------------------------------------------------------------------- */

/**
 * Compare by Unicode code point, then by `customer_id`.
 *
 * The order is fixed and total, because a total order is what makes a cursor
 * correct: ordering on a non-unique field alone silently duplicates and skips
 * rows across pages. Comparison is by code point rather than with a locale
 * collator — the contract's order is code-point order, and it says plainly that
 * this is not locale-correct for Arabic or accented Latin (CD-6).
 */
function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const l = left[i]!.codePointAt(0)!;
    const r = right[i]!.codePointAt(0)!;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length - right.length;
}

function directoryOrder(a: Customer, b: Customer): number {
  const byName = compareCodePoints(normalise(a.display_name), normalise(b.display_name));
  if (byName !== 0) return byName;
  return compareCodePoints(a.customer_id, b.customer_id);
}

/* -------------------------------------------------------------------------
   Search matching — README §7.3
   ------------------------------------------------------------------------- */

function matchesQuery(record: Customer, rawQuery: string): boolean {
  const query = normalise(rawQuery);
  if (!query) return false;

  // display_name: every whitespace-delimited term must prefix some token.
  const terms = query.split(' ');
  const tokens = normalise(record.display_name).split(' ');
  if (terms.every((term) => tokens.some((tok) => tok.startsWith(term)))) return true;

  // email: the query is a prefix of the whole address.
  if (record.email && normalise(record.email).startsWith(query)) return true;

  // phone: digit-suffix, and only once the query has at least four digits.
  const queryDigits = digitsOf(query);
  if (queryDigits.length >= 4 && record.phone) {
    if (digitsOf(record.phone).endsWith(queryDigits)) return true;
  }

  // notes and address are NOT searchable, deliberately — README §7.1.
  return false;
}

/* -------------------------------------------------------------------------
   Cursor — README §8
   ------------------------------------------------------------------------- */

interface CursorPayload {
  a: string;
  s: StatusFilter;
  b: string | null;
  p: number;
}

/**
 * The cursor records the filters it was issued under so a mismatch can be
 * rejected. It never carries a tenant predicate: a page-2 request under
 * different filters is not page 2, and an input that decides its own scope is a
 * grant rather than an input.
 *
 * Base64url without padding, matching the pagination schema's
 * `^[A-Za-z0-9_-]{1,512}$`. Only ASCII goes in, so `btoa` is safe.
 */
function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded)) as CursorPayload;
    if (!payload || typeof payload.a !== 'string') throw new Error('shape');
    return payload;
  } catch {
    // Malformed, expired, forged, wrong-tenant and wrong-filter cursors all
    // return the SAME invalid_argument with the same detail token.
    // Distinguishing them tells a caller which of its guesses was closer.
    throw invalid('The cursor is not valid for this request.', [
      { field: 'cursor', issue: 'invalid_cursor' },
    ]);
  }
}

/* -------------------------------------------------------------------------
   Collections
   ------------------------------------------------------------------------- */

/**
 * The list projection. It deliberately excludes `address` and `notes` — that
 * exclusion is the point of `list` being a separate permission from `read`, and
 * copying the whole record into a row here would quietly undo it even though
 * this transport enforces no permission at all.
 */
function toSummary(record: Customer): CustomerSummary {
  return {
    customer_id: record.customer_id,
    business_id: record.business_id,
    display_name: record.display_name,
    customer_type: record.customer_type,
    email: record.email,
    phone: record.phone,
    country: record.country,
    status: record.status,
    deletion_scheduled_at: record.deletion_scheduled_at,
    updated_at: record.updated_at,
  };
}

function resolvePageSize(value: unknown): number {
  if (value === undefined || value === null) return PAGE_SIZE_DEFAULT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > PAGE_SIZE_MAX) {
    throw invalid('page_size must be a whole number between 1 and 100.', [
      { field: 'page_size', issue: 'out_of_range' },
    ]);
  }
  return value;
}

function resolveStatus(value: unknown): StatusFilter {
  if (value === undefined || value === null) return 'active';
  if (!(STATUS_FILTERS as readonly string[]).includes(value as string)) {
    throw invalid('status is not a permitted filter value.', [
      { field: 'status', issue: 'not_a_permitted_value' },
    ]);
  }
  return value as StatusFilter;
}

function statusMatches(record: Customer, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return record.status === (filter as CustomerStatus);
}

function collect(
  input: Record<string, unknown>,
  predicate: (record: Customer) => boolean,
): CollectionEnvelope<CustomerSummary> {
  const status = resolveStatus(input.status);
  const pageSize = resolvePageSize(input.page_size);
  const businessId = (input.business_id as string | undefined) ?? null;

  if (businessId !== null) {
    const issue = validateField('business_id', businessId);
    if (issue) throw invalid('business_id is not a valid identifier.', [issue]);
    // A business_id naming a Business of another Organization and one naming no
    // Business at all are indistinguishable: both are not_found. That is what
    // stops this call being a probe for another Organization's structure.
    if (!authorizedBusinesses().some((b) => b.business_id === businessId)) {
      throw error('not_found', 'No such Business.');
    }
  }

  let rows = store
    .filter((record) => statusMatches(record, status))
    .filter((record) => (businessId === null ? true : record.business_id === businessId))
    .filter(predicate)
    .sort(directoryOrder);

  if (typeof input.cursor === 'string' && input.cursor) {
    const payload = decodeCursor(input.cursor);
    if (payload.s !== status || (payload.b ?? null) !== businessId || payload.p !== pageSize) {
      throw invalid('The cursor is not valid for this request.', [
        { field: 'cursor', issue: 'invalid_cursor' },
      ]);
    }
    const index = rows.findIndex((record) => record.customer_id === payload.a);
    if (index === -1) {
      throw invalid('The cursor is not valid for this request.', [
        { field: 'cursor', issue: 'invalid_cursor' },
      ]);
    }
    rows = rows.slice(index + 1);
  }

  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ a: last.customer_id, s: status, b: businessId, p: pageSize })
      : null;

  // No total count. The absence is a tenant-isolation property of the contract,
  // not an oversight.
  return { data: page.map(toSummary), next_cursor: nextCursor };
}

/* -------------------------------------------------------------------------
   Record lookup
   ------------------------------------------------------------------------- */

function findOrThrow(customerId: unknown): Customer {
  const issue = validateField('customer_id', customerId as string, { required: true });
  if (issue) {
    // Step 4 of the GetCustomer denial paths: a malformed identifier fails
    // input validation before any lookup.
    throw invalid('customer_id is not a valid identifier.', [issue]);
  }
  const record = store.find((candidate) => candidate.customer_id === customerId);
  if (!record) {
    // Byte-identical for an identifier that exists nowhere and one belonging to
    // another Organization. No existence oracle.
    throw error('not_found', 'No such customer.');
  }
  return record;
}

/* -------------------------------------------------------------------------
   Write validation
   ------------------------------------------------------------------------- */

const REQUIRED_ON_CREATE = ['business_id', 'display_name', 'customer_type'];

function rejectUnknownFields(
  input: Record<string, unknown>,
  permitted: string[],
  actionLabel: string,
): void {
  const unknown = Object.keys(input).filter((key) => !permitted.includes(key));
  if (unknown.length) {
    // additionalProperties is false in the schema: unknown fields are REJECTED,
    // not ignored. That is what makes status, customer_id, organization_id and
    // business_id-on-update unsettable rather than merely undocumented.
    throw invalid(
      `${actionLabel} does not accept these fields.`,
      unknown.map((field) => ({ field, issue: 'unknown_field' })),
    );
  }
}

function validateWritable(input: Record<string, unknown>, requireAll: boolean): void {
  const details: FieldIssue[] = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) {
      if (requireAll && REQUIRED_ON_CREATE.includes(field)) {
        details.push({ field, issue: 'required' });
      }
      continue;
    }
    const value = input[field];
    if (value === null) {
      if (field === 'display_name' || field === 'customer_type') {
        details.push({ field, issue: 'required' });
      }
      continue;
    }
    const issue = validateField(field, value as string, {
      required: REQUIRED_ON_CREATE.includes(field),
    });
    if (issue) details.push(issue);
  }
  if (details.length) throw invalid('One or more fields were not accepted.', details);
}

function trimmedOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function replace(customerId: string, next: Customer): void {
  const index = store.findIndex((record) => record.customer_id === customerId);
  store[index] = next;
}

function transition(
  customerId: unknown,
  from: CustomerStatus,
  to: CustomerStatus,
  refusal: string,
): Customer {
  const record = findOrThrow(customerId);
  if (record.status !== from) {
    // Transitions are strict, not idempotent: archiving an already-archived
    // customer is failed_precondition. An audit trail that records operations
    // which did not happen is worse than one that is awkward to retry against.
    throw error('failed_precondition', refusal);
  }
  const next: Customer = {
    ...record,
    status: to,
    deletion_scheduled_at: null,
    updated_at: now(),
    updated_by_principal_id: FIXTURE_ACTING_PRINCIPAL,
  };
  replace(record.customer_id, next);
  return { ...next };
}

/* -------------------------------------------------------------------------
   Actions
   ------------------------------------------------------------------------- */

const ACTIONS: Record<DudoAction, (input: Record<string, unknown>) => unknown> = {
  /**
   * core.ListAuthorizedBusinesses — business-read-v1.
   *
   * Returns only what the caller is authorized over, never the whole
   * Organization. An EMPTY PAGE IS VALID AND REACHABLE, not an error.
   *
   * Order is fixed and total: display_name ascending by code point WITH NULLS
   * LAST, then business_id ascending as the tiebreaker. Because display_name is
   * null on every row today the order degenerates to business_id ascending —
   * which is the observable behaviour now and becomes name order, with no
   * contract change, the day names exist.
   */
  'core.ListAuthorizedBusinesses'(input) {
    maybeFail('list');
    rejectUnknownFields(input, ['page_size', 'cursor'], 'ListAuthorizedBusinesses');
    const pageSize = resolvePageSize(input.page_size);

    let rows = authorizedBusinesses().sort((a, b) => {
      // Nulls last, so a named Business never sorts among the unnamed ones.
      if (a.display_name === null && b.display_name !== null) return 1;
      if (a.display_name !== null && b.display_name === null) return -1;
      if (a.display_name !== null && b.display_name !== null) {
        const byName = compareCodePoints(normalise(a.display_name), normalise(b.display_name));
        if (byName !== 0) return byName;
      }
      return compareCodePoints(a.business_id, b.business_id);
    });

    if (typeof input.cursor === 'string' && input.cursor) {
      const payload = decodeCursor(input.cursor);
      if (payload.p !== pageSize) {
        throw invalid('The cursor is not valid for this request.', [
          { field: 'cursor', issue: 'invalid_cursor' },
        ]);
      }
      const index = rows.findIndex((row) => row.business_id === payload.a);
      if (index === -1) {
        throw invalid('The cursor is not valid for this request.', [
          { field: 'cursor', issue: 'invalid_cursor' },
        ]);
      }
      rows = rows.slice(index + 1);
    }

    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > pageSize && last
        ? encodeCursor({ a: last.business_id, s: 'all', b: null, p: pageSize })
        : null;

    return { data: page, next_cursor: nextCursor };
  },

  /**
   * core.ResolveBusinessReferences — business-read-v1.
   *
   * THE POSITIONAL GUARANTEE IS THE SECURITY PROPERTY OF THIS ACTION, not an
   * ergonomic nicety. Exactly one entry exists per requested identifier, at the
   * same index, with the identifier echoed — NEVER omitted, reordered,
   * deduplicated or collapsed, whatever its resolution. Omitting the ones that
   * did not resolve would disclose by absence which of the caller's
   * identifiers exist, rebuilding the existence oracle out of array length.
   *
   * `unresolved` covers all three of: a Business of another Organization, a
   * Business of this Organization the principal is not authorized over, and an
   * identifier that names no Business anywhere. They are indistinguishable
   * STRUCTURALLY rather than by a rule someone must remember — this tests
   * membership of the authorized set and never reads storage, so it has no fact
   * available with which to tell them apart.
   */
  'core.ResolveBusinessReferences'(input) {
    maybeFail('detail');
    rejectUnknownFields(input, ['business_ids'], 'ResolveBusinessReferences');

    const ids = input.business_ids;
    if (!Array.isArray(ids)) {
      throw invalid('business_ids is required.', [{ field: 'business_ids', issue: 'required' }]);
    }
    if (ids.length < 1) {
      throw invalid('business_ids must name at least one Business.', [
        { field: 'business_ids', issue: 'too_short' },
      ]);
    }
    if (ids.length > RESOLVE_BATCH_MAX) {
      throw invalid(`business_ids may name at most ${RESOLVE_BATCH_MAX} Businesses.`, [
        { field: 'business_ids', issue: 'too_long' },
      ]);
    }
    if (new Set(ids).size !== ids.length) {
      throw invalid('business_ids must not repeat an identifier.', [
        { field: 'business_ids', issue: 'not_unique' },
      ]);
    }
    for (const id of ids) {
      const issue = validateField('business_id', id as string, { required: true });
      if (issue) {
        throw invalid('business_ids contains an invalid identifier.', [
          { field: 'business_ids', issue: issue.issue },
        ]);
      }
    }

    const authorized = authorizedBusinesses();
    const data: BusinessReference[] = (ids as string[]).map((id) => {
      const found = authorized.find((b) => b.business_id === id);
      return found
        ? { business_id: id, display_name: found.display_name, resolution: 'resolved' }
        : { business_id: id, display_name: null, resolution: 'unresolved' };
    });

    // No next_cursor: the length is fixed by the request, so there is nothing
    // to page through and no null field for a client to branch on.
    return { data } satisfies ResolveBusinessReferencesOutput;
  },

  'customers.ListCustomers'(input) {
    maybeFail('list');
    return collect(input, () => true);
  },

  'customers.SearchCustomers'(input) {
    maybeFail('list');
    const raw = input.query;
    if (typeof raw !== 'string') {
      throw invalid('query is required.', [{ field: 'query', issue: 'required' }]);
    }
    const trimmed = raw.trim();
    if (trimmed.length < LIMITS.search_query.min) {
      throw invalid('query is not acceptable.', [{ field: 'query', issue: 'too_short' }]);
    }
    if (trimmed.length > LIMITS.search_query.max) {
      throw invalid('query is not acceptable.', [{ field: 'query', issue: 'too_long' }]);
    }
    return collect(input, (record) => matchesQuery(record, trimmed));
  },

  'customers.GetCustomer'(input) {
    maybeFail('detail');
    return { ...findOrThrow(input.customer_id) };
  },

  'customers.CreateCustomer'(input) {
    maybeFail('write');
    rejectUnknownFields(input, ['business_id', ...EDITABLE_FIELDS], 'CreateCustomer');

    const businessId = (input.business_id as string | undefined) ?? null;
    if (!businessId) {
      throw invalid('business_id is required.', [{ field: 'business_id', issue: 'required' }]);
    }
    const businessIssue = validateField('business_id', businessId);
    if (businessIssue) throw invalid('business_id is not a valid identifier.', [businessIssue]);
    if (!authorizedBusinesses().some((b) => b.business_id === businessId)) {
      throw error('not_found', 'No such Business.');
    }

    validateWritable(input, true);

    const timestamp = now();
    const record: Customer = {
      customer_id: `cus_${token(8)}`,
      business_id: businessId,
      display_name: String(input.display_name).trim().replace(/\s+/g, ' '),
      customer_type: input.customer_type as Customer['customer_type'],
      email: trimmedOrNull(input.email),
      phone: trimmedOrNull(input.phone),
      country: trimmedOrNull(input.country),
      address: input.address == null ? null : String(input.address).trim() || null,
      notes: input.notes == null ? null : String(input.notes).trim() || null,
      // status is SERVER-SET and never accepted on create. A new customer
      // starts active.
      status: 'active',
      deletion_scheduled_at: null,
      created_at: timestamp,
      created_by_principal_id: FIXTURE_ACTING_PRINCIPAL,
      updated_at: timestamp,
      updated_by_principal_id: FIXTURE_ACTING_PRINCIPAL,
    };
    store.push(record);
    return { ...record };
  },

  'customers.UpdateCustomer'(input) {
    maybeFail('write');
    rejectUnknownFields(input, ['customer_id', ...EDITABLE_FIELDS], 'UpdateCustomer');

    const record = findOrThrow(input.customer_id);

    const changed = Object.keys(input).filter((key) => key !== 'customer_id');
    if (changed.length === 0) {
      // minProperties: 2 — an update that changes nothing still writes an audit
      // record and moves updated_at, so it is rejected rather than accepted as
      // a no-op that pollutes the audit trail.
      throw invalid('An update must change at least one field.', [
        { field: 'customer_id', issue: 'no_fields_to_update' },
      ]);
    }

    if (record.status !== 'active') {
      // An archived or pending-deletion customer cannot be edited. Restore first.
      throw error('failed_precondition', 'Only an active customer can be edited.');
    }

    validateWritable(input, false);

    // The three-way distinction is normative: absent means unchanged, a value
    // means set, and null means cleared.
    const next: Customer = { ...record };
    for (const field of EDITABLE_FIELDS) {
      if (!(field in input)) continue;
      const value = input[field];
      if (value === null) {
        assignNullable(next, field, null);
      } else if (field === 'display_name') {
        next.display_name = String(value).trim().replace(/\s+/g, ' ');
      } else if (field === 'customer_type') {
        next.customer_type = value as Customer['customer_type'];
      } else if (field === 'address' || field === 'notes') {
        next[field] = String(value).trim() || null;
      } else {
        assignNullable(next, field, trimmedOrNull(value));
      }
    }
    next.updated_at = now();
    next.updated_by_principal_id = FIXTURE_ACTING_PRINCIPAL;

    replace(record.customer_id, next);
    return { ...next };
  },

  'customers.ArchiveCustomer'(input) {
    maybeFail('write');
    return transition(input.customer_id, 'active', 'archived',
      'Only an active customer can be archived.');
  },

  'customers.RestoreCustomer'(input) {
    maybeFail('write');
    // Refuses pending_deletion deliberately: countermanding an
    // organization-level destruction order is customers.customer.restore-deleted,
    // and letting the tidy-up permission do it would be a scope escalation
    // wearing a familiar name.
    return transition(input.customer_id, 'archived', 'active',
      'Only an archived customer can be restored.');
  },

  'customers.MoveCustomerToBusiness'(input) {
    maybeFail('write');
    rejectUnknownFields(input, ['customer_id', 'business_id'], 'MoveCustomerToBusiness');
    const record = findOrThrow(input.customer_id);
    const businessIssue = validateField('business_id', input.business_id as string, {
      required: true,
    });
    if (businessIssue) throw invalid('business_id is not a valid identifier.', [businessIssue]);
    if (!authorizedBusinesses().some((b) => b.business_id === input.business_id)) {
      throw error('not_found', 'No such Business.');
    }
    if (record.status === 'pending_deletion') {
      throw error('failed_precondition', 'A customer under a deletion order cannot be moved.');
    }
    const next: Customer = {
      ...record,
      business_id: input.business_id as string,
      updated_at: now(),
      updated_by_principal_id: FIXTURE_ACTING_PRINCIPAL,
    };
    replace(record.customer_id, next);
    return { ...next };
  },

  // customers.DeleteCustomer and customers.RestoreDeletedCustomer are
  // CONTRACTED AND DELIBERATELY NOT BUILT — contract §11.1. They are not in the
  // CustomerAction union, so there is no handler to write and calling either is
  // a compile error rather than a runtime surprise.
};

function assignNullable(record: Customer, field: EditableField, value: string | null): void {
  switch (field) {
    case 'email':
    case 'phone':
    case 'country':
    case 'address':
    case 'notes':
      record[field] = value;
      break;
    default:
      // display_name and customer_type are required on the record and are
      // handled by their own branches; they can never be cleared.
      break;
  }
}

/* -------------------------------------------------------------------------
   The transport
   ------------------------------------------------------------------------- */

export function createFixtureTransport(): Transport {
  return {
    name: 'fixture',

    async invoke(action, input = {}) {
      await delay();
      /*
       * THE FIXTURE REFUSES EXACTLY AS CORE REFUSES, until an Organization has
       * been selected. `session-principal-resolver.ts` maps
       * `organization-not-selected` onto `failedPrecondition()` at
       * authentication — BEFORE the router — so in the real system the refusal
       * is total and identical for every route. Modelling it before the action
       * table is looked up is what makes that true here too.
       *
       * A fixture that skipped this would be a fixture in which the application
       * works and the deployment does not, which is the exact gap that let an
       * unusable client reach a real browser.
       */
      if (!fixtureOrganizationSelected()) {
        signalPreconditionFailed();
        // Core's constant, verbatim (`kernel/errors.ts`), because the whole
        // point is that this refusal is indistinguishable from the real one.
        throw error(
          'failed_precondition',
          'The resource is not in a state that permits this operation.',
        );
      }
      const handler = ACTIONS[action];
      if (!handler) throw error('not_found', `No such action: ${action}`);
      try {
        return handler(input);
      } catch (thrown) {
        if (thrown instanceof ApiError) throw thrown;
        // A defect in this file must not leak a stack to a screen.
        throw error('internal', 'The request could not be completed.');
      }
    },
  };
}
