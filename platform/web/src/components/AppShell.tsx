/**
 * The application shell: the bar that carries the Dudo identity, the busy
 * indicator, the region screens render into, and the footer that says plainly
 * what this build is.
 */

import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Toaster } from '@dudo/ui';
import { transportBadge } from '@/api/config';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { useT } from '@/lib/i18n';

/**
 * Which part of the application the frame is wrapping.
 *
 * **A CLOSED UNION RATHER THAN A STRING**, so a third area cannot be added
 * without every `switch` over this failing to compile. The header chip and the
 * footer both name the section, and a `string` here would let one of them fall
 * back silently to the Customers wording on a page that is not Customers —
 * which is what this type exists to prevent.
 */
export type AppSection = 'customers' | 'settings';

export function AppShell({
  busy,
  children,
  section,
  signedIn,
  signingOut,
  onSignOut,
}: {
  busy: boolean;
  children: ReactNode;
  section: AppSection;
  /** Whether to offer the sign-out control at all. */
  signedIn: boolean;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const t = useT();
  /*
   * THE BADGE MUST TELL THE TRUTH IN BOTH DIRECTIONS. It said "Fixture data"
   * unconditionally while the fixture transport was the only one; now that a
   * real one exists, a hardcoded label would mean a live build carrying a
   * screenshot that says it is a demonstration, or the reverse. Whether a
   * screen is showing a tenant's real records is not something a reviewer
   * should have to check the build flags to find out.
   */
  const badge = transportBadge();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="absolute start-4 top-[-4rem] z-100 rounded-[7px] bg-surface px-4 py-3 font-semibold text-navy-800 shadow-[var(--shadow-float)] transition-[top] focus:top-3"
      >
        {t('app.skipToContent')}
      </a>

      <header className="on-navy sticky top-0 z-20 bg-navy-800 text-white">
        {/*
          ⚠ `flex-wrap` AND A NARROWER GAP, BECAUSE THIS ROW OVERFLOWED THE
          PHONE VIEWPORT BY 30 PIXELS AND THE SIGN-OUT BUTTON WAS PARTLY
          OFF-SCREEN.

          Measured at a true 390: wordmark 85 · transport badge 97 · language
          control 79 · sign-out 78 = 339, plus three 16px gaps and 32px of
          padding = 419. The row cannot fit and `flex` does not wrap by default,
          so the last child simply hung off the edge — **the inline-start edge
          in Arabic and the inline-end edge in English**, which is why it read
          as a direction bug and is not one.

          **It is the sign-out control, which is what someone reaches for when
          something has gone wrong.** So the row wraps rather than anything
          being hidden: every control stays reachable and the header grows a
          line at the width where it must.

          **NOT SOLVED BY HIDING THE TRANSPORT BADGE BELOW `sm`.** That badge is
          the only thing on screen that says whether a reader is looking at real
          data, and a phone is not a less important place to know it.
        */}
        <div className="mx-auto flex min-h-14 max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-4">
          {/*
            A ROUTER LINK, NOT AN ANCHOR. It was `href="#/customers"`, which was
            correct under hash history and became a dead link the moment `0036`'s
            amendment switched to path routing — it would have appended a
            fragment to whatever path you were already on. Nothing in the browser
            smoke check clicked the wordmark, so this was found by grepping for
            the old shape rather than by testing.
          */}
          <Link
            to="/customers"
            search={{}}
            className="flex items-center gap-3 rounded-[7px] text-inherit no-underline"
          >
            {/* Decorative: the "Dudo" wordmark beside it carries the name, so `alt` is
                empty. The mark ships with its own navy field, which matches the header
                — the rounding is what keeps it reading as an icon rather than a patch. */}
            <img
              src="/dudo-mark.png"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-[6px]"
            />
            {/*
              "Dudo" IS A BRAND NAME AND IS NOT TRANSLATED — it is the product's
              name in both languages, and it is isolated so an RTL header cannot
              reorder it against the words beside it.
            */}
            <bdi className="font-serif text-lg leading-none tracking-[0.01em]">Dudo</bdi>
            {/*
              THE SECTION CHIP SAID "Customers" UNCONDITIONALLY. With `/settings`
              in the tree that is a header naming the wrong part of the
              application on eleven screens — and the kind of thing nobody
              reports, because a header is furniture. It is a prop now, typed to
              a closed union so a third section cannot be added without this
              line failing to compile.
            */}
            <span className="ms-1 hidden border-s border-white/20 ps-3 text-[0.8125rem] tracking-[0.02em] text-[#b9c0dd] sm:inline">
              {section === 'settings' ? t('app.section.settings') : t('app.section.customers')}
            </span>
          </Link>
          <div className="grow" />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#b9c0dd]">
            <span
              aria-hidden="true"
              // In-palette on both branches. The dot is decoration — the label
              // carries the meaning, which is why it is `aria-hidden`.
              className={badge.live ? 'size-2 rounded-full bg-green-500' : 'size-2 rounded-full bg-gold-500'}
            />
            {t(badge.labelKey)}
          </span>

          {/*
            THE LANGUAGE CONTROL SITS HERE, OUTSIDE BOTH GATES, AND THAT IS A
            FINDING FROM `platform/admin` RATHER THAN A LAYOUT PREFERENCE. There
            it lived inside the authenticated shell, so nobody could change the
            language until after signing in — and the sign-in screen is the
            first page anyone sees. `components/LocaleSwitch.tsx` carries the
            full account. `AppShell` wraps `AuthGate` and `OrganizationGate`, so
            every state this application has is rendered underneath this
            control.
          */}
          <LocaleSwitch tone="onNavy" />

          {/*
            Sign out. Offered only when signed in — a control that cannot do
            anything is worse than no control.

            IT ENDS THE SESSION SERVER-SIDE AND CANNOT CLEAR THE COOKIE
            (docs/decisions/0018 finding 1). The session row is deleted, so the
            credential stops resolving immediately, which is the property that
            matters; the dead cookie lingers in the browser until it expires.
            That is why the client treats a later 401 as signed out rather than
            as something to retry.
          */}
          {signedIn ? (
            <Button
              variant="ghost"
              size="sm"
              busy={signingOut}
              disabled={signingOut}
              onClick={onSignOut}
              className="text-[#b9c0dd] hover:not-disabled:bg-white/10 hover:not-disabled:text-white"
            >
              {signingOut ? t('app.signingOut') : t('app.signOut')}
            </Button>
          ) : null}
        </div>
      </header>

      {/* Route-change progress. Sticky under the bar so it never shifts layout. */}
      <div className="sticky top-14 z-19 h-0.5 overflow-hidden">
        {busy ? <span className="block h-full w-2/5 animate-[dudo-progress_900ms_ease-in-out_infinite] bg-scarlet-500" /> : null}
      </div>

      <main
        id="main"
        tabIndex={-1}
        aria-busy={busy}
        className="mx-auto w-full max-w-[1180px] grow px-4 pt-6 pb-16 focus:outline-none md:px-6 md:pt-8"
      >
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1180px] flex-wrap gap-x-4 gap-y-2 p-4 text-xs text-ink-muted">
          <span>
            <bdi>Dudo</bdi>
            {' — '}
            {section === 'settings' ? t('app.footer.settings') : t('app.footer.customers')}
          </span>
          {/*
            ⚠ THE CONTRACT LINE WAS UNCONDITIONAL AND SAID `customer-directory-v1`
            ON EVERY PAGE. On `/settings` that names a contract none of those
            eleven sections consumes — a footer asserting provenance the screen
            above it does not have, which is `architecture.md` §3c's defect
            rendered to a customer.

            The settings side says there is no published contract instead of
            rendering an empty span, because an empty span reads as a broken
            build rather than as an honest absence. A contract identifier is an
            identifier and is not translated; it is isolated for RTL.
          */}
          {section === 'settings' ? (
            <span>{t('app.footer.settingsContracts')}</span>
          ) : (
            <span>
              <bdi className="font-mono">customer-directory-v1</bdi>
            </span>
          )}
          <span>{badge.live ? t('app.footer.liveNote') : t('app.footer.fixtureNote')}</span>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
