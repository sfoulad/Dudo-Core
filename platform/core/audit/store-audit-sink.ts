/**
 * The audit sink backed by the tenant-scoped storage boundary.
 *
 * The sink is bound to the same `TenantScopedStore` as the request that produced the
 * entry, so an audit record lands in the acting principal's Organization and can land
 * nowhere else — the `tenant_id` column is set by the boundary, from the handle, and this
 * file has no value to set it with even if it wanted to.
 *
 * That is what satisfies az7-r3's requirement for a cross-tenant attempt: the attempt is
 * audited IN THE CALLER'S TENANT, and nothing of the other tenant is disclosed to it,
 * because nothing of the other tenant was ever read.
 *
 * `relatedBusinessIds` and `changedFieldNames` are stored as JSON arrays in a single
 * column each. A normalised child table would be more queryable and is not worth its cost
 * here: both are small, both are read as a unit, and a second table doubles the write
 * count on every audited Action against a 50-queries-per-invocation budget on a
 * single-threaded database. If audit querying ever needs it, that is a Core migration, not
 * a change to what is recorded.
 */

import type { AuditEntry, AuditSink } from './audit.ts';
import { AUDIT_TABLE, assertActorBusinessContext, assertChangedFieldNames } from './audit.ts';
import type { TenantScopedStore, WriteOperation } from '../storage/store.ts';
import type { Result } from '../kernel/result.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { WriteReservation } from '../protection/write-admission.ts';

export function createStoreAuditSink(
  store: TenantScopedStore,
  ids: IdGenerator,
): AuditSink {
  function toOperation(entry: AuditEntry): WriteOperation {
    assertChangedFieldNames(entry.changedFieldNames);
    // The runtime half of the actor-context guard. This repository has no type-check step, so
    // the nominal type alone would be a comment; here an actor context assembled from anything
    // other than the authenticated principal stops the write instead of being stored.
    assertActorBusinessContext(entry.actorBusinessIds);
    return {
      kind: 'insert',
      spec: {
        table: AUDIT_TABLE,
        values: {
          audit_event_id: ids.generate(),
          occurred_at: entry.occurredAt,
          app_id: entry.appId,
          action_id: entry.actionId,
          principal_id: entry.principalId,
          principal_type: entry.principalType,
          on_behalf_of_principal_id: entry.onBehalfOfPrincipalId,
          permission_id: entry.permissionId,
          scope: entry.scope,
          decision: entry.decision,
          denial_reason: entry.denialReason,
          target_resource_id: entry.targetResourceId,
          target_unresolved: entry.targetUnresolved ? 1 : 0,
          related_business_ids: JSON.stringify(entry.relatedBusinessIds),
          // The brand is a non-enumerable symbol property, so it does not serialise: what
          // lands in the column is a plain JSON array of the caller's own Business ids.
          actor_business_ids: JSON.stringify(entry.actorBusinessIds),
          changed_field_names: JSON.stringify(entry.changedFieldNames),
          request_id: entry.requestId,
          correlation_id: entry.correlationId,
        },
      },
    };
  }

  return {
    operation(entry: AuditEntry): WriteOperation {
      return toOperation(entry);
    },
    /**
     * The standalone path, for an audited event with no mutation to ride along with. It needs
     * its own reservation because an audit row is a D1 write like any other — five estimated
     * row-writes, the most expensive row in the platform (`storage/write-cost.ts`) — and
     * docs/decisions/0014 §A.11 admits no exception for evidence.
     *
     * NOT REACHED FROM `pipeline.ts`, which uses `operation()` so that the audit record commits
     * in the same transaction as the mutation it describes.
     */
    async append(entry: AuditEntry, reservation: WriteReservation): Promise<Result<void>> {
      return store.write([toOperation(entry)], reservation);
    },
  };
}
