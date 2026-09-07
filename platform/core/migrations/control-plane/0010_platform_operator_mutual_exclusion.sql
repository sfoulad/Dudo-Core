-- Control-plane migration 0010 — the mutual exclusion, as database triggers.
-- docs/decisions/0025 decision 1, docs/decisions/0024 invariant 1.
--
-- Read `0008_platform_operator.sql` first.
--
-- IT BELONGS TO `DB_CONTROL`. See 0008.
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
--
-- ROLLBACK PATH: DROP TRIGGER for each of the four names below. Its effect is that the write-side
-- half of the mutual exclusion stops being enforced against SQL run by hand. THE AUTHORIZATION-SIDE
-- HALF IS UNAFFECTED — `platform/core/platform/platform-authority.ts` still refuses a principal
-- present in both tables on every request — so dropping these makes the bad STATE creatable and
-- leaves it unexploitable. That asymmetry is the reason this is a separate migration; see below.
-- FORWARD-ONLY and idempotent (`CREATE TRIGGER IF NOT EXISTS`).
--
-- =============================================================================================
-- WHY THIS IS A SEPARATE MIGRATION FROM 0008, AND NOT A PARAGRAPH IN IT
-- =============================================================================================
--
-- TWO INDEPENDENT REASONS, AND THE SECOND IS THE HONEST ONE.
--
-- 1. `0008` AND `0009` MUST LAND EVEN IF THIS FILE CANNOT. The tables are the substance; these
--    triggers are a second layer over a check that already runs in TypeScript. Bundling them
--    would make an engine that rejects a trigger a blocker for the whole surface.
--
-- 2. IT HAS BEEN VERIFIED AGAINST D1'S OWN ENGINE, AND THE CLAIM IS STATED EXACTLY.
--
--    VERIFIED BY THE TEAM LEAD, 2026-09-05, on a local D1: this file applies, creates four
--    triggers, and refuses ALL FOUR directions — a membership inserted for an existing operator,
--    an operator inserted for an existing member, a membership UPDATE repointed onto an operator,
--    and a platform_operator UPDATE repointed onto a member. `rows_landed: 0` in every case.
--
--    *** BOTH NEGATIVE CONTROLS PASSED, WHICH IS WHAT MAKES THE FOUR REFUSALS EVIDENCE. *** A
--    principal with no platform row can still be given a membership, and a principal with no
--    membership can still become an operator. Without those, four refusals are equally consistent
--    with a trigger that refuses everything.
--
--    Independently measured against `node:sqlite` — the engine
--    `packages/testing/harness/sqlite-d1.ts` uses — with the same outcome. Two engines, one
--    result. `0007_membership_role.sql` is the standing example in this directory of a migration
--    whose behaviour was measured rather than assumed; this file now meets the same standard.
--
-- =============================================================================================
-- WHAT THESE TRIGGERS ARE FOR — AND IT IS PRECISELY THE PATH CODE CANNOT REACH
-- =============================================================================================
--
-- The mutual exclusion is checked in three places (`0008`). Two of them are TypeScript, and
-- TypeScript is in the path of every write Dudo's own code performs.
--
-- BUT THE ONLY WRITER OF `platform_operator` IS A HUMAN RUNNING SQL. Bootstrap is out of band by
-- design — there is no route that creates a platform operator, and that absence is a deliberate
-- security property rather than a missing feature. So the ONE writer of the one table that
-- carries platform authority is the one writer no code check can stand in front of.
--
-- A rule enforced everywhere except at its only real writer is not enforced. These triggers are
-- what put the check there.
--
-- THEY ALSO COVER THE THREE STATES `0025` NAMES AS THE REASON THE AUTHORIZATION CHECK EXISTS AT
-- ALL: "a hand-run SQL statement, a partially applied migration, or a restore from two backups
-- taken at different moments." Triggers stop the first. They do NOT stop the second or third — a
-- restore does not re-run triggers — which is exactly why the authorization-side check remains
-- THE control and these are defence in depth.
--
-- =============================================================================================
-- WHAT THEY COST
-- =============================================================================================
--
-- ONE INDEXED EXISTENCE CHECK PER INSERT INTO EITHER TABLE. Both lookups use the leading column
-- of an existing primary key — `platform_operator(principal_id)` and
-- `organization_membership(principal_id, organization_id)` — so neither is a scan.
--
-- The write rates are: `platform_operator`, one or two rows in Dudo's lifetime; and
-- `organization_membership`, one row per onboarding and per member added. This is not a
-- measurable cost, and it is on the write path only — no read pays for it.
--
-- FREE-TIER IMPACT: no new table, no new index, no new storage, no new service. The extra
-- row-READ per membership insert is one, against a 5,000,000/day allowance.
-- COST: USD 0 / BD 0 per month.

