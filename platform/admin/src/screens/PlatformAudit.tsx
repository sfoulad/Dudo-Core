/**
 * The platform feed — every operator action, across all Organizations.
 *
 * ===========================================================================
 * THIS IS THE OVERSIGHT VIEW, AND IT NAMES NO PRINCIPAL TARGET
 * ===========================================================================
 *
 * Who acted, how often, against how many Organizations, when, and with what
 * outcome. It does NOT say which person an action was about.
 *
 * `PlatformFeedRecord` has no `target_principal_id` property, so this screen has
 * nothing to render even if someone tried. That is deliberate and it is the
 * whole security property of `platform-audit-read-v1`: every resolve record is
 * "principal P was resolved in Organization O" — a membership fact — and a bulk
 * read would collect every one of them in a single request the affected tenants
 * cannot see, aggregating into the CO1 mapping `organization-detail-v1` refuses.
 *
 * The Organization-level target IS shown, because an operator can enumerate
 * Organizations from their own home screen; learning that one was acted on
 * discloses nothing they could not obtain there. To see what was done to a
 * particular customer, an operator goes to that Organization's own feed — where
 * the request names the Organization and **writes a record into it**.
 *
 * ===========================================================================
 * THERE IS NO PRINCIPAL FILTER, AND ITS ABSENCE IS THE POINT
 * ===========================================================================
 *
 * Filtering by a principal and counting results would disclose that principal's
 * Organizations one bit at a time — the omitted field reconstructed through a
 * query parameter. Core REFUSES such a parameter rather than ignoring it, on the
 * principle that "an ignored parameter is a parameter someone will later
 * honour", and `PlatformFeedFilters` has no member through which this client
 * could express one.
 *
 * `actor_principal_id` IS offered: filtering by the OPERATOR is not a
 * disclosure, since operators are a known set to anyone who can read this feed.
 *
 * ===========================================================================
 * READING THE LOG WRITES TO THE LOG
 * ===========================================================================
 *
 * Two control-plane row-writes per page, per P4. So no polling, no refetch on
 * focus, no prefetch of page 2, and no automatic retry. And the vertiginous
 * consequence, worth knowing before reading an empty feed as "nothing has
 * happened": THE FIRST RECORD IN AN EMPTY LOG WILL USUALLY BE SOMEONE READING
 * IT.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { AuditRecordList } from '@/components/AuditRecordList';
import { EmptyBlock, LoadingBlock, PermissionDeniedBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { WindowOrOtherError } from '@/components/WindowRefusal';
import {
  MAX_WINDOW_DAYS,
  describeWindow,
  localRefusalKey,
  shiftWindowByOwnLength,
  windowIsRequired,
  windowRefusal,
  type LocalWindowRefusal,
  type WindowDraft,
} from '@/api/audit-window';
import { usePlatformAudit } from '@/lib/queries';
import {
  fill,
  formatCount,
  useLocale,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';
import {
  toUtcExclusiveDayEnd,
  toUtcDayStart,
  type PlatformFeedFilters,
  type PlatformFeedOutput,
} from '@/api/platform';
import { type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: PlatformFeedOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** What the operator has typed. Applied only on submit. */
interface Draft {
  actor: string;
  action: string;
  since: string;
  until: string;
}

const EMPTY_DRAFT: Draft = { actor: '', action: '', since: '', until: '' };

/*
 * "Showing 3 records" — six forms, chosen by `Intl.PluralRules`. See
 * `formatCount`; `Record<PluralCategory, MessageKey>` is total, so omitting one
 * does not compile.
 */
const RECORD_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'audit.showing.zero',
  one: 'audit.showing.one',
  two: 'audit.showing.two',
  few: 'audit.showing.few',
  many: 'audit.showing.many',
  other: 'audit.showing.other',
};

