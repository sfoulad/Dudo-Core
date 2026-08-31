# packages/contracts/ — Shared Contracts

**Owner: `core-agent`** (see `docs/architecture/boundaries.md`)

The single source of truth for how Dudo's modules talk to each other. Every boundary
crossing in the system is defined here.

- **Only Core authors contracts.** `app-agent` and `plugin-agent` consume them and must
  never edit this directory.
- A contract defines the request shape, the response shape, the error cases, the
  authorization expectation, and the tenant scope. A type alone is not a contract.
- Contracts are versioned. Additive changes may proceed; a breaking change to a
  published contract requires Team Lead review and a decision record.
- `qa-agent` tests producer and consumer against every published contract.

Contract-first sequencing: `CONTRIBUTING.md`

*Empty placeholder. No contracts exist yet and no technology stack has been selected.*
