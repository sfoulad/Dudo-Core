# 0038 — Two Milestone 2 preconditions whose deferral triggers have now fired

- **Status:** **OPEN — no decision is taken here.** This record establishes that two
  previously-deferred questions are now **blocking**, names their owners, and states what
  each decision must argue against. It deliberately does not resolve either.
- **Found by:** `architecture-agent`, while producing the Admin capability matrix
  (`0035` Milestone 0 item 2). Reported as **F-1** and **F-2**, at the top of its report
  rather than the bottom.
- **Verified independently by the Team Lead** against the source, before this record was
  written. Both quotations below are anchored to **their own block ids**, not to line
  numbers — `architecture.md` §3c's worst variant, which the Team Lead committed against
  this same agent three days ago and which is the reason the verification was done this
  way.
- **Blocks:** **Milestone 2 — Organization Administration** (`0035`). Neither blocks
  Milestone 0 or Milestone 1.

---

## ⚠ CORRECTED WITHIN THE HOUR, 2026-09-08. THIS SECTION ORIGINALLY CLAIMED F-1 AND F-2 WERE THE SAME SHAPE. THEY ARE NOT.

**What this section said:** that both were deliberate deferrals with stated triggers, that
the milestone program fired both triggers at once, and that this was the reason to record
them together.

**That is true of F-2 and FALSE of F-1**, and the error was the Team Lead's. Asked directly
whether F-1's absence was a decision or an unauthored route, `architecture-agent` re-checked
and found **the opposite of what the Team Lead had concluded from a code comment**:

> **`confirmation-v1` — `status: accepted` — block `theTWOCHALLENGEROUTES.ruling`, anchored
> to the block's own key:**
>
> *"THE MECHANISM IS ONE. THE CHALLENGE ROUTE IS **ONE PER EXISTING CLASS THAT CONTAINS A
> CRITICAL OPERATION**, BECAUSE THE CONTEXT DIFFERS EVEN THOUGH THE LOGIC DOES NOT. **Two
> today: one Action, one platform route.** Both call the same Core confirmation service,
> which is where every rule in this contract is enforced."*

Verified by the Team Lead in the file before this correction was written. The same block's
`theACTIONCLASSCHALLENGEISITSELFANACTION` specifies the missing route's design in full. **And
Core's own `confirmation/confirmation-service.ts` header says it was built for both:** *"The
Action-class challenge route and the platform-class challenge route differ in how they
authenticate and authorize; from here down they are identical."*

**So the shared service exists, an accepted contract specifies two routes, and one is
registered.**

### The governance finding, which is larger than the missing route

**A normative clause of an ACCEPTED CONTRACT was set aside by a comment in an
implementation file.** The Team Lead's original reading came from the doc comment on
`PlatformRoutePermission` in `platform/core/platform/platform-routes.ts`, which records a
*"Team Lead ruling, 2026-09-05"* deferring `core.confirmations.request` *"UNTIL A CRITICAL
ACTION EXISTS"*. That comment is well-argued and its caution about `Action.permission` still
stands. **It is also not a mechanism for withdrawing a contract clause.**

- **`architecture.md` §1: contracts are authored by `architecture-agent` and agreed.** A
  comment in a route table is not that process, and **nobody sweeping the contract would
  ever find it.** The contract still reads as requiring two routes, because it does.
- **`architecture.md` §3c, from the other side.** A comment that cites a contract is a claim
  about it. This comment does not cite the contract at all — **it silently overrides one**,
  which is worse, because there is no citation to check.
- **And the Team Lead then repeated the error at one remove**, reading that comment as
  authoritative and recording F-1 in this file as a deferral whose premise had expired.
  **The comment was accurate about its own reasoning and silent about the contract it
  contradicted**, which is exactly how the first reading survived.

**Consequence: F-1 is a BUILD ITEM, not a design question.** One Action-class route over a
service that already exists, specified in full by an accepted contract. It is bounded and it
needs no new decision.

**F-2 alone retains the shape this section originally described** — a deliberate deferral,
honestly recorded, whose trigger `0035` has now fired. That observation is kept, because it
is worth keeping:

> **`workflow.md` §12, arriving from the direction nobody watches.** §12 is mostly about a
> decision being *withdrawn* and leaving live assertions behind. This is the other end: a
> decision *deferred* **with a stated condition**, the condition later becoming true, and
> **nothing going red when it does.**
>
> **The trigger fired because of a scope decision made somewhere else entirely** — `0035`
> named Organization Administration as Milestone 2. Nobody re-read the deferral when that
> happened, and nothing would have prompted them to. **A deferral's trigger is not usually
> tripped by work on the deferred thing.**

