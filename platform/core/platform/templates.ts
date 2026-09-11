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

/**
 * The closed set, as values.
 *
 * *** ONE DEFINITION, AND IT LIVES HERE BESIDE THE TYPE. *** The D1 adapter had its own array and
 * `readTemplateStatusFilter` needed a third — which is `workflow.md` §12's duplicated constraint
 * arriving in the smallest possible form, on the enumeration the migration's `CHECK` constraint
 * also states. **Three copies of two strings is three places to add the third status**, and the one
 * that gets missed answers `unknown_status` to a value the database happily stores.
 *
 * IT IS `extensible` ON THE WAY OUT AND `closed` ON THE WAY IN, and both are correct — `0041`
 * amendment 1. This array is the CLOSED half: what a caller may send. The tolerant half belongs to
 * the clients, which must render a status they were never taught rather than refuse it.
 */
export const TEMPLATE_STATUSES: readonly TemplateStatus[] = Object.freeze(['active', 'retired']);

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
 * ===========================================================================================
 * THE TWO PERMITTED FORMAT CHARACTERS, AND THE ONLY FUNCTION THAT REMOVES THEM.
 * `U+200C` ZERO WIDTH NON-JOINER · `U+200D` ZERO WIDTH JOINER. `template-v1` SR-8.
 * ===========================================================================================
 *
 * **THEY ARE CATEGORY `Cf` AND THEY ARE ACCEPTED ANYWAY, DELIBERATELY.** Persian, Arabic and Indic
 * scripts REQUIRE them for correct rendering, and Dudo operates in Bahrain — *"an Arabic Template
 * name is an ordinary requirement, not an edge case."* Forbidding them would refuse a legitimately
 * spelled name, which is the trap this contract set already records for registration numbers: *"a
 * pattern is a refusal, and an at-count pattern that is wrong refuses a LEGAL registration."*
 *
 * *** ONE FUNCTION SERVES BOTH HALVES OF THE RULING, AND THAT IS WHY THE HALVES CANNOT DIVERGE. ***
 * `checkTemplateText` removes them before testing the forbidden categories (so they are permitted at
 * input), and `normalizeTemplateName` removes them before comparing (so they cannot be used to build
 * a confusable pair). **Two copies of this set would be a name accepted under one rule and compared
 * under another** — which is the defect, not a step toward it.
 *
 * ===========================================================================================
 * *** BUILT WITH `String.fromCharCode` SO THIS SOURCE FILE STAYS PURE ASCII, AND THAT IS NOT
 * FASTIDIOUSNESS — MY FIRST TWO DRAFTS PUT THE LITERAL CHARACTERS HERE. ***
 * ===========================================================================================
 *
 * A zero-width character written literally is **invisible in the source of the very function that
 * forbids invisible characters.** It is the class of defect `platform-route-handlers.ts` is
 * quarantined for, introduced by the edit that closes it elsewhere — and it would be **unreviewable
 * by construction**: nobody diffing this line could see what changed.
 *
 * A `\uXXXX` ESCAPE WOULD ALSO BE CORRECT AND WAS TRIED TWICE. **Both times the editing tool
 * resolved the escape and wrote the character**, which is worth recording because it means *"write
 * it as an escape"* is advice that can silently fail. `String.fromCharCode` is a RUNTIME call on
 * two integers: there is no character in this file for a tool to resolve, the bytes are checkable
 * with `grep`, and it is the device this repository already uses for `NUL`.
 *
 * `new RegExp` RATHER THAN A LITERAL, FOR THE SAME REASON — a regex literal would need the
 * characters in the source. The pattern is a compile-time constant in everything but syntax.
 */
const PERMITTED_JOINERS = new RegExp(
  `[${String.fromCharCode(0x200c, 0x200d)}]`,
  'gu',
);

function withoutJoiners(value: string): string {
  return value.replace(PERMITTED_JOINERS, '');
}

