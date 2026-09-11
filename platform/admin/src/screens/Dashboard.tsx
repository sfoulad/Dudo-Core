/**
 * What the platform holds right now, for an operator arriving cold.
 *
 * ===========================================================================
 * ⚠ THERE IS NO COUNT ROUTE, SO THERE ARE NO COUNTS. THIS IS THE MOST
 * IMPORTANT THING ABOUT THIS SCREEN.
 * ===========================================================================
 *
 * `platform.organizations.list` and `platform.templates.list` return
 * `{ data, next_cursor }`. **Neither publishes a total, and no aggregate route
 * exists.** So this screen CANNOT say "42 Organizations", and inventing one is
 * the single most tempting thing a dashboard does.
 *
 * **What it says instead is "at least N", with the reason on screen.** An
 * operator reading *"at least 25"* beside *"Core paginates this list and
 * publishes no count"* knows exactly what they have. An operator reading "25"
 * when the platform holds four hundred has been told something false by a
 * screen whose entire job is to be trusted at a glance.
 *
 * **NAMED AS A GAP RATHER THAN WORKED AROUND** (`architecture.md` §1: a blocked
 * client requests the contract and waits, it does not stub a shape): a genuine
 * platform summary wants a counts route. It does not exist, this screen does
 * not pretend otherwise, and **the request is with the Team Lead rather than
 * approximated here.** Reading every page to count would be the workaround, and
 * it would spend an audited call per page to compute a number that changes.
 *
 * ===========================================================================
 * WHAT OPENING THIS COSTS, BECAUSE A DASHBOARD IS THE SCREEN THAT GETS POLLED
 * ===========================================================================
 *
 * **THREE AUDITED CALLS**, one per panel, on open — the Organization list, the
 * Template list and the platform audit feed. Every one is a platform-operator
 * action that writes a row, and the audit read costs 2 control-plane row-writes
 * against a 600/day ceiling.
 *
 * **So: no `refetchInterval`, no refetch on focus, no auto-refresh, and no
 * "live" anything.** `lib/query-client.ts` disables the three request-adding
 * defaults globally and this screen adds none back. A dashboard left open on a
 * second monitor must cost exactly what it cost when it was opened.
 *
 * **AND IT READS NO TENANT DATA.** Every panel is control-plane. There is no
 * customer count, no revenue figure, no activity chart — `0024`'s mutual
 * exclusion is what makes those impossible rather than merely absent, and
 * `platform-operator-v1` is explicit that *"a console acquires cross-tenant
 * reach one convenient number at a time."* **A dashboard is exactly where that
 * happens.** Nothing here opens an Organization's own trail either: reading one
 * writes to that customer's daily allowance.
 *
 * ===========================================================================
 * EACH PANEL CARRIES ITS OWN STATE, AND `403` IS ITS OWN
 * ===========================================================================
 *
 * The three reads are independent and are authorised independently — an
 * operator may hold `core.organization.list` and not `core.platform-audit.read`.
 * **So one panel refusing must not blank the page**, and a refusal renders as
 * `PermissionDeniedBlock` rather than as an empty list, which would tell an
 * operator the platform holds nothing.
 */

import { Link } from '@tanstack/react-router';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PermissionDeniedBlock,
} from '@/components/StateBlock';
import { AuditRecordList } from '@/components/AuditRecordList';
import {
  useOrganizationCount,
  useOrganizationList,
  usePlatformAudit,
  useTemplateCount,
} from '@/lib/queries';
import { useT } from '@/lib/i18n';
import { isKnownStatus } from '@/api/platform';
import { cn } from '@dudo/ui';
import type { ApiError } from '@/api/errors';
import type { ReactNode } from 'react';

/** How many rows a panel shows before deferring to its section. */
const PREVIEW_ROWS = 5;

