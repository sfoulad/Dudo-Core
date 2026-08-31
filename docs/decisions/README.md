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

### Technology stack status

| Scope | Status |
|---|---|
| `Dudo-Apple` | **Approved** (`0002`): Xcode, Swift, SwiftUI; iPhone, iPad, macOS; true native macOS destination, never Mac Catalyst |
| `Dudo-Core` | **Not selected** — language, framework, database, hosting, web framework all open |
| Plugin isolation mechanism | **Not selected** — decided jointly with the `Dudo-Core` stack (`0001`) |

An approved stack for one repository is not approval for the other, and approving Swift
and SwiftUI is not approving any package or third-party dependency.

### Scheduled but not yet written

1. The logical plugin permission model.
2. The plugin permission and trust ADR — required before any SDK or runtime work.
3. The `Dudo-Core` technology stack and the plugin isolation mechanism, decided jointly.

### Open user decisions

- **Software license** for both public repositories — public visibility does not decide
  it, and no license file exists.
- **The first vertical feature slice.**
- ~~Repository creation and remote configuration~~ — **done 2026-08-31.** Both
  repositories are public; `Dudo-Core` has its foundation commit, `Dudo-Apple` is empty
  pending its Xcode project.
- **Publication of the original master-plan PDF** — it stays outside both public
  repositories until approved.

Further open questions are listed in `docs/architecture/boundaries.md` and
`docs/product/vision.md`.
