-- Control-plane migration 0015 — an Organization gains a name and two registrations.
-- Contract organization-identity-v1. docs/decisions/0019, 0028, 0030.
--
-- Read `0002_organization.sql` first. It declined a name column deliberately and named this exact
-- consequence: *"an Organization picker built on this schema can list identifiers and cannot show
-- names. A 22-character opaque identifier is not a usable choice for a human."* This is that
-- dependency arriving, with its own contract, exactly as that file said it would.
--
-- IT BELONGS TO `DB_CONTROL`. See 0001.
--
-- ROLLBACK PATH: every column is nullable or defaulted, so the rollback is to stop writing them.
-- SQLite in the version D1 targets cannot drop a column. The four triggers CAN be dropped
-- (`DROP TRIGGER`) and dropping them removes only a backstop. FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- *** WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0002 — AND THE ARGUMENT DOES NOT DEPEND ON
-- KNOWING WHETHER 0002 HAS RUN. ***
-- =============================================================================================
--
-- `0002` says editing it in place is correct "ONLY because this migration has never run anywhere",
-- and `0001_audit_event.sql` states the rule it defers to: *"from the first time it is applied, the
-- additive-only rule takes over and this file is frozen."*
--
-- THE BRIEF SAYS THREE ORGANIZATIONS EXIST, WHICH MEANS 0002 HAS RUN. But this file would be
-- correct even if that were wrong, and the reason is worth stating because it is the reason it was
-- not researched further:
--
--   * IN-PLACE EDIT, IF 0002 HAS RUN  → silent schema drift on the table that decides whether an
--                                       Organization is active. Nothing detects it.
--   * NEW FILE, IF 0002 HAS NOT RUN   → a slightly less tidy schema history. Nothing breaks.
--
-- **THE COSTS ARE NOT COMPARABLE, SO THE ANSWER DOES NOT DEPEND ON THE FACT.** A decision resolved
-- by asymmetry cannot be invalidated by a lookup going stale, which a decision resolved by the fact
-- can be.
--
-- ---------------------------------------------------------------------------------------------
-- AND A CORRECTION THAT BELONGS HERE RATHER THAN THERE
-- ---------------------------------------------------------------------------------------------
--
-- **`0002`'s HEADER SAYS "NOT APPLIED". THAT IS FALSE IN PRODUCTION** — Organizations exist, and
-- they cannot exist without this table. The claim is recorded here rather than corrected there,
-- because editing an applied migration to fix a comment is still editing an applied migration, and
-- the whole point of the paragraph above is not to do that. A reader who reaches 0002's header
-- arrives here anyway, since this is where its columns now live.
--
-- IT IS THIS WEEK'S PATTERN IN A PLACE NOBODY HAD SWEPT: a claim in a header, true when written,
-- false later, and nothing goes red when it turns. `.claude/rules/workflow.md` §12.
--
-- =============================================================================================
-- THIRTEEN COLUMNS, AND WHY NOT THREE JSON ONES
-- =============================================================================================
--
-- `organization-identity-v1` leaves the storage form to Core and binds only the wire shape and one
-- invariant: **the three states must be distinguishable in storage, and a verification must be
-- impossible to retain across a changed number.**
--
-- FLAT COLUMNS ARE CHOSEN FOR ENFORCEMENT, NOT FOR BYTES. A JSON blob is opaque to the database:
-- `{"state":"not_registered","number":"123"}` is a perfectly good JSON document and the engine has
-- no opinion about it. Flat columns let the triggers below refuse that row. The byte difference
-- between the two forms is around a hundred bytes on a table holding at most ten rows, so storage
-- decided nothing here.
--
-- SIX COLUMNS PER REGISTRATION, and the two registrations are IDENTICAL IN SHAPE on purpose —
-- theCategoryRuling's whole argument is that CR and VAT are two instances of one category, so a
-- future generic table is a transposition rather than a reconciliation. **If a later edit gives
-- them different shapes, that ruling has been reversed without anyone deciding to reverse it.**
--
-- ---------------------------------------------------------------------------------------------
-- WHAT ENFORCES WHAT. RANKED, BECAUSE THE TRIGGERS ARE THE WEAKEST LAYER AND LOOK LIKE THE
-- STRONGEST.
-- ---------------------------------------------------------------------------------------------
--
--   LAYER                                  CATCHES                          BLIND TO
--   ------------------------------------------------------------------------------------------
--   The TypeScript discriminated union     Any Core path constructing an    A deliberate cast
--                                          incoherent registration —
--                                          BUILD FAILURE
--   *** ONE WRITE PATH setting all six     An incoherent row from any       A write that does not
--   columns from one union value ***       Core write.                      go through it
--                                          **LOAD-BEARING.**
--   The four triggers below                A new write path; a bypass       *** A RESTORE ***
--
-- *** AND TODAY THE LOAD-BEARING LAYER DOES NOT EXIST YET, WHICH IS SAID HERE SO THE TABLE ABOVE
-- IS NOT READ AS A DESCRIPTION OF THE PRESENT. *** `platform/core/platform/organization-identity.ts`
-- holds the union and the mapper; the ADAPTER that must be its only caller is blocked behind the
-- route's permission, so **nothing writes these columns at all right now** and nothing yet forces a
-- future adapter through the mapper. When the adapter lands, the mapper returns a branded value the
-- write requires. Until then the triggers are the ONLY layer in front of the database, which is the
-- arrangement §3a says has already failed — stated rather than left for a reader to discover.
--
-- *** THE TRIGGERS ARE A BACKSTOP AND NOT THE ENFORCEMENT. *** `.claude/rules/architecture.md`
-- §3a: *"if the only thing standing between a forbidden row and the database is a trigger, the
-- design has already failed — the trigger is what catches the failure, not what prevents it."*
-- **A restore does not go through a write, so nothing below fires on one** (`0024`).
--
-- **SQLITE CANNOT ADD A TABLE-LEVEL `CHECK` BY `ALTER TABLE`**, which is why this is a trigger and
-- not a constraint. That is a limitation being worked around, not a design preference, and a table
-- rebuild to obtain the constraint was refused: `organization` is referenced by
-- `organization_membership` and `tenant_directory`, and rebuilding a table under live foreign keys
-- to strengthen a backstop is a worse trade than the backstop being a trigger.
--
-- =============================================================================================
-- *** THE ONE INVARIANT THE TRIGGERS ACTUALLY CATCH THAT CODE REVIEW WOULD NOT ***
-- =============================================================================================
--
-- The contract's central trap: **a verification attests to a SPECIFIC NUMBER, and carrying it
-- across an edited number would say an operator checked a value nobody ever checked, with a real
-- name and a real date attached.** Worse than an unverified number, because it defends itself.
--
-- A TRIGGER CANNOT SEE "CARRIED OVER" DIRECTLY — a freshly stamped verification and a copied one
-- are both just two non-null values. **BUT A CARRIED VERIFICATION HAS AN OLDER TIMESTAMP THAN THE
-- NUMBER IT IS ATTACHED TO**, because `recorded_at` is re-stamped whenever the number changes and
-- a genuine re-verification is stamped in the same operation. So:
--
--   verified_at >= recorded_at
--
-- is a mechanical consequence of the invariant, and it is checked below.
--
-- **IT WORKS ONLY BECAUSE THE TIMESTAMP GRAMMAR IS FIXED-WIDTH.** Lexicographic comparison equals
-- temporal comparison for RFC 3339 UTC strings ONLY at equal width, which is why
-- `platform-audit-read-v1` narrowed the grammar to require three fractional digits on 2026-09-05
-- after a bound omitting `.sss` was found not to mean its own instant. **A future timestamp written
-- without `.sss` would make this comparison silently wrong rather than fail** — `kernel/clock.ts`'s
-- `toRfc3339Utc` is `new Date(ms).toISOString()` and always emits them, and that is now
-- load-bearing here as well as on the audit feeds.
--
-- =============================================================================================
-- NO INDEX, NO UNIQUE, NO BACKFILL, NO DEFAULT NAME
-- =============================================================================================
--
-- **NO INDEX.** Nothing queries, sorts or filters on any of these columns — the identity block is
-- read by the point lookup that already exists. `0013` and `0014`'s argument applies unchanged: an
-- index costs a row-write on every write to this table, forever, to serve a question nothing asks.
--
-- **NO UNIQUE CONSTRAINT ON `display_name` OR ON EITHER NUMBER**, and this is a ruling rather than
-- an omission. theUniquenessRuling: a platform-wide unique name is a cross-tenant coupling —
-- customer A's choice constraining customer B's — and *"that name is taken"* is an existence
-- oracle over another tenant's record. **A unique CR is worse than it looks**: the value is
-- operator-entered and unverified, so the constraint enforces the uniqueness of TYPOS, and one
-- mistyped CR would permanently block the real holder while telling the operator only that it is
-- taken. If CR uniqueness is ever wanted it must be scoped to VERIFIED registrations and must not
-- name or imply the holder (`OI-4`).
--
-- **NO BACKFILL AND NO DEFAULT FOR `display_name`.** `'Organization ' || organization_id` looks
-- harmless here and is *"a value nobody can later tell from a real one — the migration would be the
-- last place the difference existed."* **AN INVENTED NAME IS INDISTINGUISHABLE FROM A TYPED ONE,
-- FOREVER.** The three existing Organizations get NULL, which means no name has been recorded, and
-- **the update route is the backfill** — performed by an operator who knows the answer, audited,
-- and visible to the customer.
--
-- **THE ASYMMETRY THAT KEEPS THE LEGACY STATE LEGACY: the column is nullable BECAUSE OF HISTORY;
-- the route makes it REQUIRED.** Onboarding will require a name, so no new nameless Organization
-- can be created and the nameless set is closed at three and shrinks. Saying only "the column is
-- nullable" would leave a future route free to create more, which is how a legacy state becomes a
-- permanent one.
--
-- ---------------------------------------------------------------------------------------------
-- WHY THE STATE COLUMNS ARE `NOT NULL DEFAULT 'not_recorded'` WHEN THE NAME IS NOT
-- ---------------------------------------------------------------------------------------------
--
-- **BECAUSE 'not_recorded' IS TRUE OF THE EXISTING ROWS AND A NAME WOULD BE INVENTED.** Nobody has
-- been asked for these Organizations' registrations, so defaulting the state asserts a fact that
-- holds rather than manufacturing one. A defaulted NAME would assert something nobody said.
--
-- It also makes the state TOTAL: there is no fourth "null" state for a reader to interpret, and
-- `not_recorded` is not doing double duty as both "no value" and "no answer".
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a)
-- =============================================================================================
--
-- ALLOWANCES: d1-storage, d1-rows-written, d1-rows-read.
--
-- **STORAGE:** ~13 bytes per row while every value is NULL (SQLite spends one serial-type byte per
-- column in the record header) and ~230 bytes per row fully populated. At most 10 rows in the
-- closed beta (MULTITENANCY_STANDARD.md §7.5), so **~2.3 KB whole-table worst case** against a
-- 5 GB allowance. `0002` measured the table at "under a kilobyte in total"; it is now under four.
--
-- **WRITES: NO CHANGE TO ANY EXISTING COUNT.** Nullable and defaulted columns on an existing
-- INSERT write the same one row, and there is no index to maintain. Onboarding's cost is unchanged
-- — checked, because that was the term that would actually have mattered.
--
-- **READS: NO CHANGE.** No query in this repository does `SELECT *` on `organization`; all six
-- reads name their columns (`d1-control-plane-store.ts:325`, `d1-platform-store.ts:379/381/430/510`),
-- so adding columns changes no existing read — including the membership lookup on the login path.
--
-- **THE TRIGGERS COST A `WHEN` EVALUATION PER WRITE TO THIS TABLE** and read no other table, unlike
-- `0010`'s which query `organization_membership`. On a ten-row table written a few times a day this
-- is not measurable.
--
-- **`0030` CHECK:** the free tier cost this migration NOTHING, and the shape it would have argued
-- for is named so the edge is visible: two plain TEXT columns holding a number or null, saving
-- ~100 bytes on a ten-row table and destroying the difference between "we never asked" and "they
-- told us they have none". Refused — and it was not a close call, which is worth recording about a
-- rule's first real test.
--
-- COST: USD 0 / BD 0 per month. No new table, no new index, no new service, no new binding.

