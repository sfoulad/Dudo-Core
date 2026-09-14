-- Control-plane migration 0022 — tenant-defined custom roles.
-- `docs/decisions/0007` D16 · `docs/decisions/0043` §2 and §2d.
--
-- IT BELONGS TO `DB_CONTROL`. See 0002. Control plane and not tenant-scoped, for
-- `0003_organization_membership.sql`'s reason: a role is a grant on a membership, membership is
-- control plane, and a grant read after tenant selection is a grant that cannot be used to decide
-- tenant selection.
--
-- *** NOT APPLIED BY THE AGENT THAT WROTE IT. *** A verified D1 backup first, then the migration,
-- then the deploy. A production action requiring the user's explicit approval, every time
-- (`.claude/rules/security.md` §7).
--
-- ROLLBACK PATH: `DROP TABLE invitation_custom_role; DROP TABLE organization_membership_role;
-- DROP TABLE tenant_role_permission; DROP TABLE tenant_role;` **IN THAT ORDER** — the three child
-- tables reference the role table. Dropping them removes every custom grant, so **it fails SHUT**:
-- principals holding only custom roles lose every permission and are denied everything, which is
-- the safe direction and is also a customer-visible outage. Safe while empty; a decision once not.
-- FORWARD-ONLY and idempotent: `IF NOT EXISTS` on all four.
--
-- ORDERING — **TWO HARD DEPENDENCIES, AND THE SECOND ARRIVED WITH `0043` §7b ROW 2:**
--
--   AFTER `0018`   `organization_membership_role` references `organization_membership`, and `0018`
--                  DROPS AND RECREATES that table. Applying this first means `0018`'s `DROP TABLE`
--                  hits an inbound foreign key — which, depending on whether D1 has foreign keys
--                  enforced, either FAILS the migration or succeeds and leaves a dangling
--                  reference. **Neither is a state to discover during a migration.**
--   AFTER `0021`   `invitation_custom_role` references `invitation`. **This dependency is the
--                  reason that table is in THIS file rather than in `0021`**: a join table needs
--                  both parents, and it belongs with whichever migration is second.
--
-- =============================================================================================
-- *** NOTHING MAY REPORT CUSTOM ROLES AS AVAILABLE UNTIL THE CREATION ROUTE EXISTS. ***
-- =============================================================================================
--
-- `0043` §2d is explicit: *"The custom-role table, the creation route and the enforcement of D16's
-- four constraints at creation time are Core's, sequenced after this record… **Nothing may report
-- custom roles as available until that route exists**, and each of the four constraints is a test
-- requirement rather than a comment."*
--
-- **THIS FILE IS THE TABLE AND NOT THE FEATURE.** No route writes it, no read path consults it, and
-- `authorization/roles.ts` maps the four SEED roles and knows nothing about it. A deployment with
-- these tables applied behaves exactly as one without them.
--
-- =============================================================================================
-- D16's FOUR CONSTRAINTS, AND WHICH OF THEM A SCHEMA CAN CARRY
-- =============================================================================================
--
-- `0007` D16: *"Customers create custom roles… Four constraints keep it safe, and all four hold
-- from the first custom role."* `0043` §2a re-derives what they buy.
--
--   1. A CUSTOM ROLE MAY CONTAIN ONLY PERMISSIONS THE CREATING PRINCIPAL ITSELF HOLDS.
--      **NOT ENFORCEABLE HERE, AND IT IS THE LOAD-BEARING ONE.** It is a comparison against the
--      creator's grants at the moment of creation, so it is `architecture.md` §3a's in-statement
--      guard: the INSERT that writes a `tenant_role_permission` row carries the creator's held set
--      in its `WHERE`, and the check is re-asked in the statement that writes rather than before
--      it. A trigger could not express it either — the creator's grants are computed in code from
--      a role mapping, not stored as rows.
--      **Everything else rests on this one.** `0043` §2a: *"a subset of an enumerable set is
--      enumerable"*, which is why the scopes intersection and the platform-envelope impossibility
--      both survive custom roles — and why `assertNoRouteConjunctionIsUnsatisfiable` checking the
--      SEED roles is exact rather than approximate.
--   2. `0006` D6's SCOPES INTERSECTION APPLIES UNCHANGED. Partly here: `scope` is constrained to
--      the ladder's values. Whether a given scope is within the creator's is constraint 1 again.
--   3. NO PLATFORM PERMISSION IN A TENANT ROLE. **This one IS here** — `scope <> 'platform'` — and
--      `0043` §2a notes it FOLLOWS from 1 and 2 rather than being a special case, *"which is why it
--      cannot be forgotten."* The CHECK is a cheap second layer over a property that already holds.
--   4. NO ROLE TEMPLATES ACROSS TENANTS, NO COMPOSITION, NO INHERITANCE — deferred by D16.
--      **Enforced by absence: there is no `parent_role_id` column and no cross-tenant table.** A
--      composition feature would need a migration, which is the point.
--
-- =============================================================================================
-- A CUSTOM ROLE IS SCOPED TO ONE ORGANIZATION, IN THE KEY AND NOT IN A PREDICATE
-- =============================================================================================
--
-- `organization_id` is the LEADING column of every primary key below, so *"the roles of this
-- Organization"* is a key prefix and there is no query shape that returns another tenant's roles
-- without dropping the leading column — which is not something a predicate can be forgotten out of.
-- `0003`'s hazard is the reverse: its leading column is a PRINCIPAL, so its prefix scan IS the
-- cross-Organization list `CO1` forbids. **The two tables look alike and their prefix scans do
-- not.**
--
-- =============================================================================================
-- FREE-TIER IMPACT (.claude/rules/architecture.md §6a, docs/decisions/0008)
-- =============================================================================================
--
-- ALLOWANCES: d1-storage, d1-rows-read, d1-rows-written.
-- STORAGE: a role is ~150 bytes; a grant row is ~120; an `invitation_custom_role` row is ~110. A
-- tenant with ten custom roles of ten permissions each is ~14 KB. A hundred such tenants is under
-- 2 MB against a 500 MB ceiling.
--
-- **THE FOURTH TABLE — `invitation_custom_role` — CARRIES ITS OWN COST NOTE AT ITS DECLARATION**
-- rather than being folded in here, because its write cost belongs to the INVITATION route
-- (`0021`) and not to role creation, and summing the two in one paragraph is how a reader ends up
-- reserving the wrong number for either.
--
-- WRITES: **creating a role of N permissions costs 2 + 2N row-writes** — the role row and its key,
-- then a row and a key per grant. That is the number a create route reserves, and it is the reason
-- the route needs a declared ceiling on N rather than accepting whatever arrives: at 600
-- per-principal daily row-writes (`PER_PRINCIPAL_DAILY_ROW_WRITES`), an unbounded permission list
-- is a self-inflicted denial of service that also spends the account-wide control-plane allowance.
-- **THAT CEILING IS OWED BY THE CREATE ROUTE AND IS NOT IN THIS FILE**, because a row limit
-- expressed as a schema constraint would be a configuration cost paid as schema (`0030`).
-- READS: a principal's effective grants become one prefix scan per assigned custom role, on top of
-- the membership row already read on every authenticated request. **That is a real per-request
-- cost that the seed roles do not have**, and it is the argument for the effective set being
-- computed once per request rather than per authorization call.
-- AT THE LIMIT: role creation refuses; existing grants are unaffected because they are reads.
-- COST: USD 0 / BD 0 per month.

