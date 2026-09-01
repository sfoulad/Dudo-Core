# 0004 — Dudo-Core repository structure

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** User (explicit approval in conversation), Dudo Team Lead
- **Owning agent:** Team Lead

## Context

`Dudo-Core`'s layout did not match the layout the planning source specifies, and one path actively
collided. The plan uses `/apps` for **installable business Apps** — CRM, Finance,
Inventory. Our tree used `apps/` for the **responsive web client**. Same path,
incompatible meanings, and the collision would only get more expensive: once business
Apps exist, `apps/` would hold two unrelated kinds of thing under one ownership rule.

The tree is currently documentation and placeholders. Restructuring now costs hours;
restructuring after Phase 1 means moving live code, contracts, and tests.

## Options considered

1. **Adopt the plan's layout now** *(chosen)* — one disruption while the tree is empty.
2. **Keep our layout, rename the plan's `/apps`** — rejected. The plan's vocabulary is
   the product's vocabulary; "Apps" is what customers install from the marketplace, and
   renaming it in the repository would leave code and product permanently out of step.
3. **Defer until business Apps exist** — rejected. That is precisely the moment the move
   becomes expensive, and Phase 0 standards would be written against paths due to change.

## Decision

`Dudo-Core` adopts the layout specified by the planning source.

```
platform/            core, identity, authorization, tenant, billing, marketplace,
  ├── core/          capabilities, events, workflow, mcp, ai
  ├── web/           the responsive web client
  └── capabilities/  capability registry and App runtime
apps/                installable Dudo business Apps ONLY — CRM, Finance,
                     Projects, Inventory, HR
connectors/          adapters to external platforms: payments, messaging, shipping
packages/            shared libraries
  ├── contracts/     cross-module contracts
  ├── sdk/           the public SDK third parties build against
  └── testing/       test suites and shared test harness
agents/              agent rules, prompts, and task specifications
docs/                architecture, decisions, product, operations
```

`Dudo-Apple` is unaffected — it is a separate repository and the planning source does not
cover it.

### Moves

| From | To |
|---|---|
| `core/` | `platform/core/` |
| `apps/` (web client) | `platform/web/` |
| `plugins/` | `platform/capabilities/` |
| `packages/plugin-sdk/` | `packages/sdk/` |
| `tests/` | `packages/testing/` |
| `packages/contracts/` | unchanged |
| `docs/` | unchanged |

**`apps/` is reserved.** After this change it holds installable business Apps and nothing
else. Putting a client, a library, or a service there is a boundary violation.

History is preserved with `git mv`. No file is dropped or silently overwritten.

### Ownership after the move

| Agent | Owns |
|---|---|
| `architecture-agent` | `packages/contracts/**`, `docs/architecture/**`, `agents/**` |
| `core-agent` | `platform/core/**` and the other `platform/` domain services |
| `web-agent` | `platform/web/**` |
| `plugin-agent` | `platform/capabilities/**`, `packages/sdk/**`, `connectors/**` |
| `app-agent` | `Dudo-Apple` (unchanged) |
| `qa-agent` | `packages/testing/**`, plus Apple test targets |
| `security-agent`, `integration-agent` | nothing — review only |
| Team Lead | repository root, shared configuration, `docs/**`, releases, integration |

Per-App test suites colocate with their App under `apps/<name>/tests/` as Apps are built,
per the planning source's file-ownership rule. `packages/testing/` holds cross-cutting suites and the shared
harness.

## Consequences

- Every ownership rule, agent definition, CODEOWNERS entry, CodeRabbit path instruction,
  and documentation reference changes with it. All are updated in the same change so the
  repository is never internally inconsistent.
- **`core-agent` stops authoring contracts.** `packages/contracts/**` moves to
  `architecture-agent`, resolving the no-self-review violation where the implementing
  agent also authored and approved its own contract.
- Phase 0 standards can be written against paths that will not move again.
- `connectors/` and `agents/` are created empty with READMEs. Empty directories are
  deliberate: they reserve the boundary before anything needs it.
- A one-time cost to any external reference to the old paths. Acceptable — the repository
  has two commits and no code.

## Approval

The user approved this explicitly in conversation on 2026-08-31, specifying the web
client move to `platform/web/**`, the reservation of `apps/**` for installable business
Apps, and that ownership rules, agent definitions, documentation, CODEOWNERS, testing
paths, and planned CI paths all be updated to match, preserving history and losing no
files.
