/**
 * The sign-in screen.
 *
 * ===========================================================================
 * THE 600,000-ITERATION WAIT IS THE DESIGN PROBLEM OF THIS SCREEN
 * ===========================================================================
 *
 * ADR 0015 §D moves the password KDF to the client because the Workers CPU
 * budget is 10 ms and cannot fit a real one. The consequence lands here: signing
 * in costs one to four seconds of local computation before a single byte is
 * sent, and on a cheap phone considerably more. A person who is given a spinner
 * and no explanation concludes the app is broken and reloads — which starts the
 * derivation again.
 *
 * So the wait is treated as a first-class state rather than as latency:
 *
 *   - It is NAMED. "Securing your password on this device" says where the time
 *     is going and why it is not the network.
 *   - It is MEASURED. The bar is driven by a real calibration on this device
 *     (`kdf-worker.ts`), not by a fixed animation, and it is labelled an
 *     estimate because that is what it is.
 *   - It is ANNOUNCED. `role="status"` with `aria-live="polite"` tells a screen
 *     reader that work has started and when it finishes; a purely visual bar
 *     would leave a non-sighted user with silence.
 *   - It NEVER CLAIMS COMPLETION EARLY. The bar stops at 95% until the
 *     derivation actually returns.
 *
 * ===========================================================================
 * WHAT THIS SCREEN MAY NOT DO
 * ===========================================================================
 *
 * It never sends the raw password — `kdf-client.ts` derives, and only the
 * 43-character `derived_key` travels. It never explains a refusal beyond what
 * the server said, because the server deliberately says nothing: `401` is a
 * fixed envelope with no "account not found" and no "wrong password", and
 * inventing a distinction in the UI would rebuild in the client the
 * account-existence oracle Core spent `0014` §B closing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Panel } from '@/components/StateBlock';
import { CredentialDerivationError, identifierRefusal } from '@/api/kdf';
import type { DerivationProgress } from '@/api/kdf-client';
import { type AuthClient, type LoginResult } from '@/api/auth';
import { ApiError, errorBody, errorTitle, toApiError } from '@/api/errors';
import { transportBadge } from '@/api/config';

type Phase = 'idle' | 'deriving' | 'submitting';

export function Login({
  auth,
  onSignedIn,
  signOutUncleared = false,
}: {
  auth: AuthClient;
  onSignedIn: (result: LoginResult) => void;
  /**
   * The last sign-out did not reach Core, so nothing was revoked and the
   * credential was not cleared — the session is still live. Said plainly rather
   * than hidden: a login screen that implies someone is signed out when they
   * are not is the quiet version of the failure `0018` §B fixed.
   */
  signOutUncleared?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DerivationProgress | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const badge = useMemo(() => transportBadge(), []);
  const busy = phase !== 'idle';

  useEffect(() => {
    document.title = 'Sign in · Dudo';
    emailRef.current?.focus();
  }, []);

  /**
   * The rate-limit countdown.
   *
   * `retry_after_seconds` is rendered as a live number that ticks down and
   * re-enables the button by itself. ADR 0008 caps this platform on a free tier
   * with hard daily write ceilings and `pre-auth-registry.ts` allows 20 login
   * attempts per minute per source, so `rate_limited` is an ordinary state a
   * real person reaches — not an exotic one. "Try again later" with no number is
   * what makes people hammer the button and stay limited.
   */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  const emailProblem = emailTouched ? identifierRefusal(email) : null;

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy || cooldown > 0) return;

      setError(null);
      setLocalError(null);
      setEmailTouched(true);

      const refusal = identifierRefusal(email);
      if (refusal !== null) {
        emailRef.current?.focus();
        return;
      }
      if (password.length === 0) {
        setLocalError('Enter your password.');
        return;
      }

      setPhase('deriving');
      setProgress({ fraction: 0, estimatedMs: null, elapsedMs: 0, usedWorker: true });

      try {
        const result = await auth.login(email, password, (update) => {
          setProgress(update);
          if (update.fraction >= 1) setPhase('submitting');
        });
        // The password is dropped from component state the moment it is no
        // longer needed. React state is not a secure store, and holding it after
        // sign-in keeps it reachable from a devtools inspection of the tree for
        // as long as the screen is mounted.
        setPassword('');
        onSignedIn(result);
      } catch (thrown) {
        setPhase('idle');
        setProgress(null);
        if (thrown instanceof CredentialDerivationError) {
          setLocalError(thrown.message);
          return;
        }
        const apiError = toApiError(thrown);
        setError(apiError);
        if (apiError.retry_after_seconds !== null) {
          setCooldown(apiError.retry_after_seconds);
        }
      }
    },
    [auth, busy, cooldown, email, onSignedIn, password],
  );

  return (
    <div className="mx-auto grid w-full max-w-[26rem] gap-6 py-4 sm:py-10">
      <div className="grid justify-items-center gap-3 text-center">
        {/* Unlike the header, this sits on light paper, so the mark's navy field is
            visible and reads as an app-icon tile. Rounded to match. */}
        <img src="/dudo-mark.png" alt="" width={44} height={44} className="size-11 rounded-[10px]" />
        <h1 className="font-serif text-2xl text-ink">Sign in to Dudo</h1>
        <p className="text-[0.9375rem] text-ink-muted">
          Your password is prepared on this device and never sent to Dudo.
        </p>
      </div>

      {signOutUncleared ? (
        <div
          role="status"
          className="grid gap-1 rounded-[9px] border border-gold-500/50 bg-gold-50 p-4"
        >
          <p className="font-semibold text-gold-700">You may still be signed in</p>
          <p className="text-[0.8125rem] text-ink-soft">
            Dudo could not be reached to end your session, so it may still be active on this
            device until it expires. If you are on a shared computer, close the browser
            completely, or sign out again once you are back online.
          </p>
        </div>
      ) : null}

      <Panel className="p-5 sm:p-6">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <Field
            id="login-email"
            label="Email address"
            required
            error={emailProblem}
            hint="The address your Dudo account was created with."
          >
            {(aria) => (
              <Input
                {...aria}
                ref={emailRef}
                type="email"
                name="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                onBlur={() => {
                  setEmailTouched(true);
                }}
                disabled={busy}
                // `email` rather than `username`: password managers fill the
                // pair correctly, and autofill is what keeps a 600,000-iteration
                // login from also being a typing exercise.
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                maxLength={254}
              />
            )}
          </Field>

          <Field id="login-password" label="Password" required error={localError}>
            {(aria) => (
              <Input
                {...aria}
                type="password"
                name="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                disabled={busy}
                autoComplete="current-password"
              />
            )}
          </Field>

          {/*
            The derivation state. It replaces nothing — the form stays visible
            and disabled — so the person keeps their context and can see what
            they typed while they wait.
          */}
          {busy && progress ? <DerivationProgressBlock phase={phase} progress={progress} /> : null}

          {error ? <LoginError error={error} cooldown={cooldown} /> : null}

          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={busy || cooldown > 0}
            className="w-full"
          >
            {busy ? 'Signing in…' : cooldown > 0 ? `Wait ${String(cooldown)}s` : 'Sign in'}
          </Button>
        </form>
      </Panel>

      <p className="text-center text-xs text-ink-muted">
        {badge.live
          ? 'Signing in against the Dudo test API.'
          : 'Fixture build — no server. The password derivation is real; the request is not.'}
      </p>
    </div>
  );
}

