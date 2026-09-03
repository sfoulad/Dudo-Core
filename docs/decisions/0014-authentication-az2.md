# 0014 — Authentication (AZ2): write admission, pre-auth entry points, and the identity control plane

- **Status:** **Accepted**
- **Date:** 2026-09-02
- **Deciders:** **User** (explicit written decision, 2026-09-02), Dudo Team Lead
- **Owning agent:** Team Lead records. Drafted by `architecture-agent`, implemented by
  `core-agent`.
- **Closes:** `AUTHORIZATION_STANDARD.md` AZ2 · `0007` §4 item 1 · scheduled item 10
- **Amends:** `0007` D1 (see §B)

## Context

`0013` bounded the denied-read path against an authenticated attacker. Drafting AZ2,
`architecture-agent` checked what else goes live the day authentication ships, and found the
fourth instance of this slice's recurring pattern.

**Every rate limit in the system uses a 60-second window. Every D1 allowance that causes an
outage is daily.** A per-minute limit cannot bound a per-day budget, and the only daily
windows in the codebase were `0013`'s summary ceilings — which bound denials, and nothing
else. `coordination.ts` says so plainly and correctly: *"they are not what bounds the daily D1
write cost — the summary ceilings below are."* True, and scoped to the denial path.

Verified by the Team Lead against the code on `main`:

| | |
|---|---|
| Actor rate limit | 60/min → **86,400 requests/day per credential** |
| Successful `CreateCustomer` | customer row + audit row, **plus every index row D1 bills** = **8 row-writes** |
| Daily cost at the permitted rate | **691,200 — 6.9× the enforced 100,000/day account-wide allowance** |
| Time to outage | ~12,500 creates ≈ **3.5 hours** |

**The exposure figure was corrected on 2026-09-03 and is recorded here at its true size.** It
was first stated as 172,800 and 1.73× on the assumption that a create costs two row-writes.
It costs eight, because D1 bills an index row per indexed column touched. **The hole this
decision closes was four times larger than first reported**, and the margin between working
and an account-wide outage is correspondingly thinner than the decision was originally
written against — which is why the Organization ceiling was **not** raised to buy back
throughput.

**The realistic trigger is not an attacker.** A tenant migrating 50,000 records through the
API — fully authorized, entirely within every rate limit — halts D1 for every Organization.

Two further blockers made AZ2 undraftable as it stood:

- **The permission model cannot express a login endpoint.** `0007` D1: *"An entry point with
  no declared permission is unreachable, not open."* Login has no principal, therefore no
  permission, therefore no door.
- **`Session` was declared tenant-scoped and cannot be.** Reading it needs a tenant-scoped
  store handle, which needs the Organization — which is what the session is read to discover.
  `OrganizationMembership` at login spans tenants by construction.

## Decision

### A. Daily D1 write admission

1. **Every production D1 mutation reserves a conservative write cost before execution.**
2. A **global UTC-day budget coordinator** holds the accounting.
3. **Hard platform ceiling: 80,000 estimated row-writes per day.**
4. The remaining **20,000 is safety margin** — estimation drift, operational work, emergency
   actions. It is not spendable capacity.
5. Within the 80,000:

   | Allocation | Ceiling |
   |---|---|
   | Normal business mutations and their audit records | **60,000** |
   | Security and audit summaries | **10,000** |
   | Controlled system operations | **10,000** |

6. **Initial Organization ceiling: 10,000 row-writes/day.** Not raised — ruled 2026-09-03.
7. **A Customer create costs EIGHT estimated row-writes** — corrected 2026-09-03 from the
   two this record originally stated. D1 bills an extra written row per index: *"Indexes will
   add an additional written row when writes include the indexed column, as there are two
   rows written: one to the table itself, and one to the index."* Counted against the
   migrations: `customer` = 1 table + 1 PK index + 1 explicit index = **3**; `audit_event` =
   1 table + 1 PK index + 3 explicit indexes = **5**.
8. Therefore an Organization may create **at most 1,250 customers per UTC day** — corrected
   from 5,000.
9. **Large imports, including 50,000-record imports, are NOT part of the zero-cost MVP.** They
   cannot bypass the budget, and no import path is built in this slice.
9a. **On exhaustion, pause safely: return `429` with the next UTC reset time, and NEVER
    partially create a Customer.** A customer row without its audit row, or either without its
    index rows, is a worse outcome than a refusal.
10. **On exhaustion: mutations return `429` with a retry time after the next UTC reset. Reads
    remain available.**
11. **All storage writers must use this admission port. Direct D1 writes outside it are
    prohibited.**
12. **Reservations use worst-case cost, and uncertain or partially consumed reservations are
    not refunded.** Erring toward over-reserving is the safe direction: the failure mode of
    over-reserving is a delayed write, and of under-reserving is a platform outage.
13. **This is internal conservative accounting.** It is not a claim that Dudo can read
    Cloudflare's live counter, and no report may describe it as one.

### B. Pre-authentication entry points — amending `0007` D1

`0007` D1 stands: **a route without a permission is unreachable, not open.** AZ2 amends it
with one narrow exception.

**A route without a permission is unreachable unless it is registered in a closed
`PreAuthEntryPoint` registry.** The registry is Core-owned and enumerated. It is **never
manifest-declarable** — no App may add to it.

