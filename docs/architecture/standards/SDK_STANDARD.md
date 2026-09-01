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
| **(a) The architecture and contract** | The fifteen surfaces, the boundaries, the security requirements, the versioning policy, and the validation rules in this document. This is a *specification*: what the SDK must be when it is built. | **Draft. Not yet accepted.** `architecture-agent` proposes; the Team Lead accepts under the Foundation Gate (`docs/decisions/0005`). Binding on acceptance, not before. |
| **(b) The implementation** | Executable code under `packages/sdk/**`: a client, a generator, a package, a published artifact. | **NOT STARTED. No SDK code exists in this repository, in any form** — not a stub, not a prototype, not a type declaration. Nothing imports an SDK because there is nothing to import. Every present-tense sentence in this document describes a requirement on future code, never an observed behaviour of existing code. |
| **(c) What is blocked, and by what** | The gates that must clear before (b) may begin. | **`docs/decisions/0007` (logical permission model) is Proposed, not accepted**, and `0001` gates SDK work behind it plus an App permission-and-trust ADR that is not drafted — so **no `packages/sdk/**` code may be written yet** (SD1). Independently, **no package, framework, or test framework is approved** (`CONSTITUTION.md` Rule 12), so there is no build, publish, or test toolchain (SD4). Both must clear; clearing one does not unblock the work. Two surfaces stay blocked beyond that even once code begins: **Secrets** (CN1, no tenant-scoped secret store) and **AI/MCP** (AI1, MC1). |

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
| 1 | **Identity** | The current principal, its type, its tenant and business context, its memberships | Another tenant's users; any credential; a way to *set* the tenant (`MULTITENANCY_STANDARD.md` §3) | AZ2 — no authentication mechanism decided |
| 2 | **Permissions** | Which permissions the App holds; an **advisory** `can()` check | An authorization decision Core has not made; any way to grant, elevate, or self-check into access | `0007` (Proposed) |
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

| # | Question | Status |
|---|---|---|
| SD1 | **SDK work is gated by `0001`.** The logical permission model and the App permission-and-trust ADR must both be accepted first. | The permission model is drafted as `0007` and is **Proposed, not accepted**; the trust ADR is not drafted at all. **No `packages/sdk/**` code until both are accepted** (§0 row c). |
| SD2 | **The Secrets surface has no store** — CN1. Worker secret bindings are per-Worker, not per-tenant. | Hard blocker on surface 14. Building a value-returning placeholder is forbidden. |
| SD3 | ~~**The Storage surface depends on the tenancy model**~~ — **UNBLOCKED. `0006` is Accepted.** | Option A — one shared production D1 database, reached only through the Core-owned `TenantStoreResolver` and the Core-owned storage port. The surface's shape is unchanged, as predicted: the App still never sees a binding, a handle, or SQL. Implementation is no longer blocked by the model; it remains blocked by SD4 (no approved toolchain) and SD1 (`0007`). `0006` is MVP-scoped while `0008` is active, so the port must not leak the physical model — a later move to Option C must not change SDK surface 4. |
| SD4 | **No package, framework, or test framework is approved** (`CONSTITUTION.md` Rule 12, TS1), so the SDK has no build, publish, or test toolchain. | Blocks Phase 3 entirely. Needs decision records. |
| SD5 | **Distribution and publication** — how third parties obtain the SDK, and under what licence. Licence is an open user decision (`docs/decisions/README.md`). | Not decided. Needed before any external developer exists. |
| SD6 | **The AI surface names no provider** (AI1) and **the MCP surface names no transport** (MC1). | Both surfaces are specified but unbuildable. Recorded, not assumed. |
