# 0039 — A contract declares its request class; nobody infers it from a key name

- **Status:** **ACCEPTED, 2026-09-09.** Team Lead decision, **overturning a Team Lead
  ruling of the previous day** on evidence the ruling itself asked for.
- **Owning agent:** `architecture-agent` authors the **field**; the **Team Lead** authors the
  **check** (`scripts/check-request-class.mjs`, landed 2026-09-09). `core-agent` and `web-agent`
  consume. **This line originally said `architecture-agent` authors both, and that was the error
  the ADR was corrected for** — a tool in `packages/contracts/**` that parsed `platform/core/**`
  would make the contract set depend on Core's file layout, so Core could not refactor its own
  route tables without breaking a contracts-side tool. **A cross-boundary comparison belongs at
  the boundary, not inside one of the sides.**
- **Governs:** the shape of every contract in `packages/contracts/**`, and what the
  `0037` generator verifies.
- **Depends on:** `0014` §B (pre-auth entry points), `0021` (the session class), `0025` D3
  (the platform class), `0037` (the generator that can now execute the check).

---

## The ruling this replaces, and how it was falsified

`architecture-agent`'s generator surfaced that contracts spell their operation list three
different ways — **`actions:`**, **`operations:`**, **`entryPoints:`** — and reported it
rather than normalising it, on the grounds that *"nothing had ever compared them because
nothing parsed this YAML."*

**The Team Lead ruled on 2026-09-08 that these were three genuinely different route
classes rather than drift**, and that normalising them would erase a distinction the code
enforces. **That ruling was reasoning, not measurement, and it was issued with an explicit
instruction to falsify it:** *"if any contract uses a key that does not match its route's
class, that is drift wearing the distinction's clothes and I have ruled wrongly — say so."*

**It was wrong, and the measurement says exactly how:**

| Key | Contracts | Class | Mapping |
|---|---|---|---|
| `entryPoints:` | `login-v1` | pre-auth (`0014` §B) | **clean, 1:1** |
| `actions:` | `business-read-v1`, `customer-directory-v1`, `audit-read-v1` | Action pipeline | **clean, 3:3** |
| `operations:` | ten contracts | **platform class AND session class** | **NOT clean** |

**`organization-selection-v1` is the exception.** It uses `operations:` for
`identity.organizations.list` and `identity.organization.select`, which are **session-class**
routes registered in `session-routes.ts`, not platform routes. **`0021` and `0025` are
separate decision records precisely because those two classes differ** — the session class
evaluates **no permission and resolves no tenant**; the platform class evaluates a
permission with no tenant.

> **So the half of the ruling that survives is that the keys encode a real distinction. The
> half that fails is that they map onto it.** A reader inferring the class from the key gets
> the wrong answer for that contract, today.

**Four classes. Three keys. Nothing anywhere said so.**

## ⚠ CORRECTED 2026-09-09 — THE MECHANISM THIS RECORD DESCRIBES DOES NOT EXIST

**This ADR says, below and twice more, that the generator checks the declaration AGAINST THE ROUTE
TABLES. It does not. The generator imports no route table at all.**

**What it actually checks is the declaration against the BLOCK KEY** — and `REQUEST_CLASSES` maps
**both** `session` and `platform` to `operations:`, so for those two classes **it cannot distinguish
them at all.**

**`qa-agent` proved it by construction rather than by reading — one contract body, three
declarations:**

```
requestClass: session   ->  ACCEPTED
requestClass: platform  ->  ACCEPTED     ← the same file, the other class
requestClass: action    ->  REFUSED      GEN_REQUEST_CLASS_CONTRADICTS_BLOCK
```

> **So the check validates the declaration using THE VERY SIGNAL THIS RECORD ESTABLISHED IS
> UNRELIABLE.** The whole argument above is that a block key cannot carry the class — and the
> enforcement was built on the block key.

**`organization-selection-v1` is the exact case this ADR was written for** — session-class routes
under an `operations:` key — **and flipping its declaration to `platform` passes today.**

**This record claims:** *"a contract whose declaration disagrees with its route goes red — which is
the state the current arrangement cannot reach at all."* **It still cannot reach it.**

