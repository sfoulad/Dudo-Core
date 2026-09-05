/**
 * ===========================================================================================
 * TEMPLATES — the domain rules. `docs/decisions/0025` decision 2 · contract `template-v1`.
 * ===========================================================================================
 *
 * A Template IS a business type. `ARCHITECTURE.md` §1 has recorded it as the fifth extension type
 * since Phase 0 — *"a pre-configured combination of Apps and settings for a business type: Salon,
 * Dental Clinic, Gym. Carries no code."*
 *
 * ===========================================================================================
 * *** THE BOUNDARY. THE MOST IMPORTANT THING IN THIS FILE. ***
 * ===========================================================================================
 *
 *   **A TEMPLATE MAY NAME Apps AND CARRY LABELS. IT MAY NEVER CONTAIN LOGIC.**
 *
 * `CORE_BOUNDARIES.md` §6 rule 1 forbids industry nouns, and it **governs types, tables, columns,
 * functions and routes — not rows.** A row reading "Dental Clinic" is data; a `dental_clinic`
 * column is a defect. That distinction is not a quibble: **it is the entire reason this capability
 * can exist in Core at all.** Without it, "Core must know about dental clinics" is an obvious
 * violation and the feature is unbuildable.
 *
 * *** THE CHECKABLE FORM, AND IT IS A REVIEW OBLIGATION ON EVERY CHANGE HERE: ***
 * **NO IDENTIFIER IN `platform/core/**` MAY NAME A BUSINESS TYPE.** No `SCHOOL_LABELS`, no
 * `isClinic()`, no `switch (template.name)`, no seeded row that code branches on. **The moment
 * Core reads a Template's NAME to decide behaviour, the row has become a column.**
 *
 * NOTHING IN THIS FILE READS A TEMPLATE'S NAME. It is normalised for collision detection and
 * otherwise carried, never inspected — `normalizeName` is the only function that touches it, and
 * it treats the value as opaque text.
 *
 * ===========================================================================================
 * WHAT A TEMPLATE MAY NOT CARRY, AND WHY THE SHAPE IS THE ENFORCEMENT
 * ===========================================================================================
 *
 *   NO WORKFLOW · NO VALIDATION RULE · NO PRICING, TAX OR DISCOUNTING RULE · NO CODE, EXPRESSION,
 *   SCRIPT, CONDITION OR TEMPLATING SYNTAX IN ANY FIELD · NO PERMISSION SET OR ROLE DEFINITION.
 *
 * THE CONSEQUENCE OF BREAKING IT IS PERMANENT, which is why the list is a prohibition rather than
 * a guideline: *"the cost of wrongly including something is a constraint on every future business
 * type, and it is effectively permanent."*
 *
 * **THE TYPES BELOW ARE HOW THAT IS ENFORCED RATHER THAN ASKED FOR.** A Template is a name, three
 * label strings and a status. There is no `rules` field, no `config` object, no JSON value and no
 * open map — **a shape with nowhere to put logic is a shape logic cannot be put into.**
 *
 * ===========================================================================================
 * A LABEL CHANGES WHAT A HUMAN READS AND NOTHING ELSE
 * ===========================================================================================
 *
 * `workspace` is the scope name in `permission-catalog.yaml` and in `authorization/scope.ts`
 * whatever a Template calls it on screen, and an Action's declared scope is NEVER read from a
 * Template. **A label that could alter a scope would be configuration deciding authorization**,
 * which is the shape `0007` D1 forbids. Nothing in `platform/core/authorization/**` imports this
 * file, and nothing should.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';
import { normalizeIdentifier } from '../identity/credential-store.ts';

/**
 * The three structural levels a Template may label. A CLOSED SET.
 *
 * NOT `team`, which is a first-class object with its own name and no per-type variation anyone has
 * asked for. NOT `own` or `resource`, which are authorization scopes and not places.
 *
 * AN OPEN MAP WOULD LET AN OPERATOR INVENT A LEVEL THAT DOES NOT EXIST, and a client rendering an
 * unknown key would be drawing a structure the platform does not have.
 */
export type TemplateLevel = 'organization' | 'workspace' | 'branch';

export const TEMPLATE_LEVELS: readonly TemplateLevel[] = Object.freeze([
  'organization',
  'workspace',
  'branch',
]);

/**
 * The platform defaults, applied server-side so a response is ALWAYS fully populated.
 *
 * **THE CLIENTS NEVER IMPLEMENT THIS TABLE**, and that is the point: two clients each holding a
 * default table are two clients that drift into different ideas of what an unlabelled level is
 * called, and the drift shows up as one platform using two words for one thing.
 *
 * `Workspace` IS THE DEFAULT FOR THE INNER UNIT. `docs/decisions/0025`'s amendment of 2026-09-05
 * did NOT perform the `Business` → `Workspace` rename — `business_id` turned out to be a published
 * wire field two clients have shipped against and a persisted audit value — so **the customer wire
 * keeps `business_id` and the platform surface is written in `Workspace` terms.** Two vocabularies
 * at two ages, and the seam is left visible rather than bridged by a translation layer.
 */
const DEFAULT_LABELS: Readonly<Record<TemplateLevel, string>> = Object.freeze({
  organization: 'Organization',
  workspace: 'Workspace',
  branch: 'Branch',
});

export type TemplateLabels = Readonly<Record<TemplateLevel, string>>;

export type TemplateStatus = 'active' | 'retired';

