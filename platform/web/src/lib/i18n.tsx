/**
 * English and Arabic for `app.dudo.work`, with the direction that follows.
 *
 * ===========================================================================
 * THIS IS A PORT OF `platform/admin/src/lib/i18n.tsx`, AND THE PORT IS THE
 * PATTERN — NOT THE DICTIONARY
 * ===========================================================================
 *
 * The Team Lead's instruction was explicit: *"Port the one you built for the
 * admin console rather than writing a second. Both consoles then share the
 * pattern; they do not share the dictionary, and they should not."*
 *
 * **Why the dictionary must NOT be shared, stated so nobody merges them later
 * as tidying.** These are two administrations with two audiences. The platform
 * console speaks to a Dudo operator about other people's Organizations; this
 * one speaks to a customer about their own. *"Organization"* is a third party
 * in one and the reader's own company in the other, and a shared string would
 * have to be vague enough to be true of both — which is how a console ends up
 * saying *"the Organization"* to someone who calls it *"us"*.
 *
 * **What IS shared is the mechanism**, and it is copied deliberately rather
 * than referenced: `Record<MessageKey, string>` so a missing translation does
 * not compile, `Intl` for every plural and every numeral, one `{name}`
 * substitution and no message-format compiler, `lang` and `dir` on `<html>`.
 *
 * ⚠ **SO THIS FILE AND THE ADMIN'S ARE TWO COPIES OF ONE PATTERN, AND THAT IS
 * THE DIVERGENCE `0040` EXISTS TO END — ONE LAYER DOWN.** It is recorded here
 * rather than hidden: **the MACHINERY below (`LocaleProvider`, `useLocale`,
 * `fill`, `formatCount`, `formatSeconds`, `directionOf`, `isLocale`) is
 * dictionary-independent and could move to a shared package.** It has not,
 * because `packages/**` is the Team Lead's and a client may not create one
 * (`architecture.md` §2, `security.md` §7). **It is flagged for the Team Lead
 * as a candidate, not decided here** — and until it moves, a fix applied to one
 * copy and not the other is a real hazard with nothing red behind it.
 *
 * ===========================================================================
 * WHY THIS IS FIRST-PARTY AND ZERO-DEPENDENCY, WHICH IS A CONSTRAINT RATHER
 * THAN A PREFERENCE
 * ===========================================================================
 *
 * ADR 0036 approved a named set of SIX libraries and **a seventh is a new user
 * approval, however small.** No agent may grant one (`security.md` §7, §8). So
 * an i18n package is not an option that was weighed and rejected — **it is not
 * available**, and this module is the only buildable path rather than a claim
 * that it is the better one.
 *
 * **WHAT THIS DELIBERATELY DOES NOT DO:** no pluralisation rules of its own
 * (Arabic has six categories and getting them wrong silently is worse than not
 * claiming them — `Intl.PluralRules` selects, this file only looks up), no date
 * or number formatting (`Intl` is in the platform), and no per-namespace lazy
 * loading.
 *
 * ===========================================================================
 * A MISSING TRANSLATION IS A BUILD FAILURE, NOT A FALLBACK
 * ===========================================================================
 *
 * `ar` is typed as `Record<keyof typeof en, string>`. **Adding an English key
 * without an Arabic one does not compile.** That is `architecture.md` §3a: the
 * obligation is a mechanism rather than something to remember.
 *
 * **THE FALLBACK IS WHAT WOULD HIDE THE WORK.** A reader switching to Arabic
 * and seeing English words scattered through the page cannot tell whether that
 * string is untranslated or is a proper noun.
 *
 * ===========================================================================
 * ⚠ WHAT THIS BUILD DOES **NOT** TRANSLATE, AND THE CONSEQUENCE IS VISIBLE
 * ===========================================================================
 *
 * **The Customer Directory screens — `CustomerList`, `CustomerDetail`,
 * `CustomerForm`, `Login`, `NotFound`, both gates — ARE NOT IN THIS
 * DICTIONARY.** Milestone 2's subject is `/settings`; translating the Customers
 * app is a larger job nobody has scoped, and pretending otherwise by adding
 * half its strings would be worse than leaving it whole.
 *
 * **`dir` GOES ON `<html>`, SO SWITCHING TO ARABIC FLIPS THOSE SCREENS TOO —
 * INTO RIGHT-ALIGNED ENGLISH.** That is a real, visible, deliberate state, and
 * it is the honest one. The alternative was scoping the provider to a `/settings`
 * wrapper, which produces a console that is RTL *except* in dialogs, popovers
 * and the scrollbar's own side — the places a reader notices most. **A wrapper
 * would have hidden the gap by making the flip partial; the document-level
 * attribute makes the untranslated half impossible to miss.** Same argument as
 * refusing an English fallback, one layer up.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ConfigMessageKey } from '@/api/config';

/* -------------------------------------------------------------------------
   The dictionaries
   ------------------------------------------------------------------------- */

