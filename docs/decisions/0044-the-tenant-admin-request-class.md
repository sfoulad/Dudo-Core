# 0044 — The tenant-admin request class

- **Status:** **ACCEPTED 2026-09-13 by the Dudo Team Lead.** Recorded after reading
  `architecture-agent`'s 190-line draft in full, not from a report about it — same discipline as
  `0042`, and for the same reason: a status field records that a specific reader checked specific
  text. **The draft at `docs/architecture/proposals/0044-draft-*.md` is superseded by this file and
  should be deleted rather than left as a second copy.**
- **Proposed by:** `architecture-agent`. **Ruled by:** Team Lead (§3d, and the derivation framing).
- **Governs:** where tenant-administration routes live, and what that class may never acquire.
- **Arises from:** Milestone 2 — Full Organization Administration.

---

## 1. The blocker, measured rather than argued

**Milestone 2 administers the Organization. Almost nothing it administers is in the tenant database.**

```
TENANT DB       audit_event · business · denial_summary
CONTROL PLANE   organization · organization_membership · session · membership_role ·
                principal · principal_credential · organization_identity · template …
```

**`ActionContext` (`tenancy/tenant-context.ts:131`) exposes `store: TenantScopedStore`, `audit`,
`cursors`, clock, ids and correlation — AND NO CONTROL-PLANE PORT.** Every handle is tenant-bound
and an Action never holds a tenant identifier at all. **Verified independently by the Team Lead
before this was accepted.**

**So the Action pipeline — the only tenant-facing request class — cannot read or write
`organization`, `organization_membership`, `session`, `membership_role` or `organization_identity`.**
That is members, roles, sessions, profile and registrations: the milestone.

**`organization-identity-v1`'s `OI-1` records this as a limitation of ONE FIELD. It is a property of
the whole surface** — and the permission catalogue already stated the mechanism without anyone
drawing the consequence: *"`organization` is control-plane and an Action reaches no control-plane
port."*

## 2. Two of the three options violate accepted rules

### 2a. A control-plane port on `ActionContext` — REFUSED, `security.md` §4, absolutely

**This is not a layering trade. ACTIONS ARE THE APP EXECUTION PATH** — `apps/customers/actions/**`
ships eight, and third-party Apps will run there.

> **§4: plugins and the plugin runtime must NEVER open a database connection, issue SQL, use a Core
> ORM model, read Core caches or reach Core files. THERE IS NO EXCEPTION TO THIS RULE FOR ANY
> PLUGIN, FOR ANY REASON.**

**A control-plane port on `ActionContext` is reachable by every Action.** Refused outright rather
than weighed.

### 2b. Move tenant-editable settings into the tenant database — REFUSED, `0030`

**A SCHEMA cost paid to avoid a CONFIGURATION one** — the exact inversion `0030` forbids. **And it
leaves `OI-1` permanently open:** a customer unable to correct their own legal name, recorded as a
limitation and then made structural.

### 2c. A fifth request class — the only lawful path

> **WHEN ONLY ONE OPTION DOES NOT VIOLATE AN EXISTING RULE, THAT IS A DERIVATION RATHER THAN A
> DECISION.** Recorded so this is not read a year from now as a preference that could have gone
> otherwise.

**No fourth option exists and it was looked for.** The session class (`0021`) evaluates no
permission. The platform class (`0025` D3) has no tenant and is unreachable by a tenant principal
under `0024`. **An event or queue hop is §4 with indirection — the App path still reaches it.** A
read-only projection of control-plane data into the tenant database is §2b with a synchroniser.

## 3. The class

**Authenticated at principal level · tenant resolved from the authenticated context · permission
evaluated · reaches control-plane ports · reaches no other tenant, ever.** Modelled on `0025` D3:
its own registry, its own reachability assertion, no wildcard, fail-closed on an unrecognised route.

| | pre-auth `0014` §B | session `0021` | **tenant-admin** | platform `0025` D3 | Action |
|---|---|---|---|---|---|
| principal | none | session-level | **yes** | yes | yes |
| tenant | none | none | **YES, from context** | none | yes |
| permission | none | none | **yes** | yes | yes |
| control plane | — | — | **YES** | yes | **no** |
| App-reachable | no | no | **NO** | no | **YES** |

**The last row is the whole safety argument for creating a class rather than widening one.** §4 is
preserved by the two being **different classes**, not by a check inside one — and 2a would have put
them one shared port apart.

### 3a. Why it is safe

> **The class resolves a tenant from the authenticated context, and a platform operator holds no
> membership — so NO PLATFORM OPERATOR CAN REACH IT BY CONSTRUCTION, NOT BY A CHECK.**

