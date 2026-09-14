/**
 * Customer Directory — contract-derived types.
 *
 * SOURCE OF TRUTH, and this file is a transcription of it, never an authority:
 *   packages/contracts/apps/customers/customer-directory-v1.schema.json
 *   packages/contracts/apps/customers/customer-directory-v1.contract.yaml
 *   packages/contracts/apps/customers/README.md
 *
 * ONE CONTRACT, TWO CLIENTS. `app-agent` builds the Apple screens from the same
 * schema. A shape this file has and the Apple client does not — or the reverse
 * — is a contract defect, not a client-local choice. Nothing here may be
 * widened, narrowed or "improved" without the contract changing first.
 *
 * The zero-dependency build carried these shapes in JSDoc. Under ADR 0016 they
 * are real types, which is the single biggest thing TypeScript buys here: the
 * three-way partial-update semantics and the "present and null" rule are now
 * checked by the compiler instead of remembered by the author.
 */

/* ===========================================================================
   THE CONTRACT SHAPES ARE CONSUMED — ADR 0037 REQUIREMENT 2
   ===========================================================================

   Thirteen shapes below were hand-written restatements of a schema the
   generator had already emitted. They were CORRECT, which is why they survived:
   a correct duplicate has no citation between its copies and nothing that fails
   when they drift (`workflow.md` §12's unsweepable kind).

   `scripts/verify-settings.mjs` now asserts this module re-declares nothing the
   generated ones emit — across EVERY module it imports from plus `common/**`,
   because `CollectionEnvelope` was duplicated from `common/pagination` and a
   one-module comparison could not have seen it.

   WHAT STAYS LOCAL, and none of it is a shape the contract declares:
   the six runtime constants, `EditableField`, `UpdateCustomerChanges`, and
   `CustomerAction` — which is deliberately EIGHT of the contract's ten. */
export type {
  CustomerId,
  BusinessId,
  PrincipalId,
  Timestamp,
  CustomerType,
  CustomerStatus,
  StatusFilter,
  Customer,
  CustomerSummary,
  CreateCustomerInput,
  ListCustomersInput,
  SearchCustomersInput,
} from '@dudo/contracts/apps/customers/customer-directory-v1';
export type { CollectionEnvelope } from '@dudo/contracts/common/pagination';

/* ===========================================================================
   THE PER-OPERATION Input/Output PAIRS — THE SECOND HALF OF REQUIREMENT 2
   ===========================================================================

   The block further down this file recorded these as *recognised, consumable
   and not consumed*, and gave the honest reason: adopting them restructures
   `api/client.ts`, which is a different change with a different risk.

   ⚠ THE REASON THEY ARE ADOPTED NOW IS DIVERGENCE, NOT COMPLIANCE. With three
   Inputs consumed above and every Output hand-picked at the call site, **one
   client held two vocabularies for the same kind of thing — and the newer half
   was the one that looked like the exception.** That is the state a later
   author resolves by copying whichever half they met first.

   ⚠ AND `Customer` IS NOT THE SAME CLAIM AS `GetCustomerOutput`, EVEN THOUGH
   THE GENERATOR EMITS THEM AS EQUAL TODAY. `GetCustomerOutput = Customer` is a
   fact about the contract as it stands; `Customer` is the record. A response
   that gains an envelope, a partial projection, or a sibling field changes the
   first and not the second, and the call site that says `Customer` would keep
   compiling while meaning something the contract no longer promises.

   WHICH EIGHT, AND WHY EXACTLY EIGHT: the operations `CustomerAction` names.
   `DeleteCustomerInput/Output` and `RestoreDeletedCustomerInput/Output` stay
   unconsumed, because contract §11.1 keeps this client from calling either —
   see `CustomerAction` below. Adding them here would make the union's absence
   unenforceable at exactly the place it is enforced. */
export type {
  GetCustomerInput,
  GetCustomerOutput,
  CreateCustomerOutput,
  ListCustomersOutput,
  SearchCustomersOutput,
  UpdateCustomerInput,
  UpdateCustomerOutput,
  ArchiveCustomerInput,
  ArchiveCustomerOutput,
  RestoreCustomerInput,
  RestoreCustomerOutput,
  MoveCustomerToBusinessInput,
  MoveCustomerToBusinessOutput,
} from '@dudo/contracts/apps/customers/customer-directory-v1';

/*
 * Imported for the constant bridges below. `BusinessId` is deliberately NOT
 * here — it is re-exported above for consumers and the bridges do not use it,
 * and the compiler said so (`TS6196`) rather than leaving a dead import.
 */
import type {
  CustomerStatus,
  CustomerType,
  StatusFilter,
  UpdateCustomerInput,
} from '@dudo/contracts/apps/customers/customer-directory-v1';

