/**
 * The language control.
 *
 * ===========================================================================
 * IT LIVES IN `AppShell`, WHICH IS OUTSIDE BOTH GATES — AND THAT PLACEMENT IS
 * A FINDING FROM THE OTHER CONSOLE RATHER THAN A PREFERENCE
 * ===========================================================================
 *
 * On `admin.dudo.work` this control was inside the authenticated shell, so an
 * operator who was not signed in could not change the language — **and the
 * sign-in screen is the first thing anyone sees.** An Arabic-reading person met
 * an English page with no way out of it, which is the failure the whole
 * translation exists to prevent, in the one place it is most visible.
 *
 * **Nothing that reads source caught it.** The switcher existed, the dictionary
 * was complete, the provider was mounted at the root and every check passed. It
 * took driving a real browser at a URL with no Core behind it.
 *
 * So here it is mounted in `AppShell`, which wraps `AuthGate` and
 * `OrganizationGate` rather than sitting inside them. **Every state this
 * application can be in — signing in, probing a session, choosing an
 * Organization, no memberships at all, and the ordinary signed-in case — is
 * rendered underneath it.** The "no memberships" state matters most: it tells
 * someone their access has been removed, and telling them that in a language
 * they do not read is the worst version of it.
 *
 * ⚠ **THE SCREENS BEHIND IT ARE NOT ALL TRANSLATED YET.** `lib/i18n.tsx`'s
 * header records which are and which are not. Switching to Arabic on the
 * Customer Directory produces right-aligned English, deliberately — this
 * control is reachable everywhere, and what it reaches is honest about how far
 * the translation has got.
 *
 * ===========================================================================
 * A NATIVE `<select>`, DELIBERATELY
 * ===========================================================================
 *
 * Keyboard-operable, announced with its own label, and it opens the platform's
 * own picker on a tablet — the three things a custom dropdown has to rebuild
 * and usually rebuilds incompletely. `0016` makes the same argument for the
 * rest of this application's inputs.
 *
 * **The option labels are each in their OWN language in both dictionaries.**
 */

import { cn } from '@dudo/ui';
import { LOCALES, LOCALE_LABEL_KEYS, isLocale, useLocale } from '@/lib/i18n';

export function LocaleSwitch({ tone = 'default' }: { tone?: 'default' | 'onNavy' }) {
  const { t, locale, setLocale } = useLocale();

  return (
    <label
      className={cn(
        'flex items-center gap-2 text-xs',
        tone === 'onNavy' ? 'text-[#b9c0dd]' : 'text-ink-muted',
      )}
    >
      {/*
        THE LABEL IS PRESENT FOR ASSISTIVE TECHNOLOGY AND HIDDEN VISUALLY. A
        `<select>` showing two obvious language names does not need a visible
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
            `<select>` is a `string`, and `next === 'en' || next === 'ar'` would
            be a second list of the languages that exist — one a third language
            would silently fail to join.
          */
          const next = event.target.value;
          if (isLocale(next)) setLocale(next);
        }}
        className={cn(
          'rounded-[7px] border px-2 py-1',
          tone === 'onNavy'
            ? 'border-white/30 bg-navy-800 text-white'
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
