# Security Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** everything.
- **Relationship to `.claude/rules/security.md`:** that document is the binding rule set for the team and **is not restated here.** This standard is the engineering elaboration: threat model, data classification, validation, audit, redaction, egress, dependencies, and review. Where the two overlap, the stricter reading applies.
- **Source:** master build plan §32, §33, §34; `.claude/rules/security.md`.

---

## 1. Threat model

Dudo holds other companies' customers, invoices, payroll, contracts, and bank details.
Design against these adversaries, in this order:

| # | Adversary | Primary control |
|---|---|---|
| 1 | **A tenant reaching another tenant's data**, deliberately or by our bug | `MULTITENANCY_STANDARD.md` — isolation by construction, not by predicate |
| 2 | **A marketplace App**, which is untrusted by assumption | Declared permissions, enforced at every call; no storage access; declared egress |
| 3 | **An over-permissioned insider** in a tenant | Scopes, separate `list`/`export` permissions, audit, elevation for sensitive actions |
| 4 | **A compromised Connector or vendor** | Tenant-scoped credentials, egress allowlist, closed error mapping, no storage access |
| 5 | **A prompt-injection attacker** via documents, email, or external tools | AI below the authorization boundary; content is data, never instruction (`AI_STANDARD.md` §5) |
| 6 | **An unauthenticated internet attacker** | Authentication, validation, rate limiting, opaque non-sequential identifiers |
| 7 | **Us** — an agent making a plausible-looking change that removes a check | No self-review; contract-first; the checklists in every standard |

**Assume every marketplace App is untrusted.** Including our own. An official App that
only works because it is official has found a hole a third party will find too.

---

## 2. Deny by default

Everywhere, not only in authorization:

- No permission → denied.
- No declared capability → not resolvable.
- No declared egress host → call refused.
- No declared event subscription → not delivered.
- No declared UI location → not rendered.
- No `exposure` on an Action → not public, not AI-visible.
- No tenant context → the operation does not run.

A default that is permissive is a decision nobody made.

---

## 3. Data classification

Every field an App or Core stores is classified. Classification drives logging,
export, audit, and AI-provider rules.

| Class | Examples | Rules |
|---|---|---|
| **Public** | Marketplace listing, App name | No restriction |
| **Internal** | Record ids, timestamps, counts | Never crosses a tenant |
| **Business confidential** | Customers, invoices, orders, contracts | Never logged; never in an error message; never leaves the tenant; export is audited |
| **Sensitive personal** | National ids, addresses, health data, employee records | The above, plus explicit permission, plus audit on read where the tenant requires it |
| **Financial instrument** | Card numbers, IBANs, bank details | Never stored in full unless a recorded decision says so; never logged; never in an event payload; never sent to an AI provider |
| **Secret** | API keys, tokens, signing keys, passwords | Never printed, logged, echoed, committed, put in a fixture, or shown to an App. §5 |

An entity definition that does not classify its fields is incomplete.

---

## 4. Input is untrusted

Everything from outside a trust boundary is untrusted: client requests, App inputs,
Connector responses, webhooks, event payloads from another App, file contents, OCR output,
model output, external MCP results.

- **Validate against a declared schema at the boundary.** Reject unknown fields
  (`API_STANDARD.md` §7).
- Validate *semantically*, not only structurally — a well-formed date can still be in the
  wrong century, and a well-formed amount can still be negative.
- Never build a query by string concatenation. Parameterised statements only.
- Never deserialize into executable behaviour. Never `eval`, never dynamic import of a
  path derived from input.
- Uploaded files: verify declared type against actual content, cap size, store in R2 under
  the tenant prefix, serve with a content type that cannot execute in a browser origin
  that matters.
- Identifiers are opaque and non-sequential.

---

## 5. Secrets

The binding rules are in `.claude/rules/security.md` §5. Engineering requirements:

- Secrets are referenced **by name**; values live in the approved store and are resolved at
  use, scoped to the tenant of the call.
- Never in source, configuration, manifests, fixtures, seeds, tests, logs, error messages,
  events, audit records, or documentation.
- Never returned by any API, never readable by an App, never visible in a UI after
  creation.
- Rotation and revocation without a deploy (`CONNECTOR_STANDARD.md` §5).
- Issuing, rotating, and revoking are `critical` actions and are audited.
- **If a secret is exposed, stop and report it to the Team Lead immediately.** Do not
  quietly clean it up. A secret in a public repository is compromised the moment it lands,
  and deleting the file does not remove it from history — rotation is the only remedy.

**The tenant-scoped secret store is not selected** (`CONNECTOR_STANDARD.md` CN1). It
blocks Phase 5.

---

## 6. Audit

Every sensitive operation produces an audit event (master plan §32). At minimum:

money movement · permission changes · role changes · tenant membership changes · data
export · destructive actions · credential issue/rotate/revoke · App install, permission
grant, and uninstall · platform-operator access to tenant data · AI-initiated actions ·
authorization denials for `sensitive` and `critical` actions.

