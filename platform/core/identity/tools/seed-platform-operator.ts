/**
 * ===========================================================================================
 * THE BOOTSTRAP PATH. How a principal BECOMES a platform operator.
 * `docs/decisions/0025` decision 1 · contract `platform-operator-v1`, `theBootstrapProblem`.
 * ===========================================================================================
 *
 * THE QUESTION: who writes the first `platform_operator` row, when no platform operator exists to
 * authorize it?
 *
 * THE RULING: OUT OF BAND, BY AN OPERATOR RUNNING SQL, exactly as `seed-principal.ts` in this
 * directory already works for credentials. THE CONTRACT PUBLISHES NO ROUTE THAT CREATES A PLATFORM
 * OPERATOR. There is no `core.platform-operator.create`, it is deliberately absent from
 * `permission-catalog.yaml`, and adding one is a decision rather than an extension.
 *
 * WHY, and it is worth reading before anyone proposes the endpoint: a route that grants platform
 * authority is the single most valuable target in the platform, it would be reachable by exactly
 * one class of caller, and its only legitimate use is a handful of times in Dudo's life. THE
 * FREQUENCY DOES NOT JUSTIFY THE SURFACE. This is the same reasoning `credential-store.ts` applies
 * to enrolment — "the running Worker has no code path that writes a credential at all" — and
 * `platform_operator` is the one place in the whole super-admin surface where that property
 * SURVIVES, because `credential-reset-v1` destroys it for `principal_credential` and cannot for
 * this table.
 *
 * ===========================================================================================
 * IT GRANTS AUTHORITY TO AN **EXISTING** PRINCIPAL. IT CREATES NO PRINCIPAL AND NO CREDENTIAL.
 * ===========================================================================================
 *
 * Seeding authority and seeding a credential are two operations, and `seed-principal.ts` owns the
 * second. A platform operator is an ordinary principal that gains one row.
 *
 * SO THE FULL BOOTSTRAP IS TWO COMMANDS, AND THE ORDER AND THE FLAG BOTH MATTER:
 *
 *     IDENTITY_LOOKUP_KEY=… node platform/core/identity/tools/seed-principal.ts --no-organization
 *     node platform/core/identity/tools/seed-platform-operator.ts --principal-id=<the id it printed>
 *
 * *** `--no-organization` IS NOT OPTIONAL AND IT IS THE WHOLE TRAP. *** `seed-principal.ts`'s
 * ordinary five-row output includes an `organization_membership` row, and `docs/decisions/0024`
 * invariant 1 is that A PLATFORM PRINCIPAL HOLDS ZERO MEMBERSHIPS. Seeding the ordinary way and
 * then running this tool produces exactly the state that is refused everywhere — an account that
 * logs in, reaches the admin console, and is denied every route, for a reason no error message
 * will ever explain, because no error is permitted to distinguish it.
 *
 * ===========================================================================================
 * THE ELIGIBILITY CHECK, AND WHY IT IS IN THE SQL RATHER THAN IN THIS PROCESS
 * ===========================================================================================
 *
 * This tool EXECUTES NOTHING — it opens no database, makes no network call, and runs no statement
 * (`seed-principal.ts` property 2, unchanged). So it cannot itself query `organization_membership`
 * to refuse an ineligible principal. It does the next best thing, in three layers:
 *
 *   1. A PREFLIGHT `SELECT` THE OPERATOR READS FIRST. Three counts, with the expected answer
 *      stated next to them. This is the layer that SAYS WHY, in a sentence, rather than leaving a
 *      trigger error to be interpreted.
 *   2. A GUARDED `INSERT ... SELECT ... WHERE NOT EXISTS`. The statement cannot create the bad row
 *      even if the operator skips the preflight, and — the part that matters — even if
 *      `0010_platform_operator_mutual_exclusion.sql` HAS NOT BEEN APPLIED. Its failure mode is
 *      "0 rows written", which `wrangler d1 execute` reports and the closing notice explains.
 *   3. THE TRIGGERS IN `0010`. The backstop.
 *
 * *** THIS DELIBERATELY DIFFERS FROM WHAT WAS ASKED, AND THE DIFFERENCE IS REPORTED. *** The
 * brief expected the trigger to fire for an ineligible principal, so that a fired trigger would
 * signal a gap in the tool's own check. The guard in layer 2 means the trigger CANNOT fire from
 * this tool's SQL — so that signal is traded away. It is traded for a stronger property: THE BAD
 * ROW CANNOT BE CREATED BY THIS SQL AT ALL, WITH OR WITHOUT MIGRATION 0010. On a database where
 * `0010` has not been applied, an unguarded insert would silently succeed and create precisely the
 * state `0024` exists to prevent, and that seemed the worse failure to leave open.
 *
 * ===========================================================================================
 * WHAT IT PRINTS, AND WHERE
 * ===========================================================================================
 *
 * SQL TO STDOUT. EVERYTHING ELSE TO STDERR. `seed-principal.ts` already learned this the hard way
 * — a `.sql` file in this repository once began with the line `Email address:` because a prompt
 * went to stdout and was redirected into the file. That tool now writes its prompt to stderr and
 * only `renderSeedSql`'s output to stdout, and this one inherits the shape by having NO PROMPT AT
 * ALL: it reads two arguments and no secrets.
 *
 * IT HANDLES NO CREDENTIAL MATERIAL OF ANY KIND. No password, no salt, no verifier, no lookup key
 * — it does not even read `IDENTITY_LOOKUP_KEY`, because it computes no hash. There is nothing
 * sensitive in its output to clear from a scrollback, which is the one respect in which it is
 * safer than the tool it is modelled on.
 */

