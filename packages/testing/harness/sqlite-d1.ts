/**
 * A real SQL engine behind the D1 port, using `node:sqlite`.
 *
 * WHY THIS IS NOT A STUB, AND WHY THAT MATTERS HERE. Under `docs/decisions/0006` Option A
 * there is no physical boundary between two Organizations' rows: the only thing keeping them
 * apart is `tenant_id = ?` on every statement. A test double that returned canned rows would
 * therefore verify nothing — it would be asserting that a fake honours a predicate it never
 * executes. `node:sqlite` is a Node built-in (no install, nothing to approve) running the
 * same dialect the compiler emits, so the statements under test are actually executed against
 * a table holding BOTH Organizations' rows. `TESTING_STANDARD.md` §5.1: "the test exercises
 * the actual failure mode of the architecture."
 *
 * WHAT IS FAITHFUL AND WHAT IS NOT, STATED RATHER THAN GLOSSED:
 *   - FAITHFUL: SQL text, parameter binding, `LIKE ... ESCAPE`, `IN (...)`, BINARY collation
 *     and byte-order sorting, `CHECK` constraints, primary keys, foreign keys, triggers,
 *     `RETURNING` on `INSERT`, `UPDATE` and `DELETE`, common table expressions, `PRAGMA`,
 *     and batch-as-transaction.
 *   - NOT FAITHFUL: D1's network behaviour, its query limits, its single-threaded scheduling
 *     and its own SQLite build. None of those decide isolation, which is what is under test.
 *   - NOT IMPLEMENTED, AND THE DISTINCTION MATTERS: `meta.changes`. Core's `D1Database` port
 *     does not expose it — `batch` returns `unknown[]` — so no adapter can read a rows-affected
 *     count and this double has nothing to be unfaithful ABOUT. An implementation needing to
 *     know whether a conditional write matched must use `RETURNING`, which is faithful above.
 *
 * *** THE `RETURNING` LINE IS THERE BECAUSE IT ONCE WAS NOT. *** This list exists to say what is
 * faithful, so an omission from it is not a gap in prose — it is a coverage claim that is wrong.
 * `RETURNING` was missing while the code silently flattened it, and the two facts were the same
 * fact. Anything added to `execute` that has an opinion about statement shape belongs here.
 *
 * `createSqliteDatabase` also RECORDS every statement it executes. That recording is what the
 * storage-boundary structural test (`TESTING_STANDARD.md` §5.5) asserts over: a property of
 * every statement the run emitted, rather than of the paths someone remembered to exercise.
 */

import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../../../platform/core/storage/adapters/d1/d1-store.ts';

export type RecordedStatement = {
  readonly sql: string;
  readonly parameters: readonly unknown[];
};

export type SqliteHarness = {
  /** Satisfies the structural `D1Database` interface the adapter declares. */
  readonly database: D1Database;
  /** The engine, for fixture seeding and for out-of-band verification of what landed. */
  readonly raw: DatabaseSync;
  /** Every statement executed through the port, in order. */
  readonly statements: RecordedStatement[];
  close(): void;
};

type Pending = { sql: string; parameters: unknown[] };

export function createSqliteDatabase(): SqliteHarness {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  const statements: RecordedStatement[] = [];

  /**
   * ===========================================================================================
   * THERE IS NO STATEMENT CLASSIFIER HERE ANY MORE, AND ITS ABSENCE IS THE FIX.
   * ===========================================================================================
   *
   * This function used to route `SELECT` to `.all()` and everything else to `.run()`, discarding
   * whatever the statement returned. **THAT SILENTLY FLATTENED `RETURNING` TO `[]`.** Measured on
   * this engine, same statement, before the fix:
   *
   *     raw node:sqlite .all()   ->  [{ binding_hash: 'h1' }]
   *     through this double      ->  []
   *     did the row change?      ->  yes
   *
   * *** THE ROW WAS UPDATED AND THE PORT REPORTED NOTHING. *** `confirmation-v1` §lifecycle
   * requires a conditional update that reports rows affected, and says a read-then-write is not
   * sufficient — *"this is the one place in this contract where a plausible implementation is
   * wrong in a way testing rarely catches."* Under the old classifier the CORRECT implementation
   * looked broken and the WRONG one passed unchanged. A double that favours the wrong
   * implementation is worse than no double, because a green run becomes affirmative evidence for
   * the defect.
   *
   * AND IT WAS NEVER ONLY `RETURNING`. The same classifier flattened `WITH … SELECT`, and
   * misclassified any `SELECT` preceded by a comment, because `trimStart()` removes whitespace and
   * not `--` or a block comment. Every one of those is invisible until something depends on it and
   * is then blamed on the implementation.
   *
   * ===========================================================================================
   * WHY EVERYTHING GOES THROUGH `.all()`, MEASURED RATHER THAN ASSUMED
   * ===========================================================================================
   *
   * The obvious repair is a better classifier — add `RETURNING`, add `WITH`, strip comments. That
   * is a heuristic, it has to be kept in step with SQL, and getting it wrong is exactly the defect
   * being fixed. So the classifier is DELETED instead, which is only correct if `.all()` behaves
   * identically to `.run()` for statements that return nothing.
   *
   * IT DOES, AND IT WAS MEASURED ON `node:sqlite` BEFORE THIS WAS WRITTEN. Every form the suites
   * use — `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER`, `DROP TRIGGER`, `INSERT`, `UPDATE`,
   * `DELETE`, `PRAGMA`, `WITH … SELECT`, and all three `… RETURNING` forms — executes through
   * `.all()`, **performs its write**, and returns `[]` when it produces no rows. A non-returning
   * `INSERT` run through `.all()` leaves the row in the table; that was checked directly rather
   * than inferred, because a fix that silently dropped writes would be worse than the defect.
   *
   * THE RESULT IS A DOUBLE WITH NO STATEMENT-SHAPE OPINION AT ALL. It cannot misclassify a form it
   * has never heard of, which is the property the old code could not have however carefully the
   * list was maintained.
   */
  function execute(pending: Pending): Record<string, unknown>[] {
    statements.push({ sql: pending.sql, parameters: [...pending.parameters] });
    return raw
      .prepare(pending.sql)
      .all(...(pending.parameters as never[])) as Record<string, unknown>[];
  }

  function makeStatement(pending: Pending): D1PreparedStatement {
    const statement: D1PreparedStatement = {
      bind(...values: unknown[]): D1PreparedStatement {
        return makeStatement({ sql: pending.sql, parameters: values });
      },
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        return { results: execute(pending) as unknown as T[] };
      },
    };
    // The batch path needs to run a statement that is not a SELECT; `all` would work, but
    // going through one function keeps the recording in one place.
    (statement as unknown as { __pending: Pending }).__pending = pending;
    return statement;
  }

  const database: D1Database = {
    prepare(sql: string): D1PreparedStatement {
      return makeStatement({ sql, parameters: [] });
    },
    async batch(prepared: readonly D1PreparedStatement[]): Promise<unknown[]> {
      // D1 executes a batch as a single implicit transaction, and `TenantScopedStore.write`
      // relies on exactly that: a mutation and its audit record commit together or not at all.
      raw.exec('BEGIN');
      try {
        const outcomes: unknown[] = [];
        for (const entry of prepared) {
          const pending = (entry as unknown as { __pending: Pending }).__pending;
          outcomes.push(execute(pending));
        }
        raw.exec('COMMIT');
        return outcomes;
      } catch (cause) {
        raw.exec('ROLLBACK');
        throw cause;
      }
    },
  };

  return {
    database,
    raw,
    statements,
    close(): void {
      raw.close();
    },
  };
}
