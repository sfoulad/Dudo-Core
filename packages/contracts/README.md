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

## Layout

```
common/        platform-wide shapes every contract reuses — the error envelope, pagination
registries/   the five machine-readable registries (permissions, events, Core objects,
              manifest schemas)
validation/   zero-dependency validators (docs/decisions/0009)
apps/<app-id>/ one directory per App, holding that App's contract set
```

Each App contract set is three artifacts, all normative together: a `README.md` carrying the
reasoning, the state machines and the open questions; a `*.schema.json` carrying the request
and response shapes; and a `*.contract.yaml` carrying the Action definitions, permissions,
tenancy, audit, HTTP binding and free-tier impact. **A type alone is not a contract**, which
is why the shapes file is never the whole set.

## Contracts on record

| Contract | Version | Status |
|---|---|---|
| `apps/customers` — Customer Directory | 1 | **Proposed.** Awaiting Team Lead agreement; no consumer implements against it yet. |

## Form, and what is not yet decided

**AS1 — the executable form and transport of a Dudo contract is still undecided**
(`API_STANDARD.md` §13). Contracts here follow the precedent this directory already set —
**JSON Schema draft 2020-12** for shapes, **YAML** for registries and Action metadata —
rather than selecting a new form. That keeps the contract language-neutral, which matters
because `Dudo-Apple` is Swift. No framework, library, ORM or npm package is selected by any
contract here, and none may be installed to consume one.

**Nothing in this directory is executed.** There is no JSON Schema implementation in this
repository, no `package.json` and no `node_modules`, so every schema here is normative and
hand-checked, never machine-validated. Cross-file `urn:` `$ref`s require a resolver that
does not exist yet. No report may describe these schemas as validated.