/**
 * ===========================================================================================
 * *** THE CHARSET RULING, BY UNICODE GENERAL CATEGORY AND NEVER BY A LIST OF CODE POINTS. ***
 * `template-v1.schema.json`, SR-8, ruled 2026-09-11.
 * ===========================================================================================
 *
 * **THE DEFECT THIS CLOSES WAS LIVE ON THE DEPLOYED CREATE ROUTE AND WAS MEASURED, NOT ARGUED.**
 * The only constraints were a length bound and no edge whitespace. NFKC collapses fullwidth forms
 * and **does not remove `U+202E` RIGHT-TO-LEFT OVERRIDE or `U+200B` ZERO WIDTH SPACE**, so `School`
 * and `Scho<U+202E>ol` normalised DIFFERENTLY, were accepted as two distinct Templates, and are
 * **visually identical in the picker an operator chooses from.** That is the ambiguity the
 * uniqueness index exists to prevent — the index defeated by a character it cannot see.
 *
 * **`U+0000` WAS ACCEPTED AND SURVIVED INTO `normalized_name`**, the stored collision key compared
 * on every future create. A general-purpose shell refused to run the probe that demonstrated it,
 * on the grounds that control characters would be hidden in an approval dialog. Core accepted it.
 *
 * *** CATEGORIES RATHER THAN CODE POINTS, AND THE REASON IS THE FAILURE DIRECTION. *** A code-point
 * list is correct on the day it is written and **silently short the next time Unicode assigns a
 * format character**; `\p{Cf}` covers one that does not exist yet. This fails CLOSED on a widening,
 * which is the property `architecture.md` §3a-i asks for, applied to a charset.
 *
 * `Zs` IS ABSENT ON PURPOSE. An ordinary space is legal inside a name — "Dental Clinic" — and edge
 * whitespace is refused separately by `checkTemplateText`.
 *
 * ===========================================================================================
 * *** `Cs` ADDED 2026-09-11 — SR-17. THE ORIGINAL LIST OMITTED IT, AND THE CONSEQUENCE IS A FALSE
 * COLLISION RATHER THAN THE HYGIENE ISSUE IT LOOKS LIKE. ***
 * ===========================================================================================
 *
 * A LONE SURROGATE — `String.fromCharCode(0xd800)`, unpaired — **survives `JSON.parse`, survives
 * NFKC, and reached `normalized_name`.** Measured against the unfixed tree rather than reasoned
 * about, because the interesting half is what the DATABASE then does with it:
 *
 *     Core computes    scho <D800> ol      hex  73 63 68 6f d800 6f 6c
 *     the DB returns   scho <FFFD> ol      hex  73 63 68 6f fffd 6f 6c
 *
 * **IT NEITHER THROWS NOR PRESERVES. It SUBSTITUTES `U+FFFD`** — which was the outcome nobody
 * predicted, and it is worse than either:
 *
 *   1. *** TWO DIFFERENT NAMES COLLIDE IN STORAGE THAT DO NOT COLLIDE IN CORE. *** `<D800>` and
 *      `<DFFF>` are distinct keys here and both become `<FFFD>` there, so **the second Template is
 *      refused as a duplicate of a name it does not share.** A FALSE conflict, on the route whose
 *      whole purpose is to keep names distinguishable.
 *   2. **The stored key is a value Core never produced**, so the uniqueness index is keyed on
 *      something no future computation will reproduce exactly.
 *
 * *** IT WOULD HAVE BEEN ADDED REGARDLESS OF THE MEASUREMENT. *** This list's own stated principle
 * is categories rather than code points, failing closed on a widening — and `Cs` is a category the
 * enumeration simply missed. The probe is for the record, not for the decision.
 *
 * *** AND IT DOES NOT REFUSE LEGAL ASTRAL TEXT, WHICH IS WHAT MAKES IT SAFE. *** Under the `u`
 * flag a WELL-FORMED surrogate pair is one code point and is NOT `Cs`: `U+1F600` and ordinary
 * Arabic both pass and both round-trip byte-identical. **Only an UNPAIRED half is refused** — which
 * is the same shape as the ZWNJ/ZWJ exception, arriving from the opposite direction.
 *
 * ⚠ MEASURED ON `node:sqlite`, WHICH IS NOT D1. The suites' engine, not Cloudflare's. **What D1
 * does with a lone surrogate is UNANSWERED** — `d1_database_query` is deliberately withheld, so
 * establishing it needs a production action nobody has taken. **The input rejection below makes the
 * question moot rather than answering it**, which is the right order: a value that cannot be stored
 * cannot expose an engine's substitution policy.
 *
 * *** THE SCHEMA'S `pattern` IS AN APPROXIMATION AND IS NOT THIS RULE. *** It enumerates BMP ranges
 * because JSON Schema patterns are ECMA-262 regexes whose `\p{...}` support is implementation-
 * dependent, so it cannot express the category rule and does not reach past the BMP. **And nothing
 * in this repository executes JSON Schema at all.** Not covered in full, and not executed — two
 * independent axes (`workflow.md` §12). **THIS FUNCTION IS THE ENFORCEMENT.**
 */
