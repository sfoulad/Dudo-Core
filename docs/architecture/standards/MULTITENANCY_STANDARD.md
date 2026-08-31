# Multi-Tenancy Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **§7 decides nothing** — the tenancy implementation model is an open decision belonging to the Team Lead and the user.
- **Authored by:** `architecture-agent`.
- **Applies to:** every data path in Dudo, without exception.
- **Depends on:** `CONSTITUTION.md` Rule 10, `SECURITY_STANDARD.md`, `CLOUDFLARE_STANDARD.md`.
- **Source:** master build plan §3 Rule 10, §6, §14; `docs/decisions/0003`.

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

The master plan carries both `tenant_id` and `business_id` in the event envelope (§11) and
defines neither. This is the resolution `architecture-agent` recommends. **It needs Team
Lead confirmation and it is load-bearing** — every table, key, and index depends on it.

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
- **Backup and restore** — restoring one tenant must not restore or expose another. If the
  chosen tenancy model cannot restore a single tenant, that is a consequence the decision
  in §7 must accept explicitly rather than discover later.

---

## 7. The implementation model — options, not a decision

**This is not decided here, and nothing downstream of here treats it as decided.** It needs
its own record; `0003` already flags it, and `docs/decisions/0006-tenancy-model.md` drafts
it as **Proposed**. What follows is the honest constraint set and `architecture-agent`'s
recommendation, in that order. The recommendation in §7.3 binds nothing.

### 7.1 The constraint, stated plainly

From `docs/decisions/0003`, verified against Cloudflare's published limits:

| D1 property | Value | Consequence |
|---|---|---|
| Concurrency | **Single-threaded per database** | Tenants sharing a database contend for one thread. |
| Throughput | **~1,000 queries/second at 1 ms per query** | This is a *per-database* ceiling, and it is a hard one. |
| Size | **10 GB per database** | A shared database has a tenant count beyond which it cannot grow. |
| Count | **50,000 databases** on Workers Paid; more on request | Database-per-tenant is supported at real scale, but not unbounded. |

**The master build plan §14 says "initial deployments can use shared D1 databases with
strict tenant isolation." That recommendation is in tension with D1's threading model and
should not be adopted on the plan's authority alone.** A shared database does not merely
mean tenants share storage — it means every tenant's every query queues behind every other
tenant's. One tenant running a report degrades everyone, and there is no query planner or
connection pool to soften it. This is the single most consequential unexamined statement
in the plan.

### 7.2 Options

**A — Shared database, row-level isolation.** One D1 database, `tenant_id` on every table.

- *For:* simplest to build; one migration path; cross-tenant platform queries are trivial.
- *Against:* every tenant contends for one thread; the 10 GB ceiling is shared; a single
  missing predicate is a breach; per-tenant restore is effectively impossible; noisy
  neighbours are structural, not incidental.

**B — Database per tenant.** One D1 database per Organization.

- *For:* isolation by construction — a missing predicate cannot leak because the handle
  cannot reach; per-tenant throughput, size, restore, and deletion; supported to 50,000
  databases.
- *Against:* migrations must run across N databases with partial-failure handling;
  provisioning is on the signup path; platform-wide queries need aggregation elsewhere;
  a hard ceiling on tenant count that requires a Cloudflare conversation to lift.

**C — Hybrid: pooled shards, promotable to dedicated.** Small tenants share one of many
databases; a tenant is promoted to its own database on size, load, or plan. Routing lives
in a Core-owned tenant directory.

- *For:* bounded blast radius from day one; contention limited to a shard; promotion is a
  migration, not a rewrite; matches the plan's "large Enterprise tenants may later receive
  isolated databases" without accepting the single-shared-database starting point.
- *Against:* the routing layer, the directory, and the promotion path must all exist
  early; migrations must run across shards; two operational modes to test.

### 7.3 Recommendation — advice only, adopted by nothing

