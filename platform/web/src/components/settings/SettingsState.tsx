/**
 * The six state families of the settings surface, drawn once so they read the
 * same everywhere.
 *
 * ===========================================================================
 * THEY ARE VISUALLY AND VERBALLY DISTINCT ON PURPOSE
 * ===========================================================================
 *
 * *"Still loading"*, *"Dudo answered and there is nothing here"*, *"this
 * failed"*, *"you may not see this"*, *"this was valid and its time has
 * passed"*, and *"there is no such thing"* are **six different facts**. A
 * surface that renders them alike teaches a reader to interpret a blank region
 * as *probably fine* — and the one defect this vocabulary exists to prevent is
 * the failed write that shows nothing, because **a missing state renders as
 * nothing, and nothing is also what a successful no-op looks like.**
 *
 * `NotBuiltYet` is a SEVENTH and deliberately does not reuse any of these:
 * *"not built"* is a statement about the software, not about the data.
 *
 * ===========================================================================
 * `expired` IS THE NEW ONE, AND THE REASON NOBODY HAD BUILT IT IS STRUCTURAL
 * ===========================================================================
 *
 * The other five all hang off something. Loading and empty are query states.
 * **`forbidden` is `403` and `not-found` is `404` — a component can be reached
 * by dispatching on an error code, so building the error path builds them.**
 *
 * **`expired` has no code of its own.** Core answers an expired invitation with
 * `failed_precondition`, or with a record whose status field says so — and
 * neither of those routes a reader to a distinct panel. So the family is only
 * ever rendered by a screen that already KNOWS the thing expired, and a
 * surface built error-code-first never grows one. That is why it is missing on
 * every surface in this repository rather than missing here.
 *
 * > **⚠ `expired` CONFIRMS THAT THE THING EXISTED. `not-found` MUST NOT.**
 *
 * That is a disclosure difference, not a wording choice, and it decides where
 * each may be used. Telling an arbitrary caller *"this invitation has expired"*
 * distinguishes a real identifier from a fabricated one, which is an oracle.
 * **Render `expired` only where the reader is already entitled to know the
 * thing exists** — their own Organization's invitation list, not a token typed
 * into an address bar. `platform/admin`'s not-found carries the mirror of this
 * argument for the platform routes, where plain enumeration is licensed
 * BECAUSE the caller can already enumerate.
 *
 * ===========================================================================
 * WHY THE FAILURE WORDING IS NOT `api/errors.ts`'s
 * ===========================================================================
 *
 * The CLASSIFICATION is shared and stays there — `ErrorCode`, `ApiError`,
 * `isRetryable` are one implementation and are surface-independent. **The
 * WORDING is not shareable, and discovering why is worth recording:**
 * `api/errors.ts`'s map says `not_found` is *"This customer is not here"* and
 * `failed_precondition` is *"an archived customer cannot be edited"*. **Both
 * are false on a settings page.** The map was written for the Customer
 * Directory, is correct there, and had silently become the application's only
 * error vocabulary.
 *
 * So this module holds a second map. **It is specialisation, not duplication:**
 * one map serving both surfaces would have to be vague enough to be true of
 * neither, and a vague error message is the one nobody can act on.
 */

import type { ReactNode } from 'react';
import { Button, Panel, StateBlock } from '@dudo/ui';
import { isRetryable, type ApiError, type ErrorCode } from '@/api/errors';
import { fill, formatSeconds, useLocale, type MessageKey } from '@/lib/i18n';

/**
 * Every code gets a title. **TOTAL, and that is the mechanism** — `Record` over
 * the full `ErrorCode` union means a code added to `api/errors.ts` does not
 * compile until it is worded here. `architecture.md` §3a-i: the default catches
 * the new value rather than absorbing it.
 *
 * `forbidden` and `not_found` are present even though `SettingsFailure`
 * dispatches them to their own families before this map is consulted. **Leaving
 * holes for them would make the map partial and lose the compile-time
 * totality**, which is the only thing standing between a new code and an
 * untitled panel.
 */
const TITLE_KEYS: Record<ErrorCode, MessageKey> = {
  invalid_argument: 'settingsError.invalidArgument.title',
  unauthenticated: 'settingsError.unauthenticated.title',
  /*
   * ⚠ THIS MAP HAD THE SAME HOLE AND FOR THE SAME REASON. It was total over
   * `api/errors.ts`'s ELEVEN-value local `ErrorCode`; adopting the contract's
   * twelve named `not_implemented` here too. **The totality was real and its
   * SUBJECT was wrong** — `Record<K, V>` proves you covered `K`, not that `K`
   * is the right set.
   */
  not_implemented: 'settingsError.notImplemented.title',
  forbidden: 'state.forbidden.title',
  not_found: 'state.notFound.title',
  conflict: 'settingsError.conflict.title',
  failed_precondition: 'settingsError.failedPrecondition.title',
  quota_exceeded: 'settingsError.quotaExceeded.title',
  rate_limited: 'settingsError.rateLimited.title',
  internal: 'settingsError.internal.title',
  unavailable: 'settingsError.unavailable.title',
  timeout: 'settingsError.timeout.title',
};

