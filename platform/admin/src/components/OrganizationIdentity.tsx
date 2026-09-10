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

import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react';
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

/**
 * The two registrations, described rather than branched on.
 *
 * THE REGISTRY IS FIXED BY WHICH FIELD THIS IS and the contract carries no
 * `registry` field, deliberately — "a vocabulary invented from two known
 * instances". So the registry name lives here, in the client, where it is
 * presentation rather than data.
 */
interface RegistrationKind {
  readonly key: 'commercial_registration' | 'vat_registration';
  readonly label: string;
  readonly short: string;
  readonly registry: string;
  /** What `not_registered` means for THIS registration, in the customer's terms. */
  readonly noneMeans: string;
}

const KINDS: readonly RegistrationKind[] = [
  {
    key: 'commercial_registration',
    label: 'Commercial registration (CR)',
    short: 'CR',
    registry: 'Sijilat',
    noneMeans: 'an entity with no commercial registration',
  },
  {
    key: 'vat_registration',
    label: 'VAT registration',
    short: 'VAT',
    registry: 'the National Bureau for Revenue',
    noneMeans: 'a business below the VAT threshold, for which registration is voluntary',
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(identity));
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [numberErrors, setNumberErrors] = useState<Readonly<Record<string, string | null>>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

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
    setEditing(false);
    setLocalError(null);
    setNameError(null);
    setNumberErrors({});
    setFailure(null);
  }, []);

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
        change.display_name === undefined ? null : displayNameRefusal(change.display_name);
      setNameError(nameRefusal);
      if (nameRefusal !== null) firstProblem = nameRefusal;

      for (const kind of KINDS) {
        const proposed = change[kind.key];
        const refusal =
          proposed !== undefined && proposed.state === 'registered'
            ? registrationNumberRefusal(proposed.number)
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
          setSaved(
            changedCount === 1 ? 'One field was updated.' : `${String(changedCount)} fields were updated.`,
          );
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
            Who this business is
          </h2>
          <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
            The name Dudo shows for them, and the two government registrations the platform
            records. Operator-entered — there is no Sijilat or NBR integration, so every value here
            was typed by someone.
          </p>
        </div>
        {!editing ? (
          <Button variant="secondary" size="sm" onClick={startEditing}>
            Edit
          </Button>
        ) : null}
      </div>

      {saved !== null && !editing ? (
        <p
          role="status"
          className="mt-4 rounded-[7px] border border-green-500 bg-green-50 p-3 text-[0.875rem] font-semibold text-green-700"
        >
          {saved} Core answered with the whole record, and it is what is shown below.
        </p>
      ) : null}

      {!editing ? (
        <IdentityReadView identity={identity} />
      ) : (
        <form onSubmit={submit} noValidate className="mt-5 grid gap-6">
          {failure ? <SaveFailure failure={failure} /> : null}

          <Field
            id="identity-display-name"
            label="Name"
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
              <span className="font-semibold">A name cannot be removed once it exists.</span>{' '}
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
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
            {/*
              WHAT WILL BE SENT, COUNTED, BEFORE THE PRESS. The update is a diff
              and an unchanged field is omitted — so an operator who expects
              three fields to be written and reads "1 field" here has caught a
              misunderstanding before it costs a customer's write budget.
            */}
            <p aria-live="polite" className="text-[0.8125rem] text-ink-muted">
              {changedCount === 0
                ? 'Nothing has changed yet.'
                : changedCount === 1
                  ? '1 field will be sent. The others are left untouched.'
                  : `${String(changedCount)} fields will be sent. The others are left untouched.`}
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
  return (
    <dl className="mt-5 grid gap-5">
      <div className="min-w-0">
        <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">Name</dt>
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
              <p className="text-[0.875rem] font-semibold text-ink-soft">No name recorded.</p>
              <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
                Nobody has given this business a name in Dudo, so it is known by the identifier at
                the top of this page. That is normal for a business onboarded before names existed
                — it is not an error and nothing is missing. Press{' '}
                <span className="font-semibold">Edit</span> to record one.
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
            {kind.label}
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
  if (record.state === 'not_recorded') {
    return (
      <div>
        <p className="text-[0.875rem] font-semibold text-ink-soft">Not recorded</p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          Nobody has asked, or nobody has entered the answer.{' '}
          <span className="font-semibold">
            This does not mean they have no {kind.short} — it means Dudo does not know.
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
          The customer states they have no {kind.short}.
        </p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
          Recorded <Timestamp value={record.declared_at} />. This is an answer, not a gap —
          typically {kind.noneMeans}. It dates{' '}
          <span className="font-semibold">Dudo&rsquo;s record of the statement</span>, not their
          circumstances: a business that registers tomorrow does not make this false, it makes it
          stale.
        </p>
      </div>
    );
  }

  if (record.state === 'registered') {
    return (
      <div>
        <p className="font-mono text-[0.9375rem] break-all select-all text-ink">{record.number}</p>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">
          Number recorded <Timestamp value={record.recorded_at} />
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
      <p className="text-[0.875rem] font-semibold text-ink">
        This console does not understand this record.
      </p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink">
        Core reported the state <code className="font-mono">{record.raw}</code>, which is newer
        than this build. Nothing is shown for it rather than a guess. Report it.
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
  if (verification === null) {
    return (
      <div className="mt-2 rounded-[7px] border border-gold-500 bg-gold-50 p-3">
        <p className="text-[0.875rem] font-semibold text-ink">Not verified</p>
        <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink">
          Somebody typed this number. Nobody has confirmed it against {kind.registry}. Treat it as
          the customer&rsquo;s claim rather than as a checked fact.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-[7px] border border-green-500 bg-green-50 p-3">
      <p className="text-[0.875rem] font-semibold text-green-700">
        Verified against {kind.registry}
      </p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft">
        Checked by{' '}
        <span className="font-mono break-all select-all">
          {verification.verified_by_principal_id}
        </span>{' '}
        on <Timestamp value={verification.verified_at} />. Dudo cannot confirm a check happened —
        there is no {kind.registry} API — so this is a named operator&rsquo;s assertion about this
        exact number, and it is cleared automatically if the number changes.
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
        {kind.label}
      </legend>

      <p id={`${groupId}-help`} className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-muted">
        &ldquo;Not recorded&rdquo; and &ldquo;they have none&rdquo; are different answers and Dudo
        keeps them apart. Choosing the second records that the customer told you so, with
        today&rsquo;s date.
      </p>

      {draft.state === null ? (
        <p className="rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
          <span className="font-semibold">
            The stored state is one this console does not recognise.
          </span>{' '}
          Nothing is preselected below. Choosing any option here <em>overwrites</em> whatever is
          stored — leave it alone unless you mean to.
        </p>
      ) : null}

      <div className="grid gap-2">
        {(
          [
            ['not_recorded', 'Not recorded — nobody has asked'],
            ['not_registered', `They have no ${kind.short}`],
            ['registered', 'They have one, and the number is'],
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
            label={`${kind.short} number`}
            error={error}
            hint={`As ${kind.registry} issues it. Letters, digits, spaces and hyphens, up to ${String(MAX_REGISTRATION_NUMBER_LENGTH)} characters. Dudo checks nothing else about its shape — there is no digit count, deliberately, because a wrong one would refuse a legal registration.`}
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
                Changing the number clears the existing verification.
              </span>{' '}
              A verification attests to one specific number, so it cannot follow this one — the
              tick below has been removed. Tick it again only if you have checked the{' '}
              <em>new</em> number against {kind.registry}.
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
              <span className="font-semibold">
                I have checked this number against {kind.registry}.
              </span>{' '}
              Dudo records your principal id and today&rsquo;s date against this exact number.
              Nothing checks this for you.
            </span>
          </label>

          {wasVerified && !draft.verified && !numberChanged ? (
            <p className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
              <span className="font-semibold">
                Unticking this removes the existing verification.
              </span>{' '}
              The number stays; the record of who checked it and when is destroyed and cannot be
              recovered.
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
            <span className="font-semibold">The customer has told me this again today.</span>{' '}
            Re-dates the declaration to now. Without this, saving leaves the original date alone —
            which is usually what you want, because the date records when they said it.
          </span>
        </label>
      ) : null}

      {draft.state === 'not_recorded' && current.state !== 'not_recorded' ? (
        <p className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
          <span className="font-semibold">This destroys what is recorded.</span> The number, its
          date and any verification are removed and cannot be recovered. The audit trail records
          that a change happened, not what was lost. Use it to undo a mistake, not to clear a field
          you are unsure about.
        </p>
      ) : null}
    </fieldset>
  );
}

function SaveFailure({ failure }: { failure: ApiError }) {
  return (
    <div
      role="alert"
      className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
    >
      <p className="font-bold text-scarlet-700">
        {failure.code === 'forbidden'
          ? 'You may not change this'
          : failure.code === 'not_found'
            ? 'This business no longer exists'
            : failure.code === 'quota_exceeded'
              ? 'The write limit has been reached'
              : 'Nothing was saved'}
      </p>
      <p className="mt-1 leading-relaxed text-ink-soft">
        {failure.code === 'forbidden' ? (
          <>
            Core refused the call. Changing an Organization&rsquo;s identity needs a permission
            your operator role does not hold.{' '}
            <span className="font-semibold">Nothing was changed.</span> Raise it with the Team Lead
            rather than retrying.
          </>
        ) : failure.code === 'not_found' ? (
          <>
            It may have been removed since this page loaded.{' '}
            <span className="font-semibold">Nothing was changed.</span>
          </>
        ) : failure.code === 'quota_exceeded' ? (
          <>
            Core deferred the write rather than performing it.{' '}
            <span className="font-semibold">Nothing was changed.</span> This spends the
            business&rsquo;s own daily allowance, so it will recover on its own. Try again later.
          </>
        ) : (
          <>
            {failure.message} <span className="font-semibold">Nothing was changed</span> — the
            update is applied whole or not at all, so there is no half-saved record.
          </>
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
function Timestamp({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono text-xs break-all">{value}</span>;
  }
  return (
    <time dateTime={value} title={value} className={cn('whitespace-nowrap')}>
      {parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
