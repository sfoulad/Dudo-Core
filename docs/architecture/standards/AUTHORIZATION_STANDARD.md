# Authorization Standard

- **Status:** Draft for Team Lead review — Phase 0. **Parts of this document constitute the "logical permission model" that `0001` requires as its own decision record before implementation.** `architecture-agent` proposes; the Team Lead records; the user approves.
- **Authored by:** `architecture-agent`.
- **Applies to:** every entry point in Dudo — API, event consumer, workflow step, MCP tool, SDK call, scheduled job.
- **Depends on:** `CONSTITUTION.md` Rule 10, `MULTITENANCY_STANDARD.md`, `SECURITY_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/permission-catalog.yaml`.

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
- **What a wildcard *expands to* is not yet decided (AZ6), and until it is, no role uses
  one.** This rule says only *where* a wildcard may appear. The naive reading — expand to
  every matching permission regardless of that permission's own declared `scopes` — makes
  a tenant role at `organization` scope hold `core.principal.grant-platform-scope`, which
  is tenant-to-platform privilege escalation. The seed roles in `permission-catalog.yaml`
  are therefore written as explicit lists that are safe under every candidate expansion
  rule. **Do not reintroduce a wildcard into a role definition until AZ6 is recorded as an
  accepted decision.**
- **An App manifest may never request a permission at `platform` scope.** `platform` is
  reserved to platform principals (§4). A manifest declaring it **fails validation and the
  App does not install** — it is not accepted-then-trimmed, because an App installed in a
  state where it will fail unpredictably at runtime is worse than one that did not
  install. Enforced structurally by `app-manifest.schema.json` `$defs/appRequestableScope`,
  which is `$defs/scope` minus `platform`. Every marketplace App is untrusted by
  assumption, including our own (`SECURITY_STANDARD.md` §1 threat 2), so this cannot be a
  review item.
- **`list` is a separate permission from `read`.** Enumeration is its own disclosure: the
  count and the identifiers are information even when the records are not readable.
- **`export` is always separate.** Reading one record and downloading the whole book are
  different risks.
- Permissions are additive. There are no negative permissions and no deny rules — a deny
  overlay makes the effective permission set impossible to reason about, and "why can this
  user do that?" must always be answerable.

---

## 4. Scopes

The scope ladder, narrowest last. This table is the record of it, and
`permission-catalog.yaml` carries the same set machine-readably:

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
  **That elevation mechanism does not exist yet (AZ3), so the rule must hold by
  construction rather than by control.** Only two permissions are declared at `platform`
  scope — `core.principal.grant-platform-scope` and `core.marketplace.moderate` — and
  `platform-admin` holds exactly those two and nothing else. A platform operator therefore
  has *no* path to tenant business data, including for support, which is the cost being
  paid deliberately until AZ3 is recorded. A control that exists only as an English
  sentence is not a control, so it must not be re-stated as one: **no platform-scope role
  may be given a permission declared at any tenant scope in place of the break-glass
  record.** Both platform-scope seed roles now satisfy this. `marketplace-moderator`
  carried `core.app.read`, declared `scopes: [organization, business]`; it has been
  removed. That was the last surviving instance of a platform role reaching a
  tenant-scoped permission, and it was unsafe under both candidate readings of scope
  intersection — a cross-tenant read of every tenant's installed Apps under the union
  reading, an invalid role definition under the intersection reading drafted as `0007` D6.
  **The cost is stated rather than absorbed:** marketplace moderation now has no view of
  Apps at all. The fix is a properly platform-scoped App-read permission, declared at
  `platform` scope and covering published App versions rather than tenant installations —
  which is a model decision, recorded as **AZ8** and deliberately not made here. Widening
  `core.app.read`'s declared scopes to include `platform` would be the wrong repair: it
  pushes a tenant-scope permission above the tenant boundary and recreates exactly the
  escalation this rule exists to prevent.
- The Action declares the scope level at which its permission is evaluated. Evaluating at
  the wrong level is a silent privilege escalation, so it is part of the contract and part
  of review.
- `own` requires a defined ownership relation **on the entity the Action actually targets**.
  An entity with no ownership column cannot meaningfully be reached at `own` scope, and
  pretending otherwise grants everything. An ownership relation on some *other* entity in
  the same manifest is not a substitute and never satisfies the rule: see VAL-OWN
  immediately below, and **AZ7** for the exact split between what the schema decides and
  what the validator owes.

**VAL-OWN (normative validation rule).**

> **1. Manifest level.** A manifest in which any Action declares `scope: own` must declare
> at least one entity carrying an `ownershipField`.
>
> **2. Action level.** Every Action declaring `scope: own` must declare `targetEntity`.
>
> **3. Referential.** That `targetEntity` must name an Entity declared in the **same
> manifest**, and that Entity must itself declare a valid `ownershipField`. An
> `ownershipField` on any *other* entity does not satisfy this clause, at all, ever.
>
> A manifest failing any of the three **fails validation, and the App does not install.**
> It is never accepted and then evaluated as unrestricted. Missing, unknown, malformed, or
> ambiguous `targetEntity` all **fail closed**.

