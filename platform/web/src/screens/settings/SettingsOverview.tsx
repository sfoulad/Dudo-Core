/**
 * The settings index: what Organization administration will cover, and how much
 * of it exists.
 *
 * ===========================================================================
 * THE COUNT IS DERIVED, AND THAT IS THE POINT OF SHOWING IT AT ALL
 * ===========================================================================
 *
 * *"None of these sections is built yet"* is a sentence about the software,
 * shown to a customer, and it is the kind of sentence that rots the moment it
 * is typed. So it is not typed: `builtSectionCount()` filters the registry that
 * the navigation and the route tree already read, and the plural form is chosen
 * by `Intl.PluralRules`.
 *
 * **The day a section flips to `built: true`, this paragraph changes with it
 * and nobody has to remember.** `workflow.md` §12 — *a symbol whose VALUE moves
 * is caught by nobody* — is exactly what a hand-written "0 of 11" would have
 * been, and the direction it would rot in is the reassuring one.
 *
 * ===========================================================================
 * WHY THE INDEX LISTS THE SECTIONS AGAIN WHEN THE NAVIGATION ALREADY DOES
 * ===========================================================================
 *
 * The navigation carries a two-word label. **This carries the purpose**, which
 * is the thing a person arriving at an unfamiliar settings area actually needs:
 * *"Businesses"* does not tell anyone that branches live there. It is the same
 * data, rendered for a different question, from one source.
 */

import { Link } from '@tanstack/react-router';
import { Panel } from '@dudo/ui';
import { DATA_SECTIONS, builtSectionCount, findSection } from '@/lib/settings-sections';
import { fill, formatCount, useLocale } from '@/lib/i18n';

/**
 * The six plural forms for the built-section count.
 *
 * **Declared as a complete `Record<PluralCategory, MessageKey>`**, so a form
 * cannot be omitted — `Intl.PluralRules` returns one of six categories and a
 * partial map would resolve to `undefined` for whichever one nobody thought
 * of. English reaches only `one` and `other`; Arabic reaches all six through
 * ordinary counts, which is measured rather than assumed in `lib/i18n.tsx`.
 */
const BUILT_FORMS = {
  zero: 'settings.overview.built.zero',
  one: 'settings.overview.built.one',
  two: 'settings.overview.built.two',
  few: 'settings.overview.built.few',
  many: 'settings.overview.built.many',
  other: 'settings.overview.built.other',
} as const;

export function SettingsOverview() {
  const { locale, t } = useLocale();
  const overview = findSection('overview');

  const built = builtSectionCount();
  const total = DATA_SECTIONS.length;

  return (
    <section aria-labelledby="settings-overview" className="w-full max-w-3xl">
      <h1 id="settings-overview" className="text-xl font-bold text-ink sm:text-2xl">
        {t(overview.titleKey)}
      </h1>
      <p className="mt-3 max-w-prose leading-relaxed text-ink-soft">{t(overview.purposeKey)}</p>

      {/*
        THE HONESTY PARAGRAPH, AND IT IS `role="status"` RATHER THAN PLAIN
        PROSE. A reader using a screen reader arrives at a page of eleven links
        and needs to be told, early, that none of them shows data yet — before
        they navigate through all eleven finding out one at a time.
      */}
      <div
        role="status"
        className="mt-5 rounded-xl border border-line bg-sunk/60 p-5 text-[0.9375rem] leading-relaxed text-ink-soft sm:p-6"
      >
        <p>{t('settings.overview.intro')}</p>
        <p className="mt-3 font-semibold text-ink">
          {formatCount(locale, built, BUILT_FORMS, t)}{' '}
          {fill(t('settings.overview.total'), locale, { total })}
        </p>
      </div>

      <ul className="mt-6 grid list-none gap-3 p-0">
        {/*
          `DATA_SECTIONS` RATHER THAN `SECTIONS`. The index does not list
          itself, and filtering on the presence of a contract record is what
          makes that true by construction rather than by an id comparison that
          a rename would break.
        */}
        {DATA_SECTIONS.map((section) => (
          <li key={section.id}>
            <Panel className="transition-colors hover:bg-navy-50/40">
              <Link
                to={section.path}
                className="block p-4 no-underline sm:p-5"
              >
                <span className="block font-semibold text-ink">{t(section.titleKey)}</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-muted">
                  {t(section.purposeKey)}
                </span>
                {/*
                  THE STATUS IS SHOWN ON THE INDEX, NOT ONLY INSIDE THE SECTION.
                  Someone deciding whether to open eleven pages should be able
                  to see from here which ones can possibly hold anything —
                  otherwise the index invites eleven round trips to learn what
                  one screen could have said.
                */}
                <span className="mt-2 block text-xs text-ink-faint">
                  {t(section.data.contractStatusKey)}
                </span>
              </Link>
            </Panel>
          </li>
        ))}
      </ul>

      {/*
        ⚠ NO POPULATION FIGURE IS RENDERED HERE, AND THE FIRST DRAFT OF THIS
        SCREEN RENDERED ONE.

        `workflow.md` §11a asks a check to state what it examined, so that "the
        list is empty" and "the list is short" cannot look alike. **That is a
        rule about CHECKS, and this is a customer's screen.** A bare "11 · 10"
        in the corner of a settings page is noise to the person reading it and
        would be reported as a defect — the reader is not the audience for a
        floor.

        The floor exists, in `scripts/verify-settings.mjs`, where it asserts the
        registry's population against the navigation and the route tree. **That
        is the right place: a check can go red, and a paragraph cannot.**
      */}
    </section>
  );
}
