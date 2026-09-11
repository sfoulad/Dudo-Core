# packages/contracts/ — Shared Contracts

**Owner: `architecture-agent`** (see `docs/architecture/boundaries.md`)

The single source of truth for how Dudo's modules talk to each other. Every boundary
crossing in the system is defined here.

- **Only `architecture-agent` authors contracts.** `core-agent`, `web-agent`,
  `plugin-agent`, and `app-agent` consume them and must never edit this directory.
  Authorship moved here from `core-agent` by
  `docs/decisions/0004-repository-structure.md`: the agent that implements a contract
  must not also be the one who approves it.
- A contract defines the request shape, the response shape, the error cases, the
  **authorization expectation**, and the **tenant scope**. A type alone is not a contract.
- Contracts are **versioned**. Additive changes may proceed; a breaking change to a
  published contract requires Team Lead review and a decision record.
- **One contract set, two clients.** The responsive web client and the Apple client
  consume the same contracts. A shape one has and the other does not is a defect, not a
  local workaround.
- `qa-agent` tests the producer and **both** consumers against every published contract.
- A missing contract **blocks** the consumer. It is requested from the Team Lead — never
  stubbed, guessed, or worked around.

Contract-first sequencing: `CONTRIBUTING.md`

## Layout

```
common/         platform-wide shapes every contract reuses — the error envelope, pagination
registries/     the five machine-readable registries (permissions, events, Core objects,
                manifest schemas)
validation/     zero-dependency validators (docs/decisions/0009)
core/<domain>/  Core's own published contracts, one directory per Core domain
apps/<app-id>/  one directory per App, holding that App's contract set
```

Each contract set is three artifacts, all normative together: a `README.md` carrying the
reasoning, the state machines and the open questions; a `*.schema.json` carrying the request
and response shapes; and a `*.contract.yaml` carrying the Action definitions, permissions,
tenancy, audit, HTTP binding and free-tier impact. **A type alone is not a contract**, which
is why the shapes file is never the whole set.

`core/identity` uses **two** files rather than three — the reasoning lives in its
`*.contract.yaml` — and says so in its own header, so a reader does not conclude a `README.md`
was lost. It is also the one set that describes **pre-authentication entry points rather than
Actions**: no permission, no scope, no `ActionContext`, no tenant. That is not a gap in the
set; it is what `docs/decisions/0014` §B's admission rule is.

`core/**` and `apps/**` differ in what they may contain, not in form. A Core contract covers
an object in `registries/core-object-registry.yaml` under a `core.*` permission, and is served
from Core's flat reserved API namespace. An App contract covers the App's own entities and is
served under `/api/v1/apps/<app_id>/...` unless the Team Lead allocates it a flat segment. An
App may never publish a contract over Core's data, and Core contracts carry no business-domain
concept — `Core stays small` is a boundary this directory records rather than one it relaxes.

## Contracts on record

