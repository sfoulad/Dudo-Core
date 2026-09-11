/**
 * ===========================================================================================
 * PLATFORM AUTHORITY: THE ROLE MAPPING AND CORE'S OWN PLATFORM PERMISSION ENVELOPE.
 * `docs/decisions/0025` decisions 1 and 3 · `docs/decisions/0024` invariant 2 ·
 * `docs/decisions/0023`'s envelope precedent · contract `platform-operator-v1`, P3.
 * ===========================================================================================
 *
 * This file is `authorization/roles.ts` one tier up, and EVERY RULE IN THAT FILE APPLIES HERE
 * UNCHANGED: frozen arrays of literal permission identifiers, no pattern, no prefix, no
 * `startsWith`, no glob, and no code path that derives a permission id from anything other than
 * these literals. A role is exactly the construct that tempts `0007` rule 3 to be relaxed, and it
 * is more tempting here than there — `platform-admin: ['core.*']` would be shorter, would read as
 * obviously correct, and would grant every Core permission any future contract registers.
 *
 * ===========================================================================================
 * IT IS A **SEPARATE** MAPPING FROM `authorization/roles.ts`, AND THE SEPARATION IS THE POINT
 * ===========================================================================================
 *
 * NOT AN EXTENSION OF IT. `MembershipRole` must never gain a platform-tier value (`0024`
 * invariant 2), so the two mappings cannot share a union, a table or a function. A single mapping
 * with a platform branch is ONE EDIT AWAY from being reachable from a membership row — and a
 * membership row carrying platform authority is the trap `0024` exists to record:
 *
 *   `scope.ts` ranks `platform` at 0, so `implies('platform', X)` is true for EVERY X. Such a
 *   principal passes authorization for every Action at every scope, and the storage boundary then
 *   POLITELY SCOPES IT INTO THAT ORGANIZATION AND SERVES THE ROWS. Repeat per Organization and
 *   you have cross-tenant access assembled entirely out of legitimate parts. No review catches
 *   it, because there is nothing wrong to see.
 *
 * `assertPlatformPermissionModelIsCoherent` therefore asserts, at module load, that the two role
 * unions are DISJOINT. `0024` names `assertRoleMappingIsCoherent` as the natural home for that
 * check; it is here instead, deliberately, because putting it in `authorization/roles.ts` would
 * make that module import this one and produce a runtime import cycle between the two mappings
 * the whole design is trying to keep apart. The direction of the dependency is one-way on
 * purpose: this file knows about `MembershipRole`, and `MembershipRole` knows nothing about
 * platform authority.
 *
 * ===========================================================================================
 * THE ENVELOPE IS A CEILING AND NOT A GRANT — restated because `0023`'s reviewers needed it
 * ===========================================================================================
 *
 * `authorize()` resolves against the envelope as the CEILING and the principal's grant as the
 * FLOOR. Declaring the six permissions below grants them to NOBODY. The floor is the
 * `platform_operator` row.
 *
 * NO APP MAY DECLARE A PLATFORM PERMISSION. `app-manifest.schema.json` already enforces this
 * structurally through `$defs/appRequestableScope`, and that enforcement must not be relaxed to
 * accommodate anything in this class. `0023` rejected letting the Customer Directory declare
 * `core.business.read` on the ground that "an App's manifest would gate a Core capability"; the
 * same argument at platform scope is not merely untidy, it is an ESCALATION — an App that could
 * declare a platform permission could request it at install, and a tenant administrator clicking
 * through a consent screen would be granting authority over every OTHER tenant on the platform.
 */

import type { AppPermissionEnvelope, PermissionGrant, PrincipalGrants } from '../authorization/authorizer.ts';
import type { Scope } from '../authorization/scope.ts';
import { MEMBERSHIP_ROLES } from '../authorization/roles.ts';

/**
 * Every permission in this file is held, declared and evaluated at exactly this scope.
 *
 * `platform` is the only scope that spans Organizations, and `permission-catalog.yaml`'s note on
 * it is the line that makes this whole surface buildable before AZ3: a platform-scope role
 * NEVER reaches tenant business data. `scope.ts` does not give it a path to one — the tenant
 * predicate is applied by the storage boundary from the AUTHENTICATED Organization, and a
 * platform operator has none, because it has no membership.
 */
const PLATFORM_SCOPE: Scope = 'platform';

/**
 * The closed union, mirroring `permission-catalog.yaml`'s two platform-scope seed roles.
 *
 * TWO RATHER THAN ONE, for the reason `MembershipRole` is two (`0019`): a single role lets the
 * mapping degenerate into a constant — `if (operator) return EVERYTHING` — and whoever adds the
 * second discovers the indirection was never really there.
 */
export type PlatformRole = 'platform-admin' | 'marketplace-moderator';

/** The runtime value set, for validating a stored string on read. */
export const PLATFORM_ROLES: readonly PlatformRole[] = Object.freeze([
  'platform-admin',
  'marketplace-moderator',
]);

/**
 * Collapses a stored value to a role this build understands, or to `null`.
 *
 * `null` IS RETURNED FOR BOTH "ABSENT" AND "UNRECOGNISED", and it DENIES EVERYTHING on the same
 * path as an absent row. That is the device `roles.ts::toMembershipRole` and
 * `credential-verifier.ts` both already use: a value a FUTURE migration introduces must fail onto
 * the SAFE path rather than onto an error path, so a build older than its data denies rather than
 * breaking, and so the distinction is not measurable from outside.
 *
 * The contract requires exactly this: "An unrecognised stored value collapses to null and DENIES
 * EVERYTHING, on the same path as an absent row."
 */
export function toPlatformRole(value: string | null | undefined): PlatformRole | null {
  if (value === null || value === undefined) {
    return null;
  }
  return PLATFORM_ROLES.find((role) => role === value) ?? null;
}

// =============================================================================================
// The six permissions that back a platform ROUTE. Named individually so the tables below read as
// sets of names rather than as strings — which is what makes a misspelling a load-time error
// instead of a silent denial.
// =============================================================================================

