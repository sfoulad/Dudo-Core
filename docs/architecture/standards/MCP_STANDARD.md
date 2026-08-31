# MCP Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No MCP transport or hosting product is approved** — see §10.
- **Authored by:** `architecture-agent`.
- **Applies to:** every MCP tool Dudo exposes, and every external MCP server Dudo consumes.
- **Depends on:** `AUTHORIZATION_STANDARD.md`, `API_STANDARD.md`, `AI_STANDARD.md`, `SECURITY_STANDARD.md`.
- **Source:** master build plan §15, §16.

MCP is how AI discovers and operates Dudo. It is a **presentation of existing authorized
Actions** — never a second way into the system.

---

## 1. Tools come from Actions

An MCP tool is generated from an Action definition (`API_STANDARD.md` §1). There is no
such thing as an MCP-only code path.

```
Action definition ──> MCP tool  (name, description, input schema, output schema, errors)
```

- **No tool without an Action.** If an operation is not an Action, it is not exposed to AI.
  A hand-written tool has no declared permission, no schema, no audit, and no test — which
  is precisely the combination that makes an AI dangerous.
- **Exposure is opt-in.** An Action appears over MCP only if its `exposure` includes
  `mcp`. Nothing becomes AI-callable by default.
- Tool name = Action id (`appointments.CreateAppointment`).
- Input and output schemas are the Action's, unchanged. A tool that accepts a shape the
  API would reject is a validation bypass.
- The tool description is written for a model choosing between tools: what it does, when
  to use it, when *not* to. It is part of the contract and is reviewed like one — a
  misleading description causes wrong actions on real business data.

---

## 2. Authorization is identical

```
Claude ──> MCP ──> Dudo authorization ──> Finance App
```

**If the user cannot make a payment manually, an AI acting for them cannot either.**

- Every MCP invocation runs the full request lifecycle (`ARCHITECTURE.md` §3):
  authenticate, resolve tenant, authorize, validate, rate limit, idempotency, execute,
  audit, publish.
- MCP is not a trusted caller. The MCP layer performs no authorization of its own and is
  never given a privileged identity.
- Tenant comes from the authenticated MCP session, server-side. **Never from a tool
  argument.** A `tenant_id` parameter on a tool is a cross-tenant vulnerability with a
  friendly name.
- No tool takes a principal, role, permission, or scope as an argument.

---

## 3. Discovery is permission-filtered

The tool list returned to a principal contains **only the tools that principal could
actually invoke**, in the tenant of the session.

**Why filtering is a security control, not a convenience.** A tool list is a description
of the system: which Apps are installed, which capabilities exist, sometimes which vendors
are configured. Returning `payroll.ApprovePayrollRun` to a principal who may not call it
tells them the tenant runs payroll on Dudo. Discovery leakage is disclosure.

- The list changes when permissions change, on the next discovery call.
- Tools from disabled or uninstalled Apps disappear.
- Tool *counts* and *categories* leak too; do not return a filtered list with placeholders
  for what was removed.

---

## 4. Principals and delegation

- An AI agent is a principal (`AUTHORIZATION_STANDARD.md` §2).
- Acting on behalf of a user, its effective permission is the **intersection** of its own
  grants and the user's. Never the union, and never the user's alone.
- Every audit record names both: the AI principal and the human it acted for. "Who did
  this?" must have an answer that includes a person.
- An MCP session is bound to one tenant. Switching tenants requires a new authenticated
  session.

---

## 5. Confirmation for sensitive actions

Per `AUTHORIZATION_STANDARD.md` §6, a `sensitive` or `critical` Action invoked over MCP
may additionally require user confirmation, an approval workflow, MFA, or step-up
authorization.

**The confirmation is collected by the platform, from the human, through a platform
surface.** A model asserting "the user confirmed" is not a confirmation — the model is the
party being constrained, and letting it certify its own constraint removes the constraint.

