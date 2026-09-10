/**
 * Reached when the address does not match any screen.
 *
 * It was exported from `CustomerDetail.tsx`, because the hand-rolled route
 * ladder fell through to it there. It is its own screen now: the router names it
 * as the root route's `notFoundComponent`, and a file that has to be imported
 * for its side-neighbour is a file the next person deletes by accident.
 *
 * The link goes back to the directory the person was last looking at, filters
 * and all, rather than to the top of it — the same courtesy every other back
 * link in this application pays.
 */

import { Link } from '@tanstack/react-router';
import { buttonVariants, Panel, StateBlock } from '@dudo/ui';
import { getLastListSearch } from '@/lib/last-list';

/*
 * A ROUTER LINK STYLED AS A BUTTON IS BUILT AT THE CALL SITE, NOT IN `ui/`.
 *
 * `ui/button.tsx` exports `ButtonLink`, which is a plain `<a href>` — correct
 * for a mail link and wrong for a route, because it costs a full page load. The
 * obvious fix would be a `ui/` component wrapping TanStack's `Link`, and
 * `check:ui-purity` forbids exactly that: a primitive that emits a `<Link to>`
 * has chosen one of the two administrations' route trees (`0035`, `0036`).
 *
 * So the primitive exports its CLASSES and the screen composes them with its own
 * router's link. One extra line per call site, and the shared layer stays
 * shareable.
 */

export function NotFound() {
  const search = getLastListSearch();

  return (
    <div>
      <Link
        to="/customers"
        search={search}
        className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink-muted no-underline hover:text-navy-700"
      >
        <span aria-hidden="true" className="rtl:rotate-180">
          ←
        </span>
        Customers
      </Link>
      <Panel>
        <StateBlock
          glyph="?"
          title="This page does not exist"
          body="The address does not match anything in Dudo."
          actions={
            <Link
              to="/customers"
              search={search}
              className={buttonVariants({ variant: 'primary' })}
            >
              Go to customers
            </Link>
          }
        />
      </Panel>
    </div>
  );
}
