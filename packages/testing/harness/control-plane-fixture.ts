/**
 * ===========================================================================================
 * A CONTROL-PLANE DATABASE BUILT FROM THE REAL MIGRATION FILES.
 * ===========================================================================================
 *
 * The AZ2 login suites verify two claims that a hand-written schema would quietly invalidate:
 *
 *   * that the column `principal_credential.verifier` holds a SERVER-SIDE hash and never the
 *     client's KDF output (`docs/decisions/0015` §D, migration `0006`), and
 *   * that an unknown Organization fails closed through `tenant_directory` (`0006` §0.2).
 *
 * Both are claims about what the SHIPPING migration says. So this fixture reads
 * `platform/core/migrations/control-plane/*.sql` off disk and executes them, rather than
 * restating the DDL. If a migration is edited and a suite still passes, the suite passed against
 * the edit — which is the only version of the property worth testing.
 *
 * `PRAGMA foreign_keys = ON` is already set by `createSqliteDatabase`, and it is load-bearing
 * here: `principal_credential.principal_id` references `principal`, and
 * `tenant_directory.organization_id` references `organization`. A fixture that seeded a
 * credential for a principal that does not exist would be testing a state the real database
 * cannot hold.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createSqliteDatabase } from './sqlite-d1.ts';
import type { SqliteHarness } from './sqlite-d1.ts';

/** Resolved from this file, so the fixture does not depend on the process working directory. */
const MIGRATION_DIRECTORY = new URL(
  '../../../platform/core/migrations/control-plane/',
  import.meta.url,
);

/**
 * The control-plane migrations this fixture applies, in order.
 *
 * ===========================================================================================
 * WIDENED 2026-09-05, AND THE REASON IS A REAL COUPLING RATHER THAN CONVENIENCE.
 * ===========================================================================================
 *
 * This list used to omit `0003_organization_membership.sql` on the stated principle that "no AZ2
 * suite reads them, and applying a migration a suite does not need would hide a missing dependency
 * rather than reveal one". THAT PRINCIPLE STILL HOLDS; ITS PREMISE STOPPED BEING TRUE.
 *
 * `d1-control-plane-store.ts::findPrincipal` now reads `platform_operator` and
 * `organization_membership` in the SAME statement that reads `principal`, as two correlated
 * `EXISTS` subqueries — that is the Action-side mutual exclusion (`docs/decisions/0024` as amended
 * 2026-09-05, `0025` decision 1), and it runs on EVERY authenticated request. `core-agent` records
 * the consequence in that file in capitals: *"a database without `platform_operator` makes this
 * statement fail, `selectRows` returns `unavailable()`, and NOTHING AUTHENTICATES."*
 *
 * So a control plane without `0003` and `0008` is not a narrower fixture, it is an INVALID one: no
 * principal can authenticate in it. Five session-revocation cases went red on
 * `issueSession` returning `unavailable` the moment that change landed, and they were right to.
 * `0007_membership_role.sql` comes with `0003` because the membership projection selects `role`.
 *
 * THIS IS A FIXTURE CORRECTION AND NOT A TEST BEING WEAKENED. No assertion changed; the database
 * the assertions run against now matches the schema Core requires. The five cases pass again
 * because the fixture is right, not because the bar moved.
 */
