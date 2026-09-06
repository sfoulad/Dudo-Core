# AI Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No AI provider, model, gateway, or SDK is approved, and no AI code exists** — see §10. Reconciled against the built system 2026-09-06: **nothing here has been contradicted, and nothing here has been started.**
- **Authored by:** `architecture-agent`.
- **Applies to:** every AI-assisted feature, every AI Skill, every AI principal.
- **Depends on:** `CONSTITUTION.md` Rules 7, 8; `CAPABILITY_STANDARD.md`; `AUTHORIZATION_STANDARD.md`; `MCP_STANDARD.md`; `SECURITY_STANDARD.md`.

Dudo is AI-native: AI participates in the work rather than sitting in a sidebar. That
raises the stakes on every rule below, because an AI feature that is wrong is wrong at
scale, quickly, on real business data.

---

## 1. AI is a Capability

```
Application ──> AI Capability ──> Router ──> provider(s)
```

**No App ever depends on a specific model or provider.** Not in code, not in a prompt
template, not in an environment variable it reads, not in a conditional on model name.
An App calls `AI.extract(...)`; which model answers is a tenant configuration decision.

**Why absolute:** models change every few months, differ in availability by region, differ
enormously in cost, and are subject to terms a customer may not accept. An App coupled to
one is an App that must be rewritten on someone else's schedule.

`CAPABILITY_STANDARD.md` governs the interface; the AI Capability is a capability like any
other, with a closed error set, declared semantics, and a conformance suite.

---

## 2. The AI capability surface

The AI function set, as capability actions:

`generate` · `summarize` · `extract` · `translate` · `ocr` · `classify` · `forecast` ·
`recommend` · `search` · `vision` · `speech` · `agent`

Each declares input schema, output schema, error set, and — critically — **what "good"
means**, because unlike a payment there is no unambiguous success signal. An action whose
quality bar is undefined cannot be evaluated, cannot be regression-tested, and cannot have
its provider swapped safely.

**AI Skills** (invoice extraction, Arabic translation, classification) are providers of
these actions, packaged and deployed as Connectors (`ARCHITECTURE.md` §1).

---

## 3. AI never touches data directly

`CONSTITUTION.md` Rule 7, restated with its checks:

| Prohibited | Check |
|---|---|
| Querying an application or Core database | No AI code path holds a storage handle. Reviewed on every AI change. |
| Generating and executing SQL | There is no path from model output to a query engine. |
| Bypassing authorization | Every AI-initiated operation is an Action invocation, authorized like any other. |
| Modifying Core tables | Same. |
| Calling privileged internal services without permission | AI principals hold explicit grants, never implicit ones. |

**An AI with a database handle holds every permission at once**, and no amount of prompt
engineering constrains it. This is why the boundary is architectural rather than
instructional.

**Human and AI use the same Actions** (Rule 8). One implementation, one validation path,
one authorization decision, one audit record. If AI needs an operation that does not
exist, the operation is built as an Action and becomes available to humans too.

---

## 4. Grounding

AI is useful in Dudo because it is grounded in the tenant's real data. That makes
retrieval a data-access path with all the usual obligations:

- **Retrieval is tenant-scoped and permission-scoped.** The context assembled for a prompt
  contains only what the *acting principal* is permitted to read. Grounding on data the
  user could not open is a disclosure that happens to be phrased in prose.
- Retrieval goes through the same authorized read paths as everything else — no privileged
  retrieval identity, no "AI service account" that can read everything.
- Every retrieval that contributes to an output is attributable: which records, which
  tenant, which principal. Without it, a wrong answer cannot be investigated.
- **Cross-tenant grounding is a critical defect**, including in embeddings, indexes, and
  caches. A shared vector index is a shared data store.

---

## 5. Untrusted content and prompt injection

**All of the following are untrusted input, always:** tenant documents, emails, OCR
output, connector responses, external MCP tool results, web content, user free text, and
any model output.

Rules:

1. **Model output is a proposal, never an authorization.** A model saying an action is
   approved does not approve it. Every action goes through Core.
