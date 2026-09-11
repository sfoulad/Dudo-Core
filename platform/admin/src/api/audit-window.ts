/**
 * The bounded time window that filtered audit queries require.
 *
 * ===========================================================================
 * WHY IT EXISTS, BECAUSE IT LOOKS LIKE A UI CONSTRAINT AND IS NOT
 * ===========================================================================
 *
 * Both feeds scanned the whole action log. At a 50,000-row log, **49 feed
 * requests exhaust D1's account-wide read allowance** — which stops every query
 * in the platform, including the session lookup every login performs. So this is
 * an availability control, and the thing it protects is not the audit surface.
 *
 * ===========================================================================
 * WHEN A WINDOW IS REQUIRED — READ FROM THE CONTRACT, NOT INFERRED
 * ===========================================================================
 *
 *   PLATFORM feed        required whenever `actor_principal_id` OR `action_id`
 *                        is present. Neither is served by an index prefix, so
 *                        each is tested row by row and a rare value costs a
 *                        full walk.
 *   ORGANIZATION feed    required whenever `action_id` is present.
 *                        `organization_id` is EXEMPT — it is a path parameter
 *                        served by an index, not a concession.
 *
 * THE UNFILTERED FEEDS NEED NO WINDOW AND MUST NOT GAIN ONE. They are already
 * bounded to a page by an index, so requiring one would remove no reads and
 * would remove "what happened, ever". **The wide question stays wide.**
 *
 * BOTH BOUNDS OR NEITHER. Half a window is an unbounded walk in one direction,
 * which is the thing being fixed.
 *
 * ===========================================================================
 * THE CLIENT REFUSES LOCALLY *AS WELL*, AND THAT IS NOT DUPLICATED VALIDATION
 * ===========================================================================
 *
 * Core refuses, and its refusal is the one that counts. This checks first
 * because a request that will certainly be refused still costs **2
 * control-plane row-writes** against a 600/day per-operator ceiling, and an
 * audit record for a question that was never asked.
 *
 * IT CANNOT HIDE ANYTHING. Every condition here is about the SHAPE of the
 * request — which filters are set, and what two dates the operator typed — and
 * the operator holds all of it. None of it is a fact about data. That is the
 * same line the member-lookup identifier check sits on.
 *
 * AND THE SERVER'S THREE TOKENS ARE STILL HANDLED SEPARATELY, because this
 * local mirror can drift from the contract and the server's answer is
 * authoritative.
 */

import { toUtcDayStart, toUtcExclusiveDayEnd } from './platform';
import type { ApiError } from './errors';

/** The contract's maximum span. Nameable on screen — see `theERRORNAMESTHELIMIT`. */
export const MAX_WINDOW_DAYS = 31;

const MS_PER_DAY = 86_400_000;

/**
 * The three detail tokens, which mean three different things to an operator.
 *
 * THEY MUST NOT COLLAPSE INTO "invalid request". Someone who omitted a window
 * and someone who asked for two years need different sentences — the first has
 * to add dates, the second has to narrow them, and one message cannot tell them
 * which.
 */
export type WindowRefusalToken =
  | 'time_window_required'
  | 'time_window_too_wide'
  | 'time_window_inverted';

const TOKENS: readonly string[] = [
  'time_window_required',
  'time_window_too_wide',
  'time_window_inverted',
];

/** The window an operator typed, as calendar dates. */
export interface WindowDraft {
  readonly since: string;
  readonly until: string;
}

/**
 * Whether these filters oblige a window.
 *
 * TAKES THE FILTER NAMES RATHER THAN A FEED NAME, so the two callers state their
 * own condition and neither inherits the other's. The platform feed's extra
 * filter is exactly why they differ.
 */
export function windowIsRequired(filters: {
  readonly actorPrincipalId?: string;
  readonly actionId?: string;
}): boolean {
  return (
    (filters.actorPrincipalId !== undefined && filters.actorPrincipalId !== '') ||
    (filters.actionId !== undefined && filters.actionId !== '')
  );
}

/**
 * What the local pre-check found wrong, as a value rather than as a sentence.
 *
 * ===========================================================================
 * ⚠ THIS RETURNED ENGLISH PROSE UNTIL 2026-09-11, AND NOTHING WAS COUNTING IT
 * ===========================================================================
 *
 * Five operator-facing sentences lived in this module. **The console's copy
 * coverage metric scans `.tsx` files**, so none of them was ever in the
 * population — the pin said 89 prose nodes remained while about forty more sat
 * in `src/api/**` where no instrument looked. `§11a`: *a floor proves the check
 * found SOMETHING, not EVERYTHING*, and the half it was handed looked exactly
 * like the whole.
 *
 * **The repair is not to translate this module.** A module that reaches for a
 * dictionary is a module that needs a locale, and this one is called from a
 * form submit handler where there is no component. **It returns a TOKEN and the
 * component renders it** — which is what `describeWindowRefusal` already did
 * for the SERVER's three tokens, so the local half now matches the remote half
 * instead of diverging from it.
 *
 * `span` rides along on `too_wide` because the sentence names it. It is the
 * measured span, not the limit.
 */
