# The Dudo Admin capability matrix

- **Owner:** `architecture-agent` authors; the **Team Lead accepts.** This is a specification.
  Nothing here grants a permission, accepts a contract, or approves a technology.
- **Date:** 2026-09-08
- **Scope:** every administrative capability the full Dudo system needs, across Milestones 1–6.
- **Companion:** `docs/architecture/administration-split.md` — the rule that decides which surface
  a row belongs on, and the mechanism that does or does not enforce it.

**This is the spine of Milestones 1–6, so it is complete rather than illustrative.** Where a row is
missing a contract, a permission or an implementation, it says so in those words. Per
`workflow.md` §12, a document that describes a thing as absent when it exists — or present when it
does not — is a defect of the document, not a gap in the reader's knowledge.

---

## 0. Findings that need a Team Lead ruling or a user decision

**At the top rather than the bottom.** Nine, ordered by what they block.

### F-1 — BLOCKER for Milestone 2: twelve tenant-scope `critical` permissions are unreachable, because the confirmation challenge is a platform-only route

`platform.confirmations.request` (`POST /api/v1/platform/confirmations`) is a **platform-class**
route. Platform routes answer **404** off the admin hosts — in `http/api.ts`, at the
`matchPlatformRoute` branch, where a route that matched but whose host fails `isPlatformHost`
returns `renderError(notFound(), …)`. **Anchored to the two named symbols rather than to a line
number**, per `architecture.md` §3c's worst variant: a line number is not an identifier, and
citing one here would be unfalsifiable by inspection. `api.ts` is in fact a single-branch file
rather than a table of repeated blocks, so a line would have been *stable* — **but "stable" is a
property a reader cannot check from the citation, and the symbol names are.** There is **no
tenant-side route that issues a confirmation challenge** — established by enumerating all five
route tables (`identity/pre-auth-registry.ts`, `identity/session-routes.ts`,
`platform/platform-routes.ts`, `http/core-routes.ts`, `apps/customers/api/routes.ts`), not by a
search that could fail silently.

**The Action pipeline does have the gate, verified in the file rather than taken from the comment
that says so.** `platform/core/action/pipeline.ts` imports `requiresConfirmation` from
`confirmation/critical-permissions.ts` and branches on it at the confirmation step —
`if (requiresConfirmation(action.permission))` — and its `confirmations?: ConfirmationGate`
dependency is documented as **fail-closed**: *"OPTIONAL HERE, AND ABSENT MEANS EVERY `critical`
OPERATION IS REFUSED — not permitted, not skipped: refused."*

**So the lock is fitted on both surfaces and only one of them has a way to obtain a key.** A
tenant principal's request for a critical Action is refused either because the gate is uncomposed
or because it cannot present a confirmation it has no route to acquire.

**Consequence, enumerated individually rather than as a category:** every operation gated by these
**twelve** tenant-scope `critical` permissions is unreachable once built —
`core.ai.configure`, `core.api-credential.issue`, `core.api-credential.revoke`,
`core.app.grant-permission`, `core.app.uninstall`, `core.capability.configure-provider`,
`core.mcp.configure-external`, `core.organization.delete`, `core.service-account.manage`,
`core.subscription.change`, `core.tenant.export`, `customers.customer.delete`.

`customers.customer.delete` is the one already visible: its route is registered `kind: 'deferred'`
and `critical-permissions.ts` names it as the reason confirmation may never be per-Action — *"the
Action that forgets is the dangerous one, and it will look exactly like the ones that did not."*

**It fails closed, so this is a delivery blocker rather than a security defect.**

### It is a BUILD ITEM with its design already specified — corrected 2026-09-09

**This entry previously closed:** *"It needs a decision: generalise the challenge route to the
application host, or author an Action-class equivalent. Neither is invented here."* **That was
true when it was written and false after the re-check that produced `0038`.** It is kept visible
rather than deleted, because the reason it was wrong is the useful part.

**`confirmation-v1` is `accepted` and has already chosen.** Its
**`whereItLIVES.theTWOCHALLENGEROUTES.ruling`** — anchored to the block key, not a line number:

> *"THE MECHANISM IS ONE. THE CHALLENGE ROUTE IS ONE PER EXISTING CLASS THAT CONTAINS A CRITICAL
> OPERATION, BECAUSE THE CONTEXT DIFFERS EVEN THOUGH THE LOGIC DOES NOT. Two today: one Action,
> one platform route. Both call the same Core confirmation service, which is where every rule in
> this contract is enforced."*

The sibling key **`theACTIONCLASSCHALLENGEISITSELFANACTION`** specifies the missing route in full:
it declares **the same permission as the operation it confirms**, runs the identical authorization
pipeline including the `not_found`/`forbidden` collapse, and therefore cannot be used to learn
whether a record exists. Core's `confirmation/confirmation-service.ts` says in its header that it
is the shared service for **both** routes.

> **So this needs building, not deciding.** Owner `core-agent`, against an accepted contract, with
> no new decision record. `0038` records the ruling, including the Team Lead's own wrong first
> reading of it.

**The first of the two options is now positively wrong, not merely undecided, and that is why the
sentence had to go rather than be softened.** Generalising the platform challenge route onto the
application host would put a platform-class route on the tenant surface — and the contract's reason
for the Action-class design is **a security property**, in its own words: without the borrowed
permission and the identical pipeline, *"THE CHALLENGE ENDPOINT WOULD BE A UNIVERSAL EXISTENCE
ORACLE OVER EVERY CRITICAL TARGET IN THE PLATFORM, reachable by anyone with any session"* — a
strictly worse hole than the one confirmation closes. **An option listed as live in the spine of
Milestones 1–6 is an invitation somebody eventually accepts.**

**The residual obligation that survives, so it is not lost with the correction:** the `PlatformRoutePermission`
doc comment in `platform-routes.ts` records a 2026-09-05 deferral of this route, well argued, and
`0038` converts its caution — that `Action.permission` is read by `authorize()` and by every audit
record — into a **`security-agent` review requirement on the permission-resolution path**, not a
reason to defer again.

### F-2 — BLOCKER for Milestone 2: the catalogued tenant permissions over control-plane objects have no route and cannot be given one

