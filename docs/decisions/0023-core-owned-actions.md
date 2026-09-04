# 0023 — Core-owned Actions, a Core permission envelope, and the role-vocabulary split

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Amends:** `0019` (adds a permission to both roles) · extends `0021`'s route-class reasoning
- **Owning agent:** Team Lead records. Implemented by `core-agent`.

## Context — the routes are unbuilt, not unmounted

`qa-agent` found `GET /api/v1/businesses` and `POST /api/v1/businesses/names` returning **404** on
the live deployment while App routes served normally. The Team Lead diagnosed it as the
App-never-mounted defect repeating.

**That was wrong, and the correction matters.** `core-agent` established that **no implementation of
either operation exists anywhere in the repository.** Every `ActionDefinition` in the tree is one of
the eight Customer Directory Actions. `platform/core/**` holds the Action *machinery* —
`action.ts`, `pipeline.ts`, `router.ts` — and **zero Action definitions.** The only files naming
these operations are the contract, the web client, and a verification script.

**The last defect was built-and-not-wired. This is not built.** "Mount it" was minutes; this is work.
The web client has been calling a route that never existed.

## Three blockers, and the third is systemic

### 1. `handleRequest` serves exactly one router, at one `basePath`, under one envelope

`/api/v1/businesses` does not start with `/api/v1/apps/customers`, so it fails the basePath test —
exactly the 404 measured. Putting Core's routes inside `createCustomersRouter` would not help; the
basePath is still the App's.

**Decision: a Core route block in `api.ts` ahead of the App router.** It is the shape pre-auth and
session routes already use, it is the smaller of the two options `core-agent` identified, and it
keeps `handleRequest`'s one-router contract intact rather than generalising it speculatively.

### 2. An Action requires an `AppPermissionEnvelope`, and Core has no App

`authorize()` resolves a permission against `app.declared` — the App's declaration is the ceiling.
A Core Action has no App to declare it.

**Rejected: making the Customer Directory declare `core.business.read`.** It works mechanically and
is wrong. **The Customer Directory's manifest would gate a Core capability**, and a second App would
have to declare it too — so a platform capability would be reachable only through whichever App
happened to remember it.

**Decision: Core declares its own envelope.** Structurally identical to an App's, owned by Core,
passed by the Core route block. `authorize()` needs no change, because the envelope is already a
parameter — which is the same property that let `0021`'s session routes exist without touching the
pipeline, and the same property that let `worker.ts` mount an App without Core importing one.

**This is `0021`'s shape one layer up**, and `core-agent` identified it as such before building
anything.

### 3. Two role vocabularies exist, and this is the third deadlock they have caused

`authorization/roles.ts` maps `owner` and `member` to the seven Customer Directory permissions and
**nothing else**. The permission catalog describes seed roles that do not exist in code —
`business-owner`, `business-admin`, `member`, `developer`, `platform-admin`,
`marketplace-moderator` — and its `member` holds `core.business.read` at business scope, while
`0019`'s `member` is read-only over customers.

**So a built, mounted Core Action would be `forbidden` for every principal on the platform.**

`core-agent` named the pattern rather than the instance, and it is right: **`roles.ts` is a closed
two-role table that knows about exactly one App, and every new capability will collide with it.**
`0019` hit this, `0021` hit it, this is the third.

**Decision, in two parts:**

**Now — a minimal amendment.** Add `core.business.read` to both `owner` and `member` in `roles.ts`.
It is a read, `maxRowWrites: 0`, already registered in the permission catalog, and both roles
legitimately need it: **a principal who cannot list its own Businesses cannot use the product.**

**Owed — the reconciliation, and it is real debt.** The catalog and the code describe different
role sets. Until they agree, every capability added outside the Customer Directory repeats this
deadlock, and the minimal amendment above is the third patch over the same crack. **This must be
decided before a second App exists**, because a second App is the point at which "add it to both
roles" stops being a small change and starts being a fork.

## Consequences

- Core gains its first Action definitions, and `platform/core/**` stops being machinery-only.
- **`0019`'s two roles both gain one permission.** That is a privilege change, and `0007` rule 9
  requires it to be auditable — but there is still no audited path for role changes, which
  `0018`, `0019` and `0020` all record as owed.
- The clients stop 404ing on the authorized-business state. **Both were built against a contract
  whose server side did not exist**, which no amount of client-side testing could have revealed.
- **Free-tier impact: USD 0 / BD 0.** Both operations are reads, `maxRowWrites: 0`.

## What this does NOT decide

- **The role-vocabulary reconciliation.** Recorded as owed, above, with its trigger.
- **Whether Core's envelope generalises to other Core capabilities.** Two operations justify it;
  a third gets its own argument, exactly as `0021` required of its route class.
- **Organization and Business names**, still absent from the control plane, still the
  organization-structure slice.
