# 0006 — Tenancy model: the physical placement of tenant data

- **Status:** **Accepted** — for the Zero-Cost MVP only, while
  `docs/decisions/0008-zero-cost-mvp-infrastructure.md` remains active
- **Date:** 2026-09-01
- **Deciders:** **User** (explicit written decision, 2026-09-01), Dudo Team Lead
- **Owning agent:** Team Lead records. Analysis drafted by `architecture-agent` under
  `docs/decisions/README.md` ("Agents propose; the Team Lead records").

## 0. The decision

**Option A — one shared production D1 database — with mandatory indirection.**

This is an **MVP decision, not a permanent architecture promise.** It holds while `0008`'s
zero-cost constraint is active and is expected to be revisited, not defended.

### 0.1 Physical model

- **One shared production D1 database** for Organization business data.
- **`tenant_id` is mandatory** on every tenant-owned row, query, command, event, cache key,
  job, export, and object path.
- **Organization** is the product and UI term; **tenant** is the security and persistence
  boundary. They are the same thing in two vocabularies (`0005`-era user decision).
- **Files, attachments, and large exports belong in R2 Standard, not D1.** D1's 500 MB
  ceiling is for structured business data; putting blobs there converts a storage problem
  into an outage.

### 0.2 Mandatory indirection — `TenantStoreResolver`

The architecture contract for a **server-controlled `TenantStoreResolver`** is implemented
from the beginning. For MVP every Organization resolves to the same production binding —
the indirection exists even though it currently has one answer.

- **Apps, plugins, Connectors, and clients cannot select a database or binding.**
- **Unknown Organization mappings fail closed.**
- The resolver returns **only bindings configured and approved by Core**.
- **Business services never touch D1 directly.** They use the storage boundary.
- **Moving from A to C must not change business-domain code or public contracts.**

> **This resolves MAJ-21.** The indirection was previously asserted as "non-negotiable"
> inside a standard without a decision behind it, which was a process defect. It is now
> **explicitly user-approved** and binding by decision rather than by assertion.

### 0.3 Free-tier database allocation budget

The Free tier allows **10 databases per account** (verified 2026-09-01,
`developers.cloudflare.com/d1/platform/limits/`). Initial allocation:

| # | Purpose |
|---|---|
| 1 | Production control-plane / tenant directory |
| 2 | Production shared tenant-data database |
| 3 | Combined staging database |
| 4 | Reserved migration / recovery database |
| 5–10 | **Unallocated** — emergency growth reserve |

**Local development and CI consume no remote slots.** Verified against Cloudflare's
local-development documentation on 2026-09-01: `wrangler dev` defaults to **local mode**
powered by Miniflare, persists to local disk, and does not access remote D1. Targeting the
production database requires explicitly setting `"remote": true` in the binding
configuration. **Local development must not set it.**

**No cloud resource is created by this record.** This is an allocation budget, not
deployment approval.

### 0.4 Capacity protection

The production shared database has a **500 MB** Free-tier ceiling.

| Threshold | Action |
|---|---|
| **70%** | Warning and capacity review |
| **85%** | **Stop onboarding new Organizations**; stop non-essential and background growth |
| **90%** | Emergency capacity gate — preserve remaining headroom for essential operations for existing customers |

**Never delete financial, audit, or customer data merely to remain free.** If the choice is
between a charge and destroying a customer's records, it is not a choice: stop onboarding,
degrade non-essential service, and escalate to the user.

Before admitting external MVP Organizations:

1. Validate storage estimates against the two architecture-validation applications
   (`ARCHITECTURE_VALIDATION_STANDARD.md`).
2. Measure representative row sizes and audit/event growth.
3. Define a defensible initial Organization limit.
4. **If no evidence exists, default to a closed beta of at most 10 Organizations.**

### 0.5 Why not B, and why C is deferred

**Option B (database per tenant) is excluded during the Zero-Cost MVP.** Ten databases
total, minus the four allocated above, leaves six — so B supports at most six tenants
before exhausting the account. It is not a product. B also carries the unresolved binding
question in §4.4: D1 bindings are declared statically and `0003` forbids REST, so B may not
be implementable on the approved stack at all.

**Option C remains the approved migration candidate, not the current model.** Reconsider it
when: the shared database reaches the capacity thresholds; noisy-neighbour evidence
appears; restore or deletion requirements cannot be met safely; the user approves Workers
Paid; or free-tier capacity or product limits change.

