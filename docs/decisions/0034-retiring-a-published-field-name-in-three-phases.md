# 0034 — Retiring a published field name in three phases

- **Status:** **ACCEPTED by the Dudo Team Lead, 2026-09-07.**
- **Required by:** `.claude/rules/architecture.md` §1 — *a breaking change to a published contract
  requires Team Lead review and a decision record.* **Phase 3 is that breaking change.** Phases 1
  and 2 are additive and are recorded here because they are what makes phase 3 safe.
- **Governs:** `organization-detail-v1`'s `resolveMemberInput`, and the general shape of retiring
  any published field name
- **Contract authored by:** `architecture-agent` · **Implemented by:** `core-agent`, then
  `web-agent`, then `core-agent`

---

## The defect

`platform.organizations.members.resolve` declared **`identifier`**. Its contract published exactly
one property: **`target_identifier`**. Both directions failed — a client sending what the contract
published was refused *before authentication*, and the route accepted a name no contract published.

**This is `architecture.md` §1a's rename half-landed.** That ruling renamed both sides of a
collision so that neither meaning holds the bare word: `reauth_identifier` for the caller's own,
`target_identifier` for the target's. **`platform.credentials.reset` got it. The resolve did not.**

**And the deployed console sends `identifier`.** So member resolve works in production **because the
client read the code rather than the contract** — precisely the state `workflow.md` §12 names:
*once one client has done that successfully, the contract has stopped being the source of truth for
everyone.*

**Found by a checker on its first run.** `scripts/check-route-fields.mjs` was built to catch the
`display_name` divergence and found this one immediately — which is the argument for building the
check rather than fixing the instance.

---

## The decision

**Three phases. The destination is `target_identifier`.**

| Phase | Change | Breaking? |
|---|---|---|
| **1** | Core accepts **both** names. Exactly one must be present. | Additive |
| **2** | The console switches to `target_identifier`. | Additive |
| **3** | Core and the contract drop `identifier`, **in one change**. | **Breaking** |

### Why not simply rename Core

**That is a server refusing a field the deployed client sends.** It is the same outage `0031`
sequenced `display_name` to avoid, in the same direction.

**This shape arrived three times in one day** — `display_name` optional-but-undeclared, this
rename, and the audit-window exemption — and the answer was the same each time. **A change that is
correct in isolation is an outage when one side is already deployed.** The order is always: widen,
switch, narrow.

### Why not change the contract to `identifier` instead

That is the one-line fix and it is refused. **It re-opens the exact defect §1a closed.** The bare
word does not say *whose*, and §1a's finding is that a name which does not say whose is a name two
contracts can both use correctly while meaning different things by it — a defect **no reading of
either document could find**, because neither was wrong on its own terms.

**The cheap fix here spends a rule written after a defect that would have returned `forbidden` on
every well-formed request, permanently.** Not worth one line.

### The objection, recorded as fair and overruled

`core-agent` noted that phase 1 briefly puts two names on one field, **which is the ambiguity §1a
exists to prevent**, and declined to proceed on its own initiative. That was the right call.

**The distinction that makes it acceptable: §1a's collision was ONE NAME MEANING TWO DIFFERENT
PARTIES. This is TWO NAMES MEANING THE SAME PARTY.** A deprecation alias, not a namespace with two
owners.

**The reservation is unaffected.** `identifier` remains forbidden as a **new** field name anywhere,
platform-wide. This is an old one being retired, and the two are not the same act.

---

## Both fields present is REFUSED, and neither is refused

**Not "prefer `target_identifier`".**

A route that silently prefers one lets a client send the wrong name forever and never learn. And
**if the two values differ, silently choosing is choosing which principal to resolve** — on a route
whose whole purpose is naming a person.

**Refusing is testable and has a known-failing input. Preferring is a behaviour nobody will ever
write a case for.**

### Expressed in the schema, enforced in Core, executed by nothing — three states, not two

The contract expresses exactly-one as a `oneOf` over two single-element `required` branches: send
one and one branch matches; send both and **both** match, so `oneOf` fails; send neither and none
match. The outer object keeps an empty `required`, so it stays satisfiable.

**That construction is right, and it does not execute.** Nothing in this repository runs JSON
Schema — `packages/contracts/README.md` records that there is no validator. So the rule is
**expressed** in a machine-readable form and **enforced** only because `core-agent` implements it.