`0024`'s mutual exclusion doing the work. **It is the one place where the two administrations cannot
merge by mistake.**

#### 3a-i. ⚠ "BY CONSTRUCTION" IS TRUE OF ONE POPULATION AND FALSE OF THE OTHER — AND THE SENTENCE DOES NOT SAY WHICH

**Added 2026-09-13, from `qa-agent` testing §3a's claim rather than re-deriving it, which is exactly
what it was asked to do. The sentence above is `architecture.md` §3b's defect in an accepted record
of my own.**

**Measured, `tenant-admin-authority.ts:194` and `:206`:**

```ts
resolve(principalId: string, organizationId: string): Promise<Result<TenantAdminAuthority>>
  const membershipOutcome = await store.findActiveMembership(principalId, organizationId);
```

| Population | Why it is refused | Is that "by construction"? |
|---|---|---|
| **A platform operator** | holds **zero** membership rows, so **no** lookup can succeed | **YES.** `0024` makes the row impossible. The claim holds exactly as written |
| **A tenant principal in A, naming B** | `findActiveMembership` returns nothing | **NO. THAT IS A CHECK** — a correct one, and a check is not a construction |

> **§3a is TRUE of platform operators and FALSE of cross-tenant principals, and it names only the
> first while reading as a property of the class.** A reader auditing cross-tenant reach meets a
> sentence saying the question is settled by construction and stops — which is §3b's finding
> precisely: **a dismissal that is specific about the wrong party is worse than silence, because
> silence prompts the question.**

**THE SHARPER HALF IS NOT THE SENTENCE. IT IS THE SIGNATURE.**

**`organizationId` is a bare `string`.** Nothing in the type records where it came from, so **the
safety property of this entire class depends on a fact the type system cannot see** — that every
call site fills that parameter from the authenticated context and never from the request.

**§3b.2 already forbids the request-supplied form and enforces it at REGISTRATION.** That is a real
mechanism and it is not what is being questioned. **What §3b.2 cannot reach is a handler that
obtains the value correctly and passes it on incorrectly**, or a future call site that does not go
through a registered route at all — a background job, a test harness, a second dispatcher.
**`architecture.md` §3a ranks the layers, and a registration check sits at *a guard inside the
statement*, not at *omission does not compile*.**

**RULED, and it is a hardening of an existing rule rather than a new one:**

- **`organizationId` on this port becomes a branded type that ONLY the context extraction can mint** —
  §3a's receipt pattern, applied to a tenant identifier instead of to a write. **A request-supplied
  value then fails to compile at the call site rather than being refused at registration**, and
  "by construction" becomes true in the sense the sentence already claims.
- **The brand must name its subject.** A receipt minted for the caller's Organization and spent on
  another is the obvious hole, and it closes the same way it does for `ControlPlaneWriteReservation`.
- **`findActiveMembership` STAYS.** It is the in-statement guard, and §3a is explicit that this is
  the layer with no window at all — **the one that still holds when a receipt has gone stale, or on a
  database restored past a migration.** Nothing here removes it; the brand is added above it.
- **Owner: `core-agent`.** The record is mine; the types are Core's.

**AND THE CORRECTION TO §3a ITSELF IS ONE CLAUSE, NOT A REWRITE.** The claim is kept and scoped:
*no platform operator can reach this class by construction* — **true, load-bearing, and `0024`'s.**
What is struck is the implication that the same argument covers tenant-to-tenant, which it never
did.

> **The finding cost one reading of one signature, and it was reached by an agent I had told to test
> a claim rather than apply a verdict.** `§11a`: *"I built this because the contract said it was
> accepted"* is the sentence that locates these afterwards — **and asking for the outcome instead of
> naming the axis is what got it found before a route existed to be wrong.**

### 3b. What the class must never acquire — a class is where reach accumulates

1. **No cross-tenant read of any kind** — not a count, not an existence check, not an error that
   distinguishes another tenant's identifier from a nonexistent one.
2. **The tenant comes from the authenticated context and from nowhere else.** No request shape may
   contain an organization identifier in any position — path, query or body — **and a route
   declaring one is refused AT REGISTRATION rather than at authorization.**
3. **Never manifest-declarable.** No App, SDK caller or AI principal may declare a route here.
4. **No wildcard permission**, and an unrecognised route id fails closed (`0007` rule 3).
5. **Every route evaluates a permission.** There is no unauthenticated member of this class — the
   distinction from `0021`, and why this is a fifth class rather than a widening of the third.

### 3c. Audit, and the bound this class does not inherit