-- ---------------------------------------------------------------------------------------------
-- THE NAME
-- ---------------------------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN display_name TEXT;

-- ---------------------------------------------------------------------------------------------
-- THE COMMERCIAL REGISTRATION (Sijilat). Six columns.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN commercial_registration_state TEXT NOT NULL DEFAULT 'not_recorded'
  CHECK (commercial_registration_state IN ('not_recorded', 'not_registered', 'registered'));

ALTER TABLE organization
  ADD COLUMN commercial_registration_number TEXT;

-- Set when the customer STATED they hold none. It dates DUDO'S RECORD OF THE STATEMENT, not the
-- customer's circumstances: a customer who becomes registered tomorrow does not falsify this, they
-- make it stale, and a client must not render it as "not registered since".
ALTER TABLE organization
  ADD COLUMN commercial_registration_declared_at TEXT;

-- Re-stamped whenever the NUMBER changes, because it dates the value rather than the field. This
-- is the column the `verified_at >= recorded_at` check compares against.
ALTER TABLE organization
  ADD COLUMN commercial_registration_recorded_at TEXT;

ALTER TABLE organization
  ADD COLUMN commercial_registration_verified_by_principal_id TEXT;

ALTER TABLE organization
  ADD COLUMN commercial_registration_verified_at TEXT;

