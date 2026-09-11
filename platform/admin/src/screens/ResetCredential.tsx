/**
 * Reset a member's credential.
 *
 * ===========================================================================
 * THE NEW PASSWORD IS GENERATED AND DERIVED **BEFORE** THE CHALLENGE, BECAUSE
 * THE CHALLENGE BINDS IT
 * ===========================================================================
 *
 * `resetCredentialInput` is six fields: `principal_id`, `target_identifier`,
 * `derived_value`, plus the three confirmation fields. Parameters are
 * body-minus-three with no path parameters, so the binding is
 * `{principal_id, target_identifier, derived_value}` — **`derived_value`
 * included.**
 *
 * That fixes the order and it is not obvious from the outside:
 *
 *   1. generate a new password (24 CSPRNG bytes)
 *   2. derive it, salted with the **TARGET'S** identifier
 *   3. request the challenge, which binds that derived value
 *   4. the operator reads the statement and types their **OWN** password
 *   5. derive the re-authentication value, salted with the **OPERATOR'S** own
 *      identifier
 *   6. submit
 *
 * TWO DERIVATIONS, TWO DIFFERENT SALTS, AND CONFUSING THEM IS THE DEFECT THAT
 * MADE THIS ROUTE UNBUILDABLE FOR HALF A DAY. `target_identifier` is the
 * account being reset; `reauth_identifier` is the operator performing the reset.
 * Both are on the wire, both now say whose they are, and this screen never mixes
 * them: step 2 uses the target's, step 5 uses the operator's, and step 5 happens
 * inside `ConfirmationGate` which only ever handles the caller's.
 *
 * ===========================================================================
 * DO NOT "SIMPLIFY" THIS BY GENERATING THE PASSWORD AFTER THE CONFIRMATION
 * ===========================================================================
 *
 * The ordering above looks like an inconvenience and is the point of the
 * mechanism. **Binding `derived_value` is what makes the human's approval cover
 * WHICH CREDENTIAL IS WRITTEN, not merely that a reset happens.** A confirmation
 * that omitted it would let the statement a person approved and the credential
 * actually written come apart — the substitution attack this mechanism exists to
 * stop, one field over.
 *
 * So the obvious tidy — generate the password after approval, so it need not be
 * held in memory during the confirmation — **removes `derived_value` from the
 * binding** and silently converts a confirmation of a specific credential into a
 * confirmation that something happened.
 *
 * THE TRADE, ACCEPTED DELIBERATELY: hold a generated secret in browser memory
 * across the confirmation, in exchange for the confirmation covering the
 * credential. What makes that acceptable is the handling rather than the
 * duration — never logged, never in a URL, never stored, the operator's typed
 * password dropped the moment it is derived from, and the generated one dropped
 * when this screen unmounts or the panel is dismissed.
 *
 * ===========================================================================
 * THE CONSEQUENCE FOR THE NEW PASSWORD, STATED RATHER THAN DISCOVERED
 * ===========================================================================
 *
 * The generated password is held in memory across the whole confirmation —
 * including while the operator types their own password — because it must be
 * shown after success and cannot be recovered from anywhere. It is never
 * logged, never in a URL, never stored, and never sent: **only the derived value
 * leaves the browser.**
 *
 * `resetCredentialOutput` carries `principal_id`, `sessions_revoked` and
 * `warnings` and **no credential of any kind**, so this browser holds the only
 * copy — exactly as at onboarding, and it is shown once.
 *
 * ===========================================================================
 * WHERE THIS LIVES, AND WHY
 * ===========================================================================
 *
 * On the Organization detail screen, immediately after a successful member
 * resolve — because that is the only place both required values exist. The
 * resolve returns `principal_id`; the operator typed `target_identifier` into
 * it. There is no route that finds a principal by email, so a reset cannot be
 * started from anywhere else, and it must not be offered where it could not be
 * completed.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@dudo/ui';
import { LoadingBlock } from '@/components/StateBlock';
import { ConfirmationGate } from '@/components/ConfirmationGate';
import { buildConfirmedRequest } from '@/api/confirmation';
import { createOnboardingCredential } from '@/api/onboarding-credential';
import type { DerivationProgress } from '@dudo/client-kdf/client';
import {
  CREDENTIAL_RESET_ACTION_ID,
  CREDENTIAL_RESET_PATH,
  type PlatformClient,
  type ResetCredentialOutput,
} from '@/api/platform';
import { toApiError, writeIsCertainlyAbsent, type ApiError } from '@/api/errors';
import {
  formatCount,
  useLocale,
  useT,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';

/** The new credential, held only while this screen is mounted. */
interface NewCredential {
  readonly password: string;
  readonly derivedValue: string;
  /** The normalised target identifier that was used as the salt. */
  readonly identifier: string;
}

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'preparing'; readonly progress: DerivationProgress }
  | { readonly kind: 'confirming'; readonly credential: NewCredential }
  | { readonly kind: 'done'; readonly credential: NewCredential; readonly result: ResetCredentialOutput }
  /** Failed BEFORE anything was sent — generation or derivation. */
  | { readonly kind: 'failed'; readonly error: ApiError }
  /**
   * THE SUBMISSION FAILED AFTER THE OPERATOR APPROVED. The credential was
   * derived and bound; whether it was WRITTEN depends on the code. See
   * `writeIsCertainlyAbsent`.
   */
  | {
      readonly kind: 'failed-after-approval';
      readonly credential: NewCredential;
      readonly error: ApiError;
    };

