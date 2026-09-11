# 0036 — Frontend tooling at admin scale, and the presentation primitives

- **Status:** **ACCEPTED. The named dependency set was approved by the user (Sameh) on
  2026-09-08**, in answer to a direct question that listed it. Milestone 0 item 4, and the
  presentation-primitives half of item 5 (`0035`).
- **Closes:** `0010`'s *"no dependency is installed, no code is written"* hold, for exactly
  the libraries named below and nothing else.
- **Owning agent:** Team Lead records. **`web-agent` implements** and is the only agent that
  installs.
- **Depends on:** `0016` (React SPA on Workers Static Assets), `0010` (admin interface
  stack and the shadcn-admin audit), `0008` (zero cost), `0030` (configuration, never
  schema).

---

## Why this was needed

`platform/web/` today has **React 19, Vite 7, Tailwind 4, and three utility packages**
(`clsx`, `tailwind-merge`, `class-variance-authority`). It has **no router, no data layer,
no table, and no form library.** Every screen so far has hand-rolled all four.

That was the right answer for one login flow and a customer list. **It is the wrong answer
for a complete administration product across five more milestones**, where the same
concerns — a URL that survives a refresh, a cache that invalidates after a mutation, a
sortable paginated table over a cursor API, a form that validates against a contract — recur
on nearly every screen. Rebuilding them per screen is how an admin console becomes a
collection of screens, which is the thing `0035` was written to stop.

## The decision

**Approved, as a named set, in one approval:**

| Library | What it answers | Notes |
|---|---|---|
| **shadcn/ui** | Presentation primitives — button, input, dialog, table shell, form field, toast | **Copied into the repository, not an npm dependency of ours.** This is how shadcn/ui works and it is the reason `0010` chose it: the components become our source, reviewable in `git diff` and editable without a fork. **It does pull Radix UI primitives as real dependencies** — that is part of what was approved, and it is stated here rather than discovered at install |
| **TanStack Router** | Type-safe routing, nested layouts, search-param state | The URL is the admin console's most-used piece of state |
| **TanStack Query** | Server-state cache, invalidation, request de-duplication | Also the thing that stops an admin screen firing four identical `whoami` calls |
| **TanStack Table** | Headless sorting, filtering, pagination over our cursor API | Headless matters: the markup stays ours and stays Tailwind |
| **React Hook Form** | Form state and submission | |
| **Zod** | Runtime validation of what crosses the wire | **See the boundary below — this is the one with a rule attached** |

**Every one is pinned to an exact version at install** — no `^`, no `~`. `web-agent`
records the resolved versions in `platform/web/package.json` and in a follow-up amendment
to this record.

**This approval covers the six names above and nothing else.** A seventh library is a new
decision and a new approval, however small and however obviously useful. `security.md` §7:
approval is specific and does not carry forward.

## Three boundaries this decision does not move

**1. Business rules stay in Core.** `architecture.md` §3 is unchanged by any of this. A
validation library on the client validates *shape*, so a user is told about a bad date
before a round trip. **It does not decide anything.** Pricing, entitlement, permission and
workflow transitions are decided in `platform/core/**`, and a client-side check is a
convenience the server re-performs and never trusts.

> **The specific trap, stated because Zod invites it.** The natural next step after "the
> client validates the request" is "the client knows which fields are required", and the
> step after that is a rule living in two places and drifting. **The contract is the single
> source, and `0037`'s generator is what keeps the client's copy derived rather than
> authored.** A hand-written Zod schema that restates a contract is the same defect as a
> hand-written type, wearing a validator's clothes.

