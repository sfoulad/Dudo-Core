/**
 * The Organization's identity — its name, its commercial registration and its
 * VAT registration — displayed and edited.
 *
 * `organization-identity-v1`, `PATCH /platform/organizations/{id}/identity`.
 *
 * ===========================================================================
 * THE VERIFICATION RECORD IS THE POINT, SO IT IS RENDERED
 * ===========================================================================
 *
 * This route is `sensitive`, NOT `critical`, so there is no confirmation gate on
 * it — and that was argued rather than defaulted: making a VAT field critical
 * generalises to every field and the rung stops sorting anything. **The whole
 * argument for skipping the gate is that verification acts at the point of harm
 * instead.** A future surface that prints a VAT number onto a document must be
 * able to refuse to print an unverified one.
 *
 * *** A SCREEN THAT SHOWS THE NUMBER AND HIDES WHETHER ANYONE CHECKED IT
 * DESTROYS THAT ARGUMENT. *** So `verification` is never decoration here: an
 * unverified number is visibly unverified, and a verified one names the operator
 * and the date. There is no state in which a number appears without its
 * provenance beside it.
 *
 * ===========================================================================
 * THREE STATES, NOT TWO, AND COLLAPSING THE FIRST TWO IS THE DEFECT
 * ===========================================================================
 *
 *   not_recorded    NOBODY HAS ASKED.
 *   not_registered  THE CUSTOMER STATED THEY HAVE NONE — a legitimate,
 *                   permanent, positive fact, not an unfilled field.
 *   registered      A number is recorded, verified or not.
 *
 * Bahrain VAT registration is mandatory above an annual-supplies threshold and
 * voluntary below it, so `not_registered` is an ANSWER. A console that rendered
 * it as missing data would keep prompting a customer who has already replied,
 * and would leave an operator unable to tell "they told us" from "we never
 * asked". The two are styled and worded differently here for that reason.
 *
 * ===========================================================================
 * EDITING A NUMBER CLEARS ITS VERIFICATION, AND THIS FORM SHOWS THAT BEFORE
 * THE OPERATOR PRESSES SAVE
 * ===========================================================================
 *
 * "A verification attests to A SPECIFIC VALUE. Carrying a prior verification
 * across an edited number would make the record confidently wrong — it would say
 * an operator checked a number nobody ever checked, with a real name and a real
 * date attached, which is worse than an unverified number because it defends
 * itself."
 *
 * Core discards the verification on any change to `number`. THIS FORM MIRRORS
 * THAT IN THE UI RATHER THAN LETTING THE OPERATOR DISCOVER IT AFTERWARDS: typing
 * a different number unticks the verified box and says why. The alternative — a
 * box left ticked from the previous value — is an operator claiming to have
 * checked a number they have just replaced.
 *
 * ===========================================================================
 * NOTHING IS SENT THAT DID NOT CHANGE
 * ===========================================================================
 *
 * The update is partial: an omitted field is unchanged, a present one is
 * replaced whole. Re-sending an unchanged registration is not a no-op — it
 * RE-STAMPS the record with today's operator and today's date, destroying the
 * original provenance. So the submitted body is a DIFF against what was loaded,
 * and an unchanged field is omitted rather than echoed.
 *
 * And a save with nothing changed is refused locally, because "a no-op here
 * still writes a platform audit record and FIVE ROW-WRITES INTO THE CUSTOMER'S
 * OWN DAILY ALLOCATION."
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { cn } from '@dudo/ui';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REGISTRATION_NUMBER_LENGTH,
  displayNameRefusal,
  registrationNumberRefusal,
  type OrganizationIdentity,
  type PlatformClient,
  type RegistrationInput,
  type RegistrationRecord,
  type RegistrationState,
  type UpdateOrganizationIdentityInput,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';
import {
  fill,
  formatCount,
  refusalText,
  useLocale,
  useT,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';

/**
 * The two registrations, described rather than branched on.
 *
 * THE REGISTRY IS FIXED BY WHICH FIELD THIS IS and the contract carries no
 * `registry` field, deliberately — "a vocabulary invented from two known
 * instances". So the registry name lives here, in the client, where it is
 * presentation rather than data.
 */
