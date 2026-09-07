/**
 * The honest empty state.
 *
 * ===========================================================================
 * THIS IS WHAT ADR 0010 BOUGHT BY DELETING THE TEMPLATE'S DEMO DATA
 * ===========================================================================
 *
 * The adoption audit removed "`@faker-js/faker`, demo users, fake APIs,
 * placeholder data" and gave the reason in one sentence:
 *
 *   "Dudo shows Core-backed truth only. FABRICATED DATA IN AN ADMIN CONSOLE IS
 *    WORSE THAN NO DATA — an operator cannot tell it from real."
 *
 * A sample table here would look exactly like a working screen. An operator
 * seeing three plausible Organizations has no way to know whether they exist,
 * and the first thing they would try is an action against one of them. So each
 * section says what it will do, what it is waiting for, and that there is
 * nothing to show — and it says it in a way nobody could mistake for data.
 *
 * IT NAMES THE CONTRACT AND ITS STATUS RATHER THAN SAYING "COMING SOON". A
 * reviewer looking at a deployed test build can then tell whether the screen is
 * blank because it is unbuilt, because a contract is unratified, or because Core
 * genuinely returned nothing — and those are three different situations that
 * "coming soon" collapses into one.
 *
 * WHEN A SECTION IS BUILT, THIS COMPONENT IS NOT ADAPTED INTO ITS EMPTY STATE.
 * A real screen's empty state means "Core answered and there is nothing here",
 * which is a completely different statement from "this is not built". Reusing
 * one for the other is how a broken screen comes to look merely quiet.
 */

import type { ReactNode } from 'react';

export interface NotBuiltYetProps {
  readonly title: string;
  /** What this section will do, in the words of the contract that defines it. */
  readonly purpose: ReactNode;
  /** The contract path, or null where none has been drafted at all. */
  readonly contract: string | null;
  /** `proposed`, `accepted`, or a plain statement that none exists. */
  readonly contractStatus: string;
  /** What has to happen before this section can be built. One item per line. */
  readonly blockedOn: readonly string[];
}

export function NotBuiltYet({
  title,
  purpose,
  contract,
  contractStatus,
  blockedOn,
}: NotBuiltYetProps) {
  return (
    <section aria-labelledby="section-heading" className="mx-auto w-full max-w-3xl">
      <h1 id="section-heading" className="text-xl font-bold text-ink sm:text-2xl">
        {title}
      </h1>

      {/*
        The dashed border and the plain background are doing real work. A solid
        card with a heading and rows is the visual grammar of DATA; a dashed
        outline around a sentence is the grammar of ABSENCE. Someone scanning a
        screenshot should be able to tell the two apart without reading.
      */}
      <div className="mt-5 rounded-[12px] border-2 border-dashed border-line-strong bg-sunk/60 p-6 sm:p-8">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-ink-faint">
          Not built yet
        </p>
        <p className="mt-3 leading-relaxed text-ink-soft">{purpose}</p>

        <p className="mt-4 leading-relaxed text-ink">
          <span className="font-semibold">There is nothing to show here.</span> This section makes
          no request to Core and displays no data — real or otherwise.
        </p>

        <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-line pt-5 text-[0.875rem] sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold text-ink-soft">Contract</dt>
          <dd className="min-w-0 text-ink-muted">
            {contract === null ? (
              'None drafted.'
            ) : (
              <code className="font-mono text-[0.8125rem] break-all">{contract}</code>
            )}
          </dd>

          <dt className="font-semibold text-ink-soft">Status</dt>
          <dd className="text-ink-muted">{contractStatus}</dd>

          <dt className="font-semibold text-ink-soft">Waiting on</dt>
          <dd className="text-ink-muted">
            <ul className="grid list-disc gap-1 ps-4">
              {blockedOn.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </div>
    </section>
  );
}