**Why the wrong version is corrected in place rather than deleted:** the mistake is the
useful part. It shows that a code comment can absorb a contract clause so completely that
the Team Lead, verifying carefully and quoting accurately, reproduced the override as
though it were the record.

## F-1 — twelve tenant-scope `critical` permissions are unreachable, and it is fail-closed

**The Action-side gate exists and refuses.** `platform/core/action/pipeline.ts` gates on
`requiresConfirmation(action.permission)`, and `confirmations?` is documented as *"ABSENT
MEANS EVERY `critical` OPERATION IS REFUSED"*. **The lock is fitted on both surfaces and
only one has a key:** `platform.confirmations.request` is a **platform-class** route, so it
answers 404 off the admin hosts, and there is no tenant-side route that issues a challenge.
`architecture-agent` established this by **enumerating all five route tables**, not by a
search — which matters, because a search over `platform/core/**` is exactly what the NUL
bytes make unreliable (`workflow.md` §11a).

**This is nothing like a hole.** No tenant-scope `critical` operation can be performed
without a confirmation, and none can obtain one, so every one of them refuses. The system
fails closed, which is the designed behaviour.

**The absence is a code comment overriding an accepted contract — see the correction at the
top of this record.** The contract requires two challenge routes. What follows is the
comment that deferred the second one; it is quoted because its caution about
`Action.permission` survives the correction and must be carried into the build, **not
because it is the governing record.** In `platform/core/platform/platform-routes.ts`, in
the doc comment on the **`PlatformRoutePermission`** type:

> *"**THE EQUIVALENT EXTENSION TO THE ACTION CLASS IS DELIBERATELY NOT MADE.** Team Lead
> ruling, 2026-09-05: `Action.permission` is read by `authorize()` and by every audit
> record, and making it dynamic is an extension to the most load-bearing shape in the
> product — **to serve a route that currently has nothing to point at.**
> `customers.customer.delete` is a deferred route and there is no second critical Action, so
> `core.confirmations.request` is **DEFERRED UNTIL A CRITICAL ACTION EXISTS**, because the
> change it requires is to the Action permission model and there is currently nothing to
> validate it against. That is the reason, and it is written here so the route is not built
> as a tidy-up."*

**Its premise has expired independently of the correction above.** It rests on *"there is
currently nothing to validate it against"* — and the capability matrix now names **twelve**
tenant-scope `critical` permissions, individually rather than as a category (`workflow.md`
§12: *a category is not a list*). So the comment was **wrong about the contract from the day
it was written, and is now also wrong about the world.** Both, separately:

`core.ai.configure` · `core.api-credential.issue` · `core.api-credential.revoke` ·
`core.app.grant-permission` · `core.app.uninstall` · `core.capability.configure-provider` ·
`core.mcp.configure-external` · `core.organization.delete` · `core.service-account.manage` ·
`core.subscription.change` · `core.tenant.export` · `customers.customer.delete`

**What is owed: build the Action-class challenge route the accepted contract already
specifies.** It borrows the permission of the operation it confirms, runs the identical
authorization pipeline including the `not_found`/`forbidden` collapse, and calls the shared
service that already exists. **The contract's own reason for that design is a security
property, not a convenience:** without it *"the challenge endpoint would be a universal
existence oracle over every critical target in the platform, reachable by anyone with any
session"* — a strictly worse hole than the one confirmation closes.

**Owner: `core-agent`**, building against an accepted contract. **No new decision record is
required**, which is the practical difference the correction makes.

**The one caution to carry over from the comment, because it was right:**
`Action.permission` is read by `authorize()` and by every audit record, and making it
dynamic is a change to the most load-bearing shape in the product. **That is a review
requirement on the implementation, not a reason to defer it again.** `security-agent`
reviews the permission-resolution path before integration.

## F-2 — an Organization cannot read or edit its own Organization record

**Larger than F-1, and architectural rather than unbuilt.**
`core.organization.read/update/delete` and `core.role.assign/revoke` name objects the
registry classifies **`control-plane`**. From `organization-identity-v1`, open question
**`OI-1`**, quoted in full because its recommendation is the substance:

