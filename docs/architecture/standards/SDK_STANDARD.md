# Developer SDK Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **This document specifies the SDK; it does not describe one that exists.** See §0.
- **Authored by:** `architecture-agent`.
- **Applies to:** `packages/sdk/**` — the path reserved for the public SDK third-party developers will build against, and the same SDK every first-party App will use. **The directory holds no code.**
- **Owned by:** `plugin-agent` (`0004`). Authored here; implemented there.
- **Depends on:** `CONSTITUTION.md` Rules 1, 3, 4, 7, 8, 9, 10, 11, 12; `API_STANDARD.md`; `AUTHORIZATION_STANDARD.md`; `MULTITENANCY_STANDARD.md`; `SECURITY_STANDARD.md`; `CAPABILITY_STANDARD.md`.
- **Applies from:** Phase 3.

---

## 0. Status of the SDK — three separate things

Conflating these three is how a specification gets read as a shipped component. They are
stated separately, and every "the SDK does X" sentence below belongs to the first row.

| | What it is | Where it stands |
|---|---|---|
| **(a) The architecture and contract** | The fifteen surfaces, the boundaries, the security requirements, the versioning policy, and the validation rules in this document. This is a *specification*: what the SDK must be when it is built. | **Draft. Not yet accepted.** `architecture-agent` proposes; the Team Lead accepts under the Foundation Gate (`docs/decisions/0005`). Binding on acceptance, not before. *(Checked 2026-09-06 and **still correct** — `0005` was amended that day, but only its "when the full gate returns" clause was struck; its seven Foundation Gate conditions and its eight not-suspended requirements stand. `0030` adds that **accepting this standards corpus is the first milestone**, which is the same acceptance point, not a second one. This citation is not `0030` residue and should not be swept away as if it were.)* |
| **(b) The implementation** | Executable code under `packages/sdk/**`: a client, a generator, a package, a published artifact. | **NOT STARTED. No SDK code exists in this repository, in any form** — not a stub, not a prototype, not a type declaration. Nothing imports an SDK because there is nothing to import. Every present-tense sentence in this document describes a requirement on future code, never an observed behaviour of existing code. |
| **(c) What is blocked, and by what** | The gates that must clear before (b) may begin. | **CORRECTED 2026-09-06 — half of this cell was false, and it was false about a decision record.** It said *"`docs/decisions/0007` (logical permission model) is Proposed, not accepted."* **`0007` is Accepted, 2026-09-01, with ten binding rules** (`docs/decisions/README.md`). `0001` gates SDK work behind `0007` **plus** an App permission-and-trust ADR, and **that second ADR is still not drafted**, so the conclusion — no `packages/sdk/**` code yet — survives on one leg instead of two (SD1). Likewise *"no package, framework, or test framework is approved"* is **no longer true**: `0016` (Accepted) approved npm dependencies for the web stack, the root `package.json` carries `typescript` and `wrangler`, the licence is decided (Apache-2.0), and a test suite runs (`TESTING_STANDARD.md` TS1). What is genuinely missing is narrower and is restated at SD4. Two surfaces stay blocked beyond all of that even once code begins: **Secrets** (CN1, no tenant-scoped secret store) and **AI/MCP** (AI1, MC1). |

**Consequences that follow from (b), and are not negotiable while it holds.** No claim that
the SDK "supports", "provides", or "exposes" anything is a statement of fact today. No
verification checklist in §9 may be ticked. VAL-SDK-1 through VAL-SDK-8 (§7) are specified
tests, none of which has ever been run. A future report that shows them green must say when
they first ran, because a check that has never run is not a passing check.

---

## 1. The rule the SDK exists to satisfy

The originating requirement:

> Dudo provides a first-class SDK. **External developers should rarely need to
> understand Cloudflare infrastructure directly. They develop against Dudo.**

That sentence is the standard. Its checkable form:

> **No Cloudflare type, binding, client, configuration key, or error appears anywhere in the
> SDK's public surface** — not in a parameter, not in a return type, not in an error, not in
> a required configuration value, not in a stack trace an App author will paste into a
> support request.

This is `CONSTITUTION.md` Rule 11 applied to the one boundary where it is externally
visible. A developer who has to learn D1's threading model to write a CRM App is a developer
the SDK failed.

**The second rule:** *"Even official Apps follow exactly the same architecture rules as
third-party Apps. This ensures the SDK is actually usable by external developers."* Stated
for Apps in `APP_STANDARD.md`; this is its SDK form.
There is **one** SDK. If a first-party App reaches Core through a path the published SDK does
not offer, the SDK is not the product — it is a demo, and its gaps will not be discovered
until a third party hits them.

