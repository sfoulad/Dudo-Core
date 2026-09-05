/**
 * The seven fields both audit feeds share, rendered once.
 *
 * ===========================================================================
 * IT IS PARAMETERISED BY LAYOUT, NEVER BY SCOPE, AND IT CANNOT REACH A FIELD
 * ITS CALLER DID NOT HAND IT.
 * ===========================================================================
 *
 * The obvious way to build two feeds is one component that takes a scope and
 * renders whatever it is given. **That is refused here.** Two routes exist
 * precisely so the disclosure lives in the path where a reviewer looks, rather
 * than in an `if` inside a component — and a component that branched on scope
 * would move the security property back into exactly that `if`.
 *
 * WHAT THIS COMPONENT ACTUALLY RECEIVES is `AuditRecordCommon` — the seven
 * fields with NEITHER target field on them — plus a `renderTarget` callback the
 * caller supplies. So:
 *
 *   - It has no `target_principal_id` to render, on any feed, because
 *     `AuditRecordCommon` does not carry one.
 *   - It cannot be made to render one by passing a different flag, because
 *     there is no flag.
 *   - The platform screen's callback closes over a `PlatformFeedRecord`, whose
 *     type has no principal target at all; the Organization screen's closes
 *     over an `OrganizationFeedRecord`, which does. **Neither screen can supply
 *     the other's field, and this file cannot ask for it.**
 *
 * That is the same shape the refusal state on `OrganizationDetail` uses: the
 * value is not withheld by a rule, it is absent from the type, so nothing
 * downstream *can* branch on it.
 *
 * ===========================================================================
 * WHAT AN AUDIT ROW MAY CONTAIN, AND WHY THIS FILE RENDERS SO LITTLE
 * ===========================================================================
 *
 * `0025` Decision 5 permits the operation and its target identifiers and
 * NOTHING ELSE, "because an operator log that accumulates customer data is a
 * second copy of the tenant database with weaker access rules." So there is no
 * diff column, no before/after, no field value, no Organization name and no
 * Template name here — not because they were left out of the layout, but
 * because they are not in the record and must never be.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isKnownAuditOutcome, isKnownPlatformRole, type AuditRecordCommon } from '@/api/platform';

export interface AuditRecordListProps<T extends AuditRecordCommon> {
  readonly records: readonly T[];
  /**
   * The one column that differs between the feeds.
   *
   * A CALLBACK RATHER THAN A FIELD NAME, so this component never holds the
   * value and never learns which feed it is drawing. The caller passes a node;
   * this file positions it.
   */
  readonly renderTarget: (record: T) => ReactNode;
  /** The heading over that column. "Organization" or "Principal". */
  readonly targetHeading: string;
}

export function AuditRecordList<T extends AuditRecordCommon>({
  records,
  renderTarget,
  targetHeading,
}: AuditRecordListProps<T>) {
  return (
    <ul className="grid gap-3">
      {records.map((record) => (
        <li
          key={record.record_id}
          className="rounded-[12px] border border-line bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              {/*
                The action, as a stable token. `action_id` is deliberately never
                a human sentence — "a log a machine cannot group is a log nobody
                can review" — so it is rendered verbatim in monospace rather
                than prettified into prose that would differ between clients.
              */}
              <p className="font-mono text-[0.875rem] font-semibold break-all text-ink">
                {record.action_id}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                <OccurredAt value={record.occurred_at} />
              </p>
            </div>
            <OutcomeBadge outcome={record.outcome} />
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-3 text-[0.8125rem] sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
                Operator
              </dt>
              {/*
                VERBATIM AND NOT TRUNCATED. A 22-character opaque identifier is
                all there is — no names exist anywhere (OD-4/PO-3/OP-3) — and a
                shortened one is unusable for the support conversation this log
                exists to serve.
              */}
              <dd className="font-mono break-all text-ink">{record.actor_principal_id}</dd>
              <dd className="text-ink-muted">
                {record.actor_platform_role}
                {!isKnownPlatformRole(record.actor_platform_role) ? (
                  <span className="sr-only"> (an unrecognised role)</span>
                ) : null}
                <span className="ms-1 text-ink-faint">at the time</span>
              </dd>
            </div>

            <div className="min-w-0">
              <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
                {targetHeading}
              </dt>
              <dd className="font-mono break-all text-ink">{renderTarget(record)}</dd>
            </div>

            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
                Correlation
              </dt>
              {/*
                The only identifier crossing the two audit homes, and what makes
                a two-database trail reconstructable after a partial failure. It
                is the value someone will paste into a search, so it is
                selectable in one click.
              */}
              <dd className="font-mono break-all select-all text-ink-muted">
                {record.correlation_id}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * `succeeded` or `failed`, and nothing else exists.
 *
 * TWO VALUES, NOT A CODE — a reason string "would drift toward describing WHAT
 * went wrong", which `0025` Decision 5 forbids. An unrecognised value renders
 * verbatim and neutrally rather than being mapped onto either.
 *
 * AND `failed` HERE MEANS THE OPERATION FAILED AFTER THE AUTHORITY CHECK. A
 * caller who is not an established operator writes no record at all, so this log
 * contains no evidence of probing by non-operators — a blind spot recorded in
 * `platform-operator-v1`, not solved here, and worth knowing before reading an
 * empty feed as "nobody tried".
 */
function OutcomeBadge({ outcome }: { outcome: string }) {
  const known = isKnownAuditOutcome(outcome);
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        outcome === 'succeeded' && 'bg-green-50 text-green-700',
        outcome === 'failed' && 'bg-scarlet-50 text-scarlet-700',
        !known && 'bg-sunk text-ink-muted',
      )}
    >
      {outcome}
      {!known ? <span className="sr-only"> (an unrecognised outcome)</span> : null}
    </span>
  );
}

/**
 * The timestamp, localised for reading with the RFC 3339 original preserved.
 *
 * An operator correlating this against Core's logs needs the original; a
 * localised string alone loses it. Both are here — `dateTime` and `title` carry
 * the exact value Core sent.
 */
function OccurredAt({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono">{value}</span>;
  }
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </time>
  );
}
