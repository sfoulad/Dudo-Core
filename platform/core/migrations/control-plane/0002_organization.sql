-- Control-plane migration 0002 — the organization table.
--
-- Read `0001_principal.sql` first: it holds the shared header for this directory — which
-- database these migrations target, why no table here has `tenant_id`, and why a separate
-- database is an isolation boundary and not extra quota (docs/decisions/0014 §C.7).
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
-- ROLLBACK PATH: DROP TABLE organization. Safe only while empty; once Organizations exist,
-- dropping it invalidates every membership and every tenant-directory entry at once.
-- FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- SCOPE. THIS IS NOT THE ORGANIZATION-STRUCTURE SLICE, AND IT MUST NOT GROW INTO ONE.
-- =============================================================================================
--
-- It exists for exactly one reason: `docs/decisions/0014` §C.6 requires a caller-supplied
-- Organization to be validated against membership, and validation needs somewhere to record
-- that an Organization is active rather than suspended. That is the whole of the question this
-- table answers.
--
-- So there is deliberately NO NAME, no legal entity, no country, no currency, no plan, no
-- billing reference, no owner, no settings, and no branding. Each of those is a decision about
-- Core's organization data model, none of them is settled by any contract, and adding one here
-- would be deciding Core's shape as a side effect of unblocking a login. This follows
-- `platform/core/migrations/0002_business.sql` exactly, which declined a Business name on the
-- same grounds; every one of them is an ADDITIVE change when the organization-structure slice
-- lands with its own contract.
--
-- THE CONSEQUENCE IS REAL AND IS REPORTED RATHER THAN HIDDEN: an Organization picker built on
-- this schema can list identifiers and cannot show names. A 22-character opaque identifier is
-- not a usable choice for a human. The picker is therefore not shippable until the
-- organization-structure slice supplies a display name, and that is a product dependency, not
-- an oversight in this file.
--
-- =============================================================================================
-- WHY THIS TABLE IS NOT AN EXISTENCE ORACLE
-- =============================================================================================
--
-- A platform-wide table of every Organization, queryable by identifier, is exactly the shape of
-- an existence oracle: ask about an identifier, learn whether that Organization exists anywhere
-- in Dudo. `0014` §C.6 forbids that, and it is closed by ACCESS PATH rather than by schema.
--
-- There is ONE query against this table in the whole repository, and it lives inside
-- `findMembershipWithOrganization` (identity/adapters/d1/d1-control-plane-store.ts). That
-- function queries `organization_membership` FIRST and returns without touching this table when
-- there is no membership row. So a caller naming an Organization it does not belong to and a
-- caller naming one that does not exist produce the same answer, from the same one statement,
-- against the same one table, having never read a row here.
--
-- THERE IS NO OTHER PORT METHOD THAT REACHES THIS TABLE. `IdentityControlPlaneStore` exposes no
-- `findOrganization`, and adding one would open the oracle in a single line — which is why the
-- port is a fixed list of named questions instead of a general store
-- (identity/control-plane-store.ts, property 1).
--
-- FREE-TIER IMPACT: ALLOWANCES CONSUMED d1-storage, d1-rows-read, d1-rows-written. At most 10
-- rows in the closed beta (MULTITENANCY_STANDARD.md §7.5), ~64 bytes each plus a primary-key
-- index entry — under a kilobyte in total. One row read per successful membership validation,
-- and zero on the failing path. 2 row-writes per Organization created; nothing in this
-- repository creates one. COST: USD 0 / BD 0 per month.

CREATE TABLE IF NOT EXISTS organization (
  -- The tenant identifier. This is the same value that appears as `tenant_id` on every row of
  -- the tenant-data database and as `organizationId` on `AuthenticatedPrincipal`.
  -- MULTITENANCY_STANDARD.md §2: Organization and tenant are "the same thing in two
  -- vocabularies". The physical column is named for the domain object here because the
  -- control plane has no tenant scope of its own to confuse it with.
  organization_id TEXT NOT NULL PRIMARY KEY,

  -- 'active' | 'suspended'. A suspended Organization resolves to `unavailable()` for its own
  -- members and remains invisible to everyone else, because everyone else never gets past the
  -- membership check (identity/session-resolution.ts, ruling 1).
  status          TEXT NOT NULL CHECK (status IN ('active', 'suspended')),

  created_at      TEXT NOT NULL           -- RFC 3339, UTC
);

-- NO SECONDARY INDEX. The single query is a point lookup on the full primary key, served from
-- the automatic index the PRIMARY KEY creates.