/*
 * `writeIsCertainlyAbsent` LIVES IN `api/errors.ts`, not here. It is a property
 * of the error code rather than of this screen — and a `.tsx` file cannot be
 * loaded by Node's type stripping, so keeping it here would have made the
 * classification assertable only by grepping source. See its header.
 */

export function ResetCredential({
  platform,
  principalId,
  targetIdentifier,
}: {
  platform: PlatformClient;
  /** From the member resolve. The only way to obtain it. */
  principalId: string;
  /** What the operator typed into the resolve. The KDF salt for the new value. */
  targetIdentifier: string;
}) {
  const t = useT();
  /*
   * TYPED AS `HTMLButtonElement` HERE AND RELAYED AS `HTMLElement`. The gate
   * only ever calls `.focus()`, so it asks for the widest thing that has one;
   * this screen knows the node is a button and `<Button>`'s own ref type
   * requires the narrower one. The widening is safe in that direction.
   */
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const begin = useCallback(() => {
    setStage({
      kind: 'preparing',
      progress: { fraction: 0, estimatedMs: null, elapsedMs: 0, usedWorker: true },
    });
    /*
     * SALTED WITH THE TARGET'S IDENTIFIER. `createOnboardingCredential`
     * generates 24 CSPRNG bytes and derives through the same login KDF; the
     * identifier it is given is the salt. Here that is the account being RESET —
     * the opposite of the re-authentication step, which uses the operator's own.
     */
    void createOnboardingCredential(targetIdentifier, (progress) => {
      if (progress.fraction < 1) {
        setStage((current) =>
          current.kind === 'preparing' ? { kind: 'preparing', progress } : current,
        );
      }
    }).then(
      (credential) => {
        setStage({
          kind: 'confirming',
          credential: {
            password: credential.password,
            derivedValue: credential.derivedValue,
            identifier: credential.identifier,
          },
        });
      },
      (thrown: unknown) => {
        setStage({ kind: 'failed', error: toApiError(thrown) });
      },
    );
  }, [targetIdentifier]);

  if (stage.kind === 'idle') {
    return (
      <div className="mt-4 rounded-[7px] border border-line bg-sunk/60 p-4">
        <p className="text-[0.875rem] leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">{t('reset.offer.lead')}</span>{' '}
          {t('reset.offer.body')}
        </p>
        {/*
          WHERE FOCUS RETURNS IF THE CONFIRMATION IS DISMISSED. This button is
          unmounted for as long as the gate is up — the whole `idle` stage is
          replaced — so the ref is null while the panel is open and holds this
          node again the moment the stage comes back. See the gate's own note on
          why the restore happens in its unmount cleanup rather than before
          `onCancel`.
        */}
        <Button ref={openerRef} variant="secondary" size="sm" className="mt-3" onClick={begin}>
          {t('reset.offer.action')}
        </Button>
      </div>
    );
  }

  if (stage.kind === 'preparing') {
    return (
      <div className="mt-4">
        <LoadingBlock label={t('reset.preparing')} />
      </div>
    );
  }

  if (stage.kind === 'failed') {
    return (
      <div className="mt-4">
        <p role="alert" className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem]">
          <span className="font-bold text-scarlet-700">{t('reset.notStarted.title')}</span>{' '}
          <span className="text-ink-soft">{stage.error.message}</span>{' '}
          <span className="font-semibold">{t('reset.notStarted.unchanged')}</span>
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            setStage({ kind: 'idle' });
          }}
        >
          {t('reset.notStarted.retry')}
        </Button>
      </div>
    );
  }

  if (stage.kind === 'done') {
    return <ResetResult credential={stage.credential} result={stage.result} />;
  }

  if (stage.kind === 'failed-after-approval') {
    return <ResetUncertain credential={stage.credential} error={stage.error} />;
  }

  return (
    <ResetConfirmation
      openerRef={openerRef}
      platform={platform}
      principalId={principalId}
      targetIdentifier={targetIdentifier}
      credential={stage.credential}
      onDone={(result) => {
        setStage({ kind: 'done', credential: stage.credential, result });
      }}
      onFailedAfterApproval={(error) => {
        setStage({ kind: 'failed-after-approval', credential: stage.credential, error });
      }}
      onCancel={() => {
        // The generated password is dropped unused. Nothing was sent, so
        // nothing was changed and the value protects nothing by surviving.
        setStage({ kind: 'idle' });
      }}
    />
  );
}

