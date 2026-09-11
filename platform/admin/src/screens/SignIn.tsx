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
 * timed calibration on this device (`@dudo/client-kdf/worker`), it is LABELLED an
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
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { errorTitleKey, toApiError, type ApiError } from '@/api/errors';
import { errorSentence } from '@/components/StateBlock';
import { identifierRefusal, CredentialDerivationError } from '@dudo/client-kdf';
import type { DerivationProgress } from '@dudo/client-kdf/client';
import type { AuthClient } from '@/api/auth';
import { formatSeconds, useLocale } from '@/lib/i18n';

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
  const { locale, t } = useLocale();
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
             * not in the result. `@dudo/client-kdf/client` terminates the worker on
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
            {t('signIn.brand')}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">{t('signIn.title')}</h1>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-navy-100">{t('signIn.intro')}</p>
        </header>

        {signOutUncleared ? (
          <div
            role="alert"
            className="mb-5 rounded-[7px] border border-gold-500 bg-gold-50 p-4 text-[0.875rem] text-ink"
          >
            <p className="font-bold">{t('signIn.uncleared.title')}</p>
            <p className="mt-1 leading-relaxed">{t('signIn.uncleared.body')}</p>
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
                  ? t('signIn.rejected.title')
                  : t(errorTitleKey(failure))}
              </p>
              <p className="mt-1 leading-relaxed text-ink-soft">
                {/*
                  Core's 401 body is a constant and says nothing about which part
                  was wrong. This screen must not invent the distinction, so it
                  states only what is true of every 401.

                  **THE SIGN-IN OVERRIDE STAYS, and it is not duplication.**
                  `error.body.unauthenticated` says *your operator session is not
                  active — sign in* , which is right everywhere EXCEPT on the
                  sign-in screen, where the operator is already doing that. Here
                  a 401 means the credentials were rejected, and telling someone
                  to sign in while they are signing in is the shape of message
                  that makes a console feel broken.
                */}
                {failure.code === 'unauthenticated'
                  ? t('signIn.rejected.body')
                  : errorSentence(failure, locale, t)}
              </p>
              {failure.request_id ? (
                <p className="mt-2 text-xs text-ink-muted">
                  {t('denied.reference')}{' '}
                  <bdi className="font-mono break-all">{failure.request_id}</bdi>
                </p>
              ) : null}
            </div>
          ) : null}

          <Field
            id="operator-email"
            label={t('signIn.email')}
            error={localError}
            hint={t('signIn.emailHint')}
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

          <Field id="operator-password" label={t('signIn.password')}>
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
              ? t('signIn.deriving')
              : phase.kind === 'sending'
                ? t('signIn.sending')
                : t('signIn.submit')}
          </Button>

          {phase.kind === 'deriving' ? <DerivationProgressBar progress={phase.progress} /> : null}

          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            {t('signIn.kdfExplainer')}
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
  const { t, locale } = useLocale();
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
        aria-label={t('signIn.progressLabel')}
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
          ? t('derivation.measuring')
          : /*
              THREE PIECES RATHER THAN ONE TEMPLATE STRING, and the middle one
              is `Intl`'s. `${n} seconds` is wrong in Arabic for almost every
              `n` — singular, dual and two plural forms — and `formatSeconds`
              defers that to the engine rather than to a rule written here.
            */
            `${t('derivation.remainingPrefix')} ${formatSeconds(locale, Math.ceil(remainingMs / 1000))} — ${t('derivation.estimateNote')}`}
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
