# 0032 — Accepting the Phase 0 standards

**Status:** ACCEPTED by the user, 2026-09-07
**Recommended by:** Dudo Team Lead, 2026-09-07
**Governs:** the nineteen documents in `docs/architecture/standards/`
**Required by:** `0005` (the Foundation Gate) as amended by `0030`; these documents have carried
*"Draft for Team Lead review. Binding on acceptance, not before"* since they were authored

---

## What is being accepted

**Nineteen documents, 4,782 lines**, written under the Foundation Gate **before any code existed**:
a constitution of twelve rules, and standards for architecture, Core boundaries, multitenancy,
authorization, security, APIs, events, Apps, capabilities, connectors, the SDK, Studio, AI, MCP,
Cloudflare, testing, and architecture validation.

**Accepting them makes them binding.** Today they bind nothing.

---

## Why this is a decision and not a review

**They were reconciled against the running system first.** Two agents classified all 81 open issues
into closed, still open, or contradicted, on disjoint file sets, and reported the searches that
returned nothing as well as those that found something.

| | |
|---|---|
| **Closed or narrowed** by something built or decided since | ~16 |
| **Contradicted** — the implementation went a different way | **18** |
| **Still open** | 27 rows, collapsing into **six roots** |

**So the question is no longer "are 4,782 lines correct."** It is whether to accept a corpus whose
divergences from reality are now *marked, argued, and owned*.

---

## Recommendation: accept, with the contradictions marked rather than fixed first

**Fixing all eighteen before accepting would be the wrong order**, for a reason the corpus itself
demonstrated: several contradictions cannot be resolved without deciding one of the six roots, and
**a standard nobody has accepted binds nobody while it waits.** The documents have already governed
two days of work informally; accepting them makes that honest.

**What the marking gives that acceptance-after-fixing would not:** each contradiction now records
*which side is wrong and why*, in the file, where the next reader arrives. Several were found only
because the corpus was read against running code — and that pass is not repeatable at will.

---

## What accepting does NOT resolve — the six roots

| | Decision | Whose | Gates |
|---|---|---|---|
| **R1** | A free mechanism for executing untrusted third-party code, or fund Workers for Platforms | **User** (budget) or architecture | Third-party Apps, Connector egress, Studio output |
| **R2** | A tenant-scoped secret store — Worker secret bindings are per-Worker and cannot hold a tenant's vendor credentials | Architecture | **The most rows of any root.** Every Connector and capability provider |
| **R3** | An AI provider — *which*, *at what cost*, and *whether tenant data may leave the platform* | **User**, and it is a budget question and a legal question that must be answered together | All AI capability work |
| **R5** | MCP transport and hosting | Architecture + a Cloudflare product record | MCP surface. **Independent of R3 in both directions** |
| **R6** | The App permission-and-trust ADR — `0007` decided the logical model and explicitly not this | Architecture | **All SDK code** |
| **R7** | ~~Repository home for a platform application that is not core/web/capabilities~~ | Team Lead | **Closed 2026-09-06** by `0004`'s amendment |

**There is no R4.** The roots were numbered against the documents they came from and not renumbered
after two merged.

---

## The three findings that should shape what happens next

**1. The first App bypasses an SDK that does not exist.** `APP_STANDARD` requires an App to reach
Core through `packages/sdk` against a published contract. `packages/sdk/` contains a README.
`apps/customers/app.ts` imports Core's authorizer and router directly, and hand-transcribes its nine
permissions into code that labels itself a drift surface.

`SDK_STANDARD` warned that a first-party App reaching Core by a path the SDK does not offer means
*"the SDK is not the product — it is a demo, and its gaps will not be discovered until a third party
hits them."* **That has already happened.** For a platform whose vision is installable Apps, the one
App that exists proves nothing about whether the App boundary works, because it does not use it.

**2. A whole class of enforcement claims is false, and it had four homes.** *"Enforced structurally
by the schema"* appears in the authorization standard twice, in the permission catalog's
machine-readable rules, and in the catalog's prose. **Nothing in this repository executes JSON
Schema.** Two of the four were inside `§4.1` — *the section written to police exactly that
distinction*, which got the scope axis right and missed the liveness one.

**3. The corpus excuses itself against a system that now exists.** `TESTING_STANDARD` says *"Phase 0
has neither a runtime nor tenant data, so `UNVERIFIED / NOT RUN` here does not block the Phase 0
foundation."* **Both halves are false** — two Workers are deployed and three Organizations are
seeded. A sentence excusing unverified work *because there is nothing to verify against* now
excuses it against a live system.

---

## What acceptance changes in practice

- The twelve constitutional rules bind, and document precedence is settled.
- Every agent has a stated standard to build against rather than a draft to interpret.
- **The eighteen contradictions become debts with owners**, not observations.
- `R2` and `R6` become the two decisions blocking the most work, and both are architecture's —
  which means they can start without waiting on a budget.

## What it does not change

**Nothing about the deployed system.** No code moves, no contract changes, no route behaves
differently. This is a governance act.
