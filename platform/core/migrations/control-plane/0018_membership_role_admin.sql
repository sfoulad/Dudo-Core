-- Control-plane migration 0018 — widen `organization_membership.role` to four roles.
-- `docs/decisions/0043` §3 and §3a. Read `0003_organization_membership.sql` and
-- `0007_membership_role.sql` first; this migration REBUILDS the table those two describe.
--
-- IT BELONGS TO `DB_CONTROL`. See 0002.
--
-- *** NOT APPLIED BY THE AGENT THAT WROTE IT. *** Applying a migration is a production action and
-- requires the user's explicit approval, every time (`.claude/rules/security.md` §7). The sequence
-- the user set for `0017` is not negotiable by convenience and applies here with more force,
-- because this one REBUILDS A TABLE RATHER THAN ADDING AN INDEX: **a verified D1 backup first,
-- then this migration, then the deploy.**
--
-- ROLLBACK PATH: the same rebuild in reverse, with the narrow CHECK — and **it is only safe while
-- no row holds `'admin'` or `'business-admin'`.** Once one does, rolling back either fails on the
-- CHECK or silently drops those principals' authority, depending on how the copy is written. That
-- is a genuine one-way door and is the reason this file states its ordering constraints in full.
-- FORWARD-ONLY. **NOT IDEMPOTENT — see the re-run hazard below.** Unlike `0017`.
--
-- =============================================================================================
-- WHY A TABLE REBUILD, AND WHY THERE IS NO CHEAPER FORM
-- =============================================================================================
--
-- `0007` added the column as `ALTER TABLE organization_membership ADD COLUMN role TEXT CHECK (role
-- IS NULL OR role IN ('owner', 'member'))`. **SQLite CANNOT ALTER A CHECK CONSTRAINT.** There is no
-- `DROP CONSTRAINT`, no `MODIFY COLUMN`, and adding a second column would leave the old constraint
-- deciding what the old column may hold. The documented route is the twelve-step table rebuild, and
-- that is what is below.
--
-- SO THE COST OF `0043` §3a's ADDITIVE ROLE SET IS A TABLE REBUILD, WHICH IS NOT WHAT "ADDITIVE"
-- SUGGESTS. The DATA is untouched — no row changes value, `0043` §3a is right about that — but the
-- OBJECT is dropped and recreated, and everything attached to the object goes with it. That is the
-- next section, and it is the reason this file is long.
--
-- =============================================================================================
-- *** THE HAZARD: `DROP TABLE` DROPS ITS TRIGGERS, AND TWO OF `0024`'s FOUR LIVE ON THIS TABLE. ***
-- =============================================================================================
--
-- `0010_platform_operator_mutual_exclusion.sql` creates four triggers. **TWO OF THEM ARE ON
-- `organization_membership`**:
--
--   membership_excludes_platform_operator_on_insert   BEFORE INSERT
--   membership_excludes_platform_operator_on_update   BEFORE UPDATE OF principal_id
--
-- `0010` calls the second of these **"the direction that will actually fire"**, because
-- `organization_membership` is written by onboarding and by membership administration while
-- `platform_operator` is written twice, by hand.
--
-- **A REBUILD THAT DID NOT RECREATE THEM WOULD DELETE A SECURITY CONTROL AS A SIDE EFFECT OF
-- WIDENING A CHECK CONSTRAINT, AND NOTHING WOULD SAY SO.** No test goes red — the triggers are
-- schema, not code; no typecheck notices; `0010` is already applied and its file is unchanged, so a
-- reader checking whether the mutual exclusion is enforced finds a migration that says yes. The
-- table would simply stop refusing the write, and the next time an operator's principal was given a
-- membership, the row would be created.
--
-- **THEY ARE RECREATED BELOW, IN THIS MIGRATION, AFTER THE RENAME.** Verbatim from `0010`, message
-- text included, so a `diff` against that file shows them identical. If you edit one, edit both —
-- and `0010` is the authority on WHY they exist.
--
-- =============================================================================================
-- *** AND THE OTHER TWO TRIGGERS BREAK IT OUTRIGHT. THE FIRST VERSION OF THIS MIGRATION DID NOT
-- APPLY, AND THE PARAGRAPH ABOVE IS WHY I DID NOT NOTICE. ***
-- =============================================================================================
--
-- `0010`'s other two triggers sit on `platform_operator` — so they are NOT dropped with this table
-- — **and their `WHEN EXISTS` clause READS `organization_membership`.** SQLite re-validates the
-- schema when the rename lands, finds two live triggers referencing a table that no longer exists,
-- and refuses:
--
--   error in trigger platform_operator_excludes_membership_on_insert:
--     no such table: main.organization_membership
--
-- **MEASURED, NOT REASONED.** The whole directory was applied in order to a throwaway in-memory
-- `node:sqlite` database; the first seventeen applied and this one failed at exactly that line.
--
-- *** THE SHAPE OF THE MISS IS THE PART WORTH KEEPING. *** The section above is precise, correct,
-- and about the wrong half: **two triggers are ON this table and two REFERENCE it.** Having found
-- the first pair, I stopped — and `architecture.md` §3b names that exactly: *"an assertion that a
-- known problem does not apply is a claim… the more precisely a dismissal is worded, the less
-- likely anyone is to re-derive it."* A confident paragraph about triggers is what stopped me
-- looking for the other kind of trigger.
--
-- **SO ALL FOUR ARE DROPPED FIRST AND ALL FOUR ARE RECREATED AFTERWARDS.** Dropping the two on
-- `platform_operator` is not optional tidiness — without it the migration does not run at all.
--
-- **AND THE WINDOW IS REAL WHILE IT RUNS: for the duration of this migration the mutual exclusion
-- has NO database-level enforcement in either direction.** That is acceptable for the reason
-- `0025` gives — *"the write check is hygiene; THE AUTHORIZATION CHECK IS THE CONTROL"* — and
-- `platform-authority.ts` plus `tenant-admin-authority.ts` are both unaffected by a migration.
-- **It is acceptable, and it is not nothing: do not apply this while anything is writing.**
--
-- IT IS ALSO WHY THIS MIGRATION MUST BE APPLIED BEFORE `0019` AND `0020`. Those add indexes to this
-- table; a `DROP TABLE` after them takes the indexes too, and unlike the triggers **the indexes
-- would then be silently absent while the queries that need them still work, more slowly.**
--
-- =============================================================================================
-- ORDERING, STATED AS A LIST BECAUSE THE FAILURE MODES DIFFER
-- =============================================================================================
--
--   AFTER  0003, 0007, 0010   the table, its role column, and the triggers this file recreates.
--                             Applying this before `0010` recreates triggers that then get created
--                             again by `0010`'s `IF NOT EXISTS` — harmless, and only because both
--                             use `IF NOT EXISTS`.
--   BEFORE 0019, 0020         both add indexes to this table. Applying this AFTER either one drops
--                             that index. **Silently.** A dropped index breaks no query.
--   NO CONSTRAINT vs 0021+    those create new tables and do not touch this one.
--
-- *** RE-RUN HAZARD: THIS MIGRATION IS NOT IDEMPOTENT AND MUST NOT BE MADE TO LOOK AS THOUGH IT
-- IS. *** A second run finds `organization_membership` already widened, creates
-- `organization_membership_0018` again from it, copies, drops and renames — which is harmless
-- today only because the source and target shapes are then identical. **It is not harmless if the
-- second run happens between `0019`/`0020` and now**, because it would drop those indexes. An
-- `IF NOT EXISTS` on the temporary table would make a re-run LOOK safe while doing exactly that.
-- Run it once, in order, from a verified backup.
--
-- =============================================================================================
-- THE FOREIGN-KEY QUESTION, ANSWERED FOR THE PARTS THAT CAN BE ANSWERED HERE
-- =============================================================================================
--
--   * **NO TABLE REFERENCES `organization_membership`.** Verified by searching every migration in
--     this directory for `REFERENCES organization_membership`: zero hits. So the `DROP TABLE` has
--     no inbound foreign key to violate, and `ALTER TABLE … RENAME TO` has no other table's FK
--     clause to rewrite. **This is the fact that makes the rebuild simple, and it is the one that
--     stops being true the first time another table points here.**
--   * The new table's OWN references — `principal` and `organization` — are reproduced below
--     unchanged from `0003`.
--   * *** WHETHER D1 HONOURS `PRAGMA foreign_keys` / `PRAGMA legacy_alter_table` AROUND A BATCH IS
--     NOT VERIFIED AND IS NOT ASSERTED HERE. *** `d1_database_query` is deliberately withheld from
--     the agent that wrote this file, so this could not be measured, and `0003` already records
--     that *"foreign-key enforcement is a runtime setting, and a constraint that may or may not be
--     switched on is not a constraint an authorization decision can rest on."* **The migration is
--     written so that it does not need the answer**: with no inbound references, neither pragma
--     changes the outcome. Whoever applies it should still confirm the batch is one transaction.
--
-- =============================================================================================
-- WHAT THIS DOES NOT CHANGE
-- =============================================================================================
--
--   * NO ROW CHANGES VALUE. `'owner'` and `'member'` keep their spellings — `0043` §3a: *"ALIGN THE
--     UNBUILT VOCABULARY TO THE BUILT ONE, NEVER THE REVERSE."* The catalogue's `business-owner`
--     was `status: proposed` and unbuilt, so it is what moved.
--   * NO PERMISSION IS GRANTED. `authorization/roles.ts` maps the two new roles to permission sets
--     that introduce **no permission identifier that was not already granted to some role** — an
--     invariant that file asserts at module load in both directions rather than claiming in prose.
--   * DEPLOY ORDER IS FREE IN BOTH DIRECTIONS, and that property is worth not spending.
--     `toMembershipRole` returns `null` for an unrecognised stored string and `null` denies
--     everything, so a database ahead of the build denies rather than breaking, and a build ahead
--     of the database cannot write the new values because this CHECK is what admits them.
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008)
-- =============================================================================================
--
-- ALLOWANCES: d1-rows-written (once, at application), d1-storage (unchanged), d1-rows-read
-- (unchanged).
--
-- **THE COPY IS A ONE-TIME COST PROPORTIONAL TO THE TABLE.** At the closed beta's few hundred
-- membership rows that is a few hundred row-writes against a 100,000 daily allowance — under one
-- percent, once. **It grows with the customer base, which is the argument for applying it while
-- the table is small rather than the argument for deferring it.**
--
-- ONGOING: nothing. The rebuilt table has the same columns, the same primary key and the same
-- number of index entries per row, so `ORGANIZATION_MEMBERSHIP_ROW_WRITES` is UNCHANGED BY THIS
-- MIGRATION. `0020` is what moves it.
--
-- COST: USD 0 / BD 0 per month.

