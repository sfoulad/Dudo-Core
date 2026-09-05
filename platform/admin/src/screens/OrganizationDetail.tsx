/**
 * One Organization: what the platform knows that is not tenant data, plus a
 * single-shot member lookup.
 *
 * ===========================================================================
 * THE COLLAPSED REFUSAL. THIS IS THE MOST IMPORTANT THING ON THE PAGE.
 * ===========================================================================
 *
 * `platform.organizations.members.resolve` returns ONE argument-free 404 for
 * FIVE distinct conditions:
 *
 *   1. an unknown Organization
 *   2. an identifier belonging to nobody
 *   3. an identifier belonging to someone who is not a member of THIS
 *      Organization
 *   4. a suspended membership
 *   5. the principal is a platform operator
 *
 * The contract: "Five cases, one answer, no distinguishing field, message,
 * detail token or response size... THE SAME WORK MUST HAPPEN ON ALL FIVE PATHS,
 * not merely the same code." The fifth is the one that matters most — without
 * it, this route is an oracle for WHICH PRINCIPALS ARE PLATFORM OPERATORS.
 *
 * CORE ENFORCES THAT PROPERTY AND THIS FILE CAN DESTROY IT. Everything below is
 * written so it cannot:
 *
 *   - ONE REFUSAL STRING. `REFUSAL` is a module constant, used once, with no
 *     interpolation, no branch, and no access to the error. There is no code
 *     path in which two different refusal texts can be produced.
 *   - ONE CODE PATH AND ONE VISUAL STATE. A refusal renders the same element,
 *     in the same place, with the same styling, whatever produced it.
 *   - `details` IS NEVER RENDERED ON THIS PATH. `invalid_argument` elsewhere in
 *     this console lists field issues; doing that here would surface exactly the
 *     distinguishing token the contract forbids.
 *   - NO LOGGING, ANYWHERE. Not on success, not on refusal. A `console.log` that
 *     fired on one branch and not the other would rebuild the oracle in the one
 *     place an attacker with the operator's machine would look first.
 *   - ONE REQUEST EITHER WAY. A hit and a miss make the same single call, so
 *     they take the same round trip. Nothing is cached, memoised or short-
 *     circuited on a value that could differ between the five cases.
 *
 * THE ONE THING THAT IS DECIDED LOCALLY, STATED PLAINLY: a malformed identifier
 * is refused before submitting, by the same check the sign-in screen uses. That
 * distinguishes WELL-FORMED from MALFORMED — a fact about what the operator just
 * typed, which they already hold — and it cannot separate any two of the five
 * cases, because all five require a well-formed identifier to reach Core at all.
 * It also avoids spending a tenant audit record on a typo. It is called out here
 * rather than left to be discovered, because it is the only place this screen
 * answers without asking.
 *
 * ===========================================================================
 * `forbidden` IS NOT THE REFUSAL, AND MERGING THEM WOULD MISLEAD
 * ===========================================================================
 *
 * The resolve declares `core.credential.reset`, not `core.organization.list` —
 * "a principal who may not reset a credential may not resolve a principal", so
 * revoking the reset grant revokes this too. A `403` therefore means THE
 * OPERATOR MAY NOT USE THIS LOOKUP AT ALL. Rendering it as the collapsed refusal
 * would tell them the lookup found nothing and invite them to probe again with
 * a different identifier, forever, each attempt writing an audit record into a
 * customer's log.
 *
 * ===========================================================================
 * THERE IS NO MEMBER LIST, AND IT IS NOT MISSING
 * ===========================================================================
 *
 * No route anywhere returns member identities. `member_count` is a count method
 * on the port and that is the whole of it. "A count does not invert, so it
 * reconstructs nothing about any principal, while a list over every Organization
 * reconstructs every principal's Organization list" — which `core-object-registry.yaml`
 * CO1 forbids by name, and an operator can enumerate every Organization.
 *
 * SO: NO ROSTER, NO "VIEW ALL MEMBERS", NO PAGINATION TOWARD ONE, and no empty
 * table waiting to be filled in. The count renders as a count. If this page
 * looks like it is missing a list, that is the correct appearance.
 *
 * ===========================================================================
 * ONE REQUEST RENDERS THIS PAGE, AND IT IS NEVER POLLED
 * ===========================================================================
 *
 * The Template is embedded, so there is no second call. A read costs writes in
 * this class: at 2 row-writes per call a thirty-second refresh loop exhausts an
 * operator's daily ceiling in about two and a half hours and then answers 503.
 * No interval, no refetch on focus, no refetch on reconnect.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { ResetCredential } from '@/screens/ResetCredential';
import { cn } from '@/lib/cn';
import { buildHash, organizationAuditPath, ROUTES } from '@/lib/router';
import { identifierRefusal } from '@/api/kdf';
import {
  TEMPLATE_LEVELS,
  isKnownMembershipRole,
  isKnownStatus,
  type OrganizationDetail as Detail,
  type PlatformClient,
  type ResolveMemberOutput,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

/**
 * THE ONE REFUSAL STRING. A module constant with no parameters.
 *
 * It is deliberately unhelpful about WHY, and it says so to the operator rather
 * than pretending to be complete — an operator who believes the console is being
 * evasive will probe; one who is told the answer is uniform by design will stop.
 *
 * IT MUST NOT GAIN A BRANCH, AN INTERPOLATION OR A SECOND VARIANT. Any wording
 * that varied with the cause would rebuild the oracle Core removed.
 */