import { sqlQuote } from './seed-principal.ts';
import type { PlatformRole } from '../../platform/platform-permissions.ts';
import {
  PLATFORM_ROLES,
  reachablePlatformPermissions,
  toPlatformRole,
} from '../../platform/platform-permissions.ts';

/**
 * The role written when `--role` is not given.
 *
 * `platform-admin`, because `marketplace-moderator` holds only `core.marketplace.moderate`, which
 * no route in this class evaluates — an operator seeded at that role can log in and is refused
 * every platform route including `whoami`. That is the contract's stated consequence (PO-5) rather
 * than a defect here, but it is a poor default.
 */
const DEFAULT_ROLE: PlatformRole = 'platform-admin';

/**
 * The platform identifier grammar: `^[A-Za-z0-9_-]{8,64}$`, the same one `kernel/ids.ts` generates
 * at 22 characters and the same one `session-routes.ts` validates a tenant hint against.
 *
 * VALIDATED BEFORE THE VALUE IS INLINED, so an operator's typo is refused here rather than becoming
 * a statement that inserts nothing and looks like a failed guard. `sqlQuote` would make a stray
 * apostrophe harmless anyway; this is about the operator's time, not about injection.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type PlatformOperatorGrant = {
  readonly principalId: string;
  readonly platformRole: PlatformRole;
  /** RFC 3339, UTC. */
  readonly createdAt: string;
};

/**
 * Renders the preflight and the guarded insert.
 *
 * Exported without any terminal handling so a verification harness can apply the output to a real
 * engine and assert what it does — which is the only way to prove a guard guards.
 */
