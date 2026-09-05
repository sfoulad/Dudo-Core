-- Control-plane migration 0012 — the template table.
-- docs/decisions/0025 decision 2 · contract `template-v1`.
--
-- Read `0001_principal.sql` first for the shared header of this directory.
--
-- IT BELONGS TO `DB_CONTROL`. See `0008`.
--
-- NOT APPLIED. No migration runner exists and no agent may run one against real data.
--
-- ROLLBACK PATH: DROP TABLE template. Its effect is that the three Template routes answer
-- `unavailable` and no Organization can be onboarded against a business type. It destroys the
-- catalogue of business types an operator typed, which is real but small and re-creatable — no
-- tenant data is involved, because a Template contains none. FORWARD-ONLY and idempotent.
--
-- =============================================================================================
-- WHY A REGISTRY OF BUSINESS TYPES IS IN **CORE** AT ALL, AND IT TURNS ON ONE DISTINCTION
-- =============================================================================================
--
-- `CORE_BOUNDARIES.md` §6 rule 1 forbids industry nouns. "Core must know about dental clinics" is
-- an obvious violation and would make this feature unbuildable. The contract's answer:
--
--   *"RULE 1 GOVERNS TYPES, TABLES, COLUMNS, FUNCTIONS AND ROUTES. IT DOES NOT GOVERN ROWS.
--    A ROW READING 'Dental Clinic' IS DATA. A `dental_clinic` COLUMN IS A DEFECT."*
--
-- So Core knows only that a Template is a named record with labels. The word "Dental Clinic" is a
-- value an operator typed, which Core no more understands than it understands a customer's name.
--
-- *** THE CHECKABLE FORM, AND IT IS A REVIEW OBLIGATION ON EVERY CHANGE TO THIS FEATURE: ***
-- NO IDENTIFIER IN `platform/core/**` MAY NAME A BUSINESS TYPE. No `SCHOOL_LABELS` constant, no
-- `isClinic()`, no `switch (template.name)`, no seeded row that code branches on. **THE MOMENT
-- CORE READS A TEMPLATE'S NAME TO DECIDE BEHAVIOUR, THE ROW HAS BECOME A COLUMN.**
--
-- =============================================================================================
-- WHAT A TEMPLATE MAY NEVER CARRY. A PROHIBITION, NOT A GUIDELINE.
-- =============================================================================================
--
--   NO WORKFLOW — not a state machine, not an approval chain, not a sequence of steps.
--   NO VALIDATION RULE — not a required field, not a format, not a constraint on any entity.
--   NO PRICING, TAX OR DISCOUNTING RULE — §5 puts those in an App, per industry and per country.
--   NO CODE, EXPRESSION, SCRIPT, CONDITION OR TEMPLATING SYNTAX IN ANY FIELD.
--   NO PERMISSION SET AND NO ROLE DEFINITION.
--
-- WHY IT IS A PROHIBITION: `CORE_BOUNDARIES.md` §1 — *"anything specific placed in Core becomes a
-- permanent constraint on future applications... The cost of wrongly including something is a
-- constraint on every future business type, and it is effectively permanent."* A Template carrying
-- a workflow would put one industry's process in the layer every other industry shares.
--
-- THE COLUMNS BELOW ARE THE ENFORCEMENT. There is no `rules` column, no `config` blob, no JSON
-- field and no free-form map — **a schema with nowhere to put logic is a schema logic cannot be
-- put into**, and that is stronger than a rule saying not to.
--
-- =============================================================================================
-- TENANT-INDEPENDENT, AND IT MAY NEVER GAIN A TENANT COLUMN
-- =============================================================================================
--
-- A Template is PLATFORM CONFIGURATION: it names no Organization, contains no Organization's data,
-- and is identical for every tenant. **THIS IS WHY THE CAPABILITY COULD BE BUILT BEFORE AZ3** —
-- creating and listing Templates touches nothing behind `whereWithTenant`, so a platform operator
-- performing it is not reading anyone's business data even in principle.
--
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008).
--   ALLOWANCES CONSUMED: d1-storage, d1-rows-read, d1-rows-written.
--   STORAGE: a name and three short labels — under 500 bytes with indexes. THE POPULATION IS
--     BOUNDED BY HUMAN EFFORT: a business type is created by an operator typing, so the realistic
--     ceiling is tens of rows. Immeasurable against 500 MB.
--   ROWS WRITTEN: 3 per create (1 row + primary-key autoindex + the uniqueness index), charged 4
--     with the audit record. 2 per read or list — the audit record alone, because P4 makes every
--     platform route a write.
--   AT THE LIMIT: `quota_exceeded` with `Retry-After` to the next 00:00 UTC. **NOTHING DEGRADES
--     FOR ANY TENANT**, because no tenant depends on this surface.
--   COST: USD 0 / BD 0 per month. One control-plane table, no new service, no new binding.

