# Dudo Constitution

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`. **Accepted by:** Team Lead only.
- **Applies to:** every agent, every human contributor, every change in `Dudo-Core`.
- **Depends on:** `docs/decisions/0003`, `0004`, `0005`.
- **Reconciled against the built system 2026-09-06.** This document was authored before any
  code existed. Every open question in §7 now carries a status, and the two rules that the
  implementation has overtaken — Rule 9's path claim and Rule 12's approved list — say so
  where they are stated rather than only in the table. **Nothing here has been rewritten to
  match the code**; where a standard and the system disagree the disagreement is recorded and
  routed to the Team Lead (`.claude/rules/workflow.md` §12).

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
| 6 | **The originating planning source** (private, not published) | The origin of this architecture, but superseded wherever an accepted ADR says otherwise. |
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

Each is stated so that it can be *checked* rather than merely agreed with. A change that
violates any of them is rejected in review regardless of how well it works.

### Rule 1 — Core stays small

Core contains platform functionality only. Business-specific functionality is an App or a
Capability.

- **Check:** every module under `platform/core/**` passes the four-question inclusion
  test in `CORE_BOUNDARIES.md` §2. If it fails any one, it does not belong in Core.
- **Why:** Core is the one thing every tenant, every App, and every future business type
  shares. Anything specific put there is a permanent constraint on businesses that do not
  exist yet.

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

> **CONTRADICTED, 2026-09-06 — seven deployed public routes are not under `/api/v1`, and they
> are unversioned.** `platform/core/identity/pre-auth-registry.ts:259–323` serves
> `/auth/login/start`, `/auth/login/complete`, `/auth/session/refresh`,
> `/auth/session/revoke` and `/health`; `platform/core/identity/session-routes.ts:103,110`
> serves `/auth/session/organizations` and `/auth/session/organization`. Only the platform
> route class (`/api/v1/platform/**`) and the Action routes (`/api/v1/...`) satisfy the rule
> as written.
>
> **The placement is deliberate and correct** — `wrangler.jsonc:97–99` records the reason:
> *"`/api/` is the namespace Apps mount into and login must not sit where an App could
> collide with it."* **What is missing is the versioning half.** These are public shapes two
> clients ship against, and the rule that would force a new version on a breaking change is
> carried entirely by the `/api/v1` prefix that these paths do not have. `0018` already
> amended the revocation route's carrier set and its outcome set after both clients had been
> written against it; nothing in the path said so.
>
> **This is the Team Lead's to route.** The standard is not silently widened to admit
> `/auth/**`, because doing so would remove the only versioning obligation these routes have.
> The choices are a version segment on the reserved prefixes, an explicit carve-out that names
> its own versioning rule, or leaving them unversioned as a recorded and accepted cost.

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

> **CONTRADICTED, 2026-09-06 — the npm clause is out of date, and it is the sentence a
> reviewer would check a dependency against.** `docs/decisions/0016` (**Accepted**,
> 2026-09-04) approves **React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui** and
> states in terms: *"It is the first decision in this project to approve npm dependencies,
> which the user had previously reserved to themselves."* Twelve packages are declared —
> `package.json:25–29` (`@types/node`, `typescript`, `wrangler`) and
> `platform/web/package.json:18–33` (React, React DOM, Vite, `@vitejs/plugin-react`,
> Tailwind, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`,
> `class-variance-authority`, `clsx`, `tailwind-merge`).
>
> **The rule itself is unchanged and still holds** — nothing enters without a record, and
> `0016` is that record. What is false is the *list*, and Rule 12's list is what an agent
> reads. **The testing framework remains unselected (`TS1`)**, and no Cloudflare product
> beyond `0003`'s six has been added: `wrangler.jsonc` binds only D1 and one Durable Object
> class, and lists no Queue, no R2 bucket and no KV namespace.
>
> **Three packages are not named by any decision and are owed one:** `wrangler` and
> `@types/node` (entailed by `0003`'s stack but never recorded as dependencies), and the
> shadcn/ui runtime trio `class-variance-authority` / `clsx` / `tailwind-merge` — `0016`
> approved shadcn/ui as **copy-in source, not a runtime dependency**, and these three are
> exactly the runtime dependencies that copy-in brought with it. Team Lead to record or
> remove them.

- **Check:** the dependency manifest and the Worker configuration name nothing outside the
  approved list — which is now `0003`'s six Cloudflare services plus `0016`'s npm set, and
  **the list in this rule is not the list to check against until the Team Lead updates it.**
  Every standard in this directory is written so that it does **not** depend on an unapproved
  product; where one is needed, the standard says so and stops.

---

## 4. How work is governed

### 4.1 No self-review

**The agent that writes an implementation is never the final approving agent.** The agent
that defines a contract is not the agent that implements it — which is why
`packages/contracts/**` moved to `architecture-agent` in `0004`.

### 4.2 Every task carries a specification

Before code starts, a task has, in writing: Objective · Affected
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

> **STALE, 2026-09-06 — the second bullet was withdrawn.** `docs/decisions/0030`
> (**Accepted**, 2026-09-06) supersedes the MVP framing in `CLAUDE.md`,
> `.claude/rules/architecture.md` §7, `.claude/rules/workflow.md` §10–§11 **and
> `docs/product/mvp-delivery-policy.md`** — the document the second bullet cites. Its
> decision 2: *"Milestone acceptance replaces the seven-step per-feature gate."* This entry
> is corrected rather than deleted, because a paragraph naming a withdrawn gate is precisely
> the residue `.claude/rules/workflow.md` §12 exists to catch, and it instructed.

- **Phases 0–3:** the Foundation Gate (`0005`), seven conditions ending in user approval.
  **Unaffected by `0030`**, which supersedes the MVP delivery policy and not `0005`.
- ~~**From the first runnable vertical feature (in practice Phase 4):** the full seven-step
  delivery gate (`docs/product/mvp-delivery-policy.md` §4).~~ **Withdrawn by `0030`.** Work
  proceeds continuously and stops at named milestones for the user to test and accept.
- **What `0030` did NOT withdraw, stated here because it is the half that gets dropped:**
  **production actions — migrations, deploys, credential changes, any spend — still require
  explicit user approval, each time.** `0030`: *"That control is not MVP overhead."*

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

An agent reads the standards relevant to its change **before** editing. This is a standing
condition on all agent work.

| If your change touches | Read |
|---|---|
| Anything at all | This document, `ARCHITECTURE.md` |
| `platform/core/**` | `CORE_BOUNDARIES.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md`, `SECURITY_STANDARD.md` |
| `apps/**` | `APP_STANDARD.md`, `API_STANDARD.md`, `EVENT_STANDARD.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md` |
| `platform/capabilities/**` | `CAPABILITY_STANDARD.md`, `APP_STANDARD.md`, `SECURITY_STANDARD.md` |
| `packages/sdk/**` | `SDK_STANDARD.md`, `CAPABILITY_STANDARD.md`, `APP_STANDARD.md`, `SECURITY_STANDARD.md` |
| Studio, or any App-authoring surface | `STUDIO_STANDARD.md`, `APP_STANDARD.md`, `AUTHORIZATION_STANDARD.md`, `AI_STANDARD.md` |
| Planning or executing Phase 4 | `ARCHITECTURE_VALIDATION_STANDARD.md` |
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
`architecture-agent`'s and are not decisions. A row marked **DECIDED** cites an **Accepted**
record and is no longer open — its right-hand column states the decision, not a
recommendation.

**Classified 2026-09-06 against the built system.** Every row carries one of three states.
**CLOSED** cites the file and line, decision record, or contract that closes it — a citation
and not an assertion, because *"a comment that cites a contract is a claim about that
contract"* (`.claude/rules/architecture.md` §3c). **STILL OPEN** names the decision needed and
who can make it. **CONTRADICTED** means the implementation went a different way; those are
reported to the Team Lead and are **not** resolved by rewriting this document to match.

| # | Question | State, and the recommendation or citation |
|---|---|---|
| C1 | **What is a "tenant"?** The event envelope carries both `tenant_id` and `business_id` (`EVENT_STANDARD.md` §3) but neither is defined as the isolation boundary. | **CLOSED — decided.** `docs/decisions/0006` (**Accepted**, user, 2026-09-01) §1.1 records it as already settled: *"The tenant is the Organization … The Team Lead reports this as confirmed by the user. This record takes it as given and does not re-open it. `business_id` is an authorization scope inside a tenant, never an isolation boundary."* Built that way: `platform/core/storage/adapters/sql/sql-compiler.ts:141` emits `tenant_id = ?` from a single `whereWithTenant`, and `platform/core/tenancy/tenant-context.ts:63` carries `organizationId` as the value behind it. The decision arrived as a settled premise in `0006` rather than as a record of its own — **acceptable, and worth the Team Lead noting**, because a load-bearing definition recorded in another decision's assumptions table is one nobody would think to grep for. |
| C2 | ~~**The tenancy implementation model.**~~ **DECIDED — `0006`, Status Accepted, by the user.** Retained here because other documents cite C2. | **Option A — one shared production D1 database — with mandatory indirection** through a Core-owned `TenantStoreResolver`: no App, plugin, Connector, or client selects a database or binding; an unknown Organization mapping fails closed; only Core-configured bindings are returned. **MVP-scoped:** decided for the Zero-Cost MVP only, while `0008` remains active. **Option B is excluded** for that period. **Option C (hybrid routing) is the approved migration candidate, not the current model, and moving to it requires user approval and a new decision record.** The earlier "hybrid routing recommended" recommendation is **superseded** — see `MULTITENANCY_STANDARD.md` §7.1 for the decided model and §7.9 for the superseded comparison. Nothing in this repository may treat the model as open. **Amended 2026-09-06: the words "MVP-scoped" above have lost their referent.** `docs/decisions/0030` withdrew the MVP framing and names `0006` as *"the pinch point"* by name: *"it chose one shared database 'for the Zero-Cost MVP' and that premise is gone."* `0030` deliberately does **not** reverse `0006` — one shared database remains correct at current scale — but it replaces the scoping clause with a requirement: **the choice must stay reversible**, and the single emission point in `sql-compiler.ts` is what makes it so. Read "MVP-scoped" as "scoped to the current scale, revisited on `0030`'s expandability constraint", not as a period that has ended. |
| C3 | **Search, Notifications, and Files are Core services *and* capability domains** (`CORE_BOUNDARIES.md` §3, `CAPABILITY_STANDARD.md` §3). Those two claims conflict. | **STILL OPEN — needs an architecture decision from the Team Lead**, and nothing since has touched it. None of the three exists: `platform/core/**` has no search, notification or file module, and `wrangler.jsonc` binds no R2 bucket. Recommendation unchanged — Core owns the primitive service; the Capability is the vendor-neutral interface Apps call; Core is the default provider (`CORE_BOUNDARIES.md` §4). **Not blocked on anything**; it is cheap to record now and expensive to discover when the first Capability is built. Same question as `ARCHITECTURE.md` A2 and `CORE_BOUNDARIES.md` §4 — one decision closes all three. |
| C4 | **Public API path namespacing.** A flat path such as `/api/v1/customers` assumes a global resource namespace, which cannot survive arbitrary third-party Apps. | **CLOSED IN PRACTICE, UNRECORDED — needs the Team Lead to ratify what is already deployed.** The split is built exactly as recommended: Core serves the flat namespace at `/api/v1` (`platform/core/http/core-routes.ts:67,98,109` — `/businesses`, `/businesses/names`) and the one App is mounted at `/api/v1/apps/customers` (`platform/core/http/api.ts:386–407`). A third reserved segment was added that this row did not anticipate — `/api/v1/platform/**` (`0025`), reserved structurally by `pre-auth-registry.ts:371–375` so no App route table can resolve onto it. **What is missing is the registry, not the rule:** `API_STANDARD.md` §5 requires that *"the flat namespace is allocated in a registry Core owns"*, and no such allocation list exists — `reservedApiPathSegments` in `core-object-registry.yaml` is named as owed by `pre-auth-registry.ts:366–369` and is still owed. Ratifying C4 is one line; the allocation registry is AS4. |
| C5 | **Phase 1's admin portal is runnable**, so `0005`'s trigger ("the first runnable vertical feature") fires before Phase 4. | **CLOSED — the question no longer arises.** `docs/decisions/0030` (**Accepted**, 2026-09-06) withdrew the seven-step delivery gate this row asked to choose between: *"Milestone acceptance replaces the seven-step per-feature gate."* There is no second gate for the admin portal to fall under. The Foundation Gate (`0005`) is untouched by `0030` and continues to apply to Phase 0–3 work. **Do not read this as the admin portal being ungated** — production actions still require explicit user approval every time (`0030`, decision 2; `SECURITY_STANDARD.md` §10). See §4.5, which carried the same stale reasoning and is corrected there. |
