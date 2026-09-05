/**
 * ===========================================================================================
 * THE BOOTSTRAP PATH. How the FIRST platform operator comes to exist.
 * `docs/decisions/0025` decision 1 · contract `platform-operator-v1`, `theBootstrapProblem`.
 * ===========================================================================================
 *
 * THE QUESTION: who writes the first `platform_operator` row, when no platform operator exists to
 * authorize it?
 *
 * THE RULING: OUT OF BAND, BY AN OPERATOR RUNNING SQL, exactly as `identity/tools/
 * seed-principal.ts` already works for credentials. THE CONTRACT PUBLISHES NO ROUTE THAT CREATES
 * A PLATFORM OPERATOR. There is no `core.platform-operator.create`, it is deliberately absent
 * from `permission-catalog.yaml`, and adding one is a decision rather than an extension.
 *
 * WHY, and it is worth reading before anyone proposes the endpoint: a route that grants platform
 * authority is the single most valuable target in the platform, it would be reachable by exactly
 * one class of caller, and its only legitimate use is a handful of times in Dudo's life. THE
 * FREQUENCY DOES NOT JUSTIFY THE SURFACE. This is the same reasoning `credential-store.ts` applies
 * to enrolment — "the running Worker has no code path that writes a credential at all" — and this
 * table is the one place in the whole super-admin surface where that property SURVIVES, because
 * `credential-reset-v1` destroys it for `principal_credential` and cannot for this one.
 *
 * ===========================================================================================
 * *** WHY THIS IS A SEPARATE TOOL FROM `seed-principal.ts`, AND IT IS NOT TIDINESS ***
 * ===========================================================================================
 *
 * `seed-principal.ts` WRITES FIVE ROWS AND TWO OF THEM MAKE A PLATFORM OPERATOR ILLEGAL:
 *
 *     principal · principal_credential · organization · ORGANIZATION_MEMBERSHIP · tenant_directory
 *
 * `docs/decisions/0024` invariant 1 is that A PLATFORM PRINCIPAL HOLDS ZERO MEMBERSHIP ROWS.
 * Running the existing tool and then inserting a `platform_operator` row for the principal it
 * created produces exactly the state `platform-authority.ts` refuses everywhere — an account
 * that logs in, reaches the admin console, and is denied every route, for a reason no error
 * message will ever explain, because no error is permitted to distinguish it.
 *
 * IT WOULD ALSO BE CAUGHT BY `0010_platform_operator_mutual_exclusion.sql`'s trigger, if that
 * migration has been applied. THE TRIGGER IS THE BACKSTOP AND THIS TOOL IS THE FIX: the operator
 * should never be in a position to write the bad statement in the first place.
 *
 * SO THIS TOOL EMITS **THREE** ROWS AND NO OTHERS:
 *
 *     principal · principal_credential · platform_operator
 *
 * NO `organization`, NO `organization_membership`, NO `tenant_directory`. An operator has no
 * tenant, cannot select one, and must not have a directory entry to reach one with. If you find
 * yourself adding an Organization here so the account "can see something", stop and read `0024`.
 *
 * ===========================================================================================
 * THE FOUR PROPERTIES THAT MAKE IT SAFE — `seed-principal.ts`'s, unchanged
 * ===========================================================================================
 *
 *   1. IT IS NOT AN ENDPOINT AND CANNOT BECOME ONE. Nothing in `platform/core/http/**` imports
 *      this directory, and its only exports are for a verification harness.
 *   2. IT EXECUTES NOTHING. It opens no database, makes no network call, and runs no statement.
 *      It writes SQL to standard output and stops.
 *   3. IT NEVER PRINTS THE DERIVED KEY. What appears in the SQL is the stored `verifier` — a hash
 *      of a hash — plus a salt and two identifiers.
 *   4. IT GENERATES THE PASSWORD AND NEVER ACCEPTS ONE. `docs/decisions/0017`: rate limiting is
 *      not what protects these accounts, entropy is, and that argument collapses the moment a
 *      human chooses the password. THAT MATTERS MORE HERE THAN ANYWHERE ELSE IN DUDO — this is
 *      the credential for the account that can create Organizations and reset other people's
 *      credentials.
 *
 * ===========================================================================================
 * HOW TO RUN IT
 * ===========================================================================================
 *
 *   IDENTITY_LOOKUP_KEY='<the same secret value set with wrangler secret put>' \
 *     node platform/core/platform/tools/seed-platform-operator.ts [--role=platform-admin]
 *
 * It prompts for the email address, prints the generated password to the terminal and the SQL to
 * standard output, and exits. Prefix the command with a SPACE if the shell is configured to skip
 * history for space-prefixed lines.
 *
 * THE DERIVATION IS `seed-principal.ts`'s, IMPORTED RATHER THAN REIMPLEMENTED. `buildSeedRows`
 * performs the client half and the server half with the same primitives the Worker and both
 * clients use, which is what makes the scheme self-checking: an implementation that differs in
 * any respect produces a verifier that does not match and a login that is refused, loudly and
 * totally, rather than silently weakened.
 */

