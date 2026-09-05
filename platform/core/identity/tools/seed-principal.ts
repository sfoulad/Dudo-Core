/**
 * ===========================================================================================
 * THE SEED PATH. How the FIRST principal on the platform comes to exist. `docs/decisions/0015`.
 * ===========================================================================================
 *
 * WITHOUT THIS, NOTHING CAN EVER LOG IN. There is no signup, no admin UI, no invitation flow and
 * no bootstrap endpoint: `CredentialStore` has exactly one method and it is a read, so the
 * deployed Worker contains no code path that creates a principal or a credential. That is
 * deliberate — see below — and it means the first account has to be made from outside.
 *
 * ===========================================================================================
 * WHAT THIS IS, AND THE FOUR PROPERTIES THAT MAKE IT SAFE
 * ===========================================================================================
 *
 * A COMMAND-LINE TOOL THAT PRINTS SQL. It is not part of the Worker, is not reachable over HTTP,
 * and is not importable by anything that is.
 *
 *   1. IT IS NOT AN ENDPOINT AND CANNOT BECOME ONE. Nothing in `platform/core/http/**` imports
 *      this directory, and this file's only exports are for a verification harness. A bootstrap
 *      ENDPOINT — the obvious alternative, guarded by "only if the principal table is empty" — is
 *      an unauthenticated account-creation route whose guard is a race, and it stays reachable
 *      forever after it stops being needed. There is no such route here and none may be added.
 *   2. IT EXECUTES NOTHING. It opens no database, makes no network call, and runs no statement.
 *      It writes SQL to standard output and stops. The operator reviews the statements and runs
 *      them, which keeps `.claude/rules/security.md` §7 intact: no agent runs a migration or a
 *      write against real data, and no agent needs to.
 *   3. IT NEVER PRINTS THE DERIVED KEY. What appears in the SQL is the stored `verifier` — a hash
 *      of a hash — plus a salt and three identifiers. That is still credential-adjacent material:
 *      it authenticates nobody, but it is the exact target an offline attack works against, so
 *      the closing notice says so and asks the operator to clear their scrollback.
 *   4. IT GENERATES THE PASSWORD AND NEVER ACCEPTS ONE. See the next section — this is the
 *      constraint the whole login slice currently rests on.
 *
 * ===========================================================================================
 * THE PASSWORD IS MACHINE-GENERATED AND THIS IS BINDING. `docs/decisions/0017`.
 * ===========================================================================================
 *
 * `0017` made login reachable by accepting the in-process pre-authentication rate limiter for the
 * closed beta, and it is explicit about what that costs and what carries the weight instead:
 * **rate limiting is not what protects these accounts — password entropy is.** It is equally
 * explicit that the client's 600,000 KDF iterations are NOT an attacker cost. An attacker does
 * not run the client; it computes the value directly at roughly 72 ms and posts it. That figure
 * must never be cited as a control, here or anywhere.
 *
 * SO THE ARGUMENT KEEPING THESE ACCOUNTS SAFE IS ARITHMETIC ABOUT THE PASSWORD ITSELF, AND IT
 * COLLAPSES THE MOMENT A HUMAN CHOOSES ONE. A prompt — even one that refuses short values — lets
 * an operator type something memorable, and a memorable password against a limiter that does not
 * bind across isolates is the exact case `0017` is scoped to exclude. The tool therefore has NO
 * PASSWORD PROMPT AND NO PASSWORD ARGUMENT: 24 CSPRNG bytes, base64url, 32 characters, about 192
 * bits. It is printed ONCE and cannot be recovered afterwards, because nothing stores it.
 *
 * `0017` IS SCOPED TO STAGING AND TO OPERATOR-SEEDED ACCOUNTS, AND IT EXPIRES THE MOMENT ANY
 * PASSWORD IS HUMAN-SELECTED. Whoever builds self-service registration inherits that sentence
 * along with the endpoint.
 *
 * ===========================================================================================
 * WHAT IT CREATES: A WORKING BOOTSTRAP, NOT JUST AN IDENTITY. FIVE ROWS.
 * ===========================================================================================
 *
 *   principal                a `user`, active
 *   principal_credential     the verifier, salt, algorithm and iteration count
 *   organization             a tenant, active
 *   organization_membership  the principal in that Organization, active
 *   tenant_directory         `(organization_id -> DB_TENANT)`, active
 *
 * AN EARLIER VERSION OF THIS TOOL STOPPED AFTER THE FIRST TWO, on the ground that inventing an
 * Organization would settle the organization-structure slice's data model in a seed script. The
 * Team Lead overruled that narrowly and correctly: `0002_organization.sql`,
 * `0003_organization_membership.sql` and `0005_tenant_directory.sql` are decided schemas with no
 * undecided fields between them, and under `docs/decisions/0006` Option A every Organization
 * resolves to the same binding, so the directory row is `(organization_id -> DB_TENANT)` with
 * nothing to choose. **Inserting rows into decided tables is operator seeding; it is not data-model
 * design.** The boundary sits further out than the first version placed it — but it is still a
 * boundary, and anything genuinely undecided is reported rather than invented.
 *
 * WHAT IS STILL NOT DECIDED AND IS THEREFORE STILL NOT DONE HERE: the audit record for creating
 * an Organization. `control-plane-admission.ts` records that it has nowhere to go — *"its audit
 * record cannot go into the new Organization's tenant audit log, because reaching that log needs a
 * tenant store handle, which needs the directory entry that the same operation is still
 * creating."* An operator running SQL by hand produces no audit row and cannot; when Organization
 * creation becomes a product operation, that question has to be answered before it ships.
 *
 * THE PRINCIPAL STILL HAS NO GRANTS. `principal-authorization-source.ts` is deny-all because
 * `docs/decisions/0007` does not say where a principal's grants are stored. So the seeded account
 * logs in, selects its Organization, resolves a tenant store — and is then refused by the
 * authorizer at pipeline step 3. That is one gap further along than before and it is the last one
 * between here and a demonstrable request.
 *
 * ===========================================================================================
 * HOW TO RUN IT
 * ===========================================================================================
 *
 *   IDENTITY_LOOKUP_KEY='<the same secret value set with wrangler secret put>' \
 *     node platform/core/identity/tools/seed-principal.ts
 *
 * It prompts for the email address, prints the generated password to the terminal and the SQL to
 * standard output, and exits.
 *
 * THE KEY COMES FROM THE ENVIRONMENT because it is a long random string an operator pastes from a
 * secret manager and it is already present in the deployment. Prefix the command with a SPACE if
 * the shell is configured to skip history for space-prefixed lines.
 *
 * NODE 22 RUNS THIS DIRECTLY by stripping types. There is no build step, no runner package and
 * nothing installed — `0003` approves TypeScript and no npm package. `crypto.subtle` and
 * `crypto.getRandomValues` are platform globals in Node and in Workers alike, so this tool and the
 * Worker perform the identical derivation with the identical primitives.
 */

