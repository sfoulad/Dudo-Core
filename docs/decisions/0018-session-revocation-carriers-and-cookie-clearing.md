# 0018 — Session revocation: credential carriers and cookie clearing

- **Status:** **Accepted**
- **Date:** 2026-09-04
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Amends:** `0014` §B (the pre-authentication entry-point registry)
- **Owning agent:** Team Lead records. Implemented by `core-agent`, consumed by both clients.

## Context

Logout was built. Two properties of the merged code prevent it from fully working, and both were
found by `core-agent` while implementing rather than by anyone reviewing the design.

**Neither is a choice anyone made.** Both are contradictions that were already sitting in the
code, invisible until something tried to use them.

### Finding 1 — the clearing-cookie branch is unreachable

`pre-auth-http.ts::renderCredential` contains a clearing-cookie branch whose own comment says it
is *"how `identity.session.revoke` removes a credential."* It cannot execute. A clearing cookie
can only ride an `issued` outcome, and the registry declares revocation's outcomes as
`['acknowledged']` alone.

**The registry is right and the comment is wrong.** `assertRegistryIsCoherent` requires a
collapsed entry point to have exactly one outcome, and adding `issued` would force
`collapseTo: 'issued'` — which `outcomeOfKind` refuses, in its own words, as *"an authentication
bypass wearing the word default."* That refusal is correct and must not be relaxed.

So logout **deletes the session row** — the credential stops resolving immediately, which is the
security property that actually matters — and leaves a dead cookie in the browser for up to 12
hours.

### Finding 2 — a Bearer-only client cannot log out at all

`PreAuthRequest` carries no header map, deliberately, and `readPresentedCredentials` parses
`Cookie` only. An Apple client presenting `Authorization: Bearer` therefore reaches
`revokeHandler`, which finds no credential and correctly answers `acknowledged`.

**That is precisely the failure this project already rejected once**: a security action reporting
success while doing nothing. It is worse here than the original `identity.session.revoke` stub,
because it looks implemented.

It also collides with a decision made independently and for good reasons: the Apple client
disables `URLSession`'s cookie store entirely, so the credential exists only in the Keychain and
cannot be presented as a cookie by default. That decision removed a second copy of a bearer
credential and eliminated the cookie/header confusion case. **It is a good decision that this
gap punishes**, which is the clearest sign the gap is Core's to close.

## Decision

**Amend `0014` §B in two narrow ways.**

### A. Revocation accepts both carriers

`PreAuthRequest` carries the `Authorization` header for the revocation entry point, and
`readPresentedCredentials` reads it. `0015` §A already establishes "one value, two carriers";
authenticated requests honour both. Revocation honouring only one was an oversight, not a
control.

**This opens no disclosure channel.** The response is fixed at `acknowledged` regardless of what
is presented or whether anything resolves. Which header the server *reads* cannot vary the
response, so nothing about it is observable.

The existing mismatch rule stands: if both carriers are present and disagree, the request is
refused as a confusion attack.

### B. A `cleared` outcome for revocation

Add `cleared` as a distinct outcome. It emits a **constant, argument-free clearing cookie** on
every revocation.

**It discloses nothing because it never varies.** It is byte-identical for a valid session, a
forged credential, an unknown session, a replay, and an absent cookie. It carries no session id,
no principal, and no timing signal — which is what separates it from `issued` and is why it does
not reintroduce the `collapseTo: 'issued'` hazard that `outcomeOfKind` rightly refuses.

`assertRegistryIsCoherent`'s one-outcome rule for collapsed entry points is satisfied: `cleared`
*replaces* `acknowledged` for this entry point rather than joining it.

## Interim, until A lands

The Apple client sets the `Cookie` header **by hand on the revocation request only**, from the
value it already holds in the Keychain. It continues not to use `URLSession`'s cookie store.

This works today with no Core change and no mismatch, since it presents one carrier. It is an
interim and is recorded as one — the inconsistency of "everything accepts Bearer except logout"
is the actual defect, and A is what fixes it.

