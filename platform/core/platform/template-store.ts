/**
 * The Template storage port. `template-v1` · `docs/decisions/0025` decision 2.
 *
 * THREE NAMED QUESTIONS, matching `platform-operator-store.ts`'s discipline: no `select(spec)`, no
 * table name, no predicate, no column list, no sort. A fixed list of the questions the three
 * Template routes actually ask.
 *
 * ===========================================================================================
 * IT HOLDS NO TENANT AND CANNOT REACH ONE — AND HERE THAT IS TRUE IN A STRONGER SENSE THAN USUAL
 * ===========================================================================================
 *
 * `platform_operator` and `organization` are control-plane tables ABOUT tenants: they hold tenant
 * identifiers, and `platform-operator-store.ts` has to state the honest limit that "no tenant data"
 * is exact while "no tenant identifier" is not.
 *
 * **`template` IS NOT ABOUT TENANTS AT ALL.** It is tenant-independent platform configuration: it
 * names no Organization, holds no Organization's data, and has no column that could carry either.
 * So this port is the one in the platform surface where the strong claim is simply true — **there
 * is no tenant identifier anywhere in its inputs or its outputs.**
 *
 * THAT IS WHY THE ISOLATION TEST FOR THIS SURFACE IS UNUSUAL, and `template-v1` requires
 * `qa-agent` to report it as NOT APPLICABLE with the reasoning rather than as passing: *"a green
 * tenant-isolation result on a surface with no tenants is a test that asserted nothing and would
 * pass identically if the whole isolation model were removed."* What replaces it: assert that no
 * route here can be made to return an `organization_id`, and that no field is capable of carrying
 * one.
 */

import type { Result } from '../kernel/result.ts';
import type { ControlPlaneWriteReservation } from '../identity/control-plane-admission.ts';
import type { TemplateLabels, TemplateRecord, TemplateStatus } from './templates.ts';