const FORBIDDEN_CATEGORIES = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;

/**
 * The collision key.
 *
 * ===========================================================================================
 * THREE STEPS, IN THIS ORDER: STRIP THE JOINERS, THEN NFKC, THEN ASCII-ONLY CASE FOLDING.
 * ===========================================================================================
 *
 * *** IT COMPOSES `credential-store.ts::normalizeIdentifier` AND MUST NEVER MODIFY IT. ***
 * Steps 2 and 3 ARE that function, imported rather than reimplemented so the two cannot drift.
 * **Step 1 is this function's own, and pushing it into the shared normaliser is the mistake to
 * refuse.** The strip is a no-op on an account identifier, which is printable-ASCII-only — so
 * folding it in would be harmless TODAY, **which is precisely the argument that builds a coupling**
 * between a login identifier's rule and a business type's. `template-v1` already records the mirror
 * hazard: *"a rejection added INSIDE `normalizeIdentifier`, to close the identifier enforcement gap,
 * would silently refuse every non-ASCII Template name."*
 *
 * *** STEP 1 IS WHAT MAKES THE ZWNJ/ZWJ EXCEPTION SAFE. *** Permitting them at input without
 * stripping them here leaves the confusable pair fully intact: between Latin letters a ZWJ renders
 * as nothing, so `School` and `Scho<ZWJ>ol` would be two Templates an operator cannot tell apart.
 * **The exception and the strip are one ruling, and half of it is worse than neither.**
 *
 * **NOT FULL UNICODE LOWERCASING**, for `normalizeIdentifier`'s own reason: JavaScript and Swift
 * disagree on real characters, and a rule three implementations must share cannot depend on which
 * one runs it. Two names differing only by a non-ASCII case distinction are two Templates.
 *
 * THE STORED NAME IS THE OPERATOR'S ORIGINAL, JOINERS INCLUDED. This decides collision, never
 * display — which is what lets a Persian name be spelled correctly and still be unique.
 */
export function normalizeTemplateName(name: string): string {
  return normalizeIdentifier(withoutJoiners(name));
}

/**
 * ===========================================================================================
 * THE SHARED TEXT FLOOR FOR EVERY OPERATOR-SUPPLIED TEMPLATE STRING.
 * ===========================================================================================
 *
 * *** IT IS ONE FUNCTION BECAUSE THE RULE IS ONE RULE, AND THE RULE ARRIVES AT TWO ENTRY POINTS. ***
 * `template-v1.schema.json` is explicit that the charset ruling is enforced *"at every entry point
 * that accepts a template name, which is create AND update"*. Two copies of a charset rule is
 * `workflow.md` §12's duplicated constraint on the one kind of value where a divergence means a
 * string accepted under one route and refused under the other.
 *
 * *** IT DOES NOT KNOW WHAT THE VALUE MEANS, AND THAT IS THE BOUNDARY. *** Length, edge whitespace,
 * the charset, and nothing about what a name SAYS. There is no branch here on any business type.
 *
 * *** IT IS THE ENFORCEMENT OF SR-8's CATEGORY RULE, AT EVERY ENTRY POINT — CREATE AND UPDATE. ***
 * `template-v1.schema.json` requires exactly that, in terms, and until 2026-09-11 **Core enforced
 * none of it and the deployed create route accepted every character the ruling forbids.** See
 * `FORBIDDEN_CATEGORIES` for what was measured and why the rule is stated as categories.
 */
