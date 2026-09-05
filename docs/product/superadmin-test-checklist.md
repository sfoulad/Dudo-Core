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

1. Deploy `dudo-core` — this **releases** `admin.dudo.work`
2. Deploy `dudo-admin` — this **claims** it

`admin.dudo.work` is briefly unrouted in between. That is expected, not a fault.

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
      admin host. *(See "Known gaps" — this is currently disputed between two measurements.)*

### E — What is deliberately NOT built

These screens exist and say so rather than pretending. **Empty is honest here, not unfinished
work escaping notice.**

- [ ] **Templates** — `template-v1` accepted, not implemented
- [ ] **Onboarding an Organization** — `organization-onboarding-v1` accepted, not implemented
- [ ] **Credential reset** — `credential-reset-v1` accepted, not implemented
- [ ] **Audit log view** — the writer exists; the screen does not

---

## Known gaps, stated before you find them

**HIGH — the Action half of "refused everywhere" is not enforced.** `platform-operator-v1` says a
principal appearing in **both** `platform_operator` and `organization_membership` is refused on
platform routes **and** on Actions. The platform half is enforced; **the Action half is not.**

**This is not cross-tenant access** — such a principal receives exactly the grants its own
membership carries, scoped to that one Organization — and reaching the state requires direct
database access, because `0010`'s four triggers refuse it in both directions on INSERT and UPDATE
(**verified against a real D1, all four, with negative controls passing**). It is owed because **a
normative rule in an accepted contract that the code does not implement is a defect regardless of
reachability.**

**DISPUTED — the host binding.** `core-agent`'s harness reports 404 on non-admin hosts. The Team
Lead's `wrangler dev` run reports **401 on every host including `evil.example.com`**, where 404 is
specified. One of the two measurements is wrong; `qa-agent`'s `host-binding.ts` is a third
measurement. **Authorization is unaffected either way** — this is about *which refusal* is returned,
and therefore about whether an unauthenticated caller can learn the route exists.

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
