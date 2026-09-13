# 0043 — Tenant administration and the role model

- **Status:** **ACCEPTED 2026-09-13 by the Dudo Team Lead**, with §6 corrected against the file
  before recording. Read in full from `architecture-agent`'s 313-line draft rather than from a
  report about it — same discipline as `0042` and `0044`, and for the same reason: a status field
  records that a specific reader checked specific text (`security.md` §8a).
- **Proposed by:** `architecture-agent`. **Ruled by:** Team Lead (§2 closure, §6 correction, §8).
- **Governs:** the tenant role set, what `admin` may never hold, and the obligations binding every
  Milestone 2 contract.
- **Arises from:** Milestone 2 — Full Organization Administration.
- **Companion:** `0044` decides *where* tenant-admin routes live. **This record decides who may call
  them.** The two are orthogonal by construction and were accepted the same day.
- **The draft at `docs/architecture/proposals/0043-draft-*.md` is superseded by this file and is
  deleted rather than left as a second copy.**

---

## 1. Three measured facts, and the third changes the brief

**Verified by the Team Lead against the files, not transcribed from the draft.**

| | |
|---|---|
| `platform/core/authorization/roles.ts:65` | `export type MembershipRole = 'owner' \| 'member'` — a closed union |
| `0007_membership_role.sql:103` | `ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('owner', 'member'))` — the matching database constraint |
| catalogue tenant roles | `business-owner` (**scope: organization**), `business-admin` (**scope: business**), `member` (**scope: business**), `developer` (organization) — **all four `status: proposed`** |
| `roles.ts:129-133` | *"**Two role vocabularies exist** … and **they are not the same `member`**"* — recorded, with `0023` requiring reconciliation **before a second App exists** |

### 1a. The gap is not "two roles against six". It is that NEITHER vocabulary has an Organization administrator.

**`business-admin` is `scope: business`, and the catalogue says so in its own description:
*"Administers one Business without owning the Organization."*** It administers *one Business*, not
the Organization. So in the catalogue as well as in Core, the ladder is:

```
business-owner   organization scope   holds core.organization.delete
business-admin   business scope       administers one Business
member           business scope       ordinary user
```

> **There is nothing between *"can delete the Organization"* and *"administers one Business."***

**Milestone 2 requires organization-level administration** — settings, members, invitations, roles,
retention, sessions — **and requires ownership transfer with strong confirmation, which only makes
sense if ownership is singular and precious.** Both requirements point at the same missing tier:
**an administrator of the whole Organization who cannot destroy or transfer it.**

**That tier does not exist in either vocabulary, and no amount of reconciling them produces it.**

### 1b. `scope:` on a role and `scopes:` on a permission are different axes, and nothing has ever consumed the first

A permission's `scopes:` is **the width a grant may be held at**, and `holdsAtOrAbove` reads it. A
role entry's `scope:` has **no consumer anywhere** — `roles.ts` grants every tenant permission at
`organization` scope regardless, and narrows by the authorized business set computed per request
(`0020`).

**So `member` being `scope: business` in the catalogue and organization-scoped in Core is not a
disagreement two people can settle by picking one.** It is one field that means something and one
that means nothing, with the same name. **Recorded because the reconciliation will otherwise "fix"
Core to match a field no code reads.**

---

## 2. The role model: SEED ROLES *AND* D16 CUSTOM ROLES — they were never alternatives

**The draft's original §2 proposed a closed, platform-defined set and argued that custom roles
defeat every static check this repository has. `security-agent` raised `0007` D16 against it, the
Team Lead verified D16 against the file, and `architecture-agent` confirmed and withdrew its own
ruling before this was recorded.** The withdrawal is kept in the record because **two of its three
claims were wrong and the third was right and new**, and separating them is the content.

**`0007` is `Status: Accepted`, dated 2026-09-01, and D16 reads:**

> *"Customers create custom roles. **That is required by the planning source ("roles must not be
> hardcoded")**, and it is where a permission model usually acquires its holes. **Four constraints
> keep it safe, and all four hold from the first custom role.**"*

**A closed, platform-defined set of four IS hardcoded roles.** The original proposal did not argue
against D16; it argued in the abstract, **because `0007` was not opened before ruling on the
permission model** — `architecture.md` §3c, a claim about a record made without reading it.

