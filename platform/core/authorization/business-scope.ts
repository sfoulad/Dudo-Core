/**
 * Steps 5b and 5c of the normative evaluation order: authorizing a Business.
 *
 * These are the ONLY record-dependent authorization decisions in the Customer Directory
 * contract, and they are in their own file, separate from `authorizer.ts`, precisely so
 * that the record-independent check at step 3 cannot be confused with them. Step 3's
 * `forbidden` can never be correlated with a record's existence. These two can — inside
 * one tenant, deliberately, and the contract argues the case at length
 * (README.md §3.2, authorizationModel.notFoundVersusForbidden.wrongBusiness).
 *
 * THE TWO ANSWERS, AND WHY THEY DIFFER.
 *
 * `not_found` exists to stop one company learning a fact about ANOTHER company's data.
 * Inside one Organization there is no second party: the Organization owns every one of
 * these records and is the party in a data-protection complaint about them. So the rule is
 * not copied downward by reflex.
 *
 * The deciding argument is operational and it runs the other way from habit. Told
 * `not_found`, a business-admin concludes the customer is not in the system and has staff
 * re-enter it — producing a duplicate inside the same Organization, in a different
 * Business, with a divergent address and its own future invoices. This contract has no
 * duplicate detection, so nothing catches it. That is silent corruption of the tenant's own
 * directory, caused by the platform lying to it about its own data. Told `forbidden`, the
 * same person asks for access or for a move.
 *
 * THE PROPERTY THIS COULD HAVE BROKEN, AND WHERE IT IS KEPT. `forbidden` is reachable from
 * `authorizeResolvedBusiness` ONLY, and that function is called only on a row the storage
 * boundary has already returned — which means the row is in the caller's own Organization.
 * A foreign Organization's identifier, and one that exists nowhere, both terminate earlier
 * at step 5 with the same `not_found` and never reach this file. The partition is
 * in-tenant versus everything else, never one tenant versus another.
 *
 * `forbidden` carries no argument (kernel/errors.ts), so neither of these functions can
 * disclose which Business was refused. The audit record has the same restriction and for
 * the same reason: telling the log which Business the caller was refused hands to a log
 * reader the disclosure the refusal withheld.
 */

import type { CoreError } from '../kernel/errors.ts';
import { forbidden, notFound } from '../kernel/errors.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { TenantScopedStore } from '../storage/store.ts';
import type { BusinessDirectory } from '../tenancy/business-directory.ts';

/**
 * STEP 5b. The Business of a row already resolved inside the tenant.
 *
 * Two outcomes only. `not_found` is unreachable from here and that is structural: the
 * caller has a row, so the record exists in this tenant, so "does not exist" is not one of
 * the true answers.
 */
export function authorizeResolvedBusiness(
  authorizedBusinessIds: readonly string[],
  recordBusinessId: string,
): Result<void> {
  if (authorizedBusinessIds.includes(recordBusinessId)) {
    return ok(undefined);
  }
  return err(forbidden());
}

/**
 * STEP 5c. A Business named by the CALLER — on create, on move, and as a list or search
 * filter.
 *
 * Three outcomes, in this order, and the order is the whole correctness of it:
 *
 *   1. In the principal's authorized set -> allowed. Membership of that set already
 *      implies the Business is in this Organization, so no lookup is needed and none is
 *      made. This is also the hot path.
 *   2. Not in the set, but present in this Organization -> `forbidden`. The caller asserted
 *      a scope it does not hold and deserves a straight answer.
 *   3. Not in this Organization, or nowhere at all -> `not_found`, byte-identical.
 *
 * A CLIENT-SUPPLIED business_id SELECTS WITHIN THE AUTHORIZED SET; IT NEVER WIDENS IT
 * (CD-11). There is no branch below that adds to `authorizedBusinessIds`, and the set
 * itself comes from the authenticated context and is never read from the request.
 */
export async function authorizeSuppliedBusiness(
  store: TenantScopedStore,
  directory: BusinessDirectory,
  authorizedBusinessIds: readonly string[],
  suppliedBusinessId: string,
): Promise<Result<void>> {
  if (authorizedBusinessIds.includes(suppliedBusinessId)) {
    return ok(undefined);
  }

  const exists = await directory.existsInTenant(store, suppliedBusinessId);
  if (!exists.ok) {
    // The lookup itself failed. Fail closed with the storage error rather than guessing an
    // answer; guessing `forbidden` would assert existence and guessing `not_found` would
    // deny a Business that is really there.
    return err(exists.error);
  }

  const outcome: CoreError = exists.value ? forbidden() : notFound();
  return err(outcome);
}
