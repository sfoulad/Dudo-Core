# Dudo Architecture

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** the shape of the whole system.
- **Depends on:** `CONSTITUTION.md`, `docs/decisions/0003`, `0004`.
- **Reconciled against the built system 2026-09-06.** §9 classifies all six ambiguities — **A4
  closed, A1, A2, A3, A5 and A6 still open**, with four of the five open ones blocked on the
  same root: nothing above Core has been built. Two contradictions are marked where the claim
  is made: **§3's request lifecycle** (see §3.1 — there are four request classes, not one, and
  three of them skip stages by accepted decision) and **§7's environments** (there is one
  environment and it is production). **§2's dependency directions hold as built**, including
  the one that is easiest to break: the deployment entry module sits at the repository root so
  that mounting an App does not require Core to import one.

`CONSTITUTION.md` says what may not be violated. This document says what the system *is*.
Ownership and forbidden edges are in `docs/architecture/boundaries.md`; this document does
not restate them.

---

## 1. The five extension types

Everything a customer installs, and everything a developer publishes, is one of five
things. There is no sixth, and adding one is a Constitution amendment.

| Type | What it is | Lives in | Standard |
|---|---|---|---|
| **App** | A complete business application. CRM, Appointments, Inventory, Finance Health. Owns logic, data, API, events, permissions, UI, tests. | `apps/**` | `APP_STANDARD.md` |
| **Capability** | A vendor-neutral interface for reusable functionality: Payment, Messaging, Shipping, OCR, Search, AI. Apps request these. | `platform/capabilities/**` | `CAPABILITY_STANDARD.md` |
| **Connector** | A provider that implements a Capability against one external platform. Stripe, DHL, WhatsApp, an IoT gateway. | `connectors/**` | `CONNECTOR_STANDARD.md` |
| **AI Skill** | A reusable AI/ML function — invoice extraction, translation, classification — exposed through the AI Capability. | `connectors/**` (as an AI-capability provider) | `AI_STANDARD.md` |
| **Template** | A pre-configured combination of Apps and settings for a business type: Salon, Dental Clinic, Gym. Carries no code. | *not yet built — Phase 6* | — |

The user selects a **business type**, not a set of technical modules. Templates are how
that promise is kept.

**AI Skills are not a separate runtime.** They are a fifth marketplace type, but the
functionality is reached through the AI Capability. A skill is therefore packaged and
deployed as a Connector that provides the AI Capability; "AI Skill" is a marketplace
category, not an execution model. This is `architecture-agent`'s reading of an
under-specified area — see §9, A1.

---

## 2. Layers and the direction of dependency

```
                    Clients          platform/web/**      Dudo-Apple
                       │                     │                 │
                       └──────────┬──────────┴─────────────────┘
                                  ▼
                    Edge          Edge / API Worker
                                  │   authentication → tenant resolution →
                                  │   authorization → schema validation →
                                  │   rate limit → idempotency → routing
                                  ▼
                 Gateway          Action / Capability gateway
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       ▼                          ▼                          ▼
   Core services              Business Apps            Capability providers
   platform/core/**             apps/**                 connectors/**
   identity, authz,           domain logic,             one vendor each
   tenancy, billing,          entities, actions
   marketplace, audit
       │                          │                          │
       └──────────────────────────┴──────────────────────────┘
                                  │
                    Async         Events → Queues → Workflows
                                  │
                    Storage       Storage ports (D1 · R2) — adapters only
```

**Dependencies point inward, toward `packages/contracts/**`.** Concretely:

- Clients depend on contracts. Nothing else.
- Apps depend on `packages/sdk/**`, which depends on contracts.
- Connectors depend on the capability contract they implement, and on nothing in Core.
- Core implements contracts and depends on nothing above it. **Core never imports an App,
  a Connector, or a client.**
- Nothing depends on a Cloudflare type except an adapter (`CLOUDFLARE_STANDARD.md` §2).

A dependency that points the wrong way is a defect, not a shortcut. It is usually the
first symptom of business logic having landed in Core.

---

## 3. The request lifecycle

Every authenticated request — from the web client, the Apple client, an external
developer, a Connector callback, or an AI agent over MCP — passes the same stages, in
this order. **No stage may be skipped, and no caller may be trusted to have done one.**