const ORGANIZATION_LIST = 'core.organization.list';
const ORGANIZATION_CREATE = 'core.organization.create';
const TEMPLATE_READ = 'core.template.read';
const TEMPLATE_LIST = 'core.template.list';
const TEMPLATE_CREATE = 'core.template.create';
// ---- `template-lifecycle-v1`, granted by the user 2026-09-11. See the role list for the grant.
const TEMPLATE_UPDATE = 'core.template.update';
/** GATES RETIRE **AND** RESTORE. One permission, two routes — `theRetirementRuling`. */
const TEMPLATE_RETIRE = 'core.template.retire';
/**
 * NOT `core.template.usage-read`, AND THE NAME IS THE MECHANISM RATHER THAN A STYLE CHOICE.
 * **Permissions are granted by family.** Filed under `core.template.*` it would sit beside read,
 * list and create — three permissions about the Template RECORD — and **anyone composing a role
 * that "can read Templates" would pick up a customer-base census silently**, looking like a fourth
 * member of a set they had already decided about. The whole point of this permission is that
 * reading a Template and counting its adopters are different decisions.
 */
const TEMPLATE_ADOPTION_READ = 'core.template-adoption.read';
const CREDENTIAL_RESET = 'core.credential.reset';
/** `platform-audit-read-v1`. BOTH feeds declare it; `0028` leaves them splittable later. */
const PLATFORM_AUDIT_READ = 'core.platform-audit.read';
/** `platform-operators-v1`. The revoke route, and the challenge that confirms it. */
const PRINCIPAL_REVOKE_PLATFORM_SCOPE = 'core.principal.revoke-platform-scope';
const PLATFORM_ORGANIZATION_UPDATE = 'core.platform-organization.update';
/**
 * *** DELIBERATELY NOT `PLATFORM_ORGANIZATION_UPDATE`, AND THAT ENTRY RULES ITSELF OUT IN TERMS. ***
 * It is scoped to *"an Organization's display name, its commercial registration and its VAT
 * registration"* and states *"IT DOES NOT COVER STATUS."* **A Template is not identity**: name, CR
 * and VAT are facts ABOUT the Organization that the platform records on its behalf, while a Template
 * decides what every user in that Organization READS AS THE NAME OF THEIR OWN STRUCTURE. Reusing the
 * identity permission would widen it by adoption rather than by decision — exactly what its own
 * entry refused to allow for status.
 */
const PLATFORM_ORGANIZATION_SET_TEMPLATE = 'core.platform-organization.set-template';

/**
 * `core.organization.list`, exported because the two routes in this slice declare it.
 *
 * IT IS NOT `core.organization.read`, WHICH IS DECLARED `[organization]` AND STAYS THERE. Two
 * permissions rather than one widened one: widening a tenant-scoped permission above the tenant
 * boundary is the escalation AZ8 exists to record, and `permission-catalog.yaml` says so at the
 * declaration itself.
 */
export const PLATFORM_ORGANIZATION_LIST_PERMISSION = ORGANIZATION_LIST;

/**
 * ===========================================================================================
 * CORE'S PLATFORM PERMISSION ENVELOPE. SEVEN PERMISSIONS AND NOTHING ELSE.
 * ===========================================================================================
 *
 * `organizations.list`, `templates.list`, `templates.read`, `templates.create`,
 * `organizations.create`, `credentials.reset`, and — added 2026-09-05 —
 * **`core.platform-audit.read`**. AN EIGHTH NEEDS ITS OWN ARGUMENT — the same discipline `0021`
 * imposed on its class of two and `0023` on its block of two. That discipline is what keeps "it is
 * a platform route so it needs no tenant" from becoming a way to write an Action without a tenant
 * check.
 *
 * *** THE SEVENTH IS THE CEILING RISING DELIBERATELY, ONE CONTRACT AT A TIME. ***
 * `core.platform-audit.read` sat in `HELD_BUT_UNREACHABLE` from the moment the catalog granted it,
 * with the note that it would move here when its routes landed. `platform-audit-read-v1` has
 * landed, so it moves. **The floor was never trimmed to meet the ceiling and the ceiling was never
 * widened in advance** — which is the shape that keeps "why can this role do that?" answerable.
 *
 * SOME OF THESE STILL HAVE NO ROUTE. `credentials.reset` is next and is not implemented. They are
 * declared here anyway, because the envelope is the CLASS's ceiling rather than any one slice's,
 * and because a ceiling that has to be widened to add a route is a ceiling somebody widens without
 * reading it.
 *
 * `appId` IS `platform`, MATCHING `worker-entry.ts`'s `NO_APP` CONVENTION, so an audit record
 * produced on this path cannot be mistaken for one attributed to an installed App. It is a Core
 * envelope that happens to reuse `AppPermissionEnvelope`'s SHAPE — the same reuse
 * `http/core-routes.ts::CORE_APP_PERMISSIONS` makes, and for the same reason: the authorizer
 * takes the envelope as a parameter, so Core declaring its own needs no change to `authorize()`
 * and introduces no second authorization function.
 */
