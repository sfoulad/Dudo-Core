# 0037 — Contract-generated API types, from a first-party generator

- **Status:** **ACCEPTED. The user (Sameh) chose the first-party generator on 2026-09-08**,
  over adopting `json-schema-to-typescript`, in answer to a question that named both.
  Milestone 0 item 5 (`0035`).
- **Owning agent:** **`architecture-agent`** — the generator and its output are part of
  `packages/contracts/**`. `web-agent` consumes; `core-agent` consumes. **Neither consumer
  edits generated output.**
- **Precedent:** `0009`, the zero-dependency contract relation validator. This is the same
  answer to the same question, for a different consumer.

---

## The problem, and it has already cost us once

**Nothing in this repository executes the contracts.** `packages/contracts/README.md`
records it plainly: there is no implementation and no validator. The YAML is read by people.

So **every type on every client is hand-written from a document nobody's tooling checks**,
and `workflow.md` §12 names exactly what that produces — *a machine-readable constraint is
an instruction to a person who will follow it literally, with no tooling to disagree with
the prose.*

**`0034` is the worked example, and it is not hypothetical.** The deployed console sends
`identifier` on `platform.organizations.members.resolve`. The contract publishes
`target_identifier`. **The route works in production because the client read the code
rather than the contract** — and once one client has done that successfully, the contract
has stopped being the source of truth for everyone. That divergence survived review,
survived deployment, and was caught by a checker written for a *different* defect.

**An administration product multiplies this by every milestone.** Milestones 1–5 are
almost entirely client code consuming Core contracts. Hand-writing that surface is choosing
to reproduce `0034` at scale.

## The decision

**A first-party generator, in `packages/contracts/`, with zero dependencies.** It reads the
contract YAML and emits TypeScript request, response and error types.

**Why first-party rather than `json-schema-to-typescript`:**

- **It is the `0009` answer, and `0009`'s reasoning has not changed.** We already wrote a
  zero-dependency reader for this exact corpus. A second one is cheap; a supply chain is
  not.
- **Our schemas are a small, closed subset of JSON Schema.** A general-purpose generator
  spends its complexity on `$ref` graphs, `oneOf` discrimination and draft differences we do
  not use — and brings its opinions about how those map to types.
- **The generator can enforce things a general one cannot.** It knows our contracts have a
  request shape, a response shape, error cases, an authorization expectation and a tenant
  scope (`architecture.md` §1). It can **refuse to emit** for a contract missing any of
  them, which turns a documentation gap into a build failure.

**The cost, stated:** we own the generator's correctness, and it needs its own tests. A
generator that emits plausible-but-wrong types is worse than hand-written ones, because it
carries the authority of having been generated.

## Four requirements, and the third is the one that keeps this alive

**1. Generated output is committed, not built on the fly.** It is reviewable in `git diff`,
it needs no build step in either consumer, and a reader can see what a contract change did
to the client surface. Every generated file carries a header saying it is generated, from
which contract, and that edits will be overwritten.

**2. Generated types are consumed, never re-declared.** A hand-written type that restates a
generated one is the defect this ADR exists to remove, arriving one layer up. This applies
to Zod schemas too (`0036`): **derived from the contract, never authored beside it.**

**3. A drift check compares committed output against a fresh generation, and it joins the
gate.** Without it, the generated files rot exactly as hand-written ones do — with the extra
harm that they *look* authoritative. The check regenerates in memory and diffs.

> **It must report the population it examined against an independently derived
> expectation** — `workflow.md` §11a, and this repository has been bitten by its absence
> twice in one week. *"42 contracts read, 42 type modules emitted, 0 differences"* against a
> `find | wc -l` is a check. *"0 differences"* is a number that reads identically when the
> glob has stopped matching anything. **A generator handed nothing emits nothing, and
> nothing diffs clean against nothing.**
>
> **And it ships with a known-failing input** — a fixture contract whose committed output is
> deliberately stale, which must make the check go red. Without it we cannot distinguish
> sound-by-design from sound-by-accident, and both look identical while passing.

**4. It goes into the gate the day it exits 0, and not before.** Same rule as
`check:source-bytes` and `check:route-fields`: **a red gate folded into a green one makes
the green one worthless.**

## Scope: TypeScript now, Swift named as owed

**TypeScript first**, because it serves `platform/web/**` and `platform/core/**` — the two
consumers with a Milestone 0–5 dependency on it.

**The Apple client cannot consume TypeScript**, and `architecture.md` §1 is explicit that
**both clients consume the same approved contract set**, with *"a shape the web application
has and the Apple application does not"* being a **contract defect, not a client-local
workaround.**

> **So a Swift emitter is owed, and this ADR names it as owed rather than leaving it
> implicit.** `Dudo-Apple` hand-writes its types today and will keep doing so until the
> emitter exists — which means **the drift `0034` documents remains live on the Apple side
> for as long as that is true.** Stating it here is not a substitute for fixing it: the
> owner is `architecture-agent`, and the trigger is the first `Dudo-Apple` work after
> Milestone 0. **This is deliberately an owner and an event rather than a conditional
> sentence for a future reader to resolve** (`workflow.md` §12).

