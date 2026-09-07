# 0028 — What a platform operator may see, and why a member list is not on the list

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, on `architecture-agent`'s ruling
- **Accepts:** `organization-detail-v1`, `platform-audit-read-v1`
- **Builds on:** `0024` (isolation), `0025` Decision 5 (the operator log), `0007` `CO1`
- **Owning agent:** Team Lead records. `architecture-agent` authored. `core-agent` implements.

## Context — the only field in the whole surface that tenancy did not decide

Everything else in `organization-detail-v1` is settled by the tenancy model: customer records,
counts and activity are tenant reads, and a platform route has no store handle to make one.

**A member list is different. It is structurally available** — `organization_membership` is a
control-plane table and needs no tenant handle — **so excluding it is a choice, and a choice needs
recording.**

## Decision 1 — no member list. The transpose of the permitted read is the forbidden one.

**`CO1` forbids principal → Organizations.** A member list gives Organization → principals, which
for any single Organization is a different mapping.

**But an operator is the one caller who can enumerate every Organization** — `core.organization.list`
sits in the same role, one screen away. List all Organizations, list each one's members, invert.

> **The transpose of the permitted read is the forbidden one.**

**Neither permission discloses `CO1` alone. The pair does, held by one principal, with no rule
broken at either step.** That is `0024`'s shape exactly — cross-tenant reach assembled out of
legitimate parts — and it is why `0025` chose two tables over a column: **an invariant that depends
on nobody combining two permitted things is not an invariant.**

**The baseline that settles it.** `0001_principal.sql` refused an email column outright, because
*"a directory of every user's personal details, readable without any tenant scope, would be the
highest-value target in the system."* **A member list is that directory minus the addresses,
assembled at read time.** The schema paid a keyed HMAC — and an operator who cannot answer *"which
account is sam@example.com?"* — to avoid it. **Handing it back through an admin API spends that
purchase.**

## Decision 2 — a targeted resolve replaces it, and the distinction is the rule

`POST /organizations/{id}/members/resolve` takes an identifier the operator **already holds** and
returns **one** principal id and role, or the collapsed 404.

> **An operator resolving an identifier they were given is support. An operator receiving a list
> they did not ask for by name is surveillance.**

**The structural difference:** a resolve requires the operator to know something **only the customer
could have told them.** Enumeration requires knowing only that the Organization exists — which they
read off their own home screen.

**Three properties that are not implementation details:**

- **The route declares `core.credential.reset`, not `core.organization.list`.** Revoking the reset
  grant revokes the ability to resolve people, and **a Templates-only role cannot accumulate the
  aggregation.**
- **A tenant-visible audit record on every call, including every 404.** The **probe** is what is
  recorded, not the answer.
- **The 404 collapses five cases**, the fifth being *a principal who is a platform operator* —
  without which the route is an oracle for who holds platform authority.

**Without this route, refusing the list would have left `credential-reset-v1` invocable by nobody,
which is not a security posture.** It closes `CR-3`.

**The residual, accepted not closed:** an operator with a known identifier can probe it against
every Organization. **N requests, audited in both homes, ~~visible to each victim~~, ~~rate
limited~~** — *two of these four terms are false; see the amendments of 2026-09-05* —
against a member list's one request per Organization returning everything. The attack goes from
free and silent to **linear, audited and visible.** And the honest limit: **auditing is detection,
not prevention.**

## Decision 3 — the audit read nearly undid all of the above

**A plain "read the operator log" route reintroduces the aggregation, from data Core already
writes.** Every resolve leaves *"operator X resolved principal P in Organization O"* — a membership
fact. **Read the log in bulk and those tuples aggregate into exactly the mapping Decision 1
rationed.**

**And it would have been worse than the front door**, because a bulk read names no Organization to
write a tenant-side record into: **one request, and one the tenant cannot see.** The residual in
Decision 2 rested on *N, audited, ~~visible~~, ~~rate limited~~* — a bulk read inverts every term.
*Two of those terms have since been measured false; the argument against a bulk read does not depend
on them, but see the amendments of 2026-09-05 before citing this line.*

> **The control becomes the leak** — arriving not from anyone doing anything unusual, but from the
> audit mechanism faithfully recording what it was built to record.

**Two feeds, differing in what they may disclose rather than in convenience:**

| | Scope | `target_principal_id` | Cost |
|---|---|---|---|
| **Platform feed** `GET /audit` | all Organizations | **omitted** | 2 control-plane writes |
| **Organization feed** `GET /organizations/{id}/audit` | one named Organization | **included** | 2 control-plane **+ 5 tenant** |

**The rule that generates both: principal-level targets are disclosed only when the caller names the
Organization** — the identical gate Decision 2 applies to the resolve.

**The Organization feed writes a tenant-side record on every call**, and that is the load-bearing
half: *"if a scoped read is the sanctioned path to seeing who was resolved, the tenant must see that
read happen — otherwise the scoped feed becomes the quiet way to do what the bulk feed was refused
for, one Organization at a time."*

> **The back door is closed by making it the same size as the front one, rather than by adding a
> rule that says not to use it.**

