# 0007 — The logical permission model

- **Status:** **Proposed**
- **Date:** 2026-09-01
- **Deciders:** **Undecided.** The user decides; the Team Lead records.
- **Owning agent:** Team Lead records. Drafted by `architecture-agent`.

> **This record decides nothing while it reads `Proposed`.** It is the draft that `0001`
> decision 2 requires and `AUTHORIZATION_STANDARD.md` AZ1 records as outstanding. Nothing
> implements against it until an accepted version exists.

---

## 1. Context

### 1.1 The obligation

`0001` (Accepted) decision 2:

> **The logical permission model is defined before implementation.** What a permission is,
> how it is declared, scoped, granted, enforced, and revoked is settled in the abstract —
> independently of, and prior to, any technology that implements it.

and its sequencing: **logical permission model → App permission and trust ADR → stack and
isolation mechanism → SDK and runtime implementation.** The first link is missing, so the
chain is stalled: `packages/sdk/**` and the App runtime cannot begin.

`AUTHORIZATION_STANDARD.md` AZ1 and `permission-catalog.yaml` both say the same thing in
their own words — the standard is a standard, not a decision record, and nothing implements
against the catalog until the record exists.

### 1.2 What this record is, and is not

**It is** the abstract model: what a permission is, how it is named, scoped, composed into
roles, granted, delegated, enforced, audited, and revoked.

**It is not** the authentication mechanism (AZ2 — sessions, tokens, OAuth/OIDC), the
break-glass mechanism for platform operators (AZ3), the App isolation mechanism (`0003`
open item 2), or any storage shape. It is written so it does not depend on any of them.

### 1.3 The defect this record exists partly to close

QA's independent review found that `business-owner` — a **tenant** role at
`scope: organization` — carries the wildcard `core.*`, which on the documents as written
expands to include `core.principal.grant-platform-scope`, a permission the catalog itself
declares at `scopes: [platform]` and describes as "the broadest grant in the system."

QA grepped for a rule constraining what a wildcard expands to and found none.
`AUTHORIZATION_STANDARD.md` §3.2 and `permission-catalog.yaml` `model.rules` both say only
*where* a wildcard may appear, never *what it expands to*. The naive implementation — which
is the only one the documents describe — is tenant-to-platform privilege escalation in the
seed data of the most commonly assigned tenant role.

**§3, decision D6 states the missing rule.** It is the root cause, not the symptom: the same
gap also produces two further seed-data violations that are individually harmless and
collectively show the model has no defined semantics for a role's scope against a
permission's declared scopes.

---

## 2. The model

```
Principal  +  Role  +  Permission  +  Scope  =  Access
```

Access is granted when an authenticated **principal** holds a **role** carrying the
required **permission**, at a **scope** that contains the resource. If any of the four is
missing, access is denied. There is no fifth input, and no path that supplies fewer than
four.

---

## 3. Decisions

Sixteen rules. Each is written to be checkable, and each names the failure it prevents.

### D1 — Default = Deny

Deny unless a check explicitly passed. Not "deny after the checks fail" — a code path that
reaches a resource without an authorization decision having *succeeded* is a defect, not a
default.

- An entry point with no declared permission is **unreachable**, not open.
- Every Action declares **exactly one** permission and one scope level. An Action without
  one fails its own registration.
- This applies to every entry point without exception: public API, internal API/RPC, event
  consumer, workflow step, MCP tool, SDK call, scheduled job, admin surface.

*Prevents:* the new endpoint that is open because nobody remembered to add a check.

### D2 — Five principal types, treated uniformly

Human user, team, service account, AI agent, IoT device. There is no sixth "system" or
"internal" principal that bypasses the model (see D13).

An **AI agent never holds more access than the principal it acts for.** Where an AI acts on
behalf of a user, the effective permission set is the **intersection** of the agent's
grants and the user's — never the union.

*Prevents:* the AI path becoming the privileged path.

### D3 — Permission identifiers are namespaced and registered