/* ---------------------------------------------------------------------------
   The runtime constants, BOUND TO THE CONTRACT IN BOTH DIRECTIONS
   ---------------------------------------------------------------------------

   ⚠ THE TYPES MOVED TO THE CONTRACT AND THESE CONSTANTS DID NOT — AND THAT IS
   THE DANGEROUS HALF OF THIS SWAP.

   The UI iterates `STATUS_FILTERS` to draw the filter control. Swapping
   `StatusFilter` to the generated union while leaving the constant unbound
   would let the two describe different sets — **a state strictly worse than
   before the swap**, because the type would then say one thing and the control
   offered to a user another, with nothing comparing them.

   TWO DIRECTIONS, AND THEY CATCH DIFFERENT DEFECTS:

     satisfies    every member of the constant is a contract value
                  -> catches a value the UI offers that the server refuses
     Exclude<>    every contract value is in the constant
                  -> catches a value the contract added that the UI never offers

   THE SECOND IS THE ONE NOBODY WRITES, and it is the one that matters here: a
   status added to the contract silently becomes a row a reader cannot filter
   for.

   ⚠ `satisfies` RATHER THAN AN ANNOTATION, and the difference is not stylistic.
   An annotation on a literal passed into a generic position stops the literal
   being fresh, and TypeScript then does NOT refuse an excess member — measured
   by `core-agent` within the hour on `Object.freeze`, where a comment claimed
   the guard held and the excess key would have flowed straight through. **Fail
   open in the one direction the guard exists for.** `satisfies` keeps the
   literal fresh and keeps the inferred tuple type.
   --------------------------------------------------------------------------- */

export const CUSTOMER_TYPES = ['person', 'company'] as const;
CUSTOMER_TYPES satisfies readonly CustomerType[];
type MissingCustomerType = Exclude<CustomerType, (typeof CUSTOMER_TYPES)[number]>;
const CUSTOMER_TYPES_ARE_EXHAUSTIVE: MissingCustomerType extends never ? true : never = true;
void CUSTOMER_TYPES_ARE_EXHAUSTIVE;

/**
 * SERVER-CONTROLLED. Never accepted on create or update; it moves only through
 * the Archive/Restore/Delete/RestoreDeleted Actions, which is what makes every
 * transition permissioned and audited.
 *
 * `pending_deletion` is in this union even though nothing in this slice can
 * produce it. Contract §11.1 requires exactly that: the status value and the
 * nullable deadline are in scope now because they are breaking to add later,
 * and a client must tolerate a status it will never see rather than crash on
 * it.
 */
export const CUSTOMER_STATUSES = ['active', 'archived', 'pending_deletion'] as const;
CUSTOMER_STATUSES satisfies readonly CustomerStatus[];
type MissingCustomerStatus = Exclude<CustomerStatus, (typeof CUSTOMER_STATUSES)[number]>;
const CUSTOMER_STATUSES_ARE_EXHAUSTIVE: MissingCustomerStatus extends never ? true : never = true;
void CUSTOMER_STATUSES_ARE_EXHAUSTIVE;

export const STATUS_FILTERS = ['active', 'archived', 'pending_deletion', 'all'] as const;
STATUS_FILTERS satisfies readonly StatusFilter[];
type MissingStatusFilter = Exclude<StatusFilter, (typeof STATUS_FILTERS)[number]>;
const STATUS_FILTERS_ARE_EXHAUSTIVE: MissingStatusFilter extends never ? true : never = true;
void STATUS_FILTERS_ARE_EXHAUSTIVE;

/**
 * The full wire representation — all fifteen fields.
 *
 * EVERY FIELD IS PRESENT ON EVERY RESPONSE. An optional field the tenant has
 * not filled in is present and `null`, never absent. That is why these are
 * `T | null` rather than `T | undefined` or optional properties: absent versus
 * null is a distinction two clients would resolve differently, and "the web app
 * shows a blank and the iPhone app shows nothing" is the divergence the one
 * contract rule exists to prevent.
 *
 * NO `organization_id`, and the asymmetry with `business_id` is the point. The
 * Organization is the isolation boundary: never accepted on input, never
 * returned, derived from the authenticated server-side context on every call,
 * so no client ever learns a tenant identifier it might be tempted to send
 * back. The Business is an authorization scope inside that boundary, and a
 * directory row that does not say which Business it belongs to is a row that
 * will be acted on in the wrong one.
 *
 * ⚠ THE SHAPE IS NOW CONSUMED FROM THE CONTRACT (re-exported at the top of this
 * file) AND THIS PROSE IS DELIBERATELY KEPT.
 *
 * **The generated file carries none of it.** `workflow.md` §2b: when something
 * moves, ask what travels with it BESIDES its declaration — the reasoning about
 * `T | null` versus optional, and about why no `organization_id` appears, is a
 * property of the CONTRACT that a reader of this client needs and that the
 * emitter does not reproduce. Deleting the type and the paragraph together
 * would have been the half-move.
 */

