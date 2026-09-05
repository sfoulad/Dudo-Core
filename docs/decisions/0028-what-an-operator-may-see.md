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
every Organization. **N requests, audited in both homes, visible to each victim, rate limited** —
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
Decision 2 rested on *N, audited, visible, rate limited* — a bulk read inverts every term.

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
happen."* The residual was accepted as **N requests, audited, tenant-visible, rate limited.**

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

## What this does NOT decide

- **The operators list**, and specifically whether a **revoke** route should exist where creation
  deliberately has none. `architecture-agent` established that *who is acting is not a disclosure*,
  which narrows it to that one question.
- **Break-glass access to tenant data.** Nothing here permits it, and `0024`'s invariants remain
  what any such proposal must argue against.