/**
 * ===========================================================================
 * THE TABLE HOLDS KEYS, NOT SENTENCES — AND THE REGISTRY NAMES ARE THE
 * INTERESTING PART
 * ===========================================================================
 *
 * `label`, `short`, `registry` and `noneMeans` were four English strings per
 * kind, and every one of them appears INSIDE another sentence — *"Nobody has
 * confirmed it against Sijilat"*, *"they have no CR"*. So they are keys, and the
 * sentences that name them use `{kind}` / `{registry}` placeholders rather than
 * being split into fragments a translator cannot read.
 *
 * ⚠ **`Sijilat` AND `the National Bureau for Revenue` ARE REAL INSTITUTIONS AND
 * ARE NAMED, NOT TRANSLATED-BY-GUESS.** Sijilat is Bahrain's commercial
 * registration portal and is written سجلات; the Bureau's own Arabic name is
 * الجهاز الوطني للإيرادات. **An operator is being told which registry to go and
 * check a number against** — a paraphrase would send them looking for an
 * organisation that does not exist under that name.
 *
 * This is the one place in the copy pass where getting a word wrong sends
 * somebody to the wrong office rather than merely reading oddly.
 */
interface RegistrationKind {
  readonly key: 'commercial_registration' | 'vat_registration';
  readonly labelKey: MessageKey;
  readonly shortKey: MessageKey;
  readonly registryKey: MessageKey;
  /** What `not_registered` means for THIS registration, in the customer's terms. */
  readonly noneMeansKey: MessageKey;
}

/* "N fields were updated" / "N fields will be sent" — six Arabic forms each. */
const UPDATED_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'identity.updated.zero',
  one: 'identity.updated.one',
  two: 'identity.updated.two',
  few: 'identity.updated.few',
  many: 'identity.updated.many',
  other: 'identity.updated.other',
};

const WILL_SEND_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'identity.willSend.zero',
  one: 'identity.willSend.one',
  two: 'identity.willSend.two',
  few: 'identity.willSend.few',
  many: 'identity.willSend.many',
  other: 'identity.willSend.other',
};

const KINDS: readonly RegistrationKind[] = [
  {
    key: 'commercial_registration',
    labelKey: 'identity.cr.label',
    shortKey: 'identity.cr.short',
    registryKey: 'identity.cr.registry',
    noneMeansKey: 'identity.cr.noneMeans',
  },
  {
    key: 'vat_registration',
    labelKey: 'identity.vat.label',
    shortKey: 'identity.vat.short',
    registryKey: 'identity.vat.registry',
    noneMeansKey: 'identity.vat.noneMeans',
  },
];

/** One registration as the form holds it, before it becomes a `RegistrationInput`. */
interface RegistrationDraft {
  /** `null` when the loaded state is one this build does not recognise. */
  readonly state: RegistrationState | null;
  readonly number: string;
  readonly verified: boolean;
  /** Re-record today's date against an existing `not_registered` declaration. */
  readonly redeclare: boolean;
}

interface Draft {
  readonly display_name: string;
  readonly commercial_registration: RegistrationDraft;
  readonly vat_registration: RegistrationDraft;
}

function draftFor(record: RegistrationRecord): RegistrationDraft {
  if (record.state === 'registered') {
    return {
      state: 'registered',
      number: record.number,
      /*
       * SEEDED FROM WHETHER A VERIFICATION EXISTS, not from a stored boolean —
       * there is no stored boolean. `verified` on the write path is a CLAIM
       * ("I have just checked this"), and seeding it true for an
       * already-verified record is correct only for as long as the number is
       * untouched. `numberChanged` below is what keeps that true.
       */
      verified: record.verification !== null,
      redeclare: false,
    };
  }
  if (record.state === 'not_recorded' || record.state === 'not_registered') {
    return { state: record.state, number: '', verified: false, redeclare: false };
  }
  return { state: null, number: '', verified: false, redeclare: false };
}

function draftFrom(identity: OrganizationIdentity): Draft {
  return {
    display_name: identity.display_name ?? '',
    commercial_registration: draftFor(identity.commercial_registration),
    vat_registration: draftFor(identity.vat_registration),
  };
}

/**
 * What this registration would send, or `undefined` when nothing changed.
 *
 * OMITTING AN UNCHANGED FIELD IS THE WHOLE JOB. Re-sending `not_registered`
 * re-stamps `declared_at`; re-sending `registered` with `verified: true`
 * re-stamps the operator and the date onto a verification somebody else
 * performed. Both destroy provenance while looking like a save.
 */
