# Multi-Tenancy Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **§7 is now decided** — `docs/decisions/0006-tenancy-model.md` is **Accepted** (user decision, 2026-09-01): **Option A, one shared production D1 database, with mandatory indirection**, ~~for the Zero-Cost MVP only while `0008` is active~~ **for the current scale, while `0008` is active, and only while the indirection keeps the choice reversible** — `docs/decisions/0030` withdrew the MVP premise this line rested on; see §7.1's amendment for what replaced it. `0008` itself is untouched and every free-tier figure below still binds.
- **Authored by:** `architecture-agent`.
- **Applies to:** every data path in Dudo, without exception.
- **Depends on:** `CONSTITUTION.md` Rule 10, `SECURITY_STANDARD.md`, `CLOUDFLARE_STANDARD.md`, `docs/decisions/0006` (Accepted), `docs/decisions/0008`.
- **Source:** `CONSTITUTION.md` Rule 10; `docs/decisions/0003`, `0006`, `0008`.
- **Reconciled against the built system 2026-09-06.** §10 classifies all six open issues —
  **MT1, MT2 and MT6 closed; MT3, MT4 and MT5 still open, and all three of those need a USER
  decision, not an architecture one.** **No contradiction was found in this file**, which is
  the notable result of the pass: the rules that are hardest to hold — one central emission
  point for the tenant predicate, tenant derived only from authenticated context, a resolver
  that fails closed on an unknown Organization — are the ones the code actually implements.
  §7.1's *"for the Zero-Cost MVP only"* scoping clause is amended in place, because
  `docs/decisions/0030` withdrew the MVP premise and named `0006` as *"the pinch point"*;
  `0006` is **not** reversed and one shared database remains correct at current scale.
  **§8's non-disclosure control is still `UNVERIFIED / NOT RUN` and is still owed**, as §9's
  checklist requires — it is not a Phase 0 blocker and it **is** a blocker before any
  production release serving real tenant data.

Dudo holds other companies' invoices, payroll, contracts, and bank details. A single
cross-tenant read is not a bug report; it is the end of the product. Everything in this
document follows from that.

---

## 1. The rule

**Every operation is tenant aware.** No database query, API action, event, workflow, cache
entry, queue message, scheduled job, file path, log line, metric, or export involving
tenant data exists without tenant context.

Isolation is a property of the architecture, not a filter applied downstream. A query that
is correct only because someone remembered to add `WHERE tenant_id = ?` is one forgotten
clause away from a breach, and code review does not reliably catch a missing clause.

---

## 2. Vocabulary

The event envelope carries both `tenant_id` and `business_id` (`EVENT_STANDARD.md` §3) and
defines neither. This is the resolution `architecture-agent` recommends. ~~**It needs Team
Lead confirmation and it is load-bearing**~~ — every table, key, and index depends on it.

> **CONFIRMED, 2026-09-06 — it is decided and no longer awaits confirmation.**
> `docs/decisions/0006` (**Accepted**, user, 2026-09-01) §1.1 lists it among the things already
> settled: *"The tenant is the Organization. The Team Lead reports this as confirmed by the
> user. This record takes it as given and does not re-open it. `business_id` is an
> authorization scope inside a tenant, never an isolation boundary."* It was load-bearing and
> it bore the load: every table, key and index in both migration sets is built on it, and the
> `tenant_id` predicate has exactly one emission point
> (`platform/core/storage/adapters/sql/sql-compiler.ts:141`). **The vocabulary caveat:**
> `0025`'s 2026-09-05 amendment defers the `Business` → `Workspace` rename because
> `business_id` is *"a published wire field two clients shipped against"* and a persisted audit
> value — four changes, not one. Two vocabularies for one concept, accepted deliberately.

