# Studio Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **Studio is not built in Phase 0**; this standard exists so that when it is built it cannot become a second platform.
- **Authored by:** `architecture-agent`.
- **Applies to:** BusinessOS Studio — every surface through which an App is created inside Dudo rather than in a developer's editor.
- **Depends on:** `CONSTITUTION.md` Rules 1, 7, 8, 9, 12; `APP_STANDARD.md`; `AUTHORIZATION_STANDARD.md`; `SECURITY_STANDARD.md`; `MCP_STANDARD.md`; `AI_STANDARD.md`.
- **Machine-readable:** `packages/contracts/registries/app-manifest.schema.json` — Studio emits nothing that is not this.
- **Source:** master build plan §18 (p18–19), §19, §20, §12, and Phase 9 (p34).

---

## 1. What Studio is, and the one rule that governs it

The master plan, §18, in full:

> Later phases introduce Studio. Studio creates BusinessOS applications. Creators can be:
> Developers · Business users · **AI Agents**. Studio provides: Create Entity · Create Form ·
> Create Page · Create Workflow · Create Dashboard · Create Permission · Create Action ·
> Create API · Create Event · Create MCP Tool · Publish App.

**Studio is an authoring surface, not a runtime and not a platform.**

> **Studio emits exactly the artifacts an App declares, and nothing else.** Its output is an
> App manifest and the App artifacts that manifest points at — the same manifest that
> validates against `app-manifest.schema.json`, installs through the same lifecycle, is
> authorized by the same Core, and is subject to the same marketplace review as an App
> written by hand in a text editor.

Everything else in this document follows from that sentence. If Studio can produce something
a hand-written App cannot, or reach something a hand-written App cannot, Studio has become a
privileged path — and a privileged path is the thing every rule in `SECURITY_STANDARD.md` §1
exists to prevent.

**The negative form, which is the checkable one:** there is no Studio-only Action, no
Studio-only permission, no Studio-only manifest field, no Studio-only installation path, and
no Core table Studio writes that an App's own lifecycle does not write.

---

## 2. Creators, including the one that is a model

Three creator types, and the third is why this standard is stricter than a UI builder's
would be:

| Creator | Principal type | Notes |
|---|---|---|
| **Developer** | `user` | Uses Studio by preference, not by necessity; the SDK path remains fully available (`SDK_STANDARD.md` §1) |
| **Business user** | `user` | The reason Studio exists. Has no concept of a manifest and must not need one |
| **AI agent** | `ai-agent` | A principal, not an exception (`CONSTITUTION.md` Rule 7) |

**An AI agent creating an App does so through the same authorized Actions a human uses**
(`CONSTITUTION.md` Rule 8). Specifically:

- Every Studio operation in §3 is a declared **Action** with a declared permission, a
  declared scope, and a declared sensitivity — not a special internal call.
- An AI creator's effective permission is the **intersection** of its own grants and the
  grants of the human it acts for, never the union (`AUTHORIZATION_STANDARD.md` §2).
- **AI never writes to Core storage.** An AI that can author an App through a database
  handle has, by construction, every permission at once (`CONSTITUTION.md` Rule 7).
- An AI-authored App receives no more trust than a human-authored one. Phase 9's
  "BusinessOS builds the application" is a generation step whose *output* enters the same
  validation, security review, and moderator review as any other submission (§6).

---

## 3. The eleven operations, and what each one actually produces

Each Studio operation produces a declared artifact governed by an existing standard. Studio
introduces no new artifact type.

