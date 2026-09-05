# Super admin — test checklist

**Status: NOT YET TESTABLE.** Two approvals are outstanding (below). This document exists so that
testing can begin the moment they are given, rather than being written afterwards.

**Feature:** the platform-operator surface — Dudo's fourth request class, the super-admin console.
**Contracts:** `platform-operator-v1`, `confirmation-v1`, `template-v1`,
`organization-onboarding-v1`, `credential-reset-v1` — all `accepted`.
**Decisions:** `0024` (+ amendment), `0025` (+ amendment), `0026` (+ amendment), `0027`.

---

## What is blocking, and who can clear it

| # | Blocker | Who |
|---|---|---|
| 1 | **`wrangler deploy` is refused by a permission classifier.** Nothing new is live. Both Worker configs pass `--dry-run`, including the cross-Worker Durable Object binding, so this is permission and not configuration | **User** |
| 2 | **Migrations `0008`–`0010` are not applied to the staging control plane.** Applied and verified locally only | **User** |
| 3 | Open **HIGH** security finding — see "Known gaps" | `core-agent` |

**The deploys are ordered and the order matters.** A custom domain is claimed by exactly one Worker.
`admin.dudo.work` has been removed from `wrangler.jsonc`, so:

1. **Apply migrations `0008`–`0010` FIRST.** See below — this is not merely "before you test."
2. Deploy `dudo-core` — this **releases** `admin.dudo.work`
3. Deploy `dudo-admin` — this **claims** it

`admin.dudo.work` is briefly unrouted between 2 and 3. That is expected, not a fault.

### ⚠ Migrations before deploy, and the reason is not tidiness

**`findPrincipal` now reads `platform_operator` and `organization_membership` in the same statement**
— that is how the Action-side mutual-exclusion check costs no extra round trip. The consequence:

> **A control plane without `0008` fails that statement, and NOTHING AUTHENTICATES.**

Not the platform routes — **nothing**. Every login on `app.dudo.work` included. `qa-agent` found
this the hard way when five unrelated session-revocation cases went red against a fixture that
applied only five migrations.

**So deploying this Worker against an unmigrated control plane takes the whole product down, not
just the new surface.** Migrations first, then deploy.

---

## Before you can sign in: seeding the first operator

**There is no route that creates a platform operator, deliberately.** `platform-operator-v1`:

> *"A route that grants platform authority is the single most valuable target in the platform, it
> would be reachable by exactly one class of caller, and its only legitimate use is a handful of
> times in Dudo's life. **The frequency does not justify the surface.**"*

So the first operator is seeded out of band, in two steps, using tools that **print SQL and execute
nothing**:

1. **`seed-principal.ts --no-organization`** — creates a principal with a credential and **no
   membership row.** The flag is not optional here: the default writes an
   `organization_membership` row, and `0024` then forbids that principal from *ever* becoming an
   operator. `0010`'s triggers would refuse the grant, and the seed tool's own guard would write
   zero rows.
2. **`seed-platform-operator.ts`** — grants platform authority to that existing principal. Creates
   no principal and no credential, and handles no credential material at all.

**`0 rows written` from step 2 is a refusal, not a failure.** The tool guards its own INSERT, so an
ineligible principal is rejected in the application layer before the database triggers are reached.

---

## The checklist

### A — Sign in (`admin.dudo.work`)

- [ ] The sign-in screen renders and shows **progress during key derivation.** It runs 600,000
      PBKDF2 iterations in a Web Worker; ~70 ms on a development Mac, **3–8× slower on a phone.**
- [ ] Signing in with the seeded operator's credential **succeeds.**
- [ ] A wrong password is refused, and **takes the same time as a right one** — the credential
      verifier is deliberately equal-work.
- [ ] **The password is never sent.** Only a derived value leaves the browser (`0015` §D). Confirm
      in the network tab: no field contains the password you typed.

### B — The session is separate from the web app

- [ ] Being signed in at `app.dudo.work` does **not** sign you in at `admin.dudo.work`. The cookie
      is host-only and **this is a feature** (`0022`) — administrative access is authenticated
      separately, never inherited from a tab that happens to be open.

### C — Platform routes

- [ ] **`whoami`** returns the operator's identity and platform role.
- [ ] **Organizations list** renders. With no tenants onboarded it is **empty, and empty is
      correct** — not an error state.
- [ ] Calling `/auth/session/organizations` as an operator returns **`200 {data: []}`**, and the
      console **does not treat that as an error.** An operator holds zero memberships by
      construction.

### D — Isolation, which is the point of the whole design

- [ ] An operator **cannot reach any tenant's data** through the console. No customer, no business,
      no Organization contents. There is no screen for it because there is no route for it.
- [ ] The platform routes **404 on `app.dudo.work` and `api.dudo.work`** — they are bound to the
      admin host. **Verified in `workerd`**, including the case that makes it evidence: a caller
      holding a **valid operator session still gets 404 on the wrong host**, so the refusal is the
      host and not the credential.

