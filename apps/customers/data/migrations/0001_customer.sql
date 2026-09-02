-- Customer Directory migration 0001 — the customer table.
--
-- App: customers. Entity: Customer, as declared in
-- packages/contracts/apps/customers/manifest.json.
--
-- NOT APPLIED. There is no migration runner (CLOUDFLARE_STANDARD.md CF5), and no agent may
-- run a migration against real data (.claude/rules/security.md §7). This is the reviewed
-- definition, not a deployment.
--
-- ROLLBACK PATH, required by CLOUDFLARE_STANDARD.md §4 rule 10 and by the manifest's
-- rollbackSupported: true. This is the App's first migration with no predecessor, so the
-- rollback is DROP TABLE customer, and it is safe only while the table is empty. Once a
-- tenant has customers in it, dropping the table destroys tenant data and is not a
-- rollback — it is the thing docs/decisions/0006 §0.4 forbids. Every later migration must
-- be additive.
--
-- FORWARD-ONLY, and designed to run across N databases with partial-failure handling
-- (§4 rule 11). N is 1 today under docs/decisions/0006 Option A. Every statement is
-- idempotent, so a partially-completed run is re-runnable.
--
-- ============================================================================
-- TENANCY. Under docs/decisions/0006 Option A every Organization's rows are in this one
-- table. tenant_id is therefore the only thing separating them, it is the leading column of
-- the primary key and of every index, and it is written and filtered exclusively by the
-- storage boundary (platform/core/storage/store.ts). No App code names it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer (
  tenant_id                   TEXT NOT NULL,
  customer_id                 TEXT NOT NULL,

  -- An authorization scope INSIDE the Organization, never a second isolation boundary and
  -- never a substitute for tenant_id. Business identifiers are unique platform-wide, so a
  -- query carrying business_id that has lost tenant_id does not fail and does not return
  -- empty -- it returns another Organization's customer.
  business_id                 TEXT NOT NULL,

  display_name                TEXT NOT NULL,
  -- The normalised display name with a single leading space. Serves the fixed sort order
  -- AND token-prefix matching: "term is a prefix of some whitespace-delimited token" is
  -- exactly "this column contains ' ' || term", because normalisation has already collapsed
  -- whitespace runs and trimmed the ends. A uniform leading space does not change the
  -- ordering, so one column serves both and no second index is needed.
  display_name_key            TEXT NOT NULL,

  customer_type               TEXT NOT NULL,

  email                       TEXT,
  email_key                   TEXT,        -- normalised; prefix-matched

  phone                       TEXT,
  phone_key                   TEXT,        -- digits only, REVERSED, so suffix -> prefix

  country                     TEXT,
  address                     TEXT,        -- sensitive-personal; never searched
  notes                       TEXT,        -- sensitive-personal; never searched, never listed

  -- 'active' | 'archived' | 'pending_deletion'. Server-controlled: it moves only through
  -- the lifecycle Actions, which is what makes every transition permissioned and audited.
  -- Nothing in this slice can write 'pending_deletion' -- DeleteCustomer is out of scope
  -- (contract §11.1) -- and the value exists now because adding a lifecycle state after a
  -- client ships is breaking.
  status                      TEXT NOT NULL,

  -- Non-null IF AND ONLY IF status is 'pending_deletion'; null in every other state,
  -- INCLUDING 'archived'. An archived record has no scheduled deletion: archive is not a
  -- countdown, and a value here would restate a countdown the retention decision removed.
  -- Null on every row this slice can write.
  deletion_scheduled_at       TEXT,

  created_at                  TEXT NOT NULL,
  created_by_principal_id     TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  updated_by_principal_id     TEXT NOT NULL,

  PRIMARY KEY (tenant_id, customer_id),

  CHECK (customer_type IN ('person', 'company')),
  CHECK (status IN ('active', 'archived', 'pending_deletion')),

  -- The invariant, enforced by the engine rather than by every write path remembering it.
  -- It is the one the retention decision turns on, and it is cheap to state here.
  CHECK (
    (status = 'pending_deletion' AND deletion_scheduled_at IS NOT NULL)
    OR (status <> 'pending_deletion' AND deletion_scheduled_at IS NULL)
  )
);

-- ============================================================================
-- THE ACCESS PATH. EXACTLY ONE INDEX, because exactly one is what the contract's free-tier
-- analysis budgeted: "(organization_id, business_id, display_name, customer_id) to be
-- servable without a scan -- the tenant predicate first, the business predicate second,
-- then the fixed sort order".
--
-- ONE COLUMN IS ADDED TO THAT SHAPE, AND IT IS DELIBERATE. `status` sits between
-- business_id and display_name_key, because EVERY listing and EVERY search in this contract
-- filters by status -- the default is `active`, and `all` is an IN over three values. An
-- index without it makes the default directory view a scan of the Business, and a second
-- index for the status case would cost the free-tier allowance the contract budgeted for
-- one. This is the same single index, one column wider.
--
-- The column order is the evaluation order and is not interchangeable. tenant_id leads
-- because every query narrows by it; business_id follows because every query narrows by the
-- caller's authorized set; status next; then display_name_key and customer_id, which give
-- the fixed total order that makes cursor pagination correct.
--
-- BINARY collation, deliberately: SQLite's default compares UTF-8 bytes, which for UTF-8 is
-- code-point order -- the order the contract specifies. Adding COLLATE NOCASE here would
-- silently change both the sort order and which page a cursor lands on.
--
-- Point lookups by customer_id -- GetCustomer, every mutation, and the cursor's anchor
-- resolution -- are served by the primary key (tenant_id, customer_id) and need nothing
-- further.
--
-- Email and phone matching is served as a FILTER over this index's tenant+business+status
-- range rather than by indexes of its own. The scan is bounded to one Organization's slice,
-- which is what MULTITENANCY_STANDARD.md §7.7 asks for; it is NOT bounded to a small
-- constant, and that is stated rather than implied. At the contract's projection of 5,000
-- customers per Organization it is a few thousand index entries per search. If a directory
-- ever grows past that, the fix is an index on (tenant_id, business_id, email_key) and
-- (tenant_id, business_id, phone_key) -- which is a free-tier decision, not a patch.
-- ============================================================================

CREATE INDEX IF NOT EXISTS customer_by_tenant_business_status_name
  ON customer (tenant_id, business_id, status, display_name_key, customer_id);
