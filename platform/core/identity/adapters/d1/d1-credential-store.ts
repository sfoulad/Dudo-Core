/**
 * The credential D1 adapter. One statement, one table, one read.
 *
 * IT IS A SECOND FILE RATHER THAN A METHOD ON `createD1ControlPlaneStores`, AND THE SPLIT IS THE
 * SAME ONE `control-plane-store.ts` PROPERTY 3 ALREADY MAKES: each consumer receives only its
 * half, so a component cannot be turned into a path to another's tables by a later edit that
 * "already has the store handle". The identity resolver holds `IdentityControlPlaneStore` and
 * cannot read a credential; the credential verifier holds `CredentialStore` and cannot read a
 * session, a principal, a membership or the tenant directory.
 *
 * BOTH FACTORIES TAKE THE SAME `DB_CONTROL` BINDING, which is not a contradiction: the isolation
 * that matters here is between the two CONSUMERS in the Worker, not between two databases. A
 * second database would buy nothing (D1's limits are account-wide — `0014` §C.7) and would cost a
 * slot from the ten `0006` §0.3 allocates.
 *
 * IT MUST NEVER IMPORT `storage/adapters/sql/sql-compiler.ts`, for the reason stated at length in
 * `d1-control-plane-store.ts`: that compiler emits `tenant_id = ?` on everything it produces, and
 * no control-plane table has that column. The separation is one grep —
 * `platform/core/identity/**` must not mention `sql-compiler`, `TENANT_COLUMN`, or `tenant_id`.
 *
 * THERE IS NO WRITE METHOD HERE AND NONE MAY BE ADDED WITHOUT A DECISION RECORD. Enrollment is an
 * operator action performed out of band (`../../tools/seed-principal.ts`), so the running Worker
 * has no code path that creates or changes a credential. A `createCredential` here would be
 * self-service registration arriving as an implementation detail, and it would need its own
 * admission reservation, its own audit answer, and its own defence against a client that posts a
 * raw password — none of which this slice decides.
 */

import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
// NOT `internal`. This adapter deliberately has no error path once a row has been read — see the
// comment in `findByIdentifierHash`. Its absence from this import is load-bearing: adding it back
// is the first step of reintroducing the oracle.
import { unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import type {
  CredentialAlgorithm,
  CredentialRecord,
  CredentialStore,
} from '../../credential-store.ts';

type SqlRow = Record<string, unknown>;

/**
 * Reads a column WITHOUT collapsing an empty string to `null`.
 *
 * THE DISTINCTION IS THE FIX FOR THE EMPTY-SALT DEFECT. This adapter deliberately has no
 * `requiredText` helper — the one in `d1-control-plane-store.ts` maps `''` to `null` so that a
 * blank identifier is treated as corruption, which is right for a session or a membership and is
 * an oracle here. Preserving `''` lets it reach `parametersFor`, which routes it onto the miss
 * path at the miss path's cost.
 */
function text(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

export function createD1CredentialStore(database: D1Database): CredentialStore {
  return {
    async findByIdentifierHash(
      identifierHash: string,
    ): Promise<Result<CredentialRecord | null>> {
      let rows: readonly SqlRow[];
      try {
        // Point lookup on the primary key of `principal_credential`. `LIMIT 1` on a primary-key
        // equality is redundant to the engine and is written anyway, matching every other
        // statement in this directory, so that a reader never has to check whether this one is
        // the exception.
        const outcome = await database
          .prepare(
            'SELECT identifier_hash, principal_id, algorithm, iterations, salt, verifier ' +
              'FROM principal_credential WHERE identifier_hash = ? LIMIT 1',
          )
          .bind(identifierHash)
          .all<SqlRow>();
        rows = outcome.results;
      } catch {
        // THE ENGINE FAILED, WHICH IS NOT "no such account" AND MUST NOT BECOME ONE. The verifier
        // turns this into `unavailable` rather than `refused` for exactly that reason: an error
        // path that answered "refused" would tell a caller that a real account's lookup had
        // failed while an absent account's had not — an existence oracle built out of an outage.
        return err(unavailable());
      }

      if (rows.length === 0) {
        return ok(null);
      }

      // ===================================================================================
      // NO FIELD OF A CREDENTIAL ROW IS VALIDATED HERE, AND NOTHING IN THIS FUNCTION CAN RETURN
      // AN ERROR ONCE A ROW HAS BEEN READ. THAT IS THE OPPOSITE OF WHAT
      // `d1-control-plane-store.ts` DOES, AND THE DIVERGENCE IS THE WHOLE POINT.
      //
      // That file validates every stored enumeration and answers `internal()` for anything
      // unrecognised, because coercing a bad value upward would be privilege escalation by schema
      // drift. Correct there. HERE IT WOULD BE AN ACCOUNT-EXISTENCE ORACLE: any error return
      // answers differently from a miss AND costs almost nothing, because it happens before the
      // 10,000-iteration derivation. One specific account would become measurably distinguishable
      // from an absent one, on the one path reachable without authentication.
      //
      // THIS WAS NOT HYPOTHETICAL AND IT WAS FOUND BY `qa-agent`, NOT BY REVIEW. `requiredText`
      // maps an EMPTY string to `null` exactly as it maps an absent column, so a row with
      // `salt = ''` took the corruption branch, returned `internal()`, and the verifier answered
      // `unavailable` having derived nothing. `salt TEXT NOT NULL` does not exclude `''`. Nothing
      // in the shipping enrolment path writes one — but that is a fact about who has written to
      // the table, not a property of this code.
      //
      // SO EVERY VALUE IS CARRIED THROUGH RAW, INCLUDING AN EMPTY ONE, AND `parametersFor` IN
      // `credential-verifier.ts` IS THE SINGLE PLACE THAT DECIDES WHETHER A ROW IS USABLE. It
      // routes every unusable shape — empty salt, empty verifier, empty principal, unrecognised
      // algorithm, wrong iteration count — onto the dummy at the identical cost. One decision
      // point, one cost, no branch here that could grow a second one.
      //
      // `text()` RATHER THAN `requiredText()` IS THE MECHANISM: it preserves `''` as `''` instead
      // of collapsing it to `null`, so the emptiness survives to the place equipped to handle it.
      // ===================================================================================
      const row = rows[0];
      return ok({
        identifierHash: text(row, 'identifier_hash') ?? '',
        principalId: text(row, 'principal_id') ?? '',
        // The cast is a widening, not a claim. `parametersFor` re-checks the union.
        algorithm: (text(row, 'algorithm') ?? '') as CredentialAlgorithm,
        // `Number(null)` is 0 and `Number('x')` is NaN. Both fail `parametersFor`'s equality
        // check against the one supported count, so both land on the miss path.
        iterations: Number(row.iterations),
        salt: text(row, 'salt') ?? '',
        verifier: text(row, 'verifier') ?? '',
      });
    },
  };
}