**No migration and no paid-plan activation is automatic. Both require user approval.**

### 0.6 Why the earlier recommendation was invalidated

§6 below recommends Option C. **That recommendation was computed against the Workers Paid
allowance** — 10 GB per database and 50,000 databases — and does not survive `0008`. The
applicable Free ceiling is **500 MB and 10 databases**: a 20× smaller database and a
5,000× smaller count. Under that budget C spends the same scarce ten databases on shards
without buying B's isolation, while A spends one.

**§1–§9 below are preserved as the original analysis.** They are the reasoning that led
here, and their paid-tier figures are left intact and clearly labelled rather than
rewritten, so the record shows what was believed and why it changed. **Where §6 and §0
disagree, §0 governs.**

### 0.7 Consequences

- The 500 MB ceiling is now a **product constraint**, not just an infrastructure one. It
  bounds how many Organizations Dudo can serve before a decision is forced.
- Isolation is enforced **entirely in code** — every query carries `tenant_id`, and a single
  missing predicate is a breach. `TESTING_STANDARD.md`'s canonical isolation test is
  therefore not optional and cannot only sample.
- Per-tenant restore is **effectively unavailable** under A. Customers will eventually ask
  for it by name; that is a known, accepted MVP limitation and a migration trigger.
- Noisy neighbours are **structural**: D1 is single-threaded per database, so one
  Organization's heavy query is every Organization's latency.
- The indirection makes A → C a migration rather than a rewrite. **That is the whole point
  of paying for it now.**

> **⚠ SUPERSEDED — written while this record was Proposed.** It read: *"This record selects
> nothing … Nothing in the repository may treat any option here as adopted while this record
> reads `Proposed`."* That is no longer true. The user decided on 2026-09-01 and **§0
> governs**: Option A with mandatory indirection, for the Zero-Cost MVP while `0008` is
> active. Preserved so the record shows its own history.

---

## 0.8 How to read the rest of this record

**§0 is the decision. §1–§9 are the analysis that produced it, preserved unaltered.**

Two things to carry while reading them:

1. **Their D1 figures are the Workers Paid allowance** — 10 GB per database, 50,000
   databases. The applicable Free ceiling is **500 MB and 10 databases** (`0008`). Where a
   paid figure appears below without a marker, this paragraph is its marker.
2. **§6's recommendation of Option C is superseded**, and **§8 asserts that the standards
   state the tenancy model as undecided "and should stay that way"** — also superseded, and
   now the opposite of the requirement: the standards were updated to state the decision.

Where §1–§9 and §0 disagree, **§0 governs.**

---

## 1. Context

### 1.1 What is already settled

| Settled | Where | Note |
|---|---|---|
| TypeScript on Cloudflare; Workers, D1, R2, Queues, Workflows, and Durable Objects where real coordination is needed | `0003` (Accepted) | Nothing else is approved |
| Bindings, not Cloudflare REST APIs, from a Worker | `0003` (Accepted) | This constrains B and C materially — see §4.4 |
| Every Cloudflare service stays replaceable behind a Core-owned port | `0003` constraint 2 (Accepted) | Holds under all three options |
| **The tenant is the Organization** | `MULTITENANCY_STANDARD.md` §2 | The Team Lead reports this as confirmed by the user. This record takes it as given and does not re-open it. `business_id` is an authorization scope inside a tenant, never an isolation boundary |
| Every operation is tenant aware; cross-tenant access is a critical defect | `CONSTITUTION.md` Rule 10, `MULTITENANCY_STANDARD.md` | Not affected by this decision |

### 1.2 What is not settled, and is what this record is for

**Where a tenant's rows physically live.** One database for everyone, one database each, or
something in between. `MULTITENANCY_STANDARD.md` §7 presents the options and explicitly
decides nothing; `0003` lists the tenancy model under "Open, and not decided here";
`docs/decisions/README.md` lists it under "Scheduled but not yet written".

### 1.3 Why it cannot be deferred much longer

Three things wait on it: the first schema (there is no `phase: 1` table shape until the
placement is known), the migration runner (`CLOUDFLARE_STANDARD.md` CF5 — a runner for one
database and a runner for N databases are different programs), and the isolation test
harness (`TESTING_STANDARD.md` TS2 — provisioning two tenants means different things under
each option).