/**
 * Bodies. **PARTIAL ON PURPOSE, and the absences are the design.**
 *
 * `invalid_argument`, `conflict`, `failed_precondition` and `quota_exceeded`
 * have no body written here because **Core knows which field, which conflict,
 * which precondition and which limit, and this client does not.** Core's own
 * message is more useful than any generic sentence, so it is rendered instead —
 * untranslated, because it arrived in whatever language Core speaks and
 * inventing a translation for it would be inventing content.
 *
 * A missing key here therefore means *defer to the server*, and it is a real
 * answer rather than a gap.
 */
const BODY_KEYS: Partial<Record<ErrorCode, MessageKey>> = {
  unauthenticated: 'settingsError.unauthenticated.body',
  rate_limited: 'settingsError.rateLimited.body',
  internal: 'settingsError.internal.body',
  unavailable: 'settingsError.unavailable.body',
  timeout: 'settingsError.timeout.body',
};

/** The correlation identifier, isolated so an RTL paragraph cannot reorder it. */
function Reference({ requestId }: { requestId: string | null }) {
  const { t } = useLocale();
  if (requestId === null) return null;
  return (
    <p className="mt-3 text-xs text-ink-faint">
      {t('state.reference')}{' '}
      {/*
        `<bdi>` IS NOT DECORATION HERE. A request id is Latin text inside an
        Arabic paragraph; without isolation the surrounding punctuation and the
        id's own leading characters are resolved against the paragraph's
        direction, and the identifier a person is about to read out to support
        renders with its parts in the wrong order.

        ⚠ AND `<bdi>` ALONE IS NOT ENOUGH ONCE IT WRAPS. Measured on the
        contract path in `NotBuiltYet.tsx` at 834px in Arabic: a wrapped LTR
        run inside an RTL block shares a RIGHT edge, so line two starts 300px
        in and the value reads as two disconnected fragments. `unicode-bidi:
        isolate` fixes the ORDER of the run; ALIGNMENT belongs to the block
        container.

        A request id is short and has not been seen to wrap — **which is
        exactly why it gets the fix now rather than when somebody reports it.**
        The defect is a property of the construct, not of the length that
        happened to be measured, and `dir="ltr"` on a block element costs
        nothing when the value fits on one line.

        No physical utility: under `dir="ltr"`, `text-start` IS left, which is
        what keeps `verify-css.mjs` green.
      */}
      <bdi
        dir="ltr"
        className="mt-1 block text-start font-mono [overflow-wrap:anywhere]"
      >
        {requestId}
      </bdi>
    </p>
  );
}

/* -------------------------------------------------------------------------
   1 · Loading
   ------------------------------------------------------------------------- */

/**
 * `role="status"` rather than a bare panel: a screen reader is told the region
 * is busy without the focus being moved to it.
 */
