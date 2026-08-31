# 0005 — Foundation Gate for Phases 0–3

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** User (explicit approval in conversation), Dudo Team Lead
- **Owning agent:** Team Lead

## Context

`0002` established a seven-step feature completion gate: every feature ships a web
staging release **and** an internal TestFlight build, QA reports evidence for both, and
the user explicitly accepts before the next feature begins.

Master build plan §37 Phases 0–3 build a constitution, a core platform, an application
runtime, and a developer SDK. **None of them produces anything a user can install or
open.** Phase 0 is explicitly documents and registries with no business Apps at all.

Applying the delivery gate there leaves two bad outcomes: the work stalls against
conditions it cannot satisfy, or someone manufactures a staging URL and a TestFlight
build that demonstrate nothing — a fake release, which is worse than no release because
it produces false confidence and normalises dishonest reporting.

Foundation work still needs a gate. It is the most expensive work to get wrong: a
mistaken standard or a wrong permission model propagates into every App built afterwards.

## Options considered

1. **Replace the delivery-specific steps with a Foundation Gate** *(chosen)* — keeps
   rigour where it applies, drops only the steps that are literally impossible.
2. **Suspend the gate entirely for Phases 0–3** — rejected. Foundation work is exactly
   what most needs review; ungated it would be the least-checked and most load-bearing
   code in the product.
3. **Apply the seven-step gate as written** — rejected. It cannot be satisfied honestly.

## Decision

For **Phases 0–3**, the following three steps of the `0002` gate are **suspended**, and
only these:

- a runnable web staging release;
- an Apple / TestFlight build;
- end-user feature acceptance of a running feature.

They are replaced by the **Foundation Gate**. A Phase 0–3 unit of work is complete only
when all seven hold:

| # | Condition | Owner |
|---|---|---|
| 1 | A written standard, registry, contract, or ADR exists | `architecture-agent` |
| 2 | Architecture review against the master build plan | `architecture-agent` + Team Lead |
| 3 | Automated validation wherever executable validation is possible — schema linting, YAML/JSON validity, cross-reference checks | `qa-agent` |
| 4 | QA review for contradictions, missing requirements, and unsafe defaults | `qa-agent` |
| 5 | CodeRabbit review — **after activation** | automated |
| 6 | All CI checks that **genuinely exist** must pass | automated |
| 7 | Team Lead evidence report **and user approval** before the next phase | Team Lead → **user** |

Step 3 is bounded by honesty, not effort: a prose standard has nothing executable to
validate, and claiming otherwise would be a false report. Step 6 says *genuinely exist* —
a check that has never run is not a passing check, and no check becomes required until it
has passed for real at least once.

Step 7 remains the user's alone. It cannot be inferred, assumed, or granted by the Team
Lead.

### Explicitly NOT suspended

These apply in full throughout Phases 0–3 and are not negotiable:

- **Security requirements**
- **Tenant-isolation requirements**
- **Contract compatibility**
- **Repository ownership boundaries**
- **Pull-request review**
- **Truthful test reporting** — passed, failed, skipped, not run, as actually observed
- **Secret protection**
- **Production approval controls**

### When the full gate returns

**The complete seven-step feature-release gate of `0002` becomes mandatory beginning with
the first runnable vertical product feature** — in practice master plan Phase 4, the
first official Apps. It is triggered by the work becoming runnable, not by a phase
number: any Phase 0–3 work that produces something a user can actually open falls under
the full gate.

## Consequences

- Phases 0–3 can proceed honestly, with review proportionate to the risk.
- **Foundation work now requires user approval per phase** (step 7), so four approval
  points appear before the first App. That is deliberate: a wrong standard is cheap to
  fix now and expensive after Phase 4.
- Steps 5 and 6 are inert until CodeRabbit is activated and CI exists. They are written
  as conditional rather than aspirational so nobody reports a gate as passed on the
  strength of a check that never ran.
- Two gates now coexist. The Team Lead states which gate applies to a unit of work when
  assigning it, so no agent has to guess.

## Approval

The user approved this explicitly in conversation on 2026-08-31, specifying which three
steps are suspended, the seven replacement conditions, the eight requirements that are
explicitly not suspended, and that the full gate returns with the first runnable vertical
product feature.
