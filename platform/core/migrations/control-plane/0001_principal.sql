-- Control-plane migration 0001 — the principal table.
--
-- =============================================================================================
-- READ THIS FIRST. THESE MIGRATIONS TARGET A DIFFERENT DATABASE FROM THE ONES ABOVE THEM.
-- =============================================================================================
--
-- `platform/core/migrations/*.sql` (0001 audit_event, 0002 business, 0003 denial_summary) are
-- the PRODUCTION SHARED TENANT-DATA database — database 2 of the ten allocated by
-- `docs/decisions/0006` §0.3. Every table there carries `tenant_id` as the leading column of its
-- primary key, and the storage boundary refuses any spec that so much as names that column.
--
-- `platform/core/migrations/control-plane/*.sql` — this directory — are the PRODUCTION
-- CONTROL-PLANE / TENANT-DIRECTORY database, database 1 of the same ten. It was allocated for
-- exactly this on 2026-09-01 and this is the first schema to use it. **The control plane is not
-- a new database slot; it is the slot that was already reserved.**
--
-- NO TABLE IN THIS DIRECTORY HAS A `tenant_id` COLUMN, AND NONE MAY GAIN ONE. That is
-- `docs/decisions/0014` §C.1 and §C.2: a session is principal-scoped and a membership is a
-- control-plane relationship, because both must be resolved BEFORE an Organization is known. A
-- `tenant_id` here would re-create the circularity §C exists to break — the registry entry that
-- declared `Session` tenant-scoped is circular precisely because reading it would require the
-- tenant it is read to discover.
--
-- The two schemas therefore share no column convention, no compiler, and no adapter:
-- `platform/core/identity/adapters/d1/d1-control-plane-store.ts` hand-writes its eight
-- statements and must never import `storage/adapters/sql/sql-compiler.ts`, which emits
-- `tenant_id = ?` on everything it produces.
--
-- =============================================================================================
-- §C.7: THE SEPARATE DATABASE IS AN ISOLATION BOUNDARY, NOT ADDITIONAL QUOTA.
-- =============================================================================================
--
-- D1's daily row-read and row-write limits are ACCOUNT-WIDE. Splitting identity out of the
-- tenant database changes what can reach what; it raises no ceiling by one row. Every write to
-- these tables is charged against the same daily budget as a Customer create, through
-- `platform/core/identity/control-plane-admission.ts`. Any design that assumes otherwise is
-- wrong about the constraint.
--
-- =============================================================================================
-- NOT APPLIED. There is no migration runner (CLOUDFLARE_STANDARD.md CF5 — "no package is
-- approved, so migrations have no runner"), and no agent may run a migration against real data
-- (.claude/rules/security.md §7). These files are reviewed definitions, not a deployment.
--
-- ROLLBACK PATH (CLOUDFLARE_STANDARD.md §4 rule 10), stated rather than implied:
-- DROP TABLE principal. Safe only while the table is empty. Once principals exist, dropping it
-- orphans every session and every membership and locks every user out of the platform; from
-- that point every migration touching it must be additive.
--
-- FORWARD-ONLY and idempotent, so a partially-completed run is re-runnable (§4 rule 11).
-- =============================================================================================
--
-- WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR, and the omissions are the security design:
--
--   * NO CREDENTIAL MATERIAL. No password hash, no token, no key, no MFA secret.
--     `core-object-registry.yaml` holds `AuthCredential` and `MfaFactor` as separate objects,
--     and `docs/decisions/0014` explicitly does not settle the identity provider or the
--     credential format. A credential column added here would settle it in a migration.
--
--   * NO EMAIL ADDRESS, NAME, PHONE NUMBER OR LOCALE. This is the one table in the platform
--     that spans every Organization. A directory of every user's personal details, readable
--     without any tenant scope, would be the highest-value target in the system and it would
--     exist for the convenience of a login form. `core-object-registry.yaml` already rules on
--     where that data belongs: "everything ABOUT a user within a tenant hangs off
--     OrganizationMembership".
--
--   * NO LIST OF ORGANIZATIONS. A principal's Organizations are rows in
--     `organization_membership`, never a column here. Registry open question CO1 — "a user's
--     list of Organizations must never be visible to any of them" — is answerable only while
--     that list is a relationship that has to be queried deliberately.
--
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008).
--   ALLOWANCES CONSUMED: d1-storage; d1-rows-read; d1-rows-written.
--   STORAGE: two short identifiers and a status word, ~64 bytes per row plus a primary-key
--   index entry of similar size. The closed beta is at most 10 Organizations
--   (MULTITENANCY_STANDARD.md §7.5); at 10 principals each that is 100 rows, ~13 KB. Against
--   the 500 MB per-database ceiling this is not a measurable term.
--   ROWS READ: one point lookup per authenticated request.
--   ROWS WRITTEN: 2 per principal created (PRINCIPAL_ROW_WRITES). Nothing in this repository
--   creates one — registration is not built in this slice.
--   AT THE LIMIT: nothing to degrade; this table has no growth term of its own.
--   COST: USD 0 / BD 0 per month. No new service and no new database slot.

CREATE TABLE IF NOT EXISTS principal (
  -- Opaque, non-sequential, unguessable: 128 bits of base64url from the platform CSPRNG
  -- (platform/core/kernel/ids.ts). Platform-wide unique by generation, not by tenant.
  principal_id    TEXT NOT NULL PRIMARY KEY,

  -- 'user' | 'team' | 'service-account' | 'ai-agent' | 'iot-device'.
  -- The same union as AuthenticatedPrincipal.principalType (tenancy/tenant-context.ts). The
  -- CHECK is the write-side half of the guarantee; the adapter validates on read as well and
  -- returns `internal` for an unrecognised value rather than coercing it to a default, because
  -- coercing upward would be privilege escalation by schema drift and coercing downward would
  -- hide the drift.
  principal_type  TEXT NOT NULL CHECK (
    principal_type IN ('user', 'team', 'service-account', 'ai-agent', 'iot-device')
  ),

  -- 'active' | 'suspended'. A suspended principal authenticates to nothing: the resolver
  -- returns the same argument-free `unauthenticated()` it returns for a session that never
  -- existed (identity/session-resolution.ts).
  status          TEXT NOT NULL CHECK (status IN ('active', 'suspended')),

  created_at      TEXT NOT NULL           -- RFC 3339, UTC
);

-- NO SECONDARY INDEX, and it is not an omission. There is exactly one query against this table
-- in the repository —
--
--   SELECT principal_id, principal_type, status FROM principal WHERE principal_id = ? LIMIT 1
--
-- — a point lookup on the full primary key, served from the automatic index the PRIMARY KEY
-- already creates. A second index would duplicate that b-tree and cost a row-write on every
-- insert (CLOUDFLARE_STANDARD.md §4 rule 4 is satisfied, not waived).
--
-- There is deliberately no "find principal by email" index, because there is no email column.
-- The lookup that a login needs — credential to principal — belongs to the identity provider,
-- which is not decided. When it is, whatever it adds must be reviewed against the two omissions
-- above and against this file's row-write cost.