Format: `<namespace>.<resource>.<action>`, where `namespace` is `core` or an App id,
`resource` is singular kebab-case, and `action` is a verb.

- **Every permission exists in `permission-catalog.yaml` before any code references it.**
  An undeclared permission string is a typo waiting to become either a bypass or an
  authorization *failure* that someone "fixes" by deleting the check.
- The namespace is what makes third-party Apps possible: an App's permissions live under
  its own id and cannot collide with Core's or another App's.
- **`list` is separate from `read`.** Enumeration is its own disclosure — the count and the
  identifiers are information even when the records are not readable.
- **`export` is always separate from `read`.** Reading one record and downloading the whole
  book are different risks.
- **Permissions are additive. There are no negative permissions and no deny rules.** A deny
  overlay makes the effective set impossible to reason about, and "why can this principal
  do that?" must always be answerable by listing grants.

### D4 — Seven scopes, containment downward only

`platform` · `organization` · `business` · `branch` · `team` · `own` · `resource`.

- A grant at a level implies the levels beneath it, and **never above it**.
- **A scope never crosses a tenant.** `platform` is the only scope that spans
  Organizations; it belongs to platform operators; it is rare and always audited.
- `own` requires a **defined ownership relation** on the entity. An entity with no
  ownership relation cannot use `own` — pretending otherwise grants everything while
  presenting as the narrowest scope in the system.
- The Action declares the level at which its permission is evaluated. Evaluating at the
  wrong level is a silent privilege escalation, so it is part of the contract and part of
  review.

### D5 — Every permission declares the scopes at which it is meaningful

A permission carries a `scopes` list. That list is **normative, not documentation**: it is
the set of levels at which this permission may be held and evaluated. `core.tenant.export`
declaring `scopes: [organization]` means the permission does not exist at `platform`, and
no role, wildcard, or inheritance rule may produce it there.

*Prevents:* a permission being silently reinterpreted at a level its author never
considered.

### D6 — Wildcard expansion is intersected with each permission's declared scopes

**This is the rule whose absence produced the defect in §1.3. It is normative.**

> **A wildcard in a role expands only to those permissions whose declared `scopes` include
> the role's own `scope`. A permission whose declared scopes exclude the role's scope is
> not granted — not silently, not implicitly, not by any inheritance or containment rule.**

Precisely:

```
effective(role) = { p ∈ catalog : p matches the role's pattern
                                  AND role.scope ∈ p.scopes }
```

The operator is **intersection**. It is never a union, and D4's downward containment does
**not** widen it: containment says a grant at `organization` reaches a `branch` beneath it;
it does not say a role at `organization` may hold a permission declared only at `platform`.

Consequences that are part of this decision:

1. **Wildcards may appear in role definitions and never in an App manifest.** A tenant's
   custom admin role may carry `crm.*`; an App may never *request* it, because a permission
   screen listing "everything" is not consent.
2. **The same intersection applies to explicitly listed permissions**, not only to
   wildcards. A role listing a permission whose declared scopes exclude the role's scope is
   an **invalid role definition** and fails catalog lint — it is not silently dropped.
   Silent dropping means an operator believes a role grants something it does not, and
   discovers otherwise during an incident.
3. **Wildcard expansion is evaluated against the catalog at authorization time**, so
   **adding a new permission to a namespace grants it to every wildcard role in that
   namespace.** That is a real hazard and this record accepts it explicitly with a control:
   adding any permission of sensitivity `sensitive` or `critical` to the catalog requires
   listing, in the change, every wildcard role that would gain it. A permission that no
   wildcard role should gain is declared at a scope no wildcard role holds.
4. **A catalog lint check enforces D6 and fails the build.** Every role's expanded set is
   computed and any permission whose `scopes` exclude the role's `scope` is an error. This
   check is executable, it has already been run by hand once, and it found three real
   violations — it belongs in CI, not in a review checklist.

*Prevents:* tenant-scope roles reaching platform-scope permissions; the specific escalation
in §1.3.

