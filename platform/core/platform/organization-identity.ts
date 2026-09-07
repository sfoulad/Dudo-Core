/**
 * ===========================================================================================
 * AN ORGANIZATION'S NAME AND ITS TWO GOVERNMENT-ISSUED REGISTRATIONS.
 * ===========================================================================================
 *
 * Contract: `organization-identity-v1`. Storage: `control-plane/0015_organization_identity.sql`.
 *
 * *** THIS FILE HOLDS THE SHAPE AND THE TRANSITION RULE. IT HOLDS NO ROUTE, NO STORE AND NO
 * AUTHORIZATION. *** It cannot read a database and cannot reach a tenant. `applyRegistration` is a
 * pure function of (what is stored, what was submitted, the clock, the acting operator), which is
 * what lets the trap below be tested without a fixture.
 *
 * ===========================================================================================
 * THE THREE STATES, AND WHY THE THIRD IS NOT OPTIONAL
 * ===========================================================================================
 *
 *   `not-recorded`   NOBODY HAS ASKED, or nobody has entered the answer. The default for every
 *                    Organization, and the only state the ones that predate this file can be in.
 *   `not-registered` THE CUSTOMER STATED THEY HAVE NONE. A legitimate, permanent, POSITIVE fact —
 *                    Bahrain VAT registration is mandatory above an annual-supplies threshold and
 *                    voluntary below it, so this is an answer rather than a gap.
 *   `registered`     A number is recorded, verified or not.
 *
 * **COLLAPSING THE FIRST TWO INTO A NULLABLE NUMBER DESTROYS THE DIFFERENCE BETWEEN "THEY TOLD US
 * THEY ARE NOT REGISTERED" AND "WE NEVER ASKED."** Merged, you cannot decide whether to prompt, you
 * cannot report coverage, and you cannot defend the record afterwards: *"why is there no VAT number
 * here"* has two answers and the record kept neither. A design that treats `not-registered` as
 * missing data keeps prompting a customer who has already answered.
 *
 * IT IS A DISCRIMINATED UNION RATHER THAN A STATE FIELD BESIDE A NULLABLE NUMBER, so that
 * `{ state: 'not-registered', number: '123' }` CANNOT BE CONSTRUCTED. That is
 * `PlatformActionTarget`'s device and its reasoning transfers unchanged: *"a target kind that
 * disagreed with its identifier would be a log line nobody could interpret afterwards ... it is
 * read once, years later, by someone who cannot ask."* A tax identifier is read exactly that way.
 *
 * ===========================================================================================
 * *** THE TRAP THE WHOLE DESIGN TURNS ON: A VERIFICATION ATTESTS TO A SPECIFIC NUMBER. ***
 * ===========================================================================================
 *
 * Carrying a verification across an edited number would say **an operator checked a value nobody
 * ever checked**, with a real name and a real date attached. That is worse than an unverified
 * number, because it defends itself — and `audit-read-v1` shows the customer that the field was
 * edited without showing them what it now claims.
 *
 * `applyRegistration` discards the verification on any change to `number`. There is no flag, no
 * option and no caller-supplied path that preserves one.
 *
 * ===========================================================================================
 * NO PATTERN, NO DIGIT COUNT, AND THE ABSENCE IS THE RULING
 * ===========================================================================================
 *
 * Bahrain VAT account numbers are widely reported as fifteen numeric digits. **THAT FIGURE IS NOT
 * IN THIS FILE.** It comes from secondary sources, one of which recorded that it was awaiting
 * clarification from the authority.
 *
 * *** A PATTERN IS A REFUSAL. *** An at-count pattern that is wrong REFUSES A LEGAL REGISTRATION,
 * and the failure lands on a customer who cannot be onboarded and an operator whose only remedy is
 * to enter something false. The asymmetry decides it: too narrow fails closed against a real
 * customer; too wide accepts a typo THAT THE VERIFICATION RECORD EXISTS TO CATCH.
 *
 * `checkRegistrationNumber` therefore constrains HYGIENE ONLY — 1–32 characters, alphanumerics
 * with interior spaces and hyphens, no leading or trailing separator, no control characters.
 * NARROWING IT IS BREAKING and needs a decision record citing the issuing authority's published
 * specification by document and date.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';

/** `organization-identity-v1.schema.json`'s bounds, enforced rather than assumed. */
export const MAX_DISPLAY_NAME_LENGTH = 200;
export const MAX_REGISTRATION_NUMBER_LENGTH = 32;