> **question:** *"THE CUSTOMER CANNOT ENTER OR CORRECT THEIR OWN NAME, CR OR VAT NUMBER.
> `organization` is a control-plane table and no Action can reach it, so a Dudo operator
> transcribes these values on the customer's word, forever."*
>
> **recommendation:** *"ACCEPT FOR NOW; IT IS NOT REPAIRABLE INSIDE THIS CONTRACT. The two
> real answers are **moving the Organization profile out of the control plane**, or
> **designing a control-plane-write Action class** — both are decisions of their own, and
> the second must argue against `control-plane-store.ts`'s warning that reachability from
> `ActionContext` violates `CO1` in one line. UNTIL THEN THE VERIFICATION RECORD AND THE
> TENANT-SIDE AUDIT RECORD ARE WHAT MAKE THE ASYMMETRY SURVIVABLE."*
>
> **blocks:** *"Customer self-service on their own legal identifiers. **Not this
> contract.**"*

**"Not this contract" is an obligation nobody was assigned to collect** — precisely the
shape `workflow.md` §12 warns about. `0035` has now assigned it: **Milestone 2 is
Organization Administration, and an Organization administration product in which an
Organization cannot read or edit its own record is not the product.**

### `OI-1`'s two halves do not agree, and the `recommendation` is the accurate one

**`architecture.md` §3b, found by asking whether the sentence names which side it means.**
The Team Lead suspected it and `architecture-agent` confirmed it in the file:

- **The `question` states a law:** *"`organization` is a control-plane table and **no Action
  can reach it**"* — read alone, an architectural impossibility.
- **The `recommendation`, three lines down, contradicts that reading:** it proposes
  *"designing a control-plane-write Action class"*. **A thing you can design is not a thing
  that cannot be reached.**

**What actually enforces the constraint** is `identity/control-plane-store.ts` property
**4**, quoted from the file: *"NOTHING PUTS EITHER HALF ON `ActionContext`, AND AN APP CANNOT
BUILD ONE. Constructing the adapter requires a D1 binding, and App code never sees `Env` or
a binding."* **That is a property of the composition root and of who may construct an
adapter — not a law about Actions.**

**And this narrows the counter-argument the decision must beat.** The `CO1` hazard is about
handing App code a **general handle**, which would expose the principal→Organizations
mapping by another route. **A narrow named-question port carries neither consequence** — and
property **1** of that same file is the description of exactly such a port: *"THIS PORT IS
NOT A STORE. It has no `select(spec)`, no table name, no predicate, no column list and no
sort. It is a fixed list of named questions."*

> **So F-2 is a designable question with a named, bounded counter-argument — not a wall.**
> That is a materially better position than `OI-1`'s `question` sentence implies, and it was
> reachable only by reading the two halves against each other. **The overstatement was in the
> half a reviewer reads first.**

**This does not pre-decide it.** A bounded control-plane-write path for the Organization
profile fields is *available*; whether it beats moving the Organization profile out of the
control plane is the decision, and `security-agent` reviews whichever is proposed before it
is recorded (`security.md` §1).

**This is a tenant-isolation decision, not a routing one.** The second option — a
control-plane-write Action class — must argue against a one-line warning that reachability
from `ActionContext` **violates `CO1`**. That makes it `security.md` §1 territory:
**`security-agent` reviews whichever option is proposed, before it is recorded**, and the
review is not optional because the option sounds convenient.

## What happens next, and what explicitly does not

- **Milestones 0 and 1 proceed unchanged.** Platform Administration is entirely
  platform-class and touches neither question.
- **Both decisions are authored before Milestone 2 begins**, not during it. `0035`'s
  contract-first rule is not suspended because the blocker was found late.
- **Neither is resolved by widening a permission or moving a route to a different host.**
  Both of those are the shape of fix that would make the symptom go away and leave the
  boundary worse, and `0035`'s item 6 exists to refuse exactly that trade.
- **F-3 through F-9 are not in this record.** They are real and they are tracked in
  `architecture-agent`'s report and in the matrix; they are smaller, and folding them in
  here would let two blocking items hide inside a list of nine.

## One thing this record does not claim

**The twelve permissions in F-1 are `architecture-agent`'s enumeration, verified by the
Team Lead only in shape and not one by one.** The Team Lead independently verified: the
`PlatformRoutePermission` ruling (quoted above, read in the file), `OI-1` (quoted above,
read in the file), and that `platform.confirmations.request` exists as a platform-class
route with a `from-body` permission. **The count of twelve, and the claim that all five
route tables were enumerated, rest on the agent's measurement.** Stated so that a later
reader knows which sentences carry which weight.
