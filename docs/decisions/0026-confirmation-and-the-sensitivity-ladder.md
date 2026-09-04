# 0026 — The confirmation mechanism, and what stays at the top of the sensitivity ladder

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, on `architecture-agent`'s recommendation
- **Closes:** `ON-6` and `CR-1`
- **Owning agent:** Team Lead records. `core-agent` implements the mechanism.

## Context — two contracts are unreachable as written, and nobody asked for an exemption

`organization-onboarding-v1` and `credential-reset-v1` both declare their operations `critical`.
**`0007` D15 requires explicit confirmation for a critical action, and that mechanism does not
exist.**

So both routes are unreachable the moment they are built. The permission catalog already calls the
identical situation for `customers.customer.delete` *"the correct fail-closed state"* — which is why
`DeleteCustomer` has been owed since the Customer Directory shipped and is granted to no role.

**`architecture-agent` reported this rather than requesting an exemption.** That matters: the
cheapest path was a one-line sensitivity change presented as a technicality, and it was not taken.

## The two ways out, and why the answer is one of each

**Reclassify to `sensitive`.** Defensible on the text: §6's examples of critical are *"move money,
delete data irreversibly, rotate credentials"*, and **creating an empty Organization is none of
them.** The honest counter, which `architecture-agent` stated against its own recommendation: it
**does** create a credential, and **reclassifying a route to make it reachable is how a sensitivity
ladder becomes decoration.**

**Build the confirmation mechanism.** Owed regardless, and one slice unblocks three routes.

## Decision

**Both, split along the line that keeps the ladder meaningful.**

**1. `core.organization.create` is reclassified to `sensitive`**, in this record rather than by
edit. Onboarding creates an empty tenant. Nothing is destroyed, no money moves, and the credential
it creates is **the tenant's first** — there is no prior state to take over, which is precisely the
`0025` Decision 4 argument for why onboarding is establishment rather than delegation.

**2. `core.credential.reset` stays `critical`.** It replaces a credential that already exists, for a
principal who is already using it. **That is account takeover with a legitimate front door**, and it
is exactly what the top of the ladder is for.

**3. The confirmation mechanism is built as its own slice**, ahead of onboarding and reset, and it
unblocks `customers.customer.delete` at the same time.

**The principle, in `architecture-agent`'s words:** *"the ladder keeps its meaning only if something
stays at the top, and account takeover is that thing."* A ladder whose top rung is vacated whenever
it blocks something is a ladder with no top rung.

## The `422` defect, and why the fix is a new code rather than a detail

`the422Rule` in `organization-selection-v1` asserted that a 422 means "no Organization selected".
**`web-agent` proved that false while implementing against it**: `customer-directory-v1` uses
`failed_precondition` for its own state machine, and `errors.ts:137` builds it with **no arguments
and a constant message** — byte-identical on the wire. A client following the rule literally draws
an Organization picker at someone who archived an archived customer.

**The fix is a distinct `organization_not_selected` code at 422, emitted only by the pre-routing
resolver.** Not a detail token on `failed_precondition`: **those constructors are argument-free on
purpose**, and adding a parameter would weaken the device that stops a refusal from carrying data.

It discloses nothing — the caller learns a fact about **its own session** that the picker would tell
it anyway — and **an App structurally cannot emit it**, because it is produced before routing.

**`the422Rule` is struck rather than rewritten, because a client shipped against it.**
`web-agent`'s probe stays, with a named removal trigger. **QA asserts the removal, not the
workaround.**

## Consequence: the client flow inverts, and this reverses earlier guidance

`0021` struck server-side auto-selection. The contract's old guidance said calling the picker up
front *"looks tidier and is wrong"* — but that reasoning assumed some sessions arrive already
selected.

**With no auto-selection, no session is ever selected at login.** So waiting for a refusal
**guarantees one wasted failing request on every cold start, forever.**

**The picker is now the second call, not the fallback.** `web-agent` implemented the reactive flow
correctly against the contract as it then stood, and the contract has changed underneath it — this
is not a defect in what it built.

## Owed, and stated rather than left looking finished

`architecture-agent` records that **roughly twenty further auto-selection mentions survive** in
`freeTierImpact`, `qa` and `openQuestions` — all stale prose downstream of the struck block, not new
defects. **Flagged in the file header rather than allowed to look complete.** A sweep is owed.

## `ON-5` / `CR-5` — who runs the KDF when an operator creates a credential

**The last thing gating onboarding and reset**, and it collides with the property `0015` §D exists
to protect: **the password never reaches Dudo.** The client derives; the server stores a hash of the
derived value; `principal_credential` has no password column and must never gain one.

An operator creating another person's credential has no client of that person's to derive in.

**Decision: the operator's browser derives, exactly as `tools/seed-principal.ts` does today.**

1. The **console generates** a high-entropy password from a CSPRNG — 24 bytes, base64url, ~192
   bits — matching the seed tool. **Never operator-chosen**, for `0017`'s reason: entropy is what
   protects these accounts, not the rate limiter.
2. The console runs the **same client-side KDF** — 600,000 iterations, the same normalisation split
   — in the operator's browser. This is why `admin-shell`'s KDF being byte-identical to the web
   client's was verified before anything else.
3. **Only the derived value is sent.** The server hashes it again at 10,000 and stores that.
4. The password is **shown once** and stored nowhere.

**The property `0015` §D protects is preserved exactly: the server never sees a password.** What
changes is only *which* browser does the deriving.

### What this does not preserve, stated rather than buried

**The operator sees the new admin's password.** That is unavoidable for any operator-created
account, and it is the trust model the seed tool already has — but it has never been written down
as a property, and it should be.

**And there is no self-service password change.** So an operator-set password is permanent until an
operator resets it, and the person who received it cannot replace it with one only they know.
**That is a real gap**, it follows from `0015` §D's recorded cost (no email provider, no recovery
flow), and it means **every tenant admin's credential is known to whoever onboarded them, forever,
today.**

**Owed:** a change-password flow, which needs no email provider because it is authenticated — the
principal already holds a session. It is the smallest thing that would close this, and it should be
built before any non-operator user exists, alongside `0018`'s reserved allocation and `0021`'s
`OS-1`.

## What this does NOT decide

- **The confirmation mechanism's shape.** Its own contract, and it must satisfy D15 for three
  routes at once rather than one.
- **Anything about `DeleteCustomer` beyond unblocking it.** It remains granted to no role.
