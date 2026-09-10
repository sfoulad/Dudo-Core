# Milestone 1 — Platform Admin build order

- **Owner:** `architecture-agent` authors; the **Team Lead sequences.** Analysis, not authorisation.
- **Date:** 2026-09-09
- **Subject:** the 17 `PA-` rows of `docs/architecture/admin-capability-matrix.md`.
- **Sequencing rule:** `architecture.md` §1 — **the contract is authored, it is agreed, and only
  then do consumers build.** Nothing in M1 is built against a shape that has not been published.

---

## The finding that inverts the naive order

**The first three screens anyone would build are the three with no generated types.**

`0037`'s generator admits 10 of 15 contracts. **Five refuse — and three of the five serve the
Platform Admin rows a console must build first:**

| Contract | Serves | Why it refuses |
|---|---|---|
| `login-v1` | **PA-01** operator sign-in | 4 × missing authorization declaration, 2 × request shape, 2 × response shape |
| `platform-operator-v1` | **PA-02** whoami · **PA-03** Organization directory | missing `tenancy:` block |
| `confirmation-v1` | the gate on **PA-08** and **PA-11** | missing `tenancy:` block |

**So sign-in, the operator's home screen, and the Organization list — the three screens that must
exist before any other Platform Admin screen is reachable — are exactly the ones where a developer
will find no emitted type and hand-write one.** `0037` requirement 2 is that a generated type is
**consumed, never re-declared**, and a hand-written type here is the `0034` defect rebuilt: a client
that read the code rather than the contract.

> **THE FIVE HELD CONTRACT EDITS ARE ON MILESTONE 1'S CRITICAL PATH, NOT AFTER IT.** They were
> queued as tidying — five contracts declaring `permission: none`, a tenant-scope statement, and
> `requestClass:`. **They are the precondition for `web-agent` building the first three screens
> against generated types rather than against guesses.**

**Nothing else in M1 changes if they slip. Everything in M1 that a client touches first does.**

---

## Re-derived status, 2026-09-09

**Re-derived rather than carried forward**, because the matrix's statuses were measured before
`0034` phase 3 landed, before `.session` dropped, before five contracts were accepted, and before
the generator emitted anything. **A status in a table rots exactly as a count in prose does.**

**Two rows changed status today and neither changed for a reason visible in the row.**

| # | Capability | Route | Contract | Types? | Status |
|---|---|---|---|---|---|
| PA-01 | Operator sign-in / sign-out | live (pre-auth ×4) | `login-v1` **accepted today** | **NO** | reachable, **no types** |
| PA-02 | Operator self-context (`whoami`) | live | `platform-operator-v1` | **NO** | reachable, **no types** |
| PA-03 | Organization directory | live | `platform-operator-v1` | **NO** | reachable, **no types** |
| PA-04 | Organization detail + `member_count` | live | `organization-detail-v1` | yes | reachable |
| PA-05 | Onboard an Organization | live | `organization-onboarding-v1` | yes | reachable |
| PA-06 | Organization display identity | live | `organization-identity-v1` **accepted today** | yes | reachable |
| PA-07 | Operator roster | live | `platform-operators-v1` | yes | reachable |
| PA-08 | Revoke platform authority | live, **gated** | `platform-operators-v1` + `confirmation-v1` | **partial** | reachable, gate has no types |
| PA-09 | Grant platform authority | — | — | — | **not built BY DECISION** (`0025`) |
| PA-10 | Create a platform operator | — | — | — | **not built BY DECISION** (`PlatformOperator`) |
| PA-11 | Credential reset | live, **gated** | `credential-reset-v1` + `confirmation-v1` | **partial** | reachable, gate has no types |
| PA-12 | Resolve one member identifier | live | `organization-detail-v1` | yes | reachable — **`identifier` alias removed today** |
| PA-13 | Create a Template | live | `template-v1` | yes | reachable |
| PA-14 | List Templates | live | `template-v1` | yes | reachable |
| PA-15 | Read a Template | live | `template-v1` | yes | reachable |
| PA-16 | Edit / retire / restore a Template | — | `template-lifecycle-v1` (authored 2026-09-09) | no — `status: proposed` | not built |
| PA-17 | Re-assign an Organization's Template | — | `template-lifecycle-v1` (authored 2026-09-09) | no — `status: proposed` | not built |

**Corrections to the matrix's carried-forward statuses:**

