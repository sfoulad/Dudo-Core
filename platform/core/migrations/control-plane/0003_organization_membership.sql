-- Control-plane migration 0003 — the organization_membership table.
--
-- Read `0001_principal.sql` first for the shared header of this directory.
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
-- ROLLBACK PATH: DROP TABLE organization_membership. Safe only while empty. Once memberships
-- exist, dropping it removes every principal's right to enter every Organization — the platform
-- does not fail open, it fails shut, and no one can log in to anything.
-- FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- WHY THIS IS A CONTROL-PLANE TABLE AND NOT A TENANT-SCOPED ONE — docs/decisions/0014 §C.2
-- =============================================================================================
--
-- `core-object-registry.yaml` records `OrganizationMembership` as `tenancy: tenant-scoped`.
-- THAT ENTRY IS WRONG, and it is wrong in a way that cannot be patched by adding a column.
--
-- The question membership answers at login is "which Organizations may this principal enter".
-- That question SPANS TENANTS BY CONSTRUCTION: its answer is a set drawn from every Organization
-- in the platform, and it must be answered BEFORE any Organization is selected. A tenant-scoped
-- table cannot be read without a tenant-scoped store handle, a handle requires an Organization,
-- and the Organization is the thing being resolved. The registry entry is circular for exactly
-- the reason its `Session` entry is.
--
-- The registry is `architecture-agent`'s file. The correction is reported, not made here.
--
-- =============================================================================================
-- THE PRIMARY KEY ORDER IS THE DESIGN, AND IT IS ALSO THE HAZARD
-- =============================================================================================
--
-- PRIMARY KEY (principal_id, organization_id) serves both real access paths from one b-tree:
--
--   the full key      -> "is this principal a member of this Organization", the point lookup on
--                        EVERY authenticated request and the anti-oracle of §C.6;
--   the key prefix    -> "which Organizations may this principal enter", the bounded scan that
--                        backs an Organization picker.
--
-- THE SECOND ONE IS THE HAZARD REGISTRY OPEN QUESTION CO1 NAMES: "a user's list of Organizations
-- must never be visible to any of them." A prefix scan on `principal_id` is that list, and it is
-- one query away for anything holding a control-plane handle.
--
-- WHAT KEEPS IT SAFE IS NOT THIS SCHEMA — it is that nothing outside the identity layer can
-- reach a handle. `ActionContext` (tenancy/tenant-context.ts) carries no control-plane store,
-- constructing the adapter requires a D1 binding that App code never sees, and the only method
-- that performs this scan (`listMembershipsForPrincipal`) is reachable solely through a valid
-- session belonging to the principal being listed. If a control-plane handle ever appears on
-- `ActionContext`, CO1 is violated in one line and this table is where the data comes out.
--
-- THERE IS NO INDEX ON `organization_id`, and the omission is deliberate rather than
-- accidental. "Who belongs to this Organization" is a real future query for an administration
-- screen, and it is a reverse index away — an additive migration, costing one more row-write per
-- membership change. It is not added now because nothing asks it, and because an index that
-- exists is an index a query can be written against: today there is no way to enumerate an
-- Organization's members that would not also require adding a port method to do it with.
--
-- =============================================================================================
-- WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR
-- =============================================================================================
--
--   * NO ROLE, PERMISSION, OR GRANT. `docs/decisions/0007` records the logical permission model
--     but does not say where a principal's grants are stored, and `0014` §C does not decide it.
--     A `role` column here would settle it in a migration, as a side effect of unblocking a
--     login. The seam is `identity/principal-authorization-source.ts`, which is injected and
--     currently grants nothing — so every authenticated request is refused at pipeline step 3.
--     That is fail-closed and correct, and it is the honest state of an undecided decision.
--
--   * NO BUSINESS ASSIGNMENT. `AuthenticatedPrincipal.authorizedBusinessIds` cannot be answered
--     here anyway: for an organization-scope principal the set is "every Business in its
--     Organization" (tenancy/tenant-context.ts), which is a read of the TENANT database's
--     `business` table — after `TenantStoreResolver`, which is after this step in §C.5's order.
--
--   * NO PROFILE. The registry says the per-tenant view of a user hangs off membership, and it
--     is right, but a display name is organization-structure work with its own contract.
--
-- FREE-TIER IMPACT: ALLOWANCES CONSUMED d1-storage, d1-rows-read, d1-rows-written. Two
-- identifiers and a status word, ~64 bytes plus a primary-key index entry that is a second copy
-- of the same two identifiers — call it ~130 bytes per row. The closed beta at 10 Organizations
-- x 10 principals, with some overlap, is a few hundred rows: under 50 KB. ONE ROW READ PER
-- AUTHENTICATED REQUEST, which is this table's real cost and is charged against the 5,000,000
-- daily row-read allowance rather than the 100,000 write allowance. 2 row-writes per membership
-- change; nothing in this repository makes one. COST: USD 0 / BD 0 per month.

CREATE TABLE IF NOT EXISTS organization_membership (
  principal_id    TEXT NOT NULL REFERENCES principal (principal_id),
  organization_id TEXT NOT NULL REFERENCES organization (organization_id),

  -- 'active' | 'suspended'. A suspended membership is treated identically to no membership at
  -- all: the same argument-free `notFound()`, deliberately collapsed to one branch
  -- (identity/session-resolution.ts, ruling 1). It also collapses a live session to
  -- "organization not selected" on the very next request, which is what makes REVOCATION
  -- IMMEDIATE rather than effective at session expiry.
  status          TEXT NOT NULL CHECK (status IN ('active', 'suspended')),

  created_at      TEXT NOT NULL,          -- RFC 3339, UTC

  PRIMARY KEY (principal_id, organization_id)
);

-- The REFERENCES clauses above are declared, and the adapter does NOT rely on them alone: a
-- membership row pointing at an absent Organization is reported as `internal` rather than
-- silently read as "not a member" (identity/adapters/d1/d1-control-plane-store.ts). Foreign-key
-- enforcement is a runtime setting, and a constraint that may or may not be switched on is not
-- a constraint an authorization decision can rest on.
--
-- A MEMBERSHIP CHANGE IS AN AUDITED OPERATION (.claude/rules/security.md §6: "tenant membership
-- changes"). NOTHING IN THIS REPOSITORY WRITES A ROW HERE, so there is nothing to audit yet —
-- but the slice that adds membership administration must write its audit record into the
-- AFFECTED ORGANIZATION'S tenant-scoped `audit_event` table, not into the control plane. That
-- keeps the trail where the Organization can read its own, and keeps this database free of an
-- append-only log that spans every tenant.
