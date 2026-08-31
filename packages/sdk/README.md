# packages/sdk/ — The Dudo SDK

**Owner: `plugin-agent`** (see `docs/architecture/boundaries.md`)

The first-class SDK that App developers build against — manifest schema, lifecycle,
permission declarations, extension interfaces, and typings.

> Moved here from `packages/plugin-sdk/` by
> `docs/decisions/0004-repository-structure.md`. The rename is meaningful: Dudo extends
> through five kinds of thing — Apps, Capabilities, Connectors, AI Skills, and Templates
> — not one "plugin" concept.

## Surface

Identity · permissions · entities · storage · events · actions · files · notifications ·
workflows · capabilities · AI · MCP · UI extensions · secrets · logging.

**External developers should rarely need to understand Cloudflare directly.** They
develop against Dudo. If a Cloudflare concept leaks into the SDK surface, that is a
design defect.

## The rule that keeps this honest

**Official Apps use exactly this SDK.** No privileged path, no internal shortcut, no
capability available to first-party code and not to third parties. If the SDK is awkward
for us, it is awkward for everyone — and we find out early rather than after publishing
it.

## Rules

- Permissions are **manifest-declared, narrow, tenant-scoped, revocable, and enforced by
  Core on every invocation.** Enforcement never lives in the SDK or in the App.
- The SDK never exposes an API that would let an App widen its own grant, select its
  tenant, or reach Core internals.
- This is a **public surface**: breaking changes require a version and a decision record.
- One action definition generates the internal API, public API, OpenAPI schema, SDK
  method, MCP tool, and documentation. Do not maintain five independent definitions.

*Empty placeholder. The developer platform is Phase 3, and it is blocked on the
permission model and trust ADR — see `docs/decisions/0001-governance-and-decision-sequencing.md`.*