`core.organization.read`, `core.organization.update`, `core.organization.delete`,
`core.role.assign`, `core.role.revoke` (and the Organization's own membership administration) all
name objects that `core-object-registry.yaml` classifies **`control-plane`** —
`Organization`, `OrganizationMembership`. `organization-identity-v1`'s `OI-1` states the
consequence: **an Action reaches no control-plane port**, which is why the *platform* enters an
Organization's display name on the customer's behalf.

So **an Organization cannot read or edit its own Organization record, and cannot assign a role**,
and the reason is architectural rather than unbuilt work. This is the single largest structural
item between Milestone 0 and Milestone 2. Any answer — a fifth request class, a bounded
control-plane port reachable from an Action, or moving fields into the tenant database — is a
decision record, and `0025` Decision 3's rejection of a fifth class is what it must argue against.

### F-3 — Organization display identity appears to need both surfaces

Recorded once, as a finding, rather than listed on both sides (see `administration-split.md` §5).
`core.platform-organization.update` is platform-scope and is the only path to an Organization's
display name, commercial registration and VAT registration. `core.organization.update` is
catalogued at organization scope, granted to `business-owner`, and unroutable per F-2. Under an
admin-first product a customer who cannot correct their own company name is a product defect;
under the current architecture the platform doing it for them is the only mechanism. **Needs a
ruling.**

### F-4 — Milestone 3's platform half cannot start: `AZ8` is unresolved and `core.marketplace.moderate` gates nothing

`core.marketplace.moderate` is `critical`, held by `platform-admin` and `marketplace-moderator`,
and sits in Core's `HELD_BUT_UNREACHABLE` list **permanently and by design** —
`platform-permissions.ts` says the two originals are unreachable *"one gates an operation `0025`
refuses to publish, the other a product that does not exist."* `AZ8` records that moderation has
**no permission it may legitimately hold** over published App versions, and that widening
`core.app.read` to `platform` scope is the escalation just removed from `marketplace-moderator`.
**A new platform-scope permission is needed, and declaring one is a model decision.**

### F-5 — `APP_STANDARD.md` §9 requires seven lifecycle states; two have no permission

§9: *"Every App supports all seven states, and the platform will exercise them."* The catalog has
`install`, `configure`, `upgrade`, `disable`, `uninstall`, `read`, `grant-permission`,
`revoke-permission`. **`Activate` and `Rollback` have no permission.** §9 also says *"an upgrade
without a rollback path is not shippable."* Two permissions must be created before Milestone 3
(rows `AC-07`, `AC-08`).

### F-6 — Organization role administration is blocked on `AZ11`, and `0023`'s trigger has already fired

`core.role.create` / `.update` / `.assign` / `.revoke` are catalogued. `AZ11` records that
`authorization/roles.ts` is a **closed TypeScript union of two organization-scope roles** while
`0007` D10 says *"roles are data, never code… customers modify or replace them freely"*, and that
`0023`'s trigger — reconcile the catalog's six seed roles with the code's two *"before a second App
exists"* — has already fired. Milestone 2 is where the permission-editing surface is asked for.
**Needs the decision `AZ11` recommends: separate the label from the capability set.**

### F-7 — Five contracts have live routes while their own `status:` says `proposed`

Measured by opening each file's `status:` field and matching it against the route tables:

| Contract | `status:` | Live routes |
|---|---|---|
| `core/identity/login-v1` | `proposed` | 4 pre-auth routes |
| `core/identity/organization-selection-v1` | `proposed` | 2 session-class routes |
| `core/organization/business-read-v1` | `proposed` | 2 Core Action routes |
| `apps/customers/customer-directory-v1` | `proposed` | 8 App Action routes (+2 deferred) |
| `core/platform/organization-identity-v1` | `proposed` | 1 platform route |

`workflow.md` §3 sequences contract → **agreed** → implementation. **The matrix records what the
files say**, because the alternative is a document asserting an acceptance nobody made.

**The acceptance convention is a field pair, and it is consistent across all eight accepted
contracts:** `status: accepted` plus **`acceptedBy:`** naming the acceptor, the date, and what
unblocked it. **No `proposed` contract carries `acceptedBy:`.** So "accepted" is recorded in the
contract, not only in an ADR — only two ADRs (`0027`, `0028`) carry an `Accepts:` header at all.

**Classification, with the discriminator being `documentsExistingImplementation`** — the field that
says whether the contract was transcribed from code that already existed:

| Contract | `dEI` | Live routes | Reading |
|---|---|---|---|
| `login-v1` | `true` | 4 | **Accepted-in-fact.** The routes are `PreAuthEntryPoint`s, which `0014` §B admits *"by a decision, never by declaring itself"*. An accepted ADR decided the substance; the contract describes it |
| `organization-selection-v1` | `partial` | 2 | **Accepted-in-fact.** Same shape — the session class is `0021`'s, accepted, and *"widening it is a decision, not a refactor"* |
| `business-read-v1` | **field absent** | 2 | **Accepted-in-fact.** `audit-read-v1` cites it as the canonical form — *"`business-read-v1` defines the shape of a Core tenant Action contract; this one follows it"* — and `core-routes.ts` builds `CORE_APP_PERMISSIONS` against it |
| `customer-directory-v1` | **field absent** | 8 (+2 deferred) | **Accepted-in-fact, and the evidence is the strongest in the set.** `template-v1` — *accepted* — records that `business_id` is *"a published wire field in customer-directory-v1 that two clients have shipped against"*, and **declined a rename because of it.** A `proposed` contract's field name has already constrained an accepted decision |
| `organization-identity-v1` | `none` | 1 | **Accepted-in-fact.** `0031` is accepted and decided its substance; the user granted its permission on 2026-09-07 |
| `audit-read-v1` | `none` | 0 | **Genuinely a proposal.** Nothing built. It is the contract that makes `0028`'s struck term true again |
| `account-identifier-v1` | `partial` | 0 (binds to no route) | **Genuinely a proposal, and it must not be accepted on the strength of the others** — see below |

**`account-identifier-v1` is the one where accepting would assert something false.** It is a
cross-cutting vocabulary contract — *"Defines a value used by several contracts; binds to no route
itself"* — and its header documents a **live gap**: two identifier paths recorded as
`*** NOT GUARDED ***`, one of them carrying `onboarding.ts`'s *"Already
`isSubmittableIdentifier`-checked"* comment that names no checker. **Accepting a contract asserts
that Core implements it.** Since 2026-09-05 a `CheckedIdentifier` brand has appeared on
`MemberResolutionService.resolve`, which looks like one of the two paths being closed by exactly
the `§3a` mechanism the contract asked for — **I did not verify the onboarding path, and acceptance
should wait on that verification rather than on this table.**

**Two artifacts absent where they would decide it:** `business-read-v1` and
`customer-directory-v1` carry **no `documentsExistingImplementation` field at all** — the two
contracts with the most live routes are the two where the field that distinguishes *transcribed
from code* from *specified ahead of code* is missing.

### RESOLVED 2026-09-08 — the five were accepted, the two were not

**The Team Lead accepted `login-v1`, `organization-selection-v1`, `business-read-v1`,
`customer-directory-v1` and `organization-identity-v1` on 2026-09-08**, each on its own evidence
and explicitly not as a batch. `audit-read-v1` and `account-identifier-v1` remain `proposed`.
`business-read-v1` and `customer-directory-v1` gained the missing
`documentsExistingImplementation` field (`false` and `partial` respectively — see each file for
why). **The contract count is now 10 `accepted` / 5 `proposed`; 10 + 5 = 15 ✓.**

**Two consequences of acceptance that were recorded rather than discovered later:**

- **`business-read-v1` had named the price of its own acceptance in advance.** Its `versioning`
  section says the 2026-09-04 change of the resolve route to `POST` was *"free only because it was
  made before acceptance."* **That window closed on acceptance** — method, path and identifier
  carrier are now breaking changes — and the acceptance note says so, because nothing else in the
  file marks the transition.
- **`customer-directory-v1`'s acceptance does not accept its two `deferred` Actions as built**,
  and `customers.DeleteCustomer` stays unreachable for a second independent reason: **F-1**.

### What would make the next one fail loudly — and why the obvious fix was refused

`status:` is machine-readable and nothing executes it, which is `workflow.md` §12's residue in the
field that **instructs** rather than describes: a contract reading `proposed` while its route
serves every login on the platform teaches the next reader that the field means nothing.

**The owed check:** *every operation id present in a live route table belongs to a contract whose
`status` is `accepted`*, in the shape `scripts/check-route-fields.mjs` already uses.

**Its precondition is `0037`'s generator, not a YAML parser, and mirroring `status` into the JSON
schema half was considered and refused.** A mirrored field is **a duplicated constraint with no
citation**, which is the one shape `workflow.md` §12 says a citation-driven sweep cannot find —
*"returns nothing and reports completion."* The section's worked example is one identifier rule
restated in six contracts and cited in none, where **five of the six had drifted and the only
correct one was the one nobody had restated.** A `status` copied into two halves of one file is
that failure at range one, and the first time the halves disagree the check is asserting against
the copy.

**The generator parses this YAML anyway.** Once it exists, `status` is reachable with no new
dependency and no second copy, and `0009`'s precedent — *"cannot grow into a toolchain without a
new decision"* — stays intact. **Owed, not built. Precondition: `0037`.**

### F-8 — `permission-catalog.yaml`'s `business-owner` comment has three stale counts

Measured today: **71 `core.*` + 9 `customers.*` = 80 permissions.** `business-owner` holds **68**.
The comment above that role says *"59 of the 62 CORE permissions"*, names **three** omitted core
permissions, and totals *"68 of the 71 catalogued permissions."*

**The role's contents are correct and the platform invariant holds.** The twelve core permissions
it omits are exactly the **eleven** declared at `platform` scope plus `core.notification.read`
(declared `[own]`, `AZ5`). Nothing is over-granted; three numbers rot. It is precisely the failure
the file's own `defaultRoles` preamble warns about — *"A COUNT IN A COMMENT IS AN ASSERTION THAT
ROTS EVERY TIME A DECISION ADDS AN ENTRY, AND NOTHING GOES RED WHEN IT DOES"* — occurring in the
block **below** the block that says it, which is `workflow.md` §12's *budget for more homes than
you find*: the fix was applied once and not propagated twenty lines.

**FIXED 2026-09-08, and not by correcting the numbers.** All three counts are replaced by the
property (*every permission this role holds declares `organization` among its own scopes*), the
twelve omissions are enumerated rather than counted, and the two directions the count had
conflated are now separated: **safety** — this role over-grants nothing — is an invariant `qa-agent`
can assert today, with a known-failing input named; **completeness** — this role holds everything
eligible — is a **product policy that must not become a check**, because a check would auto-grant
every future organization-scoped permission to the most privileged tenant role. The catalogue's
`scopes: [platform]` reconciliation note is restated in **`0033`'s form** — `shape`,
`figureOn_2026-09-08: 11`, and `ifTheyDISAGREE: the entries are right and the note is wrong` —
with the honest admission that **nothing in this file can check itself**, because no YAML parser
exists in the repository, and the identity that *can* be checked (`9 + 2 = 11` against Core's
envelope and held-but-unreachable lists) named as where the check belongs.

### F-9 — `composition.ts` still frames `P1` as a count, and its trigger will fire on the wrong event

`platform/core/platform/composition.ts`, at the **`readonly reset:`** field, says *"`0025`'s
AMENDMENT SAYS 'EXACTLY ONE'… A fourth is the point to ask whether P1 still means anything."*
`0025`'s amendment of 2026-09-05 **replaced the count with a property** later the same day and
said the count *"was never the line"*; the line is **the first component that resolves a store in
order to READ.** `workflow.md` §12 residue — a decision was amended and a comment citing it was
not swept. Full treatment in `administration-split.md` §4.4. `platform/core/**` is `core-agent`'s
to edit.

---

## 1. Population examined, against an independently derived expectation

`workflow.md` §11a: *a count with nothing to compare against is a number, not a check.* Every
figure below was derived by opening the file, not by recalling it.

### 1.1 Permissions

| | Count | How derived |
|---|---|---|
| `core.*` permission entries | **71** | `^  - id: core\.` over `permission-catalog.yaml` |
| `customers.*` permission entries | **9** | `^  - id: customers\.` |
| **Total catalogued** | **80** | Independent check: `^  - id: (core\|customers)\.` = 80 ✓ |
| Declared at `platform` scope | **11** | Enumerated from the entries, not from the string `scopes: [platform]`, which occurs **14** times — 11 entries and 3 in prose. The catalog's own reconciliation note says the same |
| Classed `critical` | **16** | Catalog entries, compared name-by-name against Core's frozen `CRITICAL_PERMISSIONS` in `confirmation/critical-permissions.ts`. **The two sets are identical** |
| **Accounted for by this matrix** | **66** | Every permission that gates an administrative capability |
| **Deliberately excluded** | **14** | Enumerated individually in §7 — a category is not a list |

### 1.2 Roles

**6 seed roles** (`platform-admin`, `marketplace-moderator`, `developer`, `business-owner`,
`business-admin`, `member`); **2** at `platform` scope. `platform-admin` holds **11** platform
permissions: **9** in `PLATFORM_PERMISSION_ENVELOPE` (reachable) and **2** in
`HELD_BUT_UNREACHABLE` (`core.principal.grant-platform-scope`, `core.marketplace.moderate`) —
9 + 2 = 11 ✓, which is the arithmetic that says nothing is silently reachable.

### 1.3 Routes

Enumerated by block id from each route table.

| Class | Count | Source |
|---|---|---|
| Pre-auth entry points | **5** | `identity/pre-auth-registry.ts` — `identity.login.start`, `identity.login.complete`, `identity.session.refresh`, `identity.session.revoke`, `platform.health` |
| Session class | **2** | `identity/session-routes.ts` — `identity.session.organizations.list`, `identity.session.organization.select` |
| Platform class | **15** | `platform/platform-routes.ts` — the frozen `ROUTES` array, counted by `id:` entry |
| Core Actions | **2** | `http/core-routes.ts` — `GET /businesses`, `POST /businesses/names` |
| App Actions (`customers`) | **8 built + 2 `deferred`** | `apps/customers/api/routes.ts` |
| **Total** | **32 reachable, 34 declared** | |

**Accounted for by this matrix: all 34.** The two `deferred` entries appear as `not built`.

**The platform class is 15, not 14.** `permission-catalog.yaml`'s `model.rules` entry said *"All
fourteen of its routes DECLARE a permission"*. The **claim** stayed true — which is why nobody
noticed — while the **number** went stale the day `platform.organizations.identity.update` landed.
**Fixed 2026-09-08**: the sentence now states the property rather than the count, and names what
enforces it (`PlatformRoute.permission` is a required field, so a permissionless route does not
typecheck; `assertEveryRoutePermissionIsReachable` catches the reachability half).

### How these counts were derived, stated because the next sweeper will reach for `grep` by reflex

**Routes exist only in frozen arrays in five files, so enumeration by `Read` is the correct method
here — not a workaround for anything.** `matchPlatformRoute` matches against `platform-routes.ts`'s
frozen `ROUTES`; the router is built from `coreRoutes()`, the customers table, `session-routes.ts`
and `pre-auth-registry.ts`. **A handler file cannot add a route.**

That matters more than it looks, for a tool reason recorded in `workflow.md` §11a: **`grep` in this
shell is a `ugrep` wrapper that prints nothing and exits 1 on a NUL-bearing file** — a clean "no
matches" — and `platform/core/**` contains NUL bytes in at least `pre-auth-admission.ts` and
`platform-route-handlers.ts`. It also **honours `.gitignore`**, which excludes `CLAUDE.md` and all
of `.claude/`, so a recursive grep from the repository root searches the published subset and
silently omits the binding rules. `grep -a` addresses the first and nothing addresses the second
except an explicit path.

**Neither limitation touches any figure in §1, because none of them came from a search returning
nothing.** Every route count is an enumeration of a frozen array in a file that was opened; every
permission count is over `packages/contracts/**`, verified clean of control bytes (42 files, zero,
with a planted-NUL negative control). **A negative over Core in this document means "I enumerated
the array and it is not there", never "my search found nothing".**

### 1.4 Contracts

**18 YAML files under `packages/contracts/**`**: 3 registries (`permission-catalog`,
`core-object-registry`, `event-catalog`) and **15 contracts** — **10 `accepted`**, **5 `proposed`**
as of 2026-09-08; **8 / 7 before the F-7 acceptances**. 10 + 5 = 15 ✓. **All 15 appear in this
matrix.** Rows needing a contract that does not exist say **`NOT YET AUTHORED`**.

**The acceptance convention is a field pair**: `status: accepted` **plus `acceptedBy:`** naming
the acceptor, the date, and what unblocked that contract specifically. **Every one of the ten
carries both; no `proposed` contract carries `acceptedBy:`.** That biconditional is what makes
the state checkable at all, and it is the assertion the owed check in F-7 would enforce.

### 1.5 Objects

**50 entries** in `core-object-registry.yaml` (`^  - name: `), plus 6 UI extension locations and
16 reserved API path segments. The matrix does not enumerate objects row by row; it names them
where a capability's placement turns on an object's `tenancy` classification.

### 1.6 What the matrix contains

**136 capability rows**: Platform Admin 17 (`PA-01…17`) · Organization Admin 48 (`OA-01…48`) ·
App/Connector/Capability Admin 20 (`AC-01…20`) · Operations 12 (`OP-01…12`) · Business Apps 39
(CRM 9, Finance 10, Projects 6, Inventory 7, HR 7). **17 + 48 + 20 + 12 + 39 = 136 ✓.**

**Reachable today: 21 rows** — **15** carrying the platform class (`PA-02…08`, `PA-11…15`,
`OP-01`, `OP-02`, `OP-04`), **4** carrying the pre-auth and session classes (`PA-01`, `OA-06`,
`OA-09`, `OP-03`), and **2** carrying Core Actions (`OA-13`, `OA-14`, both `business-read-v1`).
15 + 4 + 2 = 21 ✓. Everything else is `not built` or `built/unreachable`.

**A count going down is a defect, not progress.** If a future edit reduces any figure in §1,
something stopped being examined.

---

## 2. How to read a row

| Column | Values |
|---|---|
| **Surface** | `admin` = `admin.dudo.work` (platform operator) · `settings` = `app.dudo.work/settings` (Organization administration). **Exactly one.** A capability that appears to need both is a finding in §0 and appears **once** |
| **Permission** | The catalogued id, or **`NEW`** — must be created, and `0007` rule 4 means it **does not exist** until it is in `permission-catalog.yaml` |
| **Sens.** | `read` · `write` · `sens` (sensitive: permission + audit) · `crit` (critical: permission + audit + confirmation) — `0026`'s ladder |
| **Conf.** | Whether `0027`'s confirmation applies. **Derived from the permission's class, never declared per operation** |
| **Scope** | `platform` · `org` · `x-org` (cross-Organization **metadata only** — control-plane rows, never tenant data) · `+tw` (the operation also performs a **bounded write** into a customer's tenant database) |
| **Contract** | The contract that serves it, or **`NOT YET AUTHORED`** |
| **Status** | `reachable` (built, callable end to end) · `built/unreachable` · `not built` |

---

## 3. Milestone 1 — Platform Admin (`admin.dudo.work`)

| # | Capability | Surface | Permission | Sens. | Conf. | Scope | Contract | Status |
|---|---|---|---|---|---|---|---|---|
| PA-01 | Operator sign-in and sign-out | admin | none — `PreAuthEntryPoint` (`0014` §B) | — | no | platform | `login-v1` | reachable |
| PA-02 | Operator self-context (`whoami`) | admin | `core.organization.list` | sens | no | platform | `platform-operator-v1` | reachable |
| PA-03 | Organization directory (list) | admin | `core.organization.list` | sens | no | x-org | `platform-operator-v1` | reachable |
| PA-04 | Organization detail, incl. `member_count` | admin | `core.organization.list` | sens | no | x-org | `organization-detail-v1` | reachable |
| PA-05 | Onboard an Organization (tenant + first admin + first Workspace) | admin | `core.organization.create` | sens | **no**, by `0026` D1 | x-org **+tw** | `organization-onboarding-v1` | reachable |
| PA-06 | Set Organization display identity (name, CR, VAT) | admin | `core.platform-organization.update` | sens | no | x-org **+tw** | `organization-identity-v1` | reachable — **F-3** |
| PA-07 | Platform operator roster | admin | `core.platform-audit.read` | sens | no | platform | `platform-operators-v1` | reachable |
| PA-08 | Revoke platform authority | admin | `core.principal.revoke-platform-scope` | **crit** | **yes** | platform | `platform-operators-v1` | reachable |
| PA-09 | Grant platform authority | admin | `core.principal.grant-platform-scope` | **crit** | **yes** | platform | **NOT YET AUTHORED — and deliberately never** | not built **by decision**: `0025` publishes no route; *"a route that grants platform authority is the single most valuable target in the platform"* |
| PA-10 | Create a platform operator (bootstrap) | admin | **none, and none may be created** | — | — | platform | **NOT YET AUTHORED — and deliberately never** | not built **by decision**: `core-object-registry.yaml` `PlatformOperator` — *"NO ROUTE CREATES ONE"* |
| PA-11 | Reset a principal's credential | admin | `core.credential.reset` | **crit** | **yes** | x-org **+tw** | `credential-reset-v1` | reachable |
| PA-12 | Resolve one member identifier within a named Organization | admin | `core.credential.reset` — **borrowed without performing** | crit (permission) | **no** — listed in `BORROWS_WITHOUT_PERFORMING` | x-org **+tw** | `organization-detail-v1` | reachable |
| PA-13 | Create a Template | admin | `core.template.create` | sens | no | platform | `template-v1` | reachable |
| PA-14 | List Templates | admin | `core.template.list` | read | no | platform | `template-v1` | reachable |
| PA-15 | Read a Template | admin | `core.template.read` | read | no | platform | `template-v1` | reachable |
| PA-16 | Read a Template's adoption count | admin | **PROPOSED** `core.template-adoption.read` | sens | no | platform | `template-lifecycle-v1` | authored, not built |
| PA-16 | Edit a Template | admin | **PROPOSED** `core.template.update` | sens | no | platform | `template-lifecycle-v1` | authored, not built |
| PA-16 | Retire / restore a Template | admin | **PROPOSED** `core.template.retire` (both directions) | sens | no | platform | `template-lifecycle-v1` | authored, not built |
| PA-17 | Change an Organization's Template after onboarding | admin | **PROPOSED** `core.platform-organization.set-template` | sens | no | x-org | `template-lifecycle-v1` | authored, not built |

**Three corrections to the rows above, made 2026-09-09 when the contract was authored. Each is a
place this matrix said something that authoring falsified.**

1. **PA-16 was ONE row and is TWO operations under TWO permissions.** Edit and retire are different
   authorities over different things — one changes what a Template *says*, the other whether it may
   be *chosen* — and a single row invited a single `core.template.write` covering both.
2. **`core.template.archive` is renamed `core.template.retire`.** A permission named `archive`
   gating a route that sets a status called `retired` is two words for one act, held together by
   memory. Customer records archive; Templates retire; the object's own vocabulary wins.
3. **PA-16 gained a fifth operation on a Team Lead ruling: the usage read.** The first draft returned
   `organizations_using` only in the response to a write, so an operator decided whether to retire
   **blind** and learned the reach by having acted. **Reversibility makes the mistake recoverable; it
   does not make the decision informed.** It costs no new permission.
4. **`authored, not built` is a third status this table did not have**, and collapsing it into
   `not built` is what made `NOT YET AUTHORED` do double duty. A contract existing and a route
   existing are different facts and the deployed system reflects neither yet.

**And the retire row carries a dependency the matrix cannot show: retirement is REVERSIBLE, and it
had to be.** Template names are unique, so a one-way retirement spends the name permanently — retire
"School" by mistake and you can neither recreate it nor undo it. `template-lifecycle-v1` →
`theRetirementRuling`.

**A member list is not a row and must never become one.** `0028` Decision 1: the transpose of the
permitted read is the forbidden one. `platform-routes.ts` asserts the absence by enumerating the
route table rather than by trying a URL, *"because a route added later would pass a URL test that
never ran."*

---

## 4. Milestone 2 — Organization Admin (`app.dudo.work/settings`)

**Every row is `org` scope.** Rows marked **F-1** are unreachable once built until the confirmation
challenge exists on this surface; rows marked **F-2** cannot be routed at all today.

### 4.1 People and access

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-01 | View a user profile | `core.user.read` | read | no | NOT YET AUTHORED | not built |
| OA-02 | Enumerate users | `core.user.list` | read | no | NOT YET AUTHORED | not built |
| OA-03 | Invite a person into the Organization | `core.user.invite` | sens | no | NOT YET AUTHORED | not built |
| OA-04 | Edit a user profile | `core.user.update` | write | no | NOT YET AUTHORED — and no profile column exists (`OrganizationMembership` notes) | not built |
| OA-05 | Deactivate a user | `core.user.deactivate` | sens | no | NOT YET AUTHORED | not built |
| OA-06 | Sign out of my own session | none — `PreAuthEntryPoint` | — | no | `login-v1` / `0018` | reachable |
| OA-07 | View active sessions for a principal | `core.session.list` | sens | no | NOT YET AUTHORED | not built |
| OA-08 | Revoke another principal's session | `core.session.revoke` | sens | no | NOT YET AUTHORED | not built |
| OA-09 | Choose the active Organization | none — session class (`0021`) | — | no | `organization-selection-v1` | reachable |

### 4.2 Organization structure

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-10 | View the Organization record | `core.organization.read` | read | no | NOT YET AUTHORED | not built — **F-2** |
| OA-11 | Edit Organization settings | `core.organization.update` | sens | no | NOT YET AUTHORED | not built — **F-2**, **F-3** |
| OA-12 | Delete the Organization | `core.organization.delete` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** and **F-2** |
| OA-13 | List authorized Workspaces | `core.business.read` | read | no | `business-read-v1` | reachable |
| OA-14 | Resolve Workspace names | `core.business.read` | read | no | `business-read-v1` | reachable |
| OA-15 | Create a Workspace | `core.business.create` | write | no | NOT YET AUTHORED — onboarding creates only the first | not built |
| OA-16 | Edit a Workspace | `core.business.update` | write | no | NOT YET AUTHORED | not built |
| OA-17 | View Branches | `core.branch.read` | read | no | NOT YET AUTHORED | not built |
| OA-18 | Create a Branch | `core.branch.create` | write | no | NOT YET AUTHORED | not built |
| OA-19 | Edit a Branch | `core.branch.update` | write | no | NOT YET AUTHORED | not built |
| OA-20 | View Teams | `core.team.read` | read | no | NOT YET AUTHORED | not built |
| OA-21 | Create a Team | `core.team.create` | write | no | NOT YET AUTHORED | not built |
| OA-22 | Edit a Team | `core.team.update` | write | no | NOT YET AUTHORED | not built |
| OA-23 | Manage Team membership | `core.team.manage-membership` | sens | no | NOT YET AUTHORED | not built |

**`Business` → `Workspace`.** `core-object-registry.yaml`'s `namingRuling2026-09-05` renames the
inner unit; the registry entry keeps the old name until the Team Lead records the decision. This
matrix uses **Workspace** in prose and the **catalogued permission ids unchanged**, because a
matrix that renamed a permission would be a matrix asserting a decision nobody made.

### 4.3 Authorization

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-24 | View roles and their permissions | `core.role.read` | read | no | NOT YET AUTHORED | not built |
| OA-25 | Create a custom role | `core.role.create` | sens | no | NOT YET AUTHORED | not built — **F-6** |
| OA-26 | Edit a role's permission set | `core.role.update` | sens | no | NOT YET AUTHORED | not built — **F-6** |
| OA-27 | Assign a role at a scope | `core.role.assign` | sens | no | NOT YET AUTHORED | not built — **F-2**, **F-6** |
| OA-28 | Revoke a role | `core.role.revoke` | sens | no | NOT YET AUTHORED | not built — **F-2**, **F-6** |
| OA-29 | Grant a permission at `own` scope | **NEW** — no grant path exists (`AZ5`) | — | — | NOT YET AUTHORED | not built — blocked by `AZ5` |
| OA-30 | Delegate authority over one record to one principal | **NEW** — not a role and not `own` scope (`AZ10`, `CO6`) | sens | — | NOT YET AUTHORED | not built — needs a decision record; **do not approximate with a role** |

### 4.4 Credentials and machine identities

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-31 | List API credentials and last use | `core.api-credential.list` | sens | no | NOT YET AUTHORED | not built |
| OA-32 | Issue an API credential with an explicit permission set | `core.api-credential.issue` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |
| OA-33 | Revoke an API credential | `core.api-credential.revoke` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |
| OA-34 | Create and configure service accounts | `core.service-account.manage` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |

### 4.5 Plan, usage and settings

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-35 | View plan, quotas and usage | `core.subscription.read` | read | no | NOT YET AUTHORED | not built |
| OA-36 | Change the platform plan | `core.subscription.change` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1**; and a **spend decision**, so `0008` applies: no agent approves paid usage |
| OA-37 | View metered usage incl. AI cost attribution | `core.usage.read` | read | no | NOT YET AUTHORED | not built |
| OA-38 | Read tenant settings | `core.setting.read` | read | no | NOT YET AUTHORED | not built |
| OA-39 | Change tenant settings | `core.setting.update` | sens | no | NOT YET AUTHORED | not built |
| OA-40 | Read feature-flag state | `core.feature-flag.read` | read | no | NOT YET AUTHORED | not built |
| OA-41 | Change feature-flag state | `core.feature-flag.update` | sens | no | NOT YET AUTHORED | not built |

### 4.6 Audit, export and AI governance

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OA-42 | Read the Organization's own audit trail, **including what the platform did to it** | `core.audit.read` | sens | no | **`audit-read-v1`** (`proposed`) | not built — **this is what makes `0028`'s struck term true again** |
| OA-43 | Export audit records | `core.audit.export` | sens | no | NOT YET AUTHORED | not built |
| OA-44 | Export the Organization's own data | `core.tenant.export` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |
| OA-45 | Configure AI providers and whether tenant data may leave the platform | `core.ai.configure` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |
| OA-46 | Configure an external MCP server | `core.mcp.configure-external` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1**; everything it returns is untrusted |
| OA-47 | Register as a Dudo developer | `core.developer.register` | write | no | NOT YET AUTHORED | not built |
| OA-48 | Submit an extension for review | `core.marketplace.submit` | sens | no | NOT YET AUTHORED | not built |

*(OA-01…OA-48 with OA-06 and OA-09 already reachable: 44 rows require new work.)*

---

## 5. Milestone 3 — App, Connector and Capability administration

### 5.1 Organization side (`settings`) — installing and governing extensions

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| AC-01 | View installed Apps and their declared permissions | `core.app.read` | read | no | NOT YET AUTHORED | not built |
| AC-02 | Install an App | `core.app.install` | sens | no | NOT YET AUTHORED | not built — **no manifest-admission path exists at all** (catalog, `App manifest may never request 'platform' scope`) |
| AC-03 | Configure an installed App | `core.app.configure` | sens | no | NOT YET AUTHORED | not built |
| AC-04 | Grant an App a declared permission | `core.app.grant-permission` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1** |
| AC-05 | Revoke a grant from an App | `core.app.revoke-permission` | sens | no | NOT YET AUTHORED | not built |
| AC-06 | Upgrade an App, running its migrations | `core.app.upgrade` | sens | no | NOT YET AUTHORED | not built |
| AC-07 | **Activate** an App | **NEW** `core.app.activate` | sens | no | NOT YET AUTHORED | not built — **F-5** |
| AC-08 | **Roll back** an App version | **NEW** `core.app.rollback` | sens | no | NOT YET AUTHORED | not built — **F-5** |
| AC-09 | Disable an App (data retained) | `core.app.disable` | sens | no | NOT YET AUTHORED | not built |
| AC-10 | Uninstall an App, applying its declared data disposition | `core.app.uninstall` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1**. §9: the tenant is told what happens to their data **before** it proceeds |
| AC-11 | View capabilities and the tenant's provider selection | `core.capability.read` | read | no | NOT YET AUTHORED | not built |
| AC-12 | Select and configure a capability provider, incl. credential references | `core.capability.configure-provider` | **crit** | **yes** | NOT YET AUTHORED | not built — **F-1**. **Apps request capabilities, never vendors** — `Payment`, never a named processor |
| AC-13 | View an App's event subscriptions | **NEW** `core.event-subscription.read` | read | no | NOT YET AUTHORED | not built |
| AC-14 | View workflow runs for the Organization | **NEW** `core.workflow-run.read` | read | no | NOT YET AUTHORED | not built |
| AC-15 | Review which Actions are exposed to AI as MCP tools | **NEW** `core.mcp-tool.read` | read | no | NOT YET AUTHORED | not built — discovery is filtered per principal, *"because a tool list is a description of the system"* |

### 5.2 Platform side (`admin`) — the registries the Organization side consumes

| # | Capability | Permission | Sens. | Conf. | Scope | Contract | Status |
|---|---|---|---|---|---|---|---|
| AC-16 | View published App versions and their validated manifests | **NEW** platform-scope — **`AZ8`**, and **do not widen `core.app.read`** | sens | no | platform | NOT YET AUTHORED | not built — **F-4** |
| AC-17 | Approve or reject a marketplace submission | `core.marketplace.moderate` | **crit** | **yes** | platform | NOT YET AUTHORED | **built/unreachable** — in `HELD_BUT_UNREACHABLE` by design; **F-4** |
| AC-18 | Register a capability definition and version | **NEW** `core.capability-definition.*` | sens | no | platform | NOT YET AUTHORED | not built |
| AC-19 | Register a Connector as a provider of one capability version | **NEW** `core.capability-provider.*` | sens | no | platform | NOT YET AUTHORED | not built |
| AC-20 | Manage marketplace listings and the developer registry | **NEW** `core.marketplace-listing.*`, `core.developer.*` (platform) | sens | no | platform | NOT YET AUTHORED | not built |

**Third-party App and Connector execution stays blocked** regardless of these rows: Workers for
Platforms is paid-only and therefore prohibited (`architecture.md` §6a). These capabilities are
specifiable and buildable for **first-party** extensions; third-party execution needs a free
mechanism or a user-approved budget.

---

## 6. Milestone 4 — Operations (`admin`, `platform` scope)

| # | Capability | Permission | Sens. | Conf. | Contract | Status |
|---|---|---|---|---|---|---|
| OP-01 | Platform audit feed, all Organizations, `target_principal_id` **omitted** | `core.platform-audit.read` | sens | no | `platform-audit-read-v1` | reachable |
| OP-02 | Organization-scoped audit feed, `target_principal_id` included | `core.platform-audit.read` | sens | no | `platform-audit-read-v1` | reachable — writes 5 rows into that Organization's own trail on every call (**+tw**) |
| OP-03 | Platform health | none — `PreAuthEntryPoint` `platform.health` | — | no | — | reachable |
| OP-04 | Issue a confirmation challenge for a critical platform operation | the **confirmed operation's own** permission | — | n/a | `confirmation-v1` | reachable |
| OP-05 | Observe free-tier consumption and write budgets | **NEW** `core.platform-usage.read` | sens | no | NOT YET AUTHORED | not built — required by `0008`'s re-verification obligation and by `0028`'s DoS amendment |
| OP-06 | Set a per-Organization sub-ceiling on platform-originated tenant writes | **NEW** `core.platform-ceiling.update` | sens | no | NOT YET AUTHORED | not built — **`0028` defers it, on a premise admin-first changes** |
| OP-07 | Rate-limit an operator (`PO-4`) | none — a mechanism, not a screen | — | — | NOT YET AUTHORED | not built — `0028`'s residual term *"rate limited"* is **false** until it exists |
| OP-08 | Suspend or reactivate an Organization | **NEW** `core.platform-organization.suspend` | sens | **decide** | NOT YET AUTHORED | not built — the catalog states `core.platform-organization.update` **"DOES NOT COVER STATUS"**, and *"a suspend route, when it exists, is a separate permission and a separate argument"* |
| OP-09 | Delete an Organization from the platform side | **NEW** — distinct from `core.organization.delete`, which is a tenant permission | **crit** | **yes** | NOT YET AUTHORED | not built |
| OP-10 | Administer the tenant-directory / storage-binding mapping | **NO PERMISSION, AND NONE MAY BE CREATED** | — | — | — | **must not be built as a screen.** `TenantDirectoryEntry` is `appAccess: none`, read only by Core's server-controlled `TenantStoreResolver`; *"Apps, plugins, Connectors, and clients cannot select a database or binding"* |
| OP-11 | Break-glass read of tenant business data | **`AZ3` — no permission exists and none may be created without a decision record** | **crit** | **yes** | NOT YET AUTHORED | not built — **blocked by decision.** `0024`'s invariants are what any proposal must argue against |
| OP-12 | Deploys, migrations, credential rotation, spend | **outside the product** — a user approval, every time, never a screen | — | — | — | n/a — `security.md` §7 |

---

## 7. Milestones 5–6 — Business App administration (`settings`, `org` scope)

**Every row below: surface `settings`, scope `org`, contract `NOT YET AUTHORED`, status
`not built`, unless the row says otherwise.** The permission column is where the real content is:
**one existing permission across all five Apps** plus **two** in the CRM row set. Everything else
must be created, and `0007` rule 4 means it does not exist until it is in the catalog.

**Naming.** Each App's permissions live in that App's own namespace
(`^(core|[a-z][a-z0-9-]{1,62}[a-z0-9])\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`), never under `core.` —
`CORE_BOUNDARIES.md` rule 6.1 forbids industry nouns in Core types, tables, columns, functions and
routes. The namespaces proposed here are `crm`, `finance`, `projects`, `inventory`, `hr`; the
existing Customer Directory App owns `customers`.

### 7.1 CRM

| # | Capability | Permission | Sens. | Conf. | Note |
|---|---|---|---|---|---|
| CRM-01 | Permanently delete a customer (30-day recovery window) | `customers.customer.delete` ✓ | **crit** | **yes** | `customer-directory-v1` (`proposed`); route registered `kind: 'deferred'` — **F-1** |
| CRM-02 | Cancel a pending deletion | `customers.customer.restore-deleted` ✓ | sens | no | `customer-directory-v1`; route `deferred` |
| CRM-03 | Export the customer directory | **NEW** `customers.customer.export` | sens | no | **Deliberately absent today and must stay absent until an export Action exists** — the catalog says so by name |
| CRM-04 | Pipeline stages and their transitions | **NEW** `crm.pipeline.*` | sens | no | Transitions are business rules and live in the App, never in Core |
| CRM-05 | Lead sources and qualification rules | **NEW** `crm.lead-source.*` | write | no | |
| CRM-06 | Custom fields on customer records | **NEW** `crm.custom-field.*` | sens | no | |
| CRM-07 | Assignment and ownership rules | **NEW** `crm.assignment-rule.*` | sens | no | Ownership is declared, never asserted at invocation (`VAL-OWN`) |
| CRM-08 | Duplicate-detection policy | **NEW** `crm.duplicate-policy.*` | write | no | |
| CRM-09 | Retention and archival policy | **NEW** `crm.retention.*` | **crit** | **yes** | A policy that destroys records is destruction on a timer |

### 7.2 Finance

| # | Capability | Permission | Sens. | Conf. | Note |
|---|---|---|---|---|---|
| FIN-01 | Chart of accounts | **NEW** `finance.account.*` | sens | no | |
| FIN-02 | Tax rates and rules | **NEW** `finance.tax-rate.*` | sens | no | A wrong rate is a filed return |
| FIN-03 | Currencies and FX policy | **NEW** `finance.currency.*` | sens | no | |
| FIN-04 | Document numbering series | **NEW** `finance.numbering.*` | sens | no | Legally sequential in several jurisdictions |
| FIN-05 | Close a fiscal period | **NEW** `finance.period.close` | sens | no | |
| FIN-06 | Reopen a closed period | **NEW** `finance.period.reopen` | **crit** | **yes** | Separate from close, in the direction that matters |
| FIN-07 | Payment approval thresholds | **NEW** `finance.approval-policy.*` | **crit** | **yes** | The control that governs money movement is itself a money-movement control |
| FIN-08 | Bank account registry | **NEW** `finance.bank-account.*` | **crit** | **yes** | Never holds a payment instrument's secret — that is a credential **reference** |
| FIN-09 | Select the Payment capability provider | `core.capability.configure-provider` ✓ | **crit** | **yes** | **`Payment`, never a vendor.** Same row as AC-12, exercised by Finance |
| FIN-10 | Payroll figure visibility | **NEW** `finance.payroll-visibility.*` | sens | no | Overlaps HR-04 — **one capability, one owner; decide which App owns it before either builds it** |

### 7.3 Projects

| # | Capability | Permission | Sens. | Conf. | Note |
|---|---|---|---|---|---|
| PRJ-01 | Project templates | **NEW** `projects.template.*` | write | no | Distinct from Core's `Template` object, which is a **business type**. Two concepts, and the name collision is a finding for whoever authors this contract |
| PRJ-02 | Task statuses and workflow states | **NEW** `projects.status.*` | write | no | |
| PRJ-03 | Time-tracking policy | **NEW** `projects.time-policy.*` | sens | no | |
| PRJ-04 | Billing rates and rate cards | **NEW** `projects.rate-card.*` | sens | no | Feeds invoicing — a Finance boundary |
| PRJ-05 | Project custom fields | **NEW** `projects.custom-field.*` | write | no | |
| PRJ-06 | Project archival and retention | **NEW** `projects.retention.*` | sens | no | |

### 7.4 Inventory

| # | Capability | Permission | Sens. | Conf. | Note |
|---|---|---|---|---|---|
| INV-01 | Stock locations | **NEW** `inventory.location.*` | write | no | **Overlaps `core.branch.*`.** A warehouse may or may not be a Branch; decide before either is built, or the tenant maintains the same list twice |
| INV-02 | Units of measure and conversions | **NEW** `inventory.uom.*` | write | no | |
| INV-03 | Valuation method (FIFO / weighted average) | **NEW** `inventory.valuation.*` | **crit** | **yes** | Changing it restates historical figures |
| INV-04 | Reorder policy and thresholds | **NEW** `inventory.reorder-policy.*` | write | no | |
| INV-05 | Stock-adjustment approval policy | **NEW** `inventory.adjustment-policy.*` | sens | no | |
| INV-06 | Product categories and attributes | **NEW** `inventory.category.*` | write | no | |
| INV-07 | SKU and barcode scheme | **NEW** `inventory.sku-scheme.*` | sens | no | A referenced permanent key, like a Template id |

### 7.5 HR

| # | Capability | Permission | Sens. | Conf. | Note |
|---|---|---|---|---|---|
| HR-01 | Employment types and contract templates | **NEW** `hr.employment-type.*` | sens | no | |
| HR-02 | Leave types and accrual policy | **NEW** `hr.leave-policy.*` | sens | no | |
| HR-03 | Payroll periods | **NEW** `hr.payroll-period.*` | sens | no | |
| HR-04 | Compensation-band visibility | **NEW** `hr.compensation-visibility.*` | sens | no | `0026` §6 names *"view payroll"* as sensitive. **Overlaps FIN-10** |
| HR-05 | Working calendars and holidays | **NEW** `hr.calendar.*` | write | no | |
| HR-06 | Employee document retention | **NEW** `hr.document-retention.*` | **crit** | **yes** | Irreversible destruction of personnel records |
| HR-07 | Reporting lines and org chart | **NEW** `hr.reporting-line.*` | sens | no | **If authority is ever made to follow a reporting line, that is `AZ10` / `CO6` — a delegation edge, not a role and not `own` scope.** Approximating it with a role grants a manager access to everyone |

---

## 8. The fourteen permissions this matrix deliberately does not cover

**Enumerated individually, because a category absorbs the one entry that does not belong to it.**
These gate **day-to-day operations**, not administration. They belong in the product surfaces, not
in an administrative console.

`core.file.read` · `core.file.create` · `core.file.delete` · `core.notification.read` ·
`core.notification.send` · `core.ai.invoke` · `core.mcp.connect` · `customers.customer.create` ·
`customers.customer.read` · `customers.customer.list` · `customers.customer.update` ·
`customers.customer.archive` · `customers.customer.restore` · `customers.customer.move`

**66 + 14 = 80 ✓.**

Three of these are worth a sentence, because a reader may expect them here:

- **`core.file.delete`** is `sensitive` and still ordinary document handling. A *file retention
  policy* would be administration and has no permission (not proposed here; no File-admin milestone
  was assigned).
- **`customers.customer.move`** is `[organization]`-only for a structural reason worth preserving:
  *"a move spans two Workspaces and a business-scope grant is authority over one."*
- **`core.mcp.connect`** establishes a session bound to one tenant. Configuring **external** MCP
  servers is `OA-46` and is administration; connecting is not.

---

## 9. What this document does not do

- It does not **grant** a permission. Only the user grants, and only the Team Lead relays
  (`security.md` §8).
- It does not **accept** a contract. `architecture-agent` does not accept its own contracts
  (`0004`).
- It does not **create** a permission. A `NEW` cell is a request for a catalog entry, and a
  permission that is not in `permission-catalog.yaml` does not exist (`0007` rule 4).
- It does not **select a technology**, propose an npm package, or approve a Cloudflare product.
- It does not decide any of the nine findings in §0.