**The field is STATED and EXPRESSED. It is not EXECUTED** — `workflow.md` §12's three-state
distinction, occurring in the record that cites it. **And the known-failing input this ADR requires —
*"a fixture contract declaring the wrong class for a real route, which MUST go red"* — is exactly
the construction above, and it goes GREEN.**

**What is owed, and it is not a documentation fix:** either the generator **reads the five route
tables and compares the declared class against where the operation is actually registered**, or this
record stops claiming it does and the check is described as what it is — **a block-key consistency
test, which catches `action` declared on an `operations:` contract and nothing else.** **The first is
the decision; the second is the honest fallback.** `architecture-agent` owns it.

### RESOLVED 2026-09-09 — the second option, and the check has a HOME rather than being abandoned

**`architecture-agent` chose the honest fallback and refused the passive form of it.** Its reason for
the generator not doing it is architectural rather than practical, and it is right:

> **A tool inside `packages/contracts/**` that parses `platform/core/**` source makes THE CONTRACT
> SET DEPEND ON CORE'S FILE LAYOUT** — on `id: '…'` appearing as a string literal in a particular
> shape. **Core could no longer refactor its own route tables without breaking a contracts-side
> tool.** `architecture.md` §3: dependencies point inward toward contracts.

**And the correct home already exists with a precedent in it.** `scripts/check-route-fields.mjs`
performs exactly this class of comparison — route tables against contract properties, in both
directions — **from the repository root, in the Team Lead's tree, outside both sides.** *A
cross-boundary comparison belongs at the boundary, not inside one of the sides.*

**So: the enforcement claim comes out of the generator, and THE ROUTE-TABLE CHECK IS OWED TO
`scripts/`, alongside the checker that already reads both sides. Team Lead's, not
`architecture-agent`'s.**

**Two scoping facts, measured, for whoever builds it — because "read five files" is wrong:**

- `check-route-fields.mjs` **already parses the platform route table.**
- **Only THREE of the five tables carry `id:` literals** — pre-auth (5), session (2), platform (15).
  **The two Action tables do not:** `core-routes.ts` and `apps/customers/api/routes.ts` register
  handlers, and **the ids live in the action factories** (`business-read.ts` carries
  `id: 'core.ListAuthorizedBusinesses'`).

**What the generator does instead, and it is not silence.** An ambiguous declaration is **accepted
and announced every run**, naming which classes share the block key and pointing at the checker that
reads both sides:

> *"`requestClass: session` is NOT VERIFIED by this generator. Its block key `operations:` is shared
> with `platform`, so declaring either passes. Only a comparison against the route tables can decide
> it, and this tool reads none."*

**That is `AUTHORIZATION_STANDARD` §4.1's lesson applied to the generator: the check does not get
broader — it stops overstating.** And what it *does* catch is stated narrowly: a class whose block
key is wrong outright.