### D7 — Roles, grants, and assignments are tenant-scoped

- Every role, grant, and assignment belongs to **exactly one tenant** — except platform
  roles, which belong to no tenant and are held only by platform principals.
- A role defined in tenant A cannot be assigned, referenced, or copied into tenant B.
  Custom role definitions are tenant data.
- A principal that belongs to more than one tenant holds a **separate** set of assignments
  per tenant. There is no assignment that spans tenants, and no "same role everywhere".
- **The tenant of an authorization decision is the tenant of the request context**
  (`MULTITENANCY_STANDARD.md` §3), derived on the server, never supplied by the caller.

*Prevents:* the cross-tenant role that looks like a convenience and is a boundary breach.

### D8 — Core is the sole enforcement authority

Authorization is decided **in Core, at every entry point, on every call.**

- No caller is trusted to have already checked — not the web client, not the Apple client,
  not an App, not a Capability, not a Connector, not another internal service, not the SDK.
- **UI hiding is presentation, never security.** A hidden button is still reachable by
  anyone who can open a network tab.
- The SDK may pre-check to give an App a good error message. **The SDK's answer is
  advisory**; Core decides, and Core decides again on the call itself.
- **No authorization decision is cached beyond the scope of that decision.** A cached "yes"
  that outlives a revoked role is a permission that cannot be revoked. Introducing any such
  cache requires an explicit invalidation contract and its own decision record.
- Enforcement happens on the **callee** side of every internal call. A Service Binding is
  not a trust boundary that has already been crossed.

### D9 — Apps and Capabilities request permissions; they never grant themselves

- An App or Capability **declares** every permission it needs in its manifest.
  **Undeclared is denied** — at the boundary, at call time, not at load time.
- Permissions are granted **at install**, by a tenant principal with the authority to grant
  them, narrowly, revocably, and per tenant.
- **An App can never hold more than the granting principal held.** Installation is
  delegation, and delegation cannot manufacture authority. Formally, the granted set is:

  ```
  granted(app, tenant) = manifest.requested
                       ∩ effective(granting principal, tenant)
                       ∩ { p : p.scopes ∋ the scope of the grant }
  ```

  A manifest requesting more than the installer holds does not fail open and does not
  silently trim: **installation fails, and the missing permissions are named** — otherwise
  the App is installed in a state where it will fail unpredictably at runtime.
- **First-party Apps get no special path.** Same declaration, same grant, same enforcement.
  An official App that works without a declared permission has found a hole a third party
  will find too.
- Grants are enforced by Core on **every invocation** — not once at load, not by the SDK,
  not by the App.

### D10 — Roles are flat named bundles; effective access is a union of assignments

- A role is a **named set of permissions at one scope**. Nothing else.
- **Roles do not inherit from other roles.** No hierarchy, no parent role, no "extends".
  Role inheritance makes the effective set a graph traversal, and "why can this principal
  do that?" stops having a short answer.
- A principal may hold **many** assignments. Effective access is the **union** of them, with
  **each assignment evaluated at its own scope** — an assignment at `branch` grants nothing
  outside that branch, however broad another assignment is.
- D6's intersection applies to every assignment independently, before the union.
- **Roles are data, never code.** A role name appearing in a conditional in source is a
  defect; code checks *permissions*. The single exception is the platform's own bootstrap
  role, which is declared in the catalog and audited.
- Seed roles ship as a starting point and customers modify or replace them freely.

### D11 — Delegated administration cannot escalate

Granting is itself an authorized operation, subject to two conditions **both** of which must
hold:

1. **The granting principal holds the permission it is granting**, at a scope that contains
   the scope of the grant. You cannot grant what you do not have. This is the rule that
   makes the whole model non-escalating, and it is the one most often omitted.
2. **The granting principal holds the grant-administration permission** (role assignment,
   App permission grant) at a scope containing the target.

Further:

- The scope of a delegated grant is **at or below** the granter's own scope, never above.
- Role assignment, role modification, and permission grants are **`sensitive`** operations
  at minimum and are always audited (D14).