export type LocalWindowRefusal =
  | { readonly kind: 'both_or_neither' }
  | { readonly kind: 'required' }
  | { readonly kind: 'not_a_date' }
  | { readonly kind: 'inverted' }
  | { readonly kind: 'too_wide'; readonly span: number };

/**
 * The local pre-check. Returns a refusal, or `null` when the window is usable.
 *
 * The refusals mirror the three server tokens deliberately, so an operator who
 * hits the local check and one who hits the server's sees the same explanation
 * of the same rule.
 */
export function windowRefusal(
  draft: WindowDraft,
  required: boolean,
): LocalWindowRefusal | null {
  const hasSince = draft.since !== '';
  const hasUntil = draft.until !== '';

  if (!required) {
    // An unfiltered query needs no window — but half a one is still malformed,
    // and sending it would earn a refusal for a question the operator could
    // have been told about here.
    if (hasSince !== hasUntil) {
      return { kind: 'both_or_neither' };
    }
    return null;
  }

  if (!hasSince || !hasUntil) {
    return { kind: 'required' };
  }

  const span = spanInDays(draft);
  if (span === null) {
    return { kind: 'not_a_date' };
  }
  if (span <= 0) {
    return { kind: 'inverted' };
  }
  if (span > MAX_WINDOW_DAYS) {
    return { kind: 'too_wide', span };
  }
  return null;
}

/** Whole days covered, or `null` if either date is unusable. */
export function spanInDays(draft: WindowDraft): number | null {
  const since = toUtcDayStart(draft.since);
  const until = toUtcExclusiveDayEnd(draft.until);
  if (since === null || until === null) return null;
  return (new Date(until).getTime() - new Date(since).getTime()) / MS_PER_DAY;
}

/**
 * The window as a person reads it, from the CALENDAR DATES they typed.
 *
 * NOT REVERSE-ENGINEERED FROM THE ISO BOUNDS. `until` on the wire is the
 * EXCLUSIVE next-day midnight, so deriving a display date from it means
 * subtracting a day — an off-by-one waiting to happen in the one sentence that
 * has to be exactly right. The dates the operator typed are already correct.
 *
 * ===========================================================================
 * ⚠ THE LOCALE WAS `undefined`, WHICH IS THE BROWSER'S AND NOT THE CONSOLE'S
 * ===========================================================================
 *
 * `toLocaleDateString(undefined, …)` reads the BROWSER's language. An operator
 * who switched this console to Arabic would have got Arabic everywhere except
 * these two dates, which would have stayed in whatever their browser was set
 * to — **and the window is the one sentence on the empty state that has to be
 * exactly right**, because misreading it turns "we did not look here" into
 * "nothing happened".
 *
 * **It was never wrong in testing**, because the browser and the console agreed
 * by default. It only diverges for the operator who deliberately switched — the
 * one this whole pass exists for.
 *
 * `joiner` is passed in rather than looked up, for the same reason the refusals
 * became tokens: this module has no locale of its own and must not acquire one.
 * "to" is a translated word, not punctuation.
 *
 * **`(UTC)` is NOT translated and that is deliberate.** It is the name of the
 * timezone, it is what the field labels say, and an operator comparing this
 * sentence to an ISO timestamp in the feed needs the same three letters in both
 * places.
 */