| Contract | Version | Status |
|---|---|---|
| `apps/customers` — Customer Directory | 1 | **Accepted 2026-09-08**, on evidence from an already-accepted contract: `template-v1` records `business_id` as *"a published wire field… that two clients have shipped against"* and **declined the `Workspace` rename because of it.** A contract whose field name an accepted contract refuses to break is not a proposal. **It does not accept the two `deferred` Actions as built** — `DeleteCustomer` and `RestoreDeletedCustomer` have no handler, and `DeleteCustomer` is separately unreachable while the Action-class confirmation challenge does not exist. |
| `core/organization` — Business Read | 1 | **Accepted 2026-09-08.** `audit-read-v1` cites it as the canonical form of a Core tenant Action contract and `core-routes.ts` builds `CORE_APP_PERMISSIONS` against it — a contract another contract copies its form from is not a proposal. **Acceptance closed a window this file had named in advance:** its `versioning` section said the 2026-09-04 `POST` change was *"free only because it was made before acceptance"*, so **method, path and identifier carrier are now breaking changes.** Original entry: Resolves `business_id` to a name and lists a principal's authorized Businesses — the gap `app-agent` found while building against the Customer Directory. Closes the *contract* gap only: no Business name is stored anywhere yet and the authorized business set is empty for every principal, both of which belong to the organization-structure slice. See its `README.md` §2 before reporting it as unblocking anything. **Revised 2026-09-04:** the resolve route moved from `GET` with repeated query parameters — a form Core refuses outright, so the Action could not succeed for more than one identifier — to `POST` with a JSON body. Shapes unchanged. |
| `core/identity` — Login | 1 | **Corrected 2026-09-05: it said there was no logout, and there has been one since `0018` landed.** `admin-shell` needed sign-out, found the contract and Core disagreed, built against Core and reported it — the right call, and *a client choosing code over the contract is what contract-first exists to prevent*. The fault was the contract's: **a contract that says a feature does not exist gives a client nothing to build.** Revocation deletes the session row, emits a constant clearing cookie, accepts either carrier, and collapses all six paths to one outcome. One stale QA assertion — *"neither client calls /auth/session/revoke"* — would have failed the moment sign-out was built correctly. **A contract-versus-code check is owed for this whole set**, which is a transcription of an implementation that preceded it and therefore the most exposed to this drift. **Accepted 2026-09-08**, unblocked by `0014` §B, which admits each of its four routes to the `PreAuthEntryPoint` registry *"by a decision, never by declaring itself"* — the substance was decided by an accepted record and this contract describes it. Original entry: **Proposed.** Awaiting Team Lead agreement. **This one documents an implementation that preceded it** — `platform/core/identity/login.ts` was built with no contract, out of order under `.claude/rules/workflow.md` §3, and two client agents had to guess the field names from source. It is a transcription, not a specification: where it and Core disagree, Core is what runs. Two files, not three, and it describes pre-authentication entry points rather than Actions. Carries the **normative** client-side KDF parameters and `normalizeIdentifier` definition that both clients must implement byte-identically — including the **NFC** password rule (amended into `0015` §D on 2026-09-04), which is the one rule in any Dudo contract that **Core cannot enforce**, because Core never receives a password. Its only enforcement is shared client test vectors. Note the deliberate asymmetry: **NFC** for the password, **NFKC** plus ASCII-only case folding for the email. **A 200 from login is not a usable session** — see the row below. |
| `core/platform` — Platform operator | 1 | **Accepted 2026-09-05** by the Team Lead, once `0025` carried every decision it was waiting on (`PO-1` the operator action log, `PO-2` the D11 bootstrap exception — both now `0025` Decisions 5 and 4). **The first accepted contract in this directory.** Defines the **fourth request class**: principal-level authentication, **no tenant**, **and a permission** — the gap between `0021`'s session routes (no permission) and Actions (tenant required). Carries the `platform_operator` authority model, the **mutual-exclusion invariant** with `organization_membership`, the two-home audit model, and the **bootstrap exception to `0007` D11** that onboarding depends on. The other three platform contracts inherit all of it and restate none of it — **read this one first or they cannot be reviewed.** |
| `core/platform` — Template | 1 | **Accepted 2026-09-05.** The user's first requested capability: a business type, which `0025` settles **is** `ARCHITECTURE.md` §1's fifth extension type arriving five phases early. A name and per-level display labels. **Complete and inert on arrival** — nothing consumes a Template until onboarding references one, and it must be reported that way rather than as "business types now work". |
| `core/platform` — Organization onboarding | 1 | **Accepted 2026-09-05.** Takes **no confirmation** — `0026` reclassified `core.organization.create` to `sensitive` precisely so it would be reachable without one, and re-imposing it by hand would collapse the distinction `0026` was protecting. Six objects across two databases in one operation, and the route by which Dudo acquires a customer at all. Corrects `control-plane-admission.ts`'s **"onboarding is 6" to 10**. Deliberately breaks `credential-store.ts`'s strongest property — that no request can create a credential — and says so. **Unreachable until ON-6 is ruled on**, because `core.organization.create` is `critical` and the confirmation mechanism `0007` D15 requires does not exist. |
| `core/platform` — Confirmation | 1 | **Accepted 2026-09-05** (`0027`), with a `locale` amendment that ruled *against* this contract's own `CF-4` recommendation and improved it: localisation requires the client to **choose** a language, not to **render** the text, so Core composes the statement in the requested locale and `CF-2` is left as it was rather than widened. |
| | | The elevation mechanism `0007` D15 requires, written for **three callers at once** — `core.credential.reset`, `customers.customer.delete`, and whatever is declared critical next. Two rulings the Team Lead asked for: confirmation proves **intent AND presence** (a server-authored statement plus a re-authentication), and it is **neither a route class nor a per-Action concern** but a **pipeline concern derived from the catalog's `sensitivity`** — so declaring a permission `critical` requires confirmation automatically, with no code change and no chance of omission. |
| `core/platform` — Credential reset | 1 | **Accepted 2026-09-05.** Stays `critical` and **does** carry the two-step confirmation. `CR-5` was closed **by this contract's request-shape change, not by `0026`** — the KDF salt is the target's normalised identifier, which neither the console nor the server can supply, so a reset would have bricked the account it was meant to rescue. An operator replaces a credential; generated, shown once, never stored recoverably. **Seeing a password is arithmetically impossible, not withheld** — there is no password column and no reversible form of one. Requires session revocation, without which a reset changes the lock on a door an attacker is already through. **Blocked on CR-1**, the same missing confirmation mechanism, and correctly the last of the four to become buildable. |
| `core/identity` — Account identifier | 1 | **Proposed.** The **canonical definition** of a Dudo login identifier, consolidating a rule that was restated in five places with no two agreeing. **Ruling: Dudo does not accept non-ASCII identifiers** — which confirms `0015` §D rather than deciding anything new. Corrects two contracts whose pattern required *exactly one* `@` while Core requires *at least one* (additive). Records the enforcement gap: two Core paths accept what all three contracts forbid, and the only live check is client-side. **Read `whereTheRefusalBelongs.theTRAPINTHEOBVIOUSFIX` before implementing** — the obvious fix breaks Template naming. |
| `core/identity` — Organization selection | 1 | **Two defects corrected 2026-09-05, both found by `web-agent` while implementing.** `the422Rule` asserted something false — `failed_precondition` is argument-free with a constant message, so the Customer Directory's state-machine refusals and "no Organization selected" are **byte-identical on the wire**, and a client following the rule draws an Organization picker at someone who archived an archived customer. The fix is a distinct `organization_not_selected` code, required of Core; `web-agent`'s probe stays until it lands. The file also still described the **server-side auto-selection `0021` struck** — that block is withdrawn and `clientObligations.theFlow` is rewritten and authoritative. **The contract was wrong and the implementation right, both times.** Roughly twenty stale auto-selection mentions in the lower sections are owed a sweep. **Accepted 2026-09-08**, unblocked by `0021`, which created the session request class its two routes belong to and states that *"widening it is a decision, not a refactor"*. Original entry: **Proposed.** Awaiting Team Lead agreement, and it **unblocks the deployed platform**: a seeded principal logs in and every business request returns 422 `failed_precondition`, because `selectOrganization` and the Organization picker exist as `SessionResolver` methods with **no HTTP route**. Selection is mandatory for every principal, not only multi-Organization ones. **Mixed provenance** — the two resolver methods are transcribed, the routes and wire shapes are new, and it requires a **third route class** (authenticated at the session level, no `ActionContext`, no tenant) that does not exist yet. Publishes the one route in Dudo where a caller names a tenant. |