/**
 * ===========================================================================================
 * DERIVED FROM DISK SINCE 2026-09-13. IT WAS A HAND-MAINTAINED LIST AND IT WENT STALE TWICE.
 * ===========================================================================================
 *
 * The transcribed list is kept below, struck, because the reasons attached to individual
 * entries are worth reading and `workflow.md` §12 keeps a struck ruling visible when it was
 * right on its own terms.
 *
 * **Why it changed:** this repository keeps TWO control-plane migration lists, and `0043`/`0044`
 * landed six migrations in one morning. `platform-fixture.ts` was repaired first, its case went
 * green, and **this list stayed at seventeen** — the exact repeat its own note had predicted.
 * The cost, in `core-agent`'s words: *"the fixtures never apply the six migrations, so every case
 * runs against a schema with no `invitation`, no `branch` and no owner index — AND PASSES,
 * proving nothing about any of them."*
 *
 * **A hardcoded 17 against a directory holding 23 is two copies of one fact and only one of them
 * moves.** That is the user's counts ruling in a different file type, and the remedy is the same:
 * derive it.
 *
 * *** THE DEFAULT IS "APPLY IT", AND THAT IS THE FAIL-SAFE DIRECTION. *** `platform-fixture.ts`
 * already states the governing principle — **a fixture matches production unless there is a
 * stated reason it should not** — so a new migration joining automatically is the behaviour that
 * principle asks for. An omission becomes a declared exception rather than an accident of
 * nobody editing an array (`architecture.md` §3a-i: key the predicate on the exception).
 *
 * *** WHAT DERIVING COSTS, STATED RATHER THAN GLOSSED. *** `harness-fidelity.ts` compared this
 * list against the directory, and **that comparison is now `derived === derived` and cannot
 * fail** — `§11a`'s two-derivations-one-scope, which is exactly the trap this change could have
 * walked into. It is replaced there by a POPULATION PIN a human must move, so a new migration
 * still prompts somebody to look, **without the fixture lagging production while they do.**
 */
const DELIBERATE_OMISSIONS: Readonly<Record<string, string>> = Object.freeze({});

export const APPLIED_MIGRATIONS: readonly string[] = Object.freeze(
  readdirSync(MIGRATION_DIRECTORY)
    .filter((entry) => entry.endsWith('.sql'))
    .filter((entry) => !(entry in DELIBERATE_OMISSIONS))
    .sort(),
);

