/**
 * The Customer entity and its lifecycle.
 *
 * Shapes are `packages/contracts/apps/customers/customer-directory-v1.schema.json`; the
 * state machine is that contract's README.md §6. Both are normative and neither is
 * authored here — this App implements the contract and never adjusts it. A shape below
 * that disagrees with the contract is a defect in this file.
 *
 * WHY `pending_deletion` AND `deletion_scheduled_at` EXIST HERE WHEN NOTHING CAN PRODUCE
 * THEM. `DeleteCustomer` and `RestoreDeletedCustomer` are out of scope for this slice
 * (contract §11.1), so no code path reaches `pending_deletion` and `deletion_scheduled_at`
 * is null on every row this slice can write. The status value, the nullable field and the
 * `statusFilter` members are nevertheless IN SCOPE and required now, because they are the
 * parts that are breaking to add later: "adding two lifecycle states, a nullable deadline
 * field and a new statusFilter member AFTER either client ships is breaking under
 * API_STANDARD.md §6". A client must tolerate a status it will never see in this slice
 * rather than crash on it, and that tolerance is testable now.
 *
 * WHAT IS DELIBERATELY ABSENT: any constant for the 30-day recovery window. It is stated in
 * the contract (`retention.customerDeletionRetentionDays`) and it is used by exactly one
 * Action, which is not built. Defining it here would put the deletion policy in the code
 * without the Action that applies it, which reads as half-built rather than as deferred.
 */

export type CustomerStatus = 'active' | 'archived' | 'pending_deletion';
export type CustomerType = 'person' | 'company';

/** The full wire representation. EVERY FIELD IS PRESENT ON EVERY RESPONSE. */
export type Customer = {
  readonly customer_id: string;
  readonly business_id: string;
  readonly display_name: string;
  readonly customer_type: CustomerType;
  readonly email: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly status: CustomerStatus;
  readonly deletion_scheduled_at: string | null;
  readonly created_at: string;
  readonly created_by_principal_id: string;
  readonly updated_at: string;
  readonly updated_by_principal_id: string;
};

/**
 * One row of a directory listing.
 *
 * IT EXCLUDES `address` AND `notes`, and that exclusion is the entire reason `list` is a
 * separate permission from `read` (AUTHORIZATION_STANDARD.md §3.2). Enumeration and record
 * disclosure are different risks; if the list returned the whole record they would be the
 * same risk behind two permission names. Adding either field here would silently merge them.
 */
export type CustomerSummary = {
  readonly customer_id: string;
  readonly business_id: string;
  readonly display_name: string;
  readonly customer_type: CustomerType;
  readonly email: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly status: CustomerStatus;
  readonly deletion_scheduled_at: string | null;
  readonly updated_at: string;
};

/** The list and search filter. `all` includes `pending_deletion`. */
export type StatusFilter = 'active' | 'archived' | 'pending_deletion' | 'all';

export const STATUS_FILTER_VALUES: readonly StatusFilter[] = [
  'active',
  'archived',
  'pending_deletion',
  'all',
];

export const DEFAULT_STATUS_FILTER: StatusFilter = 'active';

/**
 * Which stored statuses a filter selects. `all` returns every status rather than an empty
 * predicate, so that a future status cannot be silently included by a filter that means
 * "no narrowing".
 */
export function statusesForFilter(filter: StatusFilter): readonly CustomerStatus[] {
  if (filter === 'all') {
    return ['active', 'archived', 'pending_deletion'];
  }
  return [filter];
}

/**
 * TRANSITIONS ARE STRICT, NOT IDEMPOTENT, and the trade is accepted deliberately.
 *
 * Archiving an already-archived customer is `failed_precondition`. A retried archive after
 * a network failure therefore returns an error the client must treat as success — which is
 * awkward. The permissive alternative writes an audit record saying a customer was archived
 * when nothing changed, and "an audit trail that records operations which did not happen is
 * worse than one that is occasionally awkward to retry against" (contract README.md §6).
 */
export function canArchive(status: CustomerStatus): boolean {
  return status === 'active';
}

/**
 * `archived` only.
 *
 * REFUSING `pending_deletion` IS NOT AN INCONSISTENCY. `customers.customer.restore` is a
 * BUSINESS-scope permission; countermanding an organization-level destruction order is
 * `customers.customer.restore-deleted` at organization scope. Letting the tidy-up
 * permission do it would be a scope escalation wearing a familiar name. Nothing can reach
 * `pending_deletion` in this slice, so this branch is unreachable today — and it is written
 * anyway, because the day the deletion Actions are built it must already be right.
 */
export function canRestore(status: CustomerStatus): boolean {
  return status === 'archived';
}

/**
 * `active` only.
 *
 * An archived record that can still be quietly changed is neither withdrawn nor a record.
 * And during a recovery window, what an authorized principal would restore must be what it
 * chose to keep — so `pending_deletion` is refused for a second, stronger reason.
 */
export function canUpdate(status: CustomerStatus): boolean {
  return status === 'active';
}

/**
 * `active` and `archived`. Not `pending_deletion`.
 *
 * Reorganising the Organization's own structure should not be blocked by a record being
 * withdrawn from use — an archived customer in a Business that no longer serves it is
 * exactly the record someone will need to move. A record under a destruction order is
 * different: its Business is part of what the recovery restores.
 */
export function canMove(status: CustomerStatus): boolean {
  return status === 'active' || status === 'archived';
}
