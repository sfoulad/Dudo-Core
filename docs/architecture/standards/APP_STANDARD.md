# App Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every App under `apps/**`, official and third-party alike.
- **Depends on:** `CONSTITUTION.md`, `ARCHITECTURE.md`, `API_STANDARD.md`, `EVENT_STANDARD.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/app-manifest.schema.json`.

An App is a complete business application a customer installs. This standard is what an
App must satisfy to be installable.

**Official Apps follow this standard exactly as third-party Apps do.** There is no
privileged path, no internal API only first-party code may call, and no manifest field
only Dudo may set. If an official App needs something the SDK cannot express, the SDK is
incomplete — that is the finding, and it goes to the Team Lead. This is the only reliable
test that the developer platform actually works.

---

## 1. What an App owns

Its logic, its data, its API, its events, its permissions, its UI, and its tests. All
seven, declared in its manifest. Ownership that is partial is ownership that leaks.

## 2. What an App may never do

| Prohibited | Instead |
|---|---|
| Read or write another App's storage | Call that App's internal API, or consume its events |
| Open a database connection, issue SQL, use a Core ORM model, read a Core cache, or touch Core files | Use the storage port the SDK hands it |
| Import Core internals | Use `packages/sdk/**` against a published contract |
| Depend on a named vendor | Request a Capability (`CAPABILITY_STANDARD.md`) |
| Resolve or select its own tenant | Tenant arrives in the invocation context, server-derived |
| Perform its own authorization and skip Core's | Declare the permission; Core enforces it |
| Modify Core UI | Register into a declared extension location (§8) |
| Make an outbound network call not declared in its manifest | Declare it in `externalNetworkAccess`, or use a Connector |
| Invent an event concept that already exists | Consume the existing event; see `EVENT_STANDARD.md` §8 |
| Ship a secret in its source or manifest | Reference a secret by name; values live in the approved store |

Each row is checkable in review. Several are checkable statically once CI exists, and
should be.

---

## 3. Required structure

```
apps/<app-id>/
  manifest.json          required — validates against app-manifest.schema.json
  README.md              required — what it does, what it needs, what it publishes
  actions/               Action definitions (the single source per Action)
  domain/                business logic. No Cloudflare types, no vendor names
  data/                  entity definitions and migrations
  api/                   handlers binding routes to Actions
  events/                publishers and consumers
  ui/                    components registered into extension locations
  tests/                 owned by qa-agent
```

`domain/` holds the business rules and must be testable without a network, without a
database, and without Cloudflare. If it cannot be, the boundary between `domain/` and
`data/` has been drawn in the wrong place.

---

## 4. The manifest is the source of truth

`manifest.json` is not documentation. The platform reads it to decide whether the App may
install, what it may reach, and what it exposes. The required sections, as enforced by
`app-manifest.schema.json`:

| Section | Decides |
|---|---|
| `id`, `version`, `publisher` | Identity and marketplace listing |
| `dependencies` | Which other Apps must be installed, at which versions |
| `permissions` | What the App may do — nothing undeclared is granted |
| `entities` | The data it owns |
| `actions` | Every operation, and therefore its API, SDK, and MCP surface |
| `eventsPublished`, `eventsConsumed` | Its place in the event graph |
| `capabilitiesRequired` | Payment, Messaging, AI — never a vendor |
| `apis` | Which Actions are internal, public, or both |
| `uiExtensions` | Where it appears in the product |
| `mcpTools` | What AI may discover and invoke |
| `externalNetworkAccess` | The egress allowlist |
| `storage` | Expected storage classes and volume |
| `quotas` | Limits it declares against |
| `lifecycle` | Behaviour on install, upgrade, disable, uninstall — including data disposition |

**A manifest declaration is a promise the platform enforces.** An App that calls something
it did not declare fails at the boundary; it does not "work anyway". That is deliberate:
undeclared behaviour is the mechanism by which a marketplace becomes untrustworthy.

---

## 5. Actions

Every operation is an Action, defined once (`API_STANDARD.md` §1). From it the platform
derives the internal API, the public API, the OpenAPI schema, the SDK method, the MCP
tool, and the documentation.

Each Action declares its required permission, its scope, its sensitivity class, its input
and output schemas, its error set, and whether it is idempotent.

**An Action at `scope: own` additionally declares `targetEntity`** — the entity, declared in
the same manifest, whose ownership relation `own` is evaluated against. That entity must
itself declare an `ownershipField`; an ownership relation on a different entity does not
count. Missing, unknown, malformed, or ambiguous `targetEntity` fails validation and the App
does not install. `AUTHORIZATION_STANDARD.md` §4 (VAL-OWN) and §4.1 state which half the
schema enforces and which half the registry-aware validator owes.

**An App exposes no operation that is not an Action.** A route handler containing logic
rather than dispatching to an Action is a defect — it is an operation with no permission,
no schema, no audit, and no AI surface.

