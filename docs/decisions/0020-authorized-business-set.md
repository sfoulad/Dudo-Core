# 0020 — Computing `authorizedBusinessIds` (the second half of AZ5)

- **Status:** **Accepted**
- **Date:** 2026-09-04
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Amends:** `0014` §C.5 (resolution order)
- **Completes:** `0019`, which closed only the grants half of AZ5
- **Owning agent:** Team Lead records. Implemented by `core-agent`.

## Context

`0019` gave a principal **permissions**. It did not give it **businesses**, and the Team Lead's
claim there that it was "the last thing between a deployed Dudo and a working business request"
was wrong — corrected in that record rather than quietly amended.

`AuthenticatedPrincipal.authorizedBusinessIds` is still `[]`. **An empty array is meaningful, not
absent**: `authorizeSuppliedBusiness` refuses any Business a caller names, and an unfiltered list
narrows to the empty set. So the current state is a principal that passes pipeline **step 3** with
real permissions and fails every Action at **step 5**.

### Why it could not simply be filled in

`tenant-context.ts` states the intended semantics: *"an organization-scope principal's set is every
Business in its Organization."* Computing that is a read of the **tenant** database's `business`
table. That requires a tenant store handle, which comes from `TenantStoreResolver`.

`0014` §C.5 fixes the order as:

> `session → principal → memberships → authorized Organization/business context → TenantStoreResolver → business data`

**The authorized context is built before the resolver exists.** `0003_organization_membership.sql`
recorded this exact finding when it declined to add a business assignment, and nothing had changed
it since.

`core-agent` declined to invent a sentinel meaning "all", correctly: `PrincipalAuthorization` says
in terms that no such value exists, and **a magic value would be an ambient tenant-wide grant
wearing an array.**

## Decision

**Split the authorized context in two. This is not a reordering.**

§C.5 becomes:

> `session → principal → memberships → authorized ORGANIZATION context → TenantStoreResolver → authorized BUSINESS set → business data`

- The **Organization** context — identity, membership, role, grants — is built where it always was,
  and is what `TenantStoreResolver` consumes. The resolver never needed the business set.
- The **business set** is computed **after** the store resolves, by reading `business` through the
  tenant-scoped handle.

**The dependency was never circular.** The resolver needs the *Organization*; only the business set
needs the *store*. §C.5 bundled two things that have different dependencies into one step, and this
decision separates them.

### For an organization-scope principal, the set is every Business in its Organization

Exactly as `tenant-context.ts` already documents. The read is issued through the tenant-scoped
handle, so it is **tenant-scoped by construction** and cannot name another Organization's rows —
the same property `whereWithTenant` enforces everywhere else.

### The set is computed per request and never cached beyond it

`security.md` §2: *"Authorization decisions are scoped and never cached beyond their scope."*

Caching for the life of a session would be tempting — sessions are 12 hours — and is **refused**. A
Business created mid-session would be invisible, and, far worse, **a Business removed mid-session
would remain authorized for up to 12 hours.** A stale authorization that outlives the thing it
authorizes is the failure this rule exists to prevent.

**Free-tier impact.** One additional D1 **read** per request against an allowance of **5,000,000
rows/day**, versus the 100,000 rows/**written** ceiling that governs everything else here. Reads
are the abundant resource; this spends the right one. **No additional writes. USD 0 / BD 0.**

## Why not an explicit business assignment on membership

The alternative — `membership_business` rows, or a `business_ids` column — is **the right mechanism
for a business-scope principal, and the wrong one for an organization-scope principal.**

- It contradicts the recorded semantics: organization scope *means* every Business, and enumerating
  them defeats the point of having a scope.
- Every new Business would have to write a membership row for every organization-scope member —
  writes, against the ceiling that actually binds, to express something already implied.
- The rows could **drift out of agreement with the Organization**, and a stale grant that outlives
  a Business is the same defect as the cache above, made durable.

**It is deferred, not rejected.** When business-scope principals exist — a user assigned to two of
an Organization's five businesses — explicit assignment is how they are expressed, and it will need
its own record.

## Consequences

- `0014` §C.5's order is amended as above. The change is a **split**, and the record should say so,
  because "we reordered authorization" invites a security reading the change does not deserve.
- `createMembershipPrincipalAuthorizationSource` stops returning `[]` for an organization-scope
  principal.
- **After this, a seeded `owner` can complete a Customer Directory Action end to end.** Stated
  without the superlative that was wrong in `0019`: this is the second of AZ5's two halves, and no
  third half is known.
- The argument `core-agent` wrote at the code site should be **updated, not deleted** — it records
  why the gap existed, and that is worth more than a clean file.

## Two corrections from verification, 2026-09-04

Both found by `qa-agent` while testing, and both are corrections to how this record described the
implementation — not to the implementation.

### 1. The 500 bound is a property of the STORE, not of this code

`0020` records the set as "bounded at 500". **`listInTenant` does not truncate in application
code.** It passes `limit` into the select spec and relies entirely on the store;
`sql-compiler.ts:174` emits `LIMIT ${spec.limit}` and the engine never materialises row 501.

**For the shipping store that is correct, and better than truncating twice.** But it means the
bound lives somewhere this file does not control. **A future `TenantScopedStore` that ignored
`limit` would grow the set unbounded**, and nothing in the directory would notice.

QA found this because its first attempt at the case **failed**, returning all 750 rows against a
stub that ignored `limit` — the stub was wrong, and the failure exposed the real dependency. The
case is now written against `createD1TenantStore` and a real engine with 520 rows plus a second
Organization's row, so **truncation, the SQL `LIMIT`, and tenant isolation are asserted together.**

**Recorded so it is not rediscovered:** the bound is a contract with the store, and any new store
implementation must honour `limit` or this ceiling silently disappears.

### 2. The audit gap is wider than this record first stated

`0020` originally said *"a denial occurring **before** the store resolves records an empty
`actorBusinessIds`."* True, and too narrow.

**`pipeline.ts` has exactly one `recordDenial` call site (line 441), and it sits before the business
fill (line 576).** So it is not that *some* denials carry an empty set — **every recorded denial
does**, for an organization-scope principal, because no denial path after the fill records a
summary.

**Still not a regression and still not a defect.** Before `0020` every audit record carried an
empty set, and at an authorization denial the caller's Businesses genuinely have not been read.
What changed is that the bound is now **measured rather than estimated**: denial summaries only,
never success audits. QA asserts both halves — a denial records `[]`, a success audit records the
real set — so the incompleteness is scoped precisely instead of approximately.

### And the default was attacked rather than assumed

QA checked **every** construction site of `businessScope`. Exactly two in production —
`session-resolution.ts` states `'organization'`, `pipeline.ts` re-seals `'assigned'` after filling —
and one in the harness that omits it and therefore keeps what it was given. **No site omits it that
should not.**

It also pinned a case that the completed principal is **re-sealed** as `'assigned'`, because
`pipeline.ts` spreads then overrides, and **an edit reversing that order would let a downstream step
re-widen the set.** That is the failure this design exists to prevent, now executable.

## What this does NOT decide

- **Business-scope principals** and explicit assignment. Deferred, as above.
- **Whether the per-request read should later be memoised within a single request.** A request-scoped
  memo is not a cache across scope and would be legitimate; it is an optimisation nobody has
  measured a need for.
- **How a Business is created**, which has no audited path yet — the same gap `0018` and `0019`
  record for operator-run SQL and for role changes.