**2. Zero cost is unaffected, and the reason is worth stating rather than assuming.** These
are build-time and browser-side. **Static assets do not invoke the Worker and are free and
unlimited** (`0016`'s deciding measurement), so bundle growth costs bandwidth we do not pay
for and CPU we do not spend. **What would cost money is a library that adds server
requests** — none of these does. Bundle size remains a user-experience concern and is not a
free-tier concern.

**3. `0030`'s constraint is untouched — this is configuration, not schema.** Every item here
is replaceable by changing `platform/web/**`. None of it reaches the data model, and none
of it may be allowed to: **a table library must never become the reason a column exists.**

## Presentation primitives — item 5's second half

`web-agent` establishes a **single primitive layer under `platform/web/src/components/ui/`**
that every admin surface consumes, on both hosts. The requirement is not "add shadcn" — it
is that **a second screen never re-implements what the first one already solved.**

**The specific thing to get right, because it is what the split in `0035` costs if it is
got wrong:** the primitives are shared across `admin.dudo.work` and
`app.dudo.work/settings`, and **that shared layer must carry no authority.** A component
that renders a member row is shared; a component that *decides* whether the viewer may see
it is not, and does not belong in `ui/`. **The two administrations share a look. They do not
share a permission model, a data layer, or a route tree.**

## AMENDED 2026-09-09 — PATH ROUTING, NOT HASH. Decided while it is still one line

`web-agent` kept `createHashHistory()` through the migration, deliberately and correctly:
every published address is `#/customers/…` and the console is deployed. **It then flagged
the consequence rather than leaving it implicit, and the flag is what forces the decision
now.**

**`0035` puts Organization administration at `app.dudo.work/settings` — a PATH.** Under hash
history that address is `app.dudo.work/#/settings`, which is not what the directive says and
not what anyone will type.

**Ruling: switch to path routing.** Four reasons, in the order that decides it:

1. **`0035` already specified a path.** Hash history does not deliver the address the scope
   directive names, and quietly serving a different one is the shape of divergence
   `workflow.md` §12 is about.
2. **Cloudflare already serves what path routing needs** — `0016`'s amendment records the
   `not_found_handling: "single-page-application"` fallback, with the route array form that
   keeps API paths reaching the Worker. **No new infrastructure, no free-tier impact.**
3. **It is one line today and a bookmark-breaking change after Milestones 1 and 2 are built
   on it.** Every admin screen from here forward compounds the cost.
4. **The population whose bookmarks break is enumerable, not open.** `admin.dudo.work` is
   reachable only by a `platform_operator`, and that is one or two named people (`0034`'s
   reasoning about the sender population, applied to readers). **Measurement is the right
   tool for an open population; this one can simply be told.** No redirect layer is required,
   and building one would be permanent configuration bought for a transient problem.

**What this does NOT change:** `0022`'s subdomain structure is untouched — three hostnames,
one Worker. This is the path structure *within* the application, and it is `web-agent`'s to
implement in `platform/web/**`.

### EXTENDED TO `admin.dudo.work` 2026-09-09 — and the whole stack, not just the routing

**Raised by `web-agent`, which refused to settle it by picking one while writing a screen:**
`admin.dudo.work` now **has** the six approved libraries through `@dudo/ui` — **and its screens were
never rebuilt on them.** It runs a hand-rolled router: a 234-line `App.tsx` with a `switch (path)`,
parameterised routes matched ahead of it, `buildHash(item.path)` links, **no router library and no
query client.**

**RULED: Milestone 1 screens are built on the new stack, and the admin console migrates BEFORE the
first of them.**

**The deciding fact is that ROUTING IS NOT INCREMENTAL.** Either the route tree is TanStack or it is
not — **you cannot have half a router** — so *"build the new screens on the new stack and leave the
old ones"* was never actually available for anything that navigates, which is all of it.

**And Milestone 1 is SEVENTEEN Platform Admin capability rows.** Building seventeen screens on a
router that must then be replaced is the argument that decided path routing on the web side, at
seventeen times the scale: **every screen built first is a screen that has to move.**

**Scope measured before ruling, and it is bounded:** nine screens, 32 `.ts`/`.tsx` files, one
`App.tsx`, one shell. **Smaller than the tree `web-agent` migrated the same day.**

**Path routing extends here too, and the infrastructure already serves it — verified before ruling,
because this is what would have made it wrong.** `wrangler.admin.jsonc` already carries
`not_found_handling: "single-page-application"` and `run_worker_first: ["/api/*", "/auth/*",
"/health"]`. **Note that list is WIDER than the main Worker's**, and the file records why: *"without
listing them a POST to `/auth/login/complete` is rewritten to the SPA shell and answered 200 with
HTML. That cost a day to find once."* **The route tree may claim none of those three prefixes**, and
that constraint is more load-bearing on this host than on the other.

**It is a MIGRATION, NOT A REWRITE.** The screens do not get redesigned. **A screen that looks
different afterwards is a change nobody asked for, and it hides the ones that behave differently** —
the same reasoning that kept `web-agent` from switching one console's header to the other's variant
during a package move.

**And this is where `0036`'s no-authority rule gets its first real test.** Both consoles now consume
`@dudo/ui`, and admin is being rebuilt on it. **If a Platform Admin screen needs a primitive that
decides rather than renders, that is a finding and it belongs in the plan rather than in a screen.**

### THE FIRST REAL TEST, FOUND BEFORE A SCREEN WAS WRITTEN — 2026-09-09

**The no-authority rule has been correct and inert since it was written.** `architecture-agent`
found its first live case while planning Milestone 1, **and it is a security boundary rather than a
tidiness one.**

> **A confirmation statement is authored by the SERVER and rendered by the client. A shared primitive
> that COMPOSES one has taken authority into `@dudo/ui`.**

`0027` is explicit: **the party being constrained does not author the statement of the constraint.**
A `<ConfirmationGate>` in the shared layer that assembles *"You are about to revoke platform
authority from X"* **from parameters would render a sentence no server ever said** — and it would
look **exactly like a presentation component**, because composing a string from props is what
presentation components do.

**Safe to share:** layout, the re-authentication field, busy and error states.
**Not shareable:** the statement text, the decision that an operation needs confirming, and any
operation-id-to-sentence mapping.

**Two smaller cases of the same shape, both caught the same way:**

- **A generic "detail with related items" primitive is how `admin.dudo.work` acquires a members
  list** — which `0028` Decision 1 forbids outright, because the transpose of the permitted read is
  the forbidden one. **The primitive would be neutral; the screen built from it would not.**
- **A shared "reveal secret once" primitive** would make show-once a property of a **component**.
  **It is a property of the operation**, and a component that owns it will eventually be reused by an
  operation that does not have it.

> **THE GENERAL FORM, AND IT IS WHY THE RULE NEEDED A SUBJECT TO BE USEFUL: authority does not enter
> a shared layer as a decision. It enters as a CONVENIENCE — a component that assembles a sentence,
> or generalises a layout, or owns a lifecycle.** Each is presentation on its face. **The test is not
> "does this decide" but "could a screen built from this be wrong in a way the primitive makes
> invisible."**

**Recorded here rather than in a new decision record** because the router arrived with this
ADR and the two are one choice; `0022` is cross-referenced for the host layer.

## AMENDED 2026-09-09 — THE "SINGLE PRIMITIVE LAYER ON BOTH HOSTS" DOES NOT EXIST, AND THIS ADR ASSUMED IT DID

**Found by `web-agent` while implementing the path-routing amendment, outside its task.** The
section below requires *"a single primitive layer under `platform/web/src/components/ui/` that every
admin surface consumes, on both hosts."* **That was written without checking whether both hosts are
one package. They are not.**

| | `platform/web/` | `platform/admin/` |
|---|---|---|
| npm package | its own | **its own, separate** |
| `node_modules` | its own | **its own** |
| `src/components/ui/` | **9 modules** | **2** — button, field |
| The six approved libraries | installed, pinned exactly | **none installed** |
| Dependency ranges | pinned | **still on carets, pre-`0036`** |

**Neither tree imports the other and neither can.** So this ADR's *single* layer is **two diverging
copies**, and the divergence is already measurable rather than prospective.

> **AND `admin.dudo.work` IS MILESTONE 1'S ENTIRE SUBJECT.** The host the whole next milestone is
> about has neither the primitives nor the tooling this decision approved, and `0035`'s split makes
> it the surface that must never share an authority layer with the tenant one — **which is a reason
> to share COMPONENTS deliberately, not a reason to let two copies drift.**

**This is `workflow.md` §12's duplicated constraint in executable form**, and `web-agent` filed a
second instance the same day: `verify-kdf.mjs` exists in both trees, **diverged in both directions**,
with admin's seven identifier assertions a strict subset of web's sixteen — **so the printable-ASCII
upper boundary is asserted on `app.dudo.work` and unasserted on `admin.dudo.work`, for the same
`isSubmittableIdentifier`, on the login path of both.** A sweep from either copy finds nothing wrong.

**What is owed, and it is a structural decision rather than a component to copy:** a shared workspace
package that both hosts consume, so the primitive layer is one artifact by construction rather than
by discipline. **Not scheduled here.** It is Milestone 1's first architectural task and it is the
Team Lead's to design before any Milestone 1 screen is built, because every screen built first is a
screen that has to move.

### FOUR THINGS NOW WAIT ON THAT DECISION — recorded 2026-09-09 so the queue is visible

**It stopped being a tidy-up the moment other work started queueing behind it.** Each of these is
blocked, each is somebody's finished analysis waiting on a structural answer, and **none of them can
be done twice cheaply:**

1. **17 assertion gaps between the two KDF suites**, found by `web-agent`'s new `check:suite-parity`
   — 16 present in web and absent from admin (including the **DEL and tilde printable-ASCII
   boundary**), 1 the other way. **Closing them means moving assertions between suites**, and the
   union belongs in the shared package; doing it first means moving them twice.
2. **`check:ui-purity` covers `platform/web/src/components/ui/**` and has never looked at admin's
   primitives.** `web-agent` deliberately did not point it at a second directory, and the reason is
   the right one: **doing so would bless two separate layers as correct**, when the entire purpose of
   the shared package is that there should be one. **When the package lands, that check moves to it
   and covers it alone.**
3. **`0036`'s no-authority constraint has never been tested by anything**, and the reason is
   structural rather than an oversight — there has been no shared component to test it on. **The
   first genuinely shared component is when it starts to matter**, which is inside this decision, not
   after it.
4. **The generator fixture relocation** (`architecture-agent`'s and `qa-agent`'s, into
   `packages/testing/fixtures/contract-generator/`), which also takes `qa-agent`'s
   `EXPECTED_EXCLUDED` to zero and converts that assertion into the mechanism enforcing the
   convention.

**Two constraints on the design, both measured rather than assumed** (`web-agent`, 2026-09-09):
both trees already resolve identical versions — react 19.2.8, tailwind 4.3.3 — so **hoisting changes
nothing that runs**; but **admin is still on carets while web is pinned, so admin must be pinned in
the same change, not after it**, or its resolution becomes a question of when someone last installed.
And moving `ui/` into a shared package means **admin inherits all six approved libraries** — inside
the existing approval, but a consequence rather than a detail.

**Ownership resolved in the same breath:** `platform/admin/**` is **`web-agent`'s**, recorded in
`CLAUDE.md` on 2026-09-09. `web-agent`'s task brief predated that and said `platform/web/**` and
nothing else; **it followed the brief and touched nothing there, which was correct** — an agent
resolving an ownership contradiction in its own favour is the failure mode, and it did the opposite.

## Risks, stated rather than discovered

- **Six libraries at once is the largest dependency addition this project has made.** The
  mitigation is that they are pinned, named, and confined to `platform/web/**`, and that
  each is independently removable — none of them is load-bearing for Core.
- **Radix arrives transitively under shadcn/ui.** It was named above so that the count is
  honest; a reader who expected "six packages" and found forty in the lockfile should not
  be learning it from the lockfile.
- **TanStack Router replaces routing that partly exists.** `web-agent` migrates rather than
  running two routers side by side, and the migration lands before any Milestone 1 screen is
  built on it.
- **A library that renders a permission-gated control does not enforce anything.**
  `security.md` §2 — UI-level hiding is presentation, never security. Every one of these
  screens is reachable by URL and the server is what refuses.