-- =============================================================================================
-- STEP 0 — DROP ALL FOUR `0024` TRIGGERS. **THE MIGRATION DOES NOT RUN WITHOUT THIS.**
--
-- The two on `platform_operator` are not dropped by the `DROP TABLE` below and their `WHEN EXISTS`
-- reads the table it removes, so the rename fails schema validation. See the header. All four are
-- recreated verbatim at the end of this file.
-- =============================================================================================

DROP TRIGGER IF EXISTS platform_operator_excludes_membership_on_insert;
DROP TRIGGER IF EXISTS platform_operator_excludes_membership_on_update;
DROP TRIGGER IF EXISTS membership_excludes_platform_operator_on_insert;
DROP TRIGGER IF EXISTS membership_excludes_platform_operator_on_update;

CREATE TABLE organization_membership_0018 (
  principal_id    TEXT NOT NULL REFERENCES principal (principal_id),
  organization_id TEXT NOT NULL REFERENCES organization (organization_id),

  -- 'active' | 'suspended'. Unchanged from `0003`, reproduced because a rebuild has to restate
  -- every constraint the old object carried.
  status          TEXT NOT NULL CHECK (status IN ('active', 'suspended')),

  created_at      TEXT NOT NULL,          -- RFC 3339, UTC

  -- THE WIDENING. Four values, `docs/decisions/0043` §3. Still NULLABLE and still with no DEFAULT,
  -- for `0007`'s reason: a row with no role denies everything, on the same path as an absent
  -- membership, and a default would grant something to every row that has not been decided about.
  role            TEXT CHECK (
                    role IS NULL
                    OR role IN ('owner', 'admin', 'business-admin', 'member')
                  ),

  PRIMARY KEY (principal_id, organization_id)
);

