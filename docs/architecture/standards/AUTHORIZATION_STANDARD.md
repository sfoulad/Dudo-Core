# Authorization Standard

- **Status:** Draft for Team Lead review — Phase 0. **Parts of this document constitute the "logical permission model" that `0001` requires as its own decision record before implementation.** `architecture-agent` proposes; the Team Lead records; the user approves.
- **Authored by:** `architecture-agent`.
- **Applies to:** every entry point in Dudo — API, event consumer, workflow step, MCP tool, SDK call, scheduled job.
- **Depends on:** `CONSTITUTION.md` Rule 10, `MULTITENANCY_STANDARD.md`, `SECURITY_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/permission-catalog.yaml`.
- **Source:** master build plan §6, §16, §32.

---

## 1. The model

```
Principal  +  Role  +  Permission  +  Scope  =  Access
```

Access is granted when an authenticated **principal** holds a **role** that carries the
required **permission** at a **scope** that contains the resource. If any of the four is
missing, access is denied.

**Default = Deny.** Not "deny after the checks fail" — deny unless a check explicitly
passed. An entry point with no declared permission is unreachable, not open. This is
verifiable: every Action declares exactly one permission, and an Action without one fails
its own registration.

---

## 2. Principals

Five types, treated uniformly:

| Principal | Notes |
|---|---|
| **Human User** | A person with a session. |
| **Team** | First-class. Permissions may be held by a team, and membership grants them. |
| **Service Account** | Machine identity for integrations. Never a shared human account. |
| **AI Agent** | An AI acting on behalf of a user or an organization. **A principal, not an exception** (`CONSTITUTION.md` Rule 7). |
| **IoT Device** | Narrow, usually single-purpose, usually branch-scoped. |

**An AI agent never has more access than the principal it acts for**, and its own grants
are a subset. Where an AI acts on behalf of a user, the effective permission is the
*intersection* of the agent's grants and the user's — never the union.
`MCP_STANDARD.md` §4.

---

## 3. Permissions

### 3.1 Naming

```
<namespace>.<resource>.<action>
```

- `namespace` is `core` or an App id.
- `resource` is singular, kebab-case: `purchase-order`.
- `action` is a verb: `read`, `list`, `create`, `update`, `delete`, `export`, `approve`,
  `refund`.
- Examples: `core.user.read`, `core.role.assign`, `crm.contact.create`,
  `finance.invoice.export`.

### 3.2 Rules

- **Every permission exists in `permission-catalog.yaml`** before any code references it.
  An undeclared permission string is a typo waiting to become an authorization bypass —
  or, worse, an authorization *failure* that someone "fixes" by removing the check.
- **Wildcards may appear in role definitions, never in App manifests.** A customer's
  admin role may carry `crm.*`; an App may never request it. An App requests each
  permission by name, which is what makes a permission screen meaningful.
- **`list` is a separate permission from `read`.** Enumeration is its own disclosure: the
  count and the identifiers are information even when the records are not readable.
- **`export` is always separate.** Reading one record and downloading the whole book are
  different risks.
- Permissions are additive. There are no negative permissions and no deny rules — a deny
  overlay makes the effective permission set impossible to reason about, and "why can this
  user do that?" must always be answerable.

---

## 4. Scopes

From master plan §6, narrowest last:

| Scope | Grants over |
|---|---|
| `platform` | Everything. Platform operators only, and it is auditable and rare. |
| `organization` | One Organization and everything beneath it. |
| `business` | One Business/Workspace. |
| `branch` | One Branch/Location. |
| `team` | Resources belonging to one Team. |
| `own` | Records the principal created or is assigned to. |
| `resource` | One named resource. |

Rules:

- A scope grant at a level implies the levels beneath it, and never above it.
- **A scope never crosses a tenant.** `platform` is the only scope that spans
  organizations, it belongs to platform operators, and it never grants access to tenant
  *business data* without an explicit, audited, time-bounded elevation (§7).
- The Action declares the scope level at which its permission is evaluated. Evaluating at
  the wrong level is a silent privilege escalation, so it is part of the contract and part
  of review.
- `own` requires a defined ownership relation on the entity. An entity with no ownership
  column cannot use `own`, and pretending otherwise grants everything.

---

## 5. Where authorization happens

**In Core, at every entry point, on every call.**

- Never trust that a caller already checked — not the web client, not the Apple client,
  not an App, not another internal service, not the SDK.
- **UI hiding is presentation, never security.** A hidden button is still reachable by
  anyone who can open a network tab.
- The SDK may pre-check to give an App a good error, but the SDK's answer is advisory.
  Core decides.
- Authorization decisions are **not cached beyond the scope of the decision**. A cached
  "yes" that outlives a revoked role is a permission that cannot be revoked. If a cache is
  ever introduced it needs an explicit invalidation contract and its own decision record.

---

## 6. Sensitivity classes

Every Action declares one. The class drives audit and elevation requirements.

