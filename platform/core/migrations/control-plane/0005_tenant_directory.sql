-- Control-plane migration 0005 — the tenant directory.
--
-- Read `0001_principal.sql` first for the shared header of this directory.
--
-- Core object: `TenantDirectoryEntry` (packages/contracts/registries/core-object-registry.yaml,
-- domain `tenancy`, tenancy `tenant-independent`, status `proposed`, phase 1). Unlike `Session`
-- and `OrganizationMembership`, THIS REGISTRY ENTRY IS CORRECT: it is already recorded as
-- tenant-independent, and its `requiredBy` note points at `docs/decisions/0006` §0.2, which is
-- Accepted. This table is the persistent form the registry describes.
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
-- ROLLBACK PATH: DROP TABLE tenant_directory. Safe only while empty. Once it holds mappings,
-- dropping it makes every Organization's data unreachable — `TenantStoreResolver` fails closed
-- with `unavailable()` for everyone, which is the correct behaviour and a total outage.
-- FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- WHAT IT IS FOR — docs/decisions/0006 §0.2, and the note `tenant-store-resolver.ts` has been
-- carrying since it was written
-- =============================================================================================
--
-- `tenancy/tenant-store-resolver.ts` says: "`TenantDirectoryEntry` is the persistent form of
-- this mapping and is tenant-INDEPENDENT platform data, so it belongs in the control-plane
-- database rather than the shared tenant database. That database and its schema are Core's
-- identity/tenancy slice and are not in this slice's scope." `docs/decisions/0014` §C.3 is that
-- slice, this table is that schema, and `tenancy/directory-tenant-store-resolver.ts` is the
-- resolver that reads it.
--
-- Every clause of §0.2 is implemented against this table:
--
--   * "Apps, plugins, Connectors, and clients cannot select a database or a binding." There is
--     no parameter, header, manifest field or SDK call that reaches this table. Its only reader
--     is `TenantDirectoryStore`, a SEPARATE INTERFACE from the identity half precisely so that
--     the component holding it can read nothing else (identity/control-plane-store.ts).
--   * "Unknown Organization mappings fail closed." No row, a row that is not `active`, a row
--     naming an unconfigured binding, and an unreadable directory all return the same
--     `unavailable()` and never a handle.
--   * "The resolver returns only bindings configured and approved by Core." `binding_name` is
--     looked up in a map the composition root built. A name that is not in it yields no handle.
--   * "Moving from A to C must not change business-domain code or public contracts." Under
--     Option A every row here names the same binding. When that stops being true, the rows
--     change and no code does.
--
-- =============================================================================================
-- WHY A BINDING NAME AND NOT A CONNECTION STRING, A URL, OR AN ACCOUNT IDENTIFIER
-- =============================================================================================
--
-- `docs/decisions/0003` approves bindings and forbids the Cloudflare REST API, and
-- `CLOUDFLARE_STANDARD.md` §9 names bindings for the port they serve rather than the vendor
-- product — `DB_PLATFORM`, not `MY_D1`. A binding name is a LOGICAL name that the composition
-- root resolves to a binding it already holds; it is not a credential, not an endpoint, and
-- carries nothing that would be a secret if this table were read. That matters because both
-- repositories are public and because a directory of connection strings is a directory of ways
-- in.
--
-- FREE-TIER IMPACT: ALLOWANCES CONSUMED d1-storage, d1-rows-read, d1-rows-written. One row per
-- Organization, ~100 bytes plus a primary-key index entry — at most 10 rows in the closed beta,
-- about 2 KB. ONE POINT READ PER AUTHENTICATED REQUEST, charged against the 5,000,000 daily
-- row-read allowance rather than the 100,000 write allowance; deliberately uncached, because a
-- stale tenant-to-binding mapping serves one Organization from another's database
-- (tenancy/directory-tenant-store-resolver.ts). 2 row-writes per Organization onboarded;
-- nothing in this repository writes one. COST: USD 0 / BD 0 per month.

CREATE TABLE IF NOT EXISTS tenant_directory (
  organization_id TEXT NOT NULL PRIMARY KEY REFERENCES organization (organization_id),

  -- The Core-configured logical binding name. Not a connection string; see above.
  binding_name    TEXT NOT NULL,

  -- 'active' | 'suspended' | 'migrating'. Matches `TenantStoreMappingState`
  -- (tenancy/tenant-store-resolver.ts). Anything other than 'active' yields no handle, and the
  -- three failing states are deliberately indistinguishable to a caller: a member of the
  -- Organization must not be able to tell "suspended" from "mid-migration", and no one else can
  -- reach this lookup at all.
  state           TEXT NOT NULL CHECK (state IN ('active', 'suspended', 'migrating')),

  created_at      TEXT NOT NULL           -- RFC 3339, UTC
);

-- NO SECONDARY INDEX. The single query is a point lookup on the full primary key.
--
-- There is deliberately no index on `binding_name`, which would serve "which Organizations live
-- on this database" — an operational question that is real under Option C and does not exist
-- under Option A, where the answer is "all of them". Add it with the slice that introduces a
-- second binding, not before.
