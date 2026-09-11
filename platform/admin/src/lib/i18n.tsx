/**
 * English and Arabic for the platform console, with the direction that follows.
 *
 * ===========================================================================
 * WHY THIS IS FIRST-PARTY AND ZERO-DEPENDENCY, WHICH IS A CONSTRAINT RATHER
 * THAN A PREFERENCE
 * ===========================================================================
 *
 * ADR 0036 approved a named set of SIX libraries and the Team Lead has stated
 * that **a seventh is a new user approval, however small.** No agent may grant
 * one (`security.md` §7, §8). So an i18n package is not an option that was
 * weighed and rejected — **it is not available**, and this module is the only
 * buildable path rather than a claim that it is the better one.
 *
 * It is also the `0009`/`0037` answer to the same question a third time: this
 * console needs a lookup and a direction, not a plural-rule engine, a message
 * format compiler or a lazy-loading namespace resolver.
 *
 * **WHAT THIS DELIBERATELY DOES NOT DO**, so nobody reads its absence as an
 * oversight: no pluralisation rules (Arabic has six categories and getting them
 * wrong silently is worse than not claiming them), no date or number
 * formatting — `Intl` is in the platform and is used directly — and no
 * per-namespace lazy loading, because two dictionaries of a few hundred strings
 * are smaller than the code that would defer them.
 *
 * ===========================================================================
 * A MISSING TRANSLATION IS A BUILD FAILURE, NOT A FALLBACK
 * ===========================================================================
 *
 * `ar` is typed as `Record<keyof typeof en, string>`. **Adding an English key
 * without an Arabic one does not compile.** That is `architecture.md` §3a:
 * the obligation is a mechanism rather than something to remember, and the
 * alternative — falling back to English for a missing key — is the shape that
 * makes a half-translated console look finished.
 *
 * **THE FALLBACK IS WHAT WOULD HIDE THE WORK.** An operator switching to Arabic
 * and seeing English words scattered through the page cannot tell whether that
 * string is untranslated or is a proper noun. Refusing to compile is the only
 * version of this that stays honest under time pressure.
 *
 * ===========================================================================
 * DIRECTION IS A PROPERTY OF THE LOCALE AND IS SET ON `<html>`
 * ===========================================================================
 *
 * `dir` is written to the document element rather than to a wrapper, because
 * `dir` inherits and because dialogs, popovers and the scrollbar's own side are
 * resolved against the document. A wrapper produces a console that is RTL
 * except in the places a user notices most.
 *
 * **`@dudo/ui`'s CSS check already asserts that no rule this console produces
 * uses a physical inline-axis property**, and that direction-aware variants are
 * emitted where a value must flip. **That check is the reason this is a small
 * change rather than a rewrite** — the layout already flips; this supplies the
 * signal that tells it to.
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

import type { WindowMessageKey } from '@/api/audit-window';
import type { ErrorMessageKey } from '@/api/errors';
import type { PlatformMessageKey, Refusal } from '@/api/platform';

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
  'app.title': 'Dudo platform administration',
  'app.skipToContent': 'Skip to content',

  'nav.label': 'Sections',
  'nav.dashboard': 'Dashboard',
  'nav.organizations': 'Organizations',
  'nav.templates': 'Templates',
  'nav.operators': 'Operators',
  'nav.audit': 'Platform audit',
  'nav.openMenu': 'Open the section menu',
  'nav.closeMenu': 'Close the section menu',
  'nav.signOut': 'Sign out',
  'nav.signingOut': 'Signing out…',

  'locale.label': 'Language',
  'locale.en': 'English',
  'locale.ar': 'العربية',

  'state.loading': 'Loading…',
  'state.retry': 'Try again',

  /*
   * ACCESSIBLE NAMES AND LOADING LABELS WENT FIRST IN THE COPY PASS, and the
   * order was not arbitrary. A heading left in English is read by someone who
   * can also see the Arabic around it. **An `aria-label` left in English is the
   * ONLY thing a screen-reader user has** — they navigate by landmark and by
   * control name, and there is no surrounding context to fall back on.
   *
   * `a11y.pagination` was the same literal in three screens. One key now.
   */
  /*
   * ===========================================================================
   * THE REPLACEMENT FOR A NOTICE THAT HAD BEEN FALSE FOR DAYS — AND IT IS
   * PHRASED FORWARD BECAUSE THAT IS WHAT MADE THE OLD ONE EXPIRE
   * ===========================================================================
   *
   * It said *"Nothing consumes a Template. Organizations carry no reference to
   * one… what changes that is Organization onboarding, and it is being built
   * now."* **Onboarding was built. The sentence describing its absence
   * outlived its arrival**, and an operator reading it concluded — correctly by
   * the text, wrongly in fact — that creating a business type was inert.
   *
   * **A claim of the form "not yet" expires silently.** A claim about what a
   * thing DOES, and where it takes effect, stays true when a capability lands.
   * So these keys say what a Template is for and how far it reaches; **none of
   * them is a statement about what has not been built.**
   *
   * ---------------------------------------------------------------------------
   * ⚠ AND THE OLD SENTENCE HAD TWO HALVES. ONLY ONE WAS FALSE.
   * ---------------------------------------------------------------------------
   *
   * *"Organizations carry no reference to one"* — **false.**
   * `OnboardOrganization.tsx` sends `template_id` at creation.
   *
   * *"not read by any customer-facing screen"* — **STILL TRUE, measured.**
   * `platform/web` renders no `level_labels`; `business-read-v1` carries none;
   * the only consumers are `Templates.tsx`, `OrganizationDetail.tsx` and
   * `api/platform.ts` — **all admin.**
   *
   * **Correcting only the first half and letting the operator infer the rest
   * would have replaced one false statement with its opposite** — a notice
   * implying tenants now see these words. `templates.reach.notTenantFacing`
   * keeps the true half, on its own terms, as a fact rather than as a promise
   * that something is coming.
   */
  'templates.reach.title': 'Where a business type takes effect',
  'templates.reach.adopted':
    'The labels below are the words an Organization sees for each level. They apply to an Organization that has adopted this business type — set when it is onboarded, and changeable afterwards.',
  'templates.reach.notTenantFacing':
    'These words are shown in this console. No customer-facing screen reads them today, so changing a label here does not change what a customer sees.',

  'templates.nameHint': 'What the business type is called, as a person reads it. Up to',
  'templates.nameHintChars': 'characters. It can be changed later.',
  'onboard.templateHint':
    'Supplies the words this business sees for each level. It can be changed afterwards, and it can be cleared.',

  'onboard.title': 'Onboard a business',
  'onboard.intro':
    'Creates the Organization, its first administrator, and that administrator’s password. The password is generated here and shown once.',

  'onboard.identifierLabel': 'First administrator’s email address',
  'onboard.identifierHint':
    'They will sign in with this. Plain ASCII only; spaces are refused rather than trimmed.',
  'onboard.nameLabel': 'Business name — optional',
  /* Split around the number, exactly as `templates.nameHint` is. */
  'onboard.nameHintPrefix':
    'What operators will see instead of the identifier. Leave it blank if you do not have it — it, the CR and the VAT registration are all recorded on the business’s own page. At most',
  'onboard.nameHintSuffix': 'characters, and names are not unique in Dudo.',

  'onboard.templateLabel': 'Business type',
  'onboard.templateRequired': 'Choose a business type.',
  'onboard.templatesLoading': 'Loading business types…',
  /*
   * WAS "No business types exist yet". Same correction as `dashboard.none`,
   * and the same reason: this is a DATA-empty state read from a live query, and
   * "yet" adds a promise the query did not make.
   */
  'onboard.templatesEmpty': 'No business types exist',
  'onboard.templatesChoose': 'Choose a business type',
  'onboard.templatesFailed':
    'The business types could not be loaded, so none can be chosen. Reload the page to try again.',
  'onboard.templatesNeeded':
    'A business cannot be onboarded until at least one business type exists. Create one under Templates first.',

  /*
   * ===========================================================================
   * THE WORKSPACE NOTICE, REPHRASED FORWARD — AND IT WAS A CAPABILITY CLAIM
   * ===========================================================================
   *
   * It read *"Dudo has nowhere to store a workspace name YET, so this form does
   * not ask for one… Naming arrives with the organization-structure work."*
   * **Both halves are the shape that rots**: an assertion that a capability is
   * absent, and a promise about when it arrives.
   *
   * It sat in JSX, where the absence check could not see it — **the check scans
   * the dictionary, so translating a screen is what brings its prose under
   * examination for the first time.** That is worth knowing on its own: this
   * copy pass is also an audit, and the audit only reaches what has been
   * translated.
   *
   * **The claim was TRUE — verified against the contract, not against the
   * screen's own prose** (`organization-onboarding-v1.schema.json`: *"`business`
   * has two columns and Workspace naming belongs to the organization-structure
   * slice"*). I checked because the last stale notice I met was also true once.
   *
   * **Rephrased to say WHERE naming lives rather than THAT it is missing**,
   * which is the check's own prescription. The new sentence stays true the day
   * workspace naming ships, because it is about which surface owns the field.
   */
  'onboard.workspaceLead': 'The first workspace is created and is not named.',
  'onboard.workspaceBody':
    'This form does not ask for a workspace name. Naming a workspace belongs to the organization-structure surface rather than to onboarding, so a name typed here would be discarded rather than kept.',

  'onboard.submitDeriving': 'Preparing the credential…',
  'onboard.submitSending': 'Creating…',
  'onboard.submit': 'Onboard business',
  'onboard.shownOnce': 'The password is shown once and cannot be recovered.',
  'onboard.creating': 'Creating the business in Core…',
  /*
   * NOT `signIn.progressLabel`, AND THE DIFFERENCE IS ONE WORD THAT MATTERS.
   * Sign-in prepares *your* credential; onboarding prepares *someone else's*.
   * On a console where two derivations with two different salts is the recorded
   * hazard, collapsing the possessive to save a key would be removing the only
   * thing on screen that says whose credential is being made.
   */
  'onboard.progressLabel': 'Preparing the credential',

  'onboard.failed.conflict': 'That email address is already in use',
  'onboard.failed.conflictBody':
    'One email address belongs to one person across the whole platform, and this one already has an account.',
  'onboard.failed.conflictTail': 'Use a different address.',
  'onboard.failed.notFound': 'That business type no longer exists',
  'onboard.failed.notFoundBody': 'It may have been removed since this page loaded.',
  'onboard.failed.notFoundTail': 'Reload and choose again.',
  'onboard.failed.quota': 'The platform write limit has been reached',
  'onboard.failed.quotaBody': 'Core deferred the write rather than performing it.',
  'onboard.failed.quotaTail':
    '— there is no half-made business to clean up. Try again later.',
  'onboard.failed.other': 'The business was not created',
  'onboard.failed.otherWarning':
    'Check the Organizations list before retrying — if the business was created, retrying will fail on the email address and the first password will be lost.',
  'onboard.failed.nothingCreated': 'Nothing was created.',
  'onboard.failed.nothingCreatedBare': 'Nothing was created',

  'onboard.createdTitle': 'Business created',
  'onboard.record': 'Record this password now.',
  'onboard.recordWhy':
    'It exists only on this screen. Dudo did not receive it and cannot show it again — if it is lost, the only way back in is for an operator to reset the credential.',
  'onboard.signInWith': 'Sign in with',
  'onboard.password': 'Password',
  'onboard.businessType': 'Business type',
  'onboard.organizationId': 'Organization',
  'onboard.administratorId': 'Administrator',
  'onboard.workspaceId': 'Workspace',
  'onboard.workspaceNotCreated': 'not created — see the warning above',
  'onboard.youWillKnow': 'You will know this password until it is reset.',
  'onboard.noSelfService':
    'Dudo has no self-service password change, so the administrator cannot replace it themselves — an operator must reset the credential. Send it over a channel you would trust with a password, and treat it as shared until then.',
  'onboard.recordBeforeFollowing': 'Record the password before you follow this.',
  'onboard.identityMissing':
    'The business has no name, no CR and no VAT registration recorded — nobody has asked, which is a different fact from having none.',
  'onboard.openBusiness': 'Open this business to record them',
  'onboard.leavingLoses': 'Leaving this screen loses the password.',
  'onboard.dismissAsk': 'Have you recorded the password? It cannot be shown again.',
  'onboard.dismissYes': 'Yes, I have recorded it',
  /*
   * WAS "Not yet" — a button, and the ONE case in this pass where the flagged
   * word was carrying real meaning. It is the operator's answer about their own
   * state, not a claim the system makes about itself, so the honest options
   * were to narrow the check or to change the words.
   *
   * **I changed the words rather than narrowing the check**, for two reasons.
   * A skip is the highest-suspicion change there is (`§11a`) and one added
   * unilaterally to a copy check is exactly the kind that gets defaulted wider
   * later. And the replacement is better copy on its own terms: it says what
   * the button DOES rather than making the operator infer it, which is the
   * house style everywhere else on this screen.
   */
  'onboard.dismissNo': 'No, keep it on screen',
  'onboard.dismissStart': 'I have recorded the password',

  'onboard.warning.title':
    'The business was created, and part of the setup did not finish.',
  'onboard.warning.unknownLead': 'An unrecognised warning was returned:',
  'onboard.warning.unknownBody':
    'This console does not know what it means, which means Core reports something newer than this build. Report it.',
  'onboard.warning.workspaceLead': 'The first workspace was not created.',
  /*
   * DROPPED "There is no route to create one yet". It is an absence claim, and
   * it is also **useless to the reader**: the operator's action is to report
   * this either way, and naming a route they cannot call adds nothing they can
   * act on. Removing it loses no information the operator can use and removes a
   * sentence that expires silently.
   */
  'onboard.warning.workspaceBody':
    'The business exists and can be signed into, but it has no workspace, and the customer cannot use the product until one exists. Report this.',
  'onboard.warning.auditLead': 'The customer’s own audit record was not written.',
  'onboard.warning.auditBody':
    'The platform recorded this action, but the business’s own log did not — so the customer has no record that their business was created. Report this.',

  /*
   * ===========================================================================
   * THE AUDIT WINDOW — SIX SERVER-TOKEN STRINGS AND SIX LOCAL ONES
   * ===========================================================================
   *
   * These came OUT of `api/audit-window.ts`, which was returning English prose
   * from a module the copy-coverage metric has never scanned. **The keys are
   * named by that module as a narrow string union, and `WINDOW_KEYS_ARE_REAL`
   * below makes a name it invents a compile error.**
   *
   * **The local half and the server half say the same thing in different
   * lengths, deliberately.** The local one is a one-paragraph field refusal
   * beside the form; the server's is a full panel that has replaced the results.
   * Collapsing them to one string would put a panel's worth of explanation into
   * a field error, or a field error's worth into a panel — and the reason the
   * two halves exist at all is that the local mirror can drift from the
   * contract, so they must stay separately editable.
   *
   * ⚠ **`{days}` IS A PLACEHOLDER AND THE FIRST DRAFT OF THIS BLOCK TYPED `31`
   * INSTEAD.** Six of these sentences name the limit, and a literal in a
   * dictionary is **a second copy of `MAX_WINDOW_DAYS` in a file that cannot see
   * the first** — `§12`'s *a symbol whose VALUE moves is caught by nobody*, in
   * twelve places at once, in the language a translator is least likely to
   * re-derive.
   *
   * **That is what made the prefix/suffix pattern insufficient here.** It works
   * where the number sits at a seam (`templates.nameHint`); these sentences
   * carry it mid-clause, and splitting a paragraph in half to admit a numeral
   * produces two fragments neither of which a translator can read. So `fill`
   * generalises `formatCount`'s single substitution — same mechanism, one
   * regular expression, still not a message-format compiler.
   */
  'window.required.title': 'This search needs a date range',
  'window.required.body':
    'Filtering by operator or action requires both a start and an end date, at most {days} days apart. Dudo refuses an open-ended filtered search rather than narrowing it silently — a quietly narrowed answer is indistinguishable from an empty one, and on an audit trail that is the difference between “nothing happened” and “we did not look”.',
  'window.tooWide.title': 'That range is longer than {days} days',
  'window.tooWide.body':
    'The most that can be searched at once is {days} days. Search a month at a time and walk backwards — the controls below move the range by its own length without retyping it. Nothing was searched.',
  'window.inverted.title': 'The end of that range is before its start',
  'window.inverted.body': 'Swap the two dates. Nothing was searched.',

  'window.local.bothOrNeither':
    'Give both dates or neither. A single date is not a window, and Dudo refuses it rather than guessing at the other end.',
  'window.local.required':
    'Filtering by operator or action needs a date range — both ends, at most {days} days apart. Dudo refuses an open-ended filtered search rather than quietly narrowing it, because a narrowed answer looks exactly like an empty one.',
  'window.local.notADate': 'One of those dates is not a real date.',
  'window.local.inverted': 'The end of the range is before its start.',
  'window.local.tooWide':
    'That range is {span} days. The most that can be searched at once is {days} — search a month at a time and walk backwards.',

  /*
   * THE JOINER IN "1 Sep to 30 Sep (UTC)". A translated WORD, not punctuation —
   * `describeWindow` takes it as an argument because `api/**` has no locale.
   */
  'window.joiner': 'to',

  /*
   * ===========================================================================
   * THE AUDIT FEEDS — `audit.*` IS SHARED BY BOTH, `platformAudit.*` IS NOT
   * ===========================================================================
   *
   * The filters, the pagination and the window vocabulary are word-for-word the
   * same on the platform feed and an Organization's own feed, so they share
   * keys. **What must NOT be shared is anything about WHAT the feed contains or
   * WHO it is about** — the platform feed deliberately names no principal
   * target, the Organization feed is scoped to one tenant and its read WRITES A
   * RECORD INTO THAT TENANT. Those are different sentences with different
   * consequences, and merging them to save keys is how a security-relevant
   * distinction turns into a shared string somebody later edits once.
   */
  'audit.filter.operator': 'Operator',
  'audit.filter.operatorHint': 'A principal id. Filters by who acted, not by who was acted on.',
  'audit.filter.operatorPlaceholder': 'principal id',
  'audit.filter.action': 'Action',
  'audit.filter.actionHint': 'An action id, such as platform.audit.list.',
  'audit.filter.from': 'From (UTC)',
  'audit.filter.fromHint': 'Whole days, in UTC.',
  'audit.filter.to': 'To (UTC)',
  'audit.filter.toHint': 'Inclusive of the whole day.',
  'audit.windowRule':
    'Filtering by operator or action needs a date range of at most {days} days. Without a filter you can search the whole log, unbounded.',
  'audit.apply': 'Apply filters',
  'audit.earlierWindow': 'Earlier window',
  'audit.laterWindow': 'Later window',
  'audit.clear': 'Clear',
  'audit.applyResets': 'Applying resets to the newest page. Each page read is itself recorded.',
  'audit.newest': 'Newest',
  'audit.older': 'Older',
  'audit.noMorePages': 'No more pages',
  'audit.page': 'page {page}',
  'audit.noTarget': 'none',

  /*
   * THE EMPTY WINDOWED RESULT. **The most carefully worded sentence on either
   * feed**, and the reason is in the screens: an investigator who filters, gets
   * an empty page and reads it as "this person did nothing" has drawn a
   * conclusion the data does not support — one that is indistinguishable from
   * evidence of innocence.
   *
   * **So "in this window" is in the TITLE, not in a footnote**, and the body
   * names the range and says outright that nothing outside it was searched. A
   * translation that softens either half breaks the property; it is not
   * decorative copy.
   */
  'audit.empty.inWindow': 'No records in this window.',
  'audit.empty.filtered': 'No records match those filters.',
  'audit.empty.filteredBody': 'Core answered, and nothing in the log matches. Widen or clear the filters.',
  'audit.empty.windowLead': 'Core answered, and nothing matches within',
  /* The full stop after the bolded range. Its own key so Arabic can drop it. */
  'audit.empty.windowStop': '.',
  'audit.empty.windowNotSearched':
    'This is not a statement about any other period — records outside this range were not searched. Use',
  'audit.empty.windowKeepLooking': 'to keep looking.',

  'audit.showing.zero': 'Showing {count} records',
  'audit.showing.one': 'Showing {count} record',
  'audit.showing.two': 'Showing {count} records',
  'audit.showing.few': 'Showing {count} records',
  'audit.showing.many': 'Showing {count} records',
  'audit.showing.other': 'Showing {count} records',

  'platformAudit.title': 'Platform audit',
  'platformAudit.intro':
    'Every platform-operator action, newest first. Who acted, against which Organization, and with what outcome.',
  'platformAudit.noTargetPerson': 'It does not say which person an action was about',
  'platformAudit.noTargetPersonWhere':
    '— for that, open an Organization and read its own trail, which records that you did.',
  'platformAudit.noPersonFilter':
    'There is deliberately no filter for the person an action was about. Filtering by someone and counting the results would reveal which Organizations they belong to, one answer at a time — which is exactly what leaving that column out of this feed prevents.',
  'platformAudit.targetColumn': 'Organization',
  'platformAudit.empty.title': 'The log is empty.',
  /*
   * "no operator action HAS BEEN RECORDED" rather than "has been recorded yet".
   * A data-empty state read from a live query, same correction as
   * `dashboard.none` — and the second sentence already supplies the "more are
   * coming" the "yet" was doing, with a reason attached.
   */
  'platformAudit.empty.body':
    'Core answered, and no operator action has been recorded. Reading this page is itself recorded — so the first entry here will usually be someone reading it.',

  'orgAudit.back': 'Back to this Organization',
  'orgAudit.title': 'Audit trail',
  'orgAudit.intro':
    'Every platform-operator action affecting this business, newest first — including which person each action named.',
  /*
   * THE COST NOTICE. **This is the only screen in the console that charges a
   * CUSTOMER to be looked at**, and the sentence exists so an operator does not
   * page through idly. A translation that softens "writes to it" into something
   * like "is logged" loses the part that changes behaviour: it is the
   * customer's allowance, not ours.
   */
  'orgAudit.costLead': 'Reading this writes to it.',
  'orgAudit.costBody':
    'Each page costs five writes from this business’s own daily allowance, and leaves a record in their trail saying the platform read it. That is deliberate — the customer should be able to see that they were looked at. It also means you will find your own earlier visits here, and that nothing on this screen refreshes on its own.',
  'orgAudit.filter.actionHint': 'An action id.',
  'orgAudit.filter.toHint': 'Inclusive.',
  'orgAudit.windowRule':
    'Filtering by action needs a date range of at most {days} days. Reading this business’s whole trail needs no range.',
  'orgAudit.read': 'Read the trail',
  'orgAudit.applyAndRead': 'Apply filters and read',
  'orgAudit.targetColumn': 'Person',
  'orgAudit.pageCost': 'Each page is another five writes against this business.',
  'orgAudit.notFound': 'No Organization has this identifier.',

  /*
   * WAS "Nothing has been read yet." — and this is the ONE "yet" in the pass
   * that was carrying real meaning, describing the operator's own session
   * rather than a missing capability. **It is still gone**, because the
   * replacement states the same fact without promising anything, and the body
   * already says which button changes it. Wording around a check is only
   * acceptable when the result is at least as good; here it is.
   */
  'orgAudit.idle.title': 'Nothing has been read.',
  'orgAudit.idle.body':
    'This screen does not load on its own, because opening it would spend the customer’s allowance. Press',
  'orgAudit.idle.bodyTail': 'when you need it.',

  'orgAudit.empty.title': 'Nothing has happened here.',
  'orgAudit.empty.body':
    'Core answered, and the platform has taken no recorded action against this business. This read is now itself in the trail.',
  'orgAudit.empty.filteredBody': 'Core answered, and nothing in this trail matches.',
  'orgAudit.empty.windowLead':
    'Core answered, and nothing in this business’s trail matches within',
  'orgAudit.empty.windowNotSearched':
    'Records outside this range were not searched, so this says nothing about any other period.',

  'orgAudit.reads.zero': '{count} reads this visit',
  'orgAudit.reads.one': '{count} read this visit',
  'orgAudit.reads.two': '{count} reads this visit',
  'orgAudit.reads.few': '{count} reads this visit',
  'orgAudit.reads.many': '{count} reads this visit',
  'orgAudit.reads.other': '{count} reads this visit',

  /*
   * ===========================================================================
   * THE ERROR ENVELOPE — SIXTEEN SENTENCES THAT NO SCREEN OWNS
   * ===========================================================================
   *
   * From `api/errors.ts`, and **this is the copy every failed request on every
   * screen renders.** It was English in a `.ts` module the coverage pin does not
   * scan, so the console could have been reported as nearly translated while
   * every refusal, timeout and ceiling in it still spoke English — the state
   * that matters most to an operator who has just been stopped.
   *
   * **THE CODES ARE THE CONTRACT'S; THE WORDING IS THIS CONSOLE'S.** An operator
   * is not a customer: `forbidden` on `app.dudo.work` means *ask an owner of
   * this Organization*, and here it means the caller may not be a platform
   * operator at all. Same code, different reader, different sentence — so these
   * must not be shared with `platform/web`'s copy even though the codes are.
   *
   * ⚠ **`error.body.forbidden` IS WRITTEN TO BE TRUE OF FOUR COLLAPSED
   * CONDITIONS AND A TRANSLATION MUST KEEP IT THAT WAY.** Core returns one
   * argument-free `forbidden` for a principal with no operator row, an
   * unrecognised role, a role lacking the permission, **and a principal present
   * in both tables** — the fourth is why they are indistinguishable, because a
   * caller who could detect the mutual-exclusion refusal could probe
   * `organization_membership` with it. **A sentence like "you are not a platform
   * operator" would be a confident claim the response does not support, and on
   * the fourth condition it would be false.** The Arabic says *refused this call
   * for this principal* for exactly that reason.
   */
  'error.title.fallback': 'Something went wrong',
  'error.title.invalidArgument': 'Check what was sent',
  'error.title.unauthenticated': 'You need to sign in',
  'error.title.forbidden': 'This console will not perform that',
  'error.title.notFound': 'That is not here',
  'error.title.conflict': 'That conflicts with something that already exists',
  'error.title.failedPrecondition': 'That is not possible in this state',
  'error.title.quotaExceeded': 'A platform limit has been reached',
  'error.title.rateLimited': 'Too many requests just now',
  'error.title.internal': 'Something went wrong at our end',
  'error.title.unavailable': 'Dudo is temporarily unreachable',
  'error.title.timeout': 'That took too long',

  'error.body.unauthenticated': 'Your operator session is not active. Sign in and try again.',
  'error.body.forbidden':
    'Core refused this call for this principal. The refusal is deliberately unspecific and this console cannot tell you which condition produced it. Raise it with the Team Lead rather than retrying.',
  'error.body.notFound': 'The identifier may be wrong, or the object may have been removed.',
  'error.body.failedPrecondition': 'Something this depends on is not in the required state.',
  'error.body.rateLimited': 'Wait a moment and try again.',
  /* `{seconds}` is filled with `formatSeconds`, so Arabic gets its own forms. */
  'error.body.rateLimitedFor': 'Wait about {seconds} and try again.',
  'error.body.unavailable': 'This is usually brief. Try again in a moment.',
  'error.body.timeout': 'The request did not finish. Try again.',
  'error.body.internal': 'The problem has been recorded. Try again in a moment.',
  /*
   * CLIENT-CONSTRUCTED — the identity save refusing an empty change set locally.
   * **It says what it SAVED, not just what it refused**: five of a customer's
   * daily writes, on a request that would have changed nothing. An operator who
   * is only told "nothing was changed" reads it as a failure rather than as the
   * console declining to spend someone else's budget.
   */
  'error.body.nothingChanged':
    'Nothing was changed, so nothing was sent. Editing a field and saving it unchanged would still spend five of this business’s daily writes.',

  /*
   * ===========================================================================
   * THE FIELD REFUSALS — WHAT AN OPERATOR READS THE MOMENT THEY MISTYPE
   * ===========================================================================
   *
   * From `api/platform.ts`, and the last operator-facing copy in this console
   * that was both English and uncounted.
   *
   * **THEY REFUSE RATHER THAN TRIM, AND THE SENTENCES SAY SO ON PURPOSE.** Three
   * implementations in three languages trim different Unicode sets; refusing
   * removes the disagreement instead of arbitrating it, and a name differing
   * from another only by a trailing space is two records an operator cannot tell
   * apart in a list. **A translation that softens "Dudo refuses them rather than
   * trimming them" into "spaces are removed" would describe behaviour the code
   * does not have** — and the operator would then expect their padding to be
   * cleaned up.
   *
   * `{max}` is the constant; `{length}` is what they actually typed. Neither is
   * a numeral in this file.
   */
  'refusal.templateName.empty': 'Give the business type a name.',
  'refusal.templateName.padded':
    'Remove the spaces from the start or end of the name — Dudo refuses them rather than trimming them.',
  'refusal.templateName.tooLong': 'A name cannot be longer than {max} characters.',
  'refusal.templateLabel.padded': 'Remove the spaces from the start or end of the label.',
  'refusal.templateLabel.tooLong': 'A label cannot be longer than {max} characters.',
  'refusal.displayName.empty': 'A name cannot be empty.',
  'refusal.displayName.padded':
    'A name cannot start or end with a space. Type it without the padding rather than relying on Dudo to trim it.',
  'refusal.displayName.tooLong':
    'A name can be at most {max} characters. This one is {length}.',
  'refusal.registration.empty': 'Type the number, or choose one of the other two states.',
  'refusal.registration.tooLong':
    'A registration number can be at most {max} characters. This one is {length}.',
  /*
   * THE PATTERN IS DELIBERATELY PERMISSIVE AND THE SENTENCE SAYS WHY. Dudo
   * records the number as the registry issues it; narrowing the shape locally
   * would be a breaking change under `API_STANDARD.md` §6 and would land on a
   * customer who cannot be onboarded. The second half of this sentence is what
   * stops an operator concluding their valid number is wrong.
   */
  'refusal.registration.pattern':
    'Use letters, digits, spaces and hyphens only, and do not start or end with a space or a hyphen. Dudo records the number as the registry issues it and checks nothing else about its shape.',

  /*
   * ===========================================================================
   * THE CONFIRMATION GATE — THE CHROME AROUND A SENTENCE THIS CONSOLE DOES NOT
   * OWN
   * ===========================================================================
   *
   * **`challenge.statement` IS NOT HERE AND MUST NEVER BE.** Core writes it,
   * this console renders it verbatim, and a translated statement is a statement
   * Core did not write — *"the party being constrained does not author the
   * statement of the constraint."* Everything below is the surrounding frame.
   *
   * ⚠ **`gate.statementLanguage*` IS NEW AND EXISTS BECAUSE THIS COPY PASS
   * CREATED THE CASE IT DESCRIBES.** The console can now be Arabic while the
   * statement is English. The gate already refuses a statement in an
   * *unexpected* language; nothing looked at the reader. **It is named rather
   * than blocked** — see the component header, where that judgement is stated
   * and handed to the Team Lead.
   */
  'gate.whatWillHappen': 'What will happen',
  'gate.statementLanguageLead': 'The sentence above is in English.',
  'gate.statementLanguageBody':
    'Dudo writes it and this console shows it exactly as written, without translating it — a translated sentence would not be the one Dudo is asking you to approve. Read it before approving.',
  'gate.wrongLocale.title': 'This statement is not in the language this console asked for',
  'gate.wrongLocale.body':
    'Dudo returned it as {got} and this console requested {expected}. It will not ask you to approve a sentence it cannot vouch for.',
  'gate.wrongLocale.nothingChanged': 'Nothing was changed.',
  'gate.wrongLocale.report': 'Report this rather than retrying.',
  'gate.expiresAt': 'This approval expires at',
  /*
   * "YOUR OWN", SPLIT SO IT CAN BE EMPHASISED. This is the sentence that stops
   * an operator typing the credentials of the account they are changing — the
   * confusion that made `credential-reset-v1` unbuildable for half a day. The
   * emphasis is load-bearing, not decorative.
   */
  'gate.confirmWithLead': 'Confirm with',
  'gate.confirmWithYourOwn': 'your own',
  'gate.confirmWithTail': 'sign-in details — not the account being changed.',
  'gate.emailLabel': 'Your email address',
  'gate.emailHint': 'The address you signed in with.',
  'gate.passwordLabel': 'Your password',
  'gate.approve': 'Approve',
  'gate.checking': 'Checking your password…',
  'gate.carryingOut': 'Carrying it out…',
  'gate.progressLabel': 'Checking your password',
  'gate.cancel': 'Cancel',
  'gate.close': 'Close',
  'gate.failedNothingChanged':
    'Nothing was changed. Close this and start again if you still need to.',

  /*
   * ===========================================================================
   * ORGANIZATION IDENTITY — THE NAMES OF TWO REAL REGISTRIES
   * ===========================================================================
   *
   * ⚠ **`identity.cr.registry` AND `identity.vat.registry` ARE INSTITUTIONS, NOT
   * PHRASES.** Sijilat is Bahrain's commercial registration portal (سجلات); the
   * National Bureau for Revenue's own Arabic name is الجهاز الوطني للإيرادات.
   * **The operator is being told which registry to go and check a number
   * against** — a paraphrase sends them looking for an organisation that does
   * not exist under that name.
   *
   * This is the only place in the copy pass where a wrong word sends somebody to
   * the wrong office rather than merely reading oddly.
   *
   * **AND THE GRAMMATICAL PERSON IS A SECURITY PROPERTY HERE.**
   * `identity.verifyClaim` is first person — *"I have checked this number
   * against X"* — because Dudo cannot confirm a check happened and there is no
   * registry API. **"Verified against X" would read as something the system
   * knows**, and the whole shape of this component exists to keep an operator's
   * dated, attributed assertion apart from a fact. The Arabic is first person
   * for the same reason.
   */
  'identity.cr.label': 'Commercial registration (CR)',
  'identity.cr.short': 'CR',
  'identity.cr.registry': 'Sijilat',
  'identity.cr.noneMeans': 'an entity with no commercial registration',
  'identity.vat.label': 'VAT registration',
  'identity.vat.short': 'VAT',
  'identity.vat.registry': 'the National Bureau for Revenue',
  'identity.vat.noneMeans':
    'a business below the VAT threshold, for which registration is voluntary',

  'identity.intro':
    'The name Dudo shows for them, and the two government registrations the platform records. Operator-entered — there is no Sijilat or NBR integration, so every value here was typed by someone.',
  'identity.savedWholeRecord': 'Core answered with the whole record, and it is what is shown below.',
  'identity.nameLabel': 'Name',
  'identity.recordedOn': 'Recorded',

  'identity.notRecorded.body': 'Nobody has asked, or nobody has entered the answer.',
  'identity.notRecorded.notNone':
    'This does not mean they have no {kind} — it means Dudo does not know.',
  'identity.notRegistered.states': 'The customer states they have no {kind}.',
  'identity.notRegistered.answerNotGap': 'This is an answer, not a gap — typically {meaning}. It dates',
  'identity.notRegistered.itDates': 'Dudo’s record of the statement',
  'identity.notRegistered.notCircumstances':
    ', not their circumstances: a business that registers tomorrow does not make this false, it makes it stale.',

  'identity.notVerified.body':
    'Somebody typed this number. Nobody has confirmed it against {registry}. Treat it as the customer’s claim rather than as a checked fact.',
  'identity.verified.title': 'Verified against {registry}',
  'identity.verified.checkedBy': 'Checked by',
  'identity.verified.on': 'on',
  'identity.verified.noApi':
    '. Dudo cannot confirm a check happened — there is no {registry} API — so this is a named operator’s assertion about this exact number, and it is cleared automatically if the number changes.',

  'identity.twoAnswers':
    '“Not recorded” and “they have none” are different answers and Dudo keeps them apart. Choosing the second records that the customer told you so, with today’s date.',
  'identity.choice.notRecorded': 'Not recorded — nobody has asked',
  'identity.choice.notRegistered': 'They have no {kind}',
  'identity.choice.registered': 'They have one, and the number is',
  'identity.numberLabel': '{kind} number',
  'identity.numberHint':
    'As {registry} issues it. Letters, digits, spaces and hyphens, up to {max} characters. Dudo checks nothing else about its shape — there is no digit count, deliberately, because a wrong one would refuse a legal registration.',

  'identity.verificationCleared.why':
    'A verification attests to one specific number, so it cannot follow this one — the tick below has been removed.',
  'identity.verificationCleared.tickAgainBefore': 'Tick it again only if you have checked',
  'identity.theNewNumber': 'the new number',
  'identity.verificationCleared.tickAgainAfter': 'against {registry}.',
  'identity.verifyClaim': 'I have checked this number against {registry}.',
  'identity.verifyClaim.what':
    'Dudo records your principal id and today’s date against this exact number. Nothing checks this for you.',
  'identity.untickRemoves.what':
    'The number stays; the record of who checked it and when is destroyed and cannot be recovered.',
  'identity.redeclare.what':
    'Re-dates the declaration to now. Without this, saving leaves the original date alone — which is usually what you want, because the date records when they said it.',
  'identity.destroys.what':
    'The number, its date and any verification are removed and cannot be recovered. The audit trail records that a change happened, not what was lost. Use it to undo a mistake, not to clear a field you are unsure about.',

  'identity.failed.forbidden': 'You may not change this',
  /*
   * SCREEN-SPECIFIC AND NOT A DUPLICATE OF `error.body.forbidden`. That sentence
   * must be true of all four collapsed conditions and therefore names none of
   * them. **Here the OPERATION is known** — changing an Organization's identity
   * — so this can say which permission is missing without claiming anything
   * about which of Core's four conditions produced the refusal.
   */
  'identity.failed.forbiddenBody':
    'Core refused the call. Changing an Organization’s identity needs a permission your operator role does not hold.',
  'identity.failed.forbiddenTail': 'Raise it with the Team Lead rather than retrying.',
  'identity.failed.notFound': 'This business no longer exists',
  'identity.failed.notFoundBody': 'It may have been removed since this page loaded.',
  'identity.failed.quota': 'The write limit has been reached',
  'identity.failed.quotaBody': 'Core deferred the write rather than performing it.',
  'identity.failed.quotaTail':
    'This spends the business’s own daily allowance, so it will recover on its own. Try again later.',
  'identity.failed.other': 'Nothing was saved',

  /*
   * ===========================================================================
   * ORGANIZATION DETAIL — TWO SENTENCES THAT MUST NOT COLLAPSE INTO "NOT FOUND"
   * ===========================================================================
   *
   * `detail.forbidden.body` and `detail.lookup.forbidden.body` both say the same
   * structural thing: **a refusal is not an absence.** Shortened to *"not
   * found"*, the first tells an operator a customer does not exist when the
   * truth is that they may not look, and the second says a person is not a
   * member when nobody asked. **Both are false statements about a business,
   * manufactured by a shorter sentence**, and no type in this console can see
   * one.
   *
   * `detail.noMemberList.lead` says *by design* for the same class of reason:
   * the absence is a security decision, and copy that reads as a gap invites
   * somebody to request the feature. A count says whether onboarding worked; a
   * LIST, across every Organization an operator can already enumerate,
   * reconstructs every person's membership.
   */
  /*
   * ===========================================================================
   * SR-20 — SHOWN, NOT GATED, AND THE COPY CARRIES THE REASON
   * ===========================================================================
   *
   * Re-templating a suspended Organization is **permitted**: refusing the small
   * act would force the big one, because correcting a Template would otherwise
   * require reactivating first — restoring a customer's access to their product
   * for the sake of a configuration fix. **Correcting configuration before
   * restoring access is the safer order.**
   *
   * **So the sentence states a fact and ends with why the control is still
   * offered.** Copy that read as a warning would make an operator hesitate over
   * an act the platform has deliberately permitted, which is the same defect as
   * a greyed-out control wearing an explanation.
   *
   * `statusUnknown` is the arm for a status this build does not recognise —
   * **telling an operator an Organization is "suspended" when the console
   * cannot read the status would be a false statement about a customer.**
   */
  'orgTemplate.statusNotice': 'This business is',
  'orgTemplate.statusUnknown': 'This console does not recognise this business’s status:',
  'orgTemplate.statusWhy':
    'Changing its business type is still allowed — configuration can be corrected without restoring the customer’s access first, which is the safer order.',

  'detail.loading': 'Asking Core about this Organization…',
  'detail.notFound.title': 'This Organization does not exist',
  'detail.notFound.before': 'Nothing on the platform has the identifier',
  'detail.notFound.after':
    '. It may have been mistyped, or the address may be from a business that was never created.',
  'detail.forbidden.title': 'You may not read this Organization',
  'detail.forbidden.body':
    'Core refused the call itself, which is not the same as the Organization being missing. This needs the Organization-list permission. Raise it rather than retrying — nothing here will change until the grant does.',

  'detail.noMemberList.lead': 'There is no member list, by design.',
  'detail.noMemberList.why':
    'The platform can count an Organization’s members but cannot name them. A count says whether onboarding worked and whether a business is in use; a list, across every Organization an operator can already enumerate, would reconstruct every person’s Organization membership. Use the lookup below when a customer gives you an identifier.',

  'detail.lookup.title': 'Look up a member',
  'detail.lookup.intro':
    'For an identifier a customer has given you. It returns that person’s principal id and role, which is what a credential reset needs.',
  /*
   * "RECORDED IN", NOT "VISIBLE TO", AND THE DISTINCTION IS LOAD-BEARING.
   * `0028`'s amendment strikes "tenant-visible" from its own residual:
   * `core.audit.read` is catalogued at organization scope and HAS NO ROUTE, so
   * tenant-side records are written and unreadable today. **"This business can
   * see every lookup" was the wording here and it was false.** The record IS
   * permanent and becomes readable when the tenant-side route lands, so this
   * sentence is true now and stays true then — which is the property a
   * translation has to preserve.
   */
  'detail.lookup.recorded':
    'Every lookup is recorded in this business’s own audit trail, including ones that find nothing.',
  'detail.lookup.emailLabel': 'Email address',
  'detail.lookup.submit': 'Look up',
  'detail.lookup.looking': 'Looking up…',
  'detail.lookup.onePerPress': 'One lookup per press.',
  'detail.lookup.found': 'That person is a member of this Organization.',
  'detail.lookup.principalId': 'Principal id',
  'detail.lookup.role': 'Role',
  'detail.lookup.forbidden.title': 'You may not use this lookup',
  'detail.lookup.forbidden.body':
    'Core refused the call itself, which is not the same as finding nothing. This lookup requires the credential-reset permission — without it, resolving people is closed to you. Nothing was looked up. Raise it with the Team Lead rather than retrying.',

  /*
   * ===========================================================================
   * OPERATORS — AND THE ONE SENTENCE THAT MUST NOT READ AS "SIGNED OUT"
   * ===========================================================================
   *
   * ⚠ **`operators.revoked.wasSelf` AND `operators.self.what` DESCRIBE AN
   * IRREVERSIBLE ACT.** There is no route that grants platform authority — it
   * has to be re-seeded out of band. **An operator who reads either as "you have
   * been signed out" will simply try to sign in again**, and the console will
   * refuse them with no way to say why.
   *
   * A translation that softens *"there is no route that grants it back"* into
   * anything recoverable-sounding turns a permanent act into a temporary one, in
   * the confirmation copy for the most dangerous operation on this surface.
   *
   * `operators.noNames.lead` is the same class as `detail.noMemberList.lead`:
   * **the absence is a decision, not a gap**, and copy that reads as a gap
   * invites somebody to add the column — here at the most privileged end of the
   * platform.
   */
  'operators.intro':
    'Every principal holding platform authority, and which role each one holds.',
  'operators.revoked.title': 'Platform authority removed.',
  'operators.revoked.noLonger': 'no longer holds platform authority.',
  'operators.revoked.wasSelf':
    'That was your own account — you will be refused on the next request, and there is no route that grants it back.',
  'operators.remaining.zero': 'No operators remain.',
  'operators.remaining.one': '{count} operator remains.',
  'operators.remaining.two': '{count} operators remain.',
  'operators.remaining.few': '{count} operators remain.',
  'operators.remaining.many': '{count} operators remain.',
  'operators.remaining.other': '{count} operators remain.',
  'operators.empty.title': 'No operators are listed.',
  'operators.empty.body':
    'Core answered with an empty roster, which should be impossible — you are reading this through an operator session, so at least one exists. Report it.',
  'operators.noNames.lead': 'There are no names here, and no email addresses.',
  'operators.noNames.why':
    'Dudo does not store personal details against a principal outside a business, so an operator roster showing contact details would be exactly the directory that decision refused — at the most privileged end of the platform. You recognise yourself by the marker above; telling colleagues apart needs display names, which Dudo does not hold.',
  'operators.removing.lead': 'Removing an operator',
  'operators.removing.what':
    'asks Dudo what it will do, shows you that sentence, and needs your own password. It cannot be undone from here — there is no route that grants platform authority.',
  'operators.self.lead': 'This is your own account.',
  'operators.self.what':
    'Removing your own platform authority signs you out of everything here, and there is no route that grants it back — it has to be re-seeded out of band.',
  'operators.self.maybeLast': 'You may also be the last operator.',
  'operators.revoke.title': 'Remove platform authority',
  'operators.revokeSelf.title': 'Remove your own platform authority',

  /* Shared by every paginated list. One sentence, one home. */
  'page.startAgain': 'Start again from the first page',
  'page.emptyPage': 'Core answered, and this page is empty. Start again from the first page.',

  'templates.existing': 'Existing business types',
  'templates.empty.body':
    'Core answered, and none has been created. An empty list is not a missing one — this is what the platform currently holds.',
  'templates.create.title': 'Create a business type',
  'templates.create.submit': 'Create business type',
  'templates.creating': 'Creating…',
  'templates.namePlaceholder': 'School',
  /*
   * ⚠ SAID "It cannot be edited, renamed or removed afterwards." **ALL THREE
   * WERE WRONG ABOUT EDIT AND RENAME** — `useUpdateTemplate`,
   * `useRetireTemplate` and `useRestoreTemplate` are all wired into that screen.
   *
   * Third instance of this class on the console and the SECOND IN THAT FILE: the
   * Name field's hint said *"It cannot be changed later"*, was corrected, and
   * this sentence eighty lines below said the same false thing and was not.
   * **And the absence check missed it by one word** — its pattern carried
   * `cannot be changed`, this said `cannot be edited`.
   *
   * What is left is TRUE: there is no delete, retiring is not removal, and a
   * name is how an operator recognises a business type. Worth saying at the
   * point of creation.
   */
  'templates.create.permanence':
    'It can be renamed and retired afterwards, but never deleted — retiring keeps the name taken.',
  'templates.created.before': 'Created',
  /*
   * ⚠ SAID ". It is stored and no customer sees it YET." Both halves were
   * wrong: the "yet" promises a future this console has no basis for, and the
   * claim is false the moment an Organization adopts the business type. Same
   * sentence that propagated into the dashboard dictionary and was corrected
   * there while this original stayed.
   */
  'templates.created.after': '. It takes effect for an Organization that adopts it.',
  'templates.levels.legend': 'What each level is called',
  'templates.levels.labelsOnly':
    'These change only the words a customer reads. They do not change permissions, structure or anything a tenant can do. Leave one blank to keep the default.',
  /*
   * THE PLATFORM'S OWN NAMES FOR THE THREE LEVELS, not the customer's. An
   * operator typing "Campus" needs to know which level they are renaming, so
   * these stay the platform vocabulary in the reader's language — never the
   * label being edited beside them.
   */
  'templates.level.organization': 'Organization',
  'templates.level.workspace': 'Workspace',
  'templates.level.branch': 'Branch',
  'templates.levelHint.organization':
    'A school group renders “Group”, a clinic “Practice”, a company “Company”.',
  'templates.levelHint.workspace': 'A school renders “Campus”, a shop “Branch”, a clinic “Site”.',
  'templates.levelHint.branch': 'The level below a Workspace.',

  'organizations.empty.body':
    'Core answered, and the platform has none. This is not a failure to load — when an Organization is onboarded it appears here.',
  'organizations.tableCaption':
    'Organizations on the platform, with their name where one is recorded, their identifier, status and creation date.',

  /*
   * ===========================================================================
   * THE CEILINGS — AND WHOSE ALLOWANCE IT IS, IS THE WHOLE POINT
   * ===========================================================================
   *
   * `rate_limited` is about OPERATOR activity against a customer.
   * `quota_exceeded` at organization scope is about the **CUSTOMER'S OWN**
   * allocation — which no operator action can clear, and which **retrying
   * actively spends on a refusal.**
   *
   * **Merging the two produces a retry**, which is the behaviour the ceilings
   * exist to stop; and telling an operator a limit is theirs when it is the
   * customer's invites exactly that. Four sentences, four different owners of
   * the same word "limit".
   */
  'ceiling.rate.org.title': 'Operators have read this business enough for today',
  'ceiling.rate.org.before':
    'Reading this trail writes to it, and the platform’s share of this business’s day is spent.',
  'ceiling.rate.org.whose': 'This is about operator activity, not about the customer',
  'ceiling.rate.org.after':
    '— someone, possibly you, has read enough for one day. Another operator may be part-way through an investigation.',
  'ceiling.rate.platform.title': 'This log has been read enough for today',
  'ceiling.rate.platform.before':
    'Reading the log writes to the log, and the allowance for that is spent for now.',
  'ceiling.rate.platform.whose': 'This is about operator activity',
  'ceiling.rate.platform.after': ', not about any customer.',
  'ceiling.quota.org.title': 'This business has reached its own daily limit',
  'ceiling.quota.org.whose': 'This is about the customer, not about you.',
  'ceiling.quota.org.after':
    'The business has reached its own daily write allocation, and reading this trail needs a write into it. Nothing an operator does will clear it — it resets at 00:00 UTC, and retrying now spends what little the customer has left on a refusal.',
  'ceiling.quota.platform.title': 'The platform has reached its own daily limit',
  'ceiling.quota.platform.whose': 'This is the platform’s own allocation',
  'ceiling.quota.platform.after':
    ', not a customer’s. It resets at 00:00 UTC. Retrying now will not help.',
  'ceiling.waitAbout': 'Core suggests waiting about {seconds}.',

  /*
   * ⚠ SAYS THE PASSWORD WAS ACCEPTED, which is the half that stops an operator
   * retyping it. **A translation that collapsed this into "you cannot sign in"
   * would send them round the login loop forever** — the credential is fine and
   * the console is refused. And it names no cause, for the four-collapsed-
   * conditions reason `error.body.forbidden` records.
   */
  'session.refused.title': 'This account cannot use the console',
  'session.refused.body':
    'You are signed in — your password was accepted — and Dudo refused this console to your account.',
  'session.refused.noReason':
    'Dudo does not say why, deliberately, and this console cannot tell. Signing in again will not change it — ask whoever administers the platform.',
  /*
   * AND THE INVERSE: an unreachable server says NOTHING about whether a
   * credential is still good. **Showing a sign-in form here would teach an
   * operator to re-enter a password whenever the network hiccups.**
   */
  'session.probeFailed.notSignedOut':
    'This does not mean you are signed out — Dudo could not be asked. Your session may well still be live.',
  'session.signOutInstead': 'Sign out instead',

  /*
   * ⚠ THE ONE PLACE ON THIS CONSOLE WHERE AN ABSENCE CLAIM IS THE ENTIRE POINT,
   * and the reason the absence check scans the dictionary rather than the
   * screens — it would flag this, correctly by its pattern and wrongly by its
   * purpose.
   *
   * **It cannot outlive its subject**: building the section deletes the
   * component's use, which is exactly what every other stale "yet" on this
   * console failed to do.
   */
  'notBuilt.badge': 'Not built',
  'notBuilt.nothing': 'There is nothing to show here.',
  'notBuilt.noRequest':
    'This section makes no request to Core and displays no data — real or otherwise.',
  'notBuilt.contract': 'Contract',
  'notBuilt.noneDrafted': 'None drafted.',
  'notBuilt.status': 'Status',
  'notBuilt.waitingOn': 'Waiting on',

  /*
   * "STRUCTURAL, NOT A SETTING" IS LOAD-BEARING. `0024`'s mutual exclusion is a
   * property of how principals are stored, not a permission anyone could grant.
   * **Copy that read as "you do not currently have access" would invite an
   * operator to ask for it, and there is nothing to ask for.**
   */
  'shell.noTenantReach':
    'An operator belongs to no Organization and cannot reach customer records. That is structural, not a setting.',

  'signIn.kdfExplainer':
    'Your password is turned into a key in this browser and the password itself is never sent to Dudo. That takes a second or two and is the pause you will see.',

  /*
   * ===========================================================================
   * ⚠ EVERYTHING BELOW WAS INVISIBLE TO THE COPY PIN, AND THE REASON IS ONE
   * NUMBER
   * ===========================================================================
   *
   * The prose pattern requires **three words**. Every column header, every short
   * button and three pagination lines are one or two — so **"Operators",
   * "Status", "Created", "Remove authority", "First page" and
   * `Showing N operators` sat in English while the pin read ZERO**, and I
   * reported the pass complete on that number.
   *
   * **The floor was there to keep TypeScript declarations out of a prose count**
   * — `interface Draft {` matches the shape otherwise — and it was doing that
   * correctly. It was also excluding the most-read text on every screen: a
   * table header is read before anything else in the table.
   *
   * `§11a`: *a floor proves the check found SOMETHING, not EVERYTHING* — and
   * this is the third instrument in this session whose population turned out to
   * be smaller than the thing it was reporting on.
   */
  'nav.menu': 'Menu',
  'app.subtitle': 'platform administration',
  'page.firstPage': 'First page',
  'audit.correlation': 'Correlation',
  'column.identifier': 'Identifier',
  'column.status': 'Status',
  'column.created': 'Created',
  'column.members': 'Members',
  'operators.granted': 'Granted',
  'operators.removeAuthority': 'Remove authority',
  'detail.template.none':
    'None recorded. This Organization was created before it could adopt one, so it uses Dudo’s default words for every level.',

  'operators.showing.zero': 'Showing {count} operators',
  'operators.showing.one': 'Showing {count} operator',
  'operators.showing.two': 'Showing {count} operators',
  'operators.showing.few': 'Showing {count} operators',
  'operators.showing.many': 'Showing {count} operators',
  'operators.showing.other': 'Showing {count} operators',
  'organizations.showing.zero': 'Showing {count} Organizations',
  'organizations.showing.one': 'Showing {count} Organization',
  'organizations.showing.two': 'Showing {count} Organizations',
  'organizations.showing.few': 'Showing {count} Organizations',
  'organizations.showing.many': 'Showing {count} Organizations',
  'organizations.showing.other': 'Showing {count} Organizations',
  'templates.showing.zero': 'Showing {count} business types',
  'templates.showing.one': 'Showing {count} business type',
  'templates.showing.two': 'Showing {count} business types',
  'templates.showing.few': 'Showing {count} business types',
  'templates.showing.many': 'Showing {count} business types',
  'templates.showing.other': 'Showing {count} business types',
  'column.createdOn': 'Created',
  'operators.you': 'You',
  /*
   * "AT THE TIME" IS LOAD-BEARING. The role is what the actor held WHEN THE
   * ACTION HAPPENED, not what they hold now — different facts on an audit
   * trail, and a translation that dropped the qualifier would assert a current
   * role from a historical record.
   */
  'audit.roleAtTheTime': 'at the time',

  /*
   * ===========================================================================
   * ⚠ AND THESE NINETEEN WERE INVISIBLE FOR A DIFFERENT REASON AGAIN
   * ===========================================================================
   *
   * Not too short — **in the wrong SYNTACTIC POSITION.** The prose pattern reads
   * JSX TEXT NODES; every string below lived in a ternary or a template literal
   * inside `{…}`, where it never matched.
   *
   * **Two of them were absence claims the absence check could not see either** —
   * *"There are no Organizations yet."* and *"No business types yet."* — because
   * that check scans the DICTIONARY and these were never in one. **A string has
   * to be translated before the absence check can look at it**, which makes the
   * two instruments' blind spots the same blind spot.
   *
   * Fourth population gap in one session. Recorded in the pin.
   */
  'page.next': 'Next page',
  'page.emptyPage.title': 'No more on this page.',
  'organizations.empty.title': 'There are no Organizations.',
  'templates.empty.title': 'No business types exist.',
  /* The form's accessible name — announced when focus lands on it. */
  'identity.editForm': 'Edit this business’s name and registrations',
  'identity.saving': 'Saving…',
  'identity.saveChanges': 'Save changes',
  'identity.nothingChangedDraft': 'Nothing has changed.',
  'identity.updated.zero': '{count} fields were updated.',
  'identity.updated.one': 'One field was updated.',
  'identity.updated.two': '{count} fields were updated.',
  'identity.updated.few': '{count} fields were updated.',
  'identity.updated.many': '{count} fields were updated.',
  'identity.updated.other': '{count} fields were updated.',
  'identity.willSend.zero': '{count} fields will be sent. The others are left untouched.',
  'identity.willSend.one': '1 field will be sent. The others are left untouched.',
  'identity.willSend.two': '{count} fields will be sent. The others are left untouched.',
  'identity.willSend.few': '{count} fields will be sent. The others are left untouched.',
  'identity.willSend.many': '{count} fields will be sent. The others are left untouched.',
  'identity.willSend.other': '{count} fields will be sent. The others are left untouched.',
  'templates.failed.conflict': 'That name is already taken',
  /*
   * THE EXAMPLE IS WHAT STOPS THE RETRY LOOP. An operator told only "already
   * taken" retries with different capitalisation and is refused again; the
   * sentence says names are compared ignoring case and some Unicode
   * differences, and shows it.
   */
  'templates.failed.conflictBody':
    'A business type with this name already exists. Names are compared ignoring case and some Unicode differences, so “School” and “school” count as the same. Nothing was created — choose a different name.',
  'templates.failed.quota': 'The platform write limit has been reached',
  'templates.failed.quotaBody':
    'Core deferred the write rather than performing it. Nothing was created. Try again later; no tenant is affected by this.',
  'templates.failed.other': 'The business type was not created',

  /*
   * ===========================================================================
   * THE LIFECYCLE COPY, WRITTEN INTO THE DICTIONARY FIRST
   * ===========================================================================
   *
   * Every string a new surface needs is declared here BEFORE the surface is
   * built, so nothing is written in English and retrofitted. That is the
   * failure mode the whole mechanism exists to prevent, and building a screen
   * first is how it happens.
   *
   * **NOTE WHAT `retire.namePoint` SAYS, because it is the one an operator
   * actually needs:** retiring does NOT free the Template's unique name. That
   * is why `restore` exists at all — without it *"a mistaken retirement spends
   * the Template's unique name permanently."* A confirmation that only said
   * "are you sure" would omit the single fact that decides the answer.
   */
  /*
   * ===========================================================================
   * ORGANIZATION IDENTITY — and the three keys that come in halves
   * ===========================================================================
   *
   * Most of these are whole sentences. **Three are split into a `before` and an
   * `after` around an inline element** — a `<code>` holding a state Core sent, a
   * `<span>` naming a button, an `<em>`. That is the same pattern the sign-in
   * duration estimate uses, and it is used ONLY where the thing between the
   * halves is a discrete token rather than a word that has to agree with the
   * grammar around it.
   *
   * **Splitting a sentence around a WORD would be the anti-pattern**, because
   * word order and agreement differ between the two languages and the halves
   * would only fit English. Splitting around a quoted identifier is safe in
   * both, which is why these three are and the rest are not.
   *
   * **`identity.verifyMeaning` is the one to translate carefully.** It is the
   * sentence an operator reads while deciding whether to attest that they
   * personally checked a registration against the issuing registry — the
   * distinction the whole verification design exists to preserve.
   */
  'identity.heading': 'Who this business is',
  'identity.edit': 'Edit',
  'identity.nameCannotBeRemoved': 'A name cannot be removed once it exists.',
  'identity.noName': 'No name recorded.',
  'identity.noNameExplainBefore':
    'Nobody has given this business a name in Dudo, so it is known by the identifier at the top of this page. That is normal for a business onboarded before names existed — it is not an error and nothing is missing. Press',
  'identity.noNameExplainAfter': 'to record one.',
  'identity.notRecorded': 'Not recorded',
  'identity.recorded': 'Recorded',
  'identity.numberRecorded': 'Number recorded',
  'identity.unknownRecord': 'This console does not understand this record.',
  'identity.unknownStateBefore': 'Core reported the state',
  'identity.unknownStateAfter':
    'which is newer than this build. Nothing is shown for it rather than a guess. Report it.',
  'identity.notVerified': 'Not verified',
  'identity.unrecognisedStored': 'The stored state is one this console does not recognise.',
  'identity.overwriteWarnBefore': 'Nothing is preselected below. Choosing any option here',
  'identity.overwrites': 'overwrites',
  'identity.overwriteWarnAfter': 'whatever is stored — leave it alone unless you mean to.',
  'identity.numberChangeClearsVerification':
    'Changing the number clears the existing verification.',
  'identity.untickRemovesVerification': 'Unticking this removes the existing verification.',
  'identity.verifyMeaning': 'The customer has told me this again today.',
  'identity.destroys': 'This destroys what is recorded.',
  'identity.nothingChanged': 'Nothing was changed.',
  'identity.wholeOrNothing':
    'The update is applied whole or not at all, so there is no half-saved record.',

  'templates.nameLabel': 'Name',
  'template.edit': 'Edit',
  'template.editTitle': 'Edit this business type',
  'template.save': 'Save changes',
  'template.saving': 'Saving…',
  'template.cancel': 'Cancel',
  'template.retire': 'Retire',
  'template.retiring': 'Retiring…',
  'template.restore': 'Restore',
  'template.restoring': 'Restoring…',
  'template.retired': 'Retired',
  'template.active': 'Active',

  'retire.title': 'Retire this business type',
  'retire.effect':
    'Retiring withdraws it from new adoption. Organizations already using it keep it and keep seeing its labels — nothing they see changes.',
  'retire.namePoint':
    'The name stays taken while it is retired, so it cannot be reused for a different business type. Restoring brings it back.',
  'retire.confirm': 'Retire it',
  'retire.done': 'Retired.',
  'restore.done': 'Restored.',
  'restore.effect': 'Restoring makes it available for new adoption again.',

  'usage.heading': 'Who is using it',
  'usage.counting': 'Asking Core how many Organizations use this…',
  'usage.none': 'No Organization currently uses this business type.',
  'usage.someOne': 'One Organization currently uses this business type.',
  'usage.someMany': 'Organizations currently use this business type.',
  'usage.deniedTitle': 'This console cannot tell you who uses it',
  'usage.deniedBody':
    'Reading adoption needs its own permission, separate from reading business types — it counts across Organizations. Without it this figure is unavailable, which is not the same as it being zero.',

  'orgTemplate.heading': 'Business type',
  'orgTemplate.change': 'Change',
  'orgTemplate.clear': 'Use none',
  'orgTemplate.none': 'None recorded',
  'orgTemplate.saving': 'Saving…',
  'orgTemplate.choose': 'Choose a business type',
  'orgTemplate.explain':
    'Sets the words this Organization sees for each level. Choosing none returns it to Dudo’s default words.',

  'a11y.pagination': 'Pagination',
  'loading.organizations': 'Asking Core for the Organizations…',
  'loading.templates': 'Asking Core for the Templates…',
  'loading.operators': 'Asking Core who holds platform authority…',
  'loading.organizationDetail': 'Asking Core about this Organization…',
  'loading.organizationAudit': 'Reading this business’s trail…',
  'loading.platformAudit': 'Reading the platform log…',
  'loading.session': 'Checking your operator session with Dudo…',
  'loading.operatorContext': 'Loading your operator context…',
  'loading.challenge': 'Asking Core what this will do…',
  'loading.credential': 'Preparing the new credential in this browser…',

  'signIn.brand': 'Dudo',
  'signIn.title': 'Platform administration',
  'signIn.intro':
    'Operator access. This is a separate sign-in from the Dudo application — being signed in there does not sign you in here.',
  'signIn.uncleared.title': 'Your last sign-out did not reach Dudo.',
  'signIn.uncleared.body':
    'Nothing was revoked and the session credential was not cleared, so that session is still live. If you are on a shared machine, sign in and sign out again on a working connection.',
  'signIn.email': 'Email address',
  'signIn.emailHint': 'Plain ASCII only. Spaces are refused rather than trimmed.',
  'signIn.password': 'Password',
  'signIn.submit': 'Sign in',
  'signIn.deriving': 'Preparing your credential…',
  'signIn.sending': 'Signing in…',
  'signIn.progressLabel': 'Preparing your credential',

  /*
   * THE 401 OVERRIDE, AND IT IS NOT A DUPLICATE OF `error.body.unauthenticated`.
   * That sentence says *your operator session is not active — sign in and try
   * again*, which is correct on every screen except this one, where the
   * operator is already signing in. **Telling someone to sign in while they are
   * signing in is the shape of message that makes a console feel broken.**
   *
   * And it says nothing about WHICH half was wrong, because Core's 401 body is a
   * constant that does not say either. Inventing the distinction here would turn
   * the login screen into an account-existence oracle.
   */
  'signIn.rejected.title': 'Those credentials were not accepted',
  'signIn.rejected.body':
    'Check the address and the password and try again. Dudo does not say which of the two was wrong, deliberately.',

  /*
   * ===========================================================================
   * THE ESTIMATE, SHARED BY TWO SCREENS, MOVED OUT OF THE `signIn` NAMESPACE
   * ===========================================================================
   *
   * These three were `signIn.*` and are now `derivation.*`, because
   * `OnboardOrganization` runs the same KDF with the same progress bar and
   * needs the same words. **Reusing a `signIn.` key from an onboarding screen
   * is a key that lies about its scope**, and the next author copies it into a
   * fourth namespace rather than trusting it.
   *
   * **`signIn.progressLabel` deliberately did NOT move.** It says *your*
   * credential and onboarding's says *the* credential — see
   * `onboard.progressLabel`. The three that moved are word-for-word identical
   * in both places; the one that stayed is not, and merging it would have been
   * `§2b`'s silent collapse of two things into one that still looks like two.
   */
  'derivation.measuring': 'Measuring how long this will take on this device…',
  'derivation.remainingPrefix': 'About',
  'derivation.estimateNote': 'an estimate measured on this device.',

  'denied.title': 'You do not have access to this',
  'denied.body':
    'Dudo refused this call. This console cannot tell you which of several reasons applies, and it will not guess — the answer is deliberately the same for all of them.',
  'denied.whatToDo':
    'If you believe you should have this, ask a platform administrator to check your role. Retrying will not change the answer.',
  'denied.reference': 'Reference',

  'reset.offer.lead': 'Reset this person’s password.',
  'reset.offer.body':
    'Dudo will generate a new one here and show it once. It signs them out everywhere, and it needs your own password to confirm.',
  'reset.offer.action': 'Reset their credential',
  'reset.preparing': 'Preparing the new credential in this browser…',

  'reset.notStarted.title': 'The reset was not started.',
  'reset.notStarted.unchanged': 'Nothing was changed.',
  'reset.notStarted.retry': 'Start again',

  'reset.confirm.title': 'Reset this person’s password',
  /*
   * WAS "…nothing has changed YET — approving below is what applies it."
   * **The absence-claim check caught the "yet" and the copy was corrected
   * rather than exempted**, which is the second time that check has produced a
   * better sentence out of what looked like a false positive
   * (`dashboard.none` was the first).
   *
   * The dash clause already carries the sequencing — *approving below is what
   * applies it* says exactly what "yet" was doing, and says it with an
   * antecedent. **A word that promises a future the sentence beside it already
   * states is a word doing nothing but weakening a factual claim.**
   */
  'reset.confirm.intro':
    'A new password has been generated in this browser. It has not been sent and nothing has changed — approving below is what applies it.',
  /*
   * A SENTENCE WITH A VALUE IN THE MIDDLE, SPLIT RATHER THAN INTERPOLATED. The
   * identifier is an opaque ASCII string the operator typed; it is not
   * translatable and must render exactly. Two keys let Arabic put the value
   * where Arabic wants it, and neither half is a fragment that only makes sense
   * beside a placeholder.
   */
  'reset.confirm.typedPrefix': 'You typed',
  'reset.confirm.typedSuffix': 'as the account to reset.',

  'reset.refused.title': 'The password was not reset',
  'reset.refused.lead': 'Dudo refused the change, so',
  'reset.refused.emphasis': 'nothing happened and the old password still works.',
  'reset.refused.warning':
    'The password generated here was never written — do not send it to anyone.',

  'reset.unknown.title': 'It is not known whether the password was reset',
  'reset.unknown.body':
    'The request did not come back. It may have been applied and the answer lost on the way, or it may never have arrived —',
  'reset.unknown.noGuess': 'this console cannot tell, and is not going to guess.',
  'reset.unknown.record': 'Record the password below before leaving this screen.',
  'reset.unknown.recordWhy':
    'If the reset did land, this is the only copy that exists anywhere. If it did not, the string is harmless and the old password still works.',
  'reset.unknown.identifierLabel': 'They would sign in with',
  'reset.unknown.passwordLabel': 'Possibly-live password',
  'reset.unknown.resolveLead': 'To find out which:',
  'reset.unknown.resolveBody':
    'check this business’s audit trail for a credential-reset record, or ask the person to try the new password.',
  'reset.unknown.doNotRepeat': 'Do not simply run the reset again before checking',
  'reset.unknown.doNotRepeatWhy':
    '— a second reset would replace a credential that may already be the live one, and you would then be holding two passwords and know less than you do now.',

  'reset.done.title': 'The password was reset',
  'reset.done.partial': 'Part of it did not finish.',
  'reset.done.partialStillLive': 'The password below is live regardless. Report this.',
  'reset.done.record': 'Record this password now.',
  'reset.done.recordWhy':
    'It exists only on this screen — Dudo did not receive it and cannot show it again.',
  'reset.done.identifierLabel': 'They sign in with',
  'reset.done.passwordLabel': 'New password',
  'reset.done.youWillKnow': 'You will know this password until it is reset again.',
  'reset.done.noSelfService':
    'Dudo has no self-service password change, so they cannot replace it themselves. Send it over a channel you would trust with a password.',

  /*
   * =========================================================================
   * SIX FORMS FOR ONE SENTENCE, AND ENGLISH REACHES TWO OF THEM
   * =========================================================================
   *
   * `Intl.PluralRules` chooses; this file supplies the wording. That is the
   * same deferral `formatSeconds` makes and the same one the header promises —
   * **the RULE is the engine's, the FORMS are the translator's** — and it is
   * the only arrangement in which this module can carry a count without
   * claiming the competence it disclaimed.
   *
   * **`Intl.PluralRules('en')` returns only `one` and `other`.** The other four
   * keys exist because `ar` needs them and the dictionary is one shape for both
   * languages. **They are filled with the `other` wording rather than with
   * invented English**, so that if a future locale ever selected one of them
   * here, the output is a correct English sentence rather than a plausible-
   * looking guess. They are unreachable in English by construction, not by
   * accident.
   *
   * **`{count}` IS ABSENT FROM `zero`, `one` AND `two` IN ARABIC, AND THAT IS
   * CORRECT RATHER THAN AN OVERSIGHT.** Arabic states those quantities in the
   * noun — جلسة واحدة, جلستان — and printing the numeral beside them reads as a
   * translation nobody proofread. `formatCount` replaces a placeholder that is
   * not there and returns the string unchanged, which is the behaviour those
   * forms need.
   */
  'reset.sessions.zero': '{count} sessions were signed out.',
  'reset.sessions.one': '{count} session was signed out.',
  'reset.sessions.two': '{count} sessions were signed out.',
  'reset.sessions.few': '{count} sessions were signed out.',
  'reset.sessions.many': '{count} sessions were signed out.',
  'reset.sessions.other': '{count} sessions were signed out.',

  'dashboard.title': 'Platform',
  'dashboard.intro':
    'What the platform holds right now. Every figure below is read from Core when this page opens, and nothing here is cached or estimated.',
  'dashboard.organizations': 'Organizations',
  'dashboard.templates': 'Business types',
  'dashboard.recentActions': 'Recent platform actions',
  'dashboard.recentOnboardings': 'Recently onboarded',
  'dashboard.viewAll': 'View all',
  /*
   * WAS "None yet". Changed for a reason that survives the check that found it:
   * **"yet" promises that more are coming, and this console has no basis for
   * that.** An empty platform may stay empty. "None" is the fact the query
   * returned; "None yet" is the fact plus an assumption.
   *
   * It was surfaced by the absence-claim check as a false positive on a
   * DATA-empty state rather than a CAPABILITY claim — the two are genuinely
   * different, since a data state is re-evaluated on every render and cannot go
   * stale. **The check was left broad and the copy was corrected**, because the
   * correction is right on its own terms; see the check for the boundary.
   */
  'dashboard.none': 'None',
  'dashboard.countIsPartial': 'at least',
  'dashboard.partialExplain':
    'Core paginates this list and publishes no count, so this is the number on the first page rather than a total.',
  /*
   * ⚠ THIS KEY WAS `dashboard.templatesInert` AND SAID "Creating a business type
   * does not change what any customer sees yet." **I wrote it yesterday by
   * believing the notice on the Templates screen, which had been false for
   * days** — and translated it, so one wrong sentence acquired a second screen
   * and a second language before anybody checked it.
   *
   * That is `§12`'s residue propagating rather than merely persisting: a stale
   * claim read as fact by the next author is how it stops being one file's
   * problem. **The lesson I am keeping: prose in another screen is not a
   * source. `OnboardOrganization.tsx` sends `template_id`; that was checkable
   * in one grep and I did not run it.**
   */
  'dashboard.templatesAdopted':
    'A business type takes effect for an Organization that adopts it.',
  'dashboard.auditCost':
    'Reading a business’s own trail writes to that business’s daily allowance, so nothing here opens one.',
} as const;

