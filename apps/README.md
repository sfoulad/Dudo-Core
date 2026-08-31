# apps/ — Installable Dudo business Apps

**Reserved. This directory holds installable business Apps and nothing else.**

An App is a complete business application a customer installs — CRM, Finance, Projects,
Inventory, HR, Appointments, Customers, Commitments. Each owns its logic, data, API,
events, permissions, UI, and tests.

> **This is not the web client.** The responsive web application lives at
> `platform/web/`. Putting a client, a library, or a platform service here is a boundary
> violation — see `docs/decisions/0004-repository-structure.md`.

## Rules every App follows

- **An App owns its domain.** Logic, data, API, events, permissions, UI, tests.
- **No cross-App database access, ever.** Apps communicate through internal APIs and
  events — never by reaching into another App's storage.
- **Business logic lives here, not in Core.** Core provides platform primitives; Apps
  provide business behaviour.
- **Apps request capabilities, not vendors.** Declare `Payment`, never `Stripe`. The
  provider is resolved by the capability registry.
- **Every operation is tenant aware.** No query, action, event, workflow, cache entry, or
  file operation involving tenant data exists without tenant context.
- **Official Apps get no special path.** First-party Apps use exactly the SDK third-party
  developers use. If the SDK is awkward for us, it is awkward for them.

## Structure

Each App is a directory with a manifest declaring its identity, version, dependencies,
permissions, entities, actions, events published and consumed, capabilities required,
APIs, UI extensions, and MCP tools. The manifest is the source of truth for whether an
App can install.

Per-App test suites colocate under `apps/<name>/tests/`, owned by `qa-agent`.

*Empty. No Apps exist yet — they arrive in Phase 4, after the platform, runtime, and SDK
are built. See `docs/decisions/0005-foundation-gate-for-phases-0-3.md`.*
