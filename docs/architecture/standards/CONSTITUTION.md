# Dudo Constitution

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`. **Accepted by:** Team Lead only.
- **Applies to:** every agent, every human contributor, every change in `Dudo-Core`.
- **Source:** master build plan §3, §26, §27, §29, §30, §39.
- **Depends on:** `docs/decisions/0003`, `0004`, `0005`.

This is the highest architectural authority in the repository. Every other standard in
`docs/architecture/standards/` elaborates it and may not contradict it.

---

## 1. Precedence

When two sources disagree, the higher one wins. Do not resolve a conflict by picking the
convenient reading; escalate to the Team Lead and record the resolution.

| Rank | Source | Notes |
|---|---|---|
| 1 | **Explicit user approval in the current conversation** | Specific, scoped, does not carry forward. No agent may claim it. |
| 2 | **Accepted records in `docs/decisions/`** | The decision memory. A record marked `Accepted` outranks every document below. |
| 3 | **This Constitution** | |
| 4 | **The standards in `docs/architecture/standards/`** | Each is authoritative in its own subject area. |
| 5 | **The registries in `packages/contracts/registries/`** | See the split rule below. |
| 6 | **The master build plan** | The origin of this architecture, but superseded wherever an accepted ADR says otherwise. |
| 7 | **Code, comments, and commit messages** | Never a source of architectural truth. |

**Standards versus registries.** A standard defines *rules*; a registry defines *values*.
Where a standard and a registry disagree about a rule, the standard wins. Where they
disagree about a value — a permission name, an event name, a Core object — the registry
wins, because the registry is the artifact that is machine-checked. Fix the other side
in the same change.

**`.claude/rules/**` and this Constitution are peers.** The rules govern *how the team
works* (assignment, ownership, reporting, approval gates); the standards govern *what is
built*. Where they overlap, the stricter reading applies. A genuine conflict is a defect
in one of them and goes to the Team Lead — it is never resolved locally by an agent.

---

## 2. The ten non-negotiable rules

These are the master build plan's §3, restated so that each can be *checked* rather than
merely agreed with. A change that violates any of them is rejected in review regardless
of how well it works.

### Rule 1 — Core stays small

Core contains platform functionality only. Business-specific functionality is an App or a
Capability.

- **Check:** every module under `platform/core/**` passes the four-question inclusion
  test in `CORE_BOUNDARIES.md` §2. If it fails any one, it does not belong in Core.
- **Why:** Core is the one thing every tenant, every App, and every future business type
  shares. Anything specific put there is a permanent constraint on businesses that do not
  exist yet (master plan §39).

### Rule 2 — Apps own their domain

Each App owns its logic, data, API, events, permissions, UI, and tests.

- **Check:** an App's manifest declares all seven; no App-specific business rule appears
  outside `apps/<app>/**`.
- **Why:** ownership that is split is ownership that is nobody's.

### Rule 3 — No cross-App database access

An App never reads or writes another App's storage — not its tables, not its files, not
its caches, not through a shared helper, not "just for a report".

- **Check:** an App's data-access layer resolves only its own storage handle; there is no
  path by which an App obtains another App's. Reviewed on every change that touches
  storage.
- **Why:** it is the only boundary that cannot be restored once crossed. A single shared
  join makes two Apps one App forever.

### Rule 4 — Internal communication uses contracts

Synchronous communication between internal services uses Service Bindings/RPC against a
contract published in `packages/contracts/**`, never public HTTP and never an undeclared
shape.

- **Check:** no internal caller constructs a URL to another Dudo service. See
  `API_STANDARD.md` §2 and `CLOUDFLARE_STANDARD.md` §3.

### Rule 5 — Asynchronous communication uses Events

Events are delivered through Cloudflare Queues. Long-running or multi-step operations use
Cloudflare Workflows.

- **Check:** every published event exists in `packages/contracts/registries/event-catalog.yaml`
  with a version and an envelope that satisfies `EVENT_STANDARD.md` §3.

### Rule 6 — External integrations never become dependencies of Core

Never `Finance → Stripe`. Always `Finance → Payment Capability → Payment Connector`.

- **Check:** no vendor name appears in `platform/core/**` or in any App's source outside
  a connector under `connectors/**`. A grep for vendor names in Core or Apps returns
  nothing. See `CAPABILITY_STANDARD.md` §1.

### Rule 7 — AI never directly changes databases

AI may use APIs, Actions, MCP tools, and Workflows. AI may not query application
databases, bypass authorization, modify Core tables, or call privileged internal services
without permission.

- **Check:** no AI code path holds a storage handle. Every AI-initiated mutation is an
  invocation of a declared Action, authorized as in `AUTHORIZATION_STANDARD.md`.
- **Why:** an AI with a database handle has, by construction, every permission at once.

### Rule 8 — Human and AI use the same business actions

If the UI can `CreateInvoice`, an authorized AI principal invokes the *same* Action, with
the same validation, the same authorization, and the same audit record.

- **Check:** there is exactly one implementation per Action, and the MCP tool, the public
  API, the internal API, and the SDK method all resolve to it (`API_STANDARD.md` §1).

### Rule 9 — APIs are versioned

Public APIs are served under `/api/v1/...`. A breaking change requires a new version.

- **Check:** the breaking-change definition in `API_STANDARD.md` §6 is applied on every
  contract change, and the change is labelled additive or breaking in the PR.

### Rule 10 — Every operation is tenant aware

No database query, API action, event, workflow, cache entry, queue message, scheduled job,
file path, log line, or export involving tenant data exists without tenant context.

- **Check:** `MULTITENANCY_STANDARD.md` §4 lists the eleven carriers; every one of them is
  reviewed on every change that touches tenant data, and `qa-agent` ships an isolation
  test per `TESTING_STANDARD.md` §5.
- **Why:** Dudo holds other companies' invoices, payroll, and bank details. One leak is
  not a bug report, it is the end of the product.

---

## 3. Two rules that come from the repository, not the plan

### Rule 11 — Every Cloudflare service stays replaceable

No Cloudflare type, client, or binding appears in domain logic. Storage, queuing, object
access, and scheduling sit behind Core-owned interfaces (`CLOUDFLARE_STANDARD.md` §2).

- **Check:** a grep of `platform/core/**` domain modules and `apps/**` for Cloudflare
  types (`D1Database`, `R2Bucket`, `Queue`, `DurableObjectNamespace`, `Fetcher`,
  `WorkflowEntrypoint`) returns nothing outside the adapter layer.
- **Why:** `0003` accepts real vendor concentration and names this as the only mitigation.
  A mitigation retrofitted after Phase 4 is not a mitigation.

### Rule 12 — Nothing enters the stack without a record

No language, framework, database, library, npm package, or Cloudflare product enters Dudo
until an accepted record in `docs/decisions/` approves it. Being named in the master build
plan is **not** approval.

Approved today, and nothing else: **TypeScript**, **Cloudflare Workers**, **D1**, **R2**,
**Queues**, **Workflows**, and **Durable Objects** where real coordination is genuinely
needed (`0003`).

Explicitly **not** approved: Workers AI, AI Gateway, Agents SDK, Workers for Platforms,
Analytics Engine, KV, Hyperdrive, Vectorize, and every npm package including test
frameworks and web frameworks.

- **Check:** the dependency manifest and the Worker configuration name nothing outside the
  approved list. Every standard in this directory is written so that it does **not**
  depend on an unapproved product; where one is needed, the standard says so and stops.

---

## 4. How work is governed

### 4.1 No self-review

**The agent that writes an implementation is never the final approving agent** (master
plan §26). The agent that defines a contract is not the agent that implements it — which
is why `packages/contracts/**` moved to `architecture-agent` in `0004`.

### 4.2 Every task carries a specification

Before code starts, a task has, in writing (master plan §29): Objective · Affected
App/Service · Business requirement · Architecture · API changes · Event changes ·
Permission changes · Data changes · UI changes · MCP changes · **Files allowed to
change** · Acceptance criteria · Test requirements · Security requirements.

An ambiguous "files allowed to change" is how scope creep starts. **Agents are prohibited
from casually expanding scope.**

### 4.3 One file, one owner, at one time

Ownership is fixed by `0004`. Two agents never hold the same file. An agent that needs a
file outside its ownership stops and asks the Team Lead.

### 4.4 Definition of done

A task is complete only when every item in `TESTING_STANDARD.md` §8 holds — including
tenant-isolation tests, permission tests, security review, audit events, a safe migration,
and a rollback path. Partial completion is reported as partial.

### 4.5 Which gate applies

- **Phases 0–3:** the Foundation Gate (`0005`), seven conditions ending in user approval.
- **From the first runnable vertical feature (in practice Phase 4):** the full seven-step
  delivery gate (`docs/product/mvp-delivery-policy.md` §4).

The Team Lead states which gate applies when assigning work.

### 4.6 Amending this Constitution

1. Any agent may propose an amendment, in writing, with the reason and the consequence.
2. `architecture-agent` drafts it and drafts the accompanying decision record.
3. The Team Lead reviews; the user approves; the record is accepted.
4. Only then is this document edited, and every standard it affects is updated in the
   same change.

A rule is never weakened to unblock a task in flight. If a rule blocks work, that is
information, not an obstacle.

---

## 5. Required reading

An agent reads the standards relevant to its change **before** editing. This is the
condition the master plan places on all agent work (§24).

| If your change touches | Read |
|---|---|
| Anything at all | This document, `ARCHITECTURE.md` |
| `platform/core/**` | `CORE_BOUNDARIES.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md`, `SECURITY_STANDARD.md` |
| `apps/**` | `APP_STANDARD.md`, `API_STANDARD.md`, `EVENT_STANDARD.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md` |
| `platform/capabilities/**`, `packages/sdk/**` | `CAPABILITY_STANDARD.md`, `APP_STANDARD.md`, `SECURITY_STANDARD.md` |
| `connectors/**` | `CONNECTOR_STANDARD.md`, `CAPABILITY_STANDARD.md`, `SECURITY_STANDARD.md` |
| `packages/contracts/**` | `API_STANDARD.md`, `EVENT_STANDARD.md`, and every registry |
| Anything AI or MCP | `AI_STANDARD.md`, `MCP_STANDARD.md`, `AUTHORIZATION_STANDARD.md` |
| Any Cloudflare surface | `CLOUDFLARE_STANDARD.md` |
| `packages/testing/**`, `apps/*/tests/**` | `TESTING_STANDARD.md` |

---

## 6. The principle behind all of it

> Core provides primitives. Apps provide business logic. Capabilities provide reusable
> functions. Connectors integrate external ecosystems. APIs and Events connect
> everything. MCP makes everything AI-discoverable.

And the engineering rule every agent follows:

> **Never solve today's requirement in a way that prevents tomorrow's application from
> being built independently.**

---

## 7. Open questions this document does not settle

Each needs a decision record before work builds on it. Recommendations are
`architecture-agent`'s and are not decisions.

| # | Question | Recommendation |
|---|---|---|
| C1 | **What is a "tenant"?** The master plan's event envelope carries both `tenant_id` and `business_id` (§11) but never defines which one is the isolation boundary. | Tenant = **Organization**. `business_id` is a sub-scope inside it, never an isolation boundary of its own. See `MULTITENANCY_STANDARD.md` §2. |
| C2 | **The tenancy implementation model.** Not decided here and not decided by any standard. | See `MULTITENANCY_STANDARD.md` §7 — options presented, hybrid routing recommended, decision belongs to the Team Lead and the user. |
| C3 | **Search, Notifications, and Files are listed as Core services (§6) *and* as Capabilities (§2).** The plan contradicts itself. | Core owns the primitive service; the Capability is the vendor-neutral interface Apps call; Core is the default provider. `CORE_BOUNDARIES.md` §4. |
| C4 | **Public API path namespacing.** `/api/v1/customers` (§10) assumes a flat global resource namespace, which cannot survive arbitrary third-party Apps. | Reserved flat paths for Core and registered official Apps; `/api/v1/apps/<app_id>/...` for everything else. `API_STANDARD.md` §5. |
| C5 | **Phase 1's admin portal is runnable**, so `0005`'s trigger ("the first runnable vertical feature") fires before Phase 4. | Team Lead to state explicitly which gate the admin portal falls under, before Phase 1 planning. |