const REFUSAL =
  'No member of this Organization matches that identifier. Dudo answers this the same way ' +
  'whether the person does not exist, belongs to a different Organization, or is not a member ' +
  'here — deliberately, so that this lookup cannot be used to discover who belongs where. ' +
  'Check the identifier with the customer.';

/**
 * ===========================================================================
 * THE NON-ASCII CASE, RE-WORDED FOR THIS SCREEN — AND KEPT VISIBLY SEPARATE
 * FROM THE SERVER REFUSAL ON PURPOSE.
 * ===========================================================================
 *
 * `identifierRefusal` lives in `api/kdf.ts`, is shared with the sign-in and
 * onboarding screens, and is BYTE-COMPARED against `platform/web` — so it is not
 * editable here even if it were the right place. Its non-ASCII sentence is
 * phrased in terms of signing the reader in, which is correct where somebody is
 * signing in and WRONG HERE: nobody is being signed in, and an operator reading
 * it about a customer's address would reasonably take it as a statement about
 * that person's account.
 *
 * THE SENTENCE IS NOT QUOTED ANYWHERE IN THIS FILE, deliberately. A verbatim
 * copy would be a second place the wording lives, going stale the moment
 * `platform/web` rewords it — and `verify-platform.mjs` asserts that no such
 * literal appears here, precisely so the substitution below stays derived.
 *
 * ---------------------------------------------------------------------------
 * THE ASCII RESTRICTION IS THE CONTRACT'S, NOT THIS CONSOLE'S
 * ---------------------------------------------------------------------------
 *
 * CORRECTED 2026-09-05, AND THE EARLIER FRAMING HERE WAS BACKWARDS. This comment
 * previously said Core's accepted identifier set was "strictly larger than the
 * set this console can submit", and treated the difference as an open question
 * routed to architecture. **The ruling inverted it.**
 *
 * DUDO HAS NEVER ACCEPTED NON-ASCII IDENTIFIERS. `0015` §D says so, `login-v1`
 * says so, and both platform schemas carry the machine-readable pattern
 * `^[\x21-\x7E]*@[\x21-\x7E]*$` — printable ASCII, no whitespace, nothing above
 * U+007E. `organization-detail-v1`, the contract this screen is built against,
 * states it in prose beside that pattern.
 *
 * SO THIS IS NOT A CLIENT-SIDE NARROWING. This console is one of the few
 * components ENFORCING a restriction the contract set has stated all along, and
 * which two Core call sites do not yet apply. The gap is in Core and is being
 * closed there.
 *
 * **DO NOT REMOVE THIS CHECK, AND DO NOT WIDEN IT IF CORE IS EVER OBSERVED
 * ACCEPTING SOMETHING IT REFUSES.** A client that submits what the contract
 * forbids is broken whether or not the server happens to catch it, and a console
 * that submits what it cannot round-trip through the KDF is worse than one that
 * refuses early.
 *
 * ---------------------------------------------------------------------------
 * WHY IT STILL MUST NOT LOOK LIKE THE COLLAPSED REFUSAL
 * ---------------------------------------------------------------------------
 *
 * THE REASON SURVIVES THE CORRECTION UNCHANGED, which is worth saying because
 * the framing above moved and this did not. Whatever the restriction's
 * provenance, a refusal produced HERE is a statement about what this screen
 * could send; a refusal produced by CORE is the collapsed five-case answer. To
 * an operator those are indistinguishable unless the console makes them
 * different — and reading "no match" when the truth is "this address was never
 * sent" would send them to tell a customer something false.
 *
 * Same-looking is correct for the five server cases and WRONG here. So local
 * refusals render in the FIELD — scarlet, with an error icon, attached to the
 * input, above the button — and the server refusal renders in a neutral block
 * BELOW the button. Different colour, position, element and wording.
 * `verify-platform.mjs` asserts they are different strings, that this one names
 * the console as the limitation, and that a local refusal never sets the
 * server-refusal state.
 */
