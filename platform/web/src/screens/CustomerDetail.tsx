/**
 * One customer's full record — all fifteen fields.
 *
 * WHAT IS NOT ON THIS SCREEN, AND WHY. There is no Delete control and no "cancel
 * deletion" control. DeleteCustomer and RestoreDeletedCustomer are contracted
 * and deliberately out of scope for this slice (contract §11.1), so the platform
 * would refuse them. An interface that offers an action the platform refuses is
 * worse than one that omits it, and their absence here is the decision rather
 * than an oversight. The client has no method for either, so adding one would
 * not compile.
 *
 * The archive and restore controls follow the state machine exactly: archive
 * only from `active`, restore only from `archived`, and `pending_deletion` — a
 * state nothing in this slice can produce — renders as a read-only record with
 * its deadline, because a client must tolerate a status it will never see.
 *
 * Whether a person may actually perform either action is decided by Core on the
 * call. Hiding a button is presentation, never security.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants, Panel, Skeleton, toast } from '@dudo/ui';
import { StatusBadge, TypeTag } from '@/components/CustomerBadges';
import { ErrorBlock } from '@/components/ErrorBlock';
import { countryLabel, formatDate, formatTimestamp, statusLabel } from '@/contracts/format';
import { toApiError } from '@/api/errors';
import { businessLabel } from '@/contracts/business-read';
import { getLastListSearch } from '@/lib/last-list';
import type { CustomerListSearch } from '@/routes/customer-list-search';
import { useBusinessReference, useCustomer, useCustomerTransition } from '@/lib/queries';

export function CustomerDetail({ customerId }: { customerId: string }) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const customerQuery = useCustomer(customerId);
  const customer = customerQuery.data ?? null;
  const archive = useCustomerTransition('archive');
  const restore = useCustomerTransition('restore');
  const pendingAction = archive.isPending ? 'archive' : restore.isPending ? 'restore' : null;

  /*
   * One record needs one Business name, so this screen uses
   * ResolveBusinessReferences rather than fetching the caller's whole authorized
   * set — which is the case that Action exists for. A failure resolves to `null`
   * inside the query and the identifier is shown instead: a name that will not
   * load must not take down a record the person can otherwise read in full.
   */
  const businessRef = useBusinessReference(customer?.business_id).data ?? null;

  useEffect(() => {
    document.title = customer
      ? `${customer.display_name} · Dudo`
      : customerQuery.error
        ? 'Customer not available · Dudo'
        : 'Customer · Dudo';
  }, [customer, customerQuery.error]);

  // A record that reloaded is a record whose state may have moved; an
  // in-progress confirmation for the state it used to be in is withdrawn.
  useEffect(() => {
    setConfirmingArchive(false);
  }, [customerId]);

  useEffect(() => {
    if (confirmingArchive) confirmRef.current?.focus();
  }, [confirmingArchive]);

  function runTransition(kind: 'archive' | 'restore') {
    if (!customer) return;
    const mutation = kind === 'archive' ? archive : restore;
    mutation.mutate(customer.customer_id, {
      onSuccess: (updated) => {
        setConfirmingArchive(false);
        toast(
          kind === 'archive'
            ? `${updated.display_name} is archived.`
            : `${updated.display_name} is active again.`,
        );
      },
      onError: (failure) => {
        if (failure.code === 'failed_precondition') {
          // The record moved on since the page was loaded. Re-read rather than
          // argue with the server about what state it is in.
          toast(failure.message || 'That is no longer possible for this customer.', 'error');
          void customerQuery.refetch();
          return;
        }
        toast(failure.message || 'That could not be completed.', 'error');
        setConfirmingArchive(false);
      },
    });
  }

  const backSearch = getLastListSearch();

  if (customerQuery.isPending) {
    return (
      <div>
        <BackLink search={backSearch} />
        <Skeleton className="h-6 w-56" />
      </div>
    );
  }

  if (customerQuery.error || !customer) {
    return (
      <div>
        <BackLink search={backSearch} />
        <Panel>
          <ErrorBlock
            error={customerQuery.error ?? toApiError(null)}
            onRetry={() => void customerQuery.refetch()}
            extraActions={
              <Link to="/customers" search={backSearch} className={buttonVariants()}>
                Back to customers
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const businessName = businessRef
    ? businessLabel(businessRef)
    : // Not yet resolved, or unresolved. Either way the identifier is the honest
      // rendering; a client must never infer existence from a name.
      customer.business_id;

  return (
    <div>
      <BackLink search={backSearch} />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl leading-tight tracking-[-0.01em] text-navy-800 [overflow-wrap:anywhere]">
            {customer.display_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={customer.status} />
            <TypeTag type={customer.customer_type} />
            <span className="text-ink-muted">{businessName}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {customer.status === 'active' && !confirmingArchive ? (
            <>
              <Link
                to="/customers/$customerId/edit"
                params={{ customerId: customer.customer_id }}
                className={buttonVariants()}
              >
                Edit
              </Link>
              <Button onClick={() => setConfirmingArchive(true)}>Archive</Button>
            </>
          ) : null}

          {customer.status === 'active' && confirmingArchive ? (
            // The confirmation happens in place rather than in a dialog: nothing
            // is trapped, Escape and Cancel both back out, and focus moves to
            // the confirming control so a keyboard user is not left pressing a
            // button that has moved.
            <div
              role="group"
              aria-label="Confirm archiving this customer"
              className="flex flex-wrap items-center gap-2"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setConfirmingArchive(false);
                }
              }}
            >
              <span className="text-[0.8125rem] text-ink-muted">Archive this customer?</span>
              <Button
                ref={confirmRef}
                variant="primary"
                busy={pendingAction === 'archive'}
                disabled={pendingAction !== null}
                onClick={() => runTransition('archive')}
              >
                {pendingAction === 'archive' ? 'Archiving…' : 'Yes, archive'}
              </Button>
              <Button disabled={pendingAction !== null} onClick={() => setConfirmingArchive(false)}>
                Cancel
              </Button>
            </div>
          ) : null}

          {customer.status === 'archived' ? (
            <Button
              variant="primary"
              busy={pendingAction === 'restore'}
              disabled={pendingAction !== null}
              onClick={() => runTransition('restore')}
            >
              {pendingAction === 'restore' ? 'Restoring…' : 'Restore'}
            </Button>
          ) : null}

          {/* pending_deletion, or any status this client has not been taught: no
              action is offered, because none this slice implements is legal from
              here. */}
        </div>
      </div>

      {customer.status === 'archived' ? (
        <Notice tone="archived">
          <strong>Archived.</strong> This customer is withdrawn from everyday use and is kept
          indefinitely. Archiving starts no countdown and deletes nothing. Restore it to edit it
          again.
        </Notice>
      ) : null}

      {customer.status === 'pending_deletion' ? (
        <Notice tone="pending">
          <strong>Deletion requested.</strong>{' '}
          {formatDate(customer.deletion_scheduled_at)
            ? `This customer's details are scheduled to be permanently destroyed on ${formatDate(customer.deletion_scheduled_at)}.`
            : 'This customer is scheduled for permanent deletion.'}
        </Notice>
      ) : null}

      <div className="grid gap-5">
        <Section title="Contact">
          {/* `dir="ltr"` on the contact values is required, not decorative: a
              phone number begins with a neutral "+", so in an RTL document the
              bidi algorithm reorders the groups and "+973 3901 2244" displays as
              "2244 3901 973+". Verified by rendering with dir="rtl". */}
          <FieldRow label="Email address">
            {customer.email ? (
              <a dir="ltr" href={`mailto:${customer.email}`}>
                {customer.email}
              </a>
            ) : null}
          </FieldRow>
          <FieldRow label="Phone">
            {customer.phone ? (
              <a dir="ltr" href={`tel:${customer.phone.replace(/[^\d+]/g, '')}`}>
                {customer.phone}
              </a>
            ) : null}
          </FieldRow>
          <FieldRow label="Country">{countryLabel(customer.country)}</FieldRow>
          <FieldRow label="Address" wide multiline>
            {customer.address}
          </FieldRow>
        </Section>

        <Section title="Notes">
          <FieldRow label="Notes" wide multiline hideLabel>
            {customer.notes}
          </FieldRow>
        </Section>

        <Section title="Filing">
          <FieldRow label="Business">{businessName}</FieldRow>
          <FieldRow label="Business identifier" mono>
            {customer.business_id}
          </FieldRow>
        </Section>

        <Section title="Record">
          <FieldRow label="Customer identifier" mono>
            {customer.customer_id}
          </FieldRow>
          <FieldRow label="Status">{statusLabel(customer.status)}</FieldRow>
          <FieldRow label="Created">
            <Meta when={formatTimestamp(customer.created_at)} who={customer.created_by_principal_id} />
          </FieldRow>
          <FieldRow label="Last updated">
            <Meta when={formatTimestamp(customer.updated_at)} who={customer.updated_by_principal_id} />
          </FieldRow>
          {customer.deletion_scheduled_at ? (
            <FieldRow label="Scheduled for deletion">
              {formatTimestamp(customer.deletion_scheduled_at)}
            </FieldRow>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function Meta({ when, who }: { when: string | null; who: string }) {
  if (!when) return null;
  return (
    <>
      <span>{when}</span>
      <span className="font-mono text-[0.8125rem] text-ink-soft"> by {who}</span>
    </>
  );
}

function BackLink({ search }: { search: CustomerListSearch }) {
  return (
    <Link
      to="/customers"
      search={search}
      className="mb-4 inline-flex items-center gap-2 rounded-sm text-[0.8125rem] font-semibold text-ink-muted no-underline hover:text-navy-700"
    >
      <span aria-hidden="true" className="text-base leading-none rtl:rotate-180">
        ←
      </span>
      Customers
    </Link>
  );
}

function Notice({ tone, children }: { tone: 'archived' | 'pending'; children: ReactNode }) {
  return (
    <div
      className={
        tone === 'archived'
          ? 'mb-5 flex gap-3 rounded-[7px] border border-[#f0e2b8] border-s-[3px] border-s-gold-500 bg-gold-50 px-4 py-3 text-gold-700'
          : 'mb-5 flex gap-3 rounded-[7px] border border-[#f6d6d4] border-s-[3px] border-s-scarlet-500 bg-scarlet-50 px-4 py-3 text-scarlet-700'
      }
    >
      <p>{children}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="border-b border-line bg-sunk px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">{title}</h2>
      </div>
      <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * An optional field the tenant has not filled in is present and null on the
 * wire, and is shown here as an explicit "Not recorded" rather than as a blank.
 * A blank cell is indistinguishable from a rendering bug.
 */
function FieldRow({
  label,
  children,
  wide,
  multiline,
  mono,
  hideLabel,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  multiline?: boolean;
  mono?: boolean;
  hideLabel?: boolean;
}) {
  const empty = children === null || children === undefined || children === '';

  return (
    <div className={wide ? 'sm:col-span-full' : undefined}>
      {hideLabel ? (
        <span className="sr-only">{label}</span>
      ) : (
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.05em] text-ink-muted">{label}</p>
      )}
      <p
        className={[
          'text-ink [overflow-wrap:anywhere] [&_a]:text-navy-600 [&_a]:no-underline hover:[&_a]:underline hover:[&_a]:underline-offset-2',
          multiline ? 'whitespace-pre-wrap leading-relaxed' : '',
          mono ? 'font-mono text-[0.8125rem] text-ink-soft' : '',
          empty ? 'italic text-ink-faint' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {empty ? 'Not recorded' : children}
      </p>
    </div>
  );
}