-- ---------------------------------------------------------------------------------------------
-- The role itself.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_role (
  organization_id         TEXT NOT NULL REFERENCES organization (organization_id),
  role_id                 TEXT NOT NULL,

  -- What the tenant calls it. Customer-supplied text, so it is DATA and never an identifier: no
  -- code may branch on it, and `AUTHORIZATION_STANDARD.md` §9's rule — *"a role name appearing in a
  -- conditional in source is a defect"* — applies with more force here than to the seed roles,
  -- because this string is chosen by someone outside Dudo.
  --
  -- *** IT WAS `display_name` UNTIL `0043` §7b ROW 4 RULED THE TWO SIDES ALIGN ON `name`. *** The
  -- contract's wire field is `name`, and a wire/column split with nothing behind it is what `0034`
  -- cost a day over. **`organization.display_name` is a different table with its own justification
  -- and does not transfer** — that column is nullable because Organizations created before `0015`
  -- have no name and never will, which is a fact about migration history rather than a naming
  -- convention.
  name                    TEXT NOT NULL,

  -- 'active' | 'retired'. A retired role grants nothing and is not assignable, and it is RETIRED
  -- rather than deleted so that an audit record naming it stays interpretable — the same reasoning
  -- `template-lifecycle-v1` applies to Templates.
  status                  TEXT NOT NULL CHECK (status IN ('active', 'retired')),

  created_at              TEXT NOT NULL,  -- RFC 3339, UTC. The server's clock.
  -- WHO CREATED IT, AND `0007` D16 CALLS CREATING A ROLE A GRANT. `0007` rule 9 requires a
  -- privilege change to be audited; this column is not that audit record and must not be mistaken
  -- for one — the record goes in the Organization's own `audit_event` (`0044` §3c).
  created_by_principal_id TEXT NOT NULL REFERENCES principal (principal_id),

  PRIMARY KEY (organization_id, role_id)
);

