/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-sessions-v1.schema.json
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

export type SessionSummary = {
  readonly started_at: string;
  readonly expires_at: string;
  readonly is_current: boolean;
};

export type ListMemberSessionsInput = {
  readonly principal_id: PrincipalId;
};

export type ListMemberSessionsOutput = {
  readonly data: ReadonlyArray<SessionSummary>;
  readonly truncated: boolean;
};

export type RevokeMemberSessionsInput = {
  readonly principal_id: PrincipalId;
};

export type RevokeMemberSessionsOutput = {
  readonly revoked_count: number;
  readonly revoked_at: string;
};


export type TenantMembersSessionsListError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersSessionsListPermission = 'core.session.list' as const;

export type TenantMembersSessionsRevokeError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'not_found' | 'failed_precondition' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantMembersSessionsRevokePermission = 'core.session.revoke' as const;