### 1.4 The constraint that makes this hard

From `0003`, verified against Cloudflare's published limits at the time that record was
written:

| D1 property | Value | Consequence for this decision |
|---|---|---|
| Concurrency | **Single-threaded per database** | Tenants sharing a database queue behind each other. There is no query planner or connection pool to soften it |
| Throughput | **~1,000 queries/second at 1 ms per query** | A *per-database* ceiling, and a hard one |
| Size | **10 GB per database** | A shared database has a tenant count beyond which it cannot grow |
| Count | **50,000 databases** on Workers Paid; more on request | Database-per-tenant is supported at real scale, but not without limit |

The master build plan §14 says "initial deployments can use shared D1 databases with strict
tenant isolation." That sentence is in tension with the threading model above and should
not be adopted on the plan's authority alone — `CONSTITUTION.md` §1 ranks the plan at 6,
below an accepted ADR.

---

## 2. The three options, defined exactly

**State the mapping plainly, because everything below depends on it:**

| Letter | Model | One sentence |
|---|---|---|
| **A** | **Shared database** | **One** D1 database holds **every** tenant's rows; `tenant_id` is a column on every table and every query carries a predicate on it |
| **B** | **Database per tenant** | **One D1 database per Organization**; a tenant's rows exist only in its own database and `tenant_id` is redundant within it |
| **C** | **Pooled shards, promotable to dedicated** | **Many** D1 databases, each holding **many** tenants (a shard); a tenant is promoted to a database of its own on size, load, or plan — so C is A within a shard and B after promotion |

### 2.1 Option A — shared database, row-level isolation

One D1 database for all tenant data. Every tenant-scoped table carries a `tenant_id`
column. Every read and write carries a predicate on it, applied by the storage port rather
than written by hand in each query. Isolation is a property of every query in the system.

### 2.2 Option B — database per Organization

One D1 database per Organization, created at signup. Tables carry no `tenant_id` because
the database *is* the tenant. Isolation is a property of handle resolution: a principal in
tenant A is never handed tenant B's handle, and if that holds, no query can leak regardless
of how it is written.

### 2.3 Option C — pooled shards with promotion

*N* shard databases, each hosting many tenants with `tenant_id` predicates exactly as in A.
A tenant that outgrows its shard — by storage, by query rate, or by buying a plan that
promises it — is migrated to a database of its own and thereafter behaves exactly as in B.
Both modes are live simultaneously and permanently.

**A fourth option was considered and is not carried forward:** schema-per-tenant. D1 is
SQLite; SQLite has no schema namespace of the kind Postgres offers, so this is not
available on the approved stack.

---

## 3. Common to all three, and therefore not a differentiator

Listed so the comparison is not credited to one option for something all three get:

- The Core-owned storage port (`0003` constraint 2). Domain code asks the port for a
  handle; no domain module holds a `D1Database` type.
- Tenant identity derived from the authenticated server context, never from the caller
  (`MULTITENANCY_STANDARD.md` §3).
- `not_found`, never `forbidden`, on a cross-tenant access (`API_STANDARD.md` §8).
- Platform-owned data (App registry, marketplace listings, plans) is tenant-independent and
  lives in its own database, separate from tenant data, under every option.
- R2 keys prefixed `t/<tenant_id>/<app_id>/` and cache keys prefixed `t:<tenant_id>:`.
  Object and cache isolation is unaffected by database placement.
- Apps × tenants storage units (`ARCHITECTURE.md` A4) — an App's data is App-owned and
  tenant-scoped under every option; only its physical home changes.

---

## 4. Comparison

### 4.1 Database topology

| | **A — shared** | **B — per tenant** | **C — pooled shards** |
|---|---|---|---|
| Tenant databases | 1 | N (= tenant count) | S shards + P promoted, S ≪ N |
| `tenant_id` column | On every tenant-scoped table | Absent from tenant databases | On every table in a shard; redundant in a promoted database, but **kept** so promotion is a copy rather than a schema change |
| Ceiling reached at | 10 GB total, or ~1,000 q/s total | 50,000 databases (raisable on request) | 10 GB / ~1,000 q/s **per shard**, and 50,000 databases overall |

The row that matters: under A the throughput ceiling is **shared by the whole customer
base**; under C it is shared by a shard; under B it is per tenant.