function checkTemplateText(
  field: string,
  value: unknown,
  maxLength: number,
): Result<string> {
  if (typeof value !== 'string') {
    return err(invalidArgument([detail(field, 'must_be_a_string')]));
  }
  if (value.length === 0 || value.length > maxLength) {
    return err(invalidArgument([detail(field, 'out_of_range')]));
  }
  // ---- THE CHARSET, CHECKED WITH THE TWO PERMITTED JOINERS REMOVED FIRST.
  //
  // `withoutJoiners` is the exemption: ZWNJ and ZWJ are category `Cf` and would otherwise be
  // refused by the line below. Removing them here rather than writing a negated character class
  // means **the permitted set and the collision key's strip are the same function**, so a future
  // change to one cannot leave the other behind.
  //
  // THE VALUE IS NEVER ECHOED. `detail()` has no parameter for one, which matters more here than
  // usual: echoing a rejected name would put a bidi override or a NUL into a log line and an error
  // body, reproducing the hazard in the place that reports it.
  if (FORBIDDEN_CATEGORIES.test(withoutJoiners(value))) {
    return err(invalidArgument([detail(field, 'forbidden_character')]));
  }
  if (value.trim() !== value) {
    // The schema's `^[^\s].*[^\s]$` — no leading or trailing whitespace. A name that differs from
    // another only by a trailing space is two Templates an operator cannot tell apart in a list,
    // which is the same failure uniqueness exists to prevent, arriving through a different door.
    //
    // REJECTED RATHER THAN TRIMMED, for `isSubmittableIdentifier`'s reason: three implementations
    // in three languages trim different Unicode sets, and refusing removes a disagreement instead
    // of arbitrating it.
    return err(invalidArgument([detail(field, 'must_not_be_padded')]));
  }
  return ok(value);
}

/**
 * Reads the `level_labels` object against the closed level set, onto a caller-supplied base.
 *
 * *** THE BASE IS THE WHOLE DIFFERENCE BETWEEN CREATE AND UPDATE, AND IT IS A PARAMETER RATHER
 * THAN A BRANCH. *** Create passes `DEFAULT_LABELS`, so an absent key takes the platform default.
 * Update passes THE TEMPLATE'S CURRENT LABELS, so an absent key keeps what the Template already
 * says. **`template-lifecycle-v1` makes that a named test case** — *"an update supplying only
 * `level_labels: {workspace: 'Campus'}` leaves `organization` and `branch` AT THEIR PREVIOUS VALUES
 * and does not reset them to platform defaults. THIS IS THE PARTIAL-MERGE CASE AND IT DIFFERS FROM
 * CREATE, where an absent key takes the default — the two routes share a `$ref` and the suite must
 * prove they do not share the rule."*
 *
 * AN UNKNOWN LEVEL KEY IS REFUSED RATHER THAN IGNORED. The closed set is enforced, not documented:
 * an ignored key is a key a client believes it set, and a Template rendering a level Dudo does not
 * have is a structure nobody can draw.
 *
 * ===========================================================================================
 * *** A LABEL ANSWERS TO SR-8's CHARSET RULE FOR A DIFFERENT REASON THAN A NAME DOES, AND THE
 * DIFFERENCE IS RECORDED SO A FUTURE CHANGE TO THE NAME COMPARISON DOES NOT SWEEP IT ALONG. ***
 * ===========================================================================================
 *
 * **A LEVEL LABEL HAS NO UNIQUENESS COMPARISON AT ALL.** Nothing compares two labels, so
 * `normalizeTemplateName`'s second half — strip the joiners from the collision key — **has no
 * equivalent here, and its absence is deliberate rather than forgotten.** The confusability argument
 * that drives the rule for a name does not reach a label.
 *
 * **THE RULE STILL APPLIES, AND THE REASON IS STRONGER RATHER THAN WEAKER: THESE STRINGS ARE
 * RENDERED TO EVERY USER IN EVERY ADOPTING TENANT AS THE NAME OF THEIR OWN STRUCTURE.** A `U+202E`
 * here reverses the rendering of whatever follows it in a navigation label, **on a screen belonging
 * to a customer who never chose the Template and cannot edit it.** The injection point is a platform
 * operator; the blast radius is every adopter. **And a label reaches more rendering paths than a
 * name does** — it is interpolated into sentences a user reads, where a name is shown in a list.
 *
 * SO THE TWO DEFS SHARE A RULE AND NOT A REASON. If the uniqueness comparison on a name is ever
 * changed, **this does not follow it**; and if labels ever acquire a comparison, this paragraph is
 * what tells the next author the missing half was absent rather than overlooked.
 */
