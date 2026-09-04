# 0025 — Platform authority, Templates, and the fourth request class

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04, on the user's
  instruction to build the super-admin surface
- **Closes:** `CO4`/`AZ9` (where platform authority lives) · `CO5` (is a business type a Template) ·
  the fourth request class
- **Builds on:** `0024`'s two invariants, which are load-bearing here
- **Owning agent:** Team Lead records. `architecture-agent` contracts, `core-agent` implements.

## Context

`architecture-agent` produced the super-admin analysis and **deliberately declined to author a
contract**, because three things were undecided and *"a contract is precisely the artifact other
agents are then required to build against without re-litigating."* That was the right call. This
record settles the three so the contract can be written.

## Decision 1 — Platform authority lives in its own table, and its existence IS the authority

**`platform_operator(principal_id, platform_role, created_at)` in the control-plane database.**

A row in that table makes a principal a platform operator. There is no flag on `principal`, no
membership row, and no platform value in `MembershipRole`.

**Why a separate table rather than a column or a role:** `0024` requires that a platform principal
hold **zero membership rows**, because a membership row carrying platform authority assembles
cross-tenant access out of legitimate parts. **An invariant that depends on nobody adding a row is
not an invariant** — so the two must live in different tables, where "appears in both" is a
question a machine can ask.

**Binding, and enforced in code rather than documented:**

- **A `principal_id` present in `platform_operator` MUST NOT appear in `organization_membership`,
  and the reverse.** Checked on write, and checked at authorization. Not a constraint the schema
  can express across two tables, so it is Core's to enforce — and it must **fail closed**: a
  principal appearing in both is refused everywhere, not resolved in favour of either.
- **`MembershipRole` never gains a platform-tier value** (`0024`).
  `assertRoleMappingIsCoherent` is the home for it.

## Decision 2 — A business type IS a `Template`. No new name.

`ARCHITECTURE.md` §1 already records **Template** as the fifth extension type: *"a pre-configured
combination of Apps and settings for a business type: Salon, Dental Clinic, Gym. Carries no code"*
— followed by *"the user selects a business type, not a set of technical modules."*

**That is exactly what the user asked for.** It is a Phase 6 concept arriving five phases early,
which is a scheduling change rather than a new idea. **The five extension types are closed and a
sixth requires a Constitution amendment**, so inventing a parallel name would fork the model to
avoid reading the one that exists.

**What a Template carries in this slice:**

| | |
|---|---|
| A name | "School", "Clinic", "Retail" |
| **Display labels for each level** | so a school renders "Campus" where a shop renders "Branch" |
| *(later)* which Apps are installable | out of scope until there is a second App |

**The boundary, in `architecture-agent`'s words, and it is the whole rule:** `CORE_BOUNDARIES.md`
rule 6.1 governs **types, tables, columns, functions and routes — not rows.** *"A row reading
'Dental Clinic' is data; a `dental_clinic` column is a defect."*

**A Template may NAME Apps and CARRY labels. It may never CONTAIN logic.** The moment it carries a
workflow, a validation rule or a pricing rule, business-specific behaviour is inside Core
permanently and cannot be removed.

## Decision 3 — The fourth request class: **platform routes**

| Class | Principal | Tenant | Permission |
|---|---|---|---|
| Pre-auth (`0014` §B) | none | none | none |
| Session (`0021`) | session only | none | **none** |
| Action | full, tenant-scoped | **required** | yes |
| **Platform (this record)** | **principal-level** | **none** | **yes** |

A platform route authenticates a principal, evaluates a permission against a **platform envelope**,
and **never obtains a tenant store**.

**It is not an Action with the tenant made optional**, and `0021`'s sentence is the reason:
*"the invariant that an Action always has a tenant is worth more than the code it saves."* A
tenant-optional branch would force every future reviewer of every future Action to check which side
of it they are on.

**Binding properties:**

- **No `TenantStoreResolver` is reachable from this class.** As with `0021`'s session routes, the
  guarantee should be structural — nothing in the class *can* reach a tenant, rather than nothing
  *does*.
