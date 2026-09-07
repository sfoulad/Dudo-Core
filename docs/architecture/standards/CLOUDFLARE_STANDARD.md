# Cloudflare Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every use of a Cloudflare service in `Dudo-Core`.
- **Depends on:** `docs/decisions/0003` (the approval and its two constraints), `docs/decisions/0006` (tenancy model, Accepted), `docs/decisions/0008` (zero cost — the Free tier is binding), `docs/decisions/0030` (the MVP framing withdrawn; **expandability now binding beside zero cost**), `CONSTITUTION.md` Rules 11 and 12.
- **Source:** `docs/decisions/0003`, `0006`, `0008`, `0030`.

> **`0030`, accepted 2026-09-06, adds a constraint this document is the main place to enforce:**
> **the free tier may cost us CONFIGURATION, never SCHEMA.** A limit worked around by a setting, a
> ceiling constant or a deployment topology is reversible by changing that thing; **a limit worked
> around by changing the shape of the data is paid for once and then forever.** §4 rules 9 and 11
> were already written this way — refuse at the ceiling rather than degrade data, and design the
> migration runner for **N** databases even though N is 1 — and they are now binding for a second
> reason rather than as prudence. **`0008` is unchanged and `0006` is not reversed; what `0030`
> requires is that `0006` stay reversible**, which is what §4 rule 2's indirection buys.

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

> **THE CHECK AS WRITTEN IS WRONG, and the code is right — corrected 2026-09-06 after running it.**
> The grep over `apps/**` is empty, as required. The grep over `platform/core/**` is **not**, and
> the reason is not a violation: **`D1Database` in this repository is Dudo's own type, not
> Cloudflare's.** `platform/core/storage/adapters/d1/d1-store.ts:50–60` declares it — *"the subset
> of the D1 binding surface this adapter uses"* — as a structural type with two methods. No
> Cloudflare type package is installed; the root `package.json` carries `@types/node`, `typescript`
> and `wrangler` and nothing else.
>
> **So a name-based grep cannot distinguish a leaked vendor type from a Core-owned port that names
> the thing it abstracts**, and the four non-adapter files it flags —
> `identity/control-plane-store.ts`, `platform/platform-operator-store.ts`, and the two composition
> roots — are ports and wiring, which is where such a name belongs.
> `platform/core/platform/platform-operator-store.ts:37` states the distinction deliberately: the
> one import from `storage/` in that tree is *"`d1-store.ts`'s `D1Database` TYPE, which is a
> structural interface with two methods and confers no binding."*
>
> **The check that would actually catch the defect is an import check, not a name check:** no module
> outside `**/adapters/**` may import from `@cloudflare/*`, and no domain module may receive `env`
> or a binding. **State it that way before it becomes a CI job**, because the name-based form
> would either fail permanently on correct code or be relaxed until it caught nothing — and a check
> relaxed to stay green is `workflow.md` §11a's subject exactly.

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

  > **Status 2026-09-06: two Workers exist and there is no Service Binding between them, because
  > there is nothing to call.** `dudo-core` and `dudo-admin` (`wrangler.jsonc`,
  > `wrangler.admin.jsonc`) declare the **same `main: "worker.ts"`** and the same D1 bindings; they
  > differ in which asset collection and which hostname they serve, and `wrangler.admin.jsonc:24–26`
  > says so — *"Same `main`, same bindings, same secrets. The two deployments differ in what they
  > serve to a browser, not in what they are."*
  > **That is one codebase deployed twice, not a service topology**, and this rule is therefore
  > unexercised rather than satisfied. The one cross-Worker reference that does exist is the
  > Durable Object namespace, bound by `script_name: "dudo-core"` so the two do not each create a
  > class of the same name and silently split `0013`'s daily budget. See CF1.
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

**Reconciled against the deployed system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would — those
are reported, never resolved by editing the standard to agree).

