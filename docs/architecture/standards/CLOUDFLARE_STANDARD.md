# Cloudflare Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every use of a Cloudflare service in `Dudo-Core`.
- **Depends on:** `docs/decisions/0003` (the approval and its two constraints), `docs/decisions/0006` (tenancy model, Accepted), `docs/decisions/0008` (zero-cost MVP — the Free tier is binding), `CONSTITUTION.md` Rules 11 and 12.
- **Source:** `docs/decisions/0003`, `0006`, `0008`.

`0003` chose Cloudflare and accepted real vendor concentration. This document is how that
concentration is kept survivable.

---

## 1. What is approved

| Service | Approved for |
|---|---|
| **Workers** | Core API, web backend, internal services |
| **D1** | Relational tenant and platform data |
| **R2** | Object and file storage |
| **Queues** | Reliable asynchronous work |
| **Workflows** | Long-running, multi-step processes |
| **Durable Objects** | **Only** where real coordination or serialized state is genuinely needed — §7 |

**Not approved, and each needs its own decision record before use:** Workers AI · AI
Gateway · Agents SDK · Workers for Platforms · Analytics Engine · KV · Hyperdrive ·
Vectorize · API Shield · every npm package.

**Being recommended is not approval.** Several of the products above are recommended for
this architecture; `0003` deliberately did not adopt them. Where a standard in this
directory would have needed one, it says so and stops rather than assuming.

What this currently blocks, stated plainly: **KV** (the intended configuration and cache
layer — `ARCHITECTURE.md` §6), **Workers AI / AI Gateway** (every AI feature —
`AI_STANDARD.md` AI1), **Agents SDK / remote MCP** (Phase 8 — `MCP_STANDARD.md` MC1),
**Workers for Platforms** (Phase 7 customer code and out-of-runtime egress control —
`CONNECTOR_STANDARD.md` CN2), **Vectorize** (semantic search — `AI_STANDARD.md` AI2),
**Analytics Engine** (analytics — `ARCHITECTURE.md` §8).

---

## 2. Replaceability

**No Cloudflare type, client, or binding appears in domain logic.** This is `0003`'s
second constraint and the only mitigation for vendor concentration.

```
domain logic  ──>  port (Core-owned interface)  ──>  adapter (Cloudflare)  ──>  binding
```

- Ports live in Core and are expressed in domain terms: a storage port, an object port, a
  queue port, a scheduling port, a coordination port.
- Adapters are the **only** place `D1Database`, `R2Bucket`, `Queue`,
  `DurableObjectNamespace`, `Fetcher`, `WorkflowEntrypoint`, `ExecutionContext`, or `Env`
  may be named.
- Apps never see a binding. They receive a tenant-scoped handle from the SDK
  (`APP_STANDARD.md` §6).
- Ports do not leak Cloudflare semantics upward. If the port's interface only makes sense
  because D1 behaves a certain way, the port has failed and the abstraction is decorative.

**Checkable:** grep the domain modules of `platform/core/**` and all of `apps/**` for the
type names above. The result must be empty. This should become a CI check once CI exists;
until then it is a review item on every change.

**Why now rather than later:** `0003` says this "only works if it is enforced in review
from the first commit rather than retrofitted." An abstraction added after Phase 4 is an
abstraction added to code already shaped by the thing it was meant to hide.

---

## 3. Workers and Service Bindings

- **Bindings, not REST.** Cloudflare services are reached through native bindings, never
  by calling Cloudflare's public REST API from a Worker.
- **Worker-to-Worker communication uses Service Bindings/RPC**, never public HTTP
  (`CONSTITUTION.md` Rule 4). Public HTTP between our own services adds latency, adds an
  authentication problem, and exposes an internal surface to the internet.
- A Service Binding is a network property, not a trust property: **the callee still
  authenticates, resolves tenant, and authorizes** (`API_STANDARD.md` §2).
