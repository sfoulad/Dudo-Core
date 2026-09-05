-- Control-plane migration 0009 — the platform-operator action log.
-- docs/decisions/0025 decision 5. Contract: platform-operator-v1, `auditModel`.
--
-- Read `0001_principal.sql` first for the shared header of this directory, and
-- `0008_platform_operator.sql` for the table whose holders write every row here.
--
-- IT BELONGS TO `DB_CONTROL`. See 0008.
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
--
-- ROLLBACK PATH: DROP TABLE platform_operator_action. Its effect is that EVERY PLATFORM ROUTE
-- STOPS WORKING — `platform-audit.ts` fails the operation with `unavailable` when the record
-- cannot be written, because "the audit event must not fail open" and inability to record the
-- evidence is not a reason to proceed without it. Dropping this table does not open a hole; it
-- closes the whole surface. Safe, and total.
-- FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- WHY THIS EXISTS RATHER THAN A ROW IN `audit_event`
-- =============================================================================================
--
-- AN OPERATOR ACTION SPANS TENANTS BY NATURE AND `audit_event` IS TENANT-SCOPED. There is no
-- tenant-scoped handle on a platform route — that is binding property P1 of the class — so the
-- ordinary audit path is unreachable. For onboarding it is worse than unreachable: the tenant
-- whose log would receive the record is the one the operation is still creating.
--
-- `0025` decision 5 rules TWO HOMES, BOTH REQUIRED:
--
--   1. THIS TABLE — the platform's own account of what its operators did.
--   2. A TENANT-SIDE RECORD in the affected Organization's `audit_event`, WHERE ONE EXISTS AND IS
--      REACHABLE. NEITHER ROUTE IN THIS SLICE HAS AN AFFECTED ORGANIZATION, so no operation here
--      writes one. It becomes reachable with organization-onboarding-v1 and credential-reset-v1.
--      `qa-agent` should report the tenant-side half as NOT APPLICABLE to this slice rather than
--      as passing.
--
-- NEITHER HALF SUBSTITUTES FOR THE OTHER, and the half most likely to be dropped for convenience
-- is the second: a platform operator resetting a tenant admin's credential IS A TAKEOVER OF THAT
-- ACCOUNT BY DESIGN, and the customer must be able to see that it happened. A trail only the
-- platform can read is a trail kept by the party being audited, which is not an audit.
--
-- =============================================================================================
-- THE TENSION WITH `0003_organization_membership.sql`, AND WHY IT IS NOT A CONTRADICTION
-- =============================================================================================
--
-- That migration refused "an append-only log that spans every tenant" in the control plane. THAT
-- REFUSAL IS RIGHT AND IT STANDS. It was refusing a log of tenant BUSINESS events — a place where
-- one Organization's records would sit beside another's.
--
-- THIS IS A DIFFERENT OBJECT, AND THE CONSTRAINT IS WHAT MAKES IT ONE. This table holds only:
-- who acted, what they did, which Organization or principal they named, and when. NO BUSINESS
-- DATA OF ANY KIND — no customer, no field value, no name, no amount, no count.
--
--   ***  A COLUMN CARRYING TENANT BUSINESS DATA MAY NEVER BE ADDED TO THIS TABLE.  ***
--
-- That sentence is NORMATIVE, not descriptive. It is the entire argument for the table's
-- existence, and the moment it stops being true this is a second copy of the tenant database with
-- weaker access rules. The same discipline `0013` applied to denial summaries and `0023`'s marker
-- applied to failure announcements.
--
-- THE PRESSURE WILL COME FROM A REASONABLE PLACE. "Record which customer was affected so support
-- can explain it" and "record the old value so a change can be reversed" are both sensible
-- requests and both cross the line. The answer to each is a record in the AFFECTED
-- ORGANIZATION'S OWN `audit_event`, which is home 2 above.
--
-- =============================================================================================
-- NO FOREIGN KEYS, AND THAT IS DELIBERATE FOR AN AUDIT TABLE
-- =============================================================================================
--
-- `actor_principal_id` and `target_id` are NOT declared `REFERENCES`. An audit record must survive
-- the deletion of the thing it names: a record saying "operator X reset principal Y's credential"
-- has to remain readable after Y is deleted, and a foreign key would either block the deletion or
-- cascade the evidence away. Every other control-plane table declares its references; this one
-- does not, for this reason, and the difference is intentional rather than an omission.
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008)
-- =============================================================================================
--
--   ALLOWANCES CONSUMED: d1-storage, d1-rows-written. (d1-rows-read: nothing reads this table in
--     this slice — there is no port method that queries it and no route that returns it.)
--   ROWS WRITTEN: 2 per platform request (1 table row + primary-key autoindex), reserved from the
--     `system` allocation through `ControlPlaneWriteAdmission` exactly as a session write is.
--     `PLATFORM_OPERATOR_ACTION_ROW_WRITES` in `identity/control-plane-admission.ts` is that 2.
--     WHEN A MIGRATION ADDS AN INDEX, THAT CONSTANT MUST MOVE WITH IT — D1 exposes no portable
--     schema introspection through a binding, so nothing can notice on our behalf.
--   THE CHECK THAT MATTERS: binding property P4 MAKES EVERY READ A WRITE, which is exactly the
--     shape `0013` had to bound. It is safe here for a reason that DOES NOT GENERALISE: `0013`'s
--     problem was that an unauthenticated or merely authenticated caller could force unbounded
--     denial audits. This table is written only after a caller has been established as a holder
--     of a `platform_operator` row, so the population that can force a write is bounded by the
--     number of REAL OPERATORS — one or two — and not by traffic. It is `0013` control 5's test
--     and it passes for the same reason.
--     *** IF THIS CLASS EVER BECOMES REACHABLE BY A LARGER POPULATION, THAT ARGUMENT FAILS AND
--     P4 MUST BE BOUNDED THE WAY D2 BOUNDED SUCCESSFUL READS. *** Written down because the
--     failure would be silent.
--   STORAGE: ~200 bytes a row. At an operator volume of tens of actions a day, single-digit MB a
--     year against a 500 MB ceiling. RETENTION IS NOT BUILT AND IS NOT DECIDED — there is no
--     retention job in this repository for any table, and this one grows monotonically. Reported
--     rather than solved.
--   AT THE LIMIT: the per-principal daily control-plane ceiling (600 estimated row-writes) is the
--     first thing reached, at 300 platform actions per operator per UTC day. Past it, every
--     platform route answers `unavailable` — the operator is locked out of the console rather
--     than acting without a record. That is the correct direction and it is a real self-inflicted
--     lockout; see `platform-audit.ts`.
--   COST: USD 0 / BD 0 per month. New control-plane table, no new service, no new binding.