export function PlatformAudit() {
  const { locale, t } = useLocale();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** The filters actually in force. Changing them resets the cursor. */
  const [applied, setApplied] = useState<PlatformFeedFilters>({});
  /**
   * The window that is IN FORCE, as the operator typed it — held separately from
   * `applied` so the empty state can name it without reverse-engineering a
   * display date from the exclusive ISO bound.
   *
   * `null` means no window was applied, which is a different sentence.
   */
  const [appliedWindowDraft, setAppliedWindowDraft] = useState<WindowDraft | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  /** A local refusal, shown instead of spending a request that would be refused. */
  const [windowError, setWindowError] = useState<LocalWindowRefusal | null>(null);

  const appliedWindow =
    appliedWindowDraft === null
      ? null
      : describeWindow(appliedWindowDraft, locale, t('window.joiner'));

  /*
   * ===================================================================
   * THE FEED IS A QUERY, KEYED ON THE CURSOR AND THE FILTERS
   * ===================================================================
   *
   * The filters are part of the key because a filter change is a DIFFERENT
   * QUESTION rather than a refresh of the old one — which is also why a cursor
   * cannot survive one, and why applying filters still resets it below.
   *
   * `isFetching` reproduces the effect this replaces, which set
   * `{ kind: 'loading' }` at the top of every run. No interval, no focus
   * listener, no reconnect listener — see `lib/query-client.ts`.
   *
   * ⚠ ONE BEHAVIOUR CHANGED, IN THE CHEAPER DIRECTION, AND IT IS STATED RATHER
   * THAN LEFT TO BE NOTICED. Pressing "Apply filters" with NOTHING CHANGED used
   * to fire a fresh request: `applied` was rebuilt into a new object on every
   * submit and the effect compared it by reference. The key is compared
   * structurally, so an unchanged filter set now spends nothing.
   *
   * **That is the behaviour this screen argues for elsewhere in its own file** —
   * every window is 2 control-plane row-writes against a 600/day ceiling — and
   * the operator still sees the answer they asked for, because it is the answer
   * already on screen. **Retrying a FAILURE is unaffected**: the retry controls
   * call `refetch` and always spend a request.
   */
  const feed = usePlatformAudit(cursor, applied);
  const load: Load =
    feed.isPending || feed.isFetching
      ? { kind: 'loading' }
      : feed.error !== null
        ? { kind: 'failed', error: feed.error }
        : { kind: 'loaded', page: feed.data };

  /** One audited call, the same cost as the nonce bump it replaces. */
  const retry = useCallback(() => {
    void feed.refetch();
  }, [feed]);

  /*
   * A CURSOR IS BOUND TO THE QUERY SHAPE, so changing a filter invalidates it.
   * Core would refuse a carried-forward cursor; the correct client behaviour is
   * not to send it. Applying filters therefore always resets to the first page.
   */
  const applyFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      /*
       * THE LOCAL PRE-CHECK. A request that will certainly be refused still
       * costs 2 control-plane row-writes and an audit record, so the shape is
       * checked here first. Core's refusal remains authoritative — see the
       * server-token branch below, which handles the case where this mirror has
       * drifted from the contract.
       */
      const required = windowIsRequired({
        actorPrincipalId: draft.actor.trim(),
        actionId: draft.action.trim(),
      });
      const refusal = windowRefusal({ since: draft.since, until: draft.until }, required);
      if (refusal !== null) {
        setWindowError(refusal);
        return;
      }
      setWindowError(null);

      // Mutable while being assembled, then handed to the readonly type. The
      // fields are optional and omitted when blank — never sent empty.
      const next: {
        actor_principal_id?: string;
        action_id?: string;
        since?: string;
        until?: string;
      } = {};
      if (draft.actor.trim() !== '') next.actor_principal_id = draft.actor.trim();
      if (draft.action.trim() !== '') next.action_id = draft.action.trim();
      // Strict RFC 3339 UTC, built here — never whatever the date input holds.
      const since = toUtcDayStart(draft.since);
      // EXCLUSIVE: the next day's midnight. `[since, until)`.
      const until = toUtcExclusiveDayEnd(draft.until);
      if (since !== null) next.since = since;
      if (until !== null) next.until = until;
      setApplied(next);
      // Recorded as the operator typed it, so the empty state can name it.
      setAppliedWindowDraft(
        next.since !== undefined && next.until !== undefined
          ? { since: draft.since, until: draft.until }
          : null,
      );
      setCursor(null);
      setDepth(1);
    },
    [draft],
  );

  const clearFilters = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setApplied({});
    setAppliedWindowDraft(null);
    setWindowError(null);
    setCursor(null);
    setDepth(1);
  }, []);

  /*
   * MOVES THE RANGE AND DOES NOT FETCH. A twelve-month investigation is twelve
   * requests; this saves the retyping and spends nothing. The operator still
   * presses Apply, because every window is 2 control-plane row-writes against a
   * 600/day ceiling and no request may be fired that they did not ask for.
   */
  const shiftWindow = useCallback((direction: -1 | 1) => {
    setDraft((prev) => ({ ...prev, ...shiftWindowByOwnLength(prev, direction) }));
    setWindowError(null);
  }, []);

  const filtered = Object.keys(applied).length > 0;

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          {t('platformAudit.title')}
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          {t('platformAudit.intro')}{' '}
          <span className="font-semibold text-ink-soft">{t('platformAudit.noTargetPerson')}</span>{' '}
          {t('platformAudit.noTargetPersonWhere')}
        </p>
      </header>

      <form
        onSubmit={applyFilters}
        className="mb-6 grid gap-4 rounded-[12px] border border-line bg-surface p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="filter-actor"
            label={t('audit.filter.operator')}
            hint={t('audit.filter.operatorHint')}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.actor}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, actor: event.target.value }));
                }}
                placeholder={t('audit.filter.operatorPlaceholder')}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <Field
            id="filter-action"
            label={t('audit.filter.action')}
            hint={t('audit.filter.actionHint')}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.action}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, action: event.target.value }));
                }}
                /*
                  AN ACTION ID IS A WIRE IDENTIFIER AND IS NOT TRANSLATED. It is
                  what the operator types verbatim into the filter, so a
                  localised example would be an example that does not work.
                */
                placeholder="platform.templates.create"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <Field
            id="filter-since"
            label={t('audit.filter.from')}
            hint={t('audit.filter.fromHint')}
          >
            {(aria) => (
              <Input
                {...aria}
                type="date"
                value={draft.since}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, since: event.target.value }));
                }}
              />
            )}
          </Field>

          <Field id="filter-until" label={t('audit.filter.to')} hint={t('audit.filter.toHint')}>
            {(aria) => (
              <Input
                {...aria}
                type="date"
                value={draft.until}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, until: event.target.value }));
                }}
              />
            )}
          </Field>
        </div>

        {/*
          THERE IS NO "PERSON ACTED ON" FILTER, and the absence is explained
          where an operator would look for it — otherwise it reads as an
          oversight and someone requests it.
        */}
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          {t('platformAudit.noPersonFilter')}
        </p>

        {/*
          THE WINDOW RULE, STATED WHERE THE FILTERS ARE — so an operator learns
          it before being refused rather than by being refused.
        */}
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          {fill(t('audit.windowRule'), locale, { days: MAX_WINDOW_DAYS })}
        </p>

        {windowError !== null ? (
          <p
            role="alert"
            className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem] leading-relaxed text-ink"
          >
            {/*
              THE LIMIT AND THE MEASURED SPAN BOTH COME FROM CODE. `{days}` is
              `MAX_WINDOW_DAYS` and `{span}` is what the operator's dates
              actually cover — neither is a numeral in a dictionary, which would
              be a second copy of a constant in the two files least likely to be
              re-derived when it changes.
            */}
            {fill(t(localRefusalKey(windowError)), locale, {
              days: MAX_WINDOW_DAYS,
              ...(windowError.kind === 'too_wide' ? { span: windowError.span } : {}),
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary">
            {t('audit.apply')}
          </Button>
          {/*
            WALKING BACKWARDS ONE WINDOW AT A TIME. These only rewrite the two
            date fields — they fire NO request. The operator presses Apply, which
            is the one place a window costs anything.
          */}
          {draft.since !== '' && draft.until !== '' ? (
            <>
              {/*
                "EARLIER"/"LATER", NOT "-1 MONTH". The shift moves by the
                window's own length, so consecutive windows tile without gap or
                overlap — and a label promising a month would be wrong for any
                window that is not a month long.
              */}
              <Button
                variant="ghost"
                onClick={() => {
                  shiftWindow(-1);
                }}
              >
                {t('audit.earlierWindow')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  shiftWindow(1);
                }}
              >
                {t('audit.laterWindow')}
              </Button>
            </>
          ) : null}
          {filtered ? (
            <Button variant="ghost" onClick={clearFilters}>
              {t('audit.clear')}
            </Button>
          ) : null}
          <p className="text-[0.8125rem] text-ink-muted">{t('audit.applyResets')}</p>
        </div>
      </form>

      {load.kind === 'loading' ? <LoadingBlock label={t('loading.platformAudit')} /> : null}

      {/*
        `forbidden` FIRST. An operator may hold `core.organization.list` and not
        `core.platform-audit.read` — the two are separate grants — so a refusal
        here is an ordinary, expected state on a console whose other sections
        work. Rendering it as an error would say the feed is broken.
      */}
      {load.kind === 'failed' ? (
        load.error.code === 'forbidden' ? (
          <PermissionDeniedBlock error={load.error} />
        ) : isCeilingCode(load.error.code) ? (
          <CeilingNotice error={load.error} scope="platform" onRetry={retry} />
        ) : (
          /*
           * THE THREE WINDOW TOKENS STAY DISTINCT. Someone who omitted a window
           * and someone who asked for two years need different sentences — the
           * first has to add dates, the second has to narrow them — and
           * "invalid request" for both cannot tell them which. Same shape as the
           * member-lookup refusal: a collapsed message where the causes are
           * genuinely different is a message that helps nobody.
           */
          <WindowOrOtherError error={load.error} onRetry={retry} />
        )
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        /*
         * ===============================================================
         * AN EMPTY WINDOWED RESULT SAYS "IN THIS WINDOW". NEVER "NO RECORDS".
         * ===============================================================
         *
         * THIS IS THE HALF THE CONTRACT CANNOT ENFORCE. Core refuses an omitted
         * window precisely so an operator cannot receive a silently narrowed
         * answer — and nothing stops them MISREADING a correctly narrow one.
         *
         * An investigator who filters by an operator, gets an empty page, and
         * reads it as "this person did nothing" has drawn a conclusion the data
         * does not support. On an evidence surface that is the failure that
         * matters, because **it is indistinguishable from evidence of
         * innocence.**
         *
         * So the window is named in the SENTENCE THE OPERATOR READS when there
         * is nothing there — not a footnote, not a tooltip, not a caption under
         * the filters they may have stopped looking at.
         */
        <EmptyBlock
          title={
            appliedWindow !== null
              ? t('audit.empty.inWindow')
              : filtered
                ? t('audit.empty.filtered')
                : t('platformAudit.empty.title')
          }
          body={
            appliedWindow !== null ? (
              <>
                {t('audit.empty.windowLead')}{' '}
                {/*
                  THE WINDOW IS BOLD AND ISOLATED. It is a formatted date range
                  built from the operator's own input, and it is the one phrase
                  on this screen that must be exactly right — misreading it turns
                  "we did not look here" into "nothing happened". `bdi` keeps the
                  numerals and the `(UTC)` from being reordered around it.
                */}
                <span className="font-semibold text-ink">
                  <bdi>{appliedWindow}</bdi>
                </span>
                {t('audit.empty.windowStop')} {t('audit.empty.windowNotSearched')}{' '}
                <span className="font-semibold text-ink">{t('audit.earlierWindow')}</span>{' '}
                {t('audit.empty.windowKeepLooking')}
              </>
            ) : filtered ? (
              <>{t('audit.empty.filteredBody')}</>
            ) : (
              <>{t('platformAudit.empty.body')}</>
            )
          }
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <AuditRecordList
            records={load.page.data}
            targetHeading={t('platformAudit.targetColumn')}
            /*
              THE ONE COLUMN THAT DIFFERS. This closure holds a
              `PlatformFeedRecord`, which HAS NO `target_principal_id` — so this
              screen cannot render a principal target even by accident, and the
              shared list component never sees one.
            */
            renderTarget={(record) =>
              record.target_organization_id === null ? (
                <span className="font-sans text-ink-muted">{t('audit.noTarget')}</span>
              ) : (
                <bdi>{record.target_organization_id}</bdi>
              )
            }
          />

          <nav
            aria-label={t('a11y.pagination')}
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            {/*
              "Showing 3 records" — SIX FORMS IN ARABIC, chosen by `Intl`. The
              old `length === 1 ? 'record' : 'records'` is right for English and
              wrong for Arabic at almost every count; `formatCount` defers the
              rule to the engine rather than to a ternary written here.
            */}
            <p className="text-[0.8125rem] text-ink-muted">
              {formatCount(locale, load.page.data.length, RECORD_FORMS, t)}
              {depth > 1 ? ` · ${fill(t('audit.page'), locale, { page: depth })}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCursor(null);
                    setDepth(1);
                  }}
                >
                  {t('audit.newest')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                /* Terminate on NULL. `next_cursor` is never an empty string. */
                disabled={load.page.next_cursor === null}
                onClick={() => {
                  if (load.page.next_cursor === null) return;
                  setCursor(load.page.next_cursor);
                  setDepth((value) => value + 1);
                }}
              >
                {load.page.next_cursor === null ? t('audit.noMorePages') : t('audit.older')}
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}
