/**
 * Operator sign-in.
 *
 * ===========================================================================
 * THE SCREEN'S JOB IS TO BE HONEST ABOUT A SLOW, SILENT SECOND
 * ===========================================================================
 *
 * Pressing Sign in starts 600,000 PBKDF2 iterations in this browser — one to
 * four seconds on a laptop, longer on a phone — before a single byte is sent.
 * With no indication, that reads as a dead button, and a person's response to a
 * dead button is to press it again. So the progress bar is driven by a real
 * timed calibration on this device (`api/kdf-worker.ts`), it is LABELLED an
 * estimate because that is what it is, and it never claims completion before the
 * derivation returns.
 *
 * ===========================================================================
 * WHAT THIS SCREEN MAY AND MAY NOT SAY ABOUT A REFUSAL
 * ===========================================================================
 *
 * Core answers a failed sign-in with a fixed `401` and one constant body: no
 * "account not found", no "wrong password", no lockout notice, and no field any
 * of them could be written into. That is deliberate — a body that varied would
 * be an account-existence oracle — so this screen says the credentials were not
 * accepted AND NOTHING MORE. Any friendlier wording here would either be
 * invented or would leak the distinction Core is spending real design effort to
 * hide.
 *
 * THE LOCAL VALIDATION IS DIFFERENT AND IS ALLOWED TO BE SPECIFIC. "Remove the
 * spaces from your email address" is about the shape the person typed, which
 * they already know, and it runs before anything is sent. It discloses nothing
 * about any account.
 *
 * ===========================================================================
 * IT SAYS WHICH DOOR THIS IS
 * ===========================================================================
 *
 * `docs/decisions/0022` gives `admin.dudo.work` a separate host-only cookie, so
 * an operator signed in at `app.dudo.work` is NOT signed in here. Someone who
 * does not know that will read this form as a session that expired for no
 * reason. It is one sentence to explain and a support conversation to leave out.
 */

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { errorBody, errorTitle, toApiError, type ApiError } from '@/api/errors';
import { identifierRefusal, CredentialDerivationError } from '@/api/kdf';
import type { DerivationProgress } from '@/api/kdf-client';
import type { AuthClient } from '@/api/auth';

export interface SignInProps {
  readonly auth: AuthClient;
  readonly onSignedIn: () => void;
  /**
   * The previous sign-out did not reach Core, so the credential was NOT cleared
   * and that session is still live. Shown as a warning rather than swallowed.
   */
  readonly signOutUncleared: boolean;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'deriving'; readonly progress: DerivationProgress }
  | { readonly kind: 'sending' };