export const PLATFORM_PERMISSION_ENVELOPE: AppPermissionEnvelope = Object.freeze({
  appId: 'platform',
  declared: Object.freeze([
    Object.freeze({ permissionId: ORGANIZATION_LIST, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: ORGANIZATION_CREATE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_READ, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_LIST, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_CREATE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: CREDENTIAL_RESET, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: PLATFORM_AUDIT_READ, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: PRINCIPAL_REVOKE_PLATFORM_SCOPE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: PLATFORM_ORGANIZATION_UPDATE, scope: PLATFORM_SCOPE }),
    // =========================================================================================
    // *** THE TENTH THROUGH THIRTEENTH, 2026-09-11. `template-lifecycle-v1`'s five routes.
    // THE LARGEST SINGLE WIDENING THIS CEILING HAS HAD, AND IT OWES THE LARGEST ARGUMENT. ***
    // =========================================================================================
    //
    // **GRANTED BY THE USER**, relayed by the Team Lead, who does not approve (`security.md` §8).
    // The user's words, recorded in `permission-catalog.yaml`'s `platform-admin` entry: *"Finalize
    // and register the four proposed Template permissions."* The catalogue is the register (`0007`
    // rule 4); this is Core's transcription of it and decides nothing.
    //
    // WHY FOUR AT ONCE RATHER THAN ONE CONTRACT AT A TIME — the shape this file insists on. **They
    // are one contract.** `template-lifecycle-v1` is a single capability — a Template's life after
    // creation — and the contract argues at length that splitting it would be wrong: *"retirement
    // without re-assignment strands adopters and re-assignment without retirement has no trigger."*
    // Landing them separately would mean shipping a retire route with no way to move its adopters.
    //
    // WHAT SECURITY REVIEW SETTLED, so the rungs are not re-derived: **all four `sensitive`, none
    // `critical`.** Nothing is destroyed, no authority changes, and a label alters no scope — which
    // is `theBoundary`'s whole point. `set-template` is the closest to the line and the consistency
    // argument decides it: `core.platform-organization.update` rewrites a customer's commercial and
    // VAT registration at `sensitive`, and **renaming "Workspace" to "Campus" is a smaller claim on
    // a customer's identity than rewriting their VAT number.**
    //
    // *** THE RUNGS REST ON A TEMPLATE CARRYING LABELS AND NOTHING ELSE, AND THE `apps` LIST IS
    // DEFERRED RATHER THAN FORBIDDEN. *** With one, editing a Template changes WHICH Apps every
    // adopting Organization has — **an installed App is code with permissions reaching data, not a
    // label.** `core.template.update` is the first rung to revisit, ahead of `set-template`'s,
    // because update reaches every adopter in one call where set-template reaches one Organization.
    // That revisit is a security decision and is not a consequence an implementer absorbs while
    // adding a field.
    //
    // FOUR PERMISSIONS, FIVE ROUTES: `TEMPLATE_RETIRE` gates retire AND restore.
    Object.freeze({ permissionId: TEMPLATE_ADOPTION_READ, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_UPDATE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: TEMPLATE_RETIRE, scope: PLATFORM_SCOPE }),
    Object.freeze({ permissionId: PLATFORM_ORGANIZATION_SET_TEMPLATE, scope: PLATFORM_SCOPE }),
  ]),
});

/**
 * Held by `platform-admin` in `permission-catalog.yaml` and REACHABLE BY NO ROUTE IN THIS CLASS.
 *
 * They are in the role because the catalog puts them there, and they are deliberately NOT in the
 * envelope, so the ceiling refuses them for every caller — the same thing
 * `roles.ts::NOT_GRANTED_TO_ANY_ROLE` does from the other side. A grant nobody can exercise and a
 * declaration nobody holds are the two halves of `authorizer.ts`, and this is the first.
 *
 * `core.principal.grant-platform-scope` is the broadest grant in the system and there is no
 * operation that performs it: `0025` publishes no route that creates a platform operator, so this
 * permission gates nothing and MUST NOT ACQUIRE A ROUTE by someone noticing it is unused.
 * `core.marketplace.moderate` has no marketplace to moderate; AZ8 records that the platform-scope
 * view of published Apps that moderation needs does not exist as a permission at all.
 *
 * ===========================================================================================
 * IT GREW FROM TWO TO FOUR ON 2026-09-05, AND THE TWO NEW ONES ARE A DIFFERENT KIND
 * ===========================================================================================
 *
 * The original two are unreachable **permanently and by design** — one gates an operation `0025`
 * refuses to publish, the other a product that does not exist.
 *
 * **`core.platform-audit.read` and `core.principal.revoke-platform-scope` are unreachable only
 * because their routes are not built yet.** `platform-audit-read-v1` and `platform-operators-v1`
 * are both accepted, and each will move its permission into `PLATFORM_PERMISSION_ENVELOPE` as its
 * routes land. **That is the ceiling rising deliberately, one contract at a time**, which is the
 * shape `0023` established and the opposite of trimming the floor to fit.
 *
 * THEY ARE LISTED HERE RATHER THAN AT THE BOTTOM OF THE ROLE so that the file's structure states
 * which grants are inert. A permission sitting in the role list beside six reachable ones, with
 * nothing marking it, is one a reader assumes works.
 *
 * *** DO NOT "TIDY" THE FIRST TWO INTO THE ENVELOPE WHEN ADDING THE LAST TWO. *** They look
 * identical from here — four permissions the role holds and no route uses — and they are not.
 * `core.principal.grant-platform-scope` acquiring a route is the single most dangerous change
 * anyone could make to this file.
 */
