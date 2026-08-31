# platform/capabilities/ — Capability registry and App runtime

**Owner: `plugin-agent`** (see `docs/architecture/boundaries.md`)

The registry of capabilities Apps can request, and the runtime that installs, loads, and
brokers Apps. This is where untrusted code meets a multi-tenant business platform —
design as though every App is hostile, because one day one will be.

> Moved here from `plugins/` by `docs/decisions/0004-repository-structure.md`.

## Capabilities

Apps request **capabilities**, not vendors. `Payment`, not `Stripe`. A capability defines
standard actions — `AuthorizePayment`, `CapturePayment`, `RefundPayment`,
`GetPaymentStatus` — and any number of Connectors under `connectors/` can implement them.
The App does not know which provider answers.

Same principle for messaging, shipping, email, maps, AI, OCR, IoT, accounting, identity.

## Non-negotiable rules

- **Apps reach Core only through explicit, versioned contracts.** No implicit access, no
  internal imports, no reaching past the interface.
- **No direct storage access, ever.** An App or the runtime must never open a database
  connection, issue SQL, use a Core ORM model, read Core caches, or touch Core files or
  object storage. **No exception for official Apps.**
- **No bypassing authorization.** Every brokered call is authorized by Core, in Core, on
  every invocation. The runtime never carries an elevated identity on an App's behalf,
  never caches an authorization decision past its scope, and never lets an App choose its
  own tenant.
- **Least privilege by construction.** Permissions are declared in the App manifest,
  granted narrowly, scoped to one tenant, revocable, and enforced at the boundary — not
  merely documented. An App that declares nothing gets nothing.
- **Isolation is the default.** App failure, hang, or resource exhaustion must not take
  down the host or leak across tenants.

## Blocked until decided

Per `docs/decisions/0001-governance-and-decision-sequencing.md`, no runtime or SDK work
begins until **both** exist and are accepted: the logical permission model, and the
permission and trust ADR. The **technical isolation mechanism** is still unrecorded —
`0003` approves TypeScript on Cloudflare but does not approve Workers for Platforms,
which needs its own decision.

*Empty placeholder. The application runtime is Phase 2.*