function readLevelLabels(
  submitted: Readonly<Record<string, unknown>>,
  base: TemplateLabels,
): Result<TemplateLabels> {
  const labels: Record<TemplateLevel, string> = { ...base };
  for (const [key, value] of Object.entries(submitted)) {
    const level = TEMPLATE_LEVELS.find((candidate) => candidate === key);
    if (level === undefined) {
      return err(invalidArgument([detail(`level_labels.${key}`, 'unknown_level')]));
    }
    const checked = checkTemplateText(`level_labels.${key}`, value, MAX_TEMPLATE_LABEL_LENGTH);
    if (!checked.ok) {
      return err(checked.error);
    }
    labels[level] = checked.value;
  }
  return ok(Object.freeze(labels));
}

/**
 * Validates a create request and fills the defaults.
 *
 * WHAT IT REFUSES, AND EVERY REFUSAL IS A SHAPE RULE RATHER THAN A BUSINESS RULE — which is what
 * keeps this file inside the boundary. It checks lengths, whitespace and the closed key set. **It
 * does not know what any of the values mean**, and there is no branch anywhere in it that depends
 * on what a name says.
 */
export function parseTemplateCreate(input: {
  readonly name: unknown;
  readonly labels: Readonly<Record<string, unknown>>;
}): Result<{ readonly name: string; readonly labels: TemplateLabels }> {
  const name = checkTemplateText('name', input.name, MAX_TEMPLATE_NAME_LENGTH);
  if (!name.ok) {
    return err(name.error);
  }
  const labels = readLevelLabels(input.labels, DEFAULT_LABELS);
  if (!labels.ok) {
    return err(labels.error);
  }
  return ok({ name: name.value, labels: labels.value });
}

/**
 * What an accepted update asks for. `template-lifecycle-v1` -> `platform.templates.update`.
 *
 * *** BOTH FIELDS ARE RESOLVED, NOT SUBMITTED. *** `name` is the name the Template will have —
 * the caller's if one was sent, the stored one otherwise — and `labels` is the complete merged set.
 * **Neither is a patch**, for the reason `updateOrganizationIdentity` takes a whole identity block:
 * *a method that cannot express a partial value cannot write one.*
 *
 * *** `name` WAS `string | null` UNTIL 2026-09-11, MEANING "was one sent". THAT MERGE MOVED IN HERE
 * WITH THE NO-OP CHECK, AND HAD TO. *** A value comparison cannot be performed on a half-merged
 * update: the question *"did anything change"* is about the RESOLVED values, so the function that
 * answers it is the function that must resolve them. **Leaving the merge in the handler would have
 * left the two halves of one rule in two places.**
 *
 * *** THIS TYPE IS PROOF THAT SOMETHING CHANGED, NOT MERELY THAT SOMETHING WAS SENT. ***
 * `parseTemplateUpdate` is its only producer and refuses to mint one for a request that changes
 * nothing — `architecture.md` §3a's receipt shape, applied to a validation rather than to a write.
 * **A second caller cannot forget the no-op rule, because it cannot obtain one of these without it.**
 */
export type TemplateUpdate = {
  readonly name: string;
  readonly labels: TemplateLabels;
};

