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

## What exists

The Phase 1 platform primitives the first vertical slice needed, and nothing else. Every
one passes the four-question inclusion test in `docs/architecture/standards/CORE_BOUNDARIES.md`
§2; **no industry noun appears in any of them.**

| Path | Primitive |
|---|---|
| `kernel/` | Result, the closed error taxonomy, opaque identifiers, the clock |
| `tenancy/` | Request and Action context, `TenantStoreResolver`, the Business directory port |
| `storage/` | The storage port, the predicate language, and the adapters |
| `authorization/` | The scope ladder, the authorizer, and the Business-scope decisions |
| `audit/` | The audit record, the sink port, and its store-backed writer |
| `action/` | The Action definition and the pipeline that enforces the evaluation order |
| `validation/` | A zero-dependency input validator |
| `pagination/` | Signed, tenant-bound cursors |
| `http/` | The router, the response envelope, and the Worker adapter |
| `platform/` | The platform route class, platform authority, and the operator action log (`0025`) |
| `migrations/` | `audit_event`. **Reviewed, not applied** — there is no migration runner |

> **This table has fallen behind the code and is not repaired here.** `identity/`,
> `organization/` and `protection/` also exist and are not listed; each arrived with a
> different slice, and correcting the whole of it touches documentation several agents'
> work is described by. Reported to the Team Lead rather than half-rewritten. The
> `platform/` row and the adapter list below are corrected because this slice made them
> wrong.

**Six files may name a Cloudflare type** (`CLOUDFLARE_STANDARD.md` §2):
`storage/adapters/d1/d1-store.ts`, `identity/adapters/d1/d1-control-plane-store.ts`,
`identity/adapters/d1/d1-credential-store.ts`,
`platform/adapters/d1/d1-platform-store.ts`,
`protection/adapters/durable-objects/coordinator-object.ts`, and
`http/adapters/worker-entry.ts`. A grep for `D1Database`, `R2Bucket`, `Queue`,
`DurableObjectNamespace`, `Fetcher`, `WorkflowEntrypoint`, `ExecutionContext` or `Env`
anywhere else must come back empty. It said "two" until this slice; four of the six
arrived with the identity, protection and platform slices.

**The runtime serves nothing, and that is correct.** No authentication mechanism is
recorded (AZ2) and `TenantDirectoryEntry` is not built, so a deny-all principal resolver
and an empty tenant mapping are wired deliberately. Both fail closed. See
`http/adapters/worker-entry.ts`.

**Not authored here:** the Worker configuration file, which is shared configuration and
belongs to the Team Lead.
