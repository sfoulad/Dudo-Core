# platform/ — Dudo platform

**Core stays small.** This directory holds platform functionality only: the primitives
every App builds on. Business-specific functionality belongs in an App
(`apps/`) or a Capability, never here.

That constraint is the single most load-bearing rule in Dudo. A platform that absorbs
business logic stops being a platform.

## Subdivisions

| Path | Purpose | Owner |
|---|---|---|
| `core/` | Domain, APIs, authorization, tenancy, auditing | `core-agent` |
| `web/` | The responsive web client | `web-agent` |
| `capabilities/` | Capability registry and the App runtime | `plugin-agent` |

Further platform services arrive with the phase that needs them, each as its own
subdivision: `identity`, `authorization`, `tenant`, `billing`, `marketplace`, `events`,
`workflow`, `mcp`, `ai`. They are named here so the boundary is known in advance, not
invented under pressure.

## What Core provides

Identity and sessions · organization structure (platform → organization → business →
branch → team → user) · principals, including service accounts, AI agents, and IoT
devices · roles, permissions, and scopes · teams · platform billing and quotas ·
notifications · files · audit logs · activity timeline · search · settings · feature
flags · usage metering · developer registration · the marketplace, capability registry,
event registry, workflow runtime, and MCP registry.

## Rules

- **Business rules live in Core, not in a client.** Pricing, tax, entitlement, approvals,
  workflow transitions, permission decisions, and tenant resolution are decided here.
- **Authorization is decided here, on every call, denying by default.** Never trust that
  a caller already checked.
- **Every operation is tenant aware.** Tenant identity comes from the authenticated
  server-side context — never from client input, a header the caller controls, a plugin,
  or an ambient default.
- **Internal communication uses Service Bindings/RPC**, not public HTTP between services.
- **AI never changes data directly.** It reaches business logic through the same
  authorized actions a human uses.
- **Cloudflare services stay replaceable.** No Cloudflare type, client, or binding
  appears in domain logic — storage, queuing, and object access sit behind Core-owned
  interfaces. See `docs/decisions/0003-technology-stack-typescript-on-cloudflare.md`.

*No application code exists yet. Phase 0 is standards and registries; the Core platform
is Phase 1.*