/* THE RETIRED HAND-MAINTAINED LIST, kept verbatim as a COMMENT rather than as an unused
   constant — see the note on the same change in `platform-fixture.ts`. The entries below carry
   the reasons individual migrations were added, which is the half worth keeping.

  '0001_principal.sql',
  '0002_organization.sql',
  '0003_organization_membership.sql',
  '0004_session.sql',
  '0005_tenant_directory.sql',
  '0006_principal_credential.sql',
  '0007_membership_role.sql',
  '0008_platform_operator.sql',
  // ===========================================================================================
  // *** THE FULL SET, AS OF 2026-09-07. THE PARTIAL SET IS ABANDONED AND HERE IS WHAT IT COST. ***
  // ===========================================================================================
  //
  // The Team Lead asked whether there was a reason this fixture was deliberately partial, because
  // that reason would be worth knowing. **There was, it is stated in this file's header, and it
  // has now failed three times in the same fixture.**
  //
  // THE REASON: *"applying a migration a suite does not need would hide a missing dependency
  // rather than reveal one."* Each omission was a TRIPWIRE — if login ever began consulting the
  // omitted table, these suites would go red and say so. It is a real property and it paid once,
  // when `findPrincipal` started reading `platform_operator` and five cases went red.
  //
  // WHY IT IS ABANDONED ANYWAY, and the sharper argument is the Team Lead's: **a partial
  // migration set is not a smaller version of production, it is a DIFFERENT SCHEMA.** A later
  // migration written against production's schema can fail against it for reasons that have
  // nothing to do with what the suite tests. `0016` creates two indexes ON `platform_operator_action`
  // — a table `0009` creates and this fixture omitted — so `CREATE INDEX` failed, and **five login
  // cases went red because of an index on a table logins never touch.** `IF NOT EXISTS` guards
  // the index, not the table.
  //
  // WHAT IS LOST, STATED RATHER THAN GLOSSED: the tripwire. If a future login path starts reading
  // `template` or `confirmation`, these suites will no longer go red to announce it.
  //
  // WHY THAT IS AN ACCEPTABLE TRADE: the tripwire never fired as a clean signal. Both times it
  // fired it was an unrelated crash — `unavailable` from a failed statement, then `no such table`
  // — that had to be diagnosed before it meant anything. And the migration census in
  // `suites/harness/harness-fidelity.ts` already forces the question on EVERY migration, by name,
  // at the moment it lands. **The census is the tripwire, and it is the one that reports rather
  // than crashes.**
  //
  // ===========================================================================================
  // *** THE THIRTY-NINE RED CASES WERE THE GOOD OUTCOME. DO NOT "FIX" THIS BY SKIPPING. ***
  // ===========================================================================================
  //
  // When `0016` could not be applied over a partial set, thirty-nine cases went red immediately,
  // at the point of the mistake, naming the failing statement. **That is the behaviour this list
  // is supposed to have**, and it is worth saying so explicitly because the obvious repair is the
  // wrong one: wrapping the loop in a `try`/`catch`, or teaching it to skip a migration whose
  // dependency is absent, would turn a loud immediate failure into a fixture that quietly runs
  // against a schema nobody chose.
  //
  // **A suite passing against a silently-reduced schema is the failure mode; a suite that will not
  // start is not.** If a migration in this list cannot be applied, the answer is to apply what it
  // depends on — never to make the failure quieter.
  '0009_platform_operator_action.sql',
  '0010_platform_operator_mutual_exclusion.sql',
  '0011_confirmation.sql',
  '0012_template.sql',
  '0013_organization_template.sql',
  '0014_platform_operator_action_organization.sql',
  '0015_organization_identity.sql',
  '0016_platform_operator_action_indexes.sql',
  // ADDED 2026-09-13 — the index on `organization.template_id`, and it is the SECOND list that
  // needed it. `platform-fixture.ts`'s `PLATFORM_MIGRATIONS` was updated first, on its own drift
  // case going red; **this one stayed short and a DIFFERENT check in a DIFFERENT suite caught it**
  // — `applied + deliberately omitted covers every control-plane migration on disk`.
  //
  // *** TWO LISTS, TWO CHECKS, AND THAT IS THE POINT RATHER THAN DUPLICATION. *** Fixing the first
  // did not fix the second and nothing linked them: `workflow.md` §12's *budget for MORE homes than
  // you find*, at the smallest possible scale. **The reason it cost one red instead of a silent
  // divergence is that each list has its own check comparing it against the DIRECTORY** — neither
  // asserts a count, so neither could be satisfied by the other's repair.
  '0017_organization_template_index.sql',
  // ADDED 2026-09-13 — Milestone 2's six, and **the note four lines up predicted this exactly.**
  // It records that this repository keeps TWO control-plane migration lists, that a previous
  // author fixed one and not the other, and that the only reason it cost a red rather than a
  // silent divergence is that **each list has its own check against the DIRECTORY, and neither
  // asserts a count** — so repairing one cannot satisfy the other's check.
  //
  // That is what happened again today, and it is the note earning its keep: `platform-fixture.ts`
  // was repaired first, `the platform fixture omits nothing` went green, and **this list stayed at
  // seventeen with its own case still red naming all six.** A count-based check would have been
  // satisfied by the first repair.
  '0018_membership_role_admin.sql',
  '0019_organization_single_owner.sql',
  '0020_organization_membership_by_organization.sql',
  '0021_invitation.sql',
  '0022_tenant_role.sql',
  '0023_organization_deletion_request.sql',
*/

export function readMigration(fileName: string): string {
  return readFileSync(new URL(fileName, MIGRATION_DIRECTORY), 'utf8');
}

/** A control-plane database with the AZ2 migrations applied and nothing seeded. */
export function createControlPlaneDatabase(): SqliteHarness {
  const harness = createSqliteDatabase();
  for (const fileName of APPLIED_MIGRATIONS) {
    harness.raw.exec(readMigration(fileName));
  }
  return harness;
}

export const FIXTURE_CREATED_AT = '2026-09-04T09:00:00.000Z';

