/**
 * Create and edit a customer.
 *
 * One screen serves CreateCustomer and UpdateCustomer, because the fields a
 * client may write are the same seven either way. The differences are exactly
 * the ones the contract states, and they are handled rather than smoothed over:
 *
 *   - `business_id` is REQUIRED on create and is NOT A FIELD on update. Moving a
 *     customer between Businesses is its own Action with its own permission and
 *     its own audit record, so on the edit screen the Business is a read-only
 *     fact with a sentence saying why.
 *   - Update is PARTIAL, and the three-way distinction is normative: absent
 *     means unchanged, a value means set, null means cleared. The form submits
 *     a DIFF against the record it loaded, never the whole form. Sending
 *     everything would look identical on a happy path and silently overwrite a
 *     colleague's concurrent edit on any other.
 *   - Only an ACTIVE customer can be edited. The server refuses otherwise; this
 *     screen refuses to open and says to restore first.
 *
 * Validation here is a courtesy, not a gate. Every rule is a transcription of
 * the schema, the server validates again, and the server's answer is what the
 * person is shown when the two disagree.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, ReadOnlyValue, Select, Textarea } from '@/components/ui/field';
import { ErrorBlock, Panel, Skeleton, StateBlock } from '@/components/StateBlock';
import { toast } from '@/components/Toaster';
import { navigate } from '@/lib/router';
import { getLastListHash } from '@/lib/last-list';
import { toApiError, type ApiError } from '@/api/errors';
import { LIMITS, issueText, validateField } from '@/contracts/field-rules';
import {
  EDITABLE_FIELDS,
  type Customer,
  type CustomerType,
  type EditableField,
  type UpdateCustomerChanges,
} from '@/contracts/customer-directory';
import type { CustomerDirectoryClient } from '@/api/client';
import { makeBusinessLabeller, useAuthorizedBusinesses } from '@/lib/use-businesses';
import { businessLabel } from '@/contracts/business-read';

const LABELS: Record<string, string> = {
  business_id: 'Business',
  display_name: 'Name',
  customer_type: 'Type',
  email: 'Email address',
  phone: 'Phone',
  country: 'Country',
  address: 'Address',
  notes: 'Notes',
};

type FormValues = Record<EditableField | 'business_id', string>;

const EMPTY: FormValues = {
  business_id: '',
  display_name: '',
  customer_type: 'person',
  email: '',
  phone: '',
  country: '',
  address: '',
  notes: '',
};

function valuesFrom(customer: Customer): FormValues {
  return {
    business_id: customer.business_id,
    display_name: customer.display_name,
    customer_type: customer.customer_type,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    country: customer.country ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
  };
}

export function CustomerForm({
  client,
  customerId,
}: {
  client: CustomerDirectoryClient;
  customerId?: string;
}) {
  const mode = customerId ? 'edit' : 'create';
  const [record, setRecord] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(mode === 'edit');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    document.title = mode === 'edit' ? 'Edit customer · Dudo' : 'New customer · Dudo';
  }, [mode]);

  useEffect(() => {
    if (mode !== 'edit' || !customerId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    client
      .getCustomer(customerId)
      .then((loaded) => {
        if (!cancelled) setRecord(loaded);
      })
      .catch((thrown) => {
        if (!cancelled) setLoadError(toApiError(thrown));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, customerId, mode, reloadNonce]);

  if (loading) {
    return <Skeleton className="h-6 w-56" />;
  }

  if (loadError) {
    return (
      <Panel>
        <ErrorBlock
          error={loadError}
          onRetry={() => setReloadNonce((n) => n + 1)}
          extraActions={<ButtonLink href={getLastListHash()}>Back to customers</ButtonLink>}
        />
      </Panel>
    );
  }

  if (mode === 'edit' && record && record.status !== 'active') {
    const backHref = `#/customers/${encodeURIComponent(record.customer_id)}`;
    return (
      <div>
        <a href={backHref} className="mb-4 inline-block text-[0.8125rem] font-semibold text-ink-muted no-underline">
          ← {record.display_name}
        </a>
        <Panel>
          <StateBlock
            title={
              record.status === 'archived'
                ? 'An archived customer cannot be edited'
                : 'This customer cannot be edited'
            }
            body={
              record.status === 'archived'
                ? 'Restore it first. A record withdrawn from use that could still be quietly changed would be neither withdrawn nor a record.'
                : 'Its current state does not allow changes.'
            }
            actions={
              <ButtonLink variant="primary" href={backHref}>
                Open the record
              </ButtonLink>
            }
          />
        </Panel>
      </div>
    );
  }

  return <Form client={client} record={record} mode={mode} />;
}

function Form({
  client,
  record,
  mode,
}: {
  client: CustomerDirectoryClient;
  record: Customer | null;
  mode: 'create' | 'edit';
}) {
  const { businesses, loading: businessesLoading, isEmpty: noBusinesses } =
    useAuthorizedBusinesses(client);
  const [values, setValues] = useState<FormValues>(record ? valuesFrom(record) : EMPTY);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);

  function isRequired(field: string): boolean {
    return field === 'display_name' || field === 'customer_type' || field === 'business_id';
  }

  function set(field: keyof FormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) {
      const issue = validateField(field, value.trim() || null, { required: isRequired(field) });
      setErrors((previous) => ({ ...previous, [field]: issue ? issueText(issue.issue, field) : undefined }));
    }
  }

  function blur(field: keyof FormValues) {
    setTouched((previous) => ({ ...previous, [field]: true }));
    const issue = validateField(field, values[field].trim() || null, { required: isRequired(field) });
    setErrors((previous) => ({ ...previous, [field]: issue ? issueText(issue.issue, field) : undefined }));
  }

  /**
   * The diff against the record that was loaded. Untouched fields never appear,
   * which is what makes "absent means unchanged" true on the wire.
   */
  function buildDiff(): UpdateCustomerChanges {
    if (!record) return {};
    const diff: Record<string, string | null> = {};
    for (const field of EDITABLE_FIELDS) {
      const raw = values[field].trim();
      const next = raw === '' ? null : raw;
      const before = record[field] ?? null;
      if (next === before) continue;
      diff[field] = next;
    }
    return diff as UpdateCustomerChanges;
  }

  const diff = mode === 'edit' ? buildDiff() : {};
  const changedCount = Object.keys(diff).length;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSummary(null);

    const found: Partial<Record<string, string>> = {};
    const fields: (keyof FormValues)[] =
      mode === 'create' ? ['business_id', ...EDITABLE_FIELDS] : [...EDITABLE_FIELDS];

    for (const field of fields) {
      const issue = validateField(field, values[field].trim() || null, {
        required: isRequired(field),
      });
      if (issue) found[field] = issueText(issue.issue, field);
    }

    setErrors(found);
    setTouched(Object.fromEntries(fields.map((f) => [f, true])));

    const problems = Object.entries(found).filter(([, message]) => Boolean(message));
    if (problems.length > 0) {
      setSummary({
        title: `Check ${problems.length === 1 ? 'this field' : `these ${problems.length} fields`} before saving.`,
        items: problems.map(([field, message]) => ({ field, text: message! })),
      });
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        const created = await client.createCustomer({
          business_id: values.business_id,
          display_name: values.display_name.trim().replace(/\s+/g, ' '),
          customer_type: values.customer_type as CustomerType,
          email: values.email.trim() || null,
          phone: values.phone.trim() || null,
          country: values.country.trim().toUpperCase() || null,
          address: values.address.trim() || null,
          notes: values.notes.trim() || null,
        });
        toast(`${created.display_name} has been added.`);
        navigate(`/customers/${created.customer_id}`);
        return;
      }

      if (!record || changedCount === 0) return;
      const updated = await client.updateCustomer(record.customer_id, diff);
      toast(`${updated.display_name} has been updated.`);
      navigate(`/customers/${updated.customer_id}`);
      return;
    } catch (thrown) {
      applyServerError(toApiError(thrown));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The server's answer wins. Field-level detail is attached to the field it
   * names; anything without a field, or with a field this form does not render,
   * is stated in the summary rather than swallowed.
   */
  function applyServerError(failure: ApiError) {
    const items: SummaryItem[] = [];
    const nextErrors: Partial<Record<string, string>> = {};

    for (const detail of failure.details) {
      const text = issueText(detail.issue, detail.field);
      if (detail.field in LABELS) {
        nextErrors[detail.field] = text;
        items.push({ field: detail.field, text });
      } else {
        items.push({ text: `${detail.field}: ${text}` });
      }
    }

    if (items.length === 0) items.push({ text: failure.message || 'The request was refused.' });

    setErrors((previous) => ({ ...previous, ...nextErrors }));
    setSummary({
      title:
        failure.code === 'invalid_argument'
          ? 'Dudo could not accept these details.'
          : failure.code === 'failed_precondition'
            ? 'This customer has changed since the form was opened.'
            : failure.code === 'forbidden'
              ? 'You do not have permission to save this.'
              : 'That could not be saved.',
      items,
      ...(failure.request_id ? { reference: failure.request_id } : {}),
    });
  }

  const backHref = record ? `#/customers/${encodeURIComponent(record.customer_id)}` : getLastListHash();

  function errorFor(field: keyof FormValues): string | null {
    return touched[field] && errors[field] ? errors[field]! : null;
  }

  /**
   * A principal authorized over no Business cannot create a customer, because
   * `business_id` is required on CreateCustomer and there is nothing valid to
   * put in it.
   *
   * The contract requires both clients to render the empty authorized set as a
   * first-class state rather than as a loading failure, and it is not a corner
   * case: it is what every principal receives today, because Core ships a
   * deny-all authorization source. Showing an empty picker and letting someone
   * fill in the whole form before the server refuses it would be the worse
   * interface — this says so before any effort is spent.
   */
  if (mode === 'create' && noBusinesses) {
    return (
      <div>
        <a
          href={getLastListHash()}
          className="mb-4 inline-block text-[0.8125rem] font-semibold text-ink-muted no-underline"
        >
          ← Customers
        </a>
        <Panel>
          <StateBlock
            title="You are not authorized over any Business"
            body={
              <>
                <p>
                  Every customer is filed under a Business, and your account is not currently
                  authorized over one. Ask an owner of this Organization to give you access.
                </p>
                <p className="text-[0.8125rem] text-ink-faint">
                  Nothing is wrong with this page — it is showing you an empty result, not a
                  failure.
                </p>
              </>
            }
            actions={<ButtonLink href={getLastListHash()}>Back to customers</ButtonLink>}
          />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <a
        href={backHref}
        className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-muted no-underline hover:text-navy-700"
      >
        <span aria-hidden="true" className="rtl:rotate-180">
          ←
        </span>
        {record ? record.display_name : 'Customers'}
      </a>

      <div className="mb-6">
        <h1 className="font-serif text-3xl leading-tight tracking-[-0.01em] text-navy-800">
          {mode === 'create' ? 'New customer' : 'Edit customer'}
        </h1>
        <p className="mt-1 text-ink-muted">
          {mode === 'create'
            ? 'A new customer starts active. Only the name, the type and the Business are required.'
            : 'Leave a field as it is to keep it. Clear a field to remove what is recorded.'}
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-5">
        {summary ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="grid gap-2 rounded-[7px] border border-[#f6d6d4] border-s-[3px] border-s-scarlet-600 bg-scarlet-50 p-4 text-scarlet-700"
          >
            <p className="font-bold">{summary.title}</p>
            <ul className="grid gap-1 text-[0.8125rem]">
              {summary.items.map((item, index) => (
                <li key={index}>
                  {item.field ? (
                    <button
                      type="button"
                      onClick={() => document.getElementById(`f-${item.field}`)?.focus()}
                      className="cursor-pointer border-0 bg-transparent p-0 text-start font-semibold text-inherit underline underline-offset-2"
                    >
                      {LABELS[item.field] ?? item.field}: {item.text}
                    </button>
                  ) : (
                    <span>{item.text}</span>
                  )}
                </li>
              ))}
            </ul>
            {summary.reference ? (
              <p className="font-mono text-xs opacity-85">Reference {summary.reference}</p>
            ) : null}
          </div>
        ) : null}

        <FormSection title="Identity">
          {mode === 'create' ? (
            <Field
              id="f-business_id"
              label={LABELS.business_id!}
              required
              hint="Which of your Businesses this customer is filed under. It cannot be changed here afterwards."
              error={errorFor('business_id')}
            >
              {(aria) => (
                <Select
                  {...aria}
                  value={values.business_id}
                  disabled={businessesLoading}
                  onChange={(event) => set('business_id', event.target.value)}
                  onBlur={() => blur('business_id')}
                >
                  <option value="">
                    {businessesLoading ? 'Loading your Businesses…' : 'Choose a Business'}
                  </option>
                  {businesses.map((business) => (
                    <option key={business.business_id} value={business.business_id}>
                      {/* Null name renders as the identifier, verbatim — the
                          contract's normative rendering rule. */}
                      {businessLabel(business)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="grid gap-2">
              <span className="text-[0.8125rem] font-semibold text-ink-soft">Business</span>
              <ReadOnlyValue>
                {makeBusinessLabeller(businesses)(record?.business_id ?? '')}
              </ReadOnlyValue>
              <p className="text-[0.8125rem] text-ink-muted">
                Filed under this Business. Moving a customer to a different Business is a separate,
                separately-permissioned action and is not part of this form.
              </p>
            </div>
          )}

          <Field
            id="f-display_name"
            label={LABELS.display_name!}
            required
            hint="The name this customer is known by."
            error={errorFor('display_name')}
          >
            {(aria) => (
              <Input
                {...aria}
                ref={nameRef}
                type="text"
                value={values.display_name}
                onChange={(event) => set('display_name', event.target.value)}
                onBlur={() => blur('display_name')}
                autoComplete="off"
                maxLength={LIMITS.display_name.max}
              />
            )}
          </Field>

          <Field
            id="f-customer_type"
            label={LABELS.customer_type!}
            required
            hint="Whether this is a natural person or an organisation."
            error={errorFor('customer_type')}
          >
            {(aria) => (
              <Select
                {...aria}
                value={values.customer_type}
                onChange={(event) => set('customer_type', event.target.value)}
                onBlur={() => blur('customer_type')}
              >
                <option value="person">Person</option>
                <option value="company">Company</option>
              </Select>
            )}
          </Field>
        </FormSection>

        <FormSection title="Contact">
          <Field
            id="f-email"
            label={LABELS.email!}
            hint="Dudo checks the shape only. It does not verify that the address exists."
            error={errorFor('email')}
          >
            {(aria) => (
              <Input
                {...aria}
                type="email"
                inputMode="email"
                value={values.email}
                onChange={(event) => set('email', event.target.value)}
                onBlur={() => blur('email')}
                autoComplete="off"
                maxLength={LIMITS.email.max}
              />
            )}
          </Field>

          <Field
            id="f-phone"
            label={LABELS.phone!}
            hint="Recorded as you write it. Digits and + ( ) - . and spaces."
            error={errorFor('phone')}
          >
            {(aria) => (
              <Input
                {...aria}
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(event) => set('phone', event.target.value)}
                onBlur={() => blur('phone')}
                autoComplete="off"
                maxLength={LIMITS.phone.max}
              />
            )}
          </Field>

          <Field
            id="f-country"
            label={LABELS.country!}
            hint="Two-letter code, for example BH, GB or AE."
            error={errorFor('country')}
          >
            {(aria) => (
              <Input
                {...aria}
                type="text"
                value={values.country}
                onChange={(event) => set('country', event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                onBlur={() => blur('country')}
                autoComplete="off"
                maxLength={2}
                className="max-w-32 uppercase"
              />
            )}
          </Field>

          <div className="hidden sm:block" />

          <Field
            id="f-address"
            label={LABELS.address!}
            hint="One free-text address. Not used for tax or shipping."
            error={errorFor('address')}
            counter={{ used: values.address.length, max: LIMITS.address.max }}
            className="sm:col-span-full"
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={values.address}
                onChange={(event) => set('address', event.target.value)}
                onBlur={() => blur('address')}
                maxLength={LIMITS.address.max}
              />
            )}
          </Field>
        </FormSection>

        <FormSection title="Notes">
          <Field
            id="f-notes"
            label={LABELS.notes!}
            hint="Notes are visible to everyone who can open this record, and are deliberately not searchable."
            error={errorFor('notes')}
            counter={{ used: values.notes.length, max: LIMITS.notes.max }}
            className="sm:col-span-full"
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={5}
                value={values.notes}
                onChange={(event) => set('notes', event.target.value)}
                onBlur={() => blur('notes')}
                maxLength={LIMITS.notes.max}
              />
            )}
          </Field>
        </FormSection>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            disabled={submitting || (mode === 'edit' && changedCount === 0)}
          >
            {submitting
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Create customer'
                : 'Save changes'}
          </Button>
          <ButtonLink href={backHref}>Cancel</ButtonLink>
          {mode === 'edit' ? (
            <p className="grow basis-48 text-[0.8125rem] text-ink-muted">
              {changedCount === 0
                ? 'Nothing has changed yet.'
                : `${changedCount} ${changedCount === 1 ? 'field' : 'fields'} changed.`}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}

interface SummaryItem {
  field?: string;
  text: string;
}

/**
 * The error summary shown above the form. `reference` carries the envelope's
 * `request_id` verbatim — the one identifier that makes a support conversation
 * possible without anyone sharing the data involved.
 */
interface ErrorSummary {
  title: string;
  items: SummaryItem[];
  reference?: string;
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="border-b border-line bg-sunk px-5 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">{title}</h2>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}
