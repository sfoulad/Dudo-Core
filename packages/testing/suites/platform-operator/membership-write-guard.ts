/**
 * ===========================================================================================
 * `M-1` LAYER 3 — A PROPERTY OF THE EMITTED STATEMENTS, NOT OF THE PATHS SOMEONE EXERCISED.
 * `docs/decisions/0024` invariant 1 · `docs/decisions/0025` decision 1 ·
 * `TESTING_STANDARD.md` §5.5.
 * ===========================================================================================
 *
 * Three layers claim to keep a platform operator out of `organization_membership`, and each one
 * sees something the others cannot:
 *
 *   LAYER 1  THE RECEIPT. `createMembership` requires a branded `MembershipAdmission`,
 *            `admitMembershipWrite` is its only exported producer, and the brand is a
 *            module-private `unique symbol`. Omitting it does not compile.
 *   LAYER 2  THE GUARD IN THE STATEMENT. `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM
 *            platform_operator ...)`.
 *   LAYER 3  THIS SUITE. Over every statement the run emitted.
 *
 * ===========================================================================================
 * WHAT LAYER 3 CATCHES THAT NEITHER OF THE OTHERS CAN
 * ===========================================================================================
 *
 * *** A SECOND WRITE PATH ADDED WITHOUT THE PARAMETER. ***
 *
 * Layer 1 makes omission uncompilable **only for `createMembership` as it exists today**. A new
 * method — `createMembershipsInBulk`, an onboarding fast path, a repair tool — that never took a
 * `MembershipAdmission` in the first place compiles perfectly, because there is no argument to
 * omit. Layer 2 only protects statements that already carry the guard, so it says nothing about a
 * statement written without one.
 *
 * Only a check over what the run ACTUALLY EMITTED sees a write path nobody declared. That is the
 * whole reason it is phrased as a property of the statements rather than as a test of a function:
 * a test names the path it calls, and the defect here is a path nobody named.
 *
 * ===========================================================================================
 * WHY LAYER 2 IS NOT A BACKSTOP, AND WHY THAT CHANGES WHAT THIS SUITE ASSERTS
 * ===========================================================================================
 *
 * `core-agent` found, after proposing the design, that **the receipt certifies a fact and a fact
 * can go stale.** A principal clean when `admitMembershipWrite` runs, made a platform operator
 * before the write lands, presents an AUTHENTIC receipt: layer 1 accepts it, because nothing about
 * the receipt is forged — the world moved.
 *
 * **So layer 2 is the only layer with no window at all**, because it re-asks the question inside
 * the statement that writes. `TIME-OF-CHECK` and `TIME-OF-USE` are the same instant, which is not
 * true of any check placed in front of the write.
 *
 * That makes "the guard is present in the statement" a materially different claim from "a check
 * ran before the write", and the cases below keep them apart: one asserts the SHAPE of every
 * emitted statement, another drives the STALE-RECEIPT sequence and asserts no row lands.
 *
 * ===========================================================================================
 * THE MATCHER IS SQL-AWARE, AND THAT IS NOT FUSSINESS
 * ===========================================================================================
 *
 * `core-agent` shipped a wrong answer twice writing the adjacent import check: a line-oriented
 * grep missed a multi-line `import { … }` entirely, and its replacement matched the word "import"
 * inside the prose of the comment it had just written. The same two failures are available here —
 * the guard is assembled from concatenated string literals, so the whitespace between `NOT`,
 * `EXISTS` and the subquery is whatever the author's formatting produced, and a decorative mention
 * of `platform_operator` in a SQL comment would satisfy a naive `includes`.
 *
 * So `normalizeSql` strips SQL comments and collapses whitespace before anything is matched, and
 * the patterns are anchored on SQL STRUCTURE rather than on a literal substring. A reformat must
 * not turn this red and a comment must not turn it green.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_NOT_FOUND,
  FIXTURE_CREATED_AT,
  ORG_ALPHA,
  PRN_ADMIN,
  PRN_STRANGER,
  createPlatformWorld,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld, PlatformWorld } from '../../harness/platform-fixture.ts';
import type { RecordedStatement } from '../../harness/sqlite-d1.ts';
import { createD1ControlPlaneStores } from '../../../../platform/core/identity/adapters/d1/d1-control-plane-store.ts';
import { admitMembershipWrite } from '../../../../platform/core/platform/platform-authority.ts';
import type { MembershipAdmission } from '../../../../platform/core/platform/platform-authority.ts';
import { ORGANIZATION_MEMBERSHIP_ROW_WRITES } from '../../../../platform/core/identity/control-plane-admission.ts';
import type { ControlPlaneWriteReservation } from '../../../../platform/core/identity/control-plane-admission.ts';

// =============================================================================================
// The matcher
// =============================================================================================

/**
 * Strips SQL comments and collapses whitespace.
 *
 * `--` TO END OF LINE AND `/* ... *\/` ARE BOTH REMOVED FIRST, so a statement that merely
 * mentions `platform_operator` in a comment cannot satisfy the guard pattern. Then every run of
 * whitespace — including the newlines that appear where string literals were concatenated —
 * becomes one space, so the patterns below do not depend on formatting.
 *
 * IT IS A LEXER'S APPROXIMATION, NOT A SQL PARSER, and the limit is stated rather than hidden: a
 * `--` inside a string literal would be treated as the start of a comment. The failure direction
 * is toward removing MORE text, which can only make the guard pattern fail to match — so this
 * check can produce a false RED and cannot produce a false GREEN. For a control whose whole
 * purpose is to catch an undeclared write, that is the correct direction to be wrong in.
 */