import {
  buildSeedRows,
  generatePassword,
  prompt,
  sqlQuote,
} from '../../identity/tools/seed-principal.ts';
import {
  CLIENT_KDF_ITERATIONS,
  MIN_IDENTITY_LOOKUP_KEY_BYTES,
} from '../../identity/credential-store.ts';
import { SERVER_KDF_ITERATIONS, SUPPORTED_ALGORITHM } from '../../identity/credential-verifier.ts';
import type { PlatformRole } from '../platform-permissions.ts';
import { PLATFORM_ROLES, reachablePlatformPermissions, toPlatformRole } from '../platform-permissions.ts';

/**
 * The role written when `--role` is not given.
 *
 * `platform-admin`, because `marketplace-moderator` holds only `core.marketplace.moderate`, which
 * no route in this class evaluates — an operator seeded at that role can log in and is refused
 * every platform route including `whoami`. That is the contract's stated consequence (PO-5) and
 * not a defect here, but it is a poor default.
 */
const DEFAULT_ROLE: PlatformRole = 'platform-admin';

export type PlatformOperatorSeedRows = {
  readonly principalId: string;
  readonly identifierHash: string;
  readonly salt: string;
  readonly verifier: string;
  readonly platformRole: PlatformRole;
  readonly createdAt: string;
};

/**
 * Renders the three statements.
 *
 * VALUES ARE INLINED RATHER THAN PARAMETERISED, because the output is SQL a human pastes into
 * `wrangler d1 execute`, which takes a statement and not a parameter list. Every value inlined is
 * one this tool generated — a base64url string, an RFC 3339 timestamp, or a value narrowed to the
 * `PlatformRole` union — and `sqlQuote` doubles any apostrophe regardless. NOTHING THE OPERATOR
 * TYPED IS INLINED: the email address appears nowhere in the output, because it appears nowhere
 * in the schema.
 */
export function renderPlatformOperatorSql(rows: PlatformOperatorSeedRows): string {
  const created = sqlQuote(rows.createdAt);
  return [
    '-- Dudo — bootstrap a PLATFORM OPERATOR. docs/decisions/0025 decision 1.',
    '-- THREE statements, ONE database. Review before running.',
    '--',
    '-- Target: DB_CONTROL (dudo-control-plane). NOT DB_TENANT. Every table below is a',
    '-- control-plane table and none of them has a tenant_id column.',
    '--   wrangler d1 execute dudo-control-plane --remote --file=<this file>',
    '--',
    '-- Apply control-plane migrations 0001 through 0010 to that database first, or these fail',
    '-- on a missing table.',
    '--',
    '-- *** THERE IS DELIBERATELY NO organization, organization_membership OR tenant_directory',
    '-- *** ROW HERE. docs/decisions/0024: a platform principal holds ZERO memberships. Adding',
    '-- *** one gives this principal platform authority AND a tenant scope at the same time,',
    '-- *** which is how cross-tenant access gets assembled out of entirely legitimate parts.',
    '-- *** If 0010 has been applied, its trigger refuses the membership insert outright.',
    '--',
    '-- THE ORDER MATTERS. principal comes first because principal_credential and',
    '-- platform_operator both reference it.',
    '',
    'INSERT INTO principal (principal_id, principal_type, status, created_at)',
    `VALUES (${sqlQuote(rows.principalId)}, 'user', 'active', ${created});`,
    '',
    'INSERT INTO principal_credential',
    '  (identifier_hash, principal_id, algorithm, iterations, salt, verifier, created_at)',
    'VALUES (',
    `  ${sqlQuote(rows.identifierHash)},`,
    `  ${sqlQuote(rows.principalId)},`,
    `  ${sqlQuote(SUPPORTED_ALGORITHM)},`,
    `  ${String(SERVER_KDF_ITERATIONS)},`,
    `  ${sqlQuote(rows.salt)},`,
    `  ${sqlQuote(rows.verifier)},`,
    `  ${created}`,
    ');',
    '',
    '-- THE ROW BELOW *IS* THE AUTHORITY. There is no flag on principal, no membership row, and',
    '-- no platform value in MembershipRole. Deleting this row revokes platform authority on the',
    "-- operator's very next request — authority is re-read every time, never cached.",
    '--',
    '-- THERE IS NO AUDIT RECORD FOR THIS STATEMENT AND THERE CANNOT BE. The',
    '-- platform_operator_action log records what operators DO; it cannot record how they came to',
    '-- exist, because no code is in this path. Creating a platform operator is the one',
    '-- privileged change in Dudo with no trail at all. Note it somewhere your organisation can',
    '-- read.',
    'INSERT INTO platform_operator (principal_id, platform_role, created_at)',
    `VALUES (${sqlQuote(rows.principalId)}, ${sqlQuote(rows.platformRole)}, ${created});`,
    '',
  ].join('\n');
}

