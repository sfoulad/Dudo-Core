# plugins/ — Extensibility Layer

**Owner: `plugin-agent`** (see `docs/architecture/boundaries.md`)

The Dudo plugin runtime, host, loader, registry, and first-party reference plugins.

- Plugins reach Core **only** through explicit, versioned contracts.
- **No direct storage access** — no database connections, SQL, ORM models, Core caches,
  or Core files. No exception, including first-party plugins.
- Permissions are declared in the manifest, granted at least privilege, and enforced by
  Core on every call.

Boundaries: `docs/architecture/boundaries.md` · Contributing: `CONTRIBUTING.md`

*Empty placeholder. No application code exists yet and no technology stack has been
selected.*
