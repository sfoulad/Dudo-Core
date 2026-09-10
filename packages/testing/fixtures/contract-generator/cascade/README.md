# `contract-generator` — the inputs that verify `0037`'s generator

These are **deliberately malformed and deliberately minimal contract pairs**, used as inputs to
`packages/contracts/generator/generate-types.mjs`. Nothing here is a real contract, nothing here is
published, and no route serves any of it.

## Why they live here rather than in `packages/contracts/**`

They were in `packages/contracts/generator/fixtures/` and in a session scratchpad. Both were wrong,
for different reasons.

**A deliberately malformed file inside the published-contract tree is a collision every checker over
that tree inherits.** It fired in both directions in one afternoon: `qa-agent`'s block-scalar scanner
flagged `architecture-agent`'s drift fixture as a swallowed key pair, and `architecture-agent`'s
outline scanner had a hole that `qa-agent`'s fixture shape would have walked straight through. **Two
scanners over one tree, each holding a file built to trip the other.** That is N exclusions for one
location, and each exclusion is a place a boundary can drift.

**And a scratchpad is not preservation.** `.claude/rules/workflow.md` §11a says a preserved artifact
goes in the repository or it is not preserved — a rule written *after* a previous session's
scratchpad evaporated and took a reproduction fixture with it.

## What each file is for

| Path | Role |
|---|---|
| `common/bad.schema.json` | A **shared** schema that REFUSES — carries a keyword in neither the shape nor the constraint list. No contract sits beside it, exactly like `common/pagination`. |
| `common/fine.schema.json` | A **shared** schema that is clean. The over-refusal control depends on it existing. |
| `good/` | Imports nothing. **The floor** — without it, "the dependent was not written" cannot be told apart from "the run delivered nothing". |
| `neighbour/` | Imports `common/fine` and nothing else. **The over-refusal control**, and it must be DELIVERED. |
| `dep/` | Imports `common/bad`. Must cascade-refuse at **depth 1**. |
| `top/` | Imports `dep` and never mentions `bad`. Must cascade-refuse at **depth 2** — transitivity is claimed by the cascade and this is what measures it. |

## The one that is easy to get wrong

**`neighbour` imports something on purpose.** A contract that imports *nothing* never exercises a
dependency edge, so it passes whether the cascade is precise or never looked at edges at all — **it
would be green either way**, which is the same class as a floor reporting success on empty input.
Importing a *clean* shared schema is what makes it an over-refusal control rather than a coincidence.

## Do not "fix" these

Every refusal these produce is the point. A future reader who makes `bad.schema.json` valid has
deleted the only evidence the cascade works.
