/**
 * customers.ArchiveCustomer
 *
 * THIS NEVER DELETES DATA AND STARTS NO CLOCK. An archived customer is retained
 * INDEFINITELY: no elapsed time, no quota, no inactivity and no background job moves a
 * record out of `archived`. Only an explicit `DeleteCustomer` ever ends that, and
 * `DeleteCustomer` is out of scope for this slice (contract §11.1).
 *
 * `deletion_scheduled_at` IS NOT SET HERE AND MUST NEVER BE. It is non-null if and only if
 * status is `pending_deletion`, and null in every other state including `archived` — "an
 * archived record has no scheduled deletion, and a field implying otherwise would restate
 * the countdown the decision removed." The table's CHECK constraint enforces the same
 * invariant, so this is guaranteed twice: by what this handler writes, and by what the
 * engine will accept.
 *
 * THE TRANSITION IS STRICT. Archiving an already-archived customer is `failed_precondition`
 * rather than succeeding as a no-op, and the trade is accepted rather than overlooked: a
 * retried archive after a network failure returns an error the client must treat as
 * success, but the permissive alternative writes an audit record saying a customer was
 * archived when nothing changed.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { failedPrecondition } from '../../../platform/core/kernel/errors.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer } from '../domain/customer.ts';
import { canArchive } from '../domain/customer.ts';
import { ARCHIVE_CUSTOMER_RULE } from '../domain/validation.ts';
import { toCustomer, updateOperation } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';
import { APP_ID, PERMISSION, rawCustomerId, resolveAuthorizedCustomer } from './common.ts';

type ArchiveCustomerInput = { readonly customer_id: string };

export function createArchiveCustomerAction(): ActionDefinition<ArchiveCustomerInput, Customer> {
  return {
    id: 'customers.ArchiveCustomer',
    appId: APP_ID,
    title: 'Archive customer',
    description:
      'Withdraw a customer from active use while keeping the record. Use when an Organization ' +
      'stops doing business with a customer. The record remains readable by identifier and ' +
      'restorable; it is removed from the default listing and the default search. This never ' +
      'deletes data and starts no clock: an archived customer is retained indefinitely.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'failed_precondition',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: PERMISSION.archive,
    scope: 'business',
    sensitivity: 'sensitive',
    idempotent: false,
    audit: true,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<ArchiveCustomerInput> {
      const validated = validateObject(raw, ARCHIVE_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      return ok({ customer_id: validated.value.customer_id as string });
    },
    targetIdentifier(raw: unknown): string | null {
      return rawCustomerId(raw);
    },
    async handle(context: ActionContext, input: ArchiveCustomerInput) {
      const resolved = await resolveAuthorizedCustomer(context, input.customer_id);
      if (!resolved.ok) {
        return err(resolved.error);
      }
      const existing = toCustomer(resolved.value);

      // Step 6. `archived` and `pending_deletion` both fail here: archiving a record under a
      // destruction order is refused too, because cancelling the deletion returns it to
      // `archived` anyway.
      if (!canArchive(existing.status)) {
        return err(failedPrecondition());
      }

      const now = context.clock.now();

      // THERE IS NO `archived_at` OR `archived_by` FIELD. `updated_at` and
      // `updated_by_principal_id` carry it and the audit record carries the rest; dedicated
      // fields would be inventing beyond the agreed field set.
      const write = updateOperation(input.customer_id, {
        [COLUMN.status]: 'archived',
        [COLUMN.updatedAt]: now,
        [COLUMN.updatedByPrincipalId]: context.principalId,
      });

      const output: Customer = {
        ...existing,
        status: 'archived',
        updated_at: now,
        updated_by_principal_id: context.principalId,
      };

      return ok({
        output,
        writes: [write],
        audit: {
          targetResourceId: input.customer_id,
          relatedBusinessIds: [existing.business_id],
          changedFieldNames: ['status'],
        },
      });
    },
  };
}