export function Dashboard() {
  const t = useT();

  /*
   * THE SAME HOOKS THE SECTIONS USE, WITH THE SAME KEYS — so the cache is
   * shared rather than duplicated. Opening the dashboard and then the
   * Organization list is not two reads of page one; it is one, because the key
   * is identical. **That is a saving the screens get for free and would lose
   * the moment this file grew its own query.**
   */
  /*
   * ===========================================================================
   * FOUR AUDITED CALLS ON OPEN, NOT THREE — AND THE TEMPLATE LIST IS GONE
   * ===========================================================================
   *
   * The two counts are separate routes with their own audit records and their
   * own control-plane row-writes, so this is +2. **But `useTemplateList` is now
   * unread and removed**, so the net is +1 — and the compiler is what found
   * that, not a review: the list existed solely to supply
   * `templates.data?.data.length` to a panel that now reads a total.
   *
   * **The Organization list stays** because "Recently onboarded" below renders
   * its rows. It was already being fetched; the count is an additional call
   * rather than a replacement for it.
   *
   * **The extra call buys a number that does not lie by omission.** *"At least
   * 25"* on a platform with 400 Organizations is not a summary, and an operator
   * reading it as a total is reading it wrong — which is why `0042` exists
   * rather than the panels simply saying more.
   *
   * **Nothing polls and nothing refetches on focus** (`lib/query-client.ts`),
   * so this is four calls per visit rather than four per minute: a dashboard
   * left open all day costs what it cost to open.
   */
  const organizationCount = useOrganizationCount();
  const templateCount = useTemplateCount();
  const organizations = useOrganizationList(null);
  const audit = usePlatformAudit(null, {});

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          {t('dashboard.title')}
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">{t('dashboard.intro')}</p>
      </header>

      {/*
        TWO COLUMNS ON A TABLET AND UP, ONE BELOW.

        `sm:` rather than `lg:` because an iPad in portrait is 768 CSS pixels
        and is a named target — a summary that stays single-column there wastes
        half the screen an operator is holding. `gap` and `grid` are logical, so
        the column order follows `dir` with no rule of its own.
      */}
      <div className="grid gap-5 sm:grid-cols-2">
        {/*
          ===================================================================
          ✅ THE TOTALS, AT LAST — `0042`'S ROUTES GET THEIR FIRST CONSUMER
          ===================================================================

          These panels said **"at least 25"** and explained why, because a
          paginated list cannot state a total until its last page. `0042` exists
          for exactly that sentence, and the two count routes have been built,
          registered, audited and **consumed by nothing** since they landed.

          **THE PANEL NOW READS FROM THE COUNT QUERY, NOT THE LIST QUERY**, and
          that is the whole change: `query` decides which loading and refusal
          state is shown, so a count that is refused now says so on its own
          rather than inheriting the list's outcome.

          **The two counts are separate queries and fail independently** — an
          operator may hold `core.organization.list` and not `core.template.read`
          — so one refusal must not hide the other's answer.

          **THE LIST QUERIES ARE STILL READ BELOW** for "Recently onboarded",
          which needs rows rather than a number. **No extra request is made for
          this panel**; the count is its own audited call and the list was
          already being fetched.
        */}
        <CountPanel
          title={t('dashboard.organizations')}
          to="/organizations"
          viewAll={t('dashboard.viewAll')}
          query={organizationCount}
          count={organizationCount.data?.total}
          hasMore={false}
          t={t}
        />

        <CountPanel
          title={t('dashboard.templates')}
          to="/templates"
          viewAll={t('dashboard.viewAll')}
          query={templateCount}
          count={templateCount.data?.total}
          hasMore={false}
          note={t('dashboard.templatesAdopted')}
          t={t}
        />
      </div>

      {/*
        RECENTLY ONBOARDED — the first page of the Organization list, which
        `platform.organizations.list` returns newest-first. **No second request
        is made for this**: it is the panel above rendered as rows rather than
        as a number, off the same cached response.
      */}
      <h2 className="mt-8 mb-3 text-lg font-bold text-ink">
        {t('dashboard.recentOnboardings')}
      </h2>
      <Panel
        query={organizations}
        loadingLabel={t('state.loading')}
        emptyTitle={t('dashboard.none')}
        emptyBody={t('dashboard.partialExplain')}
        isEmpty={(page: typeof organizations.data) => (page?.data.length ?? 0) === 0}
      >
        {organizations.data !== undefined && organizations.data.data.length > 0 ? (
          <ul className="grid gap-2">
            {organizations.data.data.slice(0, PREVIEW_ROWS).map((organization) => (
              <li key={organization.organization_id}>
                <Link
                  to="/organizations/$organizationId"
                  params={{ organizationId: organization.organization_id }}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[7px] border border-line bg-surface p-3 no-underline hover:border-navy-600"
                >
                  <span className="min-w-0 text-[0.9375rem] font-semibold break-words text-ink">
                    {/*
                      THE IDENTIFIER VERBATIM WHEN THERE IS NO NAME. Binding on
                      both clients: "not a blank, not a dash, not 'Unnamed
                      Organization'." A dashboard is exactly where somebody
                      would invent a placeholder to make a list look tidy.
                    */}
                    {organization.display_name ?? (
                      <span className="font-mono text-[0.875rem] break-all">
                        {organization.organization_id}
                      </span>
                    )}
                  </span>
                  <StatusPill status={organization.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <h2 className="mt-8 mb-3 text-lg font-bold text-ink">{t('dashboard.recentActions')}</h2>
      <Panel
        query={audit}
        loadingLabel={t('state.loading')}
        emptyTitle={t('dashboard.none')}
        emptyBody={t('dashboard.auditCost')}
        isEmpty={(page: typeof audit.data) => (page?.data.length ?? 0) === 0}
      >
        {audit.data !== undefined && audit.data.data.length > 0 ? (
          <>
            {/*
              `renderTarget` IS REQUIRED AND THAT IS THE POINT, not friction.
              The shared list never learns which feed it is drawing; the caller
              supplies the one differing column. This closure holds a
              `PlatformFeedRecord`, which HAS NO `target_principal_id` — so this
              screen cannot render a principal target even by accident.
            */}
            <AuditRecordList
              records={audit.data.data.slice(0, PREVIEW_ROWS)}
              targetHeading={t('platformAudit.targetColumn')}
              renderTarget={(record) =>
                record.target_organization_id ?? (
                  <span className="font-sans text-ink-muted">{t('audit.noTarget')}</span>
                )
              }
            />
            <p className="mt-3">
              <Link
                to="/audit"
                className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
              >
                {t('dashboard.viewAll')}
              </Link>
            </p>
          </>
        ) : null}
      </Panel>

      <p className="mt-8 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
        {t('dashboard.auditCost')}
      </p>
    </section>
  );
}

/**
 * The four states one read can be in, in one place.
 *
 * **`forbidden` IS BRANCHED BEFORE `error`**, because `ErrorBlock` would render
 * a refusal as a failure — and a permission boundary is not a malfunction. The
 * order is the assertion.
 */
function Panel<T>({
  query,
  loadingLabel,
  emptyTitle,
  emptyBody,
  isEmpty,
  children,
}: {
  query: { isPending: boolean; isFetching: boolean; error: ApiError | null; data: T | undefined };
  loadingLabel: string;
  emptyTitle: string;
  emptyBody: ReactNode;
  isEmpty: (data: T | undefined) => boolean;
  children: ReactNode;
}) {
  if (query.isPending || query.isFetching) return <LoadingBlock label={loadingLabel} />;
  if (query.error !== null) {
    return query.error.code === 'forbidden' ? (
      <PermissionDeniedBlock error={query.error} />
    ) : (
      <ErrorBlock error={query.error} />
    );
  }
  if (isEmpty(query.data)) return <EmptyBlock title={emptyTitle} body={emptyBody} />;
  return <>{children}</>;
}

/**
 * A figure that is honest about being a floor.
 *
 * **`hasMore` decides whether "at least" appears at all.** When Core returns no
 * `next_cursor` the first page IS the whole set, so the number is exact and
 * qualifying it would be its own kind of false modesty. When there is another
 * page, the qualifier and its explanation are both shown — **not a tooltip**,
 * because a figure whose meaning is hidden behind a hover is a figure most
 * people read wrongly.
 */
function CountPanel({
  title,
  to,
  viewAll,
  query,
  count,
  hasMore,
  note,
  t,
}: {
  title: string;
  to: '/organizations' | '/templates';
  viewAll: string;
  query: { isPending: boolean; isFetching: boolean; error: ApiError | null };
  count: number | undefined;
  /*
   * ⚠ `hasMore` IS NOW ALWAYS `false` AND THE PROP IS KEPT, DELIBERATELY.
   *
   * `0042`'s count routes have landed, so the number below is a TOTAL rather
   * than the first page's length. **The partial branch is not deleted**,
   * because the panel's honesty rule survives the routes: if a future count is
   * ever unavailable and this falls back to a page length, **the "at least"
   * qualifier and its explanation must come back with it.** Deleting the branch
   * would make the fallback silently claim a total it does not have.
   */
  hasMore: boolean | undefined;
  note?: string;
  t: (key: 'dashboard.countIsPartial' | 'dashboard.partialExplain' | 'state.loading') => string;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-5">
      <h2 className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">{title}</h2>

      {query.isPending || query.isFetching ? (
        <p className="mt-3 text-ink-muted">{t('state.loading')}</p>
      ) : query.error !== null ? (
        query.error.code === 'forbidden' ? (
          <div className="mt-3">
            <PermissionDeniedBlock error={query.error} />
          </div>
        ) : (
          <div className="mt-3">
            <ErrorBlock error={query.error} />
          </div>
        )
      ) : (
        <>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            {hasMore === true ? (
              <span className="text-[0.8125rem] text-ink-muted">
                {t('dashboard.countIsPartial')}
              </span>
            ) : null}
            <span className="text-3xl font-bold tabular-nums text-ink">{count ?? 0}</span>
          </p>
          {hasMore === true ? (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
              {t('dashboard.partialExplain')}
            </p>
          ) : null}
          {note !== undefined ? (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">{note}</p>
          ) : null}
          <p className="mt-3">
            <Link
              to={to}
              className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
            >
              {viewAll}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

/** The same tolerant rendering the detail screen uses — unknown values stay neutral. */
function StatusPill({ status }: { status: string }) {
  const known = isKnownStatus(status);
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        status === 'active' && 'bg-green-50 text-green-700',
        status === 'suspended' && 'bg-gold-50 text-gold-700',
        !known && 'bg-sunk text-ink-muted',
      )}
    >
      {status}
      {!known ? <span className="sr-only"> (an unrecognised status)</span> : null}
    </span>
  );
}
