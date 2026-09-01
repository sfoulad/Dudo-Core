# Dudo — Product Vision

> Status: **Draft.** Written by the Team Lead as the shared starting point for the team.
> Product specifics beyond this framing need user confirmation.

## What Dudo is

Dudo is a modern, **MVP-focused, AI-native business-management platform for startups and
SMEs**.

It gives a small company one place to run its operations, with AI built into the
product from the ground up rather than added as a feature, and with a plugin system
that lets the platform be extended without being forked.

**How it gets built: one small, complete vertical feature at a time.** The next feature
does not begin until the user has tested and accepted the current one. Delivery policy
and the completion gate: `docs/product/mvp-delivery-policy.md`.

Dudo ships on two surfaces — a **responsive web application** and a **native Apple
application** for iPhone, iPad, and macOS — built from one shared contract set.

## Who it is for

Startups and small-to-medium enterprises: teams that need real operational capability
but have no appetite for enterprise implementation projects, dedicated admins, or
per-seat pricing that punishes growth. They want the software to do the work.

## Why it exists

Small companies today run on a patchwork of disconnected tools. The data is fragmented,
the integrations are brittle, the AI is superficial, and extending anything means an
enterprise contract. Dudo's premise is that a small team should get coherent operations,
useful AI, and genuine extensibility without any of that overhead.

## Principles

1. **AI-native, not AI-decorated.** AI participates in the actual work — understanding
   context, drafting, reconciling, surfacing what matters — rather than sitting in a
   sidebar. It is grounded in the tenant's real data, and its actions are auditable.
2. **Multi-tenant and strictly isolated.** Every customer's data is separated by
   construction. Isolation is a property of the architecture, not a filter applied
   downstream. See `SECURITY.md`.
3. **Contract-first.** Modules meet only through explicit, versioned contracts. This is
   what keeps the platform extensible without becoming fragile.
4. **Extensible by default.** Plugins are first-class: declared permissions, least
   privilege, no direct data access. Third parties extend Dudo through the same
   contracts first-party code uses.
5. **Trustworthy with business data.** Dudo holds invoices, payroll, customers, and
   contracts. Correctness, auditability, and least privilege outrank speed and cleverness.
6. **Fast to value.** Useful on day one without a consultant, an admin, or a migration
   project.

## Shape of the platform

Two public repositories, meeting only through the published contract set.

**`sfoulad/Dudo-Core`**

- **Platform** (`platform/core/`) — the domain: business rules, APIs, authorization,
  tenant isolation, workflows, auditing. Core stays small.
- **Web experience** (`platform/web/`) — the responsive web application.
- **Contracts** (`packages/contracts/`) — every boundary crossing in the system.
- **Extensibility** (`platform/capabilities/`, `packages/sdk/`) — the capability
  registry, the App runtime, and the SDK that let Dudo be extended safely.
- **Business Apps** (`apps/`) — installable applications: CRM, Finance, Projects,
  Inventory, HR. Business logic lives here, not in Core.
- **Connectors** (`connectors/`) — adapters to external platforms, behind capabilities.
- **Verification** (`packages/testing/`) — the evidence that all of it holds.

**`sfoulad/Dudo-Apple`**

- The native Apple application named Dudo: Xcode, Swift, SwiftUI, for iPhone, iPad, and
  macOS, using a **true native macOS destination — not Mac Catalyst**. A shared
  multiplatform codebase, with platform-specific implementations where Apple UX genuinely
  differs.

Both clients consume the **same approved contracts**. Both repositories exist and are
public; `Dudo-Apple` is empty until its Xcode project is approved.

Detail: `docs/architecture/boundaries.md`. Decision:
`docs/decisions/0002-repository-and-mvp-delivery-strategy.md`.

## Explicitly undecided

These are open and need user input. Nothing should be built as if they were settled:

- **The first vertical feature slice** — which capability ships first, and in what order
  the rest follow.
- **The web framework, testing framework, and every third-party dependency.** The stack
  itself is settled — TypeScript on Cloudflare (`0003`) — but that approves six
  Cloudflare services and nothing else. AI model integration is not approved.
- **The software license** for both public repositories. Public visibility is not a
  license grant; without a license file the repositories are "all rights reserved" by
  default, which is unlikely to be the intent.
- ~~The tenancy model~~ — **decided** (`docs/decisions/0006`, Accepted): one shared
  production D1 database with mandatory indirection, for the Zero-Cost MVP.
- The pricing, packaging, and billing model.
- The plugin distribution model: marketplace, review process, and trust tiers.
- Target markets, compliance obligations, and data-residency requirements.
- Whether, and when, the original master-plan PDF is published. Until the user approves,
  it stays **outside** both public repositories.

## Non-goals for now

- Not an enterprise ERP replacement.
- Not a build-your-own-app no-code platform.
- Not a thin wrapper around a chat interface.