Initially permitted, and only these:

- login start
- login completion / callback
- session refresh
- logout / revocation where applicable
- a health endpoint containing **no tenant or user data**

Every pre-auth route must: declare `access: pre-authentication`; be explicitly registered;
carry strict input validation and rate limiting; **reveal no account-existence difference**;
access **no tenant business data**; issue **no business permission**; and **fail closed**.

**This is an admission rule, not a fake permission granted to an anonymous user.** The
distinction matters: a pseudo-principal holding a pseudo-permission would flow through the
authorization pipeline and could accumulate grants. An admission rule cannot.

### C. The identity control plane

1. **Sessions are principal-scoped control-plane records**, not tenant-scoped records.
2. **`OrganizationMembership` is a control-plane relationship**, because it must be resolved
   *before* an Organization can be selected.
3. A **dedicated control-plane storage port and dedicated D1 database binding** holds:
   principals, sessions, Organizations, Organization memberships, and tenant-directory
   mappings.
4. **Customer and all other business data remain behind `TenantStoreResolver`**, unchanged.
5. **Resolution order:**
   `session → principal → memberships → authorized Organization/business context →
   TenantStoreResolver → business data`
6. **A requested Organization is only a hint** and must be validated against membership. It is
   never trusted as an assertion — the same rule that governs every other caller-supplied
   identifier in this platform.
7. **The separate database is an isolation boundary, not additional quota.** Cloudflare's
   daily D1 limit is **account-wide**, so splitting the data changes what can reach what — it
   does not raise the ceiling. Any design that assumes otherwise is wrong about the
   constraint.

## Consequences

- **The bulk-import path changes shape.** 50,000 records is a queued, multi-day operation.
  That is a real product consequence, accepted knowingly: the alternative is that one
  customer's migration is an outage for every other customer.
- **`0006`'s database budget moves.** A second D1 database is allocated for the control plane;
  the free tier allows 10 per account. `docs/operations/free-tier-register.md` must be
  updated.
- **`core-object-registry.yaml` must be corrected.** `Session` and `OrganizationMembership`
  are recorded as tenant-scoped and are control-plane. That entry is currently circular.
- **Every existing storage writer must be routed through the admission port.** A writer that
  bypasses it is not merely inconsistent — it is unaccounted capacity against an account-wide
  ceiling.
- **Scheduled item 10 closes**, and `0013` control 10's precondition is satisfied by A.

## Two findings from implementation, recorded because neither was anticipated

### The budget check's POSITION is what makes it safe — not the error code

`architecture-agent` found this while amending the contract, and it is normative now.

`quota_exceeded` is record-independent **only because the check sits at stage 5** — beside
the rate limit, after authorize and validate, **before step 5 resolves anything.** There it
discloses nothing.

**If it ever moves below step 5** — and it will be proposed, for a reason that sounds like
good engineering, *"only count writes we are actually going to make"* — then
`quota_exceeded` becomes reachable **only when the target row resolved inside the tenant.**
A caller can then **deliberately exhaust its own budget, which it controls completely**, and
thereafter distinguish `quota_exceeded` ("this customer is in my Organization") from
`not_found` ("it is not"). **A cross-tenant existence oracle built out of a capacity
control, switched on at will by the attacker.**

**The budget check must never be evaluated below step 5.** This is the fifth instance in this
slice of a control becoming the vulnerability, and like the other four it was found by an
implementer rather than by review.

### §A.10's retry time has no carrier, and the envelope must gain one

`error-envelope.schema.json` declares `error` as `additionalProperties: false` with exactly
`code`, `message`, `details`, `request_id`. There is **no field for a retry time and nowhere
to smuggle one**, so §A.10 as written is not implementable end to end. The same gap already
existed, unpaid, for `Retry-After` on `rate_limited`.

**Approved:** the platform-wide envelope gains one optional field.

```
retry_after_seconds  integer, minimum 0
```

Present **only** on `rate_limited` and `quota_exceeded`, absent on every other code. It is
derived from a **fixed window boundary** — the end of the 60-second rate window, or the next
00:00 UTC reset — so it is **the same value for every caller at that instant** and therefore
carries no signal about another tenant, another principal, or any record. It must never be
derived from observed usage, remaining budget, or anything a caller could vary.

This is a platform-wide contract change and belongs to `0014`, not to any one App's contract.

## What AZ2 does NOT decide

Stated so this is not read as settling more than it does:

- **The App permission and trust ADR** remains unwritten.
- **The App isolation mechanism** remains undecided, and `0008` still prohibits Workers for
  Platforms as paid-only.
- **The identity provider itself** — what issues the credential — is settled in the
  implementation only to the extent AZ2's constraints require; anything requiring a paid
  Cloudflare product is a **BLOCKED** report, not a decision.

## Approval

Decided by the user in writing on 2026-09-02, in three lettered parts covering write
admission, pre-authentication entry points, and the identity control plane. Implementation
follows; **no deployment until AZ2 passes focused security tests and C5 is complete.**

Related: `0007` (amended by §B); `0006` (tenancy, and the database budget §C changes);
`0013` (whose control 10 §A satisfies); `0008` (zero cost, and the account-wide ceiling §A.13
is honest about).