| # | Stage | Fails with | Detail |
|---|---|---|---|
| 1 | **Authenticate** | `unauthenticated` | Establish the principal. Never from a client-supplied identifier. |
| 2 | **Resolve tenant** | `unauthenticated` | Derived from the authenticated context, server-side. Never from a header, parameter, body field, or hostname the caller controls. `MULTITENANCY_STANDARD.md` §3. |
| 3 | **Authorize** | `forbidden` | Principal + Role + Permission + Scope, decided in Core, deny by default. `AUTHORIZATION_STANDARD.md`. |
| 4 | **Validate** | `invalid_argument` | Against the Action's declared input schema. Reject unknown fields. |
| 5 | **Rate limit / quota** | `rate_limited`, `quota_exceeded` | Per tenant and per principal. |
| 6 | **Idempotency** | — | For unsafe methods carrying an idempotency key. `API_STANDARD.md` §8. |
| 7 | **Execute the Action** | domain errors | The single implementation shared by UI, API, SDK, and MCP. |
| 8 | **Audit** | — | For every sensitive operation. `SECURITY_STANDARD.md` §6. |
| 9 | **Publish events** | — | After the state change commits, never before. `EVENT_STANDARD.md` §6. |

Stages 1–6 are Core's responsibility and happen in Core, once. An App that re-implements
any of them has duplicated a security decision, and duplicated security decisions diverge.

### 3.1 CONTRADICTED, 2026-09-06 — there are four request classes, not one

**"No stage may be skipped" is false of the deployed system, and it is false by accepted
decision rather than by drift.** Three route classes were built that this table does not
describe, each skipping stages, each argued in its own record.

| Class | Record | Stages 1–9 it runs | Where |
|---|---|---|---|
| **Pre-authentication entry point** | `0014` §B | **None of them.** No principal, no tenant, no permission, no Action. Five paths, closed union, never manifest-declarable | The `PreAuthEntryPointId` union and `preAuthEntryPoints()` in `platform/core/identity/pre-auth-registry.ts`; dispatched from the `matchPreAuthEntryPoint` branch in `platform/core/http/api.ts` |
| **Session route** | `0021` | Stage 1 **at session level only**. No principal, no tenant, no permission | The `SessionRouteId` union and `sessionRoutes()` in `platform/core/identity/session-routes.ts`; dispatched from the `matchSessionRoute` branch in `api.ts` |
| **Platform route** | `0025` decision 3 | Stages 1, 3, 4, 5, 8. **No stage 2** — no tenant, deliberately | The frozen `ROUTES` array in `platform/core/platform/platform-routes.ts`; dispatched from the `matchPlatformRoute` branch in `api.ts` |
| **Action** | this table | All nine, unchanged | The `invokeAction` call in `api.ts` → `platform/core/action/pipeline.ts` |

> **DE-NUMBERED 2026-09-09, AND THE RANGES WERE NOT REPLACED WITH BIGGER RANGES.** Every cell above
> carried a line range — `pre-auth-registry.ts:95–100`, `session-routes.ts:62–64`,
> `platform-routes.ts:332–709`, `api.ts:499–511`, plus four dispatch ranges. **Renumbering buys a
> few days and rots identically**, so each now names the file and the exported symbol, which is
> what a reader can check. `architecture.md` §3c: *in a file of repeated same-shaped blocks a line
> number is not an identifier.*
>
> **THE PLATFORM RANGE HAD ALREADY GONE WRONG, AND BY MORE THAN ONE ROUTE.** `ROUTES` runs to line
> 805 today and the range stopped at 709, so **it covered 11 of the 15 platform routes** —
> `templates.create`, `templates.list`, `templates.read` and `organizations.identity.update` all
> sit below it. It was accurate when this section was written on 2026-09-06 and the array has
> grown twice since.
>
> **THAT IS A DIFFERENT FAILURE FROM A MISCITED PIN AND THE DIFFERENCE MATTERS.** A pin quoting a
> value from the wrong block **misattributes** — `§3c`'s worst variant. A range naming where a
> table lives **UNDER-COVERS**: it does not error, nothing goes red, and **it reads exactly like a
> correct citation**, because an agent that follows it gets a real answer to a silently truncated
> question. That is `workflow.md` §11a's *"a floor proves the check found SOMETHING, not
> EVERYTHING"* wearing a citation's clothes, and **this repository has no check that catches a
> pointer resolving to less than the thing it names.**
>
> **AND THE LARGER DEFECT WAS NOT STALENESS AT ALL — THIS TABLE WAS NEVER INTERNALLY CONSISTENT.**
> Rows 1 and 2 cited **id union types** (`PreAuthEntryPointId:95–100`, `SessionRouteId:62–64`) while
> row 3 cited **the routes array** (`platform-routes.ts:332–709`). Those are **two different notions
> of "where the class lives"** — a closed union of identifiers, and the table of route definitions
> — sitting in adjacent rows with **nothing in the citations to reveal that the question had been
> answered two different ways.** A reader comparing rows 1 and 3 was comparing two kinds of answer
> and had no way to know it, **in the document whose job is telling an agent where the request
> classes are.** Every row now names both where the ids are declared and where the routes are
> defined, so the rows answer the same question.
>
> **De-numbering removes this class of defect rather than policing it.** A check over ranges would
> have to know what each range *should* span — which is the thing the range was standing in for —
> so there is no cheap validator here and none is proposed. Where a citation can be made
> unfalsifiable-by-inspection into one a reader can check, that is the fix.

