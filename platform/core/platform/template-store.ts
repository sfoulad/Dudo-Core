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
import type { TemplateLabels, TemplateRecord } from './templates.ts';

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
  list(
    limit: number,
    afterTemplateId: string | null,
  ): Promise<Result<readonly TemplateRecord[]>>;

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
};
