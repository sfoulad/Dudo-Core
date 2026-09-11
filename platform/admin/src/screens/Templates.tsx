/**
 * Templates — a business type: a name, and the display labels each structural
 * level carries for Organizations adopting it.
 *
 * ===========================================================================
 * ⚠ TM-4 IS SPENT. THIS BLOCK ASSERTED IT FOR DAYS AFTER IT STOPPED BEING TRUE.
 * ===========================================================================
 *
 * It said **"NOTHING CONSUMES A TEMPLATE YET"** and quoted `template-v1` TM-4:
 * *"Organizations have no `template_id`, so this capability is COMPLETE AND
 * INERT."* **`OnboardOrganization.tsx` sends `template_id` at creation and
 * `OrganizationDetail.tsx` renders the adopted Template.** Onboarding added the
 * reference; the paragraph promising to change when it did was never changed.
 *
 * **The failure is `workflow.md` §12's amendment exactly** — *a sentence about
 * a missing capability outlives the capability arriving, because everyone who
 * quotes it is quoting it for the half that is still true.* Nothing went red.
 * Nobody misread it. It simply stopped being a fact and went on being read as
 * one, **including by me: I believed it while building the dashboard and
 * translated it into Arabic**, so one stale claim acquired a second screen and
 * a second language.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ACTUALLY TRUE, MEASURED RATHER THAN INFERRED
 * ---------------------------------------------------------------------------
 *
 * **THE OLD SENTENCE HAD TWO HALVES AND ONLY ONE WAS FALSE**, which is why
 * "fix the fact" needed care rather than a rewrite:
 *
 *   "Organizations carry no reference to one"     ->  FALSE. Onboarding sets it.
 *   "not read by any customer-facing screen"      ->  STILL TRUE.
 *
 * The second was checked, not assumed: **`platform/web` renders no
 * `level_labels` anywhere, and `business-read-v1` carries none.** The only
 * consumers in the repository are this screen, `OrganizationDetail.tsx` and
 * `api/platform.ts` — **all admin.**
 *
 * **Correcting only the first half would have produced the opposite false
 * statement** — a screen implying tenants now see these words. The notice keeps
 * the true half as a present-tense fact.
 *
 * ---------------------------------------------------------------------------
 * AND THE NOTICE IS NOW PHRASED FORWARD, WHICH IS THE ACTUAL REPAIR
 * ---------------------------------------------------------------------------
 *
 * The old one was built out of **absence** — *nothing consumes this, and here
 * is what will change it.* **A claim of that shape expires silently on the day
 * the thing it names is built**, and nothing sends anyone back to it.
 *
 * `ReachNotice` says what a Template DOES and how far it reaches. **A statement
 * about reach survives a capability landing; a statement about absence cannot.**
 * It is still part of the screen rather than a caveat under it, and it is still
 * not dismissible — that part of the original reasoning was right and is kept.
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
 * ⚠ TM-1 AND TM-2 ARE ALSO SPENT — `update`, `retire` AND `restore` EXIST
 * ===========================================================================
 *
 * This block said **"NO UPDATE (TM-1) and NO RETIRE (TM-2). An operator who
 * mistypes a name cannot fix it… NO ROUTE SETS IT, so every Template is
 * `active` forever."** `template-lifecycle-v1` publishes
 * `platform.templates.update`, `.retire` and `.restore`. **All three of those
 * sentences are now false.**
 *
 * **The caution it drew is NOT false, and it is worth separating from the fact
 * that carried it.** The old reason for having no Edit control was *"drawing
 * one that 404s would be worse than its absence."* **That reason is gone —
 * the routes are registered.** What survives is the narrower rule underneath
 * it: **a control that cannot complete is worse than no control**, which is
 * why the usage read is wired into the retire decision rather than beside it.
 *
 * **RESTORE IS A SEPARATE CONTROL, NEVER A TOGGLE.** It shares `retire`'s
 * permission by decision rather than by omission, and it has its own route and
 * its own audit entry because *"a toggle's audit record cannot say which
 * direction it went without reading the previous state."*
 *
 * **AND RETIRING DOES NOT FREE THE NAME.** A retired Template keeps its unique
 * name, which is why `restore` exists at all — without it *"a mistaken
 * retirement spends the Template's unique name permanently."* The confirmation
 * says so, because that is the fact an operator needs before pressing it.
 *
 * NO DELETE, EVER, and that one is genuinely not a limitation: an Organization
 * references the Template it adopted, and deleting one turns that into a
 * dangling pointer whose failure surfaces as a missing label. **Retire is the
 * reversible answer to the question delete would answer destructively.**
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  useTemplateList,
  useCreateTemplate,
  useTemplateUsage,
  useUpdateTemplate,
  useRetireTemplate,
  useRestoreTemplate,
} from '@/lib/queries';
import {
  fill,
  formatCount,
  refusalText,
  useLocale,
  useT,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';

/* "Showing N business types" — six forms in Arabic, chosen by `Intl`. */
const SHOWING_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'templates.showing.zero',
  one: 'templates.showing.one',
  two: 'templates.showing.two',
  few: 'templates.showing.few',
  many: 'templates.showing.many',
  other: 'templates.showing.other',
};
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PermissionDeniedBlock,
} from '@/components/StateBlock';
import { cn } from '@dudo/ui';
import {
  MAX_TEMPLATE_LABEL_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  TEMPLATE_LEVELS,
  TEMPLATE_LEVEL_DEFAULTS,
  isKnownTemplateStatus,
  templateLabelRefusal,
  templateNameRefusal,
  type ListTemplatesOutput,
  type Template,
  type TemplateLevel,
  type UpdateTemplateInput,
} from '@/api/platform';
import { type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListTemplatesOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * What each level is called in this console's own chrome.
 *
 * **KEYS, NOT WORDS — and the distinction these hold is the reason.** These are
 * the platform's OWN names for the three levels; the Template's `level_labels`
 * are what a CUSTOMER sees instead. An operator filling in "Campus" needs to
 * know which platform level they are renaming, so these labels must stay the
 * platform's vocabulary in the reader's language, never the customer's.
 */
const LEVEL_TITLE_KEYS: Readonly<Record<TemplateLevel, MessageKey>> = {
  organization: 'templates.level.organization',
  workspace: 'templates.level.workspace',
  branch: 'templates.level.branch',
};

const LEVEL_HINT_KEYS: Readonly<Record<TemplateLevel, MessageKey>> = {
  organization: 'templates.levelHint.organization',
  workspace: 'templates.levelHint.workspace',
  branch: 'templates.levelHint.branch',
};

export function Templates() {
  const { locale, t } = useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [creating, setCreating] = useState(false);
  /** The Template created by the last successful submit, for confirmation. */
  const [justCreated, setJustCreated] = useState<Template | null>(null);

  /*
   * THE READ IS A QUERY NOW, AND THE `nonce` IS GONE.
   *
   * It was `useEffect` + `let cancelled` + a nonce bumped to force a re-read.
   * The cancellation flag existed because a response arriving after the operator
   * had moved on would overwrite fresher state; the query cache owns that.
   *
   * `Load` is derived rather than stored — the three states this screen renders
   * are the three the query already distinguishes, and keeping a parallel copy
   * in `useState` is how the two drift.
   *
   * `isFetching`, NOT `isPending`, AND THE FIRST VERSION OF THIS CONVERSION HAD
   * IT WRONG. `isPending` is only the state with no data and no error, so a
   * retry after a failure left the error block frozen with no sign that the
   * button had done anything — the effect this replaced set
   * `{ kind: 'loading' }` at the top of EVERY run. `lib/queries.ts` records why
   * `isFetching` is a safe stand-in on this console: no fetch happens here that
   * an operator did not cause.
   */
  const list = useTemplateList(cursor);
  const load: Load =
    list.isPending || list.isFetching
      ? { kind: 'loading' }
      : list.error !== null
        ? { kind: 'failed', error: list.error }
        : { kind: 'loaded', page: list.data };

  /*
   * A create refreshes the list, and it does so by RETURNING TO THE FIRST PAGE
   * rather than re-fetching the current one. The cursor is bound to the query
   * and a new row changes what the enumeration contains; resuming mid-list after
   * an insert shows a page whose meaning has quietly changed. It is also one
   * audited call either way.
   *
   * THE INVALIDATION LIVES IN `useCreateTemplate`, so this is now only the
   * cursor reset. The audited-call count is unchanged and is asserted in that
   * hook's comment rather than left to be inferred here.
   */
  const refreshFromStart = useCallback(() => {
    setCursor(null);
    setDepth(1);
  }, []);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-4xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          {t('nav.templates')}
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          A business type — School, Clinic, Retail — carrying a name and the words each level is
          called. A Template names and labels; it never contains logic, rules or workflow.
        </p>
      </header>

      <ReachNotice />

      <CreateTemplateForm
        busy={creating}
        setBusy={setCreating}
        onCreated={(template) => {
          setJustCreated(template);
          refreshFromStart();
        }}
        justCreated={justCreated}
      />

      <h2 className="mt-10 mb-4 text-lg font-bold text-ink">{t('templates.existing')}</h2>

      {load.kind === 'loading' ? <LoadingBlock label={t('loading.templates')} /> : null}

      {/* A refusal is a permission boundary, not a failure, and it gets no retry. */}
      {load.kind === 'failed' && load.error.code === 'forbidden' ? (
        <PermissionDeniedBlock error={load.error} />
      ) : null}

      {load.kind === 'failed' && load.error.code !== 'forbidden' ? (
        /*
         * RETRY IS `refetch`, AND IT IS STILL EXACTLY ONE AUDITED CALL. It was a
         * nonce bump that re-ran the effect; the query does the same thing at the
         * same cost. `retry: false` in `lib/query-client.ts` is what keeps it one
         * — the library default would have turned an operator's single click into
         * four requests and four audit rows.
         */
        <ErrorBlock error={load.error} onRetry={() => void list.refetch()}>
          {cursor !== null ? (
            <Button variant="secondary" size="sm" className="mt-4 me-2" onClick={refreshFromStart}>
              {t('page.startAgain')}
            </Button>
          ) : null}
        </ErrorBlock>
      ) : null}

      {/* The title said "No business types YET" — same correction as Organizations. */}
      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={cursor === null ? t('templates.empty.title') : t('page.emptyPage.title')}
          body={
            cursor === null ? (
              <>{t('templates.empty.body')}</>
            ) : (
              <>{t('page.emptyPage')}</>
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
            aria-label={t('a11y.pagination')}
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-[0.8125rem] text-ink-muted">
              {formatCount(locale, load.page.data.length, SHOWING_FORMS, t)}
              {depth > 1 ? ` · ${fill(t('audit.page'), locale, { page: depth })}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button variant="secondary" size="sm" onClick={refreshFromStart}>
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

/**
 * TM-4, rendered. Not dismissible, and above the controls rather than below
 * them, because its whole job is to be read before an operator forms an
 * expectation.
 */
function ReachNotice() {
  const t = useT();
  return (
    <div
      role="note"
      className="rounded-[12px] border border-line bg-sunk p-4 text-[0.875rem] leading-relaxed text-ink sm:p-5"
    >
      <p className="font-bold">{t('templates.reach.title')}</p>
      <p className="mt-2">{t('templates.reach.adopted')}</p>
      <p className="mt-2">{t('templates.reach.notTenantFacing')}</p>
    </div>
  );
}

function CreateTemplateForm({
  busy,
  setBusy,
  onCreated,
  justCreated,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  onCreated: (template: Template) => void;
  justCreated: Template | null;
}) {
  const { locale, t } = useLocale();
  const [name, setName] = useState('');
  const [labels, setLabels] = useState<Record<TemplateLevel, string>>({
    organization: '',
    workspace: '',
    branch: '',
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string | null>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const createTemplate = useCreateTemplate();

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;

      // Local checks first, so a trailing space costs no request and no audit
      // record. Core re-checks all of it and its answer is the one that counts.
      //
      // `refusalText` renders the key AND fills the numbers the sentence names.
      // Doing it by hand here would be the third copy of that two-step, and
      // forgetting the second step renders `{max}` on screen rather than
      // failing — a defect that ships.
      const errors: Record<string, string | null> = {
        name: refusalText(templateNameRefusal(name), locale, t),
      };
      for (const level of TEMPLATE_LEVELS) {
        errors[level] = refusalText(templateLabelRefusal(labels[level]), locale, t);
      }
      setLocalErrors(errors);
      if (Object.values(errors).some((value) => value !== null)) return;

      setFailure(null);
      setBusy(true);
      /*
       * THE MUTATION INVALIDATES THE LIST; THIS CALLBACK STILL OWNS THE FORM.
       * Clearing the fields, clearing the local errors and handing the created
       * Template to the confirmation panel are this screen's, and none of them
       * belongs in a cache. `setBusy` stays too — the parent renders the busy
       * state for the whole section, not just this form.
       */
      createTemplate.mutate(
        { name, level_labels: labels },
        {
          onSuccess: (template) => {
            setBusy(false);
            setName('');
            setLabels({ organization: '', workspace: '', branch: '' });
            setLocalErrors({});
            onCreated(template);
          },
          onError: (thrown) => {
            setBusy(false);
            setFailure(thrown);
          },
        },
      );
    },
    [busy, createTemplate, labels, name, onCreated, setBusy],
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-6 grid gap-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6"
    >
      <h2 className="text-lg font-bold text-ink">{t('templates.create.title')}</h2>

      {justCreated ? (
        <p
          role="status"
          className="rounded-[7px] border border-green-500 bg-green-50 p-3 text-[0.875rem] text-ink"
        >
          {/*
            ⚠ SAID "no customer sees it YET". Two problems in six words: the
            "yet" promises a future this console has no basis for, and the claim
            is FALSE the moment an Organization adopts it — which is exactly the
            stale notice that propagated into the dashboard dictionary and was
            corrected there. **Same sentence, same screen, still here.**
          */}
          {t('templates.created.before')}{' '}
          <span className="font-semibold">
            <bdi>{justCreated.name}</bdi>
          </span>
          {t('templates.created.after')}
        </p>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
        >
          <p className="font-bold text-scarlet-700">
            {failure.code === 'conflict'
              ? t('templates.failed.conflict')
              : failure.code === 'quota_exceeded'
                ? t('templates.failed.quota')
                : t('templates.failed.other')}
          </p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            {failure.code === 'conflict' ? (
              /*
                NAMES ARE COMPARED IGNORING CASE AND SOME UNICODE DIFFERENCES,
                and the sentence says so with an example. **An operator told
                only "already taken" will retry with different capitalisation**
                and be refused again — the explanation is what stops the loop.
              */
              <>{t('templates.failed.conflictBody')}</>
            ) : failure.code === 'quota_exceeded' ? (
              <>{t('templates.failed.quotaBody')}</>
            ) : (
              <>{failure.message}</>
            )}
          </p>
          {failure.details.length > 0 ? (
            <ul className="mt-2 grid list-disc gap-1 ps-4 text-ink-soft">
              {failure.details.map((detail) => (
                <li key={`${detail.field}:${detail.issue}`}>
                  {/* Core's wire field name. Not translated; isolated for RTL. */}
                  <bdi className="font-mono text-[0.8125rem]">{detail.field}</bdi> — {detail.issue}
                </li>
              ))}
            </ul>
          ) : null}
          {failure.request_id ? (
            <p className="mt-2 text-xs text-ink-muted">
              {t('denied.reference')}{' '}
              <bdi className="font-mono break-all">{failure.request_id}</bdi>
            </p>
          ) : null}
        </div>
      ) : null}

      <Field
        id="template-name"
        label={t('identity.nameLabel')}
        error={localErrors.name ?? null}
        /*
          ⚠ THIS SAID "It cannot be changed later." IT CAN — `platform.templates.update`.
          The sentence was true when written and became false when the route
          landed, and it is the worst kind of stale copy: **it is read at the
          moment a decision is made**, and it makes a reversible choice look
          permanent. An operator who believed it would hesitate over a name they
          could have corrected in a minute.
        */
        hint={`${t('templates.nameHint')} ${String(MAX_TEMPLATE_NAME_LENGTH)} ${t('templates.nameHintChars')}`}
      >
        {(aria) => (
          <Input
            {...aria}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (localErrors.name) setLocalErrors((prev) => ({ ...prev, name: null }));
            }}
            placeholder={t('templates.namePlaceholder')}
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            disabled={busy}
            required
          />
        )}
      </Field>

      <fieldset className="grid gap-4 border-0 p-0">
        <legend className="text-[0.8125rem] font-semibold tracking-[0.01em] text-ink-soft">
          {t('templates.levels.legend')}
        </legend>
        <p className="-mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          {/*
            The label is a LABEL. The schema is emphatic: "it changes no
            authorization, no scope, no predicate and no route." Saying so here
            keeps an operator from expecting structural consequences — **and a
            translation that dropped "they do not change permissions" would let
            somebody believe a word choice grants access.**
          */}
          {t('templates.levels.labelsOnly')}
        </p>

        {TEMPLATE_LEVELS.map((level) => (
          <Field
            key={level}
            id={`template-label-${level}`}
            label={t(LEVEL_TITLE_KEYS[level])}
            error={localErrors[level] ?? null}
            hint={t(LEVEL_HINT_KEYS[level])}
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
          {busy ? t('templates.creating') : t('templates.create.submit')}
        </Button>
        <p className="text-[0.8125rem] text-ink-muted">
          {/*
            ⚠ THIS SAID "It cannot be edited, renamed or removed afterwards."
            **IT COULD BE EDITED, RENAMED AND RETIRED — all three are on this
            screen**, built by `useUpdateTemplate`, `useRetireTemplate` and
            `useRestoreTemplate`, which are imported forty lines above it.

            It is the third instance of this exact class on this console, and
            the second in this file: the Name field's hint said *"It cannot be
            changed later"* and was corrected, **and this sentence, eighty lines
            below, said the same false thing and was not.** `§12`: *budget for
            MORE homes than you find* — fixing one instance is a fraction of the
            work, and the one you did not fix is the one the next reader meets.

            **AND THE ABSENCE CHECK COULD NOT SEE IT.** Its pattern carries
            `cannot be changed`, which the sibling used. This one says `cannot
            be edited`. **One word apart, and the check written specifically to
            catch this class passed straight over the second instance of it.**
            The pattern is widened in `verify-platform.mjs`.

            What survives: a Template's NAME IS its identity to an operator, and
            there is no delete — retiring is not removal. That is worth saying at
            the point of creation, and it is true.
          */}
          {t('templates.create.permanence')}
        </p>
      </div>
    </form>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const t = useT();
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
              {t(LEVEL_TITLE_KEYS[level])}
            </dt>
            {/*
              THE LABEL IS THE CUSTOMER'S WORD, NOT THE PLATFORM'S, and is
              operator-typed — so it is isolated rather than translated. The `dt`
              beside it is the platform's own name for the level.
            */}
            <dd className="break-words text-ink">
              <bdi>{template.level_labels[level]}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-ink-muted">
        {t('column.createdOn')} <CreatedAt value={template.created_at} />
      </p>

      <TemplateActions template={template} />
    </li>
  );
}

/**
 * Edit · retire · restore, and the usage read that makes retiring safe.
 *
 * ===========================================================================
 * TWO CONTROLS, NEVER ONE TOGGLE
 * ===========================================================================
 *
 * Retire and restore are separate routes with separate audit entries because
 * **"a toggle's audit record cannot say which direction it went without
 * reading the previous state."** A single switch in this card would be the
 * tidier-looking thing that re-merges them one layer above the transport, so
 * the card renders whichever ONE applies to the current status and never both.
 *
 * ===========================================================================
 * THE USAGE READ IS INSIDE THE DECISION, NOT BESIDE IT
 * ===========================================================================
 *
 * `useTemplateUsage` is `enabled` only while THIS card's retire panel is open.
 * **A usage query per row would be one audited call per Template to draw a list
 * nobody asked a question about** — twenty rows, twenty rows of audit.
 *
 * And the retire button does not act: it opens a panel that asks for the count
 * first. **A retire control that does not show `organizations_using` before
 * acting re-opens the finding the usage route was added to close** — the
 * decision would be made blind, which is precisely what it exists to prevent.
 *
 * ===========================================================================
 * NO CONFIRMATION GATE HERE, AND THAT IS THE LADDER RATHER THAN AN OMISSION
 * ===========================================================================
 *
 * `template-lifecycle-v1` declares **no `requiresConfirmation` on any of these
 * routes.** They are audited, not confirmation-gated. `OrganizationIdentity`
 * records the same reasoning for its own route: *"this console must not invent
 * a gate the ladder did not put there"* — making a `sensitive` act `critical`
 * generalises to every field and the rung stops sorting anything.
 *
 * So the panel is a LOCAL confirm carrying the two facts that decide the
 * answer, not a server-authored statement with re-authentication.
 */
function TemplateActions({ template }: { template: Template }) {
  const t = useT();
  const [panel, setPanel] = useState<'none' | 'edit' | 'retire'>('none');
  const [outcome, setOutcome] = useState<string | null>(null);

  const retired = template.status === 'retired';
  const usage = useTemplateUsage(panel === 'retire' ? template.template_id : null);
  const retire = useRetireTemplate();
  const restore = useRestoreTemplate();

  const busy = retire.isPending || restore.isPending;

  /*
   * ===================================================================
   * FOCUS MOVES IN, AND COMES BACK. THE SECOND HALF IS THE ONE THAT GETS
   * DROPPED.
   * ===================================================================
   *
   * A panel replaces the button that opened it. Without this a keyboard or
   * screen-reader user is left focused on a control that no longer exists and
   * hears nothing — **the panel simply does not exist for them.**
   *
   * `ConfirmationGate` already does the first half and `AdminShell` already
   * does both for its drawer; this is the same pattern, not a new one.
   *
   * **RETURNING FOCUS ON CLOSE IS WHAT NOBODY WRITES.** Nothing looks wrong
   * without it — a sighted user's focus ring lands somewhere harmless — but a
   * keyboard user is dropped at the top of the document and has to traverse the
   * whole list again to reach the row they were working on. On a screen where
   * the next action is usually on the SAME row, that is the difference between
   * usable and not.
   *
   * The panel is focused rather than its first control, so the heading is
   * announced before the buttons: **an operator must hear what this panel is
   * before hearing that it has a "Retire it" button in it.**
   */
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panel !== 'none') panelRef.current?.focus();
  }, [panel]);

  /*
   * ===========================================================================
   * ⚠ THE FOCUS RETURN WAS WRITTEN, PRESENT, AND HAD NEVER WORKED
   * ===========================================================================
   *
   * It was `setPanel('none'); openerRef.current?.focus();` — **and the opener is
   * unmounted at that moment.** Both buttons live inside `{panel === 'none' ? …}`,
   * so opening a panel removes them, `openerRef.current` is `null` for as long
   * as the panel is up, and `?.focus()` is a silent no-op.
   *
   * **A keyboard user closing an edit or retire panel was dropped at the top of
   * the document, exactly as if the code were not there.**
   *
   * It survived because **the CALL is present**, which is what a reader — and
   * my own focus audit — checks for. The audit scored this file "focus out:
   * yes" on the strength of a line that does nothing.
   *
   * **The restore has to happen AFTER the render that remounts the opener**, so
   * it is an effect keyed on the panel closing rather than a call inside the
   * handler. `dismissedRef` distinguishes a close the operator asked for from
   * the initial render, where focus belongs wherever it already is.
   */
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (panel === 'none' && dismissedRef.current) {
      dismissedRef.current = false;
      openerRef.current?.focus();
    }
  }, [panel]);

  const closePanel = useCallback(() => {
    dismissedRef.current = true;
    setPanel('none');
  }, []);

  /*
   * ESCAPE CLOSES IT, like the drawer and the confirmation gate. Bound only
   * while a panel is open, so nothing listens on the ordinary list view.
   */
  useEffect(() => {
    if (panel === 'none') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, panel]);

  return (
    <div className="mt-4 border-t border-line pt-4">
      {outcome !== null ? (
        <p role="status" className="mb-3 text-[0.875rem] font-semibold text-green-700">
          {outcome}
        </p>
      ) : null}

      {panel === 'none' ? (
        <div className="flex flex-wrap gap-2">
          {/*
            ONE `openerRef` FOR BOTH BUTTONS, and it is correct rather than a
            shortcut: only one of Edit and Retire can be the control that opened
            the panel, because opening either replaces both. The ref lands on
            whichever rendered last, which is whichever is on screen.
          */}
          <Button
            ref={openerRef}
            variant="secondary"
            size="sm"
            onClick={() => { setOutcome(null); setPanel('edit'); }}
          >
            {t('template.edit')}
          </Button>
          {/*
            WHICHEVER ONE APPLIES. Rendering both and disabling one would be a
            toggle wearing two buttons, and a disabled control is a promise —
            `Operators.tsx` makes the same argument about a greyed-out revoke.
          */}
          {retired ? (
            <Button
              variant="secondary"
              size="sm"
              busy={restore.isPending}
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                restore.mutate(template.template_id, {
                  onSuccess: () => { setOutcome(t('restore.done')); },
                });
              }}
            >
              {restore.isPending ? t('template.restoring') : t('template.restore')}
            </Button>
          ) : (
            <Button
              ref={openerRef}
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => { setOutcome(null); setPanel('retire'); }}
            >
              {t('template.retire')}
            </Button>
          )}
        </div>
      ) : null}

      {/*
        ===================================================================
        ⚠ A RESTORE THAT FAILED USED TO SHOW THE OPERATOR NOTHING AT ALL.
        ===================================================================

        `retire.error` renders inside the retire PANEL and `update.error`
        inside the edit panel. **Restore is a one-press action with no panel**,
        so there was nowhere its error could go — the button simply un-busied,
        the Template stayed retired, and no sentence appeared anywhere.

        **That is worse than a visible failure**: the operator sees a control
        they pressed, a Template that did not change, and no reason — so the
        reasonable next act is to press it again, which spends another audited
        write to be refused the same way.

        Found by auditing the six state families across the Template surfaces
        rather than by anything going red: **a MISSING state renders as nothing,
        and nothing is what a successful no-op looks like too.**

        It sits outside the `panel === 'none'` block on purpose, so it survives
        a panel opening underneath it, and it keeps `retire`'s
        forbidden-vs-other split — a refusal is a permission boundary and gets
        no retry.
      */}
      {restore.error !== null ? (
        <div className="mt-3">
          {restore.error.code === 'forbidden' ? (
            <PermissionDeniedBlock error={restore.error} />
          ) : (
            <ErrorBlock error={restore.error} />
          )}
        </div>
      ) : null}

      {panel === 'edit' ? (
        <EditTemplate template={template} panelRef={panelRef} onDone={closePanel} />
      ) : null}

      {panel === 'retire' ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`retire-heading-${template.template_id}`}
          className="rounded-[7px] border border-gold-500 bg-gold-50 p-4"
        >
          <h4
            id={`retire-heading-${template.template_id}`}
            className="text-[0.9375rem] font-bold text-ink"
          >
            {t('retire.title')}
          </h4>

          <h5 className="mt-3 text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('usage.heading')}
          </h5>
          <UsageLine usage={usage} />

          <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-soft">{t('retire.effect')}</p>
          {/*
            THE FACT THAT DECIDES THE ANSWER. Retiring does not free the name —
            which is why `restore` exists at all. A confirmation that omitted it
            would be asking the operator to agree to something they had not been
            told.
          */}
          <p className="mt-2 text-[0.875rem] leading-relaxed font-semibold text-ink">
            {t('retire.namePoint')}
          </p>

          {retire.error !== null ? (
            <div className="mt-3">
              {retire.error.code === 'forbidden' ? (
                <PermissionDeniedBlock error={retire.error} />
              ) : (
                <ErrorBlock error={retire.error} />
              )}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              busy={retire.isPending}
              disabled={busy}
              onClick={() => {
                retire.mutate(template.template_id, {
                  onSuccess: () => {
                    setOutcome(t('retire.done'));
                    /*
                      FOCUS RETURNS ON SUCCESS TOO, not only on Cancel. The
                      panel unmounts either way, so the "nothing looks wrong"
                      failure is identical — and this is the path an operator
                      takes when the action worked.
                    */
                    closePanel();
                  },
                });
              }}
            >
              {retire.isPending ? t('template.retiring') : t('retire.confirm')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={closePanel}>
              {t('template.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The adoption figure, in its four states.
 *
 * **`forbidden` IS RENDERED AS AN ABSENT FIGURE WITH A REASON, NEVER AS ZERO.**
 * `core.template-adoption.read` is a separate permission from
 * `core.template.list` on purpose — it counts across Organizations, which a
 * Template reader has no right to enumerate. **So an operator can legitimately
 * hold Template read and be refused this**, and rendering the refusal as "0"
 * would tell them nobody uses a Template that half the platform is using —
 * immediately before they retire it.
 */
function UsageLine({ usage }: { usage: ReturnType<typeof useTemplateUsage> }) {
  const t = useT();

  if (usage.isPending || usage.isFetching) {
    return <p className="mt-1 text-[0.875rem] text-ink-muted">{t('usage.counting')}</p>;
  }
  if (usage.error !== null) {
    return (
      <div className="mt-2">
        {usage.error.code === 'forbidden' ? (
          <div className="rounded-[7px] border border-line-strong bg-sunk p-3">
            <p className="text-[0.875rem] font-semibold text-ink">{t('usage.deniedTitle')}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft">
              {t('usage.deniedBody')}
            </p>
          </div>
        ) : (
          <ErrorBlock error={usage.error} onRetry={() => void usage.refetch()} />
        )}
      </div>
    );
  }

  const count = usage.data?.organizations_using ?? 0;
  return (
    <p className="mt-1 text-[0.9375rem] text-ink">
      {count === 0 ? (
        t('usage.none')
      ) : count === 1 ? (
        t('usage.someOne')
      ) : (
        <>
          <span className="font-bold tabular-nums">{count}</span> {t('usage.someMany')}
        </>
      )}
    </p>
  );
}

/**
 * Edit a name and the three labels.
 *
 * **AN UNTOUCHED FIELD IS NOT SENT.** The form seeds from the current values,
 * and only fields the operator actually changed go into the PATCH — sending
 * everything would make an edit of one label look, in the audit trail, like a
 * rewrite of the whole Template.
 */
function EditTemplate({
  template,
  panelRef,
  onDone,
}: {
  template: Template;
  /*
    THE REF IS PASSED IN RATHER THAN OWNED HERE, so the parent runs one focus
    rule for both panels. Two components each managing their own focus is how
    they drift — one of them ends up moving focus in and not back.
  */
  panelRef: RefObject<HTMLDivElement | null>;
  onDone: () => void;
}) {
  const { locale, t } = useLocale();
  const update = useUpdateTemplate();
  const [name, setName] = useState(template.name);
  const [labels, setLabels] = useState<Record<TemplateLevel, string>>({
    organization: template.level_labels.organization,
    workspace: template.level_labels.workspace,
    branch: template.level_labels.branch,
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string | null>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string | null> = {
      name: refusalText(templateNameRefusal(name), locale, t),
    };
    for (const level of TEMPLATE_LEVELS) {
      errors[level] = refusalText(templateLabelRefusal(labels[level]), locale, t);
    }
    setLocalErrors(errors);
    if (Object.values(errors).some((value) => value !== null)) return;

    const input: UpdateTemplateInput = {
      ...(name === template.name ? {} : { name }),
      ...(TEMPLATE_LEVELS.every((level) => labels[level] === template.level_labels[level])
        ? {}
        : { level_labels: labels }),
    };
    /* Nothing changed — do not spend an audited write to say so. */
    if (Object.keys(input).length === 0) {
      onDone();
      return;
    }
    update.mutate({ templateId: template.template_id, input }, { onSuccess: onDone });
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={`edit-heading-${template.template_id}`}
      className="rounded-[7px] border border-line bg-sunk p-4"
    >
      <form onSubmit={submit} noValidate className="grid gap-4">
      <h4 id={`edit-heading-${template.template_id}`} className="text-[0.9375rem] font-bold text-ink">
        {t('template.editTitle')}
      </h4>

      <Field id={`edit-name-${template.template_id}`} label={t('templates.nameLabel')} error={localErrors.name ?? null}>
        {(aria) => (
          <Input
            {...aria}
            value={name}
            onChange={(event) => { setName(event.target.value); }}
            disabled={update.isPending}
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
          />
        )}
      </Field>

      {TEMPLATE_LEVELS.map((level) => (
        <Field
          key={level}
          id={`edit-${level}-${template.template_id}`}
          label={t(LEVEL_TITLE_KEYS[level])}
          error={localErrors[level] ?? null}
        >
          {(aria) => (
            <Input
              {...aria}
              value={labels[level]}
              onChange={(event) => {
                setLabels((prev) => ({ ...prev, [level]: event.target.value }));
              }}
              disabled={update.isPending}
              maxLength={MAX_TEMPLATE_LABEL_LENGTH}
            />
          )}
        </Field>
      ))}

      {update.error !== null ? (
        update.error.code === 'forbidden' ? (
          <PermissionDeniedBlock error={update.error} />
        ) : (
          <ErrorBlock error={update.error} />
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" busy={update.isPending} disabled={update.isPending}>
          {update.isPending ? t('template.saving') : t('template.save')}
        </Button>
        <Button variant="secondary" size="sm" disabled={update.isPending} onClick={onDone}>
          {t('template.cancel')}
        </Button>
      </div>
      </form>
    </div>
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
/*
 * ⚠ THE LOCALE WAS `undefined` — THE BROWSER'S, NOT THE CONSOLE'S. One of SIX
 * date formatters in this console with the identical defect, all found together
 * by a sweep that should have been run before claiming the class was closed.
 *
 * An operator who switched to Arabic saw Arabic everywhere except the dates.
 * **It is never wrong in testing**, because the browser and the console agree
 * by default; it diverges only for the operator who deliberately switched.
 */
function CreatedAt({ value }: { value: string }): ReactNode {
  const { locale } = useLocale();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono">{value}</bdi>;
  }
  return (
    <time dateTime={value} title={value}>
      <bdi>
        {parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
      </bdi>
    </time>
  );
}
