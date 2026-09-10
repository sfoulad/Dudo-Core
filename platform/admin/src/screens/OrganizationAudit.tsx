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
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { WindowOrOtherError } from '@/components/WindowRefusal';
import {
  MAX_WINDOW_DAYS,
  describeWindow,
  shiftWindowByOwnLength,
  windowIsRequired,
  windowRefusal,
  type WindowDraft,
} from '@/api/audit-window';
import { Link } from '@tanstack/react-router';
import { useOrganizationAuditRead } from '@/lib/queries';
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

export function OrganizationAudit({ organizationId }: { organizationId: string }) {
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
  const [windowError, setWindowError] = useState<string | null>(null);

  const appliedWindow = appliedWindowDraft === null ? null : describeWindow(appliedWindowDraft);
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
        Back to this Organization
      </Link>

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

        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          Filtering by action needs a date range of at most {MAX_WINDOW_DAYS} days. Reading this
          business&rsquo;s whole trail needs no range.
        </p>

        {windowError !== null ? (
          <p
            role="alert"
            className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem] leading-relaxed text-ink"
          >
            {windowError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary">
            {load.kind === 'idle' ? 'Read the trail' : 'Apply filters and read'}
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
                Earlier window
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  shiftWindow(1);
                }}
              >
                Later window
              </Button>
            </>
          ) : null}
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
          ) : load.error.code === 'not_found' ? (
            <ErrorBlock error={load.error} onRetry={read}>
              <p className="mt-2 leading-relaxed text-ink-soft">
                No Organization has this identifier.
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
                ? 'No records in this window.'
                : filtered
                  ? 'No records match those filters.'
                  : 'Nothing has happened here.'
            }
            body={
              appliedWindow !== null ? (
                <>
                  Core answered, and nothing in this business&rsquo;s trail matches{' '}
                  <span className="font-semibold text-ink">within {appliedWindow}</span>. Records
                  outside this range were not searched, so this says nothing about any other
                  period.
                </>
              ) : filtered ? (
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
                      fire(null, applied);
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
                    // The new cursor is passed straight through — `setCursor`
                    // has not landed, and sending the old one would re-read the
                    // page already on screen at the customer's expense.
                    fire(load.page.next_cursor, applied);
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
