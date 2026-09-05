/**
 * Templates — a business type: a name, and the display labels each structural
 * level carries for Organizations adopting it.
 *
 * ===========================================================================
 * TM-4. NOTHING CONSUMES A TEMPLATE YET, AND THE SCREEN SAYS SO.
 * ===========================================================================
 *
 * `template-v1` TM-4, and it is the single most important thing about this
 * screen:
 *
 *   "Nothing consumes a Template. Organizations have no `template_id`, so this
 *    capability is COMPLETE AND INERT. Creating a business type changes what no
 *    user sees until onboarding adds the reference. It must not be reported as
 *    'business types now work'."
 *
 * So this screen is a THIRD STATE, distinct from the two `NotBuiltYet` already
 * distinguishes. It is not "blocked on acceptance" and not "accepted but
 * unimplemented" — it is BUILT, WORKING, AND CONNECTED TO NOTHING. An operator
 * can create a Template, the row is written, the audit record is written, and no
 * customer sees a different word anywhere.
 *
 * THE NOTICE IS PART OF THE SCREEN, NOT A CAVEAT UNDER IT. It sits above the
 * list, it is not dismissible, and it says what will change this: onboarding
 * adding the reference. An operator who creates three business types and expects
 * a tenant to start saying "Campus" has been misled by the interface, and only
 * the interface can prevent that.
 *
 * ===========================================================================
 * A TEMPLATE NAMES AND LABELS. IT NEVER CONTAINS LOGIC.
 * ===========================================================================
 *
 * `CORE_BOUNDARIES.md` 6.1 governs types, tables, columns, functions and routes
 * — NOT rows: "A row reading 'Dental Clinic' is data; a `dental_clinic` column
 * is a defect." Core enforces the shape structurally — three label columns, not
 * a JSON blob — and THIS UI MUST NOT IMPLY A FREEDOM THE MODEL DOES NOT HAVE.
 *
 * So there is no rule builder, no condition editor, no workflow step, and no
 * free-form key/value grid that would invite one. There are exactly three label
 * fields, because there are exactly three levels, and a closed set of three
 * inputs is itself the statement that this is not a place to put behaviour.
 *
 * ===========================================================================
 * THE LEVEL LABELS ARE WHAT THE USER ACTUALLY ASKED FOR
 * ===========================================================================
 *
 * The complaint was about words on a screen — a school does not have
 * "businesses", it has campuses. `0025`'s Amendment records that renaming
 * `business_id` is a breaking wire change plus an audit-history rewrite, owed to
 * its own slice; the labels fix the user-visible half TODAY with no breaking
 * change. The schema says it directly: "the rename is for developers and the
 * public API; the labels are for users."
 *
 * ===========================================================================
 * WHAT VERSION 1 CANNOT DO, STATED SO THE SCREEN DOES NOT IMPLY OTHERWISE
 * ===========================================================================
 *
 * NO UPDATE (TM-1) and NO RETIRE (TM-2). An operator who mistypes a name cannot
 * fix it. `status` exists in the shape with both values and NO ROUTE SETS IT, so
 * every Template is `active` forever. There is deliberately no Edit control and
 * no Retire control here — drawing one that 404s would be worse than its
 * absence, and the absence is explained rather than left to be discovered.
 *
 * NO DELETE, EVER, and that one is not a limitation: an Organization will
 * reference the Template it adopted, and deleting one turns that into a dangling
 * pointer whose failure surfaces in the tenant's UI as a missing label.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { cn } from '@/lib/cn';
import {
  MAX_TEMPLATE_LABEL_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  PLATFORM_DEFAULT_PAGE_SIZE,
  TEMPLATE_LEVELS,
  TEMPLATE_LEVEL_DEFAULTS,
  isKnownTemplateStatus,
  templateLabelRefusal,
  templateNameRefusal,
  type ListTemplatesOutput,
  type PlatformClient,
  type Template,
  type TemplateLevel,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListTemplatesOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** What each level is called in this console's own chrome. */
const LEVEL_TITLES: Readonly<Record<TemplateLevel, string>> = {
  organization: 'Organization',
  workspace: 'Workspace',
  branch: 'Branch',
};

const LEVEL_HINTS: Readonly<Record<TemplateLevel, string>> = {
  organization: 'A school group renders “Group”, a clinic “Practice”, a company “Company”.',
  workspace: 'A school renders “Campus”, a shop “Branch”, a clinic “Site”.',
  branch: 'The level below a Workspace.',
};

