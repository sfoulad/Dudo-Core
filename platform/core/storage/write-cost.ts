/**
 * ===========================================================================================
 * WHAT ONE WRITE ACTUALLY COSTS. The conversion between "rows Dudo writes" and "rows D1 bills".
 * ===========================================================================================
 *
 * `docs/decisions/0014` §A.3 sets the platform ceiling in **estimated row-writes per day**, and
 * §A.7 estimates a Customer create at two of them — "the customer row and its audit row". Those
 * are two different units, and this file is the whole of the difference.
 *
 * CLOUDFLARE'S RULE, quoted rather than paraphrased because the arithmetic turns on it
 * (`workers/platform/pricing/`, "Rows written", definition 6, verified 2026-09-02):
 *
 *   "Indexes will add an additional written row when writes include the indexed column, as
 *    there are two rows written: one to the table itself, and one to the index."
 *
 * So one INSERT is not one row written. It is **one row for the table plus one row for every
 * index the write touches.** A composite `PRIMARY KEY` on a rowid table is an index too — SQLite
 * materialises it as `sqlite_autoindex_*` — and every table in this repository is a rowid table
 * with a composite primary key (`platform/core/migrations/`, `apps/customers/data/migrations/`).
 *
 * ===========================================================================================
 * THE CONSEQUENCE, STATED BEFORE THE NUMBERS SO IT IS NOT MISSED
 * ===========================================================================================
 *
 * `0014` §A.7's "two units" counts ROWS INSERTED. Under the rule above the same operation costs
 * **eight ROW-WRITES**, which is the unit §A.3's ceiling is denominated in. §A.8's "at most 5,000
 * customers/day" therefore does not follow from §A.6's 10,000/day Organization ceiling; the
 * figure that follows is 1,250.
 *
 * THIS IS REPORTED, NOT DECIDED HERE. The numbers `0014` fixes — 80,000, 20,000, 60,000/10,000/
 * 10,000, 10,000 per Organization — are implemented exactly as decided. What this file changes is
 * only the ESTIMATE of what a given operation consumes, and it changes it in the direction §A.12
 * requires: *"Erring toward over-reserving is the safe direction: the failure mode of
 * over-reserving is a delayed write, and of under-reserving is a platform outage."* Charging two
 * where D1 bills eight is under-reserving by a factor of four, and would leave the platform
 * ceiling permitting roughly 320,000 real row-writes against an enforced 100,000 — the outage
 * `0014` exists to prevent, with a budget in front of it that says it is fine.
 *
 * The same correction applies to `0014`'s Context table, in the direction that strengthens it:
 * the permitted 86,400 requests/day at two units was calculated as 172,800 (1.73x the allowance);
 * at eight it is 691,200, or 6.9x.
 *
 * ===========================================================================================
 * WHY THIS IS AN ESTIMATE AND NOT A MEASUREMENT — `0014` §A.13
 * ===========================================================================================
 *
 * Dudo cannot read Cloudflare's counter. Nothing here queries an account, an analytics API or a
 * `meta.rows_written` field, and no number below is a reading of one. These are counted from the
 * migration files by hand and are conservative by construction:
 *
 *   - every index is charged on EVERY write to the table, including an UPDATE that does not
 *     touch an indexed column and would in reality write fewer index rows;
 *   - the implicit primary-key index is charged, even though it is not certain that D1's
 *     `rows_written` counts it;
 *   - an unknown table is charged `DEFAULT_ROW_WRITES_PER_STATEMENT`, which is higher than every
 *     table in this repository actually costs.
 *
 * Each of those makes the estimate too large. That is the required direction, and it is the only
 * direction in which being wrong is safe.
 *
 * WHEN A MIGRATION ADDS AN INDEX, THE NUMBER HERE MUST MOVE WITH IT. There is no mechanism that
 * can notice: D1 exposes no portable schema introspection through the binding, and reading
 * `sqlite_schema` at startup would spend reads on every isolate. So this is a review obligation,
 * stated as one, and the constants sit beside the tables they describe in the comments below.
 */

/**
 * A table with one index costs two row-writes per statement; with four, five.
 *
 * `audit_event` (`platform/core/migrations/0001_audit_event.sql`):
 *   1 table row
 * + PRIMARY KEY (tenant_id, audit_event_id)                  implicit index
 * + audit_event_by_tenant_time
 * + audit_event_by_tenant_target
 * + audit_event_by_tenant_principal_decision_time
 * = 5.
 *
 * THIS IS THE MOST EXPENSIVE ROW IN THE PLATFORM, and the cost is the price of the security
 * properties three separate decisions bought: the trail readable newest-first, "what happened to
 * this record", and the denial-run aggregation `0013` added. It is charged on every audited
 * mutation, which is every mutating Action in the Customer Directory.
 */
export const AUDIT_EVENT_ROW_WRITES = 5;

/**
 * `denial_summary` (`platform/core/migrations/0003_denial_summary.sql`):
 *   1 table row
 * + PRIMARY KEY (tenant_id, denial_summary_id)               implicit index
 * + denial_summary_by_tenant_principal_window
 * + denial_summary_by_tenant_window
 * = 4.
 *
 * `0013`'s ceilings were denominated in SUMMARIES, one permit per summary. They are now
 * denominated in row-writes through this constant, because a ceiling that counts summaries cannot
 * be added to a ceiling that counts row-writes, and `0014` §A.5 requires exactly that addition —
 * security evidence is an allocation INSIDE the 80,000, not a budget beside it. See
 * `protection/coordination.ts`.
 */
export const DENIAL_SUMMARY_ROW_WRITES = 4;

/**
 * `business` (`platform/core/migrations/0002_business.sql`):
 *   1 table row + PRIMARY KEY (tenant_id, business_id) implicit index = 2.
 *
 * Nothing in this repository writes a Business — Business CRUD is the organization-structure
 * slice — so this is declared for the writer that will exist rather than for one that does.
 */
export const BUSINESS_ROW_WRITES = 2;

/**
 * What a statement against an unrecorded table is charged.
 *
 * FOUR, AND THE NUMBER IS A FLOOR ON HONESTY RATHER THAN A GUESS. Every table in this repository
 * costs between 2 and 5, so 4 over-charges three of the four and under-charges only
 * `audit_event`, which is recorded above and therefore never falls back to this. An App that adds
 * a table and does not declare its Action's cost pays this instead of a number it chose — the
 * fail-closed direction, because forgetting costs more rather than less.
 *
 * It is NOT a licence to leave tables undeclared. A table with five indexes charged four is an
 * under-estimate, and under-estimating is the failure mode §A.12 calls an outage.
 */
export const DEFAULT_ROW_WRITES_PER_STATEMENT = 4;

/**
 * The `customer` table's cost, recorded here for the arithmetic in this file's header and NOT
 * used by Core.
 *
 *   1 table row
 * + PRIMARY KEY (tenant_id, customer_id)                     implicit index
 * + customer_by_tenant_business_status_name
 * = 3.
 *
 * CORE DOES NOT LOOK THIS UP, and must not: `CORE_BOUNDARIES.md` §6 rule 2 — `platform/core/**`
 * never depends on `apps/**`, and a Core table of App table costs is that dependency written as
 * data. The App declares it, once, on the Action that produces the write
 * (`action.ts`, `maxRowWrites`), which is also the only place that knows how many statements the
 * Action emits. This constant exists so a reviewer can check the App's declaration against the
 * migration without leaving this file.
 */
export const CUSTOMER_TABLE_ROW_WRITES_FOR_REFERENCE = 3;