### 4.2 Tenant routing mechanism

- **A** — no routing. One handle, obtained from the port. The port applies the `tenant_id`
  predicate.
- **B** — the port resolves tenant → database identifier through a Core-owned directory
  (one row per tenant), then obtains that database's handle. The directory becomes an
  isolation boundary in its own right.
- **C** — same directory as B, resolving to either a shard identifier or a dedicated
  database identifier, plus a promotion state so that a tenant mid-migration is routed
  deterministically (see §4.6).

**Where the directory lives.** In Core's own database — not KV, which is not approved
(`CLOUDFLARE_STANDARD.md` CF2). This adds one lookup per request to the critical path of
every tenant request under B and C. In-request caching only; a cached routing entry that
outlives a promotion routes a tenant to stale data, so the cache lifetime is one request
unless an explicit invalidation contract is designed.

### 4.3 Isolation strength

| | **A** | **B** | **C** |
|---|---|---|---|
| What prevents a leak | A predicate on every query, applied centrally by the port | Handle resolution — the wrong data is not reachable at all | Both, in different modes |
| Failure mode | One query path that bypasses the port | One wrong row in the tenant directory, or a cached handle reused across requests | Either of the above, plus promotion |
| Blast radius of the failure | Potentially the entire customer base | The two tenants involved in the misrouting | A shard, or two tenants |
| Honest ranking | Weakest | Strongest | Between, and closer to B once shards are small |

**The important asymmetry:** under A, isolation depends on code being correct everywhere,
forever, including in every App written by a third party. Under B it depends on one
component being correct. Both can be got right; one has a far smaller surface.

### 4.4 D1 binding mechanism, and the practical binding limit

**This is the single most load-bearing unverified question in this record, and it may
decide the answer on its own.**

What is established: a Worker reaches D1 through a **binding declared in the Worker's
configuration**, resolved at deploy time, and read as `env.<BINDING_NAME>`. `0003` forbids
reaching D1 by calling Cloudflare's REST API from a Worker ("Bindings, not REST"), so
"just call the D1 HTTP API with a database id" is **not an available answer** under the
accepted stack.

The consequence:

- **A** — one binding. No question to answer.
- **B** — needs one binding per tenant database, which does not scale: bindings are
  declared statically, and a Worker cannot be redeployed on every signup. Two ways out are
  conceivable, and **neither is verified or approved**:
  1. a Cloudflare mechanism for obtaining a D1 handle by database id at runtime, if one
     exists on the current platform;
  2. per-tenant storage in **Durable Objects with SQLite storage** instead of D1 — DO is
     approved, but only "where real coordination or serialized state is genuinely needed"
     (`0003`), which is a different justification from "we need dynamic storage handles",
     and DO storage limits are unverified here.
- **C** — needs one binding per **shard**. Shards are few, change rarely, and are added by
  a deliberate operational act, so a static binding list is workable. **Promoted** tenants
  hit exactly the same problem as B, but for a small and slow-growing set — which is why C
  can begin without answering the question and B cannot.

**Verification obligation, before this record can be accepted:** confirm against
Cloudflare's current documentation (a) whether a Worker can obtain a D1 handle for a
database chosen at runtime without using the REST API, and (b) the maximum number of
bindings a Worker may declare. `CLOUDFLARE_STANDARD.md` §10 forbids quoting an unverified
number and this record honours that: **no binding-count limit is stated here because none
has been verified.** If (a) is "no", **Option B is not implementable on the approved stack
as it stands**, and choosing B means also approving a new mechanism.

### 4.5 Provisioning and migrations

| | **A** | **B** | **C** |
|---|---|---|---|
| Signup path | Insert rows. Nothing to provision | **Create a database, run every migration, seed it** — before the user can proceed, or behind an async "workspace is being prepared" state | Insert rows into an assigned shard; assignment is a directory write |
| Signup latency | None added | Real, and on the conversion path. Almost certainly a Workflow (`0003`) with a visible pending state | None added |
| Migration run | One database, one transaction-shaped unit | **N databases**, partial failure expected and normal: some tenants migrated, some not, indefinitely | S + P databases; same problem as B but S+P ≪ N |
| Version skew | Impossible | Structural — code must tolerate tenants on the previous schema version | Structural, bounded |
| Rollback | One database | Per database, and a half-rolled-back estate is a real state | Per shard |

