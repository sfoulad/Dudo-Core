# Dudo Architecture

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** the shape of the whole system.
- **Depends on:** `CONSTITUTION.md`, `docs/decisions/0003`, `0004`.
- **Source:** master build plan §2, §5, §10, §11, §14, §23.

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

**AI Skills are not a separate runtime.** The master plan lists them as a fifth
marketplace type but describes them as functionality reached through the AI Capability. A
skill is therefore packaged and deployed as a Connector that provides the AI Capability;
"AI Skill" is a marketplace category, not an execution model. This is
`architecture-agent`'s reading of an under-specified area of the plan — see §9, A1.

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

**Do not write five independent definitions** (master plan §15). Five definitions become
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
- **Configuration and cache**: the master plan specifies KV; **KV is not approved**
  (`0003`). Until a record approves it, configuration is read from Core storage and cached
  in-request only. No standard in this repository depends on KV.

---

## 7. Environments

Local · Development · Staging · Production. Separate configuration, separate credentials,
separate data. Production actions require explicit user approval in the current
conversation, every time (`.claude/rules/security.md` §7).

Customer-generated Workers, when Phase 7 arrives, use a **staging namespace and a
production namespace** — not a namespace per customer. That runtime depends on Workers for
Platforms, which is **not approved**; Phase 7 is blocked on its own decision record.

---

## 8. Observability

Every request carries, and every log line includes: `request_id`, `tenant_id`,
`principal_id`, `app_id`, `correlation_id`. Tracked: errors, API latency, queue failures,
workflow failures, App crashes, Connector failures, AI calls, token and cost usage, MCP
calls, security violations.

Logs must never contain business data, another tenant's identifiers, or internal structure
returned to a caller (`SECURITY_STANDARD.md` §7). Observability that leaks is a data
breach with good intentions.

The master plan recommends Analytics Engine for analytics. **Analytics Engine is not
approved.** Structured logs from Workers, which are part of the platform itself, carry the
requirement until a record says otherwise.

---

## 9. Where the master plan is ambiguous

Recorded rather than papered over. Each needs a Team Lead decision; recommendations are
`architecture-agent`'s.

| # | Ambiguity | Recommendation |
|---|---|---|
| A1 | **AI Skills as a fifth extension type** (§2) are never given a runtime, a manifest, or a lifecycle distinct from Connectors. | Treat as a marketplace category of Connector providing the AI Capability. Recorded above; no separate runtime built. |
| A2 | **Core owns "search infrastructure", "notifications", and "file service"** (§6) while §2 lists Search, Notifications, and Files as *Capabilities*. | Core owns the primitive; the Capability is the interface; Core is the default provider. `CORE_BOUNDARIES.md` §4. |
| A3 | **Core owns platform billing** (§6) but Rule 6 forbids Core depending on an external integration. Charging a card requires a payment provider. | Core owns billing *state* — plans, quotas, usage, subscription status. Money movement is invoked through the Payment **Capability contract**, which is a contract dependency, not a connector dependency. `CORE_BOUNDARIES.md` §5. |
| A4 | **Per-App logical data ownership × per-tenant isolation** multiplies storage units by Apps × tenants. The plan never confronts what that means against D1's limits. | The storage port must make the physical mapping a routing decision, not an App-visible one. `MULTITENANCY_STANDARD.md` §7. |
| A5 | **Egress control** is required by the App manifest's `externalNetworkAccess` (§8) but the enforcement mechanism described (§13) is the Workers for Platforms outbound Worker — **not approved**. | Declare the allowlist in the manifest from Phase 2 and enforce it in the Connector/SDK egress helper; full enforcement needs the Phase 7 record. Gap flagged, not hidden. |
| A6 | **Two versioning schemes** — `/api/v1` for APIs (§3 Rule 9), integer `event_version` for events (§11) — are never reconciled. | Keep both; they version different things. Defined in `API_STANDARD.md` §6 and `EVENT_STANDARD.md` §7. |