/** Every key English declares. A translation set that omits one does not compile. */
export type MessageKey = keyof typeof en;

/**
 * ===========================================================================
 * `api/audit-window.ts` NAMES MESSAGE KEYS, AND THIS IS WHAT MAKES THAT SAFE
 * ===========================================================================
 *
 * That module returns keys instead of English prose, because it is called from
 * a submit handler where no component and therefore no locale exists. It cannot
 * import `MessageKey` — **`api/**` must not depend on a React context module**,
 * and dragging a provider dependency into the transport layer to borrow a type
 * would be a worse trade than the duplication it avoids.
 *
 * So it declares its own narrow union. **That is a second copy of a fact, and
 * an uncheckable one is exactly what this repository keeps finding** — a
 * restated constraint, a transcribed row count, a quoted line number. The
 * difference here is one line:
 *
 * **`WindowMessageKey extends MessageKey` is asserted at COMPILE TIME.** A key
 * that module invents, or one renamed here and not there, **does not build**.
 * `architecture.md` §3a: the obligation is a mechanism rather than something to
 * remember, and the alternative — a comment asking the next author to keep two
 * lists in step — is the discipline that rule exists to distrust.
 *
 * It is a type-level assertion with no runtime cost and no export. The `never`
 * arm is what carries it: if the union is not a subset, the conditional
 * resolves to `never` and the annotation is unsatisfiable.
 */
