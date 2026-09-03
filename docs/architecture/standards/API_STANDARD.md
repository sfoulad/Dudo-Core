# API Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every internal API, public API, and capability API in Dudo.
- **Depends on:** `CONSTITUTION.md` Rules 4, 8, 9; `AUTHORIZATION_STANDARD.md`; `MULTITENANCY_STANDARD.md`.

---

## 1. The Action definition

Everything in this document follows from one idea: **an operation is defined once.**

An **Action** is a named, authorized, validated, tenant-scoped business operation. From
one definition the platform derives the internal API, the public API, the OpenAPI schema,
the SDK method, the MCP tool, and the documentation (`ARCHITECTURE.md` §4). Writing five
definitions produces four definitions and a bug.

Required fields on every Action:

| Field | Meaning |
|---|---|
| `id` | `<namespace>.<ActionName>` — `appointments.CreateAppointment`. Namespace is `core` or an App id. |
| `title`, `description` | Human- and AI-readable. The description is what an AI model sees when choosing a tool, so it states *what it does and when to use it*, not how it is implemented. |
| `input` | Schema. Unknown fields are rejected, not ignored. |
| `output` | Schema. |
| `errors` | The closed set this Action may return. |
| `permission` | Exactly one permission id from `permission-catalog.yaml`. |
| `scope` | The scope level at which the permission is evaluated. |
| `sensitivity` | `read` · `write` · `sensitive` · `critical` (`AUTHORIZATION_STANDARD.md` §6). |
| `idempotent` | Whether repeating it with the same key is safe. |
| `exposure` | Any of `internal`, `public`, `mcp`. Absent means internal only. |
| `audit` | Whether it emits an audit event. Mandatory `true` for `sensitive` and `critical`. |

**Exposure is opt-in.** An Action is internal unless it says otherwise. Nothing becomes
public, and nothing becomes an AI tool, by default or by accident.

---

## 2. Internal API

Between Dudo's own services.

- **Service Bindings/RPC**, never public HTTP between Workers (`CONSTITUTION.md` Rule 4;
  `CLOUDFLARE_STANDARD.md` §3).
- Not publicly reachable. Not reachable by an App except through the SDK against a
  published contract.
- **A caller is never trusted to have authorized.** The callee authorizes, every call,
  itself. Internal is a network property; it is not a trust property.
- Every internal call carries the propagated context: tenant, principal, request id,
  correlation id. A call without them is rejected rather than defaulted.

---

## 3. Public Business API

For customers, the web and Apple clients, external developers, partners, and Connectors.

Every public request requires, in the order of `ARCHITECTURE.md` §3: authentication,
server-derived tenant, authorization, schema validation, rate limiting, idempotency where
applicable, and audit logging.

---

## 4. Capability API

Standard interfaces implemented by providers — `Payment.capture()`,
`Shipping.createShipment()`, `Messaging.send()`, `AI.extractInvoice()`. Governed by
`CAPABILITY_STANDARD.md`. Capability actions follow every rule in this document for
schemas, errors, idempotency, and versioning.

---

## 5. Paths and namespacing

```
/api/v1/<resource>                    Core and registered official Apps
/api/v1/apps/<app_id>/<resource>      every other App
```

**Why the split.** A path such as `/api/v1/customers` assumes a single flat resource
namespace, which cannot survive a marketplace where any developer may publish an App with a
`customers` resource. Two Apps would collide, and whichever installed second would break
the first. Reserving the flat namespace for Core and *registered* official Apps keeps the
short, readable paths valid while making third-party Apps safe by construction.

This is `architecture-agent`'s resolution of a genuine gap and needs Team Lead confirmation
(`CONSTITUTION.md` C4).

Rules:

- Resources are plural, kebab-case: `/api/v1/purchase-orders`.
- Nesting expresses ownership, at most one level: `/api/v1/orders/{order_id}/lines`.
- No verbs in paths. An operation that is not CRUD-shaped is a sub-resource action:
  `POST /api/v1/orders/{id}/cancel` — mapped to an Action, still one definition.
- Identifiers in paths are opaque. **Never a sequential integer** — enumerable ids invite
  enumeration, and in a multi-tenant product enumeration is a data-exposure test anyone
  can run.
