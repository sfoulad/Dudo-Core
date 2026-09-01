# Dudo — System Boundaries

The authoritative map of who owns what and how the parts are allowed to talk. The
contribution and security rules that follow from this document are in `CONTRIBUTING.md`
and `SECURITY.md`.

> **Stack:** `Dudo-Core` is TypeScript on Cloudflare (`0003`); `Dudo-Apple` is Swift,
> SwiftUI, and Xcode (`0002`). No web framework, testing framework, or third-party
> dependency is selected. This document describes structure and responsibility.

## Repositories

Dudo is built in two public repositories
(`docs/decisions/0002-repository-and-mvp-delivery-strategy.md`), meeting **only** through
the published contract set:

| Repository | Contents |
|---|---|
| **`sfoulad/Dudo-Core`** | `platform/`, `apps/`, `connectors/`, `packages/`, `agents/`, `docs/` — layout fixed by `docs/decisions/0004-repository-structure.md` |
| **`sfoulad/Dudo-Apple`** | Native Apple application — Xcode, Swift, SwiftUI; iPhone, iPad, macOS |

Both repositories exist and are public. `Dudo-Apple` is intentionally empty until its
Xcode project is approved.

## Modules

### Web experience — `platform/web/**` in `Dudo-Core` (owner: `web-agent`)

The responsive browser surface, across desktop, tablet, and phone widths. Renders,
collects input, handles routing, presentation state, and accessibility.

- Consumes contracts from `packages/contracts/**`.
- **Contains no business rules.** Pricing, tax, entitlement, approvals, workflow
  transitions, and permission decisions belong to Core.
- **Performs no direct data access.** No SQL, ORM models, datastore clients, or
  connection strings.
- Never authors a contract.
- Does not edit `Dudo-Apple`.

### Apple experience — `Dudo-Apple` (owner: `app-agent`)

The native application for iPhone, iPad, and macOS: Xcode, Swift, SwiftUI, with a **true
native macOS destination — never Mac Catalyst**. A shared multiplatform codebase, with
platform-specific implementations where Apple UX genuinely differs.

- Consumes the **same** contracts from `Dudo-Core`'s `packages/contracts/**`.
- Same prohibitions as the web experience: no business rules, no direct data access,
  never authors a contract.
- Does not edit `Dudo-Core`. Test targets belong to `qa-agent`.

### Contracts — `packages/contracts/**` (owner: `architecture-agent`)

Every boundary crossing in the system. Authored **only** here, and never by the agent
that implements against them — the separation is what makes review independent.

- **All cross-module contracts originate here.** No other module may author one, and
  **both clients consume one approved set** — divergence between web and Apple is a
  contract defect, not a client workaround.
- A contract defines the request shape, the response shape, error cases, the
  authorization expectation, and the tenant scope.
- Also owns `docs/architecture/**` specifications and `agents/**`.

### Core — `platform/core/**` (owner: `core-agent`)

The domain. Business rules, application services, APIs, authorization, tenant
isolation, workflows, and auditing.

- **Core stays small.** Platform primitives only; business functionality belongs in an
  App under `apps/` or in a Capability.
- Implements against contracts; **does not author them.**
- **Cloudflare services stay replaceable** — no Cloudflare type, client, or binding in
  domain logic.
- Decides authorization on every entry point; denies by default.
- Enforces tenant scope on every data path.
- Emits audit records for money, permissions, membership, export, and destructive
  operations.
- Does not depend on `platform/web/**`, `apps/**`, or `connectors/**`.

### Business Apps — `apps/**` (owner: assigned per App)

**Reserved for installable business Apps** — CRM, Finance, Projects, Inventory, HR.
Nothing else belongs here.

- An App owns its logic, data, API, events, permissions, UI, and tests.
- **No cross-App database access.** Apps meet through internal APIs and events only.
- Apps request **capabilities, not vendors**.
- Official Apps use exactly the SDK third-party developers use — no privileged path.
- Per-App suites colocate at `apps/<name>/tests/`, owned by `qa-agent`.

### Extensibility — `platform/capabilities/**`, `packages/sdk/**`, `connectors/**` (owner: `plugin-agent`)

The capability registry, the App runtime, the SDK developers build against, and the
adapters to external platforms.

- Apps reach Core **only** through explicit, versioned contracts.
- **No direct storage access** — no database connections, SQL, ORM models, Core caches,
  or Core files. No exception, including first-party plugins.
- Never bypasses authorization and never selects its own tenant.
- Consumes contracts; never authors them.

### Verification — `packages/testing/**`, `apps/*/tests/**`, and Apple test targets (owner: `qa-agent`)

Unit, integration, contract, security, tenant-isolation, and regression suites, across
**both** repositories.

