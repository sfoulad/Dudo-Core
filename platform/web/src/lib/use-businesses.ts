/**
 * The signed-in principal's authorized Business set.
 *
 * One hook so every screen loads it the same way and, more importantly, treats
 * the EMPTY set the same way. The contract is explicit that an empty result is
 * valid, reachable and currently universal — Core ships a deny-all
 * authorization source — and that both clients must render it as a first-class
 * state rather than as a loading failure.
 */

import { useEffect, useState } from 'react';
import type { CustomerDirectoryClient } from '@/api/client';
import type { BusinessSummary } from '@/contracts/business-read';
import { toApiError, type ApiError } from '@/api/errors';

export interface BusinessesState {
  businesses: BusinessSummary[];
  loading: boolean;
  error: ApiError | null;
  /** Distinct from `loading`: settled, no error, and the set is genuinely empty. */
  isEmpty: boolean;
}

export function useAuthorizedBusinesses(client: CustomerDirectoryClient): BusinessesState {
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    client
      .listAuthorizedBusinesses()
      .then((result) => {
        if (!cancelled) setBusinesses(result);
      })
      .catch((thrown) => {
        if (!cancelled) setError(toApiError(thrown));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return { businesses, loading, error, isEmpty: !loading && !error && businesses.length === 0 };
}

/**
 * A lookup that applies the contract's normative rendering rule.
 *
 * Returns the recorded name, or the `business_id` VERBATIM when no name is
 * recorded — which is every Business today. An identifier this map has never
 * seen also renders verbatim rather than as a blank, because a reference whose
 * name is unknown is honestly rendered as its identifier.
 */
export function makeBusinessLabeller(
  businesses: BusinessSummary[],
): (businessId: string) => string {
  const byId = new Map(businesses.map((business) => [business.business_id, business]));
  return (businessId: string) => byId.get(businessId)?.display_name ?? businessId;
}