const WINDOW_KEYS_ARE_REAL: WindowMessageKey extends MessageKey ? true : never = true;
void WINDOW_KEYS_ARE_REAL;

/** Same bridge, same reason, for `api/errors.ts`. */
const ERROR_KEYS_ARE_REAL: ErrorMessageKey extends MessageKey ? true : never = true;
void ERROR_KEYS_ARE_REAL;

/** And for `api/platform.ts`'s four field refusals. */
const PLATFORM_KEYS_ARE_REAL: PlatformMessageKey extends MessageKey ? true : never = true;
void PLATFORM_KEYS_ARE_REAL;

/**
 * Arabic.
 *
 * **`Record<MessageKey, string>` is the enforcement.** Add a key to `en` and
 * this object fails to type-check until it is translated — the compiler names
 * the missing key and the file it is in.
 *
 * `locale.ar` is deliberately its own name in its own script in BOTH
 * dictionaries: a language picker that says "Arabic" to someone who does not
 * read English is a picker they cannot use.
 */
export const ar: Record<MessageKey, string> = {
  'app.title': 'إدارة منصّة دودو',
  'app.skipToContent': 'تخطَّ إلى المحتوى',

  'nav.label': 'الأقسام',
  'nav.dashboard': 'لوحة المعلومات',
  'nav.organizations': 'المنشآت',
  'nav.templates': 'أنواع الأعمال',
  'nav.operators': 'المشغّلون',
  'nav.audit': 'سجلّ المنصّة',
  'nav.openMenu': 'افتح قائمة الأقسام',
  'nav.closeMenu': 'أغلق قائمة الأقسام',
  'nav.signOut': 'تسجيل الخروج',
  'nav.signingOut': 'جارٍ تسجيل الخروج…',

  'locale.label': 'اللغة',
  'locale.en': 'English',
  'locale.ar': 'العربية',

  'state.loading': 'جارٍ التحميل…',
  'state.retry': 'أعد المحاولة',

  'templates.reach.title': 'أين يسري نوع العمل',
  'templates.reach.adopted':
    'التسميات أدناه هي الكلمات التي تراها المنشأة لكل مستوى. تسري على المنشأة التي اعتمدت نوع العمل هذا — تُضبط عند إضافتها، ويمكن تغييرها بعد ذلك.',
  'templates.reach.notTenantFacing':
    'تظهر هذه الكلمات في هذا النظام. لا تقرأها اليوم أي شاشة موجّهة للعملاء، لذا فتغيير تسمية هنا لا يغيّر ما يراه العميل.',

  'templates.nameHint': 'اسم نوع العمل كما يقرأه الإنسان. حتى',
  'templates.nameHintChars': 'حرفًا. يمكن تغييره لاحقًا.',
  'onboard.templateHint':
    'يحدّد الكلمات التي تراها هذه المنشأة لكل مستوى. يمكن تغييره لاحقًا، ويمكن إزالته.',

  'onboard.title': 'إضافة منشأة جديدة',
  'onboard.intro':
    'يُنشئ المنشأة، وأول مدير لها، وكلمة مرور ذلك المدير. تُولَّد كلمة المرور هنا وتُعرض مرّة واحدة.',

  'onboard.identifierLabel': 'البريد الإلكتروني لأول مدير',
  'onboard.identifierHint':
    'سيسجّل الدخول به. أحرف ASCII فقط؛ والمسافات تُرفض ولا تُحذف.',
  'onboard.nameLabel': 'اسم المنشأة — اختياري',
  'onboard.nameHintPrefix':
    'ما سيراه المشغّلون بدلًا من المعرّف. اتركه فارغًا إن لم يكن لديك — فهو والسجل التجاري ورقم القيمة المضافة تُسجَّل جميعها في صفحة المنشأة نفسها. بحدّ أقصى',
  'onboard.nameHintSuffix': 'حرفًا، والأسماء غير فريدة في دودو.',

  'onboard.templateLabel': 'نوع العمل',
  'onboard.templateRequired': 'اختر نوع العمل.',
  'onboard.templatesLoading': 'جارٍ تحميل أنواع الأعمال…',
  'onboard.templatesEmpty': 'لا توجد أنواع أعمال',
  'onboard.templatesChoose': 'اختر نوع العمل',
  'onboard.templatesFailed':
    'تعذّر تحميل أنواع الأعمال، فلا يمكن اختيار أي منها. أعد تحميل الصفحة للمحاولة مرّة أخرى.',
  'onboard.templatesNeeded':
    'لا يمكن إضافة منشأة قبل وجود نوع عمل واحد على الأقل. أنشئ واحدًا من قسم أنواع الأعمال أوّلًا.',

  'onboard.workspaceLead': 'تُنشأ مساحة العمل الأولى دون اسم.',
  'onboard.workspaceBody':
    'لا يطلب هذا النموذج اسمًا لمساحة العمل. تسمية مساحات العمل تخصّ واجهة هيكل المنشأة لا واجهة الإضافة، فالاسم المكتوب هنا سيُهمَل ولن يُحفظ.',

  'onboard.submitDeriving': 'يجري تحضير بيانات الدخول…',
  'onboard.submitSending': 'جارٍ الإنشاء…',
  'onboard.submit': 'أضف المنشأة',
  'onboard.shownOnce': 'تُعرض كلمة المرور مرّة واحدة ولا يمكن استرجاعها.',
  'onboard.creating': 'جارٍ إنشاء المنشأة في النواة…',
  'onboard.progressLabel': 'تحضير بيانات الدخول',

  'onboard.failed.conflict': 'هذا البريد الإلكتروني مستخدَم بالفعل',
  'onboard.failed.conflictBody':
    'البريد الإلكتروني الواحد يخصّ شخصًا واحدًا على مستوى المنصّة كلّها، ولهذا البريد حساب بالفعل.',
  'onboard.failed.conflictTail': 'استخدم عنوانًا آخر.',
  'onboard.failed.notFound': 'نوع العمل هذا لم يعد موجودًا',
  'onboard.failed.notFoundBody': 'قد يكون قد أُزيل منذ تحميل هذه الصفحة.',
  'onboard.failed.notFoundTail': 'أعد التحميل واختر من جديد.',
  'onboard.failed.quota': 'بلغت المنصّة حدّ عمليّات الكتابة',
  'onboard.failed.quotaBody': 'أجّلت النواة الكتابة بدل تنفيذها.',
  'onboard.failed.quotaTail': '— فلا توجد منشأة نصف مُنشأة تحتاج إلى تنظيف. حاول لاحقًا.',
  'onboard.failed.other': 'لم تُنشأ المنشأة',
  'onboard.failed.otherWarning':
    'راجع قائمة المنشآت قبل إعادة المحاولة — فإن كانت المنشأة قد أُنشئت فستفشل إعادة المحاولة بسبب البريد الإلكتروني وتضيع كلمة المرور الأولى.',
  'onboard.failed.nothingCreated': 'لم يُنشأ أي شيء.',
  'onboard.failed.nothingCreatedBare': 'لم يُنشأ أي شيء',

  'onboard.createdTitle': 'أُنشئت المنشأة',
  'onboard.record': 'سجّل كلمة المرور هذه الآن.',
  'onboard.recordWhy':
    'إنّها موجودة على هذه الشاشة فقط. لم تستلمها دودو ولا يمكنها عرضها مرّة أخرى — وإن ضاعت فالسبيل الوحيد للدخول هو أن يعيد مشغّل تعيين بيانات الدخول.',
  'onboard.signInWith': 'يسجّل الدخول بـ',
  'onboard.password': 'كلمة المرور',
  'onboard.businessType': 'نوع العمل',
  'onboard.organizationId': 'المنشأة',
  'onboard.administratorId': 'المدير',
  'onboard.workspaceId': 'مساحة العمل',
  'onboard.workspaceNotCreated': 'لم تُنشأ — راجع التنبيه أعلاه',
  'onboard.youWillKnow': 'ستظلّ تعرف كلمة المرور هذه إلى أن يُعاد تعيينها.',
  'onboard.noSelfService':
    'لا توفّر دودو تغييرًا ذاتيًّا لكلمة المرور، فلا يستطيع المدير استبدالها بنفسه — بل يجب أن يعيد مشغّل تعيين بيانات الدخول. أرسلها عبر قناة تأتمنها على كلمة مرور، وعاملها كأنّها مشتركة إلى حين ذلك.',
  'onboard.recordBeforeFollowing': 'سجّل كلمة المرور قبل أن تتبع هذا الرابط.',
  'onboard.identityMissing':
    'لا يوجد للمنشأة اسم ولا سجل تجاري ولا رقم قيمة مضافة مسجَّل — لم يسأل أحد، وهذا يختلف عن ألّا يكون لها شيء من ذلك.',
  'onboard.openBusiness': 'افتح هذه المنشأة لتسجيلها',
  'onboard.leavingLoses': 'مغادرة هذه الشاشة تُفقدك كلمة المرور.',
  'onboard.dismissAsk': 'هل سجّلت كلمة المرور؟ لا يمكن عرضها مرّة أخرى.',
  'onboard.dismissYes': 'نعم، سجّلتها',
  'onboard.dismissNo': 'لا، أبقِها على الشاشة',
  'onboard.dismissStart': 'لقد سجّلت كلمة المرور',

  'onboard.warning.title': 'أُنشئت المنشأة، ولم يكتمل جزء من الإعداد.',
  'onboard.warning.unknownLead': 'أُعيد تنبيه غير معروف:',
  'onboard.warning.unknownBody':
    'لا تعرف هذه اللوحة ما يعنيه، ما يدلّ على أنّ النواة تُبلغ عن شيء أحدث من هذه النسخة. أبلغ عن ذلك.',
  'onboard.warning.workspaceLead': 'لم تُنشأ مساحة العمل الأولى.',
  'onboard.warning.workspaceBody':
    'المنشأة موجودة ويمكن الدخول إليها، لكن لا مساحة عمل لها، ولا يستطيع العميل استخدام المنتج قبل وجود واحدة. أبلغ عن ذلك.',
  'onboard.warning.auditLead': 'لم يُكتب سجلّ التدقيق الخاصّ بالعميل.',
  'onboard.warning.auditBody':
    'سجّلت المنصّة هذا الإجراء، لكن سجلّ المنشأة نفسها لم يسجّله — فلا يملك العميل ما يثبت أنّ منشأته أُنشئت. أبلغ عن ذلك.',

  /* `{days}` and `{span}` are filled by `fill` — see the English block. */
  'window.required.title': 'يحتاج هذا البحث إلى نطاق زمني',
  'window.required.body':
    'التصفية حسب المشغّل أو الإجراء تتطلّب تاريخ بداية وتاريخ نهاية معًا، بفارق {days} يومًا على الأكثر. ترفض دودو البحث المُصفّى المفتوح بدل تضييقه بصمت — فالجواب المُضيَّق بصمت لا يمكن تمييزه عن جواب فارغ، وفي سجلّ التدقيق هذا هو الفرق بين «لم يحدث شيء» و«لم نبحث».',
  'window.tooWide.title': 'هذا النطاق أطول من {days} يومًا',
  'window.tooWide.body':
    'أقصى ما يمكن البحث فيه دفعة واحدة هو {days} يومًا. ابحث شهرًا في كل مرّة وارجع إلى الوراء — فالأزرار أدناه تنقل النطاق بمقدار طوله دون إعادة كتابته. لم يُبحث في شيء.',
  'window.inverted.title': 'نهاية هذا النطاق تسبق بدايته',
  'window.inverted.body': 'بدّل التاريخين. لم يُبحث في شيء.',

  'window.local.bothOrNeither':
    'أدخل التاريخين معًا أو لا تُدخل أيًّا منهما. التاريخ الواحد ليس نطاقًا، وترفضه دودو بدل أن تخمّن الطرف الآخر.',
  'window.local.required':
    'التصفية حسب المشغّل أو الإجراء تحتاج إلى نطاق زمني — بطرفيه، وبفارق {days} يومًا على الأكثر. ترفض دودو البحث المُصفّى المفتوح بدل تضييقه بصمت، لأنّ الجواب المُضيَّق يبدو تمامًا كالجواب الفارغ.',
  'window.local.notADate': 'أحد هذين التاريخين ليس تاريخًا صحيحًا.',
  'window.local.inverted': 'نهاية النطاق تسبق بدايتها.',
  'window.local.tooWide':
    'هذا النطاق {span} يومًا. أقصى ما يمكن البحث فيه دفعة واحدة هو {days} — ابحث شهرًا في كل مرّة وارجع إلى الوراء.',

  'window.joiner': 'إلى',

  'audit.filter.operator': 'المشغّل',
  'audit.filter.operatorHint': 'معرّف مبدأ. يصفّي حسب من نفّذ الإجراء، لا حسب من نُفّذ عليه.',
  'audit.filter.operatorPlaceholder': 'معرّف المبدأ',
  'audit.filter.action': 'الإجراء',
  'audit.filter.actionHint': 'معرّف إجراء، مثل platform.audit.list.',
  'audit.filter.from': 'من (بتوقيت UTC)',
  'audit.filter.fromHint': 'أيام كاملة بتوقيت UTC.',
  'audit.filter.to': 'إلى (بتوقيت UTC)',
  'audit.filter.toHint': 'شامل اليوم كلّه.',
  'audit.windowRule':
    'التصفية حسب المشغّل أو الإجراء تحتاج إلى نطاق زمني لا يتجاوز {days} يومًا. ومن دون تصفية يمكنك البحث في السجلّ كلّه بلا حدّ.',
  'audit.apply': 'طبّق التصفية',
  'audit.earlierWindow': 'النطاق الأسبق',
  'audit.laterWindow': 'النطاق الأحدث',
  'audit.clear': 'مسح',
  'audit.applyResets': 'التطبيق يعيدك إلى أحدث صفحة. وقراءة كل صفحة تُسجَّل بذاتها.',
  'audit.newest': 'الأحدث',
  'audit.older': 'الأقدم',
  'audit.noMorePages': 'لا صفحات أخرى',
  'audit.page': 'صفحة {page}',
  'audit.noTarget': 'لا شيء',

  'audit.empty.inWindow': 'لا سجلّات في هذا النطاق.',
  'audit.empty.filtered': 'لا سجلّات تطابق هذه التصفية.',
  'audit.empty.filteredBody': 'أجابت النواة، ولا شيء في السجلّ يطابق. وسّع التصفية أو امسحها.',
  'audit.empty.windowLead': 'أجابت النواة، ولا شيء يطابق ضمن',
  /* Arabic ends the clause with the next sentence; no stop after the range. */
  'audit.empty.windowStop': '،',
  'audit.empty.windowNotSearched':
    'وهذا ليس حكمًا على أي فترة أخرى — فالسجلّات خارج هذا النطاق لم يُبحث فيها. استخدم',
  'audit.empty.windowKeepLooking': 'لمواصلة البحث.',

  'audit.showing.zero': 'لا سجلّات معروضة',
  'audit.showing.one': 'يُعرض سجلّ واحد',
  'audit.showing.two': 'يُعرض سجلّان',
  'audit.showing.few': 'تُعرض {count} سجلّات',
  'audit.showing.many': 'يُعرض {count} سجلًّا',
  'audit.showing.other': 'يُعرض {count} سجلًّا',

  'platformAudit.title': 'تدقيق المنصّة',
  'platformAudit.intro':
    'كل إجراء نفّذه مشغّل المنصّة، الأحدث أوّلًا. من نفّذ، وعلى أي منشأة، وبأي نتيجة.',
  'platformAudit.noTargetPerson': 'لا يذكر عن أي شخص كان الإجراء',
  'platformAudit.noTargetPersonWhere':
    '— ولمعرفة ذلك افتح المنشأة واقرأ سجلّها الخاص، وهو ما يُسجَّل أنّك فعلته.',
  'platformAudit.noPersonFilter':
    'لا توجد عمدًا تصفية حسب الشخص الذي كان الإجراء عنه. فالتصفية حسب شخص وعدّ النتائج تكشف المنشآت التي ينتمي إليها، جوابًا بعد جواب — وهو تحديدًا ما يمنعه حذف ذلك العمود من هذا السجلّ.',
  'platformAudit.targetColumn': 'المنشأة',
  'platformAudit.empty.title': 'السجلّ فارغ.',
  'platformAudit.empty.body':
    'أجابت النواة، ولم يُسجَّل أي إجراء لمشغّل. وقراءة هذه الصفحة تُسجَّل بذاتها — فأول قيد هنا سيكون عادةً شخصًا يقرؤها.',

  'orgAudit.back': 'العودة إلى هذه المنشأة',
  'orgAudit.title': 'سجلّ التدقيق',
  'orgAudit.intro':
    'كل إجراء نفّذه مشغّل المنصّة وأثّر في هذه المنشأة، الأحدث أوّلًا — بما في ذلك الشخص الذي سمّاه كل إجراء.',
  'orgAudit.costLead': 'قراءة هذا السجلّ تكتب فيه.',
  'orgAudit.costBody':
    'كل صفحة تكلّف خمس عمليّات كتابة من الحصّة اليوميّة الخاصّة بهذه المنشأة، وتترك في سجلّها قيدًا يفيد بأنّ المنصّة اطّلعت عليه. وهذا مقصود — إذ ينبغي أن يرى العميل أنّه قد جرى الاطّلاع عليه. ويعني ذلك أيضًا أنّك ستجد هنا زياراتك السابقة، وأنّ لا شيء في هذه الشاشة يُحدَّث تلقائيًّا.',
  'orgAudit.filter.actionHint': 'معرّف إجراء.',
  'orgAudit.filter.toHint': 'شامل.',
  'orgAudit.windowRule':
    'التصفية حسب الإجراء تحتاج إلى نطاق زمني لا يتجاوز {days} يومًا. أمّا قراءة سجلّ هذه المنشأة كاملًا فلا تحتاج إلى نطاق.',
  'orgAudit.read': 'اقرأ السجلّ',
  'orgAudit.applyAndRead': 'طبّق التصفية واقرأ',
  'orgAudit.targetColumn': 'الشخص',
  'orgAudit.pageCost': 'كل صفحة تعني خمس عمليّات كتابة إضافيّة على حساب هذه المنشأة.',
  'orgAudit.notFound': 'لا توجد منشأة بهذا المعرّف.',

  'orgAudit.idle.title': 'لم يُقرأ شيء.',
  'orgAudit.idle.body':
    'لا تُحمّل هذه الشاشة من تلقاء نفسها، لأنّ فتحها ينفق من حصّة العميل. اضغط',
  'orgAudit.idle.bodyTail': 'عند الحاجة.',

  'orgAudit.empty.title': 'لم يحدث شيء هنا.',
  'orgAudit.empty.body':
    'أجابت النواة، ولم تتّخذ المنصّة أي إجراء مسجَّل تجاه هذه المنشأة. وهذه القراءة صارت الآن جزءًا من السجلّ.',
  'orgAudit.empty.filteredBody': 'أجابت النواة، ولا شيء في هذا السجلّ يطابق.',
  'orgAudit.empty.windowLead': 'أجابت النواة، ولا شيء في سجلّ هذه المنشأة يطابق ضمن',
  'orgAudit.empty.windowNotSearched':
    'ولم يُبحث في السجلّات خارج هذا النطاق، فهذا لا يقول شيئًا عن أي فترة أخرى.',

  'orgAudit.reads.zero': 'لا قراءات في هذه الزيارة',
  'orgAudit.reads.one': 'قراءة واحدة في هذه الزيارة',
  'orgAudit.reads.two': 'قراءتان في هذه الزيارة',
  'orgAudit.reads.few': '{count} قراءات في هذه الزيارة',
  'orgAudit.reads.many': '{count} قراءةً في هذه الزيارة',
  'orgAudit.reads.other': '{count} قراءةً في هذه الزيارة',

  'error.title.fallback': 'حدث خطأ ما',
  'error.title.invalidArgument': 'راجع ما أُرسل',
  'error.title.unauthenticated': 'يلزم تسجيل الدخول',
  'error.title.forbidden': 'لن تنفّذ هذه اللوحة ذلك',
  'error.title.notFound': 'هذا غير موجود هنا',
  'error.title.conflict': 'هذا يتعارض مع شيء موجود بالفعل',
  'error.title.failedPrecondition': 'هذا غير ممكن في هذه الحالة',
  'error.title.quotaExceeded': 'بلغت المنصّة أحد حدودها',
  'error.title.rateLimited': 'طلبات كثيرة في وقت قصير',
  'error.title.internal': 'حدث خطأ لدينا',
  'error.title.unavailable': 'دودو غير متاحة مؤقّتًا',
  'error.title.timeout': 'استغرق ذلك وقتًا طويلًا',

  'error.body.unauthenticated': 'جلستك كمشغّل غير نشطة. سجّل الدخول وأعد المحاولة.',
  /* Says WHAT was refused, never WHY — see the English block on the four
     collapsed conditions. Softening this into "you are not an operator" would
     make the sentence false on one of them and probeable on another. */
  'error.body.forbidden':
    'رفضت النواة هذا الطلب لهذا المبدأ. الرفض غير محدّد عمدًا، ولا تستطيع هذه اللوحة إخبارك بأي شرط أدّى إليه. اعرض الأمر على قائد الفريق بدل إعادة المحاولة.',
  'error.body.notFound': 'قد يكون المعرّف خاطئًا، أو يكون العنصر قد أُزيل.',
  'error.body.failedPrecondition': 'شيء يعتمد عليه هذا ليس في الحالة المطلوبة.',
  'error.body.rateLimited': 'انتظر لحظة وأعد المحاولة.',
  'error.body.rateLimitedFor': 'انتظر نحو {seconds} ثم أعد المحاولة.',
  'error.body.unavailable': 'عادةً ما يكون هذا وجيزًا. أعد المحاولة بعد قليل.',
  'error.body.timeout': 'لم يكتمل الطلب. أعد المحاولة.',
  'error.body.internal': 'سُجِّلت المشكلة. أعد المحاولة بعد قليل.',
  'error.body.nothingChanged':
    'لم يتغيّر شيء، فلم يُرسل شيء. فتعديل حقل ثم حفظه دون تغيير كان سينفق خمسًا من عمليّات الكتابة اليوميّة لهذه المنشأة.',

  /* «ترفضها ولا تحذفها» — refuses rather than trims. See the English block:
     softening this would describe behaviour the code does not have. */
  'refusal.templateName.empty': 'أعطِ نوع العمل اسمًا.',
  'refusal.templateName.padded':
    'احذف المسافات من بداية الاسم أو نهايته — فدودو ترفضها ولا تحذفها نيابةً عنك.',
  'refusal.templateName.tooLong': 'لا يمكن أن يتجاوز الاسم {max} حرفًا.',
  'refusal.templateLabel.padded': 'احذف المسافات من بداية التسمية أو نهايتها.',
  'refusal.templateLabel.tooLong': 'لا يمكن أن تتجاوز التسمية {max} حرفًا.',
  'refusal.displayName.empty': 'لا يمكن أن يكون الاسم فارغًا.',
  'refusal.displayName.padded':
    'لا يمكن أن يبدأ الاسم بمسافة أو ينتهي بها. اكتبه من دون مسافات زائدة بدل الاعتماد على دودو لحذفها.',
  'refusal.displayName.tooLong': 'يمكن أن يبلغ الاسم {max} حرفًا على الأكثر. وهذا {length}.',
  'refusal.registration.empty': 'اكتب الرقم، أو اختر إحدى الحالتين الأخريين.',
  'refusal.registration.tooLong':
    'يمكن أن يبلغ رقم السجل {max} حرفًا على الأكثر. وهذا {length}.',
  'refusal.registration.pattern':
    'استخدم الحروف والأرقام والمسافات والشرطات فقط، ولا تبدأ أو تنتهِ بمسافة أو شرطة. تسجّل دودو الرقم كما تصدره الجهة المُصدِرة ولا تتحقّق من شيء آخر في شكله.',

  'gate.whatWillHappen': 'ما الذي سيحدث',
  /* Tells an Arabic reader, in Arabic, that the sentence above is English and
     is shown untranslated on purpose. See the English block. */
  'gate.statementLanguageLead': 'الجملة أعلاه بالإنجليزيّة.',
  'gate.statementLanguageBody':
    'تكتبها دودو وتعرضها هذه اللوحة كما هي تمامًا دون ترجمة — فالجملة المترجمة ليست الجملة التي تطلب منك دودو الموافقة عليها. اقرأها قبل الموافقة.',
  'gate.wrongLocale.title': 'هذه الجملة ليست باللغة التي طلبتها هذه اللوحة',
  'gate.wrongLocale.body':
    'أعادتها دودو بلغة {got} بينما طلبت هذه اللوحة {expected}. ولن تطلب منك الموافقة على جملة لا تستطيع ضمانها.',
  'gate.wrongLocale.nothingChanged': 'لم يتغيّر أي شيء.',
  'gate.wrongLocale.report': 'أبلغ عن هذا بدل إعادة المحاولة.',
  'gate.expiresAt': 'تنتهي صلاحيّة هذه الموافقة في',
  'gate.confirmWithLead': 'أكّد باستخدام',
  'gate.confirmWithYourOwn': 'بيانات دخولك أنت',
  'gate.confirmWithTail': '— لا بيانات الحساب الذي يجري تغييره.',
  'gate.emailLabel': 'بريدك الإلكتروني',
  'gate.emailHint': 'العنوان الذي سجّلت الدخول به.',
  'gate.passwordLabel': 'كلمة مرورك',
  'gate.approve': 'موافقة',
  'gate.checking': 'يجري التحقّق من كلمة مرورك…',
  'gate.carryingOut': 'يجري التنفيذ…',
  'gate.progressLabel': 'التحقّق من كلمة مرورك',
  'gate.cancel': 'إلغاء',
  'gate.close': 'إغلاق',
  'gate.failedNothingChanged': 'لم يتغيّر أي شيء. أغلق هذا وابدأ من جديد إن كنت لا تزال بحاجة إليه.',

  /* Institution names, not phrases — see the English block. */
  'identity.cr.label': 'السجل التجاري',
  'identity.cr.short': 'السجل التجاري',
  'identity.cr.registry': 'سجلات',
  'identity.cr.noneMeans': 'كيانًا لا سجل تجاري له',
  'identity.vat.label': 'التسجيل في ضريبة القيمة المضافة',
  'identity.vat.short': 'تسجيل ضريبة القيمة المضافة',
  'identity.vat.registry': 'الجهاز الوطني للإيرادات',
  'identity.vat.noneMeans':
    'منشأة دون حدّ التسجيل في ضريبة القيمة المضافة، والتسجيل بالنسبة إليها اختياري',

  'identity.intro':
    'الاسم الذي تعرضه دودو لهذه المنشأة، والتسجيلان الحكوميّان اللذان تحفظهما المنصّة. تُدخَل هذه القيم يدويًّا — فلا يوجد ربط مع «سجلات» ولا مع الجهاز الوطني للإيرادات، وكل قيمة هنا كتبها شخص.',
  'identity.savedWholeRecord': 'أجابت النواة بالسجلّ كاملًا، وهو المعروض أدناه.',
  'identity.nameLabel': 'الاسم',
  'identity.recordedOn': 'سُجِّل في',

  'identity.notRecorded.body': 'لم يسأل أحد، أو لم يُدخل أحد الجواب.',
  'identity.notRecorded.notNone': 'وهذا لا يعني أنّه ليس لديهم {kind} — بل يعني أنّ دودو لا تعرف.',
  'identity.notRegistered.states': 'يفيد العميل بأنّه ليس لديه {kind}.',
  'identity.notRegistered.answerNotGap': 'وهذا جواب لا فراغ — وغالبًا ما يعني {meaning}. وهو يؤرّخ',
  'identity.notRegistered.itDates': 'تسجيل دودو لهذا الإفادة',
  'identity.notRegistered.notCircumstances':
    '، لا ظروف المنشأة نفسها: فتسجيل المنشأة غدًا لا يجعل هذا خاطئًا، بل يجعله قديمًا.',

  'identity.notVerified.body':
    'كتب أحدهم هذا الرقم. ولم يؤكّده أحد لدى {registry}. عامله كإفادة من العميل لا كحقيقة متحقَّق منها.',
  'identity.verified.title': 'متحقَّق منه لدى {registry}',
  'identity.verified.checkedBy': 'تحقّق منه',
  'identity.verified.on': 'في',
  'identity.verified.noApi':
    '. لا تستطيع دودو تأكيد أنّ التحقّق قد جرى — إذ لا توجد واجهة برمجيّة لـ{registry} — فهذه إفادة من مشغّل مُسمّى عن هذا الرقم بالذات، وتُلغى تلقائيًّا إن تغيّر الرقم.',

  'identity.twoAnswers':
    '«غير مسجَّل» و«ليس لديهم» جوابان مختلفان، وتفصل دودو بينهما. واختيار الثاني يسجّل أنّ العميل أخبرك بذلك، بتاريخ اليوم.',
  'identity.choice.notRecorded': 'غير مسجَّل — لم يسأل أحد',
  'identity.choice.notRegistered': 'ليس لديهم {kind}',
  'identity.choice.registered': 'لديهم واحد، ورقمه',
  'identity.numberLabel': 'رقم {kind}',
  'identity.numberHint':
    'كما تصدره {registry}. حروف وأرقام ومسافات وشرطات، بحدّ أقصى {max} حرفًا. ولا تتحقّق دودو من شيء آخر في شكله — فلا يوجد عدد محدّد للأرقام، وذلك عن قصد، لأنّ عددًا خاطئًا سيرفض تسجيلًا نظاميًّا.',

  'identity.verificationCleared.why':
    'التحقّق يشهد لرقم واحد بعينه، فلا يمكن أن ينتقل إلى هذا الرقم — وقد أُزيلت العلامة أدناه.',
  'identity.verificationCleared.tickAgainBefore': 'لا تضع العلامة مجدّدًا إلا إذا تحقّقت من',
  'identity.theNewNumber': 'الرقم الجديد',
  'identity.verificationCleared.tickAgainAfter': 'لدى {registry}.',
  /* First person, deliberately — see the English block. */
  'identity.verifyClaim': 'لقد تحقّقت من هذا الرقم لدى {registry}.',
  'identity.verifyClaim.what':
    'تسجّل دودو معرّف مبدئك وتاريخ اليوم مقابل هذا الرقم بالذات. ولا شيء يتحقّق من ذلك نيابةً عنك.',
  'identity.untickRemoves.what':
    'يبقى الرقم؛ أمّا سجلّ من تحقّق منه ومتى فيُتلَف ولا يمكن استرجاعه.',
  'identity.redeclare.what':
    'يعيد تأريخ الإفادة إلى الآن. ومن دون ذلك يترك الحفظ التاريخ الأصلي كما هو — وهو غالبًا ما تريده، لأنّ التاريخ يسجّل متى قالوا ذلك.',
  'identity.destroys.what':
    'يُزال الرقم وتاريخه وأي تحقّق منه، ولا يمكن استرجاع ذلك. ويسجّل سجلّ التدقيق أنّ تغييرًا قد حدث، لا ما الذي ضاع. استخدمه لتصحيح خطأ، لا لإفراغ حقل لست متأكّدًا منه.',

  'identity.failed.forbidden': 'لا يجوز لك تغيير هذا',
  'identity.failed.forbiddenBody':
    'رفضت النواة الطلب. فتغيير هويّة منشأة يتطلّب صلاحيّة لا يملكها دورك كمشغّل.',
  'identity.failed.forbiddenTail': 'اعرض الأمر على قائد الفريق بدل إعادة المحاولة.',
  'identity.failed.notFound': 'لم تعد هذه المنشأة موجودة',
  'identity.failed.notFoundBody': 'قد تكون قد أُزيلت منذ تحميل هذه الصفحة.',
  'identity.failed.quota': 'بلغ حدّ عمليّات الكتابة',
  'identity.failed.quotaBody': 'أجّلت النواة الكتابة بدل تنفيذها.',
  'identity.failed.quotaTail':
    'وهذا ينفق من الحصّة اليوميّة الخاصّة بالمنشأة، فسيتعافى من تلقاء نفسه. حاول لاحقًا.',
  'identity.failed.other': 'لم يُحفظ شيء',

  /* Shown, not gated — the sentence ends with why the act is still offered. */
  'orgTemplate.statusNotice': 'حالة هذه المنشأة',
  'orgTemplate.statusUnknown': 'لا تتعرّف هذه اللوحة على حالة هذه المنشأة:',
  'orgTemplate.statusWhy':
    'ومع ذلك يظلّ تغيير نوع عملها مسموحًا — إذ يمكن تصحيح الإعدادات من دون استعادة وصول العميل أوّلًا، وهذا هو الترتيب الأسلم.',

  'detail.loading': 'يجري سؤال النواة عن هذه المنشأة…',
  'detail.notFound.title': 'هذه المنشأة غير موجودة',
  'detail.notFound.before': 'لا يوجد في المنصّة شيء بالمعرّف',
  'detail.notFound.after':
    '. ربّما كُتب خطأً، أو يكون العنوان يخصّ منشأة لم تُنشأ قطّ.',
  'detail.forbidden.title': 'لا يجوز لك قراءة هذه المنشأة',
  /* «رفضت» لا «غير موجودة» — a refusal is not an absence. See the English block. */
  'detail.forbidden.body':
    'رفضت النواة الطلب نفسه، وهذا يختلف عن كون المنشأة غير موجودة. فهذا يتطلّب صلاحيّة عرض قائمة المنشآت. اطلبها بدل إعادة المحاولة — فلا شيء هنا سيتغيّر قبل منحها.',

  'detail.noMemberList.lead': 'لا توجد قائمة بالأعضاء، وذلك عن قصد.',
  'detail.noMemberList.why':
    'تستطيع المنصّة عدّ أعضاء المنشأة لكنّها لا تستطيع تسميتهم. فالعدد يبيّن ما إذا كانت الإضافة قد نجحت وما إذا كانت المنشأة مستخدَمة؛ أمّا القائمة، عبر كل منشأة يستطيع المشغّل تعدادها أصلًا، فتعيد بناء عضويّة كل شخص في المنشآت. استخدم البحث أدناه حين يعطيك العميل معرّفًا.',

  'detail.lookup.title': 'البحث عن عضو',
  'detail.lookup.intro':
    'لمعرّف أعطاك إيّاه العميل. يعيد معرّف مبدأ ذلك الشخص ودوره، وهو ما تحتاجه إعادة تعيين بيانات الدخول.',
  /* «يُسجَّل في» لا «يراه» — recorded in, not visible to. See the English block. */
  'detail.lookup.recorded':
    'كل عمليّة بحث تُسجَّل في سجلّ التدقيق الخاص بهذه المنشأة، بما في ذلك العمليّات التي لا تجد شيئًا.',
  'detail.lookup.emailLabel': 'البريد الإلكتروني',
  'detail.lookup.submit': 'ابحث',
  'detail.lookup.looking': 'جارٍ البحث…',
  'detail.lookup.onePerPress': 'عمليّة بحث واحدة لكل ضغطة.',
  'detail.lookup.found': 'هذا الشخص عضو في هذه المنشأة.',
  'detail.lookup.principalId': 'معرّف المبدأ',
  'detail.lookup.role': 'الدور',
  'detail.lookup.forbidden.title': 'لا يجوز لك استخدام هذا البحث',
  'detail.lookup.forbidden.body':
    'رفضت النواة الطلب نفسه، وهذا يختلف عن ألّا يُعثر على شيء. فهذا البحث يتطلّب صلاحيّة إعادة تعيين بيانات الدخول — ومن دونها يكون تحديد الأشخاص مغلقًا أمامك. ولم يُبحث عن شيء. اعرض الأمر على قائد الفريق بدل إعادة المحاولة.',

  'operators.intro': 'كل مبدأ يملك صلاحيّة على المنصّة، والدور الذي يحمله كل منهم.',
  'operators.revoked.title': 'أُزيلت الصلاحيّة على المنصّة.',
  'operators.revoked.noLonger': 'لم يعد يملك صلاحيّة على المنصّة.',
  /* «ولا يوجد مسار يعيدها» — irreversible. Softening this is the hazard. */
  'operators.revoked.wasSelf':
    'كان ذلك حسابك أنت — وسيُرفض طلبك التالي، ولا يوجد مسار يعيد هذه الصلاحيّة.',
  'operators.remaining.zero': 'لم يبقَ أي مشغّل.',
  'operators.remaining.one': 'بقي مشغّل واحد.',
  'operators.remaining.two': 'بقي مشغّلان.',
  'operators.remaining.few': 'بقي {count} مشغّلين.',
  'operators.remaining.many': 'بقي {count} مشغّلًا.',
  'operators.remaining.other': 'بقي {count} مشغّلًا.',
  'operators.empty.title': 'لا يوجد مشغّلون مدرجون.',
  'operators.empty.body':
    'أجابت النواة بقائمة فارغة، وهذا ينبغي أن يكون مستحيلًا — فأنت تقرأ هذا عبر جلسة مشغّل، أي أنّ واحدًا على الأقل موجود. أبلغ عن ذلك.',
  'operators.noNames.lead': 'لا توجد هنا أسماء ولا عناوين بريد إلكتروني.',
  'operators.noNames.why':
    'لا تحفظ دودو بيانات شخصيّة مقابل مبدأ خارج نطاق منشأة، فقائمة مشغّلين تعرض بيانات اتصال ستكون بالضبط الدليل الذي رفضه ذلك القرار — وفي أكثر أطراف المنصّة امتيازًا. أنت تعرف نفسك من العلامة أعلاه؛ أمّا تمييز الزملاء عن بعضهم فيحتاج أسماء عرض لا تحفظها دودو.',
  'operators.removing.lead': 'إزالة مشغّل',
  'operators.removing.what':
    'تسأل دودو عمّا ستفعله، وتعرض عليك تلك الجملة، وتتطلّب كلمة مرورك أنت. ولا يمكن التراجع عنها من هنا — إذ لا يوجد مسار يمنح صلاحيّة على المنصّة.',
  'operators.self.lead': 'هذا حسابك أنت.',
  'operators.self.what':
    'إزالة صلاحيّتك على المنصّة تُخرجك من كل شيء هنا، ولا يوجد مسار يعيدها — بل يجب إعادة تهيئتها خارج النظام.',
  'operators.self.maybeLast': 'وقد تكون أيضًا آخر مشغّل.',
  'operators.revoke.title': 'إزالة الصلاحيّة على المنصّة',
  'operators.revokeSelf.title': 'إزالة صلاحيّتك أنت على المنصّة',

  'page.startAgain': 'ابدأ من الصفحة الأولى',
  'page.emptyPage': 'أجابت النواة، وهذه الصفحة فارغة. ابدأ من الصفحة الأولى.',

  'templates.existing': 'أنواع الأعمال الموجودة',
  'templates.empty.body':
    'أجابت النواة، ولم يُنشأ أي نوع. والقائمة الفارغة ليست قائمة مفقودة — فهذا ما تحتويه المنصّة حاليًّا.',
  'templates.create.title': 'إنشاء نوع عمل',
  'templates.create.submit': 'أنشئ نوع العمل',
  'templates.creating': 'جارٍ الإنشاء…',
  'templates.namePlaceholder': 'مدرسة',
  'templates.create.permanence':
    'يمكن تغيير اسمه وإيقافه لاحقًا، لكن لا يمكن حذفه أبدًا — فالإيقاف يُبقي الاسم محجوزًا.',
  'templates.created.before': 'أُنشئ',
  'templates.created.after': '. ويسري على المنشأة التي تعتمده.',
  'templates.levels.legend': 'اسم كل مستوى',
  'templates.levels.labelsOnly':
    'هذه تغيّر الكلمات التي يقرؤها العميل فقط. ولا تغيّر الصلاحيّات ولا الهيكل ولا أي شيء يستطيع المستأجر فعله. اترك أيّها فارغًا للإبقاء على الاسم الافتراضي.',
  /* The platform's own level names — see the English block. */
  'templates.level.organization': 'المنشأة',
  'templates.level.workspace': 'مساحة العمل',
  'templates.level.branch': 'الفرع',
  'templates.levelHint.organization':
    'مجموعة مدارس تعرض «مجموعة»، وعيادة «ممارسة»، وشركة «شركة».',
  'templates.levelHint.workspace': 'مدرسة تعرض «حرم»، ومتجر «فرع»، وعيادة «موقع».',
  'templates.levelHint.branch': 'المستوى الذي يلي مساحة العمل.',

  'organizations.empty.body':
    'أجابت النواة، ولا توجد لدى المنصّة أي منشأة. وهذا ليس إخفاقًا في التحميل — فالمنشأة تظهر هنا عند إضافتها.',
  'organizations.tableCaption':
    'المنشآت الموجودة على المنصّة، مع اسمها إن كان مسجَّلًا، ومعرّفها، وحالتها، وتاريخ إنشائها.',

  /* Whose allowance it is — see the English block. Merging these produces a retry. */
  'ceiling.rate.org.title': 'قرأ المشغّلون سجلّ هذه المنشأة بما يكفي لهذا اليوم',
  'ceiling.rate.org.before':
    'قراءة هذا السجلّ تكتب فيه، وقد استُنفدت حصّة المنصّة من يوم هذه المنشأة.',
  'ceiling.rate.org.whose': 'هذا يخصّ نشاط المشغّلين، لا العميل',
  'ceiling.rate.org.after':
    '— فقد قرأ أحدهم، وربّما أنت، ما يكفي ليوم واحد. وقد يكون مشغّل آخر في منتصف تحقيق.',
  'ceiling.rate.platform.title': 'قُرئ هذا السجلّ بما يكفي لهذا اليوم',
  'ceiling.rate.platform.before': 'قراءة السجلّ تكتب فيه، وقد استُنفدت الحصّة المخصّصة لذلك حاليًّا.',
  'ceiling.rate.platform.whose': 'هذا يخصّ نشاط المشغّلين',
  'ceiling.rate.platform.after': '، لا أي عميل.',
  'ceiling.quota.org.title': 'بلغت هذه المنشأة حدّها اليومي الخاص',
  'ceiling.quota.org.whose': 'هذا يخصّ العميل، لا يخصّك أنت.',
  'ceiling.quota.org.after':
    'فقد بلغت المنشأة حصّتها اليوميّة من عمليّات الكتابة، وقراءة هذا السجلّ تتطلّب كتابة فيه. ولا شيء يفعله المشغّل يزيل ذلك — إذ يُعاد ضبطه عند 00:00 بتوقيت UTC، وإعادة المحاولة الآن تنفق ما تبقّى للعميل على رفض.',
  'ceiling.quota.platform.title': 'بلغت المنصّة حدّها اليومي الخاص',
  'ceiling.quota.platform.whose': 'هذه حصّة المنصّة نفسها',
  'ceiling.quota.platform.after':
    '، لا حصّة عميل. ويُعاد ضبطها عند 00:00 بتوقيت UTC. وإعادة المحاولة الآن لن تفيد.',
  'ceiling.waitAbout': 'تقترح النواة الانتظار نحو {seconds}.',

  /* Says the password was accepted — see the English block. */
  'session.refused.title': 'لا يستطيع هذا الحساب استخدام هذه اللوحة',
  'session.refused.body':
    'أنت مسجَّل الدخول — وقد قُبلت كلمة مرورك — وقد رفضت دودو هذه اللوحة لحسابك.',
  'session.refused.noReason':
    'لا تذكر دودو السبب، وذلك عن قصد، ولا تستطيع هذه اللوحة معرفته. وإعادة تسجيل الدخول لن تغيّر ذلك — اسأل من يدير المنصّة.',
  'session.probeFailed.notSignedOut':
    'هذا لا يعني أنّك خرجت من حسابك — بل تعذّر سؤال دودو. وقد تكون جلستك لا تزال نشطة.',
  'session.signOutInstead': 'سجّل الخروج بدلًا من ذلك',

  'notBuilt.badge': 'غير مبني',
  'notBuilt.nothing': 'لا يوجد شيء لعرضه هنا.',
  'notBuilt.noRequest':
    'لا يرسل هذا القسم أي طلب إلى النواة ولا يعرض أي بيانات — حقيقيّة كانت أو غيرها.',
  'notBuilt.contract': 'العقد',
  'notBuilt.noneDrafted': 'لم يُصَغ أي عقد.',
  'notBuilt.status': 'الحالة',
  'notBuilt.waitingOn': 'في انتظار',

  /* «بنيويّ لا إعداد» — structural, not a setting. See the English block. */
  'shell.noTenantReach':
    'المشغّل لا ينتمي إلى أي منشأة ولا يستطيع الوصول إلى سجلّات العملاء. وهذا أمر بنيويّ لا إعداد يمكن تغييره.',

  'signIn.kdfExplainer':
    'تُحوَّل كلمة مرورك إلى مفتاح داخل هذا المتصفّح، ولا تُرسل كلمة المرور نفسها إلى دودو أبدًا. ويستغرق ذلك ثانية أو ثانيتين، وهو التوقّف الذي ستلاحظه.',

  /* Column headers and short buttons — invisible to the pin's three-word floor. */
  'nav.menu': 'القائمة',
  'app.subtitle': 'إدارة المنصّة',
  'page.firstPage': 'الصفحة الأولى',
  'audit.correlation': 'الارتباط',
  'column.identifier': 'المعرّف',
  'column.status': 'الحالة',
  'column.created': 'تاريخ الإنشاء',
  'column.members': 'الأعضاء',
  'operators.granted': 'مُنحت في',
  'operators.removeAuthority': 'إزالة الصلاحيّة',
  'detail.template.none':
    'لا يوجد نوع مسجَّل. أُنشئت هذه المنشأة قبل أن يتاح اعتماد نوع، ولذلك تستخدم كلمات دودو الافتراضيّة لكل مستوى.',

  'operators.showing.zero': 'لا مشغّلين معروضين',
  'operators.showing.one': 'يُعرض مشغّل واحد',
  'operators.showing.two': 'يُعرض مشغّلان',
  'operators.showing.few': 'يُعرض {count} مشغّلين',
  'operators.showing.many': 'يُعرض {count} مشغّلًا',
  'operators.showing.other': 'يُعرض {count} مشغّلًا',
  'organizations.showing.zero': 'لا منشآت معروضة',
  'organizations.showing.one': 'تُعرض منشأة واحدة',
  'organizations.showing.two': 'تُعرض منشأتان',
  'organizations.showing.few': 'تُعرض {count} منشآت',
  'organizations.showing.many': 'تُعرض {count} منشأةً',
  'organizations.showing.other': 'تُعرض {count} منشأةً',
  'templates.showing.zero': 'لا أنواع أعمال معروضة',
  'templates.showing.one': 'يُعرض نوع عمل واحد',
  'templates.showing.two': 'يُعرض نوعا عمل',
  'templates.showing.few': 'تُعرض {count} أنواع أعمال',
  'templates.showing.many': 'يُعرض {count} نوع عمل',
  'templates.showing.other': 'يُعرض {count} نوع عمل',
  'column.createdOn': 'أُنشئ في',
  'operators.you': 'أنت',
  /* «في حينه» — the role held AT THE TIME, not now. See the English block. */
  'audit.roleAtTheTime': 'في حينه',

  'page.next': 'الصفحة التالية',
  'page.emptyPage.title': 'لا مزيد في هذه الصفحة.',
  'organizations.empty.title': 'لا توجد منشآت.',
  'templates.empty.title': 'لا توجد أنواع أعمال.',
  'identity.editForm': 'تعديل اسم هذه المنشأة وتسجيلاتها',
  'identity.saving': 'جارٍ الحفظ…',
  'identity.saveChanges': 'احفظ التغييرات',
  'identity.nothingChangedDraft': 'لم يتغيّر شيء.',
  'identity.updated.zero': 'لم يُحدَّث أي حقل.',
  'identity.updated.one': 'حُدِّث حقل واحد.',
  'identity.updated.two': 'حُدِّث حقلان.',
  'identity.updated.few': 'حُدِّثت {count} حقول.',
  'identity.updated.many': 'حُدِّث {count} حقلًا.',
  'identity.updated.other': 'حُدِّث {count} حقلًا.',
  'identity.willSend.zero': 'لن يُرسل أي حقل. وتبقى البقيّة كما هي.',
  'identity.willSend.one': 'سيُرسل حقل واحد. وتبقى البقيّة كما هي.',
  'identity.willSend.two': 'سيُرسل حقلان. وتبقى البقيّة كما هي.',
  'identity.willSend.few': 'ستُرسل {count} حقول. وتبقى البقيّة كما هي.',
  'identity.willSend.many': 'سيُرسل {count} حقلًا. وتبقى البقيّة كما هي.',
  'identity.willSend.other': 'سيُرسل {count} حقلًا. وتبقى البقيّة كما هي.',
  'templates.failed.conflict': 'هذا الاسم مستخدَم بالفعل',
  'templates.failed.conflictBody':
    'يوجد نوع عمل بهذا الاسم بالفعل. وتُقارَن الأسماء من دون اعتبار لحالة الأحرف ولبعض فروق يونيكود، فـ«School» و«school» تُعدّان الاسم نفسه. ولم يُنشأ شيء — اختر اسمًا آخر.',
  'templates.failed.quota': 'بلغت المنصّة حدّ عمليّات الكتابة',
  'templates.failed.quotaBody':
    'أجّلت النواة الكتابة بدل تنفيذها. ولم يُنشأ شيء. حاول لاحقًا؛ ولا تتأثّر أي منشأة بهذا.',
  'templates.failed.other': 'لم يُنشأ نوع العمل',

  'identity.heading': 'من هي هذه المنشأة',
  'identity.edit': 'تعديل',
  'identity.nameCannotBeRemoved': 'لا يمكن إزالة الاسم بعد تسجيله.',
  'identity.noName': 'لا يوجد اسم مسجَّل.',
  'identity.noNameExplainBefore':
    'لم يعطِ أحد هذه المنشأة اسمًا في دودو، لذا تُعرَف بالمعرّف الظاهر أعلى هذه الصفحة. هذا أمر طبيعي لمنشأة أُضيفت قبل وجود الأسماء — ليس خطأً ولا ينقص شيء. اضغط',
  'identity.noNameExplainAfter': 'لتسجيل اسم.',
  'identity.notRecorded': 'غير مسجَّل',
  'identity.recorded': 'مسجَّل',
  'identity.numberRecorded': 'الرقم مسجَّل',
  'identity.unknownRecord': 'لا يفهم هذا النظام هذا السجل.',
  'identity.unknownStateBefore': 'أبلغت النواة عن الحالة',
  'identity.unknownStateAfter': 'وهي أحدث من هذه النسخة. لا يُعرض شيء بدلًا من التخمين. أبلغ عن ذلك.',
  'identity.notVerified': 'غير مُتحقَّق منه',
  'identity.unrecognisedStored': 'الحالة المخزَّنة لا يتعرّف عليها هذا النظام.',
  'identity.overwriteWarnBefore': 'لا شيء محدَّد مسبقًا أدناه. اختيار أي خيار هنا',
  'identity.overwrites': 'يستبدل',
  'identity.overwriteWarnAfter': 'ما هو مخزَّن — فاتركه ما لم تقصد ذلك.',
  'identity.numberChangeClearsVerification': 'تغيير الرقم يمسح التحقّق القائم.',
  'identity.untickRemovesVerification': 'إلغاء التحديد هنا يزيل التحقّق القائم.',
  'identity.verifyMeaning': 'أكّد لي العميل هذا مجدّدًا اليوم.',
  'identity.destroys': 'هذا يتلف ما هو مسجَّل.',
  'identity.nothingChanged': 'لم يتغيّر شيء.',
  'identity.wholeOrNothing':
    'يُطبَّق التحديث كاملًا أو لا يُطبَّق إطلاقًا، فلا يوجد سجل محفوظ نصفيًا.',

  'templates.nameLabel': 'الاسم',
  'template.edit': 'تعديل',
  'template.editTitle': 'تعديل نوع العمل هذا',
  'template.save': 'حفظ التغييرات',
  'template.saving': 'جارٍ الحفظ…',
  'template.cancel': 'إلغاء',
  'template.retire': 'إيقاف',
  'template.retiring': 'جارٍ الإيقاف…',
  'template.restore': 'استعادة',
  'template.restoring': 'جارٍ الاستعادة…',
  'template.retired': 'موقوف',
  'template.active': 'نشط',

  'retire.title': 'إيقاف نوع العمل هذا',
  'retire.effect':
    'الإيقاف يمنع اعتماده من جديد. المنشآت التي تستخدمه بالفعل تحتفظ به وتظل ترى تسمياته — لا يتغيّر شيء ممّا تراه.',
  'retire.namePoint':
    'يبقى الاسم محجوزًا أثناء الإيقاف، فلا يمكن استخدامه لنوع عمل آخر. الاستعادة تعيده.',
  'retire.confirm': 'أوقفه',
  'retire.done': 'تمّ الإيقاف.',
  'restore.done': 'تمّت الاستعادة.',
  'restore.effect': 'الاستعادة تتيح اعتماده من جديد مرّة أخرى.',

  'usage.heading': 'من يستخدمه',
  'usage.counting': 'جارٍ سؤال النواة عن عدد المنشآت التي تستخدم هذا…',
  'usage.none': 'لا توجد منشأة تستخدم نوع العمل هذا حاليًا.',
  'usage.someOne': 'منشأة واحدة تستخدم نوع العمل هذا حاليًا.',
  'usage.someMany': 'منشأة تستخدم نوع العمل هذا حاليًا.',
  'usage.deniedTitle': 'لا يستطيع هذا النظام إخبارك بمن يستخدمه',
  'usage.deniedBody':
    'قراءة الاعتماد تحتاج صلاحية خاصّة بها، منفصلة عن قراءة أنواع الأعمال — لأنّها تَعُدّ عبر المنشآت. من دونها لا يتوفّر هذا الرقم، وهذا ليس كقوله إنّه صفر.',

  'orgTemplate.heading': 'نوع العمل',
  'orgTemplate.change': 'تغيير',
  'orgTemplate.clear': 'بلا نوع',
  'orgTemplate.none': 'غير مسجَّل',
  'orgTemplate.saving': 'جارٍ الحفظ…',
  'orgTemplate.choose': 'اختر نوع عمل',
  'orgTemplate.explain':
    'يحدّد الكلمات التي تراها هذه المنشأة لكل مستوى. اختيار «بلا نوع» يعيدها إلى كلمات دودو الافتراضية.',

  'a11y.pagination': 'تصفّح الصفحات',
  'loading.organizations': 'جارٍ سؤال النواة عن المنشآت…',
  'loading.templates': 'جارٍ سؤال النواة عن أنواع الأعمال…',
  'loading.operators': 'جارٍ سؤال النواة عمّن يملك صلاحية المنصّة…',
  'loading.organizationDetail': 'جارٍ سؤال النواة عن هذه المنشأة…',
  'loading.organizationAudit': 'جارٍ قراءة سجلّ هذه المنشأة…',
  'loading.platformAudit': 'جارٍ قراءة سجلّ المنصّة…',
  'loading.session': 'جارٍ التحقّق من جلستك كمشغّل لدى دودو…',
  'loading.operatorContext': 'جارٍ تحميل سياق المشغّل الخاص بك…',
  'loading.challenge': 'جارٍ سؤال النواة عمّا سيحدث…',
  'loading.credential': 'جارٍ تجهيز بيانات الاعتماد الجديدة في هذا المتصفّح…',

  /* `signIn.brand` is the product name and is NOT translated — a brand rendered
     in another script is a different brand. It stays in the dictionary so the
     screen has no literal, not so it can change. */
  'signIn.brand': 'Dudo',
  'signIn.title': 'إدارة المنصّة',
  'signIn.intro':
    'دخول المشغّلين. هذا تسجيل دخول منفصل عن تطبيق دودو — كونك مسجّلًا للدخول هناك لا يسجّل دخولك هنا.',
  'signIn.uncleared.title': 'لم يصل تسجيل خروجك الأخير إلى دودو.',
  'signIn.uncleared.body':
    'لم يُلغَ شيء ولم تُمسح بيانات الجلسة، لذا ما تزال تلك الجلسة نشطة. إن كنت على جهاز مشترك، فسجّل الدخول ثم الخروج مرّة أخرى على اتصال يعمل.',
  'signIn.email': 'البريد الإلكتروني',
  'signIn.emailHint': 'أحرف ASCII فقط. المسافات تُرفض ولا تُحذف.',
  'signIn.password': 'كلمة المرور',
  'signIn.submit': 'تسجيل الدخول',
  'signIn.deriving': 'جارٍ تجهيز بيانات اعتمادك…',
  'signIn.sending': 'جارٍ تسجيل الدخول…',
  'signIn.progressLabel': 'تجهيز بيانات اعتمادك',

  /* Says neither half was wrong — see the English block. */
  'signIn.rejected.title': 'لم تُقبل بيانات الدخول هذه',
  'signIn.rejected.body':
    'راجع البريد الإلكتروني وكلمة المرور وأعد المحاولة. ولا تذكر دودو أيّهما كان خاطئًا، وذلك عن قصد.',

  /* Renamed out of `signIn.*` — see the English block. */
  'derivation.measuring': 'جارٍ قياس المدّة التي سيستغرقها ذلك على هذا الجهاز…',
  'derivation.remainingPrefix': 'يتبقّى نحو',
  'derivation.estimateNote': 'تقدير مقيس على هذا الجهاز.',

  'denied.title': 'ليس لديك صلاحية الوصول إلى هذا',
  'denied.body':
    'رفضت دودو هذا الطلب. لا يستطيع هذا النظام إخبارك بأي من الأسباب المحتملة ينطبق، ولن يخمّن — فالجواب واحد لجميعها عن قصد.',
  'denied.whatToDo':
    'إن كنت ترى أنّ لديك هذه الصلاحية، اطلب من مسؤول المنصّة مراجعة دورك. إعادة المحاولة لن تغيّر الجواب.',
  'denied.reference': 'المرجع',

  'reset.offer.lead': 'أعد تعيين كلمة مرور هذا الشخص.',
  'reset.offer.body':
    'ستولّد دودو كلمة مرور جديدة هنا وتعرضها مرّة واحدة فقط. سيؤدّي ذلك إلى تسجيل خروجه من كل الأجهزة، ويتطلّب كلمة مرورك أنت للتأكيد.',
  'reset.offer.action': 'أعد تعيين بيانات دخوله',
  'reset.preparing': 'يجري تحضير بيانات الدخول الجديدة في هذا المتصفّح…',

  'reset.notStarted.title': 'لم تبدأ عمليّة إعادة التعيين.',
  'reset.notStarted.unchanged': 'لم يتغيّر أي شيء.',
  'reset.notStarted.retry': 'ابدأ من جديد',

  'reset.confirm.title': 'إعادة تعيين كلمة مرور هذا الشخص',
  /* «بعد» dropped with the English "yet" — see the English block. */
  'reset.confirm.intro':
    'وُلِّدت كلمة مرور جديدة في هذا المتصفّح. لم تُرسل ولم يتغيّر شيء — الموافقة أدناه هي ما يطبّقها.',
  'reset.confirm.typedPrefix': 'لقد أدخلت',
  'reset.confirm.typedSuffix': 'باعتباره الحساب المطلوب إعادة تعيينه.',

  'reset.refused.title': 'لم تُعَد كلمة المرور',
  'reset.refused.lead': 'رفضت دودو التغيير، لذلك',
  'reset.refused.emphasis': 'لم يحدث أي شيء ولا تزال كلمة المرور القديمة صالحة.',
  'reset.refused.warning': 'كلمة المرور التي وُلِّدت هنا لم تُكتب قطّ — لا ترسلها إلى أحد.',

  'reset.unknown.title': 'لا يُعرف ما إذا كانت كلمة المرور قد أُعيد تعيينها',
  'reset.unknown.body':
    'لم يصل ردّ على الطلب. قد يكون قد طُبِّق وضاع الجواب في الطريق، وقد لا يكون قد وصل أصلًا —',
  'reset.unknown.noGuess': 'لا تستطيع هذه اللوحة الجزم، ولن تخمّن.',
  'reset.unknown.record': 'سجّل كلمة المرور أدناه قبل مغادرة هذه الشاشة.',
  'reset.unknown.recordWhy':
    'إن كانت إعادة التعيين قد تمّت فهذه هي النسخة الوحيدة الموجودة في أي مكان. وإن لم تتمّ فالنصّ غير ضارّ ولا تزال كلمة المرور القديمة صالحة.',
  'reset.unknown.identifierLabel': 'سيسجّل الدخول بـ',
  'reset.unknown.passwordLabel': 'كلمة مرور قد تكون فعّالة',
  'reset.unknown.resolveLead': 'لمعرفة أيّهما حدث:',
  'reset.unknown.resolveBody':
    'راجع سجلّ تدقيق هذه المنشأة بحثًا عن قيد إعادة تعيين بيانات دخول، أو اطلب من الشخص تجربة كلمة المرور الجديدة.',
  'reset.unknown.doNotRepeat': 'لا تُعِد تنفيذ إعادة التعيين قبل التحقّق',
  'reset.unknown.doNotRepeatWhy':
    '— فإعادة تعيين ثانية ستستبدل بيانات دخول قد تكون هي الفعّالة بالفعل، وعندئذٍ ستحمل كلمتَي مرور وتعرف أقلّ ممّا تعرفه الآن.',

  'reset.done.title': 'أُعيد تعيين كلمة المرور',
  'reset.done.partial': 'لم يكتمل جزء منها.',
  'reset.done.partialStillLive': 'كلمة المرور أدناه فعّالة على أي حال. أبلغ عن هذا.',
  'reset.done.record': 'سجّل كلمة المرور هذه الآن.',
  'reset.done.recordWhy':
    'إنّها موجودة على هذه الشاشة فقط — لم تستلمها دودو ولا يمكنها عرضها مرّة أخرى.',
  'reset.done.identifierLabel': 'يسجّل الدخول بـ',
  'reset.done.passwordLabel': 'كلمة المرور الجديدة',
  'reset.done.youWillKnow': 'ستظلّ تعرف كلمة المرور هذه إلى أن يُعاد تعيينها مرّة أخرى.',
  'reset.done.noSelfService':
    'لا توفّر دودو تغييرًا ذاتيًّا لكلمة المرور، فلا يستطيع استبدالها بنفسه. أرسلها عبر قناة تأتمنها على كلمة مرور.',

  /* See the English block: the numeral is deliberately absent from the first
     three forms, because Arabic states those quantities in the noun. */
  'reset.sessions.zero': 'لم تُنهَ أي جلسة.',
  'reset.sessions.one': 'أُنهيت جلسة واحدة.',
  'reset.sessions.two': 'أُنهيت جلستان.',
  'reset.sessions.few': 'أُنهيت {count} جلسات.',
  'reset.sessions.many': 'أُنهيت {count} جلسة.',
  'reset.sessions.other': 'أُنهيت {count} جلسة.',

  'dashboard.title': 'المنصّة',
  'dashboard.intro':
    'ما تحتويه المنصّة الآن. كل رقم أدناه يُقرأ من النواة عند فتح هذه الصفحة، ولا شيء هنا مخزَّن مؤقتًا أو تقديري.',
  'dashboard.organizations': 'المنشآت',
  'dashboard.templates': 'أنواع الأعمال',
  'dashboard.recentActions': 'أحدث إجراءات المنصّة',
  'dashboard.recentOnboardings': 'أحدث المنشآت المُضافة',
  'dashboard.viewAll': 'عرض الكل',
  'dashboard.none': 'لا شيء',
  'dashboard.countIsPartial': 'على الأقل',
  'dashboard.partialExplain':
    'تقسّم النواة هذه القائمة إلى صفحات ولا تنشر عددًا إجماليًا، لذا هذا هو العدد في الصفحة الأولى وليس المجموع.',
  'dashboard.templatesAdopted': 'يسري نوع العمل على المنشأة التي تعتمده.',
  'dashboard.auditCost':
    'قراءة سجلّ منشأة يكتب في الحصّة اليومية لتلك المنشأة، لذلك لا شيء هنا يفتح سجلًّا.',
};

