# Architecture Decision Records

This directory is Dudo's decision memory. Any choice that is expensive to reverse is
written down here **before** work is built on top of it. A decision that exists only in
a chat transcript does not exist.

## What must be recorded

- Technology stack: language, framework, database, hosting, AI model integration.
- The tenancy model and how isolation is enforced.
- Authentication and authorization model.
- Contract format, transport, and versioning strategy.
- Plugin permission model and isolation mechanism.
- Data model shape and migration strategy.
- Service topology and deployment shape.
- Anything else that would be painful or costly to undo.

If you are unsure whether a decision qualifies, write it down. Cheap to add, expensive
to have missed.

## Naming

`NNNN-short-kebab-title.md`, numbered sequentially from `0001`, never renumbered.

```
0001-choose-technology-stack.md
0002-tenancy-model.md
```

## Template

```markdown
# NNNN — <Title>

- **Status:** Proposed | Accepted | Superseded by NNNN | Rejected
- **Date:** YYYY-MM-DD
- **Deciders:** <who>
- **Owning agent:** <app-agent | core-agent | plugin-agent | qa-agent | Team Lead>

## Context
What forced this decision. Constraints, requirements, what was already true.

## Options considered
1. **<Option>** — trade-offs.
2. **<Option>** — trade-offs.

## Decision
What was chosen, stated plainly.

## Consequences
What becomes easy, what becomes hard, what has to change, what this locks in.

## Approval
Whether the user explicitly approved this, and where. Required for stack choices and
anything touching production. An agent's or the Team Lead's own judgment is not approval.
```

## Rules

- The **Team Lead owns this directory.** Agents propose; the Team Lead records.
- A record's status is never edited away — a reversed decision gets a **new** record
  that supersedes the old one, and the old one is marked `Superseded by NNNN`.
- Stack decisions and production-affecting decisions are only `Accepted` with **explicit
  user approval**, noted in the record.
- Record the decision before building on it, not after.

## Current state

| Record | Status | Decides |
|---|---|---|
| `0001-governance-and-decision-sequencing.md` | Accepted | Process only — the order in which the plugin decisions are made, and who owns root-level shared test configuration. **No architecture.** |
| `0002-repository-and-mvp-delivery-strategy.md` | Accepted | Two public repositories, the Apple platform approach, Apple and web delivery policy, the seven-step feature completion gate, team changes, public-repository safety. |
| `0003-technology-stack-typescript-on-cloudflare.md` | Accepted | TypeScript on Cloudflare for `Dudo-Core`: Workers, D1, R2, Queues, Workflows, Durable Objects. Bindings not REST. No blanket product adoption; every service stays replaceable behind an internal boundary. |
| `0004-repository-structure.md` | Accepted | The planning-source layout — `platform/`, `apps/` (reserved for installable business Apps), `connectors/`, `packages/`, `agents/`, `docs/`. Contract authorship moves from `core-agent` to `architecture-agent`. |
| `0005-foundation-gate-for-phases-0-3.md` | Accepted | Suspends the three delivery-only steps for Phases 0–3 and replaces them with a seven-condition Foundation Gate. Security, tenant isolation, contract compatibility, ownership, PR review, truthful reporting, secrets, and production controls are **not** suspended. |
| `0006-tenancy-model.md` | **Accepted** | **Option A — one shared production D1 database — with mandatory `TenantStoreResolver` indirection.** Scoped to the Zero-Cost MVP while `0008` is active. B excluded; C is the approved migration candidate. Free-tier budget: 4 of 10 databases allocated, 5–10 reserved. |
| `0007-logical-permission-model.md` | **Accepted** | The logical permission model `0001` requires. **Accepted 2026-09-01 subject to ten binding rules:** Core is the only authorization authority; deny by default; no wildcards; explicit registration; requested scope cannot exceed user/role/tenant/App scope; Apps request but never grant; unknown/malformed/reserved fail closed; every `own`-scoped Action identifies target Entity and ownership relation; permission changes are audited; third-party Apps get least-privilege revocable tenant-scoped grants. |
| `0008-zero-cost-mvp-infrastructure.md` | **Accepted** | Cloudflare and GitHub cost must remain **USD 0 / BD 0 per month**. Free allowances only; Workers Paid and Workers for Platforms prohibited. No agent may approve paid usage. |
| `0009-phase-0-zero-dependency-contract-relation-validator.md` | **Accepted** | A narrow Phase 0 exception: one zero-dependency Node module enforcing the AZ7 referential rule JSON Schema cannot express, closing CWE-863. **Foundation Gate tooling, not product runtime.** Approves no toolchain, no dependency, and no Phase 1 work. |
| `0010-admin-interface-frontend-stack.md` | **Accepted, not on `main`** | The admin interface stack — React, TypeScript, Vite, Tailwind, shadcn-admin, at `admin.dudo.work`. **Lives on branch `decision/admin-frontend` and has not been merged**, which is why the numbering jumps here. It is not lost and `0010` is not free. |
| `0011-manifest-lifecycle-indefinite-retention.md` | **Accepted** | **`onUninstall: retain` means retained INDEFINITELY**, and `retentionDays` is **forbidden** under it, **required** under `archive`. The schema previously required a duration alongside `retain`, so the customer-retention decision could not be stated truthfully in a manifest. Decided while nothing consumes the schema — no SDK, no Studio, no published manifest. |
| `0012-manifest-api-path-underscore.md` | **Accepted** | `apis[].path` widens to `^/[a-z0-9_\-/{}]*$` so **`snake_case` path parameters are expressible**. `API_STANDARD.md` §5 mandates `snake_case`, yet the schema rejected the standard's own example `/api/v1/orders/{order_id}`. Widening only; no existing manifest is invalidated. |