-- ---------------------------------------------------------------------------------------------
-- THE VAT REGISTRATION (National Bureau for Revenue). Six columns, IDENTICAL IN SHAPE.
--
-- `not_registered` IS A LEGITIMATE PERMANENT STATE HERE, not an unfilled field: Bahrain VAT
-- registration is mandatory above an annual-supplies threshold and voluntary below it. A design
-- that treated it as missing data would keep prompting a customer who has already answered.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN vat_registration_state TEXT NOT NULL DEFAULT 'not_recorded'
  CHECK (vat_registration_state IN ('not_recorded', 'not_registered', 'registered'));

ALTER TABLE organization
  ADD COLUMN vat_registration_number TEXT;

ALTER TABLE organization
  ADD COLUMN vat_registration_declared_at TEXT;

ALTER TABLE organization
  ADD COLUMN vat_registration_recorded_at TEXT;

ALTER TABLE organization
  ADD COLUMN vat_registration_verified_by_principal_id TEXT;

ALTER TABLE organization
  ADD COLUMN vat_registration_verified_at TEXT;

-- =============================================================================================
-- THE FOUR TRIGGERS. A BACKSTOP — SEE THE HEADER FOR WHAT CARRIES THE WEIGHT.
--
-- Each refuses a row whose registration columns do not form one of the three states. They are
-- written as one negated disjunction rather than several narrow rules so that a state the union
-- does not name is refused by DEFAULT rather than by an author remembering to add a rule for it.
-- =============================================================================================