-- ---------------------------------------------------------------------------------------------
-- Direction 1: a platform operator must not already be a member of any Organization.
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS platform_operator_excludes_membership_on_insert
BEFORE INSERT ON platform_operator
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM organization_membership WHERE principal_id = NEW.principal_id
)
BEGIN
  SELECT RAISE(
    ABORT,
    'This principal already holds an organization_membership row. docs/decisions/0024: a platform principal holds ZERO memberships, because a membership row carrying platform authority assembles cross-tenant access out of entirely legitimate parts. Create a separate principal for platform operation.'
  );
END;

CREATE TRIGGER IF NOT EXISTS platform_operator_excludes_membership_on_update
BEFORE UPDATE OF principal_id ON platform_operator
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM organization_membership WHERE principal_id = NEW.principal_id
)
BEGIN
  SELECT RAISE(
    ABORT,
    'This principal already holds an organization_membership row. See docs/decisions/0024.'
  );
END;

-- ---------------------------------------------------------------------------------------------
-- Direction 2: an Organization member must not be a platform operator.
--
-- THIS IS THE DIRECTION THAT WILL ACTUALLY FIRE. `organization_membership` is written by
-- onboarding and by membership administration; `platform_operator` is written twice, by hand. The
-- realistic accident is not "somebody makes an operator a member" but "onboarding assigns an
-- Organization to a principal that happens to be an operator" — for instance because an operator
-- used its own principal to create a tenant it then wanted to look inside.
--
-- That is precisely the trap `0024` describes, arrived at by a completely reasonable route.
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS membership_excludes_platform_operator_on_insert
BEFORE INSERT ON organization_membership
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM platform_operator WHERE principal_id = NEW.principal_id
)
BEGIN
  SELECT RAISE(
    ABORT,
    'This principal holds a platform_operator row and may not be given a membership. docs/decisions/0024: scope.ts ranks platform at 0, so implies(platform, X) is true for every X — a platform principal with a membership row passes authorization for every Action at every scope, and the storage boundary then scopes it into that Organization and serves the rows. Nothing is bypassed; the membership row IS the bypass.'
  );
END;

CREATE TRIGGER IF NOT EXISTS membership_excludes_platform_operator_on_update
BEFORE UPDATE OF principal_id ON organization_membership
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM platform_operator WHERE principal_id = NEW.principal_id
)
BEGIN
  SELECT RAISE(
    ABORT,
    'This principal holds a platform_operator row and may not be given a membership. See docs/decisions/0024.'
  );
END;

-- =============================================================================================
-- WHAT THESE TRIGGERS DO **NOT** DO. Read this before treating them as the control.
-- =============================================================================================
--
--   * THEY DO NOT VALIDATE EXISTING ROWS. A trigger applies to subsequent writes only, exactly as
--     `0007_membership_role.sql` records for its CHECK constraint. If a principal is already in
--     both tables when this migration is applied, IT STAYS IN BOTH and nothing here notices. The
--     authorization-side check is what refuses it, on every request, forever.
--
--   * THEY DO NOT SURVIVE A RESTORE OR A BULK LOAD THAT BYPASSES THEM. `0025` names both.
--
--   * THEY MUST NEVER BE CITED AS THE REASON THE AUTHORIZATION CHECK CAN BE SKIPPED. `0025` is
--     explicit that ON WRITE is hygiene and AT AUTHORIZATION is the control, and that an
--     implementation shipping only the first has shipped none. This file is the first.