This is stated as a named failing rule rather than as prose because the failure mode is
an authorization bypass *that presents as a security control*: the developer who writes
`scope: own` believes they applied the narrowest scope in the system, and on an entity with
no ownership relation they applied none at all. A rule written twice and enforced zero
times is not a rule.

**Ownership is declared, never asserted at invocation.** The ownership relation the platform
honours is the one this manifest declared and the platform recorded at install. A client, an
App, an SDK caller, or an AI principal may not supply a `targetEntity`, an ownership field
name, or an owner identifier with a call in order to select what `own` means for that call.
A request that attempts to is denied; it is not merged, defaulted, or preferred. This is the
same rule as `MULTITENANCY_STANDARD.md` §3 for tenant context, applied one level down: an
input that decides its own authorization scope is not an input, it is a grant.

**Correction, recorded rather than removed.** An earlier version of this section and of
the schema's `ownershipField` description stated — the schema in capitals — that the
dependency crosses the `actions` and `entities` sibling arrays and is *therefore not
expressible in JSON Schema*. **That was wrong.** It is expressible in draft 2020-12 with
`if`/`then`/`contains`, it was demonstrated to be so by independent verification, and it
is now expressed. The enforcement gap was a choice not yet made, not a limit of the
format, and "inexpressible" read as closed-for-now when it was not.

### 4.1 AZ7 — where each clause of VAL-OWN is enforced

Clauses 1 and 2 are decidable by the schema. Clause 3 is not, and the reason is narrow and
specific: it requires comparing a value in one array against the values of a *field* of
sibling items in another array — `actions[].targetEntity` against `entities[].name` — and
JSON Schema draft 2020-12 has no keyword that compares two instance values. It is not a
limit of the manifest format any more; the Action now names its target. It is a limit of the
schema language, and it is the *only* part that is one.

**What `app-manifest.schema.json` enforces**, by keyword:

| Guarantee | Where | Keywords |
|---|---|---|
| An Action at `scope: own` declares `targetEntity` | `$defs/action.allOf[1]` | `if` { `properties.scope.const: "own"`, `required: ["scope"]` } → `then` { `required: ["targetEntity"]` } |
| `targetEntity` is well-formed and non-empty | `$defs/action.properties.targetEntity` → `$defs/entityName` | `$ref`, `type: string`, `minLength: 1`, `pattern: ^[A-Z][A-Za-z0-9]*$` |
| An Action carries no *other* targeting field the runtime might read instead | `$defs/action` | `additionalProperties: false` |
| A manifest using `own` declares at least one owned entity | top-level `allOf[0]` | `if` { `properties.actions.contains` { `required: ["scope"]`, `properties.scope.const: "own"` } } → `then` { `required: ["entities"]`, `properties.entities.contains.required: ["ownershipField"]` } |
| The declaring and referencing forms of an entity name cannot drift | `$defs/entityName` | one definition, `$ref`-ed by `entity.name` and `action.targetEntity` |

That is clauses 1 and 2, in full, and **nothing of clause 3**. The schema does not resolve
`targetEntity`, does not know whether the named entity exists, and does not know whether it
carries an `ownershipField`. Reading the table above as "VAL-OWN is enforced" is the exact
overclaim that produced the earlier defect, and it is wrong in the same way.

**What the registry-aware validator owes (VALIDATOR-AZ7).** Normative. Every item fails
closed — the manifest is rejected and the App does not install:

1. **Resolution.** For every Action with `targetEntity`, exactly one entity in
   `entities[]` has that `name`. Zero matches — an unknown target — is a failure.
2. **Ambiguity.** Entity `name` values are unique within the manifest. Two entities sharing
   a name make every reference to it ambiguous, and an ambiguous ownership target is
   rejected rather than resolved by document order.
3. **Ownership.** For every Action with `scope: own`, the resolved entity declares
   `ownershipField`, and that value names a field present in that entity's own `fields[]`.
   An `ownershipField` naming a field the entity does not declare is not a valid ownership
   relation.
4. **No substitution.** An `ownershipField` on any entity other than the resolved
   `targetEntity` contributes nothing. The validator must not fall back to the manifest-level
   clause when clause 3 fails — passing clause 1 while failing clause 3 is precisely the
   bypass being closed.
5. **Non-`own` Actions.** `targetEntity` is optional outside `own` and carries **no**
   scoping semantics there — it neither narrows nor widens how the permission is evaluated.
   Where it is present it must still satisfy items 1 and 2; no targeting behaviour is
   inferred from it.
6. **Invocation time.** Core resolves the ownership relation for an `own`-scoped call from
   the installed manifest record only. Any `targetEntity`, ownership field, or owner
   identifier arriving in a request body, query string, header, or SDK argument is rejected,
   never merged and never preferred.

VALIDATOR-AZ7 now exists — `packages/contracts/validation/app-manifest-relations.mjs`,
approved by `docs/decisions/0009` as a narrow Phase 0 exception — and it detects exactly the
residual case: an App declaring ownership on one entity and applying `own` to an Action whose
`targetEntity` is a different, unowned entity. Run against the AZ7 fixture set it is 17/17
correct, rejecting that manifest with `AZ7_TARGET_ENTITY_NOT_OWNED`. **Until it runs in CI
and on the install path, clause 3 is enforceable but not automatically enforced** — a
manifest nobody ran it against has not been checked, and the module is Foundation Gate
tooling, not a production installation-time validator (`0009`). Tick the checklist box below
against an actual run and against nothing else.

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

