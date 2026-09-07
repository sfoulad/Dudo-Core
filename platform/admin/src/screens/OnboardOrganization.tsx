/**
 * Onboarding — create an Organization, its first admin, and that admin's
 * credential.
 *
 * ===========================================================================
 * THIS BROWSER HOLDS THE ONLY COPY OF THE PASSWORD IN EXISTENCE
 * ===========================================================================
 *
 * Not the operator's only copy — the ONLY copy. `0026` option B: this console
 * generates the password and derives from it, and `onboardOrganizationOutput`
 * carries no credential field of any kind. Core stores a verifier it cannot
 * invert. If this screen loses the value, the account is unreachable and the
 * only remedy is a credential reset.
 *
 * So the credential panel is the most carefully built thing on this page:
 *
 *   - IT IS NOT RENDERED UNTIL CORE ANSWERS 201. Showing it beside a request
 *     that then failed hands an operator a credential for an account that does
 *     not exist, and afterwards they cannot tell which they are holding.
 *   - IT IS SHOWN ONCE and says so before it is dismissed, not after.
 *   - DISMISSING IT REQUIRES A DELIBERATE CONFIRMATION, because the alternative
 *     is a mis-click that destroys the only copy of a credential.
 *   - IT IS NEVER PERSISTED. React state for the life of this screen, dropped on
 *     unmount. No storage, no URL, no log.
 *
 * ===========================================================================
 * THE WORKSPACE NAME IS NOT ASKED FOR, AND THE SCREEN SAYS WHY
 * ===========================================================================
 *
 * `first_workspace_name` is required by the contract, validated by Core, and
 * discarded — `business` has two columns and naming belongs to the
 * organization-structure slice. Team Lead ruling: send a fixed placeholder and
 * do not prompt. An operator who types "Main Campus" and watches it vanish has
 * been lied to by the form, and nothing is preserved for later.
 *
 * ===========================================================================
 * THE NAME IS OPTIONAL HERE, AND THE REGISTRATIONS ARE NOT ASKED FOR AT ALL
 * ===========================================================================
 *
 * `display_name` is OPTIONAL on this write path — Team Lead ruling, 2026-09-07,
 * on sequencing rather than design: "a server requiring a field the deployed
 * console does not yet send is an onboarding outage." So this form accepts a
 * name and never requires one, and an operator who does not have it yet can
 * onboard now and record it on the Organization's own page afterwards.
 *
 * THE CR AND THE VAT REGISTRATION ARE NOT ON THIS FORM, AND THAT IS THE
 * CONTRACT RATHER THAN A CHOICE. `onboardOrganizationInput` accepts
 * `admin_identifier`, `display_name`, `template_id`, `first_workspace_name` and
 * `derived_value`, with `additionalProperties: false` — there is no field for
 * either registration, and every Organization starts `not_recorded` by design.
 * They are recorded on the detail page, which the success panel links to.
 *
 * ===========================================================================
 * A 201 WITH WARNINGS IS A SUCCESS
 * ===========================================================================
 *
 * `workspace_id: null` plus `first_workspace_not_created` means the Organization
 * exists, the admin exists, the credential is live, and the tenant-side write
 * failed. Rendering that as an error would be wrong twice: the operator would
 * believe nothing was created, and would discard a credential that is the only
 * way into a real customer.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { LoadingBlock } from '@/components/StateBlock';
import { cn } from '@/lib/cn';
import { buildHash, organizationDetailPath } from '@/lib/router';
import { identifierRefusal } from '@/api/kdf';
import type { DerivationProgress } from '@/api/kdf-client';
import { createOnboardingCredential } from '@/api/onboarding-credential';
import {
  MAX_DISPLAY_NAME_LENGTH,
  PLATFORM_MAX_PAGE_SIZE,
  displayNameRefusal,
  isKnownOnboardingWarning,
  type OnboardOrganizationOutput,
  type PlatformClient,
  type Template,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

/**
 * ===========================================================================
 * THE NAME FIELD WAS BRIEFLY UNSENDABLE, AND THE REASON OUTLIVES THE GATE.
 * ===========================================================================
 *
 * `organization-onboarding-v1.schema.json` published `display_name` while
 * `platform.organizations.create` declared only four fields —
 * `admin_identifier`, `template_id`, `first_workspace_name`, `derived_value`.
 * **The platform class refuses any undeclared field BEFORE AUTHENTICATION**, so
 * a client that trusted the contract would have failed the first onboarding
 * carrying the field and every one after it, on the route that creates
 * customers.
 *
 * *** SO READING THE CONTRACT WAS NOT EVIDENCE THAT CORE ACCEPTED THE FIELD. ***
 * That is the sentence worth keeping. Core landed it on 2026-09-07 — declared,
 * parsed optionally with the same check the update route uses, persisted as
 * NULL when absent, nothing synthesised — and the field is sent normally below.
 *
 * IT IS THE MIRROR OF THE RULING THAT GOVERNS THE FIELD. `0031` makes
 * `display_name` optional so that a server requiring what the client does not
 * send cannot cause an outage; the opposite direction — a client sending what
 * the server does not accept — was open, and it was open *because the contract
 * said the field was there*.
 *
 * THE GATE THAT HELD THIS SHUT IS GONE, AND ITS ABSENCE IS DELIBERATE. A flag
 * pinned to `true` keeps a branch nobody reaches, and the unreachable half here
 * was a paragraph telling operators the name is recorded somewhere else — which
 * is now false. **Dead prose in a client is a stale assertion waiting for
 * someone to re-enable it**, so the branch went with the gate.
 */

