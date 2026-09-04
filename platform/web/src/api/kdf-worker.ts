/**
 * The key-derivation Web Worker.
 *
 * ===========================================================================
 * WHY THIS IS A WORKER AT ALL
 * ===========================================================================
 *
 * 600,000 PBKDF2 iterations is one to four seconds of unbroken CPU on a typical
 * machine, and much longer on a cheap phone. `crypto.subtle.deriveBits` returns
 * a promise, but the work is NOT yielded: the whole derivation runs to
 * completion inside the call and blocks its thread throughout. On the main
 * thread that means a frozen tab — no scroll, no focus ring, no repaint, no
 * cancel. A progress indicator drawn from that thread would not even animate.
 *
 * A worker moves the block off the thread that paints. The tab stays live and
 * the person can still see the form, tab between fields and read the message.
 *
 * ===========================================================================
 * THE PASSWORD CROSSES ONE `postMessage` BOUNDARY, AND THAT IS THE WHOLE OF ITS
 * TRAVEL
 * ===========================================================================
 *
 * The raw password is posted into this worker and never leaves it. It is not
 * stored, not logged, not echoed back, and not included in any error. The only
 * value posted out is the 43-character `derived_key`, which is what goes on the
 * wire anyway. `security.md` §5 — never printed, logged or echoed — is the rule,
 * and the reason it needs stating in a worker is that an unhandled throw inside
 * a worker surfaces as an `error` event whose `message` is whatever the throw
 * carried: so every branch below catches and reports a message this file wrote.
 *
 * ===========================================================================
 * THE PROGRESS IS MEASURED, NOT INVENTED — AND IT IS AN ESTIMATE, SAID SO
 * ===========================================================================
 *
 * TRUE ITERATION-LEVEL PROGRESS IS NOT AVAILABLE AND CANNOT BE MADE AVAILABLE.
 * `deriveBits` is one atomic call with no callback and no cancellation. The two
 * ways to fake it are both refused here:
 *
 *   - CHAINING SHORTER RUNS. Feeding one PBKDF2 output into the next as key
 *     material would give exact progress and would compute A DIFFERENT VALUE.
 *     PBKDF2 with 600,000 iterations is not six runs of 100,000, and a client
 *     that did this would derive a key no other client could reproduce. This is
 *     the single most tempting wrong answer in the file.
 *   - HAND-ROLLING PBKDF2 over `crypto.subtle.sign`. Correct in principle,
 *     600,000 promise round trips in practice — orders of magnitude slower than
 *     the native call, which trades a real user-visible cost for a cosmetic one.
 *
 * SO THE WORKER MEASURES INSTEAD. It first runs a short CALIBRATION derivation
 * of `CALIBRATION_ITERATIONS` and times it, which yields this machine's actual
 * cost per iteration. From that it extrapolates the full run and reports elapsed
 * time against that estimate. The number the person sees is therefore derived
 * from a real measurement on their own hardware — not a fixed animation — and
 * the estimate is spent on the same primitive it is predicting.
 *
 * IT NEVER REACHES 100% ON THE ESTIMATE. Progress is capped at
 * `PROGRESS_CEILING` until `deriveBits` actually returns, because a bar that
 * sits full while work continues is worse than no bar: it converts "this is
 * slow" into "this is broken". The estimate is allowed to be wrong; the
 * completion is not.
 *
 * THE CALIBRATION COSTS `CALIBRATION_ITERATIONS / PBKDF2_ITERATIONS` extra work
 * — about 3% — and it is charged deliberately, because a per-device estimate is
 * the difference between "a few seconds" and a number a person can wait against.
 */

import {
  CREDENTIAL_LENGTH,
  PBKDF2_ITERATIONS,
  deriveCredential,
  isSubmittableIdentifier,
  normalizeIdentifier,
} from './kdf';

/** Long enough to be measurable against timer noise, short enough to be cheap. */
const CALIBRATION_ITERATIONS = 20_000;

/** The estimate is never allowed to claim completion. See the header. */
const PROGRESS_CEILING = 0.95;

/** How often a progress message is posted while the derivation runs. */
const TICK_MS = 100;

/** A floor and a ceiling on the estimate, so a wild calibration cannot mislead. */
const MIN_ESTIMATE_MS = 250;
const MAX_ESTIMATE_MS = 120_000;

export interface KdfWorkerRequest {
  readonly kind: 'derive';
  readonly requestId: string;
  readonly identifier: string;
  readonly password: string;
}