const NON_ASCII_LOOKUP_REFUSAL =
  'This console can only look up plain ASCII email addresses at the moment, so it cannot send ' +
  'this one. That is a limit of this screen — it says nothing about whether that person exists ' +
  'or belongs to this Organization. Nothing was looked up.';

/**
 * The sentinel, DERIVED FROM THE REAL FUNCTION rather than copied as a literal.
 *
 * Calling `identifierRefusal` with a known non-ASCII address yields whatever
 * sentence that function currently returns for this case, so if `platform/web`
 * rewords it, this substitution keeps working with no edit here and no silent
 * failure. A hard-coded string would go stale and quietly restore the wrong copy.
 *
 * The address is built with `String.fromCharCode` so this line is pure ASCII in
 * source — a literal non-ASCII character is exactly the thing an editor, a
 * formatter or an authoring tool can normalise away, and this project has been
 * bitten by that once already.
 */
const NON_ASCII_SENTINEL = identifierRefusal(
  `${String.fromCharCode(0x00e9)}@example.com`,
);

/**
 * Local shape validation for this screen.
 *
 * It delegates to the shared check — the one the sign-in and onboarding screens
 * use, so there is one definition of a submittable identifier — and re-words
 * only the one message that is about signing in.
 */
function lookupIdentifierRefusal(value: string): string | null {
  const refusal = identifierRefusal(value);
  if (refusal !== null && refusal === NON_ASCII_SENTINEL) {
    return NON_ASCII_LOOKUP_REFUSAL;
  }
  return refusal;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly detail: Detail }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** The lookup's outcome. `refused` carries nothing — by construction. */