- The flat namespace is allocated in a registry Core owns. Two Apps never hold one path.

---

## 6. Versioning

**Public API version** is in the path: `/api/v1/...`. A breaking change requires
`/api/v2/...`.

**Breaking**, always:

- removing or renaming a field, endpoint, or error code;
- making an optional request field required;
- narrowing an accepted value set, or widening a returned one that callers switch on;
- changing a field's type, units, format, or meaning;
- changing default behaviour when a field is omitted;
- changing the permission an Action requires, or its scope;
- changing pagination or sort semantics;
- tightening a rate limit or quota below a previously documented level.

**Additive**, safe within a version:

- a new endpoint or a new Action;
- a new optional request field with a backward-compatible default;
- a new response field (clients must ignore unknown fields — stated normatively here so
  that adding a field is never a breaking change by accident);
- a new error code for a *new* condition, never for an existing one.

Every contract change is labelled additive or breaking in its pull request. A breaking
change to a published contract requires Team Lead review and a decision record.

**Deprecation.** A deprecated endpoint keeps working for a stated window, returns a
`Deprecation` and a `Sunset` header, is marked deprecated in the OpenAPI schema, and is
announced before it is removed. Removing an endpoint that a published App depends on
breaks a customer's business, not a developer's build.

---

## 7. Request and response

- JSON, UTF-8.
- **Unknown request fields are rejected** with `invalid_argument`. Silently ignoring them
  means a client's typo becomes a silent behaviour change.
- **Unknown response fields are ignored by clients.** This is what makes §6's additive
  rule true.
- Timestamps are RFC 3339, UTC, with an explicit offset. Never a bare local time.
- Money is a minor-unit integer plus an ISO 4217 currency code. **Never a float.**
- Field names are `snake_case` on the wire, consistently, everywhere.
- Enumerations are lowercase strings, never integers. An integer enum is unreadable in a
  log and impossible to extend safely.

**Collections** return `{ "data": [...], "next_cursor": "..." }`. Cursor pagination only —
offset pagination is inconsistent under concurrent writes and expensive at depth. Every
collection endpoint has a default page size and a maximum, both documented.

---

## 8. Errors

One shape, everywhere:

```json
{
  "error": {
    "code": "invalid_argument",
    "message": "start_time must be before end_time",
    "details": [{ "field": "start_time", "issue": "must_precede_end_time" }],
    "request_id": "req_01J..."
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_argument` | 400 | Failed schema or semantic validation |
| `unauthenticated` | 401 | No valid principal |
| `forbidden` | 403 | Authenticated, not permitted |
| `not_found` | 404 | Does not exist **or is not visible to this tenant** |
| `conflict` | 409 | State conflict, or an idempotency key reused with different input |
| `failed_precondition` | 422 | Valid input, wrong system state |
| `rate_limited` | 429 | Too many requests; carries `retry_after_seconds` |
| `quota_exceeded` | 429 | Write budget or plan limit reached; carries `retry_after_seconds`. **Reads are never refused for budget** (`0014` §A.10) |
| `internal` | 500 | Unexpected failure |
| `not_implemented` | 501 | Declared but not available |
| `unavailable` | 503 | Dependency down; retryable |
| `timeout` | 504 | Upstream did not answer in time |

**`not_found` for cross-tenant access, never `forbidden`.** Returning `forbidden` confirms
the resource exists, which is a cross-tenant information leak achievable with a single
request. This rule is not negotiable and is tested (`TESTING_STANDARD.md` §5).

`message` is for a developer. It never contains business data, another tenant's
identifiers, a stack trace, a query, or internal structure. `details` is machine-readable
and follows the same restriction.

---

## 9. Idempotency

- Every unsafe operation (`POST`, `PATCH`, `DELETE`) accepts an `Idempotency-Key` header.
- **Actions marked `idempotent: true` require one.** Money movement, message sending, and
  external side effects are always in this set.
- The key is scoped to tenant + principal + Action. Same key, same input → the original
  response. Same key, different input → `conflict`.
- Records are retained for a documented window, stated in the API documentation so callers
  know how long a retry is safe.

---

## 10. Rate limiting and quotas

