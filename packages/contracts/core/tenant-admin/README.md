# `core/tenant-admin` — Organization administration, the tenant-admin request class

**Owner: `architecture-agent` authors; Team Lead accepts.**
**Status: every contract in this directory is `proposed`. Nothing here is accepted and nothing here
is built.**

The contracts a customer's own administrators call to run their Organization —
`app.dudo.work/settings`. Milestone 2.

---

## 0. This directory carries ONE README for FOUR contract sets, and says so on its face

`packages/contracts/README.md` records that a contract set is three artifacts and that
`core/identity` is the one set that uses two, *"so a reader does not conclude a `README.md` was
lost."* This directory is the second deviation and it is a different one: **four sets, one README.**

**The reason is the defect `workflow.md` §12 records rather than a preference.** Every contract here
inherits the same class, the same tenancy argument, the same not-found ruling, the same page-bound
requirement and the same permission-model context. Restating those five in four files produces **a
duplicated constraint with no citations** — and §12's finding is that a duplicated constraint is the
one a citation-driven sweep cannot find, *"restated six times and agreed with the running code
once."*

> **So the shared half is stated ONCE, here, and each contract cites it. The per-contract rulings
> stay in the contract.**

**What this costs, stated rather than discovered:** a reader who opens one `*.contract.yaml` in
isolation does not have the class obligations in front of them. Every contract in this directory
therefore carries a `readThisFirst:` key naming this file — the mitigation is a pointer, and a
pointer is weaker than the constraint being present. If that turns out to fail in review, the
answer is four READMEs and four copies of §2, not a longer pointer.

---

## 1. The class — `0044`, and what it is NOT

Every operation in this directory declares **`requestClass: tenant-admin`**.

```
principal      authenticated, principal level
tenant         RESOLVED FROM THE AUTHENTICATED CONTEXT, never from the request
permission     evaluated on every call, in Core, deny by default
control plane  YES — this is the whole reason the class exists
App-reachable  NO
```

**`0044` §1 is the measurement that produced it: almost nothing Milestone 2 administers lives in the
tenant database.** `organization`, `organization_membership`, `session`, `membership_role`,
`principal`, `organization_identity` are all control plane, and `ActionContext` carries no
control-plane port. **So none of this could be an Action**, and putting a control-plane port on
`ActionContext` is refused absolutely by `security.md` §4 — Actions are the App execution path.

**The last row is the safety argument.** `§4` is preserved by tenant-admin and Action being
*different classes*, not by a check inside one.

### 1a. No platform operator can reach any route in this directory, and it is not a check

`0044` §3a: the class resolves a tenant from the authenticated context, **a platform operator holds
zero `organization_membership` rows**, so no tenant resolves for them and the route is unreachable
by construction. That is `0024`'s mutual exclusion doing the work.

**Read the direction carefully.** This says a platform operator cannot call these routes. It does
**not** say a tenant administrator cannot reach platform data — that is a separate property, held by
these contracts publishing no platform shape and by `core.*` permissions declaring
`scopes: [organization]`.

---

## 2. The six obligations every contract here declares — `0043` §5

**Declared as FIELDS. `workflow.md` §12: prose describes, a declared field can be checked.**

### 2.1 `unknownIdentifierResponse: not_found`

Every operation taking an identifier declares it. **A cross-tenant identifier and a nonexistent one
are indistinguishable.**

> `forbidden` means *you lack the permission* and never *that id is not yours*. The two are
> indistinguishable in an `errors:` list, which is why this is a separate field and not an entry in
> one.

**`customer-directory-v1`'s step-5c ruling is the one exception in the corpus and it is CITED, never
copied.** It returns `forbidden` for an in-tenant unauthorized Business on a data-corruption
argument — a user told *"no such customer"* re-enters the customer and the tenant's own directory
silently duplicates. **Nothing in this milestone has that shape**: nobody re-creates a colleague
because a member lookup 404'd, and every write here is idempotent on a natural key or refused.

**Where `forbidden` IS correct here:** the caller does not hold the permission. That decision is
record-independent — taken before any identifier is read — so it carries no information about any
record, and a caller cannot vary a request to change it.

### 2.2 No organization identifier in any request position

