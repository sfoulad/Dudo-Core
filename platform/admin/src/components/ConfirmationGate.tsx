/**
 * The confirmation gate: request a challenge, show the statement Core wrote,
 * collect the operator's own password, submit.
 *
 * ===========================================================================
 * THE STATEMENT RENDERS VERBATIM. THIS COMPONENT AUTHORS NONE OF IT.
 * ===========================================================================
 *
 * `{challenge.statement}` and nothing else. It is not paraphrased, templated,
 * truncated, capitalised, punctuated, wrapped in quotation marks, or
 * reconstructed from the parameters. The surrounding chrome is this
 * console's — the sentence a human approves is Core's.
 *
 * WHY THAT IS THE MECHANISM RATHER THAN A PREFERENCE: "the party being
 * constrained does not author the statement of the constraint, and a client
 * composing its own 'are you sure?' text could display one operation while
 * submitting another." **Core cannot verify the client displayed it** — CF-2 is
 * an unclosable gap — so this is a client obligation, and the only thing
 * enforcing it is that it is written down and asserted against the source.
 *
 * IF THE STATEMENT READS ODDLY, THAT IS A CORE DEFECT TO REPORT. It is not a
 * presentation problem for this component to smooth over, and smoothing it over
 * is precisely the failure the rule exists to prevent.
 *
 * ===========================================================================
 * A STATEMENT IN AN UNEXPECTED LANGUAGE IS NOT APPROVABLE
 * ===========================================================================
 *
 * This console never sends `locale`, so `en` is what it must receive. If
 * `statement_locale` comes back as anything else, **the approve control is not
 * offered at all** — the operator is told the statement is in a language the
 * console did not request and cannot vouch for, and the flow stops.
 *
 * That is deliberately not a warning-and-proceed. The non-English statement
 * catalog has never been reviewed by a speaker of the language, and asking
 * someone to approve a destructive action described in a sentence nobody has
 * checked is worse than refusing to offer the action.
 *
 * ===========================================================================
 * ⚠ AND THE CONSOLE CAN NOW BE ARABIC WHILE THE STATEMENT IS ENGLISH
 * ===========================================================================
 *
 * Added 2026-09-11, with the copy pass, because **the copy pass CREATED this
 * case.** The rule above is about a statement arriving in an unexpected
 * language; this is its mirror — **the statement arrives in exactly the
 * expected language and the READER may not be an English reader.**
 *
 * It is the same family as the paragraph above: *asking someone to approve a
 * destructive action described in a sentence they cannot check.* Nothing in the
 * contract, the locale check, or the type system sees it, because every
 * individual part is correct.
 *
 * **THREE THINGS FOLLOW, AND NONE OF THEM IS "TRANSLATE IT":**
 *
 *   - The statement is still rendered **verbatim**. This console does not
 *     author it and must not translate it either — a translated statement is a
 *     statement Core did not write, which is the whole defect the verbatim rule
 *     exists to prevent, arriving through a well-meant feature.
 *   - The region carries **`lang` and `dir` of the STATEMENT**, not of the page.
 *     Without it an Arabic page announces English text through an Arabic
 *     synthesiser — which `lib/i18n.tsx` records as *"unusable rather than
 *     merely wrong"* — and the bidirectional algorithm lays out an LTR sentence
 *     inside an RTL block.
 *   - When the two differ, the operator is **told**, in their own language,
 *     that the sentence below is Core's own English and is shown unaltered on
 *     purpose. **Naming it is the honest move**; hiding it would leave someone
 *     approving a sentence they were never told they could not read.
 *
 * **WHAT THIS DOES NOT DO IS BLOCK THE ACTION**, and that is a judgement rather
 * than an oversight: refusing to offer approval in Arabic would make the
 * console's own language switch a downgrade, and the operator population here
 * reads English. **It is named, not prevented — and that distinction belongs to
 * the Team Lead if it should be otherwise.**
 *
 * ===========================================================================
 * THE PASSWORD
 * ===========================================================================
 *
 * The operator types their OWN password here. It lives in component state for
 * exactly as long as it takes to derive from it, and is cleared in the same tick
 * the derivation returns — before the submission is even sent. It is never
 * logged, never placed in a URL, never stored, and never included in an error.
 *
 * THE DERIVATION IS THE LOGIN PATH, CALLED NOT COPIED. `deriveLogin` validates
 * and normalises the identifier, uses that normalised form as the salt, and runs
 * the same 600,000 iterations in the same Web Worker. `reauth_derived_value` is
 * "byte-identical to login, deliberately, so the client reuses its login code
 * path and there is no second KDF for web and Apple to diverge on."
 *
 * AND THE SALT IS THE OPERATOR'S OWN IDENTIFIER, NEVER THE TARGET'S. That
 * confusion is the exact defect that made `credential-reset-v1` unbuildable for
 * half a day — one field with two meanings. `reauth_identifier` was renamed from
 * `identifier` for the same reason, and this component only ever handles the
 * caller's.
 *
 * ===========================================================================
 * THE TARGET CANNOT CHANGE BETWEEN CHALLENGE AND SUBMISSION
 * ===========================================================================
 *
 * The parameters are captured when the challenge is requested and are rendered
 * read-only afterwards. There is no control to edit them, because the binding
 * would refuse the submission — and a UI that invites a refusal teaches
 * operators to retry, which is the habit this mechanism exists to interrupt.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { identifierRefusal, CredentialDerivationError } from '@dudo/client-kdf';
import { deriveLogin, type DerivationProgress } from '@dudo/client-kdf/client';
import {
  EXPECTED_STATEMENT_LOCALE,
  isPresentableStatement,
  type ConfirmationChallenge,
} from '@/api/confirmation';
import { toApiError, type ApiError } from '@/api/errors';
import { directionOf, fill, isLocale, useLocale, type Locale } from '@/lib/i18n';

type Phase =
  | { readonly kind: 'requesting' }
  | { readonly kind: 'challenged'; readonly challenge: ConfirmationChallenge }
  | { readonly kind: 'deriving'; readonly challenge: ConfirmationChallenge; readonly progress: DerivationProgress }
  | { readonly kind: 'submitting'; readonly challenge: ConfirmationChallenge }
  | { readonly kind: 'failed'; readonly error: ApiError };

export interface ConfirmationGateProps {
  /** What the operator is about to do, in this console's own words. */
  readonly title: string;
  /** The parameters, rendered read-only so the target is visibly fixed. */
  readonly boundParameters: Readonly<Record<string, string>>;
  /** Requests the challenge. Called once, from the press that opens this gate. */
  readonly requestChallenge: () => Promise<ConfirmationChallenge>;
  /** Submits with the three confirmation fields. */
  readonly submit: (confirmation: {
    confirmationId: string;
    reauthIdentifier: string;
    reauthDerivedValue: string;
  }) => Promise<void>;
  readonly onCancel: () => void;
  /**
   * ===========================================================================
   * WHERE FOCUS GOES WHEN THIS PANEL CLOSES. REQUIRED, NOT OPTIONAL.
   * ===========================================================================
   *
   * **This gate moved focus IN and never returned it.** Its own header argues
   * the entry case — *"the panel replaces a button that a person just pressed,
   * so without this a screen-reader user is left focused on a control that no
   * longer exists"* — **and that reasoning covers the exit identically.** Press
   * Cancel on a revoke gate and focus fell to `<body>`: a keyboard user dumped
   * at the top of the document after abandoning a destructive confirmation,
   * with nothing announced.
   *
   * **IT IS A REQUIRED PROP RATHER THAN A PER-PARENT DISCIPLINE, and the
   * evidence for that was already in the tree** (`architecture.md` §3a):
   *
   *     per-parent      every current AND FUTURE consumer must remember
   *     required prop   a gate mounted without saying where focus returns
   *                     DOES NOT COMPILE
   *
   * **Both consumers restored nothing** — so the discipline had already failed
   * twice before anyone relied on it, which is the whole argument for making
   * omission a build error instead of a habit.
   *
   * The parent owns the ref because only the parent knows which control opened
   * the gate; this component only knows that something did.
   */
  readonly openerRef: RefObject<HTMLElement | null>;
}