**This distinction is recorded because the draft got it wrong first**, saying exactly-one *"falls
out of the schema rather than being a sentence someone implements."* It does not. That is
`workflow.md` §12's two-axis finding — *scope* and *liveness* are independent, and a document can be
scrupulous about one while blind to the other — recurring in the same week, one level down. **A
reader who trusts the stronger claim concludes the rule is handled and never checks that Core wrote
it.**

---

## ⚠ PHASE 3 HAS A HARD PRECONDITION THAT DID NOT EXIST WHEN THIS RECORD WAS WRITTEN

**Added 2026-09-07 by `qa-agent`, building the phase-1 cases. `OD-5` MUST NOT BE DISCHARGED UNTIL
THIS IS CLOSED.**

**`resolveMember` collapses the two names into one local value before it does anything else, and
nothing downstream records which spelling arrived** — not the action log, not the response, not a
counter. Read end to end to confirm it.

**So the question *"is any client still sending `identifier`"* has no answer in this system.** And
phase 3 is precisely the change that breaks whichever client still is.

**The console is not the only possible caller.** The Apple client and any script are exactly the
ones nobody would remember to check — and the console's own history is the argument: it sent
`identifier` for weeks *because it had read the code rather than the contract*, and nobody knew
until a checker was written.

> **PRECONDITION: Core records which spelling arrived, on the action record. Phase 3 then cuts over
> on evidence — "no request has carried the deprecated name in N days" — rather than on the
> assumption that the only client anyone remembered has switched.**

**Why this is stated as a precondition rather than a suggestion.** The original phase-3 trigger below
is *"the change that follows the console's switch"*. **That trigger is now satisfiable while the
question is still unanswerable**, which would make `OD-5` a blind removal wearing a checkable
condition. `workflow.md` §12's warning is about obligations nobody is assigned to collect; this is
the narrower case of **a trigger that fires before the evidence it implies exists.**

**`qa-agent` built the accepting half and could not build the evidence half**, and said so rather
than reporting the case as covered: *"a test cannot assert a fact the system does not keep."* The
tripwire it left goes red the day `OD-5` is discharged and names everything that must move together
— the contract's `oneOf`, the console, **and `harness/platform-fixture.ts`'s `successfulCallFor`,
which sends the deprecated name today.** The test fixture is itself built on the spelling that is
going away.

## Phase 3 has an owner and an event trigger, not a date

**`OD-5`**, greppable in `organization-detail-v1`, triggered by *the change that follows the
console's switch*.

**`workflow.md` §12 is explicit that a conditional left for somebody to notice becomes an obligation
nobody is assigned to collect**, and this contract set already carries one of those in `ON-7`. A
date would be a guess; an event is checkable.

**Discharging `OD-5` means removing the contract property and Core's route-table field IN ONE
CHANGE**, because `check-route-fields` compares them and goes red if they are split. **That is the
check working**, and it is stated in the entry so that nobody treats it as an obstacle to route
around.

---

## The population is ONE, and that is a measured result rather than an assumption

The Team Lead asked how many other routes carry a bare `identifier`, **expecting more** on the
grounds that two renames with one miss is a 50% miss rate and unlikely to be the whole set.

**It is one.** `architecture-agent` swept it by shape and reported every search including the empty
ones:

- **No contract in `packages/contracts/**` publishes a bare `identifier`.** The contract side was
  already fully renamed. **This empty result is the load-bearing finding, not an absence.**
- **Exactly one Core route table declares it** — `platform-routes.ts:533`, the resolve.
- The prefixed set is complete and correct: `admin_identifier`, `target_identifier`,
  `reauth_identifier`, `identifier_hash`.
- **~60 bare `identifier` hits in contract prose, all descriptive English.** *The noise is the
  finding*: the word is unavoidable in prose, which is exactly why the search had to be shaped
  rather than lexical. A lexical search drowns here and a careless reader concludes the opposite.

**The Team Lead's suspicion was wrong and is recorded as wrong**, because a rate computed on a set
of two is not evidence about a third.

### Two uses deliberately left alone

**Deciding which look-alikes are the same rule is the judgement a shape-driven search cannot make.**

- **`login-v1` publishes `email`, not `identifier`.** Pre-auth, one party, no other principal in the
  request — **nothing to be ambiguous between.** Not a member of the class. Harmonising it would
  have been the same mistake as dragging a customer's contact `email` into the identifier rule.
- **A separate thread, named rather than smuggled in:** login's field is arguably named for a
  *shape* rather than a *role*, where the canonical definition is `account-identifier-v1`'s
  `accountIdentifier`. **Recorded as unrelated to this reservation** and left for someone to decide
  on its own terms.