`CLOUDFLARE_STANDARD.md` §4.8 already requires migrations to be designed for N databases
with partial-failure handling, which is a requirement under B and C and not under A. There
is no migration runner yet (CF5), so this is work that has not started under any option.

### 4.6 Backup and per-tenant restore

| | **A** | **B** | **C** |
|---|---|---|---|
| Restore one tenant to a point in time | **Effectively impossible** without restoring the whole database and reconciling, which touches every other tenant | Native: restore that tenant's database | Native for promoted tenants; **as bad as A within a shard** |
| Restore blast radius | Every tenant | One | A shard |
| A tenant asks "can you undo yesterday?" | "No" — and this is a commercial answer, not only a technical one | "Yes" | "It depends which tenant you are", which is worse to explain than either |

`MULTITENANCY_STANDARD.md` §6 already says: if the chosen model cannot restore a single
tenant, the decision must accept that consequence explicitly rather than discover it during
an incident. **Under A, and within C's shards, it must be accepted explicitly.**

Tenant *deletion* is the mirror image: under B, dropping the database is most of the work;
under A and within a shard it is a delete across every table plus R2, caches, queues, and
audit, and proving completeness is the hard part.

### 4.7 Noisy neighbours

D1 is single-threaded per database. This is not a tail-latency nuance; it is the whole
performance story.

- **A** — one tenant's month-end report, bulk import, or badly-written third-party App
  query degrades **every** customer. There is no isolation mechanism available: no
  connection pool, no per-tenant query governor, no separate replica.
- **B** — contained to that tenant, absolutely. A tenant can only hurt itself.
- **C** — contained to a shard. Blast radius is a tunable: smaller shards, less exposure,
  more databases, more migration cost.

Under A the mitigations are architectural rather than infrastructural — push heavy work to
Workflows and queues, forbid unbounded queries, meter per tenant — and every one of them is
a rule that a third-party App author has to keep, which `SECURITY_STANDARD.md` §1 threat 2
tells us not to rely on.

### 4.8 Cross-tenant queries and platform reporting

Core legitimately needs platform-wide answers: how many tenants, how many installs of App
X, aggregate usage for billing and metering.

- **A** — trivial. One `GROUP BY`. This is A's genuine advantage and it should not be
  understated.
- **B** — impossible in the data path. Requires aggregates to be **pushed** out of tenant
  databases into a platform-owned store via events (`EVENT_STANDARD.md`) or a scheduled
  per-tenant roll-up job. That machinery must exist before the first metering feature.
- **C** — same as B, because a query cannot span shards either. C gets no relief from
  pooling here.

Note that `MULTITENANCY_STANDARD.md` §5 already forbids aggregates that span tenants and
contain business data. So the *only* legitimate cross-tenant queries are platform metrics —
which means B and C's roll-up machinery is required work rather than a workaround, and A's
advantage is smaller than it first appears. It is still real: under A the roll-up can be
computed, under B it must be maintained.

### 4.9 Isolation testability — what a green test actually proves

This is where the options differ most and where the difference is least visible in a
report.

| | **A** | **B** | **C** |
|---|---|---|---|
| Can the canonical test (`MULTITENANCY_STANDARD.md` §8) run? | Yes; provisioning two tenants is two inserts | Yes; needs two-database provisioning in the harness | Yes, and it must run **twice** — within a shard, and across shards |
| What does a pass prove? | **A great deal.** The failure mode is a missing predicate and that is exactly what the test detects | **Rather little.** It passes trivially — the handle cannot reach tenant B — and would stay green even if every predicate in the codebase were wrong | Depends which mode was exercised; green on pooled tenants says nothing about promoted ones |
| Where the real risk then sits | In every query, so coverage must be per-query, not per-endpoint | **In the tenant directory.** "Can a principal in tenant A obtain tenant B's handle?" is the whole question | Both, plus the promotion path |
| Test that is required and is specified nowhere today | Per-query predicate coverage | A **directory-attack test** | Promotion tests: data visible to neither or both mid-promotion; a shard-mate reading a tenant being promoted; residue left behind after promotion |

**Consequence the decision should carry explicitly:** "tenant-isolation tests pass" in
`TESTING_STANDARD.md` §8 means something materially different under B than under A, and
nobody reading that checklist would know it. Whichever option is chosen,
`TESTING_STANDARD.md` needs a paragraph saying what the isolation test proves *under the
chosen model* — otherwise the gate produces false assurance, which is worse than no
assurance.