export type TemplateRecord = {
  readonly templateId: string;
  /** As the operator typed it. Never normalised for display. */
  readonly name: string;
  readonly labels: TemplateLabels;
  readonly status: TemplateStatus;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

/** `template-v1.schema.json`'s bounds, enforced rather than assumed. */
export const MAX_TEMPLATE_NAME_LENGTH = 80;
export const MAX_TEMPLATE_LABEL_LENGTH = 40;

/**
 * The collision key.
 *
 * ===========================================================================================
 * IT IS `credential-store.ts::normalizeIdentifier`, IMPORTED RATHER THAN RESTATED.
 * ===========================================================================================
 *
 * The contract specifies *"NFKC then ASCII-only case folding — THE SAME DEFINITION
 * `credential-store.ts::normalizeIdentifier` USES, restated in the schema rather than invented"*.
 * So this function imports it instead of reimplementing it, and the two cannot drift.
 *
 * **NOT FULL UNICODE LOWERCASING**, for that file's own reason: JavaScript and Swift disagree on
 * real characters, and a rule three implementations must share cannot depend on which one runs it.
 * The cost is that two names differing only by a non-ASCII case distinction are two Templates —
 * accepted there, and accepted here for the same reason.
 *
 * THE STORED NAME IS THE OPERATOR'S ORIGINAL. This decides collision, never display.
 */
export function normalizeTemplateName(name: string): string {
  return normalizeIdentifier(name);
}

/**
 * Validates a create request and fills the defaults.
 *
 * WHAT IT REFUSES, AND EVERY REFUSAL IS A SHAPE RULE RATHER THAN A BUSINESS RULE — which is what
 * keeps this file inside the boundary. It checks lengths, whitespace and the closed key set. **It
 * does not know what any of the values mean**, and there is no branch anywhere in it that depends
 * on what a name says.
 *
 * AN UNKNOWN LEVEL KEY IS REFUSED RATHER THAN IGNORED. The closed set is enforced, not documented:
 * an ignored key is a key a client believes it set, and a Template rendering a level Dudo does not
 * have is a structure nobody can draw.
 */
export function parseTemplateCreate(input: {
  readonly name: unknown;
  readonly labels: Readonly<Record<string, unknown>>;
}): Result<{ readonly name: string; readonly labels: TemplateLabels }> {
  if (typeof input.name !== 'string') {
    return err(invalidArgument([detail('name', 'must_be_a_string')]));
  }
  const name = input.name;
  if (name.length === 0 || name.length > MAX_TEMPLATE_NAME_LENGTH) {
    return err(invalidArgument([detail('name', 'out_of_range')]));
  }
  if (name.trim() !== name) {
    // The schema's `^[^\s].*[^\s]$` — no leading or trailing whitespace. A name that differs from
    // another only by a trailing space is two Templates an operator cannot tell apart in a list,
    // which is the same failure uniqueness exists to prevent, arriving through a different door.
    return err(invalidArgument([detail('name', 'must_not_be_padded')]));
  }

  const labels: Record<TemplateLevel, string> = { ...DEFAULT_LABELS };
  for (const [key, value] of Object.entries(input.labels)) {
    const level = TEMPLATE_LEVELS.find((candidate) => candidate === key);
    if (level === undefined) {
      return err(invalidArgument([detail(`level_labels.${key}`, 'unknown_level')]));
    }
    if (typeof value !== 'string') {
      return err(invalidArgument([detail(`level_labels.${key}`, 'must_be_a_string')]));
    }
    if (value.length === 0 || value.length > MAX_TEMPLATE_LABEL_LENGTH) {
      return err(invalidArgument([detail(`level_labels.${key}`, 'out_of_range')]));
    }
    if (value.trim() !== value) {
      return err(invalidArgument([detail(`level_labels.${key}`, 'must_not_be_padded')]));
    }
    labels[level] = value;
  }
  return ok({ name, labels: Object.freeze(labels) });
}

/**
 * The wire shape of a Template.
 *
 * `level_labels` IS ALWAYS FULLY POPULATED, defaults included, for the reason on `DEFAULT_LABELS`.
 *
 * ===========================================================================================
 * THE NAME AND THE LABELS ARE RETURNED AS TEXT AND ARE NEVER EVALUATED — ANYWHERE, BY ANYONE.
 * ===========================================================================================
 *
 * A Template name containing an expression, a script tag or templating syntax is STORED AS TEXT
 * and rendered as text by both clients. There is no interpolation of these values in Core, no
 * template engine, and no path by which one reaches a renderer that would evaluate it.
 *
 * **NOTE HOW THIS DIFFERS FROM A CONFIRMATION STATEMENT, because the contrast is the reason both
 * are safe.** `confirmation/statements.ts` refuses any parameter that is not a bare identifier,
 * precisely because it INTERPOLATES the value into server-authored text a human is asked to trust.
 * A Template label is never interpolated into anything Core composes — it is data the client
 * renders in its own chrome — so free text is safe here and would not be there. The rule is not
 * "free text is fine"; it is "free text is fine where nothing evaluates it", and the two files
 * arrive at opposite answers from the same principle.
 */
export function toTemplateOutput(record: TemplateRecord): Readonly<Record<string, unknown>> {
  return {
    template_id: record.templateId,
    name: record.name,
    level_labels: {
      organization: record.labels.organization,
      workspace: record.labels.workspace,
      branch: record.labels.branch,
    },
    status: record.status,
    created_at: record.createdAt,
  };
}
