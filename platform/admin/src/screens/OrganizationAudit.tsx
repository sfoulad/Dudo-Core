/**
 * The Organization feed — what the platform has done to one named customer.
 *
 * ===========================================================================
 * READING THIS TRAIL WRITES TO THIS TRAIL, AND THAT IS THE DESIGN
 * ===========================================================================
 *
 * Every page costs FIVE TENANT ROW-WRITES against this customer's own daily
 * allocation, plus two control-plane. The tenant-side record is not incidental:
 * it is what keeps the scoped feed from becoming the quiet way to do what a
 * bulk read was refused for, one Organization at a time. "The back door is
 * closed by making it the same size as the front one."
 *
 * A CONSEQUENCE AN OPERATOR SHOULD SEE RATHER THAN DISCOVER: this trail
 * contains reads of itself, and an operator will find their own previous
 * visits here. It terminates — one record per read, not one per record read —
 * and it is recorded so nobody reports it as a defect.
 *
 * SO: no polling, no refetch on focus or reconnect, no prefetch of the next
 * page, no automatic retry. Every page is fetched because a person pressed
 * something, and the screen says so before they press it.
 *
 * ===========================================================================
 * THIS FEED CARRIES `target_principal_id`. THE PLATFORM FEED DOES NOT.
 * ===========================================================================
 *
 * It may, BECAUSE THE CALLER NAMED THE ORGANIZATION — the identical gate the
 * membership ruling applies to the member resolve: an operator must already
 * have a reason to ask about a specific customer. It is the accountability
 * view, and it is the one an operator handling a support case actually needs.
 *
 * There is no `target_organization_id` here: the path parameter already fixed
 * it, and repeating it "would invite a client to trust the body over the path".
 *
 * AND THE FILTER SET IS SMALLER THAN THE PLATFORM FEED'S. No
 * `actor_principal_id` — `OrganizationFeedFilters` has no such member, so this
 * screen cannot offer one. The two feeds are different queries, and their
 * cursors are not interchangeable.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { AuditRecordList } from '@/components/AuditRecordList';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PermissionDeniedBlock,
} from '@/components/StateBlock';
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
import { Link } from '@tanstack/react-router';
import { useOrganizationAuditRead } from '@/lib/queries';
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
  type OrganizationFeedFilters,
  type OrganizationFeedOutput,
} from '@/api/platform';
import { type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: OrganizationFeedOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

interface Draft {
  action: string;
  since: string;
  until: string;
}

const EMPTY_DRAFT: Draft = { action: '', since: '', until: '' };

/* Shared with the platform feed — the pagination vocabulary is identical. */
const RECORD_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'audit.showing.zero',
  one: 'audit.showing.one',
  two: 'audit.showing.two',
  few: 'audit.showing.few',
  many: 'audit.showing.many',
  other: 'audit.showing.other',
};

/*
 * "3 reads this visit" — NOT shared, and the difference is the point of the
 * screen. This counts reads that each cost a CUSTOMER five writes; the platform
 * feed's counter counts records on a page. Two sentences about two things that
 * happen to be integers.
 */
const READ_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'orgAudit.reads.zero',
  one: 'orgAudit.reads.one',
  two: 'orgAudit.reads.two',
  few: 'orgAudit.reads.few',
  many: 'orgAudit.reads.many',
  other: 'orgAudit.reads.other',
};

