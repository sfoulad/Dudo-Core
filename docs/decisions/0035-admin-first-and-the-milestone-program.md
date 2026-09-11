# 0035 — Admin-first, full-system scope, and the Milestone 0–6 program

- **Status:** **ACCEPTED — directed by the user (Sameh), 2026-09-08.** This is not a Team
  Lead proposal that the user approved; it is a scope instruction the Team Lead is
  recording. The parts marked **the Team Lead's reading** are the exception, and they are
  marked because they are the parts the user has *not* confirmed.
- **Supersedes:** nothing outright. It **extends** `0030` (full-system scope, continuous
  work, zero cost, expandability) by fixing the **order** in which the system is built.
- **Governs:** what is built next and in what sequence; the boundary between platform
  administration and Organization administration; the retirement of "MVP" as live wording.
- **Requires user approval before it can be fully executed:** Milestone 0 items 4 and 5
  imply npm dependencies and a technology selection (`architecture.md` §6,
  `security.md` §7).

---

## The instruction, verbatim

Recorded in full rather than paraphrased, because `workflow.md` §12's whole subject is what
happens when a record describes a decision instead of carrying it.

> Dudo is now Admin-first and full-system scoped.
>
> Stop treating the administration console as an MVP or a collection of screens. Build the
> complete administration product through Milestones 0–6 in the approved order.
>
> First complete Milestone 0:
> 1. Correct stale repository status and MVP wording.
> 2. Produce the complete Admin capability matrix.
> 3. Resolve the two red repository checks and add them to the required gate.
> 4. Record the scalable frontend-tooling decision.
> 5. Establish shared contract-generated API types and reusable presentation primitives.
> 6. Preserve the strict split between platform administration and Organization administration.
>
> admin.dudo.work remains the platform-operator control center.
> Organization administration belongs under app.dudo.work/settings.
> A platform operator must not gain tenant business-data access merely because we are
> building a "full admin."
>
> After Milestone 0, proceed continuously through Platform Admin, Organization Admin,
> App/Connector Admin, Operations, and all five business-App administration areas.
>
> Production deployments, migrations, secrets, billing changes and destructive account
> operations still require Sameh's explicit approval.
>
> Report only: milestone completed, genuine blocker requiring Sameh, URL/build ready for
> Sameh to test, major security or architecture decision. Do not send routine testing
> narratives or investigation loops.

## What changes

**The administration product is the spine, and it is built complete.** Administration was
previously a by-product — `0010` chose an admin frontend stack, `0025` and `0028` ruled on
what an operator may do and see, and the console grew screen by screen behind the
Customer Directory slice. It is now the **primary line of work**, and "complete" is the
standard: a capability matrix decides what exists, not a backlog of screens.

**"MVP" is retired as live wording.** `0030` withdrew the framing on 2026-09-06 and the
word survived in the repository anyway — in `CLAUDE.md`, in the delivery policy's
filename, in the release record's header, in `0008`'s title. **Withdrawing a framing is
not complete when the prose is struck** (`workflow.md` §12). Every surviving instance must
now either say on its own face that it is history, or go. **A filename is not exempt**:
`docs/product/mvp-delivery-policy.md` is cited by `CLAUDE.md` and by `architecture.md`, so
renaming it is a sweep and not a `git mv`.

**The reporting contract changed.** The user asked for four things and nothing else:
milestone completed · genuine blocker requiring Sameh · URL or build ready to test ·
major security or architecture decision. **This does not weaken any verification
requirement.** QA still verifies before integration, evidence is still recorded, and
*passed / failed / skipped / not run* are still four states — the change is to what
reaches the user, not to what is done or written down. **A blocker is still reported the
moment it is known**, and silence still means work is in flight, never that work is clean.

## What does not change, and none of it is negotiable

| | |
|---|---|
| **Production actions** | Deployments, migrations, secrets, billing, destructive account operations — **explicit approval from Sameh, every time.** Specific, scoped, never carried forward. The directive restates this itself |
| **QA before integration** | Nothing integrates on an agent's own assurance |
| **Release honesty** | Deployed is not accepted; uploaded is not testable; a green run is not acceptance |
| **Milestone acceptance** | The user's alone. Never inferred from silence |
| **Contract-first** | `architecture-agent` authors, the rest implement. An admin screen is a consumer like any other |
| **Zero cost and expandability** | `0008` and `0030`. **The free tier may cost us configuration, never schema** |
| **Tenant isolation** | `security.md` §1. The admin-first scope is the single most likely way to breach it, which is why item 6 exists |

