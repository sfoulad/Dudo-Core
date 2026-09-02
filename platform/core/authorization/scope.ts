/**
 * The scope ladder.
 *
 * AUTHORIZATION_STANDARD.md §4, and `permission-catalog.yaml` carries the same set
 * machine-readably. The two rules that matter:
 *
 *   "A scope grant at a level implies the levels beneath it, and never above it."
 *   "A scope never crosses a tenant."
 *
 * The second is not implemented here, and deliberately so. `platform` is the only scope
 * that spans Organizations, and this ladder does not give it a way to reach tenant data:
 * the tenant predicate is applied by the storage boundary from the authenticated
 * Organization, so a `platform` grant widens which permissions a principal holds and never
 * which rows exist. The break-glass elevation that would change that is AZ3 and does not
 * exist. Nothing in this slice creates a path to it.
 *
 * WHY THE ORDER IS EXPRESSED AS RANKS. `implies()` is the only comparison in the system,
 * so "evaluating at the wrong level is a silent privilege escalation" (§4) becomes a
 * property of one function rather than of every call site that compares two strings.
 */

export type Scope =
  | 'platform'
  | 'organization'
  | 'business'
  | 'branch'
  | 'team'
  | 'own'
  | 'resource';

/**
 * Widest first. A LOWER rank is a WIDER grant.
 *
 * `own` and `resource` sit at the bottom and are deliberately NOT comparable to the
 * structural levels in a way that lets them satisfy one: `own` means "records the
 * principal created or is assigned to", which is a different axis from "one Business". The
 * ranking below would let an `organization` grant satisfy an `own`-scoped Action, which is
 * correct — a principal with authority over the whole Organization certainly has authority
 * over its own records — but never the reverse.
 *
 * No Action in the Customer Directory contract uses `own`, and the contract records that
 * as load-bearing: the Customer entity declares no ownership relation, so if `own` were
 * ever added, VAL-OWN fails closed rather than silently borrowing `created_by_principal_id`
 * or `business_id` as an ownership relation nobody designed.
 */
const SCOPE_RANK: Readonly<Record<Scope, number>> = {
  platform: 0,
  organization: 1,
  business: 2,
  branch: 3,
  team: 4,
  own: 5,
  resource: 6,
};

/**
 * True when a grant held at `granted` satisfies an Action evaluated at `required`.
 *
 * Worked, because this is the function the Customer Directory's CD-2 decision turns on:
 *   implies('organization', 'business') === true
 *     a business-owner holding customers.customer.read at organization scope satisfies the
 *     six record-level Actions, which evaluate at `business`, for every Business in its
 *     Organization.
 *   implies('business', 'business') === true
 *     a business-admin holding it at business scope satisfies them, and step 5b then
 *     narrows to its assigned Business.
 *   implies('business', 'organization') === false
 *     a business-scope principal cannot reach MoveCustomerToBusiness, which evaluates at
 *     `organization`. That is the contract's intended outcome, not a gap: a move spans two
 *     Businesses and a business-scope grant is authority over one.
 */
export function implies(granted: Scope, required: Scope): boolean {
  return SCOPE_RANK[granted] <= SCOPE_RANK[required];
}