```
PLATFORM SEED ROLES     owner · admin · business-admin · member
                        what every Organization starts with. §3 stands unchanged.
TENANT CUSTOM ROLES     D16, under its four constraints. What "roles must not be hardcoded"
                        requires, and what "role and permission assignment" means to a tenant.
```

**D16 defers role templates across tenants, composition and inheritance. It does not defer the
feature.** The seed set is the floor a tenant starts from, not the ceiling it is confined to.

### 2a. Which of the three claims failed, individually

| Claim | Verdict |
|---|---|
| the scopes-intersection invariant stops being answerable | **WRONG.** D16 constraint 2: *"D6's intersection applies unchanged."* It is enforced when the role is CREATED — the in-statement guard, not a load-time table |
| the platform-scope envelope assertion stops being answerable | **WRONG, and D16 is stronger than the check being defended.** Constraint 3 makes it FOLLOW from 1 and 2 — a tenant principal holds no platform permission, so cannot put one in a role — *"rather than being a special case, which is why it cannot be forgotten"* |
| `security.md` §2a's enumeration test stops being answerable | **RIGHT, AND D16 COULD NOT HAVE ADDRESSED IT: §2a IS TWELVE DAYS YOUNGER THAN `0007`.** |

**Constraint 1 is what defeats the first two: a custom role's grants are always a SUBSET of the
creator's, and a subset of an enumerable set is enumerable.** *Creating a role is a grant* — so
every static property that holds of the seed roles holds of everything derivable from them.

### 2b. What genuinely does not survive, and it is one thing rather than three

**§2a asks whether the consumer of an aggregate already holds enumeration over the counted
population. Under a closed set that is a property of four role tables anyone can read. Under D16 it
is a property of nothing, because CONSTRAINT 1 PERMITS ANY SUBSET.**

> **A tenant admin holding both permissions may mint a role holding only ONE of them. Custom roles
> DECOMPOSE CO-HOLDING, continuously and under tenant control** — and every §2a answer of the form
> *"safe, because every role holding A also holds B"* is an observation about today's roles that a
> tenant can falsify without touching any code.

**This is `security.md` §2a-i exactly** — the test is on a PAIR, and adding a role moves the
consumer side without touching a route — **with the movement handed to the customer.**

**THE REPAIR IS NOT REFUSING CUSTOM ROLES. IT IS THAT §2a MUST BECOME AN AUTHORIZATION-TIME
CONJUNCTION RATHER THAN A ROLE-COMPOSITION OBSERVATION.** Where an aggregate's consumer permission
`A` requires enumeration permission `B`, **the route requires `A` AND `B`, decided in Core on every
call** (`security.md` §2) — never *"every role that holds A happens to hold B."*

**And that retroactively explains why the Milestone 1 answer was right:** `core.template-adoption.read`
is safe under custom roles **because it does not depend on co-holding at all.** The withdrawn
`coHoldingRequired` lint would have been actively wrong here — a role-composition constraint whose
red state a tenant clears by granting themselves more.

### 2c. ⭑ THE DRAFT'S ONE OPEN DEPENDENCY IS CLOSED — `0044` §3d, accepted the same day

**The draft left this open and correctly called it a real dependency:**

> *"a route may not be able to demand a conjunction. `PlatformRoutePermission` is
> `{kind:'fixed'} | {kind:'from-body'}` — **one permission per route.** Whether the Action pipeline
> can express `A ∧ B` is unverified, and **§2a's enforcement under D16 depends on it.**"*

**RULED IN `0044` §3d: a tenant-admin route may declare a CONJUNCTION of permissions, and a
disjunction is refused at the type level so it cannot be expressed.** One-permission-per-route is a
property of a registry that already shipped; it does not have to be a property of one being written
now. `A ∧ B` is strictly more restrictive than either conjunct, enumerable and statically checkable;
`A ∨ B` is a widening wearing the same syntax.

> **So §2b's repair is not merely prescribed, it is MECHANISED.** Recorded in both directions —
> `0044` §3d cites this record's §2b as its motivation, and this clause cites `0044` §3d as its
> closure — **because a dependency recorded in one direction only is the citation nobody sweeps.**

