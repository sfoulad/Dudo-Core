/**
 * Who holds platform authority.
 *
 * ===========================================================================
 * IT RETURNS THREE FIELDS AND NOTHING ELSE, AND THAT IS NOT A THIN RESPONSE
 * ===========================================================================
 *
 * `principal_id`, `platform_role`, `created_at`. **No identifier, no email, no
 * display name, no last-seen.** `control-plane/0001_principal.sql` holds none of
 * them and refused an email column outright, because "a directory of every
 * user's personal details, readable without any tenant scope, would be the
 * highest-value target in the system."
 *
 * AN OPERATOR ROSTER SHOWING EMAIL ADDRESSES WOULD BE THAT DIRECTORY AT THE MOST
 * PRIVILEGED END OF THE PLATFORM. So this screen must not create pressure to add
 * one: no "invite", no search-by-email, no contact column left empty and waiting.
 *
 * The cost is real and named: **an operator cannot tell colleagues apart on
 * screen**, and recognises themselves only by matching against `whoami`. This
 * screen does that match, because it is the one piece of help it can honestly
 * give. Everything else is OP-3, closed by display names wherever they land.
 *
 * ===========================================================================
 * THERE IS NO REVOKE CONTROL HERE, AND ITS ABSENCE IS DELIBERATE
 * ===========================================================================
 *
 * `platform.operators.revoke` exists and is **the first confirmation-gated route
 * in Dudo**: it needs a server-authored statement rendered verbatim, an echoed
 * confirmation token, and re-authentication with the caller's own credential.
 * That is its own design problem and folding a button into a list screen is
 * exactly how such a flow gets built badly.
 *
 * So this renders a list and stops. **No revoke button, no menu, no disabled
 * control hinting at one** — a greyed-out button is a promise, and this screen
 * makes none.
 */

import { useMemo, useRef, useState, type RefObject } from 'react';
import { Button } from '@dudo/ui';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PermissionDeniedBlock,
} from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { ConfirmationGate } from '@/components/ConfirmationGate';
import { buildConfirmedRequest } from '@/api/confirmation';
import { useWhoami } from '@/lib/operator-context';
import { useOperatorList, useRevokeOperator } from '@/lib/queries';
import {
  fill,
  formatCount,
  useLocale,
  useT,
  type MessageKey,
  type PluralCategory,
} from '@/lib/i18n';
import { platformClient } from '@/lib/clients';
import { cn } from '@dudo/ui';
import {
  REVOKE_OPERATOR_ACTION_ID,
  REVOKE_OPERATOR_PATH_TEMPLATE,
  isKnownPlatformRole,
  type ListOperatorsOutput,
  type RevokeOperatorOutput,
} from '@/api/platform';
import { type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListOperatorsOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** What the gate is handed. The return type is not restated — it is read off the hook. */
type RevokeMutation = ReturnType<typeof useRevokeOperator>;

/* "Showing N operators" — the pagination line. */
const SHOWING_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'operators.showing.zero',
  one: 'operators.showing.one',
  two: 'operators.showing.two',
  few: 'operators.showing.few',
  many: 'operators.showing.many',
  other: 'operators.showing.other',
};

/* "N operators remain" — six forms in Arabic, chosen by `Intl`. */
const REMAINING_FORMS: Record<PluralCategory, MessageKey> = {
  zero: 'operators.remaining.zero',
  one: 'operators.remaining.one',
  two: 'operators.remaining.two',
  few: 'operators.remaining.few',
  many: 'operators.remaining.many',
  other: 'operators.remaining.other',
};

