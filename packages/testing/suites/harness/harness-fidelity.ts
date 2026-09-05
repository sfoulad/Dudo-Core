/**
 * ===========================================================================================
 * THE HARNESS TESTING ITSELF. `TESTING_STANDARD.md` §5.1.
 * ===========================================================================================
 *
 * Every other suite in `packages/testing/**` asserts something about `platform/core/**`. This one
 * asserts things about the harness, and it exists because of a defect that made the case for it
 * better than any argument could:
 *
 *   `sqlite-d1.ts` routed every non-`SELECT` statement to `.run()` and discarded what it
 *   returned, so **`UPDATE … RETURNING` performed its write and reported `[]`.**
 *
 * `confirmation-v1` §lifecycle requires a conditional update that reports rows affected, and says
 * a read-then-write is not sufficient — *"this is the one place in this contract where a plausible
 * implementation is wrong in a way testing rarely catches."* **Under the old double the correct
 * implementation looked broken and the wrong one passed unchanged.** The harness was arranged to
 * hide precisely the failure the contract had named in advance.
 *
 * A DOUBLE THAT FAVOURS THE WRONG IMPLEMENTATION IS WORSE THAN NO DOUBLE, because a green run
 * becomes affirmative evidence for the defect. So the double's own behaviour is now asserted, and
 * asserted THROUGH THE PORT — verifying it with raw `node:sqlite` would test the engine, which was
 * never in doubt, and would have passed throughout the entire period the defect existed.
 *
 * ===========================================================================================
 * AND THE MIGRATION SETS, WHICH HAVE NOW DRIFTED THREE TIMES
 * ===========================================================================================
 *
 * `0003` (`findMembershipWithOrganization` began selecting `role`), `0008` (`findPrincipal` began
 * reading `platform_operator`, which broke five unrelated AZ2 cases), and `0011` next. Each time a
 * fixture applied a list that was correct when written and silently became wrong.
 *
 * A LIST THAT DRIFTS ONE MIGRATION AT A TIME IS NOT A DEFECT THREE TIMES — IT IS A MISSING CHECK.
 * The cases below compare each fixture's applied set against the migrations directory itself, so
 * the next migration fails loudly here rather than surfacing as unrelated red elsewhere.
 *
 * WHERE A FIXTURE DELIBERATELY OMITS ONE, THE OMISSION MUST BE **NAMED**. An unnamed absence is
 * the same silent drift with an extra step, so the assertion compares against
 * `applied + deliberatelyOmitted` and requires the second list to be explicit.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { createSqliteDatabase } from '../../harness/sqlite-d1.ts';
import { APPLIED_MIGRATIONS } from '../../harness/control-plane-fixture.ts';
import {
  MUTUAL_EXCLUSION_MIGRATION,
  PLATFORM_MIGRATIONS,
} from '../../harness/platform-fixture.ts';

const MIGRATION_DIRECTORY = fileURLToPath(
  new URL('../../../../platform/core/migrations/control-plane/', import.meta.url),
);

function migrationsOnDisk(): string[] {
  return readdirSync(MIGRATION_DIRECTORY)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();
}

/**
 * The migrations a fixture may leave out, each with the reason it is safe to.
 *
 * IT IS A CLOSED LIST AND ADDING TO IT IS A DELIBERATE ACT. That is the whole mechanism: an
 * omission anyone can justify in a comment is an omission nobody notices; an omission that has to
 * be typed here, beside its reason, is one a reviewer sees.
 */
