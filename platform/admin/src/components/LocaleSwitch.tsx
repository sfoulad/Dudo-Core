/**
 * The language control.
 *
 * ===========================================================================
 * IT LIVES OUTSIDE THE AUTHENTICATED SHELL, AND THE BROWSER HARNESS IS WHAT
 * FOUND THAT IT HAD TO
 * ===========================================================================
 *
 * This was inside `AdminShell`, which renders only in the `operator` session
 * state. **So an operator who was not signed in could not change the language**
 * — and the sign-in screen is the FIRST thing anyone sees. An Arabic-reading
 * operator met an English page with no way out of it, which is the failure the
 * whole translation exists to prevent, in the one place it is most visible.
 *
 * **Nothing that reads source could have caught it.** The switcher existed, the
 * dictionary was complete, the provider was mounted at the root and every check
 * passed. It took driving a real browser at `/` with no Core behind it — where
 * the session gate renders rather than the shell — to produce `no-select`.
 *
 * **The four session states are `anonymous`, `unknown`, `refused` and
 * `operator`, and the language control belongs to all four.** `refused` in
 * particular is an operator being told they hold no platform authority; telling
 * them that in a language they do not read is the worst version of it.
 *
 * ===========================================================================
 * A NATIVE `<select>`, DELIBERATELY
 * ===========================================================================
 *
 * Keyboard-operable, announced with its own label, and it opens the platform's
 * own picker on a tablet — the three things a custom dropdown has to rebuild
 * and usually rebuilds incompletely. `0016` makes the same argument for the
 * rest of this console's inputs.
 *
 * **The option labels are each in their OWN language in both dictionaries** —
 * "English" and "العربية". A picker that says "Arabic" in English is unusable
 * by the person most likely to need it, and one that says "الإنجليزية" is the
 * mirror of that mistake.
 */

import { LOCALES, LOCALE_LABEL_KEYS, isLocale, useLocale } from '@/lib/i18n';
import { cn } from '@dudo/ui';

export function LocaleSwitch({ tone = 'default' }: { tone?: 'default' | 'onNavy' }) {
  const { t, locale, setLocale } = useLocale();

  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[0.75rem]',
        tone === 'onNavy' ? 'text-navy-100' : 'text-ink-muted',
      )}
    >
      {/*
        THE LABEL IS PRESENT FOR ASSISTIVE TECHNOLOGY AND HIDDEN VISUALLY. A
        `<select>` with two obvious language names does not need a visible
        caption taking header space, but an unlabelled control is announced as
        just "combo box" — which tells a screen-reader user nothing about what
        it changes.
      */}
      <span className="sr-only">{t('locale.label')}</span>
      <select
        value={locale}
        onChange={(event) => {
          /*
            `isLocale` RATHER THAN A HAND-WRITTEN COMPARISON. The value off a
            `<select>` is a `string`, and `next === 'en' || next === 'ar'` was a
            second list of the languages that exist — one a third language would
            silently fail to join.
          */
          const next = event.target.value;
          if (isLocale(next)) setLocale(next);
        }}
        className={cn(
          'rounded-[7px] border px-2 py-1',
          tone === 'onNavy'
            ? 'border-navy-600 bg-navy-800 text-white'
            : 'border-line bg-surface text-ink',
        )}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} className="text-ink">
            {t(LOCALE_LABEL_KEYS[code])}
          </option>
        ))}
      </select>
    </label>
  );
}