**Every mutating route writes an audit record into the tenant's own `audit_event`** — the same table
`0028`'s platform-originated records land in, so a tenant reading their trail sees what they did and
what the platform did in one place.

> #### ⚠ AND THIS WHOLE CLAUSE IS A RELAXATION OF `API_STANDARD.md` §1, WHICH SAYS "MANDATORY" WITH NO "UNLESS". RECORDED 2026-09-13.
>
> ```
> API_STANDARD.md §1   | `audit` | Mandatory `true` for `sensitive` and `critical`. |
> 0044 §3c             audited unless a per-route argument says otherwise
> ```
>
> **An accepted ADR may relax a standard. What must not happen is the standard reading as
> unchanged** — and it does. **`API_STANDARD.md` §1 owes a pointer to this section**; routed to
> `architecture-agent`, whose file it is.
>
> **`architecture-agent` found this AFTER arguing three exemptions against this clause, and named
> the mechanism against itself:**
>
> > **"I argued the three exemptions against `0044` §3c and never opened the standard the class is a
> > relaxation of. The clause I was reasoning about was itself the carve-out, and A CARVE-OUT READS
> > AS THE RULE WHEN IT IS THE NEAREST THING TO HAND."**
>
> **That is `architecture.md` §3c's reader half one level up.** The citation checked out, the clause
> was real and accepted — **and it was the exception, reasoned about as though it were the baseline,
> by the party closest to it.** Everyone arguing about an exemption was standing inside a prior
> exemption nobody re-opened.

**Reads are not universally audited, and that is a DIFFERENCE FROM P4 stated rather than inherited.**
P4 audits platform reads because the actor is outside the tenant and enumeration is reconnaissance.
~~**Here the actor is a member reading their own data**~~, and a write per settings page view costs the
tenant's own allowance for no detection value. **Sensitive reads are audited individually, per route.**

> #### ⚠ THAT STRUCK CLAUSE WAS LICENSING THREE EXEMPTIONS AND ITS WORDS COVER NONE OF THEM. AMENDED 2026-09-13.
>
> **`security-agent` opened this record rather than working from either paraphrase in front of it,
> and found the record and its Core transcription disagree on the one axis that decides the
> question:**
>
> ```
> 0044 §3c (this record)      "the actor is a member reading THEIR OWN DATA"
> tenant-admin-audit.ts:19    "the actor is a member reading THEIR OWN ORGANIZATION'S DATA"
> ```
>
> **One word, inserted in transcription. On the record's words the clause licenses NOTHING beyond a
> self-read; on Core's it licenses EVERY intra-tenant read, which is every route in the class.**
>
> **THE SENTENCE WAS DOING TWO JOBS AND ONLY ONE OF THEM WAS IN ITS WORDS.** Its argumentative work
> is the contrast with P4 — **the actor is INSIDE the tenant rather than outside it** — and its
> words said *reading their own data*. `architecture.md` §3b: a dismissal precise about the wrong
> party. **Core resolved the ambiguity in the widening direction, silently, and that became the
> version an implementer reads.**
>
> **THE CORRECTED CLAUSE, AND THE SECOND SENTENCE IS THE ONE THAT WAS MISSING:**
>
> > **The contrast with P4 is the ACTOR'S POSITION: a member acting inside their own Organization,
> > not an operator reaching in from outside. THAT CONTRAST LICENSES ONLY THE ABSENCE OF A BLANKET
> > READ AUDIT. IT LICENSES NO INDIVIDUAL EXEMPTION.** A `sensitive` read is audited unless a
> > per-route argument says otherwise, **and that argument may not be this paragraph** — being
> > inside the tenant is true of every route here and therefore distinguishes none of them.
>
> **WHY THIS MATTERS MORE THAN THE ROUTE THAT SURFACED IT.** `0043` §5.4's exemption list has three
> entries — `tenant.members.sessions.list`, `tenant.invitations.get`, `tenant.invitations.pending-count`
> — **and they are not three judgements. They are three uses of this one clause.** On its own words
> the reason fits none: **sessions.list reads ANOTHER MEMBER'S data, `invitations.get` reads a
> NON-MEMBER'S plaintext address, `pending-count` counts NON-MEMBERS.**
>
> > **That is exactly how an enumerated exemption list becomes a default** — which is the failure
> > `architecture.md` §3a-i's enumeration was chosen to prevent, arriving through the *reason* rather
> > than through the *mechanism*. **The list stayed enumerated and honest; the licence behind every
> > entry was one sentence nobody re-read.**
>
> **ALL THREE ARE REOPENED.** Each owes its own argument or an `audit: required`. **`security-agent`
> reviewed only the first on its merits and said so** — it is claiming the licence does not cover the
> other two, not that they are wrong.
>
> **AND CORE'S TRANSCRIPTION IS CORRECTED TO THE AMENDED WORDING, NOT DELETED.** The divergence is the
> evidence — *the record and its copy disagreed, and the copy was the one being built against.*
> `workflow.md` §12's duplicated constraint: **the rule was restated once and agreed with itself
> never.**

