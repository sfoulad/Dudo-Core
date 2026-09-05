/**
 * The console frame: header, sidebar navigation, main area.
 *
 * ===========================================================================
 * RESPONSIVE IS A REQUIREMENT, NOT A FINISH
 * ===========================================================================
 *
 * One layout, three behaviours, and the breakpoint is where the content needs
 * it rather than at a device name:
 *
 *   - `lg` AND WIDER — the sidebar is permanent, in the document, always
 *     visible. No toggle is rendered at all.
 *   - BELOW `lg` — the sidebar becomes an overlay drawer behind a Menu button.
 *     `Escape` closes it, focus moves into it on open and back to the button on
 *     close, and the backdrop is clickable.
 *
 * THE DRAWER IS ONE ELEMENT, NOT TWO. A common shortcut is to render the
 * navigation twice — once for desktop, once for mobile — which doubles every
 * future change and guarantees the two drift. Here the same `<nav>` is
 * positioned differently by the breakpoint.
 *
 * ===========================================================================
 * RTL: LOGICAL PROPERTIES THROUGHOUT
 * ===========================================================================
 *
 * ADR 0010 requires full RTL, not an RTL afterthought, with "logical Tailwind
 * properties — start/end, never left/right". So: `start-0` not `left-0`,
 * `border-e` not `border-r`, `ps-*`/`pe-*` not `pl-*`/`pr-*`, `ms-auto` not
 * `ml-auto`, and `text-start` not `text-left`. In an RTL document the sidebar
 * moves to the right edge and the drawer slides from the right with no
 * stylesheet change. A component written with `left`/`right` has to be rebuilt,
 * not translated.
 *
 * ===========================================================================
 * THE SESSION NOTICE IS PART OF THE FRAME, NOT A DECORATION
 * ===========================================================================
 *
 * It is here rather than on a screen because it is true of the whole console.
 * See `api/platform-session.ts` for why the state cannot be verified and why
 * saying so is the honest option. It should disappear by being ANSWERED — a
 * ratified `platform.session.whoami` — not by being hidden when it gets
 * annoying.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ROUTES, buildHash, type RoutePath } from '@/lib/router';
import { VERIFICATION_UNAVAILABLE_REASON } from '@/api/platform-session';
import { CONFIG } from '@/api/config';

interface NavItem {
  readonly path: RoutePath;
  readonly label: string;
}

/**
 * The four sections, in the order an operator meets them: what exists, what
 * shapes it, who may act, and what was done.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTES.organizations, label: 'Organizations' },
  { path: ROUTES.templates, label: 'Templates' },
  { path: ROUTES.operators, label: 'Operators' },
  { path: ROUTES.audit, label: 'Audit' },
];

export interface AdminShellProps {
  readonly currentPath: string;
  /** False after a reload, when only the per-tab hint says anyone is signed in. */
  readonly sessionConfirmedThisPageLoad: boolean;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

export function AdminShell({
  currentPath,
  sessionConfirmedThisPageLoad,
  signingOut,
  onSignOut,
  children,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  // `Escape` closes the drawer. Bound only while it is open, so nothing listens
  // on the common path.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen, closeDrawer]);

  // Focus moves into the drawer on open, so a keyboard or screen-reader user is
  // not left behind the button they just pressed.
  useEffect(() => {
    if (drawerOpen) navRef.current?.querySelector('a')?.focus();
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="on-navy sticky top-0 z-30 flex min-h-14 items-center gap-3 bg-navy-800 px-3 text-white sm:px-5">
        <Button
          ref={menuButtonRef}
          variant="onNavy"
          size="sm"
          className="lg:hidden"
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          onClick={() => {
            setDrawerOpen((open) => !open);
          }}
        >
          <MenuIcon />
          Menu
        </Button>

        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-bold leading-tight">
            Dudo <span className="font-normal text-navy-100">platform administration</span>
          </p>
          {/*
            The build label is not a version number and says so in `config.ts`.
            It exists so a person looking at a screenshot of a test deployment
            can say which build produced it.
          */}
          <p className="truncate text-[0.6875rem] leading-tight text-navy-100">
            {CONFIG.buildLabel}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <Button variant="onNavy" size="sm" busy={signingOut} onClick={onSignOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>

      {!sessionConfirmedThisPageLoad ? (
        <p
          role="status"
          className="border-b border-gold-500 bg-gold-50 px-4 py-2.5 text-[0.8125rem] leading-relaxed text-ink sm:px-6"
        >
          <span className="font-bold">Session not verified.</span>{' '}
          {VERIFICATION_UNAVAILABLE_REASON}
        </p>
      ) : null}

      <div className="lg:flex">
        {/* The backdrop exists only while the drawer is open, and only below
            `lg`. `aria-hidden` because the drawer itself is the interactive
            thing; this is a click target, not content. */}
        {drawerOpen ? (
          <div
            aria-hidden="true"
            onClick={closeDrawer}
            className="fixed inset-0 z-20 bg-navy-900/50 lg:hidden"
          />
        ) : null}

        <nav
          ref={navRef}
          id={drawerId}
          aria-label="Sections"
          className={cn(
            'on-navy bg-navy-800 text-white',
            // Below `lg`: an overlay drawer pinned to the inline start, sliding
            // in from whichever side that is in the current writing direction.
            //
            // `inset-y-0` is the BLOCK axis (top and bottom) and is RTL-safe:
            // horizontal writing modes mirror the inline axis only, so there is
            // no logical variant to prefer here. `start-0` beside it IS the
            // logical inline property, and that is the one that matters.
            //
            // IT WAS `inset-block-0` AND THAT IS NOT A TAILWIND UTILITY. It
            // compiled to nothing at all, leaving the drawer `fixed` with no
            // vertical bounds — so it collapsed to the height of its own list
            // instead of the viewport. Caught by grepping the built CSS for the
            // class rather than by looking at the source, which is the only way
            // a silently-dropped utility can be caught.
            'fixed inset-y-0 start-0 z-20 w-64 max-w-[80vw] overflow-y-auto',
            'transition-transform duration-200 ease-out',
            drawerOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
            // `lg` and wider: in the document, permanent, no transform.
            'lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:shrink-0',
            'lg:translate-x-0 lg:border-e lg:border-navy-700',
          )}
        >
          <ul className="grid gap-1 p-3">
            {NAV_ITEMS.map((item) => {
              const active = currentPath === item.path;
              return (
                <li key={item.path}>
                  <a
                    href={buildHash(item.path)}
                    // `aria-current="page"` is what tells a screen reader which
                    // section is open. The background colour tells everyone
                    // else; neither substitutes for the other.
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      setDrawerOpen(false);
                    }}
                    className={cn(
                      'block rounded-[7px] px-3 py-2 text-[0.9375rem] no-underline transition-colors',
                      active
                        ? 'bg-white/15 font-semibold text-white'
                        : 'text-navy-100 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>

          <p className="border-t border-navy-700 p-3 text-[0.75rem] leading-relaxed text-navy-100">
            An operator belongs to no Organization and cannot reach customer records. That is
            structural, not a setting.
          </p>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}