export function SignIn({ auth, onSignedIn, signOutUncleared }: SignInProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [localError, setLocalError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);

  const busy = phase.kind !== 'idle';

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;

      // Refuse before spending a second of this person's time on a derivation
      // whose result could not be sent.
      const refusal = identifierRefusal(identifier);
      if (refusal !== null) {
        setLocalError(refusal);
        setFailure(null);
        identifierRef.current?.focus();
        return;
      }
      setLocalError(null);
      setFailure(null);

      let derivationDone = false;
      setPhase({
        kind: 'deriving',
        progress: { fraction: 0, estimatedMs: null, elapsedMs: 0, usedWorker: true },
      });

      void auth
        .login(identifier, password, (progress) => {
          if (progress.fraction >= 1) {
            // The derivation has returned and the request is in flight. The bar
            // stops here rather than sitting full through the round trip.
            derivationDone = true;
            setPhase({ kind: 'sending' });
            return;
          }
          if (!derivationDone) setPhase({ kind: 'deriving', progress });
        })
        .then(
          () => {
            /*
             * THE PASSWORD IS DROPPED THE MOMENT IT IS NO LONGER NEEDED. It was
             * held in component state for the lifetime of the submit and nowhere
             * else: not in a ref that outlives the screen, not in storage, and
             * not in the result. `api/kdf-client.ts` terminates the worker on
             * every path, which drops the worker's copy with the thread.
             */
            setPassword('');
            setPhase({ kind: 'idle' });
            onSignedIn();
          },
          (thrown: unknown) => {
            setPassword('');
            setPhase({ kind: 'idle' });
            if (thrown instanceof CredentialDerivationError) {
              // A local derivation failure, which is about this device or this
              // input — never about the account.
              setLocalError(thrown.message);
              return;
            }
            setFailure(toApiError(thrown));
          },
        );
    },
    [auth, busy, identifier, password, onSignedIn],
  );

  return (
    <main className="min-h-dvh bg-navy-800 px-4 py-10 sm:py-16 on-navy">
      <div className="mx-auto w-full max-w-[26rem]">
        <header className="mb-7 text-center">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-gold-500">
            Dudo
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Platform administration</h1>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-navy-100">
            Operator access. This is a separate sign-in from the Dudo application — being signed
            in there does not sign you in here.
          </p>
        </header>

        {signOutUncleared ? (
          <div
            role="alert"
            className="mb-5 rounded-[7px] border border-gold-500 bg-gold-50 p-4 text-[0.875rem] text-ink"
          >
            <p className="font-bold">Your last sign-out did not reach Dudo.</p>
            <p className="mt-1 leading-relaxed">
              Nothing was revoked and the session credential was not cleared, so that session is
              still live. If you are on a shared machine, sign in and sign out again on a working
              connection.
            </p>
          </div>
        ) : null}

        <form
          onSubmit={submit}
          noValidate
          className="grid gap-5 rounded-[12px] bg-surface p-6 shadow-float"
        >
          {failure ? (
            <div
              role="alert"
              className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
            >
              <p className="font-bold text-scarlet-700">
                {failure.code === 'unauthenticated'
                  ? 'Those credentials were not accepted'
                  : errorTitle(failure)}
              </p>
              <p className="mt-1 leading-relaxed text-ink-soft">
                {/*
                  Core's 401 body is a constant and says nothing about which part
                  was wrong. This screen must not invent the distinction, so it
                  states only what is true of every 401.
                */}
                {failure.code === 'unauthenticated'
                  ? 'Check the address and the password and try again. Dudo does not say which of ' +
                    'the two was wrong, deliberately.'
                  : errorBody(failure)}
              </p>
              {failure.request_id ? (
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  Reference {failure.request_id}
                </p>
              ) : null}
            </div>
          ) : null}

          <Field
            id="operator-email"
            label="Email address"
            error={localError}
            hint="Plain ASCII only. Spaces are refused rather than trimmed."
          >
            {(aria) => (
              <Input
                {...aria}
                ref={identifierRef}
                type="email"
                name="email"
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

          <Field id="operator-password" label="Password">
            {(aria) => (
              <Input
                {...aria}
                type="password"
                name="password"
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

          <Button type="submit" variant="primary" disabled={busy} busy={busy} className="w-full">
            {phase.kind === 'deriving'
              ? 'Preparing your credential…'
              : phase.kind === 'sending'
                ? 'Signing in…'
                : 'Sign in'}
          </Button>

          {phase.kind === 'deriving' ? <DerivationProgressBar progress={phase.progress} /> : null}

          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Your password is turned into a key in this browser and the password itself is never
            sent to Dudo. That takes a second or two and is the pause you will see.
          </p>
        </form>
      </div>
    </main>
  );
}

/**
 * The measured progress bar.
 *
 * `role="progressbar"` with `aria-valuenow` so it is announced rather than being
 * a decorative stripe, and the remaining-seconds figure is stated as an estimate
 * in the text a screen reader reaches.
 */
function DerivationProgressBar({ progress }: { progress: DerivationProgress }) {
  const percent = Math.round(progress.fraction * 100);
  const remainingMs =
    progress.estimatedMs === null ? null : Math.max(0, progress.estimatedMs - progress.elapsedMs);

  return (
    <div className="grid gap-2">
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Preparing your credential"
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunk"
      >
        {/*
          `margin-inline-start: 0` is implicit and the bar grows from the inline
          start, so it fills right-to-left in an RTL document with no change.
        */}
        <div
          className="h-full rounded-full bg-navy-600 transition-[width] duration-150 ease-linear"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p aria-live="polite" className="text-[0.8125rem] text-ink-muted">
        {remainingMs === null
          ? 'Measuring how long this will take on this device…'
          : `About ${String(Math.ceil(remainingMs / 1000))} seconds left — an estimate measured on this device.`}
        {!progress.usedWorker ? (
          <>
            {' '}
            <span className="font-semibold text-ink-soft">
              This tab will stop responding while it runs: a background worker could not be
              started.
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