- A principal cannot grant itself a permission it does not already hold, through any path —
  including by creating a custom role, editing one, or installing an App.

*Prevents:* the administrator who grants themselves more than they have, which is the
classic RBAC escalation.

### D12 — Revocation is immediate and complete

- Revoking a role, an assignment, or an App grant takes effect **on the next call**. Not on
  the next deploy, not on the next session, not on cache expiry.
- This is why D8 forbids caching decisions beyond their scope; the two rules are one rule.
- Revocation is audited, with the same fields as the grant it reverses.
- **Uninstalling an App revokes its grants entirely**, and the data-disposition question is
  separate and answered by the App lifecycle, not by the permission model.
- A credential or principal that is deleted has its grants removed, not orphaned.

### D13 — Service accounts, background jobs, and device identities

- **Every credential belongs to exactly one principal, in exactly one tenant, with an
  explicit permission set** — never "all permissions of its creator", which silently grows
  as the creator's role grows.
- Credentials are **listable, revocable, and show last use**. A credential nobody can find
  is a credential nobody will revoke.
- Issuing, rotating, and revoking are **`critical`** and audited.
- **There is no ambient system superuser.** Background work — queue consumers, workflow
  steps, scheduled jobs, event handlers — runs as a **declared principal with an explicit,
  tenant-scoped permission set**, and is authorized by the same Core check as a human
  request.
- **A scheduled job that operates across tenants iterates tenants explicitly, acting as a
  per-tenant principal for each** (`MULTITENANCY_STANDARD.md` §4, carrier 6). A cron that
  queries across tenants is a cross-tenant read.
- An action taken by a background job on behalf of a user records both identities in the
  audit event (D14): the acting principal and the on-behalf-of principal.
- IoT devices get the narrowest scope available, usually `branch` or `resource`, and usually
  a single permission.

### D14 — Auditability

Every `sensitive` and `critical` action, and every grant, revocation, role change, and
membership change, produces an audit event containing: timestamp · tenant · principal type
and id · acting-on-behalf-of where applicable · app id · action id · **permission and scope
used** · target resource identifiers · the decision · correlation id.

- Audit records are **append-only and never mutated**.
- Audit exists to answer "who could do this, who did it, and under which grant" — which is
  why the *permission and scope used* is recorded, not merely the outcome.
- Audit records are tenant-scoped like any other tenant data, and a tenant's audit log never
  contains another tenant's identifiers.

### D15 — Sensitivity classes drive audit and elevation

| Class | Requires |
|---|---|
| `read` | Permission |
| `write` | Permission |
| `sensitive` | Permission + **audit event** |
| `critical` | Permission + audit + **explicit confirmation** |

Elevation mechanisms: user confirmation, approval workflow, MFA re-authentication, step-up
authorization.

- **Elevation is per operation, never per session.** An elevation that opens a window
  during which anything may be done is a session upgrade, and the audit trail then cannot
  say what the principal actually confirmed.
- A confirmation is single-use, short-lived, and states exactly what will happen.
- **For an AI principal, confirmation is collected by the platform from the human.** A model
  asserting that the user agreed is not a confirmation — the model is the party being
  constrained, and letting it certify its own constraint removes the constraint.

### D16 — Custom roles, without weakening the MVP