## The cost, stated plainly

**Logout is not free, and the budget is half what the login figure suggests.**

Revocation costs **3 row-writes, exactly** — a `DELETE` removes the row from every index, so the
table row, the primary key and `session_by_principal` are each written. Identical to a login.

**The number that matters is the cycle: login + logout = 6 row-writes.**

| | Sub-ceiling | Cycles/day |
|---|---|---|
| Platform-wide | 3,000 | **500** |
| Per principal | 600 | **100** |

Anyone reading `0014` §C's "1,000 logins/day" and assuming 1,000 sessions is wrong by half once
users log out. Verified in the harness: revocation reserves exactly 3, and a forged credential,
an absent cookie, an unknown session and a replay each reserve **zero**.

## Consequences

- **Until A lands, the web client must treat `401` as "logged out", not as "retry".** The dead
  cookie will still be presented by the browser; the session behind it is gone.
- Both clients get a logout that actually revokes.
- `pre-auth-http.ts`'s misleading comment is corrected rather than left describing an unreachable
  branch.
- **Free-tier impact: USD 0 / BD 0.** No new service. The row-write cost is inside `0014` §A's
  existing allocation and is now stated as a cycle rather than a login.

## Addendum, 2026-09-04 — the dead cookie can sign a user back in

**Found by `web-agent` while wiring logout. It was not in this decision's consequences when
written, and it sharpens why §B is not cosmetic.**

Revocation is **collapsed**: `acknowledged` on all five paths. So the client **cannot know whether
the row was actually deleted.**

If a revocation silently fails, the browser still holds a **live** cookie. The session probe on the
next page load then returns `200`, and the person is **signed back in without a password, seconds
after pressing Sign out.**

**The likeliest cause is not an exotic failure — it is the budget.** Revocation costs 3 row-writes
against a sub-ceiling this same decision shows is tighter than it looks. **At exhaustion, logout
stops working and still reports `acknowledged`**, because the response is fixed. A shared machine
is exactly where that matters, and nothing in the response distinguishes it.

**Interim mitigation, and it is explicitly NOT a security control.** `web-agent` made the per-tab
session hint tri-state (`active` / `ended` / absent). After logout it is `ended`; a tab in that
state renders anonymous and skips the probe entirely, which also avoids a request that could only
return a wrong answer.

**It binds one tab. Another tab bypasses it.** It is labelled as presentation in three places in
the client, on the grounds that the interim window is precisely when someone would mistake it for
the fix. That labelling is the right instinct and should survive review.

**§B is the real fix**, and this addendum is why it is not merely tidiness: a constant, argument-free
clearing cookie makes the browser drop the credential **regardless of whether the server-side delete
succeeded**, which is the only mitigation that does not depend on the outcome the collapsed response
refuses to reveal.

## Ruling, 2026-09-04 — logout under an exhausted budget, now measured

The addendum above predicted this. `qa-agent` then **built it and confirmed it**, against the real
session resolver, real admission port, real store and real migrations, with only the day budget as
a fixture:

> With the budget exhausted, `revokeSession` returns `quotaExceeded`, **the session row survives,
> and the session is still live** — same principal, expiry still twelve hours out.

Also confirmed: repeated attempts stay refused rather than eventually succeeding; a partial budget
(2 of the 3 needed row-writes) refuses outright rather than spending part of it; and an unknown
session identifier costs **zero**, so logout cannot be used to drain the control plane.

`session-resolution.ts` already documented this in its own words — *"A REFUSED LOGOUT IS INVISIBLE
TO THE USER. Reported; it is the price of the collapse, not a defect in it."* So it is a **recorded
consequence, not an undiscovered bug.** What changed is that it is now executable, and that the
trigger is a predictable budget state rather than a fault.

### What actually survives, stated precisely

**§B has already reduced this, and the reduction is easy to overstate.** `revokeHandler` returns
`cleared` unconditionally and discards the `revokeSession` result, so **the browser drops the
credential even when the delete failed.** The user is signed out on the device in front of them.

