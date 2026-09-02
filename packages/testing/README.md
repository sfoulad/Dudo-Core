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

A **primary run**, then **three negative-control runs** — predicate, resolver and boundary
— as `TESTING_STANDARD.md` §5.6 requires each separately. For every control each case is
classified as *red on an isolation assertion*, *red on another assertion*, or **STILL
GREEN**. The third is printed as a coverage gap, because under `0006` Option A a case that
stays green under a deliberately broken control does not test that control, whatever its
name says.

### Layout

```
harness/runner.ts          the runner, the assertions, and `expectError`
harness/sqlite-d1.ts       node:sqlite behind the D1 port, recording every statement
harness/broken-controls.ts the three deliberately broken controls
harness/world.ts           the two-Organization fixture, all synthetic
suites/customer-directory/ the suites
run-customer-directory.ts  the entry point
```

**The breaks are never committed as configuration.** `broken-controls.ts` contains no edit
to `platform/core/**`: the predicate control removes the tenant term from the REAL
compiler's output, so it cannot drift away from the code it tests, and production code has
no switch that turns isolation off.