### 2d. What this does not decide about custom roles

**The custom-role table, the creation route and the enforcement of D16's four constraints at
creation time are Core's, sequenced after this record.** `core.role.create`, `core.role.update`,
`core.role.assign`, `core.role.revoke` and `core.role.read` are all catalogued (§6). **Nothing may
report custom roles as available until that route exists**, and each of the four constraints is a
test requirement rather than a comment.

---

## 3. The seed role set — FOUR tenant roles, and the two stored values do not change

```
owner            organization   exactly ONE per Organization.  Everything, including delete and transfer.
admin            organization   everything owner has EXCEPT delete, transfer, and acting on the owner.
business-admin   business       administers the Businesses it is assigned to.
member           business       ordinary user.
```

### 3a. `owner` and `member` keep their stored spellings, and the unbuilt vocabulary moves

**`organization_membership.role` holds `'owner'` and `'member'` today behind a `CHECK`.** Renaming
either is a migration plus a data change on live rows.

**The catalogue's `business-owner` is `status: proposed` and unbuilt. It is renamed to `owner`.**

> **ALIGN THE UNBUILT VOCABULARY TO THE BUILT ONE, NEVER THE REVERSE.** This is `0025`'s
> `business_id` precedent applied to a role: the rename that costs a migration and an audit-history
> rewrite is the one you do not do; the one that costs a text edit in a proposed registry is the one
> you do.

**`admin` and `business-admin` are ADDED to `MembershipRole`, to the `CHECK`, and to the catalogue.**
Additive: no existing row changes value, and `toMembershipRole` already returns `null` for an
unrecognised stored string, which denies everything — **so a database ahead of a deployment fails
closed rather than open.**

### 3b. Why `admin` rather than widening `business-admin` to organization scope

**Widening it would make one name mean two spans** — the catalogue's `business-admin` administers a
Business, and a widened one would administer everything. `architecture.md` §1a: a name that does not
say *whose* is a name two readers use correctly and mean different things by. **Two names.**

### 3c. Exactly one `owner`, and it is the reason transfer exists

**Ownership is singular per Organization.** That is what makes *transfer* a meaningful act rather
than a grant, and it is what `admin` exists to relieve — **without singular ownership, "transfer" is
just "add a second owner" and the strong confirmation is theatre.**

**The invariant is structural, not procedural:** exactly one `organization_membership` row per
Organization carries `role = 'owner'`, enforced by a **partial unique index, in the same statement
that writes it** (`architecture.md` §3a — the in-statement guard is the only layer with no window).
**A transfer is one atomic demote-and-promote, never a promote followed by a demote** — the
intermediate state of the second ordering is two owners, which the index must refuse anyway, so the
ordering is forced rather than chosen.

### 3d. What `admin` must NOT hold, enumerated rather than described

`core.organization.delete` · `core.organization.transfer-ownership` · **any action whose target is
the `owner`** — suspend, remove, demote, revoke sessions.

**The third is the one a permission cannot express**, since it is a property of the *target* rather
than of the *actor*. It is stated here as a **Core obligation and a test requirement**, never as a
grant.

> **Without it, `admin` is `owner` with extra steps: demote the owner, then do anything.**

---

## 4. `security.md` §2a re-run over this milestone, as §2a-i requires

**Adding a role moves the consumer side of every aggregate without touching a route.** Every count
this milestone introduces:

| Aggregate | Consumer | Enumerates the population? | Ruling |
|---|---|---|---|
| member count | `core.user.list` holder | **yes** | no new permission |
| session count for a member | `core.session.list` holder | **yes** | no new permission |
| Business count | `core.business.read` holder | **yes** | no new permission |
| pending-invitation count | `core.user.invite` holder | **no** — invite grants creation, not enumeration | **requires `core.invitation.list` as a conjunct, or the count is withheld** |
| usage / quota figures | `core.usage.read` holder | **n/a — see below** | **not an enumeration question** |

