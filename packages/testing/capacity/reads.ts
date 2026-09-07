/**
 * ===========================================================================================
 * ROWS READ. The allowance the write model left open, and it has a different shape.
 * ===========================================================================================
 *
 * D1 bills **5,000,000 rows read per day, account-wide**, and Cloudflare's words on exceeding it
 * are the same as for writes: *"you will not be able to run queries against D1."* Not billed —
 * **stopped**.
 *
 * ===========================================================================================
 * WHY A ROW-READ MODEL CANNOT BE A COUNT OF ROWS RETURNED
 * ===========================================================================================
 *
 * A query that returns 25 rows may read 25 or may read the whole table, and **which one it is
 * depends on the query plan, not on the result**. So this measures the plan.
 *
 *   **SEARCH … USING INDEX** — the engine descends an index. Rows read is a small constant,
 *   independent of table size.
 *   **SCAN …** — the engine steps through every row. **Rows read IS the table size**, and grows
 *   with history whatever the page size says.
 *
 * `EXPLAIN QUERY PLAN` over the real schema answers this exactly, and it is the one thing about
 * read cost this harness can establish rather than estimate.
 *
 * ===========================================================================================
 * WHAT IS ESTIMATED, AND WHY THE ANSWER IS INSENSITIVE TO IT
 * ===========================================================================================
 *
 * D1 counts index rows as rows read, so a SEARCH is not free — it is a handful. This model
 * charges a flat `SEARCH_ROWS` per indexed lookup, which is a guess.
 *
 * **IT DOES NOT MATTER, AND THE PROGRAM DEMONSTRATES THAT RATHER THAN ASSERTING IT.** When one
 * query scans a table of tens of thousands of rows, the difference between charging 1 and
 * charging 10 for each of a dozen index lookups is lost in the rounding. The runner prints the
 * answer at both, so a reader can see the insensitivity instead of taking my word for it.
 */

import type { SqliteHarness } from '../harness/sqlite-d1.ts';

/** A flat charge per indexed lookup. See the header for why the answer does not turn on it. */
export const SEARCH_ROWS = 2;

export type QueryRead = {
  readonly sql: string;
  readonly plan: string;
  /** Tables this query SCANS. Rows read grows with each of them. */
  readonly scans: readonly string[];
  /** Number of indexed lookups. Bounded. */
  readonly searches: number;
  /** True if the plan sorts into a temporary B-tree — a second pass over the scanned rows. */
  readonly temporarySort: boolean;
};

export type OperationReads = {
  readonly operation: string;
  readonly queries: readonly QueryRead[];
  readonly scannedTables: readonly string[];
  readonly totalSearches: number;
};

/**
 * Classifies one statement by its plan.
 *
 * IT RUNS `EXPLAIN QUERY PLAN` WITH THE REAL PARAMETERS, because SQLite's plan can depend on
 * them. A plan taken without them would be a plan for a different query.
 */
export function classify(harness: SqliteHarness, sql: string, parameters: readonly unknown[]): QueryRead | null {
  if (!/^\s*SELECT/i.test(sql)) {
    return null;
  }
  let rows: { detail: string }[];
  try {
    rows = harness.raw
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(parameters as never[])) as { detail: string }[];
  } catch {
    // A statement this database cannot plan — it belongs to the other database. Reported as
    // unclassifiable rather than counted as free, which is the direction that matters.
    return null;
  }
  const details = rows.map((row) => row.detail);
  const plan = details.join(' | ');
  const scans: string[] = [];
  let searches = 0;
  // ===========================================================================================
  // *** `SCAN t USING INDEX i` IS NOT A TABLE SCAN, AND TREATING IT AS ONE UNDER-REPORTS A FIX. ***
  // ===========================================================================================
  //
  // SQLite says `SCAN` whenever there is no search key — including when it walks an INDEX in
  // order. With the index supplying the `ORDER BY` and a `LIMIT` on the query, the engine reads
  // as many entries as the limit and stops. **That is bounded**, and the tell is the ABSENCE of
  // `USE TEMP B-TREE FOR ORDER BY`: a plan that sorts into a temp B-tree must first materialise
  // every row, so the limit saves nothing.
  //
  // THIS CLASSIFIER FIRST KEYED ON THE WORD `SCAN` ALONE. When `0016` added the ordering index,
  // the platform feed went from `SCAN … | USE TEMP B-TREE` to `SCAN … USING INDEX …` — a real
  // fix — and the classifier **would have reported it as still unbounded.** I would have told the
  // Team Lead a correct migration had not worked.
  const sortsInTemporaryBTree = /USE TEMP B-TREE/.test(plan);
  for (const detail of details) {
    const scan = /^SCAN (\w+)(?: USING (?:COVERING )?INDEX)?/.exec(detail);
    if (scan !== null) {
      const walksAnIndex = /USING (?:COVERING )?INDEX/.test(detail);
      // An index walk is unbounded ONLY if something forces every row to be visited anyway.
      if (!walksAnIndex || sortsInTemporaryBTree) {
        scans.push(scan[1]!);
      } else {
        searches += 1;
      }
      continue;
    }
    if (/^SEARCH /.test(detail)) {
      searches += 1;
    }
  }
  return {
    sql: sql.replace(/\s+/g, ' ').slice(0, 96),
    plan,
    scans,
    searches,
    temporarySort: /USE TEMP B-TREE/.test(plan),
  };
}

/** Every SELECT an operation emitted, classified. */
export function classifyStatements(
  operation: string,
  harness: SqliteHarness,
  from: number,
): OperationReads {
  const queries: QueryRead[] = [];
  for (const entry of harness.statements.slice(from)) {
    const classified = classify(harness, entry.sql, entry.parameters);
    if (classified !== null) {
      queries.push(classified);
    }
  }
  return {
    operation,
    queries,
    scannedTables: [...new Set(queries.flatMap((query) => query.scans))],
    totalSearches: queries.reduce((total, query) => total + query.searches, 0),
  };
}

/**
 * Rows read for one operation, given how big each table currently is.
 *
 * A SCANNED table contributes its whole row count. A temporary sort is charged a SECOND pass over
 * the same rows — SQLite materialises them to sort — which is the honest reading of what the
 * engine steps through, and it is flagged rather than folded in silently.
 */
export function rowsRead(
  reads: OperationReads,
  tableRows: (table: string) => number,
  chargePerSearch = SEARCH_ROWS,
): number {
  let total = reads.totalSearches * chargePerSearch;
  for (const query of reads.queries) {
    for (const table of query.scans) {
      total += tableRows(table) * (query.temporarySort ? 2 : 1);
    }
  }
  return total;
}