### 4.10 Operational complexity

| | **A** | **B** | **C** |
|---|---|---|---|
| Components that must exist before Phase 1 | Storage port | Port, directory, provisioning workflow, N-database migration runner, roll-up pipeline | Port, directory, shard assignment, N-database migration runner, roll-up pipeline, promotion pipeline |
| Operational modes to run and test | 1 | 1 | **2, permanently** |
| Failure states an operator must recognise | Few | Partial migration; orphaned database; directory/database drift | All of B's, plus stuck or partial promotion |
| Honest ranking | Simplest | Middle | **Most complex** |

C's cost is not the shards; it is the promotion path, which is a live data migration of a
paying customer's database, and it must be exercised routinely or it will not work when it
matters.

### 4.11 Local development and CI

- **A** — one local D1, one seed script. Simplest by a wide margin, and this compounds
  daily across the whole team.
- **B** — the harness must create and migrate a database per test tenant, and tear it down.
  Slower per test, and the CI runner needs the same dynamic-handle mechanism §4.4 says is
  unverified — so **the same open question blocks the test harness, not only production.**
- **C** — needs A's setup, B's setup, and a promotion trigger, because both modes must be
  exercised.

`TESTING_STANDARD.md` TS1 records that **no test framework is approved**, so none of this
harness can be written yet under any option. That is a separate blocker and this record
does not resolve it.

### 4.12 Escape and migration path between models

| From → to | Feasibility |
|---|---|
| **A → C** | Feasible. Add shards, assign new tenants to new shards, move existing ones on a schedule. The `tenant_id` column is already there |
| **A → B** | Feasible but large: a per-tenant extract from a shared database, for every tenant, with cutover |
| **C → B** | The smallest move of all — promotion applied to everybody. C is A and B at once, so it is already both exits |
| **C → A** | Feasible and pointless; nobody consolidates |
| **B → A or C** | Feasible; merging databases is mechanical, and `tenant_id` must be reintroduced |

**The single point on which every option agrees:** the exits above are only available if
domain code never learns the physical layout. That is the storage port, and it is already
required by `0003` constraint 2. **The port is not part of this decision** — it is binding
now, under all three options, and it is what keeps this decision reversible.

### 4.13 Unapproved Cloudflare services

**Direct answer to the question: none of A, B, or C requires Workers for Platforms.**
Workers for Platforms concerns executing untrusted *code* (master plan §12, Phase 7); this
decision concerns where *data* sits. They are independent.

Other unapproved services, per option:

| Option | Needs anything unapproved? |
|---|---|
| **A** | **No.** Workers + D1 only |
| **B** | **Possibly yes, and this is unresolved.** If no binding-by-id mechanism exists (§4.4), B needs either the D1 REST API (forbidden by `0003`) or Durable Object SQLite storage as the per-tenant store (approved only for genuine coordination needs, so it would need its own record) |
| **C** | **No, to start.** Shards are statically bound. The promotion path inherits B's question, but not before the first promotion |

KV is not approved (CF2), so no option may cache the tenant directory in KV. Analytics
Engine is not approved (CF3), so the roll-up store under B and C is D1.

### 4.14 Cost

**I cannot compute these figures and I will not invent them.** `CLOUDFLARE_STANDARD.md` §10
forbids quoting an unverified number, and D1 and Workers pricing must be read from
Cloudflare's current pricing page at the time of the decision. What follows is the *shape*
of the answer and the questions that determine it.

**What is the same under all three options** — and it is most of the bill: total rows read,
rows written, and gigabytes stored are driven by what the product does, not by how the data
is split. Splitting the same rows across more databases does not create more rows.

**What differs, and the questions that decide it:**

| Cost driver | A | B | C | The question to answer against Cloudflare's pricing |
|---|---|---|---|---|
| Any per-database charge or minimum | 1 | N | S + P | **The decisive one.** If D1 bills purely on usage with no per-database floor, B's cost at 50,000 tenants is close to A's. If there is any per-database floor, B's cost is that floor × N and the curves diverge sharply |
| Storage overhead per database | None | Per-database fixed overhead × N (schema, indexes, page allocation), which dominates for very small tenants | × (S + P) | Is D1 storage billed on actual bytes, and what does an empty migrated database occupy? |
| Reads added by routing | 0 | 1 directory lookup per request | 1 per request | Priced as ordinary D1 reads; volume = request volume |
| Roll-up pipeline | Not needed | Queue messages + writes, ongoing | Same as B | Queues and D1 writes at platform scale |
| Provisioning | 0 | 1 Workflow run + full migration per signup | 0 | Workflow invocations at signup rate |
| Migration runs | 1 database per release | N databases per release | S + P per release | Reads/writes × database count × release frequency |