function registrationChange(
  draft: RegistrationDraft,
  current: RegistrationRecord,
): RegistrationInput | undefined {
  if (draft.state === null) return undefined;

  if (draft.state === 'not_recorded') {
    return current.state === 'not_recorded' ? undefined : { state: 'not_recorded' };
  }

  if (draft.state === 'not_registered') {
    if (current.state !== 'not_registered') return { state: 'not_registered' };
    // Already declared. Only an explicit re-declaration re-dates it.
    return draft.redeclare ? { state: 'not_registered' } : undefined;
  }

  const number = draft.number;
  if (current.state !== 'registered') {
    return { state: 'registered', number, verified: draft.verified };
  }
  const wasVerified = current.verification !== null;
  if (number === current.number && draft.verified === wasVerified) return undefined;
  return { state: 'registered', number, verified: draft.verified };
}

export function OrganizationIdentityPanel({
  platform,
  organizationId,
  identity,
  onSaved,
}: {
  platform: PlatformClient;
  organizationId: string;
  identity: OrganizationIdentity;
  onSaved: (identity: OrganizationIdentity) => void;
}) {
  const { locale, t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(identity));
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [numberErrors, setNumberErrors] = useState<Readonly<Record<string, string | null>>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  /*
   * ===========================================================================
   * ⚠ THIS SURFACE HAD NO FOCUS MANAGEMENT AT ALL — NOT EVEN A CALL THAT DID
   * NOTHING
   * ===========================================================================
   *
   * Pressing Edit swaps a read view for a form; pressing Cancel swaps it back.
   * **Neither moved focus.** A keyboard user pressed Edit and stayed on a
   * button that had just been replaced by a fieldset, then pressed Cancel and
   * stayed on a Cancel button that no longer existed — both times landing on
   * `<body>` with nothing announced.
   *
   * It is the same defect as the confirmation gate and the two Template panels,
   * **without even the appearance of a fix**: there was no line to read as
   * working. My own focus audit scored this file blank on both columns and I
   * treated the panels that had a non-functional call as the better case.
   *
   * `formRef` takes focus on open and `editRef` gets it back on cancel, with
   * the restore in an effect because **the Edit button is unmounted while the
   * form is up** — the same reason the other three needed one.
   *
   * **SAVE IS DELIBERATELY NOT A DISMISSAL.** On success `headingRef` already
   * takes focus, beside the "N fields were updated" status — that is the
   * outcome the operator needs, and dragging them back to Edit would replace an
   * announcement with a button.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (editing) formRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing && cancelledRef.current) {
      cancelledRef.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  const startEditing = useCallback(() => {
    setDraft(draftFrom(identity));
    setLocalError(null);
    setNameError(null);
    setNumberErrors({});
    setFailure(null);
    setSaved(null);
    setEditing(true);
  }, [identity]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setEditing(false);
    setLocalError(null);
    setNameError(null);
    setNumberErrors({});
    setFailure(null);
  }, []);

  /*
   * ESCAPE CANCELS THE EDIT, like every other dismissible surface here — and it
   * is bound only while editing AND not saving. **Escape during a save would
   * abandon the form while a write is in flight**, leaving the operator with no
   * view of whether their change landed.
   */
  useEffect(() => {
    if (!editing || saving) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancel, editing, saving]);

  /** The diff. Recomputed on every render so the save button can reflect it. */
  const change = useMemo<UpdateOrganizationIdentityInput>(() => {
    const input: {
      display_name?: string;
      commercial_registration?: RegistrationInput;
      vat_registration?: RegistrationInput;
    } = {};
    if (draft.display_name !== '' && draft.display_name !== (identity.display_name ?? '')) {
      input.display_name = draft.display_name;
    }
    for (const kind of KINDS) {
      const next = registrationChange(draft[kind.key], identity[kind.key]);
      if (next !== undefined) input[kind.key] = next;
    }
    return input;
  }, [draft, identity]);

  const changedCount = Object.keys(change).length;

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;

      /*
       * LOCAL SHAPE CHECKS ONLY, AND EVERY ONE IS ABOUT WHAT THE OPERATOR JUST
       * TYPED. None is a fact about stored data, so refusing here discloses
       * nothing — and it spares this customer five row-writes on a request Core
       * would refuse anyway.
       */
      let firstProblem: string | null = null;
      const nextNumberErrors: Record<string, string | null> = {};

      const nameRefusal =
        change.display_name === undefined
          ? null
          : refusalText(displayNameRefusal(change.display_name), locale, t);
      setNameError(nameRefusal);
      if (nameRefusal !== null) firstProblem = nameRefusal;

      for (const kind of KINDS) {
        const proposed = change[kind.key];
        const refusal =
          proposed !== undefined && proposed.state === 'registered'
            ? refusalText(registrationNumberRefusal(proposed.number), locale, t)
            : null;
        nextNumberErrors[kind.key] = refusal;
        if (refusal !== null && firstProblem === null) firstProblem = refusal;
      }
      setNumberErrors(nextNumberErrors);
      if (firstProblem !== null) {
        setLocalError(null);
        return;
      }

      if (changedCount === 0) {
        /*
         * NOTHING CHANGED, SO NOTHING IS SENT. `minProperties: 1` — an empty
         * body is `invalid_argument`, and a request that spends a customer's
         * budget to change nothing should not have been made.
         */
        setLocalError(
          'Nothing has changed, so nothing was sent. Saving an unchanged record would still ' +
            'spend five of this business’s daily writes and would re-date any verification.',
        );
        return;
      }

      setLocalError(null);
      setFailure(null);
      setSaving(true);

      void platform.updateOrganizationIdentity(organizationId, change).then(
        (updated) => {
          setSaving(false);
          setEditing(false);
          /*
            ⚠ A PLURAL TERNARY IN AN EXPRESSION — invisible to the copy pin,
            which reads JSX TEXT NODES. Six Arabic forms, chosen by `Intl`.
          */
          setSaved(formatCount(locale, changedCount, UPDATED_FORMS, t));
          onSaved(updated);
          headingRef.current?.focus();
        },
        (thrown: unknown) => {
          setSaving(false);
          setFailure(toApiError(thrown));
        },
      );
    },
    [change, changedCount, onSaved, organizationId, platform, saving],
  );

  return (
    <section
      aria-labelledby="identity-heading"
      className="mt-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="identity-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-bold text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy-600"
          >
            {t('identity.heading')}
          </h2>
          <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
            {t('identity.intro')}
          </p>
        </div>
        {!editing ? (
          <Button ref={editRef} variant="secondary" size="sm" onClick={startEditing}>
            {t('identity.edit')}
          </Button>
        ) : null}
      </div>

      {saved !== null && !editing ? (
        <p
          role="status"
          className="mt-4 rounded-[7px] border border-green-500 bg-green-50 p-3 text-[0.875rem] font-semibold text-green-700"
        >
          {saved} {t('identity.savedWholeRecord')}
        </p>
      ) : null}

      {!editing ? (
        <IdentityReadView identity={identity} />
      ) : (
        /*
          FOCUS LANDS ON THE FORM, NOT ON ITS FIRST FIELD. `tabIndex={-1}` makes
          it programmatically focusable without joining the tab order, and
          `aria-label` is what a screen reader announces on arrival — so the
          first thing heard is *what this form is*, not the label of a field
          whose purpose has not been introduced.
        */
        <form
          ref={formRef}
          tabIndex={-1}
          aria-label={t('identity.editForm')}
          onSubmit={submit}
          noValidate
          className="mt-5 grid gap-6 outline-none focus-visible:ring-2 focus-visible:ring-navy-600"
        >
          {failure ? <SaveFailure failure={failure} /> : null}

          <Field
            id="identity-display-name"
            label={t('identity.nameLabel')}
            error={nameError}
            hint={
              identity.display_name === null
                ? `No name has ever been recorded for this business. At most ${String(MAX_DISPLAY_NAME_LENGTH)} characters. Names are not unique in Dudo — two businesses may legitimately share one.`
                : `At most ${String(MAX_DISPLAY_NAME_LENGTH)} characters. Names are not unique in Dudo — two businesses may legitimately share one.`
            }
          >
            {(aria) => (
              <Input
                {...aria}
                type="text"
                value={draft.display_name}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((previous) => ({ ...previous, display_name: value }));
                  if (nameError !== null) setNameError(null);
                  if (localError !== null) setLocalError(null);
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
              />
            )}
          </Field>

          {/*
            THE NAME CANNOT BE CLEARED, AND THE FORM SAYS SO RATHER THAN
            SILENTLY IGNORING AN EMPTIED FIELD. `display_name` has no null on
            the write path: renaming is permitted, un-naming is not, because
            null is a legacy state rather than a choice.
          */}
          {identity.display_name !== null && draft.display_name === '' ? (
            <p className="-mt-3 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
              <span className="font-semibold">{t('identity.nameCannotBeRemoved')}</span>{' '}
              Leaving this blank changes nothing — Dudo has no way to un-name a business, because
              &ldquo;no name recorded&rdquo; describes businesses that predate the field rather
              than a state anyone chooses. Type a different name to rename it.
            </p>
          ) : null}

          {KINDS.map((kind) => (
            <RegistrationFieldset
              key={kind.key}
              kind={kind}
              current={identity[kind.key]}
              draft={draft[kind.key]}
              error={numberErrors[kind.key] ?? null}
              disabled={saving}
              onChange={(next) => {
                setDraft((previous) => ({ ...previous, [kind.key]: next }));
                if (localError !== null) setLocalError(null);
                setNumberErrors((previous) => ({ ...previous, [kind.key]: null }));
              }}
            />
          ))}

          {localError !== null ? (
            <p
              role="alert"
              className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem] leading-relaxed text-scarlet-700"
            >
              {localError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="submit" variant="primary" disabled={saving} busy={saving}>
              {saving ? t('identity.saving') : t('identity.saveChanges')}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={cancel}>
              {t('gate.cancel')}
            </Button>
            {/*
              WHAT WILL BE SENT, COUNTED, BEFORE THE PRESS. The update is a diff
              and an unchanged field is omitted — so an operator who expects
              three fields to be written and reads "1 field" here has caught a
              misunderstanding before it costs a customer's write budget.
            */}
            <p aria-live="polite" className="text-[0.8125rem] text-ink-muted">
              {/* "Nothing has changed YET" — the fact is that nothing has. */}
              {changedCount === 0
                ? t('identity.nothingChangedDraft')
                : formatCount(locale, changedCount, WILL_SEND_FORMS, t)}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}

/* =========================================================================
   READ VIEW
   ========================================================================= */

function IdentityReadView({ identity }: { identity: OrganizationIdentity }) {
  const t = useT();
  return (
    <dl className="mt-5 grid gap-5">
      <div className="min-w-0">
        <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
          {t('identity.nameLabel')}
        </dt>
        <dd className="mt-1">
          {identity.display_name === null ? (
            /*
              NO NAME IS A REAL STATE AND IS RENDERED AS ONE. Not a blank, not a
              dash, not "Unnamed Organization" — an invented name is
              indistinguishable from a typed one forever, and two consoles
              inventing two different ones is the divergence the one-contract
              rule exists to prevent. The identifier is what stands in its place,
              and it is already the page heading.
            */
            <div className="rounded-[7px] border border-line bg-sunk/60 p-3">
              <p className="text-[0.875rem] font-semibold text-ink-soft">{t('identity.noName')}</p>
              <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
                {t('identity.noNameExplainBefore')}{' '}
                <span className="font-semibold">{t('identity.edit')}</span>{' '}
                {t('identity.noNameExplainAfter')}
              </p>
            </div>
          ) : (
            <p className="text-[0.9375rem] font-semibold break-words text-ink">
              {identity.display_name}
            </p>
          )}
        </dd>
      </div>

      {KINDS.map((kind) => (
        <div key={kind.key} className="min-w-0 border-t border-line pt-4">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t(kind.labelKey)}
          </dt>
          <dd className="mt-1">
            <RegistrationReadView kind={kind} record={identity[kind.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RegistrationReadView({
  kind,
  record,
}: {
  kind: RegistrationKind;
  record: RegistrationRecord;
}) {
  const { locale, t } = useLocale();
  if (record.state === 'not_recorded') {
    return (
      <div>
        <p className="text-[0.875rem] font-semibold text-ink-soft">{t('identity.notRecorded')}</p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          {t('identity.notRecorded.body')}{' '}
          {/*
            THE EMPHASIS IS LOAD-BEARING. *Not recorded* and *they have none* are
            different facts about a customer, and this is the sentence that keeps
            them apart — an operator who reads the first as the second stops
            asking a question nobody has answered.
          */}
          <span className="font-semibold">
            {fill(t('identity.notRecorded.notNone'), locale, { kind: t(kind.shortKey) })}
          </span>
        </p>
      </div>
    );
  }

  if (record.state === 'not_registered') {
    /*
      A POSITIVE FACT, STYLED AS AN ANSWER RATHER THAN AS A GAP. "The customer
      stated they have none" is legitimate and permanent — below the VAT
      threshold, or an entity with no commercial registration. Rendering it like
      "not recorded" would make an operator ask a customer who has already
      answered.
    */
    return (
      <div>
        <p className="text-[0.875rem] font-semibold text-ink">
          {fill(t('identity.notRegistered.states'), locale, { kind: t(kind.shortKey) })}
        </p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          {t('identity.recordedOn')} <Timestamp value={record.declared_at} />{' '}
          {fill(t('identity.notRegistered.answerNotGap'), locale, {
            meaning: t(kind.noneMeansKey),
          })}{' '}
          <span className="font-semibold">{t('identity.notRegistered.itDates')}</span>{' '}
          {t('identity.notRegistered.notCircumstances')}
        </p>
      </div>
    );
  }

  if (record.state === 'registered') {
    return (
      <div>
        <p className="text-[0.9375rem] text-ink">
          <bdi className="font-mono break-all select-all">{record.number}</bdi>
        </p>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          {t('identity.numberRecorded')} <Timestamp value={record.recorded_at} />
        </p>
        <VerificationBadge kind={kind} verification={record.verification} />
      </div>
    );
  }

  /*
    A STATE THIS BUILD DOES NOT KNOW. Shown verbatim rather than hidden or
    mapped onto "not recorded" — telling an operator nobody had asked, when the
    truth is that this console cannot read the answer, is a false statement
    about a customer.
  */
  return (
    <div className="rounded-[7px] border border-gold-500 bg-gold-50 p-3">
      <p className="text-[0.875rem] font-semibold text-ink">{t('identity.unknownRecord')}</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink">
        {t('identity.unknownStateBefore')} <code className="font-mono">{record.raw}</code>{' '}
        {t('identity.unknownStateAfter')}
      </p>
    </div>
  );
}

/**
 * VERIFIED OR NOT, ALWAYS SHOWN, NEVER OMITTED.
 *
 * This is the element that carries the argument for this route not being
 * confirmation-gated. An unverified number is a number an operator typed; a
 * verified one is a number an operator checked against the issuing registry, on
 * a date, under their own principal id. Those are the two things the whole shape
 * exists to keep apart, and a screen that showed only the digits would erase the
 * difference.
 */
function VerificationBadge({
  kind,
  verification,
}: {
  kind: RegistrationKind;
  verification: { readonly verified_by_principal_id: string; readonly verified_at: string } | null;
}) {
  const { locale, t } = useLocale();
  const registry = t(kind.registryKey);
  if (verification === null) {
    return (
      <div className="mt-2 rounded-[7px] border border-gold-500 bg-gold-50 p-3">
        <p className="text-[0.875rem] font-semibold text-ink">{t('identity.notVerified')}</p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink">
          {fill(t('identity.notVerified.body'), locale, { registry })}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-[7px] border border-green-500 bg-green-50 p-3">
      <p className="text-[0.875rem] font-semibold text-green-700">
        {fill(t('identity.verified.title'), locale, { registry })}
      </p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft">
        {t('identity.verified.checkedBy')}{' '}
        <bdi className="font-mono break-all select-all">
          {verification.verified_by_principal_id}
        </bdi>{' '}
        {t('identity.verified.on')} <Timestamp value={verification.verified_at} />{' '}
        {/*
          THIS SENTENCE IS THE WHOLE ARGUMENT FOR THE TICK NOT BEING A SYSTEM
          FACT. Dudo cannot confirm a check happened; there is no registry API.
          **A translation that shortened it to "verified" would turn a named
          operator's assertion into something the system knows**, which is the
          distinction this component exists to keep.
        */}
        {fill(t('identity.verified.noApi'), locale, { registry })}
      </p>
    </div>
  );
}

/* =========================================================================
   EDIT VIEW
   ========================================================================= */

function RegistrationFieldset({
  kind,
  current,
  draft,
  error,
  disabled,
  onChange,
}: {
  kind: RegistrationKind;
  current: RegistrationRecord;
  draft: RegistrationDraft;
  error: string | null;
  disabled: boolean;
  onChange: (next: RegistrationDraft) => void;
}) {
  const { locale, t } = useLocale();
  const groupId = useId();
  const numberFieldId = `${groupId}-number`;

  const currentNumber = current.state === 'registered' ? current.number : null;
  const wasVerified = current.state === 'registered' && current.verification !== null;
  /*
   * THE TRAP, MADE VISIBLE. Core discards the verification on ANY change to
   * `number`, so a box left ticked from the previous value would be an operator
   * claiming to have checked a number they have just replaced. The tick is
   * removed by `setNumber` below; this only explains why.
   */
  const numberChanged =
    draft.state === 'registered' && currentNumber !== null && draft.number !== currentNumber;

  const setState = (state: RegistrationState) => {
    onChange({ ...draft, state, redeclare: false });
  };

  const setNumber = (value: string) => {
    onChange({
      ...draft,
      number: value,
      // Editing the number withdraws the verification claim, because Core
      // discards the verification the claim would have produced.
      verified: currentNumber !== null && value !== currentNumber ? false : draft.verified,
    });
  };

  return (
    <fieldset
      className="grid gap-3 rounded-[7px] border border-line p-4"
      aria-describedby={`${groupId}-help`}
    >
      <legend className="px-1 text-[0.8125rem] font-semibold tracking-[0.01em] text-ink-soft">
        {t(kind.labelKey)}
      </legend>

      <p id={`${groupId}-help`} className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
        {t('identity.twoAnswers')}
      </p>

      {draft.state === null ? (
        <p className="rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
          <span className="font-semibold">{t('identity.unrecognisedStored')}</span>{' '}
          {t('identity.overwriteWarnBefore')} <em>{t('identity.overwrites')}</em>{' '}
          {t('identity.overwriteWarnAfter')}
        </p>
      ) : null}

      <div className="grid gap-2">
        {(
          [
            ['not_recorded', t('identity.choice.notRecorded')],
            [
              'not_registered',
              fill(t('identity.choice.notRegistered'), locale, { kind: t(kind.shortKey) }),
            ],
            ['registered', t('identity.choice.registered')],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink"
          >
            <input
              type="radio"
              name={groupId}
              value={value}
              checked={draft.state === value}
              disabled={disabled}
              onChange={() => {
                setState(value);
              }}
              className="mt-1 size-4 shrink-0 accent-navy-600"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {draft.state === 'registered' ? (
        <div className="grid gap-3 border-t border-line pt-3">
          <Field
            id={numberFieldId}
            label={fill(t('identity.numberLabel'), locale, { kind: t(kind.shortKey) })}
            error={error}
            hint={fill(t('identity.numberHint'), locale, {
              registry: t(kind.registryKey),
              max: MAX_REGISTRATION_NUMBER_LENGTH,
            })}
          >
            {(aria) => (
              <Input
                {...aria}
                type="text"
                value={draft.number}
                onChange={(event) => {
                  setNumber(event.target.value);
                }}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                disabled={disabled}
                maxLength={MAX_REGISTRATION_NUMBER_LENGTH}
                className="font-mono"
              />
            )}
          </Field>

          {numberChanged && wasVerified ? (
            <p
              role="status"
              className="rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink"
            >
              <span className="font-semibold">
                {t('identity.numberChangeClearsVerification')}
              </span>{' '}
              {t('identity.verificationCleared.why')}{' '}
              {/*
                THE EMPHASIS IS ON "THE NEW NUMBER" AS A PHRASE, not on the word
                "new" alone. English puts the adjective before the noun and
                Arabic after it, so an `<em>` wrapped around one word lands in a
                different place in each — and an emphasis that moves is an
                emphasis that is wrong in one of the two languages.
              */}
              {t('identity.verificationCleared.tickAgainBefore')}{' '}
              <em>{t('identity.theNewNumber')}</em>{' '}
              {fill(t('identity.verificationCleared.tickAgainAfter'), locale, {
                registry: t(kind.registryKey),
              })}
            </p>
          ) : null}

          <label className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink">
            <input
              type="checkbox"
              checked={draft.verified}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...draft, verified: event.target.checked });
              }}
              className="mt-1 size-4 shrink-0 accent-navy-600"
            />
            {/*
              A CLAIM IN THE FIRST PERSON, NOT A STATUS. Dudo cannot confirm a
              check happened — there is no registry API — so what makes this
              worth having is that the claim is attributed and dated. Wording it
              as "Verified" would make it look like something the system knows.
            */}
            <span>
              {/*
                FIRST PERSON, AND IT MUST STAY FIRST PERSON IN TRANSLATION. "I
                have checked this number against X" is a claim the operator makes
                and Dudo attributes to them. **"Verified against X" would read as
                something the system knows** — and nothing checks it, because
                there is no registry API. The grammatical person is the security
                property here.
              */}
              <span className="font-semibold">
                {fill(t('identity.verifyClaim'), locale, { registry: t(kind.registryKey) })}
              </span>{' '}
              {t('identity.verifyClaim.what')}
            </span>
          </label>

          {wasVerified && !draft.verified && !numberChanged ? (
            <p className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
              <span className="font-semibold">{t('identity.untickRemovesVerification')}</span>{' '}
              {t('identity.untickRemoves.what')}
            </p>
          ) : null}
        </div>
      ) : null}

      {draft.state === 'not_registered' && current.state === 'not_registered' ? (
        <label className="flex items-start gap-2 border-t border-line pt-3 text-[0.875rem] leading-relaxed text-ink">
          <input
            type="checkbox"
            checked={draft.redeclare}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...draft, redeclare: event.target.checked });
            }}
            className="mt-1 size-4 shrink-0 accent-navy-600"
          />
          <span>
            <span className="font-semibold">{t('identity.verifyMeaning')}</span>{' '}
            {t('identity.redeclare.what')}
          </span>
        </label>
      ) : null}

      {draft.state === 'not_recorded' && current.state !== 'not_recorded' ? (
        <p className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
          <span className="font-semibold">{t('identity.destroys')}</span>{' '}
          {t('identity.destroys.what')}
        </p>
      ) : null}
    </fieldset>
  );
}

function SaveFailure({ failure }: { failure: ApiError }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
    >
      <p className="font-bold text-scarlet-700">
        {failure.code === 'forbidden'
          ? t('identity.failed.forbidden')
          : failure.code === 'not_found'
            ? t('identity.failed.notFound')
            : failure.code === 'quota_exceeded'
              ? t('identity.failed.quota')
              : t('identity.failed.other')}
      </p>
      <p className="mt-1 leading-relaxed text-ink-soft">
        {failure.code === 'forbidden' ? (
          /*
            SCREEN-SPECIFIC, AND NOT A DUPLICATE OF `error.body.forbidden`.
            That sentence must be true of all FOUR collapsed conditions and
            therefore names none of them. **Here the operation is known** —
            changing an Organization's identity — so the console can say which
            permission is missing without claiming anything about why.
          */
          <>
            {t('identity.failed.forbiddenBody')}{' '}
            <span className="font-semibold">{t('identity.nothingChanged')}</span>{' '}
            {t('identity.failed.forbiddenTail')}
          </>
        ) : failure.code === 'not_found' ? (
          <>
            {t('identity.failed.notFoundBody')}{' '}
            <span className="font-semibold">{t('identity.nothingChanged')}</span>
          </>
        ) : failure.code === 'quota_exceeded' ? (
          <>
            {t('identity.failed.quotaBody')}{' '}
            <span className="font-semibold">{t('identity.nothingChanged')}</span>{' '}
            {t('identity.failed.quotaTail')}
          </>
        ) : (
          <>
            {failure.message} <span className="font-semibold">{t('identity.nothingChanged')}</span>{' '}
            {t('identity.wholeOrNothing')}
          </>
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
  );
}

/**
 * A server-stamped instant.
 *
 * RFC 3339 UTC with exactly three fractional digits, rendered in the reader's
 * own locale with the machine-readable original kept in `dateTime` and `title` —
 * AN OPERATOR COMPARING THIS TO AN AUDIT RECORD NEEDS THE ORIGINAL. A value that
 * does not parse is shown verbatim rather than as "Invalid Date".
 */
/* The locale was `undefined` — the browser's. See `Templates.tsx`'s `CreatedAt`. */
function Timestamp({ value }: { value: string }) {
  const { locale } = useLocale();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono text-xs break-all">{value}</bdi>;
  }
  return (
    <time dateTime={value} title={value} className={cn('whitespace-nowrap')}>
      <bdi>
        {parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
      </bdi>
    </time>
  );
}
