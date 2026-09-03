/**
 * A `TenantStoreResolver` backed by the control plane's tenant directory.
 *
 * `tenant-store-resolver.ts` has carried this note since it was written: "`TenantDirectoryEntry`
 * is the persistent form of this mapping ... it belongs in the control-plane database rather
 * than the shared tenant database. That database and its schema are Core's identity/tenancy
 * slice and are not in this slice's scope. `createStaticTenantStoreResolver` takes the mapping
 * as configuration instead. Swapping it for a directory-backed resolver is a change to this file
 * alone — and it will need its own isolation test, because MULTITENANCY_STANDARD.md §7.6 makes
 * the resolver an isolation boundary in its own right."
 *
 * `docs/decisions/0014` §C.3 is that slice, and this is that swap. It is a NEW FILE rather than
 * an edit to `tenant-store-resolver.ts` for a reason worth stating: the static resolver is not
 * obsolete. It is what a verification harness uses, it is the second implementation that proves
 * the port is not shaped around one storage engine, and deleting it would leave the isolation
 * boundary with exactly one implementation and no way to test it without a database.
 *
 * ===========================================================================================
 * WHAT DID NOT CHANGE, AND THE FACT THAT NOTHING DID IS THE POINT
 * ===========================================================================================
 *
 * The port is byte-for-byte the one the pipeline already calls: `resolve(organizationId)` in,
 * `Result<TenantScopedStore>` out, `unavailable()` for every failure. `platform/core/action/**`
 * and `platform/core/http/**` are untouched by this work. §C.5's resolution order —
 * `... -> authorized Organization/business context -> TenantStoreResolver -> business data` — is
 * satisfied by the identity layer having validated the Organization against membership BEFORE
 * the pipeline reaches this call, not by this file learning about identity.
 *
 * THIS RESOLVER RECEIVES ONLY `TenantDirectoryStore`, NEVER THE IDENTITY HALF. It therefore
 * cannot read a session, cannot enumerate a principal's Organizations, and cannot be turned into
 * a route to either by a later edit that notices it "already has a control-plane handle". That
 * split is enforced by the type, and is why `control-plane-store.ts` exposes two interfaces
 * instead of one.
 *
 * ===========================================================================================
 * FAIL CLOSED, IN THE SAME FOUR PLACES AND WITH THE SAME SINGLE ANSWER
 * ===========================================================================================
 *
 * `docs/decisions/0006` §0.2: "unknown Organization mappings fail closed", and "the resolver
 * returns only bindings configured and approved by Core". A directory read adds one failure mode
 * the static resolver did not have — the directory itself being unreachable — and it collapses
 * into the same answer as the rest. Five conditions, one `unavailable()`:
 *
 *   1. the directory could not be read;
 *   2. the Organization has no entry;
 *   3. the entry is not `active` (suspended, or mid-migration);
 *   4. the entry names a binding the composition root did not configure;
 *   5. the factory declined to build a handle.
 *
 * `unavailable()` rather than `not_found()` because that is what is true, and the argument is
 * `tenant-store-resolver.ts`'s unchanged: the only principal that can reach this call is one the
 * identity layer already authenticated INTO that Organization, so there is no second tenant to
 * protect. A `not_found` here would tell an Organization that it does not exist.
 *
 * ===========================================================================================
 * COST, because this read is on the path of EVERY authenticated request
 * ===========================================================================================
 *
 * One point lookup on a primary key, per request, against the control-plane database. It is a
 * ROW READ, not a row write: the free daily row-read allowance is 5,000,000 against 100,000 for
 * writes (`docs/operations/free-tier-register.md`), so this is roughly two orders of magnitude
 * cheaper than the cheapest write and does not interact with `0014` §A's budget at all.
 *
 * NOTHING IS CACHED HERE, DELIBERATELY. A cached tenant-to-binding mapping is a stale answer
 * about where an Organization's data lives, and the failure mode of a stale mapping is serving
 * one Organization from another Organization's binding — a cross-tenant read produced by a
 * performance optimisation. If the read ever needs to be avoided, the answer is a mechanism with
 * an explicit invalidation story and a decision record behind it, not a map in this closure.
 */

import type { TenantScopedStore } from '../storage/store.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { unavailable } from '../kernel/errors.ts';
import type { TenantDirectoryStore } from '../identity/control-plane-store.ts';
import type { TenantStoreFactory, TenantStoreResolver } from './tenant-store-resolver.ts';

export function createDirectoryTenantStoreResolver(
  directory: TenantDirectoryStore,
  factory: TenantStoreFactory,
): TenantStoreResolver {
  return {
    async resolve(organizationId: string): Promise<Result<TenantScopedStore>> {
      const entry = await directory.findEntry(organizationId);
      // 1. The directory could not be read. Not distinguished from an absent entry: a caller
      //    must not be able to tell "the control plane is down" from "you have no mapping",
      //    and neither answer is actionable for it.
      if (!entry.ok) {
        return err(unavailable());
      }
      const mapping = entry.value;
      // 2. No entry.
      if (mapping === null) {
        return err(unavailable());
      }
      // 3. An entry that is not active. A suspended or mid-migration Organization is not
      //    served from "the other one".
      if (mapping.state !== 'active') {
        return err(unavailable());
      }
      // 4 and 5. A mapping is data, and data can be wrong. A resolver that guessed a binding
      //    here would be the single component `0006` §4.3 identifies as the whole failure
      //    surface, and it is no safer under Option A than under B.
      const store = factory(mapping.bindingName, organizationId);
      if (store === undefined) {
        return err(unavailable());
      }
      return ok(store);
    },
  };
}