const HELD_BUT_UNREACHABLE: readonly string[] = Object.freeze([
  'core.principal.grant-platform-scope',
  'core.marketplace.moderate',
  // ---- Unreachable UNTIL BUILT, not by design. See above.
  //
  // `core.platform-audit.read` LEFT THIS LIST ON 2026-09-05 when `platform-audit-read-v1` landed,
  // exactly as this comment said it would.
  //
  // *** SO DID `core.principal.revoke-platform-scope`, LATER THE SAME DAY — AND NOT ON TIME. ***
  // The revoke route shipped while this permission was still here, which made it `forbidden` to
  // every operator alive. **The instruction above was written by the person who then skipped it**,
  // one route later. `assertEveryRoutePermissionIsReachable` in `platform-routes.ts` now makes
  // that omission a build failure rather than a comment nobody re-reads.
  //
  // ---- ADDED 2026-09-07, AND THIS TIME THE ORDER WAS THE POINT RATHER THAN AN AFTERTHOUGHT.
  //
  // `core.platform-organization.update` — the eleventh permission `permission-catalog.yaml` grants
  // this role, **granted by the user on 2026-09-07 and relayed by the Team Lead**, who does not
  // approve (`security.md` §8). It arrives HERE rather than straight into the reachable set because
  // **no route serves it yet**, which is what this list means.
  //
  // IT LEAVES THIS LIST IN THE SAME CHANGE THAT REGISTERS THE ROUTE, and neither half can be
  // forgotten: the envelope guard fails the build if a route's permission is not in the ceiling,
  // and `assertEveryRoutePermissionIsReachable` fails it if no role holds it. **Getting the order
  // wrong is a build failure rather than a subtle defect**, which is exactly what the two mistakes
  // recorded above bought.
  //
  // *** IT LEFT THIS LIST THE SAME DAY, when `platform.organizations.identity.update` was
  // registered — which is what the entry above said would happen, and the third time this list has
  // done the job it was built for. Removing it from here also removes it from the ROLE, because
  // that list spreads this constant, so `PLATFORM_ADMIN_PERMISSIONS` names it explicitly now. That
  // is the exact trap recorded at the role's own comment, avoided by having been recorded. ***
  //
  // =============================================================================================
  // ---- ADDED 2026-09-11. THE FOUR `template-lifecycle-v1` PERMISSIONS. **GRANTED BY THE USER**,
  // relayed by the Team Lead, who does not approve (`security.md` §8). The catalogue records the
  // grant and the user's words at `permission-catalog.yaml`'s `platform-admin` entry: *"Finalize
  // and register the four proposed Template permissions."*
  // =============================================================================================
  //
  // *** THEY ARRIVE HERE AND NOT IN THE ENVELOPE, WHICH IS THIS LIST DOING EXACTLY ITS JOB. ***
  // `template-lifecycle-v1` is ACCEPTED and **Core registers none of its five routes**, so all four
  // gate nothing. The catalogue says the same thing in the grant note — *"NO FAIL-OPEN —
  // deny-by-default, and none is reachable until Core registers a route. FOUR PERMISSIONS THAT GATE
  // NOTHING TODAY."*
  //
  // THIS IS A TRANSCRIPTION OF A RECORDED GRANT AND NOT A GRANT. The catalogue is the register;
  // `0007` rule 4 makes it the thing that decides. Core's copy being SHORT of it is the divergence
  // `registry-coherence` caught — *"a transcription that is no longer verbatim is a file whose
  // header can no longer be trusted about anything"* — and the repair is to match the register,
  // never to widen the ceiling ahead of a route.
  //
  // *** WHEN THE ROUTES LAND, ALL FOUR MOVE OUT OF HERE AND MUST BE NAMED EXPLICITLY IN
  // `PLATFORM_ADMIN_PERMISSIONS` IN THE SAME EDIT. *** That list SPREADS this constant, so removing
  // an entry here silently removes it from the ROLE, leaving it in the ceiling and in no floor —
  // `forbidden` to every operator, from the opposite cause. **Two agents made that mistake on one
  // day and it is recorded three times in this file.** Four permissions is four chances to make it
  // once; `assertEveryRoutePermissionIsReachable` turns each into a build failure rather than a
  // subtle defect.
  //
  // NOTE THE SPLIT IS 4 PERMISSIONS TO 5 ROUTES, NOT 4-TO-4. `core.template.retire` gates BOTH
  // `platform.templates.retire` AND `platform.templates.restore`, deliberately — one reversible,
  // non-destructive toggle on platform configuration. A reader counting one permission per route
  // will conclude one is missing.
  //
  // *** ALL FOUR LEFT THIS LIST THE SAME DAY, when `template-lifecycle-v1`'s five routes were
  // registered — which is what the paragraph above said would happen, and the fourth time this list
  // has done the job it was built for. They are named explicitly in `PLATFORM_ADMIN_PERMISSIONS`
  // below, because this list SPREADS this constant and removing an entry here would otherwise have
  // taken all four out of the ROLE as well. That is the trap recorded three times in this file, met
  // four times at once, and avoided by having read the record before the edit rather than after. ***
]);

function platformGrant(permissionId: string): PermissionGrant {
  return Object.freeze({ permissionId, scope: PLATFORM_SCOPE });
}

/**
 * `platform-admin` — the **eleven** permissions `permission-catalog.yaml` gives the role, at the
 * `- id: platform-admin` entry.
 *
 * ===========================================================================================
 * IT SAID "THE EIGHT... VERBATIM" AND IT WAS NEITHER. CORRECTED 2026-09-05.
 * ===========================================================================================
 *
 * *** AND ON 2026-09-07 IT SAID "TEN" AT LINE 914, WHICH WAS THE RIGHT COUNT AND THE WRONG LINE.
 * *** The count moved to eleven with `core.platform-organization.update`; the line had already
 * moved to 1076 without anyone touching this file, because the catalog grew above it.
 *
 * **A LINE NUMBER IS THE MOST PERISHABLE CITATION THERE IS** — it goes stale when a file someone
 * else owns changes somewhere else entirely, and nothing anywhere goes red. The anchor is now the
 * entry's own key, which moves with it. The COUNT stays, because the paragraph below is right that
 * a number is checkable in one glance and unfalsifiable prose is how the first version stayed
 * wrong; it is the *pointer* that had to stop being positional, not the figure.
 *
 * The catalog gives ten; this list held eight. Missing: **`core.platform-audit.read`** and
 * **`core.principal.revoke-platform-scope`**, both added to the catalog on 2026-09-05 and never
 * transcribed here.
 *
 * Both arrive through `HELD_BUT_UNREACHABLE`, which is where they belong — see that constant for
 * why its entries are TWO DIFFERENT KINDS of unreachable — permanent by design, and not built
 * yet — which is the distinction that matters and does not go stale when the list changes size.
 * **It said "the four entries" while there were two, and then three.** The kinds are the point;
 * the count never was.
 *
 * **THIS DIRECTION FAILS CLOSED** — a permission absent from the floor is a permission the role
 * does not hold, so nothing was over-granted and no route was reachable that should not have been.
 * **The defect is the claim, not the consequence.** *"Verbatim"* and *"eight"* were both false in a
 * file whose entire job is being a faithful transcription, and a comment asserting fidelity is
 * exactly what stops the next reader from opening the catalog to check. Same shape as a route
 * comment citing a `successStatus` the contract does not declare.
 *
 * **AND ONE OF THE TWO IS THE PERMISSION `0028` IS ABOUT.** `core.platform-audit.read` gates the
 * audit feeds that decision publishes; without it here, `platform-audit-read-v1` would have been
 * built against a role that could not reach it, and the failure would have looked like an
 * authorization bug rather than a missing line.
 *
 * THE COUNT IS IN THE SENTENCE ON PURPOSE, WITH THE LINE NUMBER. A number is checkable against the
 * catalog in one glance; "the permissions the catalog gives the role" is not, and unfalsifiable
 * prose is how the first version stayed wrong.
 *
 * IT IS NOT TRIMMED TO THE SIX THE ENVELOPE DECLARES, and that is the same judgement `worker.ts`
 * records for `CUSTOMERS_APP_PERMISSIONS`: the ceiling and the floor are different objects, and
 * narrowing one to match the other conflates them and makes a future widening silently
 * insufficient. The extra permissions are unreachable through the ceiling, which is
 * `authorizer.ts` working as designed rather than a gap.
 */
