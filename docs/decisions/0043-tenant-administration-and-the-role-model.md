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
| member count | `core.user.list` holder | **yes — FOR AN ORGANIZATION-SCOPE HOLDER ONLY.** ⚠ see §4a | **no new permission, WITH A SCOPE QUALIFIER** |
| session count for a member | `core.session.list` holder | **yes** | no new permission |
| Business count | `core.business.read` holder | **read is the de-facto enumeration right — ⚠ see §4a** | no new permission |
| pending-invitation count | `core.user.invite` holder | **no** — invite grants creation, not enumeration | **requires `core.invitation.list` as a conjunct, or the count is withheld** |
| usage / quota figures | `core.usage.read` holder | **n/a — see below** | **not an enumeration question** |

**The invitation row is the finding.** `core.user.invite` is a *create* permission; nothing about it
grants enumeration of pending invitations, and a count of them is a count of people who have been
asked to join and have not. **`core.invitation.list` is catalogued (§6) and is the conjunct** —
which is `0044` §3d's mechanism doing exactly the work §2b assigned it, on the first aggregate that
needed it.

### 4a. ⚠ THREE OF THE FOUR ROWS ABOVE RULE ON AGGREGATES THAT DO NOT EXIST — AND ONE RULING IS UNSAFE AS WRITTEN

**Added 2026-09-13 after `security-agent` re-ran §2a at the moment of granting, which `security.md`
§2a-i requires and which is what this section is for.**

**The milestone's five contracts introduce EXACTLY ONE aggregate** — `tenant.invitations.pending-count`.
**There is no member count, no session count and no Business-count operation anywhere.** So three of
the four rows above are **pre-authorisation**, and pre-authorisation is precisely what §2a-i's trigger
exists to catch.

> **THE MEMBER-COUNT ROW IS UNSAFE AS WRITTEN, AND SO IS THE IDENTICAL CLAIM IN
> `tenant-members-v1`.**
>
> `core.user.list` declares `scopes: [organization, business, branch, team]`. **`business-admin` is a
> BUSINESS-scope role** — its enumeration right is the users of the Businesses it administers,
> narrowed per request by `0020`'s authorized business set. **A member count is ORGANIZATION-WIDE.**
>
> **So for that holder the count reaches PAST its consumer's enumeration right, which is §2a's
> failure condition, on the very permission the table clears.**

**Both artifacts checked whether the consumer holds an *enumerating permission* and stopped one step
short. §2a asks whether the consumer enumerates THE COUNTED POPULATION** — and the permission's scope
and the population are different questions. **`0043` §1b is itself the record that scope axes get
conflated here.**

**Nothing is exposed: no member count exists.** It is recorded at this severity because of what it
would do to whoever adds one — **`architecture.md` §3c's reader half, in its worst form.** They would
find two artifacts saying §2a clears it, **one of them an ACCEPTED decision record**, and they would
be **right to stop.** An acceptance marker is the thing to review, not the thing that ends review.

**THE QUALIFIER, and it belongs on any future count of an organization-wide population:**

> **Safe for an ORGANIZATION-SCOPE holder. For a BUSINESS-SCOPE holder the count must be scoped to
> the authorized business set, or withheld.**

**And the Business-count row is doubtful for a different reason worth naming: THERE IS NO
`core.business.list`.** The family is read / create / update / archive, so *"the consumer
enumerates"* rests on **`read` being the de-facto enumeration right** — defensible, and **it is
exactly the read-versus-list distinction the invitation row one line above gets RIGHT.** Same table,
both readings. **Whoever builds a Business count owes that argument explicitly rather than
inheriting this row.**

**What the one aggregate that DOES exist got right, and it is the model for the rest:**
`tenant.invitations.pending-count` declares `permissionMode: conjunction` over
`[core.user.invite, core.invitation.list]`, **evaluated in Core on every call** — which is
`security.md` §2a-0's requirement exactly, **a conjunction rather than an observation about
co-holding, and it is the only form that survives D16 letting a tenant mint a role holding one
conjunct without the other.** The shape is a scalar and nothing else — no `by_status`, no `by_role`,
no `by_inviter` — because any of those transposes into the mapping `0028` D1 refuses.

**And `tenant-members-v1` does one thing better than either artifact above**, which is why the gap
was findable at all: **it declines to claim §2a is the reason a member count is absent.** *"The
reason it is absent is pagination's, not §2a's… Whoever adds one owes THAT argument, not this
one."* **A refusal to take credit from the wrong control.**

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
| invitations — **resend, revoke, expire** | `core.user.invite`, `core.invitation.list` | ~~**no revoke, no resend**~~ **WRONG — see below** |
| member **restoration** | `core.user.deactivate` | **no reactivate/restore** |
| businesses and branches | `core.business.create/read/update`, `core.branch.create/read/update` | **no delete or archive on either** |

