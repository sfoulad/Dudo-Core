# 0041 — An enum declares whether it is closed, and a client may not be tolerant at runtime and narrow at compile time

- **Status:** **ACCEPTED, 2026-09-09.** Team Lead decision, on a question `web-agent` raised and
  correctly declined to settle inside a type swap.
- **Owning agent:** `architecture-agent` authors the declaration and the generator's handling of it.
  `web-agent` and `core-agent` consume.
- **Governs:** every `enum` in `packages/contracts/**`, what `0037`'s generator emits for one, and
  what a client's parser is obliged to enforce.
- **Arises from:** `0037`'s requirement that generated types be consumed and never re-declared,
  meeting `customer-directory-v1` §11.1's requirement that a client survive a value it was never
  taught.

---

## The collision, found on the first real swap rather than in principle

`template-v1`'s `status` is `enum: ["active", "retired"]`. Four artifacts disagree about what that
means, **and each is locally correct**:

| | |
|---|---|
| **The schema** | two values — so `0037`'s generator emits a **two-value union** |
| **The parser** | reads it with `requireString` — checks it is a **string**, not that it is one of the two |
| **The screen** | calls `isKnownTemplateStatus` and **renders an unrecognised value neutrally, on purpose** |
| **The hand-written type** | `status: string`, with *"narrowing by cast would be this client asserting Core's guarantee on Core's behalf"* |

**So an unrecognised status passes the parser today and the screen handles it deliberately.**

**Adopt the generated union unchanged and that tolerant branch becomes dead code by the type
system's reckoning — which is how the next person deletes it — while the runtime can still produce
the case.** The compile-time claim strengthens; **nothing verifies it.**

> **A client cannot be tolerant at runtime and narrow at compile time without one of the two lying.**

**And the contract already suspected it.** `template-v1` carries an open question on this exact
field: *"`status` exists in the shape with two values and no route sets it. Every Template is active
forever."*

**It is not one field.** `OrganizationSummary.status` carries the identical comment, so PA-04 meets
it too. **Ruled once rather than five times.**

## The decision

**Every `enum` in a published contract declares which of two things it is.**

| | Means | Parser | Generator emits |
|---|---|---|---|
| **`closed`** | **adding a value is a BREAKING change** and requires a decision record under `architecture.md` §1 | **MUST reject** an unlisted value | the exact union |
| **`extensible`** | the server may send a value this client has never seen, **without a version bump** | **MUST NOT reject** an unlisted value — it widens | a union **plus** an explicit unknown arm, never a bare closed union |

**Undeclared is refused.** `0037`'s generator treats a missing declaration the way it treats a
missing tenant scope: **an absence is not a default.** This is `§1a`'s reasoning applied to a
keyword rather than a field name — *an absent declaration and a forgotten one are the same
character.*

## Why not simply pick one for everything

**Both single answers are wrong, and each is wrong in a way that has already cost this repository.**

**"All enums are closed"** makes every added value a breaking change to a published contract. **For
`errorCode` that is correct and deliberate** — `0037`'s discriminated envelope depends on the set
being exactly partitioned, and `qa-agent`'s partition check asserts it. **For a lifecycle status on a
first-party App it is a version bump for a feature**, and it invites the response `0034` documents:
someone widens the client instead, and the contract stops being the source of truth.

**"All enums are extensible"** means no enum can ever be relied on, **which would silently gut the
error envelope's discriminated union** — a shape whose whole value is that the compiler refuses the
combination the contract forbids.

**The two live cases genuinely differ**, which is the argument for declaring rather than defaulting:
`errorCode` is closed by design and checked by a suite; `status` has **no route that sets it** and an
open question saying so. **A rule that gave both the same answer would be wrong about one of them.**

## What this does NOT license

- **It does not license a permissive parser.** An `extensible` enum still parses — it checks the
  value is a string of the right shape and that the *known* arms are spelled correctly. **Tolerant
  means "survives an unknown value", never "accepts anything".**
- **It does not license widening a client past its contract.** A client meeting an unknown value on
  an `extensible` enum **renders it neutrally and does not act on it.** `0028`'s reasoning applies:
  a value you do not understand is not a value you may branch on.
- **It does not reopen `errorCode`.** That enum is `closed`, its partition is asserted, and
  `qa-agent`'s check goes red if the two subsets stop covering it exactly.

## A description asserting something about an enum's values answers one of two questions, and `enumPolicy` is only ever about the second

**Added 2026-09-09. Drafted by `architecture-agent`, recorded here by the Team Lead** — it declined
to edit this file and was right to: `docs/decisions/**` is the Team Lead's, and **an agent editing a
decision record because it was asked to is how `0004`'s separation stops meaning anything.** The
instruction to write it in was mine and it crossed the boundary.

