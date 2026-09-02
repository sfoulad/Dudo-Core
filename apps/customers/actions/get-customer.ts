/**
 * customers.GetCustomer
 *
 * Returns archived and pending-deletion customers as well as active ones. A withdrawn
 * record is still readable by identifier; it is only withheld from the default listing.
 * There is no status precondition here, deliberately — adding one would make an archived
 * customer unreadable and therefore unrestorable through the UI that shows it.
 *
 * ===========================================================================================
 * `audit: false, auditOnDenial: true` — SUCCESSFUL READS ARE UNAUDITED; DENIED READS ARE NOT.
 * ===========================================================================================
 *
 * THE ORIGINAL EXCEPTION. The Team Lead ruled on CD-1 on 2026-09-01 that reads stay unaudited
 * as a DOCUMENTED, TIME-BOUNDED EXCEPTION to AUTHORIZATION_STANDARD.md §6, which says explicit
 * access to customer information maps to `sensitive` at minimum and that `sensitive` requires
 * an audit event. THE STANDARD STILL STANDS AS WRITTEN and has not been edited to agree — "a
 * document quietly amended to agree with an implementation has stopped being a standard and
 * become a description of what was built."
 *
 * WHAT THE EXCEPTION TURNED OUT TO COST, which is why this file changed. `qa-agent` found
 * that the exception was broader than the contract described. A cross-tenant probing campaign
 * run entirely through GetCustomer produced ZERO audit records, while the identical campaign
 * run through ArchiveCustomer produced one record per attempt. The cheapest way to enumerate
 * another Organization's customer identifiers was also the only silent one, and the asymmetry
 * was an accident of `audit` being a single flag over both outcomes rather than a decision
 * anyone had made.
 *
 * THE USER RULED ON 2026-09-02, verbatim:
 *
 *   "Audit every denied GetCustomer read attempt, including cross-tenant probing. Keep
 *    successful customer reads unaudited."
 *
 * So this is a PROBE-DETECTION CONTROL and nothing wider. A successful GetCustomer still
 * writes no audit record — `auditOnDenial` narrows the denial path and cannot reach step 7
 * (platform/core/action/pipeline.ts). Every denial writes exactly one:
 *
 *   forbidden        the permission was refused, or the row's Business is outside the
 *                    principal's authorized set
 *   not_found        the identifier is in ANOTHER Organization, or nowhere — the probe case
 *   invalid_argument the identifier failed schema validation, which is what a fuzzing run
 *                    looks like from here
 *
 * THE TWO `not_found` RECORDS ARE THE SAME RECORD. A foreign identifier and an identifier
 * that exists nowhere take the identical path — the storage boundary filters, `findById`
 * returns null, `resolveAuthorizedCustomer` answers `notFound()` — so they produce records
 * differing only in the identifier the caller typed. Auditing therefore adds no oracle: the
 * work done, the response bytes and the response length are unchanged and still equal between
 * the two. That property is the reason the audit record is written from the DENIAL, using the
 * caller's own supplied string, and NOT from any attempt to look the foreign row up. Resolving
 * it to enrich the record would be the cross-tenant read this control exists to detect.
 *
 * WHAT THE RECORD CARRIES: the actor, the actor's Organization (the audit row's `tenant_id`,
 * set by the storage boundary from the authenticated handle), the action, the timestamp, the
 * REQUESTED customer identifier marked `target_unresolved`, the denial reason, and the
 * correlation id. WHAT IT DOES NOT CARRY: anything read from the customer. `AuditEntry` has no
 * field that can hold a value, and `relatedBusinessIds` is forced empty on every denial so a
 * wrong-Business refusal cannot name the Business it refused.
 *
 * WHAT THIS CONTROL COSTS, STATED RATHER THAN DISCOVERED IN AN INCIDENT. A denied read now
 * performs a D1 WRITE, and an attacker choosing the request rate chooses the write rate. Two
 * consequences, neither of which is a reason not to do it, and both of which are somebody's
 * to own:
 *
 *   - There is NO RATE LIMITING (platform/core/http/api.ts says so and says why). An
 *     authenticated principal can therefore drive one audit insert per request against a
 *     single-threaded database that also serves every other Organization. Authentication is
 *     the floor here — an unauthenticated request writes nothing, because there is no tenant
 *     to write it in — so this needs a valid session, not merely a network path.
 *   - Those writes consume the D1 free-tier row allowance
 *     (docs/decisions/0008; docs/operations/free-tier-register.md). A sustained probing run
 *     is now also a spend event.
 *
 * The right answer to both is a rate limiter, which does not exist and cannot be invented
 * here. Reported to the Team Lead rather than mitigated by weakening the control: an audit
 * record that is dropped when the attacker goes fast is an audit record that is absent
 * exactly when it matters.
 *
 * WHAT IS STILL DEFERRED, unchanged by this: COARSE-GRAINED ENUMERATION AUDITING of SUCCESSFUL
 * reads — who enumerated, when, and how many results. The accepted risk therefore narrows but
 * does not disappear: a principal holding `customers.customer.list` can still page the entire
 * customer base of their OWN Organization and leave no audit trail, because those reads
 * succeed. This control catches the attempts that are REFUSED, which is the whole of the
 * cross-tenant case and none of the insider case.
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
    // Successes unaudited, denials audited. The two lines are the whole of the user's
    // 2026-09-02 decision; see the file header for why they differ.
    audit: false,
    auditOnDenial: true,
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