> ### ✅ RESOLVED 2026-09-09 — THE ROUTE-TABLE CHECK EXISTS. `scripts/check-request-class.mjs`
>
> **Built by the Team Lead, and in the gate: `npm test` runs it third, after the two structural
> checks and before the suites.** It exits **0** today: **10 declared route ids, every one agreeing
> with the registry Core actually puts it in.**
>
> **It does not parse the route tables — it IMPORTS them.** `preAuthEntryPoints()`,
> `sessionRoutes()`, `platformRoutes()`, `createCoreRouter().routes` and
> `createCustomerRoutes()`. A regex over route tables is a second implementation of Core's
> registration that disagrees with the first one silently, and **the Action routes are the proof:
> their ids are literals inside factory functions**, so a check looking for exported arrays finds
> three tables of five and reports a clean sweep of a corpus it never enumerated.
>
> **THE PARAGRAPH BELOW WAS RIGHT ABOUT THE TABLES AND WRONG ABOUT THE COUNT, AND THIS FILE MADE
> THE SAME MISTAKE THE CHECK NEARLY DID.** It says *"only THREE of the five tables carry `id:`
> literals"* — but `business-read.ts` and the eight customer actions **do** carry them, inside the
> factories. What is true is narrower: **three tables carry them in a top-level array.** The first
> version of the check enumerated four registries and swept only `platform/core/**`, **so both of
> its derivations agreed while missing the customers App's ten ids** — 24 reported against a real
> 34, green throughout.
>
> > **TWO DERIVATIONS THAT SHARE A SCOPE ARE ONE DERIVATION.** They disagree about method and agree
> > about blindness, and the blindness is the entire thing a population check exists to catch.
>
> **AND THE SENTENCE CARRIED A SECOND ERROR THAT COMPOUNDED WITH THE FIRST, added after it claimed a
> third consumer.** `qa-agent`'s pattern found **32 of 34** on the checker's own corpus, missing
> `customers.DeleteCustomer` and `customers.RestoreDeletedCustomer` — **registered as `actionId:`,
> and one as a frozen map key.** So the ids are not merely inside factories: **they are under two
> different keys.**
>
> **A SCOPE ERROR AND A VOCABULARY ERROR, AND ONLY THE SECOND IS VISIBLE IN A PATTERN.** Widening
> where you look does not help if you are matching the wrong key, and fixing the key does not help
> if you are looking in one tree. **Three consumers took this sentence — the Team Lead's first
> version of the check, `qa-agent`'s regex, and the ADR's own scoping paragraph — and each was
> defeated by a different half of it.** `architecture-agent`, who supplied it, diagnosed why:
> *"a claim about WHERE the ids are, offered while you were asking HOW to read them."*
>
> **What it still cannot check, stated rather than left to be discovered:** a declared class on a
> route Core does not register. `core.confirmations.request` is declared `platform` and is not
> built, so **nothing can falsify it until the route lands** — which is precisely when a wrong class
> starts refusing real callers. The check reports those separately as *unchecked, not agreed.*
>
> **And it found one thing on its first real run.** `confirmation-v1` carries a contract-level
> `requestClass: platform` over **two** operations, one of which its own comment says is
> Action-class *"when it lands"*. **The comment instructs nobody; the field instructs the
> generator.** `0039` already allows the field per operation and the check reads it, so moving it
> costs nothing — owed to `architecture-agent`.
>
> **The phase-3 trigger's two conditions are now mechanical and both are met on this half:** the
> check exists, and the root `test` script references it. **The remaining condition is the sweep**
> — 24 registered-and-published route ids still carry no declaration, and the check prints them by
> name every run rather than as a count.

> ### ⚠ THE ORIGINAL CONSTRAINT, KEPT BECAUSE THE REASONING IS WHAT MADE THE CHECK GET BUILT
>
> **PHASE 3 MUST NOT TURN ON BEFORE THE ROUTE-TABLE CHECK EXISTS**
>
> Phase 3 makes `requestClass` **required**. **Requiring a field that nothing validates would make
> every contract carry a declaration the toolchain cannot check** — *stated and expressed and not
> executed*, at fifteen files instead of one, **and with the appearance of enforcement.** The
> phase-3 trigger is therefore gated on the `scripts/` check landing, not only on every contract
> declaring.
>
> **AND THE WARNING IS NOT A SUBSTITUTE THAT WILL SURVIVE.** `architecture-agent` named the
> dependency: **the ambiguity notice fires only because `session` and `platform` share
> `operations:`.** If a future class split removes that overlap, **the warning goes silent and
> nothing marks that the route-table check is still missing.** It is recorded here rather than only
> in a code comment for exactly that reason.

**Recorded here rather than quietly amended below, because agents have been building against this
paragraph all day.**

## The decision

**Every contract declares its request class explicitly, and the generator checks the
declaration against the route tables.**

A `requestClass:` field — per contract, or per operation where a contract spans classes —
naming one of the four: `pre-auth`, `session`, `platform`, `action`.

**A fourth key name was considered and refused**, on `architecture-agent`'s argument and it
is the right one: **a fourth key encodes the same property the same implicit way, and is
stale the next time a class is added.** The problem is not that there are too few key
names. The problem is that **a structural key is being used to carry a semantic property**,
and no number of key names fixes that.

**The generator continues to accept exactly the three existing keys and to refuse an unknown
fourth, loudly.** The keys stay; they stop being load-bearing for class.

## AMENDED 2026-09-09, WITHIN HOURS — it is not three key names, it is THREE VOCABULARIES

