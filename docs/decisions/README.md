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
| `0013-bounded-denial-auditing-and-rate-limits.md` | **Accepted** | Bounds the denied-read audit `D2` mandates. A SQLite-backed Durable Object coordinates summary writes on an emission ladder, grouped by `(organizationId, principalId, appId, actionId, category)` in 15-minute windows, with a platform ceiling of 5,000 summary writes/day. **One audit write per denial would let 100k probes exhaust D1's account-wide daily write limit** — the control would have become the outage. |
| `0014-authentication-az2.md` | **Accepted** | Authentication in three parts: **§A** daily D1 write admission (80,000/day, split 60k business / 10k security / 10k system); **§B** the pre-authentication entry-point registry — a closed set of five, each permissionless route admitted only if it carries rate limiting; **§C** the identity control plane. Amended by `0017` for the closed beta. |
| `0015-credential-format-and-session-credential.md` | **Accepted** | **§A** session credential `<session_id>.<HMAC truncated to 128 bits>`; **§B** 12-hour sessions, no rotation; **§C** timing controls; **§D** the **client-side KDF** — the browser runs 600,000 PBKDF2 iterations and the server hashes the result at 10,000, because the Workers 10 ms CPU budget cannot fit a properly tuned KDF (600,000 measured at ~72 ms). **Amended 2026-09-04:** the password is **NFC**-normalised (RFC 8265 PRECIS `OpaqueString`) — the identifier uses NFKC, the password must not, and confusing them destroys entropy the user believes they have. |
| `0016-web-application-stack.md` | **Accepted** | React 19 · TypeScript · Vite · Tailwind v4 · shadcn/ui, built to static assets on Workers Static Assets. **Requests to static assets are free, unlimited, and do not invoke the Worker**, which inverts the usual SSR default under Dudo's ceilings. **First decision to approve npm dependencies.** **Amended 2026-09-04:** §5's blanket prohibition on `run_worker_first` was wrong — it was written against the boolean form; the scoped array form is required, or API routes are rewritten to the SPA shell and answered `200`. |
| `0017-pre-auth-rate-limiting-for-closed-beta.md` | **Accepted** | Accepts the **in-process** pre-auth limiter for the closed beta, amending `0014` §B. Per-isolate limits are a real weakening, recorded rather than assumed. **The honest basis is that rate limiting is not what protects these accounts — password entropy is**, so seeded credentials must be machine-generated and the decision expires the moment any password is human-chosen. Staging only; the durable limiter must first address the 100,000/day DO budget it would share with the authenticated coordinator. |

| `0018-session-revocation-carriers-and-cookie-clearing.md` | **Accepted** | Amends `0014` §B twice, for two contradictions already sitting in merged code. **§A** revocation accepts `Authorization: Bearer`, not cookies alone — a Bearer-only client could otherwise call logout and be told `acknowledged` while nothing was revoked. **§B** adds a `cleared` outcome emitting a constant, argument-free clearing cookie; today's clearing branch is **unreachable**, so logout deletes the session row and leaves a dead cookie for up to 12 hours. **Records the real budget: logout costs 3 row-writes like a login, so a login+logout cycle is 6 — 500 cycles/day platform-wide, not 1,000 sessions.** |

| `0019-where-permission-grants-live.md` | **Accepted** | Closes the **grants** half of AZ5, open since `0001`. A `role` on the membership row — not a grant table, because one row per permission per principal is decisive against `0008`'s write ceiling while a column costs **zero additional rows**. Closed union of literals; each role maps to an explicit frozen list of Actions — **no wildcards, because a role is exactly where one gets smuggled back in**. On the *membership* row, never on `principal`, since a principal may belong to several Organizations. **Contains a struck, visible Team Lead error:** it claimed to be "the last thing" before a working business request and was not. |
| `0020-authorized-business-set.md` | **Accepted** | The **second** half of AZ5, and completes `0019`. `authorizedBusinessIds` was `[]`, so a principal passed the permission check and failed every Action one step later. Amends `0014` §C.5 by **splitting** the authorized context — the resolver needs the *Organization*, only the business set needs the *store*, so the dependency was never circular. Computed **per request, never cached**: a 12-hour session cache would keep a removed Business authorized for half a day. Spends a D1 **read** (5M/day) rather than a **write** (100k/day). |

