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

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { AuditRecordList } from '@/components/AuditRecordList';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { buildHash, organizationDetailPath } from '@/lib/router';
import {
  PLATFORM_DEFAULT_PAGE_SIZE,
  toUtcDayEnd,
  toUtcDayStart,
  type OrganizationFeedFilters,
  type OrganizationFeedOutput,
  type PlatformClient,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

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

export function OrganizationAudit({
  platform,
  organizationId,
}: {
  platform: PlatformClient;
  organizationId: string;
}) {
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
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<OrganizationFeedFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [requests, setRequests] = useState(0);
  /** Incremented only by an explicit press. Nothing else triggers a fetch. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (nonce === 0) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform
      .listOrganizationAudit(organizationId, {
        pageSize: PLATFORM_DEFAULT_PAGE_SIZE,
        cursor,
        filters: applied,
      })
      .then(
        (page) => {
          if (cancelled) return;
          setLoad({ kind: 'loaded', page });
          setRequests((value) => value + 1);
        },
        (thrown: unknown) => {
          if (cancelled) return;
          setLoad({ kind: 'failed', error: toApiError(thrown) });
          // A refused request still consumed the attempt from the operator's
          // point of view; counting it keeps the tally honest rather than
          // flattering.
          setRequests((value) => value + 1);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [platform, organizationId, cursor, applied, nonce]);

  const read = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  /* A cursor is bound to the query shape, so a filter change resets it. */
  const applyFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Mutable while being assembled. NOTE THERE IS NO `actor_principal_id`
      // HERE — the Organization feed does not accept one, and the type has no
      // member for it.
      const next: { action_id?: string; since?: string; until?: string } = {};
      if (draft.action.trim() !== '') next.action_id = draft.action.trim();
      const since = toUtcDayStart(draft.since);
      const until = toUtcDayEnd(draft.until);
      if (since !== null) next.since = since;
      if (until !== null) next.until = until;
      setApplied(next);
      setCursor(null);
      setDepth(1);
      setNonce((value) => value + 1);
    },
    [draft],
  );

  const filtered = Object.keys(applied).length > 0;

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <a
        href={buildHash(organizationDetailPath(organizationId))}
        className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
      >
        &larr; Back to this Organization
      </a>

      <h1 id="section-heading" className="mt-3 text-xl font-bold text-ink sm:text-2xl">
        Audit trail
      </h1>
      <p className="mt-1 font-mono text-[0.8125rem] break-all text-ink-muted">{organizationId}</p>

      <p className="mt-3 max-w-prose leading-relaxed text-ink-muted">
        Every platform-operator action affecting this business, newest first — including which
        person each action named.
      </p>

      {/*
        THE COST, STATED BEFORE THE OPERATOR SPENDS IT rather than after. This
        is the only screen in the console that charges a customer to be looked
        at, and an operator who does not know that will page through it idly.
      */}
      <p className="mt-4 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
        <span className="font-semibold">Reading this writes to it.</span> Each page costs five
        writes from this business&rsquo;s own daily allowance, and leaves a record in their trail
        saying the platform read it. That is deliberate — the customer should be able to see that
        they were looked at. It also means you will find your own earlier visits here, and that
        nothing on this screen refreshes on its own.
      </p>

      <form
        onSubmit={applyFilters}
        className="mt-6 grid gap-4 rounded-[12px] border border-line bg-surface p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="org-filter-action" label="Action" hint="An action id.">
            {(aria) => (
              <Input
                {...aria}
                value={draft.action}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, action: event.target.value }));
                }}
                placeholder="platform.credentials.reset"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field id="org-filter-since" label="From (UTC)" hint="Whole days, in UTC.">
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
          <Field id="org-filter-until" label="To (UTC)" hint="Inclusive.">
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

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary">
            {load.kind === 'idle' ? 'Read the trail' : 'Apply filters and read'}
          </Button>
          {requests > 0 ? (
            <p className="text-[0.8125rem] text-ink-muted">
              {requests} {requests === 1 ? 'read' : 'reads'} this visit
            </p>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        {load.kind === 'idle' ? (
          <EmptyBlock
            title="Nothing has been read yet."
            body={
              <>
                This screen does not load on its own, because opening it would spend the
                customer&rsquo;s allowance. Press{' '}
                <span className="font-semibold">Read the trail</span> when you need it.
              </>
            }
          />
        ) : null}

        {load.kind === 'loading' ? <LoadingBlock label="Reading this business's trail…" /> : null}

        {load.kind === 'failed' ? (
          isCeilingCode(load.error.code) ? (
            /*
              THE TWO CEILINGS MEAN OPPOSITE THINGS HERE and are rendered as
              different statements: `rate_limited` is about operator activity
              against this customer, `quota_exceeded` is about the customer's own
              allocation. Merging them would produce a retry, which is the
              behaviour the ceilings exist to stop.
            */
            <CeilingNotice error={load.error} scope="organization" onRetry={read} />
          ) : (
            <ErrorBlock error={load.error} onRetry={read}>
              {load.error.code === 'not_found' ? (
                <p className="mt-2 leading-relaxed text-ink-soft">
                  No Organization has this identifier.
                </p>
              ) : null}
            </ErrorBlock>
          )
        ) : null}

        {load.kind === 'loaded' && load.page.data.length === 0 ? (
          <EmptyBlock
            title={filtered ? 'No records match those filters.' : 'Nothing has happened here.'}
            body={
              filtered ? (
                <>Core answered, and nothing in this trail matches.</>
              ) : (
                <>
                  Core answered, and the platform has taken no recorded action against this
                  business. This read is now itself in the trail.
                </>
              )
            }
          />
        ) : null}

        {load.kind === 'loaded' && load.page.data.length > 0 ? (
          <>
            <AuditRecordList
              records={load.page.data}
              targetHeading="Person"
              /*
                THIS FEED'S EXTRA COLUMN. The closure holds an
                `OrganizationFeedRecord`, which is the only record type that has
                a principal target — the platform feed's type has no such
                property, so that screen could not pass this callback.
              */
              renderTarget={(record) =>
                record.target_principal_id ?? (
                  <span className="font-sans text-ink-muted">none</span>
                )
              }
            />

            <nav
              aria-label="Pagination"
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-[0.8125rem] text-ink-muted">
                Showing {load.page.data.length}{' '}
                {load.page.data.length === 1 ? 'record' : 'records'}
                {depth > 1 ? ` · page ${String(depth)}` : null}
              </p>
              <div className="flex gap-2">
                {cursor !== null ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCursor(null);
                      setDepth(1);
                      setNonce((value) => value + 1);
                    }}
                  >
                    Newest
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
                    setNonce((value) => value + 1);
                  }}
                >
                  {load.page.next_cursor === null ? 'No more pages' : 'Older'}
                </Button>
              </div>
            </nav>
            <p className="mt-2 text-[0.8125rem] text-ink-muted">
              Each page is another five writes against this business.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
