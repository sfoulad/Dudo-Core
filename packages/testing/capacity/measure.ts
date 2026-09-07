/**
 * ===========================================================================================
 * THE MEASUREMENT PRIMITIVES. Row-write cost, ledger requests, and bytes on disk.
 * ===========================================================================================
 *
 * Everything here observes the SHIPPED code paths rather than reading a declared constant. The
 * whole point of `0030`'s owed capacity model is that the arithmetic was over the register's
 * stated figures, and a figure of exactly that kind was wrong by a factor of six the day before.
 *
 * ALL THREE PRIMITIVES HAVE A LIMIT AND IT IS STATED WHERE IT BITES, NOT IN A FOOTNOTE.
 */

import type { SqliteHarness } from '../harness/sqlite-d1.ts';

/**
 * A table's TRUE row-write cost, read from the live schema.
 *
 * One row for the table, plus one for every index SQLite actually created — including the
 * `sqlite_autoindex_*` a `PRIMARY KEY` materialises. **This is the same interpretation
 * `suites/customer-directory/write-admission.ts` already asserts the tenant side against**, reused
 * rather than restated so the two cannot disagree about what D1 bills.
 *
 * THE HONEST LIMIT: `PRAGMA index_list` is not reachable through a D1 binding, so Core cannot do
 * this at runtime and this harness is not D1. It is a real SQLite database executing the real
 * migrations, which is the closest observation available without a deployed database.
 */
export function schemaRowWriteCost(harness: SqliteHarness, table: string): number {
  const indexes = harness.raw.prepare(`PRAGMA index_list(${table})`).all() as unknown[];
  return 1 + indexes.length;
}

/** The table a write statement targets, or `null` for a read. */
export function writtenTable(sql: string): string | null {
  const match = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
  return match === null ? null : match[1];
}

export type WriteBreakdown = {
  /** Table -> number of write statements against it. */
  readonly statements: Readonly<Record<string, number>>;
  /** Table -> billed row-writes (statements × the table's true cost). */
  readonly billed: Readonly<Record<string, number>>;
  readonly totalStatements: number;
  readonly totalBilled: number;
};

/**
 * What the statements a run emitted would cost D1, by table.
 *
 * *** IT COUNTS STATEMENTS, NOT AFFECTED ROWS, AND THAT IS THE KNOWN OVER-COUNT. *** A single
 * `DELETE FROM session WHERE principal_id = ?` removing four rows bills four rows plus their index
 * rows; this counts it as one. **So every figure this produces is a LOWER BOUND wherever a
 * statement is not a single-row write**, and the two places that matter are named in the report:
 * session revocation on credential reset, and any future bulk delete.
 *
 * The direction is stated because it decides how to read the model: an under-count of cost is an
 * OVER-estimate of capacity, which is the dangerous direction, and it is why the report says so
 * beside the number rather than in a footnote.
 */
export function costOfStatements(
  harness: SqliteHarness,
  from: number,
  costs: (table: string) => number,
): WriteBreakdown {
  const statements: Record<string, number> = {};
  const billed: Record<string, number> = {};
  for (const entry of harness.statements.slice(from)) {
    const table = writtenTable(entry.sql);
    if (table === null) {
      continue;
    }
    statements[table] = (statements[table] ?? 0) + 1;
    billed[table] = (billed[table] ?? 0) + costs(table);
  }
  return {
    statements,
    billed,
    totalStatements: Object.values(statements).reduce((a, b) => a + b, 0),
    totalBilled: Object.values(billed).reduce((a, b) => a + b, 0),
  };
}

/**
 * Bytes on disk, from the live database.
 *
 * ===========================================================================================
 * THIS IS THE ONE MEASUREMENT THAT DECIDES THE ANSWER, BECAUSE STORAGE IS THE ALLOWANCE THAT
 * DOES NOT EBB.
 * ===========================================================================================
 *
 * `page_count * page_size` is what SQLite has allocated, which is what D1 stores. It includes
 * free pages, so it over-reports slightly after deletes — the safe direction for a capacity
 * estimate, and stated rather than corrected because `VACUUM` is not something a deployed D1
 * database gets on a schedule.
 *
 * **IT IS NOT D1's OWN ACCOUNTING.** D1 is SQLite, so the page arithmetic is the same shape, but
 * Cloudflare's reported database size is not something this harness can see. Treat these as
 * measured bytes for a schema and a row shape, not as a billing figure.
 */
export function databaseBytes(harness: SqliteHarness): number {
  const pageCount = harness.raw.prepare('PRAGMA page_count').get() as { page_count: number };
  const pageSize = harness.raw.prepare('PRAGMA page_size').get() as { page_size: number };
  return pageCount.page_count * pageSize.page_size;
}

/** Every table in the database, excluding SQLite's own. */
export function userTables(harness: SqliteHarness): string[] {
  return (
    harness.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

/**
 * Counts calls into a port by wrapping it.
 *
 * ===========================================================================================
 * THIS IS HOW DURABLE OBJECT REQUESTS ARE COUNTED, AND THE MAPPING IS THE CLAIM.
 * ===========================================================================================
 *
 * **The Durable Object adapter is executed by nothing here** — `README.md` says so and it is still
 * true. What IS measurable is how many times a request calls the admission port and the request
 * coordinator, and in deployment each of those calls is one Durable Object request: the day ledger
 * is a single global instance (`write-admission.ts`), and the coordinator is one instance per
 * Organization.
 *
 * SO THE COUNT IS EXACT AND THE MAPPING IS AN INFERENCE FROM THE ADAPTER'S SHAPE, not a
 * measurement of the adapter. That distinction is carried into the report rather than dissolved
 * into a single number.
 */
export function countingProxy<T extends object>(
  inner: T,
  onCall: (method: string) => void,
): T {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        onCall(String(property));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;
}