export type NewTemplate = {
  readonly templateId: string;
  /** As the operator typed it. */
  readonly name: string;
  /** `normalizeTemplateName(name)`. The collision key; see `templates.ts`. */
  readonly normalizedName: string;
  readonly labels: TemplateLabels;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

export type TemplateStore = {
  /**
   * Writes one Template, or reports a name collision.
   *
   * `false` MEANS A TEMPLATE WITH THAT NORMALISED NAME ALREADY EXISTS. It is not an error value —
   * the caller turns it into `conflict()`, which `template-v1` rules is safe to disclose here for
   * a reason that does NOT generalise: *"Templates are platform configuration visible to every
   * operator through `platform.templates.list`. A conflict discloses the existence of something
   * the caller may already enumerate."*
   *
   * **CONTRAST EVERY `not_found` RULING IN THIS PLATFORM**, which collapses cases precisely
   * because the caller may NOT enumerate what it is probing. The reasoning is what should be
   * copied, never the outcome.
   *
   * IT IS DECIDED BY THE UNIQUE INDEX AND NOT BY A PRIOR READ. A read-then-insert would be two
   * concurrent creates both seeing "no collision" and one failing on the constraint anyway —
   * the same read-then-write shape `confirmation-store.ts` refuses, arriving in a milder form.
   */
  create(
    record: NewTemplate,
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<boolean>>;

  /**
   * One bounded page, ordered by identifier.
   *
   * `limit` REQUIRED, no unlimited form, and `afterTemplateId` is a KEYSET ANCHOR rather than an
   * offset — the same reasoning as `listOrganizations`: on a single-threaded database an unbounded
   * read is every Organization's latency, and OFFSET pagination reads and discards every earlier
   * row.
   */
  /**
   * `status` FILTERS; `null` MEANS UNFILTERED, WHICH IS THE SERVER DEFAULT AND DOES NOT CHANGE.
   *
   * *** THE FILTER WAS ADDED WITH THE RETIRE ROUTE AND IS NOT A CONVENIENCE. *** `template-v1`'s
   * `listFilterAmendment`: **the moment `retired` becomes reachable, a list that mixes retired and
   * active Templates recreates the defect name-uniqueness exists to prevent.** This contract set's
   * own words — *"two Templates called School are indistinguishable to the operator choosing one"* —
   * become *"an active and a retired School are indistinguishable in a picker"*. Retire without a
   * filter is a half-built feature.
   *
   * *** ABSENT STAYS UNFILTERED, SERVER-SIDE, AND THE DEFAULT THAT MATTERS LIVES IN THE CLIENT. ***
   * Changing the server default to `active` was considered and rejected: it is a semantic change to
   * a published operation, unobservable today and observable the first time retire is used, and
   * *"a change that is invisible until the feature that makes it visible ships is not a safe change,
   * it is a delayed one."* Both clients SEND `status=active` on an operator-facing list.
   *
   * IT TOUCHES NO INDEX. `0012_template.sql` creates none on `status` and none is needed: this is a
   * bounded keyset page over the primary key, and the filter narrows a page that was already bounded.
   */
  list(
    limit: number,
    afterTemplateId: string | null,
    status: TemplateStatus | null,
  ): Promise<Result<readonly TemplateRecord[]>>;

  /**
   * ===========================================================================================
   * HOW MANY TEMPLATES EXIST. A SCALAR, AND IT TAKES NO FILTER.
   * `platform.templates.count` · `docs/decisions/0042`.
   * ===========================================================================================
   *
   * *** NO `status` PARAMETER, AND ITS ABSENCE IS A RULING RATHER THAN AN OMISSION. *** `list`
   * gained that filter one method up because **a picker must not offer a retired Template beside an
   * active one**. A TOTAL IS A DIFFERENT QUESTION: *"a number that changed with a filter would be a
   * different number under the same name, and an operator asking 'how many Templates are there' is
   * asking about the table."* **A total that accepts a filter is a query** — the same disclosure
   * arriving one parameter at a time.
   *
   * IF A FILTERED COUNT IS EVER WANTED IT IS A SEPARATE OPERATION WITH A SEPARATE NAME. Stated as
   * the reason rather than as a prohibition, so whoever needs one does not read this as a refusal
   * of the requirement.
   *
   * *** IT NEEDS NO PERMISSION OF ITS OWN, AND `organizations_using` DID — THE SAME TEST, DIFFERENT
   * POPULATIONS. *** `security.md` §2a: a count is safe exactly when its consumer already holds
   * enumeration over the counted population. **This counts TEMPLATES and a `core.template.list`
   * holder enumerates Templates**, so it reaches nothing past that right — walking the pages yields
   * the same number, more slowly and at an audit row per page. `countOrganizationsUsingTemplate`
   * counts ORGANIZATIONS, over which a Template reader holds nothing, which is why that one has a
   * `sensitive` permission of its own.
   *
   * A `COUNT`, NEVER A FETCH-AND-LENGTH. Reading every row to measure the length is the same number
   * on the wire and a different number against `d1-rows-read`.
   */
  count(): Promise<Result<number>>;

  /**
   * One Template, or `null`.
   *
   * THE CALLER TURNS `null` INTO AN HONEST `not_found`, AND THAT IS UNUSUAL IN THIS CODEBASE.
   * Everywhere else Dudo collapses "does not exist" with "not yours" to close an existence oracle.
   * Templates are tenant-independent platform configuration and **every caller who can reach this
   * route may already enumerate all of them, so there is no population to protect and nothing a
   * distinction could leak.**
   *
   * Stated because a reviewer comparing this to `customer-directory-v1` will otherwise read it as
   * an inconsistency.
   */
  findById(templateId: string): Promise<Result<TemplateRecord | null>>;

  /**
   * ===========================================================================================
   * EDIT ONE TEMPLATE'S NAME AND LABELS. `template-lifecycle-v1` · `template-v1` TM-1.
   * ===========================================================================================
   *
   * *** IT CANNOT SET `status`, AND THAT IS THE PERMISSION SPLIT HELD IN A TYPE. *** `setStatus` is
   * the only method that writes that column. The contract's reason is not tidiness: *"a `status` in
   * a PATCH body would make `core.template.update` able to perform `core.template.retire`'s act,
   * which is the permission split undone by a field."* **A port that cannot express the transition
   * cannot be the route by which the split is lost.**
   *
   * *** EVERY REFUSAL IS DECIDED IN THE WRITING STATEMENT, NOT BY A PRIOR READ. ***
   * `architecture.md` §3a ranks the layers and is explicit that the in-statement guard *"is the only
   * layer with no window at all, because it re-asks the question in the same statement that
   * writes."* The caller has read the Template — it needs the stored labels as the merge base — and
   * **that read is stale by the time this runs.** Between the two, another operator may retire the
   * Template or take the name. So both conditions are re-asked here.
   *
   * `name_taken` EXCLUDES THE ROW BEING UPDATED, and the contract says why the obvious version is
   * wrong: *"the obvious implementation — 'does any row have this normalised name' — returns the row
   * itself and refuses every edit that keeps the name."* Renaming a Template to its own current name
   * alongside a label change is a 200.
   *
   * `raced` IS NOT A COLLISION AND IS NOT AN ERROR — it is the guard having refused while a
   * follow-up read finds nothing wrong, which only a concurrent write explains. It is reported
   * separately rather than folded into `name_taken` because **an outcome that says "collision" when
   * there was none would send an operator hunting for a duplicate that does not exist.**
   */
  update(
    templateId: string,
    next: {
      readonly name: string;
      /** `normalizeTemplateName(name)`. The collision key; see `templates.ts`. */
      readonly normalizedName: string;
      readonly labels: TemplateLabels;
    },
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<TemplateUpdateOutcome>>;

  /**
   * ===========================================================================================
   * RETIRE OR RESTORE. ONE METHOD, BOTH DIRECTIONS, AND THE EXPECTED CURRENT STATE IS REQUIRED.
   * ===========================================================================================
   *
   * *** `from` IS NOT A CONVENIENCE — IT IS THE `failed_precondition` GUARD, IN THE STATEMENT. ***
   * `template-lifecycle-v1` refuses a second retire rather than treating it as idempotent, because
   * *"a silent success writes an audit record saying an operator retired something that was already
   * retired, and a trail whose entries do not correspond to changes is a trail that has to be read
   * twice."* Making the expected state a required argument of the write means the check cannot be
   * performed against a stale read: the statement matches no row unless the Template is still in the
   * state the caller believed.
   *
   * *** ONE METHOD RATHER THAN `retire()` AND `restore()`, AND THE ROUTES ARE STILL TWO. *** The two
   * routes exist because *"a toggle's audit record cannot say which direction it went without
   * reading the previous state"* — that is a fact about the AUDIT TRAIL and the AUTHORIZED ACT, both
   * of which live above this port. Down here the two directions are one column and one guard, and
   * two methods would be two copies of one statement.
   *
   * IT TOUCHES NO INDEX. `0012_template.sql`: *"NO INDEX ON `status`."* If one is ever added,
   * `TEMPLATE_STATUS_ROW_WRITES` moves with it.
   */
  setStatus(
    templateId: string,
    transition: {
      /** The state the caller believes the Template is in. The guard, not a hint. */
      readonly from: TemplateStatus;
      readonly to: TemplateStatus;
    },
    reservation: ControlPlaneWriteReservation,
  ): Promise<Result<TemplateStatusOutcome>>;
};

/**
 * What `update` did, or why it did not.
 *
 * A CLOSED UNION RATHER THAN A BOOLEAN, because the four outcomes are four different HTTP answers —
 * 200, 404, 409 and 422 — and a boolean would make the caller guess which. `create` returns a
 * boolean legitimately: it has exactly two outcomes and one of them is the collision.
 */
export type TemplateUpdateOutcome = 'updated' | 'not_found' | 'retired' | 'name_taken' | 'raced';

/** What `setStatus` did. `already_in_state` is the contract's `failed_precondition`, both ways. */
export type TemplateStatusOutcome = 'updated' | 'not_found' | 'already_in_state';
