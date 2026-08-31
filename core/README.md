# core/ — Domain Layer

**Owner: `core-agent`** (see `docs/architecture/boundaries.md`)

Dudo's domain logic: business rules, application services, APIs, authorization, tenant
isolation, workflows, and auditing.

- **All cross-module contracts originate here**, published to `packages/contracts/**`.
- Authorization is decided here, on every entry point, denying by default.
- Every data path is scoped to exactly one tenant.

Boundaries: `docs/architecture/boundaries.md` · Contributing: `CONTRIBUTING.md`

*Empty placeholder. No application code exists yet and no technology stack has been
selected.*
