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
 *     means unchanged, a value means set, null means cleared. The form submits a
 *     DIFF against the record it loaded, never the whole form. Sending
 *     everything would look identical on a happy path and silently overwrite a
 *     colleague's concurrent edit on any other.
 *   - Only an ACTIVE customer can be edited. The server refuses otherwise; this
 *     screen refuses to open and says to restore first.
 *
 * Validation here is a courtesy, not a gate. Every rule is a transcription of
 * the schema, the server validates again, and the server's answer is what the
 * person is shown when the two disagree.
 *
 * ===========================================================================
 * REACT HOOK FORM HOLDS THE STATE. IT DOES NOT HOLD THE RULES.
 * ===========================================================================
 *
 * What RHF replaced is four `useState` maps — values, errors, touched,
 * submitting — and the blur/change plumbing between them. What it did NOT
 * replace, and must not:
 *
 *   · `validateField` and `issueText` from `contracts/field-rules.ts` remain the
 *     only source of what is valid. Each field's `validate` calls them.
 *   · `buildDiff` is unchanged in logic. "Absent means unchanged" is a wire
 *     property, and a form library that helpfully submitted every field would
 *     break it silently on the only path where it matters.
 *   · The server's answer still wins. Field-level detail is attached with
 *     `setError`; anything the form does not render is stated in the summary
 *     rather than swallowed.
 *
 * ===========================================================================
 * NO ZOD RESOLVER, AND THAT IS A DEPENDENCY FACT RATHER THAN A PREFERENCE
 * ===========================================================================
 *
 * The usual RHF + Zod pairing goes through `@hookform/resolvers`. **That package
 * is not in the set the user approved on 2026-09-08** (ADR 0036 names six:
 * shadcn/ui, TanStack Router, TanStack Query, TanStack Table, React Hook Form,
 * Zod), and `security.md` §7 is explicit that approval is specific and does not
 * carry forward — "it is already a peer dependency of one of these" is not
 * approval.
 *
 * It would also be the wrong tool here even if it were approved: a Zod schema
 * restating `customer-directory-v1`'s field rules is exactly what ADR 0037
 * forbids — a hand-written type wearing a validator's clothes. The rules belong
 * to the contract, and `field-rules.ts` is the transcription `0037`'s generator
 * is meant to replace. Per-field `validate` reaches them with no adapter at all.
 */

import { useEffect, useRef, useState } from 'react';
import { useForm, type FieldErrors, type SubmitHandler } from 'react-hook-form';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Button,
  buttonVariants,
  Field,
  Input,
  Panel,
  ReadOnlyValue,
  Select,
  Skeleton,
  StateBlock,
  Textarea,
  toast,
} from '@dudo/ui';
import { ErrorBlock } from '@/components/ErrorBlock';
import { type ApiError } from '@/api/errors';
import { LIMITS, issueText, validateField } from '@/contracts/field-rules';
import {
  EDITABLE_FIELDS,
  type Customer,
  type CustomerType,
  type EditableField,
  type UpdateCustomerChanges,
} from '@/contracts/customer-directory';
import { useAuthorizedBusinesses, useCreateCustomer, useCustomer, useUpdateCustomer } from '@/lib/queries';
import { makeBusinessLabeller } from '@/lib/business-label';
import { businessLabel } from '@/contracts/business-read';
import { getLastListSearch } from '@/lib/last-list';

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

function isRequired(field: string): boolean {
  return field === 'display_name' || field === 'customer_type' || field === 'business_id';
}

