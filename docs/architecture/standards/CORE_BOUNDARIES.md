# Core Boundaries

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** `platform/core/**` and every proposal to add something to it.
- **Depends on:** `CONSTITUTION.md` Rule 1, `ARCHITECTURE.md`.
- **Source:** master build plan §6, §14.

Core is the smallest thing that lets every other thing exist. This document makes "Core
stays small" enforceable instead of aspirational.

---

## 1. What Core is

Core is the platform. It is shared by every tenant, every App, and every business type
that will ever exist on Dudo — including the ones nobody has thought of. That is the whole
reason it must stay small: anything specific placed in Core becomes a permanent
constraint on future applications.

Core owns the primitives listed in §3. It owns nothing else.

---

## 2. The inclusion test

Before anything is added to `platform/core/**`, answer all four questions. **A single
"no" means it does not belong in Core.** Record the answers in the task specification.

1. **Would every App need it, in every industry?**
   If a dental clinic, a car workshop, a freight company, and a SaaS startup would all
   need it in the same shape — it is a candidate. If it only makes sense for some of them,
   it is an App or a Capability.

2. **Does the platform stop working without it?**
   Identity, authorization, tenancy, and the App registry are load-bearing. An invoice
   is not.

3. **Is it free of business semantics?**
   Core may know that a record exists, who may see it, and which tenant owns it. Core may
   not know what a *loyalty point*, a *shipment*, or an *appointment* is. If the code
   contains an industry noun, it is not Core.

4. **Would putting it in an App make the App unbuildable?**
   Some things genuinely cannot live above the platform — issuing sessions, deciding
   permissions, resolving tenants. If an App *could* do it, the App does it.

**If in doubt, it is not Core.** The cost of wrongly excluding something is one App-level
duplication that can be promoted later. The cost of wrongly including something is a
constraint on every future business type, and it is effectively permanent.

---

## 3. What Core owns

These are the primitives. Each is enumerated as concrete objects in
`packages/contracts/registries/core-object-registry.yaml`.

### 3.1 Identity
Registration, login, password reset, sessions, MFA-ready architecture, OAuth/OIDC
readiness. Core is the only issuer of an authenticated principal.

### 3.2 Organization structure
```
Platform → Organization → Business / Workspace → Branch / Team → User
```
**Not every customer uses every level.** A single-location freelancer has an Organization,
one Business, no Branch, no Team. Levels are optional in use, never optional in the model
— a scope that exists only for large customers still has to be expressible for small ones.

### 3.3 Principals
Human User · Team · Service Account · AI Agent · IoT Device. Authorization treats all five
uniformly (`AUTHORIZATION_STANDARD.md` §2). An AI agent is a principal, not an exception.

### 3.4 Roles, permissions, and scopes
`Principal + Role + Permission + Scope = Access`. Default roles may ship, but **roles are
never hardcoded** — customers create their own. A role name that appears in a conditional
in source is a defect.

### 3.5 Teams
First-class objects with a manager, members, roles, permissions, a branch, shared
workflows, and shared notifications. A Team can be a principal.

### 3.6 Platform billing
Plans, quotas, usage, subscription status, marketplace charges. **This is billing for
using Dudo. It is not a tenant's business payment processing**, which belongs to the
Payment Capability and an App. See §5.

### 3.7 Core platform services
Notifications · file service · audit log · activity timeline · search infrastructure ·
settings · feature flags · usage metering · developer registration · API credentials.

### 3.8 Marketplace and runtime registries
App installation, App lifecycle, Capability Registry, Event Registry, Workflow Runtime,
MCP Registry.

---

## 4. Primitive versus Capability

The master plan lists Search, Notifications, and Files under **both** Core services (§6)
and Capabilities (§2). That is a genuine contradiction in the source, and this is the
resolution `architecture-agent` recommends — it needs Team Lead confirmation.