> **This sentence is currently false about Dudo, and the rule is not being softened to make it
> true.** A first-party App is deployed and reaches Core by importing Core. See **SD7** (§10) for
> the citations, the cause, and what is owed. Recorded 2026-09-06.

---

## 2. What the SDK is, and what it is not

| The SDK is | The SDK is not |
|---|---|
| A **typed client** for contracts published in `packages/contracts/**` | A second implementation of any contract |
| A convenience layer over declared Actions | A place where business logic lives |
| An **advisory** pre-checker for permissions and validation | An authorization authority |
| Generated from the Action definition | A hand-maintained parallel definition |
| Versioned, with a deprecation policy | Free to change under its consumers |

**Dependencies point inward.** The SDK depends on contracts. Core does not depend on the
SDK. An App depends on the SDK and on contracts, never on Core internals
(`CONSTITUTION.md` §6, `.claude/rules/architecture.md` §3).

**Generated, not written** (`ARCHITECTURE.md` §4). From one Action definition, the platform
generates the internal API, the public API, the OpenAPI schema, **the SDK method**, the MCP
tool, and the documentation. *"Do not create five independent definitions."* A hand-written SDK method for
an Action that already exists is a sixth definition and is rejected in review — it is how
the SDK and the API silently diverge.

---

## 3. The fifteen surfaces

There are fifteen. Each is listed with what it must expose, what it must never expose, and
whether anything blocks it beyond the global blockers.

**Read the "Blocked by" column narrowly.** It lists blockers *specific to that surface*. A
`—` means "nothing further beyond §0", **not** "buildable". Every surface is blocked by SD1
and SD4 (§0 row c), so **no** row is buildable today. None of the fifteen exists.

| # | Surface | Exposes | Must never expose | Blocked by |
|---|---|---|---|---|
| 1 | **Identity** | The current principal, its type, its tenant and business context, its memberships | Another tenant's users; any credential; a way to *set* the tenant (`MULTITENANCY_STANDARD.md` §3) | — (**AZ2 decided and shipped**: `0014` Accepted, login live; corrected 2026-09-06) |
| 2 | **Permissions** | Which permissions the App holds; an **advisory** `can()` check | An authorization decision Core has not made; any way to grant, elevate, or self-check into access | — (`0007` **Accepted** 2026-09-01; corrected 2026-09-06) |
| 3 | **Entities** | CRUD over the App's **own** declared entities, through declared Actions | Another App's entities; a raw query; a join across Apps (`CONSTITUTION.md` Rule 3) | — |
| 4 | **Storage** | The App's own tenant-scoped storage, through the Core-owned port | **A database handle, a connection, SQL, an ORM model, or any Cloudflare storage type.** No exception for first-party Apps (`.claude/rules/security.md` §4) | — (`0006` Accepted: shared D1 behind a Core-owned `TenantStoreResolver`; the App never sees a binding) |
| 5 | **Events** | Publish a registered event; subscribe to registered events | An unregistered event type; another App's event stream unfiltered; an envelope whose `tenant_id` the caller sets (`EVENT_STANDARD.md` §4) | — |
| 6 | **Actions** | Invoke a declared Action; define the App's own | A path that invokes an Action without Core authorizing it | — |
| 7 | **Files** | Tenant- and App-scoped object storage; upload, download, signed access | An R2 type; a key the caller composes freely; any path outside `t/<tenant_id>/<app_id>/` | — |
| 8 | **Notifications** | Send through the Core notification service, within the tenant | A recipient outside the tenant; a channel the tenant has not authorized | — |
| 9 | **Workflows** | Start, inspect, and signal long-running work | A `WorkflowEntrypoint` type; a step that widens tenant scope (`CLOUDFLARE_STANDARD.md` §6) | — |
| 10 | **Capabilities** | Request a **capability**, never a vendor: `Payment`, never `Stripe` (`CONSTITUTION.md` Rule 6) | Any provider name, provider-specific field, or provider selection by the App | — |
| 11 | **AI** | The AI capability's actions: generate, summarize, extract, translate, classify, and the rest | Any model or provider name; a raw provider client; a path that lets an App choose an LLM (`AI_STANDARD.md`) | AI1 — no AI provider approved |
| 12 | **MCP** | Declare that an Action is AI-exposed; nothing more | A second code path for AI; a tool whose schema differs from the Action's (`MCP_STANDARD.md` §1) | MC1, MC2 — transport and auth undecided; Phase 8 |
| 13 | **UI Extensions** | Registration of components into **approved extension locations** | Any way to modify Core UI directly (`APP_STANDARD.md` §8); an unregistered location | — |
| 14 | **Secrets** | **Reference by name only**, plus injection performed by the platform at the egress boundary | **A secret value, ever.** Not returned, not logged, not in an error, not in a debug mode, not to a first-party App (`SECURITY_STANDARD.md` §5) | **CN1 — no tenant-scoped secret store exists** |
| 15 | **Logging** | Structured logging with `request_id`, `tenant_id`, `principal_id`, `app_id`, `correlation_id` (`ARCHITECTURE.md` §8) | Business data; another tenant's identifiers; anything classified `secret` or `sensitive-personal` unredacted | — |