const PLATFORM_ADMIN_PERMISSIONS: readonly string[] = Object.freeze([
  ...HELD_BUT_UNREACHABLE,
  ORGANIZATION_CREATE,
  ORGANIZATION_LIST,
  TEMPLATE_READ,
  TEMPLATE_LIST,
  TEMPLATE_CREATE,
  CREDENTIAL_RESET,
  // ---- MOVED HERE FROM `HELD_BUT_UNREACHABLE` ON 2026-09-05, WHEN ITS ROUTES LANDED.
  //
  // *** AND THE MOVE WAS BRIEFLY A DEFECT, WHICH IS WORTH LEAVING RECORDED. *** Taking it out of
  // `HELD_BUT_UNREACHABLE` also took it out of the ROLE, because this list spreads that constant —
  // so for a few minutes the permission was in the envelope (the ceiling admitted it) and in no
  // role (the floor did not grant it), and both audit feeds would have answered `forbidden` to
  // every operator.
  //
  // NOTHING FAILED TO COMPILE AND NO GUARD FIRED: a ceiling with nothing under it is a coherent
  // state, and it is the same "reachable by nobody" shape the envelope's own guard is designed to
  // tolerate for permissions whose routes do not exist yet. **It was found by printing
  // `reachablePlatformPermissions('platform-admin')` and reading it**, which is the whole argument
  // for measuring the thing rather than reasoning about the edit.
  PLATFORM_AUDIT_READ,
  // ---- AND `core.principal.revoke-platform-scope`, ADDED IN THE SAME EDIT THAT REMOVED IT FROM
  // `HELD_BUT_UNREACHABLE` — BECAUSE I MADE THE IDENTICAL MISTAKE TWICE IN ONE DAY.
  //
  // Removing a permission from `HELD_BUT_UNREACHABLE` also removes it from THIS list, which
  // spreads that constant. The first time, `core.platform-audit.read` spent minutes in the
  // envelope and in no role. **I wrote a comment about it at the line above, and then did it again
  // one route later.**
  //
  // BOTH HALVES ARE REQUIRED AND NEITHER IMPLIES THE OTHER: the envelope is the ceiling, this list
  // is the floor, and `authorize()` needs the permission in both. A permission in one and not the
  // other is `forbidden` to every operator — which is the same symptom from opposite causes, and
  // is why `assertEveryRoutePermissionIsReachable` now checks the whole chain rather than the
  // ceiling alone.
  PRINCIPAL_REVOKE_PLATFORM_SCOPE,
  // ---- AND `core.platform-organization.update`, 2026-09-07, MOVED OUT OF `HELD_BUT_UNREACHABLE`
  // IN THE SAME CHANGE THAT REGISTERED ITS ROUTE.
  //
  // **Named here explicitly for the reason recorded twice above**: this list SPREADS
  // `HELD_BUT_UNREACHABLE`, so taking a permission out of that constant silently takes it out of
  // the role as well, leaving it in the ceiling and in no floor — `forbidden` to every operator.
  // Two agents made that mistake on one day; this line is the third occasion and the first where
  // the record was read before the edit rather than after it.
  PLATFORM_ORGANIZATION_UPDATE,
  // =========================================================================================
  // ---- AND THE FOUR `template-lifecycle-v1` PERMISSIONS, 2026-09-11, MOVED OUT OF
  // `HELD_BUT_UNREACHABLE` IN THE SAME CHANGE THAT REGISTERED THEIR FIVE ROUTES.
  // =========================================================================================
  //
  // **NAMED EXPLICITLY, FOR THE REASON RECORDED THREE TIMES ABOVE**: this list SPREADS
  // `HELD_BUT_UNREACHABLE`, so taking a permission out of that constant silently takes it out of the
  // ROLE, leaving it in the ceiling and in no floor — `forbidden` to every operator, from the
  // opposite cause. **Two agents made that mistake on one day.** Four permissions is four chances to
  // make it once; `assertEveryRoutePermissionIsReachable` now checks the whole chain and turns each
  // into a build failure.
  //
  // *** ENUMERATED AND NEVER A WILDCARD. *** The user restated it as a boundary with the grant, and
  // this file's opening line already warns that `platform-admin: ['core.*']` *"would be shorter and
  // would read as"* the obvious thing. Four ids, no pattern, no group grant.
  TEMPLATE_ADOPTION_READ,
  TEMPLATE_UPDATE,
  TEMPLATE_RETIRE,
  PLATFORM_ORGANIZATION_SET_TEMPLATE,
]);

/**
 * `marketplace-moderator` — one permission, and it currently reaches nothing.
 *
 * THIS ROLE CANNOT USE THE ADMIN CONSOLE AT ALL, AND THAT IS THE CONTRACT'S STATED CHOICE RATHER
 * THAN A DEFECT HERE. `platform.session.whoami` declares `core.organization.list` rather than
 * inventing a `core.platform.whoami`, so a moderator cannot even ask what it may do. The contract
 * records the cost as PO-5 and rules that the fix is NOT to grant the moderator Organization
 * enumeration — a permission it has no business holding — but to revisit the whoami ruling when a
 * second platform role is actually held. Nobody holds this role today.
 */
const MARKETPLACE_MODERATOR_PERMISSIONS: readonly string[] = Object.freeze([
  'core.marketplace.moderate',
]);

