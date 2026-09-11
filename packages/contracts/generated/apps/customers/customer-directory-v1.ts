/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/apps/customers/customer-directory-v1.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  status `accepted`.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

import type { ErrorEnvelope } from '../../common/error-envelope.ts';
import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';

export type ErrorResponse = ErrorEnvelope;

export type CustomerId = string;

export type PrincipalId = string;

export type BusinessId = string;

export type Timestamp = string;

export type DisplayName = string;

export type CustomerType = 'person' | 'company';

export type Email = string;

export type Phone = string;

export type Country = string;

export type Address = string;

export type Notes = string;

export type CustomerStatus = 'active' | 'archived' | 'pending_deletion';

export type DeletionScheduledAt = Timestamp;

export type Customer = {
  readonly customer_id: CustomerId;
  readonly business_id: BusinessId;
  readonly display_name: DisplayName;
  readonly customer_type: CustomerType;
  readonly email: Email | null;
  readonly phone: Phone | null;
  readonly country: Country | null;
  readonly address: Address | null;
  readonly notes: Notes | null;
  readonly status: CustomerStatus;
  readonly deletion_scheduled_at: DeletionScheduledAt | null;
  readonly created_at: Timestamp;
  readonly created_by_principal_id: PrincipalId;
  readonly updated_at: Timestamp;
  readonly updated_by_principal_id: PrincipalId;
};

export type CustomerSummary = {
  readonly customer_id: CustomerId;
  readonly business_id: BusinessId;
  readonly display_name: DisplayName;
  readonly customer_type: CustomerType;
  readonly email: Email | null;
  readonly phone: Phone | null;
  readonly country: Country | null;
  readonly status: CustomerStatus;
  readonly deletion_scheduled_at: DeletionScheduledAt | null;
  readonly updated_at: Timestamp;
};

export type StatusFilter = 'active' | 'archived' | 'pending_deletion' | 'all';

export type SearchQuery = string;

export type CreateCustomerInput = {
  readonly business_id: BusinessId;
  readonly display_name: DisplayName;
  readonly customer_type: CustomerType;
  readonly email?: Email | null;
  readonly phone?: Phone | null;
  readonly country?: Country | null;
  readonly address?: Address | null;
  readonly notes?: Notes | null;
};

export type CreateCustomerOutput = Customer;

export type GetCustomerInput = {
  readonly customer_id: CustomerId;
};

export type GetCustomerOutput = Customer;

export type ListCustomersInput = {
  readonly business_id?: BusinessId;
  readonly status?: StatusFilter;
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListCustomersOutput = {
  readonly data: ReadonlyArray<CustomerSummary>;
  readonly next_cursor: NextCursor;
};

export type SearchCustomersInput = {
  readonly query: SearchQuery;
  readonly business_id?: BusinessId;
  readonly status?: StatusFilter;
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type SearchCustomersOutput = {
  readonly data: ReadonlyArray<CustomerSummary>;
  readonly next_cursor: NextCursor;
};

export type UpdateCustomerInput = {
  readonly customer_id: CustomerId;
  readonly display_name?: DisplayName;
  readonly customer_type?: CustomerType;
  readonly email?: Email | null;
  readonly phone?: Phone | null;
  readonly country?: Country | null;
  readonly address?: Address | null;
  readonly notes?: Notes | null;
};

export type UpdateCustomerOutput = Customer;

export type ArchiveCustomerInput = {
  readonly customer_id: CustomerId;
};

export type ArchiveCustomerOutput = Customer;

export type RestoreCustomerInput = {
  readonly customer_id: CustomerId;
};

export type RestoreCustomerOutput = Customer;

export type MoveCustomerToBusinessInput = {
  readonly customer_id: CustomerId;
  readonly business_id: BusinessId;
};

export type MoveCustomerToBusinessOutput = Customer;

export type DeleteCustomerInput = {
  readonly customer_id: CustomerId;
};

export type DeleteCustomerOutput = Customer;

export type RestoreDeletedCustomerInput = {
  readonly customer_id: CustomerId;
};

export type RestoreDeletedCustomerOutput = Customer;


export type CustomersCreateCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'quota_exceeded' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersCreateCustomerPermission = 'customers.customer.create' as const;

export type CustomersGetCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersGetCustomerPermission = 'customers.customer.read' as const;

export type CustomersListCustomersError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersListCustomersPermission = 'customers.customer.list' as const;

export type CustomersSearchCustomersError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersSearchCustomersPermission = 'customers.customer.list' as const;

export type CustomersUpdateCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'conflict' | 'quota_exceeded' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersUpdateCustomerPermission = 'customers.customer.update' as const;

export type CustomersArchiveCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'quota_exceeded' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersArchiveCustomerPermission = 'customers.customer.archive' as const;

export type CustomersRestoreCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'quota_exceeded' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersRestoreCustomerPermission = 'customers.customer.restore' as const;

export type CustomersMoveCustomerToBusinessError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'quota_exceeded' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersMoveCustomerToBusinessPermission = 'customers.customer.move' as const;

export type CustomersDeleteCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersDeleteCustomerPermission = 'customers.customer.delete' as const;

export type CustomersRestoreDeletedCustomerError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CustomersRestoreDeletedCustomerPermission = 'customers.customer.restore-deleted' as const;