- **PA-01 and PA-06 were serving live traffic against `proposed` contracts.** Both accepted
  2026-09-08. The route did not change; **what changed is that building against them is now in
  order under §1 rather than ahead of it.**
- **PA-12's request shape changed today.** `0034` phase 3 removed the `identifier` alias. **A
  console still sending it now receives `invalid_argument` before authentication** — which is the
  priced residual, and it is a live behaviour change on a screen M1 will rebuild.
- **No row is `built and unreachable`.** That status appears nowhere in the re-derived table: every
  registered platform route's permission is in `PLATFORM_PERMISSION_ENVELOPE` and held by
  `platform-admin`. The two `HELD_BUT_UNREACHABLE` permissions gate **PA-09** and marketplace
  moderation, and both are `not built by decision` rather than unreachable.

---

## Dependencies on open items — asked plainly, answered plainly

**No `PA-` row depends on `F-1`.** `F-1` is the **Action-class** confirmation challenge, and every
confirmation-gated Platform Admin row is **platform-class**, served by
`platform.confirmations.request`, **which exists and is reachable.** F-1 blocks twelve *tenant*
critical permissions and none of them is a `PA-` row.

**No `PA-` row depends on `0038`.** Both of its preconditions are Milestone 2 — the Action-class
challenge and the control-plane tenant permissions. **M1 can complete with `0038` open.**

**What M1 does depend on, and it is the only hard blocker:** the five contract edits, for the three
contracts above. Everything else is authoring work I own.

---

## Build order — by what unblocks the most

### Group 0 — the precondition. Nothing else should start first.

**Five contract edits, one pass per contract, `requestClass:` and the predicted-refusal fix
together.** For M1 the three that matter are **`login-v1`, `platform-operator-v1`,
`confirmation-v1`**; `organization-selection-v1` and `account-identifier-v1` are in the same pass
and serve Milestone 2.

**What each needs:** an explicit `permission: none` naming the closed registry that admits the route
(`0014` §B or `0021`), a `tenancy:` block stating **why the class has no tenant** rather than
inventing a scope, and `requestClass:`. **`login-v1` additionally owes an explicit declaration for
the two entry points that genuinely have no request or response shape** — `identity.session.refresh`
is reserved with no handler, `identity.session.revoke` takes no body and returns none. *An absent
key and a forgotten one are the same character.*

**Unblocks:** PA-01, PA-02, PA-03 with generated types, and the gate on PA-08 and PA-11.
**Nothing in M1 is unblocked by anything else until this lands.**

### Group 1 — the operator shell. Buildable the moment Group 0 lands.

**PA-01 · PA-02 · PA-03.** Sign-in, `whoami`, the Organization directory. **Every other Platform
Admin screen is reached through these**, so they gate the milestone by reachability rather than by
contract. All three contracts exist and are accepted; only the types are missing.

### Group 2 — read surfaces. Buildable NOW, in parallel with Group 0.

**PA-04 · PA-07 · PA-13 · PA-14 · PA-15.** Organization detail, the operator roster, the three
Template operations. **Contracts accepted, routes live, types emitted.** No authoring owed.

**These are what `web-agent` should build while Group 0 is in review** — they are the largest block
of work with no dependency on anything I have not published.

### Group 3 — the two write surfaces that need no new contract.

**PA-05 onboarding · PA-06 Organization identity.** Both accepted, both generating. **PA-05 is the
widest-blast-radius operation in the platform** — it creates a tenant — and it is deliberately
**not** confirmation-gated (`0026` decision 1), so it must not acquire a gate in the UI that the
contract does not require.

### Group 4 — the gated pair. After Group 0, and they share one mechanism.

**PA-08 revoke · PA-11 credential reset · PA-12 resolve.** PA-12 is not gated but is the only route
to a `principal_id` for PA-11, so the three ship together or PA-11 is unusable.

**PA-11 has a constraint no other row has: the generated credential is shown EXACTLY ONCE and is
never re-displayable.** There is no route that returns it again and no reversible form is stored.

### Group 5 — authoring on the critical path, and it is mine.

**PA-16 Template edit / retire · PA-17 Template re-assignment.** ~~Both `NOT YET AUTHORED`~~
**AUTHORED 2026-09-09 as `template-lifecycle-v1`** — contract and schema, **five operations**,
`status: proposed`. **Not built, and authored is not built.**

**Deliberately last.** Templates are readable and creatable without them (Group 2), so they extend a
working surface rather than gate one.

**Three things authoring changed about this paragraph, and they are the reason it is amended rather
than ticked:**