**The skips are the point, not a shortcut, and the argument is worth carrying here rather
than leaving in three records.** `0021`, on refusing a tenant-optional branch inside the
pipeline: *"it would work, and every future reviewer of every future Action would then have
to check which side of that branch it lands on."* And: **"the invariant that an Action always
has a tenant is worth more than the code it saves."** So the platform chose four small,
separately-typed classes over one pipeline with optional stages — a pseudo-principal with a
null `organizationId` was named and refused in both records, because it *"would flow through
the authorization pipeline and could accumulate grants"* (`0014` §B).

**What this table must be read as saying, until the Team Lead rewrites it:** *every request
that reaches an Action passes all nine stages in this order, and no Action may skip one.*
That is still true and is enforced structurally — `api.ts` returns from each class's block
before `invokeAction` is reachable, so there is no code path by which a session or platform
route becomes an Action with stages missing.

**What is genuinely owed:** this document, not the three decision records, is what an agent
reads before touching a route (§5 of `CONSTITUTION.md` makes it required reading for *any*
change). A reader of §3 alone would conclude a fifth class must run all nine stages, and
would be wrong in the direction that adds a tenant requirement to a route that cannot have
one. **Team Lead to decide whether §3 is rewritten around the four classes or whether this
subsection stands as the amendment.**

---

## 4. One Action, six surfaces

An **Action** is the unit of business capability: a named, authorized, validated,
tenant-scoped operation such as `appointments.CreateAppointment`.

From **one** Action definition the platform derives:

```
                     Action definition
                            │
   ┌────────┬───────────┬───┴────┬──────────┬───────────────┐
   ▼        ▼           ▼        ▼          ▼               ▼
Internal  Public   OpenAPI    SDK       MCP tool     Documentation
  API      API     schema    method
```

**Do not write five independent definitions.** Five definitions become
four definitions and one bug, and the one that drifts is always the one with the weakest
tests.

The Action definition owns: id, title, description, input schema, output schema, error
set, required permission, scope, sensitivity class, idempotency, and whether it is exposed
publicly and to AI. `API_STANDARD.md` §1 defines it normatively.

---

## 5. Synchronous and asynchronous

**Synchronous** — a caller needs the answer to continue.

- Between Workers: Service Bindings/RPC against a published contract. Never public HTTP.
- Latency and failure are the caller's problem, so synchronous chains stay short. A
  request that fans out synchronously across three services is a design smell; the third
  hop belongs on a queue.

**Asynchronous** — something happened and others may care.

- Events over Queues, envelope per `EVENT_STANDARD.md`.
- Publishers do not know their consumers and must never be changed to accommodate one.
- Delivery is at-least-once, ordering is not guaranteed, so **every consumer is
  idempotent**. This is a property consumers must have, not an aspiration.

**Long-running or multi-step** — Workflows. Workers have a CPU-time budget and no
long-running process model (`0003`), so anything durable, retryable, or spanning minutes
is a Workflow by design rather than as a workaround.

**Genuinely coordinated state** — Durable Objects, and only with a written justification
recorded in the task specification (`CLOUDFLARE_STANDARD.md` §7). "It would be convenient"
is not a justification.

---

## 6. Data

- **Core metadata** lives in Core-owned storage: users, organizations, businesses,
  branches, teams, roles, permissions, app registry, installations, plans, marketplace
  metadata. Enumerated in `packages/contracts/registries/core-object-registry.yaml`.
- **Application data** is owned by the App, logically. **The physical storage layout is
  hidden behind a storage port** — an App receives a scoped handle, never a database.
  This is what makes the tenancy model changeable later (§7 of
  `MULTITENANCY_STANDARD.md`), and it is why the port must exist from the first App rather
  than being introduced when the model changes.