import {
  CLIENT_KDF_ITERATIONS,
  createHmacIdentifierHasher,
  isSubmittableIdentifier,
  MIN_IDENTITY_LOOKUP_KEY_BYTES,
  normalizeIdentifier,
  normalizePassword,
  toBase64Url,
} from '../credential-store.ts';
import {
  SALT_BYTES,
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  VERIFIER_BYTES,
} from '../credential-verifier.ts';
import type { CryptoBytes } from '../../kernel/bytes.ts';
import type { MembershipRole } from '../../authorization/roles.ts';

/**
 * The role the seeded membership carries. `docs/decisions/0019`.
 *
 * TYPED AS `MembershipRole` RATHER THAN AS A STRING, so a typo here is a compile error rather than
 * a row that passes the migration's CHECK, denies everything at runtime, and looks correct in the
 * SQL. The failure it prevents is the quiet one: a seeded account that logs in and is refused
 * every Action, with nothing in the output to say why.
 */
const SEEDED_ROLE: MembershipRole = 'owner';

// =============================================================================================
// The derivation. Identical to what the two clients and the server do, by construction.
// =============================================================================================

async function pbkdf2(
  input: CryptoBytes,
  salt: CryptoBytes,
  iterations: number,
): Promise<CryptoBytes> {
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    VERIFIER_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * THE CLIENT'S HALF, PERFORMED HERE.
 *
 * This is what a browser or an iPhone computes at login: PBKDF2 over the password, salted with the
 * normalised email, 600,000 iterations. Running it in the enrollment tool is what makes the whole
 * scheme self-checking — if a client implements the derivation differently in any respect, its
 * output does not match what was stored and the login is refused. The mismatch is loud and total
 * rather than a silent weakening, and that is the single most valuable property of enrolling this
 * way.
 *
 * IT IS SLOW ON PURPOSE. 600,000 iterations takes roughly a second here, exactly as it will in the
 * client. A tool that returned instantly would mean the derivation was not being done.
 */
export async function deriveClientValue(
  password: string,
  normalizedIdentifier: string,
): Promise<CryptoBytes> {
  return pbkdf2(
    // NFC BEFORE UTF-8, AND NOT NFKC. `0015` §D as amended 2026-09-04. The generated passwords
    // this tool produces are ASCII, so NFC is the identity function on them and this line does
    // nothing today — it is here because `buildSeedRows` is exported and a verification harness
    // must be able to prove the tool and both clients agree on a non-ASCII vector. See
    // `normalizePassword` in `credential-store.ts` for why NFKC here would destroy entropy.
    new TextEncoder().encode(normalizePassword(password)),
    new TextEncoder().encode(normalizedIdentifier),
    CLIENT_KDF_ITERATIONS,
  );
}

export type SeedRows = {
  readonly principalId: string;
  /**
   * The tenant. `MULTITENANCY_STANDARD.md` §2: Organization and tenant are "the same thing in two
   * vocabularies", so this value becomes `tenant_id` on every row of the tenant database. It is
   * CSPRNG-generated for the same reason `principal_id` is — a guessable tenant identifier is a
   * tenant identifier someone will eventually try to name in a request.
   */
  readonly organizationId: string;
  readonly identifierHash: string;
  readonly salt: string;
  readonly verifier: string;
  readonly createdAt: string;
};

/**
 * The shortest password `buildSeedRows` will enroll.
 *
 * IT IS A BACKSTOP, NOT A POLICY, AND NOT THE CONTROL. The tool no longer accepts a password at
 * all — see the header and `docs/decisions/0017`. This floor remains because `buildSeedRows` is
 * exported for verification harnesses and shared test vectors, and a harness passing a weak value
 * should not silently produce a row that looks like a real enrolment.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * 24 CSPRNG bytes as base64url: 32 characters, about 192 bits.
 *
 * ===========================================================================================
 * THIS IS THE CONTROL `docs/decisions/0017` RESTS ON, SO THE NUMBER MATTERS.
 * ===========================================================================================
 *
 * At 192 bits there is no guessing attack — online, offline, throttled or not — and that is the
 * whole point: `0017` accepts a rate limiter that does not bind across isolates, on the explicit
 * basis that entropy and not throttling is what protects these accounts. Anything an operator
 * could remember would void that.
 *
 * BASE64URL RATHER THAN A HUMAN-FRIENDLY ALPHABET. It has no ambiguous-character problem worth
 * solving here because this value is copied into a password manager, not transcribed from a
 * screen — and every alphabet substitution that helps a reader also costs entropy per character.
 * It is also exactly the alphabet the rest of this slice already uses.
 *
 * IT IS NOT STORED, NOT LOGGED AND NOT RECOVERABLE. The tool prints it once. `buildSeedRows`
 * consumes it into a derivation and does not return it.
 */
export function generatePassword(): string {
  return toBase64Url(randomBytes(24));
}

/**
 * Produces the two rows. Exported without any terminal handling so a verification harness can
 * assert the derivation against a fixed vector without driving a prompt.
 *
 * THE RETURN VALUE CONTAINS NO PASSWORD AND NO CLIENT-DERIVED VALUE. `clientValue` is consumed by
 * the second derivation and is not carried out of this function.
 */
export async function buildSeedRows(input: {
  readonly email: string;
  readonly password: string;
  readonly lookupKey: CryptoBytes;
  readonly nowMs: number;
  /** Injected so a harness can pin them. Production callers pass the CSPRNG-backed defaults. */
  readonly salt?: CryptoBytes;
  readonly principalId?: string;
  readonly organizationId?: string;
}): Promise<SeedRows> {
  if (!isSubmittableIdentifier(input.email)) {
    throw new Error(
      'That address is not one Dudo will accept. It must be 3 to 254 printable ASCII ' +
        'characters, contain an "@", and contain no spaces. The restriction is deliberate: the ' +
        'same normalisation has to run in three implementations — this tool, the web client and ' +
        'the Apple client — and a value needing Unicode case folding or whitespace trimming is a ' +
        'value they can disagree about. See platform/core/identity/credential-store.ts.',
    );
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    // NOT A PASSWORD POLICY, AND IT CANNOT BE ONE. `0015` §D records that a client-side KDF makes
    // server-side policy impossible: the server never sees a password. This is a floor applied at
    // the only moment Dudo ever holds one, and 12 characters is roughly the length below which a
    // 610,000-iteration work factor stops being the thing protecting the account.
    throw new Error(
      `The password must be at least ${String(MIN_PASSWORD_LENGTH)} characters. Dudo cannot ` +
        'enforce this at login — under docs/decisions/0015 §D the server never sees a password, ' +
        'only a value derived from one — so this prompt is the only place a length floor can be ' +
        'applied at all.',
    );
  }

  const normalized = normalizeIdentifier(input.email);
  const identifiers = await createHmacIdentifierHasher(input.lookupKey);
  const identifierHash = await identifiers.hash(normalized);

  const salt = input.salt ?? randomBytes(SALT_BYTES);
  const clientValue = await deriveClientValue(input.password, normalized);
  // THE SECOND DERIVATION IS THE WHOLE POINT. `0015` §D, normative: the server stores a hash of
  // the client's output, NEVER the output itself — storing `clientValue` here would make this
  // table directly usable as a login credential with no cracking at all.
  const verifier = await pbkdf2(clientValue, salt, SERVER_KDF_ITERATIONS);

  return {
    principalId: input.principalId ?? toBase64Url(randomBytes(16)),
    // 128 bits, matching `kernel/ids.ts` exactly: 22 characters of base64url, not a counter and
    // not timestamp-prefixed. The generator itself is not reused here because it lives behind an
    // injected port meant for request handling, and this tool composes no runtime.
    organizationId: input.organizationId ?? toBase64Url(randomBytes(16)),
    identifierHash,
    salt: toBase64Url(salt),
    verifier: toBase64Url(verifier),
    createdAt: new Date(input.nowMs).toISOString(),
  };
}

function randomBytes(count: number): CryptoBytes {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Renders the statements.
 *
 * VALUES ARE INLINED RATHER THAN PARAMETERISED, because the output is SQL a human pastes into
 * `wrangler d1 execute`, which takes a statement and not a parameter list. Every value inlined is
 * one this tool generated — a base64url string, an RFC 3339 timestamp, or a fixed literal — and
 * `sqlQuote` doubles any apostrophe regardless, so a value that somehow contained one could not
 * terminate the string. NOTHING THE OPERATOR TYPED IS INLINED: the email address appears nowhere
 * in the output, because it appears nowhere in the schema.
 *
 * ===========================================================================================
 * `includeOrganization: false` — THE MEMBERLESS MODE, ADDED FOR `docs/decisions/0025`.
 * ===========================================================================================
 *
 * IT DEFAULTS TO `true`, SO EVERY EXISTING CALLER AND EVERY EXISTING TEST IS UNCHANGED. The
 * five-row output is still what an ordinary run produces.
 *
 * WHY THE MODE EXISTS. A PLATFORM OPERATOR HOLDS ZERO MEMBERSHIP ROWS (`0024` invariant 1), and
 * this tool's five-row output contains one. So the tool that creates every principal in Dudo
 * could not create the one kind of principal `0025` needs, and `seed-platform-operator.ts` — which
 * grants authority to an EXISTING principal and deliberately creates no credential — had no way
 * to obtain a subject. Running the five-row form first and then granting authority produces
 * exactly the state refused everywhere, and `0010_platform_operator_mutual_exclusion.sql`'s
 * trigger refuses the grant outright.
 *
 * WHAT THE MEMBERLESS FORM PRODUCES: an account that CAN AUTHENTICATE AND CAN REACH NOTHING.
 * `/auth/session/organizations` answers 200 with `[]`, every Organization it could name at
 * `/auth/session/organization` answers the same 404 a non-member receives, its session's
 * `active_organization_id` stays null for its whole life, and no tenant store can ever be
 * resolved for it. That is not a broken account — it is precisely the shape a platform operator
 * must have, and it is why the isolation is structural rather than a policy.
 */
export function renderSeedSql(
  rows: SeedRows,
  options: { readonly includeOrganization?: boolean } = {},
): string {
  const includeOrganization = options.includeOrganization ?? true;
  const created = sqlQuote(rows.createdAt);
  const tenantStatements = includeOrganization
    ? organizationStatements(rows, created)
    : memberlessNotice();
  return [
    includeOrganization
      ? '-- Dudo — bootstrap the first principal and its Organization.'
      : '-- Dudo — bootstrap a MEMBERLESS principal. No Organization, no membership.',
    includeOrganization
      ? '-- FIVE statements, ONE database. Review before running.'
      : '-- TWO statements, ONE database. Review before running.',
    '--',
    '-- Target: DB_CONTROL (dudo-control-plane). NOT DB_TENANT. Every table below is a',
    '-- control-plane table and none of them has a tenant_id column.',
    '--   wrangler d1 execute dudo-control-plane --remote --file=<this file>',
    '--',
    '-- Apply control-plane migrations 0001 through 0007 to that database first, or these fail',
    '-- on a missing table or a missing `role` column.',
    '--',
    '-- THE ORDER MATTERS AND IS NOT ALPHABETICAL. principal and organization come first because',
    '-- organization_membership references both and tenant_directory references organization. If',
    '-- foreign keys are enforced, running them out of order fails; if they are not, running them',
    '-- out of order succeeds and leaves rows pointing at nothing. Keep the order.',
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
    ...tenantStatements,
  ].join('\n');
}

function organizationStatements(rows: SeedRows, created: string): readonly string[] {
  return [
    '-- The tenant. This identifier becomes tenant_id on every row of the tenant database.',
    'INSERT INTO organization (organization_id, status, created_at)',
    `VALUES (${sqlQuote(rows.organizationId)}, 'active', ${created});`,
    '',
    '-- Membership is what makes the Organization selectable. Without this row the session',
    '-- resolves to organization-not-selected and there is nothing to select.',
    '--',
    "-- `role` CARRIES THE GRANT (docs/decisions/0019). 'owner' is the full Customer Directory",
    '-- Action set in MVP scope, mapped in platform/core/authorization/roles.ts. A closed beta',
    '-- with one seeded principal per Organization has nobody to be a read-only member yet.',
    '-- A membership row with a NULL or unrecognised role grants NOTHING, so omitting this',
    '-- column produces an account that logs in and is refused every Action.',
    '--',
    '-- *** THIS ROW IS WHAT MAKES THE PRINCIPAL INELIGIBLE TO BE A PLATFORM OPERATOR. ***',
    '-- docs/decisions/0024 invariant 1: a platform principal holds ZERO memberships. If this',
    '-- account is meant to run the admin console, re-run with --no-organization instead.',
    '--',
    '-- THERE IS NO AUDITED WAY TO CHANGE IT AFTERWARDS. docs/decisions/0007 rule 9 requires',
    '-- permission changes to be audited and an operator editing this column by hand produces no',
    '-- audit record. 0019 records that gap rather than closing it.',
    'INSERT INTO organization_membership',
    '  (principal_id, organization_id, status, role, created_at)',
    `VALUES (${sqlQuote(rows.principalId)}, ${sqlQuote(rows.organizationId)}, 'active', ` +
      `${sqlQuote(SEEDED_ROLE)}, ${created});`,
    '',
    '-- The directory entry is what turns a selected Organization into a store handle.',
    '-- DB_TENANT for every Organization under docs/decisions/0006 Option A. It is a LOGICAL',
    "-- binding name matching wrangler.jsonc's d1_databases[].binding — never a connection string.",
    'INSERT INTO tenant_directory (organization_id, binding_name, state, created_at)',
    `VALUES (${sqlQuote(rows.organizationId)}, 'DB_TENANT', 'active', ${created});`,
    '',
  ];
}

/**
 * What replaces the three tenant statements in the memberless form.
 *
 * IT IS COMMENTARY AND NOT A STATEMENT, deliberately: the whole point of this mode is that three
 * rows are ABSENT, and an absence that leaves no trace in the output is one a reviewer of the
 * `.sql` file cannot see. Someone reading the file six months from now should be able to tell
 * "the Organization was deliberately omitted" from "the tool was interrupted".
 */
function memberlessNotice(): readonly string[] {
  return [
    '-- =========================================================================================',
    '-- NO organization, NO organization_membership AND NO tenant_directory ROW, DELIBERATELY.',
    '-- =========================================================================================',
    '--',
    '-- docs/decisions/0024 invariant 1: A PLATFORM PRINCIPAL HOLDS ZERO MEMBERSHIP ROWS. Not a',
    '-- scoped one, not a read-only one, not one just for the tenant being supported. The absence',
    '-- of the row IS the isolation.',
    '--',
    '-- WHAT THIS ACCOUNT CAN DO AFTER THE TWO STATEMENTS ABOVE: log in, and nothing else.',
    '--   * /auth/session/organizations answers 200 with an EMPTY array. That is correct, not an',
    '--     error, and organization-selection-v1 requires both clients to render it as a',
    '--     first-class explained state.',
    '--   * every Organization it could name at /auth/session/organization answers the same 404 a',
    '--     non-member receives.',
    "--   * its session's active_organization_id stays null for its whole life, so no tenant store",
    '--     can ever be resolved for it.',
    '--',
    '-- TO MAKE IT A PLATFORM OPERATOR, run seed-platform-operator.ts with the principal_id above.',
    '-- TO MAKE IT AN ORDINARY USER INSTEAD, re-run this tool WITHOUT --no-organization. Do not',
    '-- hand-write a membership row for a principal that has already been granted platform',
    '-- authority: it is refused everywhere, and 0010\'s trigger refuses the INSERT.',
    '',
  ];
}

/**
 * EXPORTED SO THE PLATFORM-OPERATOR SEED TOOL USES THIS ONE RATHER THAN ITS OWN.
 * `platform/core/platform/tools/seed-platform-operator.ts` renders different statements against
 * different tables, and a second copy of the quoting rule is a second place it can be got wrong.
 */
export function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// =============================================================================================
// The terminal half. Nothing below here is imported by anything else.
// =============================================================================================

/**
 * The Node surface this tool touches, declared structurally.
 *
 * NOT `@types/node`, WHICH IS A PACKAGE AND IS NOT APPROVED. Declaring the four members actually
 * used keeps the tool dependency-free and makes the surface reviewable: this file cannot reach
 * the filesystem or the network, because it never names anything that could.
 */
type NodeProcess = {
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly stdin: {
    readonly isTTY?: boolean;
    setRawMode?(enabled: boolean): void;
    resume(): void;
    pause(): void;
    setEncoding(encoding: string): void;
    on(event: string, listener: (chunk: string) => void): void;
    off(event: string, listener: (chunk: string) => void): void;
  };
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  exit(code: number): void;
};

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as { process?: NodeProcess }).process;
}

