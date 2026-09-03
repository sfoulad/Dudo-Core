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
 * (platform/core/action/pipeline.ts). Every denial is recorded:
 *
 *   forbidden        the permission was refused, or the row's Business is outside the
 *                    principal's authorized set
 *   not_found        the identifier is in ANOTHER Organization, or nowhere — the probe case
 *   invalid_argument the identifier failed schema validation, which is what a fuzzing run
 *                    looks like from here
 *
 * THE TWO `not_found` DENIALS ARE THE SAME DENIAL. A foreign identifier and an identifier that
 * exists nowhere take the identical path — the storage boundary filters, `findById` returns
 * null, `resolveAuthorizedCustomer` answers `notFound()` — so they are indistinguishable to the
 * recording layer. Recording therefore adds no oracle: the work done, the response bytes and
 * the response length are unchanged and still equal between the two, and nothing is ever
 * resolved from the probed row, because resolving it to enrich a record would be the
 * cross-tenant read this control exists to detect.
 *
 * ===========================================================================================
 * AMENDED BY docs/decisions/0013 — A DENIAL IS NOW COUNTED, NOT WRITTEN
 * ===========================================================================================
 *
 * WHAT THIS CONTROL COST, AND IT WAS FOUND BEFORE AN INCIDENT RATHER THAN DURING ONE. A denied
 * read performed a D1 WRITE, and an attacker choosing the request rate chose the write rate.
 * D1 Free enforces 100,000 rows written per day ACCOUNT-WIDE — enforcement began 2026-09-01 —
 * and exceeding it means D1 stops answering for EVERY Organization. So this probe-detection
 * control was a platform-wide denial-of-service lever, and the cheapest denial to produce
 * needed no valid identifier at all.
 *
 * The user decided on 2026-09-02 (`0013`, ten controls). What changes for this Action:
 *
 *   - DENIALS ARE AGGREGATED. Attempts are counted by a SQLite-backed Durable Object and one
 *     summary lands in `denial_summary` per (actor, Organization, App, Action, denial category,
 *     15-minute window), on a bounded emission ladder. A probing run of 100,000 attempts costs
 *     at most a handful of rows, not 100,000.
 *   - THE REQUESTED IDENTIFIER IS NO LONGER RECORDED. It is deliberately absent from the
 *     grouping (0013 control 5): the attacker controls that value, so grouping by it would mint
 *     unlimited groups and restore per-attempt writes under another name. THE COST IS REAL AND
 *     IS OWED TO THE CONTRACT — CD-5 asks a `not_found` to record "the identifier AS SUPPLIED BY
 *     THE CALLER, marked unresolved", and a summary has nowhere to put it. 0013 is the later,
 *     Accepted, user decision and supersedes it; the conflict is reported to the Team Lead,
 *     because contracts are not Core's to author.
 *   - RATE LIMITS NOW EXIST, per authenticated actor, per Organization and per source address,
 *     enforced before any Customer query (`platform/core/action/pipeline.ts`).
 *
 * WHAT A SUMMARY CARRIES: the actor, the actor's Organization (the row's `tenant_id`, set by
 * the storage boundary from the authenticated handle), the App and Action, the window's first
 * and last attempt times, the attempt count, the denial category, and the actor's own
 * authorized Business set. WHAT IT DOES NOT CARRY: anything read from the customer, the
 * identifier that was attempted, and anything that could distinguish "in another Organization"
 * from "nowhere" — both are `not_found` and both increment the SAME counter.
 *
 * WHAT IS **NOT** CLAIMED, and 0013 control 11 is explicit about it: none of this is DDoS
 * resistance. An attacker can still exhaust the Workers Free request allowance of 100,000
 * requests/day before reaching D1. These controls protect D1 capacity and the integrity of the
 * audit trail, and nothing wider.
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
    /**
     * ZERO, DECLARED RATHER THAN OMITTED. A successful read writes nothing, so it reserves
     * nothing and never consults the daily budget — which is `docs/decisions/0014` §A.10's
     * "reads remain available" holding by construction rather than by a branch: at exhaustion
     * there is no code path on which this Action asks the budget anything.
     *
     * ITS DENIALS STILL COST, AND THEY ARE NOT PRICED HERE. `auditOnDenial: true` means a refused
     * read is counted and, at an emission point, written as a `denial_summary` row. That is
     * charged to the `security` allocation by the coordinator, on the other side of the decision,
     * at four row-writes per summary — never to the `business` allocation and never through this
     * field, which prices only what a SUCCESSFUL invocation writes.
     */
    maxRowWrites: 0,
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