type Lookup =
  | { readonly kind: 'idle' }
  | { readonly kind: 'looking' }
  /**
   * `submittedIdentifier` is the value that was actually SENT, captured at
   * submit time — not the current field contents, which the operator may edit
   * afterwards. It is the KDF salt for a subsequent reset, so reading it from
   * live input would salt the new credential with an address that was never
   * resolved.
   */
  | {
      readonly kind: 'found';
      readonly member: ResolveMemberOutput;
      readonly submittedIdentifier: string;
    }
  | { readonly kind: 'refused' }
  | { readonly kind: 'forbidden'; readonly error: ApiError }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function OrganizationDetail({
  platform,
  organizationId,
}: {
  platform: PlatformClient;
  organizationId: string;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform.readOrganization(organizationId).then(
      (detail) => {
        if (!cancelled) setLoad({ kind: 'loaded', detail });
      },
      (thrown: unknown) => {
        if (!cancelled) setLoad({ kind: 'failed', error: toApiError(thrown) });
      },
    );
    return () => {
      cancelled = true;
    };
    // `nonce` only ever changes when a person presses Try again. There is no
    // interval and no focus listener here, and adding one would be a budget
    // defect rather than a refresh.
  }, [platform, organizationId, nonce]);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-3xl">
      <a
        href={buildHash(ROUTES.organizations)}
        className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
      >
        &larr; All Organizations
      </a>

      <h1
        id="section-heading"
        className="mt-3 font-mono text-lg font-bold break-all text-ink sm:text-xl"
      >
        {/*
          VERBATIM WHEN `display_name` IS NULL, which is always today. The
          contract binds every client: "A client renders organization_id verbatim
          when this is null and MUST NOT substitute a placeholder of its own, or
          two consoles will invent two different ones."
        */}
        {load.kind === 'loaded'
          ? (load.detail.display_name ?? load.detail.organization_id)
          : organizationId}
      </h1>

      {load.kind === 'loading' ? (
        <div className="mt-5">
          <LoadingBlock label="Asking Core about this Organization…" />
        </div>
      ) : null}

      {load.kind === 'failed' ? (
        <div className="mt-5">
          <ErrorBlock
            error={load.error}
            onRetry={() => {
              setNonce((value) => value + 1);
            }}
          >
            {load.error.code === 'not_found' ? (
              <p className="mt-2 leading-relaxed text-ink-soft">
                No Organization has this identifier. It may have been mistyped, or the address may
                be stale.
              </p>
            ) : null}
          </ErrorBlock>
        </div>
      ) : null}

      {load.kind === 'loaded' ? (
        <>
          <DetailCard detail={load.detail} />
          <MemberLookup platform={platform} organizationId={load.detail.organization_id} />
        </>
      ) : null}
    </section>
  );
}

function DetailCard({ detail }: { detail: Detail }) {
  return (
    <div className="mt-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Identifier
          </dt>
          <dd className="mt-1 font-mono text-[0.875rem] break-all text-ink">
            {detail.organization_id}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Status
          </dt>
          <dd className="mt-1">
            <StatusBadge status={detail.status} />
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Created
          </dt>
          <dd className="mt-1 text-[0.875rem] text-ink">
            <CreatedAt value={detail.created_at} />
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            Members
          </dt>
          {/*
            A COUNT, RENDERED AS A COUNT. There is no link, no expander and no
            hover affordance here, because there is nothing to expand to — no
            route in Dudo returns member identities. The note below says so, so
            the absence reads as designed rather than unfinished.
          */}
          <dd className="mt-1 text-[0.875rem] text-ink">
            <span className="text-lg font-bold tabular-nums">{detail.member_count}</span>{' '}
            {detail.member_count === 1 ? 'principal' : 'principals'}
          </dd>
        </div>
      </dl>

      <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">There is no member list, by design.</span>{' '}
        The platform can count an Organization&rsquo;s members but cannot name them. A count says
        whether onboarding worked and whether a business is in use; a list, across every
        Organization an operator can already enumerate, would reconstruct every person&rsquo;s
        Organization membership. Use the lookup below when a customer gives you an identifier.
      </p>

      <TemplateBlock template={detail.template} />

      {/*
        A LINK, NOT AN EMBEDDED FEED. Reading that trail costs the customer five
        tenant row-writes per page, so it must not load because someone opened
        this page — and the destination itself does not load on arrival either.
        The cost is named here so the operator knows before they click.
      */}
      <div className="mt-5 border-t border-line pt-4">
        <a
          href={buildHash(organizationAuditPath(detail.organization_id))}
          className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
        >
          What has the platform done to this business? &rarr;
        </a>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Their own audit trail, including which person each action named. Reading it writes to it,
          against this business&rsquo;s daily allowance — so it opens without loading anything.
        </p>
      </div>
    </div>
  );
}