**At the four scales asked for, qualitatively:**

- **MVP (tens of Organizations)** — the difference is **negligible under all three**. Cost
  is not a reason to choose any option at this scale. Engineering time is the real cost,
  and there A is cheapest and C most expensive.
- **1,000 Organizations** — A is probably at or past its 10 GB and ~1,000 q/s ceiling
  depending on data volume per tenant, so the honest comparison is no longer A vs B on
  cost; it is B vs C, and they are close.
- **10,000** — A is not viable regardless of cost. B vs C turns entirely on the
  per-database question above and on 10,000 × per-release migration runs.
- **50,000** — B is at Cloudflare's stated database ceiling and needs a conversation with
  Cloudflare to go further. C stays well below it. Migration cost under B (50,000 database
  runs per release) becomes an operational cost as much as a monetary one.

**Before this record is accepted, someone must read the current D1 pricing page and fill in
the per-database question.** Everything else in the cost picture is second-order.

---

## 5. Decision matrix

Scored for Dudo specifically. **This is a summary of §4, not a substitute for it** — a
matrix flattens the one thing that matters most (§4.4, the binding mechanism) into a single
cell.

| Dimension | **A — shared database** | **B — database per tenant** | **C — pooled shards** |
|---|---|---|---|
| Isolation strength | Weak — every query | **Strongest — by construction** | Strong within a shard |
| Isolation test value | **High** | Low (passes trivially) | Mixed; two modes |
| Noisy neighbour | **Structural, global** | **None** | Shard-bounded |
| Throughput headroom | ~1,000 q/s total | **Per tenant** | Per shard |
| 10 GB ceiling | Global | **Per tenant** | Per shard |
| Per-tenant restore | **Effectively impossible** | **Native** | Only for promoted tenants |
| Tenant deletion | Hard to prove complete | **Drop the database** | Hard within a shard |
| Cross-tenant platform reporting | **Trivial** | Needs a roll-up pipeline | Needs a roll-up pipeline |
| Provisioning on signup | **Nothing** | Database + migrations, on the conversion path | **Nothing** |
| Migration operations | **1 database** | N databases, partial failure normal | S + P databases |
| Binding mechanism | **Solved** | **Unresolved — may not be implementable on the approved stack** | Solved for shards; deferred for promotions |
| Unapproved services needed | **None** | Possibly (§4.13) | **None to start** |
| Local dev / CI | **Simplest** | Slowest; blocked on the same open question | Both harnesses needed |
| Operational complexity | **Lowest** | Middle | **Highest — two permanent modes** |
| Escape path | To C easily | To A/C mechanically | **Already both** |
| Cost at MVP | Equal | Equal | Equal |
| Cost at 1,000 | Likely past its ceiling | Turns on the per-database question | Turns on the per-database question |
| Cost at 10,000 | Not viable | Turns on the per-database question | Competitive |
| Cost at 50,000 | Not viable | At Cloudflare's stated ceiling | **Comfortable** |

**Read the matrix this way:** A wins on simplicity and platform reporting and loses on
every property that involves one customer's data or one customer's load. B wins on every
isolation and blast-radius property and carries one unresolved implementability question. C
buys most of B's properties without B's open question, and pays in permanent operational
complexity.

---

## 6. Recommendation — SUPERSEDED by §0

> **⚠ This recommendation is superseded.** It was computed against the Workers **Paid**
> allowance and did not survive `0008`'s zero-cost constraint. The accepted decision is
> **Option A with mandatory indirection** — see **§0**. Preserved unaltered as the record
> of what was recommended and why it changed.

**Recommended: Option C, pooled shards with promotion, with shards deliberately small.**

The reasoning, stated so it can be argued with:

