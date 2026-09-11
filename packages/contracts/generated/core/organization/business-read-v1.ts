/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/organization/business-read-v1.schema.json
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

export type BusinessId = string;

export type BusinessDisplayName = string;

export type DisplayNameOrNull = BusinessDisplayName | null;

export type ResolutionState = 'resolved' | 'unresolved';

export type BusinessSummary = {
  readonly business_id: BusinessId;
  readonly display_name: DisplayNameOrNull;
};

export type BusinessReference = {
  readonly business_id: BusinessId;
  readonly display_name: DisplayNameOrNull;
  readonly resolution: ResolutionState;
};

export type ListAuthorizedBusinessesInput = {
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListAuthorizedBusinessesOutput = {
  readonly data: ReadonlyArray<BusinessSummary>;
  readonly next_cursor: NextCursor;
};

export type ResolveBusinessReferencesInput = {
  readonly business_ids: ReadonlyArray<BusinessId>;
};

export type ResolveBusinessReferencesOutput = {
  readonly data: ReadonlyArray<BusinessReference>;
};


export type CoreListAuthorizedBusinessesError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CoreListAuthorizedBusinessesPermission = 'core.business.read' as const;

export type CoreResolveBusinessReferencesError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CoreResolveBusinessReferencesPermission = 'core.business.read' as const;
