/**
 * customers.GetCustomer
 *
 * Returns archived and pending-deletion customers as well as active ones. A withdrawn
 * record is still readable by identifier; it is only withheld from the default listing.
 * There is no status precondition here, deliberately — adding one would make an archived
 * customer unreadable and therefore unrestorable through the UI that shows it.
 *
 * `audit: false`. READS ARE NOT AUDITED, AND THAT IS A DECISION, NOT AN OMISSION.
 *
 * The Team Lead ruled on CD-1 on 2026-09-01: reads stay unaudited as a DOCUMENTED,
 * TIME-BOUNDED EXCEPTION to AUTHORIZATION_STANDARD.md §6, which says explicit access to
 * customer information maps to `sensitive` at minimum and that `sensitive` requires an
 * audit event. THE STANDARD STANDS AS WRITTEN and has not been edited to agree — "a
 * document quietly amended to agree with an implementation has stopped being a standard and
 * become a description of what was built."
 *
 * The accepted risk, recorded so it is not rediscovered and reported as a finding: a
 * principal holding only `customers.customer.list` can page the entire customer base of
 * their Organization and leave no audit trail, and with no `export` permission declared the
 * whole of that risk sits on `list`. Accepted for the MVP slice on the user's explicit
 * instruction.
 *
 * The named future obligation is COARSE-GRAINED ENUMERATION AUDITING — who enumerated,
 * when, and how many results — and deliberately NOT an audit record per record read. The
 * cheap, useful control is the one being deferred; that is the honest description of what
 * this exception costs.
 *
 * BOTH ANSWERS ARE REACHABLE FROM HERE AND THEY ARE DELIBERATELY DIFFERENT: a customer in
 * another Organization, or nowhere, is `not_found`; a customer in this Organization in a
 * Business the principal is not authorized over is `forbidden`.
 */

import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import type { ActionContext } from '../../../platform/core/tenancy/tenant-context.ts';
import { validateObject } from '../../../platform/core/validation/validator.ts';
import type { Customer } from '../domain/customer.ts';
import { GET_CUSTOMER_RULE } from '../domain/validation.ts';
import { toCustomer } from '../data/customer-repository.ts';
import { APP_ID, PERMISSION, rawCustomerId, resolveAuthorizedCustomer } from './common.ts';

type GetCustomerInput = { readonly customer_id: string };

export function createGetCustomerAction(): ActionDefinition<GetCustomerInput, Customer> {
  return {
    id: 'customers.GetCustomer',
    appId: APP_ID,
    title: 'View customer',
    description:
      "Retrieve one customer's full record, including address and notes. Use when showing a " +
      'customer detail view. Returns archived and pending-deletion customers as well as active ' +
      'ones — a withdrawn record is still readable by identifier; it is only withheld from the ' +
      'default listing.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'rate_limited',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: PERMISSION.read,
    scope: 'business',
    sensitivity: 'read',
    idempotent: false,
    audit: false,
    exposure: ['internal', 'public'],
    parseInput(raw: unknown): Result<GetCustomerInput> {
      const validated = validateObject(raw, GET_CUSTOMER_RULE);
      if (!validated.ok) {
        return err(validated.error);
      }
      return ok({ customer_id: validated.value.customer_id as string });
    },
    targetIdentifier(raw: unknown): string | null {
      return rawCustomerId(raw);
    },
    async handle(context: ActionContext, input: GetCustomerInput) {
      const resolved = await resolveAuthorizedCustomer(context, input.customer_id);
      if (!resolved.ok) {
        return err(resolved.error);
      }
      return ok({
        output: toCustomer(resolved.value),
        writes: [],
        audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] },
      });
    },
  };
}
