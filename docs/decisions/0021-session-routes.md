# 0021 — Session routes: a third request class, and Organization selection

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Amends:** `0014` §C (resolution order) by naming a class between pre-auth and Action
- **Closes:** the deadlock found by deploying, not by testing
- **Owning agent:** `architecture-agent` authored the contract; `core-agent` implements.

## Context — a deadlock, found only by deploying

Dudo went live on 2026-09-05. A seeded `owner` logged in successfully — 200, real session cookie,
`IDENTITY_LOOKUP_KEY` verified matching between the seed tool and the Worker — and **every business
request then returned 422 `failed_precondition`.**

`login.ts:219` states why: a session is created `organization-not-selected`, and every business
Action answers `failed_precondition` until a selection is made. `selectOrganization` exists as a
`SessionResolver` method and **has no HTTP route**. Neither does the picker that must precede it.

**The Team Lead had recorded this gap the day before as latent**, writing that it "does not bite
while every principal belongs to exactly one Organization." That was wrong: selection is mandatory
regardless of how many memberships exist, so it blocked every principal on the platform.

### Why the obvious fix does not work

`core-agent`, asked to stand by, traced the pipeline instead and found the route could not be added
as specified:

- `api.ts:222-224` resolves the principal **first** and returns immediately on failure — before the
  router is consulted.
- `session-principal-resolver.ts:112-114` maps `organization-not-selected` onto
  `failedPrecondition()`.

**So an Action route serving the picker is unreachable precisely and only in the state it exists to
repair.** *"You cannot select an Organization because you have not selected an Organization."*

Two further consequences from the same place: `AuthenticatedPrincipal` **requires** an
`organizationId`, so there is no principal shape to carry; and an Action requires a permission
(`0007` rule 4) that no role grants, which is a second deadlock behind the first.

And it cannot be a pre-auth entry point: `0014` §B's registry is a closed five that refuses to load
with a sixth, **and it is wrong on the merits** — these callers are authenticated.

## Decision

**Accept a third request class: the session route.**

Authenticated at the **session** level. It resolves a session identifier and stops. It **never**
builds an `AuthenticatedPrincipal`, **never** obtains a tenant store, **never** evaluates a
permission, and **never** calls `invokeAction`.

Two operations occupy it: the Organization picker, and `selectOrganization`.

### The two shortcuts, refused

`architecture-agent` named both, and the reasoning is why this is an ADR and not a table entry:

- **A pseudo-principal with a null `organizationId`.** This is `0014` §B's own argument one layer
  up: it **would make every tenant predicate in the platform depend on a sometimes-absent value.**
  The cost is not at the call site; it is at every other call site forever.
- **A tenant-optional branch inside the Action pipeline.** *"It would work, and every future
  reviewer of every future Action would then have to check which side of that branch it lands on."*

**The invariant that an Action always has a tenant is worth more than the code it saves.** That
sentence is the decision.

### The validation gap — binding, and easy to miss

A session route matched in the early block **inherits no input validation at all.** Core's JSON body
parsing, unknown-field rejection and repeated-parameter refusal all live in the Action path *below*
it, and `parsePreAuthBody` is reached only through `dispatchPreAuthRequest`.

Without explicit validation, **the one route in Dudo that accepts a tenant identifier would be the
one route with none** — silently accepting `?principal_id=…`, ignored today and one careless edit
from being read. Validation is a requirement of this class, not of these two operations.

### Preserved from the existing implementation, not re-derived

The hint ruling (`0014` §C.6: the caller-supplied Organization is validated against membership,
never trusted) · the three-way `not_found` collapse · the single-method membership lookup · the
suspended-Organization asymmetry · and, most importantly, **validate-then-reserve ordering**.

Reversed, a caller could exhaust its own per-principal budget — which it fully controls — and
thereafter distinguish `quota_exceeded` ("I am a member") from `not_found` ("I am not"): **an
Organization-existence oracle built out of a capacity control and switched on at will.** The
contract gives it a mechanical test: with the budget exhausted, a non-member must still receive
**404, never 429.**

### ~~Auto-selection with exactly one membership: permitted~~ — SUPERSEDED, and the ruling was wrong

**The Team Lead ruled that the SERVER should auto-select when a principal has exactly one
membership, with three conditions. The contract specifies the opposite, `core-agent` implemented the
contract, and the contract is right.** Struck rather than deleted, because the error is the useful
part.

The contract's words:

> *"If exactly one Organization is returned, the client MAY select it immediately without showing a
> picker — that is a presentation choice and it is permitted. **IT IS NOT A DEFAULT AND IT IS NOT A
> SERVER BEHAVIOUR: the request is still made, the hint is still validated, and the server still has
> no fallback.** A client that skips step 4 is not logged in anywhere."*

**Why that is better, and why the ruling was wrong on its own terms:**

