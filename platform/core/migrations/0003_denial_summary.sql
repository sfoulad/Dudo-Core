-- Core migration 0003 — the bounded denial summary table.
--
-- docs/decisions/0013-bounded-denial-auditing-and-rate-limits.md, Accepted, user decision of
-- 2026-09-02. Per-attempt D1 audit writes for DENIALS are replaced by bounded aggregation;
-- this is where the aggregate lands.
--
-- NOT APPLIED. There is no migration runner (CLOUDFLARE_STANDARD.md CF5 — "no package is
-- approved, so migrations have no runner"), and no agent may run a migration against real
-- data (.claude/rules/security.md §7). This file is the reviewed definition, not a
-- deployment.
--
-- ROLLBACK PATH, required by CLOUDFLARE_STANDARD.md §4 rule 10 and stated rather than
-- implied: DROP TABLE denial_summary. Safe only while nothing has been written. Once the
-- table holds records it has no rollback, for the same reason audit_event does not: it is
-- security evidence, and rolling it back destroys what it exists to preserve. Any later
-- migration that touches it must be additive.
--
-- FORWARD-ONLY and idempotent, so a partially-completed run across N databases is
-- re-runnable (§4 rule 11). N is 1 today under docs/decisions/0006 Option A.
--
-- =============================================================================================
-- WHY THIS IS A SECOND TABLE AND NOT MORE COLUMNS ON audit_event
-- =============================================================================================
--
-- audit_event means ONE ROW PER EVENT, and everything built on it depends on that:
-- audit_event_by_tenant_target answers "what happened to this record",
-- target_resource_id is the identifier of the single record the single event touched, and the
-- oracle comparison compares two whole rows field for field. A summary is one row per
-- (actor, Action, category, 15-minute window) carrying a COUNT and NO target identifier.
-- Folding the two together would either make "one row is one event" false for every existing
-- reader, or drop the count, which is the entire content of a summary.
--
-- =============================================================================================
-- WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR
-- =============================================================================================
--
--   * THE REQUESTED RESOURCE IDENTIFIER. 0013 control 5 keeps it out of the grouping, because
--     an attacker controls that value and would mint unlimited groups — which would restore
--     per-attempt writes under another name and undo the whole decision while appearing
--     implemented. Having no column for it is how that stays true when someone later wants
--     "just a bit more detail".
--   * ANY FIELD VALUE from any record. Same rule as audit_event: identifiers and decisions,
--     never business data.
--   * ANYTHING THAT DISTINGUISHES "EXISTS IN ANOTHER ORGANIZATION" FROM "EXISTS NOWHERE".
--     denial_reason is the Core-wide taxonomy token, and both conditions are `not_found`.
--     SECURITY_STANDARD.md §6 lets a tenant read its own audit trail, so a column that split
--     them would hand a probing campaign, in writing, the existence fact the not_found
--     withheld.
--
-- =============================================================================================
-- APPEND-ONLY, WHICH IS WHY A WINDOW CAN HAVE MORE THAN ONE ROW
-- =============================================================================================
--
-- The count for an open window grows, and this log is append-only: "an append-only log that
-- application code edits is neither append-only nor a log" (platform/core/audit/audit.ts).
-- So the coordinator APPENDS a progress row at each point on its emission ladder
-- (1, 10, 100, 1,000, 10,000 attempts) and a final row when the window closes.
--
--   The summary for a window is the row with window_closed = 1.
--   While the window is still open it is the row with the highest attempt_count.
--
-- The first attempt of a window emits immediately, on purpose: a close-only design would
-- record NOTHING for a campaign that ran for ten minutes and then stopped, which is the same
-- silence the control was created to end.
--
-- COST, and it is the number every ceiling is computed against: at most six rows per group per
-- 15-minute window. NOT one. The design bounds the writes; it does not reduce them to one.

CREATE TABLE IF NOT EXISTS denial_summary (
  -- The tenant. Set by the storage boundary from the resolved handle, never by a caller.
  tenant_id                   TEXT NOT NULL,

  -- Derived from the grouping, the window and the emission sequence — never random. A replayed
  -- write therefore collides on the primary key and is rejected, rather than quietly doubling a
  -- campaign's apparent size.
  denial_summary_id           TEXT NOT NULL,
  emission_sequence           INTEGER NOT NULL,

  window_start_at             TEXT NOT NULL,           -- RFC 3339, UTC. 15-minute boundary
  first_attempt_at            TEXT NOT NULL,
  last_attempt_at             TEXT NOT NULL,
  attempt_count               INTEGER NOT NULL,
  window_closed               INTEGER NOT NULL DEFAULT 0,

  -- The grouping (0013 control 3), minus the Organization, which is tenant_id above.
  app_id                      TEXT NOT NULL,
  action_id                   TEXT NOT NULL,
  principal_id                TEXT NOT NULL,
  denial_reason               TEXT NOT NULL,           -- the Core-wide taxonomy token

  -- The permission and scope the Action declares, which is what the authorizer evaluates on
  -- every branch today (AUTHORIZATION_STANDARD.md §11). Taken from the Action definition
  -- rather than the decision so the columns are also populated on the denial paths that
  -- happen BEFORE authorization runs — a rate-limit refusal is one.
  permission_id               TEXT NOT NULL,
  scope                       TEXT NOT NULL,

  -- THE ACTOR'S OWN authorized Business set. The caller's data about itself. There is no
  -- column for the target's Business, deliberately: naming the Business a caller was refused
  -- would hand a log reader the disclosure the refusal withheld.
  actor_business_ids          TEXT NOT NULL DEFAULT '[]',

  PRIMARY KEY (tenant_id, denial_summary_id)
);

-- The access path for SECURITY ALERTING: "how many denials has this actor produced in this
-- window". Answered entirely from the index, so no row body is read — an alerting job that
-- reads audit bodies is a second, weaker access path to the audit trail, and on a
-- single-threaded database a scheduled scan is every Organization's latency.
CREATE INDEX IF NOT EXISTS denial_summary_by_tenant_principal_window
  ON denial_summary (tenant_id, principal_id, window_start_at DESC, denial_reason);

-- The access path for "show me this Organization's denial activity, newest first", which is
-- the query an investigator runs after an alert fires.
CREATE INDEX IF NOT EXISTS denial_summary_by_tenant_window
  ON denial_summary (tenant_id, window_start_at DESC, action_id);
