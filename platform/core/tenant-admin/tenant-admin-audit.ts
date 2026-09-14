/**
 * ===========================================================================================
 * WHAT A TENANT-ADMIN ROUTE RECORDS, AND WHERE. `docs/decisions/0044` §3c.
 * ===========================================================================================
 *
 * **EVERY MUTATING ROUTE WRITES AN AUDIT RECORD INTO THE TENANT'S OWN `audit_event`** — the same
 * table `0028`'s platform-originated records land in, so a tenant reading its trail sees what it
 * did and what the platform did in one place. `0003_organization_membership.sql` said this before
 * the class existed: *"the slice that adds membership administration must write its audit record
 * into the AFFECTED ORGANIZATION'S tenant-scoped `audit_event` table, not into the control
 * plane."*
 *
 * ===========================================================================================
 * *** READS ARE NOT UNIVERSALLY AUDITED, AND THAT IS A DIFFERENCE FROM P4 STATED RATHER THAN
 * INHERITED — INCLUDING THE PART OF P4 THAT WAS LOAD-BEARING BY ACCIDENT. ***
 * ===========================================================================================
 *
 * The platform class audits every read because the actor is outside the tenant and enumeration is
 * reconnaissance.
 *
 * **`0044` §3c AS AMENDED 2026-09-13, transcribed including its second sentence, which is the half
 * that does the work:**
 *
 * > **The contrast with P4 is the ACTOR'S POSITION: a member acting inside their own Organization,
 * > not an operator reaching in from outside. THAT CONTRAST LICENSES ONLY THE ABSENCE OF A BLANKET
 * > READ AUDIT. IT LICENSES NO INDIVIDUAL EXEMPTION.** A `sensitive` read is audited unless a
 * > per-route argument says otherwise, **and that argument may not be this paragraph** — being
 * > inside the tenant is true of every route here and therefore distinguishes none of them.
 *
 * *** THIS COMMENT READ "a member reading their own ORGANIZATION'S data" UNTIL 2026-09-13. THE
 * RECORD SAID "their own data". ONE WORD, ADDED IN TRANSCRIPTION. ***
 *
 * **On the record's words the clause licensed only a SELF-READ. On mine it licensed every
 * intra-tenant read — which is every route in the class** — and `0043` §5.4's three audit
 * exemptions all cite it, so the widened copy is the version that made them look justified.
 *
 * **The record's sentence was doing two jobs and only one was in its words:** its argumentative
 * work is the contrast with P4, its words said *reading their own data*, and the transcription
 * resolved that ambiguity **in the direction the argument implied.** `architecture.md` §3b — a
 * dismissal precise about the wrong party. The record has been amended; **this is the amended
 * text, and the second sentence exists so the widening cannot recur by paraphrase.**
 *
 * So a write per settings-page view spends the tenant's own allowance for no detection value, and
 * `TenantAdminRoute.audit` is a required field with no default — **but the DEFAULT for a
 * `sensitive` read is `required`, and an exemption is a per-route argument that names something
 * true of that route alone.**
 *
 * **AND THE CONSEQUENCE `0044` §3c NAMES IS THE ONE THAT MATTERS HERE:**
 *
 *   "P4 makes every platform read a write, so the write ceiling bounds read cost — which `0042`
 *    recorded as load-bearing-by-accident. HERE IT DOES NOT. Every read shape needs its OWN
 *    bound."
 *
 * *** AND THAT BLOCK HAS JUST BECOME LOAD-BEARING IN A WAY IT WAS NOT WHEN IT WAS WRITTEN. ***
 * `tenant.members.sessions.list` is `audit: required`, and part of the reason is that **auditing
 * the read REINSTATES the bound P4 gave away** — at `PER_PRINCIPAL_DAILY_ROW_WRITES` divided by the
 * audit charge, **the charge IS the meter.** `0042`'s load-bearing-by-accident, restored
 * deliberately and **for one route rather than by accident for a class** — which is the difference
 * worth keeping, because a bound nobody chose is a bound nobody maintains.
 *
 * `qa-agent`'s sharper form of the same sentence: *"Under P4 an unbounded read was ACCIDENTALLY
 * safe. Under this class an unbounded read is SIMPLY UNBOUNDED."* That is why
 * `tenant-admin-routes.ts::assertEveryReadShapeIsBounded` is a registration failure and not a
 * review note — **the bound this class does not inherit has to be declared by every route that
 * would have relied on it.**
 *
 * ===========================================================================================
 * A TENANT-ADMIN MUTATION SPENDS FROM **TWO** LEDGERS, AND ONLY ONE OF THEM IS THIS FILE'S
 * ===========================================================================================
 *
 *   the audit row          the TENANT's database        this recorder reserves it
 *   the membership row     the CONTROL PLANE            `ControlPlaneWriteReservation`, reserved
 *                                                       by the handler through the admission port
 *
 * `0014` §C.7: the separate database is an isolation boundary, not additional quota — but the two
 * reservations draw on different ceilings and are charged to different budgets, so **a reader
 * summing one of them has the operation's cost in one database and not its cost.** The platform
 * class records the same trap at `ORGANIZATION_TEMPLATE_UPDATE_ROW_WRITES`.
 *
 * ===========================================================================================
 * THE RECORDER IS A PORT AND THIS CLASS DOES NOT BUILD ONE
 * ===========================================================================================
 *
 * Writing into a tenant's `audit_event` needs a `TenantStoreResolver`, and a composition root
 * holding one holds a handle to every tenant database. The platform class solved this by taking
 * `onboarding`, `members` and `reset` as ALREADY-ASSEMBLED PORTS from `worker-entry.ts`, and its
 * composition file records the count rising and warns that a fourth is the point to ask whether
 * P1 still means anything.
 *
 * **THAT WARNING DOES NOT TRANSFER, AND SAYING SO IS NECESSARY BECAUSE THE SHAPE LOOKS IDENTICAL.**
 * P1 is *the platform class reaches no tenant*, and each of those three was an exception to it.
 * This class HAS a tenant, resolved from the caller's own membership, and writing into that
 * tenant's audit table is the class working as designed rather than an exception to how it works.
 * What must stay true here is the narrower property: **the resolver is never on the context**, so
 * a handler can cause a write into its own tenant's audit table and holds nothing with which to
 * name a different one.
 */

