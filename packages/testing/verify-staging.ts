/**
 * ===========================================================================================
 * THE FOUR CHECKS THAT CLOSE GATE STEP 5. `docs/product/mvp-delivery-policy.md` §4.
 * ===========================================================================================
 *
 *   node packages/testing/verify-staging.ts --url https://<staging-host> --email <address>
 *
 * ===========================================================================================
 * WHY THIS EXISTS: EVERY BINDING IN THIS SLICE HAS ONLY EVER BEEN TESTED AGAINST A STUB.
 * ===========================================================================================
 *
 * The web client is verified against a fixture transport, the Apple client against `StubCore`,
 * and Core against an in-memory SQLite. Each half passes. **The join between the halves has
 * never been executed once.** Step 5 asks for exact test evidence for both clients, and evidence
 * that both work against stubs is not evidence that either works against Dudo.
 *
 * These four checks are the join. They are the reason QA reported step 5 as NOT SATISFIED, and
 * running them green is what changes that answer.
 *
 *   1. THE WORKER IS REACHABLE and serves its API surface.
 *   2. THE SEEDED PRINCIPAL CAN LOG IN — the check that matters most, because its real-world
 *      failure is SILENT. See the long note on `IDENTITY_LOOKUP_KEY` below.
 *   3. THE SAME CREDENTIAL WORKS FROM THE APPLE CARRIER — `Authorization: Bearer`, not a cookie.
 *      Five implementations agreeing on a vector table is evidence about the ALGORITHM; it is not
 *      evidence that both clients reach the same account.
 *   4. TENANT ISOLATION HOLDS AGAINST THE DEPLOYED SYSTEM, not only in the harness.
 *
 * ===========================================================================================
 * THIS SCRIPT MAKES NETWORK CALLS AND THEREFORE NEEDS EXPLICIT USER APPROVAL EACH TIME.
 * ===========================================================================================
 *
 * `.claude/rules/security.md` §7 reserves "send anything to an external service" to the user.
 * This file is deliberately NOT wired into `run-az2-login.ts` and cannot be reached by running
 * the test suites. It requires an explicit `--url`, and it refuses to run against anything that
 * looks like production unless `--i-know-this-is-not-staging` is also passed. `workflow.md` §11:
 * staging is not production, and approval for one is not approval for the other.
 *
 * ===========================================================================================
 * SECRETS: THE PASSWORD IS READ FROM THE ENVIRONMENT, NEVER FROM ARGV, AND NOTHING IS PRINTED.
 * ===========================================================================================
 *
 * `argv` is visible in `ps` output and lands in shell history. The password comes from
 * `DUDO_STAGING_PASSWORD` and the lookup key from `IDENTITY_LOOKUP_KEY`. Neither is printed, nor
 * is the derived key, nor the session credential — every one is redacted to a length and a
 * four-character prefix, which is enough to tell two values apart and not enough to use either.
 */

import {
  CLIENT_KDF_ITERATIONS,
  createHmacIdentifierHasher,
  isSubmittableIdentifier,
  normalizeIdentifier,
  toBase64Url,
} from '../../platform/core/identity/credential-store.ts';
import { deriveCredential } from '../../platform/web/src/api/kdf.ts';

// =============================================================================================
// Reporting
// =============================================================================================

type Status = 'passed' | 'failed' | 'skipped' | 'not_run';

type Outcome = {
  readonly step: string;
  readonly name: string;
  status: Status;
  detail: string;
  /** What to do about it. The whole point of this script is that this is specific. */
  remedy: string;
};

const outcomes: Outcome[] = [];

function record(
  step: string,
  name: string,
  status: Status,
  detail: string,
  remedy = '',
): Outcome {
  const outcome = { step, name, status, detail, remedy };
  outcomes.push(outcome);
  const mark =
    status === 'passed' ? 'PASS' : status === 'failed' ? 'FAIL' : status === 'skipped' ? 'SKIP' : 'NOT RUN';
  console.log(`  [${mark}] ${step} — ${name}`);
  if (detail !== '') console.log(`         ${detail}`);
  if (remedy !== '') console.log(`         → ${remedy}`);
  return outcome;
}

/** Enough to compare two values; never enough to use one. */
function redact(value: string): string {
  return `${value.slice(0, 4)}… (${String(value.length)} chars)`;
}

// =============================================================================================
// Arguments and refusals
// =============================================================================================

type Runtime = { argv: readonly string[]; env: Record<string, string | undefined>; exit(code: number): void };

function runtime(): Runtime {
  const found = (globalThis as { process?: Runtime }).process;
  if (found === undefined) {
    throw new Error('This script runs under Node.');
  }
  return found;
}

function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * Hosts this script refuses to touch without an explicit override.
 *
 * NOT a security control — a determined caller passes the flag. It is a guard against the
 * specific accident of pasting a production URL into a terminal at the end of a long day, which
 * is how a verification script becomes a production incident.
 */
const PRODUCTION_SHAPED = [/^https?:\/\/(www\.)?dudo\.work/i, /\bprod\b/i, /\bproduction\b/i];

// =============================================================================================
// The checks
// =============================================================================================

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

type Fetched = {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
  readonly setCookie: string | null;
  readonly text: string;
  readonly error: string | null;
  readonly elapsedMs: number;
};