const CONTROL_PLANE_DELIBERATE_OMISSIONS: Readonly<Record<string, string>> = Object.freeze({
  '0014_platform_operator_action_organization.sql':
    'ADDS `platform_operator_action.target_organization_id`, nullable, for the scoped audit feed ' +
    'to filter on. Added to this list 2026-09-05, when the census went red on it — the second ' +
    'time today, and the second time it was the control working rather than a chore. OMITTED for ' +
    'the same reason as 0009 itself: no AZ2 suite reads or writes the operator action log, and ' +
    'nothing on the authenticated path touches it. If any Core read path on the login path ever ' +
    'names this column, it moves to the applied list and this entry is deleted.',
  '0013_organization_template.sql':
    'ADDS `organization.template_id`, nullable. Added to this list 2026-09-05, when this control ' +
    'went red on the migration landing — which is the control working rather than a chore. It is ' +
    'OMITTED and not applied because no AZ2 suite reads or writes the column: login resolves ' +
    'principals, sessions, memberships and credentials, and none of those statements names it. ' +
    'THE TRIPWIRE SHAPE IS THE POINT, exactly as for 0011 and 0012 — the column is nullable, so ' +
    'an AZ2 statement that started selecting `organization.*` would go red HERE, on a missing ' +
    'column, rather than silently reading a NULL in production. The platform fixture applies it, ' +
    'because there the onboarding write is the subject.',
  '0012_template.sql':
    'The Template table. `template-v1` is accepted and unimplemented, nothing on the authenticated ' +
    'path reads it, and no AZ2 suite touches Templates. Same tripwire shape as 0011: if login ever ' +
    'begins consulting it, the AZ2 suites go red and this entry is where the reader is told why.',
  '0011_confirmation.sql':
    'The confirmation table. Nothing on the authenticated path reads it TODAY — the pipeline gate ' +
    'is being built and does not exist yet. THIS ENTRY IS A TRIPWIRE, and the narrow fixture is ' +
    'deliberate rather than lazy: when the gate lands and login begins consulting confirmation, ' +
    'the AZ2 suites go red, exactly as they did for 0008. That is how the deployment hazard ' +
    '"a control plane without this migration cannot authenticate" was found the first time, and ' +
    'it is worth finding again. Applying it pre-emptively would hide the coupling instead.',
  '0009_platform_operator_action.sql':
    'The platform-operator action log. No AZ2 suite reads or writes it, and nothing on the ' +
    'authenticated path touches it — unlike 0008, which findPrincipal now reads on every ' +
    'request. If any Core read path ever names platform_operator_action, this moves to the ' +
    'applied list and this entry is deleted.',
  '0010_platform_operator_mutual_exclusion.sql':
    'Four triggers over tables 0003 and 0008 create. They constrain WRITES to ' +
    'organization_membership and platform_operator; no AZ2 suite performs either write, and the ' +
    'platform fixture applies them where they are the subject. Applying them here would add a ' +
    'constraint no case exercises.',
});

