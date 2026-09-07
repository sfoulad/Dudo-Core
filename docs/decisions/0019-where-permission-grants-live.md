# 0019 — Where a principal's permission grants live (AZ5)

- **Status:** **Accepted**
- **Date:** 2026-09-04
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04
- **Closes:** AZ5, open since `0001`. Completes `0007`, which defined the permission model but
  never said where grants come from.
- **Owning agent:** Team Lead records. Implemented by `core-agent`.

## Context

`0007` settled what a permission *is* and how it is enforced. It never said **where a principal's
grants are stored**, and `0014` §C did not decide it either.

The consequence is now concrete rather than theoretical. `PrincipalAuthorizationSource` is
`createDenyAllPrincipalAuthorizationSource()`, so a seeded principal can log in, list its
Organization, select it, and resolve a tenant store — **and is then refused on every business
Action at pipeline step 3.** Login works and the product does nothing.

`0003_organization_membership.sql` records the refusal to settle this quietly:

> *"NO ROLE, PERMISSION, OR GRANT. `0007` records the logical permission model but does not say
> where a principal's grants are stored... A `role` column here would settle it in a migration, as
> a side effect of unblocking a [slice]."*

**That refusal was correct.** A decision this shape does not belong in a migration written to
unblock something else. It belongs here.

## Options

**A. A role on the membership row.** `organization_membership.role`; roles map to explicit
permission sets registered in Core.

**B. An explicit grant table.** `principal_permission(principal_id, organization_id, permission)`
— one row per granted permission.

**C. Both** — roles as bundles, plus per-principal overrides.

## Decision

**Option A.** The grant lives as a `role` on the membership row, and Core owns the mapping from
role to an explicit permission set.

### Why not B, which is otherwise the more flexible answer

**Row-write cost, and it is decisive under `0008`.** B costs one row per permission per principal
per Organization. A principal with fifteen permissions costs fifteen rows to grant and fifteen to
revoke, against a control-plane sub-ceiling of 3,000 row-writes/day that `0018` already showed is
tighter than it looks. A costs **zero additional rows** — it is a column on a row that already
exists and is already read during Organization selection.

B is the right answer for a product with per-principal permission editing. Dudo has no such
surface, and will not before the closed beta ends. **C is B with extra steps until that surface
exists**, so it is deferred rather than rejected.

### Shape, and how it satisfies `0007`'s ten rules

- **The role column is a closed union of literals.** Not free text. An unrecognised value is not
  an error and not a partial grant — it is **deny all**, on the same path as an absent membership.
- **Each role maps to an explicit, frozen list of Action identifiers, registered in Core code.**
  No wildcards, no prefixes, no "everything under `customers.*`" — `0007` rule 3 forbids
  wildcards and rule 4 requires explicit registration, and a role is exactly where a wildcard
  would otherwise be smuggled back in.
- **Core is the only authority.** The mapping lives in `platform/core/**` and is not readable or
  extendable by an App. An App declares what it *needs*; it never declares what a role *grants*.
- **The role is per-Organization, not per-principal.** It sits on the membership row because a
  principal may belong to more than one Organization and must not carry authority across them.
  Putting it on `principal` would be a tenant-isolation defect with a convenient shape.
- **Deny by default survives**: no membership → no role → no permissions.

### The two roles for the closed beta

| Role | Grants |
|---|---|
| `owner` | The full Customer Directory Action set in MVP scope |
| `member` | The read-only subset |

**Two, not one, on purpose.** A single role would let the mapping degenerate into a constant, and
the first person to add a second role would find the indirection was never really there. Two
proves the mapping is a mapping.

Neither grants `DeleteCustomer` or `RestoreDeletedCustomer` — they are outside MVP scope, and the
web client already makes calling them a compile error.

## Consequences

- One migration, `0007_membership_role.sql`, adding the column with **no default that grants
  anything**. An existing row without a role denies.
- `createDenyAllPrincipalAuthorizationSource` is replaced by a membership-backed source. The
  deny-all implementation **stays in the tree** and stays used by tests — it is the correct
  behaviour for an unknown Organization and should not become unreachable.
- The seed tool emits a role on the membership INSERT. `owner`, since a closed beta with one
  operator-seeded account needs the account to be able to do something.
- ~~**This is the last thing between a deployed Dudo and a working business request.**~~
  **THAT CLAIM WAS WRONG. Corrected 2026-09-04, struck rather than deleted.**

  It is left visible because the error is instructive: **this ADR closes the `grants` half of AZ5
  and not the `authorizedBusinessIds` half**, and writing "the last thing" made a two-part problem
  look like a one-part problem in the record that was supposed to be authoritative about it.

  `core-agent` found it while implementing and traced the cost rather than inferring it: a seeded
  `owner` now signs in, selects its Organization, resolves a tenant store, and **passes pipeline
  step 3 with real permissions** — then every Customer Directory Action still fails at step 5,
  because `authorizeSuppliedBusiness` refuses any Business a caller names and an unfiltered list
  narrows to the empty set. **The refusal moved one step later; it did not go away.**

  The remaining half is decided in `0020`.

## What this does NOT decide

- **How a role is changed after seeding.** There is no UI, no Action, and no audited path. `0007`
  rule 9 requires permission changes to be audited, and **an operator editing a role by hand
  produces no audit record** — the same gap `0018` recorded for operator-run seed SQL. A role-change
  Action must carry an audit write when it is built, and it is not built here.
- **Per-principal overrides (option C).** Deferred until a permission-editing surface exists.
- **Roles beyond these two**, and anything about Apps requesting permissions, which `0007` already
  governs.
- **Free-tier impact: USD 0 / BD 0.** No new service; no additional rows; the read is already
  happening.
