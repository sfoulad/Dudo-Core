# packages/ — Shared libraries

Code shared across the platform, Apps, and Connectors.

| Path | Purpose | Owner |
|---|---|---|
| `contracts/` | Cross-module contracts — the only way modules meet | `architecture-agent` |
| `sdk/` | The public SDK App developers build against | `plugin-agent` |
| `testing/` | Test suites and shared test harness | `qa-agent` |

Further shared packages arrive with the phase that needs them — `ui`, `events`,
`security` — each with a single owner.

## Rules

- **Contracts have one author.** `architecture-agent` writes `contracts/`; everyone else
  consumes. Producer and consumers are tested against the published contract.
- A shared package is shared on purpose. Putting something here because two modules
  happened to need it, rather than because it is genuinely common, creates coupling that
  is hard to remove later.
- Nothing here depends on an App, a Connector, or a client.

Boundaries: `docs/architecture/boundaries.md` · Contributing: `CONTRIBUTING.md`