**Surface 14 is the one to read twice.** An SDK that can return a secret value to App code
has defeated the entire secret-handling model, because every App is untrusted
(`SECURITY_STANDARD.md` §1 threat 2). The SDK's secret surface resolves a *name* to a
platform-performed injection at the point of an outbound call; App code never holds the
value. **This surface cannot be built before CN1 is answered**, and building a placeholder
that returns values "for now" is precisely the thing that will not be removed later.

**Surface 4 is the second.** "Storage" here does not mean database access. It
means the App's own tenant-scoped storage through the Core-owned port. There is no SDK method
that yields a `D1Database`, a connection, or a query string.

---

## 4. Boundaries

### 4.1 The SDK holds no authority

- **Core decides authorization, on every call** (`AUTHORIZATION_STANDARD.md` §5). The SDK's
  `can()` exists to produce a good error message before a round trip; **its answer is
  advisory and Core decides again**.
- The SDK never carries an elevated identity, never acts on behalf of the platform, and
  **never lets an App select its own tenant**. Tenant context is server-derived
  (`MULTITENANCY_STANDARD.md` §3).
- The SDK is not a trust boundary. An App that bypasses the SDK and calls the API directly
  must be denied exactly the same things — if bypassing the SDK gains an App anything, the
  enforcement is in the wrong place.

### 4.2 The SDK holds no business logic

Pricing, tax, entitlement, approval rules, and workflow transitions live in Core or in the
App, never in a shared client library. A rule implemented in the SDK is a rule that ships on
the consumer's release schedule and can be edited by anyone who can fork the package.

### 4.3 The SDK does not reach across Apps

No SDK method resolves another App's storage handle, entities, internal Actions, or caches.
Cross-App communication is internal APIs and events (`CONSTITUTION.md` Rule 3), and both go
through Core with authorization on the callee side.

---

## 5. Security requirements

1. **Every SDK call is authorized in Core, on every invocation** — not once at load, not by
   the SDK, not by the App (`AUTHORIZATION_STANDARD.md` §8).
2. **Undeclared is denied.** The SDK offers no method that reaches a permission the App did
   not declare in its manifest, and a call to one fails at the boundary rather than
   returning a partial result.
3. **Tenant context is never a parameter.** No SDK signature accepts a tenant id, and no SDK
   configuration sets one.
4. **Input validation happens at the Core boundary**, against the Action's declared schema,
   with unknown fields rejected. SDK-side validation is advisory (`API_STANDARD.md` §7).
5. **Errors carry `request_id` and nothing else** — no business data, no foreign tenant
   identifier, no internal structure, no Cloudflare error text (`API_STANDARD.md` §8).
6. **Nothing classified `secret` crosses the SDK boundary outward** (§3, surface 14).
7. **Redaction is applied before logging, inside the SDK's logging surface**, so that an App
   author cannot log a sensitive field by accident (`SECURITY_STANDARD.md` §7).
8. **Idempotency keys are supported and required where the Action declares them**
   (`API_STANDARD.md`), because a retried payment is the failure this prevents.
9. **The SDK is itself untrusted input to Core.** Core validates everything the SDK sends;
   a compromised or modified SDK gains nothing.

---

## 6. Versioning

- **The SDK is versioned independently of the API it calls**, and every SDK release states
  the contract versions it targets. Conflating the two makes an SDK bugfix look like an API
  change.
- **Breaking changes require a new major SDK version and, where the underlying contract
  changes, a new API version** (`CONSTITUTION.md` Rule 9, `API_STANDARD.md` §6).
- **Additive is additive:** a new optional parameter, a new method, a new optional response
  field. Removing a method, renaming a parameter, narrowing a type, adding a required
  parameter, or changing an error code is **breaking**, whatever the version number implies.
- **Deprecation is announced before removal**, with the replacement named and a stated
  window. An SDK that removes a method in a minor release breaks every App at once — and the
  Apps are third-party, so we cannot fix them.