/**
 * English is the SOURCE. Every key is declared here first and the Arabic
 * dictionary is type-checked against it.
 *
 * Keys are dotted and grouped by surface. **They are not sentences**, because a
 * key that is its own English text makes a missing translation invisible: the
 * lookup returns something readable and nobody notices.
 */
export const en = {
  /* --- The language control ------------------------------------------- */

  'locale.label': 'Language',
  /*
   * EACH LANGUAGE NAMED IN ITSELF, IN BOTH DICTIONARIES. A picker that says
   * "Arabic" in English is unusable by the person most likely to need it, and
   * one that says "الإنجليزية" is the mirror of that mistake. These two values
   * are therefore IDENTICAL in `en` and `ar`, on purpose — the only such pair
   * in the file.
   */
  'locale.en': 'English',
  'locale.ar': 'العربية',

  /* --- The application frame ------------------------------------------ */

  'app.skipToContent': 'Skip to main content',
  'app.section.customers': 'Customers',
  'app.section.settings': 'Settings',

  /*
   * THE BROWSER TAB, AND IT IS A STRING NO SOURCE SCAN CAN REACH.
   *
   * `index.html` carried `Customers · Dudo` — English in an Arabic session, and
   * naming the wrong section on eleven `/settings` addresses. **It was in no
   * check's population**, because every prose instrument in this repository
   * scans `.tsx` files and a `<title>` element is not one.
   *
   * "Dudo" stays Latin in both: it is the product's name, not a word.
   */
  'app.title.customers': 'Customers · Dudo',
  'app.title.settings': 'Settings · Dudo',
  'app.signOut': 'Sign out',
  'app.signingOut': 'Signing out…',

  /*
   * THE TRANSPORT BADGE. Blunt in both directions: a fixture build must never
   * be mistaken for a live one, and a live build must never be mistaken for a
   * demonstration. `api/config.ts` chooses which; this supplies the words.
   */
  'app.transport.live': 'Live API',
  'app.transport.fixture': 'Fixture data',

  'app.footer.customers': 'Customer Directory',
  'app.footer.settings': 'Organization administration',
  /*
   * THE SETTINGS FOOTER SAYS THERE IS NO CONTRACT, WHERE THE CUSTOMERS FOOTER
   * NAMES ONE. A contract identifier is not translated — it is an identifier —
   * so the Customers line renders `customer-directory-v1` verbatim and this
   * line exists because the settings surface has no equivalent to render.
   * Leaving the span empty would read as a rendering fault.
   */
  'app.footer.settingsContracts': 'No administration contract is published yet',
  'app.footer.liveNote':
    'Live build. Sessions last 12 hours and are not renewed; signing out revokes immediately.',
  'app.footer.fixtureNote': 'Local fixture build. No server, no network calls, synthetic data only.',

  /* --- The settings shell --------------------------------------------- */

  'settings.title': 'Settings',
  'settings.nav.label': 'Settings sections',
  'settings.nav.menu': 'Sections',
  'settings.backToApp': 'Back to Customers',

  /* --- The eleven sections -------------------------------------------- */

  'settings.overview.nav': 'Overview',
  'settings.overview.title': 'Organization settings',
  'settings.overview.purpose':
    'Where your Organization stands: who can reach it, what it is running, and what it has spent.',

  'settings.profile.nav': 'Profile',
  'settings.profile.title': 'Organization profile',
  'settings.profile.purpose':
    'Your legal name, registration and contact details — the record Dudo holds about your company, corrected by you rather than by a support request.',

  'settings.businesses.nav': 'Businesses',
  'settings.businesses.title': 'Businesses and branches',
  'settings.businesses.purpose':
    'The businesses inside your Organization and the branches under each, with the people and records that belong to them.',

  'settings.members.nav': 'Members',
  'settings.members.title': 'Members',
  'settings.members.purpose':
    'Everyone who can sign in to your Organization, what they may do, and how to remove someone who should no longer be here.',

  'settings.invitations.nav': 'Invitations',
  'settings.invitations.title': 'Invitations',
  'settings.invitations.purpose':
    'People you have invited but who have not joined yet — still open, expired, or withdrawn.',

  'settings.roles.nav': 'Roles',
  'settings.roles.title': 'Roles and permissions',
  'settings.roles.purpose':
    'The roles your members hold and exactly what each one permits, including roles you define yourself.',

  'settings.sessions.nav': 'Sessions',
  'settings.sessions.title': 'Sessions and security',
  'settings.sessions.purpose':
    'Where your Organization is currently signed in, and how to end a session you do not recognise.',

  'settings.apps.nav': 'Apps',
  'settings.apps.title': 'Template and installed Apps',
  'settings.apps.purpose':
    'The Template your Organization was set up from, and the Apps and Connectors running inside it.',

  'settings.audit.nav': 'Audit',
  'settings.audit.title': 'Audit trail',
  'settings.audit.purpose':
    'What was done in your Organization, by whom and when — including anything the Dudo platform did to it.',

  'settings.data.nav': 'Data',
  'settings.data.title': 'Data and retention',
  'settings.data.purpose':
    'How long your records are kept, what you can export, and what happens to your data if you leave.',

  'settings.plan.nav': 'Plan',
  'settings.plan.title': 'Plan and usage',
  'settings.plan.purpose':
    'What your Organization is entitled to, how much of it you have used, and what happens at the limit.',

  /* --- The overview's counted sentence -------------------------------- */

  /*
   * SIX FORMS, BECAUSE ARABIC HAS SIX CATEGORIES. `Intl.PluralRules` picks;
   * this file only looks up. English reaches exactly `one` and `other`, which
   * is measured rather than assumed — see `formatCount`.
   *
   * ⚠ `one` AND `two` DELIBERATELY OMIT `{count}` IN ARABIC, because Arabic
   * carries the quantity in the noun's own form. `fill` leaves a form without
   * the placeholder unchanged, which is what makes that legal — and it is also
   * why a translator who FORGETS the placeholder gets a numberless sentence
   * rather than an error. That limit is stated rather than papered over: no
   * checker can tell the deliberate omission from the mistake.
   */
  'settings.overview.built.zero': 'None of these sections is built yet.',
  'settings.overview.built.one': 'One of these sections is built.',
  'settings.overview.built.two': 'Two of these sections are built.',
  'settings.overview.built.few': '{count} of these sections are built.',
  'settings.overview.built.many': '{count} of these sections are built.',
  'settings.overview.built.other': '{count} of these sections are built.',

  'settings.overview.total': 'Milestone 2 defines {total} sections in all.',
  'settings.overview.intro':
    'This is the shell for Organization administration. The navigation, the layout and the states are real and working; the data behind each section is not built yet, and every section says exactly what it is waiting for.',

  /* --- The "not built yet" state -------------------------------------- */

  'notBuilt.badge': 'Not built yet',
  'notBuilt.nothing': 'There is nothing to show here.',
  'notBuilt.noRequest': 'This section makes no request, so nothing is loading and nothing failed.',
  'notBuilt.contract': 'Contract',
  'notBuilt.status': 'Status',
  'notBuilt.waitingOn': 'Waiting on',
  'notBuilt.noneDrafted': 'None drafted',

  /* --- Contract status, as a closed vocabulary ------------------------ */

  'contractStatus.none': 'No contract exists for this section',
  'contractStatus.proposed': 'Proposed — not accepted, so nothing may be built against it',
  'contractStatus.accepted': 'Accepted',
  /*
   * THE FOURTH VALUE IS THE INTERESTING ONE AND IT IS WHY THIS IS NOT A
   * BOOLEAN. `organization-identity-v1` is accepted and useless here: it is a
   * PLATFORM-class contract, so the only principal who can call it is a Dudo
   * operator. An accepted contract the reader cannot reach is not the same
   * state as an accepted contract, and collapsing the two would tell a customer
   * their own profile is editable when it is not.
   */
  'contractStatus.acceptedPlatformClass':
    'Accepted, but platform-class — only a Dudo operator can call it today',
  'contractStatus.acceptedReadOnly': 'Accepted for reading only; nothing published for changes',

  /* --- What each section is blocked on -------------------------------- */

  /*
   * ⚠ `blocked.roleModel` WAS HERE AND SAID *"The role model, which is not yet
   * recorded as a decision."* **`0043` was accepted while this shell was being
   * built, and the sentence became false with nothing moving to make it so.**
   *
   * That is `workflow.md` §12's *a sentence about a missing capability outlives
   * the capability arriving* — the third time in one session that an absence
   * claim in this file rotted within the hour, and the only one no contract
   * citation could catch, because it names a DECISION rather than a contract.
   *
   * **The key is deleted rather than reworded, and `verify-settings.mjs`
   * reserves against its return.** A reworded key would be one edit away from
   * asserting the same thing again; an absent key that a check refuses to let
   * back is a mechanism.
   */
  'blocked.tenantAdminRegistry':
    'The tenant-admin route registry. The request class is decided; the routes do not exist yet.',
  'blocked.noContract': 'A contract. None has been drafted for this section.',
  'blocked.contractProposed': 'The contract being accepted. It is proposed today.',
  'blocked.platformClassOnly':
    'A tenant-admin route, so that your Organization can change this itself instead of asking Dudo.',
  'blocked.readContractOnly':
    'A contract for making changes. Reading is published and already in use; changing is not.',
  'blocked.capabilityRegistry':
    'The App and Connector runtime, which does not exist yet — there is nothing installed to list.',

  /* --- The six state families ----------------------------------------- */

  'state.loading.title': 'Loading',
  'state.loading.body': 'One moment.',

  'state.empty.title': 'Nothing here yet',
  'state.empty.body': 'Dudo answered, and this section holds no records.',

  'state.retry': 'Try again',
  'state.reference': 'Reference',

  'state.forbidden.title': 'You do not have access to this',
  'state.forbidden.body':
    'Your role in this Organization does not cover this section. Nothing you can do here will change that.',
  'state.forbidden.whatToDo': 'Ask an owner of your Organization to give you access.',

  /*
   * EXPIRED IS NOT NOT-FOUND, AND THE DIFFERENCE IS A DISCLOSURE RATHER THAN A
   * WORDING CHOICE. See `components/settings/SettingsState.tsx` — this sentence
   * CONFIRMS the thing existed, which not-found must never do.
   */
  'state.expired.title': 'This has expired',
  'state.expired.body': 'It was valid, and its time has passed. It cannot be used again.',
  'state.expired.whatToDo': 'Issue a new one, or ask whoever sent it to.',

  'state.notFound.title': 'This is not here',
  'state.notFound.body': 'It may have been moved, or the address may be wrong.',
  'state.notFound.back': 'Back to settings',

  /* --- Failure wording, for THIS surface ------------------------------ */

  /*
   * ===========================================================================
   * A SECOND ERROR VOCABULARY, AND IT IS SPECIALISATION RATHER THAN DUPLICATION
   * ===========================================================================
   *
   * `api/errors.ts` already maps every error code to a sentence — and **those
   * sentences are silently written for the Customer Directory.** `not_found`
   * there reads *"This customer is not here"*, and `failed_precondition` reads
   * *"an archived customer cannot be edited"*. **Both are false on a settings
   * page, and nothing in the type system would have said so.**
   *
   * So the CLASSIFICATION stays shared — `ErrorCode`, `ApiError`, `isRetryable`
   * are one implementation in `api/errors.ts` and are surface-independent — and
   * only the WORDING is per surface. **`not_found` about a customer record and
   * `not_found` about a settings section are genuinely different sentences**, so
   * one map that served both would have to be vague enough to be true of
   * neither.
   *
   * `components/settings/SettingsState.tsx` holds the code-to-key map and
   * explains why the body half is deliberately partial.
   */
  'settingsError.invalidArgument.title': 'Check what you entered',
  'settingsError.unauthenticated.title': 'You need to sign in',
  'settingsError.unauthenticated.body': 'Your session is not active. Sign in and try again.',
  'settingsError.conflict.title': 'That conflicts with something already here',
  'settingsError.failedPrecondition.title': 'That is not possible in this state',
  'settingsError.quotaExceeded.title': 'Your Organization has reached a limit',
  'settingsError.rateLimited.title': 'Too many requests just now',
  'settingsError.rateLimited.body': 'Wait about {seconds} and try again.',
  'settingsError.internal.title': 'Something went wrong at our end',
  'settingsError.internal.body': 'The problem has been recorded. Try again in a moment.',
  'settingsError.unavailable.title': 'Dudo is temporarily unreachable',
  'settingsError.unavailable.body': 'This is usually brief. Try again in a moment.',
  'settingsError.timeout.title': 'That took too long',
  'settingsError.timeout.body': 'The request did not finish. Try again.',
  /*
   * `not_implemented` IS A CODE THE CONTRACT DECLARES AND THIS CLIENT'S TYPE
   * SAID COULD NOT ARRIVE. Adopting the generated `ErrorCode` (twelve values,
   * against a local eleven) named it. **It is the honest answer for a route
   * Core has registered and not built** — which is precisely the state most of
   * `/settings` is in, so this is likelier here than anywhere.
   */
  'settingsError.notImplemented.title': 'This is not built yet',
  'settingsError.notImplemented.body':
    'Dudo recognises this request and has not implemented it. Nothing was changed.',
} as const;