- **`core.template.archive` is proposed as `core.template.retire`.** A permission named `archive`
  gating a route that sets `retired` is two words for one act. The object's own vocabulary wins.
- **The re-assignment permission is `core.platform-organization.set-template`**, and the plan's
  reasoning held on inspection: `core.platform-organization.update`'s catalogue entry scopes itself
  to display name, CR and VAT and says in terms *"IT DOES NOT COVER STATUS… a separate permission
  and a separate argument."* A Template is not identity.
- **PA-16 needed a fourth operation nobody had listed: RESTORE.** Template names are unique, so a
  one-way retirement spends the name permanently — retire "School" by mistake and you can neither
  recreate it nor undo it. **Retirement was designed as the safe alternative to deletion; one-way
  retirement would have made it a quieter deletion with the same permanence.** This plan's row said
  "edit / retire" and would have shipped the trap.

- **And a fifth operation on a Team Lead ruling: the usage read.** The first draft returned the
  adoption count only in the response to a write, so an operator decided whether to retire **blind**
  and learned the reach by having acted. **Reversibility makes the mistake recoverable; it does not
  make the decision informed.** It reuses `core.template.read` and adds no permission. **It also
  decoupled two open questions that were silently load-bearing on each other** — `TL-1`'s only
  mitigation was `TL-3`'s reversibility, and `TL-3` proposed removing it, with neither saying so.

**All three permissions are PROPOSED and none is granted.** `0007` rule 4: a permission does not
exist until it is in `permission-catalog.yaml`, and this contract does not put it there.

---

## The `0036` no-authority finding — one row needs a primitive that decides

**Both consoles now share `@dudo/ui`, and `check:ui-purity` is about to have its first real
subject.** One Platform Admin capability presses on it, and it is the confirmation gate.

> **A confirmation statement is authored by the SERVER and rendered by the client, and a shared
> primitive that COMPOSES one has taken authority into `@dudo/ui`.**

`0027`'s ruling is that **the party being constrained does not author the statement of the
constraint.** A `<ConfirmationGate>` in the shared layer that assembles *"You are about to revoke
platform authority from X"* from parameters is exactly that — **it would render a sentence no server
ever said, and it would look like a presentation component.**

**What is safe to share:** the layout, the re-authentication field, the busy and error states.
**What is not:** the statement text, the decision that an operation needs confirming, and any
mapping from an operation id to a human sentence. **The requirement is derived from the
permission's sensitivity in Core and is not declarable anywhere else.**

**Two smaller ones, recorded because they are the same shape:**

- **PA-04 must not gain a members list**, and a generic "entity detail with related items" primitive
  is how one arrives. `0028` Decision 1: the transpose of the permitted read is the forbidden one.
- **PA-11's show-once credential** must not be a shared "reveal secret" primitive that decides when
  to show. Showing once is a property of the operation, not of a component.

---

## If M1 moves something, who consumes it

**Four half-moves in one session shared one mechanism: a consumer living in a tree the mover does
not own.** M1 moves screens onto a new router. What consumes the admin surface, repository-wide:

- **`platform/admin/src/screens/**`** — the screens themselves. Loud breakage.
- **`packages/testing/**`** — the platform-operator suite and `verify-staging.ts` probe admin paths
  and assert on them. **`qa-agent`'s tree, not `web-agent`'s.**
- **`packages/contracts/**`** — nothing imports admin code, but `check:route-fields` compares route
  tables to contract properties, so a **contract** change lands against Core rather than the console.

**And the sharper form, which the list above does not give:** a consumer sweep finds what breaks
loudly; **only reading the call sites finds what breaks quietly.** The quiet case here is a probe
that still passes against a moved path because it asserts on a status code rather than on content.

---

## What this plan does not do

- ~~**It authors no contract.** PA-16 and PA-17 are named as owed, not drafted.~~ **NO LONGER TRUE,
  2026-09-09.** `template-lifecycle-v1` was authored on the user's sequencing ruling. **Struck rather
  than deleted**: it was correct when written, and a plan that silently starts agreeing with what
  happened teaches nobody what it had deferred. **What is still true is the sentence below it** —
  the plan grants no permission, and neither does the contract.
- **It grants no permission.** The three new permissions Group 5 needs are requests for catalogue
  entries; `0007` rule 4 means they do not exist until they are in `permission-catalog.yaml`.
- **It does not schedule.** Order is stated; dates are the Team Lead's.