export function CustomerForm({ customerId }: { customerId?: string }) {
  const mode = customerId ? 'edit' : 'create';
  const recordQuery = useCustomer(customerId);
  const loading = mode === 'edit' && recordQuery.isPending;
  const loadError = mode === 'edit' ? (recordQuery.error ?? null) : null;
  const record = mode === 'edit' ? (recordQuery.data ?? null) : null;
  const backSearch = getLastListSearch();

  useEffect(() => {
    document.title = mode === 'edit' ? 'Edit customer · Dudo' : 'New customer · Dudo';
  }, [mode]);

  if (loading) {
    return <Skeleton className="h-6 w-56" />;
  }

  if (loadError) {
    return (
      <Panel>
        <ErrorBlock
          error={loadError}
          onRetry={() => void recordQuery.refetch()}
          extraActions={
            <Link to="/customers" search={backSearch} className={buttonVariants()}>
              Back to customers
            </Link>
          }
        />
      </Panel>
    );
  }

  if (mode === 'edit' && record && record.status !== 'active') {
    return (
      <div>
        <Link
          to="/customers/$customerId"
          params={{ customerId: record.customer_id }}
          className="mb-4 inline-block text-[0.8125rem] font-semibold text-ink-muted no-underline"
        >
          ← {record.display_name}
        </Link>
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
              <Link
                to="/customers/$customerId"
                params={{ customerId: record.customer_id }}
                className={buttonVariants({ variant: 'primary' })}
              >
                Open the record
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  /*
   * `key` REMOUNTS THE FORM WHEN THE RECORD CHANGES.
   *
   * RHF takes its defaults once, at first render. Without this, navigating from
   * editing one customer to editing another would keep the first one's values in
   * the fields while the header showed the second one's name — and the diff
   * would then be computed against the wrong record, which is the one place this
   * screen can silently send a wrong write.
   */
  return <Form key={record?.customer_id ?? 'new'} record={record} mode={mode} />;
}

function Form({ record, mode }: { record: Customer | null; mode: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const { businesses, loading: businessesLoading, isEmpty: noBusinesses } =
    useAuthorizedBusinesses();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const submitting = createCustomer.isPending || updateCustomer.isPending;

  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const backSearch = getLastListSearch();

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    watch,
    formState: { errors, touchedFields, isSubmitted },
  } = useForm<FormValues>({
    defaultValues: record ? valuesFrom(record) : EMPTY,
    // Validate when a field is left, then keep it current as it is corrected —
    // the same two-stage behaviour the hand-rolled version had.
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const values = watch();

  useEffect(() => {
    setFocus('display_name');
  }, [setFocus]);

  useEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);

  /** One field's rule, read from the contract transcription rather than restated. */
  function rule(field: keyof FormValues) {
    return (value: string) => {
      const issue = validateField(field, value.trim() || null, { required: isRequired(field) });
      return issue ? issueText(issue.issue, field) : true;
    };
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

  /**
   * The server's answer wins. Field-level detail is attached to the field it
   * names; anything without a field, or with a field this form does not render,
   * is stated in the summary rather than swallowed.
   */
  function applyServerError(failure: ApiError) {
    const items: SummaryItem[] = [];

    for (const detail of failure.details) {
      const text = issueText(detail.issue, detail.field);
      if (detail.field in LABELS) {
        setError(detail.field as keyof FormValues, { type: 'server', message: text });
        items.push({ field: detail.field, text });
      } else {
        items.push({ text: `${detail.field}: ${text}` });
      }
    }

    if (items.length === 0) items.push({ text: failure.message || 'The request was refused.' });

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

  const onValid: SubmitHandler<FormValues> = (submitted) => {
    setSummary(null);

    if (mode === 'create') {
      createCustomer.mutate(
        {
          business_id: submitted.business_id,
          display_name: submitted.display_name.trim().replace(/\s+/g, ' '),
          customer_type: submitted.customer_type as CustomerType,
          email: submitted.email.trim() || null,
          phone: submitted.phone.trim() || null,
          country: submitted.country.trim().toUpperCase() || null,
          address: submitted.address.trim() || null,
          notes: submitted.notes.trim() || null,
        },
        {
          onSuccess: (created) => {
            toast(`${created.display_name} has been added.`);
            void navigate({
              to: '/customers/$customerId',
              params: { customerId: created.customer_id },
            });
          },
          onError: applyServerError,
        },
      );
      return;
    }

    if (!record || changedCount === 0) return;
    updateCustomer.mutate(
      { customerId: record.customer_id, changes: diff },
      {
        onSuccess: (updated) => {
          toast(`${updated.display_name} has been updated.`);
          void navigate({
            to: '/customers/$customerId',
            params: { customerId: updated.customer_id },
          });
        },
        onError: applyServerError,
      },
    );
  };

  /**
   * A failed client-side check produces the same summary a failed server check
   * does, so the person meets one pattern rather than two.
   *
   * ⚠ IT READS THE ERRORS RHF HANDS IT, NOT `formState.errors`.
   *
   * The first version of this closed over `errors` from `formState` and found it
   * EMPTY every time — that map is updated as part of the same submit, so the
   * closure captured at render time still held the pre-submit state. The
   * function returned early and pressing "Create customer" on an empty form did
   * nothing at all, silently.
   *
   * It typechecked, it built, and it was caught only by clicking the button in a
   * browser. Recorded here because the correct-looking version is the one that
   * reaches for the value already in scope.
   */
  function onInvalid(fieldErrors: FieldErrors<FormValues>) {
    const problems = Object.entries(fieldErrors)
      .filter(([, entry]) => Boolean(entry?.message))
      .map(([field, entry]) => ({ field, text: String(entry?.message) }));

    if (problems.length === 0) return;
    setSummary({
      title: `Check ${problems.length === 1 ? 'this field' : `these ${problems.length} fields`} before saving.`,
      items: problems,
    });
  }

  function errorFor(field: keyof FormValues): string | null {
    const entry = errors[field];
    if (!entry?.message) return null;
    // A server error is shown whatever the field's history — the server has
    // spoken about it, and the person has not necessarily visited it.
    if (entry.type === 'server') return String(entry.message);
    /*
     * A CLIENT-SIDE ERROR IS QUIET UNTIL THE FIELD IS VISITED **OR THE FORM IS
     * SUBMITTED**, and the second half is not optional.
     *
     * `touchedFields` alone was the first version, and it meant that submitting
     * an untouched form marked the fields invalid in RHF's state and showed the
     * person nothing next to any of them. The hand-rolled version this replaced
     * had the same requirement and met it by marking every field touched on
     * submit; `isSubmitted` is the same idea without mutating anything.
     */
    return isSubmitted || touchedFields[field] ? String(entry.message) : null;
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
        <Link
          to="/customers"
          search={backSearch}
          className="mb-4 inline-block text-[0.8125rem] font-semibold text-ink-muted no-underline"
        >
          ← Customers
        </Link>
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
            actions={
              <Link to="/customers" search={backSearch} className={buttonVariants()}>
                Back to customers
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div>
      {record ? (
        <Link
          to="/customers/$customerId"
          params={{ customerId: record.customer_id }}
          className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-muted no-underline hover:text-navy-700"
        >
          <span aria-hidden="true" className="rtl:rotate-180">
            ←
          </span>
          {record.display_name}
        </Link>
      ) : (
        <Link
          to="/customers"
          search={backSearch}
          className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-muted no-underline hover:text-navy-700"
        >
          <span aria-hidden="true" className="rtl:rotate-180">
            ←
          </span>
          Customers
        </Link>
      )}

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

      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="grid max-w-3xl gap-5">
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
                  disabled={businessesLoading}
                  {...register('business_id', { validate: rule('business_id') })}
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
                type="text"
                autoComplete="off"
                maxLength={LIMITS.display_name.max}
                {...register('display_name', { validate: rule('display_name') })}
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
              <Select {...aria} {...register('customer_type', { validate: rule('customer_type') })}>
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
                autoComplete="off"
                maxLength={LIMITS.email.max}
                {...register('email', { validate: rule('email') })}
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
                autoComplete="off"
                maxLength={LIMITS.phone.max}
                {...register('phone', { validate: rule('phone') })}
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
                autoComplete="off"
                maxLength={2}
                className="max-w-32 uppercase"
                {...register('country', {
                  validate: rule('country'),
                  // The contract wants two upper-case letters; typing "bh" should
                  // become "BH" rather than being reported as wrong afterwards.
                  onChange: (event: { target: { value: string } }) => {
                    setValue('country', event.target.value.toUpperCase().replace(/[^A-Z]/g, ''));
                  },
                })}
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
                maxLength={LIMITS.address.max}
                {...register('address', { validate: rule('address') })}
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
                maxLength={LIMITS.notes.max}
                {...register('notes', { validate: rule('notes') })}
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
          {record ? (
            <Link
              to="/customers/$customerId"
              params={{ customerId: record.customer_id }}
              className={buttonVariants()}
            >
              Cancel
            </Link>
          ) : (
            <Link to="/customers" search={backSearch} className={buttonVariants()}>
              Cancel
            </Link>
          )}
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
