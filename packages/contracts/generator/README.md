# The contract type generator

`docs/decisions/0037` · Milestone 0 item 5 (`docs/decisions/0035`) · owner `architecture-agent`.

Reads the contract corpus and emits TypeScript request, response and error types, so that
`platform/web/**` and `platform/core/**` **consume** the contracts instead of re-typing them.

---

## STATUS: RUN ONCE, 2026-09-09, BY `qa-agent`. FIVE DEFECTS FOUND AND FIXED SINCE.

**It was written by an agent with no shell and was `NOT RUN` for a day.** That state is recorded
rather than erased, because it was the correct report: no output was hand-written into
`generated/` and called generated, which would have manufactured exactly the authority `0037`
warns about — *a generator that emits plausible-but-wrong types is worse than hand-written ones.*

**The first run's results, and they are the reason this section is not a summary of intentions:**

| Command | Exit | |
|---|---|---|
| `--self-test` | **0** | the drift check went red on the deliberately stale fixture |
| `--check` | **1** | 15 contracts · 7 admitted, 8 refused · 25 refusals · 7 modules drifted |
| emit | **1** | 7 modules emitted, same refusals |

`qa-agent` re-ran `--self-test` **after** the emit and confirmed the fixture was still stale —
*"a self-test that quietly freshened its own known-failing input would be the worst possible
outcome here."* Nobody asked for that check on the check.

### The prediction, both directions

**Predicted and did not happen: none.** All five predicted refusals landed with the codes named.

**Happened and was not predicted: three contracts** — and those were the valuable half, because
they were a **different kind of finding**: `customer-directory-v1` and `organization-detail-v1`
(constraint-only subschemas) and `platform-audit-read-v1` (a JSON Pointer deeper than
`#/$defs/<name>`). **Every one was the tool failing to understand valid JSON Schema the contracts
legitimately use, not a contract omitting anything.** All three refused loudly rather than
misgenerating, which is the designed behaviour — and **a prediction cannot cover its own author's
blind spots, which is why the run was worth demanding.**

## THE TWO REFUSAL FAMILIES, AND THE DISTINCTION IS LOAD-BEARING

> **`GEN_MISSING_*` means THE CONTRACT is deficient. Every other `GEN_*` code means THE GENERATOR
> is deficient.**

**Read the prefix before reading the message.** `MISSING_REQUEST_SHAPE`,
`MISSING_RESPONSE_SHAPE`, `MISSING_ERROR_CASES`, `MISSING_AUTHORIZATION` and
`MISSING_TENANT_SCOPE` send a reader to **edit a contract**. `UNSUPPORTED_SCHEMA_NODE`,
`UNRESOLVABLE_REF`, `SCHEMA_UNREADABLE`, `YAML_UNREADABLE` and the outline's own codes send them
to **fix this tool**.

**On the first run those two families arrived interleaved in one list of 25**, and without the
prefix split all eight refused contracts would have read as eight contract problems. **Three of
them were ours.** Keep the split when adding a code: a refusal that sends someone to the wrong
file costs more than the defect it reports.

### The five defects the run found, all now fixed

| # | Defect | Family |
|---|---|---|
| 1 | Emitted `import … from '../../common/pagination.ts'` for a module it had decided not to generate. **`tsc --noEmit --strict` exit 2, TS2307 on two modules** | tool |
| 2 | `yaml-outline.mjs` used the **dash's column** as the block-scalar skip window; an item's sibling keys sit two columns right, so they vanished | tool |
| 3–5 | Quoted keys and column-0 keys containing a space were **silently invisible**, while the header claimed *"FAILS CLOSED, EVERYWHERE"* | tool, and a `§3c` claim in our own file |

**Defects 2–5 were latent — zero corpus instances.** They were found by `qa-agent` constructing
inputs the corpus does not contain, which is the only way that class of defect is ever found.

---

## Generic emitted types exist for EXACTLY ONE REASON

**Approved as a Team Lead decision on 2026-09-09, not adopted as an implementation detail.**

The generator emits `Name<T>` when — and only when — a `$def` contains **an array with no
`items`**. There is one in the corpus: `common/pagination.schema.json`'s
`collectionEnvelope.properties.data`, whose own description is the whole argument —

> *"The page. Redefined by each concrete response with its item schema."*

**That sentence describes a type parameter.** Refusing it would have been a refusal firing on
correct input, which is a broken tool rather than a strict one; `unknown[]` was never a candidate,
because it is the confidently-wrong output this generator refuses everywhere else. **The choice
was never generic-versus-safe — it was generic-versus-refusing-three-admitted-contracts.**

> **INVENTING A SECOND USE IS A DECISION, NOT A PATTERN TO COPY.** The generator now has a
> type-parameter concept, and the next person who meets an abstract shape will reach for it.
> Genericity here means *a def whose schema says a consumer redefines it* and nothing else. If a
> second case appears, it needs a ruling — the reasoning above is about **one sentence in one
> schema**, and it does not generalise on its own.

**The risk it creates, and the guard.** A JSON Schema `$ref` carries no type argument, so a bare
reference to a generic def would emit `CollectionEnvelope` un-parameterised — **the dangling-import
failure one level down.** A pre-pass computes which defs are generic *before* rendering, and a
`$ref` to one is **refused**, pointing the author at redefining the concrete shape at the
reference site, which is what every response in this corpus already does. **Nothing references it
today; the refusal is what keeps that true rather than hoping.**