import type { Result } from '../kernel/result.ts';
import type { TenantAdminAuthority } from './tenant-admin-authority.ts';

/**
 * What an operation names, if anything.
 *
 * A DISCRIMINATED UNION RATHER THAN TWO NULLABLE FIELDS, so `{kind: 'none', id: 'x'}` is
 * unrepresentable — `platform-audit.ts`'s reasoning, which is about how the record reads years
 * later: *"a target kind that disagreed with its identifier would be a log line nobody could
 * interpret afterwards."*
 *
 * *** THERE IS NO `organizationId` ON ANY VARIANT, AND ITS ABSENCE IS THE TENANCY PROPERTY. ***
 * The platform class's target carries one because a platform record has to say WHICH tenant it
 * happened in — the actor is outside every tenant. Here the record is written INTO the
 * Organization's own table, so the Organization is the table it is in. **A field naming an
 * Organization on a tenant-scoped record would be a second, forgeable answer to a question the
 * storage boundary already answers**, and the day the two disagreed the row would be evidence of
 * nothing.
 *
 * THE VARIANTS ARE THE CONTROL-PLANE OBJECTS THIS CLASS CAN TOUCH TODAY. A sixth is added with the
 * contract that needs it, and adding one is a deliberate edit here rather than a string a handler
 * chose — which is what keeps a feed able to select on `kind`.
 */
export type TenantAdminActionTarget =
  | { readonly kind: 'none' }
  /** A member, an invitee, or the subject of a session revocation. */
  | { readonly kind: 'principal'; readonly principalId: string }
  /** The Organization itself — settings, identity, retention, a deletion request. */
  | { readonly kind: 'organization' }
  | { readonly kind: 'invitation'; readonly invitationId: string }
  /** A tenant-defined role (`0007` D16). */
  | { readonly kind: 'role'; readonly roleId: string };

/**
 * For an operation that names nothing.
 *
 * IT IS AN EXPLICIT VALUE RATHER THAN AN OPTIONAL FIELD, for `PlatformRouteOutcome`'s reason: a
 * handler able to omit the target would produce an unattributable log line, and requiring the
 * value is how "every mutating route is audited" stays a property rather than a habit.
 */
export const NO_TENANT_ADMIN_TARGET: TenantAdminActionTarget = Object.freeze({
  kind: 'none' as const,
});

/**
 * What the dispatcher hands the recorder. **The handler assembles none of it except the target.**
 *
 * `permissionIds` IS A LIST BECAUSE A ROUTE MAY REQUIRE A CONJUNCTION (`0044` §3d), and the record
 * names **every conjunct that was evaluated** rather than the first one. A record naming one half
 * of an `A ∧ B` route would make the trail say a weaker thing than the system enforced, and the
 * whole reason `0043` §2b reached for the conjunction is that co-holding stopped being readable
 * from the role tables — **so the request record is the only place the pair is visible after the
 * fact.**
 */