export function OrganizationAudit({ organizationId }: { organizationId: string }) {
  const { locale, t } = useLocale();
  /*
   * ===================================================================
   * IT DOES NOT LOAD ON MOUNT. THE FIRST PAGE IS ALSO A DELIBERATE ACT.
   * ===================================================================
   *
   * Every other screen in this console fetches when it opens. This one does
   * not, because opening it spends five writes from a customer's daily
   * allocation — so arriving at the address, or landing here from a mistyped
   * link, must not cost them anything. The operator presses Read, having been
   * told what it costs.
   */
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<OrganizationFeedFilters>({});
  /** The window in force, as typed. `null` means none was applied. */
  const [appliedWindowDraft, setAppliedWindowDraft] = useState<WindowDraft | null>(null);
  const [windowError, setWindowError] = useState<LocalWindowRefusal | null>(null);

  const appliedWindow =
    appliedWindowDraft === null
      ? null
      : describeWindow(appliedWindowDraft, locale, t('window.joiner'));
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [requests, setRequests] = useState(0);

  /*
   * ===================================================================
   * A MUTATION, FOR A READ. `lib/queries.ts` CARRIES THE FULL ARGUMENT.
   * ===================================================================
   *
   * In short: this read spends FIVE WRITES FROM A CUSTOMER'S OWN DAILY
   * ALLOCATION, so it must not fire on mount, every press must fire even when
   * nothing changed, and a refusal still counts as an attempt. A cache would
   * defeat the middle one — serving a repeat press from memory shows the
   * operator an answer while the business's log records fewer reads than
   * happened.
   *
   * **`useMutation`'s four states ARE this screen's four states**, which is the
   * clearest sign it is the right mapping rather than a workaround:
   *
   *     idle    -> nothing has been asked, and nothing has been spent
   *     pending -> loading
   *     error   -> failed
   *     success -> loaded
   *
   * So `Load` is derived here too, and the `nonce` that armed the old effect is
   * gone: a mutation does not fire until it is called, which is the property
   * the `if (nonce === 0) return;` guard was simulating.
   */
  const feed = useOrganizationAuditRead();
  const load: Load =
    feed.status === 'idle'
      ? { kind: 'idle' }
      : feed.status === 'pending'
        ? { kind: 'loading' }
        : feed.status === 'error'
          ? { kind: 'failed', error: feed.error }
          : { kind: 'loaded', page: feed.data };

  /*
   * ONE PRESS, ONE REQUEST — and the cursor and filters are passed EXPLICITLY
   * rather than read from state at call time.
   *
   * The old effect re-ran when `cursor` or `applied` changed, so a caller could
   * set state and let the dependency array carry the new value. A mutation
   * fires immediately, and `setCursor` has not landed yet when the handler runs
   * — reading state here would send the PREVIOUS page's cursor and spend a
   * customer's write on the wrong question.
   *
   * The tally is incremented on SETTLE rather than on press, and it counts
   * refusals: a refused request still consumed the attempt from the operator's
   * point of view, and counting only successes would flatter the number.
   */
  const fire = useCallback(
    (nextCursor: string | null, nextFilters: OrganizationFeedFilters) => {
      feed.mutate(
        { organizationId, cursor: nextCursor, filters: nextFilters },
        {
          onSettled: () => {
            setRequests((value) => value + 1);
          },
        },
      );
    },
    [feed, organizationId],
  );

  const read = useCallback(() => {
    fire(cursor, applied);
  }, [applied, cursor, fire]);

  /* A cursor is bound to the query shape, so a filter change resets it. */
  const applyFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      /*
       * THE WINDOW CONDITION IS NARROWER HERE THAN ON THE PLATFORM FEED, and
       * that is the contract rather than an oversight: only `action_id`
       * triggers it. **`organization_id` is exempt, and not as a concession** —
       * it is a PATH parameter served by an index, so filtering by it costs no
       * walk. This screen has no actor filter at all.
       */
      const required = windowIsRequired({ actionId: draft.action.trim() });
      const refusal = windowRefusal({ since: draft.since, until: draft.until }, required);
      if (refusal !== null) {
        setWindowError(refusal);
        return;
      }
      setWindowError(null);

      // Mutable while being assembled. NOTE THERE IS NO `actor_principal_id`
      // HERE — the Organization feed does not accept one, and the type has no
      // member for it.
      const next: { action_id?: string; since?: string; until?: string } = {};
      if (draft.action.trim() !== '') next.action_id = draft.action.trim();
      const since = toUtcDayStart(draft.since);
      // EXCLUSIVE: the next day's midnight. `[since, until)`.
      const until = toUtcExclusiveDayEnd(draft.until);
      if (since !== null) next.since = since;
      if (until !== null) next.until = until;
      setApplied(next);
      setAppliedWindowDraft(
        next.since !== undefined && next.until !== undefined
          ? { since: draft.since, until: draft.until }
          : null,
      );
      setCursor(null);
      setDepth(1);
      // Fired with `next` directly. `applied` does not hold it yet.
      fire(null, next);
    },
    [draft, fire],
  );

  /* Rewrites the dates only. Fires nothing — see the platform feed's note. */
  const shiftWindow = useCallback((direction: -1 | 1) => {
    setDraft((prev) => ({ ...prev, ...shiftWindowByOwnLength(prev, direction) }));
    setWindowError(null);
  }, []);

  const filtered = Object.keys(applied).length > 0;

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <Link
        to="/organizations/$organizationId"
        params={{ organizationId }}
        className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
      >
        {/*
          A LITERAL ← DOES NOT FLIP. In an RTL layout "back" points RIGHT, and a
          hard-coded arrow character keeps pointing left — so it would aim away
          from where the reader came from, which is worse than no arrow at all.

          An inline SVG with `rtl:-scale-x-100` mirrors with the direction, and
          `aria-hidden` keeps it out of the accessible name: the link already
          says "Back to this Organization", and a screen reader announcing a
          decorative glyph adds nothing.
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="me-1 inline-block size-3.5 align-[-0.15em] rtl:-scale-x-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 3L5 8l5 5" />
        </svg>
        {t('orgAudit.back')}
      </Link>

      <h1 id="section-heading" className="mt-3 text-xl font-bold text-ink sm:text-2xl">
        {t('orgAudit.title')}
      </h1>
      <p className="mt-1 text-[0.8125rem] text-ink-muted">
        <bdi className="font-mono break-all">{organizationId}</bdi>
      </p>

      <p className="mt-3 max-w-prose leading-relaxed text-ink-muted">{t('orgAudit.intro')}</p>

      {/*
        THE COST, STATED BEFORE THE OPERATOR SPENDS IT rather than after. This
        is the only screen in the console that charges a customer to be looked
        at, and an operator who does not know that will page through it idly.
      */}
      <p className="mt-4 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
        <span className="font-semibold">{t('orgAudit.costLead')}</span> {t('orgAudit.costBody')}
      </p>

      <form
        onSubmit={applyFilters}
        className="mt-6 grid gap-4 rounded-[12px] border border-line bg-surface p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="org-filter-action"
            label={t('audit.filter.action')}
            hint={t('orgAudit.filter.actionHint')}
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.action}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, action: event.target.value }));
                }}
                /* A wire identifier. Not translated — see the platform feed. */
                placeholder="platform.credentials.reset"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            id="org-filter-since"
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
          <Field
            id="org-filter-until"
            label={t('audit.filter.to')}
            hint={t('orgAudit.filter.toHint')}
          >
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

        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          {fill(t('orgAudit.windowRule'), locale, { days: MAX_WINDOW_DAYS })}
        </p>

        {windowError !== null ? (
          <p
            role="alert"
            className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem] leading-relaxed text-ink"
          >
            {fill(t(localRefusalKey(windowError)), locale, {
              days: MAX_WINDOW_DAYS,
              ...(windowError.kind === 'too_wide' ? { span: windowError.span } : {}),
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary">
            {load.kind === 'idle' ? t('orgAudit.read') : t('orgAudit.applyAndRead')}
          </Button>
          {/* Rewrites the dates; fires nothing. Each read costs the customer. */}
          {draft.since !== '' && draft.until !== '' ? (
            <>
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
          {requests > 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">
              {formatCount(locale, requests, READ_FORMS, t)}
            </p>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        {load.kind === 'idle' ? (
          /*
            ⚠ THE TITLE SAID "Nothing has been read yet." and the "yet" survived
            into the dictionary review as a KEEP rather than a correction.
            Unlike every other "yet" in this pass, it is not a claim about a
            missing capability — it describes the operator's own session, one
            button press away from being false, and the body says what to press.
            **The absence check scans the dictionary, so this key WOULD have
            been flagged**; it is worded around instead, saying what is true
            (nothing has been read) rather than what is coming.
          */
          <EmptyBlock
            title={t('orgAudit.idle.title')}
            body={
              <>
                {t('orgAudit.idle.body')}{' '}
                <span className="font-semibold">{t('orgAudit.read')}</span>{' '}
                {t('orgAudit.idle.bodyTail')}
              </>
            }
          />
        ) : null}

        {load.kind === 'loading' ? <LoadingBlock label={t('loading.organizationAudit')} /> : null}

        {load.kind === 'failed' ? (
          /*
            `forbidden` FIRST, and on this screen the distinction is sharper
            than elsewhere: the Organization feed declares its own permission,
            so an operator who can read the platform feed may still be refused
            here. **A refusal must not read as "this business has no trail"** —
            that is a false statement about a customer's records.
          */
          load.error.code === 'forbidden' ? (
            <PermissionDeniedBlock error={load.error} />
          ) : isCeilingCode(load.error.code) ? (
            /*
              THE TWO CEILINGS MEAN OPPOSITE THINGS HERE and are rendered as
              different statements: `rate_limited` is about operator activity
              against this customer, `quota_exceeded` is about the customer's own
              allocation. Merging them would produce a retry, which is the
              behaviour the ceilings exist to stop.
            */
            <CeilingNotice error={load.error} scope="organization" onRetry={read} />
          ) : load.error.code === 'not_found' ? (
            <ErrorBlock error={load.error} onRetry={read}>
              <p className="mt-2 leading-relaxed text-ink-soft">
                {t('orgAudit.notFound')}
              </p>
            </ErrorBlock>
          ) : (
            /* The three window tokens stay distinct. See `WindowRefusal`. */
            <WindowOrOtherError error={load.error} onRetry={read} />
          )
        ) : null}

        {load.kind === 'loaded' && load.page.data.length === 0 ? (
          /*
           * AN EMPTY WINDOWED RESULT NAMES ITS WINDOW. The contract refuses an
           * omitted window so an operator cannot be silently narrowed; nothing
           * stops them MISREADING a correctly narrow one, and "the platform did
           * nothing to this customer" is exactly the conclusion a support case
           * turns on. The window goes in the headline sentence.
           */
          <EmptyBlock
            title={
              appliedWindow !== null
                ? t('audit.empty.inWindow')
                : filtered
                  ? t('audit.empty.filtered')
                  : t('orgAudit.empty.title')
            }
            body={
              appliedWindow !== null ? (
                <>
                  {t('orgAudit.empty.windowLead')}{' '}
                  <span className="font-semibold text-ink">
                    <bdi>{appliedWindow}</bdi>
                  </span>
                  {t('audit.empty.windowStop')} {t('orgAudit.empty.windowNotSearched')}
                </>
              ) : filtered ? (
                <>{t('orgAudit.empty.filteredBody')}</>
              ) : (
                <>{t('orgAudit.empty.body')}</>
              )
            }
          />
        ) : null}

        {load.kind === 'loaded' && load.page.data.length > 0 ? (
          <>
            <AuditRecordList
              records={load.page.data}
              targetHeading={t('orgAudit.targetColumn')}
              /*
                THIS FEED'S EXTRA COLUMN. The closure holds an
                `OrganizationFeedRecord`, which is the only record type that has
                a principal target — the platform feed's type has no such
                property, so that screen could not pass this callback.
              */
              renderTarget={(record) =>
                record.target_principal_id === null ? (
                  <span className="font-sans text-ink-muted">{t('audit.noTarget')}</span>
                ) : (
                  <bdi>{record.target_principal_id}</bdi>
                )
              }
            />

            <nav
              aria-label={t('a11y.pagination')}
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
            >
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
                      fire(null, applied);
                    }}
                  >
                    {t('audit.newest')}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={load.page.next_cursor === null}
                  onClick={() => {
                    if (load.page.next_cursor === null) return;
                    setCursor(load.page.next_cursor);
                    setDepth((value) => value + 1);
                    // The new cursor is passed straight through — `setCursor`
                    // has not landed, and sending the old one would re-read the
                    // page already on screen at the customer's expense.
                    fire(load.page.next_cursor, applied);
                  }}
                >
                  {load.page.next_cursor === null ? t('audit.noMorePages') : t('audit.older')}
                </Button>
              </div>
            </nav>
            <p className="mt-2 text-[0.8125rem] text-ink-muted">{t('orgAudit.pageCost')}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