export function SettingsLoading({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <Panel>
      <div role="status" className="grid justify-items-center gap-3 px-6 py-12 text-center">
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-navy-600 border-e-transparent"
        />
        <p className="text-lg font-semibold text-ink">{label ?? t('state.loading.title')}</p>
        <p className="text-ink-muted">{t('state.loading.body')}</p>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------
   2 · Empty
   ------------------------------------------------------------------------- */

/**
 * Dudo answered, and there is nothing here.
 *
 * **IT SAYS THAT DUDO ANSWERED.** *"No members yet"* and *"we could not ask"*
 * look identical as a blank region, and only one of them means the list is
 * genuinely empty.
 */
export function SettingsEmpty({
  title,
  body,
  actions,
}: {
  title?: string;
  body?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <Panel>
      <StateBlock
        glyph="·"
        title={title ?? t('state.empty.title')}
        body={body ?? t('state.empty.body')}
        actions={actions}
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------
   3 · Forbidden
   ------------------------------------------------------------------------- */

/**
 * `403`. **A DIFFERENT STATE FROM AN ERROR AND FROM AN EMPTY LIST.**
 *
 * **NOT AN EMPTY STATE.** A blank list for a permission failure tells a reader
 * their Organization holds nothing, which is a false statement about their own
 * data.
 *
 * **NO RETRY, EVER.** `isRetryable` already refuses `forbidden`, and there is
 * no control here either: retrying spends a call to receive the same settled
 * answer.
 *
 * **NOT A SECURITY CONTROL.** `security.md` §2 — hiding a control is
 * presentation. Core refuses regardless, every screen using this panel still
 * issues the call, and this panel is what it does with the refusal.
 */
export function SettingsForbidden({ error }: { error: ApiError }) {
  const { t } = useLocale();
  return (
    <div role="alert" className="rounded-xl border border-gold-500 bg-gold-50 p-5 sm:p-6">
      <h2 className="text-base font-bold text-ink">{t('state.forbidden.title')}</h2>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">{t('state.forbidden.body')}</p>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">
        {t('state.forbidden.whatToDo')}
      </p>
      <Reference requestId={error.request_id} />
    </div>
  );
}

/* -------------------------------------------------------------------------
   4 · Expired
   ------------------------------------------------------------------------- */

/**
 * Something that was valid and no longer is.
 *
 * **Read the header before using this.** It confirms the thing existed, so it
 * belongs only where the reader is already entitled to know that.
 *
 * `actions` is where a screen puts *"Send a new invitation"* — the panel itself
 * offers no action, because what replaces an expired thing differs per thing
 * and a generic *"Try again"* is exactly wrong: retrying cannot un-expire
 * anything.
 */
export function SettingsExpired({
  title,
  body,
  actions,
}: {
  title?: string;
  body?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div role="status" className="rounded-xl border border-line-strong bg-sunk p-5 sm:p-6">
      <h2 className="text-base font-bold text-ink">{title ?? t('state.expired.title')}</h2>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">
        {body ?? t('state.expired.body')}
      </p>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">{t('state.expired.whatToDo')}</p>
      {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
   5 · Not found
   ------------------------------------------------------------------------- */

/**
 * `404`, or an address that matches no section.
 *
 * **IT SAYS NOTHING ABOUT WHETHER THE THING EVER EXISTED**, and that is the
 * whole difference from `SettingsExpired`. *"It may have been moved, or the
 * address may be wrong"* is true whether the identifier is stale, mistyped, or
 * was never real — which is what stops this panel answering a question the
 * reader has no right to ask.
 */
/*
 * ⚠ `h1`, AND IT IS THE ONE STATE IN THIS FILE THAT TAKES ONE.
 *
 * The four families above render `h2` because they appear INSIDE a section that
 * has already rendered its own `h1`. **This one replaces the section entirely**
 * — it is the settings route's `notFoundComponent`, so no section screen runs.
 *
 * **The settings shell does NOT supply a heading; the SECTION does.** Measured
 * rather than assumed, which is the only reason this is right:
 *
 *     /settings                     H1: Organization settings   <- the overview screen
 *     /settings/members             H1: Members                 <- the section screen
 *     /settings/no-such-section     H2: This is not here        <- and NO h1 at all
 *
 * So `h2` here left the document with a level-2 heading and no level 1 —
 * the same skipped level as the top-level 404, arriving one layer in.
 */
export function SettingsNotFound({ actions }: { actions?: ReactNode }) {
  const { t } = useLocale();
  return (
    <Panel>
      <StateBlock
        glyph="?"
        headingLevel="h1"
        title={t('state.notFound.title')}
        body={t('state.notFound.body')}
        actions={actions}
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------
   6 · Failure — and the dispatcher that makes the other families unforgettable
   ------------------------------------------------------------------------- */

/**
 * An `ApiError`, rendered as whichever family it actually is.
 *
 * ===========================================================================
 * A DISPATCHER RATHER THAN A CONVENTION — `architecture.md` §3a
 * ===========================================================================
 *
 * `forbidden` and `not_found` have their own panels for reasons this file
 * spends paragraphs on, **and a screen that renders every failure through a
 * generic error block silently loses both.** That is a discipline, and a
 * discipline is what §3a says to replace with a mechanism.
 *
 * So this is the single entry point for a failure on this surface. **A screen
 * calls `SettingsFailure` and cannot forget the distinction**, because the
 * dispatch happens here rather than in each screen's `if`.
 *
 * The retry is offered only when `isRetryable` allows it, so nothing invites a
 * reader to hammer a door that is closed on purpose.
 */
export function SettingsFailure({
  error,
  onRetry,
  notFoundActions,
}: {
  error: ApiError;
  onRetry?: () => void;
  notFoundActions?: ReactNode;
}) {
  const { locale, t } = useLocale();

  if (error.code === 'forbidden') return <SettingsForbidden error={error} />;
  if (error.code === 'not_found') return <SettingsNotFound actions={notFoundActions} />;

  const bodyKey = BODY_KEYS[error.code];
  /*
   * `undefined` MEANS "SHOW CORE'S OWN MESSAGE" — see `BODY_KEYS`. It is a real
   * answer, not a gap, and it is why this is not a lookup with a fallback
   * string: a generic sentence here would REPLACE something more specific.
   */
  const body =
    bodyKey === undefined
      ? error.message
      : fill(t(bodyKey), locale, {
          /*
           * `formatSeconds` RATHER THAN A NUMERAL. *"Wait about 25 seconds"*
           * needs Arabic's singular, dual and two plural forms, and `Intl` has
           * them for `second` — the one unit this application gets free.
           */
          seconds:
            error.retry_after_seconds === null
              ? ''
              : formatSeconds(locale, error.retry_after_seconds),
        });

  return (
    <div role="alert" className="rounded-xl border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6">
      <h2 className="text-base font-bold text-scarlet-700">{t(TITLE_KEYS[error.code])}</h2>
      <p className="mt-2 max-w-prose leading-relaxed text-ink-soft">{body}</p>
      <Reference requestId={error.request_id} />
      {onRetry && isRetryable(error) ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {t('state.retry')}
        </Button>
      ) : null}
    </div>
  );
}