**Path, query or body. `0044` §3b.2 makes a route declaring one a REGISTRATION refusal** — refused
when the route is registered, not when it is called.

Three layers, and only the first is in this directory:

| Layer | Catches | Blind to |
|---|---|---|
| **No such property, `additionalProperties: false`** | a client sending one | a route that adds one later |
| **Registration refusal (`0044` §3b.2, Core)** | the route that adds one later | nothing above it |
| **The tenant is never on `ActionContext`-equivalents** | both | — |

**The schemas here prove input validation, never isolation**, and say so.

### 2.3 Every read declares a bound — `freeTierImpact`, and there is no default

`0044` §3c: **this class does NOT inherit the platform class's accidental read bound.** P4 makes
every platform read a write, so the write ceiling bounds read cost. **Here it does not.**

> **An absent bound is a REGISTRATION FAILURE, never a fallback. A DEFAULT PAGE SIZE IS THE
> FAIL-OPEN VERSION OF THIS and it is not proposed anywhere in this directory.**

Every read here declares either `pageCap` or `boundingIndex` in `freeTierImpact`. The three shapes
`0044` §3c named as easy to forget — invitations, sessions, usage — are exactly the ones *"that do
not feel like a list"*, and two of the three are in this directory.

**`urn:dudo:schema:pagination:1#/$defs/pageSize` carries `"default": 25`.** That is the *client's*
convenience and it is not the bound: the bound is the **maximum**, which the schema fixes at 100 and
each contract restates as `pageCap`. A route that declared no cap and leaned on the shared default
would be the fail-open case wearing the shared schema's clothes.

### 2.4 Sensitivity is read off the catalogue, and confirmation is DERIVED from it

`0043` §5.4 requires every destructive or sensitive operation to declare `confirmation`,
`audit: required` and its `sensitivity`.

> **`sensitivity` and `confirmation` are BOTH read off `registries/permission-catalog.yaml`. Neither
> is chosen per route.**

**`confirmation: required` appears here only where the gating permission is `critical`**, because
`0007` D15 makes a `critical` permission carry the confirmation automatically — *"with no code
change and no chance of omission"* (`confirmation-v1`). The catalogue already ruled this for the one
operation the brief called out by name:

> `core.organization.transfer-ownership`: *"THE 'STRONG CONFIRMATION' THE MILESTONE BRIEF ASKS FOR
> IS SATISFIED BY THE RUNG RATHER THAN BY A BESPOKE GATE… hand-building a second gate here would be
> inventing one the ladder already provides."*

**So `confirmation: derived` on a `sensitive` operation is a declaration that the ladder was
consulted, not an omission** — which is the distinction the field exists to make visible. A bespoke
`confirmation: required` on a `sensitive` route would be a second gate with its own failure mode,
and it would break the property that declaring a permission `critical` is sufficient.

### 2.3a. ⚠ EVERY `sensitive` READ IN THIS DIRECTORY IS AUDITED — `0044` §3c AMENDED 2026-09-13

**`0044` §3c licensed a per-route exemption from auditing reads, and three routes here took it.
The clause covers none of them.**

```
0044 §3c              "the actor is a member reading THEIR OWN DATA"
Core's transcription  "the actor is a member reading THEIR OWN ORGANIZATION'S DATA"
```

**One word, inserted in transcription.** On the record's words the clause licenses a **self-read**;
on Core's it licenses **every intra-tenant read**, which is every route in this class.

> **THE AMENDED CLAUSE: the contrast with P4 is the ACTOR'S POSITION, and that licenses only the
> absence of a BLANKET read audit. IT LICENSES NO INDIVIDUAL EXEMPTION** — being inside the tenant
> is true of every route here and therefore distinguishes none of them. **A `sensitive` read is
> audited unless a per-route argument says otherwise, and that argument may not be this paragraph.**

**All three exemptions were re-argued and all three are now `audit: required` — for three different
reasons, none of them §3c's clause:**

| Route | Why it is audited |
|---|---|
| `tenant.members.sessions.list` | **The charge METERS it.** Auditing reinstates the read bound `0044` §3c says this class does not inherit |
| `tenant.invitations.get` | **The exemption carried its own refutation** — list-once-then-read-each was a complete bypass of the listing's audit, recorded as a caveat |
| `tenant.invitations.pending-count` | **`security.md` §2a's own remedy** for a longitudinal vector: *the permission is the control and the audit trail is the detection* |

