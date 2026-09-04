/**
 * The application shell: the bar that carries the Dudo identity, the busy
 * indicator, the region screens render into, and the footer that says plainly
 * what this build is.
 */

import type { ReactNode } from 'react';
import { Toaster } from './Toaster';

export function AppShell({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="absolute start-4 top-[-4rem] z-100 rounded-[7px] bg-surface px-4 py-3 font-semibold text-navy-800 shadow-[var(--shadow-float)] transition-[top] focus:top-3"
      >
        Skip to main content
      </a>

      <header className="on-navy sticky top-0 z-20 bg-navy-800 text-white">
        <div className="mx-auto flex min-h-14 max-w-[1180px] items-center gap-4 px-4 py-2">
          <a href="#/customers" className="flex items-center gap-3 rounded-[7px] text-inherit no-underline">
            <img src="/dudo-mark.svg" alt="" width={28} height={28} className="size-7 shrink-0" />
            <span className="font-serif text-lg leading-none tracking-[0.01em]">Dudo</span>
            <span className="ms-1 hidden border-s border-white/20 ps-3 text-[0.8125rem] tracking-[0.02em] text-[#b9c0dd] sm:inline">
              Customers
            </span>
          </a>
          <div className="grow" />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#b9c0dd]">
            <span aria-hidden="true" className="size-2 rounded-full bg-gold-500" />
            Fixture data
          </span>
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
          <span>Dudo — Customer Directory</span>
          <span>Contract customer-directory-v1</span>
          <span>Local fixture build. No server, no network calls, synthetic data only.</span>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