> **⚠ AND NOTHING INSTANTIATES IT EITHER — `CollectionEnvelope<T>` HAS NO CONSUMERS.** The
> unused-import repair removed its only importers, because every concrete response redefines the
> envelope rather than referencing it. **A generic nobody instantiates is a generic whose next
> change nothing will catch:** it type-checks in isolation, it appears in the emitted surface, and
> no consumer would go red if it were emitted wrongly. It is exercised **solely by a constructed
> case**, and that is the only thing standing behind it. **If a future reader finds it unused and
> proposes deleting it, the question to answer first is whether the schema still says a consumer
> redefines the page** — the type exists because the contract says so, not because anyone imports
> it.

## Commands

```
node packages/contracts/generator/generate-types.mjs              # emit, writing files
node packages/contracts/generator/generate-types.mjs --check      # drift check, writes nothing
node packages/contracts/generator/generate-types.mjs --self-test  # the known-failing input
```

**Exit codes:** `0` clean · `1` refusals or drift · `2` fatal (an empty corpus, or an
admitted+refused total that does not equal the number of contract files found).

**Run `--self-test` first.** It is the only one whose result tells you whether the other two mean
anything.

---

## The two guards, and why each is here

**The floor.** A run that finds zero contracts or zero schemas is `fatal`, never a clean pass.
`workflow.md` §11a: *a checker that cannot fail loudly on being handed nothing will eventually be
handed nothing* — by a renamed directory, a changed suffix, or a glob that stops matching.

**The known-failing input.** `--self-test` runs the drift check over
**`packages/testing/fixtures/contract-generator/drift/`**, whose committed output is **deliberately
stale**, and **fails if the check passes.** Three differences are planted — a renamed field, a
widened type, and a dropped operation — each a real drift mode.

> **`drift/generated/drift-fixture-v1.ts` must stay stale.** Regenerating it makes the self-test
> green forever and destroys the only evidence the drift check can go red. The file says so in its
> own header, and `qa-agent` read that header before copying it rather than after.

**THE FIXTURE LIVES IN `packages/testing/**` AND NOT BESIDE THIS TOOL** (`0040`).
`packages/contracts/**` holds published contracts, their registries, and the tools that read them —
**and no deliberately-malformed input.** A fixture containing a broken shape is tool input, not a
published contract, and a checker globbing `*.contract.yaml` cannot tell the difference.

**The `drift/` level is load-bearing.** `qa-agent`'s cascade tree occupies
`contract-generator/` alongside it, and **each tool walks its root recursively** — sharing one root
would make every run discover the other's contracts. `walk()` skips `generated` and `fixtures` by
name and would **not** skip either tree; **the directory boundary is the control.**

**The population report.** Every run prints contract files found, schema files found, contracts
admitted, contracts refused, and modules emitted or compared — with the identity
`admitted + refused = contract files found` checked and marked. *"0 differences"* and *"the walk
stopped finding things"* render identically without it.

---

## Two findings the generator surfaced before it ever ran

Both come from reading the corpus to write the scanner, and both are reported rather than
normalised away — a generator that quietly accepted three spellings would have hidden them.

**1. Three key names for one concept.** Tenant Action contracts say `actions:`, platform contracts
say `operations:`, and `login-v1` says `entryPoints:`. Nothing had ever compared them, because
nothing parsed this YAML. The generator accepts all three and reports the divergence; **choosing
one is a Team Lead ruling, not a generator's.**

**2. `request:` is sometimes prose, not a shape.** `template-v1`'s list and read operations carry
`request: "Query parameters \`page_size\` … and \`cursor\` only."` — a sentence where other
operations carry `{ schemaRef: … }`. The admission check accepts either, because *a request shape
is declared* and *a request shape is machine-readable* are different requirements and only the
first is one of `0037`'s five.

---

## Scope

**TypeScript only.** A **Swift emitter is owed** and `0037` names it as owed rather than leaving
it implicit: `Dudo-Apple` hand-writes its types today, so **the drift `0034` documents remains live
on the Apple side** until the emitter exists. Owner `architecture-agent`; trigger, the first
`Dudo-Apple` work after Milestone 0.

**It does not execute JSON Schema.** `required`, `enum`, `pattern` and `additionalProperties` still
instruct a human reader on the server side. These are compile-time types: a generated type says
what the contract **promises**, and does not check what **arrived**.

---

## `yaml-outline.mjs` is a scanner, not a parser

It answers a closed set of questions about a corpus whose shape we control, and **refuses**
anchors, aliases, merge keys and multi-line flow mappings rather than misreading them. The
load-bearing part is block-scalar skipping: these contracts are mostly `>-` prose containing
sentences like `permission: core.x`, and a scanner that read those as structure would produce an
outline that disagrees with the contract — **confidently.** The drift fixture's contract plants
exactly that trap inside a block scalar so the failure has somewhere to show up.

**Do not grow it into a YAML parser.** `0009` approved one narrow zero-dependency reader and said
the precedent *"cannot grow into a toolchain without a new decision."*
