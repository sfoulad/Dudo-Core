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

*Empty placeholder. No test framework has been selected — `0003` approves TypeScript on
Cloudflare, not a testing framework. Nothing exists to verify yet.*
