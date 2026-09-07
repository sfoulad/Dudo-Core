# 0033 — A contract states the shape and the constant's name, not the figure

- **Status:** **ACCEPTED by the Dudo Team Lead, 2026-09-07.** Drafted by `architecture-agent` on
  the Team Lead's instruction; `architecture-agent` proposes and does not accept its own records
  (`0004`'s separation). **Binding from acceptance.**
- **Proposed by:** `architecture-agent`
- **Accepted on this evidence, recorded because it is unusually direct:** in
  `docs/operations/free-tier-register.md`, on the same day and in the same file, the **measured
  capacity model read `PLATFORM_OPERATOR_ACTION_ROW_WRITES` from the live schema and printed the
  new value with no edit**, while the **hand-transcribed table beside it stayed wrong** — in a
  section whose own header had already predicted that *"these figures move when a migration adds an
  index."* One derived, one transcribed, same file, same day, one correct.
- **What acceptance does NOT do:** it does not convert the remaining eight contracts. One focused
  pass, once, in the accepted form — a corrected transcription is still a transcription and goes
  stale on the next index.
- **Governs:** every cost a contract states that is computed from a constant in
  `platform/core/**` — today, D1 row-writes
- **Builds on:** `0008` (zero cost), `0014` §A (write admission), `0030` (configuration, never
  schema), `.claude/rules/workflow.md` §12 (a claim someone will implement)

---

## Context — what happened, in numbers

Migration `0016` added two indexes to `platform_operator_action`.
`PLATFORM_OPERATOR_ACTION_ROW_WRITES` moved from **2 to 4** in the same change, exactly as its own
comment had instructed since it was written.

**Nothing else moved, because nothing else could.** A sweep of `packages/contracts/**` found
**about thirty statements of row-write cost across nine contracts**, every one a hand-transcription
of a Core constant into a file that cannot read it. No test compares them. No build fails. The
divergence is silent, and it is silent **in the outage direction**: `0014` §A.12 records that
over-reserving delays a write and under-reserving fails it.

**Two figures in one file behaved differently on the same day**, which is the whole argument:

| | Behaviour on the day `0016` landed |
|---|---|
| The **measured capacity model**, which reads the constant from the live schema | **Printed the corrected number with no edit** |
| The **hand-transcribed table beside it** | **Did not** — and its own header had predicted that these figures move when a migration adds an index |

One derived, one transcribed, same file, same day, one correct.

---

## Decision

**A contract states the SHAPE of a cost over NAMED CONSTANTS. Any figure is written second and
marked as a transcription on a stated date.**

Where a contract states an operation's cost it declares:

1. **`shape`** — the sum, in the constants' own names, and where they live.
   *`ORGANIZATION_UPDATE_ROW_WRITES + PLATFORM_OPERATOR_ACTION_ROW_WRITES + the tenant-write
   reservation`, all in `identity/control-plane-admission.ts`.*
2. **`theComponents`** — one line per term saying what it pays for and why it is that size.
3. **`figureOn_<date>`** — the arithmetic evaluated on a named day, marked as derived.
4. **`ifTheyDISAGREE`** — **the constants are right and the contract is wrong.** An implementer
   reserves from Core and reports the contract.

`maxRowWrites` **keeps a bare number**, because implementers and the route table need one. The
shape sits beside it and is what a reader reasons from.

**The worked examples are in `packages/contracts/core/platform/`:**
`organization-identity-v1`'s `theWRITECOST` (a figure that moved), and `confirmation-v1`'s two
challenge routes — **one that moved and one that did not, twenty lines apart in one file.**

---

## Why not the alternatives

**Just fix the numbers.** A corrected transcription is still a transcription and goes stale on the
next index — and the next index is already named: `control-plane-admission.ts` records that the
remaining candidate on `platform_operator_action` would take the constant to 5.

**Remove costs from contracts entirely.** Refused. The cost is a *contract* fact: it is how a
reader knows a platform read costs writes at all, and `organization-detail-v1`'s
one-page-one-request rule is an architectural ruling derived from it. Deleting the number would
delete the reasoning with it.

**Generate contracts from code.** No such tooling exists, `0009` approved one narrow validator and
said the precedent "cannot grow into a toolchain without a new decision", and the executable form
of a contract is still `AS1`.

---

## The correction that makes this more than tidiness — a uniform delta is a hypothesis, and it is false

The first sweep of these figures applied **+2** to every statement including an audit record. **The
Team Lead's correction, and it is the substance of this record:**

> The by-2 rule is a hypothesis about how each number was originally derived, and for at least
> three numbers that hypothesis is false.

**There are three states, not two:**

| The figure | Correction | Confirmed instances |
|---|---|---|
| Included the audit record at 2 | **+2** | Most of the thirty |
| **Omitted the audit record entirely** | **+4**, and it was wrong before `0016` too | `core-object-registry.yaml`'s onboarding (10 → 14) · `confirmation-v1`'s loop hazard (2 → 6, understated **threefold**) · **`template-v1`'s create (4 → 8)** · the free-tier register's onboarding figure (10 → 14) |
| **Contains no audit record — the route writes none** | **unchanged** | Enumerated below |

**A uniform delta produces a document set that is internally consistent and externally wrong**, and
internal consistency is what makes the next reader stop checking.

**The third column must be enumerated, not implied**, because a figure left alone is
indistinguishable from a figure nobody looked at. Unchanged by `0016`, and each for a stated reason:

- **`confirmation-v1`'s Action-class challenge** — writes a tenant `audit_event`, not a
  platform-operator record. **It sits twenty lines below a route that did move and shares its
  former number.**
- **`business-read-v1`** and **`audit-read-v1`** — four Actions at `maxRowWrites: 0`; reads that
  write nothing at all.
- **`login-v1`** and **`organization-selection-v1`** — `SESSION_ROW_WRITES` = 3, session class, no
  platform record.
- **Every tenant-ledger figure** — `AUDIT_EVENT_ROW_WRITES` = 5, the onboarding tenant portion (7),
  the reset's 5 per Organization. `0016` touched the control plane only.
- **`customer-directory-v1`** — states no row-write figure anywhere. Searched; nothing found.

---

## What a check would compare

**Owed to `qa-agent`**, and it is what makes the form worth converting to rather than merely nicer
to read. In the shape `registry-coherence.ts` already uses for the catalog:

- parse each contract's `shape` and its `figureOn_<date>`;
- import the named constants from `platform/core/**`;
- assert the figure equals the shape evaluated, **naming the contract and the term that differs.**

With the two guards this repository has learned to demand:

- **A floor.** Fail loudly if no contract or no constant was parsed — an empty comparison reports
  success, which is the most confident wrong answer a checker can give.
- **A known-failing input.** A fixture contract whose figure is off by one, which must go **red**.
  A check handed only passing input has been observed, not verified.

**It is impossible against the current form** — a bare number references nothing — which is the
strongest argument for the change and the reason it is proposed as a decision rather than a habit.

---

## Consequences

**Easier:** a stale figure becomes findable by a machine instead of by an implementer refusing to
build against a number they knew was wrong — which is what happened here, and which is not a
process anyone should rely on twice.

**Harder:** each cost statement is longer. Accepted: the alternative is short and silently wrong.

**What it does not fix:** a constant whose *value* moves while its *name* stays is caught by this
check; a constant whose **meaning** moves is not. `workflow.md` §12 already records that a symbol
that moves is caught by the compiler and a symbol whose value moves is caught by nobody — this
closes the second case for costs only, and nothing else.

**Not converted yet.** Eight contracts still carry bare figures. The conversion is one focused pass
and should happen **once, in this form**, after this record is accepted — not as thirty edits that
re-transcribe numbers due to rot at the next index.

---

## Approval

**Not user-facing and not production-affecting.** It changes how contracts are written and no
deployed behaviour. `architecture-agent` proposes; **the Team Lead records and accepts.** No agent
accepts its own decision record.