export type MessageKey = keyof typeof en;

/**
 * Arabic.
 *
 * ⚠ **UNREVIEWED BY A NATIVE READER, AND THAT IS A REPORTED GAP RATHER THAN A
 * DISCLAIMER.** `Record<MessageKey, string>` guarantees an Arabic value
 * EXISTS. It does not guarantee the Arabic value says what the English one
 * says, and it certainly does not guarantee it HEDGES where the English hedges
 * — which is the property that matters most in the "not built" and "no access"
 * strings, where an over-confident translation makes a promise the software
 * cannot keep.
 *
 * **Review this against the REASONS in the comments above, not against the
 * English prose.** A translation that reads well and drops a qualifier is the
 * failure mode, and it is invisible to anyone comparing sentence for sentence.
 */
export const ar: Record<MessageKey, string> = {
  'locale.label': 'اللغة',
  'locale.en': 'English',
  'locale.ar': 'العربية',

  'app.skipToContent': 'تخطَّ إلى المحتوى الرئيسي',
  'app.section.customers': 'العملاء',
  'app.section.settings': 'الإعدادات',

  'app.title.customers': 'العملاء · Dudo',
  'app.title.settings': 'الإعدادات · Dudo',
  'app.signOut': 'تسجيل الخروج',
  'app.signingOut': 'جارٍ تسجيل الخروج…',

  'app.transport.live': 'واجهة مباشرة',
  'app.transport.fixture': 'بيانات تجريبية',

  'app.footer.customers': 'دليل العملاء',
  'app.footer.settings': 'إدارة المؤسسة',
  'app.footer.settingsContracts': 'لم يُنشر بعد أي عقد لإدارة المؤسسة',
  'app.footer.liveNote':
    'نسخة مباشرة. تدوم الجلسة اثنتي عشرة ساعة ولا تُجدَّد، وتسجيل الخروج يُنهيها فورًا.',
  'app.footer.fixtureNote':
    'نسخة تجريبية محلية. لا خادم ولا اتصالات بالشبكة، والبيانات مُصطنعة بالكامل.',

  'settings.title': 'الإعدادات',
  'settings.nav.label': 'أقسام الإعدادات',
  'settings.nav.menu': 'الأقسام',
  'settings.backToApp': 'العودة إلى العملاء',

  'settings.overview.nav': 'نظرة عامة',
  'settings.overview.title': 'إعدادات المؤسسة',
  'settings.overview.purpose':
    'أين تقف مؤسستك: من يستطيع الوصول إليها، وما الذي تُشغّله، وما الذي استهلكته.',

  'settings.profile.nav': 'الملف',
  'settings.profile.title': 'ملف المؤسسة',
  'settings.profile.purpose':
    'اسمك القانوني وبيانات السجل التجاري ووسائل الاتصال — السجل الذي تحتفظ به دودو عن شركتك، تُصحِّحه بنفسك بدل طلب الدعم.',

  'settings.businesses.nav': 'الأنشطة',
  'settings.businesses.title': 'الأنشطة والفروع',
  'settings.businesses.purpose':
    'الأنشطة التجارية داخل مؤسستك والفروع التابعة لكل نشاط، ومَن وما يخصّها من أشخاص وسجلات.',

  'settings.members.nav': 'الأعضاء',
  'settings.members.title': 'الأعضاء',
  'settings.members.purpose':
    'كل من يستطيع الدخول إلى مؤسستك، وما المسموح له به، وكيف تُزيل من لم يعد ينتمي إليها.',

  'settings.invitations.nav': 'الدعوات',
  'settings.invitations.title': 'الدعوات',
  'settings.invitations.purpose':
    'من دعوتَهم ولم ينضمّوا بعد — دعوات ما زالت مفتوحة، أو انتهت صلاحيتها، أو سُحبت.',

  'settings.roles.nav': 'الأدوار',
  'settings.roles.title': 'الأدوار والصلاحيات',
  'settings.roles.purpose':
    'الأدوار التي يحملها أعضاؤك وما يسمح به كل دور بالضبط، بما في ذلك أدوار تُعرّفها بنفسك.',

  'settings.sessions.nav': 'الجلسات',
  'settings.sessions.title': 'الجلسات والأمان',
  'settings.sessions.purpose':
    'أين سُجِّل الدخول إلى مؤسستك حاليًا، وكيف تُنهي جلسة لا تعرفها.',

  'settings.apps.nav': 'التطبيقات',
  'settings.apps.title': 'القالب والتطبيقات المثبَّتة',
  'settings.apps.purpose':
    'القالب الذي أُنشئت منه مؤسستك، والتطبيقات والموصِّلات العاملة داخلها.',

  'settings.audit.nav': 'السجل',
  'settings.audit.title': 'سجل التدقيق',
  'settings.audit.purpose':
    'ما جرى في مؤسستك، ومن قام به ومتى — بما في ذلك ما فعلته منصّة دودو بها.',

  'settings.data.nav': 'البيانات',
  'settings.data.title': 'البيانات والاحتفاظ',
  'settings.data.purpose':
    'كم تُحفظ سجلاتك من الوقت، وما الذي يمكنك تصديره، وما مصير بياناتك إذا غادرت.',

  'settings.plan.nav': 'الاشتراك',
  'settings.plan.title': 'الاشتراك والاستهلاك',
  'settings.plan.purpose':
    'ما تستحقّه مؤسستك، وكم استهلكت منه، وما الذي يحدث عند بلوغ الحد.',

  /*
   * `one` و `two` بلا `{count}` عمدًا: العربية تحمل العدد في صيغة الاسم نفسه.
   * انظر التعليق في القاموس الإنجليزي.
   */
  'settings.overview.built.zero': 'لم يُبنَ أي قسم من هذه الأقسام بعد.',
  'settings.overview.built.one': 'قسم واحد من هذه الأقسام مبني.',
  'settings.overview.built.two': 'قسمان من هذه الأقسام مبنيان.',
  'settings.overview.built.few': '{count} أقسام من هذه الأقسام مبنية.',
  'settings.overview.built.many': '{count} قسمًا من هذه الأقسام مبني.',
  'settings.overview.built.other': '{count} قسم من هذه الأقسام مبني.',

  'settings.overview.total': 'تُعرِّف المرحلة الثانية {total} قسمًا في المجموع.',
  'settings.overview.intro':
    'هذه هي واجهة إدارة المؤسسة. التنقّل والتخطيط والحالات كلها حقيقية وتعمل؛ أما البيانات خلف كل قسم فلم تُبنَ بعد، وكل قسم يذكر بالضبط ما ينتظره.',

  'notBuilt.badge': 'لم يُبنَ بعد',
  'notBuilt.nothing': 'لا يوجد شيء لعرضه هنا.',
  'notBuilt.noRequest': 'هذا القسم لا يُرسل أي طلب، فلا شيء قيد التحميل ولا شيء أخفق.',
  'notBuilt.contract': 'العقد',
  'notBuilt.status': 'الحالة',
  'notBuilt.waitingOn': 'ينتظر',
  'notBuilt.noneDrafted': 'لم تُكتب مسوّدة',

  'contractStatus.none': 'لا يوجد عقد لهذا القسم',
  'contractStatus.proposed': 'مقترح — غير مقبول، فلا يجوز بناء أي شيء عليه',
  'contractStatus.accepted': 'مقبول',
  'contractStatus.acceptedPlatformClass':
    'مقبول، لكنه من فئة المنصّة — لا يستطيع استدعاءه اليوم سوى مشغّل دودو',
  'contractStatus.acceptedReadOnly': 'مقبول للقراءة فقط؛ ولم يُنشر شيء للتعديل',

  'blocked.tenantAdminRegistry':
    'سجل مسارات إدارة المستأجر. فئة الطلب مُقرَّرة، أما المسارات فغير موجودة بعد.',
  'blocked.noContract': 'عقد. لم تُكتب أي مسوّدة لهذا القسم.',
  'blocked.contractProposed': 'قبول العقد. وهو مقترح اليوم.',
  'blocked.platformClassOnly':
    'مسار من فئة إدارة المستأجر، حتى تستطيع مؤسستك تغيير هذا بنفسها بدل مطالبة دودو.',
  'blocked.readContractOnly':
    'عقد للتعديل. القراءة منشورة ومستخدَمة فعلًا، أما التعديل فلا.',
  'blocked.capabilityRegistry':
    'بيئة تشغيل التطبيقات والموصِّلات، وهي غير موجودة بعد — فلا يوجد شيء مثبَّت لعرضه.',

  'state.loading.title': 'جارٍ التحميل',
  'state.loading.body': 'لحظة واحدة.',

  'state.empty.title': 'لا شيء هنا بعد',
  'state.empty.body': 'أجابت دودو، ولا يحتوي هذا القسم على أي سجل.',

  'state.retry': 'حاول مرة أخرى',
  'state.reference': 'المرجع',

  'state.forbidden.title': 'ليس لديك وصول إلى هذا',
  'state.forbidden.body':
    'دورك في هذه المؤسسة لا يشمل هذا القسم. ولا شيء تفعله هنا سيغيّر ذلك.',
  'state.forbidden.whatToDo': 'اطلب من أحد مالكي مؤسستك أن يمنحك الوصول.',

  'state.expired.title': 'انتهت صلاحية هذا',
  'state.expired.body': 'كان صالحًا، وقد مضى وقته. ولا يمكن استخدامه مرة أخرى.',
  'state.expired.whatToDo': 'أصدِر واحدًا جديدًا، أو اطلب ذلك ممن أرسله إليك.',

  'state.notFound.title': 'هذا غير موجود هنا',
  'state.notFound.body': 'ربما نُقل، أو ربما يكون العنوان خاطئًا.',
  'state.notFound.back': 'العودة إلى الإعدادات',

  'settingsError.invalidArgument.title': 'راجع ما أدخلته',
  'settingsError.unauthenticated.title': 'يلزم تسجيل الدخول',
  'settingsError.unauthenticated.body': 'جلستك غير نشطة. سجّل الدخول ثم أعد المحاولة.',
  'settingsError.conflict.title': 'هذا يتعارض مع شيء موجود بالفعل',
  'settingsError.failedPrecondition.title': 'هذا غير ممكن في الحالة الراهنة',
  'settingsError.quotaExceeded.title': 'بلغت مؤسستك أحد الحدود',
  'settingsError.rateLimited.title': 'طلبات كثيرة في وقت قصير',
  'settingsError.rateLimited.body': 'انتظر نحو {seconds} ثم أعد المحاولة.',
  'settingsError.internal.title': 'حدث خطأ لدينا',
  'settingsError.internal.body': 'سُجِّلت المشكلة. أعد المحاولة بعد قليل.',
  'settingsError.unavailable.title': 'دودو غير متاحة مؤقتًا',
  'settingsError.unavailable.body': 'عادةً ما يكون هذا وجيزًا. أعد المحاولة بعد لحظات.',
  'settingsError.timeout.title': 'استغرق هذا وقتًا أطول من اللازم',
  'settingsError.timeout.body': 'لم يكتمل الطلب. أعد المحاولة.',
  'settingsError.notImplemented.title': 'هذا لم يُبنَ بعد',
  'settingsError.notImplemented.body':
    'تتعرّف دودو على هذا الطلب ولم تُنفِّذه بعد. لم يتغيّر شيء.',
};