**Two routes, not one with an optional filter.** A response whose columns change with a query
parameter is one nobody can reason about — a client branches, a reviewer traces which branch
produced which fields, and **the security property lives in an `if` rather than in the route table.**
Two routes put the disclosure **in the path, where a reviewer looks**, and leave the permission
splittable later if oversight is ever separated from support.

### The filter that would have reopened it

**There is no `target_principal_id` filter on the platform feed, and supplying one is refused with
`invalid_argument` rather than ignored.** Filtering by a principal and counting results discloses
that principal's Organizations **one bit at a time** — the omitted field reconstructed through a
query parameter.

> **An ignored parameter is a parameter someone will later honour.**

`actor_principal_id` **is** permitted: filtering by the operator is not a disclosure, because
operators are a known set to anyone who can read this feed at all.

### Recorded so it is not reported as a defect

**Reading an Organization's audit trail writes to that Organization's audit trail.** It terminates —
one record per read, not one per record read — but a trail contains reads of itself, and a reader
sees their own previous visits.

**No platform-wide export.** `core.audit.export` is a *tenant* exporting its own log. A platform-wide
export is a downloadable copy of every operator action against every customer, and **reading one
record and downloading the whole book are different risks.**

## Decision 4 — corrections to the Team Lead's brief, both accepted

**Workspaces are not control-plane and were never withheld — they are unreachable.**
`0002_business.sql` puts them in the tenant database with `tenant_id` as the leading primary-key
column, so every read goes through the storage boundary and **a platform route has no handle.** The
brief listed them as "arguably control-plane"; they are not arguably anything.

**Why the intuition failed, and it is worth keeping:** a Workspace *feels* like structure rather
than content — a container, not a record. **That is precisely what the tenancy model ignores. Its
name is something the customer wrote.**

**Onboarding is not a precedent for a display read**, and was refused as one: its handle exists to
**write one row into a tenant the same operation is creating**, bounded and once. A display read is
a handle for **reading a customer's data on every page load, forever.**

**And the right answer was already shipped.** The deployed console reads: *"An operator cannot reach
any tenant's data through the console. No customer, no business, no Organization contents. There is
no screen for it because there is no route for it."* **The console was correct and the Team Lead's
brief contradicted a screen it had already approved.** When a brief and shipped copy disagree, the
copy was written by someone who had to make it true.

**`member_count` is included, because a count does not invert.** Cardinality reconstructs nothing
about any principal; the aggregation needs identities. It answers what an operator legitimately asks
— did onboarding work, is this abandoned — without naming anyone. Its small leak (repeated reads
reveal *that* membership changed, never who or in which direction) is recorded rather than dismissed.

**`OD-1`, the cost:** an operator cannot verify after the fact that onboarding created a Workspace.
The information exists at creation and nowhere afterwards. **The fix is a tenant-side view, not a
platform one.**

## Amendment, 2026-09-05 — "visible to the tenant" is currently written, not readable

**Recorded the same day this was accepted, because the record overstates a control it rests on.**

Decisions 2 and 3 both lean on tenant-side audit records: the resolve writes one on every call
including 404s, and the Organization feed writes one on every read — *"the tenant must see that read
happen."* The residual was accepted as **N requests, audited, ~~tenant-visible~~, ~~rate limited~~.**
*This amendment strikes the third term. The amendment below it strikes the fourth.*

**`core.audit.read` is catalogued at organization scope and has no route.** So today the tenant-side
records are **written and unreadable**. Nothing in the product lets a customer see what the platform
did to them.

**The mechanism is sound and the visibility is not yet delivered.** Every argument above stands as
an argument — the back door is still the same size as the front door, the aggregation still costs N
audited requests — **but "visible to each victim" is a property of a route that does not exist.**
Until it does, this surface is auditable rather than audited: the evidence is captured, and the party
it protects cannot read it.

**This is deliberately not fixed by widening the platform.** The answer is a **tenant-side** audit
read, which is `PA-3` / `OD-2` and the largest gap left in this surface. A platform-side
convenience would put the customer's view of the platform's behaviour inside the platform's own
console, which is the wrong place for it by construction.

**Stated here rather than in a backlog because of what it would otherwise become:** a future reader
citing `0028` for the proposition that operator actions are visible to tenants would be quoting a
control that has never worked. **An unread audit record is detection that nobody performs.**

## Amendment, 2026-09-05 — "rate limited" is false, and the cost of a probe lands on the victim

**SECURITY FINDING, measured by `core-agent` against shipped code and against code it had written an
hour earlier.** This strikes the fourth term of Decision 2's residual. With the amendment above it,
**half the residual's terms are now false.**

### The measurement

Per call, index rows included, counted from `0001_audit_event.sql` rather than taken from a constant:

| operation | tenant row-writes | control-plane row-writes |
|---|---|---|
| `members.resolve` — **hit** | **5** | 2 |
| `members.resolve` — **refusal** | **5** | 2 |
| `organizations.audit.list` — **with results** | **5** | 2 |
| `organizations.audit.list` — **empty** | **5** | 2 |
| `audit.list` (platform feed) | **0** | 2 |