| Term | Meaning |
|---|---|
| **Tenant** | The **Organization**. The isolation boundary. One tenant's data is never visible to another under any circumstance. |
| **Business / Workspace** | A sub-scope *inside* a tenant. An authorization scope, **not** an isolation boundary. |
| **Branch, Team** | Narrower authorization scopes inside a Business. |
| **Platform** | Not a tenant. Platform-owned data (the App registry, marketplace listings) is tenant-independent and is stored separately, never in tenant storage. |

**Why Organization and not Business.** The Organization is the unit that signs up, pays,
owns the data, and would be the party in a data-protection complaint. Businesses inside an
Organization routinely need to share customers, reporting, and staff — so making Business
the isolation boundary would force cross-boundary access as a normal operation, which
destroys the boundary's meaning.

---

## 3. Where tenant identity comes from

**From the authenticated context, resolved on the server. Every time.**

Never from:

- a request parameter, path segment, body field, or query string;
- a header the caller controls;
- a hostname or subdomain, unless it is resolved server-side to a session that already
  belongs to that tenant;
- a JWT claim that has not been verified against the platform's own record;
- an App, a Connector, a plugin, or an SDK caller;
- an event payload field;
- an ambient default, a "current tenant" global, or the last value seen.

A principal that belongs to more than one tenant selects the active one through an
authenticated act that produces a new context. It does not pass an identifier alongside
each request.

**The runtime sets tenant context; application code reads it and never writes it.** An API
that lets application code set the tenant is an API that will eventually be called with
the wrong one.

---

## 4. The eleven carriers

Tenant context must be present in every one of these. This list is the review checklist —
a change touching any carrier is checked against it.

| # | Carrier | Requirement |
|---|---|---|
| 1 | **Database query** | Tenant scope in the query or implied by the tenant-scoped connection. Never both optional. |
| 2 | **API request** | Server-derived; see §3. |
| 3 | **Event** | `tenant_id` in the envelope, set by the runtime (`EVENT_STANDARD.md` §4). |
| 4 | **Queue message** | Carries the tenant; consumers process within it; DLQ records keep it. |
| 5 | **Workflow** | Tenant on the run and on every step; steps never widen it. |
| 6 | **Scheduled job** | Runs per tenant, or iterates tenants explicitly one at a time. A cron that queries across tenants is a cross-tenant read. |
| 7 | **Cache entry** | Key prefixed `t:<tenant_id>:`. An unprefixed cache key is a cross-tenant read waiting for a collision. |
| 8 | **File / object** | Key prefixed `t/<tenant_id>/<app_id>/`. Ownership is in the key, not only in metadata. |
| 9 | **Export / report** | Scoped, and the export itself is audited. |
| 10 | **Log line and metric** | Carries `tenant_id`; never carries another tenant's identifiers or any business data. |
| 11 | **Error message** | Carries `request_id` only. Never a tenant id, never business data, never internal structure. |

---

## 5. Access rules

- **Cross-tenant access is a critical defect wherever it appears** — including in tests,
  fixtures, seeds, migrations, logs, error messages, analytics, and support tooling.
- A cross-tenant read returns **`not_found`**, never `forbidden`. `forbidden` confirms
  existence, which is itself the leak (`API_STANDARD.md` §8).
- No aggregate spans tenants except platform-owned metrics that contain **no business
  data** — counts of tenants, not sums of their revenue.
- Platform operators do not read tenant business data without an audited, time-bounded,
  reason-required break-glass elevation (`AUTHORIZATION_STANDARD.md` AZ3).
- Identifiers are opaque and non-sequential, so that possession of one id does not imply
  the ability to guess another.

---

## 6. Data lifecycle

- **Creation** — the tenant is assigned at creation from context, and is immutable
  thereafter. There is no operation that moves a record between tenants.
- **Deletion** — deleting a tenant deletes or exports all of its data across every store:
  database, files, caches, queues, search indexes, audit (subject to retention), and
  backups per the stated retention policy. A "delete" that leaves orphaned objects in R2
  is not a delete.
- **Export** — a tenant can obtain its own data. Always audited, always scoped, never
  including another tenant's records even incidentally.
