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
 * The local pre-check. Returns a sentence, or `null` when the window is usable.
 *
 * The sentences mirror the three server tokens deliberately, so an operator who
 * hits the local check and one who hits the server's sees the same explanation
 * of the same rule.
 */
export function windowRefusal(draft: WindowDraft, required: boolean): string | null {
  const hasSince = draft.since !== '';
  const hasUntil = draft.until !== '';

  if (!required) {
    // An unfiltered query needs no window — but half a one is still malformed,
    // and sending it would earn a refusal for a question the operator could
    // have been told about here.
    if (hasSince !== hasUntil) {
      return 'Give both dates or neither. A single date is not a window, and Dudo refuses it rather than guessing at the other end.';
    }
    return null;
  }

  if (!hasSince || !hasUntil) {
    return `Filtering by operator or action needs a date range — both ends, at most ${String(MAX_WINDOW_DAYS)} days apart. Dudo refuses an open-ended filtered search rather than quietly narrowing it, because a narrowed answer looks exactly like an empty one.`;
  }

  const span = spanInDays(draft);
  if (span === null) {
    return 'One of those dates is not a real date.';
  }
  if (span <= 0) {
    return 'The end of the range is before its start.';
  }
  if (span > MAX_WINDOW_DAYS) {
    return `That range is ${String(span)} days. The most that can be searched at once is ${String(MAX_WINDOW_DAYS)} — search a month at a time and walk backwards.`;
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
 */
export function describeWindow(draft: WindowDraft): string {
  if (draft.since === '' || draft.until === '') return '';
  const format = (calendarDate: string): string => {
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return calendarDate;
    return parsed.toLocaleDateString(undefined, {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  return draft.since === draft.until
    ? `${format(draft.since)} (UTC)`
    : `${format(draft.since)} to ${format(draft.until)} (UTC)`;
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
  readonly title: string;
  readonly body: string;
} {
  switch (token) {
    case 'time_window_required':
      return {
        title: 'This search needs a date range',
        body:
          'Filtering by operator or action requires both a start and an end date, at most ' +
          `${String(MAX_WINDOW_DAYS)} days apart. Dudo refuses an open-ended filtered search ` +
          'rather than narrowing it silently — a quietly narrowed answer is indistinguishable ' +
          'from an empty one, and on an audit trail that is the difference between "nothing ' +
          'happened" and "we did not look".',
      };
    case 'time_window_too_wide':
      return {
        title: `That range is longer than ${String(MAX_WINDOW_DAYS)} days`,
        body:
          `The most that can be searched at once is ${String(MAX_WINDOW_DAYS)} days. Search a ` +
          'month at a time and walk backwards — the controls below move the range by a month ' +
          'without retyping it. Nothing was searched.',
      };
    case 'time_window_inverted':
      return {
        title: 'The end of that range is before its start',
        body: 'Swap the two dates. Nothing was searched.',
      };
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