- Reads both repositories in full; edits only test code.
- Never modifies production feature code; reports defects to the owning agent.
- Never weakens a test to produce a pass.
- Verifies **both** clients against one published contract set, and catches
  cross-repository drift.
- **Does not own root-level shared test configuration** — that is the Team Lead's. QA
  proposes changes to it (`docs/decisions/0001-governance-and-decision-sequencing.md`).

### Team Lead

Owns the repository root, shared configuration, **releases, integration, root-level
shared test configuration** and `docs/**`. Assigns work, sequences it,
prevents concurrent edits, integrates results, and performs step 6 of the feature
completion gate.

## Allowed dependencies

```
      Dudo-Apple  ────────┐
                          │
   platform/web/  ────────┤
                          ├──►  packages/contracts/  ◄──── architecture-agent
          apps/  ─────────┤            ▲                      (sole author)
                          │            │
    connectors/  ─────────┘            │
                                       │
   platform/capabilities/ ─────────────┤
        │                              │
        └── packages/sdk/ ─────────────┘

   platform/core/  ──► implements the contracts (domain, authz,
                                                 tenancy, audit)

   packages/testing/  ──── reads everything, both repositories
```

- `platform/web/` → `packages/contracts/` **only**.
- `Dudo-Apple` → `packages/contracts/` **only**, across the repository boundary.
- `apps/` → `packages/sdk/` → `packages/contracts/` **only**. Never another App's storage.
- `connectors/` → the capability contract they implement **only**.
- `platform/capabilities/` → `packages/sdk/` → `packages/contracts/` **only**.
- `platform/core/` implements contracts; it depends on nothing above it.
- `packages/testing/` reads everything and depends on nothing.
- **The two client repositories never depend on each other.**

## Forbidden edges

| Forbidden | Why |
|---|---|
| Either client → database or datastore | Business data access belongs to Core |
| Either client holding business rules | Rules must be enforced server-side, once |
| `platform/web/` ↔ `Dudo-Apple` direct dependency | Clients meet only through contracts |
| Anything in `apps/` that is not an installable business App | `apps/` is reserved; clients and libraries belong elsewhere |
| An App reaching another App's storage | Apps meet through APIs and events only |
| An App depending on a named vendor | Apps request capabilities; Connectors supply vendors |
| A Cloudflare type or binding in domain logic | Services must stay replaceable behind a Core interface |
| One client's contract shape diverging from the other's | One approved contract set serves both |
| Credentials, certificates, provisioning profiles, or env files in either repository | Both are public; exposure is permanent |
| An App or the runtime → database, Core cache, or Core files | Extensions must never touch storage |
| An App or the runtime → Core internals (bypassing contracts) | Breaks isolation and authorization |
| Anyone but Core authoring a contract | Contracts must have a single author |
| Any module resolving its own tenant from client input | Breaks tenant isolation |
| Any agent editing outside its ownership | Causes concurrent edits and lost work |

## Boundary crossings

Every crossing is a **contract**: a request shape, a response shape, error cases, the
authorization expectation, and the tenant scope. Types alone are not contracts.

Sequence — never out of order:

1. Team Lead identifies the cross-module need.
2. `architecture-agent` authors the contract in `packages/contracts/**`.
3. Team Lead reviews; the contract is agreed.
4. Consumers implement against it.
5. `qa-agent` writes contract tests binding producer and consumer.

A missing contract blocks the consumer. It is requested from the Team Lead — never
stubbed, guessed, or worked around.

## Tenant boundary

The tenant boundary cuts through every layer. Tenant identity is derived from the
authenticated server-side context and never from client-supplied input, a plugin, or an
ambient default. Every query, cache key, job, file path, and export carries it.
Cross-tenant access is a critical defect wherever it appears — including tests,
fixtures, logs, and error messages.

## Open questions

- **The tenancy implementation model** (shared schema, schema-per-tenant,
  database-per-tenant). D1 is single-threaded per database — roughly 1,000 queries/second
  at 1 ms — which argues against a shared database, while the zero-cost constraint argues
  for starting shared (`docs/decisions/0006`, `0008`). Resolve before Phase 1.
- The web framework, the testing framework, and every third-party dependency. `0003`
  approves TypeScript and six Cloudflare services, nothing more.
- Contract transport and versioning mechanics — now a **cross-repository** coordination
  problem serving two clients.
- **App isolation mechanism.** `0001` bound it to the stack decision; `0003` did not
  approve Workers for Platforms, so it still needs its own record.
- Service topology: modular monolith vs. separate deployables.
- Where `Dudo-Apple`'s test targets live, for `qa-agent` ownership purposes — open until
  the Xcode project exists.
- The software license for both public repositories — an open **user** decision.

All of these need a decision record under `docs/decisions/` before being built on.
