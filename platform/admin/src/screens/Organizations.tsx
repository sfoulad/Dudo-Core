/**
 * The console's home section — `platform.organizations.list`, live.
 *
 * `platform-operator-v1` calls it "the console's home screen and the only way an
 * operator discovers what exists", which is why it is the default route.
 *
 * ===========================================================================
 * WHAT THIS SCREEN DOES NOT SHOW, AND WHY THAT IS THE DESIGN
 * ===========================================================================
 *
 * NO CUSTOMER COUNTS. NO MEMBER COUNTS. NO ACTIVITY. NO USAGE. The contract:
 * "Every one of those would be a read behind `whereWithTenant`, and a console
 * acquires cross-tenant reach one convenient number at a time." A "how many
 * customers does this Organization have" column is the single most natural
 * feature request this screen will attract, and it is the one that would undo
 * `0024`. It is refused at the contract, not here.
 *
 * ===========================================================================
 * THE IDENTIFIER IS RENDERED VERBATIM WHEN THERE IS NO NAME. BINDING ON BOTH
 * CLIENTS.
 * ===========================================================================
 *
 * `display_name` STOPPED BEING ALWAYS-NULL ON 2026-09-07. This comment used to
 * say it was null forever because `control-plane/0002_organization.sql` declined
 * a name column and the organization-structure slice owned it — a sentence that
 * pointed a reader at a slice that never happened.
 * `organization-identity-v1` owns the field now and there is a route that sets
 * it. Null is what is left: businesses onboarded before the field existed, and
 * — while the name is optional on the onboarding write path — businesses whose
 * operator did not have one to hand.
 *
 * `platform-route-handlers.ts` makes the rendering rule explicit and binding,
 * and it is UNCHANGED by names arriving:
 *
 *   "BOTH CLIENTS MUST RENDER THE IDENTIFIER VERBATIM when it is null — not a
 *    blank, not a dash, not 'Unnamed Organization'."
 *
 * SO THERE IS NO PLACEHOLDER IN THIS FILE. Inventing "Organization 1" here and
 * something else on iPhone is precisely the divergence the one-contract rule
 * exists to prevent, and an invented name is indistinguishable from a typed one
 * forever.
 *
 * ---------------------------------------------------------------------------
 * AND THE IDENTIFIER STAYS ON SCREEN EVEN WHEN THERE IS A NAME
 * ---------------------------------------------------------------------------
 *
 * *** `display_name` IS NOT UNIQUE AND NOTHING IN DUDO ENFORCES UNIQUENESS ON
 * IT. *** The contract is explicit: "two Organizations legitimately share a name
 * in one market, and a platform-wide constraint would make one customer's choice
 * refuse another's."
 *
 * So a list showing names alone would render two different businesses
 * identically, on the screen an operator uses to choose which customer to act
 * on. The name is the label; the identifier is the identity, and both are shown.
 *
 * THE REGISTRATIONS ARE DELIBERATELY NOT COLUMNS HERE. "Two objects per row
 * inflate every page of a listing that needs a label, and the detail route is
 * one click away."
 *
 * ===========================================================================
 * PAGINATION IS FORWARD-ONLY, AND THE CURSOR IS OPAQUE
 * ===========================================================================
 *
 * Keyset pagination with an opaque `next_cursor` the client never constructs,
 * parses or modifies. There is no page number and no "previous", because a
 * keyset cursor gives neither — offering them would mean inventing them.
 *
 * THE CURSOR IS BOUND TO THE PRINCIPAL AND THE QUERY SHAPE (schema, corrected
 * 2026-09-05), so it is not transferable between operators and not reusable at a
 * different page size. Changing the page size therefore RESTARTS the
 * enumeration rather than resuming it, and this screen does that explicitly
 * rather than sending a cursor Core would reject.
 *
 * EVERY PAGE IS AN AUDITED CALL. `platform-audit.ts` records the read because
 * enumerating every Organization "is the reconnaissance step before a targeted
 * action". So pages are fetched when a person asks — no prefetch, no infinite
 * scroll firing requests on scroll position.
 */