- **Files** live in R2, every object keyed with tenant and App ownership.
- **Configuration and cache**: the intended store is KV; **KV is not approved** (`0003`).
  Until a record approves it, configuration is read from Core storage and cached in-request
  only. No standard in this repository depends on KV.

---

## 7. Environments

Local · Development · Staging · Production. Separate configuration, separate credentials,
separate data. Production actions require explicit user approval in the current
conversation, every time (`.claude/rules/security.md` §7).

> **CONTRADICTED, 2026-09-06 — there is one environment, and it is production.**
> `wrangler.jsonc` declares **no `env` block**. Its two `d1_databases` entries carry literal
> production `database_id` values (`wrangler.jsonc:141,147`) and its `routes` are the live
> custom domains `app.dudo.work` and `api.dudo.work` (lines 63–66). `wrangler.admin.jsonc` is
> a second Worker, not a second environment. There is a `deploy:staging` script
> (`package.json:23`) invoking `wrangler deploy --env staging` against **an environment no
> configuration file defines** — it cannot succeed as written.
>
> `docs/decisions/0006` §0.3 allocated database slot 3 as a *"Combined staging database"*, and
> `MULTITENANCY_STANDARD.md` §7.4 carries that budget. **It has not been created**, and the two
> databases that exist are both production.
>
> **Two consequences, and the second is the one that matters.** First, `0017` accepted the
> in-process pre-auth limiter *"Staging only"* — there is no staging, so that condition is
> unmet wherever the limiter is deployed. Second, **the separation this section requires is
> what makes "production actions require explicit user approval" a meaningful boundary**; with
> one environment, every migration and every deploy is a production action, which is why
> `package.json:17–21` splits the `:local` and `:remote` migration scripts by name rather than
> by flag. That split is the substitute for environment separation and should be read as such.
>
> **Team Lead's to route.** Either staging is created and this section becomes true, or the
> section is narrowed to what the project actually operates and the `deploy:staging` script is
> removed rather than left as an affordance for an environment that does not exist.

Customer-generated Workers, when Phase 7 arrives, use a **staging namespace and a
production namespace** — not a namespace per customer. That runtime depends on Workers for
Platforms, which is **not approved**; Phase 7 is blocked on its own decision record.

> **Clarified 2026-09-06 by `docs/decisions/0030`, which settles the scope of that block.**
> *"Workers is free. Workers for Platforms is a different product and is paid-only. The
> similarity of the names is the whole confusion."* The block covers **only third-party code
> execution** — an open marketplace where third parties upload and run code. It does **not**
> block tenancy, Apps as a concept, or the capability model, and `0006` had already recorded
> that. **First-party Apps as separate Workers, deployed by Dudo and reached through service
> bindings with least-privilege bindings per App, are free and available today** — `0030` calls
> that *"a real isolation boundary, not a pretend one."*

---

## 8. Observability

Every request carries, and every log line includes: `request_id`, `tenant_id`,
`principal_id`, `app_id`, `correlation_id`. Tracked: errors, API latency, queue failures,
workflow failures, App crashes, Connector failures, AI calls, token and cost usage, MCP
calls, security violations.

Logs must never contain business data, another tenant's identifiers, or internal structure
returned to a caller (`SECURITY_STANDARD.md` §7). Observability that leaks is a data
breach with good intentions.

Analytics Engine is the recommended analytics store. **Analytics Engine is not approved**
(`CLOUDFLARE_STANDARD.md` §1). Structured logs from Workers, which are part of the platform
itself, carry the requirement until a record says otherwise.

---

## 9. Where the architecture is ambiguous

Recorded rather than papered over. Each needs a Team Lead decision; recommendations are
`architecture-agent`'s.

**Classified 2026-09-06 against the built system**, on the three states defined in
`CONSTITUTION.md` §7. **Five of the six are still open and four of those five are blocked on
the same root:** *nothing above Core has been built.* There is one App, no Capability, no
Connector, no SDK and no marketplace, so A1, A2, A3 and A5 have had nothing to press against.
That is a reason to record them cheaply now, not a reason to defer them again — each is a
model decision whose cost rises the moment the first Capability exists.

