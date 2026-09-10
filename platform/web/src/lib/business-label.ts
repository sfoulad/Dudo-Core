/**
 * How a Business is named on screen.
 *
 * WAS `lib/use-businesses.ts`, WHICH ALSO HELD A HOOK. The hook — one
 * `useEffect`, four `useState`, and a cancellation flag — became
 * `useAuthorizedBusinesses` in `lib/queries.ts`, where one cache entry serves
 * the directory, the create form and every return to either instead of issuing
 * a fresh request per mount. What is left is pure and has no `use` prefix
 * because it is not a hook.
 *
 * THE RULE IT APPLIES IS THE CONTRACT'S AND IS NORMATIVE ON BOTH CLIENTS:
 * return the recorded name, or the `business_id` VERBATIM when no name is
 * recorded — which is every Business today. An identifier this map has never
 * seen also renders verbatim rather than as a blank, because a reference whose
 * name is unknown is honestly rendered as its identifier, and a client must
 * never infer existence from a name.
 */

import type { BusinessSummary } from '@/contracts/business-read';

export function makeBusinessLabeller(
  businesses: BusinessSummary[],
): (businessId: string) => string {
  const byId = new Map(businesses.map((business) => [business.business_id, business]));
  return (businessId: string) => byId.get(businessId)?.display_name ?? businessId;
}