- **A generated SDK method inherits its contract's version.** The SDK never diverges from the
  Action definition it was generated from; if it can, `§2`'s generation rule is being
  violated somewhere.
- SDK releases follow the same PR review and CI gates as any other change; **no unversioned
  or ad-hoc publication.**

---

## 7. Validation rules

Named so they can be tested rather than reviewed by eye:

| Rule | Statement |
|---|---|
| **VAL-SDK-1** | No Cloudflare type, binding, client, or configuration key appears in the SDK's public surface. Checkable: grep the public API for `D1Database`, `R2Bucket`, `Queue`, `DurableObjectNamespace`, `Fetcher`, `WorkflowEntrypoint`, `env` — the result is empty |
| **VAL-SDK-2** | Every SDK method that invokes an Action is generated from that Action's definition, and no hand-written duplicate exists |
| **VAL-SDK-3** | No SDK signature accepts a tenant identifier |
| **VAL-SDK-4** | No SDK method returns a value classified `secret` |
| **VAL-SDK-5** | No SDK method returns a storage handle, connection, query, or ORM model |
| **VAL-SDK-6** | Every SDK method maps to a permission that exists in `permission-catalog.yaml` |
| **VAL-SDK-7** | A capability call names a capability, never a provider. Checkable: no vendor name appears in `packages/sdk/**` (`CONSTITUTION.md` Rule 6) |
| **VAL-SDK-8** | An App calling the API directly, bypassing the SDK, is denied exactly what the SDK would deny. Verified by test, not by assertion |

VAL-SDK-8 is the important one: it is the test that proves the SDK is a convenience rather
than a security control.

---

## 8. Testing

Per `TESTING_STANDARD.md`, and additionally:

- **Contract tests bind the SDK to the contract**, both sides, so a contract change that the
  SDK does not follow fails CI rather than a customer's App.
- **A permission test per surface**: called without the declared permission → denied; called
  with it → allowed; called after revocation → denied on the next call.
- **A tenant-isolation test per surface** (`MULTITENANCY_STANDARD.md` §8): a fully privileged
  principal in tenant A reaches nothing of tenant B through any of the fifteen surfaces.
- **The bypass test** (VAL-SDK-8).
- **A first-party/third-party parity test**: an official App and a synthetic third-party App
  perform the same operation through the same SDK surface with the same result. This is what
  keeps §1's second rule honest.

---

## 9. Verification checklist

**Every box below is unticked and stays unticked.** There is no SDK to verify (§0 row b), so
no item here has been checked, and none may be reported as satisfied until it has been run
against real code.

- [ ] No Cloudflare type or binding in the SDK's public surface (VAL-SDK-1).
- [ ] Every Action-invoking method generated from the Action definition; no duplicates.
- [ ] No tenant identifier in any signature; tenant context server-derived.
- [ ] No storage handle, connection, SQL, or ORM model returned by any method.
- [ ] No secret value returned by any method; secrets are references plus platform injection.
- [ ] Capability calls name capabilities, never providers.
- [ ] Every method maps to a declared, catalogued permission; undeclared is denied.
- [ ] SDK permission checks documented as advisory; Core re-decides.
- [ ] Structured logging carries the five `ARCHITECTURE.md` §8 identifiers; redaction applied.
- [ ] Version stated, contract versions targeted, breaking changes gated on a new major.
- [ ] Deprecations announced with a replacement and a window.
- [ ] Contract, permission, isolation, bypass, and parity tests present and passing.

---

## 10. Open questions

**Reconciled against the built system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would — those
are reported, never resolved by editing the standard to agree). **§0 row (b) is unchanged and
remains the most important sentence in this document: no SDK code exists, in any form.** What
changed is that the platform stopped waiting for it — see SD7.

