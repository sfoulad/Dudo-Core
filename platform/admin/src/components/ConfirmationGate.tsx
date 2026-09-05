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

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { identifierRefusal, CredentialDerivationError } from '@/api/kdf';
import { deriveLogin, type DerivationProgress } from '@/api/kdf-client';
import {
  EXPECTED_STATEMENT_LOCALE,
  isPresentableStatement,
  type ConfirmationChallenge,
} from '@/api/confirmation';
import { toApiError, type ApiError } from '@/api/errors';

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
}

export function ConfirmationGate({
  title,
  boundParameters,
  requestChallenge,
  submit,
  onCancel,
}: ConfirmationGateProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'requesting' });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  /*
   * ONE CHALLENGE, REQUESTED WHEN THIS GATE OPENS — which happens only because
   * a person pressed the action. There is no retry-on-mount and no refetch;
   * `[]` is deliberate and the lint-suppressing dependency array is not an
   * oversight, because re-running this would mint a second challenge and spend
   * another audited write.
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
      <Panel title={title}>
        <LoadingBlock label="Asking Core what this will do…" />
      </Panel>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <Panel title={title}>
        {isCeilingCode(phase.error.code) ? (
          <CeilingNotice error={phase.error} scope="platform" />
        ) : (
          <ErrorBlock error={phase.error}>
            <p className="mt-2 leading-relaxed text-ink-soft">
              Nothing was changed. Close this and start again if you still need to.
            </p>
          </ErrorBlock>
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </Panel>
    );
  }

  const challenge = phase.challenge;
  const presentable = isPresentableStatement(challenge);
  const busy = phase.kind === 'deriving' || phase.kind === 'submitting';

  return (
    <Panel title={title}>
      {/*
        THE STATEMENT. Rendered as-is, inside this console's chrome but not
        altered by it. No quotation marks are added around it either — they would
        be this component editing the sentence.
      */}
      <div className="rounded-[7px] border-2 border-navy-600 bg-navy-50 p-4 sm:p-5">
        <p className="text-xs font-bold tracking-[0.06em] uppercase text-navy-700">
          What will happen
        </p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed font-semibold text-ink">
          {challenge.statement}
        </p>
      </div>

      {!presentable ? (
        <div
          role="alert"
          className="mt-4 rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
        >
          <p className="font-bold text-scarlet-700">
            This statement is not in the language this console asked for
          </p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            Dudo returned it as{' '}
            <code className="font-mono">{challenge.statement_locale}</code> and this console
            requested {EXPECTED_STATEMENT_LOCALE}. It will not ask you to approve a sentence it
            cannot vouch for. <span className="font-semibold">Nothing was changed.</span> Report
            this rather than retrying.
          </p>
        </div>
      ) : null}

      <BoundParameters parameters={boundParameters} />

      <p className="mt-4 text-[0.8125rem] text-ink-muted">
        This approval expires at <ExpiresAt value={challenge.expires_at} />.
      </p>

      {presentable ? (
        <form onSubmit={approve} noValidate className="mt-5 grid gap-4">
          <p className="text-[0.875rem] leading-relaxed text-ink-soft">
            Confirm with <span className="font-semibold">your own</span> sign-in details — not the
            account being changed.
          </p>

          <Field
            id="reauth-identifier"
            label="Your email address"
            error={localError}
            hint="The address you signed in with."
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

          <Field id="reauth-password" label="Your password">
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
            <Button type="submit" variant="primary" disabled={busy} busy={busy}>
              {phase.kind === 'deriving'
                ? 'Checking your password…'
                : phase.kind === 'submitting'
                  ? 'Carrying it out…'
                  : 'Approve'}
            </Button>
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>

          {phase.kind === 'deriving' ? <DerivationBar progress={phase.progress} /> : null}
        </form>
      ) : (
        <div className="mt-5">
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="confirmation-heading"
      className="rounded-[12px] border-2 border-navy-600 bg-surface p-5 sm:p-6"
    >
      <h2 id="confirmation-heading" className="text-lg font-bold text-ink">
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
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {name}
          </dt>
          <dd className="font-mono break-all text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExpiresAt({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return <span className="font-mono">{value}</span>;
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleTimeString(undefined, {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}{' '}
      UTC
    </time>
  );
}

function DerivationBar({ progress }: { progress: DerivationProgress }) {
  const percent = Math.round(progress.fraction * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Checking your password"
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunk"
    >
      <div
        className="h-full rounded-full bg-navy-600 transition-[width] duration-150 ease-linear"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