### E — What is deliberately NOT built

These screens exist and say so rather than pretending. **Empty is honest here, not unfinished
work escaping notice.**

- [ ] **Templates** — `template-v1` accepted, not implemented
- [ ] **Onboarding an Organization** — `organization-onboarding-v1` accepted, not implemented
- [ ] **Credential reset** — `credential-reset-v1` accepted, not implemented
- [ ] **Audit log view** — the writer exists; the screen does not

---

## Known gaps, stated before you find them

**CLOSED — the Action half of "refused everywhere" is now enforced.** It was the review's blocking
HIGH finding: `platform-operator-v1` requires a principal appearing in **both** tables to be refused
on platform routes **and** on Actions, and only the platform half was implemented.

**Fixed at zero cost.** Both facts ride the `findPrincipal` statement that already runs on every
authenticated request, as correlated `EXISTS` subqueries — statement count unchanged. The check sits
where the resolution algorithm is read, so it covers `resolve`, the Organization picker,
`selectOrganization` and `resolvePrincipalId` at once.

**And the refusal code is per request class**, which took two attempts to get right: `unauthenticated`
on the Action path, `forbidden` on a platform route. **Neither code is globally safer** — `forbidden`
hides among permission denials, `unauthenticated` among credential failures — so *"identical to an
unknown principal"* resolves differently per class. Rendering one code everywhere produced a status-code
oracle, twice, once in each direction. QA caught both because it keeps *"it is refused"* and *"it is
refused with the code the contract names"* as **separate cases**.

**RESOLVED — the host binding works, and the Team Lead's contrary measurement was invalid.** A
`wrangler dev --local` run reported 401 on every host including `evil.example.com`. The cause:
**a `custom_domain` route makes `wrangler dev` overwrite the caller's `Host` header before the
Worker runs**, so all five probes arrived as `admin.dudo.work` and 401 was the correct answer to
every one of them. **Five rows, one request.**

**Do not test anything host-dependent through `wrangler dev` with a `custom_domain` route
configured** — it silently rewrites the input you are varying, so a host guard can appear to pass,
appear to fail, or appear absent regardless of whether it works.

**HIGH — a write-side guard with no callers.** `assertNotAPlatformOperator` and
`assertNotAnOrganizationMember` are exported and tested but **called by nothing**, because no Core
code writes either table yet. `0025` requires the code check first with triggers behind it; **today
that ordering is inverted.** The hazard is scheduled rather than hypothetical: when membership
administration or onboarding lands, **omitting the call is silent.**

**And the case that makes the HIGH finding matter:** a **restore from two backups taken at different
moments** produces the both-tables state without any write. A restore does not re-run triggers, and
`0010` deliberately does not validate rows that already exist. In that state platform routes deny
and **Actions do not** — so the Action check is not a second layer there, **it is the only one.**

**Not built, and must not be reported as done** (`core-agent`'s own list, before anyone calls this
slice finished):

- **Rate limiting is not built.** `0017`'s in-process limiter does not bound a deployed Worker,
  because each isolate has its own. Two consumers now depend on it — pre-auth and `0027`'s
  challenge routes.
- **The operator action log has no retention and no read surface.** Core is writing records that
  **nothing can read**, and nothing deletes.
- **Creating a platform operator is the one privileged change in Dudo with no audit trail at all.**
  It happens out of band, by SQL, by design — and therefore leaves no record anywhere in the
  system. Everything an operator *does* is logged; **becoming one is not.**
- **`0027`'s `CF-5` will share the per-principal ceiling** at 4 row-writes per challenge — about
  **150 challenges per operator per UTC day**, from the same 600 the console already spends from.

**Two type-level guarantees have no regression cover.** The membership receipt and
`ControlPlaneWriteReservation` are both enforced by the type system, and **no suite can see them** —
Node strips types without checking them. Relaxing a parameter to optional, or exporting a private
mint, leaves **typecheck green and every suite green** while the guarantee is gone. A type-negative
harness is being built; until it lands, **those two protections rest on nobody editing a signature.**

**Accepted costs, recorded rather than discovered:**

- **An operator who creates a credential sees the password.** Unavoidable for operator-created
  accounts, and it is the trust model the seed tool has always had.
- **There is no self-service password change.** So an operator-set password is permanent until an
  operator resets it — **every tenant admin's credential is known to whoever onboarded them.** A
  change-password flow is owed and needs no email provider.
- **Onboarding requires no confirmation**, deliberately. `0026` classifies it `sensitive`, not
  `critical`: it creates an empty tenant and destroys nothing. **Credential reset keeps its
  confirmation**, because it takes over an account someone is already using.

---

## Not claimed

No RTL pass, no screen-reader pass, no automated accessibility run. Sign-in has **never been
exercised against a live Core**, because there is no fixture mode — `0010` rejects fake APIs and
that reasoning applies hardest to an authentication screen.

**Nothing here has been deployed. No step of this checklist has been performed by anyone.**
