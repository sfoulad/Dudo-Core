# AI Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No AI provider, model, gateway, or SDK is approved** — see §10.
- **Authored by:** `architecture-agent`.
- **Applies to:** every AI-assisted feature, every AI Skill, every AI principal.
- **Depends on:** `CONSTITUTION.md` Rules 7, 8; `CAPABILITY_STANDARD.md`; `AUTHORIZATION_STANDARD.md`; `MCP_STANDARD.md`; `SECURITY_STANDARD.md`.
- **Source:** master build plan §17, §2, §32.

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

The plan's function list (§17), as capability actions:

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

| # | Question | Recommendation |
|---|---|---|
| AI1 | **No AI provider is approved.** Workers AI, AI Gateway, and the Agents SDK are named in the plan and explicitly **not** approved by `0003`. External providers are not approved either. | The AI Capability interface can be specified now; **no AI feature can ship** until a provider ADR exists. This is a hard blocker on the "AI-native" product promise and the Team Lead should surface it to the user early. |
| AI2 | **Semantic search and embeddings** need a vector store. Vectorize is not approved; no alternative is either. | Blocked. `search` and `recommend` cannot be implemented until it is recorded. Flagged rather than designed around. |
| AI3 | **Data-processing terms for tenant data leaving the platform** (§6) have legal consequences and belong to the user, not to any agent. | Raise before the first AI feature is scoped, not when it is built. |
| AI4 | **Where the AI router lives.** Core must not depend on a provider (Rule 6), but routing is platform behaviour. | The router is the AI **Capability implementation** in `platform/capabilities/**`; providers stay in `connectors/**`. Core depends on the capability contract only. |
| AI5 | **Evaluation tooling** requires a test framework, and none is approved. | `TESTING_STANDARD.md` TS1. Evaluation sets can be authored as data now and executed once a framework exists. |