> **⚠ THE CONSEQUENCE: THIS CLASS HAS NO EQUIVALENT OF P4'S ACCIDENTAL READ BOUND.** P4 makes every
> platform read a write, so the write ceiling bounds read cost — which `0042` recorded as
> load-bearing-by-accident. **Here it does not. Every read shape needs its OWN bound — a page cap or
> an index — and `freeTierImpact` must say which.** Invitations, sessions and usage are the three
> with unbounded shapes, and they are the same three `§6a` flagged.

**AND THE FAILURE MODE MOVES RATHER THAN DISAPPEARING — `qa-agent`, and it is the reason this clause
is normative rather than advisory:**

> **Under P4 an unbounded read was ACCIDENTALLY safe. Under this class an unbounded read is SIMPLY
> UNBOUNDED** — and invitations, sessions and usage are exactly the shapes where a page cap is easy
> to forget, **because none of them feels like a list.**

**RULED: every read shape in this class declares a page cap or names the index that bounds it. An
absent bound is a REGISTRATION FAILURE, never a fallback.**

> **A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF THIS, and it will be proposed as a convenience.**
> A route that forgot its bound and a route that accepted the default are indistinguishable
> afterwards — which is `architecture.md` §3a-i's shape: **key the requirement on the exception, so
> the unstated case is caught by the default rather than absorbed by it.**

**And note why this must be caught here rather than in review:** `security-agent` found the platform
version of this (SR-15) by reviewing a built surface. **Designing it out means the review that would
have caught it does not happen** — so the registration check is the only thing standing where the
review used to.

### 3d. A route may declare a CONJUNCTION of permissions. Never a disjunction. — TEAM LEAD RULING

**The caller must hold all of them, evaluated in Core on every call.**

`PlatformRoutePermission` is one permission per route, and that constraint is what made
`core.template-adoption.read` a separate NAME rather than a co-holding requirement. **That is a
property of a registry that already shipped; it does not have to be a property of one being written
now.**

> **`A ∧ B` is strictly MORE restrictive than either conjunct — enumerable, statically checkable,
> and it cannot widen reach. `A ∨ B` IS A WIDENING WEARING THE SAME SYNTAX.**

**Refuse the disjunction AT THE TYPE LEVEL so it cannot be expressed**, never in a comment. It
arrives as convenience the first time a route is awkward to grant, and **a prohibition a type
enforces cannot be argued with at 3am.**

**The reachability assertion goes one arity up — per conjunct, not per route.** A route whose
conjunction no role can satisfy is refused to every caller alive, **and a conjunction makes that
defect easier to create by accident.**

**Which instrument to use:** *would a grantor ever want to grant the capability WITHOUT one of the
conjuncts?* **Yes → its own permission**, and a conjunction would be a name nobody can grant.
**No → the conjunction says the true thing** and a third name is a synonym.

**AND THIS IS WHAT MAKES `security.md` §2a ENFORCEABLE UNDER `0007` D16.** Under a closed role set,
co-holding was a property of tables anyone could read. **Under D16's custom roles it is a property of
nothing — constraint 1 permits any subset, so a tenant admin holding both may mint a role holding
one.** The conjunction moves the test from *"every role holding A happens to hold B"* to **`A ∧ B`
decided on every call, which no custom role can decompose.** Recorded in `security.md` §2a-0.

## 3e. ⚠ CREATING THIS CLASS CREATED A THIRD CHALLENGE ROUTE — BY THE EXISTING RULE, NOT BY AMENDMENT

**Added 2026-09-13. `architecture-agent` reported the tenant-admin challenge route as needing an
amendment to `confirmation-v1` — an accepted contract — and correctly refused to invent a shape for
it. It does not need one, and the reason matters more than the conclusion.**

**`confirmation-v1`'s `theTWOCHALLENGEROUTES.ruling`, verbatim:**

> *"THE MECHANISM IS ONE. THE CHALLENGE ROUTE IS **ONE PER EXISTING CLASS THAT CONTAINS A CRITICAL
> OPERATION**, BECAUSE THE CONTEXT DIFFERS EVEN THOUGH THE LOGIC DOES NOT. **Two today: one Action,
> one platform route.** Both call the same Core confirmation service, which is where every rule in
> this contract is enforced."*