CREATE TABLE IF NOT EXISTS platform_operator_action (
  -- 128 opaque bits from the platform CSPRNG (`kernel/ids.ts`), not a counter and not a
  -- timestamp. A sequential audit identifier tells any reader how many operator actions have ever
  -- occurred, and a gap in the sequence tells them one was deleted.
  action_record_id     TEXT NOT NULL PRIMARY KEY,

  -- WHO. The operator's own principal, server-derived from a verified session credential. Never
  -- a value that arrived on the request.
  actor_principal_id   TEXT NOT NULL,

  -- The role the authority was resolved from, recorded AS IT WAS AT THE TIME. If the operator's
  -- row is later changed or deleted, this record still says what authority the action was taken
  -- under — which is the question an investigation actually asks.
  actor_platform_role  TEXT NOT NULL,

  -- WHAT. The platform route identifier, e.g. 'platform.organizations.list'. A Core-owned literal
  -- from a frozen table; there is no path by which a caller supplies this string.
  action_id            TEXT NOT NULL,

  -- WHICH. `target_kind` says how to read `target_id`, and 'none' is a first-class value rather
  -- than a NULL kind: an enumeration has no single affected target, and that is a fact about the
  -- operation worth recording positively.
  --
  -- `target_id` HOLDS AN IDENTIFIER AND NOTHING ELSE. Not a name, not a description, not a
  -- summary of what was touched. See the header.
  target_kind          TEXT NOT NULL CHECK (target_kind IN ('none', 'organization', 'principal')),
  target_id            TEXT,

  -- HOW IT WENT. 'ok' the operation completed; 'denied' the operator's role did not carry the
  -- permission; 'failed' Dudo could not complete it.
  --
  -- A CALLER WHO IS NOT A PLATFORM OPERATOR PRODUCES NO ROW AT ALL, which is why 'unauthenticated'
  -- is not a value here. That is the bound in the free-tier note above, and it is load-bearing:
  -- if any authenticated principal could cause a row, the write population would be traffic-sized
  -- rather than operator-sized. `platform-audit.ts` states the same rule at the code that applies
  -- it.
  outcome              TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'failed')),

  occurred_at          TEXT NOT NULL,   -- RFC 3339, UTC. The server's clock, never a request value.

  -- The request's correlation identifier, so this record can be tied to the platform's other
  -- observability without either side holding the other's data. It is validated against
  -- `^[A-Za-z0-9_-]{8,64}$` at the transport boundary before it can reach here, which is what
  -- keeps a caller-supplied header out of a stored column in any interesting form.
  correlation_id       TEXT NOT NULL
);

-- NO INDEX BEYOND THE PRIMARY KEY, AND THE CONSEQUENCE IS STATED RATHER THAN LEFT TO BE FOUND.
--
-- The obvious index is `(actor_principal_id, occurred_at)` — "what has this operator done" — and
-- it is the query an investigation runs. It is not added because NOTHING IN THIS REPOSITORY READS
-- THIS TABLE: there is no port method, no route and no console screen. Adding an index for a
-- query that does not exist costs a third row-write on EVERY platform request, and P4 makes every
-- platform request a write.
--
-- WHEN A READ SURFACE IS BUILT, ADD THE INDEX AND RAISE
-- `PLATFORM_OPERATOR_ACTION_ROW_WRITES` FROM 2 TO 3 IN THE SAME CHANGE. Until then an
-- investigation is a full table scan, which on an operator-volume table is the right trade.
--
-- THERE IS ALSO NO UNIQUE CONSTRAINT AND NO APPEND-ONLY ENFORCEMENT. SQLite cannot make a table
-- insert-only, so nothing here stops an operator with database access from editing or deleting a
-- row. THAT IS A REAL LIMITATION OF KEEPING THE TRAIL IN THE SAME DATABASE THE PLATFORM CONTROLS,
-- and it is exactly why `0025` requires the tenant-side copy as well: the customer's copy is the
-- one the audited party cannot reach. It is named here so nobody reads this table as tamper-proof.