/* -------------------------------------------------------------------------
   Locale, direction, and the provider
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
 * **This exists so the switcher does not branch on a locale code.** It was
 * `code === 'ar' ? 'locale.ar' : 'locale.en'` inside the shell — correct, and a
 * mapping in a component that has no business owning one. **Adding a third
 * language would have left that ternary quietly resolving Turkish to English**,
 * with nothing red. `Record<Locale, MessageKey>` makes the third language a
 * compile error here instead.
 */
export const LOCALE_LABEL_KEYS: Record<Locale, MessageKey> = {
  en: 'locale.en',
  ar: 'locale.ar',
};

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, ar };

/**
 * WHERE THE CHOICE IS REMEMBERED, AND WHY IT IS NOT A SERVER PREFERENCE.
 *
 * `localStorage`, per browser. **There is no route that stores an operator's
 * language and this console must not invent one** — a preference written to
 * Core would be a platform-operator write, which is an audited row describing a
 * UI choice. `0014` §A's daily admission is finite and this is not what it is
 * for.
 *
 * The cost is that the choice does not follow an operator to another machine.
 * That is the correct trade for a console with a handful of users, and it is
 * stated so nobody reports it as a bug.
 */
const STORAGE_KEY = 'dudo.admin.locale';

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isLocale(stored) ? stored : null;
  } catch {
    /*
     * Storage can throw — Safari private mode, a disabled-cookies profile, a
     * quota. A console that fails to start because it could not read a language
     * preference would be trading the whole surface for a nicety.
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
   * uses, and it is inherited — so setting it here is what makes the whole
   * console flip rather than one subtree.
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
 * **Throws rather than returning a default**, for the reason `useWhoami` does:
 * a hook that silently returns English outside the provider produces a console
 * that is correct in testing and half-translated in one corner of production,
 * and the corner is found by a user rather than by a build.
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

/**
 * Render a field refusal from `api/platform.ts`.
 *
 * ===========================================================================
 * ONE RENDERER, BECAUSE THREE SURFACES CONSUME THESE
 * ===========================================================================
 *
 * `Templates`, `OnboardOrganization` and `OrganizationIdentity` all call the
 * refusal functions and all render the result into a `Field`'s `error`. **Three
 * copies of `refusal === null ? null : fill(t(refusal.key), locale,
 * refusal.values ?? {})` is three places to forget the `values`** — and
 * forgetting it renders `{max}` on screen rather than failing, which is a defect
 * that ships.
 *
 * **It lives here rather than in a component** because it is a pure function of
 * a refusal and a locale, and because putting it in a component would make every
 * consumer import a component to render a string.
 *
 * `null` in, `null` out — so a caller can pass a refusal-or-null straight
 * through to `error`, which is what all three do.
 */
export function refusalText(
  refusal: Refusal | null,
  locale: Locale,
  t: (key: MessageKey) => string,
): string | null {
  if (refusal === null) return null;
  return fill(t(refusal.key), locale, refusal.values ?? {});
}

/**
 * A duration in seconds, in the reader's language, WITH THE PLURAL RULE THE
 * PLATFORM ALREADY KNOWS.
 *
 * ===========================================================================
 * THIS IS THE `Intl` DEFERRAL THIS MODULE PROMISED, HONOURED RATHER THAN
 * QUIETLY FORGOTTEN
 * ===========================================================================
 *
 * The header says this module implements **no pluralisation**, because *"Arabic
 * has six categories and getting them wrong silently is worse than not claiming
 * them."* The first string that needed a count was `"About 5 seconds left"`,
 * and the tempting fixes were both bad: a bare `${n} seconds` is wrong in
 * Arabic for almost every `n`, and a hand-rolled rule would be this file
 * claiming exactly the competence it disclaimed.
 *
 * **`Intl.NumberFormat` with `style: 'unit'` HAS the rules, for every locale,
 * maintained by the engine.** ثانية واحدة · ثانيتان · ٥ ثوانٍ · ١١ ثانية come
 * out correctly without this console knowing why — which is the whole argument
 * for not reimplementing it.
 *
 * Measured rather than assumed — `1, 2, 3, 5, 11, 25` in `ar` give:
 * `ثانية · ثانيتان · 3 ثوان · 5 ثوان · 11 ثانية · 25 ثانية`. **Singular, dual,
 * and two plural forms, none of which this file knows about.**
 *
 * ⚠ **THE DIGITS STAY LATIN, AND THIS COMMENT ORIGINALLY CLAIMED THEY DID NOT.**
 * It said Arabic renders `٥` rather than `5`. It does not: `resolvedOptions()`
 * reports `numberingSystem: 'latn'` for `ar` in this runtime, and Arabic-Indic
 * digits need an explicit `ar-u-nu-arab`.
 *
 * **That is left as it resolves, deliberately.** Both numbering systems are in
 * everyday use in Bahrain and forcing one is a decision about a reader's
 * expectations that this file has no standing to make. **What is not acceptable
 * is a comment asserting a behaviour the code does not have** — which is what
 * this was for about a minute, written from the plural forms being right and
 * assuming the digits followed.
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
 * A counted sentence, in the reader's language, WITH THE PLURAL RULE THE
 * PLATFORM ALREADY KNOWS — the second half of the `Intl` deferral.
 *
 * ===========================================================================
 * WHY THIS EXISTS WHEN `formatSeconds` ALREADY DID THIS JOB
 * ===========================================================================
 *
 * `formatSeconds` gets its plural forms free because **`second` is a unit
 * `Intl.NumberFormat` knows**. `Intl` has no `session`, no `Organization` and
 * no `Template`, and it never will — so the trick that worked for a duration
 * does not transfer to a domain noun, and reaching for it was the first thing
 * tried here.
 *
 * **`Intl.PluralRules` is the part that does transfer.** It answers *which
 * category does this number fall in, in this language* — `zero`, `one`, `two`,
 * `few`, `many`, `other` — and that is precisely the question the module header
 * refuses to answer itself: *"Arabic has six categories and getting them wrong
 * silently is worse than not claiming them."*
 *
 * **So the split is: the ENGINE selects the category, the DICTIONARY supplies
 * the wording.** This file still implements no pluralisation rules. It looks
 * one up.
 *
 * ===========================================================================
 * THE PLACEHOLDER IS ONE `replace`, AND THAT IS NOT AN ACCIDENT OF EFFORT
 * ===========================================================================
 *
 * The header promises **no message-format compiler**. `{count}` is a single
 * named substitution with no arguments, no nesting, no selectors and no
 * escaping — it is the smallest thing that lets a translator put a numeral
 * where their language puts it, which a prefix/suffix pair cannot do once the
 * numeral is medial.
 *
 * **A form that omits `{count}` is left unchanged, deliberately**, because
 * Arabic's `one` and `two` carry the quantity in the noun. **This means a
 * translator who forgets the placeholder gets a sentence with no number rather
 * than an error** — so the dictionary says at the site which forms omit it on
 * purpose, and a checker cannot tell those apart from a mistake. That limit is
 * stated rather than papered over.
 *
 * ===========================================================================
 * MEASURED, NOT ASSUMED — `formatSeconds`'s comment was wrong about its own
 * output for a minute and this one was written after reading that correction
 * ===========================================================================
 *
 * `Intl.PluralRules` over `0, 1, 2, 3, 5, 10, 11, 25, 99, 100, 101, 102, 103,
 * 200`:
 *
 * ```
 * ar   0 zero · 1 one · 2 two · 3–10 few · 11–99 many · 100–102 other · 103 few
 * en   1 one  · everything else other
 * ```
 *
 * **All six Arabic categories are reached by ordinary session counts** — this
 * is not a theoretical completeness. **`103` selecting `few` is the case worth
 * keeping**, because it is the one a hand-rolled rule gets wrong: the category
 * turns on `n % 100`, not on magnitude, so the sequence is not monotonic and
 * `many` sits between two runs of `few`.
 *
 * **English reaches exactly `one` and `other`**, which is the measurement
 * behind the dictionary's claim that its other four forms are unreachable by
 * construction rather than by luck.
 *
 * `Intl` is in the platform. It is not a dependency and needs no approval.
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
 * ===========================================================================
 * THIS GENERALISES `formatCount`'s SINGLE `{count}`, AND THE REASON IS A
 * DUPLICATED CONSTANT RATHER THAN CONVENIENCE
 * ===========================================================================
 *
 * The prefix/suffix pattern (`templates.nameHint`, `onboard.nameHintPrefix`)
 * works where a number sits at a seam and is preferred there — two whole
 * sentences read better than one with a hole in it.
 *
 * **It fails where the number is mid-clause**, which is where the audit-window
 * copy puts `MAX_WINDOW_DAYS`: *"…at most 31 days apart. Dudo refuses…"*.
 * Splitting that produces two fragments a translator cannot read, and the
 * alternative — typing `31` into the dictionary — is **a second copy of a
 * constant in a file that cannot see the first**, twelve times over. `§12`
 * records that a symbol whose VALUE moves is caught by nobody: no diagnostic,
 * no failing test, and both languages silently wrong the day the limit changes.
 *
 * **A NUMBER GOES THROUGH `Intl`, ALWAYS.** That is why this takes a locale it
 * would not otherwise need — a bare `String(31)` is a Latin numeral asserted
 * into a sentence whose numbering system is not this function's to decide.
 *
 * **AN UNKNOWN PLACEHOLDER IS LEFT VISIBLE, NOT DROPPED.** `{days}` rendering
 * literally is a bug anyone can see; a silently vanished one produces *"at most
 * days apart"*, which reads as clumsy translation rather than as a defect and
 * survives review. `§11a`'s empty-list reader, one string wide.
 *
 * **What this is NOT**: no nesting, no selectors, no formats, no escaping, no
 * arguments beyond a flat map. The header's promise of no message-format
 * compiler is intact — this is one regular expression.
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
     * what makes this branch mandatory rather than optional — the compiler
     * refuses to let the absent case fall through silently, which is the
     * behaviour the comment above asks for.
     */
    if (value === undefined) return whole;
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}