- **Backup and restore** — restoring one tenant must not restore or expose another.
  **Under the decided model (§7) per-tenant restore is effectively unavailable**, and
  `0006` §0.7 accepts that consequence explicitly. It is a known MVP limitation and a
  migration trigger, not a surprise to be discovered during an incident. D1 Time Travel
  gives a **7-day** recovery window for the whole database, not for one tenant.

---

## 7. The implementation model — DECIDED

**The tenancy model is decided.** `docs/decisions/0006-tenancy-model.md` is **Accepted** —
an explicit user decision recorded on 2026-09-01. This section states what was decided and
what follows from it. It no longer presents options; §7.9 keeps the option comparison as
**background only, clearly superseded**.

### 7.1 The decision

**Option A — one shared production D1 database — with mandatory indirection.**

This holds **for the Zero-Cost MVP only, while `docs/decisions/0008-zero-cost-mvp-infrastructure.md`
is active.** It is an MVP decision, not a permanent architecture promise, and it is
expected to be revisited rather than defended.

> **AMENDED 2026-09-06 — the scoping clause above has lost its referent, and `0030` named this
> section as the place it would.** `docs/decisions/0030` (**Accepted**, 2026-09-06) withdrew
> the MVP framing and says so about `0006` specifically:
>
> > *"The pinch point is `0006`, and it is named here rather than left to be discovered …
> > it chose one shared D1 database with mandatory indirection, explicitly 'for the Zero-Cost
> > MVP.' The MVP is now over and that premise is gone, which is `workflow.md` §12's exact
> > shape."*
>
> **`0006` is NOT reversed and this section is NOT withdrawn.** `0030`: *"One shared database
> remains correct for the current scale, and re-deciding it under a full-system premise is its
> own piece of work."* What changes is the *reason* the model is provisional, and therefore
> what is required of it:
>
> - **Was:** provisional because the MVP would end. **Now:** provisional because scale will
>   force it, and **the requirement is that the choice stays reversible.**
> - **`0008` is untouched.** Zero cost continues; `0030` explicitly does not supersede it. Every
>   free-tier figure in §7.3 through §7.5 still binds.
> - **A new binding constraint sits beside it:** *"The free tier may cost us CONFIGURATION. It
>   must never cost us SCHEMA."* `0030` names *"anything that assumes exactly one database
>   exists"* as a violation, and names *"one shared database behind an interface that does not
>   promise there is only one"* as acceptable. **That is a description of §7.2, and it promotes
>   the indirection from a decided implementation detail to the mechanism the reversibility
>   claim rests on.** Anything bypassing the storage boundary is no longer a shortcut; it is a
>   decision to make the tenancy model permanent.
>
> Read "for the Zero-Cost MVP only" as **"for the current scale, under `0008`, and only while
> the indirection keeps it reversible."** **That substitution applies to EVERY use of "MVP" in
> this document — including the status header, §6, §7.2, §7.4, §7.5, §7.7, §7.9 and the MT2 row
> in §10 — and is not repeated at each site.**
>
> **The scope sentence above originally named only §7.3, §7.5 and §7.7, and that was wrong.**
> A second pass with a varied search term — `MVP` rather than the phrasing just edited — found
> the word in eight further places, two of them outside any section the first list named and
> one of them in the **status header at the top of this file**, which is the line a reader sees
> before anything else. **The first sweep edited the body and never looked up.** Recorded
> rather than quietly widened, because a sweep whose stated scope is narrower than its subject
> is the failure mode `.claude/rules/workflow.md` §12 describes, and the correction is the
> useful half.

- **One shared production D1 database** holds every Organization's business data.
- **`tenant_id` is mandatory** on every tenant-owned row, query, command, event, cache key,
  job, export, and object path — the eleven carriers in §4, without exception.
- **Files, attachments, and large exports go to R2 Standard, not D1.** The 500 MB D1
  ceiling is for structured business data; putting blobs there converts a storage problem
  into an outage.