/**
 * The projection returned by ListCustomers and SearchCustomers — one directory
 * row, ten fields.
 *
 * IT DELIBERATELY EXCLUDES `address` AND `notes`, the two sensitive-personal
 * free-text fields. That exclusion is the whole point of `list` being a
 * separate permission from `read`: enumeration and record disclosure are
 * different risks, and if the list returned the whole record they would be the
 * same risk behind two permission names. Widening this type to `Customer` would
 * quietly undo a security boundary.
 *
 * ⚠ CONSUMED FROM THE CONTRACT, AND THIS PARAGRAPH IS THE REASON THE SWAP IS
 * SAFE RATHER THAN MERELY EQUIVALENT.
 *
 * **The generated `CustomerSummary` really does exclude `address` and `notes`**
 * — checked field by field before swapping, not assumed from the name. Had it
 * matched `Customer`, adopting it would have widened a security boundary
 * silently, and the compiler would have said nothing because a wider type
 * accepts everything the narrower one did.
 */

/**
 * THE COLLECTION ENVELOPE IS `common/pagination`'s, AND IT WAS THE THIRTEENTH
 * DUPLICATE — the one hiding in a different generated module.
 *
 * There is deliberately no `total`. The reason is tenant isolation rather than
 * performance: **a cross-tenant total is the cheapest leak to write by
 * accident, because it returns no records at all.** The product consequence is
 * concrete and accepted — neither client can show "247 customers".
 *
 * **That sentence is why the prose stays even though the type left.** A future
 * reader meeting a `next_cursor` and no `total` will otherwise read it as an
 * omission and add one.
 */

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/* ---------------------------------------------------------------------------
   WHAT THIS MODULE STILL DOES NOT CONSUME, AND WHY EACH GROUP IS LEFT
   ---------------------------------------------------------------------------

   ⚠ NO COUNT. **This block carried three figures and the Input/Output one was
   restated twice, an hour apart, with two different values for one clause.**
   The user's standing ruling is the remedy and it is not "derive them" — a
   derived figure goes stale the instant its subject moves. **Name the
   authority; do not restate a number.** The authority here is the generated
   module itself, `packages/contracts/generated/apps/customers/
   customer-directory-v1.ts`, whose export list is one command away.

   `0037` requirement 2 says *every generated type the console CAN consume, it
   consumes*, and **"can" is doing the work.**

   THE CRITERION, ruled 2026-09-13:

     > A type this console can consume is one that describes a shape crossing
     > ITS OWN wire boundary — a request it sends or a response it parses.

   THE GROUPS THAT REMAIN, BY NAME RATHER THAN BY TALLY:

     `DeleteCustomer` and `RestoreDeletedCustomer` — their Input and Output.
        This client DELIBERATELY does not call either: see `CustomerAction`
        below, eight of the contract's ten, absent by contract §11.1 rather
        than by omission. **Consuming their shapes here would make the union's
        absence unenforceable at the one place it is enforced.** Naming the
        operations is what makes this an absence somebody can check.

     The per-operation error unions, against a client that handles failures
        through one `ApiError` envelope. Consumable in principle — a screen
        could know which codes one operation can return — and not consumed.

     The field aliases (`Email`, `Phone`, `SearchQuery`, …). **These already
        arrive transitively** inside `Customer` and `CustomerSummary`, which
        ARE consumed. There is nothing to adopt.

     The permission constants. They name what Core requires; a client that
        read one to decide anything would be putting an authorization decision
        in the UI (`security.md` §2).

   ⚠ THE FIRST GROUP IS THE ONLY ONE WHERE "CAN CONSUME" IS A LIVE QUESTION.
   If this client ever calls `DeleteCustomer`, that group moves — and
   `verify-settings.mjs`'s pairing check notices, because the moment their
   shapes are declared here they become duplicates.
   --------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   Action inputs
   ------------------------------------------------------------------------- */

/*
 * `ListCustomersInput` and `SearchCustomersInput` are the contract's, consumed
 * at the top of this file.
 *
 * ⚠ THE HAND-WRITTEN `SearchCustomersInput` USED `extends ListCustomersInput`
 * AND THE GENERATED ONE DOES NOT — it restates every field. That is a real
 * difference in SHAPE-EXPRESSION and not in shape: both permit the same object.
 * Recorded because `extends` is the tempting thing to reintroduce, and doing so
 * would re-declare the parent locally to inherit from it.
 */