**`closed` and `extensible` are about what may be ADDED. A schema description using the word
"closed" is usually about what may be STORED.** Those are different questions and the same sentence
answers only one.

**`platform-operator-v1`'s `organizationStatus` said *"a closed set; an unrecognised stored value is
never rendered to a client, because Core validates on read."* That is true, and it is schema-drift
protection** — it says nothing about whether a new status may be added. When suspension's successor
ships, Core's union widens and it emits the new value **correctly**, at which point a client holding
a closed type is wrong.

> **Treat any description using "closed" without saying which question it answers as evidence about
> NEITHER**, and read the versioning question off the route table and the permission catalogue
> instead: *is there a named future operation that would produce a new value?*

**The general shape, from three instances in one day, all TRUE sentences read as settling questions
they were not asked:**

| The sentence | What it settles | What it was read as settling |
|---|---|---|
| `TM-2`: *"no route SETS it"* | nothing writes the field | that the response omits it — **it is `required`** |
| *"no such resolver exists yet"* | nothing resolves URNs for **validation** | that nothing resolves them at all — **generation does** |
| *"a closed set"* | what may be **stored** | what may be **added** |

**None was stale and none was miscited.** Each was precise about one axis and silent about a second,
**and silence about an axis reads as coverage of it.**

## AMENDMENT 1 — `extensible` is a claim about what the SERVER sends, so a REQUEST enum is always `closed`

**Added 2026-09-09, from `architecture-agent` declaring `customer-directory-v1`'s `statusFilter`.**

**Both definitions above are phrased about what the server may send, and the ADR never said which
direction they apply to.** `statusFilter` is sent **by the client**.

> **`extensible` on a request field reads as *"the client may send anything"*, which is the opposite
> of true.** Core validates and refuses an unrecognised value with `invalid_argument` — **so an
> unknown arm would make the emitted type promise exactly what the route denies.**

**Binding: a request enum is `closed`, whatever its response counterpart is.** The direction decides
it regardless of whether the value set will grow: **if a fourth filter is added, clients get the
wider type in the same change that makes the server accept it** — which is what `closed` means and
is the correct sequencing rather than a cost.

**The mirrored pair is the case to keep in mind:** a status a client *reads* may legitimately be
`extensible` while the filter it *sends* over the same vocabulary is `closed`. **Two policies, one
value set, and the duplicate-policy check must not be read as forbidding that** — it compares
occurrences of the same values, and this is the one place where identical values correctly carry
different policies. **Where that happens, say so in both `$comment`s.**

## AMENDMENT 2 — `oneOf` variant sets ask the same question and `0041` did not reach them

**Added 2026-09-09, from `web-agent` attempting the `OrganizationDetail` swap, hitting a compile
error, and stopping rather than deleting what the compiler objected to.**

**`0041` governs `enum` — a set of scalar VALUES. `RegistrationRecord` is a `oneOf` DISCRIMINATED
UNION OF OBJECT SHAPES.** It asks the identical open-or-closed question — *may the server send a
variant this client was never taught?* — **and there was no way to answer it.**

**The admin console had already answered it for itself, in all three layers:**

```ts
| { readonly state: 'unrecognised'; readonly raw: string }
```

`parseRegistrationRecord` returns that arm for any unknown state, `OrganizationIdentity.tsx` narrows
on it, and it renders a visible panel quoting `record.raw` — *"Core reported the state X, which is
newer than this build."*

> **Adopting the generated three-variant union deletes `raw` from the type, turning that renderer
> into a compile error whose only "fix" is deleting a UI state the runtime still reaches.** That is
> `0037`'s trap one construct along, and **it would have landed as a tidy-up in a diff that only
> deletes.**

**Ruled: `enumPolicy` extends to `oneOf` variant sets, with the same two values and the same
meaning.**

- **`closed`** — the generator emits the exact variant union. Adding a variant is breaking.
- **`extensible`** — the generator emits the variants **plus an explicit unknown-variant arm
  carrying the discriminant and the raw payload.**

**The shape of that arm is not being invented here: the client already built the right one, under
pressure from a real requirement, and the contract should adopt it rather than the client deleting
it.** A generated union that is narrower than the parser is the same defect as a generated enum that
is narrower than the parser — *the compile-time claim strengthens and nothing verifies it* — and
this ADR exists because that is not allowed to happen silently.

**Until the declaration exists, `RegistrationRecord` is swapped LAST.** It is the one shape in the
Milestone 1 surface where *"adopt the generated type"* silently narrows a rendered state.

## AMENDMENT 3 — `extensible` SILENTLY DEFEATS EVERY TYPE GUARD WRITTEN AGAINST THE CONTRACT TYPE

**Added 2026-09-09 by `web-agent`, on the first swap of an `extensible` enum. This ADR created the
hazard, so it records it.**