- **Option B (database per tenant) is excluded during the Zero-Cost MVP.** Ten databases
  total, minus the four allocated in §7.4, leaves six — six tenants is not a product.
- **Option C remains the approved migration candidate, not the current model.** No
  migration and no paid-plan activation is automatic; **both require user approval.**

### 7.2 Mandatory indirection — `TenantStoreResolver`

**This is approved and binding**, by user decision (`0006` §0.2), not by assertion in a
standard. The architecture contract for a server-controlled `TenantStoreResolver` is
implemented from the beginning. For MVP every Organization resolves to the same production
binding — the indirection exists even though it currently has exactly one answer.

- **Apps, plugins, Connectors, and clients cannot select a database or a binding.** There
  is no parameter, header, manifest field, or SDK call that chooses storage.
- **An unknown Organization mapping fails closed.** No fallback, no default database, no
  "probably the shared one".
- The resolver returns **only bindings configured and approved by Core**.
- **Business services never touch D1 directly.** They go through the storage boundary
  (`0003` constraint 2, `CLOUDFLARE_STANDARD.md` §4).
- **Moving from A to C must not change business-domain code or public contracts.** That is
  the entire reason the indirection is paid for now.

> **This resolves MAJ-21.** The indirection was previously asserted as non-negotiable
> inside a standard with no decision behind it, which was a process defect. The situation
> is now the opposite: it is **explicitly user-approved and binding by decision**.

### 7.3 The constraint, stated plainly — Free-tier figures

`0008` binds Dudo to the Cloudflare **Free** tier. These are the Free limits, verified
against `developers.cloudflare.com/d1/platform/limits/` on 2026-09-01. **No paid-tier
figure applies anywhere in this document.**

| D1 property | Free-tier value | Consequence |
|---|---|---|
| Concurrency | **Single-threaded per database** | Every Organization's every query queues behind every other's. Noisy neighbours are structural, not incidental. |
| Throughput | **~1,000 queries/second at 1 ms per query**, per database | A per-database engine property recorded in `0003`, not a tier allowance. Under one shared database it is the ceiling for the whole customer base. |
| Size | **500 MB per database** | This is a **product constraint**, not merely an infrastructure one. It bounds how many Organizations Dudo can serve before a decision is forced. |
| Total storage | **5 GB across the account** | The account ceiling, across all databases. |
| Count | **10 databases per account** | See the allocation budget in §7.4. |
| Queries per Worker invocation | **50** | A request that needs more than 50 queries is a design defect, not a batching problem. |
| Time Travel | **7 days** | The whole-database recovery window. Not a per-tenant restore. |

**"Initial deployments can use shared D1 databases with strict tenant isolation" is now the
decided model** (`docs/decisions/0006`, Accepted) — but it was adopted on the user's decision
under a zero-cost constraint (`0008`), not because it was recommended, and the threading
consequence above is accepted with it rather than waved away.

### 7.4 Free-tier database allocation budget

Ten databases per account, allocated as follows (`0006` §0.3):

| # | Purpose |
|---|---|
| 1 | Production control-plane / tenant directory |
| 2 | Production shared tenant-data database |
| 3 | Combined staging database |
| 4 | Reserved migration / recovery database |
| 5–10 | **Unallocated** — emergency growth reserve |

**Local development and CI consume no remote slots.** Verified against Cloudflare's
local-development documentation on 2026-09-01: `wrangler dev` defaults to **local mode**
powered by Miniflare, persists to local disk, and does not reach remote D1. Targeting a
remote database requires explicitly setting `"remote": true` in the binding configuration.
**Local development must not set it.**

**Nothing here creates a cloud resource.** This is an allocation budget, not deployment
approval.

### 7.5 Capacity protection

The production shared database has a **500 MB** Free-tier ceiling.