import { useCallback, useState, type ReactNode } from 'react';
import { Button } from '@dudo/ui';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PermissionDeniedBlock,
} from '@/components/StateBlock';
import { OnboardOrganization } from '@/screens/OnboardOrganization';
import { cn } from '@dudo/ui';
import { Link } from '@tanstack/react-router';
import { useOrganizationList } from '@/lib/queries';
import {
  fill,
  formatCount,
  useLocale,
  useT,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';

/* "Showing N Organizations" — six forms in Arabic, chosen by `Intl`. */
const SHOWING_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'organizations.showing.zero',
  one: 'organizations.showing.one',
  two: 'organizations.showing.two',
  few: 'organizations.showing.few',
  many: 'organizations.showing.many',
  other: 'organizations.showing.other',
};
import { isKnownStatus, type ListOrganizationsOutput } from '@/api/platform';
import { type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListOrganizationsOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function Organizations() {
  const { locale, t } = useLocale();
  /** The cursor for the page currently being shown. `null` is the first page. */
  const [cursor, setCursor] = useState<string | null>(null);
  /** How many pages deep, for a position line. Not a page number from Core. */
  const [depth, setDepth] = useState(1);

  /*
   * THE READ IS A QUERY, AND THE `nonce` IS GONE.
   *
   * `Load` is derived rather than stored — a parallel copy in `useState` is how
   * the two drift. `isFetching` rather than `isPending` is what reproduces the
   * previous screen: the effect set `{ kind: 'loading' }` at the top of every
   * run. `lib/queries.ts` records why that equivalence holds on this console —
   * no fetch happens here that an operator did not cause.
   */
  const list = useOrganizationList(cursor);
  const load: Load =
    list.isPending || list.isFetching
      ? { kind: 'loading' }
      : list.error !== null
        ? { kind: 'failed', error: list.error }
        : { kind: 'loaded', page: list.data };

  /* One audited call, the same cost as the nonce bump it replaces. */
  const retry = useCallback(() => {
    void list.refetch();
  }, [list]);

  const restart = useCallback(() => {
    setCursor(null);
    setDepth(1);
  }, []);

  /*
   * After onboarding, return to the first page.
   *
   * BACK TO THE FIRST PAGE RATHER THAN RE-FETCHING THE CURRENT ONE: the cursor
   * is bound to the query and a new row changes what the enumeration contains,
   * so resuming mid-list after an insert shows a page whose meaning has quietly
   * changed.
   *
   * THE `nonce` BUMP THAT USED TO SIT HERE IS GONE, AND THE CASE IT EXISTED FOR
   * IS STILL COVERED. It was here because resetting the cursor is a no-op when
   * the operator is already on the first page — "exactly the common case here" —
   * so nothing would have re-read. `useOnboardOrganization` invalidates the
   * list instead, which does not care whether the cursor changed. **The
   * refresh is now a consequence of the write succeeding rather than something
   * this callback has to remember.**
   */
  const refreshAfterOnboarding = useCallback(() => {
    setCursor(null);
    setDepth(1);
  }, []);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          {t('nav.organizations')}
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          Every Organization on the platform, from the control plane. Name, identifier and status
          — no customer records, no counts and no activity: each of those is a tenant read, and an
          operator is structurally incapable of making one. A business with no name recorded shows
          its identifier, and names are not unique, so the identifier is shown either way.
        </p>
      </header>

      {/*
        ONBOARDING LIVES HERE RATHER THAN IN ITS OWN NAV SECTION. The contract
        calls the Organization list "the console's home screen and the only way
        an operator discovers what exists", and creating one belongs beside
        seeing what exists — the same shape Templates uses. It also keeps the
        navigation at four items, which matters more than it sounds given how
        much trouble that navigation has already caused.
      */}
      <div className="mb-8">
        <OnboardOrganization onOnboarded={refreshAfterOnboarding} />
      </div>

      {load.kind === 'loading' ? <LoadingBlock label={t('loading.organizations')} /> : null}

      {/* `forbidden` before the generic error — a permission boundary is not a
          malfunction, and a blank list would say the platform holds nothing. */}
      {load.kind === 'failed' && load.error.code === 'forbidden' ? (
        <PermissionDeniedBlock error={load.error} />
      ) : null}

      {load.kind === 'failed' && load.error.code !== 'forbidden' ? (
        <ErrorBlock error={load.error} onRetry={retry}>
          {cursor !== null ? (
            <Button variant="secondary" size="sm" className="mt-4 me-2" onClick={restart}>
              {t('page.startAgain')}
            </Button>
          ) : null}
        </ErrorBlock>
      ) : null}

      {/*
        ⚠ THE TITLE BELOW SAID "There are no Organizations YET." **An absence
        claim the absence check could not see either** — that check scans the
        DICTIONARY, and this string was never in one. **A string has to be
        translated before the absence check can look at it**, which makes the
        two instruments' blind spots the same blind spot. Corrected to the fact
        the query returned, as `dashboard.none` was.
      */}
      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={
            cursor === null ? t('organizations.empty.title') : t('page.emptyPage.title')
          }
          body={
            cursor === null ? (
              <>
                {t('organizations.empty.body')}
              </>
            ) : (
              <>{t('page.emptyPage')}</>
            )
          }
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <OrganizationTable page={load.page} />

          <nav
            aria-label={t('a11y.pagination')}
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-[0.8125rem] text-ink-muted">
              {/*
                "Showing N" and not "N of M". The list route returns no total,
                and a keyset cursor cannot produce one — a count would have to be
                invented or fetched from somewhere that does not exist.
              */}
              {formatCount(locale, load.page.data.length, SHOWING_FORMS, t)}
              {depth > 1 ? ` · ${fill(t('audit.page'), locale, { page: depth })}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button variant="secondary" size="sm" onClick={restart}>
                  {t('page.firstPage')}
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
                }}
              >
                {load.page.next_cursor === null ? t('audit.noMorePages') : t('page.next')}
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}

function OrganizationTable({ page }: { page: ListOrganizationsOutput }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <table className="w-full border-collapse">
        <caption className="sr-only">
          {/*
            THE TABLE'S ACCESSIBLE DESCRIPTION. A screen-reader user hears this
            before the rows, so it is the only place the shape of the table is
            announced — not decoration.
          */}
          {t('organizations.tableCaption')}
        </caption>
        <thead>
          <tr>
            <Th>{t('platformAudit.targetColumn')}</Th>
            <Th>{t('column.status')}</Th>
            <Th className="hidden sm:table-cell">{t('column.created')}</Th>
          </tr>
        </thead>
        <tbody>
          {page.data.map((organization) => (
            <tr key={organization.organization_id} className="border-t border-line align-top">
              <td className="px-4 py-3">
                {/*
                  THE NAME IS THE LINK WHEN THERE IS ONE; THE IDENTIFIER IS THE
                  LINK WHEN THERE IS NOT — verbatim, never a placeholder. And
                  the identifier is shown either way, because names are not
                  unique: two businesses may legitimately share one, and this is
                  the screen where an operator picks which customer to act on.

                  `break-all` because a 22-character opaque token is one
                  unbreakable word and would otherwise widen the page on a phone;
                  a name is ordinary text and breaks on words.

                  A REAL ANCHOR, NOT A CLICKABLE ROW. It can be opened in a new
                  tab, copied, and reached by keyboard in the ordinary way — a
                  `<tr onClick>` gives none of that and is invisible to a screen
                  reader.
                */}
                <Link
                  to="/organizations/$organizationId"
                  params={{ organizationId: organization.organization_id }}
                  className={cn(
                    'text-[0.8125rem] font-semibold text-navy-600 no-underline hover:underline',
                    organization.display_name === null
                      ? 'font-mono break-all'
                      : 'text-[0.9375rem] break-words',
                  )}
                >
                  {organization.display_name ?? organization.organization_id}
                </Link>
                {organization.display_name !== null ? (
                  <span className="mt-0.5 block font-mono text-xs break-all text-ink-muted">
                    {organization.organization_id}
                  </span>
                ) : null}
                {/* The date, on phones, where its own column is hidden. */}
                <span className="mt-1 block text-xs text-ink-muted sm:hidden">
                  {t('column.createdOn')} <CreatedAt value={organization.created_at} />
                </span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={organization.status} />
              </td>
              <td className="hidden px-4 py-3 text-[0.8125rem] text-ink-muted sm:table-cell">
                <CreatedAt value={organization.created_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'bg-sunk px-4 py-3 text-start text-xs font-bold tracking-[0.06em] uppercase text-ink-muted',
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * The status, rendered from a string this client did not narrow.
 *
 * An unrecognised value is shown VERBATIM and styled neutrally rather than being
 * hidden or mapped onto "active". The schema says Core never emits one — but if
 * that ever failed, showing the real value is recoverable and quietly showing
 * the wrong one is not.
 */
function StatusBadge({ status }: { status: string }) {
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

/**
 * The creation timestamp.
 *
 * RFC 3339 UTC from Core, rendered in the reader's own locale and timezone with
 * the machine-readable original kept in `dateTime` and the title. AN OPERATOR
 * COMPARING WHAT THEY SEE TO AN AUDIT RECORD NEEDS THE ORIGINAL, and a
 * localised string alone loses it.
 *
 * A value that does not parse is shown verbatim rather than as "Invalid Date".
 */
/* The locale was `undefined` — the browser's. See `Templates.tsx`'s `CreatedAt`. */
function CreatedAt({ value }: { value: string }) {
  const { locale } = useLocale();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono text-xs">{value}</bdi>;
  }
  return (
    <time dateTime={value} title={value}>
      <bdi>
        {parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
      </bdi>
    </time>
  );
}