**⚠ AND THE THIRD HAD NO ARGUMENT AT ALL, WHICH IS WHY IT SURVIVED LONGEST.** The other two were
defended in prose a reviewer could push on. **An unstated exemption presents as a settled default
rather than as a claim somebody made** — so the one worth finding was the one with nothing written
beside it.

### 2.4a. THE TENANT-ADMIN CHALLENGE CARRIES ITS PARAMETERS **FLAT** — ruled 2026-09-13

**`confirmation-v1`'s challenge request carries `parameters` as a NESTED OBJECT, and the platform
class added `objectFields` to support it. This class has none, deliberately.** The three ways out
were object-field support in the class, a flat parameter set, or no parameters at all.

> **RULED: FLAT. And it is not a divergence from `confirmation-v1` — it is that contract's OWN
> ruling applied to the end that never had it applied.**

**`confirmation-gate.ts` already decides what the parameters ARE, on submission:**

> ***"THE PARAMETERS ARE THE SUBMITTED BODY MINUS THESE THREE FIELDS… everything that is not a
> confirmation field is a parameter."*** — and it refuses the alternative in terms: ***"a nested
> `parameters` object on submission puts a second definition of 'the parameters' somewhere, and two
> definitions of the bound value is a binding that covers different things at the two ends."***

**Submission is already flat. Only the CHALLENGE is nested.** So a flat challenge gives this class
**one definition of "the parameters" at both ends**, which is what that ruling asks for and what the
nested form prevents.

**⚠ AND THE CONSEQUENCE FOR THE PLATFORM ROUTE IS A FINDING, NOT A CHANGE.** Its challenge is nested
and its submission is flat — **the two-definition shape `confirmation-gate.ts`'s own ruling names.**
It presumably agrees today because somebody made the two canonicalisations correspond; **that
correspondence is a thing a person maintains rather than a thing the shape guarantees.**

> **`confirmation-v1` IS NOT AMENDED HERE. Narrowing its challenge to flat is breaking on an
> ACCEPTED contract with a live console consuming it** (`architecture.md` §1), so it is the Team
> Lead's. **This class takes the better shape for itself and reports the older one rather than
> quietly matching it** — matching would have made two routes consistent and both wrong.

**`0044` §3b.2 is unaffected and the mechanism is the same one.** The challenge route is itself a
tenant-admin route, so an organization identifier in any of its positions is refused **at
registration** — and because the flat parameters mirror the target operation's body, and no target
may carry one, **flattening cannot introduce one.** The guarantee is inherited rather than restated.

**No parameters at all was refused on the merits:** a `transfer-ownership` statement that cannot name
the recipient **authorises a transfer to anyone**, which is a confirmation that confirms nothing.

**⚠ AND THE ACTION-CLASS CHALLENGE ROUTE STILL DOES NOT EXIST.** `confirmation-v1` requires two
challenge routes — *"one Action, one platform route"* — and only the platform one is registered.
**A `tenant-admin` operation is neither**, so this class needs a THIRD challenge route and nobody
has built it. **Every `critical` operation in this directory is therefore unreachable on arrival,
for the same reason `DeleteCustomer` is**: the lock is fine and the key cannot be minted. Recorded
per contract as a dependency rather than as a caveat, and **it must not be reported as built.**

### 2.5 Role grants are visible

`0043` §5.6: a route returns, **per role, the exact permission list it holds.**

> **A role set a tenant cannot inspect is indistinguishable from an arbitrary one** — and under
> `0007` D16 the tenant is authoring roles *against those grants*, so visibility stops being a
> courtesy and becomes an input to the tenant's own security decisions.

Published by `tenant-roles-v1`. **It is the one place in Dudo where a permission id is on the wire
to a customer**, and that is deliberate: a custom-role builder that cannot name the permissions it
is composing is a form with opaque checkboxes.

### 2.6 Conjunctions, never disjunctions — `0044` §3d

A route may declare **`permission:` as a list with `permissionMode: conjunction`**. The caller must
hold **all** of them, evaluated in Core on every call.