const GRANTS_BY_PLATFORM_ROLE: Readonly<Record<PlatformRole, PrincipalGrants>> = Object.freeze({
  'platform-admin': Object.freeze({
    grants: Object.freeze(PLATFORM_ADMIN_PERMISSIONS.map(platformGrant)),
  }),
  'marketplace-moderator': Object.freeze({
    grants: Object.freeze(MARKETPLACE_MODERATOR_PERMISSIONS.map(platformGrant)),
  }),
});

/** What a principal holding no recognised platform role gets. Empty, and there is no "all". */
const NO_PLATFORM_GRANTS: PrincipalGrants = Object.freeze({ grants: Object.freeze([]) });

/**
 * The mapping. THE ONLY PLACE A PLATFORM ROLE NAME IS TURNED INTO PERMISSIONS.
 *
 * `AUTHORIZATION_STANDARD.md` §9 — *"A role name appearing in a conditional in source is a defect.
 * Code checks permissions."* — is preserved rather than broken by this file: the role name appears
 * HERE, once, in a lookup, and nowhere downstream. `PrincipalGrants` reaches the authorizer as a
 * set of permissions with no memory of which role produced it.
 *
 * THE ONE EXCEPTION IS THE AUDIT RECORD, WHICH STORES THE ROLE. That is not a conditional and
 * makes no decision — it records what authority an action was taken under, which is the question
 * an investigation asks. See `0009_platform_operator_action.sql`.
 */
export function grantsForPlatformRole(role: PlatformRole | null): PrincipalGrants {
  return role === null ? NO_PLATFORM_GRANTS : GRANTS_BY_PLATFORM_ROLE[role];
}

/**
 * The permissions a role holds that a platform route can actually evaluate: the intersection of
 * the role's grants with the envelope's ceiling.
 *
 * ===========================================================================================
 * THIS IS WHAT `whoami` RETURNS, AND THE CHOICE IS AN INTERPRETATION THE CONTRACT LEAVES OPEN.
 * ===========================================================================================
 *
 * `whoamiOutput.permissions` is described as "the effective permission list, for rendering only",
 * and there are two honest readings: everything the role holds (eight for `platform-admin`), or
 * everything the role can exercise here (six).
 *
 * THE INTERSECTION IS CHOSEN because the route's stated purpose is "so the console can render
 * only the actions this operator may take". Reporting `core.principal.grant-platform-scope` would
 * tell a console it may take an action NO ROUTE IMPLEMENTS AND NONE MAY ACQUIRE, and the console's
 * reasonable response would be to draw a button for it. Reporting the reachable set cannot mislead
 * in that direction.
 *
 * IT DISCLOSES NOTHING EITHER WAY. Both readings describe the CALLER'S OWN authority, to the
 * caller, and `0007` D8 applies to both: UI hiding is presentation, never security — every
 * permission in this list is enforced again by Core on the call itself, and a console that ignored
 * it entirely would be ugly and exactly as safe.
 *
 * REPORTED TO THE TEAM LEAD as something `platform-operator-v1` should pin down before a second
 * platform role exists.
 */
export function reachablePlatformPermissions(role: PlatformRole | null): readonly string[] {
  const held = grantsForPlatformRole(role);
  const reachable: string[] = [];
  for (const declaration of PLATFORM_PERMISSION_ENVELOPE.declared) {
    if (held.grants.some((grant) => grant.permissionId === declaration.permissionId)) {
      reachable.push(declaration.permissionId);
    }
  }
  return Object.freeze(reachable);
}