**No option in §7.2 has been chosen, and this section chooses none.** What follows is
`architecture-agent`'s recommendation to the Team Lead and the user. It is not binding, it
is not non-negotiable, and no standard, checklist, or registry in this repository treats it
as settled. The full comparison is drafted in
`docs/decisions/0006-tenancy-model.md` (**Status: Proposed**); the decision is the user's.

**The recommendation.** Option C, and a storage port that resolves a tenant to a storage
handle through a Core-owned tenant directory rather than constructing handles in domain
code.

**The engineering argument, preserved for whoever decides.** The indirection is the part
that is genuinely expensive to reverse. With it, A → C → B is a migration. Without it,
every App, every query, and every migration hard-codes an assumption about physical
layout, and changing the model later means rewriting the entire data layer of every App at
once — which is what `CONSTITUTION.md` §6 exists to prevent. Under Option A the
indirection costs almost nothing and preserves the exit; under B and C some mapping from
tenant to database has to exist in any case.

**The counter-argument, so the recommendation is not the only case on record.** Under
Option A a directory is one row per tenant pointing at the same database — overhead with
no present benefit — and the resolution step itself becomes an isolation boundary that
needs its own test (a principal in tenant A must not be able to resolve, be handed, or
cache tenant B's handle). That test is specified nowhere today and is a cost of the
recommendation, not a free consequence of it.

What *is* already binding, and does not depend on this decision, is `0003` constraint 2:
storage sits behind a Core-owned port, and no Cloudflare binding appears in domain logic.
That holds under A, B, and C alike.

### 7.4 What the decision must state

1. The model (A, B, or C), with the shard sizing or promotion criteria if C.
2. How migrations run across N databases, including partial failure and rollback.
3. Where platform-wide queries get their data, given they cannot join across tenants.
4. Per-tenant backup, restore, and deletion.
5. Provisioning on signup: synchronous or asynchronous, and what the user sees.
6. The ceiling — tenants per shard, or databases per account — and what happens at it.
7. How App-owned data maps onto it, given Apps × tenants storage units
   (`ARCHITECTURE.md` A4).

---

## 8. Testing

`qa-agent` writes an isolation test for **every** feature that touches tenant data. The
canonical shape (`TESTING_STANDARD.md` §5):

> Create tenant A and tenant B with equivalent data. Acting as a **fully privileged**
> principal in tenant A — an owner with every permission — attempt to read, list, update,
> delete, export, enumerate, and infer tenant B's records through every available surface:
> API, event, workflow, file, search, and MCP. Every attempt returns `not_found` or an
> empty result. No response, error message, log line, or timing difference reveals that
> tenant B's data exists.

The privileged principal matters: an under-permissioned principal fails for the wrong
reason and proves nothing about isolation.

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
      §4). *How* the port resolves a handle is the open tenancy decision (§7) and is not
      verified by this checklist.
- [ ] Isolation test present, using a fully privileged principal, and passing.
- [ ] Fixtures and seeds contain no cross-tenant reference.

---

## 10. Open questions

| # | Question | Status |
|---|---|---|
| MT1 | **Tenant = Organization** (§2). | Recommended; needs Team Lead confirmation. Blocks every schema. |
| MT2 | **The tenancy implementation model** — the physical placement of tenant data (§7). | **Open. Undecided.** Needs an accepted ADR **before Phase 1**; drafted as `0006-tenancy-model.md`, Status Proposed. `architecture-agent` recommends option C with the directory indirection — a recommendation, adopted by nothing. |
| MT3 | **Data residency.** Some customers will require data to stay in a region; the plan does not mention it. | Not decided. It is far cheaper to accommodate in the tenancy model than to retrofit — raise it with the user *before* MT2 is decided. |
| MT4 | **Retention and deletion policy** — how long audit and event history survive a tenant deletion. | Not decided. Has legal consequences; needs the user. |
| MT5 | **Search index isolation.** Core owns search infrastructure; no engine is approved, and a shared index is a shared data store. | Whatever is chosen, the index is tenant-partitioned. Blocked on the search engine decision. |
