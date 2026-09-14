-- Core migration 0004 — the branch table. TENANT-SCOPED.
-- Milestone 2 — Full Organization Administration. `docs/decisions/0043` §7.
--
-- Core object: Branch (`packages/contracts/registries/core-object-registry.yaml`, domain
-- `organization`). Read `0002_business.sql` first — this table is its sibling one level down and
-- copies its shape, its tenancy rule and its restraint.
--
-- *** IT IS TENANT-SCOPED AND THEREFORE NOT A CONTROL-PLANE TABLE, WHICH IS THE OPPOSITE OF THE
-- OTHER MILESTONE 2 TABLES. *** Business is tenant-scoped (`0002`), a Branch belongs to a Business,
-- and the question a Branch answers — *"does this Branch exist in this tenant"* — is answerable
-- only with a tenant handle. `organization_membership`, `invitation` and the role tables are
-- control plane because their questions span tenants or precede tenant selection (`0014` §C.2).
-- **Getting this wrong in either direction is not a filing error**: a control-plane Branch table
-- would be a cross-tenant list of every customer's sites, and a tenant-scoped membership table
-- would be unreadable at login.
--
-- NOT APPLIED. There is no migration runner, and no agent may run a migration against real data
-- (`.claude/rules/security.md` §7). Applying it is a production action requiring the user's
-- explicit approval, every time. This file is the reviewed definition, not a deployment.
-- ROLLBACK PATH: `DROP TABLE branch`. Safe only while empty; once Branches exist, dropping it
-- destroys customer data with no other copy.
-- FORWARD-ONLY and idempotent: `IF NOT EXISTS`.
-- ORDERING: after `0002_business.sql`. No other constraint.
--
-- =============================================================================================
-- SCOPE — THE MINIMUM THAT MAKES A BRANCH ADDRESSABLE, AND `0002`'s RESTRAINT COPIED DELIBERATELY
-- =============================================================================================
--
-- `0002` declined a Business NAME, a status, a parent and settings, on the ground that *"each of
-- those is a decision about Core's identity and organization data model, none of them is settled by
-- any contract, and adding one here would be deciding Core's shape as a side effect of unblocking
-- an App."*
--
-- **THAT ARGUMENT IS WEAKER HERE AND IS STILL FOLLOWED, WHICH IS WORTH BEING EXPLICIT ABOUT.**
-- Milestone 2 IS the organization-structure work, so the slice that `0002` deferred to is the one
-- writing this file — the reason for restraint is no longer *"this is somebody else's decision"*.
-- The reason it is followed anyway is narrower and holds: **`architecture-agent` has not authored
-- the Branch contract**, `architecture.md` §1 says a needed contract is REQUESTED AND WAITED FOR
-- rather than guessed at, and a column added here is a shape a contract then has to match.
--
-- So: no name, no address, no status, no manager, no opening hours, no code. **A Branch identifier,
-- the Business it belongs to, and the tenant.** Everything else is an additive `ALTER TABLE` when
-- the contract lands, and every one of those columns is cheaper to add than to remove.
--
-- =============================================================================================
-- THE COMPOSITE FOREIGN KEY IS THE TENANCY PROPERTY, NOT A TIDINESS ONE
-- =============================================================================================
--
-- `REFERENCES business (tenant_id, business_id)` names BOTH columns. A reference on `business_id`
-- alone would permit a Branch in tenant A to point at a Business in tenant B — a cross-tenant edge
-- inside a single row, which `security.md` §1 calls a critical defect and which no query-time
-- predicate would notice, because both rows would be perfectly well-formed.
--
-- **AND IT IS NOT THE ENFORCEMENT.** `0003_organization_membership.sql` records why: *"foreign-key
-- enforcement is a runtime setting, and a constraint that may or may not be switched on is not a
-- constraint an authorization decision can rest on."* What enforces it is the tenant predicate the
-- storage boundary applies from the resolved handle (`storage/store.ts`), which a Branch query
-- carries exactly as a Business query does. The FK is a second layer that costs nothing.
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008)
-- =============================================================================================
--
-- ALLOWANCES: d1-storage, d1-rows-read, d1-rows-written.
-- STORAGE: three identifiers and a primary-key entry that is a second copy of two of them — call
-- it ~130 bytes per row. A closed beta at 10 Organizations with a handful of Branches each is
-- under 10 KB against a 500 MB per-database ceiling.
-- WRITES: 2 per Branch — the row and its primary key. **There is no secondary index**, so a
-- `BRANCH_ROW_WRITES` constant, when one is declared, starts at 2 and moves the day one is added.
-- READS: one row per lookup by key; a Business's Branch list is a bounded prefix scan on the
-- primary key, which is why no secondary index is needed for it.
-- AT THE LIMIT: nothing to degrade — Branch creation refuses rather than degrading, like every
-- other control-plane-adjacent write.
-- COST: USD 0 / BD 0 per month.

CREATE TABLE IF NOT EXISTS branch (
  -- The Organization. Set by the storage boundary from the resolved handle, NEVER by a caller —
  -- `0002`'s rule verbatim, because a second table applying it differently is how the boundary
  -- stops being a boundary.
  tenant_id   TEXT NOT NULL,

  -- The Business this Branch belongs to. An authorization scope, not an isolation boundary
  -- (`0002`), so a Branch narrows within a tenant and never across one.
  business_id TEXT NOT NULL,

  -- The Branch identifier. Opaque, non-sequential, unguessable, 128 bits of base64url
  -- (`platform/core/kernel/ids.ts`).
  branch_id   TEXT NOT NULL,

  created_at  TEXT NOT NULL,          -- RFC 3339, UTC. The server's clock, never a request value.

  PRIMARY KEY (tenant_id, business_id, branch_id),

  -- BOTH COLUMNS. See the header: a single-column reference would permit a cross-tenant edge.
  FOREIGN KEY (tenant_id, business_id) REFERENCES business (tenant_id, business_id)
);

-- THE KEY ORDER SERVES THE TWO REAL ACCESS PATHS FROM ONE B-TREE, which is `0003`'s reasoning
-- applied one level down:
--
--   the full key                      -> "does this Branch exist in this tenant", the point lookup
--   the (tenant_id, business_id) prefix -> "the Branches of this Business", a bounded scan
--
-- **THERE IS NO PATH FROM A KEY PREFIX TO ANOTHER TENANT'S ROWS**, because `tenant_id` is the
-- leading column and the storage boundary supplies it. That is the opposite of `0003`'s hazard,
-- where the leading column is a PRINCIPAL and a prefix scan is the cross-Organization list `CO1`
-- forbids. Stated because the two tables look alike and their prefix scans do not.
--
-- THERE IS NO GLOBAL UNIQUE CONSTRAINT ON `branch_id`, for `0002`'s two reasons unchanged:
-- uniqueness has never been what makes a row unreachable, and a global constraint would make the
-- isolation suite's fixture — the same identifier value in two Organizations — unconstructible, so
-- the test would pass because the world it detects could no longer be built.
