-- Control-plane migration 0023 — the Organization deletion request, and its retention window.
-- Milestone 2 — Full Organization Administration. `docs/decisions/0043` §6 and §7.
--
-- IT BELONGS TO `DB_CONTROL`. See 0002. Control plane, because it is about the Organization
-- itself: a request that survives the Organization's data cannot live inside it.
--
-- *** NOT APPLIED BY THE AGENT THAT WROTE IT. *** A verified D1 backup first, then the migration,
-- then the deploy. A production action requiring the user's explicit approval, every time
-- (`.claude/rules/security.md` §7).
--
-- ROLLBACK PATH: `DROP TABLE organization_deletion_request`. **It fails SHUT in the useful
-- direction**: dropping the table cancels every scheduled deletion, so no customer data is
-- destroyed by rolling back. What is lost is the record that a customer ASKED — including the
-- audit-relevant fact of who asked and when, which is why the request is also audited into the
-- Organization's own `audit_event` and this table is not the only copy.
-- FORWARD-ONLY and idempotent: `IF NOT EXISTS`.
-- ORDERING: after `0002_organization.sql` and `0001_principal.sql`. No constraint against 0018-0022.
--
-- =============================================================================================
-- THE TWO PERMISSIONS EXIST AND ARE `status: proposed` — THE CAPABILITY DOES NOT
-- =============================================================================================
--
-- `core.organization.request-deletion` (`critical`) and `core.organization.cancel-deletion-request`
-- are both in `permission-catalog.yaml`, both `phase: 2`, both **PROPOSED**. `0043` §6b: they stay
-- proposed until `security-agent` reviews them, and `security.md` §8 says no agent may approve a
-- permission. **Nothing in Core grants either**, and `authorization/roles.ts` asserts at module
-- load that no permission identifier outside its declared universe is granted to any role.
--
-- So this table is the reviewed schema and not a shipped feature, exactly like `0022`.
--
-- =============================================================================================
-- *** WHAT THIS TABLE DELIBERATELY DOES NOT CONTAIN: ANY MECHANISM THAT DELETES ANYTHING. ***
-- =============================================================================================
--
-- There is no trigger, no cascade, and no `ON DELETE` clause anywhere in it. **A row here is a
-- REQUEST and a SCHEDULE. Nothing acts on it.**
--
-- That is deliberate and it is the single most important sentence in this file. A schema that could
-- destroy a tenant's data on a timestamp would be a destructive operation with no approval gate, no
-- audit record, and no human in it — and `security.md` §7 requires the user's explicit approval to
-- *"run migrations against real data, or delete or truncate data"*, every time, never carried
-- forward. **A cascade is exactly a carried-forward approval.**
--
-- Whatever eventually performs a purge is a separate decision with its own record, and the honest
-- state until then is that `scheduled_purge_at` is a date **nothing reads.** Named, because a
-- column called `scheduled_purge_at` reads as a promise that something is scheduled.
--
-- =============================================================================================
-- ONE ROW PER ORGANIZATION, EVER — AND THE PRIMARY KEY IS THE WHOLE ENFORCEMENT
-- =============================================================================================
--
-- `organization_id` alone is the primary key, so an Organization has at most one deletion request
-- at a time. A second `request` while one is `pending` is a `conflict`, not a second row, and the
-- state machine is: `pending -> cancelled` or `pending -> purged`, with a re-request after a
-- cancellation being an UPDATE back to `pending`.
--
-- **THE ALTERNATIVE — A HISTORY TABLE KEYED ON (organization_id, requested_at) — WAS REFUSED, AND
-- IT IS THE ONE A READER WILL PROPOSE.** Two `pending` rows for one Organization would be two
-- schedules with two dates, and the question *"is this Organization scheduled for deletion"* would
-- have two answers whose disagreement nothing detects. **The history belongs in `audit_event`,
-- which is append-only and is where every request and cancellation is recorded anyway** (`0044`
-- §3c). One table answers "what is true now"; the other answers "what happened". Merging them gives
-- a table that answers neither well.
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008)
-- =============================================================================================
--
-- ALLOWANCES: d1-storage, d1-rows-read, d1-rows-written — all negligible.
-- STORAGE: **at most one row per Organization.** Three identifiers and three timestamps, ~200
-- bytes, plus a primary-key entry. Ten Organizations is under 4 KB.
-- WRITES: 2 per request or cancellation — the row and its key. **There is no secondary index**, so
-- a constant starts at 2. The "which Organizations are scheduled" query is a full scan of a table
-- with at most one row per Organization, which is smaller than `organization` itself; an index
-- would cost a write on every request to save a scan of a handful of rows.
-- READS: one row, by key, on any screen that shows the Organization's state.
-- AT THE LIMIT: the request refuses. **A deletion request that cannot be recorded must not be
-- reported as accepted**, which is the same ordering `0044` §3c requires of the audit record.
-- COST: USD 0 / BD 0 per month.

CREATE TABLE IF NOT EXISTS organization_deletion_request (
  organization_id          TEXT NOT NULL REFERENCES organization (organization_id),

  -- 'pending' | 'cancelled' | 'purged'.
  --
  -- 'purged' IS DECLARED AND UNREACHABLE, because nothing purges. It is here so that the day a
  -- purge mechanism is decided, the terminal state already exists and the transition is not
  -- invented alongside the mechanism — and so that a reader can see the intended lifecycle without
  -- concluding from three states that three of them happen.
  status                   TEXT NOT NULL CHECK (
                             status IN ('pending', 'cancelled', 'purged')
                           ),

  requested_at             TEXT NOT NULL,  -- RFC 3339, UTC. The server's clock.
  requested_by_principal_id TEXT NOT NULL REFERENCES principal (principal_id),

  -- The end of the retention window. **NOTHING READS THIS COLUMN.** See the header: there is no
  -- purge mechanism, and a date that nothing acts on must not be described as a schedule.
  --
  -- REQUIRED, WITH NO DEFAULT. `0021`'s reasoning about `expires_at`: a default would be this file
  -- choosing the platform's retention period, which is a customer-facing commitment and a legal
  -- one. The route computes it from the server's clock and a constant Core owns.
  scheduled_purge_at       TEXT NOT NULL,

  -- Set when the request leaves 'pending'. NULL while it is open. One pair for both terminal
  -- states, so `status` is the only thing that says which — `0021`'s `closed_at` reasoning.
  closed_at                TEXT,
  closed_by_principal_id   TEXT REFERENCES principal (principal_id),

  PRIMARY KEY (organization_id)
);
