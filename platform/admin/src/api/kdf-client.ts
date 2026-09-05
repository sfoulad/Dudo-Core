/**
 * The main-thread side of the key derivation.
 *
 * It owns the worker's lifetime, turns its messages into a smooth progress
 * value, and falls back to the main thread when a worker cannot be created.
 *
 * ===========================================================================
 * THE PROGRESS VALUE IS INTERPOLATED HERE, CORRECTED BY THE WORKER
 * ===========================================================================
 *
 * The worker posts an `estimate` derived from a real timed calibration on this
 * device, then posts `progress` ticks as it goes. The ticks cannot be relied on
 * for animation: `deriveBits` blocks the worker's event loop, so on some engines
 * every tick is delivered at once when the derivation finishes.
 *
 * So this file drives the bar from a `requestAnimationFrame` loop on the MAIN
 * thread — which is not blocked — using the worker's measured estimate as the
 * denominator, and treats each arriving tick as a correction rather than as the
 * source. The result animates smoothly, is grounded in a measurement of the
 * user's own hardware, and never claims completion before the derivation
 * returns.
 *
 * ===========================================================================
 * THE FALLBACK IS DELIBERATELY VISIBLE
 * ===========================================================================
 *
 * If a worker cannot be constructed — a Content-Security-Policy without
 * `worker-src`, a browser with workers disabled — the derivation still happens,
 * on the main thread, and the tab WILL freeze for a second or more. That is a
 * degraded experience and the caller is told which mode ran (`usedWorker`), so
 * the screen can say so rather than leaving someone to wonder why the page went
 * dead. Silently degrading is how a performance regression becomes permanent.
 */

import {
  CREDENTIAL_LENGTH,
  CredentialDerivationError,
  deriveLoginCredential,
  identifierRefusal,
} from './kdf';
import type { KdfWorkerRequest, KdfWorkerResponse } from './kdf-worker';

export interface DerivationProgress {
  /** 0..1. Reaches 1 only when the derivation has actually returned. */
  readonly fraction: number;
  /** The worker's measured estimate for this device, or null before it lands. */
  readonly estimatedMs: number | null;
  readonly elapsedMs: number;
  /** False when a worker could not be created and the main thread is blocked. */
  readonly usedWorker: boolean;
}

export interface DerivedLogin {
  /** The normalised identifier. The same value was used as the salt. */
  readonly email: string;
  /** Exactly 43 base64url characters. */
  readonly derivedKey: string;
  readonly elapsedMs: number;
  readonly usedWorker: boolean;
}

/**
 * Creates the worker.
 *
 * `new URL(..., import.meta.env.url)` with `{ type: 'module' }` is Vite's
 * supported form: it is statically analysable, so the worker is bundled and
 * hashed like any other asset and needs no build configuration and no extra
 * dependency.
 */
function spawnWorker(): Worker | null {
  try {
    return new Worker(new URL('./kdf-worker.ts', import.meta.url), {
      type: 'module',
      name: 'dudo-kdf',
    });
  } catch {
    return null;
  }
}

let requestCounter = 0;

/**
 * Derives `email` and `derived_key` for a login, reporting progress.
 *
 * THE PASSWORD IS HELD FOR THE LIFETIME OF THIS CALL AND NO LONGER. It is not
 * stored anywhere, not put in a module-level variable, and not retained by the
 * returned value. The worker is terminated on every exit path, which is also
 * what drops the worker's copy.
 */
export async function deriveLogin(
  identifier: string,
  password: string,
  onProgress: (progress: DerivationProgress) => void,
): Promise<DerivedLogin> {
  const refusal = identifierRefusal(identifier);
  if (refusal !== null) {
    // Refuse before spending a second of the person's time on a derivation whose
    // result could not be sent.
    throw new CredentialDerivationError(refusal);
  }

  const worker = spawnWorker();
  if (worker === null) {
    return deriveOnMainThread(identifier, password, onProgress);
  }

  const requestId = `kdf_${String((requestCounter += 1))}`;
  const started = performance.now();

  return await new Promise<DerivedLogin>((resolve, reject) => {
    let estimatedMs: number | null = null;
    let settled = false;
    let frame = 0;

    const report = (fraction: number): void => {
      onProgress({
        fraction,
        estimatedMs,
        elapsedMs: performance.now() - started,
        usedWorker: true,
      });
    };

    // The animation loop. It runs on the main thread, which the derivation does
    // not block, so the bar moves even while the worker is fully occupied.
    const tick = (): void => {
      if (settled) return;
      const elapsed = performance.now() - started;
      // Before the estimate lands, the calibration is still running: show a
      // small, honest amount of progress rather than nothing.
      const fraction =
        estimatedMs === null
          ? Math.min(0.05, elapsed / 4000)
          : Math.min(0.95, elapsed / estimatedMs);
      report(fraction);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const finish = (): void => {
      settled = true;
      cancelAnimationFrame(frame);
      // Terminating drops the worker's copy of the password along with the
      // thread. It is done on every path, including failure.
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<KdfWorkerResponse>) => {
      const message = event.data;
      if (!message || message.requestId !== requestId) return;

      if (message.kind === 'estimate') {
        estimatedMs = message.estimatedMs;
        return;
      }
      if (message.kind === 'progress') {
        // A correction from the worker's own clock. It does not drive the
        // animation; it keeps it from drifting far from reality.
        if (estimatedMs !== null) report(Math.min(0.95, message.fraction));
        return;
      }
      if (message.kind === 'done') {
        finish();
        if (message.derivedKey.length !== CREDENTIAL_LENGTH) {
          reject(
            new CredentialDerivationError(
              `The derived key is ${String(message.derivedKey.length)} characters, not ` +
                `${String(CREDENTIAL_LENGTH)}. It was not sent.`,
            ),
          );
          return;
        }
        onProgress({
          fraction: 1,
          estimatedMs,
          elapsedMs: message.elapsedMs,
          usedWorker: true,
        });
        resolve({
          email: message.email,
          derivedKey: message.derivedKey,
          elapsedMs: message.elapsedMs,
          usedWorker: true,
        });
        return;
      }
      finish();
      reject(new CredentialDerivationError(message.message));
    });

    worker.addEventListener('error', () => {
      finish();
      // The event's own message is not used: it can carry a line from the
      // worker's source, and this path has a password in scope.
      reject(
        new CredentialDerivationError(
          'Your password could not be prepared for sending. Reload the page and try again.',
        ),
      );
    });

    const request: KdfWorkerRequest = { kind: 'derive', requestId, identifier, password };
    worker.postMessage(request);
  });
}

/**
 * The degraded path. THE TAB FREEZES HERE and the caller is told so.
 *
 * One frame is yielded before starting so the screen can paint the "this will
 * take a moment" state before the thread stops responding. Without that yield
 * the person sees nothing at all until the derivation finishes.
 */
async function deriveOnMainThread(
  identifier: string,
  password: string,
  onProgress: (progress: DerivationProgress) => void,
): Promise<DerivedLogin> {
  onProgress({ fraction: 0.02, estimatedMs: null, elapsedMs: 0, usedWorker: false });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

  const started = performance.now();
  const result = await deriveLoginCredential(identifier, password);
  const elapsedMs = performance.now() - started;

  onProgress({ fraction: 1, estimatedMs: elapsedMs, elapsedMs, usedWorker: false });
  return {
    email: result.email,
    derivedKey: result.derived_key,
    elapsedMs,
    usedWorker: false,
  };
}