/**
 * ===========================================================================================
 * VALIDATES AN EDIT. `template-lifecycle-v1` · `template-v1` TM-1.
 * ===========================================================================================
 *
 * *** THERE IS NO `status` PARAMETER AND ONE MUST NOT BE ADDED. *** `updateTemplateInput` carries
 * exactly `name` and `level_labels` under `additionalProperties: false`, and the contract's reason
 * is a permission boundary rather than a shape preference: *"a `status` in a PATCH body would make
 * `core.template.update` able to perform `core.template.retire`'s act, which is the permission
 * split undone by a field."* Retire and restore are routes. The transition is the route.
 *
 * ===========================================================================================
 * *** A NO-OP IS `invalid_argument`, AND THE CHECK IS ON VALUES RATHER THAN ON PRESENCE.
 * SR-23, corrected 2026-09-11. ***
 * ===========================================================================================
 *
 * **THIS FUNCTION TESTED THAT A FIELD WAS PRESENT WHILE BEING NAMED FOR A CHECK ON WHETHER
 * ANYTHING CHANGED.** It refused `{}` and accepted `{"name": "<the name it already has>"}`.
 *
 * *** THE NAME WAS NOT OVERREACHING THE CHECK — IT WAS FAITHFUL TO THE CONTRACT AND UNFAITHFUL TO
 * THE CODE, WHICH IS WHY IT READ AS SETTLED. *** `updateTemplateInput`'s own `$comment` states the
 * general rule and gives the reason:
 *
 *   *"An empty body is refused with `invalid_argument` rather than accepted as a no-op, BECAUSE A
 *   NO-OP ON THIS ROUTE STILL WRITES AN AUDIT RECORD — an audit trail containing 'the operator
 *   updated this Template' entries that changed nothing is a trail that costs a row-write to say
 *   nothing, and it makes a real change harder to find."*
 *
 * **The contract states the rule about NO-OPS; the code implemented one instance of it.** So this
 * is `workflow.md` §12 as well as `architecture.md` §3c — bringing code up to a rule someone
 * already decided, not deciding a new one.
 *
 * *** THE COMPARISON IS ON RAW VALUES AND NEVER ON THE COLLISION KEY. *** `School` → `SCHOOL` is a
 * real change to what every adopting tenant reads and produces an IDENTICAL
 * `normalizeTemplateName` output. **A comparison written against the normalised name would refuse a
 * legitimate case-only rename as a no-op** — the mirror of the trap the store's self-exclusion
 * avoids one layer down, and the reason that exclusion must not be touched either.
 *
 * ONE ANSWER FOR BOTH SHAPES, BECAUSE IT IS ONE RULE. `{}` and `{"name": "<unchanged>"}` differ in
 * how they arrive and not in what they ask for: both request an audit record for an edit that did
 * not happen. The schema's `anyOf` describes the first; the contract's reason covers both.
 *
 * `absent` AND `null` ARE STILL DIFFERENT REQUESTS. `{"name": null}` is `must_be_a_string`, because
 * `templateName` is a string and the class permits a null primitive through to here. Neither is
 * silently treated as the other, and neither is treated as a no-op.
 */
export function parseTemplateUpdate(
  input: {
    readonly name: unknown;
    /** `undefined` MEANS THE KEY WAS ABSENT FROM THE BODY. `{}` means it was sent and was empty. */
    readonly labels: Readonly<Record<string, unknown>> | undefined;
  },
  /**
   * *** THE WHOLE RECORD, NOT JUST THE LABELS — WIDENED FOR SR-23. ***
   *
   * It took `TemplateLabels` while the merge for `name` lived in `updateTemplate`, and **a value
   * comparison cannot be performed on a half-merged update**: *did anything change* is a question
   * about the RESOLVED values. Widening moves both halves of one rule into one function.
   *
   * **The alternative was comparing in the handler, which already holds both halves — and it was
   * refused on `architecture.md` §3a.** That placement makes the no-op rule something every future
   * caller must remember; this one makes it something no caller can obtain a `TemplateUpdate`
   * without. A guard that must be remembered is a discipline; one the type requires is a mechanism.
   */
  current: TemplateRecord,
): Result<TemplateUpdate> {
  if (input.name === undefined && input.labels === undefined) {
    // THE FIELD NAME IS EMPTY BECAUSE THE FAULT IS THE REQUEST RATHER THAN A FIELD. `detail('')` is
    // the same shape the class uses for `body_too_large` and `must_be_an_object`.
    return err(invalidArgument([detail('', 'must_change_something')]));
  }

  // ---- RESOLVE. An omitted name keeps the stored one; omitted labels keep their stored values.
  let name = current.name;
  if (input.name !== undefined) {
    const checked = checkTemplateText('name', input.name, MAX_TEMPLATE_NAME_LENGTH);
    if (!checked.ok) {
      return err(checked.error);
    }
    name = checked.value;
  }

  // THE BASE IS THE STORED LABELS. See `readLevelLabels` for why that parameter is the whole
  // difference between this route and create.
  const labels = readLevelLabels(input.labels ?? {}, current.labels);
  if (!labels.ok) {
    return err(labels.error);
  }

  // ---- AND THE NO-OP CHECK, ON THE RESOLVED RAW VALUES.
  //
  // IT RUNS AFTER VALIDATION, NOT BEFORE. A malformed name that happens to equal nothing should be
  // refused for BEING malformed — answering `must_change_something` to `{"name": 42}` would report
  // the wrong fault and tell an operator to change something they had not yet spelled correctly.
  const nameChanged = name !== current.name;
  const labelsChanged = TEMPLATE_LEVELS.some(
    (level) => labels.value[level] !== current.labels[level],
  );
  if (!nameChanged && !labelsChanged) {
    return err(invalidArgument([detail('', 'must_change_something')]));
  }

  return ok({ name, labels: labels.value });
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