- **Input validation belongs to the class, not to its routes** (`0021`'s finding). A platform route
  accepts identifiers naming tenants; it must not be the one class without validation.
- **The platform envelope is Core's**, following `0023`. It is not an App's, and no App may declare
  a platform permission.
- **Every platform route writes an audit record.** These are operator actions on other people's
  data-adjacent objects; `0007` rule 9 and the four separate records of "no auditable home" make
  this the moment to stop deferring it.

## Decision 4 — the bootstrap exception to `0007` D11, declared rather than discovered

**Raised by `architecture-agent` as `PO-2`, and it is right that an exception to the rule which
makes the permission model non-escalating must not live only in a contract.**

**The tension.** `0007` D11 condition 1: *"the granting principal holds the permission it is
granting, at a scope that contains the scope of the grant. **You cannot grant what you do not
have.**"*

**Onboarding violates that on its face.** A platform operator creates an Organization's first
membership at role `owner` — which carries seven `customers.*` permissions plus
`core.business.read`. **The operator holds none of them, and could not**: it has no membership
anywhere (`0024`), and `MembershipRole` may never carry platform authority (`0024`, Decision 1
above).

**Ruling: this is a bounded bootstrap exception, and it is declared as one.**

**D11 governs delegation between tenant principals** — one member granting another, which is where
classic RBAC escalation lives. **Onboarding is not delegation: there is no principal in the
Organization yet to delegate from.** The operator is not passing on its own authority; it is
establishing the tenant's first.

**Four bounds, every one checkable in code**, because *"an unbounded exception to D11 is a hole in
the permission model wearing the word bootstrap"*:

1. **Only at Organization creation**, in the same operation that creates it. Never to an
   Organization that already exists.
2. **Exactly one membership, at exactly one role, `owner`.** Not a chosen role, not a list, and
   **not a role named in the request.**
3. **Unavailable the moment the Organization has any membership row.** From then on, adding members
   is ordinary tenant administration under D11 unchanged, performed by that Organization's own
   owner.
4. **No other platform operation may grant a tenant permission, ever.** Credential reset changes a
   credential and grants nothing; Template operations touch no tenant.

## Decision 5 — the platform-operator action log

**Raised as `PO-1`, and it blocks every route in the class**, so it is settled here rather than
deferred again.

Every platform route writes to a **platform-operator action log** in the control plane: a new
object, distinct from the tenant audit trail, recording **which operator did what, to which
Organization, when.**

**Why it cannot be the tenant audit trail.** An operator action **spans tenants by nature** — it
creates an Organization that has no audit trail yet, or resets a credential for one tenant while
belonging to none. A purely tenant-side record leaves **the platform with no account of what its own
operators did**, which is precisely the thing an operator log exists to provide.

**What it must not contain:** any tenant business data. It records the *operation and its target
identifiers*, never the contents of what was touched. This is the same discipline `0013` applied to
denial summaries and `0023`'s marker applied to failure announcements — **an operator log that
accumulates customer data is a second copy of the tenant database with weaker access rules.**

**Ordering resolves the circularity** `0014` §A.2 recorded: write `tenant_directory` first, then the
store handle resolves, then the record is written.

## Consequences

- **Onboarding costs 10 control-plane row-writes** (`0024`), not the 6 `control-plane-admission.ts`
  records. That constant is wrong in the code and must be corrected with the count of what
  onboarding actually writes.
- **The inner unit is renamed `Workspace`** per `architecture-agent`'s ruling — `Branch` was
  unavailable because it already names a level *below* it. ~~**The rename lands before onboarding and
  Templates are built**, or both are built on the old name and renamed twice.~~ **Amended below —
  the rename is not one operation, and two of its four parts are not cleanups.**
- **Free-tier impact: USD 0 / BD 0.** New control-plane tables, no new service. 300 onboardings/day
  platform-wide at the corrected cost.

## Amendment, 2026-09-05 — the `Workspace` rename is four changes, and only one of them is a rename

The consequence above told the team to land the rename before onboarding. **Acting on it would have
been wrong**, and the reason is worth recording because the instruction looked obviously correct.

**The theory I checked.** `BUSINESS_ID_COLUMN` in `tenancy/business-directory.ts` is a named
constant, which suggested the physical column name was already treated as an implementation detail
behind one seam — so the rename would be vocabulary above that line and one adapter at it.

**That is false, and the grep that disproves it is the whole amendment.** `'business_id'` is emitted
as a literal in four different roles:

| Role | Where | What renaming it costs |
|---|---|---|
| TypeScript vocabulary | ~107 files, five territories | Mechanical. A rename. |
| Physical column | `0002_business.sql` and two others | A migration against live data |
| **Published wire field** | `apps/customers/domain/validation.ts:135`, `:215` — `required: ['business_id', …]` | **A breaking change to a shipped contract, consumed by two clients** |
| **Persisted audit value** | `actions/move-customer-to-business.ts:163` — `changedFieldNames: ['business_id']` | **Rewriting audit history** |

**The last two are not cleanups.** `customer-directory-v1` is shipped and both clients consume it;
`.claude/rules/architecture.md` §1 requires a breaking contract change to go through Team Lead
review and a decision record of its own — **it does not get smuggled in as tidying during another
feature's build.** And rewriting stored audit rows to satisfy a naming preference inverts what an
audit trail is for.

### Decision

**The rename is not performed as one operation, and not during the super-admin build.**

1. **The new platform surface is written in `Workspace` terms natively** — `architecture-agent`
   already did this in all four contracts. **The hole stops getting deeper today.**
2. **The user-facing words come from Template display labels** (Decision 2 above), which is the
   mechanism already decided here and which has to exist anyway, because a school says "Campus"
   where a shop says "Branch". **This is what the user actually asked for** — the complaint was
   about words on a screen.
3. **The wire field and the column keep the name `business_id`** until a dedicated slice with its
   own record retires them through the §1 breaking-change process.

### The cost, stated rather than left to be discovered

**Dudo now has two vocabularies for one concept** — `Workspace` in the platform contracts,
`business_id` on the customer wire — and a reader has to know both. That is a real cost and it is
being accepted deliberately, not overlooked. It is smaller than a breaking change to a shipped
contract plus an audit rewrite, executed concurrently with three agents writing in the same 107
files, which is `.claude/rules/workflow.md` §2a's failure mode with a rename on top.

**The closing trigger, so this does not become permanent by silence:** the rename slice is owed
**before a second App ships a contract using the word**, because at that point the divergence stops
being one legacy contract and becomes the convention.

## What this does NOT decide

- **Break-glass access to tenant data (AZ3).** Nothing here permits a platform operator to read a
  customer's records, and `0024`'s invariants are what any such proposal must argue against.
- **The per-business-type role vocabulary** beyond display labels. `architecture-agent` established
  that three of four school roles are vocabulary and only "parent" needs new mechanism — a
  **delegation edge between two records**, recorded as `AZ10`/`CO6`, and not a role at all.
- **Self-service signup.** The console is the onboarding path; nothing here creates a public one.
