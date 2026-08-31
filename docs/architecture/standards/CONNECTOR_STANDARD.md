# Connector Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** everything under `connectors/**`.
- **Depends on:** `CAPABILITY_STANDARD.md`, `SECURITY_STANDARD.md`, `MULTITENANCY_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/capability-manifest.schema.json` (`kind: provider`).
- **Source:** master build plan §2, §9, §13.

A Connector is the only place in Dudo where a vendor's name is allowed to appear.

---

## 1. Scope of a Connector

**One Connector implements one capability version for one vendor.**

`connectors/payment-stripe/` implements `payment@1` against Stripe. Not `payment@1` and
`accounting@1`. Not Stripe and Adyen. Not `payment@1` and `payment@2` unless the vendor's
own surface genuinely serves both — and then the manifest declares both explicitly.

**Why one:** a Connector is the unit a tenant enables, audits, rate-limits, and revokes.
A Connector spanning two capabilities cannot be revoked for one of them, which turns a
narrow grant into a broad one.

---

## 2. What a Connector may do

- Call the external vendor, over the network, within its declared egress allowlist.
- Translate between the capability contract and the vendor's API, in both directions.
- Receive vendor callbacks and webhooks, and translate them into capability results or
  platform events.
- Hold **no** business logic of its own.

## 3. What a Connector may never do

| Prohibited | Why |
|---|---|
| Open a database connection, issue SQL, use a Core model, read a Core cache, touch Core files | `.claude/rules/security.md` §4. No exception, first-party included. |
| Import Core internals, or any App | It implements a contract; it knows nothing else about Dudo. |
| Select, infer, or default its own tenant | Tenant arrives in the invocation context. A Connector that picks a tenant is a cross-tenant vulnerability. |
| Hold a credential in source, config, or its manifest | Credentials are referenced by name and resolved at call time, tenant-scoped. |
| Log, echo, or return a credential, token, signature, or full card/account number | `SECURITY_STANDARD.md` §5. |
| Call a host outside its declared allowlist | Undeclared egress is undetectable exfiltration. |
| Surface a vendor error verbatim to an App | Map into the capability's closed error set (`CAPABILITY_STANDARD.md` §8). |
| Retry a non-idempotent operation without an idempotency key | Duplicate charges, duplicate shipments, duplicate messages. |
| Interpret business meaning — deciding *whether* to refund, *which* carrier to use | That is the App's decision, expressed through the capability call. |

---

## 4. Required structure

```
connectors/<capability>-<vendor>/
  manifest.json      required — kind: provider, validates against the schema
  README.md          vendor, capability version, required credentials by NAME,
                     supported optional actions, known limitations
  adapter/           request/response translation. The only vendor-shaped code.
  webhooks/          inbound callback handlers
  tests/             owned by qa-agent; includes the capability conformance suite
```

Directory names and the manifest `id` follow `<capability>-<vendor>`, kebab-case, so the
relationship is legible without opening a file.

---

## 5. Credentials

1. Declared **by name** in the manifest, with the scope they need and what they are for.
2. Stored in the approved secret store, per tenant, per Connector installation.
3. Resolved at invocation, scoped to the tenant of the call, never cached across calls of
   different tenants, never held beyond the invocation.
4. Never logged, never echoed in an error, never included in a capability response, never
   readable by an App.
5. Rotation and revocation are supported without redeploying the Connector. A credential
   that can only be changed by a deploy will not be rotated when it needs to be.

**The secret store itself is not selected.** `0003` approves no secret-management product
beyond Worker secret bindings. Connectors are written against a Core-owned secret
*resolution interface*, and the backing store is a Team Lead decision. Flagged in §12.

---

## 6. Egress control

- Every Connector declares its allowlist of external hosts in its manifest. Undeclared
  hosts are denied.
- Outbound calls go through the SDK's egress helper so that logging, timeouts, retries,
  and the allowlist check happen in one place. A Connector calling the network directly
  bypasses all four.
- Timeouts are explicit on every call. A Connector with no timeout is a Connector that
  consumes a Worker's CPU budget waiting on someone else's outage.
- Retries use bounded exponential backoff with jitter, only for retryable conditions, and
  **only with an idempotency key for anything that changes state**.