- **It preserves the no-fallback property completely.** The ruling argued that "exactly one" is
  *determined* rather than *defaulted* — but it still reintroduced a **server-side selection path**,
  which is precisely what `session-resolution.ts` refuses by name. A cardinality condition on a
  fallback is still a fallback.
- **The unimplementable condition was the tell.** The ruling required the session to *record that
  selection was automatic*. Under the contract that is impossible — a client skipping the picker
  sends a **byte-identical request** to one that showed it, and `selectOrganizationInput` is
  `additionalProperties: false` with exactly one field. **There was nothing to record because there
  was no difference to record**: the caller chose either way. That the condition could not be built
  is evidence the distinction it protected did not exist.
- **The behavioural cliff disappears rather than needing to be documented.** Gaining a second
  membership changes nothing server-side; the client simply starts showing a picker. The ruling
  invented a hazard and then required a warning about it.

**The general error: solving a problem into existence.** Auto-selection was treated as a server
capability needing safeguards, when the honest framing is that a client with one option need not
draw a menu — which requires no server change, no migration, no column, and no conditions.

**Consequence: no migration and no `session` column.** OS-8 is withdrawn.

## Cost — the session budget moves again

Selection is charged 3 row-writes (1 statement, 1 true, 3 charged — a deliberate over-charge so the
constant cannot drift from the schema). Since selection is **mandatory**, the real unit is
login + select + logout:

**A full session costs 9. Every session, with no exception.**

| | Charged per full cycle | Platform/day | Per principal/day |
|---|---|---|---|
| `0014` §C as written (login only) | 3 | 1,000 | 200 |
| `0018` (login + logout) | 6 | 500 | 100 |
| **This decision — login + select + logout** | **9** | **333** | **66** |

**The 6-versus-9 split that stood in this record for under an hour is withdrawn along with
server-side auto-selection.** `architecture-agent`'s finding was sound in itself — `issueSession`
does write the Organization into the session INSERT rather than following with an UPDATE — but it
only produces a 6 **if the server selects at login**, and under the contract it never does. Selection
is always a separate request.

### This number has now been published five times in two days

**1,000 → 500 → 333 → 6-or-9 → 333.**

Three of those corrections were genuine measurement — counting what a real operation writes rather
than the one someone happened to be thinking about. **The fourth and fifth were not measurement
errors at all. They were the same design question, unsettled, being published twice as though it were
arithmetic.**

The lesson is not about counting. **A number that depends on an undecided design is not a number
yet, and stating it as one converts an open question into apparent fact.** Both `0018` and this
record did that, and each time the correction looked like new evidence when it was really the design
finally settling.

`quota_exceeded` is a declared response.

## Consequences

- A new mechanism exists in Core's request path. It is narrow by construction — two operations, no
  tenant, no permission — and **widening it is a decision, not a refactor.**
- The picker returns **identifiers with no names**: `0002_organization.sql` declined a name column
  deliberately, so a picker built on this shows 22-character opaque ids. Deferred rather than
  solved, and deferrable *only* because auto-selection means no principal reaches the picker today.
- `login-v1` now states plainly that **a 200 from login is not a usable session.**

## Open, owed, and not decided here

- **OS-1 — neither session route is rate limited, and selection writes.** Raised by
  `architecture-agent`. An authenticated caller can invoke selection repeatedly, at 3 charged
  row-writes each, with no per-minute bound. The per-principal daily ceiling (66–100 full sessions)
  contains a *single* principal, so this is not exploitable by one account — but nothing bounds a
  burst, and nothing stops many principals converging. **Not urgent at closed-beta scale (two
  principals), and owed before any non-operator user**, alongside `0018`'s reserved-allocation
  obligation. Note that `0017`'s in-process limiter is per-isolate and would not close this either.
- **The 6-versus-9 split is stable only while `issueSession` writes the Organization in the
  INSERT.** If a future change makes auto-selection a second statement, **the figure silently
  becomes a flat 9 and nothing fails.** This is why the contract specifies *where* the write
  happens rather than only its outcome — the same drift class as the index warning on OS-8.

**Closed during deployment, 2026-09-05:**

- **OS-7** — the two deployed `organization_id` values were checked against
  `^[A-Za-z0-9_-]{8,64}$`. Both pass: 22-character base64url.
- **OS-10** — every seeded principal had exactly one membership, so **only the auto-selection path
  was reachable and QA could not have tested the picker at all.** Principal B was given a second
  membership (`role: member`) in Organization A. Principal A was deliberately left at one, so the
  auto-selection path — and the login demonstrated on the live deployment — keeps working. **Both
  paths are now testable against the deployment.**

## What this does NOT decide

- **Organization names.** They belong to the organization-structure slice, which does not exist.
- **Any third occupant of this class.** Two operations justified it; a third needs its own argument.
- **Free-tier impact: USD 0 / BD 0.** No new service; the row-writes are inside `0014` §A's
  existing allocation, now counted correctly.
