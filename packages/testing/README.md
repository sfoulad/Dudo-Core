# packages/testing/ — Test suites and shared harness

**Owner: `qa-agent`** (see `docs/architecture/boundaries.md`)

Cross-cutting test suites and the shared test harness: unit, integration, contract,
security, tenant-isolation, and regression coverage.

> Moved here from `tests/` by `docs/decisions/0004-repository-structure.md`.

Per-App suites colocate with their App under `apps/<name>/tests/` as Apps are built.
`qa-agent` owns those too — the location changes, the ownership does not.

## What lives here

- Contract tests binding the producer and **both** consumers — the web client and the
  Apple client — against one published contract set.
- Tenant-isolation suites.
- Authorization and permission suites.
- Cross-App integration and regression suites.
- Shared fixtures, factories, and harness utilities.

## Rules

- **Synthetic data only.** Never real customer data. Never a secret, token, or
  credential — including in expected output.
- **Never weaken a test to produce a pass.** No deleted assertions, no added skips, no
  widened tolerances, no stubbing past a real failure. A failing test that describes
  reality is a deliverable.
- **Report actual results** — passed, failed, skipped, not run. Never round a partial run
  up to "all passing", and never report a suite that was not run.
- **Tenant isolation is a first-class target.** For every feature touching tenant data,
  prove tenant A cannot read, write, enumerate, or infer tenant B. **A missing isolation
  test is itself a defect.**
- QA never edits production code. Defects route to the owning agent through the Team Lead.
- **Root-level shared test configuration belongs to the Team Lead**, not to QA. QA
  proposes changes to it — see `docs/decisions/0001-governance-and-decision-sequencing.md`.

## Running the platform-operator (super-admin) suite

```
node packages/testing/run-platform-operator.ts
```

Covers the fourth request class: `docs/decisions/0024`'s two invariants, `0025`'s five
decisions, and `platform-operator-v1`'s binding properties P1, P2 and P4. It builds a
control-plane database from all ten real migrations and composes the shipped
`platform/composition.ts` over the shipped D1 adapter, so nothing about the class is
simulated except the SQL engine.

A **primary run**, then **five negative-control runs**:

| # | Control | What it breaks |
|---|---|---|
| 1 | the mutual-exclusion probe | `principalHasAnyMembership` always answers `false` |
| 1b | the Action-side mutual exclusion | `findPrincipal` reports `holdsMembership: false` |
| 1c | **both halves at once** | both of the above |
| 2 | the audit record | every write silently succeeds and stores nothing |
| 3 | the host binding | the application host is added to `adminHosts` |

**Controls 1 and 1b cannot be read on their own, and 1c is why.** The invariant is enforced at two
independent points reading two different statements, so the platform routes still refuse a
both-tables principal under either control alone — defence in depth working, and also the way a
negative control quietly stops controlling. Only 1c, with every enforcement point removed, can
show that the "every platform route refuses" case tests the invariant rather than testing nothing.
It turns all three isolation cases red; the cases that stay green under it are the `0010` trigger
and schema cases, which correctly do not depend on a runtime check.

**Control 3 is read differently again.** `0025` requires that the host binding
be defence in depth and never the first layer, so the AUTHORIZATION suite is re-run under it
and **must stay green** — an authorization suite that is indifferent to the hostname is the
evidence that routing is not doing the authorizing.

**`docs/decisions/0027`'s central negative control — "remove the confirmation check and every
critical-operation test must go red" — has NOT been performed**, because no confirmation
mechanism exists to remove. `suites/platform-operator/confirmation.ts` observes that state on
every run and carries the owed cases as explicit skips. A wrapper that removed nothing would
print a green control line, and a green control line reads as evidence.

### What is NOT covered by this run

`packages/testing` is **excluded from the root `tsconfig.json`**, deliberately and with the
reason recorded there: it is Node code and the root config targets a Worker. So these suites
are **not typechecked by `npm run typecheck`**. The `platform/core` half they exercise is.

