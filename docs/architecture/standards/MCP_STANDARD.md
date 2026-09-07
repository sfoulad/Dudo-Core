# MCP Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No MCP transport or hosting product is approved** — see §10.
- **Authored by:** `architecture-agent`.
- **Applies to:** every MCP tool Dudo exposes, and every external MCP server Dudo consumes.
- **Depends on:** `AUTHORIZATION_STANDARD.md`, `API_STANDARD.md`, `AI_STANDARD.md`, `SECURITY_STANDARD.md`.

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

> **BUILT, 2026-09-06 — the mechanism this section assumed now exists in Core, and it went further
> than this section asked.** `0027` (Accepted) implements confirmation as **two independent
> proofs**: *intent* — a server-authored statement bound to a token the client must echo — and
> *presence*, a **re-authentication using the existing login KDF**. Its argument for needing both
> (`0027:23–24`): *"A 'type DELETE to continue' box proves (a) AND NOT (b). A re-authentication
> prompt proves (b) AND NOT (a)."* Core-side: `platform/core/confirmation/**`, migration
> `platform/core/migrations/control-plane/0011_confirmation.sql`, and `0029` for the binding.
>
> **Three consequences for this document, none of which weaken it.** **(1)** §5's rule that a model
> *"asserting 'the user confirmed' is not a confirmation"* is now the **general** rule rather than
> an AI-specific one — `0027:44` gives the same reason this section does, *"the model is the party
> being constrained"*, and `0027:82` states the generalisation: **the constrained party must not
> author the constraint.** **(2)** `0029` is the case study for §5's *"states exactly what will
> happen"*: a confirmation minted for one platform operator was **`0029:22` — *"spendable on any
> other"*** — because the bound object was computed from the body and that route's body carried
> nothing else. The binding now covers **the route's declared path parameters** as well
> (`0029:44–53`). **An MCP tool call must bind its arguments the same way or it inherits that
> defect**, and the defect was caught by a load-time guard rather than by review. **(3)** The
> ceiling `0027:38–41` records applies here verbatim: re-authentication **"is not two-factor and
> must never be described as such"**, and `MfaFactor` is *"a registry entry at `proposed` with no
> table, no enrolment path and no code"* (`0027:32`) — so §5's mention of MFA names something that
> does not exist, and a `critical` action over MCP is protected by a password, not by a factor.
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

**Reconciled against the built system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would).
**No MCP code exists**, so nothing here is contradicted. Two of the four rows named dependencies
that have since been settled, and both are corrected below.

| # | State | Question | Recommendation |
|---|---|---|---|
| MC1 | **OPEN — ROOT R5.** Cloudflare product record; independent of R3 | **How Dudo hosts an MCP server.** The candidates are the Agents SDK and remote MCP; **neither is approved** (`0003`). | Unchanged, and the claim that made this row cheap has held up under a year of building: this standard defines derivation, authorization, discovery, confirmation and audit, **all of which are transport-independent**, and nothing in §§1–9 has had to change while the transport stayed unknown. ~~The transport needs an ADR before Phase 8.~~ **`0030` withdrew the phase framing**; it needs a record before any MCP surface, whenever that is scheduled. **Note it is a separate root from the AI provider** (`AI_STANDARD.md` AI1): Dudo could host MCP tools for an external model without approving an AI provider of its own, and could approve a provider without hosting MCP. Two decisions, neither implying the other. |
| MC2 | **Dependency CLOSED; the design is still OPEN** | **MCP authentication.** Binding an MCP session to a Dudo principal and tenant has no recorded mechanism, and it is the security boundary of the whole surface. | ~~Needs an ADR with AZ2 (authentication). **Phase 8 is blocked on it.**~~ **Corrected 2026-09-06: AZ2 is decided and shipped.** `0014` (Accepted) records authentication in three parts, `0015` the credential and session-credential format, `0018` and `0021` the revocation and session-route classes, and login is live in production. **So this row is no longer waiting for a mechanism — it is a design on top of one that exists**, and the shape is largely dictated by decisions already made: §4 requires an MCP session bound to **one** tenant, and `0021` established a request class that resolves a session and stops, which is the nearest existing analogue. **What is still genuinely undecided:** how a non-browser agent obtains a credential (the session credential is a cookie or `Authorization: Bearer` per `0018` §A, neither of which an autonomous agent acquires by itself), and whether an AI principal's credential is an `ApiCredential` bound to one principal with an explicit permission set — *"never 'everything its creator has', which silently grows as the creator's role grows"* (`core-object-registry.yaml`). **Needs its own record; it is no longer blocked, only unwritten.** |
| MC3 | **OPEN** — product decision; blocks nothing | **Whether tool descriptions are tenant-customisable.** Useful for domain vocabulary; also a way to make a tool describe itself as something it is not. | Unchanged: do not allow free-text override in the first version; revisit with evidence. **One connection worth recording:** `0025` established that a **Template** may carry display labels per structural level *"and may never contain logic"*, which is the same distinction this row needs — a per-tenant **label** is data, a per-tenant **description a model acts on** is closer to an instruction. If tenant vocabulary is ever admitted here, admit it as labels bound to declared fields, not as prose. |
| MC4 | **OPEN** — a user pricing decision; the mechanism half is largely built | **Cost attribution for AI-driven tool storms.** An agent can generate far more calls than a human. | The recommendation stands — per-principal quota from the tenant's plan (§6) — and **the enforcement machinery it assumed now exists**, which was not true when this row was written. `0014` §A established a daily D1 write-admission port with a platform ceiling split three ways and per-principal sub-ceilings, and `0013` established a coordinator that bounds a hostile caller's write amplification. **An MCP principal is exactly the caller those controls were designed against**, and it should reuse them rather than introduce a parallel limiter. **Two cautions from the free-tier register, both measured:** a naive one-Durable-Object-call-per-request limiter *"lets an unauthenticated flood exhaust the allowance the authenticated path depends on"*, and a new consumer's §6a check must state **which other consumer it shares with**. **The pricing consequence remains a user decision.** |