**The tenant record lands on the Organization's `business` allocation — 10,000/day — not on the
operator's control-plane budget.** The intended bound was the operator's 600: 300 calls × 5 = 1,500
row-writes, **15% of a customer's day.**

**That is not what happens. Driving the real dispatcher 2,000 times against ledgers keyed as
production keys them: 10,000 of 10,000 — one operator exhausts one named customer's entire daily
write allocation, on either route.**

### The mechanism, which is an ordering bug rather than a budgeting one

**The tenant write happens first; the operator's audit record is charged second.** Once the
operator's 600 is spent, **every further call still performs the 5 tenant row-writes and only then
fails at the audit step.** 85% of the damage lands *after* the operator's own ceiling is gone.

> **The attacker is told the call failed. The customer pays for it anyway.**

**And the customer cannot see why** — their own mutations begin failing, and `PA-3` means they
cannot read the trail that would explain it.

### The term that survives both fixes

**It does not scale per principal. It scales per operator × target.** Each operator has its own 600;
they all spend the **same** Organization's 10,000. Two operators halve the calls needed. **A taken
session is an operator.**

So the ordering fix and `PO-4` both bound the **attacker**, while the exposure is a property of the
**target**. A per-Organization sub-ceiling on platform-originated tenant writes is the only one of
the three that bounds what is actually at risk. **It is deliberately deferred** — today the operator
set is small and the realistic threat is one taken session — and it is recorded here so that nobody
has to rediscover, the day that set grows, that the other two fixes never scaled.

### Re-deriving Decision 2 rather than leaving it propped up

**`workflow.md` §12 requires this**: the argument rested on four terms and two are gone, so the
conclusion has to be re-earned rather than assumed to survive.

**It survives.** The comparison was never *resolve versus nothing* — it was **resolve versus a member
list**, and a member list is one request per Organization returning everything, silently. Linear and
audited still beats constant and silent, and the aggregation Decision 1 rationed still costs N
audited requests. **Decision 1 and Decision 2 stand.**

**What has changed is that the residual is materially weaker than when it was accepted, and it now
contains a hazard nobody contemplated at the time.** The original residual reasoned entirely about
*disclosure* — what an operator could learn. **This is availability**: the same probe, aimed at a
customer rather than at a question, breaks their product. **A cost that was assessed as a deterrent
to the attacker turned out to be a weapon against the victim.**

> **The honest sentence is the one Decision 2 already contains — auditing is detection, not
> prevention — and it is now the only term of the residual doing any work.**

## Amendment, 2026-09-05 — a confirmation challenge records that permission was sought, and not for whom

**Recorded because a reader auditing this trail will find challenges that name no principal, and the
honest reading of that is a gap rather than a bug.** Decision 3's rule is *principal-level targets
are disclosed only when the caller names the Organization.* This is the case where the caller
**cannot** name it.

`0014` added `target_organization_id` and made `organizationId` **required** on
`PlatformActionTarget`'s principal variant. That is `architecture.md` §3a's shape rather than a
convention: the omission stops being something to remember and becomes something that does not
compile, and **the compiler found exactly two call sites, which is how we know there were exactly
two.**

**The second call site had no Organization to give.** The confirmation challenge route takes no
Organization path parameter, and the operation it confirms **has not happened yet** — there is
genuinely nothing to name at the moment the record is written.

**It records `NO_TARGET`** — which is not a value invented here. `NO_TARGET` is `{kind: 'none'}`,
the existing member of the union for an operation that names nothing, already carried by every
`denied` and `failed` branch, and `platform-routes.ts` already gave this exact reason for refusals:
**the parameters naming the target are the untrusted thing.** The ruling is that the challenge's
**success** path is governed by the same principle as its refusal paths, which is the unobvious half
— a successful operation normally *does* know what it acted on.

The alternative was to satisfy the required field by reading an `organization_id` out of the
request's `parameters`, and that inverts the field's entire purpose:

> **A required field that exists to stop caller-supplied audit values, satisfied from a
> caller-supplied value, is worse than no field — it makes the forgery look like compliance.**

Concretely, it would let a caller **choose which Organization's audit feed its own challenge appears
in** — writing into a trail belonging to a customer it has nothing to do with, and doing so through
the mechanism built to make that impossible.

**What is lost, stated plainly:** a challenge records **that a critical permission was sought**, and
not **for whom**. The operation the challenge precedes records the principal in full, so the pair is
complete; the challenge alone is not. **A trail read at the moment between a challenge and its
operation will show intent without a subject.**

**Why that is the right trade rather than a temporary one.** The subject of a challenge is not yet a
fact — it is a caller's assertion about what it is about to do, and `0027`'s whole design is that a
challenge is answered rather than trusted. **Recording an unverified subject as though it were an
audited one would make the trail confidently wrong**, which is worse than a trail that is narrower
than a reader hoped.

## What this does NOT decide

- **The operators list**, and specifically whether a **revoke** route should exist where creation
  deliberately has none. `architecture-agent` established that *who is acting is not a disclosure*,
  which narrows it to that one question.
- **Break-glass access to tenant data.** Nothing here permits it, and `0024`'s invariants remain
  what any such proposal must argue against.