## Running the Customer Directory suite

```
node packages/testing/run-customer-directory.ts
```

Node 22 runs TypeScript directly by stripping types. There is **no build step, no
configuration file, no runner package and nothing installed** — `0003` approves TypeScript
on Cloudflare and **no npm package**, and **TS1, the testing framework, is unresolved**.
The runner in `harness/runner.ts` is deliberately ~150 disposable lines: when TS1 is
decided, the suites move and it is deleted. `node:sqlite` and `node:test` are both Node
built-ins; `node:sqlite` is used because it is a real engine, and `node:test` is **not**
used because adopting it would be a TS1 decision that is not QA's to make.

### What the run prints

A **primary run**, then **six negative-control runs**, as `TESTING_STANDARD.md` §5.6 requires
each separately. For every control each case is classified as *red on an isolation assertion*,
*red on another assertion*, or **STILL GREEN**.

| # | Control | What it breaks |
|---|---|---|
| 1 | the predicate | `tenant_id = ?` removed from the real compiler's output |
| 2 | the resolver | every request is handed Organization B's store |
| 3 | the boundary | the query path reaches the engine without the Core-owned port |
| 4 | D2 reverted | `GetCustomer` back to `auditOnDenial: false` |
| 5 | the group key | the requested identifier is back in it (`0013` control 5) |
| 6 | the write admission | every reservation is replaced with a valid one (`0014` §A.11) |

**Read the STILL GREEN line differently for controls 1–3 than for 4–6.** Controls 1–3 break
tenant isolation, which every case in the isolation and storage-path suites claims to test, so
a case that stays green there is a real coverage gap. Controls 4–6 break one narrow mechanism
each, and most cases legitimately do not touch it — a ceiling-arithmetic case staying green
under the write-admission control is correct, not a gap. What matters for 4–6 is that the cases
which DO claim the mechanism go red.

### Layout

```
harness/runner.ts              the runner, the assertions, and `expectError`
harness/sqlite-d1.ts           node:sqlite behind the D1 port, recording every statement
harness/broken-controls.ts     the deliberately broken storage controls
harness/broken-coordination.ts the deliberately broken coordination controls (0013, 0014)
harness/world.ts               the two-Organization fixture, all synthetic
suites/customer-directory/     the suites
run-customer-directory.ts      the entry point
```

**The breaks are never committed as configuration.** `broken-controls.ts` and
`broken-coordination.ts` contain no edit to `platform/core/**`: the predicate control removes
the tenant term from the REAL compiler's output, the coordination controls wrap the REAL
`in-process-coordinator.ts`, the admission control wraps the REAL `createD1TenantStore`, and
production code has no switch that turns any of it off.

### The request coordinator and the day ledger

Since `docs/decisions/0013` the pipeline requires a `RequestCoordinator`, and since `0014` §A
that coordinator also holds the daily D1 write budget every mutation reserves from. The harness
supplies Core's own `platform/core/protection/in-process-coordinator.ts` — which exists for
exactly this purpose and is marked never-for-deployment. A harness-local coordinator would
verify the harness's algorithm rather than the shipped one.

**The Durable Object adapter is not executed by anything here** — there is no Worker
configuration and no runtime — so persistence, eviction and restart of the coordinator and of
the day ledger are **not covered**, and are reported that way rather than implied by a green
run.

### The index-count check

`storage/write-cost.ts` says, honestly, that nothing can catch a cost declaration that counts
statements correctly and index rows wrongly, because D1 exposes no portable schema
introspection through the binding — so it is "a review obligation, stated as one".

**This harness is not D1.** The migrations are executed into a real SQLite database, so
`PRAGMA index_list` answers what D1 will not, and the write-admission suite computes every
table's true cost from the live schema and compares it with the declared constants and with
what each Action actually reserves. Add an index to a migration without moving the number and
the suite goes red. The review obligation still stands for a **deployed** database whose schema
this harness does not see.
