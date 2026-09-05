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
 * `display_name` is always `null` today: `control-plane/0002_organization.sql`
 * declined a name column because the organization-structure slice owns it. So
 * this screen is a list of 22-character opaque identifiers, which the contract
 * itself calls "not a usable administrative interface" (PO-3) — and it is stated
 * as a product dependency rather than something to paper over here.
 *
 * `platform-route-handlers.ts` makes the rendering rule explicit and binding:
 *
 *   "BOTH CLIENTS MUST RENDER THE IDENTIFIER VERBATIM when it is null — not a
 *    blank, not a dash, not 'Unnamed Organization'."
 *
 * SO THERE IS NO PLACEHOLDER IN THIS FILE. Inventing "Organization 1" here and
 * something else on iPhone is precisely the divergence the one-contract rule
 * exists to prevent, and it would also be fabricated data on the one surface ADR
 * 0010 forbids it hardest.
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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { OnboardOrganization } from '@/screens/OnboardOrganization';
import { cn } from '@/lib/cn';
import {
  PLATFORM_DEFAULT_PAGE_SIZE,
  isKnownStatus,
  type ListOrganizationsOutput,
  type PlatformClient,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListOrganizationsOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function Organizations({ platform }: { platform: PlatformClient }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  /** The cursor for the page currently being shown. `null` is the first page. */
  const [cursor, setCursor] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  /** How many pages deep, for a position line. Not a page number from Core. */
  const [depth, setDepth] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform
      .listOrganizations({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor })
      .then(
        (page) => {
          if (!cancelled) setLoad({ kind: 'loaded', page });
        },
        (thrown: unknown) => {
          if (!cancelled) setLoad({ kind: 'failed', error: toApiError(thrown) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [platform, cursor, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const restart = useCallback(() => {
    setCursor(null);
    setDepth(1);
  }, []);

  /*
   * After onboarding, return to the first page and re-fetch.
   *
   * BACK TO THE FIRST PAGE RATHER THAN RE-FETCHING THE CURRENT ONE: the cursor
   * is bound to the query and a new row changes what the enumeration contains,
   * so resuming mid-list after an insert shows a page whose meaning has quietly
   * changed. `nonce` is bumped as well because `restart` alone is a no-op when
   * the operator is already on the first page — and that is exactly the common
   * case here.
   */
  const refreshAfterOnboarding = useCallback(() => {
    setCursor(null);
    setDepth(1);
    setNonce((value) => value + 1);
  }, []);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          Organizations
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          Every Organization on the platform, from the control plane. Identifiers and status only
          — no customer records, no counts and no activity: each of those is a tenant read, and an
          operator is structurally incapable of making one.
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
        <OnboardOrganization platform={platform} onOnboarded={refreshAfterOnboarding} />
      </div>

      {load.kind === 'loading' ? <LoadingBlock label="Asking Core for the Organizations…" /> : null}

      {load.kind === 'failed' ? (
        <ErrorBlock error={load.error} onRetry={retry}>
          {cursor !== null ? (
            <Button variant="secondary" size="sm" className="mt-4 me-2" onClick={restart}>
              Start again from the first page
            </Button>
          ) : null}
        </ErrorBlock>
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={cursor === null ? 'There are no Organizations yet.' : 'No more Organizations.'}
          body={
            cursor === null ? (
              <>
                Core answered, and the platform has none. This is not a failure to load — when an
                Organization is onboarded it appears here.
              </>
            ) : (
              <>
                Core answered, and this page is empty. Start again from the first page to see the
                current list.
              </>
            )
          }
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <OrganizationTable page={load.page} />

          <nav
            aria-label="Pagination"
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-[0.8125rem] text-ink-muted">
              {/*
                "Showing N" and not "N of M". The list route returns no total,
                and a keyset cursor cannot produce one — a count would have to be
                invented or fetched from somewhere that does not exist.
              */}
              Showing {load.page.data.length}{' '}
              {load.page.data.length === 1 ? 'Organization' : 'Organizations'}
              {depth > 1 ? ` · page ${String(depth)}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button variant="secondary" size="sm" onClick={restart}>
                  First page
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
                {load.page.next_cursor === null ? 'No more pages' : 'Next page'}
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}

function OrganizationTable({ page }: { page: ListOrganizationsOutput }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <table className="w-full border-collapse">
        <caption className="sr-only">
          Organizations on the platform, with their identifier, status and creation date.
        </caption>
        <thead>
          <tr>
            <Th>Organization</Th>
            <Th>Status</Th>
            <Th className="hidden sm:table-cell">Created</Th>
          </tr>
        </thead>
        <tbody>
          {page.data.map((organization) => (
            <tr key={organization.organization_id} className="border-t border-line align-top">
              <td className="px-4 py-3">
                {/*
                  VERBATIM. `display_name` is always null today, and the handler
                  binds both clients to render the identifier itself rather than
                  a placeholder. `break-all` because a 22-character opaque token
                  is one unbreakable word and would otherwise widen the page on a
                  phone.
                */}
                <span className="font-mono text-[0.8125rem] break-all text-ink">
                  {organization.display_name ?? organization.organization_id}
                </span>
                {/* The date, on phones, where its own column is hidden. */}
                <span className="mt-1 block text-xs text-ink-muted sm:hidden">
                  Created <CreatedAt value={organization.created_at} />
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
function CreatedAt({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono text-xs">{value}</span>;
  }
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
