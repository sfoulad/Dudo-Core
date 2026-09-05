# 0027 — The confirmation mechanism, and the locale that nearly cost us the property

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Accepts:** `confirmation-v1`
- **Closes:** `0007` D15's mechanism gap · `CF-4`
- **Unblocks:** `core.credential.reset`, `customers.customer.delete`, and every future critical action
- **Owning agent:** Team Lead records. `architecture-agent` authored. `core-agent` implements.

## Context

`0007` D15 requires explicit confirmation for a critical action and **the mechanism has never
existed**, so `DeleteCustomer` has been granted to no role since the Customer Directory shipped and
`credential-reset-v1` was unreachable the moment it was written. `0026` made building it a slice of
its own. This record accepts the result.

## What the contract got right, recorded because the reasoning generalises

**Confirmation must prove two independent things, and conflating them is the standard error.**

> *"(a) INTENT — the human meant to do THIS thing, to THIS target, having been shown what would
> happen. (b) PRESENCE — the party acting is still the credential holder… A 'type DELETE to
> continue' box proves (a) AND NOT (b). A re-authentication prompt proves (b) AND NOT (a). **MOST
> PRODUCTS SHIP ONE AND DESCRIBE IT AS BOTH.**"*

The mechanism is therefore **two halves**: a **server-authored statement** bound to a server-issued
token the client must echo (intent), and a **re-authentication** using the existing login KDF
(presence).

**Re-authentication rather than MFA, for a reason that is about honesty rather than ambition.**
`MfaFactor` is a registry entry at `proposed` with no table, no enrolment path and no code.
*"Specifying MFA here would specify a mechanism nobody can build, which is how a control becomes a
comment."* Re-authentication needs **nothing new in the credential layer** — the client derives
exactly as it does at login and `credential-verifier.ts` checks it with its existing equal-work
property.

**The ceiling is stated rather than left to be overstated later:** re-authentication is **exactly
as strong as the password and no stronger**. It raises the bar from *holds a session cookie* to
*holds the password* — the difference between an unattended laptop and a full compromise — but it
**is not two-factor and must never be described as such** in a release note or a UI.

**D15's AI clause, generalised — and the generalisation is the better rule.** D15 says a model
asserting the user agreed is not a confirmation, because *"the model is the party being constrained,
and letting it certify its own constraint removes the constraint."* The contract observes this was
never about AI:

> **"THE PARTY BEING CONSTRAINED DOES NOT AUTHOR THE STATEMENT OF THE CONSTRAINT."**

A buggy web client could display *"archive this customer"* and submit a permanent deletion, and the
user's confirmation would be real, informed, and about the wrong operation.

**And its own limit is admitted:** Core cannot verify the client *displayed* what it was given
(`CF-2`). Uncloseable from the server, exactly as the NFC password rule is — a published client
obligation asserted by QA against both clients, **recorded rather than engineered around.**

**No fifth request class.** A class is defined by what context its handlers receive; confirmation
changes none of it. Confirming a `DeleteCustomer` needs a tenant, confirming a `credential.reset`
needs the absence of one — *"a class containing both would be a class with no consistent context."*
`0021` and `0025` both answered *class*; this one correctly does not.

**The storage table cannot answer what anyone confirmed.** `binding_hash · principal_id ·
expires_at · spent_at` — no action, no target, no parameters, no statement text. It records **that**
a confirmation happened, never **what**.

**The Durable Object was considered and rejected on the free-tier rule**, not on taste: the DO
allowance is a shared 100,000/day budget whose apportionment is still open, and *"adding a second
consumer to an unapportioned budget is the kind of quiet commitment §6a exists to prevent."*

## Decision on `CF-4` — the localisation problem, and why the contract's own fix was the wrong one

**The problem is real and correctly ranked as the contract's largest.** The statement is
server-authored plain text, Dudo has no localisation mechanism, and **Dudo's market is Bahrain**. An
Arabic-speaking user receives an English statement of an irreversible action — and *"states exactly
what will happen"* **is not satisfied by text the human cannot read.** This is not cosmetic. A
confirmation nobody can read proves nothing, which means the intent half is simply absent for those
users.

**The contract's proposed fix trades the property away.** It proposes a stable token plus structured
parameters *"letting the client render an approved translation"* — and then honestly notes this
**reopens `CF-2`, because the client is authoring text again.** Having just established that the
constrained party must not author the constraint, adopting this would undo it for every non-English
user.

**Ruling: the dilemma is false, because it moves the wrong thing to the client.**

**Localisation requires the client to choose a language. It does not require the client to render
the text.**

1. **The challenge request carries a `locale`.** The client states which language its user reads.
2. **Core owns the statement catalog and renders the statement itself**, in that locale, from its
   own translations.
3. **The client displays the returned string verbatim, exactly as before.**

**Choosing a locale is not authoring.** The statement stays server-authored in the only sense that
matters — **Core composed every word of it** — and `CF-2` is left exactly as it was rather than
widened. The client's power grows by one enumerated value, not by a text field.

**Consequences, stated rather than discovered:**

- **Core must hold translations.** An ordinary cost that any product serving Bahrain pays, and
  paying it here rather than in each client means one catalog to review rather than two to keep in
  step.
- **An unknown or unsupported locale falls back to English and the statement says so**, rather than
  silently rendering a language the caller did not ask for.
- **The locale is deliberately NOT part of the binding.** It changes nothing about what will happen,
  and binding it would refuse a confirmation because a user changed language mid-flow.
- **This does not make Dudo localised.** It localises **one** surface — the one where being
  unreadable is a safety property rather than an inconvenience. General localisation stays an open
  problem with its own decision to come.

## The hazard the contract named, and the owed item it just made load-bearing

**`CF-5`: both challenge routes are writes reachable by any principal holding a critical
permission**, at 2 row-writes each against a shared control-plane ceiling. The contract names it as
*"`0013`'s shape again — the control becoming the lever — and it is named rather than discovered."*

**`0017`'s in-process limiter does not bound this in a deployed Worker**, because each isolate has
its own. The **durable rate limiter was already owed for pre-auth; it now has a second consumer and
stops being a single-feature nicety.** Recorded so that the next person to look at it sees two
callers rather than one.

**The volume argument that makes this affordable is structural rather than lucky:** a critical
operation requires a human to read a statement and type a password, so **volume is bounded by human
attention, not by traffic.** `0013` Control 5's test — *is the population that can force a write
bounded by something other than the attacker?* — passes.

## The test that decides whether any of this is real

> **"REMOVE THE CONFIRMATION CHECK FROM THE PIPELINE AND EVERY CRITICAL-OPERATION TEST MUST GO RED.
> If removing the check turns only some tests red, coverage is incomplete and the suite is what is
> wrong, not the finding."**

The same negative control `whereWithTenant` is held to. **`qa-agent` owes this before the mechanism
is integrated**, and it is the single check this record most wants performed.

## Free-tier impact

**USD 0 / BD 0.** One control-plane table, four short columns, rows live five minutes, no new
service and no new binding. A critical operation costs about **4 additional control-plane
row-writes**; against the 3,000/day sub-ceiling that is roughly **750 confirmations a day
platform-wide.**

## What this does NOT decide

- **MFA.** `CF-1` stands. The mechanism is shaped so a factor is one more check at step 2 rather
  than a redesign.
- **General localisation.** `CF-4` is closed **for the confirmation statement only.**
- **Elevation windows.** `CF-3` — ten critical operations require ten confirmations, deliberately.
  If bulk operations become a requirement the answer is **one confirmed bulk action naming all its
  targets**, never a window, which would destroy the audit trail's ability to say what was confirmed.
