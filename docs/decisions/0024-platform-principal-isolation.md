# 0024 — The platform principal, and the trap that would undo tenant isolation

- **Status:** **Accepted** — the two invariants. The rest of the super-admin design is **not** decided here.
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, on `architecture-agent`'s analysis
- **Owning agent:** Team Lead records. Enforcement belongs to `core-agent`.

## Why this is recorded now, ahead of the design it belongs to

The super-admin console is not designed yet — `CO4` (where platform authority lives), `CO5` (whether
a business type is a `Template`) and the fourth request class are all open, and
`architecture-agent` **deliberately declined to author a contract** until they are settled.

**This one finding is recorded early anyway, because it is the kind that is expensive to rediscover
and cheap to lose.** It describes a way to assemble cross-tenant access **out of entirely
legitimate parts** — no rule broken, no code changed, and nothing a review would flag.

## The good news first: a memberless super admin is structurally safe

The chain is mechanical, not disciplinary:

1. **Credentials hang off `principal_credential`, which has no tenant.** So a principal belonging to
   no Organization **can authenticate**.
2. **`AuthenticatedPrincipal` requires an `organizationId`** (`tenancy/tenant-context.ts:64`), and it
   comes only from a *selected* Organization, validated against a membership row (`0014` §C.6,
   `0021`).
3. No membership → no selection → **no `TenantStoreResolver` handle** → no `whereWithTenant` →
   **no rows.**

**A memberless platform principal is structurally incapable of reading tenant data, and this
requires no new control.** That is the reason to build the super-admin console starting from
platform *configuration* rather than anything that touches customer records.

## The trap: the convenient fix that quietly undoes all of it

**`scope.ts` ranks `platform` at 0, so `implies('platform', X)` is true for every X.**

Give a platform operator a **membership row** carrying a platform-tier role — the obvious way to
make the console "just work" — and:

- they pass authorization at step 3 for **every Action at every scope**, because `platform` implies
  everything; and
- the storage boundary then **politely scopes them into that Organization and serves the rows.**

Repeat per Organization and you have **cross-tenant access assembled entirely from legitimate
parts.** Every individual step is correct. `whereWithTenant` still emits its predicate. The
resolver still validates membership. Nothing is bypassed — the membership row *is* the bypass, and
it looks exactly like every other membership row.

**No review catches this**, because there is nothing wrong to see. That is what makes it worth a
decision record rather than a comment.

## Decision — two invariants, both mechanically checkable

1. **A platform principal holds ZERO membership rows.** Not a scoped one, not a read-only one, not
   one "just for the tenant being supported". The absence of the row is the isolation.
2. **`MembershipRole` never gains a platform-tier value.** `assertRoleMappingIsCoherent` already
   throws on any grant outside `organization` scope and is the natural home for this check.

**Both must be enforced in code, not documented.** An invariant that depends on nobody adding a row
is not an invariant. `0019`'s closed union and `0023`'s coherence guard are the precedents: the
guard runs at load, and the wrong value cannot exist.

### What `0022` already contributes

`admin.dudo.work` carries a **separate host-only cookie session** — a property already decided for
different reasons — so an operator's session credential **is not replayable against
`app.dudo.work`.** The console builds on that rather than inventing it.

## Corrected here: onboarding costs 10 control-plane row-writes, not 6

`control-plane-admission.ts:237` records "onboarding is 6" — `organization` 2 + `tenant_directory` 2
+ `organization_membership` 2. **That assumes the admin principal and their credential already
exist**, which is exactly what is false when a new customer arrives.

**Add `principal` 2 + `principal_credential` 2 = 10**, plus the first inner unit (2) and the audit
record (5) from a different allocation.

**300 onboardings/day platform-wide** against the 3,000 control-plane sub-ceiling; 60 per operator
per day against the 600 per-principal ceiling. Not a constraint in practice.

**It is recorded because of how it was wrong.** `0021` documents what happens when a figure resting
on an unsettled design is published as arithmetic — that number moved five times in two days. This
one was published as 6, is 10, **and the gap is precisely the two objects nobody counted.**

## What this does NOT decide

- **Where platform authority lives** (`CO4`/`AZ9`) — the open question this record works around
  rather than answers.
- **The fourth request class**: authenticated at principal level, **no tenant**, but **does**
  evaluate a permission. Neither `0021`'s session class (evaluates none) nor an Action (requires a
  tenant). `0021`'s own sentence applies — *"the invariant that an Action always has a tenant is
  worth more than the code it saves."*
- **Whether a business type is a `Template`** (`CO5`).
- **Break-glass access to tenant data (AZ3).** Nothing here permits it. If a platform operator ever
  needs to read a customer's records, that is a separate decision with its own audit story, and the
  invariants above are what it must argue against rather than quietly relax.