| Threshold | Action |
|---|---|
| **70%** (350 MB) | Warning and capacity review |
| **85%** (425 MB) | **Stop onboarding new Organizations**; stop non-essential and background growth |
| **90%** (450 MB) | Emergency capacity gate — preserve remaining headroom for essential operations for existing customers |

**Never delete financial, audit, or customer data merely to remain free.** If the choice is
between a charge and destroying a customer's records, it is not a choice: stop onboarding,
degrade non-essential service, and escalate to the user. Retention deletion under a stated
policy (§6, MT4) is a different thing and is unaffected.

**Before admitting external MVP Organizations:**

1. Validate storage estimates against the two architecture-validation applications
   (`ARCHITECTURE_VALIDATION_STANDARD.md`).
2. Measure representative row sizes and audit/event growth.
3. Define a defensible initial Organization limit.
4. **If no evidence exists, default to a closed beta of at most 10 Organizations.**

### 7.6 Under Option A, isolation is enforced entirely in code

State this plainly, because the decision rests on it:

**There is no physical boundary between two Organizations' data. Every row of every tenant
sits in one database, and the only thing keeping tenant A out of tenant B's records is a
`tenant_id` predicate on every single query. One missing predicate is a breach — of the
entire customer base, not of two tenants.**

The consequences that follow are not optional:

- The predicate is applied **centrally by the storage boundary**, not written by hand in
  each query. A query path that bypasses the boundary is a critical defect.
- The canonical isolation test in §8 is **not optional and cannot only sample.**
  `TESTING_STANDARD.md`'s isolation gate must be read as a per-query-path obligation under
  this model, not a per-endpoint smoke test — a green result on a sampled endpoint proves
  nothing about the endpoint that was not sampled.
- Under Option A a passing isolation test is worth a great deal, precisely because the
  failure mode it detects (a missing predicate) is the actual failure mode of the model.
  That value is only realised if coverage is complete.
- `TenantStoreResolver` (§7.2) is itself an isolation boundary and needs its own test: a
  principal in tenant A must not be able to resolve, be handed, or cache another
  Organization's binding, and an unknown mapping must fail closed.

### 7.7 Consequences accepted with this decision

- **Per-tenant restore is effectively unavailable.** Customers will eventually ask for it
  by name. Accepted MVP limitation and a migration trigger (`0006` §0.7).
- **Noisy neighbours are structural.** D1 is single-threaded per database, so one
  Organization's heavy query is every Organization's latency. Mitigations are architectural
  — push heavy work to Workflows and Queues, forbid unbounded queries, meter per tenant.
- **Tenant deletion must be proven complete** across every table plus R2, caches, queues,
  and audit. There is no "drop the database" shortcut.
- **Cross-tenant platform reporting is trivial** under A — one `GROUP BY`. §5 still forbids
  any aggregate that spans tenants and contains business data; only platform metrics
  without business data are legitimate.
- **The 500 MB ceiling is a product constraint.** See §7.5.

### 7.8 When Option C is reconsidered

Option C is the approved migration candidate. Reconsider it when: the shared database
reaches the §7.5 thresholds; noisy-neighbour evidence appears; restore or deletion
requirements cannot be met safely; the user approves Workers Paid; or free-tier capacity or
product limits change. **Migration requires user approval. So does any paid plan.**

### 7.9 Background — the earlier option comparison (SUPERSEDED)

> **⚠ Superseded by §7.1.** Retained as background so the reasoning is legible, not as a
> live choice. Nothing in this repository may treat anything below as open. The full
> comparison, including the recommendation that did not survive `0008`, is in
> `docs/decisions/0006-tenancy-model.md` §1–§9 — where the **paid-tier** figures it was
> computed against are preserved and labelled. **Do not carry any figure from §7.9 or from
> `0006` §1–§9 into a design; §7.3 holds the applicable numbers.**

