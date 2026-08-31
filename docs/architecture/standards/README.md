# Dudo Standards

The Phase 0 constitution: the documents every agent reads before editing, and the
registries the platform validates against.

- **Status:** Draft for Team Lead review. **Binding on acceptance**, not before.
- **Authored by:** `architecture-agent`. **Accepted by:** the Team Lead, with user
  approval under the Foundation Gate (`docs/decisions/0005`).
- **Required by:** master build plan §24 — these exist *before* any code.

---

## The documents

Read `CONSTITUTION.md` first. Everything else elaborates it.

| # | Document | Answers |
|---|---|---|
| 1 | [CONSTITUTION.md](CONSTITUTION.md) | The twelve non-negotiable rules, document precedence, how work is governed, amendment. |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | The five extension types, layering, the request lifecycle, one Action across six surfaces, sync vs async. |
| 3 | [CORE_BOUNDARIES.md](CORE_BOUNDARIES.md) | What Core owns, the four-question inclusion test, what Core must never own. |
| 4 | [APP_STANDARD.md](APP_STANDARD.md) | What an App must satisfy to be installable. Structure, manifest, lifecycle, data disposition. |
| 5 | [CAPABILITY_STANDARD.md](CAPABILITY_STANDARD.md) | Vendor-neutral interfaces, provider resolution, conformance. |
| 6 | [CONNECTOR_STANDARD.md](CONNECTOR_STANDARD.md) | The one place a vendor name is allowed. Credentials, egress, webhooks, idempotency. |
| 7 | [API_STANDARD.md](API_STANDARD.md) | The Action definition, three API levels, paths, versioning, errors, idempotency. |
| 8 | [EVENT_STANDARD.md](EVENT_STANDARD.md) | Envelope, naming, versioning, delivery semantics, duplicate concepts. |
| 9 | [AUTHORIZATION_STANDARD.md](AUTHORIZATION_STANDARD.md) | Principal + Role + Permission + Scope. Deny by default. Sensitivity and elevation. |
| 10 | [MULTITENANCY_STANDARD.md](MULTITENANCY_STANDARD.md) | The eleven carriers of tenant context, and an honest account of what D1 costs. |
| 11 | [MCP_STANDARD.md](MCP_STANDARD.md) | AI tools derived from Actions, permission-filtered discovery, confirmation. |
| 12 | [AI_STANDARD.md](AI_STANDARD.md) | AI as a capability, grounding, prompt injection, tenant data and providers. |
| 13 | [SECURITY_STANDARD.md](SECURITY_STANDARD.md) | Threat model, data classification, secrets, audit, redaction, review. |
| 14 | [TESTING_STANDARD.md](TESTING_STANDARD.md) | Seven test types, the isolation test, the permission matrix, definition of done. |
| 15 | [CLOUDFLARE_STANDARD.md](CLOUDFLARE_STANDARD.md) | What is approved, what is not, and how every service stays replaceable. |

## The registries

Machine-readable, in `packages/contracts/registries/`. Where a standard and a registry
disagree about a **rule**, the standard wins; about a **value**, the registry wins
(`CONSTITUTION.md` §1).

| File | Contains |
|---|---|
| `app-manifest.schema.json` | JSON Schema (draft 2020-12) every App manifest validates against. |
| `capability-manifest.schema.json` | JSON Schema for capability definitions (`kind: capability`) and Connector provider declarations (`kind: provider`). |
| `event-catalog.yaml` | The envelope, the naming and versioning rules, delivery semantics, and every registered event type. |
| `permission-catalog.yaml` | The permission model, principal types, scopes, sensitivity classes, every permission, and the seed roles. |
| `core-object-registry.yaml` | Every object Core owns, plus UI extension locations and reserved API path segments. |

**Every entry in the three YAML registries is `status: proposed`.** No code exists, and no
event, permission, or Core object has been accepted. They record the shape entailed by
Core's declared responsibilities so Phase 1 builds against something reviewed rather than
inventing one module at a time.

---

## Which to read

Fixed by `CONSTITUTION.md` §5. In short: everyone reads 1 and 2; then read the standard
for the boundary you are touching, plus 9, 10, and 13 for anything that handles tenant
data.

## What these documents are for

They will be enforced against every future change, so each rule is written to be
**checked**, not merely agreed with. Every standard ends with a verification checklist and
an open-questions table. The checklists are what review and CI test. The open questions
are what still needs a decision — none of them is answered by an agent's assumption.

---

## The gaps, in one place

Recorded rather than worked around. Each blocks real work and each needs a decision record
the Team Lead owns.

| Blocks | What is missing | Where |
|---|---|---|
| **Every schema** | The tenancy model. D1 is single-threaded per database, which argues against the master plan's "start shared". | `MULTITENANCY_STANDARD.md` §7 |
| **Every schema** | Confirmation that tenant = Organization. The plan carries `tenant_id` and `business_id` and defines neither. | `MULTITENANCY_STANDARD.md` §2 |
| **Every contract** | The contract's executable form and transport. | `API_STANDARD.md` AS1 |
| **Every test** | No test framework is approved. | `TESTING_STANDARD.md` TS1 |
| **Phase 1** | The logical permission model as an ADR, required by `0001`. | `AUTHORIZATION_STANDARD.md` AZ1 |
| **Phase 1** | Authentication mechanism. | `AUTHORIZATION_STANDARD.md` AZ2 |
| **Phase 1** | Break-glass platform-operator access, before the admin portal reads tenant data. | `AUTHORIZATION_STANDARD.md` AZ3 |
| **Phase 1** | Service topology, and a migration runner. | `CLOUDFLARE_STANDARD.md` CF1, CF5 |
| **Phase 5** | A tenant-scoped secret store. Worker secret bindings are per-Worker, not per-tenant. | `CONNECTOR_STANDARD.md` CN1 |
| **Phase 7, and all third-party code** | The App and Connector isolation mechanism. Workers for Platforms is not approved. | `APP_STANDARD.md` AP2 |
| **Every AI feature** | No AI provider is approved. This is a hard blocker on the product's central promise. | `AI_STANDARD.md` AI1 |
| **Phase 8** | MCP transport and MCP authentication. | `MCP_STANDARD.md` MC1, MC2 |
| **User decisions** | Data residency, retention periods, compliance obligations, the software licence. | `MULTITENANCY_STANDARD.md` MT3–MT4, `SECURITY_STANDARD.md` SE3–SE4 |