| Studio operation | Produces | Governed by | Constraint that is easy to get wrong |
|---|---|---|---|
| Create Entity | `entities[]` in the manifest | `APP_STANDARD.md` | Tenant-scoped by construction; `ownershipField` required if any Action on it uses `own` scope |
| Create Form | A UI artifact bound to an entity and an Action | `APP_STANDARD.md` §8 | A form is a client of an Action. It is never a second write path |
| Create Page | A UI artifact | `APP_STANDARD.md` §8 | Renders and collects. No business rule lives in it |
| Create Dashboard | A UI artifact reading declared Actions | `APP_STANDARD.md` §8 | Aggregates within one tenant only (`MULTITENANCY_STANDARD.md` §5) |
| Create Workflow | A workflow definition | `CLOUDFLARE_STANDARD.md` §6 | Every step idempotent; **no step widens the tenant scope** |
| Create Permission | A permission in the **App's own namespace** | `AUTHORIZATION_STANDARD.md` §3 | See §4.2 — this is the most dangerous of the eleven |
| Create Action | `actions[]` in the manifest | `API_STANDARD.md` §1 | One permission, one scope, one sensitivity, declared input and output schemas |
| Create API | `apis[]` — an exposure of an existing Action | `API_STANDARD.md` | **Exposure is opt-in.** It exposes an Action; it never creates a second implementation |
| Create Event | `eventsPublished[]` + a registry entry | `EVENT_STANDARD.md` | **Apps may not invent duplicate event concepts** (plan §11). Registration is a reviewed act, not a form field |
| Create MCP Tool | `mcpTools[]` — an exposure of an existing Action | `MCP_STANDARD.md` | The Action's `exposure` must include `mcp`. A tool is never a code path of its own |
| Publish App | A marketplace submission | `APP_STANDARD.md` §9, plan §19 | Enters the full lifecycle in §6. Publishing is not deploying |

**Read the right-hand column as the specification.** Studio's job is to make these
constraints unavoidable for a user who has never read a standard — which is a stronger
requirement than making them documented.

---

## 4. Boundaries

### 4.1 Studio is not Core

Studio is a **platform application**, not a Core primitive. It passes none of
`CORE_BOUNDARIES.md` §2's four questions on its own behalf: an App-authoring tool is not
something every tenant, every App, and every future business type requires. Core owns the
App registry, the manifest schema, installation, and the permission model; **Studio is a
consumer of all four.**

The practical rule: **anything Studio needs from Core is requested through a published
contract that a hand-written App could also use.** If Studio needs a Core capability nobody
else can have, that is a design defect in Studio, reported to the Team Lead — not a new
Core service.

### 4.2 What Studio may never create

- **A permission outside the App's own namespace.** Never `core.*`, never another App's
  namespace. `AUTHORIZATION_STANDARD.md` §3.1.
- **A permission at `platform` scope**, or a role containing one. A tenant principal holds
  no platform-scope permission, and delegation cannot manufacture authority
  (`AUTHORIZATION_STANDARD.md` §8; drafted as `0007` D11/D16).
- **A grant to itself.** A creator can only put into an App what the creator itself holds,
  at or below its own scope. Creating a permission is not the same as holding it; granting
  it at install is a separate authorized act by a separate principal.
- **A cross-App data access path.** No entity relation, query, workflow step, or report may
  reach another App's storage (`CONSTITUTION.md` Rule 3). This is the boundary a visual
  builder is most likely to erode, because a join is the obvious thing to offer.
- **A duplicate event concept.** `OrderCreated` exists once. A near-synonym is an
  architecture review item, not an autocomplete suggestion (`EVENT_STANDARD.md` §8).
- **A secret.** No secret value is authored, stored, displayed, or defaulted in Studio.
  Studio authors a secret **reference by name**; the value lives in the approved secret store
  (`SECURITY_STANDARD.md` §5, `CONNECTOR_STANDARD.md` §5). **This is blocked on CN1** — no
  tenant-scoped secret store exists — so the Studio secret surface cannot be built before
  CN1 is answered.
- **Any artifact the manifest schema rejects.** Studio pre-validates for a good error
  message; the schema and the registry-aware validator decide (§7).

### 4.3 Generated and customer-authored code

Where a Studio App contains executable code — customer-written or AI-generated —
`CONSTITUTION.md` and master plan §12 are unconditional: **it never executes inside the Core
runtime.** The plan's answer is Cloudflare Workers for Platforms.

