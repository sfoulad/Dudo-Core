/**
 * The Organization gate: choose which Organization this session works in.
 *
 * ===========================================================================
 * THIS IS PRESENTATION. IT IS NOT A SECURITY CONTROL AND MAY NEVER BE ONE.
 * ===========================================================================
 *
 * Same rule as `AuthGate` (`security.md` §2). The tenant is decided in
 * `platform/core/**` from the session, on every single call. Every screen behind
 * this gate is refused with `failed_precondition` until a selection has been
 * RECORDED SERVER-SIDE, whether or not this component exists. What the gate
 * buys is that a person sees a choice they can act on instead of a screen full
 * of "that is not possible in this state".
 *
 * IT HOLDS NO SELECTION OF ITS OWN. There is no remembered Organization here
 * and none may be added — the contract forbids a client-side copy of the
 * choice, because that would be an ambient tenant in the one place Dudo has
 * none. The server holds it; this asks and moves on.
 *
 * ===========================================================================
 * IT RENDERS 22-CHARACTER IDENTIFIERS, AND THAT IS THE HONEST RENDERING
 * ===========================================================================
 *
 * `display_name` is always `null`: `0002_organization.sql` declined a name
 * column deliberately, and `0021` records names as belonging to an
 * organization-structure slice that does not exist. The contract's instruction
 * is literal — "NO placeholder name. display_name null renders the
 * organization_id verbatim, in both clients."
 *
 * So this shows the identifier, in a monospaced face, with the wording carrying
 * the apology rather than an invented label. "Organization 1" would be a name
 * Dudo does not have, displayed as though it did, and the first support call
 * about it would be someone asking which one is theirs.
 */

import { Panel, StateBlock, ErrorBlock } from '@/components/StateBlock';
import { Button, Spinner } from '@/components/ui/button';
import type { OrganizationSelection } from '@/lib/use-organization';
import type { ReactNode } from 'react';

export function OrganizationGate({
  organization,
  children,
}: {
  organization: OrganizationSelection;
  children: ReactNode;
}) {
  if (!organization.required) return <>{children}</>;

  const { options, loading, error, submitting, staleChoice } = organization;

  /*
   * AUTO-SELECTION IS INVISIBLE AND MUST STAY SO. With exactly one option the
   * hook selects it without drawing a list, so this branch paints a neutral
   * "opening" state rather than a picker that flashes for 200 ms. It says
   * nothing about how many Organizations the person has and nothing about
   * whether a choice was made for them: the contract forbids a client
   * inferring, recording, displaying or branching on that.
   */
  if (options === null || submitting !== null || (options.length === 1 && !staleChoice)) {
    if (error) {
      return (
        <Panel>
          <ErrorBlock error={error} onRetry={organization.refresh} retryLabel="Try again" />
        </Panel>
      );
    }
    return (
      <Panel>
        <StateBlock
          title="Opening your workspace"
          body="One moment — Dudo is preparing this session."
        />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <ErrorBlock error={error} onRetry={organization.refresh} retryLabel="Try again" />
      </Panel>
    );
  }

  /*
   * NO MEMBERSHIPS. A `200` with `data: []` — an empty collection, not a
   * missing one, which is why the route never answers `404` here. It is a real
   * state a real person can reach by having their last membership revoked, and
   * there is nothing they can do about it in Dudo, so it says who to ask rather
   * than offering a retry that cannot help.
   */
  if (options.length === 0) {
    return (
      <Panel>
        <StateBlock
          title="You are not a member of any Organization"
          body={
            'Your sign-in worked, but this account has no active Organization membership, so ' +
            'there is nothing to open. Ask an owner of your Organization to add you, then sign ' +
            'in again.'
          }
          actions={
            <Button variant="secondary" onClick={organization.refresh}>
              Check again
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="grid gap-5">
        <div className="grid gap-2">
          <h1 className="font-serif text-2xl text-ink">Choose an Organization</h1>
          <p className="text-[0.9375rem] text-ink-muted">
            This account can work in more than one Organization. Pick the one to open — everything
            you see and change belongs to it, and you can switch by signing in again.
          </p>
          {/*
            The apology for the identifiers, said once and plainly. It is a real
            product gap (`0021`), not a loading state, so it is not dressed up
            as one.
          */}
          <p className="text-[0.8125rem] text-ink-muted">
            Organizations do not have names yet, so they are listed by their identifier.
          </p>
        </div>

        {staleChoice ? (
          <p
            role="status"
            className="rounded-[9px] border border-gold-500/50 bg-gold-50 p-4 text-[0.9375rem] text-ink"
          >
            That Organization is no longer available to you — your access to it may have just been
            changed. The list below has been refreshed.
          </p>
        ) : null}

        <ul className="grid list-none gap-2 p-0">
          {options.map((entry) => (
            <li key={entry.organization_id}>
              <button
                type="button"
                onClick={() => {
                  organization.choose(entry.organization_id);
                }}
                disabled={submitting !== null}
                className="flex w-full items-center gap-3 rounded-[9px] border border-line bg-surface p-4 text-start transition-colors hover:bg-navy-50 disabled:opacity-60"
              >
                <span className="grow">
                  {/*
                    `display_name` is null today, so this renders the identifier
                    verbatim. When names exist the identifier stays as the
                    second line: two Organizations could share a name, and the
                    identifier is what distinguishes them.
                  */}
                  {entry.display_name ? (
                    <>
                      <span className="block font-semibold text-ink">{entry.display_name}</span>
                      <span className="block font-mono text-[0.8125rem] text-ink-muted">
                        {entry.organization_id}
                      </span>
                    </>
                  ) : (
                    <span className="block break-all font-mono text-[0.9375rem] text-ink">
                      {entry.organization_id}
                    </span>
                  )}
                </span>
                {submitting === entry.organization_id ? <Spinner /> : null}
              </button>
            </li>
          ))}
        </ul>

        <div>
          <Button variant="secondary" onClick={organization.refresh} disabled={loading}>
            Refresh the list
          </Button>
        </div>
      </div>
    </Panel>
  );
}
