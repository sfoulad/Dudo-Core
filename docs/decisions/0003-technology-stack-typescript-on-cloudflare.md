# 0003 — Technology stack: TypeScript on Cloudflare

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** User (explicit approval in conversation), Dudo Team Lead
- **Owning agent:** Team Lead

## Context

No `Dudo-Core` technology stack had been selected. `0001` bound the plugin isolation
mechanism to that decision, and every agent reported the same blocker at readiness: no
executable contract, no test framework, no CI, no data model.

The project's private planning source resolves it: it specifies Cloudflare as the primary hosting
platform and TypeScript as the implementation language.

## Options considered

1. **TypeScript on Cloudflare** *(chosen)* — specified by the private planning source, with a
   coherent story for every platform requirement and a single vendor to learn. Costs
   vendor concentration and a runtime with real constraints (no long-running Node APIs,
   CPU-time limits, single-threaded D1).
2. **A conventional container stack** (Node or Go on a managed host, Postgres) — more
   portable and better understood, but discards the plan's architecture, and the plan's
   Phase 7 customer-code runtime has no straightforward equivalent outside Workers for
   Platforms.
3. **Defer** — rejected. The decision blocks all nine phases and the plan already
   answers it.

## Decision

**TypeScript is the implementation language for `Dudo-Core`. Cloudflare is the hosting
platform.**

Approved services, each tied to the requirement it solves:

| Service | Requirement it solves |
|---|---|
| **Workers** | Core API and web backend |
| **D1** | Relational tenant data |
| **R2** | Object and file storage |
| **Queues** | Reliable asynchronous work |
| **Workflows** | Long-running, multi-step processes |
| **Durable Objects** | **Only** where real coordination or serialized state is genuinely needed |

**Bindings, not REST.** Cloudflare services are reached through native bindings, never by
calling Cloudflare's public REST APIs from a Worker. Worker-to-Worker communication uses
Service Bindings/RPC rather than public HTTP.

### Two constraints on this approval

1. **Do not adopt every Cloudflare product automatically.** A service enters Dudo only
   when it solves a documented requirement. Products named in the planning source but *not*
   approved here — Workers AI, AI Gateway, Agents SDK, Workers for Platforms, Analytics
   Engine, Hyperdrive, Vectorize, KV — each need their own decision record when the
   requirement actually arrives. Being in the plan is not approval.
2. **Every service stays replaceable behind an internal boundary.** No Cloudflare type,
   client, or binding appears in domain logic. Storage, queuing, and object access sit
   behind Core-owned interfaces so a service can be swapped without rewriting the domain.

Approval of TypeScript and Cloudflare is **not** approval of any npm package, framework,
ORM, or third-party library. Those are separate decisions.

## Consequences

- Phases 0–3 are unblocked. Contracts become executable, a test framework becomes
  choosable, and CI can be written against a real toolchain.
- **The runtime constrains the architecture.** Workers have CPU-time limits and no
  long-running process model; anything long-running goes to Workflows or Queues by
  design, not as a workaround.
- **D1 is single-threaded per database** — roughly 1,000 queries/second at 1 ms per
  query, verified against Cloudflare's published limits. This materially affects the
  tenancy decision and is recorded here so it cannot be overlooked: a shared database
  makes every tenant contend for one thread. See "Open" below.
- Vendor concentration is real and accepted. Constraint 2 is the mitigation, and it only
  works if it is enforced in review from the first commit rather than retrofitted.
- `plugin-agent` remains blocked: `0001` binds the plugin isolation mechanism to this
  decision, but the isolation mechanism itself is still unrecorded.

## Approval

The user approved this explicitly in conversation on 2026-08-31, including both
constraints, and explicitly declined blanket adoption of the Cloudflare product range.

No deployment, account configuration, or dependency installation is authorised by this
record.

## Open, and not decided here

1. ~~**The tenancy model**~~ — **DECIDED 2026-09-01 by `0006`: Option A, one shared
   database, with mandatory indirection.** The reasoning below is superseded and left for
   the record: it cites D1's **Workers Paid** allowance (10 GB per database,
   50,000 databases), and `0008` since bound Dudo to the **Free** tier — 500 MB per
   database, 10 databases. Under that ceiling the conclusion reverses, and a shared
   database is the only model that does not spend the ten-database budget.
   *Original text:* "D1's per-database threading and its 10 GB / 50,000-database limits
   point away from a shared database; the planning source suggests starting shared."
2. **The plugin isolation mechanism** — bound to this decision by `0001`, still open.
3. **Web framework, testing framework, and any npm dependency.**
4. **Workers for Platforms availability** — Cloudflare's documentation does not state
   whether it requires an Enterprise plan. Relevant to Phase 7; unverified.