/**
 * The measured wait.
 *
 * The bar is `role="progressbar"` with real `aria-valuenow`, and the sentence
 * beside it is in a `role="status"` region so the change is announced without
 * interrupting. Both matter: a sighted user gets the bar, a screen-reader user
 * gets the sentence, and neither is left with an unexplained pause.
 */
function DerivationProgressBlock({
  phase,
  progress,
}: {
  phase: Phase;
  progress: DerivationProgress;
}) {
  const percent = Math.round(progress.fraction * 100);
  const remainingMs =
    progress.estimatedMs === null ? null : Math.max(0, progress.estimatedMs - progress.elapsedMs);

  return (
    <div className="grid gap-2 rounded-[9px] border border-line bg-sunk p-4">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Preparing your password"
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <span
          className="block h-full rounded-full bg-scarlet-600 transition-[width] duration-150 ease-out"
          style={{ width: `${String(Math.max(2, percent))}%` }}
        />
      </div>

      <p role="status" aria-live="polite" className="text-[0.8125rem] text-ink-soft">
        {phase === 'submitting'
          ? 'Signing you in…'
          : 'Securing your password on this device. This is deliberate — it makes your password far harder to attack.'}
      </p>

      {phase === 'deriving' && remainingMs !== null ? (
        <p className="text-xs tabular-nums text-ink-muted">
          About {Math.max(1, Math.ceil(remainingMs / 1000))}s left (estimated on this device)
        </p>
      ) : null}

      {!progress.usedWorker ? (
        // Honest rather than quiet: on this path the tab really is frozen, and a
        // person who is told why will wait instead of reloading.
        <p className="text-xs text-ink-muted">
          This browser could not use a background thread, so the page will not respond until this
          finishes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A failed sign-in.
 *
 * `401` IS RENDERED AS ONE SENTENCE THAT NAMES NEITHER FIELD, because the server
 * deliberately does not distinguish an unknown address from a wrong password and
 * this screen must not appear to. "We could not sign you in with those details"
 * is the honest rendering of a fixed refusal.
 */
function LoginError({ error, cooldown }: { error: ApiError; cooldown: number }) {
  const isRefusal = error.code === 'unauthenticated';
  const body =
    error.code === 'rate_limited' && cooldown > 0
      ? `Too many sign-in attempts from this connection. Try again in ${String(cooldown)} seconds.`
      : errorBody(error);

  return (
    <div
      role="alert"
      className="grid gap-1 rounded-[9px] border border-scarlet-600/40 bg-scarlet-50 p-4"
    >
      <p className="font-semibold text-scarlet-700">
        {isRefusal ? 'We could not sign you in' : errorTitle(error)}
      </p>
      <p className="text-[0.8125rem] text-ink-soft">
        {isRefusal
          ? 'Check the email address and password and try again. Dudo does not say which of the two did not match.'
          : body}
      </p>
      {error.request_id ? (
        <p className="font-mono text-xs text-ink-faint">Reference {error.request_id}</p>
      ) : null}
    </div>
  );
}