| `0021-session-routes.md` | **Accepted** | A **third request class**: authenticated at the session level, resolves a session and **stops** — no principal, no tenant, no permission, no `invokeAction`. Created because the Organization picker was a **deadlock as an ordinary Action**: the pipeline resolves the principal first and fails with `failed_precondition` when none is selected, so the route was unreachable *precisely and only in the state it exists to repair*. Refuses two shortcuts — a null-tenant pseudo-principal and a tenant-optional pipeline branch — because **"the invariant that an Action always has a tenant is worth more than the code it saves."** |
| `0022-subdomain-structure.md` | **Accepted** | Three hostnames: `app.` serves the web application **and its API on one origin**, `admin.` the console, `api.` the machine surface for Bearer clients. **The API is deliberately not split off from the app**: the session cookie is host-only, so a `Domain=dudo.work` cookie would broadcast a session credential to every subdomain that ever exists. **Amended 2026-09-05:** admin **is** a second Worker — Cloudflare permits only one asset collection per Worker, and it runs the same Core rather than a static shell, for the same host-only-cookie reason. |
| `0023-core-owned-actions.md` | **Accepted** | Core gains its **first Action definitions** — until now it held the machinery and zero definitions, and the web client called a route that had never existed. A **Core-owned permission envelope**, because making the Customer Directory declare a platform capability would mean one App's manifest gates it and a second App must remember to. Records the **role-vocabulary fork** and its trigger: reconcile **before a second App exists**. |
| `0024-platform-principal-isolation.md` | **Accepted** | **A memberless super admin is structurally incapable of reading tenant data** — no membership → no selection → no store handle → no `whereWithTenant` → no rows. **And the trap:** `scope.ts` ranks `platform` at 0, so a *membership row* carrying platform authority passes authorization everywhere and the storage boundary then politely serves that tenant's rows. **Cross-tenant access assembled entirely from legitimate parts, which no review would catch.** Two invariants, both enforced in code: a platform principal holds **zero** membership rows, and `MembershipRole` never gains a platform-tier value. |
| `0025-platform-authority-templates-and-platform-routes.md` | **Accepted** | Platform authority lives in its **own table** — existence is the authority — because an invariant depending on nobody adding a row is not an invariant. A business type **IS a `Template`**, already one of five closed extension types; it may **name Apps and carry labels, never contain logic**. A **fourth request class**: principal-level auth, no tenant, evaluates a permission. Plus a **bounded exception to `0007` D11** — onboarding grants an `owner` role the operator does not and cannot hold, which is establishment rather than delegation — and the **platform-operator action log**, separate from the tenant trail because an operator action spans tenants by nature. **Amended 2026-09-05:** the `Workspace` rename is **four changes, not one** — `business_id` is also a **published wire field two clients shipped against** and a **persisted audit value**, so renaming it is a breaking contract change plus an audit rewrite, deferred to its own slice. Two vocabularies for one concept, accepted deliberately, closing before a second App uses the word. |
| `0026-confirmation-and-the-sensitivity-ladder.md` | **Accepted** | `architecture-agent` reported that two contracts were **unreachable as written** rather than requesting the one-line exemption that would have hidden it. Split along the line that keeps the ladder meaningful: **`core.organization.create` drops to `sensitive`** (an empty tenant, nothing destroyed), **`core.credential.reset` stays `critical`** — it is **account takeover with a legitimate front door**, and *a ladder whose top rung is vacated whenever it blocks something has no top rung.* Also: the `422` defect `web-agent` disproved while implementing against it, the **client flow inverting** now that no session is ever auto-selected, and **`ON-5`/`CR-5`** — the operator's browser derives, so the server still never sees a password. Records two costs nobody had written down: **the operator sees the new admin's password**, and **there is no self-service password change**, so every tenant admin's credential is known to whoever onboarded them, forever. |
| `0027-the-confirmation-mechanism.md` | **Accepted** | The mechanism `0007` D15 has required since it was written and which never existed — why `DeleteCustomer` is granted to no role. **Confirmation must prove two independent things:** intent (a server-authored statement bound to an echoed token) and presence (re-authentication with the existing login KDF). *Typing DELETE proves the first and not the second; a password prompt proves the second and not the first;* **most products ship one and describe it as both.** Re-authentication rather than MFA because `MfaFactor` has no table and no code — *specifying it would ship a control that is a comment* — with the ceiling recorded: **exactly as strong as the password, not two-factor, never to be called that.** Generalises D15's AI clause into the better rule: **the party being constrained does not author the statement of the constraint.** **`CF-4` ruled against the contract's own recommendation:** an English statement of an irreversible action in a market that reads Arabic means the intent half is simply absent — but letting the client render the translation reopens `CF-2`. Localisation needs the client to **choose** a language, not render the text. |

