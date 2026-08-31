# 0001 — Governance and decision sequencing

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** User (explicit approval in conversation), Dudo Team Lead
- **Owning agent:** Team Lead

## Context

The four agents came online for a read-only readiness check and all reported the same
blockers: no technology stack, no published contracts, and no recorded decisions. Two
open questions surfaced that are about **sequencing and ownership**, not about
architecture itself, and both would otherwise be answered ad hoc once implementation
starts:

- `plugin-agent` asked whether the plugin permission model gets its own decision record
  before SDK work, and whether the isolation mechanism is decided with the stack or after.
- `qa-agent` asked who owns root-level shared test configuration, given that it may not
  edit the repository root.

Answering these now costs nothing and prevents an expensive reversal later: the plugin
permission model is the security boundary for untrusted third-party code in a
multi-tenant product, and test configuration sits exactly on the seam between QA's
ownership of `tests/**` and the Team Lead's ownership of shared configuration.

This record settles **process**. It does not decide any architecture.

## Options considered

1. **Decide sequencing and ownership now, architecture later** — small record, no
   technical commitments, unblocks the agents' process questions before the stack
   discussion. Costs one record that must not be mistaken for an architecture decision.
2. **Fold these into the future architecture ADRs** — fewer records, but leaves ownership
   and ordering unresolved while implementation planning proceeds, which is when they
   are most likely to be resolved silently and wrongly.
3. **Leave them to be decided when they come up** — rejected. `docs/decisions/README.md`
   requires the decision be recorded before work builds on it, and both questions have
   already blocked an agent once.

## Decision

Five governance decisions are approved and binding:

1. **The plugin permission and trust model gets its own ADR before SDK implementation.**
   No work begins in `packages/plugin-sdk/**` or on the plugin runtime until that record
   exists and is accepted. It is a standalone record, not a section inside the stack
   decision.

2. **The logical permission model is defined before implementation.** What a permission
   is, how it is declared, scoped, granted, enforced, and revoked is settled in the
   abstract — independently of, and prior to, any technology that implements it.

3. **The technical plugin isolation mechanism is selected together with the technology
   stack**, because the stack constrains which isolation mechanisms are available and
   what they cost. Process-level, sandbox, and runtime-level isolation are not
   separable from the runtime that would host them, so the two decisions are made as one.

4. **The Team Lead owns root-level shared test configuration.** It is shared
   configuration and sits in the repository root, which is Team Lead territory under
   `docs/architecture/boundaries.md`.

5. **QA owns `tests/**` and proposes root test-configuration changes to the Team Lead.**
   `qa-agent` authors and runs everything inside `tests/**`; when a change is needed to
   root-level test configuration it proposes the change with its rationale, and the Team
   Lead makes the edit. QA does not edit the repository root.

Together, 1–3 fix the ordering: **logical permission model → plugin permission and trust
ADR → stack and isolation mechanism decided jointly → SDK and runtime implementation.**

## Consequences

- `plugin-agent` has an unambiguous gate: two records must exist before it writes code,
  and it now knows the isolation question will not be answered ahead of the stack.
- The permission model is designed on its security merits rather than being shaped by
  whichever runtime happens to be chosen — the intended effect, and the reason 2 is
  separated from 3.
- Coupling isolation to the stack means the stack decision carries more weight and will
  take longer; a stack chosen without regard to isolation would be a likely candidate for
  reversal, which is the more expensive outcome.
- `qa-agent` is unblocked on ownership, at the cost of a round trip through the Team Lead
  for every root test-config change. Accepted deliberately: the repository root stays
  single-owner, and no agent edits outside its boundary.
- The three architecture records this sequencing implies — the logical permission model,
  the plugin permission and trust ADR, and the joint stack-and-isolation decision — are
  **scheduled but not written.** None of them is decided here, and nothing in this record
  should be read as pre-committing their content.

## Approval

The user approved these five governance decisions explicitly in conversation on
2026-08-31, in the same instruction that approved team readiness and the temporary
security hardening.

The user also explicitly withheld approval for the architecture ADRs themselves in that
instruction ("do not ... create the architecture ADRs yet"). No technology stack is
selected, and this record selects none. Stack and production-affecting decisions still
require their own explicit approval under `docs/decisions/README.md`.