What survives is **the server-side session**, for up to twelve hours. It is reachable only by
someone who **already holds the credential** — captured before logout, from a second device, or
from a stolen Keychain entry. It is not reachable by the person who pressed Sign out.

That is meaningfully smaller than "logout does nothing", and meaningfully larger than nothing.

### Decision: accept for the closed beta, with a named trigger

**Accepted as-is**, on the same basis as `0017`: operator-seeded accounts only, and 500 login/logout
cycles per day platform-wide is far outside a closed beta's reach.

**Not fixed by surfacing the failure.** Returning `quota_exceeded` from revocation would break
`disclosure: 'collapsed'` **if** the refusal only occurred once a real session had been found —
which is exactly when a write is attempted. It would then answer differently for a real session
than for a forged credential, which is the account-existence oracle rebuilt on the logout path.

**The trigger, and it is binding:** before any non-operator user exists, **revocation must draw
from an allocation that business writes cannot starve.** `0014` §A already splits the day into
`business` / `security` / `system`; logout is a security operation and must not be exhaustible by
customer creates. That is a scoped change with a clear shape, and it is owed — not optional — at
the same moment `0017` expires.

## Implementation rulings, 2026-09-04 — two calls raised by `core-agent`, both upheld

### 1. `cleared` is NOT counted as evidence in `evidenceCategoryOf`

**Upheld, and this is the sharpest catch in the slice.**

A logout is not a denial. Counting one as evidence would put a **row-writing path behind an
endpoint an unauthenticated caller can invoke at will** — which is `0013`'s hole reopened through
the evidence trail rather than through the audit log.

`0013` exists precisely because one audit write per denial let 100,000 probes exhaust D1's
account-wide daily write limit. Routing revocation into the evidence counter would recreate that
attack against a different door, and the bound `0013` installed would not see it coming, because
it is counting denials.

**The general rule this instance illustrates:** a control that bounds writes on one unauthenticated
path does not bound writes on a second one added later. Every new unauthenticated endpoint must be
asked, separately, what it causes to be written.

### 2. The clearing cookie clears `dudo_session` only

**Upheld.** `dudo_refresh` and `dudo_login_state` are in the closed name set but are **never
issued** — `0015` §B.3 leaves refresh unbuilt, and §D removed the need for login state.

Clearing them defensively would emit `Set-Cookie` headers for credentials that do not exist. That
is not merely redundant: this response is **constant by design**, and a constant that carries
directives about things the system does not have is a constant nobody can later reason about.

The correct coupling is the one `core-agent` proposed: **a name joins the clearing cookie in the
same change that starts issuing it.** The response stays constant because the constant stays
constant.

### Also upheld without being asked: the bearer allow-list

`0018` §A says "revocation accepts both carriers". `core-agent` implemented something narrower and
better: `readPresentedCredentials` takes the **entry-point id** and consults a closed set containing
only `identity.session.revoke`; the other four entry points are blind to `Authorization`.

The id is the one **Core matched against its own frozen registry**, never anything the caller
supplied, so the allow-list cannot be steered.

This preserves `PreAuthRequest`'s original reason for carrying no header map — *"a handler with the
header map is a handler that can read a caller-supplied `X-Organization-Id`"* — while closing the
one route that had the defect. `bearer()` takes no parameter naming a header, so it **cannot grow
into a header map**. Least privilege between Core's own components, which is the same argument
`control-plane-store.ts` property 3 already makes.

## What this does NOT decide

- **Where permission grants live (AZ5).** A seeded principal can now log in, list its
  Organization, select it and resolve a tenant store — and is then refused on every business
  Action, because `PrincipalAuthorizationSource` is deny-all and `0007` does not say where grants
  come from. **That is the last gap between here and a demonstrable request**, and it is a
  separate decision.
- **Audit for operator-run SQL.** An operator applying seed SQL by hand produces no audit record,
  and Organization creation still has nowhere to put one. Recorded, not solved.