export function Operators() {
  /*
   * The signed-in operator, so this screen can mark which row is you.
   *
   * IT WAS A PROP AND IS NOW READ FROM CONTEXT (ADR 0040's router migration):
   * routed sections have no parent that can pass anything. It is NOT re-fetched
   * here and must never be — the probe that produces it is `whoami`, which
   * writes a platform-operator audit record on every call.
   */
  const whoami = useWhoami();
  const { locale, t } = useLocale();
  /*
   * WHERE FOCUS RETURNS WHEN A REVOKE GATE IS DISMISSED, and which row owns it.
   * `lastRevokingRef` is a ref rather than state because it must survive the
   * render that CLOSES the gate — `revoking` is null by then, and that is the
   * exact moment the buttons remount and one of them needs to claim the ref.
   */
  const openerRef = useRef<HTMLElement | null>(null);
  const lastRevokingRef = useRef<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  /** The principal whose revoke gate is open, or null. At most one at a time. */
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<RevokeOperatorOutput | null>(null);

  /*
   * THE READ IS A QUERY, AND THE `nonce` IS GONE.
   *
   * It was `useEffect` + `let cancelled` + a nonce bumped to force a re-read
   * after a revoke. The cancellation flag guarded against a response landing
   * after the operator had paged away and overwriting fresher state; the cache
   * owns that. The nonce is now an invalidation performed by the revoke
   * mutation itself, so this screen no longer has to remember to ask.
   *
   * `Load` is DERIVED, never stored — the three states rendered below are the
   * three the query already distinguishes, and a parallel copy in `useState` is
   * how the two drift apart.
   *
   * `isFetching` rather than `isPending` is what reproduces the previous
   * screen: the effect set `{ kind: 'loading' }` at the top of every run,
   * including a retry and a post-revoke re-read. `lib/queries.ts` records why
   * that equivalence is safe here — this client issues no fetch an operator did
   * not cause. **It is also what stops the success banner and the revoked row
   * being on screen together**, which is a contradiction the old code never
   * had a chance to show.
   */
  const list = useOperatorList(cursor);
  const load: Load =
    list.isPending || list.isFetching
      ? { kind: 'loading' }
      : list.error !== null
        ? { kind: 'failed', error: list.error }
        : { kind: 'loaded', page: list.data };

  /*
   * RETRY IS `refetch`, AND IT IS STILL EXACTLY ONE AUDITED CALL — the same
   * cost as the nonce bump it replaces. `retry: false` in `lib/query-client.ts`
   * is what keeps it one; the library default would answer an operator's single
   * click with four requests and, on a refusal, four audit rows.
   */
  const retry = () => void list.refetch();

  /*
   * THE REVOKE MUTATION IS HELD HERE, NOT IN THE GATE, AND THE REASON IS
   * LIFETIME RATHER THAN TIDINESS.
   *
   * `useMutation`'s `onSuccess` — which is what re-reads the roster — runs
   * through the observer the calling component owns. Hold the hook inside
   * `RevokeOperator` and the invalidation is lost if that component unmounts
   * while the request is in flight: **the operator would be revoked and still
   * listed.**
   *
   * It cannot happen today, because the gate disables Cancel while submitting.
   * **That is a guarantee living in another component, one prop away from being
   * changed by someone with no reason to look here.** This screen outlives every
   * gate it opens, so holding it here makes the property structural instead.
   */
  const revoke = useRevokeOperator();

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-3xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          {t('nav.operators')}
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          {t('operators.intro')}
        </p>
      </header>

      {revoked !== null ? (
        <div
          role="status"
          className="mb-5 rounded-[12px] border border-green-500 bg-green-50 p-4 text-[0.875rem] leading-relaxed text-ink"
        >
          <p className="font-bold text-green-700">{t('operators.revoked.title')}</p>
          <p className="mt-1">
            <bdi className="font-mono break-all">{revoked.principal_id}</bdi>{' '}
            {t('operators.revoked.noLonger')}{' '}
            {revoked.was_self ? (
              /*
                THE SELF-REVOCATION SENTENCE IS THE ONE THAT MUST NOT SOFTEN.
                There is no route that grants platform authority back — it has to
                be re-seeded out of band. **An operator who reads this as "you
                have been signed out" will try to sign in again**, and the
                console cannot tell them why it will not work.
              */
              <span className="font-semibold">{t('operators.revoked.wasSelf')}</span>
            ) : null}{' '}
            {/*
              "N operators remain" — six forms in Arabic. The old ternary is
              right for English and wrong for Arabic at almost every count.
            */}
            {formatCount(locale, revoked.remaining_operator_count, REMAINING_FORMS, t)}
          </p>
        </div>
      ) : null}

      {load.kind === 'loading' ? <LoadingBlock label={t('loading.operators')} /> : null}

      {/*
        FOUR OUTCOMES, AND `forbidden` IS BRANCHED BEFORE THE GENERIC ERROR.

        A refusal is a permission boundary, not a malfunction, and rendering it
        through `ErrorBlock` said "something went wrong" about a system working
        exactly as designed. `PermissionDeniedBlock` carries the four-way
        collapse `platform-operator-v1` requires — it does not guess which
        reason applies and says the uniformity is deliberate.
      */}
      {load.kind === 'failed' ? (
        load.error.code === 'forbidden' ? (
          <PermissionDeniedBlock error={load.error} />
        ) : isCeilingCode(load.error.code) ? (
          <CeilingNotice error={load.error} scope="platform" onRetry={retry} />
        ) : (
          <ErrorBlock error={load.error} onRetry={retry} />
        )
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title={t('operators.empty.title')}
          body={<>{t('operators.empty.body')}</>}
        />
      ) : null}

      {load.kind === 'loaded' && load.page.data.length > 0 ? (
        <>
          <ul className="grid gap-3">
            {load.page.data.map((operator) => {
              const isYou = operator.principal_id === whoami.principal_id;
              return (
                <li
                  key={operator.principal_id}
                  className={cn(
                    'rounded-[12px] border bg-surface p-4 sm:p-5',
                    isYou ? 'border-navy-600' : 'border-line',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      {/*
                        VERBATIM AND UNTRUNCATED. This is the only handle that
                        exists for a colleague — there are no names anywhere —
                        so shortening it would make the roster useless for the
                        support conversation it serves.
                      */}
                      <p className="font-mono text-[0.875rem] break-all text-ink">
                        {operator.principal_id}
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-ink-muted">
                        {t('operators.granted')} <GrantedAt value={operator.created_at} />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/*
                        THE ONLY HELP THIS SCREEN CAN HONESTLY GIVE. With no
                        names, an operator recognises themselves by matching
                        against `whoami` — so the console does that match rather
                        than leaving it to the eye across 22 characters.
                      */}
                      {isYou ? (
                        <span className="rounded-full bg-navy-600 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white">
                          {t('operators.you')}
                        </span>
                      ) : null}
                      <RoleBadge role={operator.platform_role} />
                      {/*
                        THE GATE OPENS ONLY ON THIS PRESS. No challenge is
                        requested on render, hover or focus — one costs
                        control-plane writes and runs the full authorization of
                        the operation it names.
                      */}
                      {revoking === null ? (
                        <Button
                          /*
                            ===================================================
                            WHERE FOCUS RETURNS, AND WHY IT IS A CALLBACK RATHER
                            THAN ONE SHARED REF
                            ===================================================

                            **Opening any gate unmounts EVERY one of these
                            buttons** — the condition is `revoking === null`, not
                            per-row — and dismissing remounts all of them. A
                            single `ref` passed to each would be assigned once
                            per row on that remount, **so `current` would end up
                            holding the LAST row's button and focus would land on
                            a stranger.**

                            So each row claims the ref only if it is the row
                            whose gate was open. `lastRevokingRef` survives the
                            state change that closes the gate, which `revoking`
                            itself does not.
                          */
                          ref={(node) => {
                            if (node !== null && operator.principal_id === lastRevokingRef.current) {
                              openerRef.current = node;
                            }
                          }}
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRevoked(null);
                            lastRevokingRef.current = operator.principal_id;
                            setRevoking(operator.principal_id);
                          }}
                        >
                          {t('operators.removeAuthority')}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {revoking === operator.principal_id ? (
                    <RevokeOperator
                      openerRef={openerRef}
                      revoke={revoke}
                      principalId={operator.principal_id}
                      isSelf={isYou}
                      remainingCount={load.page.data.length}
                      onDone={(result) => {
                        setRevoking(null);
                        setRevoked(result);
                        /*
                         * THE RE-READ IS NOT HERE ANY MORE. `useRevokeOperator`
                         * invalidates the roster on success, so it happens
                         * because the write succeeded rather than because this
                         * callback remembered — still one audited call,
                         * triggered by a completed action and never by a timer.
                         */
                      }}
                      onCancel={() => {
                        setRevoking(null);
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>

          <nav
            aria-label={t('a11y.pagination')}
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            {/*
              ⚠ A PLURAL TERNARY THE COPY PIN NEVER SAW. `Showing` is one word
              and the prose pattern's floor is three, so this line — and the two
              identical ones on `Organizations` and `Templates` — sat in English
              while the pin read zero.
            */}
            <p className="text-[0.8125rem] text-ink-muted">
              {formatCount(locale, load.page.data.length, SHOWING_FORMS, t)}
              {depth > 1 ? ` · ${fill(t('audit.page'), locale, { page: depth })}` : null}
            </p>
            <div className="flex gap-2">
              {cursor !== null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCursor(null);
                    setDepth(1);
                  }}
                >
                  {t('page.firstPage')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={load.page.next_cursor === null}
                onClick={() => {
                  if (load.page.next_cursor === null) return;
                  setCursor(load.page.next_cursor);
                  setDepth((value) => value + 1);
                }}
              >
                {load.page.next_cursor === null ? t('audit.noMorePages') : t('page.next')}
              </Button>
            </div>
          </nav>
        </>
      ) : null}

      <p className="mt-6 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
        {/*
          THE ABSENCE OF NAMES IS A DECISION AND THE SENTENCE SAYS SO. Dudo
          stores no personal details against a principal outside a business, so a
          roster with contact details would be exactly the directory that
          decision refused — **at the most privileged end of the platform.** Copy
          that read as a gap would invite somebody to add the column.
        */}
        <span className="font-semibold text-ink-soft">{t('operators.noNames.lead')}</span>{' '}
        {t('operators.noNames.why')}
      </p>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">{t('operators.removing.lead')}</span>{' '}
        {t('operators.removing.what')}
      </p>
    </section>
  );
}

/**
 * The revoke action for one operator.
 *
 * ===========================================================================
 * THE BINDING IS THE PATH PARAMETER, AND THAT IS THE WHOLE OF IT
 * ===========================================================================
 *
 * `revokeOperatorInput` carries only the three confirmation fields, so
 * body-minus-three is the EMPTY OBJECT. The target lives in the path, and the
 * parameters are `{principal_id}` **only because of the union clause added on
 * 2026-09-05** — before it, a confirmation minted to revoke operator A could
 * have been spent on operator B, and the sentence promising otherwise was false.
 *
 * So `buildConfirmedRequest` derives the name from the path template, binds the
 * DECODED value as a JSON string, and produces the URL and the parameters
 * together. There is no second place the target could differ.
 */
function RevokeOperator({
  revoke,
  principalId,
  isSelf,
  remainingCount,
  onDone,
  onCancel,
  openerRef,
}: {
  /*
   * PASSED IN, AND ONLY `mutateAsync` IS USED. The gate is already a state
   * machine over this request and holds the phase the password derivation runs
   * inside, so `revoke.isPending` and `revoke.error` are deliberately not read —
   * two renderings of one request would drift. `lib/queries.ts` says the same
   * at the hook; the parent says why the hook is not held here.
   */
  revoke: RevokeMutation;
  principalId: string;
  isSelf: boolean;
  remainingCount: number;
  onDone: (result: RevokeOperatorOutput) => void;
  onCancel: () => void;
  /** Threaded straight through. The gate requires it; this panel only relays. */
  openerRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const request = useMemo(
    () =>
      buildConfirmedRequest({
        pathTemplate: REVOKE_OPERATOR_PATH_TEMPLATE,
        pathValues: { principal_id: principalId },
        // No body fields at all — the three confirmation fields are added at
        // submission and are never part of the binding.
        bodyFields: {},
      }),
    [principalId],
  );

  return (
    <div className="mt-4">
      {isSelf ? (
        <p
          role="alert"
          className="mb-4 rounded-[7px] border border-scarlet-600 bg-scarlet-50 p-3 text-[0.875rem] leading-relaxed text-ink"
        >
          <span className="font-bold">{t('operators.self.lead')}</span>{' '}
          {t('operators.self.what')}
          {remainingCount <= 1 ? ` ${t('operators.self.maybeLast')}` : null}
        </p>
      ) : null}

      <ConfirmationGate
        openerRef={openerRef}
        title={isSelf ? t('operators.revokeSelf.title') : t('operators.revoke.title')}
        boundParameters={request.parameters}
        /*
         * THE CHALLENGE IS NOT A MUTATION HOOK, AND THE REASON IS THE GATE'S
         * OWN `[]` EFFECT. It is requested exactly once, from the press that
         * opened this panel, because a second one mints a second challenge and
         * spends another audited write. Routing it through TanStack Query would
         * buy nothing — it invalidates no cache — and would mean restructuring
         * a component two screens share. Left as a direct call, deliberately.
         */
        requestChallenge={() =>
          platformClient.requestConfirmation({
            actionId: REVOKE_OPERATOR_ACTION_ID,
            parameters: request.parameters,
          })
        }
        submit={async (confirmation) => {
          const result = await revoke.mutateAsync({
            path: request.path,
            bodyWithoutConfirmation: request.bodyWithoutConfirmation,
            ...confirmation,
          });
          onDone(result);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const known = isKnownPlatformRole(role);
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        role === 'platform-admin' && 'bg-scarlet-50 text-scarlet-700',
        role === 'marketplace-moderator' && 'bg-azure-50 text-azure-700',
        !known && 'bg-sunk text-ink-muted',
      )}
    >
      {role}
      {!known ? <span className="sr-only"> (an unrecognised role)</span> : null}
    </span>
  );
}

/* The locale was `undefined` — the browser's. See `Templates.tsx`'s `CreatedAt`. */
function GrantedAt({ value }: { value: string }) {
  const { locale } = useLocale();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <bdi className="font-mono">{value}</bdi>;
  }
  return (
    <time dateTime={value} title={value}>
      <bdi>
        {parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
      </bdi>
    </time>
  );
}