**Each is a proposal `architecture-agent` owes with a sensitivity argument, or an explicit ruling
that the capability is expressed by an existing permission.** *"It is covered by update"* is a
legitimate answer and must be written down as one, **because an unstated absence is the gap the next
author closes by inventing a permission.**

> **⚠ ROW 1 WAS WRONG, AND HOW IT WAS WRONG IS WORTH MORE THAN THE ROW.** `core.user.invite`'s own
> catalogue entry already rules resend and revoke:
>
> > *"CREATE an invitation, and resend or revoke one. **RESEND AND REVOKE ARE FOLDED IN
> > DELIBERATELY**… both act on an invitation this holder could have created."*
>
> **This table was DERIVED — from the file, from a full enumeration of every permission id, at the
> moment of writing. It was not recalled.** And it was derived **over identifiers**, so a capability
> folded into an existing entry's `description` had no id to appear as.
>
> **THE ENUMERATION WAS RIGHT AND THE CONCLUSION WAS NOT.** An id-level sweep answers *which
> permission names exist*; it cannot answer *which capabilities are gated*. **Deriving rather than
> recalling is no protection against the wrong granularity** — recorded in `workflow.md` §11a,
> because *"I derived it"* has been treated in this repository as settling the question.
>
> **A catalogue gap analysis reads descriptions, not only ids.** And note what caught it: writing
> the ruling required opening the entry to cite it (`architecture.md` §3c).

### 6d. THE RULINGS, DELIVERED — and `expire` turned out not to be an operation

**`architecture-agent` closed §6c. Recorded here so the gap list does not read as open:**

| Capability | Ruling |
|---|---|
| invitation **revoke**, **resend** | **No new permission.** `core.user.invite`, per its own entry — refined so the folded-in argument holds *within a scope and fails across scopes*, so all three evaluate at `organization` |
| invitation **expire** | **Not an operation.** Automatic expiry is a property of the record and nothing gates time passing; forced early expiry **is revoke**, and a second route is two words for one act |
| member **restore** | **`core.user.reactivate`** — new, `sensitive`, `[organization, business]` |
| member **removal** | **`core.user.remove`** — new, `sensitive`, `[organization]` |
| business / branch withdrawal | **`core.business.archive`, `core.branch.archive`** — new, `sensitive`, each gating archive **and** restore. **`delete` deliberately NOT declared for either** |

**All four new entries are `status: proposed`, held by no role, and go to the user by name.**

**`archive` rather than `delete`, and the reasoning is the part to keep.** *"Covered by
`core.business.update`"* would have been a legitimate answer if it were true, and it is not:
**withdrawing a Business withdraws an authorization scope** (`0020`), so gating it on `update`
**widens a write permission into a scope-removal permission by adoption.** `delete` is left
undeclared **so that nobody can hold it** — a Business id is a required foreign key on customer rows
and on every future App's, and deletion needs a cascade decision nobody has made. **An undeclared
permission is unholdable; that is the mechanism, and the absence is recorded rather than left to be
noticed.**

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

## 7a. ⚠ §7's FIRST BULLET WAS FALSE WITHIN HOURS — and the general shape is the finding

**§7 says the `branch` and `invitation` tables do not exist. `0021_invitation.sql`,
`0022_tenant_role.sql` and `0023_organization_deletion_request.sql` are all on disk**, written the
same afternoon this record was accepted, **and four Milestone 2 contracts repeat the claim as a
dependency.** A contract asserting a table does not exist **instructs** — `workflow.md` §12's most
dangerous residue class, arriving inside the milestone that created it.

> **AN ACCEPTED RECORD'S MEASUREMENTS ARE EVIDENCE ABOUT THE MOMENT IT WAS WRITTEN, and in a tree
> several agents write concurrently that moment is short.** This is the third instance in one day —
> the same class as `0043` §6c's row 1 and the enum widening that half-landed across two schemas.
>
> **The remedy is not to measure more carefully. It is to write the dependency as a CONDITION rather
> than as a FACT** — *"this route requires an `invitation` table; the migration is the user's"* stays
> true whether or not the file exists, where *"the table does not exist"* is false the moment
> somebody writes it and instructs the next reader wrongly.

### 7b. THE FIVE DIVERGENCES — PRECEDENCE RULED PER ROW

`architecture-agent` compared its contracts against the migrations' column declarations, **found
five disagreements, edited none of them, and referred precedence here.** That was right: contract-
first makes the contract normative, Core built in parallel, and **in two places Core built better.**
A unilateral rewrite in either direction is the wrong move when both sides are defensible.