CREATE TABLE IF NOT EXISTS template (
  -- Opaque, server-generated, 22 characters of base64url. Never meaningful, never parsed.
  --
  -- THE OPERATOR DOES NOT CHOOSE IT. A client-chosen identifier would make Templates guessable and
  -- would put a naming decision in an operator's hands on a permanent, referenced key.
  template_id     TEXT NOT NULL PRIMARY KEY,

  -- The business type as a human reads it — "School", "Dental Clinic", "Retail".
  --
  -- FREE TEXT, AND THE FREEDOM IS THE DECISION. An enum here would be the industry-noun column
  -- rule 1 forbids, and would mean adding a business type required a code deploy.
  --
  -- IT IS STORED EXACTLY AS THE OPERATOR TYPED IT. Normalisation decides COLLISION, never display.
  name            TEXT NOT NULL CHECK (length(name) > 0),

  -- The collision key: NFKC then ASCII-only case folding, so "School", "school" and "Ｓchool"
  -- (full-width) are one Template.
  --
  -- IT IS A STORED COLUMN RATHER THAN AN EXPRESSION INDEX, deliberately. SQLite can index an
  -- expression, but the normalisation is `credential-store.ts::normalizeIdentifier` — TypeScript
  -- that SQL cannot call — and reimplementing it in SQL would be a second definition of a rule
  -- three implementations already have to share. Storing the computed value keeps ONE definition.
  --
  -- WHY UNIQUENESS AT ALL: *"TWO TEMPLATES CALLED 'School' ARE INDISTINGUISHABLE TO THE OPERATOR
  -- CHOOSING ONE, and the choice is permanent for every Organization that adopts the wrong one.
  -- This is the one place a duplicate is worse than a gap."*
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) > 0),

  -- ===========================================================================================
  -- THREE LABEL COLUMNS, ONE PER STRUCTURAL LEVEL. NOT A MAP, NOT JSON.
  -- ===========================================================================================
  --
  -- The contract's closed set: `organization`, `workspace`, `branch`. NOT `team`, which is a
  -- first-class object with its own name; NOT `own` or `resource`, which are authorization scopes
  -- and not places.
  --
  -- THREE COLUMNS RATHER THAN ONE JSON BLOB, AND IT IS THE BOUNDARY DOING THE WORK. A JSON column
  -- is a place to put anything — a fourth level, a rule, a condition — and the prohibition above
  -- would then rest on review rather than on the schema. **Three named columns can hold three
  -- labels and nothing else.**
  --
  -- THEY ARE LABELS AND NOTHING ELSE. A label changes what a human reads. IT CHANGES NO
  -- AUTHORIZATION, NO SCOPE, NO PREDICATE AND NO ROUTE: `workspace` is the scope name in
  -- permission-catalog.yaml and in the scope ladder whatever a Template calls it on screen, and an
  -- Action's declared scope is never read from a Template. A LABEL THAT COULD ALTER A SCOPE WOULD
  -- BE CONFIGURATION DECIDING AUTHORIZATION, which is the shape `0007` D1 forbids.
  --
  -- `NOT NULL` WITH NO DEFAULT: the platform defaults are applied in TypeScript before the insert,
  -- so the response is always fully populated and **the clients never implement the default
  -- table** — which is what stops the web and Apple clients drifting into two different ideas of
  -- what an unlabelled level is called.
  label_organization TEXT NOT NULL CHECK (length(label_organization) > 0),
  label_workspace    TEXT NOT NULL CHECK (length(label_workspace) > 0),
  label_branch       TEXT NOT NULL CHECK (length(label_branch) > 0),

  -- 'active' | 'retired'.
  --
  -- *** NO ROUTE SETS THIS IN VERSION 1 AND EVERY TEMPLATE IS `active` FOREVER. *** The column
  -- exists because adding a field to a published response later is worse than declaring it now
  -- (contract TM-2). There is no delete and no update either (TM-1): an operator who mistypes a
  -- name cannot yet fix it. That is a stated limitation, not an oversight, and it becomes real the
  -- first time a Template is created in error.
  status          TEXT NOT NULL CHECK (status IN ('active', 'retired')),

  created_at      TEXT NOT NULL            -- RFC 3339, UTC
);

-- The uniqueness that makes a duplicate impossible. One index, one extra row-write per create,
-- already counted in the cost above.
CREATE UNIQUE INDEX IF NOT EXISTS template_by_normalized_name ON template (normalized_name);

-- NO INDEX ON `status`, and none is needed: `list` is a bounded keyset page over the primary key,
-- and there is no route that filters by status because there is no route that sets it.
--
-- NO `tenant_id`, EVER. A Template is tenant-independent platform configuration. A tenant column
-- here would make one Organization's business type invisible to another and would turn a shared
-- catalogue into per-tenant data — which is a different feature with a different contract.
--
-- THE REFERENCE FROM `organization` IS ADDED BY `0013_organization_template.sql`. Read that file
-- for why it is a separate migration and what it constrains.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS PARAGRAPH USED TO SAY, KEPT BECAUSE THE WAY IT WENT WRONG IS THE USEFUL PART:
--
--   "NO FOREIGN KEY FROM `organization` TO HERE YET... `organization-onboarding-v1` ADDS THE
--   REFERENCE. Until then this capability is COMPLETE AND INERT, and contract TM-4 requires it to
--   be reported that way rather than as 'business types now work'."
--
-- ONBOARDING LANDED (`6e00fbf`) AND DID NOT ADD IT. It validated `template_id` and wrote it
-- nowhere, because there was no column — so this sentence became false in the most misleading
-- direction available: **it told a reader the gap was closed by work that was already merged**,
-- and it was cited that way to the user twice.
--
-- A CLAUSE NAMING A FUTURE CHANGE AS THE FIX CREATES AN OBLIGATION NOBODY IS ASSIGNED TO COLLECT.
-- `workflow.md` §12's sweep is citation-driven and starts from a decision; nothing here was
-- withdrawn, so there was no decision to sweep from. The only thing that caught it was comparing
-- the claim against the schema — which happened by accident, while planning a different route.
-- ---------------------------------------------------------------------------------------------