export function buildSqliteDoubleSuite(): Suite {
  const suite = new Suite('Harness — the D1 double reports what the statement returned');

  suite.test('UPDATE ... RETURNING reports the row it changed, THROUGH THE PORT', async () => {
    // THE REGRESSION CASE. Driven through `database.prepare(...).bind(...).all()` — the same path
    // every adapter uses — because that is where the defect lived. The engine was never in doubt.
    const harness = createSqliteDatabase();
    try {
      harness.raw.exec('CREATE TABLE confirmation (binding_hash TEXT PRIMARY KEY, spent_at TEXT)');
      harness.raw
        .prepare('INSERT INTO confirmation (binding_hash, spent_at) VALUES (?, NULL)')
        .run('h1');

      // ---- The conditional spend that SHOULD match.
      const matched = await harness.database
        .prepare(
          'UPDATE confirmation SET spent_at = ? WHERE binding_hash = ? AND spent_at IS NULL ' +
            'RETURNING binding_hash',
        )
        .bind('2026-09-05T12:00:00Z', 'h1')
        .all<{ binding_hash: string }>();
      assertEqual('the port reports exactly one row', matched.results.length, 1);
      assertEqual('and it is the row that changed', matched.results[0].binding_hash, 'h1');

      // ---- The SAME statement again. The confirmation is now spent, so it must match nothing.
      const second = await harness.database
        .prepare(
          'UPDATE confirmation SET spent_at = ? WHERE binding_hash = ? AND spent_at IS NULL ' +
            'RETURNING binding_hash',
        )
        .bind('2026-09-05T12:00:01Z', 'h1')
        .all<{ binding_hash: string }>();
      assertEqual('a second spend reports no rows', second.results.length, 0);

      // ---- AND THE DISTINCTION THAT MAKES THIS A TEST RATHER THAN A COINCIDENCE.
      //
      // "Returned nothing" and "did nothing" are different facts, and the whole defect was that
      // the double conflated them. Checked out of band, against the engine, so a double that
      // reported `[]` for everything could not satisfy both halves.
      const row = harness.raw
        .prepare('SELECT spent_at FROM confirmation WHERE binding_hash = ?')
        .all('h1') as { spent_at: string | null }[];
      assertEqual(
        'the first spend really landed — reporting a row was not the double inventing one',
        row[0].spent_at,
        '2026-09-05T12:00:00Z',
      );
      assertTrue(
        'and the second spend did NOT overwrite it — reporting no rows meant no rows',
        row[0].spent_at !== '2026-09-05T12:00:01Z',
        'the second conditional update wrote despite matching nothing',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('INSERT and DELETE ... RETURNING report through the port too', async () => {
    const harness = createSqliteDatabase();
    try {
      harness.raw.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

      const inserted = await harness.database
        .prepare('INSERT INTO t (id) VALUES (?) RETURNING id')
        .bind('a')
        .all<{ id: string }>();
      assertEqual('INSERT ... RETURNING reports the row', inserted.results.length, 1);

      const deleted = await harness.database
        .prepare('DELETE FROM t WHERE id = ? RETURNING id')
        .bind('a')
        .all<{ id: string }>();
      assertEqual('DELETE ... RETURNING reports the row', deleted.results.length, 1);

      const nothing = await harness.database
        .prepare('DELETE FROM t WHERE id = ? RETURNING id')
        .bind('a')
        .all<{ id: string }>();
      assertEqual('and reports none when it matched none', nothing.results.length, 0);
    } finally {
      harness.close();
    }
  });

  suite.test('a write still writes when it returns nothing, and a comment does not hide a SELECT', async () => {
    // The two other forms the deleted classifier got wrong. Both are assertions that the double
    // has NO opinion about statement shape: a plain INSERT must still land, and a SELECT behind a
    // comment must still return rows rather than being read as a write.
    const harness = createSqliteDatabase();
    try {
      harness.raw.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

      const plain = await harness.database.prepare('INSERT INTO t (id) VALUES (?)').bind('b').all();
      assertEqual('a non-returning INSERT reports no rows', plain.results.length, 0);
      const stored = harness.raw.prepare('SELECT COUNT(*) AS n FROM t').all() as { n: number }[];
      assertEqual('and the row is nevertheless there', stored[0].n, 1);

      const behindComment = await harness.database
        .prepare('-- a leading comment\nSELECT id FROM t')
        .bind()
        .all<{ id: string }>();
      assertEqual('a SELECT behind a line comment still returns rows', behindComment.results.length, 1);

      const cte = await harness.database
        .prepare('WITH c AS (SELECT id FROM t) SELECT id FROM c')
        .bind()
        .all<{ id: string }>();
      assertEqual('a common table expression still returns rows', cte.results.length, 1);
    } finally {
      harness.close();
    }
  });

  suite.test('every statement is still recorded, whatever it returns', () => {
    // `statements` is what the storage-boundary structural assertions read
    // (`membership-write-guard.ts`, `tenant-resolution.ts`). A change to `execute` that stopped
    // recording would silently empty those assertions rather than fail them.
    const harness = createSqliteDatabase();
    try {
      harness.raw.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const before = harness.statements.length;
      void harness.database.prepare('INSERT INTO t (id) VALUES (?) RETURNING id').bind('c').all();
      void harness.database.prepare('SELECT id FROM t').bind().all();
      const recorded = harness.statements.slice(before);
      assertEqual('both statements were recorded', recorded.length, 2);
      assertTrue(
        'and the RETURNING statement is among them, with its parameters',
        recorded.some((entry) => entry.sql.includes('RETURNING') && entry.parameters.includes('c')),
        JSON.stringify(recorded),
      );
    } finally {
      harness.close();
    }
  });

  return suite;
}

// =============================================================================================
// The migration-set assertions
// =============================================================================================

export function buildControlPlaneMigrationCoverageSuite(): Suite {
  const suite = new Suite('Harness — the AZ2 control-plane fixture applies the right migrations');

  suite.test('applied + deliberately omitted covers every control-plane migration on disk', () => {
    const onDisk = migrationsOnDisk();
    assertTrue(
      'the migrations directory was actually read',
      onDisk.length >= 10,
      `only ${String(onDisk.length)} migrations were found — the path is probably wrong, which ` +
        'would make this assertion vacuous',
    );

    const accountedFor = [
      ...APPLIED_MIGRATIONS,
      ...Object.keys(CONTROL_PLANE_DELIBERATE_OMISSIONS),
    ].sort();
    assertEqual(
      'every migration is either applied or named as a deliberate omission',
      accountedFor.join(','),
      onDisk.join(','),
    );
  });

  suite.test('each deliberate omission carries a reason, and none of them is applied', () => {
    for (const [name, reason] of Object.entries(CONTROL_PLANE_DELIBERATE_OMISSIONS)) {
      assertTrue(
        `${name} states why it is omitted`,
        reason.length > 40,
        'an omission with no reason is the same silent drift with an extra step',
      );
      assertTrue(
        `${name} is not also in the applied list`,
        !APPLIED_MIGRATIONS.includes(name),
        'a migration cannot be both applied and deliberately omitted',
      );
    }
  });

  return suite;
}

export function buildPlatformMigrationCoverageSuite(): Suite {
  const suite = new Suite('Harness — the platform fixture applies every control-plane migration');

  suite.test('the platform fixture omits nothing', () => {
    // Unlike the AZ2 fixture, this one deliberately applies ALL of them — the mutual exclusion is
    // a question about two tables and the platform suites need the whole control plane. So there
    // is no omission list here, and there must not be one: an omission would be a platform suite
    // running against a control plane that cannot hold the state it is testing.
    const onDisk = migrationsOnDisk();
    const applied = [...PLATFORM_MIGRATIONS, MUTUAL_EXCLUSION_MIGRATION].sort();
    assertEqual(
      'the applied set is exactly what is on disk',
      applied.join(','),
      onDisk.join(','),
    );
  });

  return suite;
}