**A — Shared database, row-level isolation.** One D1 database, `tenant_id` on every table.
*For:* simplest to build; one migration path; cross-tenant platform queries are trivial.
*Against:* every tenant contends for one thread; the size ceiling is shared; a single
missing predicate is a breach; per-tenant restore is effectively impossible; noisy
neighbours are structural. **— This is the decided model. Its "against" column is accepted,
not refuted (§7.6, §7.7).**

**B — Database per tenant.** One D1 database per Organization.
*For:* isolation by construction — a missing predicate cannot leak because the handle
cannot reach; per-tenant throughput, size, restore, and deletion.
*Against:* migrations across N databases with partial-failure handling; provisioning on the
signup path; platform-wide queries need aggregation elsewhere. **— Excluded during the
Zero-Cost MVP: ten databases total is not a customer base, and the runtime-binding question
(`0006` §4.4) is unresolved.**

**C — Hybrid: pooled shards, promotable to dedicated.** Small tenants share one of many
databases; a tenant is promoted to its own on size, load, or plan.
*For:* bounded blast radius; contention limited to a shard; promotion is a migration, not a
rewrite. *Against:* routing, directory, and promotion path must all exist early; two
operational modes to test. **— The approved migration candidate (§7.8), not the current
model.**

**A fourth option, schema-per-tenant, is not available:** D1 is SQLite, which has no schema
namespace of the kind Postgres offers.

---

## 8. Testing

`qa-agent` writes an isolation test for **every** feature that touches tenant data. The
canonical shape (`TESTING_STANDARD.md` §5):

> Create tenant A and tenant B with equivalent data. Acting as a **fully privileged**
> principal in tenant A — an owner with every permission — attempt to read, list, update,
> delete, export, enumerate, and infer tenant B's records through every available surface:
> API, event, workflow, file, search, and MCP. Every attempt returns `not_found` or an
> empty result. No response, error message, or log line reveals that tenant B's data
> exists.
>
> **For equivalent unauthorised requests, status, error shape, response-size class and
> timing distribution must not reveal whether another tenant or its resource exists.**

The privileged principal matters: an under-permissioned principal fails for the wrong
reason and proves nothing about isolation.

**On the non-disclosure sentence.** This is the canonical wording, identical to
`TESTING_STANDARD.md` §5.2; the two files carry it verbatim and change together. It is a
requirement, not an aspiration:

- Ordinary shared-D1 load variation is **not** automatically a failure. §7.7 accepts that
  under Option A *"one Organization's heavy query is every Organization's latency"*, and
  latency that moves with overall load rather than with existence is noise.
- A **statistically distinguishable difference correlated with another tenant or its
  resource existing is a failure** — that is disclosure of existence, and it is a
  tenant-isolation defect regardless of which channel carries it.
- `TESTING_STANDARD.md` TS5 owns defining the sampling, tolerance and verification method.
  Until TS5 is resolved and implemented, this control is reported **`UNVERIFIED / NOT
  RUN`**, and it is **never reported as passed without measurement**.
- Being unverified does **not** block the Phase 0 foundation — there is no runtime and no
  tenant data yet — but it **is a mandatory blocker before any production release serving
  real tenant data.** The verification is owed, not waived.

**What this test proves under the decided model.** Under Option A (§7.1) the two tenants
live in the same database and the only barrier between them is a `tenant_id` predicate, so
this test is exercising the exact failure mode of the architecture — which makes a pass
meaningful and a gap dangerous. Two obligations follow, and neither is discretionary:

1. **Coverage is per query path, not per endpoint.** A missing predicate on one unsampled
   path is a breach of the whole customer base. Sampling produces false assurance, which is
   worse than no assurance.
2. **The resolver is tested too.** A `TenantStoreResolver` test (§7.2) must show that a
   principal in tenant A cannot resolve, be handed, or cache another Organization's
   binding, and that an unknown Organization mapping fails closed rather than defaulting.

`TESTING_STANDARD.md` §5 states the same obligations in its own words so a gate report
cannot overstate what "tenant-isolation tests pass" means, and §5.2 carries the
non-disclosure sentence above verbatim. **The two documents are aligned; a change to that
sentence in either file is a change to both.**