## The split, and why it is item 6 rather than a footnote

**`admin.dudo.work` is the platform-operator control center. Organization administration
lives under `app.dudo.work/settings`.** These are two products that share a word, not two
areas of one product.

**The property to preserve, in the user's words: a platform operator must not gain tenant
business-data access merely because we are building a "full admin."**

This is a real hazard rather than a theoretical one, and the reason is specific to what
Milestone 0 asks for. **The pressure comes from completeness itself.** A capability matrix
that sets out to be exhaustive will produce rows like *"view an Organization's invoices to
diagnose a billing complaint"* — individually defensible, each one a small crossing, and
collectively the end of the boundary. **The answer is not to refuse such rows but to place
them on the tenant side and reach them through an Organization administrator**, or to
refuse them explicitly and say so in the matrix.

**What makes it structural today, and it is worth stating precisely because it is stronger
than a routing rule:** `0024` makes `platform_operator` and `organization_membership`
mutually exclusive, so a platform operator **cannot authenticate to a tenant route at
all** — the refusal is at authentication, not at authorization, and not at the router. The
host binding is a second layer and is not the argument.

**What is NOT yet mechanical, and this is the finding:** nothing stops an author from
adding a *new* route that reads tenant business data and mounting it on the platform host.
`architecture.md` §3a is the applicable rule — *a guard that must be remembered is a
discipline; a guard whose output the write requires is a mechanism* — and the split is
currently a discipline. **This ADR does not claim the split is enforced. It claims it is
*decided*.**

### AMENDED 2026-09-08 — the mechanism is named, and the existing controls miss for a sharper reason than "nothing stops it"

`architecture-agent` delivered item 6 and found that **four controls exist and none of them
catches a fourth tenant-READING service**, because every one is aimed at writes or at the
platform directory:

| Layer | Why it misses |
|---|---|
| `PlatformRouteDependencies` carries no `TenantStoreResolver` (type) | **Defeated by the pattern three accepted exceptions established** — pass a pre-built service in. Onboarding, `directory/` and `credential/` each did, and each addition compiles |
| No module under `platform/core/platform/**` names a tenant primitive (structural assertion) | **All three exceptions sit outside that directory, deliberately.** The check stays green while the property erodes — **its blind spot IS the accepted workaround** |
| `OperatorWriteCharged` receipt (type, `§3a` shape, and genuinely good) | Gates **writes**. A read needs no charge and never touches it |
| Memberless principal → no store handle (authorization-time) | Guards the **class**. The exceptions bypass it by holding a resolver directly rather than by authorizing |

**`0025`'s amendment already said this in its own words** — *"a read would break the property
while looking like the fourth instance of an accepted pattern… That is the line, and it is
invisible to anyone counting."*

> **THE MECHANISM: hand platform-originated tenant access a WRITE-ONLY PORT WITH NO READ
> METHOD.** An append operation and **no `select`, no table name, no predicate, no column
> list, no sort.** The three existing services take it instead of a `TenantStoreResolver`. **A
> fourth service that wants to read cannot, because the port it holds returns no rows** —
> and adding a read becomes a new method on a Core-owned interface, a reviewable diff in a
> named file, rather than a wiring change in a composition root. **Omission does not
> compile**, which is §3a's test.

**The precedent is already in this codebase and already trusted**, which is why this is the
smallest change and not a new idea: `identity/control-plane-store.ts` property 1 is this
device — *"THIS PORT IS NOT A STORE… It is a fixed list of named questions."* This is that,
transposed from the control plane to platform-originated tenant access.

**Ranked honestly, because §3a requires saying which layer carries the weight:** **the port
type carries it.** A structural assertion over the route tables **cannot** work — a route
table records a path, a method, a permission and a field list, and **not what the handler
reads**; the dangerous route is identical to `platform.organizations.read` in every column.
An authorization-time check cannot work — it is already correct and is what the exceptions
do not go through. There is no in-statement guard, because the hazard is the *absence* of a
refusal rather than a wrong predicate.

**What the port does not catch, stated rather than implied:** a service constructed with the
general `TenantStoreResolver` directly in `worker-entry.ts`, bypassing the port. **That is
the backstop's job**, and the existing structural assertion must widen from *"no module under
`platform/core/platform/**` names a tenant primitive"* to *"no module reachable from
`PlatformCompositionInput` receives a general `TenantStoreResolver`."*

**Owner: `core-agent`** for the port, **`qa-agent`** for the widened assertion.
`architecture-agent` proposed it and explicitly did not build it. **Not scheduled into
Milestone 0** — it is the enforcement half of item 6, and item 6's deliverable was the rule
and the analysis, both of which landed.

