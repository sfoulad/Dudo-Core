-- Core migration 0001 — the audit event table.
--
-- Core object: AuditEvent (packages/contracts/registries/core-object-registry.yaml),
-- tenant-scoped. AUTHORIZATION_STANDARD.md §11 fixes the fields; SECURITY_STANDARD.md §6
-- makes the log append-only.
--
-- NOT APPLIED. There is no migration runner (CLOUDFLARE_STANDARD.md CF5 — "no package is
-- approved, so migrations have no runner"), and no agent may run a migration against real
-- data (.claude/rules/security.md §7). This file is the reviewed definition, not a
-- deployment.
--
-- AMENDED 2026-09-02, IN PLACE, adding audit_event_by_tenant_principal_decision_time. Editing
-- 0001 rather than adding 0002 is correct ONLY because this migration has never run anywhere:
-- there is no database holding the old shape, so there is no schema drift to reconcile and no
-- environment on which a 0002 would land. From the first time it is applied, the additive-only
-- rule below takes over and this file is frozen.
--
-- ROLLBACK PATH, required by CLOUDFLARE_STANDARD.md §4 rule 10 and stated rather than
-- implied: DROP TABLE audit_event. It is safe only because nothing has been written yet.
-- Once the table holds records, it has no rollback: an append-only audit log cannot be
-- rolled back without destroying the evidence it exists to preserve. Any later migration
-- that touches it must be additive.
--
-- FORWARD-ONLY, and designed to run across N databases with partial-failure handling
-- (§4 rule 11). N is 1 today under docs/decisions/0006 Option A; this statement is
-- idempotent, so a partially-completed run is re-runnable.
--
-- WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR: a field value, a diff, a payload, a
-- free-text message, or a record's business data of any kind. Audit carries identifiers
-- and decisions. A column added here for "readability" is a second copy of the business
-- data with different access rules, and it is the one a customer-data purge cannot reach.

CREATE TABLE IF NOT EXISTS audit_event (
  -- The tenant. Set by the storage boundary from the resolved handle, never by a caller.
  tenant_id                   TEXT NOT NULL,
  audit_event_id              TEXT NOT NULL,

  occurred_at                 TEXT NOT NULL,           -- RFC 3339, UTC

  app_id                      TEXT NOT NULL,
  action_id                   TEXT NOT NULL,

  principal_id                TEXT NOT NULL,
  principal_type              TEXT NOT NULL,
  on_behalf_of_principal_id   TEXT,

  -- The permission and scope ACTUALLY EVALUATED. Recording what was evaluated rather than
  -- what was requested is what lets an audit trail show a scope checked at the wrong level.
  permission_id               TEXT NOT NULL,
  scope                       TEXT NOT NULL,

  decision                    TEXT NOT NULL,           -- 'allowed' | 'denied'
  denial_reason               TEXT,                    -- a taxonomy code, never a sentence

  -- Opaque identifier of the record acted on. For a not_found on a mutating Action this is
  -- the identifier AS SUPPLIED BY THE CALLER with target_unresolved = 1 (contract CD-5).
  target_resource_id          TEXT,
  target_unresolved           INTEGER NOT NULL DEFAULT 0,

  -- JSON array of Business identifiers inside the caller's own tenant. Empty for a
  -- wrong-Business denial: naming the Business the caller was refused would hand to a log
  -- reader the disclosure the refusal withheld.
  related_business_ids        TEXT NOT NULL DEFAULT '[]',

  -- THE ACTOR'S OWN authorized Business set at the time of the attempt (D2 requirement 2:
  -- "actor Organization/business context"). The Organization half is tenant_id above.
  --
  -- READ THIS COLUMN AND related_business_ids AS A PAIR; THEY ARE NOT THE SAME THING AND
  -- CONFUSING THEM IS A DISCLOSURE. related_business_ids describes the RECORD and is empty on
  -- every denial. This column describes the CALLER — data the tenant already holds about
  -- itself — and is populated on denials and successes alike. A denial record therefore says
  -- which Businesses the actor could see, and never which Business it was refused.
  --
  -- It is derived from the authenticated principal before any record is resolved, through the
  -- only constructor that exists for it, and the storage sink refuses to write a value that
  -- did not come from there (platform/core/audit/audit.ts, ActorBusinessContext).
  actor_business_ids          TEXT NOT NULL DEFAULT '[]',

  -- JSON array of wire FIELD NAMES. Never values.
  changed_field_names         TEXT NOT NULL DEFAULT '[]',

  request_id                  TEXT NOT NULL,
  correlation_id              TEXT NOT NULL,

  PRIMARY KEY (tenant_id, audit_event_id)
);

-- The access path for reading a tenant's audit trail newest-first. Every query is indexed
-- for its access path (CLOUDFLARE_STANDARD.md §4 rule 4): on a single thread, one
-- unindexed scan is every Organization's latency.
CREATE INDEX IF NOT EXISTS audit_event_by_tenant_time
  ON audit_event (tenant_id, occurred_at DESC, audit_event_id);

-- The access path for "what happened to this record". Used by support and by the
-- post-purge obligation that a purged customer's audit history remains retrievable by
-- customer_id.
CREATE INDEX IF NOT EXISTS audit_event_by_tenant_target
  ON audit_event (tenant_id, target_resource_id, occurred_at DESC);

-- The access path for SECURITY ALERTING AND COARSE AGGREGATION — added for the GetCustomer
-- probe-detection control (user decision, 2026-09-02).
--
-- The control is only useful if a run of refused attempts can be SEEN. The question an alert
-- asks is "how many denials has this actor produced in this window", and it must be
-- answerable WITHOUT READING THE RECORDS' CONTENTS — both because an alerting job that reads
-- audit bodies is a second, weaker access path to the audit trail, and because on a
-- single-threaded database a scan performed on a schedule is every Organization's latency.
--
--   SELECT COUNT(*) FROM audit_event
--    WHERE tenant_id = ? AND principal_id = ? AND decision = 'denied' AND occurred_at >= ?
--
-- is served entirely from this index: no table row is touched, so no identifier, no denial
-- reason and no target is read to produce the count.
--
-- COLUMN ORDER IS THE DESIGN. `decision` sits before `occurred_at` so the denial run is one
-- contiguous range per actor rather than a filter applied after a time scan. The
-- (tenant_id, principal_id) prefix still serves "everything this actor did", which is the
-- query an investigator runs after an alert fires.
--
-- WHAT IT DOES NOT COVER, stated rather than discovered later: on_behalf_of_principal_id. An
-- AI agent or service account acting for a human is aggregated under the AGENT's principal_id,
-- not the human's, so a campaign spread across several agents driven by one person does not
-- group. Fixing that is an additive index when there is an identity layer to make it mean
-- something; today no principal resolver exists at all.
--
-- COST: one more index maintained on every audited write, against a table that takes one
-- insert per audited invocation. Accepted — the alternative is a control that records
-- evidence nobody can query.
CREATE INDEX IF NOT EXISTS audit_event_by_tenant_principal_decision_time
  ON audit_event (tenant_id, principal_id, decision, occurred_at DESC);