```ts
function isKnownMembershipRole(role: string): role is MembershipRole
```

**Against `'owner' | 'member' | (string & {})`, that predicate is worthless.** The unknown arm
**absorbs every string**, so the guard always holds and **the branch after it is believed rather
than checked.** It compiles, it reads exactly like a narrowing guard, and **nothing goes red.**

> **This is the mirror of the collision this ADR was written to fix.** There, a client was tolerant
> at runtime and narrow at compile time. Here, a client is narrow at runtime and — because the
> generated type widened to say the truth — **its compile-time narrowing silently stopped meaning
> anything.** Same gap, opposite direction, and `extensible` is what opened it.

**Binding, and it is a naming rule with a real property under it:**

> **An `extensible` enum needs TWO types, and they must not share a name.** The generated type is
> **what may ARRIVE**. A guard must narrow to **what this build UNDERSTANDS**, which is a
> client-local type the client declares.

**The mechanical form:** *a type guard narrows to a type the consuming file DECLARES, never to one
it IMPORTS from `@dudo/contracts`.* **Stated as a property rather than as a naming convention, and
the difference is not cosmetic** — `web-agent`'s first version of the check keyed on a `Known`
prefix and **failed three guards that were entirely correct**, because a **`closed` enum has no
wire/known split at all** and its guard legitimately narrows to the exact generated union.

**And the property catches a case the convention would have missed:** a guard narrowing to an
imported **closed** enum. That compiles, reads as tidier, and **couples a client's branch set to a
contract that may later widen** — at which point the guard becomes the first defect again, with a
correct-looking name.

**The realistic regression is worth naming because it looks like tidying:** somebody sees a local
`KnownMembershipRole` beside an imported `MembershipRole`, **removes "the duplicate", and the code
compiles.** The guard then proves nothing. **That is `0037`'s deletion trap, one layer up, and it is
now covered by a negative control.**

**`architecture.md` §1a applies to the names themselves.** The four client-local unions were called
`OrganizationStatus`, `PlatformRole`, `TemplateStatus` and `MembershipRole` — **the exact names the
contract now exports for the same fields, meaning something different, each locally coherent.** One
import away from being read as the same thing. **Renamed so neither meaning holds the bare word**,
which is §1a's remedy applied to a generated namespace rather than to a request field.

## The duplicated-enum problem, and why the enforcement is a check rather than a `$ref`

**Found 2026-09-09 by `architecture-agent`, which stopped the sweep after one contract rather than
declaring 38 policies on top of it.**

**`platformRole` is defined in THREE contracts and the Organization status set in TWO.** `0041`
requires a policy per enum, so **a duplicated enum gets one policy per copy** — three copies can
carry three policies, drift silently, and emit three different client types for one wire field.
That is `workflow.md` §12's duplicated-constraint failure **with a machine-readable field attached**,
and the copies already disagreed in prose: one called the status set *"closed"*, the other said
nothing. **Declared independently they would have become `closed` and `extensible` for one field.**

**Ruled: every copy carries the same policy now; the `$ref` collapse waits.** Collapsing moves the
emitted types into a shared module **while a client is mid-conversion against them** — which is the
mistake this ADR's own phase 1 exists to avoid, applied to the fix instead of to the rule.

> **The enforcement is a check, not the collapse, and the check is STRICTER: a `$ref` unifies enums
> someone wired together. A value-set comparison catches two enums that are semantically the same
> and were never wired at all.**

**It went red on its first run, on a value set nobody had reported.** `errorCode` — the twelve-value
API taxonomy — is `closed` in `common/error-envelope.schema.json` and **undeclared in
`registries/app-manifest.schema.json`.** The two disagreements it was commissioned to catch had both
been repaired while it was being written; **it found a third that did not exist when the first two
were measured.** `workflow.md` §11a: *the real broken state contains the failures you did not think
of* — and here it kept producing new ones.

**And it is in a schema the generator never opens.** 17 of the 38 enums live in registry schemas no
admitted contract references. **A check scoped to the generator's reach would have passed over the
one live finding**, which is why both this check and the phase-2 trigger count from the schema files
on disk rather than from what emission touches.

## Consequences

- **`0037` gains a third refusal class**, alongside a missing request shape and a missing tenant
  scope: **an enum with no closed/extensible declaration.** Expect it to refuse on the first run —
  every enum in the corpus is currently undeclared.
- **The parser stops being a judgement call.** Today whether `requireString` or a narrow check is
  correct depends on a reader's guess about the field. **After this it is read off the contract**,
  which is `architecture.md` §3a's shape: the obligation is derived rather than remembered.
- **`template-v1`'s open question is answered by answering this**, and `architecture-agent` should
  say plainly whether a status nothing sets should be in the shape at all — **a field with two values
  and no writer is a different problem that this decision makes visible rather than solves.**
