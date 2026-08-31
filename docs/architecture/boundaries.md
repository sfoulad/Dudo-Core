# Dudo — System Boundaries

The authoritative map of who owns what and how the parts are allowed to talk. The
contribution and security rules that follow from this document are in `CONTRIBUTING.md`
and `SECURITY.md`.

> **The `Dudo-Core` technology stack has not been selected.** Swift, SwiftUI, and Xcode
> are approved for `Dudo-Apple` only. This describes structure and responsibility.

## Repositories

Dudo is built in two public repositories
(`docs/decisions/0002-repository-and-mvp-delivery-strategy.md`), meeting **only** through
the published contract set:

| Repository | Contents |
|---|---|
| **`sfoulad/Dudo-Core`** | `core/`, `packages/contracts/`, `apps/` (responsive web app), `plugins/`, `packages/plugin-sdk/`, `tests/`, `docs/` |
| **`sfoulad/Dudo-Apple`** | Native Apple application — Xcode, Swift, SwiftUI; iPhone, iPad, macOS |

Both repositories exist and are public. `Dudo-Apple` is intentionally empty until its
Xcode project is approved.

## Modules

### Web experience — `apps/**` in `Dudo-Core` (owner: `web-agent`)

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

### Core — `core/**` and `packages/contracts/**` (owner: `core-agent`)

The domain. Business rules, application services, APIs, authorization, tenant
isolation, workflows, and auditing — plus every shared contract in the system.

- **All cross-module contracts originate here.** No other module may author one, and
  **both clients consume one approved set** — divergence between web and Apple is a
  contract defect, not a client workaround.
- Decides authorization on every entry point; denies by default.
- Enforces tenant scope on every data path.
- Emits audit records for money, permissions, membership, export, and destructive
  operations.
- Does not depend on `apps/**` or `plugins/**`.

### Extensibility — `plugins/**` and `packages/plugin-sdk/**` (owner: `plugin-agent`)

The plugin runtime, host, loader, and the SDK third parties build against: manifests,
lifecycle, permission declarations, and extension interfaces.

- Plugins reach Core **only** through explicit, versioned contracts.
- **No direct storage access** — no database connections, SQL, ORM models, Core caches,
  or Core files. No exception, including first-party plugins.
- Never bypasses authorization and never selects its own tenant.
- Consumes contracts; never authors them.

### Verification — `tests/**` and Apple test targets (owner: `qa-agent`)

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
   Dudo-Apple  ─────────┐
                        │
      apps/  ───────────┼──►  packages/contracts/  ◄──── core/  (author)
                        │                                  │
   plugins/ ────────────┘                                  │
        │                                                  ▼
        └── packages/plugin-sdk/                    (domain, authz,
                                                     tenancy, audit)
   tests/  ──── reads everything, both repositories
```

- `apps/` (web) → `packages/contracts/` **only**.
- `Dudo-Apple` → `packages/contracts/` **only**, across the repository boundary.
- `plugins/` → `packages/plugin-sdk/` → `packages/contracts/` **only**.
- `core/` → `packages/contracts/` (as author). Core depends on nothing above it.
- `tests/` reads everything and depends on nothing.
- **The two client repositories never depend on each other.**

## Forbidden edges

| Forbidden | Why |
|---|---|
| Either client → database or datastore | Business data access belongs to Core |
| Either client holding business rules | Rules must be enforced server-side, once |
| `apps/` ↔ `Dudo-Apple` direct dependency | Clients meet only through contracts |
| One client's contract shape diverging from the other's | One approved contract set serves both |
| Credentials, certificates, provisioning profiles, or env files in either repository | Both are public; exposure is permanent |
| `plugins/` → database, Core cache, or Core files | Plugins must never touch storage |
| `plugins/` → Core internals (bypassing contracts) | Breaks isolation and authorization |
| Anyone but Core authoring a contract | Contracts must have a single author |
| Any module resolving its own tenant from client input | Breaks tenant isolation |
| Any agent editing outside its ownership | Causes concurrent edits and lost work |

## Boundary crossings

Every crossing is a **contract**: a request shape, a response shape, error cases, the
authorization expectation, and the tenant scope. Types alone are not contracts.

Sequence — never out of order:

1. Team Lead identifies the cross-module need.
2. `core-agent` authors the contract in `packages/contracts/**`.
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

- The `Dudo-Core` technology stack — language, framework, database, hosting, web
  framework. Not selected.
- The tenancy implementation model (shared schema, schema-per-tenant, database-per-tenant).
- Contract transport and versioning mechanics — pending the stack decision, and now a
  **cross-repository** coordination problem serving two clients.
- Plugin isolation mechanism (process, sandbox, or runtime-level) — decided jointly with
  the `Dudo-Core` stack per `0001`.
- Service topology: modular monolith vs. separate deployables.
- Where `Dudo-Apple`'s test targets live, for `qa-agent` ownership purposes — open until
  the Xcode project exists.
- The software license for both public repositories — an open **user** decision.

All of these need a decision record under `docs/decisions/` before being built on.