-- ---------------------------------------------------------------------------------------------
-- What the role grants. One row per permission.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_role_permission (
  organization_id TEXT NOT NULL,
  role_id         TEXT NOT NULL,

  -- The permission identifier, as `permission-catalog.yaml` spells it. **NO WILDCARD IS
  -- REPRESENTABLE AND THE CHECK SAYS SO** — `0007` rule 3 forbids wildcards and rule 4 requires
  -- explicit registration, and `authorization/roles.ts` records that a role is *"exactly the
  -- construct that tempts both rules to be relaxed"*. A customer-authored role is that temptation
  -- with the author outside the review process, so the refusal is in the schema as well as in the
  -- code that writes it.
  permission_id   TEXT NOT NULL CHECK (
                    permission_id <> ''
                    AND instr(permission_id, '*') = 0
                  ),

  -- The scope the grant is held at. `platform` IS REFUSED — D16 constraint 3.
  scope           TEXT NOT NULL CHECK (
                    scope IN ('organization', 'business', 'branch', 'team', 'own', 'resource')
                  ),

  PRIMARY KEY (organization_id, role_id, permission_id),

  -- Composite, so a grant cannot name a role in another Organization. Same reasoning as `0004`'s
  -- branch-to-business reference, and the same caveat: **the FK is a second layer**, because
  -- foreign-key enforcement is a runtime setting (`0003`).
  FOREIGN KEY (organization_id, role_id) REFERENCES tenant_role (organization_id, role_id)
);

-- ---------------------------------------------------------------------------------------------
-- Who holds it.
--
-- A SEPARATE TABLE RATHER THAN A COLUMN ON `organization_membership`, and the reason is not
-- normalisation: **`organization_membership.role` holds exactly one SEED role and `0019`'s unique
-- index depends on that column meaning what it says.** A membership carrying both a seed role and
-- a custom role in one column would make `WHERE role = 'owner'` a substring question.
--
-- SO A PRINCIPAL'S EFFECTIVE GRANTS ARE THE UNION OF ITS SEED ROLE AND ITS ASSIGNED CUSTOM ROLES,
-- computed in code. **`authorization/roles.ts` does not do this yet and must not be assumed to** —
-- `grantsForRole` maps one seed role and nothing else, which is the correct fail-closed state while
-- no route writes these tables.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_membership_role (
  organization_id TEXT NOT NULL,
  principal_id    TEXT NOT NULL,
  role_id         TEXT NOT NULL,

  granted_at              TEXT NOT NULL,  -- RFC 3339, UTC.
  granted_by_principal_id TEXT NOT NULL REFERENCES principal (principal_id),

  PRIMARY KEY (organization_id, principal_id, role_id),

  FOREIGN KEY (organization_id, role_id) REFERENCES tenant_role (organization_id, role_id),
  -- NOTE THE COLUMN ORDER OF THE REFERENCED KEY: `organization_membership`'s primary key is
  -- `(principal_id, organization_id)`, so the reference names them in that order. Reversing it
  -- would name no key and the constraint would be rejected — or, on a build with foreign keys off,
  -- silently do nothing.
  FOREIGN KEY (principal_id, organization_id)
    REFERENCES organization_membership (principal_id, organization_id)
);