// =============================================================================================
// The terminal half. Nothing below here is imported by anything else.
// =============================================================================================

type NodeProcess = {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  exit(code: number): void;
};

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as { process?: NodeProcess }).process;
}

/**
 * Reads `--role=<value>`.
 *
 * AN UNRECOGNISED VALUE IS A LOUD ERROR HERE, WHERE THE ADAPTER COLLAPSES IT TO `null` AND DENIES.
 * The two treatments look inconsistent and are not: the adapter is reading data a MIGRATION may
 * have written and must fail onto the safe path so a build older than its data denies rather than
 * breaking. This is a human typing an argument, and the safe path for a typo is to refuse to
 * produce the statement — a row written with a misspelled role would pass no CHECK constraint,
 * and if it somehow did it would grant nothing and give no clue why.
 */
function readRole(argv: readonly string[]): PlatformRole | undefined {
  const flag = argv.find((argument) => argument.startsWith('--role='));
  if (flag === undefined) {
    return DEFAULT_ROLE;
  }
  return toPlatformRole(flag.slice('--role='.length)) ?? undefined;
}

async function main(): Promise<void> {
  const runtime = nodeProcess();
  if (runtime === undefined) {
    throw new Error('This tool runs under Node.');
  }

  const role = readRole(runtime.argv);
  if (role === undefined) {
    runtime.stderr.write(
      `--role must be one of: ${PLATFORM_ROLES.join(', ')}.\n\n` +
        'These are permission-catalog.yaml\'s two platform-scope seed roles and the closed union\n' +
        'platform_operator.platform_role accepts. A value outside it fails the migration\'s CHECK\n' +
        'constraint, and if it were somehow written it would grant nothing.\n',
    );
    runtime.exit(2);
    return;
  }

  const keyText = runtime.env.IDENTITY_LOOKUP_KEY;
  if (keyText === undefined || keyText.length === 0) {
    runtime.stderr.write(
      'IDENTITY_LOOKUP_KEY is not set.\n\n' +
        'It must be the SAME value the deployed Worker holds, set there with\n' +
        '  wrangler secret put IDENTITY_LOOKUP_KEY\n' +
        'A different value here produces a lookup hash the Worker will never compute, and the\n' +
        'operator account you create will silently be unreachable — the login is simply refused,\n' +
        'because a miss and a wrong password are deliberately indistinguishable.\n',
    );
    runtime.exit(2);
    return;
  }
  const lookupKey = new TextEncoder().encode(keyText);
  if (lookupKey.length < MIN_IDENTITY_LOOKUP_KEY_BYTES) {
    runtime.stderr.write(
      `IDENTITY_LOOKUP_KEY is ${String(lookupKey.length)} bytes; at least ` +
        `${String(MIN_IDENTITY_LOOKUP_KEY_BYTES)} are required.\n`,
    );
    runtime.exit(2);
    return;
  }

  const email = await prompt('Email address for the platform operator: ', false);

  // NO PASSWORD PROMPT. See property 4 in the header.
  const password = generatePassword();

  runtime.stderr.write(
    `\nDeriving. This takes a moment: ${String(CLIENT_KDF_ITERATIONS)} client iterations plus ` +
      `${String(SERVER_KDF_ITERATIONS)} server iterations, which is the work factor doing its ` +
      'job.\n\n',
  );

  // `buildSeedRows` ALSO GENERATES AN `organizationId`, AND IT IS DELIBERATELY DISCARDED. The
  // function is reused for its DERIVATION, which must be identical to the one the Worker
  // performs; the Organization it would have created is exactly the row this tool exists not to
  // write. Nothing below reads `rows.organizationId`, and no statement above mentions it.
  const rows = await buildSeedRows({ email, password, lookupKey, nowMs: Date.now() });

  runtime.stdout.write(
    renderPlatformOperatorSql({
      principalId: rows.principalId,
      identifierHash: rows.identifierHash,
      salt: rows.salt,
      verifier: rows.verifier,
      platformRole: role,
      createdAt: rows.createdAt,
    }),
  );

  const reachable = reachablePlatformPermissions(role);
  runtime.stderr.write(
    [
      '',
      '===============================================================================',
      ' THE PASSWORD. SHOWN ONCE. NOTHING STORES IT AND IT CANNOT BE RECOVERED.',
      '===============================================================================',
      '',
      `  ${password}`,
      '',
      ' Put it in a password manager NOW. There is no reset flow — credential-reset-v1 is not',
      ' built, and it would need a platform operator to run it, which is the account you are',
      ' creating. If this is lost, run this tool again and replace the credential row.',
      '',
      ' It is machine-generated on purpose (docs/decisions/0017). This is the credential for an',
      ' account that can enumerate every Organization on the platform, and — once onboarding and',
      ' credential reset are built — create tenants and take over other people\'s accounts. Do',
      ' not replace it with one you chose.',
      '',
      '===============================================================================',
      '',
      'Three statements above; nothing has been executed.',
      '',
      `  principal_id    ${rows.principalId}`,
      `  platform_role   ${role}`,
      '',
      'BEFORE YOU RUN THEM:',
      '  * Confirm the target is DB_CONTROL (dudo-control-plane), not DB_TENANT.',
      '  * Confirm control-plane migrations 0001 through 0010 have been applied to it.',
      '  * Confirm this principal_id appears in NO organization_membership row. It is new, so it',
      '    does not — but the check is the whole invariant, and 0010\'s trigger enforces it only',
      '    if that migration applied. It has not been verified against a real D1 engine.',
      '',
      'AFTER YOU RUN THEM, WHAT THIS ACCOUNT CAN AND CANNOT DO:',
      '  * It can log in and reach the platform routes on the admin host ONLY. On app.dudo.work',
      '    and api.dudo.work those paths answer 404.',
      `  * It holds ${String(reachable.length)} permission(s) that a platform route evaluates:`,
      reachable.length === 0 ? '      (none)' : `      ${reachable.join('\n      ')}`,
      '  * IT CANNOT READ ANY TENANT DATA, and that is structural rather than a policy. It has no',
      '    membership row, so selectOrganization refuses every Organization it could name with',
      '    the same 404 a non-member receives, its session\'s active_organization_id stays null',
      '    for its whole life, and no tenant store can ever be resolved for it.',
      '  * /auth/session/organizations returns 200 with an EMPTY array. That is the correct and',
      '    expected answer, not an error.',
      '  * EVERY REQUEST IT MAKES WRITES AN AUDIT ROW, including the reads. At 2 row-writes each',
      '    and a 600/day per-principal ceiling, that is 300 platform actions per UTC day, after',
      '    which every platform route answers 503 until 00:00 UTC.',
      '',
      'HANDLING:',
      '  * The SQL contains the stored verifier and salt. They authenticate nobody on their own,',
      '    but they are the exact target an offline attack works against.',
      '  * Clear your scrollback. Do not paste any of this into an issue, a chat, or a commit —',
      '    both repositories are public.',
      '',
    ].join('\n'),
  );
}

/**
 * Run only when this file is the entry point, so importing it from a verification harness does not
 * open a prompt and block the run.
 */
const entryPoint = nodeProcess();
if (
  entryPoint !== undefined &&
  (entryPoint.argv[1] ?? '').endsWith('seed-platform-operator.ts')
) {
  main().catch((cause: unknown) => {
    entryPoint.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    entryPoint.exit(1);
  });
}
