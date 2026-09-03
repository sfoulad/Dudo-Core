/**
 * The D1 adapter. THE ONLY FILE IN `platform/core/**` OR `apps/**` THAT NAMES D1.
 *
 * CLOUDFLARE_STANDARD.md §2: "Adapters are the only place `D1Database`, `R2Bucket`,
 * `Queue`, `DurableObjectNamespace`, `Fetcher`, `WorkflowEntrypoint`, `ExecutionContext`,
 * or `Env` may be named", and the check is a grep over the domain modules that must come
 * back empty. That grep passes only if this file is the whole exception, so nothing D1
 * shaped leaves it: `createD1TenantStore` returns a `TenantScopedStore`, which is a Core
 * type describing rows and specs.
 *
 * THE BINDING TYPE IS DECLARED HERE RATHER THAN IMPORTED. `@cloudflare/workers-types` is
 * an npm package and ADR 0003 approves no npm package (".claude/rules/architecture.md" §6:
 * "Approval of TypeScript and Cloudflare is NOT approval of any npm package"). The
 * structural interface below describes exactly the four calls this adapter makes. A real
 * D1 binding satisfies it structurally, and so does a local SQLite harness, which is what
 * lets the SQL be exercised without a Cloudflare runtime and without installing anything.
 *
 * ADR 0003 also says bindings, not REST. Nothing here constructs a URL or a fetch.
 *
 * IT IS ALSO WHERE `docs/decisions/0014` §A.11 IS ENFORCED. Because this is the only file that
 * can reach D1, a check here is a check on every write in the platform: `write` refuses to
 * compile a statement without a valid, unspent, correctly-sized reservation for the tenant this
 * handle serves. A writer that bypasses the admission port is therefore not a writer that broke
 * a convention — it is code that cannot be written without editing this file, which is the same
 * review surface the tenant predicate has.
 */

import type {
  DeleteSpec,
  InsertSpec,
  Row,
  SelectSpec,
  TenantScopedStore,
  UpdateSpec,
  WriteOperation,
} from '../../store.ts';
import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { internal, unavailable } from '../../../kernel/errors.ts';
import type { WriteReservation } from '../../../protection/write-admission.ts';
import { consumeWriteReservation } from '../../../protection/write-admission.ts';
import {
  compileDelete,
  compileInsert,
  compileSelect,
  compileUpdate,
} from '../sql/sql-compiler.ts';
import type { CompiledStatement } from '../sql/sql-compiler.ts';

/** The subset of the D1 binding surface this adapter uses. */
export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type D1Database = {
  prepare(sql: string): D1PreparedStatement;
  /** D1 executes a batch as a single implicit transaction. That is what `write` relies on. */
  batch(statements: readonly D1PreparedStatement[]): Promise<unknown[]>;
};

function prepare(database: D1Database, statement: CompiledStatement): D1PreparedStatement {
  return database.prepare(statement.sql).bind(...statement.parameters);
}

function compileWrite(tenantId: string, operation: WriteOperation): CompiledStatement {
  switch (operation.kind) {
    case 'insert':
      return compileInsert(tenantId, operation.spec as InsertSpec);
    case 'update':
      return compileUpdate(tenantId, operation.spec as UpdateSpec);
    case 'delete':
      return compileDelete(tenantId, operation.spec as DeleteSpec);
    default: {
      const unreachable: never = operation;
      throw new Error(`Unsupported write operation: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Creates a handle bound to one tenant.
 *
 * `tenantId` is a closure variable, not a parameter of any method on the returned object.
 * A caller therefore cannot pass a different one, cannot omit it, and cannot read it back
 * off the handle: there is no accessor. The only way to obtain a handle for another
 * Organization is to ask `TenantStoreResolver` for one, which is Core-side and takes the
 * value from the authenticated context.
 *
 * NOT EXPORTED FOR GENERAL USE: the composition root passes this factory to the resolver.
 * An App never sees it, and never sees `database`.
 */
export function createD1TenantStore(database: D1Database, tenantId: string): TenantScopedStore {
  return {
    async select(spec: SelectSpec): Promise<Result<readonly Row[]>> {
      let statement: CompiledStatement;
      try {
        statement = compileSelect(tenantId, spec);
      } catch (cause) {
        // A spec that names the tenant column, or an invalid identifier, is a defect in
        // Dudo's code rather than a bad request. It becomes `internal`, which discloses
        // nothing, and the request stops.
        return err(internal());
      }
      try {
        const outcome = await prepare(database, statement).all<Record<string, unknown>>();
        return ok(outcome.results as unknown as readonly Row[]);
      } catch (cause) {
        // The engine is down or the statement failed. The caller learns neither which.
        return err(unavailable());
      }
    },

    async write(
      operations: readonly WriteOperation[],
      reservation: WriteReservation,
    ): Promise<Result<void>> {
      // =====================================================================================
      // NO ADMISSION, NO WRITE. docs/decisions/0014 §A.11, enforced at the only file that
      // names D1 — which is what makes "direct D1 writes outside the port are prohibited" a
      // property of the code rather than a sentence in a standard.
      // =====================================================================================
      //
      // THIS RUNS BEFORE THE EMPTY-BATCH SHORT-CIRCUIT, DELIBERATELY. A caller that presents a
      // forged, foreign or already-spent reservation is a defect whether or not it happens to
      // have brought any statements, and letting the empty case through would leave one path
      // on which the guard does not run — which is one path on which it could be developed
      // against.
      //
      // IT THROWS rather than returning an error, exactly like the tenant-column guard above.
      // No client can cause this: clients supply values, never reservations. What it catches
      // is Dudo's own code writing to an ACCOUNT-WIDE allowance without accounting for it,
      // which must stop the request rather than be handled, logged and shipped.
      consumeWriteReservation(reservation, tenantId, operations.length);

      if (operations.length === 0) {
        return ok(undefined);
      }
      let statements: D1PreparedStatement[];
      try {
        statements = operations.map((operation) =>
          prepare(database, compileWrite(tenantId, operation)),
        );
      } catch (cause) {
        return err(internal());
      }
      try {
        // One batch, one transaction. This is what lets a mutation and its audit record
        // commit together rather than in a stated order with a stated failure mode.
        await database.batch(statements);
        return ok(undefined);
      } catch (cause) {
        return err(unavailable());
      }
    },
  };
}