**The invitation row is the finding.** `core.user.invite` is a *create* permission; nothing about it
grants enumeration of pending invitations, and a count of them is a count of people who have been
asked to join and have not. **`core.invitation.list` is catalogued (§6) and is the conjunct** —
which is `0044` §3d's mechanism doing exactly the work §2b assigned it, on the first aggregate that
needed it.

**And `usage` is the case §2a does not answer**, which is worth stating rather than forcing: a quota
figure is not a count over a population the caller might enumerate — it is a measurement of the
tenant's own consumption. **§2a is the wrong instrument and it must not be reported as passing.**
The right test is the tenant boundary: usage figures are the tenant's own, they name no other
tenant, and they must not be derivable into platform-wide totals. **That is a different argument and
it belongs in the usage contract.**

---

## 5. Contract-level obligations binding on every Milestone 2 contract

1. **CROSS-TENANT IDENTIFIERS ARE INDISTINGUISHABLE FROM NONEXISTENT ONES.** Every route taking an
   identifier declares `unknownIdentifierResponse: not_found` **as a field**, not as prose.
   > **Prose describes; a declared field can be checked.** `forbidden` remains correct for *"you
   > lack the permission"* and is never correct for *"that id is not yours"* — and the two are
   > indistinguishable in an errors list, which is why the field is separate from `errors:`.

   **`customer-directory-v1`'s step-5c ruling is the ONE exception and it must be cited, not
   copied**: it returns `forbidden` for an in-tenant unauthorized Business on a data-corruption
   argument that does not reach anything in this milestone.
2. **Tenant scope from the authenticated context.** No request shape in this milestone contains an
   `organization_id`, and none may gain one — **refused at registration** (`0044` §3b.2).
3. **`0024`'s mutual exclusion survives.** No route here is reachable by a platform operator, and no
   platform route gains tenant business-data access. A platform operator holds zero
   `organization_membership` rows, so no store handle resolves for them (`0044` §3a).