/* -------------------------------------------------------------------------
   Keys declared elsewhere, bridged at compile time
   ------------------------------------------------------------------------- */

/**
 * `api/**` MUST NOT IMPORT THIS MODULE, so `api/config.ts` declares its own
 * narrow key union and this line asserts that union is real.
 *
 * **Why the direction matters.** `api/config.ts` runs under bare Node in the
 * verification scripts, where there is no React and no DOM; importing a module
 * that calls `createContext` would make it unloadable there. So the dependency
 * points this way and never the other.
 *
 * **This is a MECHANISM, not a comment.** If `ConfigMessageKey` ever names a
 * key this dictionary does not hold, the conditional type resolves to `never`
 * and `true` is not assignable to it — **the build fails here**, at the bridge,
 * naming both sides. The alternative is a lookup returning `undefined` at
 * runtime in a header nobody re-reads.
 */
const CONFIG_KEYS_ARE_REAL: ConfigMessageKey extends MessageKey ? true : never = true;
void CONFIG_KEYS_ARE_REAL;

/* -------------------------------------------------------------------------
   Locale, direction and the provider
   ------------------------------------------------------------------------- */

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** `dir` per locale. The only place this mapping exists. */
export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * What to call each language, keyed by locale.
 *
 * **This exists so the switcher does not branch on a locale code.** A ternary
 * would leave a third language quietly resolving to English with nothing red;
 * `Record<Locale, MessageKey>` makes it a compile error here instead.
 */
