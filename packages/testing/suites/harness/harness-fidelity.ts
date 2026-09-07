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

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
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
 *
 * ===========================================================================================
 * *** IT IS EMPTY AS OF 2026-09-07, AND THE EMPTINESS IS THE FINDING. ***
 * ===========================================================================================
 *
 * Every entry has been deleted and the AZ2 fixture now applies the full set. The reasons were
 * genuine — each omission was a tripwire meant to go red if login started consulting the omitted
 * table — but **the principle failed three times in this one fixture**, and each failure looked
 * like something else:
 *
 *   `0003`/`0008` — `findPrincipal` began reading two more tables in one statement, and five
 *   session-revocation cases went red with `unavailable`. Diagnosed as a Core defect first.
 *
 *   `0016` — two indexes on `platform_operator_action`, a table `0009` creates and this fixture
 *   omitted. `CREATE INDEX` failed and **five login cases went red because of an index on a table
 *   logins never touch.** `IF NOT EXISTS` guards the index, not the table.
 *
 * THE SHARPER PRINCIPLE, and it is the Team Lead's: **a partial migration set is not a smaller
 * version of production, it is a DIFFERENT SCHEMA.** A migration written against production can
 * fail against it for reasons unrelated to anything the suite tests.
 *
 * WHAT WAS LOST: the tripwire. WHY THAT IS ACCEPTABLE: it never fired as a clean signal — both
 * times it arrived as an unrelated crash that had to be diagnosed before it meant anything — and
 * the census below already forces the question on every migration, by name, at the moment it
 * lands. **The census is the tripwire that reports rather than crashes.**
 *
 * AN EMPTY MAP IS NOT A DEAD CHECK. `each deliberate omission carries a reason` still runs, and
 * the census below still fails on a migration that is neither applied nor listed here — so a
 * future omission still has to be argued in this file.
 *
 * ===========================================================================================
 * *** AN OMISSION NOW HAS TO STATE ITS CONSEQUENCE, NOT ONLY ITS REASON. ***
 * ===========================================================================================
 *
 * Added 2026-09-07 at the Team Lead's request, from the `0016` finding: **an omitted migration
 * silently constrains which LATER migrations may be applied.** `0016` indexes a table `0009`
 * creates, so omitting `0009` made a later and entirely unrelated migration unappliable, and
 * thirty-nine cases went red at once. **Nothing in the old omission list carried that dependency,
 * and there was no way to learn it except by hitting it** — the reason field said why the table
 * was not needed, which is a statement about the PRESENT and says nothing about what it forecloses.
 *
 * So `forecloses` is a required field rather than a documented habit. An author who cannot say
 * what an omission forecloses has not finished deciding whether to make it, and the type makes
 * that omission fail to compile rather than fail later in someone else's suite. **`\*.md` §3a
 * applied to a list instead of to a write: the check's output is an argument of the thing it
 * guards.**
 */
interface DeliberateOmission {
  /** Why the fixture does not need this migration. A statement about the present. */
  readonly reason: string;
  /**
   * WHICH LATER MIGRATIONS THIS OMISSION FORECLOSES, or an explicit statement that none are known
   * and how that was checked. A migration that creates a table forecloses every later migration
   * that indexes, alters or references it — and that is not visible from the omitted file alone.
   */
  readonly forecloses: string;
}

const CONTROL_PLANE_DELIBERATE_OMISSIONS: Readonly<Record<string, DeliberateOmission>> =
  Object.freeze({});