| `0028-what-an-operator-may-see.md` | **Accepted** | **No member list, because the transpose of the permitted read is the forbidden one.** `CO1` forbids principal → Organizations; a member list gives Organization → principals — and **an operator can enumerate every Organization from its own home screen**, so inverting per-Organization lists reconstructs the forbidden mapping. **Neither permission discloses it alone; the pair does, with no rule broken at either step.** The baseline: `0001` refused an email column outright, and **a member list is that directory minus the addresses, assembled at read time.** Replaced by a targeted resolve — *an operator resolving an identifier they were given is support; one receiving a list they did not ask for by name is surveillance.* **The audit read nearly undid all of it**, since every resolve leaves a membership fact in the log and a bulk read aggregates them **as one request the tenant cannot see** — *the control becomes the leak.* Closed with two feeds where the scoped one writes a tenant-side record, so **the back door is the same size as the front one rather than forbidden by a rule.** Also: **an ignored parameter is one someone will later honour**, so a `target_principal_id` filter is refused rather than ignored. **Amended the same day:** `core.audit.read` has no route, so the tenant-visible records are **written and unreadable** — this surface is auditable rather than audited. **Amended again:** *"rate limited"* is false — one operator could spend **100% of a named customer's daily write allocation**, because the tenant write happened before the operator was charged. Fixed; half the residual's four terms are now struck. |
| `0037-contract-generated-api-types.md` | **Accepted — user-directed** | **A first-party YAML-to-TypeScript generator, zero dependencies** — the `0009` answer to the same question for a different consumer. **NOTHING IN THIS REPOSITORY EXECUTES THE CONTRACTS**: no validator, no generator, the YAML is read by people, so every client type is hand-written from a document no tooling checks. **`0034` is what that costs, already paid once.** Chosen over `json-schema-to-typescript` because our schemas are a small closed subset, and because a first-party generator can **REFUSE TO EMIT** for a contract missing a request shape, a response shape, error cases, an authorization expectation or a tenant scope — turning a documentation gap into a build failure. **The cost is owned honestly: a generator that emits plausible-but-wrong types is WORSE than hand-written ones, because it carries the authority of having been generated.** Output is **committed, not built on the fly**, so a contract change's effect on the client surface is visible in `git diff`. **A drift check regenerates in memory and diffs, reports its population against an independently derived total, and ships with a deliberately-stale fixture** — because *"42 contracts read, 42 emitted, 0 differences"* is a check and *"0 differences"* is a number that reads identically when the glob has stopped matching. **Swift is named as OWED, with an owner and an event**, not left implicit: the Apple client cannot consume TypeScript, `§1` says a shape one client has and the other does not is a **contract defect**, and `0034`'s drift therefore stays live on the Apple side until the emitter exists. |
| `0036-frontend-tooling-at-admin-scale.md` | **Accepted — user-directed** | **Six libraries, named, approved in ONE approval, pinned exactly: shadcn/ui · TanStack Router · Query · Table · React Hook Form · Zod.** `platform/web/` had React, Vite, Tailwind and **no router, no data layer, no table, no form library** — the right answer for one login flow and the wrong one for five milestones of admin screens, where rebuilding the same four concerns per screen is how a console becomes a collection of screens. **A seventh library is a new approval, however small.** **shadcn/ui is COPIED IN, not a dependency** — that is why `0010` chose it — **and it pulls Radix transitively, stated here so nobody learns it from the lockfile.** Three boundaries do not move: business rules stay in Core (**a client validator checks SHAPE and decides nothing**); zero cost is unaffected because **static assets do not invoke the Worker and are free and unlimited**, so bundle growth costs nothing we pay for; and this is **configuration, never schema** — *a table library must never become the reason a column exists.* **The trap Zod invites is named:** "the client validates the request" becomes "the client knows which fields are required" becomes a rule in two places — **a hand-written Zod schema restating a contract is `0037`'s defect wearing a validator's clothes.** And the shared primitive layer spans both administrations, so **it must carry NO AUTHORITY**: a component that renders a member row is shared; one that decides whether the viewer may see it is not. |
| `0040-shared-client-packages-and-npm-workspaces.md` | **Accepted** | **TWO shared packages, not one, and the reason for two IS the decision.** `platform/web` and `platform/admin` were **separate npm packages with separate `node_modules`, nine UI modules against two, and none of `0036`'s six libraries in admin** — so *"a single primitive layer on both hosts"* was **false the day it was written** and nothing went red. **One package would have been simpler and would have quietly destroyed the no-authority rule:** put credential derivation beside a button and "the shared package" becomes a place where both live, at which point importing something that DECIDES from it breaks no visible rule. `@dudo/ui` carries no authority and `check:ui-purity` moves onto it to cover it alone — **giving a constraint that has been correct and inert since it was written its first subject.** **THE TEAM LEAD PUT A FALSE CLAIM IN THIS RECORD AND IT IS CORRECTED IN PLACE:** *"admin's primitives are deleted, nothing in them to preserve"* — reasoned from two measured files, **wrong about both**, then extended to a third nobody had measured. Admin held **an `onNavy` variant web hand-rolls inline, a `type='button'` default whose absence makes web's buttons submit forms, and `role="alert"` on field errors with fifteen lines of rationale** — a **live accessibility gap**, since those messages are set on submit when focus is elsewhere and web announces them **not at all**. **A decision record is the worst place for such a claim, because the next agent EXECUTES it rather than checking it**; nothing was deleted only because "confirm the subset first" travelled with the instruction. The `Field` conflict — admin's assertive role has a precondition web's live re-validation violates — is settled by an `announce` prop defaulting to `polite`, **so the precondition travels with the value instead of living in a comment on one host's copy.** **Order inverted on `web-agent`'s objection:** pin admin FIRST, then add the root key — *"same change"* spanned two owners, and **pinning first eliminates the caret-hoist window rather than shrinking it.** |
| `0039-request-class-is-declared-not-inferred.md` | **Accepted** | **A contract DECLARES its request class; nobody infers it from a key name** — and this record exists because a Team Lead ruling was falsified by the measurement it asked for. Contracts spell their operation list three ways (`actions:` / `operations:` / `entryPoints:`); the Team Lead ruled these were three real route classes and **told `architecture-agent` to contradict it if the mapping failed. It did: there are FOUR classes and three keys** — `operations:` covers the platform class **and** the session class, so a reader inferring class from key gets `organization-selection-v1` wrong today. **A fourth key name was refused**: it encodes the same property the same implicit way and is stale on the next class. **The problem is a STRUCTURAL key carrying a SEMANTIC property, and no number of key names fixes that.** **Amended within hours and the amendment strengthened it:** `login-v1`'s seven unpredicted refusals were the TOOL twice, not the contract — a fourth response spelling (`successBody:`) and a presence check written as a value check — **and `successBody:` is evidence FOR the ruling, since an entry point returns a body AND MAY SET A CREDENTIAL where an Action has an output.** *It is not three key names, it is **three vocabularies**.* Also resolves the `.session` id divergence: **dropped, and the Team Lead's stated reason marked WRONG in place** — `.session` appears in **four ids across two classes** and in the pre-auth pair it is the **resource being acted on**, so dropping it removes an **ambiguity** rather than a redundancy. **`§1a` arriving in an identifier instead of a request field.** The rule lands at the site because *"whoever adds the next session route will copy `identity.session.refresh` by analogy, and it returns LOOKING LIKE CONSISTENCY."* **Phase 3's trigger FAILS THE RUN rather than sitting in a comment** — `§11a`'s closing line implemented rather than quoted. |
| `0038-two-milestone-2-preconditions-whose-triggers-have-fired.md` | **OPEN — no decision taken** | **Two things block Milestone 2, and the Team Lead got the first one wrong in this very file before correcting it in place.** **F-1: twelve tenant-scope `critical` permissions are unreachable, fail-closed** — the confirmation lock is fitted on both surfaces and only the platform surface has a key. **Originally recorded as a deliberate deferral whose premise had expired. It is not.** `confirmation-v1` is **`accepted`** and its `theTWOCHALLENGEROUTES.ruling` requires **two** challenge routes, one per class; Core built one, and `confirmation-service.ts`'s own header says it was written for both. **THE GOVERNANCE FINDING IS LARGER THAN THE MISSING ROUTE: a normative clause of an accepted contract was set aside by a COMMENT IN AN IMPLEMENTATION FILE** — well-argued, uncited, and therefore unfindable by anyone sweeping the contract. `§3c` from the other side: a comment that *cites* a contract is checkable; **one that silently overrides a contract offers nothing to check.** The Team Lead then reproduced the override at one remove, quoting the comment accurately. **So F-1 is a BUILD ITEM, not a design question** — `core-agent`, against an accepted contract, no new record needed; the comment's caution about `Action.permission` becomes a `security-agent` review rather than a reason to defer again. **F-2 is the real design question:** `core.organization.read/update/delete` name control-plane objects, so an Organization cannot read or edit its own record and an operator transcribes a customer's legal name, CR and VAT **on their word, forever**. `OI-1` closes with *"Not this contract"* — an obligation nobody was assigned to collect until `0035` assigned it. **`OI-1`'s two halves disagree and the `recommendation` is the accurate one** (`§3b`): the `question` states a law (*"no Action can reach it"*), the `recommendation` proposes designing exactly that, and the real enforcement is `control-plane-store.ts` property 4 — **a property of the composition root and of who may construct an adapter.** The `CO1` hazard is about a **general handle**; a narrow named-question port carries neither consequence, so the counter-argument is **bounded rather than a wall.** Neither blocks M0 or M1. |
| `0035-admin-first-and-the-milestone-program.md` | **Accepted — user-directed** | **Administration is the spine now, and it is built COMPLETE through Milestones 0–6** — not an MVP, not a console, not a collection of screens. Extends `0030` by fixing the **order**; withdraws nothing. **"MVP" is retired as live wording**, and the sweep includes a **filename** two rules of record cite, so it is a sweep and not a `git mv`. **The split is the load-bearing clause:** `admin.dudo.work` is the platform-operator control center, Organization administration lives at `app.dudo.work/settings`, and **a platform operator does not gain tenant business-data access because we are building a "full admin."** `0024`'s mutual exclusion refuses that at **authentication**, not at the router — but **nothing stops a new tenant-data route being mounted on the platform host**, so the split is currently a *discipline* and this ADR claims it is decided rather than enforced (`§3a`). **The pressure comes from completeness itself:** an exhaustive matrix generates individually-defensible crossings that collectively end the boundary. **Item 3 un-defers the control-byte remediation the user deferred on 2026-09-07** — stated plainly, because a deferral reversed silently is `§12`'s residue; the cost that justified deferring it is unchanged, including the `Read`→`Write` round trip that turns a NUL into a space with no error on the **login path's HMAC separator**. **Milestones 1–6 are the Team Lead's reading of nine areas across six milestones, NOT the user's confirmation**, recorded so a wrong assumption is visible rather than buried. **Open finding, not resolved here: there is no staging environment** — neither wrangler config defines an `env`, `deploy:staging` points at a target that does not exist, and every deploy so far went to the real hostnames, which `workflow.md` §11 forbids. |
| `0034-retiring-a-published-field-name-in-three-phases.md` | **Accepted** | **Widen, switch, narrow — how a published field name is retired without an outage.** `platform.organizations.members.resolve` declared `identifier` while its contract published `target_identifier`: `§1a`'s rename half-landed, credential reset got it and the resolve did not. **The deployed console sends `identifier`, so the route works in production because the client read the code rather than the contract** — `§12`'s state where a contract has stopped being the source of truth. Found by `check-route-fields.mjs` on its first run, which is the argument for building the check rather than fixing the instance. **Renaming Core alone is a server refusing a field the deployed client sends — a shape that arrived three times in one day and got the same answer each time.** Changing the contract to `identifier` instead is the one-line fix and is **refused**: it re-opens the defect `§1a` closed, which would have returned `forbidden` on every well-formed request, permanently. **Both fields present is refused rather than preferring one** — if the values differ, silently choosing is choosing which principal to resolve. Phase 3 is `OD-5`, triggered by an event rather than a date, and discharged in **one** change because the checker compares both sides. **The population is one, not the several the Team Lead expected**: no contract publishes a bare `identifier`, and that empty search is the load-bearing finding. |
| `0033-contracts-state-the-shape-not-the-figure.md` | **Accepted** | **A contract states the shape and the constant's NAME; the figure is marked as derived.** Every stated row-write cost was a transcription of a Core constant into a file that cannot see it, with nothing comparing them and **no failure when they diverge** — a sweep found ~30 stale statements across nine contracts after one migration added two indexes. **Two were wrong before that migration touched them, because they omitted the audit record entirely**, so a uniform correction would have left the set internally consistent and externally wrong. `template-v1` carried **two independent errors in one number**, which no delta of any size would have fixed. **Accepted on evidence from one file on one day:** the measured capacity model read the constant from the live schema and printed the new value with no edit, while the hand-transcribed table beside it stayed wrong — in a section whose own header had predicted that these figures move. **Acceptance does not convert the remaining eight**: a corrected transcription is still a transcription. |
| `0032-accepting-the-phase-0-standards.md` | **Accepted** | **The nineteen Phase 0 standards become binding.** They had carried *"Draft for Team Lead review. Binding on acceptance, not before"* since they were authored — before any code existed — so they bound nothing while governing two days of work informally. **Accepted with the eighteen contradictions MARKED rather than fixed first**, because several cannot be resolved without deciding one of the six roots, and *a standard nobody has accepted binds nobody while it waits.* The marking records **which side is wrong and why**, in the file, found by a pass that read the corpus against running code — not repeatable at will. Three findings shape what follows: **the first App bypasses an SDK that does not exist** (so the one App that exists proves nothing about whether the App boundary works, because it does not use it); **a class of "enforced structurally by the schema" claims is false in four places**, two of them inside the section written to police that exact distinction; and **the corpus excuses itself against a system that now exists** — *"Phase 0 has neither a runtime nor tenant data"* is false in both halves. Leaves six roots open, of which **`R2` (tenant-scoped secret store) and `R6` (the App permission-and-trust ADR) block the most work and are architecture's**, so neither waits on a budget. |
| `0031-what-a-template-does-and-two-console-rulings.md` | **Accepted** | **Organization identity — a name, the Bahrain CR, and VAT — entered by an operator and stamped with who checked them.** Added to this record 2026-09-07, after the work had shipped and **fourteen artifacts were already citing `0031` as its home**; the citations were right about where it belonged and the record was the thing missing. **Sijilat could not be integrated with: there is no Sijilat API and no NBR API**, so what was built is the shape a real integration would later fill rather than a placeholder. The load-bearing consequence: **`verified: true` is an operator's claim Core cannot check**, so it is stored as a provenance record — who checked, and when — not a boolean a reader could mistake for server validation. **`sensitive`, not `critical`:** the argument for gating VAT generalises to the CR and to the display name on an invoice header, and a ladder whose top rung holds everything sorts nothing; the control acts at the point of harm instead, so a future document surface **must** refuse to render an unverified value — **an obligation that does not exist yet and is owed.** Plus: **A Template decides which Apps an Organization gets** — a business type whose choice installs an App set with defaults. Closes `TM-4`, which was asking what a Template *is*: not a tag, not a reporting dimension, not field defaults. **Specified now and built when Apps exist**, deliberately in that order, because the alternative is that the first App runtime invents the Template model as a side effect of needing one — and *"which Apps does this Organization have"* must be answered the day a second App exists. **It makes `TM-1` and `TM-2` harder rather than easier:** a labelling Template can change freely, but **one that decides an App set has consequences for every Organization attached to it**, so changing one becomes a migration of installed software. Also ratifies **UTC-day audit filters** — an audit trail is evidence read by more than one person, and two operators discussing "the 5th" must mean the same window; the Bahrain +3 offset is accepted *because it is visible rather than silent*. And **declines `axe-core`/`jsdom`**, recording what that does NOT close: no screen reader has run, nobody has viewed the console right-to-left, nobody has tabbed through it, and the tooling would not have closed any of the three. |
| `0030-full-system-zero-cost-and-expandability.md` | **Accepted** | **The MVP framing is withdrawn; the target is the full system** — Core, both clients, the capability registry and SDK, Connectors, and the business Apps. **Milestone acceptance replaces the seven-step per-feature gate**, but production actions still need explicit user approval *every time*: that gate was not an MVP concession, and on the day before this decision it caught a targeted denial-of-service, a confirmation binding that covered nothing, and four unsatisfiable request shapes. **Zero cost continues (`0008`) with expandability now binding beside it:** *the free tier may cost us CONFIGURATION, never SCHEMA.* A limit worked around by a setting or a ceiling is reversible; **one worked around by changing the shape of the data is paid for once and then forever.** Names the violations concretely — denormalising to save row-writes, aggregating away source rows, omitting an audit record because it costs five writes, assuming exactly one database exists. **`0006` is the pinch point and is deliberately not reversed**: it chose one shared database *"for the Zero-Cost MVP"* and that premise is gone, so what is required is that the choice stays **reversible**. Also settles the naming confusion that gates the vision: **Workers is free, Workers for Platforms is a different paid-only product**, and it blocks only third-party code execution — not tenancy, not Apps, not the capability model. |
| `0029-the-confirmation-binding-covers-path-parameters.md` | **Accepted** | **A confirmation minted to revoke operator A would have been spendable on operator B.** `platform-operators-v1` promised the opposite, and the sentence carrying that promise was true in its premise and false in its conclusion — *"the parameters are the body minus the three fields, **so** the binding covers `principal_id`"* — but that route's body carries **only** those three fields, so the binding was the **empty object**. **Caught by a load-time guard, not by review**: a reviewer checking whether the target was bound found a sentence saying it was, and stopped. The bound object becomes body-minus-three **union the route's declared path parameters**; moving the target into the body was rejected because **a body/path pair is a precedence rule, and a precedence rule is where a caller shadows a value a reviewer assumed was authoritative.** It adds **no new list**: the path template *is* the declaration, and a client constructing the URL already holds it. **The guard inverts** — it refused path parameters, it must now require them bound — because the old rule was *correct for a reason that expired*: the requirement was never "no path parameters" but **"nothing outside the binding."** Free at exactly one moment, with **zero consumers**, because no gated route existed yet. **The residue was in the test list**, where §12 predicts it: the case labelled *the central test of this contract* varies a **body** field and is **not constructible** on this route — a green run over the exact defect. |