export const LOCALE_LABEL_KEYS: Record<Locale, MessageKey> = {
  en: 'locale.en',
  ar: 'locale.ar',
};

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, ar };

/**
 * WHERE THE CHOICE IS REMEMBERED, AND WHY IT IS NOT A SERVER PREFERENCE.
 *
 * `localStorage`, per browser. **There is no accepted contract that stores a
 * member's language and this client must not invent one** — and under `0044`
 * a preference written to Core would be a tenant-admin write, which is an
 * audited row describing a UI choice.
 *
 * The cost is that the choice does not follow someone to another machine. That
 * is the correct trade today, and it is stated so nobody reports it as a bug.
 *
 * The key is namespaced to this console. `platform/admin` uses its own, so the
 * two do not collide if they are ever served from one origin.
 */
const STORAGE_KEY = 'dudo.web.locale';

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isLocale(stored) ? stored : null;
  } catch {
    /*
     * Storage can throw — Safari private mode, a disabled-cookies profile, a
     * quota. An application that fails to start because it could not read a
     * language preference would be trading the whole surface for a nicety.
     */
    return null;
  }
}

interface LocaleContextValue {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly setLocale: (next: Locale) => void;
  readonly t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? 'en');
  const dir = directionOf(locale);

  /*
   * `lang` AND `dir` GO ON `<html>`, and both matter for different reasons.
   *
   * `dir` decides the inline axis for every logical property the stylesheet
   * uses, and it is INHERITED — so setting it here is what makes the whole
   * document flip rather than one subtree. See the header for what that means
   * for the untranslated Customers screens: they flip too, into right-aligned
   * English, deliberately.
   *
   * `lang` is not decoration: a screen reader picks its voice and its
   * pronunciation rules from it, and an Arabic page announced by an English
   * synthesiser is unusable rather than merely wrong.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('lang', locale);
    root.setAttribute('dir', dir);
  }, [locale, dir]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* See `readStoredLocale`. A preference that cannot be saved still applies
         to this session; failing the switch would be worse. */
    }
  }, []);

  const t = useCallback((key: MessageKey) => DICTIONARIES[locale][key], [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir, setLocale, t }),
    [locale, dir, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * **Throws rather than returning a default.** A hook that silently returns
 * English outside the provider produces an application that is correct in
 * testing and half-translated in one corner of production, and the corner is
 * found by a user rather than by a build.
 */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error(
      'useLocale was called outside LocaleProvider. Wrap the application in <LocaleProvider>.',
    );
  }
  return value;
}