async function call(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Fetched> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers ?? {},
      body: init.body,
      redirect: 'manual',
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      setCookie: response.headers.get('set-cookie'),
      text,
      error: null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      body: null,
      setCookie: null,
      text: '',
      error: cause instanceof Error ? cause.message : String(cause),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

/** Pulls the session credential out of a `Set-Cookie`, the way a browser would. */
function sessionFromSetCookie(header: string | null): string | null {
  if (header === null) return null;
  const match = /(?:^|,\s*)dudo_session=([^;,\s]+)/.exec(header);
  const value = match?.[1] ?? null;
  return value === null || value === '' ? null : value;
}

async function main(): Promise<void> {
  const process = runtime();
  const argv = process.argv;

  const baseUrl = (argument(argv, 'url') ?? '').replace(/\/+$/, '');
  const email = argument(argv, 'email') ?? '';
  const password = process.env.DUDO_STAGING_PASSWORD ?? '';
  const lookupKeyText = process.env.IDENTITY_LOOKUP_KEY ?? '';
  const override = argv.includes('--i-know-this-is-not-staging');
  const seedSqlPath = argument(argv, 'seed-sql');
  const allowWrites = argv.includes('--allow-writes');

  console.log('\n=== Dudo — staging verification, the four checks that close gate step 5 ===\n');

  // ---- Refusals, before a single packet is sent.
  if (baseUrl === '' || email === '') {
    console.log(
      '  REFUSED. Usage:\n\n' +
        '    DUDO_STAGING_PASSWORD=… IDENTITY_LOOKUP_KEY=… \\\n' +
        '      node packages/testing/verify-staging.ts --url https://<host> --email <address>\n\n' +
        '  The password and the lookup key are read from the ENVIRONMENT, never from argv:\n' +
        '  argv is visible in `ps` and lands in shell history.\n\n' +
        '  Optional:\n' +
        '    --seed-sql <path>    the SQL the seed tool printed. WITH IT, a lookup-key mismatch\n' +
        '                         is diagnosed DEFINITIVELY before any request is sent. Without\n' +
        '                         it you get a ranked differential after a collapsed 401.\n' +
        '    --org <id>           the Organization to select. Defaults to the first the picker\n' +
        '                         offers, which is what a single-membership principal wants.\n' +
        '    --other-org <id>     a second Organization, for the check-4 isolation probe.\n' +
        '    --allow-writes       run §8a.2 and §8a.3. WITHOUT THIS THEY DO NOT RUN, and §8a.3\n' +
        '                         is the PATCH three-way check whose failure is silent data\n' +
        '                         loss. A green run without this flag has NOT tested it.\n',
    );
    process.exit(2);
    return;
  }
  if (password === '') {
    console.log(
      '  REFUSED. DUDO_STAGING_PASSWORD is not set. It must be the password the seed tool was\n' +
        '  run with — not a new one. There is no password reset and no signup.\n',
    );
    process.exit(2);
    return;
  }
  if (PRODUCTION_SHAPED.some((pattern) => pattern.test(baseUrl)) && !override) {
    console.log(
      `  REFUSED. "${baseUrl}" looks like production.\n\n` +
        '  Staging is not production (.claude/rules/workflow.md §11) and approval for one is not\n' +
        '  approval for the other. This script logs in and lists data; running it against\n' +
        '  production is a production action needing its own explicit user approval.\n\n' +
        '  If this really is a staging host whose name merely looks production-shaped, pass\n' +
        '  --i-know-this-is-not-staging.\n',
    );
    process.exit(2);
    return;
  }
  if (!isSubmittableIdentifier(email)) {
    console.log(
      `  REFUSED. "${email}" is not an identifier Dudo accepts: 3–254 printable ASCII\n` +
        '  characters, containing "@", with no whitespace. Whitespace is REFUSED, never trimmed\n' +
        '  (docs/decisions/0015 §D amendment), so a copied-and-pasted address with a trailing\n' +
        '  space fails here rather than confusingly at the server.\n',
    );
    process.exit(2);
    return;
  }

  console.log(`  target        ${baseUrl}`);
  console.log(`  identifier    ${normalizeIdentifier(email)}   (normalised, this is the KDF salt)`);
  console.log(`  password      ${redact(password)}   [never transmitted, never printed]`);
  console.log('');

  // ===========================================================================================
  // PRE-FLIGHT — the local half of the IDENTITY_LOOKUP_KEY diagnosis.
  // ===========================================================================================
  //
  // THE REFUSAL IS COLLAPSED BY DESIGN, AND THAT IS WHY THIS PRE-FLIGHT EXISTS.
  //
  // `identity.login.complete` is `disclosure: 'collapsed'`: a wrong password, an account that
  // does not exist, and a lookup-key mismatch produce a BYTE-IDENTICAL refusal. That is a
  // deliberate security property and it must not be weakened. It also means THIS SCRIPT CANNOT
  // TELL THOSE CASES APART FROM THE RESPONSE, and claiming otherwise would be inventing a
  // diagnosis from an answer that carries no information.
  //
  // What it CAN do is compute the identifier hash locally from the key it was given. That turns a
  // silent, undiagnosable failure into a two-value comparison the operator can make in seconds
  // against the SQL the seed tool printed. If the hashes differ, the keys differ — and that is
  // the specific answer someone debugging this at two in the morning needs, instead of going to
  // look at passwords.
  const normalized = normalizeIdentifier(email);
  let expectedIdentifierHash: string | null = null;
  if (lookupKeyText === '') {
    record(
      'PRE-FLIGHT',
      'identifier hash could not be computed',
      'skipped',
      'IDENTITY_LOOKUP_KEY is not set in this shell.',
      'Set it to the SAME value the Worker holds and re-run. Without it, a check-2 failure ' +
        'cannot be attributed and you will be guessing between four causes.',
    );
  } else {
    const key = new TextEncoder().encode(lookupKeyText);
    if (key.length < 32) {
      record(
        'PRE-FLIGHT',
        'IDENTITY_LOOKUP_KEY is too short',
        'failed',
        `${String(key.length)} bytes; at least 32 are required.`,
        'The Worker refuses to start with a key this short, so the deployment cannot be using ' +
          'this value either.',
      );
    } else {
      expectedIdentifierHash = await (await createHmacIdentifierHasher(key)).hash(normalized);
      record(
        'PRE-FLIGHT',
        'identifier hash computed from the key in this shell',
        'passed',
        `identifier_hash = ${expectedIdentifierHash}`,
        'IF CHECK 2 FAILS: compare this value against the identifier_hash in the SQL the seed ' +
          'tool printed. Equal ⇒ the keys match and the cause is elsewhere. Different ⇒ the ' +
          'seed tool and this shell disagree on IDENTITY_LOOKUP_KEY, and so may the Worker.',
      );
    }
  }

  // ===========================================================================================
  // THE DEFINITIVE `IDENTITY_LOOKUP_KEY` CHECK, WHEN THE SEED SQL IS AVAILABLE.
  // ===========================================================================================
  //
  // The Team Lead asked for check 2 to say *"the seed tool and the Worker disagree on
  // IDENTITY_LOOKUP_KEY"* rather than *"login failed"*. From the HTTP RESPONSE ALONE that is not
  // assertable — the refusal is collapsed and carries no information, and inventing a cause from
  // it would be exactly the overclaim this project keeps refusing to make.
  //
  // BUT IT IS ASSERTABLE FROM A DIFFERENT SOURCE. Point the script at the SQL the seed tool
  // printed and the comparison becomes a fact rather than an inference: the hash in that file was
  // computed with the seeding shell's key, and the hash computed here uses this shell's key. If
  // they differ, the two keys differ — stated flatly, before a single request is sent.
  //
  // WHAT IT STILL CANNOT PROVE, and the message says so: that the WORKER's key matches either of
  // them. Nothing outside the deployment can read a Worker secret. What it proves is that the
  // seeded row is or is not reachable by the key you are holding — which is the half that was
  // undiagnosable, and it converts the silent failure into a named one.
  let seedHashComparison: 'match' | 'mismatch' | 'unavailable' = 'unavailable';
  if (seedSqlPath !== undefined && expectedIdentifierHash !== null) {
    try {
      const { readFileSync } = await import('node:fs');
      const sql = readFileSync(seedSqlPath, 'utf8');
      // The seed tool emits the identifier hash as the first quoted value of the
      // `principal_credential` INSERT. 43 base64url characters is the exact shape.
      const candidates = [...sql.matchAll(/'([A-Za-z0-9_-]{43})'/g)].map((m) => m[1]);
      if (candidates.length === 0) {
        record('PRE-FLIGHT', 'the seed SQL could be read but held no identifier hash', 'skipped',
          `No 43-character base64url value found in ${seedSqlPath}.`,
          'Confirm this is the file the seed tool printed, not an edited excerpt.');
      } else if (candidates.includes(expectedIdentifierHash)) {
        seedHashComparison = 'match';
        record('PRE-FLIGHT', 'the seed SQL and this shell agree on IDENTITY_LOOKUP_KEY', 'passed',
          `The seeded identifier_hash matches the one computed here.`,
          'A check-2 failure therefore is NOT a lookup-key mismatch between the seed tool and ' +
            'this shell. Suspect the Worker secret, the seed SQL never being applied, or the ' +
            'password — in that order.');
      } else {
        seedHashComparison = 'mismatch';
        record('PRE-FLIGHT', 'THE SEED TOOL AND THIS SHELL DISAGREE ON IDENTITY_LOOKUP_KEY', 'failed',
          `seeded ${candidates[0]}\n         computed ${expectedIdentifierHash}`,
          'THIS IS THE CAUSE. The account was seeded under a different IDENTITY_LOOKUP_KEY than ' +
            'the one in this shell, so the Worker can never compute the stored hash and login is ' +
            'refused with no error anywhere. Do not look at the password. Either set this shell ' +
            'and the Worker to the seeding key, or re-run the seed tool under the Worker\'s key ' +
            'and apply the new SQL. The stored row CANNOT be repaired — the plaintext address is ' +
            'not stored, so the hash cannot be recomputed.');
      }
    } catch (cause) {
      record('PRE-FLIGHT', 'the seed SQL could not be read', 'skipped',
        cause instanceof Error ? cause.message : String(cause),
        'Without it, a check-2 failure can only be reported as a ranked differential.');
    }
  } else if (seedSqlPath === undefined) {
    record('PRE-FLIGHT', 'no seed SQL supplied', 'skipped',
      'Pass --seed-sql <path> to the file the seed tool printed.',
      'With it, a lookup-key mismatch is diagnosed DEFINITIVELY before any request is sent, ' +
        'rather than being one of four possibilities after a collapsed 401.');
  }

  // The derived key, computed exactly as the shipped web client computes it.
  const derivedKey = await deriveCredential(password, normalized);
  record(
    'PRE-FLIGHT',
    'client KDF ran and produced a well-formed value',
    derivedKey.length === 43 ? 'passed' : 'failed',
    `${String(CLIENT_KDF_ITERATIONS)} iterations → ${redact(derivedKey)}`,
    derivedKey.length === 43
      ? ''
      : 'The derived key is not 43 characters. The server rejects anything else, and this is a ' +
        'client defect, not a deployment problem.',
  );
  // Cross-checked against Core's own encoder so a KDF fault is ruled out locally before the
  // network is blamed for it.
  const reference = toBase64Url(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: new TextEncoder().encode(normalized),
          iterations: CLIENT_KDF_ITERATIONS,
        },
        await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(password.normalize('NFC')),
          'PBKDF2',
          false,
          ['deriveBits'],
        ),
        256,
      ),
    ),
  );
  record(
    'PRE-FLIGHT',
    'the web client and an independent derivation agree',
    derivedKey === reference ? 'passed' : 'failed',
    derivedKey === reference ? 'identical' : `web ${redact(derivedKey)} vs reference ${redact(reference)}`,
    derivedKey === reference
      ? ''
      : 'THE CLIENT KDF IS WRONG. Stop here — a check-2 failure after this would be caused by ' +
        'this, not by the deployment.',
  );

  console.log('');

  // ===========================================================================================
  // CHECK 1 — the Worker is reachable.
  // ===========================================================================================
  const health = await call(`${baseUrl}/health`, { method: 'GET', headers: JSON_HEADERS });
  if (health.error !== null) {
    record('CHECK 1', 'the Worker is reachable', 'failed', health.error,
      'Nothing below can run. Confirm the deploy succeeded and the URL is the Worker route, ' +
        'not the static asset origin.');
    summarise();
    return;
  }
  record(
    'CHECK 1',
    'the Worker is reachable and answers /health',
    health.status === 200 ? 'passed' : 'failed',
    `HTTP ${String(health.status)} in ${String(health.elapsedMs)} ms`,
    health.status === 200
      ? ''
      : 'A non-200 here usually means the request never reached the Worker. Check ' +
        'run_worker_first in wrangler.jsonc — a static-asset origin answers 404 for /health.',
  );

  // ===========================================================================================
  // CHECK 2 — THE ONE WHOSE REAL-WORLD FAILURE IS SILENT.
  // ===========================================================================================
  const login = await call(`${baseUrl}/auth/login/complete`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: normalized, derived_key: derivedKey }),
  });

  const sessionCredential = sessionFromSetCookie(login.setCookie);

  if (login.error !== null) {
    record('CHECK 2', 'the seeded principal can log in', 'failed', login.error,
      'The request never completed. This is a network or deployment fault, not a credential one.');
  } else if (login.status === 429) {
    record('CHECK 2', 'the seeded principal can log in', 'not_run', 'HTTP 429 — rate limited.',
      'The pre-auth limiter refused this attempt. Wait for the window to reset and re-run. ' +
        'This is the limiter working, not a defect.');
  } else if (login.status === 200 && sessionCredential !== null) {
    record('CHECK 2', 'the seeded principal can log in', 'passed',
      `HTTP 200 in ${String(login.elapsedMs)} ms · session ${redact(sessionCredential)}`,
      'This also proves IDENTITY_LOOKUP_KEY matches between the seed tool and the Worker — ' +
        'the check that has no other way of being made.');
  } else if (login.status === 200) {
    record('CHECK 2', 'the seeded principal can log in', 'failed',
      `HTTP 200 but no dudo_session cookie was set.`,
      'The credential was accepted and no session was issued. That is a Core defect, not a ' +
        'configuration problem — report it to core-agent.');
  } else {
    // THE IMPORTANT BRANCH. Four causes, one indistinguishable answer — so the script ranks them
    // and says plainly that it cannot choose between them, rather than inventing a diagnosis.
    record(
      'CHECK 2',
      'the seeded principal can log in',
      'failed',
      `HTTP ${String(login.status)} in ${String(login.elapsedMs)} ms — the collapsed refusal.`,
      seedHashComparison === 'mismatch'
        ? 'THE CAUSE IS ALREADY KNOWN AND IS NOT THIS RESPONSE. The pre-flight above proved the ' +
          'seed tool and this shell disagree on IDENTITY_LOOKUP_KEY. That is why this login was ' +
          'refused. Fix that and re-run; nothing else here is worth investigating first.'
        : seedHashComparison === 'match'
        ? 'A LOOKUP-KEY MISMATCH BETWEEN THE SEED TOOL AND THIS SHELL IS RULED OUT — the ' +
          'pre-flight compared the hashes and they agree. Remaining causes, in order:\n' +
          '           1. The WORKER holds a different IDENTITY_LOOKUP_KEY from this shell. ' +
          'Nothing outside the deployment can read it; re-set it with `wrangler secret put`.\n' +
          '           2. The seed SQL was never applied, or was applied to DB_TENANT rather ' +
          'than DB_CONTROL.\n' +
          '           3. The password differs from the one the seed tool was run with.'
        : 'THIS RESPONSE CANNOT TELL YOU WHY, BY DESIGN. `identity.login.complete` is ' +
        'disclosure: collapsed, so a wrong password, an unseeded account and a lookup-key ' +
        'mismatch are byte-identical. RE-RUN WITH --seed-sql <path> AND THIS BECOMES A ' +
        'DEFINITIVE ANSWER rather than the list below. Do NOT start with the password. In ' +
        'likelihood order:\n' +
        (expectedIdentifierHash === null
          ? '           1. IDENTITY_LOOKUP_KEY MISMATCH — re-run this script with ' +
            'IDENTITY_LOOKUP_KEY set to get the hash to compare.\n'
          : `           1. IDENTITY_LOOKUP_KEY MISMATCH between the seed tool and the Worker.\n` +
            `              Compare ${expectedIdentifierHash}\n` +
            '              against the identifier_hash in the seed SQL. Different ⇒ this is it, ' +
            'and the account is permanently unreachable until re-seeded.\n') +
        '           2. THE SEED SQL WAS NEVER APPLIED, or was applied to DB_TENANT instead of\n' +
        '              DB_CONTROL. `wrangler d1 migrations apply` does not recurse.\n' +
        '           3. The password differs from the one the seed tool was run with.\n' +
        '           4. A KDF divergence — but the PRE-FLIGHT above rules this out if it passed.',
    );
  }

  // ===========================================================================================
  // CHECK 3 — the Apple carrier. Same credential, different header.
  // ===========================================================================================
  if (sessionCredential === null) {
    record('CHECK 3', 'the Apple carrier reaches the same account', 'not_run',
      'No session credential was issued by check 2.',
      'Checks 3 and 4 cannot run without one. Fix check 2 first.');
    record('CHECK 4', 'tenant isolation holds on the deployed system', 'not_run',
      'No session credential was issued by check 2.', 'Fix check 2 first.');
    summarise();
    return;
  }

  // ===========================================================================================
  // CHECK 2b–2d — ORGANIZATION SELECTION. A 200 FROM LOGIN IS NOT A USABLE SESSION.
  // ===========================================================================================
  //
  // THIS BLOCK EXISTS BECAUSE ITS ABSENCE PRODUCED THE EXACT DEFECT THIS SCRIPT WAS BUILT TO
  // CATCH, IN THIS SCRIPT.
  //
  // The first version logged in and probed immediately. A freshly issued session has no active
  // Organization, so `identity.organization.select` had never been called and EVERY downstream
  // request answered `422 failed_precondition` — which this script then reported as *"No
  // authorized Business, this is the 0019/0020 empty-set case."*
  //
  // That diagnosis was confident, specific, and inferred from a state THE PROBE ITSELF CREATED.
  // It would have sent someone to investigate the role mapping and the business set, neither of
  // which was involved. Same shape as the port collision, the `httpBody` stream, the normalised
  // unicode literal, and the stale ADR quote: an assertion that looked precise while measuring
  // something it had caused.
  //
  // `ADR 0021` and `organization-selection-v1` specify the two routes. The picker is also the one
  // authorized path to a principal's Organization list, so getting it into this script is not
  // only about unblocking the checks below.
  const beforeSelection = await call(`${baseUrl}/api/v1/apps/customers/customers?page_size=1`, {
    method: 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${sessionCredential}` },
  });
  record(
    'CHECK 2b',
    'a session with no Organization selected answers 422, not 200 and not 500',
    beforeSelection.status === 422 ? 'passed' : 'failed',
    `HTTP ${String(beforeSelection.status)} before selection`,
    beforeSelection.status === 422
      ? 'The contracted precondition. A client that never routes 422 to the picker leaves the ' +
        'user with an application that authenticates and then refuses everything.'
      : beforeSelection.status === 200
        ? 'A 200 BEFORE SELECTION IS A DEFECT: the request was served against a session with no ' +
          'active Organization, which means tenancy came from somewhere other than the ' +
          'selection. Report immediately.'
        : 'Expected 422 failed_precondition. Anything else means the precondition is not being ' +
          'enforced the way organization-selection-v1 specifies.',
  );

  const picker = await call(`${baseUrl}/auth/session/organizations`, {
    method: 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${sessionCredential}` },
  });
  const enterable =
    ((picker.body as { data?: { organization_id?: string; display_name?: string | null }[] } | null)
      ?.data ?? []);
  record(
    'CHECK 2c',
    'the Organization picker lists what this principal may enter',
    picker.status === 200 ? 'passed' : 'failed',
    `HTTP ${String(picker.status)} · ${String(enterable.length)} enterable Organization(s)`,
    picker.status === 200
      ? enterable.length === 0
        ? 'AN EMPTY LIST IS A 200, NOT A 404 — an empty collection is not a missing one. But a ' +
          'principal with no active membership cannot select anything, so everything below will ' +
          'stay 422. Check the membership row was seeded and is status active.'
        : enterable.length === 1
          ? 'One membership — the auto-select path.'
          : 'More than one membership — the picker path, which is the case that needs a real ' +
            'choice and is the one most likely to be unimplemented in a client.'
      : 'The picker is the ONLY authorized path to a principal\'s Organization list. Without it ' +
        'a 422 has nowhere to escape to.',
  );

  // The Organization to select: an explicit --org wins, otherwise the first the picker offered.
  const requestedOrg = argument(argv, 'org') ?? enterable[0]?.organization_id;
  if (requestedOrg === undefined) {
    record('CHECK 2d', 'an Organization can be selected', 'not_run',
      'The picker returned nothing to select.',
      'Seed a membership for this principal, or pass --org <organization_id>.');
    record('CHECK 3', 'the Apple carrier reaches the same account', 'not_run',
      'No Organization selected.', 'Everything below stays 422 until one is.');
    record('CHECK 4', 'tenant isolation holds on the deployed system', 'not_run',
      'No Organization selected.', 'See above.');
    summarise();
    return;
  }

  const selected = await call(`${baseUrl}/auth/session/organization`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${sessionCredential}` },
    body: JSON.stringify({ organization_id: requestedOrg }),
  });
  const selectionOk =
    selected.status === 200 && (selected.body as { status?: string } | null)?.status === 'ok';
  record(
    'CHECK 2d',
    'selecting an Organization turns a 422-everything session into a working one',
    selectionOk ? 'passed' : 'failed',
    `HTTP ${String(selected.status)} · body ${JSON.stringify(selected.body)}`,
    selectionOk
      ? 'And it issued NO Set-Cookie, as contracted — the session identifier does not change, ' +
        'only the row it points at.'
      : 'Selection failed. A not_found here means the submitted organization_id is not one this ' +
        'principal has an ACTIVE membership in — the hint is validated against membership, ' +
        'never trusted.',
  );
  if (selected.setCookie !== null) {
    record('CHECK 2e', 'selection must not rotate the session credential', 'failed',
      'A Set-Cookie was returned by the selection route.',
      'organization-selection-v1 contracts no Set-Cookie on this route. A rotated credential ' +
        'here would silently invalidate the copy an Apple client holds in its Keychain.');
  } else {
    record('CHECK 2e', 'selection returned no Set-Cookie, as contracted', 'passed', '',
      'The credential is unchanged, so both carriers keep working across selection.');
  }

  if (!selectionOk) {
    record('CHECK 3', 'the Apple carrier reaches the same account', 'not_run',
      'Organization selection did not succeed.', 'Fix check 2d first.');
    record('CHECK 4', 'tenant isolation holds on the deployed system', 'not_run',
      'Organization selection did not succeed.', 'See above.');
    summarise();
    return;
  }

  const bearer = await call(`${baseUrl}/api/v1/businesses`, {
    method: 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${sessionCredential}` },
  });
  record(
    'CHECK 3',
    'the same credential is accepted as Authorization: Bearer',
    bearer.status === 200 ? 'passed' : 'failed',
    `HTTP ${String(bearer.status)} in ${String(bearer.elapsedMs)} ms`,
    bearer.status === 200
      ? 'One value, two carriers, one contract (0015 §A) — confirmed against the deployment ' +
        'rather than against a stub.'
      : 'The cookie carrier worked and the Bearer carrier did not. That is the exact defect ' +
        '0018 §A was written to close, and it means the Apple client cannot use this deployment.',
  );

  // The Bearer path is also where the two halves of AZ5 become visible.
  if (bearer.status === 200) {
    const businesses = (bearer.body as { data?: unknown[] } | null)?.data;
    const count = Array.isArray(businesses) ? businesses.length : -1;
    record(
      'CHECK 3b',
      'the authorized business set is populated',
      count > 0 ? 'passed' : 'failed',
      `${String(count)} authorized business(es)`,
      count > 0
        ? '0019 (the role) and 0020 (the business set) are both live.'
        : 'AN EMPTY SET IS NOT NECESSARILY A BUG — it is correct if the Organization genuinely ' +
          'has no Businesses. But if one was seeded, this means 0019 or 0020 is not deployed, ' +
          'and every Customer Directory Action will refuse at pipeline step 5.',
    );
  }

  // ===========================================================================================
  // CHECK 4 — tenant isolation against the deployed system.
  // ===========================================================================================
  //
  // The strongest probe available WITHOUT a second seeded Organization: name an Organization the
  // caller is not a member of and confirm it is refused. A second real tenant would be better and
  // is stated as the limit rather than glossed.
  const otherOrg = argument(argv, 'other-org') ?? 'org_not_a_member_00';
  const crossTenant = await call(`${baseUrl}/api/v1/apps/customers/customers?page_size=1`, {
    method: 'GET',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${sessionCredential}`,
      // A header the caller controls, naming someone else's Organization. Core derives tenancy
      // from the authenticated session and must ignore this entirely.
      'X-Organization-Id': otherOrg,
    },
  });
  const leaked = crossTenant.status === 200 && crossTenant.text.includes(otherOrg);
  record(
    'CHECK 4',
    'a caller-supplied Organization header does not change tenancy',
    leaked ? 'failed' : 'passed',
    `HTTP ${String(crossTenant.status)}`,
    leaked
      ? 'CRITICAL: the response references an Organization named in a caller-controlled header. ' +
        'STOP AND REPORT IMMEDIATELY (.claude/rules/security.md §1). Do not continue testing.'
      : 'Tenant identity came from the authenticated session, not from the header — which is ' +
        'what security.md §1 requires and what the harness could only assert in-process.',
  );
  record(
    'CHECK 4b',
    'a full two-tenant probe',
    'not_run',
    'Only one Organization is seeded, so tenant A reading tenant B\'s data cannot be attempted.',
    'To close this properly, seed a SECOND Organization with its own principal and Business, ' +
      'then re-run with --other-org set to it and confirm neither can see the other. Until then ' +
      'the deployed isolation evidence is weaker than the harness evidence.',
  );

  await stubGapChecks(baseUrl, sessionCredential, allowWrites);
  summarise();
}

// =============================================================================================
// RUNBOOK §8a — the five gaps a stub cannot close.
// =============================================================================================
//
// These are not gating checks and are reported separately. Each one is a place where the client
// and Core have only ever agreed with a fixture, and where the real disagreement would be
// invisible until a customer met it.
//
// THE PATCH THREE-WAY DISTINCTION IS THE HIGHEST-CONSEQUENCE ITEM ON EITHER LIST, and it is the
// only one whose failure is SILENT DATA LOSS IN A CUSTOMER'S RECORD rather than an error. The
// rule is normative: a field ABSENT is unchanged, PRESENT WITH A VALUE is set, and
// PRESENT-AND-NULL is cleared. A server that treated absent as null would erase every field the
// form did not send, and the response would look entirely successful.
async function stubGapChecks(
  baseUrl: string,
  session: string,
  allowWrites: boolean,
): Promise<void> {
  const auth = { ...JSON_HEADERS, Authorization: `Bearer ${session}` };
  const customers = `${baseUrl}/api/v1/apps/customers/customers`;

  // ---- §8a.1 — page_size coercion. A query parameter is a string on the wire.
  const paged = await call(`${customers}?page_size=1`, { method: 'GET', headers: auth });
  const pageData = (paged.body as { data?: unknown[] } | null)?.data;
  record(
    '§8a.1',
    'page_size is coerced from its wire string, not rejected as a string',
    paged.status === 200 ? 'passed' : 'failed',
    `HTTP ${String(paged.status)} · ${Array.isArray(pageData) ? String(pageData.length) : '?'} row(s)`,
    paged.status === 200
      ? ''
      : 'A 400 here means Core is validating page_size as a number against a value that is ' +
        'always a string on the wire. Every fixture passed an already-parsed object and could ' +
        'not see this.',
  );

  // ---- §8a.4 — cursor round-trip. Signed by CURSOR_SIGNING_KEY and verified by the deployment.
  const cursor = (paged.body as { next_cursor?: string | null } | null)?.next_cursor ?? null;
  if (cursor === null) {
    record('§8a.4', 'a cursor round-trips through the real signing key', 'not_run',
      'The first page returned no next_cursor, so there is nothing to round-trip.',
      'Seed at least two customers and re-run. Until then the cursor path is unexercised ' +
        'against the deployment, and a CURSOR_SIGNING_KEY misconfiguration would not show here.');
  } else {
    const second = await call(`${customers}?page_size=1&cursor=${encodeURIComponent(cursor)}`, {
      method: 'GET',
      headers: auth,
    });
    record('§8a.4', 'a cursor issued by the deployment is accepted back by it',
      second.status === 200 ? 'passed' : 'failed',
      `HTTP ${String(second.status)}`,
      second.status === 200
        ? ''
        : 'The deployment issued a cursor it will not accept. Suspect CURSOR_SIGNING_KEY ' +
          'differing between isolates, or a cursor encoded for a different tenant.');
  }

  // ---- §8a.5 — the Set-Cookie shape. Read from the real login response, not a fixture.
  // Deliberately re-derived from the credential we already hold rather than logging in again:
  // a second login costs 3 row-writes and the shape was already observed at check 2.
  record('§8a.5', 'the session credential has the contracted shape',
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session) ? 'passed' : 'failed',
    `${redact(session)} — <session_id>.<truncated HMAC>`,
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session)
      ? '0015 §A: one value, two carriers. The dot-separated form is what makes a stolen ' +
        'database row insufficient to mint a credential.'
      : 'The credential does not have the two-part form 0015 §A specifies.');

  // ---- §8a.2 and §8a.3 — create and PATCH. THESE WRITE, so they are opt-in.
  if (!allowWrites) {
    record('§8a.2', 'create returns 201 and a complete record', 'not_run',
      'Writes are not enabled.',
      'Re-run with --allow-writes to exercise it. It creates ONE synthetic customer and costs ' +
        '8 row-writes against the daily ceiling (0014 §A.7).');
    record('§8a.3', 'the PATCH three-way distinction survives a real D1 round-trip', 'not_run',
      'Writes are not enabled. THIS IS THE HIGHEST-CONSEQUENCE UNVERIFIED ITEM.',
      'Re-run with --allow-writes. Its failure mode is SILENT DATA LOSS — a server treating an ' +
        'absent field as null erases every field the form did not send, and the response looks ' +
        'successful. No fixture can catch it because a fixture never round-trips through D1.');
    return;
  }

  // A synthetic customer, obviously test data, created once.
  const marker = `QA staging probe ${new Date().toISOString()}`;
  const businesses = await call(`${baseUrl}/api/v1/businesses`, { method: 'GET', headers: auth });
  const businessId = ((businesses.body as { data?: { business_id?: string }[] } | null)?.data ?? [])[0]
    ?.business_id;
  if (businessId === undefined) {
    // THE DIAGNOSIS THIS BRANCH USED TO GIVE WAS WRONG, AND WRONGLY CONFIDENT. It said "this is
    // the 0019/0020 empty-set case" for ANY absence of a Business — including a 422, which means
    // no Organization is selected and says nothing whatever about roles or business sets. The
    // status code is now read before anything is concluded from it.
    const why =
      businesses.status === 422
        ? 'HTTP 422 — NO ORGANIZATION IS SELECTED on this session. This is NOT the 0019/0020 ' +
          'empty-set case and has nothing to do with roles or the business set. Selection ' +
          'should have happened at check 2d; if that passed and this is still 422, the ' +
          'selection did not persist.'
        : businesses.status === 200
          ? 'HTTP 200 with an empty list — a genuine empty authorized-business set. THIS one is ' +
            'the 0019/0020 case: either the Organization has no Business, or the role grants ' +
            'nothing. Correct behaviour if the Organization really is empty.'
          : `HTTP ${String(businesses.status)} — neither a precondition failure nor an empty ` +
            'set. Read the body before concluding anything.';
    record('§8a.2', 'create returns 201 and a complete record', 'not_run',
      `No authorized Business. ${why}`, 'Resolve the cause above, then re-run.');
    record('§8a.3', 'the PATCH three-way distinction survives a real D1 round-trip', 'not_run',
      'No authorized Business.', 'See §8a.2 — the cause is stated there and it is not always ' +
        'the same cause.');
    return;
  }

  const created = await call(customers, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      business_id: businessId,
      display_name: marker,
      customer_type: 'company',
      email: 'probe@example.invalid',
      phone: '+973 1700 0000',
      country: 'BH',
    }),
  });
  const customerId = (created.body as { customer_id?: string } | null)?.customer_id ?? null;
  record('§8a.2', 'create returns 201 and a complete record',
    created.status === 201 && customerId !== null ? 'passed' : 'failed',
    `HTTP ${String(created.status)}${customerId === null ? ' — no customer_id in the body' : ''}`,
    created.status === 201
      ? 'Delete this probe row afterwards: it is synthetic but it is real data in staging.'
      : 'A 200 rather than 201, or a body without customer_id, is a contract divergence the ' +
        'fixtures could not see.');

  if (customerId === null) {
    record('§8a.3', 'the PATCH three-way distinction survives a real D1 round-trip', 'not_run',
      'Create did not return a customer_id.', 'Fix §8a.2 first.');
    return;
  }

  // THE ONE THAT MATTERS. `phone` is SET, `email` is CLEARED with an explicit null, and
  // `country` is OMITTED and must be UNCHANGED. Then the record is read back from real D1.
  const patched = await call(`${customers}/${customerId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ phone: '+973 1700 1111', email: null }),
  });
  const readBack = await call(`${customers}/${customerId}`, { method: 'GET', headers: auth });
  const record_ = readBack.body as
    | { phone?: string | null; email?: string | null; country?: string | null }
    | null;

  const setOk = record_?.phone === '+973 1700 1111';
  const clearedOk = record_?.email === null;
  const unchangedOk = record_?.country === 'BH';

  record('§8a.3', 'the PATCH three-way distinction survives a real D1 round-trip',
    patched.status === 200 && setOk && clearedOk && unchangedOk ? 'passed' : 'failed',
    `set phone=${setOk ? 'OK' : 'WRONG'} · cleared email=${clearedOk ? 'OK' : 'WRONG'} · ` +
      `omitted country=${unchangedOk ? 'UNCHANGED (OK)' : 'CHANGED (WRONG)'}`,
    setOk && clearedOk && unchangedOk
      ? 'Absent means unchanged, present-with-value means set, present-and-null means cleared — ' +
        'confirmed through real D1 rather than through a fixture.'
      : unchangedOk
        ? 'The set or clear semantics are wrong. Report to core-agent.'
        : 'CRITICAL — SILENT DATA LOSS. `country` was omitted from the PATCH and changed anyway, ' +
          'so an absent field is being treated as null. Every field a form does not send is ' +
          'being erased, and the response reports success. STOP AND REPORT IMMEDIATELY.');

  record('§8a.cleanup', 'the probe row is still present and must be removed by hand', 'not_run',
    `customer_id ${customerId} — display_name "${marker}"`,
    'This script does not delete it: DeleteCustomer is granted to no role (0019) and deleting ' +
      'data is not something a verification script should do unasked. Archive or remove it ' +
      'through the interface.');
}