Customers create custom roles. That is required (master plan §6: "roles must not be
hardcoded"), and it is where a permission model usually acquires its holes. Four constraints
keep it safe, and all four hold from the first custom role:

1. **A custom role may contain only permissions the creating principal itself holds**, at a
   scope at or below the creator's own (D11 condition 1). Creating a role is a grant.
2. **D6's intersection applies unchanged.** A custom role at `business` scope cannot contain
   a permission declared only at `organization` or `platform`, wildcard or not.
3. **A tenant principal can never create a role containing a `platform`-scope permission**,
   because no tenant principal holds one. This follows from 1 and 2 rather than being a
   special case, which is why it cannot be forgotten.
4. **Custom roles are tenant data** (D7): defined in one tenant, invisible and unassignable
   in every other.

**What is deliberately deferred, and is safe to defer because the model above does not
depend on it:** a role-template or role-sharing feature across tenants; role composition or
inheritance (D10 forbids it for now, and adding it later is additive); permission grouping
for a readable consent screen (AZ4 — a product decision, and unreadable consent is not
consent, so it is a real gap, not a cosmetic one).

---

## 4. What this record does not decide

| # | Not decided here | Where it belongs |
|---|---|---|
| 1 | **Authentication** — sessions, tokens, OAuth/OIDC. This model assumes an authenticated principal and cannot produce one | AZ2, an ADR with Phase 1 identity work |
| 2 | **Break-glass platform-operator access to tenant business data.** D4 forbids it without elevation; support will eventually need it. **This gap is load-bearing**: without a break-glass mechanism, `platform-admin` either cannot support customers or quietly reads their data | AZ3, needed **before** the Phase 1 admin portal reads tenant data |
| 3 | **The App permission and trust model** — sandboxing, capability grants to untrusted code | `0001` decision 1, its own ADR, sequenced after this one |
| 4 | **Permission grouping for the install consent screen** | AZ4, a product decision |
| 5 | **Any storage shape, table, or API for permissions** | Phase 1, and it depends on `0006` |

---

## 5. Consequences

**What becomes possible:** `0001`'s sequencing unblocks — this record is the first link, so
the App permission and trust ADR can follow, and after it the SDK. Phase 1 can build
authorization against a settled abstract model rather than inventing one per module.

**What must change when this record is accepted** — these are consequences of D6 and D10,
and they are listed so acceptance is not mistaken for "no work follows":

1. `AUTHORIZATION_STANDARD.md` §3.2 gains D6 verbatim as a normative rule.
2. `permission-catalog.yaml` `model.rules` gains D6, and its `defaultRoles` seed data is
   corrected: on the rule as stated, `business-owner` (`core.*` at `organization`),
   `platform-admin` (`core.*` at `platform`), `marketplace-moderator`, and `member` all
   currently define roles that D6 makes invalid. Under D6.2 an invalid role definition
   fails lint rather than being silently trimmed, so all four must be rewritten as part of
   accepting this record.
3. The D6.4 catalog lint check is added to CI.
4. `TESTING_STANDARD.md` §6 gains rows for: a tenant-scope role expanding a wildcard across
   a platform-scope permission (denied); a delegated grant exceeding the granter's own
   permissions (denied); a revoked grant on the very next call (denied).
5. `AUTHORIZATION_STANDARD.md` AZ1 and the `permission-catalog.yaml` header both stop saying
   "that record does not exist yet."

**What becomes harder, accepted deliberately:**

- **No role inheritance (D10)** means a customer with a deep role hierarchy in mind has to
  express it as multiple assignments. Accepted: a graph is not worth the loss of a short
  answer to "why can they do that?"
- **D11 condition 1** means an administrator cannot grant a permission they do not
  themselves hold, which will occasionally be inconvenient and is the whole point.
- **D8's no-caching rule** puts an authorization decision on every call. That is a real
  performance cost on a single-threaded D1 (`0006` §1.4), and it is the correct trade —
  but it means the permission lookup path is one of the first things that will need
  measuring.
- **D6.3** means every new `sensitive` or `critical` permission carries a review obligation.

---

## 6. Approval

**Not approved. Not accepted. Status is Proposed.**

No user approval has been given for this model. `architecture-agent` drafted it and holds no
approval authority; a Team Lead instruction is not user approval
(`.claude/rules/security.md` §8). The Team Lead records; the user decides.

Until an accepted version of this record exists, `AUTHORIZATION_STANDARD.md` remains a
standard rather than a decision, `permission-catalog.yaml` remains entirely `proposed`, and
**no SDK or App-runtime work begins** — that gate is `0001` decision 1, and this record does
not open it.
