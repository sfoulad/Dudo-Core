/**
 * ===========================================================================================
 * CORE'S OWN ACTIONS. `docs/decisions/0023` · `packages/contracts/core/organization/
 * business-read-v1`.
 * ===========================================================================================
 *
 * THE FIRST `ActionDefinition`S IN `platform/core/**`, AND UNTIL 2026-09-05 THERE WERE NONE.
 * `qa-agent` found both routes returning 404 against the live deployment. The Team Lead read it
 * as an unmounted-App defect; it was not — **nothing implemented them.** The web client had been
 * calling a route that never existed. That distinction is `0023`'s reason for existing.
 *
 * These are Core's, not an App's, and the test `architecture-agent` gave is that **anything
 * touching tenant data is always an Action.** Both read the tenant's `business` table, so they go
 * through the ordinary pipeline — authenticate, authorize, resolve the tenant store, run — with no
 * exception carved for them. `0021`'s session routes were the case where that test says *no*;
 * this is the case where it says *yes*, and the two decisions are consistent because the test is.
 *
 * ===========================================================================================
 * WHY THEY ARE NOT AN APP'S, WHICH WAS THE ALTERNATIVE AND IS WORTH KEEPING
 * ===========================================================================================
 *
 * Making the Customer Directory declare `core.business.read` in its manifest would have worked
 * mechanically and would mean **the Customer Directory's manifest gates a Core capability**. A
 * second App would have to declare it too, and a platform capability would be reachable only
 * through whichever App happened to remember it. `0023` rejects it on exactly that.
 *
 * ===========================================================================================
 * BOTH ARE READS, AND `ResolveBusinessReferences` BEING A `POST` DOES NOT CHANGE THAT
 * ===========================================================================================
 *
 * `maxRowWrites: 0` on both, `sensitivity: read`, `audit: false`. The contract names the mistake
 * the method invites: *"AN IMPLEMENTATION THAT TAKES A WRITE RESERVATION FOR THIS ACTION BECAUSE
 * IT IS A POST IS WRONG."* It is a POST because it carries an array of up to 25 identifiers,
 * which `mergeInputSources` cannot express as query parameters — and `pipeline.ts` gates the
 * entire daily-write-admission path on the handler having produced writes, so neither Action
 * takes a reservation and neither can return `quota_exceeded` whatever method reaches it.
 */

import type { ActionDefinition } from '../action/action.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';
import type { ActionContext } from '../tenancy/tenant-context.ts';

/** The permission both Actions declare. Already registered in `permission-catalog.yaml`. */
export const BUSINESS_READ_PERMISSION = 'core.business.read';

/** `0023` — Core's own app identifier, distinct from every installed App's. */
export const CORE_APP_ID = 'core';

/** The contract's identifier grammar, and the same one `kernel/ids.ts` generates at 22. */
const BUSINESS_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** `pagination.schema.json`: documented default 25, documented maximum 100. */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** The contract's cap on one resolution request. */
const MAX_REFERENCES = 25;

type ListInput = {
  readonly pageSize: number;
  readonly cursor: string | null;
};

type BusinessSummary = {
  readonly business_id: string;
  readonly display_name: string | null;
};

type ListOutput = {
  readonly data: readonly BusinessSummary[];
  readonly next_cursor: string | null;
};