/** What the operator must record. Held only while this screen is mounted. */
interface Outcome {
  readonly result: OnboardOrganizationOutput;
  readonly identifier: string;
  readonly password: string;
  readonly templateName: string;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'deriving'; readonly progress: DerivationProgress }
  | { readonly kind: 'sending' };

export function OnboardOrganization({
  platform,
  onOnboarded,
}: {
  platform: PlatformClient;
  onOnboarded: () => void;
}) {
  const [templates, setTemplates] = useState<readonly Template[] | null>(null);
  const [templatesError, setTemplatesError] = useState<ApiError | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [localError, setLocalError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const busy = phase.kind !== 'idle';

  /*
   * The Template list, so an operator picks rather than types an opaque
   * identifier. ONE CALL, ON MOUNT — it is an audited platform call like every
   * other, so there is no polling and no refetch on focus.
   *
   * `PLATFORM_MAX_PAGE_SIZE` rather than the default: this is a picker, and a
   * second page of it would be a paginated dropdown nobody wants. If a platform
   * ever has more than 100 business types, this becomes a search field and that
   * is a real change rather than a bigger number.
   */
  useEffect(() => {
    let cancelled = false;
    void platform.listTemplates({ pageSize: PLATFORM_MAX_PAGE_SIZE }).then(
      (page) => {
        if (!cancelled) setTemplates(page.data);
      },
      (thrown: unknown) => {
        if (!cancelled) setTemplatesError(toApiError(thrown));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;

      const refusal = identifierRefusal(identifier);
      if (refusal !== null) {
        setLocalError(refusal);
        return;
      }
      /*
       * THE NAME IS OPTIONAL, SO ONLY A NAME THE OPERATOR ACTUALLY TYPED IS
       * CHECKED. An empty field is omitted from the request and means "no name
       * recorded" — it is not an error, and treating it as one would make an
       * optional field required in the client while the contract says otherwise.
       */
      const nameRefusal = displayName === '' ? null : displayNameRefusal(displayName);
      if (nameRefusal !== null) {
        setNameError(nameRefusal);
        return;
      }
      if (templateId === '') {
        setLocalError('Choose a business type.');
        return;
      }
      setLocalError(null);
      setNameError(null);
      setFailure(null);

      const chosen = templates?.find((template) => template.template_id === templateId);

      let derivationDone = false;
      setPhase({
        kind: 'deriving',
        progress: { fraction: 0, estimatedMs: null, elapsedMs: 0, usedWorker: true },
      });

      void createOnboardingCredential(identifier, (progress) => {
        if (progress.fraction >= 1) {
          derivationDone = true;
          setPhase({ kind: 'sending' });
          return;
        }
        if (!derivationDone) setPhase({ kind: 'deriving', progress });
      })
        .then(async (credential) => {
          const result = await platform.onboardOrganization({
            admin_identifier: credential.identifier,
            template_id: templateId,
            derived_value: credential.derivedValue,
            /*
             * OMITTED, NOT EMPTY, WHEN THERE IS NO NAME. "Absent" and "present
             * and empty" are different requests and `minLength: 1` accepts only
             * one of them, so a blank optional field would become a validation
             * error. Omitted means NULL, which means no name was recorded —
             * nothing here substitutes the identifier, the Template name or the
             * Workspace placeholder for a name the operator did not give.
             */
            ...(displayName === '' ? {} : { display_name: displayName }),
          });
          /*
           * THE CREDENTIAL IS PUT ON SCREEN ONLY HERE — after a 201. Everything
           * before this point can still fail, and a password shown beside a
           * failed create is worse than no password at all.
           */
          setOutcome({
            result,
            identifier: credential.identifier,
            password: credential.password,
            templateName: chosen?.name ?? templateId,
          });
          setPhase({ kind: 'idle' });
          setIdentifier('');
          setDisplayName('');
          setTemplateId('');
          onOnboarded();
        })
        .catch((thrown: unknown) => {
          setPhase({ kind: 'idle' });
          setFailure(toApiError(thrown));
        });
    },
    [busy, displayName, identifier, onOnboarded, platform, templateId, templates],
  );

  if (outcome !== null) {
    return (
      <CredentialPanel
        outcome={outcome}
        onDismiss={() => {
          setOutcome(null);
        }}
      />
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-ink">Onboard a business</h2>
        <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
          Creates the Organization, its first administrator, and that
          administrator&rsquo;s password. The password is generated here and shown once.
        </p>
      </div>

      {failure ? <OnboardingFailure failure={failure} /> : null}

      <Field
        id="admin-identifier"
        label="First administrator's email address"
        error={localError}
        hint="They will sign in with this. Plain ASCII only; spaces are refused rather than trimmed."
      >
        {(aria) => (
          <Input
            {...aria}
            type="email"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              if (localError) setLocalError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            disabled={busy}
            required
          />
        )}
      </Field>

      {/*
        OPTIONAL, AND LABELLED AS OPTIONAL. `0031` makes it optional on the write
        path so the console can ship ahead of Core tightening it, and a form that
        required it would make an outage of the field's whole purpose. Blank is a
        legitimate answer meaning "no name recorded" — not an error, and not a
        placeholder this console invents.

        THE CR AND THE VAT REGISTRATION ARE NOT HERE, and that is the contract
        rather than a choice: `onboardOrganizationInput` is
        `additionalProperties: false` over five fields and has no room for
        either. The hint points at the page that does, which the success panel
        also links to.
      */}
      <Field
        id="organization-display-name"
        label="Business name — optional"
        error={nameError}
        hint={`What operators will see instead of the identifier. Leave it blank if you do not have it yet — it, the CR and the VAT registration are all recorded on the business's own page. At most ${String(MAX_DISPLAY_NAME_LENGTH)} characters, and names are not unique in Dudo.`}
      >
        {(aria) => (
          <Input
            {...aria}
            type="text"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (nameError !== null) setNameError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
          />
        )}
      </Field>

      <Field
        id="template-id"
        label="Business type"
        hint="Supplies the words this business sees for each level. It cannot be changed afterwards."
      >
        {(aria) => (
          <select
            {...aria}
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              if (localError) setLocalError(null);
            }}
            disabled={busy || templates === null || templates.length === 0}
            required
            className={cn(
              'w-full min-h-10 px-3 py-2 rounded-[7px] bg-surface text-ink',
              'border border-line-strong transition-colors hover:border-ink-faint',
              'aria-invalid:border-scarlet-600',
            )}
          >
            <option value="">
              {templates === null
                ? 'Loading business types…'
                : templates.length === 0
                  ? 'No business types exist yet'
                  : 'Choose a business type'}
            </option>
            {(templates ?? []).map((template) => (
              <option key={template.template_id} value={template.template_id}>
                {template.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      {templatesError ? (
        <p role="alert" className="text-[0.875rem] text-scarlet-700">
          The business types could not be loaded, so none can be chosen. Reload the page to try
          again.
        </p>
      ) : null}

      {templates !== null && templates.length === 0 ? (
        <p className="rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.875rem] leading-relaxed text-ink">
          A business cannot be onboarded until at least one business type exists. Create one under
          Templates first.
        </p>
      ) : null}

      {/*
        THE WORKSPACE NAME IS NOT ASKED FOR, AND THE ABSENCE IS EXPLAINED WHERE
        AN OPERATOR WOULD LOOK FOR THE FIELD — not in a footnote, and not left to
        be noticed.
      */}
      <p className="rounded-[7px] border border-line bg-sunk/60 p-3 text-[0.8125rem] leading-relaxed text-ink-soft">
        <span className="font-semibold">The first workspace is created and is not named.</span>{' '}
        Dudo has nowhere to store a workspace name yet, so this form does not ask for one rather
        than accepting a name it would discard. Naming arrives with the organization-structure
        work.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || templates === null || templates.length === 0}
          busy={busy}
        >
          {phase.kind === 'deriving'
            ? 'Preparing the credential…'
            : phase.kind === 'sending'
              ? 'Creating…'
              : 'Onboard business'}
        </Button>
        <p className="text-[0.8125rem] text-ink-muted">
          The password is shown once and cannot be recovered.
        </p>
      </div>

      {phase.kind === 'deriving' ? <DerivationBar progress={phase.progress} /> : null}
      {phase.kind === 'sending' ? <LoadingBlock label="Creating the business in Core…" /> : null}
    </form>
  );
}

function OnboardingFailure({ failure }: { failure: ApiError }) {
  return (
    <div
      role="alert"
      className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
    >
      <p className="font-bold text-scarlet-700">
        {failure.code === 'conflict'
          ? 'That email address is already in use'
          : failure.code === 'not_found'
            ? 'That business type no longer exists'
            : failure.code === 'quota_exceeded'
              ? 'The platform write limit has been reached'
              : 'The business was not created'}
      </p>
      <p className="mt-1 leading-relaxed text-ink-soft">
        {failure.code === 'conflict' ? (
          <>
            One email address belongs to one person across the whole platform, and this one already
            has an account. <span className="font-semibold">Nothing was created.</span> Use a
            different address.
          </>
        ) : failure.code === 'not_found' ? (
          <>
            It may have been removed since this page loaded.{' '}
            <span className="font-semibold">Nothing was created.</span> Reload and choose again.
          </>
        ) : failure.code === 'quota_exceeded' ? (
          <>
            Core deferred the write rather than performing it.{' '}
            <span className="font-semibold">Nothing was created</span> — there is no half-made
            business to clean up. Try again later.
          </>
        ) : (
          <>
            {failure.message}{' '}
            <span className="font-semibold">
              Check the Organizations list before retrying — if the business was created, retrying
              will fail on the email address and the first password will be lost.
            </span>
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
 * The credential, shown once.
 *
 * DISMISSAL IS TWO STEPS ON PURPOSE. A single "Done" button beside the only copy
 * of a credential is a mis-click away from destroying it, and there is no undo
 * and no way to recover the value afterwards.
 */
function CredentialPanel({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const warnings = outcome.result.warnings;

  return (
    <section
      aria-labelledby="credential-heading"
      className="rounded-[12px] border-2 border-green-500 bg-surface p-5 sm:p-6"
    >
      <h2 id="credential-heading" className="text-lg font-bold text-green-700">
        {outcome.templateName} business created
      </h2>

      {warnings.length > 0 ? <WarningPanel warnings={warnings} /> : null}

      <p className="mt-4 leading-relaxed text-ink">
        <span className="font-bold">Record this password now.</span> It exists only on this screen.
        Dudo did not receive it and cannot show it again — if it is lost, the only way back in is
        for an operator to reset the credential.
      </p>

      <dl className="mt-4 grid gap-3">
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Sign in with
          </dt>
          <dd className="mt-1 font-mono text-[0.9375rem] break-all text-ink">
            {outcome.identifier}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Password
          </dt>
          {/*
            `select-all` so one click selects the whole value — a 32-character
            base64url string is easy to truncate by hand, and a truncated
            password is indistinguishable from a wrong one at the login screen.
            No "copy" button: the clipboard is a second copy this console cannot
            supervise, and writing one is a decision for whoever needs it.
          */}
          <dd className="mt-1 rounded-[7px] border border-line-strong bg-sunk px-3 py-2 font-mono text-[0.9375rem] break-all select-all text-ink">
            {outcome.password}
          </dd>
        </div>
      </dl>

      <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[0.8125rem] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-semibold text-ink-soft">Organization</dt>
          <dd className="font-mono break-all text-ink-muted">{outcome.result.organization_id}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-ink-soft">Administrator</dt>
          <dd className="font-mono break-all text-ink-muted">
            {outcome.result.admin_principal_id}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-ink-soft">Workspace</dt>
          <dd className="font-mono break-all text-ink-muted">
            {outcome.result.workspace_id ?? 'not created — see the warning above'}
          </dd>
        </div>
      </dl>

      {/*
        `0026`'s accepted cost, said plainly rather than left for an operator to
        discover. There is no self-service password change, so this is not a
        temporary password in the usual sense.
      */}
      <p className="mt-5 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink">
        <span className="font-semibold">You will know this password until it is reset.</span> Dudo
        has no self-service password change yet, so the administrator cannot replace it themselves
        — an operator must reset the credential. Send it over a channel you would trust with a
        password, and treat it as shared until then.
      </p>

      {/*
        WHERE THE REST OF THE RECORD GOES. Onboarding cannot accept a CR or a
        VAT registration — the contract has no field for either and every
        Organization starts `not_recorded` — so the next step is named here
        rather than left to be discovered. THIS IS A LINK AND NOT A REDIRECT:
        the password is on this screen and navigating away from it destroys the
        only copy in existence.
      */}
      <p className="mt-5 rounded-[7px] border border-line bg-sunk/60 p-3 text-[0.8125rem] leading-relaxed text-ink-soft">
        <span className="font-semibold">Record the password before you follow this.</span> The
        business has no name, no CR and no VAT registration recorded yet — nobody has asked, which
        is a different fact from having none.{' '}
        <a
          href={buildHash(organizationDetailPath(outcome.result.organization_id))}
          className="font-semibold text-navy-600 no-underline hover:underline"
        >
          Open this business to record them
        </a>
        . Leaving this screen loses the password.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <p className="w-full font-semibold text-ink">
              Have you recorded the password? It cannot be shown again.
            </p>
            <Button variant="primary" onClick={onDismiss}>
              Yes, I have recorded it
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Not yet
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            I have recorded the password
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * A non-empty `warnings` array. Prominent, and NOT an error.
 *
 * The schema requires a console to render this prominently and says that
 * treating it as an ordinary success is the defect the field exists to prevent.
 * It is equally wrong to render it as a failure: the Organization, the admin and
 * the credential all exist.
 */
function WarningPanel({ warnings }: { warnings: readonly string[] }) {
  return (
    <div
      role="status"
      className="mt-4 rounded-[7px] border border-gold-500 bg-gold-50 p-4 text-[0.875rem] leading-relaxed text-ink"
    >
      <p className="font-bold">The business was created, and part of the setup did not finish.</p>
      <ul className="mt-2 grid list-disc gap-2 ps-4">
        {warnings.map((warning) => (
          <li key={warning}>
            {!isKnownOnboardingWarning(warning) ? (
              /*
               * Checked FIRST, so the two known branches below cannot be reached
               * by a token that merely resembles one. `onboardingWarning` is a
               * closed set of two; anything else means Core reports something
               * newer than this build.
               *
               * SHOWN VERBATIM RATHER THAN HIDDEN. An unrecognised warning is
               * still a warning, and dropping it would be worse than failing to
               * explain it — the operator would read a partially-completed
               * onboarding as a clean one.
               */
              <>
                <span className="font-semibold">An unrecognised warning was returned:</span>{' '}
                <code className="font-mono">{warning}</code>. This console does not know what it
                means, which means Core reports something newer than this build. Report it.
              </>
            ) : warning === 'first_workspace_not_created' ? (
              <>
                <span className="font-semibold">The first workspace was not created.</span> The
                business exists and can be signed into, but it has no workspace, and the customer
                cannot use the product until one exists. There is no route to create one yet —
                report this.
              </>
            ) : (
              <>
                <span className="font-semibold">
                  The customer&rsquo;s own audit record was not written.
                </span>{' '}
                The platform recorded this action, but the business&rsquo;s own log did not — so
                the customer has no record that their business was created. Report this.
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DerivationBar({ progress }: { progress: DerivationProgress }) {
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
        aria-label="Preparing the credential"
        className="h-1.5 w-full overflow-hidden rounded-full bg-sunk"
      >
        <div
          className="h-full rounded-full bg-navy-600 transition-[width] duration-150 ease-linear"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p aria-live="polite" className="text-[0.8125rem] text-ink-muted">
        {remainingMs === null
          ? 'Measuring how long this will take on this device…'
          : `About ${String(Math.ceil(remainingMs / 1000))} seconds left — an estimate measured on this device.`}
      </p>
    </div>
  );
}