- Limits are per tenant **and** per principal. A per-tenant-only limit lets one runaway
  integration deny service to that tenant's humans.
- **`rate_limited` and `quota_exceeded` carry `retry_after_seconds` in the error envelope**
  (`packages/contracts/common/error-envelope.schema.json`, added by `0014`). The **envelope is
  the source of truth and the `Retry-After` header is derived from it**, never the reverse —
  internal, SDK and MCP callers never see HTTP headers and must get the same value.
  It is **absent** on every other code, structurally: the envelope's `allOf` makes a retry
  time beside a `not_found` fail validation.
- **The value must come from a fixed window boundary** — the end of the rate window, or the
  next 00:00 UTC reset — so it is **the same for every caller at that instant**. It must
  **never** be derived from observed usage, remaining budget, queue depth, current load or
  attempt count. *A retry time that is a function of the calendar discloses nothing; a retry
  time that is a function of the system's state discloses the system's state.*
- It is **optional even on those two codes**. A degraded coordinator has no value to give, and
  a required field is a field someone invents a number for. A refusal with no retry time is
  valid; the client falls back to the next UTC midnight from its own clock.
- Quotas come from the tenant's plan and return `quota_exceeded`, which is a *different*
  condition from rate limiting: one is "slow down", the other is "upgrade or stop".
- **`quota_exceeded` must be evaluated before any record is resolved.** Below that point it
  is reachable only when the target exists in the caller's tenant, and a caller who
  deliberately exhausts a budget it controls can use it to distinguish "in my Organization"
  from "not" — a cross-tenant existence oracle built out of a capacity control (`0014`).
- Limits are documented per endpoint. An undocumented limit is indistinguishable from an
  outage.

---

## 11. Observability and correlation

Every request carries `request_id`, `tenant_id`, `principal_id`, `app_id`,
`correlation_id`, propagated across internal calls, queue messages, workflow steps, and
connector calls. `request_id` is returned to the caller in every response, success or
error — it is what makes a support conversation possible without asking a customer to
share their data.

---

## 12. Verification checklist

- [ ] Every operation is an Action with all §1 fields; no logic in a route handler.
- [ ] Exposure is explicit; nothing public or MCP-visible by default.
- [ ] Permission and scope declared and present in `permission-catalog.yaml`.
- [ ] Path follows §5; no verbs, no sequential ids, namespace allocated.
- [ ] Change labelled additive or breaking against §6; breaking changes have a record.
- [ ] Unknown request fields rejected.
- [ ] Money as minor-unit integer + currency; timestamps RFC 3339 UTC.
- [ ] Cursor pagination with documented default and maximum page size.
- [ ] All errors in the §8 shape and taxonomy.
- [ ] Cross-tenant access returns `not_found`, verified by test.
- [ ] Error messages contain no business data, no internals, no other tenant's ids.
- [ ] Idempotency key accepted, and required where `idempotent: true`.
- [ ] Rate limit and quota behaviour documented.
- [ ] OpenAPI schema regenerated from the Action definitions, not hand-edited.

---

## 13. Open questions

| # | Question | Recommendation |
|---|---|---|
| AS1 | **The contract's executable form** — TypeScript types, JSON Schema, or a generated IDL — and its transport. `0003` approves no library, so nothing can be assumed. | JSON Schema (draft 2020-12) as the normative artifact with TypeScript types generated from it. This keeps the contract language-neutral, which matters because `Dudo-Apple` is Swift. **Needs an ADR before the first contract is written.** |
| AS2 | **OpenAPI generation** requires tooling, and no npm package is approved. | Define Action metadata to be sufficient for generation now; the generator is a separate decision. Until then the OpenAPI schema is hand-maintained and that is stated as a known risk. |
| AS3 | **Public API authentication mechanism** — sessions, API keys, OAuth — is unrecorded. §33 requires authentication but names no scheme. | Needs an ADR alongside the identity work in Phase 1. Nothing in this standard depends on the scheme. |
| AS4 | **Flat-namespace allocation for official Apps** (§5) creates a registry Core must own and a review step for every official App. | Accept; record the allocation in the Core object registry when Phase 2 builds the App registry. |
