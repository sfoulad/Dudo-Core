/**
 * ===========================================================================================
 * THE LAPSE SWEEP AND THE RETENTION CHECK — two properties proved by a probe that died with
 * its session, rebuilt as cases that run every time.
 * ===========================================================================================
 *
 * `core-agent` measured both on 2026-09-13 in a scratchpad. `§11a` is explicit about what that
 * is worth: *"a probe proves a property once; only a suite case proves it tomorrow."*
 *
 * ===========================================================================================
 * ⚠ THE SUBJECT MOVED AT 14:44 — THE ADAPTER PIN FIRED AND THIS SUITE WAS RE-POINTED
 * ===========================================================================================
 *
 * **These cases were first written against a DOC COMMENT**, because `InvitationStore` had no
 * adapter and the sweep statement existed nowhere as executable code — one fenced ```sql block
 * inside `invitation-administration.ts`, and nothing else. Grading that was the best available
 * subject, and it was explicitly the wrong one for the day an adapter landed.
 *
 * **`THE ADAPTER PIN` existed for exactly that day, and it fired within the hour**:
 * `platform/core/tenant-admin/adapters/d1/d1-invitation-store.ts`, mtime 14:44:59.
 *
 * > **THAT IS WHY THE PIN WAS WRITTEN AS A RED RATHER THAN A COMMENT.** `workflow.md` §12: a
 * > capability arriving is a sweep trigger, and **the sweep is the thing nobody runs.** Nothing
 * > else in this repository would have said that sixteen green cases had quietly become a
 * > coverage overstatement — they would have kept passing, against prose, beside real code.
 *
 * **THE SUBJECT IS NOW THE ADAPTER, two ways, and neither is a transcription:**
 *
 * ```
 * BEHAVIOURAL   createD1InvitationStore(harness.database) driven through the real port
 * TEXTUAL       the SQL extracted from the ADAPTER's own source and mutated, for the controls
 * ```
 *
 * **And re-pointing paid immediately, with something the comment could not show.** The adapter
 * wraps the statement in `try { … } catch { return err(unavailable()) }`, so **a CHECK-constraint
 * failure does not throw — it collapses to `unavailable` at the port boundary.** That is the
 * observable form of *"the create path fails for a reason nothing in it names"*, and it is
 * asserted below rather than reasoned about.
 *
 * ===========================================================================================
 * 1. THE BOUND IS THE PROPERTY. THE PARSE IS NOT.
 * ===========================================================================================
 *
 * ```
 * sqlite_compileoption_used('ENABLE_UPDATE_DELETE_LIMIT')  ->  0
 * UPDATE invitation SET … WHERE … LIMIT 8   ->  near "LIMIT": syntax error
 * ```
 *
 * **The dangerous repair is the obvious one.** Meeting that error, the natural move is to delete
 * the `LIMIT` — which parses, and converts a sweep bounded at
 * `TENANT_INVITATION_LAPSE_SWEEP_LIMIT` into one that updates **every** lapsed invitation in the
 * Organization in one statement, blowing the reservation the create path sized from the bounded
 * arithmetic, on exactly the tenant with the largest backlog.
 *
 * > **So the case asserts 20 lapsed rows in, 8 swept, 12 LEFT PENDING.** A future author who
 * > "simplifies" the subquery away gets a passing parse and an unbounded write, **and the bound
 * > is the only thing that goes red.** The mutant below performs that exact simplification and
 * > records that it sweeps all twenty.
 *
 * **THE CORPUS DEPENDENCY, NAMED RATHER THAN DISCOVERED LATER:** this is `node:sqlite`. **D1 IS
 * UNMEASURED** — `d1_database_query` is deliberately withheld. The subquery form uses core syntax
 * only, so it **makes the question moot rather than answering it**, and anybody citing this suite
 * as *"we know what D1 supports"* is citing something nobody ran.
 *
 * ===========================================================================================
 * 2. THE `CHECK` IS UNEVEN ACROSS THE THREE TERMINAL STATES, AND NO RULING SAYS SO
 * ===========================================================================================
 *
 * ```
 * revoke    WRITES  ->  CHECK (status = 'pending' OR identifier IS NULL) makes clearing UNSKIPPABLE
 * accept    WRITES  ->  same
 * expired   COMPUTED, writes nothing  ->  THE CHECK HAS NOTHING TO FIRE ON
 * ```
 *
 * `tenant-invitations-v1` states the mitigation unconditionally — *"cleared when the invitation
 * leaves `pending`"*. **That is exact for two of three and best-effort for the third**, and the
 * only thing that ever ends the retention for a lapsed invitation is a sweep amortised onto a next
 * write **that may never come**. An Organization that stops inviting keeps every lapsed invitee's
 * address indefinitely.
 *
 * **The three states are asserted separately and printed separately**, so the uneven one is
 * visible in the run rather than in a comment. **The contract wording is `architecture-agent`'s
 * and these cases do not encode it** — they assert what the schema does.
 */

