/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/organization/organization-structure-v1.schema.json
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
import type { BusinessId } from './business-read-v1.ts';
import type { Cursor, NextCursor, PageSize } from '../../common/pagination.ts';
export type { BusinessId };

export type ErrorResponse = ErrorEnvelope;


export type BranchId = string;

export type StructureName = string;

export type StructureStatus = 'active' | 'archived';

export type BusinessRecord = {
  readonly business_id: BusinessId;
  readonly name: StructureName | null;
  readonly status: StructureStatus;
  readonly created_at: string;
};

export type BranchRecord = {
  readonly branch_id: BranchId;
  readonly business_id: BusinessId;
  readonly name: StructureName | null;
  readonly status: StructureStatus;
  readonly created_at: string;
};

export type CreateBusinessInput = {
  readonly name: StructureName;
};

export type CreateBusinessOutput = BusinessRecord;

export type UpdateBusinessInput = {
  readonly business_id: BusinessId;
  readonly name: StructureName;
};

export type UpdateBusinessOutput = BusinessRecord;

export type BusinessLifecycleInput = {
  readonly business_id: BusinessId;
};

export type BusinessLifecycleOutput = BusinessRecord;

export type CreateBranchInput = {
  readonly business_id: BusinessId;
  readonly name: StructureName;
};

export type CreateBranchOutput = BranchRecord;

export type UpdateBranchInput = {
  readonly business_id: BusinessId;
  readonly branch_id: BranchId;
  readonly name: StructureName;
};

export type UpdateBranchOutput = BranchRecord;

export type BranchLifecycleInput = {
  readonly business_id: BusinessId;
  readonly branch_id: BranchId;
};

export type BranchLifecycleOutput = BranchRecord;

export type ListBranchesInput = {
  readonly business_id: BusinessId;
  readonly page_size?: PageSize;
  readonly cursor?: Cursor;
};

export type ListBranchesOutput = {
  readonly data: ReadonlyArray<BranchRecord>;
  readonly next_cursor: NextCursor;
};


export type CoreCreateBusinessError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreCreateBusinessPermission = 'core.business.create' as const;

export type CoreRenameBusinessError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreRenameBusinessPermission = 'core.business.update' as const;

export type CoreArchiveBusinessError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreArchiveBusinessPermission = 'core.business.archive' as const;

export type CoreRestoreBusinessError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreRestoreBusinessPermission = 'core.business.archive' as const;

export type CoreCreateBranchError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreCreateBranchPermission = 'core.branch.create' as const;

export type CoreRenameBranchError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreRenameBranchPermission = 'core.branch.update' as const;

export type CoreArchiveBranchError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreArchiveBranchPermission = 'core.branch.archive' as const;

export type CoreRestoreBranchError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const CoreRestoreBranchPermission = 'core.branch.archive' as const;

export type CoreListBranchesError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const CoreListBranchesPermission = 'core.branch.read' as const;