| # | State | Question | Status |
|---|---|---|---|
| SD1 | **Half CLOSED, half OPEN** — root R6 | **SDK work is gated by `0001`.** The logical permission model and the App permission-and-trust ADR must both be accepted first. | ~~The permission model is drafted as `0007` and is **Proposed, not accepted**~~ — **wrong as of 2026-09-01 and corrected 2026-09-06: `0007` is Accepted**, with ten binding rules (`docs/decisions/README.md`). **The trust ADR is still not drafted at all** — `docs/decisions/README.md`'s "scheduled but not yet written" list, item 2: *"The App permission and trust ADR — required before any SDK or runtime work. `0007` accepts the logical model; it does not decide trust, review or admission."* **So SD1 still blocks, on one leg rather than two**, and R6 is a genuinely independent open decision, not a restatement of R1. |
| SD2 | **OPEN** — root R2 (CN1) | **The Secrets surface has no store.** Worker secret bindings are per-Worker, not per-tenant. | Hard blocker on surface 14, unchanged, and now demonstrated in production rather than predicted: three platform secrets are set **once per Worker and identically for both Workers** (`CONNECTOR_STANDARD.md` CN1). Building a value-returning placeholder is forbidden. |
| SD3 | **CLOSED as to the model; the `0030` premise note is new** | ~~**The Storage surface depends on the tenancy model**~~ — **`0006` is Accepted.** | Option A — one shared production D1 database, reached only through the Core-owned `TenantStoreResolver` and the Core-owned storage port. **The prediction held under implementation:** `apps/customers/README.md` records that the App *"never sees a tenant identifier… the storage boundary refuses any spec that names it"*, and the predicate is applied centrally in `platform/core/storage/adapters/sql/sql-compiler.ts`. Still blocked by SD1 and SD4. **Premise corrected 2026-09-06:** this row said `0006` is *"MVP-scoped while `0008` is active"*; **`0030` withdrew the MVP framing and did not reverse `0006`.** The obligation is unchanged and its footing is firmer — `0030` makes reversibility binding, so **surface 4 must not change if the tenancy model does**, which is the same sentence this row already carried. |
| SD4 | **CONTRADICTED**, then narrowed | **No package, framework, or test framework is approved**, so the SDK has no build, publish, or test toolchain. | **The premise is false as written.** `0016` (Accepted) is *"the first decision to approve npm dependencies"* — React 19, TypeScript, Vite, Tailwind v4, shadcn/ui — and the root `package.json` carries `typescript`, `wrangler` and `@types/node`. A build toolchain exists (Vite, for two SPAs) and a runnable test gate exists (`TESTING_STANDARD.md` TS1). **What genuinely remains is narrower and should be asked as one question:** the SDK is a *published package for third parties*, and nothing yet decides how it is built, versioned and published as an artifact — which is SD5's other half. ~~Blocks Phase 3 entirely.~~ **`0030` withdrew the phase framing;** this blocks SDK publication, not SDK authorship. |
| SD5 | **Licence half CLOSED; distribution half OPEN** | **Distribution and publication** — how third parties obtain the SDK, and under what licence. | **The licence is decided: Apache License 2.0**, both repositories, unmodified upstream text, user decision of 2026-09-01 (`docs/decisions/README.md`), and it is already asserted in `package.json` (`"license": "Apache-2.0"`). ~~Licence is an open user decision.~~ **Distribution is undecided** — registry, package name, versioning cadence, and the note in the free-tier register that **GitHub Packages is prohibited under `0008`, not merely unused**, which removes one obvious answer before anyone proposes it. Needed before any external developer exists. |
| SD6 | **OPEN** — roots R3 (AI) and R5 (MCP), which are separate decisions | **The AI surface names no provider** (AI1) and **the MCP surface names no transport** (MC1). | Both surfaces are specified but unbuildable. Recorded, not assumed. **MC2's dependency has changed** — it was blocked "with AZ2", and AZ2 is decided and shipped — but MC1's transport and MC2's session-binding design are still owed (`MCP_STANDARD.md`). |
| SD7 | **CONTRADICTED — added 2026-09-06. This is the finding of the pass, and it is not a question** | **§1's second rule is violated in fact.** This document says there is **one** SDK, and that *"if a first-party App reaches Core through a path the published SDK does not offer, the SDK is not the product — it is a demo, and its gaps will not be discovered until a third party hits them."* **A first-party App shipped, deployed and is serving traffic, and it reaches Core by importing Core.** `apps/customers/app.ts:28–30` imports `AppPermissionEnvelope`, `Router` and `createRouter` from `../../platform/core/**`. There is no SDK to import: `packages/sdk/` contains a README. | **This standard is right and must not be edited to agree with the code.** The chain is legitimate at every step and wrong in total: SD1 forbids writing SDK code, an App was scheduled anyway, and the only available path was the direct one. **What §1 predicted has already happened in the opposite direction** — the gaps were not discovered by a third party, they were absorbed by us, silently, one import at a time. **The cost is measurable and rising:** `app.ts` hand-transcribes the App's nine permissions from its manifest and labels itself *"a drift surface, declared as one"*, because nothing reads the manifest at runtime. **Two things are owed and they are not the same:** **(1)** the App permission-and-trust ADR (SD1/R6) so SDK code may be written at all; **(2)** a Team Lead ruling on whether a second App may take the same path before it exists. **At one App this is a recorded exception. At two it is the architecture.** |
