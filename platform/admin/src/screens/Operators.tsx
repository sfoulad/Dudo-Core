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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';
import { CeilingNotice, isCeilingCode } from '@/components/CeilingNotice';
import { ConfirmationGate } from '@/components/ConfirmationGate';
import { buildConfirmedRequest } from '@/api/confirmation';
import { cn } from '@/lib/cn';
import {
  PLATFORM_DEFAULT_PAGE_SIZE,
  REVOKE_OPERATOR_ACTION_ID,
  REVOKE_OPERATOR_PATH_TEMPLATE,
  isKnownPlatformRole,
  type ListOperatorsOutput,
  type PlatformClient,
  type RevokeOperatorOutput,
  type WhoamiOutput,
} from '@/api/platform';
import { toApiError, type ApiError } from '@/api/errors';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly page: ListOperatorsOutput }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function Operators({
  platform,
  whoami,
}: {
  platform: PlatformClient;
  /** The signed-in operator, so this screen can mark which row is you. */
  whoami: WhoamiOutput;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [nonce, setNonce] = useState(0);
  /** The principal whose revoke gate is open, or null. At most one at a time. */
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<RevokeOperatorOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: 'loading' });
    void platform.listOperators({ pageSize: PLATFORM_DEFAULT_PAGE_SIZE, cursor }).then(
      (page) => {
        if (!cancelled) setLoad({ kind: 'loaded', page });
      },
      (thrown: unknown) => {
        if (!cancelled) setLoad({ kind: 'failed', error: toApiError(thrown) });
      },
    );
    return () => {
      cancelled = true;
    };
    // One audited call per page. No interval, no focus refetch.
  }, [platform, cursor, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-3xl">
      <header className="mb-5">
        <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
          Operators
        </h1>
        <p className="mt-2 max-w-prose leading-relaxed text-ink-muted">
          Every principal holding platform authority, and which role each one holds.
        </p>
      </header>

      {revoked !== null ? (
        <div
          role="status"
          className="mb-5 rounded-[12px] border border-green-500 bg-green-50 p-4 text-[0.875rem] leading-relaxed text-ink"
        >
          <p className="font-bold text-green-700">Platform authority removed.</p>
          <p className="mt-1">
            <code className="font-mono break-all">{revoked.principal_id}</code> no longer holds
            platform authority.{' '}
            {revoked.was_self ? (
              <span className="font-semibold">
                That was your own account — you will be refused on the next request, and there is
                no route that grants it back.
              </span>
            ) : null}{' '}
            {revoked.remaining_operator_count} {revoked.remaining_operator_count === 1 ? 'operator remains' : 'operators remain'}.
          </p>
        </div>
      ) : null}

      {load.kind === 'loading' ? <LoadingBlock label="Asking Core who holds platform authority…" /> : null}

      {load.kind === 'failed' ? (
        isCeilingCode(load.error.code) ? (
          <CeilingNotice error={load.error} scope="platform" onRetry={retry} />
        ) : (
          <ErrorBlock error={load.error} onRetry={retry} />
        )
      ) : null}

      {load.kind === 'loaded' && load.page.data.length === 0 ? (
        <EmptyBlock
          title="No operators are listed."
          body={
            <>
              Core answered with an empty roster, which should be impossible — you are reading this
              through an operator session, so at least one exists. Report it.
            </>
          }
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
                        Granted <GrantedAt value={operator.created_at} />
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
                          You
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
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRevoked(null);
                            setRevoking(operator.principal_id);
                          }}
                        >
                          Remove authority
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {revoking === operator.principal_id ? (
                    <RevokeOperator
                      platform={platform}
                      principalId={operator.principal_id}
                      isSelf={isYou}
                      remainingCount={load.page.data.length}
                      onDone={(result) => {
                        setRevoking(null);
                        setRevoked(result);
                        // The roster changed, so re-read it. One audited call,
                        // triggered by a completed action rather than a timer.
                        setNonce((value) => value + 1);
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
            aria-label="Pagination"
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-[0.8125rem] text-ink-muted">
              Showing {load.page.data.length}{' '}
              {load.page.data.length === 1 ? 'operator' : 'operators'}
              {depth > 1 ? ` · page ${String(depth)}` : null}
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
                  First page
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
                {load.page.next_cursor === null ? 'No more pages' : 'Next page'}
              </Button>
            </div>
          </nav>
        </>
      ) : null}

      <p className="mt-6 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">
          There are no names here, and no email addresses.
        </span>{' '}
        Dudo does not store personal details against a principal outside a business, so an operator
        roster showing contact details would be exactly the directory that decision refused —
        at the most privileged end of the platform. You recognise yourself by the marker above;
        telling colleagues apart needs display names, which do not exist yet.
      </p>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink-soft">Removing an operator</span> asks Dudo what it
        will do, shows you that sentence, and needs your own password. It cannot be undone from
        here — there is no route that grants platform authority.
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
  platform,
  principalId,
  isSelf,
  remainingCount,
  onDone,
  onCancel,
}: {
  platform: PlatformClient;
  principalId: string;
  isSelf: boolean;
  remainingCount: number;
  onDone: (result: RevokeOperatorOutput) => void;
  onCancel: () => void;
}) {
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
          <span className="font-bold">This is your own account.</span> Removing your own platform
          authority signs you out of everything here, and there is no route that grants it back —
          it has to be re-seeded out of band.
          {remainingCount <= 1 ? ' You may also be the last operator.' : null}
        </p>
      ) : null}

      <ConfirmationGate
        title={isSelf ? 'Remove your own platform authority' : 'Remove platform authority'}
        boundParameters={request.parameters}
        requestChallenge={() =>
          platform.requestConfirmation({
            actionId: REVOKE_OPERATOR_ACTION_ID,
            parameters: request.parameters,
          })
        }
        submit={async (confirmation) => {
          const result = await platform.revokeOperator({
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

function GrantedAt({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return <span className="font-mono">{value}</span>;
  }
  return (
    <time dateTime={value} title={value}>
      {parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