---

## 9. Verification checklist

- [ ] Tenant derived from authenticated server context; nothing in §3's forbidden list.
- [ ] All eleven carriers in §4 checked for this change.
- [ ] Cache keys prefixed `t:<tenant_id>:`; object keys prefixed `t/<tenant_id>/<app_id>/`.
- [ ] Scheduled jobs iterate tenants explicitly; no cross-tenant query.
- [ ] Cross-tenant access returns `not_found`.
- [ ] No business data or foreign tenant identifier in any log or error message.
- [ ] Tenant immutable after creation; no record moves between tenants.
- [ ] Storage handle obtained from the Core-owned storage port — never constructed in
      domain code, never taken from `env` (`0003` constraint 2, `CLOUDFLARE_STANDARD.md`
      §4).
- [ ] **Handle resolved through `TenantStoreResolver`** — the tenant directory / storage
      port indirection (§7.2). No App, plugin, Connector, client, parameter, or header
      selects a database or a binding; an unknown Organization mapping **fails closed**;
      the resolver returns only Core-configured bindings; no business service touches D1
      directly. **This item is now verified, not deferred.** It was previously excluded
      from this checklist because the indirection rested on an unapproved recommendation
      (MAJ-21); `0006` §0.2 is Accepted, so the indirection is **binding by user decision**
      and its absence is a defect.
- [ ] `tenant_id` predicate applied by the storage boundary on every read and write — never
      hand-written per query, never optional (§7.6).
- [ ] Isolation test present, using a fully privileged principal, and passing — with
      per-query-path coverage, not sampled (§8).
- [ ] Resolver isolation test present: tenant A cannot resolve, receive, or cache another
      Organization's binding; unknown mapping fails closed (§7.2, §8).
- [ ] **Non-disclosure of existence** — status, error shape, response-size class and timing
      distribution, per §8. Reported `UNVERIFIED / NOT RUN` until `TESTING_STANDARD.md` TS5
      defines and the team implements the method; **never ticked without measurement.** Not
      a Phase 0 blocker; **a blocker before any production release serving tenant data.**
- [ ] Files, attachments, and exports stored in R2, not D1 (§7.1).
- [ ] No paid-tier D1 figure relied on anywhere; the applicable limits are §7.3's Free
      figures, and any other limit the design depends on is verified and recorded
      (`CLOUDFLARE_STANDARD.md` §10).
- [ ] Growth against the 500 MB production ceiling considered; §7.5 thresholds respected.
- [ ] Fixtures and seeds contain no cross-tenant reference.

---

## 10. Open questions

**Classified 2026-09-06 against the built system**, on the three states defined in
`CONSTITUTION.md` §7. **Three closed, three still open — and all three that remain are user
decisions, not architecture ones.** MT3, MT4 and MT5 need a person to choose a legal or
commercial position; no agent can close any of them, and no further architecture work
unblocks them.

