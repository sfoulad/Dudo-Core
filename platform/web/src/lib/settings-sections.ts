/**
 * The eleven sections of Organization administration — one declaration, read by
 * the navigation, the route tree and every section screen.
 *
 * ===========================================================================
 * ONE SOURCE, DERIVED THREE WAYS, BECAUSE THE ALTERNATIVE IS THREE LISTS THAT
 * AGREE UNTIL THEY DO NOT
 * ===========================================================================
 *
 * `workflow.md` §11a: *a check that holds a name of its own goes stale when the
 * name moves — derive the subject.* The same applies to a surface. A navigation
 * array, a route table and a set of screen files are three copies of "what
 * sections exist", and **the failure mode is silent in the direction that
 * matters**: a section present in the route tree and absent from the navigation
 * is reachable by address, invisible in the menu, and nothing goes red.
 *
 * So the array below is the source. The navigation maps it, the route tree maps
 * it, and `SectionId` is **derived from the data** rather than declared beside
 * it — add an entry and the union grows; remove one and every exhaustive
 * consumer stops compiling.
 *
 * ===========================================================================
 * A LEAF MODULE. IT IMPORTS NOTHING AT RUNTIME, AND THAT IS LOAD-BEARING
 * ===========================================================================
 *
 * `platform/admin` learned this the expensive way: section paths went into the
 * route tree next to the routes that used them, which reads as the obvious
 * home, and produced
 *
 *     route-tree → root-layout → shell → route-tree
 *
 * — `ReferenceError: Cannot access 'Mn' before initialization` and **a blank
 * page, with `tsc` at 0, `vite build` at 0 and 584 passing assertions.** A
 * module cycle is legal TypeScript and legal ES; it fails at runtime on the
 * first render, and nothing that inspects source or types can see it.
 *
 * **The single import below is `import type`, and `verbatimModuleSyntax` is on
 * in `tsconfig.json`** — so it is erased entirely and contributes no edge to
 * the module graph. **If this file ever grows a VALUE import, the cycle can
 * come back.**
 *
 * ===========================================================================
 * WHAT `built` MEANS, STATED BECAUSE THE COUNT IS SHOWN TO A CUSTOMER
 * ===========================================================================
 *
 * **`built` means this section displays data from the reader's own
 * Organization.** Not "the screen exists" — every screen exists. Not "the
 * navigation works" — it does. **Every one of these is `false` today**, and the
 * overview says so in a counted sentence derived from this array rather than
 * from anyone's memory of it.
 *
 * The overview itself carries `data: null`: it is the index that lists the
 * others and holds no Organization data of its own, so counting it either way
 * would be wrong. It is in the navigation because a reader needs to get back to
 * it.
 */

import type { MessageKey } from '@/lib/i18n';

/**
 * Why a section cannot be built, and what a reviewer can open to check.
 *
 * **`contract` IS A PATH, NOT A NAME.** `architecture.md` §3c: a comment citing
 * a contract is a claim about that contract, and the remedy is *open the file*.
 * A bare `organization-identity-v1` cannot be opened; a repository path can, and
 * a path that stops resolving is a defect somebody will notice.
 */
export interface SectionData {
  /** Repository path to the nearest relevant contract, or `null` where none exists. */
  readonly contract: string | null;
  readonly contractStatusKey: MessageKey;
  /** One reason per line, in the order a reader should meet them. */
  readonly blockedOnKeys: readonly MessageKey[];
  /** Does this section display data from the reader's Organization? */
  readonly built: boolean;
}

export interface Section {
  readonly id: string;
  /**
   * The full path, written out rather than composed from a parent and a
   * segment. **The navigation's `Link to=` is typed against the route tree**,
   * so these must be literals for the compiler to check them — a template
   * string would widen to `string` and silently accept a path no route serves.
   */
  readonly path: string;
  readonly navKey: MessageKey;
  readonly titleKey: MessageKey;
  readonly purposeKey: MessageKey;
  /** `null` for the index section, which lists the others. */
  readonly data: SectionData | null;
}