- Workers have a CPU-time budget and no long-running process model. Anything that might
  exceed it is a Workflow or a queue consumer **by design**, not as a rescue after a
  timeout appears in production.
- No global mutable state that survives a request. A Worker isolate may serve many
  tenants' requests over its lifetime, so **module-scope state is a cross-tenant leak
  waiting to happen.** Caches, clients, and configuration holders are per request or are
  keyed by tenant.

---

## 4. D1

**The Free-tier limits that shape everything.** `0008` binds Dudo to the Cloudflare **Free**
tier, so these are the applicable figures — verified against
`developers.cloudflare.com/d1/platform/limits/` on 2026-09-01. **No paid-tier D1 number
applies anywhere in this standard.**

| Property | Free-tier value |
|---|---|
| Concurrency | **Single-threaded per database**, roughly **1,000 queries/second at 1 ms per query** (a per-database engine property from `0003`, not a tier allowance) |
| Size | **500 MB per database** |
| Total storage | **5 GB per account** |
| Databases | **10 per account** |
| Queries per Worker invocation | **50** |
| Time Travel | **7 days** |

**The database budget.** Ten databases is the whole allowance, allocated by `0006` §0.3:
1 production control-plane / tenant directory, 2 production shared tenant data, 3 combined
staging, 4 reserved migration / recovery, 5–10 unallocated emergency reserve. **Creating an
eleventh database is not possible on the Free tier — refuse and degrade rather than
upgrade** (`docs/operations/free-tier-register.md`).

Consequences, and the rules that follow:

1. **Tenants sharing a database contend for one thread.** Under the decided tenancy model
   — **one shared production database** (`0006`, Accepted) — that thread is shared by the
   entire customer base. The tenancy model is therefore a performance decision as much as a
   security one (`MULTITENANCY_STANDARD.md` §7).
2. **Every database handle is obtained from the Core-owned storage port**, never
   constructed and never taken from `env` in domain code. Two accepted decisions now
   require this, not one: `0003` constraint 2 (every Cloudflare service stays replaceable
   behind an internal boundary) **and `0006` §0.2, which makes the server-controlled
   `TenantStoreResolver` binding by explicit user decision.** Apps, plugins, Connectors,
   and clients cannot select a database or a binding; an unknown Organization mapping
   **fails closed**; the resolver returns only Core-configured bindings; business services
   never touch D1 directly. **What the port resolves to today is one shared database** —
   the indirection exists anyway, so that moving to pooled shards later changes no
   business-domain code and no public contract.
3. Queries are parameterised. Always.
4. Every query is indexed for its access path. On a single thread, one unindexed scan is
   everyone's latency.
5. Batch related statements rather than issuing them in a loop. A loop of round trips on a
   single-threaded database is the easiest way to build an outage.
6. **Stay under 50 queries per Worker invocation.** A request that needs more is a design
   defect; do not batch around the limit and do not split a request to evade it.
7. **No long-running or interactive transactions.** Keep write units small.
8. **Files, attachments, and large exports go to R2, not D1.** The 500 MB ceiling is for
   structured business data. Storing blobs in D1 converts a storage problem into an outage
   — see §8.
9. **Watch the 500 MB production ceiling.** 70% warning and capacity review; 85% stop
   onboarding new Organizations and stop non-essential growth; 90% emergency gate
   preserving headroom for essential existing-customer operations (`0006` §0.4).
   **Never delete financial, audit, or customer data merely to remain free** — stop
   onboarding, degrade non-essential service, and escalate to the user.
10. **Migrations are forward-only, versioned, and reviewed**, with a stated rollback path.
    They run through controlled deployment workflows, never ad hoc, and never against real
    data without explicit user approval.
11. Migrations must still be **designed** to run across **N** databases with
    partial-failure handling. Under the decided model N is currently 1, but the migration
    candidate (`0006` §0.5) is pooled shards, and a runner written for exactly one database
    is a runner that must be rewritten at the worst possible moment.