## Milestone 0 — the six items, with owners

Each item has exactly one owning agent (`workflow.md` §1). File sets are disjoint except
where noted, and the overlaps are serialized rather than run in parallel (§2, §2a).

| # | Item | Owner | Writable set |
|---|---|---|---|
| 1 | Correct stale repository status and MVP wording | **Team Lead** | `CLAUDE.md`, `README.md`, `docs/decisions/**`, `docs/product/**`, `docs/releases/**`, root config |
| 2 | The complete Admin capability matrix | **architecture-agent** | `docs/architecture/**` |
| 3a | `check:source-bytes` → 0, then into the gate | **core-agent**, then Team Lead | `platform/core/**`; then `package.json` |
| 3b | `check:route-fields` → 0 (`0034` phase 3), then into the gate | **architecture-agent** + **core-agent**, one change | `packages/contracts/**` + `platform/core/**` |
| 4 | The scalable frontend-tooling decision | **Team Lead** records (`0036`); **user approved the named set 2026-09-08** | `docs/decisions/**` |
| 5 | Contract-generated API types (`0037`); reusable presentation primitives (`0036`) | **architecture-agent** (generator + contract side), **web-agent** (primitives) | `packages/contracts/**`; `platform/web/**` |
| 6 | The platform / Organization administration split | **architecture-agent** | `docs/architecture/**` |

### Item 3 un-defers a task the user deferred on 2026-09-07

**Stated plainly, because a deferral reversed silently is exactly the residue
`workflow.md` §12 is about.** The control-byte remediation was measured, priced, put to
the user with three options, and **deferred by the user**, with `check:source-bytes`
failing the build as the thing that keeps it visible. **Item 3 requires both red checks
resolved and folded into the gate, so the deferral is over.**

**The cost that justified deferring it has not gone away**, and whoever executes it must
read `workflow.md` §11a first rather than re-deriving it:

- A NUL makes plain `grep` return nothing **silently**, and `git diff` render the file as
  binary with **no hunks** — so these files have been committed unreviewable.
- **A whole-file `Write` is a read-then-write round trip that converts any NUL it passes
  through into a space, with no error.** Only bytes *deliberately* replaced with
  `String.fromCharCode(0)` survive.
- **`pre-auth-admission.ts`'s NUL is inside an HMAC message on the login path.** A wrong
  byte there **silently re-buckets every account**. "It compiles" is not the check;
  behavioural parity is.
- The fixture that reproduces the hazard is preserved, and is a better briefing than any
  prose: `scratchpad/make-nul-fixture.mjs`.

**It is a dedicated pass with nothing else in flight in `platform/core/**`**, verified
three ways: line-level fidelity against the committed blob with control bytes rendered
visible, behavioural parity on the identifier bucketing, and the scanner clean.

### Item 3b must land as one change

`0034` phase 3 removes `identifier` from the route and `target_identifier`'s deprecated
alias from the contract. **The contract half and the route half are owned by different
agents and must land in the same commit** — `check-route-fields.mjs` compares the two and
goes red if they are split, which is the check working rather than a problem. The Team
Lead serializes: `architecture-agent` writes the contract change, `core-agent` writes the
route change, neither holds the other's file, and both land together.

**OD-5, phase 3's precondition, was withdrawn on 2026-09-08 (`0034`, and the ruling in
`organization-detail-v1`).** No telemetry column is to be built. What discharges it
instead: both repositories searched with the empty searches reported, the operator
population told, and the existing platform audit feed consulted.

## Milestones 1–6 — ruled by the user, 2026-09-08, with M6 still unnamed

**The directive named nine areas across six milestones and did not map one onto the
other.** The Team Lead proposed splitting the five business Apps across two milestones.
**The user ruled otherwise:** the five business Apps are **one** milestone.

| Milestone | Area |
|---|---|
| **0** | Foundation — the six items above |
| **1** | **Platform Admin** — `admin.dudo.work`: operators, Organizations, platform audit, templates, platform-wide configuration |
| **2** | **Organization Admin** — `app.dudo.work/settings`: members, roles, Organization profile, Organization audit, Organization-scoped settings |
| **3** | **App / Connector Admin** — installation, capability grants, manifests, lifecycle, Connector configuration |
| **4** | **Operations** — health, limits and free-tier posture, jobs and queues, diagnostics, the runbook surfaces |
| **5** | **Business-App administration — all five**: CRM, Finance, Projects, Inventory, HR |
| **6** | **NOT YET NAMED BY THE USER.** |

