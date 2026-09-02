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