export function renderPlatformOperatorSql(grant: PlatformOperatorGrant): string {
  const principal = sqlQuote(grant.principalId);
  const created = sqlQuote(grant.createdAt);
  return [
    '-- Dudo — grant PLATFORM AUTHORITY to an existing principal. docs/decisions/0025 decision 1.',
    '-- TWO statements, ONE database. READ THE FIRST BEFORE RUNNING THE SECOND.',
    '--',
    '-- Target: DB_CONTROL (dudo-control-plane). NOT DB_TENANT. Both tables below are',
    '-- control-plane tables and neither has a tenant_id column.',
    '--   wrangler d1 execute dudo-control-plane --remote --file=<this file>',
    '--',
    '-- Apply control-plane migrations 0001 through 0010 to that database first.',
    '--',
    '-- THIS FILE CREATES NO PRINCIPAL AND NO CREDENTIAL. The principal must already exist, and it',
    '-- must have been created WITHOUT an Organization:',
    '--   node platform/core/identity/tools/seed-principal.ts --no-organization',
    '',
    '-- =========================================================================================',
    '-- 1. PREFLIGHT. Expected answer: principal_exists = 1, membership_rows = 0,',
    '--    already_operator = 0. Anything else and DO NOT RUN STATEMENT 2.',
    '--',
    '--    membership_rows > 0 means this principal belongs to an Organization, and',
    '--    docs/decisions/0024 invariant 1 is that a platform principal holds ZERO memberships.',
    '--    A principal in both tables is refused EVERYWHERE — it would not be able to use the',
    '--    admin console, and no error it received would ever say why, because no error is',
    '--    permitted to distinguish that state from ordinary denial. Create a separate principal.',
    '-- =========================================================================================',
    'SELECT',
    `  (SELECT COUNT(*) FROM principal WHERE principal_id = ${principal})               AS principal_exists,`,
    `  (SELECT COUNT(*) FROM organization_membership WHERE principal_id = ${principal}) AS membership_rows,`,
    `  (SELECT COUNT(*) FROM platform_operator WHERE principal_id = ${principal})       AS already_operator;`,
    '',
    '-- =========================================================================================',
    '-- 2. THE GRANT. THIS ROW *IS* THE AUTHORITY — there is no flag on principal, no membership',
    '--    row, and no platform value in MembershipRole. Deleting it revokes platform authority on',
    "--    the operator's very next request, because authority is re-read every time and never",
    '--    cached.',
    '--',
    '--    IT IS AN INSERT...SELECT WITH A GUARD, NOT A PLAIN INSERT, AND THE GUARD IS THE POINT.',
    '--    If this principal does not exist, or holds ANY organization_membership row, THIS WRITES',
    '--    ZERO ROWS and reports so. That holds even on a database where migration 0010 has not',
    '--    been applied and no trigger is watching.',
    '--',
    '--    "0 rows written" HERE IS A REFUSAL, NOT A FAILURE. Re-run the preflight to see which of',
    '--    the two conditions refused it.',
    '--',
    '--    THERE IS NO AUDIT RECORD FOR THIS STATEMENT AND THERE CANNOT BE. The',
    '--    platform_operator_action log records what operators DO; it cannot record how they came',
    '--    to exist, because no code is in this path. Creating a platform operator is the one',
    '--    privileged change in Dudo with no trail at all. Note it somewhere your organisation can',
    '--    read.',
    '-- =========================================================================================',
    'INSERT INTO platform_operator (principal_id, platform_role, created_at)',
    `SELECT ${principal}, ${sqlQuote(grant.platformRole)}, ${created}`,
    `WHERE EXISTS (SELECT 1 FROM principal WHERE principal_id = ${principal})`,
    `  AND NOT EXISTS (SELECT 1 FROM organization_membership WHERE principal_id = ${principal});`,
    '',
  ].join('\n');
}

// =============================================================================================
// The terminal half. Nothing below here is imported by anything else.
// =============================================================================================

/**
 * The Node surface this tool touches, declared structurally.
 *
 * NOT `@types/node`, WHICH IS A PACKAGE AND IS NOT APPROVED. Declaring the members actually used
 * keeps the tool dependency-free and makes the surface reviewable: it cannot reach the filesystem,
 * the network or the environment, because it never names anything that could. It does not even
 * declare `env` — unlike `seed-principal.ts`, this tool reads no secret.
 */
type NodeProcess = {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  exit(code: number): void;
};

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as { process?: NodeProcess }).process;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const flag = argv.find((argument) => argument.startsWith(prefix));
  return flag === undefined ? undefined : flag.slice(prefix.length);
}

const USAGE = [
  'Usage:',
  '  node platform/core/identity/tools/seed-platform-operator.ts \\',
  '    --principal-id=<id> [--role=platform-admin|marketplace-moderator]',
  '',
  'It grants platform authority to an EXISTING principal. It creates no principal and no',
  'credential. To create the principal first — WITHOUT an Organization, which is required:',
  '',
  '  IDENTITY_LOOKUP_KEY=... node platform/core/identity/tools/seed-principal.ts --no-organization',
  '',
].join('\n');

