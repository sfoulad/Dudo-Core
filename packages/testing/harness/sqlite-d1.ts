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
 *     and byte-order sorting, `CHECK` constraints, primary keys, and batch-as-transaction.
 *   - NOT FAITHFUL: D1's network behaviour, its query limits, its single-threaded scheduling
 *     and its own SQLite build. None of those decide isolation, which is what is under test.
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

  function execute(pending: Pending): Record<string, unknown>[] {
    statements.push({ sql: pending.sql, parameters: [...pending.parameters] });
    const prepared = raw.prepare(pending.sql);
    const trimmed = pending.sql.trimStart().toUpperCase();
    if (trimmed.startsWith('SELECT')) {
      return prepared.all(...(pending.parameters as never[])) as Record<string, unknown>[];
    }
    prepared.run(...(pending.parameters as never[]));
    return [];
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