export function ConfirmationGate({
  title,
  boundParameters,
  requestChallenge,
  submit,
  onCancel,
  openerRef,
}: ConfirmationGateProps) {
  const { locale, t } = useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: 'requesting' });

  /*
   * ===========================================================================
   * ONE DISMISSAL PATH, SO THE RETURN CANNOT BE FORGOTTEN ON ONE OF THREE
   * ===========================================================================
   *
   * `onCancel` is called from THREE places in this component — the failure
   * panel's Close, the form's Cancel, and the non-presentable branch's Close.
   * **Restoring focus at each call site is three chances to miss one**, and the
   * one that gets missed is whichever branch nobody tests.
   *
   * ===========================================================================
   * ⚠ AND THE OBVIOUS IMPLEMENTATION DOES NOT WORK, BECAUSE BOTH CONSUMERS
   * UNMOUNT THE OPENER WHILE THE GATE IS OPEN
   * ===========================================================================
   *
   * The first version focused `openerRef` and then called `onCancel`. **At that
   * moment the ref is `null`**: `Operators` renders its button as
   * `{revoking === null ? <Button …/> : null}` and `ResetCredential` replaces
   * the whole `idle` stage, **so in both cases the control that opened this
   * panel has left the DOM for as long as the panel is up.** A `focus()` on a
   * detached ref is a silent no-op — the exact defect, unfixed and now looking
   * fixed.
   *
   * **So the restore happens in the UNMOUNT CLEANUP**, which runs after React
   * has committed the parent's re-render — by which point the opener has
   * remounted and `openerRef.current` is the new node.
   *
   * **AND IT IS CONDITIONAL ON HAVING BEEN DISMISSED.** When the gate closes
   * because the action SUCCEEDED, focus belongs to the result panel —
   * `ResetResult` and `ResetUncertain` both take it deliberately. An
   * unconditional focus-on-unmount would fight them and win, dragging a
   * screen-reader user back to a button instead of the password they must
   * record.
   *
   * ⚠ **THE COMMIT ORDERING IS REASONED, NOT OBSERVED.** React attaches refs
   * during the mutation phase and runs passive-effect cleanups afterwards, so
   * the remounted opener should be in `openerRef.current` by then. **I cannot
   * run a browser here to confirm it**, and this is named as the assumption
   * this fix rests on — it belongs in the post-deploy keyboard pass beside the
   * RTL check.
   */
  const dismissedRef = useRef(false);
  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    onCancel();
  }, [onCancel]);

  useEffect(
    () => () => {
      if (dismissedRef.current) openerRef.current?.focus();
    },
    [openerRef],
  );

  /*
   * ESCAPE CLOSES IT, like the drawer — and the consistency IS the argument.
   * **A keyboard user who learns Escape on the navigation drawer will try it
   * here**, and an affordance that works in one place and silently fails in
   * four is worse than one that exists nowhere.
   *
   * ⚠ **IT IS BOUND ONLY WHILE THE GATE IS DISMISSIBLE.** During `deriving` and
   * `submitting` a request is in flight: Escape there would return focus and
   * unmount the panel while a confirmed write is still travelling, leaving the
   * operator with no way to learn the outcome of an act they approved.
   */
  const inFlight = phase.kind === 'deriving' || phase.kind === 'submitting';
  useEffect(() => {
    if (inFlight) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dismiss, inFlight]);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  /*
   * GENERATED IDS, NOT LITERALS. This component is used by two screens and could
   * one day appear twice on one; a hardcoded `id` would then be a duplicate, and
   * `aria-labelledby`/`aria-describedby` resolve to the FIRST match — so the
   * wrong statement would be announced for the wrong action. `useId` makes that
   * impossible rather than unlikely.
   */
  const headingId = useId();
  const statementId = useId();
  const statementRef = useRef<HTMLDivElement>(null);

  /*
   * FOCUS MOVES TO THE STATEMENT WHEN THE CHALLENGE ARRIVES.
   *
   * The panel replaces a button that a person just pressed, so without this a
   * screen-reader user is left focused on a control that no longer exists and
   * hears nothing. Moving focus to the statement region means the first thing
   * announced is what is about to happen.
   *
   * It targets the STATEMENT rather than the heading, because the heading is
   * this console's wording and the statement is Core's — and the statement is
   * the thing being approved.
   */
  useEffect(() => {
    if (phase.kind === 'challenged') statementRef.current?.focus();
  }, [phase.kind]);

  /*
   * ONE CHALLENGE, REQUESTED WHEN THIS GATE OPENS — which happens only because
   * a person pressed the action. There is no retry-on-mount and no refetch;
   * `[]` is deliberate and the lint-suppressing dependency array is not an
   * oversight, because re-running this would mint a second challenge and spend
   * another audited write.
   *
   * ===========================================================================
   * THIS EFFECT SURVIVED THE TANSTACK QUERY CONVERSION ON PURPOSE
   * ===========================================================================
   *
   * Every read in this console moved to `lib/queries.ts` and every screen lost
   * its `useEffect`. **This one stays, and it is the decision rather than the
   * file nobody reached.**
   *
   * **It cannot be a query.** A challenge is a WRITE — it costs control-plane
   * row-writes and runs the full authorization of the operation it names — and
   * a cache would hand a second press a challenge minted for the first, which
   * is the opposite of what a single-use confirmation is for.
   *
   * **And a mutation would not remove this effect, only relocate the call
   * inside it.** The trigger genuinely is the mount: this component is rendered
   * because a person pressed the action, so "on mount" and "on the press" are
   * the same moment. **The conversion would keep the effect, keep the `[]`, and
   * add a hook whose `isPending` duplicates `phase.kind === 'requesting'` —
   * paying the drift risk for nothing.**
   *
   * The `cancelled` flag stays for the same reason it was written: this panel
   * can be unmounted by its parent while the challenge is in flight, and a
   * `setPhase` after that is a state update to a component that is gone.
   */
  useEffect(() => {
    let cancelled = false;
    void requestChallenge().then(
      (challenge) => {
        if (!cancelled) setPhase({ kind: 'challenged', challenge });
      },
      (thrown: unknown) => {
        if (!cancelled) setPhase({ kind: 'failed', error: toApiError(thrown) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (phase.kind !== 'challenged') return;
      const challenge = phase.challenge;

      const refusal = identifierRefusal(identifier);
      if (refusal !== null) {
        setLocalError(refusal);
        return;
      }
      setLocalError(null);

      let derivationDone = false;
      setPhase({
        kind: 'deriving',
        challenge,
        progress: { fraction: 0, estimatedMs: null, elapsedMs: 0, usedWorker: true },
      });

      void deriveLogin(identifier, password, (progress) => {
        if (progress.fraction >= 1) {
          derivationDone = true;
          return;
        }
        if (!derivationDone) {
          setPhase((current) =>
            current.kind === 'deriving' ? { ...current, progress } : current,
          );
        }
      })
        .then(async (derived) => {
          /*
           * THE PASSWORD IS DROPPED HERE, BEFORE THE SUBMISSION IS SENT. It has
           * served its only purpose. Holding it across the network call would
           * keep it in memory for no reason during the window an operator is
           * most likely to walk away from the screen.
           */
          setPassword('');
          setPhase({ kind: 'submitting', challenge });
          await submit({
            confirmationId: challenge.confirmation_id,
            reauthIdentifier: derived.email,
            reauthDerivedValue: derived.derivedKey,
          });
        })
        .catch((thrown: unknown) => {
          setPassword('');
          if (thrown instanceof CredentialDerivationError) {
            setLocalError(thrown.message);
            setPhase({ kind: 'challenged', challenge });
            return;
          }
          setPhase({ kind: 'failed', error: toApiError(thrown) });
        });
    },
    [identifier, password, phase, submit],
  );

  if (phase.kind === 'requesting') {
    return (
      <Panel title={title} headingId={headingId}>
        <LoadingBlock label={t('loading.challenge')} />
      </Panel>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <Panel title={title} headingId={headingId}>
        {isCeilingCode(phase.error.code) ? (
          <CeilingNotice error={phase.error} scope="platform" />
        ) : (
          <ErrorBlock error={phase.error}>
            <p className="mt-2 leading-relaxed text-ink-soft">{t('gate.failedNothingChanged')}</p>
          </ErrorBlock>
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={dismiss}>
            {t('gate.close')}
          </Button>
        </div>
      </Panel>
    );
  }

  const challenge = phase.challenge;
  const presentable = isPresentableStatement(challenge);
  const busy = phase.kind === 'deriving' || phase.kind === 'submitting';

  /*
   * THE STATEMENT'S OWN LANGUAGE, AND WHETHER IT IS THE READER'S.
   *
   * `statement_locale` is whatever Core sent. `isLocale` narrows it to one this
   * console has a direction for; anything else is already refused by
   * `presentable`, but this must not throw on the way there — the refusal panel
   * has to render.
   *
   * **`ltr` IS THE FALLBACK RATHER THAN THE PAGE'S DIRECTION**, because an
   * unrecognised locale on an RTL page would otherwise inherit `rtl` and lay out
   * a sentence nobody can vouch for in a direction nobody chose.
   */
  const statementLocale: Locale | null = isLocale(challenge.statement_locale)
    ? challenge.statement_locale
    : null;
  const statementDir = statementLocale === null ? 'ltr' : directionOf(statementLocale);
  const readerCannotBeAssumed = presentable && challenge.statement_locale !== locale;

  return (
    <Panel title={title} headingId={headingId}>
      {/*
        THE STATEMENT. Rendered as-is, inside this console's chrome but not
        altered by it. No quotation marks are added around it either — they would
        be this component editing the sentence.

        ===================================================================
        IT IS ANNOUNCED, NOT MERELY DISPLAYED, AND THAT IS A SECURITY
        REQUIREMENT RATHER THAN A COURTESY
        ===================================================================

        A STATEMENT A SCREEN READER SKIPS IS A STATEMENT NOBODY APPROVED. A
        sighted operator cannot miss this block; someone tabbing through the
        form can, because a paragraph is not in the tab order — they would land
        on the email field having heard nothing about what they are approving.

        THREE MECHANISMS, BECAUSE ONE IS NOT ENOUGH:

          - `role="group"` with `aria-labelledby`/`aria-describedby` makes the
            statement the accessible DESCRIPTION of the region, so entering it
            announces the sentence.
          - The same `statementId` is the `aria-describedby` of the APPROVE
            BUTTON, so the statement is read again at the moment of decision —
            which is the moment that matters, and the one a user who tabbed
            past the region would otherwise reach uninformed.
          - Focus moves to this region when the challenge arrives, so the
            statement is encountered before anything else in the panel.
      */}
      <div
        ref={statementRef}
        tabIndex={-1}
        role="group"
        aria-labelledby={headingId}
        aria-describedby={statementId}
        className="rounded-[7px] border-2 border-navy-600 bg-navy-50 p-4 sm:p-5"
      >
        <p className="text-xs font-bold tracking-[0.06em] uppercase text-navy-700">
          {t('gate.whatWillHappen')}
        </p>
        {/*
          `lang` AND `dir` ARE THE STATEMENT'S, NOT THE PAGE'S. A screen reader
          picks its voice and pronunciation rules from `lang`, so an English
          sentence inside an Arabic page must say so or it is read by an Arabic
          synthesiser — and `dir` stops the bidirectional algorithm laying an LTR
          sentence out inside an RTL block. **This is the sentence being
          approved; it is the last place to let either of those go wrong.**
        */}
        <p
          id={statementId}
          lang={challenge.statement_locale}
          dir={statementDir}
          className="mt-2 text-[0.9375rem] leading-relaxed font-semibold text-ink"
        >
          {challenge.statement}
        </p>
      </div>

      {/*
        ⚠ THE STATEMENT IS IN A LANGUAGE THIS READER DID NOT CHOOSE.
        Not a refusal — see the header. It is named, in the reader's own
        language, so nobody approves a sentence they were never told they might
        not be able to read. **The statement itself is still verbatim**; this
        console does not translate what it did not write.
      */}
      {readerCannotBeAssumed ? (
        <p
          role="note"
          className="mt-3 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink"
        >
          <span className="font-semibold">{t('gate.statementLanguageLead')}</span>{' '}
          {t('gate.statementLanguageBody')}
        </p>
      ) : null}

      {!presentable ? (
        <div
          role="alert"
          className="mt-4 rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
        >
          <p className="font-bold text-scarlet-700">{t('gate.wrongLocale.title')}</p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            {fill(t('gate.wrongLocale.body'), locale, {
              got: challenge.statement_locale,
              expected: EXPECTED_STATEMENT_LOCALE,
            })}{' '}
            <span className="font-semibold">{t('gate.wrongLocale.nothingChanged')}</span>{' '}
            {t('gate.wrongLocale.report')}
          </p>
        </div>
      ) : null}

      <BoundParameters parameters={boundParameters} />

      <p className="mt-4 text-[0.8125rem] text-ink-muted">
        {t('gate.expiresAt')} <ExpiresAt value={challenge.expires_at} locale={locale} />
      </p>

      {presentable ? (
        <form onSubmit={approve} noValidate className="mt-5 grid gap-4">
          <p className="text-[0.875rem] leading-relaxed text-ink-soft">
            {t('gate.confirmWithLead')}{' '}
            <span className="font-semibold">{t('gate.confirmWithYourOwn')}</span>{' '}
            {t('gate.confirmWithTail')}
          </p>

          <Field
            id="reauth-identifier"
            label={t('gate.emailLabel')}
            error={localError}
            hint={t('gate.emailHint')}
          >
            {(aria) => (
              <Input
                {...aria}
                type="email"
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  if (localError !== null) setLocalError(null);
                }}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                disabled={busy}
                required
              />
            )}
          </Field>

          <Field id="reauth-password" label={t('gate.passwordLabel')}>
            {(aria) => (
              <Input
                {...aria}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                autoComplete="current-password"
                disabled={busy}
                required
              />
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            {/*
              THE STATEMENT IS THE BUTTON'S DESCRIPTION. A screen reader
              announces it when this control is focused — so the sentence is
              read at the moment of decision, even by someone who tabbed
              straight here.
            */}
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              busy={busy}
              aria-describedby={statementId}
            >
              {phase.kind === 'deriving'
                ? t('gate.checking')
                : phase.kind === 'submitting'
                  ? t('gate.carryingOut')
                  : t('gate.approve')}
            </Button>
            <Button variant="secondary" onClick={dismiss} disabled={busy}>
              {t('gate.cancel')}
            </Button>
          </div>

          {phase.kind === 'deriving' ? (
            <DerivationBar progress={phase.progress} label={t('gate.progressLabel')} />
          ) : null}
        </form>
      ) : (
        <div className="mt-5">
          <Button variant="secondary" onClick={dismiss}>
            {t('gate.close')}
          </Button>
        </div>
      )}
    </Panel>
  );
}

/**
 * `headingId` is passed in rather than generated here, so that the statement
 * region's `aria-labelledby` and this heading's `id` are the same value. A
 * literal would be a duplicate the moment two gates coexisted, and
 * `aria-labelledby` resolves to the FIRST match — announcing the wrong action's
 * title.
 */
function Panel({
  title,
  headingId,
  children,
}: {
  title: string;
  headingId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[12px] border-2 border-navy-600 bg-surface p-5 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-bold text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The bound parameters, READ-ONLY.
 *
 * Shown so the operator can see exactly what the approval covers, and shown as
 * text rather than inputs because **the target cannot change between challenge
 * and submission** — the binding would refuse it, and offering an edit control
 * would invite a refusal.
 */
function BoundParameters({ parameters }: { parameters: Readonly<Record<string, string>> }) {
  const entries = Object.entries(parameters);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-4 grid gap-2 rounded-[7px] border border-line bg-sunk/60 p-3 text-[0.8125rem]">
      {entries.map(([name, value]) => (
        <div key={name} className="min-w-0">
          {/*
            THE PARAMETER NAMES ARE WIRE FIELD NAMES AND ARE NOT TRANSLATED —
            `principal_id`, `target_identifier`, `derived_value`. They are what
            the binding covers, and an operator comparing this panel to a
            contract or to an audit record needs the same tokens in both places.
            Both halves are isolated so an RTL page cannot reorder them.
          */}
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            <bdi>{name}</bdi>
          </dt>
          <dd className="text-ink">
            <bdi className="font-mono break-all">{value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * ⚠ THE LOCALE WAS `undefined`, WHICH IS THE BROWSER'S AND NOT THE CONSOLE'S —
 * the same defect found in `describeWindow`, in a second place, and neither was
 * found by a check.
 *
 * An operator who switched this console to Arabic would have seen an expiry time
 * formatted in whatever their browser was set to. **It is never wrong in testing
 * because the browser and the console agree by default**; it diverges only for
 * the operator who deliberately switched.
 *
 * `UTC` is not translated: it names the timezone, the audit feed's filters say
 * `(UTC)` in both languages, and an operator comparing this to a timestamp needs
 * the same three letters in both places. It is isolated so the bidirectional
 * algorithm cannot move it to the other side of the time on an RTL page.
 */
function ExpiresAt({ value, locale }: { value: string; locale: Locale }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono">{value}</bdi>;
  }
  return (
    <bdi>
      <time dateTime={value} title={value}>
        {parsed.toLocaleTimeString(locale, {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}{' '}
        UTC
      </time>
    </bdi>
  );
}

function DerivationBar({ progress, label }: { progress: DerivationProgress; label: string }) {
  const percent = Math.round(progress.fraction * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunk"
    >
      <div
        className="h-full rounded-full bg-navy-600 transition-[width] duration-150 ease-linear"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
