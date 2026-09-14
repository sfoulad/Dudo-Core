/**
 * The settings frame: section navigation beside the section itself.
 *
 * ===========================================================================
 * IT SITS INSIDE `AppShell`, NOT BESIDE IT
 * ===========================================================================
 *
 * `/settings` is a section of `app.dudo.work`, not a second console — `0035`
 * puts Organization administration at a PATH under the application a member is
 * already signed in to. So this renders inside the existing `<main>`, behind
 * `AuthGate` and `OrganizationGate`, and supplies only the navigation between
 * the eleven sections. **The header, the language control, the sign-out
 * control, the transport badge and the skip link are `AppShell`'s and are not
 * repeated here** — a second header inside the first is how a settings area
 * comes to feel like a different product.
 *
 * ===========================================================================
 * RESPONSIVE, AND THE BREAKPOINT IS WHERE THE CONTENT NEEDS IT
 * ===========================================================================
 *
 *   - `md` AND WIDER (iPad portrait upward) — two columns, navigation in the
 *     inline-start one, always present. **The toggle is not rendered at all.**
 *   - BELOW `md` (phones) — one column. The navigation collapses behind a
 *     button, `Escape` closes it, focus moves in on open and back to the button
 *     on close, and choosing a section closes it.
 *
 * **`md` rather than `lg`, chosen against the content rather than a device
 * name.** At 768 px the frame has ~720 px of content: a 13 rem rail leaves
 * ~450 px for a section, which is enough for the prose these sections are made
 * of. Waiting for `lg` would give an iPad in portrait the phone layout, which
 * is the most common tablet orientation for reading.
 *
 * ===========================================================================
 * ⚠ IT EXPANDS IN FLOW. IT IS NOT AN OVERLAY, AND THAT IS DELIBERATE
 * ===========================================================================
 *
 * `platform/admin`'s drawer is an overlay, and it **shipped broken with the
 * sidebar invisible on desktop**: a direction-variant transform parked it
 * off-screen and the breakpoint rule meant to cancel that never won, because
 * Tailwind wraps direction variants in `:where()` — equal specificity, later
 * rule wins, at every width including 1600 px.
 *
 * **This layout has no transform, no fixed positioning and no direction
 * variant, so there is no specificity contest to lose.** Below `md` the
 * navigation is either in the document or `display: none`; at `md` it is always
 * in the document. **The whole hazard is designed out rather than guarded
 * against**, which is worth more than a comment warning the next author.
 *
 * ===========================================================================
 * RTL
 * ===========================================================================
 *
 * Logical properties throughout — `ps`/`pe`, `ms`/`me`, `border-s`, `text-start`
 * — and no physical inline-axis utility anywhere. **A CSS grid's columns are
 * laid out on the INLINE axis**, so `dir="rtl"` on `<html>` moves the rail to
 * the other edge with no rule of its own. That is why the two-column layout
 * needs no direction variant and the overlay version did.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { cn } from '@dudo/ui';
import { SECTIONS } from '@/lib/settings-sections';
import { useLocale } from '@/lib/i18n';

export function SettingsShell({
  currentPath,
  children,
}: {
  currentPath: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const navId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  /*
   * ONE CLOSE PATH, AND IT RETURNS FOCUS.
   *
   * Every way of closing — `Escape`, the toggle itself, choosing a section —
   * goes through here. **Three call sites with their own `setOpen(false)` is
   * three places to forget the focus return**, and a focus return that is
   * merely usually performed is the defect that reads as working: the reader
   * lands back at the top of the document with no announcement, which looks
   * like nothing happening.
   */
  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  /*
   * `Escape` closes it. **Bound only while it is open**, so nothing listens on
   * the common path and nothing competes with a section's own key handling.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  /*
   * Focus moves into the list on open, so a keyboard or screen-reader user is
   * not left standing behind the button they just pressed with the new content
   * announced nowhere.
   */
  useEffect(() => {
    if (open) navRef.current?.querySelector('a')?.focus();
  }, [open]);

  return (
    <div className="md:grid md:grid-cols-[13rem_1fr] md:gap-6 lg:grid-cols-[15rem_1fr] lg:gap-8">
      <div className="md:contents">
        {/*
          THE TOGGLE DOES NOT EXIST AT `md` AND WIDER. `display: none` also
          removes it from the tab order, so a desktop reader never tabs through
          a control for a state their layout cannot be in.
        */}
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => {
            if (open) close();
            else setOpen(true);
          }}
          className="mb-4 flex w-full items-center justify-between gap-3 rounded-[9px] border border-line bg-surface px-4 py-3 text-start text-[0.9375rem] font-semibold text-ink md:hidden"
        >
          <span>
            {t('settings.title')}
            <span className="ms-2 font-normal text-ink-muted">{t('settings.nav.menu')}</span>
          </span>
          <ChevronIcon open={open} />
        </button>

        <nav
          ref={navRef}
          id={navId}
          aria-label={t('settings.nav.label')}
          className={cn(
            'mb-6 md:mb-0',
            // Below `md` the list is present only while expanded. No transform,
            // no positioning, nothing for a direction variant to fight.
            open ? '' : 'max-md:hidden',
            // At `md` and wider it is a sticky rail. `top` clears the
            // application header, which is `sticky top-0` and 3.5rem tall.
            'md:sticky md:top-[4.5rem] md:self-start',
          )}
        >
          <ul className="grid list-none gap-0.5 p-0">
            {SECTIONS.map((section) => {
              /*
               * EXACT MATCH, NOT PREFIX. TanStack's `Link` can manage
               * `aria-current` itself and its default notion of active is
               * prefix-based — which would mark the Overview (`/settings`)
               * current on every one of the other ten.
               */
              const active = currentPath === section.path;
              return (
                <li key={section.id}>
                  <Link
                    to={section.path}
                    /*
                     * ⚠ `exact` IS NOT AN OPTIMISATION. WITHOUT IT THIS MENU
                     * ANNOUNCES TWO CURRENT PAGES, AND IT WAS SHIPPING THAT WAY
                     * UNTIL A BROWSER RENDERED IT.
                     *
                     * `Link` sets `aria-current="page"` ITSELF whenever it
                     * considers the route active, and its default notion of
                     * active is PREFIX-BASED. `/settings` is a prefix of
                     * `/settings/members`, so on any child section the Overview
                     * link was marked current as well as the real one — two of
                     * eleven, both announced as "current page".
                     *
                     * Setting `aria-current` by hand below did not prevent it:
                     * the router adds its own to a DIFFERENT element, so the
                     * explicit attribute is not in a position to win.
                     *
                     * **Nothing that reads source could have found this.** The
                     * attribute is correct here, the comparison is correct, and
                     * the second one is contributed by a library at render
                     * time. It took driving a real browser — and the check that
                     * should have caught it was mine, and it ran at `/settings`,
                     * the one address in the section where a prefix match and an
                     * exact match give the same answer.
                     */
                    activeOptions={{ exact: true }}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      // Only meaningful below `md`; harmless above, where the
                      // list is never in the collapsed state.
                      if (open) close();
                    }}
                    className={cn(
                      'block rounded-[7px] px-3 py-2 text-[0.9375rem] no-underline transition-colors',
                      active
                        ? 'bg-navy-50 font-semibold text-navy-800'
                        : 'text-ink-soft hover:bg-sunk hover:text-ink',
                    )}
                  >
                    {t(section.navKey)}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 border-t border-line pt-4">
            {/*
              A second way back to the application. The header wordmark is the
              first, and on a phone it is a 28-pixel target beside a language
              picker and a sign-out button — worth not being the only one.
            */}
            <Link
              to="/customers"
              search={{}}
              className="block rounded-[7px] px-3 py-2 text-sm text-ink-muted no-underline transition-colors hover:bg-sunk hover:text-ink"
            >
              {t('settings.backToApp')}
            </Link>
          </div>
        </nav>
      </div>

      {/*
        `min-w-0` IS LOAD-BEARING IN A GRID. Without it a long unbroken string —
        a contract path, a request id — makes the content column refuse to
        shrink and the whole layout overflows horizontally, which on a phone
        reads as a broken page rather than as a long word.
      */}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