-- ---------------------------------------------------------------------------------------------
-- *** THE CUSTOM ROLES AN INVITATION CARRIES. ADDED BY `docs/decisions/0043` §7b ROW 2. ***
-- `tenant-invitations-v1`: `custom_role_ids`, `maxItems: 20`, on both the invite input and the
-- invitation summary.
-- ---------------------------------------------------------------------------------------------
--
-- **`0021` GAVE AN INVITATION A SEED `role` AND NOTHING ELSE, AND THE CONTRACT IS THE AUTHORITY.**
-- Without this table an invitation can offer only one of four platform-defined tiers, which makes
-- `0043` §5.6's visibility promise hollow **at the one moment a grant is actually chosen** — the
-- beginning of a membership. A tenant that has authored custom roles could not invite anyone into
-- one.
--
-- *** A CHILD TABLE AND NOT A DELIMITED COLUMN, AND `0030` DECIDES IT RATHER THAN TASTE. *** That
-- record names *"packing several logical values into one column to fit a size limit"* as a schema
-- cost paid once and then paid forever. A `custom_role_ids TEXT` holding `"a,b,c"` would also make
-- the foreign key below unexpressible, and the foreign key is what stops an invitation naming a
-- role in another Organization.
--
-- === THE `maxItems: 20` CAP IS THE ROUTE'S AND IS DELIBERATELY NOT IN THIS SCHEMA ===
--
-- SQL cannot bound a child table's row count without a trigger, and `architecture.md` §3a is
-- explicit that **a trigger is a backstop and never the enforcement** — it does not survive a
-- restore, and if it is the only thing between a forbidden row and the database the design has
-- already failed. So the bound is a Core constant the route reserves against, which `0030` calls
-- **configuration** and permits: *"ceiling constants and sub-ceilings"* are reversible by changing
-- a number, where a schema shape is not.
--
-- **AND THE CAP IS A COST BOUND AS WELL AS A RENDERING ONE.** `tenant-members-v1` records that its
-- first draft bounded this at 50 and would have made one member removal cost 107 row-writes —
-- **more than a sixth of `PER_PRINCIPAL_DAILY_ROW_WRITES`** — and that it was caught by trying to
-- write the number down rather than by reasoning about roles. Raising it is a cost decision.
--
-- === THE CONTRACT'S "ROLE DELETED BETWEEN INVITATION AND ACCEPTANCE" CASE CANNOT ARISE HERE ===
--
-- The contract rules that such a role is **dropped at acceptance rather than blocking it**, on the
-- ground that refusing would hand any administrator who can delete a role the power to silently
-- break every outstanding invitation naming it. That reasoning is right and **the case it describes
-- is unreachable against this schema**, because `0043` §7b row 3 ruled that a custom role is
-- RETIRED rather than deleted — `tenant_role.status IN ('active','retired')`. A retired role's row
-- still exists, so the foreign key never dangles.
--
-- **SO "DROPPED" IS IMPLEMENTED AS "ACCEPTANCE SKIPS A ROLE WHOSE STATUS IS NOT `active`", NOT AS A
-- MISSING-ROW CASE**, and the outcome the contract wants is preserved exactly: the invitee joins
-- with LESS authority than intended, visibly and repairably, rather than being unable to join for a
-- reason nobody can see. Recorded because a reader holding the contract would otherwise look for a
-- dangling-reference path that does not exist, and might add `ON DELETE CASCADE` to create one.
--
-- ROW-WRITES: **2 per role carried** — the row and its primary key. So creating an invitation costs
-- `3 + 2N` control-plane row-writes for N custom roles: 3 for the invitation and its two index
-- entries (`0021`), plus 2 each. At the contract's cap of 20 that is **43**, against
-- `PER_PRINCIPAL_DAILY_ROW_WRITES` of 600. **The route reserves the worst case, not the typical
-- one** — `tenant-members-v1`: *"a reservation sized to the typical case is a reservation that
-- fails halfway through."*
--
-- STORAGE: two identifiers plus a primary-key entry, ~110 bytes per row. Twenty roles on each of a
-- few dozen invitations is under 100 KB.
--
-- NO SECONDARY INDEX. The only query is *"the custom roles of THIS invitation"*, which is a prefix
-- scan on the primary key. An index on `role_id` would serve *"which invitations name this role"* —
-- a question nothing asks — and would cost a row-write on every invitation write to answer it.
CREATE TABLE IF NOT EXISTS invitation_custom_role (
  organization_id TEXT NOT NULL,
  invitation_id   TEXT NOT NULL,
  role_id         TEXT NOT NULL,

  PRIMARY KEY (organization_id, invitation_id, role_id),

  -- BOTH COMPOSITE, so an invitation cannot name a role in another Organization and a role cannot
  -- be attached to another Organization's invitation. `organization_id` leads every key here, in
  -- this table and in both parents, so there is no join in this schema that crosses a tenant.
  FOREIGN KEY (organization_id, invitation_id)
    REFERENCES invitation (organization_id, invitation_id),
  FOREIGN KEY (organization_id, role_id) REFERENCES tenant_role (organization_id, role_id)
);