### Technology stack status

| Scope | Status |
|---|---|
| `Dudo-Apple` | **Approved** (`0002`): Xcode, Swift, SwiftUI; iPhone, iPad, macOS; true native macOS destination, never Mac Catalyst |
| `Dudo-Core` | **Approved** (`0003`): TypeScript on Cloudflare — Workers, D1, R2, Queues, Workflows, and Durable Objects only where real coordination is needed. Bindings, not REST |
| Web framework and npm dependencies | **Decided** (`0016`, Accepted): React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, served as static assets. **npm dependencies enter Dudo here** — previously reserved to the user, approved under explicit delegation |
| Testing framework | **Still not selected.** Choosing Vite did **not** choose Vitest. `qa-agent`'s dependency-free runner stands until TS1 is decided on its own merits |
| Pre-auth rate limiting | **Interim** (`0017`, Accepted): in-process, per-isolate, **closed beta and staging only**. The durable limiter is owed and must carry its own §6a free-tier impact check |
| Other Cloudflare products | **Not approved.** Workers AI, AI Gateway, Agents SDK, Workers for Platforms, Analytics Engine, KV, Hyperdrive each need their own record |
| App isolation mechanism | **Not selected** — `0001` bound it to the stack decision, but `0003` did not approve Workers for Platforms |
| Tenancy model | **Decided** (`0006`, Accepted): **Option A**, one shared production D1 database with mandatory indirection, for the Zero-Cost MVP. B excluded; C is the migration candidate |
| **Cost ceiling** | **USD 0 / BD 0 per month** (`0008`, Accepted). Free allowances only. Applicable D1 limits are **10 databases, 500 MB each, 5 GB total** — not the paid figures |