2. **Content is data, never instruction.** Retrieved content is delimited and labelled as
   data. Instructions inside a document are content to be summarized, not commands to be
   followed.
3. **Model output is validated against a schema** before use, exactly like an API request.
   Free-form output is never parsed leniently into a state change.
4. **Model output never selects a tenant, a principal, a permission, or a scope.**
5. **Sensitive and critical actions require human confirmation**
   (`MCP_STANDARD.md` §5) — collected by the platform from the human.
6. Injected instructions that cause denied actions are a security signal and are audited
   (`MCP_STANDARD.md` §7).

Prompt injection is not a solved problem, and the architecture is written on the
assumption that it will succeed sometimes. That is exactly why the authorization boundary
sits below AI rather than inside it: a successful injection reaches only what the acting
principal could have reached anyway.

---

## 6. Tenant data and providers

- **Tenant data leaving Dudo to a third-party model provider is a data-processing
  decision, not an engineering one.** It requires a recorded decision, and per-tenant
  configuration where the tenant's obligations require it.
- **No tenant data is used for model training, fine-tuning, or provider-side retention
  without explicit, recorded consent.** Silence is not consent, and a terms-of-service
  default is not consent.
- Minimise what is sent: the records needed, redacted where possible, never credentials,
  never full payment instruments.
- The provider, the region, and the retention terms per tenant are visible to the tenant.
- Which providers are permitted is a **tenant-level** setting; some customers will forbid
  some vendors, and that must be expressible.

---

## 7. Cost, quotas, and metering

- Token and cost usage is metered **per tenant, per App, per principal**, and is visible.
- Plan quotas apply; exceeding one returns `quota_exceeded`, never a silent downgrade to a
  weaker model, which would change output quality invisibly.
- Runaway loops are bounded: maximum tool calls per session, maximum recursion depth,
  maximum spend per operation.
- Timeouts are explicit. AI calls are slow and variable, so anything user-facing has a
  defined budget and a defined behaviour on exceeding it.

---

## 8. Quality, evaluation, and honesty to the user

- Every AI action has an evaluation set and a stated quality bar before it ships. "It
  looked good in testing" is not a bar.
- **Provider changes are regression-tested against that set.** Swapping providers is a
  behaviour change even when the interface is identical.
- AI output that a user will act on is **labelled as AI-generated**, with its sources where
  it was grounded.
- Confidence is surfaced where the action has consequences. An extraction that is probably
  right is not the same as a value a human entered, and the difference must be visible in
  the UI and preserved in the record.
- **AI output is never presented as a system fact.** A predicted invoice total is a
  suggestion until a human or an authorized rule accepts it.

---

## 9. Verification checklist

- [ ] No provider, model, or vendor name outside a provider Connector.
- [ ] No AI code path holds a storage handle or constructs a query.
- [ ] Every AI-initiated mutation is an Action invocation, fully authorized.
- [ ] Retrieval is tenant-scoped **and** permission-scoped to the acting principal.
- [ ] Retrieved and external content is treated as data, never as instruction.
- [ ] Model output validated against a schema before use.
- [ ] Model output never selects tenant, principal, permission, or scope.
- [ ] Sensitive and critical actions require platform-collected human confirmation.
- [ ] Tenant data sent to an external provider is covered by a recorded decision and
      tenant configuration.
- [ ] No training or provider retention on tenant data without recorded consent.
- [ ] Token and cost metered per tenant, App, and principal; quotas enforced.
- [ ] Loop, depth, spend, and time bounds set.
- [ ] Evaluation set exists; quality bar stated; provider swap regression-tested.
- [ ] AI-generated output labelled, with sources and confidence where consequential.
- [ ] Audit written for every AI-initiated action, success and denial.

---

## 10. Open questions

**Reconciled against the built system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would).
**Nothing in this document has been built or contradicted — there is no AI code in the
repository.** What changed is the urgency: `0030` made the target the full system as
`docs/product/vision.md` describes it, and *"AI built into the product rather than bolted onto
it"* is the product's central claim. **AI is now the largest unstarted area of the vision, and its
first blocker is a user decision rather than an engineering one.**