/** The lookup on its own, for components that need no direction or switching. */
export function useT(): (key: MessageKey) => string {
  return useLocale().t;
}

/* -------------------------------------------------------------------------
   Formatting — every one of these defers to `Intl`
   ------------------------------------------------------------------------- */

/**
 * A duration in seconds, in the reader's language.
 *
 * **`Intl.NumberFormat` with `style: 'unit'` HAS the plural rules**, for every
 * locale, maintained by the engine — ثانية واحدة · ثانيتان · ٥ ثوانٍ · ١١ ثانية
 * come out correctly without this module knowing why. That is the whole
 * argument for not reimplementing it.
 *
 * **THE DIGITS STAY LATIN.** `resolvedOptions()` reports
 * `numberingSystem: 'latn'` for `ar` in this runtime; Arabic-Indic digits need
 * an explicit `ar-u-nu-arab`. **Left as it resolves, deliberately** — both
 * numbering systems are in everyday use in Bahrain and forcing one is a
 * decision about a reader's expectations that this file has no standing to
 * make.
 *
 * `Intl` is in the platform. It is not a dependency and needs no approval.
 */
export function formatSeconds(locale: Locale, seconds: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'long',
    maximumFractionDigits: 0,
  }).format(seconds);
}

/** Every category `Intl.PluralRules` can return. Derived, not transcribed. */
export type PluralCategory = ReturnType<Intl.PluralRules['select']>;