export function describeWindow(draft: WindowDraft, locale: string, joiner: string): string {
  if (draft.since === '' || draft.until === '') return '';
  const format = (calendarDate: string): string => {
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return calendarDate;
    return parsed.toLocaleDateString(locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  return draft.since === draft.until
    ? `${format(draft.since)} (UTC)`
    : `${format(draft.since)} ${joiner} ${format(draft.until)} (UTC)`;
}

/** The server's token, when it sent one. */
export function windowRefusalToken(error: ApiError): WindowRefusalToken | null {
  for (const detail of error.details) {
    if (TOKENS.includes(detail.issue)) return detail.issue as WindowRefusalToken;
  }
  return null;
}

/**
 * What each server token means, in words an operator can act on.
 *
 * THE 31-DAY LIMIT IS NAMED, and the contract says why that is safe where the
 * cursor rejections collapse into one indistinguishable answer: **a span limit
 * is a constant, not a fact about data.** Disclosing it teaches a caller nothing
 * about any record, operator or Organization.
 */
export function describeWindowRefusal(token: WindowRefusalToken): {
  readonly titleKey: WindowMessageKey;
  readonly bodyKey: WindowMessageKey;
} {
  switch (token) {
    case 'time_window_required':
      return { titleKey: 'window.required.title', bodyKey: 'window.required.body' };
    case 'time_window_too_wide':
      return { titleKey: 'window.tooWide.title', bodyKey: 'window.tooWide.body' };
    case 'time_window_inverted':
      return { titleKey: 'window.inverted.title', bodyKey: 'window.inverted.body' };
  }
}

/**
 * The message keys this module names.
 *
 * ===========================================================================
 * DECLARED HERE AS A STRING UNION, NOT IMPORTED AS `MessageKey`
 * ===========================================================================
 *
 * **`api/**` must not import from `lib/i18n`.** This module is imported by
 * `platform.ts`'s consumers and by a form handler; pulling a React context
 * module into the transport layer to borrow a type would put a provider
 * dependency where there is deliberately none.
 *
 * **The union is narrow on purpose and it is CHECKED rather than trusted.**
 * `lib/i18n.tsx` asserts `WindowMessageKey extends MessageKey` at compile time,
 * so a key named here that the dictionary does not carry **does not compile** —
 * the obligation is a mechanism rather than something to remember
 * (`architecture.md` §3a). Without that line this would be a second copy of a
 * fact in a file that cannot see the first, which is the defect this repository
 * records under three different names.
 */
export type WindowMessageKey =
  | 'window.required.title'
  | 'window.required.body'
  | 'window.tooWide.title'
  | 'window.tooWide.body'
  | 'window.inverted.title'
  | 'window.inverted.body'
  | 'window.local.bothOrNeither'
  | 'window.local.required'
  | 'window.local.notADate'
  | 'window.local.inverted'
  | 'window.local.tooWide';

/** The key that renders a local refusal. `too_wide` also needs its `span`. */
export function localRefusalKey(refusal: LocalWindowRefusal): WindowMessageKey {
  switch (refusal.kind) {
    case 'both_or_neither':
      return 'window.local.bothOrNeither';
    case 'required':
      return 'window.local.required';
    case 'not_a_date':
      return 'window.local.notADate';
    case 'inverted':
      return 'window.local.inverted';
    case 'too_wide':
      return 'window.local.tooWide';
  }
}

/**
 * Moves the window backwards or forwards by ITS OWN LENGTH.
 *
 * ===========================================================================
 * BY THE WINDOW'S LENGTH, NOT BY A CALENDAR MONTH — AND THE DIFFERENCE IS A BUG
 * ===========================================================================
 *
 * THIS SHIFTED BY WHOLE MONTHS AND PRODUCED INVALID WINDOWS. `1 Sep – 1 Oct` is
 * 31 days and legal; shifted back one calendar month it becomes
 * `1 Aug – 1 Sep`, which is **32 days** because August is longer — over the
 * limit, refused by Core, and reached by an operator pressing a button this
 * console offered them. Months are not a fixed length, so a month-shift cannot
 * preserve a span that is bounded in days.
 *
 * IT ALSO OVERLAPPED. `1 Sep – 1 Oct` and `1 Aug – 1 Sep` both contain 1
 * September, so a record on that day appeared in two consecutive pages of an
 * investigation and a reader would double-count it.
 *
 * SHIFTING BY THE SPAN FIXES BOTH: the length is preserved exactly, so a window
 * that was legal stays legal; and consecutive windows TILE the timeline with no
 * gap and no overlap, which is what walking an investigation backwards actually
 * requires. A gap would be worse than an overlap — it would hide records while
 * looking exhaustive.
 *
 * IT DOES NOT FETCH. It only rewrites the two date fields; the operator still
 * presses the button. A twelve-month investigation is twelve requests at 2
 * control-plane row-writes each, and **nothing here may spend one the operator
 * did not ask for** — no prefetch of the adjacent window, no speculative load.
 *
 * UTC throughout, so a shift cannot cross a day boundary differently for two
 * operators in different zones.
 */
export function shiftWindowByOwnLength(draft: WindowDraft, direction: -1 | 1): WindowDraft {
  const span = spanInDays(draft);
  if (span === null || span <= 0) return draft;

  const shift = (calendarDate: string): string => {
    const midnight = toUtcDayStart(calendarDate);
    if (midnight === null) return calendarDate;
    const moved = new Date(new Date(midnight).getTime() + direction * span * MS_PER_DAY);
    return moved.toISOString().slice(0, 10);
  };

  return { since: shift(draft.since), until: shift(draft.until) };
}
