# Authorization Standard

- **Status:** Draft for Team Lead review — Phase 0. **Parts of this document constitute the "logical permission model" that `0001` requires as its own decision record before implementation.** `architecture-agent` proposes; the Team Lead records; the user approves.
- **Authored by:** `architecture-agent`.
- **Applies to:** every entry point in Dudo — API, event consumer, workflow step, MCP tool, SDK call, scheduled job.
- **Depends on:** `CONSTITUTION.md` Rule 10, `MULTITENANCY_STANDARD.md`, `SECURITY_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/permission-catalog.yaml`.
- **Reconciled against the built system 2026-09-06.** §13 classifies all eight open issues.
  **This file carries four contradictions and they are the most serious in the corpus**, so
  they are marked where the rule is stated rather than only in the table: §3.2's wildcard
  clause (superseded by `0007` rule 3), §3.2's absolute `list`/`read` separation (narrowly
  contradicted by an argued contract), §4's *"only two permissions at `platform` scope"* (now
  ten), and §9's role model (two hardcoded roles, no custom roles, no audited assignment).
  **Nothing was rewritten to match the code.** Where the standard is the correct side, the
  divergence is reported for the Team Lead to route; where an Accepted decision has overtaken
  it, the superseding record is cited and the old text is struck rather than deleted.
  **`0007`'s ten binding rules outrank this document** wherever the two differ — see AZ1.

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
- ~~**Wildcards may appear in role definitions, never in App manifests.** A customer's
  admin role may carry `crm.*`; an App may never request it.~~ **CONTRADICTED and
  SUPERSEDED, 2026-09-06. A wildcard is permitted NOWHERE.** `docs/decisions/0007`
  (**Accepted** by the user, 2026-09-01) binding rule 3: *"**No wildcard permissions.** Not
  in roles, not in manifests, not in grants."* The struck sentence permitted in a role
  definition exactly what rule 3 forbids, and it is the sentence a reviewer would check a
  role against. **An App still requests each permission by name**, which is the half of the
  original rule that survives and is what makes a permission screen meaningful.
- ~~**What a wildcard *expands to* is not yet decided (AZ6), and until it is, no role uses
  one.**~~ **DECIDED, and harder than a expansion rule.** There are no expansion semantics
  to define, because there is nothing left to expand. The reasoning below is retained
  because it is why rule 3 is absolute rather than a preference: the naive reading — expand
  to every matching permission regardless of that permission's own declared `scopes` — makes
  a tenant role at `organization` scope hold `core.principal.grant-platform-scope`, which
  is tenant-to-platform privilege escalation, and that is the defect `0007` records as
  CRIT-1. The seed roles in `permission-catalog.yaml` are explicit lists.
  **Never reintroduce a wildcard into a role definition.**
  **Enforced in code, not by this rule:** `platform/core/authorization/roles.ts:31–34` —
  *"the sets below are frozen arrays of literal permission identifiers. There is no pattern,
  no prefix, no `startsWith`, no glob"* — and `assertRoleMappingIsCoherent` checks it at
  module load. `permission-catalog.yaml:887–895` carries the same supersession and names
  `roles.ts` as *"the file where a wildcard would otherwise be smuggled back in."*