| # | State | Question | Recommendation |
|---|---|---|---|
| AI1 | **OPEN — ROOT R3. A user decision, not only an ADR, and it should be surfaced now** | **No AI provider is approved.** Workers AI, AI Gateway, and the Agents SDK are named in the plan and explicitly **not** approved by `0003`. External providers are not approved either. | Unchanged in substance and sharper in kind. The AI Capability interface can be specified now; **no AI feature can ship** until a provider record exists. **What makes it a user decision and not an architecture one is `0008`:** every candidate consumes a metered allowance or an external bill, no agent may approve paid usage, and the free-tier register carries no AI row at all. So the record this row needs must answer **three** questions together, and the last two are the user's: which provider, **what it costs**, and **whether tenant data may reach it** (AI3). **`0030` raises the stakes** — it makes the AI-native promise part of the committed target rather than a later phase — **without changing the answer.** This blocks CP2, `SDK_STANDARD.md` SD6's AI surface, AI2's alternatives, and the `search`/`recommend`/`ocr`/`speech`/`vision` half of §2. Stated here once; the other rows point at it. |
| AI2 | **OPEN** — root R3's family: an unapproved Cloudflare product plus a cost question | **Semantic search and embeddings** need a vector store. Vectorize is not approved; no alternative is either. | Blocked; `search` and `recommend` cannot be implemented until it is recorded. Flagged rather than designed around, which is still right. **Two notes added 2026-09-06.** **(1)** This is the same shape as `CLOUDFLARE_STANDARD.md` CF2 and CF3 — a Cloudflare product outside `0003`'s six needs its own record **and** must be free under `0008` — so it should be decided in that family rather than as an AI question. **(2)** `packages/contracts/registries/core-object-registry.yaml`'s `SearchIndexEntry` carries the identical blocker from the Core side — *"Blocked: no search engine is approved"* — and states the constraint that survives whatever is chosen: *"The index is tenant-partitioned — a shared index is a shared data store."* §4 above says the same of embeddings, indexes and caches, and calls cross-tenant grounding a **critical defect**. |
| AI3 | **OPEN — a user decision with legal consequences; belongs to the user alone** | **Data-processing terms for tenant data leaving the platform** (§6). | *"Raise before the first AI feature is scoped, not when it is built."* **That moment has arrived**: `0030` puts AI features inside the committed scope. It cannot be answered by an agent and should be asked **at the same time as AI1**, because a provider chosen before the terms are settled is a provider that may have to be replaced — which is precisely the coupling §1 exists to prevent, arriving through procurement instead of through code. |
| AI4 | **OPEN** — architecture decision; cheap, and blocks nothing today | **Where the AI router lives.** Core must not depend on a provider (Rule 6), but routing is platform behaviour. | The recommendation stands: the router is the AI **Capability implementation** in `platform/capabilities/**`; providers stay in `connectors/**`; Core depends on the capability contract only. **It is a recommendation and not yet a decision**, and it can be settled without AI1 — no provider need be named to decide where the routing layer sits. Worth recording early, because `platform/capabilities/` is empty and the first thing put there sets the pattern. |
| AI5 | **CONTRADICTED in its premise**, then narrowed | ~~**Evaluation tooling** requires a test framework, and none is approved.~~ | **The premise is false.** A runnable suite exists with no third-party framework — `npm test` → `tools/run-suites.mjs`, four entry points, exit-code gated (`TESTING_STANDARD.md` TS1). **Evaluation sets can be authored as data *and executed* today**; the harness pattern needed is the same one `packages/testing/harness/` already uses. **What actually blocks evaluation is AI1**, because there is nothing to evaluate until a provider answers — and §8's requirement that *"provider changes are regression-tested against that set"* only bites once there are two providers. **The correct order is therefore the reverse of what this row implied:** author the evaluation sets and the quality bars **first**, as §8 requires them before an action ships, so that the provider decision can be judged against something rather than justified after it. |