| # | Subject | RULING | Who changes |
|---|---|---|---|
| 1 | invitation close/resend — contract `resent_at`; Core `closed_at` + `closed_by_principal_id` | **CORE WINS.** Dropping *who* closed an invitation loses an accountability fact on a membership-changing act, which `security.md` §6 requires audited. Resend and close are different events and the shape needs both | contract |
| 2 | invitation carries custom roles — contract `custom_role_ids` (≤20); Core `role` only | **CONTRACT WINS.** `0022` creates the custom-role tables, so an invitation that can carry only a seed role makes §5.6's visibility promise hollow **at the moment membership begins** — the one moment a grant is chosen | **`0021_invitation.sql`** |
| 3 | role lifecycle — contract deletes, refused while held; Core `status IN ('active','retired')` | **CORE WINS, and it is stronger than a refusal.** Retire-not-delete is `0031`'s Template precedent applied correctly: a refusal is a rule someone can be talked out of, a lifecycle state is a fact the data carries | contract |
| 4 | role name — contract `name`; Core `display_name` | **ALIGN ON `name`, both sides.** A wire/column split with no reason behind it is exactly what `0034` cost a day over. `organization.display_name` is a different table with its own justification and does not transfer | Core |
| 5 | per-permission scope — contract omits it; Core `role_permission.scope NOT NULL` | **CORE WINS** | contract |

**Row 5 is the one worth reading twice, and `architecture-agent` diagnosed it against itself.** It
omitted the field arguing from **§1b — a ROLE's `scope:` has no consumer.** True, and about a
different axis:

> **Core's column is a PER-PERMISSION scope — D6's intersection — which has a real consumer.**
> A correct ruling applied to the wrong field, leaving a `NOT NULL` column the request shape supplies
> nothing for.

**That is `architecture.md` §3c's reasoning-from-a-record's-topic-rather-than-its-clauses, in the
tree of the agent that added that section a week earlier.** Recorded because it is the second time
today that knowing a rule conferred no protection against the case.

**ROW 2 IS A MIGRATION AMENDMENT AND IT IS FREE RIGHT NOW.** `0021` is written and **not applied**,
so adding the column costs an edit. **After it is applied it costs a second migration** — which is
the whole reason the migration list goes to the user as one reviewed set rather than one at a time.

## 7c. ENUM POLICY ON THE ROLE VOCABULARY — RULED `closed`, AND TODAY IS THE EVIDENCE

**After `0043` §3a's widening landed, `membershipRole` held the same four values in two contracts
with DIFFERENT policies** — `extensible` in `organization-detail-v1`, `closed` in
`tenant-members-v1`. `0041` amendment 1's check flags exactly that: identical value sets, divergent
policy.

**The case for `extensible` is real and it is empirical:** it is why today's 2 → 4 widening was
**not** a breaking change on a live consumer. `platform/admin` already had the unknown arm, so the
new values flowed into it and nothing failed to compile. **That is the mechanism working as
designed, and it is the argument I expected to accept.**

> **⚠ AND THE SAME EVENT IS WHY IT IS REFUSED. THE UNKNOWN ARM IS WHERE THE EIGHT UNTRANSLATED
> STRINGS LIVE.**
>
> `platform/admin`'s unknown branch renders the raw value plus a `<span className="sr-only">` note
> **in English, on an Arabic console** — eight of them, and **the only people who ever meet them are
> blind Arabic-speaking operators.** The arm was correct, unreachable, and untranslated; **`0018`
> makes it reachable.**
>
> **`extensible` did not make the widening SAFE. It made it SILENT** — it converted a compile error
> that would have named every consumer into a runtime path nobody re-examined for two role values.

**RULED: `membershipRole` is `closed` in both contracts.**

- **The `CHECK` is the authority and it admits exactly four.** A fifth value cannot be stored, so an
  unknown arm on a *response* guards against something the database cannot produce.
- **A fifth seed role is a DECISION** — a migration plus a contract change — **which is precisely
  what `closed` exists to force.** `0041`'s whole argument.
- **And `0041` amendment 1 settles the request position independently:** roles are assigned, so
  `membershipRole` appears in a request shape, and **a request enum is always `closed`** — a server
  accepting a role it does not understand has no correct behaviour.

**`organizationStatus` in `platform-operator-v1` is `extensible` over a `CHECK` admitting exactly
two values. RULED `closed`**, same reasoning: the unknown arm can never be reached by anything the
database can hold, **which is amendment 3's hazard with nothing on the other side of the trade.**

> **THIS IS A BREAKING CHANGE TO AN ACCEPTED CONTRACT AND IS RECORDED AS ONE** (`architecture.md`
> §1). Narrowing `extensible` → `closed` **removes the unknown arm**, so a consumer that added one
> because the policy told it to loses the branch — **and the compiler names it, which is the loud
> direction.** `web-agent` is told before the build goes red, not by it.

