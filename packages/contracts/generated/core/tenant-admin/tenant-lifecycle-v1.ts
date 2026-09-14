/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-lifecycle-v1.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  *** status `proposed` — NOT ACCEPTED. ***
 *
 *            THE SOURCE CONTRACT IS NOT ACCEPTED, SO NOTHING BELOW IS AGREED. Types may
 *            change shape without a version bump, and ANY `*Permission` CONSTANT BELOW
 *            NAMES A PERMISSION THAT MAY NOT EXIST: docs/decisions/0007 rule 4 — a
 *            permission does not exist until it is in packages/contracts/registries/
 *            permission-catalog.yaml. Importing the name neither creates nor grants it,
 *            and a route gated on it will refuse every caller under deny-by-default.
 *            Build against this only if you are prepared to rewrite when it is accepted.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

import type { ErrorEnvelope } from '../../common/error-envelope.ts';
import type { PrincipalId } from './tenant-members-v1.ts';

export type ErrorResponse = ErrorEnvelope;

export type DeletionRequestStatus = 'pending' | 'cancelled' | 'purged';

export type DeletionRequest = {
  readonly status: DeletionRequestStatus;
  readonly requested_at: string;
  readonly requested_by: PrincipalId;
  readonly scheduled_purge_at: string;
  readonly closed_at: string | null;
  readonly closed_by: PrincipalId | null;
};

export type GetLifecycleOutput = {
  readonly owner_principal_id: PrincipalId;
  readonly deletion_request: DeletionRequest | null;
  readonly retention_window_days: number;
};

export type TransferOwnershipInput = {
  readonly to_principal_id: PrincipalId;
};

export type TransferOwnershipOutput = {
  readonly previous_owner_principal_id: PrincipalId;
  readonly owner_principal_id: PrincipalId;
  readonly transferred_at: string;
};

export type RequestDeletionInput = Record<string, never>;

export type RequestDeletionOutput = DeletionRequest;

export type CancelDeletionRequestInput = Record<string, never>;

export type CancelDeletionRequestOutput = DeletionRequest;


export type TenantOrganizationLifecycleGetError = 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationLifecycleGetPermission = 'core.organization.read' as const;

export type TenantOrganizationTransferOwnershipError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationTransferOwnershipPermission = 'core.organization.transfer-ownership' as const;

export type TenantOrganizationRequestDeletionError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationRequestDeletionPermission = 'core.organization.request-deletion' as const;

export type TenantOrganizationCancelDeletionRequestError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationCancelDeletionRequestPermission = 'core.organization.cancel-deletion-request' as const;