- **An App manifest may never request a permission at `platform` scope.** `platform` is
  reserved to platform principals (§4). A manifest declaring it **fails validation and the
  App does not install** — it is not accepted-then-trimmed, because an App installed in a
  state where it will fail unpredictably at runtime is worse than one that did not
  install. **The rule is EXPRESSED** by `app-manifest.schema.json` `$defs/appRequestableScope`,
  which is `$defs/scope` minus `platform`. Every marketplace App is untrusted by
  assumption, including our own (`SECURITY_STANDARD.md` §1 threat 2), so this cannot be a
  review item.

  > **CORRECTED 2026-09-06 — this bullet said "Enforced structurally by", and "enforced" was
  > false.** The twin of this claim in `permission-catalog.yaml` `model.rules` rule 9 was
  > corrected the same day. **This is one claim with two homes, and the instance nobody fixes
  > is the one the next reader finds.**
  >
  > **Which side is false, per `.claude/rules/architecture.md` §3b — the schema is RIGHT and it
  > is UNEXECUTED.** Read rather than assumed: `$defs/scope`
  > (`app-manifest.schema.json:376–388`) enumerates seven values including `platform`;
  > `$defs/appRequestableScope` (lines 389–400) enumerates the same six minus `platform`. The
  > constraint is correctly expressed — and it is `$ref`ed at **two** sites, not the one this
  > bullet named: `permissions[].scope` (line 97) **and `actions[].scope` (line 549)**. So the
  > schema covers more than the sentence claimed while enforcing less than it promised.
  >
  > **That nothing executes it is verified, not asserted.** `packages/contracts/README.md`:
  > *"Nothing in this directory is executed. There is no JSON Schema implementation in this
  > repository … normative and hand-checked, never machine-validated."* Three further checks,
  > recorded so they are not repeated: `0009`'s approved validator,
  > `packages/contracts/validation/app-manifest-relations.mjs`, mentions `platform` exactly
  > once and it is inside an unrelated AZ7 error message — **it does not look at scopes at
  > all**; nothing in `platform/**` parses a manifest; and `apps/customers` is **compiled in,
  > not installed**. There is no admission path for a manifest to fail at.
  >
  > **So name the owner, because that is what makes this actionable rather than merely honest.**
  > `authorizer.ts` **does** enforce the declared-scope ceiling at call time
  > (`platform/core/authorization/authorizer.ts:118–130`) — but against an
  > `AppPermissionEnvelope`, which a Core author **transcribes by hand from the manifest**.
  > `apps/customers/app.ts:4` says so in its own header — *"transcribed from"* — and hand-writes
  > `scope: 'organization'` on all nine permissions (lines 39–47), labelling the transcription a
  > drift surface. **Therefore: whoever writes an `AppPermissionEnvelope` is the last check that
  > no App reaches `platform` scope**, because the constraint that would have refused the
  > manifest never runs. **That makes it a review item today — which is precisely what the
  > sentence above says it must never be.**
  >
  > **What would make the original claim true:** a manifest-admission path that executes this
  > schema, which needs `AS1` (the contract's executable form) and `TS1`. **The claim was
  > aspirational rather than wrong-headed** — the schema was written to *be* the enforcement,
  > and there is simply nothing yet to run it. **Do not repair this by weakening the schema:**
  > it is the specification that admission path will implement, and it is correct as written.
  >
  > **Same shape as AZ7 and it is not a coincidence.** §4.1 already draws the line between
  > *expressible*, *enforceable*, and *automatically enforced*, and records that collapsing it
  > is *"the CRIT-4 overclaim"*. This bullet collapsed the same distinction one section earlier,
  > in a rule about the single most dangerous scope in the system. **Both live in this file, and
  > only one of them had been caught.**
- **`list` is a separate permission from `read`.** Enumeration is its own disclosure: the
  count and the identifiers are information even when the records are not readable.

  > **CONTRADICTED in one argued case, 2026-09-06 — and the standard is what should move.**
  > `core.ListAuthorizedBusinesses` enumerates, and it is gated on `core.business.read`;
  > **`core.business.list` is deliberately not declared** in `permission-catalog.yaml`
  > (`platform/core/http/core-routes.ts:74–76`,
  > `packages/contracts/core/organization/business-read-v1.contract.yaml:452–494`). The
  > contract does not hide this — it quotes this rule, calls its own position *"a judgement
  > that has to be argued rather than assumed"*, and argues it:
  >
  > > *"THE RULE PROTECTS AGAINST ENUMERATING A POPULATION YOU MAY OTHERWISE ONLY READ ONE AT
  > > A TIME … ENUMERATING PRECISELY WHAT YOU MAY READ, AND NOTHING MORE, IS NOT A SECOND
  > > DISCLOSURE."*
  >
  > **And the fail-closed alternative is worse, which is the part that decides it.** A
  > `core.business.list` held by nobody leaves a principal unable to discover any valid
  > `business_id` — a value `CreateCustomer` requires — so *"the practical repair is for each
  > client to invent its own"*. Fail-closed is normally the safe direction; here it produces
  > two clients guessing an identifier, which is worse than the disclosure it prevents.
  >
  > **The contract also fences its own ruling** — it covers only listings whose row set **is**
  > the caller's authorized set, and an Action listing Businesses beyond it *"IS NOT
  > COVERED"* and needs `core.business.list` declared at that time. It keeps `export`
  > separate absolutely: `core.business.export` is undeclared so nobody can hold it.
  >
  > **Recommendation to the Team Lead: amend this rule rather than the code.** The narrowing
  > it needs is one clause — *a separate `list` permission is required wherever the
  > enumerated set can exceed what the principal may already read one at a time*. Left as an
  > absolute, the rule is one a correct implementation violates, and a rule that correct code
  > breaks is a rule the next author will discount. **`export` stays absolute and is not
  > narrowed.**
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
  construction rather than by control.**

  > **CONTRADICTED, 2026-09-06 — the count below is stale, and it is the sentence the whole
  > safety argument is built on.** The paragraph asserted *"only two permissions are declared
  > at `platform` scope … and `platform-admin` holds exactly those two and nothing else."*
  > **`permission-catalog.yaml` now declares ten**, and `platform-admin` holds **all ten**
  > (lines 914–924): `core.principal.grant-platform-scope`, `core.marketplace.moderate`,
  > `core.organization.create`, `core.organization.list`, `core.template.read`,
  > `core.template.list`, `core.template.create`, `core.credential.reset`,
  > `core.platform-audit.read`, `core.principal.revoke-platform-scope`. Eight arrived with
  > `0025`, `0026`, `0027` and `0028`.
  >
  > **The rule holds; the enumeration does not.** Every one of the ten declares
  > `scopes: [platform]`, so none is a tenant-scoped permission held by a platform role, and
  > the invariant in bold below is satisfied. `CONSTITUTION.md` §1 settles which side is
  > wrong when a standard and a registry disagree about a **value**: *"the registry wins,
  > because the registry is the artifact that is machine-checked. Fix the other side in the
  > same change."* This is that fix, and the same staleness sits in
  > `permission-catalog.yaml:898–899` — *"those are the only two that are"* — which is
  > `architecture-agent`'s file but outside the file set for this pass, and is reported to the
  > Team Lead rather than edited.
  >
  > **What genuinely changed, and it is not nothing.** "A platform operator has *no* path to
  > tenant business data" is still true and is now structural rather than arithmetic —
  > `docs/decisions/0024` (**Accepted**) makes a memberless platform principal *incapable* of
  > reading tenant rows: no membership → no selection → no store handle → no `whereWithTenant`
  > → no rows. **But the operator surface is far wider than two permissions**, and two of the
  > ten are severe on their own terms: `core.credential.reset` is described in its own catalog
  > entry as *"the most dangerous permission in this catalog that is not AZ3: holding it is
  > the ability to take over any account on the platform"*, and `core.platform-audit.read`
  > reads a log of what the platform did to its customers. **Neither is tenant business data,
  > and neither is covered by the sentence this paragraph uses to reassure a reader.** `0028`
  > is the record that reasoned about that surface; this standard had not caught up.

  **No platform-scope role
  may be given a permission declared at any tenant scope in place of the break-glass
  record.** Both platform-scope seed roles satisfy this, and all ten permissions above are
  declared at `platform` scope. `marketplace-moderator`
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
> A manifest failing any of the three **must fail validation, so that the App does not
> install.** *(Wording corrected 2026-09-06 from "fails validation, and the App does not
> install", which stated as fact what is an obligation: **no manifest is validated today**,
> because nothing executes JSON Schema and no install path exists. §4.1 and the note under
> §3.2's `platform`-scope bullet carry the verification.)*
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

**What `app-manifest.schema.json` EXPRESSES**, by keyword — *"enforces" corrected 2026-09-06,
and this correction is the more embarrassing of the two because it is in the section that
exists to police exactly this distinction:*

> §4.1 got the **harder** axis right and missed the easier one. It is meticulous that clause 3
> is *expressible-but-not-in-JSON-Schema*, and it says of clauses 1 and 2 that the schema
> **enforces** them. **It does not. It expresses them, and nothing runs it** — no JSON Schema
> implementation exists in this repository, `0009`'s validator does not read `scope`, nothing
> in `platform/**` parses a manifest, and there is no install path. **So all three clauses are
> unenforced today, for two different reasons**, and the table below reads as though the first
> two were settled. That is `.claude/rules/architecture.md` §3c's shape: a claim about a
> contract that a reviewer would not re-derive, because the surrounding prose is so careful
> about a neighbouring distinction that this one looks already handled.

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

**And it is wrong in a second way this paragraph did not catch.** The sentence above guards
against reading clauses 1 and 2's coverage as covering clause 3 — a *scope* error. It does not
guard against reading "the schema expresses it" as "something checks it" — a *liveness* error.
**Three distinct states, and only the first two were ever separated here:**

| State | Clauses 1 and 2 | Clause 3 |
|---|---|---|
| **Expressible in JSON Schema** | yes | **no** — §4.1's subject |
| **Expressed somewhere executable** | in the schema | in `app-manifest-relations.mjs` (`0009`) |
| **Actually executed against a manifest on the install path** | **no** | **no** |

The bottom row is the same answer for both, and it is the row that decides whether a hostile
manifest is refused. **A rule written twice and enforced zero times is not a rule** — this
section says exactly that of VAL-OWN, and then measured only one of the two ways it can be
true.

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
`targetEntity` is a different, unowned entity. It has been executed against the recorded AZ7
fixtures and rejects that manifest with `AZ7_TARGET_ENTITY_NOT_OWNED`; the measured result
and its scope are maintained in the authoritative `AZ7` entry in
`packages/contracts/registries/permission-catalog.yaml`, not duplicated here. **Until it runs in CI
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

> **CONTRADICTED on three of those clauses, 2026-09-06.** This is the recorded
> **role-vocabulary fork** (`docs/decisions/0023`), and it already has a trigger the Team Lead
> set: *"It must be reconciled before a second App exists, because that is the point at which
> 'add it to both roles' stops being a small change and becomes a fork"*
> (`docs/decisions/README.md`). It is reported here rather than repaired, because reconciling
> it is a decision and not an edit.
>
> | This standard says | The system does |
> |---|---|
> | Six default roles ship | **Two tenant roles exist.** `platform/core/authorization/roles.ts:65` — `export type MembershipRole = 'owner' \| 'member'`. The catalog's six seed roles are `status: proposed`; only `platform-admin` is separately reachable, through `platform_operator.platform_role` |
> | **Customers create custom roles** | **They cannot, by construction.** `0019` (**Accepted**) decided the role is *"a closed union of literals. Not free text"*, and an unrecognised stored value is not an error and not a partial grant — it is **deny all**. There is no surface for creating a role, and adding one is an edit to `platform/core/**` |
> | Role assignment is `sensitive` and **always audited** | **There is no audited assignment path at all.** `docs/decisions/README.md` records it four times over — *"No audited path for a role or permission change. `0007` rule 9 requires it; `0018`, `0019`, `0020` and `0023` each record its absence. Operator SQL and Organization creation have the same gap."* A role is set today by seed tooling and by hand |
>
> **The one clause that holds is the one about conditionals**, and it holds for a reason worth
> keeping: `grantsForRole` is a **map lookup over frozen literal permission lists**, not a
> branch on a role name, so code still checks permissions. `roles.ts:31–34` states why the
> shape was chosen — a role is *"exactly the construct that tempts"* rules 3 and 4 to be
> relaxed.
>
> **Which side is wrong.** The **standard** is, on "customers create custom roles" — `0019`
> reasoned it out against `0008`'s write ceiling and deferred the grant table rather than
> rejecting it, and its argument stands. The **system** is wrong on **audited role
> assignment**: `0007` binding rule 9 requires it, four records note its absence, and nothing
> has been assigned to close it. **That gap is the one to route, and it is not a documentation
> problem.**

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
      `0009`) over the manifest in question — the validator exists and has been executed
      against the recorded AZ7 fixtures, so this box is now tickable by running it. A tick
      records that the
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

**Classified 2026-09-06 against the built system**, on the three states defined in
`CONSTITUTION.md` §7. **Three closed, five still open.** Two of the five open ones — AZ4 and
AZ8 — are blocked on the same root: **there is no marketplace, no App install path and no SDK**,
so neither has anything to press against. AZ3 is the one whose *urgency* changed rather than its
answer.

| # | Question | State, and the recommendation or citation |
|---|---|---|
| AZ1 | **This document is the logical permission model `0001` requires.** It is a standard, not a decision record. | **CLOSED — recorded and accepted.** `docs/decisions/0007-logical-permission-model.md`, **Status: Accepted**, 2026-09-01, by **explicit written user acceptance**. Its own header answers this row by name: *"This record satisfies the obligation `0001` decision 2 requires and `AUTHORIZATION_STANDARD.md` AZ1 records as outstanding. Implementation may now proceed against it."* It was accepted subject to **ten binding rules** (`0007` lines 12–35) which *"govern wherever the body of this record is silent or less specific"* — so `0007`'s rules, not this document's prose, are the higher authority where the two differ. Rule 3 is why §3.2's wildcard clause above is struck. **`permission-catalog.yaml`'s own `AZ1` entry is stale and still says "nothing implements until then"** — reported to the Team Lead; that file is outside this pass's set. |
| AZ2 | **Authentication mechanism** — sessions, tokens, OAuth/OIDC — is unrecorded. Authorization assumes an authenticated principal but cannot produce one. | **CLOSED — decided and built.** `docs/decisions/0014-authentication-az2.md` (**Accepted**) states it in its own front matter: *"Closes: `AUTHORIZATION_STANDARD.md` AZ2."* Three parts — §A daily D1 write admission, §B the closed five-entry pre-authentication registry, §C the identity control plane. Continued by `docs/decisions/0015` (**Accepted**), which decides the credential format: **the browser runs 600,000 PBKDF2 iterations and the server rehashes at 10,000, so the server never receives a password**, because the Workers 10 ms CPU budget cannot fit a properly tuned KDF. Amended 2026-09-04 for **NFC** password normalisation — *the identifier uses NFKC, the password must not*. Built: `platform/core/identity/login.ts`, `session-credential.ts`, `credential-verifier.ts`, `session-principal-resolver.ts`; registry at `platform/core/identity/pre-auth-registry.ts:254–334`; contract at `packages/contracts/core/identity/login-v1.contract.yaml`. **Amended twice since:** `0017` (in-process pre-auth limiter, closed beta only) and `0018` (revocation carriers and cookie clearing). **This standard's claim that it "does not depend on the choice" held** — nothing in §1–§10 needed changing when the mechanism landed. |
| AZ3 | **Platform-operator access to tenant business data.** §4 forbids it without elevation, but support will eventually need it. | **STILL OPEN — needs an architecture decision (Team Lead), and the blocking claim in the original recommendation is now wrong.** It said *"needs its own record before any admin portal reads tenant data — which is Phase 1."* **The admin portal shipped and reads no tenant data**, so the deadline did not bind. Two Accepted records confirm the question is untouched: `0024` *"Break-glass access to tenant data (AZ3). Nothing here permits it. If a platform operator ever needs to read a customer's records, that is a separate decision with its own audit story, and the invariants above are what it must argue against rather than quietly relax"*; and `0028` *"Break-glass access to tenant data. Nothing here permits it, and `0024`'s invariants remain what any such proposal must argue against."* **What changed is the ground any future proposal stands on.** `0024` makes the prohibition **structural rather than declarative** — a memberless platform principal cannot reach a store handle, so there is no `whereWithTenant` to satisfy and no rows to return — and it names the trap a break-glass design would fall into: `scope.ts` ranks `platform` at 0, so **a membership row carrying platform authority would pass authorization everywhere and the storage boundary would then politely serve that tenant's rows.** Cross-tenant access assembled entirely from legitimate parts. **A break-glass record must not grant access by giving an operator a membership.** Recommendation otherwise unchanged: explicit, time-bounded, reason-required, tenant-notified, always audited. Same question as `SECURITY_STANDARD.md` SE5. |
| AZ4 | **Permission grouping for the install screen.** Twenty individually-named permissions are unreadable, and unreadable consent is not consent. | **STILL OPEN — a product decision needing the USER, and blocked on there being an install screen.** Nothing has moved: there is no marketplace, no App install path and no consent surface anywhere in `platform/**`; the one App is mounted by the composition root, not installed. The catalog's `group` field exists and is populated on every permission, so the data the recommendation depends on is already there. **Blocked with AZ8 on the same root** — both need the marketplace to exist. Not urgent, and cheap to answer when it is. |
| AZ5 | **How does a principal come to hold an `own`-scope permission?** `core.notification.read` is declared `scopes: [own]`, so no role at `organization`, `business`, `branch` or `team` scope can legitimately carry it — yet every principal must read their own notifications. | **STILL OPEN — needs an architecture decision (Team Lead). ⚠ AND THE LABEL "AZ5" NOW NAMES THREE DIFFERENT QUESTIONS, WHICH IS WHY THIS ROW LOOKS CLOSED AND IS NOT.** `docs/decisions/0019` is titled *"Where a principal's permission grants live (AZ5)"* and `0020` *"the second half of AZ5"* — both **Accepted**, both closing questions inherited from `0001`, and **neither touching this one**. `docs/decisions/README.md` still lists *"How a principal comes to hold an `own`-scope permission (AZ5)"* as unwritten, item 6, and that is correct. `permission-catalog.yaml:1118–1125` records the collision in the same terms. **Do not close this row by citing `0019` or `0020`.** The question is unchanged: `core.notification.read` is still declared `scopes: [own]` (`permission-catalog.yaml:560–564`) and still appears in **no** seed role, so it is granted to nobody and fails closed. Recommendation unchanged — a baseline self-role at `own` scope, or widen the permission's declared scopes; both are model decisions. **Team Lead: the three-way name collision is worth retiring with a rename, not only a footnote.** |
| AZ6 | **What does a wildcard in a role definition expand to?** §3.2 says only where one may appear. The naive union reading is tenant-to-platform escalation; the intersection reading is drafted as `docs/decisions/0007` D6, which is **Proposed and decides nothing**. | **CLOSED — and decided harder than this row asked for.** `docs/decisions/0007` was **Accepted 2026-09-01 subject to ten binding rules**, and **rule 3 prohibits wildcards outright**: *"No wildcard permissions. Not in roles, not in manifests, not in grants."* **So there are no expansion semantics to define, because nothing is left to expand**, and D6's intersection rule governs nothing here. `permission-catalog.yaml:887–895` records the same supersession. **The CI lint this row asked for is therefore not owed in the form described** — there is no expanded set to recompute. What replaced it is a stronger check in a cheaper place: `platform/core/authorization/roles.ts` holds frozen arrays of literal permission ids with *"no pattern, no prefix, no `startsWith`, no glob"*, and `assertRoleMappingIsCoherent` runs at module load, so a wildcard smuggled into a role stops the module rather than shipping. **§3.2 above still permitted a wildcard in a role definition and is struck there.** **`permission-catalog.yaml`'s own `AZ6` entry is stale** and still asks for the expansion rule — reported to the Team Lead. |
| AZ7 | **Binding an Action to its target entity.** *Contract enforcement closed; automated and runtime enforcement open.* `$defs/action` carries `targetEntity`, and the schema requires it whenever `scope` is `own`, so an `own`-scoped Action can no longer borrow an unrelated entity's `ownershipField` to satisfy VAL-OWN unnoticed. The referential clause is no longer unenforceable: `packages/contracts/validation/app-manifest-relations.mjs` implements VALIDATOR-AZ7 (§4.1) as a zero-dependency module, approved by `0009` as a narrow Phase 0 exception, and **the standalone relation validator has been executed against the recorded AZ7 fixtures** — `az7-n4`, the CWE-863 exploit manifest, moves ACCEPT → REJECT as `AZ7_TARGET_ENTITY_NOT_OWNED` while the positive owned-target fixture `az7-p2` still accepts. **The current measured result, fixture count, revision, date and runner are maintained in the permission catalog's authoritative `AZ7` entry** under `openQuestions` in `packages/contracts/registries/permission-catalog.yaml`. **This standard deliberately does not duplicate mutable result counts** — a hand-maintained number that nothing recomputes rots in whichever copy is not being read. **Not every fixture executes:** the invocation cases are runtime obligations no static validator can decide. **JSON Schema execution and production admission-path integration remain separate outstanding obligations.** Three things remain open. (a) **Nothing runs it automatically** — no CI job, no install path, no runtime. The clause is *enforceable and proven against fixtures*; it is **not** enforced in production, and writing it up as though it were is the CRIT-4 overclaim. (b) This is a **manifest-format change** touching the SDK, Studio, `APP_STANDARD.md`, and every future published manifest; `0009` records the validator, not the format change, which still needs its own decision record — the Team Lead owns it. (c) An Action may target **exactly one** entity today. Multi-entity Actions are deliberately not given targeting semantics here rather than invented. | **STILL OPEN on all three residuals, verified 2026-09-06 — and (a) has NOT moved.** Nothing invokes `packages/contracts/validation/app-manifest-relations.mjs`: `package.json:16` runs `node tools/run-suites.mjs`, there is no CI workflow, and no installation or admission path exists to wire it into. **The gap is currently harmless for a reason that will expire** — there is no App install path at all, so no manifest can reach installation unchecked because none can reach installation. **That is not the same as being enforced, and the day an install path is built is the day the gap becomes live.** (b) the manifest-format change still needs its own record — `0009` approves the validator and not the format. (c) single-entity targeting is unchanged. Team Lead records the format change; CI runs the validator over the AZ7 fixtures, and Phase 1 wires it into the install path against that same conformance suite (`0009`). Do not treat the schema half as the rule, and do not treat a fixture run as production enforcement — §4.1 states which half is which, and that distinction is load-bearing. |
| AZ8 | **Marketplace moderation has no permission it may legitimately hold to view Apps.** `marketplace-moderator` is `platform` scope; `core.app.read` is declared `scopes: [organization, business]` and has been removed from it (§4). Moderation reviews *published App versions*, which is not the same object as *a tenant's installed Apps*. | **STILL OPEN — needs an architecture decision (Team Lead), and blocked with AZ4 on the same root: there is no marketplace.** Verified unchanged: `permission-catalog.yaml:932–936` still gives `marketplace-moderator` exactly `[core.marketplace.moderate]` and describes it as *"Holds no tenant-scoped permission, so it currently has no view of Apps at all."* `core.app.read` is still declared `scopes: [organization, business]`. **The cost stays stated rather than absorbed** — moderation can moderate and cannot look. Recommendation unchanged, including its prohibition: **do not widen `core.app.read` to include `platform`**; that pushes a tenant-scope permission above the tenant boundary and recreates the escalation this row exists to record. **Eight platform-scope permissions have been added since this row was written and none of them is the one it asks for**, which is evidence the gap is real rather than an artefact of an empty catalog. Distinct from AZ3: this needs no tenant business data. Blocks Phase 6 moderation and nothing before it. |