CREATE TRIGGER IF NOT EXISTS organization_commercial_registration_coherent_on_insert
BEFORE INSERT ON organization
FOR EACH ROW
WHEN NOT (
     (NEW.commercial_registration_state = 'not_recorded'
      AND NEW.commercial_registration_number IS NULL
      AND NEW.commercial_registration_declared_at IS NULL
      AND NEW.commercial_registration_recorded_at IS NULL
      AND NEW.commercial_registration_verified_by_principal_id IS NULL
      AND NEW.commercial_registration_verified_at IS NULL)
  OR (NEW.commercial_registration_state = 'not_registered'
      AND NEW.commercial_registration_number IS NULL
      AND NEW.commercial_registration_declared_at IS NOT NULL
      AND NEW.commercial_registration_recorded_at IS NULL
      AND NEW.commercial_registration_verified_by_principal_id IS NULL
      AND NEW.commercial_registration_verified_at IS NULL)
  OR (NEW.commercial_registration_state = 'registered'
      AND NEW.commercial_registration_number IS NOT NULL
      AND NEW.commercial_registration_declared_at IS NULL
      AND NEW.commercial_registration_recorded_at IS NOT NULL
      AND ((NEW.commercial_registration_verified_by_principal_id IS NULL
            AND NEW.commercial_registration_verified_at IS NULL)
        OR (NEW.commercial_registration_verified_by_principal_id IS NOT NULL
            AND NEW.commercial_registration_verified_at IS NOT NULL
            AND NEW.commercial_registration_verified_at >= NEW.commercial_registration_recorded_at)))
)
BEGIN
  SELECT RAISE(
    ABORT,
    'commercial_registration columns do not form one of the three states in organization-identity-v1. A verification must also be no older than the number it attests to: carrying one across an edited number would say an operator checked a value nobody checked.'
  );
END;

