# tests/ — Verification Layer

**Owner: `qa-agent`** (see `docs/architecture/boundaries.md`)

All Dudo test suites: unit, integration, contract, security, tenant-isolation, and
regression.

- `qa-agent` reads the entire repository but edits **only** this directory.
- Production feature code is never modified here; defects are reported to the owning
  agent through the Team Lead.
- Tests are never weakened, skipped, or stubbed to produce a green run.
- Every feature touching tenant data gets an explicit isolation test: tenant A must not
  read, write, enumerate, or infer tenant B.
- Synthetic data only. Never real customer data, never real secrets.

QA gates integration: `CONTRIBUTING.md`

*Empty placeholder. No tests exist yet and no test framework has been selected.*