4. **Every destructive or sensitive action declares `confirmation`, `audit: required`, and its
   `sensitivity`** — and the sensitivity is read off the permission catalogue, not chosen per route.

   > **⚠ AMENDED 2026-09-13, THE SAME DAY, AND THIS CLAUSE WAS THE THING THAT WAS WRONG.**
   > `qa-agent` derived per-operation rather than by pattern — **21 operations, 21 sensitivities,
   > 21 audits, marginals agreeing exactly** — and pairing them found two operations declaring
   > `sensitivity: sensitive` with `audit: false`:
   >
   > ```
   > tenant.invitations.get             sensitive   audit=false
   > tenant.invitations.pending-count   sensitive   audit=false
   > tenant.invitations.list            sensitive   audit=required   <- the contrast
   > ```
   >
   > **Written unconditionally, this clause makes those two a defect. `0044` §3c licenses them:**
   > *"sensitive reads are audited individually, per route."* **Two accepted records in tension,
   > and the contracts resolved it in one direction without saying they were resolving it.**
   >
   > **RULED: the clause is unconditional for WRITES and per-route for READS.** A destructive or
   > state-changing action always declares all three. A *sensitive read* follows `0044` §3c and
   > declares its audit decision with the argument at the site. **`0043` was the over-broad
   > record and `0044` was the precise one; this clause is corrected rather than the contracts.**

   ### 5.4a. `tenant.invitations.pending-count` — RULED, because it is the one §4 singled out

   **`qa-agent` raised this rather than asserting it, correctly, and it is a real question.**
   `security.md` §2a says of exactly this shape: *"the permission is the control **and the audit
   trail is the detection**"*, naming the vector as longitudinal — *"one call a day for a year is
   rate-limited by nothing and yields a growth curve."* **With `audit: false`, the detection half
   is absent for the one aggregate §4 flagged as needing extra care.**

   **RULED: `audit: false` is correct here, and the reason is that §2a's detection argument is
   scoped to an actor OUTSIDE the counted population's tenant.**

   > **§2a's own test decides it: a count is safe exactly when its consumer already holds
   > enumeration over the counted population.** §4 requires `core.user.invite ∧
   > `core.invitation.list` on this route — **so the conjunction PUTS the count inside its
   > consumer's enumeration right**, which is §2a's safe column, alongside
   > `platform.organizations.count`. It discloses nothing obtainable more slowly by listing.

   **And the growth-curve vector does not transfer.** It describes a **platform operator**
   assembling a picture of a tenant's business one number at a time across the tenant boundary.
   **Here the actor is a member of the Organization counting their own tenant's pending
   invitations. No boundary is crossed, so there is no reconnaissance to detect** — which is
   precisely the asymmetry `0044` §3c states rather than inherits.

   **The cost of ruling the other way is not zero and it lands on the customer:** this class has
   **no equivalent of P4's accidental read bound** (`0044` §3c), so an audited read is a write
   against the tenant's own allowance. **Buying no detection with the scarcer resource is the
   trade `0044` §3c refuses.**

   **What this does NOT license, and it is the half a later reader will get wrong:** the ruling
   turns on **the conjunction being enforced**. If `core.invitation.list` is ever dropped from
   that route, the count reaches past its consumer's enumeration right again, **§2a's safe column
   no longer contains it, and the audit becomes required.** The obligation is assigned rather
   than left implicit: **whoever changes that route's permission conjunction re-runs §2a on it.**
5. **Free-tier impact on every contract.** The three unbounded read shapes are **invitations,
   sessions and usage**; each declares a page cap or names the bounding index, and none may return
   an unbounded list. **An absent bound is a registration failure, never a fallback** (`0044` §3c).
6. **Role grants are VISIBLE**: a route returns, per role, the exact permission list it holds.
   **A role set a tenant cannot inspect is indistinguishable from an arbitrary one**, and under D16
   the tenant is authoring roles against those grants — so visibility stops being a courtesy and
   becomes an input to the tenant's own security decisions.

---

## 6. ⚠ PERMISSIONS — THE DRAFT'S §6 WAS FALSE WHEN WRITTEN, AND THE CORRECTION IS THE RECORD

**The draft stated:**

> *"**Verified ABSENT** — a search of `permission-catalog.yaml` for `transfer` and `ownership`
> returns no permission entry"* — naming ownership transfer, deletion-request and invitation
> enumeration as the three missing, and concluding *"All three are PROPOSED, never added."*

**ALL THREE WERE ALREADY IN THE CATALOGUE WHEN THAT SENTENCE WAS TYPED**, with the exact
`status: proposed, phase: 2` the draft was asking for, plus a fourth the draft did not mention:

```
core.organization.transfer-ownership        critical   [organization]   proposed  phase 2
core.organization.request-deletion          critical   [organization]   proposed  phase 2
core.organization.cancel-deletion-request              [organization]   proposed  phase 2
core.invitation.list                                                    proposed  phase 2
```

**The timing is measured, not inferred:**

```
permission-catalog.yaml   written  10:02:29
the draft                 written  10:06:54     <- four and a half minutes LATER
```

> **This is not drift and it is not a stale citation. The claim was FALSE ON ARRIVAL** —
> `workflow.md` §12's *"a sentence asserting a clean history is false on arrival more often than it
> rots"*, in its sharper form: **the negative was reported as VERIFIED.** *"Verified absent"* is a
> claim about a search, and a search that could not reach its subject returns the identical output
> to one that reached it and found nothing (`§11a`'s empty-list reader).

**THE MECHANISM WAS MEASURED RATHER THAN INFERRED, AND IT IS NOT WHAT EITHER PARTY GUESSED.** The
Team Lead asked `architecture-agent` for the instrument's behaviour, explicitly not for a
recollection. Four runs, one repository, one pattern, with positive controls:

```
path = packages/contracts/permission-catalog.yaml               ->  ERROR "Path does not exist"  LOUD
path = packages/contracts/registry           (no 'ies')         ->  ERROR "Path does not exist"  LOUD
path = …/registries  +  glob = permission-catalog.yml           ->  "No matches found"           SILENT
Glob tool, pattern …/**/permission-catalog.yml                  ->  "No files found"             SILENT
```

> **A `path` argument is VALIDATED. A `glob` argument is a FILTER.** A filename that matches nothing
> is indistinguishable from a corpus that contains nothing — **and the corpus was reachable in both
> silent runs, proven by the correctly-spelled controls returning 4 hits each.**

**So the sentence could only have come from one of the two silent forms**, which narrows the
mechanism without confirming which — and `architecture-agent` **declined to reconstruct the original
call from memory**, reporting only what the measurement licenses. Recorded as a live instrument
hazard in `workflow.md` §11a, beside the NUL and `ugrep` entries, because **all three produce a
clean nothing from unrelated causes.**

**AND THE INSTRUMENT EXPLAINS THE MISS, NEVER THE WORD *VERIFIED*** — the agent's own separation,
and the more durable half:

> *"A search that returns nothing licenses **'my search found nothing'**, never **'verified
> absent.'** The instrument hazard explains how the search missed; it does not explain the word
> 'verified', and that was mine."*

### 6a. THE CONSEQUENCE IS WIDER THAN THE THREE ROWS, AND IT IS WHY THIS SECTION EXISTS

> **One false catalogue negative makes EVERY catalogue claim in that draft unverified** — including
> its *"verified present"* list, which is the evidence base for the whole of §4.

**So the Team Lead re-derived the catalogue mechanically before recording this file: 79 permission
ids, enumerated in full rather than searched for.** The draft's "verified present" list checks out
against that enumeration. **It was right; it was not verified, and the difference is not visible in
the output of either.**

### 6b. Authority for the four entries, which is already ruled and is not reopened here

The catalogue records the ruling beside the entries:

> *"A PERMISSION THAT GATES A CAPABILITY THE USER REQUIRED IS THE LEAST-PRIVILEGE IMPLEMENTATION OF
> WHAT THEY ASKED FOR, NOT A NEW GRANT OF REACH. The line that would send this back to them is a
> permission widening access BEYOND what was scoped; none of these does."*

**All four remain `status: proposed`. `security-agent` reviews them before integration**
(`security.md` §8), and they are named to the user in the milestone report rather than folded in.

### 6c. Gaps against the milestone's named areas, derived from the 79 and owed to `architecture-agent`

**The user's brief names areas the catalogue does not yet gate. Derived by comparing the brief's
list against the enumeration, not by recalling what is missing:**

| Brief area | Catalogued | Gap |
|---|---|---|
| invitations — **resend, revoke, expire** | `core.user.invite`, `core.invitation.list` | **no revoke, no resend** |
| member **restoration** | `core.user.deactivate` | **no reactivate/restore** |
| businesses and branches | `core.business.create/read/update`, `core.branch.create/read/update` | **no delete or archive on either** |

**Each is a proposal `architecture-agent` owes with a sensitivity argument, or an explicit ruling
that the capability is expressed by an existing permission.** *"It is covered by update"* is a
legitimate answer and must be written down as one, **because an unstated absence is the gap the next
author closes by inventing a permission.**

---

## 7. What this record does not settle, named rather than left implicit

- **The `branch` and `invitation` tables do not exist.** Both are migrations and therefore the
  user's, every time (`security.md` §7). Contracts may be authored ahead of them; **nothing may
  report the capability as available.** Migrations are written and handed to the user as one list.
- **`0023`'s reconciliation trigger — *"before a second App exists"* — is MET BY THIS MILESTONE
  rather than by a second App.** Recorded explicitly, because the trigger as written will otherwise
  keep reading as unfired: `workflow.md` §12's conditional whose condition turned true while its
  own text still describes the future.
- **There is still no audited path for a role or permission change** (`0018`, `0019`,
  `roles.ts:135`). **This milestone makes role assignment a product feature, which turns that gap
  from a recorded debt into a live one** — role assignment is precisely the privilege change `0007`
  rule 9 requires audited. **It is closed inside this milestone, not carried past it.**

## 8. Team Lead rulings recorded here rather than left in a dispatch

1. **§2c closes the draft's one open dependency** by `0044` §3d, cross-referenced in both
   directions.
2. **§6 is corrected against the file.** The draft's three rows are recorded as *present*, and the
   mechanism of the false negative is left as a question for the agent that ran the search rather
   than answered by inference.
3. **§6c's gap list is derived from the 79-id enumeration** and assigned, rather than being left as
   an absence for a later author to close by invention.
4. **`admin`'s owner-immunity (§3d) is a test requirement**, and `qa-agent` owes a behavioural case
   per action — not a comment in `roles.ts`.