---

## 6. Data

- An App declares its entities in the manifest and defines them in `data/`.
- It receives a **tenant-scoped storage handle** from the SDK. It never constructs one,
  never names a database, and never sees another tenant's data because it never has a
  handle that could reach it.
- Every entity carries tenant scope (`MULTITENANCY_STANDARD.md` §4).
- Migrations are forward-only, additive where possible, and always have a stated rollback
  path. A migration that cannot be rolled back is escalated before it is written.
- **Physical storage layout is not the App's business.** An App that assumes a shared
  table, a per-tenant database, or a particular engine has coupled itself to a decision
  that is explicitly still open (`MULTITENANCY_STANDARD.md` §7).

---

## 7. Events

Publish what happened, in the standard envelope, registered in `event-catalog.yaml`.
Consume what you need, idempotently. Publishers never know their consumers.
`EVENT_STANDARD.md` governs.

## 8. UI

Apps never modify Core UI. Core declares extension locations; Apps register components
into them. Locations are named in the manifest and validated at install:

`Dashboard.Widget` · `Customer.Profile.Tab` · `Navigation.Menu` · `Business.Settings` ·
`Search.Provider` · `ActivityTimeline.Item`

The location list is Core's to extend and is versioned with Core. An App requesting an
unknown location fails installation rather than silently rendering nowhere.

**UI hiding is presentation, never authorization.** A widget hidden from a user whose
permission check would have passed is a UX choice; a widget shown to a user whose
permission check would fail is a bug in the widget, not a security boundary — Core still
denies the underlying Action.

---

## 9. Lifecycle

Every App supports all seven states, and the platform will exercise them:

`Install → Activate → Configure → Upgrade → Disable → Rollback → Uninstall`

- **Install** — declare, validate, request permissions, create storage. No data yet.
- **Activate** — the App becomes reachable for the tenant.
- **Configure** — tenant settings, capability provider selection, credentials by
  reference.
- **Upgrade** — migrations run; the previous version's data remains readable until the
  migration commits.
- **Disable** — the App stops executing. **Data is retained.** Disable is not uninstall.
- **Rollback** — a defined return to the previous version. An upgrade without a rollback
  path is not shippable.
- **Uninstall** — the manifest declares the data disposition: `retain`, `export`,
  `archive`, or `delete`.

**Data must never disappear unexpectedly.** The tenant is told what will happen to their
data before the uninstall proceeds, and the declared disposition is what actually happens.
Silent deletion of a customer's business records is the single most damaging bug this
platform could ship.

---

## 10. Versioning

- Apps use semantic versioning.
- A change to a published API shape, an event payload, a permission requirement, or an
  entity's meaning is **breaking** and requires a major version.
- Adding an optional field, a new Action, a new event type, or a new UI extension is
  additive and requires a minor version.
- The manifest declares the minimum platform version it requires.

---

## 11. Definition of done for an App change

In addition to `TESTING_STANDARD.md` §8:

- [ ] `manifest.json` validates against `app-manifest.schema.json`.
- [ ] Every new Action declares permission, scope, sensitivity, schemas, and error set.
- [ ] Every new Action at `scope: own` declares `targetEntity`, and that entity declares an
      `ownershipField` naming one of its own fields (VAL-OWN, `AUTHORIZATION_STANDARD.md`
      §4). The referential half is unenforced until VALIDATOR-AZ7 runs — check it by hand
      and say that you did.
- [ ] Every new permission exists in `permission-catalog.yaml`.
- [ ] Every published and consumed event exists in `event-catalog.yaml`, with a version.
- [ ] No cross-App storage access anywhere in the change.
- [ ] No vendor name outside a Connector.
- [ ] Tenant scope on every query, cache key, file path, queue message, and job.
- [ ] Tenant-isolation test and permission test present and passing.
- [ ] Migration is forward-only with a stated rollback path.
- [ ] Uninstall data disposition declared and implemented.
- [ ] Audit events for every sensitive operation.
- [ ] Nothing in the change requires a platform capability an official App gets and a
      third party does not.

---

## 12. Open questions

| # | Question | Recommendation |
|---|---|---|
| AP1 | **App id format.** The plan never specifies one, but ids namespace permissions, events, and API paths, so the format is load-bearing. | Globally unique kebab-case slug, `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`, assigned at marketplace registration; publisher is a separate field. Encoded in the schema. |
| AP2 | **App runtime isolation.** How a third-party App executes without reaching Core is unrecorded — `0001` bound it to the stack decision, `0003` did not approve Workers for Platforms. | Blocked. No third-party App runs until that record exists. Official Apps in Phase 4 run in-platform under the same manifest enforcement. |
| AP3 | **Per-App storage units multiply by tenant count.** Not addressed by the plan. | `MULTITENANCY_STANDARD.md` §7 — a routing decision behind the storage port. |