/**
 * Hygiene only. See the header for why there is no digit count here and why adding one is breaking.
 *
 * Alphanumerics, with interior spaces and hyphens, and no separator at either end. It accepts every
 * national registration format this author is aware of and refuses nothing plausible.
 */
const REGISTRATION_NUMBER = /^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$/u;

/**
 * WHO CHECKED THIS NUMBER AGAINST THE ISSUING REGISTRY, AND WHEN.
 *
 * *** BOTH FIELDS ARE SERVER-STAMPED AND NEITHER IS CALLER-SUPPLIED. *** The operator comes from
 * the authenticated platform context and the instant from Core's clock. **A caller-supplied
 * provenance value is not provenance** — it is the forgery-looking-like-compliance shape `0028`'s
 * amendment names for `target_organization_id`. The client asserts only that it checked; it never
 * says who or when.
 *
 * THERE IS NO `registry` FIELD AND NO NOTE FIELD, both deliberately. The registry is fixed by which
 * field this sits in — Sijilat for the commercial registration, the National Bureau for Revenue for
 * VAT — and a free-text note on a customer record is uncontrolled data with no schema, no retention
 * rule and no purge story. It is where an operator eventually writes something about a person.
 */
export type RegistrationVerification = {
  readonly verifiedByPrincipalId: string;
  /** RFC 3339 UTC with three fractional digits. Never earlier than the number's `recordedAt`. */
  readonly verifiedAt: string;
};

/**
 * ONE GOVERNMENT-ISSUED REGISTRATION, AS HELD.
 *
 * THE HYPHENATED STATE NAMES ARE THE DOMAIN VOCABULARY; the wire and the database use
 * `not_recorded` / `not_registered` / `registered`. The two are mapped at the edges by
 * `registrationStateColumn` and `registrationFromColumns` and nowhere else, so a divergence is one
 * function rather than a search.
 */
export type OrganizationRegistration =
  | { readonly state: 'not-recorded' }
  | {
      readonly state: 'not-registered';
      /**
       * SERVER-STAMPED when the operator recorded the declaration.
       *
       * It dates **Dudo's record of the statement**, not the customer's circumstances: a customer
       * who crosses the VAT threshold tomorrow does not falsify this field, they make it STALE, and
       * those are different. A client must not render it as "not registered since".
       */
      readonly declaredAt: string;
    }
  | {
      readonly state: 'registered';
      readonly number: string;
      /**
       * SERVER-STAMPED when THIS NUMBER was set, and re-stamped whenever the number changes,
       * because it dates the value rather than the field.
       *
       * The database compares `verifiedAt >= recordedAt`, which is the mechanical consequence of
       * the trap in the header. That comparison is lexicographic and therefore correct ONLY because
       * every timestamp is the same width — see `toRfc3339Utc`, and see why
       * `platform-audit-read-v1` narrowed the grammar to require three fractional digits.
       */
      readonly recordedAt: string;
      /** NULL means recorded but unverified, which a client must render distinctly. */
      readonly verification: RegistrationVerification | null;
    };

/** The three fields, as held. `displayName` is null only for Organizations that predate the route. */
export type OrganizationIdentity = {
  readonly displayName: string | null;
  readonly commercialRegistration: OrganizationRegistration;
  readonly vatRegistration: OrganizationRegistration;
};

/**
 * ONE REGISTRATION, AS SUBMITTED. The same three states and NONE of the server-stamped fields.
 *
 * `verified` IS REQUIRED ON THE `registered` BRANCH RATHER THAN DEFAULTING TO FALSE, so the
 * operator makes the claim or declines it explicitly and **no code path produces a verification by
 * omission.**
 *
 * IT IS A CLAIM CORE CANNOT CHECK. There is no Sijilat API and no NBR API, so nothing on the server
 * confirms that a check happened — the same class of limit `confirmation-v1` records for whether a
 * client displayed the statement it was given. WHAT MAKES IT WORTH HAVING is that the claim is
 * ATTRIBUTED AND DATED: an operator who ticks it without looking has put their own principal id
 * against a specific number on a specific day, in a record the customer's own trail shows was
 * edited.
 */
export type RegistrationInput =
  | { readonly state: 'not-recorded' }
  | { readonly state: 'not-registered' }
  | { readonly state: 'registered'; readonly number: string; readonly verified: boolean };

/**
 * A PARTIAL UPDATE. An absent field is UNCHANGED; a present field is REPLACED WHOLE.
 *
 * There is no merge INSIDE a registration, and that is what keeps a verification from surviving a
 * number it does not attest to. An empty update is refused by the caller, not here — a request that
 * changes nothing still spends five row-writes of the customer's own daily allocation.
 *
 * **`displayName` CANNOT BE SET TO NULL.** Renaming is permitted; un-naming is not, because null is
 * a legacy state rather than a choice and re-creating it would re-open a set that is closed and
 * shrinking.
 */