**The ruling above was right and under-scoped, and the evidence arrived from a direction that
initially looked like it might refute it.**

`login-v1` produced seven refusals nobody predicted — `MISSING_REQUEST_SHAPE` ×3 and
`MISSING_RESPONSE_SHAPE` ×4. The Team Lead suspected **a generator defect wearing a
contract's clothes**: if the reader looked for request and response keys under a shape it
only expected beneath `actions:`/`operations:`, those seven were the tool and this ADR's
premise needed re-examining.

**Both causes were the tool, and neither was the block key.** `blockKey` resolution found
`entryPoints:` every time. The causes were:

- **`successBody:` is a fourth spelling the generator did not accept.** All four entry
  points declare it instead of `output:` or `response:`.
- **A presence check written as a value check.** `identity.login.start`'s `request:` opens a
  **nested mapping** rather than carrying an inline flow map, and `get(k) != null` reads a
  key with a nested block as absent.

**And `successBody:` turns out to be evidence FOR this decision rather than against it.** It
is **not a synonym for `output:`**: a pre-auth entry point returns a body **and may set a
credential** — `login.complete` carries `setsCredential:` alongside it. **An Action has an
output; an entry point has a success body and possibly a credential.** Collapsing them would
be the same flattening this ADR refused when it declined a fourth block-key name.

> **So the class distinction reaches further into the contract shape than the block key
> does. It is not three key names. It is three vocabularies**, and the block key is merely
> the first word of each.

**This is why a declared class beats an accepted union, and the mechanism now shows it.**
`architecture-agent` had by then accepted a growing union **twice** — three block keys, then
two request and three response spellings. **Every addition is a place the generator guesses
at a class instead of being told.** With `requestClass:` declared, the generator **looks up**
the vocabulary for that class and **refuses a key that does not belong to it**, rather than
accepting any key any class happens to use.

**Implemented as `SHAPE_KEYS_BY_CLASS`, with a module-load coherence assertion** that it and
`OPERATION_BLOCK_KEYS` name the same three classes. **A class present in one and missing from
the other throws at load rather than surfacing later as a false refusal on a correct
contract** — which is the failure mode that produced this amendment in the first place.

## Why this is `§3a`'s shape rather than a naming preference

`architecture.md` §3a: *a guard that must be remembered is a discipline; a guard whose
output the write requires is a mechanism.*

**Today the request class is a property a human infers from a key name, and it was wrong in
one contract out of fifteen with nobody able to tell.** `architecture-agent` established the
mapping by reading every contract against five route tables **by hand, once**. That
measurement is correct today and rots the moment a contract is added.

**A declared field the generator checks against the route tables converts a one-time manual
audit into something a machine performs on every run.** The property becomes explicit, the
check becomes repeatable, and **a contract whose declaration disagrees with its route goes
red** — which is the state the current arrangement cannot reach at all.

## The check owes what every check here owes

Per `workflow.md` §11a, and stated so it is not negotiated later:

- **Report the population** — how many contracts, how many operations, how many declarations
  compared against how many route-table entries — **against an independently derived total.**
  *"No mismatches"* and *"the walk found nothing"* render identically.
- **Ship with a known-failing input:** a fixture contract declaring the wrong class for a
  real route, which **must** go red. `organization-selection-v1` is the historical instance
  and it is being corrected, so the fixture is constructed rather than recovered — say so in
  the file, as `yaml-structure.ts` now does.
- **It joins the gate the day it exits 0 and not before.**

## A second divergence found by the same measurement, NOT decided here

**`organization-selection-v1`'s operation ids do not match its route ids.** The contract says
`identity.organizations.list` and `identity.organization.select`; the route table says
`identity.session.organizations.list` and `identity.session.organization.select`. **They
differ by the `.session` segment.**

**Smaller blast radius than `0034` — an operation id is not a wire field — but not zero, and
the reason is the same one that decided `0025`'s rename:** ids reach **audit records** and
**MCP tool names**, and `audit-read-v1`'s schema describes `action_id` as *"WHICH platform
operation this was"*, with the expectation that a customer can tell operations apart.