Each record contains: timestamp, tenant, principal type and id, acting-on-behalf-of, app
id, action id, permission and scope evaluated, target resource identifiers, decision,
correlation id, and a confirmation reference where elevation applied.

Rules:

- **Append-only.** Never updated, never deleted by application code.
- Contains identifiers and decisions, **not** the business data itself.
- A tenant can read its own audit log; nobody reads another tenant's.
- **Failures are audited, not only successes.** An attack looks like a long run of
  failures, and a log containing only successes cannot show one.

---

## 7. Logging and error messages

- Every log line carries `request_id`, `tenant_id`, `principal_id`, `app_id`,
  `correlation_id`.
- **No business data in logs.** No customer names, amounts, addresses, or document
  contents. Identifiers only.
- **No secrets, tokens, signatures, or full payment instruments** — absent, not masked.
  Masking is applied inconsistently and one missed site is a leak.
- No other tenant's identifiers, ever.
- Error messages returned to a caller contain a code, a developer-facing message with no
  business data, and a `request_id`. No stack traces, no queries, no internal hostnames, no
  library versions (`API_STANDARD.md` §8).
- Observability that leaks is a data breach with good intentions.

---

## 8. Network and egress

- All external traffic is TLS. No exceptions for "internal" services reached over the
  public internet — reach them by Service Binding instead.
- Outbound calls only to declared hosts (`CONNECTOR_STANDARD.md` §6).
- Explicit timeouts everywhere.
- Webhooks: verify signature first, resolve tenant from the installation, replay-protect,
  validate, then process.
- Public endpoints are rate-limited before any expensive work happens.

---

## 9. Dependencies and supply chain

- **No dependency enters Dudo without a recorded decision** (`CONSTITUTION.md` Rule 12).
  This includes test frameworks, build tools, and transitive additions introduced by a
  version bump.
- Every dependency is pinned. Lockfiles are committed.
- A version bump is a change that gets reviewed, not an automatic merge.
- Prefer the platform to a package. Every dependency is code we did not write running with
  our privileges.

---

## 10. Production and destructive actions

Requires **explicit user approval in the current conversation**, every time, and approval
never carries forward: deploy or change production configuration · push, commit, or
force-push · run migrations against real data · delete or truncate data · rotate, revoke,
or issue credentials · billing and spend decisions · send anything to an external service ·
install a dependency or add a technology.

**No agent may approve itself, and a Team Lead instruction is not user approval.**

---

## 11. Incident handling

1. **Stop.** Do not continue the task, and do not attempt a quiet fix.
2. **Report to the Team Lead immediately** — ahead of any other work in flight.
3. Do not print, paste, or forward the exposed material.
4. The Team Lead assesses containment, rotation, and disclosure with the user.
5. The remediation is recorded.

Security, authorization, and tenant-isolation findings are reported immediately and take
precedence over everything else an agent is doing.

---

## 12. Security review

Per master plan §25, a Security Agent — never the implementing agent (§26) — reviews:

- [ ] Authentication on every entry point.
- [ ] Authorization on every entry point; deny by default; no trusted caller.
- [ ] Tenant isolation across all eleven carriers (`MULTITENANCY_STANDARD.md` §4).
- [ ] External data exposure: responses, errors, logs, events, exports, discovery lists.
- [ ] Cross-module access: no cross-App storage, no Core internals, no plugin-to-database.
- [ ] Secrets: none in source, fixtures, logs, errors, events, or documentation.
- [ ] API contracts: schemas enforced, breaking changes labelled.
- [ ] Architecture rules: Core small, no vendor in Core or Apps, no Cloudflare type in
      domain logic.
- [ ] Data classification present for new fields.
- [ ] Audit events for every sensitive and critical action, including denials.
- [ ] Input validation at every boundary; no string-built queries.
- [ ] Egress declared; timeouts set; webhooks signature-verified.
- [ ] No new dependency without a record.

---

## 13. Open questions

| # | Question | Recommendation |
|---|---|---|
| SE1 | **Tenant-scoped secret store** — none approved; Worker secret bindings are per-Worker, not per-tenant. | Blocks Phase 5. Needs an ADR. |
| SE2 | **Third-party App and Connector isolation** — no runtime isolation mechanism is recorded (`0001`, `APP_STANDARD.md` AP2). | **No third-party code runs until it exists.** Stated as a gate, not a risk. |
| SE3 | **Compliance obligations and data residency** — GDPR, PCI scope, regional requirements. Not in the plan. | User decision. PCI scope in particular should be avoided by design: never store full instrument numbers, let the Connector's vendor hold them. Raise before `payment@1`. |
| SE4 | **Retention periods** for audit records, event history, and logs. | Needs a user decision; has legal weight. |
| SE5 | **Break-glass platform-operator access** (`AUTHORIZATION_STANDARD.md` AZ3). | Needs an ADR before the Phase 1 admin portal reads tenant data. |