export type OrganizationIdentityUpdate = {
  readonly displayName?: string;
  readonly commercialRegistration?: RegistrationInput;
  readonly vatRegistration?: RegistrationInput;
};

// =============================================================================================
// Validation. Shape rules only — nothing here knows what any value MEANS.
// =============================================================================================

/**
 * `field` is the wire name, so the refusal names what the caller sent rather than what Core calls
 * it internally.
 */
export function checkDisplayName(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string') {
    return err(invalidArgument([detail(field, 'must_be_a_string')]));
  }
  if (value.length === 0 || value.length > MAX_DISPLAY_NAME_LENGTH) {
    return err(invalidArgument([detail(field, 'out_of_range')]));
  }
  if (value.trim() !== value) {
    // The schema's `^[^\s].*[^\s]$`, and it is `templateName`'s rule transcribed rather than
    // invented so the two human-entered names in the platform class agree. A name differing from
    // another only by a trailing space is two rows an operator cannot tell apart in a list.
    return err(invalidArgument([detail(field, 'must_not_be_padded')]));
  }
  return ok(value);
}

export function checkRegistrationNumber(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string') {
    return err(invalidArgument([detail(field, 'must_be_a_string')]));
  }
  if (value.length === 0 || value.length > MAX_REGISTRATION_NUMBER_LENGTH) {
    return err(invalidArgument([detail(field, 'out_of_range')]));
  }
  if (!REGISTRATION_NUMBER.test(value)) {
    return err(invalidArgument([detail(field, 'must_be_a_registration_number')]));
  }
  return ok(value);
}

// =============================================================================================
// *** THE TRANSITION. THE ONLY PLACE A STORED REGISTRATION IS PRODUCED. ***
// =============================================================================================

/**
 * What the record becomes, given what it was and what was submitted.
 *
 * ===========================================================================================
 * THREE RULES, AND THE SECOND IS THE ONE THAT MATTERS
 * ===========================================================================================
 *
 * 1. **`recordedAt` DATES THE VALUE, NOT THE FIELD.** Re-submitting the same number keeps its
 *    original `recordedAt`; a different number gets a new one. So the answer to *"how long has this
 *    number been on file"* stays true across an operator re-saving a form.
 *
 * 2. *** THE VERIFICATION IS NEVER CARRIED ACROSS A CHANGED NUMBER. *** It is not preserved,
 *    not re-stamped, not adjusted — the new record simply has whatever the operator claimed for the
 *    NEW number, which is `null` unless they said they checked it. **There is no branch here that
 *    can copy a verification from `existing` onto a different `number`.**
 *
 * 3. **`verified: false` CLEARS AN EXISTING VERIFICATION** even when the number is unchanged. An
 *    operator who unticks the box is making a statement, and a control that ignored it would leave
 *    a claim on the record its author has withdrawn.
 *
 * A CONSEQUENCE WORTH STATING BECAUSE IT LOOKS LIKE A BUG: re-submitting the SAME number with
 * `verified: true` re-stamps the verification to now and to the CURRENT operator, replacing an
 * older one. That is correct — the new operator is making the claim today — and it means a
 * verification's date is *the last time somebody checked*, never *the first*.
 */
export function applyRegistration(
  existing: OrganizationRegistration,
  input: RegistrationInput,
  context: { readonly nowIso: string; readonly actorPrincipalId: string },
): OrganizationRegistration {
  if (input.state === 'not-recorded') {
    // CLEARING DESTROYS THE PREVIOUS VALUE AND ITS PROVENANCE, and the audit trail records that a
    // change happened without recording what was lost (`OI-2`, `OI-5`). Permitted anyway, because
    // an operator must be able to undo a mistake and a record that cannot be corrected accumulates
    // wrong values. The loss is named rather than prevented.
    return { state: 'not-recorded' };
  }

  if (input.state === 'not-registered') {
    // RE-SENDING RE-STAMPS THE DATE, which is correct: it records that the customer said it again.
    return { state: 'not-registered', declaredAt: context.nowIso };
  }

  const numberIsUnchanged = existing.state === 'registered' && existing.number === input.number;

  return {
    state: 'registered',
    number: input.number,
    recordedAt:
      numberIsUnchanged && existing.state === 'registered' ? existing.recordedAt : context.nowIso,
    // NOTE WHAT IS ABSENT: no reference to `existing.verification` on any path. The trap in the
    // header is closed by there being nothing here to carry, rather than by a condition that
    // decides not to.
    verification: input.verified
      ? { verifiedByPrincipalId: context.actorPrincipalId, verifiedAt: context.nowIso }
      : null,
  };
}

