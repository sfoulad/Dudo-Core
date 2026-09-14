/**
 * The honest empty state: a section that exists, works, and is connected to
 * nothing.
 *
 * ===========================================================================
 * WHY THERE IS NO SAMPLE DATA ANYWHERE ON THIS SURFACE
 * ===========================================================================
 *
 * ADR 0010's adoption audit removed *"`@faker-js/faker`, demo users, fake APIs,
 * placeholder data"* from the other console and gave the reason in one
 * sentence:
 *
 *   *"Dudo shows Core-backed truth only. FABRICATED DATA IN AN ADMIN CONSOLE IS
 *    WORSE THAN NO DATA — an operator cannot tell it from real."*
 *
 * **It is worse again here, because the reader is the customer.** A sample
 * table of three members looks exactly like a working screen; someone seeing it
 * has no way to know whether those people can actually sign in to their
 * company, and the first thing they would try is removing one.
 *
 * **IT NAMES THE CONTRACT AND ITS STATUS RATHER THAN SAYING "COMING SOON".** A
 * reviewer looking at a deployed test build can then tell whether a section is
 * blank because it is unbuilt, because a contract is unratified, or because
 * Dudo genuinely returned nothing — **three different situations that "coming
 * soon" collapses into one.**
 *
 * **WHEN A SECTION IS BUILT, THIS COMPONENT IS NOT ADAPTED INTO ITS EMPTY
 * STATE.** A real screen's empty state means *"Dudo answered and there is
 * nothing here"*, which is a completely different statement from *"this is not
 * built"*. Reusing one for the other is how a broken screen comes to look
 * merely quiet — see `SettingsState.tsx`, which keeps them apart deliberately.
 *
 * ===========================================================================
 * EVERY STRING ARRIVES AS A PROP, AND THAT IS ABOUT WHERE THIS FILE MAY GO
 * ===========================================================================
 *
 * `platform/admin` has a component of this name that calls `useT()` and reads
 * its own host dictionary. **This one takes resolved strings, so it imports
 * nothing from `@/lib` and nothing from `@/api`.**
 *
 * The reason is `0040` and `@dudo/ui`'s one rule: **a component that reaches
 * into a host's dictionary is coupled to that host and cannot be shared.**
 * Written this way, moving it into `@dudo/ui` — so that the two consoles stop
 * carrying two of these — is a RELOCATION rather than a rewrite. **That move is
 * the Team Lead's to make (`packages/**` is not mine) and is flagged rather
 * than assumed.** Until then the duplication is real, and it is recorded here
 * instead of being discovered by whoever changes one copy.
 */

import type { ReactNode } from 'react';

/** The fixed chrome, supplied by the caller so this file holds no dictionary. */
export interface NotBuiltYetLabels {
  readonly badge: string;
  readonly nothing: string;
  readonly noRequest: string;
  readonly contract: string;
  readonly status: string;
  readonly waitingOn: string;
  readonly noneDrafted: string;
}

export interface NotBuiltYetProps {
  readonly title: string;
  /** What this section will do, in the words of the contract that defines it. */
  readonly purpose: ReactNode;
  /**
   * A repository PATH, or `null` where none has been drafted at all.
   *
   * A path rather than a bare contract name, because `architecture.md` §3c's
   * remedy for a claim about a contract is *open the file* — and a name is not
   * something a reviewer can open.
   */
  readonly contract: string | null;
  readonly contractStatus: string;
  /** What has to happen before this section can be built. One item per line. */
  readonly blockedOn: readonly string[];
  readonly labels: NotBuiltYetLabels;
  /** The id of the heading this section is labelled by, supplied by the screen. */
  readonly headingId: string;
}

export function NotBuiltYet({
  title,
  purpose,
  contract,
  contractStatus,
  blockedOn,
  labels,
  headingId,
}: NotBuiltYetProps) {
  return (
    <section aria-labelledby={headingId} className="w-full max-w-3xl">
      <h1 id={headingId} className="text-xl font-bold text-ink sm:text-2xl">
        {title}
      </h1>

      {/*
        The dashed border and the sunk background are doing real work. A solid
        card with a heading and rows is the visual grammar of DATA; a dashed
        outline around a sentence is the grammar of ABSENCE. Someone scanning a
        screenshot should be able to tell the two apart without reading.
      */}
      <div className="mt-5 rounded-xl border-2 border-dashed border-line-strong bg-sunk/60 p-6 sm:p-8">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-ink-faint">
          {labels.badge}
        </p>
        <p className="mt-3 leading-relaxed text-ink-soft">{purpose}</p>

        <p className="mt-4 leading-relaxed text-ink">
          <span className="font-semibold">{labels.nothing}</span> {labels.noRequest}
        </p>

        <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold text-ink-soft">{labels.contract}</dt>
          <dd className="min-w-0 text-ink-muted">
            {contract === null ? (
              labels.noneDrafted
            ) : (
              /*
               * ===========================================================
               * ⚠ `<bdi>` ALONE WAS NOT ENOUGH, AND THE DEFECT WAS LIVE
               * ===========================================================
               *
               * Measured in a real browser at 834px in Arabic: the path
               * wrapped to two lines and **the two lines shared a RIGHT
               * edge**. Line one ran 64→494, line two 392→494. A reader's
               * eye returned to the start of line two and landed on 300px
               * of whitespace; the filename read as two disconnected
               * fragments.
               *
               * **`unicode-bidi: isolate` fixes the ORDER of this run
               * against the surrounding Arabic. It does nothing about the
               * ALIGNMENT of its wrapped lines, because alignment belongs
               * to the block container** — and the container is `<dd>`,
               * which is `direction: rtl; text-align: start`, and `start`
               * in RTL means right.
               *
               * So `dir="ltr"` goes HERE and not on the `<dd>`: the `<dd>`
               * also renders `labels.noneDrafted`, which is TRANSLATED
               * PROSE and must stay right-aligned in Arabic. Fixing the
               * container would have mis-aligned the other branch.
               *
               * `block` is what gives this element its own block
               * formatting, so `text-align: start` resolves against ITS
               * direction rather than the paragraph's. No physical
               * utility is used — `text-start` under `dir="ltr"` IS left,
               * which is why `verify-css.mjs` stays green.
               *
               * ===========================================================
               * NEITHER VIEWPORT NOR LANGUAGE ALONE COULD FIND THIS
               * ===========================================================
               *
               *   1512 + Arabic   one line          INVISIBLE
               *    834 + Arabic   two lines, wrong  VISIBLE
               *    834 + English  no RTL container  INVISIBLE
               *
               * **It exists only in the intersection.** That is the whole
               * argument for rendering at both widths in both languages,
               * and it is not an argument anyone could have made from
               * reading source.
               *
               * `[overflow-wrap:anywhere]` rather than `break-all`, which
               * was splitting the filename at a period — a path breaks
               * more readably at any point than mid-token.
               */
              <bdi
                dir="ltr"
                className="block text-start font-mono text-[0.8125rem] [overflow-wrap:anywhere]"
              >
                {contract}
              </bdi>
            )}
          </dd>

          <dt className="font-semibold text-ink-soft">{labels.status}</dt>
          <dd className="text-ink-muted">{contractStatus}</dd>

          <dt className="font-semibold text-ink-soft">{labels.waitingOn}</dt>
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
