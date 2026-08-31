# platform/core/ — Domain and Core services

**Owner: `core-agent`** (see `docs/architecture/boundaries.md`)

The domain: business rules, application services, APIs, authorization, tenant isolation,
workflows, and auditing.

- **Authorization is decided here**, explicitly, on every entry point, denying by
  default. Never trust that a caller already checked.
- **Every operation is tenant aware.** Tenant identity is derived from the authenticated
  server-side context — never from client input, a header the caller controls, an
  extension, or an ambient default. A query without tenant scope is a defect.
- **Audit what matters**: money movement, permission changes, tenant membership changes,
  data export, and destructive operations.
- **Core stays small.** Platform primitives only — business-specific functionality
  belongs in an App under `apps/` or a Capability.
- **Cloudflare stays replaceable.** No Cloudflare type, client, or binding in domain
  logic; storage, queuing, and object access sit behind Core-owned interfaces.
- Does not depend on `platform/web/`, `apps/`, or `connectors/`.

Contracts are **not** authored here. `architecture-agent` owns `packages/contracts/**`;
Core implements against them. That separation is deliberate — the agent that implements a
contract must not also be the one who approves it.

Boundaries: `docs/architecture/boundaries.md` · Stack:
`docs/decisions/0003-technology-stack-typescript-on-cloudflare.md` · Contributing:
`CONTRIBUTING.md`

*Empty placeholder. No application code exists yet; the Core platform is Phase 1.*