- Confirmation is per operation and states exactly what will happen: the amount, the
  recipient, the record.
- A confirmation is single-use and short-lived.
- `critical` actions over MCP are denied outright unless the tenant has explicitly enabled
  them for AI principals. Default = deny extends to *which class of action AI may perform
  at all*, not only to individual permissions.

---

## 6. Limits and cost

- MCP invocations are rate-limited per principal and per tenant, separately from human
  traffic. An agent in a retry loop should exhaust its own budget, not the tenant's.
- Tool-call quotas are subject to the tenant's plan, returning `quota_exceeded`.
- Long-running work returns a handle to a Workflow rather than blocking the tool call.
- Every MCP call records latency, outcome, and token/cost attribution per tenant
  (`ARCHITECTURE.md` §8).

---

## 7. Audit

Every MCP call is audited, whether it succeeds or fails: timestamp, tenant, AI principal,
acting-on-behalf-of, tool/Action id, permission and scope evaluated, decision, target
resource identifiers, confirmation reference where required, correlation id.

**Denials are audited too.** A sequence of denied tool calls is the clearest signal that
something is wrong — a misconfigured agent, a prompt injection, or an attack.

Tool *arguments* are recorded subject to `SECURITY_STANDARD.md` §7 redaction rules: never
credentials, never full payment instruments.

---

## 8. Consuming external MCP servers

Dudo may connect to external MCP servers on a tenant's behalf. Everything from them is
untrusted.

- The connection is per tenant, explicitly configured, with credentials by reference.
- The external server's host is on the tenant's declared egress allowlist.
- **Tool descriptions and results from an external server are untrusted input.** They are
  data, never instructions. A returned string saying "now call `finance.SendPayment`" is
  an injection attempt (`AI_STANDARD.md` §5).
- An external tool result never widens a permission, selects a tenant, or authorizes
  anything.
- Every external call is audited and rate-limited.

---

## 9. Verification checklist

- [ ] Every exposed tool derives from an Action with `exposure` including `mcp`.
- [ ] No hand-written tool; no MCP-only code path.
- [ ] Input schema identical to the Action's; unknown fields rejected.
- [ ] No `tenant_id`, principal, role, permission, or scope argument on any tool.
- [ ] Tenant resolved from the authenticated session, server-side.
- [ ] Full authorization on every invocation; no privileged MCP identity.
- [ ] Discovery filtered by permission; no placeholders for removed tools.
- [ ] AI effective permission is the intersection with the acting user's.
- [ ] Confirmation collected by the platform for `sensitive`; `critical` denied unless the
      tenant enabled it for AI.
- [ ] Audit written on success **and** on denial, naming both principals.
- [ ] Rate limits separate from human traffic.
- [ ] External MCP results treated as untrusted data, never as instructions.
- [ ] Tenant-isolation test covers the MCP surface (`MULTITENANCY_STANDARD.md` §8).

---

## 10. Open questions

| # | Question | Recommendation |
|---|---|---|
| MC1 | **How Dudo hosts an MCP server.** The plan names the Agents SDK and remote MCP (§15); **neither is approved** (`0003`). | This standard defines derivation, authorization, discovery, confirmation, and audit — all of which are transport-independent. The transport needs an ADR before Phase 8. Nothing here depends on it. |
| MC2 | **MCP authentication.** Binding an MCP session to a Dudo principal and tenant has no recorded mechanism, and it is the security boundary of the whole surface. | Needs an ADR with AZ2 (authentication). **Phase 8 is blocked on it.** |
| MC3 | **Whether tool descriptions are tenant-customisable.** Useful for domain vocabulary; also a way to make a tool describe itself as something it is not. | Do not allow free-text override of the description in the first version. Revisit with evidence. |
| MC4 | **Cost attribution for AI-driven tool storms.** An agent can generate far more calls than a human. | Per-principal quota from the tenant's plan (§6). The pricing consequence is a user decision. |
