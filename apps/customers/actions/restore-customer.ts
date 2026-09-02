/**
 * customers.RestoreCustomer
 *
 * `archived` -> `active`. Anything else is `failed_precondition`.
 *
 * IT REFUSES `pending_deletion`, AND THAT IS NOT AN INCONSISTENCY WITH ARCHIVE. It is
 * deliberate separation. This Action's permission, `customers.customer.restore`, is
 * declared at `[organization, business]` and evaluated at `business`; countermanding an
 * organization-level destruction order is `customers.customer.restore-deleted` at
 * organization scope. If this Action accepted `pending_deletion`, a business-scope
 * principal could reverse a deletion an organization-scope principal ordered — a scope
 * escalation wearing a familiar name.
 *
 * Nothing in this slice can reach `pending_deletion`, so that branch is unreachable today.
 * It is written anyway, because on the day the deletion Actions are built it must already
 * be right, and because `canRestore` is where a future author would otherwise be tempted to
 * "simplify".
 *
 * Restoring an already-active customer is `failed_precondition`, symmetrically with archive
 * and for the same reason.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { failedPrecondition } from '../../../platform/core/kernel/errors.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer } from '../domain/customer.ts';
import { canRestore } from '../domain/customer.ts';
import { RESTORE_CUSTOMER_RULE } from '../domain/validation.ts';
import { toCustomer, updateOperation } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';
import { APP_ID, PERMISSION, rawCustomerId, resolveAuthorizedCustomer } from './common.ts';

type RestoreCustomerInput = { readonly customer_id: string };

export function createRestoreCustomerAction(): ActionDefinition<RestoreCustomerInput, Customer> {
  return {
    id: 'customers.RestoreCustomer',
    appId: APP_ID,
    title: 'Restore customer',
    description:
      'Return an archived customer to active use. Use when an Organization resumes business ' +
      'with a customer that was archived. The record reappears in the default listing and the ' +
      'default search. Does not apply to a customer whose permanent deletion has been ordered — ' +
      'cancelling that is a separate operation.',
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
    permission: PERMISSION.restore,
    scope: 'business',
    sensitivity: 'sensitive',
    idempotent: false,
    audit: true,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<RestoreCustomerInput> {
      const validated = validateObject(raw, RESTORE_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      return ok({ customer_id: validated.value.customer_id as string });
    },
    targetIdentifier(raw: unknown): string | null {
      return rawCustomerId(raw);
    },
    async handle(context: ActionContext, input: RestoreCustomerInput) {
      const resolved = await resolveAuthorizedCustomer(context, input.customer_id);
      if (!resolved.ok) {
        return err(resolved.error);
      }
      const existing = toCustomer(resolved.value);

      if (!canRestore(existing.status)) {
        return err(failedPrecondition());
      }

      const now = context.clock.now();
      const write = updateOperation(input.customer_id, {
        [COLUMN.status]: 'active',
        [COLUMN.updatedAt]: now,
        [COLUMN.updatedByPrincipalId]: context.principalId,
      });

      const output: Customer = {
        ...existing,
        status: 'active',
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