### 4.1 Local development and CI

**Local development and CI consume no remote database slots, and must not.** Verified
against Cloudflare's local-development documentation on 2026-09-01: `wrangler dev` defaults
to **local mode** powered by Miniflare, persisting to local disk, and does not reach remote
D1. Targeting a remote database requires explicitly setting **`"remote": true`** in the
binding configuration.

- **Local development configuration must never set `"remote": true`.**
- CI runs against local emulation. A CI job that touches a remote database burns a slot,
  writes to shared data, and can create a charge.
- A remote binding is a deliberate, reviewed act in a deployed environment — never a
  developer convenience.

---

## 5. Queues

- At-least-once delivery, no ordering guarantee. **Consumers are idempotent and
  order-tolerant** (`EVENT_STANDARD.md` §9). This is a property to be built, not hoped for.
- Every message carries tenant, correlation id, and event id.
- Bounded retries with backoff, then a dead-letter queue. **Every DLQ has a named owner
  and monitoring** — an unmonitored DLQ is silent data loss.
- A poisoned message never blocks a partition indefinitely.
- Batch sizes and timeouts are set explicitly, not left at whatever the default is.
- Message payloads follow the event envelope; no secrets, no full instrument numbers.

---

## 6. Workflows

- Used for anything long-running, multi-step, or requiring durable retry: onboarding,
  App installation, bulk import, provider reconciliation.
- Every step is idempotent — a workflow may retry a step after a partial effect.
- The run carries tenant and correlation id; **no step widens the tenant scope**.
- Steps that call external systems use idempotency keys.
- Failure is a defined state with a defined operator action, not an unhandled exception.
- Workflow state is not a database. It carries identifiers and progress, not business
  records.

---

## 7. Durable Objects

Approved **only where real coordination or serialized state is genuinely needed** (`0003`).

A Durable Object requires a **written justification in the task specification**, stating:

1. What is being serialized, and why correctness fails without it.
2. Why the same guarantee cannot come from a database constraint, an idempotency key, or a
   queue.
3. Its tenant scope — a DO instance belongs to exactly one tenant.
4. Its failure behaviour and its cost profile.

**"It would be convenient" is not a justification.** Durable Objects are single-instance
by design; a badly-scoped DO becomes a global bottleneck that is expensive to remove and
does not show up until load arrives.

---

## 8. R2

- **Files, attachments, and large exports live here, not in D1** (`0006` §0.1). D1's 500 MB
  ceiling is for structured business data; a blob in D1 spends the shared production
  database's entire budget on one customer's upload.
- Keys are `t/<tenant_id>/<app_id>/...` — **ownership is in the key**, not only in
  metadata, so a listing operation cannot cross a tenant even by mistake.
- Every object carries tenant and App ownership metadata as well.
- No public bucket. Access is through short-lived, authorized, audited URLs.
- Uploads are validated: declared type against actual content, size capped
  (`SECURITY_STANDARD.md` §4).
- Deleting a tenant deletes its objects — orphaned objects are retained data nobody
  believes exists.

---

## 9. Configuration, environments, and secrets

- Environments are separate and explicit: **Local · Development · Staging · Production**,
  with separate configuration, credentials, and data.
- Worker configuration is **shared configuration and belongs to the Team Lead**
  (`CLAUDE.md`). Agents propose changes; they do not edit it.
- **No secret in Worker configuration files.** Worker secret bindings hold
  platform-level secrets only; they are per-Worker and cannot hold per-tenant vendor
  credentials — which is why the tenant-scoped secret store is still an open decision
  (`SECURITY_STANDARD.md` SE1).
- Bindings are named after the **port** they serve, not the vendor product — `DB_PLATFORM`
  and `FILES`, not `MY_D1` and `MY_R2`. It reads better and it survives a migration.
- Deploying to production requires explicit user approval in the current conversation,
  every time.

