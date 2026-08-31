# packages/contracts/ — Shared Contracts

**Owner: `architecture-agent`** (see `docs/architecture/boundaries.md`)

The single source of truth for how Dudo's modules talk to each other. Every boundary
crossing in the system is defined here.

- **Only `architecture-agent` authors contracts.** `core-agent`, `web-agent`,
  `plugin-agent`, and `app-agent` consume them and must never edit this directory.
  Authorship moved here from `core-agent` by
  `docs/decisions/0004-repository-structure.md`: the agent that implements a contract
  must not also be the one who approves it.
- A contract defines the request shape, the response shape, the error cases, the
  **authorization expectation**, and the **tenant scope**. A type alone is not a contract.
- Contracts are **versioned**. Additive changes may proceed; a breaking change to a
  published contract requires Team Lead review and a decision record.
- **One contract set, two clients.** The responsive web client and the Apple client
  consume the same contracts. A shape one has and the other does not is a defect, not a
  local workaround.
- `qa-agent` tests the producer and **both** consumers against every published contract.
- A missing contract **blocks** the consumer. It is requested from the Team Lead — never
  stubbed, guessed, or worked around.

Contract-first sequencing: `CONTRIBUTING.md`

*Empty placeholder. No contracts exist yet. `0003` approves TypeScript on Cloudflare, so
contracts can now be executable — but the transport and versioning mechanics are still
undecided.*