/**
 * ===========================================================================================
 * `core.ListAuthorizedBusinesses` — GET /businesses
 * ===========================================================================================
 *
 * IT READS `context.authorizedBusinessIds` AND NOT THE `business` TABLE, and that is the whole
 * of its tenant-safety argument. `0020` computes that set per request, through the tenant-scoped
 * handle, from the tenant's own `business` table — so by the time this handler runs, the set is
 * already exactly "the Businesses this principal is authorized over in this Organization". There
 * is no query here to write without a tenant predicate, because there is no query here.
 *
 * The contract requires precisely that: *"Returns only what the caller is authorized over —
 * never the whole Organization for a principal that is not authorized over the whole
 * Organization."*
 *
 * `display_name` IS ALWAYS `null` TODAY, AND IS PRESENT RATHER THAN ABSENT. `0002_business.sql`
 * declined a name column, the same way `0002_organization.sql` did — the organization-structure
 * slice owns that model. Present-and-null is contracted so the shape does not change the day
 * names exist, and so two clients do not invent two different placeholders.
 *
 * THE ORDER IS FIXED AND TOTAL: `display_name` ascending with NULLS LAST, then `business_id`
 * ascending. Because every name is null today it degenerates to `business_id` ascending — and
 * becomes name order, with no contract change, the day names exist. Sorting here rather than
 * relying on the set's arrival order matters: `0020` builds that set from a store read whose
 * ordering no port or migration states, so an unsorted response would be a promise this code
 * cannot keep.
 *
 * NO `not_found` AND NO `quota_exceeded`, both normative. A collection endpoint never 404s for
 * its contents — a principal authorized over no Business receives `data: []` and a null cursor,
 * which both clients must treat as a first-class state rather than a failure to load.
 */
export function createListAuthorizedBusinessesAction(): ActionDefinition<ListInput, ListOutput> {
  return {
    appId: CORE_APP_ID,
    id: 'core.ListAuthorizedBusinesses',
    // Title and description are the contract's own words, not a paraphrase. `API_STANDARD.md`
    // §1: the description is what a model sees when choosing a tool, so it states what the
    // operation does and when to use it rather than how it is implemented.
    title: 'List my businesses',
    description:
      'Return the Businesses of this Organization that the signed-in principal is authorized ' +
      'over, with their names, in a stable order. Use to fill the Business picker on a create ' +
      'form, to label rows that name a Business, and to offer a Business filter. Returns only ' +
      'what the caller is authorized over — never the whole Organization for a principal that ' +
      'is not authorized over the whole Organization.',
    permission: BUSINESS_READ_PERMISSION,
    // `business` scope, matching the contract. The authorized set is the narrowing, and it is
    // applied by `0020` before this handler is reached.
    scope: 'business',
    // ALL THREE ARE THE CONTRACT'S DECLARED VALUES. `sensitivity: 'read'` is the one that must
    // agree with `maxRowWrites: 0` — a read that declared a write budget, or a write that
    // declared read sensitivity, is the mismatch the POST method invites on the resolve Action.
    sensitivity: 'read',
    // NOT idempotent, per the contract. A repeated call may legitimately answer differently:
    // the authorized business set is recomputed per request (`0020`), so a Business added or a
    // membership revoked between two calls changes the answer.
    idempotent: false,
    exposure: ['internal', 'public'],
    audit: false,
    auditOnDenial: false,
    maxRowWrites: 0,
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    parseInput(raw: unknown): Result<ListInput> {
      if (typeof raw !== 'object' || raw === null) {
        return err(invalidArgument([detail('', 'must_be_an_object')]));
      }
      const value = raw as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (key !== 'page_size' && key !== 'cursor') {
          // `additionalProperties: false`, enforced rather than documented.
          return err(invalidArgument([detail(key, 'unknown_field')]));
        }
      }
      let pageSize = DEFAULT_PAGE_SIZE;
      if (value.page_size !== undefined) {
        if (
          typeof value.page_size !== 'number' ||
          !Number.isInteger(value.page_size) ||
          value.page_size < 1 ||
          value.page_size > MAX_PAGE_SIZE
        ) {
          return err(invalidArgument([detail('page_size', 'out_of_range')]));
        }
        pageSize = value.page_size;
      }
      if (value.cursor !== undefined && typeof value.cursor !== 'string') {
        return err(invalidArgument([detail('cursor', 'must_be_a_string')]));
      }
      return ok({
        pageSize,
        cursor: typeof value.cursor === 'string' ? value.cursor : null,
      });
    },
    targetIdentifier(): string | null {
      // This Action names no existing record, so a denial record has no caller-supplied
      // resource identifier to carry.
      return null;
    },
    async handle(context: ActionContext, input: ListInput) {
      // ONE TOTAL ORDER, APPLIED HERE. `display_name` is null for every row today, so this is
      // `business_id` ascending — stated as the full rule so the day names exist changes the
      // data and not this code.
      const ordered = [...context.authorizedBusinessIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      // ===================================================================================
      // THE CURSOR IS A POSITION, NEVER A SCOPE — and this Action deliberately issues NONE.
      // ===================================================================================
      //
      // `MAX_AUTHORIZED_BUSINESSES` bounds the authorized set at 500 and `page_size` at 100, so
      // a principal authorized over more than one page cannot reach the rest. THAT IS A REAL
      // LIMIT AND IT IS REPORTED RATHER THAN HIDDEN BEHIND A NULL CURSOR THAT LOOKS COMPLETE:
      // paging this Action requires an offset the authorized set does not carry, and inventing
      // one that encoded a position into a set rebuilt per request would be a cursor that means
      // something different on the next request. Recorded for the Team Lead; at the closed
      // beta's scale (`MULTITENANCY_STANDARD.md` §7.5) no tenant approaches 100 Businesses.
      const page = ordered.slice(0, input.pageSize);

      return ok({
        output: {
          data: page.map((businessId) => ({
            business_id: businessId,
            // PRESENT AND NULL. Never omitted — absent-versus-null is a distinction two
            // clients resolve differently.
            display_name: null,
          })),
          next_cursor: null,
        },
        writes: [],
        // NO WRITES AND NO AUDIT SUBJECT. `audit: false` on both Actions, so the pipeline
        // writes no record — but `AuditFacts` is required by the type rather than nullable, so
        // the empty facts are stated explicitly. `targetResourceId` is null because neither
        // Action names an existing record, and `relatedBusinessIds` is empty because listing
        // the caller's own authorized set into an audit row would put the answer in the log.
        audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] },
      });
    },
  };
}