| Layer | Role |
|---|---|
| **Core primitive** | The mechanism: an index, a notification delivery path, an object store. Always present, always tenant-scoped. |
| **Capability** | The vendor-neutral interface an App calls. |
| **Provider** | Whatever implements it. **Core is the default provider**; a Connector may replace it per tenant. |

So an App calls `Notifications.send()` — the Capability. On a default installation, the
Core notification service answers it. If a tenant installs an SMS Connector, the same call
is served by that Connector. **The App never changes.** That is exactly Rule 6 applied to
a Core-provided service, and it is why these three are not an exception to "Apps request
capabilities, not vendors".

---

## 5. What Core does not own

Explicit, because these are the ones that get argued about.

| Not Core | Where it belongs | Why |
|---|---|---|
| Customers, contacts, leads | An App | Industry nouns. Fails inclusion test §2.3. |
| Invoices, orders, payments, payroll | An App | Same. Core knows *records*, not *invoices*. |
| Appointments, inventory, shipments | An App | Same. |
| Tax rules, pricing rules, discounting | An App | Business rules vary per industry and per country. |
| Stripe, DHL, WhatsApp — any vendor | A Connector | Rule 6. Core never depends on an external integration. |
| A specific LLM or model provider | The AI Capability + a provider | `AI_STANDARD.md` §2. |
| Approval workflows for a business process | An App, on the Workflow runtime | Core owns the *runtime*; the App owns the *process*. |
| Reporting and dashboards for business data | An App | Core owns the activity timeline primitive, not business analytics. |
| Charging a tenant's customer's card | Payment Capability, invoked by an App | Core's billing charges the tenant for using Dudo; that is a different transaction with different money. |

**The billing distinction matters and is easy to get wrong.** Core's billing decides
whether a tenant may use a feature. It never processes a tenant's own commerce. When Core
itself needs to take money, it invokes the Payment Capability *contract* — a dependency on
an interface Core publishes, not on a connector Core knows about.

---

## 6. Rules for code inside Core

1. **No industry nouns.** A type, table, column, function, or route named for a business
   domain object is a defect.
2. **No imports from above.** `platform/core/**` never imports from `apps/**`,
   `connectors/**`, `platform/web/**`, or `packages/sdk/**`. Checkable statically, and it
   should be checked in CI once CI exists.
3. **No vendor names.** Not in code, not in configuration, not in a comment describing
   intended behaviour.
4. **No Cloudflare types in domain logic.** Adapters only (`CLOUDFLARE_STANDARD.md` §2).
5. **No App-specific special cases.** Not `if (appId === 'finance')`, not a lookup table
   of known Apps with different behaviour. If Core needs to vary by App, it varies by a
   *declared manifest property*, which every App can set.
6. **Every Core entry point authorizes and resolves tenant itself.** Core is the last
   line; there is no line behind it.

---

## 7. Adding to Core

1. The requesting agent writes the four inclusion answers into the task specification.
2. `architecture-agent` reviews the boundary and states whether it belongs in Core, an
   App, or a Capability.
3. If it belongs in Core and it is a new Core object, it is added to
   `core-object-registry.yaml` in the same change.
4. If any inclusion answer is "no", the Team Lead is told and the work is redirected. An
   agent never resolves this itself.
5. If a requirement genuinely forces business logic into Core, that is escalated to the
   Team Lead immediately — it means either the requirement or the architecture is wrong,
   and both are worth stopping for.

---

## 8. Verification checklist

Reviewable on any change under `platform/core/**`:

- [ ] Inclusion test answered, four "yes", recorded in the task specification.
- [ ] No industry noun in any identifier.
- [ ] No import from `apps/**`, `connectors/**`, `packages/sdk/**`, `platform/web/**`.
- [ ] No vendor name anywhere in the change.
- [ ] No Cloudflare type outside an adapter module.
- [ ] No behaviour keyed to a specific App id.
- [ ] New Core objects added to `core-object-registry.yaml`.
- [ ] Every new entry point authorizes and resolves tenant server-side.
- [ ] Permissions for new entry points added to `permission-catalog.yaml`.