/**
 * The control characters raw mode makes this function responsible for.
 *
 * WRITTEN AS ESCAPES RATHER THAN AS LITERAL BYTES. A literal 0x03 in a source file is invisible in
 * a diff, in a review, and in most editors, and this repository is public.
 */
const ETX = String.fromCharCode(3); // Ctrl-C
const DEL = String.fromCharCode(127);
const BACKSPACE = String.fromCharCode(8);

/**
 * Reads one line from the terminal, optionally without echoing it.
 *
 * ECHO IS SUPPRESSED WITH RAW MODE AND RESTORED ON EVERY EXIT PATH, including the one where the
 * operator presses Ctrl-C. A tool that left a terminal in raw mode after a failed run would be a
 * small disaster of its own, and the operator would be halfway through typing a password when it
 * happened. RAW MODE ALSO SUPPRESSES SIGINT, so Ctrl-C is handled explicitly below — otherwise
 * the one key someone reaches for when a prompt looks wrong would do nothing.
 *
 * IF STDIN IS NOT A TTY the prompt still works — the value is read from the pipe — but ECHO
 * SUPPRESSION IS IMPOSSIBLE, and that is announced rather than quietly skipped. An operator who
 * believes a password is hidden and is wrong has been given a false assurance, which is worse
 * than no assurance.
 *
 * EXPORTED SO `platform/core/platform/tools/seed-platform-operator.ts` USES THIS ONE. That tool
 * needs exactly the same prompt, and a second implementation of raw-mode handling is a second
 * place a terminal gets left in raw mode after a Ctrl-C. Importing this module does not open a
 * prompt: `main` runs only when `argv[1]` names this file.
 */