type ResolveInput = {
  readonly businessIds: readonly string[];
};

type BusinessReference = {
  readonly business_id: string;
  readonly display_name: string | null;
  readonly resolution: 'resolved' | 'unresolved';
};

type ResolveOutput = {
  readonly data: readonly BusinessReference[];
};

/**
 * ===========================================================================================
 * `core.ResolveBusinessReferences` — POST /businesses/names
 * ===========================================================================================
 *
 * THE RESPONSE IS POSITIONAL AND COMPLETE: exactly one entry per requested identifier, in
 * request order, always. An entry is never omitted, reordered, deduplicated or collapsed.
 * The contract states why in one sentence and it is the reason this handler is shaped as a
 * `map` over the input rather than a filter: *"Omitting unresolvable entries would rebuild the
 * existence oracle out of array length, with no error code anywhere to make it visible in
 * review."*
 *
 * `unresolved` COVERS ALL THREE CASES AND THE ABSENCE OF A THIRD ENUM MEMBER IS THE SECURITY
 * PROPERTY — the Business does not exist, it exists in another Organization, or it exists in
 * this one and the principal is not authorized over it. **This handler cannot tell them apart
 * either**, because it only ever consults `context.authorizedBusinessIds` and never reads
 * storage. The indistinguishability is structural rather than a branch someone wrote correctly.
 *
 * A MALFORMED IDENTIFIER IS REJECTED AT VALIDATION AND IS NOT ANSWERED `unresolved`. The two are
 * different facts, and answering a malformed value on the success path would let a caller probe
 * the identifier grammar through a field designed to disclose nothing.
 *
 * `forbidden` MEANS ONE THING ONLY on this Action — the caller does not hold
 * `core.business.read` — and it is decided at pipeline step 3, before any identifier is looked
 * at.
 */
export function createResolveBusinessReferencesAction(): ActionDefinition<
  ResolveInput,
  ResolveOutput