### Technology stack status

| Scope | Status |
|---|---|
| `Dudo-Apple` | **Approved** (`0002`): Xcode, Swift, SwiftUI; iPhone, iPad, macOS; true native macOS destination, never Mac Catalyst |
| `Dudo-Core` | **Approved** (`0003`): TypeScript on Cloudflare — Workers, D1, R2, Queues, Workflows, and Durable Objects only where real coordination is needed. Bindings, not REST |
| Web / testing framework, npm dependencies | **Not selected** — `0003` approves a language and six services, nothing more |
| Other Cloudflare products | **Not approved.** Workers AI, AI Gateway, Agents SDK, Workers for Platforms, Analytics Engine, KV, Hyperdrive each need their own record |
| App isolation mechanism | **Not selected** — `0001` bound it to the stack decision, but `0003` did not approve Workers for Platforms |
| Tenancy model | **Decided** (`0006`, Accepted): **Option A**, one shared production D1 database with mandatory indirection, for the Zero-Cost MVP. B excluded; C is the migration candidate |
| **Cost ceiling** | **USD 0 / BD 0 per month** (`0008`, Accepted). Free allowances only. Applicable D1 limits are **10 databases, 500 MB each, 5 GB total** — not the paid figures |

An approved stack for one repository is not approval for the other, and approving Swift
and SwiftUI is not approving any package or third-party dependency.

### Scheduled but not yet written

1. ~~The logical App permission model~~ — **done.** `0007`, **Accepted 2026-09-01** with ten
   binding rules.
2. The App permission and trust ADR — required before any SDK or runtime work. `0007`
   accepts the *logical model*; it does not decide trust, review or admission.
3. The App isolation mechanism — `0003` settled the stack, and `0008` now prohibits Workers
   for Platforms as paid-only, so this needs a record that reaches a **free** mechanism.
4. Contract transport and versioning mechanics.
5. Break-glass platform-operator access (AZ3) — `platform-admin` was correctly narrowed by
   the CRIT-2 fix and is not operable for support until this exists.
6. How a principal comes to hold an `own`-scope permission (AZ5).
7. **Whether the dependency-free validator extends beyond AZ7 — DEFERRED, not rejected.**
   `qa-agent` observed that both `0011` clauses and the `0012` path grammar are decidable
   without a JSON Schema engine — the lifecycle rule is two-branch key logic and the path
   rule is one regex that can be read from the schema at runtime so it cannot drift. Roughly
   thirty lines. **Deferred deliberately.** `0009` approved *one* module for *one* rule
   family and said in terms that the precedent "cannot grow into a toolchain without a new
   decision"; accreting a second ad-hoc validator is exactly the growth it forbids, and the
   right moment to revisit is when `TS1` lands and there is a real validator story rather
   than two hand-rolled modules. Until then the six fixtures stand as **NOT RUN**
   conformance cases, which is honest. Revisit at `TS1`.
10. **A bound on denied-read audit writes — BLOCKING on AZ2, not optional.** D2 makes every
    denied read a D1 write. Nothing rate-limits an authenticated caller, so sustained probing
    forces unbounded writes into a **single-threaded shared database** — a latency event for
    every other Organization, and a metered spend event against `0008`'s USD 0 ceiling. **The
    probe-detection control is itself an amplification path**, which is the same shape as the
    audit-log oracle it was designed around: the control becoming the vulnerability. Not
    exploitable today only because production ships a deny-all principal resolver and the
    slice is unreachable. **It must be bounded before AZ2 makes it reachable** — a per-actor
    write ceiling, coarse aggregation of repeated identical denials, or both. Do not close
    AZ2 without closing this.

    **Severity raised 2026-09-02, from cost to availability.** `core-agent` found, and the
    Team Lead verified against `d1/platform/pricing/`, that D1's free plan enforces
    **100,000 rows written per day** and that exceeding it means *"you will not be able to run
    queries against D1"* — **account-wide, not per-database, not per-tenant**. So an
    authenticated caller who probes 100,000 times in a day does not merely spend money; they
    **halt D1 for every Organization on the platform**. And the cheapest denial to produce is
    a malformed identifier, which needs no valid customer id at all. The probe-detection
    control is a platform-wide denial-of-service lever until it is bounded.