| # | State | Question | Recommendation |
|---|---|---|---|
| CF1 | **CONTRADICTED**, then narrowed | **Service topology.** This row said it *"needs an ADR before Phase 1 implementation."* **Phase 1 shipped without one.** Two Workers are deployed — `dudo-core` (`app.dudo.work`, `api.dudo.work`) and `dudo-admin` (`admin.dudo.work`), versions recorded at `docs/product/superadmin-test-checklist.md:23–24`. **But the split is not the one this row recommended.** It recommended a split along existing boundaries — edge/API, core domain, App runtime. What exists is **the same `main` deployed twice**, forced by a Cloudflare constraint rather than chosen: *"Only one collection of static assets can be configured in each Worker"* (`wrangler.admin.jsonc:10`), so a second SPA needs a second Worker. `0022`'s 2026-09-05 amendment records that decision. **The domain-service topology question is untouched, and the App runtime — the boundary that motivated this row — is still one process:** `apps/customers/app.ts:28–30` imports `platform/core/**` directly. | **Re-ask it as one question, now that `0030` has made it cheap to answer well:** should a first-party App be a separate Worker reached by Service Binding? `0030` records that this is **free** — Workers is free; it is Workers for *Platforms* that is paid — and that it is *"a real isolation boundary, not a pretend one."* **That makes CF1 and AP2's first-party half the same decision**, and it is the highest-value architecture decision left in this document. Needs an ADR **before a second App exists**, which is the point at which in-process composition stops being one import and becomes a pattern. |
| CF2 | **OPEN** — Cloudflare product record; blocks nothing | **KV is not approved**, so the plan's configuration and cache layer has no home. | Unchanged, and **the recommendation was followed**: configuration is read from Core storage, and `0006` §4.13's review confirms no option cached the tenant directory in KV. Record a KV decision only if measurement shows a real need. Same root as CF3, CF4 and `AI_STANDARD.md` AI1/AI2: **a Cloudflare product outside `0003`'s six needs its own record, and under `0008` it must also be free.** |
| CF3 | **OPEN** — Cloudflare product record; blocks nothing | **Analytics Engine is not approved**, so the observability requirements rest on Workers logs and traces alone. | ~~Sufficient for Phases 0–3.~~ **Struck 2026-09-06:** `0030` withdrew the phase-scoped MVP framing, and in any case the premise is now weaker than it reads — **Workers Logs is not enabled either.** See CF6. Revisit when there is a real analytics requirement. |
| CF4 | **CLOSED as to scope; OPEN only as a budget question the user owns** | **Workers for Platforms.** `0003` recorded availability as unverified and the free-tier register lists it as paid-only. | **`0030` settles what it gates, and it is much less than the name suggests:** *"Workers is free. Workers for Platforms is a different product and is paid-only. The similarity of the names is the whole confusion."* It gates **only untrusted third-party code execution** — **not tenancy, not Apps as a concept, not the capability model**, which `0006` §4.13 had already recorded: *"Workers for Platforms concerns executing untrusted code (Phase 7); this decision concerns where data sits. They are independent."* **What follows for this directory: first-party Apps as separate Workers behind Service Bindings cost nothing and are available today** (CF1), and the only thing genuinely blocked is an open marketplace where third parties upload and execute code — whose non-technical prerequisites (review process, trust tiers, distribution) are undecided anyway. **Do not design against it**, and do not cite it as a blocker for anything narrower than third-party code execution. |
| CF5 | **CLOSED** | ~~**Migration tooling** — no package is approved, so migrations have no runner.~~ | **`wrangler d1 migrations apply` is the runner, it is wired, and it has run against production.** The four scripts are `package.json:18–21`, deliberately split local/remote with the note that *"REMOTE variants act on the deployed database and are a production-class action requiring explicit user approval each time"*; `migrations_dir` is declared per database in `wrangler.jsonc:137–150`. **Executed:** `docs/product/superadmin-test-checklist.md:25` — *"`0011`–`0014` applied to the remote control plane, in order. `wrangler d1 migrations list` reports no migrations to apply."* No ADR was needed and no package was added: `wrangler` was already inside `0003`. **§4 rule 11 stands and is now `0030` business** — the runner targets one database today and must still handle N, because *"anything that assumes exactly one database exists"* is a named violation of `0030`. **One structural gap survives CF5's closure and is not the same question:** `migrations_dir` is one directory per database, but a tenant database is written by Core **and by every installed App**, and `wrangler` does not recurse. `apps/customers/data/migrations/0001_customer.sql` was therefore never applied by the runner, and every Customer Directory read returned `503` on a system that authenticated perfectly — `docs/operations/deployment-runbook.md` §3. **That is an App-migration composition problem, it will recur for every App, and it needs its own answer** (`APP_STANDARD.md` §6). |
| CF6 | **OPEN** — free-tier impact check owed; **added 2026-09-06** | **Workers Logs is deliberately disabled, so the deployed system has no log retention.** `wrangler.jsonc` leaves `observability` off and states why: `architecture.md` §6a requires a free-tier impact check **before** a feature is built, and that check has not been done. The file calls it *"a live open item, not an oversight"*, and the runbook agrees that *"debugging a deployed Worker without it will hurt."* | **Do the §6a check rather than either enabling it quietly or leaving it indefinitely.** It needs the same three answers every new consumer now needs: which allowance it consumes, expected usage, and what happens at the limit — plus, per the free-tier register's Durable Object warning, **which other consumer it shares with.** Team Lead owns `wrangler.jsonc`. Recorded here because §10 requires every limit a design relies on to be verified before it is relied upon, and a system with no logs relies on that limit by omission. |
