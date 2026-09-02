/**
 * customers.CreateCustomer
 *
 * Contract: customer-directory-v1.contract.yaml -> actions[customers.CreateCustomer], and
 * customer-directory-v1.schema.json -> createCustomerInput / createCustomerOutput.
 *
 * `business_id` IS REQUIRED AND IS NOT DEFAULTED. A principal may be authorized over
 * several Businesses, so there is no single Business the server can infer, and inferring
 * one from an "active Business" in the session would be the ambient default
 * MULTITENANCY_STANDARD.md §3 forbids one level up — "the last value seen" filing a
 * customer into the wrong Business silently. Making the caller state it means the wrong
 * answer is a visible wrong answer.
 *
 * IT SELECTS WITHIN THE AUTHORIZED SET; IT NEVER WIDENS IT (CD-11). `authorizeSuppliedBusiness`
 * is step 5c and returns `forbidden` for a Business of this Organization the principal is
 * not authorized over, and `not_found` — byte-identical to a Business that exists nowhere —
 * for one belonging to another Organization. Distinguishing those two would make
 * CreateCustomer a probe for the existence of other Organizations' Businesses.
 *
 * NOT IDEMPOTENT, and the cost is the contract's CD-4 rather than a gap here: an
 * `Idempotency-Key` is accepted but not required, no duplicate detection exists on
 * `display_name` or `email`, and a retried create after a network failure produces a second
 * customer. Accepted because the worst outcome is a duplicate row rather than duplicated
 * money or a duplicated message.
 *
 * `quota_exceeded` IS DECLARED AND NOTHING PRODUCES IT. CD-10 records that a
 * per-Organization customer quota is required before external Organizations are admitted
 * and that its VALUE is a product decision that has not been made. Choosing a number here
 * would set that decision by side effect, in the code that enforces it.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import type { BusinessDirectory } from '../../../platform/core/tenancy/business-directory.ts';
import { authorizeSuppliedBusiness } from '../../../platform/core/authorization/business-scope.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer, CustomerType } from '../domain/customer.ts';
import { CREATE_CUSTOMER_RULE } from '../domain/validation.ts';
import { trimForStorage } from '../domain/normalisation.ts';
import { displayNameKey, emailKey, phoneKey } from '../domain/search.ts';
import { insertOperation } from '../data/customer-repository.ts';
import { APP_ID, PERMISSION } from './common.ts';

type CreateCustomerInput = {
  readonly business_id: string;
  readonly display_name: string;
  readonly customer_type: CustomerType;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly country?: string | null;
  readonly address?: string | null;
  readonly notes?: string | null;
};

/** An optional field may be omitted or supplied as null; both mean "not recorded". */
function optional(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function createCreateCustomerAction(dependencies: {
  readonly businesses: BusinessDirectory;
}): ActionDefinition<CreateCustomerInput, Customer> {
  return {
    id: 'customers.CreateCustomer',
    appId: APP_ID,
    title: 'Create customer',
    description:
      "Add a new customer to a named Business in this Organization's directory. Use when a " +
      'person or company the Organization does business with is to be recorded for the first ' +
      'time. The Business must be stated; the new customer starts active. Does not check for ' +
      'duplicates.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'conflict',
      'quota_exceeded',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: PERMISSION.create,
    // Evaluated at business scope. That is the whole mechanism by which the CD-2 decision
    // reaches business-admin: a grant at organization implies business, so a business-owner
    // loses nothing, while a business-scope grant can actually satisfy this Action.
    scope: 'business',
    sensitivity: 'sensitive',
    idempotent: false,
    audit: true,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<CreateCustomerInput> {
      const validated = validateObject(raw, CREATE_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      const value = validated.value;
      // A display_name that is whitespace-only is already rejected by the `\S` pattern, so
      // the trim below cannot produce an empty stored name.
      return ok({
        business_id: value.business_id as string,
        display_name: trimForStorage(value.display_name as string),
        customer_type: value.customer_type as CustomerType,
        email: optional(value.email),
        phone: optional(value.phone),
        country: optional(value.country),
        address: optional(value.address),
        notes: optional(value.notes),
      });
    },
    // This Action names no existing record, so there is no caller-supplied resource
    // identifier for a denial record to carry.
    targetIdentifier(): string | null {
      return null;
    },
    async handle(context: ActionContext, input: CreateCustomerInput) {
      // Step 5c. The Business the caller named, authorized in the same order as a record:
      // outside this Organization -> not_found; inside it but outside the authorized set ->
      // forbidden.
      const business = await authorizeSuppliedBusiness(
        context.store,
        dependencies.businesses,
        context.authorizedBusinessIds,
        input.business_id,
      );
      if (!business.ok) {
        return err(business.error);
      }

      // No step 6: there is no prior state to precondition on.

      const customerId = context.ids.generate();
      const now = context.clock.now();

      const write = insertOperation({
        customerId,
        businessId: input.business_id,
        displayName: input.display_name,
        displayNameKey: displayNameKey(input.display_name),
        customerType: input.customer_type,
        email: input.email,
        emailKey: emailKey(input.email),
        phone: input.phone,
        phoneKey: phoneKey(input.phone),
        country: input.country,
        address: input.address,
        notes: input.notes,
        createdAt: now,
        principalId: context.principalId,
      });

      const output: Customer = {
        customer_id: customerId,
        business_id: input.business_id,
        display_name: input.display_name,
        customer_type: input.customer_type,
        email: input.email,
        phone: input.phone,
        country: input.country,
        address: input.address,
        notes: input.notes,
        status: 'active',
        deletion_scheduled_at: null,
        created_at: now,
        created_by_principal_id: context.principalId,
        updated_at: now,
        updated_by_principal_id: context.principalId,
      };

      return ok({
        output,
        writes: [write],
        audit: {
          targetResourceId: customerId,
          relatedBusinessIds: [input.business_id],
          // A create audit record carries the customer_id and never the display_name.
          // There are no changed field names on a create: nothing was changed.
          changedFieldNames: [],
        },
      });
    },
  };
}