**The question that decides which side moves is whether any persisted audit record already
carries the route-table form.** If it does, the route ids win and the contract is corrected —
a persisted value is not renamed to match a document. That is `0025`'s amendment reasoning,
and it is why this is a separate investigation rather than a line in this record.

### RESOLVED 2026-09-09 — drop `.session`. And the Team Lead's reason was wrong

**Nothing is persisted in either form**, so `0025`'s precedence rule never fires. The evidence is
structural rather than a negative search: `SessionRouteDependencies` has **two fields — `handlers`
and `readSessionId` — and no audit sink, no store, no admission port.** A session-route handler has
nothing it *could* write a record with. Three tables carry an `action_id` column; **none is
reachable from the session class.**

So the divergence settles on naming grounds. **The Team Lead ruled to drop `.session`, reasoning
that an id containing it ENCODES ITS REQUEST CLASS — the same implicit encoding this ADR refused —
and invited falsification. `architecture-agent` falsified the reason and kept the conclusion.**

**`.session` appears in FOUR ids across TWO classes:**

| Id | Class | What `.session` means there |
|---|---|---|
| `identity.session.refresh` | **pre-auth** (`0014` §B) | **the session RESOURCE** — the thing refreshed |
| `identity.session.revoke` | **pre-auth** (`0014` §B) | **the session RESOURCE** — the thing revoked |
| `identity.session.organizations.list` | session class | the class |
| `identity.session.organization.select` | session class | the class |

**In half its occurrences it is not a class token at all.** A route changing class would never have
made the pre-auth two stale, because they say nothing about class.

> **THE SAME SEGMENT CARRIES TWO MEANINGS IN ONE NAMESPACE, WITH NOTHING TO DISTINGUISH THEM. That
> is `architecture.md` §1a's shape — *one name, two meanings* — arriving in an IDENTIFIER instead of
> in a request field.** §1a was written about a field name a cross-cutting mechanism injects. The
> hazard is the same wherever a namespace is shared and no document owns it.

**Which makes the conclusion stronger than the ruling that produced it.** Dropping `.session` from
the two session-class ids does not remove a class token — **it removes the ambiguity**, leaving every
surviving `.session` meaning exactly one thing:

```
identity.login.start        identity.login.complete       pre-auth
identity.session.refresh    identity.session.revoke       pre-auth — .session is the RESOURCE
identity.organizations.list identity.organization.select  session class
```

**Collision check: none.** No other id in code or contract is `identity.organizations.list` or
`identity.organization.select`. **And `identity.` is load-bearing rather than inertia** —
`platform.organizations.list` and `identity.organizations.list` differ only by that segment and are
genuinely different operations (all Organizations versus the caller's own). **The namespace does
real work at exactly the point the class token did not.**

**THE RULE THAT LANDS WITH THE CHANGE, because the analogy trap is live:** whoever adds the next
session-class route will look at `identity.session.refresh` and copy its shape. **State normatively
that `.session` NAMES THE SESSION RESOURCE AND NEVER THE REQUEST CLASS** — otherwise this returns,
and it returns **looking like consistency**.

**Sequencing:** the contract half is `architecture-agent`'s and the route-table half is
`core-agent`'s, and they land **in one change** for the reason `0034` phase 3 does.

**Reported alongside, not acted on: the corpus runs two id conventions** — dotted lowercase
(`identity.login.start`, `platform.templates.create`) and PascalCase verbs
(`core.ListAuthorizedBusinesses`, `customers.CreateCustomer`), splitting on Action-pipeline versus
everything else. **Possibly deliberate, nowhere written down** — which is how the next author
discovers it by picking wrong.

## Consequences

- **`0037`'s generator gains a check it could not have had**, because nothing parsed this
  YAML before it existed. The generator is now the reason a class of drift is detectable
  at all.
- **Every contract gains a field.** Additive; no published wire shape changes; no client
  breaks.
- **The Team Lead's habit of naming the falsifier is what produced this.** The ruling was
  issued with the instruction to contradict it, and it was contradicted within the hour by
  an agent that measured rather than deferred. **Recorded because the same Team Lead
  overruled a correct finding from the same agent twice in three days** — once with a
  route table's line numbers, once with a code comment that silently overrode an accepted
  contract. **Asking for the falsifier is cheaper than being right.**