| `core/platform` — Organization detail | 1 | **Accepted 2026-09-05** (`0028`), jointly with Platform audit read. Publishes the Organization read and the **targeted member resolve** that replaces a member list. **There is no `GET /organizations/{id}/members` and one must not be added** — *the transpose of the permitted read is the forbidden one*: an operator can enumerate every Organization, so per-Organization member lists invert into the principal → Organizations mapping `CO1` forbids. **Neither permission discloses it alone; the pair does.** The resolve declares `core.credential.reset`, not `core.organization.list`, so revoking the reset grant revokes the ability to resolve people. **`member_count` is included because a count does not invert.** |
| `core/platform` — Platform audit read | 1 | **Accepted 2026-09-05** (`0028`), jointly with Organization detail — *"they are the same finding twice and separating them would let a future reader adopt one without the other."* **Two feeds, not one with a filter**, differing in what they may disclose: the platform feed omits `target_principal_id`, the Organization feed includes it and **writes a record into that Organization's own trail on every read.** *The back door is closed by making it the same size as the front one.* **There is no `target_principal_id` filter on the platform feed and supplying one is refused, not ignored** — *an ignored parameter is one someone will later honour.* |
| `core/platform` — Platform operators | 1 | **Accepted 2026-09-05.** The operator roster and the **revoke**. The revoke was **held back until the confirmation binding covered its target**: its schema said the binding covered `principal_id`, a PATH parameter, while the binding was computed from the body alone — so **a confirmation minted to revoke operator A would have been spendable on operator B**, on the route that strips platform authority. `assertConfirmationCoverageIsCoherent` refused the build, and `confirmation-v1` was amended so the binding is body-minus-three **union the declared path parameters**. **There is deliberately no route that GRANTS platform authority.** |
| `core/platform` — Organization identity | 1 | **Accepted 2026-09-08.** `0031` decided its substance and the user granted `core.platform-organization.update` on 2026-09-07, relayed by the Team Lead. `sensitive`, **not** `critical`, and the argument is worth keeping: if a VAT number were critical *because the value may later appear on a document*, so would the commercial registration and the display name, and **the rung would stop sorting anything.** What replaces a confirmation acts at the point of harm instead — a **verification record** saying who checked this value against the issuing registry and when. **`OI-1` stays open:** the customer still cannot enter or correct their own name, CR or VAT number. |
| `core/audit` — Tenant audit read | 1 | **Proposed.** The customer's view of their own trail, **including what the platform did to them**. It exists because `0028` rests on a term that was struck: the residual was accepted as *"N requests, audited in both homes, VISIBLE TO EACH VICTIM, rate limited"*, and **two of those four terms are false** — visibility is *"a property of a route that does not exist"*, and *rate limited* was measured false. **This contract makes the third term true and states plainly that it does not restore the fourth.** Every audit record Dudo writes into a customer's Organization today is **written and unreadable by the party it protects.** |

