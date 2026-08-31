# Architecture Decision Records

This directory is Dudo's decision memory. Any choice that is expensive to reverse is
written down here **before** work is built on top of it. A decision that exists only in
a chat transcript does not exist.

## What must be recorded

- Technology stack: language, framework, database, hosting, AI model integration.
- The tenancy model and how isolation is enforced.
- Authentication and authorization model.
- Contract format, transport, and versioning strategy.
- Plugin permission model and isolation mechanism.
- Data model shape and migration strategy.
- Service topology and deployment shape.
- Anything else that would be painful or costly to undo.

If you are unsure whether a decision qualifies, write it down. Cheap to add, expensive
to have missed.

## Naming

`NNNN-short-kebab-title.md`, numbered sequentially from `0001`, never renumbered.

```
0001-choose-technology-stack.md
0002-tenancy-model.md
```

## Template

```markdown
# NNNN — <Title>

- **Status:** Proposed | Accepted | Superseded by NNNN | Rejected
- **Date:** YYYY-MM-DD
- **Deciders:** <who>
- **Owning agent:** <app-agent | core-agent | plugin-agent | qa-agent | Team Lead>

## Context
What forced this decision. Constraints, requirements, what was already true.

## Options considered
1. **<Option>** — trade-offs.
2. **<Option>** — trade-offs.

## Decision
What was chosen, stated plainly.

## Consequences
What becomes easy, what becomes hard, what has to change, what this locks in.

## Approval
Whether the user explicitly approved this, and where. Required for stack choices and
anything touching production. An agent's or the Team Lead's own judgment is not approval.
```

## Rules

- The **Team Lead owns this directory.** Agents propose; the Team Lead records.
- A record's status is never edited away — a reversed decision gets a **new** record
  that supersedes the old one, and the old one is marked `Superseded by NNNN`.
- Stack decisions and production-affecting decisions are only `Accepted` with **explicit
  user approval**, noted in the record.
- Record the decision before building on it, not after.

## Current state

| Record | Status | Decides |
|---|---|---|
| `0001-governance-and-decision-sequencing.md` | Accepted | Process only — the order in which the plugin decisions are made, and who owns root-level shared test configuration. **No architecture.** |
| `0002-repository-and-mvp-delivery-strategy.md` | Accepted | Two public repositories, the Apple platform approach, Apple and web delivery policy, the seven-step feature completion gate, team changes, public-repository safety. |
| `0003-technology-stack-typescript-on-cloudflare.md` | Accepted | TypeScript on Cloudflare for `Dudo-Core`: Workers, D1, R2, Queues, Workflows, Durable Objects. Bindings not REST. No blanket product adoption; every service stays replaceable behind an internal boundary. |
| `0004-repository-structure.md` | Accepted | The master-plan layout — `platform/`, `apps/` (reserved for installable business Apps), `connectors/`, `packages/`, `agents/`, `docs/`. Contract authorship moves from `core-agent` to `architecture-agent`. |
| `0005-foundation-gate-for-phases-0-3.md` | Accepted | Suspends the three delivery-only steps for Phases 0–3 and replaces them with a seven-condition Foundation Gate. Security, tenant isolation, contract compatibility, ownership, PR review, truthful reporting, secrets, and production controls are **not** suspended. |

### Technology stack status

| Scope | Status |
|---|---|
| `Dudo-Apple` | **Approved** (`0002`): Xcode, Swift, SwiftUI; iPhone, iPad, macOS; true native macOS destination, never Mac Catalyst |
| `Dudo-Core` | **Approved** (`0003`): TypeScript on Cloudflare — Workers, D1, R2, Queues, Workflows, and Durable Objects only where real coordination is needed. Bindings, not REST |
| Web / testing framework, npm dependencies | **Not selected** — `0003` approves a language and six services, nothing more |
| Other Cloudflare products | **Not approved.** Workers AI, AI Gateway, Agents SDK, Workers for Platforms, Analytics Engine, KV, Hyperdrive each need their own record |
| App isolation mechanism | **Not selected** — `0001` bound it to the stack decision, but `0003` did not approve Workers for Platforms |
| Tenancy model | **Not selected** — D1 is single-threaded per database, which argues against a shared database. Resolve before Phase 1 |

An approved stack for one repository is not approval for the other, and approving Swift
and SwiftUI is not approving any package or third-party dependency.

### Scheduled but not yet written

1. The logical App permission model.
2. The App permission and trust ADR — required before any SDK or runtime work.
3. The App isolation mechanism — `0003` settled the stack but did not approve Workers for
   Platforms, so this still needs its own record.
4. The tenancy model — shared schema, schema-per-tenant, or database-per-tenant.
5. Contract transport and versioning mechanics.

### Open user decisions

- **Software license** for both public repositories — public visibility does not decide
  it, and no license file exists. **Apache-2.0 is the standing recommendation**
  (permissive, explicit patent grant, well understood by the developer ecosystem an
  extensible platform depends on). **Not adopted:** it permits commercial reuse by anyone,
  including competitors, and that trade-off needs an explicit decision rather than a
  default. No `LICENSE` is added until the user confirms.
- **The first vertical feature slice.**
- ~~Repository creation and remote configuration~~ — **done 2026-08-31.** Both
  repositories are public; `Dudo-Core` has its foundation commit, `Dudo-Apple` is empty
  pending its Xcode project.
- **Publication of the original master-plan PDF** — it stays outside both public
  repositories until approved.

Further open questions are listed in `docs/architecture/boundaries.md` and
`docs/product/vision.md`.
