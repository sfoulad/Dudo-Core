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
 *
 * AND SAVING THE IDENTITY DOES NOT RE-READ. The update route returns the whole
 * identity block after the change — "a console applying a partial response to
 * local state has to guess what the server did with the fields it omitted; a
 * whole block cannot be guessed wrong" — so the saved value is merged into the
 * loaded detail rather than fetched again. A re-read would double the cost of
 * every edit for information already in hand.
 */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@dudo/ui';
import { AdminField as Field } from '@/components/AdminField';
import { ErrorBlock, LoadingBlock, PermissionDeniedBlock } from '@/components/StateBlock';
import { OrganizationIdentityPanel } from '@/components/OrganizationIdentity';
import { ResetCredential } from '@/screens/ResetCredential';
import { cn } from '@dudo/ui';
import { Link } from '@tanstack/react-router';
import { identifierRefusal } from '@dudo/client-kdf';
import {
  useOrganizationDetail,
  useMergeOrganizationIdentity,
  useTemplatePicker,
  useSetOrganizationTemplate,
} from '@/lib/queries';
import { useLocale, useT } from '@/lib/i18n';
import { platformClient } from '@/lib/clients';
import {
  TEMPLATE_LEVELS,
  isKnownMembershipRole,
  isKnownStatus,
  type OrganizationDetail as Detail,
  type Template,
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
 * `identifierRefusal` lives in `@dudo/client-kdf`, is shared with the sign-in and
 * onboarding screens, and is now THE SAME FUNCTION `platform/web` calls rather
 * than a byte-compared copy of it (ADR 0040) — so it is not
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

export function OrganizationDetail({ organizationId }: { organizationId: string }) {
  /*
   * THE DETAIL READ IS A QUERY, AND THE `nonce` IS GONE.
   *
   * It was `useEffect` + `let cancelled` + a nonce bumped only by Try again.
   * `Load` is derived, never stored, so the screen cannot hold a state the
   * query disagrees with.
   *
   * `isFetching` reproduces the previous behaviour exactly — the effect set
   * `{ kind: 'loading' }` at the top of every run, which is what made Try again
   * visibly do something. `lib/queries.ts` records why that is safe on this
   * console: nothing here fetches unless an operator caused it. **There is still
   * no interval and no focus listener, and adding one would be a budget defect
   * rather than a refresh.**
   */
  const t = useT();
  const detailQuery = useOrganizationDetail(organizationId);
  const mergeIdentity = useMergeOrganizationIdentity();
  const load: Load =
    detailQuery.isPending || detailQuery.isFetching
      ? { kind: 'loading' }
      : detailQuery.error !== null
        ? { kind: 'failed', error: detailQuery.error }
        : { kind: 'loaded', detail: detailQuery.data };

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-3xl">
      <Link
        to="/organizations"
        className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
      >
        &larr; All Organizations
      </Link>

      {/*
        THE NAME IS THE HEADING WHEN THERE IS ONE, AND THE IDENTIFIER IS
        VERBATIM WHEN THERE IS NOT. The contract binds every client: "A client
        renders organization_id verbatim when this is null and MUST NOT
        substitute a placeholder of its own, or two consoles will invent two
        different ones." Null is no longer the only state — it is the state of
        businesses that predate the field.

        THE IDENTIFIER STAYS ON SCREEN EVEN WHEN A NAME EXISTS, and that is not
        redundancy: `display_name` IS NOT UNIQUE AND NOTHING IN DUDO ENFORCES
        UNIQUENESS ON IT — "two Organizations legitimately share a name in one
        market". A console that showed only the name would make two different
        businesses look like one, on the screen where an operator decides which
        customer they are acting on.
      */}
      {load.kind === 'loaded' && load.detail.display_name !== null ? (
        <>
          <h1 id="section-heading" className="mt-3 text-lg font-bold break-words text-ink sm:text-xl">
            {load.detail.display_name}
          </h1>
          <p className="mt-1 font-mono text-[0.8125rem] break-all select-all text-ink-muted">
            {load.detail.organization_id}
          </p>
        </>
      ) : (
        <h1
          id="section-heading"
          className="mt-3 font-mono text-lg font-bold break-all text-ink sm:text-xl"
        >
          {load.kind === 'loaded' ? load.detail.organization_id : organizationId}
        </h1>
      )}

      {load.kind === 'loading' ? (
        <div className="mt-5">
          <LoadingBlock label={t('detail.loading')} />
        </div>
      ) : null}

      {load.kind === 'failed' ? (
        <div className="mt-5">
          {/*
            ===================================================================
            THREE OUTCOMES, RENDERED AS THREE THINGS. `not_found` IS A STATE,
            NOT AN ERROR.
            ===================================================================

            `platform.organizations.read` declares `forbidden` AND `not_found`
            as separate errors, and its own `notFound` block settles what this
            console may say:

              "An unknown organization_id returns the argument-free 404. THERE
               IS NO ORACLE CONCERN HERE... every caller who can reach this
               route can already enumerate every Organization from
               platform.organizations.list, so a distinction discloses nothing
               to a population that could not obtain it one screen away."

            *** THAT REASONING IS SPECIFIC TO THIS ROUTE CLASS AND THE CONTRACT
            SAYS SO IN THE SAME BREATH: "must not be copied to a route reachable
            by a tenant principal." ***

            So this pattern is PLATFORM-CONSOLE-ONLY. A tenant-facing screen on
            `app.dudo.work` distinguishing "absent" from "not yours" IS an
            oracle — the exemption here rests entirely on the enumeration being
            one screen away FOR THE SAME CALLER. **Nothing below may become a
            shared not-found component across the two administrations**; that
            is `CLAUDE.md`'s structural split arriving as a component boundary.

            AND NOTE WHAT SITS SIXTEEN LINES BELOW IT IN THE SAME CONTRACT: the
            member resolve's `notFoundCOLLAPSE` — "five cases, one answer, no
            distinguishing field" — which is the OPPOSITE ruling for the
            OPPOSITE reason. One file, two routes, two answers. Anchor to the
            operation id, never to a line number (`architecture.md` §3c).
          */}
          {load.error.code === 'not_found' ? (
            <div
              role="status"
              className="rounded-[12px] border border-line-strong bg-sunk p-5 text-[0.9375rem] leading-relaxed text-ink sm:p-6"
            >
              <h2 className="text-base font-bold text-ink">{t('detail.notFound.title')}</h2>
              <p className="mt-2 text-ink-soft">
                {t('detail.notFound.before')}{' '}
                <bdi className="font-mono break-all text-ink">{organizationId}</bdi>{' '}
                {t('detail.notFound.after')}
              </p>
              {/*
                A WAY BACK, NOT A RETRY. Asking again spends another audited read
                — 2 row-writes — to receive the same answer, so no retry control
                is offered and `isRetryable` would refuse one anyway. The
                directory is where the operator can see what does exist.
              */}
              <Link
                to="/organizations"
                className="mt-4 inline-block text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
              >
                &larr; Back to all Organizations
              </Link>
            </div>
          ) : load.error.code === 'forbidden' ? (
            /*
              A DIFFERENT FACT, AND MERGING IT WITH THE ABOVE WOULD MISLEAD.
              `forbidden` means this operator may not read Organizations at all;
              `not_found` means this one is not there. An operator who was shown
              "does not exist" for a permission failure would go and tell a
              colleague their business had been deleted.
            */
            <div
              role="alert"
              className="rounded-[12px] border border-scarlet-600 bg-scarlet-50 p-5 sm:p-6"
            >
              <h2 className="text-base font-bold text-scarlet-700">
                {t('detail.forbidden.title')}
              </h2>
              {/*
                SAYS THE REFUSAL IS NOT AN ABSENCE, and that distinction is the
                whole reason this branch exists. **A translation that collapsed
                it into "not found" would tell an operator a customer does not
                exist when the truth is that they may not look** — a false
                statement about a business, produced by a shorter sentence.
              */}
              <p className="mt-2 leading-relaxed text-ink-soft">
                {t('detail.forbidden.body')}
              </p>
              {load.error.request_id ? (
                <p className="mt-3 text-xs text-ink-muted">
                  {t('denied.reference')}{' '}
                  <bdi className="font-mono break-all">{load.error.request_id}</bdi>
                </p>
              ) : null}
            </div>
          ) : (
            /*
              TRY AGAIN IS `refetch` — one call, the same cost as the nonce bump
              it replaces. `retry: false` in `lib/query-client.ts` is what keeps
              it one; the library default would spend four reads, at 2 row-writes
              each, on a single press. `ErrorBlock` offers the control only for
              codes `isRetryable` allows, so a settled answer never gets one.
            */
            <ErrorBlock
              error={load.error}
              onRetry={() => {
                void detailQuery.refetch();
              }}
            />
          )}
        </div>
      ) : null}

      {load.kind === 'loaded' ? (
        <>
          {/*
            `platformClient` IS PASSED DOWN BECAUSE THESE TWO ARE NOT CONVERTED
            YET. `OrganizationIdentityPanel` and `ResetCredential` still hold
            their own request state; they are outside this group's scope. It is
            the module singleton from `lib/clients.ts` either way, so there is
            still exactly one client — the prop is transitional, not a second
            route to it.
          */}
          <OrganizationIdentityPanel
            platform={platformClient}
            organizationId={load.detail.organization_id}
            identity={{
              display_name: load.detail.display_name,
              commercial_registration: load.detail.commercial_registration,
              vat_registration: load.detail.vat_registration,
            }}
            /*
             * THE SAVED BLOCK IS MERGED, NOT RE-FETCHED. Core returns the whole
             * identity after the change, so there is nothing to guess and
             * nothing to ask for again. `member_count`, `status`, `template`
             * and `created_at` are untouched by this route and keep their
             * loaded values.
             *
             * IT NOW MERGES INTO THE CACHE RATHER THAN INTO LOCAL STATE, which
             * is the same operation against the one copy that exists — and
             * `useMergeOrganizationIdentity` is `setQueryData`, deliberately NOT
             * `invalidateQueries`. An invalidation here would re-read the
             * Organization and double the cost of every edit.
             */
            onSaved={(identity) => {
              mergeIdentity(load.detail.organization_id, identity);
            }}
          />
          <DetailCard detail={load.detail} />
          <MemberLookup platform={platformClient} organizationId={load.detail.organization_id} />
        </>
      ) : null}
    </section>
  );
}