1. **A is a ceiling, not a starting point.** D1's single thread per database means A does
   not degrade gracefully — one tenant's report is everyone's outage — and per-tenant
   restore, which customers will eventually ask for by name, is effectively unavailable. The
   master plan §14 recommends starting shared; the plan is rank 6 and this constraint is
   verified, so the recommendation does not follow it.
2. **B is the best architecture and has one unanswered question that could block it
   outright.** §4.4 is not a detail: if a Worker cannot obtain a D1 handle by id at runtime
   without the REST API, B is not implementable under `0003` as accepted, and choosing B
   means also approving a new mechanism (DO SQLite, or a REST exception) as part of this
   decision.
3. **C gets most of B's blast-radius properties today, with a static binding list, and
   without approving anything new.** It also keeps both exits open: C → B is promotion
   applied to everyone; C → A is consolidation nobody will want.
4. **Small shards make C converge on B.** The fewer tenants per shard, the closer the
   isolation, restore, and noisy-neighbour properties get to B's. The shard size is the
   dial and it should start small.

**The costs of this recommendation, stated plainly rather than buried:** C is the most
operationally complex of the three; it requires two permanent modes to be built, tested,
and understood; the promotion path is a live migration of a paying customer's data and will
not work when it matters unless it is exercised routinely; and within a shard the
per-tenant restore answer is still "no". A reasonable person could choose B instead — on
the grounds that isolation by construction is worth answering §4.4 for — and that would not
be a wrong decision.

**If the answer to §4.4 turns out to be that runtime handle resolution is available and
cheap, the recommendation changes to B.** That verification should happen before this
record is decided, not after.

---

## 7. What the accepted record must state

Carried forward from `MULTITENANCY_STANDARD.md` §7.4, and extended by this analysis. An
accepted version of this record answers all eleven:

1. The model — A, B, or C — and if C, the shard sizing and the promotion criteria.
2. The answer to §4.4: how a Worker obtains the right D1 handle, verified against current
   Cloudflare documentation.
3. How migrations run across N databases, including partial failure, version skew, and
   rollback.
4. Where platform-wide queries get their data, given they cannot join across tenants.
5. Per-tenant backup, restore, and deletion — including an explicit acceptance of "no
   per-tenant restore" if A or C-within-a-shard is chosen.
6. Provisioning on signup: synchronous or asynchronous, and what the user sees while it
   happens.
7. The ceiling — tenants per shard, or databases per account — and what happens when it is
   reached.
8. How App-owned data maps onto the model, given Apps × tenants storage units
   (`ARCHITECTURE.md` A4).
9. What the tenant-isolation test proves **under the chosen model** (§4.9), written into
   `TESTING_STANDARD.md` so a gate report cannot overstate it.
10. Whether the tenant directory is required, and if so its isolation test.
11. Data residency (`MULTITENANCY_STANDARD.md` MT3) — it is far cheaper to accommodate in
    the model than to retrofit, and it should be raised with the user **before** this record
    is decided, since it can eliminate A outright.

---

## 8. Consequences of leaving this Proposed

- **Phase 1 cannot start its schema.** No table shape exists until placement is known.
- The migration runner (CF5) and the isolation harness (TS2) stay unspecified.
- `MULTITENANCY_STANDARD.md` §7, `CLOUDFLARE_STANDARD.md` §4, and
  `core-object-registry.yaml` all now state the tenancy model as undecided and assume no
  outcome. That is correct and should stay that way until this record is accepted.
- The storage port (`0003` constraint 2) is binding now and is what keeps the delay cheap.
  If domain code is written against a Cloudflare binding before this is decided, the delay
  stops being cheap.

---

## 9. Approval

> **⚠ SUPERSEDED — this record is now Accepted.** The user decided on 2026-09-01: **Option
> A with mandatory indirection**, for the Zero-Cost MVP only, while `0008` is active. See
> **§0**. The text below described the record's state before that decision and is preserved
> for the history.

**Not approved. Not accepted. Status is Proposed.**

No user approval has been given for any option in this record, and `architecture-agent`
neither holds nor claims approval authority (`.claude/rules/security.md` §8). The Team Lead
records; the user decides. Until an accepted version of this record exists, no standard,
registry, schema, or line of code may assume A, B, or C.

**Unverified in this record, and required before acceptance:** the runtime D1 handle
mechanism and the per-Worker binding limit (§4.4); current D1 pricing and any per-database
charge (§4.14); Durable Object SQLite storage limits, if B via DO is considered.