export type KdfWorkerResponse =
  | {
      readonly kind: 'estimate';
      readonly requestId: string;
      /** Milliseconds, measured on this device. An estimate, and labelled one. */
      readonly estimatedMs: number;
    }
  | {
      readonly kind: 'progress';
      readonly requestId: string;
      /** 0..PROGRESS_CEILING. Never 1 before completion. */
      readonly fraction: number;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'done';
      readonly requestId: string;
      /** The normalised identifier — the same value used as the salt. */
      readonly email: string;
      /** Exactly `CREDENTIAL_LENGTH` base64url characters. */
      readonly derivedKey: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'failed';
      readonly requestId: string;
      /** Written by this file. Never carries the password or the derived key. */
      readonly message: string;
    };

/**
 * The worker global's `postMessage`, typed locally.
 *
 * `DedicatedWorkerGlobalScope` lives in TypeScript's `WebWorker` lib, and adding
 * that lib to `tsconfig.json` would conflict with `DOM` across the rest of the
 * project — the two declare incompatible versions of the same globals. One
 * narrow local type is cheaper than splitting the project into two compilation
 * units for a single signature.
 */
type WorkerScope = { postMessage(message: KdfWorkerResponse): void };

function post(message: KdfWorkerResponse): void {
  (self as unknown as WorkerScope).postMessage(message);
}

/**
 * Times a short derivation to learn this device's cost per iteration.
 *
 * The salt and password are the real ones. Using the real inputs costs nothing
 * and avoids a second code path whose timing could differ from the one being
 * predicted — a short run over a 6-character password is not a proxy for a long
 * run over a 60-character one, because `importKey` is charged once either way.
 */
async function calibrate(password: string, email: string): Promise<number> {
  const started = performance.now();
  await deriveCredential(password, email, CALIBRATION_ITERATIONS);
  const elapsed = performance.now() - started;
  const perIteration = elapsed / CALIBRATION_ITERATIONS;
  const estimate = perIteration * PBKDF2_ITERATIONS;
  return Math.min(MAX_ESTIMATE_MS, Math.max(MIN_ESTIMATE_MS, estimate));
}

self.addEventListener('message', (event: MessageEvent<KdfWorkerRequest>) => {
  const request = event.data;
  if (!request || request.kind !== 'derive') return;

  void (async () => {
    try {
      if (!isSubmittableIdentifier(request.identifier)) {
        // Belt and braces: the screen validates first. This branch exists so the
        // worker cannot be driven into deriving against an unnormalisable value
        // by a future caller that forgot.
        post({
          kind: 'failed',
          requestId: request.requestId,
          message: 'That is not an email address Dudo can use.',
        });
        return;
      }
      const email = normalizeIdentifier(request.identifier);

      const estimatedMs = await calibrate(request.password, email);
      post({ kind: 'estimate', requestId: request.requestId, estimatedMs });

      const started = performance.now();
      // The ticker runs on the worker's own event loop. `deriveBits` blocks that
      // loop while it runs, so these ticks land in whatever gaps the engine
      // leaves and, on some engines, all at once at the end. The main thread
      // therefore does NOT depend on them for animation — it interpolates from
      // `estimatedMs` itself (see `kdf-client.ts`) and treats a tick as a
      // correction. That is why the design still works when the ticks do not.
      const ticker = setInterval(() => {
        const elapsedMs = performance.now() - started;
        post({
          kind: 'progress',
          requestId: request.requestId,
          fraction: Math.min(PROGRESS_CEILING, elapsedMs / estimatedMs),
          elapsedMs,
        });
      }, TICK_MS);

      let derivedKey: string;
      try {
        derivedKey = await deriveCredential(request.password, email, PBKDF2_ITERATIONS);
      } finally {
        clearInterval(ticker);
      }

      if (derivedKey.length !== CREDENTIAL_LENGTH) {
        // `deriveCredential` already throws on this. Repeated here because it is
        // the one invariant whose failure must never be recoverable into a send.
        post({
          kind: 'failed',
          requestId: request.requestId,
          message: 'The derived key was the wrong length and was not sent.',
        });
        return;
      }

      post({
        kind: 'done',
        requestId: request.requestId,
        email,
        derivedKey,
        elapsedMs: performance.now() - started,
      });
    } catch (thrown) {
      // The message is written here, never taken from the throw, because a
      // thrown value on this path could carry input. `security.md` §5.
      post({
        kind: 'failed',
        requestId: request.requestId,
        message:
          thrown instanceof Error && thrown.name === 'CredentialDerivationError'
            ? thrown.message
            : 'Your password could not be prepared for sending on this device.',
      });
    }
  })();
});