INSERT INTO organization_membership_0018
  (principal_id, organization_id, status, created_at, role)
SELECT
  principal_id, organization_id, status, created_at, role
FROM organization_membership;

DROP TABLE organization_membership;

ALTER TABLE organization_membership_0018 RENAME TO organization_membership;

-- =============================================================================================
-- ALL **FOUR** `0024` TRIGGERS, RECREATED. **VERBATIM FROM `0010`, INCLUDING THE MESSAGE TEXT.**
--
-- Two were dropped with the table; two were dropped at step 0 because they reference it. See the
-- hazard section — the second pair is the one that makes this a migration that does not run rather
-- than a migration that silently loses a control.
--
-- `0010` remains the authority on why they exist and on what they do NOT do: they do not validate
-- existing rows, and they do not survive a restore. **The authorization-time check is the control**
-- (`platform-authority.ts`, and now also `tenant-admin/tenant-admin-authority.ts`, which closes the
-- tenant side for its own class).
--
-- A `diff` against `0010` must show all four identical. If you edit one, edit both files.
--
-- =============================================================================================
-- *** AND THIS FILE IS NOW A SECOND AUTHOR OF THOSE FOUR TRIGGERS, WHICH BREAKS A NEGATIVE
-- CONTROL THAT WAS CORRECT BEFORE IT. STATED HERE BECAUSE NOTHING ELSE CONNECTS THE TWO. ***
-- =============================================================================================
--
-- `qa-agent` has a control that builds a fixture **omitting `0010`** and asserts the same
-- statements then SUCCEED — which is what proves the triggers are load-bearing rather than
-- decorative. **After this migration that construction no longer produces a trigger-free
-- database**, because the block above creates all four whether or not `0010` ever ran.
--
-- **THE CONTROL IS RIGHT AND SO IS THIS FILE, AND THE CONFLICT IS REAL RATHER THAN A DEFECT IN
-- EITHER.** This migration cannot skip the recreation — dropping the two on `platform_operator` is
-- what lets it run at all, and not restoring them would delete a security control. And the control
-- cannot be dropped: it is the only thing distinguishing *"the triggers refuse this"* from *"this
-- statement fails for some other reason"*.
--
-- **WHAT MOVES IS THE CONTROL'S SUBJECT: FROM A FILE TO THE OBJECTS.** *"Omit `0010`"* was a
-- faithful way to say *"no triggers"* while `0010` was their only author; it is not any more. The
-- constructible form is to apply the full set and then `DROP TRIGGER` the four by name — which is
-- **strictly more honest**, because it tests the absence of the thing rather than the absence of a
-- file, and it keeps working the next time a migration touches this table.
--
-- **AND THE CLAIM THE CONTROL PROVES CHANGES SHAPE TOO.** *"`0010` is what refused it"* is no
-- longer the whole truth; *"the trigger is what refused it, and it is created by `0010` and
-- restored by `0018`"* is. `workflow.md` §12 — a decision being MADE strands artifacts as surely
-- as one being withdrawn, and this is that, arriving through a migration rather than a ruling.
-- =============================================================================================

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
