# 0030 — Full system, still zero cost, and expandability as a binding constraint

**Status:** accepted, 2026-09-06
**Decided by:** the user, in conversation, after the platform-operator slice was deployed
**Supersedes:** the MVP framing in `CLAUDE.md`, `.claude/rules/architecture.md` §7,
`.claude/rules/workflow.md` §10–§11, and `docs/product/mvp-delivery-policy.md`
**Does not supersede:** `0008` (zero cost), `0003` (the approved stack), or any security rule

---

## The decision, in three parts

**1. Dudo is no longer MVP-scoped.** The target is the full system as `docs/product/vision.md`
describes it: Core, both clients, the capability registry and SDK, Connectors, and the business
Apps — CRM, Finance, Projects, Inventory, HR.

**2. Milestone acceptance replaces the seven-step per-feature gate.** Work proceeds continuously
and stops at named milestones for the user to test and accept. **Production actions — migrations,
deploys, credential changes, any spend — still require explicit user approval, each time.** That
control is not MVP overhead: on the day before this decision it is what caught a targeted
denial-of-service, a confirmation binding that covered nothing, and four unsatisfiable request
shapes.

**3. Zero cost continues (`0008`), with expandability as a new binding constraint.** The system is
built inside free allowances *and must be able to leave them by paying rather than by rebuilding.*

---

## What "expandable" has to mean, or it is not a property

**It is a claim, and an unverified claim is what this repository spent a day learning not to trust.**
So it is stated as something that can be checked and violated:

> **The free tier may cost us CONFIGURATION. It must never cost us SCHEMA.**

A limit worked around by a setting, a binding, a ceiling constant or a deployment topology is
reversible by changing that thing. **A limit worked around by changing the shape of the data is
not** — it is paid for once and then paid for forever, by every query, every migration and every
reader.

**Concretely, these are violations of this decision even when they are locally correct:**

- Denormalising to save row-writes, so the schema encodes a write ceiling that will be lifted.
- Aggregating on write to avoid a read allowance, losing the source rows.
- Skipping an audit record because it costs 5 writes.
- Packing several logical values into one column to stay under a size limit.
- Anything that assumes exactly one database exists.

**And these are fine, because they are configuration:**

- Ceiling constants, sub-ceilings, and per-principal budgets.
- Refusing work at a limit rather than degrading data.
- One shared database *behind an interface that does not promise there is only one.*

---

## The pinch point is `0006`, and it is named here rather than left to be discovered

`0006` chose **one shared D1 database with mandatory indirection, explicitly "for the Zero-Cost
MVP."** The MVP is now over and that premise is gone, which is `workflow.md` §12's exact shape.

**The free-tier facts that decide it:** 5 GB of D1 storage in total, **500 MB per database**, ten
databases per account. **Storage is the one allowance that does not ebb** — a customer with three
years of history consumes it while doing nothing, and low traffic never gives it back.

**`0006` is not reversed here.** One shared database remains correct for the current scale, and
re-deciding it under a full-system premise is its own piece of work. **What this decision requires
is that the choice stays reversible**: the existing single emission point for tenant scoping is the
mechanism that makes it so, and anything that bypasses it is not a shortcut but a decision to make
the tenancy model permanent.

---

## What third-party Apps cost, since this is where "full system" meets the budget

**Workers is free. Workers for Platforms is a different product and is paid-only.** The similarity
of the names is the whole confusion.

- **Free, and it is most of the vision:** first-party Apps as separate Workers, deployed by Dudo,
  reached through service bindings with least-privilege bindings per App. That is a real isolation
  boundary, not a pretend one.
- **Needs budget:** an open marketplace where third parties upload and execute code — `Phase 7`.
  Its non-technical prerequisites (review process, trust tiers, distribution model) are undecided
  anyway, so deferring it forfeits nothing currently reachable.

`0006` already recorded that Workers for Platforms gates **only** untrusted code execution, and not
tenancy, Apps as a concept, or the capability model.

---

## What does not change

Contract-first · strict tenant isolation · authorization decided in Core · least-privilege
capability grants · no direct App-to-database access · QA verification before integration ·
architecture decisions recorded · secrets never committed · **production actions require explicit
user approval** · no new technology or dependency without a decision record · both repositories
public and free of credentials.

**None of those were MVP concessions.** They are why the operator slice shipped with its defects
found rather than deployed.

---

## Consequences

- **`CLAUDE.md`, `architecture.md` §7, `workflow.md` §10–§11 and `mvp-delivery-policy.md` all
  instruct, and all now instruct wrongly.** They are swept in the same unit of work as this record,
  because `workflow.md` §12's whole subject is what a changed decision leaves behind that nothing
  makes go red.
- **The Phase 0 standards corpus is the starting point, not a blank page.** Twelve rules and the
  App, capability, connector, API and event standards exist, authored and marked *"Draft for Team
  Lead review. Binding on acceptance, not before."* Accepting them is the first milestone.
- **A measured capacity model is owed.** The estimate that the free tier supports 100–150 small
  businesses is arithmetic over per-operation costs, not a measurement, and a figure of exactly
  that kind was wrong by a factor of six the day before this was written. It is measured against a
  seeded workload before anyone plans around it.