function main(): void {
  const runtime = nodeProcess();
  if (runtime === undefined) {
    throw new Error('This tool runs under Node.');
  }

  const principalId = readFlag(runtime.argv, 'principal-id');
  if (principalId === undefined || !IDENTIFIER_PATTERN.test(principalId)) {
    runtime.stderr.write(
      (principalId === undefined
        ? '--principal-id is required.\n\n'
        : '--principal-id is not a platform identifier. It must match ^[A-Za-z0-9_-]{8,64}$ —\n' +
          'the grammar kernel/ids.ts generates at 22 characters. The value is not echoed here.\n\n') +
        USAGE,
    );
    runtime.exit(2);
    return;
  }

  // AN UNRECOGNISED ROLE IS A LOUD ERROR HERE, WHERE THE ADAPTER COLLAPSES IT TO `null` AND DENIES.
  // The two treatments look inconsistent and are not: the adapter is reading data a MIGRATION may
  // have written and must fail onto the safe path, so a build older than its data denies rather
  // than breaking. This is a human typing an argument, and the safe path for a typo is to refuse
  // to produce the statement at all.
  const requested = readFlag(runtime.argv, 'role');
  const role = requested === undefined ? DEFAULT_ROLE : toPlatformRole(requested);
  if (role === null) {
    runtime.stderr.write(
      `--role must be one of: ${PLATFORM_ROLES.join(', ')}.\n\n` +
        "These are permission-catalog.yaml's two platform-scope seed roles and the closed union\n" +
        'platform_operator.platform_role accepts. A value outside it fails the CHECK constraint in\n' +
        'migration 0008, and if it were somehow written it would grant nothing.\n',
    );
    runtime.exit(2);
    return;
  }

  const createdAt = new Date().toISOString();
  runtime.stdout.write(renderPlatformOperatorSql({ principalId, platformRole: role, createdAt }));

  const reachable = reachablePlatformPermissions(role);
  runtime.stderr.write(
    [
      '',
      'Two statements above; nothing has been executed. NO principal and NO credential is created.',
      '',
      `  principal_id    ${principalId}`,
      `  platform_role   ${role}`,
      '',
      'BEFORE YOU RUN THEM:',
      '  * Confirm the target is DB_CONTROL (dudo-control-plane), not DB_TENANT.',
      '  * Confirm control-plane migrations 0001 through 0010 have been applied to it.',
      '  * RUN STATEMENT 1 AND READ IT. Expected: principal_exists = 1, membership_rows = 0,',
      '    already_operator = 0.',
      '',
      'IF STATEMENT 2 REPORTS 0 ROWS WRITTEN, IT REFUSED — it did not fail. Either the principal',
      'does not exist, or it holds an organization_membership row. docs/decisions/0024 invariant 1:',
      'a platform principal holds ZERO memberships, because a membership row carrying platform',
      'authority assembles cross-tenant access out of entirely legitimate parts. Create a separate',
      'principal with seed-principal.ts --no-organization.',
      '',
      'AFTER IT WRITES ONE ROW, WHAT THIS ACCOUNT CAN AND CANNOT DO:',
      '  * It reaches the platform routes on the ADMIN HOST ONLY. On app.dudo.work and',
      '    api.dudo.work those paths answer 404, not 403.',
      `  * It holds ${String(reachable.length)} permission(s) that a platform route evaluates:`,
      reachable.length === 0 ? '      (none — this role cannot use the console at all)' : `      ${reachable.join('\n      ')}`,
      '  * IT CANNOT READ ANY TENANT DATA, and that is structural rather than a policy. With no',
      '    membership row, selectOrganization refuses every Organization it could name with the',
      "    same 404 a non-member receives, its session's active_organization_id stays null for its",
      '    whole life, and no tenant store can ever be resolved for it.',
      '  * /auth/session/organizations returns 200 with an EMPTY array. Correct, not an error.',
      '  * EVERY REQUEST IT MAKES WRITES AN AUDIT ROW, including the reads. At 2 row-writes each',
      '    against a 600/day per-principal ceiling, that is 300 platform actions per UTC day, after',
      '    which every platform route answers 503 until 00:00 UTC.',
      '',
      'TO REVOKE: DELETE FROM platform_operator WHERE principal_id = ...  It takes effect on the',
      "operator's very next request. The principal and its credential survive; it becomes an",
      'account that can log in and reach nothing.',
      '',
      'NOTHING IN THIS OUTPUT IS CREDENTIAL MATERIAL. This tool reads no secret and computes no',
      'hash, so unlike seed-principal.ts there is nothing here to clear from your scrollback.',
      '',
    ].join('\n'),
  );
}

/**
 * Run only when this file is the entry point, so importing it from a verification harness does not
 * write to stdout.
 */
const entryPoint = nodeProcess();
if (entryPoint !== undefined && (entryPoint.argv[1] ?? '').endsWith('seed-platform-operator.ts')) {
  try {
    main();
  } catch (cause) {
    entryPoint.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    entryPoint.exit(1);
  }
}
