/**
 * customers.UpdateCustomer
 *
 * PARTIAL UPDATE, AND THE THREE-WAY DISTINCTION IS NORMATIVE:
 *
 *   field ABSENT                 -> unchanged
 *   field PRESENT with a value   -> set to that value
 *   field PRESENT and null       -> cleared (optional fields only)
 *
 * The contract states it because "absent means clear" and "null means unchanged" are both
 * plausible readings, two clients will pick differently, and the failure is silent data
 * loss in a customer's records. It is implemented by carrying the SET OF PRESENT KEYS
 * through validation — `validateObject` returns only the properties that were actually
 * present — rather than by mapping absent to null, which would erase the distinction at the
 * first step.
 *
 * WHAT CANNOT BE CHANGED HERE, AND WHY IT IS ENFORCED BY ABSENCE FROM A SCHEMA RATHER THAN
 * BY A CHECK:
 *
 *   `status`      archiving is ArchiveCustomer, with its own permission and audit record.
 *   `business_id` moving is MoveCustomerToBusiness, at organization scope. As a field here
 *                 it would be an unaudited re-assignment of a customer's authorization
 *                 scope under `customers.customer.update`, which a business-scope principal
 *                 may hold — so that principal could push a customer into a Business it
 *                 does not control, or pull one out of a Business it does.
 *
 * Neither is a property of `UPDATE_CUSTOMER_RULE`, and unknown fields are rejected, so both
 * are refused before this handler runs. There is no code path in this file that could
 * write either.
 *
 * ARCHIVED AND PENDING-DELETION RECORDS CANNOT BE EDITED. Restore first. A record withdrawn
 * from use that can still be quietly changed is neither withdrawn nor a record — and during
 * a recovery window, what an authorized principal would restore must be what it chose to
 * keep.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { failedPrecondition } from '../../../platform/core/kernel/errors.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { SqlValue } from '../../../platform/core/storage/predicate.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer, CustomerStatus } from '../domain/customer.ts';
import { canUpdate } from '../domain/customer.ts';
import { UPDATABLE_FIELD_NAMES, UPDATE_CUSTOMER_RULE } from '../domain/validation.ts';
import { trimForStorage } from '../domain/normalisation.ts';
import { displayNameKey, emailKey, phoneKey } from '../domain/search.ts';
import { toCustomer, updateOperation } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';
import { APP_ID, PERMISSION, rawCustomerId, resolveAuthorizedCustomer } from './common.ts';

type UpdateCustomerInput = {
  readonly customer_id: string;
  /** Only the updatable fields that were PRESENT in the request. Absence is the signal. */
  readonly changes: Readonly<Record<string, string | null>>;
};