> **`M6` IS DELIBERATELY EMPTY AND IS NOT AN OVERSIGHT.** The user's ruling is that M5
> holds all five Apps, which leaves a sixth milestone the Team Lead has not identified and
> the user has not yet stated. **It is recorded as unnamed rather than guessed at**, and
> **rather than left as a conditional for a future reader to resolve** — `workflow.md` §12
> is explicit that a clause of the form *"if X is decided the other way, this is wrong"*
> creates an obligation nobody is assigned to collect. **The obligation here is assigned:
> the Team Lead asks the user what M6 is before M5 begins, and not before**, since nothing
> in Milestones 0–4 depends on the answer.

## The staging finding — RULED by the user, 2026-09-08

**The finding.** There is no staging environment, and the live deployment is on the real
`dudo.work` hostnames. Neither `wrangler.jsonc` nor `wrangler.admin.jsonc` defines an
`env`, while `package.json` carried `"deploy:staging": "wrangler deploy --env staging"` — a
script pointing `--env` at a target that exists in neither config. `workflow.md` §11
required that a web release go to **a test or staging environment — never production**, and
no deploy so far had met that requirement.

**The ruling: `dudo.work` IS the test environment.** Named as such in the rules and in the
release record; the `deploy:staging` script that points nowhere is removed. Revisited
before the first real customer, which is the event that makes it wrong.

**What this changes and what it does not:**

- **It changes the words, not the risk posture.** Every deploy still requires the user's
  explicit approval, every time. Nothing ships by accident because the environment now has
  an honest name.
- **It costs nothing on the free tier**, which is why it is available: a second Worker with
  its own D1 databases would have consumed the same `0008` allowance and needed its own
  impact check.
- **It is true only while there are no real customers.** The day one exists, `dudo.work`
  stops being a test environment **whether or not anyone updates this paragraph** — which
  is precisely the residue `workflow.md` §12 describes. **The trigger is therefore recorded
  as an event with an owner**: the Team Lead reopens this before the first customer
  Organization is onboarded outside our own testing.
- **"Test environment" is not a licence to be careless with data in it.** `security.md` §6
  still requires synthetic data everywhere.

> **THE RULING NAMES THE THREE SUBDOMAINS AND NOT THE APEX, AND THAT DISTINCTION IS
> LOAD-BEARING.** Clarified 2026-09-08 after `qa-agent` reported an apparent contradiction
> and — correctly — refused to resolve it by weakening a guard.
>
> `packages/testing/verify-staging.ts`'s `PRODUCTION_SHAPED` list refuses
> `https://dudo.work`, `https://www.dudo.work` and `https://dudo.work/api`, while
> `admin.dudo.work`, `app.dudo.work`, `*.workers.dev` and localhost all pass. **Measured
> against the real patterns rather than reasoned about.**
>
> **There is no contradiction. The refusal is confined to the apex and `www`, and this
> ruling covers neither** — `wrangler.jsonc` and `wrangler.admin.jsonc` bind only the three
> subdomains, and `0022` deliberately left the apex undecided rather than pointing it at the
> application by accident. **The guard stands, unchanged**, and its
> `--i-know-this-is-not-staging` escape hatch remains a true statement about the apex.
>
> **Two things `qa-agent` got right that are worth copying.** It stated the conflict **as
> narrowly as it actually was** rather than as "the guard contradicts `0035`" — the narrow
> version is what made it resolvable in one reading. And it declined to edit a
> production-safety refusal on the strength of a ruling it had **second-hand through the
> Team Lead**, noting that this ruling's own text says it holds *only while there are no real
> customers*, so **the guard's value returns rather than expires.** An agent refusing to
> weaken a safety check on relayed authority is the behaviour `security.md` §8 exists to
> produce.

## Consequences

- **`CLAUDE.md`'s "Current state" was rewritten on 2026-09-08** and the section it replaced
  was wrong in every paragraph. Item 1 is not paperwork: the stale text said no application
  code existed, which is the kind of sentence that sends an agent to build what is already
  there.
- **The capability matrix becomes the plan of record for Milestones 1–6.** If it is
  incomplete, the milestones are incomplete in the same shape, and nothing will go red.
  That is why item 2 requires the examined population reported against an independently
  derived expectation (`workflow.md` §11a).
- **Two red checks joining the gate makes the gate meaningfully stronger** — and until they
  are green they stay out of it, because a red gate folded into a green one makes the green
  one worthless.