/**
 * THE RETIRED ENTRIES, KEPT AS PROSE RATHER THAN AS DATA — `workflow.md` §12's rule that a struck
 * ruling stays visible when it was right on its own terms. They are OUT of the map above because
 * that map is consumed by two live assertions: an entry here that is also applied fails
 * `none of them is applied`, so leaving them in would have been a red suite rather than a record.
 *
 *   `0009` — the action log. "No AZ2 suite reads or writes it, and nothing on the authenticated
 *     path touches it." True, and `0016` still broke five login cases by indexing it.
 *   `0010` — four triggers over tables `0003` and `0008` create. "Applying them here would add a
 *     constraint no case exercises." True, and harmless to apply.
 *   `0011`, `0012`, `0013`, `0014` — confirmation, Templates, the Organization-Template reference,
 *     and the action log's Organization column. Each omitted as a tripwire for the day login began
 *     consulting it.
 *   `0016` — omitted for ONE DAY, on a dependency: it indexes a table `0009` did not create here.
 *     That omission is what made the argument for abandoning the whole partial set.
 */

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

  suite.test('each deliberate omission carries a reason AND a consequence, and none is applied', () => {
    const defects = omissionDefects(CONTROL_PLANE_DELIBERATE_OMISSIONS);
    assertEqual(
      'every deliberate omission is fully argued',
      defects.join(' · '),
      '',
    );
  });

  suite.test('THE CONSTRUCTED FAILING INPUT: the omission check reports each way an entry can be thin', () => {
    // =====================================================================================
    // *** THE MAP IS EMPTY, SO THE CASE ABOVE PASSES WITHOUT EXECUTING A SINGLE PREDICATE. ***
    // =====================================================================================
    //
    // That is `workflow.md` §11a exactly: "no findings" and "no input" render identically, and the
    // second is the answer that ends the task. The `forecloses` requirement added on 2026-09-07
    // would therefore have been an unexecuted rule from the day it was written — a constraint
    // stated, expressed in a type, and never once evaluated.
    //
    // So the check is fed a map it must reject, one defect at a time. Each row names ONE thin
    // entry and expects exactly one complaint about it, which is stronger than expecting "some
    // complaint": a predicate that rejected everything would satisfy the weaker form.
    const sound: DeliberateOmission = {
      reason: 'the AZ2 login path never reads this table, and no seed in this fixture writes it',
      forecloses: 'nothing later indexes, alters or references the table it creates — checked by ' +
        'grepping the remaining migrations for its table name',
    };

    assertEqual(
      'a fully argued entry is accepted, so the rejections below are about what is missing',
      omissionDefects({ '0099_example.sql': sound }).join(' · '),
      '',
    );

    const thin: readonly { readonly why: string; readonly entry: DeliberateOmission }[] = [
      { why: 'no reason', entry: { ...sound, reason: 'not needed' } },
      { why: 'NO CONSEQUENCE — the 0016 case', entry: { ...sound, forecloses: 'none' } },
      { why: 'neither', entry: { reason: '', forecloses: '' } },
    ];
    for (const row of thin) {
      const found = omissionDefects({ '0099_example.sql': row.entry });
      assertTrue(
        `${ISOLATION} an entry with ${row.why} is reported`,
        found.length > 0,
        `the check accepted an entry with ${row.why}, so it is not enforcing what it documents`,
      );
    }
    assertEqual(
      'an entry with neither draws BOTH complaints, not one',
      omissionDefects({ '0099_example.sql': { reason: '', forecloses: '' } }).length,
      2,
    );

    // AND THE THIRD PREDICATE, which has nothing to do with thinness: a migration cannot be both
    // applied and deliberately omitted.
    assertTrue(
      'an omission that is ALSO in the applied list is reported',
      omissionDefects({ [APPLIED_MIGRATIONS[0]!]: sound }).some((defect) =>
        defect.includes('also applied'),
      ),
      'a migration listed as omitted while being applied is a list that has stopped describing ' +
        'the fixture, which is the drift this whole census exists to catch',
    );
  });

  return suite;
}

/**
 * Every way the omission list fails its own rules, as a list of complaints.
 *
 * A PURE FUNCTION SO IT CAN BE FED A BROKEN LIST. The live list is empty and is expected to stay
 * that way, so the only way to know these predicates work is to hand them something that must be
 * refused.
 */
function omissionDefects(map: Readonly<Record<string, DeliberateOmission>>): string[] {
  const defects: string[] = [];
  for (const [name, omission] of Object.entries(map)) {
    if (omission.reason.length <= 40) {
      defects.push(`${name}: no reason stated — silent drift with an extra step`);
    }
    // THE `0016` LESSON. The reason says why the fixture does not need the migration today;
    // `forecloses` says what it makes unappliable tomorrow. The second is the one nobody writes
    // unprompted, and the one that cost thirty-nine cases.
    if (omission.forecloses.length <= 40) {
      defects.push(
        `${name}: does not state what it FORECLOSES — a table that is never created cannot be ` +
          'indexed, altered or referenced by any later migration',
      );
    }
    if (APPLIED_MIGRATIONS.includes(name)) {
      defects.push(`${name}: listed as deliberately omitted and also applied`);
    }
  }
  return defects;
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