export function Templates({ platform }: { platform: PlatformClient }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  /** The Template created by the last successful submit, for confirmation. */
  const [justCreated, setJustCreated] = useState<Template | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform.listTemplates({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor }).then(
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

  /*
   * A create refreshes the list, and it does so by RETURNING TO THE FIRST PAGE
   * rather than re-fetching the current one. The cursor is bound to the query
   * and a new row changes what the enumeration contains; resuming mid-list after
   * an insert shows a page whose meaning has quietly changed. It is also one
   * audited call either way.
   */
  const refreshFromStart = useCallback(() => {
    setCursor(null);
    setDepth(1);
    setNonce((value) => value + 1);
  }, []);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          Templates
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          A business type — School, Clinic, Retail — carrying a name and the words each level is
          called. A Template names and labels; it never contains logic, rules or workflow.
        </p>
      </header>

      <InertNotice />

      <CreateTemplateForm
        platform={platform}
        busy={creating}
        setBusy={setCreating}
        onCreated={(template) => {
          setJustCreated(template);
          refreshFromStart();
        }}
        justCreated={justCreated}
      />

      <h2 className="mt-10 mb-4 text-lg font-bold text-ink">Existing business types</h2>

      {load.kind === 'loading' ? <LoadingBlock label="Asking Core for the Templates…" /> : null}

      {load.kind === 'failed' ? (
        <ErrorBlock error={load.error} onRetry={() => setNonce((value) => value + 1)}>
          {cursor !== null ? (
            <Button variant="secondary" size="sm" className="mt-4 me-2" onClick={refreshFromStart}>
              Start again from the first page
            </Button>
          ) : null}
        </ErrorBlock>
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={cursor === null ? 'No business types yet.' : 'No more business types.'}
          body={
            cursor === null ? (
              <>
                Core answered, and none has been created. An empty list is not a missing one — this
                is what the platform currently holds.
              </>
            ) : (
              <>Core answered, and this page is empty. Start again from the first page.</>
            )
          }
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <ul className="grid gap-3">
            {load.page.data.map((template) => (
              <TemplateCard key={template.template_id} template={template} />
            ))}
          </ul>

          <nav
            aria-label="Pagination"
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-[0.8125rem] text-ink-muted">
              Showing {load.page.data.length}{' '}
              {load.page.data.length === 1 ? 'business type' : 'business types'}
              {depth > 1 ? ` · page ${String(depth)}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button variant="secondary" size="sm" onClick={refreshFromStart}>
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

/**
 * TM-4, rendered. Not dismissible, and above the controls rather than below
 * them, because its whole job is to be read before an operator forms an
 * expectation.
 */
function InertNotice() {
  return (
    <div
      role="note"
      className="rounded-[12px] border border-gold-500 bg-gold-50 p-4 text-[0.875rem] leading-relaxed text-ink sm:p-5"
    >
      <p className="font-bold">Creating a business type does not change anything yet.</p>
      <p className="mt-2">
        Nothing consumes a Template. Organizations carry no reference to one, so the labels below
        are stored and are not read by any customer-facing screen — no tenant will see “Campus”
        instead of “Workspace” because of anything done here.
      </p>
      <p className="mt-2">
        What changes that is <span className="font-semibold">Organization onboarding</span>, which
        adds the reference, and it is being built now. Until then this page is complete and inert:
        real, working, and connected to nothing.
      </p>
    </div>
  );
}

function CreateTemplateForm({
  platform,
  busy,
  setBusy,
  onCreated,
  justCreated,
}: {
  platform: PlatformClient;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onCreated: (template: Template) => void;
  justCreated: Template | null;
}) {
  const [name, setName] = useState('');
  const [labels, setLabels] = useState<Record<TemplateLevel, string>>({
    organization: '',
    workspace: '',
    branch: '',
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string | null>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;

      // Local checks first, so a trailing space costs no request and no audit
      // record. Core re-checks all of it and its answer is the one that counts.
      const errors: Record<string, string | null> = { name: templateNameRefusal(name) };
      for (const level of TEMPLATE_LEVELS) {
        errors[level] = templateLabelRefusal(labels[level]);
      }
      setLocalErrors(errors);
      if (Object.values(errors).some((value) => value !== null)) return;

      setFailure(null);
      setBusy(true);
      void platform.createTemplate({ name, level_labels: labels }).then(
        (template) => {
          setBusy(false);
          setName('');
          setLabels({ organization: '', workspace: '', branch: '' });
          setLocalErrors({});
          onCreated(template);
        },
        (thrown: unknown) => {
          setBusy(false);
          setFailure(toApiError(thrown));
        },
      );
    },
    [busy, labels, name, onCreated, platform, setBusy],
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-6 grid gap-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6"
    >
      <h2 className="text-lg font-bold text-ink">Create a business type</h2>

      {justCreated ? (
        <p
          role="status"
          className="rounded-[7px] border border-green-500 bg-green-50 p-3 text-[0.875rem] text-ink"
        >
          Created <span className="font-semibold">{justCreated.name}</span>. It is stored and no
          customer sees it yet.
        </p>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
        >
          <p className="font-bold text-scarlet-700">
            {failure.code === 'conflict'
              ? 'That name is already taken'
              : failure.code === 'quota_exceeded'
                ? 'The platform write limit has been reached'
                : 'The business type was not created'}
          </p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            {failure.code === 'conflict' ? (
              <>
                A business type with this name already exists. Names are compared ignoring case and
                some Unicode differences, so “School” and “school” count as the same. Nothing was
                created — choose a different name.
              </>
            ) : failure.code === 'quota_exceeded' ? (
              <>
                Core deferred the write rather than performing it. Nothing was created. Try again
                later; no tenant is affected by this.
              </>
            ) : (
              <>{failure.message}</>
            )}
          </p>
          {failure.details.length > 0 ? (
            <ul className="mt-2 grid list-disc gap-1 ps-4 text-ink-soft">
              {failure.details.map((detail) => (
                <li key={`${detail.field}:${detail.issue}`}>
                  <code className="font-mono text-[0.8125rem]">{detail.field}</code> — {detail.issue}
                </li>
              ))}
            </ul>
          ) : null}
          {failure.request_id ? (
            <p className="mt-2 font-mono text-xs break-all text-ink-muted">
              Reference {failure.request_id}
            </p>
          ) : null}
        </div>
      ) : null}

      <Field
        id="template-name"
        label="Name"
        error={localErrors.name ?? null}
        hint={`What the business type is called, as a person reads it. Up to ${String(MAX_TEMPLATE_NAME_LENGTH)} characters. It cannot be changed later.`}
      >
        {(aria) => (
          <Input
            {...aria}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (localErrors.name) setLocalErrors((prev) => ({ ...prev, name: null }));
            }}
            placeholder="School"
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            disabled={busy}
            required
          />
        )}
      </Field>

      <fieldset className="grid gap-4 border-0 p-0">
        <legend className="text-[0.8125rem] font-semibold tracking-[0.01em] text-ink-soft">
          What each level is called
        </legend>
        <p className="-mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          {/*
            The label is a LABEL. The schema is emphatic: "it changes no
            authorization, no scope, no predicate and no route." Saying so here
            keeps an operator from expecting structural consequences.
          */}
          These change only the words a customer reads. They do not change permissions, structure
          or anything a tenant can do. Leave one blank to keep the default.
        </p>

        {TEMPLATE_LEVELS.map((level) => (
          <Field
            key={level}
            id={`template-label-${level}`}
            label={LEVEL_TITLES[level]}
            error={localErrors[level] ?? null}
            hint={LEVEL_HINTS[level]}
          >
            {(aria) => (
              <Input
                {...aria}
                value={labels[level]}
                onChange={(event) => {
                  const value = event.target.value;
                  setLabels((prev) => ({ ...prev, [level]: value }));
                  if (localErrors[level]) setLocalErrors((prev) => ({ ...prev, [level]: null }));
                }}
                /*
                  The platform default, as a placeholder ONLY. The value is not
                  pre-filled: a pre-filled field would send the default
                  explicitly and make "the operator chose Workspace" and "the
                  operator left it alone" indistinguishable on the wire.
                */
                placeholder={TEMPLATE_LEVEL_DEFAULTS[level]}
                maxLength={MAX_TEMPLATE_LABEL_LENGTH}
                disabled={busy}
              />
            )}
          </Field>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy} busy={busy}>
          {busy ? 'Creating…' : 'Create business type'}
        </Button>
        <p className="text-[0.8125rem] text-ink-muted">
          {/* TM-1/TM-2, at the point of no return rather than in a footnote. */}
          It cannot be edited, renamed or removed afterwards.
        </p>
      </div>
    </form>
  );
}

function TemplateCard({ template }: { template: Template }) {
  return (
    <li className="rounded-[12px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/*
            Rendered as TEXT. `templates.ts` is explicit that a name containing a
            script tag or templating syntax is stored as text and rendered as
            text by both clients — there is no interpolation anywhere on this
            path. React escapes by default and nothing here uses
            `dangerouslySetInnerHTML`, which is what makes that true on this side.
          */}
          <h3 className="text-base font-bold break-words text-ink">{template.name}</h3>
          <p className="mt-1 font-mono text-xs break-all text-ink-muted">{template.template_id}</p>
        </div>
        <StatusBadge status={template.status} />
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[0.875rem] sm:grid-cols-3">
        {TEMPLATE_LEVELS.map((level) => (
          <div key={level} className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              {LEVEL_TITLES[level]}
            </dt>
            <dd className="break-words text-ink">{template.level_labels[level]}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-ink-muted">
        Created <CreatedAt value={template.created_at} />
      </p>
    </li>
  );
}

/**
 * `active` is the only value version 1 produces. An unrecognised one is rendered
 * verbatim and styled neutrally rather than hidden or mapped onto `active` —
 * showing the real value is recoverable, quietly showing the wrong one is not.
 */
function StatusBadge({ status }: { status: string }) {
  const known = isKnownTemplateStatus(status);
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        status === 'active' && 'bg-green-50 text-green-700',
        status === 'retired' && 'bg-sunk text-ink-muted',
        !known && 'bg-gold-50 text-gold-700',
      )}
    >
      {status}
      {!known ? <span className="sr-only"> (an unrecognised status)</span> : null}
    </span>
  );
}

/** RFC 3339 from Core, localised for reading, original kept for comparison. */
function CreatedAt({ value }: { value: string }): ReactNode {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono">{value}</span>;
  }
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