// =============================================================================================
// The storage edge. SIX COLUMNS PER REGISTRATION, PRODUCED TOGETHER OR NOT AT ALL.
// =============================================================================================

/**
 * The six values a registration occupies, in the order `0015_organization_identity.sql` declares.
 *
 * *** WHY A SIX-TUPLE AND NOT SIX ARGUMENTS AT THE CALL SITE: because a caller cannot set one of
 * them. *** The incoherent rows the migration's triggers refuse — a number on a `not_registered`
 * row, a verification with no number, a verification older than the number it attests to — are all
 * rows somebody assembled a column at a time. Producing all six from one union value is the layer
 * that prevents them; the triggers are the backstop that catches a path which did not.
 *
 * **AND THE HONEST LIMIT: THIS IS NOT YET A MECHANISM, BECAUSE IT HAS NO CONSUMER.** The adapter
 * that must be its only caller is blocked behind the route's permission, so today nothing writes
 * these columns at all and nothing forces a future adapter through here. **When the adapter lands,
 * this returns a branded value the write requires** — `architecture.md` §3a — and until then this
 * paragraph is the only thing saying so. A receipt with no consumer is a control that is a comment,
 * which is why the brand is not written in advance of the thing it would guard.
 */
export type RegistrationColumns = readonly [
  state: 'not_recorded' | 'not_registered' | 'registered',
  registrationNumber: string | null,
  declaredAt: string | null,
  recordedAt: string | null,
  verifiedByPrincipalId: string | null,
  verifiedAt: string | null,
];

export function registrationColumns(
  registration: OrganizationRegistration,
): RegistrationColumns {
  switch (registration.state) {
    case 'not-recorded':
      return ['not_recorded', null, null, null, null, null];
    case 'not-registered':
      return ['not_registered', null, registration.declaredAt, null, null, null];
    case 'registered':
      return [
        'registered',
        registration.number,
        null,
        registration.recordedAt,
        registration.verification?.verifiedByPrincipalId ?? null,
        registration.verification?.verifiedAt ?? null,
      ];
  }
}

/**
 * The inverse, for a row read back.
 *
 * *** IT RETURNS `null` FOR A ROW THAT IS NOT ONE OF THE THREE STATES, AND THE CALLER MUST TREAT
 * THAT AS A FAILURE RATHER THAN AS AN EMPTY REGISTRATION. *** Defaulting an unreadable row to
 * `not-recorded` would render "we never asked" over a row that says something else — a confident
 * wrong answer about a legal identifier, which is the failure this whole shape exists to avoid.
 *
 * IT IS REACHABLE ONLY BY A ROW THE TRIGGERS DID NOT SEE: a restore, a partial migration, or a
 * write made before `0015` was applied. That is exactly the population `0024` says a trigger cannot
 * cover, so a reader is the last line rather than a redundant one.
 */
export function registrationFromColumns(
  columns: RegistrationColumns,
): OrganizationRegistration | null {
  const [state, registrationNumber, declaredAt, recordedAt, verifiedBy, verifiedAt] = columns;

  if (state === 'not_recorded') {
    return registrationNumber === null && declaredAt === null && recordedAt === null
      ? { state: 'not-recorded' }
      : null;
  }

  if (state === 'not_registered') {
    return declaredAt !== null && registrationNumber === null && recordedAt === null
      ? { state: 'not-registered', declaredAt }
      : null;
  }

  if (registrationNumber === null || recordedAt === null || declaredAt !== null) {
    return null;
  }
  if ((verifiedBy === null) !== (verifiedAt === null)) {
    // HALF A VERIFICATION IS NOT A VERIFICATION. Who-without-when, or when-without-who, is a row
    // nobody can interpret, and interpreting it charitably is how a wrong provenance gets rendered.
    return null;
  }
  if (verifiedAt !== null && verifiedAt < recordedAt) {
    // A VERIFICATION OLDER THAN THE NUMBER IT ATTESTS TO IS A CARRIED-OVER ONE. Same comparison the
    // triggers make, for rows that never passed a trigger. Lexicographic equals temporal only
    // because every timestamp is the same width.
    return null;
  }

  return {
    state: 'registered',
    number: registrationNumber,
    recordedAt,
    verification:
      verifiedBy === null || verifiedAt === null
        ? null
        : { verifiedByPrincipalId: verifiedBy, verifiedAt },
  };
}