function TemplateBlock({ template }: { template: Detail['template'] }) {
  if (template === null) {
    return (
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
          Business type
        </p>
        <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-muted">
          None recorded. This Organization was created before it could adopt one, so it uses
          Dudo&rsquo;s default words for every level.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
        Business type
      </p>
      <p className="mt-1 font-semibold break-words text-ink">{template.name}</p>
      <p className="font-mono text-xs break-all text-ink-muted">{template.template_id}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[0.875rem] sm:grid-cols-3">
        {TEMPLATE_LEVELS.map((level) => (
          <div key={level} className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              {level === 'organization' ? 'Organization' : level === 'workspace' ? 'Workspace' : 'Branch'}
            </dt>
            <dd className="break-words text-ink">{template.level_labels[level]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[0.8125rem] text-ink-muted">
        These are the words this business sees in place of Dudo&rsquo;s own.
      </p>
    </div>
  );
}

/**
 * The single-shot member lookup.
 *
 * IT FIRES ON SUBMIT AND AT NO OTHER TIME. Every call writes a tenant-side audit
 * record into this customer's own log — including refusals — so there is no
 * lookup-as-you-type, no debounce, no prefetch, no retry-on-blur and no
 * automatic retry. An operator who wants to try again presses the button again,
 * and the customer sees each attempt.
 */
function MemberLookup({
  platform,
  organizationId,
}: {
  platform: PlatformClient;
  organizationId: string;
}) {
  const [identifier, setIdentifier] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (lookup.kind === 'looking') return;

      /*
       * THE ONLY LOCAL DECISION, AND IT CANNOT SEPARATE THE FIVE CASES. It
       * distinguishes well-formed from malformed — which the operator already
       * knows, having just typed it — and every one of the five collapsed cases
       * requires a well-formed identifier to reach Core at all. It also spares a
       * customer's audit log a record for a typo.
       */
      const refusal = lookupIdentifierRefusal(identifier);
      if (refusal !== null) {
        setLocalError(refusal);
        setLookup({ kind: 'idle' });
        return;
      }
      setLocalError(null);
      setLookup({ kind: 'looking' });

      void platform.resolveMember(organizationId, identifier).then(
        (member) => {
          setLookup({ kind: 'found', member, submittedIdentifier: identifier });
        },
        (thrown: unknown) => {
          const error = toApiError(thrown);
          /*
           * THE WHOLE COLLAPSE, IN ONE BRANCH. Every 404 lands here and produces
           * `{ kind: 'refused' }`, which carries NO payload — not the error, not
           * the request id, not the details. There is nothing downstream that
           * could branch on the cause because nothing downstream has it.
           */
          if (error.code === 'not_found') {
            setLookup({ kind: 'refused' });
            return;
          }
          /*
           * `forbidden` IS A DIFFERENT FACT. The resolve declares
           * `core.credential.reset`; a revoked grant means this lookup is closed
           * to this operator entirely. Rendering it as the refusal would invite
           * endless re-probing of a door that is shut.
           */
          if (error.code === 'forbidden') {
            setLookup({ kind: 'forbidden', error });
            return;
          }
          setLookup({ kind: 'failed', error });
        },
      );
    },
    [identifier, lookup.kind, organizationId, platform],
  );

  const busy = lookup.kind === 'looking';

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-6 grid gap-4 rounded-[12px] border border-line bg-surface p-5 sm:p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-ink">Look up a member</h2>
        <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
          For an identifier a customer has given you. It returns that
          person&rsquo;s principal id and role, which is what a credential reset needs.{' '}
          {/*
            "RECORDED IN", NOT "VISIBLE TO", AND THE DISTINCTION IS LOAD-BEARING.
            `0028`'s amendment of 2026-09-05 strikes "tenant-visible" from its own
            residual: `core.audit.read` is catalogued at organization scope and
            HAS NO ROUTE, so tenant-side records are written and unreadable
            today. "This business can see every lookup" was the wording here and
            it was false — the amendment warns precisely against citing 0028 for
            "a control that has never worked".

            The record IS permanent and becomes readable when the tenant-side
            audit route lands, so this sentence is true now and stays true then.
          */}
          <span className="font-semibold text-ink-soft">
            Every lookup is recorded in this business&rsquo;s own audit trail, including ones that
            find nothing.
          </span>
        </p>
      </div>

      <Field
        id="member-identifier"
        label="Email address"
        error={localError}
        hint="Plain ASCII only. Spaces are refused rather than trimmed."
      >
        {(aria) => (
          <Input
            {...aria}
            type="email"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              if (localError !== null) setLocalError(null);
              /*
               * Typing clears a previous answer rather than leaving it beside a
               * new identifier — a stale "found" under a changed field is a
               * misreading waiting to happen. It starts no request.
               */
              if (lookup.kind !== 'idle' && lookup.kind !== 'looking') {
                setLookup({ kind: 'idle' });
              }
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

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={busy} busy={busy}>
          {busy ? 'Looking up…' : 'Look up'}
        </Button>
        <p className="text-[0.8125rem] text-ink-muted">One lookup per press.</p>
      </div>

      <LookupResult lookup={lookup} platform={platform} />
    </form>
  );
}

/**
 * The answer.
 *
 * `refused` RENDERS ONE CONSTANT AND HAS NOTHING ELSE TO RENDER — it carries no
 * error object, so there is no request id, no message and no `details` list that
 * could differ between the five cases. That is enforced by the type, not by
 * remembering.
 */
function LookupResult({ lookup, platform }: { lookup: Lookup; platform: PlatformClient }) {
  if (lookup.kind === 'idle' || lookup.kind === 'looking') return null;

  if (lookup.kind === 'found') {
    return (
      <div
        role="status"
        className="rounded-[7px] border border-green-500 bg-green-50 p-4 text-[0.875rem]"
      >
        <p className="font-bold text-green-700">That person is a member of this Organization.</p>
        <dl className="mt-3 grid gap-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              Principal id
            </dt>
            <dd className="font-mono break-all select-all text-ink">
              {lookup.member.principal_id}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              Role
            </dt>
            <dd className="text-ink">
              {lookup.member.role}
              {!isKnownMembershipRole(lookup.member.role) ? (
                <span className="sr-only"> (an unrecognised role)</span>
              ) : null}
              {lookup.member.role === 'owner' ? (
                <span className="ms-2 text-ink-muted">
                  — resetting this credential takes over an owner.
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        {/*
          THE RESET IS OFFERED HERE AND NOWHERE ELSE, because this is the only
          place both required values exist: `principal_id` from the resolve, and
          `target_identifier` — the address the operator typed into it, which is
          the KDF salt for the new credential.

          There is no route that finds a principal by email, so a reset cannot
          be started from anywhere else. Offering it somewhere it could not be
          completed would be an affordance that fails on press.
        */}
        <ResetCredential
          platform={platform}
          principalId={lookup.member.principal_id}
          targetIdentifier={lookup.submittedIdentifier}
        />
      </div>
    );
  }

  if (lookup.kind === 'refused') {
    return (
      <div
        role="status"
        className="rounded-[7px] border border-line-strong bg-sunk p-4 text-[0.875rem] leading-relaxed text-ink-soft"
      >
        {REFUSAL}
      </div>
    );
  }

  if (lookup.kind === 'forbidden') {
    return (
      <div
        role="alert"
        className="rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-4 text-[0.875rem]"
      >
        <p className="font-bold text-scarlet-700">You may not use this lookup</p>
        <p className="mt-1 leading-relaxed text-ink-soft">
          Core refused the call itself, which is not the same as finding nothing. This lookup
          requires the credential-reset permission — without it, resolving people is closed to you.
          Nothing was looked up. Raise it with the Team Lead rather than retrying.
        </p>
        {lookup.error.request_id ? (
          <p className="mt-2 font-mono text-xs break-all text-ink-muted">
            Reference {lookup.error.request_id}
          </p>
        ) : null}
      </div>
    );
  }

  /*
   * Everything that is neither a hit, the collapsed refusal, nor a `403`:
   * unreachable, rate limited, a 5xx, an unreadable shape. Ordinary error
   * handling, with a retry only where retrying could plausibly help — and no
   * automatic retry, because each attempt writes into the customer's audit log.
   */
  return <ErrorBlock error={lookup.error} />;
}

function StatusBadge({ status }: { status: string }) {
  const known = isKnownStatus(status);
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        status === 'active' && 'bg-green-50 text-green-700',
        status === 'suspended' && 'bg-gold-50 text-gold-700',
        !known && 'bg-sunk text-ink-muted',
      )}
    >
      {status}
      {!known ? <span className="sr-only"> (an unrecognised status)</span> : null}
    </span>
  );
}

function CreatedAt({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono text-xs">{value}</span>;
  }
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
