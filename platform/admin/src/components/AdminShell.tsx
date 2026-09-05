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
 * THE "SESSION NOT VERIFIED" BANNER IS GONE, BECAUSE IT WAS ANSWERED
 * ===========================================================================
 *
 * The shell carried a permanent notice saying this console could not confirm a
 * session was live, because no accepted contract let a principal with no
 * Organization verify itself. `platform.session.whoami` is now accepted and
 * implemented, so the notice is REMOVED RATHER THAN HIDDEN — which was the
 * stated condition for removing it. What stands in its place is the operator's
 * actual identity, reported by Core.
 *
 * The header shows the principal identifier and platform role because on a
 * console that acts on other people's businesses, "who am I signed in as" should
 * not require a click. It is display only: `0007` D8 and ADR 0010 §7 —
 * UI hiding is presentation, never security.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ROUTES, buildHash, type RoutePath } from '@/lib/router';
import type { WhoamiOutput } from '@/api/platform';
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
  /** The operator's own context, as Core reported it. Display only. */
  readonly whoami: WhoamiOutput;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

export function AdminShell({
  currentPath,
  whoami,
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

        <div className="ms-auto flex items-center gap-2 sm:gap-3">
          {/*
            Who Core says you are. Hidden below `sm` where the header has no room
            — it is repeated in the sidebar, which is where a phone user reaches
            it, so nothing is lost rather than merely dropped.
          */}
          <p className="hidden text-end text-[0.75rem] leading-tight text-navy-100 sm:block">
            <span className="block font-mono break-all">{whoami.principal_id}</span>
            <span className="block">{whoami.platform_role}</span>
          </p>
          <Button variant="onNavy" size="sm" busy={signingOut} onClick={onSignOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>

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

            /*
             * ===============================================================
             * EVERY DRAWER STYLE IS SCOPED `max-lg:`. IT MUST STAY THAT WAY.
             * ===============================================================
             *
             * THIS SHIPPED BROKEN AND THE SIDEBAR WAS INVISIBLE ON DESKTOP.
             * The previous version applied the drawer styles unconditionally and
             * tried to cancel them at the breakpoint: an unscoped direction-
             * variant negative x-translation to park the drawer off-screen, plus
             * a breakpoint-scoped zero x-translation to bring it back at `lg`.
             *
             * THE BREAKPOINT ONE NEVER WON. In the built sheet the breakpoint
             * rule sits inside `@media(min-width:64rem)` with specificity
             * (0,1,0), and the direction-variant rule comes LATER with the SAME
             * specificity, because Tailwind wraps the direction test in
             * `:where()`, which contributes zero. Equal specificity, later wins —
             * so the nav was translated -100% at every width, including 1600px.
             * It still occupied its column (the sticky rule did win), which is
             * why the page showed an empty gutter rather than a collapsed
             * layout.
             *
             * THE EXACT CLASS NAMES ARE NOT WRITTEN OUT ANYWHERE IN THIS COMMENT,
             * AND THAT IS DELIBERATE. Tailwind v4 scans raw file text for
             * candidates, so quoting a utility in prose COMPILES IT INTO THE
             * BUNDLE. The first draft of this comment did exactly that and
             * reintroduced both dead rules — `verify-css.mjs` failed on the
             * fixed component, because the hazard really was still in the
             * stylesheet even though no element referenced it.
             *
             * A `lg:` utility CANNOT be relied on to override an `ltr:`/`rtl:`
             * one. The media query adds no specificity and the variant order in
             * the sheet is not something this file controls. SO THE OVERRIDE IS
             * REMOVED RATHER THAN REORDERED: below `lg` the drawer styles exist,
             * at `lg` they are never emitted onto the element at all, and there
             * is no contest to lose.
             *
             * `scripts/verify-css.mjs` asserts this against the BUILT stylesheet
             * — that the drawer transform lives inside a max-width media query —
             * because "the class is present" is what I checked last time and it
             * was true while the layout was broken.
             *
             * `inset-y-0` is the BLOCK axis and is RTL-safe: horizontal writing
             * modes mirror the inline axis only. `start-0` is the logical inline
             * property, and that is the one that matters here. (It was once
             * `inset-block-0`, which is not a Tailwind utility and compiled to
             * nothing — same family of defect, same detection method.)
             */
            'max-lg:fixed max-lg:inset-y-0 max-lg:start-0 max-lg:z-20',
            'max-lg:w-64 max-lg:max-w-[80vw] max-lg:overflow-y-auto',
            'max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
            drawerOpen ? '' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',

            // `lg` and wider: an ordinary in-document column. No position
            // override, no transform to cancel, nothing to out-specify.
            'lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:shrink-0',
            'lg:overflow-y-auto lg:border-e lg:border-navy-700',
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

          <div className="border-t border-navy-700 p-3 text-[0.75rem] leading-relaxed text-navy-100">
            {/* The identity again, for the phone layout where the header hides it. */}
            <p className="mb-3 sm:hidden">
              <span className="block font-mono break-all text-white">{whoami.principal_id}</span>
              <span className="block">{whoami.platform_role}</span>
            </p>
            <p>
              An operator belongs to no Organization and cannot reach customer records. That is
              structural, not a setting.
            </p>
            {/*
              The permission list, as Core reports it. RENDERING ONLY — the
              contract, the schema and the handler all say so, and it is shown
              here rather than used to decide anything. It is `platform-admin`'s
              six reachable permissions, not the eight the role holds: two are
              reachable by no route, and reporting them would imply an action
              that does not exist.
            */}
            {whoami.permissions.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-navy-100 hover:text-white">
                  {whoami.permissions.length} permission
                  {whoami.permissions.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 grid gap-1 font-mono text-[0.6875rem] break-all">
                  {whoami.permissions.map((permission) => (
                    <li key={permission}>{permission}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
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