/**
 * Seven. Named so the guard below compares against a STATED number rather than a bare literal.
 *
 * *** IT WENT FROM SIX TO SEVEN ON 2026-09-05 AND THE GUARD IS WHAT MADE THAT A DECISION. ***
 * Adding `core.platform-audit.read` to the envelope threw at module load until this line was
 * edited — so widening the class's ceiling cannot happen as a side effect of adding a route. **The
 * failure message IS the argument the widener has to answer**, and editing this constant is the
 * act of answering it.
 *
 * THE SEVENTH'S ARGUMENT: `platform-audit-read-v1` is accepted, `0028` Decision 3 designs its two
 * feeds around a disclosure rule, and the permission was already in the catalog and already
 * granted to `platform-admin` — it sat in `HELD_BUT_UNREACHABLE` precisely so that the ceiling
 * would rise when the routes landed rather than in advance.
 *
 * ===========================================================================================
 * THE EIGHTH'S ARGUMENT — `core.principal.revoke-platform-scope`, 2026-09-05
 * ===========================================================================================
 *
 * **`platform-operators-v1` is accepted and `platform.operators.revoke` is registered.** Without
 * this entry the route is `forbidden` to every caller regardless of role, because the envelope is
 * the class ceiling — which is exactly what happened, and is why
 * `assertEveryRoutePermissionIsReachable` now exists.
 *
 * **WHY THE CLASS SHOULD WIDEN FOR IT RATHER THAN THE ROUTE BEING REFUSED**, which is the question
 * this constant asks: revocation is the only mechanism by which platform authority can be
 * withdrawn at all. `0025` publishes no route that GRANTS it — that stays out-of-band SQL,
 * deliberately, because *"a route that grants platform authority is the single most valuable target
 * in the platform"*. **Grant and revoke are not symmetric and should not be**: the dangerous
 * direction is creating authority, and the dangerous state is authority that cannot be taken away.
 * A platform with no revoke route is one where a compromised operator is removed by editing the
 * database by hand, under incident conditions.
 *
 * **AND IT IS THE MOST CONSTRAINED ENTRY IN THIS ENVELOPE.** It is the only one whose route is
 * confirmation-gated, so reaching it requires re-authentication and a confirmation bound to the
 * specific principal being revoked — `session theft alone cannot revoke anyone`, which is the
 * property the catalog states and which is true only because all of this holds together.
 *
 * **A NINTH NEEDS ITS OWN.**
 *
 * ===========================================================================================
 * THE NINTH'S ARGUMENT — `core.platform-organization.update`, 2026-09-07
 * ===========================================================================================
 *
 * **`organization-identity-v1` is accepted, `docs/decisions/0031` records the design, and the
 * permission was granted to `platform-admin` by THE USER on 2026-09-07** — relayed by the Team
 * Lead, who does not approve (`security.md` §8). It sat in `HELD_BUT_UNREACHABLE` from the moment
 * it was transcribed until `platform.organizations.identity.update` was registered, which is the
 * ordering this file's two recorded mistakes bought.
 *
 * **WHY THE CLASS SHOULD WIDEN FOR IT.** Organizations had no name, so the operator console's
 * list, its detail header and the Organization picker were 22-character opaque identifiers —
 * `0002_organization.sql` predicted exactly that consequence rather than discovering it. **The
 * party best placed to supply these values cannot: `organization` is a control-plane table and no
 * Action can reach it**, so a Dudo operator transcribes a customer's own legal identifiers on
 * their word. That asymmetry is what the route exists to serve and it is also its cost (`OI-1`).
 *
 * **IT IS NOT `core.organization.update` WIDENED, AND THAT MATTERS.** That permission is declared
 * `[organization]` and is a TENANT principal editing its own record; adding `platform` to its
 * scopes is the `AZ8` escalation the catalog names — *"widening a tenant-scoped permission above
 * the tenant boundary is an escalation, not a convenience."* Two permissions, not one widened one.
 *
 * **WHAT IT DOES NOT COVER, STATED SO IT NEVER COMES TO IMPLY IT: not suspension, not deletion,
 * not `status` of any kind.** No shape in `organization-identity-v1` carries `status`. A suspend
 * route, when it exists, is a separate permission and a separate argument.
 *
 * *** AND IT AUTHORISES A WRITE INTO THE CUSTOMER'S OWN TENANT DATABASE — five row-writes from
 * that Organization's daily allocation — WHICH THE APPROVAL DESCRIPTION DID NOT SAY. *** Recorded
 * here rather than left in the catalog's margin. It is *for* the customer rather than at their
 * expense: `0028` requires the tenant to see what the platform did to them, and this is the
 * clearest instance the surface has, because they cannot see the field any other way.
 *
 * ===========================================================================================
 * THE TENTH THROUGH THIRTEENTH — `template-lifecycle-v1`'s four, 2026-09-11
 * ===========================================================================================
 *
 * **FOUR AT ONCE IS THE LARGEST WIDENING THIS CEILING HAS HAD, AND THE PRECEDING ENTRIES DEMAND ONE
 * ARGUMENT PER PERMISSION.** They get one each below — but the reason they arrive together is a
 * single answer and it goes first: **they are one contract.** `template-lifecycle-v1` is one
 * capability, a Template's life after creation, and it argues that splitting it would be wrong —
 * *"retirement without re-assignment strands adopters and re-assignment without retirement has no
 * trigger."* **Landing them one at a time would mean shipping a retire route with no way to move the
 * Organizations it strands.** That is a worse state than either the before or the after.
 *
 * **GRANTED BY THE USER, 2026-09-11**, relayed by the Team Lead, who does not approve
 * (`security.md` §8): *"Finalize and register the four proposed Template permissions."*
 *
 * **`core.template.update`.** `template-v1` TM-1 deferred editing with an obligation rather than a
 * shrug, and this discharges it: an operator who mistypes a business type currently cannot fix it.
 * **Not folded into `core.template.create`** — §3.2's splitting discipline applied before rather
 * than after: *"an operator who may add a business type is not automatically an operator who may
 * change one forty Organizations are rendering."* Update has STRICTLY MORE REACH than create — a
 * create reaches nobody until something adopts it.
 *
 * **`core.template.retire`.** TM-2's route, and **the one that makes `retired` reachable for the
 * first time**: `d1-template-store.ts` writes `'active'` as a literal in the INSERT, so the second
 * value has never existed. **Separate from update because they are different authorities over
 * different things** — update changes what a Template SAYS, retire changes whether it may be CHOSEN
 * — and a single `core.template.write` covering both would grant exactly that conflation.
 * **IT GATES RESTORE TOO, AND THE COST OF THAT MERGE IS RECORDED RATHER THAN IMPLIED: ANYONE WHO MAY
 * RESTORE MAY ALSO RETIRE**, so a low-privilege recovery role cannot exist while it holds. It stands
 * for version 1 and reopens on either of two named triggers.
 *
 * **`core.platform-organization.set-template`.** PA-17. **Not `core.platform-organization.update`,
 * and that entry rules itself out in terms** — it covers display name, CR and VAT and states *"IT
 * DOES NOT COVER STATUS"*. Reusing it would widen it by adoption rather than by decision, which is
 * what it refused for status. **It authorises a write into the customer's own tenant database** —
 * five row-writes from that Organization's allocation, reading nothing from it — bounded by
 * `PLATFORM_ORIGINATED_DAILY_ROW_WRITES`, which is keyed to the VICTIM rather than the attacker.
 *
 * **`core.template-adoption.read`.** **Added late, on security review, overturning this contract's
 * own first answer** — the usage route originally reused `core.template.read` and argued a new
 * permission *"would be a split with no decision in it"*, while the next key spent thirty lines
 * identifying the decision. `core.template.list` is also a read, so a holder of read-plus-list
 * **enumerates every Template and sums the counts: a customer-base census, and polled over time a
 * customer growth rate.** `security.md` §2a is the general form — *a count is safe exactly when its
 * consumer already holds enumeration over the counted population*, and a template reader does not.
 * **A rate limit is not a substitute: the vector is longitudinal, not burst.**
 *
 * **A FOURTEENTH NEEDS ITS OWN.**
 */
const PLATFORM_ROUTE_PERMISSION_COUNT = 13;

export class PlatformPermissionModelIncoherentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformPermissionModelIncoherentError';
  }
}

