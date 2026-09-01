# Capability Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** `platform/capabilities/**`, every App that requests a capability, every Connector that provides one.
- **Depends on:** `CONSTITUTION.md` Rule 6, `API_STANDARD.md`, `CONNECTOR_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/capability-manifest.schema.json`.

---

## 1. The rule

**Apps request capabilities, not vendors.**

```
E-commerce App                     never                E-commerce App
      ├── Payment                                             ├── Stripe
      ├── Messaging                                           ├── Twilio
      └── Shipping                                            └── DHL
```

An App declares `capabilitiesRequired: ["payment@1"]`. A tenant chooses which provider
serves it. The App's source contains no vendor name, no vendor-shaped field, and no
conditional on which provider is active.

**Why this is absolute:** the vendor list is the part of a business platform that changes
most and is decided by the customer, not by us. A payment provider that is acceptable in
Bahrain may be unavailable in Germany. An App coupled to a vendor is an App that cannot be
sold in the next market, and rewriting it later means rewriting every App at once.

**The leak test.** If you can tell which provider is configured by reading the App's code,
its data model, its error handling, or its UI copy, the capability interface has leaked
and the capability is defective — not the App.

---

## 2. What a Capability is

A **Capability** is a versioned, vendor-neutral contract: a named set of Actions with
declared inputs, outputs, and a closed error set, plus the semantics a provider must
honour.

A Capability is not:

- an SDK for a vendor with the names filed off;
- the union of every feature every provider offers;
- a passthrough that forwards arbitrary provider-specific options.

It is the **intersection that is genuinely portable**, plus an explicit, declared
extension point for the rest (§6).

---

## 3. Capability domains

The recognised domains. This list is the record of them. Each needs its own contract before
use; none is specified yet.

`payment` · `messaging` · `email` · `shipping` · `maps` · `ocr` · `search` ·
`files` · `notifications` · `approval` · `ai` · `accounting` · `identity` · `iot`

Illustrating the shape — `payment@1` would define
`AuthorizePayment`, `CapturePayment`, `RefundPayment`, `GetPaymentStatus`. The E-commerce
App does not care which provider implements them.

**Adding a domain requires Team Lead review.** Two capabilities that overlap are worse
than one that is slightly too broad, because Apps then split across both and neither can
be replaced.

---

## 4. Defining a Capability

A capability manifest declares:

| Field | Requirement |
|---|---|
| `id` | Kebab-case domain name, unique |
| `version` | Integer, starting at 1. `payment@1` |
| `actions` | Each with input schema, output schema, closed error set, idempotency, and required permission |
| `errors` | The **closed** taxonomy every provider maps into |
| `events` | Any events the capability layer publishes |
| `configuration` | Per-tenant settings a provider needs, with secrets **by reference only** |
| `semantics` | The behaviour a provider must honour, in prose that is testable |
| `conformance` | The test suite every provider must pass |

**`semantics` is not optional prose.** If `CapturePayment` may be called twice with the
same idempotency key and must charge once, that is a semantic requirement and a
conformance test, not a footnote. A capability whose semantics are undefined is a
capability whose providers behave differently, which defeats the entire mechanism.

---

## 5. Providers and resolution

- A **Connector** implements exactly one capability version for exactly one vendor
  (`CONNECTOR_STANDARD.md`).
- Multiple providers may be installed for one capability in one tenant.
- **Resolution is per tenant and explicit.** The tenant's configuration selects the
  provider. There is no global default provider chosen by the platform, and no automatic
  failover between providers — silently retrying a payment on a second provider is a way
  to charge a customer twice.
- Where Core is the default provider (search, notifications, files —
  `CORE_BOUNDARIES.md` §4), that default is still a recorded per-tenant selection, not an
  implicit fallback.
- Resolution happens in the capability layer, in Core's trust boundary. **The App never
  sees the provider identity** and has no API to ask for one.

---

## 6. Provider-specific behaviour

Real providers differ. Two escape hatches, both explicit, and nothing else:

1. **Declared optional actions.** A capability may mark an action optional. An App checks
   support through the capability layer (`supports('payment@1.RefundPartial')`) and
   degrades deliberately. It still never names the provider.