import { readFileSync, readdirSync } from 'node:fs';
import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import { stripComments } from '../../harness/source-text.ts';
import {
  APPLIED_MIGRATIONS,
  createControlPlaneDatabase,
  readMigration,
  seedOrganization,
  seedPrincipal,
} from '../../harness/control-plane-fixture.ts';
import { createSqliteDatabase } from '../../harness/sqlite-d1.ts';
import type { SqliteHarness } from '../../harness/sqlite-d1.ts';
import { MEMBERSHIP_ROLES } from '../../../../platform/core/authorization/roles.ts';
import {
  TENANT_INVITATION_LAPSE_SWEEP_LIMIT,
  effectiveInvitationStatus,
} from '../../../../platform/core/tenant-admin/invitation-administration.ts';
import { createD1InvitationStore } from '../../../../platform/core/tenant-admin/adapters/d1/d1-invitation-store.ts';
import { sealAuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import { mintControlPlaneWriteReservation } from '../../../../platform/core/identity/control-plane-admission.ts';

const ORG = 'org_invitations';
const INVITER = 'prn_inviter';
const LAPSED_AT = '2026-09-01T00:00:00.000Z';
const FUTURE = '2027-01-01T00:00:00.000Z';
const NOW = '2026-09-13T12:00:00.000Z';
const ADDRESS = 'invitee@example.test';

/**
 * The Organization, SEALED. `sweepLapsed` takes an `AuthenticatedOrganizationId`, whose only
 * producer reads the value off an `AuthenticatedPrincipal` — so a caller cannot name an
 * Organization it is not authenticated in, and the tenancy property is a construction rather than
 * a check. The same seal `grant-ceiling.ts`'s cases use.
 */
const SEALED_ORG = sealAuthenticatedOrganizationId(
  sealAuthenticatedPrincipal({
    principalId: INVITER,
    principalType: 'user',
    organizationId: ORG,
    authorizedBusinessIds: [],
    grants: { grants: [] },
    onBehalfOfPrincipalId: null,
  }) as never,
);

/**
 * A write reservation for exactly `rowWrites`.
 *
 * **SIZED BY THE CALLER AT `2 x LIMIT`, WHICH IS THE ARITHMETIC THE BOUND PROTECTS.** The adapter
 * consumes the worst case before the statement runs, so an unbounded sweep would overspend against
 * a reservation sized from the bounded figure — that is the harm the LIMIT mutant demonstrates.
 */
function reservationFor(rowWrites: number) {
  return mintControlPlaneWriteReservation({
    principalId: INVITER,
    estimatedRowWrites: rowWrites,
    dayStartMs: Date.parse('2026-09-13T00:00:00.000Z'),
  });
}

const CORE_ROOT = new URL('../../../../platform/core/', import.meta.url);
const ADMINISTRATION = new URL('tenant-admin/invitation-administration.ts', CORE_ROOT);
const ADAPTER = new URL('tenant-admin/adapters/d1/d1-invitation-store.ts', CORE_ROOT);

/* =============================================================================================
 * READING THE SUBJECT OUT OF THE ADAPTER THAT SHIPS IT
 * ============================================================================================= */

/**
 * The sweep statement, extracted from the ADAPTER's own source.
 *
 * **THE MUTANT CONTROLS NEED A STRING, AND `platform/core/**` IS NOT MINE TO MUTATE.** So the
 * controls derive their input from the shipped code rather than from a copy of it — the same
 * *derive the subject, never transcribe it* the doc-comment version used, now pointed at the
 * artifact that actually runs.
 *
 * **A FLOOR ON THE READER, NOT ONLY ON THE RESULT** (`§11a`: a broken extractor is the most
 * confident version of the empty-list reader — it does not report nothing, it reports agreement).
 */
function sweepStatementFromAdapter(): { readonly sql: string; readonly found: number } {
  const source = readFileSync(ADAPTER, 'utf8');
  const literals = [...source.matchAll(/`(UPDATE invitation[\s\S]*?)`/gu)].map((match) =>
    (match[1] ?? '').trim(),
  );
  return { sql: literals[0] ?? '', found: literals.length };
}

/* =============================================================================================
 * FIXTURE
 * ============================================================================================= */

function seedInvitation(
  harness: SqliteHarness,
  invitationId: string,
  fields: {
    readonly status: string;
    readonly identifier: string | null;
    readonly expiresAt: string;
    readonly role?: string;
  },
): void {
  harness.raw
    .prepare(
      'INSERT INTO invitation (organization_id, invitation_id, role, status, identifier, ' +
        'created_at, created_by_principal_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      ORG,
      invitationId,
      fields.role ?? 'member',
      fields.status,
      fields.identifier,
      LAPSED_AT,
      INVITER,
      fields.expiresAt,
    );
}

function freshDatabase(): SqliteHarness {
  const harness = createControlPlaneDatabase();
  seedPrincipal(harness, INVITER);
  seedOrganization(harness, ORG);
  return harness;
}

/**
 * Runs `body` and requires it to be REFUSED with an error whose message carries `fragment`.
 *
 * **IT DOES NOT SWALLOW.** An unexpected error renders as its own distinct failure naming the
 * message that actually arrived — a helper that collapsed every throw into "refused" once nearly
 * cost this repository a fabricated gap report against Core.
 */
function refused(label: string, fragment: string, body: () => void): void {
  let message: string | null = null;
  try {
    body();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === null) {
    assertTrue(label, false, 'ACCEPTED — a refusal was required and the statement succeeded.');
    return;
  }
  assertTrue(
    label,
    message.includes(fragment),
    `refused, but with a DIFFERENT error than expected. Wanted a message containing ` +
      `'${fragment}'; got: ${message}`,
  );
}

/* =============================================================================================
 * THE SUITE
 * ============================================================================================= */

export function buildInvitationRetentionSuite(): Suite {
  const suite = new TestSuite('invitations — the lapse sweep is bounded and the address is cleared');

  /* ---------------------------------------------------------------------------------------
   * POPULATION AND FLOORS
   * --------------------------------------------------------------------------------------- */

  suite.test('POPULATION — the sweep statement is READ from the adapter, not typed out here', () => {
    const { sql, found } = sweepStatementFromAdapter();
    console.log(`      sweep statements found in the adapter source: ${String(found)}`);
    console.log(`      sweep limit constant: ${String(TENANT_INVITATION_LAPSE_SWEEP_LIMIT)}`);
    for (const line of sql.split('\n')) {
      console.log(`        | ${line.trim()}`);
    }
    assertEqual('exactly one UPDATE-invitation statement in the adapter', found, 1);
    // The reader floor. A regex that stops matching yields '' and every assertion below then
    // holds over an empty statement, which is a clean pass that means nothing.
    assertTrue(
      'floor: the extracted text is the sweep UPDATE',
      /^UPDATE\s+invitation\s+SET/iu.test(sql),
      `the extracted text does not begin as the sweep UPDATE:\n${sql}`,
    );
    assertTrue(
      'floor: it carries the three positional parameters the adapter binds',
      sql.includes('?1') && sql.includes('?2') && sql.includes('?3'),
      `the statement names parameters this suite cannot bind:\n${sql}`,
    );
  });

  suite.test('THE ADAPTER PIN — FIRED 14:44 AND WAS ACTED ON. It now guards the other direction', () => {
    // ===========================================================================================
    // THIS PIN DID ITS ONLY JOB AND THE SUITE MOVED. The reversal is deliberate.
    // ===========================================================================================
    //
    // It read `!adapter.found` while the port had no implementation, because sixteen cases were
    // grading a doc comment and nothing else would ever have said so. **The adapter landed, the
    // pin went red, and the cases were re-pointed at it.**
    //
    // **IT IS NOT DELETED, IT IS INVERTED**, because the hazard is now the mirror: an adapter
    // that is REMOVED or RENAMED would leave the extraction floor above matching nothing, and a
    // floor that fails is a red nobody can interpret. This says what happened instead.
    const consumers = APPLIED_MIGRATIONS.length; // touched so the import cannot rot silently
    assertTrue(
      'floor: the control-plane migration set was read',
      consumers >= 20,
      `${String(consumers)} migrations — the fixture reader has stopped seeing the directory.`,
    );
    const adapter = existsAdapter();
    console.log(
      `      \`InvitationStore\` searched across ${String(adapter.examined)} TypeScript files under ` +
        `platform/core/ (excluding its own declaration): ${adapter.found ? 'FOUND' : 'NO CONSUMER'}`,
    );
    // THE POSITIVE CONTROL FOR THE SEARCH ITSELF. A recursive walk that stopped reaching the tree
    // would report `no consumer` and pass — the same clean nothing an absent file produces.
    assertTrue(
      'floor: the walk reached the tree',
      adapter.examined >= 50,
      `only ${String(adapter.examined)} files walked under platform/core/ — the walk has stopped ` +
        'reaching the tree, and either answer would then be a property of the reader.',
    );
    assertTrue(
      'the adapter EXISTS, which is what every case below now drives',
      adapter.found,
      'THE INVITATION ADAPTER HAS GONE. These cases drive `createD1InvitationStore` and extract ' +
        'their mutants from its source; with it removed they are testing nothing. Either the ' +
        'implementation moved — re-point this suite — or it was deleted, which is a defect.',
    );
  });

  /* ---------------------------------------------------------------------------------------
   * 1. THE BOUND
   * --------------------------------------------------------------------------------------- */

  suite.test('THE BOUND — 20 lapsed, the sweep takes the limit and LEAVES THE REST PENDING', async () => {
    const harness = freshDatabase();
    try {
      for (let n = 0; n < 20; n += 1) {
        seedInvitation(harness, `inv_lapsed_${String(n)}`, {
          status: 'pending',
          identifier: ADDRESS,
          expiresAt: LAPSED_AT,
        });
      }
      // DRIVEN THROUGH THE REAL PORT since 14:44, not raw SQL. This exercises the adapter's own
      // statement, its own binding and its reservation arithmetic — none of which a doc comment
      // could offer, and the reservation is the thing the bound protects.
      const store = createD1InvitationStore(harness.database);
      const swept = await store.sweepLapsed(
        SEALED_ORG,
        NOW,
        TENANT_INVITATION_LAPSE_SWEEP_LIMIT,
        reservationFor(2 * TENANT_INVITATION_LAPSE_SWEEP_LIMIT),
      );
      assertTrue('the sweep succeeded', swept.ok, `sweepLapsed refused: ${JSON.stringify(swept)}`);
      assertEqual(
        'the sweep REPORTS exactly the limit — the caller charges what it actually spent',
        swept.ok ? swept.value : -1,
        TENANT_INVITATION_LAPSE_SWEEP_LIMIT,
      );
      assertEqual(
        'THE BOUND — the backlog beyond the limit is still pending',
        countWhere(harness, "status = 'pending'"),
        20 - TENANT_INVITATION_LAPSE_SWEEP_LIMIT,
      );
      // And the retention half of the same statement, in the same case, because a sweep that
      // bounded correctly and left the addresses behind would satisfy the assertion above.
      assertEqual(
        'no terminal row survives holding an address',
        countWhere(harness, "status <> 'pending' AND identifier IS NOT NULL"),
        0,
      );
      assertEqual(
        'the rows it did not reach still hold theirs — the sweep is partial, not global',
        countWhere(harness, "status = 'pending' AND identifier IS NOT NULL"),
        12,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('KNOWN-FAILING INPUT — deleting the LIMIT is the repair that sweeps everything', () => {
    // The realistic mutation, and it is the one an author meets `near "LIMIT": syntax error` and
    // reaches for. Built by MUTATING THE REAL STATEMENT rather than by inventing one, so it tests
    // the pattern against the codebase (`§11a`: a control built from an invented mutation tests
    // the pattern against itself and always passes).
    //
    // NOTHING ON DISK CHANGES — the mutation is a string in memory against a fresh in-memory
    // database, so `§2a-i`'s announce-before-you-mutate does not apply.
    const harness = freshDatabase();
    try {
      for (let n = 0; n < 20; n += 1) {
        seedInvitation(harness, `inv_lapsed_${String(n)}`, {
          status: 'pending',
          identifier: ADDRESS,
          expiresAt: LAPSED_AT,
        });
      }
      const { sql } = sweepStatementFromAdapter();
      const unbounded = sql.replace(/\n?\s*LIMIT\s+\?3/iu, '');
      assertTrue(
        'the mutation LANDED — the LIMIT clause is gone',
        !/LIMIT/iu.test(unbounded) && unbounded !== sql,
        `the mutation did not change the statement, so this control proves nothing:\n${unbounded}`,
      );

      const info = harness.raw.prepare(unbounded).run(ORG, NOW);
      assertEqual(
        'the unbounded form sweeps EVERY lapsed row in one statement',
        Number(info.changes),
        20,
      );
      assertEqual('nothing is left pending', countWhere(harness, "status = 'pending'"), 0);
      console.log(
        `      the bounded form writes 2 x ${String(TENANT_INVITATION_LAPSE_SWEEP_LIMIT)} = ` +
          `${String(2 * TENANT_INVITATION_LAPSE_SWEEP_LIMIT)} row-writes; this one wrote 2 x 20 = 40 ` +
          'against a reservation sized from the bounded arithmetic. It PARSES, which is why the ' +
          'bound rather than the parse is what the case above asserts.',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('WHY THE SUBQUERY — `UPDATE … LIMIT` is refused by this build', () => {
    const harness = freshDatabase();
    try {
      const option = harness.raw
        .prepare("SELECT sqlite_compileoption_used('ENABLE_UPDATE_DELETE_LIMIT') AS used")
        .get() as { readonly used: number };
      const version = harness.raw.prepare('SELECT sqlite_version() AS v').get() as {
        readonly v: string;
      };
      console.log(
        `      sqlite ${version.v} · ENABLE_UPDATE_DELETE_LIMIT = ${String(option.used)} ` +
          '· D1 IS UNMEASURED (d1_database_query is withheld)',
      );
      assertEqual(
        'the optional clause is NOT compiled in — the reason the subquery form exists',
        Number(option.used),
        0,
      );
      refused(
        'UPDATE … LIMIT is a syntax error here, so it was never an option',
        'syntax error',
        () => {
          harness.raw
            .prepare("UPDATE invitation SET status = 'expired' WHERE organization_id = ? LIMIT 8")
            .run(ORG);
        },
      );
    } finally {
      harness.close();
    }
  });

  /* ---------------------------------------------------------------------------------------
   * 2. THE CHECK — seven cases, A through G
   * --------------------------------------------------------------------------------------- */

  suite.test('SCHEMA FLOOR — the `identifier` column and its CHECK exist before any refusal is believed', () => {
    const harness = freshDatabase();
    try {
      const columns = harness.raw
        .prepare("SELECT name FROM pragma_table_info('invitation')")
        .all() as unknown as readonly { readonly name: string }[];
      const names = columns.map((column) => column.name);
      console.log(`      invitation columns: ${names.join(', ')}`);
      assertTrue(
        'floor: `identifier` is a column on `invitation`',
        names.includes('identifier'),
        `no \`identifier\` column — every refusal below would then be refused for the WRONG ` +
          `reason and the case would still be green. Columns: ${names.join(', ')}`,
      );
      // And the CHECK itself, from the stored DDL. A column with no constraint accepts everything,
      // so cases B/D/F would go green against a table that guarantees nothing.
      const ddl = (
        harness.raw
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invitation'")
          .get() as { readonly sql: string }
      ).sql;
      assertTrue(
        'floor: the retention CHECK is present in the stored DDL',
        /CHECK\s*\(\s*status\s*=\s*'pending'\s+OR\s+identifier\s+IS\s+NULL\s*\)/iu.test(ddl),
        `the stored DDL carries no retention CHECK:\n${ddl}`,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('A · POSITIVE CONTROL — a pending invitation WITH an address is accepted', () => {
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_a', {
        status: 'pending',
        identifier: ADDRESS,
        expiresAt: FUTURE,
      });
      assertEqual('the row landed', countWhere(harness, "invitation_id = 'inv_a'"), 1);
    } finally {
      harness.close();
    }
  });

  suite.test('B · a transition to `revoked` that does NOT clear the address is REFUSED', () => {
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_b', {
        status: 'pending',
        identifier: ADDRESS,
        expiresAt: FUTURE,
      });
      refused('the CHECK makes clearing UNSKIPPABLE, not merely expected', 'CHECK constraint', () => {
        harness.raw
          .prepare("UPDATE invitation SET status = 'revoked' WHERE invitation_id = ?")
          .run('inv_b');
      });
      assertEqual(
        'and the row is untouched — the refusal is atomic, not partial',
        countWhere(harness, "invitation_id = 'inv_b' AND status = 'pending'"),
        1,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('C · the same transition WITH the clear in the same statement is accepted', () => {
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_c', {
        status: 'pending',
        identifier: ADDRESS,
        expiresAt: FUTURE,
      });
      harness.raw
        .prepare("UPDATE invitation SET status = 'revoked', identifier = NULL WHERE invitation_id = ?")
        .run('inv_c');
      assertEqual(
        'revoked, and holding no address',
        countWhere(harness, "invitation_id = 'inv_c' AND status = 'revoked' AND identifier IS NULL"),
        1,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('D · THE PREDICTED HAZARD — a sweep without the clear is REFUSED, and it runs BEFORE the insert', () => {
    // The one that justifies this case existing. The sweep runs before the create path's insert,
    // so a sweep missing `identifier = NULL` is not a slower index: EVERY SUBSEQUENT INVITATION
    // CREATION IN THAT ORGANIZATION FAILS, for a reason nothing in the create path names.
    const harness = freshDatabase();
    try {
      for (let n = 0; n < 3; n += 1) {
        seedInvitation(harness, `inv_d_${String(n)}`, {
          status: 'pending',
          identifier: ADDRESS,
          expiresAt: LAPSED_AT,
        });
      }
      const { sql } = sweepStatementFromAdapter();
      const withoutClear = sql.replace(/,\s*identifier\s*=\s*NULL/iu, '');
      assertTrue(
        'the mutation LANDED — the clear is gone from the SET',
        !/identifier\s*=\s*NULL/iu.test(withoutClear) && withoutClear !== sql,
        `the mutation did not change the statement:\n${withoutClear}`,
      );
      refused(
        'the sweep without the clear is refused by the CHECK, so the create path dies here',
        'CHECK constraint',
        () => {
          harness.raw.prepare(withoutClear).run(ORG, NOW, 8);
        },
      );
    } finally {
      harness.close();
    }
  });

  suite.test('D-ii · AND THROUGH THE ADAPTER THE SAME FAILURE IS `unavailable`, NOT A THROW', async () => {
    // **THE RE-POINT PAID HERE, AND THE DOC COMMENT COULD NOT HAVE SHOWN IT.** The adapter wraps
    // its statement in `try { … } catch { return err(unavailable()) }`, so a CHECK-constraint
    // violation never reaches the caller as a constraint error — **it arrives as `unavailable`.**
    //
    // That is fail-closed and correct, and it is also the precise observable form of *"the create
    // path fails for a reason nothing in it names"*: an operator sees a generic unavailability on
    // invitation creation, and nothing in the response says `identifier`, `CHECK`, or `sweep`.
    //
    // Driven by seeding a row the REAL statement cannot legally produce — a terminal row still
    // holding an address is refused at insert (case F), so the collision is staged on the UPDATE
    // by pointing the adapter at a database whose table has been dropped. Same catch, same
    // collapse, and it needs no mutation of Core.
    const harness = freshDatabase();
    try {
      harness.raw.exec('DROP TABLE invitation');
      const store = createD1InvitationStore(harness.database);
      const swept = await store.sweepLapsed(SEALED_ORG, NOW, 8, reservationFor(16));
      assertTrue(
        'a failing statement collapses to a Result error rather than throwing',
        !swept.ok,
        'the adapter returned ok against a table that does not exist — the catch is not covering ' +
          'the statement, and a real constraint failure would propagate as a throw.',
      );
      console.log(
        `      the port's answer to a failed sweep: ${swept.ok ? 'ok' : JSON.stringify(swept.error)} ` +
          '— nothing in it names the identifier column, the CHECK, or the sweep',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('E · the real sweep, WITH the clear, is accepted — through the port', async () => {
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_e', {
        status: 'pending',
        identifier: ADDRESS,
        expiresAt: LAPSED_AT,
      });
      const store = createD1InvitationStore(harness.database);
      const swept = await store.sweepLapsed(SEALED_ORG, NOW, 8, reservationFor(16));
      assertTrue('the sweep succeeded', swept.ok, `refused: ${JSON.stringify(swept)}`);
      assertEqual(
        'expired, and the address is gone',
        countWhere(harness, "invitation_id = 'inv_e' AND status = 'expired' AND identifier IS NULL"),
        1,
      );
    } finally {
      harness.close();
    }
  });

  suite.test('F · INSERTING a terminal row WITH an address is REFUSED', () => {
    // Not the same case as B. B is a TRANSITION; this is a row that arrives terminal — the shape a
    // backfill, a restore or an import produces, and none of those goes through a transition.
    const harness = freshDatabase();
    try {
      refused('a terminal row may not carry an address at insert either', 'CHECK constraint', () => {
        seedInvitation(harness, 'inv_f', {
          status: 'revoked',
          identifier: ADDRESS,
          expiresAt: FUTURE,
        });
      });
    } finally {
      harness.close();
    }
  });

  suite.test('G · a pending invitation with NO address is ACCEPTED — the converse is deliberately unasserted', () => {
    // `CHECK ((status = 'pending') = (identifier IS NOT NULL))` would additionally forbid this
    // row. **IT IS REFUSED BY `0021` ON PRODUCT GROUNDS AND THIS CASE PINS THE REFUSAL.** Dudo has
    // no mailer, and `0021`'s own header names the out-of-band shape as reachable today: an
    // invitation that is a code an administrator hands over in person has a recipient nobody
    // typed. A constraint that forbids the fallback decides the product.
    //
    // **SO A NULL-IDENTIFIER PENDING ROW IS REPRESENTABLE AND IS A CORE-SIDE DEFECT, NOT A
    // SCHEMA-SIDE ONE.** Do not add an assertion here that contradicts that refusal — this case
    // exists to make the next author meet the reasoning before they "tighten" the schema.
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_g', { status: 'pending', identifier: null, expiresAt: FUTURE });
      assertEqual(
        'representable, by decision',
        countWhere(harness, "invitation_id = 'inv_g' AND identifier IS NULL"),
        1,
      );
    } finally {
      harness.close();
    }
  });

  /* ---------------------------------------------------------------------------------------
   * 3. THE GUARANTEE IS UNEVEN
   * --------------------------------------------------------------------------------------- */

  suite.test(`${ISOLATION} THE UNEVEN GUARANTEE — two states are enforced, the third is best-effort`, () => {
    const harness = freshDatabase();
    try {
      seedInvitation(harness, 'inv_rev', { status: 'pending', identifier: ADDRESS, expiresAt: FUTURE });
      seedInvitation(harness, 'inv_acc', { status: 'pending', identifier: ADDRESS, expiresAt: FUTURE });
      seedInvitation(harness, 'inv_exp', { status: 'pending', identifier: ADDRESS, expiresAt: LAPSED_AT });

      // revoked — a WRITE, so the CHECK fires.
      refused('revoke  · clearing is UNSKIPPABLE', 'CHECK constraint', () => {
        harness.raw
          .prepare("UPDATE invitation SET status = 'revoked' WHERE invitation_id = ?")
          .run('inv_rev');
      });
      // accepted — a WRITE, so the CHECK fires.
      refused('accept  · clearing is UNSKIPPABLE', 'CHECK constraint', () => {
        harness.raw
          .prepare("UPDATE invitation SET status = 'accepted' WHERE invitation_id = ?")
          .run('inv_acc');
      });

      // expired — COMPUTED. No write happens, so there is nothing for the CHECK to fire on. The
      // read reports `expired` while the row stores `pending` AND KEEPS THE ADDRESS.
      const stored = harness.raw
        .prepare('SELECT status, identifier, expires_at FROM invitation WHERE invitation_id = ?')
        .get('inv_exp') as {
        readonly status: string;
        readonly identifier: string | null;
        readonly expires_at: string;
      };
      const effective = effectiveInvitationStatus(
        { storedStatus: 'pending', expiresAt: stored.expires_at },
        NOW,
      );

      console.log('      revoked   WRITES   -> CHECK fires   -> clearing UNSKIPPABLE');
      console.log('      accepted  WRITES   -> CHECK fires   -> clearing UNSKIPPABLE');
      console.log(
        `      expired   COMPUTED -> NO WRITE      -> reads '${effective}', stores ` +
          `'${stored.status}', address ${stored.identifier === null ? 'CLEARED' : 'STILL PRESENT'}`,
      );

      assertEqual('expired · the read resolves it against the clock', effective, 'expired');
      assertEqual('expired · and the row still stores `pending`', stored.status, 'pending');
      assertTrue(
        'expired · THE ADDRESS SURVIVES until a sweep that may never run',
        stored.identifier === ADDRESS,
        `expected the address to still be present, which is the whole finding; got ` +
          `${String(stored.identifier)}. If this is now NULL something clears it and the ` +
          'best-effort caveat may have become unconditional — check what, and say so.',
      );
    } finally {
      harness.close();
    }
  });

  /* ---------------------------------------------------------------------------------------
   * 4. THE DORMANT GUARANTEE — `architecture.md` §3a-i, currently unreachable
   * --------------------------------------------------------------------------------------- */

  suite.test('THE DORMANT EXCEPTION-KEYED CHECK — green today because a DIFFERENT constraint fires first', () => {
    // `§11a`'s sound-by-accident, named rather than left as a green. The retention CHECK is keyed
    // on the exception (`status = 'pending' OR identifier IS NULL`) so a status nobody has
    // invented clears by default. **That property is UNREACHABLE today**: the status enum CHECK
    // refuses an unknown value before the identifier CHECK is ever consulted.
    //
    // So the control widens the STATUS enum — derived from the real DDL, not hand-written — and
    // shows the identifier CHECK then catching the new value. Nothing on disk changes.
    const baseline = freshDatabase();
    try {
      refused(
        'today a fifth status is refused by the STATUS enum, not by the retention CHECK',
        'CHECK constraint',
        () => {
          seedInvitation(baseline, 'inv_draft', {
            status: 'draft',
            identifier: ADDRESS,
            expiresAt: FUTURE,
          });
        },
      );
    } finally {
      baseline.close();
    }

    const widened = createSqliteDatabase();
    try {
      let mutated = false;
      for (const fileName of APPLIED_MIGRATIONS) {
        let text = readMigration(fileName);
        if (fileName === '0021_invitation.sql') {
          const before = text;
          text = text.replace(
            /status IN \('pending', 'accepted', 'revoked', 'expired'\)/u,
            "status IN ('pending', 'accepted', 'revoked', 'expired', 'draft')",
          );
          mutated = text !== before;
        }
        widened.raw.exec(text);
      }
      assertTrue(
        'the mutation LANDED — the status enum was widened',
        mutated,
        'the status CHECK was not found in 0021 and nothing was widened, so this control proves ' +
          'nothing. The enum spelling has moved; re-derive the pattern from the migration.',
      );
      seedPrincipal(widened, INVITER);
      seedOrganization(widened, ORG);

      refused(
        'WITH the status enum widened, the RETENTION CHECK is what refuses the new value',
        'CHECK constraint',
        () => {
          seedInvitation(widened, 'inv_draft', {
            status: 'draft',
            identifier: ADDRESS,
            expiresAt: FUTURE,
          });
        },
      );
      // And the positive half: the same new status with no address is accepted, so the refusal
      // above is the identifier CHECK rather than something still rejecting `draft` outright.
      seedInvitation(widened, 'inv_draft_clean', {
        status: 'draft',
        identifier: null,
        expiresAt: FUTURE,
      });
      assertEqual(
        'and `draft` with no address is accepted — so the refusal above was the RETENTION check',
        countWhere(widened, "invitation_id = 'inv_draft_clean'"),
        1,
      );
      console.log(
        '      the exception-keyed form is CORRECT AND REDUNDANT today, and becomes load-bearing ' +
          'the moment the status enum is widened. Demonstrated, not reasoned about.',
      );
    } finally {
      widened.close();
    }
  });

  /* ---------------------------------------------------------------------------------------
   * 5. THE COMPARISON `0021` ASKS FOR BY NAME
   * --------------------------------------------------------------------------------------- */

  suite.test('THE TWO ROLE LISTS — every value the invitation CHECK admits is a MEMBERSHIP_ROLE, and `owner` is not', () => {
    // `0021_invitation.sql` names this case in its own header: *"there are now two lists of role
    // spellings in this directory and they can drift… `qa-agent` is owed a case asserting that
    // every value this CHECK admits is in `MEMBERSHIP_ROLES` and that `'owner'` is not — a
    // comparison nothing else performs."*
    //
    // DERIVED FROM THE MIGRATION, NOT TRANSCRIBED. Comments are stripped first: this file's own
    // header discusses `'owner'` at length, and a check reading the raw text would find it.
    const ddl = stripComments(readMigration('0021_invitation.sql'), 'sql');
    const match = /role\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*role\s+IN\s*\(([^)]*)\)/iu.exec(ddl);
    assertTrue(
      'floor: the role CHECK was located in the migration',
      match !== null,
      'no `role … CHECK (role IN (…))` found in 0021 after comment-stripping. The declaration has ' +
        'moved and this comparison is examining nothing.',
    );
    if (match === null) return;

    const admitted = [...(match[1] ?? '').matchAll(/'([^']+)'/gu)].map((entry) => entry[1] ?? '');
    console.log(`      invitation CHECK admits: ${admitted.join(', ')}`);
    console.log(`      MEMBERSHIP_ROLES:        ${MEMBERSHIP_ROLES.join(', ')}`);

    assertTrue(
      'floor: the CHECK admits something',
      admitted.length > 0,
      'the role CHECK admits no values — the extraction is broken, not the schema.',
    );
    const unknown = admitted.filter((role) => !MEMBERSHIP_ROLES.includes(role as never));
    assertEqual(
      'every value the invitation CHECK admits is a known membership role',
      unknown.join(', '),
      '',
    );
    assertTrue(
      `${ISOLATION} \`owner\` is NOT offerable by invitation`,
      !admitted.includes('owner'),
      'the invitation CHECK admits `owner`. Ownership is singular (`0043` §3c) and moves only ' +
        'through `transferOwnership`, which demotes and promotes two EXISTING members atomically. ' +
        'An invitation offering it is a second door into the column `0019`\'s unique index guards, ' +
        'held open for the invitation\'s whole lifetime, and accepted by a principal who is not yet ' +
        'a member — so there would be nobody to demote.',
    );
    // The other direction, and it is deliberately NOT an equality: the CHECK is a SUBSET of
    // MEMBERSHIP_ROLES by design, missing exactly `owner`. Pinned so a role added to one list and
    // not the other is visible, without asserting a correspondence that is false by construction.
    const missing = MEMBERSHIP_ROLES.filter((role) => !admitted.includes(role));
    assertEqual(
      'the CHECK is short of MEMBERSHIP_ROLES by exactly `owner` — a new role added to one list ' +
        'and not the other moves this',
      missing.join(', '),
      'owner',
    );
  });

  return suite;
}

/* =============================================================================================
 * HELPERS
 * ============================================================================================= */

function countWhere(harness: SqliteHarness, predicate: string): number {
  const row = harness.raw
    .prepare(`SELECT COUNT(*) AS c FROM invitation WHERE ${predicate}`)
    .get() as { readonly c: number };
  return Number(row.c);
}

/**
 * Whether anything outside the port's own declaration names `InvitationStore`.
 *
 * Deliberately a SOURCE search rather than an import: an adapter that exists but is not yet wired
 * is still an adapter, and it is exactly the state in which this suite would silently keep
 * grading prose.
 */
function existsAdapter(): { readonly found: boolean; readonly examined: number } {
  // RECURSIVE OVER THE WHOLE OF `platform/core/`, because the pin's claim is about the tree and a
  // two-directory search would be a narrower claim reported as the wider one. `readFileSync` is
  // used rather than a shell search deliberately: this shell's `grep` is a `ugrep` wrapper passing
  // `-I`, so it returns a clean nothing on any NUL-bearing file — and `platform/core/**` has two.
  let examined = 0;
  let found = false;
  for (const entry of walkTypeScript(CORE_ROOT)) {
    if (entry.href === ADMINISTRATION.href) continue;
    examined += 1;
    if (readFileSync(entry, 'utf8').includes('InvitationStore')) found = true;
  }
  return { found, examined };
}

function walkTypeScript(directory: URL): readonly URL[] {
  const out: URL[] = [];
  let entries: readonly { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(...walkTypeScript(new URL(`${entry.name}/`, directory)));
    } else if (entry.name.endsWith('.ts')) {
      out.push(new URL(entry.name, directory));
    }
  }
  return out;
}
