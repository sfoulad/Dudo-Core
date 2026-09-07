# 0017 — Pre-authentication rate limiting: accepting the in-process limiter for the closed beta

- **Status:** **Accepted**
- **Date:** 2026-09-04
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04 — *"you rule to
  take decision when needed"*
- **Amends:** `0014` §B for the closed-beta scope only
- **Owning agent:** Team Lead records. Implemented by `core-agent`.

## Context

`0014` §B admits a permissionless route **only if it carries rate limiting**. Login is
permissionless by necessity, so that condition is load-bearing rather than decorative.

The only limiter in the repository counts **per isolate**. `worker-entry.ts` carries a standing
rule — written before login existed and unchanged since — that an in-process control is not
wired in production. `core-agent` did not overrule it. The consequence, reported plainly:
**`preAuth` is not composed, all five pre-auth entry points answer `not_found`, and login is
built, wired, and switched off.**

It also declined to leave the one-line switch commented out, on the grounds that *"a
commented-out security control is a control someone uncomments."* That is right, and it is why
this decision exists as a record instead of a diff.

## The alternative, and why it is not simply better

The durable limiter is the correct end state. It is not a small task, and one property makes it
a capacity decision rather than an implementation detail:

**Durable Objects are 100,000 requests/day on the free tier, account-wide, and that budget is
already shared with the authenticated coordinator (`0013`).** A naive one-DO-call-per-request
limiter therefore lets an **unauthenticated** flood exhaust the same allowance the
**authenticated** path depends on — the rate limiter becomes the denial-of-service vector it
was added to prevent. Delta batching is the likely answer, and it needs `architecture.md` §6a's
free-tier impact check **before** it is built, not after.

Building it now would block the first testable release on a capacity design. Shipping login
switched off would mean shipping nothing.

## Decision

**Accept the in-process pre-auth limiter, for the closed beta only.** Compose `preAuth` with
`createInProcessPreAuthLimiter()` at the default export.

### What is actually being accepted

Per-source and per-bucket limits become **per-isolate**. Cloudflare runs many isolates, so an
attacker distributing attempts across them faces a limit that is, in aggregate, far weaker than
the configured number implies.

Two things bound the damage, and both are worth stating precisely because it would be easy to
overclaim either:

- **A failed login writes nothing to D1.** So this is *not* the coordinator case: there is no
  cost amplification and no path from failed attempts to exhausting the 100,000 daily row-write
  ceiling. Successful logins remain bounded by the durable daily limit (1,000/day platform-wide).
- **The client-side KDF is not a meaningful attacker cost.** `0015` §D.2's 600,000 iterations
  bind an honest client. An attacker computes the derived value directly — measured at roughly
  72 ms of CPU per guess. That is a speed bump, not a control, and it should never be cited as
  one.

### The honest reason this is acceptable, which is not the rate limiter

**Rate limiting is not what protects these accounts during the closed beta. Password entropy
is.**

Every account in scope is created by `tools/seed-principal.ts`, by an operator, out of band.
There is no signup. If those credentials are high-entropy and machine-generated, online guessing
is infeasible at any rate a per-isolate limiter permits, and the weakened limit costs nothing
real.

That argument collapses the instant a human chooses a password. This is therefore binding:

- **Seeded credentials MUST be high-entropy and machine-generated.** Not operator-chosen, not
  memorable, not reused.
- **The moment any account exists whose password a person selected, this decision no longer
  applies** and the durable limiter is required first.

## Scope limits — binding, and narrow on purpose

1. **Staging only. Never production.** Deploying this configuration to production requires a new
   decision, not an appeal to this one.
2. **Operator-seeded accounts only.** No signup, no self-service registration, no password reset.
3. **Superseded before the first non-operator user**, whichever comes first — public beta, real
   customer data, or self-service anything.
4. **The durable limiter's design must address the shared 100,000/day DO budget explicitly**, and
   carry its own §6a free-tier impact check. "Add a DO" is not a design.

## Consequences

- Login becomes reachable, and the first end-to-end test of Dudo becomes possible.
- `0014` §B's condition is met in letter and weakened in substance for this scope. Recorded here
  rather than quietly satisfied, so that the next person to read §B finds the exception attached
  to it.
- **Free-tier impact: USD 0 / BD 0.** The in-process limiter consumes no Cloudflare service. This
  decision *defers* the DO capacity question rather than answering it.
- A follow-up is owed: the delta-batching durable limiter, with its impact check, as a scoped
  task with an owner.

## What this does NOT decide

- The durable limiter's design. Explicitly out of scope, and deliberately not sketched here —
  a half-specified capacity design is worse than none.
- Whether the in-process limiter's configured numbers are right. Unexamined; they were never the
  control being relied on.
- Anything about production, which needs the durable limiter and its own record.
