# packages/plugin-sdk/ — Plugin SDK

**Owner: `plugin-agent`** (see `docs/architecture/boundaries.md`)

The public surface plugin authors build against: manifest schema, lifecycle hooks,
permission declarations, extension interfaces, and typings.

- The SDK brokers access to Core **only** through contracts published in
  `packages/contracts/**`.
- The SDK never exposes storage, Core internals, or an elevated identity.
- Enforcement lives in Core — the SDK declares and requests, it does not grant.

Boundaries: `docs/architecture/boundaries.md` · Security: `SECURITY.md`

*Empty placeholder. No SDK code exists yet and no technology stack has been selected.*