The master plan's enforcement mechanism for egress is the Workers for Platforms outbound
Worker (§13), which is **not approved** (`0003`). Until it is, the allowlist is declared
in the manifest and enforced in the SDK egress helper. That is enforcement inside the
Connector's own runtime rather than outside it — weaker, and stated as weaker. See §12.

---

## 7. Webhooks and callbacks

Inbound traffic from a vendor is untrusted input arriving at a public endpoint. In order:

1. **Verify the signature** using the tenant-scoped signing secret. No signature, no
   processing. An unverified webhook is an anonymous internet user writing to your
   database.
2. **Resolve the tenant from the installation**, keyed by the endpoint or a platform-issued
   opaque identifier — **never from a field in the payload**. A payload field is
   attacker-controlled, and trusting one is a cross-tenant write.
3. **Replay-protect**: reject stale timestamps, deduplicate by vendor event id.
4. **Validate** against the expected schema; reject unknown shapes rather than
   best-effort parsing.
5. **Translate** into a capability result or a registered platform event.
6. **Acknowledge fast, process asynchronously.** Vendors retry on timeout, so slow
   processing multiplies load exactly when the system is already struggling.
7. **Audit** the receipt with tenant, connector, vendor event id, and outcome.

---

## 8. Idempotency

- Every state-changing capability action carries an idempotency key from the caller.
- The Connector forwards it to the vendor where the vendor supports one, and enforces it
  locally where the vendor does not.
- The same key with the same input returns the original result. The same key with
  *different* input is `conflict` — never a second execution.

Payments make this concrete: a network timeout on `CapturePayment` tells you nothing about
whether the customer was charged. Only an idempotency key does.

---

## 9. Error mapping

Every vendor error maps into the capability's closed error set. The mapping is written
down in the Connector's README and tested. Unmapped errors become `internal` and are
logged with the vendor's identifier — **not** with the vendor's raw message, which may
contain customer data or credential fragments.

Distinguish retryable from terminal. Retrying a terminal decline is a way to get a
customer's card blocked.

---

## 10. Tenant isolation

- Every call, callback, log line, metric, cache entry, and stored artifact carries the
  tenant.
- Connection state, tokens, and any client object are **per tenant** and never reused
  across tenants — a pooled vendor client holding tenant A's credentials and serving
  tenant B's call is the archetypal multi-tenant breach.
- `qa-agent` writes an isolation test per Connector: tenant A's call never reaches tenant
  B's configuration, credentials, or callback endpoint.

---

## 11. Verification checklist

- [ ] Manifest validates, `kind: provider`, one capability version, one vendor.
- [ ] Capability conformance suite passes (`CAPABILITY_STANDARD.md` §10).
- [ ] Every credential declared by name; none in source, config, manifest, or fixture.
- [ ] Egress allowlist declared; every outbound call goes through the egress helper.
- [ ] Explicit timeout on every outbound call.
- [ ] Retries bounded, jittered, and idempotency-keyed for state changes.
- [ ] Webhook signature verified before any processing.
- [ ] Webhook tenant resolved from the installation, never from the payload.
- [ ] Every vendor error mapped into the closed set; mapping documented and tested.
- [ ] No credential, token, signature, or full instrument number in any log or error.
- [ ] Tenant isolation test present and passing.
- [ ] No storage access, no Core imports, no business logic.

---

## 12. Open questions

| # | Question | Recommendation |
|---|---|---|
| CN1 | **Secret store.** `0003` approves no secret-management product; Worker secret bindings are per-Worker, not per-tenant, so they cannot hold a tenant's vendor credentials. | Needs its own ADR before the first Connector. Recommend a Core-owned, tenant-scoped credential service with envelope encryption over approved storage — but the mechanism is a decision, not a standard. **This blocks Phase 5.** |
| CN2 | **Egress enforcement** without Workers for Platforms is in-runtime, so a compromised Connector could bypass it. | Accept for first-party Connectors; **do not admit third-party Connectors** until an out-of-runtime enforcement record exists. |
| CN3 | **Where a Connector executes.** Same open question as third-party App isolation (`APP_STANDARD.md` AP2). | Blocked on the isolation ADR. First-party Connectors run in-platform until then. |