/**
 * Runs at module load, like `assertRoleMappingIsCoherent` and `assertRegistryIsCoherent`, and for
 * the same reason: a permission set that had drifted would do it silently and would be discovered
 * as a privilege nobody meant to give.
 *
 * THE PARAMETERS EXIST SO THE THROW BRANCHES CAN BE REACHED FROM A TEST, and they default to the
 * shipped values so every existing call is unchanged. Same change, same reason, as
 * `assertRoleMappingIsCoherent` and `assertAllocationsAreCoherent`: these read module-level
 * `const` bindings that ESM will not let a test rebind, so their branches would otherwise be
 * unreachable without editing `platform/core/**`, which `qa-agent` correctly will not do.
 *
 * WHAT IT CANNOT CHECK: that the sets are the RIGHT ones. That is `0025`'s judgement and the
 * catalog's, not a computable property — so changing one is a deliberate act that also has to
 * edit this assertion.
 */
export function assertPlatformPermissionModelIsCoherent(
  mapping: Readonly<Record<PlatformRole, PrincipalGrants>> = GRANTS_BY_PLATFORM_ROLE,
  envelope: AppPermissionEnvelope = PLATFORM_PERMISSION_ENVELOPE,
  noRoleGrants: PrincipalGrants = grantsForPlatformRole(null),
  membershipRoles: readonly string[] = MEMBERSHIP_ROLES,
  platformRoles: readonly string[] = PLATFORM_ROLES,
): void {
  // =========================================================================================
  // 1. THE TWO ROLE UNIONS ARE DISJOINT. `0024` invariant 2, mechanically.
  // =========================================================================================
  //
  // "MembershipRole never gains a platform-tier value." A shared value is how a membership row
  // comes to carry platform authority — the exact trap `0024` records — and it would arrive as a
  // one-word edit to a union in a different file, reviewed by someone who had never read this one.
  for (const platformRole of platformRoles) {
    if (membershipRoles.includes(platformRole)) {
      throw new PlatformPermissionModelIncoherentError(
        `'${platformRole}' is both a MembershipRole and a PlatformRole. docs/decisions/0024 ` +
          'invariant 2: MembershipRole must never gain a platform-tier value. scope.ts ranks ' +
          "'platform' at 0, so implies('platform', X) is true for every X — a membership row " +
          'carrying platform authority passes authorization for every Action at every scope, and ' +
          'the storage boundary then scopes that principal into the Organization and serves the ' +
          'rows. Nothing is bypassed: the membership row IS the bypass.',
      );
    }
  }

  // =========================================================================================
  // 2. THE ROLE MAPPING. The same five properties `assertRoleMappingIsCoherent` checks.
  // =========================================================================================
  for (const role of platformRoles) {
    const mapped = mapping[role as PlatformRole];
    if (mapped === undefined || mapped.grants.length === 0) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform role '${role}' maps to no permissions. A role that grants nothing is ` +
          'indistinguishable from an absent one and should be removed rather than left as a ' +
          'value a platform_operator row can hold.',
      );
    }
    for (const grant of mapped.grants) {
      if (grant.permissionId.includes('*') || grant.permissionId.trim() === '') {
        throw new PlatformPermissionModelIncoherentError(
          `The platform role '${role}' grants '${grant.permissionId}', which is a wildcard or ` +
            'blank. docs/decisions/0007 rule 3 forbids wildcards and rule 4 requires explicit ' +
            'registration. At platform scope a wildcard is not untidy, it is unbounded authority ' +
            'over every Organization on the platform.',
        );
      }
      if (grant.scope !== PLATFORM_SCOPE) {
        throw new PlatformPermissionModelIncoherentError(
          `The platform role '${role}' grants '${grant.permissionId}' at scope ` +
            `'${grant.scope}'. Every permission in permission-catalog.yaml held by a ` +
            "platform-scope role is declared 'scopes: [platform]', and a grant at any other " +
            'scope here is a tenant-scoped permission held by a principal with no tenant.',
        );
      }
    }
  }
  if (noRoleGrants.grants.length !== 0) {
    throw new PlatformPermissionModelIncoherentError(
      'An absent or unrecognised platform role grants something. It must deny everything, on ' +
        'the same path as an absent platform_operator row — which is what makes a row written by ' +
        'a future migration this build does not understand fail onto the safe path.',
    );
  }

  // =========================================================================================
  // 3. THE ENVELOPE. Six, at platform scope, no duplicates, no wildcards.
  // =========================================================================================
  if (envelope.declared.length !== PLATFORM_ROUTE_PERMISSION_COUNT) {
    throw new PlatformPermissionModelIncoherentError(
      `The platform envelope declares ${String(envelope.declared.length)} permissions and the ` +
        `class has ${String(PLATFORM_ROUTE_PERMISSION_COUNT)}. Membership is stated in ` +
        'PLATFORM_ROUTE_PERMISSION_COUNT and every increment needs its own argument — the ' +
        'discipline that keeps "it is a platform route so it needs no tenant" from becoming a ' +
        'way to write an Action without a tenant check.',
    );
  }
  const seen = new Set<string>();
  for (const declaration of envelope.declared) {
    if (seen.has(declaration.permissionId)) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}' twice. Two entries for one ` +
          'permission is two ceilings, and `authorize()` reads the first it finds.',
      );
    }
    seen.add(declaration.permissionId);
    if (declaration.permissionId.includes('*') || declaration.permissionId.trim() === '') {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}', which is a wildcard or ` +
          'blank. The envelope is the ceiling; a wildcard ceiling is no ceiling.',
      );
    }
    if (declaration.scope !== PLATFORM_SCOPE) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}' at scope ` +
          `'${declaration.scope}'. Every route in this class evaluates at 'platform', and a ` +
          'declaration at a narrower scope produces a route that is registered and permanently ' +
          'refused.',
      );
    }
    if (HELD_BUT_UNREACHABLE.includes(declaration.permissionId)) {
      throw new PlatformPermissionModelIncoherentError(
        `The platform envelope declares '${declaration.permissionId}', which is held by ` +
          'platform-admin and is deliberately reachable by no route. Adding it to the envelope ' +
          'would mean a route now exists that exercises it — for grant-platform-scope that is a ' +
          'route which creates platform authority, which docs/decisions/0025 refuses to publish.',
      );
    }
  }
}

assertPlatformPermissionModelIsCoherent();