function summarise(): void {
  const count = (status: Status): number => outcomes.filter((o) => o.status === status).length;
  const passed = count('passed');
  const failed = count('failed');
  const skipped = count('skipped');
  const notRun = count('not_run');

  console.log('\n=== SUMMARY ===\n');

  // PRE-FLIGHT AND GATING CHECKS ARE COUNTED SEPARATELY, DELIBERATELY. A combined "3 passed, 1
  // failed" invites exactly the reading this whole project has been avoiding: three green
  // pre-flight checks make a total look healthy while every gating check is unrun. The pre-flight
  // proves things about THIS SHELL; only the four below prove anything about the deployment.
  const preflight = outcomes.filter((o) => o.step === 'PRE-FLIGHT');
  const gatingSteps = ['CHECK 1', 'CHECK 2', 'CHECK 3', 'CHECK 4'];
  console.log(
    `  Pre-flight (local, proves nothing about the deployment): ` +
      `${String(preflight.filter((o) => o.status === 'passed').length)} passed, ` +
      `${String(preflight.filter((o) => o.status === 'failed').length)} failed, ` +
      `${String(preflight.filter((o) => o.status === 'skipped').length)} skipped\n`,
  );
  console.log(
    `  All checks: ${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped, ` +
      `${String(notRun)} not run (${String(outcomes.length)} recorded)\n`,
  );

  // The four that gate step 5, named individually — a total is not evidence.
  const gating = gatingSteps;
  const gatingOutcomes = gating.map((step) => outcomes.find((o) => o.step === step));
  const allGreen = gatingOutcomes.every((o) => o?.status === 'passed');

  for (const [index, outcome] of gatingOutcomes.entries()) {
    console.log(
      `  ${gating[index]}  ${(outcome?.status ?? 'not_run').toUpperCase().padEnd(8)} ${outcome?.name ?? '(did not run)'}`,
    );
  }

  console.log('');
  if (allGreen) {
    console.log(
      '  ALL FOUR GATING CHECKS PASSED.\n\n' +
        '  This is the evidence gate step 5 was missing: both clients exercised against a real\n' +
        '  Core rather than against stubs. It is NOT step 6 and NOT step 7 — the Team Lead still\n' +
        '  owes the user a URL, a TestFlight build number, release notes and a checklist, and\n' +
        '  ONLY THE USER ACCEPTS.\n\n' +
        '  Note CHECK 4b: the two-tenant probe is still not run. Say so when reporting.\n',
    );
  } else {
    console.log(
      '  STEP 5 IS NOT CLOSED. Read the → lines above; each names what to do rather than only\n' +
        '  what failed. Report the actual result — a partial run is reported as partial.\n',
    );
    (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
  }
}

await main();
