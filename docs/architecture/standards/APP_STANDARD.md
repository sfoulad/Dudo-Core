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

> ## ⚠ THE FIRST APP DOES NOT SATISFY THIS SENTENCE, AND THIS STANDARD IS NOT BEING EDITED TO AGREE
>
> Reported 2026-09-06, **CONTRADICTED**, for the Team Lead to disposition. `apps/customers/` is
> built, deployed and tested, and it took the privileged path this paragraph says does not exist —
> **because the SDK it was supposed to use does not exist** (`SDK_STANDARD.md` §0 row b).
>
> | This standard says | `apps/customers/` does |
> |---|---|
> | §2: *"Import Core internals → Use `packages/sdk/**` against a published contract"* | `app.ts:28–30` imports `AppPermissionEnvelope`, `Router` and `createRouter` from `../../platform/core/**` |
> | §3: `manifest.json` **required** in the App directory | No manifest in `apps/customers/`. It lives at `packages/contracts/apps/customers/manifest.json`, and `apps/customers/README.md:9–10` records the split deliberately: *"Already authored and ADR `0011`-compliant. Not re-authored here"* |
> | §3: `events/`, `ui/`, `tests/` directories | None of the three exists; the suites are in `packages/testing/suites/customer-directory/` (`TESTING_STANDARD.md` §9) |
> | §4: *"A manifest declaration is a promise the platform enforces"* | Nothing reads the manifest at runtime. The nine permissions are **transcribed by hand** into `app.ts`, which says so: *"TRANSCRIPTION IS A DRIFT SURFACE, DECLARED AS ONE… they can disagree"* |
>
> **Which side is wrong: this standard is right and the implementation is ahead of the platform it
> is supposed to sit on.** Every divergence above has the same cause — there is no App runtime, no
> SDK and no manifest loader — and each was recorded rather than concealed, which is the behaviour
> this paragraph is for. **The finding is not that the App misbehaved. It is that the SDK's gaps
> were discovered exactly as §1 predicted they would be, and were then worked around instead of
> being fixed**, because no SDK code may be written yet (`SDK_STANDARD.md` SD1).
>
> **What must not happen next is a second App copying the first.** At one App this is a documented
> exception with a named cause; at two it is the architecture, and `APP_STANDARD.md` becomes a
> description of something nobody does. The decision that closes it is CF1/AP2 — whether a
> first-party App is a separate Worker behind a Service Binding, which `0030` records as free.

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
  that is **decided but required to stay reversible** — `0006` chose one shared database,
  `0030` requires that choice to remain changeable by configuration rather than by rebuilding
  (`MULTITENANCY_STANDARD.md` §7). *(Corrected 2026-09-06: this bullet said the decision was
  "explicitly still open". `0006` is Accepted. The obligation on an App is unchanged and the
  reason for it is now stronger, not weaker.)*
- **An App's tenant migrations have no runner, and this is a live defect rather than a
  future concern.** Added 2026-09-06. `wrangler`'s `migrations_dir` is one directory per
  database and does not recurse, but a tenant database is written by Core **and by every
  installed App**. `apps/customers/data/migrations/0001_customer.sql` was therefore never
  applied by the runner, and the result was a deployed system that authenticated perfectly and
  answered **`503` on every Customer Directory read** — the table did not exist, so the storage
  boundary refused, correctly, and the failure presented as a dependency error rather than as a
  missing schema (`docs/operations/deployment-runbook.md` §3). The current remedy is a manual
  `wrangler d1 execute --file=…` per App migration. **It will recur for every App**, and it is
  the App-side half of `CLOUDFLARE_STANDARD.md` CF5, which is otherwise closed.

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
      §4). The referential half — that `targetEntity` resolves to an entity declared in the
      same manifest, and that the **resolved** entity declares the `ownershipField` — is
      checked by **VALIDATOR-AZ7, which exists and has been executed against the recorded
      fixtures**: `packages/contracts/validation/app-manifest-relations.mjs` (ADR `0009`),
      dependency-free. **Run it against your manifest and report the result.** It is **not
      wired into CI or any installation path**, so nothing runs it for you and a manifest
      can reach review unchecked. JSON Schema validates the **format** half only — it does
      not evaluate this clause, and no JSON Schema implementation is executed in this
      repository.
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

**Reconciled against the built system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would — those
are reported, never resolved by editing the standard to agree). The largest contradiction in this
document is not in this table: it is the §0 box above, on the first App's use of the SDK path.

| # | State | Question | Recommendation |
|---|---|---|---|
| AP1 | **CLOSED** | ~~**App id format.**~~ Decided and encoded, exactly as recommended. | `packages/contracts/registries/app-manifest.schema.json:325` defines `$defs/slug` as **`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`**, and line 329 applies it to the App id, with the permission, action, event and API-path grammars at lines 334–358 built on the same slug so the namespacing this row called load-bearing is one definition rather than five. **One caveat that belongs to `0009`, not to AP1:** *nothing in this repository executes JSON Schema*, so the pattern is enforced by review and by the dependency-free relation validator, not by a validator run. The **format** is settled; the **enforcement** is `TESTING_STANDARD.md` TS1's neighbourhood. |
| AP2 | **Split 2026-09-06 — the third-party half is OPEN, the first-party half is not blocked at all** | **App runtime isolation.** This row read *"Blocked. No third-party App runs until that record exists"*, which is right, and it was widely cited as though it blocked more than that. | **`0030` narrows it, and the narrowing is the point:** *"Workers is free. Workers for Platforms is a different product and is paid-only."* Workers for Platforms gates **only untrusted third-party code execution** — `0006` §4.13 had already recorded that it *"concerns executing untrusted code (Phase 7)"* and is independent of tenancy, and `0030` adds that it gates neither Apps as a concept nor the capability model. So: **(a) THIRD-PARTY — OPEN.** Root R1: no free mechanism exists for executing untrusted code, and Workers for Platforms is prohibited while `0008` is active. A user budget decision or a free alternative, either recorded. Its non-technical prerequisites (review process, trust tiers, distribution) are undecided anyway, so deferring forfeits nothing reachable. **(b) FIRST-PARTY — NOT BLOCKED, AND CURRENTLY UNUSED.** *"First-party Apps as separate Workers, deployed by Dudo, reached through service bindings with least-privilege bindings per App"* is free and is *"a real isolation boundary, not a pretend one"* (`0030`). Today `apps/customers` instead runs **in the Core Worker's process, importing Core directly**. **That is a choice nobody recorded**, and it is now the same decision as `CLOUDFLARE_STANDARD.md` CF1. Decide it **before a second App exists.** |
| AP3 | **OPEN** — deferred behind the storage port; blocks nothing today | **Per-App storage units multiply by tenant count.** | Unchanged in substance and now sharper: under `0006` Option A there is one shared database, so the multiplication has not started, and `0030` forbids the tempting answer — **"anything that assumes exactly one database exists" is a named violation.** The routing decision stays behind the Core-owned storage port (`MULTITENANCY_STANDARD.md` §7), which is what keeps it a configuration change rather than a schema change. Re-ask it when either a second App ships tenant tables or the 500 MB per-database ceiling is approached, whichever is first. |
