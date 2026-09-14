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

/* ===========================================================================
   THE CONTRACT SHAPES ARE CONSUMED, NOT RE-DECLARED — ADR 0037 REQUIREMENT 2
   ===========================================================================

   ⚠ **THIS CONSOLE CONSUMED ZERO GENERATED TYPES UNTIL 2026-09-13.** Six shapes
   below were hand-written restatements of a schema the generator had already
   emitted — *"a hand-written type that restates a generated one is the defect
   0037 exists to remove"*, in the generated file's own words, and this package
   did not even declare `@dudo/contracts` as a dependency.

   **Nothing was broken and nothing went red**, which is why it survived: the
   hand-written shapes were correct, and a correct duplicate is exactly the kind
   `workflow.md` §12 records as unsweepable — no citation between the copies,
   nothing that fails when they drift.

   ⚠ **THE GENERATED TYPES ARE `readonly` AND THE HAND-WRITTEN ONES WERE NOT.**
   That is not cosmetic: a response shape a client can mutate is one a screen
   can edit in place and then re-render from, which reads as working until two
   components share a reference. **The compiler is what will say whether
   anything relied on the mutability** — that is the whole reason to swap rather
   than to compare by eye.

   **WHAT STAYS HAND-WRITTEN, and it is not laziness:** the transport table, the
   base path, the batch maximum and the rendering rule below. Those are this
   CLIENT's decisions about how to reach the contract, not shapes the contract
   declares. The generator emits types and permission constants; it does not
   emit a route table, and inventing one would be the client re-declaring a
   different thing.

   `BusinessId` is still this package's own, from `./customer-directory`. The
   generated module declares an identical `BusinessId = string`; importing both
   would put two names for one type in one file, and it resolves when
   `customer-directory.ts` is swapped in its own change. */
export type {
  ResolutionState,
  BusinessSummary,
  BusinessReference,
  ListAuthorizedBusinessesInput,
  ListAuthorizedBusinessesOutput,
  ResolveBusinessReferencesInput,
  ResolveBusinessReferencesOutput,
} from '@dudo/contracts/core/organization/business-read-v1';

/*
 * ⚠ `ListAuthorizedBusinessesOutput` WAS THE ONE THIS LIST MISSED, AND IT WAS
 * MISSED BECAUSE THE SWAP WAS DRIVEN BY WHAT THE CLIENT ALREADY DECLARED.
 *
 * The six names above replaced six hand-written duplicates, so the population
 * was *the shapes this client had a copy of* — and this one it did not. It cast
 * the page to `CollectionEnvelope<BusinessSummary>` instead: structurally equal
 * today, and a different claim. `workflow.md` §11a's recurring shape — **the
 * population drawn from where the author expected the subject to live.**
 *
 * It is adopted here rather than in a later pass because leaving it is the
 * exact defect the `api/client.ts` adoption was ruled on: **one client holding
 * two vocabularies, with the newer half looking like the exception.**
 */

/** The batch maximum. A chosen number: it matches the default page size. */
export const RESOLVE_BATCH_MAX = 25;

export type CoreAction = 'core.ListAuthorizedBusinesses' | 'core.ResolveBusinessReferences';

/**
 * Transcribed from `business-read-v1.contract.yaml -> httpBinding`.
 *
 * `ResolveBusinessReferences` IS A POST, AND IT IS STILL A READ. Revised in the
 * contract on 2026-09-04. As first authored it was
 * `GET /businesses/names?business_ids=a&business_ids=b`, and
 * `platform/core/http/api.ts:253-266` rejects every repeated query parameter with
 * `invalid_argument / repeated_parameter` — so the Action could not succeed over
 * HTTP for more than one identifier. Core's refusal was correct and stayed; the
 * wire form is what changed. The batch now travels as a JSON body:
 *
 *   POST /api/v1/businesses/names
 *   { "business_ids": ["<id>", "<id>", ...] }
 *
 * THE SHAPE DID NOT CHANGE — `business_ids` was always an array, and a JSON body
 * carries one natively, so no delimiter, splitting rule or coercion sits between
 * this client and the schema. The batch maximum is still 25.
 *
 * A CLIENT MUST NOT READ THE POST AS A MUTATION. The contract declares
 * `sensitivity: read`, `maxRowWrites: 0`, `audit: false`, no event, and no
 * free-tier write consumption. It is safe to call on render and safe to retry.
 */
export const CORE_ROUTES: Record<CoreAction, { method: string; path: string }> = {
  'core.ListAuthorizedBusinesses': { method: 'GET', path: '/businesses' },
  'core.ResolveBusinessReferences': { method: 'POST', path: '/businesses/names' },
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