> ### WHAT THE SWIFT EMITTER INHERITS FROM `0041`, WRITTEN BEFORE IT EXISTS
>
> **Added 2026-09-09 by the Team Lead, from `web-agent` raising it unprompted while swapping the
> first TypeScript types. Recorded HERE rather than sent as a message, because the agent it is for
> has not started the work yet and a message would be gone by then.**
>
> **`0041` amendment 3: an `extensible` enum silently defeats every type guard written against the
> generated type.** In TypeScript the unknown arm is `(string & {})`, which absorbs every string —
> so `isKnownX(v): v is X` always holds, and the branch after it is **believed rather than checked**,
> with nothing red.
>
> **Swift has no `(string & {})`.** The emitter will have to choose some other unknown arm — a
> `case unknown(String)`, a failable raw-value initialiser, something else. **The hazard reappears in
> whatever shape that choice takes, because it is not a property of the syntax.**
>
> **The rule survives translation because it is about PROVENANCE, not about the arm:**
>
> > **A guard narrows to a type the consuming file DECLARES, never to one it IMPORTS from the
> > generated contract set.**
>
> **And do not restate it as a naming convention when the emitter lands.** `web-agent`'s first
> TypeScript version of that check keyed on a `Known` prefix and **failed three guards that were
> entirely correct**, because a `closed` enum has no wire/known split at all. **The convention would
> also have blessed the one case that matters** — a guard narrowing to an imported `closed` enum,
> which compiles, reads as tidier, and couples a client's branch set to a contract that may widen
> later.

## What this does not do

- **It does not validate at runtime.** These are compile-time types. A generated type says
  what the contract promises; it does not check what arrived. Runtime validation on the
  server is Core's, unchanged, and it is not made optional by a client having good types.

  > **⚠ AND THIS IS THE TRAP IN EVERY SWAP — named before the first one, after `web-agent`
  > flagged it while scoping the Milestone 1 conversion.**
  >
  > A client replacing hand-written declarations with generated ones sits **right beside its own
  > response parsers** — `parseWhoami`, `parseResolveMember` and the rest. **Those look like the
  > same duplication this ADR exists to remove. They are not.**
  >
  > **The generated type is what the contract PROMISES. The parser is what checks what ARRIVED.**
  > Deleting the parsers because *"the types are generated now"* **removes the runtime checking and
  > keeps the compile-time claim** — the wrong half to keep. **And it would land as a tidy-up, in a
  > diff that only deletes.**
  >
  > **THE TYPE DECLARATIONS ARE REPLACEABLE. THE PARSERS STAY.** A change that touches both is not a
  > swap; it is a swap plus the silent removal of the only thing standing between a wrong response
  > and the screen.
  >
  > **And generation makes that parser MORE necessary, not less.** Before, the client's hand-written
  > shape and the server's response were two independent statements, and a mismatch had two chances
  > to look odd. **Now the client's type is derived from the same contract the server was built
  > against — so a wrong contract produces a client and a server that agree with each other and
  > with nothing real.**
  >
  > ### THE SAME TRAP FROM THE OTHER SIDE — added 2026-09-09, found on the first real swap
  >
  > Above: **deleting a parser because the generated type promises the shape.** Its mirror, and
  > `web-agent` hit it on the first field it looked at:
  >
  > > **ADOPTING A GENERATED TYPE THAT PROMISES MORE THAN THE PARSER CHECKS.**
  >
  > `template-v1`'s `status` is `enum: ["active","retired"]`, so the generated type is a two-value
  > union. **The parser reads it with `requireString`** — it checks the value is a string, **not that
  > it is one of the two.** And the screen calls `isKnownTemplateStatus` and **renders an
  > unrecognised value neutrally, deliberately.** The hand-written type said `status: string`, with:
  > *"narrowing by cast would be this client asserting Core's guarantee on Core's behalf."*
  >
  > **Adopt the union unchanged and that tolerant branch becomes dead code by the type system's
  > reckoning — which is how the next person deletes it — while the runtime can still produce the
  > case.** The compile-time claim gets stronger and **nothing verifies it.**
  >
  > **THE TWO HALVES ARE ONE RULE:** *the generated type is what the contract promises; the parser is
  > what checks what arrived.* **Deleting the parser drops the check and keeps the claim. Adopting a
  > narrower type than the parser enforces raises the claim without raising the check.** Both leave
  > the same gap, from opposite directions, and **both land as tidy-ups.**
  >
  > **The resolution is a CONTRACT question and it is recorded in `0041`:** an enum must declare
  > whether it is **closed** — a new value is a breaking change, so the parser may enforce it — or
  > **extensible**, in which case clients must survive a value they were never taught and the
  > generator must not emit a bare closed union. **A client cannot be tolerant at runtime and narrow
  > at compile time without one of the two lying.**
- **It does not make the contracts correct.** It makes the clients *agree with* the
  contracts. A contract that is wrong will now be wrong identically everywhere — which is an
  improvement, because a single wrong thing is findable and two disagreeing ones are an
  argument.
- **It does not execute JSON Schema.** `required`, `enum`, `pattern` and
  `additionalProperties` still instruct a human reader on the server side. Closing that is a
  separate piece of work and this ADR does not claim it.