function ResetConfirmation({
  platform,
  principalId,
  targetIdentifier,
  credential,
  onDone,
  onFailedAfterApproval,
  onCancel,
  openerRef,
}: {
  platform: PlatformClient;
  principalId: string;
  targetIdentifier: string;
  credential: NewCredential;
  onDone: (result: ResetCredentialOutput) => void;
  onFailedAfterApproval: (error: ApiError) => void;
  onCancel: () => void;
  /** Threaded straight through. The gate requires it; this panel only relays. */
  openerRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  /*
   * THE BOUND PARAMETERS, BUILT ONCE. Body-minus-three, no path parameters —
   * so `{principal_id, target_identifier, derived_value}`. The same object is
   * sent to the challenge and implied by the submission body, because
   * `buildConfirmedRequest` produces both.
   *
   * `target_identifier` IS THE NORMALISED FORM the derivation actually salted
   * with, not the raw string the operator typed. Sending the raw one would bind
   * a value that differs from what was hashed.
   */
  const request = useMemo(
    () =>
      buildConfirmedRequest({
        pathTemplate: CREDENTIAL_RESET_PATH,
        pathValues: {},
        bodyFields: {
          principal_id: principalId,
          target_identifier: credential.identifier,
          derived_value: credential.derivedValue,
        },
      }),
    [principalId, credential],
  );

  return (
    <div className="mt-4">
      <p className="mb-3 text-[0.8125rem] leading-relaxed text-ink-muted">
        {t('reset.confirm.intro')}{' '}
        <span className="font-semibold text-ink-soft">
          {t('reset.confirm.typedPrefix')}{' '}
          {/*
           * `bdi` ISOLATES THE IDENTIFIER FROM THE SURROUNDING DIRECTION, and it
           * matters here rather than being a flourish. An email address is
           * strongly LTR and this sentence is RTL in Arabic; without isolation
           * the bidirectional algorithm reorders the punctuation AROUND it, so
           * `a.b@c.com` can render with a trailing dot leading. **An identifier
           * an operator is being asked to CHECK must render exactly.**
           */}
          <bdi className="font-mono">{targetIdentifier}</bdi>{' '}
          {t('reset.confirm.typedSuffix')}
        </span>
      </p>
      <ConfirmationGate
        openerRef={openerRef}
        title={t('reset.confirm.title')}
        boundParameters={request.parameters}
        requestChallenge={() =>
          platform.requestConfirmation({
            actionId: CREDENTIAL_RESET_ACTION_ID,
            parameters: request.parameters,
          })
        }
        /*
         * THE SUBMISSION'S FAILURE IS HANDLED HERE, NOT BY THE GATE, and it does
         * not rethrow. The gate's generic failure says "Nothing was changed",
         * which is true for a challenge that never issued and MAY BE FALSE for a
         * submission that timed out — only this screen knows a credential is at
         * stake, so only this screen may describe the outcome.
         */
        submit={async (confirmation) => {
          try {
            const result = await platform.resetCredential({
              path: request.path,
              bodyWithoutConfirmation: request.bodyWithoutConfirmation,
              ...confirmation,
            });
            onDone(result);
          } catch (thrown) {
            onFailedAfterApproval(toApiError(thrown));
          }
        }}
        onCancel={onCancel}
      />
    </div>
  );
}

/**
 * The submission failed AFTER the operator approved.
 *
 * ===========================================================================
 * TWO OUTCOMES, AND THE OPERATOR MUST NOT HAVE TO GUESS WHICH THEY HOLD
 * ===========================================================================
 *
 * CORE REFUSED — a conflict, a quota, a forbidden. Nothing was written, the old
 * password still works, and the generated one is an inert random string. Said
 * plainly, so nobody sends a customer a password that was never written and
 * turns an account that was merely broken into one that is confirmed broken.
 *
 * OR IT IS UNKNOWN — a timeout, an unreachable server, a 500. The request may
 * have arrived and succeeded with the response lost. **THE PASSWORD IS STILL
 * SHOWN IN THIS CASE**, and that is the deliberate part: if the write did land,
 * this browser holds the only copy and discarding it strands the account
 * permanently. Showing an inert string costs nothing; discarding a live
 * credential cannot be undone. So it is shown, labelled as uncertain, with the
 * one action that resolves it — try signing in as that person.
 */
function ResetUncertain({
  credential,
  error,
}: {
  credential: NewCredential;
  error: ApiError;
}) {
  const t = useT();
  const certainlyNotWritten = writeIsCertainlyAbsent(error);

  /*
   * FOCUSED AS WELL AS ANNOUNCED. Both branches carry `role="alert"`, which is
   * assertive and correct here — but an alert announces the text and leaves
   * focus where it was, and where it was is a control that no longer exists.
   * On the uncertain branch the panel holds a password the operator must record
   * before leaving, so arriving there is not optional.
   */
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  if (certainlyNotWritten) {
    return (
      <section
        ref={panelRef}
        tabIndex={-1}
        role="alert"
        className="mt-4 rounded-[12px] border-2 border-scarlet-600 bg-scarlet-50 p-5"
      >
        <h3 className="text-base font-bold text-scarlet-700">{t('reset.refused.title')}</h3>
        <p className="mt-2 leading-relaxed text-ink">
          {t('reset.refused.lead')}{' '}
          <span className="font-bold">{t('reset.refused.emphasis')}</span>{' '}
          {t('reset.refused.warning')}
        </p>
        <p className="mt-2 text-[0.875rem] text-ink-soft">{error.message}</p>
        {error.request_id ? (
          <p className="mt-2 text-xs text-ink-muted">
            {t('denied.reference')}{' '}
            <bdi className="font-mono break-all">{error.request_id}</bdi>
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="alert"
      className="mt-4 rounded-[12px] border-2 border-gold-500 bg-gold-50 p-5"
    >
      <h3 className="text-base font-bold text-gold-700">{t('reset.unknown.title')}</h3>
      <p className="mt-2 leading-relaxed text-ink">
        {t('reset.unknown.body')}{' '}
        <span className="font-bold">{t('reset.unknown.noGuess')}</span>
      </p>
      <p className="mt-2 leading-relaxed text-ink">
        <span className="font-bold">{t('reset.unknown.record')}</span>{' '}
        {t('reset.unknown.recordWhy')}
      </p>

      <dl className="mt-4 grid gap-3">
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('reset.unknown.identifierLabel')}
          </dt>
          <dd className="mt-1 text-[0.9375rem] text-ink">
            <bdi className="font-mono break-all">{credential.identifier}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('reset.unknown.passwordLabel')}
          </dt>
          <dd className="mt-1 rounded-[7px] border border-line-strong bg-surface px-3 py-2 text-[0.9375rem] text-ink">
            <bdi className="font-mono break-all select-all">{credential.password}</bdi>
          </dd>
        </div>
      </dl>

      <p className="mt-4 leading-relaxed text-ink-soft">
        <span className="font-semibold">{t('reset.unknown.resolveLead')}</span>{' '}
        {t('reset.unknown.resolveBody')}{' '}
        <span className="font-semibold">{t('reset.unknown.doNotRepeat')}</span>{' '}
        {t('reset.unknown.doNotRepeatWhy')}
      </p>
      <p className="mt-2 text-[0.875rem] text-ink-soft">{error.message}</p>
      {error.request_id ? (
        <p className="mt-2 text-xs text-ink-muted">
          {t('denied.reference')}{' '}
          <bdi className="font-mono break-all">{error.request_id}</bdi>
        </p>
      ) : null}
    </section>
  );
}

/*
 * EVERY CATEGORY, NAMED — and the type is what makes that true rather than a
 * habit. `Record<PluralCategory, MessageKey>` is total over what
 * `Intl.PluralRules` can return, so **omitting `two` does not compile.** A
 * partial map with a runtime fallback would render English into an Arabic page
 * for exactly the counts nobody tests with, which is the failure this module's
 * no-fallback rule exists to refuse (`architecture.md` §3a: the obligation is a
 * mechanism, not something to remember).
 */
const SESSION_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'reset.sessions.zero',
  one: 'reset.sessions.one',
  two: 'reset.sessions.two',
  few: 'reset.sessions.few',
  many: 'reset.sessions.many',
  other: 'reset.sessions.other',
};

/**
 * The new password, shown once.
 *
 * Same obligations as onboarding: this browser holds the only copy, it is not
 * recoverable, and `0026`'s accepted cost applies — there is no self-service
 * password change, so whoever performs a reset knows that account's password
 * until it is reset again.
 */
function ResetResult({
  credential,
  result,
}: {
  credential: NewCredential;
  result: ResetCredentialOutput;
}) {
  const { locale, t } = useLocale();
  /*
   * ANNOUNCED AND FOCUSED, because this panel REPLACES the form the operator was
   * using. Without either, a screen-reader user presses Approve and hears
   * nothing at all — the control they were on is gone and the outcome is
   * elsewhere on the page.
   *
   * `role="status"` (polite) rather than `alert`: this is a success, and an
   * assertive interruption would talk over the operator mid-sentence. The focus
   * move is what guarantees arrival; the live region is what covers the case
   * where focus was already elsewhere.
   *
   * `tabIndex={-1}` makes it programmatically focusable without adding it to the
   * tab order — a heading a keyboard user must tab THROUGH on every subsequent
   * pass would be its own nuisance.
   */
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="mt-4 rounded-[12px] border-2 border-green-500 bg-surface p-5"
    >
      <h3 className="text-base font-bold text-green-700">{t('reset.done.title')}</h3>

      {result.warnings.length > 0 ? (
        <div
          role="status"
          className="mt-3 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.875rem] leading-relaxed text-ink"
        >
          <p className="font-bold">{t('reset.done.partial')}</p>
          {/*
           * THE WARNING CODES ARE NOT TRANSLATED AND MUST NOT BE. They are
           * Core's identifiers, they are what an operator quotes when reporting
           * this, and a localised rendering would be a string nobody upstream
           * can search for.
           */}
          <ul className="mt-1 grid list-disc gap-1 ps-4">
            {result.warnings.map((warning) => (
              <li key={warning}>
                <bdi className="font-mono">{warning}</bdi>
              </li>
            ))}
          </ul>
          <p className="mt-1">{t('reset.done.partialStillLive')}</p>
        </div>
      ) : null}

      <p className="mt-3 leading-relaxed text-ink">
        <span className="font-bold">{t('reset.done.record')}</span> {t('reset.done.recordWhy')}
      </p>

      <dl className="mt-3 grid gap-3">
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('reset.done.identifierLabel')}
          </dt>
          <dd className="mt-1 text-[0.9375rem] text-ink">
            <bdi className="font-mono break-all">{credential.identifier}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('reset.done.passwordLabel')}
          </dt>
          <dd className="mt-1 rounded-[7px] border border-line-strong bg-sunk px-3 py-2 text-[0.9375rem] text-ink">
            <bdi className="font-mono break-all select-all">{credential.password}</bdi>
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[0.8125rem] text-ink-muted">
        {formatCount(locale, result.sessions_revoked, SESSION_FORMS, t)}
      </p>

      <p className="mt-3 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
        <span className="font-semibold">{t('reset.done.youWillKnow')}</span>{' '}
        {t('reset.done.noSelfService')}
      </p>
    </section>
  );
}