Explicit access is required for customer information, payments, financial information,
documents, employees, external APIs, AI, and devices. Those map to `sensitive` at minimum
(`SECURITY_STANDARD.md` §3).

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
- [ ] No App manifest requests a permission at `platform` scope.
- [ ] No role definition contains a permission whose declared `scopes` exclude that role's
      own `scope` — checked against `permission-catalog.yaml`, seed and custom roles alike.
- [ ] VAL-OWN clause 1: no manifest declares an Action at `scope: own` without at least one
      entity declaring `ownershipField` — enforced by `app-manifest.schema.json`.
- [ ] VAL-OWN clause 2: every Action at `scope: own` declares `targetEntity` — enforced by
      `app-manifest.schema.json`.
- [ ] VAL-OWN clause 3: every `own`-scoped Action's `targetEntity` resolves to exactly one
      entity in the same manifest, and that entity declares a valid `ownershipField` —
      **not enforced by the schema and not enforceable by it** (§4.1). Tick only against a
      run of VALIDATOR-AZ7 (`packages/contracts/validation/app-manifest-relations.mjs`,
      `0009`) over the manifest in question — the validator exists and its AZ7 fixture run is
      17/17 correct, so this box is now tickable by running it. A tick records that the
      validator was run and passed; it does **not** record automated enforcement, because no
      CI job and no install path invokes it yet.
- [ ] No ownership relation is accepted from a caller at invocation time (§4, VALIDATOR-AZ7
      item 6).
- [ ] No App entity field is classified `secret`.
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
| AZ5 | **How does a principal come to hold an `own`-scope permission?** `core.notification.read` is declared `scopes: [own]`, so no role at `organization`, `business`, `branch` or `team` scope can legitimately carry it — yet every principal must read their own notifications. | Either a baseline self-role held at `own` scope by every principal, or widen the permission's declared scopes. Both are model decisions. Fail-closed meanwhile: the permission is in no seed role, so it is granted to nobody. Needed in Phase 1. |
| AZ6 | **What does a wildcard in a role definition expand to?** §3.2 says only where one may appear. The naive union reading is tenant-to-platform escalation; the intersection reading is drafted as `docs/decisions/0007` D6, which is **Proposed and decides nothing**. | Record the expansion rule, then add the catalog lint that recomputes every role's expanded set and fails on any permission whose declared `scopes` exclude the role's `scope`. Until then no role uses a wildcard and none may be added. Blocks Phase 1 and the CI lint. |
| AZ7 | **Binding an Action to its target entity.** *Contract enforcement closed; automated and runtime enforcement open.* `$defs/action` carries `targetEntity`, and the schema requires it whenever `scope` is `own`, so an `own`-scoped Action can no longer borrow an unrelated entity's `ownershipField` to satisfy VAL-OWN unnoticed. The referential clause is no longer unenforceable: `packages/contracts/validation/app-manifest-relations.mjs` implements VALIDATOR-AZ7 (§4.1) as a zero-dependency module, approved by `0009` as a narrow Phase 0 exception, and it has been **run against the AZ7 fixtures — 17/17 outcomes correct**, with `az7-n4`, the CWE-863 exploit manifest, moving ACCEPT → REJECT as `AZ7_TARGET_ENTITY_NOT_OWNED` while the positive owned-target fixture `az7-p2` still accepts. Three things remain open. (a) **Nothing runs it automatically** — no CI job, no install path, no runtime. The clause is *enforceable and proven against fixtures*; it is **not** enforced in production, and writing it up as though it were is the CRIT-4 overclaim. (b) This is a **manifest-format change** touching the SDK, Studio, `APP_STANDARD.md`, and every future published manifest; `0009` records the validator, not the format change, which still needs its own decision record — the Team Lead owns it. (c) An Action may target **exactly one** entity today. Multi-entity Actions are deliberately not given targeting semantics here rather than invented. | Team Lead records the format change; CI runs the validator over the AZ7 fixtures, and Phase 1 wires it into the install path against that same conformance suite (`0009`). Do not treat the schema half as the rule, and do not treat a fixture run as production enforcement — §4.1 states which half is which, and that distinction is load-bearing. |
| AZ8 | **Marketplace moderation has no permission it may legitimately hold to view Apps.** `marketplace-moderator` is `platform` scope; `core.app.read` is declared `scopes: [organization, business]` and has been removed from it (§4). Moderation reviews *published App versions*, which is not the same object as *a tenant's installed Apps*. | Declare a new permission at `platform` scope over published App versions and marketplace submissions — not a widening of `core.app.read`, which would push a tenant-scope permission above the tenant boundary. Declaring a new platform-scope permission is a model decision, so it is recorded, not invented. Related to AZ3 but distinct: this needs no tenant business data. Blocks Phase 6 moderation. |