function DetailCard({ detail }: { detail: Detail }) {
  const t = useT();
  return (
    <div className="mt-5 rounded-[12px] border border-line bg-surface p-5 sm:p-6">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('column.identifier')}
          </dt>
          <dd className="mt-1 text-[0.875rem] text-ink">
            <bdi className="font-mono break-all">{detail.organization_id}</bdi>
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('column.status')}
          </dt>
          <dd className="mt-1">
            <StatusBadge status={detail.status} />
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('column.created')}
          </dt>
          <dd className="mt-1 text-[0.875rem] text-ink">
            <CreatedAt value={detail.created_at} />
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
            {t('column.members')}
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
        {/*
          THE ABSENCE IS A SECURITY DECISION AND THE SENTENCE SAYS SO. A count
          says whether onboarding worked; a LIST, across every Organization an
          operator can already enumerate, reconstructs every person's membership.
          **Written as "by design" precisely so nobody reads it as a gap and
          requests the feature** — which is what a shorter version would invite.
        */}
        <span className="font-semibold text-ink-soft">{t('detail.noMemberList.lead')}</span>{' '}
        {t('detail.noMemberList.why')}
      </p>

      <TemplateBlock template={detail.template} />
      {/*
        SR-20: THE ORGANIZATION'S STATUS TRAVELS WITH THE RE-TEMPLATE CONTROL.
        It is the Organization's own `status`, not the Template's — the embedded
        Template carries none, which is why nothing here defaults it.
      */}
      <OrganizationTemplatePanel
        organizationId={detail.organization_id}
        organizationStatus={detail.status}
        current={detail.template}
      />

      {/*
        A LINK, NOT AN EMBEDDED FEED. Reading that trail costs the customer five
        tenant row-writes per page, so it must not load because someone opened
        this page — and the destination itself does not load on arrival either.
        The cost is named here so the operator knows before they click.
      */}
      <div className="mt-5 border-t border-line pt-4">
        <Link
          to="/organizations/$organizationId/audit"
          params={{ organizationId: detail.organization_id }}
          className="text-[0.875rem] font-semibold text-navy-600 no-underline hover:underline"
        >
          What has the platform done to this business? &rarr;
        </Link>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
          Their own audit trail, including which person each action named. Reading it writes to it,
          against this business&rsquo;s daily allowance — so it opens without loading anything.
        </p>
      </div>
    </div>
  );
}