export type TenantAdminAuditEntry = {
  readonly authority: TenantAdminAuthority;
  /** The route id. It is the action identifier in the record. */
  readonly actionId: string;
  /** Every permission `authorize()` evaluated for this request, in declaration order. */
  readonly permissionIds: readonly string[];
  readonly outcome: 'ok' | 'denied' | 'failed';
  readonly target: TenantAdminActionTarget;
  readonly requestId: string;
  readonly correlationId: string;
  /** The receipt from the reservation below. Spent here; `record` does not reserve. */
  readonly charge: TenantAdminWriteCharged;
};

declare const TENANT_ADMIN_CHARGE_BRAND: unique symbol;

/**
 * PROOF THAT THIS REQUEST'S TENANT-SIDE WRITE BUDGET HAS ALREADY BEEN CHARGED for the audit record
 * this request will produce.
 *
 * ===========================================================================================
 * IT IS CHARGED BEFORE THE HANDLER RUNS, AND THE PLATFORM CLASS LEARNED THAT THE HARD WAY
 * ===========================================================================================
 *
 * `platform-routes.ts` step 4b is the fix for *"a measured, targeted denial of service"*: the
 * charge used to happen after the handler, so two routes wrote into a customer's tenant database
 * before the operator had paid for anything, and *"2,000 calls took one named Organization's
 * entire day."*
 *
 * **THE ATTACK DOES NOT TRANSFER AND THE ORDERING DOES.** There is no cross-tenant victim here —
 * the actor is a member of the tenant whose budget is being spent, so the worst case is a tenant
 * exhausting its own allowance, which is self-inflicted rather than inflicted. What transfers is
 * the reason the ORDER was chosen: **a deferred budget must refuse before any write exists to be
 * performed**, so that a request which cannot be recorded is also a request that did not happen.
 *
 * IT IS A RECEIPT AND NOT A HANDLE. It carries no store, no resolver, no binding and no
 * Organization identifier — the authority already holds the tenant, and this type must never
 * become a second way to name one.
 */
export type TenantAdminWriteCharged = {
  readonly [TENANT_ADMIN_CHARGE_BRAND]: true;
};

export type TenantAdminAuditRecorder = {
  /**
   * Charges the tenant's write budget for one audit record and returns the receipt.
   *
   * Returns `quota_exceeded` — or `unavailable` where the operation cannot declare it — when the
   * budget is spent. **It must not return a receipt it did not charge for**, which is the one
   * property this whole shape rests on and which no consumer can check.
   */
  reserve(authority: TenantAdminAuthority): Promise<Result<TenantAdminWriteCharged>>;

  /**
   * Writes the record into the AUTHORITY'S OWN Organization's `audit_event`.
   *
   * *** THE ORGANIZATION COMES FROM `entry.authority` AND THERE IS NO PARAMETER FOR ONE. *** A
   * recorder taking an Organization identifier beside an authority would be a recorder that can
   * write one tenant's action into another tenant's trail, and the two would only ever disagree
   * because of a bug — which is exactly the class of bug an audit trail cannot survive.
   */
  record(entry: TenantAdminAuditEntry): Promise<Result<void>>;
};

/**
 * THE ONLY PRODUCER OF A `TenantAdminWriteCharged`, and it is exported for exactly one reason:
 * **the recorder implementation lives outside this module** — it needs a `TenantStoreResolver`,
 * which is why it is assembled at `worker-entry.ts` (see the header) — and it must be able to mint
 * one after it has charged.
 *
 * *** THAT IS THE `mintControlPlaneWriteReservation` TRADE, MADE KNOWINGLY AND WEAKER THAN
 * `platform-audit.ts`'s. *** That file keeps its mint module-private because its recorder is in
 * the same module, and `platform-authority.ts` records the cost of the alternative: *"an exported
 * mint is a way to fabricate a receipt without doing the work it certifies."* Here the recorder
 * cannot be in this module without dragging a tenant-store resolver into the class's type surface,
 * so the mint is exported and **the receipt proves the recorder MEANT to charge rather than that
 * it DID.**
 *
 * **WHAT STILL HOLDS, AND IT IS WHY THIS IS ACCEPTABLE RATHER THAN MERELY NECESSARY:** the receipt
 * is unconstructible by a handler, by a client, and by anything in `apps/**`, because a symbol
 * brand cannot be produced without calling this function and this function is not reachable from
 * the Action pipeline. The hole is one component wide and that component is the one that does the
 * charging.
 *
 * **IF THE RECORDER EVER MOVES INTO THIS MODULE, UNEXPORT THIS.** Written as an instruction rather
 * than a hope, because the export will otherwise look load-bearing to whoever finds it.
 */
export function mintTenantAdminWriteCharge(): TenantAdminWriteCharged {
  return Object.freeze({}) as TenantAdminWriteCharged;
}
