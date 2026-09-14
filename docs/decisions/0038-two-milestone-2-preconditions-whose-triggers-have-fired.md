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

> ## ⚠ BOTH ARE ANSWERED AS OF 2026-09-13. NEITHER IS BUILT. THOSE ARE DIFFERENT STATES, AND THIS BLOCK EXISTS SO THE HEADER'S `OPEN` IS NOT READ AS EITHER ONE.
>
> **The `Status` line above is left unedited.** It was accurate, the team acted on it for five days,
> and rewriting it would hide that these were genuinely open. **This block governs.**
>
> ### F-2 — THE DESIGN QUESTION IS SETTLED BY `0044`, VIA A ROUTE NEITHER OF `OI-1`'s OPTIONS NAMED
>
> **`OI-1` named exactly two "real answers". `0044` refused both:**
>
> | `OI-1`'s option | `0044`'s ruling |
> |---|---|
> | **Move the Organization profile out of the control plane** | **REFUSED, §2b** — a SCHEMA cost paid to avoid a CONFIGURATION one, the exact inversion `0030` forbids |
> | **Design a control-plane-write ACTION class** | **REFUSED, §2a, absolutely** — Actions are the App execution path, so a control-plane port on `ActionContext` is `security.md` §4: *"no exception for any plugin, for any reason"* |
>
> **`0044` took a third path neither option contemplated: A FIFTH REQUEST CLASS** — control-plane
> reach, tenant resolved from the authenticated context, permission evaluated on every call, **and
> NOT App-reachable.** That last property is the entire safety argument, and it is what makes the
> class lawful where widening the Action class was not.
>
> > **`0044` §2c records it as a DERIVATION rather than a decision** — *"when only one option does not
> > violate an existing rule, that is a derivation"*. **Worth carrying here, because `OI-1`'s framing
> > made this look like a choice between two bad options and it was neither of them.**
>
> **WHAT REMAINS OF F-2 IS BUILD, NOT DESIGN.** `0044` §4 is explicit: *"`OI-1` is closed by a route
> in this class being built, NOT by this record."* **Measured 2026-09-13: six tenant-admin contracts
> declaring 26 operations, and `TENANT_ADMIN_ROUTE_COUNT` = 0.** The blocker is the eighteen-permission
> grant, which is with the user — **a route whose permission no role holds fails
> `assertEveryRoutePermissionIsReachable` at build time, which is the mechanism working rather than
> an obstacle.**
>
> ### ⚠ F-1 IS RULED DEFERRED, 2026-09-13 — AND THE "BUILD ITEM" FRAMING BELOW IS WITHDRAWN AS TO THE ACTION-CLASS ROUTE
>
> **`core-agent` was sent to build it, stopped, and reported why — which is what the brief asked for
> and is the reason this ruling exists rather than a half-built route.**
>
> **THE FRAMING THIS RECORD GAVE — *"one route over a service that already exists… bounded and it
> needs no new decision"* — IS TRUE OF THE HANDLER AND FALSE OF THE PERMISSION MODEL IT NEEDS.**
> `platform-routes.ts` records the original deferral's real cause: making `Action.permission` dynamic
> is ***"an extension to the most load-bearing shape in the product."*** **That extension is still
> owed, and `0038` set it aside by describing the half that was easy.**
>
> **AND THE TWO CHALLENGE ROUTES ARE NOT ONE PIECE OF WORK, WHICH THIS RECORD ALSO IMPLIED:**
>
> | | needs |
> |---|---|
> | **tenant-admin** | nothing new — `TenantAdminRoutePermission` **is being written now** and accommodates from-body resolution natively. **Buildable, and being built.** |
> | **Action class** | an extension to `Action`, a shipped shape carrying eight App Actions and every third-party App to come |
>
> #### THE MEASUREMENT THAT DECIDES IT: THE ACTION-CLASS ROUTE HAS NO CALLER
>
> ```
> tenant-scope `critical` permissions in the catalogue        14
> of those, gating an ACTION-class operation                   1   customers.customer.delete
> that permission in roles.ts                                  NOT_GRANTED_TO_ANY_ROLE
> assertRoleMappingIsCoherent if any role holds it             FAILS THE BUILD
> ```
>
> > **So no Action-class `critical` operation is reachable by any principal alive, by deliberate
> > decision and with a build-failing assertion behind it.** The Action-class challenge route would
> > serve **zero callable operations** — and buying it costs an extension to the product's most
> > load-bearing shape.
>
> **RULED: F-1 STAYS DEFERRED. Not as an oversight and not as a build item — as a decision, with the
> cost named and the population measured at zero.**
>
> **THE TRIGGER IS AN EVENT AND IT IS ASSIGNED** (`workflow.md` §12 — a deferral without an owner is
> one nobody collects): **the first `critical` Action-class operation that any role can hold.** The
> Team Lead reopens it then. ~~**`assertGatedRoutesCanObtainAConfirmation` is what makes that
> unmissable** — such an operation fails the build naming the missing route, rather than shipping an
> operation that authorizes, gates, and can never be satisfied.~~
>
> #### ⚠ THAT SAFETY NET DOES NOT EXIST. CORRECTED WITHIN THE HOUR BY `core-agent`, WHOSE ASSERTION IT IS.
>
> **The ruling above is unaffected — the population is still zero and the `Action` extension still
> costs what it costs. What is wrong is the mechanism the deferral was made ON THE STRENGTH OF.**
>
> ```
> assertConfirmationCoherence…            iterates the PLATFORM route table
> assertGatedRoutesCanObtainAConfirmation iterates the TENANT-ADMIN route table
> the Action registries                   NO registration-time coverage check AT ALL
> the only Action-side confirmation code  action/pipeline.ts:645 — a RUNTIME gate in the request path
> ```
>
> > **IT CANNOT SEE AN ACTION.** So when the trigger fires, **no build fails.** A `critical`
> > Action-class operation with no challenge route authorizes, gates, demands a confirmation the
> > caller cannot obtain, and **fails every call at runtime** — fail-closed, nothing exposed, **and
> > precisely the *"authorizes, gates, and can never be satisfied"* state this deferral was taken on
> > the understanding a build check would prevent.**
>
> **`workflow.md` §12: A DEFERRAL RESTING ON A CHECK THAT CANNOT SEE ITS SUBJECT IS A DEFERRAL NOBODY
> WILL COLLECT.** The Team Lead named the assertion; `core-agent` owns it and **settled it in two
> greps rather than arguing about it** — `§11a`'s *right hazard, wrong instrument*, **with the
> instrument belonging to the party who could measure it.**
>
> #### WHAT REPLACES IT — AND IT KEYS ON THE EVENT RATHER THAN A PROXY FOR IT
>
> **`core-agent` offered two and the second is better, for a reason worth keeping:**
>
> | | |
> |---|---|
> | an `assertActionConfirmationCoverageIsCoherent` over the Action registries | correct, and it checks **route coverage** — a proxy for the trigger |
> | **an assertion in `roles.ts` that NO ROLE HOLDS A `critical` PERMISSION GATING AN ACTION-CLASS OPERATION** | **this IS the trigger.** *"any role can hold it"* is the event, stated directly, **and `assertRoleMappingIsCoherent` already runs there** |
>
> **RULED: the second. `core-agent` builds it.** A check keyed on the event fires on the event; a
> check keyed on a proxy fires when the proxy moves, **and the two come apart exactly when somebody
> grants a permission without adding a route — which is the order these things actually happen in.**
>
> **AND THE BOUNDARY IS RECORDED AT THE ASSERTION ITSELF**, so the next reader does not inherit the
> belief. `architecture.md` §3b-ii: **a header full of true claims reads as covering the class of
> problem**, and that header's claims are all true of the tenant-admin table it iterates.
>
> **What is NOT deferred: the tenant-admin route, which is buildable now and needs no permission of
> its own.** `0044` §3e-i, and the user confirmed it 2026-09-13.
>
> ---
>
> ### ~~F-1 — STILL A BUILD ITEM, AND NOW KNOWN TO NEED NO PERMISSION~~ *(the "build item" half is withdrawn above; the no-permission finding stands and is why the tenant-admin route proceeds)*
>
> **This record already ruled F-1 *"a BUILD ITEM, not a design question"*.** The question left open
> was whether the challenge route needs a nineteenth permission — **which would have meant a
> supplementary approval while eighteen sat undecided.**
>
> **It does not.** `confirmation-v1` declares, on both published challenge routes: ***"THE SAME
> PERMISSION AS THE OPERATION NAMED IN THE REQUEST… NOT A PERMISSION OF ITS OWN."*** Reasoning at
> `0044` §3e-i — **and it is a safety property rather than a convenience: a challenge route with its
> own permission would be a second door to every `critical` operation, gated by something other than
> what the operation itself requires.**
>
> **So F-1 is buildable now and does not wait on the grant.** `0044` §3e establishes that
> `confirmation-v1`'s own rule generates a THIRD challenge route for the tenant-admin class, with no
> amendment to that contract.
>
> ### WHY THIS BLOCK EXISTS AT ALL
>
> **`0043` and `0044` hold the answers and NEITHER CITES THIS RECORD.** A reader arriving at `0038`
> finds `Status: OPEN` and two questions **whose answers live in two files published five days later
> that do not point back.** Nothing is stale, nothing is miscited, and no sweep of what changed
> reaches it — **`workflow.md` §12 in its quietest form.** The obligation to connect them belonged to
> whoever accepted the later records. **That was the Team Lead, and it was not done at the time.**

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