/**
 * A counted sentence, in the reader's language.
 *
 * **THE SPLIT IS: THE ENGINE SELECTS THE CATEGORY, THE DICTIONARY SUPPLIES THE
 * WORDING.** This module still implements no pluralisation rules — it looks one
 * up. `Intl` has no `session`, no `member` and no `Organization` and never
 * will, so `formatSeconds`'s trick does not transfer to a domain noun;
 * `Intl.PluralRules` is the part that does.
 *
 * **Measured, not assumed** — `Intl.PluralRules` over
 * `0, 1, 2, 3, 5, 10, 11, 25, 99, 100, 101, 102, 103, 200`:
 *
 * ```
 * ar   0 zero · 1 one · 2 two · 3–10 few · 11–99 many · 100–102 other · 103 few
 * en   1 one  · everything else other
 * ```
 *
 * **`103` selecting `few` is the case worth keeping**, because it is the one a
 * hand-rolled rule gets wrong: the category turns on `n % 100`, so the sequence
 * is not monotonic and `many` sits between two runs of `few`.
 *
 * **English reaches exactly `one` and `other`**, which is why the dictionary's
 * other four English forms are unreachable by construction rather than by luck.
 */
export function formatCount(
  locale: Locale,
  count: number,
  forms: Record<PluralCategory, MessageKey>,
  t: (key: MessageKey) => string,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  return fill(t(forms[category]), locale, { count });
}

/**
 * Substitute `{name}` placeholders. **The whole substitution mechanism.**
 *
 * **A NUMBER GOES THROUGH `Intl`, ALWAYS.** That is why this takes a locale it
 * would not otherwise need — a bare `String(11)` is a Latin numeral asserted
 * into a sentence whose numbering system is not this function's to decide.
 *
 * **AN UNKNOWN PLACEHOLDER IS LEFT VISIBLE, NOT DROPPED.** `{total}` rendering
 * literally is a bug anyone can see; a silently vanished one produces *"defines
 * sections in all"*, which reads as clumsy translation rather than as a defect
 * and survives review. `workflow.md` §11a's empty-list reader, one string wide.
 *
 * **What this is NOT**: no nesting, no selectors, no formats, no escaping, no
 * arguments beyond a flat map. It is one regular expression.
 */
export function fill(
  template: string,
  locale: Locale,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/gu, (whole: string, name: string): string => {
    const value = values[name];
    /*
     * `undefined` COVERS BOTH "not supplied" AND "supplied as undefined", and
     * both must leave the placeholder visible. `noUncheckedIndexedAccess` is
     * what makes this branch mandatory rather than optional.
     */
    if (value === undefined) return whole;
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}
