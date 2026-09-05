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

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { AuditRecordList } from '@/components/AuditRecordList';
import { EmptyBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { ErrorBlock } from '@/components/StateBlock';
import {
  PLATFORM_DEFAULT_PAGE_SIZE,
  toUtcDayEnd,
  toUtcDayStart,
  type PlatformFeedFilters,
  type PlatformFeedOutput,
  type PlatformClient,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

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

export function PlatformAudit({ platform }: { platform: PlatformClient }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  /** The filters actually in force. Changing them resets the cursor. */
  const [applied, setApplied] = useState<PlatformFeedFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform
      .listPlatformAudit({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor, filters: applied })
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
    // No interval, no focus listener, no reconnect listener. `nonce` moves only
    // when a person presses Refresh.
  }, [platform, cursor, applied, nonce]);

  /*
   * A CURSOR IS BOUND TO THE QUERY SHAPE, so changing a filter invalidates it.
   * Core would refuse a carried-forward cursor; the correct client behaviour is
   * not to send it. Applying filters therefore always resets to the first page.
   */
  const applyFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
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
      const until = toUtcDayEnd(draft.until);
      if (since !== null) next.since = since;
      if (until !== null) next.until = until;
      setApplied(next);
      setCursor(null);
      setDepth(1);
    },
    [draft],
  );

  const clearFilters = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setApplied({});
    setCursor(null);
    setDepth(1);
  }, []);

  const filtered = Object.keys(applied).length > 0;

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          Platform audit
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          Every platform-operator action, newest first. Who acted, against which Organization, and
          with what outcome.{' '}
          <span className="font-semibold text-ink-soft">
            It does not say which person an action was about
          </span>{' '}
          — for that, open an Organization and read its own trail, which records that you did.
        </p>
      </header>

      <form
        onSubmit={applyFilters}
        className="mb-6 grid gap-4 rounded-[12px] border border-line bg-surface p-4 sm:p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="filter-actor"
            label="Operator"
            hint="A principal id. Filters by who acted, not by who was acted on."
          >
            {(aria) => (
              <Input
                {...aria}
                value={draft.actor}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, actor: event.target.value }));
                }}
                placeholder="principal id"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <Field id="filter-action" label="Action" hint="An action id, such as platform.audit.list.">
            {(aria) => (
              <Input
                {...aria}
                value={draft.action}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, action: event.target.value }));
                }}
                placeholder="platform.templates.create"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <Field id="filter-since" label="From (UTC)" hint="Whole days, in UTC.">
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

          <Field id="filter-until" label="To (UTC)" hint="Inclusive of the whole day.">
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
          There is deliberately no filter for the person an action was about. Filtering by someone
          and counting the results would reveal which Organizations they belong to, one answer at a
          time — which is exactly what leaving that column out of this feed prevents.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          {filtered ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
          <p className="text-[0.8125rem] text-ink-muted">
            Applying resets to the newest page. Each page read is itself recorded.
          </p>
        </div>
      </form>

      {load.kind === 'loading' ? <LoadingBlock label="Reading the platform log…" /> : null}

      {load.kind === 'failed' ? (
        isCeilingCode(load.error.code) ? (
          <CeilingNotice
            error={load.error}
            scope="platform"
            onRetry={() => {
              setNonce((value) => value + 1);
            }}
          />
        ) : (
          <ErrorBlock
            error={load.error}
            onRetry={() => {
              setNonce((value) => value + 1);
            }}
          />
        )
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={filtered ? 'No records match those filters.' : 'The log is empty.'}
          body={
            filtered ? (
              <>Core answered, and nothing in the log matches. Widen or clear the filters.</>
            ) : (
              <>
                Core answered, and no operator action has been recorded yet. Reading this page is
                itself recorded — so the first entry here will usually be someone reading it.
              </>
            )
          }
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <AuditRecordList
            records={load.page.data}
            targetHeading="Organization"
            /*
              THE ONE COLUMN THAT DIFFERS. This closure holds a
              `PlatformFeedRecord`, which HAS NO `target_principal_id` — so this
              screen cannot render a principal target even by accident, and the
              shared list component never sees one.
            */
            renderTarget={(record) =>
              record.target_organization_id ?? (
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
                  }}
                >
                  Newest
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
                {load.page.next_cursor === null ? 'No more pages' : 'Older'}
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}