export function normalizeSql(sql: string): string {
  const withoutBlockComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLineComments = withoutBlockComments.replace(/--[^\n]*/g, ' ');
  return withoutLineComments.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** `INSERT INTO organization_membership`, allowing `OR REPLACE`/`OR IGNORE` and optional quoting. */
const MEMBERSHIP_INSERT =
  /\bINSERT\s+(?:OR\s+[A-Z]+\s+)?INTO\s+["'`[]?ORGANIZATION_MEMBERSHIP["'`\]]?\b/;

/**
 * The guard: a `NOT EXISTS` subquery selecting from `platform_operator` on `principal_id`.
 *
 * ANCHORED ON THREE THINGS TOGETHER — `NOT EXISTS`, `FROM platform_operator`, and a
 * `principal_id` predicate — because any one of them alone is satisfiable by something that is not
 * a guard. A subquery naming the table without `NOT EXISTS` would be a read; a `NOT EXISTS`
 * against a different table would be a different rule.
 */
const MEMBERSHIP_GUARD =
  /\bWHERE\s+NOT\s+EXISTS\s*\(\s*SELECT\b[^)]*?\bFROM\s+["'`[]?PLATFORM_OPERATOR["'`\]]?\b[^)]*?\bPRINCIPAL_ID\b[^)]*?\)/;

export function isMembershipInsert(sql: string): boolean {
  return MEMBERSHIP_INSERT.test(normalizeSql(sql));
}

/**
 * Every emitted statement that writes `organization_membership` WITHOUT the guard.
 *
 * THE RETURN IS THE OFFENDING SQL RATHER THAN A COUNT, because a count tells whoever reads the
 * failure that something is wrong and not what. This is the value the assertion compares against
 * the empty string, so a failure prints the statement that has to be fixed.
 */
export function unguardedMembershipInserts(
  statements: readonly RecordedStatement[],
): readonly string[] {
  const offenders: string[] = [];
  for (const statement of statements) {
    const normalized = normalizeSql(statement.sql);
    if (!MEMBERSHIP_INSERT.test(normalized)) {
      continue;
    }
    if (!MEMBERSHIP_GUARD.test(normalized)) {
      offenders.push(statement.sql);
    }
  }
  return offenders;
}

// =============================================================================================
// Driving a real membership write
// =============================================================================================

async function reservationFor(
  world: PlatformWorld,
  principalId: string,
): Promise<ControlPlaneWriteReservation> {
  const admitted = expectOk(
    'the control-plane write is admitted',
    await world.admission.reserve({
      principalId,
      estimatedRowWrites: ORGANIZATION_MEMBERSHIP_ROW_WRITES,
      nowMs: world.clock.nowMs(),
    }),
  ) as { kind: string; reservation: ControlPlaneWriteReservation };
  assertEqual('the budget granted rather than deferring', admitted.kind, 'granted');
  return admitted.reservation;
}

/**
 * The REAL adapter, over the same database the world already holds.
 *
 * It is built here rather than exposed on `PlatformWorld` because no platform route writes a
 * membership — this is the Action-side neighbour of the platform class, and giving the platform
 * fixture a membership writer would put a capability on it that the class it models does not have.
 */
function membershipStore(world: PlatformWorld) {
  return createD1ControlPlaneStores(world.control.database).identity;
}

function membershipRowCount(world: PlatformWorld, principalId: string): number {
  const rows = world.control.raw
    .prepare('SELECT COUNT(*) AS n FROM organization_membership WHERE principal_id = ?')
    .all(principalId) as { n: number }[];
  return rows[0].n;
}

export function buildMembershipWriteGuardSuite(
  make: MakePlatformWorld = createPlatformWorld,
): Suite {
  const suite = new Suite('Platform — M-1 layer 3: every emitted membership INSERT is guarded');

  suite.test('EVERY statement the run emitted that inserts a membership carries the guard', async () => {
    const world = await make();
    try {
      // ---- The positive control comes FIRST, and it is what stops this case being vacuous.
      //
      // Nothing in the platform route class writes a membership, so a run that only exercised the
      // routes would emit no membership INSERT at all and the assertion below would pass over an
      // empty set. That is exactly the shape of a check that has quietly stopped checking, so a
      // real write is driven here and its presence is asserted before anything else is concluded.
      const admission = expectOk(
        'a clean principal is admitted to membership',
        await admitMembershipWrite(world.store, PRN_STRANGER),
      ) as MembershipAdmission;
      const reservation = await reservationFor(world, PRN_STRANGER);

      expectOk(
        'the membership write succeeds',
        await membershipStore(world).createMembership(
          {
            principalId: PRN_STRANGER,
            organizationId: ORG_ALPHA,
            status: 'active',
            role: 'member',
            createdAt: FIXTURE_CREATED_AT,
          },
          reservation,
          admission,
        ),
      );
      assertEqual('and the row really landed', membershipRowCount(world, PRN_STRANGER), 1);

      const inserts = world.control.statements.filter((statement) => isMembershipInsert(statement.sql));
      assertTrue(
        'the run emitted at least one membership INSERT to check',
        inserts.length > 0,
        'no statement in this run inserted into organization_membership, so the assertion below ' +
          'would have passed over an empty set — which is a check that has stopped checking',
      );

      // ---- THE ASSERTION. Over every statement the run emitted, not over the one just driven.
      assertEqual(
        `${ISOLATION} no statement writes organization_membership without re-asking the ` +
          'platform_operator question in the same statement',
        unguardedMembershipInserts(world.control.statements).join(' | '),
        '',
      );

      // ---- And the guard is bound to the ROW'S principal, not to some other one.
      //
      // A guard checking a different principal would satisfy the pattern above and protect
      // nothing. `principal_id` is the first column in the insert list, so the row's principal is
      // the first bound parameter; the guard binds it again. If the column order ever changes this
      // goes red, which is the right outcome — someone then reads this case.
      for (const statement of inserts) {
        const rowPrincipal = statement.parameters[0];
        const occurrences = statement.parameters.filter((value) => value === rowPrincipal).length;
        assertTrue(
          `${ISOLATION} the guard names the same principal the row does`,
          occurrences >= 2,
          `the inserted principal ${String(rowPrincipal)} is bound once, so the NOT EXISTS ` +
            `subquery is checking something else: ${JSON.stringify(statement.parameters)}`,
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('THE NEGATIVE CONTROL: an unguarded membership INSERT in the same run turns it red', async () => {
    // Per the standing rule in `packages/testing/README.md`: an assertion that cannot be made to
    // fail is not evidence. This puts exactly the defect the case above exists to catch — a write
    // path that never carried the guard — into the SAME recorded statement stream, and requires
    // the detector to name it.
    //
    // IT GOES THROUGH THE D1 PORT, not through `harness.raw`, because `harness.statements` records
    // the port and that is the surface the assertion reads. A control that wrote by another route
    // would prove the detector cannot see what it was never shown.
    const world = await make();
    try {
      const clean = unguardedMembershipInserts(world.control.statements);
      assertEqual('the run starts clean', clean.join(' | '), '');

      await world.control.database
        .prepare(
          'INSERT INTO organization_membership (principal_id, organization_id, status, role, ' +
            'created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(PRN_STRANGER, ORG_ALPHA, 'active', 'member', FIXTURE_CREATED_AT)
        .all();

      const offenders = unguardedMembershipInserts(world.control.statements);
      assertEqual('the detector found exactly the unguarded statement', offenders.length, 1);
      assertTrue(
        'and it named it',
        offenders[0].includes('organization_membership'),
        offenders[0],
      );
    } finally {
      world.close();
    }
  });

  suite.test('the matcher is not fooled by formatting, and not satisfied by a comment', () => {
    // The two failures `core-agent` hit writing the adjacent import check, transferred to SQL.
    const guardedAcrossLines = {
      sql:
        'INSERT INTO organization_membership\n  (principal_id, organization_id, status, role, created_at)\n' +
        '  SELECT ?, ?, ?, ?, ?\n  WHERE NOT EXISTS (\n    SELECT 1 FROM platform_operator\n' +
        '    WHERE principal_id = ?\n  )',
      parameters: [] as readonly unknown[],
    };
    assertEqual(
      'a guard split across newlines is recognised',
      unguardedMembershipInserts([guardedAcrossLines]).length,
      0,
    );

    const commentOnly = {
      sql:
        '-- WHERE NOT EXISTS (SELECT 1 FROM platform_operator WHERE principal_id = ?)\n' +
        'INSERT INTO organization_membership (principal_id) VALUES (?)',
      parameters: [] as readonly unknown[],
    };
    assertEqual(
      `${ISOLATION} a guard that exists only in a comment does NOT satisfy the check`,
      unguardedMembershipInserts([commentOnly]).length,
      1,
    );

    const wrongTable = {
      sql:
        'INSERT INTO organization_membership (principal_id) SELECT ? ' +
        'WHERE NOT EXISTS (SELECT 1 FROM session WHERE principal_id = ?)',
      parameters: [] as readonly unknown[],
    };
    assertEqual(
      `${ISOLATION} a NOT EXISTS against a different table is a different rule, not this one`,
      unguardedMembershipInserts([wrongTable]).length,
      1,
    );

    const unrelated = {
      sql: 'SELECT 1 AS present FROM organization_membership WHERE principal_id = ? LIMIT 1',
      parameters: [] as readonly unknown[],
    };
    assertEqual(
      'a READ of the same table is not an insert and is not flagged',
      unguardedMembershipInserts([unrelated]).length,
      0,
    );
  });

  // =========================================================================================
  // The behavioural half. Layer 2 has no window; layer 1 does.
  // =========================================================================================

  suite.test('a receipt that went stale between the mint and the write lands NO row', async () => {
    // ATTACK 15, and it is the case that makes layer 2 necessary rather than redundant. The
    // receipt is AUTHENTIC — nothing about it is forged, `admitMembershipWrite` minted it and the
    // principal really was clean at that moment. The world then moved.
    const world = await make();
    try {
      const admission = expectOk(
        'the principal is clean when the receipt is minted',
        await admitMembershipWrite(world.store, PRN_STRANGER),
      ) as MembershipAdmission;
      const reservation = await reservationFor(world, PRN_STRANGER);

      // ...and now it becomes a platform operator, after the check and before the write.
      world.control.raw
        .prepare('INSERT INTO platform_operator (principal_id, platform_role, created_at) VALUES (?, ?, ?)')
        .run(PRN_STRANGER, 'platform-admin', FIXTURE_CREATED_AT);

      const written = await membershipStore(world).createMembership(
        {
          principalId: PRN_STRANGER,
          organizationId: ORG_ALPHA,
          status: 'active',
          role: 'member',
          createdAt: FIXTURE_CREATED_AT,
        },
        reservation,
        admission,
      );

      // THE PROPERTY IS THE ROW COUNT, NOT THE RESPONSE. The adapter records, in its own header,
      // that a refused write "lands ZERO ROWS AND REPORTS ok", because Core's `D1Database` exposes
      // no `meta.changes`. So asserting on the returned value would assert the wrong thing — and
      // asserting it succeeded would read as the write having happened.
      assertTrue('the call returned', written.ok || !written.ok, 'unreachable');
      assertEqual(
        `${ISOLATION} the forbidden row was not created`,
        membershipRowCount(world, PRN_STRANGER),
        0,
      );
    } finally {
      world.close();
    }
  });

  suite.test('the same sequence for an ordinary principal DOES write — the guard refuses provenance, not everything', async () => {
    // The control for the case above. Without it, "zero rows" would be satisfied by a guard that
    // refuses every membership write in the platform.
    const world = await make();
    try {
      const admission = expectOk(
        'an ordinary principal is admitted',
        await admitMembershipWrite(world.store, PRN_STRANGER),
      ) as MembershipAdmission;
      const reservation = await reservationFor(world, PRN_STRANGER);
      expectOk(
        'the write is performed',
        await membershipStore(world).createMembership(
          {
            principalId: PRN_STRANGER,
            organizationId: ORG_ALPHA,
            status: 'active',
            role: 'member',
            createdAt: FIXTURE_CREATED_AT,
          },
          reservation,
          admission,
        ),
      );
      assertEqual('the row landed', membershipRowCount(world, PRN_STRANGER), 1);
    } finally {
      world.close();
    }
  });

  suite.test('layer 1 refuses a principal that is ALREADY an operator, before any statement runs', async () => {
    // The receipt is the layer that refuses LOUDLY, with a real error. Layer 2 lands zero rows and
    // reports `ok`, which is only acceptable because this ran first — the order of the argument
    // matters and is asserted rather than described.
    const world = await make();
    try {
      const before = world.control.statements.length;
      expectError(
        'an existing platform operator is not admitted to membership',
        await admitMembershipWrite(world.store, PRN_ADMIN),
        EXPECTED_NOT_FOUND,
      );
      const issued = world.control.statements.slice(before).map((entry) => entry.sql);
      assertTrue(
        'and no INSERT was attempted',
        issued.every((sql) => !normalizeSql(sql).includes('INSERT')),
        issued.join(' | '),
      );
    } finally {
      world.close();
    }
  });

  suite.test('the guard holds on a database where 0010 was never applied', async () => {
    // ATTACK 16, and it is the restore case: `0010`'s triggers do not validate rows that already
    // exist and a restore does not re-run them, so a database can hold the forbidden state with
    // the triggers absent or inert. Layer 2 does not depend on that migration at all.
    const world = await make({ withMutualExclusionTriggers: false });
    try {
      const triggers = world.control.raw
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'")
        .all() as { n: number }[];
      assertEqual('the fixture really has no triggers', triggers[0].n, 0);

      const admission = expectOk(
        'the receipt is minted while the principal is clean',
        await admitMembershipWrite(world.store, PRN_STRANGER),
      ) as MembershipAdmission;
      const reservation = await reservationFor(world, PRN_STRANGER);
      world.control.raw
        .prepare('INSERT INTO platform_operator (principal_id, platform_role, created_at) VALUES (?, ?, ?)')
        .run(PRN_STRANGER, 'platform-admin', FIXTURE_CREATED_AT);

      await membershipStore(world).createMembership(
        {
          principalId: PRN_STRANGER,
          organizationId: ORG_ALPHA,
          status: 'active',
          role: 'member',
          createdAt: FIXTURE_CREATED_AT,
        },
        reservation,
        admission,
      );
      assertEqual(
        `${ISOLATION} no row lands, with no trigger in the database to refuse it`,
        membershipRowCount(world, PRN_STRANGER),
        0,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