> **THE RULE IS THE FIRST SENTENCE. "TWO TODAY" IS A MEASUREMENT INSIDE IT** — true when written,
> and it reads as the rule because it is the concrete half. **`0044` created a fifth class, and this
> record's own §3b.5 puts `critical` operations in it** (`core.organization.transfer-ownership`,
> `core.organization.request-deletion`). **So the contract's own rule generates a third challenge
> route with no amendment at all.**

**This is the count-in-prose defect one more time, and in the most consequential place yet:** a
number stated beside a rule, accurate on the day, **read by two later parties as the rule itself** —
first as *"there are two"*, then as *"a third needs an amendment."* **The rule never said two.**

### WHAT IS ACTUALLY OUTSTANDING — and it is TWO routes, not one

```
platform class      BUILT
Action class        NOT BUILT   — 0038's F-1, ruled a BUILD ITEM: "one route over a service
                                  that already exists, specified in full by an accepted
                                  contract. It is bounded and it needs no new decision."
tenant-admin class  NOT BUILT   — this record, by the same rule, on the same terms
```

**Neither is a design question and neither needs a decision record.** `0038` settled the framing for
the first and it transfers to the second without modification: **the mechanism is one, the service
exists, and `confirmation-service.ts`'s own header says it was built for more than one caller.**

**`core-agent`'s `assertGatedRoutesCanObtainAConfirmation` is what keeps this honest** — a `critical`
tenant-admin route registered before the challenge route exists **fails the build naming the missing
work**, rather than shipping an operation that authorizes, gates, and can never be satisfied. **That
assertion stays exactly as it is.**

**And `0038`'s own diagnosis of how F-1 survived applies to this one in advance:** a normative clause
of an accepted contract was set aside by *a comment in an implementation file* — *"accurate about its
own reasoning and silent about the contract it contradicted."* **The deferral's stated condition —
*"until a critical Action exists"* — has fired twice over now.**

### 3e-i. NEITHER CHALLENGE ROUTE NEEDS A PERMISSION OF ITS OWN — CHECKED, BECAUSE THE OPPOSITE WOULD HAVE COST A SECOND USER APPROVAL

**Added 2026-09-13. The question was *"does building the tenant-admin challenge route require a
nineteenth permission?"*, and it was worth one file read because a wrong answer means going back to
the user for a supplementary grant while eighteen sit undecided.**

**`confirmation-v1` answers it in the `permission:` field of both published challenge routes,
verbatim:**

```
platform    "THE SAME PERMISSION AS THE OPERATION NAMED IN THE REQUEST, resolved from
             action_id. NOT A PERMISSION OF ITS OWN."
Action      "THE SAME PERMISSION AS THE ACTION NAMED IN THE REQUEST. It IS an Action and is
             invoked through the ordinary pipeline."
```

> **A challenge route evaluates the permission of the operation it is a challenge FOR.** So the
> tenant-admin one resolves to whichever tenant-admin permission the target declares — **all of
> which are already in the eighteen.**

**AND THAT IS A SAFETY PROPERTY RATHER THAN A CONVENIENCE, which is why it is recorded here rather
than noted in a dispatch.** A challenge route with a permission of its own would be **a second door
to every `critical` operation**, gated by something other than what the operation itself requires —
and `security.md` §2's *deny by default* would be satisfied while the gate protected the wrong thing.
**Resolving from the request means the challenge is exactly as hard to obtain as the act it
authorises, and no easier.**

**CONSEQUENCES, both of which unblock work:**

- **The eighteen-permission grant is COMPLETE for this class as it stands.** No supplementary
  request is owed for either outstanding challenge route.
- **The tenant-admin challenge route is a BUILD ITEM AVAILABLE NOW** — `0038`'s framing for F-1
  transfers, and it does not wait on the grant.

**ONE THING THIS RECORD DOES NOT SETTLE, named rather than assumed:** `assertEveryRoutePermissionIsReachable`
compares a route's DECLARED permission against what roles hold. **A route whose permission is
resolved from the request at call time declares none statically**, so how that assertion treats it —
exempt, or keyed on the resolvable set — **is Core's to decide and is not decided here.** Getting it
wrong in the exempting direction would put a hole in the assertion the whole class relies on.

## 4. What this does not decide

- **The route table, the registry file and the dispatcher branch** — Core's, sequenced after this.
- **The role model** — `0043`. **This class is orthogonal: it decides where tenant-admin routes
  live, not who may call them.**
- **`OI-1` is closed by a route in this class being built, NOT by this record.** Until then it stays
  open and must not be reported otherwise.