export function seedPrincipal(
  harness: SqliteHarness,
  principalId: string,
  status: 'active' | 'suspended' = 'active',
): void {
  harness.raw
    .prepare(
      'INSERT INTO principal (principal_id, principal_type, status, created_at) ' +
        "VALUES (?, 'user', ?, ?)",
    )
    .run(principalId, status, FIXTURE_CREATED_AT);
}

export function seedOrganization(harness: SqliteHarness, organizationId: string): void {
  harness.raw
    .prepare("INSERT INTO organization (organization_id, status, created_at) VALUES (?, 'active', ?)")
    .run(organizationId, FIXTURE_CREATED_AT);
}

export function seedTenantDirectory(
  harness: SqliteHarness,
  entry: {
    readonly organizationId: string;
    readonly bindingName: string;
    readonly state: 'active' | 'suspended' | 'migrating';
  },
): void {
  harness.raw
    .prepare(
      'INSERT INTO tenant_directory (organization_id, binding_name, state, created_at) ' +
        'VALUES (?, ?, ?, ?)',
    )
    .run(entry.organizationId, entry.bindingName, entry.state, FIXTURE_CREATED_AT);
}

export type SeededCredential = {
  readonly identifierHash: string;
  readonly principalId: string;
  readonly algorithm: string;
  readonly iterations: number;
  readonly salt: string;
  readonly verifier: string;
};

export function seedCredential(harness: SqliteHarness, credential: SeededCredential): void {
  harness.raw
    .prepare(
      'INSERT INTO principal_credential ' +
        '(identifier_hash, principal_id, algorithm, iterations, salt, verifier, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      credential.identifierHash,
      credential.principalId,
      credential.algorithm,
      credential.iterations,
      credential.salt,
      credential.verifier,
      FIXTURE_CREATED_AT,
    );
}

export function countSessions(harness: SqliteHarness, sessionId: string): number {
  const rows = harness.raw
    .prepare('SELECT COUNT(*) AS n FROM session WHERE session_id = ?')
    .all(sessionId) as { n: number }[];
  return rows[0].n;
}

/**
 * A `DayWriteBudget` with a fixed total that this fixture can drain on purpose.
 *
 * The real in-process admission port is used unchanged on top of it — only the budget underneath
 * is substituted, because the behaviour under test is what happens when the budget says no, and
 * waiting for the real 3,000-row-write ceiling to be reached organically would take 1,000 logins
 * per case. `remaining()` is exposed so a case can assert it actually reached zero rather than
 * assuming it did.
 */
export function createExhaustibleDayBudget(total: number): {
  readonly budget: { take(dayStartMs: number, allocation: string, wanted: number): Promise<{ ok: true; value: number }> };
  remaining(): number;
} {
  let left = total;
  return {
    budget: {
      async take(_dayStartMs: number, _allocation: string, wanted: number) {
        const granted = Math.max(0, Math.min(wanted, left));
        left -= granted;
        return { ok: true as const, value: granted };
      },
    },
    remaining: () => left,
  };
}

/** Reads a stored row back out of band, so a suite can assert on what actually landed. */
export function readCredentialRow(
  harness: SqliteHarness,
  identifierHash: string,
): Record<string, unknown> | undefined {
  const rows = harness.raw
    .prepare('SELECT * FROM principal_credential WHERE identifier_hash = ?')
    .all(identifierHash) as Record<string, unknown>[];
  return rows[0];
}

/**
 * A deterministic stand-in for the HMAC identifier hasher.
 *
 * The real `createHmacIdentifierHasher` needs a 32-byte secret and produces a value no test can
 * predict. Suites that only need "the same identifier maps to the same key" use this; the suite
 * that verifies the real hasher uses the real one with a synthetic key. Its output is 43
 * base64url characters, matching the real width, so a suite cannot accidentally pass because the
 * stub produced a shape the column would reject.
 */
export function createStubIdentifierHasher(): {
  hash(normalizedIdentifier: string): Promise<string>;
} {
  return {
    async hash(normalizedIdentifier: string): Promise<string> {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`stub|${normalizedIdentifier}`),
      );
      const bytes = new Uint8Array(digest);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
  };
}