/**
 * `business_id` is REQUIRED and required rather than defaulted: a principal may
 * be authorized over several Businesses, so there is no single Business the
 * server can infer, and inferring one from an "active Business" in the session
 * would be an ambient default. Making the caller state it means the wrong
 * answer is a visible wrong answer.
 *
 * An optional field may be omitted or supplied as null; both mean "not
 * recorded". `status`, `customer_id` and any tenant identifier are not
 * properties here, and the schema sets `additionalProperties: false`, so
 * supplying one fails the request rather than being ignored.
 *
 * ⚠ CONSUMED FROM THE CONTRACT. The paragraph above stays because the generated
 * type cannot express any of it: that `business_id` is required RATHER THAN
 * DEFAULTED, and why inferring one would be an ambient default, is a decision
 * the schema records only as `required`.
 */

/**
 * PARTIAL UPDATE, and the three-way distinction is normative:
 *   - property ABSENT              -> unchanged
 *   - property PRESENT with a value -> set to that value
 *   - property PRESENT and null     -> cleared (optional fields only)
 *
 * `display_name` and `customer_type` are required on the record, so they may be
 * present-with-a-value or absent, never null — which is why they are typed
 * without `| null` while the optional fields keep it.
 *
 * `business_id` IS NOT A PROPERTY HERE AND MAY NOT BE ADDED. Moving a customer
 * between Businesses is MoveCustomerToBusiness — its own Action, its own
 * permission at organization scope only, and its own audit record. As a field
 * on a partial update it would be an unaudited re-assignment of a customer's
 * authorization scope under a permission a business-scope principal may hold.
 *
 * ⚠ DERIVED FROM `UpdateCustomerInput`, NOT RESTATED BESIDE IT.
 *
 * This was seven hand-written fields, and the generated Input is the same seven
 * plus `customer_id`. **Two independent restatements of one field set, with
 * nothing comparing them** — and the drift they permit is silent in the worst
 * direction: a field the contract adds gets no editor and no diff entry, so the
 * form saves without it and looks like it worked.
 *
 * `Omit` is the whole relationship. `customer_id` is not a *change* — it names
 * which record is being changed, and the client carries it as a separate
 * argument so a caller cannot put a different identifier in the body from the
 * one in the path.
 *
 * The result is `readonly`, which the generated Input is and the hand-written
 * interface was not. Nothing built one to mutate it: `CustomerForm.buildDiff`
 * accumulates into a local `Record` and asserts at the return.
 */
export type UpdateCustomerChanges = Omit<UpdateCustomerInput, 'customer_id'>;

/**
 * The seven fields a client may write, across create and update.
 *
 * BOUND TO THE CONTRACT IN BOTH DIRECTIONS, for the reason the header of the
 * constants block gives — and here the second direction is the load-bearing
 * one. The form draws its inputs by iterating this array and `buildDiff` walks
 * it to decide what changed, so **a field the contract adds and this array does
 * not carry is a field no reader can edit and no diff can report**, with the
 * save succeeding.
 */
export const EDITABLE_FIELDS = [
  'display_name',
  'customer_type',
  'email',
  'phone',
  'country',
  'address',
  'notes',
] as const;

EDITABLE_FIELDS satisfies readonly (keyof UpdateCustomerChanges)[];
type MissingEditableField = Exclude<keyof UpdateCustomerChanges, (typeof EDITABLE_FIELDS)[number]>;
const EDITABLE_FIELDS_ARE_EXHAUSTIVE: MissingEditableField extends never ? true : never = true;
void EDITABLE_FIELDS_ARE_EXHAUSTIVE;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * The eight Actions in scope for this slice.
 *
 * `customers.DeleteCustomer` and `customers.RestoreDeletedCustomer` are
 * contracted and DELIBERATELY ABSENT from this union — contract §11.1. Their
 * absence is the decision, not an oversight, and because this is a union rather
 * than a string, adding a call to either is a compile error rather than a code
 * review question.
 */
export type CustomerAction =
  | 'customers.CreateCustomer'
  | 'customers.GetCustomer'
  | 'customers.ListCustomers'
  | 'customers.SearchCustomers'
  | 'customers.UpdateCustomer'
  | 'customers.ArchiveCustomer'
  | 'customers.RestoreCustomer'
  | 'customers.MoveCustomerToBusiness';

/**
 * Re-exported for convenience. The gap this client once filled with a local
 * placeholder is closed: a Business reference is now `businessSummary` from
 * `core/organization/business-read-v1`. See contracts/business-read.ts.
 */
export type { BusinessSummary as BusinessRef } from './business-read';