> **Workers for Platforms is not approved** (`0003`; `CONSTITUTION.md` Rule 12). Until it or
> an alternative isolation mechanism has an accepted decision record, **Studio cannot ship a
> surface that produces executable code.** This standard does not name a mechanism, does not
> assume one, and stops here (`APP_STANDARD.md` AP2).

A Studio limited to **declarative** artifacts — entities, forms, pages, dashboards,
workflows composed of declared Actions — does not hit this blocker and is the part that can
be built first. That split is a recommendation to whoever plans Phase 9, not a decision.

---

## 5. Security requirements

1. **Every Studio operation is an authorized Action**, decided in Core, on every call
   (`AUTHORIZATION_STANDARD.md` §5). Studio's UI hiding is presentation, never security.
2. **Authoring is tenant-scoped.** A draft App, its entities, its forms, and its versions
   are tenant data, visible only inside the authoring tenant, and carry tenant context
   through all eleven carriers (`MULTITENANCY_STANDARD.md` §4).
3. **Creating an App is `sensitive`; publishing one is `sensitive`; creating a permission
   is `sensitive`.** All are audited with the fields in `AUTHORIZATION_STANDARD.md` §11.
4. **A private App is still an untrusted App.** `SECURITY_STANDARD.md` §1 threat 2 —
   "assume every marketplace App is untrusted, including our own" — applies to an App a
   customer built for itself. It gets declared permissions, granted narrowly, enforced by
   Core on every call.
5. **Studio holds no elevated identity.** It never acts as the platform, never selects a
   tenant on a caller's behalf, and never carries a service identity that exceeds the
   creating principal.
6. **Untrusted input everywhere.** Entity names, field names, labels, and descriptions are
   authored by users and by models. They are validated at the boundary, escaped at render,
   and never interpolated into a query, a path, an identifier, or a log line unescaped
   (`SECURITY_STANDARD.md` §4).
7. **Prompt injection is in scope for the AI creator path.** Content a model reads while
   authoring — an uploaded document, an existing record, a business description — is
   untrusted input that may attempt to induce a broader permission request or an
   unauthorized action. `AI_STANDARD.md` governs; the mitigation is that the model's output
   is a *proposal* that a human principal authorizes, never a direct effect.
8. **No Studio-authored artifact bypasses the marketplace lifecycle** in §6, including a
   private App published only to its own tenant — the review depth may differ; the path may
   not.

---

## 6. Versioning and lifecycle

**Studio artifacts are App versions. They are not a separate versioning system.**

- Every Studio edit produces a **draft version** of the App manifest. The installed version
  is unaffected until an explicit publish.
- Version identity, compatibility, and the additive-versus-breaking distinction are
  `APP_STANDARD.md` §10 and `API_STANDARD.md` §6. A Studio edit that removes a field,
  narrows a type, or changes an Action's contract is a **breaking** change and requires a
  new version exactly as a hand-written one would.
- Publishing follows the plan §19 lifecycle without shortcut:

  ```
  Draft → Automated Validation → Security Review → Moderator Review → Approved → Published
  ```

- **Automated validation is the schema plus the registry-aware validator (§7).** Security
  review and moderator review are human steps; a Studio App does not skip them because a
  form produced it, and an AI-generated App does not skip them because a model produced it.
- Uninstall and data disposition are `APP_STANDARD.md`'s, unchanged: retain, export,
  archive, or delete, declared in the manifest. **Data must never disappear unexpectedly**
  (plan §20).
- Rollback to a previous published version is required, as for any App.

---

## 7. Validation rules

Studio output is validated by the same two mechanisms as any manifest, in this order:

1. **`app-manifest.schema.json`** — structural validity.
2. **The registry-aware validator** — the cross-checks a JSON Schema cannot perform:
   permissions exist in the catalog, event types exist in the event catalog, UI extension
   locations exist in the Core object registry, referenced Action ids are defined in this
   manifest, exposure is consistent with each Action's declared `exposure`.

Studio-specific rules, named so they can be tested:

