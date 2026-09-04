/**
 * Business Read — contract-derived types.
 *
 * SOURCE OF TRUTH:
 *   packages/contracts/core/organization/business-read-v1.schema.json
 *   packages/contracts/core/organization/business-read-v1.contract.yaml
 *
 * This contract answers the two questions the Customer Directory could not
 * answer for itself: which Businesses may this principal file a customer into,
 * and what is a `business_id` called. It replaces the fixture-only
 * `listBusinesses()` placeholder this client carried while the gap was open.
 *
 * It is deliberately NOT the organization-structure slice: no full business
 * object, no create, no update, no lifecycle, no hierarchy, no membership. This
 * client must not reach for any of those, and must not infer them.
 */

import type { BusinessId } from './customer-directory';

export type ResolutionState = 'resolved' | 'unresolved';

/** One row of the authorized-business listing. Two fields, and that is the point. */
export interface BusinessSummary {
  business_id: BusinessId;
  /** Present and null, never absent. Null means no name is recorded. */
  display_name: string | null;
}

/**
 * One entry of a resolution response.
 *
 * `business_id` is echoed so a client never has to depend on positional
 * alignment alone. When `resolution` is `unresolved`, `display_name` is always
 * null — but when it is `resolved` the name may STILL be null, so a client must
 * never infer existence from the name. That is what `resolution` is for.
 */
export interface BusinessReference {
  business_id: BusinessId;
  display_name: string | null;
  resolution: ResolutionState;
}

export interface ListAuthorizedBusinessesInput {
  page_size?: number;
  cursor?: string;
}

export interface ResolveBusinessReferencesInput {
  business_ids: BusinessId[];
}

/** Not a paginated collection and it has no next_cursor: length is fixed by the request. */
export interface ResolveBusinessReferencesOutput {
  data: BusinessReference[];
}

/** The batch maximum. A chosen number: it matches the default page size. */
export const RESOLVE_BATCH_MAX = 25;

export type CoreAction = 'core.ListAuthorizedBusinesses' | 'core.ResolveBusinessReferences';

export const CORE_ROUTES: Record<CoreAction, { method: string; path: string }> = {
  'core.ListAuthorizedBusinesses': { method: 'GET', path: '/businesses' },
  'core.ResolveBusinessReferences': { method: 'GET', path: '/businesses/names' },
};

export const CORE_BASE_PATH = '/api/v1';

/**
 * THE NORMATIVE RENDERING RULE, and the reason it is a function rather than a
 * habit.
 *
 * The contract binds BOTH clients: when `display_name` is null, render the
 * `business_id` VERBATIM. Not a blank, not a dash, not "Unnamed Business", not
 * a locale string. An opaque identifier is the honest rendering of a reference
 * whose name is unknown; a placeholder is indistinguishable from a real name
 * and becomes ambiguous the moment a principal is authorized over two nameless
 * Businesses; and a blank makes a required field look unset.
 *
 * Every place this client shows a Business goes through here, so the rule is
 * enforced in one place instead of being remembered at each call site. The
 * Apple client's `BusinessReference.displayLabel` does the same thing — this
 * function is that behaviour made contracted rather than local.
 *
 * THIS MATTERS TODAY, NOT EVENTUALLY: nothing in Dudo stores a Business name
 * yet — the business table is exactly (tenant_id, business_id) — so
 * `display_name` is null on every response from both Actions, and this fallback
 * is the ONLY path currently exercised.
 */
export function businessLabel(reference: {
  business_id: BusinessId;
  display_name: string | null;
}): string {
  return reference.display_name ?? reference.business_id;
}