export async function prompt(label: string, hidden: boolean): Promise<string> {
  const runtime = nodeProcess();
  if (runtime === undefined) {
    throw new Error('This tool runs under Node. There is no process object.');
  }
  const input = runtime.stdin;
  const setRawMode = input.setRawMode;
  const canHide = hidden && input.isTTY === true && typeof setRawMode === 'function';
  if (hidden && !canHide) {
    runtime.stderr.write(
      'NOTE: standard input is not a terminal, so the value you are about to enter CANNOT be ' +
        'hidden and may be echoed or recorded by whatever is feeding it.\n',
    );
  }

  // THE PROMPT GOES TO STDERR, NOT STDOUT, AND THIS IS NOT COSMETIC. Standard output carries the
  // SQL and nothing else, so `node seed-principal.ts > seed.sql` produces a file that starts with
  // `INSERT` rather than with `Email address: `. An operator redirecting the output would
  // otherwise get a .sql file whose first line is a prompt, and find out when the statement fails.
  runtime.stderr.write(label);
  input.setEncoding('utf8');
  input.resume();
  if (canHide && setRawMode !== undefined) {
    setRawMode.call(input, true);
  }

  return new Promise<string>((resolve, reject) => {
    let buffer = '';
    const finish = (outcome: () => void): void => {
      input.off('data', onData);
      if (canHide && setRawMode !== undefined) {
        setRawMode.call(input, false);
      }
      input.pause();
      // Also stderr: with echo suppressed the terminal has no newline of its own, and stdout is
      // reserved for the SQL.
      runtime.stderr.write('\n');
      outcome();
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === ETX) {
          finish(() => {
            reject(new Error('Cancelled. Nothing was produced.'));
          });
          return;
        }
        if (character === '\n' || character === '\r') {
          const value = buffer;
          finish(() => {
            resolve(value);
          });
          return;
        }
        if (character === DEL || character === BACKSPACE) {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += character;
      }
    };
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  const runtime = nodeProcess();
  if (runtime === undefined) {
    throw new Error('This tool runs under Node.');
  }

  const keyText = runtime.env.IDENTITY_LOOKUP_KEY;
  if (keyText === undefined || keyText.length === 0) {
    runtime.stderr.write(
      'IDENTITY_LOOKUP_KEY is not set.\n\n' +
        'It must be the SAME value the deployed Worker holds, set there with\n' +
        '  wrangler secret put IDENTITY_LOOKUP_KEY\n' +
        'A different value here produces a lookup hash the Worker will never compute, and the\n' +
        'account you create will silently be unreachable — the login is simply refused, because\n' +
        'a miss and a wrong password are deliberately indistinguishable.\n',
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

  const email = await prompt('Email address: ', false);

  // THERE IS NO PASSWORD PROMPT. docs/decisions/0017 and the header: rate limiting is not what
  // protects these accounts, entropy is, and that argument collapses the moment a human chooses
  // the password. Generated, printed once, never stored.
  const password = generatePassword();

  runtime.stderr.write(
    `\nDeriving. This takes a moment: ${String(CLIENT_KDF_ITERATIONS)} client iterations plus ` +
      `${String(SERVER_KDF_ITERATIONS)} server iterations, which is the work factor doing its ` +
      'job.\n\n',
  );

  // `--no-organization`, added for docs/decisions/0025. See `renderSeedSql`. It is OPT-IN and the
  // default is the five-row form, so nothing that ran before this flag existed behaves differently.
  const includeOrganization = !runtime.argv.includes('--no-organization');

  const rows = await buildSeedRows({ email, password, lookupKey, nowMs: Date.now() });
  runtime.stdout.write(renderSeedSql(rows, { includeOrganization }));

  runtime.stderr.write(
    [
      '',
      '===============================================================================',
      ' THE PASSWORD. SHOWN ONCE. NOTHING STORES IT AND IT CANNOT BE RECOVERED.',
      '===============================================================================',
      '',
      `  ${password}`,
      '',
      ' Put it in a password manager NOW. If it is lost, the only remedy is to run this',
      ' tool again and replace the credential row — there is no reset flow, because no',
      ' email provider is approved.',
      '',
      ' It is machine-generated on purpose (docs/decisions/0017): the pre-authentication',
      ' rate limiter accepted for the closed beta does not bind across isolates, so the',
      ' entropy of this string is what is actually protecting the account. Do not replace',
      ' it with one you chose.',
      '',
      '===============================================================================',
      '',
      includeOrganization
        ? 'Five statements above; nothing has been executed.'
        : 'Two statements above; nothing has been executed. NO Organization, NO membership.',
      '',
      `  principal_id      ${rows.principalId}`,
      ...(includeOrganization ? [`  organization_id   ${rows.organizationId}`] : []),
      '',
      'BEFORE YOU RUN THEM:',
      '  * Confirm the target is DB_CONTROL (dudo-control-plane), not DB_TENANT.',
      '  * Confirm control-plane migrations 0001 through 0007 have been applied to it.',
      '  * Keep the statement order. Later rows reference earlier ones.',
      '',
      ...(includeOrganization
        ? [
            'AFTER YOU RUN THEM, WHAT THIS ACCOUNT CAN AND CANNOT DO:',
            '  * It can log in, list its one Organization, select it, and resolve a tenant store.',
            `  * It holds the '${SEEDED_ROLE}' role, which grants the Customer Directory permissions`,
            '    in MVP scope (docs/decisions/0019). Permanent deletion is granted to no role.',
            '  * IT WILL STILL BE REFUSED ON EVERY ACTION THAT NARROWS BY BUSINESS, because',
            '    authorizedBusinessIds is empty. Computing it needs the tenant store, which is',
            "    downstream of authorization in 0014 §C.5's order. 0019 closed the grants half of",
            '    AZ5 and not this one. It is a decision, not a missing row you can add here.',
            '  * IT IS NOT ELIGIBLE TO BE A PLATFORM OPERATOR. The membership row above disqualifies',
            '    it (docs/decisions/0024 invariant 1). For an operator account, re-run with',
            '    --no-organization.',
            '  * No audit record exists for any of this. An operator running SQL by hand produces',
            '    none; Organization creation has no auditable home yet; and changing the role later',
            '    has no audited path either (0007 rule 9, recorded as open in 0019).',
          ]
        : [
            'AFTER YOU RUN THEM, WHAT THIS ACCOUNT CAN AND CANNOT DO:',
            '  * It can LOG IN and reach NOTHING. That is the intended shape, not a broken account.',
            '  * The Organization picker answers 200 with an empty array; every Organization it',
            '    could name is refused with the same 404 a non-member receives; its session never',
            '    selects an Organization and no tenant store can ever be resolved for it.',
            '  * IT HOLDS NO PLATFORM AUTHORITY YET. A row in platform_operator is the authority',
            '    (docs/decisions/0025 decision 1), and this tool does not write one. Run',
            '    seed-platform-operator.ts next, with the principal_id above.',
            '  * It IS eligible to become a platform operator, precisely because it has no',
            '    membership row.',
            '  * No audit record exists for any of this, and none can: the writer is a human',
            '    running SQL and no code is in the path.',
          ]),
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
 * open a prompt and block the run. `process.argv[1]` is the script Node was given.
 */
const entryPoint = nodeProcess();
if (entryPoint !== undefined && (entryPoint.argv[1] ?? '').endsWith('seed-principal.ts')) {
  main().catch((cause: unknown) => {
    entryPoint.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    entryPoint.exit(1);
  });
}