> {
  return {
    appId: CORE_APP_ID,
    id: 'core.ResolveBusinessReferences',
    title: 'Resolve business names',
    description:
      'Given up to 25 business identifiers, return each one’s name so that a customer row ' +
      'or a customer record can be labelled. Use when identifiers are already in hand — a page ' +
      'of customers, a deep link, a stored selection — rather than listing every Business. An ' +
      'identifier the signed-in principal is not authorized over is returned marked unresolved, ' +
      'never omitted and never an error.',
    permission: BUSINESS_READ_PERMISSION,
    scope: 'business',
    // ALL THREE ARE THE CONTRACT'S DECLARED VALUES. `sensitivity: 'read'` is the one that must
    // agree with `maxRowWrites: 0` — a read that declared a write budget, or a write that
    // declared read sensitivity, is the mismatch the POST method invites on the resolve Action.
    sensitivity: 'read',
    // NOT idempotent, per the contract. A repeated call may legitimately answer differently:
    // the authorized business set is recomputed per request (`0020`), so a Business added or a
    // membership revoked between two calls changes the answer.
    idempotent: false,
    exposure: ['internal', 'public'],
    audit: false,
    auditOnDenial: false,
    // ZERO, AND IT IS A `POST`. See the file header: the method does not decide this, and
    // `pipeline.ts` gates the write-admission path on writes actually produced.
    maxRowWrites: 0,
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    parseInput(raw: unknown): Result<ResolveInput> {
      if (typeof raw !== 'object' || raw === null) {
        return err(invalidArgument([detail('', 'must_be_an_object')]));
      }
      const value = raw as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (key !== 'business_ids') {
          return err(invalidArgument([detail(key, 'unknown_field')]));
        }
      }
      const ids = value.business_ids;
      if (!Array.isArray(ids)) {
        return err(invalidArgument([detail('business_ids', 'must_be_an_array')]));
      }
      if (ids.length < 1 || ids.length > MAX_REFERENCES) {
        // An empty array and more than 25 are both `invalid_argument`, per the contract.
        return err(invalidArgument([detail('business_ids', 'out_of_range')]));
      }
      const seen = new Set<string>();
      for (const candidate of ids) {
        if (typeof candidate !== 'string' || !BUSINESS_ID_PATTERN.test(candidate)) {
          // THE FIELD NAME AND A STABLE TOKEN, NEVER THE VALUE. `detail()` has no parameter
          // for one, so a rejected identifier cannot reach a log or an error body.
          return err(invalidArgument([detail('business_ids', 'invalid_identifier')]));
        }
        if (seen.has(candidate)) {
          // A duplicate is `invalid_argument` per the contract. Deduplicating instead would
          // break the positional guarantee, and answering twice would be answering a question
          // the caller did not ask.
          return err(invalidArgument([detail('business_ids', 'duplicate_identifier')]));
        }
        seen.add(candidate);
      }
      return ok({ businessIds: ids as readonly string[] });
    },
    targetIdentifier(): string | null {
      // NOT the requested identifiers. `0013` control 5: the caller controls them, so putting
      // one in a denial record would mint unbounded groups.
      return null;
    },
    async handle(context: ActionContext, input: ResolveInput) {
      const authorized = new Set(context.authorizedBusinessIds);
      return ok({
        output: {
          // A `map`, NEVER A FILTER. One entry per requested identifier, in request order.
          data: input.businessIds.map((businessId) => ({
            business_id: businessId,
            display_name: null,
            resolution: authorized.has(businessId)
              ? ('resolved' as const)
              : ('unresolved' as const),
          })),
        },
        writes: [],
        // NO WRITES AND NO AUDIT SUBJECT. `audit: false` on both Actions, so the pipeline
        // writes no record — but `AuditFacts` is required by the type rather than nullable, so
        // the empty facts are stated explicitly. `targetResourceId` is null because neither
        // Action names an existing record, and `relatedBusinessIds` is empty because listing
        // the caller's own authorized set into an audit row would put the answer in the log.
        audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] },
      });
    },
  };
}