2. **Opaque provider metadata.** Responses may carry a `providerMetadata` object that the
   App may store and display but **may not branch on**. It is for support and
   reconciliation, not for logic.

Anything else — a vendor-shaped field, an options blob forwarded verbatim, a
provider-specific error surfaced raw — is a capability defect. Fix the capability.

---

## 7. Versioning

- Capability versions are integers: `payment@1`, `payment@2`.
- **Additive** — a new optional action, a new optional input field, a new optional
  response field. Same version.
- **Breaking** — removing or renaming an action, making an optional input required,
  changing a semantic guarantee, removing an error code, changing an error's meaning. New
  version.
- Two versions may run concurrently. A provider declares which versions it implements.
- An App declares the version it requires; installation fails if no installed provider
  satisfies it. Failing loudly at install is correct: the alternative is failing at the
  moment a customer tries to pay.

---

## 8. Errors

Every capability declares a **closed** error set. Providers map their own errors into it;
a provider error that reaches an App unmapped is a Connector defect.

Baseline codes every capability includes, extended per domain:

`invalid_argument` · `unauthenticated` · `forbidden` · `not_found` ·
`failed_precondition` · `conflict` · `rate_limited` · `provider_unavailable` ·
`provider_rejected` · `timeout` · `not_supported` · `internal`

`provider_rejected` carries a non-branchable reason string for display. `not_supported` is
returned for optional actions a provider does not implement — never a silent no-op, which
would leave the App believing work happened.

---

## 9. Security

- Provider credentials are **tenant-scoped, referenced by name, and never visible to an
  App**. An App that can read a payment credential can move money outside the platform.
- A capability invocation is authorized like any other Action: the App's manifest declares
  the permission, Core enforces it, and the audit record names the App, the principal, the
  tenant, and the capability — but never the credential.
- Every capability call carries tenant context end to end, including into the Connector's
  outbound request and back through its callbacks.
- Capability invocations that move money, send messages on the tenant's behalf, or expose
  customer data are **sensitive** and always audited (`SECURITY_STANDARD.md` §6).

---

## 10. Conformance

A Connector is not a provider until it passes the capability's conformance suite. The
suite is owned by `qa-agent`, lives with the capability, and tests semantics — not just
shapes:

- every required action, with valid and invalid input;
- the full declared error set, each code produced by a real condition;
- idempotency where the capability declares it;
- tenant isolation: a call in tenant A never reaches tenant B's provider configuration;
- credential handling: no credential in any log, error, or response.

**A capability with no conformance suite may not be published.** Without it, "implements
the Payment capability" is an unverified claim, and the whole substitution model rests on
that claim being true.

---

## 11. Verification checklist

- [ ] Capability manifest validates against `capability-manifest.schema.json`.
- [ ] Actions have input schema, output schema, closed error set, idempotency stated.
- [ ] Semantics written and testable; conformance suite exists.
- [ ] No vendor name in the capability definition.
- [ ] No field whose meaning depends on which provider is active.
- [ ] Version integer set; additive-vs-breaking assessed against §7.
- [ ] Credentials referenced by name only; none in the manifest.
- [ ] Every requesting App declares the capability and version in its manifest.
- [ ] Provider resolution is per tenant and explicit; no implicit fallback.

---

## 12. Open questions

| # | Question | Recommendation |
|---|---|---|
| CP1 | **Which capability is specified first.** Phase 5 lists payments, messaging, email, shipping, accounting, IoT with no order. | `payment@1` first — it is the one with the hardest semantics (idempotency, money, partial refunds). If the capability model survives payment, it survives the rest. |
| CP2 | **The AI capability's action set** is specified (`AI_STANDARD.md`) but no provider is approved. | Define the interface now; provider selection blocked on an ADR. `AI_STANDARD.md` §2. |
| CP3 | **Whether a tenant may run two providers of one capability simultaneously** (e.g. two payment gateways for different currencies). Not addressed by the plan. | Allow it, with the App selecting by *declared capability attributes* (currency, region) rather than by provider identity. Needs a contract mechanism; flagged before `payment@1` is written. |