/**
 * The order a reader meets them: where you stand · who you are · what you run ·
 * who may act · what was done · what it costs.
 */
export const SECTIONS = [
  {
    id: 'overview',
    path: '/settings',
    navKey: 'settings.overview.nav',
    titleKey: 'settings.overview.title',
    purposeKey: 'settings.overview.purpose',
    data: null,
  },
  {
    id: 'profile',
    path: '/settings/profile',
    navKey: 'settings.profile.nav',
    titleKey: 'settings.profile.title',
    purposeKey: 'settings.profile.purpose',
    data: {
      /*
       * ACCEPTED AND UNREACHABLE, WHICH IS NOT THE SAME AS ACCEPTED. This
       * contract is platform-class: the only principal who can call it is a
       * Dudo operator, so an Organization cannot correct its own legal name.
       * The contract records that as `OI-1`, and `0044` §4 is explicit that
       * `OI-1` closes when a tenant-admin route is BUILT, not when the class
       * was decided.
       */
      /*
       * ⚠ THIS CITED `organization-identity-v1` — ACCEPTED, AND PLATFORM-CLASS,
       * SO ONLY A DUDO OPERATOR CAN CALL IT. `tenant-organization-profile-v1`
       * landed hours later and is the contract that will actually serve this
       * section, so the citation moved to it.
       *
       * **`OI-1` IS STILL OPEN AND THIS SECTION MUST NOT IMPLY OTHERWISE.** The
       * new contract says so on its own face: `0044` §4 closes `OI-1` when a
       * ROUTE IS BUILT, not when a contract is written. The platform-class fact
       * stays in the blockers, because it is the reason a customer cannot
       * correct their own legal name today.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-organization-profile-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: [
        'blocked.contractProposed',
        'blocked.platformClassOnly',
        'blocked.tenantAdminRegistry',
      ],
      built: false,
    },
  },
  {
    id: 'businesses',
    path: '/settings/businesses',
    navKey: 'settings.businesses.nav',
    titleKey: 'settings.businesses.title',
    purposeKey: 'settings.businesses.purpose',
    data: {
      /*
       * THE ONE SECTION WITH A LIVE, ACCEPTED, TENANT-REACHABLE CONTRACT — for
       * READING. `src/contracts/business-read.ts` consumes it today and the
       * Customer Directory filters on it. Nothing is published for creating a
       * Business, editing one, or anything to do with branches.
       */
      contract: 'packages/contracts/core/organization/business-read-v1.contract.yaml',
      contractStatusKey: 'contractStatus.acceptedReadOnly',
      blockedOnKeys: ['blocked.readContractOnly', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'members',
    path: '/settings/members',
    navKey: 'settings.members.nav',
    titleKey: 'settings.members.title',
    purposeKey: 'settings.members.purpose',
    data: {
      /*
       * ⚠ THIS ENTRY SAID "no contract has been drafted" AND WAS FALSE WITHIN
       * AN HOUR OF BEING WRITTEN. `tenant-members-v1` landed while this shell
       * was being built, and nothing would have told anyone.
       *
       * That is `workflow.md` §12's *a capability ARRIVING is a sweep trigger,
       * exactly like a decision being withdrawn* — and the artifacts that go
       * stale are the ones asserting ABSENCE, which no search for the new thing
       * will ever find. So the claim is now checked rather than maintained:
       * `scripts/verify-settings.mjs` asserts that every path cited here
       * exists, that its declared `status:` matches the status shown on screen,
       * and that **no contract under `core/tenant-admin/` is left uncited.**
       * The third is the one that catches this exact failure.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-members-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      /*
       * `blocked.roleModel` WAS HERE AND IS GONE. It said the role model was
       * "not yet recorded as a decision" — `0043` was accepted while this file
       * was being written. See `lib/i18n.tsx` for why the key was deleted
       * rather than reworded.
       */
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'invitations',
    path: '/settings/invitations',
    navKey: 'settings.invitations.nav',
    titleKey: 'settings.invitations.title',
    purposeKey: 'settings.invitations.purpose',
    data: {
      contract: 'packages/contracts/core/tenant-admin/tenant-invitations-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'roles',
    path: '/settings/roles',
    navKey: 'settings.roles.nav',
    titleKey: 'settings.roles.title',
    purposeKey: 'settings.roles.purpose',
    data: {
      /*
       * ⚠ `0043` §2d IS EXPLICIT THAT NOTHING MAY REPORT CUSTOM ROLES AS
       * AVAILABLE until the creation route exists. This section reports that it
       * is not built, which satisfies that — and it is the reason the purpose
       * line says roles "you define yourself" as a description of the section's
       * eventual subject rather than as a capability offered today.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-roles-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'sessions',
    path: '/settings/sessions',
    navKey: 'settings.sessions.nav',
    titleKey: 'settings.sessions.title',
    purposeKey: 'settings.sessions.purpose',
    data: {
      /*
       * ⚠ THIS WAS `contract: null` AND THE CHECK IS WHAT MOVED IT, WITHIN
       * MINUTES OF THE CONTRACT LANDING.
       *
       * `tenant-sessions-v1` was authored on 2026-09-13 while this registry
       * already said the section had no contract. **Nothing about a new
       * contract file makes a stale `null` here go red on its own** — the
       * section keeps rendering "no contract yet", which is the reassuring
       * direction and the one `workflow.md` §11a records as never being caught.
       * `verify-settings.mjs` asserts the other way round, from the CONTRACT
       * DIRECTORY to the registry, so an uncited contract is what fails.
       *
       * ⚠ AND THE SECTION STAYS UNBUILT. The contract is `status: proposed` and
       * says so on its own face — *"NOT APPROVED AND NOT BUILT"*. Citing a
       * contract records that one exists; it is not permission to build against
       * it, and `architecture.md` §1 puts approval with the Team Lead.
       *
       * ⚠ ONE THING FROM IT THAT BINDS THIS CLIENT ALREADY, recorded here
       * because a screen author will otherwise meet it late: the contract rules
       * that `session_id` NEVER APPEARS IN ANY SHAPE, IN ANY DIRECTION —
       * **the primary key and the bearer secret are the same value**, so a
       * listing that showed it, even truncated, would hand a live credential to
       * every holder of the list permission. A session list is therefore not a
       * table of identifiers, and no amount of UI care recovers it if the shape
       * is wrong.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-sessions-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'apps',
    path: '/settings/apps',
    navKey: 'settings.apps.nav',
    titleKey: 'settings.apps.title',
    purposeKey: 'settings.apps.purpose',
    data: {
      /*
       * `template-v1` IS NOT CITED HERE, AND THE OMISSION IS DELIBERATE. It
       * describes what a platform operator does with a Template, not what an
       * Organization sees of its own. Citing the nearest-sounding contract
       * would be `§3c`'s defect in the form that survives review: a reviewer
       * opens it, finds a real accepted contract, and concludes this section
       * is nearly ready.
       *
       * ⚠ AND `tenant-configuration-v1` IS THE CONTRACT THAT PARAGRAPH WAS
       * WAITING FOR — it landed on 2026-09-13 and is exactly *"what an
       * Organization sees of its own"*: the adopted Template, read.
       *
       * ⚠ **IT COVERS HALF OF THIS SECTION AND REFUSES THE OTHER HALF ON ITS
       * OWN FACE**, which is why both blocked reasons stay rather than one
       * being dropped as satisfied:
       *
       *   the Template half   contracted, `proposed`, not yet accepted
       *   the App half        *"NO APP INSTALL, NO APP CONFIGURATION, NO APP
       *                       PERMISSION GRANT AND NO APP LISTING. NOT AS A
       *                       SHAPE, NOT AS A RESERVED FIELD, NOT AS A
       *                       PLACEHOLDER"* — because the App isolation
       *                       mechanism is unselected, which is a DECISION and
       *                       not code.
       *
       * **A section that is half-contracted must not read as contracted.**
       * Dropping `blocked.capabilityRegistry` because a contract now exists
       * would be the same defect the paragraph above refuses, arriving through
       * a citation that is genuinely correct.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-configuration-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.capabilityRegistry'],
      built: false,
    },
  },
  {
    id: 'audit',
    path: '/settings/audit',
    navKey: 'settings.audit.nav',
    titleKey: 'settings.audit.title',
    purposeKey: 'settings.audit.purpose',
    data: {
      contract: 'packages/contracts/core/audit/audit-read-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'data',
    path: '/settings/data',
    navKey: 'settings.data.nav',
    titleKey: 'settings.data.title',
    purposeKey: 'settings.data.purpose',
    data: {
      /*
       * `tenant-lifecycle-v1` COVERS THREE THINGS AND THIS SECTION IS TWO OF
       * THEM — deletion request and retention, which is precisely *"what
       * happens to your data if you leave"*.
       *
       * ⚠ **ITS THIRD OPERATION IS OWNERSHIP TRANSFER, WHICH SURFACES UNDER
       * MEMBERS RATHER THAN HERE**, and one contract path per section cannot
       * say that. Recorded rather than hidden: a reader on `/settings/members`
       * will not see this citation, and the section that eventually offers
       * transfer must cite it too.
       *
       * **Two of its four operations are `critical` and callable by nobody
       * today** — the contract says so on each operation's own face. That is a
       * stronger blocker than `proposed`, and the section must not imply
       * otherwise once it is built.
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-lifecycle-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
  {
    id: 'plan',
    path: '/settings/plan',
    navKey: 'settings.plan.nav',
    titleKey: 'settings.plan.title',
    purposeKey: 'settings.plan.purpose',
    data: {
      /*
       * `tenant-usage-v1` — "Organization Plan, Quota and Usage" — landed on
       * 2026-09-13, in the same hour as `tenant-sessions-v1` and
       * `tenant-configuration-v1`. **Three contracts arrived between two runs
       * of `verify:settings`, and all three were found by the check rather
       * than by anyone remembering to look.**
       */
      contract: 'packages/contracts/core/tenant-admin/tenant-usage-v1.contract.yaml',
      contractStatusKey: 'contractStatus.proposed',
      blockedOnKeys: ['blocked.contractProposed', 'blocked.tenantAdminRegistry'],
      built: false,
    },
  },
] as const satisfies readonly Section[];

/** Derived from the data above, never declared beside it. */
export type SectionId = (typeof SECTIONS)[number]['id'];

/** The literal path union, so `Link to=` stays checkable against the route tree. */
export type SectionPath = (typeof SECTIONS)[number]['path'];

/** Where `/settings/<nonsense>` and the section index both land. */
export const SETTINGS_ROOT: SectionPath = '/settings';

/**
 * The sections that will one day show Organization data — everything except the
 * index.
 *
 * **Derived by filtering, not by a second list.** The overview's counted
 * sentence reads from this, so a section added without a `data` record is
 * counted nowhere and one added with it is counted everywhere, in one edit.
 */
export const DATA_SECTIONS = SECTIONS.filter(
  (section): section is (typeof SECTIONS)[number] & { data: SectionData } => section.data !== null,
);

/**
 * How many of them display Organization data today.
 *
 * **A function over the array rather than a constant**, because a constant is a
 * second copy of a fact that nothing keeps current — `§12`'s *a symbol whose
 * VALUE moves is caught by nobody*. This one cannot go stale: the day a section
 * flips to `built: true` the sentence on the overview changes with it, and
 * nobody has to remember.
 */
export function builtSectionCount(): number {
  return DATA_SECTIONS.filter((section) => section.data.built).length;
}

export function findSection(id: SectionId): Section {
  const match = SECTIONS.find((section) => section.id === id);
  /*
   * UNREACHABLE THROUGH THE TYPE, AND THROWN ANYWAY. `SectionId` is derived
   * from this array, so a caller cannot name an id that is not here. The throw
   * is for the case the type cannot see: a `find` that returns `undefined`
   * because the array was emptied by an edit. `§11a` — a reader handed nothing
   * must not render as a reader that found nothing wrong.
   */
  if (match === undefined) throw new Error(`No settings section is registered as "${id}".`);
  return match;
}