| Class | Examples | Requires |
|---|---|---|
| `read` | View a record | Permission |
| `write` | Create or update a record | Permission |
| `sensitive` | Export data, change permissions, change membership, view payroll or bank details, send on the tenant's behalf | Permission + **audit event** |
| `critical` | Move money, delete data irreversibly, rotate credentials, uninstall an App with `delete` disposition, grant platform scope | Permission + audit + **explicit confirmation** (§7) |

Master plan §32 requires explicit access for customer information, payments, financial
information, documents, employees, external APIs, AI, and devices. Those map to
`sensitive` at minimum.

---

## 7. Elevation

Sensitive and critical actions may additionally require, per the tenant's policy:

- **User confirmation** — an explicit, contemporaneous confirmation of *this* operation.
  Not a setting toggled once.
- **An approval workflow** — a second principal approves.
- **MFA re-authentication**.
- **Step-up authorization** — a short-lived, narrowly-scoped elevation, always audited,
  always time-bounded.

**Elevation is per operation, never per session.** An elevation that grants a window
during which anything may be done is a session upgrade, and the audit trail then cannot
say what the user actually confirmed.

For AI principals, confirmation is confirmation *by the human*, delivered through a
platform surface — never a model asserting that the user agreed (`MCP_STANDARD.md` §5).

---

## 8. Apps and permissions

- An App declares every permission it needs in its manifest. **Undeclared is denied**, at
  the boundary, at call time.
- Permissions are granted at install by a tenant principal with authority to grant them,
  narrowly, revocably, and per tenant.
- An App can never hold more than the granting principal held. Installation is delegation,
  and delegation cannot manufacture authority.
- Grants are enforced by Core on **every invocation** — not once at load, not by the SDK,
  not by the App.
- **First-party Apps get no special path.** Same declaration, same grant, same
  enforcement. If an official App works without a declared permission, the enforcement is
  broken.
- Revoking a grant takes effect on the next call. Not on the next deploy, not on the next
  session.

---

## 9. Roles

- Default roles may ship — Platform Admin, Marketplace Moderator, Developer, Business
  Owner, Business Admin, Member — but **roles are never hardcoded**. Customers create
  custom roles.
- A role name appearing in a conditional in source is a defect. Code checks *permissions*.
  The one exception is the platform's own bootstrap role, which is declared in the
  permission catalog and audited.
- A role is a named bundle of permissions at a scope. Role assignment is a `sensitive`
  operation and is always audited.

---

## 10. Service accounts, API credentials, and devices

- Every credential belongs to exactly one principal, in exactly one tenant, with an
  explicit permission set — never "all permissions of its creator", which silently grows
  as the creator's role grows.
- Credentials are listable, revocable, and show last use. A credential nobody can find is
  a credential nobody will revoke.
- Issuing, rotating, and revoking are `critical` and audited.
- IoT devices get the narrowest possible scope, usually `branch` or `resource`, and
  usually a single permission.

---

## 11. Audit

Every `sensitive` and `critical` action produces an audit event containing: timestamp,
tenant, principal type and id, acting-on-behalf-of where applicable, app id, action id,
permission and scope used, target resource identifiers, the decision, and correlation id.

Audit records are append-only and are never mutated. Details in
`SECURITY_STANDARD.md` §6.

---

## 12. Verification checklist

- [ ] Every Action declares exactly one permission and one scope level.
- [ ] Every referenced permission exists in `permission-catalog.yaml`.
- [ ] Every entry point authorizes in Core; no path assumes an upstream check.
- [ ] Deny by default demonstrated: an unauthenticated and an unpermitted call are both
      tested, for every new Action.
- [ ] Cross-tenant access returns `not_found`, not `forbidden` (`API_STANDARD.md` §8).
- [ ] `list` and `export` are separate permissions from `read`.
- [ ] No wildcard permission in any App manifest.
- [ ] No role name in a conditional.
- [ ] No authorization decision cached beyond its scope.
- [ ] Sensitivity class declared; audit implemented for `sensitive` and `critical`.
- [ ] Elevation is per operation, not per session.
- [ ] AI principal's effective permission is the intersection with the acting user's.
- [ ] Permission test matrix present (`TESTING_STANDARD.md` §6).

---

## 13. Open questions

| # | Question | Recommendation |
|---|---|---|
| AZ1 | **This document is the logical permission model `0001` requires.** It is a standard, not a decision record. | Team Lead records §1–§10 as an ADR — `architecture-agent` will draft it on request. Nothing implements against it until then. |
| AZ2 | **Authentication mechanism** — sessions, tokens, OAuth/OIDC — is unrecorded. Authorization assumes an authenticated principal but cannot produce one. | Needs an ADR with the Phase 1 identity work. This standard is written so it does not depend on the choice. |
| AZ3 | **Platform-operator access to tenant business data.** §4 forbids it without elevation, but support will eventually need it. | Break-glass: explicit, time-bounded, reason-required, tenant-notified, always audited. Needs its own record before any admin portal reads tenant data — which is Phase 1. |
| AZ4 | **Permission grouping for the install screen.** Twenty individually-named permissions are unreadable, and unreadable consent is not consent. | Group by resource with an expandable detail view; the catalog carries a `group` field for this. Product decision, flagged. |
