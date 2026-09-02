/**
 * customers.MoveCustomerToBusiness
 *
 * THIS ACTION EXISTS BECAUSE THE DECISION REQUIRES THE MOVE TO BE SEPARATE AND AUDITED. A
 * `business_id` on `updateCustomerInput` would have been the same capability without a
 * permission of its own, without an audit entry naming both Businesses, and reachable by a
 * business-scope principal.
 *
 * SCOPE IS `organization`, NOT `business`, AND THAT IS THE POINT. A move spans TWO
 * Businesses and a business-scope grant is authority over ONE by definition. Declared at
 * business scope it would let the holder of a grant over Business A pull a customer out of
 * Business B, or push one into Business B — reaching across a boundary while holding one
 * side of it. `implies('business', 'organization')` is false, so a business-scope principal
 * cannot reach this Action at all; that is the intended outcome, not a gap.
 *
 * THE SCOPE DECLARATION IS THE FLOOR, NOT THE WHOLE CHECK. Core still validates BOTH ends:
 *   destination outside this Organization        -> not_found, identical to a Business that
 *                                                   exists nowhere, so this is not a probe
 *                                                   for other Organizations' structure;
 *   destination inside it, outside the auth set  -> forbidden;
 *   source customer outside the tenant           -> not_found.
 *
 * THIS IS NOT A TENANT TRANSFER WITH A NARROWER NAME. A Customer's Organization is assigned
 * at creation from context and is immutable (MULTITENANCY_STANDARD.md §6). There is no
 * source Business parameter either: the source is whatever the record currently says, read
 * inside the tenant. Accepting one would let a caller assert a state it does not know and
 * would make the audit record a copy of the caller's claim rather than of what happened.
 *
 * A MOVE TO THE BUSINESS THE CUSTOMER IS ALREADY IN IS `failed_precondition`. A move that
 * moves nothing would still write an audit record saying a customer changed Business.
 *
 * MOVING AN ARCHIVED CUSTOMER IS ALLOWED; MOVING A PENDING-DELETION ONE IS NOT.
 * Reorganising the Organization's own structure should not be blocked by a record being
 * withdrawn from use — an archived customer in a Business that no longer serves it is
 * exactly the record someone will need to move. A record under a destruction order is
 * different: its Business is part of what the recovery restores.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { failedPrecondition } from '../../../platform/core/kernel/errors.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { authorizeSuppliedBusiness } from '../../../platform/core/authorization/business-scope.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer } from '../domain/customer.ts';
import { canMove } from '../domain/customer.ts';
import { MOVE_CUSTOMER_RULE } from '../domain/validation.ts';
import { toCustomer, updateOperation } from '../data/customer-repository.ts';
import { COLUMN } from '../data/schema.ts';
import { APP_ID, PERMISSION, rawCustomerId, resolveAuthorizedCustomer } from './common.ts';

type MoveCustomerInput = {
  readonly customer_id: string;
  readonly business_id: string;
};

export function createMoveCustomerToBusinessAction(dependencies: {
  readonly businesses: BusinessDirectory;
}): ActionDefinition<MoveCustomerInput, Customer> {
  return {
    id: 'customers.MoveCustomerToBusiness',
    appId: APP_ID,
    title: 'Move customer to another business',
    description:
      'Move one customer from the Business it is in to another Business in the same ' +
      'Organization. Use when a customer is served by a different part of the Organization than ' +
      "the one that recorded it. The customer's details and lifecycle state are unchanged; only " +
      'which Business it belongs to changes. This is the only operation that changes a ' +
      "customer's Business.",
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
    permission: PERMISSION.move,
    scope: 'organization',
    sensitivity: 'sensitive',
    idempotent: false,
    audit: true,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<MoveCustomerInput> {
      const validated = validateObject(raw, MOVE_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      return ok({
        customer_id: validated.value.customer_id as string,
        business_id: validated.value.business_id as string,
      });
    },
    targetIdentifier(raw: unknown): string | null {
      return rawCustomerId(raw);
    },
    async handle(context: ActionContext, input: MoveCustomerInput) {
      // Steps 5 and 5b, on the SOURCE. The record must be in the tenant and in a Business
      // the principal is authorized over -- an organization-scope grant makes that every
      // Business in the Organization, which is why this Action is declared at that scope.
      const resolved = await resolveAuthorizedCustomer(context, input.customer_id);
      if (!resolved.ok) {
        return err(resolved.error);
      }
      const existing = toCustomer(resolved.value);

      // Step 5c, on the DESTINATION. Validated the same way and in the same order.
      const destination = await authorizeSuppliedBusiness(
        context.store,
        dependencies.businesses,
        context.authorizedBusinessIds,
        input.business_id,
      );
      if (!destination.ok) {
        return err(destination.error);
      }

      // Step 6, both halves.
      if (!canMove(existing.status)) {
        return err(failedPrecondition());
      }
      if (existing.business_id === input.business_id) {
        return err(failedPrecondition());
      }

      const now = context.clock.now();
      const write = updateOperation(input.customer_id, {
        [COLUMN.businessId]: input.business_id,
        [COLUMN.updatedAt]: now,
        [COLUMN.updatedByPrincipalId]: context.principalId,
      });

      const output: Customer = {
        ...existing,
        business_id: input.business_id,
        // Status is unchanged: a move is not a lifecycle transition.
        updated_at: now,
        updated_by_principal_id: context.principalId,
      };

      return ok({
        output,
        writes: [write],
        audit: {
          targetResourceId: input.customer_id,
          // BOTH ENDS. "The move record is meaningless without both." Source first,
          // destination second. Both are Business identifiers inside the caller's own
          // tenant, and neither is business data.
          relatedBusinessIds: [existing.business_id, input.business_id],
          changedFieldNames: ['business_id'],
        },
      });
    },
  };
}
