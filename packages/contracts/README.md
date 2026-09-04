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
common/         platform-wide shapes every contract reuses — the error envelope, pagination
registries/     the five machine-readable registries (permissions, events, Core objects,
                manifest schemas)
validation/     zero-dependency validators (docs/decisions/0009)
core/<domain>/  Core's own published contracts, one directory per Core domain
apps/<app-id>/  one directory per App, holding that App's contract set
```

Each contract set is three artifacts, all normative together: a `README.md` carrying the
reasoning, the state machines and the open questions; a `*.schema.json` carrying the request
and response shapes; and a `*.contract.yaml` carrying the Action definitions, permissions,
tenancy, audit, HTTP binding and free-tier impact. **A type alone is not a contract**, which
is why the shapes file is never the whole set.

`core/identity` uses **two** files rather than three — the reasoning lives in its
`*.contract.yaml` — and says so in its own header, so a reader does not conclude a `README.md`
was lost. It is also the one set that describes **pre-authentication entry points rather than
Actions**: no permission, no scope, no `ActionContext`, no tenant. That is not a gap in the
set; it is what `docs/decisions/0014` §B's admission rule is.

`core/**` and `apps/**` differ in what they may contain, not in form. A Core contract covers
an object in `registries/core-object-registry.yaml` under a `core.*` permission, and is served
from Core's flat reserved API namespace. An App contract covers the App's own entities and is
served under `/api/v1/apps/<app_id>/...` unless the Team Lead allocates it a flat segment. An
App may never publish a contract over Core's data, and Core contracts carry no business-domain
concept — `Core stays small` is a boundary this directory records rather than one it relaxes.

## Contracts on record

| Contract | Version | Status |
|---|---|---|
| `apps/customers` — Customer Directory | 1 | **Proposed.** Awaiting Team Lead agreement; no consumer implements against it yet. |
| `core/organization` — Business Read | 1 | **Proposed.** Awaiting Team Lead agreement. Resolves `business_id` to a name and lists a principal's authorized Businesses — the gap `app-agent` found while building against the Customer Directory. Closes the *contract* gap only: no Business name is stored anywhere yet and the authorized business set is empty for every principal, both of which belong to the organization-structure slice. See its `README.md` §2 before reporting it as unblocking anything. **Revised 2026-09-04:** the resolve route moved from `GET` with repeated query parameters — a form Core refuses outright, so the Action could not succeed for more than one identifier — to `POST` with a JSON body. Shapes unchanged. |
| `core/identity` — Login | 1 | **Proposed.** Awaiting Team Lead agreement. **This one documents an implementation that preceded it** — `platform/core/identity/login.ts` was built with no contract, out of order under `.claude/rules/workflow.md` §3, and two client agents had to guess the field names from source. It is a transcription, not a specification: where it and Core disagree, Core is what runs. Two files, not three, and it describes pre-authentication entry points rather than Actions. Carries the **normative** client-side KDF parameters and `normalizeIdentifier` definition that both clients must implement byte-identically — including the **NFC** password rule (amended into `0015` §D on 2026-09-04), which is the one rule in any Dudo contract that **Core cannot enforce**, because Core never receives a password. Its only enforcement is shared client test vectors. Note the deliberate asymmetry: **NFC** for the password, **NFKC** plus ASCII-only case folding for the email. **A 200 from login is not a usable session** — see the row below. |
| `core/identity` — Organization selection | 1 | **Proposed.** Awaiting Team Lead agreement, and it **unblocks the deployed platform**: a seeded principal logs in and every business request returns 422 `failed_precondition`, because `selectOrganization` and the Organization picker exist as `SessionResolver` methods with **no HTTP route**. Selection is mandatory for every principal, not only multi-Organization ones. **Mixed provenance** — the two resolver methods are transcribed, the routes and wire shapes are new, and it requires a **third route class** (authenticated at the session level, no `ActionContext`, no tenant) that does not exist yet. Publishes the one route in Dudo where a caller names a tenant. |

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
