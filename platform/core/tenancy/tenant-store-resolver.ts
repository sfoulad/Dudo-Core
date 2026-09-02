/**
 * `TenantStoreResolver` — the mandatory indirection.
 *
 * docs/decisions/0006 §0.2, Accepted by explicit user decision, and restated as binding in
 * MULTITENANCY_STANDARD.md §7.2. It is quoted rather than paraphrased because every clause
 * is implemented below:
 *
 *   - "Apps, plugins, Connectors, and clients cannot select a database or a binding."
 *     There is no parameter, header, manifest field or SDK call that reaches this function,
 *     and the only caller is the Core pipeline, which passes the value it took from the
 *     authenticated principal.
 *   - "Unknown Organization mappings fail closed." An Organization with no entry, or an
 *     entry that is not `active`, gets `unavailable` and no handle. There is no fallback
 *     binding, no default database, and no "probably the shared one".
 *   - "The resolver returns only bindings configured and approved by Core." A binding is
 *     reachable only if the composition root put it in the map this resolver was built
 *     with.
 *   - "Moving from A to C must not change business-domain code or public contracts." The
 *     return type is `TenantScopedStore`. Today every Organization maps to one binding;
 *     when that stops being true, this file changes and nothing above it does.
 *
 * WHY THE INDIRECTION EXISTS WHEN IT CURRENTLY HAS ONE ANSWER. 0006 §0.2 anticipates the
 * question and answers it: the value is that the day a second binding exists, no business
 * code has to learn about it. A resolver added after Phase 4 is a resolver added to code
 * already shaped by there being exactly one database.
 *
 * WHAT IS NOT BUILT HERE. `TenantDirectoryEntry` (core-object-registry.yaml, phase 1,
 * status proposed) is the persistent form of this mapping and is tenant-INDEPENDENT
 * platform data, so it belongs in the control-plane database rather than the shared tenant
 * database. That database and its schema are Core's identity/tenancy slice and are not in
 * this slice's scope. `createStaticTenantStoreResolver` takes the mapping as configuration
 * instead. Swapping it for a directory-backed resolver is a change to this file alone —
 * and it will need its own isolation test, because MULTITENANCY_STANDARD.md §7.6 makes the
 * resolver an isolation boundary in its own right.
 */

import type { TenantScopedStore } from '../storage/store.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unavailable } from '../kernel/errors.ts';

/**
 * A Core-configured binding, named for the port it serves rather than the vendor product
 * (CLOUDFLARE_STANDARD.md §9: `DB_PLATFORM` and `FILES`, not `MY_D1` and `MY_R2`).
 */
export type StoreBindingName = string;

export type TenantStoreMappingState = 'active' | 'suspended' | 'migrating';

export type TenantStoreMapping = {
  readonly organizationId: string;
  readonly bindingName: StoreBindingName;
  readonly state: TenantStoreMappingState;
};

/**
 * Builds a tenant-bound handle over a named binding. Supplied by the composition root, so
 * that this file names no storage engine and no vendor type.
 */
export type TenantStoreFactory = (
  bindingName: StoreBindingName,
  organizationId: string,
) => TenantScopedStore | undefined;

export type TenantStoreResolver = {
  /**
   * Returns `unavailable` for an Organization with no active mapping, and NEVER a handle.
   *
   * The three failing cases below — no entry, an entry that is not active, and an entry
   * naming a binding that was not configured — deliberately produce the SAME answer. A
   * caller must not be able to distinguish "suspended" from "unknown", and the only
   * principal that can reach this call is one already authenticated INTO that Organization,
   * so there is no second tenant to protect and nothing is disclosed either way.
   *
   * `unavailable` rather than `not_found` because that is what is true: the request was
   * for the caller's own Organization, and its storage could not be reached. A `not_found`
   * would tell an Organization that it does not exist.
   */
  resolve(organizationId: string): Promise<Result<TenantScopedStore>>;
};

export function createStaticTenantStoreResolver(
  mappings: readonly TenantStoreMapping[],
  factory: TenantStoreFactory,
): TenantStoreResolver {
  const byOrganization = new Map<string, TenantStoreMapping>();
  for (const mapping of mappings) {
    byOrganization.set(mapping.organizationId, mapping);
  }

  return {
    async resolve(organizationId: string): Promise<Result<TenantScopedStore>> {
      const mapping = byOrganization.get(organizationId);
      // Fail closed: no entry.
      if (mapping === undefined) {
        return err(unavailable());
      }
      // Fail closed: an entry that is not active. A suspended or mid-migration
      // Organization is not served from "the other one".
      if (mapping.state !== 'active') {
        return err(unavailable());
      }
      const store = factory(mapping.bindingName, organizationId);
      // Fail closed: a mapping naming a binding the composition root did not configure.
      // A mapping is data and data can be wrong; a resolver that guessed here would be the
      // one component 0006 §4.3 identifies as the whole failure surface under Option B, and
      // it is no safer under A.
      if (store === undefined) {
        return err(unavailable());
      }
      return ok(store);
    },
  };
}