**THE TABLE IS NOW COMPLETE: 15 rows for 15 contracts**, checked against the file count rather
than assumed. It carried **10** until 2026-09-09 — **a table that silently covers two thirds of
the corpus reads exactly like a complete one** (`workflow.md` §11a), and stating the gap without
closing it would have re-created the problem one level up.

## The corpus boundary — what `packages/contracts/**` means

> **`packages/contracts/**` holds PUBLISHED CONTRACTS, their registries, and the zero-dependency
> tools that read them. It holds no deliberately-malformed input, ever.**

**Stated normatively because every checker over this tree inherits the alternative.** A file that
exists to contain a broken shape is **tool input, not a published contract** — and a checker that
globs `*.contract.yaml` cannot tell the difference. One such fixture costs **one exclusion in
every checker that will ever walk this directory**, and each exclusion is a place the boundary
drifts.

**The precedent was already set and is unambiguous.** `0009`'s validator lives at
`validation/app-manifest-relations.mjs` — in this directory — while its **26 fixtures, 12 of them
deliberately invalid**, live at `packages/testing/fixtures/app-manifest/`. **Tool here, fixtures
there**, with an `index.json` enumerating the set so the population has an independently derived
total.

> **THIS PARAGRAPH ENDED "Nothing malformed has ever lived under `packages/contracts/**`" AND THAT
> WAS FALSE AS I WROTE IT.** A deliberately-malformed drift fixture of mine was sitting in
> `generator/fixtures/drift/` at that moment — **I stated the convention as an unbroken history
> while personally breaking it, in the paragraph establishing it.**
>
> **What is true:** the convention held for `0009`'s 26 fixtures and for everything else; **the one
> exception was mine, and it is gone** — relocated to `packages/testing/fixtures/contract-generator/drift/`
> under `0040` and deleted from here on 2026-09-09. The rule above is normative and now also
> describes the tree.
>
> **Recorded rather than quietly corrected**, because the failure is instructive: a sentence
> asserting a clean history is the one nobody checks against the working directory, and **the
> author is the last person who will, because they are describing a rule rather than looking at a
> tree.**