CREATE TRIGGER IF NOT EXISTS organization_commercial_registration_coherent_on_update
BEFORE UPDATE ON organization
FOR EACH ROW
WHEN NOT (
     (NEW.commercial_registration_state = 'not_recorded'
      AND NEW.commercial_registration_number IS NULL
      AND NEW.commercial_registration_declared_at IS NULL
      AND NEW.commercial_registration_recorded_at IS NULL
      AND NEW.commercial_registration_verified_by_principal_id IS NULL
      AND NEW.commercial_registration_verified_at IS NULL)
  OR (NEW.commercial_registration_state = 'not_registered'
      AND NEW.commercial_registration_number IS NULL
      AND NEW.commercial_registration_declared_at IS NOT NULL
      AND NEW.commercial_registration_recorded_at IS NULL
      AND NEW.commercial_registration_verified_by_principal_id IS NULL
      AND NEW.commercial_registration_verified_at IS NULL)
  OR (NEW.commercial_registration_state = 'registered'
      AND NEW.commercial_registration_number IS NOT NULL
      AND NEW.commercial_registration_declared_at IS NULL
      AND NEW.commercial_registration_recorded_at IS NOT NULL
      AND ((NEW.commercial_registration_verified_by_principal_id IS NULL
            AND NEW.commercial_registration_verified_at IS NULL)
        OR (NEW.commercial_registration_verified_by_principal_id IS NOT NULL
            AND NEW.commercial_registration_verified_at IS NOT NULL
            AND NEW.commercial_registration_verified_at >= NEW.commercial_registration_recorded_at)))
)
BEGIN
  SELECT RAISE(
    ABORT,
    'commercial_registration columns do not form one of the three states in organization-identity-v1. A verification must also be no older than the number it attests to: carrying one across an edited number would say an operator checked a value nobody checked.'
  );
END;

CREATE TRIGGER IF NOT EXISTS organization_vat_registration_coherent_on_insert
BEFORE INSERT ON organization
FOR EACH ROW
WHEN NOT (
     (NEW.vat_registration_state = 'not_recorded'
      AND NEW.vat_registration_number IS NULL
      AND NEW.vat_registration_declared_at IS NULL
      AND NEW.vat_registration_recorded_at IS NULL
      AND NEW.vat_registration_verified_by_principal_id IS NULL
      AND NEW.vat_registration_verified_at IS NULL)
  OR (NEW.vat_registration_state = 'not_registered'
      AND NEW.vat_registration_number IS NULL
      AND NEW.vat_registration_declared_at IS NOT NULL
      AND NEW.vat_registration_recorded_at IS NULL
      AND NEW.vat_registration_verified_by_principal_id IS NULL
      AND NEW.vat_registration_verified_at IS NULL)
  OR (NEW.vat_registration_state = 'registered'
      AND NEW.vat_registration_number IS NOT NULL
      AND NEW.vat_registration_declared_at IS NULL
      AND NEW.vat_registration_recorded_at IS NOT NULL
      AND ((NEW.vat_registration_verified_by_principal_id IS NULL
            AND NEW.vat_registration_verified_at IS NULL)
        OR (NEW.vat_registration_verified_by_principal_id IS NOT NULL
            AND NEW.vat_registration_verified_at IS NOT NULL
            AND NEW.vat_registration_verified_at >= NEW.vat_registration_recorded_at)))
)
BEGIN
  SELECT RAISE(
    ABORT,
    'vat_registration columns do not form one of the three states in organization-identity-v1. A verification must also be no older than the number it attests to: carrying one across an edited number would say an operator checked a value nobody checked.'
  );
END;

CREATE TRIGGER IF NOT EXISTS organization_vat_registration_coherent_on_update
BEFORE UPDATE ON organization
FOR EACH ROW
WHEN NOT (
     (NEW.vat_registration_state = 'not_recorded'
      AND NEW.vat_registration_number IS NULL
      AND NEW.vat_registration_declared_at IS NULL
      AND NEW.vat_registration_recorded_at IS NULL
      AND NEW.vat_registration_verified_by_principal_id IS NULL
      AND NEW.vat_registration_verified_at IS NULL)
  OR (NEW.vat_registration_state = 'not_registered'
      AND NEW.vat_registration_number IS NULL
      AND NEW.vat_registration_declared_at IS NOT NULL
      AND NEW.vat_registration_recorded_at IS NULL
      AND NEW.vat_registration_verified_by_principal_id IS NULL
      AND NEW.vat_registration_verified_at IS NULL)
  OR (NEW.vat_registration_state = 'registered'
      AND NEW.vat_registration_number IS NOT NULL
      AND NEW.vat_registration_declared_at IS NULL
      AND NEW.vat_registration_recorded_at IS NOT NULL
      AND ((NEW.vat_registration_verified_by_principal_id IS NULL
            AND NEW.vat_registration_verified_at IS NULL)
        OR (NEW.vat_registration_verified_by_principal_id IS NOT NULL
            AND NEW.vat_registration_verified_at IS NOT NULL
            AND NEW.vat_registration_verified_at >= NEW.vat_registration_recorded_at)))
)
BEGIN
  SELECT RAISE(
    ABORT,
    'vat_registration columns do not form one of the three states in organization-identity-v1. A verification must also be no older than the number it attests to: carrying one across an edited number would say an operator checked a value nobody checked.'
  );
END;