---

## 10. Limits

Cloudflare's limits change, and several of them shape the architecture. Only the D1 limits
in §4 have been verified and recorded — the **Free-tier** figures, checked against
`developers.cloudflare.com/d1/platform/limits/` on 2026-09-01, together with the
single-thread engine property from `0003`. **`0008` makes the Free tier binding, so a
paid-tier allowance is not a limit this architecture may rely on**; quoting one is the same
defect as quoting an unverified number, and worse, because it looks researched.

**Every other limit that a design depends on must be verified against Cloudflare's current
documentation and recorded in the task specification before it is relied upon** — Worker
CPU time, request and subrequest counts, queue batch sizes and message sizes, Workflow
step counts and durations, R2 object sizes.

This standard deliberately states no unverified number. A number quoted from memory is
worse than no number, because it will be trusted.

---

## 11. Verification checklist

- [ ] Only approved services used; anything else has a decision record.
- [ ] No Cloudflare type outside an adapter — grep is empty for the §2 type list.
- [ ] Domain logic depends on a port, never a binding.
- [ ] Bindings used, not Cloudflare REST APIs.
- [ ] Worker-to-Worker over Service Bindings/RPC; callee still authorizes.
- [ ] No module-scope mutable state carrying tenant data.
- [ ] D1 handle obtained from the Core-owned storage port and resolved by
      `TenantStoreResolver`, never from `env` in domain code; no caller selects a database
      or binding; unknown Organization mapping fails closed (`0006` §0.2).
- [ ] Queries parameterised and indexed; **under 50 queries per Worker invocation**.
- [ ] No paid-tier Cloudflare figure relied on; §4's Free-tier limits are the applicable
      ones and the database budget is respected.
- [ ] Local and CI configuration does **not** set `"remote": true` on any binding (§4.1).
- [ ] Files, attachments, and exports stored in R2, not D1; production database growth
      checked against the 70/85/90 thresholds.
- [ ] Migrations forward-only, reviewed, with a rollback path and N-database handling.
- [ ] Queue consumers idempotent and order-tolerant; DLQ owned and monitored.
- [ ] Workflow steps idempotent; tenant never widened.
- [ ] Durable Object justified in writing, tenant-scoped.
- [ ] R2 keys carry tenant and App; no public bucket; uploads validated.
- [ ] No secret in Worker configuration; bindings named for ports.
- [ ] Any limit the design relies on is verified and recorded.

---

## 12. Open questions

| # | Question | Recommendation |
|---|---|---|
| CF1 | **Service topology** — one Worker, or a Worker per domain service. `0003` does not decide it, and it changes what a Service Binding is *for*. | Start with a small number of Workers split along the boundaries that already exist (edge/API, core domain, App runtime). Splitting later is easier than merging. Needs an ADR before Phase 1 implementation. |
| CF2 | **KV is not approved**, so the plan's configuration and cache layer has no home. | Read configuration from Core storage with in-request caching only. If measurement later shows a real need, record a KV decision then — not preemptively. |
| CF3 | **Analytics Engine is not approved**, so §34's observability requirements rest on Workers logs and traces alone. | Sufficient for Phases 0–3. Revisit when there is a real analytics requirement. |
| CF4 | **Workers for Platforms availability** — `0003` records this as unverified. `docs/operations/free-tier-register.md` lists it as **paid-only and prohibited outright** while `0008` is active. | Unavailable during the Zero-Cost MVP regardless of the Enterprise question. It gates third-party App and Connector isolation, so Phase 7 planning must assume it is not there unless the user approves a paid plan. Do not design against it in the meantime. |
| CF5 | **Migration tooling** — no package is approved, so migrations have no runner. | Needs an ADR with TS1. Blocks the first schema. The tenancy model is no longer a blocker here (`0006` is Accepted): the runner targets one shared database today and must still handle N (§4 rule 11). |