**`permissionMode: disjunction` is not a value.** It is not defined, not reserved, and must not be
added: `A ∧ B` is strictly more restrictive than either conjunct and cannot widen reach, while
`A ∨ B` **is a widening wearing the same syntax.** `0044` §3d requires it refused at the type level.

**Which instrument to use, before proposing either:** *would a grantor ever want the capability
without one of the conjuncts?* **Yes → its own permission** (the `core.template-adoption.read`
answer). **No → the conjunction says the true thing** and a third name is a synonym.

**One live consumer today: `tenant-invitations-v1`'s pending count**, `core.user.invite ∧
core.invitation.list` — `0043` §4's finding, and the first thing `0044` §3d's mechanism was built
for.

---

## 2.6. `exposure` — RULED 2026-09-13, AND THE PARAGRAPH EXISTS FOR THE FUTURE READER RATHER THAN FOR THIS ONE

**Every operation in this directory declares `exposure: [internal, public]`, except the two
`critical` ones, which are `[internal]`.**

### The ruling

**`public` stays on the `sensitive` operations.** `critical` — `tenant.organization.transfer-ownership`
and `tenant.organization.request-deletion` — **is `[internal]` and stays there**, because
`confirmation-v1` renders a statement to a principal who reads it, and a Bearer caller mints its own
challenge and answers it in the same second. **A confirmation gate with no reader is a control
satisfied by the thing it was protecting against.** That ruling does not depend on anything below.

### ⚠ THE FIELD IS INERT. MEASURED, AND THE COMMAND IS HERE SO YOU RE-RUN IT RATHER THAN TRUST THIS SENTENCE

```
grep -rn "\.exposure\b"   platform/ packages/ apps/   (node_modules excluded)  ->  EMPTY
grep -rn "exposure:"      same scope                                           ->  72 declarations
```

**One type declaration at `platform/core/action/action.ts:115`. Seventy-two setters. Zero readers.**
Not in `pipeline.ts`, not in `api.ts`, not in the router, not in the SDK, not in a checker, not in a
test. **And `session-credential.ts` resolves the Bearer header and the `dudo_session` cookie to ONE
session token** (`0015` §A — one value, two carriers) **without carrying the carrier forward**, so
the transport could not distinguish the callers even if something wanted to. **There is no
API-credential actor class in Core at all** — the concept is two permission ids and nothing issues
one.

**So `public` grants nothing today because it does nothing today**, and reverting 72 declarations to
reach the same behaviour would be churn against an inert field.

### AND THIS IS WHY THE PARAGRAPH IS HERE — THE OBLIGATION, WHICH IS NOT MINE AND NOT THE READER'S EITHER

**`exposure` is not orphaned by oversight. It was written for three consumers named in advance**, and
`customer-directory-v1` names them: *"the manifest is the machine-readable document that **an
admission path, a namespace-collision check and a generated OpenAPI surface** actually read"* — and
it adds that *"`public` without an address is half a declaration."* **All three are unbuilt.**

> ### **THE DAY ANY ONE OF THOSE THREE IS BUILT, 72 DECLARATIONS BECOME LIVE SIMULTANEOUSLY — AND NOT ONE OF THEM WAS REVIEWED AS A GRANT.**
>
> **WHOEVER BUILDS THE FIRST CONSUMER OF `exposure` OWES A REVIEW OF EVERY DECLARATION AS A
> CAPABILITY DECISION, NOT AS A MIGRATION.** The Team Lead has taken that obligation; it is recorded
> here because this is where the declarations are, and `workflow.md` §12 is explicit that a deferral
> without an owner is one nobody collects.

**This is `security.md` §8-0's shape on a different field.** Declared is not enforced — **and the
moment something reads it, everything declared is enforced at once, retroactively, with no review
step anywhere in between.** A permission at least has `roles.ts` as a second, deliberate act;
**`exposure` has no second act, so the writing IS the granting, deferred.**

### THE GENERAL FORM, BECAUSE THIS IS THE THIRD FIELD IN ONE DAY

**`scopes:` on a permission, `scope:` on a role, and `exposure`** — three machine-readable fields in
registers and contracts, **all read by nothing.** Two of them produced wrong conclusions about reach
in this directory before anyone measured them.

> **THEY LOOK EXECUTABLE, AND THAT IS THE MECHANISM RATHER THAN CARELESSNESS.** Machine-readable, in
> a register, in the vocabulary of real runtime functions — and `workflow.md` §12 says a
> machine-readable constraint **instructs** where prose merely describes. **Every reader correctly
> treats such a field as more binding than a comment. It is enforced by nothing.**

**THE ONE-COMMAND TEST, before reasoning from any declared field:**

> ### **Does any file under `platform/core/**` READ this field?**

**`scopes:` no. `scope:` on a role, no. `exposure`, no — measured today. `enumPolicy`, YES — the
generator reads it, which is why it is the one of the four that bites.**

## 3. `security.md` §2a re-run, and the one aggregate that failed it

`0043` §4 ran the enumeration test over every count this milestone introduces. **The invitation row
is the finding and it is the reason `core.invitation.list` exists**: `core.user.invite` is a
*create* permission and grants no enumeration, and `core.user.list` enumerates **members** — a
different population from *people who have been asked and have not answered*, whose email addresses
belong to non-members.

**And `usage` is the case §2a does not answer**, which `0043` §4 states rather than forces: a quota
figure is not a count over a population the caller might enumerate. **§2a must not be reported as
passing on it.** The right test is the tenant boundary, and it belongs in the usage contract — which
is not in this directory yet.

### 3a. ⚠ THE TEST HAS NO STABLE SUBJECT UNDER `0007` D16, AND EVERY §2a ANSWER HERE INHERITS THAT

`security.md` §2a-0: **custom roles decompose co-holding, continuously, under customer control.** A
tenant admin holding both `A` and `B` may mint a role holding only `A`.

> **So every §2a answer of the form *"safe, because every role holding A also holds B"* is an
> observation about today's roles that a TENANT can falsify without touching any code.**

**That is why the invitation count is a conjunction rather than a note.** It is the only form that
survives a role set the platform does not author.

**And `security.md` §2a-i's assignment binds here:** whoever approves a new tenant role, or grants an
existing one a new permission, **re-runs §2a over every aggregate that permission can reach.** Under
D16 that party is frequently the customer, which is precisely why the enforcement is a conjunction
in Core and not a review step.

---

## 4. What this directory does NOT contain, and it is not a gap to be closed by extending a file here

> **⚠ THIS SECTION WAS AN ABSENCE LIST AND IT WAS FALSIFIED TWICE IN ONE DAY — ONCE BY A ROW
> BECOMING WRITTEN, AND ONCE BY A ROW BEING IN THE WRONG CLASS. It is now a STATE TABLE, which is
> the shape that does not rot in the same way.** A list of what is missing is a claim about the tree
> with an expiry date and nothing marks it (`0043` §7a). A table of what exists is checkable against
> `ls`.

**Every set the Milestone 2 brief named, and where each one landed:**

| Brief area | State |
|---|---|
| Members · invitations · roles · profile | **Authored, here.** |
| Retention, archive, deletion-request · ownership transfer | **Authored, here** — `tenant-lifecycle-v1`. |
| **Sessions and security controls** | **Authored, here** — `tenant-sessions-v1`. |
| **Plan, quota and free-tier usage** | **Authored, here** — `tenant-usage-v1`. |
| **Template configuration** | **Authored, here** — `tenant-configuration-v1`, as one read. |
| **Installed-App configuration** | **REFUSED** — `tenant-configuration-v1` → `theAPPHALFISREFUSED`. Blocked on three decisions, none of them a contract. |
| **Businesses and branches** | **Authored, and NOT IN THIS DIRECTORY** — `core/organization/organization-structure-v1`, **Action class.** |
| **The organization dashboard** | **REFUSED AS A ROUTE.** See below. |

### 4a. ⚠ "ALL BELONGING TO THIS CLASS" WAS WRONG, AND IT IS A DIFFERENT DEFECT FROM THE LIST GOING STALE

**This section used to say the unwritten sets were *"all named in the Milestone 2 brief, all
belonging to this class."*** The first half was true. **The second was an unchecked claim about work
that did not exist yet.**

> **`business` and `branch` are TENANT-DATABASE tables** — `platform/core/migrations/0002` and
> `0004`, not under `control-plane/`. **An Action reaches them, so `0044`'s blocker never applied**,
> and the set belongs beside `business-read-v1`, which is already Action-class over the same tables.

**Why this is worth its own note rather than a correction:** a stale absence claim is *a fact that
became false*. **This was false when written, about a thing that did not exist**, and nothing could
have gone red — there was no artifact to disagree with it. **An absence list invites a claim about
the missing thing, and nobody checks a claim about something nobody has built.**

**And getting it wrong would not have been filing.** A tenant-admin `organization-structure` would
have asked Core for a control-plane port it does not need and **would have been unreachable by every
App** — where an Action is reachable by the Customer Directory, which files records into those very
Businesses. **A capability decision made by a filing mistake.**

### 4b. THE DASHBOARD IS REFUSED AS A ROUTE — the client composes

**A dashboard endpoint would be one route returning member count, Business count, pending
invitations, usage and lifecycle state. Under `security.md` §2a each of those counts belongs with
the list it counts, under that list's permission — so the route's permission would be a CONJUNCTION
OF FIVE.**

> **Under `0007` D16 a tenant may mint a role holding any subset, so most roles would satisfy none
> of it and the whole screen would return `forbidden` because one tile was not permitted.**
> A conjunction is the right mechanism for *one* aggregate reaching past *one* enumeration right.
> **Five of them is a route nobody can call.**

**The alternative — a partial response with permitted tiles filled and the rest null — is worse: it
makes one route return different shapes to different callers, and a client cannot distinguish
*"you may not see this"* from *"this is zero"*, which on a quota tile is the difference between
reassurance and a warning.**

**So the dashboard is a CLIENT COMPOSITION over routes that already exist**, each gated by its own
permission, each failing independently. A tile the caller may not see is a tile that is not
rendered — decided by the client from a `forbidden` it can attribute.

**What that costs, stated rather than hidden:** five round trips on a screen that wants one, on a
free tier where reads are metered. **It is the right trade because the failure mode of the
alternative is a blank dashboard**, and because `tenant-usage-v1`'s read is the expensive one and a
client can choose not to load it. **Recorded as a refusal with its reason rather than as an unwritten
set** — an unexplained absence here is exactly the gap the next author closes by publishing the
five-conjunct route.

- **Organization archive, as distinct from deletion, is genuinely absent and is not merely
  unwritten.** `tenant-lifecycle-v1` covers request-deletion and its cancellation;
  `core.business.archive` and `core.branch.archive` cover containers *inside* an Organization.
  **Nothing archives an Organization, no permission gates it, and no table holds the state** —
  which is a gap in the brief's coverage rather than in this directory's, and it is named here so
  the next reader does not conclude deletion-request is it.

- **Organization audit already has a contract** — `core/audit/audit-read-v1`, `proposed`, the
  customer's view of their own trail including what the platform did to them. **It is Action-class
  today.** Whether it moves to this class is a real question this directory does not settle, and
  nothing here duplicates it.

- **Invitation ACCEPTANCE is not in this class and cannot be.** See `tenant-invitations-v1`
  → `theAcceptanceRefusal`. An invitee is not yet a member, so **no tenant resolves for them from
  the authenticated context** — the class's defining property refuses the route. It is named as
  owed rather than folded in somewhere it does not belong.

---

## 5. Dependencies — read before reporting anything here as unblocking

**None of these is closed by this directory and none can be.**

| | |
|---|---|
| **A REGISTERED ROUTE in this class** | Core's. `0044` §4 sequences it after the record. **Measured 2026-09-13: `platform/core/tenant-admin/` holds seven modules — routes, permissions, authority, audit, owner-immunity, membership-administration, composition — and NOT ONE ROUTE ID LITERAL.** So the machinery is being built and the registry is empty, which are different states: *"the class does not exist"* is the wrong claim and *"nothing is reachable"* is the right one. **Every route id this directory publishes is `UNREGISTERED` to `check:request-class` — unchecked, not agreed** (`workflow.md` §11a: contracts may lead implementation, and a declaration about a route that does not exist cannot be falsified by anything). |
| **The tenant-admin confirmation challenge route** | Does not exist. §2.4. Every `critical` operation here is unreachable on arrival. |
| **The `invitation` table and the `admin` role** | `0043` §7: both are migrations, **and a migration is the user's, every time** (`security.md` §7). Contracts may be authored ahead of them; **nothing may report the capability as available.** |
| **EVERY permission this directory declares** | **Measured 2026-09-13: 21 distinct permissions declared across these contracts; Core's four seed roles grant 8 in total; 21 OF 21 ARE UNGRANTED.** So **no operation here is reachable on a grant**, and a contract claiming otherwise about any single route is wrong — the directory is uniform. `security.md` §8-0: **a catalogue role list is a DECLARATION; `roles.ts` is the grant**, and every `GRANTED BY THE USER` marker in this repository is on `platform-admin`. `security-agent` reviews before integration; only the user grants. |
| **⚠ "cannot hold the permission" and "cannot satisfy this route" are DIFFERENT CLAIMS** | Added after getting it wrong. `core.session.list` is `[organization, own]`; **`platform/core/authorization/scope.ts` ranks `own` at 5 and `implies(g,r)` is `RANK[g] <= RANK[r]`, so `implies('business','own')` is TRUE** — a business-scope role CAN hold it, at `own`. What it cannot do is satisfy a route requiring `organization`. **The first claim would justify removing a permission from a role; only the second is true, and `registry-coherence.ts`'s CHECK 1 correctly declines to flag that pair** — so the false mechanism would have made a sound check look like it had a gap. **Check `implies` before asserting a scope makes something unholdable; it is one function.** |
| **`scripts/lib/request-class.mjs`** | Root tooling, the Team Lead's. It holds a **frozen four-class vocabulary** and `check:request-class` **refuses an unknown class rather than ignoring it** — so every contract in this directory fails that check until `tenant-admin` is added there. The generator's copy is updated; **`architecture-agent` cannot reach the other one.** |

### 5a. ⚠ FOUR ESCALATION PATHS IN THIS DIRECTORY REST ON `0007` D16 CONSTRAINT 1, AND NOBODY HAS FOUND IT IMPLEMENTED

**D16 constraint 1** — *a custom role may contain only permissions the creating principal itself
holds; creating a role is a grant* — is cited by these contracts as **the control**, not as an
aspiration:

| Path | Contract | What the ceiling is stopping |
|---|---|---|
| Create a role holding more than you hold | `tenant-roles-v1` | authoring authority you lack |
| Edit a role and PRESERVE a grant you lack | `tenant-roles-v1` | the delta reading — preserving is granting |
| Assign a role holding more than you hold | `tenant-roles-v1` | handing out authority you lack |
| **Invite into a role holding more than you hold** | `tenant-invitations-v1` | **privilege escalation that looks like onboarding: invite an account with a role you may not hold, then sign in as it** |

> **`security-agent` found the constraint STATED in contracts and DISCUSSED in comments, and found
> no subset check in `platform/core/tenant-admin/**`.** That is one agent's search and not a proof
> of absence — but **the burden is the other way round for a control four paths depend on.**

**If it is unimplemented, these four are open, and the contracts assert a mitigation that does not
run** — `architecture.md` §3c's reader half, at the level of a control rather than a citation: an
implementer who reads *"the ceiling refuses this"* correctly stops looking, and is right to.

**Two things follow, and only the second is anybody's to act on here:**

- **The question is `core-agent`'s and stands on its own.** `tenant-admin-permissions.ts` relies on
  constraint 1 to keep its static reachability check sound, so the answer decides more than these
  four paths.
- **HIGH-2 no longer depends on it, and that is worth separating.** `core.membership.set-role`
  declares `scopes: [organization]`, so a business-scope role cannot hold it **whatever the ceiling
  does**. That repair is structural and independent — **which is the argument for preferring a
  declaration over a check whenever both are available.**

**Recorded here rather than in each contract** so the dependency is one statement with four
citations rather than four restatements with none (`workflow.md` §12).

**The honest statement of what this directory delivers:** the contract gap, and not the data gap.
Both clients get one agreed shape for Organization administration. **No screen here can render
against a live Core until the class's registry exists**, and saying otherwise would be rounding a
construction up to a capability.