9. **A Core-wide `AuditDenialReason` taxonomy** — deferred, and deliberately not done as a
   side effect. The D2 denied-read control raised whether denial reasons should carry
   security-specific tokens (`unresolved_identifier`, `permission_denied`,
   `business_not_authorized`) rather than mirroring `ErrorCode`. **Left as is**, because
   `denial_reason` is a Core-wide column: one Action emitting `unresolved_identifier` while
   another emits `not_found` **for the identical condition** would make the column
   polymorphic and break the requirement that every audit record be readable by the same
   query. The proposed tokens also have no home for `conflict`, `failed_precondition` or
   `quota_exceeded`. **The security property is already met without them** — `not_found` is
   unsplit, and a cross-tenant probe and a fabricated identifier differ in no column a tenant
   can read. Revisit as its own record, because it touches every Action.

    **What the current taxonomy costs, established by `qa-agent` and worth keeping:**
    `forbidden` is emitted at **two** denial paths — no permission at all (step 3) and wrong
    Business inside the right Organization (step 5b) — and no other field separates them:
    `target_unresolved` is 0 on both, `related_business_ids` empty on both, same
    `permission_id` and `scope`. So an operator **cannot distinguish "this principal holds no
    grant" from "this principal is probing across Businesses inside its own Organization"** —
    and the second is the in-tenant directory-mapping probe. That is real detection value
    lost, it involves **no cross-tenant disclosure** (both principals are in one
    Organization), and it is the strongest argument for revisiting. The security-critical
    half is unaffected: `not_found` stays unsplit and the oracle stays closed.
8. **Audit-write ordering for irreversible destruction.** Every Action writes its audit
   record *after* the operation succeeds — except a purge, which must write *before*
   destroying the data, because after the purge there is nothing left to reconstruct the
   record from. It currently lives as a narrowly scoped clause in the Customer Directory
   contract (`packages/contracts/apps/customers/`), which is the right place while it has
   one consumer. **Promote it to a record when either happens:** a second App needs the same
   inversion, or Core implements the audit primitive — because at that point the ordering
   stops being one App's rule and becomes a platform property the audit writer must know.
   Do **not** generalise the inversion before then: applied broadly it would make every
   failed mutation leave an audit record saying it succeeded.
7. ~~Wildcard expansion semantics (`0007` D6)~~ — **closed by `0007`'s acceptance.** Binding
   rule 3 prohibits wildcard permissions outright, so there are no expansion semantics to
   define. Rule 5 states the intersection rule whose absence caused CRIT-1.

*Tenancy was item 4 here. It is now decided — see `0006`.*

### Open user decisions

**Decided 2026-09-02, binding, recorded here because they govern work not yet written:**

- **D2 — denied reads are audited.** Every **denied** `GetCustomer` attempt, cross-tenant
  probing included, writes an audit record. **Successful reads stay unaudited.** This is the
  probe-detection control and it does not introduce auditing for successful reads. The record
  carries actor id, actor Organization/business context, action, timestamp, the *requested*
  customer identifier, denial reason and correlation id — and **no foreign customer personal
  data**, because resolving the foreign row to enrich the record would be the cross-tenant
  read the control exists to detect. The external response is unchanged: missing and
  inaccessible remain indistinguishable, so no existence oracle is created. **The audit event
  must not fail open** — inability to record the evidence is surfaced internally while the
  caller still receives the same `not_found`.
- **D1 — the minimal Business table is built next**, in its own focused PR. `Customer.business_id`
  requires it, and without it three of the eight in-scope Actions cannot be fully exercised.
- **Apple deployment target — iOS/iPadOS 18 minimum.** iOS 26 features, Liquid Glass included,
  are reached through **availability checks**, never by raising the floor. The `appiconset`
  stays the shipping path.
- **App icon — the current 57.7% content inset is accepted.** The icon design is **not**
  reopened.
- **C5 (billing guardrails) is required before the first staging deployment**, and not before.
  It is a deployment gate, not a development one.
- **Authentication / AZ2 is the next architecture decision**, after the Core slice and the
  Business table. Until it lands, production ships a deny-all principal resolver and the
  slice is deliberately unreachable.

- ~~**Software license**~~ — **decided 2026-09-01: Apache License 2.0** for both
  `Dudo-Core` and `Dudo-Apple`. Unmodified upstream text, no custom clauses. The
  trade-off was accepted knowingly: it permits commercial reuse by anyone, including
  competitors.
- ~~**The first vertical feature slice**~~ — **decided 2026-09-01: Customer Directory.**
  Create, list, search, view, edit, archive and restore a customer, under strict
  Organization isolation and role-based authorization, with create/update/archive/restore
  audited and one shared contract consumed by Core, web and Apple. Explicitly excluded
  from this slice: invoicing, payments, accounting, leads, sales pipelines, automation.
- ~~Repository creation and remote configuration~~ — **done 2026-08-31.** Both
  repositories are public; `Dudo-Core` has its foundation commit, `Dudo-Apple` is empty
  pending its Xcode project.
- **Publication of the original master-plan PDF** — it stays outside both public
  repositories until approved.

Further open questions are listed in `docs/architecture/boundaries.md` and
`docs/product/vision.md`.