| # | Ambiguity | State, and the recommendation or citation |
|---|---|---|
| A1 | **AI Skills as a fifth extension type** are never given a runtime, a manifest, or a lifecycle distinct from Connectors. | **STILL OPEN — needs an architecture decision (Team Lead).** Blocked on nothing; unexercised because `connectors/` holds no provider and no AI Capability exists. Recommendation unchanged: a marketplace category of Connector providing the AI Capability, with no separate runtime. **Note for whoever records it:** `0025` established the precedent that an extension type can arrive early and inert — a `Template` is §1's fifth type, built five phases ahead of its phase and *"complete and inert on arrival"*. An AI Skill may arrive the same way, and deciding its shape now costs one record. |
| A2 | **Core owns search infrastructure, notifications, and a file service**, while Search, Notifications, and Files are also capability domains (`CAPABILITY_STANDARD.md` §3). | **STILL OPEN — needs an architecture decision (Team Lead).** None of the three exists in `platform/core/**`, and `wrangler.jsonc` binds no R2 bucket, so the file service has no storage either. Recommendation unchanged. **Same question as `CONSTITUTION.md` C3 and `CORE_BOUNDARIES.md` §4 — one decision closes all three, and they should be closed together rather than three times.** |
| A3 | **Core owns platform billing** but Rule 6 forbids Core depending on an external integration. Charging a card requires a payment provider. | **STILL OPEN — needs an architecture decision (Team Lead), and it is not urgent.** No billing exists: no plan, quota, usage or subscription table in either migration set, and `platform/core/**` has no billing module. Recommendation unchanged — Core owns billing *state*; money movement goes through the Payment **Capability contract**. **Interacts with `SECURITY_STANDARD.md` SE3:** PCI scope is decided by this design, and `SE3`'s recommendation (never store full instrument numbers) is the constraint this decision must satisfy. Record both together, before `payment@1`. |
| A4 | **Per-App logical data ownership × per-tenant isolation** multiplies storage units by Apps × tenants, which is never confronted against D1's limits. | **CLOSED for the current model — decided, then re-scoped.** `0006` (**Accepted**, user, 2026-09-01) makes the physical mapping a routing decision behind `TenantStoreResolver`, exactly as recommended: no App, plugin, Connector or client selects a database or a binding. Built — `platform/core/tenancy/tenant-store-resolver.ts` and `directory-tenant-store-resolver.ts`, with the predicate emitted at one point (`platform/core/storage/adapters/sql/sql-compiler.ts:141`). The multiplication does not arise under one shared database. **`0030` re-scopes rather than reopens it:** *"anything that assumes exactly one database exists"* is now a named violation, and the requirement is that the choice stay **reversible**. So the storage port's existence is not optional and is not an abstraction awaiting a second consumer — it is the mechanism `0030` names. **The arithmetic A4 asked for is still owed**, as `0030`'s *"a measured capacity model"*: the 100–150-business estimate is arithmetic, not measurement, and is to be measured against a seeded workload. |
| A5 | **Egress control** is required by the App manifest's `externalNetworkAccess` (`APP_STANDARD.md` §4) but the intended enforcement mechanism is the Workers for Platforms outbound Worker — **not approved**. | **STILL OPEN — and the block is now precisely scoped rather than total.** `0030` settles what Workers for Platforms gates: *only* third-party code execution, not tenancy, not Apps, not the capability model. **First-party Apps as separate Workers with least-privilege bindings are free and available today**, and a first-party App reached by service binding has no ambient egress to control — its network access is the bindings it was given. So the recommendation splits: **first-party egress is a binding question, decidable now**; **third-party egress remains blocked on Phase 7's record** with the rest of untrusted execution. Nothing is exercised — `connectors/` is empty and no SDK egress helper exists. |
| A6 | **Two versioning schemes** — `/api/v1` for APIs (`CONSTITUTION.md` Rule 9), integer `event_version` for events (`EVENT_STANDARD.md` §3) — are never reconciled. | **STILL OPEN, and a third scheme has appeared that this row does not cover.** The two named schemes are fine and the recommendation stands — they version different things. **What is new:** contracts carry their own `-v1` suffix in the filename (`login-v1`, `confirmation-v1`, `customer-directory-v1` — thirteen sets in `packages/contracts/`), and **that is a third versioning axis nothing reconciles with the first two.** A contract may be revised without a version bump (`business-read-v1` changed its resolve route from `GET` to `POST` on 2026-09-04 and stayed `v1`) while `/api/v1` is unchanged and no event exists. **And the `/auth/**` and `/health` routes have no version at all** — see `CONSTITUTION.md` Rule 9's contradiction note. Team Lead: this is AS1's neighbour and should be recorded with it, as contract versioning mechanics (`docs/decisions/README.md` scheduled item 4). |