export function createUpdateCustomerAction(): ActionDefinition<UpdateCustomerInput, Customer> {
  return {
    id: 'customers.UpdateCustomer',
    appId: APP_ID,
    title: 'Edit customer',
    description:
      "Change a customer's recorded details. Use to correct or complete a record. Only the " +
      "fields supplied are changed. Cannot change the customer's status — archive and restore " +
      'are separate operations — cannot change which Business the customer belongs to, which is ' +
      'MoveCustomerToBusiness, and cannot be applied to an archived or pending-deletion customer.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'failed_precondition',
      'conflict',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: PERMISSION.update,
    scope: 'business',
    sensitivity: 'sensitive',
    idempotent: false,
    audit: true,
    exposure: ['internal', 'public'],
    /**
     * Three: one UPDATE against `customer`, costing the table row plus its two index rows. Core
     * adds five for the audit record, so one update reserves eight
     * (docs/decisions/0014 §A.1, create-customer.ts for the full arithmetic).
     *
     * ONE ROW, BECAUSE THE PREDICATE IS A PRIMARY-KEY EQUALITY — `eq(customer_id, ...)` inside a
     * tenant-scoped handle. That is what makes three a worst case rather than an average: a
     * broader predicate is one statement and an unbounded number of row-writes, and an Action
     * with one would have to declare the largest number of rows it could match.
     *
     * CHARGED IN FULL EVEN WHEN THE UPDATE TOUCHES NO INDEXED COLUMN. Changing only `notes` does
     * not rewrite an index entry, so the real cost is sometimes one. Estimating high is the
     * direction §A.12 requires, and an estimate that varied per request would have to be computed
     * from the SET clause on every call for a saving of two row-writes.
     */
    maxRowWrites: 3,
    parseInput(raw: unknown): Result<UpdateCustomerInput> {
      const validated = validateObject(raw, UPDATE_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      const value = validated.value;
      const changes: Record<string, string | null> = Object.create(null);
      for (const name of UPDATABLE_FIELD_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
          continue;
        }
        const supplied = value[name];
        changes[name] =
          typeof supplied === 'string'
            ? name === 'display_name'
              ? trimForStorage(supplied)
              : supplied
            : null;
      }
      return ok({ customer_id: value.customer_id as string, changes });
    },
    targetIdentifier(raw: unknown): string | null {
      return rawCustomerId(raw);
    },
    async handle(context: ActionContext, input: UpdateCustomerInput) {
      // Steps 5 and 5b.
      const resolved = await resolveAuthorizedCustomer(context, input.customer_id);
      if (!resolved.ok) {
        return err(resolved.error);
      }
      const existing = toCustomer(resolved.value);

      // Step 6.
      if (!canUpdate(existing.status as CustomerStatus)) {
        return err(failedPrecondition());
      }

      const now = context.clock.now();
      const set: Record<string, SqlValue> = {
        [COLUMN.updatedAt]: now,
        [COLUMN.updatedByPrincipalId]: context.principalId,
      };
      const changedFieldNames: string[] = [];
      const merged: Record<string, string | null> = {
        display_name: existing.display_name,
        customer_type: existing.customer_type,
        email: existing.email,
        phone: existing.phone,
        country: existing.country,
        address: existing.address,
        notes: existing.notes,
      };

      for (const name of UPDATABLE_FIELD_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(input.changes, name)) {
          continue;
        }
        const next = input.changes[name];
        // The audit record names WHICH FIELDS CHANGED, so a field supplied with the value it
        // already holds is not listed. Recording it would be recording an operation that did
        // not happen, which is the thing the strict-transition rule refuses elsewhere.
        if (next !== merged[name]) {
          changedFieldNames.push(name);
        }
        merged[name] = next;
        set[name] = next;
      }

      // The derived matching keys are recomputed whenever their source field is supplied,
      // in the same write. A key that lagged its source would make a customer findable
      // under a name it no longer has.
      if (Object.prototype.hasOwnProperty.call(input.changes, 'display_name')) {
        set[COLUMN.displayNameKey] = displayNameKey(merged.display_name ?? '');
      }
      if (Object.prototype.hasOwnProperty.call(input.changes, 'email')) {
        set[COLUMN.emailKey] = emailKey(merged.email);
      }
      if (Object.prototype.hasOwnProperty.call(input.changes, 'phone')) {
        set[COLUMN.phoneKey] = phoneKey(merged.phone);
      }

      const output: Customer = {
        ...existing,
        display_name: merged.display_name ?? existing.display_name,
        customer_type: (merged.customer_type ?? existing.customer_type) as Customer['customer_type'],
        email: merged.email,
        phone: merged.phone,
        country: merged.country,
        address: merged.address,
        notes: merged.notes,
        updated_at: now,
        updated_by_principal_id: context.principalId,
      };

      return ok({
        output,
        writes: [updateOperation(input.customer_id, set)],
        audit: {
          targetResourceId: input.customer_id,
          relatedBusinessIds: [existing.business_id],
          // FIELD NAMES ONLY. Never the old or new values.
          changedFieldNames,
        },
      });
    },
  };
}