An approved stack for one repository is not approval for the other, and approving Swift
and SwiftUI is not approving any package or third-party dependency.

### Scheduled but not yet written

**Added 2026-09-04 from the AZ2 slice — recorded so they survive, not started.** The completion gate
forbids beginning the next feature before the user accepts this one, so these are captured here and
nowhere else:

- **`selectOrganization` has no HTTP entry point. THIS BLOCKS THE PRODUCT TODAY.** It is a
  `SessionResolver` method with no route. Found by `app-agent`; **severity corrected 2026-09-05
  after deployment.**

  The original entry here said it *"does not bite while every principal belongs to exactly one
  Organization."* **That was wrong.** A session is created with `organization-not-selected`
  regardless of how many Organizations the principal belongs to, and `login.ts:219` states the
  consequence plainly: *"every business Action answers `failed_precondition` until an Organization
  is selected."*

  **Confirmed against the live deployment:** a seeded `owner` logs in successfully (200, session
  cookie issued) and every Customer Directory request then returns **422 `failed_precondition`**.
  Login works; the product does not. Needs a contract and therefore `architecture-agent`.

  **The lesson is the estimate, not the gap.** A missing route was recorded as latent when it was
  blocking, and only deploying it revealed which — the same reason the gate refuses to call a
  stub-verified slice complete.