| # | Question | Status |
|---|---|---|
| MT1 | **Tenant = Organization** (§2). | **CLOSED — decided.** `docs/decisions/0006` (**Accepted**, user, 2026-09-01) §1.1 lists it under *Settled*, citing this section: *"The tenant is the Organization. The Team Lead reports this as confirmed by the user. This record takes it as given and does not re-open it. `business_id` is an authorization scope inside a tenant, never an isolation boundary."* Built accordingly: `platform/core/storage/adapters/sql/sql-compiler.ts:141` is the single emission point of `tenant_id = ?`, and the value behind it is `organizationId` (`platform/core/tenancy/tenant-context.ts:63`). **`0006` records it as confirmed rather than deciding it**, so the confirmation exists in a decision's assumptions table rather than in a record of its own — noted for the Team Lead, because a definition every schema depends on is one nobody would think to look for there. Same question as `CONSTITUTION.md` C1 and `EVENT_STANDARD.md` §4. |
| MT2 | **The tenancy implementation model** — the physical placement of tenant data (§7). | **CLOSED — decided.** `0006-tenancy-model.md` is **Accepted** (user, 2026-09-01): **Option A, one shared production D1 database, with mandatory indirection**, ~~for the Zero-Cost MVP only while `0008` is active~~ **for the current scale, while `0008` is active, and only while the indirection keeps the choice reversible** (`0030`; see §7.1's amendment). Option C is the approved migration candidate; migration and any paid plan require user approval. **This row carried the withdrawn "MVP only" phrasing when it was first written on 2026-09-06 — after the §7.1 amendment, by the same agent, in the same pass.** Left visible because it is the more instructive kind of miss: not a stale document nobody had revisited, but new text reproducing the premise the author had just finished withdrawing four hundred lines above. |
| MT6 | **The `TenantStoreResolver` indirection** (§7.2) — formerly MAJ-21, an unapproved assumption asserted inside a standard. | **CLOSED — approved, binding, and now built.** `0006` §0.2, Accepted. It is a verification item in §9 rather than a recommendation. **Verified in code 2026-09-06:** the port is `platform/core/tenancy/tenant-store-resolver.ts` and the implementation `platform/core/tenancy/directory-tenant-store-resolver.ts`; the tenant predicate has exactly one emission point, `whereWithTenant` at `platform/core/storage/adapters/sql/sql-compiler.ts:141`, called unconditionally by `compileSelect`, `compileUpdate` and `compileDelete` (lines 164, 206, 214) with `compileInsert` setting the column instead. That file's own header states the negative control this standard's §7.6 requires: *"remove the tenant clause from `whereWithTenant`, and every isolation test in the suite must go red. If removing it turns only some of them red, coverage is incomplete."* **`0030` raises what this indirection is for:** it is no longer only isolation, it is the mechanism that keeps `0006` reversible — see the amendment at §7.1. |
| MT3 | **Data residency.** Some customers will require data to stay in a region; the plan does not mention it. | **STILL OPEN — needs a USER decision**, and no architecture work unblocks it. Unchanged and still harder under the decided model: one shared database has one location, so a residency requirement cannot be satisfied by placement under Option A. It is a migration trigger (§7.8), not a configuration change. **Raise it before any Organization with a residency requirement is onboarded.** Same question as `SECURITY_STANDARD.md` SE3, which pairs it with GDPR and PCI scope — **record them together; they are one conversation with the user, not three.** |
| MT4 | **Retention and deletion policy** — how long audit and event history survive a tenant deletion. | **STILL OPEN — needs a USER decision.** Has legal consequences and no agent may make it. **Now concrete rather than hypothetical:** `audit_event` (`platform/core/migrations/0001_audit_event.sql:33`) and `platform_operator_action` (`.../control-plane/0009_platform_operator_action.sql:107`) are both accumulating rows in production with **no retention policy and no deletion path**, and §6 requires a tenant deletion to be provably complete across audit *"subject to retention"* — a clause with nothing behind it. **It also now touches `0030`'s expandability constraint:** storage is the one free-tier allowance that does not ebb, so an unbounded audit table is a growth curve nobody has bounded. Same question as `SECURITY_STANDARD.md` SE4. |
| MT5 | **Search index isolation.** Core owns search infrastructure; no engine is approved, and a shared index is a shared data store. | **STILL OPEN — blocked on the search-engine decision, which is itself blocked on a USER approval of a technology.** No search infrastructure exists in `platform/core/**`, no engine is approved by any record, and `CONSTITUTION.md` Rule 12 forbids one entering without a record. The rule stated here is unconditional and survives whatever is chosen: **the index is tenant-partitioned.** **Also blocked on `CONSTITUTION.md` C3 / `ARCHITECTURE.md` A2 / `CORE_BOUNDARIES.md` §4** — whether search is a Core primitive, a Capability, or both decides who owns the index before any engine question arises. Close that first. |