| Rule | Statement |
|---|---|
| **VAL-STU-1** | Studio emits no manifest field, artifact, or value that a hand-authored App could not emit. Any divergence is a defect in Studio |
| **VAL-STU-2** | Every permission Studio creates is in the App's own namespace and at a scope the creating principal holds |
| **VAL-STU-3** | Every `apis[]` and `mcpTools[]` entry Studio creates references an Action defined in the same manifest whose `exposure` permits that surface |
| **VAL-STU-4** | Every event Studio creates is registered, versioned, and checked against existing concepts before it is accepted |
| **VAL-STU-5** | No Studio artifact references another App's entities, storage, or internal Actions |
| **VAL-STU-6** | Studio's own pre-validation is **advisory**. Core re-validates on submission and on install, and Core's answer is the one that counts |

VAL-STU-6 is the same rule as `SDK_STANDARD.md`'s advisory-check rule and
`AUTHORIZATION_STANDARD.md` §5's rule about the SDK: a client-side check exists to produce a
good error, never to be trusted.

---

## 8. Ownership and files

**Studio has no assigned path.** `0004` (Accepted) defines the repository layout and does
not name Studio; `platform/` domain services belong to `core-agent` and
`platform/capabilities/**` to `plugin-agent`, and Studio is neither.

- **Recommended:** `platform/studio/**` as a platform application, with an owner assigned by
  the Team Lead. **This requires an amendment to `0004` and is not decided here.**
- Until that amendment exists, **no Studio code has a home and none may be written.**
  Recorded as ST1 in §10 rather than resolved by an agent's assumption.
- What is not in doubt: Studio does **not** own `packages/contracts/**` (that is
  `architecture-agent`), does not own the manifest schema, and does not own Core.

---

## 9. Verification checklist

- [ ] Every Studio operation is a declared Action with one permission, one scope, one
      sensitivity — no internal-only call.
- [ ] Studio emits only artifacts declared by `app-manifest.schema.json`; no Studio-only
      field exists.
- [ ] No permission created outside the App's own namespace; none at `platform` scope.
- [ ] No artifact reaches another App's storage, entities, or internal Actions.
- [ ] Every created event is registered, versioned, and checked for a duplicate concept.
- [ ] Draft, publish, install, upgrade, rollback, and uninstall all follow
      `APP_STANDARD.md`; the §6 lifecycle is not shortened for Studio or for AI output.
- [ ] AI creator path: effective permission is the intersection with the human principal's;
      no direct storage access; output is a proposal a principal authorizes.
- [ ] All authored content treated as untrusted input; no secret value authored or displayed.
- [ ] Authoring is tenant-scoped across all eleven carriers; drafts are tenant data.
- [ ] Create, publish, and permission-creation audited.
- [ ] Studio's own validation is advisory; Core re-validates.
- [ ] Tenant-isolation test present for the authoring surfaces
      (`MULTITENANCY_STANDARD.md` §8).

---

## 10. Open questions

| # | Question | Status |
|---|---|---|
| ST1 | **Studio has no path and no owning agent.** `0004` does not name it. | Needs a Team Lead decision amending `0004` before any Studio work. Recommendation: `platform/studio/**` as a platform application. **No code until then.** |
| ST2 | **Executable Studio output has no isolation mechanism.** Plan §12 requires Workers for Platforms; it is not approved (`0003`). | Hard blocker on any code-generating surface. A declarative-only Studio is unblocked. Same root as `APP_STANDARD.md` AP2. |
| ST3 | **Can a business user meaningfully consent to a permission set they authored?** Studio makes the creator and the grantor the same person, which removes the review a marketplace install provides. | Unresolved. Related to AZ4 (consent grouping). Needs a product decision before Studio ships permission creation. |
| ST4 | **Who reviews an AI-generated App, and against what?** §6 requires security and moderator review; the plan does not say whether AI-generated submissions get a different depth. | Recommendation: same path, and volume is handled by better automated validation rather than by lighter review. Team Lead decision. |
| ST5 | **The Studio secret surface is blocked on CN1** — no tenant-scoped secret store exists. | Cannot be built before CN1. Recorded, not worked around. |