- **`Idempotency-Key` on create (CD-4).** Recorded as owed. Without it, a retried create after a
  network failure produces a **duplicate customer**, and the contract explicitly does not
  deduplicate on name or email. Surviving the retry requires client-side persistence, so it is a
  small slice of its own rather than a line of code.
- **The role / permission-catalog vocabulary fork — `0023`, and it has a trigger.** The catalog
  describes six seed roles; `roles.ts` implements two. **This has now caused three deadlocks**
  (`0019`, `0021`, `0023`), each closed by adding a permission to both roles. **It must be
  reconciled before a second App exists**, because that is the point at which "add it to both
  roles" stops being a small change and becomes a fork.
- **No audited path for a role or permission change.** `0007` rule 9 requires it; `0018`, `0019`,
  `0020` and `0023` each record its absence. Operator SQL and Organization creation have the same
  gap.
- **The authorized-business list is unpaged** (`0023`). `next_cursor` is always null, because paging
  needs an offset into a set `0020` rebuilds per request. Bounded at 500 and 100, so **a principal
  authorized over more than 100 Businesses cannot reach the rest** — a real truncation, invisible
  to the caller.
- **OS-1 — no rate limit on the session route class** (`0021`), owed before any non-operator user
  alongside `0018`'s reserved allocation for revocation.
- **A durable pre-auth rate limiter**, owed by `0017`, which must first answer the shared
  100,000/day Durable Object budget question recorded in `free-tier-register.md`.
- **A reserved write allocation for revocation**, owed by `0018` — binding before any non-operator
  user, so that logout cannot be starved by business writes.
- **An audited path for role changes and for Organization creation.** `0019` and `0018` both record
  that an operator applying SQL by hand produces no audit record, which `0007` rule 9 requires.

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
