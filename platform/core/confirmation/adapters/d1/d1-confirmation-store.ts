/**
 * The confirmation D1 adapter. THE ONLY FILE IN `platform/core/confirmation/**` THAT NAMES D1.
 *
 * `CLOUDFLARE_STANDARD.md` §2: adapters are the only place a Cloudflare type may be named, and the
 * check is a grep over the domain modules that must come back empty. Nothing D1-shaped leaves this
 * file: it returns `ConfirmationStore`, which is a Core type.
 *
 * IT TAKES THE **CONTROL-PLANE** BINDING AND THERE IS NO PARAMETER FOR THE TENANT ONE. `confirmation`
 * is a control-plane table with no `tenant_id` column, and none may be added — a confirmation for
 * `customers.customer.delete` names a customer, and storing that here would put one Organization's
 * identifier in the database that spans every Organization.
 *
 * This file must never import `storage/adapters/sql/sql-compiler.ts`, for the reason
 * `d1-control-plane-store.ts` states: that compiler emits `tenant_id = ?` on every statement.
 */

import type { Result } from '../../../kernel/result.ts';
import { err, ok } from '../../../kernel/result.ts';
import { unavailable } from '../../../kernel/errors.ts';
import type { D1Database } from '../../../storage/adapters/d1/d1-store.ts';
import type { ControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import { consumeControlPlaneWriteReservation } from '../../../identity/control-plane-admission.ts';
import type { ConfirmationRecord, ConfirmationStore } from '../../confirmation-store.ts';

export function createD1ConfirmationStore(database: D1Database): ConfirmationStore {
  return {
    async issue(
      record: ConfirmationRecord,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<void>> {
      // NO ADMISSION, NO WRITE — `0014` §A.11. Throws rather than returning: no client can cause
      // this, because clients supply values and never reservations.
      consumeControlPlaneWriteReservation(reservation, 1);
      try {
        // `ON CONFLICT ... DO UPDATE` RATHER THAN A PLAIN INSERT, AND IT IS NOT LAZINESS.
        //
        // The same principal, on the same session, requesting the same operation with the same
        // parameters twice produces the SAME binding hash — which is a human clicking a button
        // twice, not an attack. A plain INSERT would fail the second click with a primary-key
        // violation, and the user would see an error for doing something reasonable.
        //
        // IT REFRESHES THE EXPIRY AND **RESETS `spent_at` TO NULL**, which is the part worth
        // stating: re-issuing is issuing. If the first confirmation had already been spent, the
        // human is being shown the statement again and agreeing again, so a fresh unspent token is
        // the correct outcome — and it is a NEW agreement, five minutes from now, not a revival of
        // the old one. The alternative, refusing to re-issue after a spend, would mean a failed
        // operation could never be retried without a new session.
        await database.batch([
          database
            .prepare(
              'INSERT INTO confirmation (binding_hash, confirmation_id, principal_id, ' +
                'expires_at, spent_at) VALUES (?, ?, ?, ?, NULL) ' +
                'ON CONFLICT (binding_hash) DO UPDATE SET ' +
                'confirmation_id = excluded.confirmation_id, ' +
                'expires_at = excluded.expires_at, spent_at = NULL',
            )
            .bind(
              record.bindingHash,
              record.confirmationId,
              record.principalId,
              record.expiresAt,
            ),
        ]);
        return ok(undefined);
      } catch {
        return err(unavailable());
      }
    },

    async spend(
      bindingHash: string,
      confirmationId: string,
      nowIso: string,
      reservation: ControlPlaneWriteReservation,
    ): Promise<Result<boolean>> {
      consumeControlPlaneWriteReservation(reservation, 1);
      // =====================================================================================
      // *** ONE STATEMENT. CHECK AND TAKE ARE THE SAME OPERATION. ***
      // =====================================================================================
      //
      // `confirmation-v1` §lifecycle: "MARKING SPENT AND READING UNSPENT MUST BE ONE OPERATION, or
      // two concurrent requests both see 'unspent' and both proceed... THIS IS THE ONE PLACE IN
      // THIS CONTRACT WHERE A PLAUSIBLE IMPLEMENTATION IS WRONG IN A WAY TESTING RARELY CATCHES."
      //
      // `spent_at IS NULL` makes it single-use. `expires_at > ?` makes the five-minute lifetime
      // part of the same atomic decision — an expiry compared in TypeScript after a read would be
      // a read-then-write with extra steps, and would pass every serial test.
      //
      // `RETURNING` IS HOW THE RESULT COMES BACK, AND IT IS USED INSTEAD OF ROWS-AFFECTED FOR A
      // CONCRETE REASON: Core's `D1PreparedStatement` exposes only `bind` and `all`, and `batch`
      // returns `unknown[]`. There is no `meta.changes` behind the port, and widening a
      // Cloudflare-shaped type to carry a row count would be a permanent cost against
      // `.claude/rules/architecture.md` §6. `RETURNING` gives the identical atomicity through the
      // interface that already exists.
      //
      // ONE ROW BACK = THIS CALL SPENT IT. ZERO ROWS = already spent, expired, or never existed —
      // three causes and one answer, which is the collapse this path wants anyway.
      //
      // *** VERIFIED ON D1'S OWN ENGINE AND ON `node:sqlite`. *** Two engines, one result: the
      // first spend returns one row, the second returns none. See `0011_confirmation.sql`.
      //
      // `.all()` RATHER THAN `.batch()`, deliberately: `batch` discards results, and the result is
      // the whole point of this statement. It is a single statement, so batch-as-transaction buys
      // nothing here — the atomicity is in the WHERE clause, not in the transaction.
      try {
        const outcome = await database
          .prepare(
            'UPDATE confirmation SET spent_at = ? ' +
              'WHERE binding_hash = ? AND confirmation_id = ? ' +
              'AND spent_at IS NULL AND expires_at > ? ' +
              'RETURNING binding_hash',
          )
          .bind(nowIso, bindingHash, confirmationId, nowIso)
          .all<{ binding_hash: string }>();
        return ok(outcome.results.length === 1);
      } catch {
        // A store failure is NOT reported as "not spent". `unavailable` fails the operation, which
        // is the correct direction: the alternative would be a caller unable to distinguish a
        // database outage from a refused confirmation, retrying, and eventually succeeding with a
        // token whose spend nobody recorded.
        return err(unavailable());
      }
    },
  };
}
