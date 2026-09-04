/**
 * Customer Directory — contract-derived types.
 *
 * SOURCE OF TRUTH, and this file is a transcription of it, never an authority:
 *   packages/contracts/apps/customers/customer-directory-v1.schema.json
 *   packages/contracts/apps/customers/customer-directory-v1.contract.yaml
 *   packages/contracts/apps/customers/README.md
 *
 * ONE CONTRACT, TWO CLIENTS. `app-agent` builds the Apple screens from the same
 * schema. A shape this file has and the Apple client does not — or the reverse
 * — is a contract defect, not a client-local choice. Nothing here may be
 * widened, narrowed or "improved" without the contract changing first.
 *
 * The zero-dependency build carried these shapes in JSDoc. Under ADR 0016 they
 * are real types, which is the single biggest thing TypeScript buys here: the
 * three-way partial-update semantics and the "present and null" rule are now
 * checked by the compiler instead of remembered by the author.
 */

/** Opaque, non-sequential, unguessable. Never parsed, never ordered by. */
export type CustomerId = string;
export type BusinessId = string;
export type PrincipalId = string;

/** RFC 3339, UTC, with an explicit offset. */
export type Timestamp = string;

export const CUSTOMER_TYPES = ['person', 'company'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/**
 * SERVER-CONTROLLED. Never accepted on create or update; it moves only through
 * the Archive/Restore/Delete/RestoreDeleted Actions, which is what makes every
 * transition permissioned and audited.
 *
 * `pending_deletion` is in this union even though nothing in this slice can
 * produce it. Contract §11.1 requires exactly that: the status value and the
 * nullable deadline are in scope now because they are breaking to add later,
 * and a client must tolerate a status it will never see rather than crash on
 * it.
 */
export const CUSTOMER_STATUSES = ['active', 'archived', 'pending_deletion'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const STATUS_FILTERS = ['active', 'archived', 'pending_deletion', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The full wire representation — all fifteen fields.
 *
 * EVERY FIELD IS PRESENT ON EVERY RESPONSE. An optional field the tenant has
 * not filled in is present and `null`, never absent. That is why these are
 * `T | null` rather than `T | undefined` or optional properties: absent versus
 * null is a distinction two clients would resolve differently, and "the web app
 * shows a blank and the iPhone app shows nothing" is the divergence the one
 * contract rule exists to prevent.
 *
 * NO `organization_id`, and the asymmetry with `business_id` is the point. The
 * Organization is the isolation boundary: never accepted on input, never
 * returned, derived from the authenticated server-side context on every call,
 * so no client ever learns a tenant identifier it might be tempted to send
 * back. The Business is an authorization scope inside that boundary, and a
 * directory row that does not say which Business it belongs to is a row that
 * will be acted on in the wrong one.
 */
export interface Customer {
  customer_id: CustomerId;
  business_id: BusinessId;
  display_name: string;
  customer_type: CustomerType;
  email: string | null;
  phone: string | null;
  country: string | null;
  address: string | null;
  notes: string | null;
  status: CustomerStatus;
  deletion_scheduled_at: Timestamp | null;
  created_at: Timestamp;
  created_by_principal_id: PrincipalId;
  updated_at: Timestamp;
  updated_by_principal_id: PrincipalId;
}

/**
 * The projection returned by ListCustomers and SearchCustomers — one directory
 * row, ten fields.
 *
 * IT DELIBERATELY EXCLUDES `address` AND `notes`, the two sensitive-personal
 * free-text fields. That exclusion is the whole point of `list` being a
 * separate permission from `read`: enumeration and record disclosure are
 * different risks, and if the list returned the whole record they would be the
 * same risk behind two permission names. Widening this type to `Customer` would
 * quietly undo a security boundary.
 */
export interface CustomerSummary {
  customer_id: CustomerId;
  business_id: BusinessId;
  display_name: string;
  customer_type: CustomerType;
  email: string | null;
  phone: string | null;
  country: string | null;
  status: CustomerStatus;
  deletion_scheduled_at: Timestamp | null;
  updated_at: Timestamp;
}

/** The standard collection envelope. NO TOTAL COUNT — see below. */
export interface CollectionEnvelope<T> {
  data: T[];
  /**
   * `null` on the last page, never absent.
   *
   * There is deliberately no `total`. The reason is tenant isolation rather
   * than performance: a cross-tenant total is the cheapest leak to write by
   * accident because it returns no records at all. The product consequence is
   * concrete and accepted — neither client can show "247 customers".
   */
  next_cursor: string | null;
}

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/* -------------------------------------------------------------------------
   Action inputs
   ------------------------------------------------------------------------- */

export interface ListCustomersInput {
  business_id?: BusinessId;
  status?: StatusFilter;
  page_size?: number;
  cursor?: string;
}

export interface SearchCustomersInput extends ListCustomersInput {
  query: string;
}

/**
 * `business_id` is REQUIRED and required rather than defaulted: a principal may
 * be authorized over several Businesses, so there is no single Business the
 * server can infer, and inferring one from an "active Business" in the session
 * would be an ambient default. Making the caller state it means the wrong
 * answer is a visible wrong answer.
 *
 * An optional field may be omitted or supplied as null; both mean "not
 * recorded". `status`, `customer_id` and any tenant identifier are not
 * properties here, and the schema sets `additionalProperties: false`, so
 * supplying one fails the request rather than being ignored.
 */
export interface CreateCustomerInput {
  business_id: BusinessId;
  display_name: string;
  customer_type: CustomerType;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  address?: string | null;
  notes?: string | null;
}

/**
 * PARTIAL UPDATE, and the three-way distinction is normative:
 *   - property ABSENT              -> unchanged
 *   - property PRESENT with a value -> set to that value
 *   - property PRESENT and null     -> cleared (optional fields only)
 *
 * `display_name` and `customer_type` are required on the record, so they may be
 * present-with-a-value or absent, never null — which is why they are typed
 * without `| null` while the optional fields keep it.
 *
 * `business_id` IS NOT A PROPERTY HERE AND MAY NOT BE ADDED. Moving a customer
 * between Businesses is MoveCustomerToBusiness — its own Action, its own
 * permission at organization scope only, and its own audit record. As a field
 * on a partial update it would be an unaudited re-assignment of a customer's
 * authorization scope under a permission a business-scope principal may hold.
 */
export interface UpdateCustomerChanges {
  display_name?: string;
  customer_type?: CustomerType;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** The seven fields a client may write, across create and update. */
export const EDITABLE_FIELDS = [
  'display_name',
  'customer_type',
  'email',
  'phone',
  'country',
  'address',
  'notes',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * The eight Actions in scope for this slice.
 *
 * `customers.DeleteCustomer` and `customers.RestoreDeletedCustomer` are
 * contracted and DELIBERATELY ABSENT from this union — contract §11.1. Their
 * absence is the decision, not an oversight, and because this is a union rather
 * than a string, adding a call to either is a compile error rather than a code
 * review question.
 */
export type CustomerAction =
  | 'customers.CreateCustomer'
  | 'customers.GetCustomer'
  | 'customers.ListCustomers'
  | 'customers.SearchCustomers'
  | 'customers.UpdateCustomer'
  | 'customers.ArchiveCustomer'
  | 'customers.RestoreCustomer'
  | 'customers.MoveCustomerToBusiness';

/**
 * Re-exported for convenience. The gap this client once filled with a local
 * placeholder is closed: a Business reference is now `businessSummary` from
 * `core/organization/business-read-v1`. See contracts/business-read.ts.
 */
export type { BusinessSummary as BusinessRef } from './business-read';