**And `architecture-agent`'s observation about the OTHER pair is the one to keep**, because it stops
the wrong repair: `membershipStatus` and `organizationStatus` are grouped **only because their value
sets are identical**, and they name **two different objects** — a membership's status and an
Organization's. **The sameness is the coincidence.** *"Make them agree"* is the wrong instruction;
**"decide each against its own `CHECK`"** is the right one. Both answers happen to be `closed`, and
arriving there by the right route is what makes the next pair decidable.

## 7d. WHERE A MEMBER'S DISPLAY NAME LIVES — `organization_membership`, and the boundary decides it

**`memberSeat.display_name` is null on every response and the control plane has nowhere to store
one:** `principal` is exactly `(principal_id, principal_type, status, created_at)`, and
`principal_credential` holds an HMAC whose plaintext is *"never stored and never logged"* — **so a
name is absent and an email is mathematically unrecoverable.** The contract already settled the
rendering (a null renders the `principal_id` **verbatim**, never a placeholder), **and its own honest
consequence is the reason this needed deciding:**

> **"A members directory in which every row reads `k7Qx2mZp…` is not a usable members directory."**

**`architecture-agent` proposed against the axis I set — platform identity or tenant identity — and
then sharpened it into something that is not a preference at all:**

| | Cross-tenant write | Platform-operator visible | Admin can fix a typo | Migration |
|---|---|---|---|---|
| **A** `principal.display_name` | **the subject's own act propagates to every Organization** | **YES — a new disclosure** | no | 1 `ADD COLUMN` |
| **B** `organization_membership.display_name` | **none — structurally impossible** | no | yes | 1 `ADD COLUMN` |
| **C** both, with precedence | inherits A's | inherits A's | yes | 2 columns + a rule |

> **THE COST DOES NOT SEPARATE A AND B — both are one nullable `ADD COLUMN`. THE TENANT BOUNDARY
> DOES.** `principal` spans Organizations; `organization_membership` is keyed
> `(principal_id, organization_id)` and is tenant-scoped by its own primary key. **If a name lives on
> `principal` and a tenant may write it, an administrator of Organization A changes what Organization
> B sees — a write across the tenant boundary, through a settings screen, with no route between the
> two anywhere in the design. That is not a naming inconsistency; it is `security.md` §1.**

**And the second consequence, which nobody had named:** `principal` is **control plane**. A display
name there is **personal data a platform operator can read** — today they cannot, because the member
resolve returns an opaque identifier — **so option A creates a new disclosure of personal data to
platform operators and owes its own `security.md` §2a analysis before it is a field.** Under B that
question never arises: the name is tenant data and `0024` already keeps operators out of it.

**RULED: B. `organization_membership.display_name`, nullable, no default.**

**The objection to B is that a person then has no single name. THE REFRAME ANSWERS IT AND IS THE
PART TO KEEP:** it is only strange if the field is a person's *name*. **It is not — it is what THIS
ORGANIZATION CALLS THIS MEMBER**, which is exactly what `business.display_name` and
`organization.display_name` already are: a tenant's label for a thing in its own directory. **A
contractor who is "Sam" in one Organization and "S. Foulad, external" in another is not two names for
a person; it is two directories, each correct.** `0006` says a tenant's view of anything is that
tenant's — **this is that rule, not an exception to it.**

**C is the compromise that will be proposed and it is the worst of the three**: it inherits A's
cross-tenant channel *and* A's operator disclosure, **and adds a precedence rule that is a third
decision producing two answers to "what is this person called."**

**What B costs, in full, so this is not read as free:**

- **No new permission.** `core.user.update` is catalogued — *"Modify a user profile"*, `write`,
  `[organization, business, own]` — which already covers both an administrator and the member.
- **No contract change.** `memberDisplayName` is already `["string","null"]` with the null rendering
  already normative on both clients. **B is the option the contract already describes.**
- **No backfill.** Nullable, no default; existing rows stay null and render as the identifier, which
  is what they do today.
- **`0015` §D is untouched.** A display name is a **different field** from the login identifier. **The
  identifier staying unrecoverable is a property preserved here, not an obstacle routed around**, and
  nothing in B stores an email.

**THE MIGRATION IS THE USER'S** (`security.md` §7) and joins the approval list. **`core-agent` writes
it; `architecture-agent` proposed and did not author, correctly — a proposal in its own tree would
have been `architecture.md` §2a's mistake.**

**One consequence to carry into the port:** `core-agent` made `display_name` **absent** from
`TenantMemberSeat` rather than present-and-always-null, because *a field no store can fill reads as
"sometimes populated" to the next author.* **When this lands, the field arrives — and the null
rendering rule must arrive with it**, or the first screen to show a name will show a blank for
everyone who has not set one.

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