function TemplateBlock({ template }: { template: Detail['template'] }) {
  const t = useT();
  if (template === null) {
    return (
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
          {t('onboard.businessType')}
        </p>
        <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-muted">
          {t('detail.template.none')}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
        {t('onboard.businessType')}
      </p>
      {/* Operator-typed name and a wire id — isolated, not translated. */}
      <p className="mt-1 font-semibold break-words text-ink">
        <bdi>{template.name}</bdi>
      </p>
      <p className="text-xs text-ink-muted">
        <bdi className="font-mono break-all">{template.template_id}</bdi>
      </p>

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
 * Re-assign or CLEAR this Organization's Template.
 *
 * ===========================================================================
 * CLEARING IS AN OPERATION, NOT AN EMPTY UPDATE
 * ===========================================================================
 *
 * `{ template_id: null }` is SENT. Omitting the field would be an empty patch
 * — a request that changes nothing — where the operator meant *adopt none and
 * go back to Dudo's default words.* The two are different acts and only one of
 * them is what the "Use none" control promises.
 *
 * ===========================================================================
 * THE PICKER IS THE ONE THE ONBOARDING FORM ALREADY USES
 * ===========================================================================
 *
 * `useTemplatePicker` shares its cache key with onboarding, so opening this
 * costs nothing if that list was read in the last thirty seconds. **A second
 * query for the same question would be a second audited call to render the
 * same dropdown.**
 *
 * ===========================================================================
 * ⚠ RETIRED TEMPLATES ARE LISTED, AND THE DECIDING REASON IS A DEFECT RATHER
 * THAN A PRINCIPLE — Team Lead ruling, 2026-09-11
 * ===========================================================================
 *
 * My argument for showing them was that hiding entries restates an
 * authorization-shaped rule as a dropdown filter (`security.md` §2: a hidden
 * control is presentation, never security). **True, and it loses to "the
 * operator gets refused, which is bad UX" — so it is not what settles it.**
 *
 * **THE SETTLING REASON IS DERIVABLE FROM THE CONTRACT: retire is not delete.**
 * An Organization already assigned to a Template KEEPS it when that Template is
 * retired — which is exactly why `usage` counts adopters and why retirement
 * does not free the unique name.
 *
 * > **So an Organization can be ON a retired Template, and a picker that
 * > filtered retired entries could not display that Organization's current
 * > value.** It would not merely hide an option — it would break the screen for
 * > the case the feature exists to handle, on exactly the Organization most
 * > likely to need re-assignment.
 *
 * **AND NOT DISABLED-WITH-A-TOOLTIP EITHER.** `Operators.tsx`: a greyed-out
 * control is a promise, and here it would be a promise about an authorization
 * outcome this client does not get to make. The status is shown beside each
 * name; Core refuses what it refuses.
 *
 * ---------------------------------------------------------------------------
 * THE SAME REASONING FORCED `currentOption` BELOW
 * ---------------------------------------------------------------------------
 *
 * The picker asks for `PLATFORM_MAX_PAGE_SIZE` and takes the first page. **If
 * this Organization's Template is not on that page, the `<select>` has no
 * option matching `chosen` — and a browser renders the FIRST option instead.**
 * The operator would see "None recorded" against an Organization that has one,
 * and pressing Save would send `null`.
 *
 * **That is the silent reset the ruling was about, arriving through pagination
 * instead of through a filter.** So the current Template is appended as an
 * explicit option whenever the page does not already contain it: **the current
 * value is always representable, whatever the list happens to hold.**
 */
/**
 * The options, with the current Template guaranteed present.
 *
 * **A `<select>` whose `value` matches no `<option>` does not render empty — it
 * renders the FIRST option**, so an out-of-page current Template would display
 * as "None recorded" and Save would send `null`. The list is not re-sorted and
 * nothing is removed; one entry is appended when it is missing.
 *
 * ---------------------------------------------------------------------------
 * ⚠ `status` IS OPTIONAL HERE BECAUSE THE DETAIL RESPONSE DOES NOT CARRY ONE
 * ---------------------------------------------------------------------------
 *
 * `organization-detail-v1`'s embedded template is **`template_id`, `name` and
 * `level_labels` — no `status` and no `created_at`.** The compiler refused the
 * first version of this function and it was right to: an appended entry is a
 * NARROWER shape than a list row.
 *
 * **So the appended entry carries no status, and none is invented for it.**
 * Defaulting it to `'active'` would be this screen asserting a lifecycle state
 * the response never sent — and on the one Organization most likely to be on a
 * RETIRED Template, the guess would be wrong in the direction that hides the
 * thing the operator needs to see. **An absent status renders as absent.**
 */
interface TemplateOption {
  readonly template_id: string;
  readonly name: string;
  readonly status?: string;
}

function templateOptions(
  page: readonly Template[],
  current: Detail['template'],
): readonly TemplateOption[] {
  if (current === null) return page;
  return page.some((template) => template.template_id === current.template_id)
    ? page
    : [...page, { template_id: current.template_id, name: current.name }];
}

/**
 * ===========================================================================
 * SR-20 — A SUSPENDED ORGANIZATION MAY BE RE-TEMPLATED, AND THE SCREEN SAYS SO
 * ===========================================================================
 *
 * **The act is permitted.** `architecture-agent` ruled it, and the reasoning is
 * what produces the obligation here:
 *
 * > **Refusing the small act forces the big one.** To correct a Template on a
 * > suspended Organization, a refusal would make the operator **reactivate
 * > first** — a larger act performed for a smaller reason, because reactivation
 * > restores a customer's access to their own product. **Correcting
 * > configuration before restoring access is the safer order.**
 *
 * **SO THE OBLIGATION IS TO SHOW, NOT TO GATE.** An operator re-templating a
 * suspended Organization without knowing it is suspended **is deciding on a
 * fact they were not shown.** The control stays enabled: *a greyed-out control
 * is a promise*, and this is not a promise the client gets to make about an act
 * Core permits.
 *
 * **THE STATUS IS THE ORGANIZATION'S, NOT THE TEMPLATE'S.** The embedded
 * Template on the detail read carries no status — which is why nothing here
 * defaults one — and this is a different field on a different object, present
 * on `organizationDetailOutput` already.
 *
 * ⚠ **THE RULING RESTS ON THE STATE BEING ONE A CUSTOMER RETURNS FROM.** Both
 * current values are ordinary operator acts in both directions, so configuration
 * is being staged for a return. **If a terminal state ever ships —
 * pending-deletion, closed — this ruling does not extend to it**, because a
 * terminal state is one that does not come back. Hence `isKnownStatus` below
 * rather than a comparison against `'suspended'`: **a screen built against a
 * two-value status is a screen that silently accepts a third.**
 */
function OrganizationTemplatePanel({
  organizationId,
  organizationStatus,
  current,
}: {
  organizationId: string;
  organizationStatus: string;
  current: Detail['template'];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const picker = useTemplatePicker();
  const setTemplate = useSetOrganizationTemplate();
  const [chosen, setChosen] = useState<string>(current?.template_id ?? '');

  /*
   * FOCUS IN ON OPEN, BACK TO THE OPENER ON CLOSE — the same rule the Template
   * panels use, and the return half is the one that gets dropped because
   * nothing looks wrong without it. A keyboard user closing this panel would
   * otherwise be dropped at the top of a long detail page, above the
   * registrations, the member lookup and the audit link.
   */
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  /*
   * ⚠ THE SAME LATENT DEFECT AS `Templates.tsx`: the opener is unmounted while
   * the panel is open — `if (!open) return <Button ref={openerRef} …>` — so
   * `openerRef.current?.focus()` inside the close handler ran against `null`
   * and did nothing. **The call was present, which is all a reader or an audit
   * checks for.** The restore is an effect keyed on the panel closing, so it
   * runs after the render that remounts the button.
   */
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (!open && dismissedRef.current) {
      dismissedRef.current = false;
      openerRef.current?.focus();
    }
  }, [open]);

  const close = useCallback(() => {
    dismissedRef.current = true;
    setOpen(false);
  }, []);

  /* Escape closes it, like the drawer, the gate and the Template panels. */
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  const apply = (templateId: string | null) => {
    setTemplate.mutate(
      { organizationId, input: { template_id: templateId } },
      { onSuccess: close },
    );
  };

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button ref={openerRef} variant="secondary" size="sm" onClick={() => { setOpen(true); }}>
          {t('orgTemplate.change')}
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={headingId}
      className="mt-3 rounded-[7px] border border-line bg-sunk p-4"
    >
      {/*
        THE PANEL HAS AN ACCESSIBLE NAME. Without one it is announced as an
        unlabelled group — focus lands somewhere that says nothing about what
        it is, which is the same failure as moving focus nowhere at all.
      */}
      <h4 id={headingId} className="text-[0.9375rem] font-bold text-ink">
        {t('orgTemplate.heading')}
      </h4>
      <p className="text-[0.875rem] leading-relaxed text-ink-soft">{t('orgTemplate.explain')}</p>

      {/*
        ===================================================================
        SR-20 — THE ORGANIZATION'S STATUS, SHOWN AND NOT GATED
        ===================================================================

        **`role="status"` rather than `alert`.** This is a fact the operator
        needs before deciding, not a warning that something is wrong — nothing
        here is wrong, and an assertive interruption would read as a refusal for
        an act that is permitted.

        **RENDERED FOR EVERY NON-ACTIVE STATUS, NOT JUST `suspended`.** The
        condition is `status !== 'active'`, so **a third state this build has
        never heard of still produces the line** rather than silently rendering
        nothing — which is precisely what a terminal state arriving later would
        do to a screen that compared against `'suspended'`.

        **AND THE UNRECOGNISED CASE GETS ITS OWN SENTENCE.** Telling an operator
        an Organization is *suspended* when the console cannot read the status is
        a false statement about a customer; telling them the console does not
        recognise it is the honest one, and it is the case where re-templating
        deserves more hesitation rather than less.
      */}
      {organizationStatus !== 'active' ? (
        <p
          role="status"
          className="mt-3 rounded-[7px] border border-gold-500 bg-gold-50 p-3 text-[0.8125rem] leading-relaxed text-ink"
        >
          <span className="font-semibold">
            {isKnownStatus(organizationStatus)
              ? t('orgTemplate.statusNotice')
              : t('orgTemplate.statusUnknown')}
          </span>{' '}
          <StatusBadge status={organizationStatus} />{' '}
          {t('orgTemplate.statusWhy')}
        </p>
      ) : null}

      {picker.isPending || picker.isFetching ? (
        <p className="mt-3 text-[0.875rem] text-ink-muted">{t('state.loading')}</p>
      ) : picker.error !== null ? (
        <div className="mt-3">
          {picker.error.code === 'forbidden' ? (
            <PermissionDeniedBlock error={picker.error} />
          ) : (
            <ErrorBlock error={picker.error} onRetry={() => void picker.refetch()} />
          )}
        </div>
      ) : (
        <Field id="organization-template" label={t('orgTemplate.choose')}>
          {(aria) => (
            <select
              {...aria}
              value={chosen}
              onChange={(event) => { setChosen(event.target.value); }}
              disabled={setTemplate.isPending}
              className="w-full rounded-[7px] border border-line bg-surface px-3 py-2 text-ink"
            >
              <option value="">{t('orgTemplate.none')}</option>
              {templateOptions(picker.data?.data ?? [], current).map((template) => (
                <option key={template.template_id} value={template.template_id}>
                  {template.name}
                  {template.status === 'retired' ? ` — ${t('template.retired')}` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {setTemplate.error !== null ? (
        <div className="mt-3">
          {setTemplate.error.code === 'forbidden' ? (
            <PermissionDeniedBlock error={setTemplate.error} />
          ) : (
            <ErrorBlock error={setTemplate.error} />
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={setTemplate.isPending}
          disabled={setTemplate.isPending}
          onClick={() => { apply(chosen === '' ? null : chosen); }}
        >
          {setTemplate.isPending ? t('orgTemplate.saving') : t('template.save')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={setTemplate.isPending}
          onClick={close}
        >
          {t('template.cancel')}
        </Button>
      </div>
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
 *
 * ===========================================================================
 * THIS ONE IS NOT A QUERY AND NOT A MUTATION, AND THAT IS THE DECISION RATHER
 * THAN THE PART NOBODY GOT TO
 * ===========================================================================
 *
 * Every other read on this console moved to TanStack Query. This did not, for
 * two reasons that are specific to the collapsed refusal.
 *
 * **NOT A QUERY, BECAUSE A CACHE HIT IS A LOOKUP THE CUSTOMER NEVER SEES.** The
 * record written into the tenant's log is not a side effect of this call — for
 * accountability it IS the call. Serving the second press from cache would show
 * the operator an answer while the business's audit trail recorded one attempt
 * where two happened. **A cached answer is also an answer that arrives at a
 * different speed from an uncached one**, which is a distinguishing signal
 * between two lookups on a path whose whole design is that five outcomes are
 * indistinguishable.
 *
 * **NOT A MUTATION EITHER, AND THIS IS THE SUBTLER HALF.** `useMutation` would
 * fire on every press and cache nothing, which is correct — but it RETAINS the
 * error it caught, in state any code in this component can read. The `Lookup`
 * union below is built so that `refused` carries NOTHING: *"there is nothing
 * downstream that could branch on the cause because nothing downstream has
 * it."* **A hook holding the 404 puts the cause back within reach**, and the
 * next person to render `error.request_id` "for support" rebuilds the oracle
 * Core removed. The type is the enforcement, and a mutation would quietly widen
 * what the type is protecting.
 *
 * So the call stays direct and the error stays in a closure that discards it.
 */
function MemberLookup({
  platform,
  organizationId,
}: {
  platform: PlatformClient;
  organizationId: string;
}) {
  const t = useT();
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
        <h2 className="text-lg font-bold text-ink">{t('detail.lookup.title')}</h2>
        <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-ink-muted">
          {t('detail.lookup.intro')}{' '}
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
          <span className="font-semibold text-ink-soft">{t('detail.lookup.recorded')}</span>
        </p>
      </div>

      <Field
        id="member-identifier"
        label={t('detail.lookup.emailLabel')}
        error={localError}
        hint={t('signIn.emailHint')}
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
          {busy ? t('detail.lookup.looking') : t('detail.lookup.submit')}
        </Button>
        <p className="text-[0.8125rem] text-ink-muted">{t('detail.lookup.onePerPress')}</p>
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
  const t = useT();
  if (lookup.kind === 'idle' || lookup.kind === 'looking') return null;

  if (lookup.kind === 'found') {
    return (
      <div
        role="status"
        className="rounded-[7px] border border-green-500 bg-green-50 p-4 text-[0.875rem]"
      >
        <p className="font-bold text-green-700">{t('detail.lookup.found')}</p>
        <dl className="mt-3 grid gap-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              {t('detail.lookup.principalId')}
            </dt>
            <dd className="text-ink">
              <bdi className="font-mono break-all select-all">{lookup.member.principal_id}</bdi>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
              {t('detail.lookup.role')}
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
        <p className="font-bold text-scarlet-700">{t('detail.lookup.forbidden.title')}</p>
        {/*
          "REFUSED" IS NOT "FOUND NOTHING", and on a lookup that distinction is
          the difference between *this console may not ask* and *this person is
          not a member*. **The second is a statement about a customer that
          nobody made.** A translation that shortened this to "not found" would
          manufacture it.
        */}
        <p className="mt-1 leading-relaxed text-ink-soft">
          {t('detail.lookup.forbidden.body')}
        </p>
        {lookup.error.request_id ? (
          <p className="mt-2 text-xs text-ink-muted">
            {t('denied.reference')}{' '}
            <bdi className="font-mono break-all">{lookup.error.request_id}</bdi>
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

/* The locale was `undefined` — the browser's. See `Templates.tsx`'s `CreatedAt`. */
function CreatedAt({ value }: { value: string }) {
  const { locale } = useLocale();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono text-xs">{value}</bdi>;
  }
  return (
    <time dateTime={value} title={value}>
      <bdi>
        {parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
      </bdi>
    </time>
  );
}