**Fixture location is therefore not a matter of taste, and a tool needing to parse a fixture *as a
contract* does not require the fixture to live here** — it requires the tool to be pointed at it.
`generator/generate-types.mjs` already takes its corpus root as a parameter for exactly this
reason.

## The three operation-block keys, and what each one means

A contract declares what it publishes under **exactly one** of three keys. They are **not
synonyms**, and normalising them to one word would erase a distinction the code enforces
(`ARCHITECTURE.md`'s request-class table; `0014` §B, `0021`, `0025` Decision 3).

| Key | Request class | Authenticates | Tenant | Permission |
|---|---|---|---|---|
| `entryPoints:` | Pre-authentication entry point (`0014` §B) | nothing | none | **none evaluated** |
| `operations:` | Platform route (`0025` D3) **and, today, the session class (`0021`)** | principal | none | platform route: **yes**; session class: **none** |
| `actions:` | Action pipeline — Core Actions and App Actions | principal | **required** | **yes** |

**The generator accepts exactly these three and refuses an unknown fourth, loudly.** An unknown
key is a contract publishing something into a class nobody declared.

> **MEASURED, AND THE MAPPING IS NOT CLEAN — see `operations:` above.** There are **four** request
> classes and **three** keys. `organization-selection-v1` uses `operations:` and its two entries
> are session-class routes, not platform routes. So one key covers two classes that `0021` and
> `0025` deliberately separated, and a reader inferring the class from the key gets the wrong
> answer for that contract. **The key name is an implicit encoding of a property that should be
> explicit**, and the durable repair is a declared `requestClass:` field the generator can check
> against the route tables — not a fourth key name, which would encode the same property the same
> implicit way.

## Where a request shape is DECLARED and where it is MACHINE-READABLE

These are **two different properties on two different axes** and a contract can satisfy one
without the other (`workflow.md` §12: a rule can fail to cover the case, or fail to be executed,
and getting one right is how you miss the other).

- **Declared** — the contract answers "what does this operation take". Required of every
  operation; the generator refuses without it.
- **Machine-readable** — the answer is a `{ schemaRef: … }` a tool can resolve. **Not required**,
  and not one of `0037`'s five refusals.

**`template-v1`'s list and read operations declare `request:` as prose** — *"Query parameters
`page_size` … and `cursor` only."* — where every other operation in the corpus carries a
`schemaRef`. That is admissible and is **recorded rather than corrected**: no type can be emitted
for those two requests, and a reader should know that is a property of the contract rather than a
gap in the generator.

## Authoring order in a closed object — `properties` FIRST, `additionalProperties: false` LAST

Added 2026-09-11, by `architecture-agent`, after producing **two unsatisfiable response shapes in a
single pass** — in the amendment that was itself about constraining a shape.

> **`additionalProperties: false` IS A STATEMENT ABOUT A `properties` BLOCK. Write the block first
> and close it last.**

**The defect, twice, identically:**

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["total"],
  "description": "…",
  "$comment": "… forty lines …"
}
```

**`required` demands `total`; `additionalProperties: false` forbids it. No valid instance exists** —
the route is unreachable and a client built from the schema cannot make a legal call. **Neither line
is wrong on its own.** The union is, which is `architecture.md` §1a's shape arriving inside a single
object.

**Why the object looked finished, and this is the part worth knowing rather than the rule:** both
were authored in the order above, and **the long `$comment` sat where the `properties` block should
have been.** It is the biggest thing in the def. The object reads as complete because something
substantial is in the middle of it — **not carelessness, a shape that looks done.**

**The general form, which is why the rule is mechanical rather than attentional:**

> **`additionalProperties: false` and `required` are BOTH references to a `properties` block.**
> Writing either before that block exists is a **dangling reference in a language with no compiler
> to catch one** — and nothing in this repository executes JSON Schema, so no tool here will say a
> word about it at authoring time.

**It is caught downstream, and knowing where matters — because a schema author has no reason to know
this exists.** `packages/testing/suites/contracts/satisfiability.ts` walks every `*.schema.json` in
full — `$defs`, nested `properties`, `items`, `allOf` branches — and names the offending pointer.

> **⚠ ITS TITLE SAYS *"EVERY CLOSED REQUEST OBJECT"* AND ITS WALK COVERS RESPONSES TOO.** The
> implementation is broader than the sentence describing it. **An author checking whether their case
> is covered by reading that title concludes it is not** — which is exactly what happened here, and
> is why the pointer is recorded from this side. **Do not narrow that walk to match its title.**

**And the check fires only after the file is already wrong.** The ordering is the half an author
controls; the suite is the backstop. **Prefer the half that cannot produce the defect.**

## Form, and what is not yet decided

**AS1 — the executable form and transport of a Dudo contract is still undecided**
(`API_STANDARD.md` §13). Contracts here follow the precedent this directory already set —
**JSON Schema draft 2020-12** for shapes, **YAML** for registries and Action metadata —
rather than selecting a new form. That keeps the contract language-neutral, which matters
because `Dudo-Apple` is Swift. No framework, library, ORM or npm package is selected by any
contract here, and none may be installed to consume one.

**NO JSON SCHEMA IN THIS DIRECTORY IS EXECUTED.** There is no JSON Schema implementation in this
repository, so every schema here is normative and hand-checked, never machine-validated.
**No report may describe these schemas as validated.**

**Cross-file `urn:` `$ref`s NOW RESOLVE FOR GENERATION AND STILL NOT FOR VALIDATION, and the two
halves of that sentence must not be collapsed.** This line read *"require a resolver that does not
exist yet"* until 2026-09-09. `generator/generate-types.mjs`'s `buildSchemaIndex` maps every `$id`
to its module and `renderRef` resolves URN references including deep JSON Pointers — that is how
`platform-audit-read-v1` was fixed. **So the resolver exists, for one purpose.** Nothing resolves
them to *validate* an instance, because nothing executes JSON Schema at all.

> **This is the second artifact today found to be true in the use everybody cites it for and false
> as written** — the first was *"nothing in this directory is executed"*, corrected above.
> **Finding it twice is what makes it a pattern rather than an anecdote**, and the pattern is:
> a sentence about a missing capability outlives the capability arriving, because everyone who
> quotes it is quoting it for the half that is still true.

> **CORRECTED 2026-09-09. This paragraph opened "Nothing in this directory is executed", and that
> sentence has been false since `0009`.** `validation/app-manifest-relations.mjs` is executable and
> **has been executed** — AZ7 records a measured run of 19 cases on a named date and Node version.
> `generator/generate-types.mjs` is a second executable, currently **NOT RUN**.
>
> **The true claim is narrower and is the one that matters: nothing executes the SCHEMAS.** The
> overclaim was quoted approvingly across the corpus — including by `AUTHORIZATION_STANDARD.md`
> when establishing that a constraint was expressed and not enforced — and in that use it was
> *load-bearing and still true of schemas*, which is exactly why nobody noticed the wider sentence
> was wrong. **A sentence that is true in the use everybody cites it for can be false as written**,
> and it is the written form that the next reader generalises from.
>
> The mention of "no `package.json` and no `node_modules`" is also removed: a root `package.json`
> exists and declares dev dependencies. It was true when written and is not a reason the schemas
> are unexecuted, which is what this paragraph is about.
